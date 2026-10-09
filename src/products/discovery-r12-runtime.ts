import { bindValidatedOwnerResearchIntent, assertValidatedOwnerResearchIntent, type ValidatedOwnerResearchIntent } from "./discovery-r12-goal-intent";
import { validateDiscoveryOwnerInitialScope, type DiscoveryOwnerInitialScope } from "./discovery-r12-goal-scope";
import { isDiscoveryOwnerEpisodeScope, validateDiscoveryOwnerEpisodeScope, validateOwnerEpisodePlan, type DiscoveryOwnerEpisodeScope } from "./discovery-r12-owner-episode";
import type { JsonObject } from "../core/contracts";
import type { QuestAdapterContext, QuestEffectResponse } from "../core/quest-controller";
import { resolveModelRoute } from "../models/registry";
import type { StructuredModelRequest, WebSearchModelRequest } from "../models/types";
import { extractResearchSources, validateResearchCollection } from "../research/sources";
import { type GenerationRouteProof } from "../research/generation-route";
import { DISCOVERY_V2, discoveryV2Hash, resolveDiscoveryEvidenceV2, type CandidateIdentityV2, type DiscoveryDossierV2, type DiscoveryValidationContextV2, type EvidenceRefV2, type PersistedResearchEvidenceV2, type WorkerExecutionV2 } from "./discovery-v2";
import { buildDiscoveryPlannerRequestV2, discoveryDeterministicId, normalizeDiscoveryPlanV2 } from "./discovery-v2-plan";
import { assembleDiscoveryEvidenceV2, buildDiscoverySelectionRequestV2 } from "./discovery-v2-research";
import { buildReviewerRequestV2, buildStrategistRequestV2, normalizeReviewerResponseV2, normalizeStrategistResponseV2, prepareDiscoveryWorkerContextV2 } from "./discovery-v2-worker-contract";
import { discoveryKnowledgeHashV2, pinDiscoveryKnowledgeV2, validateDiscoveryKnowledgeV2, type DiscoveryKnowledgeContextV2 } from "./discovery-v2-knowledge";
import { qualifyDiscoveryR12Candidate, type DiscoveryR12Candidate, type DiscoveryR12CandidateBinding } from "./discovery-r12-receipt";
import { prepareAmendedDiscoveryScope, type AmendedDiscoveryScope, type DiscoveryOriginalScope, type DiscoverySourceScopeAmendment } from "./discovery-r12-scope";
import { validateDiscoveryReviewContinuation, discoveryReviewExecutionIntent, type DiscoveryReviewContinuation } from "./discovery-r12-review-continuation";
import { discoveryEvidenceExecutionIntent, validateDiscoveryEvidenceContinuation, type DiscoveryEvidenceContinuation } from "./discovery-r12-evidence-continuation";
import { discoveryAddendumReferences } from "./discovery-r12-evidence-addendum";
import type { DiscoveryR12Phase } from "./discovery-r12-wire";
import { readDiscoveryR12FocusedPilotInputs, buildDiscoveryR12FocusedPilotRequest, projectDiscoveryR12FocusedPilotPhase, reconstructDiscoveryR12FocusedPilotResult, type DiscoveryR12FocusedPilotInputs } from "./discovery-r12-focused-pilot-runtime";

/** These rows come from the R12 server's exact completed dependency join. They
 * are neither an owner submission nor fabricated legacy worker.output rows. */
