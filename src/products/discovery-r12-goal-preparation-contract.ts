import type { R04QuestContent } from "../core/quest-contract";
import { containsCredentialLikeValue } from "../core/quest-intake";
import { DISCOVERY_V2, discoveryV2Hash, type DiscoveryIntentV2 } from "./discovery-v2";
import type { DiscoveryR12Quote } from "./discovery-r12-quote";
import { DISCOVERY_R12_PHASES } from "./discovery-r12-wire";
import { validateOwnerEpisodeClosure, type OwnerEpisodeClosure } from "./discovery-r12-owner-episode";
import { selectOwnerResearchPublicScope, validateOwnerResearchProfile, type OwnerResearchFunding, type OwnerResearchProfile, type OwnerResearchPublicSelection } from "./discovery-r12-goal-scope";

export type OwnerResearchPreparationInput = OwnerResearchPublicSelection & {
  businessId: string;
  goalId: string;
  goalRevision: number;
  profileId: string;
  profileHash: string;
  grantId: string;
  businessLifetimeLimitMicrounits: string;
  researchLifetimeLimitMicrounits: string;
  submissionId: string;
};
export type OwnerResearchEpisodePreparationInput = OwnerResearchPreparationInput & {
  predecessorPlanId: string; predecessorPlanHash: string; predecessorScopeId: string; predecessorScopeHash: string;
};
export type OwnerResearchContinuation = {
  eligible: boolean; reason: string | null; predecessorClosure: OwnerEpisodeClosure | null; predecessorClosureHash: string | null;
};
export type OwnerResearchContinuationBounds = { maximumEpisodes: number; maximumAllocationMicrounits: string; expiresAt: string };
export type OwnerResearchBusinessSnapshot = {
  id: string; revision: number; hash: string; capRevision: number;
  maximumMicrounits: string; committedMicrounits: string; hasUnknown: boolean; paused: boolean;
};
export type OwnerResearchGoalSnapshot = {
  id: string; businessId: string; revision: number; hash: string;
  preference: string; content: R04QuestContent; initialRunExists: boolean;
  continuation?: OwnerResearchContinuation;
};
export type OwnerResearchFundingSnapshot = {
  binding: OwnerResearchFunding; revision: number; hash: string; maximumMicrounits: string; committedMicrounits: string;
  pendingMicrounits: string; hasUnknown: boolean;
};
export type OwnerResearchPreparationPreview = {
  version: "r12.owner-research-preview.1";
  businessId: string; goalId: string; goalRevision: number; goalHash: string;
  businessRevision: number; businessHash: string; title: string; objective: string;
  profileId: string; profileHash: string; selection: OwnerResearchPublicSelection;
  approvedQuery: string; sourceDomains: string[]; excludedDomains: string[];
  markets: DiscoveryIntentV2["comparisonUniverse"]["markets"]; audience: string;
  funding: OwnerResearchFundingSnapshot;
  finance: { currentBusinessLimitMicrounits: string; proposedBusinessLimitMicrounits: string; businessCommittedMicrounits: string; expectedCapRevision: number; minimumBusinessLimitMicrounits: string; changesBusinessLimit: boolean; proposedResearchLimitMicrounits: string; minimumResearchLimitMicrounits: string; changesResearchLimit: boolean };
  quote: DiscoveryR12Quote;
  maximumCalls: 5; maximumCollections: 1; maximumRepairs: 0;
  dispatchMinutes: 30; receiptMinutes: 30; maximumReceiptChecks: 15;
  authorityCreated: false;
};
export type OwnerResearchEpisodePreview = Omit<OwnerResearchPreparationPreview, "version"> & {
  version: "r12.owner-research-episode-preview.1";
  episodeNumber: number; predecessorClosure: OwnerEpisodeClosure; predecessorClosureHash: string;
};
export type OwnerResearchAnyPreview = OwnerResearchPreparationPreview | OwnerResearchEpisodePreview;
export type OwnerResearchSetupReceipt = {
  businessId: string; goalId: string; setupId: string; setupHash: string; scopeId: string; grantId: string; submissionId: string;
  policyId: string; policyHash: string; confirmed: boolean; activated: boolean; stopped: boolean;
  preview: OwnerResearchAnyPreview;
};

/** A fresh read-only quote can explain insufficient headroom without creating
 * a proposal or silently raising either owner-entered lifetime limit. */
