import type { JsonObject } from "../core/contracts";
import { containsCredentialLikeContent } from "../core/quest-intake";
import { awaitRequestDeadline, boundedRpc, deadlineFetch, requestDeadline } from "../core/request-deadline";
import { OpenRouterAdapter, getOpenRouterConfig, type OpenRouterConfig } from "../models/openrouter";
import type { ModelDispatchAdmission, ModelProviderResponse, StructuredModelRequest } from "../models/types";
import { fetchGenerationRouteProofOnce, validateGenerationRouteProof, type GenerationRouteProof } from "../research/generation-route";
import { discoveryR12ReceiptExpectation, type DiscoveryR12Candidate, type DiscoveryR12CandidateBinding } from "./discovery-r12-receipt";
import type { DiscoveryR12CompletedPhase } from "./discovery-r12-runtime";
import { buildPublicResearchModelRequest, inspectPublicResearchModelWire, projectPublicResearchModelPhase, readPublicResearchModelInputs, type PublicResearchModelContext, type PublicResearchModelInputs, type PublicResearchModelPhase } from "./discovery-r12-public-model";
import { exactPublicKeys as exact, publicHash, publicResearchHash as hash, publicTime, publicUuid } from "./discovery-r12-public-utils";

/** Server-authenticated setup pins. Browser forms and model output cannot supply
 * these, the RPC implementation, credentials, or a provider implementation. */
export type PublicResearchModelRuntimeAuthority = { businessId: string; goalId: string; scopeId: string; scopeHash: string; planHash: string; profileHash: string; policyHash: string };
export type PublicResearchModelRpc = (purpose: "controller" | "admission", operation: "attempt" | "candidate" | "dispatch" | "model_receipt", payload: JsonObject) => Promise<unknown>;
export type PublicResearchModelProvider = {
  invoke(request: StructuredModelRequest, admit: ModelDispatchAdmission): Promise<ModelProviderResponse>;
  routeProof(candidate: DiscoveryR12Candidate): Promise<GenerationRouteProof>;
};
export type PublicResearchModelRuntimeDependencies = { rpc: PublicResearchModelRpc; provider?: PublicResearchModelProvider; now?: () => number };
export type PublicResearchModelRuntimeOutcome = {
  attemptId: string; requestId: string | null; status: "accepted" | "failed_settled" | "pending" | "not_dispatched";
  diagnostic: string | null; dispatchAdmittedThisInvocation: boolean; candidateSaved: boolean;
  receiptHash: string | null; completed: DiscoveryR12CompletedPhase | null;
};
type DependencyPin = { stepKey: string; attemptId: string; resultHash: string; receiptHash: string };
type Attempt = { attemptId: string; requestId: string; phase: PublicResearchModelPhase; ordinal: number; dependencyPins: DependencyPin[]; inputs: PublicResearchModelInputs; status: string; dispatched: boolean; binding: DiscoveryR12CandidateBinding | null; candidate: DiscoveryR12Candidate | null; completed: DiscoveryR12CompletedPhase | null; failure: JsonObject | null };
const endpoint = "https://openrouter.ai/api/v1/chat/completions";
function fail(): never { throw new Error("r12_public_model_runtime_unverified"); }
const same = (a: unknown, b: unknown) => hash(a) === hash(b);
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const json = (v: unknown) => structuredClone(v) as JsonObject;
const candidateLimit = (phase: PublicResearchModelPhase) => phase === "strategy" ? 73_728 : 32_768;

/** Real RPC composition; the caller supplies its existing authenticated client
 * and scoped server keys. No provider credential is serialized into an RPC. */
