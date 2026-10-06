import type { JsonObject } from "../core/contracts";
import type { QuestAdapterContext, QuestEffectResponse } from "../core/quest-controller";
import { resolveModelRoute } from "../models/registry";
import type { StructuredModelRequest, WebSearchModelRequest } from "../models/types";
import { extractResearchSources, validateResearchCollection } from "../research/sources";
import { type GenerationRouteProof } from "../research/generation-route";
import { DISCOVERY_V2, discoveryV2Hash, type CandidateIdentityV2, type DiscoveryDossierV2, type DiscoveryValidationContextV2, type EvidenceRefV2, type PersistedResearchEvidenceV2, type WorkerExecutionV2 } from "./discovery-v2";
import { buildDiscoveryPlannerRequestV2, discoveryDeterministicId, normalizeDiscoveryPlanV2 } from "./discovery-v2-plan";
import { assembleDiscoveryEvidenceV2, buildDiscoverySelectionRequestV2 } from "./discovery-v2-research";
import { buildReviewerRequestV2, buildStrategistRequestV2, normalizeReviewerResponseV2, normalizeStrategistResponseV2, prepareDiscoveryWorkerContextV2 } from "./discovery-v2-worker-contract";
import { discoveryKnowledgeHashV2, pinDiscoveryKnowledgeV2, validateDiscoveryKnowledgeV2, type DiscoveryKnowledgeContextV2 } from "./discovery-v2-knowledge";
import { qualifyDiscoveryR12Candidate, type DiscoveryR12Candidate, type DiscoveryR12CandidateBinding } from "./discovery-r12-receipt";
import { prepareAmendedDiscoveryScope, type AmendedDiscoveryScope, type DiscoveryOriginalScope, type DiscoverySourceScopeAmendment } from "./discovery-r12-scope";
import { validateDiscoveryReviewContinuation, discoveryReviewExecutionIntent, type DiscoveryReviewContinuation } from "./discovery-r12-review-continuation";
import type { DiscoveryR12Phase } from "./discovery-r12-wire";

/** These rows come from the R12 server's exact completed dependency join. They
 * are neither an owner submission nor fabricated legacy worker.output rows. */
