import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";
import { consoleMotionFixtureDocument, consoleMotionFixtureOrigin } from "./helpers/console-motion-browser.mjs";

let documentPromise;
const fixture = () => documentPromise ??= consoleMotionFixtureDocument();
const enabled = process.env.GUIDED_UI_BROWSER === "1" || Boolean(process.env.GUIDED_UI_CHROMIUM_PATH);
const target = name => `[data-console-motion-target="${name}"]`;
const cue = (name, kind) => `${target(name)}[data-console-motion-cue="${kind}"]`;
const state = (name, value) => `${target(name)}[data-console-motion-state="${value}"]`;
const observe = (page, name) => page.evaluate(name => window.__consoleMotionFixture.observe(name), name);

test("motion fixture hydrates real components with no provider, auth, or mutation imports", async () => {
  const html = await fixture();
  assert.match(html, /data-console-motion-boundary="true"/);
  assert.match(html, /hydrateRoot/);
  assert.doesNotMatch(html, /https:\/\/[^"\s]*(?:supabase\.co|openrouter\.ai)|runtimeCapability|begin_installed_pack_run/);
  assert.equal(await consoleMotionFixtureDocument(), html);
});

async function openFixture(browser, reducedMotion = "no-preference") {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion, serviceWorkers: "block" });
  const network = [];
  await context.route("**/*", async route => {
    if (route.request().url() === consoleMotionFixtureOrigin + "/") await route.fulfill({ contentType: "text/html", body: await fixture() });
    else { network.push(route.request().url()); await route.abort(); }
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(consoleMotionFixtureOrigin + "/");
  await page.waitForFunction(() => window.__consoleMotionReady);
  await page.locator(state("core", "idle")).waitFor();
  return { context, page, errors, network };
}

async function assertQuiet(page) {
  const animations = await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === "running").length);
  assert.equal(animations, 0);
}

test("actual state transitions animate once without poll/remount replay or layout motion", { skip: !enabled, timeout: 90_000 }, async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.GUIDED_UI_CHROMIUM_PATH ? { executablePath: process.env.GUIDED_UI_CHROMIUM_PATH } : {}) });
  const { context, page, errors, network } = await openFixture(browser);
  try {
    await assertQuiet(page);
    await observe(page, "running");
    await page.locator(cue("run", "activation")).waitFor();
    assert.equal(await page.locator(`${target("stage")} > [data-console-motion-mark]`).evaluate(element => getComputedStyle(element).animationName), "consoleReceiptPulse");
    assert.equal(await page.locator(`${target("run")} > [data-console-motion-mark]`).evaluate(element => element.getAnimations().length), 1);
    // Compare actual Animation identity after React commits the poll, not just source attributes.
    await page.evaluate(() => { window.__activationAnimation = document.querySelector('[data-console-motion-target="run"] > [data-console-motion-mark]').getAnimations()[0]; window.__consoleMotionFixture.poll(); });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => document.querySelector('[data-console-motion-target="run"] > [data-console-motion-mark]').getAnimations()[0] === window.__activationAnimation), true);
    const box = await page.locator(target("stage")).boundingBox();
    await page.evaluate(() => window.__consoleMotionFixture.remount());
    await page.locator('[data-fixture-generation="1"]').waitFor();
    await page.waitForFunction(() => !document.querySelector('[data-console-motion-cue="activation"]'));
    assert.deepEqual(await page.locator(target("stage")).boundingBox(), box);
    assert.equal(await page.locator(`${target("stage")} > [data-console-motion-mark]`).evaluate(element => getComputedStyle(element).animationName), "consoleReceiptPulse");
    await observe(page, "saved");
    await page.locator(cue("output", "saved")).waitFor();
    await page.locator(cue("decision", "decision")).waitFor();
    const outputBox = await page.locator(target("output")).boundingBox();
    await page.evaluate(() => window.__consoleMotionFixture.poll());
    assert.deepEqual(await page.locator(target("output")).boundingBox(), outputBox);
    await observe(page, "completed");
    await page.locator(cue("stage", "completion")).waitFor();
    assert.equal(await page.locator(`${target("stage")} > [data-console-motion-mark]`).textContent(), "✓");
    await page.locator(state("core", "idle")).waitFor();
    await page.waitForFunction(() => !document.querySelector('[data-console-motion-cue]'));
    await assertQuiet(page);
    await page.evaluate(() => window.__consoleMotionFixture.remount());
    await page.locator('[data-fixture-generation="2"]').waitFor();
    await assertQuiet(page);
    assert.deepEqual(await page.evaluate(() => window.__consoleMotionErrors), []);
    assert.deepEqual(errors, []);
    assert.deepEqual(network, []);
  } finally { await context.close(); await browser.close(); }
});

test("failure, stopped runtime, unavailable reads and scope changes cannot suggest active work", { skip: !enabled, timeout: 90_000 }, async t => {
  const browser = await chromium.launch({ headless: true, ...(process.env.GUIDED_UI_CHROMIUM_PATH ? { executablePath: process.env.GUIDED_UI_CHROMIUM_PATH } : {}) });
  try {
    for (const scenario of ["failed", "stopped", "unavailable"]) await t.test(scenario, async () => {
      const { context, page } = await openFixture(browser);
      try {
        await observe(page, "running");
        await page.locator(state("core", "running")).waitFor();
        await observe(page, scenario);
        await page.locator(state("core", scenario === "unavailable" ? "unavailable" : "idle")).waitFor();
        await page.waitForFunction(() => !document.querySelector('[data-console-motion-cue]'));
        await assertQuiet(page);
      } finally { await context.close(); }
    });
    for (const method of ["changeOwner", "changeScope"]) await t.test(method, async () => {
      const { context, page } = await openFixture(browser);
      try {
        await observe(page, "running");
        await page.locator(cue("run", "activation")).waitFor();
        await page.evaluate(method => window.__consoleMotionFixture[method](), method);
        await page.waitForFunction(() => !document.querySelector('[data-console-motion-cue]'));
        await page.locator(state("core", "running")).waitFor();
      } finally { await context.close(); }
    });
  } finally { await browser.close(); }
});

test("reduced motion retains completed checks and amber owner state with zero moving animations", { skip: !enabled, timeout: 90_000 }, async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.GUIDED_UI_CHROMIUM_PATH ? { executablePath: process.env.GUIDED_UI_CHROMIUM_PATH } : {}) });
  const { context, page, errors } = await openFixture(browser, "reduce");
  try {
    for (const scenario of ["running", "saved", "completed"]) {
      await observe(page, scenario);
      await page.locator(state("core", scenario === "completed" ? "idle" : "running")).waitFor();
      if (scenario === "saved") {
        await page.locator(state("decision", "attention")).waitFor();
        assert.equal(await page.locator(`${target("decision")} > [data-console-motion-mark]`).evaluate(element => getComputedStyle(element).color), "rgb(233, 189, 120)");
      }
      await assertQuiet(page);
    }
    assert.equal(await page.locator(`${target("stage")} > [data-console-motion-mark]`).textContent(), "✓");
    const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(dimensions.scroll <= dimensions.viewport);
    const directory = path.resolve("test-results/guided-ui");
    mkdirSync(directory, { recursive: true });
    await page.screenshot({ path: path.join(directory, "console-motion-reduced-390.png"), fullPage: true });
    assert.deepEqual(errors, []);
  } finally { await context.close(); await browser.close(); }
});
