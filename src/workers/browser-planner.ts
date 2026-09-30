import type { JsonObject } from "../core/contracts";
import type { WorkerPackManifest } from "./types";

export const BROWSER_PLANNER_PACK_ID =
  "00000000-0000-4000-8000-000000000903";
export const BROWSER_PLANNER_WORKER_DEFINITION_ID =
  "00000000-0000-4000-8000-000000000904";
export const BROWSER_PLANNER_PACK_KEY = "worker.browser-planner";
export const BROWSER_PLANNER_WORKER_KEY = "browser.planner";
export const BROWSER_PLANNER_VERSION = "1.0.0";
export const BROWSER_PLANNER_ROUTE_KEY = "standard.default";

export const BROWSER_PLANNER_ACTION_SCHEMA: JsonObject = {
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
    reason: { type: "string", minLength: 1, maxLength: 500 },
    failureCategory: { type: ["string", "null"] },
  },
};

export const BROWSER_PLANNER_INPUT_SCHEMA: JsonObject = {
  type: "object",
  additionalProperties: false,
  required: ["taskContract", "inputArtifacts"],
  properties: {
    taskContract: {
      type: "object",
      additionalProperties: false,
      required: [
        "id",
        "objective",
        "inputArtifactIds",
        "permittedCapabilities",
        "requiredKnowledge",
        "requiredOutputSchema",
        "completionCriteria",
        "failureCriteria",
        "nonGoals",
        "escalationRules",
      ],
      properties: {
        id: { type: "string", format: "uuid" },
        objective: { type: "string", minLength: 1, maxLength: 4000 },
        inputArtifactIds: {
          type: "array",
          minItems: 1,
          maxItems: 1,
          uniqueItems: true,
          items: { type: "string", format: "uuid" },
        },
        permittedCapabilities: {
          type: "array",
          minItems: 1,
          uniqueItems: true,
          items: {
            type: "string",
            enum: ["browser.observe", "browser.interact"],
          },
        },
        requiredKnowledge: {
          type: "array",
          maxItems: 0,
          items: { type: "string" },
        },
        requiredOutputSchema: { type: "object" },
        completionCriteria: { type: "object" },
        failureCriteria: { type: "object" },
        nonGoals: {
          type: "array",
          minItems: 1,
          uniqueItems: true,
          items: { type: "string" },
        },
        escalationRules: { type: "object" },
      },
    },
    inputArtifacts: {
      type: "array",
      minItems: 1,
      maxItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "artifactType",
          "name",
          "mediaType",
          "content",
          "metadata",
        ],
        properties: {
          id: { type: "string", format: "uuid" },
          artifactType: { const: "browser.structured-observation" },
          name: { type: "string", minLength: 1 },
          mediaType: { const: "application/json" },
          content: { type: "object" },
          metadata: { type: "object" },
        },
      },
    },
  },
};

export const BROWSER_PLANNER_MANIFEST: WorkerPackManifest = {
  manifestVersion: "1.0",
  packKey: BROWSER_PLANNER_PACK_KEY,
  version: BROWSER_PLANNER_VERSION,
  name: "Browser Planner",
  worker: {
    workerKey: BROWSER_PLANNER_WORKER_KEY,
    version: BROWSER_PLANNER_VERSION,
    role: "Browser Planner",
    charter:
      "Choose exactly one safe browser action from the current Task Contract and structured browser observation. Use only stable element identifiers supplied by Browser Service, never credentials or invented selectors, and stop when the Task Contract is complete or bounded recovery is exhausted.",
  },
  inputSchema: BROWSER_PLANNER_INPUT_SCHEMA,
  outputSchema: BROWSER_PLANNER_ACTION_SCHEMA,
  capabilityPolicy: {
    allowed: ["browser.observe", "browser.interact"],
    forbidden: [
      "browser.upload",
      "browser.takeover",
      "money.spend",
      "marketplace.publish",
      "shell.execute",
    ],
  },
  knowledgeRequirements: [],
  modelRequirements: {
    executionMode: "model_router",
    modelRouterRequired: true,
    routeKey: BROWSER_PLANNER_ROUTE_KEY,
    structuredOutput: true,
    toolUse: false,
    fallbackRequired: true,
  },
  instructions: [
    "Read only the current Task Contract and one structured browser observation Artifact.",
    "Choose exactly one next browser action or return complete/fail.",
    "For click or type actions, use only a stable element ID present in the observation.",
    "Never output CSS selectors, XPath, DOM handles, Playwright calls, cookies, credentials, or multiple actions.",
    "After Core executes an action, wait for a fresh observation before choosing another action.",
    "If an observed element becomes stale, use bounded recovery from a fresh observation instead of inventing a selector.",
    "Never publish, spend, or exceed the explicit Task Contract objective.",
  ],
  examples: [
    {
      name: "stable observed click",
      input: {
        objective: "Continue to the next synthetic step.",
        observedElementId: "el_example1",
        observedLabel: "Continue",
      },
      expectedOutput: {
        type: "click",
        elementId: "el_example1",
        text: null,
        url: null,
        reason: "The observed Continue control advances the bounded objective.",
        failureCategory: null,
      },
    },
    {
      name: "read-only completion",
      input: {
        objective: "Confirm the page title and stop.",
        observedTitle: "Example Domain",
      },
      expectedOutput: {
        type: "complete",
        elementId: null,
        text: null,
        url: null,
        reason: "The structured observation already satisfies the objective.",
        failureCategory: null,
      },
    },
  ],
  negativeExamples: [
    {
      name: "invented selector",
      forbiddenBehaviour:
        "Reference a CSS selector, XPath, or element ID that was not supplied by Browser Service.",
      reason:
        "Core can validate only stable element identifiers present in the current structured observation.",
    },
    {
      name: "multiple browser actions",
      forbiddenBehaviour:
        "Return a sequence of clicks, typing, and navigation in one planning step.",
      reason:
        "The Browser Planner must observe again after every executed browser action.",
    },
    {
      name: "raw credentials",
      forbiddenBehaviour:
        "Request or expose passwords, cookies, provider keys, session secrets, or unrestricted browser state.",
      reason:
        "Credentials remain in secure provider/account infrastructure and outside normal model context.",
    },
    {
      name: "out-of-scope publication",
      forbiddenBehaviour:
        "Publish, spend, or perform a higher-impact mutation that is outside the Task Contract.",
      reason:
        "Browser capability does not expand workflow, account, or financial authority.",
    },
  ],
  escalationPolicy: {
    providerFailure: "use_one_qualified_model_fallback_then_stop",
    staleElement: "reobserve_and_retry_within_bounded_recovery",
    validationFailure: "reobserve_and_retry_within_bounded_recovery",
    recoveryExhausted: "fail_task",
    unexpectedFailure: "classify_and_stop",
  },
};
