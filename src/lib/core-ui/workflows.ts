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
  workflow_stage_run_id: string | null;
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

export function latestStageByKey<T extends Pick<WorkflowStageRecord, "stage_key" | "attempt" | "updated_at">>(stages: readonly T[]) {
  const map = new Map<string, T>();
  for (const stage of stages) {
    const existing = map.get(stage.stage_key);
    if (!existing || stage.attempt > existing.attempt ||
        (stage.attempt === existing.attempt && stage.updated_at > existing.updated_at)) {
      map.set(stage.stage_key, stage);
    }
  }
  return map;
}

// This proof has one registered definition. Other reviews must never inherit its hook.
export const SYNTHETIC_REVIEW_WORKFLOW = {
  id: "00000000-0000-4000-8000-000000000301",
  workflow_key: "synthetic.core.runtime-proof",
  version: "1.0.0",
} as const;

type ReviewIntervention = Pick<OwnerInterventionRecord,
  "business_id" | "workflow_run_id" | "intervention_type" | "status">;
type ReviewRun = Pick<WorkflowRunRecord,
  "id" | "business_id" | "workflow_definition_id" | "status" | "current_stage_key" | "completed_at">;
type ReviewDefinition = Pick<WorkflowDefinitionRecord, "id" | "workflow_key" | "version">;

export function canResumeSyntheticReview(
  intervention: ReviewIntervention,
  run: ReviewRun | null | undefined,
  definition: ReviewDefinition | null | undefined,
) {
  return intervention.status === "open" &&
    intervention.intervention_type === "synthetic_workflow_review" &&
    Boolean(run && definition &&
      intervention.workflow_run_id === run.id &&
      intervention.business_id === run.business_id &&
      run.status === "needs_owner" && run.current_stage_key === "review" && !run.completed_at &&
      run.workflow_definition_id === definition.id &&
      definition.id === SYNTHETIC_REVIEW_WORKFLOW.id &&
      definition.workflow_key === SYNTHETIC_REVIEW_WORKFLOW.workflow_key &&
      definition.version === SYNTHETIC_REVIEW_WORKFLOW.version);
}

export type InterventionAction =
  | { kind: "synthetic_review" }
  | { kind: "browser_control"; decision: "take_control" | "return_control" }
  | { kind: "simulation_review" }
  | { kind: "link"; href: string; label: string; section: "details" | "publication" | "printful" };

export function interventionDetailsHref(intervention: Pick<OwnerInterventionRecord, "workflow_run_id">) {
  return intervention.workflow_run_id
    ? `/dashboard/workflows/${encodeURIComponent(intervention.workflow_run_id)}`
    : "/dashboard/needs-you";
}

export function interventionAction(
  intervention: OwnerInterventionRecord,
  run?: ReviewRun | null,
  definition?: ReviewDefinition | null,
): InterventionAction {
  const details: InterventionAction = {
    kind: "link", href: interventionDetailsHref(intervention), label: "View details", section: "details",
  };
  if (intervention.status !== "open") return details;
  switch (intervention.intervention_type) {
    case "synthetic_workflow_review":
      return canResumeSyntheticReview(intervention, run, definition) ? { kind: "synthetic_review" } : details;
    case "browser_takeover":
      return intervention.workflow_run_id ? { kind: "browser_control", decision: "take_control" } : details;
    case "browser_return_control":
      return intervention.workflow_run_id ? { kind: "browser_control", decision: "return_control" } : details;
    case "etsy_simulation_review":
      return intervention.workflow_run_id ? { kind: "simulation_review" } : details;
    case "etsy.publication.reconcile":
      return { kind: "link", section: "publication", label: "Check existing listing",
        href: `/dashboard/etsy?business=${encodeURIComponent(intervention.business_id)}&publicationRequest=${encodeURIComponent(intervention.id)}#publication-history` };
    case "printful.product.reconcile":
      return { kind: "link", section: "printful", label: "Review existing product",
        href: `/dashboard/printful?business=${encodeURIComponent(intervention.business_id)}&intervention=${encodeURIComponent(intervention.id)}#product-configuration-history` };
    default:
      // Creative validation failures and future intervention types are inspect-only.
      return details;
  }
}

