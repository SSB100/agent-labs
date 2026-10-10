import { quoteTextTokenCost } from "../research/qualification-quote";
import { discoveryV2Hash } from "./discovery-v2";
import { DISCOVERY_V2_BUDGET } from "./discovery-v2-budget";
import { qualifyDiscoveryR12Quote, qualifyDiscoveryR12EvidenceQuote, fetchDiscoveryR12Catalogs, type DiscoveryR12Catalogs } from "./discovery-r12-quote";
import type { AdaptivePhase } from "./discovery-r12-adaptive-policy";

export const ADAPTIVE_REQUEST_BYTES: Record<AdaptivePhase, number> = { plan: 24_576, search: DISCOVERY_V2_BUDGET.maximumSearchRequestBytes,
  select: 24_576, strategy: 65_536, review: 65_536 };
export const ADAPTIVE_OUTPUT_TOKENS: Record<AdaptivePhase, number> = { plan: DISCOVERY_V2_BUDGET.phases.plan.outputTokens,
  search: 4000, select: DISCOVERY_V2_BUDGET.phases.select.outputTokens,
  strategy: DISCOVERY_V2_BUDGET.phases.strategy.outputTokens, review: DISCOVERY_V2_BUDGET.phases.review.outputTokens };
/** Current qualified model pair only. A stronger choice requires a new qualified
 * catalog/route version, never a model-selected fallback. No calls are made. */
function qualifyLegacyAdaptiveResearchQuote(catalogs: DiscoveryR12Catalogs, now = Date.now()) {
  const base = qualifyDiscoveryR12Quote(catalogs, now);
  qualifyDiscoveryR12EvidenceQuote(catalogs, now); // Verifies the larger reviewer context.
  const ceilings = Object.fromEntries((Object.keys(ADAPTIVE_REQUEST_BYTES) as AdaptivePhase[]).map(phase => [phase,
    phase === "search" ? base.ceilings.search1 : quoteTextTokenCost(phase === "review" ? base.reviewer.tokenPricesUsd : base.luna.tokenPricesUsd,
      ADAPTIVE_REQUEST_BYTES[phase] + DISCOVERY_V2_BUDGET.formattingTokenAllowance, ADAPTIVE_OUTPUT_TOKENS[phase])])) as Record<AdaptivePhase, number>;
  const body = { version: "r12.adaptive-quote.1" as const, baseQuoteHash: base.quoteHash, luna: base.luna, reviewer: base.reviewer,
    ceilings, maximumRunMicrousd: 10_000_000, maximumExtraActions: 10,
    requestBytes: ADAPTIVE_REQUEST_BYTES, outputTokens: ADAPTIVE_OUTPUT_TOKENS, retention: base.retention,
    proposalOnly: true as const, dispatchAuthorized: false as const };
  return { ...body, quoteHash: discoveryV2Hash(body), verifiedAt: base.verifiedAt, validUntil: base.validUntil };
}
export const ADAPTIVE_ETSY_PHASES = Object.freeze(["plan", "strategy", "review"] as const);
export type EtsyAdaptivePhase = typeof ADAPTIVE_ETSY_PHASES[number];
export const ADAPTIVE_ETSY_REQUEST_BYTES: Readonly<Record<EtsyAdaptivePhase, number>> = Object.freeze({
  plan: 24_576, strategy: 65_536, review: 65_536,
});
export const ADAPTIVE_ETSY_OUTPUT_TOKENS: Readonly<Record<EtsyAdaptivePhase, number>> = Object.freeze({
  plan: DISCOVERY_V2_BUDGET.phases.plan.outputTokens, strategy: DISCOVERY_V2_BUDGET.phases.strategy.outputTokens, review: DISCOVERY_V2_BUDGET.phases.review.outputTokens,
});
const ETSY_RETENTION = Object.freeze({ inference: "no_training_zdr", sourceAcquisition: "owner_reported_capture_no_search",
  schemas: "static_nonprivate_schema_only" } as const);

