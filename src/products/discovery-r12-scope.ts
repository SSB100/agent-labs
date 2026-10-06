import { canonicalSourceDomains } from "../core/external-eligibility";
import { containsCredentialLikeValue } from "../core/quest-intake";
import { R11_RESTRICTED_SOURCE_DOMAINS } from "../research/qualification";
import { discoveryV2Hash, validateDiscoveryIntentV2, type DiscoveryIntentV2 } from "./discovery-v2";

/** An append-only amendment of permitted sources, never a replacement funding
 * root or permission to dispatch. SQL independently resolves the original rows. */
export type DiscoverySourceScopeAmendment = {
  version: "r12.discovery-source-scope.1";
  id: string;
  businessId: string;
  goalId: string;
  budgetAuthorityRootId: string;
  priorRoundId: string;
  originalIntentHash: string;
  originalSemanticGoalHash: string;
  allowedDomains: string[];
  excludedDomains: string[];
  sourceReviews: Array<{ domain: string; basis: "documented_api_factual_snippets"; reviewHash: string }>;
  approvalHash: string;
  independentReviewHash: string;
  purposeReviewHash: string;
  createdAt: string;
  expiresAt: string;
};
export type DiscoveryOriginalScope = {
  businessId: string;
  budgetAuthorityRootId: string;
  priorRoundId: string;
  semanticGoalHash: string;
  priorIntent: DiscoveryIntentV2;
  maximumMicrousd: number;
  committedMicrousd: number;
  hasUncertainCosts: boolean;
};
export type AmendedDiscoveryScope = {
  amendment: DiscoverySourceScopeAmendment;
  amendmentHash: string;
  intent: DiscoveryIntentV2;
  intentHash: string;
  budgetAuthorityRootId: string;
  originalSemanticGoalHash: string;
  priorRoundId: string;
  remainingMicrousd: number;
  executionAuthorized: false;
};
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const fail = (): never => { throw new Error("r12_discovery_scope_unavailable"); };
const within = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);
const exact = (value: object, keys: string) => { if (Object.keys(value).sort().join(",") !== keys.split(",").sort().join(",")) fail(); };
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 2_000_000;

/** Historical intent validation does not renew the old intent or its sources.
 * Source freshness is checked again when evidence is read, never changed here. */
export function prepareAmendedDiscoveryScope(original: DiscoveryOriginalScope, amendment: DiscoverySourceScopeAmendment, now = Date.now()): AmendedDiscoveryScope {
  if (!original || !amendment || !Number.isFinite(now) || containsCredentialLikeValue({ original, amendment })) return fail();
  const prior = structuredClone(original), change = structuredClone(amendment);
  exact(prior, "businessId,budgetAuthorityRootId,priorRoundId,semanticGoalHash,priorIntent,maximumMicrousd,committedMicrousd,hasUncertainCosts");
  exact(change, "version,id,businessId,goalId,budgetAuthorityRootId,priorRoundId,originalIntentHash,originalSemanticGoalHash,allowedDomains,excludedDomains,sourceReviews,approvalHash,independentReviewHash,purposeReviewHash,createdAt,expiresAt");
  if (![prior.businessId, prior.budgetAuthorityRootId, prior.priorRoundId, change.id, change.businessId, change.goalId, change.budgetAuthorityRootId, change.priorRoundId].every(v => typeof v === "string" && UUID.test(v))) return fail();
  if (![prior.semanticGoalHash, change.originalIntentHash, change.originalSemanticGoalHash, change.approvalHash, change.independentReviewHash, change.purposeReviewHash].every(v => typeof v === "string" && HASH.test(v))) return fail();
  if (!integer(prior.maximumMicrousd) || !integer(prior.committedMicrousd) || prior.maximumMicrousd < 1 || prior.committedMicrousd >= prior.maximumMicrousd || prior.hasUncertainCosts !== false) return fail();
  const historicalExpiry = Date.parse(prior.priorIntent?.expiresAt);
  if (!Number.isFinite(historicalExpiry)) return fail();
  validateDiscoveryIntentV2(prior.priorIntent, historicalExpiry - 1);
  if (change.version !== "r12.discovery-source-scope.1" || change.id === prior.priorRoundId || change.id === prior.budgetAuthorityRootId ||
      change.businessId !== prior.businessId || prior.priorIntent.businessId !== prior.businessId || prior.priorIntent.id !== prior.priorRoundId ||
      change.priorRoundId !== prior.priorRoundId || change.budgetAuthorityRootId !== prior.budgetAuthorityRootId || change.originalSemanticGoalHash !== prior.semanticGoalHash ||
      change.originalIntentHash !== discoveryV2Hash(prior.priorIntent) || prior.priorIntent.limits.maximumMicrousd > prior.maximumMicrousd) return fail();
  const start = Date.parse(change.createdAt), end = Date.parse(change.expiresAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > now || end <= now || end <= start || end > start + 24 * 60 * 60_000) return fail();
  const allowed = canonicalSourceDomains(change.allowedDomains), excluded = canonicalSourceDomains(change.excludedDomains);
  if (allowed.length > 4 || !R11_RESTRICTED_SOURCE_DOMAINS.every(domain => excluded.includes(domain)) ||
      [...allowed, ...excluded].some(domain => domain.endsWith(".local") || domain.endsWith(".internal")) || allowed.some(domain => excluded.some(blocked => within(domain, blocked) || within(blocked, domain)))) return fail();
  if (!Array.isArray(change.sourceReviews) || change.sourceReviews.length !== allowed.length || new Set(change.sourceReviews.map(review => review.domain)).size !== allowed.length) return fail();
  for (const review of change.sourceReviews) {
    exact(review, "domain,basis,reviewHash");
    if (!allowed.includes(review.domain) || review.basis !== "documented_api_factual_snippets" || !HASH.test(review.reviewHash)) return fail();
  }
  // Only the exact source list, new round identity, finite collection count and
  // freshness window change. Scope/candidates/allowance cannot be widened.
  const intent: DiscoveryIntentV2 = { ...prior.priorIntent, id: change.id,
    comparisonUniverse: { ...prior.priorIntent.comparisonUniverse, sourceDomains: [...change.allowedDomains] },
    limits: { ...prior.priorIntent.limits, maximumNewCollections: 1 }, expiresAt: change.expiresAt };
  validateDiscoveryIntentV2(intent, now);
  return { amendment: change, amendmentHash: discoveryV2Hash(change), intent, intentHash: discoveryV2Hash(intent),
    budgetAuthorityRootId: prior.budgetAuthorityRootId, originalSemanticGoalHash: prior.semanticGoalHash, priorRoundId: prior.priorRoundId,
    remainingMicrousd: prior.maximumMicrousd - prior.committedMicrousd, executionAuthorized: false };
}
