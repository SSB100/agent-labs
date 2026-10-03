import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";
import { contract, id } from "./helpers/console-browser-fixtures.mjs";
import { run } from "./helpers/guided-ui.mjs";
import { rootBrowserDocument, rootBrowserMode, rootBrowserOrigin as origin, rootBrowserPage, rootBrowserStart } from "./helpers/console-root-browser.mjs";

test("real root Browser uses the owner-scoped metadata reader and sanitizes the hydrated props", async () => {
  const fixture = await rootBrowserPage(rootBrowserMode);
  assert.equal(fixture.state.overview.centreMode, "browser");
  assert.equal(fixture.state.overview.browserData.selectedSession.workflowRunId, run.id);
  assert.equal(fixture.state.overview.browserData.selectedSession.businessId, id(2));
  assert.equal((fixture.markup.match(/aria-label="Centre view"/g) ?? []).length, 1, "Integrated Overview owns exactly one toggle");
  assert.match(fixture.markup, /Recorded session state: live/);
  assert.match(fixture.markup, /privacy-safe viewer contract is not yet implemented/);
  for (const read of fixture.reads.filter(read => typeof read === "object")) {
    assert.ok(["browser_sessions", "workflow_runs"].includes(read.table));
    assert.ok(read.filters.some(([key, value]) => key === "business_id" && value === id(2)), "Every metadata query keeps the owned Business");
    assert.doesNotMatch(read.select, /provider|metadata|page_title|current_url|secret/);
  }
  const html = await rootBrowserDocument(rootBrowserMode);
  assert.doesNotMatch(html, /PRIVATE_SYNTHETIC_|private-fixture|<iframe|<video|<object|<embed|api\.steel\.dev|get_browser_session_live_view/);
  assert.match(html, /hydrateRoot/); assert.match(html, /r08OverviewWorkspace/);
  const noEpisode = await rootBrowserDocument(contract.consoleBrowserHref("browser", id(5)));
  assert.match(noEpisode, /No workflow episode exists for this Quest/); assert.doesNotMatch(noEpisode, /Recorded session state: live/);
});

test("Browser root keeps query context through research and refuses foreign, malformed or unavailable selections", async () => {
  const sheet = await rootBrowserPage(rootBrowserMode + "&sheet=research");
  const returnQuery = new URL(sheet.state.sheet.returnTo, origin).searchParams;
  assert.equal(returnQuery.get("centre"), "browser"); assert.equal(returnQuery.get("business"), id(2)); assert.equal(returnQuery.get("browserRun"), run.id);
  assert.deepEqual(Array.from(sheet.state.sheet.quest.businesses, business => business.id), [id(2)]);
  assert.equal(sheet.state.command.returnTo, sheet.state.sheet.returnTo);
  const unavailable = await rootBrowserPage(rootBrowserMode, { unavailable: true });
  assert.equal(unavailable.state.overview.browserData.status, "unavailable");
  assert.doesNotMatch(unavailable.markup, /Inspect saved workflow record/);
  await assert.rejects(() => rootBrowserPage(contract.consoleBrowserHref("browser", id(5), run.id)), /Fixture record was not found/);
  await assert.rejects(() => rootBrowserPage("/dashboard?view=overview&centre=browser&browserRun=malformed"), /Fixture record was not found/);
  await assert.rejects(() => rootBrowserPage(`/dashboard?view=overview&centre=browser&business=${id(999)}`), /Fixture record was not found/);
});

