import { createHash } from "node:crypto";
import type { JsonObject } from "../core/contracts";
import { createRuntimeClient } from "../lib/supabase/runtime";
import { OpenRouterAdapter } from "../models/openrouter";
import { resolveModelRoute } from "../models/registry";
import { ModelProviderError, type ModelDefinition, type ModelDispatchAdmission, type ModelProviderResponse, type StructuredModelRequest, type WebSearchModelRequest } from "../models/types";
import { assembleAdmittedPublicEvidence, canonicalPublicResearchJson, collectQualifiedPublicSources, publicResearchHash, publicResearchSearchRequest, publicResearchSelectorRequest, validatePublicResearchLineage, validatePublicResearchPolicy, type PublicResearchLineage, type PublicResearchPolicy } from "./qualification";
import type { EvidencePack, ResearchCollection } from "./types";
import { fetchPublicResearchQuote, validatePublicResearchQuote } from "./qualification-quote";
import { readResearchRouteFailureDetails, type ResearchFailureReason, type ResearchObservation } from "./qualification-owner-contract";
import { fetchGenerationRouteProof, GenerationRouteProofError, validateGenerationRouteProof, type GenerationRouteExpectation, type GenerationRouteProof, fetchGenerationRouteProofOnce, isTransientGenerationRouteFailure } from "./generation-route";
import { observePublicResearchResponse, PublicResearchQualificationError, PublicResearchQualificationUnacquiredError, validateResearchObservation, validateResearchResponseModelIds } from "./qualification-outcome";

import { normalizeReceiptSearchOutput, pendingReceiptResult, receiptCandidateResponse, receiptExpectation, RECEIPT_RESPONSE_MODELS, validateReceiptCandidate, validateReceiptCheck, validateSavedReceiptCandidates,
  type PublicResearchPendingResult, type ReceiptCandidate, type ReceiptCheck, type SavedReceiptCandidate } from "./qualification-pending";

type Phase = "search" | "select";
export type ResearchRuntimeScope = { businessId: string; coreWorkflowRunId: string; runtimeCapability: string;
  /** Trusted per-attempt server credential. Never a model, UI or fixture input. */
  admissionKey?: string };
type Scope = ResearchRuntimeScope;
type Wire = { requestHash: string; wireHash: string; wireBytes: number; maxTokens: number };
type SavedCollection = { id: string; collection: ResearchCollection; collectionHash: string; lineage: PublicResearchLineage; lineageHash: string; selector: Wire };
type Loaded = { policy: PublicResearchPolicy; policyHash: string; search: Wire; collection: SavedCollection | null;
  attemptVersion: 1 | 2; operationKeys: { search: string; select: string }; receiptCandidates?: SavedReceiptCandidate[] };
type Rpc = (operation: "load" | "guard" | "collect" | "complete" | "fail" | "stage_receipt" | "claim_receipt" | "record_receipt", payload: JsonObject) => Promise<unknown>;
type Settle = (requestId: string, receipt: JsonObject) => Promise<void>;
type Provider = Pick<OpenRouterAdapter, "invokeWebSearch" | "invokeStructured">;
export type PublicResearchRuntime = {
  rpc: Rpc; settle: Settle; provider: (admit: ModelDispatchAdmission, observeResponse?: (body: unknown, providerError?: string) => JsonObject) => Provider;
  /** Must freshly verify exact catalog/ZDR endpoint, full tier quote and hash. */
  verifyQuote: (policy: PublicResearchPolicy) => Promise<{ providerName: string; acceptedResponseModelIds?: readonly string[]; quoteValidUntil?: string }>;
  /** Bounded non-generating lookups of this positively admitted generation. */
  verifyGenerationRoute: (expected: GenerationRouteExpectation) => Promise<GenerationRouteProof>;
  /** Exactly one non-generating GET, after a committed durable claim. */
  verifyGenerationRouteOnce?: (expected: GenerationRouteExpectation) => Promise<GenerationRouteProof>;
  /** Production cannot silently downgrade to the historical injected path. */
  requireDurableReceipts?: boolean;
  now?: () => number; model?: ModelDefinition;
};
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const denied = (): never => { throw new Error("public_research_qualification_stopped"); };

/** Extract the actual adapter serialization with a deliberately denied inert
 * admission. No credential is resolved and no transport may run. This avoids
 * maintaining a second serializer that could drift from the reviewed wire. */
