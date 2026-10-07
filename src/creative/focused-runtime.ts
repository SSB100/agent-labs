import type { JsonObject } from "../core/contracts";
import { OpenRouterAdapter, type OpenRouterConfig } from "../models/openrouter";
import { ModelProviderError, type ModelProviderResponse, type StructuredModelRequest } from "../models/types";
import { creativeHash } from "./contracts";
import type { CreativeReservation } from "./budget";
import { OpenRouterImageAdapter, ImageProviderError, type ImageGenerationQuote } from "./image-provider";
import type { CreativeImageStorage, SourcePreservation } from "./stored-image";
import { MAX_CREATIVE_PNG_BYTES } from "./types";
import { FOCUSED_CREATIVE_BOUNDS as bounds, focusedCreativeDescriptor, focusedCreativeRoute, focusedWireHash, qualifyFocusedCreativeReceipt, routeFocusedCreativeRequest, validateFocusedCreativeProof, validateFocusedCreativeScope, validateFocusedCreativeDispatchQuote,
  type FocusedCreativeBinding, type FocusedCreativeCandidate, type FocusedCreativeDescriptor, type FocusedCreativePhase, type FocusedCreativePhaseRecord, type FocusedCreativeProgress } from "./focused-runtime-contract";

export type FocusedCreativeStore = {
  transition(operation: string, payload: JsonObject): Promise<unknown>;
  /** Calls only scoped R05 guard with accounting.kind creative; returns its UUID. */
  admit(descriptor: Omit<FocusedCreativeDescriptor,"runtimeCapability">): Promise<string>;
  /** Existing R05 legacy_settle; never a second independent R05 settlement. */
  settle(phase: FocusedCreativePhase, amount: number | null, generationId: string | null, receipt: JsonObject): Promise<void>;
  storage: CreativeImageStorage;
};
export type FocusedCreativePreparation = { kind: "text"; request: StructuredModelRequest; dispatchQuote: import('./focused-runtime-contract').FocusedCreativeDispatchQuote; validateOutput(output: JsonObject): void }
  | { kind: "image"; prompt: string; quote: ImageGenerationQuote; wireBody: string; requestHash: string;
      /** Inspects the already saved exact original bytes; must never edit/re-encode. */
      inspect(bytes: Uint8Array, storagePath: string, receivedAt: string): Promise<JsonObject> };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const gen = (v: unknown): v is string => typeof v === "string" && /^gen-[A-Za-z0-9_-]{1,296}$/.test(v);
const fail = (): never => { throw Error("r12_focused_creative_unverified"); };
const json = (v: unknown) => structuredClone(v) as JsonObject;
import { createHash } from "node:crypto";
const sourceHash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Capture the real serializer at a denied local admission. No POST or secret
 * transmission occurs. This is separate from R05 registration/authority. */
