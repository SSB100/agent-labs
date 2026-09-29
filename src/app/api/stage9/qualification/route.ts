import { randomUUID } from "node:crypto";

import { start } from "workflow/api";

import { createRuntimeClient } from "@/lib/supabase/runtime";
import type { BrowserPlannerRuntimeInput } from "@/workflows/browser-planner-runtime";
import { getRegisteredWorkflow } from "@/workflows/registry";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const QUALIFICATION_TOKEN =
  "aXMVXHtaX6y5rLytDBMRla53TWEgD9LctbA77A6OZijIVVkKEAD0iNDmT2eRqfI8";

type PreviewLaunch = {
  workflow_run_id: string;
  business_id: string;
  browser_session_id: string;
  browser_identity_id: string;
  provider_key: "steel" | "browserbase";
  provider_profile_id: string;
  should_start: boolean;
  runtime_launch_status: string;
};

export async function GET(request: Request) {
  if (process.env.VERCEL_ENV !== "preview") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  if (url.searchParams.get("token") !== QUALIFICATION_TOKEN) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const attempt = url.searchParams.get("attempt") ?? "1";
  if (!/^[1-9][0-9]?$/.test(attempt)) {
    return Response.json({ error: "Invalid attempt" }, { status: 400 });
  }

  const runtimeCapability = `${randomUUID()}${randomUUID()}`;
  const launchNonce = randomUUID();
  const supabase = createRuntimeClient();
  const { data, error } = await supabase.rpc(
    "stage9_begin_preview_qualification",
    {
      p_idempotency_key: `stage9:preview-live:${attempt}`,
      p_launch_nonce: launchNonce,
      p_runtime_capability: runtimeCapability,
      p_token: QUALIFICATION_TOKEN,
    },
  );
  const launch = (Array.isArray(data) ? data[0] : data) as PreviewLaunch | null;

  if (error || !launch?.workflow_run_id) {
    console.error("Unable to reserve Stage 9 Preview qualification", error);
    return Response.json(
      { error: "Unable to reserve qualification" },
      { status: 500 },
    );
  }

  if (!launch.should_start) {
    return Response.json({
      duplicatePrevented: true,
      workflowRunId: launch.workflow_run_id,
      browserSessionId: launch.browser_session_id,
      status: launch.runtime_launch_status,
    });
  }

  const input: BrowserPlannerRuntimeInput = {
    browserIdentityId: launch.browser_identity_id,
    browserSessionId: launch.browser_session_id,
    businessId: launch.business_id,
    coreWorkflowRunId: launch.workflow_run_id,
    providerKey: launch.provider_key,
    providerProfileId: launch.provider_profile_id,
    runtimeCapability,
  };

  try {
    const registered = getRegisteredWorkflow(
      "synthetic.browser-planner.qualification",
    );
    const runtimeRun = await start(registered.workflow, [input]);
    return Response.json({
      workflowRunId: launch.workflow_run_id,
      browserSessionId: launch.browser_session_id,
      runtimeRunId: runtimeRun.runId,
      status: "started",
    });
  } catch (startError) {
    console.error("Unable to start Stage 9 Preview qualification", startError);
    return Response.json({ error: "Unable to start qualification" }, { status: 500 });
  }
}
