import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";
import { questFixtureDocument, questFixtureOrigin, questFixtureProps } from "./helpers/quest-kickoff-browser.mjs";

const enabled = process.env.GUIDED_UI_BROWSER === "1" || Boolean(process.env.GUIDED_UI_CHROMIUM_PATH);
const screenshots = path.resolve("test-results/guided-ui");
let documentPromise;
const getDocument = () => documentPromise ??= questFixtureDocument();

test("quest browser fixture bundles production React with only the paid action mocked", async () => {
  const html = await getDocument();
  assert.match(html, /Find a market worth exploring/);
  assert.match(html, /quest-fixture-root/);
  assert.match(html, /__questHydrationErrors/);
  assert.match(html, /__questActions/);
  assert.doesNotMatch(html, /https:\/\/[^"\s]*(?:supabase\.co|openrouter\.ai)|OPENROUTER_API_KEY|begin_installed_pack_run/);
});

async function assertFocusedHeading(page, title) {
  await page.getByRole("heading", { name: title, exact: true }).waitFor();
  await page.waitForFunction(expected => document.activeElement?.textContent === expected, title);
}

async function assertLayout(page, label) {
  const findings = await page.evaluate(() => {
    const controls = [...document.querySelectorAll("button, input:not([type=hidden]):not([type=checkbox]), textarea, select, .questKickoffConsent")];
    const text = [...document.querySelectorAll(".questKickoff p, .questKickoff small, .questKickoff label, .questKickoff button, .questKickoff dt, .questKickoff dd, .questKickoffBadge, .questKickoffSteps li")];
    return {
      width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      tinyTargets: controls.filter(element => { const box = element.getBoundingClientRect(); return box.width && box.height && (box.height < 44 || box.width < 44); }).map(element => element.tagName),
      tinyText: text.filter(element => { const box = element.getBoundingClientRect(); return box.width && box.height && parseFloat(getComputedStyle(element).fontSize) < 14; }).map(element => ({ text: element.textContent.slice(0, 40), size: getComputedStyle(element).fontSize })),
      bodyInputSize: [...document.querySelectorAll("textarea, input:not([type=hidden]):not([type=checkbox]), select, .questKickoffReview dd, .questKickoffConsent")].map(element => parseFloat(getComputedStyle(element).fontSize)),
    };
  });
  assert.ok(findings.scrollWidth <= findings.width + 1, `${label}: horizontal overflow ${JSON.stringify(findings)}`);
  assert.deepEqual(findings.tinyTargets, [], `${label}: controls need 44px targets`);
  assert.deepEqual(findings.tinyText, [], `${label}: utility text needs 14px minimum`);
  assert.ok(findings.bodyInputSize.every(size => size >= 16), `${label}: body and input text need 16px`);
}

async function screenshot(page, name, width) {
  await assertLayout(page, `${name}/${width}`);
  await page.screenshot({ path: path.join(screenshots, `quest-${name}-${width}.png`), fullPage: true, animations: "disabled" });
}

// Hosted CI supplies pinned Chromium. No dev server, credentials or real action
// exists in this fixture; its HTTPS document is fulfilled entirely in memory.
test("hydrated quest preserves drafts, requires fresh consent and blocks repeated paid submissions", { skip: !enabled, timeout: 180_000 }, async t => {
  mkdirSync(screenshots, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.GUIDED_UI_CHROMIUM_PATH ? { executablePath: process.env.GUIDED_UI_CHROMIUM_PATH } : {}) });
  try {
    const html = await getDocument();
    for (const width of [1440, 390, 320]) {
      await t.test(`real hydration and research controls at ${width}px`, async () => {
        const context = await browser.newContext({ viewport: { width, height: 1000 }, locale: "en-NZ", timezoneId: "UTC", colorScheme: "dark", reducedMotion: "reduce", serviceWorkers: "block" });
        const externalRequests = [];
        await context.route("**/*", route => {
          if (route.request().url() === questFixtureOrigin && route.request().isNavigationRequest()) return route.fulfill({ status: 200, contentType: "text/html", body: html });
          externalRequests.push(route.request().url());
          return route.abort();
        });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
        try {
          await page.goto(questFixtureOrigin, { waitUntil: "load" });
          await page.waitForFunction(() => !document.querySelector('button[type="submit"]')?.disabled);
          assert.deepEqual(await page.evaluate(() => window.__questHydrationErrors), []);
          await screenshot(page, "goal", width);
          await page.getByRole("textbox", { name: /What do you want to learn/ }).fill("Book me a flight to London next week.");
          await page.getByRole("button", { name: /Continue to scope/ }).click();
          await page.getByRole("alert").waitFor();
          assert.equal(await page.getByRole("alert").evaluate(element => element === document.activeElement), true);
          assert.deepEqual(await page.evaluate(() => window.__questActions), []);

          const goal = "Compare the best geographic markets for original hiking T-shirts.";
          await page.getByRole("textbox", { name: /What do you want to learn/ }).fill(goal);
          await page.getByRole("textbox", { name: /Audience constraint/ }).fill("Adult hikers");
          await page.getByRole("button", { name: /Continue to scope/ }).focus();
          await page.keyboard.press("Enter");
          await assertFocusedHeading(page, "Set the boundaries");
          await page.keyboard.press("Tab");
          const focus = await page.evaluate(() => ({ tag: document.activeElement.tagName, visible: document.activeElement.matches(":focus-visible"), outline: parseFloat(getComputedStyle(document.activeElement).outlineWidth) }));
          assert.equal(focus.tag, "SELECT");
          assert.ok(focus.visible && focus.outline >= 2);
          await page.getByRole("combobox", { name: /Fixed research scope/ }).selectOption("2");
          await page.getByRole("button", { name: "Review research" }).click();
          await page.getByRole("alert").waitFor();
          assert.match(await page.getByRole("alert").textContent(), /estimate exceeds/);
          await page.getByRole("spinbutton", { name: /Research allowance/ }).fill("0.75");
          await screenshot(page, "scope", width);
          await page.getByRole("button", { name: "Review research" }).focus();
          await page.keyboard.press("Enter");
          await assertFocusedHeading(page, "Review before research starts");
          const consent = page.getByRole("checkbox", { name: /I approve only this bounded research/ });
          assert.equal(await consent.isChecked(), false);
          assert.equal(await page.getByRole("button", { name: "Start bounded research" }).isDisabled(), true);
          await consent.check();
          await screenshot(page, "review", width);

          await page.getByRole("button", { name: "Back to scope" }).click();
          await assertFocusedHeading(page, "Set the boundaries");
          await page.reload({ waitUntil: "load" });
          await page.getByRole("heading", { name: "Set the boundaries", exact: true }).waitFor();
          assert.equal(await page.getByRole("combobox", { name: /Fixed research scope/ }).inputValue(), "2");
          assert.equal(await page.getByRole("spinbutton", { name: /Research allowance/ }).inputValue(), "0.75");
          await page.getByRole("button", { name: "Back to goal" }).click();
          assert.equal(await page.getByRole("textbox", { name: /What do you want to learn/ }).inputValue(), goal);
          assert.equal(await page.getByRole("textbox", { name: /Audience constraint/ }).inputValue(), "Adult hikers");
          await page.getByRole("button", { name: /Continue to scope/ }).click();
          await page.getByRole("button", { name: "Review research" }).click();
          assert.equal(await consent.isChecked(), false);
          await consent.check();
          await page.evaluate(nextQuote => window.__questUpdate({ quote: nextQuote }), { ...questFixtureProps.quote, two: 600001, verifiedAt: "2026-10-02T04:00:00.000Z" });
          await page.waitForFunction(() => !document.querySelector('input[name="confirmResearch"]').checked);
          assert.equal(await page.getByRole("button", { name: "Start bounded research" }).isDisabled(), true);
          assert.match(await page.locator(".questKickoffFields").textContent(), /estimate changed/);
          await consent.check();
          await page.reload({ waitUntil: "load" });
          await page.getByRole("heading", { name: "Review before research starts", exact: true }).waitFor();
          assert.equal(await consent.isChecked(), false);
          const saved = await page.evaluate(() => sessionStorage.getItem("agentlabs:research-draft:v1:quest-fixture-owner"));
          assert.doesNotMatch(saved, /consent|confirmResearch/);

          await page.evaluate(() => window.__questUpdate({ ownerId: "different-fixture-owner" }));
          await page.getByRole("heading", { name: "What would you like to learn?", exact: true }).waitFor();
          assert.notEqual(await page.getByRole("textbox", { name: /What do you want to learn/ }).inputValue(), goal);
          await page.evaluate(() => window.__questUpdate({ ownerId: "quest-fixture-owner" }));
          await page.getByRole("heading", { name: "Review before research starts", exact: true }).waitFor();
          assert.equal(await consent.isChecked(), false);
          await consent.check();
          await page.evaluate(() => { const form = document.querySelector("form"); form.requestSubmit(); form.requestSubmit(); });
          await page.waitForFunction(() => window.__questActions.length === 1);
          assert.equal(await page.getByRole("button", { name: /Reserving the research workflow/ }).isDisabled(), true);
          assert.equal(await page.getByRole("button", { name: "Back to scope" }).isDisabled(), true);
          assert.equal(await consent.isDisabled(), true);
          await page.evaluate(() => document.querySelector("form").requestSubmit());
          assert.deepEqual(await page.evaluate(() => window.__questActions), [{ businessId: questFixtureProps.businesses[0].id, goal, audienceHint: "Adult hikers", maximumCollections: "2", maximumUsd: "0.75", confirmResearch: "on" }]);
          await screenshot(page, "pending", width);
          await page.evaluate(() => window.__questResolve());
          await page.getByRole("button", { name: "Start bounded research" }).waitFor();
          assert.deepEqual(await page.evaluate(() => window.__questHydrationErrors), []);
          assert.deepEqual(errors, []);
          assert.deepEqual(externalRequests, []);
        } finally { await context.close(); }
      });
    }
  } finally { await browser.close(); }
});
