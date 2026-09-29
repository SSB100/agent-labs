import { getWorkflowMetadata } from "workflow";

import type { JsonObject } from "../core/contracts";
import type { WorkerInvocationContext } from "../workers/types";
import {
  executeGenericResearcherWorker,
  prepareGenericResearcherTask,
  startWorkerPackRuntime,
} from "./worker-pack-runtime-steps";

export const WORKER_PACK_RUNTIME_WORKFLOW_KEY = "synthetic.worker-pack.runtime-proof";
export const WORKER_PACK_RUNTIME_WORKFLOW_DEFINITION_ID =
  "00000000-0000-4000-8000-000000000403";

export type WorkerPackFixtureMode = "valid" | "invalid-output";

export type WorkerPackRuntimeInput = {
  businessId: string;
  coreWorkflowRunId: string;
  runtimeCapability: string;
  fixtureMode: WorkerPackFixtureMode;
};

export type WorkerPackRuntimeResult = {
  coreWorkflowRunId: string;
  runtimeRunId: string;
  status: "completed";
  workerOutput: JsonObject;
  workerReceipt: JsonObject;
};

export async function workerPackRuntimeWorkflow(
  input: WorkerPackRuntimeInput,
): Promise<WorkerPackRuntimeResult> {
  "use workflow";

  const { workflowRunId: runtimeRunId } = getWorkflowMetadata();
  await startWorkerPackRuntime(input, runtimeRunId);

  const context: WorkerInvocationContext = await prepareGenericResearcherTask(input);
  const result = await executeGenericResearcherWorker(input, context);

  return {
    coreWorkflowRunId: input.coreWorkflowRunId,
    runtimeRunId,
    status: "completed",
    workerOutput: result.output,
    workerReceipt: result.receipt,
  };
}
