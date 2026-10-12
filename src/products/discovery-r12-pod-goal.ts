import { isIP } from "node:net";
import { containsCredentialLikeValue } from "../core/quest-intake";
import { publicResearchHash } from "../research/qualification";
import { canonicalSourceDomains } from "../core/external-eligibility";
import { validateResearchRequest } from "../research/sources";

/** A new scope, not an interpretation of any historical POD/Steel permission.
 * These pure checks never establish that a review or approval exists in storage. */
export const POD_GOAL_VERSION = "r12.pod-research-goal.1" as const;
export const POD_GOAL_BOUNDS = Object.freeze({ maximumCalls: 5, maximumCollections: 1,
  maximumWorkingHypotheses: 3, maximumDomains: 6, maximumResults: 4,
  maximumExcerptCharacters: 1800, maximumQueryCharacters: 800 });
export const POD_MANDATORY_EXCLUSIONS = ["etsy.com", "etsy.me", "etsystatic.com"] as const;
export type PodResearchSourcePolicy = {
  version: "r12.pod-source-policy.1";
  reviewId: string;
  method: "openrouter_exa_factual_snippets";
  purpose: "public_pod_market_research";
  excludedDomains: string[];
  restrictionsRevision: string;
  termsReviewHash: string;
  independentReviewHash: string;
  recipients: { router: "openrouter.ai"; search: "exa.ai"; researcher: "azure/us"; reviewer: "amazon-bedrock/us" };
  retention: { inference: "no_training_zdr"; search: "query_retention_improvement_training_possible"; application: "bounded_attributed_audit_evidence" };
  validFrom: string;
  validUntil: string;
};
export type PodResearchPublicBrief = {
  objective: string;
  publicConstraints: string[];
  fulfilmentContext: "printful_available" | "unspecified";
};
export type PodResearchGoalScope = {
  version: typeof POD_GOAL_VERSION;
  id: string; businessId: string; businessRevision: number; businessHash: string; goalId: string; goalRevision: number; goalHash: string;
  setupId: string; setupHash: string; authorityRootId: string;
  publicBrief: PodResearchPublicBrief;
  sourcePolicy: PodResearchSourcePolicy; sourcePolicyHash: string;
  approvalHash: string; maximumMicrousd: number;
  createdAt: string; expiresAt: string;
};
export type PodResearchHypothesis = {
  productType: string; niche: string; audience: string; hypothesis: string; contraryExplanation: string;
};
export type PodResearchPlanProposal = {
  comparisonRationale: string;
  query: string;
  sourceDomains: string[];
  sourceChoiceRationale: string;
  hypotheses: PodResearchHypothesis[];
};
export type PodResearchPlan = PodResearchPlanProposal & {
  version: "r12.pod-research-plan.1"; scopeId: string; scopeHash: string;
  publicBriefHash: string; sourcePolicyHash: string;
  queryProvenance: "application_submitted_query";
  planHash: string;
};
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const fail = (): never => { throw new Error("r12_pod_research_scope_unverified"); };
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function exact(v: unknown, keys: string): asserts v is Record<string, unknown> {
  if (!obj(v) || Object.keys(v).sort().join(",") !== keys.split(",").sort().join(",")) fail();
}
function text(v: unknown, min: number, max: number): v is string {
  return typeof v === "string" && v.trim() === v && v.length >= min && v.length <= max;
}
function stamp(v: unknown): number { if (typeof v !== "string" || !Number.isFinite(Date.parse(v))) return fail(); return Date.parse(v); }
const within = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);
/** Screening is an additional rejection control, not proof that prose is public.
 * Only explicit owner-approved brief fields may reach these builders. */
