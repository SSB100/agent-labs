import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";
import { connectionContract, connectionFixture as fixture, connectionsDocument, connectionsPage, connectionsReturn, connectionsSecure, connectionsStart, connectionsWorkspace, legacyConnectionsRedirect } from "./helpers/console-connections.mjs";

const { origin, businessId, runId, token } = fixture;
const plain = value => JSON.parse(JSON.stringify(value));

test("connection returns canonicalize only the same Business and selected connection request without accepting redirect input", () => {
  const href = connectionContract.accountReturnHref(businessId, { returnTo: connectionsStart + "&credential=private&storeId=987", runId, provider: "printful", message: "verified" });
  const url = new URL(href, origin);
  assert.deepEqual(Object.fromEntries(url.searchParams), { view: "connections", business: businessId, provider: "printful", connectionRun: runId, accountMessage: "verified" });
  assert.equal(url.hash, "#connection-notice");
  for (const returnTo of ["https://evil.invalid/dashboard?business=" + businessId, "//evil.invalid/dashboard?business=" + businessId, `/dashboard?view=connections&business=${fixture.otherBusinessId}&connectionRun=${runId}`, `/dashboard/accounts?business=${businessId}`, "javascript:alert(1)"]) {
    const redirected = new URL(connectionContract.accountReturnHref(businessId, { returnTo }), origin);
    assert.equal(redirected.origin, origin); assert.equal(redirected.pathname, "/dashboard");
    assert.deepEqual(Object.fromEntries(redirected.searchParams), { view: "connections", business: businessId });
  }
});


test("return scope rejects duplicate keys and foreign views and never promotes the Work run namespace", () => {
  const clean = `/dashboard?view=connections&business=${businessId}&connectionRun=${runId}&provider=printful`;
  for (const returnTo of [
    clean + "&view=connections", clean + `&business=${businessId}`, clean + `&connectionRun=${runId}`, clean + "&provider=printful",
    clean.replace("view=connections", "view=work"), clean.replace("view=connections", "view=overview"), clean.replace("view=connections&", ""),
  ]) {
    const query = new URL(connectionContract.accountReturnHref(businessId, { returnTo }), origin).searchParams;
    assert.deepEqual(Object.fromEntries(query), { view: "connections", business: businessId }, returnTo);
  }
  const workRun = new URL(connectionContract.accountReturnHref(businessId, { returnTo: `/dashboard?view=connections&business=${businessId}&run=${runId}&provider=printful` }), origin);
  assert.equal(workRun.searchParams.has("run"), false); assert.equal(workRun.searchParams.has("connectionRun"), false);
  const override = new URL(connectionContract.accountReturnHref(businessId, { returnTo: clean, runId: fixture.connectionId }), origin);
  assert.equal(override.searchParams.get("connectionRun"), fixture.connectionId);
});

test("legacy Accounts canonicalizes setup-run links without running diagnostic or provider reads", async () => {
  const result = await legacyConnectionsRedirect({ business: businessId, run: runId, provider: "printful", accountMessage: "approved" });
  const url = new URL(result.href, origin);
  assert.equal(url.pathname, "/dashboard"); assert.equal(url.searchParams.get("view"), "connections");
  assert.equal(url.searchParams.get("business"), businessId); assert.equal(url.searchParams.get("connectionRun"), runId);
  assert.equal(url.searchParams.has("run"), false); assert.equal(url.searchParams.get("accountMessage"), "approved");
  assert.equal(url.hash, "#connection-notice"); assert.deepEqual(result.reads, []);
  await assert.rejects(legacyConnectionsRedirect({ business: "10000000-0000-4000-8000-999999999999", run: runId }), /Fixture record was not found/);
  const malformed = await legacyConnectionsRedirect({ business: businessId, run: "malformed" });
  assert.equal(new URL(malformed.href, origin).searchParams.has("connectionRun"), false);
  const missing = await legacyConnectionsRedirect({ business: businessId, run: fixture.connectionId });
  assert.equal(new URL(missing.href, origin).searchParams.get("connectionRun"), fixture.connectionId);
  assert.deepEqual(missing.reads, []);
  const secure = await connectionsPage(`/dashboard/accounts/secure?business=${businessId}&run=${runId}&returnTo=${encodeURIComponent(`/dashboard?view=work&business=${businessId}&run=${runId}`)}`);
  const target = new URL(secure.islands.find(island => island.name === "PrintfulSecureForm").props.returnTo, origin);
  assert.equal(target.searchParams.has("run"), false); assert.equal(target.searchParams.get("connectionRun"), runId);
});

