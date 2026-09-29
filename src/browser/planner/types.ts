import type { JsonObject } from "../../core/contracts";

export type BrowserElementKind =
  | "button"
  | "checkbox"
  | "input"
  | "link"
  | "option"
  | "radio"
  | "select"
  | "textarea";

export type BrowserObservedElement = {
  id: string;
  kind: BrowserElementKind;
  tag: string;
  role: string | null;
  type: string | null;
  text: string;
  value: string | null;
  name: string | null;
  placeholder: string | null;
  href: string | null;
  disabled: boolean;
  checked: boolean | null;
  selected: boolean | null;
};

export type BrowserObservedForm = {
  id: string;
  action: string | null;
  method: string;
  elementIds: string[];
};

export type BrowserStructuredObservation = {
  url: string;
  title: string;
  visibleText: string;
  forms: BrowserObservedForm[];
  controls: BrowserObservedElement[];
  links: BrowserObservedElement[];
  observedAt: string;
};

export const BROWSER_PLANNER_ACTION_TYPES = [
  "click",
  "type",
  "navigate",
  "complete",
  "fail",
] as const;

export type BrowserPlannerActionType =
  (typeof BROWSER_PLANNER_ACTION_TYPES)[number];

export type BrowserPlannerAction = {
  type: BrowserPlannerActionType;
  elementId: string | null;
  text: string | null;
  url: string | null;
  reason: string;
  failureCategory: string | null;
};

export type BrowserPlannerRequest = {
  objective: string;
  permittedCapabilities: readonly string[];
  observation: BrowserStructuredObservation;
  previousFailure?: BrowserPlannerFailure | null;
};

export type BrowserPlannerFailure = {
  category:
    | "invented_element"
    | "invalid_action"
    | "action_failed"
    | "observation_failed"
    | "model_failed"
    | "recovery_exhausted";
  message: string;
  retryable: boolean;
  details: JsonObject;
};

export type BrowserPlannerDecision = {
  action: BrowserPlannerAction;
  modelKey: string;
  providerModelId: string;
  attempts: number;
  estimatedCostUsd: number;
  reportedCostUsd: number | null;
};

export type BrowserPlannerStepResult = {
  action: BrowserPlannerAction;
  before: BrowserStructuredObservation;
  after: BrowserStructuredObservation | null;
  failure: BrowserPlannerFailure | null;
  completed: boolean;
};

export class BrowserPlannerError extends Error {
  readonly failure: BrowserPlannerFailure;

  constructor(failure: BrowserPlannerFailure) {
    super(failure.message);
    this.name = "BrowserPlannerError";
    this.failure = failure;
  }
}
