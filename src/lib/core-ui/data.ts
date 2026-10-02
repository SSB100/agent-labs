import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import type {
  ArtifactRecord,
  BusinessRecord,
  OwnerInterventionRecord,
  TaskContractRecord,
  WorkerDefinitionRecord,
  WorkerRunRecord,
  WorkflowDefinitionRecord,
  WorkflowEventRecord,
  WorkflowRunRecord,
  WorkflowStageRecord,
} from "./workflows";

const WORKFLOW_RUN_SELECT =
  "id, business_id, workflow_definition_id, status, current_stage_key, input, state, runtime_provider, runtime_run_id, started_at, completed_at, created_at, updated_at";
const WORKFLOW_DEFINITION_SELECT =
  "id, workflow_key, version, name, description, status, stage_definition";
const STAGE_SELECT =
  "id, workflow_run_id, stage_key, sequence, attempt, status, input, output, failure, started_at, completed_at, created_at, updated_at";
const EVENT_SELECT =
  "id, business_id, workflow_run_id, event_type, actor_type, actor_id, payload, occurred_at, created_at";
const INTERVENTION_SELECT =
  "id, business_id, workflow_run_id, intervention_type, status, title, description, options, resolution, requested_at, resolved_at, created_at, updated_at";
const TASK_SELECT =
  "id, business_id, workflow_run_id, workflow_stage_run_id, worker_definition_id, status, objective, input_artifact_ids, permitted_capabilities, required_knowledge, completion_criteria, failure_criteria, non_goals, escalation_rules, created_at, updated_at";
const WORKER_RUN_SELECT =
  "id, business_id, workflow_run_id, task_contract_id, worker_definition_id, status, output, failure, execution_metadata, started_at, completed_at, created_at, updated_at";
const ARTIFACT_SELECT =
  "id, business_id, workflow_run_id, task_contract_id, artifact_type, name, media_type, storage_path, content, metadata, created_at, updated_at";

function rows<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

function row<T>(data: unknown): T | null {
  return data && typeof data === "object" && !Array.isArray(data) ? (data as T) : null;
}

function errorMessage(error: unknown) {
  return error && typeof error === "object" && "message" in error
    ? String(error.message)
    : "Unknown data error";
}

export type OwnerUiContext = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  email: string;
  displayName: string;
  businesses: BusinessRecord[];
  needsYouCount: number;
  needsYouUnavailable?: boolean;
  businessesUnavailable?: boolean;
};

export type WorkflowCollection = {
  runs: WorkflowRunRecord[];
  definitions: WorkflowDefinitionRecord[];
  stages: WorkflowStageRecord[];
  events: WorkflowEventRecord[];
  interventions: OwnerInterventionRecord[];
  tasks: TaskContractRecord[];
  workerRuns: WorkerRunRecord[];
  workerDefinitions: WorkerDefinitionRecord[];
  artifacts: ArtifactRecord[];
  errors: string[];
};

const EMPTY_COLLECTION: WorkflowCollection = {
  runs: [],
  definitions: [],
  stages: [],
  events: [],
  interventions: [],
  tasks: [],
  workerRuns: [],
  workerDefinitions: [],
  artifacts: [],
  errors: [],
};

export async function requireOwnerUiContext(): Promise<OwnerUiContext> {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  const userId = claims?.sub;

  if (claimsError || !userId) redirect("/login?error=session-required");

  const [businessResult, profileResult, interventionCountResult] = await Promise.all([
    supabase
      .from("businesses")
      .select("id, name, created_at, updated_at")
      .eq("owner_user_id", userId)
      .order("created_at", { ascending: false }),
    supabase.from("profiles").select("display_name").eq("id", userId).maybeSingle(),
    supabase
      .from("owner_interventions")
      .select("id", { count: "exact", head: true })
      .eq("status", "open"),
  ]);

  const businesses = rows<BusinessRecord>(businessResult.data);
  const email = typeof claims.email === "string" ? claims.email : "Owner";
  const profile = row<{ display_name?: unknown }>(profileResult.data);
  const profileName = profile?.display_name;
  const displayName =
    typeof profileName === "string" && profileName.trim() ? profileName.trim() : email;

  return {
    supabase,
    userId,
    email,
    displayName,
    businesses,
    needsYouCount: interventionCountResult.count ?? 0,
    needsYouUnavailable: Boolean(interventionCountResult.error),
    businessesUnavailable: Boolean(businessResult.error),
  };
}

