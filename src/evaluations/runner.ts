import type { JsonObject } from "../core/contracts";
import { OpenRouterAdapter } from "../models/openrouter";
import { buildWorkerModelMessages } from "../models/prompt";
import { resolveModelRoute } from "../models/registry";
import type {
  ModelDefinition,
  ModelProviderAdapter,
  ModelProviderResponse,
} from "../models/types";
import { ModelProviderError } from "../models/types";
import { executeGenericResearcherFixture } from "../workers/generic-researcher";
import {
  executeWorkerPack,
  validateWorkerInvocationContext,
  validateWorkerPackManifest,
} from "../workers/runtime";
import type { WorkerInvocationContext, WorkerPackManifest } from "../workers/types";
import { WorkerRuntimeError } from "../workers/types";
import type {
  RunWorkerEvaluationSuiteOptions,
  WorkerEvaluationCase,
  WorkerEvaluationCaseResult,
  WorkerEvaluationModelTelemetry,
  WorkerEvaluationRunSummary,
  WorkerEvaluationSuite,
} from "./types";
import {
  WORKER_EVALUATION_CATEGORIES,
  WORKER_EVALUATION_EXECUTION_MODES,
  WORKER_EVALUATION_MODEL_TARGETS,
} from "./types";

const CASE_KEY_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function unique(values: readonly string[]) {
  return new Set(values).size === values.length;
}

function failureCategory(error: unknown) {
  if (error instanceof WorkerRuntimeError || error instanceof ModelProviderError) {
    return error.category;
  }
  return "worker_execution_failed";
}

function failureDetails(error: unknown): JsonObject {
  if (error instanceof WorkerRuntimeError || error instanceof ModelProviderError) {
    return error.details;
  }
  return {};
}

function failureMessage(error: unknown) {
  return error instanceof Error ? error.message : "Evaluation case failed.";
}

function modelTelemetry(
  model: ModelDefinition,
  response: ModelProviderResponse,
): WorkerEvaluationModelTelemetry {
  return {
    modelKey: model.modelKey,
    provider: response.provider,
    providerModelId: response.providerModelId,
    providerRequestId: response.providerRequestId,
    providerFamily: model.providerFamily,
    latencyMs: response.latencyMs,
    usage: response.usage,
    metadata: response.metadata,
  };
}

function assertOutputExpectations(
  evaluationCase: WorkerEvaluationCase,
  output: JsonObject,
) {
  if (evaluationCase.expectedSignalIds?.length) {
    const findings = Array.isArray(output.findings) ? output.findings : [];
    const actualSignalIds = findings
      .map((finding) =>
        isRecord(finding) && typeof finding.signalId === "string"
          ? finding.signalId
          : null,
      )
      .filter((signalId): signalId is string => Boolean(signalId))
      .sort();
    const expectedSignalIds = [...evaluationCase.expectedSignalIds].sort();

    if (
      actualSignalIds.length !== expectedSignalIds.length ||
      actualSignalIds.some((signalId, index) => signalId !== expectedSignalIds[index])
    ) {
      throw new WorkerRuntimeError(
        "validation_failed",
        "Worker output did not represent exactly the expected bounded signals.",
        { actualSignalIds, expectedSignalIds },
      );
    }
  }

  const serialized = JSON.stringify(output);
  const forbiddenMarker = evaluationCase.forbiddenMarkers?.find((marker) =>
    serialized.includes(marker),
  );
  if (forbiddenMarker) {
    throw new WorkerRuntimeError(
      "validation_failed",
      "Worker output followed an instruction outside the Task Contract.",
      { forbiddenMarker },
    );
  }
}

export class MockCapabilityHarness {
  readonly attempted: string[] = [];
  readonly executed: string[] = [];

  constructor(private readonly manifest: WorkerPackManifest) {}

  invoke(capability: string) {
    this.attempted.push(capability);
    if (!this.manifest.capabilityPolicy.allowed.includes(capability)) {
      throw new WorkerRuntimeError(
        "contract_invalid",
        "Mocked capability invocation was denied by the Worker Pack policy.",
        { capability, attemptedCapabilities: [...this.attempted], executedCapabilities: [] },
      );
    }
    this.executed.push(capability);
    return { capability, executed: true };
  }
}

