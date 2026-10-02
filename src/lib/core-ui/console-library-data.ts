import "server-only";
import type { OwnerUiContext } from "./data";
import type { WorkflowRunRecord } from "./workflows";
import type { StoredImageProvenance } from "../../creative/stored-image";
import { mergeCreativeCosts, type CreativeCostRecord } from "../../creative/cost-display";
import type { ConsoleCollectionPage, ConsoleCollectionSelection } from "./console-collections-query";
import { consoleLibraryQuery, consoleLibrarySearchPattern, type ConsoleLibraryOptions, type ConsoleLibraryQuery } from "./console-library-query";
import { CONSOLE_RUN_METADATA_SELECT, CONSOLE_RUN_SELECT, CONSOLE_DEFINITION_METADATA_SELECT, consoleDistinct, consoleExactSelection, consoleGuard, consoleObject, consoleRead, consoleRelation, consoleRunGuard, consoleScopedIds, consoleValidCount, consoleValidId, consoleValidStatus, consoleValidTimestamp, type ConsoleReadResult, type ConsoleWorkRunMetadata, type ConsoleWorkflowDefinitionMetadata } from "./console-collections";

export const CONSOLE_LIBRARY_PREVIEW_LIMIT = 26;
export const CONSOLE_LIBRARY_PHASE_KEYS = ["brief:1", "screen:1", "generate:1", "review:1", "generate:2", "review:2"] as const;
export const CONSOLE_LIBRARY_ASSET_METADATA_SELECT = "id,business_id,creative_run_id,candidate_id,approval_id,artifact_id,version,brief_hash,asset_hash,storage_path,prompt,provider,model,generated_at";
export const CONSOLE_LIBRARY_ARTIFACT_METADATA_SELECT = "id,business_id,workflow_run_id,task_contract_id,artifact_type,name,media_type,storage_path,created_at,updated_at";
const ARTIFACT_DETAIL = `${CONSOLE_LIBRARY_ARTIFACT_METADATA_SELECT},content,metadata,checksum`;
const CREATIVE_RUN = "id,business_id,candidate_id,approval_id,workflow_run_id,capability_expires_at,created_at";
const APPROVAL = "id,business_id,candidate_id,purpose,scope_hash,approval_hash,maximum_microusd,approved_at,expires_at";
const PHASE = "business_id,creative_run_id,workflow_run_id,call_key,artifact_id,output_hash,created_at,output";
const RESERVATION = "business_id,creative_run_id,call_key,reserved_microusd,request_hash,model,provider,estimate,created_at";
const SETTLEMENT = "business_id,creative_run_id,call_key,reported_microusd,provider_request_id,receipt,created_at";
const REVIEW = "id,business_id,creative_run_id,asset_id,artifact_id,brief_hash,asset_hash,review,reviewer_model,created_at";
const sha256 = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const nullableId = (value: unknown) => value === null || consoleValidId(value);
const nullableText = (value: unknown) => value === null || typeof value === "string";
const text = consoleValidStatus;
const money = (value: unknown): value is number => consoleValidCount(value);
const hasNo = (row: object, fields: string[]) => fields.every(field => !Object.hasOwn(row, field));

