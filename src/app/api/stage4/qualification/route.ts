import type { NextRequest } from "next/server";
import { start } from "workflow/api";

import {
  type WorkerPackRuntimeInput,
  workerPackRuntimeWorkflow,
} from "../../../../workflows/worker-pack-runtime";

export const dynamic = "force-dynamic";

const fixtures = {
  valid: {
    businessId: "00000000-0000-4000-8000-000000004401",
    coreWorkflowRunId: "00000000-0000-4000-8000-000000004411",
    runtimeCapability: "stage4-valid-qualification-capability-only-for-preview",
    fixtureMode: "valid",
  },
  invalid: {
    businessId: "00000000-0000-4000-8000-000000004402",
    coreWorkflowRunId: "00000000-0000-4000-8000-000000004412",
    runtimeCapability: "stage4-invalid-output-qualification-capability-preview",
    fixtureMode: "invalid-output",
  },
} satisfies Record<"valid" | "invalid", WorkerPackRuntimeInput>;

function unavailable() {
  return Response.json({ error: "Not found" }, { status: 404 });
}

export async function GET(request: NextRequest) {
  if (process.env.VERCEL_ENV !== "preview") {
    return unavailable();
  }

  const action = request.nextUrl.searchParams.get("action");
  if (action !== "valid" && action !== "invalid") {
    return Response.json({ error: "Unsupported qualification action" }, { status: 400 });
  }

  const fixture = fixtures[action];
  const run = await start(workerPackRuntimeWorkflow, [fixture]);

  return Response.json({
    action,
    coreWorkflowRunId: fixture.coreWorkflowRunId,
    runtimeRunId: run.runId,
    started: true,
  });
}
