import type { JsonObject, JsonValue } from "../core/contracts";
import { JsonSchemaValidationError, assertJsonSchemaValue } from "./schema-validator";
import type {
  WorkerExecutionSuccess,
  WorkerExecutor,
  WorkerInvocationContext,
  WorkerPackManifest,
} from "./types";
import { WorkerRuntimeError } from "./types";

const IDENTIFIER_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const SEMANTIC_VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const FORBIDDEN_CONTEXT_KEYS = new Set([
  "chat",
  "chatHistory",
  "conversation",
  "conversationHistory",
  "credentials",
  "fullWorkflowHistory",
  "messages",
  "ownerEmail",
  "secrets",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function uniqueStrings(values: readonly string[]) {
  return new Set(values).size === values.length;
}

function jsonObject(value: unknown): value is JsonObject {
  return isRecord(value) && Object.values(value).every((entry) => isJsonValue(entry));
}

function isJsonValue(value: unknown, seen = new WeakSet<object>()): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return true;
  }

  if (typeof value !== "object" || seen.has(value)) {
    return false;
  }

  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((entry) => isJsonValue(entry, seen))
    : isRecord(value) &&
      Object.values(value).every(
        (entry) => entry !== undefined && isJsonValue(entry, seen),
      );
  seen.delete(value);
  return valid;
}

function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }

  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key] as JsonValue)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function findForbiddenContextKey(value: unknown, path = "$"): string | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const match = findForbiddenContextKey(value[index], `${path}[${index}]`);
      if (match) {
        return match;
      }
    }
    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.charAt(0).toLowerCase() + key.slice(1);
    if (FORBIDDEN_CONTEXT_KEYS.has(key) || FORBIDDEN_CONTEXT_KEYS.has(normalizedKey)) {
      return `${path}.${key}`;
    }
    const match = findForbiddenContextKey(child, `${path}.${key}`);
    if (match) {
      return match;
    }
  }

  return null;
}

function runtimeError(message: string, details: JsonObject = {}) {
  return new WorkerRuntimeError("contract_invalid", message, details);
}

