import type { JsonObject } from "../core/contracts";
import type { ModelProviderResponse } from "../models/types";
import { assembleAdmittedPublicEvidence, canonicalPublicResearchJson, publicResearchHash, validatePublicResearchPolicy, type PublicResearchLineage, type PublicResearchPolicy } from "./qualification";
import { validateResearchObservation } from "./qualification-outcome";
import type { ResearchObservation } from "./qualification-owner-contract";
import { canonicalResearchUrl } from "./sources";
import { validateGenerationRouteProof, type GenerationRouteProof, type GenerationRouteExpectation, type GenerationRouteFailureCode } from "./generation-route";
import type { ResearchCollection } from "./types";

export const RECEIPT_RESPONSE_MODELS = ["openai/gpt-5.6-luna", "openai/gpt-5.6-luna-20260709"] as const;
export const RECEIPT_CHECK_STATUSES = ["awaiting_receipt", "checking_receipt", "verified", "terminal", "exhausted", "expired", "stopped"] as const;
export type ReceiptPhase = "search" | "select";
export type ReceiptCheckStatus = typeof RECEIPT_CHECK_STATUSES[number];
export type ReceiptCandidate = {
  version: "r11.receipt-candidate.1"; phase: ReceiptPhase; providerRequestId: string; providerModelId: string;
  receivedAt: string; reportedMicrousd: number; output: JsonObject[] | JsonObject; observation: ResearchObservation;
};
export type ReceiptCheck = {
  phase: ReceiptPhase; requestId: string; candidateHash: string; status: ReceiptCheckStatus; attempts: number;
  nextCheckAt: string | null; receiptExpiresAt: string;
  diagnostic: { code: GenerationRouteFailureCode; httpStatus: number | null } | null; proofHash: string | null;
};
export type SavedReceiptCandidate = ReceiptCheck & { candidate: ReceiptCandidate; proof: GenerationRouteProof | null };
export type PublicResearchPendingResult = {
  status: "receipt_pending"; policyId: string; phase: ReceiptPhase; candidateHash: string; receiptStatus: ReceiptCheckStatus;
  attempts: number; nextCheckAt: string | null; receiptExpiresAt: string; canContinue: boolean;
};
type TrustedCollection = { collection: ResearchCollection; lineage: PublicResearchLineage };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const exact = (value: object, keys: string) => Object.keys(value).sort().join(",") === keys.split(",").sort().join(",");
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const FAILURES = ["invalid_request", "configuration_unavailable", "transport_failure", "timeout", "redirect_rejected", "api_failure", "response_too_large", "json_invalid", "response_invalid", "generation_mismatch", "provider_mismatch", "model_mismatch", "provider_responses_invalid"];
const fail = (): never => { throw new Error("public_research_receipt_candidate_invalid"); };
const iso = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
const normalized = (value: string) => {
  if (value.includes("\0") || Buffer.from(value, "utf8").toString("utf8") !== value) return fail();
  return value.replace(/\s+/g, " ").trim();
};
/** Keep the existing UTF-16 size ceiling without introducing an unpaired
 * surrogate when a valid scalar crosses that ceiling. Validate before slicing. */
const boundedNormalized = (value: string, maximum: number) => {
  let result = normalized(value).slice(0, maximum);
  const last = result.charCodeAt(result.length - 1);
  if (last >= 0xD800 && last <= 0xDBFF) result = result.slice(0, -1);
  return result.trim();
};
const within = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/** Project only bounded, normalized public source data. Nothing else from the
 * provider envelope, headers, prompt or free-form provider label is retained. */
export function normalizeReceiptSearchOutput(raw: unknown, policy: Pick<PublicResearchPolicy, "allowedDomains" | "excludedDomains">): JsonObject[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 4) return fail();
  const output = raw.map(annotation => {
    if (!record(annotation) || annotation.type !== "url_citation" || !record(annotation.url_citation)) return fail();
    const citation = annotation.url_citation;
    if (typeof citation.url !== "string" || typeof citation.content !== "string") return fail();
    const url = canonicalResearchUrl(citation.url, policy.allowedDomains), host = new URL(url).hostname;
    if (url.length > 2048 || policy.excludedDomains.some(domain => within(host, domain))) return fail();
    const content = boundedNormalized(citation.content, 1800);
    const title = typeof citation.title === "string" && citation.title.trim() ? boundedNormalized(citation.title, 250) : host;
    if (content.length < 30 || title.length < 1) return fail();
    return { type: "url_citation", url_citation: { url, title, content } };
  });
  // Retain every validated annotation, including repeated citations. The
  // existing source assembler applies its stable greedy deduplication only
  // after route proof, while observation counts remain the raw bounded count.
  return output;
}

