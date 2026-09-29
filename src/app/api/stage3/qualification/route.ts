import type { NextRequest } from "next/server";
import { resumeHook, start } from "workflow/api";

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
    businessId: "00000000-0000-4000-8000-000000003303",
    coreWorkflowRunId: "3c7c4b4c-6407-4d14-b551-6bc5664370a7",
    runtimeCapability:
      "6aec6d39-997f-4089-8ef1-e5c733bbd30c06089efc-d241-4e53-b8ce-2cc26dc32c97",
  },
  fail: {
    businessId: "00000000-0000-4000-8000-000000003304",
    coreWorkflowRunId: "fe154622-e54a-480a-b4b7-501b8d96ac85",
    runtimeCapability:
      "273768d0-cdff-4888-b5dc-05568eaf26ccac82920e-2af5-432d-9633-3ca5583bac55",
  },
} satisfies Record<"approve" | "fail", SyntheticRuntimeInput>;

function unavailable() {
  return Response.json({ error: "Not found" }, { status: 404 });
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

  return Response.json(
    {
      error: "Unsupported qualification action",
    },
    { status: 400 },
  );
}