export async function loadWorkflowCollection(
  context: OwnerUiContext,
  options: { limit?: number; statuses?: string[] } = {},
): Promise<WorkflowCollection> {
  const businessIds = context.businesses.map((business) => business.id);
  if (!businessIds.length) return { ...EMPTY_COLLECTION, errors: context.businessesUnavailable ? ["Business records could not be loaded"] : [] };

  const baseRunQuery = context.supabase
    .from("workflow_runs")
    .select(WORKFLOW_RUN_SELECT)
    .in("business_id", businessIds)
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 60);
  const runResult = options.statuses?.length
    ? await baseRunQuery.in("status", options.statuses)
    : await baseRunQuery;
  const runs = rows<WorkflowRunRecord>(runResult.data);
  const errors = runResult.error ? [errorMessage(runResult.error)] : [];
  const runIds = runs.map((run) => run.id);
  const definitionIds = [...new Set(runs.map((run) => run.workflow_definition_id))];

  if (!runIds.length) return { ...EMPTY_COLLECTION, runs, errors };

  const [
    definitionResult,
    stageResult,
    eventResult,
    interventionResult,
    taskResult,
    workerRunResult,
    artifactResult,
  ] = await Promise.all([
    context.supabase
      .from("workflow_definitions")
      .select(WORKFLOW_DEFINITION_SELECT)
      .in("id", definitionIds),
    context.supabase
      .from("workflow_stage_runs")
      .select(STAGE_SELECT)
      .in("workflow_run_id", runIds)
      .order("sequence", { ascending: true })
      .order("attempt", { ascending: true }),
    context.supabase
      .from("events")
      .select(EVENT_SELECT)
      .in("workflow_run_id", runIds)
      .order("occurred_at", { ascending: false })
      .limit(300),
    context.supabase
      .from("owner_interventions")
      .select(INTERVENTION_SELECT)
      .in("workflow_run_id", runIds)
      .order("requested_at", { ascending: false }),
    context.supabase
      .from("task_contracts")
      .select(TASK_SELECT)
      .in("workflow_run_id", runIds)
      .order("created_at", { ascending: false }),
    context.supabase
      .from("worker_runs")
      .select(WORKER_RUN_SELECT)
      .in("workflow_run_id", runIds)
      .order("created_at", { ascending: false }),
    context.supabase
      .from("artifacts")
      .select(ARTIFACT_SELECT)
      .in("workflow_run_id", runIds)
      .order("created_at", { ascending: false }),
  ]);

  for (const result of [
    definitionResult,
    stageResult,
    eventResult,
    interventionResult,
    taskResult,
    workerRunResult,
    artifactResult,
  ]) {
    if (result.error) errors.push(errorMessage(result.error));
  }

  const tasks = rows<TaskContractRecord>(taskResult.data);
  const workerRuns = rows<WorkerRunRecord>(workerRunResult.data);
  const workerDefinitionIds = [
    ...new Set([
      ...tasks.map((task) => task.worker_definition_id),
      ...workerRuns.map((workerRun) => workerRun.worker_definition_id),
    ]),
  ];
  let workerDefinitions: WorkerDefinitionRecord[] = [];

  if (workerDefinitionIds.length) {
    const workerDefinitionResult = await context.supabase
      .from("worker_definitions")
      .select("id, worker_key, version, name, role, status")
      .in("id", workerDefinitionIds);
    workerDefinitions = rows<WorkerDefinitionRecord>(workerDefinitionResult.data);
    if (workerDefinitionResult.error) errors.push(errorMessage(workerDefinitionResult.error));
  }

  return {
    runs,
    definitions: rows<WorkflowDefinitionRecord>(definitionResult.data),
    stages: rows<WorkflowStageRecord>(stageResult.data),
    events: rows<WorkflowEventRecord>(eventResult.data),
    interventions: rows<OwnerInterventionRecord>(interventionResult.data),
    tasks,
    workerRuns,
    workerDefinitions,
    artifacts: rows<ArtifactRecord>(artifactResult.data),
    errors,
  };
}