export type ConsoleLibraryAssetMetadata = { id: string; business_id: string; creative_run_id: string; candidate_id: string; approval_id: string; artifact_id?: string | null; version: 1 | 2; brief_hash: string; asset_hash: string; storage_path: string; prompt: string; provider: string; model: string; generated_at: string };
export type ConsoleLibraryArtifactMetadata = { id: string; business_id: string; workflow_run_id: string | null; task_contract_id: string | null; artifact_type: string; name: string; media_type: string; storage_path: string | null; created_at: string; updated_at: string };
/** No version column exists in public.artifacts. A payload's schema version is not an artifact revision. */
export type ConsoleLibraryArtifactDetail = ConsoleLibraryArtifactMetadata & { content: Record<string, unknown>; metadata: Record<string, unknown>; checksum: string | null; version: null };
export type ConsoleLibraryRunMetadata = { id: string; business_id: string; candidate_id: string; approval_id: string; workflow_run_id: string; capability_expires_at: string; created_at: string };
export type ConsoleLibraryApprovalMetadata = { id: string; business_id: string; candidate_id: string; purpose: string; scope_hash: string; approval_hash: string; maximum_microusd: number; approved_at: string; expires_at: string };
export type ConsoleLibraryRunSnapshot = ConsoleLibraryRunMetadata & { catalog_snapshot: Record<string, unknown> };
export type ConsoleLibraryApprovalSnapshot = ConsoleLibraryApprovalMetadata & { snapshot: Record<string, unknown>; quote: Record<string, unknown> };
export type ConsoleLibraryPhaseOutput = { business_id: string; creative_run_id: string; workflow_run_id: string; call_key: string; artifact_id: string; output_hash: string; created_at: string; output: Record<string, unknown> };
export type ConsoleLibraryReservation = { business_id: string; creative_run_id: string; call_key: string; reserved_microusd: number; request_hash: string; model: string; provider: string; estimate: Record<string, unknown>; created_at: string };
export type ConsoleLibrarySettlement = { business_id: string; creative_run_id: string; call_key: string; reported_microusd: number | null; provider_request_id: string | null; receipt: Record<string, unknown>; created_at: string };
export type ConsoleLibraryReview = { id: string; business_id: string; creative_run_id: string; asset_id: string; artifact_id: string; brief_hash: string; asset_hash: string; review: Record<string, unknown>; reviewer_model: string; created_at: string };
export type ConsoleLibraryWindow<T> = { status: "ready" | "unavailable"; records: T[]; total: number | null; limit: number };
export type ConsoleLibraryCosts = { status: "ready" | "unavailable"; records: CreativeCostRecord[]; reservations: ConsoleLibraryReservation[]; settlements: ConsoleLibrarySettlement[] };
export type ConsoleLibraryRunDetail = { selection: ConsoleCollectionSelection<ConsoleLibraryRunSnapshot>; approval: ConsoleCollectionSelection<ConsoleLibraryApprovalSnapshot>; workflow: ConsoleCollectionSelection<WorkflowRunRecord>; assets: ConsoleLibraryWindow<ConsoleLibraryAssetMetadata>; outputs: ConsoleLibraryWindow<ConsoleLibraryPhaseOutput>; reviews: ConsoleLibraryWindow<ConsoleLibraryReview>; costs: ConsoleLibraryCosts; complete: boolean; errors: string[] };
export type ConsoleLibraryDesign = ConsoleLibraryAssetMetadata & { signedUrl: string | null; workIdentity: { businessId: string; workflowRunId: string; artifactId: string | null } | null; artifactStatus: "verified" | "missing" | "unavailable"; previewStatus: "ready" | "unavailable"; previewReason: string | null; contextStatus: "verified" | "unavailable"; status: string | null; completedAt?: string | null };
export type ConsoleLibraryDesignDetail = ConsoleLibraryDesign & { inspection: Record<string, unknown>; provenance: StoredImageProvenance | null; artifact: ConsoleCollectionSelection<ConsoleLibraryArtifactDetail>; runDetail: ConsoleLibraryRunDetail; complete: boolean; errors: string[] };
export type ConsoleLibraryPage = { query: ConsoleLibraryQuery; page: ConsoleCollectionPage<ConsoleLibraryDesign>; selection: ConsoleCollectionSelection<ConsoleLibraryDesignDetail>; runDetail: ConsoleLibraryRunDetail | null; errors: string[] };
export type ConsoleLibraryRecordsPage = { query: ConsoleLibraryQuery; page: ConsoleCollectionPage<ConsoleLibraryArtifactMetadata>; selection: ConsoleCollectionSelection<ConsoleLibraryArtifactDetail>; errors: string[] };

