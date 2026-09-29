import { createHook, FatalError, getWorkflowMetadata, sleep } from "workflow";

import type { BrowserProviderKey } from "@/browser";

import {
  checkBrowserReplay,
  launchAndPrepareBrowser,
  recordBrowserControlReturned,
  recordBrowserControlTaken,
  recordUnexpectedBrowserFailure,
  releaseBrowserProviderSession,
  startBrowserProviderWorkflow,
  storeBrowserReplayAndComplete,
  verifyBrowserAutomationResumed,
} from "./browser-provider-runtime-steps";

export const BROWSER_PROVIDER_RUNTIME_WORKFLOW_KEY =
  "synthetic.browser-provider.qualification";
export const BROWSER_PROVIDER_RUNTIME_WORKFLOW_DEFINITION_ID =
  "00000000-0000-4000-8000-000000000801";

export type BrowserProviderRuntimeInput = {
  businessId: string;
  browserSessionId: string;
  coreWorkflowRunId: string;
  providerKey: BrowserProviderKey;
  providerProfileId: string | null;
  runtimeCapability: string;
};

export type BrowserControlDecision = {
  decidedAt: string;
  decision: "take_control" | "return_control";
  ownerUserId: string;
};

export type BrowserProviderRuntimeResult = {
  browserSessionId: string;
  coreWorkflowRunId: string;
  providerKey: BrowserProviderKey;
  runtimeRunId: string;
  status: "completed";
};

export function browserTakeoverHookToken(coreWorkflowRunId: string) {
  return `agent-labs:browser-takeover:${coreWorkflowRunId}`;
}

export function browserReturnControlHookToken(coreWorkflowRunId: string) {
  return `agent-labs:browser-return:${coreWorkflowRunId}`;
}

export async function browserProviderQualificationWorkflow(
  input: BrowserProviderRuntimeInput,
): Promise<BrowserProviderRuntimeResult> {
  "use workflow";

  const { workflowRunId: runtimeRunId } = getWorkflowMetadata();
  let currentStage = "start";
  let failureRecorded = false;

  try {
    await startBrowserProviderWorkflow(input, runtimeRunId);

    currentStage = "launch";
    await launchAndPrepareBrowser(input);

    currentStage = "take-control";
    const takeover = createHook<BrowserControlDecision>({
      token: browserTakeoverHookToken(input.coreWorkflowRunId),
    });
    const takeoverDecision = await takeover;
    if (takeoverDecision.decision !== "take_control") {
      throw new FatalError("The browser takeover decision was invalid.");
    }
    await recordBrowserControlTaken(input, takeoverDecision);

    currentStage = "return-control";
    const returnControl = createHook<BrowserControlDecision>({
      token: browserReturnControlHookToken(input.coreWorkflowRunId),
    });
    const returnDecision = await returnControl;
    if (returnDecision.decision !== "return_control") {
      throw new FatalError("The browser return-control decision was invalid.");
    }
    await recordBrowserControlReturned(input, returnDecision);

    currentStage = "verify";
    await verifyBrowserAutomationResumed(input);

    currentStage = "replay";
    const release = await releaseBrowserProviderSession(input);
    let replay = await checkBrowserReplay(input);
    for (let attempt = 1; attempt < 12 && !replay.available; attempt += 1) {
      await sleep("5s");
      replay = await checkBrowserReplay(input);
    }

    if (!replay.available) {
      throw new FatalError("The released browser session did not produce a replay in time.");
    }

    await storeBrowserReplayAndComplete(
      input,
      replay,
      release.sessionViewerUrl,
      release.estimatedCostUsd,
    );

    return {
      browserSessionId: input.browserSessionId,
      coreWorkflowRunId: input.coreWorkflowRunId,
      providerKey: input.providerKey,
      runtimeRunId,
      status: "completed",
    };
  } catch (error) {
    if (!failureRecorded) {
      failureRecorded = true;
      await recordUnexpectedBrowserFailure(input, currentStage, error);
    }
    throw error;
  }
}
