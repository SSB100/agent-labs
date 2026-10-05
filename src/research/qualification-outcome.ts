import { createHash } from "node:crypto";
import { MODEL_PROVIDER_FAILURE_CATEGORIES } from "../models/types";
import { RESEARCH_INFERENCE_ROUTE_FAILURE_CODES, type ResearchFailureReason, type ResearchObservation } from "./qualification-owner-contract";

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const fail = (): never => { throw new Error("public_research_observation_invalid"); };
const within = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);
const count = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 1000 ? value : null;
const FINISH_REASONS = ["stop", "length", "content_filter", "tool_calls", "error", "other", "missing"] as const;
const OBSERVATION_KEYS = "modelIdentity,observedModelId,providerIdentity,observedProvider,finishReason,searchRequests,annotationCount,approvedDomainCounts,rejectedDomainCount,malformedAnnotationCount,providerError";
const DIAGNOSTIC_KEYS = "responseProviderHash,inferenceRouteStatus,inferenceRouteProofHash";
const RECEIPT_FAILURE_KEYS = "inferenceRouteFailureCode,inferenceRouteHttpStatus,inferenceRouteAttempts";
const ROUTE_STATUSES = ["unrequested", "verified", "unavailable", "invalid"] as const;
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
// Bound work before hashing; use the complete label, never a truncated prefix.
const responseProviderHash = (value: unknown): string | null => typeof value === "string" && value.length <= 300 && Buffer.byteLength(value, "utf8") <= 300
  ? createHash("sha256").update(value, "utf8").digest("hex") : null;
const exactKeys = (value: object, keys: string) => Object.keys(value).sort().join(",") === keys.split(",").sort().join(",");
/** The historical persisted-reader default is deliberately one reviewed mapping,
 * not a prefix/date matcher. New runtime observations use the verified quote. */
const reviewedModels = (modelId: string): readonly string[] => modelId === "openai/gpt-5.6-luna"
  ? [modelId, "openai/gpt-5.6-luna-20260709"] : [modelId];

export function validateResearchResponseModelIds(modelId: string, acceptedResponseModelIds: readonly string[]): readonly string[] {
  if (!Array.isArray(acceptedResponseModelIds) || acceptedResponseModelIds.length < 1 || acceptedResponseModelIds.length > 2 ||
      acceptedResponseModelIds[0] !== modelId || new Set(acceptedResponseModelIds).size !== acceptedResponseModelIds.length ||
      acceptedResponseModelIds.some(value => typeof value !== "string" || value.length > 300 || !/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(value))) return fail();
  return [...acceptedResponseModelIds];
}

/** Strict read boundary for immutable outcome records. Unknown identity strings,
 * provider messages, URLs, excerpts and extra fields can never pass this parser. */
