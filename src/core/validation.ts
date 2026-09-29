import {
  ACTION_CREATOR_TYPES,
  ACTION_INTENT_STATUSES,
  ACTION_RECEIPT_OUTCOMES,
  EVENT_ACTOR_TYPES,
  EXTERNAL_RESOURCE_STATUSES,
  GOAL_STATUSES,
  OWNER_INTERVENTION_STATUSES,
  PACK_KINDS,
  QUALIFICATION_STATUSES,
  TASK_CONTRACT_STATUSES,
  WORKER_RUN_STATUSES,
  WORKFLOW_RUN_STATUSES,
  WORKFLOW_STAGE_RUN_STATUSES,
  type ContractFor,
  type CoreContractKind,
  type JsonValue,
} from "./contracts";

export type CoreValidationIssue = {
  field: string;
  message: string;
};

export class CoreContractValidationError extends Error {
  readonly kind: CoreContractKind;
  readonly issues: readonly CoreValidationIssue[];

  constructor(kind: CoreContractKind, issues: CoreValidationIssue[]) {
    super(`Invalid ${kind} contract: ${issues.map((issue) => `${issue.field} ${issue.message}`).join(", ")}`);
    this.name = "CoreContractValidationError";
    this.kind = kind;
    this.issues = issues;
  }
}

type StringRule = {
  type: "string" | "nullableString";
  min?: number;
  max?: number;
  pattern?: RegExp;
};

type FieldRule =
  | { type: "uuid" | "nullableUuid" }
  | { type: "timestamp" | "nullableTimestamp" }
  | { type: "integer"; min?: number }
  | { type: "jsonObject" | "jsonArray" | "stringArray" | "uuidArray" }
  | { type: "enum"; values: readonly string[] }
  | StringRule;

type ContractSpec = {
  fields: Record<string, FieldRule>;
};

const uuid = (): FieldRule => ({ type: "uuid" });
const nullableUuid = (): FieldRule => ({ type: "nullableUuid" });
const timestamp = (): FieldRule => ({ type: "timestamp" });
const nullableTimestamp = (): FieldRule => ({ type: "nullableTimestamp" });
const string = (min = 0, max = Number.MAX_SAFE_INTEGER, pattern?: RegExp): FieldRule => ({
  type: "string",
  min,
  max,
  pattern,
});
const nullableString = (
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  pattern?: RegExp,
): FieldRule => ({ type: "nullableString", min, max, pattern });
const enumeration = (values: readonly string[]): FieldRule => ({ type: "enum", values });
const integer = (min = Number.MIN_SAFE_INTEGER): FieldRule => ({ type: "integer", min });

const identifierPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const semanticVersionPattern = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const baseFields = {
  id: uuid(),
  createdAt: timestamp(),
};

const mutableFields = {
  ...baseFields,
  updatedAt: timestamp(),
};

const businessFields = {
  businessId: uuid(),
};