function assetGuard(row: ConsoleLibraryAssetMetadata): boolean {
  return [row.id, row.business_id, row.creative_run_id, row.candidate_id, row.approval_id].every(consoleValidId) && (row.artifact_id === undefined || nullableId(row.artifact_id)) && [1, 2].includes(row.version) && sha256(row.brief_hash) && sha256(row.asset_hash) && text(row.storage_path) && typeof row.prompt === "string" && text(row.provider) && text(row.model) && consoleValidTimestamp(row.generated_at);
}
function artifactGuard(row: ConsoleLibraryArtifactMetadata): boolean {
  return consoleValidId(row.id) && consoleValidId(row.business_id) && nullableId(row.workflow_run_id) && nullableId(row.task_contract_id) && text(row.name) && text(row.artifact_type) && text(row.media_type) && nullableText(row.storage_path) && consoleValidTimestamp(row.created_at) && consoleValidTimestamp(row.updated_at);
}
function artifactDetailGuard(row: ConsoleLibraryArtifactDetail): boolean { return artifactGuard(row) && consoleObject(row.content) && consoleObject(row.metadata) && nullableText(row.checksum); }
function runGuard(row: ConsoleLibraryRunMetadata): boolean { return [row.id, row.business_id, row.candidate_id, row.approval_id, row.workflow_run_id].every(consoleValidId) && consoleValidTimestamp(row.created_at) && consoleValidTimestamp(row.capability_expires_at); }
function approvalGuard(row: ConsoleLibraryApprovalMetadata): boolean { return [row.id, row.business_id, row.candidate_id].every(consoleValidId) && text(row.purpose) && sha256(row.scope_hash) && sha256(row.approval_hash) && money(row.maximum_microusd) && consoleValidTimestamp(row.approved_at) && consoleValidTimestamp(row.expires_at); }
function emptyPage<T>(q: ConsoleLibraryQuery, errors: string[] = []): ConsoleCollectionPage<T> { return { items: [], page: q.page, pageSize: q.pageSize, total: errors.length ? null : 0, hasPrevious: q.page > 1, hasNext: errors.length ? null : false, complete: !errors.length, errors }; }
/** Postgres timestamptz retains microseconds; Date.parse alone would invent ID ties. */
function timestampOrder(left: string, right: string): number {
  const nanos = (value: string) => BigInt(Date.parse(value)) * BigInt(1_000_000) + BigInt((/\.(\d+)/.exec(value)?.[1] ?? "").slice(3).padEnd(6, "0"));
  const a = nanos(left), b = nanos(right); return a < b ? -1 : a > b ? 1 : 0;
}
function pageResult<T extends { id: string }>(result: ConsoleReadResult, q: ConsoleLibraryQuery, guard: (row: T) => boolean, time: keyof T): ConsoleCollectionPage<T> {
  if (result.error || !Array.isArray(result.data)) return emptyPage(q, ["Library page could not be loaded."]);
  const rows = result.data as T[], direction = q.sort === "oldest" ? 1 : -1;
  const shapeValid = rows.length <= q.pageSize + 1 && rows.every(row => consoleGuard(guard, row));
  const ordered = shapeValid && rows.every((row, index) => !index || direction * (timestampOrder(String(row[time]), String(rows[index - 1][time])) || row.id.localeCompare(rows[index - 1].id)) >= 0);
  const valid = shapeValid && new Set(rows.map(row => row?.id)).size === rows.length && ordered;
  const count = consoleValidCount(result.count) ? result.count : null, expected = count === null ? null : Math.min(q.pageSize + 1, Math.max(0, count - q.offset)), complete = valid && expected !== null && rows.length === expected;
  return { items: valid ? rows.slice(0, q.pageSize) : [], page: q.page, pageSize: q.pageSize, total: valid && rows.length === expected ? count : null, hasPrevious: q.page > 1, hasNext: valid && rows.length > q.pageSize ? true : complete ? false : null, complete, errors: complete ? [] : ["Library page completeness could not be verified."] };
}
function unavailable<T>(limit: number): ConsoleLibraryWindow<T> { return { status: "unavailable", records: [], total: null, limit }; }
function bounded<T>(result: ConsoleReadResult, limit: number, guard: (row: T) => boolean, key: (row: T) => string): ConsoleLibraryWindow<T> {
  if (result.error || !Array.isArray(result.data) || !consoleValidCount(result.count) || result.count !== result.data.length || result.data.length > limit || !result.data.every(row => consoleGuard(guard, row as T)) || new Set((result.data as T[]).map(key)).size !== result.data.length) return unavailable(limit);
  return { status: "ready", records: result.data as T[], total: result.count, limit };
}
const compositeKey = (row: { business_id: string; creative_run_id: string; call_key: string }) => `${row.business_id}:${row.creative_run_id}:${row.call_key}`;
const noSelection = <T>(): ConsoleCollectionSelection<T> => ({ status: "none", item: null });
const unavailableSelection = <T>(): ConsoleCollectionSelection<T> => ({ status: "unavailable", item: null });
const unknownCosts = (): ConsoleLibraryCosts => ({ status: "unavailable", records: [], reservations: [], settlements: [] });

/** Exact public-table context, also useful when paid generation failed before an asset existed.
 * Six immutable phase keys are the existing schema boundary, never a recent-run sample. No signing. */
