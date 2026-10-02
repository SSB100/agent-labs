import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright-core";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { business, components, definition, fixtureDocument, fixtureTime, loadSource, ownerContext, run, workflowCollection } from "./helpers/guided-ui.mjs";

function artifactNavigationFixture({ selected = true } = {}) {
  const { shell, visuals, workflows, icons, consoleShell, browserUi } = components();
  const artifacts = Array.from({ length: 18 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(8000 + index).padStart(12, "0")}`, business_id: business.id, workflow_run_id: run.id,
    name: `Saved evidence ${index + 1}`, artifact_type: "research.evidence", media_type: "application/json", content: { synthetic: true, ordinal: index + 1 }, metadata: {}, created_at: fixtureTime, updated_at: fixtureTime,
  }));
  const collection = workflowCollection({ artifacts });
  const outcome = loadSource("src/lib/core-ui/run-outcome.ts", { "./workflows": workflows });
  const outcomeUi = loadSource("src/components/guided/run-outcome.tsx", { "@/lib/core-ui/run-outcome": outcome, "./run-outcome.css": {} });
  const workContext = loadSource("src/components/guided/work-context.tsx", { "@/lib/core-ui/workflows": workflows, "./work-context.css": {} });
  const { ConsoleWorkPane } = loadSource("src/components/console/console-work-pane.tsx", {
    "./console-artifact-position": loadSource("src/components/console/console-artifact-position.tsx"),
    "@/components/stage7/app-shell": shell, "@/components/stage7/workflow-visuals": visuals, "@/lib/core-ui/workflows": workflows,
    "@/components/guided/run-outcome": outcomeUi, "@/components/guided/work-context": workContext,
  });
  const { ConsoleOverview } = loadSource("src/components/console/console-overview.tsx", { "@/components/stage7/icons": icons, "@/lib/core-ui/workflows": workflows, "./console-browser-centre": browserUi, "./console-overview.css": {} });
  const target = artifacts[7];
  const source = renderToStaticMarkup(React.createElement(ConsoleOverview, { context: ownerContext(), collection }));
  const sourceLink = [...source.matchAll(/<a\b([^>]+)>/g)].find(([, attributes]) => attributes.includes(`data-artifact-id="${target.id}"`));
  assert.ok(sourceLink, "The actual overview must provide the artifact link");
  const href = sourceLink[1].match(/href="([^"]+)"/)[1].replaceAll("&amp;", "&");
  const selectedArtifactId = selected ? new URL(href, "https://agentlabs-artifact.test").searchParams.get("artifact") : null;
  const markup = renderToStaticMarkup(React.createElement(consoleShell.ConsoleShell, { active: "work", context: ownerContext() },
    React.createElement(ConsoleWorkPane, { context: ownerContext(), collection, detail: { ...collection, run, definition, business }, selectedArtifactId, products: { errors: [], experiments: [] }, costs: null }),
  ));
  return { target, href, selectedArtifactId, html: fixtureDocument(markup) };
}

test("overview artifact links target exact real nested Work details", () => {
  const { target, href, selectedArtifactId, html } = artifactNavigationFixture();
  assert.equal(href, `/dashboard?view=work&run=${run.id}&artifact=${target.id}#artifact-${target.id}`);
  assert.ok(html.includes(`id="artifact-${target.id}"`));
  assert.equal(selectedArtifactId, target.id);
  assert.match(html, new RegExp(`<details[^>]*id="artifact-${target.id}"[^>]*open`));
});

