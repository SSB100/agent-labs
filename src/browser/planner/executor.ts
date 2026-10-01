import type { JsonObject } from "../../core/contracts";
import type { Page } from "playwright-core";

import { observationElementIds, observeStructuredPage, sanitizeStructuredObservation } from "./observation";
import { assertPlannerActionPrivacy, plannerActionReceipt } from "./privacy";
import type {
  BrowserPlannerAction,
  BrowserPlannerFailure,
  BrowserPlannerStepResult,
  BrowserStructuredObservation,
} from "./types";
import { BrowserPlannerError } from "./types";

const STABLE_ID_ATTRIBUTE = "data-agent-labs-element-id";

function capabilityFor(action: BrowserPlannerAction) {
  if (action.type === "complete" || action.type === "fail") return null;
  if (action.type === "navigate") return "browser.interact";
  if (action.type === "click" || action.type === "type") {
    return "browser.interact";
  }
  return "browser.interact";
}

function failure(
  category: BrowserPlannerFailure["category"],
  message: string,
  retryable: boolean,
  details: JsonObject = {},
): BrowserPlannerError {
  return new BrowserPlannerError({
    category,
    message,
    retryable,
    details,
  });
}

async function locatorForStableId(page: Page, elementId: string) {
  const locator = page.locator(
    `[${STABLE_ID_ATTRIBUTE}="${elementId.replaceAll('"', "\\\"")}"]`,
  );
  const count = await locator.count();
  if (count !== 1) {
    throw failure(
      "invented_element",
      "The planned element is no longer uniquely available in the current observation.",
      true,
      { matchCount: count },
    );
  }
  return locator;
}

export async function executePlannerAction(
  page: Page,
  action: BrowserPlannerAction,
  permittedCapabilities: readonly string[],
  before?: BrowserStructuredObservation,
): Promise<BrowserPlannerStepResult> {
  const observation = before ? sanitizeStructuredObservation(before) : await observeStructuredPage(page);
  assertPlannerActionPrivacy(observation, action);
  action = plannerActionReceipt(action);
  const requiredCapability = capabilityFor(action);
  if (
    requiredCapability &&
    !permittedCapabilities.includes(requiredCapability)
  ) {
    throw failure(
      "invalid_action",
      `Browser action ${action.type} requires ${requiredCapability}.`,
      false,
      { requiredCapability },
    );
  }

  if (action.type === "complete") {
    return {
      action,
      before: observation,
      after: null,
      failure: null,
      completed: true,
    };
  }

  if (action.type === "fail") {
    return {
      action,
      before: observation,
      after: null,
      failure: {
        category: "action_failed",
        message: action.reason,
        retryable: false,
        details: {
          failureCategory: action.failureCategory ?? "planner_declined",
        },
      },
      completed: true,
    };
  }

  try {
    // Check identity before observing again so stale-target recovery remains meaningful.
    if ((action.type === "type" || action.type === "click") && action.elementId) {
      await locatorForStableId(page, action.elementId);
    }
    // Reinspect immediately before a mutation; never trust a stale safe-field classification.
    const current = await observeStructuredPage(page);
    assertPlannerActionPrivacy(current, action);
    if ((action.type === "type" || action.type === "click") &&
        (!action.elementId || !observationElementIds(current).has(action.elementId))) {
      throw failure("invented_element", "The planned element is no longer present.", true);
    }
    if (action.type === "type" || action.type === "click") {
      const before = [...observation.controls, ...observation.links].find(e => e.id === action.elementId);
      const after = [...current.controls, ...current.links].find(e => e.id === action.elementId);
      // Positional IDs are observation-local. A DOM reorder must never retarget a
      // saved action to a different control occupying the previous position.
      const binding = (element: typeof before) => element && JSON.stringify([element.kind, element.tag, element.role,
        element.type, element.text, element.name, element.placeholder, element.href]);
      if (!before || !after || binding(before) !== binding(after)) {
        throw failure("invented_element", "The planned element binding changed; observe and plan again.", true);
      }
    }
    if ((action.type !== "type" && action.text !== null) ||
        (action.type !== "navigate" && action.url !== null)) {
      throw failure("invalid_action", "Browser action includes unrelated input data.", false);
    }
    if (action.type === "navigate") {
      const target = new URL(action.url ?? "", observation.url);
      if (!["http:", "https:"].includes(target.protocol)) {
        throw failure("invalid_action", "Browser navigation is limited to HTTP and HTTPS URLs.", false);
      }
      await page.goto(target.toString(), {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
    } else if (action.type === "click") {
      if (!action.elementId) {
        throw failure(
          "invalid_action",
          "Click action is missing its stable element ID.",
          false,
        );
      }
      await (await locatorForStableId(page, action.elementId)).click({
        timeout: 15_000,
      });
    } else if (action.type === "type") {
      if (!action.elementId || action.text === null) {
        throw failure(
          "invalid_action",
          "Type action is missing its stable element ID or text.",
          false,
        );
      }
      await (await locatorForStableId(page, action.elementId)).fill(action.text, {
        timeout: 15_000,
      });
    }

    return {
      action,
      before: observation,
      after: await observeStructuredPage(page),
      failure: null,
      completed: false,
    };
  } catch (error) {
    if (error instanceof BrowserPlannerError) throw error;
    throw failure(
      "action_failed",
      "The bounded browser action failed; provider details were withheld.",
      true,
      { actionType: action.type },
    );
  }
}