export function validateWorkerPackManifest(manifest: WorkerPackManifest) {
  if (!isRecord(manifest)) {
    throw runtimeError("Worker Pack manifest must be an object.");
  }

  const expectedKeys = [
    "manifestVersion",
    "packKey",
    "version",
    "name",
    "worker",
    "inputSchema",
    "outputSchema",
    "capabilityPolicy",
    "knowledgeRequirements",
    "modelRequirements",
    "instructions",
    "examples",
    "negativeExamples",
    "escalationPolicy",
  ] as const;

  if (!exactKeys(manifest, expectedKeys)) {
    throw runtimeError("Worker Pack manifest contains missing or unknown fields.");
  }

  if (
    manifest.manifestVersion !== "1.0" ||
    !IDENTIFIER_PATTERN.test(manifest.packKey) ||
    !SEMANTIC_VERSION_PATTERN.test(manifest.version) ||
    !manifest.name.trim()
  ) {
    throw runtimeError("Worker Pack manifest identity is invalid.");
  }

  if (
    !isRecord(manifest.worker) ||
    !exactKeys(manifest.worker, ["workerKey", "version", "role", "charter"]) ||
    !IDENTIFIER_PATTERN.test(manifest.worker.workerKey) ||
    !SEMANTIC_VERSION_PATTERN.test(manifest.worker.version) ||
    !manifest.worker.role.trim() ||
    !manifest.worker.charter.trim()
  ) {
    throw runtimeError("Worker Pack worker definition is invalid.");
  }

  if (
    !jsonObject(manifest.inputSchema) ||
    manifest.inputSchema.type !== "object" ||
    !jsonObject(manifest.outputSchema) ||
    manifest.outputSchema.type !== "object"
  ) {
    throw runtimeError("Worker Pack schemas must be object JSON Schemas.");
  }

  if (
    !isRecord(manifest.capabilityPolicy) ||
    !stringArray(manifest.capabilityPolicy.allowed) ||
    !stringArray(manifest.capabilityPolicy.forbidden) ||
    !uniqueStrings(manifest.capabilityPolicy.allowed) ||
    !uniqueStrings(manifest.capabilityPolicy.forbidden)
  ) {
    throw runtimeError("Worker Pack capability policy is invalid.");
  }

  const forbiddenOverlap = manifest.capabilityPolicy.allowed.find((capability) =>
    manifest.capabilityPolicy.forbidden.includes(capability),
  );
  if (forbiddenOverlap) {
    throw runtimeError("A capability cannot be both allowed and forbidden.", {
      capability: forbiddenOverlap,
    });
  }

  if (
    !stringArray(manifest.knowledgeRequirements) ||
    !uniqueStrings(manifest.knowledgeRequirements) ||
    !jsonObject(manifest.modelRequirements) ||
    !stringArray(manifest.instructions) ||
    manifest.instructions.length === 0 ||
    !uniqueStrings(manifest.instructions) ||
    !Array.isArray(manifest.examples) ||
    !Array.isArray(manifest.negativeExamples) ||
    !jsonObject(manifest.escalationPolicy)
  ) {
    throw runtimeError("Worker Pack requirements or training fixtures are invalid.");
  }

  for (const example of manifest.examples) {
    if (
      !isRecord(example) ||
      !exactKeys(example, ["name", "input", "expectedOutput"]) ||
      typeof example.name !== "string" ||
      !example.name.trim() ||
      !jsonObject(example.input) ||
      !jsonObject(example.expectedOutput)
    ) {
      throw runtimeError("A Worker Pack positive example is invalid.");
    }
  }

  for (const example of manifest.negativeExamples) {
    if (
      !isRecord(example) ||
      !exactKeys(example, ["name", "forbiddenBehaviour", "reason"]) ||
      typeof example.name !== "string" ||
      !example.name.trim() ||
      typeof example.forbiddenBehaviour !== "string" ||
      !example.forbiddenBehaviour.trim() ||
      typeof example.reason !== "string" ||
      !example.reason.trim()
    ) {
      throw runtimeError("A Worker Pack negative example is invalid.");
    }
  }
}

function validateContextShape(context: unknown): asserts context is WorkerInvocationContext {
  if (!isRecord(context) || !exactKeys(context, ["taskContract", "inputArtifacts"])) {
    throw new WorkerRuntimeError(
      "context_invalid",
      "Worker context must contain only taskContract and inputArtifacts.",
    );
  }

  const task = context.taskContract;
  const artifacts = context.inputArtifacts;
  const taskKeys = [
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
  ] as const;

  if (
    !isRecord(task) ||
    !exactKeys(task, taskKeys) ||
    typeof task.id !== "string" ||
    !UUID_PATTERN.test(task.id) ||
    typeof task.objective !== "string" ||
    !task.objective.trim() ||
    !stringArray(task.inputArtifactIds) ||
    !task.inputArtifactIds.every((id) => UUID_PATTERN.test(id)) ||
    !stringArray(task.permittedCapabilities) ||
    !stringArray(task.requiredKnowledge) ||
    !jsonObject(task.requiredOutputSchema) ||
    !jsonObject(task.completionCriteria) ||
    !jsonObject(task.failureCriteria) ||
    !stringArray(task.nonGoals) ||
    !jsonObject(task.escalationRules)
  ) {
    throw new WorkerRuntimeError("context_invalid", "Task Contract context is invalid.");
  }

  if (
    !uniqueStrings(task.inputArtifactIds) ||
    !uniqueStrings(task.permittedCapabilities) ||
    !uniqueStrings(task.requiredKnowledge) ||
    !uniqueStrings(task.nonGoals)
  ) {
    throw new WorkerRuntimeError(
      "context_invalid",
      "Task Contract lists must not contain duplicates.",
    );
  }

  if (!Array.isArray(artifacts)) {
    throw new WorkerRuntimeError("context_invalid", "Input artifacts must be an array.");
  }

  const artifactKeys = ["id", "artifactType", "name", "mediaType", "content", "metadata"];
  for (const artifact of artifacts) {
    if (
      !isRecord(artifact) ||
      !exactKeys(artifact, artifactKeys) ||
      typeof artifact.id !== "string" ||
      !UUID_PATTERN.test(artifact.id) ||
      typeof artifact.artifactType !== "string" ||
      !artifact.artifactType.trim() ||
      typeof artifact.name !== "string" ||
      !artifact.name.trim() ||
      typeof artifact.mediaType !== "string" ||
      !artifact.mediaType.trim() ||
      !jsonObject(artifact.content) ||
      !jsonObject(artifact.metadata)
    ) {
      throw new WorkerRuntimeError("context_invalid", "An input artifact is invalid.");
    }
  }
}