export function validateWorkerEvaluationSuite(
  suite: WorkerEvaluationSuite,
  manifest: WorkerPackManifest,
) {
  validateWorkerPackManifest(manifest);

  if (
    !CASE_KEY_PATTERN.test(suite.suiteKey) ||
    !VERSION_PATTERN.test(suite.version) ||
    !suite.name.trim() ||
    !suite.description.trim() ||
    suite.workerKey !== manifest.worker.workerKey ||
    suite.workerVersion !== manifest.worker.version ||
    !CASE_KEY_PATTERN.test(suite.modelRouteKey) ||
    !Number.isFinite(suite.minimumScore) ||
    suite.minimumScore < 0 ||
    suite.minimumScore > 100 ||
    suite.cases.length === 0
  ) {
    throw new Error("Worker evaluation suite identity or policy is invalid.");
  }

  const declaredRoute = manifest.modelRequirements.routeKey;
  if (declaredRoute !== suite.modelRouteKey) {
    throw new Error("Worker evaluation suite route does not match the Worker Pack.");
  }

  const caseKeys = suite.cases.map((evaluationCase) => evaluationCase.caseKey);
  if (!unique(caseKeys)) {
    throw new Error("Worker evaluation case keys must be unique.");
  }

  for (const evaluationCase of suite.cases) {
    if (
      !CASE_KEY_PATTERN.test(evaluationCase.caseKey) ||
      !evaluationCase.name.trim() ||
      !evaluationCase.description.trim() ||
      !WORKER_EVALUATION_CATEGORIES.includes(evaluationCase.category) ||
      !WORKER_EVALUATION_EXECUTION_MODES.includes(evaluationCase.executionMode) ||
      !WORKER_EVALUATION_MODEL_TARGETS.includes(evaluationCase.modelTarget) ||
      !Number.isFinite(evaluationCase.weight) ||
      evaluationCase.weight <= 0 ||
      !unique(evaluationCase.coversPositiveExamples) ||
      !unique(evaluationCase.coversNegativeExamples)
    ) {
      throw new Error(`Worker evaluation case ${evaluationCase.caseKey} is invalid.`);
    }

    if (
      evaluationCase.executionMode === "live_model" &&
      evaluationCase.modelTarget === "none"
    ) {
      throw new Error(`Live evaluation case ${evaluationCase.caseKey} needs a model target.`);
    }
    if (
      evaluationCase.executionMode !== "live_model" &&
      evaluationCase.modelTarget !== "none"
    ) {
      throw new Error(
        `Non-model evaluation case ${evaluationCase.caseKey} cannot select a model target.`,
      );
    }
    if (
      evaluationCase.expectedOutcome === "fail" &&
      !evaluationCase.expectedFailureCategory
    ) {
      throw new Error(
        `Negative evaluation case ${evaluationCase.caseKey} needs a failure category.`,
      );
    }
  }

  const categories = new Set(suite.cases.map((evaluationCase) => evaluationCase.category));
  const missingCategory = WORKER_EVALUATION_CATEGORIES.find(
    (category) => !categories.has(category),
  );
  if (missingCategory) {
    throw new Error(`Worker evaluation suite is missing ${missingCategory} coverage.`);
  }

  const positiveCoverage = new Set(
    suite.cases.flatMap((evaluationCase) => evaluationCase.coversPositiveExamples),
  );
  const uncoveredPositive = manifest.examples.find(
    (example) => !positiveCoverage.has(example.name),
  );
  if (uncoveredPositive) {
    throw new Error(
      `Worker positive example ${uncoveredPositive.name} is not covered by an evaluation.`,
    );
  }

  const negativeCoverage = new Set(
    suite.cases.flatMap((evaluationCase) => evaluationCase.coversNegativeExamples),
  );
  const uncoveredNegative = manifest.negativeExamples.find(
    (example) => !negativeCoverage.has(example.name),
  );
  if (uncoveredNegative) {
    throw new Error(
      `Worker negative example ${uncoveredNegative.name} is not covered by an evaluation.`,
    );
  }
}

