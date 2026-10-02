import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";
import { businessFlow, businessFixtureDocument } from "./helpers/console-business-browser.mjs";
import { business, components, ownerContext, renderCreative, renderDashboard } from "./helpers/guided-ui.mjs";

let documents;
function loadDocuments() {
  if (!documents) documents = Promise.all([
    businessFixtureDocument("work", { detail: true, omitBusinessQuery: true }),
    businessFixtureDocument("library"), businessFixtureDocument("connections"), businessFixtureDocument("connections", { sheet: true }),
  ]).then(([work, library, connections, sheet]) => new Map([[businessFlow.work, work], [businessFlow.library, library], [businessFlow.connections, connections], [businessFlow.sheet, sheet]]));
  return documents;
}

test("real B-run routing preserves the authorized Business in root navigation, data panes and research props", async () => {
  const docs = await loadDocuments();
  for (const [url, fixture] of docs) {
    assert.equal(fixture.command.businessId, businessFlow.businessId, url);
    assert.ok(fixture.command.returnTo.includes(`business=${businessFlow.businessId}`), url);
    const nav = fixture.markup.match(/<nav class="consoleNavigation"[^>]*>(.*?)<\/nav>/s)?.[1];
    assert.ok(nav);
    for (const view of ["library", "connections"]) assert.ok(nav.includes(`/dashboard?view=${view}&amp;business=${businessFlow.businessId}`), `${url} ${view}`);
    assert.ok(fixture.markup.includes(businessFlow.name), url);
  }
  const sheet = docs.get(businessFlow.sheet).markup;
  assert.match(sheet, /value="fixture-other-business" selected=""/);
  assert.doesNotMatch(sheet, /name="confirmResearch"/);
});

test("overview research and connection shortcuts preserve the selected Business", async () => {
  const markup = await renderDashboard({ view: "overview", businessFlow: true });
  const quick = markup.match(/<nav class="consoleQuickCommands[^"]*"[^>]*>(.*?)<\/nav>/s)?.[1];
  assert.ok(quick);
  assert.ok(quick.includes(`/dashboard?view=overview&amp;business=${businessFlow.businessId}&amp;sheet=research`));
  const connections = markup.match(/<section[^>]*data-console-panel="connections"[\s\S]*?<\/section>/)?.[0];
  assert.ok(connections);
  const links = [...connections.matchAll(/href="([^"]+)"/g)].map(match => match[1]);
  assert.ok(links.length >= 3, "Manage and both connection cards are present");
  assert.ok(links.every(href => href === `/dashboard?view=connections&amp;business=${businessFlow.businessId}`));
});

test("Work pane header research and All work links retain Business B", async () => {
  const list = await renderDashboard({ view: "work", businessFlow: true });
  const detail = await renderDashboard({ view: "work", detail: true, businessFlow: true, omitBusinessQuery: true });
  assert.ok(list.includes(`href="/dashboard?view=work&amp;business=${businessFlow.businessId}&amp;sheet=research"`));
  assert.ok(detail.includes(`href="/dashboard?view=work&amp;business=${businessFlow.businessId}">All work</a>`));
});

test("protected route AppShell forwards only an authorized Business to console destinations", () => {
  const { shell } = components();
  const context = ownerContext({ businesses: [business, { ...business, id: businessFlow.businessId, name: businessFlow.name }] });
  const render = id => renderToStaticMarkup(React.createElement(shell.AppShell, { active: "accounts", context, navigationBusinessId: id }, React.createElement("h1", null, "Protected account detail")));
  const markup = render(businessFlow.businessId);
  for (const view of ["overview", "library", "connections", "work"]) assert.ok(markup.includes(`/dashboard?view=${view}&amp;business=${businessFlow.businessId}`));
  assert.doesNotMatch(render("not-owned"), /business=not-owned/);
  for (const page of ["accounts", "accounts/registration", "accounts/password", "accounts/secure", "artifacts", "products", "printful", "etsy"]) {
    const source = readFileSync(`src/app/dashboard/${page}/page.tsx`, "utf8");
    assert.match(source, /<AppShell[^>]*navigationBusinessId=/, `${page} must pass its validated Business to the shared shell`);
  }
});

