// Pure validation/projection: no provider, persistence, controller or authority writes.
import { containsCredentialLikeValue } from "../core/quest-intake";
import { assertJsonSchemaValue } from "../workers/schema-validator";
import type { JsonObject } from "../core/contracts";
import { discoveryV2Hash, discoveryV2SnapshotByteLength, type BoundedLearningTestV2, type CandidateIdentityV2, type DiscoveryDossierV2, type DiscoveryIntentV2 } from "./discovery-v2";
import { discoveryAddendumReferences, validateDiscoveryEvidenceAddendum, type DiscoveryEvidenceAddendum } from "./discovery-r12-evidence-addendum";
import { discoveryR12StaticSchema } from "./discovery-r12-schemas";
import type { CompactStrategistV2, DiscoveryWorkerContextV2 } from "./discovery-v2-worker-contract";

export const FOCUSED_PILOT_VERSION = "r12.focused-pilot-profile.1" as const;
export type FocusedPilotProfile = {
  version: typeof FOCUSED_PILOT_VERSION;
  id: string; businessId: string; goalId: string;
  originalGoalId: string; budgetAuthorityRootId: string; priorRoundId: string;
  originalIntentHash: string; originalSemanticGoalHash: string;
  intent: DiscoveryIntentV2;
  candidate: CandidateIdentityV2;
  observations: DiscoveryEvidenceAddendum;
  history: {
    acceptedReviewScopeId: string; acceptedReviewHash: string;
    // Full immutable predecessor result/questions, retained as history only.
    record: JsonObject; recordHash: string;
    scopeChangeExplanation: string;
    supportingEvidence: false;
  };
  learningQuestion: string;
  pinnedLearningPlan: BoundedLearningTestV2;
  originalDesignConstraints: {
    noThirdPartyReferences: true; workingTitleOnly: true;
    forbiddenElements: string[];
  };
  researchAllocationMicrousd: number;
  maximumPaidCalls: 2; paidRetryAllowed: false;
  executionAuthorized: false;
  createdAt: string; expiresAt: string;
};

/** All pins must be loaded from trusted immutable persistence, never a form or worker.
 * These are integrity inputs, not cryptographic proof of owner consent. The SQL
 * scope/policy enrollment and owner-confirmation gate remain separately mandatory. */
export type FocusedPilotPersistencePins = {
  profileHash: string; businessId: string; goalId: string; originalGoalId: string;
  budgetAuthorityRootId: string; priorRoundId: string;
  originalIntentHash: string; originalSemanticGoalHash: string;
  acceptedReviewScopeId: string; acceptedReviewHash: string; historicalRecordHash: string;
  originalMaximumMicrousd: number;
};
declare const focusedPilotValidated: unique symbol;
export type ValidatedFocusedPilot = {
  readonly profile: FocusedPilotProfile; readonly profileHash: string;
  readonly [focusedPilotValidated]: true;
};
const fail = (reason: string): never => { throw Error(`r12_focused_pilot_${reason}`); };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown) => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const prose = (v: unknown, min: number, max: number) => typeof v === "string" && v.trim() === v && v.length >= min && v.length <= max;
const money = (v: unknown, min = 0, max = 2_000_000) => Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
const exact = (v: unknown, keys: string) => {
  if (!record(v) || Object.keys(v).sort().join(",") !== keys.split(",").sort().join(",")) fail("shape");
};
const strings = (v: unknown, min: number, max: number, textMin: number, textMax: number) => {
  if (!Array.isArray(v) || v.length < min || v.length > max || new Set(v).size !== v.length || v.some(x => !prose(x, textMin, textMax))) fail("strings");
};
const timestamp = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v));
const same = (a: unknown, b: unknown) => discoveryV2Hash(a) === discoveryV2Hash(b);

/** This ONLY admits the focused profile. Ordinary validateDiscoveryIntentV2 and
 * validateDiscoveryDossierV2 must retain their old market/pack minima. */
