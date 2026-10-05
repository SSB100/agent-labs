import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";
import { contract, id } from "./helpers/console-browser-fixtures.mjs";
import { consoleBrowserFixture, consoleBrowserFixtureDocument, consoleBrowserOrigin, consoleBrowserStartPath } from "./helpers/console-browser-hydration.mjs";

const enabled = process.env.GUIDED_UI_BROWSER === "1" || Boolean(process.env.GUIDED_UI_CHROMIUM_PATH);
test("console browser fixture bundles real compact metadata UI with synthetic owner records only", async () => {
  const html = await consoleBrowserFixtureDocument();
  assert.match(html, /hydrateRoot/); assert.match(html, /__browserHydrationErrors/);
  assert.doesNotMatch(html, /https:\/\/[^"\s]*(?:supabase\.co|api\.steel\.dev|app\.steel\.dev)|STEEL_API_KEY|ACCOUNTS_VAULT_KEY|get_browser_session_live_view|<iframe/);
  assert.match(html, /Live viewing unavailable for this session/);
});

test("metadata-only Browser fits the actual centre and stays inert across URL history, reload and forged states", { skip: !enabled }, async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.GUIDED_UI_CHROMIUM_PATH ? { executablePath: process.env.GUIDED_UI_CHROMIUM_PATH } : {}) });
  try {
    for (const [width, height, panelHeight] of [[1200, 700, 240], [1440, 900, 318], [390, 844, 400]]) {
      const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block" });
      const unexpected = [], errors = [];
      const page = await context.newPage();
      page.on("pageerror", error => errors.push(error.message));
      await context.route("**/*", async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin === consoleBrowserOrigin && request.method() === "GET" && url.pathname === "/dashboard") return route.fulfill({ contentType: "text/html", body: await consoleBrowserFixtureDocument(url.pathname + url.search) });
        unexpected.push(request.url()); return route.abort();
      });
      const inert = async () => {
        assert.equal(await page.locator("iframe,object,embed,video").count(), 0);
        assert.deepEqual(await page.evaluate(() => window.__browserFetches), []);
        assert.deepEqual(unexpected, []);
      };
      const blocked = async () => {
        await page.getByText(contract.CONSOLE_BROWSER_UNAVAILABLE, { exact: true }).waitFor();
        await inert();
      };
      await page.goto(consoleBrowserOrigin + consoleBrowserStartPath);
      await page.waitForFunction(() => window.__browserHydrated);
      await inert();
      const originalOrb = await page.locator(".consoleCoreOrb").boundingBox();
      await page.getByRole("link", { name: "Browser", exact: true }).focus(); await page.keyboard.press("Enter");
      await blocked();
      assert.equal(await page.locator(".consoleCoreVisual").count(), 0);
      assert.equal(new URL(page.url()).searchParams.get("centre"), "browser");
      assert.equal(await page.getByRole("link", { name: "Inspect saved workflow record" }).getAttribute("href"), `/dashboard?view=work&run=${id(3)}&business=${id(2)}`);
      const panel = await page.locator(".consoleBrowserFixturePanel").boundingBox();
      const body = await page.locator(".consoleBrowserContent").boundingBox();
      const blocker = await page.locator(".consoleBrowserUnavailable").boundingBox();
      assert.ok(Math.abs(panel.height - panelHeight) <= 1, `Exact integrated height at ${width}`);
      assert.ok(body.width > 250 && body.height > 100, `Metadata occupies the compact panel: ${JSON.stringify({ width, body, panel })}`);
      assert.ok(body.y + body.height <= panel.y + panel.height - 1, "Body stays inside the existing centre");
      assert.ok(blocker.y >= body.y && blocker.y + blocker.height <= body.y + body.height, "Privacy blocker is visible without scrolling");
      assert.equal(await page.locator(".consoleBrowserEmpty").evaluate(element => element.scrollHeight <= element.clientHeight + 1), true, "Compact summary fits without clipped text");
      const controls = await page.locator(".consoleCentreTabs a,.consoleBrowserTools>a,.consoleBrowserTools summary").evaluateAll(elements => elements.map(element => ({ height: element.getBoundingClientRect().height, font: parseFloat(getComputedStyle(element).fontSize) })));
      for (const control of controls) { assert.ok(control.height >= (width > 900 ? 24 : 44)); assert.ok(control.font >= 12); }
      const fonts = await page.locator(".consoleBrowserEmpty p,.consoleBrowserEmpty strong,.consoleBrowserToolbar>strong").evaluateAll(elements => elements.map(element => parseFloat(getComputedStyle(element).fontSize)));
      assert.ok(fonts.every(font => font >= 12));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const directory = path.resolve("test-results/guided-ui");
      mkdirSync(directory, { recursive: true });
      await page.screenshot({ path: path.join(directory, `browser-metadata-centre-${width}.png`), fullPage: true });
      await page.reload(); await page.waitForFunction(() => window.__browserHydrated); await blocked();
      assert.equal(new URL(page.url()).searchParams.get("browserRun"), id(3));
      await page.getByRole("link", { name: "Overview", exact: true }).click();
      await page.locator(".consoleCoreVisual").waitFor(); await inert();
      assert.deepEqual(await page.locator(".consoleCoreOrb").boundingBox(), originalOrb, "Toggle preserves original orb geometry");
      await page.goBack(); await blocked();
      await page.goForward(); await page.locator(".consoleCoreVisual").waitFor(); await inert();
      for (let n = 0; n < 3; n++) {
        await page.getByRole("link", { name: "Browser", exact: true }).click(); await blocked();
        await page.getByRole("link", { name: "Overview", exact: true }).click(); await page.locator(".consoleCoreVisual").waitFor(); await inert();
      }
      await page.getByRole("link", { name: "Browser", exact: true }).click(); await blocked();
      for (const savedStatus of [...contract.CONSOLE_BROWSER_STATUSES, "viewable", "expired", "disconnected", "unknown"]) {
        await page.evaluate(({ fixture, savedStatus }) => window.__browserReplaceData({ ...fixture, sessions: fixture.sessions.map(item => ({ ...item, savedStatus, state: "viewable", viewerUrl: "https://fixture-invalid.test/private", debugUrl: "FIXTURE_PRIVATE_VALUE" })) }), { fixture: consoleBrowserFixture, savedStatus });
        const expected = contract.consoleBrowserStatus(savedStatus).replaceAll("_", " ");
        await page.getByText(`Recorded session state: ${expected}`, { exact: true }).waitFor(); await blocked();
        assert.equal(await page.getByRole("button", { name: /retry|approve/i }).count(), 0);
        assert.doesNotMatch(await page.locator(".consoleBrowserContent").innerHTML(), /FIXTURE_PRIVATE_VALUE|fixture-invalid/);
      }
      await page.evaluate(() => { dispatchEvent(new Event("offline")); document.dispatchEvent(new Event("visibilitychange")); });
      await blocked();
      await page.evaluate(fixture => window.__browserReplaceData(fixture), consoleBrowserFixture);
      await page.getByText("Context", { exact: true }).click();
      await page.getByLabel("Business", { exact: true }).selectOption(id(5));
      await page.getByRole("button", { name: "Choose Business" }).click();
      await page.waitForFunction(() => window.__browserHydrated && new URL(location.href).searchParams.get("business") === "00000000-0000-4000-8000-000000000005");
      assert.equal(new URL(page.url()).searchParams.has("browserRun"), false);
      await page.getByText("No browser sessions recorded", { exact: true }).waitFor(); await blocked();
      assert.deepEqual(await page.evaluate(() => window.__browserHydrationErrors), []);
      assert.deepEqual(errors, []); await inert();
      await context.close();
    }
  } finally { await browser.close(); }
});
