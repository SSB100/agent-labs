import "server-only";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { OwnerUiContext } from "./data";
import type { ConsoleCollectionSelection } from "./console-collections-query";
import { discoveryV2HistoryEvidencePreflight, verifyDiscoveryV2History, type DiscoveryHistoryResult, type DiscoveryHistoryExperiment, type DiscoveryHistoryArtifact, type DiscoveryHistoryStage, type DiscoveryHistoryAnalysisSource, type DiscoveryHistoryPreflightInput, type DiscoveryHistoryEvidenceRecord, type DiscoveryHistoryQuery, type DiscoveryHistoryPhase } from "../../products/discovery-v2-history";
import { consoleGuard, consoleObject, consoleRead, consoleScopedIds, consoleValidCount, consoleValidId, consoleValidStatus, consoleValidTimestamp, consoleNullableTimestamp } from "./console-collections";

export type ConsoleResearchEvidenceSelection = {
  id: string; business_id: string; workflow_run_id: string | null; discovery_version: string;
  candidate_id: string | null; parent_discovery_id: string | null; status: string;
  completed_at: string | null; source_artifact_id: string | null;
};
export type ConsoleResearchEvidenceArtifactLink = {
  role: "dossier" | "strategy" | "review" | "evidence" | "source" | "plan";
  businessId: string; workflowRunId: string; artifactId: string;
  /** This qualifies exact saved navigation, never the content or provider truth. */
  verification: "metadata_only";
};
export type ConsoleResearchEvidenceIssue = {
  kind: "missing" | "malformed" | "mismatched" | "unavailable"; path: string; code: string;
};
export type ConsoleResearchEvidenceResult = {
  selection: ConsoleCollectionSelection<ConsoleResearchEvidenceSelection>;
  integrity: "verified" | "missing" | "malformed" | "mismatched" | "partial" | "unavailable";
  history: DiscoveryHistoryResult | null;
  workIdentity: { businessId: string; workflowRunId: string } | null;
  artifacts: ConsoleResearchEvidenceArtifactLink[];
  issues: ConsoleResearchEvidenceIssue[];
  limits: readonly string[];
};
export type ConsoleResearchEvidenceOptions = { experimentId: string; businessId?: string; observedAt: string };
export const CONSOLE_RESEARCH_EVIDENCE_OUTPUT_LIMIT = 6;
export const CONSOLE_RESEARCH_ANALYSIS_EVIDENCE_OUTPUT_LIMIT = 4;
/** Normal: 5 selected/dossier + 6 phases + at most 6 × 13 source reads = 89.
 * Analysis: at most 16 preflight + 6 phases + 4 × 13 source reads = 74.
 * Every read is an exact identity/tuple with count exact and a two-row sentinel. */
export const CONSOLE_RESEARCH_EVIDENCE_QUERY_LIMIT = 100;
export const CONSOLE_RESEARCH_EVIDENCE_EXPERIMENT_SELECT = "id,business_id,workflow_run_id,discovery_version,candidate_id,parent_discovery_id,status,completed_at,source_artifact_id,intent:variables->intent,policy_hash:variables->>policyHash,prior_artifact_ids:variables->priorArtifactIds,prior_evidence_hashes:variables->priorEvidenceHashes,analysis_source:variables->analysisSource,follow_up_basis:variables->ownerKickoff->followUpBasis,evidence_pack";
export const CONSOLE_RESEARCH_EVIDENCE_WORKFLOW_SELECT = "id,business_id,workflow_definition_id,status,completed_at,intent_id:input->>intentId,question:input->>question,source_domains:input->sourceDomains";
export const CONSOLE_RESEARCH_EVIDENCE_ARTIFACT_METADATA_SELECT = "id,business_id,workflow_run_id,artifact_type,media_type,stage_key:metadata->>stageKey";
export const CONSOLE_RESEARCH_EVIDENCE_ARTIFACT_SELECT = "id,business_id,workflow_run_id,artifact_type,media_type,content,metadata";
export const CONSOLE_RESEARCH_EVIDENCE_STAGE_SELECT = "id,business_id,workflow_run_id,stage_key,attempt,status,completed_at,output";
const INPUT_SELECT = `${CONSOLE_RESEARCH_EVIDENCE_ARTIFACT_METADATA_SELECT},query_kind:content->>kind,query_ordinal:content->ordinal,query_id:content->>queryId,query_question:content->>question,query_source_domains:content->sourceDomains`;
export const CONSOLE_RESEARCH_EVIDENCE_LIMITS = [
  "This exact-selection reader verifies saved content and direct links only; it establishes no product acceptance or current execution authority.",
  "Metadata-only Work and Library links do not certify artifact content, provider truth or completed review.",
  "At most six referenced evidence outputs (four for analysis), one direct analysis source and its exact plan origin are inspected; ancestry is not traversed.",
  "Every public read has an exact count and a two-row duplicate sentinel; the total read ceiling is 100. No automatic retry occurs.",
  "Independent source/phase branches run concurrently after preflight, but exact dependency chains still require multiple read waves. Live latency is unqualified; load this detail separately from metadata pages.",
  "Post-download payload checks are rendering bounds, not pre-transfer wire-byte limits. Owner Business-list cap completeness and atomic snapshot consistency remain unproved.",
  "No quotes, costs, balances, catalogue, provider calls, RPCs, writes or file signing are performed.",
] as const;

