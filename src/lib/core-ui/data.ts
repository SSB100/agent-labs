import { historyQuery, historyPage, type HistoryPage } from "./history-query";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";

import { ownerLoginPath } from "@/core/owner-entry";
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
  /** Paged directory is never the authority boundary for owner-wide collections. */
  businessDirectory?: HistoryPage;
  ownerDirectoryPaged?: boolean;
  readSearch?: string;
  readPath?: string;
  scopeBusinessId?: string;
};

export type WorkflowCollection = {
  /** Exact owner-scoped run count, separate from the bounded loaded window. */
  runCount?: number | null;
  truncated?: boolean;
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

  if (claimsError || !userId) {
    redirect(ownerLoginPath("session-required", (await headers()).get("x-agent-labs-return-path")));
  }

  const path = (await headers()).get("x-agent-labs-return-path") ?? "/dashboard";
  const requestUrl = new URL(path, "https://owner.invalid");
  const directoryQuery = historyQuery(requestUrl.search, "business");
  const explicitBusiness = requestUrl.searchParams.get("business");
  if(requestUrl.searchParams.getAll("business").length>1)notFound();
  if (explicitBusiness && !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(explicitBusiness)) notFound();
  let directory = supabase.from("businesses").select("id,name,created_at,updated_at", { count: "exact" }).eq("owner_user_id", userId);
  if (directoryQuery.query) directory = directory.ilike("name", `%${directoryQuery.query.replace(/[\\%_]/g, "\\$&")}%`);
  const [businessResult, profileResult, interventionCountResult, selectedBusinessResult] = await Promise.all([
    directory.order("created_at", { ascending: false }).order("id", { ascending: false }).range(directoryQuery.offset, directoryQuery.offset + directoryQuery.pageSize - 1),
    supabase.from("profiles").select("display_name").eq("id", userId).maybeSingle(),
    supabase
      .from("owner_interventions")
      .select("id", { count: "exact", head: true })
      .eq("status", "open"),
    explicitBusiness ? supabase.from("businesses").select("id,name,created_at,updated_at").eq("owner_user_id", userId).eq("id", explicitBusiness).maybeSingle() : null,
  ]);

  const businesses = [...rows<BusinessRecord>(businessResult.data)];
  if (selectedBusinessResult?.error) throw new Error("Selected Business is temporarily unavailable");
  if (explicitBusiness && !selectedBusinessResult?.data) notFound();
  const selectedBusiness = row<BusinessRecord>(selectedBusinessResult?.data);
  if (selectedBusiness && !businesses.some(b => b.id === selectedBusiness.id)) businesses.push(selectedBusiness);
  const email = typeof claims.email === "string" ? claims.email : "Owner";
  const profile = row<{ display_name?: unknown }>(profileResult.data);
  const profileName = profile?.display_name;
  const displayName =
    typeof profileName === "string" && profileName.trim() ? profileName.trim() : email;

  const decisionCount = interventionCountResult.count;
  const decisionCountVerified = !interventionCountResult.error && typeof decisionCount === "number" && Number.isSafeInteger(decisionCount) && decisionCount >= 0;

  return {
    supabase,
    userId,
    email,
    displayName,
    businesses,
    needsYouCount: decisionCountVerified ? decisionCount : 0,
    needsYouUnavailable: !decisionCountVerified,
    businessesUnavailable: Boolean(businessResult.error),
    businessDirectory: historyPage(directoryQuery, businessResult), ownerDirectoryPaged: true,
    readSearch: requestUrl.search, readPath: requestUrl.pathname,
  };
}

