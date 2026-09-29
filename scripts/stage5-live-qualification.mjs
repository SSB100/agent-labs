import { createClient } from "@supabase/supabase-js";

import openRouterModule from "../.core-tests/models/openrouter.js";
import promptModule from "../.core-tests/models/prompt.js";
import registryModule from "../.core-tests/models/registry.js";
import routerModule from "../.core-tests/models/router.js";
import modelWorkerModule from "../.core-tests/workers/generic-researcher-model.js";
import workerRuntimeModule from "../.core-tests/workers/runtime.js";

const { OpenRouterAdapter } = openRouterModule;
const { buildWorkerModelMessages } = promptModule;
const { MODEL_REGISTRY, resolveModelRoute } = registryModule;
const { runModelRoute } = routerModule;
const { MODEL_RESEARCHER_MANIFEST, MODEL_RESEARCHER_ROUTE_KEY } = modelWorkerModule;
const { executeWorkerPack } = workerRuntimeModule;

const QUALIFICATION_TOKEN =
  "dun0JHSqlfGDFmXUe_5rsK0Ld-Dq4tXYeUH0QytL6gkXxp09TVnbYVbm5_u2aCTK";
const STRUCTURED_TOKEN = "stage5-structured-output-proof";
const WORKFLOW_DEFINITION_ID = "00000000-0000-4000-8000-000000000503";

const fixtures = {
  live: {
    businessId: "00000000-0000-4000-8000-000000005501",
    coreWorkflowRunId: "00000000-0000-4000-8000-000000005511",
    proofMode: "live",
    runtimeCapability:
      "tKkEzOgHtzGjUJwBM-BTASEfM-o3iwIQSfWAmyU4yb8i3-WCmYWsmRgrG2j5aJ-G",
  },
  fallback: {
    businessId: "00000000-0000-4000-8000-000000005502",
    coreWorkflowRunId: "00000000-0000-4000-8000-000000005512",
    proofMode: "fallback-proof",
    runtimeCapability:
      "vWx82Vl7jwO3ZtIUf14BloPIxsx5JXBimw5Nk7tWiUnwsVhuPqnslgOkmO3kyR4_",
  },
};

const structuredSchema = {
  type: "object",
  additionalProperties: false,
  required: ["token"],
  properties: {
    token: { type: "string", const: STRUCTURED_TOKEN },
  },
};

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function categoryOf(error) {
  return error && typeof error === "object" && typeof error.category === "string"
    ? error.category
    : "qualification_failed";
}

function usageJson(usage) {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    cachedInputTokens: usage.cachedInputTokens,
    reasoningTokens: usage.reasoningTokens,
    reportedCostUsd: usage.reportedCostUsd,
    estimatedCostUsd: usage.estimatedCostUsd,
  };
}

function attemptJson(attempt) {
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
    usage: attempt.usage ? usageJson(attempt.usage) : null,
    metadata: attempt.metadata,
  };
}

