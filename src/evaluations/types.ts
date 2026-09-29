import type { JsonObject, JsonValue } from "../core/contracts";
import type {
  ModelProviderAdapter,
  ModelRouteKey,
  ModelUsage,
} from "../models/types";
import type {
  WorkerFailureCategory,
  WorkerInvocationContext,
  WorkerPackManifest,
} from "../workers/types";

export const WORKER_PROMOTION_STATES = [
  "experimental",
  "qualified",
  "assisted",
  "autonomous",
] as const;

export type WorkerPromotionState = (typeof WORKER_PROMOTION_STATES)[number];

export const WORKER_EVALUATION_CATEGORIES = [
  "schema",
  "role_boundary",
  "capability",
  "positive_example",
  "negative_example",
] as const;

export type WorkerEvaluationCategory =
  (typeof WORKER_EVALUATION_CATEGORIES)[number];

export const WORKER_EVALUATION_EXECUTION_MODES = [
  "deterministic_output",
  "live_model",
  "mock_capability",
] as const;

export type WorkerEvaluationExecutionMode =
  (typeof WORKER_EVALUATION_EXECUTION_MODES)[number];

export const WORKER_EVALUATION_MODEL_TARGETS = [
  "none",
  "primary",
  "fallback",
] as const;

export type WorkerEvaluationModelTarget =
  (typeof WORKER_EVALUATION_MODEL_TARGETS)[number];

export type WorkerEvaluationExpectedOutcome = "pass" | "fail";

export type WorkerEvaluationCase = {
  caseKey: string;
  name: string;
  description: string;
  category: WorkerEvaluationCategory;
  executionMode: WorkerEvaluationExecutionMode;
  modelTarget: WorkerEvaluationModelTarget;
  required: boolean;
  weight: number;
  context: unknown;
  fixtureOutput?: JsonValue;
  capabilityProbe?: string;
  expectedOutcome: WorkerEvaluationExpectedOutcome;
  expectedFailureCategory?: WorkerFailureCategory;
  expectedSignalIds?: string[];
  forbiddenMarkers?: string[];
  coversPositiveExamples: string[];
  coversNegativeExamples: string[];
};

export type WorkerEvaluationSuite = {
  suiteKey: string;
  version: string;
  name: string;
  description: string;
  workerKey: string;
  workerVersion: string;
  modelRouteKey: ModelRouteKey;
  minimumScore: number;
  requireAllRequired: boolean;
  cases: WorkerEvaluationCase[];
};

export type WorkerEvaluationModelTelemetry = {
  modelKey: string;
  provider: string;
  providerModelId: string;
  providerRequestId: string | null;
  providerFamily: string;
  latencyMs: number;
  usage: ModelUsage;
  metadata: JsonObject;
};

export type WorkerEvaluationCaseResult = {
  caseKey: string;
  status: "passed" | "failed" | "error";
  scoreAwarded: number;
  observedOutcome: WorkerEvaluationExpectedOutcome;
  failureCategory: string | null;
  failureMessage: string | null;
  output: JsonObject | null;
  evidence: JsonObject;
  modelTelemetry: WorkerEvaluationModelTelemetry | null;
};

export type WorkerEvaluationRunSummary = {
  suiteKey: string;
  suiteVersion: string;
  workerKey: string;
  workerVersion: string;
  status: "passed" | "failed";
  score: number;
  passedCaseCount: number;
  failedCaseCount: number;
  requiredCaseCount: number;
  requiredFailureCount: number;
  results: WorkerEvaluationCaseResult[];
};

export type WorkerEvaluationCaseFinished = (
  evaluationCase: WorkerEvaluationCase,
  result: WorkerEvaluationCaseResult,
) => void | Promise<void>;

export type RunWorkerEvaluationSuiteOptions = {
  manifest: WorkerPackManifest;
  suite: WorkerEvaluationSuite;
  adapter?: ModelProviderAdapter;
  onCaseFinished?: WorkerEvaluationCaseFinished;
};

export type WorkerEvaluationContextFactory = () => WorkerInvocationContext;