export function validateFocusedPilotProfile(raw: unknown, pins: FocusedPilotPersistencePins, now: number): ValidatedFocusedPilot {
  exact(raw, "version,id,businessId,goalId,originalGoalId,budgetAuthorityRootId,priorRoundId,originalIntentHash,originalSemanticGoalHash,intent,candidate,observations,history,learningQuestion,pinnedLearningPlan,originalDesignConstraints,researchAllocationMicrousd,maximumPaidCalls,paidRetryAllowed,executionAuthorized,createdAt,expiresAt");
  const p = raw as FocusedPilotProfile;
  if (!Number.isFinite(now) || p.version !== FOCUSED_PILOT_VERSION || p.executionAuthorized !== false || p.maximumPaidCalls !== 2 || p.paidRetryAllowed !== false || discoveryV2SnapshotByteLength(p) > 65536 || containsCredentialLikeValue(p)) fail("profile");
  for (const key of ["businessId", "goalId", "originalGoalId", "budgetAuthorityRootId", "priorRoundId", "originalIntentHash", "originalSemanticGoalHash"] as const)
    if (p[key] !== pins[key]) fail("persistence_binding");
  if (![p.id, p.businessId, p.goalId, p.originalGoalId, p.budgetAuthorityRootId, p.priorRoundId].every(uuid) ||
      p.goalId === p.originalGoalId || [p.budgetAuthorityRootId, p.priorRoundId].includes(p.id) ||
      ![pins.profileHash, p.originalIntentHash, p.originalSemanticGoalHash].every(hash) || pins.profileHash !== discoveryV2Hash(p)) fail("identity");
  if (!timestamp(p.createdAt) || !timestamp(p.expiresAt) || Date.parse(p.createdAt) > now || Date.parse(p.expiresAt) <= now ||
      Date.parse(p.expiresAt) > Date.parse(p.createdAt) + 86_400_000) fail("expiry");
  exact(p.intent, "version,id,businessId,objective,comparisonUniverse,limits,expiresAt");
  const i = p.intent, u = i.comparisonUniverse;
  exact(u, "productType,markets,audiences,sourceDomains,selectionQuestion");
  exact(i.limits, "maximumAlternatives,maximumNewCollections,maximumMicrousd,maximumGenerations");
  if (i.version !== "pod-discovery-2.0" || i.id !== p.id || i.businessId !== p.businessId || i.expiresAt !== p.expiresAt || !prose(i.objective, 20, 1200) ||
      u.productType !== "original_pod_tshirt" || !same(u.markets, [{ countryCode: "GB", currency: "GBP" }]) ||
      !prose(u.selectionQuestion, 20, 800) || !prose(p.learningQuestion, 20, 800) || u.selectionQuestion !== p.learningQuestion ||
      i.limits.maximumAlternatives !== 3 || i.limits.maximumNewCollections !== 0 || i.limits.maximumGenerations !== 1 ||
      pins.originalMaximumMicrousd !== 2_000_000 || i.limits.maximumMicrousd !== pins.originalMaximumMicrousd ||
      !money(p.researchAllocationMicrousd, 1)) fail("intent");
  strings(u.audiences, 1, 1, 3, 160); strings(u.sourceDomains, 1, 6, 3, 200);
  if (u.sourceDomains.some(d => !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(d) || /\.(local|internal|localhost|test|invalid|example|onion)$/.test(d))) fail("source_domains");
  exact(p.candidate, "id,businessId,concept,audience,productType,originalDesign,rightsStatus");
  if (!uuid(p.candidate.id) || p.candidate.businessId !== p.businessId || !prose(p.candidate.concept, 3, 160) ||
      p.candidate.audience !== u.audiences[0] || p.candidate.productType !== "original_pod_tshirt" || p.candidate.originalDesign !== true ||
      !["confirmed", "unclear"].includes(p.candidate.rightsStatus)) fail("candidate");
  exact(p.history, "acceptedReviewScopeId,acceptedReviewHash,record,recordHash,scopeChangeExplanation,supportingEvidence");
  if (p.history.supportingEvidence !== false || p.history.acceptedReviewScopeId !== pins.acceptedReviewScopeId || !uuid(p.history.acceptedReviewScopeId) ||
      p.history.acceptedReviewHash !== pins.acceptedReviewHash || !hash(p.history.acceptedReviewHash) ||
      p.history.recordHash !== pins.historicalRecordHash || !hash(p.history.recordHash) || !record(p.history.record) ||
      p.history.recordHash !== discoveryV2Hash(p.history.record) || p.history.record.outcome !== "NEEDS_MORE_EVIDENCE" ||
      !prose(p.history.scopeChangeExplanation, 40, 1200)) fail("history");
  strings(p.history.record.missingQuestions, 1, 81, 15, 240);
  exact(p.originalDesignConstraints, "noThirdPartyReferences,workingTitleOnly,forbiddenElements");
  if (p.originalDesignConstraints.noThirdPartyReferences !== true || p.originalDesignConstraints.workingTitleOnly !== true) fail("originality_constraints");
  strings(p.originalDesignConstraints.forbiddenElements, 1, 12, 15, 240);
  validateDiscoveryEvidenceAddendum(p.observations, i, now);
  if (p.observations.goalId !== p.goalId || p.observations.predecessorScopeId !== p.history.acceptedReviewScopeId ||
      p.observations.predecessorReviewHash !== p.history.acceptedReviewHash || Date.parse(p.expiresAt) > Date.parse(p.observations.expiresAt) ||
      p.observations.observations.some(o => !u.sourceDomains.some(d => new URL(o.url).hostname === d || new URL(o.url).hostname.endsWith(`.${d}`)))) fail("observation_binding");
  const refs = discoveryAddendumReferences(p.observations), plan = p.pinnedLearningPlan;
  exact(plan, "scope,name,hypothesis,deliverable,successCriteria,failureCriteria,stopRule,maximumMicrousd,maximumGenerations,evidenceRefs,budgetStatus,generationAuthorized,spendingAuthorized,publicationAllowed,commerceAllowed");
  if (plan.scope !== "private_original_design_test" || !prose(plan.name, 10, 120) || !prose(plan.hypothesis, 40, 320) || !prose(plan.deliverable, 30, 240) ||
      !prose(plan.stopRule, 40, 320) || !money(plan.maximumMicrousd, 1, 1_000_000) || plan.maximumGenerations !== 1 || plan.budgetStatus !== "proposal_only" ||
      [plan.generationAuthorized, plan.spendingAuthorized, plan.publicationAllowed, plan.commerceAllowed].some(v => v !== false)) fail("learning_plan");
  strings(plan.successCriteria, 1, 5, 20, 160); strings(plan.failureCriteria, 1, 5, 20, 160);
  if (!Array.isArray(plan.evidenceRefs) || !plan.evidenceRefs.length || plan.evidenceRefs.length > 8 ||
      new Set(plan.evidenceRefs.map(discoveryV2Hash)).size !== plan.evidenceRefs.length || plan.evidenceRefs.some(r => !refs.some(allowed => same(r, allowed)))) fail("plan_evidence");
  const cited = new Set(plan.evidenceRefs.map(r => r.evidenceId));
  if (!p.observations.observations.some(o => cited.has(o.id) && o.kind === "retail_offer" && o.geographyRole === "buyer_market" && o.countries.includes("GB") && o.dimensions.some(d => ["competition", "differentiation"].includes(d)))) fail("observed_market_basis");
  if (!p.observations.observations.some(o => cited.has(o.id) && o.kind === "official_operating_fact" && o.dimensions.includes("production_complexity") && /(^|\.)printful\.com$/.test(new URL(o.url).hostname))) fail("production_guidance");
  return { profile: structuredClone(p), profileHash: pins.profileHash } as ValidatedFocusedPilot;
}