export async function inspectPublicResearchWire(request: WebSearchModelRequest | StructuredModelRequest, phase: Phase): Promise<Wire> {
  const owned = structuredClone(request); let captured: Wire | null = null;
  const adapter = new OpenRouterAdapter({ config: { apiKey: "inert-wire-inspection", baseUrl: "https://openrouter.ai/api/v1", appUrl: "https://agent-labs-two.vercel.app", appName: "Agent Labs" },
    admitDispatch: async wire => {
      const body = JSON.parse(wire.body) as { max_tokens?: unknown };
      if (!Number.isSafeInteger(body.max_tokens) || Number(body.max_tokens) !== (phase === "search" ? 4000 : 1000) || Buffer.byteLength(wire.body, "utf8") > (phase === "search" ? 8192 : 16384)) return denied();
      captured = { requestHash: publicResearchHash(owned), wireHash: digest(wire.body), wireBytes: Buffer.byteLength(wire.body, "utf8"), maxTokens: Number(body.max_tokens) };
      throw new Error("inert_wire_inspection_only");
    }, fetcher: async () => { throw new Error("wire_inspection_must_never_dispatch"); } });
  try {
    if (phase === "search") await adapter.invokeWebSearch(owned as WebSearchModelRequest);
    else await adapter.invokeStructured(owned as StructuredModelRequest);
  } catch { /* The intentional admission refusal is the only successful path. */ }
  if (!captured) return denied();
  return captured;
}

function wireEquals(a: Wire, b: Wire) {
  return !!a && !!b && HASH.test(a.requestHash) && HASH.test(a.wireHash) && a.requestHash === b.requestHash && a.wireHash === b.wireHash && a.wireBytes === b.wireBytes && a.maxTokens === b.maxTokens;
}

const costMicrousd = (reported: unknown): number | null => typeof reported === "number" && Number.isFinite(reported) && reported >= 0 && Number.isSafeInteger(Math.ceil(reported * 1e6)) ? Math.ceil(reported * 1e6) : null;
const providerRequestId = (value: unknown): value is string => typeof value === "string" && value.length >= 1 && value.length <= 300;
function safeReceipt(response: ModelProviderResponse, observation: ResearchObservation, phase: Phase): JsonObject {
  return { provider: phase === "search" ? "openrouter.exa" : "openrouter",
    providerModelId: observation.observedModelId, providerRequestId: providerRequestId(response.providerRequestId) ? response.providerRequestId : null,
    responseProviderIdentity: observation.providerIdentity, observedResponseProvider: observation.observedProvider,
    responseProviderHash: observation.responseProviderHash ?? null, reportedMicrousd: costMicrousd(response.usage?.reportedCostUsd) };
}

/** No fallback or paid retry exists. A separately committed fail RPC makes the
 * exact bounded gate visible without rolling back its accounting or outcome. */
