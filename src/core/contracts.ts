export type UUID = string;
export type ISODateTime = string;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export const CORE_CONTRACT_KINDS = [
  "pack",
  "workflowDefinition",
  "workerDefinition",
  "goal",
  "workflowRun",
  "workflowStageRun",
  "taskContract",
  "workerRun",
  "artifact",
  "evidence",
  "event",
  "externalResource",
  "actionIntent",
  "actionReceipt",
  "ownerIntervention",
] as const;

export type CoreContractKind = (typeof CORE_CONTRACT_KINDS)[number];

export const DEFINITION_CONTRACT_KINDS = [
  "pack",
  "workflowDefinition",
  "workerDefinition",
] as const;

export type DefinitionContractKind = (typeof DEFINITION_CONTRACT_KINDS)[number];

export const APPEND_ONLY_CONTRACT_KINDS = [
  "evidence",
  "event",
  "actionReceipt",
] as const;

export type AppendOnlyContractKind = (typeof APPEND_ONLY_CONTRACT_KINDS)[number];
export type BusinessContractKind = Exclude<CoreContractKind, DefinitionContractKind>;
export type MutableContractKind = Exclude<CoreContractKind, AppendOnlyContractKind>;

export const CORE_TABLES = {
  pack: "packs",
  workflowDefinition: "workflow_definitions",
  workerDefinition: "worker_definitions",
  goal: "goals",
  workflowRun: "workflow_runs",
  workflowStageRun: "workflow_stage_runs",
  taskContract: "task_contracts",
  workerRun: "worker_runs",
  artifact: "artifacts",
  evidence: "evidence",
  event: "events",
  externalResource: "external_resources",
  actionIntent: "action_intents",
  actionReceipt: "action_receipts",
  ownerIntervention: "owner_interventions",
} as const satisfies Record<CoreContractKind, string>;

export const QUALIFICATION_STATUSES = [
  "experimental",
  "qualified",
  "assisted",
  "autonomous",
  "retired",
] as const;
export type QualificationStatus = (typeof QUALIFICATION_STATUSES)[number];

export const PACK_KINDS = ["core", "capability", "knowledge", "worker", "workflow"] as const;
export type PackKind = (typeof PACK_KINDS)[number];

export const GOAL_STATUSES = ["draft", "active", "achieved", "cancelled"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const WORKFLOW_RUN_STATUSES = [
  "queued",
  "running",
  "waiting",
  "review",
  "needs_owner",
  "completed",
  "failed",
  "cancelled",
] as const;
export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number];

export const WORKFLOW_STAGE_RUN_STATUSES = [
  "pending",
  "running",
  "waiting",
  "review",
  "completed",
  "failed",
  "skipped",
] as const;
export type WorkflowStageRunStatus = (typeof WORKFLOW_STAGE_RUN_STATUSES)[number];