const contractSpecs = {
  pack: {
    fields: {
      ...mutableFields,
      packKey: string(1, 200, identifierPattern),
      version: string(1, 100, semanticVersionPattern),
      name: string(1, 160),
      kind: enumeration(PACK_KINDS),
      status: enumeration(QUALIFICATION_STATUSES),
      manifest: { type: "jsonObject" },
    },
  },
  workflowDefinition: {
    fields: {
      ...mutableFields,
      packId: uuid(),
      workflowKey: string(1, 200, identifierPattern),
      version: string(1, 100, semanticVersionPattern),
      name: string(1, 160),
      description: nullableString(),
      status: enumeration(QUALIFICATION_STATUSES),
      inputSchema: { type: "jsonObject" },
      outputSchema: { type: "jsonObject" },
      stageDefinition: { type: "jsonObject" },
    },
  },
  workerDefinition: {
    fields: {
      ...mutableFields,
      packId: uuid(),
      workerKey: string(1, 200, identifierPattern),
      version: string(1, 100, semanticVersionPattern),
      name: string(1, 160),
      role: string(1, 160),
      charter: string(1),
      status: enumeration(QUALIFICATION_STATUSES),
      inputSchema: { type: "jsonObject" },
      outputSchema: { type: "jsonObject" },
      knowledgeRequirements: { type: "jsonArray" },
      capabilityRequirements: { type: "jsonArray" },
      modelRequirements: { type: "jsonObject" },
    },
  },
  goal: {
    fields: {
      ...mutableFields,
      ...businessFields,
      title: string(1, 200),
      description: nullableString(),
      status: enumeration(GOAL_STATUSES),
      target: { type: "jsonObject" },
      successCriteria: { type: "jsonObject" },
    },
  },
  workflowRun: {
    fields: {
      ...mutableFields,
      ...businessFields,
      goalId: nullableUuid(),
      workflowDefinitionId: uuid(),
      status: enumeration(WORKFLOW_RUN_STATUSES),
      currentStageKey: nullableString(1, 160),
      idempotencyKey: string(1, 200),
      input: { type: "jsonObject" },
      state: { type: "jsonObject" },
      startedAt: nullableTimestamp(),
      completedAt: nullableTimestamp(),
    },
  },
  workflowStageRun: {
    fields: {
      ...mutableFields,
      ...businessFields,
      workflowRunId: uuid(),
      stageKey: string(1, 160),
      sequence: integer(0),
      attempt: integer(1),
      status: enumeration(WORKFLOW_STAGE_RUN_STATUSES),
      input: { type: "jsonObject" },
      output: { type: "jsonObject" },
      failure: { type: "jsonObject" },
      startedAt: nullableTimestamp(),
      completedAt: nullableTimestamp(),
    },
  },
  taskContract: {
    fields: {
      ...mutableFields,
      ...businessFields,
      workflowRunId: uuid(),
      workflowStageRunId: nullableUuid(),
      workerDefinitionId: uuid(),
      status: enumeration(TASK_CONTRACT_STATUSES),
      objective: string(1, 4000),
      inputArtifactIds: { type: "uuidArray" },
      permittedCapabilities: { type: "stringArray" },
      requiredKnowledge: { type: "stringArray" },
      requiredOutputSchema: { type: "jsonObject" },
      completionCriteria: { type: "jsonObject" },
      failureCriteria: { type: "jsonObject" },
      nonGoals: { type: "stringArray" },
      escalationRules: { type: "jsonObject" },
    },
  },
  workerRun: {
    fields: {
      ...mutableFields,
      ...businessFields,
      workflowRunId: uuid(),
      taskContractId: uuid(),
      workerDefinitionId: uuid(),
      status: enumeration(WORKER_RUN_STATUSES),
      input: { type: "jsonObject" },
      output: { type: "jsonObject" },
      failure: { type: "jsonObject" },
      executionMetadata: { type: "jsonObject" },
      startedAt: nullableTimestamp(),
      completedAt: nullableTimestamp(),
    },
  },
  artifact: {
    fields: {
      ...mutableFields,
      ...businessFields,
      workflowRunId: nullableUuid(),
      taskContractId: nullableUuid(),
      artifactType: string(1, 160),
      name: string(1, 240),
      mediaType: string(1, 160),
      storagePath: nullableString(),
      content: { type: "jsonObject" },
      checksum: nullableString(),
      metadata: { type: "jsonObject" },
    },
  },
  evidence: {
    fields: {
      ...baseFields,
      ...businessFields,
      workflowRunId: nullableUuid(),
      artifactId: nullableUuid(),
      sourceType: string(1, 160),
      sourceUri: nullableString(),
      title: nullableString(),
      excerpt: nullableString(),
      observedAt: timestamp(),
      freshness: { type: "jsonObject" },
      metadata: { type: "jsonObject" },
    },
  },
  event: {
    fields: {
      ...baseFields,
      ...businessFields,
      workflowRunId: nullableUuid(),
      eventType: string(1, 200),
      actorType: enumeration(EVENT_ACTOR_TYPES),
      actorId: nullableString(),
      payload: { type: "jsonObject" },
      occurredAt: timestamp(),
    },
  },
  externalResource: {
    fields: {
      ...mutableFields,
      ...businessFields,
      provider: string(1, 120),
      resourceType: string(1, 160),
      externalId: string(1, 300),
      status: enumeration(EXTERNAL_RESOURCE_STATUSES),
      canonicalUrl: nullableString(),
      metadata: { type: "jsonObject" },
    },
  },
  actionIntent: {
    fields: {
      ...mutableFields,
      ...businessFields,
      workflowRunId: nullableUuid(),
      taskContractId: nullableUuid(),
      actionType: string(1, 200),
      capability: string(1, 200),
      status: enumeration(ACTION_INTENT_STATUSES),
      request: { type: "jsonObject" },
      risk: { type: "jsonObject" },
      financialImpact: { type: "jsonObject" },
      idempotencyKey: string(1, 200),
      createdByType: enumeration(ACTION_CREATOR_TYPES),
      createdById: nullableString(),
    },
  },
  actionReceipt: {
    fields: {
      ...baseFields,
      ...businessFields,
      actionIntentId: uuid(),
      externalResourceId: nullableUuid(),
      attempt: integer(1),
      outcome: enumeration(ACTION_RECEIPT_OUTCOMES),
      provider: string(1, 120),
      requestFingerprint: string(1, 256),
      responseSummary: { type: "jsonObject" },
      occurredAt: timestamp(),
    },
  },
  ownerIntervention: {
    fields: {
      ...mutableFields,
      ...businessFields,
      workflowRunId: nullableUuid(),
      actionIntentId: nullableUuid(),
      interventionType: string(1, 160),
      status: enumeration(OWNER_INTERVENTION_STATUSES),
      title: string(1, 240),
      description: string(1, 4000),
      options: { type: "jsonArray" },
      resolution: { type: "jsonObject" },
      requestedAt: timestamp(),
      resolvedAt: nullableTimestamp(),
    },
  },
} satisfies Record<CoreContractKind, ContractSpec>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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

  if (typeof value !== "object") {
    return false;
  }

  if (seen.has(value)) {
    return false;
  }
  seen.add(value);

  let valid: boolean;
  if (Array.isArray(value)) {
    valid = value.every((item) => isJsonValue(item, seen));
  } else if (isPlainObject(value)) {
    valid = Object.values(value).every(
      (item) => item !== undefined && isJsonValue(item, seen),
    );
  } else {
    valid = false;
  }

  seen.delete(value);
  return valid;
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.includes("T") &&
    value.trim() === value &&
    !Number.isNaN(Date.parse(value))
  );
}

