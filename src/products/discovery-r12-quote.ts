import { qualifyPublicResearchQuote, qualifiedTextPricing, quoteTextTokenCost, type PublicResearchCatalogSnapshot, type PublicResearchQuoteV2 } from "../research/qualification-quote";
import { publicResearchHash } from "../research/qualification";
import { DISCOVERY_V2_BUDGET } from "./discovery-v2-budget";
import type { DiscoveryR12Phase } from "./discovery-r12-wire";

const BASE = "https://openrouter.ai/api/v1";
export const DISCOVERY_R12_REVIEWER = { modelId: "anthropic/claude-haiku-4.5", canonicalModelId: "anthropic/claude-4.5-haiku-20251001", endpoint: "amazon-bedrock/us", providerName: "Amazon Bedrock" } as const;
const FRESH_MS = 300_000;
const fail = (): never => { throw new Error("r12_discovery_quote_unavailable"); };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const positive = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;
export type DiscoveryR12Catalogs = {
  models: PublicResearchCatalogSnapshot; lunaAlias: PublicResearchCatalogSnapshot; lunaCanonical: PublicResearchCatalogSnapshot;
  reviewerAlias: PublicResearchCatalogSnapshot; reviewerCanonical: PublicResearchCatalogSnapshot; zdr: PublicResearchCatalogSnapshot;
};
function reviewerIdentity(models: unknown) {
  if (!record(models) || !Array.isArray(models.data) || models.data.length > 20_000) return fail();
  const found = models.data.filter(row => record(row) && row.id === DISCOVERY_R12_REVIEWER.modelId);
  const row = found[0];
  if (found.length !== 1 || !record(row) || row.canonical_slug !== DISCOVERY_R12_REVIEWER.canonicalModelId || !record(row.links) || row.links.details !== `/api/v1/models/${DISCOVERY_R12_REVIEWER.canonicalModelId}/endpoints`) return fail();
  return { modelId: DISCOVERY_R12_REVIEWER.modelId, canonicalModelId: DISCOVERY_R12_REVIEWER.canonicalModelId };
}
function reviewerEndpoint(payload: unknown, kind: "model" | "zdr") {
  if (!record(payload)) return fail();
  const rows = kind === "model" ? record(payload.data) && payload.data.id === DISCOVERY_R12_REVIEWER.modelId ? payload.data.endpoints : null : payload.data;
  if (!Array.isArray(rows) || rows.length > 20_000) return fail();
  const found = rows.filter(row => record(row) && row.model_id === DISCOVERY_R12_REVIEWER.modelId && row.tag === DISCOVERY_R12_REVIEWER.endpoint);
  const row = found[0];
  if (found.length !== 1 || !record(row) || row.provider_name !== DISCOVERY_R12_REVIEWER.providerName || row.status !== 0 || typeof row.name !== "string" || !row.name.trim() || row.name.length > 300 ||
      !positive(row.context_length) || row.context_length < 45_000 || !positive(row.max_completion_tokens) || row.max_completion_tokens < 4000 ||
      (row.max_prompt_tokens !== undefined && row.max_prompt_tokens !== null && (!positive(row.max_prompt_tokens) || row.max_prompt_tokens < 40960)) ||
      !Array.isArray(row.supported_parameters) || row.supported_parameters.length > 128 || row.supported_parameters.some(value => typeof value !== "string") || new Set(row.supported_parameters).size !== row.supported_parameters.length ||
      !["response_format", "structured_outputs", "max_tokens"].every(value => (row.supported_parameters as unknown[]).includes(value))) return fail();
  return { modelId: row.model_id, endpoint: row.tag, providerName: row.provider_name, name: row.name, status: row.status, contextLength: row.context_length,
    maximumCompletionTokens: row.max_completion_tokens, maximumPromptTokens: row.max_prompt_tokens ?? null,
    supportedParameters: [...row.supported_parameters].sort(), pricing: qualifiedTextPricing(row.pricing), rawPricingHash: publicResearchHash(row.pricing) };
}
export type DiscoveryR12Quote = ReturnType<typeof qualifyDiscoveryR12Quote>;

/** Exact reviewed two-model proposal. It never authorizes a call, even if the
 * catalog snapshots and hashes were supplied by an owner or worker. */
