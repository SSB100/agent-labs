import { validateR12FocusedSuccessor, type R12FocusedSuccessor } from './discovery-r12-focused-successor';
import type { JsonObject } from "../core/contracts";
import type { QuestAdapterContext, QuestEffectResponse } from "../core/quest-controller";
import type { StructuredModelRequest, WebSearchModelRequest } from "../models/types";
import { DISCOVERY_V2, discoveryV2Hash, type DiscoveryDossierV2, type DiscoveryValidationContextV2, type PersistedResearchEvidenceV2, type ReviewerDecisionV2, type StrategistAssessmentV2, type WorkerExecutionV2 } from "./discovery-v2";
import { discoveryKnowledgeHashV2, pinDiscoveryKnowledgeV2, validateDiscoveryKnowledgeV2, type DiscoveryKnowledgeContextV2 } from "./discovery-v2-knowledge";
import { buildReviewerRequestV2, buildStrategistRequestV2, normalizeReviewerResponseV2, normalizeStrategistResponseV2, prepareDiscoveryWorkerContextV2 } from "./discovery-v2-worker-contract";
import { discoveryAddendumReferences } from "./discovery-r12-evidence-addendum";
import { qualifyDiscoveryR12Candidate } from "./discovery-r12-receipt";
import { validateDiscoveryFocusedPilot, type DiscoveryFocusedPilot } from "./discovery-r12-focused-pilot-scope";
import type { ValidatedFocusedPilot } from "./discovery-r12-focused-pilot-contract";
import type { DiscoveryOriginalScope } from "./discovery-r12-scope";
import type { DiscoveryR12CompletedPhase } from "./discovery-r12-runtime";

export type FocusedPilotHistoricalResult = {
  businessId: string; scopeId: string; goalId: string; planId: string;
  originalFundingRootId: string; sourceScopeHash: string;
  dossier: DiscoveryDossierV2; evidence: PersistedResearchEvidenceV2;
  assessment: StrategistAssessmentV2; review: ReviewerDecisionV2;
};
export type DiscoveryR12FocusedPilotInputs = {
  kind: "focused_pilot"; inputMode: "dispatch" | "receipt"; validationAt: number;
  envelope: DiscoveryFocusedPilot; original: DiscoveryOriginalScope; focusedPilot: ValidatedFocusedPilot;
  knowledge: DiscoveryKnowledgeContextV2; committedBeforeAttemptMicrousd: number;
  dependencies: DiscoveryR12CompletedPhase[]; successor?: R12FocusedSuccessor;
};
const fail = (): never => { throw Error("r12_focused_pilot_inputs_unverified"); };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const same = (a: unknown, b: unknown) => discoveryV2Hash(a) === discoveryV2Hash(b);
const json = (value: unknown): JsonObject => structuredClone(value) as JsonObject;
const exact = (value: unknown, keys: string) => {
  if (!object(value) || Object.keys(value).sort().join(",") !== keys.split(",").sort().join(",")) fail();
};
const execution = (phase: Pick<DiscoveryR12CompletedPhase, "candidate" | "proof">): WorkerExecutionV2 => ({
  modelId: phase.candidate.providerModelId, providerRequestId: phase.candidate.providerRequestId, primaryOnly: true,
  qualifiedRoute: { ...phase.proof, providerResponses: phase.proof.providerResponses.map(row => ({ ...row })) },
});

/** The full normalized accepted NME, every original classified question, and
 * unchanged source times. This object is history only; no old E keys, packs or
 * previousDecision enter the pilot's live supporting-evidence context. */
