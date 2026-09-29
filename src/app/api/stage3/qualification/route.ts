import type { NextRequest } from "next/server";
import { resumeHook, start } from "workflow/api";

import { createRuntimeClient } from "@/lib/supabase/runtime";
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
    businessId: "00000000-0000-4000-8000-000000003305",
    coreWorkflowRunId: "6c957777-b877-4fd7-9e92-28846d029527",
    runtimeCapability:
      "4a621244-fd73-49df-aa83-8995fc034db60bb3c10e-20fa-4c29-b5e5-298fcf465b6a",
  },
  fail: {
    businessId: "00000000-0000-4000-8000-000000003306",
    coreWorkflowRunId: "f0e3163a-7f45-47bb-b512-49f45a751e97",
    runtimeCapability:
      "80c0f8d3-203c-4cfa-a0cb-e14dd5e21110abcf9714-18f4-46c1-be13-ed1b945cbdda",
  },
} satisfies Record<"approve" | "fail", SyntheticRuntimeInput>;

function unavailable() {
  return Response.json({ error: "Not found" }, { status: 404 });
}

async function claimAction(
  fixture: SyntheticRuntimeInput,
  action: "start" | "resume-approve" | "resume-fail",
) {
  const supabase = createRuntimeClient();
  const { data, error } = await supabase.rpc("claim_stage3_qualification_action", {
    p_action: action,
    p_business_id: fixture.businessId,
    p_runtime_capability: fixture.runtimeCapability,
    p_workflow_run_id: fixture.coreWorkflowRunId,
  });

  if (error) {
    throw new Error(`Unable to claim qualification action: ${error.message}`);
  }

  return data === true;
}

async function releaseAction(
  fixture: SyntheticRuntimeInput,
  action: "start" | "resume-approve" | "resume-fail",
) {
  const supabase = createRuntimeClient();
  await supabase.rpc("release_stage3_qualification_action", {
    p_action: action,
    p_business_id: fixture.businessId,
    p_runtime_capability: fixture.runtimeCapability,
    p_workflow_run_id: fixture.coreWorkflowRunId,
  });
}

export async function GET(request: NextRequest) {
  if (
    !["preview", "production"].includes(process.env.VERCEL_ENV ?? "") ||
    request.nextUrl.searchParams.get("key") !== QUALIFICATION_KEY
  ) {
    return unavailable();
  }

  const action = request.nextUrl.searchParams.get("action");

  if (action === "start-approve" || action === "start-fail") {
    const fixture = action === "start-approve" ? fixtures.approve : fixtures.fail;
    const claimed = await claimAction(fixture, "start");

    if (!claimed) {
      return Response.json({
        action,
        alreadyClaimed: true,
        coreWorkflowRunId: fixture.coreWorkflowRunId,
      });
    }

    try {
      const registered = getRegisteredWorkflow("synthetic.core.runtime-proof");
      const runtimeRun = await start(registered.workflow, [fixture]);

      return Response.json({
        action,
        coreWorkflowRunId: fixture.coreWorkflowRunId,
        runtimeRunId: runtimeRun.runId,
        started: true,
      });
    } catch (error) {
      await releaseAction(fixture, "start");
      throw error;
    }
  }

  if (action === "approve" || action === "fail") {
    const fixture = action === "approve" ? fixtures.approve : fixtures.fail;
    const claimKey = action === "approve" ? "resume-approve" : "resume-fail";
    const claimed = await claimAction(fixture, claimKey);

    if (!claimed) {
      return Response.json({
        action,
        alreadyClaimed: true,
        coreWorkflowRunId: fixture.coreWorkflowRunId,
      });
    }

    try {
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
    } catch (error) {
      await releaseAction(fixture, claimKey);
      throw error;
    }
  }

  return Response.json(
    {
      error: "Unsupported qualification action",
    },
    { status: 400 },
  );
}
