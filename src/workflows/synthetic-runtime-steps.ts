import { RetryableError } from "workflow";

import { createRuntimeClient } from "@/lib/supabase/runtime";

import type { SyntheticReviewDecision, SyntheticRuntimeInput } from "./synthetic-runtime";

type JsonRecord = Record<string, unknown>;

type FailureSummary = {
  message: string;
  name: string;
};

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function errorMessage(error: unknown) {
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }

  return "Unknown Supabase error";
}

async function transition(
  input: SyntheticRuntimeInput,
  operation: string,
  payload: JsonRecord = {},
) {
  const supabase = createRuntimeClient();
  const { data, error } = await supabase.rpc("stage3_runtime_transition", {
    p_business_id: input.businessId,
    p_operation: operation,
    p_payload: payload,
    p_runtime_capability: input.runtimeCapability,
    p_workflow_run_id: input.coreWorkflowRunId,
  });

  if (error) {
    throw new Error(`${operation}: ${errorMessage(error)}`);
  }

  return asRecord(data);
}

export async function startSyntheticWorkflow(
  input: SyntheticRuntimeInput,
  runtimeRunId: string,
) {
  "use step";

  await transition(input, "runtime_started", { runtimeRunId });
}

export async function executeSyntheticWorkerTask(input: SyntheticRuntimeInput) {
  "use step";

  const started = await transition(input, "worker_attempt_started");
  const attempt = Number(started.attempt);

  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error("The synthetic worker attempt counter was invalid.");
  }

  if (started.completed === true) {
    return {
      attempt,
      result: "synthetic-task-complete",
    };
  }

  if (attempt === 1) {
    await transition(input, "worker_attempt_failed", { attempt });
    throw new RetryableError("Synthetic transient failure for retry qualification.", {
      retryAfter: "1s",
    });
  }

  await transition(input, "worker_attempt_completed", { attempt });

  return {
    attempt,
    result: "synthetic-task-complete",
  };
}

export async function enterWaitStage(input: SyntheticRuntimeInput) {
  "use step";

  await transition(input, "wait_started");
}

export async function completeWaitStage(input: SyntheticRuntimeInput) {
  "use step";

  await transition(input, "wait_completed");
}

export async function enterReviewStage(input: SyntheticRuntimeInput) {
  "use step";

  await transition(input, "review_requested");
}

export async function resolveReviewStage(
  input: SyntheticRuntimeInput,
  decision: SyntheticReviewDecision,
) {
  "use step";

  await transition(input, "review_approved", {
    decidedAt: decision.decidedAt,
    ownerUserId: decision.ownerUserId,
  });
}

export async function failReviewStage(
  input: SyntheticRuntimeInput,
  decision: SyntheticReviewDecision,
) {
  "use step";

  await transition(input, "review_failed", {
    decidedAt: decision.decidedAt,
    ownerUserId: decision.ownerUserId,
  });
}

export async function completeSyntheticWorkflow(input: SyntheticRuntimeInput) {
  "use step";

  await transition(input, "workflow_completed");
}

export async function recordUnexpectedWorkflowFailure(
  input: SyntheticRuntimeInput,
  stageKey: string,
  failure: FailureSummary,
) {
  "use step";

  await transition(input, "unexpected_failed", {
    message: failure.message,
    name: failure.name,
    stageKey,
  });
}
