import type { JsonObject } from "../core/contracts";
import type { PublicResearchPolicy } from "./qualification";
import type { PublicResearchQuote } from "./qualification-quote";
import type { EvidencePack } from "./types";

export const RESEARCH_FAILURE_REASONS = ["provider_response_invalid", "response_model_unqualified", "response_provider_unqualified", "source_contract_invalid", "collection_persistence_failed", "selector_output_invalid", "result_persistence_failed", "cost_unverified_or_over_cap", "internal_failure"] as const;
export type ResearchFailureReason = typeof RESEARCH_FAILURE_REASONS[number];
export type ResearchInferenceRouteStatus = "unrequested" | "verified" | "unavailable" | "invalid";
export const RESEARCH_INFERENCE_ROUTE_FAILURE_CODES = ["invalid_request", "configuration_unavailable", "transport_failure", "timeout", "redirect_rejected", "api_failure", "response_too_large", "json_invalid", "response_invalid", "generation_mismatch", "provider_mismatch", "model_mismatch", "provider_responses_invalid"] as const;
export type ResearchRouteFailureDetails = { code: typeof RESEARCH_INFERENCE_ROUTE_FAILURE_CODES[number]; httpStatus: number | null; attempts: number };
/** Read only bounded receipt diagnostics; never copy an error message or body. */
export function readResearchRouteFailureDetails(error: unknown): ResearchRouteFailureDetails | null {
  if (!error || typeof error !== "object" || Array.isArray(error)) return null;
  const value = error as Record<string, unknown>;
  if (value.name !== "GenerationRouteProofError" || !RESEARCH_INFERENCE_ROUTE_FAILURE_CODES.includes(value.code as ResearchRouteFailureDetails["code"]) ||
      !(value.httpStatus === null || (typeof value.httpStatus === "number" && Number.isSafeInteger(value.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599)) ||
      typeof value.attempts !== "number" || !Number.isSafeInteger(value.attempts) || value.attempts < 0 || value.attempts > 3) return null;
  return { code: value.code as ResearchRouteFailureDetails["code"], httpStatus: value.httpStatus as number | null, attempts: value.attempts };
}
export type ResearchObservation = {
  modelIdentity: "request_alias" | "canonical" | "other" | "missing" | "invalid";
  observedModelId: string | null;
  providerIdentity: "exact" | "other" | "missing" | "invalid";
  observedProvider: string | null;
  finishReason: "stop" | "length" | "content_filter" | "tool_calls" | "error" | "other" | "missing";
  searchRequests: number | null; annotationCount: number | null;
  approvedDomainCounts: { domain: string; count: number }[];
  rejectedDomainCount: number; malformedAnnotationCount: number;
  providerError: string | null;
  /** Absent together only on historical observations. Never retain an unknown label. */
  responseProviderHash?: string | null;
  inferenceRouteStatus?: ResearchInferenceRouteStatus;
  inferenceRouteProofHash?: string | null;
  /** Failure-only receipt diagnostics; absent together on historical observations. */
  inferenceRouteFailureCode?: typeof RESEARCH_INFERENCE_ROUTE_FAILURE_CODES[number] | null;
  inferenceRouteHttpStatus?: number | null;
  inferenceRouteAttempts?: number | null;
};
export type ResearchOutcomeEvent = { outcomeId: string; kind: "failure" | "owner_stopped";
  phase: "none" | "search" | "select"; requestId: string | null;
  reason: ResearchFailureReason | "owner_stopped" | "legacy_failure_undetermined";
  observation: ResearchObservation | null; createdAt: string };
export type ResearchContinuation = {
  predecessorPolicyId: string; predecessorWorkflowRunId: string; currentOperatingPolicyId: string;
  goalId: string; goalRevision: number; businessRevision: number; capRevision: number;
  lifetimeCapMicrounits: string; exposureMicrounits: string; remainingMicrounits: string;
  eligible: boolean; reason: string;
};

export type ResearchProofPhase = { phase: "search" | "select"; requestId: string; marked: boolean; settled: boolean;
  actualMicrounits: string | null; providerRequestId: string | null };
export type ResearchProofResult = { resultId: string; evidencePack: EvidencePack; evidencePackHash: string;
  collectionId: string; selectorRequestId: string; providerRequestId: string; createdAt: string };
export type ResearchProofPolicy = { policyId: string; workflowRunId: string; goalId: string; operatingPolicyId: string;
  policy: PublicResearchPolicy; policyHash: string; status: string; revoked: boolean; expired: boolean;
  phases: ResearchProofPhase[]; result: ResearchProofResult | null;
  attemptVersion?: 1 | 2; outcomeEvents?: ResearchOutcomeEvent[]; terminalReconciliationRequired?: boolean };
export type ResearchGrantPolicySummary = Pick<PublicResearchPolicy, "query" | "allowedDomains" | "excludedDomains" | "modelId" | "providerEndpoint" | "maximumMicrousd" | "validFrom" | "validUntil" | "quoteValidUntil">;
export type ResearchProofGrant = { grantId: string; grantHash: string; grant: JsonObject & { researchPolicy: JsonObject & ResearchGrantPolicySummary }; used: boolean; expired: boolean; revoked: boolean; kind?: "initial" | "continuation" };
export type ResearchQualificationWorkspace = { businessId: string; ownerId: string; unavailable: boolean; configured: boolean;
  exposure: { currency: "USD"; heldMicrounits: string; hasUnknown: boolean };
  policies: ResearchProofPolicy[]; grants: ResearchProofGrant[]; policyTotal: number; grantTotal: number;
  continuation?: ResearchContinuation | null };
export type ResearchBootstrapPreparation = {
  version: "r11.owner-proof-preparation.1" | "r11.owner-proof-preparation.2" | "r11.owner-proof-preparation.3"; businessId: string; ownerId: string; policyId: string; workflowRunId: string;
  serverKeyHash: string; runtimeCapabilityHash: string; preparedAt: string; expiresAt: string;
  quote: PublicResearchQuote; sourceProfile: JsonObject; search: { requestHash: string; wireHash: string; wireBytes: number; maxTokens: number };
  authorityCreated: false; paidCalls: 0;
  mode?: "initial" | "continuation"; predecessorPolicyId?: string | null; continuation?: ResearchContinuation | null;
};