export async function loadWorkflowCollection(
  context: OwnerUiContext,
  options: { limit?: number; statuses?: string[] } = {},
): Promise<WorkflowCollection> {
  const businessIds = context.scopeBusinessId ? [context.scopeBusinessId] : context.ownerDirectoryPaged ? null : context.businesses.map((business) => business.id);
  if (businessIds?.length===0) return { ...EMPTY_COLLECTION, errors: context.businessesUnavailable ? ["Business records could not be loaded"] : [] };

  const runLimit = Math.max(1, Math.min(200, options.limit ?? 60));
  let baseRunQuery = context.supabase
    .from("workflow_runs")
    .select(WORKFLOW_RUN_SELECT, { count: "exact" })
    .order("created_at", { ascending: false }).order("id",{ascending:false})
    .limit(runLimit);
  if(businessIds!==null)baseRunQuery=baseRunQuery.in("business_id",businessIds);
  const runResult = options.statuses?.length
    ? await baseRunQuery.in("status", options.statuses)
    : await baseRunQuery;
  const runs = rows<WorkflowRunRecord>(runResult.data);
  // A newer terminal history page cannot hide the current open workflow.
  let activeUnavailable=false;
  if(context.ownerDirectoryPaged && !options.statuses?.length){
    let activeQuery=context.supabase.from("workflow_runs").select(WORKFLOW_RUN_SELECT,{count:"exact"}).in("status",["queued","running","waiting","review","needs_owner"]).is("completed_at",null).order("updated_at",{ascending:false}).order("id",{ascending:false}).limit(1);
    if(businessIds!==null)activeQuery=activeQuery.in("business_id",businessIds);
    const active=await activeQuery;activeUnavailable=!!active.error || !Number.isSafeInteger(active.count);
    const current=rows<WorkflowRunRecord>(active.data)[0];if(current && !runs.some(r=>r.id===current.id))runs.unshift(current);
  }
  const runCount = typeof runResult.count === "number" ? runResult.count : null;
  const truncated = runCount === null || runCount > runs.length;
  const errors = runResult.error ? [errorMessage(runResult.error)] : [];
  if(activeUnavailable)errors.push("Current open workflow read is unavailable");
  const runIds = runs.map((run) => run.id);
  const definitionIds = [...new Set(runs.map((run) => run.workflow_definition_id))];

  if (!runIds.length) return { ...EMPTY_COLLECTION, runs, errors, runCount, truncated };

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
      .select(WORKFLOW_DEFINITION_SELECT,{count:"exact"})
      .in("id", definitionIds).limit(201),
    context.supabase
      .from("workflow_stage_runs")
      .select(STAGE_SELECT,{count:"exact"})
      .in("workflow_run_id", runIds)
      .order("sequence", { ascending: true })
      .order("attempt", { ascending: true }).order("id").limit(301),
    context.supabase
      .from("events")
      .select(EVENT_SELECT,{count:"exact"})
      .in("workflow_run_id", runIds)
      .order("occurred_at", { ascending: false })
      .limit(300),
    context.supabase
      .from("owner_interventions")
      .select(INTERVENTION_SELECT,{count:"exact"})
      .in("workflow_run_id", runIds)
      .order("requested_at", { ascending: false }).order("id",{ascending:false}).limit(301),
    context.supabase
      .from("task_contracts")
      .select(TASK_SELECT,{count:"exact"})
      .in("workflow_run_id", runIds)
      .order("created_at", { ascending: false }).order("id",{ascending:false}).limit(301),
    context.supabase
      .from("worker_runs")
      .select(WORKER_RUN_SELECT,{count:"exact"})
      .in("workflow_run_id", runIds)
      .order("created_at", { ascending: false }).order("id",{ascending:false}).limit(301),
    context.supabase
      .from("artifacts")
      .select(ARTIFACT_SELECT,{count:"exact"})
      .in("workflow_run_id", runIds)
      .order("created_at", { ascending: false }).order("id",{ascending:false}).limit(301),
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
    else if(result.count!==rows(result.data).length)errors.push("Related workflow records are partial or unavailable");
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
      .in("id", workerDefinitionIds).limit(401);
    workerDefinitions = rows<WorkerDefinitionRecord>(workerDefinitionResult.data);
    if (workerDefinitionResult.error) errors.push(errorMessage(workerDefinitionResult.error));
  }

  return {
    runs,
    runCount,
    truncated,
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
      .select(WORKFLOW_DEFINITION_SELECT,{count:"exact"})
      .eq("id", run.workflow_definition_id)
      .maybeSingle(),
    context.supabase
      .from("workflow_stage_runs")
      .select(STAGE_SELECT,{count:"exact"})
      .eq("workflow_run_id", run.id)
      .order("sequence", { ascending: true })
      .order("attempt", { ascending: true }).order("id").limit(301),
    context.supabase
      .from("events")
      .select(EVENT_SELECT,{count:"exact"})
      .eq("workflow_run_id", run.id)
      .order("occurred_at", { ascending: false })
      .limit(100),
    context.supabase
      .from("owner_interventions")
      .select(INTERVENTION_SELECT,{count:"exact"})
      .eq("workflow_run_id", run.id)
      .order("requested_at", { ascending: false }).order("id",{ascending:false}).limit(301),
    context.supabase
      .from("task_contracts")
      .select(TASK_SELECT,{count:"exact"})
      .eq("workflow_run_id", run.id)
      .order("created_at", { ascending: false }).order("id",{ascending:false}).limit(301),
    context.supabase
      .from("worker_runs")
      .select(WORKER_RUN_SELECT,{count:"exact"})
      .eq("workflow_run_id", run.id)
      .order("created_at", { ascending: false }).order("id",{ascending:false}).limit(301),
    context.supabase
      .from("artifacts")
      .select(ARTIFACT_SELECT,{count:"exact"})
      .eq("workflow_run_id", run.id)
      .order("created_at", { ascending: false }).order("id",{ascending:false}).limit(301),
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
      .in("id", workerDefinitionIds).limit(401);
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