export function validateResearchObservation(value: unknown, allowedDomains: readonly string[], modelId: string,
  acceptedResponseModelIds: readonly string[] = reviewedModels(modelId)): ResearchObservation {
  const accepted = validateResearchResponseModelIds(modelId, acceptedResponseModelIds);
  if (!record(value) || !(exactKeys(value, OBSERVATION_KEYS) || exactKeys(value, `${OBSERVATION_KEYS},${DIAGNOSTIC_KEYS}`) || exactKeys(value, `${OBSERVATION_KEYS},${DIAGNOSTIC_KEYS},${RECEIPT_FAILURE_KEYS}`)) ||
      !["request_alias", "canonical", "other", "missing", "invalid"].includes(String(value.modelIdentity)) ||
      !["exact", "other", "missing", "invalid"].includes(String(value.providerIdentity)) ||
      !FINISH_REASONS.includes(value.finishReason as ResearchObservation["finishReason"]) ||
      !(value.searchRequests === null || count(value.searchRequests) !== null) || !(value.annotationCount === null || count(value.annotationCount) !== null) ||
      count(value.rejectedDomainCount) === null || count(value.malformedAnnotationCount) === null ||
      !(value.providerError === null || MODEL_PROVIDER_FAILURE_CATEGORIES.includes(value.providerError as typeof MODEL_PROVIDER_FAILURE_CATEGORIES[number]))) return fail();
  if (Object.hasOwn(value, "inferenceRouteStatus")) {
    if (!(value.responseProviderHash === null || hash(value.responseProviderHash)) ||
        !ROUTE_STATUSES.includes(value.inferenceRouteStatus as typeof ROUTE_STATUSES[number]) ||
        (value.inferenceRouteStatus === "verified" ? !hash(value.inferenceRouteProofHash) : value.inferenceRouteProofHash !== null) ||
        (value.providerIdentity === "missing" && value.responseProviderHash !== null) ||
        (value.providerIdentity === "exact" && value.responseProviderHash !== responseProviderHash("Azure"))) return fail();
  }
  if (Object.hasOwn(value, "inferenceRouteFailureCode")) {
    if (value.inferenceRouteFailureCode === null) {
      if (value.inferenceRouteHttpStatus !== null || value.inferenceRouteAttempts !== null) return fail();
    } else if (!RESEARCH_INFERENCE_ROUTE_FAILURE_CODES.includes(value.inferenceRouteFailureCode as typeof RESEARCH_INFERENCE_ROUTE_FAILURE_CODES[number]) ||
        !["unavailable", "invalid"].includes(String(value.inferenceRouteStatus)) ||
        !(value.inferenceRouteHttpStatus === null || (typeof value.inferenceRouteHttpStatus === "number" && Number.isSafeInteger(value.inferenceRouteHttpStatus) && value.inferenceRouteHttpStatus >= 100 && value.inferenceRouteHttpStatus <= 599)) ||
        typeof value.inferenceRouteAttempts !== "number" || !Number.isSafeInteger(value.inferenceRouteAttempts) || value.inferenceRouteAttempts < 0 || value.inferenceRouteAttempts > 3) return fail();
  }
  if (value.modelIdentity === "request_alias" ? value.observedModelId !== modelId : value.modelIdentity === "canonical"
    ? accepted.length !== 2 || value.observedModelId !== accepted[1] : value.observedModelId !== null) return fail();
  if (value.providerIdentity === "exact" ? value.observedProvider !== "Azure" : value.observedProvider !== null) return fail();
  if (!Array.isArray(value.approvedDomainCounts) || value.approvedDomainCounts.length !== allowedDomains.length || new Set(allowedDomains).size !== allowedDomains.length) return fail();
  let total = Number(value.rejectedDomainCount) + Number(value.malformedAnnotationCount);
  for (const [index, row] of value.approvedDomainCounts.entries()) {
    if (!record(row) || !exactKeys(row, "domain,count") || row.domain !== allowedDomains[index] || count(row.count) === null) return fail();
    total += Number(row.count);
  }
  if (total > 1000 || (value.annotationCount !== null && total !== value.annotationCount)) return fail();
  return structuredClone(value) as ResearchObservation;
}

export type ResearchObservationContext = { modelId: string; acceptedResponseModelIds: readonly string[];
  allowedDomains: readonly string[]; excludedDomains: readonly string[] };

/** Called on the original parsed provider envelope, before adapter validators or
 * annotation filtering. It retains categories/counts and bounded label hashes
 * only, never response text or unrecognized provider labels. */