export type DiscoveryR12CompletedPhase = {
  stepKey: DiscoveryR12Phase; attemptId: string; artifactId: string; responseHash: string; responseCanonicalHash: string;
  response: { outcome: "accepted"; result: JsonObject; checkedArtifacts: unknown; planHash: string; inputHash: string };
  binding: DiscoveryR12CandidateBinding; candidate: DiscoveryR12Candidate; proof: GenerationRouteProof;
};
export type DiscoveryR12PhaseInputs = {
  inputMode: "dispatch" | "receipt"; validationAt: number;
  scope: AmendedDiscoveryScope; knowledge: DiscoveryKnowledgeContextV2;
  committedBeforeAttemptMicrousd: number; dependencies: DiscoveryR12CompletedPhase[];
  continuation?: { envelope: DiscoveryReviewContinuation; sourceValidationAt: number; sourceCommittedMicrousd: number };
};
const fail = (): never => { throw new Error("r12_discovery_inputs_unverified"); };
const json = (value: unknown): JsonObject => structuredClone(value) as JsonObject;
const routeReceipt = (proof: GenerationRouteProof) => ({ ...proof, providerResponses: proof.providerResponses.map(p => ({ ...p })) });
function workerExecution(dependency: Pick<DiscoveryR12CompletedPhase, "candidate" | "proof">): WorkerExecutionV2 {
  return { modelId: dependency.candidate.providerModelId, providerRequestId: dependency.candidate.providerRequestId, primaryOnly: true, qualifiedRoute: routeReceipt(dependency.proof) };
}
function ownInputs(ctx: QuestAdapterContext, input: DiscoveryR12PhaseInputs) {
  const state = structuredClone(input), { scope, continuation } = state;
  const executionScope = continuation?.envelope ?? scope.amendment;
  if (ctx.plan.format !== (continuation ? "r12.discovery-review.1" : "r12.discovery.1") || ctx.plan.discoveryScopeId !== executionScope.id || ctx.plan.discoveryScopeHash !== discoveryV2Hash(executionScope) || scope.amendmentHash !== discoveryV2Hash(scope.amendment) || scope.intentHash !== discoveryV2Hash(scope.intent) ||
      scope.intent.businessId !== ctx.plan.businessId || scope.amendment.goalId !== ctx.plan.goalId || scope.intent.id !== scope.amendment.id ||
      !Number.isSafeInteger(state.committedBeforeAttemptMicrousd) || state.committedBeforeAttemptMicrousd < 0 || state.committedBeforeAttemptMicrousd > scope.intent.limits.maximumMicrousd ||
      state.dependencies.length !== ctx.attempt.dependencyPins.length || new Set(state.dependencies.map(d => d.stepKey)).size !== state.dependencies.length) return fail();
  if (!["dispatch", "receipt"].includes(state.inputMode) || !Number.isFinite(state.validationAt) || state.validationAt > Date.now()) return fail();
  validateDiscoveryKnowledgeV2(state.knowledge, state.validationAt);
  if (continuation) {
    validateDiscoveryReviewContinuation(continuation.envelope, scope, state.validationAt);
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
  return state;
}
/** Validate the exact server read before using its saved records as evidence. */
export function readDiscoveryR12PhaseInputs(ctx: QuestAdapterContext, raw: Record<string, unknown>): DiscoveryR12PhaseInputs {
  const isContinuation = ctx.plan.format === "r12.discovery-review.1";
  if (raw.version !== (isContinuation ? "r12.discovery-review-inputs.1" : "r12.discovery-inputs.1") || raw.businessId !== ctx.plan.businessId || raw.planId !== ctx.planId || raw.attemptId !== ctx.attempt.id ||
      raw.knowledgeSnapshotHash !== ctx.step.packSnapshotHash || discoveryV2Hash(raw.knowledgeSnapshot) !== raw.knowledgeCanonicalHash || !Array.isArray(raw.dependencies)) return fail();
  const original = raw.original as DiscoveryOriginalScope, snapshot = raw.knowledgeSnapshot as DiscoveryKnowledgeContextV2["snapshot"];
  const validationAt = Date.parse(String(raw.validationAt)), inputMode = raw.inputMode as DiscoveryR12PhaseInputs["inputMode"];
  if (isContinuation && (typeof raw.sourceCommittedMicrousd !== "number" || !Number.isSafeInteger(raw.sourceCommittedMicrousd))) return fail();
  const continuation = isContinuation ? { envelope: raw.amendment as DiscoveryReviewContinuation, sourceValidationAt: Date.parse(String(raw.sourceValidationAt)), sourceCommittedMicrousd: Number(raw.sourceCommittedMicrousd) } : undefined;
  const sourceOriginal = continuation ? { ...original, committedMicrousd: continuation.sourceCommittedMicrousd } : original;
  const scope = prepareAmendedDiscoveryScope(sourceOriginal, (continuation ? raw.sourceAmendment : raw.amendment) as DiscoverySourceScopeAmendment, continuation?.sourceValidationAt ?? validationAt);
  const knowledge = pinDiscoveryKnowledgeV2({ rootPackId: snapshot.rootPackId, releases: snapshot.releases }, validationAt);
  return ownInputs(ctx, { inputMode, validationAt, scope, knowledge, committedBeforeAttemptMicrousd: original.committedMicrousd, dependencies: raw.dependencies as DiscoveryR12CompletedPhase[], ...(continuation ? { continuation } : {}) });
}
function dependency(state: DiscoveryR12PhaseInputs, key: DiscoveryR12Phase) {
  const dep = state.dependencies.find(dep => dep.stepKey === key);if (!dep) return fail();return dep;
}
const sourceTime = (state: DiscoveryR12PhaseInputs) => state.continuation?.sourceValidationAt ?? state.validationAt;
function reviewedPlan(state: DiscoveryR12PhaseInputs, output: JsonObject) {
  const plan = normalizeDiscoveryPlanV2(state.scope.intent, output, "qualified_public", sourceTime(state));
  // Keep the model's advisory focus in its immutable candidate. The executable
  // search question comes only from the separately reviewed source amendment.
  return { ...plan, queries: [{ ...plan.queries[0], question: state.scope.amendment.approvedQuery }] };
}
function planAndCandidates(state: DiscoveryR12PhaseInputs) {
  const dep = dependency(state, "plan"), plan = reviewedPlan(state, dep.candidate.output);
  const candidates: CandidateIdentityV2[] = plan.proposals.map(proposal => ({ id: discoveryDeterministicId(`r12:candidate:${state.scope.amendment.id}:${proposal.proposalKey}`), businessId: state.scope.intent.businessId,
    concept: proposal.concept, audience: proposal.audience, productType: "original_pod_tshirt", originalDesign: true, rightsStatus: "unclear" }));
  if (dep.response.result.planHash !== discoveryV2Hash(plan) || discoveryV2Hash(dep.response.result.candidates) !== discoveryV2Hash(candidates)) return fail();
  return { plan, candidates, query: plan.queries[0] };
}
function collection(state: DiscoveryR12PhaseInputs) {
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
function preparedAnalysis(state: DiscoveryR12PhaseInputs) {
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
    ownerRightsConfirmedCandidateIds: [], sellerBankCountry: null, committedMicrousd: state.continuation?.sourceCommittedMicrousd ?? state.committedBeforeAttemptMicrousd };
  const references: EvidenceRefV2[] = pack.evidence.map(e => {
    const source = pack.sources.find(source => source.id === e.sourceId);if (!source) return fail();
    const position = source.excerpt.indexOf(e.quote);if (position < 0) return fail();
    const start = Array.from(source.excerpt.slice(0, position)).length;
    return { artifactId: persisted.artifactId, evidenceId: e.id, sourceId: source.id, sourceContentHash: source.contentHash, start, end: start + Array.from(e.quote).length };
  });
  return { prepared: prepareDiscoveryWorkerContextV2(state.scope.intent, dossier, validation, references, sourceTime(state)), dossier, persisted, references, validation, candidates: collected.candidates };
}
function strategist(state: DiscoveryR12PhaseInputs) {
  const dep = dependency(state, "strategy"), analysis = preparedAnalysis(state), execution = workerExecution(dep);
  const assessment = normalizeStrategistResponseV2(analysis.prepared, dep.candidate.output, execution, sourceTime(state));
  if (dep.response.result.assessmentHash !== discoveryV2Hash(assessment)) return fail();
  const prepared = state.continuation ? prepareDiscoveryWorkerContextV2(
    discoveryReviewExecutionIntent(state.scope, state.continuation.envelope, state.validationAt), analysis.dossier,
    { ...analysis.validation, committedMicrousd: state.committedBeforeAttemptMicrousd }, analysis.references, state.validationAt) : analysis.prepared;
  return { ...analysis, prepared, assessment, execution };
}
export function buildDiscoveryR12PhaseRequest(ctx: QuestAdapterContext, input: DiscoveryR12PhaseInputs): StructuredModelRequest | WebSearchModelRequest {
  const state = ownInputs(ctx, input), phase = ctx.step.key as DiscoveryR12Phase;
  if (state.inputMode !== "dispatch" || !["scheduled", "reserved"].includes(ctx.attempt.status)) return fail();
  let request: StructuredModelRequest | WebSearchModelRequest;
  if (phase === "plan") {
    request = buildDiscoveryPlannerRequestV2(state.scope.intent, state.knowledge, undefined, "qualified_public").request;
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
  if ("messages" in request) request.requestMetadata = { ...request.requestMetadata, r12CommittedBeforeAttemptMicrousd: state.committedBeforeAttemptMicrousd, r12KnowledgeHash: discoveryKnowledgeHashV2(state.knowledge) };
  return request;
}
export function projectDiscoveryR12Phase(ctx: QuestAdapterContext, input: DiscoveryR12PhaseInputs, qualified: ReturnType<typeof qualifyDiscoveryR12Candidate>, request: StructuredModelRequest | WebSearchModelRequest): Omit<QuestEffectResponse, "settlement"> {
  const state = ownInputs(ctx, input), phase = ctx.step.key as DiscoveryR12Phase, current = qualified.candidate;
  if (state.inputMode !== "receipt" || phase !== current.phase || current.attemptId !== ctx.attempt.id || current.scopeId !== (state.continuation?.envelope.id ?? state.scope.amendment.id)) return fail();
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
export function reconstructDiscoveryR12Result(raw: Record<string, unknown>, businessId: string, scopeId: string) {
  if (raw.version !== "r12.discovery-saved-result.1" || !raw.context || !raw.inputs || !raw.current) return fail();
  const ctx = raw.context as QuestAdapterContext, current = raw.current as DiscoveryR12CompletedPhase;
  if (ctx.plan.businessId !== businessId || ctx.plan.discoveryScopeId !== scopeId || ctx.attempt.status !== "completed" || ctx.step.key !== "review" || current.stepKey !== "review" || current.attemptId !== ctx.attempt.id ||
      current.responseHash !== ctx.attempt.responseHash || current.responseCanonicalHash !== discoveryV2Hash(current.response) || current.response.outcome !== "accepted" || current.response.planHash !== ctx.planHash || current.response.inputHash !== ctx.attempt.inputHash) return fail();
  const state = readDiscoveryR12PhaseInputs(ctx, raw.inputs as Record<string, unknown>), qualified = qualifyDiscoveryR12Candidate(current.candidate, current.binding, current.proof);
  const projected = projectDiscoveryR12Phase(ctx, state, qualified, current.binding.request);
  if (current.response.result.candidateHash !== qualified.candidateHash || current.response.result.routeProofHash !== qualified.route.proofHash || current.response.result.outputHash !== discoveryV2Hash(current.candidate.output) ||
      Object.entries(projected.result).some(([key, value]) => discoveryV2Hash(current.response.result[key]) !== discoveryV2Hash(value))) return fail();
  const found = strategist(state), review = normalizeReviewerResponseV2(found.prepared, found.assessment, current.candidate.output, { strategist: found.execution, reviewer: workerExecution(current) }, state.validationAt);
  if (discoveryV2Hash(review) !== current.response.result.reviewHash) return fail();
  return { version: "r12.discovery-result.1" as const, businessId, scopeId, goalId: ctx.plan.goalId, planId: ctx.planId,
    historyOnly: true as const, executionAuthorized: false as const, reviewedAt: current.candidate.receivedAt, sourceScopeExpiresAt: state.scope.amendment.expiresAt,
    originalFundingRootId: state.scope.budgetAuthorityRootId, sourceScopeHash: state.scope.amendmentHash, knowledgeHash: discoveryKnowledgeHashV2(state.knowledge),
    objective: state.scope.intent.objective, planner: planAndCandidates(state).plan, dossier: found.dossier, evidence: found.persisted, assessment: found.assessment, review,
    phaseReceipts: [...state.dependencies, current].map(phase => ({ phase: phase.stepKey, artifactId: phase.artifactId, responseHash: phase.responseHash, candidateHash: discoveryV2Hash(phase.candidate), routeProofHash: phase.proof.proofHash })) };
}
export type DiscoveryR12Result = ReturnType<typeof reconstructDiscoveryR12Result>;
