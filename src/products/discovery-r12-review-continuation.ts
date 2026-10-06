import { containsCredentialLikeValue } from "../core/quest-intake";
import { discoveryV2Hash, validateDiscoveryIntentV2, type DiscoveryIntentV2 } from "./discovery-v2";
import type { AmendedDiscoveryScope, DiscoverySourceScopeAmendment } from "./discovery-r12-scope";

export const DISCOVERY_R12_REUSED_PHASES = ["plan", "search1", "select1", "strategy"] as const;
export type DiscoveryReviewContinuation = {
  version: "r12.discovery-review-continuation.1";
  id: string; businessId: string; goalId: string; budgetAuthorityRootId: string; priorRoundId: string;
  sourceScopeId: string; sourceScopeHash: string; sourcePlanId: string; sourcePlanHash: string; sourceReviewAttemptId: string;
  sourcePhases: Array<{ stepKey: typeof DISCOVERY_R12_REUSED_PHASES[number]; attemptId: string; artifactId: string; responseHash: string }>;
  baseDispatches: 4; baseChildren: 5; baseKnownMicrounits: string;
  allowedDomains: string[]; excludedDomains: string[]; approvedQuery: string;
  approvalHash: string; independentReviewHash: string; createdAt: string; expiresAt: string;
};
export type DiscoveryR12ExecutionScope = DiscoverySourceScopeAmendment | DiscoveryReviewContinuation;
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const fail = (): never => { throw Error("r12_saved_review_continuation_unverified"); };
const exact = (v: object, keys: string) => { if (Object.keys(v).sort().join(",") !== keys.split(",").sort().join(",")) fail(); };

/** A new execution envelope references the original source scope. It never
 * renews evidence or modifies the original intent, source amendment or outputs. */
export function validateDiscoveryReviewContinuation(value: DiscoveryReviewContinuation, source: AmendedDiscoveryScope, now: number): DiscoveryReviewContinuation {
  if (!value || !source || !Number.isFinite(now) || containsCredentialLikeValue(value)) return fail();
  exact(value, "version,id,businessId,goalId,budgetAuthorityRootId,priorRoundId,sourceScopeId,sourceScopeHash,sourcePlanId,sourcePlanHash,sourceReviewAttemptId,sourcePhases,baseDispatches,baseChildren,baseKnownMicrounits,allowedDomains,excludedDomains,approvedQuery,approvalHash,independentReviewHash,createdAt,expiresAt");
  if (value.version !== "r12.discovery-review-continuation.1" ||
      ![value.id, value.businessId, value.goalId, value.budgetAuthorityRootId, value.priorRoundId, value.sourceScopeId, value.sourcePlanId, value.sourceReviewAttemptId].every(uuid) ||
      ![value.sourceScopeHash, value.sourcePlanHash, value.approvalHash, value.independentReviewHash].every(hash) ||
      value.id === value.sourceScopeId || value.id === value.budgetAuthorityRootId || value.id === value.priorRoundId ||
      value.businessId !== source.amendment.businessId || value.goalId !== source.amendment.goalId || value.budgetAuthorityRootId !== source.budgetAuthorityRootId || value.priorRoundId !== source.priorRoundId ||
      value.sourceScopeId !== source.amendment.id || value.sourceScopeHash !== source.amendmentHash || value.sourceScopeHash !== discoveryV2Hash(source.amendment) ||
      value.baseDispatches !== 4 || value.baseChildren !== 5 || typeof value.baseKnownMicrounits !== "string" || !/^(0|[1-9][0-9]{0,6})$/.test(value.baseKnownMicrounits) || Number(value.baseKnownMicrounits) > 2_000_000) return fail();
  for (const key of ["allowedDomains", "excludedDomains", "approvedQuery"] as const) if (discoveryV2Hash(value[key]) !== discoveryV2Hash(source.amendment[key])) return fail();
  if (!Array.isArray(value.sourcePhases) || value.sourcePhases.length !== 4) return fail();
  const ids = new Set<string>();
  value.sourcePhases.forEach((phase, index) => {
    if (!phase) return fail();
    exact(phase, "stepKey,attemptId,artifactId,responseHash");
    if (phase.stepKey !== DISCOVERY_R12_REUSED_PHASES[index] || !uuid(phase.attemptId) || !uuid(phase.artifactId) || !hash(phase.responseHash) || ids.has(phase.attemptId) || phase.attemptId === value.sourceReviewAttemptId) return fail();
    ids.add(phase.attemptId);
  });
  const start = Date.parse(value.createdAt), end = Date.parse(value.expiresAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > now || end <= now || end <= start || end > start + 24 * 60 * 60_000) return fail();
  return structuredClone(value);
}

/** The execution view has a separately approved deadline. Original source
 * identity/times stay in source; downstream validation still checks every
 * evidence span and Knowledge entry at the actual new dispatch/receipt time. */
export function discoveryReviewExecutionIntent(source: AmendedDiscoveryScope, continuation: DiscoveryReviewContinuation, now: number): DiscoveryIntentV2 {
  validateDiscoveryReviewContinuation(continuation, source, now);
  const intent = { ...structuredClone(source.intent), expiresAt: continuation.expiresAt };
  validateDiscoveryIntentV2(intent, now);
  return intent;
}
