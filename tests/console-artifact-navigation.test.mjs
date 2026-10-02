import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright-core";
import { business, components, definition, fixtureDocument, fixtureTime, loadSource, ownerContext, run, workflowCollection } from "./helpers/guided-ui.mjs";

function artifactNavigationFixture() {
  const { shell, visuals, workflows, icons, consoleShell } = components();
  const artifacts = Array.from({ length: 18 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(8000 + index).padStart(12, "0")}`, business_id: business.id, workflow_run_id: run.id,
    name: `Saved evidence ${index + 1}`, artifact_type: "research.evidence", media_type: "application/json", content: { synthetic: true, ordinal: index + 1 }, metadata: {}, created_at: fixtureTime, updated_at: fixtureTime,
  }));
  const collection = workflowCollection({ artifacts });
  const outcome = loadSource("src/lib/core-ui/run-outcome.ts", { "./workflows": workflows });
  const outcomeUi = loadSource("src/components/guided/run-outcome.tsx", { "@/lib/core-ui/run-outcome": outcome, "./run-outcome.css": {} });
  const workContext = loadSource("src/components/guided/work-context.tsx", { "@/lib/core-ui/workflows": workflows, "./work-context.css": {} });
  const { ConsoleWorkPane } = loadSource("src/components/console/console-work-pane.tsx", {
    "@/components/stage7/app-shell": shell, "@/components/stage7/workflow-visuals": visuals, "@/lib/core-ui/workflows": workflows,
    "@/components/guided/run-outcome": outcomeUi, "@/components/guided/work-context": workContext,
  });
  const { ConsoleOverview } = loadSource("src/components/console/console-overview.tsx", { "@/components/stage7/icons": icons, "@/lib/core-ui/workflows": workflows, "./console-overview.css": {} });
  const target = artifacts[7];
  const source = renderToStaticMarkup(React.createElement(ConsoleOverview, { context: ownerContext(), collection }));
  const sourceLink = [...source.matchAll(/<a\b([^>]+)>/g)].find(([, attributes]) => attributes.includes(`data-artifact-id="${target.id}"`));
  assert.ok(sourceLink, "The actual overview must provide the artifact link");
  const href = sourceLink[1].match(/href="([^"]+)"/)[1].replaceAll("&amp;", "&");
  const selectedArtifactId = new URL(href, "https://agentlabs-artifact.test").searchParams.get("artifact");
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

const enabled = process.env.GUIDED_UI_BROWSER === "1" || Boolean(process.env.GUIDED_UI_CHROMIUM_PATH);
test("native artifact fragment navigation reveals ancestor disclosures and scrolls its pane", { skip: !enabled, timeout: 90_000 }, async t => {
  const fixture = artifactNavigationFixture();
  const origin = "https://agentlabs-artifact.test";
  const directory = path.resolve("test-results/guided-ui");
  mkdirSync(directory, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.GUIDED_UI_CHROMIUM_PATH ? { executablePath: process.env.GUIDED_UI_CHROMIUM_PATH } : {}) });
  try {
    for (const width of [1440, 390, 320]) await t.test(`${width}px exact artifact fragment`, async () => {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce", serviceWorkers: "block" });
      await context.route("**/*", route => route.request().url().startsWith(`${origin}/dashboard?`) ? route.fulfill({ status: 200, contentType: "text/html", body: fixture.html }) : route.abort());
      const page = await context.newPage();
      try {
        await page.goto(origin + fixture.href);
        for (const visit of ["initial", "reload"]) {
          if (visit === "reload") await page.reload();
          await page.screenshot({ path: path.join(directory, `artifact-fragment-${visit}-${width}.png`), animations: "disabled" });
          await page.waitForFunction(id => document.getElementById(id)?.open && document.getElementById(id)?.parentElement.closest("details")?.open, `artifact-${fixture.target.id}`);
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
      } finally { await context.close(); }
    });
  } finally { await browser.close(); }
});