export function validateWorkerInvocationContext(
  manifest: WorkerPackManifest,
  context: unknown,
): asserts context is WorkerInvocationContext {
  validateWorkerPackManifest(manifest);
  validateContextShape(context);

  const forbiddenPath = findForbiddenContextKey(context);
  if (forbiddenPath) {
    throw new WorkerRuntimeError(
      "context_invalid",
      "Worker context contains an unrestricted conversation or secret field.",
      { path: forbiddenPath },
    );
  }

  const taskArtifactIds = [...context.taskContract.inputArtifactIds].sort();
  const suppliedArtifactIds = context.inputArtifacts.map((artifact) => artifact.id).sort();
  if (
    taskArtifactIds.length !== suppliedArtifactIds.length ||
    taskArtifactIds.some((id, index) => id !== suppliedArtifactIds[index])
  ) {
    throw new WorkerRuntimeError(
      "context_invalid",
      "Worker context must contain exactly the artifacts referenced by the Task Contract.",
    );
  }

  if (!uniqueStrings(suppliedArtifactIds)) {
    throw new WorkerRuntimeError(
      "context_invalid",
      "Worker context contains duplicate input artifacts.",
    );
  }

  const unsupportedCapability = context.taskContract.permittedCapabilities.find(
    (capability) => !manifest.capabilityPolicy.allowed.includes(capability),
  );
  if (unsupportedCapability) {
    throw new WorkerRuntimeError(
      "contract_invalid",
      "Task Contract requests a capability outside the Worker Pack policy.",
      { capability: unsupportedCapability },
    );
  }

  const unsupportedKnowledge = context.taskContract.requiredKnowledge.find(
    (requirement) => !manifest.knowledgeRequirements.includes(requirement),
  );
  if (unsupportedKnowledge) {
    throw new WorkerRuntimeError(
      "contract_invalid",
      "Task Contract requests knowledge outside the Worker Pack declaration.",
      { requirement: unsupportedKnowledge },
    );
  }

  const missingKnowledge = context.taskContract.requiredKnowledge.find(
    (requirement) =>
      !context.inputArtifacts.some(
        (artifact) => artifact.metadata.knowledgeKey === requirement,
      ),
  );
  if (missingKnowledge) {
    throw new WorkerRuntimeError(
      "context_invalid",
      "Required knowledge is not represented by a referenced input artifact.",
      { requirement: missingKnowledge },
    );
  }

  if (
    canonicalJson(context.taskContract.requiredOutputSchema) !==
    canonicalJson(manifest.outputSchema)
  ) {
    throw new WorkerRuntimeError(
      "contract_invalid",
      "Task Contract output schema does not match the pinned Worker Pack version.",
    );
  }

  try {
    assertJsonSchemaValue(manifest.inputSchema, context, "Worker input context");
  } catch (error) {
    if (error instanceof JsonSchemaValidationError) {
      throw new WorkerRuntimeError("context_invalid", error.message, {
        issues: error.issues.map((issue) => ({
          path: issue.path,
          message: issue.message,
        })),
      });
    }
    throw error;
  }
}