function validateField(field: string, value: unknown, rule: FieldRule): CoreValidationIssue | null {
  switch (rule.type) {
    case "uuid":
      return typeof value === "string" && uuidPattern.test(value)
        ? null
        : { field, message: "must be a UUID" };
    case "nullableUuid":
      return value === null || (typeof value === "string" && uuidPattern.test(value))
        ? null
        : { field, message: "must be a UUID or null" };
    case "timestamp":
      return isTimestamp(value) ? null : { field, message: "must be an ISO timestamp" };
    case "nullableTimestamp":
      return value === null || isTimestamp(value)
        ? null
        : { field, message: "must be an ISO timestamp or null" };
    case "integer":
      return Number.isInteger(value) && Number(value) >= (rule.min ?? Number.MIN_SAFE_INTEGER)
        ? null
        : { field, message: `must be an integer greater than or equal to ${rule.min}` };
    case "jsonObject":
      return isPlainObject(value) && isJsonValue(value)
        ? null
        : { field, message: "must be a JSON object" };
    case "jsonArray":
      return Array.isArray(value) && isJsonValue(value)
        ? null
        : { field, message: "must be a JSON array" };
    case "stringArray":
      return Array.isArray(value) && value.every((item) => typeof item === "string")
        ? null
        : { field, message: "must be an array of strings" };
    case "uuidArray":
      return Array.isArray(value) &&
        value.every((item) => typeof item === "string" && uuidPattern.test(item))
        ? null
        : { field, message: "must be an array of UUIDs" };
    case "enum":
      return typeof value === "string" && rule.values.includes(value)
        ? null
        : { field, message: `must be one of ${rule.values.join(", ")}` };
    case "string":
    case "nullableString": {
      if (rule.type === "nullableString" && value === null) {
        return null;
      }
      if (typeof value !== "string") {
        return { field, message: rule.type === "nullableString" ? "must be a string or null" : "must be a string" };
      }
      if (value.length < (rule.min ?? 0) || value.length > (rule.max ?? Number.MAX_SAFE_INTEGER)) {
        return {
          field,
          message: `must contain between ${rule.min ?? 0} and ${rule.max ?? "unlimited"} characters`,
        };
      }
      if (rule.pattern && !rule.pattern.test(value)) {
        return { field, message: "has an invalid format" };
      }
      return null;
    }
  }
}

export function validateCoreContract<K extends CoreContractKind>(
  kind: K,
  value: unknown,
): ContractFor<K> {
  if (!isPlainObject(value)) {
    throw new CoreContractValidationError(kind, [
      { field: "$", message: "must be an object" },
    ]);
  }

  const spec = contractSpecs[kind];
  const allowedFields = new Set(Object.keys(spec.fields));
  const issues: CoreValidationIssue[] = [];

  for (const field of Object.keys(value)) {
    if (!allowedFields.has(field)) {
      issues.push({ field, message: "is not part of the universal Core contract" });
    }
  }

  for (const [field, rule] of Object.entries(spec.fields)) {
    if (!(field in value)) {
      issues.push({ field, message: "is required" });
      continue;
    }

    const issue = validateField(field, value[field], rule);
    if (issue) {
      issues.push(issue);
    }
  }

  if (kind === "artifact" || kind === "actionIntent") {
    const taskContractId = value.taskContractId;
    const workflowRunId = value.workflowRunId;
    if (taskContractId !== null && workflowRunId === null) {
      issues.push({
        field: "workflowRunId",
        message: "is required when taskContractId is present",
      });
    }
  }

  if (issues.length > 0) {
    throw new CoreContractValidationError(kind, issues);
  }

  return value as unknown as ContractFor<K>;
}
