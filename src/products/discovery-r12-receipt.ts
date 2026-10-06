import type { JsonObject } from "../core/contracts";
import type { ModelProviderResponse, StructuredModelRequest, WebSearchModelRequest } from "../models/types";
import { normalizeReceiptSearchOutput } from "../research/qualification-pending";
import { validateGenerationRouteProof, type GenerationRouteExpectation, type GenerationRouteProof } from "../research/generation-route";
import { assertJsonSchemaValue } from "../workers/schema-validator";
import { discoveryV2Hash } from "./discovery-v2";
import { DISCOVERY_R12_PHASES, discoveryR12Call, type DiscoveryR12Phase } from "./discovery-r12-wire";
import { discoveryV2Model } from "./discovery-v2-budget";
import { DISCOVERY_R12_REVIEWER } from "./discovery-r12-quote";
import { R12ReviewResponseError, type R12ReviewDiagnosticCode } from "./discovery-r12-observation";

export const DISCOVERY_R12_OUTPUT_BYTES = { plan: 16_384, search1: 24_576, select1: 16_384, strategy: 65_536, review: 16_384 } as const;
export type DiscoveryR12Candidate = {
  version: "r12.discovery-response.1";
  scopeId: string; attemptId: string; requestId: string; phase: DiscoveryR12Phase; requestHash: string;
  providerRequestId: string; providerModelId: string; receivedAt: string; reportedMicrousd: number | null;
  output: JsonObject;
};
export type DiscoveryR12CandidateBinding = {
  scopeId: string; attemptId: string; requestId: string; phase: DiscoveryR12Phase;
  request: StructuredModelRequest | WebSearchModelRequest; maximumMicrousd: number;
  dispatchedAt: string; receiptExpiresAt: string;
};
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const GEN = /^gen-[A-Za-z0-9_-]{1,296}$/;
const fail = (code: R12ReviewDiagnosticCode = "candidate_binding"): never => { throw new R12ReviewResponseError(code); };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function models(phase: DiscoveryR12Phase): readonly string[] {
  return phase === "review" ? [DISCOVERY_R12_REVIEWER.modelId, DISCOVERY_R12_REVIEWER.canonicalModelId] : ["openai/gpt-5.6-luna", "openai/gpt-5.6-luna-20260709"];
}
function bind(binding: DiscoveryR12CandidateBinding) {
  if (!binding || ![binding.scopeId, binding.attemptId, binding.requestId].every(value => typeof value === "string" && UUID.test(value)) || !DISCOVERY_R12_PHASES.includes(binding.phase) ||
      binding.request?.model.providerModelId !== discoveryV2Model(discoveryR12Call(binding.phase)) || !Number.isSafeInteger(binding.maximumMicrousd) || binding.maximumMicrousd <= 0 || binding.maximumMicrousd > 2_000_000 ||
      !Number.isFinite(Date.parse(binding.dispatchedAt)) || !Number.isFinite(Date.parse(binding.receiptExpiresAt)) || Date.parse(binding.receiptExpiresAt) <= Date.parse(binding.dispatchedAt) ||
      Date.parse(binding.receiptExpiresAt) - Date.parse(binding.dispatchedAt) > 60 * 60_000) return fail();
}
function projectOutput(output: unknown, binding: DiscoveryR12CandidateBinding): JsonObject {
  if (!record(output)) return fail("response_schema");
  if (binding.phase === "search1") {
    if (!("query" in binding.request) || !binding.request.excludedDomains) return fail();
    return { annotations: normalizeReceiptSearchOutput(output.annotations, { allowedDomains: binding.request.allowedDomains, excludedDomains: [...binding.request.excludedDomains] }) };
  }
  if (!("outputSchema" in binding.request)) return fail();
  assertJsonSchemaValue(binding.request.outputSchema, output, "R12 private response candidate");
  return structuredClone(output) as JsonObject;
}

/** Saves only bounded, locally schema-checked output and accounting facts.
 * It does not assert served provider identity or a successful domain decision.
 * Missing cost remains null, and must block another paid phase. */
