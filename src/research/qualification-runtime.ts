import { createHash } from "node:crypto";
import type { JsonObject } from "../core/contracts";
import { createRuntimeClient } from "../lib/supabase/runtime";
import { OpenRouterAdapter } from "../models/openrouter";
import { resolveModelRoute } from "../models/registry";
import { ModelProviderError, type ModelDefinition, type ModelDispatchAdmission, type ModelProviderResponse, type StructuredModelRequest, type WebSearchModelRequest } from "../models/types";
import { assembleAdmittedPublicEvidence, canonicalPublicResearchJson, collectQualifiedPublicSources, publicResearchHash, publicResearchSearchRequest, publicResearchSelectorRequest, validatePublicResearchLineage, validatePublicResearchPolicy, type PublicResearchLineage, type PublicResearchPolicy } from "./qualification";
import type { EvidencePack, ResearchCollection } from "./types";
import { fetchPublicResearchQuote, validatePublicResearchQuote } from "./qualification-quote";

type Phase = "search" | "select";
export type ResearchRuntimeScope = { businessId: string; coreWorkflowRunId: string; runtimeCapability: string };
type Scope = ResearchRuntimeScope;
type Wire = { requestHash: string; wireHash: string; wireBytes: number; maxTokens: number };
type SavedCollection = { id: string; collection: ResearchCollection; collectionHash: string; lineage: PublicResearchLineage; lineageHash: string; selector: Wire };
type Loaded = { policy: PublicResearchPolicy; policyHash: string; search: Wire; collection: SavedCollection | null };
type Rpc = (operation: "load" | "guard" | "collect" | "complete", payload: JsonObject) => Promise<unknown>;
type Settle = (requestId: string, receipt: JsonObject) => Promise<void>;
type Provider = Pick<OpenRouterAdapter, "invokeWebSearch" | "invokeStructured">;
export type PublicResearchRuntime = {
  rpc: Rpc; settle: Settle; provider: (admit: ModelDispatchAdmission) => Provider;
  /** Must freshly verify exact catalog/ZDR endpoint, full tier quote and hash. */
  verifyQuote: (policy: PublicResearchPolicy) => Promise<{ providerName: string }>;
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

function safeReceipt(response: ModelProviderResponse): JsonObject {
  const reported = response.usage.reportedCostUsd;
  return { provider: response.provider, providerModelId: response.providerModelId, providerRequestId: response.providerRequestId,
    actualUpstreamProvider: typeof response.metadata.actualUpstreamProvider === "string" ? response.metadata.actualUpstreamProvider : null,
    reportedMicrousd: typeof reported === "number" && Number.isFinite(reported) && reported >= 0 && Number.isSafeInteger(Math.ceil(reported * 1e6)) ? Math.ceil(reported * 1e6) : null };
}

/** This runner is deliberately not wired into R12 or an owner Start control.
 * A separately reviewed SQL policy and confirmed R05 operating envelope are
 * necessary, and the final marker rechecks them atomically on every dispatch. */
export async function runPublicResearchQualification(scope: Scope, policyId: string, runtime: PublicResearchRuntime): Promise<{ evidencePack: EvidencePack; evidencePackHash: string; resultId: string; policyId: string; collectionId: string; receipts: JsonObject[] }> {
  const ownedScope = structuredClone(scope), now = runtime.now ?? Date.now;
  if (!UUID.test(policyId) || !UUID.test(ownedScope.businessId) || !UUID.test(ownedScope.coreWorkflowRunId) || !ownedScope.runtimeCapability) return denied();
  const loadedValue = await runtime.rpc("load", { policyId });
  if (!record(loadedValue) || !record(loadedValue.policy) || typeof loadedValue.policyHash !== "string" || !record(loadedValue.search) || !(loadedValue.collection === null || record(loadedValue.collection))) return denied();
  const loaded = structuredClone(loadedValue) as unknown as Loaded, policy = loaded.policy;
  validatePublicResearchPolicy(policy, now());
  if (policy.id !== policyId || policy.businessId !== ownedScope.businessId || policy.workflowRunId !== ownedScope.coreWorkflowRunId || publicResearchHash(policy) !== loaded.policyHash) return denied();
  const model = structuredClone(runtime.model ?? resolveModelRoute("standard.default").primary);
  const receipts: JsonObject[] = [];
  async function call(phase: Phase, request: WebSearchModelRequest | StructuredModelRequest, expected: Wire, collectionId: string | null): Promise<{ response: ModelProviderResponse; requestId: string }> {
    validatePublicResearchPolicy(policy, now());
    const freshQuote = await runtime.verifyQuote(structuredClone(policy));
    if (!freshQuote || typeof freshQuote.providerName !== "string" || freshQuote.providerName.length < 2) return denied();
    validatePublicResearchPolicy(policy, now());
    const inspected = await inspectPublicResearchWire(request, phase);
    if (!wireEquals(inspected, expected)) return denied();
    let admittedRequestId: string | null = null;
    const admit: ModelDispatchAdmission = async wire => {
      if (admittedRequestId !== null || wire.url !== "https://openrouter.ai/api/v1/chat/completions" || wire.method !== "POST" || digest(wire.body) !== inspected.wireHash || Buffer.byteLength(wire.body, "utf8") !== inspected.wireBytes) return denied();
      const result = await runtime.rpc("guard", { policyId, phase, collectionId,
        admission: { workflowRunId: ownedScope.coreWorkflowRunId, runtimeCapability: ownedScope.runtimeCapability,
          operationKey: phase === "search" ? "research.search" : "research.model", requestHash: inspected.requestHash,
          wireRequestHash: inspected.wireHash, wireRequestBytes: inspected.wireBytes, maximumOutputTokens: inspected.maxTokens,
          providerModelId: policy.modelId, idempotencyKey: `r11:${policy.id}:${phase}`, accounting: { kind: "r05" },
          sourceDomains: [...policy.allowedDomains], dataClasses: ["generic_public_query", "public_evidence"], accountId: null, accountRevision: null,
          currency: "USD", liabilityMicrounits: String(phase === "search" ? policy.searchMicrousd : policy.selectorMicrousd) } });
      if (!record(result) || result.decision !== "allowed" || result.shouldDispatch !== true || typeof result.requestId !== "string" || !UUID.test(result.requestId)) return denied();
      admittedRequestId = result.requestId;
    };
    let response: ModelProviderResponse;
    try {
      const provider = runtime.provider(admit);
      response = phase === "search" ? await provider.invokeWebSearch(request as WebSearchModelRequest) : await provider.invokeStructured(request as StructuredModelRequest);
    } catch (error) {
      // A received cost/identity is preserved even when output/transport fails.
      // No receipt or null cost leaves the original marker's liability unknown.
      if (admittedRequestId && error instanceof ModelProviderError && record(error.details.providerReceipt)) {
        const received = error.details.providerReceipt, usage = record(received.usage) ? received.usage : {};
        const cost = usage.reportedCostUsd;
        const amount = typeof cost === "number" && Number.isFinite(cost) && cost >= 0 && Number.isSafeInteger(Math.ceil(cost * 1e6)) ? Math.ceil(cost * 1e6) : null;
        if (typeof received.providerRequestId === "string") {
          try { await runtime.settle(admittedRequestId, { providerRequestId: received.providerRequestId, reportedMicrousd: amount }); } catch { /* Keep held liability. */ }
        }
      }
      return denied();
    }
    if (!admittedRequestId) return denied();
    response = structuredClone(response);
    const receipt = safeReceipt(response);
    await runtime.settle(admittedRequestId, receipt);
    receipts.push(receipt);
    const observedProvider = phase === "search" ? response.metadata.actualUpstreamProvider : response.provider;
    if (response.providerModelId !== policy.modelId || observedProvider !== freshQuote.providerName || typeof response.providerRequestId !== "string" || receipt.reportedMicrousd === null || Number(receipt.reportedMicrousd) > (phase === "search" ? policy.searchMicrousd : policy.selectorMicrousd)) return denied();
    return { response, requestId: admittedRequestId };
  }
  let saved = loaded.collection;
  if (saved === null) {
    const request = publicResearchSearchRequest(policy, model, now());
    const searched = await call("search", request, loaded.search, null);
    const { collection, lineage } = collectQualifiedPublicSources(policy, searched.response, searched.requestId, now());
    const selector = publicResearchSelectorRequest(policy, model, collection, lineage, now());
    const selectorWire = await inspectPublicResearchWire(selector, "select");
    const lineageHash = publicResearchHash(lineage);
    const recorded = await runtime.rpc("collect", { policyId, searchRequestId: searched.requestId, providerRequestId: searched.response.providerRequestId,
      collection, collectionCanonical: canonicalPublicResearchJson(collection), collectionHash: publicResearchHash(collection),
      lineage: lineage as unknown as JsonObject, lineageCanonical: canonicalPublicResearchJson(lineage), lineageHash,
      selectorRequestHash: selectorWire.requestHash, selectorWireHash: selectorWire.wireHash, selectorWireBytes: selectorWire.wireBytes, selectorMaxTokens: selectorWire.maxTokens });
    if (!record(recorded) || typeof recorded.collectionId !== "string" || !UUID.test(recorded.collectionId) || recorded.collectionHash !== publicResearchHash(collection) || recorded.lineageHash !== lineageHash) return denied();
    saved = { id: recorded.collectionId, collection, collectionHash: publicResearchHash(collection), lineage, lineageHash, selector: selectorWire };
  }
  if (!UUID.test(saved.id) || saved.collectionHash !== publicResearchHash(saved.collection) || saved.lineageHash !== publicResearchHash(saved.lineage)) return denied();
  validatePublicResearchLineage(policy, saved.collection, saved.lineage, now());
  const selected = await call("select", publicResearchSelectorRequest(policy, model, saved.collection, saved.lineage, now()), saved.selector, saved.id);
  const evidencePack = assembleAdmittedPublicEvidence(policy, saved.collection, saved.lineage, selected.response.output, now()), evidencePackHash = publicResearchHash(evidencePack);
  const completed = await runtime.rpc("complete", { policyId, collectionId: saved.id, selectorRequestId: selected.requestId,
    providerRequestId: selected.response.providerRequestId, selection: selected.response.output, evidencePack,
    evidencePackCanonical: canonicalPublicResearchJson(evidencePack), evidencePackHash });
  if (!record(completed) || typeof completed.resultId !== "string" || !UUID.test(completed.resultId) || completed.evidencePackHash !== evidencePackHash || typeof completed.replayed !== "boolean") return denied();
  return { evidencePack, evidencePackHash, resultId: completed.resultId, policyId, collectionId: saved.id, receipts };
}

export async function verifyPublicResearchPolicyQuote(policy: PublicResearchPolicy): Promise<{ providerName: string }> {
  validatePublicResearchPolicy(policy);
  const quote = await fetchPublicResearchQuote({ maximumMicrousd: policy.maximumMicrousd });
  validatePublicResearchQuote(quote);
  if (quote.quoteHash !== policy.quoteHash || quote.modelId !== policy.modelId || quote.providerEndpoint !== policy.providerEndpoint || quote.searchMicrousd !== policy.searchMicrousd || quote.selectorMicrousd !== policy.selectorMicrousd || publicResearchHash(quote.priceLimit) !== publicResearchHash(policy.priceLimit)) return denied();
  return { providerName: quote.providerName };
}

/** Default trusted database adapter; model credentials never enter its saved
 * policies, database payloads, citation artifacts or returned receipts. */
export function publicResearchRuntime(scope: Scope, verifyQuote: PublicResearchRuntime["verifyQuote"] = verifyPublicResearchPolicyQuote): PublicResearchRuntime {
  const ownedScope = structuredClone(scope);
  const key = () => { const value = process.env.R05_ADMISSION_SERVER_KEY?.trim(); if (!value) return denied(); return value; };
  return { verifyQuote, provider: admit => new OpenRouterAdapter({ admitDispatch: admit }),
    async rpc(operation, payload) {
      const result = await createRuntimeClient().rpc("r11_research_server", { p_business_id: ownedScope.businessId, p_operation: operation, p_payload: payload, p_server_key: key() });
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
