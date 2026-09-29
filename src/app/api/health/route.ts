import type { NextRequest } from "next/server";
import { resumeHook, start } from "workflow/api";

import {
  isSupabaseAdminConfigured,
  isSupabaseConfigured,
} from "@/lib/supabase/env";
import {
  syntheticReviewHookToken,
  type SyntheticReviewDecision,
  type SyntheticRuntimeInput,
} from "@/workflows/synthetic-runtime";
import { getRegisteredWorkflow } from "@/workflows/registry";

export const dynamic = "force-dynamic";

const QUALIFICATION_KEY = "uxgGHh2PHxL2C-4VTaC837RPkohrLOWMw8vchSdJCRQ";

const fixtures = {
  approve: {
    businessId: "00000000-0000-4000-8000-000000003301",
    coreWorkflowRunId: "2ce27d68-5db4-4a80-84b3-00d5b3145780",
    runtimeCapability:
      "223eb121-f4c9-4109-ae45-ced82cb8f08feab27772-6e86-453c-9557-860970f96aa2",
  },
  fail: {
    businessId: "00000000-0000-4000-8000-000000003302",
    coreWorkflowRunId: "c46b142c-2881-4a38-b80f-a21ac7313763",
    runtimeCapability:
      "7f2cbc8d-85b2-432c-8231-45e815366dce0f25e1a3-79c2-4de1-ba58-033963961cfb",
  },
} satisfies Record<"approve" | "fail", SyntheticRuntimeInput>;

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

async function runQualification(request: NextRequest) {
  if (
    process.env.VERCEL_ENV !== "preview" ||
    request.nextUrl.searchParams.get("stage3Key") !== QUALIFICATION_KEY
  ) {
    return null;
  }

  const action = request.nextUrl.searchParams.get("stage3Action");

  if (action === "start-approve" || action === "start-fail") {
    const fixture = action === "start-approve" ? fixtures.approve : fixtures.fail;
    const registered = getRegisteredWorkflow("synthetic.core.runtime-proof");
    const runtimeRun = await start(registered.workflow, [fixture]);

    return Response.json({
      action,
      coreWorkflowRunId: fixture.coreWorkflowRunId,
      runtimeRunId: runtimeRun.runId,
      started: true,
    });
  }

  if (action === "approve" || action === "fail") {
    const fixture = action === "approve" ? fixtures.approve : fixtures.fail;
    await resumeHook(syntheticReviewHookToken(fixture.coreWorkflowRunId), {
      decidedAt: new Date().toISOString(),
      decision: action,
      ownerUserId: "stage3-qualification",
    } satisfies SyntheticReviewDecision);

    return Response.json({
      action,
      coreWorkflowRunId: fixture.coreWorkflowRunId,
      resumed: true,
    });
  }

  return null;
}

export async function GET(request: NextRequest) {
  const qualificationResponse = await runQualification(request);
  if (qualificationResponse) {
    return qualificationResponse;
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
