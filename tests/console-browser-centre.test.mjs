import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { contract, fixture, id, loadBrowserSource, wire, workspace } from "./helpers/console-browser-fixtures.mjs";

const component = loadBrowserSource("src/components/console/console-browser-centre.tsx", { "@/browser/console-view": contract, "./console-browser-centre.css": {} });
const render = (mode, data = workspace()) => renderToStaticMarkup(React.createElement(component.ConsoleBrowserCentre, { mode, data }, React.createElement("div", { id: "original-overview" }, "AGENT LABS")));
const statuses = [...contract.CONSOLE_BROWSER_STATUSES, "viewable", "expired", "disconnected", "unknown", "FIXTURE_PRIVATE_VALUE"];

test("URL helpers preserve exact local scope and open only the protected saved Work record pane", () => {
  assert.equal(contract.consoleCentreMode("browser"), "browser");
  for (const value of [undefined, "Browser", ["browser"], "javascript:x"]) assert.equal(contract.consoleCentreMode(value), "overview");
  assert.equal(contract.consoleBrowserHref("browser", id(2), id(3)), `/dashboard?view=overview&centre=browser&business=${id(2)}&browserRun=${id(3)}`);
  assert.equal(contract.consoleBrowserHref("overview", "https://evil.test", id(3)), "/dashboard?view=overview&centre=overview");
  assert.equal(contract.consoleBrowserHref("browser", id(2), "javascript:x"), `/dashboard?view=overview&centre=browser&business=${id(2)}`);
  assert.equal(contract.consoleBrowserWorkflowHref(workspace().selectedSession), `/dashboard?view=work&run=${id(3)}&business=${id(2)}`);
  for (const change of [{ businessId: "bad" }, { workflowRunId: "bad" }]) assert.equal(contract.consoleBrowserWorkflowHref({ ...workspace().selectedSession, ...change }), null);
});

test("summary allowlists metadata only; lifecycle values never grant viewer eligibility", () => {
  const { session, run } = fixture();
  for (const status of statuses) {
    const summary = contract.consoleBrowserSummary({ ...session, status, state: "viewable", debugUrl: "FIXTURE_PRIVATE_VALUE" }, run);
    assert.deepEqual(Object.keys(summary).sort(), ["businessId", "id", "label", "savedStatus", "updatedAt", "workflowRunId"].sort());
    assert.equal(summary.savedStatus, contract.CONSOLE_BROWSER_STATUSES.includes(status) ? status : "unknown");
    assert.doesNotMatch(JSON.stringify(summary), /FIXTURE_PRIVATE_VALUE|fixture-provider-session|example.com|viewable/);
  }
  assert.equal(contract.consoleBrowserSummary(session, { ...run, business_id: id(90) }), null);
  assert.equal(contract.consoleBrowserSummary({ ...session, id: "not-a-uuid" }, run), null);
  for (const updated_at of ["yesterday", "FIXTURE_PRIVATE_VALUE", "2026-99-99T00:00:00Z"]) assert.equal(contract.consoleBrowserSummary({ ...session, updated_at }, run).updatedAt, null);
});

test("private page/profile/handoff content and observations are never projected or fetched", async () => {
  const f = fixture();
  const secret = "FIXTURE_PRIVATE_VALUE";
  const session = { ...f.session, current_url: `https://example.test/login?token=${secret}`, page_title: secret, metadata: { ownerOnlySecureEntry: true, debugUrl: secret, observation: secret }, failure: { message: secret }, provider_session_id: secret };
  const w = wire({ sessions: [session], runs: [{ ...f.run, state: { secret }, input: { secret } }] });
  const result = await w.server.loadConsoleBrowserWorkspace(w.context, { businessId: id(2), workflowRunId: id(3) });
  assert.equal(result.status, "ready"); assert.doesNotMatch(JSON.stringify(result), /FIXTURE_PRIVATE_VALUE/);
  for (const query of w.calls) {
    assert.ok(["browser_sessions", "workflow_runs"].includes(query.table));
    assert.doesNotMatch(query.select, /provider|url|title|metadata|failure|state|input|profile|observation|payload/);
  }
});

test("owner summaries reject foreign/malformed selections and do not infer absence from read failures", async () => {
  for (const opts of [{ failTable: "browser_sessions" }, { failTable: "workflow_runs" }, { throwTable: "browser_sessions" }]) {
    const w = wire(opts);
    assert.equal((await w.server.loadConsoleBrowserWorkspace(w.context, { businessId: id(2), workflowRunId: id(3) })).status, "unavailable");
  }
  const w = wire();
  for (const selection of [{ businessId: id(99) }, { workflowRunId: id(3) }, { businessId: id(2), workflowRunId: "bad" }]) assert.equal((await w.server.loadConsoleBrowserWorkspace(w.context, selection)).status, "invalid_selection");
  assert.equal(w.calls.length, 0);
  assert.equal((await w.server.loadConsoleBrowserWorkspace({ ...w.context, businesses: [] }, { businessId: id(2) })).status, "invalid_selection");
  assert.equal((await w.server.loadConsoleBrowserWorkspace({ ...w.context, businessesUnavailable: true }, { businessId: id(2) })).status, "unavailable");
  assert.equal(w.calls.length, 0);
});