async function runEvaluationCase(
  manifest: WorkerPackManifest,
  suite: WorkerEvaluationSuite,
  evaluationCase: WorkerEvaluationCase,
  adapter: ModelProviderAdapter,
): Promise<WorkerEvaluationCaseResult> {
  let output: JsonObject | null = null;
  let telemetry: WorkerEvaluationModelTelemetry | null = null;
  let observedOutcome: "pass" | "fail" = "pass";
  let observedFailureCategory: string | null = null;
  let observedFailureMessage: string | null = null;
  let evidence: JsonObject = {};

  try {
    if (evaluationCase.executionMode === "mock_capability") {
      if (!evaluationCase.capabilityProbe) {
        throw new Error("Mock capability case is missing its capability probe.");
      }
      const harness = new MockCapabilityHarness(manifest);
      try {
        harness.invoke(evaluationCase.capabilityProbe);
      } finally {
        evidence = {
          attemptedCapabilities: [...harness.attempted],
          executedCapabilities: [...harness.executed],
        };
      }
    } else if (evaluationCase.executionMode === "deterministic_output") {
      const execution = executeWorkerPack(
        manifest,
        (context) =>
          evaluationCase.fixtureOutput ?? executeGenericResearcherFixture(context),
        evaluationCase.context,
      );
      output = execution.output;
      assertOutputExpectations(evaluationCase, output);
      evidence = { receipt: execution.receipt };
    } else {
      validateWorkerInvocationContext(manifest, evaluationCase.context);
      const context = evaluationCase.context as WorkerInvocationContext;
      const route = resolveModelRoute(suite.modelRouteKey);
      const model =
        evaluationCase.modelTarget === "primary" ? route.primary : route.fallback;
      const response = await adapter.invokeStructured({
        model,
        schemaName: `agent_labs_stage6_${evaluationCase.caseKey.replace(/[^a-z0-9]+/gi, "_")}`,
        outputSchema: manifest.outputSchema,
        messages: buildWorkerModelMessages(manifest, context),
        requestMetadata: {
          evaluationSuite: suite.suiteKey,
          evaluationVersion: suite.version,
          evaluationCase: evaluationCase.caseKey,
          modelTarget: evaluationCase.modelTarget,
          workerKey: manifest.worker.workerKey,
          workerVersion: manifest.worker.version,
        },
      });
      telemetry = modelTelemetry(model, response);
      const execution = executeWorkerPack(
        manifest,
        () => response.output,
        context,
      );
      output = execution.output;
      assertOutputExpectations(evaluationCase, output);
      evidence = { receipt: execution.receipt };
    }
  } catch (error) {
    observedOutcome = "fail";
    observedFailureCategory = failureCategory(error);
    observedFailureMessage = failureMessage(error);
    evidence = {
      ...evidence,
      details: failureDetails(error),
    };
  }

  const outcomeMatches = observedOutcome === evaluationCase.expectedOutcome;
  const categoryMatches =
    evaluationCase.expectedOutcome === "pass" ||
    observedFailureCategory === evaluationCase.expectedFailureCategory;
  const passed = outcomeMatches && categoryMatches;

  return {
    caseKey: evaluationCase.caseKey,
    status: passed ? "passed" : "failed",
    scoreAwarded: passed ? evaluationCase.weight : 0,
    observedOutcome,
    failureCategory: observedFailureCategory,
    failureMessage: observedFailureMessage,
    output,
    evidence: {
      ...evidence,
      expectedOutcome: evaluationCase.expectedOutcome,
      expectedFailureCategory: evaluationCase.expectedFailureCategory ?? null,
      modelTarget: evaluationCase.modelTarget,
      outcomeMatches,
      categoryMatches,
    },
    modelTelemetry: telemetry,
  };
}

export function scoreWorkerEvaluationResults(
  suite: WorkerEvaluationSuite,
  results: readonly WorkerEvaluationCaseResult[],
): WorkerEvaluationRunSummary {
  const resultByKey = new Map(results.map((result) => [result.caseKey, result]));
  const totalWeight = suite.cases.reduce(
    (sum, evaluationCase) => sum + evaluationCase.weight,
    0,
  );
  const awardedWeight = suite.cases.reduce(
    (sum, evaluationCase) =>
      sum + (resultByKey.get(evaluationCase.caseKey)?.scoreAwarded ?? 0),
    0,
  );
  const score = totalWeight > 0 ? (awardedWeight / totalWeight) * 100 : 0;
  const passedCaseCount = suite.cases.filter(
    (evaluationCase) => resultByKey.get(evaluationCase.caseKey)?.status === "passed",
  ).length;
  const requiredCases = suite.cases.filter((evaluationCase) => evaluationCase.required);
  const requiredFailureCount = requiredCases.filter(
    (evaluationCase) => resultByKey.get(evaluationCase.caseKey)?.status !== "passed",
  ).length;
  const status =
    score >= suite.minimumScore &&
    (!suite.requireAllRequired || requiredFailureCount === 0)
      ? "passed"
      : "failed";

  return {
    suiteKey: suite.suiteKey,
    suiteVersion: suite.version,
    workerKey: suite.workerKey,
    workerVersion: suite.workerVersion,
    status,
    score,
    passedCaseCount,
    failedCaseCount: suite.cases.length - passedCaseCount,
    requiredCaseCount: requiredCases.length,
    requiredFailureCount,
    results: [...results],
  };
}

export async function runWorkerEvaluationSuite(
  options: RunWorkerEvaluationSuiteOptions,
): Promise<WorkerEvaluationRunSummary> {
  validateWorkerEvaluationSuite(options.suite, options.manifest);
  const adapter = options.adapter ?? new OpenRouterAdapter();
  const results: WorkerEvaluationCaseResult[] = [];

  for (const evaluationCase of options.suite.cases) {
    const result = await runEvaluationCase(
      options.manifest,
      options.suite,
      evaluationCase,
      adapter,
    );
    results.push(result);
    await options.onCaseFinished?.(evaluationCase, result);
  }

  return scoreWorkerEvaluationResults(options.suite, results);
}