export async function loadConsoleLibraryRunDetail(context: OwnerUiContext, creativeRunId: string, options: { businessId?: string } = {}): Promise<ConsoleLibraryRunDetail> {
  const q = consoleLibraryQuery("designs", { ...options, selectedId: creativeRunId }), ids = consoleScopedIds(context, q.businessId);
  const selection = await consoleExactSelection<ConsoleLibraryRunSnapshot>(context, "creative_runs", `${CREATIVE_RUN},catalog_snapshot`, q.selectedId, ids, row => runGuard(row) && consoleObject(row.catalog_snapshot));
  if (selection.status !== "found") return { selection, approval: noSelection(), workflow: noSelection(), assets: unavailable(2), outputs: unavailable(6), reviews: unavailable(2), costs: unknownCosts(), complete: false, errors: ["Exact creative run could not be verified."] };
  const run = selection.item, client = context.supabase;
  const sameRun = (row: { business_id: string; creative_run_id: string }) => row.business_id === run.business_id && row.creative_run_id === run.id;
  const receiptGuard = (row: { business_id: string; creative_run_id: string; call_key: string; created_at: string }) => sameRun(row) && (CONSOLE_LIBRARY_PHASE_KEYS as readonly string[]).includes(row.call_key) && consoleValidTimestamp(row.created_at);
  const relation = (table: string, columns: string, maximum: number, time = "created_at", tie = "call_key") => client.from(table).select(columns, { count: "exact" }).eq("business_id", run.business_id).eq("creative_run_id", run.id).order(time, { ascending: true }).order(tie, { ascending: true }).limit(maximum + 1);
  const [approval, workflowRead, assetResult, phaseResult, reservationResult, settlementResult, reviewResult] = await Promise.all([
    consoleExactSelection<ConsoleLibraryApprovalSnapshot>(context, "creative_approvals", `${APPROVAL},snapshot,quote`, run.approval_id, [run.business_id], row => approvalGuard(row) && row.candidate_id === run.candidate_id && consoleObject(row.snapshot) && consoleObject(row.quote)),
    consoleExactSelection<WorkflowRunRecord>(context, "workflow_runs", CONSOLE_RUN_SELECT, run.workflow_run_id, [run.business_id], row => consoleRunGuard(row) && consoleObject(row.input) && consoleObject(row.state) && row.input.creativeRunId === run.id && row.input.approvalId === run.approval_id && sha256(row.input.approvalHash)),
    consoleRead(relation("creative_assets", CONSOLE_LIBRARY_ASSET_METADATA_SELECT, 2, "generated_at", "id")),
    consoleRead(relation("creative_phase_outputs", PHASE, 6)), consoleRead(relation("creative_cost_reservations", RESERVATION, 6)), consoleRead(relation("creative_cost_settlements", SETTLEMENT, 6)), consoleRead(relation("creative_reviews", REVIEW, 2, "created_at", "id")),
  ]);
  let workflow = workflowRead;
  const contextErrors: string[] = [];
  if (workflow.status === "found") {
    if (approval.status !== "found" || workflow.item.input.approvalHash !== approval.item.approval_hash) {
      workflow = unavailableSelection(); contextErrors.push("The saved workflow approval binding could not be verified.");
    } else {
      const definitionId = workflow.item.workflow_definition_id;
      const definitions = await consoleRelation<ConsoleWorkflowDefinitionMetadata>(client.from("workflow_definitions").select(CONSOLE_DEFINITION_METADATA_SELECT, { count: "exact" }).eq("id", definitionId), 1,
        row => row.id === definitionId && row.workflow_key === "etsy.creative-pipeline" && row.version === "1.0.0" && text(row.name) && text(row.status), "Exact creative workflow definition", contextErrors);
      if (definitions.length !== 1) { workflow = unavailableSelection(); contextErrors.push("The saved workflow is not a verified registered creative-pipeline definition."); }
    }
  }
  const assets = bounded<ConsoleLibraryAssetMetadata>(assetResult, 2, row => sameRun(row) && assetGuard(row) && row.approval_id === run.approval_id && row.candidate_id === run.candidate_id && hasNo(row, ["inspection"]), row => String(row.version));
  const outputs = bounded<ConsoleLibraryPhaseOutput>(phaseResult, 6, row => receiptGuard(row) && row.workflow_run_id === run.workflow_run_id && consoleValidId(row.artifact_id) && sha256(row.output_hash) && consoleObject(row.output), compositeKey);
  const reservations = bounded<ConsoleLibraryReservation>(reservationResult, 6, row => receiptGuard(row) && money(row.reserved_microusd) && sha256(row.request_hash) && text(row.model) && text(row.provider) && consoleObject(row.estimate), compositeKey);
  const settlements = bounded<ConsoleLibrarySettlement>(settlementResult, 6, row => receiptGuard(row) && (row.reported_microusd === null || money(row.reported_microusd)) && (row.provider_request_id === null || text(row.provider_request_id) && row.provider_request_id.length <= 300) && consoleObject(row.receipt), compositeKey);
  const requestIds = settlements.records.flatMap(row => row.provider_request_id === null ? [] : [row.provider_request_id]);
  const costs = reservations.status === "ready" && settlements.status === "ready" && new Set(requestIds).size === requestIds.length ? { status: "ready" as const, records: mergeCreativeCosts(reservations.records, settlements.records).sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at) || left.call_key.localeCompare(right.call_key)), reservations: reservations.records, settlements: settlements.records } : unknownCosts();
  const reviews = assets.status !== "ready" ? unavailable<ConsoleLibraryReview>(2) : bounded<ConsoleLibraryReview>(reviewResult, 2, row => sameRun(row) && consoleValidId(row.id) && consoleValidId(row.artifact_id) && consoleValidTimestamp(row.created_at) && text(row.reviewer_model) && consoleObject(row.review) && assets.records.some(asset => row.asset_id === asset.id && row.asset_hash === asset.asset_hash && row.brief_hash === asset.brief_hash && row.review.assetHash === asset.asset_hash && row.review.briefHash === asset.brief_hash), row => row.asset_id);
  const errors = [...contextErrors, approval.status !== "found" ? "Exact creative approval is unavailable." : "", workflow.status !== "found" ? "Exact creative workflow is unavailable." : "", assets.status !== "ready" ? "Run asset completeness is unavailable." : "", outputs.status !== "ready" ? "Phase-output completeness is unavailable." : "", reviews.status !== "ready" ? "Review completeness is unavailable." : "", costs.status !== "ready" ? "Complete cost receipts are unavailable; charges remain unknown." : ""].filter(Boolean);
  return { selection, approval, workflow, assets, outputs, reviews, costs, complete: !errors.length, errors };
}

