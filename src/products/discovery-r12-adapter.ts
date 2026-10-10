import type { AdaptiveFundingProof } from './discovery-r12-adaptive-funding-proof';
import { createHash } from "node:crypto";
import type { QuestAdapter, QuestAdapterContext, QuestEffectResponse, QuestPreparedCall, QuestSettlement } from "../core/quest-controller";
import { OpenRouterAdapter, type OpenRouterConfig } from "../models/openrouter";
import { ModelProviderError, type ModelProviderResponse, type StructuredModelRequest, type WebSearchModelRequest } from "../models/types";
import { fetchGenerationRouteProofOnce, GenerationRouteProofError, type GenerationRouteProof } from "../research/generation-route";
import { discoveryV2Hash } from "./discovery-v2";
import { createDiscoveryR12Candidate, discoveryR12ReceiptExpectation, qualifyDiscoveryR12Candidate, validateDiscoveryR12Candidate, type DiscoveryR12CandidateBinding } from "./discovery-r12-receipt";
import { inspectDiscoveryR12Wire, routeDiscoveryR12Request, type DiscoveryR12Phase } from "./discovery-r12-wire";
import { discoveryR12PhaseCeiling, type DiscoveryR12ExecutionQuote } from "./discovery-r12-quote";
import { isDiscoveryReviewContinuation, type DiscoveryR12ExecutionScope } from "./discovery-r12-review-continuation";
import { isDiscoveryOwnerInitialScope } from "./discovery-r12-goal-scope";
import { isDiscoveryOwnerEpisodeScope, validateOwnerEpisodePlan } from "./discovery-r12-owner-episode";
import { isDiscoveryFocusedPilot } from "./discovery-r12-focused-pilot-scope";
import { isDiscoveryEvidenceContinuation } from "./discovery-r12-evidence-continuation";
import { observeR12ReviewResponse, r12ReviewDiagnostic, type R12ReviewObservation, type R12ReviewDiagnosticCode } from "./discovery-r12-observation";
import { validateAdaptiveExecutionScope } from "./discovery-r12-adaptive-execution-scope";
import { validateAdaptiveResearchPlan, type AdaptiveResearchPreview } from "./discovery-r12-adaptive-scope";
import { adaptiveResearchPhaseLimits, type AdaptiveResearchQuote } from "./discovery-r12-adaptive-quote";
import type { AdaptivePhase } from "./discovery-r12-adaptive-policy";
import { inspectAdaptiveResearchWire, routeAdaptiveResearchRequest } from "./discovery-r12-adaptive-wire";

type Request = StructuredModelRequest | WebSearchModelRequest;
type WireBinding = { version: "r12.discovery-wire.1" | "r12.adaptive-wire.1" | "r12.adaptive-wire.2"; scopeId: string; scopeHash: string; attemptId: string; requestId: string; phase: DiscoveryR12Phase;
  actionHash?: string; actionOrdinal?: number;
  requestJson: string; requestHash: string; wireBody: string; wireHash: string; quote: DiscoveryR12ExecutionQuote | AdaptiveResearchQuote; dependencyPins: QuestAdapterContext["attempt"]["dependencyPins"] };
export type DiscoveryR12EffectStore = {
  operation(attemptId: string, operation: "inputs" | "load" | "bind" | "send" | "observe" | "diagnose" | "stage" | "claim" | "record", payload: Record<string, unknown>): Promise<Record<string, unknown>>;
  settle(attemptId: string, settlement: QuestSettlement): Promise<void>;
  /** Reads the committed R07/R05 marker timestamp, not the process clock. */
  dispatchedAt(attemptId: string): Promise<string>;
};
export class DiscoveryR12ReceiptPending extends Error {
  constructor(readonly receipt: Readonly<Record<string, unknown>>) { super("r12_discovery_receipt_pending"); }
}
const isAdaptiveQuote=(quote:DiscoveryR12ExecutionQuote|AdaptiveResearchQuote|undefined):quote is AdaptiveResearchQuote=>quote?.version==="r12.adaptive-quote.1"||quote?.version==="r12.adaptive-quote.2";
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const fail = (guard: "binding" | "adaptive_preview" | "adaptive_action" | "context" | "quote_kind" | "stored_binding" | "stored_wire" | "quote_freshness" | "dispatch_binding" = "binding"): never => {
  throw new Error("r12_discovery_adapter_binding_invalid", { cause: guard });
};
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

