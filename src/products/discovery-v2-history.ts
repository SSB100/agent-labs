import { createHash } from "node:crypto";
import {
  DISCOVERY_V2, DISCOVERY_V2_EXECUTION_PREREQUISITES, DISCOVERY_V2_SNAPSHOT_BYTES,
  REVIEW_CHECKS_V2, discoveryV2Hash, discoveryV2SnapshotByteLength,
  type DiscoveryIntentV2, type DiscoveryDossierV2, type DossierPackRefV2, type EvidenceRefV2,
  type StrategistAssessmentV2, type ReviewerDecisionV2, type DiscoveryOutcomeV2,
} from "./discovery-v2";
import { DIMENSIONS } from "./types";
import { WORKFLOW_RUN_STATUSES, WORKFLOW_STAGE_RUN_STATUSES } from "../core/contracts";
import { canonicalResearchUrl, validateResearchRequest } from "../research/sources";
import type { EvidencePack } from "../research/types";

/** Read-only saved-record integrity, not authentication, execution admission or qualification.
 * The caller authenticates and loads exact owner-scoped records. No function here reads,
 * refreshes, repairs, signs, prices, or writes anything. All displayed strings are plain text;
 * never pass them to an HTML/Markdown interpreter. R06 owns graph/wire-byte guarantees. */
export type DiscoveryHistoryIssueKind = "missing" | "malformed" | "mismatched" | "partial" | "stale";
export type DiscoveryHistoryIssue = { kind: DiscoveryHistoryIssueKind; path: string; code: string };
export type DiscoveryHistoryIntegrity = "verified" | Exclude<DiscoveryHistoryIssueKind, "stale">;
export type DiscoveryHistoryFreshness = "within_saved_window" | "stale" | "unknown";
export type DiscoveryHistoryScope = { businessId: string; experimentId: string; workflowRunId: string };
/** Explicit selected leaves. Never require or reconstruct the full variables JSON. */
export type DiscoveryHistoryExperiment = {
  id: string; business_id: string; workflow_run_id: string; discovery_version: string;
  candidate_id: null; parent_discovery_id: null; status: string; completed_at: string | null;
  source_artifact_id: string | null; intent: unknown; policy_hash: unknown;
  prior_artifact_ids: unknown; prior_evidence_hashes: unknown; analysis_source: unknown;
  evidence_pack: unknown; follow_up_basis?: unknown;
};
export type DiscoveryHistoryWorkflow = {
  id: string; business_id: string; status: string; completed_at: string | null;
  intent_id: string; workflow_key: string; workflow_version: string;
};
export type DiscoveryHistoryArtifact = {
  id: string; business_id: string; workflow_run_id: string; artifact_type: string;
  media_type: string; content: unknown; metadata: unknown;
};
export type DiscoveryHistoryStage = {
  id: string; business_id: string; workflow_run_id: string; stage_key: string;
  attempt: number; status: string; completed_at: string | null; output: unknown;
};
export type DiscoveryHistoryAnalysisSource = {
  experiment: unknown; workflow: unknown; dossier: unknown; plan: unknown; planStage: unknown;
  /** A carried plan can predate the direct source round. These are its exact saved origin. */
  planExperiment: unknown; planWorkflow: unknown;
};
export type DiscoveryHistoryPreflightInput = {
  scope: DiscoveryHistoryScope; experiment: unknown; workflow: unknown; dossier: unknown;
  analysisSource?: DiscoveryHistoryAnalysisSource | null;
};
export type DiscoveryHistoryPreflight = {
  integrity: DiscoveryHistoryIntegrity; issues: DiscoveryHistoryIssue[];
  /** Empty unless all pins and bounds are consistent. Call before any evidence lookup. */
  artifactIds: string[]; packRefs: DossierPackRefV2[];
  intent: DiscoveryIntentV2 | null; dossier: DiscoveryDossierV2 | null;
};
/** Query must be an exact persisted plan/input projection, never supplied by a worker.
 * It is cross-checked against the preserved source artifact and dossier scope. These
 * checks do not attest provider truth or the complete task/settlement ledger. */
