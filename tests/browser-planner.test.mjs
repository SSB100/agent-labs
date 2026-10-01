import assert from "node:assert/strict";
import test from "node:test";

import fixturesModule from "../.core-tests/browser/planner/fixtures.js";
import plannerModule from "../.core-tests/browser/planner/planner.js";
import recoveryModule from "../.core-tests/browser/planner/recovery.js";
import workerRuntimeModule from "../.core-tests/workers/runtime.js";
import workerModule from "../.core-tests/workers/browser-planner.js";
import schemaModule from "../.core-tests/workers/schema-validator.js";

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
const { BROWSER_PLANNER_MAX_RECOVERY_ATTEMPTS, runBrowserPlannerCycle } = recoveryModule;
const { validateWorkerPackManifest, validateWorkerInvocationContext } = workerRuntimeModule;
const { BROWSER_PLANNER_MANIFEST } = workerModule;
const { validateJsonSchemaValue } = schemaModule;

test("Browser Planner durable context accepts constant-only Artifact fields", () => {
  const context = {
    taskContract: taskContract("Confirm Example Domain and stop.", ["browser.observe"]),
    inputArtifacts: [{
      id: "00000000-0000-4000-8000-000000009002",
      artifactType: "browser.structured-observation",
      name: "Read-only browser observation",
      mediaType: "application/json",
      content: READ_ONLY_SITE_OBSERVATION,
      metadata: {},
    }],
  };
  assert.doesNotThrow(() => validateWorkerInvocationContext(BROWSER_PLANNER_MANIFEST, context));
  context.inputArtifacts[0].artifactType = "unrelated.artifact";
  assert.throws(() => validateWorkerInvocationContext(BROWSER_PLANNER_MANIFEST, context));
});

test("Browser Planner output accepts nullable fields while rejecting invalid values", () => {
  const output = {
    type: "complete", elementId: null, text: null, url: null,
    reason: "Example Domain is confirmed.", failureCategory: null,
  };
  assert.deepEqual(validateJsonSchemaValue(BROWSER_PLANNER_MANIFEST.outputSchema, output), []);
  assert.notEqual(validateJsonSchemaValue(BROWSER_PLANNER_MANIFEST.outputSchema,
    { ...output, elementId: 42 }).length, 0);
  assert.notEqual(validateJsonSchemaValue(BROWSER_PLANNER_MANIFEST.outputSchema,
    { ...output, reason: "" }).length, 0);
});

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

test("verified objectives stop repeated mutations and unverified objectives cannot complete", () => {
  const request = {
    taskContract: taskContract("Save the draft once and stop.", ["browser.observe", "browser.interact"]),
    observation: MOCK_COMMERCE_OBSERVATION,
  };
  const click = { type: "click", elementId: "el_save001", text: null, url: null,
    reason: "Save draft.", failureCategory: null };
  const complete = { ...click, type: "complete", elementId: null, reason: "Draft is saved." };
  request.taskContract.completionCriteria.objectiveVerified = true;
  assert.throws(() => validatePlannerAction(request, click), /already verified/);
  assert.doesNotThrow(() => validatePlannerAction(request, complete));
  request.taskContract.completionCriteria.objectiveVerified = false;
  assert.throws(() => validatePlannerAction(request, complete), /not yet verified/);
  assert.doesNotThrow(() => validatePlannerAction(request, click));
});

test("the model receives current completion evidence and the exact durable scope", async () => {
  const contract = taskContract("Save the draft once and stop.", ["browser.observe", "browser.interact"]);
  contract.completionCriteria.objectiveVerified = true;
  contract.nonGoals.push("Click Publish.");
  const adapter = fakeAdapter({ type: "complete", elementId: null, text: null, url: null,
    reason: "The observed saved draft satisfies the objective.", failureCategory: null });
  const invoke = adapter.invokeStructured;
  adapter.invokeStructured = async (request) => {
    const context = JSON.parse(request.messages[1].content);
    assert.equal(context.objectiveVerified, true);
    assert.deepEqual(context.taskContract, contract);
    assert.equal(context.previousFailure, null);
    assert.match(request.messages[0].content, /Do not repeat a successful action/);
    return invoke(request);
  };
  const decision = await planBrowserAction({ taskContract: contract,
    observation: MOCK_COMMERCE_OBSERVATION, previousFailure: null }, { adapter });
  assert.equal(decision.action.type, "complete");
});

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

test("a planner fail decision stops without retrying or reporting success", async () => {
  let invocations = 0;
  const adapter = fakeAdapter({
    type: "fail",
    elementId: null,
    text: null,
    url: null,
    reason: "The task cannot progress safely.",
    failureCategory: "blocked_objective",
  });
  const invoke = adapter.invokeStructured;
  adapter.invokeStructured = async (request) => {
    invocations += 1;
    return invoke(request);
  };
  const page = {
    async evaluateHandle() { return {evaluate:async()=>true,dispose:async()=>{}}; },
    async evaluate() {
      return READ_ONLY_SITE_OBSERVATION;
    },
    locator() {
      throw new Error("A fail decision must not touch browser controls.");
    },
    async goto() {
      throw new Error("A fail decision must not navigate.");
    },
  };

  const result = await runBrowserPlannerCycle(page, {
    objective: "Stop when the objective cannot progress safely.",
    permittedCapabilities: ["browser.observe"],
    adapter,
  });
  assert.equal(invocations, 1);
  assert.equal(result.completed, false);
  assert.equal(result.failure.retryable, false);
  assert.equal(result.failure.details.failureCategory, "blocked_objective");
});