/** Qualify the existing inference routes from the same fixed catalog facts.
 * No request, fee, output allowance or retention promise for Exa is imported
 * into this separately versioned three-role quote. Catalog qualification is
 * pure and neither retrieves owner evidence nor authorizes provider dispatch. */
export function qualifyEtsyOwnerResearchQuote(catalogs: DiscoveryR12Catalogs, now = Date.now()) {
  const base = qualifyDiscoveryR12EvidenceQuote(catalogs, now);
  const ceilings = Object.fromEntries(ADAPTIVE_ETSY_PHASES.map(phase => [phase,
    quoteTextTokenCost(phase === "review" ? base.reviewer.tokenPricesUsd : base.luna.tokenPricesUsd,
      ADAPTIVE_ETSY_REQUEST_BYTES[phase] + DISCOVERY_V2_BUDGET.formattingTokenAllowance, ADAPTIVE_ETSY_OUTPUT_TOKENS[phase])])) as Record<EtsyAdaptivePhase, number>;
  const body = { version: "r12.adaptive-quote.2" as const,
    baseQuoteHash: discoveryV2Hash({ version: "r12.adaptive-inference-catalog.1", luna: base.luna, reviewer: base.reviewer }),
    luna: base.luna, reviewer: base.reviewer, ceilings, maximumRunMicrousd: 10_000_000, maximumExtraActions: 10,
    requestBytes: ADAPTIVE_ETSY_REQUEST_BYTES, outputTokens: ADAPTIVE_ETSY_OUTPUT_TOKENS, retention: ETSY_RETENTION,
    proposalOnly: true as const, dispatchAuthorized: false as const };
  return { ...body, quoteHash: discoveryV2Hash(body), verifiedAt: base.verifiedAt, validUntil: base.validUntil };
}
export type LegacyAdaptiveResearchQuote = ReturnType<typeof qualifyLegacyAdaptiveResearchQuote>;
export type EtsyAdaptiveResearchQuote = ReturnType<typeof qualifyEtsyOwnerResearchQuote>;
export type AdaptiveResearchQuote = LegacyAdaptiveResearchQuote | EtsyAdaptiveResearchQuote;
export function qualifyAdaptiveResearchQuote(catalogs: DiscoveryR12Catalogs, now?: number, version?: "r12.adaptive-quote.1"): LegacyAdaptiveResearchQuote;
export function qualifyAdaptiveResearchQuote(catalogs: DiscoveryR12Catalogs, now: number | undefined, version: "r12.adaptive-quote.2"): EtsyAdaptiveResearchQuote;
export function qualifyAdaptiveResearchQuote(catalogs: DiscoveryR12Catalogs, now: number | undefined, version: AdaptiveResearchQuote["version"]): AdaptiveResearchQuote;
export function qualifyAdaptiveResearchQuote(catalogs: DiscoveryR12Catalogs, now = Date.now(), version: AdaptiveResearchQuote["version"] = "r12.adaptive-quote.1"): AdaptiveResearchQuote {
  if (version === "r12.adaptive-quote.2") return qualifyEtsyOwnerResearchQuote(catalogs, now);
  if (version !== "r12.adaptive-quote.1") throw new Error("r12_adaptive_quote_unverified");
  return qualifyLegacyAdaptiveResearchQuote(catalogs, now);
}
export async function fetchAdaptiveResearchQuote(options: { fetch?: typeof fetch; now?: () => number; version?: AdaptiveResearchQuote["version"] } = {}) {
  return qualifyAdaptiveResearchQuote(await fetchDiscoveryR12Catalogs(options), (options.now ?? Date.now)(), options.version ?? "r12.adaptive-quote.1");
}
/** Generic phase consumers must use this gate rather than treating absent .2
 * search/select entries as zero-price or free provider operations. */
