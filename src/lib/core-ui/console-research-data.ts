import "server-only";
import { createHash } from "node:crypto";
import type { OwnerUiContext } from "./data";
import type { ConsoleCollectionPage, ConsoleCollectionSelection } from "./console-collections-query";
import { consoleResearchQuery, consoleResearchSearchPattern, type ConsoleResearchKind, type ConsoleResearchOptions, type ConsoleResearchQuery } from "./console-research-query";
import { CONSOLE_RUN_METADATA_SELECT, CONSOLE_DEFINITION_METADATA_SELECT, consoleDistinct, consoleExactSelection, consoleGuard, consoleObject, consoleRead, consoleRelation, consoleRunGuard, consoleScopedIds, consoleValidCount, consoleValidId, consoleValidStatus, consoleValidTimestamp, consoleNullableTimestamp, type ConsoleReadResult, type ConsoleWorkRunMetadata, type ConsoleWorkflowDefinitionMetadata } from "./console-collections";

const V2 = "pod-discovery-2.0";
export const CONSOLE_RESEARCH_PRIOR_ROOT_PATH = "variables->ownerKickoff->followUpBasis->>rootId";
export const CONSOLE_RESEARCH_AUTHORITY_PATH = "variables->>budgetAuthorityRootId";
export const CONSOLE_RESEARCH_OBJECTIVE_PATH = "variables->intent->>objective";
export const CONSOLE_RESEARCH_METADATA_SELECT = "id,business_id,workflow_run_id,discovery_version,parent_discovery_id,candidate_id,hypothesis,status,source_artifact_id,basis_artifact_id,started_at,completed_at,created_at,authority_root_id:variables->>budgetAuthorityRootId,semantic_goal_hash:variables->>semanticGoalHash,intent_id:variables->intent->>id,intent_business_id:variables->intent->>businessId,intent_version:variables->intent->>version,prior_root_id:variables->ownerKickoff->followUpBasis->>rootId,objective:variables->intent->>objective,policy_hash:variables->>policyHash";
export const CONSOLE_RESEARCH_DETAIL_SELECT = `${CONSOLE_RESEARCH_METADATA_SELECT},intent:variables->intent,follow_up_basis:variables->ownerKickoff->followUpBasis`;
export const CONSOLE_RESEARCH_WORKFLOW_SELECT = `${CONSOLE_RUN_METADATA_SELECT},intent_id:input->>intentId`;
export const CONSOLE_RESEARCH_WORKFLOW_KEYS = ["product.discovery-v2.one", "product.discovery-v2.two", "product.discovery-v2.analysis"] as const;
/** Result cardinality is bounded. These unimplemented guarantees must not be inferred by callers. */
export const CONSOLE_RESEARCH_LIMITS = [
  "Counts describe raw persisted predicates, not certified Quests or fully verified groups.",
  "Authority-marker association and direct links do not prove recursive ancestry, cycles or orphan completeness.",
  "Global verified-group totals and latest-state filtering or sorting are unavailable.",
  "No authority-wide costs, remaining allowance or spending authority are established.",
  "Owner Business-list cap completeness and concurrent-read consistency are not established here.",
  "Efficient indexed access and pre-transfer byte limits are R06 gaps; row limits are not byte limits.",
  "Dossier, evidence, receipts and publication or production qualification are not loaded or validated.",
] as const;

