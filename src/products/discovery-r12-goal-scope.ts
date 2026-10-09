import { canonicalSourceDomains } from "../core/external-eligibility";
import { containsCredentialLikeValue } from "../core/quest-intake";
import { R11_RESTRICTED_SOURCE_DOMAINS } from "../research/qualification";
import { bindValidatedOwnerResearchIntent } from "./discovery-r12-goal-intent";
import { discoveryV2Hash, type DiscoveryIntentV2, type GeographyScopeV2 } from "./discovery-v2";

/** Trusted catalog content, never a browser- or model-supplied permission. */
export type OwnerResearchProfile = {
  version: "r12.owner-research-profile.1";
  id: string;
  title: string;
  purpose: string;
  marketSets: Array<{ key: string; label: string; markets: GeographyScopeV2[] }>;
  topics: Array<{ key: string; label: string; audience: string; queryTopic: string }>;
  queryTemplate: string;
  allowedDomains: string[];
  excludedDomains: string[];
  sourceReviews: Array<{ domain: string; basis: "documented_api_factual_snippets"; reviewHash: string }>;
  independentReviewHash: string;
  purposeReviewHash: string;
  maximumRunMicrousd: number;
  validFrom: string;
  validUntil: string;
};

export type OwnerResearchPublicSelection = { marketSetKey: string; topicKey: string };
export type OwnerResearchFunding =
  | { kind: "legacy_research_root"; bindingId: string; authorityRootId: string; priorRoundId: string; originalSemanticGoalHash: string }
  | { kind: "r05_business"; bindingId: string; authorityRootId: string; priorRoundId: null; originalSemanticGoalHash: null };

/** A native Goal origin. Original source amendments and pilot contracts retain
 * their existing shapes and validation; none are reinterpreted as this lane. */
export type DiscoveryOwnerInitialScope = {
  version: "r12.discovery-owner-initial.1";
  id: string;
  businessId: string;
  goalId: string;
  goalRevision: number;
  goalHash: string;
  businessRevision: number;
  businessHash: string;
  setupId: string;
  setupHash: string;
  profile: OwnerResearchProfile;
  profileHash: string;
  selection: OwnerResearchPublicSelection;
  funding: OwnerResearchFunding;
  fundingApproval: { revision: number; hash: string; maximumMicrounits: string };
  intent: DiscoveryIntentV2;
  allowedDomains: string[];
  excludedDomains: string[];
  approvedQuery: string;
  approvalHash: string;
  independentReviewHash: string;
  createdAt: string;
  expiresAt: string;
};

export const isDiscoveryOwnerInitialScope = (value: { version: string }): value is DiscoveryOwnerInitialScope => value.version === "r12.discovery-owner-initial.1";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const KEY = /^[a-z][a-z0-9_-]{0,39}$/;
const fail = (): never => { throw new Error("r12_owner_research_scope_unverified"); };
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, min: number, max: number): value is string => typeof value === "string" && value.trim() === value && value.length >= min && value.length <= max;
const uuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
const hash = (value: unknown): value is string => typeof value === "string" && HASH.test(value);
const same = (a: unknown, b: unknown) => discoveryV2Hash(a) === discoveryV2Hash(b);
function exact(value: unknown, keys: string): asserts value is Record<string, unknown> {
  if (!record(value) || Object.keys(value).sort().join(",") !== keys.split(",").sort().join(",")) fail();
}
function date(value: unknown) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return fail();
  return Date.parse(value);
}

/** Structural and freshness checks complement the private SQL catalog. They
 * cannot establish licence, review authenticity or execution authority. */
