"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { start } from "workflow/api";

import { isOpenRouterConfigured } from "../../../models/openrouter";
import { createClient } from "../../../lib/supabase/server";
import {
  MODEL_ROUTER_RUNTIME_WORKFLOW_KEY,
  type ModelRouterProofMode,
  type ModelRouterRuntimeInput,
} from "../../../workflows/model-router-runtime";
import { getRegisteredWorkflow } from "../../../workflows/registry";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type LaunchResult = {
  runtime_launch_status: string;
  should_start: boolean;
  workflow_run_id: string;
};

function formText(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function modelRouterRedirect(kind: "error" | "message", code: string): never {
  redirect(`/dashboard/model-router?${kind}=${encodeURIComponent(code)}`);
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

export async function startModelRouterProof(formData: FormData) {
  const businessId = formText(formData, "businessId");
  const idempotencyKey = formText(formData, "idempotencyKey");
  const launchNonce = formText(formData, "launchNonce");
  const proofModeValue = formText(formData, "proofMode");

  if (
    !UUID_PATTERN.test(businessId) ||
    !UUID_PATTERN.test(launchNonce) ||
    idempotencyKey.length < 1 ||
    idempotencyKey.length > 200 ||
    !["live", "fallback-proof"].includes(proofModeValue)
  ) {
    modelRouterRedirect("error", "invalid-model-router-launch");
  }

  if (!isOpenRouterConfigured()) {
    modelRouterRedirect("error", "model-router-not-configured");
  }

  const proofMode = proofModeValue as ModelRouterProofMode;
  const { supabase, userId } = await requireOwnerSession();
  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("id")
    .eq("id", businessId)
    .eq("owner_user_id", userId)
    .maybeSingle();

  if (businessError || !business) {
    modelRouterRedirect("error", "business-not-found");
  }

  const runtimeCapability = `${randomUUID()}${randomUUID()}`;
  const { data, error: reserveError } = await supabase.rpc(
    "begin_model_router_workflow_run",
    {
      p_business_id: businessId,
      p_idempotency_key: idempotencyKey,
      p_launch_nonce: launchNonce,
      p_proof_mode: proofMode,
      p_runtime_capability: runtimeCapability,
    },
  );

  const launch = (Array.isArray(data) ? data[0] : data) as LaunchResult | null;
  if (reserveError || !launch?.workflow_run_id) {
    console.error("Unable to reserve Model Router proof", reserveError);
    modelRouterRedirect("error", "model-router-reservation-failed");
  }

  if (!launch.should_start) {
    modelRouterRedirect("message", "model-router-duplicate-prevented");
  }

  const workflowInput: ModelRouterRuntimeInput = {
    businessId,
    coreWorkflowRunId: launch.workflow_run_id,
    runtimeCapability,
    proofMode,
  };
  const registered = getRegisteredWorkflow(MODEL_ROUTER_RUNTIME_WORKFLOW_KEY);

  try {
    const runtimeRun = await start(registered.workflow, [workflowInput]);

    const { error: confirmError } = await supabase
      .from("workflow_runs")
      .update({
        runtime_launch_status: "started",
        runtime_provider: "vercel_workflow",
        runtime_run_id: runtimeRun.runId,
      })
      .eq("id", launch.workflow_run_id)
      .eq("business_id", businessId)
      .eq("runtime_launch_nonce", launchNonce);

    if (confirmError) {
      console.error(
        "Model Router workflow started but launch confirmation failed",
        confirmError,
      );
    }
  } catch (error) {
    console.error("Unable to start Model Router workflow", error);
    await supabase
      .from("workflow_runs")
      .update({
        completed_at: new Date().toISOString(),
        runtime_launch_status: "launch_failed",
        status: "failed",
      })
      .eq("id", launch.workflow_run_id)
      .eq("business_id", businessId)
      .eq("runtime_launch_nonce", launchNonce);

    modelRouterRedirect("error", "model-router-launch-failed");
  }

  revalidatePath("/dashboard/model-router");
  modelRouterRedirect(
    "message",
    proofMode === "fallback-proof"
      ? "model-router-fallback-started"
      : "model-router-live-started",
  );
}