export type ConsoleResearchMetadata = {
  id: string; business_id: string; workflow_run_id: string | null; discovery_version: string;
  parent_discovery_id: string | null; candidate_id: string | null; hypothesis: string; status: string;
  source_artifact_id: string | null; basis_artifact_id: string | null; started_at: string | null; completed_at: string | null; created_at: string;
  // Text-extraction aliases deliberately retain malformed/missing lineage values for inspection.
  authority_root_id: string | null; semantic_goal_hash: string | null; intent_id: string | null; intent_business_id: string | null;
  intent_version: string | null; prior_root_id: string | null; objective: string | null; policy_hash: string | null;
};
export type ConsoleResearchRecord = ConsoleResearchMetadata & {
  recordKind: "root_record" | "follow_up_record" | "candidate_record" | "legacy_record" | "unverified_record";
  linkage: { status: "unverified"; reasons: string[] };
};
type ExactRecord = ConsoleResearchMetadata & { intent: unknown; follow_up_basis: unknown };
export type ConsoleResearchWorkflow = ConsoleWorkRunMetadata & { intent_id: string | null };
export type ConsoleResearchHistorical = ConsoleResearchRecord & {
  savedIntent: Record<string, unknown> | null; savedFollowUpBasis: unknown;
  /** Identity, stored policy hash, direct pointer shape and registered lane only.
   * Neither status attests the complete runtime contract, freshness or authority to act. */
  historicalBinding: "verified" | "unverified"; originalBinding: "verified" | "unverified";
  workflow: ConsoleCollectionSelection<ConsoleResearchWorkflow>; definition: ConsoleWorkflowDefinitionMetadata | null;
  workIdentity: { businessId: string; workflowRunId: string } | null;
  errors: string[];
};
export type ConsoleResearchDetail = ConsoleResearchHistorical & {
  authority: ConsoleCollectionSelection<ConsoleResearchHistorical>; predecessor: ConsoleCollectionSelection<ConsoleResearchHistorical>;
  directLinks: "verified" | "unverified"; transitiveLineage: "unverified";
};
export type ConsoleResearchAttempts = {
  rootId: string; businessId: string; countLabel: "Raw persisted attempt records carrying this authority ID (including the original)";
  page: ConsoleCollectionPage<ConsoleResearchRecord>;
  newest: ConsoleCollectionSelection<ConsoleResearchRecord>; newestContext: ConsoleCollectionSelection<ConsoleResearchHistorical>;
  newestPredicateTotal: number | null;
};
export type ConsoleResearchPage = {
  query: ConsoleResearchQuery; countLabel: "Raw persisted root records" | "Raw persisted research records";
  page: ConsoleCollectionPage<ConsoleResearchRecord>; selection: ConsoleCollectionSelection<ConsoleResearchDetail>;
  root: ConsoleCollectionSelection<ConsoleResearchHistorical>; attempts: ConsoleResearchAttempts | null;
  limits: typeof CONSOLE_RESEARCH_LIMITS; errors: string[];
};
const none = <T>(): ConsoleCollectionSelection<T> => ({ status: "none", item: null });
const unavailable = <T>(): ConsoleCollectionSelection<T> => ({ status: "unavailable", item: null });
const nullableText = (value: unknown) => value === null || typeof value === "string";
const nullableId = (value: unknown) => value === null || consoleValidId(value);
const sha = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const leafKeys = ["authority_root_id", "semantic_goal_hash", "intent_id", "intent_business_id", "intent_version", "prior_root_id", "objective", "policy_hash"] as const;
const forbiddenPayloads = ["variables", "evidence_pack", "measurement_plan", "input", "state", "pack_snapshot", "receipt", "budgetQuote", "budget_quote", "content", "metadata"];
const hasNoPayload = (row: object) => forbiddenPayloads.every(key => !Object.hasOwn(row, key));
const metadataKeys = CONSOLE_RESEARCH_METADATA_SELECT.split(",").map(field => field.split(":")[0]);
function metadataGuard(row: ConsoleResearchMetadata): boolean {
  return [row.id, row.business_id].every(consoleValidId) && [row.workflow_run_id, row.parent_discovery_id, row.candidate_id, row.source_artifact_id, row.basis_artifact_id].every(nullableId)
    && consoleValidStatus(row.discovery_version) && consoleValidStatus(row.status) && typeof row.hypothesis === "string"
    && consoleValidTimestamp(row.created_at) && consoleNullableTimestamp(row.started_at) && consoleNullableTimestamp(row.completed_at)
    && leafKeys.every(key => nullableText(row[key])) && hasNoPayload(row);
}
const topLevel = (row: ConsoleResearchMetadata) => row.discovery_version === V2 && row.candidate_id === null && row.parent_discovery_id === null;
const rootPredicate = (row: ConsoleResearchMetadata) => topLevel(row) && row.prior_root_id === null;
const associationPredicate = (row: ConsoleResearchMetadata, root: ConsoleResearchMetadata) => topLevel(row) && row.business_id === root.business_id && row.authority_root_id === root.id;
function record(row: ConsoleResearchMetadata): ConsoleResearchRecord {
  const reasons = ["Saved lineage has not been transitively verified."];
  if (row.discovery_version === V2 && !consoleValidId(row.authority_root_id)) reasons.push("The saved authority ID is missing or malformed.");
  if (row.discovery_version === V2 && (!sha(row.semantic_goal_hash) || !sha(row.policy_hash))) reasons.push("Saved lineage hashes are missing or malformed.");
  if (row.discovery_version === V2 && row.prior_root_id !== null && !consoleValidId(row.prior_root_id)) reasons.push("The saved predecessor ID is malformed.");
  const metadata = Object.fromEntries(metadataKeys.map(key => [key, row[key as keyof ConsoleResearchMetadata]])) as ConsoleResearchMetadata;
  return { ...metadata, recordKind: row.discovery_version !== V2 ? "legacy_record" : row.candidate_id || row.parent_discovery_id ? "candidate_record" : rootPredicate(row) ? "root_record" : consoleValidId(row.prior_root_id) ? "follow_up_record" : "unverified_record", linkage: { status: "unverified", reasons } };
}
function emptyPage(q: Pick<ConsoleResearchQuery, "page" | "pageSize">, errors: string[] = []): ConsoleCollectionPage<ConsoleResearchRecord> {
  return { items: [], page: q.page, pageSize: q.pageSize, total: errors.length ? null : 0, hasPrevious: q.page > 1, hasNext: errors.length ? null : false, complete: !errors.length, errors };
}
/** PostgreSQL timestamps retain microseconds; compare all saved precision before the UUID tie-break. */
function timestampOrder(left: string, right: string): number {
  const nanos = (value: string) => BigInt(Date.parse(value)) * BigInt(1_000_000) + BigInt((/\.(\d+)/.exec(value)?.[1] ?? "").slice(3).padEnd(6, "0"));
  const a = nanos(left), b = nanos(right); return a < b ? -1 : a > b ? 1 : 0;
}
function rowsValid(rows: ConsoleResearchMetadata[], limit: number, sort: "newest" | "oldest", guard: (row: ConsoleResearchMetadata) => boolean): boolean {
  const direction = sort === "oldest" ? 1 : -1;
  return rows.length <= limit && rows.every(row => consoleGuard(guard, row)) && new Set(rows.map(row => row.id)).size === rows.length
    && rows.every((row, index) => !index || direction * (timestampOrder(row.created_at, rows[index - 1].created_at) || row.id.localeCompare(rows[index - 1].id)) >= 0);
}
function pageResult(result: ConsoleReadResult, q: Pick<ConsoleResearchQuery, "page" | "pageSize" | "offset" | "sort">, guard: (row: ConsoleResearchMetadata) => boolean): ConsoleCollectionPage<ConsoleResearchRecord> {
  if (result.error || !Array.isArray(result.data)) return emptyPage(q, ["Research records could not be loaded."]);
  const rows = result.data as ConsoleResearchMetadata[], valid = rowsValid(rows, q.pageSize + 1, q.sort, guard), count = consoleValidCount(result.count) ? result.count : null;
  const expected = count === null ? null : Math.min(q.pageSize + 1, Math.max(0, count - q.offset)), complete = valid && expected !== null && rows.length === expected;
  return { items: valid ? rows.slice(0, q.pageSize).map(record) : [], page: q.page, pageSize: q.pageSize, total: complete ? count : null, hasPrevious: q.page > 1,
    hasNext: valid && rows.length > q.pageSize ? true : complete ? false : null, complete, errors: complete ? [] : ["Raw Research page completeness could not be verified."] };
}
const metadataOnly = (row: ConsoleResearchMetadata) => metadataGuard(row) && !Object.hasOwn(row, "intent") && !Object.hasOwn(row, "follow_up_basis");
function limitedJson(value: unknown, maximum: number): boolean {
  try { const json = JSON.stringify(value); return json !== undefined && Buffer.byteLength(json, "utf8") <= maximum; } catch { return false; }
}
/** Saved policy integrity only. This never refreshes expiry, prices, permission or execution validity. */
function savedPolicyHash(value: unknown): string {
  const canonical = (item: unknown): string => {
    if (Array.isArray(item)) return `[${item.map(canonical).join(",")}]`;
    if (consoleObject(item)) return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${canonical(item[key])}`).join(",")}}`;
    if (item === undefined || typeof item === "number" && !Number.isFinite(item)) throw Error("Not saved JSON.");
    return JSON.stringify(item);
  };
  return createHash("sha256").update(canonical(value)).digest("hex");
}
function historicalIntent(row: ExactRecord): Record<string, unknown> | null {
  const intent = row.intent;
  try {
    if (!consoleObject(intent) || !limitedJson(intent, 20_000) || Object.keys(intent).sort().join(",") !== "businessId,comparisonUniverse,expiresAt,id,limits,objective,version"
      || intent.version !== V2 || intent.id !== row.id || intent.businessId !== row.business_id || intent.objective !== row.objective || !consoleValidStatus(intent.objective)
      || !consoleValidTimestamp(intent.expiresAt) || !consoleObject(intent.comparisonUniverse) || !consoleObject(intent.limits)
      || intent.limits.maximumAlternatives !== 3 || ![0, 1, 2].includes(Number(intent.limits.maximumNewCollections)) || typeof intent.limits.maximumNewCollections !== "number"
      || ![1, 2].includes(Number(intent.limits.maximumGenerations)) || typeof intent.limits.maximumGenerations !== "number"
      || !consoleValidCount(intent.limits.maximumMicrousd) || intent.limits.maximumMicrousd < 1 || intent.limits.maximumMicrousd > 2_000_000
      || !sha(row.policy_hash) || savedPolicyHash(intent) !== row.policy_hash) return null;
    return intent;
  } catch { return null; }
}
function expectedWorkflow(intent: Record<string, unknown> | null): string | null {
  const limits = intent?.limits; if (!consoleObject(limits)) return null;
  return limits.maximumNewCollections === 0 ? "product.discovery-v2.analysis" : limits.maximumNewCollections === 1 ? "product.discovery-v2.one" : limits.maximumNewCollections === 2 ? "product.discovery-v2.two" : null;
}

