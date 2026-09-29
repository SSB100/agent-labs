"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { resumeHook, start } from "workflow/api";

import { isSupabaseAdminConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import {
  syntheticReviewHookToken,
  type SyntheticReviewDecision,
  type SyntheticRuntimeInput,
} from "@/workflows/synthetic-runtime";
import {
  getRegisteredWorkflow,
  type RegisteredWorkflowKey,
} from "@/workflows/registry";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SYNTHETIC_WORKFLOW_KEY: RegisteredWorkflowKey = "synthetic.core.runtime-proof";

type LaunchResult = {
  runtime_launch_status: string;
  should_start: boolean;
  workflow_run_id: string;
};

function formText(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function isUuid(value: string) {
  return UUID_PATTERN.test(value);
}

function dashboardRedirect(kind: "error" | "message", code: string): never {
  redirect(`/dashboard?${kind}=${encodeURIComponent(code)}#workflows`);
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

export async function createBusiness(formData: FormData) {
  const name = formText(formData, "name");

  if (name.length < 1 || name.length > 120) {
    redirect("/dashboard?error=invalid-business-name");
  }

  const { supabase, userId } = await requireOwnerSession();
  const { error } = await supabase.from("businesses").insert({
    name,
    owner_user_id: userId,
  });

  if (error) {
    redirect("/dashboard?error=business-create-failed");
  }

  revalidatePath("/dashboard");
  redirect("/dashboard?message=business-created");
}

export async function startSyntheticWorkflow(formData: FormData) {
  const businessId = formText(formData, "businessId");
  const idempotencyKey = formText(formData, "idempotencyKey");
  const launchNonce = formText(formData, "launchNonce");

  if (
    !isUuid(businessId) ||
    !isUuid(launchNonce) ||
    idempotencyKey.length < 1 ||
    idempotencyKey.length > 200
  ) {
    dashboardRedirect("error", "invalid-workflow-launch");
  }

  if (!isSupabaseAdminConfigured()) {
    dashboardRedirect("error", "workflow-runtime-not-configured");
  }

  const { supabase, userId } = await requireOwnerSession();
  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("id")
    .eq("id", businessId)
    .eq("owner_user_id", userId)
    .maybeSingle();

  if (businessError || !business) {
    dashboardRedirect("error", "business-not-found");
  }

  const input = {
    requestedBy: userId,
    workflowKey: SYNTHETIC_WORKFLOW_KEY,
  };
  const { data, error: reserveError } = await supabase.rpc(
    "begin_synthetic_workflow_run",
    {
      p_business_id: businessId,
      p_idempotency_key: idempotencyKey,
      p_input: input,
      p_launch_nonce: launchNonce,
    },
  );

  const launch = (Array.isArray(data) ? data[0] : data) as LaunchResult | null;

  if (reserveError || !launch?.workflow_run_id) {
    console.error("Unable to reserve synthetic workflow", reserveError);
    dashboardRedirect("error", "workflow-reservation-failed");
  }

  if (!launch.should_start) {
    dashboardRedirect("message", "workflow-duplicate-prevented");
  }

  const workflowInput: SyntheticRuntimeInput = {
    businessId,
    coreWorkflowRunId: launch.workflow_run_id,
  };
  const registered = getRegisteredWorkflow(SYNTHETIC_WORKFLOW_KEY);

  try {
    const runtimeRun = await start(registered.workflow, [workflowInput], {
      region: "syd1",
    });

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
      console.error("Workflow started but launch confirmation failed", confirmError);
    }
  } catch (error) {
    console.error("Unable to start Vercel Workflow run", error);
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

    dashboardRedirect("error", "workflow-launch-failed");
  }

  revalidatePath("/dashboard");
  dashboardRedirect("message", "workflow-started");
}

export async function resumeSyntheticReview(formData: FormData) {
  const interventionId = formText(formData, "interventionId");
  const decisionValue = formText(formData, "decision");

  if (!isUuid(interventionId) || !["approve", "fail"].includes(decisionValue)) {
    dashboardRedirect("error", "invalid-review-decision");
  }

  const decision = decisionValue as SyntheticReviewDecision["decision"];
  const { supabase, userId } = await requireOwnerSession();
  const { data: intervention, error } = await supabase
    .from("owner_interventions")
    .select("id, business_id, workflow_run_id, status")
    .eq("id", interventionId)
    .maybeSingle();

  if (
    error ||
    !intervention ||
    intervention.status !== "open" ||
    !intervention.workflow_run_id
  ) {
    dashboardRedirect("error", "review-not-open");
  }

  try {
    await resumeHook(syntheticReviewHookToken(intervention.workflow_run_id), {
      decidedAt: new Date().toISOString(),
      decision,
      ownerUserId: userId,
    } satisfies SyntheticReviewDecision);
  } catch (resumeError) {
    console.error("Unable to resume synthetic review", resumeError);
    dashboardRedirect("error", "review-resume-failed");
  }

  revalidatePath("/dashboard");
  dashboardRedirect("message", decision === "approve" ? "review-approved" : "review-failed");
}
