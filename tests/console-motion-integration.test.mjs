import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";
import { integratedMotionDocument, integratedMotionIds as ids, integratedMotionOrigin as origin, integratedMotionPage, integratedMotionStates } from "./helpers/console-motion-integration.mjs";

function displayedReceipts(markup) {
  return [...markup.matchAll(/<[^>]*data-console-motion-target="([^"]+)"[^>]*>/g)].map(([tag, target]) => ({ target, id: tag.match(/data-console-motion-id="([^"]+)"/)?.[1] ?? "" }));
}
test("actual Dashboard motion snapshots join exact displayed overview, stage, decision and output receipts", async () => {
  for (const [view, detail] of [["overview", false], ["work", true], ["decisions", false]]) {
    const fixture = await integratedMotionPage("saved", { view, detail });
    const snapshot = fixture.boundary.props.snapshot;
    assert.equal(fixture.boundary.props.scopeKey, view === "decisions" ? "decisions:owned:page:1" : detail ? `run:${ids.run}` : "recent-owned-work");
    assert.equal(snapshot.available, true);
    const actual = displayedReceipts(fixture.markup);
    assert.ok(actual.length >= 1, view);
    for (const receipt of actual.filter(row => row.target !== "core")) {
      assert.ok(snapshot.entities.some(entity => entity.target === receipt.target && entity.id === receipt.id), `${view} ${JSON.stringify(receipt)} must match the root's real snapshot`);
    }
    if (view === "overview") {
      for (const target of ["worker", "stage", "decision", "output"]) assert.ok(actual.some(row => row.target === target && row.id === ids[target]), `${target} must be the exact visible persisted record`);
    }
    if (view === "work") {
      assert.ok(actual.some(row => row.target === "stage" && row.id === ids.stage));
      assert.ok(actual.some(row => row.target === "output" && row.id === ids.output));
    }
  }
});

test("root-derived terminal, mismatched and incomplete receipts cannot claim worker activity", async () => {
  const states = await integratedMotionStates();
  assert.equal(states.running.boundary.snapshot.entities.find(row => row.target === "worker" && row.id === ids.worker).state, "running");
  for (const name of ["failed", "stopped", "mismatched"]) {
    const fixture = await integratedMotionPage(name);
    assert.equal(fixture.boundary.props.snapshot.entities.some(row => row.target === "worker" && row.state === "running"), false, name);
    assert.doesNotMatch(fixture.markup, /data-work-state="working"|data-worker-active="true"|Working now/, name);
  }
  for (const name of ["unavailable", "truncated"]) {
    const fixture = await integratedMotionPage(name);
    assert.equal(fixture.boundary.props.snapshot.available, false, name);
    assert.match(fixture.markup, /data-work-state="unknown"/);
    assert.doesNotMatch(fixture.markup, /data-worker-active="true"|Working now|Idle · no worker running/, name);
  }
});

let documentPromise;
const fixture = () => documentPromise ??= integratedMotionDocument();
test("root-derived real overview hydration bundles only read-only presentation modules", async () => {
  const html = await fixture();
  assert.match(html, /data-console-overview="true"/);
  assert.match(html, /hydrateRoot/);
  assert.match(html, /consoleReceiptPulse/);
  assert.doesNotMatch(html, /https:\/\/[^"\s]*(?:supabase\.co|openrouter\.ai)|runtimeCapability|begin_installed_pack_run/);
});

const enabled = process.env.GUIDED_UI_BROWSER === "1" || Boolean(process.env.GUIDED_UI_CHROMIUM_PATH);
const target = (kind, id) => `[data-console-motion-target="${kind}"]${id ? `[data-console-motion-id="${id}"]` : ""}`;
async function transition(page, name) {
  await page.evaluate(name => window.__integratedMotion.observe(name), name);
  await page.waitForFunction(name => window.__integratedMotionApplied?.startsWith(name + ":"), name);
}
async function quiet(page) {
  await page.waitForFunction(() => !document.querySelector("[data-console-motion-cue]"));
  await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== "running"), undefined, { timeout: 3000 });
  assert.equal(await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === "running").length), 0);
}
async function openFixture(browser, width, reducedMotion = "no-preference") {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion, serviceWorkers: "block" });
  const unexpected = [], errors = [];
  await context.route("**/*", async route => {
    if (route.request().url() === origin + "/") return route.fulfill({ contentType: "text/html", body: await fixture() });
    unexpected.push(route.request().url()); return route.abort();
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin + "/");
  await page.waitForFunction(() => window.__integratedMotionApplied === "queued:0:0");
  return { context, page, unexpected, errors };
}
const launch = () => chromium.launch({ headless: true, ...(process.env.GUIDED_UI_CHROMIUM_PATH ? { executablePath: process.env.GUIDED_UI_CHROMIUM_PATH } : {}) });

