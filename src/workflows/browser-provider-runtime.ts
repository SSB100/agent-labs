import { createHook, FatalError, getWorkflowMetadata } from "workflow";

import {
  launchAndObserveBrowser,
  recordBrowserControlReturned,
  recordBrowserControlTaken,
  recordBrowserWorkflowFailure,
  releaseQualifiedBrowser,
  startBrowserWorkflow,
  verifyBrowserAutomationReturned,
} from "./browser-provider-runtime-steps";

export const BROWSER_PROVIDER_RUNTIME_WORKFLOW_KEY =
  "synthetic.browser-provider.qualification";
export const BROWSER_PROVIDER_RUNTIME_WORKFLOW_DEFINITION_ID =
  "00000000-0000-4000-8000-000000000801";

export type BrowserProviderRuntimeInput = {
  browserIdentityId: string;
  browserSessionId: string;
  businessId: string;
  coreWorkflowRunId: string;
  providerKey: "steel" | "browserbase";
  providerProfileId: string | null;
  runtimeCapability: string;
};

export type BrowserControlDecision = {
  decidedAt: string;
  ownerUserId: string;
};

export type BrowserProviderRuntimeResult = {
  browserSessionId: string;
  coreWorkflowRunId: string;
  providerKey: string;
  runtimeRunId: string;
  status: "completed";
};

export function browserTakeControlHookToken(coreWorkflowRunId: string) {
  return `agent-labs:browser-take-control:${coreWorkflowRunId}`;
}

export function browserReturnControlHookToken(coreWorkflowRunId: string) {
  return `agent-labs:browser-return-control:${coreWorkflowRunId}`;
}

function describeFailure(error: unknown) {
  return {
    category:
      error && typeof error === "object" && "category" in error
        ? String(error.category)
        : "browser_runtime_failed",
    message:
      error instanceof Error
        ? error.message.slice(0, 500)
        : "Unknown browser workflow failure",
    name: error instanceof Error ? error.name.slice(0, 120) : "UnknownError",
  };
}

export async function browserProviderRuntimeWorkflow(
  input: BrowserProviderRuntimeInput,
): Promise<BrowserProviderRuntimeResult> {
  "use workflow";

  const { workflowRunId: runtimeRunId } = getWorkflowMetadata();
  let providerSessionId: string | null = null;
  let currentStage = "launch";
  let failureRecorded = false;

  try {
    await startBrowserWorkflow(input, runtimeRunId);
    providerSessionId = await launchAndObserveBrowser(input);

    currentStage = "take-control";
    const takeControl = createHook<BrowserControlDecision>({
      token: browserTakeControlHookToken(input.coreWorkflowRunId),
    });
    const takeoverDecision = await takeControl;
    await recordBrowserControlTaken(input, takeoverDecision);

    currentStage = "return-control";
    const returnControl = createHook<BrowserControlDecision>({
      token: browserReturnControlHookToken(input.coreWorkflowRunId),
    });
    const returnDecision = await returnControl;
    await recordBrowserControlReturned(input, returnDecision);

    currentStage = "verify";
    await verifyBrowserAutomationReturned(input, providerSessionId);

    currentStage = "replay";
    await releaseQualifiedBrowser(input, providerSessionId);

    return {
      browserSessionId: input.browserSessionId,
      coreWorkflowRunId: input.coreWorkflowRunId,
      providerKey: input.providerKey,
      runtimeRunId,
      status: "completed",
    };
  } catch (error) {
    failureRecorded = true;
    await recordBrowserWorkflowFailure(
      input,
      providerSessionId,
      currentStage,
      describeFailure(error),
    );
    throw new FatalError(
      error instanceof Error ? error.message : "Browser qualification failed.",
    );
  } finally {
    if (!failureRecorded && currentStage !== "replay") {
      await recordBrowserWorkflowFailure(
        input,
        providerSessionId,
        currentStage,
        {
          category: "browser_runtime_interrupted",
          message: "Browser qualification ended before replay completion.",
          name: "BrowserRuntimeInterrupted",
        },
      );
    }
  }
}
