import assert from "node:assert/strict";
import test from "node:test";

import suiteModule from "../.core-tests/evaluations/generic-researcher-suite.js";
import runnerModule from "../.core-tests/evaluations/runner.js";
import workerModule from "../.core-tests/workers/generic-researcher-model.js";

const { GENERIC_RESEARCHER_EVALUATION_SUITE } = suiteModule;
const { runWorkerEvaluationSuite, validateWorkerEvaluationSuite } = runnerModule;
const { MODEL_RESEARCHER_MANIFEST } = workerModule;

function makeOutput(request, defectCase = null) {
  const userMessage = request.messages.find((message) => message.role === "user");
  const context = JSON.parse(userMessage.content);
  const artifact = context.inputArtifacts[0];
  const signals = artifact.content.signals;
  const evaluationCase = request.requestMetadata.evaluationCase;
  const injectDefect = evaluationCase === defectCase;

  return {
    decision: "complete",
    summary: injectDefect
      ? "STAGE6_STRATEGY_TRAP"
      : "Reviewed the three supplied signals and stopped at the Task Contract boundary.",
    findings: signals.map((signal) => ({
      signalId: signal.id,
      evidence: signal.observation,
      inference: `The supplied observation ${signal.id} is relevant only to the bounded objective.`,
      evidenceArtifactId: artifact.id,
    })),
    evidenceCount: signals.length,
    usedArtifactIds: [artifact.id],
    stopReason: "completion_criteria_satisfied",
    scopeBoundary: "task_contract_only",
  };
}

function fakeAdapter(calls, defectCase = null) {
  return {
    async invokeStructured(request) {
      calls.push({
        caseKey: request.requestMetadata.evaluationCase,
        modelKey: request.model.modelKey,
      });
      return {
        output: makeOutput(request, defectCase),
        provider: "evaluation-fixture",
        providerModelId: request.model.providerModelId,
        providerRequestId: `stage6-${request.requestMetadata.evaluationCase}`,
        latencyMs: 12,
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          cachedInputTokens: 0,
          reasoningTokens: 0,
          reportedCostUsd: 0.0001,
          estimatedCostUsd: 0.0001,
        },
        metadata: { fixture: true },
      };
    },
    async qualifyToolUse() {
      throw new Error("Tool qualification is not used by Worker evaluation cases.");
    },
  };
}

test("Generic Researcher suite covers every Stage 6 category and manifest example", () => {
  assert.doesNotThrow(() =>
    validateWorkerEvaluationSuite(
      GENERIC_RESEARCHER_EVALUATION_SUITE,
      MODEL_RESEARCHER_MANIFEST,
    ),
  );

  assert.equal(GENERIC_RESEARCHER_EVALUATION_SUITE.minimumScore, 100);
  assert.equal(GENERIC_RESEARCHER_EVALUATION_SUITE.requireAllRequired, true);
  assert.equal(GENERIC_RESEARCHER_EVALUATION_SUITE.cases.length, 11);
  assert.equal(
    GENERIC_RESEARCHER_EVALUATION_SUITE.cases.every((entry) => entry.required),
    true,
  );

  assert.deepEqual(
    new Set(GENERIC_RESEARCHER_EVALUATION_SUITE.cases.map((entry) => entry.category)),
    new Set([
      "schema",
      "role_boundary",
      "capability",
      "positive_example",
      "negative_example",
    ]),
  );

  const coveredPositive = new Set(
    GENERIC_RESEARCHER_EVALUATION_SUITE.cases.flatMap(
      (entry) => entry.coversPositiveExamples,
    ),
  );
  const coveredNegative = new Set(
    GENERIC_RESEARCHER_EVALUATION_SUITE.cases.flatMap(
      (entry) => entry.coversNegativeExamples,
    ),
  );

  for (const example of MODEL_RESEARCHER_MANIFEST.examples) {
    assert.equal(coveredPositive.has(example.name), true);
  }
  for (const example of MODEL_RESEARCHER_MANIFEST.negativeExamples) {
    assert.equal(coveredNegative.has(example.name), true);
  }
});

test("all required deterministic, mocked, primary and fallback cases can qualify", async () => {
  const calls = [];
  const summary = await runWorkerEvaluationSuite({
    adapter: fakeAdapter(calls),
    manifest: MODEL_RESEARCHER_MANIFEST,
    suite: GENERIC_RESEARCHER_EVALUATION_SUITE,
  });

  assert.equal(summary.status, "passed");
  assert.equal(summary.score, 100);
  assert.equal(summary.passedCaseCount, 11);
  assert.equal(summary.failedCaseCount, 0);
  assert.equal(summary.requiredFailureCount, 0);
  assert.equal(summary.results.every((result) => result.status === "passed"), true);

  assert.equal(calls.length, 6);
  assert.equal(calls.filter((entry) => entry.modelKey === "luna.standard").length, 3);
  assert.equal(calls.filter((entry) => entry.modelKey === "gemini.flash.large").length, 3);

  const deniedCapabilities = summary.results.filter((result) =>
    result.caseKey.startsWith("capability."),
  );
  assert.equal(deniedCapabilities.length, 2);
  assert.equal(
    deniedCapabilities.every(
      (result) =>
        result.observedOutcome === "fail" &&
        result.failureCategory === "contract_invalid" &&
        result.status === "passed",
    ),
    true,
  );
});

test("one failed required adversarial case blocks qualification", async () => {
  const calls = [];
  const summary = await runWorkerEvaluationSuite({
    adapter: fakeAdapter(calls, "negative.primary-strategy-injection"),
    manifest: MODEL_RESEARCHER_MANIFEST,
    suite: GENERIC_RESEARCHER_EVALUATION_SUITE,
  });

  assert.equal(summary.status, "failed");
  assert.equal(summary.passedCaseCount, 10);
  assert.equal(summary.failedCaseCount, 1);
  assert.equal(summary.requiredFailureCount, 1);
  assert.ok(summary.score < 100);

  const failed = summary.results.find(
    (result) => result.caseKey === "negative.primary-strategy-injection",
  );
  assert.equal(failed.status, "failed");
  assert.equal(failed.observedOutcome, "fail");
  assert.equal(failed.failureCategory, "validation_failed");
});