export class OwnerResearchBudgetError extends Error {
  constructor(reason: "funding_limit_exceeded" | "business_limit_insufficient", readonly quoteMaximumMicrousd: number,
    readonly minimumBusinessLimitMicrounits: string, readonly minimumResearchLimitMicrounits: string) {
    super(`r12_owner_research_${reason}`);
    this.name = "OwnerResearchBudgetError";
  }
}

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const KEY = /^[a-z][a-z0-9_-]{0,39}$/;
const fail = (reason = "unavailable"): never => { throw new Error(`r12_owner_research_${reason}`); };
const money = (value: unknown) => typeof value === "string" && /^(0|[1-9][0-9]{0,15})$/.test(value) && BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(value) : fail("money_invalid");

/** The browser can select catalog choices and an explicit lifetime ceiling.
 * It cannot send a quote, operation, plan, source review or server key. */
export function validateOwnerResearchPreparationInput(input: OwnerResearchPreparationInput): OwnerResearchPreparationInput {
  if (!input || Object.keys(input).sort().join(",") !== "businessId,businessLifetimeLimitMicrounits,goalId,goalRevision,grantId,marketSetKey,profileHash,profileId,researchLifetimeLimitMicrounits,submissionId,topicKey" ||
      containsCredentialLikeValue(input) || ![input.businessId, input.goalId, input.profileId, input.grantId, input.submissionId].every(value => typeof value === "string" && UUID.test(value)) ||
      !HASH.test(input.profileHash) || !KEY.test(input.marketSetKey) || !KEY.test(input.topicKey) || !Number.isSafeInteger(input.goalRevision) || input.goalRevision < 1 || money(input.businessLifetimeLimitMicrounits) < BigInt(1) || money(input.researchLifetimeLimitMicrounits) < BigInt(1)) return fail("input_invalid");
  return structuredClone(input);
}

export function validateOwnerResearchEpisodePreparationInput(input: OwnerResearchEpisodePreparationInput): OwnerResearchEpisodePreparationInput {
  if (!input || Object.keys(input).sort().join(",") !== "businessId,businessLifetimeLimitMicrounits,goalId,goalRevision,grantId,marketSetKey,predecessorPlanHash,predecessorPlanId,predecessorScopeHash,predecessorScopeId,profileHash,profileId,researchLifetimeLimitMicrounits,submissionId,topicKey" ||
      ![input.predecessorPlanId, input.predecessorScopeId].every(value => typeof value === "string" && UUID.test(value)) ||
      ![input.predecessorPlanHash, input.predecessorScopeHash].every(value => typeof value === "string" && HASH.test(value))) return fail("episode_input_invalid");
  const { predecessorPlanId: _planId, predecessorPlanHash: _planHash, predecessorScopeId: _scopeId, predecessorScopeHash: _scopeHash, ...initial } = input;
  void _planId; void _planHash; void _scopeId; void _scopeHash;
  validateOwnerResearchPreparationInput(initial);
  return structuredClone(input);
}

export function validateOwnerResearchContinuation(continuation: OwnerResearchContinuation, goal: OwnerResearchGoalSnapshot, business: OwnerResearchBusinessSnapshot): OwnerEpisodeClosure {
  if (!continuation || typeof continuation.eligible !== "boolean" ||
      !(continuation.reason === null || typeof continuation.reason === "string" && continuation.reason.length > 0 && continuation.reason.length <= 160) ||
      !continuation.predecessorClosure || !HASH.test(continuation.predecessorClosureHash ?? "")) return fail("episode_unavailable");
  const closure = validateOwnerEpisodeClosure(continuation.predecessorClosure);
  if (discoveryV2Hash(closure) !== continuation.predecessorClosureHash || !continuation.eligible ||
      closure.businessId !== business.id || closure.goalId !== goal.id || closure.goalRevision !== goal.revision || closure.goalHash !== goal.hash ||
      closure.businessRevision !== business.revision || closure.businessHash !== business.hash) return fail("episode_changed");
  return closure;
}

export function validateOwnerResearchQuote(quote: DiscoveryR12Quote, now = Date.now()): DiscoveryR12Quote {
  const start = Date.parse(quote?.verifiedAt), end = Date.parse(quote?.validUntil);
  if (!quote || quote.version !== "r12.discovery-quote.1" || quote.maximumCalls !== 5 || quote.maximumCollections !== 1 || quote.proposalOnly !== true || quote.dispatchAuthorized !== false ||
      !Number.isFinite(start) || !Number.isFinite(end) || start > now || end <= now || end - start !== 300_000 || !quote.ceilings || Object.keys(quote.ceilings).sort().join(",") !== [...DISCOVERY_R12_PHASES].sort().join(",") ||
      !DISCOVERY_R12_PHASES.every(phase => Number.isSafeInteger(quote.ceilings[phase]) && quote.ceilings[phase] > 0) ||
      !Number.isSafeInteger(quote.maximumMicrousd) || quote.maximumMicrousd > 2_000_000 || quote.maximumMicrousd !== DISCOVERY_R12_PHASES.reduce((sum, phase) => sum + quote.ceilings[phase], 0)) return fail("quote_unavailable");
  const { quoteHash, verifiedAt: _verifiedAt, validUntil: _validUntil, ...body } = quote;
  void _verifiedAt; void _validUntil;
  if (quoteHash !== discoveryV2Hash(body) || quote.luna.modelId !== "openai/gpt-5.6-luna" || quote.luna.endpoint !== "azure/us" ||
      quote.reviewer.modelId !== "anthropic/claude-haiku-4.5" || quote.reviewer.endpoint !== "amazon-bedrock/us" ||
      discoveryV2Hash(quote.retention) !== discoveryV2Hash({ inference: "no_training_zdr", search: "query_retention_improvement_training_possible", schemas: "static_nonprivate_schema_only" })) return fail("quote_unavailable");
  return structuredClone(quote);
}