const V2 = "pod-discovery-2.0", V2_KEYS = ["product.discovery-v2.analysis", "product.discovery-v2.one", "product.discovery-v2.two"];
const nullableId = (value: unknown) => value === null || consoleValidId(value);
const sha = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
type SavedExperiment = ConsoleResearchEvidenceSelection & Omit<DiscoveryHistoryExperiment, keyof ConsoleResearchEvidenceSelection>;
type SavedWorkflow = { id: string; business_id: string; workflow_definition_id: string; status: string; completed_at: string | null; intent_id?: unknown; question?: unknown; source_domains?: unknown; workflow_key: string; workflow_version: string };
type ArtifactMetadata = { id: string; business_id: string; workflow_run_id: string; artifact_type: string; media_type: string; stage_key: string | null };
type Descriptor = { version: string; intentId: string; dossierArtifactId: string; strategyArtifactId: string; reviewArtifactId: string };
type AnalysisPins = { sourceRootId: string; planArtifactId: string; planHash: string; dossierArtifactId: string; dossierHash: string };
type Plan = { artifact: DiscoveryHistoryArtifact; stage: DiscoveryHistoryStage; experiment: SavedExperiment; workflow: SavedWorkflow };
class ReadFailure extends Error {
  constructor(readonly issue: ConsoleResearchEvidenceIssue) { super(issue.code); }
}
function requireThat(condition: unknown, path: string, code: string, kind: ConsoleResearchEvidenceIssue["kind"] = "mismatched"): asserts condition { if (!condition) throw new ReadFailure({ kind, path, code }); }
/** Drain every started read before returning a failure. No orphaned sibling may keep
 * reading or append metadata links after this invocation has returned its result. */
