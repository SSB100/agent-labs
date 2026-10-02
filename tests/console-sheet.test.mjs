import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";
import {
  consoleSheetFixture, consoleSheetFixtureDocument, consoleSheetFixtureOrigin,
  consoleSheetOpenPath, consoleSheetStorageKey,
} from "./helpers/console-sheet-browser.mjs";

const enabled = process.env.GUIDED_UI_BROWSER === "1" || Boolean(process.env.GUIDED_UI_CHROMIUM_PATH);
const screenshots = path.resolve("test-results/guided-ui");
const documents = new Map();
const getDocument = open => {
  if (!documents.has(open)) documents.set(open, consoleSheetFixtureDocument({ open }));
  return documents.get(open);
};

test("console sheet fixture renders real command, native dialog and quest without auth or provider modules", async () => {
  const closed = await getDocument(false);
  const open = await getDocument(true);
  const markup = html => html.slice(html.indexOf("<body>"), html.indexOf("<script>"));
  assert.match(markup(closed), /class="consoleCommand"/);
  assert.match(markup(closed), /Research goal/);
  assert.doesNotMatch(markup(closed), /<dialog/);
  assert.match(markup(open), /<dialog class="consoleResearchSheet" aria-labelledby="console-research-title">/);
  assert.match(markup(open), /Find a market worth exploring/);
  assert.match(markup(open), /Nothing starts until you review and approve/);
  assert.doesNotMatch(markup(open), /<dialog[^>]*\sopen(?:[\s=>])/);
  assert.match(open, /hydrateRoot/);
  assert.match(open, /__consoleActions/);
  assert.match(open, /__consoleHydrationErrors/);
  assert.doesNotMatch(open, /https:\/\/[^"\s]*(?:supabase\.co|openrouter\.ai)|OPENROUTER_API_KEY|begin_installed_pack_run/);
  assert.equal(await consoleSheetFixtureDocument({ open: true }), open, "SSR and bundled fixture output must be deterministic");
});

async function assertOpenSheet(page) {
  const dialog = page.getByRole("dialog", { name: "Research setup", exact: true });
  await dialog.waitFor();
  await page.waitForFunction(() => {
    const dialog = document.querySelector("dialog.consoleResearchSheet");
    return dialog?.open && dialog.matches(":modal") && dialog.contains(document.activeElement);
  });
  assert.equal(page.url(), consoleSheetFixtureOrigin + consoleSheetOpenPath);
  assert.deepEqual(await page.evaluate(() => window.__consoleActions), []);
  assert.deepEqual(await page.evaluate(() => window.__consoleHydrationErrors), []);
  return dialog;
}

async function assertClosedSheet(page) {
  await page.waitForFunction(expected => location.pathname + location.search === expected && !document.querySelector("dialog"), consoleSheetFixture.returnTo);
  assert.equal(page.url(), consoleSheetFixtureOrigin + consoleSheetFixture.returnTo);
  assert.deepEqual(await page.evaluate(() => window.__consoleActions), []);
  assert.deepEqual(await page.evaluate(() => window.__consoleHydrationErrors), []);
}

async function assertFocusContained(page) {
  // A nonmodal `open` attribute would let this background button take focus.
  await page.locator("#console-sheet-background").evaluate(element => element.focus());
  assert.equal(await page.evaluate(() => document.querySelector("dialog").contains(document.activeElement)), true);
  const close = page.getByRole("button", { name: "Close research setup" });
  await close.focus();
  await page.keyboard.press("Shift+Tab");
  assert.equal(await page.evaluate(() => document.querySelector("dialog").contains(document.activeElement)), true);
  await page.keyboard.press("Tab");
  assert.equal(await close.evaluate(element => element === document.activeElement), true);
}

async function assertLayoutAndCapture(page, phase, width) {
  const result = await page.evaluate(() => {
    const dialog = document.querySelector("dialog.consoleResearchSheet");
    const body = dialog.querySelector(".consoleResearchBody");
    const rect = dialog.getBoundingClientRect();
    return {
      viewport: innerWidth, documentWidth: document.documentElement.scrollWidth,
      left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, height: innerHeight,
      dialogWidth: dialog.clientWidth, dialogScrollWidth: dialog.scrollWidth,
      bodyWidth: body.clientWidth, bodyScrollWidth: body.scrollWidth,
    };
  });
  assert.ok(result.documentWidth <= result.viewport + 1, `${phase}/${width}: page horizontal overflow ${JSON.stringify(result)}`);
  assert.ok(result.dialogScrollWidth <= result.dialogWidth + 1, `${phase}/${width}: dialog horizontal overflow ${JSON.stringify(result)}`);
  assert.ok(result.bodyScrollWidth <= result.bodyWidth + 1, `${phase}/${width}: scrollable dialog body overflows ${JSON.stringify(result)}`);
  assert.ok(result.left >= -1 && result.right <= result.viewport + 1, `${phase}/${width}: dialog exceeds viewport`);
  assert.ok(result.top >= -1 && result.bottom <= result.height + 1, `${phase}/${width}: dialog exceeds viewport height`);
  await page.locator(".consoleResearchBody").evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: path.join(screenshots, `console-sheet-${phase}-${width}.png`), animations: "disabled" });
}