test("legacy platform notices preserve their explicit diagnostics destination and whitelist query data", async () => {
  for (const values of [{ message: "browser-workflow-started" }, { error: "browser-provider-not-configured" }, { message: "browser-planner-workflow-started", error: "browser-planner-launch-failed" }]) {
    const result = await legacyConnectionsRedirect({ business: businessId, run: runId, credential: "never-retain", ...values });
    const target = new URL(result.href, origin);
    assert.equal(target.pathname, "/dashboard/accounts");
    assert.deepEqual(Object.fromEntries(target.searchParams), { diagnostics: "platform", business: businessId, ...values });
    assert.deepEqual(result.reads, []); assert.doesNotMatch(result.href, /credential|never-retain/);
  }
  const unknown = await legacyConnectionsRedirect({ business: businessId, message: "private-unrecognized-message", error: "private-unrecognized-error" });
  assert.equal(new URL(unknown.href, origin).pathname, "/dashboard");
  assert.doesNotMatch(unknown.href, /private-unrecognized/);
});

test("connection summaries use persisted verification, cutoff and uncertainty rather than historical receipts", () => {
  const base = connectionsWorkspace();
  assert.equal(connectionContract.connectionState(base, "printful").label, "Setup in progress");
  assert.equal(connectionContract.connectionState(base, "etsy").label, "Connected");
  assert.equal(connectionContract.connectionState({ ...base, accounts: [{ ...base.accounts[0], provider: "printful", expiresAt: base.observedAt }] }, "printful").label, "Setup in progress", "A fresh approved reconnection remains actionable after the prior token cutoff");
  assert.equal(connectionContract.connectionState({ ...base, unavailable: true }, "etsy").label, "Unavailable");
  assert.equal(connectionContract.connectionState({ ...base, runs: [] }, "printful").label, "Not connected");
  assert.equal(connectionContract.connectionState({ ...base, runs: [{ ...base.runs[0], status: "failed" }] }, "printful").label, "Failed");
  assert.equal(connectionContract.connectionState({ ...base, runs: [{ ...base.runs[0], approvalExpiresAt: base.observedAt }] }, "printful").label, "Expired");
  for (const expiresAt of [base.observedAt, "malformed"]) {
    assert.equal(connectionContract.connectionState({ ...base, accounts: [{ ...base.accounts[0], expiresAt }] }, "etsy").label, "Expired");
  }
});

