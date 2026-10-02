import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync("src/components/console/console-overview.tsx", "utf8");
const css = readFileSync("src/components/console/console-overview.css", "utf8");
function compile(source, dependencies) {
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const mod = { exports: {} };
  runInNewContext(`(function(require,module,exports){${code}\n})`)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected runtime import: ${name}`);
    return dependencies[name];
  }, mod, mod.exports);
  return mod.exports;
}
const workflows = compile(readFileSync("src/lib/core-ui/workflows.ts", "utf8"), {});
const component = compile(source, {
  react: React,
  "react/jsx-runtime": require("react/jsx-runtime"),
  "next/link": ({ children, ...props }) => React.createElement("a", props, children),
  "@/components/stage7/icons": { CoreIcon: ({ name }) => React.createElement("svg", { "aria-hidden": true, "data-icon": name }) },
  "@/lib/core-ui/workflows": workflows,
  "./console-overview.css": {},
});
const empty = () => ({ runs: [], definitions: [], stages: [], events: [], interventions: [], tasks: [], workerRuns: [], workerDefinitions: [], artifacts: [], errors: [] });
const context = { displayName: "Owner", businesses: [{ id: "business-1", name: "North Star Studio" }], needsYouCount: 0 };
const timestamp = "2026-10-02T02:30:00.000Z";
const run = { id: "00000000-0000-4000-8000-000000000111", business_id: "business-1", workflow_definition_id: "definition-1", status: "running", current_stage_key: "research", completed_at: null, updated_at: timestamp, created_at: timestamp };
const definition = { id: "definition-1", name: "Find a market", workflow_key: "research", stage_definition: { stages: [{ key: "research", sequence: 1 }, { key: "review", sequence: 2 }] } };
const stage = { id: "stage-1", workflow_run_id: run.id, stage_key: "research", sequence: 1, attempt: 1, status: "running", updated_at: timestamp };
const task = { id: "task-1", workflow_run_id: run.id, business_id: "business-1", worker_definition_id: "worker-definition-1", workflow_stage_run_id: "stage-1", objective: "Compare the recorded market evidence", status: "running" };
const worker = { id: "worker-receipt-1", workflow_run_id: run.id, business_id: "business-1", task_contract_id: "task-1", worker_definition_id: "worker-definition-1", status: "running", completed_at: null, updated_at: timestamp };
const workerDefinition = { id: "worker-definition-1", name: "Market researcher", role: "research" };
const intervention = { id: "intervention-1", business_id: "business-1", workflow_run_id: run.id, intervention_type: "creative_review", status: "open", title: "Review the saved image issue", requested_at: timestamp };
const artifact = { id: "artifact-1", business_id: "business-1", workflow_run_id: run.id, name: "Market evidence report", artifact_type: "research_report", created_at: timestamp, updated_at: timestamp };
const active = () => ({ ...empty(), runs: [{ ...run }], definitions: [definition], stages: [{ ...stage }], tasks: [{ ...task }], workerRuns: [{ ...worker }], workerDefinitions: [workerDefinition] });
const render = (overrides = {}) => renderToStaticMarkup(React.createElement(component.ConsoleOverview, { context, collection: empty(), ...overrides }));
const derive = (collection, contextOverrides = {}) => component.deriveConsoleOverview({ ...context, ...contextOverrides }, collection);

test("overview renders nine named panels, a native decorative orb and no invented telemetry", () => {
  const markup = render();
  const panels = [...markup.matchAll(/data-console-panel="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(panels, ["status", "core", "feed", "workers", "timeline", "commands", "costs", "connections", "outputs"]);
  assert.match(markup, /data-work-state="idle"/);
  assert.match(markup, /Idle · no worker running/);
  assert.match(markup, /class="consoleCoreOrb"[^>]*aria-hidden="true"/);
  assert.match(markup, /No worker executions recorded/);
  assert.doesNotMatch(markup, /CPU|RAM|Listening|Voice|System optimal|4 agents|2 Running|progressbar|%/i);
  assert.doesNotMatch(source, /fetch\(|process\.env|form action|useEffect|"use client"/);
});

test("working requires matching current run, task, stage and non-completed worker receipts", () => {
  assert.equal(derive(active()).activeWorkers.length, 1);
  const markup = render({ collection: active() });
  assert.match(markup, /data-work-state="working"/);
  assert.match(markup, /data-worker-active="true"/);
  assert.match(markup, /Working now/);
  for (const mutate of [
    data => { data.runs[0].status = "needs_owner"; },
    data => { data.runs[0].completed_at = timestamp; },
    data => { data.stages[0].status = "completed"; },
    data => { data.tasks[0].status = "completed"; },
    data => { data.tasks[0].workflow_stage_run_id = "another-stage"; },
    data => { data.workerRuns[0].completed_at = timestamp; },
    data => { data.workerRuns[0].status = "completed"; },
  ]) {
    const data = active(); mutate(data);
    assert.equal(derive(data).activeWorkers.length, 0);
    assert.doesNotMatch(render({ collection: data }), /Working now|data-worker-active="true"/);
  }
});

test("foreign or mismatched task receipts never produce worker tiles", () => {
  for (const mutate of [
    data => { data.workerRuns[0].business_id = "foreign-business"; },
    data => { data.workerRuns[0].workflow_run_id = "other-run"; },
    data => { data.workerRuns[0].task_contract_id = "other-task"; },
    data => { data.tasks[0].worker_definition_id = "other-worker"; },
    data => { data.tasks[0].business_id = "foreign-business"; },
  ]) {
    const data = active(); mutate(data);
    assert.equal(derive(data).receipts.length, 0);
    assert.doesNotMatch(render({ collection: data }), /data-worker-id=/);
  }
});

test("a completed worker remains a historical receipt while the core is idle", () => {
  const data = active();
  data.workerRuns[0].status = "completed";
  data.workerRuns[0].completed_at = timestamp;
  data.runs[0].status = "completed";
  data.runs[0].completed_at = timestamp;
  const markup = render({ collection: data, context: { ...context, needsYouCount: 3 } });
  assert.match(markup, /data-work-state="idle"/);
  assert.match(markup, /Last: Completed/);
  assert.match(markup, /<strong>0<\/strong> working.*<strong>3<\/strong> waiting/);
  assert.doesNotMatch(markup, /Working now|data-worker-active="true"/);
});

test("partial records and unknown decisions never claim zero or live work", () => {
  const collection = { ...active(), errors: ["Read unavailable"] };
  const markup = render({ collection, context: { ...context, needsYouCount: 7, needsYouUnavailable: true, businessesUnavailable: true } });
  assert.match(markup, /data-work-state="unknown"/);
  assert.match(markup, /Status unavailable/);
  assert.match(markup, /<strong>\?<\/strong> working.*<strong>\?<\/strong> waiting/);
  assert.match(markup, /Recorded · status unconfirmed/);
  assert.doesNotMatch(markup, /Working now|7 waiting|No workflow yet|No activity recorded/);
});

test("real interventions produce the single recommended decision action", () => {
  const collection = { ...active(), interventions: [intervention] };
  const model = derive(collection, { needsYouCount: 1 });
  assert.equal(model.next.href, "/dashboard?view=decisions");
  assert.equal(model.next.label, "Review image issue");
  const markup = render({ collection, context: { ...context, needsYouCount: 1 } });
  assert.equal((markup.match(/class="consolePrimaryAction"/g) ?? []).length, 1);
  assert.match(markup, /data-next-action="decision"/);
  assert.match(markup, /Review the saved image issue/);
  assert.doesNotMatch(markup, /Approve|Resume worker|Retry now/);
});

test("primary action chooses oldest decision, then exact current run, then research sheet", () => {
  const collection = { ...active(), interventions: [intervention, { ...intervention, id: "older", title: "Older request", requested_at: "2026-09-01T00:00:00.000Z" }] };
  assert.equal(derive(collection).next.detail, "Older request");
  assert.equal(derive(active()).next.href, `/dashboard?view=work&run=${run.id}`);
  assert.equal(derive(empty()).next.href, "/dashboard?view=overview&sheet=research");
  assert.equal(derive(empty(), { needsYouCount: 3 }).next.href, "/dashboard?view=decisions");
  assert.equal(derive({ ...empty(), errors: ["Unavailable"] }).next.href, "/dashboard?view=work");
});

test("all navigation remains in root tabs, with exact workflow run selection", () => {
  const collection = { ...active(), interventions: [intervention], artifacts: [artifact], events: [{ id: "event-1", workflow_run_id: run.id, business_id: "business-1", event_type: "worker.completed", occurred_at: timestamp }] };
  const markup = render({ collection });
  for (const match of markup.matchAll(/href="([^"]+)"/g)) assert.match(match[1], /^\/dashboard\?view=(work|library|decisions|connections|activity|overview)(?:&amp;(run|sheet)=[^"&]+)?$/);
  assert.match(markup, new RegExp(`href="/dashboard\\?view=work&amp;run=${run.id}"`));
  assert.match(markup, /Worker completed/);
  assert.match(markup, /02 Oct, 02:30 UTC/);
  assert.doesNotMatch(markup, /\/dashboard\/workflows|\/dashboard\/artifacts|\/dashboard\/needs-you/);
});

test("costs are absent until supplied, with charges, allowance and unknown kept distinct", () => {
  const unknown = render();
  assert.match(unknown, /No cost summary loaded/);
  assert.doesNotMatch(unknown, /\$0\.00|data-cost=/);
  const markup = render({ costs: { status: "ready", recordedMicrousd: 110_000, allowanceMicrousd: 1_000_000, reservedMicrousd: 200_000, uncertainCount: 1, scopeLabel: "Latest research run", workflowRunId: run.id } });
  assert.match(markup, /data-cost="recorded">\$0\.11/);
  assert.match(markup, /data-cost="allowance">\$1\.00/);
  assert.match(markup, /data-cost="reserved">\$0\.20/);
  assert.match(markup, /1 charge is still unconfirmed/);
  assert.match(markup, /Known reported charges/);
  assert.match(markup, /Owner allowance is not a guaranteed provider invoice cap/);
  const noReported = render({ costs: { status: "ready", recordedMicrousd: null, allowanceMicrousd: -1, reservedMicrousd: Number.NaN, scopeLabel: "Saved run" } });
  assert.match(noReported, /Not reported/);
  assert.doesNotMatch(noReported, /\$|NaN|data-cost="allowance"|data-cost="reserved"/);
});

test("configured integrations never become verified without an actual dated check", () => {
  const markup = render({ connections: { status: "ready", items: [
    { id: "configured", name: "Configured provider", state: "configured" },
    { id: "unchecked", name: "Unchecked provider", state: "verified" },
    { id: "verified", name: "Checked provider", state: "verified", verifiedAt: timestamp },
    { id: "failed", name: "Attention provider", state: "needs_attention" },
  ] } });
  assert.match(markup, /Configured · not checked/);
  assert.match(markup, /Saved account records · not a live health check/);
  assert.match(markup, /data-connection-id="unchecked" data-connection-state="unknown"/);
  assert.match(markup, /data-connection-id="verified" data-connection-state="verified"/);
  assert.equal((markup.match(/<small>Verified on record<\/small>/g) ?? []).length, 1);
  assert.match(markup, /Needs attention/);
  assert.doesNotMatch(markup, /Healthy|All connected|Online/);
});

test("output previews require matching explicit HTTPS metadata and never infer storage URLs", () => {
  const collection = { ...empty(), artifacts: [{ ...artifact, storage_path: "private/source.png", metadata: { url: "https://untrusted.invalid/image.png" } }] };
  assert.doesNotMatch(render({ collection }), /<img|private\/source|untrusted\.invalid/);
  assert.doesNotMatch(render({ collection, outputPreviews: [{ artifactId: "other-id", signedUrl: "https://example.invalid/image.png", alt: "Other image" }] }), /<img/);
  assert.doesNotMatch(render({ collection, outputPreviews: [{ artifactId: artifact.id, signedUrl: "javascript:alert(1)", alt: "Invalid" }] }), /<img|javascript:/);
  assert.match(render({ collection, outputPreviews: [{ artifactId: artifact.id, signedUrl: "https://example.invalid/signed-image.png", alt: "Saved original design" }] }), /<img src="https:\/\/example.invalid\/signed-image.png" alt="Saved original design"/);
});

test("untrusted names and decisions are escaped; no raw HTML is rendered", () => {
  const markup = render({ collection: { ...active(), interventions: [{ ...intervention, title: '<script>alert("x")</script>' }] } });
  assert.match(markup, /&lt;script&gt;/);
  assert.doesNotMatch(markup, /<script>/);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML/);
});

test("layout is viewport-bound on desktop, scrolls inside panels and reflows for touch", () => {
  assert.match(css, /grid-template-rows: minmax\(0, 1\.42fr\) minmax\(0, 1fr\) minmax\(0, \.92fr\)/);
  assert.match(css, /height: 100%/);
  assert.match(css, /\.consolePanelScroll \{[^}]*overflow: auto/);
  assert.match(css, /padding: 12px/);
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /flex-direction: column; height: auto/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(css, /transform: scale|zoom:|animation: (?!none)[a-z]/);
});

test("a running workflow without a current worker receipt reports uncertainty instead of idle",()=>{const data=active();data.workerRuns[0].status="completed";data.workerRuns[0].completed_at=timestamp;const markup=render({collection:data});assert.match(markup,/data-work-state="unconfirmed"/);assert.match(markup,/Run active · worker unconfirmed/);assert.doesNotMatch(markup,/Idle · no worker running|Working now/);});