export function adaptiveResearchPhaseLimits(quote: AdaptiveResearchQuote, phase: AdaptivePhase) {
  if (quote.version === "r12.adaptive-quote.2") {
    if (phase !== "plan" && phase !== "strategy" && phase !== "review") throw new Error("r12_adaptive_quote_phase_unavailable");
    return { maximumMicrousd: quote.ceilings[phase], requestBytes: quote.requestBytes[phase], outputTokens: quote.outputTokens[phase] };
  }
  if (quote.version !== "r12.adaptive-quote.1" || !Object.hasOwn(ADAPTIVE_REQUEST_BYTES, phase)) throw new Error("r12_adaptive_quote_phase_unavailable");
  return { maximumMicrousd: quote.ceilings[phase], requestBytes: quote.requestBytes[phase], outputTokens: quote.outputTokens[phase] };
}
export function validateAdaptiveResearchQuote(quote: AdaptiveResearchQuote, now = Date.now()) {
  const ownerCapture = quote?.version === "r12.adaptive-quote.2";
  const requestBytes = ownerCapture ? ADAPTIVE_ETSY_REQUEST_BYTES : ADAPTIVE_REQUEST_BYTES;
  const outputTokens = ownerCapture ? ADAPTIVE_ETSY_OUTPUT_TOKENS : ADAPTIVE_OUTPUT_TOKENS;
  if (!quote || !["r12.adaptive-quote.1", "r12.adaptive-quote.2"].includes(quote.version) || quote.proposalOnly !== true || quote.dispatchAuthorized !== false ||
      quote.maximumRunMicrousd !== 10_000_000 || quote.maximumExtraActions !== 10 ||
      !Number.isFinite(now) || !Number.isFinite(Date.parse(quote.verifiedAt)) || Date.parse(quote.verifiedAt) > now ||
      !Number.isFinite(Date.parse(quote.validUntil)) || Date.parse(quote.validUntil) <= now || Date.parse(quote.validUntil) - Date.parse(quote.verifiedAt) > 300_000 ||
      discoveryV2Hash(quote.requestBytes) !== discoveryV2Hash(requestBytes) || discoveryV2Hash(quote.outputTokens) !== discoveryV2Hash(outputTokens)) throw new Error("r12_adaptive_quote_unverified");
  const { quoteHash, verifiedAt: _time, validUntil: _end, ...body } = quote;
  void _time; void _end;
  const fail = (): never => { throw new Error("r12_adaptive_quote_unverified"); };
  if (quoteHash !== discoveryV2Hash(body) || !/^[a-f0-9]{64}$/.test(quote.baseQuoteHash) ||
      Object.keys(quote.ceilings).sort().join(",") !== (ownerCapture ? "plan,review,strategy" : "plan,review,search,select,strategy") ||
      Object.values(quote.ceilings).some(v => !Number.isSafeInteger(v) || v < 1)) fail();
  if (ownerCapture && (Object.keys(quote).sort().join(",") !== "baseQuoteHash,ceilings,dispatchAuthorized,luna,maximumExtraActions,maximumRunMicrousd,outputTokens,proposalOnly,quoteHash,requestBytes,retention,reviewer,validUntil,verifiedAt,version" ||
      discoveryV2Hash(quote.retention) !== discoveryV2Hash(ETSY_RETENTION) ||
      quote.baseQuoteHash !== discoveryV2Hash({ version: "r12.adaptive-inference-catalog.1", luna: quote.luna, reviewer: quote.reviewer }))) fail();
  for (const [route, modelId, canonicalModelId, endpoint, providerName] of [
    [quote.luna, "openai/gpt-5.6-luna", "openai/gpt-5.6-luna-20260709", "azure/us", "Azure"],
    [quote.reviewer, "anthropic/claude-haiku-4.5", "anthropic/claude-4.5-haiku-20251001", "amazon-bedrock/us", "Amazon Bedrock"],
  ] as const) {
    if (ownerCapture && (Object.keys(route).sort().join(",") !== "acceptedResponseModelIds,canonicalModelId,endpoint,modelId,priceLimit,providerName,sourceHashes,tokenPricesUsd" ||
        Object.keys(route.priceLimit).sort().join(",") !== "completion,prompt,request")) fail();
    if (route.modelId !== modelId || route.canonicalModelId !== canonicalModelId || route.endpoint !== endpoint || route.providerName !== providerName ||
        JSON.stringify(route.acceptedResponseModelIds) !== JSON.stringify([modelId, canonicalModelId]) ||
        Object.keys(route.sourceHashes).length < 4 || Object.values(route.sourceHashes).some(h => !/^[a-f0-9]{64}$/.test(h)) ||
        Object.keys(route.tokenPricesUsd).sort().join(",") !== "cacheRead,cacheWrite,completion,prompt,reasoning" ||
        Object.values(route.tokenPricesUsd).some(v => typeof v !== "string" || !/^\d+(?:\.\d+)?$/.test(v)) ||
        route.priceLimit.request !== 0 || route.priceLimit.prompt !== Number((Number(route.tokenPricesUsd.prompt) * 1_000_000).toFixed(8)) ||
        route.priceLimit.completion !== Number((Math.max(Number(route.tokenPricesUsd.completion), Number(route.tokenPricesUsd.reasoning)) * 1_000_000).toFixed(8))) fail();
  }
  for (const phase of Object.keys(requestBytes) as AdaptivePhase[]) {
    const limits = adaptiveResearchPhaseLimits(quote, phase);
    const expected = phase === "search" ? quoteTextTokenCost(quote.luna.tokenPricesUsd, DISCOVERY_V2_BUDGET.searchInputTokenAllowance,
      DISCOVERY_V2_BUDGET.searchOutputTokenAllowance) + DISCOVERY_V2_BUDGET.exaFastSearchFeeMicrousd :
      quoteTextTokenCost(phase === "review" ? quote.reviewer.tokenPricesUsd : quote.luna.tokenPricesUsd,
        limits.requestBytes + DISCOVERY_V2_BUDGET.formattingTokenAllowance, limits.outputTokens);
    if (limits.maximumMicrousd !== expected) fail();
  }
  return quote;
}