export function workflowExecutionEnded(run: Pick<WorkflowRunRecord, "status" | "completed_at">) {
  // Creative needs_owner can be a stopped runtime, unlike a resumable synthetic review.
  return TERMINAL_WORKFLOW_STATUSES.has(run.status) || Boolean(run.completed_at);
}

export function stageLabel(key: string | null | undefined, fallback = "Not recorded") {
  const creative: Record<string, string> = {
    "brief:1": "Brief", "screen:1": "Brief screen", "generate:1": "Generate image",
    "review:1": "Image review", "generate:2": "Repair image", "review:2": "Repair review",
  };
  const label = key ? creative[key] : undefined;
  return typeof label === "string" ? label : humanize(key, fallback);
}

export type WorkflowTimelineStage = {
  key: string;
  label: string;
  status: string;
  detail: string;
  isCurrent: boolean;
  recorded: boolean;
};

export function workflowTimelineStages(
  definition: WorkflowDefinitionRecord | undefined,
  run: WorkflowRunRecord,
  stages: readonly WorkflowStageRecord[],
): WorkflowTimelineStage[] {
  const latest = latestStageByKey(stages.filter(stage => stage.workflow_run_id === run.id));
  let blueprints = definition?.id === run.workflow_definition_id ? stageBlueprints(definition) : [];
  // The creative pack describes worker roles, while its dedicated runtime persists
  // phase/generation keys. Use that exact runtime contract, never fuzzy prefix matches.
  if (definition?.id === run.workflow_definition_id &&
      definition.workflow_key === "etsy.creative-pipeline" && definition.version === "1.0.0") {
    const keys = ["brief:1", "screen:1", "generate:1", "review:1"];
    if (latest.has("generate:2") || latest.has("review:2") ||
        run.current_stage_key === "generate:2" || run.current_stage_key === "review:2") {
      keys.push("generate:2", "review:2");
    }
    blueprints = keys.map((key, index) => ({ key, sequence: index + 1, type: "stage" }));
  }
  const knownKeys = new Set(blueprints.map(stage => stage.key));
  for (const stage of latest.values()) {
    if (!knownKeys.has(stage.stage_key)) {
      blueprints.push({ key: stage.stage_key, sequence: stage.sequence, type: "stage" });
    }
  }
  blueprints.sort((left, right) => left.sequence - right.sequence);
  if (!blueprints.length) {
    blueprints = [{ key: run.current_stage_key ?? "unrecorded", sequence: 0, type: "stage" }];
  }
  const ended = workflowExecutionEnded(run);
  const currentIndex = blueprints.findIndex(stage => stage.key === run.current_stage_key);
  return blueprints.map((blueprint, index) => {
    const stage = latest.get(blueprint.key);
    const status = stage
      ? (stage.status === "skipped" || (ended && stage.status === "pending") ? "not_run" : stage.status)
      : (!ended && currentIndex >= 0 && index > currentIndex ? "pending" : "not_recorded");
    const staleActive = ended && ["queued", "running", "waiting", "review", "needs_owner"].includes(status);
    return {
      key: blueprint.key,
      label: blueprint.key === "unrecorded" ? "Stage history" : stageLabel(blueprint.key),
      status,
      detail: `${staleActive ? "Last recorded: " : ""}${statusLabel(status)}${stage && stage.attempt > 1 ? ` · attempt ${stage.attempt}` : ""}${staleActive ? " · run ended" : ""}`,
      isCurrent: !ended && blueprint.key === run.current_stage_key,
      recorded: Boolean(stage),
    };
  });
}