export function createPublicResearchModelRpc(client: { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> & { abortSignal?(signal: AbortSignal): PromiseLike<{ data: unknown; error: unknown }> } }, scope: { businessId: string; scopeId: string; controllerKey: string; admissionKey: string }, signal = requestDeadline(120_000)): PublicResearchModelRpc {
  if (!publicUuid(scope.businessId) || !publicUuid(scope.scopeId) || ![scope.controllerKey, scope.admissionKey].every(x => typeof x === "string" && x.length >= 32 && x.length <= 200)) fail();
  const own = { ...scope };
  return async (purpose, operation, payload) => {
    if ((operation === "dispatch") !== (purpose === "admission")) fail();
    const response = await boundedRpc(client.rpc("r12_direct_controller_server", { p_business_id: own.businessId, p_scope_id: own.scopeId, p_operation: operation, p_payload: payload, p_server_key: purpose === "admission" ? own.admissionKey : own.controllerKey }), signal, 10_000);
    if (response.error || response.data === null || response.data === undefined) fail();
    return response.data;
  };
}

/** Limit response bytes before the existing adapter parses its envelope. The
 * endpoint, redirects, deadline and credential recipient remain fixed. */
function boundedProviderFetch(fetcher: typeof fetch, signal: AbortSignal): typeof fetch {
  const transport = deadlineFetch(signal, fetcher);
  return async (input, init) => {
    if (String(input) !== endpoint || init?.method !== "POST" || init.redirect !== "error") fail();
    const response = await transport(input, { ...init, credentials: "omit" });
    if (response.redirected || response.url && response.url !== endpoint) fail();
    const maximum = 262_144, length = response.headers.get("content-length");
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximum)) { void response.body?.cancel().catch(() => undefined); fail(); }
    const reader = response.body?.getReader();
    const readSignal = init?.signal ? AbortSignal.any([signal, init.signal]) : signal;
    if (!reader) fail();
    const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      for (;;) {
        const next = await awaitRequestDeadline(reader.read(), readSignal);
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > maximum) fail();
        chunks.push(next.value);
      }
    } catch (error) { void reader.cancel().catch(() => undefined); throw error; }
    finally { reader.releaseLock(); }
    return new Response(Buffer.concat(chunks), { status: response.status, statusText: response.statusText, headers: response.headers });
  };
}

/** Default implementation uses the ordinary admitted OpenRouter serializer and
 * one independent metadata GET. Creation is lazy: receipt-only checks with no
 * candidate need neither provider configuration nor an external request. */
export function createPublicResearchModelProvider(options: { config?: OpenRouterConfig; fetcher?: typeof fetch; signal?: AbortSignal } = {}): PublicResearchModelProvider {
  const config = structuredClone(options.config ?? getOpenRouterConfig()), signal = options.signal ?? requestDeadline(90_000), fetcher = options.fetcher ?? fetch;
  if (config.baseUrl !== "https://openrouter.ai/api/v1" || !config.apiKey || config.apiKey.length > 4096 || /[\r\n]/.test(config.apiKey)) fail();
  return {
    invoke: (request, admit) => new OpenRouterAdapter({ config, fetcher: boundedProviderFetch(fetcher, signal), admitDispatch: admit, timeoutMs: 45_000 }).invokeStructured(request),
    routeProof: candidate => fetchGenerationRouteProofOnce({ ...discoveryR12ReceiptExpectation(candidate), config: { apiKey: config.apiKey }, fetcher: deadlineFetch(signal, fetcher) }),
  };
}