async function allReads<T extends readonly unknown[]>(...reads: { [K in keyof T]: Promise<T[K]> }): Promise<T> {
  const results = await Promise.allSettled(reads), failure = results.find(result => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  return results.map(result => (result as PromiseFulfilledResult<unknown>).value) as unknown as T;
}
function shape(value: unknown, keys: string): value is Record<string, unknown> {
  return consoleObject(value) && Object.keys(value).sort().join(",") === keys.split(",").sort().join(",");
}
/** Mirrors the persisted SQL identifier convention; never creates a database record. */
function persistedId(value: string): string {
  const h = createHash("md5").update(value).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
function boundedJson(value: unknown, maximum: number): boolean {
  try {
    const stack: { value: unknown; depth: number }[] = [{ value, depth: 0 }], seen = new Set<object>(); let nodes = 0;
    while (stack.length) {
      const entry = stack.pop()!; if (++nodes > 15000 || entry.depth > 24) return false;
      if (entry.value === null || typeof entry.value === "boolean" || typeof entry.value === "number" && Number.isFinite(entry.value)) continue;
      if (typeof entry.value === "string") { if (entry.value.length > maximum) return false; continue; }
      if (!consoleObject(entry.value) && !Array.isArray(entry.value) || seen.has(entry.value as object)) return false;
      seen.add(entry.value as object); for (const item of Object.values(entry.value as object)) stack.push({ value: item, depth: entry.depth + 1 });
    }
    return Buffer.byteLength(JSON.stringify(value), "utf8") <= maximum;
  } catch { return false; }
}
function hash(value: unknown): string {
  const canonical = (item: unknown): string => Array.isArray(item) ? `[${item.map(canonical).join(",")}]` : consoleObject(item) ? `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${canonical(item[key])}`).join(",")}}` : JSON.stringify(item);
  return createHash("sha256").update(canonical(value)).digest("hex");
}
function selectionMetadata(row: ConsoleResearchEvidenceSelection): ConsoleResearchEvidenceSelection {
  const { id, business_id, workflow_run_id, discovery_version, candidate_id, parent_discovery_id, status, completed_at, source_artifact_id } = row;
  return { id, business_id, workflow_run_id, discovery_version, candidate_id, parent_discovery_id, status, completed_at, source_artifact_id };
}
function experimentGuard(row: SavedExperiment): boolean {
  return consoleValidId(row.id) && consoleValidId(row.business_id) && [row.workflow_run_id, row.candidate_id, row.parent_discovery_id, row.source_artifact_id].every(nullableId)
    && consoleValidStatus(row.discovery_version) && consoleValidStatus(row.status) && consoleNullableTimestamp(row.completed_at) && !Object.hasOwn(row, "variables");
}
function metadataGuard(row: ArtifactMetadata): boolean {
  return [row.id, row.business_id, row.workflow_run_id].every(consoleValidId) && consoleValidStatus(row.artifact_type) && row.media_type === "application/json"
    && (row.stage_key === null || typeof row.stage_key === "string") && !["content", "metadata"].some(key => Object.hasOwn(row, key));
}
function descriptor(row: SavedExperiment): Descriptor {
  const value = row.evidence_pack, path = `experiment.${row.id}.evidence_pack`;
  requireThat(value !== null && value !== undefined, path, "saved_descriptor_missing", "missing");
  requireThat(shape(value, "version,intentId,dossierArtifactId,strategyArtifactId,reviewArtifactId"), path, "saved_descriptor_malformed", "malformed");
  const d = value as unknown as Descriptor;
  requireThat([d.dossierArtifactId, d.strategyArtifactId, d.reviewArtifactId].every(consoleValidId) && new Set([d.dossierArtifactId, d.strategyArtifactId, d.reviewArtifactId]).size === 3, path, "saved_descriptor_ids_malformed", "malformed");
  requireThat(d.version === V2 && d.intentId === row.id && d.dossierArtifactId === row.source_artifact_id, path, "saved_descriptor_binding");
  // All three IDs are fixed by the persisted producer, not merely mutually consistent
  // UUID pointers. Reject replacements before any descriptor artifact is requested.
  requireThat(consoleValidId(row.workflow_run_id)
    && d.dossierArtifactId === persistedId(`discovery:v2:dossier:${row.workflow_run_id}`)
    && d.strategyArtifactId === persistedId(`pack:output:${row.workflow_run_id}:strategy`)
    && d.reviewArtifactId === persistedId(`pack:output:${row.workflow_run_id}:review`), path, "saved_descriptor_persisted_identity"); return d;
}
function analysisPins(row: SavedExperiment): AnalysisPins {
  const path = `experiment.${row.id}.analysis_source`, value = row.analysis_source;
  requireThat(shape(value, "sourceRootId,planArtifactId,planHash,dossierArtifactId,dossierHash"), path, "analysis_pins_malformed", value === null || value === undefined ? "missing" : "malformed");
  const pins = value as unknown as AnalysisPins;
  requireThat([pins.sourceRootId, pins.planArtifactId, pins.dossierArtifactId].every(consoleValidId) && sha(pins.planHash) && sha(pins.dossierHash), path, "analysis_pins_malformed", "malformed");
  requireThat(pins.sourceRootId !== row.id && pins.planArtifactId !== pins.dossierArtifactId, path, "analysis_pin_identity_collision");
  requireThat(consoleObject(row.follow_up_basis) && row.follow_up_basis.rootId === pins.sourceRootId && row.follow_up_basis.reason === "reuse_evidence_for_strategy_review", path, "analysis_follow_up_binding"); return pins;
}

/** All caches are per invocation. Full entities have one projection and one identity;
 * repeated references never reload a different copy or broaden a failed lookup. */
class EvidenceReader {
  readonly links: ConsoleResearchEvidenceArtifactLink[] = [];
  private readonly cache = new Map<string, Promise<unknown>>();
  private readonly entities = new Map<string, unknown>();
  private calls = 0;
  constructor(private readonly context: OwnerUiContext, private readonly ids: string[]) {}
  private cached<T>(key: string, work: () => Promise<T>): Promise<T> {
    if (!this.cache.has(key)) this.cache.set(key, work()); return this.cache.get(key)! as Promise<T>;
  }
  private coherence(kind: string, id: string, row: unknown): void {
    const key = `${kind}:${id}`;
    requireThat(!this.entities.has(key) || isDeepStrictEqual(this.entities.get(key), row), key, "conflicting_entity_copy");
    if (!this.entities.has(key)) this.entities.set(key, structuredClone(row));
  }
  private async exact<T>(table: string, columns: string, filters: readonly [string, unknown][], guard: (row: T) => boolean, path: string, owned = true): Promise<T> {
    requireThat(++this.calls <= CONSOLE_RESEARCH_EVIDENCE_QUERY_LIMIT, path, "public_read_limit_exceeded", "unavailable");
    let query = this.context.supabase.from(table).select(columns, { count: "exact" });
    if (owned) query = query.in("business_id", this.ids);
    for (const [key, value] of filters) query = query.eq(key, value);
    const response = await consoleRead(query.limit(2));
    requireThat(!response.error && Array.isArray(response.data) && consoleValidCount(response.count) && response.count === response.data.length && response.data.length <= 1, path, "exact_read_unavailable", "unavailable");
    const rows = response.data as T[]; requireThat(rows.length === 1, path, "exact_record_missing", "missing");
    requireThat(consoleGuard(guard, rows[0]), path, "exact_record_shape_or_binding", "malformed"); return rows[0];
  }
  async experiment(id: string, businessId?: string): Promise<SavedExperiment> {
    const row = await this.cached(`experiment:${id}`, async () => {
      const filters: [string, unknown][] = [["id", id]]; if (businessId) filters.push(["business_id", businessId]);
      const item = await this.exact<SavedExperiment>("product_experiments", CONSOLE_RESEARCH_EVIDENCE_EXPERIMENT_SELECT, filters,
        value => experimentGuard(value) && value.id === id && this.ids.includes(value.business_id) && (!businessId || value.business_id === businessId), `experiment.${id}`);
      this.coherence("experiment", id, item); return item;
    });
    requireThat(!businessId || row.business_id === businessId, `experiment.${id}`, "experiment_business_binding"); return row;
  }
  async workflow(id: string, businessId: string): Promise<SavedWorkflow> {
    const row = await this.cached(`workflow:${id}`, async () => {
      type Run = Omit<SavedWorkflow, "workflow_key" | "workflow_version">;
      const run = await this.exact<Run>("workflow_runs", CONSOLE_RESEARCH_EVIDENCE_WORKFLOW_SELECT, [["id", id], ["business_id", businessId]],
        value => value.id === id && value.business_id === businessId && consoleValidId(value.workflow_definition_id) && consoleValidStatus(value.status) && consoleNullableTimestamp(value.completed_at)
          && !["input", "state", "pack_snapshot"].some(key => Object.hasOwn(value, key)), `workflow.${id}`);
      const definition = await this.cached(`definition:${run.workflow_definition_id}`, () => this.exact<{ id: string; workflow_key: string; version: string }>("workflow_definitions", "id,workflow_key,version", [["id", run.workflow_definition_id]],
        value => value.id === run.workflow_definition_id && consoleValidId(value.id) && consoleValidStatus(value.workflow_key) && consoleValidStatus(value.version), `definition.${run.workflow_definition_id}`, false));
      const result = { ...run, workflow_key: definition.workflow_key, workflow_version: definition.version }; this.coherence("workflow", id, result); return result;
    });
    requireThat(row.business_id === businessId, `workflow.${id}`, "workflow_business_binding"); return row;
  }
  async artifactMetadata(id: string, businessId: string, artifactType: string, stageKey: string | null | readonly string[], runId?: string): Promise<ArtifactMetadata> {
    const row = await this.cached(`artifact-metadata:${id}`, () => this.exact<ArtifactMetadata>("artifacts", CONSOLE_RESEARCH_EVIDENCE_ARTIFACT_METADATA_SELECT, [["id", id], ["business_id", businessId]],
      value => metadataGuard(value) && value.id === id && value.business_id === businessId, `artifact.${id}.metadata`));
    requireThat(row.business_id === businessId && (!runId || row.workflow_run_id === runId) && row.artifact_type === artifactType && (Array.isArray(stageKey) ? stageKey.includes(row.stage_key ?? "") : row.stage_key === stageKey), `artifact.${id}`, "artifact_role_binding"); return row;
  }
  link(role: ConsoleResearchEvidenceArtifactLink["role"], row: ArtifactMetadata): void {
    if (!this.links.some(link => link.artifactId === row.id && link.role === role)) this.links.push({ role, businessId: row.business_id, workflowRunId: row.workflow_run_id, artifactId: row.id, verification: "metadata_only" });
  }
  async content(meta: ArtifactMetadata): Promise<DiscoveryHistoryArtifact> {
    return this.cached(`artifact-content:${meta.id}`, async () => {
      const row = await this.exact<DiscoveryHistoryArtifact>("artifacts", CONSOLE_RESEARCH_EVIDENCE_ARTIFACT_SELECT, [["id", meta.id], ["business_id", meta.business_id], ["workflow_run_id", meta.workflow_run_id]],
        value => value.id === meta.id && value.business_id === meta.business_id && value.workflow_run_id === meta.workflow_run_id && value.artifact_type === meta.artifact_type && value.media_type === meta.media_type
          && consoleObject(value.metadata) && (value.metadata.stageKey ?? null) === meta.stage_key && Object.hasOwn(value, "content"), `artifact.${meta.id}.content`);
      requireThat(boundedJson(row.content, meta.stage_key === "plan" ? 20000 : 65536) && boundedJson(row.metadata, 65536), `artifact.${meta.id}`, "returned_payload_bound", "malformed");
      this.coherence("artifact", row.id, row); return row;
    });
  }
  async artifact(id: string, businessId: string, artifactType: string, stageKey: string | null, role: ConsoleResearchEvidenceArtifactLink["role"], runId?: string): Promise<DiscoveryHistoryArtifact> {
    const meta = await this.artifactMetadata(id, businessId, artifactType, stageKey, runId); this.link(role, meta); return this.content(meta);
  }
  async stage(runId: string, businessId: string, stageKey: string): Promise<DiscoveryHistoryStage> {
    return this.cached(`stage:${runId}:${stageKey}`, async () => {
      const row = await this.exact<DiscoveryHistoryStage>("workflow_stage_runs", CONSOLE_RESEARCH_EVIDENCE_STAGE_SELECT, [["business_id", businessId], ["workflow_run_id", runId], ["stage_key", stageKey], ["attempt", 1]],
        value => consoleValidId(value.id) && value.business_id === businessId && value.workflow_run_id === runId && value.stage_key === stageKey && value.attempt === 1 && consoleValidStatus(value.status)
          && consoleNullableTimestamp(value.completed_at) && Object.hasOwn(value, "output"), `stage.${runId}.${stageKey}`);
      requireThat(boundedJson(row.output, 65536), `stage.${row.id}`, "returned_stage_payload_bound", "malformed"); this.coherence("stage", row.id, row); return row;
    });
  }
  async queryInput(runId: string, businessId: string, stageKey: string): Promise<Record<string, unknown>> {
    const id = persistedId(`pack:input:${runId}:${stageKey}`), meta = await this.artifactMetadata(id, businessId, "pack.stage-input", stageKey, runId);
    return this.cached(`query-input:${id}`, () => this.exact<Record<string, unknown>>("artifacts", INPUT_SELECT, [["id", id], ["business_id", businessId], ["workflow_run_id", runId]],
      row => row.id === id && row.business_id === businessId && row.workflow_run_id === runId && row.artifact_type === meta.artifact_type && row.media_type === meta.media_type && row.stage_key === meta.stage_key
        && !Object.hasOwn(row, "content") && !Object.hasOwn(row, "metadata"), `artifact.${id}.query`));
  }
  async plan(workflow: SavedWorkflow, businessId: string, artifactId = persistedId(`pack:output:${workflow.id}:plan`)): Promise<Plan> {
    return this.cached(`plan:${artifactId}`, async () => {
      requireThat(consoleValidId(workflow.intent_id), `workflow.${workflow.id}`, "source_intent_id_missing", "missing");
      const experiment = await this.experiment(workflow.intent_id, businessId); sourceRoot(experiment, workflow);
      requireThat(workflow.workflow_key !== "product.discovery-v2.analysis" && artifactId === persistedId(`pack:output:${workflow.id}:plan`), `artifact.${artifactId}`, "plan_origin_binding");
      const metadata = await this.artifactMetadata(artifactId, businessId, "worker.output", "plan", workflow.id); this.link("plan", metadata);
      const [artifact, stage] = await allReads(this.content(metadata), this.stage(workflow.id, businessId, "plan"));
      const content = artifact.content;
      requireThat(consoleObject(content) && content.version === V2 && content.intentId === experiment.id && Array.isArray(content.queries) && content.queries.length >= 1 && content.queries.length <= 2,
        `artifact.${artifactId}`, "persisted_plan_query_shape", "malformed");
      requireThat(stage.status === "completed" && stage.completed_at !== null && isDeepStrictEqual(stage.output, content), `stage.${stage.id}`, "completed_plan_output_binding");
      const limit = (experiment.intent as { limits: { maximumNewCollections: number } }).limits.maximumNewCollections;
      requireThat(content.queries.length === limit && content.queries.every((value, index) => consoleObject(value) && value.ordinal === index + 1 && value.queryId === persistedId(`discovery:v2:query:${experiment.id}:${index + 1}`)), `artifact.${artifactId}`, "plan_query_identity_or_count");
      return { artifact, stage, experiment, workflow };
    });
  }
}
function sourceRoot(root: SavedExperiment, workflow: SavedWorkflow): void {
  const path = `experiment.${root.id}`, intent = root.intent;
  requireThat(root.discovery_version === V2 && root.parent_discovery_id === null && root.candidate_id === null && root.workflow_run_id === workflow.id && workflow.business_id === root.business_id && workflow.intent_id === root.id, path, "source_root_binding");
  requireThat(consoleObject(intent) && boundedJson(intent, 20000) && intent.id === root.id && intent.businessId === root.business_id && intent.version === V2 && consoleObject(intent.limits) && consoleObject(intent.comparisonUniverse), path, "source_saved_intent_shape", "malformed");
  requireThat(sha(root.policy_hash) && hash(intent) === root.policy_hash && workflow.workflow_version === "1.0.0" && V2_KEYS[Number(intent.limits.maximumNewCollections)] === workflow.workflow_key && typeof intent.limits.maximumNewCollections === "number", path, "source_saved_intent_binding");
}
async function analysisContext(reader: EvidenceReader, root: SavedExperiment, pins: AnalysisPins): Promise<DiscoveryHistoryAnalysisSource> {
  const source = await reader.experiment(pins.sourceRootId, root.business_id);
  requireThat(consoleValidId(source.workflow_run_id), `experiment.${source.id}`, "analysis_source_workflow_missing", "missing");
  const workflow = await reader.workflow(source.workflow_run_id, root.business_id); sourceRoot(source, workflow);
  requireThat(source.source_artifact_id === pins.dossierArtifactId && pins.dossierArtifactId === persistedId(`discovery:v2:dossier:${workflow.id}`), `experiment.${source.id}`, "analysis_source_dossier_binding");
  if (workflow.workflow_key === "product.discovery-v2.analysis") {
    const carried = analysisPins(source);
    requireThat(carried.planArtifactId === pins.planArtifactId && carried.planHash === pins.planHash, `experiment.${source.id}`, "analysis_carried_plan_binding");
  }
  const [dossier, plan] = await allReads(
    reader.artifact(pins.dossierArtifactId, root.business_id, "product.discovery-dossier.v2", null, "dossier", workflow.id),
    (async () => {
      const meta = await reader.artifactMetadata(pins.planArtifactId, root.business_id, "worker.output", "plan"), planWorkflow = await reader.workflow(meta.workflow_run_id, root.business_id);
      if (workflow.workflow_key !== "product.discovery-v2.analysis") requireThat(planWorkflow.id === workflow.id, `artifact.${pins.planArtifactId}`, "analysis_source_own_plan_binding");
      return reader.plan(planWorkflow, root.business_id, pins.planArtifactId);
    })(),
  );
  return { experiment: source, workflow, dossier, plan: plan.artifact, planStage: plan.stage, planExperiment: plan.experiment, planWorkflow: plan.workflow };
}
async function evidenceRecord(reader: EvidenceReader, id: string, businessId: string): Promise<DiscoveryHistoryEvidenceRecord> {
  // Resolve only this preflight-approved output. Its saved stage leaf chooses a fixed lane.
  const meta = await reader.artifactMetadata(id, businessId, "worker.output", ["research", "research1", "research2"]);
  const workflow = await reader.workflow(meta.workflow_run_id, businessId), stageKey = meta.stage_key!;
  const lanes: Record<string, string[]> = { "research.public-evidence": ["research"], "product.discovery-v2.one": ["research1"], "product.discovery-v2.two": ["research1", "research2"] };
  requireThat(workflow.workflow_version === "1.0.0" && lanes[workflow.workflow_key]?.includes(stageKey), `workflow.${workflow.id}`, "evidence_workflow_lane");
  requireThat(id === persistedId(`pack:output:${workflow.id}:${stageKey}`), `artifact.${id}`, "evidence_output_identity");
  reader.link("evidence", meta);
  let query: DiscoveryHistoryQuery;
  if (workflow.workflow_key === "research.public-evidence") {
    requireThat(typeof workflow.question === "string" && workflow.question.length >= 5 && workflow.question.length <= 800 && Array.isArray(workflow.source_domains) && workflow.source_domains.length >= 1 && workflow.source_domains.length <= 6 && workflow.source_domains.every(value => typeof value === "string" && value.length <= 200), `workflow.${workflow.id}`, "public_saved_query_missing", "missing");
    query = { id: persistedId(`discovery:v2:prior-query:${id}`), business_id: businessId, workflow_run_id: workflow.id, collected_for_intent_id: null, question: workflow.question, source_domains: workflow.source_domains as string[] };
  } else {
    const ordinal = Number(stageKey.slice(-1));
    const [plan, input] = await allReads(reader.plan(workflow, businessId), reader.queryInput(workflow.id, businessId, stageKey));
    const queries = (plan.artifact.content as { queries: Record<string, unknown>[] }).queries, saved = queries.find(row => row.ordinal === ordinal)!;
    requireThat(saved && typeof saved.question === "string" && Array.isArray(saved.sourceDomains) && saved.sourceDomains.every(value => typeof value === "string"), `artifact.${plan.artifact.id}`, "plan_saved_query_missing", "missing");
    requireThat(input.query_kind === "research" && input.query_ordinal === ordinal && input.query_id === saved.queryId && input.query_question === saved.question
      && isDeepStrictEqual(input.query_source_domains, saved.sourceDomains) && isDeepStrictEqual(saved.sourceDomains, (plan.experiment.intent as { comparisonUniverse: { sourceDomains: unknown } }).comparisonUniverse.sourceDomains), `artifact.${input.id}`, "plan_input_query_binding");
    query = { id: saved.queryId as string, business_id: businessId, workflow_run_id: workflow.id, collected_for_intent_id: plan.experiment.id, question: saved.question, source_domains: saved.sourceDomains as string[] };
  }
  const [artifact, source, stage] = await allReads(reader.content(meta), reader.artifact(persistedId(`research:sources:${workflow.id}:${stageKey}`), businessId, "research.sources", stageKey, "source", workflow.id), reader.stage(workflow.id, businessId, stageKey));
  return { artifact, workflow, query, source, stage };
}

export async function loadConsoleResearchEvidence(context: OwnerUiContext, options: ConsoleResearchEvidenceOptions): Promise<ConsoleResearchEvidenceResult> {
  if (!options || Object.keys(options).some(key => !["experimentId", "businessId", "observedAt"].includes(key)) || !consoleValidId(options.experimentId) || options.businessId !== undefined && !consoleValidId(options.businessId) || !consoleValidTimestamp(options.observedAt)) throw Error("Invalid exact Research evidence request.");
  const ids = consoleScopedIds(context, options.businessId?.toLowerCase() ?? null), reader = new EvidenceReader(context, ids), issues: ConsoleResearchEvidenceIssue[] = [];
  let selection: ConsoleCollectionSelection<ConsoleResearchEvidenceSelection> = { status: "unavailable", item: null }, history: DiscoveryHistoryResult | null = null, workIdentity: ConsoleResearchEvidenceResult["workIdentity"] = null;
  const capture = async <T>(work: () => Promise<T>): Promise<T | null> => {
    try { return await work(); } catch (error) { issues.push(error instanceof ReadFailure ? error.issue : { kind: "unavailable", path: "reader", code: "saved_evidence_unavailable" }); return null; }
  };
  const finish = (): ConsoleResearchEvidenceResult => ({ selection, history, workIdentity, artifacts: reader.links, issues,
    integrity: issues.some(issue => issue.kind === "unavailable") ? "unavailable" : issues.some(issue => issue.kind === "mismatched") ? "mismatched" : issues.some(issue => issue.kind === "malformed") ? "malformed" : issues.some(issue => issue.kind === "missing") ? "missing" : history?.integrity ?? "unavailable", limits: CONSOLE_RESEARCH_EVIDENCE_LIMITS });
  const experiment = await capture(() => reader.experiment(options.experimentId.toLowerCase()));
  if (!experiment) { if (issues[0]?.kind === "missing") selection = { status: "missing", item: null }; return finish(); }
  selection = { status: "found", item: selectionMetadata(experiment) };
  const workflow = consoleValidId(experiment.workflow_run_id) ? await capture(() => reader.workflow(experiment.workflow_run_id!, experiment.business_id)) : null;
  if (workflow) workIdentity = { businessId: experiment.business_id, workflowRunId: workflow.id };
  if (experiment.discovery_version !== V2 || experiment.candidate_id !== null || experiment.parent_discovery_id !== null) {
    issues.push({ kind: "unavailable", path: "history", code: "unsupported_history_contract" }); return finish();
  }
  if (!workflow) { if (!issues.length) issues.push({ kind: "missing", path: "workflow", code: "selected_workflow_missing" }); return finish(); }
  const pins = await capture(async () => descriptor(experiment)); if (!pins) return finish();
  const dossier = await capture(() => reader.artifact(pins.dossierArtifactId, experiment.business_id, "product.discovery-dossier.v2", null, "dossier", workflow.id));
  if (!dossier) return finish();
  let analysisSource: DiscoveryHistoryAnalysisSource | null = null;
  const isAnalysis = consoleObject(experiment.intent) && consoleObject(experiment.intent.limits) && experiment.intent.limits.maximumNewCollections === 0;
  if (isAnalysis) {
    const analysis = await capture(async () => analysisPins(experiment)); if (!analysis) return finish();
    analysisSource = await capture(() => analysisContext(reader, experiment, analysis)); if (!analysisSource) return finish();
  }
  const input: DiscoveryHistoryPreflightInput = { scope: { businessId: experiment.business_id, experimentId: experiment.id, workflowRunId: workflow.id }, experiment, workflow, dossier, analysisSource };
  const preflight = discoveryV2HistoryEvidencePreflight(input);
  if (preflight.integrity !== "verified") { history = verifyDiscoveryV2History({ ...input, observedAt: options.observedAt, evidenceRecords: [], strategy: null, review: null }); return finish(); }
  if (preflight.artifactIds.length > (isAnalysis ? CONSOLE_RESEARCH_ANALYSIS_EVIDENCE_OUTPUT_LIMIT : CONSOLE_RESEARCH_EVIDENCE_OUTPUT_LIMIT)) { issues.push({ kind: "malformed", path: "preflight", code: "evidence_output_limit" }); return finish(); }
  const phase = (key: "strategy" | "review", id: string): Promise<DiscoveryHistoryPhase | null> => capture(async () => {
    const meta = await reader.artifactMetadata(id, experiment.business_id, "worker.output", key, workflow.id); reader.link(key, meta);
    const [artifact, stage] = await allReads(reader.content(meta), reader.stage(workflow.id, experiment.business_id, key)); return { artifact, stage };
  });
  const [records, strategy, review] = await Promise.all([Promise.all(preflight.artifactIds.map(id => capture(() => evidenceRecord(reader, id, experiment.business_id)))), phase("strategy", pins.strategyArtifactId), phase("review", pins.reviewArtifactId)]);
  const evidenceRecords = records.filter((record): record is DiscoveryHistoryEvidenceRecord => record !== null);
  history = verifyDiscoveryV2History({ ...input, observedAt: options.observedAt, evidenceRecords, strategy, review });
  return finish();
}