export function validateOwnerResearchProfile(value: OwnerResearchProfile, now = Date.now()): OwnerResearchProfile {
  exact(value, "version,id,title,purpose,marketSets,topics,queryTemplate,allowedDomains,excludedDomains,sourceReviews,independentReviewHash,purposeReviewHash,maximumRunMicrousd,validFrom,validUntil");
  if (containsCredentialLikeValue(value) || !Number.isFinite(now) || value.version !== "r12.owner-research-profile.1" || !uuid(value.id) ||
      !text(value.title, 3, 120) || !text(value.purpose, 20, 800) || !hash(value.independentReviewHash) || !hash(value.purposeReviewHash) ||
      !Number.isSafeInteger(value.maximumRunMicrousd) || value.maximumRunMicrousd < 1 || value.maximumRunMicrousd > 2_000_000 ||
      date(value.validFrom) > now || date(value.validUntil) <= now || date(value.validUntil) <= date(value.validFrom)) return fail();
  if (!Array.isArray(value.marketSets) || value.marketSets.length < 1 || value.marketSets.length > 16 ||
      !Array.isArray(value.topics) || value.topics.length < 1 || value.topics.length > 32) return fail();
  const setKeys = new Set<string>(), topicKeys = new Set<string>();
  for (const set of value.marketSets) {
    exact(set, "key,label,markets");
    if (!KEY.test(set.key) || setKeys.has(set.key) || !text(set.label, 2, 120) || !Array.isArray(set.markets) || set.markets.length < 1 || set.markets.length > 4) return fail();
    setKeys.add(set.key);
    const countries = new Set<string>();
    for (const market of set.markets) {
      exact(market, "countryCode,currency");
      if (!/^[A-Z]{2}$/.test(market.countryCode) || !/^[A-Z]{3}$/.test(market.currency) || countries.has(market.countryCode)) return fail();
      countries.add(market.countryCode);
    }
  }
  for (const topic of value.topics) {
    exact(topic, "key,label,audience,queryTopic");
    if (!KEY.test(topic.key) || topicKeys.has(topic.key) || !text(topic.label, 3, 120) || !text(topic.audience, 3, 160) || !text(topic.queryTopic, 3, 160)) return fail();
    topicKeys.add(topic.key);
  }
  if (!text(value.queryTemplate, 20, 800) || !["markets", "topic", "audience"].every(key => value.queryTemplate.includes(`{{${key}}}`)) ||
      /[{}]/.test(value.queryTemplate.replaceAll("{{markets}}", "").replaceAll("{{topic}}", "").replaceAll("{{audience}}", ""))) return fail();
  const domains = canonicalSourceDomains(value.allowedDomains), excluded = canonicalSourceDomains(value.excludedDomains);
  if (domains.length > 4 || !same(domains, value.allowedDomains) || !same(excluded, value.excludedDomains) ||
      !R11_RESTRICTED_SOURCE_DOMAINS.every(domain => excluded.includes(domain)) || [...domains, ...excluded].some(domain => domain.endsWith(".internal") || domain.endsWith(".local")) ||
      domains.some(domain => excluded.some(blocked => domain === blocked || domain.endsWith(`.${blocked}`) || blocked.endsWith(`.${domain}`)))) return fail();
  if (!Array.isArray(value.sourceReviews) || value.sourceReviews.length !== domains.length || new Set(value.sourceReviews.map(review => review.domain)).size !== domains.length) return fail();
  for (const review of value.sourceReviews) {
    exact(review, "domain,basis,reviewHash");
    if (!domains.includes(review.domain) || review.basis !== "documented_api_factual_snippets" || !hash(review.reviewHash)) return fail();
  }
  // Check every supported rendering before presenting a profile as usable.
  for (const set of value.marketSets) for (const topic of value.topics) renderQuery(value, set, topic);
  return structuredClone(value);
}

function renderQuery(profile: OwnerResearchProfile, markets: OwnerResearchProfile["marketSets"][number], topic: OwnerResearchProfile["topics"][number]) {
  const query = profile.queryTemplate.replaceAll("{{markets}}", markets.markets.map(market => market.countryCode).join(", "))
    .replaceAll("{{topic}}", topic.queryTopic).replaceAll("{{audience}}", topic.audience);
  if (!text(query, 20, 800) || containsCredentialLikeValue(query) || /[{}]/.test(query)) return fail();
  return query;
}

/** Choice keys select trusted public catalog values. Owner prose is deliberately
 * absent from this function, so it cannot leak into search by interpolation. */
