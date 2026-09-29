"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  getRegisteredWorkerEvaluationSuite,
  runWorkerEvaluationSuite,
} from "../../../evaluations";
import { createRuntimeClient } from "../../../lib/supabase/runtime";
import { createClient } from "../../../lib/supabase/server";
import { isOpenRouterConfigured } from "../../../models/openrouter";
import {
  MODEL_RESEARCHER_MANIFEST,
  MODEL_RESEARCHER_WORKER_DEFINITION_ID,
  MODEL_RESEARCHER_WORKER_KEY,
  MODEL_RESEARCHER_VERSION,
} from "../../../workers/generic-researcher-model";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const EVALUATIONS_PATH = "/dashboard/worker-evaluations";

type EvaluationLaunch = {
  evaluation_id: string;
  should_start: boolean;
  status: string;
  subject_fingerprint: string;
};

type EvaluationCompletion = {
  evaluationId?: string;
  score?: number;
  status?: string;
};

function formText(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function evaluationRedirect(kind: "error" | "message", code: string): never {
  redirect(`${EVALUATIONS_PATH}?${kind}=${encodeURIComponent(code)}`);
}

async function requireOwnerSession() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || !userId) {
    redirect("/login?error=session-required");
  }
  return { supabase, userId };
}

export async function startWorkerEvaluation(formData: FormData) {
  const workerDefinitionId = formText(formData, "workerDefinitionId");
  const idempotencyKey = formText(formData, "idempotencyKey");

  if (
    workerDefinitionId !== MODEL_RESEARCHER_WORKER_DEFINITION_ID ||
    !UUID_PATTERN.test(workerDefinitionId) ||
    idempotencyKey.length < 1 ||
    idempotencyKey.length > 200
  ) {
    evaluationRedirect("error", "invalid-evaluation-launch");
  }

  if (!isOpenRouterConfigured()) {
    evaluationRedirect("error", "model-router-not-configured");
  }

  const suite = getRegisteredWorkerEvaluationSuite(
    MODEL_RESEARCHER_WORKER_KEY,
    MODEL_RESEARCHER_VERSION,
  );
  const { supabase } = await requireOwnerSession();
  const runtimeCapability = `${randomUUID()}${randomUUID()}`;
  const { data, error: launchError } = await supabase.rpc(
    "begin_worker_evaluation",
    {
      p_worker_definition_id: workerDefinitionId,
      p_suite_key: suite.suiteKey,
      p_suite_version: suite.version,
      p_idempotency_key: idempotencyKey,
      p_runtime_capability: runtimeCapability,
      p_source: "owner",
    },
  );

  const launch = (Array.isArray(data) ? data[0] : data) as EvaluationLaunch | null;
  if (launchError || !launch?.evaluation_id) {
    console.error("Unable to begin Worker evaluation", launchError);
    evaluationRedirect("error", "evaluation-reservation-failed");
  }

  if (!launch.should_start) {
    evaluationRedirect("message", "evaluation-duplicate-prevented");
  }

  const runtime = createRuntimeClient();
  let completion: EvaluationCompletion | null = null;

  try {
    await runWorkerEvaluationSuite({
      manifest: MODEL_RESEARCHER_MANIFEST,
      suite,
      onCaseFinished: async (evaluationCase, result) => {
        const telemetry = result.modelTelemetry;
        const usage = telemetry?.usage;
        const { error } = await runtime.rpc(
          "stage6_record_worker_evaluation_case",
          {
            p_evaluation_id: launch.evaluation_id,
            p_runtime_capability: runtimeCapability,
            p_case_key: evaluationCase.caseKey,
            p_status: result.status,
            p_score_awarded: result.scoreAwarded,
            p_model_key: telemetry?.modelKey ?? null,
            p_provider: telemetry?.provider ?? null,
            p_provider_model_id: telemetry?.providerModelId ?? null,
            p_provider_request_id: telemetry?.providerRequestId ?? null,
            p_latency_ms: telemetry?.latencyMs ?? null,
            p_usage: usage
              ? {
                  inputTokens: usage.inputTokens,
                  outputTokens: usage.outputTokens,
                  totalTokens: usage.totalTokens,
                  cachedInputTokens: usage.cachedInputTokens,
                  reasoningTokens: usage.reasoningTokens,
                  reportedCostUsd: usage.reportedCostUsd,
                  estimatedCostUsd: usage.estimatedCostUsd,
                }
              : {},
            p_output: result.output,
            p_failure: result.failureCategory
              ? {
                  category: result.failureCategory,
                  message: result.failureMessage,
                }
              : {},
            p_evidence: result.evidence,
          },
        );

        if (error) {
          throw new Error(
            `Unable to persist evaluation case ${evaluationCase.caseKey}: ${error.message}`,
          );
        }
      },
    });

    const { data: completionData, error: completionError } = await runtime.rpc(
      "stage6_complete_worker_evaluation",
      {
        p_evaluation_id: launch.evaluation_id,
        p_runtime_capability: runtimeCapability,
      },
    );
    if (completionError) {
      throw new Error(`Unable to complete Worker evaluation: ${completionError.message}`);
    }
    completion = completionData as EvaluationCompletion;
  } catch (error) {
    console.error("Worker evaluation failed", error);
    await runtime.rpc("stage6_complete_worker_evaluation", {
      p_evaluation_id: launch.evaluation_id,
      p_runtime_capability: runtimeCapability,
    });
    revalidatePath(EVALUATIONS_PATH);
    evaluationRedirect("error", "evaluation-run-failed");
  }

  revalidatePath(EVALUATIONS_PATH);
  revalidatePath("/dashboard");

  if (completion?.status === "passed") {
    evaluationRedirect("message", "worker-qualified");
  }
  if (completion?.status === "stale") {
    evaluationRedirect("error", "evaluation-became-stale");
  }
  evaluationRedirect("error", "worker-evaluation-failed");
}