test("actual root Connections keeps a populated registry, request history and safe scoped secure entry", async () => {
  const result = await connectionsPage(connectionsStart);
  assert.match(result.markup, /data-console-view="connections"/);
  assert.match(result.markup, /Synthetic North Star Studio/);
  assert.match(result.markup, /Printful/); assert.match(result.markup, /Etsy/);
  assert.match(result.markup, /Setup in progress/); assert.match(result.markup, /Connected/);
  assert.doesNotMatch(result.markup, /name="credential"|name="password"|name="accessToken"/);
  assert.ok(result.islands.some(island => island.name === "AccountNotice"));
  assert.ok(result.islands.some(island => island.name === "AccountForm"));
  assert.ok(result.markup.includes(`run=${runId}`));
  assert.doesNotMatch(result.markup, /href="\/dashboard\/etsy/);
  const html = await connectionsDocument(connectionsStart);
  assert.match(html, /hydrateRoot/); assert.doesNotMatch(html, /SYNTHETIC_ONLY_TOKEN|api\.printful\.com\/(?:stores|oauth)|SUPABASE_SERVICE/);
});



test("root workspace keys remain stable on live refresh and reset for each committed presentation result", async () => {
  const initial = connectionsWorkspace(), later = connectionsWorkspace({ observedAt: "2026-10-02T03:01:00.000Z" });
  const before = await connectionsPage(connectionsStart, { workspace: initial });
  const refreshed = await connectionsPage(connectionsStart, { workspace: later });
  assert.equal(before.workspaceKey, connectionContract.connectionWorkspaceKey(initial));
  assert.equal(before.workspaceKey, refreshed.workspaceKey, "A clock-only live refresh cannot interrupt an active form");
  const firstResult = await connectionsPage(connectionsStart + `&accountMessage=profile-saved&accountResult=${fixture.revision}`, { workspace: initial });
  const secondResult = await connectionsPage(connectionsStart + `&accountMessage=profile-saved&accountResult=${fixture.connectionId}`, { workspace: initial });
  assert.notEqual(firstResult.workspaceKey, before.workspaceKey);
  assert.notEqual(secondResult.workspaceKey, firstResult.workspaceKey, "An unchanged profile save receives a fresh presentation result and usable form");
  const invalidResult = await connectionsPage(connectionsStart + "&accountResult=not-a-uuid", { workspace: initial });
  assert.equal(invalidResult.workspaceKey, before.workspaceKey);
});

test("an exact request outside loaded history never falls back to another request or starts a duplicate", async () => {
  const missingRoute = `/dashboard?view=connections&business=${businessId}&connectionRun=${fixture.connectionId}&provider=printful`;
  const missing = await connectionsPage(missingRoute);
  assert.match(missing.markup, /selected request is unavailable in the loaded history/);
  assert.doesNotMatch(missing.markup, />Verify Printful<|Prepare Printful review|Approve exact request|Stop setup|<h3>Connect Printful<\/h3>/);
  const base = connectionsWorkspace();
  const otherProviderHistory = Array.from({ length: 50 }, (_, i) => ({ ...base.runs[0], id: `20000000-0000-4000-8000-${String(i).padStart(12, "0")}`, provider: "etsy", status: "verified" }));
  const full = await connectionsPage(`/dashboard?view=connections&business=${businessId}&provider=printful`, { workspace: connectionsWorkspace({ runs: otherProviderHistory }) });
  assert.match(full.markup, /latest 50 requests across providers/);
  assert.doesNotMatch(full.markup, /Prepare Printful review|No setup request is saved for Printful/);
});

test("actual secure page preserves an exact safe return and never server-renders a credential value", async () => {
  const result = await connectionsPage(connectionsSecure);
  assert.deepEqual(result.reads, [businessId]);
  assert.match(result.markup, /data-console-view="connections"/);
  assert.match(result.markup, /<input(?=[^>]*name="credential")(?=[^>]*type="password")(?=[^>]*data-private="true")/);
  assert.doesNotMatch(result.markup, /name="credential"[^>]*(?:value|defaultValue)=/);
  const secure = result.islands.find(island => island.name === "PrintfulSecureForm");
  assert.ok(secure); assert.equal(secure.props.businessId, businessId); assert.equal(secure.props.runId, runId);
  const target = new URL(secure.props.returnTo, origin);
  assert.equal(target.searchParams.get("business"), businessId); assert.equal(target.searchParams.has("run"), false);
  assert.equal(target.searchParams.get("connectionRun"), runId);
  for (const override of [{ unavailable: true }, { vaultConfigured: false }, { runs: [] }, { runs: [{ ...connectionsWorkspace().runs[0], approvalExpiresAt: connectionsWorkspace().observedAt }] }]) {
    const denied = await connectionsPage(connectionsSecure, { workspace: connectionsWorkspace(override) });
    assert.doesNotMatch(denied.markup, /name="credential"/); assert.match(denied.markup, /No credential can be submitted/);
  }
  const html = await connectionsDocument(connectionsSecure);
  assert.doesNotMatch(html, /SYNTHETIC_ONLY_TOKEN/);
});

async function checkLayout(page, { desktop = false } = {}) {
  const measure = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, height: document.documentElement.scrollHeight, clientHeight: document.documentElement.clientHeight }));
  assert.ok(measure.width <= measure.clientWidth + 1, `No horizontal document overflow: ${JSON.stringify(measure)}`);
  if (desktop) assert.ok(measure.height <= measure.clientHeight + 1, `Desktop document remains one viewport: ${JSON.stringify(measure)}`);
  const clipped = await page.locator("h1,h2,h3,button,summary,label,input:not([type=hidden]),select,.connectionNotice,.connectionFormNotice").evaluateAll(elements => elements.filter(element => {
    const box = element.getBoundingClientRect(), style = getComputedStyle(element);
    if (!box.width || !box.height || style.visibility === "hidden" || element.closest("details:not([open])") && element.tagName !== "SUMMARY") return false;
    return box.left < -1 || box.right > document.documentElement.clientWidth + 1 || (style.overflowX === "hidden" && element.scrollWidth > element.clientWidth + 2);
  }).map(element => ({ tag: element.tagName, text: element.textContent.slice(0, 80) })));
  assert.deepEqual(clipped, [], "Important text and controls do not clip horizontally");
}

