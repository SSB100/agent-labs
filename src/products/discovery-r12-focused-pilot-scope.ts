import { containsCredentialLikeValue } from "../core/quest-intake";
import { R11_RESTRICTED_SOURCE_DOMAINS } from "../research/qualification";
import { discoveryV2Hash, validateDiscoveryIntentV2 } from "./discovery-v2";
import { validateFocusedPilotProfile, type FocusedPilotProfile, type ValidatedFocusedPilot } from "./discovery-r12-focused-pilot-contract";
import type { DiscoveryOriginalScope } from "./discovery-r12-scope";

/** A separately approved learning scope. Source-amendment-looking compatibility
 * fields below are persistence projections only; this is not a source amendment. */
export type DiscoveryFocusedPilot = {
  version: "r12.discovery-focused-pilot.1";
  id: string; businessId: string; goalId: string; originalGoalId: string;
  budgetAuthorityRootId: string; priorRoundId: string;
  profile: FocusedPilotProfile; profileHash: string;
  closedPlanId: string; closedPlanHash: string;
  acceptedReviewScopeId: string; acceptedReviewHash: string; acceptedReviewRecordHash: string;
  originalIntentHash: string; originalSemanticGoalHash: string;
  allowedDomains: string[]; excludedDomains: string[]; approvedQuery: string;
  approvalHash: string; independentReviewHash: string;
  createdAt: string; expiresAt: string;
};
export function isDiscoveryFocusedPilot(value: unknown): value is DiscoveryFocusedPilot {
  return !!value && typeof value === "object" && !Array.isArray(value) && (value as { version?: unknown }).version === "r12.discovery-focused-pilot.1";
}
const fail = (): never => { throw Error("r12_focused_pilot_scope_unverified"); };
const exact = (value: unknown, keys: string) => {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== keys.split(",").sort().join(",")) fail();
};
const id = (value: unknown) => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const hash = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

/** Call only with the immutable SQL scope/original-root join. This performs no
 * source-amendment projection, enrollment, provider request or authority write. */
export function validateDiscoveryFocusedPilot(raw: unknown, original: DiscoveryOriginalScope, now = Date.now()): ValidatedFocusedPilot {
  exact(raw, "version,id,businessId,goalId,budgetAuthorityRootId,priorRoundId,profile,profileHash,originalGoalId,closedPlanId,closedPlanHash,acceptedReviewScopeId,acceptedReviewHash,acceptedReviewRecordHash,originalIntentHash,originalSemanticGoalHash,allowedDomains,excludedDomains,approvedQuery,approvalHash,independentReviewHash,createdAt,expiresAt");
  exact(original, "businessId,budgetAuthorityRootId,priorRoundId,semanticGoalHash,priorIntent,maximumMicrousd,committedMicrousd,hasUncertainCosts");
  if (!isDiscoveryFocusedPilot(raw) || containsCredentialLikeValue(raw) || Buffer.byteLength(JSON.stringify(raw), "utf8") > 65536) return fail();
  const e = raw;
  if (![e.id, e.businessId, e.goalId, e.originalGoalId, e.budgetAuthorityRootId, e.priorRoundId, e.closedPlanId, e.acceptedReviewScopeId].every(id) ||
      ![e.profileHash, e.closedPlanHash, e.acceptedReviewHash, e.acceptedReviewRecordHash, e.originalIntentHash, e.originalSemanticGoalHash, e.approvalHash, e.independentReviewHash].every(hash) ||
      [e.goalId, e.originalGoalId, e.budgetAuthorityRootId, e.priorRoundId, e.acceptedReviewScopeId].includes(e.id) ||
      e.businessId !== original.businessId || e.budgetAuthorityRootId !== original.budgetAuthorityRootId || e.priorRoundId !== original.priorRoundId ||
      e.originalSemanticGoalHash !== original.semanticGoalHash || e.originalIntentHash !== discoveryV2Hash(original.priorIntent) ||
      original.maximumMicrousd !== 2_000_000 || original.priorIntent.limits.maximumMicrousd !== original.maximumMicrousd ||
      original.priorIntent.businessId !== original.businessId || original.priorIntent.id !== original.priorRoundId ||
      !Number.isSafeInteger(original.committedMicrousd) || original.committedMicrousd < 0 || original.committedMicrousd > original.maximumMicrousd || original.hasUncertainCosts !== false) return fail();
  const historicalExpiry = Date.parse(original.priorIntent.expiresAt);
  if (!Number.isFinite(historicalExpiry)) return fail();
  validateDiscoveryIntentV2(original.priorIntent, historicalExpiry - 1);
  const validated = validateFocusedPilotProfile(e.profile, { profileHash: e.profileHash, businessId: e.businessId, goalId: e.goalId,
    originalGoalId: e.originalGoalId, budgetAuthorityRootId: e.budgetAuthorityRootId, priorRoundId: e.priorRoundId,
    originalIntentHash: e.originalIntentHash, originalSemanticGoalHash: e.originalSemanticGoalHash,
    acceptedReviewScopeId: e.acceptedReviewScopeId, acceptedReviewHash: e.acceptedReviewHash, historicalRecordHash: e.acceptedReviewRecordHash,
    originalMaximumMicrousd: original.maximumMicrousd }, now);
  if (e.id !== validated.profile.id || e.createdAt !== validated.profile.createdAt || e.expiresAt !== validated.profile.expiresAt ||
      discoveryV2Hash(e.allowedDomains) !== discoveryV2Hash(validated.profile.intent.comparisonUniverse.sourceDomains) ||
      discoveryV2Hash(e.excludedDomains) !== discoveryV2Hash([...R11_RESTRICTED_SOURCE_DOMAINS]) || e.approvedQuery !== validated.profile.learningQuestion ||
      e.allowedDomains.some(domain => R11_RESTRICTED_SOURCE_DOMAINS.some(blocked => domain === blocked || domain.endsWith(`.${blocked}`))) ||
      validated.profile.observations.observations.some(observation => observation.countries.some(country => country !== "GB"))) return fail();
  return validated;
}
