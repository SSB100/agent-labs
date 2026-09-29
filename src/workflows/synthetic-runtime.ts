import { createHook, FatalError, getWorkflowMetadata, sleep } from "workflow";

import {
  completeSyntheticWorkflow,
  completeWaitStage,
  enterReviewStage,
  enterWaitStage,
  executeSyntheticWorkerTask,
  failReviewStage,
  recordUnexpectedWorkflowFailure,
  resolveReviewStage,
  startSyntheticWorkflow,
} from "./synthetic-runtime-steps";

export const SYNTHETIC_RUNTIME_WORKFLOW_KEY = "synthetic.core.runtime-proof";
export const SYNTHETIC_RUNTIME_WORKFLOW_DEFINITION_ID =
  "00000000-0000-4000-8000-000000000301";

export type SyntheticRuntimeInput = {
  businessId: string;
  coreWorkflowRunId: string;
  runtimeCapability: string;
};

export type SyntheticReviewDecision = {
  decidedAt: string;
  decision: "approve" | "fail";
  ownerUserId: string;
};

export type SyntheticRuntimeResult = {
  coreWorkflowRunId: string;
  runtimeRunId: string;
  status: "completed";
};

export function syntheticReviewHookToken(coreWorkflowRunId: string) {
  return `agent-labs:synthetic-review:${coreWorkflowRunId}`;
}

function describeFailure(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message.slice(0, 500),
      name: error.name.slice(0, 120),
    };
  }

  return {
    message: "Unknown workflow failure",
    name: "UnknownError",
  };
}

export async function syntheticCoreRuntimeWorkflow(
  input: SyntheticRuntimeInput,
): Promise<SyntheticRuntimeResult> {
  "use workflow";

  const { workflowRunId: runtimeRunId } = getWorkflowMetadata();
  let currentStage = "start";
  let ownerRejected = false;

  try {
    await startSyntheticWorkflow(input, runtimeRunId);

    currentStage = "worker-task";
    await executeSyntheticWorkerTask(input);

    currentStage = "wait";
    await enterWaitStage(input);
    await sleep("5s");
    await completeWaitStage(input);

    currentStage = "review";
    const review = createHook<SyntheticReviewDecision>({
      token: syntheticReviewHookToken(input.coreWorkflowRunId),
    });
    await enterReviewStage(input);
    const decision = await review;

    if (decision.decision === "fail") {
      ownerRejected = true;
      await failReviewStage(input, decision);
      throw new FatalError("The synthetic workflow was rejected by the owner.");
    }

    await resolveReviewStage(input, decision);

    currentStage = "complete";
    await completeSyntheticWorkflow(input);

    return {
      coreWorkflowRunId: input.coreWorkflowRunId,
      runtimeRunId,
      status: "completed",
    };
  } catch (error) {
    if (!ownerRejected) {
      await recordUnexpectedWorkflowFailure(input, currentStage, describeFailure(error));
    }

    throw error;
  }
}