test("exact selected run is independent of newest-40 list and never falls back to a foreign run", async () => {
  const f = fixture();
  const sessions = Array.from({ length: 46 }, (_, n) => ({ ...f.session, id: id(100 + n), workflow_run_id: id(200 + n) }));
  const runs = sessions.map(s => ({ ...f.run, id: s.workflow_run_id }));
  const w = wire({ sessions, runs });
  const result = await w.server.loadConsoleBrowserWorkspace(w.context, { businessId: id(2), workflowRunId: id(245) });
  assert.equal(result.status, "ready"); assert.equal(result.truncated, true); assert.equal(result.sessions.length, 41);
  assert.equal(result.selectedSession.workflowRunId, id(245));
  assert.equal((await w.server.loadConsoleBrowserWorkspace(w.context, { businessId: id(2), workflowRunId: id(999) })).status, "invalid_selection");
  const foreign = wire({ runs: [{ ...f.run, business_id: id(99) }] });
  assert.equal((await foreign.server.loadConsoleBrowserWorkspace(foreign.context, { businessId: id(2), workflowRunId: id(3) })).status, "invalid_selection");
});

test("successful reads distinguish no sessions, no selected run, and no browser row for an exact owned run", async () => {
  const w = wire({ sessions: [] });
  const result = await w.server.loadConsoleBrowserWorkspace(w.context, { businessId: id(2), workflowRunId: id(3) });
  assert.equal(result.status, "ready"); assert.equal(result.selectedSession, null);
  assert.match(render("browser", result), /No browser session for this run/);
  assert.match(render("browser", workspace({ selectedRunId: null, selectedSession: null, sessions: [] })), /No browser sessions recorded/);
  assert.match(render("browser", workspace({ selectedRunId: null, selectedSession: null })), /Choose a browser run/);
  assert.match(render("browser", workspace({ status: "unavailable" })), /records unavailable/);
  assert.match(render("browser", workspace({ status: "invalid_selection" })), /selection unavailable/);
});

test("Overview keeps its exact child markup; compact tabs are separate and context is optional", () => {
  assert.equal(render("overview"), '<div id="original-overview">AGENT LABS</div>');
  const tabs = renderToStaticMarkup(React.createElement(component.ConsoleCentreTabs, { mode: "overview", data: workspace() }));
  assert.match(tabs, /aria-current="page">Overview/);
  assert.doesNotMatch(tabs, /original-overview|iframe|<form/);
  const browser = render("browser");
  assert.match(browser, /Recorded session state: live/);
  assert.match(browser, /name="browserRun"/);
  assert.doesNotMatch(browser, /<select[^>]+name="business"/);
  assert.match(render("browser", workspace({ businesses: [...workspace().businesses, { id: id(5), name: "Other" }] })), /<select[^>]+name="business"/);
});

test("every saved status and forged viewable props remain inert metadata with an explicit blocker", async () => {
  const f = fixture();
  for (const status of statuses) {
    const w = wire({ sessions: [{ ...f.session, status, state: "viewable" }] });
    const data = await w.server.loadConsoleBrowserWorkspace(w.context, { businessId: id(2), workflowRunId: id(3) });
    const forged = { ...data.selectedSession, state: "viewable", savedStatus: status, viewerUrl: "https://app.steel.dev/FIXTURE_PRIVATE_VALUE", debugUrl: "FIXTURE_PRIVATE_VALUE", watchHref: "/api/browser/sessions/private/live" };
    const markup = render("browser", { ...data, sessions: [forged], selectedSession: forged });
    assert.match(markup, /Live viewing unavailable: a privacy-safe viewer contract is not yet implemented/);
    assert.match(markup, /Saved status does not confirm current connectivity/);
    assert.match(markup, /Inspect saved workflow record/);
    assert.doesNotMatch(markup, /<iframe|<object|<embed|<video|FIXTURE_PRIVATE_VALUE|viewable|workspace=browser|\/api\/browser|Retry|Approve/);
    assert.equal(w.calls.some(call => call.rpc), false);
  }
});

test("shipping metadata sources contain no viewer, network lease, provider resolver or live route", () => {
  for (const file of ["src/browser/console-view.ts", "src/browser/console-server.ts", "src/components/console/console-browser-centre.tsx"]) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /<iframe|<object|<embed|<video|\bfetch\s*\(|\.rpc\s*\(|get_browser_session_live_view|debugUrl|viewerUrl|WatchHref|ReadOnlyTarget|createConsoleBrowserLease|setInterval|setTimeout|createSession|connectCDP|localStorage|sessionStorage/);
  }
  assert.equal(existsSync("src/app/api/browser/sessions/[browserSessionId]/watch/route.ts"), false);
  assert.equal(contract.consoleBrowserWatchHref, undefined);
  assert.equal(contract.createConsoleBrowserLease, undefined);
  assert.equal(wire().server.loadConsoleBrowserWatch, undefined);
  const workPane = readFileSync("src/components/console/console-work-pane.tsx", "utf8");
  assert.doesNotMatch(workPane, /WorkflowWorkspace|<iframe|\/api\/browser/);
  const dashboard = readFileSync("src/app/dashboard/page.tsx", "utf8");
  assert.match(dashboard, /await requireOwnerUiContext\(\)/);
  assert.match(dashboard, /detail\.run\.business_id !== businessId\) notFound\(\)/);
});