function authority(raw: PublicResearchModelRuntimeAuthority): PublicResearchModelRuntimeAuthority {
  if (!exact(raw, "businessId,goalId,scopeId,scopeHash,planHash,profileHash,policyHash") || ![raw.businessId, raw.goalId, raw.scopeId].every(publicUuid) || ![raw.scopeHash, raw.planHash, raw.profileHash, raw.policyHash].every(publicHash)) fail();
  return structuredClone(raw);
}
function context(input: PublicResearchModelInputs, expected: PublicResearchModelRuntimeAuthority, attemptId: string): PublicResearchModelContext {
  if (!input || input.policy?.policyHash !== expected.policyHash) fail();
  return readPublicResearchModelInputs(input, { ...expected, phaseAttemptId: attemptId, phase: input.phase, inputHash: input.inputHash, reviewQualificationHash: hash(input.reviewQualification), quoteRouteEvidenceHash: input.executionQuoteProof.routeEvidenceHash, quoteAuthoritySnapshotHash: input.executionQuoteProof.authoritySnapshotHash, sourceReceiptHashes: input.sourcePackets.map(p => p.receipt.receiptHash), dependencyResponseHashes: Object.values(input.dependencies).filter(x => x !== null).map(x => x.responseHash) });
}
function readAttempt(raw: unknown, expected: PublicResearchModelRuntimeAuthority, attemptId: string): { attempt: Attempt; context: PublicResearchModelContext } {
  if (!exact(raw, "attemptId,requestId,phase,ordinal,dependencyPins,inputs,status,dispatched,binding,candidate,completed,failure")) fail();
  const a = structuredClone(raw) as unknown as Attempt;
  if (a.attemptId !== attemptId || !publicUuid(a.requestId) || !["plan", "strategy", "review"].includes(a.phase) || typeof a.dispatched !== "boolean" || !["scheduled", "reserved", "dispatched", "uncertain", "responded", "completed", "rejected", "failed", "cancelled"].includes(a.status) || !Array.isArray(a.dependencyPins) || a.dependencyPins.length > 3) fail();
  const ctx = context(a.inputs, expected, attemptId);
  if (ctx.input.phase !== a.phase || ctx.input.state.attempts.at(-1)?.ordinal !== a.ordinal || a.dispatched !== (a.binding !== null)) fail();
  for (const p of a.dependencyPins) if (!exact(p, "stepKey,attemptId,resultHash,receiptHash") || !["plan", "source", "strategy"].includes(p.stepKey) || !publicUuid(p.attemptId) || !publicHash(p.resultHash) || !publicHash(p.receiptHash)) fail();
  if (new Set(a.dependencyPins.map(p => p.stepKey)).size !== a.dependencyPins.length || !a.dispatched && (a.candidate !== null || a.completed !== null || a.failure !== null) || a.completed !== null && a.failure !== null) fail();
  if (a.binding) validateBinding(a.binding, ctx, a.requestId);
  if (a.candidate) validateRawCandidate(a.candidate, a.binding!, ctx);
  return { attempt: a, context: ctx };
}
function validateBinding(b: DiscoveryR12CandidateBinding, ctx: PublicResearchModelContext, requestId: string): void {
  const i = ctx.input;
  if (!exact(b, "scopeId,attemptId,requestId,phase,request,maximumMicrousd,dispatchedAt,receiptExpiresAt") || b.scopeId !== i.policy.scopeId || b.attemptId !== i.phaseAttemptId || b.requestId !== requestId || b.phase !== i.phase || b.maximumMicrousd !== Number(i.policy.phaseMaximumMicrounits[i.phase]) || !same(b.request, buildPublicResearchModelRequest(ctx)) || publicTime(b.dispatchedAt) < publicTime(i.executionQuoteProof.verifiedAt) || publicTime(b.dispatchedAt) >= publicTime(i.executionQuoteProof.validUntil) || publicTime(b.receiptExpiresAt) <= publicTime(b.dispatchedAt) || publicTime(b.receiptExpiresAt) - publicTime(b.dispatchedAt) > 3_600_000) fail();
}
function unsafeOutput(value: unknown): boolean {
  const keys = new Set(["apikey", "accesstoken", "refreshtoken", "clientsecret", "password", "passwd", "secretkey", "secret", "token", "bearer", "authorization"]);
  let count = 0;
  function visit(v: unknown, depth: number): boolean {
    if (++count > 20_000 || depth > 30) return true;
    if (typeof v === "string") return v.includes("\0") || Buffer.from(v, "utf8").toString("utf8") !== v || containsCredentialLikeContent(v);
    if (typeof v === "number") return !Number.isFinite(v);
    if (v === null || typeof v === "boolean") return false;
    if (Array.isArray(v)) return v.some(x => visit(x, depth + 1));
    if (!object(v) || Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) return true;
    return Object.entries(v).some(([k, x]) => keys.has(k.toLowerCase().replace(/[ _-]/g, "")) || containsCredentialLikeContent(k) || visit(x, depth + 1));
  }
  return visit(value, 0);
}
/** Schema-free persistence boundary. A malformed object still has authentic
 * billing provenance; domain rejection is recorded only after route proof. */