export type DiscoveryHistoryQuery = {
  id: string; business_id: string; workflow_run_id: string;
  collected_for_intent_id: string | null; question: string; source_domains: string[];
};
export type DiscoveryHistoryEvidenceRecord = {
  artifact: unknown; workflow: unknown; query: unknown; source: unknown; stage: unknown;
};
export type DiscoveryHistoryPhase = { artifact: unknown; stage: unknown };
export type DiscoveryHistoryInput = DiscoveryHistoryPreflightInput & {
  /** Explicit observation time only labels saved windows; it never renews them. */
  observedAt: string;
  evidenceRecords: readonly DiscoveryHistoryEvidenceRecord[];
  strategy: DiscoveryHistoryPhase | null; review: DiscoveryHistoryPhase | null;
};
export type DiscoveryHistorySpan = {
  reference: EvidenceRefV2; quote: string; url: string; retrievedAt: string;
  publishedAt: string | null; expiresAt: string; freshness: DiscoveryHistoryFreshness;
};
export type DiscoveryHistoryResult = {
  integrity: DiscoveryHistoryIntegrity; freshness: DiscoveryHistoryFreshness;
  issues: DiscoveryHistoryIssue[]; evidenceArtifactIds: string[];
  intent: DiscoveryIntentV2 | null; dossier: DiscoveryDossierV2 | null;
  strategy: StrategistAssessmentV2 | null; review: ReviewerDecisionV2 | null;
  evidence: { artifactId: string; pack: EvidencePack; freshness: DiscoveryHistoryFreshness }[];
  spans: DiscoveryHistorySpan[];
  reviewState: "completed_historical_review" | "saved_output" | "unavailable";
  recordedOutcome: DiscoveryOutcomeV2 | null;
  /** Deliberately does not expose product acceptance, available funds or execution grants. */
  rendering: "plain_text";
  verificationScope: "saved_content_and_direct_linkage";
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[a-f0-9]{64}$/;
const SOURCE = /^src-[a-f0-9]{24}$/;
const EVIDENCE = /^evi-[a-f0-9]{24}$/;
const OUTCOMES = ["TEST", "REJECT", "NEEDS_MORE_EVIDENCE"];
const WORKFLOWS = ["product.discovery-v2.analysis", "product.discovery-v2.one", "product.discovery-v2.two"];
/** Immutable 1.0.0 catalog stages, not a caller-selected stage-name allowlist. */
const RESEARCH_STAGES: Readonly<Record<string, readonly string[]>> = {
  "research.public-evidence": ["research"],
  "product.discovery-v2.one": ["research1"],
  "product.discovery-v2.two": ["research1", "research2"],
};
const hashText = (text: string) => createHash("sha256").update(text).digest("hex");
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
class InvalidHistory extends Error {
  constructor(readonly kind: DiscoveryHistoryIssueKind, readonly code: string) { super(code); }
}
function fail(code: string, kind: DiscoveryHistoryIssueKind = "malformed"): never { throw new InvalidHistory(kind, code); }
function required(v: unknown): void { if (v === undefined || v === null) fail("required_record_missing", "missing"); }
function fields<T>(v: unknown, keys: string): T {
  required(v);
  if (!object(v)) fail("object_required");
  const expected = keys.split(",");
  if (expected.some(key => !Object.hasOwn(v, key))) fail("required_fields_missing", "missing");
  if (Object.keys(v).some(key => !expected.includes(key))) fail("unexpected_fields");
  return v as T;
}
function projected<T>(v: unknown, keys: string): T {
  required(v);
  if (!object(v)) fail("object_required");
  if (keys.split(",").some(key => !Object.hasOwn(v, key))) fail("required_projection_missing", "missing");
  return v as T;
}
function text(v: unknown, min = 1, max = 1200): asserts v is string {
  if (typeof v !== "string" || Array.from(v.trim()).length < min || Array.from(v).length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)) fail("bounded_plain_text_required");
}
function uuid(v: unknown): asserts v is string { if (typeof v !== "string" || !UUID.test(v)) fail("invalid_uuid"); }
function sha(v: unknown): asserts v is string { if (typeof v !== "string" || !SHA.test(v)) fail("invalid_sha256"); }
function integer(v: unknown, min: number, max: number): asserts v is number { if (!Number.isSafeInteger(v) || (v as number) < min || (v as number) > max) fail("invalid_integer_bound"); }
function array<T = unknown>(v: unknown, min: number, max: number): T[] {
  if (!Array.isArray(v) || v.length < min || v.length > max) fail("invalid_array_bound");
  return v as T[];
}
function unique(values: readonly unknown[]): void { if (new Set(values).size !== values.length) fail("duplicate_identity"); }
function strings(v: unknown, min: number, max: number, textMin = 1, textMax = 600): string[] {
  const values = array<string>(v, min, max); values.forEach(x => text(x, textMin, textMax)); unique(values); return values;
}
function same(a: unknown, b: unknown, code: string): void { if (discoveryV2Hash(a) !== discoveryV2Hash(b)) fail(code, "mismatched"); }
function sameIds(a: readonly string[], b: readonly string[], code: string): void { same([...a].sort(), [...b].sort(), code); }
function equal(a: unknown, b: unknown, code: string): void { if (a !== b) fail(code, "mismatched"); }
function timestamp(v: unknown): number {
  if (typeof v !== "string") fail("invalid_timestamp");
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):?(\d{2}))$/.exec(v);
  if (!parts) fail("invalid_timestamp");
  const [, y, m, d, h, minute, second, zoneHour, zoneMinute] = parts;
  const year = Number(y), month = Number(m), day = Number(d);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  // Date.parse normalizes impossible dates (for example February 30) and 24:00.
  // Validate the original local calendar and zone before deriving its instant.
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1] || Number(h) > 23 || Number(minute) > 59 || Number(second) > 59 ||
    zoneHour !== undefined && (Number(zoneHour) > 23 || Number(zoneMinute) > 59) || !Number.isFinite(Date.parse(v))) fail("invalid_timestamp");
  return Date.parse(v);
}
/** Post-input producer/render checks, NOT a database or pre-transfer byte bound. */
function snapshot(value: unknown, maximum: number): void {
  let nodes = 0;
  const seen = new Set<object>();
  const visit = (v: unknown, depth: number): void => {
    if (++nodes > 15000 || depth > 24) fail("render_graph_limit");
    if (typeof v === "string") { if (v.length > maximum) fail("render_text_limit"); return; }
    if (v === null || typeof v === "boolean" || typeof v === "number" && Number.isFinite(v)) return;
    if (!object(v) && !Array.isArray(v)) fail("non_json_snapshot");
    if (seen.has(v)) fail("cyclic_snapshot");
    seen.add(v);
    for (const child of Object.values(v)) visit(child, depth + 1);
    seen.delete(v);
  };
  visit(value, 0);
  if (discoveryV2SnapshotByteLength(value) > maximum) fail("post_input_snapshot_limit");
}
function capture<T>(issues: DiscoveryHistoryIssue[], path: string, work: () => T): T | null {
  try { return work(); } catch (error) {
    issues.push({ kind: error instanceof InvalidHistory ? error.kind : "malformed", path, code: error instanceof InvalidHistory ? error.code : "invalid_saved_record" });
    return null;
  }
}
function integrity(issues: readonly DiscoveryHistoryIssue[]): DiscoveryHistoryIntegrity {
  for (const kind of ["mismatched", "malformed", "missing", "partial"] as const) if (issues.some(issue => issue.kind === kind)) return kind;
  return "verified";
}
function historicalIntent(value: unknown): DiscoveryIntentV2 {
  required(value); snapshot(value, 20000);
  const v = fields<DiscoveryIntentV2>(value, "version,id,businessId,objective,comparisonUniverse,limits,expiresAt");
  equal(v.version, DISCOVERY_V2, "intent_version"); uuid(v.id); uuid(v.businessId); text(v.objective, 20); timestamp(v.expiresAt);
  fields(v.comparisonUniverse, "productType,markets,audiences,sourceDomains,selectionQuestion");
  const u = v.comparisonUniverse;
  equal(u.productType, "original_pod_tshirt", "product_scope");
  array<DiscoveryIntentV2["comparisonUniverse"]["markets"][number]>(u.markets, 2, 4).forEach(m => { fields(m, "countryCode,currency"); if (!/^[A-Z]{2}$/.test(m.countryCode) || !/^[A-Z]{3}$/.test(m.currency)) fail("invalid_market"); });
  unique(u.markets.map(m => m.countryCode)); strings(u.audiences, 1, 3, 3); text(u.selectionQuestion, 20, 800);
  validateResearchRequest({ query: u.selectionQuestion, allowedDomains: u.sourceDomains });
  fields(v.limits, "maximumAlternatives,maximumNewCollections,maximumMicrousd,maximumGenerations");
  equal(v.limits.maximumAlternatives, 3, "alternative_bound"); integer(v.limits.maximumNewCollections, 0, 2); integer(v.limits.maximumMicrousd, 1, 2000000); integer(v.limits.maximumGenerations, 1, 2);
  return v;
}
function rootPair(rootValue: unknown, runValue: unknown, scope: DiscoveryHistoryScope) {
  uuid(scope.businessId); uuid(scope.experimentId); uuid(scope.workflowRunId);
  const root = projected<DiscoveryHistoryExperiment>(rootValue, "id,business_id,workflow_run_id,discovery_version,candidate_id,parent_discovery_id,status,completed_at,source_artifact_id,intent,policy_hash");
  const run = projected<DiscoveryHistoryWorkflow>(runValue, "id,business_id,status,completed_at,intent_id,workflow_key,workflow_version");
  equal(root.id, scope.experimentId, "experiment_identity"); equal(root.business_id, scope.businessId, "experiment_business"); equal(root.workflow_run_id, scope.workflowRunId, "experiment_run");
  equal(run.id, scope.workflowRunId, "workflow_identity"); equal(run.business_id, scope.businessId, "workflow_business"); equal(run.intent_id, root.id, "workflow_intent");
  equal(root.discovery_version, DISCOVERY_V2, "root_version"); equal(root.candidate_id, null, "not_discovery_root"); equal(root.parent_discovery_id, null, "not_discovery_root");
  if (!["reserved", "researching", "completed", "failed"].includes(root.status) || !WORKFLOW_RUN_STATUSES.includes(run.status as typeof WORKFLOW_RUN_STATUSES[number])) fail("unknown_record_status");
  if (root.completed_at !== null) timestamp(root.completed_at); if (run.completed_at !== null) timestamp(run.completed_at);
  if (root.source_artifact_id !== null) uuid(root.source_artifact_id);
  if (!WORKFLOWS.includes(run.workflow_key) || run.workflow_version !== "1.0.0") fail("workflow_identity", "mismatched");
  const intent = historicalIntent(root.intent); equal(intent.id, root.id, "intent_identity"); equal(intent.businessId, scope.businessId, "intent_business"); sha(root.policy_hash); equal(root.policy_hash, discoveryV2Hash(intent), "policy_hash");
  equal(run.workflow_key, WORKFLOWS[intent.limits.maximumNewCollections], "workflow_collection_scope");
  return { root, run, intent };
}
function artifact(value: unknown, businessId: string, runId?: string, type?: string): DiscoveryHistoryArtifact {
  const a = projected<DiscoveryHistoryArtifact>(value, "id,business_id,workflow_run_id,artifact_type,media_type,content,metadata");
  uuid(a.id); uuid(a.workflow_run_id); equal(a.business_id, businessId, "artifact_business");
  if (runId !== undefined) equal(a.workflow_run_id, runId, "artifact_run");
  if (type !== undefined) equal(a.artifact_type, type, "artifact_type");
  equal(a.media_type, "application/json", "artifact_media_type"); if (!object(a.metadata)) fail("artifact_metadata");
  return a;
}
function dossierValue(value: unknown, intent: DiscoveryIntentV2): DiscoveryDossierV2 {
  snapshot(value, DISCOVERY_V2_SNAPSHOT_BYTES.dossier);
  const d = fields<DiscoveryDossierV2>(value, "version,intentId,businessId,packRefs,shortlist,comparisonRationale");
  equal(d.version, DISCOVERY_V2, "dossier_version"); equal(d.intentId, intent.id, "dossier_intent"); equal(d.businessId, intent.businessId, "dossier_business");
  text(d.comparisonRationale, 40); array(d.packRefs, 1, 6); array(d.shortlist, 1, 3);
  for (const ref of d.packRefs) {
    fields(ref, "artifactId,sha256,origin,query"); uuid(ref.artifactId); sha(ref.sha256); if (!["prior", "new"].includes(ref.origin)) fail("pack_origin");
    fields(ref.query, "id,question,sourceDomains"); uuid(ref.query.id); text(ref.query.question, 5, 800); validateResearchRequest({ query: ref.query.question, allowedDomains: ref.query.sourceDomains });
    if (ref.query.sourceDomains.some(domain => !intent.comparisonUniverse.sourceDomains.includes(domain))) fail("query_source_scope", "mismatched");
  }
  unique(d.packRefs.map(r => r.artifactId)); unique(d.packRefs.map(r => r.query.id));
  if (d.packRefs.filter(r => r.origin === "prior").length > 4 || d.packRefs.filter(r => r.origin === "new").length > intent.limits.maximumNewCollections) fail("collection_reference_bound", "mismatched");
  for (const candidate of d.shortlist) {
    fields(candidate, "id,businessId,concept,audience,productType,originalDesign,rightsStatus"); uuid(candidate.id); equal(candidate.businessId, intent.businessId, "candidate_business");
    text(candidate.concept, 3, 160); text(candidate.audience, 3, 160); equal(candidate.productType, "original_pod_tshirt", "candidate_product");
    if (typeof candidate.originalDesign !== "boolean" || !["confirmed", "unclear"].includes(candidate.rightsStatus)) fail("candidate_declarations");
    if (!intent.comparisonUniverse.audiences.includes(candidate.audience)) fail("candidate_audience", "mismatched");
  }
  unique(d.shortlist.map(c => c.id)); return d;
}
function dossierArtifact(value: unknown, root: DiscoveryHistoryExperiment, intent: DiscoveryIntentV2) {
  const a = artifact(value, root.business_id, root.workflow_run_id, "product.discovery-dossier.v2");
  required(root.source_artifact_id); equal(a.id, root.source_artifact_id, "source_descriptor_dossier");
  const d = dossierValue(a.content, intent), metadata = a.metadata as Record<string, unknown>;
  required(metadata.contentHash); sha(metadata.contentHash); equal(metadata.contentHash, discoveryV2Hash(d), "dossier_content_hash");
  equal(metadata.version, DISCOVERY_V2, "dossier_metadata_version"); equal(metadata.intentId, intent.id, "dossier_metadata_intent");
  return { artifact: a, dossier: d };
}
type Descriptor = { version: string; intentId: string; dossierArtifactId: string; strategyArtifactId: string; reviewArtifactId: string };
function descriptor(value: unknown, intentId: string, dossierId: string): Descriptor {
  const v = fields<Descriptor>(value, "version,intentId,dossierArtifactId,strategyArtifactId,reviewArtifactId");
  equal(v.version, DISCOVERY_V2, "descriptor_version"); equal(v.intentId, intentId, "descriptor_intent"); equal(v.dossierArtifactId, dossierId, "descriptor_dossier");
  [v.dossierArtifactId, v.strategyArtifactId, v.reviewArtifactId].forEach(uuid); unique([v.dossierArtifactId, v.strategyArtifactId, v.reviewArtifactId]); return v;
}
function checkAnalysis(input: DiscoveryHistoryPreflightInput, root: DiscoveryHistoryExperiment, intent: DiscoveryIntentV2, dossier: DiscoveryDossierV2): void {
  if (intent.limits.maximumNewCollections !== 0) { if (root.analysis_source !== null) fail("unexpected_analysis_source", "mismatched"); return; }
  type Pins = { sourceRootId: string; planArtifactId: string; planHash: string; dossierArtifactId: string; dossierHash: string };
  const pins = fields<Pins>(root.analysis_source, "sourceRootId,planArtifactId,planHash,dossierArtifactId,dossierHash");
  [pins.sourceRootId, pins.planArtifactId, pins.dossierArtifactId].forEach(uuid); [pins.planHash, pins.dossierHash].forEach(sha);
  const basis = projected<{ rootId: string; reason: string }>(root.follow_up_basis, "rootId,reason");
  equal(basis.rootId, pins.sourceRootId, "analysis_follow_up_root"); equal(basis.reason, "reuse_evidence_for_strategy_review", "analysis_follow_up_reason");
  if (pins.sourceRootId === root.id) fail("analysis_self_reference", "mismatched");
  const source = input.analysisSource; required(source); if (!source) return;
  const sourceRoot = projected<DiscoveryHistoryExperiment>(source.experiment, "id,business_id,workflow_run_id");
  equal(sourceRoot.id, pins.sourceRootId, "analysis_source_root");
  const prior = rootPair(source.experiment, source.workflow, { businessId: root.business_id, experimentId: pins.sourceRootId, workflowRunId: sourceRoot.workflow_run_id });
  equal(prior.root.status, "failed", "analysis_source_status"); equal(prior.run.status, "failed", "analysis_source_run_status");
  const previous = dossierArtifact(source.dossier, prior.root, prior.intent);
  equal(previous.artifact.id, pins.dossierArtifactId, "analysis_dossier_identity"); equal(discoveryV2Hash(previous.dossier), pins.dossierHash, "analysis_dossier_hash");
  array(dossier.packRefs, 1, 4); array(previous.dossier.packRefs, 1, 4);
  const sortRefs = (refs: DossierPackRefV2[]) => refs.map(ref => ({ ...ref, origin: "prior" })).sort((a, b) => a.artifactId.localeCompare(b.artifactId));
  same(dossier.packRefs.slice().sort((a, b) => a.artifactId.localeCompare(b.artifactId)), sortRefs(previous.dossier.packRefs), "analysis_exact_pack_set");
  same(dossier.shortlist, previous.dossier.shortlist, "analysis_exact_shortlist"); equal(dossier.comparisonRationale, previous.dossier.comparisonRationale, "analysis_exact_rationale");
  const planRoot = projected<DiscoveryHistoryExperiment>(source.planExperiment, "id,business_id,workflow_run_id");
  const planPair = rootPair(source.planExperiment, source.planWorkflow, { businessId: root.business_id, experimentId: planRoot.id, workflowRunId: planRoot.workflow_run_id });
  if (planPair.intent.limits.maximumNewCollections === 0) fail("analysis_plan_cannot_originate_from_analysis", "mismatched");
  if (prior.run.workflow_key === "product.discovery-v2.analysis") {
    const carried = fields<Pins>(prior.root.analysis_source, "sourceRootId,planArtifactId,planHash,dossierArtifactId,dossierHash");
    [carried.sourceRootId, carried.planArtifactId, carried.dossierArtifactId].forEach(uuid); [carried.planHash, carried.dossierHash].forEach(sha);
    equal(pins.planArtifactId, carried.planArtifactId, "analysis_carried_plan_identity"); equal(pins.planHash, carried.planHash, "analysis_carried_plan_hash");
  } else {
    equal(planPair.root.id, prior.root.id, "analysis_source_own_plan_root"); equal(planPair.run.id, prior.run.id, "analysis_source_own_plan_run");
  }
  same(planPair.intent.comparisonUniverse, prior.intent.comparisonUniverse, "analysis_plan_goal_scope"); equal(planPair.intent.objective, prior.intent.objective, "analysis_plan_goal_objective");
  const plan = artifact(source.plan, root.business_id, planPair.run.id, "worker.output");
  equal(plan.id, pins.planArtifactId, "analysis_plan_identity"); snapshot(plan.content, 20000); equal(discoveryV2Hash(plan.content), pins.planHash, "analysis_plan_hash");
  completedStage(source.planStage, plan, "plan");
  const content = projected<{ version: string; intentId: string; comparisonRationale: string }>(plan.content, "version,intentId,comparisonRationale");
  equal((plan.metadata as Record<string, unknown>).stageKey, "plan", "analysis_plan_stage"); equal(content.version, DISCOVERY_V2, "analysis_plan_version"); equal(content.intentId, planPair.root.id, "analysis_plan_intent"); equal(content.comparisonRationale, dossier.comparisonRationale, "analysis_plan_rationale");
  same(intent.comparisonUniverse, prior.intent.comparisonUniverse, "analysis_goal_scope"); equal(intent.objective, prior.intent.objective, "analysis_goal_objective");
}

