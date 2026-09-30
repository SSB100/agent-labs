import { createHook, FatalError, getWorkflowMetadata } from "workflow";
import { failInstalledPack, loadInstalledPack, persistInstalledPackStage } from "./installed-pack-runtime-steps";
import { enterEtsySimulationReview, executeEtsySimulationStage, finishEtsySimulationReview } from "./etsy-discovery-simulation-runtime-steps";

export type EtsySimulationRuntimeInput = {
  businessId: string;
  coreWorkflowRunId: string;
  runtimeCapability: string;
  qualification: "stage12";
  mode: "simulation";
};

export type EtsySimulationReviewDecision = {
  decision: "acknowledge" | "stop";
  ownerUserId: string;
  decidedAt: string;
};

export function etsySimulationReviewHookToken(coreWorkflowRunId: string) {
  return `agent-labs:etsy-simulation-review:${coreWorkflowRunId}`;
}

export async function etsyDiscoverySimulationRuntimeWorkflow(input: EtsySimulationRuntimeInput) {
  "use workflow";
  const { workflowRunId } = getWorkflowMetadata();
  try {
    const stages = await loadInstalledPack(input, workflowRunId);
    for (const stageKey of stages) {
      const result = await executeEtsySimulationStage(input, stageKey);
      if (result) await persistInstalledPackStage(input, stageKey, result);
    }
    // Register before exposing Needs You so a fast owner click cannot miss the hook.
    const review = createHook<EtsySimulationReviewDecision>({ token: etsySimulationReviewHookToken(input.coreWorkflowRunId) });
    await enterEtsySimulationReview(input);
    const decision = await review;
    const result = await finishEtsySimulationReview(input, decision);
    return { coreWorkflowRunId: input.coreWorkflowRunId, mode: "simulation", status: result.status };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Etsy simulation failed.";
    await failInstalledPack(input, message);
    throw new FatalError(message);
  }
}
