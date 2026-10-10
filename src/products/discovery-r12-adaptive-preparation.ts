import { containsCredentialLikeValue } from "../core/quest-intake";
import { discoveryV2Hash } from "./discovery-v2";
import { validateAdaptiveOwnerResearchProfile, selectAdaptiveOwnerResearchPublicScope,
  type AdaptiveOwnerResearchProfile, type OwnerResearchPublicSelection } from "./discovery-r12-goal-scope";
import { validateOwnerEpisodeClosure, type OwnerEpisodeClosure } from "./discovery-r12-owner-episode";
import { validateAdaptiveResearchQuote, type AdaptiveResearchQuote } from "./discovery-r12-adaptive-quote";
import { validateAdaptiveResearchPreview, type AdaptiveResearchPreview } from "./discovery-r12-adaptive-scope";
import { validateOwnerObservationSelection, type OwnerObservationSelection } from "./discovery-r12-owner-observation";

export type AdaptiveResearchPreparationInput = OwnerResearchPublicSelection & {
  businessId: string; goalId: string; goalRevision: number;
  profileId: string; profileHash: string; grantId: string;
  predecessorPlanId: string; predecessorPlanHash: string; predecessorScopeId: string; predecessorScopeHash: string;
  maximumActions: number; maximumRunMicrounits: string;
  businessLifetimeLimitMicrounits: string; researchLifetimeLimitMicrounits: string; submissionId: string;
  ownerObservationRef: OwnerObservationSelection | null;
};
export type AdaptivePreparationSnapshot = {
  predecessor: OwnerEpisodeClosure;
  imports: AdaptiveResearchPreview["imports"];
  profile: AdaptiveOwnerResearchProfile;
  quote: AdaptiveResearchQuote;
  /** Newly reviewed run authority on the existing consumed grant root. */
  grant: { id: string; profileId: string; businessId: string; goalId: string; goalRevision: number; goalHash: string;
    approvalHash: string; allowsPaidFollowups: boolean; maximumActions: number; maximumRunMicrounits: string;
    remainingScopes: number; remainingAllocationMicrounits: string; expiresAt: string };
  funding: Omit<AdaptiveResearchPreview["funding"], "proposedLimitMicrounits">;
  business: Omit<AdaptiveResearchPreview["business"], "proposedLimitMicrounits">;
  deadline: string;
  /** Validated from immutable owner storage, never copied from request input. */
  ownerObservationRef?: OwnerObservationSelection | null;
};
const fail = (): never => { throw new Error("r12_adaptive_preparation_unverified"); };
const uuid = (v: unknown) => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const money = (v: unknown): bigint => typeof v === "string" && /^(0|[1-9][0-9]{0,15})$/.test(v) && BigInt(v) <= BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(v) : fail();

export function validateAdaptivePreparationInput(raw: unknown): AdaptiveResearchPreparationInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || containsCredentialLikeValue(raw) || Object.keys(raw).sort().join(",") !==
      "businessId,businessLifetimeLimitMicrounits,goalId,goalRevision,grantId,marketSetKey,maximumActions,maximumRunMicrounits,ownerObservationRef,predecessorPlanHash,predecessorPlanId,predecessorScopeHash,predecessorScopeId,profileHash,profileId,researchLifetimeLimitMicrounits,submissionId,topicKey") return fail();
  const input = raw as AdaptiveResearchPreparationInput;
  if (![input.businessId,input.goalId,input.grantId,input.profileId,input.predecessorPlanId,input.predecessorScopeId,input.submissionId].every(uuid) ||
      ![input.profileHash,input.predecessorPlanHash,input.predecessorScopeHash].every(hash) ||
      !Number.isSafeInteger(input.goalRevision) || input.goalRevision < 1 || !Number.isSafeInteger(input.maximumActions) || input.maximumActions < 1 || input.maximumActions > 10 ||
      money(input.maximumRunMicrounits) < BigInt(1) || money(input.maximumRunMicrounits) > BigInt(10_000_000) ||
      money(input.businessLifetimeLimitMicrounits) < BigInt(1) || money(input.researchLifetimeLimitMicrounits) < BigInt(1) ||
      ![input.marketSetKey,input.topicKey].every(v => typeof v === "string" && /^[a-z][a-z0-9_-]{0,39}$/.test(v))) return fail();
  validateOwnerObservationSelection(input.ownerObservationRef);
  return structuredClone(input);
}

/** A read-only concrete bundle. It consumes no grant allocation and creates no
 * policy. Confirmation must reconstruct every snapshot under financial locks. */
