import { start } from "workflow/api";

import {
  isSupabaseAdminConfigured,
  isSupabaseConfigured,
} from "@/lib/supabase/env";
import type { SyntheticRuntimeInput } from "@/workflows/synthetic-runtime";
import { getRegisteredWorkflow } from "@/workflows/registry";

export const dynamic = "force-dynamic";

const approvalFixture: SyntheticRuntimeInput = {
  businessId: "00000000-0000-4000-8000-000000003301",
  coreWorkflowRunId: "2ce27d68-5db4-4a80-84b3-00d5b3145780",
  runtimeCapability:
    "223eb121-f4c9-4109-ae45-ced82cb8f08feab27772-6e86-453c-9557-860970f96aa2",
};

const unavailableResponse = (
  supabaseStatus: string,
  workflowRuntimeStatus: string,
  status = 503,
) =>
  Response.json(
    {
      checks: {
        supabase: supabaseStatus,
        workflowRuntime: workflowRuntimeStatus,
      },
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
      service: "agent-labs",
      status: "degraded",
    },
    { status },
  );

export async function GET() {
  if (process.env.VERCEL_ENV === "preview") {
    const registered = getRegisteredWorkflow("synthetic.core.runtime-proof");
    const runtimeRun = await start(registered.workflow, [approvalFixture]);

    return Response.json({
      qualification: "approval-path-started",
      runtimeRunId: runtimeRun.runId,
      status: "ok",
    });
  }

  const workflowRuntimeStatus = isSupabaseAdminConfigured()
    ? "configured"
    : "not_configured";

  if (!isSupabaseConfigured()) {
    return unavailableResponse("not_configured", workflowRuntimeStatus);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

  try {
    const response = await fetch(`${url}/auth/v1/settings`, {
      cache: "no-store",
      headers: {
        apikey: publishableKey,
      },
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      return unavailableResponse("unreachable", workflowRuntimeStatus);
    }

    if (!isSupabaseAdminConfigured()) {
      return unavailableResponse("connected", workflowRuntimeStatus);
    }

    return Response.json({
      checks: {
        supabase: "connected",
        workflowRuntime: "configured",
      },
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
      service: "agent-labs",
      status: "ok",
    });
  } catch {
    return unavailableResponse("unreachable", workflowRuntimeStatus);
  }
}
