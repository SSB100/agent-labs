import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { components, loadSource } from "./helpers/guided-ui.mjs";

const { workflows, icons, shell, visuals, browserUi } = components();
const terminal = loadSource("src/creative/terminal-review.ts");
const outcomes = loadSource("src/lib/core-ui/run-outcome.ts", { "./workflows": workflows });
const outcomeUi = loadSource("src/components/guided/run-outcome.tsx", {
  "@/lib/core-ui/run-outcome": outcomes, "./run-outcome.css": {},
});
const workContext = loadSource("src/components/guided/work-context.tsx", {
  "@/lib/core-ui/workflows": workflows, "./work-context.css": {},
});
const { ConsoleWorkPane } = loadSource("src/components/console/console-work-pane.tsx", {
  "./console-artifact-position": loadSource("src/components/console/console-artifact-position.tsx"),
  "@/lib/core-ui/workflows": workflows, "@/components/stage7/app-shell": shell,
  "@/components/stage7/workflow-visuals": visuals, "@/components/guided/run-outcome": outcomeUi,
  "@/components/guided/work-context": workContext,
});
const { ConsoleOverview, deriveConsoleOverview } = loadSource("src/components/console/console-overview.tsx", {
  "@/components/stage7/icons": icons, "@/lib/core-ui/workflows": workflows,
  "./console-browser-centre": browserUi, "./console-overview.css": {},
});