export const TASK_CONTRACT_STATUSES = [
  "draft",
  "ready",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;
export type TaskContractStatus = (typeof TASK_CONTRACT_STATUSES)[number];

export const WORKER_RUN_STATUSES = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;
export type WorkerRunStatus = (typeof WORKER_RUN_STATUSES)[number];

export const EVENT_ACTOR_TYPES = ["system", "owner", "worker", "provider"] as const;
export type EventActorType = (typeof EVENT_ACTOR_TYPES)[number];

export const EXTERNAL_RESOURCE_STATUSES = [
  "pending",
  "active",
  "inactive",
  "missing",
  "deleted",
] as const;
export type ExternalResourceStatus = (typeof EXTERNAL_RESOURCE_STATUSES)[number];

export const ACTION_INTENT_STATUSES = [
  "proposed",
  "approved",
  "executing",
  "completed",
  "rejected",
  "expired",
  "failed",
] as const;
export type ActionIntentStatus = (typeof ACTION_INTENT_STATUSES)[number];

export const ACTION_CREATOR_TYPES = ["system", "owner", "worker"] as const;
export type ActionCreatorType = (typeof ACTION_CREATOR_TYPES)[number];

export const ACTION_RECEIPT_OUTCOMES = ["succeeded", "failed", "uncertain"] as const;
export type ActionReceiptOutcome = (typeof ACTION_RECEIPT_OUTCOMES)[number];

export const OWNER_INTERVENTION_STATUSES = [
  "open",
  "resolved",
  "declined",
  "cancelled",
] as const;
export type OwnerInterventionStatus = (typeof OWNER_INTERVENTION_STATUSES)[number];

export interface CoreRecord {
  id: UUID;
  createdAt: ISODateTime;
}

export interface MutableCoreRecord extends CoreRecord {
  updatedAt: ISODateTime;
}

export interface BusinessScopedRecord {
  businessId: UUID;
}

export interface Pack extends MutableCoreRecord {
  packKey: string;
  version: string;
  name: string;
  kind: PackKind;
  status: QualificationStatus;
  manifest: JsonObject;
}

export interface WorkflowDefinition extends MutableCoreRecord {
  packId: UUID;
  workflowKey: string;
  version: string;
  name: string;
  description: string | null;
  status: QualificationStatus;
  inputSchema: JsonObject;
  outputSchema: JsonObject;
  stageDefinition: JsonObject;
}

export interface WorkerDefinition extends MutableCoreRecord {
  packId: UUID;
  workerKey: string;
  version: string;
  name: string;
  role: string;
  charter: string;
  status: QualificationStatus;
  inputSchema: JsonObject;
  outputSchema: JsonObject;
  knowledgeRequirements: JsonValue[];
  capabilityRequirements: JsonValue[];
  modelRequirements: JsonObject;
}

export interface Goal extends MutableCoreRecord, BusinessScopedRecord {
  title: string;
  description: string | null;
  status: GoalStatus;
  target: JsonObject;
  successCriteria: JsonObject;
}

export interface WorkflowRun extends MutableCoreRecord, BusinessScopedRecord {
  goalId: UUID | null;
  workflowDefinitionId: UUID;
  status: WorkflowRunStatus;
  currentStageKey: string | null;
  idempotencyKey: string;
  input: JsonObject;
  state: JsonObject;
  startedAt: ISODateTime | null;
  completedAt: ISODateTime | null;
}

export interface WorkflowStageRun extends MutableCoreRecord, BusinessScopedRecord {
  workflowRunId: UUID;
  stageKey: string;
  sequence: number;
  attempt: number;
  status: WorkflowStageRunStatus;
  input: JsonObject;
  output: JsonObject;
  failure: JsonObject;
  startedAt: ISODateTime | null;
  completedAt: ISODateTime | null;
}

export interface TaskContract extends MutableCoreRecord, BusinessScopedRecord {
  workflowRunId: UUID;
  workflowStageRunId: UUID | null;
  workerDefinitionId: UUID;
  status: TaskContractStatus;
  objective: string;
  inputArtifactIds: UUID[];
  permittedCapabilities: string[];
  requiredKnowledge: string[];
  requiredOutputSchema: JsonObject;
  completionCriteria: JsonObject;
  failureCriteria: JsonObject;
  nonGoals: string[];
  escalationRules: JsonObject;
}

export interface WorkerRun extends MutableCoreRecord, BusinessScopedRecord {
  workflowRunId: UUID;
  taskContractId: UUID;
  workerDefinitionId: UUID;
  status: WorkerRunStatus;
  input: JsonObject;
  output: JsonObject;
  failure: JsonObject;
  executionMetadata: JsonObject;
  startedAt: ISODateTime | null;
  completedAt: ISODateTime | null;
}

export interface Artifact extends MutableCoreRecord, BusinessScopedRecord {
  workflowRunId: UUID | null;
  taskContractId: UUID | null;
  artifactType: string;
  name: string;
  mediaType: string;
  storagePath: string | null;
  content: JsonObject;
  checksum: string | null;
  metadata: JsonObject;
}

export interface Evidence extends CoreRecord, BusinessScopedRecord {
  workflowRunId: UUID | null;
  artifactId: UUID | null;
  sourceType: string;
  sourceUri: string | null;
  title: string | null;
  excerpt: string | null;
  observedAt: ISODateTime;
  freshness: JsonObject;
  metadata: JsonObject;
}

export interface Event extends CoreRecord, BusinessScopedRecord {
  workflowRunId: UUID | null;
  eventType: string;
  actorType: EventActorType;
  actorId: string | null;
  payload: JsonObject;
  occurredAt: ISODateTime;
}

export interface ExternalResource extends MutableCoreRecord, BusinessScopedRecord {
  provider: string;
  resourceType: string;
  externalId: string;
  status: ExternalResourceStatus;
  canonicalUrl: string | null;
  metadata: JsonObject;
}

export interface ActionIntent extends MutableCoreRecord, BusinessScopedRecord {
  workflowRunId: UUID | null;
  taskContractId: UUID | null;
  actionType: string;
  capability: string;
  status: ActionIntentStatus;
  request: JsonObject;
  risk: JsonObject;
  financialImpact: JsonObject;
  idempotencyKey: string;
  createdByType: ActionCreatorType;
  createdById: string | null;
}

export interface ActionReceipt extends CoreRecord, BusinessScopedRecord {
  actionIntentId: UUID;
  externalResourceId: UUID | null;
  attempt: number;
  outcome: ActionReceiptOutcome;
  provider: string;
  requestFingerprint: string;
  responseSummary: JsonObject;
  occurredAt: ISODateTime;
}

export interface OwnerIntervention extends MutableCoreRecord, BusinessScopedRecord {
  workflowRunId: UUID | null;
  actionIntentId: UUID | null;
  interventionType: string;
  status: OwnerInterventionStatus;
  title: string;
  description: string;
  options: JsonValue[];
  resolution: JsonObject;
  requestedAt: ISODateTime;
  resolvedAt: ISODateTime | null;
}

export interface CoreContractMap {
  pack: Pack;
  workflowDefinition: WorkflowDefinition;
  workerDefinition: WorkerDefinition;
  goal: Goal;
  workflowRun: WorkflowRun;
  workflowStageRun: WorkflowStageRun;
  taskContract: TaskContract;
  workerRun: WorkerRun;
  artifact: Artifact;
  evidence: Evidence;
  event: Event;
  externalResource: ExternalResource;
  actionIntent: ActionIntent;
  actionReceipt: ActionReceipt;
  ownerIntervention: OwnerIntervention;
}

export type ContractFor<K extends CoreContractKind> = CoreContractMap[K];

export type ManagedField = "id" | "createdAt" | "updatedAt";

export type CreateContractInput<K extends CoreContractKind> = Omit<
  ContractFor<K>,
  Extract<keyof ContractFor<K>, ManagedField>
> &
  Partial<Pick<ContractFor<K>, Extract<keyof ContractFor<K>, ManagedField>>>;

export type UpdateContractInput<K extends MutableContractKind> = Pick<ContractFor<K>, "id"> &
  Partial<Omit<ContractFor<K>, "id" | "createdAt">>;