/** Content, metadata and checksum are returned only for the explicitly selected artifact. */
export async function loadConsoleLibraryRecordsPage(context: OwnerUiContext, options: ConsoleLibraryOptions = {}): Promise<ConsoleLibraryRecordsPage> {
  const q = consoleLibraryQuery("records", options), ids = consoleScopedIds(context, q.businessId);
  if (!ids.length) return { query: q, page: emptyPage(q), selection: { status: q.selectedId ? "missing" : "none", item: null }, errors: [] };
  let query = context.supabase.from("artifacts").select(CONSOLE_LIBRARY_ARTIFACT_METADATA_SELECT, { count: "exact" }).in("business_id", ids);
  if (q.query) query = query.ilike("name", consoleLibrarySearchPattern(q.query));
  if (q.mediaType !== "all") query = query.eq("media_type", q.mediaType);
  if (q.artifactType !== "all") query = query.eq("artifact_type", q.artifactType);
  const [result, exact] = await Promise.all([
    consoleRead(query.order("created_at", { ascending: q.sort === "oldest" }).order("id", { ascending: q.sort === "oldest" }).range(q.offset, q.offset + q.pageSize)),
    consoleExactSelection<ConsoleLibraryArtifactDetail>(context, "artifacts", ARTIFACT_DETAIL, q.selectedId, ids, artifactDetailGuard),
  ]);
  const page = pageResult<ConsoleLibraryArtifactMetadata>(result, q, row => artifactGuard(row) && ids.includes(row.business_id) && hasNo(row, ["content", "metadata", "checksum"]) && (!q.query || row.name.toLowerCase().includes(q.query.toLowerCase())) && (q.mediaType === "all" || row.media_type === q.mediaType) && (q.artifactType === "all" || row.artifact_type === q.artifactType), "created_at");
  const selection: ConsoleCollectionSelection<ConsoleLibraryArtifactDetail> = exact.status === "found" ? { status: "found", item: { ...exact.item, version: null } } : exact;
  const errors = [...page.errors, ...(selection.status === "unavailable" ? ["Selected artifact could not be verified."] : [])];
  return { query: q, page, selection, errors };
}

function verifiedProvenance(asset: ConsoleLibraryAssetMetadata, inspection: Record<string, unknown>, output: ConsoleLibraryPhaseOutput | undefined): StoredImageProvenance | null {
  if (!output || output.business_id !== asset.business_id || output.creative_run_id !== asset.creative_run_id || output.call_key !== `generate:${asset.version}` || asset.artifact_id && output.artifact_id !== asset.artifact_id || output.output.storagePath !== asset.storage_path || !consoleObject(output.output.inspection) || output.output.inspection.sha256 !== asset.asset_hash || ["bytes", "width", "height", "hasAlpha"].some(key => (output.output.inspection as Record<string, unknown>)[key] !== inspection[key])) return null;
  const source = output.output.provenance;
  if (!consoleObject(source) || source.version !== "creative-image-normalization-1.0" || !["image/png", "image/webp"].includes(String(source.detectedMediaType)) || source.providerMediaType !== null && source.providerMediaType !== source.detectedMediaType || source.normalizedStoragePath !== asset.storage_path || source.normalizedSha256 !== asset.asset_hash || !sha256(source.originalSha256) || !consoleValidCount(source.originalBytes) || source.originalBytes < 12 || source.originalBytes > 7_000_000 || !consoleValidCount(source.normalizedBytes) || source.normalizedBytes < 12 || source.normalizedBytes > 7_000_000 || !consoleValidCount(source.width) || source.width < 1 || source.width > 4096 || !consoleValidCount(source.height) || source.height < 1 || source.height > 4096 || typeof source.decoder !== "string" || !/^[a-zA-Z0-9@.;_-]{5,200}$/.test(source.decoder) || !nullableText(source.encoder) || source.normalizedBytes !== inspection.bytes || source.width !== inspection.width || source.height !== inspection.height) return null;
  if (source.detectedMediaType === "image/png") {
    if (source.originalStoragePath !== asset.storage_path || source.originalSha256 !== asset.asset_hash || source.conversion !== "none" || source.verification !== "byte_identity" || source.originalBytes !== source.normalizedBytes || source.decodedPixelSha256 !== null || source.normalizedDecodedPixelSha256 !== null || source.decodedChannels !== null || source.decodedHasAlpha !== null || source.encoder !== null) return null;
  } else if (source.originalStoragePath !== asset.storage_path.replace(/\.png$/, ".original.webp") || source.conversion !== "lossless_webp_to_png" || source.verification !== "decoded_pixels_equal" || !sha256(source.decodedPixelSha256) || source.decodedPixelSha256 !== source.normalizedDecodedPixelSha256 || !(source.decodedChannels === 3 || source.decodedChannels === 4) || typeof source.decodedHasAlpha !== "boolean" || source.decodedHasAlpha !== (source.decodedChannels === 4) || source.decodedHasAlpha !== inspection.hasAlpha || typeof source.encoder !== "string" || !/^[a-zA-Z0-9@.;_-]{5,200}$/.test(source.encoder)) return null;
  return source as unknown as StoredImageProvenance;
}
async function signPreviews(context: OwnerUiContext, paths: string[], errors: string[]): Promise<Map<string, string>> {
  const wanted = consoleDistinct(paths);
  if (!wanted.length) return new Map();
  if (wanted.length > CONSOLE_LIBRARY_PREVIEW_LIMIT) { errors.push("The bounded preview budget was exceeded."); return new Map(); }
  try {
    const bucket = context.supabase.storage.from("creative-assets");
    // This SDK helper only constructs a URL from the configured client. It performs no read,
    // grants no public access and never exposes the constructed public URL to the caller.
    const targets = new Map(wanted.map(path => {
      const configured = new URL(bucket.getPublicUrl(path).data.publicUrl), suffix = `/object/public/creative-assets/${path}`;
      if (configured.protocol !== "https:" || configured.username || configured.password || configured.search || configured.hash || !configured.pathname.endsWith(suffix)) throw new Error("Storage origin/path contract is unavailable.");
      return [path, { origin: configured.origin, pathname: `${configured.pathname.slice(0, -suffix.length)}/object/sign/creative-assets/${path}` }];
    }));
    const result = await bucket.createSignedUrls(wanted, 1200);
    if (result.error || !Array.isArray(result.data) || result.data.length > wanted.length || result.data.some(row => !consoleObject(row) || !text(row.path) || !wanted.includes(row.path)) || new Set(result.data.map(row => row.path)).size !== result.data.length) throw new Error("Unverified preview response.");
    const signed = new Map<string, string>();
    for (const row of result.data) if (!row.error && text(row.signedUrl)) {
      try {
        const url = new URL(row.signedUrl), expected = targets.get(row.path!);
        if (expected && url.origin === expected.origin && url.pathname === expected.pathname && !url.username && !url.password && !url.hash && url.searchParams.getAll("token").length === 1 && text(url.searchParams.get("token")) && [...url.searchParams.keys()].every(key => key === "token")) signed.set(row.path!, row.signedUrl);
      } catch { /* A malformed or differently bound URL is not a preview. */ }
    }
    if (signed.size !== wanted.length) errors.push("Some owner-session image previews are unavailable.");
    return signed;
  } catch { errors.push("Owner-session image previews are unavailable."); return new Map(); }
}
/** Asset-first metadata paging. No snapshot, inspection, phase JSON or receipt is preloaded for a list.
 * Canonical normalized PNGs use existing owner-session storage signing only. No sentinel or original
 * WebP is signed. Preview access is not production/commerce/file-placement qualification. */
