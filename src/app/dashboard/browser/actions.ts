"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { resumeHook, start } from "workflow/api";

import {
  browserProviderStatus,
  isBrowserProviderKey,
} from "@/browser";
import { createClient } from "@/lib/supabase/server";
import {
  BROWSER_PROVIDER_RUNTIME_WORKFLOW_KEY,
  browserReturnControlHookToken,
  browserTakeoverHookToken,
  type BrowserControlDecision,
  type BrowserProviderRuntimeInput,
} from "@/workflows/browser-provider-runtime";
import { getRegisteredWorkflow } from "@/workflows/registry";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKFLOW_DETAIL_PATTERN =
  /^\/dashboard\/workflows\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_RETURN_PATHS = new Set([
  "/dashboard",
  "/dashboard/browser",
  "/dashboard/needs-you",
  "/dashboard/workflows",
]);

type BrowserLaunchResult = {
  workflow_run_id: string;
  browser_session_id: string;
  browser_identity_id: string;
  provider_key: string;
  provider_profile_id: string;
  should_start: boolean;
  runtime_launch_status: string;
};

function formText(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function safeReturnPath(formData: FormData) {
  const value = formText(formData, "returnTo");
  if (SAFE_RETURN_PATHS.has(value) || WORKFLOW_DETAIL_PATTERN.test(value)) {
    return value;
  }
  return "/dashboard/browser";
}

function redirectWith(path: string, kind: "error" | "message", code: string): never {
  const separator = path.includes("?") ? "&" : "?";
  redirect(`${path}${separator}${kind}=${encodeURIComponent(code)}`);
}

async function requireOwner() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || !userId) redirect("/login?error=session-required");
  return { supabase, userId };
}

export async function startBrowserQualification(formData: FormData) {
  const businessId = formText(formData, "businessId");
  const idempotencyKey = formText(formData, "idempotencyKey");
  const launchNonce = formText(formData, "launchNonce");

  if (
    !UUID_PATTERN.test(businessId) ||
    !UUID_PATTERN.test(launchNonce) ||
    idempotencyKey.length < 1 ||
    idempotencyKey.length > 200
  ) {
    redirectWith("/dashboard/browser", "error", "invalid-browser-launch");
  }

  const providerStatus = browserProviderStatus();
  if (!providerStatus.selectedConfigured) {
    redirectWith("/dashboard/browser", "error", "browser-provider-not-configured");
  }

  const { supabase, userId } = await requireOwner();
  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("id")
    .eq("id", businessId)
    .eq("owner_user_id", userId)
    .maybeSingle();
  if (businessError || !business) {
    redirectWith("/dashboard/browser", "error", "business-not-found");
  }

  const runtimeCapability = `${randomUUID()}${randomUUID()}`;
  const { data, error: reserveError } = await supabase.rpc(
    "begin_browser_qualification_run",
    {
      p_business_id: businessId,
      p_idempotency_key: idempotencyKey,
      p_launch_nonce: launchNonce,
      p_runtime_capability: runtimeCapability,
    },
  );
  const launch = (Array.isArray(data) ? data[0] : data) as BrowserLaunchResult | null;

  if (reserveError || !launch?.workflow_run_id || !launch.browser_session_id) {
    console.error("Unable to reserve browser qualification", reserveError);
    redirectWith("/dashboard/browser", "error", "browser-reservation-failed");
  }

  if (!launch.should_start) {
    redirectWith(
      `/dashboard/workflows/${launch.workflow_run_id}`,
      "message",
      "browser-duplicate-prevented",
    );
  }

  if (!isBrowserProviderKey(launch.provider_key)) {
    redirectWith(
      `/dashboard/workflows/${launch.workflow_run_id}`,
      "error",
      "browser-provider-invalid",
    );
  }

  const workflowInput: BrowserProviderRuntimeInput = {
    businessId,
    browserSessionId: launch.browser_session_id,
    coreWorkflowRunId: launch.workflow_run_id,
    providerKey: launch.provider_key,
    providerProfileId: launch.provider_profile_id || null,
    runtimeCapability,
  };
  const registered = getRegisteredWorkflow(BROWSER_PROVIDER_RUNTIME_WORKFLOW_KEY);

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
      console.error("Browser workflow started but confirmation failed", confirmError);
    }
  } catch (error) {
    console.error("Unable to start browser provider workflow", error);
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
    redirectWith(
      `/dashboard/workflows/${launch.workflow_run_id}`,
      "error",
      "browser-workflow-launch-failed",
    );
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/browser");
  revalidatePath("/dashboard/workflows");
  revalidatePath(`/dashboard/workflows/${launch.workflow_run_id}`);
  redirectWith(
    `/dashboard/workflows/${launch.workflow_run_id}`,
    "message",
    "browser-workflow-started",
  );
}

export async function resumeBrowserControl(formData: FormData) {
  const browserSessionId = formText(formData, "browserSessionId");
  const interventionId = formText(formData, "interventionId");
  const decision = formText(formData, "decision");
  const returnTo = safeReturnPath(formData);

  if (
    !UUID_PATTERN.test(browserSessionId) ||
    !UUID_PATTERN.test(interventionId) ||
    !["take_control", "return_control"].includes(decision)
  ) {
    redirectWith(returnTo, "error", "invalid-browser-control-decision");
  }

  const { supabase, userId } = await requireOwner();
  const { data: intervention, error: interventionError } = await supabase
    .from("owner_interventions")
    .select("id, business_id, workflow_run_id, intervention_type, status")
    .eq("id", interventionId)
    .maybeSingle();
  if (
    interventionError ||
    !intervention ||
    intervention.status !== "open" ||
    !intervention.workflow_run_id
  ) {
    redirectWith(returnTo, "error", "browser-intervention-not-open");
  }

  const expectedType =
    decision === "take_control" ? "browser_takeover" : "browser_return_control";
  if (intervention.intervention_type !== expectedType) {
    redirectWith(returnTo, "error", "invalid-browser-control-decision");
  }

  const { data: session, error: sessionError } = await supabase
    .from("browser_sessions")
    .select("id, workflow_run_id, business_id")
    .eq("id", browserSessionId)
    .eq("workflow_run_id", intervention.workflow_run_id)
    .eq("business_id", intervention.business_id)
    .maybeSingle();
  if (sessionError || !session) {
    redirectWith(returnTo, "error", "browser-session-not-found");
  }

  const payload: BrowserControlDecision = {
    decidedAt: new Date().toISOString(),
    decision: decision as BrowserControlDecision["decision"],
    ownerUserId: userId,
  };
  const hookToken =
    decision === "take_control"
      ? browserTakeoverHookToken(intervention.workflow_run_id)
      : browserReturnControlHookToken(intervention.workflow_run_id);

  try {
    await resumeHook(hookToken, payload);
  } catch (error) {
    console.error("Unable to resume browser control workflow", error);
    redirectWith(returnTo, "error", "browser-control-resume-failed");
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/browser");
  revalidatePath("/dashboard/needs-you");
  revalidatePath("/dashboard/workflows");
  revalidatePath(`/dashboard/workflows/${intervention.workflow_run_id}`);
  redirectWith(
    returnTo,
    "message",
    decision === "take_control" ? "browser-control-taken" : "browser-control-returned",
  );
}
