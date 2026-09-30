import assert from "node:assert/strict";
import test from "node:test";

import fixturesModule from "../.core-tests/browser/planner/fixtures.js";
import plannerModule from "../.core-tests/browser/planner/planner.js";
import recoveryModule from "../.core-tests/browser/planner/recovery.js";
import workerRuntimeModule from "../.core-tests/workers/runtime.js";
import workerModule from "../.core-tests/workers/browser-planner.js";

const {
  MOCK_COMMERCE_OBSERVATION,
  READ_ONLY_SITE_OBSERVATION,
  SYNTHETIC_LOGIN_OBSERVATION,
} = fixturesModule;
const {
  BROWSER_PLANNER_OUTPUT_SCHEMA,
  planBrowserAction,
  validatePlannerAction,
} = plannerModule;
const { BROWSER_PLANNER_MAX_RECOVERY_ATTEMPTS } = recoveryModule;
const { validateWorkerPackManifest } = workerRuntimeModule;
const { BROWSER_PLANNER_MANIFEST } = workerModule;

function taskContract(objective, permittedCapabilities) {
  return {
    id: "00000000-0000-4000-8000-000000009001",
    objective,
    inputArtifactIds: ["00000000-0000-4000-8000-000000009002"],
    permittedCapabilities,
    requiredKnowledge: [],
    requiredOutputSchema: BROWSER_PLANNER_MANIFEST.outputSchema,
    nonGoals: [
      "Invent selectors or element identifiers.",
      "Return multiple browser actions in one planning step.",
    ],
    completionCriteria: { oneBoundedAction: true },
    failureCriteria: { maximumRecoveryAttempts: 2 },
    escalationRules: { recovery: "bounded" },
  };
}

function fakeAdapter(output) {
  return {
    async invokeStructured(request) {
      return {
        output,
        provider: "fixture",
        providerModelId: request.model.providerModelId,
        providerRequestId: "stage9-fixture",
        latencyMs: 4,
        usage: {
          inputTokens: 50,
          outputTokens: 20,
          totalTokens: 70,
          cachedInputTokens: 0,
          reasoningTokens: 0,
          reportedCostUsd: 0.00001,
          estimatedCostUsd: 0.00001,
        },
        metadata: { fixture: true },
      };
    },
    async qualifyToolUse() {
      throw new Error("Browser Planner qualification does not call tools directly.");
    },
  };
}

test("Browser Planner Worker Pack is a valid versioned specialist worker", () => {
  assert.doesNotThrow(() => validateWorkerPackManifest(BROWSER_PLANNER_MANIFEST));
  assert.equal(BROWSER_PLANNER_MANIFEST.worker.workerKey, "browser.planner");
  assert.deepEqual(BROWSER_PLANNER_MANIFEST.capabilityPolicy.allowed, [
    "browser.observe",
    "browser.interact",
  ]);
  assert.equal(
    BROWSER_PLANNER_MANIFEST.modelRequirements.routeKey,
    "standard.default",
  );
});

test("Stage 9 planner schema encodes exactly one bounded decision", () => {
  assert.equal(BROWSER_PLANNER_OUTPUT_SCHEMA.type, "object");
  assert.equal(BROWSER_PLANNER_OUTPUT_SCHEMA.additionalProperties, false);
  assert.deepEqual(
    BROWSER_PLANNER_OUTPUT_SCHEMA.properties.type.enum,
    ["click", "type", "navigate", "complete", "fail"],
  );
  assert.equal(BROWSER_PLANNER_MAX_RECOVERY_ATTEMPTS, 2);
});

test("Browser Planner accepts only stable element IDs present in the observation", () => {
  const request = {
    taskContract: taskContract(
      "Save this product as a draft.",
      ["browser.observe", "browser.interact"],
    ),
    observation: MOCK_COMMERCE_OBSERVATION,
  };

  assert.doesNotThrow(() =>
    validatePlannerAction(request, {
      type: "click",
      elementId: "el_save001",
      text: null,
      url: null,
      reason: "Save the current product draft.",
      failureCategory: null,
    }),
  );

  assert.throws(
    () =>
      validatePlannerAction(request, {
        type: "click",
        elementId: "#save-button",
        text: null,
        url: null,
        reason: "Invented selector should be rejected.",
        failureCategory: null,
      }),
    (error) =>
      error?.failure?.category === "invented_element" &&
      /not observed/.test(error.message),
  );
});

test("Browser Planner cannot smuggle selectors into non-element actions", () => {
  assert.throws(
    () =>
      validatePlannerAction(
        {
          taskContract: taskContract(
            "Inspect example.com.",
            ["browser.observe"],
          ),
          observation: READ_ONLY_SITE_OBSERVATION,
        },
        {
          type: "complete",
          elementId: "el_more001",
          text: null,
          url: null,
          reason: "Done.",
          failureCategory: null,
        },
      ),
    /must not include an elementId/,
  );
});

test("Browser Planner emits one valid model-routed action with no Playwright exposure", async () => {
  const decision = await planBrowserAction(
    {
      taskContract: taskContract(
        "Enter the email address.",
        ["browser.observe", "browser.interact"],
      ),
      observation: SYNTHETIC_LOGIN_OBSERVATION,
    },
    {
      adapter: fakeAdapter({
        type: "type",
        elementId: "el_email01",
        text: "owner@example.test",
        url: null,
        reason: "The observed email field is the required next input.",
        failureCategory: null,
      }),
    },
  );

  assert.equal(decision.action.type, "type");
  assert.equal(decision.action.elementId, "el_email01");
  assert.equal(decision.attempts, 1);
  assert.equal(decision.modelKey, "luna.standard");
});

test("Browser Planner rejects a model that invents an element ID", async () => {
  await assert.rejects(
    () =>
      planBrowserAction(
        {
          taskContract: taskContract(
            "Sign in.",
            ["browser.observe", "browser.interact"],
          ),
          observation: SYNTHETIC_LOGIN_OBSERVATION,
        },
        {
          adapter: fakeAdapter({
            type: "click",
            elementId: "el_does_not_exist",
            text: null,
            url: null,
            reason: "Try a made-up button.",
            failureCategory: null,
          }),
        },
      ),
    (error) => error?.failure?.category === "invented_element",
  );
});

test("Browser Planner supports bounded read-only completion without browser mutation", async () => {
  const decision = await planBrowserAction(
    {
      taskContract: taskContract(
        "Confirm the page is Example Domain and stop.",
        ["browser.observe"],
      ),
      observation: READ_ONLY_SITE_OBSERVATION,
    },
    {
      adapter: fakeAdapter({
        type: "complete",
        elementId: null,
        text: null,
        url: null,
        reason: "The observed title and text already satisfy the objective.",
        failureCategory: null,
      }),
    },
  );

  assert.equal(decision.action.type, "complete");
  assert.equal(decision.action.elementId, null);
});

test("password fields never expose their current value to the planner", () => {
  const password = SYNTHETIC_LOGIN_OBSERVATION.controls.find(
    (control) => control.type === "password",
  );
  assert.equal(password?.value, null);
});
