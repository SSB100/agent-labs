export type UiJson = Record<string, unknown>;

export type BusinessRecord = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

export type WorkflowDefinitionRecord = {
  id: string;
  workflow_key: string;
  version: string;
  name: string;
  description: string;
  status: string;
  stage_definition: UiJson;
};

export type WorkflowRunRecord = {
  id: string;
  business_id: string;
  workflow_definition_id: string;
  status: string;
  current_stage_key: string | null;
  input: UiJson;
  state: UiJson;
  runtime_provider: string | null;
  runtime_run_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkflowStageRecord = {
  id: string;
  workflow_run_id: string;
  stage_key: string;
  sequence: number;
  attempt: number;
  status: string;
  input: UiJson;
  output: UiJson;
  failure: UiJson;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkflowEventRecord = {
  id: string;
  business_id: string;
  workflow_run_id: string | null;
  event_type: string;
  actor_type: string;
  actor_id: string | null;
  payload: UiJson;
  occurred_at: string;
  created_at: string;
};

export type OwnerInterventionRecord = {
  id: string;
  business_id: string;
  workflow_run_id: string | null;
  intervention_type: string;
  status: string;
  title: string;
  description: string;
  options: UiJson;
  resolution: UiJson;
  requested_at: string;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TaskContractRecord = {
  id: string;
  business_id: string;
  workflow_run_id: string;
  workflow_stage_run_id: string;
  worker_definition_id: string;
  status: string;
  objective: string;
  input_artifact_ids: string[];
  permitted_capabilities: string[];
  required_knowledge: string[];
  completion_criteria: UiJson;
  failure_criteria: UiJson;
  non_goals: string[];
  escalation_rules: UiJson;
  created_at: string;
  updated_at: string;
};

export type WorkerRunRecord = {
  id: string;
  business_id: string;
  workflow_run_id: string;
  task_contract_id: string;
  worker_definition_id: string;
  status: string;
  output: UiJson;
  failure: UiJson;
  execution_metadata: UiJson;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkerDefinitionRecord = {
  id: string;
  worker_key: string;
  version: string;
  name: string;
  role: string;
  status: string;
};

export type ArtifactRecord = {
  id: string;
  business_id: string;
  workflow_run_id: string | null;
  task_contract_id: string | null;
  artifact_type: string;
  name: string;
  media_type: string;
  storage_path: string | null;
  content: UiJson | null;
  metadata: UiJson;
  created_at: string;
  updated_at: string;
};

export type StageBlueprint = {
  key: string;
  type: string;
  sequence: number;
};

export const ACTIVE_WORKFLOW_STATUSES = new Set([
  "needs_owner",
  "queued",
  "review",
  "running",
  "waiting",
]);

export const TERMINAL_WORKFLOW_STATUSES = new Set([
  "cancelled",
  "completed",
  "failed",
]);

export function humanize(value: string | null | undefined, fallback = "Not available") {
  if (!value) return fallback;
  return value
    .split(/[._-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "Not yet";
  return new Intl.DateTimeFormat("en-NZ", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatRelativeTime(value: string | null | undefined) {
  if (!value) return "Not yet";
  const milliseconds = new Date(value).getTime() - Date.now();
  const absolute = Math.abs(milliseconds);
  const formatter = new Intl.RelativeTimeFormat("en-NZ", { numeric: "auto" });

  if (absolute < 60_000) return formatter.format(Math.round(milliseconds / 1_000), "second");
  if (absolute < 3_600_000) return formatter.format(Math.round(milliseconds / 60_000), "minute");
  if (absolute < 86_400_000) return formatter.format(Math.round(milliseconds / 3_600_000), "hour");
  return formatter.format(Math.round(milliseconds / 86_400_000), "day");
}

export function stageBlueprints(definition: WorkflowDefinitionRecord | undefined) {
  const rawStages = definition?.stage_definition?.stages;
  if (!Array.isArray(rawStages)) return [] as StageBlueprint[];

  return rawStages
    .map((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
      const candidate = entry as Record<string, unknown>;
      if (typeof candidate.key !== "string") return null;
      return {
        key: candidate.key,
        type: typeof candidate.type === "string" ? candidate.type : "stage",
        sequence:
          typeof candidate.sequence === "number" && Number.isFinite(candidate.sequence)
            ? candidate.sequence
            : index,
      } satisfies StageBlueprint;
    })
    .filter((entry): entry is StageBlueprint => Boolean(entry))
    .sort((left, right) => left.sequence - right.sequence);
}

export function latestStageByKey(stages: readonly WorkflowStageRecord[]) {
  const map = new Map<string, WorkflowStageRecord>();
  for (const stage of stages) {
    const existing = map.get(stage.stage_key);
    if (!existing || stage.attempt >= existing.attempt) map.set(stage.stage_key, stage);
  }
  return map;
}

export function openIntervention(
  interventions: readonly OwnerInterventionRecord[],
) {
  return interventions.find((intervention) => intervention.status === "open") ?? null;
}

export function currentTask(tasks: readonly TaskContractRecord[]) {
  return (
    [...tasks].sort(
      (left, right) =>
        new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime(),
    )[0] ?? null
  );
}

export function currentWorkerRun(workerRuns: readonly WorkerRunRecord[]) {
  return (
    [...workerRuns].sort(
      (left, right) =>
        new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime(),
    )[0] ?? null
  );
}

export function latestEvent(events: readonly WorkflowEventRecord[]) {
  return (
    [...events].sort(
      (left, right) =>
        new Date(right.occurred_at).getTime() - new Date(left.occurred_at).getTime(),
    )[0] ?? null
  );
}

export function eventLabel(eventType: string) {
  const labels: Record<string, string> = {
    "model.invocation.completed": "Model response completed",
    "model.invocation.failed": "Model attempt failed",
    "model.invocation.started": "Model attempt started",
    "browser.planner.observed": "Browser Planner observed the page",
    "browser.planner.action.planned": "Browser Planner chose the next action",
    "browser.planner.action.completed": "Browser Planner action completed",
    "browser.planner.action.failed": "Browser Planner action failed",
    "browser.planner.recovery": "Browser Planner recovery scheduled",
    "model.route.resolved": "Model route selected",
    "owner.intervention.resolved": "Owner decision recorded",
    "owner_intervention.requested": "Owner decision requested",
    "task_contract.created": "Task Contract created",
    "worker.completed": "Worker completed",
    "worker.failed": "Worker failed",
    "worker.started": "Worker started",
    "workflow.completed": "Workflow completed",
    "workflow.failed": "Workflow failed",
    "workflow.owner_intervention.requested": "Owner decision requested",
    "workflow.queued": "Workflow queued",
    "workflow.retry.scheduled": "Worker retry scheduled",
    "workflow.stage.completed": "Stage completed",
    "workflow.started": "Workflow started",
    "workflow.wait.completed": "Wait completed",
    "workflow.wait.started": "Durable wait started",
  };
  return labels[eventType] ?? humanize(eventType);
}

function payloadText(payload: UiJson, key: string) {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function eventDetail(event: WorkflowEventRecord) {
  const payload = event.payload ?? {};
  const model = payloadText(payload, "modelKey") ?? payloadText(payload, "providerModelId");
  const stage = payloadText(payload, "stageKey");
  const category = payloadText(payload, "category");
  const attempt = typeof payload.attempt === "number" ? payload.attempt : null;

  if (model && attempt) return `${model}, attempt ${attempt}`;
  if (model) return model;
  if (stage) return humanize(stage);
  if (category) return humanize(category);
  return humanize(event.actor_type, "System");
}

export function deriveCurrentAction(
  run: WorkflowRunRecord,
  event: WorkflowEventRecord | null,
  intervention: OwnerInterventionRecord | null,
) {
  if (intervention) return intervention.title;
  if (run.status === "completed") return "Workflow completed successfully";
  if (run.status === "failed") return "Workflow stopped after a classified failure";
  if (run.status === "waiting") return "Waiting durably without consuming active compute";
  if (run.status === "queued") return "Waiting for the durable runtime to begin";
  return event ? eventLabel(event.event_type) : `Running ${humanize(run.current_stage_key, "workflow")}`;
}

export function deriveNextStep(
  run: WorkflowRunRecord,
  definition: WorkflowDefinitionRecord | undefined,
  intervention: OwnerInterventionRecord | null,
) {
  if (intervention) return "Waiting for your decision";
  if (TERMINAL_WORKFLOW_STATUSES.has(run.status)) return "No further step";

  const blueprints = stageBlueprints(definition);
  const currentIndex = blueprints.findIndex((stage) => stage.key === run.current_stage_key);
  const next = currentIndex >= 0 ? blueprints[currentIndex + 1] : blueprints[0];
  return next ? humanize(next.key) : "Finish the current stage";
}

export function statusLabel(status: string) {
  const labels: Record<string, string> = {
    needs_owner: "Needs you",
    queued: "Queued",
    review: "Review",
    running: "Running",
    waiting: "Waiting",
    completed: "Completed",
    failed: "Failed",
    cancelled: "Cancelled",
  };
  return labels[status] ?? humanize(status);
}

export function statusTone(status: string) {
  if (status === "completed") return "success";
  if (status === "needs_owner" || status === "review") return "attention";
  if (status === "failed" || status === "cancelled") return "danger";
  if (status === "running" || status === "waiting" || status === "queued") return "live";
  return "neutral";
}
