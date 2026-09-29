"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { start } from "workflow/api";

import { createClient } from "../../../lib/supabase/server";
import {
  WORKER_PACK_RUNTIME_WORKFLOW_KEY,
  type WorkerPackRuntimeInput,
} from "../../../workflows/worker-pack-runtime";
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

function workerProofRedirect(kind: "error" | "message", code: string): never {
  redirect(`/dashboard/worker-proof?${kind}=${encodeURIComponent(code)}`);
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

export async function startGenericResearcherProof(formData: FormData) {
  const businessId = formText(formData, "businessId");
  const idempotencyKey = formText(formData, "idempotencyKey");
  const launchNonce = formText(formData, "launchNonce");

  if (
    !UUID_PATTERN.test(businessId) ||
    !UUID_PATTERN.test(launchNonce) ||
    idempotencyKey.length < 1 ||
    idempotencyKey.length > 200
  ) {
    workerProofRedirect("error", "invalid-worker-proof-launch");
  }

  const { supabase, userId } = await requireOwnerSession();
  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("id")
    .eq("id", businessId)
    .eq("owner_user_id", userId)
    .maybeSingle();

  if (businessError || !business) {
    workerProofRedirect("error", "business-not-found");
  }

  const runtimeCapability = `${randomUUID()}${randomUUID()}`;
  const { data, error: reserveError } = await supabase.rpc(
    "begin_worker_pack_workflow_run",
    {
      p_business_id: businessId,
      p_fixture_mode: "valid",
      p_idempotency_key: idempotencyKey,
      p_launch_nonce: launchNonce,
      p_runtime_capability: runtimeCapability,
    },
  );

  const launch = (Array.isArray(data) ? data[0] : data) as LaunchResult | null;
  if (reserveError || !launch?.workflow_run_id) {
    console.error("Unable to reserve Worker Pack proof", reserveError);
    workerProofRedirect("error", "worker-proof-reservation-failed");
  }

  if (!launch.should_start) {
    workerProofRedirect("message", "worker-proof-duplicate-prevented");
  }

  const workflowInput: WorkerPackRuntimeInput = {
    businessId,
    coreWorkflowRunId: launch.workflow_run_id,
    runtimeCapability,
    fixtureMode: "valid",
  };
  const registered = getRegisteredWorkflow(WORKER_PACK_RUNTIME_WORKFLOW_KEY);

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
        "Worker Pack workflow started but launch confirmation failed",
        confirmError,
      );
    }
  } catch (error) {
    console.error("Unable to start Worker Pack workflow", error);
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

    workerProofRedirect("error", "worker-proof-launch-failed");
  }

  revalidatePath("/dashboard/worker-proof");
  workerProofRedirect("message", "worker-proof-started");
}
