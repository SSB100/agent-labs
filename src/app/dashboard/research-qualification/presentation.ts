import { RESEARCH_INFERENCE_ROUTE_FAILURE_CODES } from "../../../research/qualification-owner-contract";

/** UI labels never turn admission markers into validated success. */
type ProofState = {
  policy: { validFrom: string; validUntil: string; quoteValidUntil: string };
  status: string; revoked: boolean; expired: boolean; result: unknown | null;
  phases: Array<{ phase: string; marked: boolean }>;
  outcomeEvents?: unknown[]; terminalReconciliationRequired?: boolean;
};
export function researchProofState(entry: ProofState): string {
  if (entry.result) return "Complete · saved validated evidence";
  if (entry.revoked) return "Stopped · saved revocation";
  if (entry.outcomeEvents?.length) return "Held · saved outcome requires review";
  if (entry.expired) return "Expired";
  if (entry.status === "ready") return "Ready · pending proof";
  if (entry.status === "collection_ready") return "Pending evidence selection";
  if (entry.status === "search_recording_pending" || entry.status === "selection_recording_pending") return "Held · dispatched outcome unverified";
  return "Held · saved result unavailable";
}
export function researchWindowCurrent(policy: ProofState["policy"], now = Date.now()): boolean {
  const start = Date.parse(policy.validFrom), end = Date.parse(policy.validUntil), quoteEnd = Date.parse(policy.quoteValidUntil);
  return Number.isFinite(start) && Number.isFinite(end) && Number.isFinite(quoteEnd) && start <= now && end > now && quoteEnd > now;
}
export function canRunResearchProof(entry: ProofState, configured: boolean, hasUnknown: boolean, now = Date.now()): boolean {
  return researchWindowCurrent(entry.policy, now) && configured && !hasUnknown && !entry.revoked && !entry.expired && !entry.result &&
    !entry.terminalReconciliationRequired && !entry.outcomeEvents?.length &&
    (entry.status === "ready" || entry.status === "collection_ready") &&
    !entry.phases.some(phase => phase.marked && (phase.phase === "select" || entry.status === "ready"));
}

const outcomeReasons: Record<string, string> = {
  provider_response_invalid: "The provider response did not meet the required response format.",
  response_model_unqualified: "The returned model identity was not qualified by the reviewed quote.",
  response_provider_unqualified: "The recorded provider-identity check did not pass.",
  source_contract_invalid: "The returned sources did not pass the reviewed source checks.",
  collection_persistence_failed: "The validated source collection could not be confirmed in saved records.",
  selector_output_invalid: "The evidence-selection output did not pass validation.",
  result_persistence_failed: "The final evidence result could not be confirmed in saved records.",
  cost_unverified_or_over_cap: "The charge could not be verified within the approved limit. Unresolved liability remains held.",
  internal_failure: "The proof stopped at an internal validation or persistence boundary.",
  owner_stopped: "The owner requested Stop. Already-dispatched calls and their costs are retained.",
  legacy_failure_undetermined: "This historical attempt has no saved typed failure reason. Its original stop cause remains undetermined.",
};
const modelLabels: Record<string, string> = { request_alias: "approved request alias", canonical: "approved canonical model", other: "unqualified identity", missing: "not reported", invalid: "invalid identity" };
const providerLabels: Record<string, string> = { exact: "Azure label observed", other: "other label observed", missing: "not reported", invalid: "invalid label" };
const routeLabels: Record<string, string> = { unrequested: "not requested", verified: "verified generation-record provider/model", unavailable: "generation-record evidence unavailable", invalid: "generation-record evidence invalid" };
const finishLabels: Record<string, string> = { stop: "normal stop", length: "output limit", content_filter: "content filter", tool_calls: "tool calls", error: "provider error", other: "other finish reason", missing: "not reported" };
const label = (labels: Record<string, string>, value: unknown, fallback = "unavailable"): string => typeof value === "string" && Object.hasOwn(labels, value) ? labels[value] : fallback;
const record = (item: unknown): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item);
const count = (item: unknown): string => typeof item === "number" && Number.isSafeInteger(item) && item >= 0 && item <= 1_000_000 ? String(item) : "unavailable";