let positionScript;
async function hydratePositionDocument(fixture) {
  if (!positionScript) {
    const root = fileURLToPath(new URL("../", import.meta.url));
    positionScript = build({ absWorkingDir: root, bundle: true, write: false, format: "iife", platform: "browser", target: "es2022", jsx: "automatic",
      define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent", stdin: { sourcefile: "artifact-position-fixture.tsx", resolveDir: root, loader: "tsx", contents: `
        import React, {useEffect, useState} from "react";
        import {hydrateRoot} from "react-dom/client";
        import {ConsoleArtifactPosition} from "./src/components/console/console-artifact-position";
        window.__artifactHydrationErrors = [];
        function Harness() {
          const [props, setProps] = useState(window.__artifactPositionProps);
          window.__artifactSetProps = setProps;
          useEffect(() => { window.__artifactApplied = JSON.stringify(props); }, [props]);
          return props ? <ConsoleArtifactPosition {...props}/> : null;
        }
        hydrateRoot(document.getElementById("artifact-position-root"), <Harness/>, {onRecoverableError: error => window.__artifactHydrationErrors.push(error.message)});
      ` } }).then(result => result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script"));
  }
  const props = fixture.selectedArtifactId ? { artifactId: fixture.selectedArtifactId, workflowRunId: run.id } : null;
  return fixture.html.replace("</body>", `<div id="artifact-position-root"></div><script>window.__artifactPositionProps=${JSON.stringify(props)};</script><script>${await positionScript}</script></body>`);
}

test("artifact positioning fixture bundles the real effect and an unselected route stays closed", async () => {
  const selected = await hydratePositionDocument(artifactNavigationFixture());
  const plain = await hydratePositionDocument(artifactNavigationFixture({ selected: false }));
  assert.match(selected, /hydrateRoot/);
  assert.match(selected, /data-console-evidence-run/);
  assert.match(selected, /hashchange/);
  assert.match(plain, /window\.__artifactPositionProps=null/);
  assert.doesNotMatch(plain.slice(0, plain.indexOf("<script>")), /<details[^>]*\sopen(?:\s|>)/);
});

async function assertPositionGuards(page, fixture) {
  const wrongHash = "#artifact-unrelated";
  const originalHash = `#artifact-${fixture.selectedArtifactId}`;
  await page.evaluate(({ wrongHash, artifactId }) => {
    history.replaceState(null, "", location.pathname + location.search + wrongHash);
    const target = document.getElementById(`artifact-${artifactId}`);
    target.open = false; target.parentElement.closest("details").open = false;
    target.closest(".consolePaneScroll").scrollTop = 0;
    document.querySelector(".consoleNavLink").focus();
    dispatchEvent(new HashChangeEvent("hashchange"));
  }, { wrongHash, artifactId: fixture.selectedArtifactId });
  const inspect = () => page.evaluate(id => {
    const target = document.getElementById(`artifact-${id}`);
    return { targetOpen: target.open, ancestorOpen: target.parentElement.closest("details").open,
      scroll: target.closest(".consolePaneScroll").scrollTop, backgroundFocused: document.activeElement === document.querySelector(".consoleNavLink") };
  }, fixture.selectedArtifactId);
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await settle();
  assert.deepEqual(await inspect(), { targetOpen: false, ancestorOpen: false, scroll: 0, backgroundFocused: true }, "A mismatched hash must not disclose, scroll or focus another artifact");
  const props = { artifactId: fixture.selectedArtifactId, workflowRunId: "wrong-workflow-boundary" };
  await page.evaluate(({ props, hash }) => { history.replaceState(null, "", location.pathname + location.search + hash); window.__artifactSetProps(props); }, { props, hash: originalHash });
  await page.waitForFunction(serialized => window.__artifactApplied === serialized, JSON.stringify(props));
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent("pageshow")));
  await settle();
  assert.deepEqual(await inspect(), { targetOpen: false, ancestorOpen: false, scroll: 0, backgroundFocused: true }, "A mismatched workflow boundary must not disclose, scroll or focus the artifact");
  const exactProps = { artifactId: fixture.selectedArtifactId, workflowRunId: run.id };
  await page.evaluate(props => {
    const input = document.createElement("input"); input.id = "artifact-active-draft"; input.value = "Preserve this draft";
    document.body.append(input); input.focus(); window.__artifactSetProps(props);
  }, exactProps);
  await page.waitForFunction(serialized => window.__artifactApplied === serialized, JSON.stringify(exactProps));
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent("pageshow"))); await settle();
  assert.equal(await page.locator(`#artifact-${fixture.selectedArtifactId}`).getAttribute("open"), null);
  assert.equal(await page.evaluate(() => document.activeElement?.id), "artifact-active-draft", "Evidence refresh must not steal an active draft's focus");
  await page.evaluate(() => {
    document.getElementById("artifact-active-draft").remove();
    const dialog = document.createElement("dialog"); dialog.id = "artifact-modal";
    dialog.innerHTML = '<input aria-label="Modal draft" value="Keep modal focus"/>';
    document.body.append(dialog); dialog.showModal(); dialog.querySelector("input").focus();
    dispatchEvent(new HashChangeEvent("hashchange"));
  }); await settle();
  assert.equal(await page.locator(`#artifact-${fixture.selectedArtifactId}`).getAttribute("open"), null);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Modal draft", "Evidence restoration must remain behind the native modal barrier");
  await page.evaluate(() => { const dialog = document.getElementById("artifact-modal"); dialog.close(); dialog.remove(); });
}