/** Pure review projection over server-resolved records. No mutation, provider
 * call, source access, synthetic business evidence or execution authorization. */
export function prepareOwnerResearchPreview(input: OwnerResearchPreparationInput, current: {
  business: OwnerResearchBusinessSnapshot; goal: OwnerResearchGoalSnapshot;
  profile: OwnerResearchProfile; funding: OwnerResearchFundingSnapshot; quote: DiscoveryR12Quote;
}, now = Date.now(), episode = false): OwnerResearchPreparationPreview {
  validateOwnerResearchPreparationInput(input);
  const { business, goal, funding } = current;
  if (containsCredentialLikeValue(current) || business.id !== input.businessId || goal.businessId !== input.businessId || goal.id !== input.goalId ||
      goal.revision !== input.goalRevision || ![business.revision, goal.revision].every(value => Number.isSafeInteger(value) && value >= 1) || !Number.isSafeInteger(business.capRevision) || business.capRevision < 0 ||
      ![business.hash, goal.hash].every(value => typeof value === "string" && HASH.test(value)) || goal.preference !== "ready" ||
      !goal.content || typeof goal.content.objective !== "string" || goal.content.objective.trim().length < 20 || goal.content.objective.length > 1200 ||
      typeof goal.content.title !== "string" || goal.content.title.length < 3 || goal.content.title.length > 200 || !Array.isArray(goal.content.ambiguities) || goal.content.ambiguities.length > 0) return fail("goal_changed");
  if (goal.initialRunExists !== episode) return fail(episode ? "episode_unavailable" : "initial_run_already_exists");
  if (business.paused !== false) return fail("business_paused");
  if (business.hasUnknown !== false || funding.hasUnknown !== false || money(funding.pendingMicrounits) !== BigInt(0)) return fail("unresolved_liability");
  const profile = validateOwnerResearchProfile(current.profile, now), quote = validateOwnerResearchQuote(current.quote, now);
  if (profile.id !== input.profileId || discoveryV2Hash(profile) !== input.profileHash) return fail("profile_changed");
  if (quote.maximumMicrousd > profile.maximumRunMicrousd) return fail("profile_limit_exceeded");
  if (!Number.isSafeInteger(funding.revision) || funding.revision < 0 || !HASH.test(funding.hash)) return fail("funding_unavailable");
  const fundingRequired = money(funding.committedMicrounits) + BigInt(quote.maximumMicrousd), proposedFunding = money(input.researchLifetimeLimitMicrounits);
  const total = money(business.committedMicrounits) + BigInt(quote.maximumMicrousd), proposed = money(input.businessLifetimeLimitMicrounits);
  const requiredFunding = fundingRequired > money(funding.maximumMicrounits) ? fundingRequired : money(funding.maximumMicrounits);
  if (proposedFunding < requiredFunding || proposed < total) throw new OwnerResearchBudgetError(proposedFunding < requiredFunding ? "funding_limit_exceeded" : "business_limit_insufficient",
    quote.maximumMicrousd, total.toString(), (funding.binding.kind === "r05_business" ? total : requiredFunding).toString());
  if (funding.binding.kind === "r05_business" && proposedFunding !== proposed) return fail("native_business_funding_mismatch");
  const selected = selectOwnerResearchPublicScope(profile, { marketSetKey: input.marketSetKey, topicKey: input.topicKey }, now);
  return {
    version: "r12.owner-research-preview.1", businessId: business.id, goalId: goal.id, goalRevision: goal.revision, goalHash: goal.hash,
    businessRevision: business.revision, businessHash: business.hash, title: goal.content.title, objective: goal.content.objective,
    profileId: profile.id, profileHash: input.profileHash, selection: { marketSetKey: input.marketSetKey, topicKey: input.topicKey },
    approvedQuery: selected.approvedQuery, sourceDomains: selected.allowedDomains, excludedDomains: selected.excludedDomains, markets: selected.markets, audience: selected.audience,
    funding: structuredClone(funding), finance: { currentBusinessLimitMicrounits: business.maximumMicrounits, proposedBusinessLimitMicrounits: proposed.toString(), businessCommittedMicrounits: business.committedMicrounits,
      expectedCapRevision: business.capRevision, minimumBusinessLimitMicrounits: total.toString(), changesBusinessLimit: money(business.maximumMicrounits) !== proposed, proposedResearchLimitMicrounits: proposedFunding.toString(),
      minimumResearchLimitMicrounits: fundingRequired.toString(), changesResearchLimit: money(funding.maximumMicrounits) !== proposedFunding }, quote,
    maximumCalls: 5, maximumCollections: 1, maximumRepairs: 0, dispatchMinutes: 30, receiptMinutes: 30, maximumReceiptChecks: 15, authorityCreated: false,
  };
}