function validateRawCandidate(raw: unknown, b: DiscoveryR12CandidateBinding, ctx: PublicResearchModelContext): DiscoveryR12Candidate {
  if (!exact(raw, "version,scopeId,attemptId,requestId,phase,requestHash,providerRequestId,providerModelId,receivedAt,reportedMicrousd,output")) fail();
  const c = raw as unknown as DiscoveryR12Candidate, model = ctx.input.phase === "review" ? ctx.input.quote.inference.reviewer : ctx.input.quote.inference.luna;
  if (c.version !== "r12.discovery-response.1" || c.scopeId !== b.scopeId || c.attemptId !== b.attemptId || c.requestId !== b.requestId || c.phase !== b.phase || c.requestHash !== hash(b.request) || !/^gen-[A-Za-z0-9_-]{1,296}$/.test(c.providerRequestId) || !(model.acceptedResponseModelIds as readonly string[]).includes(c.providerModelId) || !object(c.output) || c.reportedMicrousd !== null && (!Number.isSafeInteger(c.reportedMicrousd) || c.reportedMicrousd < 0) || new Date(publicTime(c.receivedAt)).toISOString() !== c.receivedAt || publicTime(c.receivedAt) < publicTime(b.dispatchedAt) || publicTime(c.receivedAt) >= publicTime(b.receiptExpiresAt)) fail();
  const serialized = JSON.stringify(c);
  if (Buffer.byteLength(serialized, "utf8") > candidateLimit(ctx.input.phase) || serialized.includes("\\u0000") || unsafeOutput(c.output) || !same(JSON.parse(serialized), c)) fail();
  return structuredClone(c);
}
function createRawCandidate(response: ModelProviderResponse, b: DiscoveryR12CandidateBinding, ctx: PublicResearchModelContext, now: number): DiscoveryR12Candidate {
  if (response.metadata.finishReason !== "stop" || !Number.isSafeInteger(now)) fail();
  const cost = response.usage.reportedCostUsd;
  if (cost !== null && cost !== undefined && (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0)) fail();
  return validateRawCandidate({ version: "r12.discovery-response.1", scopeId: b.scopeId, attemptId: b.attemptId, requestId: b.requestId, phase: b.phase, requestHash: hash(b.request), providerRequestId: response.providerRequestId, providerModelId: response.providerModelId, receivedAt: new Date(now).toISOString(), reportedMicrousd: cost === null || cost === undefined ? null : Math.ceil(cost * 1_000_000), output: response.output }, b, ctx);
}
function receiptHash(c: DiscoveryR12Candidate, proof: GenerationRouteProof): string {
  return hash({ version: "r12.public-model-receipt-pin.1", phase: c.phase, scopeId: c.scopeId, phaseAttemptId: c.attemptId, requestId: c.requestId, requestHash: c.requestHash, candidateHash: hash(c), routeProofHash: proof.proofHash });
}

/** Executes at most one already scheduled paid model dispatch. It never
 * schedules, retries, repairs, renews authority or releases an unknown hold. */
