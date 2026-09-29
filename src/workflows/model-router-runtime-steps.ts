import { FatalError } from "workflow";

import type { JsonObject } from "../core/contracts";
import { OpenRouterAdapter } from "../models/openrouter";
import { buildWorkerModelMessages } from "../models/prompt";
import { resolveModelRoute } from "../models/registry";
import { runModelRoute } from "../models/router";
import type {
  ModelRouteAttempt,
  ModelRouteKey,
  ModelRouteRunResult,
} from "../models/types";
import { ModelRouterError } from "../models/types";
import { createRuntimeClient } from "../lib/supabase/runtime";
import {
  MODEL_RESEARCHER_MANIFEST,
  MODEL_RESEARCHER_ROUTE_KEY,
} from "../workers/generic-researcher-model";
import { executeWorkerPack, validateWorkerInvocationContext } from "../workers/runtime";
import type {
  WorkerExecutionReceipt,
  WorkerInvocationContext,
} from "../workers/types";
import { WorkerRuntimeError } from "../workers/types";
import type { ModelRouterRuntimeInput } from "./model-router-runtime";

type JsonRecord = Record<string, unknown>;

type ModelWorkerStepResult = {
  output: JsonObject;
  receipt: WorkerExecutionReceipt;
  selectedModelKey: string;
  modelRouteKey: string;
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
  input: ModelRouterRuntimeInput,
  operation: string,
  payload: JsonObject = {},
) {
  const supabase = createRuntimeClient();
  const { data, error } = await supabase.rpc("stage5_model_runtime_transition", {
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

export async function startModelRouterRuntime(
  input: ModelRouterRuntimeInput,
  runtimeRunId: string,
) {
  "use step";

  await transition(input, "runtime_started", { runtimeRunId });
}

export async function prepareModelResearcherTask(
  input: ModelRouterRuntimeInput,
): Promise<WorkerInvocationContext> {
  "use step";

  const prepared = await transition(input, "prepare_task", {
    proofMode: input.proofMode,
  });

  if (!prepared.context) {
    throw new Error("The Stage 5 runtime did not return a worker context.");
  }

  return prepared.context as WorkerInvocationContext;
}

function persistedResult(started: JsonRecord): ModelWorkerStepResult | null {
  if (
    started.completed !== true ||
    !isRecord(started.output) ||
    !isRecord(started.receipt) ||
    typeof started.selectedModelKey !== "string" ||
    typeof started.modelRouteKey !== "string"
  ) {
    return null;
  }

  return {
    output: started.output as JsonObject,
    receipt: started.receipt as WorkerExecutionReceipt,
    selectedModelKey: started.selectedModelKey,
    modelRouteKey: started.modelRouteKey,
  };
}

function attemptJson(attempt: ModelRouteAttempt): JsonObject {
  return {
    attempt: attempt.attempt,
    modelKey: attempt.modelKey,
    providerModelId: attempt.providerModelId,
    providerFamily: attempt.providerFamily,
    outcome: attempt.outcome,
    failureCategory: attempt.failureCategory,
    failureMessage: attempt.failureMessage,
    latencyMs: attempt.latencyMs,
    provider: attempt.provider,
    providerRequestId: attempt.providerRequestId,
    usage: attempt.usage
      ? {
          inputTokens: attempt.usage.inputTokens,
          outputTokens: attempt.usage.outputTokens,
          totalTokens: attempt.usage.totalTokens,
          cachedInputTokens: attempt.usage.cachedInputTokens,
          reasoningTokens: attempt.usage.reasoningTokens,
          reportedCostUsd: attempt.usage.reportedCostUsd,
          estimatedCostUsd: attempt.usage.estimatedCostUsd,
        }
      : null,
    metadata: attempt.metadata,
  };
}

function failurePayload(error: unknown): JsonObject {
  if (error instanceof ModelRouterError) {
    return {
      category: error.category,
      message: error.message.slice(0, 500),
      details: {
        ...error.details,
        attempts: error.attempts.map(attemptJson),
      },
    };
  }

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
      error instanceof Error ? error.message.slice(0, 500) : "Model worker failed.",
    details: {},
  };
}

function readRouteKey(): ModelRouteKey {
  const value = MODEL_RESEARCHER_MANIFEST.modelRequirements.routeKey;
  if (value !== MODEL_RESEARCHER_ROUTE_KEY) {
    throw new WorkerRuntimeError(
      "contract_invalid",
      "The model-backed Worker Pack route requirement is invalid.",
    );
  }
  return value;
}

function routeReceipt(
  validatedReceipt: WorkerExecutionReceipt,
  routeResult: ModelRouteRunResult,
): WorkerExecutionReceipt {
  return {
    ...validatedReceipt,
    modelRouteKey: routeResult.routeKey,
    selectedModelKey: routeResult.selectedModel.modelKey,
    selectedProviderFamily: routeResult.selectedModel.providerFamily,
    providerModelId: routeResult.providerResponse.providerModelId,
    provider: routeResult.providerResponse.provider,
    providerRequestId: routeResult.providerResponse.providerRequestId,
    routeAttempts: routeResult.attempts.map(attemptJson),
    routeAttemptCount: routeResult.attempts.length,
    inputTokens: routeResult.providerResponse.usage.inputTokens,
    outputTokens: routeResult.providerResponse.usage.outputTokens,
    totalTokens: routeResult.providerResponse.usage.totalTokens,
    reportedCostUsd: routeResult.totalReportedCostUsd,
    estimatedCostUsd: routeResult.totalEstimatedCostUsd,
  };
}

export async function executeModelRoutedResearcher(
  input: ModelRouterRuntimeInput,
  context: WorkerInvocationContext,
): Promise<ModelWorkerStepResult> {
  "use step";

  try {
    validateWorkerInvocationContext(MODEL_RESEARCHER_MANIFEST, context);
    const routeKey = readRouteKey();
    const resolved = resolveModelRoute(routeKey);

    await transition(input, "route_resolved", {
      routeKey,
      primaryModelKey: resolved.primary.modelKey,
      fallbackModelKey: resolved.fallback.modelKey,
      maximumAttempts: resolved.route.maximumAttempts,
    });

    const started = await transition(input, "worker_started");
    const existing = persistedResult(started);
    if (existing) {
      return existing;
    }

    if (started.failed === true) {
      throw new FatalError(
        `Model-backed Generic Researcher already failed with category ${String(
          started.failureCategory ?? "worker_execution_failed",
        )}.`,
      );
    }

    const adapter = new OpenRouterAdapter();
    const routeResult = await runModelRoute({
      adapter,
      routeKey,
      outputSchema: MODEL_RESEARCHER_MANIFEST.outputSchema,
      schemaName: "agent_labs_generic_researcher_output",
      messages: buildWorkerModelMessages(MODEL_RESEARCHER_MANIFEST, context),
      requestMetadata: {
        businessId: input.businessId,
        workflowRunId: input.coreWorkflowRunId,
        taskContractId: context.taskContract.id,
        workerKey: MODEL_RESEARCHER_MANIFEST.worker.workerKey,
        workerVersion: MODEL_RESEARCHER_MANIFEST.worker.version,
      },
      forcePrimaryFailure: input.proofMode === "fallback-proof",
      telemetry: {
        onAttemptStarted: async ({ attempt, model }) => {
          await transition(input, "invocation_started", {
            attempt,
            routeKey,
            modelKey: model.modelKey,
            providerModelId: model.providerModelId,
            providerFamily: model.providerFamily,
          });
        },
        onAttemptFinished: async ({ attempt }) => {
          await transition(
            input,
            attempt.outcome === "completed"
              ? "invocation_completed"
              : "invocation_failed",
            attemptJson(attempt),
          );
        },
      },
    });

    const validated = executeWorkerPack(
      MODEL_RESEARCHER_MANIFEST,
      () => routeResult.output,
      context,
    );
    const receipt = routeReceipt(validated.receipt, routeResult);

    await transition(input, "worker_completed", {
      output: validated.output,
      receipt,
      routeKey: routeResult.routeKey,
      selectedModelKey: routeResult.selectedModel.modelKey,
      selectedProviderModelId: routeResult.providerResponse.providerModelId,
      routeAttemptCount: routeResult.attempts.length,
      reportedCostUsd: routeResult.totalReportedCostUsd,
      estimatedCostUsd: routeResult.totalEstimatedCostUsd,
    });

    return {
      output: validated.output,
      receipt,
      selectedModelKey: routeResult.selectedModel.modelKey,
      modelRouteKey: routeResult.routeKey,
    };
  } catch (error) {
    const failure = failurePayload(error);
    await transition(input, "worker_failed", failure);
    throw new FatalError(`${String(failure.category)}: ${String(failure.message)}`);
  }
}