export async function inspectFocusedTextWire(request: StructuredModelRequest, config: OpenRouterConfig): Promise<string> {
  let body: string | null = null;
  const adapter = new OpenRouterAdapter({ config, fetcher: async () => fail(), admitDispatch: async wire => {
    if (wire.url !== "https://openrouter.ai/api/v1/chat/completions" || wire.method !== "POST") return fail();
    body = wire.body;throw Error("r12_focused_inert_wire_capture");
  } });
  try { await adapter.invokeStructured(request); } catch { /* Exact serializer capture only. */ }
  if (body === null) return fail();return body;
}
function verifyCandidate(candidate: FocusedCreativeCandidate, binding: FocusedCreativeBinding, max: number) {
  if (candidate.version !== "r12.focused-creative-candidate.1" || candidate.callKey !== binding.callKey || candidate.scopeHash !== binding.scopeHash ||
      candidate.bindingHash !== creativeHash(binding) || !gen(candidate.generationId) || !focusedCreativeRoute(candidate.callKey).models.includes(candidate.modelId) ||
      candidate.outputHash !== creativeHash(candidate.output) || Buffer.byteLength(JSON.stringify(candidate)) > bounds.outputBytes ||
      !Number.isFinite(Date.parse(candidate.receivedAt)) || !(candidate.reportedMicrousd === null || Number.isSafeInteger(candidate.reportedMicrousd) && candidate.reportedMicrousd >= 0 && candidate.reportedMicrousd <= max)) return fail();
}
async function receiptOnce(candidate: FocusedCreativeCandidate, config: OpenRouterConfig, fetcher: typeof fetch, now: number) {
  let status: number | null = null;
  try {
    const response = await fetcher(`https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(candidate.generationId)}`, { headers: { Authorization: `Bearer ${config.apiKey}` }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000) });
    status = response.status;
    if (!response.ok) {
      await response.body?.cancel();const after = response.headers.get("retry-after"), seconds = after && /^\d+$/.test(after) ? Number(after) : null;
      const parsed = seconds === null ? Date.parse(after ?? "") : Number.isSafeInteger(seconds) ? now + seconds * 1000 : 253402300799999;
      const retryAt = Math.max(now + bounds.receiptIntervalMs, Number.isFinite(parsed) ? parsed : 0);
      return { proof: null, diagnostic: { code: [404,429].includes(status) || status >= 500 ? "receipt_pending" : "receipt_terminal", httpStatus: status }, retryAfterAt: new Date(Math.min(retryAt, 253402300799999)).toISOString() };
    }
    if (!response.body) return fail();const reader = response.body.getReader(), parts: Uint8Array[] = [];let size = 0;
    try { for (;;) { const { done, value } = await reader.read();if (done) break;size += value.length;if (size > bounds.receiptBytes) return fail();parts.push(value); } }
    finally { await reader.cancel().catch(() => undefined); }
    return { proof: qualifyFocusedCreativeReceipt(JSON.parse(Buffer.concat(parts).toString("utf8")), candidate), diagnostic: null, retryAfterAt: null };
  } catch { return { proof: null, diagnostic: { code: status === 200 ? "receipt_invalid" : "receipt_transport", httpStatus: status }, retryAfterAt: status === 200 ? null : new Date(now + bounds.receiptIntervalMs).toISOString() }; }
}

/** Exactly one existing Stage14 phase. A durable candidate is reconciled before
 * request preparation, so receipt waits cannot reserve or generate again. */