export function createDiscoveryR12Candidate(binding: DiscoveryR12CandidateBinding, response: ModelProviderResponse, receivedAt = new Date().toISOString()): DiscoveryR12Candidate {
  binding = structuredClone(binding); bind(binding);
  const received = Date.parse(receivedAt), start = Date.parse(binding.dispatchedAt);
  if (!response || typeof response.providerRequestId !== "string" || !GEN.test(response.providerRequestId) || !models(binding.phase).includes(response.providerModelId)) return fail("response_identity");
  if (response.metadata.finishReason !== "stop") return fail("finish_reason");
  if (!Number.isFinite(received) || received < start || received >= Date.parse(binding.receiptExpiresAt)) return fail("response_time");
  if (binding.phase === "search1" && response.metadata.searchRequests !== 1) return fail("response_schema");
  const cost = response.usage.reportedCostUsd;
  const reportedMicrousd = cost === null || cost === undefined ? null : typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? Math.ceil(cost * 1_000_000) : fail("response_cost");
  if (reportedMicrousd !== null && (!Number.isSafeInteger(reportedMicrousd) || reportedMicrousd > binding.maximumMicrousd)) return fail("response_cost");
  const output = projectOutput(response.output, binding);
  const candidate: DiscoveryR12Candidate = { version: "r12.discovery-response.1", scopeId: binding.scopeId, attemptId: binding.attemptId, requestId: binding.requestId,
    phase: binding.phase, requestHash: discoveryV2Hash(binding.request), providerRequestId: response.providerRequestId, providerModelId: response.providerModelId,
    receivedAt: new Date(received).toISOString(), reportedMicrousd, output };
  if (Buffer.byteLength(JSON.stringify(candidate), "utf8") > DISCOVERY_R12_OUTPUT_BYTES[binding.phase]) return fail("response_size");
  return candidate;
}

export function validateDiscoveryR12Candidate(raw: unknown, binding: DiscoveryR12CandidateBinding): DiscoveryR12Candidate {
  bind(binding);
  if (!record(raw) || Object.keys(raw).sort().join(",") !== "attemptId,output,phase,providerModelId,providerRequestId,receivedAt,reportedMicrousd,requestHash,requestId,scopeId,version" ||
      raw.version !== "r12.discovery-response.1" || raw.scopeId !== binding.scopeId || raw.attemptId !== binding.attemptId || raw.requestId !== binding.requestId || raw.phase !== binding.phase ||
      raw.requestHash !== discoveryV2Hash(binding.request) || typeof raw.providerRequestId !== "string" || !GEN.test(raw.providerRequestId) || typeof raw.providerModelId !== "string" || !models(binding.phase).includes(raw.providerModelId) ||
      typeof raw.receivedAt !== "string" || !Number.isFinite(Date.parse(raw.receivedAt)) || new Date(raw.receivedAt).toISOString() !== raw.receivedAt ||
      Date.parse(raw.receivedAt) < Date.parse(binding.dispatchedAt) || Date.parse(raw.receivedAt) >= Date.parse(binding.receiptExpiresAt) ||
      !(raw.reportedMicrousd === null || Number.isSafeInteger(raw.reportedMicrousd) && Number(raw.reportedMicrousd) >= 0 && Number(raw.reportedMicrousd) <= binding.maximumMicrousd) ||
      Buffer.byteLength(JSON.stringify(raw), "utf8") > DISCOVERY_R12_OUTPUT_BYTES[binding.phase]) return fail();
  if (discoveryV2Hash(projectOutput(raw.output, binding)) !== discoveryV2Hash(raw.output)) return fail();
  return structuredClone(raw) as DiscoveryR12Candidate;
}

export function discoveryR12ReceiptExpectation(candidate: DiscoveryR12Candidate): GenerationRouteExpectation {
  return { generationId: candidate.providerRequestId, providerName: candidate.phase === "review" ? "Amazon Bedrock" : "Azure",
    requestedEndpoint: candidate.phase === "review" ? "amazon-bedrock/us" : "azure/us", acceptedResponseModelIds: models(candidate.phase) };
}
export function qualifyDiscoveryR12Candidate(raw: unknown, binding: DiscoveryR12CandidateBinding, proof: GenerationRouteProof) {
  const candidate = validateDiscoveryR12Candidate(raw, binding);
  const route = validateGenerationRouteProof(proof, discoveryR12ReceiptExpectation(candidate));
  if (candidate.reportedMicrousd === null) return fail();
  // The generation endpoint may use the documented alias/canonical pair. Keep
  // each actual identity separately; never rename a saved provider response.
  return { candidate, candidateHash: discoveryV2Hash(candidate), route, financiallyKnown: true as const };
}