/** No network and no fallback union: invalid/missing pins always produce zero fetch IDs. */
export function discoveryV2HistoryEvidencePreflight(input: DiscoveryHistoryPreflightInput): DiscoveryHistoryPreflight {
  const issues: DiscoveryHistoryIssue[] = [];
  capture(issues, "recordCoherence", () => entityConsistency(input));
  const pair = capture(issues, "selection", () => rootPair(input.experiment, input.workflow, input.scope));
  const found = pair && capture(issues, "dossier", () => dossierArtifact(input.dossier, pair.root, pair.intent));
  if (pair && found) capture(issues, "evidencePins", () => {
    const root = projected<DiscoveryHistoryExperiment>(input.experiment, "prior_artifact_ids,prior_evidence_hashes,analysis_source,evidence_pack");
    const prior = array<string>(root.prior_artifact_ids, 0, 4); prior.forEach(uuid); unique(prior);
    const pins = array<{ artifactId: string; sha256: string }>(root.prior_evidence_hashes, 0, 4);
    pins.forEach(pin => { fields(pin, "artifactId,sha256"); uuid(pin.artifactId); sha(pin.sha256); }); unique(pins.map(pin => pin.artifactId));
    sameIds(prior, pins.map(pin => pin.artifactId), "prior_ids_hashes_exact_set");
    const carried = found.dossier.packRefs.filter(ref => ref.origin === "prior");
    sameIds(prior, carried.map(ref => ref.artifactId), "dossier_prior_exact_set");
    for (const ref of carried) equal(ref.sha256, pins.find(pin => pin.artifactId === ref.artifactId)?.sha256, "dossier_prior_hash");
    const selected = descriptor(root.evidence_pack, pair.intent.id, found.artifact.id);
    const reservedIds = [selected.dossierArtifactId, selected.strategyArtifactId, selected.reviewArtifactId];
    if (found.dossier.packRefs.some(ref => reservedIds.includes(ref.artifactId))) fail("evidence_phase_identity_collision", "mismatched");
    checkAnalysis(input, pair.root, pair.intent, found.dossier);
  });
  const state = integrity(issues);
  return { integrity: state, issues, artifactIds: state === "verified" && found ? found.dossier.packRefs.map(ref => ref.artifactId) : [],
    packRefs: state === "verified" && found ? structuredClone(found.dossier.packRefs) : [], intent: pair ? structuredClone(pair.intent) : null,
    dossier: found ? structuredClone(found.dossier) : null };
}