function validateCompletionCriteria(context: WorkerInvocationContext, output: JsonObject) {
  const criteria = context.taskContract.completionCriteria;
  const requiredDecision = criteria.requiredDecision;
  const requiredStopReason = criteria.requiredStopReason;
  const minimumEvidenceCount = criteria.minimumEvidenceCount;

  if (typeof requiredDecision === "string" && output.decision !== requiredDecision) {
    throw new WorkerRuntimeError(
      "validation_failed",
      "Worker output did not satisfy the required completion decision.",
    );
  }

  if (typeof requiredStopReason === "string" && output.stopReason !== requiredStopReason) {
    throw new WorkerRuntimeError(
      "validation_failed",
      "Worker output did not stop for the required completion reason.",
    );
  }

  if (
    typeof minimumEvidenceCount === "number" &&
    (typeof output.evidenceCount !== "number" ||
      output.evidenceCount < minimumEvidenceCount)
  ) {
    throw new WorkerRuntimeError(
      "validation_failed",
      "Worker output did not satisfy the minimum evidence count.",
    );
  }
}

export function executeWorkerPack(
  manifest: WorkerPackManifest,
  executor: WorkerExecutor,
  context: unknown,
): WorkerExecutionSuccess {
  validateWorkerInvocationContext(manifest, context);

  let rawOutput: JsonValue;
  try {
    rawOutput = executor(context);
  } catch (error) {
    if (error instanceof WorkerRuntimeError) {
      throw error;
    }

    throw new WorkerRuntimeError(
      "worker_execution_failed",
      error instanceof Error ? error.message : "Worker execution failed.",
    );
  }

  try {
    assertJsonSchemaValue(manifest.outputSchema, rawOutput, "Worker output");
  } catch (error) {
    if (error instanceof JsonSchemaValidationError) {
      throw new WorkerRuntimeError("validation_failed", error.message, {
        issues: error.issues.map((issue) => ({
          path: issue.path,
          message: issue.message,
        })),
      });
    }
    throw error;
  }

  if (!jsonObject(rawOutput)) {
    throw new WorkerRuntimeError(
      "validation_failed",
      "Worker output must be a JSON object.",
    );
  }

  const permittedArtifactIds = new Set(context.taskContract.inputArtifactIds);
  const usedArtifactIds = rawOutput.usedArtifactIds;
  if (
    Array.isArray(usedArtifactIds) &&
    usedArtifactIds.some(
      (artifactId) =>
        typeof artifactId !== "string" || !permittedArtifactIds.has(artifactId),
    )
  ) {
    throw new WorkerRuntimeError(
      "validation_failed",
      "Worker output cites an artifact outside the Task Contract.",
    );
  }

  const findings = rawOutput.findings;
  if (
    Array.isArray(findings) &&
    findings.some(
      (finding) =>
        !isRecord(finding) ||
        typeof finding.evidenceArtifactId !== "string" ||
        !permittedArtifactIds.has(finding.evidenceArtifactId),
    )
  ) {
    throw new WorkerRuntimeError(
      "validation_failed",
      "Worker findings cite evidence outside the Task Contract.",
    );
  }

  validateCompletionCriteria(context, rawOutput);

  const executionMode = manifest.modelRequirements.executionMode;
  const stopReason = rawOutput.stopReason;
  if (typeof executionMode !== "string" || typeof stopReason !== "string") {
    throw new WorkerRuntimeError(
      "contract_invalid",
      "Worker Pack execution mode or output stop reason is missing.",
    );
  }

  return {
    output: rawOutput,
    receipt: {
      receiptVersion: "1.0",
      packKey: manifest.packKey,
      packVersion: manifest.version,
      workerKey: manifest.worker.workerKey,
      workerVersion: manifest.worker.version,
      taskContractId: context.taskContract.id,
      inputArtifactIds: [...context.taskContract.inputArtifactIds],
      outputValidated: true,
      executionMode,
      stopReason,
    },
  };
}
