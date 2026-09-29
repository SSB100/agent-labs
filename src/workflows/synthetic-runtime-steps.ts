import { createHash } from "node:crypto";

import { RetryableError } from "workflow";

import { createAdminClient } from "@/lib/supabase/admin";

import type { SyntheticReviewDecision, SyntheticRuntimeInput } from "./synthetic-runtime";

const STAGES = {
  complete: { key: "complete", sequence: 4 },
  review: { key: "review", sequence: 3 },
  start: { key: "start", sequence: 0 },
  wait: { key: "wait", sequence: 2 },
  workerTask: { key: "worker-task", sequence: 1 },
} as const;

type JsonRecord = Record<string, unknown>;
type StageDefinition = (typeof STAGES)[keyof typeof STAGES];

type FailureSummary = {
  message: string;
  name: string;
};

function now() {
  return new Date().toISOString();
}

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function stableUuid(value: string) {
  const bytes = Buffer.from(createHash("sha256").update(value).digest("hex").slice(0, 32), "hex");
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function errorMessage(error: unknown) {
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }

  return "Unknown Supabase error";
}

function assertNoError(error: unknown, operation: string) {
  if (error) {
    throw new Error(`${operation}: ${errorMessage(error)}`);
  }
}

async function getWorkflowRun(input: SyntheticRuntimeInput) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("workflow_runs")
    .select("id, business_id, state, status, started_at")
    .eq("id", input.coreWorkflowRunId)
    .single();

  assertNoError(error, "Load workflow run");

  if (!data || data.business_id !== input.businessId) {
    throw new Error("Workflow run does not belong to the expected Business.");
  }

  return data;
}

async function patchWorkflowRun(
  input: SyntheticRuntimeInput,
  values: JsonRecord,
  statePatch: JsonRecord = {},
) {
  const current = await getWorkflowRun(input);
  const state = {
    ...asRecord(current.state),
    ...statePatch,
  };
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("workflow_runs")
    .update({
      ...values,
      state,
    })
    .eq("id", input.coreWorkflowRunId)
    .eq("business_id", input.businessId);

  assertNoError(error, "Update workflow run");
}

async function ensureStage(
  input: SyntheticRuntimeInput,
  stage: StageDefinition,
  attempt: number,
  status: string,
  values: JsonRecord = {},
) {
  const supabase = createAdminClient();
  const { error } = await supabase.from("workflow_stage_runs").upsert(
    {
      attempt,
      business_id: input.businessId,
      failure: {},
      input: {},
      output: {},
      sequence: stage.sequence,
      stage_key: stage.key,
      started_at: now(),
      status,
      workflow_run_id: input.coreWorkflowRunId,
      ...values,
    },
    {
      onConflict: "workflow_run_id,stage_key,attempt",
    },
  );

  assertNoError(error, `Upsert ${stage.key} stage`);
}

async function updateStage(
  input: SyntheticRuntimeInput,
  stage: StageDefinition,
  attempt: number,
  values: JsonRecord,
) {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("workflow_stage_runs")
    .update(values)
    .eq("workflow_run_id", input.coreWorkflowRunId)
    .eq("business_id", input.businessId)
    .eq("stage_key", stage.key)
    .eq("attempt", attempt);

  assertNoError(error, `Update ${stage.key} stage`);
}

async function emitEvent(
  input: SyntheticRuntimeInput,
  eventKey: string,
  eventType: string,
  payload: JsonRecord,
  actorType: "owner" | "provider" | "system" | "worker" = "system",
  actorId: string | null = null,
) {
  const supabase = createAdminClient();
  const { error } = await supabase.from("events").upsert(
    {
      actor_id: actorId,
      actor_type: actorType,
      business_id: input.businessId,
      event_type: eventType,
      id: stableUuid(`event:${input.coreWorkflowRunId}:${eventKey}`),
      occurred_at: now(),
      payload,
      workflow_run_id: input.coreWorkflowRunId,
    },
    {
      ignoreDuplicates: true,
      onConflict: "id",
    },
  );

  assertNoError(error, `Emit ${eventType}`);
}

export async function startSyntheticWorkflow(
  input: SyntheticRuntimeInput,
  runtimeRunId: string,
) {
  "use step";

  const timestamp = now();
  await patchWorkflowRun(
    input,
    {
      current_stage_key: STAGES.start.key,
      runtime_launch_status: "started",
      runtime_provider: "vercel_workflow",
      runtime_run_id: runtimeRunId,
      started_at: timestamp,
      status: "running",
    },
    {
      runtimeRunId,
    },
  );

  await ensureStage(input, STAGES.start, 1, "completed", {
    completed_at: timestamp,
    output: {
      runtimeRunId,
    },
    started_at: timestamp,
  });

  await emitEvent(input, "started", "workflow.started", {
    runtimeRunId,
    workflowKey: "synthetic.core.runtime-proof",
  });
  await emitEvent(input, "stage:start:completed", "workflow.stage.completed", {
    stageKey: STAGES.start.key,
  });
}