export function qualifyDiscoveryR12Quote(catalogs: DiscoveryR12Catalogs, now = Date.now()) {
  const urls = { models: `${BASE}/models`, lunaAlias: `${BASE}/models/openai/gpt-5.6-luna/endpoints`, lunaCanonical: `${BASE}/models/openai/gpt-5.6-luna-20260709/endpoints`,
    reviewerAlias: `${BASE}/models/${DISCOVERY_R12_REVIEWER.modelId}/endpoints`, reviewerCanonical: `${BASE}/models/${DISCOVERY_R12_REVIEWER.canonicalModelId}/endpoints`, zdr: `${BASE}/endpoints/zdr` };
  const times = Object.entries(urls).map(([key, url]) => {
    const snapshot = catalogs[key as keyof DiscoveryR12Catalogs], time = Date.parse(snapshot?.fetchedAt);
    if (!snapshot || snapshot.url !== url || !Number.isFinite(time) || time > now || now - time >= FRESH_MS) return fail();
    return time;
  });
  const luna: PublicResearchQuoteV2 = qualifyPublicResearchQuote({ modelIdentityCatalog: catalogs.models, modelCatalog: catalogs.lunaAlias, canonicalModelCatalog: catalogs.lunaCanonical, zdrCatalog: catalogs.zdr, now });
  const identity = reviewerIdentity(catalogs.models.payload), alias = reviewerEndpoint(catalogs.reviewerAlias.payload, "model"), canonical = reviewerEndpoint(catalogs.reviewerCanonical.payload, "model"), zdr = reviewerEndpoint(catalogs.zdr.payload, "zdr");
  if (publicResearchHash(alias) !== publicResearchHash(canonical) || publicResearchHash(alias) !== publicResearchHash(zdr)) return fail();
  const limits = DISCOVERY_V2_BUDGET;
  const ceilings: Record<DiscoveryR12Phase, number> = {
    plan: quoteTextTokenCost(luna.tokenPricesUsd, limits.phases.plan.maximumRequestBytes + limits.formattingTokenAllowance, limits.phases.plan.outputTokens),
    search1: quoteTextTokenCost(luna.tokenPricesUsd, limits.searchInputTokenAllowance, limits.searchOutputTokenAllowance) + limits.exaFastSearchFeeMicrousd,
    select1: quoteTextTokenCost(luna.tokenPricesUsd, limits.phases.select.maximumRequestBytes + limits.formattingTokenAllowance, limits.phases.select.outputTokens),
    strategy: quoteTextTokenCost(luna.tokenPricesUsd, limits.phases.strategy.maximumRequestBytes + limits.formattingTokenAllowance, limits.phases.strategy.outputTokens),
    review: quoteTextTokenCost(alias.pricing.tokenPricesUsd, limits.phases.review.maximumRequestBytes + limits.formattingTokenAllowance, limits.phases.review.outputTokens),
  };
  const reviewer = { ...identity, endpoint: DISCOVERY_R12_REVIEWER.endpoint, providerName: DISCOVERY_R12_REVIEWER.providerName,
    acceptedResponseModelIds: [identity.modelId, identity.canonicalModelId], tokenPricesUsd: alias.pricing.tokenPricesUsd,
    priceLimit: { prompt: Number(alias.pricing.tokenPricesUsd.prompt) * 1_000_000, completion: Math.max(Number(alias.pricing.tokenPricesUsd.completion), Number(alias.pricing.tokenPricesUsd.reasoning)) * 1_000_000, request: 0 as const },
    sourceHashes: { identity: publicResearchHash(identity), alias: publicResearchHash(alias), canonical: publicResearchHash(canonical), zdr: publicResearchHash(zdr) } };
  const body = { version: "r12.discovery-quote.1" as const, maximumCalls: 5 as const, maximumCollections: 1 as const,
    luna: { modelId: luna.modelId, canonicalModelId: luna.canonicalModelId, endpoint: luna.providerEndpoint, providerName: luna.providerName,
      acceptedResponseModelIds: [...luna.acceptedResponseModelIds], tokenPricesUsd: luna.tokenPricesUsd, priceLimit: luna.priceLimit, sourceHashes: luna.sourceHashes },
    reviewer, ceilings, maximumMicrousd: Object.values(ceilings).reduce((total, amount) => total + amount, 0),
    retention: { inference: "no_training_zdr", search: "query_retention_improvement_training_possible", schemas: "static_nonprivate_schema_only" },
    proposalOnly: true, dispatchAuthorized: false };
  const verifiedAt = Math.min(...times);
  return { ...body, quoteHash: publicResearchHash(body), verifiedAt: new Date(verifiedAt).toISOString(), validUntil: new Date(verifiedAt + FRESH_MS).toISOString() };
}

/** Six fixed public catalog GETs, no key lookup, redirects, retry or paid call. */
export async function fetchDiscoveryR12Quote(options: { fetch?: typeof fetch; now?: () => number } = {}): Promise<DiscoveryR12Quote> {
  const fetcher = options.fetch ?? fetch, now = options.now ?? Date.now;
  async function read(url: string): Promise<PublicResearchCatalogSnapshot> {
    const startedAt = now();
    const response = await fetcher(url, { method: "GET", headers: { Accept: "application/json", "Cache-Control": "no-cache" }, credentials: "omit", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!response.ok || !response.body || response.redirected || (response.url && response.url !== url)) return fail();
    const age = response.headers.get("age");
    if (age !== null && !/^\d{1,6}$/.test(age)) return fail();
    const ageMs = Number(age ?? 0) * 1000;
    if (ageMs >= FRESH_MS) return fail();
    const reader = response.body.getReader(), parts: Uint8Array[] = []; let bytes = 0;
    try { for (;;) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength; if (bytes > 8_000_000) return fail(); parts.push(next.value); } }
    finally { await reader.cancel(); }
    return { url, fetchedAt: new Date(startedAt - ageMs).toISOString(), payload: JSON.parse(Buffer.concat(parts).toString("utf8")) as unknown };
  }
  try {
    const models = await read(`${BASE}/models`);
    reviewerIdentity(models.payload);
    const [lunaAlias, lunaCanonical, reviewerAlias, reviewerCanonical, zdr] = await Promise.all([
      read(`${BASE}/models/openai/gpt-5.6-luna/endpoints`), read(`${BASE}/models/openai/gpt-5.6-luna-20260709/endpoints`),
      read(`${BASE}/models/${DISCOVERY_R12_REVIEWER.modelId}/endpoints`), read(`${BASE}/models/${DISCOVERY_R12_REVIEWER.canonicalModelId}/endpoints`), read(`${BASE}/endpoints/zdr`),
    ]);
    return qualifyDiscoveryR12Quote({ models, lunaAlias, lunaCanonical, reviewerAlias, reviewerCanonical, zdr }, now());
  } catch { return fail(); }
}