export function selectOwnerResearchPublicScope(profile: OwnerResearchProfile, selection: OwnerResearchPublicSelection, now = Date.now()) {
  validateOwnerResearchProfile(profile, now);
  exact(selection, "marketSetKey,topicKey");
  const markets = profile.marketSets.find(item => item.key === selection.marketSetKey), topic = profile.topics.find(item => item.key === selection.topicKey);
  if (!markets || !topic) return fail();
  return { markets: structuredClone(markets.markets), audience: topic.audience, approvedQuery: renderQuery(profile, markets, topic),
    allowedDomains: [...profile.allowedDomains], excludedDomains: [...profile.excludedDomains] };
}

export function validateDiscoveryOwnerInitialScope(scope: DiscoveryOwnerInitialScope, now = Date.now()): DiscoveryOwnerInitialScope {
  exact(scope, "version,id,businessId,goalId,goalRevision,goalHash,businessRevision,businessHash,setupId,setupHash,profile,profileHash,selection,funding,fundingApproval,intent,allowedDomains,excludedDomains,approvedQuery,approvalHash,independentReviewHash,createdAt,expiresAt");
  if (containsCredentialLikeValue(scope) || scope.version !== "r12.discovery-owner-initial.1" ||
      ![scope.id, scope.businessId, scope.goalId, scope.setupId].every(uuid) || ![scope.goalHash, scope.businessHash, scope.setupHash, scope.profileHash, scope.approvalHash, scope.independentReviewHash].every(hash) ||
      ![scope.goalRevision, scope.businessRevision].every(revision => Number.isSafeInteger(revision) && revision >= 1) ||
      !same(scope.profile, validateOwnerResearchProfile(scope.profile, now)) || discoveryV2Hash(scope.profile) !== scope.profileHash || scope.independentReviewHash !== scope.profile.independentReviewHash) return fail();
  exact(scope.funding, "kind,bindingId,authorityRootId,priorRoundId,originalSemanticGoalHash");
  if (!uuid(scope.funding.bindingId) || !uuid(scope.funding.authorityRootId)) return fail();
  if (scope.funding.kind === "legacy_research_root") {
    if (!uuid(scope.funding.priorRoundId) || !hash(scope.funding.originalSemanticGoalHash)) return fail();
  } else if (scope.funding.kind !== "r05_business" || scope.funding.authorityRootId !== scope.businessId || scope.funding.priorRoundId !== null || scope.funding.originalSemanticGoalHash !== null) return fail();
  exact(scope.fundingApproval, "revision,hash,maximumMicrounits");
  if (!Number.isSafeInteger(scope.fundingApproval.revision) || scope.fundingApproval.revision < 0 || !hash(scope.fundingApproval.hash) ||
      typeof scope.fundingApproval.maximumMicrounits !== "string" || !/^[1-9][0-9]{0,15}$/.test(scope.fundingApproval.maximumMicrounits) ||
      BigInt(scope.fundingApproval.maximumMicrounits) > BigInt(Number.MAX_SAFE_INTEGER)) return fail();
  const selected = selectOwnerResearchPublicScope(scope.profile, scope.selection, now);
  const start = date(scope.createdAt), end = date(scope.expiresAt);
  if (start > now || end <= now || end <= start || end > start + 86_400_000 || end > date(scope.profile.validUntil) ||
      !same(scope.allowedDomains, selected.allowedDomains) || !same(scope.excludedDomains, selected.excludedDomains) || scope.approvedQuery !== selected.approvedQuery) return fail();
  const intent = scope.intent;
  if (!intent || intent.id !== scope.id || intent.businessId !== scope.businessId || intent.expiresAt !== scope.expiresAt ||
      !same(intent.comparisonUniverse?.markets, selected.markets) || !same(intent.comparisonUniverse?.audiences, [selected.audience]) ||
      !same(intent.comparisonUniverse?.sourceDomains, selected.allowedDomains) || intent.comparisonUniverse?.selectionQuestion !== selected.approvedQuery ||
      intent.limits?.maximumNewCollections !== 1 || intent.limits?.maximumAlternatives !== 3 || intent.limits?.maximumGenerations !== 1 ||
      intent.limits?.maximumMicrousd > scope.profile.maximumRunMicrousd) return fail();
  bindValidatedOwnerResearchIntent(intent, { scopeId: scope.id, scopeHash: discoveryV2Hash(scope), approvedQuery: scope.approvedQuery }, now);
  return structuredClone(scope);
}