test("hydrated production overview ties motion to visible receipts without layout shift, poll replay or provider actions", { skip: !enabled, timeout: 120_000 }, async t => {
  const browser = await launch(), directory = path.resolve("test-results/guided-ui");
  mkdirSync(directory, { recursive: true });
  try {
    for (const width of [1440, 390, 320]) await t.test(`${width}px real receipt integration`, async () => {
      const { context, page, unexpected, errors } = await openFixture(browser, width);
      try {
        await quiet(page);
        await transition(page, "running");
        await page.locator(`${target("worker", ids.worker)}[data-console-motion-state="running"]`).waitFor();
        await page.locator(`${target("stage", ids.stage)}[data-console-motion-state="running"]`).waitFor();
        assert.equal(await page.locator(".consoleOverview").getAttribute("data-work-state"), "working");
        assert.equal(await page.locator(target("worker", ids.worker)).getAttribute("data-worker-active"), "true");
        assert.ok((await page.locator(target("worker", ids.worker)).innerText()).includes("Working now"));
        const nodes = await page.locator("[data-console-motion-target]").evaluateAll(elements => elements.map(element => ({ target: element.dataset.consoleMotionTarget, id: element.dataset.consoleMotionId ?? "" })));
        const states = await integratedMotionStates();
        for (const node of nodes.filter(node => node.target !== "core")) assert.ok(states.running.boundary.snapshot.entities.some(entity => entity.target === node.target && entity.id === node.id));
        const before = await page.locator(target("worker", ids.worker)).boundingBox();
        await page.evaluate(() => { window.__savedIntegratedAnimation = document.querySelector('[data-console-motion-target="worker"] > [data-console-motion-mark]').getAnimations()[0]; window.__integratedMotion.poll(); });
        await page.waitForFunction(() => window.__integratedMotionApplied === "running:1:0");
        assert.equal(await page.evaluate(() => document.querySelector('[data-console-motion-target="worker"] > [data-console-motion-mark]').getAnimations()[0] === window.__savedIntegratedAnimation), true);
        assert.deepEqual(await page.locator(target("worker", ids.worker)).boundingBox(), before);
        await page.screenshot({ path: path.join(directory, `console-motion-integrated-running-${width}.png`), fullPage: true });
        await transition(page, "saved");
        await page.locator(`${target("output", ids.output)}[data-console-motion-cue="saved"]`).waitFor();
        await page.locator(`${target("decision", ids.decision)}[data-console-motion-cue="decision"]`).waitFor();
        await transition(page, "completed");
        await page.locator(`${target("stage", ids.stage)}[data-console-motion-state="completed"]`).waitFor();
        assert.equal(await page.locator(target("stage", ids.stage)).locator(".consoleStageMark").textContent(), "✓");
        await quiet(page);
        await page.evaluate(() => window.__integratedMotion.remount());
        await page.waitForFunction(() => window.__integratedMotionApplied === "completed:1:1");
        await quiet(page);
        const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: innerWidth }));
        assert.ok(dimensions.scroll <= dimensions.viewport);
        assert.deepEqual(await page.evaluate(() => window.__integratedMotionErrors), []);
        assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
      } finally { await context.close(); }
    });
  } finally { await browser.close(); }
});

test("integrated failed, stopped, incomplete, hidden and reduced-motion states stay truthful", { skip: !enabled, timeout: 120_000 }, async t => {
  const browser = await launch();
  try {
    for (const name of ["failed", "stopped", "unavailable", "truncated", "mismatched"]) await t.test(name, async () => {
      const { context, page, errors, unexpected } = await openFixture(browser, 390);
      try {
        await transition(page, "running"); await transition(page, name);
        if (name === "mismatched") {
          await page.waitForFunction(() => !document.querySelector("[data-console-motion-cue]"));
          const animatedTargets = await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === "running").map(animation => animation.effect.target.closest("[data-console-motion-target]")?.dataset.consoleMotionTarget));
          assert.deepEqual(animatedTargets, ["stage"], "A missing worker receipt cannot animate the core or any worker");
        } else await quiet(page);
        assert.equal(await page.locator('[data-console-motion-state="running"]').count(), name === "mismatched" ? 1 : 0, "Only a persisted running stage may remain when the worker join is missing");
        assert.equal(await page.locator('[data-worker-active="true"]').count(), 0);
        assert.notEqual(await page.locator(".consoleOverview").getAttribute("data-work-state"), "working");
        assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
      } finally { await context.close(); }
    });
    await t.test("hidden transitions do not replay saved or decision cues", async () => {
      const { context, page } = await openFixture(browser, 390);
      try {
        await transition(page, "running");
        await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
        await transition(page, "saved");
        assert.equal(await page.locator("[data-console-motion-cue]").count(), 0);
        await transition(page, "failed");
        await page.evaluate(() => { delete document.visibilityState; document.dispatchEvent(new Event("visibilitychange")); });
        await quiet(page);
        assert.equal(await page.locator('[data-console-motion-state="running"]').count(), 0);
      } finally { await context.close(); }
    });
    await t.test("reduced motion keeps saved state and checks without animation", async () => {
      const { context, page, errors, unexpected } = await openFixture(browser, 320, "reduce");
      try {
        for (const name of ["running", "saved", "completed"]) {
          await transition(page, name);
          assert.equal(await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === "running").length), 0);
          if (name === "saved") assert.equal(await page.locator(target("decision", ids.decision)).getAttribute("data-console-motion-state"), "attention");
        }
        assert.equal(await page.locator(target("stage", ids.stage)).locator(".consoleStageMark").textContent(), "✓");
        const directory = path.resolve("test-results/guided-ui"); mkdirSync(directory, { recursive: true });
        await page.screenshot({ path: path.join(directory, "console-motion-integrated-reduced-320.png"), fullPage: true });
        assert.deepEqual(await page.evaluate(() => window.__integratedMotionErrors), []);
        assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
      } finally { await context.close(); }
    });
  } finally { await browser.close(); }
});