async function visibleNotice(notice) {
  const visible = await notice.evaluate(element => { const box = element.getBoundingClientRect(); return box.height > 0 && box.top >= -1 && box.bottom <= innerHeight + 1; });
  assert.equal(visible, true, "Validation, pending and result notices stay within the visible viewport");
}

async function fillSecure(page) {
  await page.evaluate(expected => { window.__checkSyntheticSubmission = form => ({ credentialMatches: form.get("credential") === expected,
    storeIdMatches: form.get("storeId") === "987", storeKindMatches: form.get("storeKind") === "ecommerce_linked", consentMatches: form.get("secureAccessConsent") === "on",
    cutoffMatches: form.get("expiresAt") === "2026-10-20T12:00" }); }, token);
  await page.locator('[name="credential"]').fill(token);
  await page.locator('[name="storeId"]').fill("987");
  await page.locator('[name="storeKind"]').selectOption("ecommerce_linked");
  await page.locator('[name="expiresAt"]').fill("2026-10-20T12:00");
  await page.locator('[name="secureAccessConsent"]').check();
}
async function assertPrivate(page, logs) {
  const exposed = await page.evaluate(() => ({ text: document.body.innerText, html: document.documentElement.outerHTML, url: location.href, local: { ...localStorage }, session: { ...sessionStorage }, calls: window.__connectionsCalls, state: window.__connectionsState }));
  assert.doesNotMatch(JSON.stringify(exposed), new RegExp(token));
  assert.doesNotMatch(JSON.stringify(logs), new RegExp(token));
  assert.deepEqual(await page.evaluate(() => window.__connectionsErrors), []);
}