const enabled = process.env.GUIDED_UI_BROWSER === "1" || Boolean(process.env.GUIDED_UI_CHROMIUM_PATH);
test("hydrated exact artifact navigation reveals, positions and restores its owned pane", { skip: !enabled, timeout: 90_000 }, async t => {
  const fixture = artifactNavigationFixture();
  const html = await hydratePositionDocument(fixture);
  const plainHtml = await hydratePositionDocument(artifactNavigationFixture({ selected: false }));
  const origin = "https://agentlabs-artifact.test";
  const directory = path.resolve("test-results/guided-ui");
  mkdirSync(directory, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.GUIDED_UI_CHROMIUM_PATH ? { executablePath: process.env.GUIDED_UI_CHROMIUM_PATH } : {}) });
  try {
    for (const width of [1440, 390, 320]) await t.test(`${width}px exact artifact fragment`, async () => {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce", serviceWorkers: "block" });
      await context.route("**/*", route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin || url.pathname !== "/dashboard" || url.searchParams.get("run") !== run.id) return route.abort();
        return route.fulfill({ status: 200, contentType: "text/html", body: url.searchParams.get("artifact") === fixture.selectedArtifactId ? html : plainHtml });
      });
      const page = await context.newPage();
      try {
        await page.goto(origin + fixture.href);
        async function verifyPosition(visit) {
          await page.screenshot({ path: path.join(directory, `artifact-fragment-${visit}-${width}.png`), animations: "disabled" });
          await page.waitForFunction(id => {
            const target = document.getElementById(id);
            return target?.open && target.parentElement.closest("details")?.open && document.activeElement === target.querySelector(":scope > summary");
          }, `artifact-${fixture.target.id}`);
          assert.deepEqual(await page.evaluate(() => window.__artifactHydrationErrors), []);
          const geometry = await page.locator(`#artifact-${fixture.target.id}`).evaluate(target => {
            const summary = target.querySelector(":scope > summary"), pane = target.closest(".consolePaneScroll");
            const box = summary.getBoundingClientRect(), bounds = pane.getBoundingClientRect();
            return { ancestorOpen: target.parentElement.closest("details").open, targetOpen: target.open, text: summary.textContent, paneScroll: pane.scrollTop,
              top: box.top, bottom: box.bottom, paneTop: bounds.top, paneBottom: bounds.bottom, viewport: innerHeight,
              documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth };
          });
          await page.screenshot({ path: path.join(directory, `artifact-fragment-${visit}-${width}.png`), animations: "disabled" });
          assert.equal(geometry.ancestorOpen, true);
          assert.equal(geometry.targetOpen, true);
          assert.equal(geometry.text, fixture.target.name);
          assert.ok(geometry.top >= -1 && geometry.bottom <= geometry.viewport + 1, JSON.stringify(geometry));
          assert.ok(geometry.documentWidth <= geometry.viewportWidth + 1, JSON.stringify(geometry));
          if (width > 900) {
            assert.ok(geometry.paneScroll > 0, "The exact artifact must scroll into its internal Work pane");
            assert.ok(geometry.top >= geometry.paneTop - 1 && geometry.bottom <= geometry.paneBottom + 1, JSON.stringify(geometry));
          }
        }
        await verifyPosition("initial");
        await page.reload();
        await verifyPosition("reload");
        await page.goto(`${origin}/dashboard?view=work&run=${run.id}`);
        await page.waitForFunction(() => window.__artifactApplied === "null");
        assert.equal(await page.locator(`#artifact-${fixture.target.id}`).getAttribute("open"), null);
        await page.goBack();
        await verifyPosition("back");
        await page.goForward();
        await page.waitForFunction(() => window.__artifactApplied === "null");
        assert.equal(await page.locator(`#artifact-${fixture.target.id}`).getAttribute("open"), null);
        await page.goBack();
        await verifyPosition("back-again");
        if (width === 1440) await assertPositionGuards(page, fixture);
      } finally { await context.close(); }
    });
  } finally { await browser.close(); }
});