/** Call this from the narrow trusted branch BEFORE existing dossier semantic
 * validation; only its two minima are substituted. All remaining checks stay. */
export function assertFocusedPilotDossier(validated: ValidatedFocusedPilot, intent: DiscoveryIntentV2, dossier: DiscoveryDossierV2, previousDecision?: unknown): void {
  const p = validated.profile;
  if (validated.profileHash !== discoveryV2Hash(p) || !same(intent, p.intent) || previousDecision !== undefined ||
      dossier.version !== "pod-discovery-2.0" || dossier.intentId !== p.id || dossier.businessId !== p.businessId ||
      !same(dossier.shortlist, [p.candidate]) || !same(dossier.packRefs, []) ||
      !same(dossier.addendumRef, { artifactId: p.observations.id, sha256: discoveryV2Hash(p.observations) })) fail("dossier_binding");
}

/** Merge this field into the existing canonical worker-context binding AND
 * clone the validated profile when prepareDiscoveryWorkerContextV2 copies context. */
export function focusedPilotContextBinding(validated: ValidatedFocusedPilot): { focusedPilotProfileHash: string } {
  if (validated.profileHash !== discoveryV2Hash(validated.profile)) fail("profile_mutated");
  return { focusedPilotProfileHash: validated.profileHash };
}

export type CompactFocusedStrategist = Omit<CompactStrategistV2, "testPlan"> & { usesPinnedLearningPlan: boolean };

