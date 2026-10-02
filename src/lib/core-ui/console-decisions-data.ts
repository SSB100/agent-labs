import "server-only";
import { createHash } from "node:crypto";
import { canAcknowledgeTerminalCreativeReview, isTerminalCreativeReviewAcknowledgement, type TerminalReviewState } from "../../creative/terminal-review";
import type { OwnerUiContext } from "./data";
import type { OwnerInterventionRecord, WorkflowRunRecord, WorkflowDefinitionRecord, WorkflowStageRecord } from "./workflows";
import { loadRunCostData, type RunCostData } from "./run-outcome-data";
import type { OutcomeRecords } from "./run-outcome";
import { CONSOLE_DECISION_UUID, consoleDecisionQuery, type ConsoleDecisionOptions, type ConsoleDecisionQuery } from "./console-decisions-query";

const INTERVENTION = "id,business_id,workflow_run_id,action_intent_id,intervention_type,status,title,description,options,resolution,requested_at,resolved_at,created_at,updated_at";
const RUN = "id,business_id,workflow_definition_id,status,current_stage_key,input,state,runtime_provider,runtime_run_id,started_at,completed_at,created_at,updated_at";
const DEFINITION = "id,workflow_key,version,name,description,status,stage_definition";
const STAGE = "id,workflow_run_id,stage_key,sequence,attempt,status,failure,started_at,completed_at,created_at,updated_at";
export type DecisionEvidence = { id: string; business_id: string; workflow_run_id: string; artifact_type: string; name: string; created_at: string };
export type DecisionApproval = { id: string; business_id: string; purpose: string; snapshot: Record<string, unknown> };
export type DecisionRetainedSource = { callKey: string; mediaType: "image/png" | "image/webp"; bytes: number; downloadVerified: boolean };
export type ConsoleDecisionSelection = { status: "none" | "missing" | "unavailable"; item: null } | { status: "found"; item: OwnerInterventionRecord };
export type ConsoleDecisionDetail = {
  interventionId: string; acknowledgement: { eligible: boolean; reviewed: boolean }; run: WorkflowRunRecord | null; definition: WorkflowDefinitionRecord | null;
  stages: OutcomeRecords<WorkflowStageRecord>; evidence: OutcomeRecords<DecisionEvidence>;
  approval: OutcomeRecords<DecisionApproval>; retainedSources: OutcomeRecords<DecisionRetainedSource>; costData: RunCostData | null;
};
export type ConsoleDecisionPage = {
  query: ConsoleDecisionQuery;
  page: { items: OwnerInterventionRecord[]; page: number; pageSize: number; total: number | null; complete: boolean; hasPrevious: boolean; hasNext: boolean | null };
  selection: ConsoleDecisionSelection; runs: WorkflowRunRecord[]; definitions: WorkflowDefinitionRecord[];
  detail: ConsoleDecisionDetail | null; errors: string[];
};
type ReadResult = { data: unknown; count?: number | null; error: unknown };
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const unique = (values: string[]) => [...new Set(values)];
const validCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
async function read(query: PromiseLike<ReadResult>): Promise<ReadResult> { try { return await query; } catch { return { data: null, count: null, error: true }; } }
function complete<T>(result: ReadResult, maximum: number, guard: (row: T) => boolean): OutcomeRecords<T> {
  if (result.error || !Array.isArray(result.data) || result.count !== result.data.length || result.data.length > maximum) return { status: "unavailable" };
  try { return result.data.every(row => object(row) && guard(row as T)) ? { status: "ready", records: result.data as T[] } : { status: "unavailable" }; }
  catch { return { status: "unavailable" }; }
}
const rows = <T,>(value: OutcomeRecords<T>): T[] => value.status === "ready" ? [...value.records] : [];
function validIntervention(row: OwnerInterventionRecord, ids: string[]): boolean {
  return CONSOLE_DECISION_UUID.test(row.id) && ids.includes(row.business_id) && (row.workflow_run_id === null || CONSOLE_DECISION_UUID.test(row.workflow_run_id)) &&
    object(row.resolution) && typeof row.intervention_type === "string" && typeof row.title === "string" && typeof row.description === "string" && typeof row.updated_at === "string";
}
/** Queue-first exact count and deterministic 25-row paging, independent of any recent-run window. */
export async function loadConsoleDecisionPage(context: OwnerUiContext, options: ConsoleDecisionOptions = {}): Promise<ConsoleDecisionPage> {
  const query = consoleDecisionQuery(options), owned = unique(context.businesses.map(row => row.id));
  if (!context.businessesUnavailable && query.businessId && !owned.includes(query.businessId)) throw new Error("Business selection is not available.");
  const ids = query.businessId ? owned.filter(id => id === query.businessId) : owned;
  const empty = (unavailable: boolean): ConsoleDecisionPage => ({ query, page: { items: [], page: query.page, pageSize: query.pageSize, total: unavailable ? null : 0, complete: !unavailable, hasPrevious: query.page > 1, hasNext: unavailable ? null : false },
    selection: { status: query.selectedId ? unavailable ? "unavailable" : "missing" : "none", item: null }, runs: [], definitions: [], detail: null, errors: unavailable ? ["Business records could not be checked."] : [] });
  if (context.businessesUnavailable || !ids.length) return empty(Boolean(context.businessesUnavailable));
  const db = context.supabase;
  let pageQuery = db.from("owner_interventions").select(INTERVENTION, { count: "exact" }).in("business_id", ids);
  if (query.status !== "all") pageQuery = pageQuery.eq("status", query.status);
  const [result, selectedResult] = await Promise.all([
    read(pageQuery.order("requested_at", { ascending: false }).order("id", { ascending: false }).range(query.offset, query.offset + query.pageSize)),
    query.selectedId ? read(db.from("owner_interventions").select(INTERVENTION, { count: "exact" }).in("business_id", ids).eq("id", query.selectedId).limit(2)) : null,
  ]);
  const raw = !result.error && Array.isArray(result.data) ? result.data as OwnerInterventionRecord[] : [];
  const valid = !result.error && Array.isArray(result.data) && raw.length <= query.pageSize + 1 && raw.every(row => object(row) && validIntervention(row, ids) && (query.status === "all" || row.status === query.status));
  const count = validCount(result.count) ? result.count : null;
  const expected = count === null ? null : Math.min(query.pageSize + 1, Math.max(0, count - query.offset));
  const pageComplete = valid && expected !== null && raw.length === expected;
  const items = valid ? raw.slice(0, query.pageSize) : [];
  const errors = pageComplete ? [] : ["Decision page completeness could not be checked. Missing records are not an empty queue."];
  let selection: ConsoleDecisionSelection = { status: "none", item: null };
  if (selectedResult && query.selectedId) {
    const selected = complete<OwnerInterventionRecord>(selectedResult, 1, row => validIntervention(row, ids) && row.id === query.selectedId);
    selection = selected.status !== "ready" ? { status: "unavailable", item: null } : selected.records.length ? { status: "found", item: selected.records[0] } : { status: "missing", item: null };
    if (selection.status === "unavailable") errors.push("The selected notice could not be checked.");
  }
  const requests = selection.status === "found" && !items.some(row => row.id === selection.item.id) ? [...items, selection.item] : items;
  const runIds = unique(requests.flatMap(row => row.workflow_run_id ? [row.workflow_run_id] : []));
  const runRead = runIds.length ? complete<WorkflowRunRecord>(await read(db.from("workflow_runs").select(RUN, { count: "exact" }).in("business_id", ids).in("id", runIds).limit(runIds.length + 1)), runIds.length,
    row => CONSOLE_DECISION_UUID.test(row.id) && requests.some(request => request.workflow_run_id === row.id && request.business_id === row.business_id)) : { status: "ready" as const, records: [] };
  const runs = rows(runRead), definitionIds = unique(runs.map(run => run.workflow_definition_id));
  const definitionRead = definitionIds.length ? complete<WorkflowDefinitionRecord>(await read(db.from("workflow_definitions").select(DEFINITION, { count: "exact" }).in("id", definitionIds).limit(definitionIds.length + 1)), definitionIds.length,
    row => definitionIds.includes(row.id)) : { status: "ready" as const, records: [] };
  const definitions = rows(definitionRead);
  if (runRead.status !== "ready" || requests.some(request => request.workflow_run_id && !runs.some(run => run.id === request.workflow_run_id))) errors.push("Some saved workflow context could not be checked.");
  if (definitionRead.status !== "ready") errors.push("Workflow names could not be checked.");
  const detail = selection.status === "found" ? await selectedDetail(context, selection.item, runs, definitions) : null;
  return { query, page: { items, page: query.page, pageSize: query.pageSize, total: valid && (expected === null || raw.length === expected) ? count : null, complete: pageComplete, hasPrevious: query.page > 1, hasNext: valid && raw.length > query.pageSize ? true : pageComplete ? query.offset + items.length < count! : null }, selection, runs, definitions, detail, errors };
}
async function selectedDetail(context: OwnerUiContext, request: OwnerInterventionRecord, runs: WorkflowRunRecord[], definitions: WorkflowDefinitionRecord[]): Promise<ConsoleDecisionDetail> {
  const run = runs.find(row => row.id === request.workflow_run_id && row.business_id === request.business_id) ?? null;
  const definition = definitions.find(row => row.id === run?.workflow_definition_id) ?? null;
  const unavailable = { status: "unavailable" as const };
  const detail: ConsoleDecisionDetail = { interventionId: request.id, acknowledgement: { eligible: false, reviewed: false }, run, definition, stages: unavailable, evidence: unavailable, approval: unavailable, retainedSources: unavailable, costData: null };
  if (!run) return detail;
  const db = context.supabase;
  const [stages, evidence, costData, workers, tasks, actionIntents] = await Promise.all([
    read(db.from("workflow_stage_runs").select(STAGE, { count: "exact" }).eq("workflow_run_id", run.id).order("sequence", { ascending: true }).order("attempt", { ascending: true }).limit(101)),
    read(db.from("artifacts").select("id,business_id,workflow_run_id,artifact_type,name,created_at", { count: "exact" }).eq("business_id", run.business_id).eq("workflow_run_id", run.id).order("created_at", { ascending: false }).limit(101)),
    loadRunCostData(context, run, definition),
    ...["worker_runs", "task_contracts", "action_intents"].map(table => read(db.from(table).select(`business_id,workflow_run_id,status${table === "worker_runs" ? ",completed_at" : ""}`, { count: "exact" }).eq("business_id", run.business_id).eq("workflow_run_id", run.id).limit(101))),
  ]);
  const checkedStages = complete<WorkflowStageRecord>(stages, 100, row => row.workflow_run_id === run.id);
  detail.stages = checkedStages.status !== "ready" ? checkedStages : { status: "ready", records: checkedStages.records.map(row => ({ ...row, failure: { reason: typeof row.failure?.reason === "string" ? row.failure.reason : "Saved failure reason unavailable" } })) };
  detail.evidence = complete<DecisionEvidence>(evidence, 100, row => row.business_id === run.business_id && row.workflow_run_id === run.id && CONSOLE_DECISION_UUID.test(row.id));
  // An unavailable workflow definition cannot establish which exclusive cost ledger applies.
  detail.costData = definition ? costData : { costs: { businessId: run.business_id, workflowRunId: run.id, source: "model", calls: unavailable } };
  const creativeRun = costData.creativeRuns?.status === "ready" && costData.creativeRuns.records.length === 1 ? costData.creativeRuns.records[0] : null;
  if (!creativeRun || creativeRun.business_id !== run.business_id || creativeRun.workflow_run_id !== run.id) return detail;
  const [approval, settlements] = await Promise.all([
    read(db.from("creative_approvals").select("id,business_id,purpose,snapshot", { count: "exact" }).eq("business_id", run.business_id).eq("id", creativeRun.approval_id).limit(2)),
    read(db.from("creative_cost_settlements").select("business_id,creative_run_id,call_key,receipt", { count: "exact" }).eq("business_id", run.business_id).eq("creative_run_id", creativeRun.id).limit(101)),
  ]);
  detail.approval = complete<DecisionApproval>(approval, 1, row => row.id === creativeRun.approval_id && row.business_id === run.business_id && object(row.snapshot));
  const receipts = complete<{ business_id: string; creative_run_id: string; call_key: string; receipt: Record<string, unknown> }>(settlements, 100, row => row.business_id === run.business_id && row.creative_run_id === creativeRun.id && object(row.receipt));
  detail.retainedSources = receipts.status !== "ready" ? unavailable : { status: "ready", records: receipts.records.flatMap(row => {
    const source = row.receipt.sourcePreservation;
    if (row.receipt.outputValidated !== false || !/^generate:[12]$/.test(row.call_key) || !object(source) || source.uploadConfirmed !== true ||
      !["image/png", "image/webp"].includes(String(source.mediaType)) || typeof source.bytes !== "number" || !Number.isSafeInteger(source.bytes) || source.bytes < 12 || source.bytes > 7_000_000 ||
      typeof source.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(source.sha256) || source.storagePath !== `${run.business_id}/${creativeRun.id}/version-${row.call_key.split(":")[1]}${source.mediaType === "image/webp" ? ".original.webp" : ".png"}`) return [];
    return [{ callKey: row.call_key, mediaType: source.mediaType as "image/png" | "image/webp", bytes: source.bytes, downloadVerified: source.downloadVerified === true }];
  }) };
  const terminalRecords = [workers, tasks, actionIntents].map(result => complete<TerminalReviewState>(result, 100, row => row.business_id === run.business_id && row.workflow_run_id === run.id));
  const hash = createHash("md5").update(`creative:needs-owner:${creativeRun.id}`).digest("hex");
  const expectedNoticeId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  const confirmedCreativeRun = { ...creativeRun, workflow_run_id: run.id };
  const approvalRead = detail.approval;
  detail.acknowledgement = {
    eligible: "action_intent_id" in request && request.action_intent_id === null && approvalRead.status === "ready" && approvalRead.records.length === 1 && approvalRead.records[0].purpose === "technical_qualification" && canAcknowledgeTerminalCreativeReview({
      intervention: { ...request, action_intent_id: null }, run, definition, creativeRun: confirmedCreativeRun, expectedNoticeId,
      complete: detail.stages.status === "ready" && terminalRecords.every(result => result.status === "ready"),
      stages: rows(detail.stages), workers: rows(terminalRecords[0]), tasks: rows(terminalRecords[1]), actionIntents: rows(terminalRecords[2]),
    }),
    reviewed: isTerminalCreativeReviewAcknowledgement({ intervention: request, run, creativeRunId: creativeRun.id, ownerUserId: context.userId }),
  };
  return detail;
}
