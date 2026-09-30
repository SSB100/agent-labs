import { FatalError, getWorkflowMetadata } from "workflow";
import { collectInstalledPackResearch, completeInstalledPack, executeInstalledPackStage, failInstalledPack, loadInstalledPack, persistInstalledPackResearch, persistInstalledPackStage } from "./installed-pack-runtime-steps";

export type InstalledPackRuntimeInput = {
  businessId: string; coreWorkflowRunId: string; runtimeCapability: string;
  qualification?: "stage11" | "stage12";
  mode?: "simulation";
};

// A single interpreter executes every registered declarative Workflow Pack.
export async function installedPackRuntimeWorkflow(input: InstalledPackRuntimeInput) {
  "use workflow";
  const { workflowRunId } = getWorkflowMetadata();
  try {
    if (input.qualification === "stage12") throw new FatalError("Use the dedicated Etsy simulation runtime.");
    const stages = await loadInstalledPack(input, workflowRunId);
    for (const stageKey of stages) {
      const research = await collectInstalledPackResearch(input, stageKey);
      if (research) await persistInstalledPackResearch(input, stageKey, research);
      const result = await executeInstalledPackStage(input, stageKey);
      if (result) await persistInstalledPackStage(input, stageKey, result);
    }
    await completeInstalledPack(input);
    return { coreWorkflowRunId: input.coreWorkflowRunId, status: "completed" };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0,500) : "Pack execution failed.";
    await failInstalledPack(input, message);
    throw new FatalError(message);
  }
}