export function focusedPilotHistoricalRecord(result: FocusedPilotHistoricalResult): JsonObject {
  if (result.review.outcome !== "NEEDS_MORE_EVIDENCE") return fail();
  return json({ ...result.review,
    priorCandidateUncertainties: result.assessment.candidates.map(candidate => ({ candidateId: candidate.candidateId,
      concept: result.dossier.shortlist.find(item => item.id === candidate.candidateId)?.concept ?? fail(),
      dimensions: candidate.dimensions.map(dimension => ({ dimension: dimension.dimension, uncertainties: dimension.uncertainties })) })),
    sourceHistory: { artifactId: result.evidence.artifactId, sourceScopeHash: result.sourceScopeHash,
      sources: result.evidence.evidencePack.sources.map(source => ({ id: source.id, url: source.url, contentHash: source.contentHash, retrievedAt: source.retrievedAt, retrievalExpiresAt: source.retrievalExpiresAt })) },
  });
}
function ownInputs(ctx: QuestAdapterContext, input: DiscoveryR12FocusedPilotInputs) {
  const state = structuredClone(input), e = state.envelope;
  if (state.kind !== "focused_pilot" || ctx.plan.format !== "r12.discovery-pilot.1" ||
      ctx.plan.discoveryScopeId !== e.id || ctx.plan.discoveryScopeHash !== discoveryV2Hash(e) ||
      ctx.plan.businessId !== e.businessId || ctx.plan.goalId !== e.goalId ||
      ctx.plan.maximumDispatches !== 2 || ctx.plan.maximumChildren !== 2 || ctx.plan.maximumRepairs !== 0 || ctx.plan.maximumPivots !== 0 ||
      !same(ctx.plan.requiredChecks, ["review"]) || ctx.plan.steps.length !== 2 ||
      !same(ctx.plan.steps.map(step => ({ key: step.key, kind: step.kind, dependsOn: step.dependsOn })), [
        { key: "strategy", kind: "work", dependsOn: [] }, { key: "review", kind: "review", dependsOn: ["strategy"] },
      ]) || !ctx.plan.steps.some(step => same(step, ctx.step)) || !["strategy", "review"].includes(ctx.step.key) ||
      !["dispatch", "receipt"].includes(state.inputMode) || !Number.isFinite(state.validationAt) || state.validationAt > Date.now() ||
      state.committedBeforeAttemptMicrousd !== state.original.committedMicrousd ||
      state.dependencies.length !== (ctx.step.key === "strategy" ? 0 : 1) || state.dependencies.length !== ctx.attempt.dependencyPins.length) return fail();
  const focusedPilot = validateDiscoveryFocusedPilot(e, state.original, state.validationAt);
  if (state.successor) state.successor = validateR12FocusedSuccessor(state.successor, { businessId: e.businessId, scopeId: e.id, goalId: e.goalId, scope: e }, state.validationAt);
  if (!same(state.focusedPilot, focusedPilot)) return fail();
  validateDiscoveryKnowledgeV2(state.knowledge, state.validationAt);
  for (const dep of state.dependencies) {
    const pin = ctx.attempt.dependencyPins[0];
    if (dep.stepKey !== "strategy" || pin.stepKey !== "strategy" || pin.attemptId !== dep.attemptId || pin.resultHash !== dep.responseHash ||
        dep.responseCanonicalHash !== discoveryV2Hash(dep.response) || dep.response.outcome !== "accepted" || dep.response.planHash !== ctx.planHash ||
        dep.binding.scopeId !== e.id || dep.binding.attemptId !== dep.attemptId || dep.binding.phase !== "strategy" ||
        dep.response.result.candidateHash !== discoveryV2Hash(dep.candidate) || dep.response.result.routeProofHash !== dep.proof.proofHash ||
        dep.response.result.outputHash !== discoveryV2Hash(dep.candidate.output) ||
        !("messages" in dep.binding.request) || dep.binding.request.requestMetadata?.r12FocusedPilotProfileHash !== focusedPilot.profileHash ||
        dep.binding.request.requestMetadata?.r12KnowledgeHash !== discoveryKnowledgeHashV2(state.knowledge) ||
        dep.binding.request.requestMetadata?.r12FocusedSuccessorAuthorizationHash !== state.successor?.authorizationHash ||
        Date.parse(dep.binding.dispatchedAt) > state.validationAt) return fail();
    const committed = dep.binding.request.requestMetadata?.r12CommittedBeforeAttemptMicrousd;
    if (typeof committed !== "number" || !Number.isSafeInteger(committed) || committed < 0 || committed > state.committedBeforeAttemptMicrousd) return fail();
    qualifyDiscoveryR12Candidate(dep.candidate, dep.binding, dep.proof);
  }
  return state;
}

