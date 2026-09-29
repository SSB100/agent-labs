import type { JsonObject } from "../../core/contracts";
import { OpenRouterAdapter } from "../../models/openrouter";
import { runModelRoute } from "../../models/router";
import type { ModelProviderAdapter } from "../../models/types";

import {
  observationElement,
  observationElementIds,
} from "./observation";
import type {
  BrowserPlannerAction,
  BrowserPlannerDecision,
  BrowserPlannerRequest,
} from "./types";
import { BrowserPlannerError } from "./types";

const PLANNER_OUTPUT_SCHEMA: JsonObject = {
  type: "object",
  additionalProperties: false,
  required: [
    "type",
    "elementId",
    "text",
    "url",
    "reason",
    "failureCategory",
  ],
  properties: {
    type: {
      type: "string",
      enum: ["click", "type", "navigate", "complete", "fail"],
    },
    elementId: { type: ["string", "null"] },
    text: { type: ["string", "null"] },
    url: { type: ["string", "null"] },
    reason: { type: "string" },
    failureCategory: { type: ["string", "null"] },
  },
};

const ELEMENT_ACTIONS = new Set(["click", "type"]);

function isAction(value: unknown): value is BrowserPlannerAction {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.type === "string" &&
    ["click", "type", "navigate", "complete", "fail"].includes(record.type) &&
    (record.elementId === null || typeof record.elementId === "string") &&
    (record.text === null || typeof record.text === "string") &&
    (record.url === null || typeof record.url === "string") &&
    typeof record.reason === "string" &&
    (record.failureCategory === null ||
      typeof record.failureCategory === "string")
  );
}

export function validatePlannerAction(
  request: BrowserPlannerRequest,
  action: BrowserPlannerAction,
) {
  if (!action.reason.trim()) {
    throw new BrowserPlannerError({
      category: "invalid_action",
      message: "Browser Planner returned an action without a reason.",
      retryable: true,
      details: {},
    });
  }

  if (ELEMENT_ACTIONS.has(action.type)) {
    if (!action.elementId) {
      throw new BrowserPlannerError({
        category: "invalid_action",
        message: `Browser Planner action ${action.type} requires an elementId.`,
        retryable: true,
        details: { actionType: action.type },
      });
    }
    if (!observationElementIds(request.observation).has(action.elementId)) {
      throw new BrowserPlannerError({
        category: "invented_element",
        message: "Browser Planner referenced an element that was not observed.",
        retryable: true,
        details: { elementId: action.elementId },
      });
    }
    const element = observationElement(request.observation, action.elementId);
    if (element?.disabled) {
      throw new BrowserPlannerError({
        category: "invalid_action",
        message: "Browser Planner selected a disabled element.",
        retryable: true,
        details: { elementId: action.elementId },
      });
    }
  } else if (action.elementId !== null) {
    throw new BrowserPlannerError({
      category: "invalid_action",
      message: `Browser Planner action ${action.type} must not include an elementId.`,
      retryable: true,
      details: { actionType: action.type },
    });
  }

  if (action.type === "type" && !action.text?.length) {
    throw new BrowserPlannerError({
      category: "invalid_action",
      message: "Browser Planner type action requires text.",
      retryable: true,
      details: {},
    });
  }

  if (action.type === "navigate") {
    if (!action.url) {
      throw new BrowserPlannerError({
        category: "invalid_action",
        message: "Browser Planner navigate action requires a URL.",
        retryable: true,
        details: {},
      });
    }
    const target = new URL(action.url, request.observation.url);
    if (!["http:", "https:"].includes(target.protocol)) {
      throw new BrowserPlannerError({
        category: "invalid_action",
        message: "Browser Planner may navigate only to HTTP or HTTPS URLs.",
        retryable: false,
        details: { protocol: target.protocol },
      });
    }
  }

  if (action.type === "complete" && action.failureCategory !== null) {
    throw new BrowserPlannerError({
      category: "invalid_action",
      message: "Completed browser plans cannot include a failure category.",
      retryable: true,
      details: {},
    });
  }

  return action;
}

function messages(request: BrowserPlannerRequest) {
  const allowedElementIds = [
    ...request.observation.controls,
    ...request.observation.links,
  ].map((element) => element.id);

  return [
    {
      role: "system" as const,
      content:
        "You are Agent Labs Browser Planner. Choose exactly one bounded next decision. You never receive Playwright, CSS selectors, XPath, DOM handles, credentials, cookies, or unrestricted browser APIs. For click/type actions, use only a stable elementId present in the supplied observation. Never invent an elementId. Prefer observation before mutation. If the objective is satisfied, return complete. If safe progress is impossible, return fail. Do not plan multiple browser actions at once.",
    },
    {
      role: "user" as const,
      content: JSON.stringify({
        objective: request.objective,
        permittedCapabilities: request.permittedCapabilities,
        observation: request.observation,
        allowedElementIds,
        previousFailure: request.previousFailure ?? null,
      }),
    },
  ];
}

export async function planBrowserAction(
  request: BrowserPlannerRequest,
  options: {
    adapter?: ModelProviderAdapter;
    forcePrimaryFailure?: boolean;
  } = {},
): Promise<BrowserPlannerDecision> {
  const result = await runModelRoute({
    adapter: options.adapter ?? new OpenRouterAdapter(),
    routeKey: "standard.default",
    outputSchema: PLANNER_OUTPUT_SCHEMA,
    schemaName: "agent_labs_browser_planner_action",
    messages: messages(request),
    requestMetadata: {
      worker: "browser.planner",
      contract: "one_bounded_browser_action",
      observationUrl: request.observation.url,
    },
    forcePrimaryFailure: options.forcePrimaryFailure,
  });

  if (!isAction(result.output)) {
    throw new BrowserPlannerError({
      category: "model_failed",
      message: "Browser Planner returned malformed structured output.",
      retryable: true,
      details: {},
    });
  }

  const action = validatePlannerAction(request, result.output);

  return {
    action,
    modelKey: result.selectedModel.modelKey,
    providerModelId: result.selectedModel.providerModelId,
    attempts: result.attempts.length,
    estimatedCostUsd: result.totalEstimatedCostUsd,
    reportedCostUsd: result.totalReportedCostUsd,
  };
}

export const BROWSER_PLANNER_OUTPUT_SCHEMA = PLANNER_OUTPUT_SCHEMA;