function completedStage(value: unknown, a: DiscoveryHistoryArtifact, stageKey: string): DiscoveryHistoryStage {
  const stage = projected<DiscoveryHistoryStage>(value, "id,business_id,workflow_run_id,stage_key,attempt,status,completed_at,output");
  uuid(stage.id); equal(stage.business_id, a.business_id, "stage_business"); equal(stage.workflow_run_id, a.workflow_run_id, "stage_run");
  equal(stage.stage_key, stageKey, "stage_identity"); equal((a.metadata as Record<string, unknown>).stageKey, stageKey, "artifact_stage");
  equal(stage.attempt, 1, "stage_attempt");
  if (!WORKFLOW_STAGE_RUN_STATUSES.includes(stage.status as typeof WORKFLOW_STAGE_RUN_STATUSES[number])) fail("unknown_stage_status");
  if (stage.status !== "completed" || stage.completed_at === null) fail("stage_not_completed", "partial");
  timestamp(stage.completed_at); snapshot(stage.output, 65536); same(stage.output, a.content, "stage_output"); return stage;
}
function freshness(expiresAt: string, observed: number, retrievedAt?: string): DiscoveryHistoryFreshness {
  if (timestamp(expiresAt) <= observed) return "stale";
  return retrievedAt !== undefined && timestamp(retrievedAt) > observed ? "unknown" : "within_saved_window";
}
function safeUrl(value: unknown, domains: readonly string[]): string {
  text(value, 8, 2048);
  if (/[\s<>\\]/.test(value) || /%(?:00|0a|0d)/i.test(value)) fail("unsafe_source_url");
  try { if (canonicalResearchUrl(value, domains) !== value) fail("noncanonical_source_url"); } catch { fail("unsafe_source_url"); }
  return value;
}
function evidenceOrigin(ref: DossierPackRefV2, scope: DiscoveryHistoryScope, runId: string, collectedForIntentId: string | null): void {
  if (ref.origin === "new") { equal(runId, scope.workflowRunId, "new_evidence_run"); equal(collectedForIntentId, scope.experimentId, "new_evidence_intent"); }
  else if (runId === scope.workflowRunId || collectedForIntentId === scope.experimentId) fail("prior_origin_relabelled", "mismatched");
}
function evidenceRecord(value: DiscoveryHistoryEvidenceRecord, ref: DossierPackRefV2, scope: DiscoveryHistoryScope, observed: number,
  sourceOrigin?: { ref: DossierPackRefV2; scope: DiscoveryHistoryScope }) {
  const a = artifact(value.artifact, scope.businessId, undefined, "worker.output"); equal(a.id, ref.artifactId, "evidence_artifact_identity");
  const run = projected<DiscoveryHistoryWorkflow & { question?: string; source_domains?: string[] }>(value.workflow, "id,business_id,status,workflow_key,workflow_version");
  equal(run.id, a.workflow_run_id, "evidence_run"); equal(run.business_id, scope.businessId, "evidence_run_business");
  if (!WORKFLOW_RUN_STATUSES.includes(run.status as typeof WORKFLOW_RUN_STATUSES[number])) fail("unknown_record_status");
  if (!["running", "completed", "failed"].includes(run.status)) fail("evidence_run_incomplete", "partial");
  equal(run.workflow_version, "1.0.0", "evidence_workflow_version");
  const query = fields<DiscoveryHistoryQuery>(value.query, "id,business_id,workflow_run_id,collected_for_intent_id,question,source_domains");
  uuid(query.id); equal(query.business_id, scope.businessId, "query_business"); equal(query.workflow_run_id, a.workflow_run_id, "query_run");
  equal(query.id, ref.query.id, "query_identity"); equal(query.question, ref.query.question, "query_question"); same(query.source_domains, ref.query.sourceDomains, "query_source_domains");
  validateResearchRequest({ query: query.question, allowedDomains: query.source_domains });
  if (query.collected_for_intent_id !== null) uuid(query.collected_for_intent_id);
  evidenceOrigin(ref, scope, a.workflow_run_id, query.collected_for_intent_id);
  if (sourceOrigin) evidenceOrigin(sourceOrigin.ref, sourceOrigin.scope, a.workflow_run_id, query.collected_for_intent_id);
  const stageKey = (a.metadata as Record<string, unknown>).stageKey; text(stageKey, 1, 100);
  if (!RESEARCH_STAGES[run.workflow_key]?.includes(stageKey)) fail("evidence_workflow_stage", "mismatched");
  const stage = completedStage(value.stage, a, stageKey);
  const source = artifact(value.source, scope.businessId, a.workflow_run_id, "research.sources");
  if (source.id === a.id) fail("source_output_identity_collision", "mismatched");
  equal((source.metadata as Record<string, unknown>).stageKey, stageKey, "source_stage");
  snapshot(source.content, 65536);
  const collection = projected<{ collectionVersion: string; query: string; sources: unknown[]; evidence?: unknown; providerMetadata: Record<string, unknown> }>(source.content, "collectionVersion,query,sources,providerMetadata");
  equal(collection.collectionVersion, "1.0", "source_collection_version"); equal(collection.query, query.question, "source_question"); array(collection.sources, 1, 4);
  if (!object(collection.providerMetadata)) fail("source_metadata");
  if (run.workflow_key === "research.public-evidence") {
    if (run.status !== "completed") fail("public_evidence_run_not_completed", "partial");
    required(run.completed_at); timestamp(run.completed_at);
    required(collection.evidence); array(collection.evidence, 1, 4);
    equal(query.collected_for_intent_id, null, "prior_public_intent"); equal(run.question, query.question, "public_research_question"); same(run.source_domains, query.source_domains, "public_research_domains");
  } else {
    equal(run.intent_id, query.collected_for_intent_id, "evidence_origin_intent");
    equal(collection.providerMetadata.intentId, query.collected_for_intent_id, "source_intent"); equal(collection.providerMetadata.queryId, query.id, "source_query");
  }
  snapshot(a.content, 65536);
  const output = projected<{ decision: string; stopReason: string; evidencePack: unknown }>(a.content, "decision,stopReason,evidencePack");
  equal(output.decision, "complete", "evidence_output_decision"); equal(output.stopReason, "evidence_collected", "evidence_output_stop");
  const pack = fields<EvidencePack>(output.evidencePack, "evidencePackVersion,question,sources,evidence,claims,limitations");
  equal(pack.evidencePackVersion, "1.0", "evidence_pack_version"); equal(pack.question, query.question, "pack_question"); equal(discoveryV2Hash(pack), ref.sha256, "pack_content_hash");
  array(pack.sources, 1, 4); array(pack.evidence, 1, 4); array(pack.claims, pack.evidence.length, pack.evidence.length); strings(pack.limitations, 0, 16, 1, 600);
  unique(pack.sources.map(s => s.id)); unique(pack.evidence.map(e => e.id));
  let state: DiscoveryHistoryFreshness = "within_saved_window";
  for (const s of pack.sources) {
    fields(s, "id,url,title,retrievedAt,publishedAt,retrievalExpiresAt,contentHash,excerpt,provider");
    text(s.id, 28, 28); if (!SOURCE.test(s.id)) fail("source_identity_format"); sha(s.contentHash); text(s.excerpt, 30, 1800); text(s.title, 1, 250); safeUrl(s.url, query.source_domains);
    equal(s.provider, "openrouter.exa", "source_provider"); equal(hashText(s.excerpt), s.contentHash, "source_excerpt_hash"); equal(s.id, `src-${hashText(`${s.url}:${s.contentHash}`).slice(0, 24)}`, "source_content_identity");
    const retrieved = timestamp(s.retrievedAt), expiry = timestamp(s.retrievalExpiresAt);
    if (expiry <= retrieved || expiry > retrieved + 86400000 || retrieved > timestamp(stage.completed_at!) + 300000) fail("source_saved_window");
    if (s.publishedAt !== null) timestamp(s.publishedAt);
    if (!collection.sources.some(saved => discoveryV2Hash(saved) === discoveryV2Hash(s))) fail("source_collection_binding", "mismatched");
    if (!pack.evidence.some(e => e.sourceId === s.id)) fail("unreferenced_pack_source", "mismatched");
    const sourceState = freshness(s.retrievalExpiresAt, observed, s.retrievedAt);
    if (sourceState === "stale" || sourceState === "unknown" && state !== "stale") state = sourceState;
  }
  for (const e of pack.evidence) {
    fields(e, "id,sourceId,quote"); text(e.id, 28, 28); if (!EVIDENCE.test(e.id)) fail("evidence_identity_format"); text(e.sourceId, 28, 28); text(e.quote, 20, 320);
    const s = pack.sources.find(source => source.id === e.sourceId);
    if (!s || !s.excerpt.includes(e.quote)) fail("evidence_saved_quote", "mismatched");
    equal(e.id, `evi-${hashText(`${e.sourceId}:${e.quote}`).slice(0, 24)}`, "evidence_content_identity");
    if (run.workflow_key === "research.public-evidence" && !(collection.evidence as unknown[]).some(saved => discoveryV2Hash(saved) === discoveryV2Hash(e))) fail("public_collection_evidence_binding", "mismatched");
    if (pack.claims.filter(c => c.evidenceId === e.id && c.sourceId === e.sourceId && c.text === e.quote).length !== 1) fail("claim_evidence_association", "mismatched");
  }
  for (const c of pack.claims) { fields(c, "text,evidenceId,sourceId"); if (!pack.evidence.some(e => c.evidenceId === e.id && c.sourceId === e.sourceId && c.text === e.quote)) fail("unsupported_claim", "mismatched"); }
  return { artifactId: a.id, pack, freshness: state };
}
function noCommerce(v: { publicationAllowed: unknown; commerceAllowed: unknown }): void {
  if (v.publicationAllowed !== false || v.commerceAllowed !== false) fail("display_cannot_grant_authority", "mismatched");
}
function reference(value: unknown): EvidenceRefV2 {
  const ref = fields<EvidenceRefV2>(value, "artifactId,evidenceId,sourceId,sourceContentHash,start,end");
  uuid(ref.artifactId); sha(ref.sourceContentHash);
  if (!EVIDENCE.test(ref.evidenceId) || !SOURCE.test(ref.sourceId)) fail("reference_identity_format");
  integer(ref.start, 0, 1799); integer(ref.end, ref.start + 1, Math.min(ref.start + 320, 1800)); return ref;
}
function referenceList(value: unknown, refs: EvidenceRefV2[], min = 0): void {
  const list = array(value, min, 8).map(reference); unique(list.map(discoveryV2Hash)); refs.push(...list);
}
function uncertainty(value: unknown, dimension = false): void {
  const u = fields<{ question: string; blockingForTest: boolean; reason: string; dimension?: string }>(value, `${dimension ? "dimension," : ""}question,blockingForTest,reason`);
  text(u.question, 15, 240); text(u.reason, 30, 300); if (typeof u.blockingForTest !== "boolean" || dimension && !DIMENSIONS.includes(u.dimension as typeof DIMENSIONS[number])) fail("uncertainty_shape");
}
function phaseArtifact(value: DiscoveryHistoryPhase | null, phase: "strategy" | "review", scope: DiscoveryHistoryScope, id: string) {
  required(value); if (!value) fail("phase_missing", "missing");
  const a = artifact(value.artifact, scope.businessId, scope.workflowRunId, "worker.output"); equal(a.id, id, "phase_descriptor_identity");
  snapshot(a.content, phase === "strategy" ? DISCOVERY_V2_SNAPSHOT_BYTES.strategist : DISCOVERY_V2_SNAPSHOT_BYTES.reviewer);
  completedStage(value.stage, a, phase);
  return a;
}
function phaseBinding(a: DiscoveryHistoryArtifact, value: StrategistAssessmentV2 | ReviewerDecisionV2, intent: DiscoveryIntentV2, dossier: DiscoveryDossierV2): void {
  equal(value.version, DISCOVERY_V2, "phase_version"); equal(value.intentId, intent.id, "phase_intent"); equal(value.dossierHash, discoveryV2Hash(dossier), "phase_dossier_hash"); noCommerce(value);
  fields(value.execution, "modelId,providerRequestId,primaryOnly"); text(value.execution.modelId, 3, 200); text(value.execution.providerRequestId, 3, 240); equal(value.execution.primaryOnly, true, "phase_primary_only");
  const receipt = projected<Record<string, unknown>>((a.metadata as Record<string, unknown>).receipt, "intentId,dossierHash,outputHash,actualProviderModelId,providerRequestId");
  equal(receipt.intentId, intent.id, "receipt_intent"); equal(receipt.dossierHash, value.dossierHash, "receipt_dossier_hash"); equal(receipt.outputHash, discoveryV2Hash(value), "receipt_output_hash");
  equal(receipt.actualProviderModelId, value.execution.modelId, "receipt_model"); equal(receipt.providerRequestId, value.execution.providerRequestId, "receipt_request");
}
function strategyValue(a: DiscoveryHistoryArtifact, intent: DiscoveryIntentV2, dossier: DiscoveryDossierV2, refs: EvidenceRefV2[]): StrategistAssessmentV2 {
  const v = fields<StrategistAssessmentV2>(a.content, "version,intentId,dossierHash,execution,marketComparisons,candidates,recommendation,testPlan,missingQuestions,publicationAllowed,commerceAllowed");
  phaseBinding(a, v, intent, dossier); array(v.marketComparisons, intent.comparisonUniverse.markets.length, intent.comparisonUniverse.markets.length); unique(v.marketComparisons.map(m => m.countryCode));
  for (const market of v.marketComparisons) {
    fields(market, "countryCode,currency,assessment,evidenceRefs,assumptions,limitations,sellerBankCountry,feeScenarios");
    if (!intent.comparisonUniverse.markets.some(m => m.countryCode === market.countryCode && m.currency === market.currency)) fail("strategy_market_scope", "mismatched");
    text(market.assessment, 40); referenceList(market.evidenceRefs, refs); strings(market.assumptions, 0, 8, 15); strings(market.limitations, 1, 8, 15);
    if (market.sellerBankCountry !== null && !/^[A-Z]{2}$/.test(market.sellerBankCountry)) fail("saved_bank_country_shape");
    array(market.feeScenarios, 0, 4);
    for (const scenario of market.feeScenarios) { fields(scenario, "sellerBankCountry,hypothetical,explanation,evidenceRefs"); if (!/^[A-Z]{2}$/.test(scenario.sellerBankCountry) || scenario.hypothetical !== true) fail("saved_fee_scenario"); text(scenario.explanation, 30); referenceList(scenario.evidenceRefs, refs); }
  }
  array(v.candidates, dossier.shortlist.length, dossier.shortlist.length); unique(v.candidates.map(c => c.candidateId));
  for (const candidate of v.candidates) {
    fields(candidate, "candidateId,identityHash,dimensions"); const identity = dossier.shortlist.find(c => c.id === candidate.candidateId);
    if (!identity) fail("strategy_candidate_scope", "mismatched"); equal(candidate.identityHash, discoveryV2Hash(identity), "strategy_candidate_hash");
    array(candidate.dimensions, 9, 9); sameIds(candidate.dimensions.map(d => d.dimension), DIMENSIONS, "strategy_dimension_set");
    for (const d of candidate.dimensions) {
      fields(d, "dimension,finding,evidenceStrength,facts,rationale,uncertainties,hardFailure");
      if (!["supported", "uncertain", "unfavorable"].includes(d.finding) || !["direct", "adjacent", "guidance", "none"].includes(d.evidenceStrength) || typeof d.hardFailure !== "boolean") fail("strategy_dimension_shape");
      text(d.rationale, 30, 450); array(d.facts, 0, 3); array(d.uncertainties, 0, 2).forEach(u => uncertainty(u));
      for (const fact of d.facts) { fields(fact, "reference,relevance"); text(fact.relevance, 20, 240); refs.push(reference(fact.reference)); }
    }
  }
  const r = v.recommendation; fields(r, "proposedOutcome,marketCountryCode,candidateId,rationale,alternatives");
  if (!OUTCOMES.includes(r.proposedOutcome)) fail("strategy_outcome");
  if (r.candidateId !== null && !dossier.shortlist.some(c => c.id === r.candidateId) || r.marketCountryCode !== null && !intent.comparisonUniverse.markets.some(m => m.countryCode === r.marketCountryCode)) fail("recommendation_scope", "mismatched");
  text(r.rationale, 40); array(r.alternatives, 0, 3); sameIds(r.alternatives.map(c => c.candidateId), dossier.shortlist.filter(c => c.id !== r.candidateId).map(c => c.id), "alternative_set");
  for (const alternative of r.alternatives) { fields(alternative, "candidateId,rationale,evidenceRefs"); text(alternative.rationale, 30); referenceList(alternative.evidenceRefs, refs); }
  strings(v.missingQuestions, 0, 81, 15, 240);
  if (v.testPlan !== null) {
    const p = v.testPlan; fields(p, "scope,name,hypothesis,deliverable,successCriteria,failureCriteria,stopRule,maximumMicrousd,maximumGenerations,evidenceRefs,budgetStatus,generationAuthorized,spendingAuthorized,publicationAllowed,commerceAllowed");
    equal(p.scope, "private_original_design_test", "test_scope"); equal(p.budgetStatus, "proposal_only", "proposal_status"); equal(p.generationAuthorized, false, "generation_not_authorized"); equal(p.spendingAuthorized, false, "spending_not_authorized"); noCommerce(p);
    text(p.name, 10, 160); text(p.hypothesis, 40); text(p.deliverable, 30); text(p.stopRule, 40); strings(p.successCriteria, 1, 5, 20); strings(p.failureCriteria, 1, 5, 20); integer(p.maximumMicrousd, 1, 1000000); integer(p.maximumGenerations, 1, intent.limits.maximumGenerations); referenceList(p.evidenceRefs, refs, 1);
  }
  return v;
}
function reviewValue(a: DiscoveryHistoryArtifact, intent: DiscoveryIntentV2, dossier: DiscoveryDossierV2, strategy: StrategistAssessmentV2, refs: EvidenceRefV2[]): ReviewerDecisionV2 {
  const v = fields<ReviewerDecisionV2>(a.content, "version,intentId,dossierHash,assessmentHash,execution,marketCountryCode,candidateId,outcome,sufficiencyRationale,dimensions,checks,executionPrerequisites,additionalUncertainties,missingQuestions,publicationAllowed,commerceAllowed");
  phaseBinding(a, v, intent, dossier); equal(v.assessmentHash, discoveryV2Hash(strategy), "review_assessment_hash"); equal(v.candidateId, strategy.recommendation.candidateId, "review_candidate"); equal(v.marketCountryCode, strategy.recommendation.marketCountryCode, "review_market");
  if (!OUTCOMES.includes(v.outcome)) fail("review_outcome");
  if (v.execution.modelId === strategy.execution.modelId || v.execution.providerRequestId === strategy.execution.providerRequestId) fail("review_execution_not_independent", "mismatched");
  text(v.sufficiencyRationale, 60, 1600); same(v.executionPrerequisites, DISCOVERY_V2_EXECUTION_PREREQUISITES, "review_prerequisites");
  array(v.dimensions, v.candidateId === null ? 0 : 9, v.candidateId === null ? 0 : 9);
  if (v.candidateId !== null) sameIds(v.dimensions.map(d => d.dimension), DIMENSIONS, "review_dimension_set");
  for (const d of v.dimensions) { fields(d, "dimension,verdict,rationale,evidenceRefs"); if (!["sufficient_for_test", "nonblocking_unknown", "blocking", "known_failure"].includes(d.verdict)) fail("review_verdict"); text(d.rationale, 30); referenceList(d.evidenceRefs, refs); }
  array(v.checks, 5, 5); sameIds(v.checks.map(c => c.check), REVIEW_CHECKS_V2, "review_checks");
  for (const c of v.checks) { fields(c, "check,outcome,rationale"); if (!["PASS", "FAIL"].includes(c.outcome)) fail("review_check_outcome"); text(c.rationale, 30); }
  array(v.additionalUncertainties, 0, 18).forEach(u => uncertainty(u, true)); strings(v.missingQuestions, 0, 81, 15, 240); return v;
}
function resolveSpan(ref: EvidenceRefV2, packs: ReadonlyMap<string, EvidencePack>, allowed: readonly string[], observed: number): DiscoveryHistorySpan {
  if (!allowed.includes(ref.artifactId)) fail("span_artifact_outside_dossier", "mismatched");
  const pack = packs.get(ref.artifactId); if (!pack) fail("span_pack_missing", "missing");
  const e = pack.evidence.find(item => item.id === ref.evidenceId), source = pack.sources.find(s => s.id === e?.sourceId);
  if (!e || !source) fail("span_evidence_missing", "mismatched");
  equal(ref.sourceId, source.id, "span_source_identity"); equal(ref.sourceContentHash, source.contentHash, "span_source_hash");
  const chars = Array.from(source.excerpt); integer(ref.start, 0, chars.length - 1); integer(ref.end, ref.start + 1, Math.min(chars.length, ref.start + 320));
  const quote = chars.slice(ref.start, ref.end).join(""); text(quote, 1, 320);
  return { reference: { ...ref }, quote, url: source.url, retrievedAt: source.retrievedAt, publishedAt: source.publishedAt, expiresAt: source.retrievalExpiresAt,
    freshness: freshness(source.retrievalExpiresAt, observed, source.retrievedAt) };
}

