import assert from "node:assert/strict";
import test from "node:test";

import workflowUiModule from "../.core-tests/lib/core-ui/workflows.js";

const {
  deriveCurrentAction,
  deriveNextStep,
  eventDetail,
  eventLabel,
  latestStageByKey,
  openIntervention,
  stageBlueprints,
  statusLabel,
  statusTone,
} = workflowUiModule;

const definition = {
  id: "00000000-0000-4000-8000-000000007001",
  workflow_key: "synthetic.core.runtime-proof",
  version: "1.0.0",
  name: "Synthetic durable workflow",
  description: "Proves durable workflow execution.",
  status: "qualified",
  stage_definition: {
    stages: [
      { key: "start", type: "system", sequence: 0 },
      { key: "worker-task", type: "worker", sequence: 1 },
      { key: "wait", type: "wait", sequence: 2 },
      { key: "review", type: "review", sequence: 3 },
      { key: "complete", type: "terminal", sequence: 4 },
    ],
  },
};

const run = {
  id: "00000000-0000-4000-8000-000000007002",
  business_id: "00000000-0000-4000-8000-000000007003",
  workflow_definition_id: definition.id,
  status: "needs_owner",
  current_stage_key: "review",
  input: {},
  state: {},
  runtime_provider: "vercel_workflow",
  runtime_run_id: "wrun-stage7",
  started_at: "2026-09-29T00:00:00.000Z",
  completed_at: null,
  created_at: "2026-09-29T00:00:00.000Z",
  updated_at: "2026-09-29T00:01:00.000Z",
};

const intervention = {
  id: "00000000-0000-4000-8000-000000007004",
  business_id: run.business_id,
  workflow_run_id: run.id,
  intervention_type: "synthetic_workflow_review",
  status: "open",
  title: "Review the worker result",
  description: "Approve or fail this bounded workflow.",
  options: {},
  resolution: {},
  requested_at: "2026-09-29T00:01:00.000Z",
  resolved_at: null,
  created_at: "2026-09-29T00:01:00.000Z",
  updated_at: "2026-09-29T00:01:00.000Z",
};

const reviewEvent = {
  id: "00000000-0000-4000-8000-000000007005",
  business_id: run.business_id,
  workflow_run_id: run.id,
  event_type: "workflow.owner_intervention.requested",
  actor_type: "system",
  actor_id: null,
  payload: { stageKey: "review" },
  occurred_at: "2026-09-29T00:01:00.000Z",
  created_at: "2026-09-29T00:01:00.000Z",
};

test("Stage 7 orders the definition timeline and preserves the latest stage attempt", () => {
  assert.deepEqual(
    stageBlueprints(definition).map((stage) => stage.key),
    ["start", "worker-task", "wait", "review", "complete"],
  );

  const latest = latestStageByKey([
    {
      id: "00000000-0000-4000-8000-000000007010",
      workflow_run_id: run.id,
      stage_key: "worker-task",
      sequence: 1,
      attempt: 1,
      status: "failed",
      input: {},
      output: {},
      failure: { category: "transient" },
      started_at: null,
      completed_at: null,
      created_at: run.created_at,
      updated_at: run.updated_at,
    },
    {
      id: "00000000-0000-4000-8000-000000007011",
      workflow_run_id: run.id,
      stage_key: "worker-task",
      sequence: 1,
      attempt: 2,
      status: "completed",
      input: {},
      output: {},
      failure: {},
      started_at: null,
      completed_at: null,
      created_at: run.created_at,
      updated_at: run.updated_at,
    },
  ]);

  assert.equal(latest.get("worker-task").attempt, 2);
  assert.equal(latest.get("worker-task").status, "completed");
});

test("Stage 7 explains the current owner decision and next step without raw logs", () => {
  assert.equal(openIntervention([intervention]), intervention);
  assert.equal(
    deriveCurrentAction(run, reviewEvent, intervention),
    "Review the worker result",
  );
  assert.equal(deriveNextStep(run, definition, intervention), "Waiting for your decision");
  assert.equal(statusLabel(run.status), "Needs you");
  assert.equal(statusTone(run.status), "attention");
});

test("Stage 7 translates durable events into owner-readable activity", () => {
  assert.equal(eventLabel(reviewEvent.event_type), "Owner decision requested");
  assert.equal(eventDetail(reviewEvent), "Review");

  const modelEvent = {
    ...reviewEvent,
    event_type: "model.invocation.completed",
    payload: { modelKey: "luna.standard", attempt: 1 },
  };
  assert.equal(eventLabel(modelEvent.event_type), "Model response completed");
  assert.equal(eventDetail(modelEvent), "luna.standard, attempt 1");
});

test("Stage 7 derives the next stage for active non-intervention workflows", () => {
  const waitingRun = {
    ...run,
    status: "waiting",
    current_stage_key: "wait",
  };
  assert.equal(deriveCurrentAction(waitingRun, null, null), "Waiting for the next step");
  assert.equal(deriveNextStep(waitingRun, definition, null), "Review");
});
