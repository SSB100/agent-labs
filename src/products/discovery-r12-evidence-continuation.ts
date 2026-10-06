import { containsCredentialLikeValue } from "../core/quest-intake";
import { discoveryV2Hash, validateDiscoveryIntentV2, type DiscoveryIntentV2 } from "./discovery-v2";
import { validateDiscoveryEvidenceAddendum, type DiscoveryEvidenceAddendum } from "./discovery-r12-evidence-addendum";
import type { AmendedDiscoveryScope } from "./discovery-r12-scope";
import { validateDiscoveryReviewContinuation, type DiscoveryReviewContinuation } from "./discovery-r12-review-continuation";

type ReviewSuccessor = Extract<DiscoveryReviewContinuation, { version: "r12.discovery-review-continuation.2" }>;
export type DiscoveryEvidenceContinuation = Omit<ReviewSuccessor, "version"> & {
  version: "r12.discovery-evidence-continuation.1";
  predecessorScopeId: string; predecessorScopeHash: string;
  executionSourceDomains: string[];
  addendum: DiscoveryEvidenceAddendum; addendumHash: string;
};
const fail = (): never => { throw Error("r12_evidence_continuation_unverified"); };
const uuid = (v: unknown) => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
export const isDiscoveryEvidenceContinuation = (value: { version: string }): value is DiscoveryEvidenceContinuation => value.version === "r12.discovery-evidence-continuation.1";

/** This adds analysis of reviewed facts after accepted NME; it does not retry a
 * failed review or edit the old result. SQL proves the completed predecessor,
 * stopped authorities, all settlements and fourth-plan-only constraint. */
export function validateDiscoveryEvidenceContinuation(value: DiscoveryEvidenceContinuation, source: AmendedDiscoveryScope, now: number) {
  if (!value || containsCredentialLikeValue(value) || !isDiscoveryEvidenceContinuation(value) ||
      !uuid(value.predecessorScopeId) || !hash(value.predecessorScopeHash) || !hash(value.addendumHash) ||
      value.reviewHistory?.length !== 2 || value.baseDispatches !== 6 || value.baseChildren !== 7) return fail();
  const { predecessorScopeId, predecessorScopeHash, executionSourceDomains, addendum, addendumHash, ...base } = value;
  validateDiscoveryReviewContinuation({ ...base, version: "r12.discovery-review-continuation.2" }, source, now);
  const previous = value.reviewHistory.at(-1)!;
  if (previous.scopeId !== predecessorScopeId || previous.scopeHash !== predecessorScopeHash || previous.planId !== value.predecessorPlanId ||
      !addendum || addendum.predecessorScopeId !== predecessorScopeId || addendum.businessId !== value.businessId || addendum.goalId !== value.goalId || addendumHash !== discoveryV2Hash(addendum) ||
      Date.parse(value.expiresAt) > Date.parse(addendum.expiresAt)) return fail();
  validateDiscoveryEvidenceAddendum(addendum, source.intent, now);
  const expectedDomains = [...new Set([...source.amendment.allowedDomains, ...addendum.observations.map(o => new URL(o.url).hostname.replace(/^www\./, ""))])].sort();
  if (expectedDomains.length > 8 || discoveryV2Hash(executionSourceDomains) !== discoveryV2Hash(expectedDomains)) return fail();
  return structuredClone(value);
}

export function discoveryEvidenceExecutionIntent(source: AmendedDiscoveryScope, continuation: DiscoveryEvidenceContinuation, now: number): DiscoveryIntentV2 {
  validateDiscoveryEvidenceContinuation(continuation, source, now);
  // The comparison universe and original source pack remain unchanged. The
  // separate addendum is not relabelled as a newly collected research pack.
  const intent = { ...structuredClone(source.intent), expiresAt: continuation.expiresAt };
  validateDiscoveryIntentV2(intent, now);
  return intent;
}