// Deliberately hosted-only. This file never starts a local app or makes provider,
// OAuth, API, database, screenshot upload, credential or env requests.
const enabled = process.env.GUIDED_UI_BROWSER === "1";
test("hosted actual-root and secure Connections journey validates labels, pending locks and exact return at every layout", { skip: !enabled, timeout: 180_000 }, async t => {
  const browser = await chromium.launch({ headless: true, ...(process.env.GUIDED_UI_CHROMIUM_PATH ? { executablePath: process.env.GUIDED_UI_CHROMIUM_PATH } : {}) });
  const directory = path.resolve("test-results/guided-ui"); mkdirSync(directory, { recursive: true });
  try {
    for (const [width, height, suffix] of [[1280, 720, "desktop-small"], [1440, 900, "desktop"], [390, 844, "mobile"], [640, 360, "200-percent-zoom"]]) await t.test(suffix, async () => {
      const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce", serviceWorkers: "block" });
      const unexpected = [], logs = [], errors = [];
      let registrySaved = false, observation = 0;
      await context.route("**/*", async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin === origin && ["/dashboard", "/dashboard/accounts/secure"].includes(url.pathname) && request.method() === "GET" && request.resourceType() === "document") {
          return route.fulfill({ contentType: "text/html", body: await connectionsDocument(url.pathname + url.search, { saved: registrySaved, observation }) });
        }
        unexpected.push(request.url()); return route.abort();
      });
      const page = await context.newPage(); page.on("console", message => logs.push(message.text())); page.on("pageerror", error => errors.push(error.message));
      const hydrated = () => page.waitForFunction(() => window.__connectionsHydrated);
      try {
        await page.goto(origin + connectionsStart); await hydrated();
        await checkLayout(page, { desktop: width >= 1280 });
        await page.screenshot({ path: path.join(directory, `console-connections-root-${suffix}.png`), fullPage: true });
        for (const name of [/Request history/, /Connection history/]) {
          const summary = page.locator(".connectionDetails summary").filter({ hasText: name });
          await summary.click();
          await checkLayout(page, { desktop: width >= 1280 });
        }
        if (width >= 1280) {
          const detailScroll = page.locator(".connectionDetailScroll");
          assert.equal(await detailScroll.evaluate(element => element.scrollHeight > element.clientHeight), true, "Real populated history scrolls inside its detail pane");
        }
        const secureLink = page.getByRole("link", { name: "Verify Printful", exact: true }).first();
        // A selected request may be progressively disclosed. Open its actual
        // ancestor summary with the keyboard rather than bypassing the UI.
        const details = secureLink.locator("xpath=ancestor::details[not(@open)]");
        for (let i = await details.count() - 1; i >= 0; i--) await details.nth(i).locator(":scope > summary").press("Enter");
        await secureLink.click(); await hydrated();
        assert.equal(new URL(page.url()).pathname, "/dashboard/accounts/secure");
        const form = page.locator("form.accountSecureForm"), submit = form.getByRole("button", { name: /Verify Printful/ });
        await submit.click();
        const notice = form.locator(".connectionFormNotice");
        await notice.getByText("Check the required fields:", { exact: true }).waitFor();
        assert.deepEqual(await page.evaluate(() => window.__connectionsCalls), []);
        assert.match(await notice.innerText(), /Printful private token/);
        assert.match(await notice.innerText(), /store/i);
        await page.waitForFunction(() => document.activeElement?.classList.contains("connectionFormNotice"));
        await visibleNotice(notice);
        await page.locator('[name="credential"]').fill(token); await submit.click();
        assert.doesNotMatch(await notice.innerText(), /SYNTHETIC_ONLY_TOKEN|Printful private token/);
        assert.match(await notice.innerText(), /store/i); await assertPrivate(page, logs);
        await fillSecure(page); await submit.click();
        await page.waitForFunction(() => window.__connectionsCalls.length === 1);
        assert.equal(await form.getAttribute("aria-busy"), "true"); assert.equal(await submit.isDisabled(), true);
        assert.match(await notice.innerText(), /Verifying Printful/); await visibleNotice(notice);
        await form.evaluate(element => { element.requestSubmit(); element.requestSubmit(); });
        assert.equal(await page.evaluate(() => window.__connectionsCalls.length), 1);
        const call = plain(await page.evaluate(() => window.__connectionsCalls[0]));
        assert.equal(call.businessId, businessId); assert.equal(call.runId, runId);
        assert.deepEqual(call.submittedChecks, { credentialMatches: true, storeIdMatches: true, storeKindMatches: true, consentMatches: true, cutoffMatches: true }, "Pending lock must not remove secure fields before React captures FormData");
        await assertPrivate(page, logs); await checkLayout(page, { desktop: width >= 1280 });
        await page.screenshot({ path: path.join(directory, `console-connections-pending-${suffix}.png`), fullPage: true });
        registrySaved = true;
        await page.evaluate(() => window.__settleConnectionAction("verified", true));
        await page.waitForFunction(() => window.__connectionsActionResolved);
        assert.equal(new URL(page.url()).pathname, "/dashboard/accounts/secure", "Synthetic navigation is deliberately held after the action promise resolves");
        assert.equal(await form.getAttribute("aria-busy"), "true"); assert.equal(await submit.isDisabled(), true);
        await form.evaluate(element => { element.requestSubmit(); element.requestSubmit(); });
        assert.equal(await page.evaluate(() => window.__connectionsCalls.length), 1, "A resolved action stays locked until its redirect commits");
        observation++;
        await page.evaluate(() => window.__commitConnectionNavigation());
        await page.waitForURL(url => url.searchParams.get("accountMessage") === "verified"); await hydrated();
        const resultUrl = new URL(page.url());
        assert.equal(resultUrl.searchParams.get("business"), businessId); assert.equal(resultUrl.searchParams.get("connectionRun"), runId); assert.equal(resultUrl.searchParams.has("run"), false);
        const result = page.locator("#connection-notice"); assert.match(await result.innerText(), /verified and saved/);
        assert.match(await result.innerText(), /Printful · Connected/);
        assert.equal(await page.locator('.connectionRow').filter({ hasText: "Printful" }).locator('[data-state="connected"]').count(), 1);
        await page.waitForFunction(() => document.activeElement?.id === "connection-notice"); await visibleNotice(result);
        await checkLayout(page, { desktop: width >= 1280 }); await assertPrivate(page, logs);
        await page.screenshot({ path: path.join(directory, `console-connections-return-${suffix}.png`), fullPage: true });
        await page.reload(); await hydrated(); assert.match(await page.locator("#connection-notice").innerText(), /verified and saved/);
        if (width === 1280) {
          await page.locator("#connection-profile > summary").click();
          const profile = page.locator("form.accountProfileForm"), save = profile.getByRole("button", { name: "Save profile", exact: true });
          await save.click(); await page.waitForFunction(() => window.__connectionsCalls.length === 1);
          await page.evaluate(() => window.__settleConnectionAction("profile-saved", true));
          await page.waitForFunction(() => window.__connectionsActionResolved);
          assert.equal(await save.isDisabled(), true);
          await profile.evaluate(element => element.requestSubmit());
          assert.equal(await page.evaluate(() => window.__connectionsCalls.length), 1);
          observation++;
          await page.evaluate(() => window.__commitConnectionNavigation());
          await page.waitForURL(url => url.searchParams.get("accountMessage") === "profile-saved"); await hydrated();
          await page.locator("#connection-profile > summary").click();
          assert.equal(await page.locator("form.accountProfileForm").getAttribute("aria-busy"), "false");
          assert.equal(await page.getByRole("button", { name: "Save profile", exact: true }).isEnabled(), true, "A committed presentation result remounts the same root profile form");
          await assertPrivate(page, logs);
        }
        assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });
  } finally { await browser.close(); }
});