async function assertSavedDraft(page, goal) {
  await page.waitForFunction(({ key, goal }) => {
    const saved = JSON.parse(sessionStorage.getItem(key) ?? "null");
    return saved?.draft.goal === goal && saved.step === 2;
  }, { key: consoleSheetStorageKey, goal });
  const saved = JSON.parse(await page.evaluate(key => sessionStorage.getItem(key), consoleSheetStorageKey));
  assert.equal(saved.ownerId, consoleSheetFixture.ownerId);
  assert.equal(saved.draft.businessId, consoleSheetFixture.businessId);
  assert.deepEqual(Object.keys(saved).sort(), ["draft", "ownerId", "reviewedEstimate", "step", "version"]);
  assert.deepEqual(Object.keys(saved.draft).sort(), ["audienceHint", "businessId", "goal", "maximumCollections", "maximumUsd"]);
  assert.doesNotMatch(JSON.stringify(saved), /consent|confirmResearch/);
}

// Hosted CI supplies pinned Chromium. Every document is fulfilled in memory;
// any other request is aborted and fails the test. No real server or credentials.
test("console research sheet preserves its same-page URL, modal focus and unapproved draft through dismissal and history", { skip: !enabled, timeout: 180_000 }, async t => {
  mkdirSync(screenshots, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.GUIDED_UI_CHROMIUM_PATH ? { executablePath: process.env.GUIDED_UI_CHROMIUM_PATH } : {}) });
  try {
    for (const width of [1440, 390, 320]) {
      await t.test(`real native-dialog lifecycle at ${width}x900`, async () => {
        const context = await browser.newContext({ viewport: { width, height: 900 }, locale: "en-NZ", timezoneId: "UTC", colorScheme: "dark", reducedMotion: "reduce", serviceWorkers: "block" });
        const externalRequests = [];
        await context.route("**/*", async route => {
          const request = route.request();
          if (request.isNavigationRequest() && [consoleSheetFixture.returnTo, consoleSheetOpenPath].some(destination => request.url() === consoleSheetFixtureOrigin + destination)) {
            return route.fulfill({ status: 200, contentType: "text/html", body: await getDocument(request.url() === consoleSheetFixtureOrigin + consoleSheetOpenPath) });
          }
          externalRequests.push(request.url());
          return route.abort();
        });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
        try {
          await page.goto(consoleSheetFixtureOrigin + consoleSheetFixture.returnTo, { waitUntil: "load" });
          await page.waitForFunction(() => window.__consoleHydrated);
          assert.equal(await page.getByRole("dialog").count(), 0);
          const command = page.getByRole("textbox", { name: "Research goal", exact: true });
          const opener = page.getByRole("button", { name: /Review goal/ });
          const initialGoal = "Compare geographic markets for original hiking T-shirts.";
          await command.fill(`  ${initialGoal}  `);
          await opener.focus();
          await page.keyboard.press("Enter");
          await assertOpenSheet(page);
          assert.deepEqual(await page.evaluate(() => window.__consoleNavigations), [{ destination: consoleSheetOpenPath, options: { scroll: false } }]);
          const goalField = page.getByRole("textbox", { name: /What do you want to learn/ });
          await page.waitForFunction(expected => document.querySelector('textarea[name="goal"]')?.value === expected, initialGoal);
          assert.equal(await goalField.inputValue(), initialGoal);
          await assertFocusContained(page);
          await assertLayoutAndCapture(page, "goal", width);

          const editedGoal = "Compare original nature T-shirt markets for adult hikers in New Zealand and Australia.";
          await goalField.fill(editedGoal);
          await page.getByRole("button", { name: /Continue to scope/ }).click();
          await page.getByRole("button", { name: /Review research/ }).click();
          const consent = page.getByRole("checkbox", { name: /I approve only this bounded research/ });
          assert.equal(await consent.isChecked(), false);
          assert.equal(await page.getByRole("button", { name: "Start bounded research" }).isDisabled(), true);
          await consent.check();
          assert.equal(await page.getByRole("button", { name: "Start bounded research" }).isEnabled(), true);
          await assertSavedDraft(page, editedGoal);
          await assertLayoutAndCapture(page, "review", width);
          await page.getByRole("button", { name: "Close research setup" }).click();
          await assertClosedSheet(page);
          assert.equal(await opener.evaluate(element => element === document.activeElement), true);
          assert.deepEqual(await page.evaluate(() => window.__consoleNavigations.at(-1)), { destination: consoleSheetFixture.returnTo, options: { scroll: false } });

          // An empty command reopens the saved draft instead of submitting a
          // replacement goal. Test this without reloading the console first.
          await command.fill("");
          await opener.click();
          await assertOpenSheet(page);
          await page.getByRole("heading", { name: "Review before research starts", exact: true }).waitFor();
          assert.ok((await page.locator(".questKickoffReview").textContent()).includes(editedGoal));
          assert.equal(await consent.isChecked(), false);
          await assertSavedDraft(page, editedGoal);
          await page.keyboard.press("Escape");
          await assertClosedSheet(page);

          // A fresh page clears the command input but restores the wizard draft.
          await page.reload({ waitUntil: "load" });
          await page.waitForFunction(() => window.__consoleHydrated);
          assert.equal(await command.inputValue(), "");
          await opener.click();
          await assertOpenSheet(page);
          await page.getByRole("heading", { name: "Review before research starts", exact: true }).waitFor();
          assert.ok((await page.locator(".questKickoffReview").textContent()).includes(editedGoal));
          assert.equal(await consent.isChecked(), false);
          assert.equal(await page.getByRole("button", { name: "Start bounded research" }).isDisabled(), true);
          await assertSavedDraft(page, editedGoal);

          await page.keyboard.press("Escape");
          await assertClosedSheet(page);
          assert.equal(await opener.evaluate(element => element === document.activeElement), true);
          assert.deepEqual(await page.evaluate(() => window.__consoleNavigations.at(-1)), { destination: consoleSheetFixture.returnTo, options: { scroll: false } });

          // Browser history traverses actual pushState entries and remounts the
          // real dialog. No test-only open/close implementation is involved.
          await page.goBack();
          await assertOpenSheet(page);
          await consent.waitFor();
          assert.equal(await consent.isChecked(), false);
          await page.goForward();
          await assertClosedSheet(page);
          await opener.click();
          await assertOpenSheet(page);
          await consent.waitFor();
          await consent.check();
          await page.reload({ waitUntil: "load" });
          await page.waitForFunction(() => window.__consoleHydrated);
          await assertOpenSheet(page);
          await consent.waitFor();
          assert.equal(await consent.isChecked(), false);
          await assertSavedDraft(page, editedGoal);
          await assertFocusContained(page);
          await assertLayoutAndCapture(page, "restored", width);
          await page.keyboard.press("Escape");
          await assertClosedSheet(page);
          assert.deepEqual(await page.evaluate(() => window.__consoleHydrationErrors), []);
          assert.deepEqual(errors, []);
          assert.deepEqual(externalRequests, []);
        } finally { await context.close(); }
      });
    }
  } finally { await browser.close(); }
});
