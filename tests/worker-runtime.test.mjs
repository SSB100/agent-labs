import assert from "node:assert/strict";
import test from "node:test";

import genericModule from "../.core-tests/workers/generic-researcher.js";
import runtimeModule from "../.core-tests/workers/runtime.js";
import typesModule from "../.core-tests/workers/types.js";

const {
  GENERIC_RESEARCHER_MANIFEST,
  executeGenericResearcherFixture,
} = genericModule;
const { executeWorkerPack, validateWorkerInvocationContext } = runtimeModule;
const { WorkerRuntimeError } = typesModule;

const artifactId = "00000000-0000-4000-8000-000000004101";

function validContext() {
  return {
    taskContract: {
      id: "00000000-0000-4000-8000-000000004102",
      objective:
        "Summarise the supplied signals, separate evidence from inference and stop without recommending a strategy.",
      inputArtifactIds: [artifactId],
      permittedCapabilities: [],
      requiredKnowledge: ["fixture.synthetic-market-signals"],
      requiredOutputSchema: GENERIC_RESEARCHER_MANIFEST.outputSchema,
      completionCriteria: {
        requiredDecision: "complete",
        minimumEvidenceCount: 3,
        requiredStopReason: "completion_criteria_satisfied",
      },
      failureCriteria: {
        allowedCategories: [
          "contract_invalid",
          "context_invalid",
          "validation_failed",
          "worker_execution_failed",
        ],
      },
      nonGoals: [
        "Choose a final business strategy",
        "Browse for additional evidence",
        "Create or publish a product",
      ],
      escalationRules: { onFailure: "classify_and_stop", maximumAttempts: 1 },
    },
    inputArtifacts: [
      {
        id: artifactId,
        artifactType: "fixture.market-signals",
        name: "Synthetic market signals",
        mediaType: "application/json",
        content: {
          fixtureMode: "valid",
          signals: [
            { id: "signal-1", observation: "Synthetic signal one" },
            { id: "signal-2", observation: "Synthetic signal two" },
            { id: "signal-3", observation: "Synthetic signal three" },
          ],
        },
        metadata: { knowledgeKey: "fixture.synthetic-market-signals" },
      },
    ],
  };
}

test("Generic Researcher receives only Task Contract context and stops on completion", () => {
  const context = validContext();
  validateWorkerInvocationContext(GENERIC_RESEARCHER_MANIFEST, context);

  const result = executeWorkerPack(
    GENERIC_RESEARCHER_MANIFEST,
    executeGenericResearcherFixture,
    context,
  );

  assert.deepEqual(Object.keys(context).sort(), ["inputArtifacts", "taskContract"]);
  assert.equal(result.output.decision, "complete");
  assert.equal(result.output.evidenceCount, 3);
  assert.equal(result.output.scopeBoundary, "task_contract_only");
  assert.equal(result.output.stopReason, "completion_criteria_satisfied");
  assert.equal(result.receipt.outputValidated, true);
  assert.equal(result.receipt.executionMode, "deterministic_fixture");
});

test("unrestricted conversation history is rejected before worker execution", () => {
  const context = validContext();
  context.taskContract.messages = [];

  assert.throws(
    () =>
      executeWorkerPack(
        GENERIC_RESEARCHER_MANIFEST,
        executeGenericResearcherFixture,
        context,
      ),
    (error) =>
      error instanceof WorkerRuntimeError && error.category === "context_invalid",
  );
});

test("capabilities and knowledge must stay inside the Worker Pack declaration", () => {
  const capabilityContext = validContext();
  capabilityContext.taskContract.permittedCapabilities = ["browser.interact"];

  assert.throws(
    () =>
      executeWorkerPack(
        GENERIC_RESEARCHER_MANIFEST,
        executeGenericResearcherFixture,
        capabilityContext,
      ),
    (error) =>
      error instanceof WorkerRuntimeError && error.category === "contract_invalid",
  );

  const knowledgeContext = validContext();
  knowledgeContext.taskContract.requiredKnowledge = ["private.everything"];

  assert.throws(
    () =>
      executeWorkerPack(
        GENERIC_RESEARCHER_MANIFEST,
        executeGenericResearcherFixture,
        knowledgeContext,
      ),
    (error) =>
      error instanceof WorkerRuntimeError && error.category === "contract_invalid",
  );
});

test("malformed worker output is classified as validation_failed", () => {
  const context = validContext();
  context.inputArtifacts[0].content.fixtureMode = "invalid-output";

  assert.throws(
    () =>
      executeWorkerPack(
        GENERIC_RESEARCHER_MANIFEST,
        executeGenericResearcherFixture,
        context,
      ),
    (error) =>
      error instanceof WorkerRuntimeError &&
      error.category === "validation_failed" &&
      Array.isArray(error.details.issues),
  );
});

test("Task Contract output schema remains pinned to the worker version", () => {
  const context = validContext();
  context.taskContract.requiredOutputSchema = {
    type: "object",
    required: ["different"],
  };

  assert.throws(
    () =>
      executeWorkerPack(
        GENERIC_RESEARCHER_MANIFEST,
        executeGenericResearcherFixture,
        context,
      ),
    (error) =>
      error instanceof WorkerRuntimeError && error.category === "contract_invalid",
  );
});