if (process.env.VERCEL_ENV !== "preview") {
  console.log("Stage 5 live qualification skipped outside Vercel Preview.");
  process.exit(0);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const openRouterKey = process.env.OPENROUTER_API_KEY;

if (!supabaseUrl || !publishableKey || !openRouterKey) {
  throw new Error(
    "Stage 5 live qualification requires Supabase and OPENROUTER_API_KEY Preview variables.",
  );
}

const supabase = createClient(supabaseUrl, publishableKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const adapter = new OpenRouterAdapter();

async function recordQualification(modelKey, qualificationType, evidence) {
  const { data, error } = await supabase.rpc(
    "record_stage5_live_model_qualification",
    {
      p_evidence: evidence,
      p_model_key: modelKey,
      p_qualification_token: QUALIFICATION_TOKEN,
      p_qualification_type: qualificationType,
    },
  );

  if (error) {
    throw new Error(
      `Unable to record ${modelKey} ${qualificationType}: ${error.message}`,
    );
  }

  return data;
}

async function transition(fixture, operation, payload = {}) {
  const { data, error } = await supabase.rpc("stage5_model_runtime_transition", {
    p_business_id: fixture.businessId,
    p_operation: operation,
    p_payload: payload,
    p_runtime_capability: fixture.runtimeCapability,
    p_workflow_run_id: fixture.coreWorkflowRunId,
  });

  if (error) {
    throw new Error(`${operation}: ${error.message}`);
  }

  return data ?? {};
}

async function qualifyModel(model) {
  const outcomes = [];

  try {
    const structured = await adapter.invokeStructured({
      model,
      schemaName: "agent_labs_stage5_live_probe",
      outputSchema: structuredSchema,
      messages: [
        {
          role: "system",
          content:
            "Return only the JSON object required by the supplied schema. Preserve the exact token.",
        },
        {
          role: "user",
          content: `Return the qualification token ${JSON.stringify(STRUCTURED_TOKEN)}.`,
        },
      ],
      requestMetadata: {
        qualification: "stage5-live-structured-output",
        modelKey: model.modelKey,
      },
    });

    if (structured.output.token !== STRUCTURED_TOKEN) {
      throw new Error("The structured output did not preserve the qualification token.");
    }

    const evidence = {
      passed: true,
      provider: structured.provider,
      providerModelId: structured.providerModelId,
      providerRequestId: structured.providerRequestId,
      latencyMs: structured.latencyMs,
      usage: usageJson(structured.usage),
      source: "vercel_preview_live_qualification",
    };
    await recordQualification(model.modelKey, "structured_output", evidence);
    outcomes.push({ type: "structured_output", ...evidence });
  } catch (error) {
    const evidence = {
      passed: false,
      category: categoryOf(error),
      message: messageOf(error).slice(0, 500),
      source: "vercel_preview_live_qualification",
    };
    await recordQualification(model.modelKey, "structured_output", evidence);
    outcomes.push({ type: "structured_output", ...evidence });
  }

  try {
    const tool = await adapter.qualifyToolUse({
      model,
      token: `stage5-tool-proof:${model.modelKey}`,
      requestMetadata: {
        qualification: "stage5-live-tool-use",
        modelKey: model.modelKey,
      },
    });

    const evidence = {
      passed: true,
      provider: tool.provider,
      providerModelId: tool.providerModelId,
      providerRequestId: tool.providerRequestId,
      latencyMs: tool.latencyMs,
      usage: usageJson(tool.usage),
      toolName: tool.toolName,
      source: "vercel_preview_live_qualification",
    };
    await recordQualification(model.modelKey, "tool_use", evidence);
    outcomes.push({ type: "tool_use", ...evidence });
  } catch (error) {
    const evidence = {
      passed: false,
      category: categoryOf(error),
      message: messageOf(error).slice(0, 500),
      source: "vercel_preview_live_qualification",
    };
    await recordQualification(model.modelKey, "tool_use", evidence);
    outcomes.push({ type: "tool_use", ...evidence });
  }

  return { modelKey: model.modelKey, outcomes };
}

function routeReceipt(validatedReceipt, routeResult) {
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

async function runDurableProof(kind, forcePrimaryFailure) {
  const fixture = fixtures[kind];
  await transition(fixture, "runtime_started", {
    runtimeRunId: `stage5-build-qualification-${kind}`,
    workflowDefinitionId: WORKFLOW_DEFINITION_ID,
  });

  const prepared = await transition(fixture, "prepare_task", {
    proofMode: fixture.proofMode,
  });
  const context = prepared.context;
  if (!context) {
    throw new Error(`${kind}: Stage 5 did not return a Task Contract context.`);
  }

  const routeKey = MODEL_RESEARCHER_ROUTE_KEY;
  const resolved = resolveModelRoute(routeKey);
  await transition(fixture, "route_resolved", {
    routeKey,
    primaryModelKey: resolved.primary.modelKey,
    fallbackModelKey: resolved.fallback.modelKey,
    maximumAttempts: resolved.route.maximumAttempts,
  });

  const started = await transition(fixture, "worker_started");
  if (started.completed === true) {
    return {
      kind,
      reused: true,
      selectedModelKey: started.selectedModelKey,
      routeAttemptCount: started.receipt?.routeAttemptCount ?? null,
    };
  }
  if (started.failed === true) {
    throw new Error(`${kind}: the durable worker was already failed.`);
  }

  try {
    const routeResult = await runModelRoute({
      adapter,
      routeKey,
      outputSchema: MODEL_RESEARCHER_MANIFEST.outputSchema,
      schemaName: "agent_labs_generic_researcher_output",
      messages: buildWorkerModelMessages(MODEL_RESEARCHER_MANIFEST, context),
      requestMetadata: {
        businessId: fixture.businessId,
        workflowRunId: fixture.coreWorkflowRunId,
        taskContractId: context.taskContract.id,
        workerKey: MODEL_RESEARCHER_MANIFEST.worker.workerKey,
        workerVersion: MODEL_RESEARCHER_MANIFEST.worker.version,
      },
      forcePrimaryFailure,
      telemetry: {
        onAttemptStarted: async ({ attempt, model }) => {
          await transition(fixture, "invocation_started", {
            attempt,
            routeKey,
            modelKey: model.modelKey,
            providerModelId: model.providerModelId,
            providerFamily: model.providerFamily,
          });
        },
        onAttemptFinished: async ({ attempt }) => {
          await transition(
            fixture,
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

    await transition(fixture, "worker_completed", {
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
      kind,
      reused: false,
      routeKey: routeResult.routeKey,
      selectedModelKey: routeResult.selectedModel.modelKey,
      routeAttemptCount: routeResult.attempts.length,
      attempts: routeResult.attempts.map(attemptJson),
      totalReportedCostUsd: routeResult.totalReportedCostUsd,
      totalEstimatedCostUsd: routeResult.totalEstimatedCostUsd,
    };
  } catch (error) {
    const category = categoryOf(error);
    await transition(fixture, "worker_failed", {
      category,
      message: messageOf(error).slice(0, 500),
      details: {
        source: "vercel_preview_live_qualification",
        attempts:
          error && typeof error === "object" && Array.isArray(error.attempts)
            ? error.attempts.map(attemptJson)
            : [],
      },
    });
    throw error;
  }
}

const qualificationResults = [];
for (const model of Object.values(MODEL_REGISTRY)) {
  qualificationResults.push(await qualifyModel(model));
}

const failedQualifications = qualificationResults.flatMap((result) =>
  result.outcomes
    .filter((outcome) => outcome.passed !== true)
    .map((outcome) => ({ modelKey: result.modelKey, ...outcome })),
);

const routeResults = [];
if (failedQualifications.length === 0) {
  routeResults.push(await runDurableProof("live", false));
  routeResults.push(await runDurableProof("fallback", true));
}

console.log(
  `STAGE5_LIVE_QUALIFICATION=${JSON.stringify({
    qualificationResults,
    routeResults,
    failedQualifications,
  })}`,
);

if (failedQualifications.length > 0) {
  throw new Error(
    `Stage 5 live model qualification failed for ${failedQualifications.length} capability checks.`,
  );
}

const live = routeResults.find((result) => result.kind === "live");
const fallback = routeResults.find((result) => result.kind === "fallback");
if (
  !live ||
  live.selectedModelKey !== "luna.standard" ||
  live.routeAttemptCount !== 1 ||
  !fallback ||
  fallback.selectedModelKey !== "gemini.flash.large" ||
  fallback.routeAttemptCount !== 2
) {
  throw new Error("Stage 5 live route or independent fallback proof did not match policy.");
}