type HistoricalReader = (id: string, ids: string[]) => Promise<ConsoleCollectionSelection<ConsoleResearchHistorical>>;
function historicalReader(context: OwnerUiContext): HistoricalReader {
  const cache = new Map<string, Promise<ConsoleCollectionSelection<ConsoleResearchHistorical>>>();
  return (id, ids) => {
    const key = `${ids.join(",")}:${id}`;
    if (!cache.has(key)) cache.set(key, (async () => {
      const exact = await consoleExactSelection<ExactRecord>(context, "product_experiments", CONSOLE_RESEARCH_DETAIL_SELECT, id, ids,
        row => metadataGuard(row) && Object.hasOwn(row, "intent") && Object.hasOwn(row, "follow_up_basis"));
      if (exact.status !== "found") return exact;
      const row = exact.item, errors: string[] = [], intent = historicalIntent(row);
      const snapshot = consoleObject(row.intent) && limitedJson(row.intent, 20_000) ? row.intent : null;
      const basisAvailable = limitedJson(row.follow_up_basis, 2_000), basis = basisAvailable ? row.follow_up_basis : null;
      let workflow: ConsoleCollectionSelection<ConsoleResearchWorkflow> = none(), definition: ConsoleWorkflowDefinitionMetadata | null = null;
      if (row.workflow_run_id) {
        workflow = await consoleExactSelection<ConsoleResearchWorkflow>(context, "workflow_runs", CONSOLE_RESEARCH_WORKFLOW_SELECT, row.workflow_run_id, [row.business_id],
          run => consoleRunGuard(run) && hasNoPayload(run) && run.intent_id === row.id);
        if (workflow.status === "found") {
          const definitionId = workflow.item.workflow_definition_id;
          const definitions = await consoleRelation<ConsoleWorkflowDefinitionMetadata>(context.supabase.from("workflow_definitions").select(CONSOLE_DEFINITION_METADATA_SELECT, { count: "exact" }).eq("id", definitionId), 1,
            item => item.id === definitionId && consoleValidId(item.id) && item.version === "1.0.0" && (CONSOLE_RESEARCH_WORKFLOW_KEYS as readonly string[]).includes(item.workflow_key)
              && item.workflow_key === expectedWorkflow(intent) && consoleValidStatus(item.name) && consoleValidStatus(item.status) && nullableText(item.description) && !Object.hasOwn(item, "stage_definition"), "Exact Research workflow definition", errors);
          definition = definitions[0] ?? null;
        }
      }
      const basisMatches = basisAvailable && (row.prior_root_id === null ? basis === null : consoleObject(basis) && basis.rootId === row.prior_root_id && consoleValidId(basis.rootId));
      const binding = topLevel(row) && !!intent && row.intent_id === row.id && row.intent_business_id === row.business_id && row.intent_version === V2
        && sha(row.semantic_goal_hash) && consoleValidId(row.authority_root_id) && basisMatches
        && (row.authority_root_id === row.id ? basis === null : consoleValidId(row.prior_root_id) && row.prior_root_id !== row.id)
        && workflow.status === "found" && !!definition;
      const original = binding && rootPredicate(row) && row.authority_root_id === row.id && basis === null;
      if (!binding) errors.push("The saved historical intent, direct pointers or exact registered workflow binding is unverified.");
      if (!basisAvailable || !snapshot && row.intent !== null) errors.push("A selected saved context field is malformed or exceeds its returned-payload inspection bound.");
      if (workflow.status !== "found" || !definition) errors.push("Exact Research Work navigation could not be qualified.");
      return { status: "found", item: { ...record(row), savedIntent: snapshot, savedFollowUpBasis: basis, historicalBinding: binding ? "verified" : "unverified", originalBinding: original ? "verified" : "unverified",
        workflow, definition, workIdentity: binding && workflow.status === "found" ? { businessId: row.business_id, workflowRunId: workflow.item.id } : null, errors: consoleDistinct(errors) } };
    })());
    return cache.get(key)!;
  };
}
const savedMaximum = (row: ConsoleResearchHistorical) => consoleObject(row.savedIntent?.limits) ? row.savedIntent.limits.maximumMicrousd : null;
function directMatch(row: ConsoleResearchHistorical, linked: ConsoleResearchHistorical): boolean {
  return linked.historicalBinding === "verified" && linked.business_id === row.business_id && linked.authority_root_id === row.authority_root_id
    && linked.semantic_goal_hash === row.semantic_goal_hash && savedMaximum(linked) === savedMaximum(row);
}
async function selectedDetail(selection: ConsoleCollectionSelection<ConsoleResearchHistorical>, read: HistoricalReader): Promise<ConsoleCollectionSelection<ConsoleResearchDetail>> {
  if (selection.status !== "found") return selection;
  const row = selection.item;
  let authority: ConsoleCollectionSelection<ConsoleResearchHistorical> = none(), predecessor: ConsoleCollectionSelection<ConsoleResearchHistorical> = none();
  if (topLevel(row) && consoleValidId(row.authority_root_id)) authority = row.authority_root_id === row.id ? selection : await read(row.authority_root_id, [row.business_id]);
  if (topLevel(row) && consoleValidId(row.prior_root_id) && row.prior_root_id !== row.id) predecessor = await read(row.prior_root_id, [row.business_id]);
  const authorityValid = authority.status === "found" && authority.item.originalBinding === "verified" && directMatch(row, authority.item);
  const predecessorValid = row.prior_root_id === null ? row.id === row.authority_root_id : predecessor.status === "found" && directMatch(row, predecessor.item);
  const directLinks = row.historicalBinding === "verified" && authorityValid && predecessorValid ? "verified" : "unverified";
  return { status: "found", item: { ...row, authority, predecessor, directLinks, transitiveLineage: "unverified", errors: consoleDistinct([...row.errors, ...(directLinks === "unverified" ? ["Direct authority or predecessor linkage is unverified."] : [])]) } };
}
function authorityQuery(context: OwnerUiContext, root: ConsoleResearchHistorical) {
  return context.supabase.from("product_experiments").select(CONSOLE_RESEARCH_METADATA_SELECT, { count: "exact" }).eq("business_id", root.business_id)
    .eq("discovery_version", V2).is("candidate_id", null).is("parent_discovery_id", null).eq(CONSOLE_RESEARCH_AUTHORITY_PATH, root.id);
}
async function loadAttempts(context: OwnerUiContext, root: ConsoleResearchHistorical, q: ConsoleResearchQuery, read: HistoricalReader): Promise<ConsoleResearchAttempts> {
  const guard = (row: ConsoleResearchMetadata) => metadataOnly(row) && associationPredicate(row, root);
  const [pageRead, newestRead] = await Promise.all([
    consoleRead(authorityQuery(context, root).order("created_at", { ascending: q.attemptSort === "oldest" }).order("id", { ascending: q.attemptSort === "oldest" }).range(q.attemptOffset, q.attemptOffset + q.pageSize)),
    consoleRead(authorityQuery(context, root).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(2)),
  ]);
  const page = pageResult(pageRead, { ...q, page: q.attemptPage, offset: q.attemptOffset, sort: q.attemptSort }, guard);
  if (page.total === 0) { page.complete = false; page.total = null; page.hasNext = null; page.errors.push("A verified self-associated original cannot establish a zero-record attempt group."); }
  const rows = Array.isArray(newestRead.data) ? newestRead.data as ConsoleResearchMetadata[] : [];
  const countsAgree = page.total === null || !consoleValidCount(newestRead.count) || page.total === newestRead.count;
  if (!countsAgree) { page.complete = false; page.total = null; page.errors.push("The independent raw attempt counts disagree; group completeness is unavailable."); }
  const newestValid = countsAgree && !newestRead.error && Array.isArray(newestRead.data) && consoleValidCount(newestRead.count) && newestRead.count >= 1
    && rows.length === Math.min(newestRead.count, 2) && rowsValid(rows, 2, "newest", guard);
  let newest: ConsoleCollectionSelection<ConsoleResearchRecord> = newestValid ? { status: "found", item: record(rows[0]) } : unavailable();
  let newestContext: ConsoleCollectionSelection<ConsoleResearchHistorical> = unavailable();
  if (newest.status === "found") {
    // Inspect the first raw row only. An invalid newest record must never fall back to an older row.
    const exact = await read(newest.item.id, [root.business_id]);
    if (exact.status === "found" && exact.item.historicalBinding === "verified" && metadataKeys.every(key => exact.item[key as keyof ConsoleResearchMetadata] === rows[0][key as keyof ConsoleResearchMetadata])
      && directMatch(exact.item, root) && (exact.item.id === root.id ? exact.item.originalBinding === "verified" : consoleValidId(exact.item.prior_root_id) && exact.item.prior_root_id !== exact.item.id)) newestContext = exact;
    else newest = { ...newest, item: { ...newest.item, linkage: { status: "unverified", reasons: [...newest.item.linkage.reasons, "The newest saved attempt context is unverified; no older attempt was substituted."] } } };
  }
  return { rootId: root.id, businessId: root.business_id, countLabel: "Raw persisted attempt records carrying this authority ID (including the original)", page, newest, newestContext, newestPredicateTotal: newestValid ? newestRead.count! : null };
}