test("hosted secure form keeps bad-scope, wrong-store, expired, uncertain and network outcomes safe and recoverable", { skip: !enabled, timeout: 180_000 }, async t => {
  const browser = await chromium.launch({ headless: true, ...(process.env.GUIDED_UI_CHROMIUM_PATH ? { executablePath: process.env.GUIDED_UI_CHROMIUM_PATH } : {}) });
  try {
    for (const [outcome, expected, saved] of [["verification-scope-rejected", /unsupported token scopes/, false], ["verification-store-mismatch", /did not match/, false], ["verification-expired", /expired/, false], ["verification-unavailable", /save may have succeeded/, false], ["verification-unavailable", /save may have succeeded/, true], ["verified-browser-pending", /closure is unconfirmed/, true], ["network", /save may have succeeded/, false], ["network", /save may have succeeded/, true]]) await t.test(`${outcome} · ${saved ? "saved" : "unsaved"} registry`, async () => {
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: "reduce", serviceWorkers: "block" });
      const unexpected = [], logs = [], errors = [];
      let registrySaved = false;
      const observation = 0;
      await context.route("**/*", async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin === origin && ["/dashboard", "/dashboard/accounts/secure"].includes(url.pathname) && request.method() === "GET" && request.resourceType() === "document") return route.fulfill({ contentType: "text/html", body: await connectionsDocument(url.pathname + url.search, { saved: registrySaved, observation }) });
        unexpected.push(request.url()); return route.abort();
      });
      const page = await context.newPage(); page.on("console", message => logs.push(message.text())); page.on("pageerror", error => errors.push(error.message));
      try {
        await page.goto(origin + connectionsSecure); await page.waitForFunction(() => window.__connectionsHydrated);
        await fillSecure(page); await page.getByRole("button", { name: /Verify Printful/ }).click();
        await page.waitForFunction(() => window.__connectionsCalls.length === 1);
        registrySaved = saved;
        await page.evaluate(value => window.__settleConnectionAction(value), outcome);
        if (outcome === "network") {
          const notice = page.locator(".accountSecureForm .connectionFormNotice"); await notice.getByRole("link", { name: /Check current saved registry/ }).waitFor();
          assert.match(await notice.innerText(), expected); assert.equal(await notice.getAttribute("role"), "alert");
          assert.equal(await page.locator(".accountSecureForm").getAttribute("aria-busy"), "false");
          assert.equal(await page.getByRole("button", { name: /Verify Printful/ }).isDisabled(), true, "Do not resubmit an uncertain save before checking the registry");
          await page.waitForFunction(() => document.activeElement?.classList.contains("connectionFormNotice"));
          assert.equal(await page.evaluate(() => window.__connectionsCalls.length), 1, "An uncertain outcome never auto-retries");
          await assertPrivate(page, logs);
          await notice.getByRole("link", { name: /Check current saved registry/ }).click();
          await page.waitForURL(origin + connectionsReturn + "&accountMessage=verification-unavailable#connection-notice"); await page.waitForFunction(() => window.__connectionsHydrated);
          assert.match(await page.locator("#connection-notice").innerText(), /save may have succeeded/);
        } else {
          await page.waitForURL(url => url.searchParams.get("accountMessage") === outcome); await page.waitForFunction(() => window.__connectionsHydrated);
          assert.match(await page.locator("#connection-notice").innerText(), expected);
          await page.waitForFunction(() => document.activeElement?.id === "connection-notice"); await visibleNotice(page.locator("#connection-notice"));
        }
        assert.equal(new URL(page.url()).searchParams.get("business"), businessId);
        assert.equal(new URL(page.url()).searchParams.get("connectionRun"), runId);
        assert.match(await page.locator("#connection-notice").innerText(), saved ? /Printful · Connected/ : /Printful · Setup in progress/);
        await assertPrivate(page, logs); await checkLayout(page, { desktop: true });
        assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });
  } finally { await browser.close(); }
});