export function prepareAdaptiveResearchPreview(raw: unknown, state: AdaptivePreparationSnapshot, now = Date.now()) {
  const input = validateAdaptivePreparationInput(raw), c = validateOwnerEpisodeClosure(state.predecessor);
  const ownerObservationRef=validateOwnerObservationSelection(state.ownerObservationRef ?? null);
  if (discoveryV2Hash(input.ownerObservationRef) !== discoveryV2Hash(ownerObservationRef)) return fail();
  const profile = validateAdaptiveOwnerResearchProfile(state.profile, now), quote = validateAdaptiveResearchQuote(state.quote, now);
  const ownerCapture = profile.version === "r12.owner-research-profile.3";
  if (quote.version !== (ownerCapture ? "r12.adaptive-quote.2" : "r12.adaptive-quote.1") ||
      ownerCapture && ownerObservationRef === null) return fail();
  const selection = selectAdaptiveOwnerResearchPublicScope(profile,{marketSetKey:input.marketSetKey,topicKey:input.topicKey},now);
  const g = state.grant;
  if (c.businessId !== input.businessId || c.goalId !== input.goalId || c.goalRevision !== input.goalRevision ||
      c.predecessorPlanId !== input.predecessorPlanId || c.predecessorPlanHash !== input.predecessorPlanHash ||
      c.predecessorScopeId !== input.predecessorScopeId || c.predecessorScopeHash !== input.predecessorScopeHash ||
      profile.id !== input.profileId || discoveryV2Hash(profile) !== input.profileHash ||
      !g || g.id !== input.grantId || g.profileId !== input.profileId || g.businessId !== input.businessId || g.goalId !== input.goalId ||
      g.goalRevision !== c.goalRevision || g.goalHash !== c.goalHash || !hash(g.approvalHash) || g.allowsPaidFollowups !== true ||
      !Number.isSafeInteger(g.maximumActions) || g.maximumActions < input.maximumActions || g.maximumActions > 10 ||
      !Number.isSafeInteger(g.remainingScopes) || g.remainingScopes < 1 ||
      money(g.maximumRunMicrounits) < money(input.maximumRunMicrounits) || money(g.remainingAllocationMicrounits) < money(input.maximumRunMicrounits) ||
      BigInt(profile.maximumRunMicrousd) < money(input.maximumRunMicrounits)) return fail();
  const times = [state.deadline,g.expiresAt,profile.validUntil].map(value=>Date.parse(value));
  if (times.some(time=>!Number.isFinite(time) || time<=now)) return fail();
  const requiredLimit = (ledger: AdaptivePreparationSnapshot["business"] | AdaptivePreparationSnapshot["funding"]) => {
    const required = money(ledger.committedMicrounits) + money(input.maximumRunMicrounits);
    const current = money(ledger.currentLimitMicrounits);
    return (required > current ? required : current).toString();
  };
  // The approved run authorizes only the necessary cumulative ceiling change.
  // Broader Business authority cannot be smuggled through this form.
  if (input.businessLifetimeLimitMicrounits !== requiredLimit(state.business) ||
      input.researchLifetimeLimitMicrounits !== requiredLimit(state.funding)) return fail();
  const preview: AdaptiveResearchPreview = {
    version:ownerCapture ? "r12.adaptive-research-preview.2" : "r12.adaptive-research-preview.1",businessId:input.businessId,goalId:input.goalId,
    predecessor:c,predecessorHash:discoveryV2Hash(c),imports:structuredClone(state.imports),
    profileId:profile.id,profileHash:input.profileHash,quoteHash:quote.quoteHash,ownerObservationRef,
    expiresAt:new Date(Math.min(...times)).toISOString(),maximumActions:input.maximumActions,maximumPaidCalls:64-c.baseDispatches,
    maximumNewChildren:ownerCapture ? 3 : 5,maximumRunMicrounits:input.maximumRunMicrounits,
    funding:{...state.funding,proposedLimitMicrounits:input.researchLifetimeLimitMicrounits},
    business:{capRevision:state.business.capRevision,committedMicrounits:state.business.committedMicrounits,
      currentLimitMicrounits:state.business.currentLimitMicrounits,proposedLimitMicrounits:input.businessLifetimeLimitMicrounits,
      hasUnknown:state.business.hasUnknown},authorityCreated:false,
  };
  validateAdaptiveResearchPreview(preview,now);
  return {preview,selection,quote,grantId:input.grantId,approvalHash:g.approvalHash,submissionId:input.submissionId,ownerObservationRef,
    finance:{minimumBusinessLimitMicrounits:(money(state.business.committedMicrounits)+money(input.maximumRunMicrounits)).toString(),
      minimumResearchLimitMicrounits:(money(state.funding.committedMicrounits)+money(input.maximumRunMicrounits)).toString(),
      changesBusinessLimit:state.business.currentLimitMicrounits!==input.businessLifetimeLimitMicrounits,
      changesResearchLimit:state.funding.currentLimitMicrounits!==input.researchLifetimeLimitMicrounits},authorityCreated:false as const};
}
