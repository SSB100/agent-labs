"use server";

import { randomUUID } from "node:crypto";
import { safeConsoleDecisionReturnPath, consoleDecisionActionReturnPath } from "@/lib/core-ui/console-decisions-query";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { resumeHook, start } from "workflow/api";

import { isDefaultBrowserProviderConfigured } from "@/browser/registry";
import { createClient } from "@/lib/supabase/server";
import {
  type BrowserPlannerRuntimeInput,
} from "@/workflows/browser-planner-runtime";
import {
  browserReturnControlHookToken,
  browserTakeControlHookToken,
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
  "/dashboard/accounts",
  "/dashboard/needs-you",
  "/dashboard/workflows",
]);
const BROWSER_WORKFLOW_KEY = "synthetic.browser-provider.qualification" as const;
const BROWSER_PLANNER_WORKFLOW_KEY =
  "synthetic.browser-planner.qualification" as const;

type BrowserLaunchResult = {
  browser_identity_id: string;
  browser_session_id: string;
  provider_key: "steel" | "browserbase";
  provider_profile_id: string;
  runtime_launch_status: string;
  should_start: boolean;
  workflow_run_id: string;
};

function formText(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function safeReturnPath(formData: FormData) {
  const requested = formText(formData, "returnTo");
  const compact = safeConsoleDecisionReturnPath(requested);
  if (compact) return compact;
  if (SAFE_RETURN_PATHS.has(requested) || WORKFLOW_DETAIL_PATTERN.test(requested)) {
    return requested;
  }
  return "/dashboard/needs-you";
}

function redirectWith(path: string, kind: "error" | "message", code: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(code)}`);
}

async function requireOwnerSession() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || !userId) redirect("/login?error=session-required");
  return { supabase, userId };
}

async function requireOwnedBusiness(businessId: string) {
  const { supabase, userId } = await requireOwnerSession();
  const { data: business, error } = await supabase
    .from("businesses")
    .select("id")
    .eq("id", businessId)
    .eq("owner_user_id", userId)
    .maybeSingle();
  if (error || !business) {
    redirectWith("/dashboard/accounts", "error", "business-not-found");
  }
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
    redirectWith("/dashboard/accounts", "error", "invalid-browser-launch");
  }

  if (!isDefaultBrowserProviderConfigured()) {
    redirectWith("/dashboard/accounts", "error", "browser-provider-not-configured");
  }

  const { supabase } = await requireOwnedBusiness(businessId);
  const runtimeCapability = `${randomUUID()}${randomUUID()}`;
  const { data, error } = await supabase.rpc("begin_browser_qualification_run", {
    p_business_id: businessId,
    p_idempotency_key: idempotencyKey,
    p_launch_nonce: launchNonce,
    p_runtime_capability: runtimeCapability,
  });
  const launch = (Array.isArray(data) ? data[0] : data) as BrowserLaunchResult | null;
  if (error || !launch?.workflow_run_id) {
    console.error("Unable to reserve browser qualification", error);
    redirectWith("/dashboard/accounts", "error", "browser-reservation-failed");
  }

  if (!launch.should_start) {
    redirectWith(
      `/dashboard/workflows/${launch.workflow_run_id}`,
      "message",
      "browser-duplicate-prevented",
    );
  }

  const workflowInput: BrowserProviderRuntimeInput = {
    browserIdentityId: launch.browser_identity_id,
    browserSessionId: launch.browser_session_id,
    businessId,
    coreWorkflowRunId: launch.workflow_run_id,
    providerKey: launch.provider_key,
    providerProfileId: launch.provider_profile_id,
    runtimeCapability,
  };

  try {
    const registered = getRegisteredWorkflow(BROWSER_WORKFLOW_KEY);
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
      console.error("Browser workflow launch confirmation failed", confirmError);
    }
  } catch (startError) {
    console.error("Unable to start browser qualification", startError);
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
      "browser-launch-failed",
    );
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/accounts");
  revalidatePath("/dashboard/workflows");
  revalidatePath(`/dashboard/workflows/${launch.workflow_run_id}`);
  redirectWith(
    `/dashboard/workflows/${launch.workflow_run_id}`,
    "message",
    "browser-workflow-started",
  );
}

export async function startBrowserPlannerQualification(formData: FormData) {
  const businessId = formText(formData, "businessId");
  const idempotencyKey = formText(formData, "idempotencyKey");
  const launchNonce = formText(formData, "launchNonce");

  if (
    !UUID_PATTERN.test(businessId) ||
    !UUID_PATTERN.test(launchNonce) ||
    idempotencyKey.length < 1 ||
    idempotencyKey.length > 200
  ) {
    redirectWith("/dashboard/accounts", "error", "invalid-browser-planner-launch");
  }

  if (!isDefaultBrowserProviderConfigured()) {
    redirectWith("/dashboard/accounts", "error", "browser-provider-not-configured");
  }

  const { supabase } = await requireOwnedBusiness(businessId);
  const runtimeCapability = `${randomUUID()}${randomUUID()}`;
  const { data, error } = await supabase.rpc(
    "begin_browser_planner_qualification_run",
    {
      p_business_id: businessId,
      p_idempotency_key: idempotencyKey,
      p_launch_nonce: launchNonce,
      p_runtime_capability: runtimeCapability,
    },
  );
  const launch = (Array.isArray(data) ? data[0] : data) as BrowserLaunchResult | null;

  if (error || !launch?.workflow_run_id) {
    console.error("Unable to reserve Browser Planner qualification", error);
    redirectWith("/dashboard/accounts", "error", "browser-planner-reservation-failed");
  }

  if (!launch.should_start) {
    redirectWith(
      `/dashboard/workflows/${launch.workflow_run_id}`,
      "message",
      "browser-planner-duplicate-prevented",
    );
  }

  const workflowInput: BrowserPlannerRuntimeInput = {
    browserIdentityId: launch.browser_identity_id,
    browserSessionId: launch.browser_session_id,
    businessId,
    coreWorkflowRunId: launch.workflow_run_id,
    providerKey: launch.provider_key,
    providerProfileId: launch.provider_profile_id,
    runtimeCapability,
  };

  try {
    const registered = getRegisteredWorkflow(BROWSER_PLANNER_WORKFLOW_KEY);
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
      console.error("Browser Planner launch confirmation failed", confirmError);
    }
  } catch (startError) {
    console.error("Unable to start Browser Planner qualification", startError);
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
      "browser-planner-launch-failed",
    );
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/accounts");
  revalidatePath("/dashboard/workflows");
  revalidatePath(`/dashboard/workflows/${launch.workflow_run_id}`);
  redirectWith(
    `/dashboard/workflows/${launch.workflow_run_id}`,
    "message",
    "browser-planner-workflow-started",
  );
}

export async function resumeBrowserControl(formData: FormData) {
  const interventionId = formText(formData, "interventionId");
  const decision = formText(formData, "decision");
  let returnTo = safeReturnPath(formData);
  returnTo = consoleDecisionActionReturnPath(returnTo, { interventionId }) ?? returnTo;

  if (
    !UUID_PATTERN.test(interventionId) ||
    !["take_control", "return_control"].includes(decision)
  ) {
    redirectWith(returnTo, "error", "invalid-browser-control");
  }

  const { supabase, userId } = await requireOwnerSession();
  const { data: intervention, error } = await supabase
    .from("owner_interventions")
    .select("id, business_id, workflow_run_id, intervention_type, status")
    .eq("id", interventionId)
    .maybeSingle();

  if (
    error ||
    !intervention ||
    intervention.status !== "open" ||
    !intervention.workflow_run_id
  ) {
    redirectWith(returnTo, "error", "browser-control-not-open");
  }

  if (safeConsoleDecisionReturnPath(returnTo)) returnTo = consoleDecisionActionReturnPath(returnTo, { interventionId: intervention.id, businessId: intervention.business_id })
    ?? `/dashboard?view=decisions&decision=${encodeURIComponent(intervention.id)}`;

  const expectedType =
    decision === "take_control" ? "browser_takeover" : "browser_return_control";
  if (intervention.intervention_type !== expectedType) {
    redirectWith(returnTo, "error", "invalid-browser-control");
  }

  const payload: BrowserControlDecision = {
    decidedAt: new Date().toISOString(),
    ownerUserId: userId,
  };
  const token =
    decision === "take_control"
      ? browserTakeControlHookToken(intervention.workflow_run_id)
      : browserReturnControlHookToken(intervention.workflow_run_id);

  try {
    await resumeHook(token, payload);
  } catch (resumeError) {
    console.error("Unable to resume browser control workflow", resumeError);
    redirectWith(returnTo, "error", "browser-control-resume-failed");
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/accounts");
  revalidatePath("/dashboard/needs-you");
  revalidatePath("/dashboard/workflows");
  revalidatePath(`/dashboard/workflows/${intervention.workflow_run_id}`);
  redirectWith(
    returnTo,
    "message",
    decision === "take_control" ? "browser-control-taken" : "browser-control-returned",
  );
}