export async function loadConsoleLibraryPage(context: OwnerUiContext, options: ConsoleLibraryOptions = {}): Promise<ConsoleLibraryPage> {
  const q = consoleLibraryQuery("designs", options), ids = consoleScopedIds(context, q.businessId);
  if (!ids.length) return { query: q, page: emptyPage(q), selection: { status: q.selectedId ? "missing" : "none", item: null }, runDetail: q.creativeRunId ? await loadConsoleLibraryRunDetail(context, q.creativeRunId) : null, errors: [] };
  let query = context.supabase.from("creative_assets").select(CONSOLE_LIBRARY_ASSET_METADATA_SELECT, { count: "exact" }).in("business_id", ids);
  if (q.query) query = query.ilike("prompt", consoleLibrarySearchPattern(q.query));
  type ExactAsset = ConsoleLibraryAssetMetadata & { inspection: Record<string, unknown> };
  const [result, exactRead, runDetail] = await Promise.all([
    consoleRead(query.order("generated_at", { ascending: q.sort === "oldest" }).order("id", { ascending: q.sort === "oldest" }).range(q.offset, q.offset + q.pageSize)),
    consoleExactSelection<ExactAsset>(context, "creative_assets", `${CONSOLE_LIBRARY_ASSET_METADATA_SELECT},inspection`, q.selectedId, ids, row => assetGuard(row) && consoleObject(row.inspection) && row.inspection.sha256 === row.asset_hash),
    q.creativeRunId ? loadConsoleLibraryRunDetail(context, q.creativeRunId, { businessId: q.businessId ?? undefined }) : null,
  ]);
  const page = pageResult<ConsoleLibraryAssetMetadata>(result, q, row => assetGuard(row) && ids.includes(row.business_id) && hasNo(row, ["inspection"]) && (!q.query || row.prompt.toLowerCase().includes(q.query.toLowerCase())), "generated_at"), errors = [...page.errors, ...(runDetail?.errors ?? [])];
  let exact = exactRead;
  const exactItem = exact.status === "found" ? exact.item : null;
  const visibleSelected = exactItem ? page.items.find(row => row.id === exactItem.id) : undefined;
  if (exactItem && visibleSelected && CONSOLE_LIBRARY_ASSET_METADATA_SELECT.split(",").some(key => visibleSelected[key as keyof ConsoleLibraryAssetMetadata] !== exactItem[key as keyof ConsoleLibraryAssetMetadata])) {
    // These asset fields are immutable. Never combine one transport's metadata with another's inspection.
    exact = unavailableSelection();
    page.items = page.items.filter(row => row.id !== q.selectedId); page.complete = false; page.total = null;
    page.errors.push("Selected asset metadata conflicts with its exact saved record."); errors.push(...page.errors);
  }
  if (exact.status === "unavailable") errors.push("Selected asset could not be verified.");
  const assets = [...page.items];
  // Re-project full selection before sharing the metadata context; large inspection stays in detail.
  if (exact.status === "found" && !assets.some(row => row.id === exact.item.id)) { const metadata = { ...exact.item }; delete (metadata as Partial<ExactAsset>).inspection; assets.push(metadata); }
  const runIds = consoleDistinct(assets.map(asset => asset.creative_run_id));
  const runs = runIds.length ? await consoleRelation<ConsoleLibraryRunMetadata>(context.supabase.from("creative_runs").select(CREATIVE_RUN, { count: "exact" }).in("business_id", ids).in("id", runIds), runIds.length, row => runGuard(row) && hasNo(row, ["catalog_snapshot"]) && assets.some(asset => row.id === asset.creative_run_id && row.business_id === asset.business_id && row.approval_id === asset.approval_id && row.candidate_id === asset.candidate_id), "Asset run context", errors) : [];
  if (runs.length !== runIds.length) errors.push("Some exact asset run context is unavailable.");
  const approvalIds = consoleDistinct(runs.map(run => run.approval_id)), workflowIds = consoleDistinct(runs.map(run => run.workflow_run_id)), artifactIds = consoleDistinct(assets.flatMap(asset => asset.artifact_id ? [asset.artifact_id] : []));
  const [approvals, workflows, artifacts, detail] = await Promise.all([
    approvalIds.length ? consoleRelation<ConsoleLibraryApprovalMetadata>(context.supabase.from("creative_approvals").select(APPROVAL, { count: "exact" }).in("business_id", ids).in("id", approvalIds), approvalIds.length, row => approvalGuard(row) && hasNo(row, ["snapshot", "quote"]) && runs.some(run => row.id === run.approval_id && row.business_id === run.business_id && row.candidate_id === run.candidate_id), "Asset approval context", errors) : [],
    workflowIds.length ? consoleRelation<ConsoleWorkRunMetadata>(context.supabase.from("workflow_runs").select(CONSOLE_RUN_METADATA_SELECT, { count: "exact" }).in("business_id", ids).in("id", workflowIds), workflowIds.length, row => consoleRunGuard(row) && hasNo(row, ["input", "state"]) && runs.some(run => row.id === run.workflow_run_id && row.business_id === run.business_id), "Asset workflow context", errors) : [],
    artifactIds.length ? consoleRelation<ConsoleLibraryArtifactMetadata>(context.supabase.from("artifacts").select(CONSOLE_LIBRARY_ARTIFACT_METADATA_SELECT, { count: "exact" }).in("business_id", ids).in("id", artifactIds), artifactIds.length, row => artifactGuard(row) && hasNo(row, ["content", "metadata", "checksum"]) && assets.some(asset => row.id === asset.artifact_id && row.business_id === asset.business_id), "Asset artifact context", errors) : [],
    exact.status === "found" ? loadConsoleLibraryRunDetail(context, exact.item.creative_run_id, { businessId: exact.item.business_id }) : null,
  ]);
  if (approvals.length !== approvalIds.length) errors.push("Some exact asset approvals are unavailable.");
  if (workflows.length !== workflowIds.length) errors.push("Some exact asset workflow records are unavailable.");
  if (artifacts.length !== artifactIds.length) errors.push("Some exact asset artifact links are unavailable.");
  const hydrated: ConsoleLibraryDesign[] = assets.map(asset => {
    const run = runs.find(row => row.id === asset.creative_run_id && row.business_id === asset.business_id && row.approval_id === asset.approval_id && row.candidate_id === asset.candidate_id);
    const approval = run && approvals.find(row => row.id === run.approval_id && row.business_id === run.business_id && row.candidate_id === run.candidate_id);
    const workflow = run && workflows.find(row => row.id === run.workflow_run_id && row.business_id === run.business_id);
    const verified = !!run && !!approval && !!workflow;
    const exactUnavailable = asset.id === q.selectedId && exact.status !== "found";
    const artifact = verified && artifacts.find(row => row.id === asset.artifact_id && row.business_id === asset.business_id && row.workflow_run_id === workflow.id);
    const pathMatches = asset.storage_path === `${asset.business_id}/${asset.creative_run_id}/version-${asset.version}.png`;
    // Missing legacy artifact pointers do not invalidate owned assets or the existing preview contract.
    const reason = exactUnavailable ? "The selected asset's independent exact record could not be verified." : !verified ? "The exact asset run, approval and workflow could not all be verified." : !pathMatches ? "The saved preview path does not match this Business, creative run and version." : null;
    return { ...asset, signedUrl: null, workIdentity: verified ? { businessId: asset.business_id, workflowRunId: workflow.id, artifactId: artifact ? artifact.id : null } : null,
      artifactStatus: artifact ? "verified" : asset.artifact_id ? "unavailable" : "missing", contextStatus: verified && !exactUnavailable ? "verified" : "unavailable", status: workflow?.status ?? null, completedAt: verified && !exactUnavailable ? workflow.completed_at : undefined, previewStatus: "unavailable", previewReason: reason };
  });
  // Validate exact selected provenance before signing its preview. Lists do not fetch phase JSON.
  const selected = exact.status === "found" ? hydrated.find(asset => asset.id === exact.item.id) : undefined;
  let provenance: StoredImageProvenance | null = null;
  const detailErrors: string[] = [];
  let artifactSelection: ConsoleCollectionSelection<ConsoleLibraryArtifactDetail> = noSelection();
  if (selected && exact.status === "found" && detail) {
    if (detail.selection.status !== "found" || detail.approval.status !== "found" || detail.workflow.status !== "found") {
      // Keep independently verified metadata navigation, but exact selection cannot claim complete preview authority.
      selected.contextStatus = "unavailable"; selected.completedAt = undefined;
      selected.previewReason = "The selected asset's exact run, approval or workflow detail is unavailable."; detailErrors.push(selected.previewReason);
    }
    if (detail.selection.status === "found" && (detail.selection.item.business_id !== selected.business_id || detail.selection.item.approval_id !== selected.approval_id || detail.selection.item.candidate_id !== selected.candidate_id || selected.workIdentity && detail.selection.item.workflow_run_id !== selected.workIdentity.workflowRunId)) {
      selected.contextStatus = "unavailable"; selected.completedAt = undefined; selected.workIdentity = null; selected.status = null;
      selected.previewReason = "Exact creative run context conflicts with the saved asset."; detailErrors.push(selected.previewReason);
    }
    const phase = detail.outputs.records.find(row => row.call_key === `generate:${selected.version}`);
    provenance = verifiedProvenance(selected, exact.item.inspection, phase);
    if (phase?.output.provenance !== undefined && !provenance) { selected.previewReason = "Saved image provenance does not match the selected asset."; detailErrors.push(selected.previewReason); }
    if (phase && phase.output.provenance === undefined) detailErrors.push("Saved source normalization provenance is unavailable for this asset.");
    if (detail.outputs.status !== "ready") { selected.contextStatus = "unavailable"; selected.completedAt = undefined; selected.previewReason = "Image provenance completeness is unavailable."; detailErrors.push(selected.previewReason); }
    else if (!phase) detailErrors.push("The selected asset's generation output is unavailable.");
    if (selected.artifact_id && selected.workIdentity) {
      artifactSelection = await consoleExactSelection<ConsoleLibraryArtifactDetail>(context, "artifacts", ARTIFACT_DETAIL, selected.artifact_id, [selected.business_id], row => artifactDetailGuard(row) && row.workflow_run_id === selected.workIdentity!.workflowRunId && row.artifact_type === "creative.image" && row.media_type === "image/png" && row.storage_path === selected.storage_path && row.checksum === selected.asset_hash, selected.workIdentity.workflowRunId);
      if (artifactSelection.status === "found") { selected.workIdentity.artifactId = artifactSelection.item.id; selected.artifactStatus = "verified"; artifactSelection = { status: "found", item: { ...artifactSelection.item, version: null } }; }
      else { selected.workIdentity.artifactId = null; selected.artifactStatus = "unavailable"; detailErrors.push("The selected image's exact artifact content could not be verified."); }
    } else if (selected.artifact_id) { artifactSelection = unavailableSelection(); detailErrors.push("The selected artifact has no verified workflow context."); }
  }
  const signed = await signPreviews(context, hydrated.filter(asset => asset.previewReason === null).map(asset => asset.storage_path), errors);
  for (const asset of hydrated) { asset.signedUrl = asset.previewReason === null ? signed.get(asset.storage_path) ?? null : null; asset.previewStatus = asset.signedUrl ? "ready" : "unavailable"; if (!asset.signedUrl && asset.previewReason === null) asset.previewReason = "The owner-session storage preview is unavailable."; }
  let selection: ConsoleCollectionSelection<ConsoleLibraryDesignDetail> = exact.status === "found" ? unavailableSelection() : exact;
  if (selected && exact.status === "found" && detail) {
    const selectedErrors = consoleDistinct([...detail.errors, ...detailErrors, ...(selected.previewReason ? [selected.previewReason] : [])]);
    selection = { status: "found", item: { ...selected, inspection: exact.item.inspection, provenance, artifact: artifactSelection, runDetail: detail, complete: !selectedErrors.length, errors: selectedErrors } };
    errors.push(...selectedErrors);
  }
  for (const asset of hydrated) if (asset.previewReason) errors.push(asset.previewReason);
  return { query: q, page: { ...page, items: page.items.map(asset => hydrated.find(row => row.id === asset.id)!) }, selection, runDetail, errors: consoleDistinct(errors) };
}