/** Scoped implementation only. The caller supplies Core-built requests/domain
 * validation, never a browser/worker-supplied wire or registry entry. SQL still
 * requires exact adapter enrollment, R05 authority, source review and lineage. */
export function createDiscoveryR12QuestAdapter(options: {
  scope: DiscoveryR12ExecutionScope; phase: DiscoveryR12Phase;
  identity: Pick<QuestAdapter, "qualificationHash" | "workflowDefinitionId" | "workerDefinitionId" | "mode">;
  dataClasses: string[]; store: DiscoveryR12EffectStore;
  request(context: QuestAdapterContext): Promise<Request>;
  quote(): Promise<DiscoveryR12ExecutionQuote | AdaptiveResearchQuote>;
  adaptivePreview?: AdaptiveResearchPreview;
  adaptiveFundingProof?: AdaptiveFundingProof|null;
  project(qualified: ReturnType<typeof qualifyDiscoveryR12Candidate>, context: QuestAdapterContext, request: Request): Promise<Omit<QuestEffectResponse, "settlement">>;
  /** Inert transport/config overrides are also used by the actual SQL fixture. */
  config?: OpenRouterConfig; fetcher?: typeof fetch; now?: () => number;
}): QuestAdapter {
  const scope = structuredClone(options.scope), identity = structuredClone(options.identity), phase = options.phase;
  const scopeHash = discoveryV2Hash(scope), now = options.now ?? Date.now;
  const etsy=scope.version === "r12.discovery-owner-adaptive.2";
  const adaptive = scope.version === "r12.discovery-owner-adaptive.1" || etsy;
  const expectedQuoteVersion=etsy?"r12.adaptive-quote.2":"r12.adaptive-quote.1";
  const adaptivePhase: AdaptivePhase = phase === "search1" ? "search" : phase === "select1" ? "select" : phase;
  function context(ctx: QuestAdapterContext) {
    if (scope.version === "r12.discovery-owner-adaptive.1" || scope.version === "r12.discovery-owner-adaptive.2") {
      if(etsy && !["plan","strategy","review"].includes(phase))return fail("context");
      if (!options.adaptivePreview) return fail("adaptive_preview");
      validateAdaptiveExecutionScope(scope,options.adaptivePreview,Date.parse(scope.createdAt),options.adaptiveFundingProof??null);
      validateAdaptiveResearchPlan(ctx.plan,options.adaptivePreview,{id:scope.id,hash:scopeHash},Date.parse(scope.createdAt));
      if (!/^[a-f0-9]{64}$/.test(ctx.attempt.adaptiveActionHash ?? "") || !Number.isSafeInteger(ctx.attempt.adaptiveActionOrdinal)) return fail("adaptive_action");
    }
    if (isDiscoveryOwnerEpisodeScope(scope)) validateOwnerEpisodePlan(ctx.plan, scope);
    if (ctx.plan.format !== (adaptive ? (etsy?"r12.discovery-adaptive.2":"r12.discovery-adaptive.1") : isDiscoveryOwnerEpisodeScope(scope) ? "r12.discovery-episode.1" : isDiscoveryFocusedPilot(scope) ? "r12.discovery-pilot.1" : isDiscoveryReviewContinuation(scope) ? "r12.discovery-review.1" : isDiscoveryEvidenceContinuation(scope) ? "r12.discovery-evidence.1" : "r12.discovery.1") || (isDiscoveryReviewContinuation(scope) && phase !== "review") || ((isDiscoveryEvidenceContinuation(scope) || isDiscoveryFocusedPilot(scope)) && !["strategy", "review"].includes(phase)) || ctx.plan.discoveryScopeId !== scope.id || ctx.plan.discoveryScopeHash !== scopeHash || ctx.plan.businessId !== scope.businessId || ctx.plan.goalId !== scope.goalId || ctx.step.key !== phase ||
      ctx.step.adapter !== `r12.discovery.${scope.id}.${phase}` || ctx.step.operationKey !== `research.r12.${scope.id}.${phase}` || ctx.step.qualificationHash !== identity.qualificationHash || ctx.step.workflowDefinitionId !== identity.workflowDefinitionId || ctx.step.workerDefinitionId !== identity.workerDefinitionId) return fail("context");
  }
  function descriptor(ctx: QuestAdapterContext, request: Request, body: string, quote?: DiscoveryR12ExecutionQuote | AdaptiveResearchQuote): QuestPreparedCall {
    if (adaptive && quote?.version !== expectedQuoteVersion) return fail("quote_kind");
    return { wire: { url: "https://openrouter.ai/api/v1/chat/completions", method: "POST", body }, descriptor: {
      workflowRunId: ctx.attempt.id, operationKey: ctx.step.operationKey, requestHash: discoveryV2Hash(request), idempotencyKey: `r07:${ctx.attempt.id}`,
      providerModelId: request.model.providerModelId, wireRequestHash: hash(body), wireRequestBytes: Buffer.byteLength(body), maximumOutputTokens: JSON.parse(body).max_tokens,
      accounting: { kind: "r05" }, sourceDomains: [...(isDiscoveryEvidenceContinuation(scope) ? scope.executionSourceDomains : scope.allowedDomains)], dataClasses: [...options.dataClasses], accountId: null, accountRevision: null, currency: "USD", liabilityMicrounits: isAdaptiveQuote(quote) ? String(adaptiveResearchPhaseLimits(quote,adaptivePhase).maximumMicrousd) : ctx.step.maximumMicrounits,
    } };
  }
  async function load(ctx: QuestAdapterContext): Promise<{ binding: WireBinding | null; candidate?: unknown; proof?: unknown; receipt?: unknown; diagnostic?: unknown; observationSaved?: boolean }> {
    context(ctx);const saved = await options.store.operation(ctx.attempt.id, "load", {});
    if (!record(saved.binding)) return { ...saved, binding: null };
    const binding = saved.binding as WireBinding;
    if ((isAdaptiveQuote(binding.quote)) !== adaptive || adaptive && binding.quote.version!==expectedQuoteVersion || binding.version !== (adaptive ? (etsy?"r12.adaptive-wire.2":"r12.adaptive-wire.1") : "r12.discovery-wire.1") || adaptive && (binding.actionHash !== ctx.attempt.adaptiveActionHash || binding.actionOrdinal !== ctx.attempt.adaptiveActionOrdinal) || binding.scopeId !== scope.id || binding.scopeHash !== scopeHash || binding.attemptId !== ctx.attempt.id || binding.requestId !== ctx.attempt.requestId || binding.phase !== phase ||
      binding.requestHash !== discoveryV2Hash(JSON.parse(binding.requestJson)) || binding.wireHash !== hash(binding.wireBody) || binding.wireHash !== ctx.attempt.wireHash || discoveryV2Hash(binding.dependencyPins) !== discoveryV2Hash(ctx.attempt.dependencyPins)) return fail("stored_binding");
    const inspected = adaptive && isAdaptiveQuote(binding.quote) ?
      await inspectAdaptiveResearchWire(JSON.parse(binding.requestJson) as Request,adaptivePhase,binding.quote,Date.parse(binding.quote.verifiedAt)) :
      await inspectDiscoveryR12Wire(JSON.parse(binding.requestJson) as Request, phase, isDiscoveryEvidenceContinuation(scope), isDiscoveryFocusedPilot(scope), isDiscoveryOwnerInitialScope(scope) || isDiscoveryOwnerEpisodeScope(scope));
    if (inspected.wire.body !== binding.wireBody) return fail("stored_wire");
    return { ...saved, binding };
  }
  async function candidateBinding(ctx: QuestAdapterContext, binding: WireBinding): Promise<DiscoveryR12CandidateBinding> {
    const dispatchedAt = await options.store.dispatchedAt(ctx.attempt.id);
    return { scopeId: scope.id, attemptId: ctx.attempt.id, requestId: binding.requestId, phase, request: JSON.parse(binding.requestJson) as Request, maximumMicrousd: isAdaptiveQuote(binding.quote) ? adaptiveResearchPhaseLimits(binding.quote,adaptivePhase).maximumMicrousd : Number(ctx.step.maximumMicrounits), dispatchedAt,
      receiptExpiresAt: new Date(Math.min(Date.parse(ctx.plan.expiresAt) + 30 * 60_000, Date.parse(dispatchedAt) + 60 * 60_000)).toISOString() };
  }
  async function reconcile(ctx: QuestAdapterContext): Promise<QuestEffectResponse | null> {
    const saved = await load(ctx);if (!saved.binding || saved.diagnostic || !saved.candidate || !record(saved.receipt) || ["stopped", "expired", "terminal", "exhausted"].includes(String(saved.receipt.status))) return null;
    const bound = await candidateBinding(ctx, saved.binding), candidate = validateDiscoveryR12Candidate(saved.candidate, bound), candidateHash = discoveryV2Hash(candidate);
    let proof: unknown = saved.proof;
    if (!proof) {
      const claim = await options.store.operation(ctx.attempt.id, "claim", { candidateHash });
      if (claim.claimed !== true || typeof claim.claimId !== "string") return null;
      try {
        proof = await fetchGenerationRouteProofOnce({ ...discoveryR12ReceiptExpectation(candidate), config: options.config, fetcher: options.fetcher, now });
      } catch (error) {
        if (!(error instanceof GenerationRouteProofError)) throw error;
        await options.store.operation(ctx.attempt.id, "record", { candidateHash, claimId: claim.claimId, proof: null, diagnostic: { code: error.code, httpStatus: error.httpStatus }, retryAfterAt: error.retryAfterAt });
        return null;
      }
      await options.store.operation(ctx.attempt.id, "record", { candidateHash, claimId: claim.claimId, proof, diagnostic: null, retryAfterAt: null });
    }
    const qualified = qualifyDiscoveryR12Candidate(candidate, bound, proof as GenerationRouteProof);
    let projected;
    try { projected = await options.project(qualified, ctx, JSON.parse(saved.binding.requestJson) as Request); }
    catch (error) { await diagnose(ctx, saved.binding, error, "domain_validation", saved.observationSaved === true); throw error; }
    return { ...projected, result: { ...projected.result, outputHash: discoveryV2Hash(qualified.candidate.output), candidateHash, routeProofHash: qualified.route.proofHash },
      settlement: { actualMicrounits: String(candidate.reportedMicrousd), providerRequestId: candidate.providerRequestId, receiptHash: candidateHash } };
  }
  async function settle(ctx: QuestAdapterContext, response: ModelProviderResponse | null, error?: unknown) {
    const failed = error instanceof ModelProviderError && record(error.details.providerReceipt) ? error.details.providerReceipt : null;
    const receipt = response ?? failed, usage = receipt && record(receipt.usage) ? receipt.usage : null;
    const amount = usage?.reportedCostUsd, id = receipt?.providerRequestId;
    // Unknown identity cannot be invented for R05; its marked liability stays held.
    if (typeof id !== "string" || !/^gen-[A-Za-z0-9_-]{1,296}$/.test(id)) return;
    const actualMicrounits = typeof amount === "number" && Number.isFinite(amount) && amount >= 0 ? String(Math.ceil(amount * 1e6)) : null;
    await options.store.settle(ctx.attempt.id, { actualMicrounits, providerRequestId: id, receiptHash: discoveryV2Hash({ phase, providerRequestId: id, actualMicrounits }) });
  }
  function retainsResponse(binding: WireBinding): boolean {
    if (adaptive) return true;
    if (phase === "review") return true;
    if (phase !== "strategy" || !isDiscoveryFocusedPilot(scope)) return false;
    // The request came from the validated SQL/runtime join. SQL independently
    // requires its exact successor sidecar hash before permitting observation.
    const request = JSON.parse(binding.requestJson) as StructuredModelRequest;
    return typeof request.requestMetadata?.r12FocusedSuccessorAuthorizationHash === "string" && /^[a-f0-9]{64}$/.test(request.requestMetadata.r12FocusedSuccessorAuthorizationHash);
  }
  async function diagnose(ctx: QuestAdapterContext, binding: WireBinding, error: unknown, fallback: R12ReviewDiagnosticCode, observationSaved: boolean) {
    if (!retainsResponse(binding)) return;
    const request = JSON.parse(binding.requestJson) as Request;
    const diagnostic = r12ReviewDiagnostic(error, fallback, { scopeId: scope.id, attemptId: ctx.attempt.id, requestId: binding.requestId }, "messages" in request ? request.outputSchema : {type:"object"}, observationSaved, new Date(now()).toISOString());
    try { await options.store.operation(ctx.attempt.id, "diagnose", { diagnostic, diagnosticHash: discoveryV2Hash(diagnostic) }); }
    catch { console.warn("r12_review_diagnostic_unavailable", { attemptId: ctx.attempt.id, code: diagnostic.code, observationSaved }); }
  }
  async function settleAfterFailure(ctx: QuestAdapterContext, response: ModelProviderResponse | null, error: unknown) {
    // Observation/storage/readback failures cannot suppress an already observed
    // provider charge. A settlement failure keeps the existing held liability.
    try { await settle(ctx, response, error); }
    catch { console.warn("r12_response_settlement_unavailable", { attemptId: ctx.attempt.id }); }
  }
  return { ...identity,
    async prepare(ctx) {
      context(ctx);
      if (ctx.attempt.requestId) { const saved = await load(ctx);if (saved.binding) return descriptor(ctx, JSON.parse(saved.binding.requestJson) as Request, saved.binding.wireBody,saved.binding.quote); }
      const quote = await options.quote();
      if ((isAdaptiveQuote(quote)) !== adaptive || adaptive && quote.version!==expectedQuoteVersion || Date.parse(quote.validUntil) <= now()) return fail("quote_freshness");
      if (!isAdaptiveQuote(quote) && ((quote.version === "r12.discovery-pilot-quote.1") !== isDiscoveryFocusedPilot(scope) || (quote.version === "r12.discovery-evidence-quote.1") !== isDiscoveryEvidenceContinuation(scope) || discoveryR12PhaseCeiling(quote, phase) > Number(ctx.step.maximumMicrounits))) return fail();
      const route = phase === "review" ? quote.reviewer : quote.luna;
      const ownerSchema = isDiscoveryOwnerInitialScope(scope) || isDiscoveryOwnerEpisodeScope(scope);
      const raw = await options.request(ctx);
      const request = isAdaptiveQuote(quote) ? routeAdaptiveResearchRequest(raw,adaptivePhase,quote,now()) : routeDiscoveryR12Request(raw, phase, route, isDiscoveryFocusedPilot(scope), ownerSchema);
      const wire = isAdaptiveQuote(quote) ? await inspectAdaptiveResearchWire(request,adaptivePhase,quote,now()) : await inspectDiscoveryR12Wire(request, phase, isDiscoveryEvidenceContinuation(scope), isDiscoveryFocusedPilot(scope), ownerSchema);
      const call = descriptor(ctx, request, wire.wire.body,quote);
      if (ctx.attempt.requestId) {
        const binding: WireBinding = { version: adaptive ? (etsy?"r12.adaptive-wire.2":"r12.adaptive-wire.1") : "r12.discovery-wire.1", scopeId: scope.id, scopeHash, attemptId: ctx.attempt.id, requestId: ctx.attempt.requestId, phase,
          ...(adaptive ? {actionHash:ctx.attempt.adaptiveActionHash,actionOrdinal:ctx.attempt.adaptiveActionOrdinal} : {}),
          requestJson: JSON.stringify(request), requestHash: wire.requestHash, wireBody: wire.wire.body, wireHash: wire.wireHash, quote, dependencyPins: structuredClone(ctx.attempt.dependencyPins) };
        await options.store.operation(ctx.attempt.id, "bind", { binding, bindingHash: discoveryV2Hash(binding) });
      }
      return call;
    },
    async dispatch(call, ctx) {
      const saved = await load(ctx);if (!saved.binding || call.wire.body !== saved.binding.wireBody) return fail("dispatch_binding");
      const identity = { scopeId: scope.id, attemptId: ctx.attempt.id, requestId: saved.binding.requestId };
      let observation: R12ReviewObservation | null = null, observationSaved = false;
      const saveObservation = async () => {
        if (!retainsResponse(saved.binding!) || !observation) return;
        await options.store.operation(ctx.attempt.id, "observe", { observation, observationHash: discoveryV2Hash(observation) });
        observationSaved = true;
      };
      const adapter = new OpenRouterAdapter({ config: options.config, fetcher: options.fetcher,
        ...(retainsResponse(saved.binding) ? { observeResponse: (body: unknown) => {
          observation ??= observeR12ReviewResponse(body, identity, new Date(now()).toISOString());
          // Raw text stays in this private closure, never in provider error
          // metadata, general logs, or a qualified response candidate.
          return { version: "r12.review-observation.1", contentState: observation.contentState, contentBytes: observation.contentBytes };
        } } : {}), admitDispatch: async wire => {
        if (wire.url !== call.wire.url || wire.method !== call.wire.method || wire.body !== call.wire.body) return fail();
        const result = await options.store.operation(ctx.attempt.id, "send", { wireHash: saved.binding!.wireHash });
        if (result.shouldDispatch !== true) return fail();
      } });
      let response: ModelProviderResponse;
      try { response = phase === "search1" ? await adapter.invokeWebSearch(JSON.parse(saved.binding.requestJson) as WebSearchModelRequest) : await adapter.invokeStructured(JSON.parse(saved.binding.requestJson) as StructuredModelRequest); }
      catch (error) {
        try { await saveObservation(); } catch { /* The original error remains primary. */ }
        await settleAfterFailure(ctx, null, error);
        await diagnose(ctx, saved.binding, error, "transport", observationSaved);
        throw error;
      }
      // Save unqualified review content before local checks can discard it.
      // None of these observations authorizes a receipt or another generation.
      let boundary: R12ReviewDiagnosticCode = "observation_storage";
      try {
        await saveObservation();
        boundary = "candidate_binding";
        const bound = await candidateBinding(ctx, saved.binding);
        boundary = "response_schema";
        const candidate = createDiscoveryR12Candidate(bound, response, new Date(now()).toISOString());
        boundary = "candidate_storage";
        await options.store.operation(ctx.attempt.id, "stage", { candidate, candidateHash: discoveryV2Hash(candidate) });
      } catch (error) {
        await settleAfterFailure(ctx, response, error);
        await diagnose(ctx, saved.binding, error, boundary, observationSaved);
        throw error;
      }
      await settle(ctx, response);
      const result = await reconcile(ctx);if (result) return result;
      const pending = await options.store.operation(ctx.attempt.id, "load", {});
      throw new DiscoveryR12ReceiptPending(record(pending.receipt) ? pending.receipt : {});
    },
    async reconcile(ctx) { const response = await reconcile(ctx);return response ? { status: "found", response } : { status: "unknown" }; },
  };
}