/** Bounded PK coherence across every supplied role, with no extra reads or ancestry.
 * An ID is scoped by its entity kind; identical repeated references are allowed.
 * Optional projections retain presence, so missing data never becomes an invented null. */
function entityConsistency(input: DiscoveryHistoryPreflightInput, records: readonly DiscoveryHistoryEvidenceRecord[] = [], phases: readonly (DiscoveryHistoryPhase | null)[] = []): void {
  type Kind = "experiment" | "workflow" | "artifact" | "stage";
  const requiredKeys: Record<Kind, string> = {
    experiment: "id,business_id,workflow_run_id,discovery_version,candidate_id,parent_discovery_id,status,completed_at,source_artifact_id,intent,policy_hash",
    workflow: "id,business_id,status,completed_at,workflow_key,workflow_version",
    artifact: "id,business_id,workflow_run_id,artifact_type,media_type,content,metadata",
    stage: "id,business_id,workflow_run_id,stage_key,attempt,status,completed_at,output",
  };
  const optionalKeys: Record<Kind, string[]> = {
    experiment: ["prior_artifact_ids", "prior_evidence_hashes", "analysis_source", "evidence_pack", "follow_up_basis"],
    workflow: ["intent_id", "question", "source_domains"], artifact: [], stage: [],
  };
  const source = input.analysisSource;
  const groups: Record<Kind, unknown[]> = {
    experiment: [input.experiment, source?.experiment, source?.planExperiment],
    workflow: [input.workflow, source?.workflow, source?.planWorkflow, ...records.map(record => record.workflow)],
    artifact: [input.dossier, source?.dossier, source?.plan, ...phases.map(phase => phase?.artifact), ...records.flatMap(record => [record.artifact, record.source])],
    stage: [source?.planStage, ...phases.map(phase => phase?.stage), ...records.map(record => record.stage)],
  };
  for (const kind of ["experiment", "workflow", "artifact", "stage"] as const) {
    const identities = new Map<string, unknown>();
    for (const value of groups[kind]) {
      if (value === null || value === undefined) continue;
      const row = projected<Record<string, unknown>>(value, requiredKeys[kind]); uuid(row.id);
      const selected = Object.fromEntries([...requiredKeys[kind].split(","), ...optionalKeys[kind]].map(key => [key,
        Object.hasOwn(row, key) ? { present: true, value: row[key] } : { present: false }]));
      snapshot(selected, 140000);
      if (identities.has(row.id)) same(identities.get(row.id), selected, `conflicting_${kind}_identity`); else identities.set(row.id, selected);
    }
  }
}

