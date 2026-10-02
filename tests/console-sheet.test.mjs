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
  assert.match(markup(open), /<dialog class="consoleResearchSheet" aria-labelledby="console-research-title" aria-busy="false">/);
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
  const trace = [];
  const controls = 'button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), a[href]';
  await page.evaluate(() => {
    window.__consoleOutsideFocus = [];
    window.__consoleCaptureFocus = event => {
      const dialog = document.querySelector("dialog");
      if (!dialog?.contains(event.target) && event.target !== document.body && event.target !== document.documentElement) {
        window.__consoleOutsideFocus.push(event.target.outerHTML?.slice(0, 800));
      }
    };
    document.addEventListener("focusin", window.__consoleCaptureFocus, true);
  });
  async function check(label, allowViewport = false) {
    const state = await page.evaluate(controls => {
      const dialog = document.querySelector("dialog");
      const active = document.activeElement;
      return {
        open: dialog?.open, modal: dialog?.matches(":modal"), inside: dialog?.contains(active),
        viewportFallback: active === document.body || active === document.documentElement || active === null,
        documentHasFocus: document.hasFocus(), activeElement: active?.outerHTML.slice(0, 800) ?? null,
        controlIndex: [...dialog.querySelectorAll(controls)].indexOf(active),
        outsideFocusEvents: window.__consoleOutsideFocus,
      };
    }, controls);
    trace.push({ label, ...state });
    const diagnostics = JSON.stringify(trace);
    assert.ok(state.open && state.modal, `Native modality was lost: ${diagnostics}`);
    assert.deepEqual(state.outsideFocusEvents, [], `Background page content received focus: ${diagnostics}`);
    assert.ok(state.inside || (allowViewport && state.viewportFallback), `Focus escaped to page content: ${diagnostics}`);
    return state;
  }
  const close = page.getByRole("button", { name: "Close research setup" });
  try {
    await close.focus();
    // Native modality makes every background control inert, including direct
    // focus() calls. A dialog with only the `open` attribute fails these checks.
    for (const selector of ["#console-sheet-background", ".consoleCommand input", ".consoleCommand button"]) {
      await page.locator(selector).evaluate(element => element.focus());
      await check(`programmatic background focus: ${selector}`);
    }
    await page.keyboard.press("Shift+Tab");
    // Sequential navigation may visit browser UI at the document boundary.
    // Only the viewport's body/html fallback is allowed outside the modal, never
    // a background page control. Tab must return to the dialog's Close control.
    // https://html.spec.whatwg.org/multipage/interaction.html#sequential-focus-navigation
    await check("reverse-tab boundary", true);
    await page.keyboard.press("Tab");
    await check("return from reverse-tab boundary");
    assert.equal(await close.evaluate(element => element === document.activeElement), true, `Tab did not return to Close: ${JSON.stringify(trace)}`);

    const count = await page.locator("dialog").locator(controls).count();
    const visited = new Set([0]);
    let returned = false;
    for (let step = 0; step < count + 2; step++) {
      await page.keyboard.press("Tab");
      const state = await check(`forward cycle ${step + 1}`, true);
      if (state.controlIndex >= 0) visited.add(state.controlIndex);
      if (state.controlIndex === 0) { returned = true; break; }
    }
    assert.ok(returned, `Keyboard cycle did not return to Close: ${JSON.stringify(trace)}`);
    assert.equal(visited.size, count, `Keyboard cycle skipped an enabled dialog control: ${JSON.stringify(trace)}`);
  } finally {
    await page.evaluate(() => document.removeEventListener("focusin", window.__consoleCaptureFocus, true));
  }
}

async function assertLayoutAndCapture(page, phase, width) {
  // Preserve real pixels even if a later layout or focus assertion fails.
  await page.locator(".consoleResearchBody").evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: path.join(screenshots, `console-sheet-${phase}-${width}.png`), animations: "disabled" });
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
          await assertLayoutAndCapture(page, "goal", width);
          await assertFocusContained(page);

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
          await assertLayoutAndCapture(page, "restored", width);
          await assertFocusContained(page);
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
