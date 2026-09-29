import { FatalError, getWorkflowMetadata } from "workflow";

import {
  completeBrowserPlannerQualification,
  failBrowserPlannerQualification,
  launchBrowserPlannerSession,
  qualifyControlledDraft,
  qualifyMockCommerce,
  qualifyRealReadOnly,
  qualifySyntheticPlanner,
  startBrowserPlannerQualification,
} from "./browser-planner-runtime-steps";

export const BROWSER_PLANNER_RUNTIME_WORKFLOW_KEY =
  "synthetic.browser-planner.qualification";
export const BROWSER_PLANNER_RUNTIME_WORKFLOW_DEFINITION_ID =
  "00000000-0000-4000-8000-000000000902";

export type BrowserPlannerRuntimeInput = {
  browserIdentityId: string;
  browserSessionId: string;
  businessId: string;
  coreWorkflowRunId: string;
  providerKey: "steel" | "browserbase";
  providerProfileId: string | null;
  runtimeCapability: string;
};

export type BrowserPlannerRuntimeResult = {
  browserSessionId: string;
  coreWorkflowRunId: string;
  runtimeRunId: string;
  status: "completed";
};

function failureSummary(error: unknown) {
  return {
    category:
      error && typeof error === "object" && "failure" in error
        ? String((error as { failure?: { category?: unknown } }).failure?.category ?? "browser_planner_failed")
        : "browser_planner_failed",
    message:
      error instanceof Error
        ? error.message.slice(0, 500)
        : "Unknown Browser Planner qualification failure.",
  };
}

export async function browserPlannerRuntimeWorkflow(
  input: BrowserPlannerRuntimeInput,
): Promise<BrowserPlannerRuntimeResult> {
  "use workflow";

  const { workflowRunId: runtimeRunId } = getWorkflowMetadata();
  let providerSessionId: string | null = null;
  let currentStage = "launch";

  try {
    await startBrowserPlannerQualification(input, runtimeRunId);
    providerSessionId = await launchBrowserPlannerSession(input);

    currentStage = "synthetic";
    await qualifySyntheticPlanner(input, providerSessionId);

    currentStage = "mock-commerce";
    await qualifyMockCommerce(input, providerSessionId);

    currentStage = "real-read-only";
    await qualifyRealReadOnly(input, providerSessionId);

    currentStage = "controlled-draft";
    await qualifyControlledDraft(input, providerSessionId);

    currentStage = "complete";
    await completeBrowserPlannerQualification(input, providerSessionId);

    return {
      browserSessionId: input.browserSessionId,
      coreWorkflowRunId: input.coreWorkflowRunId,
      runtimeRunId,
      status: "completed",
    };
  } catch (error) {
    await failBrowserPlannerQualification(
      input,
      providerSessionId,
      currentStage,
      failureSummary(error),
    );
    throw new FatalError(
      error instanceof Error
        ? error.message
        : "Browser Planner qualification failed.",
    );
  }
}