const enabled = process.env.GUIDED_UI_BROWSER === "1" || Boolean(process.env.GUIDED_UI_CHROMIUM_PATH);
test("real root Browser toggle, saved record, history, context and research dismissal remain scoped and read-only", { skip: !enabled, timeout: 180_000 }, async t => {
  const browser = await chromium.launch({ headless: true, ...(process.env.GUIDED_UI_CHROMIUM_PATH ? { executablePath: process.env.GUIDED_UI_CHROMIUM_PATH } : {}) });
  const directory = path.resolve("test-results/guided-ui"); mkdirSync(directory, { recursive: true });
  try {
    for (const [width, height] of [[1440, 900], [1200, 700], [900, 768], [390, 1000], [320, 1000]]) await t.test(`${width}px integrated Browser journey`, async () => {
      const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce", serviceWorkers: "block" });
      const unexpected = [], errors = [];
      await context.route("**/*", async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin === origin && url.pathname === "/dashboard" && request.method() === "GET" && request.resourceType() === "document") return route.fulfill({ contentType: "text/html", body: await rootBrowserDocument(url.pathname + url.search) });
        unexpected.push(request.url()); return route.abort();
      });
      const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
      const hydrated = () => page.waitForFunction(() => window.__rootBrowserHydrated);
      const inert = async () => {
        assert.equal(await page.locator("iframe,video,object,embed").count(), 0);
        assert.equal(await page.evaluate(() => sessionStorage.getItem("root-browser-paid-call")), null);
        assert.deepEqual(await page.evaluate(() => window.__rootBrowserErrors), []);
        assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
      };
      try {
        await page.goto(origin + rootBrowserStart); await hydrated();
        const orb = await page.locator(".consoleCoreOrb").boundingBox();
        await page.getByRole("link", { name: "Browser", exact: true }).focus(); await page.keyboard.press("Enter");
        await page.waitForURL(origin + rootBrowserMode); await hydrated();
        await page.getByText(contract.CONSOLE_BROWSER_UNAVAILABLE, { exact: true }).waitFor();
        assert.equal(await page.locator(".consoleCoreVisual").count(), 0);
        assert.equal(await page.getByRole("navigation", { name: "Centre view" }).count(), 1);
        const record = `/dashboard?view=work&run=${run.id}&business=${id(2)}`;
        assert.equal(await page.getByRole("link", { name: "Inspect saved workflow record" }).getAttribute("href"), record);
        const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, inner: innerWidth }));
        assert.ok(dimensions.width <= width + 1);
        if (width > 900) assert.ok(dimensions.height <= height + 1);
        const targets = await page.locator(".consoleCentreTabs a,.consoleBrowserTools>a,.consoleBrowserTools summary").evaluateAll(elements => elements.map(element => ({ text: element.textContent, width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height })));
        for (const target of targets) assert.ok(Math.min(target.width, target.height) >= (width <= 900 ? 44 : 24), JSON.stringify(target));
        await page.screenshot({ path: path.join(directory, `console-browser-root-${width}.png`), fullPage: true });
        await page.getByRole("link", { name: "Inspect saved workflow record" }).click(); await page.waitForURL(origin + record); await hydrated();
        assert.match(await page.locator(".consoleWorkspaceContext").innerText(), /Synthetic Browser Studio/);
        await page.goBack(); await page.waitForURL(origin + rootBrowserMode); await hydrated();
        await page.reload(); await hydrated(); await inert();
        await page.locator(".consoleCentreTabs").getByRole("link", { name: "Overview", exact: true }).click(); await page.waitForURL(origin + rootBrowserStart); await hydrated();
        assert.deepEqual(await page.locator(".consoleCoreOrb").boundingBox(), orb);
        await page.goBack(); await page.waitForURL(origin + rootBrowserMode); await hydrated();
        await page.goForward(); await page.waitForURL(origin + rootBrowserStart); await hydrated();
        await page.getByRole("link", { name: "Browser", exact: true }).click(); await hydrated();
        await page.getByText("Context", { exact: true }).click();
        await page.getByLabel("Business", { exact: true }).selectOption(id(5));
        await page.getByRole("button", { name: "Choose Business", exact: true }).click();
        await page.waitForURL(url => url.searchParams.get("business") === id(5)); await hydrated();
        assert.equal(new URL(page.url()).searchParams.has("browserRun"), false);
        await page.getByText("No workflow episode exists for this Quest.", { exact: true }).waitFor();
        const returnTo = await page.evaluate(() => window.__rootBrowserState.command.returnTo);
        assert.equal(new URL(returnTo, origin).searchParams.get("centre"), "browser");
        assert.equal(new URL(returnTo, origin).searchParams.get("business"), id(5));
        const goal = "Research original products using the current authorized Business.";
        await page.locator("#console-command-input").fill(goal); await page.locator(".consoleCommand button").click();
        await page.waitForURL(origin + returnTo + "&sheet=research"); await hydrated();
        const dialog = page.getByRole("dialog", { name: "Research setup", exact: true }); await dialog.waitFor();
        assert.equal(await dialog.getByRole("combobox", { name: "Business context", exact: true }).inputValue(), id(5));
        assert.equal(await dialog.locator('textarea[name="goal"]').inputValue(), goal);
        assert.equal(await dialog.locator('input[name="confirmResearch"]:checked').count(), 0);
        await page.screenshot({ path: path.join(directory, `console-browser-root-research-${width}.png`), fullPage: true });
        await page.keyboard.press("Escape"); await page.waitForURL(origin + returnTo); await hydrated();
        await page.getByText("No workflow episode exists for this Quest.", { exact: true }).waitFor();
        await page.reload(); await hydrated();
        assert.equal(new URL(page.url()).searchParams.get("business"), id(5));
        assert.equal(new URL(page.url()).searchParams.get("centre"), "browser"); await inert();
      } finally { await context.close(); }
    });
  } finally { await browser.close(); }
});
