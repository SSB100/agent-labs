import type { JsonObject } from "../../core/contracts";
import type { Page } from "playwright-core";

import { observeStructuredPage } from "./observation";
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
      { elementId, matchCount: count },
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
  const observation = before ?? (await observeStructuredPage(page));
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
    if (action.type === "navigate") {
      const target = new URL(action.url ?? "", observation.url);
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
      error instanceof Error
        ? error.message
        : "The bounded browser action failed.",
      true,
      { actionType: action.type },
    );
  }
}