export function receiptExpectation(candidate: ReceiptCandidate): GenerationRouteExpectation {
  return { generationId: candidate.providerRequestId, providerName: "Azure", acceptedResponseModelIds: [...RECEIPT_RESPONSE_MODELS], requestedEndpoint: "azure/us" };
}

/** Revalidate private storage just as strictly as freshly projected output. The
 * original response time is immutable; reading does not renew retrieval age. */
export function validateReceiptCandidate(raw: unknown, policy: PublicResearchPolicy, collection: TrustedCollection | null, now: number): ReceiptCandidate {
  validatePublicResearchPolicy(policy, Date.parse(policy.validFrom));
  if (!record(raw) || !exact(raw, "version,phase,providerRequestId,providerModelId,receivedAt,reportedMicrousd,output,observation") ||
      raw.version !== "r11.receipt-candidate.1" || !["search", "select"].includes(String(raw.phase)) ||
      typeof raw.providerRequestId !== "string" || !/^gen-[A-Za-z0-9_-]{1,296}$/.test(raw.providerRequestId) ||
      policy.modelId !== RECEIPT_RESPONSE_MODELS[0] || policy.providerEndpoint !== "azure/us" || !RECEIPT_RESPONSE_MODELS.includes(raw.providerModelId as typeof RECEIPT_RESPONSE_MODELS[number]) ||
      !iso(raw.receivedAt) || Date.parse(raw.receivedAt) > now + 300_000 || Date.parse(raw.receivedAt) < Date.parse(policy.validFrom) - 300_000 ||
      typeof raw.reportedMicrousd !== "number" || !Number.isSafeInteger(raw.reportedMicrousd) || raw.reportedMicrousd < 0 ||
      raw.reportedMicrousd > (raw.phase === "search" ? policy.searchMicrousd : policy.selectorMicrousd) || // Leave room for JSONB whitespace in the database's independent 24 KiB bound.
      Buffer.byteLength(canonicalPublicResearchJson(raw), "utf8") > 23_552) return fail();
  const observation = validateResearchObservation(raw.observation, policy.allowedDomains, policy.modelId, RECEIPT_RESPONSE_MODELS);
  if (!["request_alias", "canonical"].includes(observation.modelIdentity) || observation.observedModelId !== raw.providerModelId ||
      observation.finishReason !== "stop" || observation.providerError !== null || (observation.inferenceRouteStatus !== undefined && observation.inferenceRouteStatus !== "unrequested")) return fail();
  if (raw.phase === "search") {
    if (observation.searchRequests !== 1 || observation.annotationCount === null || observation.annotationCount < 1 || observation.annotationCount > 4 ||
        observation.malformedAnnotationCount !== 0 || observation.rejectedDomainCount !== 0 || !Array.isArray(raw.output) || observation.annotationCount !== raw.output.length) return fail();
    for (const item of raw.output) if (!record(item) || !exact(item, "type,url_citation") || !record(item.url_citation) || !exact(item.url_citation, "url,title,content")) return fail();
    if (publicResearchHash(normalizeReceiptSearchOutput(raw.output, policy)) !== publicResearchHash(raw.output)) return fail();
  } else {
    if (!collection || !record(raw.output)) return fail();
    assembleAdmittedPublicEvidence(policy, collection.collection, collection.lineage, raw.output as JsonObject, Date.parse(raw.receivedAt));
  }
  return structuredClone(raw) as ReceiptCandidate;
}