export type PublicResearchQualificationResult = { status: "completed"; evidencePack: EvidencePack; evidencePackHash: string; resultId: string; policyId: string; collectionId: string; receipts: JsonObject[] } | PublicResearchPendingResult;
class ReceiptPending extends Error {
  constructor(readonly result: PublicResearchPendingResult) { super("public_research_receipt_pending"); }
}
export async function runPublicResearchQualification(scope: Scope, policyId: string, runtime: PublicResearchRuntime): Promise<PublicResearchQualificationResult> {
  const ownedScope = structuredClone(scope), now = runtime.now ?? Date.now;
  const failure: { reason: ResearchFailureReason; phase: "none" | Phase; requestId: string | null; observation: ResearchObservation | null } = {
    reason: "internal_failure", phase: "none", requestId: null, observation: null,
  };
  let journalEligible = false;
  try {
    if (!UUID.test(policyId) || !UUID.test(ownedScope.businessId) || !UUID.test(ownedScope.coreWorkflowRunId) || !ownedScope.runtimeCapability) return denied();
    const loadedValue = await runtime.rpc("load", { policyId });
    if (!record(loadedValue) || !record(loadedValue.policy) || typeof loadedValue.policyHash !== "string" || !record(loadedValue.search) || !(loadedValue.collection === null || record(loadedValue.collection))) return denied();
    const loaded = structuredClone(loadedValue) as unknown as Loaded, policy = loaded.policy;
    if (policy.id !== policyId || policy.businessId !== ownedScope.businessId || policy.workflowRunId !== ownedScope.coreWorkflowRunId || publicResearchHash(policy) !== loaded.policyHash) return denied();
    journalEligible = true;
    const durable = Object.hasOwn(loaded, "receiptCandidates");
    if ((runtime.requireDurableReceipts && !durable) || (durable && typeof runtime.verifyGenerationRouteOnce !== "function")) return denied();
    const candidates = durable ? validateSavedReceiptCandidates(loaded.receiptCandidates, policy, loaded.collection, now()) : [];
    // A saved paid response may finish within the original receipt grace. This
    // historical policy check grants no new dispatch; guard remains current.
    validatePublicResearchPolicy(policy, candidates.length ? Date.parse(policy.validFrom) : now());
    if (![1, 2].includes(loaded.attemptVersion) || !record(loaded.operationKeys) || Object.keys(loaded.operationKeys).sort().join(",") !== "search,select" ||
        loaded.operationKeys.search !== (loaded.attemptVersion === 2 ? `research.search.r11v2.${policy.id}` : "research.search") ||
        loaded.operationKeys.select !== (loaded.attemptVersion === 2 ? `research.model.r11v2.${policy.id}` : "research.model")) return denied();
    const model = structuredClone(runtime.model ?? resolveModelRoute("standard.default").primary);
    const receipts: JsonObject[] = [];
    let saved = loaded.collection;
    type QualifiedCall = { response: ModelProviderResponse; requestId: string; acceptedResponseModelIds: readonly string[]; routeProof: GenerationRouteProof; receivedAt: number; receiptCheck?: ReceiptCheck };
    const suspend = (check: ReceiptCheck): never => { throw new ReceiptPending(pendingReceiptResult(policy, check, now())); };
    async function resumeReceipt(entry: SavedReceiptCandidate): Promise<QualifiedCall> {
      // Neither a saved paid marker nor another caller's GET claim transfers
      // failure-write ownership. Only collect/complete may promote this output.
      failure.phase = entry.phase; failure.requestId = null; failure.observation = null;
      let check: ReceiptCheck = entry, proof = entry.proof;
      const candidate = validateReceiptCandidate(entry.candidate, policy, saved, now());
      const expected = receiptExpectation(candidate);
      if (check.status !== "verified") {
        if (["terminal", "exhausted", "expired", "stopped"].includes(check.status)) return suspend(check);
        const claimValue = await runtime.rpc("claim_receipt", { policyId, phase: entry.phase, candidateHash: entry.candidateHash });
        check = validateReceiptCheck(claimValue, entry.phase, entry.requestId, entry.candidateHash, policy);
        if (!record(claimValue) || typeof claimValue.claimed !== "boolean") return denied();
        if (!claimValue.claimed) {
          if (claimValue.claimId !== null || !["cooldown", "verified", "terminal", "exhausted", "expired", "stopped"].includes(String(claimValue.reason))) return denied();
          if (check.status !== "verified") return suspend(check);
          // Another caller may have committed proof after our initial load.
          const refreshed = await runtime.rpc("load", { policyId });
          if (!record(refreshed) || refreshed.policyHash !== loaded.policyHash) return denied();
          const latest = validateSavedReceiptCandidates(refreshed.receiptCandidates, policy, saved, now()).find(value => value.phase === entry.phase && value.candidateHash === entry.candidateHash);
          if (!latest || latest.status !== "verified" || !latest.proof) return denied();
          check = latest; proof = latest.proof;
        } else {
          if (claimValue.reason !== "claimed" || typeof claimValue.claimId !== "string" || !UUID.test(claimValue.claimId) || check.status !== "checking_receipt" || check.attempts < 1 ||
              check.attempts <= entry.attempts || !check.nextCheckAt || Date.parse(check.nextCheckAt) < now() || !runtime.verifyGenerationRouteOnce) return denied();
          let diagnostic: { code: GenerationRouteProofError["code"]; httpStatus: number | null } | null = null, retryAfterAt: string | null = null;
          try { proof = validateGenerationRouteProof(await runtime.verifyGenerationRouteOnce(structuredClone(expected)), expected); }
          catch (error) {
            // Unknown implementation exceptions are terminal; a trusted reader
            // must explicitly classify transport availability to earn a retry.
            const safeError = error instanceof GenerationRouteProofError ? error : new GenerationRouteProofError("response_invalid");
            diagnostic = { code: safeError.code, httpStatus: safeError.httpStatus };
            retryAfterAt = isTransientGenerationRouteFailure(safeError) ? safeError.retryAfterAt : null;
          }
          const recorded = await runtime.rpc("record_receipt", { policyId, phase: entry.phase, candidateHash: entry.candidateHash, claimId: claimValue.claimId,
            proof: proof as unknown as JsonObject | null, diagnostic, retryAfterAt });
          check = validateReceiptCheck(recorded, entry.phase, entry.requestId, entry.candidateHash, policy);
          if (!record(recorded) || recorded.recorded !== true || typeof recorded.replayed !== "boolean") return denied();
          if (check.status !== "verified") return suspend(check);
        }
      }
      if (!proof || proof.proofHash !== check.proofHash) return denied();
      proof = validateGenerationRouteProof(proof, expected);
      const receipt: JsonObject = { provider: candidate.phase === "search" ? "openrouter.exa" : "openrouter", providerModelId: candidate.providerModelId,
        providerRequestId: candidate.providerRequestId, responseProviderIdentity: candidate.observation.providerIdentity,
        observedResponseProvider: candidate.observation.observedProvider, responseProviderHash: candidate.observation.responseProviderHash ?? null,
        reportedMicrousd: candidate.reportedMicrousd, generationRouteProof: proof as unknown as JsonObject };
      await runtime.settle(entry.requestId, receipt);
      receipts.push(receipt);
      return { response: receiptCandidateResponse(candidate), requestId: entry.requestId, acceptedResponseModelIds: [...RECEIPT_RESPONSE_MODELS], routeProof: proof,
        receivedAt: Date.parse(candidate.receivedAt), receiptCheck: check };
    }
    async function call(phase: Phase, request: WebSearchModelRequest | StructuredModelRequest, expected: Wire, collectionId: string | null): Promise<QualifiedCall> {
      failure.reason = "internal_failure"; failure.phase = phase; failure.requestId = null; failure.observation = null;
      validatePublicResearchPolicy(policy, now());
      const freshQuote = await runtime.verifyQuote(structuredClone(policy));
      if (!freshQuote || freshQuote.providerName !== "Azure") return denied();
      // Copy the trusted deadline before any further async work. V2's longer
      // authority never makes stale catalogue evidence fresh. SQL binds this
      // separately from the financial descriptor and rechecks after lock waits.
      const quoteValidUntil = freshQuote.quoteValidUntil;
      const requireFreshQuote = () => {
        if (policy.version === "r11.public-research.2" && (typeof quoteValidUntil !== "string" ||
            !Number.isFinite(Date.parse(quoteValidUntil)) || Date.parse(quoteValidUntil) <= now() || Date.parse(quoteValidUntil) > now() + 5 * 60_000)) return denied();
      };
      requireFreshQuote();
      // Historical V1 injection remains strict-alias only. V2 must carry the
      // freshly hash-verified catalog alias/canonical pair.
      if (loaded.attemptVersion === 2 && freshQuote.acceptedResponseModelIds?.length !== 2) return denied();
      const acceptedResponseModelIds = validateResearchResponseModelIds(policy.modelId, freshQuote.acceptedResponseModelIds ?? [policy.modelId]);
      if (durable && publicResearchHash(acceptedResponseModelIds) !== publicResearchHash(RECEIPT_RESPONSE_MODELS)) return denied();
      validatePublicResearchPolicy(policy, now());
      const inspected = await inspectPublicResearchWire(request, phase);
      if (!wireEquals(inspected, expected)) return denied();
      const observationContext = { modelId: policy.modelId, acceptedResponseModelIds, allowedDomains: policy.allowedDomains, excludedDomains: policy.excludedDomains };
      let admittedRequestId: string | null = null;
      const observeResponse = (body: unknown, providerError?: string): JsonObject => {
        failure.observation = observePublicResearchResponse(body, observationContext, providerError);
        return failure.observation as unknown as JsonObject;
      };
      const acceptObservation = (value: unknown, fallback: unknown, providerError?: string): ResearchObservation => {
        const observation = value === undefined ? observePublicResearchResponse(fallback, observationContext, providerError)
          : validateResearchObservation(value, policy.allowedDomains, policy.modelId, acceptedResponseModelIds);
        if (providerError) observation.providerError = observePublicResearchResponse({}, observationContext, providerError).providerError;
        return observation;
      };
      async function verifyRouteAndEnrich(requestId: string, receipt: JsonObject): Promise<{ routeProof: GenerationRouteProof; enrichedReceipt: JsonObject }> {
        failure.reason = "response_provider_unqualified";
        const setRoute = (status: "unavailable" | "invalid" | "verified", proofHash: string | null = null) => {
          if (failure.observation) {
            failure.observation.responseProviderHash ??= failure.observation.providerIdentity === "exact" && failure.observation.observedProvider === "Azure" ? digest("Azure") : null;
            failure.observation.inferenceRouteStatus = status; failure.observation.inferenceRouteProofHash = proofHash;
            failure.observation.inferenceRouteFailureCode = null; failure.observation.inferenceRouteHttpStatus = null; failure.observation.inferenceRouteAttempts = null;
          }
        };
        // A receipt ID is not permission for another model call. Retain the
        // bounded public response while this fixed-origin metadata read resolves;
        // only the reader's finite transient GET retries are allowed.
        if (typeof receipt.providerRequestId !== "string" || !/^gen-[A-Za-z0-9_-]{1,296}$/.test(receipt.providerRequestId) ||
            policy.providerEndpoint !== "azure/us" || acceptedResponseModelIds.length !== 2 || typeof runtime.verifyGenerationRoute !== "function") {
          setRoute("invalid"); return denied();
        }
        const expected: GenerationRouteExpectation = { generationId: receipt.providerRequestId, providerName: "Azure", acceptedResponseModelIds,
          requestedEndpoint: "azure/us" };
        let routeProof: GenerationRouteProof;
        try { routeProof = validateGenerationRouteProof(await runtime.verifyGenerationRoute(structuredClone(expected)), expected); }
        catch (error) {
          setRoute(error instanceof GenerationRouteProofError && ["invalid_request", "json_invalid", "response_invalid", "response_too_large", "generation_mismatch", "provider_mismatch", "model_mismatch", "provider_responses_invalid", "redirect_rejected"].includes(error.code) ? "invalid" : "unavailable");
          const details = readResearchRouteFailureDetails(error);
          if (failure.observation && details) {
            failure.observation.inferenceRouteFailureCode = details.code;
            failure.observation.inferenceRouteHttpStatus = details.httpStatus;
            failure.observation.inferenceRouteAttempts = details.attempts;
          }
          return denied();
        }
        setRoute("verified", routeProof.proofHash);
        const enrichedReceipt = { ...receipt, generationRouteProof: routeProof as unknown as JsonObject };
        // Keep the original financial receipt unchanged. R05 retains each hash
        // and takes maximum exposure per request, never the sum of enrichment.
        failure.reason = "cost_unverified_or_over_cap";
        await runtime.settle(requestId, enrichedReceipt);
        return { routeProof, enrichedReceipt };
      }
      const admit: ModelDispatchAdmission = async wire => {
        if (admittedRequestId !== null || wire.url !== "https://openrouter.ai/api/v1/chat/completions" || wire.method !== "POST" || digest(wire.body) !== inspected.wireHash || Buffer.byteLength(wire.body, "utf8") !== inspected.wireBytes) return denied();
        requireFreshQuote();
        // A lost/denied guard reply can belong to another invocation. Only a
        // positive dispatch grant gives this invocation failure-write ownership.
        failure.phase = phase; failure.requestId = null; failure.observation = null;
        const result = await runtime.rpc("guard", { policyId, phase, collectionId,
          ...(policy.version === "r11.public-research.2" ? { quoteValidUntil: quoteValidUntil! } : {}),
          admission: { workflowRunId: ownedScope.coreWorkflowRunId, runtimeCapability: ownedScope.runtimeCapability,
            operationKey: loaded.operationKeys[phase], requestHash: inspected.requestHash,
            wireRequestHash: inspected.wireHash, wireRequestBytes: inspected.wireBytes, maximumOutputTokens: inspected.maxTokens,
            providerModelId: policy.modelId, idempotencyKey: `r11:${policy.id}:${phase}`, accounting: { kind: "r05" },
            sourceDomains: [...policy.allowedDomains], dataClasses: ["generic_public_query", "public_evidence"], accountId: null, accountRevision: null,
            currency: "USD", liabilityMicrounits: String(phase === "search" ? policy.searchMicrousd : policy.selectorMicrousd) } });
        if (!record(result) || result.decision !== "allowed" || result.shouldDispatch !== true || typeof result.requestId !== "string" || !UUID.test(result.requestId)) return denied();
        admittedRequestId = result.requestId; failure.requestId = result.requestId;
      };
      let response: ModelProviderResponse;
      try {
        const provider = runtime.provider(admit, observeResponse);
        response = phase === "search" ? await provider.invokeWebSearch(request as WebSearchModelRequest) : await provider.invokeStructured(request as StructuredModelRequest);
      } catch (error) {
        if (!admittedRequestId) return denied();
        failure.reason = "provider_response_invalid";
        if (error instanceof ModelProviderError) {
          const received = record(error.details.providerReceipt) ? error.details.providerReceipt : {}, usage = record(received.usage) ? received.usage : {};
          // Settlement precedes every diagnostic gate, including projection
          // validation. Missing cost remains unknown; no estimate is substituted.
          let settlementFailed = false;
          if (providerRequestId(received.providerRequestId)) {
            try { await runtime.settle(admittedRequestId, { providerRequestId: received.providerRequestId, reportedMicrousd: costMicrousd(usage.reportedCostUsd) }); }
            catch { settlementFailed = true; }
          }
          const fallback = { model: received.providerModelId, provider: phase === "search" ? received.upstreamProvider : received.provider,
            choices: [{ finish_reason: received.finishReason, message: {} }] };
          failure.observation = acceptObservation(error.details.researchObservation ?? failure.observation ?? undefined, fallback, error.category);
          if (settlementFailed || (providerRequestId(received.providerRequestId) && costMicrousd(usage.reportedCostUsd) === null) || (costMicrousd(usage.reportedCostUsd) ?? 0) > (phase === "search" ? policy.searchMicrousd : policy.selectorMicrousd)) failure.reason = "cost_unverified_or_over_cap";
          else if (failure.observation.modelIdentity === "other" || error.details.validationGate === "response_model") failure.reason = "response_model_unqualified";
          else {
            const outputFailureReason = error.details.validationGate === "source_contract" ? "source_contract_invalid"
              : error.details.validationGate === "structured_output" ? "selector_output_invalid" : "provider_response_invalid";
            if (!durable && providerRequestId(received.providerRequestId) && costMicrousd(usage.reportedCostUsd) !== null &&
                ["request_alias", "canonical"].includes(failure.observation.modelIdentity)) {
              await verifyRouteAndEnrich(admittedRequestId, { providerRequestId: received.providerRequestId, reportedMicrousd: costMicrousd(usage.reportedCostUsd) });
            }
            failure.reason = outputFailureReason;
          }
        }
        return denied();
      }
      if (!admittedRequestId) return denied();
      failure.reason = "provider_response_invalid";
      const receivedAt = now();
      response = structuredClone(response);
      const metadata = record(response.metadata) ? response.metadata : {}, output = record(response.output) ? response.output : {};
      // A custom trusted adapter can omit the callback; use only its bounded
      // diagnostic projection or project its returned shape before validators.
      const fallback = { model: response.providerModelId, provider: phase === "search" ? metadata.actualUpstreamProvider : response.provider,
        choices: [{ finish_reason: metadata.finishReason, message: { annotations: output.annotations } }],
        usage: { server_tool_use: { web_search_requests: metadata.searchRequests } } };
      const observed = failure.observation ?? observePublicResearchResponse(fallback, observationContext);
      failure.observation = observed;
      const receipt = safeReceipt(response, observed, phase);
      failure.reason = "cost_unverified_or_over_cap";
      await runtime.settle(admittedRequestId, receipt);
      failure.reason = "provider_response_invalid";
      failure.observation = acceptObservation(metadata.researchObservation ?? failure.observation ?? undefined, fallback);
      if (!acceptedResponseModelIds.includes(response.providerModelId) || !["request_alias", "canonical"].includes(failure.observation.modelIdentity)) { failure.reason = "response_model_unqualified"; return denied(); }
      if (!providerRequestId(response.providerRequestId) || receipt.reportedMicrousd === null || Number(receipt.reportedMicrousd) > (phase === "search" ? policy.searchMicrousd : policy.selectorMicrousd)) { failure.reason = "cost_unverified_or_over_cap"; return denied(); }
      if (durable) {
        if (phase === "search" && response.provider !== "openrouter.exa") return denied();
        // Validate all non-route gates before retaining output or spending a GET
        // claim. The immutable projection is saved after accounting, before I/O.
        failure.reason = phase === "search" ? "source_contract_invalid" : "selector_output_invalid";
        const candidate: ReceiptCandidate = validateReceiptCandidate({ version: "r11.receipt-candidate.1", phase,
          providerRequestId: response.providerRequestId, providerModelId: response.providerModelId, receivedAt: new Date(receivedAt).toISOString(),
          reportedMicrousd: receipt.reportedMicrousd, output: phase === "search" ? normalizeReceiptSearchOutput(response.output.annotations, policy) : response.output,
          observation: failure.observation }, policy, saved, now());
        const candidateHash = publicResearchHash(candidate);
        // A lost stage reply may already have committed. Do not revoke a saved
        // response on uncertainty; reload safely finds the exact same candidate.
        failure.requestId = null;
        const staged = await runtime.rpc("stage_receipt", { policyId, requestId: admittedRequestId, candidate: candidate as unknown as JsonObject, candidateHash });
        const check = validateReceiptCheck(staged, phase, admittedRequestId, candidateHash, policy);
        if (!record(staged) || staged.staged !== true || typeof staged.replayed !== "boolean") return denied();
        return resumeReceipt({ ...check, candidate, proof: null });
      }
      const { routeProof, enrichedReceipt } = await verifyRouteAndEnrich(admittedRequestId, receipt);
      receipts.push(enrichedReceipt);
      return { response, requestId: admittedRequestId, acceptedResponseModelIds, routeProof, receivedAt };
    }
    if (saved === null) {
      const stagedSearch = candidates.find(candidate => candidate.phase === "search");
      const searched = stagedSearch ? await resumeReceipt(stagedSearch) : await call("search", publicResearchSearchRequest(policy, model, now()), loaded.search, null);
      // Search proof can be retained after dispatch authority expires, but it
      // cannot admit a new selector or be promoted into a false completed run.
      if (durable && now() >= Date.parse(policy.validUntil) && searched.receiptCheck) return suspend(searched.receiptCheck);
      failure.reason = "source_contract_invalid";
      if (failure.observation && (failure.observation.searchRequests !== 1 || failure.observation.annotationCount === null || failure.observation.annotationCount < 1 || failure.observation.annotationCount > 4 || failure.observation.malformedAnnotationCount > 0 || failure.observation.rejectedDomainCount > 0)) return denied();
      const { collection, lineage } = collectQualifiedPublicSources(policy, searched.response, searched.requestId, durable ? searched.receivedAt : now(), searched.acceptedResponseModelIds, searched.routeProof);
      const selector = publicResearchSelectorRequest(policy, model, collection, lineage, now());
      const selectorWire = await inspectPublicResearchWire(selector, "select");
      const lineageHash = publicResearchHash(lineage);
      failure.reason = "collection_persistence_failed";
      const recorded = await runtime.rpc("collect", { policyId, searchRequestId: searched.requestId, providerRequestId: searched.response.providerRequestId,
        collection, collectionCanonical: canonicalPublicResearchJson(collection), collectionHash: publicResearchHash(collection),
        lineage: lineage as unknown as JsonObject, lineageCanonical: canonicalPublicResearchJson(lineage), lineageHash,
        selectorRequestHash: selectorWire.requestHash, selectorWireHash: selectorWire.wireHash, selectorWireBytes: selectorWire.wireBytes, selectorMaxTokens: selectorWire.maxTokens });
      if (!record(recorded) || typeof recorded.collectionId !== "string" || !UUID.test(recorded.collectionId) || recorded.collectionHash !== publicResearchHash(collection) || recorded.lineageHash !== lineageHash) return denied();
      saved = { id: recorded.collectionId, collection, collectionHash: publicResearchHash(collection), lineage, lineageHash, selector: selectorWire };
      // The search is durably complete. Its marker cannot authorize a later
      // preflight failure to stop a selector already owned by another caller.
      failure.requestId = null; failure.observation = null;
    }
    failure.reason = "source_contract_invalid";
    if (!UUID.test(saved.id) || saved.collectionHash !== publicResearchHash(saved.collection) || saved.lineageHash !== publicResearchHash(saved.lineage)) return denied();
    const stagedSelect = candidates.find(candidate => candidate.phase === "select");
    if (!stagedSelect) validatePublicResearchLineage(policy, saved.collection, saved.lineage, now());
    const selected = stagedSelect ? await resumeReceipt(stagedSelect) : await call("select", publicResearchSelectorRequest(policy, model, saved.collection, saved.lineage, now()), saved.selector, saved.id);
    failure.reason = "selector_output_invalid";
    const evidencePack = assembleAdmittedPublicEvidence(policy, saved.collection, saved.lineage, selected.response.output, now()), evidencePackHash = publicResearchHash(evidencePack);
    failure.reason = "result_persistence_failed";
    const completed = await runtime.rpc("complete", { policyId, collectionId: saved.id, selectorRequestId: selected.requestId,
      providerRequestId: selected.response.providerRequestId, selection: selected.response.output, evidencePack,
      evidencePackCanonical: canonicalPublicResearchJson(evidencePack), evidencePackHash });
    if (!record(completed) || typeof completed.resultId !== "string" || !UUID.test(completed.resultId) || completed.evidencePackHash !== evidencePackHash || typeof completed.replayed !== "boolean") return denied();
    return { status: "completed", evidencePack, evidencePackHash, resultId: completed.resultId, policyId, collectionId: saved.id, receipts };
  } catch (error) {
    if (error instanceof ReceiptPending) return error.result;
    // Never borrow a durable marker on denied, duplicate or uncertain admission.
    // The positively admitted caller may still finish; this caller only reads
    // back durable state and must not journal/revoke or claim a write failure.
    if (failure.requestId === null) throw new PublicResearchQualificationUnacquiredError();
    let outcomeId: string | null = null, recorded = false, superseded = false;
    if (journalEligible) {
      try {
        const outcome = await runtime.rpc("fail", { policyId, phase: failure.phase, requestId: failure.requestId, reason: failure.reason,
          observation: failure.observation as unknown as JsonObject | null });
        if (record(outcome) && typeof outcome.outcomeId === "string" && UUID.test(outcome.outcomeId) && outcome.recorded === true && typeof outcome.replayed === "boolean" && typeof outcome.workflowStatus === "string") {
          outcomeId = outcome.outcomeId; recorded = true;
        } else if (record(outcome) && outcome.recorded === false && outcome.superseded === true && outcome.reason === "phase_progressed" && typeof outcome.workflowStatus === "string") {
          // A committed collect/complete reply can be lost. The database alone
          // can establish that this phase already progressed; no failure write
          // or revocation occurred, so read back the surviving durable state.
          superseded = true;
        }
      } catch { /* Never claim durable diagnosis if the independent write failed. */ }
    }
    if (superseded) throw new PublicResearchQualificationUnacquiredError();
    throw new PublicResearchQualificationError(failure.reason, failure.phase, failure.requestId, failure.observation, outcomeId, recorded);
  }
}