/** Fresh server-fetched catalog qualification may refresh observation hashes or
 * lower prices without expanding the activated run. SQL must enforce the same
 * comparison atomically and pin the complete current quote per attempt. The
 * original scope/quote and any already reserved wire remain immutable. */
export function validateAdaptiveExecutionQuote(current: AdaptiveResearchQuote, approved: AdaptiveResearchQuote,
  expectedApprovedHash: string, now = Date.now()): AdaptiveResearchQuote {
  const fail = (): never => { throw new Error("r12_adaptive_execution_quote_incompatible"); };
  validateAdaptiveResearchQuote(current, now);
  validateAdaptiveResearchQuote(approved, Date.parse(approved.verifiedAt));
  if (approved.quoteHash !== expectedApprovedHash || !/^[a-f0-9]{64}$/.test(expectedApprovedHash)) fail();
  const policy = (q: AdaptiveResearchQuote) => ({
    version: q.version, maximumRunMicrousd: q.maximumRunMicrousd, maximumExtraActions: q.maximumExtraActions,
    requestBytes: q.requestBytes, outputTokens: q.outputTokens, retention: q.retention,
    routes: [q.luna, q.reviewer].map(r => ({ modelId: r.modelId, canonicalModelId: r.canonicalModelId,
      endpoint: r.endpoint, providerName: r.providerName, acceptedResponseModelIds: r.acceptedResponseModelIds })),
    proposalOnly: q.proposalOnly, dispatchAuthorized: q.dispatchAuthorized,
  });
  if (discoveryV2Hash(policy(current)) !== discoveryV2Hash(policy(approved)) ||
      (Object.keys(current.ceilings) as AdaptivePhase[]).some(p => adaptiveResearchPhaseLimits(current, p).maximumMicrousd > adaptiveResearchPhaseLimits(approved, p).maximumMicrousd)) fail();
  return structuredClone(current);
}