/** No raw error/provider text or unknown enum is ever interpolated. */
export function researchOutcomeDisclosure(value: unknown, allowedDomains: string[]): { title: string; reason: string; phase: string; createdAt: string | null; observations: string[] } | null {
  if (!record(value) || typeof value.kind !== "string" || !["failure", "owner_stopped"].includes(value.kind)) return null;
  const observations: string[] = [];
  if (record(value.observation)) {
    const o = value.observation;
    observations.push(`Model identity: ${label(modelLabels, o.modelIdentity)}`);
    observations.push(`Raw response-provider observation: ${label(providerLabels, o.providerIdentity)}`);
    if (typeof o.responseProviderHash === "string" && /^[a-f0-9]{64}$/.test(o.responseProviderHash)) observations.push(`Raw response-provider fingerprint: ${o.responseProviderHash}`);
    observations.push(`Generation-route evidence: ${o.inferenceRouteStatus === undefined ? "not recorded for this historical observation" : label(routeLabels, o.inferenceRouteStatus)}`);
    if (o.inferenceRouteStatus === "verified" && typeof o.inferenceRouteProofHash === "string" && /^[a-f0-9]{64}$/.test(o.inferenceRouteProofHash)) observations.push(`Generation-route proof fingerprint: ${o.inferenceRouteProofHash}`);
    if ((o.inferenceRouteStatus === "unavailable" || o.inferenceRouteStatus === "invalid") &&
        RESEARCH_INFERENCE_ROUTE_FAILURE_CODES.includes(o.inferenceRouteFailureCode as typeof RESEARCH_INFERENCE_ROUTE_FAILURE_CODES[number])) {
      observations.push(`Generation receipt failure: ${o.inferenceRouteFailureCode}`);
      observations.push(`Generation receipt HTTP status: ${typeof o.inferenceRouteHttpStatus === "number" && Number.isSafeInteger(o.inferenceRouteHttpStatus) && o.inferenceRouteHttpStatus >= 100 && o.inferenceRouteHttpStatus <= 599 ? o.inferenceRouteHttpStatus : "not recorded"}`);
      observations.push(`Generation receipt attempts: ${typeof o.inferenceRouteAttempts === "number" && Number.isSafeInteger(o.inferenceRouteAttempts) && o.inferenceRouteAttempts >= 0 && o.inferenceRouteAttempts <= 3 ? o.inferenceRouteAttempts : "not recorded"}`);
    }
    observations.push(`Finish reason: ${label(finishLabels, o.finishReason)}`);
    observations.push(`Search requests: ${count(o.searchRequests)}; citation annotations: ${count(o.annotationCount)}`);
    observations.push(`Rejected source domains: ${count(o.rejectedDomainCount)}; malformed annotations: ${count(o.malformedAnnotationCount)}`);
    if (Array.isArray(o.approvedDomainCounts)) {
      for (const item of o.approvedDomainCounts.slice(0, 6)) {
        if (record(item) && typeof item.domain === "string" && allowedDomains.includes(item.domain)) observations.push(`Approved source ${item.domain}: ${count(item.count)}`);
      }
    }
    if (o.providerError !== null && o.providerError !== undefined) observations.push("A classified provider error was recorded; raw provider text is withheld.");
  }
  return {
    title: value.kind === "owner_stopped" ? "Saved owner Stop" : "Saved proof failure",
    reason: label(outcomeReasons, value.reason, "The saved failure classification is unavailable. No retry is authorized."),
    phase: value.phase === "search" ? "Search" : value.phase === "select" ? "Evidence selection" : "Proof control",
    createdAt: typeof value.createdAt === "string" && Number.isFinite(Date.parse(value.createdAt)) ? new Date(value.createdAt).toISOString() : null,
    observations,
  };
}