export async function verifyPublicResearchPolicyQuote(policy: PublicResearchPolicy): Promise<{ providerName: string; acceptedResponseModelIds: readonly string[]; quoteValidUntil: string }> {
  validatePublicResearchPolicy(policy);
  const quote = await fetchPublicResearchQuote({ maximumMicrousd: policy.maximumMicrousd });
  validatePublicResearchQuote(quote);
  if (quote.quoteHash !== policy.quoteHash || quote.modelId !== policy.modelId || quote.providerEndpoint !== policy.providerEndpoint || quote.searchMicrousd !== policy.searchMicrousd || quote.selectorMicrousd !== policy.selectorMicrousd || publicResearchHash(quote.priceLimit) !== publicResearchHash(policy.priceLimit)) return denied();
  return { providerName: quote.providerName, acceptedResponseModelIds: quote.version === "r11.public-research-quote.2" ? quote.acceptedResponseModelIds : [quote.modelId], quoteValidUntil: quote.validUntil };
}

/** Default trusted database adapter; model credentials never enter its saved
 * policies, database payloads, citation artifacts or returned receipts. */
export function publicResearchRuntime(scope: Scope, verifyQuote: PublicResearchRuntime["verifyQuote"] = verifyPublicResearchPolicyQuote): PublicResearchRuntime {
  const ownedScope = structuredClone(scope);
  const key = () => { const value = ownedScope.admissionKey ?? process.env.R05_ADMISSION_SERVER_KEY?.trim(); if (!value) return denied(); return value; };
  return { verifyQuote, verifyGenerationRoute: fetchGenerationRouteProof, verifyGenerationRouteOnce: fetchGenerationRouteProofOnce, requireDurableReceipts: true, provider: (admit, observeResponse) => new OpenRouterAdapter({ admitDispatch: admit, observeResponse }),
    async rpc(operation, payload) {
      const result = await createRuntimeClient().rpc("r11_research_server_v2", { p_business_id: ownedScope.businessId, p_operation: operation, p_payload: payload, p_server_key: key() });
      if (result.error) return denied(); return result.data;
    },
    async settle(requestId, receipt) {
      if (typeof receipt.providerRequestId !== "string" || receipt.providerRequestId.length < 1 || receipt.providerRequestId.length > 300) return denied();
      const amount = receipt.reportedMicrousd;
      if (amount !== null && (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0)) return denied();
      const result = await createRuntimeClient().rpc("r05_admission_server", { p_business_id: ownedScope.businessId, p_operation: "settle", p_server_key: key(), p_payload: {
        requestId, currency: "USD", actualMicrounits: amount === null ? null : String(amount), providerRequestId: receipt.providerRequestId, receiptHash: publicResearchHash(receipt),
      } });
      if (result.error || !record(result.data) || result.data.decision !== "allowed") return denied();
    } };
}