export function verifyDiscoveryV2History(input: DiscoveryHistoryInput): DiscoveryHistoryResult {
  const preflight = discoveryV2HistoryEvidencePreflight(input), issues = [...preflight.issues];
  const observed = capture(issues, "observedAt", () => timestamp(input.observedAt));
  const evidence: DiscoveryHistoryResult["evidence"] = [], spans: DiscoveryHistorySpan[] = [];
  let strategy: StrategistAssessmentV2 | null = null, review: ReviewerDecisionV2 | null = null;
  let temporal: DiscoveryHistoryFreshness = "unknown";
  if (observed !== null && preflight.intent) {
    temporal = freshness(preflight.intent.expiresAt, observed);
    if (temporal === "stale") issues.push({ kind: "stale", path: "intent.expiresAt", code: "saved_intent_expired" });
  }
  if (preflight.integrity === "verified" && preflight.intent && preflight.dossier && observed !== null) {
    const checkedRecords = capture(issues, "evidenceRecords", () => {
      const records = array<DiscoveryHistoryEvidenceRecord>(input.evidenceRecords, 0, preflight.artifactIds.length);
      entityConsistency(input, records, [input.strategy, input.review]);
      const ids = records.map(record => projected<DiscoveryHistoryArtifact>(record.artifact, "id").id); ids.forEach(uuid); unique(ids);
      if (ids.some(id => !preflight.artifactIds.includes(id))) fail("unexpected_evidence_artifact", "mismatched"); return records;
    });
    if (checkedRecords) for (const ref of preflight.packRefs) {
      const matching = checkedRecords.find(record => (record.artifact as DiscoveryHistoryArtifact).id === ref.artifactId);
      const found = capture(issues, `evidence.${ref.artifactId}`, () => {
        required(matching);
        const source = preflight.intent!.limits.maximumNewCollections === 0 ? input.analysisSource : null;
        const original = source ? (source.dossier as DiscoveryHistoryArtifact).content as DiscoveryDossierV2 : null;
        const sourceRef = original?.packRefs.find(item => item.artifactId === ref.artifactId);
        const sourceRoot = source?.experiment as DiscoveryHistoryExperiment | undefined;
        return evidenceRecord(matching!, ref, input.scope, observed, sourceRef && sourceRoot ? { ref: sourceRef,
          scope: { businessId: sourceRoot.business_id, experimentId: sourceRoot.id, workflowRunId: sourceRoot.workflow_run_id } } : undefined);
      });
      if (found) {
        evidence.push(structuredClone(found));
        if (found.freshness === "stale") issues.push({ kind: "stale", path: `evidence.${ref.artifactId}`, code: "saved_source_expired" });
        if (found.freshness === "stale" || found.freshness === "unknown" && temporal !== "stale") temporal = found.freshness;
      }
    }
    const root = input.experiment as DiscoveryHistoryExperiment, run = input.workflow as DiscoveryHistoryWorkflow;
    const ids = descriptor(root.evidence_pack, preflight.intent.id, root.source_artifact_id!);
    const refs: EvidenceRefV2[] = [];
    strategy = capture(issues, "strategy", () => strategyValue(phaseArtifact(input.strategy, "strategy", input.scope, ids.strategyArtifactId), preflight.intent!, preflight.dossier!, refs));
    if (strategy) review = capture(issues, "review", () => reviewValue(phaseArtifact(input.review, "review", input.scope, ids.reviewArtifactId), preflight.intent!, preflight.dossier!, strategy!, refs));
    else if (input.review !== null) issues.push({ kind: "partial", path: "review", code: "strategy_binding_unavailable" });
    else issues.push({ kind: "missing", path: "review", code: "required_record_missing" });
    const packs = new Map(evidence.map(item => [item.artifactId, item.pack]));
    for (const ref of new Map(refs.map(item => [discoveryV2Hash(item), item])).values()) {
      const resolved = capture(issues, `span.${ref.artifactId}.${ref.evidenceId}`, () => resolveSpan(ref, packs, preflight.artifactIds, observed));
      if (resolved) spans.push(resolved);
    }
    if (root.status !== "completed" || run.status !== "completed" || root.completed_at === null || run.completed_at === null) issues.push({ kind: "partial", path: "completion", code: "root_or_run_not_completed" });
  }
  const state = integrity(issues);
  if (evidence.length !== preflight.artifactIds.length && temporal !== "stale") temporal = "unknown";
  return { integrity: state, freshness: temporal, issues, evidenceArtifactIds: [...preflight.artifactIds], intent: preflight.intent, dossier: preflight.dossier,
    strategy: strategy ? structuredClone(strategy) : null, review: review ? structuredClone(review) : null, evidence, spans,
    reviewState: review ? state === "verified" ? "completed_historical_review" : "saved_output" : "unavailable", recordedOutcome: review?.outcome ?? null, rendering: "plain_text", verificationScope: "saved_content_and_direct_linkage" };
}