export type DiscoveryR12CompletedPhase = {
  stepKey: DiscoveryR12Phase; attemptId: string; artifactId: string; responseHash: string; responseCanonicalHash: string;
  response: { outcome: "accepted"; result: JsonObject; checkedArtifacts: unknown; planHash: string; inputHash: string };
  binding: DiscoveryR12CandidateBinding; candidate: DiscoveryR12Candidate; proof: GenerationRouteProof;
};
type OwnerInitialResearchScope = {
  amendment: DiscoveryOwnerInitialScope | DiscoveryOwnerEpisodeScope; amendmentHash: string; intent: DiscoveryOwnerInitialScope["intent"]; intentHash: string;
  budgetAuthorityRootId: string; originalSemanticGoalHash: string | null; priorRoundId: string | null;
  remainingMicrousd: number; executionAuthorized: false;
};
export type DiscoveryR12LegacyPhaseInputs = {
  inputMode: "dispatch" | "receipt"; validationAt: number;
  scope: AmendedDiscoveryScope | OwnerInitialResearchScope; ownerInitial?: ValidatedOwnerResearchIntent; knowledge: DiscoveryKnowledgeContextV2;
  committedBeforeAttemptMicrousd: number; dependencies: DiscoveryR12CompletedPhase[];
  continuation?: { envelope: DiscoveryReviewContinuation; sourceValidationAt: number; sourceCommittedMicrousd: number };
  evidenceContinuation?: { envelope: DiscoveryEvidenceContinuation; sourceValidationAt: number; sourceCommittedMicrousd: number;
    sourceDependencies: DiscoveryR12CompletedPhase[]; predecessorReview: DiscoveryR12CompletedPhase; predecessorAmendment: DiscoveryReviewContinuation };
};
export type DiscoveryR12PhaseInputs = DiscoveryR12LegacyPhaseInputs | DiscoveryR12FocusedPilotInputs;
const fail = (): never => { throw new Error("r12_discovery_inputs_unverified"); };
const json = (value: unknown): JsonObject => structuredClone(value) as JsonObject;
const routeReceipt = (proof: GenerationRouteProof) => ({ ...proof, providerResponses: proof.providerResponses.map(p => ({ ...p })) });
function workerExecution(dependency: Pick<DiscoveryR12CompletedPhase, "candidate" | "proof">): WorkerExecutionV2 {
  return { modelId: dependency.candidate.providerModelId, providerRequestId: dependency.candidate.providerRequestId, primaryOnly: true, qualifiedRoute: routeReceipt(dependency.proof) };
}
function verifiedDependency(dep: DiscoveryR12CompletedPhase, planHash: string, scopeId: string) {
  if (!dep || dep.responseCanonicalHash !== discoveryV2Hash(dep.response) || dep.response.outcome !== "accepted" || dep.response.planHash !== planHash ||
      dep.binding.scopeId !== scopeId || dep.binding.attemptId !== dep.attemptId || dep.binding.phase !== dep.stepKey || dep.response.result.candidateHash !== discoveryV2Hash(dep.candidate) ||
      dep.response.result.routeProofHash !== dep.proof.proofHash || dep.response.result.outputHash !== discoveryV2Hash(dep.candidate.output)) return fail();
  qualifyDiscoveryR12Candidate(dep.candidate, dep.binding, dep.proof);
}
function legacyScope(state: DiscoveryR12LegacyPhaseInputs): AmendedDiscoveryScope {
  if (state.ownerInitial || state.scope.amendment.version !== "r12.discovery-source-scope.1") return fail();
  return state.scope as AmendedDiscoveryScope;
}
function ownEvidenceInputs(ctx: QuestAdapterContext, state: DiscoveryR12LegacyPhaseInputs) {
  const { evidenceContinuation: continuation } = state, scope = legacyScope(state);
  if (!continuation || state.continuation) return fail();
  const envelope = validateDiscoveryEvidenceContinuation(continuation.envelope, scope, state.validationAt);
  if (!continuation.predecessorAmendment || continuation.predecessorAmendment.id !== envelope.predecessorScopeId || discoveryV2Hash(continuation.predecessorAmendment) !== envelope.predecessorScopeHash) return fail();
  if (ctx.plan.format !== "r12.discovery-evidence.1" || ctx.plan.discoveryScopeId !== envelope.id || ctx.plan.discoveryScopeHash !== discoveryV2Hash(envelope) ||
      ctx.plan.businessId !== envelope.businessId || ctx.plan.goalId !== envelope.goalId || scope.amendmentHash !== discoveryV2Hash(scope.amendment) || scope.intentHash !== discoveryV2Hash(scope.intent) ||
      ctx.plan.maximumDispatches !== 8 || ctx.plan.maximumChildren !== 9 || !["strategy", "review"].includes(ctx.step.key) ||
      !["dispatch", "receipt"].includes(state.inputMode) || !Number.isFinite(state.validationAt) || state.validationAt > Date.now() ||
      !Number.isSafeInteger(state.committedBeforeAttemptMicrousd) || state.committedBeforeAttemptMicrousd < Number(envelope.baseKnownMicrounits) || state.committedBeforeAttemptMicrousd > scope.intent.limits.maximumMicrousd ||
      !Number.isFinite(continuation.sourceValidationAt) || continuation.sourceValidationAt > state.validationAt ||
      !Number.isSafeInteger(continuation.sourceCommittedMicrousd) || continuation.sourceCommittedMicrousd < 0 || continuation.sourceCommittedMicrousd > state.committedBeforeAttemptMicrousd ||
      continuation.sourceDependencies.length !== 4 || state.dependencies.length !== (ctx.step.key === "strategy" ? 3 : 4) || state.dependencies.length !== ctx.attempt.dependencyPins.length) return fail();
  validateDiscoveryKnowledgeV2(state.knowledge, state.validationAt);
  continuation.sourceDependencies.forEach((dep, index) => {
    const pin = envelope.sourcePhases[index];
    if (dep.stepKey !== pin.stepKey || dep.attemptId !== pin.attemptId || dep.artifactId !== pin.artifactId || dep.responseHash !== pin.responseHash) return fail();
    verifiedDependency(dep, envelope.sourcePlanHash, envelope.sourceScopeId);
  });
  const originalStrategy = continuation.sourceDependencies[3];
  if (Date.parse(originalStrategy.binding.dispatchedAt) !== continuation.sourceValidationAt || !("messages" in originalStrategy.binding.request) || originalStrategy.binding.request.requestMetadata?.r12CommittedBeforeAttemptMicrousd !== continuation.sourceCommittedMicrousd) return fail();
  const previous = continuation.predecessorReview, history = envelope.reviewHistory.at(-1)!;
  verifiedDependency(previous, history.planHash, history.scopeId);
  if (previous.stepKey !== "review" || previous.attemptId !== history.attemptId || previous.candidate.providerRequestId.length < 3 ||
      previous.binding.requestId !== history.requestId || previous.candidate.reportedMicrousd !== Number(history.actualMicrounits) ||
      previous.response.result.outcome !== "NEEDS_MORE_EVIDENCE" || previous.candidate.output.outcome !== "NEEDS_MORE_EVIDENCE" || previous.response.result.reviewHash !== envelope.addendum.predecessorReviewHash) return fail();
  const known = continuation.sourceDependencies.reduce((sum, dep) => sum + Number(dep.candidate.reportedMicrousd), 0) + envelope.reviewHistory.reduce((sum, review) => sum + Number(review.actualMicrounits), 0);
  if (known !== Number(envelope.baseKnownMicrounits)) return fail();
  state.dependencies.forEach((dep, index) => {
    const pin = ctx.attempt.dependencyPins.find(pin => pin.stepKey === dep.stepKey);
    if (!pin || dep.stepKey !== ["plan", "search1", "select1", "strategy"][index] || pin.attemptId !== dep.attemptId || pin.resultHash !== dep.responseHash) return fail();
    if (index < 3) {
      if (discoveryV2Hash(dep) !== discoveryV2Hash(continuation.sourceDependencies[index])) return fail();
    } else verifiedDependency(dep, ctx.planHash, envelope.id);
  });
  return state;
}
function ownInputs(ctx: QuestAdapterContext, input: DiscoveryR12LegacyPhaseInputs) {
  const state = structuredClone(input), { scope, continuation } = state;
  if (state.evidenceContinuation) return ownEvidenceInputs(ctx, state);
  if (state.ownerInitial) {
    const episode = isDiscoveryOwnerEpisodeScope(scope.amendment);
    const current = isDiscoveryOwnerEpisodeScope(scope.amendment) ? validateDiscoveryOwnerEpisodeScope(scope.amendment, state.validationAt) : validateDiscoveryOwnerInitialScope(scope.amendment as DiscoveryOwnerInitialScope, state.validationAt);
    if (isDiscoveryOwnerEpisodeScope(current)) validateOwnerEpisodePlan(ctx.plan, current);
    assertValidatedOwnerResearchIntent(scope.intent, state.ownerInitial);
    if (continuation || state.evidenceContinuation || ctx.plan.format !== (episode ? "r12.discovery-episode.1" : "r12.discovery.1") || current.goalRevision !== ctx.plan.goalRevision || current.goalHash !== ctx.plan.goalHash ||
        current.businessRevision !== ctx.plan.businessRevision || current.businessHash !== ctx.plan.businessHash || state.ownerInitial.scopeHash !== scope.amendmentHash ||
        state.ownerInitial.scopeId !== current.id || !episode && Number(ctx.plan.maximumMicrounits) !== current.intent.limits.maximumMicrousd ||
        state.committedBeforeAttemptMicrousd !== state.dependencies.reduce((total, phase) => total + Number(phase.candidate.reportedMicrousd), 0)) return fail();
  } else if (scope.amendment.version !== "r12.discovery-source-scope.1") return fail();
  const executionScope = continuation?.envelope ?? scope.amendment;
  if (ctx.plan.format !== (continuation ? "r12.discovery-review.1" : isDiscoveryOwnerEpisodeScope(executionScope) ? "r12.discovery-episode.1" : "r12.discovery.1") || ctx.plan.discoveryScopeId !== executionScope.id || ctx.plan.discoveryScopeHash !== discoveryV2Hash(executionScope) || scope.amendmentHash !== discoveryV2Hash(scope.amendment) || scope.intentHash !== discoveryV2Hash(scope.intent) ||
      scope.intent.businessId !== ctx.plan.businessId || scope.amendment.goalId !== ctx.plan.goalId || scope.intent.id !== scope.amendment.id ||
      !Number.isSafeInteger(state.committedBeforeAttemptMicrousd) || state.committedBeforeAttemptMicrousd < 0 || state.committedBeforeAttemptMicrousd > scope.intent.limits.maximumMicrousd ||
      state.dependencies.length !== ctx.attempt.dependencyPins.length || new Set(state.dependencies.map(d => d.stepKey)).size !== state.dependencies.length) return fail();
  if (!["dispatch", "receipt"].includes(state.inputMode) || !Number.isFinite(state.validationAt) || state.validationAt > Date.now()) return fail();
  validateDiscoveryKnowledgeV2(state.knowledge, state.validationAt);
  if (continuation) {
    validateDiscoveryReviewContinuation(continuation.envelope, legacyScope(state), state.validationAt);
    if (ctx.step.key !== "review" || state.dependencies.length !== 4 || !Number.isFinite(continuation.sourceValidationAt) || continuation.sourceValidationAt > state.validationAt ||
        !Number.isSafeInteger(continuation.sourceCommittedMicrousd) || continuation.sourceCommittedMicrousd < 0 || continuation.sourceCommittedMicrousd > state.committedBeforeAttemptMicrousd) return fail();
    const strategy = state.dependencies.find(dep => dep.stepKey === "strategy");
    if (!strategy || Date.parse(strategy.binding.dispatchedAt) !== continuation.sourceValidationAt || !("messages" in strategy.binding.request) || strategy.binding.request.requestMetadata?.r12CommittedBeforeAttemptMicrousd !== continuation.sourceCommittedMicrousd) return fail();
  }
  for (const dep of state.dependencies) {
    const pin = ctx.attempt.dependencyPins.find(pin => pin.stepKey === dep.stepKey);
    if (!pin || pin.attemptId !== dep.attemptId || pin.resultHash !== dep.responseHash || dep.responseCanonicalHash !== discoveryV2Hash(dep.response) || dep.response.outcome !== "accepted" ||
        dep.response.planHash !== (continuation?.envelope.sourcePlanHash ?? ctx.planHash) || dep.binding.scopeId !== scope.amendment.id || dep.binding.attemptId !== dep.attemptId || dep.binding.phase !== dep.stepKey ||
        dep.response.result.candidateHash !== discoveryV2Hash(dep.candidate) || dep.response.result.routeProofHash !== dep.proof.proofHash || dep.response.result.outputHash !== discoveryV2Hash(dep.candidate.output)) return fail();
    if (continuation) {
      const original = continuation.envelope.sourcePhases.find(phase => phase.stepKey === dep.stepKey);
      if (!original || original.attemptId !== dep.attemptId || original.artifactId !== dep.artifactId || original.responseHash !== dep.responseHash) return fail();
    }
    qualifyDiscoveryR12Candidate(dep.candidate, dep.binding, dep.proof);
  }
  if (continuation) {
    const previous = continuation.envelope.version === "r12.discovery-review-continuation.2" ? continuation.envelope.reviewHistory : [];
    const known = state.dependencies.reduce((total, phase) => total + Number(phase.candidate.reportedMicrousd), 0) + previous.reduce((total, review) => total + Number(review.actualMicrounits), 0);
    if (Number(continuation.envelope.baseKnownMicrounits) !== known || ctx.plan.maximumDispatches !== continuation.envelope.baseDispatches + 1 || ctx.plan.maximumChildren !== continuation.envelope.baseChildren + 1) return fail();
  }
  return state;
}
/** Validate the exact server read before using its saved records as evidence. */
export function readDiscoveryR12PhaseInputs(ctx: QuestAdapterContext, raw: Record<string, unknown>): DiscoveryR12PhaseInputs {
  if (ctx.plan.format === "r12.discovery-pilot.1") return readDiscoveryR12FocusedPilotInputs(ctx, raw, reconstructLegacyDiscoveryR12Result);
  if (raw.version === "r12.discovery-owner-initial-inputs.1" || raw.version === "r12.discovery-owner-episode-inputs.1") {
    const episode = raw.version === "r12.discovery-owner-episode-inputs.1";
    if (ctx.plan.format !== (episode ? "r12.discovery-episode.1" : "r12.discovery.1") || raw.businessId !== ctx.plan.businessId || raw.planId !== ctx.planId || raw.attemptId !== ctx.attempt.id ||
        raw.knowledgeSnapshotHash !== ctx.step.packSnapshotHash || discoveryV2Hash(raw.knowledgeSnapshot) !== raw.knowledgeCanonicalHash ||
        !Array.isArray(raw.dependencies) || raw.hasUncertainCosts !== false || !Number.isSafeInteger(raw.committedMicrousd) || Number(raw.committedMicrousd) < 0) return fail();
    const validationAt = Date.parse(String(raw.validationAt)), inputMode = raw.inputMode as DiscoveryR12LegacyPhaseInputs["inputMode"];
    const amendment = episode ? validateDiscoveryOwnerEpisodeScope(raw.amendment as DiscoveryOwnerEpisodeScope, validationAt) : validateDiscoveryOwnerInitialScope(raw.amendment as DiscoveryOwnerInitialScope, validationAt), amendmentHash = discoveryV2Hash(amendment);
    const ownerInitial = bindValidatedOwnerResearchIntent(amendment.intent, { scopeId: amendment.id, scopeHash: amendmentHash, approvedQuery: amendment.approvedQuery }, validationAt);
    const snapshot = raw.knowledgeSnapshot as DiscoveryKnowledgeContextV2["snapshot"], knowledge = pinDiscoveryKnowledgeV2({ rootPackId: snapshot.rootPackId, releases: snapshot.releases }, validationAt);
    const scope: OwnerInitialResearchScope = { amendment, amendmentHash, intent: amendment.intent, intentHash: discoveryV2Hash(amendment.intent),
      budgetAuthorityRootId: amendment.funding.authorityRootId, originalSemanticGoalHash: amendment.funding.originalSemanticGoalHash, priorRoundId: amendment.funding.priorRoundId,
      remainingMicrousd: amendment.intent.limits.maximumMicrousd - Number(raw.committedMicrousd), executionAuthorized: false };
    return ownInputs(ctx, { inputMode, validationAt, scope, ownerInitial, knowledge, committedBeforeAttemptMicrousd: Number(raw.committedMicrousd), dependencies: raw.dependencies as DiscoveryR12CompletedPhase[] });
  }
  const isContinuation = ctx.plan.format === "r12.discovery-review.1";
  const isEvidence = ctx.plan.format === "r12.discovery-evidence.1";
  if (raw.version !== (isContinuation ? "r12.discovery-review-inputs.1" : isEvidence ? "r12.discovery-evidence-inputs.1" : "r12.discovery-inputs.1") || raw.businessId !== ctx.plan.businessId || raw.planId !== ctx.planId || raw.attemptId !== ctx.attempt.id ||
      raw.knowledgeSnapshotHash !== ctx.step.packSnapshotHash || discoveryV2Hash(raw.knowledgeSnapshot) !== raw.knowledgeCanonicalHash || !Array.isArray(raw.dependencies)) return fail();
  const original = raw.original as DiscoveryOriginalScope, snapshot = raw.knowledgeSnapshot as DiscoveryKnowledgeContextV2["snapshot"];
  const validationAt = Date.parse(String(raw.validationAt)), inputMode = raw.inputMode as DiscoveryR12LegacyPhaseInputs["inputMode"];
  if ((isContinuation || isEvidence) && (typeof raw.sourceCommittedMicrousd !== "number" || !Number.isSafeInteger(raw.sourceCommittedMicrousd))) return fail();
  const continuation = isContinuation ? { envelope: raw.amendment as DiscoveryReviewContinuation, sourceValidationAt: Date.parse(String(raw.sourceValidationAt)), sourceCommittedMicrousd: Number(raw.sourceCommittedMicrousd) } : undefined;
  const evidenceContinuation = isEvidence ? { envelope: raw.amendment as DiscoveryEvidenceContinuation, sourceValidationAt: Date.parse(String(raw.sourceValidationAt)), sourceCommittedMicrousd: Number(raw.sourceCommittedMicrousd), sourceDependencies: raw.sourceDependencies as DiscoveryR12CompletedPhase[], predecessorReview: raw.predecessorReview as DiscoveryR12CompletedPhase, predecessorAmendment: raw.predecessorAmendment as DiscoveryReviewContinuation } : undefined;
  const historical = continuation ?? evidenceContinuation;
  const sourceOriginal = historical ? { ...original, committedMicrousd: historical.sourceCommittedMicrousd } : original;
  const scope = prepareAmendedDiscoveryScope(sourceOriginal, (historical ? raw.sourceAmendment : raw.amendment) as DiscoverySourceScopeAmendment, historical?.sourceValidationAt ?? validationAt);
  const knowledge = pinDiscoveryKnowledgeV2({ rootPackId: snapshot.rootPackId, releases: snapshot.releases }, validationAt);
  return ownInputs(ctx, { inputMode, validationAt, scope, knowledge, committedBeforeAttemptMicrousd: original.committedMicrousd, dependencies: raw.dependencies as DiscoveryR12CompletedPhase[], ...(continuation ? { continuation } : {}), ...(evidenceContinuation ? { evidenceContinuation } : {}) });
}
function dependency(state: DiscoveryR12LegacyPhaseInputs, key: DiscoveryR12Phase) {
  const dep = state.dependencies.find(dep => dep.stepKey === key);if (!dep) return fail();return dep;
}
const sourceTime = (state: DiscoveryR12LegacyPhaseInputs) => state.continuation?.sourceValidationAt ?? state.evidenceContinuation?.sourceValidationAt ?? state.validationAt;
function reviewedPlan(state: DiscoveryR12LegacyPhaseInputs, output: JsonObject) {
  const plan = normalizeDiscoveryPlanV2(state.scope.intent, output, state.ownerInitial ? "owner_initial" : "qualified_public", sourceTime(state), state.ownerInitial);
  // Keep the model's advisory focus in its immutable candidate. The executable
  // search question comes only from the separately reviewed source amendment.
  return { ...plan, queries: [{ ...plan.queries[0], question: state.scope.amendment.approvedQuery }] };
}
function planAndCandidates(state: DiscoveryR12LegacyPhaseInputs) {
  const dep = dependency(state, "plan"), plan = reviewedPlan(state, dep.candidate.output);
  const candidates: CandidateIdentityV2[] = plan.proposals.map(proposal => ({ id: discoveryDeterministicId(`r12:candidate:${state.scope.amendment.id}:${proposal.proposalKey}`), businessId: state.scope.intent.businessId,
    concept: proposal.concept, audience: proposal.audience, productType: "original_pod_tshirt", originalDesign: true, rightsStatus: "unclear" }));
  if (dep.response.result.planHash !== discoveryV2Hash(plan) || discoveryV2Hash(dep.response.result.candidates) !== discoveryV2Hash(candidates)) return fail();
  return { plan, candidates, query: plan.queries[0] };
}
function collection(state: DiscoveryR12LegacyPhaseInputs) {
  const planned = planAndCandidates(state), search = dependency(state, "search1");
  const request = { query: planned.query.question, allowedDomains: planned.query.sourceDomains };
  if (!("query" in search.binding.request) || search.binding.request.query !== request.query || discoveryV2Hash(search.binding.request.allowedDomains) !== discoveryV2Hash(request.allowedDomains)) return fail();
  const sourceCollection = extractResearchSources(request, { annotations: search.candidate.output.annotations as JsonObject[], metadata: {
    executionMode: "r12.discovery.search1", intentId: state.scope.intent.id, queryId: planned.query.queryId, providerRequestId: search.candidate.providerRequestId,
    sourceScopeHash: state.scope.amendmentHash, candidateHash: discoveryV2Hash(search.candidate), routeProofHash: search.proof.proofHash,
  } }, search.candidate.receivedAt);
  validateResearchCollection(sourceCollection, request, sourceTime(state));
  if (search.response.result.collectionHash !== discoveryV2Hash(sourceCollection)) return fail();
  return { ...planned, request, sourceCollection, search };
}
function preparedAnalysis(state: DiscoveryR12LegacyPhaseInputs) {
  const collected = collection(state), selected = dependency(state, "select1");
  const pack = assembleDiscoveryEvidenceV2(collected.sourceCollection, collected.request, selected.candidate.output, Date.parse(selected.candidate.receivedAt));
  if (selected.response.result.evidencePackHash !== discoveryV2Hash(pack)) return fail();
  const persisted: PersistedResearchEvidenceV2 = { artifactId: selected.artifactId, businessId: state.scope.intent.businessId, workflowRunId: selected.attemptId,
    queryId: collected.query.queryId, collectedForIntentId: state.scope.intent.id, question: collected.query.question, sourceDomains: collected.query.sourceDomains, evidencePack: pack,
    lineage: { status: "completed", executionMode: "r12.discovery", provider: "openrouter.exa", sourceArtifactId: collected.search.artifactId,
      providerRequestId: collected.search.candidate.providerRequestId, workerRequestId: selected.candidate.providerRequestId,
      qualifiedSource: { version: "r12.discovery-source.1", scopeId: state.scope.amendment.id, scopeHash: state.scope.amendmentHash,
        searchCandidateHash: discoveryV2Hash(collected.search.candidate), selectorCandidateHash: discoveryV2Hash(selected.candidate),
        searchRoute: routeReceipt(collected.search.proof), selectorRoute: routeReceipt(selected.proof) } } };
  const dossier: DiscoveryDossierV2 = { version: DISCOVERY_V2, intentId: state.scope.intent.id, businessId: state.scope.intent.businessId, comparisonRationale: collected.plan.comparisonRationale,
    shortlist: collected.candidates, packRefs: [{ artifactId: persisted.artifactId, sha256: discoveryV2Hash(pack), origin: "new", query: { id: collected.query.queryId, question: collected.query.question, sourceDomains: collected.query.sourceDomains } }] };
  const validation: DiscoveryValidationContextV2 = { knowledge: state.knowledge, packs: new Map([[persisted.artifactId, persisted]]), candidates: new Map(collected.candidates.map(candidate => [candidate.id, candidate])),
    ownerRightsConfirmedCandidateIds: [], sellerBankCountry: state.evidenceContinuation?.envelope.addendum.sellerBankCountry ?? null, ...(state.ownerInitial ? { ownerInitial: state.ownerInitial } : {}), committedMicrousd: state.continuation?.sourceCommittedMicrousd ?? state.committedBeforeAttemptMicrousd };
  const references: EvidenceRefV2[] = pack.evidence.map(e => {
    const source = pack.sources.find(source => source.id === e.sourceId);if (!source) return fail();
    const position = source.excerpt.indexOf(e.quote);if (position < 0) return fail();
    const start = Array.from(source.excerpt.slice(0, position)).length;
    return { artifactId: persisted.artifactId, evidenceId: e.id, sourceId: source.id, sourceContentHash: source.contentHash, start, end: start + Array.from(e.quote).length };
  });
  const evidence = state.evidenceContinuation;
  if (evidence) {
    dossier.addendumRef = { artifactId: evidence.envelope.addendum.id, sha256: evidence.envelope.addendumHash };
    validation.evidenceAddendum = evidence.envelope.addendum;
    validation.previousDecision = priorEvidenceDecision(state);
    references.push(...discoveryAddendumReferences(evidence.envelope.addendum));
  }
  const intent = evidence ? discoveryEvidenceExecutionIntent(legacyScope(state), evidence.envelope, state.validationAt) : state.scope.intent;
  return { prepared: prepareDiscoveryWorkerContextV2(intent, dossier, validation, references, evidence ? state.validationAt : sourceTime(state)), dossier, persisted, references, validation, candidates: collected.candidates };
}
function strategist(state: DiscoveryR12LegacyPhaseInputs) {
  const dep = dependency(state, "strategy"), analysis = preparedAnalysis(state), execution = workerExecution(dep);
  const assessment = normalizeStrategistResponseV2(analysis.prepared, dep.candidate.output, execution, state.evidenceContinuation ? state.validationAt : sourceTime(state));
  if (dep.response.result.assessmentHash !== discoveryV2Hash(assessment)) return fail();
  const prepared = state.continuation ? prepareDiscoveryWorkerContextV2(
    discoveryReviewExecutionIntent(legacyScope(state), state.continuation.envelope, state.validationAt), analysis.dossier,
    { ...analysis.validation, committedMicrousd: state.committedBeforeAttemptMicrousd }, analysis.references, state.validationAt) : analysis.prepared;
  return { ...analysis, prepared, assessment, execution };
}
function priorEvidenceDecision(state: DiscoveryR12LegacyPhaseInputs): JsonObject {
  const previous = state.evidenceContinuation;if (!previous) return fail();
  const saved = previous.predecessorReview, at = Date.parse(saved.binding.dispatchedAt);
  if (!("messages" in saved.binding.request)) return fail();
  const committed = saved.binding.request.requestMetadata?.r12CommittedBeforeAttemptMicrousd;
  if (typeof committed !== "number" || !Number.isSafeInteger(committed)) return fail();
  validateDiscoveryReviewContinuation(previous.predecessorAmendment, legacyScope(state), at);
  const historical: DiscoveryR12LegacyPhaseInputs = { inputMode: "receipt", validationAt: at, scope: legacyScope(state), knowledge: state.knowledge,
    committedBeforeAttemptMicrousd: committed, dependencies: previous.sourceDependencies,
    continuation: { envelope: previous.predecessorAmendment, sourceValidationAt: previous.sourceValidationAt, sourceCommittedMicrousd: previous.sourceCommittedMicrousd } };
  const original = strategist(historical);
  const review = normalizeReviewerResponseV2(original.prepared, original.assessment, saved.candidate.output,
    { strategist: original.execution, reviewer: workerExecution(saved) }, at);
  if (discoveryV2Hash(review) !== saved.response.result.reviewHash || review.outcome !== "NEEDS_MORE_EVIDENCE") return fail();
  // Full classified questions survive. Citations are resolved against the OLD
  // evidence pool; old compact E keys never enter the newly sorted pool.
  return json({ outcome: review.outcome, marketCountryCode: review.marketCountryCode, candidateId: review.candidateId,
    sufficiencyRationale: review.sufficiencyRationale, checks: review.checks,
    dimensions: review.dimensions.map(d => ({ dimension: d.dimension, verdict: d.verdict, rationale: d.rationale,
      evidence: d.evidenceRefs.map(ref => { const resolved = resolveDiscoveryEvidenceV2(ref, original.dossier, original.validation);return { reference: resolved.reference, quote: resolved.quote, url: resolved.url }; }) })),
    priorCandidateUncertainties: original.assessment.candidates.map(candidate => ({ candidateId: candidate.candidateId,
      concept: original.dossier.shortlist.find(item => item.id === candidate.candidateId)!.concept,
      dimensions: candidate.dimensions.map(d => ({ dimension: d.dimension, uncertainties: d.uncertainties })) })),
    additionalUncertainties: review.additionalUncertainties, missingQuestions: review.missingQuestions });
}
export function buildDiscoveryR12PhaseRequest(ctx: QuestAdapterContext, input: DiscoveryR12PhaseInputs): StructuredModelRequest | WebSearchModelRequest {
  if ("kind" in input) return buildDiscoveryR12FocusedPilotRequest(ctx, input);
  const state = ownInputs(ctx, input), phase = ctx.step.key as DiscoveryR12Phase;
  if (state.inputMode !== "dispatch" || !["scheduled", "reserved"].includes(ctx.attempt.status)) return fail();
  let request: StructuredModelRequest | WebSearchModelRequest;
  if (phase === "plan") {
    request = buildDiscoveryPlannerRequestV2(state.scope.intent, state.knowledge, undefined, state.ownerInitial ? "owner_initial" : "qualified_public", state.ownerInitial).request;
    request.messages[0].content += " The actual public search question is separately reviewed and fixed. Your queryFocus is advisory and cannot expand it.";
    request.messages[1].content = JSON.stringify({ ...JSON.parse(request.messages[1].content), approvedSearchQuery: state.scope.amendment.approvedQuery });
  }
  else if (phase === "search1") {
    const { query } = planAndCandidates(state);
    request = { model: resolveModelRoute("standard.default").primary, query: query.question, allowedDomains: query.sourceDomains, excludedDomains: state.scope.amendment.excludedDomains };
  } else if (phase === "select1") {
    const found = collection(state);
    request = buildDiscoverySelectionRequestV2({ scope: { intentId: state.scope.intent.id, maximumCollections: 1, maximumMicrousd: state.scope.intent.limits.maximumMicrousd, policyHash: state.scope.intentHash },
      knowledge: state.knowledge, queryId: found.query.queryId, ordinal: 1, request: found.request, collection: found.sourceCollection });
  } else if (phase === "strategy") request = buildStrategistRequestV2(preparedAnalysis(state).prepared);
  else if (phase === "review") { const found = strategist(state);request = buildReviewerRequestV2(found.prepared, found.assessment, found.execution); }
  else return fail();

  // Metadata is private runtime binding, not provider grammar. It preserves the
  // exact before-call accounting snapshot used to interpret the returned output.
  if ("messages" in request) request.requestMetadata = { ...request.requestMetadata, r12CommittedBeforeAttemptMicrousd: state.committedBeforeAttemptMicrousd, r12KnowledgeHash: discoveryKnowledgeHashV2(state.knowledge), ...(state.ownerInitial ? { r12OwnerInitialScopeHash: state.ownerInitial.scopeHash } : {}) };
  return request;
}
export function projectDiscoveryR12Phase(ctx: QuestAdapterContext, input: DiscoveryR12PhaseInputs, qualified: ReturnType<typeof qualifyDiscoveryR12Candidate>, request: StructuredModelRequest | WebSearchModelRequest): Omit<QuestEffectResponse, "settlement"> {
  if ("kind" in input) return projectDiscoveryR12FocusedPilotPhase(ctx, input, qualified, request);
  const state = ownInputs(ctx, input), phase = ctx.step.key as DiscoveryR12Phase, current = qualified.candidate;
  if (state.inputMode !== "receipt" || phase !== current.phase || current.attemptId !== ctx.attempt.id || current.scopeId !== (state.continuation?.envelope.id ?? state.evidenceContinuation?.envelope.id ?? state.scope.amendment.id)) return fail();
  if ("messages" in request) {
    const committed = request.requestMetadata?.r12CommittedBeforeAttemptMicrousd;
    if (typeof committed !== "number" || !Number.isSafeInteger(committed) || committed < 0 || committed > state.committedBeforeAttemptMicrousd || request.requestMetadata?.r12KnowledgeHash !== discoveryKnowledgeHashV2(state.knowledge)) return fail();
    state.committedBeforeAttemptMicrousd = committed;
  }
  let result: JsonObject;
  if (phase === "plan") {
    const plan = reviewedPlan(state, current.output);
    const candidates: CandidateIdentityV2[] = plan.proposals.map(proposal => ({ id: discoveryDeterministicId(`r12:candidate:${state.scope.amendment.id}:${proposal.proposalKey}`), businessId: state.scope.intent.businessId,
      concept: proposal.concept, audience: proposal.audience, productType: "original_pod_tshirt", originalDesign: true, rightsStatus: "unclear" }));
    result = { planHash: discoveryV2Hash(plan), candidates: candidates.map(candidate => json(candidate)) };
  } else if (phase === "search1") {
    const { query } = planAndCandidates(state);
    const sourceCollection = extractResearchSources({ query: query.question, allowedDomains: query.sourceDomains }, { annotations: current.output.annotations as JsonObject[], metadata: {
      executionMode: "r12.discovery.search1", intentId: state.scope.intent.id, queryId: query.queryId, providerRequestId: current.providerRequestId,
      sourceScopeHash: state.scope.amendmentHash, candidateHash: discoveryV2Hash(current), routeProofHash: qualified.route.proofHash,
    } }, current.receivedAt);
    result = { collectionHash: discoveryV2Hash(sourceCollection) };
  } else if (phase === "select1") {
    const found = collection(state), pack = assembleDiscoveryEvidenceV2(found.sourceCollection, found.request, current.output, Date.parse(current.receivedAt));
    result = { evidencePackHash: discoveryV2Hash(pack) };
  } else if (phase === "strategy") {
    const assessment = normalizeStrategistResponseV2(preparedAnalysis(state).prepared, current.output, workerExecution({ candidate: current, proof: qualified.route }), state.validationAt);
    result = { assessmentHash: discoveryV2Hash(assessment), outcome: assessment.recommendation.proposedOutcome };
  } else if (phase === "review") {
    const found = strategist(state), review = normalizeReviewerResponseV2(found.prepared, found.assessment, current.output, { strategist: found.execution, reviewer: workerExecution({ candidate: current, proof: qualified.route }) }, state.validationAt);
    result = { verdict: "pass", reviewHash: discoveryV2Hash(review), outcome: review.outcome, candidateId: review.candidateId, marketCountryCode: review.marketCountryCode };
  } else return fail();
  // Accepted means the phase's contract is valid. TEST/REJECT/NME remains a
  // separate discovery decision; NME/REJECT cannot authorize creative work.
  return { outcome: "accepted", result, checkedArtifacts: phase === "review" ? structuredClone(ctx.attempt.dependencyPins) : [] };
}