export function screenPodResearchPublicText(value: unknown): void {
  if (containsCredentialLikeValue(value)) fail();
  const input = typeof value === "string" ? value : JSON.stringify(value);
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\b(?:\d[ -]?){12,19}\b|https?:\/\/|\b(?:localhost|127\.0\.0\.1|169\.254\.169\.254)\b/i.test(input)) fail();
}
export function validatePodResearchPublicBrief(raw: unknown): PodResearchPublicBrief {
  exact(raw, "objective,publicConstraints,fulfilmentContext");
  if (!text(raw.objective, 20, 1200) || !Array.isArray(raw.publicConstraints) || raw.publicConstraints.length > 8 ||
      raw.publicConstraints.some(v => !text(v, 3, 240)) || new Set(raw.publicConstraints).size !== raw.publicConstraints.length ||
      !["printful_available", "unspecified"].includes(String(raw.fulfilmentContext))) fail();
  screenPodResearchPublicText(raw);
  return structuredClone(raw) as PodResearchPublicBrief;
}
export function validatePodResearchSourcePolicy(raw: unknown, now = Date.now()): PodResearchSourcePolicy {
  exact(raw, "version,reviewId,method,purpose,excludedDomains,restrictionsRevision,termsReviewHash,independentReviewHash,recipients,retention,validFrom,validUntil");
  if (raw.version !== "r12.pod-source-policy.1" || !uuid(raw.reviewId) || raw.method !== "openrouter_exa_factual_snippets" || raw.purpose !== "public_pod_market_research" ||
      !hash(raw.restrictionsRevision) || !hash(raw.termsReviewHash) || !hash(raw.independentReviewHash) || !Number.isFinite(now) ||
      stamp(raw.validFrom) > now || stamp(raw.validUntil) <= now || stamp(raw.validUntil) <= stamp(raw.validFrom)) fail();
  const domains = canonicalSourceDomains(raw.excludedDomains);
  if (JSON.stringify(domains) !== JSON.stringify(raw.excludedDomains) || !POD_MANDATORY_EXCLUSIONS.every(d => domains.includes(d))) fail();
  if (publicResearchHash(raw.recipients) !== publicResearchHash({ router: "openrouter.ai", search: "exa.ai", researcher: "azure/us", reviewer: "amazon-bedrock/us" }) ||
      publicResearchHash(raw.retention) !== publicResearchHash({ inference: "no_training_zdr", search: "query_retention_improvement_training_possible", application: "bounded_attributed_audit_evidence" })) fail();
  return structuredClone(raw) as PodResearchSourcePolicy;
}
export function validatePodResearchGoalScope(raw: unknown, now = Date.now()): PodResearchGoalScope {
  exact(raw, "version,id,businessId,businessRevision,businessHash,goalId,goalRevision,goalHash,setupId,setupHash,authorityRootId,publicBrief,sourcePolicy,sourcePolicyHash,approvalHash,maximumMicrousd,createdAt,expiresAt");
  if (raw.version !== POD_GOAL_VERSION || ![raw.id, raw.businessId, raw.goalId, raw.setupId, raw.authorityRootId].every(uuid) ||
      ![raw.businessHash, raw.goalHash, raw.setupHash, raw.sourcePolicyHash, raw.approvalHash].every(hash) || !Number.isSafeInteger(raw.goalRevision) || Number(raw.goalRevision) < 1 || !Number.isSafeInteger(raw.businessRevision) || Number(raw.businessRevision) < 1 ||
      !Number.isSafeInteger(raw.maximumMicrousd) || Number(raw.maximumMicrousd) < 1 || Number(raw.maximumMicrousd) > 2_000_000 ||
      stamp(raw.createdAt) > now || stamp(raw.expiresAt) <= now || stamp(raw.expiresAt) > stamp(raw.createdAt) + 30 * 60_000) fail();
  validatePodResearchPublicBrief(raw.publicBrief);
  const policy = validatePodResearchSourcePolicy(raw.sourcePolicy, now);
  if (publicResearchHash(policy) !== raw.sourcePolicyHash || stamp(raw.expiresAt) > stamp(policy.validUntil)) fail();
  return structuredClone(raw) as PodResearchGoalScope;
}
export function validatePodResearchDomains(raw: unknown, policy: PodResearchSourcePolicy): string[] {
  const domains = canonicalSourceDomains(raw);
  if (domains.length > POD_GOAL_BOUNDS.maximumDomains || domains.some(d => isIP(d) || /(?:^|\.)(?:local|internal|localhost|invalid|test|example|onion)$/.test(d) ||
      policy.excludedDomains.some(excluded => within(d, excluded) || within(excluded, d)))) fail();
  return domains;
}
/** The immutable accepted planner dependency supplies query/source pins. A
 * domain choice is a search restriction, never a publisher-permission claim. */
