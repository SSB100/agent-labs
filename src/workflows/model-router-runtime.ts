import { getWorkflowMetadata } from "workflow";

import type { JsonObject } from "../core/contracts";
import type { WorkerInvocationContext } from "../workers/types";
import {
  executeModelRoutedResearcher,
  prepareModelResearcherTask,
  startModelRouterRuntime,
} from "./model-router-runtime-steps";

export const MODEL_ROUTER_RUNTIME_WORKFLOW_KEY = "synthetic.model-router.runtime-proof";
export const MODEL_ROUTER_RUNTIME_WORKFLOW_DEFINITION_ID =
  "00000000-0000-4000-8000-000000000503";

export type ModelRouterProofMode = "live" | "fallback-proof";

export type ModelRouterRuntimeInput = {
  businessId: string;
  coreWorkflowRunId: string;
  runtimeCapability: string;
  proofMode: ModelRouterProofMode;
};

export type ModelRouterRuntimeResult = {
  coreWorkflowRunId: string;
  runtimeRunId: string;
  status: "completed";
  selectedModelKey: string;
  modelRouteKey: string;
  workerOutput: JsonObject;
  workerReceipt: JsonObject;
};

export async function modelRouterRuntimeWorkflow(
  input: ModelRouterRuntimeInput,
): Promise<ModelRouterRuntimeResult> {
  "use workflow";

  const { workflowRunId: runtimeRunId } = getWorkflowMetadata();
  await startModelRouterRuntime(input, runtimeRunId);

  const context: WorkerInvocationContext = await prepareModelResearcherTask(input);
  const result = await executeModelRoutedResearcher(input, context);

  return {
    coreWorkflowRunId: input.coreWorkflowRunId,
    runtimeRunId,
    status: "completed",
    selectedModelKey: result.selectedModelKey,
    modelRouteKey: result.modelRouteKey,
    workerOutput: result.output,
    workerReceipt: result.receipt,
  };
}