export function currentWorkerSummary(
  run: Pick<WorkflowRunRecord, "id" | "business_id" | "status" | "current_stage_key" | "completed_at">,
  task: Pick<TaskContractRecord, "id" | "business_id" | "workflow_run_id" | "workflow_stage_run_id" | "worker_definition_id" | "status"> | null,
  workerRun: Pick<WorkerRunRecord, "business_id" | "workflow_run_id" | "task_contract_id" | "worker_definition_id" | "status" | "completed_at"> | null | undefined,
  workerDefinition: Pick<WorkerDefinitionRecord, "id" | "name"> | null | undefined,
  stages: readonly Pick<WorkflowStageRecord, "id" | "workflow_run_id" | "stage_key" | "attempt" | "updated_at" | "status">[] = [],
) {
  const matchingWorker = workerRun?.workflow_run_id === run.id && workerRun.business_id === run.business_id;
  const matchingTask = task?.workflow_run_id === run.id && task.business_id === run.business_id &&
    matchingWorker && workerRun.task_contract_id === task.id && workerRun.worker_definition_id === task.worker_definition_id;
  const currentStage = latestStageByKey(stages.filter(stage => stage.workflow_run_id === run.id))
    .get(run.current_stage_key ?? "");
  const matchingStage = matchingTask && task.status === "running" && currentStage &&
    currentStage.id === task.workflow_stage_run_id && currentStage.status === "running";
  const name = matchingWorker && workerDefinition?.id === workerRun.worker_definition_id
    ? workerDefinition.name : "Recorded worker";
  const active = !workflowExecutionEnded(run) && run.status === "running" && task?.status === "running" && matchingStage &&
    workerRun?.status === "running" && !workerRun.completed_at;
  return active
    ? { active: true, value: name, detail: "Working on the current stage" }
    : { active: false, value: "No current worker", detail: matchingWorker
      ? `Last worker: ${name} · ${statusLabel(workerRun.status)}`
      : "No current worker execution recorded" };
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
  if (intervention?.status === "open") return intervention.title;
  if (run.status === "completed") return "Run completed; saved results are ready to review";
  if (run.status === "failed") return payloadText(run.state, "reason") ?? "Run stopped; review the recorded issue";
  if (run.status === "cancelled") return "Run stopped";
  if (workflowExecutionEnded(run)) return payloadText(run.state, "reason") ?? "Run ended; review the saved outcome";
  if (run.status === "needs_owner" || run.status === "review") return "Waiting for your review";
  if (run.status === "waiting") return "Waiting for the next step";
  if (run.status === "queued") return "Queued to start";
  if (run.status === "running") return `Working on ${stageLabel(run.current_stage_key, "the workflow")}`;
  return event ? `Last update: ${eventLabel(event.event_type)}` : "Current action not recorded";
}

export function deriveNextStep(
  run: WorkflowRunRecord,
  definition: WorkflowDefinitionRecord | undefined,
  intervention: OwnerInterventionRecord | null,
) {
  if (intervention?.status === "open") {
    if (intervention.intervention_type === "creative_review") return "Review evidence before a separately approved run";
    if (intervention.intervention_type === "synthetic_workflow_review") return "Waiting for your decision";
    return "Open the request and review its next step";
  }
  if (run.status === "completed") return "Review the saved results";
  if (workflowExecutionEnded(run)) return "Review what happened before starting another run";

  const timeline = workflowTimelineStages(definition, run, []);
  const currentIndex = timeline.findIndex(stage => stage.key === run.current_stage_key);
  const next = currentIndex >= 0 ? timeline[currentIndex + 1] : null;
  return next ? next.label : "Finish the current stage";
}

export function workflowNextStepLink(
  run: WorkflowRunRecord,
  definition: WorkflowDefinitionRecord | undefined,
  intervention: OwnerInterventionRecord | null,
) {
  if (intervention?.status === "open") {
    if (intervention.intervention_type === "creative_review") {
      return { href: "/dashboard/artifacts#creative-approvals", label: "Review creative evidence" };
    }
    const action = interventionAction(intervention, run, definition);
    if (action.kind === "link") return { href: action.href, label: action.label };
    return { href: "/dashboard/needs-you", label: "Review request" };
  }
  if (!workflowExecutionEnded(run)) return null;
  if (definition?.id === run.workflow_definition_id && definition.workflow_key === "etsy.creative-pipeline") {
    return { href: "/dashboard/artifacts#creative-approvals", label: "View creative results and receipts" };
  }
  return run.status === "completed"
    ? { href: `/dashboard/workflows/${encodeURIComponent(run.id)}?workspace=artifacts`, label: "View saved results" }
    : { href: `/dashboard/workflows/${encodeURIComponent(run.id)}#workflow-activity`, label: "Review recorded activity" };
}

export function statusLabel(status: string) {
  const labels: Record<string, string> = {
    needs_owner: "Needs you",
    queued: "Queued",
    review: "Needs review",
    running: "Working",
    waiting: "Waiting",
    completed: "Completed",
    failed: "Failed",
    cancelled: "Stopped",
    pending: "Upcoming",
    skipped: "Not run",
    not_run: "Not run",
    not_recorded: "Not recorded",
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