export async function runPublicResearchModelAttempt(args: { authority: PublicResearchModelRuntimeAuthority; attemptId: string; mode: "execute" | "receipt_only" }, deps: PublicResearchModelRuntimeDependencies): Promise<PublicResearchModelRuntimeOutcome> {
  const pins = authority(args.authority), attemptId = args.attemptId;
  if (!publicUuid(attemptId) || !["execute", "receipt_only"].includes(args.mode)) fail();
  const now = deps.now ?? Date.now;
  let sent = false, saved = false, requestId: string | null = null, provider: PublicResearchModelProvider | undefined = deps.provider;
  const port = () => provider ??= createPublicResearchModelProvider();
  const outcome = (status: PublicResearchModelRuntimeOutcome["status"], diagnostic: string | null, rh: string | null = null, completed: DiscoveryR12CompletedPhase | null = null): PublicResearchModelRuntimeOutcome => ({ attemptId, requestId, status, diagnostic, dispatchAdmittedThisInvocation: sent, candidateSaved: saved, receiptHash: rh, completed });
  const load = async () => readAttempt(await deps.rpc("controller", "attempt", { attemptId }), pins, attemptId);
  let loaded: ReturnType<typeof readAttempt>;
  try { loaded = await load(); } catch { return outcome("pending", "attempt_read_unverified"); }
  let { attempt: a, context: ctx } = loaded; requestId = a.requestId; saved = a.candidate !== null;
  const finished = (): PublicResearchModelRuntimeOutcome | null => {
    if (a.completed) {
      const d = a.completed;
      if (!a.candidate || !a.binding || d.attemptId !== attemptId || d.stepKey !== a.phase || !same(d.candidate, a.candidate) || !same(d.binding, a.binding) || d.response.outcome !== "accepted" || d.response.planHash !== pins.planHash || d.responseCanonicalHash !== hash(d.response) || !publicHash(d.responseHash)) fail();
      const expected = projectPublicResearchModelPhase(ctx, a.candidate, a.binding, d.proof);
      if (!same(expected, d.response.result)) fail();
      return outcome("accepted", null, String(expected.modelReceiptHash), d);
    }
    if (a.failure) {
      const f = a.failure;
      if (!a.candidate || !exact(f, "version,phaseAttemptId,requestId,candidateHash,routeProofHash,modelReceiptHash,diagnostic,actualMicrounits") || f.version !== "r12.direct-settled-failure.1" || f.phaseAttemptId !== attemptId || f.requestId !== requestId || f.candidateHash !== hash(a.candidate) || !publicHash(f.routeProofHash) || !publicHash(f.modelReceiptHash) || typeof f.diagnostic !== "string" || !/^r12_direct_[a-z0-9_]{1,100}$/.test(f.diagnostic) || f.actualMicrounits !== String(a.candidate.reportedMicrousd) || a.candidate.reportedMicrousd === null || a.candidate.reportedMicrousd > a.binding!.maximumMicrousd || f.modelReceiptHash !== hash({version:"r12.public-model-receipt-pin.1",phase:a.phase,scopeId:pins.scopeId,phaseAttemptId:attemptId,requestId,requestHash:a.candidate.requestHash,candidateHash:hash(a.candidate),routeProofHash:f.routeProofHash})) fail();
      return outcome("failed_settled", "paid_domain_failure", f.modelReceiptHash);
    }
    return null;
  };
  try { const done = finished(); if (done) return done; } catch { return outcome("pending", "saved_receipt_unverified"); }
  if (!a.dispatched) {
    if (args.mode === "receipt_only") return outcome("not_dispatched", "receipt_only");
    const admitted: { value: { inputs: PublicResearchModelInputs; binding: DiscoveryR12CandidateBinding } | null } = { value: null };
    let admissionAttempted = false;
    try {
      if (a.status !== "scheduled" || now() >= publicTime(ctx.input.executionQuoteProof.validUntil)) return outcome("not_dispatched", "dispatch_expired_or_ineligible");
      const request = buildPublicResearchModelRequest(ctx), wire = await inspectPublicResearchModelWire(ctx);
      const response = await port().invoke(structuredClone(request), async actual => {
        if (admissionAttempted) fail(); admissionAttempted = true;
        if (!same(actual, wire.wire) || actual.url !== endpoint || now() >= publicTime(ctx.input.executionQuoteProof.validUntil)) fail();
        const raw = await deps.rpc("admission", "dispatch", json({ attemptId, binding: { version: "r12.discovery-wire.1", scopeId: pins.scopeId, scopeHash: pins.scopeHash, attemptId, requestId, phase: a.phase, requestJson: JSON.stringify(request), requestHash: wire.requestHash, wireBody: wire.wire.body, wireHash: wire.wireHash, quote: ctx.input.quote, dependencyPins: a.dependencyPins } }));
        if (!object(raw) || raw.shouldDispatch !== true || raw.attemptId !== attemptId || raw.requestId !== requestId || raw.requestHash !== wire.requestHash || raw.wireHash !== wire.wireHash) fail();
        const final = context(raw.inputs as PublicResearchModelInputs, pins, attemptId), binding = structuredClone(raw.binding) as DiscoveryR12CandidateBinding;
        validateBinding(binding, final, requestId!);
        if (!same(buildPublicResearchModelRequest(final), request) || (await inspectPublicResearchModelWire(final)).wire.body !== actual.body || final.input.state.attempts.at(-1)!.dispatches.at(-1)!.requestHash !== wire.requestHash || now() >= publicTime(final.input.executionQuoteProof.validUntil)) fail();
        admitted.value = { inputs: final.input, binding }; ctx = final; sent = true;
      });
      if (!admitted.value || !sent) fail();
      // Admission owns the exact immutable request and real dispatch times.
      const accepted = admitted.value;
      a = { ...a, dispatched: true, inputs: accepted.inputs, binding: accepted.binding };
      a.candidate = createRawCandidate(response, accepted.binding, ctx, now());
      try {
        const result = await deps.rpc("controller", "candidate", json({ attemptId, candidate: a.candidate }));
        if (!object(result) || result.recorded !== true || result.candidateHash !== hash(a.candidate)) fail();
        saved = true;
      } catch {
        // A lost acknowledgement is reconciled by read; never issue inference again.
        try { const current = await load(); if (!current.attempt.candidate || !same(current.attempt.candidate, a.candidate)) fail(); a = current.attempt; ctx = current.context; saved = true; } catch { return outcome("pending", "candidate_save_unconfirmed"); }
      }
    } catch { return outcome("pending", sent ? "provider_response_unqualified" : admissionAttempted ? "dispatch_unconfirmed" : "provider_configuration_or_request_unqualified"); }
  }
  if (!a.candidate || !a.binding) return outcome("pending", "marked_without_saved_candidate");
  if (a.candidate.reportedMicrousd === null) return outcome("pending", "billing_unknown");
  if (a.candidate.reportedMicrousd > a.binding.maximumMicrousd) return outcome("pending", "billing_above_reserved_bound");
  let proof: GenerationRouteProof;
  try { proof = validateGenerationRouteProof(await port().routeProof(structuredClone(a.candidate)), discoveryR12ReceiptExpectation(a.candidate)); } catch { return outcome("pending", "route_proof_pending"); }
  const rh = receiptHash(a.candidate, proof);
  try {
    const result = await deps.rpc("controller", "model_receipt", json({ attemptId, candidate: a.candidate, proof }));
    if (!object(result) || result.recorded !== true || result.receiptHash !== rh) fail();
  } catch {
    // Both failed and accepted paid results are immutable. Read proves whether
    // an ambiguous write landed; a later invocation may retry only the receipt.
  }
  try { const current = await load(); a = current.attempt; ctx = current.context; saved = a.candidate !== null; return finished() ?? outcome("pending", "receipt_save_unconfirmed"); }
  catch { return outcome("pending", "receipt_save_unconfirmed"); }
}
