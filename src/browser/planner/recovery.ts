import type { Page } from "playwright-core";

import { executePlannerAction } from "./executor";
import { observeStructuredPage } from "./observation";
import { planBrowserAction } from "./planner";
import type {
  BrowserPlannerDecision,
  BrowserPlannerFailure,
  BrowserPlannerStepResult,
} from "./types";
import { BrowserPlannerError } from "./types";
import type { ModelProviderAdapter } from "../../models/types";

export const BROWSER_PLANNER_MAX_RECOVERY_ATTEMPTS = 2;

export type BrowserPlannerCycleResult = {
  decisions: BrowserPlannerDecision[];
  steps: BrowserPlannerStepResult[];
  completed: boolean;
  failure: BrowserPlannerFailure | null;
};

export async function runBrowserPlannerCycle(
  page: Page,
  input: {
    objective: string;
    permittedCapabilities: readonly string[];
    adapter?: ModelProviderAdapter;
    maximumRecoveryAttempts?: number;
  },
): Promise<BrowserPlannerCycleResult> {
  const maximumRecoveryAttempts =
    input.maximumRecoveryAttempts ?? BROWSER_PLANNER_MAX_RECOVERY_ATTEMPTS;
  const decisions: BrowserPlannerDecision[] = [];
  const steps: BrowserPlannerStepResult[] = [];
  let previousFailure: BrowserPlannerFailure | null = null;

  for (
    let recoveryAttempt = 0;
    recoveryAttempt <= maximumRecoveryAttempts;
    recoveryAttempt += 1
  ) {
    const observation = await observeStructuredPage(page);

    try {
      const decision = await planBrowserAction(
        {
          taskContract: {
            id: "00000000-0000-4000-8000-000000009999",
            objective: input.objective,
            inputArtifactIds: ["00000000-0000-4000-8000-000000009998"],
            permittedCapabilities: input.permittedCapabilities,
            requiredKnowledge: [],
            requiredOutputSchema: {
              type: "object",
              additionalProperties: false,
            },
            nonGoals: [
              "Invent selectors or element identifiers.",
              "Return multiple browser actions in one planning step.",
            ],
            completionCriteria: { oneBoundedAction: true },
            failureCriteria: { maximumRecoveryAttempts },
            escalationRules: {
              previousFailure: previousFailure
                ? {
                    category: previousFailure.category,
                    message: previousFailure.message,
                    retryable: previousFailure.retryable,
                    details: previousFailure.details,
                  }
                : null,
            },
          },
          observation,
          previousFailure,
        },
        { adapter: input.adapter },
      );
      decisions.push(decision);
      const step = await executePlannerAction(
        page,
        decision.action,
        input.permittedCapabilities,
        observation,
      );
      steps.push(step);

      if (step.completed) {
        return {
          decisions,
          steps,
          completed: step.failure === null,
          failure: step.failure,
        };
      }

      return {
        decisions,
        steps,
        completed: false,
        failure: null,
      };
    } catch (error) {
      const plannerFailure =
        error instanceof BrowserPlannerError
          ? error.failure
          : {
              category: "action_failed" as const,
              message:
                error instanceof Error
                  ? error.message
                  : "Browser Planner execution failed.",
              retryable: true,
              details: {},
            };
      previousFailure = plannerFailure;

      if (!plannerFailure.retryable) {
        return {
          decisions,
          steps,
          completed: false,
          failure: plannerFailure,
        };
      }
    }
  }

  return {
    decisions,
    steps,
    completed: false,
    failure: {
      category: "recovery_exhausted",
      message: "Browser Planner exhausted its bounded recovery attempts.",
      retryable: false,
      details: { maximumRecoveryAttempts },
    },
  };
}