export function acceptPodResearchPlan(scope: PodResearchGoalScope, raw: unknown, now = Date.now()): PodResearchPlan {
  validatePodResearchGoalScope(scope, now);
  exact(raw, "comparisonRationale,query,sourceDomains,sourceChoiceRationale,hypotheses");
  if (!text(raw.comparisonRationale, 40, 700) || !text(raw.query, 20, POD_GOAL_BOUNDS.maximumQueryCharacters) || !text(raw.sourceChoiceRationale, 30, 500) ||
      !Array.isArray(raw.hypotheses) || raw.hypotheses.length < 1 || raw.hypotheses.length > POD_GOAL_BOUNDS.maximumWorkingHypotheses) fail();
  screenPodResearchPublicText(raw);
  const sourceDomains = validatePodResearchDomains(raw.sourceDomains, scope.sourcePolicy);
  validateResearchRequest({ query: raw.query, allowedDomains: sourceDomains });
  const identities = new Set<string>();
  for (const h of raw.hypotheses as unknown[]) {
    exact(h, "productType,niche,audience,hypothesis,contraryExplanation");
    if (!text(h.productType, 3, 120) || !text(h.niche, 3, 160) || !text(h.audience, 3, 160) || !text(h.hypothesis, 20, 400) || !text(h.contraryExplanation, 20, 400)) fail();
    const identity = [h.productType, h.niche, h.audience].map(v => String(v).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()).join("|");
    if (identities.has(identity)) fail(); identities.add(identity);
  }
  const body = { ...structuredClone(raw) as PodResearchPlanProposal, sourceDomains,
    version: "r12.pod-research-plan.1" as const, scopeId: scope.id, scopeHash: publicResearchHash(scope),
    publicBriefHash: publicResearchHash(scope.publicBrief), sourcePolicyHash: scope.sourcePolicyHash,
    queryProvenance: "application_submitted_query" as const };
  return { ...body, planHash: publicResearchHash(body) };
}
/** This is post-return validation. Hostname filters cannot promise that the
 * upstream provider never retrieved a disallowed path; receipts say so. */
export function validatePodResearchCitationUrl(raw: string, plan: Pick<PodResearchPlan, "sourceDomains">, policy: PodResearchSourcePolicy): string {
  let url: URL; try { url = new URL(raw); } catch { return fail(); }
  let decodedPath: string; try { decodedPath = decodeURIComponent(url.pathname); } catch { return fail(); }
  if (/%[0-9a-f]{2}/i.test(decodedPath) || url.protocol !== "https:" || url.username || url.password || url.port || isIP(url.hostname) ||
      !plan.sourceDomains.some(d => within(url.hostname, d)) || policy.excludedDomains.some(d => within(url.hostname, d)) ||
      /(?:^|\/)(?:login|signin|sign-in|sign_in|auth|oauth|account|accounts|checkout|cart|messages|inbox|contact|profile|profiles|users)(?:\/|\.|$)/i.test(decodedPath) ||
      [...url.searchParams.keys()].some(k => /token|password|secret|session|auth|email|api.?key/i.test(k))) fail();
  return url.toString();
}

export const isPodResearchGoalScope = (scope: { version: string }): scope is PodResearchGoalScope => scope.version === POD_GOAL_VERSION;
