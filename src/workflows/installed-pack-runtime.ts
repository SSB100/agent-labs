import { FatalError, getWorkflowMetadata } from "workflow";
import { completeInstalledPack, executeInstalledPackStage, failInstalledPack, loadInstalledPack } from "./installed-pack-runtime-steps";

export type InstalledPackRuntimeInput = {
  businessId: string; coreWorkflowRunId: string; runtimeCapability: string;
};

// A single interpreter executes every registered declarative Workflow Pack.
export async function installedPackRuntimeWorkflow(input: InstalledPackRuntimeInput) {
  "use workflow";
  const { workflowRunId } = getWorkflowMetadata();
  try {
    const stages = await loadInstalledPack(input, workflowRunId);
    for (const stageKey of stages) await executeInstalledPackStage(input, stageKey);
    await completeInstalledPack(input);
    return { coreWorkflowRunId: input.coreWorkflowRunId, status: "completed" };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0,500) : "Pack execution failed.";
    await failInstalledPack(input, message);
    throw new FatalError(message);
  }
}