/** Read-only preparation checks for an exact closed predecessor. SQL owns the
 * immutable ledger and allocates the next episode number. */
export function prepareOwnerResearchEpisodePreview(input: OwnerResearchEpisodePreparationInput, current: {
  business: OwnerResearchBusinessSnapshot; goal: OwnerResearchGoalSnapshot;
  profile: OwnerResearchProfile; continuationBounds: OwnerResearchContinuationBounds | null;
  funding: OwnerResearchFundingSnapshot; quote: DiscoveryR12Quote;
}, now = Date.now()) {
  validateOwnerResearchEpisodePreparationInput(input);
  const closure = validateOwnerResearchContinuation(current.goal.continuation!, current.goal, current.business);
  if (input.predecessorPlanId !== closure.predecessorPlanId || input.predecessorPlanHash !== closure.predecessorPlanHash ||
      input.predecessorScopeId !== closure.predecessorScopeId || input.predecessorScopeHash !== closure.predecessorScopeHash ||
      closure.authorityRootId !== current.funding.binding.authorityRootId || closure.priorRoundId !== current.funding.binding.priorRoundId ||
      closure.originalSemanticGoalHash !== current.funding.binding.originalSemanticGoalHash) return fail("episode_changed");
  validateOwnerResearchProfile(current.profile, now);
  validateOwnerResearchQuote(current.quote, now);
  const bounds = current.continuationBounds;
  if (!bounds || !Number.isSafeInteger(bounds.maximumEpisodes) || bounds.maximumEpisodes < 1 || bounds.maximumEpisodes > 5 ||
      !Number.isFinite(Date.parse(bounds.expiresAt)) || Date.parse(bounds.expiresAt) <= now + 35 * 60_000 ||
      money(bounds.maximumAllocationMicrounits) < BigInt(1) ||
      BigInt(current.quote.maximumMicrousd) > money(bounds.maximumAllocationMicrounits)) return fail("episode_bounds_exceeded");
  const { predecessorPlanId: _planId, predecessorPlanHash: _planHash, predecessorScopeId: _scopeId, predecessorScopeHash: _scopeHash, ...initial } = input;
  void _planId; void _planHash; void _scopeId; void _scopeHash;
  return { preview: prepareOwnerResearchPreview(initial, current, now, true), closure, closureHash: current.goal.continuation!.predecessorClosureHash! };
}

/** Run-local intent does not contain or replace either cumulative ledger. */
export function ownerResearchExecutionIntent(preview: OwnerResearchPreparationPreview, scopeId: string, expiresAt: string): DiscoveryIntentV2 {
  if (!UUID.test(scopeId) || !Number.isFinite(Date.parse(expiresAt))) return fail("intent_invalid");
  return { version: DISCOVERY_V2, id: scopeId, businessId: preview.businessId, objective: preview.objective,
    comparisonUniverse: { productType: "original_pod_tshirt", markets: structuredClone(preview.markets), audiences: [preview.audience], sourceDomains: [...preview.sourceDomains], selectionQuestion: preview.approvedQuery },
    limits: { maximumAlternatives: 3, maximumNewCollections: 1, maximumMicrousd: preview.quote.maximumMicrousd, maximumGenerations: 1 }, expiresAt };
}

export type OwnerResearchCatalog = {
  profilesTruncated?: boolean;
  setupsTruncated?: boolean;
  profiles: Array<{ profile: OwnerResearchProfile; profileHash: string; grantId: string; continuationBounds?: OwnerResearchContinuationBounds | null }>;
  business: OwnerResearchBusinessSnapshot;
  goal: OwnerResearchGoalSnapshot | null;
  funding: OwnerResearchFundingSnapshot | null;
  setups: OwnerResearchSetupReceipt[];
};
export type OwnerResearchSetupAction = { businessId: string; setupId: string; setupHash: string; submissionId: string };