/** Pure historical reconstruction from the owner-only completed SQL join.
 * It grants no dispatch/creative authority and never rebuilds a model request. */
function reconstructLegacyDiscoveryR12Result(raw: Record<string, unknown>, businessId: string, scopeId: string) {
  if (raw.version !== "r12.discovery-saved-result.1" || !raw.context || !raw.inputs || !raw.current) return fail();
  const ctx = raw.context as QuestAdapterContext, current = raw.current as DiscoveryR12CompletedPhase;
  if (ctx.plan.businessId !== businessId || ctx.plan.discoveryScopeId !== scopeId || ctx.attempt.status !== "completed" || ctx.step.key !== "review" || current.stepKey !== "review" || current.attemptId !== ctx.attempt.id ||
      current.responseHash !== ctx.attempt.responseHash || current.responseCanonicalHash !== discoveryV2Hash(current.response) || current.response.outcome !== "accepted" || current.response.planHash !== ctx.planHash || current.response.inputHash !== ctx.attempt.inputHash) return fail();
  const state = readDiscoveryR12PhaseInputs(ctx, raw.inputs as Record<string, unknown>), qualified = qualifyDiscoveryR12Candidate(current.candidate, current.binding, current.proof);
  if ("kind" in state) return fail();
  const projected = projectDiscoveryR12Phase(ctx, state, qualified, current.binding.request);
  if (current.response.result.candidateHash !== qualified.candidateHash || current.response.result.routeProofHash !== qualified.route.proofHash || current.response.result.outputHash !== discoveryV2Hash(current.candidate.output) ||
      Object.entries(projected.result).some(([key, value]) => discoveryV2Hash(current.response.result[key]) !== discoveryV2Hash(value))) return fail();
  const found = strategist(state), review = normalizeReviewerResponseV2(found.prepared, found.assessment, current.candidate.output, { strategist: found.execution, reviewer: workerExecution(current) }, state.validationAt);
  if (discoveryV2Hash(review) !== current.response.result.reviewHash) return fail();
  return { version: "r12.discovery-result.1" as const, businessId, scopeId, goalId: ctx.plan.goalId, planId: ctx.planId,
    historyOnly: true as const, executionAuthorized: false as const, reviewedAt: current.candidate.receivedAt, sourceScopeExpiresAt: state.scope.amendment.expiresAt,
    originalFundingRootId: state.scope.budgetAuthorityRootId, sourceScopeHash: state.scope.amendmentHash, knowledgeHash: discoveryKnowledgeHashV2(state.knowledge),
    ...(state.ownerInitial ? isDiscoveryOwnerEpisodeScope(state.scope.amendment) ? { ownerEpisode: { profileId: state.scope.amendment.profile.id, profileHash: state.scope.amendment.profileHash, fundingKind: state.scope.amendment.funding.kind, episodeNumber: state.scope.amendment.episodeNumber, predecessorClosure: state.scope.amendment.predecessorClosure, predecessorClosureHash: state.scope.amendment.predecessorClosureHash } } : { ownerInitial: { profileId: (state.scope.amendment as DiscoveryOwnerInitialScope).profile.id, profileHash: (state.scope.amendment as DiscoveryOwnerInitialScope).profileHash, fundingKind: (state.scope.amendment as DiscoveryOwnerInitialScope).funding.kind } } : {}),
    objective: state.scope.intent.objective, planner: planAndCandidates(state).plan, dossier: found.dossier, evidence: found.persisted, assessment: found.assessment, review,
    ...(state.evidenceContinuation ? { evidenceAddendum: state.evidenceContinuation.envelope.addendum, predecessorScopeId: state.evidenceContinuation.envelope.predecessorScopeId } : {}),
    phaseReceipts: [...state.dependencies, current].map(phase => ({ phase: phase.stepKey, artifactId: phase.artifactId, responseHash: phase.responseHash, candidateHash: discoveryV2Hash(phase.candidate), routeProofHash: phase.proof.proofHash })) };
}
export function reconstructDiscoveryR12Result(raw: Record<string, unknown>, businessId: string, scopeId: string) {
  const context = raw.context as QuestAdapterContext | undefined;
  if (context?.plan?.format !== "r12.discovery-pilot.1") return reconstructLegacyDiscoveryR12Result(raw, businessId, scopeId);
  if (raw.version !== "r12.discovery-saved-result.1" || !raw.inputs || !raw.current) return fail();
  const ctx = context, current = raw.current as DiscoveryR12CompletedPhase;
  if (ctx.plan.businessId !== businessId || ctx.plan.discoveryScopeId !== scopeId || ctx.attempt.status !== "completed" || ctx.step.key !== "review" || current.stepKey !== "review" || current.attemptId !== ctx.attempt.id ||
      current.responseHash !== ctx.attempt.responseHash || current.responseCanonicalHash !== discoveryV2Hash(current.response) || current.response.outcome !== "accepted" || current.response.planHash !== ctx.planHash || current.response.inputHash !== ctx.attempt.inputHash) return fail();
  const state = readDiscoveryR12PhaseInputs(ctx, raw.inputs as Record<string, unknown>), qualified = qualifyDiscoveryR12Candidate(current.candidate, current.binding, current.proof);
  if (!("kind" in state)) return fail();
  const projected = projectDiscoveryR12FocusedPilotPhase(ctx, state, qualified, current.binding.request);
  if (current.response.result.candidateHash !== qualified.candidateHash || current.response.result.routeProofHash !== qualified.route.proofHash || current.response.result.outputHash !== discoveryV2Hash(current.candidate.output) ||
      Object.entries(projected.result).some(([key, value]) => discoveryV2Hash(current.response.result[key]) !== discoveryV2Hash(value))) return fail();
  return reconstructDiscoveryR12FocusedPilotResult(ctx, state, current);
}
export type DiscoveryR12Result = ReturnType<typeof reconstructDiscoveryR12Result>;
