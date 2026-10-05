import "server-only";
import { verifyOwnerBusiness } from "./owner-business";
import type { OwnerUiContext } from "./data";
import type { WorkflowRunRecord, WorkflowDefinitionRecord, WorkflowEventRecord } from "./workflows";
import { consoleCollectionQuery, consoleSearchPattern, CONSOLE_COLLECTION_UUID, type ConsoleCollectionOptions, type ConsoleCollectionQuery, type ConsoleCollectionPage, type ConsoleCollectionSelection } from "./console-collections-query";

/** List/context rows deliberately omit unbounded JSON payloads. Exact detail uses full selects. */
export type ConsoleWorkRunMetadata = Omit<WorkflowRunRecord, "input" | "state">;
export type ConsoleWorkflowDefinitionMetadata = Omit<WorkflowDefinitionRecord, "stage_definition">;
export type ConsoleActivityEventMetadata = Omit<WorkflowEventRecord, "payload">;
export const CONSOLE_RUN_METADATA_SELECT = "id,business_id,workflow_definition_id,status,current_stage_key,runtime_provider,runtime_run_id,started_at,completed_at,created_at,updated_at";
export const CONSOLE_RUN_SELECT = `${CONSOLE_RUN_METADATA_SELECT},input,state`;
export const CONSOLE_DEFINITION_METADATA_SELECT = "id,workflow_key,version,name,description,status";
export const CONSOLE_DEFINITION_SELECT = `${CONSOLE_DEFINITION_METADATA_SELECT},stage_definition`;
const EVENT_METADATA = "id,business_id,workflow_run_id,event_type,actor_type,actor_id,occurred_at,created_at";
const EVENT = `${EVENT_METADATA},payload`;
const ACTIVE = ["needs_owner", "queued", "review", "running", "waiting"];
export type ConsoleReadResult = { data: unknown; count?: number | null; error: unknown };
type Query = PromiseLike<ConsoleReadResult> & { order(column: string, options: { ascending: boolean }): Query; range(from: number, to: number): Query; limit(value: number): Query };
export const consoleObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export const consoleValidId = (value: unknown): value is string => typeof value === "string" && CONSOLE_COLLECTION_UUID.test(value);
export const consoleValidCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
/** Unknown future statuses remain inspectable, but missing/blank status is not execution evidence. */
export const consoleValidStatus = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
/** Validate the public-table timestamp shape without coercing undefined, numbers, or date-only text. */
export function consoleValidTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}
export const consoleNullableTimestamp = (value: unknown): value is string | null => value === null || consoleValidTimestamp(value);
export function consoleExecutionShapeGuard(row: { status: unknown; started_at: unknown; completed_at: unknown; created_at: unknown; updated_at: unknown }): boolean {
  return consoleValidStatus(row.status) && consoleNullableTimestamp(row.started_at) && consoleNullableTimestamp(row.completed_at) && consoleValidTimestamp(row.created_at) && consoleValidTimestamp(row.updated_at);
}
export const consoleDistinct = (values: string[]) => [...new Set(values)];
export function consoleGuard<T>(guard: (row: T) => boolean, row: T): boolean { try { return consoleObject(row) && guard(row); } catch { return false; } }
export async function consoleScopedIds(context: OwnerUiContext, businessId: string | null): Promise<string[] | null> {
  businessId ??= context.scopeBusinessId ?? null;
  if (context.businessesUnavailable) throw new Error("Business records are unavailable.");
  const ids = consoleDistinct(context.businesses.map(business => business.id));
  if (!ids.every(consoleValidId)) throw new Error("Business records could not be verified.");
  if (businessId && !(await verifyOwnerBusiness(context,businessId))) throw new Error("Business selection is not available.");
  return businessId ? [businessId] : context.ownerDirectoryPaged ? null : ids;
}
export async function consoleRead(query: PromiseLike<ConsoleReadResult>): Promise<ConsoleReadResult> { try { return await query; } catch { return { data: null, count: null, error: true }; } }
export function consoleEmptyPage<T>(q: ConsoleCollectionQuery, errors: string[] = []): ConsoleCollectionPage<T> {
  return { items: [], page: q.page, pageSize: q.pageSize, total: errors.length ? null : 0, hasPrevious: q.page > 1, hasNext: errors.length ? null : false, complete: !errors.length, errors };
}
function pageResult<T extends { id: string }>(result: ConsoleReadResult, q: ConsoleCollectionQuery, guard: (row: T) => boolean, label: string): ConsoleCollectionPage<T> {
  if (result.error || !Array.isArray(result.data)) return consoleEmptyPage(q, [`${label} could not be loaded.`]);
  const raw = result.data as T[], validRows = raw.length <= q.pageSize + 1 && raw.every(row => consoleGuard(guard, row)) && new Set(raw.map(row => row?.id)).size === raw.length;
  const count = consoleValidCount(result.count) ? result.count : null;
  const expected = count === null ? null : Math.min(q.pageSize + 1, Math.max(0, count - q.offset));
  const complete = validRows && expected !== null && raw.length === expected, items = validRows ? raw.slice(0, q.pageSize) : [];
  return { items, page: q.page, pageSize: q.pageSize, total: validRows && (expected === null || raw.length === expected) ? count : null,
    hasPrevious: q.page > 1, hasNext: validRows && raw.length > q.pageSize ? true : complete ? q.offset + items.length < count! : null, complete,
    errors: complete ? [] : [`${label} page completeness could not be verified.`] };
}
/** Null means the authenticated owner's RLS scope, never a service client. */
export function consoleScopeGuard<T extends { id: string; business_id: string }>(ids: string[] | null) { return (row: T) => consoleValidId(row.id) && consoleValidId(row.business_id) && (ids === null || ids.includes(row.business_id)); }
export function consoleScope<T>(query: T, ids: string[] | null): T { return ids === null ? query : (query as { in(column: string, values: string[]): T }).in("business_id", ids); }
export function consoleRunGuard(run: ConsoleWorkRunMetadata): boolean {
  return consoleValidId(run.id) && consoleValidId(run.business_id) && consoleValidId(run.workflow_definition_id) && consoleExecutionShapeGuard(run);
}
function orderPage(query: Query, q: ConsoleCollectionQuery, column: string): Query { return query.order(column, { ascending: q.sort === "oldest" }).order("id", { ascending: q.sort === "oldest" }).range(q.offset, q.offset + q.pageSize); }
export async function consoleExactSelection<T extends { id: string; business_id: string }>(context: OwnerUiContext, table: string, columns: string, selectedId: string | null, ids: string[] | null, guard: (row: T) => boolean, workflowRunId?: string): Promise<ConsoleCollectionSelection<T>> {
  if (!selectedId) return { status: "none", item: null };
  if (!consoleValidId(selectedId)) throw new Error("Invalid collection identity.");
  if (ids?.length === 0) return { status: "missing", item: null };
  let query = consoleScope(context.supabase.from(table).select(columns, { count: "exact" }), ids).eq("id", selectedId);
  if (workflowRunId) query = query.eq("workflow_run_id", workflowRunId);
  const result = await consoleRead(query.limit(2));
  if (result.error || !Array.isArray(result.data) || !consoleValidCount(result.count) || result.count !== result.data.length || result.data.length > 1) return { status: "unavailable", item: null };
  if (!result.data.length) return { status: "missing", item: null };
  const row = result.data[0] as T;
  return consoleGuard((item: T) => consoleScopeGuard<T>(ids)(item) && item.id === selectedId && guard(item), row) ? { status: "found", item: row } : { status: "unavailable", item: null };
}
export async function consoleRelation<T extends { id: string }>(query: Query, maximum: number, guard: (row: T) => boolean, label: string, errors: string[]): Promise<T[]> {
  const result = await consoleRead(query.limit(maximum + 1));
  if (result.error || !Array.isArray(result.data) || !consoleValidCount(result.count) || result.count !== result.data.length || result.data.length > maximum || !result.data.every(row => consoleGuard(guard, row as T)) || new Set(result.data.map(row => row?.id)).size !== result.data.length) {
    errors.push(`${label} could not be verified completely.`); return [];
  }
  return result.data as T[];
}
function selectedRows<T extends { id: string }>(page: ConsoleCollectionPage<T>, selected: ConsoleCollectionSelection<T>): T[] { return selected.status === "found" && !page.items.some(row => row.id === selected.item.id) ? [...page.items, selected.item] : page.items; }
export type ConsoleWorkPage = { page: ConsoleCollectionPage<ConsoleWorkRunMetadata>; selection: ConsoleCollectionSelection<ConsoleWorkRunMetadata>; definitions: ConsoleWorkflowDefinitionMetadata[]; errors: string[] };
/** Name search executes before paging; selected identity is independent of search/status/page. */
export async function loadConsoleWorkPage(context: OwnerUiContext, options: ConsoleCollectionOptions = {}): Promise<ConsoleWorkPage> {
  const q = consoleCollectionQuery("work", options), ids = await consoleScopedIds(context, q.businessId);
  if (ids?.length === 0) return { page: consoleEmptyPage(q), selection: { status: q.selectedId ? "missing" : "none", item: null }, definitions: [], errors: [] };
  let query = consoleScope(context.supabase.from("workflow_runs").select(`${CONSOLE_RUN_METADATA_SELECT}${q.query ? ",definition:workflow_definitions!inner(name)" : ""}`, { count: "exact" }), ids);
  if (q.status === "active") query = query.in("status", ACTIVE).is("completed_at", null);
  else if (q.status === "ended") query = query.or("status.in.(completed,failed,cancelled),completed_at.not.is.null");
  else if (q.status === "stopped") query = query.in("status", ACTIVE).not("completed_at", "is", null);
  else if (q.status !== "all") { query = query.eq("status", q.status); if (ACTIVE.includes(q.status)) query = query.is("completed_at", null); }
  if (q.query) query = query.ilike("definition.name", consoleSearchPattern(q.query));
  const guard = (run: ConsoleWorkRunMetadata) => consoleScopeGuard<ConsoleWorkRunMetadata>(ids)(run) && consoleRunGuard(run);
  const pageGuard = (run: ConsoleWorkRunMetadata & { definition?: { name?: string } }) => guard(run) && (q.status === "all" || (q.status === "ended" ? ["completed", "failed", "cancelled"].includes(run.status) || run.completed_at != null : q.status === "active" ? ACTIVE.includes(run.status) && run.completed_at == null : q.status === "stopped" ? ACTIVE.includes(run.status) && run.completed_at != null : run.status === q.status && (!ACTIVE.includes(q.status) || run.completed_at == null))) && (!q.query || typeof run.definition?.name === "string" && run.definition.name.toLowerCase().includes(q.query.toLowerCase()));
  const [result, selected] = await Promise.all([consoleRead(orderPage(query, q, q.sort === "updated" ? "updated_at" : "created_at")), consoleExactSelection<ConsoleWorkRunMetadata>(context, "workflow_runs", CONSOLE_RUN_METADATA_SELECT, q.selectedId, ids, guard)]);
  const page = pageResult<ConsoleWorkRunMetadata>(result, q, pageGuard, "Saved work"), errors = [...page.errors], definitionIds = consoleDistinct(selectedRows(page, selected).map(run => run.workflow_definition_id));
  const definitions = definitionIds.length ? await consoleRelation<ConsoleWorkflowDefinitionMetadata>(context.supabase.from("workflow_definitions").select(CONSOLE_DEFINITION_METADATA_SELECT, { count: "exact" }).in("id", definitionIds), definitionIds.length,
    row => consoleValidId(row.id) && definitionIds.includes(row.id) && typeof row.name === "string", "Workflow definitions", errors) : [];
  if (definitions.length !== definitionIds.length) errors.push("Some workflow definitions are unavailable.");
  if (selected.status === "unavailable") errors.push("Selected work could not be verified.");
  return { page, selection: selected, definitions, errors };
}
export type ConsoleActivityPage = { page: ConsoleCollectionPage<ConsoleActivityEventMetadata>; selection: ConsoleCollectionSelection<WorkflowEventRecord>; workflowFilter: ConsoleWorkRunMetadata | null; runs: ConsoleWorkRunMetadata[]; errors: string[] };
/** Raw saved events, not work episodes. The run filter is independently owner/Business verified. */
export async function loadConsoleActivityPage(context: OwnerUiContext, options: ConsoleCollectionOptions = {}): Promise<ConsoleActivityPage> {
  const q = consoleCollectionQuery("activity", options), ids = await consoleScopedIds(context, q.businessId);
  if (ids?.length === 0) return { page: consoleEmptyPage(q), selection: { status: q.selectedId ? "missing" : "none", item: null }, workflowFilter: null, runs: [], errors: [] };
  let workflowFilter: ConsoleWorkRunMetadata | null = null;
  if (q.workflowRunId) {
    const filter = await consoleExactSelection<ConsoleWorkRunMetadata>(context, "workflow_runs", CONSOLE_RUN_METADATA_SELECT, q.workflowRunId, ids, consoleRunGuard);
    if (filter.status !== "found") {
      const errors = ["Activity workflow filter is not available or could not be verified."];
      return { page: consoleEmptyPage(q, errors), selection: { status: q.selectedId ? "unavailable" : "none", item: null }, workflowFilter: null, runs: [], errors };
    }
    workflowFilter = filter.item;
  }
  const businessIds = workflowFilter ? [workflowFilter.business_id] : ids;
  let query = consoleScope(context.supabase.from("events").select(EVENT_METADATA, { count: "exact" }), businessIds);
  if (q.workflowRunId) query = query.eq("workflow_run_id", q.workflowRunId);
  if (q.query) query = query.ilike("event_type", consoleSearchPattern(q.query));
  const guard = (event: ConsoleActivityEventMetadata) => consoleScopeGuard<ConsoleActivityEventMetadata>(businessIds)(event) && (event.workflow_run_id === null || consoleValidId(event.workflow_run_id)) && typeof event.event_type === "string" && Number.isFinite(Date.parse(event.occurred_at)) && (!q.workflowRunId || event.workflow_run_id === q.workflowRunId);
  const [result, selected] = await Promise.all([consoleRead(orderPage(query, q, "occurred_at")), consoleExactSelection<WorkflowEventRecord>(context, "events", EVENT, q.selectedId, businessIds, guard, q.workflowRunId ?? undefined)]);
  const page = pageResult<ConsoleActivityEventMetadata>(result, q, event => guard(event) && (!q.query || event.event_type.toLowerCase().includes(q.query.toLowerCase())), "Activity events"), events = selectedRows(page, selected), errors = [...page.errors];
  const runIds = consoleDistinct(events.flatMap(event => event.workflow_run_id ? [event.workflow_run_id] : []));
  const runs = workflowFilter ? [workflowFilter] : runIds.length ? await consoleRelation<ConsoleWorkRunMetadata>(consoleScope(context.supabase.from("workflow_runs").select(CONSOLE_RUN_METADATA_SELECT, { count: "exact" }), businessIds).in("id", runIds), runIds.length,
    run => consoleRunGuard(run) && events.some(event => event.workflow_run_id === run.id && event.business_id === run.business_id), "Activity workflow context", errors) : [];
  if (events.some(event => event.workflow_run_id && !runs.some(run => event.workflow_run_id === run.id && event.business_id === run.business_id))) errors.push("Some events have unavailable workflow context.");
  if (selected.status === "unavailable") errors.push("Selected event is outside this verified run/Business or unavailable.");
  return { page, selection: selected, workflowFilter, runs, errors };
}
