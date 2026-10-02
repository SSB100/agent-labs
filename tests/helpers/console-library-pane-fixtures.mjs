import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadSource } from "./guided-ui.mjs";
import { panes as collections, scroll, id } from "./console-collection-fixtures.mjs";

export { id };
export const libraryNow = Date.parse("2026-10-02T12:00:00Z");
export const libraryBusinesses = [1, 2].map(number => ({ id: id(number), name: `North Star Studio ${number} ${"LongBusinessWithoutAnySpaces".repeat(6)}` }));
export const libraryLongName = "A saved original design with a deliberately long title " + "UnbrokenOriginalArtworkDescription".repeat(8);
const collectionQuery = loadSource("src/lib/core-ui/console-collections-query.ts");
export const libraryQuery = loadSource("src/lib/core-ui/console-library-query.ts", { "./console-collections-query": collectionQuery });
export const creativeTypes = loadSource("src/creative/types.ts");
export const costs = loadSource("src/creative/cost-display.ts");
export const preview = loadSource("src/components/console/console-library-preview.tsx");
export const jsonFocus = loadSource("src/components/console/console-library-json-focus.tsx");
export const runLookup = loadSource("src/components/console/console-library-run-lookup.tsx", { "@/lib/core-ui/console-library-query": libraryQuery, "./console-collection-scroll": scroll });
const viewport = loadSource("src/components/console/console-collection-viewport.tsx", { "./console-collection-scroll": scroll });
export const libraryPane = loadSource("src/components/console/console-library-pane.tsx", {
  "@/lib/core-ui/console-library-query": libraryQuery, "@/creative/cost-display": costs,
  "@/creative/types": creativeTypes, "./console-collection-panes": collections,
  "./console-collection-viewport": viewport, "./console-library-preview": preview,
  "./console-library-pane.css": {}, "./console-library-run-lookup": runLookup, "./console-library-json-focus": jsonFocus,
});
const date = number => new Date(Date.parse("2026-01-01T00:00:00Z") + number * 86400000).toISOString();
const hash = "a".repeat(64), briefHash = "b".repeat(64), none = () => ({ status: "none", item: null });
const windowOf = (records, limit) => ({ status: "ready", records, total: records.length, limit });
export const libraryDesigns = Array.from({ length: 127 }, (_, index) => ({
  id: id(1000 + index), business_id: libraryBusinesses[index % 2].id, creative_run_id: id(2000 + index), candidate_id: id(3000 + index), approval_id: id(4000 + index), artifact_id: index === 1 ? null : id(5000 + index),
  version: index % 2 + 1, brief_hash: briefHash, asset_hash: hash, storage_path: `${libraryBusinesses[index % 2].id}/${id(2000 + index)}/version-${index % 2 + 1}.png`, prompt: `${libraryLongName} ${index}`, provider: "fixture-provider", model: "fixture-model", generated_at: date(index),
  signedUrl: null, workIdentity: { businessId: libraryBusinesses[index % 2].id, workflowRunId: id(6000 + index), artifactId: index === 1 ? null : id(5000 + index) }, artifactStatus: index === 1 ? "missing" : "verified", previewStatus: "unavailable", previewReason: "Private preview unavailable in this inert fixture.", contextStatus: "verified", status: index === 0 ? "needs_owner" : index % 3 === 0 ? "future_unknown_state" : "running", completedAt: index === 0 ? date(1) : null,
}));
export const libraryRecords = libraryDesigns.map((asset, index) => ({ id: id(5000 + index), business_id: asset.business_id, workflow_run_id: id(6000 + index), task_contract_id: null, artifact_type: index % 2 ? "creative.review" : "creative.image", name: `${libraryLongName} record ${index}`, media_type: index % 2 ? "application/json" : "image/png", storage_path: index === 0 ? "javascript:never-a-download" : asset.storage_path, created_at: date(index), updated_at: date(index) }));
export function libraryArtifact(index = 0, overrides = {}) { return { ...libraryRecords[index], content: { exactSelectedOnly: `EXACT-CONTENT-${index}`, schemaVersion: "9.0", unsafeText: "<script>alert('never run')</script>" }, metadata: { savedOnly: `EXACT-METADATA-${index}` }, checksum: index === 1 ? null : hash, version: null, ...overrides }; }
export function libraryRun(index = 0, overrides = {}) {
  const asset = libraryDesigns[index], run = { id: asset.creative_run_id, business_id: asset.business_id, candidate_id: asset.candidate_id, approval_id: asset.approval_id, workflow_run_id: id(6000 + index), capability_expires_at: "2026-10-01T12:00:00Z", created_at: date(index), catalog_snapshot: { exactRunOnly: index } };
  const approval = { id: asset.approval_id, business_id: asset.business_id, candidate_id: asset.candidate_id, purpose: "technical_qualification", scope_hash: hash, approval_hash: hash, maximum_microusd: 800000, approved_at: date(index), expires_at: "2026-10-01T12:00:00Z", snapshot: { concept: `${libraryLongName} selected ${index}`, printSpecification: { garment: "Saved garment", placement: "front" }, maximumGenerations: 1, publicationAllowed: false }, quote: { savedQuote: true } };
  const workflow = { id: id(6000 + index), business_id: asset.business_id, workflow_definition_id: id(90), status: asset.status, completed_at: asset.completedAt, current_stage_key: "review", input: {}, state: {}, created_at: date(index), updated_at: date(index), started_at: date(index), runtime_provider: null, runtime_run_id: null };
  const review = { id: id(7000 + index), business_id: asset.business_id, creative_run_id: run.id, asset_id: asset.id, artifact_id: id(8000 + index), brief_hash: briefHash, asset_hash: hash, review: { version: "1.0", assetHash: hash, briefHash, checks: creativeTypes.REVIEW_CRITERIA.map(criterion => ({ criterion, outcome: "PASS", rationale: "Saved matching technical observation" })), outcome: "PASS", repairInstruction: null }, reviewer_model: "fixture-reviewer", created_at: date(index) };
  const metadata = Object.fromEntries(Object.entries(asset).filter(([key]) => !["signedUrl", "workIdentity", "previewStatus", "previewReason", "contextStatus", "artifactStatus", "status", "completedAt"].includes(key)));
  return { selection: { status: "found", item: run }, approval: { status: "found", item: approval }, workflow: { status: "found", item: workflow }, assets: windowOf([metadata], 2), outputs: windowOf([], 6), reviews: windowOf([review], 2), costs: { status: "ready", records: [
    { creative_run_id: run.id, call_key: "generate:1", reserved_microusd: 500000, reported_microusd: 200000, provider_request_id: "fixture-charge", created_at: date(index), settled_at: date(index) },
    { creative_run_id: run.id, call_key: "review:1", reserved_microusd: 100000, reported_microusd: null, provider_request_id: null, created_at: date(index), settled_at: null },
  ], reservations: [], settlements: [] }, complete: true, errors: [], ...overrides };
}
export function libraryDesign(index = 0, overrides = {}) {
  return { ...libraryDesigns[index], inspection: { sha256: hash, mediaType: "image/png", bytes: 54321, width: 1024, height: 1024, colorSpace: "srgb", hasAlpha: true, transparentPixelFraction: .5, effectiveDpi: 300, failedCriteria: [] }, provenance: null, artifact: index === 1 ? none() : { status: "found", item: libraryArtifact(index) }, runDetail: libraryRun(index), complete: true, errors: [], ...overrides };
}
export function libraryFixture(kind = "designs", overrides = {}) {
  const params = overrides.searchParams instanceof URLSearchParams ? overrides.searchParams : new URLSearchParams({ view: "library", type: kind, ...overrides.searchParams });
  const query = libraryQuery.consoleLibraryQuery(kind, libraryQuery.consoleLibraryOptionsFromSearch(Object.fromEntries(params), kind));
  const source = kind === "records" ? libraryRecords : libraryDesigns;
  let items = source.filter(row => !query.businessId || row.business_id === query.businessId).filter(row => !query.query || (kind === "records" ? row.name : row.prompt).toLowerCase().includes(query.query.toLowerCase()));
  if (kind === "records") items = items.filter(row => query.mediaType === "all" || row.media_type === query.mediaType).filter(row => query.artifactType === "all" || row.artifact_type === query.artifactType);
  items = [...items].sort((a, b) => (a.id.localeCompare(b.id)) * (query.sort === "oldest" ? 1 : -1));
  const exact = source.findIndex(row => row.id === query.selectedId && (!query.businessId || row.business_id === query.businessId));
  const selection = query.selectedId ? exact === -1 ? { status: "missing", item: null } : { status: "found", item: kind === "records" ? libraryArtifact(exact) : libraryDesign(exact) } : none();
  const runIndex = libraryDesigns.findIndex(row => row.creative_run_id === query.creativeRunId && (!query.businessId || row.business_id === query.businessId));
  const runDetail = query.creativeRunId ? runIndex === -1 ? libraryRun(0, { selection: { status: "missing", item: null } }) : libraryRun(runIndex) : null;
  const page = { items: items.slice(query.offset, query.offset + 25), total: items.length, page: query.page, pageSize: 25, hasNext: query.offset + 25 < items.length, hasPrevious: query.page > 1, complete: true, errors: [], ...overrides.page };
  const data = { query, page, selection, errors: [], ...(kind === "designs" ? { runDetail } : {}), ...overrides.data };
  return { data, props: { ownerId: "fixture-owner", businesses: libraryBusinesses, searchParams: params, now: libraryNow, ...overrides.props } };
}
export function libraryMarkup(kind = "designs", overrides = {}) { const { data, props } = libraryFixture(kind, overrides); return renderToStaticMarkup(React.createElement(libraryPane.ConsoleLibraryPane, { data, ...props })); }
