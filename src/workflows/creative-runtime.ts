import { FatalError, getWorkflowMetadata } from "workflow";
import { executeCreativePhase, failCreativeRun, loadCreativeRun } from "./creative-runtime-steps";
import { creativeFailureMessage } from "../creative/errors";

export type CreativeRuntimeInput = { businessId: string; creativeRunId: string; coreWorkflowRunId: string; runtimeCapability: string };
export async function creativeRuntimeWorkflow(input: CreativeRuntimeInput) {
  "use workflow";
  const { workflowRunId } = getWorkflowMetadata();
  try {
    let state = await loadCreativeRun(input, workflowRunId);
    // Explicit finite phase machine: brief, screen, image/review, optional image/review.
    for (let phase = 0; phase < 2 + 2 * state.approval.maximumGenerations && state.status === "running"; phase++) {
      await executeCreativePhase(input, state.phaseKey);
      state = await loadCreativeRun(input, workflowRunId);
    }
    if (state.status === "running") throw new FatalError("Creative phase budget exhausted.");
    return { creativeRunId: input.creativeRunId, status: state.status, productionReady: state.productionReady, publicationAllowed: false };
  } catch (error) {
    const message = creativeFailureMessage(error);
    await failCreativeRun(input, message);
    throw new FatalError(message);
  }
}