async function loadPage(context: OwnerUiContext, kind: ConsoleResearchKind, options: ConsoleResearchOptions): Promise<ConsoleResearchPage> {
  const q = consoleResearchQuery(kind, options), ids = consoleScopedIds(context, q.businessId), read = historicalReader(context);
  const countLabel = kind === "roots" ? "Raw persisted root records" : "Raw persisted research records";
  if (!ids.length) return { query: q, countLabel, page: emptyPage(q), selection: { status: q.selectedId ? "missing" : "none", item: null }, root: { status: q.rootId ? "missing" : "none", item: null }, attempts: null, limits: CONSOLE_RESEARCH_LIMITS, errors: [] };
  let query = context.supabase.from("product_experiments").select(CONSOLE_RESEARCH_METADATA_SELECT, { count: "exact" }).in("business_id", ids);
  if (kind === "roots") query = query.eq("discovery_version", V2).is("candidate_id", null).is("parent_discovery_id", null).is(CONSOLE_RESEARCH_PRIOR_ROOT_PATH, null);
  if (q.query) query = query.ilike(q.searchField === "objective" ? CONSOLE_RESEARCH_OBJECTIVE_PATH : "hypothesis", consoleResearchSearchPattern(q.query));
  const [result, exact] = await Promise.all([
    consoleRead(query.order("created_at", { ascending: q.sort === "oldest" }).order("id", { ascending: q.sort === "oldest" }).range(q.offset, q.offset + q.pageSize)),
    q.selectedId ? read(q.selectedId, ids) : none<ConsoleResearchHistorical>(),
  ]);
  const page = pageResult(result, q, row => metadataOnly(row) && ids.includes(row.business_id) && (kind !== "roots" || rootPredicate(row))
    && (!q.query || typeof row[q.searchField] === "string" && row[q.searchField]!.toLowerCase().includes(q.query.toLowerCase())));
  let selection = await selectedDetail(exact, read), root: ConsoleCollectionSelection<ConsoleResearchHistorical> = none();
  const errors = [...page.errors];
  // Root identity is independent of the visible page and cannot be relabelled by a selected foreign attempt.
  if (q.rootId) {
    if (exact.status === "found" && exact.item.id !== q.rootId && (!topLevel(exact.item) || exact.item.authority_root_id !== q.rootId)) {
      root = unavailable(); errors.push("The selected record conflicts with the explicit original root identity.");
    } else root = exact.status === "found" && exact.item.id === q.rootId ? exact : await read(q.rootId, exact.status === "found" ? [exact.item.business_id] : ids);
  } else if (exact.status === "found" && rootPredicate(exact.item)) root = exact;
  if (selection.status === "found") {
    const selected = selection.item, visible = page.items.find(row => row.id === selected.id);
    if (visible && metadataKeys.some(key => visible[key as keyof ConsoleResearchMetadata] !== selected[key as keyof ConsoleResearchMetadata])) {
      selection = unavailable(); root = unavailable(); errors.push("The selected record conflicts with its independently loaded page metadata.");
      page.complete = false; page.total = null; page.errors.push("The raw page and exact selected record could not be reconciled.");
    } else errors.push(...selection.item.errors);
  } else if (selection.status === "unavailable") errors.push("The exact selected Research record is unavailable.");
  else if (selection.status === "missing") errors.push("The exact selected Research record is missing; this is not an empty attempt group.");
  const attempts = root.status === "found" && root.item.originalBinding === "verified" ? await loadAttempts(context, root.item, q, read) : null;
  if (root.status === "found" && root.item.originalBinding !== "verified" || root.status === "unavailable") errors.push("The original root binding is unverified; an empty attempt group cannot be inferred.");
  if (root.status === "missing") errors.push("The exact original root is missing; this is not an empty attempt group.");
  if (attempts) { errors.push(...attempts.page.errors); if (attempts.newestContext.status !== "found") errors.push("The newest associated record context is unavailable; no older record was substituted."); }
  return { query: q, countLabel, page, selection, root, attempts, limits: CONSOLE_RESEARCH_LIMITS, errors: consoleDistinct(errors) };
}

/** Raw original-looking records, not a global certified-Quest collection. */
export async function loadConsoleResearchPage(context: OwnerUiContext, options: ConsoleResearchOptions = {}): Promise<ConsoleResearchPage> { return loadPage(context, "roots", options); }
/** Legacy, candidate, follow-up and orphan records remain independently inspectable. */
export async function loadConsoleResearchRecordsPage(context: OwnerUiContext, options: ConsoleResearchOptions = {}): Promise<ConsoleResearchPage> { return loadPage(context, "records", options); }
