import "server-only";
import { historyQuery, historyPage, type HistoryPage } from "./history-query";
import type { OwnerUiContext } from "./data";
import type { ArtifactRecord, BusinessRecord, OwnerInterventionRecord, TaskContractRecord, WorkerDefinitionRecord, WorkerRunRecord, WorkflowDefinitionRecord, WorkflowRunRecord, WorkflowStageRecord } from "./workflows";
import type { RunOutcomeCosts } from "./run-outcome";
import { loadRunCostData } from "./run-outcome-data";
import { consoleCollectionQuery, type ConsoleCollectionSelection } from "./console-collections-query";
import { CONSOLE_RUN_SELECT, CONSOLE_DEFINITION_SELECT, consoleDistinct, consoleExactSelection, consoleExecutionShapeGuard, consoleGuard, consoleObject, consoleRead, consoleRunGuard, consoleScopedIds, consoleValidCount, consoleValidId, consoleValidStatus, consoleValidTimestamp, type ConsoleReadResult } from "./console-collections";

/** A bounded metadata window is not complete execution history. */
export const CONSOLE_WORK_CHILD_LIMIT = 25;
export type ConsoleWorkStage = Pick<WorkflowStageRecord, "id" | "workflow_run_id" | "stage_key" | "sequence" | "attempt" | "status" | "started_at" | "completed_at" | "created_at" | "updated_at">;
export type ConsoleWorkTask = Pick<TaskContractRecord, "id" | "business_id" | "workflow_run_id" | "workflow_stage_run_id" | "worker_definition_id" | "status" | "objective" | "created_at" | "updated_at">;
export type ConsoleWorkWorker = Pick<WorkerRunRecord, "id" | "business_id" | "workflow_run_id" | "task_contract_id" | "worker_definition_id" | "status" | "started_at" | "completed_at" | "created_at" | "updated_at">;
export type ConsoleWorkIntervention = Pick<OwnerInterventionRecord, "id" | "business_id" | "workflow_run_id" | "intervention_type" | "status" | "title" | "description" | "requested_at" | "resolved_at" | "created_at" | "updated_at">;
export type ConsoleWorkArtifact = Omit<ArtifactRecord, "content" | "metadata">;
export type ConsoleWorkCompleteness = { total: number | null; loaded: number; limit: number; complete: boolean; hasMore: boolean | null; errors: string[] };
export type ConsoleWorkResearch = {
  status: "found" | "not-loaded" | "missing" | "unavailable";
  /** Legacy experiment identity, not canonical Quest identity. */
  experiment: { id: string; business_id: string; workflow_run_id: string; discovery_version: string | null; parent_discovery_id: string | null; status: string; created_at: string } | null;
};
export type ConsoleWorkDetailData = {
  pages?: Record<string,HistoryPage>;
  selection: ConsoleCollectionSelection<WorkflowRunRecord>; run: WorkflowRunRecord | null;
  business: BusinessRecord | null; definition: WorkflowDefinitionRecord | null;
  stages: ConsoleWorkStage[]; tasks: ConsoleWorkTask[]; workerRuns: ConsoleWorkWorker[]; workerDefinitions: WorkerDefinitionRecord[];
  interventions: ConsoleWorkIntervention[]; artifacts: ConsoleWorkArtifact[];
  artifactSelection: ConsoleCollectionSelection<ArtifactRecord>;
  completeness: Record<"stages" | "tasks" | "workers" | "workerDefinitions" | "interventions" | "artifacts", ConsoleWorkCompleteness>;
  costs: RunOutcomeCosts | null; research: ConsoleWorkResearch; complete: boolean; errors: string[];
};
const STAGE = "id,workflow_run_id,stage_key,sequence,attempt,status,started_at,completed_at,created_at,updated_at";
const TASK = "id,business_id,workflow_run_id,workflow_stage_run_id,worker_definition_id,status,objective,created_at,updated_at";
const WORKER = "id,business_id,workflow_run_id,task_contract_id,worker_definition_id,status,started_at,completed_at,created_at,updated_at";
const INTERVENTION = "id,business_id,workflow_run_id,intervention_type,status,title,description,requested_at,resolved_at,created_at,updated_at";
const ARTIFACT_METADATA = "id,business_id,workflow_run_id,task_contract_id,artifact_type,name,media_type,storage_path,created_at,updated_at";
const EXPERIMENT = "id,business_id,workflow_run_id,discovery_version,parent_discovery_id,status,created_at";
type Window<T> = { items: T[]; completeness: ConsoleWorkCompleteness };
function unavailable(label: string, limit = CONSOLE_WORK_CHILD_LIMIT): ConsoleWorkCompleteness { return { total: null, loaded: 0, limit, complete: false, hasMore: null, errors: [`${label} could not be verified completely.`] }; }
function windowResult<T extends { id: string }>(result: ConsoleReadResult, guard: (row: T) => boolean, label: string, limit = CONSOLE_WORK_CHILD_LIMIT, offset=0): Window<T> {
  const invalid = (): Window<T> => ({ items: [], completeness: unavailable(label, limit) });
  if (result.error || !Array.isArray(result.data) || result.data.length > limit + 1 || !result.data.every(row => consoleGuard(guard, row as T)) || new Set(result.data.map(row => row?.id)).size !== result.data.length) return invalid();
  const raw = result.data as T[], count = consoleValidCount(result.count) ? result.count : null;
  const matched = count !== null && raw.length === Math.min(limit + 1, Math.max(0,count-offset));
  const complete = matched && offset===0 && count <= limit, items = raw.slice(0, limit);
  return { items, completeness: { total: matched ? count : null, loaded: items.length, limit, complete,
    hasMore: raw.length > limit ? true : matched ? false : null,
    errors: complete ? [] : [matched ? `${label} is limited to ${limit} saved records; complete history is not loaded.` : `${label} completeness could not be verified.`] } };
}
function blank(selection: ConsoleCollectionSelection<WorkflowRunRecord>, errors: string[]): ConsoleWorkDetailData {
  return { selection, run: null, business: null, definition: null, stages: [], tasks: [], workerRuns: [], workerDefinitions: [], interventions: [], artifacts: [], artifactSelection: { status: "none", item: null },
    completeness: { stages: unavailable("Stages"), tasks: unavailable("Tasks"), workers: unavailable("Worker runs"), workerDefinitions: unavailable("Worker definitions", 200), interventions: unavailable("Decisions"), artifacts: unavailable("Artifacts") },
    costs: null, research: { status: "not-loaded", experiment: null }, complete: false, errors };
}
/** Exact read-only detail. No legacy unbounded detail loader, sample-based latest/none inference,
 * RPC, action, provider or storage calls. Artifact bytes are fetched only by explicit exact ID. */