export async function executeSyntheticWorkerTask(input: SyntheticRuntimeInput) {
  "use step";

  const current = await getWorkflowRun(input);
  const currentState = asRecord(current.state);

  if (currentState.workerTaskCompleted === true) {
    return {
      attempt: Number(currentState.syntheticWorkerAttempts ?? 2),
      result: "synthetic-task-complete",
    };
  }

  const supabase = createAdminClient();
  const { data: attemptData, error: attemptError } = await supabase.rpc(
    "stage3_claim_synthetic_worker_attempt",
    {
      p_workflow_run_id: input.coreWorkflowRunId,
    },
  );

  assertNoError(attemptError, "Claim synthetic worker attempt");

  const attempt = Number(attemptData);
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error("The synthetic worker attempt counter was invalid.");
  }

  await patchWorkflowRun(input, {
    current_stage_key: STAGES.workerTask.key,
    status: "running",
  });
  await ensureStage(input, STAGES.workerTask, attempt, "running");
  await emitEvent(
    input,
    `stage:worker-task:${attempt}:started`,
    "workflow.stage.started",
    {
      attempt,
      stageKey: STAGES.workerTask.key,
    },
    "worker",
    "synthetic-worker",
  );

  if (attempt === 1) {
    const failure = {
      category: "synthetic_transient_failure",
      message: "The Stage 3 proof intentionally fails its first worker attempt.",
      retryable: true,
    };

    await updateStage(input, STAGES.workerTask, attempt, {
      completed_at: now(),
      failure,
      status: "failed",
    });
    await emitEvent(
      input,
      "worker-task:retry-scheduled",
      "workflow.retry.scheduled",
      {
        attempt,
        retryAfter: "1s",
        stageKey: STAGES.workerTask.key,
      },
      "worker",
      "synthetic-worker",
    );

    throw new RetryableError("Synthetic transient failure for retry qualification.", {
      retryAfter: "1s",
    });
  }

  const completedAt = now();
  const result = {
    attempt,
    result: "synthetic-task-complete",
  };

  await updateStage(input, STAGES.workerTask, attempt, {
    completed_at: completedAt,
    output: result,
    status: "completed",
  });
  await patchWorkflowRun(
    input,
    {
      current_stage_key: STAGES.wait.key,
      status: "running",
    },
    {
      syntheticWorkerAttempts: attempt,
      workerTaskCompleted: true,
    },
  );
  await emitEvent(
    input,
    `stage:worker-task:${attempt}:completed`,
    "workflow.stage.completed",
    {
      attempt,
      stageKey: STAGES.workerTask.key,
    },
    "worker",
    "synthetic-worker",
  );

  return result;
}

export async function enterWaitStage(input: SyntheticRuntimeInput) {
  "use step";

  await ensureStage(input, STAGES.wait, 1, "waiting", {
    output: {
      duration: "5s",
    },
  });
  await patchWorkflowRun(input, {
    current_stage_key: STAGES.wait.key,
    status: "waiting",
  });
  await emitEvent(input, "stage:wait:started", "workflow.wait.started", {
    duration: "5s",
    stageKey: STAGES.wait.key,
  });
}

export async function completeWaitStage(input: SyntheticRuntimeInput) {
  "use step";

  await updateStage(input, STAGES.wait, 1, {
    completed_at: now(),
    output: {
      duration: "5s",
      resumed: true,
    },
    status: "completed",
  });
  await patchWorkflowRun(input, {
    current_stage_key: STAGES.review.key,
    status: "running",
  });
  await emitEvent(input, "stage:wait:completed", "workflow.wait.completed", {
    stageKey: STAGES.wait.key,
  });
}

export async function enterReviewStage(input: SyntheticRuntimeInput) {
  "use step";

  const requestedAt = now();
  const interventionId = stableUuid(`intervention:${input.coreWorkflowRunId}:review`);
  const supabase = createAdminClient();

  await ensureStage(input, STAGES.review, 1, "review", {
    started_at: requestedAt,
  });

  const { error } = await supabase.from("owner_interventions").upsert(
    {
      action_intent_id: null,
      business_id: input.businessId,
      description:
        "Approve the Stage 3 synthetic runtime proof to complete it, or fail it to verify the durable failure path.",
      id: interventionId,
      intervention_type: "synthetic_workflow_review",
      options: [
        {
          id: "approve",
          label: "Approve and complete",
        },
        {
          id: "fail",
          label: "Fail workflow",
        },
      ],
      requested_at: requestedAt,
      resolution: {},
      resolved_at: null,
      status: "open",
      title: "Review synthetic workflow",
      workflow_run_id: input.coreWorkflowRunId,
    },
    {
      onConflict: "id",
    },
  );

  assertNoError(error, "Create owner intervention");

  await patchWorkflowRun(input, {
    current_stage_key: STAGES.review.key,
    status: "needs_owner",
  });
  await emitEvent(
    input,
    "intervention:review:requested",
    "workflow.owner_intervention.requested",
    {
      interventionId,
      stageKey: STAGES.review.key,
    },
  );
}