test("protected Artifacts and Printful evidence links preserve Business selection", async () => {
  const markup = await renderCreative({ businessFlow: true });
  assert.ok(markup.includes(`href="/dashboard/products?business=${businessFlow.businessId}"`));
  assert.ok(markup.includes(`/dashboard?view=connections&amp;business=${businessFlow.businessId}`));
  const select = markup.match(/<select name="businessId"[^>]*>(.*?)<\/select>/s)?.[1];
  assert.ok(select?.includes(`value="${businessFlow.businessId}"`));
  assert.ok(!select?.includes('value="fixture-business"'));
  const printful = readFileSync("src/app/dashboard/printful/page.tsx", "utf8");
  assert.ok(printful.includes('href={`/dashboard/products${business ? `?business=${business.id}` : ""}`}'));
  assert.ok(printful.includes('href={`/dashboard/artifacts${business ? `?business=${business.id}` : ""}`}'));
});

const enabled = process.env.GUIDED_UI_BROWSER === "1" || Boolean(process.env.GUIDED_UI_CHROMIUM_PATH);
test("B run to Library to Connections to hydrated research keeps B without provider actions", { skip: !enabled, timeout: 120_000 }, async t => {
  const docs = await loadDocuments();
  const directory = path.resolve("test-results/guided-ui");
  mkdirSync(directory, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.GUIDED_UI_CHROMIUM_PATH ? { executablePath: process.env.GUIDED_UI_CHROMIUM_PATH } : {}) });
  try {
    for (const width of [1440, 390, 320]) await t.test(`${width}px Business continuity`, async () => {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce", serviceWorkers: "block" });
      const unexpected = [];
      await context.route("**/*", route => {
        const url = new URL(route.request().url());
        const document = url.origin === businessFlow.origin ? docs.get(url.pathname + url.search) : undefined;
        if (document) return route.fulfill({ status: 200, contentType: "text/html", body: document.html });
        unexpected.push(url.toString()); return route.abort();
      });
      const page = await context.newPage();
      try {
        await page.goto(businessFlow.origin + businessFlow.work);
        await page.waitForFunction(() => window.__businessHydrated);
        await page.locator(`.consoleNavLink[href='${businessFlow.library}']`).click();
        await page.waitForURL(businessFlow.origin + businessFlow.library);
        assert.ok((await page.locator(".consolePaneHeader").innerText()).includes(businessFlow.name));
        await page.locator(`.consoleNavLink[href='${businessFlow.connections}']`).click();
        await page.waitForURL(businessFlow.origin + businessFlow.connections);
        await page.waitForFunction(() => window.__businessHydrated);
        assert.equal(await page.locator(".accountProfileForm input[name=businessId]").inputValue(), businessFlow.businessId);
        const goal = "Compare original hiking shirts in the approved geographic markets for this Business.";
        await page.locator("#console-command-input").fill(goal);
        await page.locator(".consoleCommand button").click();
        await page.waitForURL(businessFlow.origin + businessFlow.sheet);
        const dialog = page.getByRole("dialog", { name: "Research setup", exact: true });
        await dialog.waitFor();
        await page.waitForFunction(() => document.querySelector("dialog")?.matches(":modal"));
        await page.screenshot({ path: path.join(directory, `business-B-research-${width}.png`), animations: "disabled" });
        assert.deepEqual(await page.evaluate(() => window.__businessHydrationErrors), []);
        assert.equal(await dialog.getByRole("combobox", { name: /Business context/ }).inputValue(), businessFlow.businessId);
        assert.equal(await dialog.locator('select[name="businessId"] option').count(), 1);
        assert.equal(await dialog.locator('textarea[name="goal"]').inputValue(), goal);
        assert.equal(await page.evaluate(() => sessionStorage.getItem("fixture-paid-call")), null);
        assert.deepEqual(await page.evaluate(() => window.__businessHydrationErrors), []);
        await page.screenshot({ path: path.join(directory, `business-B-research-${width}.png`), animations: "disabled" });
        await dialog.getByRole("button", { name: "Close research setup", exact: true }).click();
        await page.waitForURL(businessFlow.origin + businessFlow.connections);
        assert.equal(await page.locator(".accountProfileForm input[name=businessId]").inputValue(), businessFlow.businessId);
        assert.deepEqual(unexpected, []);
      } finally { await context.close(); }
    });
  } finally { await browser.close(); }
});