export function observePublicResearchResponse(raw: unknown, context: ResearchObservationContext,
  providerError: unknown = null): ResearchObservation {
  const accepted = validateResearchResponseModelIds(context.modelId, context.acceptedResponseModelIds);
  const body = record(raw) ? raw : {}, choices = Array.isArray(body.choices) ? body.choices : [];
  const choice = record(choices[0]) ? choices[0] : {}, message = record(choice.message) ? choice.message : {};
  const usage = record(body.usage) ? body.usage : {};
  const toolUsage = record(usage.server_tool_use_details) ? usage.server_tool_use_details : record(usage.server_tool_use) ? usage.server_tool_use : {};
  const providerHash = responseProviderHash(body.provider);
  const modelIdentity: ResearchObservation["modelIdentity"] = body.model === undefined || body.model === null ? "missing"
    : typeof body.model !== "string" || !body.model ? "invalid" : body.model === context.modelId ? "request_alias"
    : accepted.length === 2 && body.model === accepted[1] ? "canonical" : "other";
  const providerIdentity: ResearchObservation["providerIdentity"] = body.provider === undefined || body.provider === null ? "missing"
    : typeof body.provider !== "string" || !body.provider ? "invalid" : body.provider === "Azure" ? "exact" : "other";
  const finishReason: ResearchObservation["finishReason"] = choice.finish_reason === undefined || choice.finish_reason === null ? "missing"
    : FINISH_REASONS.slice(0, 5).includes(choice.finish_reason as "stop") ? choice.finish_reason as ResearchObservation["finishReason"] : "other";
  const annotations = Array.isArray(message.annotations) ? message.annotations : null;
  const observation: ResearchObservation = { modelIdentity, observedModelId: modelIdentity === "request_alias" || modelIdentity === "canonical" ? String(body.model) : null,
    providerIdentity, observedProvider: providerIdentity === "exact" ? "Azure" : null, finishReason,
    searchRequests: count(toolUsage.web_search_requests), annotationCount: annotations === null ? null : count(annotations.length),
    approvedDomainCounts: context.allowedDomains.map(domain => ({ domain, count: 0 })), rejectedDomainCount: 0, malformedAnnotationCount: 0,
    providerError: MODEL_PROVIDER_FAILURE_CATEGORIES.includes(providerError as typeof MODEL_PROVIDER_FAILURE_CATEGORIES[number]) ? String(providerError) : null,
    responseProviderHash: providerHash, inferenceRouteStatus: "unrequested", inferenceRouteProofHash: null,
    inferenceRouteFailureCode: null, inferenceRouteHttpStatus: null, inferenceRouteAttempts: null };
  for (const annotation of annotations?.slice(0, 1000) ?? []) {
    if (!record(annotation) || annotation.type !== "url_citation" || !record(annotation.url_citation) ||
        typeof annotation.url_citation.url !== "string" || typeof annotation.url_citation.content !== "string" || annotation.url_citation.content.replace(/\s+/g, " ").trim().length < 30) {
      observation.malformedAnnotationCount++; continue;
    }
    let url: URL; try { url = new URL(annotation.url_citation.url); } catch { observation.malformedAnnotationCount++; continue; }
    if (url.protocol !== "https:" || url.username || url.password || url.port || [...url.searchParams.keys()].some(key => /^(token|access_token|api_key|auth|password)$/i.test(key))) {
      observation.malformedAnnotationCount++; continue;
    }
    const approved = observation.approvedDomainCounts.find(row => within(url.hostname, row.domain));
    if (!approved || context.excludedDomains.some(domain => within(url.hostname, domain))) observation.rejectedDomainCount++;
    else approved.count++;
  }
  return validateResearchObservation(observation, context.allowedDomains, context.modelId, accepted);
}

export class PublicResearchQualificationError extends Error {
  constructor(readonly reason: ResearchFailureReason, readonly phase: "none" | "search" | "select", readonly requestId: string | null,
    readonly observation: ResearchObservation | null, readonly outcomeId: string | null = null, readonly recorded = false) {
    super("public_research_qualification_stopped");
    this.name = "PublicResearchQualificationError";
  }
}

/** This invocation never acquired the current phase. It cannot revoke/journal
 * another caller's marker, and the UI must read back that caller's durable state. */
export class PublicResearchQualificationUnacquiredError extends Error {
  constructor() {
    super("public_research_qualification_unacquired");
    this.name = "PublicResearchQualificationUnacquiredError";
  }
}