export async function resolveReviewStage(
  input: SyntheticRuntimeInput,
  decision: SyntheticReviewDecision,
) {
  "use step";

  const resolvedAt = now();
  const interventionId = stableUuid(`intervention:${input.coreWorkflowRunId}:review`);
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("owner_interventions")
    .update({
      resolution: {
        decidedAt: decision.decidedAt,
        decision: decision.decision,
        ownerUserId: decision.ownerUserId,
      },
      resolved_at: resolvedAt,
      status: "resolved",
    })
    .eq("id", interventionId)
    .eq("business_id", input.businessId);

  assertNoError(error, "Resolve owner intervention");

  await updateStage(input, STAGES.review, 1, {
    completed_at: resolvedAt,
    output: {
      decision: decision.decision,
      ownerUserId: decision.ownerUserId,
    },
    status: "completed",
  });
  await patchWorkflowRun(input, {
    current_stage_key: STAGES.complete.key,
    status: "running",
  });
  await emitEvent(
    input,
    "intervention:review:approved",
    "workflow.owner_intervention.resolved",
    {
      decision: decision.decision,
      interventionId,
    },
    "owner",
    decision.ownerUserId,
  );
  await emitEvent(input, "stage:review:completed", "workflow.stage.completed", {
    stageKey: STAGES.review.key,
  });
}

export async function failReviewStage(
  input: SyntheticRuntimeInput,
  decision: SyntheticReviewDecision,
) {
  "use step";

  const failedAt = now();
  const interventionId = stableUuid(`intervention:${input.coreWorkflowRunId}:review`);
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("owner_interventions")
    .update({
      resolution: {
        decidedAt: decision.decidedAt,
        decision: decision.decision,
        ownerUserId: decision.ownerUserId,
      },
      resolved_at: failedAt,
      status: "declined",
    })
    .eq("id", interventionId)
    .eq("business_id", input.businessId);

  assertNoError(error, "Decline owner intervention");

  await updateStage(input, STAGES.review, 1, {
    completed_at: failedAt,
    failure: {
      category: "owner_rejected",
      message: "The owner selected the failure path.",
    },
    status: "failed",
  });
  await patchWorkflowRun(
    input,
    {
      completed_at: failedAt,
      current_stage_key: STAGES.review.key,
      status: "failed",
    },
    {
      outcome: "owner_rejected",
    },
  );
  await emitEvent(
    input,
    "intervention:review:failed",
    "workflow.owner_intervention.resolved",
    {
      decision: decision.decision,
      interventionId,
    },
    "owner",
    decision.ownerUserId,
  );
  await emitEvent(input, "workflow:failed:owner", "workflow.failed", {
    category: "owner_rejected",
    stageKey: STAGES.review.key,
  });
}

export async function completeSyntheticWorkflow(input: SyntheticRuntimeInput) {
  "use step";

  const completedAt = now();
  await ensureStage(input, STAGES.complete, 1, "completed", {
    completed_at: completedAt,
    output: {
      result: "stage-3-runtime-qualified",
    },
    started_at: completedAt,
  });
  await patchWorkflowRun(
    input,
    {
      completed_at: completedAt,
      current_stage_key: STAGES.complete.key,
      status: "completed",
    },
    {
      outcome: "completed",
    },
  );
  await emitEvent(input, "stage:complete:completed", "workflow.stage.completed", {
    stageKey: STAGES.complete.key,
  });
  await emitEvent(input, "workflow:completed", "workflow.completed", {
    result: "stage-3-runtime-qualified",
  });
}

export async function recordUnexpectedWorkflowFailure(
  input: SyntheticRuntimeInput,
  stageKey: string,
  failure: FailureSummary,
) {
  "use step";

  const failedAt = now();
  const supabase = createAdminClient();
  const { data: stageRun } = await supabase
    .from("workflow_stage_runs")
    .select("id")
    .eq("workflow_run_id", input.coreWorkflowRunId)
    .eq("business_id", input.businessId)
    .eq("stage_key", stageKey)
    .order("attempt", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (stageRun?.id) {
    const { error: stageError } = await supabase
      .from("workflow_stage_runs")
      .update({
        completed_at: failedAt,
        failure: {
          category: "unexpected_runtime_failure",
          ...failure,
        },
        status: "failed",
      })
      .eq("id", stageRun.id);

    assertNoError(stageError, "Record failed workflow stage");
  }

  await patchWorkflowRun(
    input,
    {
      completed_at: failedAt,
      current_stage_key: stageKey,
      status: "failed",
    },
    {
      failure: {
        category: "unexpected_runtime_failure",
        ...failure,
      },
      outcome: "failed",
    },
  );
  await emitEvent(input, `workflow:failed:${stageKey}`, "workflow.failed", {
    category: "unexpected_runtime_failure",
    stageKey,
    ...failure,
  });
}