export async function loadConsoleWorkDetail(context: OwnerUiContext, runId: string, options: { businessId?: string; artifactId?: string } = {}): Promise<ConsoleWorkDetailData> {
  const q = consoleCollectionQuery("work", { ...options, selectedId: runId }), ids = await consoleScopedIds(context, q.businessId);
  const selection = await consoleExactSelection<WorkflowRunRecord>(context, "workflow_runs", CONSOLE_RUN_SELECT, runId, ids, consoleRunGuard);
  if (selection.status !== "found") return blank(selection, [selection.status === "missing" ? "Selected work is not available." : "Selected work could not be verified."]);
  const run = selection.item, client = context.supabase, errors: string[] = [];
  const sameRun = (row: { id: string; business_id: string; workflow_run_id: string | null }) => consoleValidId(row.id) && row.business_id === run.business_id && row.workflow_run_id === run.id;
  const keyFor=(table:string)=>({task_contracts:"task",worker_runs:"worker",owner_interventions:"intervention",artifacts:"artifact",workflow_stage_runs:"stage"}[table] ?? table);
  const childQuery=(table:string)=>historyQuery(context.readSearch,keyFor(table));
  const metadata = (table: string, columns: string, time = "created_at") => client.from(table).select(columns, { count: "exact" }).eq("business_id", run.business_id).eq("workflow_run_id", run.id).order(time, { ascending: false }).order("id", { ascending: false }).range(childQuery(table).offset,childQuery(table).offset+CONSOLE_WORK_CHILD_LIMIT);
  const [definitionResult, stageResult, taskResult, workerResult, interventionResult, artifactResult, artifactSelection] = await Promise.all([
    consoleRead(client.from("workflow_definitions").select(CONSOLE_DEFINITION_SELECT, { count: "exact" }).eq("id", run.workflow_definition_id).limit(2)),
    // Stages inherit Business ownership from the independently verified exact parent run.
    consoleRead(client.from("workflow_stage_runs").select(STAGE, { count: "exact" }).eq("workflow_run_id", run.id).order("sequence", { ascending: true }).order("attempt", { ascending: true }).order("id", { ascending: true }).range(childQuery("workflow_stage_runs").offset,childQuery("workflow_stage_runs").offset+CONSOLE_WORK_CHILD_LIMIT)),
    consoleRead(metadata("task_contracts", TASK)), consoleRead(metadata("worker_runs", WORKER)),
    consoleRead(metadata("owner_interventions", INTERVENTION, "requested_at")), consoleRead(metadata("artifacts", ARTIFACT_METADATA)),
    consoleExactSelection<ArtifactRecord>(context, "artifacts", `${ARTIFACT_METADATA},metadata,content`, q.artifactId, [run.business_id], row => sameRun(row) && typeof row.artifact_type === "string" && (row.content === null || consoleObject(row.content)), run.id),
  ]);
  const definitionWindow = windowResult<WorkflowDefinitionRecord>(definitionResult, row => row.id === run.workflow_definition_id && typeof row.name === "string" && typeof row.workflow_key === "string", "Workflow definition", 1);
  const definition = definitionWindow.completeness.complete && definitionWindow.items.length === 1 ? definitionWindow.items[0] : null;
  if (!definition) errors.push("The exact workflow definition is unavailable.");
  const stages = windowResult<ConsoleWorkStage>(stageResult, row => consoleValidId(row.id) && row.workflow_run_id === run.id && consoleExecutionShapeGuard(row) && typeof row.stage_key === "string" && Number.isSafeInteger(row.attempt) && row.attempt >= 0 && Number.isSafeInteger(row.sequence), "Stages",CONSOLE_WORK_CHILD_LIMIT,childQuery("workflow_stage_runs").offset);
  const tasks = windowResult<ConsoleWorkTask>(taskResult, row => sameRun(row) && consoleValidStatus(row.status) && consoleValidTimestamp(row.created_at) && consoleValidTimestamp(row.updated_at) && consoleValidId(row.workflow_stage_run_id) && consoleValidId(row.worker_definition_id) && typeof row.objective === "string", "Tasks",CONSOLE_WORK_CHILD_LIMIT,childQuery("task_contracts").offset);
  const workers = windowResult<ConsoleWorkWorker>(workerResult, row => sameRun(row) && consoleExecutionShapeGuard(row) && consoleValidId(row.task_contract_id) && consoleValidId(row.worker_definition_id), "Worker runs",CONSOLE_WORK_CHILD_LIMIT,childQuery("worker_runs").offset);
  const interventions = windowResult<ConsoleWorkIntervention>(interventionResult, row => sameRun(row) && typeof row.title === "string" && consoleValidStatus(row.status), "Decisions",CONSOLE_WORK_CHILD_LIMIT,childQuery("owner_interventions").offset);
  const artifacts = windowResult<ConsoleWorkArtifact>(artifactResult, row => sameRun(row) && typeof row.artifact_type === "string" && typeof row.name === "string" && !Object.hasOwn(row, "content") && !Object.hasOwn(row, "metadata"), "Artifact metadata",CONSOLE_WORK_CHILD_LIMIT,childQuery("artifacts").offset);
  const workerIds = consoleDistinct([...tasks.items, ...workers.items].map(row => row.worker_definition_id));
  const workerDefinitions = workerIds.length ? windowResult<WorkerDefinitionRecord>(await consoleRead(client.from("worker_definitions").select("id,worker_key,version,name,role,status", { count: "exact" }).in("id", workerIds).order("id", { ascending: true }).limit(workerIds.length + 1)),
    row => consoleValidId(row.id) && workerIds.includes(row.id) && typeof row.name === "string", "Worker definitions", workerIds.length) : { items: [], completeness: { total: 0, loaded: 0, limit: 0, complete: true, hasMore: false, errors: [] } };
  if (workerDefinitions.items.length !== workerIds.length) { workerDefinitions.completeness.complete = false; workerDefinitions.completeness.errors.push("Some referenced worker definitions are unavailable."); }
  if (artifactSelection.status === "unavailable" || artifactSelection.status === "missing") errors.push("The selected artifact is unavailable for this exact Work run and Business.");
  // Costs retain the established bounded (1000 plus sentinel) ledger semantics.
  const costs: RunOutcomeCosts = definition ? (await loadRunCostData(context, run, definition)).costs : { businessId: run.business_id, workflowRunId: run.id, source: "model", calls: { status: "unavailable" } };
  if (costs.calls.status === "unavailable") errors.push("Complete cost records are unavailable; no zero-cost conclusion can be made.");
  let research: ConsoleWorkResearch = { status: "not-loaded", experiment: null };
  const intentId = run.input?.intentId;
  if (definition?.workflow_key.startsWith("product.discovery-v2.") && intentId !== undefined) {
    if (!consoleValidId(intentId)) research = { status: "unavailable", experiment: null };
    else {
      const exact = await consoleExactSelection<NonNullable<ConsoleWorkResearch["experiment"]>>(context, "product_experiments", EXPERIMENT, intentId, [run.business_id], row => sameRun(row) && typeof row.status === "string", run.id);
      research = exact.status === "found" ? { status: "found", experiment: exact.item } : { status: exact.status === "missing" ? "missing" : "unavailable", experiment: null };
    }
    if (research.status !== "found") errors.push("Exact legacy research context could not be verified.");
  } else if (definition?.workflow_key.startsWith("product.discovery-v2.")) errors.push("Exact legacy research context is not loaded.");
  const completeness = { stages: stages.completeness, tasks: tasks.completeness, workers: workers.completeness, workerDefinitions: workerDefinitions.completeness, interventions: interventions.completeness, artifacts: artifacts.completeness };
  for (const part of Object.values(completeness)) errors.push(...part.errors);
  const pages=Object.fromEntries([["stage",stageResult],["task",taskResult],["worker",workerResult],["intervention",interventionResult],["artifact",artifactResult]].map(([key,result])=>{const value=result as ConsoleReadResult;return [String(key),historyPage(historyQuery(context.readSearch,String(key)),{...value,data:Array.isArray(value.data)?value.data.slice(0,CONSOLE_WORK_CHILD_LIMIT):value.data})];}));
  return { pages, selection, run, business: context.businesses.find(business => business.id === run.business_id) ?? null, definition,
    stages: stages.items, tasks: tasks.items, workerRuns: workers.items, workerDefinitions: workerDefinitions.items, interventions: interventions.items, artifacts: artifacts.items,
    artifactSelection, completeness, costs, research, complete: !errors.length, errors: consoleDistinct(errors) };
}
