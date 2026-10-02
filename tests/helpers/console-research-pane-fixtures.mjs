import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadSource } from "./guided-ui.mjs";
import { panes as collections } from "./console-collection-fixtures.mjs";
import { api as historyApi, fixture as historyFixture, id, rebind, rebindEvidence, textHash } from "./discovery-v2-history-fixtures.mjs";
export { id, rebind, rebindEvidence, textHash };
export const researchLongName = "Duplicate saved research objective " + "LongUnbrokenOriginalResearchDescription".repeat(16);
export const researchBusinesses = [1, 2].map(number => ({ id: id(number), name: "Duplicate Business " + "LongUnbrokenBusinessName".repeat(8), created_at: "2024-01-01T00:00:00Z", updated_at: "2024-01-01T00:00:00Z" }));
const collectionQuery = loadSource("src/lib/core-ui/console-collections-query.ts");
export const researchQuery = loadSource("src/lib/core-ui/console-research-query.ts", { "./console-collections-query": collectionQuery });
export const researchPane = loadSource("src/components/console/console-research-pane.tsx", { "@/lib/core-ui/console-research-query": researchQuery, "./console-collection-panes": collections, "./console-collection-panes.css": {}, "./console-research-pane.css": {} });
const none = () => ({ status: "none", item: null }), date = number => new Date(Date.parse("2024-01-01T00:00:00Z") + number * 86400000).toISOString();
const baseHistory = historyFixture();
const historyRoot = baseHistory.experiment;
const kindAt = index => ["root_record", "follow_up_record", "candidate_record", "legacy_record", "unverified_record"][index % 5];
export const researchRecords = Array.from({ length: 127 }, (_, index) => ({
  id: id(10 + index * 100), business_id: id(index % 2 + 1), workflow_run_id: id(11 + index * 100), discovery_version: kindAt(index) === "legacy_record" ? "pod-discovery-1.0" : "pod-discovery-2.0", candidate_id: kindAt(index) === "candidate_record" ? id(40000 + index) : null, parent_discovery_id: kindAt(index) === "candidate_record" ? id(40001 + index) : null,
  hypothesis: "Duplicate saved hypothesis " + "LongUnbrokenHypothesis".repeat(8), status: ["completed", "failed", "researching", "reserved", "future_unknown_state"][index % 5], source_artifact_id: index === 0 ? historyRoot.source_artifact_id : id(13 + index * 100), basis_artifact_id: null,
  created_at: date(index), started_at: date(index), completed_at: index % 2 === 0 ? index === 0 ? historyRoot.completed_at : date(index) : null,
  authority_root_id: kindAt(index) === "follow_up_record" ? id(10) : kindAt(index) === "unverified_record" ? "malformed-saved-marker" : id(10 + index * 100), semantic_goal_hash: "a".repeat(64), intent_id: id(10 + index * 100), intent_business_id: id(index % 2 + 1), intent_version: "pod-discovery-2.0", prior_root_id: kindAt(index) === "follow_up_record" ? id(10) : null, objective: kindAt(index) === "legacy_record" ? null : `${researchLongName} ${index}`, policy_hash: "b".repeat(64), recordKind: kindAt(index), linkage: { status: "unverified", reasons: ["Saved lineage has not been transitively verified."] },
}));
export function researchHistorical(index = 0, overrides = {}) {
  const record = researchRecords[index];
  return { ...record, savedIntent: null, savedFollowUpBasis: null, historicalBinding: record.recordKind === "legacy_record" ? "unverified" : "verified", originalBinding: record.recordKind === "root_record" ? "verified" : "unverified", workflow: { status: "found", item: { id: record.workflow_run_id, business_id: record.business_id, workflow_definition_id: id(90), status: record.status === "researching" ? "running" : record.status, current_stage_key: "review", completed_at: record.completed_at, created_at: record.created_at, updated_at: record.created_at, started_at: record.started_at, runtime_provider: null, runtime_run_id: null, intent_id: record.id } }, definition: null, workIdentity: record.recordKind === "legacy_record" ? null : { businessId: record.business_id, workflowRunId: record.workflow_run_id }, errors: [], authority: none(), predecessor: none(), directLinks: "unverified", transitiveLineage: "unverified", ...overrides };
}
export function researchHistoryInput() {
  const input = historyFixture(); input.experiment.intent.objective = researchRecords[0].objective; input.observedAt = "2026-10-02T12:00:00Z";
  return rebind(input);
}
export function researchEvidence(index = 0, overrides = {}) {
  const record = researchHistorical(index);
  const input = overrides.historyInput ?? researchHistoryInput();
  const history = index === 0 ? historyApi.verifyDiscoveryV2History(input) : null;
  const fields = ["id", "business_id", "workflow_run_id", "discovery_version", "candidate_id", "parent_discovery_id", "status", "completed_at", "source_artifact_id"];
  const selection = { status: "found", item: Object.fromEntries(fields.map(field => [field, record[field]])) };
  const rest = { ...overrides }; delete rest.historyInput;
  return { selection, integrity: history?.integrity ?? "missing", history, workIdentity: record.workIdentity, artifacts: [{ role: "dossier", businessId: record.business_id, workflowRunId: record.workflow_run_id, artifactId: record.source_artifact_id, verification: "metadata_only" }], issues: [], limits: ["Metadata-only links establish the exact saved target, not content validity."], ...rest };
}
export const associatedAttempts = Array.from({ length: 130 }, (_, index) => ({ ...researchRecords[0], id: index === 0 ? id(10) : id(50000 + index), workflow_run_id: index === 0 ? id(11) : id(60000 + index), objective: `${researchLongName} associated ${index}`, authority_root_id: id(10), prior_root_id: index === 0 ? null : id(10), recordKind: index === 0 ? "root_record" : "follow_up_record", created_at: date(index + 200) }));
const limits = ["Counts describe raw persisted records, not certified groups.", "Direct association does not prove recursive ancestry or completeness.", "No costs, remaining allowance or execution authority are established."];
export function researchFixture(kind = "records", overrides = {}) {
  const params = overrides.searchParams instanceof URLSearchParams ? new URLSearchParams(overrides.searchParams) : new URLSearchParams({ view: "research", type: kind, ...overrides.searchParams });
  const query = researchQuery.consoleResearchQuery(kind, researchQuery.consoleResearchOptionsFromSearch(Object.fromEntries(params), kind));
  let records = researchRecords.filter(record => kind === "records" || record.recordKind === "root_record").filter(record => !query.businessId || record.business_id === query.businessId).filter(record => !query.query || String(record[query.searchField] ?? "").toLowerCase().includes(query.query.toLowerCase()));
  records = [...records].sort((a, b) => a.created_at.localeCompare(b.created_at) * (query.sort === "oldest" ? 1 : -1));
  const index = researchRecords.findIndex(record => record.id === query.selectedId && (!query.businessId || record.business_id === query.businessId));
  const selection = query.selectedId ? index < 0 ? { status: "missing", item: null } : { status: "found", item: researchHistorical(index) } : none();
  const rootIndex = query.rootId ? researchRecords.findIndex(record => record.id === query.rootId && (!query.businessId || record.business_id === query.businessId)) : selection.status === "found" && selection.item.recordKind === "root_record" ? index : -1;
  const root = rootIndex >= 0 ? { status: "found", item: researchHistorical(rootIndex) } : query.rootId ? { status: "missing", item: null } : none();
  const page = { items: records.slice(query.offset, query.offset + 25), total: records.length, page: query.page, pageSize: 25, hasPrevious: query.page > 1, hasNext: query.offset + 25 < records.length, complete: true, errors: [], ...overrides.page };
  const orderedAttempts = query.attemptSort === "oldest" ? associatedAttempts : [...associatedAttempts].reverse();
  const newestRecord = associatedAttempts.at(-1), newestContext = { ...researchHistorical(0), ...newestRecord, workflow: { status: "found", item: { ...researchHistorical(0).workflow.item, id: newestRecord.workflow_run_id, intent_id: newestRecord.id } } };
  const attempts = root.status === "found" && root.item.id === id(10) ? { rootId: id(10), businessId: id(1), countLabel: "Raw persisted attempt records carrying this authority ID (including the original)", page: { items: orderedAttempts.slice(query.attemptOffset, query.attemptOffset + 25), total: 130, page: query.attemptPage, pageSize: 25, hasPrevious: query.attemptPage > 1, hasNext: query.attemptOffset + 25 < 130, complete: true, errors: [] }, newest: { status: "found", item: newestRecord }, newestContext: { status: "found", item: newestContext }, newestPredicateTotal: 1 } : null;
  const data = { query, countLabel: kind === "records" ? "Raw persisted research records" : "Raw persisted root records", page, selection, root, attempts, limits, errors: [], ...overrides.data };
  const evidence = Object.hasOwn(overrides, "evidence") ? overrides.evidence : index >= 0 ? researchEvidence(index) : query.rootId === id(10) ? researchEvidence(0) : null;
  return { data, props: { evidence, ownerId: "fixture-owner", businesses: researchBusinesses, searchParams: params, scopeHref: researchQuery.consoleResearchHref(params, {}), ...overrides.props } };
}
export function researchMarkup(kind = "records", overrides = {}) { const { data, props } = researchFixture(kind, overrides); return renderToStaticMarkup(React.createElement(researchPane.ConsoleResearchPane, { data, ...props })); }
