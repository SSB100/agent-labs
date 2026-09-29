import type { NextRequest } from "next/server";
import { start } from "workflow/api";

import type { JsonObject } from "@/core/contracts";
import { OpenRouterAdapter, isOpenRouterConfigured } from "@/models/openrouter";
import { getModelDefinition, MODEL_REGISTRY } from "@/models/registry";
import { ModelProviderError } from "@/models/types";
import {
  MODEL_ROUTER_RUNTIME_WORKFLOW_KEY,
  type ModelRouterRuntimeInput,
} from "@/workflows/model-router-runtime";
import { getRegisteredWorkflow } from "@/workflows/registry";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const QUALIFICATION_TOKEN = "qHe9YiH2Us0ICp3XqV3MzLyY4I5Gutxi_uu0feXTrFC-pkbm";
const STRUCTURED_TOKEN = "stage5-structured-output-proof";

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
} satisfies Record<"live" | "fallback", ModelRouterRuntimeInput>;

const structuredSchema: JsonObject = {
  type: "object",
  additionalProperties: false,
  required: ["token"],
  properties: {
    token: {
      type: "string",
      const: STRUCTURED_TOKEN,
    },
  },
};

function unavailable() {
  return Response.json({ error: "Not found" }, { status: 404 });
}

function authorized(request: NextRequest) {
  return (
    process.env.VERCEL_ENV === "preview" &&
    request.nextUrl.searchParams.get("token") === QUALIFICATION_TOKEN
  );
}

function usageJson(usage: {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  reportedCostUsd: number | null;
  estimatedCostUsd: number;
}) {
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

async function startFixture(kind: "live" | "fallback") {
  const fixture = fixtures[kind];
  const registered = getRegisteredWorkflow(MODEL_ROUTER_RUNTIME_WORKFLOW_KEY);
  const runtimeRun = await start(registered.workflow, [fixture]);

  return Response.json({
    action: `start-${kind}`,
    coreWorkflowRunId: fixture.coreWorkflowRunId,
    runtimeRunId: runtimeRun.runId,
    started: true,
  });
}

async function qualifyModel(modelKey: string) {
  const model = getModelDefinition(modelKey);
  const adapter = new OpenRouterAdapter();

  const [structured, tool] = await Promise.all([
    adapter.invokeStructured({
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
        modelKey,
      },
    }),
    adapter.qualifyToolUse({
      model,
      token: `stage5-tool-proof:${modelKey}`,
      requestMetadata: {
        qualification: "stage5-live-tool-use",
        modelKey,
      },
    }),
  ]);

  if (structured.output.token !== STRUCTURED_TOKEN) {
    throw new ModelProviderError(
      "malformed_model_output",
      "The model did not preserve the structured qualification token.",
      false,
      { modelKey },
    );
  }

  return Response.json({
    action: "qualify-model",
    modelKey,
    providerFamily: model.providerFamily,
    requestedProviderModelId: model.providerModelId,
    structuredOutput: {
      provider: structured.provider,
      providerModelId: structured.providerModelId,
      providerRequestId: structured.providerRequestId,
      latencyMs: structured.latencyMs,
      usage: usageJson(structured.usage),
      validated: true,
    },
    toolUse: {
      provider: tool.provider,
      providerModelId: tool.providerModelId,
      providerRequestId: tool.providerRequestId,
      latencyMs: tool.latencyMs,
      usage: usageJson(tool.usage),
      toolName: tool.toolName,
      validated: true,
    },
  });
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return unavailable();
  }

  const action = request.nextUrl.searchParams.get("action") ?? "status";

  if (action === "status") {
    return Response.json({
      configured: isOpenRouterConfigured(),
      environment: process.env.VERCEL_ENV ?? null,
      modelKeys: Object.keys(MODEL_REGISTRY),
    });
  }

  if (!isOpenRouterConfigured()) {
    return Response.json(
      {
        error: "OPENROUTER_API_KEY is not configured in this Preview deployment.",
        category: "configuration_required",
      },
      { status: 503 },
    );
  }

  try {
    if (action === "start-live") {
      return await startFixture("live");
    }

    if (action === "start-fallback") {
      return await startFixture("fallback");
    }

    if (action === "qualify-model") {
      const modelKey = request.nextUrl.searchParams.get("model") ?? "";
      if (!(modelKey in MODEL_REGISTRY)) {
        return Response.json({ error: "Unknown model key" }, { status: 400 });
      }
      return await qualifyModel(modelKey);
    }

    return Response.json({ error: "Unsupported qualification action" }, { status: 400 });
  } catch (error) {
    if (error instanceof ModelProviderError) {
      return Response.json(
        {
          error: error.message,
          category: error.category,
          retryable: error.retryable,
          details: error.details,
        },
        { status: 502 },
      );
    }

    return Response.json(
      {
        error: error instanceof Error ? error.message : "Qualification failed",
        category: "qualification_failed",
      },
      { status: 500 },
    );
  }
}