/** Static provider grammar contains no profile hash, private strings or evidence
 * identifiers. Dynamic local schemas still enforce the exact C1/GB/E* scope. */
export function focusedPilotStrategySchema(base: JsonObject = discoveryR12StaticSchema("strategy")): JsonObject {
  const schema = structuredClone(base), props = schema.properties as Record<string, JsonObject>;
  if (!props?.testPlan || !Array.isArray(schema.required) || !schema.required.includes("testPlan") || schema.required.some(k => typeof k !== "string")) fail("schema_source");
  const required = schema.required as string[];
  delete props.testPlan;
  props.usesPinnedLearningPlan = { type: "boolean", description: "Return true only when proposing TEST with the exact immutable learning plan supplied in the request. Return false for REJECT or NEEDS_MORE_EVIDENCE. Do not rewrite the plan." };
  schema.required = required.filter(k => k !== "testPlan").concat("usesPinnedLearningPlan");
  for (const key of ["marketComparisons", "candidates"]) {
    if (props[key]?.type !== "array") fail("schema_source");
    props[key].minItems = 1; props[key].maxItems = 1;
  }
  return schema;
}

/** Run after static+dynamic focused response validation. This does not issue a
 * TEST verdict. It expands the explicit acceptance into the exact pinned plan,
 * then the unchanged strategist/reviewer evidence and hard-gate checks must run. */
export function expandFocusedStrategyResponse(validated: ValidatedFocusedPilot, prepared: DiscoveryWorkerContextV2, response: unknown, focusedDynamicSchema: JsonObject): CompactStrategistV2 {
  focusedPilotContextBinding(validated);
  assertFocusedPilotDossier(validated, prepared.intent, prepared.dossier, prepared.validation.previousDecision);
  assertJsonSchemaValue(focusedDynamicSchema, response, "Focused compact strategy response");
  const value = response as CompactFocusedStrategist, isTest = value.recommendation.proposedOutcome === "TEST";
  if (value.usesPinnedLearningPlan !== isTest) fail("explicit_plan_acceptance");
  const { usesPinnedLearningPlan: _accepted, ...rest } = structuredClone(value);
  void _accepted;
  if (!isTest) return { ...rest, testPlan: null };
  if (value.recommendation.candidateKey !== "C1" || value.recommendation.marketCountryCode !== "GB") fail("selected_scope");
  const plan = validated.profile.pinnedLearningPlan;
  const evidence = plan.evidenceRefs.map(ref => {
    const matches = prepared.evidencePool.filter(item => same(item.reference, ref));
    if (matches.length !== 1) return fail("pinned_evidence_missing");
    return matches[0].key;
  });
  const { evidenceRefs: _refs, budgetStatus: _budget, generationAuthorized: _generation, spendingAuthorized: _spending, publicationAllowed: _publication, commerceAllowed: _commerce, ...planFields } = structuredClone(plan);
  void [_refs, _budget, _generation, _spending, _publication, _commerce];
  return { ...rest, testPlan: { ...planFields, evidence } };
}

/** Snapshot quantities are cumulative known plus held liability, supplied under
 * the existing Business->root SQL locks. The snapshot is never pilot-only spend
 * substituted for rootCommittedMicrousd. This function grants no authority. */
export function assertFocusedPilotFunding(p: FocusedPilotProfile, s: {
  rootCommittedMicrousd: number; rootMaximumMicrousd: number;
  businessCommittedMicrousd: number; businessMaximumMicrousd: number;
  pilotCommittedMicrousd: number; hasUnknown: boolean;
}, nextReservationMicrousd: number): void {
  if (![s.rootCommittedMicrousd, s.rootMaximumMicrousd, s.businessCommittedMicrousd, s.businessMaximumMicrousd, s.pilotCommittedMicrousd].every(v => Number.isSafeInteger(v) && v >= 0) ||
      s.hasUnknown !== false || !money(nextReservationMicrousd, 1) || s.rootMaximumMicrousd !== p.intent.limits.maximumMicrousd ||
      s.rootCommittedMicrousd < s.pilotCommittedMicrousd || s.businessCommittedMicrousd < s.pilotCommittedMicrousd ||
      s.rootCommittedMicrousd + nextReservationMicrousd > s.rootMaximumMicrousd ||
      s.businessCommittedMicrousd + nextReservationMicrousd > s.businessMaximumMicrousd ||
      s.pilotCommittedMicrousd + nextReservationMicrousd > p.researchAllocationMicrousd) fail("funding");
}