/** The server owns the root/closed-plan/accepted-review joins. The runtime still
 * reconstructs the actual old accepted receipt and requires its exact normalized
 * review and history hashes, rather than trusting a fabricated summary. */
export function readDiscoveryR12FocusedPilotInputs(ctx: QuestAdapterContext, raw: Record<string, unknown>, reconstructHistorical: (raw: Record<string, unknown>, businessId: string, scopeId: string) => FocusedPilotHistoricalResult): DiscoveryR12FocusedPilotInputs {
  exact(raw, "version,businessId,planId,attemptId,inputMode,validationAt,knowledgeSnapshot,knowledgeSnapshotHash,knowledgeCanonicalHash,original,amendment,dependencies,focusedPilot");
  if (raw.version !== "r12.discovery-pilot-inputs.1" || raw.businessId !== ctx.plan.businessId || raw.planId !== ctx.planId || raw.attemptId !== ctx.attempt.id ||
      raw.knowledgeSnapshotHash !== ctx.step.packSnapshotHash || discoveryV2Hash(raw.knowledgeSnapshot) !== raw.knowledgeCanonicalHash ||
      !Array.isArray(raw.dependencies) || Buffer.byteLength(JSON.stringify(raw), "utf8") > 524288) return fail();
  exact(raw.focusedPilot, "profile,profileHash,acceptedReview,closedPlanId,closedPlanHash" + (object(raw.focusedPilot) && Object.hasOwn(raw.focusedPilot, "successor") ? ",successor" : ""));
  const f = raw.focusedPilot as Record<string, unknown>, envelope = raw.amendment as DiscoveryFocusedPilot, original = raw.original as DiscoveryOriginalScope;
  const validationAt = Date.parse(String(raw.validationAt)), focusedPilot = validateDiscoveryFocusedPilot(envelope, original, validationAt);
  if (!same(f.profile, focusedPilot.profile) || f.profileHash !== focusedPilot.profileHash || f.closedPlanId !== envelope.closedPlanId || f.closedPlanHash !== envelope.closedPlanHash || !object(f.acceptedReview)) return fail();
  // Accepted history must be the closed broad discovery, never a nested pilot.
  if (!object(f.acceptedReview.context) || !object(f.acceptedReview.context.plan) || !["r12.discovery.1", "r12.discovery-review.1"].includes(String(f.acceptedReview.context.plan.format))) return fail();
  const historical = reconstructHistorical(f.acceptedReview, envelope.businessId, envelope.acceptedReviewScopeId);
  const originalCandidates = historical.dossier.shortlist.filter(candidate => candidate.id === focusedPilot.profile.candidate.id);
  if (originalCandidates.length !== 1 || !same(originalCandidates[0], focusedPilot.profile.candidate)) return fail();
  const history = focusedPilotHistoricalRecord(historical);
  if (historical.businessId !== envelope.businessId || historical.scopeId !== envelope.acceptedReviewScopeId || historical.goalId !== envelope.originalGoalId ||
      historical.originalFundingRootId !== envelope.budgetAuthorityRootId || discoveryV2Hash(historical.review) !== envelope.acceptedReviewHash ||
      discoveryV2Hash(history) !== envelope.acceptedReviewRecordHash || !same(history, focusedPilot.profile.history.record)) return fail();
  const snapshot = raw.knowledgeSnapshot as DiscoveryKnowledgeContextV2["snapshot"];
  const knowledge = pinDiscoveryKnowledgeV2({ rootPackId: snapshot.rootPackId, releases: snapshot.releases }, validationAt);
  return ownInputs(ctx, { kind: "focused_pilot", inputMode: raw.inputMode as "dispatch" | "receipt", validationAt, envelope, original, focusedPilot, knowledge,
    committedBeforeAttemptMicrousd: original.committedMicrousd, dependencies: raw.dependencies as DiscoveryR12CompletedPhase[],
    ...(Object.hasOwn(f, "successor") ? { successor: validateR12FocusedSuccessor(f.successor, { businessId: envelope.businessId, scopeId: envelope.id, goalId: envelope.goalId, scope: envelope }, validationAt) } : {}) });
}
function analysis(state: DiscoveryR12FocusedPilotInputs, committed = state.committedBeforeAttemptMicrousd, now = state.validationAt) {
  const p = state.focusedPilot.profile;
  const dossier: DiscoveryDossierV2 = { version: DISCOVERY_V2, intentId: p.id, businessId: p.businessId, shortlist: [p.candidate], packRefs: [],
    comparisonRationale: p.history.scopeChangeExplanation, addendumRef: { artifactId: p.observations.id, sha256: discoveryV2Hash(p.observations) } };
  const validation: DiscoveryValidationContextV2 = { knowledge: state.knowledge, packs: new Map(), candidates: new Map([[p.candidate.id, p.candidate]]),
    ownerRightsConfirmedCandidateIds: [], sellerBankCountry: p.observations.sellerBankCountry, committedMicrousd: committed,
    evidenceAddendum: p.observations, focusedPilot: state.focusedPilot };
  return { dossier, prepared: prepareDiscoveryWorkerContextV2(p.intent, dossier, validation, discoveryAddendumReferences(p.observations), now) };
}
function assertSuccessorStrategy(state: DiscoveryR12FocusedPilotInputs, assessment: StrategistAssessmentV2) {
  if (!state.successor || assessment.recommendation.proposedOutcome !== "TEST") return;
  const selected = assessment.candidates.find(candidate => candidate.candidateId === assessment.recommendation.candidateId);
  if (!selected || !assessment.testPlan || selected.dimensions.some(dimension => dimension.hardFailure || dimension.uncertainties.some(uncertainty => uncertainty.blockingForTest))) throw Error("r12_focused_successor_inconsistent_strategy");
}
function strategist(state: DiscoveryR12FocusedPilotInputs) {
  const dep = state.dependencies[0];
  if (!dep || dep.stepKey !== "strategy" || !("messages" in dep.binding.request)) return fail();
  const committed = dep.binding.request.requestMetadata?.r12CommittedBeforeAttemptMicrousd;
  if (typeof committed !== "number") return fail();
  const at = Date.parse(dep.binding.dispatchedAt), historical = analysis(state, committed, at), actual = execution(dep);
  const assessment = normalizeStrategistResponseV2(historical.prepared, dep.candidate.output, actual, at);
  assertSuccessorStrategy(state, assessment);
  if (dep.response.result.assessmentHash !== discoveryV2Hash(assessment)) return fail();
  if (state.successor && assessment.recommendation.proposedOutcome !== "TEST") throw Error("r12_focused_successor_negative_strategy");
  return { ...analysis(state), assessment, execution: actual };
}
export function buildDiscoveryR12FocusedPilotRequest(ctx: QuestAdapterContext, input: DiscoveryR12FocusedPilotInputs): StructuredModelRequest {
  const state = ownInputs(ctx, input);
  if (state.inputMode !== "dispatch" || !["scheduled", "reserved"].includes(ctx.attempt.status)) return fail();
  // Dispatch is checked against the current clock, not merely the saved input
  // time; a late call cannot extend the immutable profile or observation window.
  const now = Date.now();
  validateDiscoveryFocusedPilot(state.envelope, state.original, now);
  if (state.successor) validateR12FocusedSuccessor(state.successor, { businessId: state.envelope.businessId, scopeId: state.envelope.id, goalId: state.envelope.goalId, scope: state.envelope }, now);
  const request = ctx.step.key === "strategy" ? buildStrategistRequestV2(analysis(state).prepared, now) : (() => {
    const found = strategist(state);return buildReviewerRequestV2(found.prepared, found.assessment, found.execution, now);
  })();
  request.requestMetadata = { ...request.requestMetadata, r12CommittedBeforeAttemptMicrousd: state.committedBeforeAttemptMicrousd,
    r12KnowledgeHash: discoveryKnowledgeHashV2(state.knowledge), r12FocusedPilotProfileHash: state.focusedPilot.profileHash,
    ...(state.successor ? { r12FocusedSuccessorAuthorizationHash: state.successor.authorizationHash } : {}) };
  return request;
}
function receiptState(ctx: QuestAdapterContext, input: DiscoveryR12FocusedPilotInputs, qualified: ReturnType<typeof qualifyDiscoveryR12Candidate>, request: StructuredModelRequest | WebSearchModelRequest) {
  const state = ownInputs(ctx, input), current = qualified.candidate;
  if (state.inputMode !== "receipt" || current.phase !== ctx.step.key || current.attemptId !== ctx.attempt.id || current.scopeId !== state.envelope.id ||
      qualified.candidateHash !== discoveryV2Hash(current) || current.requestHash !== discoveryV2Hash(request) || !("messages" in request) ||
      request.requestMetadata?.r12KnowledgeHash !== discoveryKnowledgeHashV2(state.knowledge) || request.requestMetadata?.r12FocusedPilotProfileHash !== state.focusedPilot.profileHash ||
      request.requestMetadata?.r12FocusedSuccessorAuthorizationHash !== state.successor?.authorizationHash) return fail();
  const committed = request.requestMetadata?.r12CommittedBeforeAttemptMicrousd;
  if (typeof committed !== "number" || !Number.isSafeInteger(committed) || committed < 0 || committed > state.committedBeforeAttemptMicrousd) return fail();
  state.committedBeforeAttemptMicrousd = committed;state.original.committedMicrousd = committed;
  return state;
}
export function projectDiscoveryR12FocusedPilotPhase(ctx: QuestAdapterContext, input: DiscoveryR12FocusedPilotInputs, qualified: ReturnType<typeof qualifyDiscoveryR12Candidate>, request: StructuredModelRequest | WebSearchModelRequest): Omit<QuestEffectResponse, "settlement"> {
  const state = receiptState(ctx, input, qualified, request), current = qualified.candidate;
  if (ctx.step.key === "strategy") {
    const assessment = normalizeStrategistResponseV2(analysis(state).prepared, current.output, execution({ candidate: current, proof: qualified.route }), state.validationAt);
    assertSuccessorStrategy(state, assessment);
    return { outcome: "accepted", result: { assessmentHash: discoveryV2Hash(assessment), outcome: assessment.recommendation.proposedOutcome }, checkedArtifacts: [] };
  }
  const found = strategist(state), review = normalizeReviewerResponseV2(found.prepared, found.assessment, current.output,
    { strategist: found.execution, reviewer: execution({ candidate: current, proof: qualified.route }) }, state.validationAt);
  return { outcome: "accepted", result: { verdict: "pass", reviewHash: discoveryV2Hash(review), outcome: review.outcome, candidateId: review.candidateId, marketCountryCode: review.marketCountryCode }, checkedArtifacts: structuredClone(ctx.attempt.dependencyPins) };
}
export function reconstructDiscoveryR12FocusedPilotResult(ctx: QuestAdapterContext, input: DiscoveryR12FocusedPilotInputs, current: DiscoveryR12CompletedPhase) {
  const qualified = qualifyDiscoveryR12Candidate(current.candidate, current.binding, current.proof);
  const state = receiptState(ctx, input, qualified, current.binding.request), found = strategist(state);
  const review = normalizeReviewerResponseV2(found.prepared, found.assessment, current.candidate.output,
    { strategist: found.execution, reviewer: execution(current) }, state.validationAt);
  if (discoveryV2Hash(review) !== current.response.result.reviewHash) return fail();
  const p = state.focusedPilot.profile;
  return { version: "r12.discovery-focused-pilot-result.1" as const, businessId: p.businessId, scopeId: p.id, goalId: p.goalId, planId: ctx.planId,
    historyOnly: true as const, executionAuthorized: false as const, reviewedAt: current.candidate.receivedAt, sourceScopeExpiresAt: p.expiresAt,
    originalFundingRootId: p.budgetAuthorityRootId, sourceScopeHash: discoveryV2Hash(state.envelope), knowledgeHash: discoveryKnowledgeHashV2(state.knowledge),
    objective: p.intent.objective, dossier: found.dossier, assessment: found.assessment, review,
    focusedPilot: p, focusedPilotProfileHash: state.focusedPilot.profileHash, evidenceAddendum: p.observations,
    predecessorScopeId: p.history.acceptedReviewScopeId,
    phaseReceipts: [...state.dependencies, current].map(phase => ({ phase: phase.stepKey, artifactId: phase.artifactId, responseHash: phase.responseHash,
      candidateHash: discoveryV2Hash(phase.candidate), routeProofHash: phase.proof.proofHash })) };
}
