import { validateGenerationRouteProof, type GenerationRouteProof } from "../research/generation-route";
import { createHash } from "node:crypto";
import { DIMENSIONS, type Dimension } from "./types";
import { validateProductEvidence } from "./discovery";
import { validateResearchRequest } from "../research/sources";
import type { EvidencePack } from "../research/types";
import { validateDiscoveryKnowledgeV2, type DiscoveryKnowledgeContextV2 } from "./discovery-v2-knowledge";

/** Parallel contract. No v1 score, historical assessment, or authority is rewritten. */
export const DISCOVERY_V2 = "pod-discovery-2.0" as const;
export const DISCOVERY_V2_PROPOSAL_CEILING_MICROUSD = 1_000_000;
/** Required later gates, never statements that a model has satisfied or approved execution. */
export const DISCOVERY_V2_EXECUTION_PREREQUISITES = {
  ownerCreativeApproval: "required", freshBudgetApproval: "required",
  conceptSpecificIpScreen: "required", printValidation: "required",
} as const;
/** Storage bounds include expanded evidence references across all 3 × 9 evaluations.
 * These are independent of the unchanged provider request, token and spending caps. */
export const DISCOVERY_V2_SNAPSHOT_BYTES = { dossier: 16384, strategist: 65536, reviewer: 16384 } as const;
export const DISCOVERY_V2_MODELS = { strategist: "openai/gpt-5.6-luna", reviewer: "anthropic/claude-haiku-4.5" } as const;
export type DiscoveryOutcomeV2 = "TEST" | "REJECT" | "NEEDS_MORE_EVIDENCE";
export type EvidenceStrengthV2 = "direct" | "adjacent" | "guidance" | "none";
export type EvidenceRefV2 = { artifactId: string; evidenceId: string; sourceId: string; sourceContentHash: string; start: number; end: number };
export type GeographyScopeV2 = { countryCode: string; currency: string };
export type CandidateIdentityV2 = {
  id: string; businessId: string; concept: string; audience: string;
  productType: "original_pod_tshirt"; originalDesign: boolean; rightsStatus: "confirmed" | "unclear";
};
export type DiscoveryIntentV2 = {
  version: typeof DISCOVERY_V2; id: string; businessId: string; objective: string;
  comparisonUniverse: { productType: "original_pod_tshirt"; markets: GeographyScopeV2[]; audiences: string[]; sourceDomains: string[]; selectionQuestion: string };
  limits: { maximumAlternatives: 3; maximumNewCollections: 0 | 1 | 2; maximumMicrousd: number; maximumGenerations: 1 | 2 };
  expiresAt: string;
};
export type DossierPackRefV2 = {
  artifactId: string; sha256: string; origin: "prior" | "new";
  query: { id: string; question: string; sourceDomains: string[] };
};
export type DiscoveryDossierV2 = {
  version: typeof DISCOVERY_V2; intentId: string; businessId: string;
  packRefs: DossierPackRefV2[]; shortlist: CandidateIdentityV2[]; comparisonRationale: string;
};
/** Loaded from persisted records, never accepted from a worker as its own attestation. */
export type PersistedResearchEvidenceV2 = {
  artifactId: string; businessId: string; workflowRunId: string; queryId: string; collectedForIntentId: string | null;
  question: string; sourceDomains: string[]; evidencePack: EvidencePack;
  lineage: { status: "completed"; executionMode: "web.research" | "r12.discovery"; provider: "openrouter.exa"; sourceArtifactId: string; providerRequestId: string; workerRequestId: string;
    qualifiedSource?: { version: "r12.discovery-source.1"; scopeId: string; scopeHash: string; searchCandidateHash: string; selectorCandidateHash: string;
      searchRoute: NonNullable<WorkerExecutionV2["qualifiedRoute"]>; selectorRoute: NonNullable<WorkerExecutionV2["qualifiedRoute"]> } };
};
export type WorkerExecutionV2 = { modelId: string; providerRequestId: string; primaryOnly: true; qualifiedRoute?: Omit<GenerationRouteProof, "providerResponses"> & { providerResponses: Array<GenerationRouteProof["providerResponses"][number]> } };
export type DiscoveryValidationContextV2 = {
  /** Callers must obtain these from owner-scoped, immutable persistence. Pure validation cannot attest provider truth. */
  knowledge: DiscoveryKnowledgeContextV2;
  packs: ReadonlyMap<string, PersistedResearchEvidenceV2>;
  candidates: ReadonlyMap<string, CandidateIdentityV2>;
  /** Explicit owner declarations loaded from persistence; a worker cannot supply these. */
  ownerRightsConfirmedCandidateIds?: readonly string[];
  sellerBankCountry?: string | null;
  /** Conservative already-committed research/worker cost, supplied by the root ledger. */
  committedMicrousd: number;
};
export type EvidenceFactV2 = { reference: EvidenceRefV2; relevance: string };
export type UncertaintyV2 = { question: string; blockingForTest: boolean; reason: string };
export type DimensionEvaluationV2 = {
  dimension: Dimension; finding: "supported" | "uncertain" | "unfavorable"; evidenceStrength: EvidenceStrengthV2;
  facts: EvidenceFactV2[]; rationale: string; uncertainties: UncertaintyV2[]; hardFailure: boolean;
};
export type CandidateEvaluationV2 = { candidateId: string; identityHash: string; dimensions: DimensionEvaluationV2[] };
export type BoundedLearningTestV2 = {
  scope: "private_original_design_test"; name: string; hypothesis: string; deliverable: string;
  successCriteria: string[]; failureCriteria: string[]; stopRule: string;
  maximumMicrousd: number; maximumGenerations: 1 | 2; evidenceRefs: EvidenceRefV2[];
  budgetStatus: "proposal_only"; generationAuthorized: false; spendingAuthorized: false;
  publicationAllowed: false; commerceAllowed: false;
};
export type MarketComparisonV2 = {
  countryCode: string; currency: string; assessment: string; evidenceRefs: EvidenceRefV2[];
  assumptions: string[]; limitations: string[]; sellerBankCountry: string | null;
  feeScenarios: { sellerBankCountry: string; hypothetical: true; explanation: string; evidenceRefs: EvidenceRefV2[] }[];
};
export type StrategistAssessmentV2 = {
  version: typeof DISCOVERY_V2; intentId: string; dossierHash: string; execution: WorkerExecutionV2;
  marketComparisons: MarketComparisonV2[]; candidates: CandidateEvaluationV2[];
  recommendation: { proposedOutcome: DiscoveryOutcomeV2; marketCountryCode: string | null; candidateId: string | null; rationale: string; alternatives: { candidateId: string; rationale: string; evidenceRefs: EvidenceRefV2[] }[] };
  testPlan: BoundedLearningTestV2 | null; missingQuestions: string[];
  publicationAllowed: false; commerceAllowed: false;
};
export type DimensionReviewV2 = {
  dimension: Dimension; verdict: "sufficient_for_test" | "nonblocking_unknown" | "blocking" | "known_failure";
  rationale: string; evidenceRefs: EvidenceRefV2[];
};
export const REVIEW_CHECKS_V2 = ["source_support", "alternative_comparison", "test_learnability", "uncertainty_handling", "hard_gates"] as const;
export type ReviewerDecisionV2 = {
  version: typeof DISCOVERY_V2; intentId: string; dossierHash: string; assessmentHash: string;
  execution: WorkerExecutionV2; marketCountryCode: string | null; candidateId: string | null; outcome: DiscoveryOutcomeV2;
  sufficiencyRationale: string; dimensions: DimensionReviewV2[];
  checks: { check: typeof REVIEW_CHECKS_V2[number]; outcome: "PASS" | "FAIL"; rationale: string }[];
  executionPrerequisites: typeof DISCOVERY_V2_EXECUTION_PREREQUISITES;
  additionalUncertainties: (UncertaintyV2 & { dimension: Dimension })[];
  missingQuestions: string[]; publicationAllowed: false; commerceAllowed: false;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha = /^[a-f0-9]{64}$/;
function fail(message: string): never { throw new Error(message); }
function record(v: unknown): v is Record<string, unknown> { return !!v && typeof v === "object" && !Array.isArray(v); }
function shape(v: unknown, keys: string, label: string): asserts v is Record<string, unknown> {
  if (!record(v) || Object.keys(v).sort().join(",") !== keys.split(",").sort().join(",")) fail(`Invalid ${label} fields.`);
}
function prose(v: unknown, label: string, min = 20, max = 1200): asserts v is string {
  if (typeof v !== "string" || v.trim().length < min || v.length > max) fail(`Bounded, specific ${label} required.`);
}
function id(v: unknown, label: string): asserts v is string { if (typeof v !== "string" || !uuid.test(v)) fail(`Invalid ${label}.`); }
function list(v: unknown, min: number, max: number, label: string): asserts v is unknown[] {
  if (!Array.isArray(v) || v.length < min || v.length > max) fail(`Invalid ${label} count.`);
}
function strings(v: unknown, min: number, max: number, label: string, textMin = 3) {
  list(v, min, max, label);
  v.forEach(x => prose(x, label, textMin, 600));
  if (new Set(v).size !== v.length) fail(`Duplicate ${label}.`);
}
function noCommerce(v: { publicationAllowed: unknown; commerceAllowed: unknown }) {
  if (v.publicationAllowed !== false || v.commerceAllowed !== false) fail("Discovery never grants publication or commerce authority.");
}
function integer(v: unknown, min: number, max: number, label: string) {
  if (!Number.isSafeInteger(v) || (v as number) < min || (v as number) > max) fail(`Invalid ${label}.`);
}
export function discoveryV2Hash(value: unknown): string {
  const canonical = (v: unknown): string => {
    if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
    if (record(v)) return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
    if (v === undefined || (typeof v === "number" && !Number.isFinite(v))) fail("Non-JSON discovery snapshot.");
    return JSON.stringify(v);
  };
  return createHash("sha256").update(canonical(value)).digest("hex");
}
export function validateDiscoveryIntentV2(intent: DiscoveryIntentV2, now = Date.now()): void {
  shape(intent, "version,id,businessId,objective,comparisonUniverse,limits,expiresAt", "discovery intent");
  if (intent.version !== DISCOVERY_V2) fail("Unknown discovery version.");
  id(intent.id, "intent identity"); id(intent.businessId, "Business identity"); prose(intent.objective, "discovery objective");
  shape(intent.comparisonUniverse, "productType,markets,audiences,sourceDomains,selectionQuestion", "comparison universe");
  const u = intent.comparisonUniverse;
  if (u.productType !== "original_pod_tshirt") fail("Discovery product scope changed.");
  list(u.markets, 2, 4, "geographic comparison markets");
  for (const market of u.markets) {
    shape(market, "countryCode,currency", "geographic market");
    if (!/^[A-Z]{2}$/.test(market.countryCode) || !/^[A-Z]{3}$/.test(market.currency)) fail("Country code and scenario currency required.");
  }
  if (new Set(u.markets.map(m => m.countryCode)).size !== u.markets.length) fail("Duplicate geographic market.");
  strings(u.audiences, 1, 3, "comparison audiences");
  prose(u.selectionQuestion, "selection question", 20, 800);
  validateResearchRequest({ query: u.selectionQuestion, allowedDomains: u.sourceDomains });
  shape(intent.limits, "maximumAlternatives,maximumNewCollections,maximumMicrousd,maximumGenerations", "discovery limits");
  if (intent.limits.maximumAlternatives !== 3 || ![0, 1, 2].includes(intent.limits.maximumNewCollections) || ![1, 2].includes(intent.limits.maximumGenerations)) fail("Finite discovery bounds required.");
  integer(intent.limits.maximumMicrousd, 1, 2_000_000, "approved discovery research envelope");
  if (!Number.isFinite(Date.parse(intent.expiresAt)) || Date.parse(intent.expiresAt) <= now) fail("Discovery intent expired.");
}
/** Match PostgreSQL jsonb::text storage gates: one space after each colon/comma.
 * Count structural separators only; punctuation inside evidence/prose is untouched. */
export function discoveryV2SnapshotByteLength(value: unknown): number {
  const spacing = (v: unknown): number => {
    if (Array.isArray(v)) return Math.max(0, v.length - 1) + v.reduce((total, item) => total + spacing(item), 0);
    if (record(v)) {
      const values = Object.values(v);
      return values.length + Math.max(0, values.length - 1) + values.reduce<number>((total, item) => total + spacing(item), 0);
    }
    return 0;
  };
  const serialized = JSON.stringify(value);
  if (serialized === undefined) fail("Non-JSON discovery snapshot.");
  return Buffer.byteLength(serialized, "utf8") + spacing(value);
}
function snapshotBytes(value: unknown, maximum: number, label: string) {
  if (discoveryV2SnapshotByteLength(value) > maximum) fail(`${label} exceeds its bounded serialized snapshot.`);
}
function sameSet(a: readonly string[], b: readonly string[]) { return [...a].sort().join("\n") === [...b].sort().join("\n"); }
function candidateIdentity(candidate: CandidateIdentityV2) {
  shape(candidate, "id,businessId,concept,audience,productType,originalDesign,rightsStatus", "candidate identity");
  id(candidate.id, "candidate ID"); id(candidate.businessId, "candidate Business");
  prose(candidate.concept, "candidate concept", 3, 160); prose(candidate.audience, "candidate audience", 3, 160);
  if (candidate.productType !== "original_pod_tshirt" || typeof candidate.originalDesign !== "boolean" || !["confirmed", "unclear"].includes(candidate.rightsStatus)) fail("Invalid candidate declarations.");
}
export function validateDiscoveryDossierV2(intent: DiscoveryIntentV2, dossier: DiscoveryDossierV2, context: DiscoveryValidationContextV2, now = Date.now()): void {
  validateDiscoveryIntentV2(intent, now);
  integer(context.committedMicrousd, 0, intent.limits.maximumMicrousd, "root committed cost");
  validateDiscoveryKnowledgeV2(context.knowledge, now);
  shape(dossier, "version,intentId,businessId,packRefs,shortlist,comparisonRationale", "discovery dossier");
  if (dossier.version !== DISCOVERY_V2 || dossier.intentId !== intent.id || dossier.businessId !== intent.businessId) fail("Dossier intent/Business mismatch.");
  snapshotBytes(dossier, DISCOVERY_V2_SNAPSHOT_BYTES.dossier, "Dossier");
  prose(dossier.comparisonRationale, "comparison rationale", 40);
  list(dossier.packRefs, 1, 6, "immutable dossier packs");
  if (new Set(dossier.packRefs.map(p => p.artifactId)).size !== dossier.packRefs.length || new Set(dossier.packRefs.map(p => p.query.id)).size !== dossier.packRefs.length) fail("Duplicate pack or query lineage.");
  if (dossier.packRefs.filter(p => p.origin === "new").length > intent.limits.maximumNewCollections || dossier.packRefs.filter(p => p.origin === "prior").length > 4) fail("Dossier collection budget exceeded.");
  for (const ref of dossier.packRefs) {
    shape(ref, "artifactId,sha256,origin,query", "pack reference"); id(ref.artifactId, "artifact reference");
    if (!sha.test(ref.sha256) || !["new", "prior"].includes(ref.origin)) fail("Invalid immutable pack reference.");
    shape(ref.query, "id,question,sourceDomains", "dossier query"); id(ref.query.id, "query identity");
    validateResearchRequest({ query: ref.query.question, allowedDomains: ref.query.sourceDomains });
    if (ref.query.sourceDomains.some(d => !intent.comparisonUniverse.sourceDomains.includes(d))) fail("Query expands source scope.");
    const persisted = context.packs.get(ref.artifactId);
    if (!persisted || persisted.artifactId !== ref.artifactId || persisted.businessId !== intent.businessId || persisted.queryId !== ref.query.id ||
      persisted.question !== ref.query.question || !sameSet(persisted.sourceDomains, ref.query.sourceDomains) || discoveryV2Hash(persisted.evidencePack) !== ref.sha256) fail("Pack does not match persisted query/Business/hash lineage.");
    if ((ref.origin === "new") !== (persisted.collectedForIntentId === intent.id)) fail("Collection origin cannot be relabeled to evade the two-query bound.");
    id(persisted.workflowRunId, "persisted workflow"); id(persisted.lineage.sourceArtifactId, "persisted source artifact");
    const lineage = persisted.lineage;
    if (lineage.status !== "completed" || !["web.research", "r12.discovery"].includes(lineage.executionMode) || lineage.provider !== "openrouter.exa" ||
      [lineage.providerRequestId, lineage.workerRequestId].some(x => typeof x !== "string" || x.length < 3 || x.length > 240 || /(mock|fixture|simulation)/i.test(x))) fail("Real completed research source and worker lineage required.");
    if (lineage.executionMode === "r12.discovery") {
      const qualified = lineage.qualifiedSource;
      shape(qualified, "version,scopeId,scopeHash,searchCandidateHash,selectorCandidateHash,searchRoute,selectorRoute", "qualified source lineage");
      if (qualified.version !== "r12.discovery-source.1" || qualified.scopeId !== persisted.collectedForIntentId || !uuid.test(qualified.scopeId) ||
          ![qualified.scopeHash, qualified.searchCandidateHash, qualified.selectorCandidateHash].every(value => sha.test(value))) fail("Qualified source scope/hash lineage required.");
      for (const [proof, generationId] of [[qualified.searchRoute, lineage.providerRequestId], [qualified.selectorRoute, lineage.workerRequestId]] as const)
        validateGenerationRouteProof(proof, { generationId, providerName: "Azure", requestedEndpoint: "azure/us", acceptedResponseModelIds: ["openai/gpt-5.6-luna", "openai/gpt-5.6-luna-20260709"] });
    } else if (lineage.qualifiedSource !== undefined) fail("Legacy source cannot claim a different qualified origin.");
    validateProductEvidence(persisted.evidencePack, { query: ref.query.question, allowedDomains: ref.query.sourceDomains }, now);
  }
  list(dossier.shortlist, 1, 3, "candidate shortlist");
  if (new Set(dossier.shortlist.map(c => c.id)).size !== dossier.shortlist.length) fail("Duplicate candidate shortlist.");
  for (const candidate of dossier.shortlist) {
    candidateIdentity(candidate);
    if (candidate.businessId !== intent.businessId || !intent.comparisonUniverse.audiences.includes(candidate.audience) ||
      discoveryV2Hash(context.candidates.get(candidate.id)) !== discoveryV2Hash(candidate)) fail("Immutable candidate identity or comparison scope mismatch.");
  }
}
function refKey(ref: EvidenceRefV2) { return `${ref.artifactId}:${ref.evidenceId}:${ref.sourceContentHash}:${ref.start}:${ref.end}`; }
function evidence(ref: EvidenceRefV2, dossier: DiscoveryDossierV2, context: DiscoveryValidationContextV2) {
  shape(ref, "artifactId,evidenceId,sourceId,sourceContentHash,start,end", "evidence reference");
  if (!dossier.packRefs.some(p => p.artifactId === ref.artifactId)) fail("Evidence artifact is outside this dossier.");
  const pack = context.packs.get(ref.artifactId)?.evidencePack;
  const entry = pack?.evidence.find(e => e.id === ref.evidenceId);
  const source = pack?.sources.find(s => s.id === entry?.sourceId);
  if (!entry || !source || !source.excerpt.includes(entry.quote)) fail("Fabricated or broken evidence reference.");
  if (source.id !== ref.sourceId || source.contentHash !== ref.sourceContentHash) fail("Exact-span source/hash lineage mismatch.");
  // Unicode code points, matching PostgreSQL length/substring rather than UTF-16 units.
  const characters = Array.from(source.excerpt);
  integer(ref.start, 0, characters.length - 1, "evidence span start");
  integer(ref.end, ref.start + 1, Math.min(characters.length, ref.start + 320), "evidence span end");
  const quote = characters.slice(ref.start, ref.end).join("");
  if (!quote.trim()) fail("Empty evidence span.");
  return { entry, source, quote };
}
/** Materialize quotations instead of making models echo source text, IDs or hashes as facts. */
export function resolveDiscoveryEvidenceV2(ref: EvidenceRefV2, dossier: DiscoveryDossierV2, context: DiscoveryValidationContextV2) {
  const found = evidence(ref, dossier, context);
  return { reference: { ...ref }, quote: found.quote, url: found.source.url, retrievedAt: found.source.retrievedAt, expiresAt: found.source.retrievalExpiresAt };
}
function references(refs: EvidenceRefV2[], dossier: DiscoveryDossierV2, context: DiscoveryValidationContextV2, min = 0) {
  list(refs, min, 8, "evidence references");
  if (new Set(refs.map(refKey)).size !== refs.length) fail("Duplicate evidence reference.");
  refs.forEach(ref => evidence(ref, dossier, context));
}
function marketSource(url: string) {
  const source = new URL(url);
  return !/\/(seller-handbook|legal|help|blog)(\/|$)/i.test(source.pathname) && !/^(help|support)\./i.test(source.hostname);
}
function execution(actual: WorkerExecutionV2, expected: WorkerExecutionV2, role: keyof typeof DISCOVERY_V2_MODELS) {
  shape(actual, actual.qualifiedRoute ? "modelId,providerRequestId,primaryOnly,qualifiedRoute" : "modelId,providerRequestId,primaryOnly", `${role} execution`);
  let models: readonly string[] = [DISCOVERY_V2_MODELS[role]];
  if (actual.qualifiedRoute) {
    models = role === "strategist" ? ["openai/gpt-5.6-luna", "openai/gpt-5.6-luna-20260709"] : ["anthropic/claude-haiku-4.5", "anthropic/claude-4.5-haiku-20251001"];
    validateGenerationRouteProof(actual.qualifiedRoute, { generationId: actual.providerRequestId, providerName: role === "strategist" ? "Azure" : "Amazon Bedrock", requestedEndpoint: role === "strategist" ? "azure/us" : "amazon-bedrock/us", acceptedResponseModelIds: models });
  }
  if (!models.includes(actual.modelId) || actual.primaryOnly !== true || discoveryV2Hash(actual) !== discoveryV2Hash(expected) ||
    typeof actual.providerRequestId !== "string" || actual.providerRequestId.length < 3 || actual.providerRequestId.length > 240 || /(mock|fixture|simulation)/i.test(actual.providerRequestId)) fail(`Actual primary-only ${role} execution receipt required.`);
}
function dimensionEvaluation(d: DimensionEvaluationV2, dossier: DiscoveryDossierV2, context: DiscoveryValidationContextV2) {
  shape(d, "dimension,finding,evidenceStrength,facts,rationale,uncertainties,hardFailure", "qualitative dimension");
  if (!DIMENSIONS.includes(d.dimension) || !["supported", "uncertain", "unfavorable"].includes(d.finding) || !["direct", "adjacent", "guidance", "none"].includes(d.evidenceStrength) || typeof d.hardFailure !== "boolean") fail("Invalid qualitative finding.");
  prose(d.rationale, "dimension reasoning", 30, 450); list(d.facts, 0, 3, "dimension facts"); list(d.uncertainties, 0, 2, "dimension uncertainties");
  if ((d.evidenceStrength === "none") !== (d.facts.length === 0) || (d.finding !== "uncertain" && d.facts.length === 0)) fail("Unsupported finding cannot become evidence.");
  if ((d.finding === "uncertain" || d.evidenceStrength === "none" || d.evidenceStrength === "adjacent") && !d.uncertainties.length) fail("Unknown or adjacent evidence must retain explicit uncertainty.");
  const market = ["demand", "competition", "seasonality", "marketing_potential"].includes(d.dimension);
  for (const fact of d.facts) {
    shape(fact, "reference,relevance", "source fact"); const found = evidence(fact.reference, dossier, context);
    prose(fact.relevance, "fact relevance", 20, 240);
    if (market && d.evidenceStrength !== "guidance" && !marketSource(found.source.url)) fail("Policy/guidance cannot substantiate observed market interest.");
  }
  if (market && d.finding === "supported" && ["guidance", "none"].includes(d.evidenceStrength)) fail("Weak guidance does not support a market finding.");
  for (const u of d.uncertainties) {
    shape(u, "question,blockingForTest,reason", "uncertainty"); prose(u.question, "exact missing question", 15, 240); prose(u.reason, "test-specific uncertainty implication", 30, 300);
    if (typeof u.blockingForTest !== "boolean") fail("Each uncertainty must be explicitly blocking or nonblocking.");
  }
  const safety = ["policy_ip_risk", "production_complexity"].includes(d.dimension);
  if (d.hardFailure && (!safety || d.finding !== "unfavorable" || d.evidenceStrength !== "direct")) fail("Hard failure requires a supported policy/IP or production finding.");
  if (safety && d.finding === "unfavorable" && !d.hardFailure) fail("Known policy/IP or production failure cannot be waived.");
}
function allDimensions(items: { dimension: Dimension }[]) {
  list(items, 9, 9, "nine dimensions");
  if (!DIMENSIONS.every(d => items.filter(item => item.dimension === d).length === 1)) fail("Evaluate every dimension exactly once.");
}
function selectedAssessment(assessment: StrategistAssessmentV2) { return assessment.candidates.find(c => c.candidateId === assessment.recommendation.candidateId); }
function checkQuestions(questions: string[], required: string[]) {
  strings(questions, 0, 81, "missing questions", 15);
  if (required.some(q => !questions.includes(q)) || questions.some(q => !required.includes(q))) fail("Exact missing questions were dropped or lack classified uncertainty.");
}
export function validateStrategistAssessmentV2(intent: DiscoveryIntentV2, dossier: DiscoveryDossierV2, assessment: StrategistAssessmentV2, context: DiscoveryValidationContextV2, actualExecution: WorkerExecutionV2, now = Date.now()): void {
  validateDiscoveryDossierV2(intent, dossier, context, now);
  shape(assessment, "version,intentId,dossierHash,execution,marketComparisons,candidates,recommendation,testPlan,missingQuestions,publicationAllowed,commerceAllowed", "strategist assessment");
  if (assessment.version !== DISCOVERY_V2 || assessment.intentId !== intent.id || assessment.dossierHash !== discoveryV2Hash(dossier)) fail("Strategist dossier binding mismatch.");
  snapshotBytes(assessment, DISCOVERY_V2_SNAPSHOT_BYTES.strategist, "Strategist");
  execution(assessment.execution, actualExecution, "strategist"); noCommerce(assessment);
  list(assessment.marketComparisons, intent.comparisonUniverse.markets.length, intent.comparisonUniverse.markets.length, "geographic comparisons");
  if (new Set(assessment.marketComparisons.map(m => m.countryCode)).size !== assessment.marketComparisons.length) fail("Compare every geography exactly once.");
  for (const market of assessment.marketComparisons) {
    shape(market, "countryCode,currency,assessment,evidenceRefs,assumptions,limitations,sellerBankCountry,feeScenarios", "market comparison");
    const scope = intent.comparisonUniverse.markets.find(m => m.countryCode === market.countryCode);
    if (!scope || scope.currency !== market.currency) fail("Market comparison changed geography/currency scope.");
    prose(market.assessment, "market comparison reasoning", 40); references(market.evidenceRefs, dossier, context);
    strings(market.assumptions, 0, 8, "market assumptions", 15); strings(market.limitations, 1, 8, "market limitations", 15);
    if (market.sellerBankCountry !== (context.sellerBankCountry ?? null)) fail("Unknown seller bank country cannot be inferred.");
    list(market.feeScenarios, market.sellerBankCountry === null ? 1 : 0, 4, "fee scenarios");
    for (const scenario of market.feeScenarios) {
      shape(scenario, "sellerBankCountry,hypothetical,explanation,evidenceRefs", "hypothetical fee scenario");
      if (!/^[A-Z]{2}$/.test(scenario.sellerBankCountry) || scenario.hypothetical !== true) fail("Fee scenario is an assumption, not a discovered bank fact.");
      prose(scenario.explanation, "fee scenario limitation", 30); references(scenario.evidenceRefs, dossier, context);
    }
  }
  list(assessment.candidates, dossier.shortlist.length, dossier.shortlist.length, "compared candidates");
  if (new Set(assessment.candidates.map(c => c.candidateId)).size !== dossier.shortlist.length) fail("Every shortlisted alternative must be compared.");
  for (const candidate of assessment.candidates) {
    shape(candidate, "candidateId,identityHash,dimensions", "candidate evaluation");
    const identity = dossier.shortlist.find(c => c.id === candidate.candidateId);
    if (!identity || candidate.identityHash !== discoveryV2Hash(identity)) fail("Strategist changed candidate identity.");
    allDimensions(candidate.dimensions); candidate.dimensions.forEach(d => dimensionEvaluation(d, dossier, context));
  }
  shape(assessment.recommendation, "proposedOutcome,marketCountryCode,candidateId,rationale,alternatives", "recommendation");
  const recommendation = assessment.recommendation;
  if (!["TEST", "REJECT", "NEEDS_MORE_EVIDENCE"].includes(recommendation.proposedOutcome) || (recommendation.candidateId !== null && !selectedAssessment(assessment))) fail("Invalid recommended candidate or outcome.");
  if (recommendation.marketCountryCode !== null && !intent.comparisonUniverse.markets.some(m => m.countryCode === recommendation.marketCountryCode)) fail("Recommended geography lies outside comparison universe.");
  if (recommendation.candidateId !== null && recommendation.marketCountryCode === null) fail("Recommend a geography from the compared universe alongside the candidate.");
  prose(recommendation.rationale, "comparative recommendation", 40);
  const alternatives = dossier.shortlist.filter(c => c.id !== recommendation.candidateId);
  list(recommendation.alternatives, alternatives.length, alternatives.length, "alternative explanations");
  if (new Set(recommendation.alternatives.map(a => a.candidateId)).size !== alternatives.length) fail("Duplicate alternative explanation.");
  for (const alternative of recommendation.alternatives) {
    shape(alternative, "candidateId,rationale,evidenceRefs", "alternative explanation");
    if (!alternatives.some(c => c.id === alternative.candidateId)) fail("Alternative lies outside comparison universe.");
    prose(alternative.rationale, "alternative tradeoff", 30); references(alternative.evidenceRefs, dossier, context);
  }
  checkQuestions(assessment.missingQuestions, assessment.candidates.flatMap(c => c.dimensions.flatMap(d => d.uncertainties.map(u => u.question))));
  if (recommendation.proposedOutcome !== "TEST") { if (assessment.testPlan !== null) fail("A learning plan requires an explicit TEST proposal."); return; }
  const selected = selectedAssessment(assessment);
  if (!selected || !assessment.testPlan) fail("TEST needs a named candidate and explicit bounded learning experiment.");
  const plan = assessment.testPlan;
  shape(plan, "scope,name,hypothesis,deliverable,successCriteria,failureCriteria,stopRule,maximumMicrousd,maximumGenerations,evidenceRefs,budgetStatus,generationAuthorized,spendingAuthorized,publicationAllowed,commerceAllowed", "learning test");
  if (plan.scope !== "private_original_design_test") fail("Unapproved test scope."); noCommerce(plan);
  prose(plan.name, "test name", 10, 160); prose(plan.hypothesis, "test hypothesis", 40); prose(plan.deliverable, "test deliverable", 30); prose(plan.stopRule, "test stop rule", 40);
  strings(plan.successCriteria, 1, 5, "test success criteria", 20); strings(plan.failureCriteria, 1, 5, "test failure criteria", 20);
  integer(plan.maximumMicrousd, 1, DISCOVERY_V2_PROPOSAL_CEILING_MICROUSD, "bounded future test proposal");
  if (plan.budgetStatus !== "proposal_only" || plan.generationAuthorized !== false || plan.spendingAuthorized !== false) fail("A future test budget is a proposal, never spending or generation authority.");
  if (![1, 2].includes(plan.maximumGenerations) || plan.maximumGenerations > intent.limits.maximumGenerations) fail("Test generation bound exceeds intent.");
  references(plan.evidenceRefs, dossier, context, 1);
  const facts = new Set(selected.dimensions.flatMap(d => d.facts.map(f => refKey(f.reference))));
  if (plan.evidenceRefs.some(ref => !facts.has(refKey(ref)))) fail("Test cites evidence unrelated to its candidate evaluation.");
  // The independent reviewer may reject this proposal. This validator never promotes it.
}
export function validateReviewerDecisionV2(intent: DiscoveryIntentV2, dossier: DiscoveryDossierV2, assessment: StrategistAssessmentV2, review: ReviewerDecisionV2, context: DiscoveryValidationContextV2, executions: { strategist: WorkerExecutionV2; reviewer: WorkerExecutionV2 }, now = Date.now()): void {
  validateStrategistAssessmentV2(intent, dossier, assessment, context, executions.strategist, now);
  shape(review, "version,intentId,dossierHash,assessmentHash,execution,marketCountryCode,candidateId,outcome,sufficiencyRationale,dimensions,checks,executionPrerequisites,additionalUncertainties,missingQuestions,publicationAllowed,commerceAllowed", "independent reviewer decision");
  snapshotBytes(review, DISCOVERY_V2_SNAPSHOT_BYTES.reviewer, "Reviewer");
  execution(review.execution, executions.reviewer, "reviewer"); noCommerce(review);
  shape(review.executionPrerequisites, "ownerCreativeApproval,freshBudgetApproval,conceptSpecificIpScreen,printValidation", "required execution prerequisites");
  if (discoveryV2Hash(review.executionPrerequisites) !== discoveryV2Hash(DISCOVERY_V2_EXECUTION_PREREQUISITES)) fail("A recommendation cannot satisfy or waive required execution prerequisites.");
  if (review.execution.modelId === assessment.execution.modelId || review.execution.providerRequestId === assessment.execution.providerRequestId) fail("Reviewer must have independent actual model execution.");
  if (review.version !== DISCOVERY_V2 || review.intentId !== intent.id || review.dossierHash !== discoveryV2Hash(dossier) || review.assessmentHash !== discoveryV2Hash(assessment) || review.candidateId !== assessment.recommendation.candidateId || review.marketCountryCode !== assessment.recommendation.marketCountryCode) fail("Review changed its bound assessment or candidate.");
  if (!["TEST", "REJECT", "NEEDS_MORE_EVIDENCE"].includes(review.outcome)) fail("Invalid reviewer outcome.");
  prose(review.sufficiencyRationale, "test-specific sufficiency reasoning", 60, 1600);
  list(review.checks, REVIEW_CHECKS_V2.length, REVIEW_CHECKS_V2.length, "review checks");
  for (const key of REVIEW_CHECKS_V2) if (review.checks.filter(c => c.check === key).length !== 1) fail("Missing independent review check.");
  for (const check of review.checks) { shape(check, "check,outcome,rationale", "review check"); if (!["PASS", "FAIL"].includes(check.outcome)) fail("Invalid review check."); prose(check.rationale, "review check rationale", 30); }
  list(review.additionalUncertainties, 0, 18, "reviewer additional uncertainties");
  for (const uncertainty of review.additionalUncertainties) {
    shape(uncertainty, "dimension,question,blockingForTest,reason", "reviewer uncertainty");
    if (!DIMENSIONS.includes(uncertainty.dimension) || typeof uncertainty.blockingForTest !== "boolean") fail("Reviewer uncertainty requires an evaluated dimension and explicit test impact.");
    prose(uncertainty.question, "reviewer missing question", 15, 240); prose(uncertainty.reason, "reviewer uncertainty implication", 30, 300);
  }
  const allQuestions = [...assessment.missingQuestions, ...review.additionalUncertainties.map(u => u.question)];
  const selected = selectedAssessment(assessment);
  if (!selected) { if (review.dimensions.length || review.outcome === "TEST") fail("No candidate was selected for a test."); checkQuestions(review.missingQuestions, allQuestions); return; }
  allDimensions(review.dimensions);
  for (const item of review.dimensions) {
    shape(item, "dimension,verdict,rationale,evidenceRefs", "reviewed dimension");
    if (!["sufficient_for_test", "nonblocking_unknown", "blocking", "known_failure"].includes(item.verdict)) fail("Invalid dimension review verdict.");
    prose(item.rationale, "reviewed dimension implication", 30); references(item.evidenceRefs, dossier, context);
    const dimension = selected.dimensions.find(d => d.dimension === item.dimension)!;
    const allowed = new Set(dimension.facts.map(f => refKey(f.reference)));
    if (item.evidenceRefs.some(ref => !allowed.has(refKey(ref)))) fail("Review citation does not support this dimension.");
    if (dimension.hardFailure && item.verdict !== "known_failure") fail("Reviewer concealed a known hard failure.");
    const uncertainties = [...dimension.uncertainties, ...review.additionalUncertainties.filter(u => u.dimension === item.dimension)];
    if (uncertainties.some(u => u.blockingForTest) && !["blocking", "known_failure"].includes(item.verdict)) fail("Reviewer cannot silently waive blocking uncertainty.");
    if (item.verdict === "sufficient_for_test" && (!item.evidenceRefs.length || ["none", "guidance"].includes(dimension.evidenceStrength))) fail("Weak evidence cannot become sufficient by declaration.");
    if (item.verdict === "nonblocking_unknown" && (!uncertainties.length || uncertainties.some(u => u.blockingForTest))) fail("Nonblocking unknown requires explicit test-specific reasoning.");
  }
  checkQuestions(review.missingQuestions, allQuestions);
  const identity = dossier.shortlist.find(c => c.id === selected.candidateId)!;
  const knownFailure = !identity.originalDesign || selected.dimensions.some(d => d.hardFailure) || review.dimensions.some(d => d.verdict === "known_failure");
  if (knownFailure && review.outcome !== "REJECT") fail("Known originality/IP/production failure requires REJECT.");
  if (review.outcome !== "TEST") return;
  if (assessment.recommendation.proposedOutcome !== "TEST" || !assessment.testPlan) fail("Reviewer cannot auto-convert NME to a creative feasibility test.");
  if (review.additionalUncertainties.some(u => u.blockingForTest) || review.checks.some(c => c.outcome !== "PASS") || review.dimensions.some(d => ["blocking", "known_failure"].includes(d.verdict)) || selected.dimensions.some(d => d.uncertainties.some(u => u.blockingForTest))) fail("TEST has an unresolved blocking review or uncertainty.");
  const marketComparison = assessment.marketComparisons.find(m => m.countryCode === review.marketCountryCode);
  if (!marketComparison?.evidenceRefs.length) fail("Starting geography needs cited support and explicit comparison limitations.");
  const testRefs = new Set(assessment.testPlan.evidenceRefs.map(refKey));
  const marketBasis = selected.dimensions.some(d => ["demand", "competition", "marketing_potential", "differentiation"].includes(d.dimension) && ["direct", "adjacent"].includes(d.evidenceStrength) && d.facts.some(f => testRefs.has(refKey(f.reference)) && marketSource(evidence(f.reference, dossier, context).source.url)));
  if (!marketBasis) fail("TEST needs relevant observed market evidence, not generic guidance alone.");
}
