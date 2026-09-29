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