const id = number => `95000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const time = "2026-10-02T02:58:00.123456+00:00";
const owner = id(1), businessId = id(2), runId = id(3), creativeRunId = id(4), definitionId = id(5), noticeId = id(6);
const business = { id: businessId, name: "Synthetic design studio", created_at: time, updated_at: time };
const definition = { id: definitionId, workflow_key: "etsy.creative-pipeline", version: "1.0.0", name: "Synthetic creative run", description: "", status: "active", stage_definition: {} };
const run = {
  id: runId, business_id: businessId, workflow_definition_id: definitionId, status: "needs_owner", current_stage_key: "generate:1",
  input: { creativeRunId, approvalId: id(7) }, state: { productionReady: false, publicationAllowed: false },
  runtime_provider: "fixture", runtime_run_id: null, started_at: time, completed_at: time, created_at: time, updated_at: time,
};
const notice = {
  id: noticeId, business_id: businessId, workflow_run_id: runId, intervention_type: "creative_review", status: "open",
  title: "Review the saved image issue", description: "The returned image failed validation.", options: {}, resolution: {},
  requested_at: time, resolved_at: null, created_at: time, updated_at: time,
};
const stage = { id: id(8), workflow_run_id: runId, stage_key: "generate:1", sequence: 3, attempt: 1, status: "failed", input: {}, output: {}, failure: { reason: "Image validation failed" }, started_at: time, completed_at: time, created_at: time, updated_at: time };
const task = { id: id(9), business_id: businessId, workflow_run_id: runId, workflow_stage_run_id: stage.id, worker_definition_id: id(10), status: "failed", objective: "Generate one image within the approved scope", created_at: time, updated_at: time };
const worker = { id: id(11), business_id: businessId, workflow_run_id: runId, task_contract_id: task.id, worker_definition_id: task.worker_definition_id, status: "failed", completed_at: time, created_at: time, updated_at: time };
const workerDefinition = { id: task.worker_definition_id, name: "Image specialist", role: "creative" };
const costs = {
  costs: { businessId, workflowRunId: runId, source: "creative", calls: { status: "ready", records: [
    { id: "brief:1", reportedUsd: .005, reservedUsd: .01, providerRequestId: "synthetic-brief" },
    { id: "screen:1", reportedUsd: .005, reservedUsd: .01, providerRequestId: "synthetic-screen" },
    { id: "generate:1", reportedUsd: null, reservedUsd: .25, providerRequestId: null },
  ] } },
};
const overviewCosts = { status: "ready", recordedMicrousd: 10_000, uncertainCount: 1, scopeLabel: "Stopped synthetic run", workflowRunId: runId };
const collection = (reviewed = false) => ({
  runs: [structuredClone(run)], definitions: [definition], stages: [structuredClone(stage)], tasks: [structuredClone(task)],
  workerRuns: [structuredClone(worker)], workerDefinitions: [workerDefinition], events: [], artifacts: [], errors: [],
  interventions: [{ ...structuredClone(notice), ...(reviewed ? {
    status: "resolved", resolved_at: time, resolution: {
      version: terminal.TERMINAL_CREATIVE_REVIEW_VERSION, decision: "acknowledge", actorUserId: owner,
      businessId, workflowRunId: runId, creativeRunId, interventionId: noticeId, expectedUpdatedAt: time,
      acknowledgedAt: time, executionResumed: false, newSpendAuthorized: false, costsReconciled: false,
    },
  } : {}) }],
});
const context = data => ({ userId: owner, displayName: "Synthetic owner", businesses: [business], needsYouCount: data.interventions.filter(row => row.status === "open").length });
const renderOverview = data => renderToStaticMarkup(React.createElement(ConsoleOverview, { context: context(data), collection: data, costs: overviewCosts }));
const renderWork = (data, selected = false, costData = costs) => renderToStaticMarkup(React.createElement(ConsoleWorkPane, {
  context: context(data), collection: data, costs: costData, products: { experiments: [], errors: [] },
  ...(selected ? { detail: { ...data, run: data.runs[0], definition, business } } : {}),
}));

test("named Overview notices open the exact decision in its actual Business", () => {
  const data = collection();
  const otherBusiness = { ...business, id: id(20) };
  data.interventions.push({ ...structuredClone(notice), id: id(21), business_id: otherBusiness.id, workflow_run_id: null, intervention_type: "synthetic_workflow_review" });
  data.interventions.push({ ...structuredClone(notice), id: id(22), workflow_run_id: null, intervention_type: "future_unknown_notice" });
  const saved = structuredClone(data);
  for (const navigationBusinessId of [undefined, businessId, otherBusiness.id]) {
    const markup = renderToStaticMarkup(React.createElement(ConsoleOverview, {
      context: { ...context(data), businesses: [business, otherBusiness] }, collection: data, navigationBusinessId,
    }));
    const rows = [...markup.matchAll(/<a href="([^"]+)" class="consoleDecision"[^>]*data-intervention-id="([^"]+)"/g)];
    assert.equal(rows.length, 3);
    for (const [, href, noticeId] of rows) {
      const notice = data.interventions.find(item => item.id === noticeId);
      const url = new URL(href.replaceAll("&amp;", "&"), "https://fixture.invalid");
      assert.equal(url.pathname, "/dashboard");
      assert.equal(url.searchParams.get("view"), "decisions");
      assert.equal(url.searchParams.get("decision"), notice.id);
      assert.equal(url.searchParams.get("business"), notice.business_id);
      assert.deepEqual([...url.searchParams.keys()].sort(), ["business", "decision", "view"]);
    }
  }
  assert.deepEqual(data, saved, "Selecting an exact notice must not change its typed action or saved records");
});

test("acknowledging a stopped notice clears only the open decision projection", () => {
  const before = collection(), after = collection(true);
  assert.equal(terminal.isTerminalCreativeReviewAcknowledgement({ intervention: after.interventions[0], run: after.runs[0], creativeRunId, ownerUserId: owner }), true);
  assert.deepEqual(after.runs, before.runs);
  assert.deepEqual(after.stages, before.stages);
  assert.deepEqual(after.workerRuns, before.workerRuns);

  for (const data of [before, after]) {
    const model = deriveConsoleOverview(context(data), data);
    assert.equal(model.activeRuns.length, 0);
    assert.equal(model.activeWorkers.length, 0);
    const markup = renderOverview(data);
    assert.match(markup, /data-work-state="idle"/);
    assert.match(markup, /Stopped · 95000000/);
    assert.match(markup, /Last: Failed/);
    assert.match(markup, /data-status="failed"/);
    assert.match(markup, /1 charge is still unconfirmed/);
    assert.doesNotMatch(markup, /Working now|data-worker-active="true"|data-current="true"|Saved work is active or waiting|Run active · worker unconfirmed|>Completed</);
  }
  assert.match(renderOverview(before), /<strong>1<\/strong> waiting/);
  const cleared = renderOverview(after);
  assert.match(cleared, /<strong>0<\/strong> working.*<strong>0<\/strong> waiting/);
  assert.doesNotMatch(cleared, /data-intervention-id=|Waiting for owner decisions|data-next-action="work"|data-next-action="decision"/);
  assert.equal(deriveConsoleOverview(context(after), after).decisions.length, 0);
});

test("Work list and detail retain stopped execution and failed history after review", () => {
  const data = collection(true), saved = structuredClone(data);
  const list = renderWork(data), detail = renderWork(data, true);
  for (const markup of [list, detail]) {
    assert.match(markup, /class="coreStatus coreStatus-danger" title="Execution ended\. Last recorded status: Needs you">Stopped<\/span>/);
    assert.doesNotMatch(markup, /class="coreStatus coreStatus-attention"|>Needs you<|>Completed<|Run completed|Technical run completed|Work is in progress|Waiting for your decision/);
  }
  assert.match(detail, /Design work stopped for review/);
  assert.match(detail, /<small>Failed<\/small>/);
  assert.match(detail, /Last worker: Image specialist · Failed/);
  assert.match(detail, /No current worker/);
  assert.match(detail, /1 of 3 recorded calls have an unknown charge/);
  assert.match(detail, /Known reported charges/);
  assert.match(detail, /US\$0\.01/);
  assert.doesNotMatch(detail, /class="needsYouCard|aria-current="step"|data-tone="success"/);
  assert.deepEqual(data, saved, "Projection must not complete, resume, or rewrite saved run and failure receipts");
});

test("every ended active-status receipt projects stopped without making a success claim", () => {
  for (const status of workflows.ACTIVE_WORKFLOW_STATUSES) {
    const data = collection(true);
    data.runs[0].status = status;
    // Even stale activity receipts cannot revive a runtime with completed_at.
    data.stages[0].status = "running";
    data.stages[0].completed_at = null;
    data.tasks[0].status = "running";
    data.workerRuns[0].status = "running";
    data.workerRuns[0].completed_at = null;
    const overview = renderOverview(data);
    assert.equal(deriveConsoleOverview(context(data), data).activeRuns.length, 0, status);
    assert.match(overview, /Stopped · 95000000/);
    assert.match(overview, /Last recorded: Working · run ended/);
    assert.doesNotMatch(overview, /data-work-state="(?:working|unconfirmed)"|data-worker-active="true"|data-current="true"/);
    assert.match(renderWork(data), />Stopped<\/span>/);
  }
});

test("an unresolved resumable run still needs review and real terminal statuses remain exact", () => {
  const data = collection();
  data.runs[0].completed_at = null;
  assert.equal(deriveConsoleOverview(context(data), data).activeRuns.length, 1);
  assert.match(renderWork(data), /class="coreStatus coreStatus-attention">Needs you<\/span>/);
  assert.doesNotMatch(renderWork(data), />Stopped<\/span>/);
  for (const [status, label] of [["failed", "Failed"], ["completed", "Completed"], ["cancelled", "Stopped"]]) {
    const ended = collection(true);
    ended.runs[0].status = status;
    assert.match(renderWork(ended), new RegExp(`>${label}</span>`));
  }
});

test("acknowledgement does not turn unavailable or absent cost evidence into zero spend", () => {
  const data = collection(true);
  const unavailable = renderWork(data, true, { costs: { ...costs.costs, calls: { status: "unavailable" } } });
  assert.match(unavailable, /The complete cost history could not be checked/);
  assert.doesNotMatch(unavailable, /US\$0\.00|No calls recorded|Reported provider charges/);
  const missing = renderWork(data, true, null);
  assert.match(missing, /Cost records have not been loaded/);
  assert.doesNotMatch(missing, /US\$0\.00|No calls recorded/);
});