export function validateReceiptCheck(raw: unknown, phase: ReceiptPhase, requestId: string, candidateHash: string, policy: PublicResearchPolicy): ReceiptCheck {
  if (!record(raw) || raw.phase !== phase || raw.requestId !== requestId || !UUID.test(requestId) || raw.candidateHash !== candidateHash || !HASH.test(candidateHash) ||
      !RECEIPT_CHECK_STATUSES.includes(raw.status as ReceiptCheckStatus) || typeof raw.attempts !== "number" || !Number.isInteger(raw.attempts) || raw.attempts < 0 || raw.attempts > 3 ||
      !(raw.nextCheckAt === null || iso(raw.nextCheckAt)) || !iso(raw.receiptExpiresAt) || Date.parse(raw.receiptExpiresAt) > Date.parse(policy.validUntil) + 30 * 60_000 ||
      !(raw.proofHash === null || (typeof raw.proofHash === "string" && HASH.test(raw.proofHash)))) return fail();
  if (raw.diagnostic !== null) {
    if (!record(raw.diagnostic) || !exact(raw.diagnostic, "code,httpStatus") || !FAILURES.includes(String(raw.diagnostic.code)) ||
        !(raw.diagnostic.httpStatus === null || (typeof raw.diagnostic.httpStatus === "number" && Number.isInteger(raw.diagnostic.httpStatus) && raw.diagnostic.httpStatus >= 100 && raw.diagnostic.httpStatus <= 599))) return fail();
  }
  if ((raw.status === "verified" && (raw.proofHash === null || raw.diagnostic !== null)) || (raw.status === "checking_receipt" && raw.attempts === 0) || (raw.status === "terminal" && raw.diagnostic === null) || (raw.status === "exhausted" && raw.attempts !== 3)) return fail();
  // Never return unrecognized server fields at the public pending boundary.
  return { phase, requestId, candidateHash, status: raw.status as ReceiptCheckStatus, attempts: raw.attempts, nextCheckAt: raw.nextCheckAt,
    receiptExpiresAt: raw.receiptExpiresAt, diagnostic: structuredClone(raw.diagnostic) as ReceiptCheck["diagnostic"], proofHash: raw.proofHash as string | null };
}

export function validateSavedReceiptCandidates(raw: unknown, policy: PublicResearchPolicy, collection: TrustedCollection | null, now: number): SavedReceiptCandidate[] {
  if (!Array.isArray(raw) || raw.length > 2) return fail();
  const result = raw.map(entry => {
    if (!record(entry) || !exact(entry, "phase,requestId,candidateHash,status,attempts,nextCheckAt,receiptExpiresAt,diagnostic,proofHash,candidate,proof")) return fail();
    const candidate = validateReceiptCandidate(entry.candidate, policy, collection, now), candidateHash = publicResearchHash(candidate);
    if (typeof entry.requestId !== "string") return fail();
    const check = validateReceiptCheck(entry, candidate.phase, entry.requestId, candidateHash, policy);
    const proof = entry.proof === null ? null : validateGenerationRouteProof(entry.proof, receiptExpectation(candidate));
    if ((proof?.proofHash ?? null) !== check.proofHash || (check.status === "verified" && proof === null)) return fail();
    return { ...check, candidate, proof };
  });
  if (new Set(result.map(x => x.phase)).size !== result.length || new Set(result.map(x => x.requestId)).size !== result.length || new Set(result.map(x => x.candidate.providerRequestId)).size !== result.length) return fail();
  return result;
}

export function pendingReceiptResult(policy: PublicResearchPolicy, check: ReceiptCheck, now: number): PublicResearchPendingResult {
  return { status: "receipt_pending", policyId: policy.id, phase: check.phase, candidateHash: check.candidateHash, receiptStatus: check.status,
    attempts: check.attempts, nextCheckAt: check.nextCheckAt, receiptExpiresAt: check.receiptExpiresAt,
    canContinue: Date.parse(check.receiptExpiresAt) > now && ((["awaiting_receipt", "checking_receipt"].includes(check.status) && check.attempts < 3) ||
      (check.status === "verified" && (check.phase === "select" || now < Date.parse(policy.validUntil)))) };
}

/** Minimal in-memory compatibility projection for the existing proven source
 * assembler. Unused token counters are never persisted or reported as usage. */
export function receiptCandidateResponse(candidate: ReceiptCandidate): ModelProviderResponse {
  return { provider: candidate.phase === "search" ? "openrouter.exa" : "openrouter", providerRequestId: candidate.providerRequestId, providerModelId: candidate.providerModelId,
    output: candidate.phase === "search" ? { annotations: structuredClone(candidate.output) } : structuredClone(candidate.output) as JsonObject,
    latencyMs: 0, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0, reasoningTokens: 0, reportedCostUsd: candidate.reportedMicrousd / 1e6, estimatedCostUsd: 0 },
    metadata: candidate.phase === "search" ? { searchRequests: 1 } : {} };
}