export async function loadWorkflowDetail(
  context: OwnerUiContext,
  workflowRunId: string,
) {
  const runResult = await context.supabase
    .from("workflow_runs")
    .select(WORKFLOW_RUN_SELECT)
    .eq("id", workflowRunId)
    .maybeSingle();
  const run = row<WorkflowRunRecord>(runResult.data);
  if (runResult.error) throw new Error("Workflow records are temporarily unavailable");
  if (!run) notFound();

  const [
    businessResult,
    definitionResult,
    stageResult,
    eventResult,
    interventionResult,
    taskResult,
    workerRunResult,
    artifactResult,
  ] = await Promise.all([
    context.supabase
      .from("businesses")
      .select("id, name, created_at, updated_at")
      .eq("id", run.business_id)
      .maybeSingle(),
    context.supabase
      .from("workflow_definitions")
      .select(WORKFLOW_DEFINITION_SELECT)
      .eq("id", run.workflow_definition_id)
      .maybeSingle(),
    context.supabase
      .from("workflow_stage_runs")
      .select(STAGE_SELECT)
      .eq("workflow_run_id", run.id)
      .order("sequence", { ascending: true })
      .order("attempt", { ascending: true }),
    context.supabase
      .from("events")
      .select(EVENT_SELECT)
      .eq("workflow_run_id", run.id)
      .order("occurred_at", { ascending: false })
      .limit(100),
    context.supabase
      .from("owner_interventions")
      .select(INTERVENTION_SELECT)
      .eq("workflow_run_id", run.id)
      .order("requested_at", { ascending: false }),
    context.supabase
      .from("task_contracts")
      .select(TASK_SELECT)
      .eq("workflow_run_id", run.id)
      .order("created_at", { ascending: false }),
    context.supabase
      .from("worker_runs")
      .select(WORKER_RUN_SELECT)
      .eq("workflow_run_id", run.id)
      .order("created_at", { ascending: false }),
    context.supabase
      .from("artifacts")
      .select(ARTIFACT_SELECT)
      .eq("workflow_run_id", run.id)
      .order("created_at", { ascending: false }),
  ]);

  const errors = [businessResult, definitionResult, stageResult, eventResult, interventionResult, taskResult, workerRunResult, artifactResult].filter(result => result.error).map(result => errorMessage(result.error));
  const tasks = rows<TaskContractRecord>(taskResult.data);
  const workerRuns = rows<WorkerRunRecord>(workerRunResult.data);
  const workerDefinitionIds = [
    ...new Set([
      ...tasks.map((task) => task.worker_definition_id),
      ...workerRuns.map((workerRun) => workerRun.worker_definition_id),
    ]),
  ];
  let workerDefinitions: WorkerDefinitionRecord[] = [];

  if (workerDefinitionIds.length) {
    const workerDefinitionResult = await context.supabase
      .from("worker_definitions")
      .select("id, worker_key, version, name, role, status")
      .in("id", workerDefinitionIds);
    workerDefinitions = rows<WorkerDefinitionRecord>(workerDefinitionResult.data);
    if (workerDefinitionResult.error) errors.push(errorMessage(workerDefinitionResult.error));
  }

  return {
    run,
    errors,
    business: row<BusinessRecord>(businessResult.data),
    definition: row<WorkflowDefinitionRecord>(definitionResult.data),
    stages: rows<WorkflowStageRecord>(stageResult.data),
    events: rows<WorkflowEventRecord>(eventResult.data),
    interventions: rows<OwnerInterventionRecord>(interventionResult.data),
    tasks,
    workerRuns,
    workerDefinitions,
    artifacts: rows<ArtifactRecord>(artifactResult.data),
  };
}