export function researchContinuationReason(reason: unknown): string {
  const reasons: Record<string, string> = {
    unknown_exposure: "An unresolved charge must be reconciled before a new proof can be prepared.",
    unresolved_exposure: "An unresolved charge must be reconciled before a new proof can be prepared.",
    predecessor_active: "The previous proof must be stopped before a continuation can be reviewed.",
    terminal_reconciliation_required: "Reconcile the saved Stop below before preparing a continuation.",
    budget_exhausted: "The existing Business lifetime cap has no remaining allowance.",
    continuation_exists: "A continuation is already recorded. Review its saved state before proceeding.",
  };
  return label(reasons, reason, "Continuation preparation is held until the exact saved authority, charge and Stop records can be verified.");
}
export function formatResearchUsd(value: string | number): string {
  const digits = String(value);
  if (!/^\d+$/.test(digits)) return "Amount unavailable";
  const padded = digits.replace(/^0+(?=\d)/, "").padStart(7, "0");
  const whole = padded.slice(0, -6), fractional = padded.slice(-6).replace(/0+$/, "").padEnd(2, "0");
  return `$${whole}.${fractional} USD`;
}
export function safeResearchSourceUrl(value: string, allowedDomains: string[]): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && allowedDomains.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`)) ? url.href : null;
  } catch { return null; }
}

/** Exact saved confirmation content; absent monetary/scope disclosure stays inert. */
export function researchGrantDisclosure(value: unknown, kind: "initial" | "continuation" = "initial"): {
  businessContent: Record<string, unknown>; goalContent: Record<string, unknown>; operatingPolicy: Record<string, unknown>;
  expectedExposureMicrounits: string; policyLimitMicrounits: string; businessLifetimeLimitMicrounits: string;
  continuation: Record<string, unknown> | null;
} | null {
  if (!record(value) || !record(value.businessContent) || !record(value.goalContent) || !record(value.operatingPolicy)) return null;
  const operating = value.operatingPolicy;
  if (operating.currency !== "USD" || ![operating.expectedExposureMicrounits, operating.policyLimitMicrounits, operating.businessLifetimeLimitMicrounits].every(amount => typeof amount === "string" && /^(0|[1-9][0-9]*)$/.test(amount))) return null;
  if (!record(value.researchPolicy) || !Number.isSafeInteger(value.researchPolicy.maximumMicrousd) ||
    String(value.researchPolicy.maximumMicrousd) !== operating.policyLimitMicrounits || operating.maximumDispatches !== 2) return null;
  const continuation = kind === "continuation" ? value.continuation : null;
  if (kind === "continuation") {
    if (!record(continuation) || ![continuation.predecessorPolicyId, continuation.predecessorWorkflowRunId, continuation.goalId, continuation.currentOperatingPolicyId].every(id => typeof id === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)) ||
      ![continuation.goalRevision, continuation.businessRevision, continuation.capRevision].every(revision => Number.isSafeInteger(revision) && Number(revision) >= 1) ||
      ![continuation.lifetimeCapMicrounits, continuation.exposureMicrounits, continuation.remainingMicrounits].every(amount => typeof amount === "string" && /^(0|[1-9][0-9]*)$/.test(amount))) return null;
    if (continuation.lifetimeCapMicrounits !== operating.businessLifetimeLimitMicrounits || continuation.exposureMicrounits !== operating.expectedExposureMicrounits ||
      BigInt(continuation.lifetimeCapMicrounits as string) - BigInt(continuation.exposureMicrounits as string) !== BigInt(continuation.remainingMicrounits as string) ||
      BigInt(operating.policyLimitMicrounits as string) > BigInt(continuation.remainingMicrounits as string)) return null;
  }
  return { businessContent: value.businessContent, goalContent: value.goalContent, operatingPolicy: operating,
    continuation: record(continuation) ? continuation : null,
    expectedExposureMicrounits: operating.expectedExposureMicrounits as string, policyLimitMicrounits: operating.policyLimitMicrounits as string, businessLifetimeLimitMicrounits: operating.businessLifetimeLimitMicrounits as string };
}

/** A historical metadata read needs the saved settled receipt, not live authority. */
export function canVerifySavedInferenceRoute(phase: { requestId: string; marked: boolean; settled: boolean; providerRequestId: string | null }): boolean {
  return phase.marked && phase.settled && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(phase.requestId) &&
    typeof phase.providerRequestId === "string" && /^gen-[A-Za-z0-9_-]{1,296}$/.test(phase.providerRequestId);
}
