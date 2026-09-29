import type { JsonObject, JsonValue, UUID } from "../core/contracts";

export const WORKER_FAILURE_CATEGORIES = [
  "contract_invalid",
  "context_invalid",
  "validation_failed",
  "worker_execution_failed",
] as const;

export type WorkerFailureCategory = (typeof WORKER_FAILURE_CATEGORIES)[number];

export type WorkerPackExample = {
  name: string;
  input: JsonObject;
  expectedOutput: JsonObject;
};

export type WorkerPackNegativeExample = {
  name: string;
  forbiddenBehaviour: string;
  reason: string;
};

export type WorkerPackManifest = {
  manifestVersion: "1.0";
  packKey: string;
  version: string;
  name: string;
  worker: {
    workerKey: string;
    version: string;
    role: string;
    charter: string;
  };
  inputSchema: JsonObject;
  outputSchema: JsonObject;
  capabilityPolicy: {
    allowed: string[];
    forbidden: string[];
  };
  knowledgeRequirements: string[];
  modelRequirements: JsonObject;
  instructions: string[];
  examples: WorkerPackExample[];
  negativeExamples: WorkerPackNegativeExample[];
  escalationPolicy: JsonObject;
};

export type WorkerTaskContractView = {
  id: UUID;
  objective: string;
  inputArtifactIds: UUID[];
  permittedCapabilities: string[];
  requiredKnowledge: string[];
  requiredOutputSchema: JsonObject;
  completionCriteria: JsonObject;
  failureCriteria: JsonObject;
  nonGoals: string[];
  escalationRules: JsonObject;
};

export type WorkerInputArtifact = {
  id: UUID;
  artifactType: string;
  name: string;
  mediaType: string;
  content: JsonObject;
  metadata: JsonObject;
};

export type WorkerInvocationContext = {
  taskContract: WorkerTaskContractView;
  inputArtifacts: WorkerInputArtifact[];
};

export type WorkerExecutionReceipt = JsonObject & {
  receiptVersion: "1.0";
  packKey: string;
  packVersion: string;
  workerKey: string;
  workerVersion: string;
  taskContractId: UUID;
  inputArtifactIds: UUID[];
  outputValidated: true;
  executionMode: string;
  stopReason: string;
};

export type WorkerExecutionSuccess = {
  output: JsonObject;
  receipt: WorkerExecutionReceipt;
};

export type WorkerExecutor = (context: WorkerInvocationContext) => JsonValue;

export class WorkerRuntimeError extends Error {
  readonly category: WorkerFailureCategory;
  readonly details: JsonObject;

  constructor(category: WorkerFailureCategory, message: string, details: JsonObject = {}) {
    super(message);
    this.name = "WorkerRuntimeError";
    this.category = category;
    this.details = details;
  }
}
