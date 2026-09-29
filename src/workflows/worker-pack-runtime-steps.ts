import { FatalError } from "workflow";

import type { JsonObject } from "../core/contracts";
import { createRuntimeClient } from "../lib/supabase/runtime";
import {
  GENERIC_RESEARCHER_VERSION,
  GENERIC_RESEARCHER_WORKER_KEY,
} from "../workers/generic-researcher";
import { getRegisteredWorkerPack } from "../workers/registry";
import { executeWorkerPack } from "../workers/runtime";
import type {
  WorkerExecutionReceipt,
  WorkerInvocationContext,
} from "../workers/types";
import { WorkerRuntimeError } from "../workers/types";
import type { WorkerPackRuntimeInput } from "./worker-pack-runtime";

type JsonRecord = Record<string, unknown>;

type WorkerStepResult = {
  output: JsonObject;
  receipt: WorkerExecutionReceipt;
};

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function errorMessage(error: unknown) {
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  return "Unknown Supabase error";
}

async function transition(
  input: WorkerPackRuntimeInput,
  operation: string,
  payload: JsonObject = {},
) {
  const supabase = createRuntimeClient();
  const { data, error } = await supabase.rpc("stage4_worker_runtime_transition", {
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

export async function startWorkerPackRuntime(
  input: WorkerPackRuntimeInput,
  runtimeRunId: string,
) {
  "use step";

  await transition(input, "runtime_started", { runtimeRunId });
}

export async function prepareGenericResearcherTask(
  input: WorkerPackRuntimeInput,
): Promise<WorkerInvocationContext> {
  "use step";

  const prepared = await transition(input, "prepare_task", {
    fixtureMode: input.fixtureMode,
  });

  if (!prepared.context) {
    throw new Error("The Stage 4 runtime did not return a worker context.");
  }

  return prepared.context as WorkerInvocationContext;
}

function persistedResult(started: JsonRecord): WorkerStepResult | null {
  if (
    started.completed !== true ||
    !isRecord(started.output) ||
    !isRecord(started.receipt)
  ) {
    return null;
  }

  return {
    output: started.output as JsonObject,
    receipt: started.receipt as WorkerExecutionReceipt,
  };
}

function failurePayload(error: unknown): JsonObject {
  if (error instanceof WorkerRuntimeError) {
    return {
      category: error.category,
      message: error.message.slice(0, 500),
      details: error.details,
    };
  }

  return {
    category: "worker_execution_failed",
    message:
      error instanceof Error ? error.message.slice(0, 500) : "Worker execution failed.",
    details: {},
  };
}

export async function executeGenericResearcherWorker(
  input: WorkerPackRuntimeInput,
  context: WorkerInvocationContext,
): Promise<WorkerStepResult> {
  "use step";

  const started = await transition(input, "worker_started");
  const existing = persistedResult(started);
  if (existing) {
    return existing;
  }

  if (started.failed === true) {
    throw new FatalError(
      `Generic Researcher already failed with category ${String(
        started.failureCategory ?? "worker_execution_failed",
      )}.`,
    );
  }

  const registered = getRegisteredWorkerPack(
    GENERIC_RESEARCHER_WORKER_KEY,
    GENERIC_RESEARCHER_VERSION,
  );

  let result: WorkerStepResult;
  try {
    result = executeWorkerPack(registered.manifest, registered.execute, context);
  } catch (error) {
    const failure = failurePayload(error);
    await transition(input, "worker_failed", failure);
    throw new FatalError(`${String(failure.category)}: ${String(failure.message)}`);
  }

  await transition(input, "worker_completed", {
    output: result.output,
    receipt: result.receipt,
  });

  return result;
}