export async function executeFocusedCreativePhase(options: {
  phase: FocusedCreativePhase; businessId: string; creativeRunId: string; approvalHash: string;
  store: FocusedCreativeStore; prepare(validationAt?: number, binding?: FocusedCreativeBinding): Promise<FocusedCreativePreparation>;
  config: OpenRouterConfig; fetcher?: typeof fetch; now?: () => number;
}): Promise<FocusedCreativeProgress> {
  const now = options.now ?? Date.now, fetcher = options.fetcher ?? fetch, phase = options.phase, store = options.store;
  const op = async (operation: string, payload: JsonObject = {}) => store.transition(`r12_${operation}`, { callKey: phase, ...payload });
  const load = async () => {
    const value = await op("load");if (!object(value) || !object(value.scope) || !object(value.phase)) return fail();
    const saved = value as unknown as FocusedCreativePhaseRecord;
    if (saved.scope.businessId !== options.businessId || saved.scope.creativeRunId !== options.creativeRunId || saved.scope.approvalHash !== options.approvalHash) return fail();
    return saved;
  };
  let saved = await load();const scope = saved.scope;
  const progress = (): FocusedCreativeProgress => {
    const receipt = saved.phase.receipt;
    if (receipt && ["awaiting_receipt","checking_receipt"].includes(receipt.status) && receipt.attempts <= bounds.receiptAttempts && Date.parse(receipt.receiptExpiresAt) > now()) {
      return { status: "waiting", wakeAt: new Date(Math.min(Date.parse(receipt.receiptExpiresAt), Math.max(now() + 1000, Date.parse(receipt.nextCheckAt ?? "") || now() + bounds.receiptIntervalMs))).toISOString() };
    }
    return { status: "blocked", reason: receipt?.status ?? "paid_phase_unresolved" };
  };
  let preparation: FocusedCreativePreparation | null = null;
  const prepare = async () => preparation ??= await options.prepare(saved.dispatchedAt ? Date.parse(saved.dispatchedAt) : now(), saved.phase.binding ?? undefined);
  if (!saved.phase.candidate) {
    if (saved.dispatchedAt) return { status: "blocked", reason: "marked_without_candidate" };
    if (Date.parse(scope.expiresAt) <= now()) return { status: "blocked", reason: "dispatch_expired" };
    validateFocusedCreativeScope(scope, now());const prepared = await prepare();
    if ((phase === "generate:1") !== (prepared.kind === "image")) return fail();
    if(prepared.kind==='text') validateFocusedCreativeDispatchQuote(prepared.dispatchQuote,scope,phase as Exclude<FocusedCreativePhase,'generate:1'>,now());
    const request = prepared.kind === "text" ? routeFocusedCreativeRequest(scope, phase as Exclude<FocusedCreativePhase,"generate:1">, prepared.request) : { prompt: prepared.prompt, quote: prepared.quote };
    const wireBody = prepared.kind === "text" ? await inspectFocusedTextWire(request as StructuredModelRequest, options.config) : prepared.wireBody;
    const requestHash = prepared.kind === "text" ? creativeHash(request) : prepared.requestHash;
    const descriptor = focusedCreativeDescriptor(scope, phase, requestHash, wireBody);
    const binding: FocusedCreativeBinding = { version: "r12.focused-creative-wire.1", scopeHash: creativeHash(scope), callKey: phase, dispatchQuote: prepared.kind==='text'?prepared.dispatchQuote:null, request, requestHash, wireBody, wireHash: focusedWireHash(wireBody), descriptor };
    if (saved.phase.binding && creativeHash(saved.phase.binding) !== creativeHash(binding)) return fail();
    const reservation: CreativeReservation = { callKey: phase, model: descriptor.providerModelId, provider: "openrouter", requestHash,
      reservedMicrousd: scope.phaseCeilings[phase], estimate: { version: "r12.focused-creative-ceiling.1", quoteHash: scope.quoteHash, fixedCeiling: true } };
    const reserved = await store.transition("reserve_call", json(reservation));
    if (!object(reserved) || reserved.shouldExecute !== true) return { status: "blocked", reason: "reservation_already_exists" };
    await op("bind", { binding: json(binding), bindingHash: creativeHash(binding) });
    let requestId: string | null = null, observation: JsonObject | null = null, dispatchMarked=false;
    const admit = async (body: string) => {
      if (body !== binding.wireBody) return fail();
      if(binding.dispatchQuote) validateFocusedCreativeDispatchQuote(binding.dispatchQuote,scope,phase as Exclude<FocusedCreativePhase,'generate:1'>,now());
      requestId = await store.admit(binding.descriptor);
      const sent = await op("send", { bindingHash: creativeHash(binding), requestId });
      if (!object(sent) || sent.shouldDispatch !== true) return fail();
      dispatchMarked=true;
    };
    const observed = async () => { if (observation) await op("observe", { observation, observationHash: creativeHash(observation) }); };
    let candidate: FocusedCreativeCandidate | null = null, response: ModelProviderResponse | null = null, imageReceipt: JsonObject | null = null;
    let sourcePreservation: SourcePreservation | null = null;
    try {
      if (prepared.kind === "text") {
        const adapter = new OpenRouterAdapter({ config: options.config, fetcher, admitDispatch: wire => admit(wire.body), observeResponse: body => {
          if (Buffer.byteLength(JSON.stringify(body)) <= bounds.outputBytes) observation = json({ version: "r12.focused-creative-observation.1", receivedAt: new Date(now()).toISOString(), response: body });
          return { savedInPrivateClosure: observation !== null };
        } });
        response = await adapter.invokeStructured(request as StructuredModelRequest);await observed();
        if (!gen(response.providerRequestId) || response.metadata.finishReason !== "stop") return fail();
        prepared.validateOutput(response.output);
        const cost = response.usage.reportedCostUsd;
        candidate = { version: "r12.focused-creative-candidate.1", scopeHash: binding.scopeHash, callKey: phase, bindingHash: creativeHash(binding), generationId: response.providerRequestId,
          modelId: response.providerModelId, receivedAt: new Date(now()).toISOString(), reportedMicrousd: typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? Math.ceil(cost * 1e6) : null,
          output: response.output, outputHash: creativeHash(response.output) };
      } else {
        const adapter = new OpenRouterImageAdapter({ modelId: "black-forest-labs/flux.2-klein-4b", config: options.config, fetcher, now,
          admitDispatch: wire => admit(wire.body) });
        const generated = await adapter.generate({ prompt: prepared.prompt }, { quote: prepared.quote, reservationId: `${scope.creativeRunId}:${phase}`, reservedMicrousd: scope.phaseCeilings[phase], preauthorized: true });
        // Require a separately captured same-response generation header. A generic
        // request-id/body-id fallback must never become an image receipt identity.
        imageReceipt = json(generated.receipt);
        const generationId = (generated.receipt as typeof generated.receipt & { generationId?: string | null }).generationId;
        // Retain the bounded paid original before applying this pilot's narrower
        // native-PNG/vision limits. A retained source is never an accepted asset.
        if (generated.bytes.length < 12 || generated.bytes.length > MAX_CREATIVE_PNG_BYTES) return fail();
        const storagePath = `${scope.businessId}/${scope.creativeRunId}/version-1${generated.mediaType === "image/webp" ? ".original.webp" : ".png"}`, sha256 = sourceHash(generated.bytes);
        sourcePreservation = { storagePath, mediaType: generated.mediaType, bytes: generated.bytes.length, sha256, uploadConfirmed: false, downloadVerified: false };
        const upload = await store.storage.upload(storagePath, generated.bytes, { contentType: generated.mediaType, upsert: false, cacheControl: "0" });if (upload.error) return fail();
        sourcePreservation.uploadConfirmed = true;
        const stored = await store.storage.download(storagePath);if (stored.error || !stored.data || stored.data.size !== generated.bytes.length || sourceHash(new Uint8Array(await stored.data.arrayBuffer())) !== sha256) return fail();
        sourcePreservation.downloadVerified = true;
        if (generated.mediaType !== "image/png" || generated.bytes.length > bounds.originalImageBytes) return fail();
        const imageObservation = { version: "r12.focused-creative-image-observation.1", receivedAt: new Date(now()).toISOString(), receipt: json(generated.receipt), storagePath, sourceSha256: sha256, sourceBytes: generated.bytes.length };
        await op("observe", { observation: imageObservation, observationHash: creativeHash(imageObservation) });
        if (!gen(generationId)) return fail();
        const output = json({ storagePath, prompt: prepared.prompt, mediaType: "image/png", declaredMediaType: generated.declaredMediaType, sourceSha256: sha256, sourceBytes: generated.bytes.length, receipt: generated.receipt });
        candidate = { version: "r12.focused-creative-candidate.1", scopeHash: binding.scopeHash, callKey: phase, bindingHash: creativeHash(binding), generationId, modelId: generated.receipt.modelId,
          receivedAt: new Date(now()).toISOString(), reportedMicrousd: generated.receipt.reportedMicrousd, output, outputHash: creativeHash(output) };
      }
      verifyCandidate(candidate, binding, scope.phaseCeilings[phase]);
      await op("stage", { candidate: json(candidate), candidateHash: creativeHash(candidate) });
      await store.settle(phase, candidate.reportedMicrousd, candidate.generationId, json(candidate));
    } catch (error) {
      if(!dispatchMarked){await store.settle(phase,0,null,{failure:'focused_dispatch_denied',transportAuthorized:false,bindingHash:creativeHash(binding)});throw error;}
      try { await observed(); } catch { /* Keep the charge even if observation storage failed. */ }
      const failureReceipt = error instanceof ModelProviderError && object(error.details.providerReceipt) ? error.details.providerReceipt : error instanceof ImageProviderError && error.receipt ? json(error.receipt) : imageReceipt;
      const usage = response?.usage ?? (failureReceipt && object(failureReceipt.usage) ? failureReceipt.usage : null), cost = usage?.reportedCostUsd;
      const receiptId = response?.providerRequestId ?? failureReceipt?.providerRequestId ?? null;
      const amount = typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? Math.ceil(cost * 1e6) : failureReceipt && typeof failureReceipt.reportedMicrousd === "number" ? failureReceipt.reportedMicrousd : null;
      await store.settle(phase, candidate?.reportedMicrousd ?? amount, candidate?.generationId ?? (typeof receiptId === "string" ? receiptId : null), candidate ? json(candidate) : json({ failure: "focused_phase_rejected", requestId, receipt: failureReceipt, sourcePreservation }));
      throw error;
    }
    saved = await load();
  }
  const { binding, candidate } = saved.phase;if (!binding || !candidate) return fail();
  if (Date.parse(scope.receiptUntil) <= now()) return { status: "blocked", reason: "receipt_expired" };
  validateFocusedCreativeScope(scope, now(), true);verifyCandidate(candidate, binding, scope.phaseCeilings[phase]);
  if (binding.callKey !== phase || (phase !== "generate:1" ? binding.requestHash !== creativeHash(binding.request) : binding.requestHash !== creativeHash(JSON.parse(binding.wireBody))) ||
      !saved.dispatchedAt || Date.parse(candidate.receivedAt) < Date.parse(saved.dispatchedAt) || Date.parse(candidate.receivedAt) >= Date.parse(scope.receiptUntil) ||
      binding.scopeHash !== creativeHash(scope) || binding.wireHash !== focusedWireHash(binding.wireBody) || creativeHash(binding.descriptor) !== creativeHash(focusedCreativeDescriptor(scope,phase,binding.requestHash,binding.wireBody))) return fail();
  await store.settle(phase, candidate.reportedMicrousd, candidate.generationId, json(candidate));
  let proof = saved.phase.proof;
  if (!proof) {
    const claim = await op("claim", { candidateHash: creativeHash(candidate) });
    if (!object(claim) || claim.claimed !== true || typeof claim.claimId !== "string") { saved = await load();return progress(); }
    const result = await receiptOnce(candidate, options.config, fetcher, now());
    // SQL owns the minimum claim spacing; retain its timestamp across clock skew.
    const minimumRetry = object(claim.receipt) ? Date.parse(String(claim.receipt.nextCheckAt)) : NaN;
    if (result.retryAfterAt && Number.isFinite(minimumRetry)) result.retryAfterAt = new Date(Math.max(Date.parse(result.retryAfterAt), minimumRetry)).toISOString();
    await op("record", { candidateHash: creativeHash(candidate), claimId: claim.claimId, ...json(result) });
    if (!result.proof) { saved = await load();return progress(); }proof = result.proof;
  }
  proof = validateFocusedCreativeProof(proof, candidate);
  if (candidate.reportedMicrousd === null) return { status: "blocked", reason: "unknown_cost" };
  const prepared = await prepare();let output = candidate.output;
  if (prepared.kind === "image") {
    const path = String(candidate.output.storagePath), stored = await store.storage.download(path);
    if (stored.error || !stored.data || stored.data.size !== candidate.output.sourceBytes) return fail();
    const bytes = new Uint8Array(await stored.data.arrayBuffer());if (sourceHash(bytes) !== candidate.output.sourceSha256) return fail();
    if (!["absent", "image/png"].includes(String(candidate.output.declaredMediaType))) return fail();
    output = await prepared.inspect(bytes, path, candidate.receivedAt);
  } else prepared.validateOutput(output);
  await op("persist", { candidateHash: creativeHash(candidate), proofHash: proof.proofHash, output });return { status: "advanced" };
}
