import { createHash } from "node:crypto";

/** Public, read-only qualification. These constants are a proposal, never a
 * payment grant. Only independently approved immutable policy permits dispatch. */
export const PUBLIC_RESEARCH_QUOTE_LIMITS = Object.freeze({
  modelId: "openai/gpt-5.6-luna", providerEndpoint: "azure/us", providerName: "Azure",
  canonicalModelId: "openai/gpt-5.6-luna-20260709",
  maximumMicrousd: 250_000, freshnessMs: 300_000,
  searchInputTokens: 128_000, searchOutputTokens: 8_000,
  maximumSelectorRequestBytes: 16_384, selectorFormattingTokens: 8_192, selectorOutputTokens: 1_000,
  searchRequests: 1, exaFastSearchFeeMicrousd: 7_000,
  modelIdentityCatalogUrl: "https://openrouter.ai/api/v1/models",
  modelCatalogUrl: "https://openrouter.ai/api/v1/models/openai/gpt-5.6-luna/endpoints",
  zdrCatalogUrl: "https://openrouter.ai/api/v1/endpoints/zdr",
  toolPricingSource: "https://openrouter.ai/docs/guides/features/server-tools/web-search",
} as const);

export type PublicResearchCatalogSnapshot = { url: string; fetchedAt: string; payload: unknown };
type TokenRates = { prompt: string; completion: string; cacheRead: string; cacheWrite: string; reasoning: string };
type PublicResearchQuoteCommon = {
  modelId: string; providerEndpoint: string; providerName: string;
  priceLimit: { prompt: number; completion: number; request: 0 };
  tokenPricesUsd: TokenRates;
  allowances: { searchInputTokens: number; searchOutputTokens: number; maximumSelectorRequestBytes: number;
    selectorFormattingTokens: number; selectorOutputTokens: number; searchRequests: 1; exaFastSearchFeeMicrousd: number };
  maximumMicrousd: number; searchMicrousd: number; selectorMicrousd: number; totalMicrousd: number;
  verifiedAt: string; validUntil: string; quoteValidUntil: string; quoteHash: string;
};
/** Retained for reading historical records; newly prepared quotes are always V2. */
export type PublicResearchQuoteV1 = PublicResearchQuoteCommon & {
  version: "r11.public-research-quote.1";
  sourceHashes: { modelCatalog: string; zdrCatalog: string };
};
export type PublicResearchResponseModelIds = readonly [string, string];
export type PublicResearchQuoteV2 = PublicResearchQuoteCommon & {
  version: "r11.public-research-quote.2";
  canonicalModelId: string; acceptedResponseModelIds: PublicResearchResponseModelIds;
  sourceHashes: { modelIdentity: string; modelCatalog: string; canonicalModelCatalog: string; zdrCatalog: string };
};
export type PublicResearchQuote = PublicResearchQuoteV1 | PublicResearchQuoteV2;

const LIMITS = PUBLIC_RESEARCH_QUOTE_LIMITS;
const ZERO = BigInt(0), ONE = BigInt(1), SCALE = BigInt("1000000000000000000"), MICRO_SCALE = BigInt("1000000000000");
const HASH = /^[a-f0-9]{64}$/;
const requiredParameters = ["tools", "tool_choice", "max_completion_tokens", "response_format", "structured_outputs", "reasoning"];
const fail = (): never => { throw new Error("public_research_quote_unavailable"); };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (record(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return fail();
}
const hash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
const max = (...values: bigint[]) => values.reduce((a, b) => a > b ? a : b, ZERO);
const ceil = (value: bigint, denominator: bigint) => (value + denominator - ONE) / denominator;
function positiveInteger(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) > 0; }
function timestamp(value: unknown): number {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return fail();
  return Date.parse(value);
}
function fresh(value: unknown, now: number): number {
  const parsed = timestamp(value);
  if (!Number.isSafeInteger(now) || parsed > now || now - parsed >= LIMITS.freshnessMs) fail();
  return parsed;
}
/** The catalogs use USD/token decimal strings, NOT USD/million-token prices.
 * Fixed-point parsing avoids float under-reservations and rejects coercions. */
function decimal(value: unknown): bigint {
  if (typeof value !== "string" || !/^(?:0|1)(?:\.\d{1,18})?$/.test(value)) return fail();
  const [whole, fraction = ""] = value.split(".");
  const parsed = BigInt(whole) * SCALE + BigInt(fraction.padEnd(18, "0"));
  if (parsed > SCALE) fail();
  return parsed;
}
function decimalString(value: bigint): string {
  const whole = value / SCALE, fractional = (value % SCALE).toString().padStart(18, "0").replace(/0+$/, "");
  return `${whole}${fractional ? `.${fractional}` : ""}`;
}
// Round upward to six decimals in the API's USD/million-token price-cap unit.
const perMillion = (value: bigint) => Number(ceil(value, BigInt(1_000_000))) / 1_000_000;

function modelIdentity(canonicalModelId: unknown) {
  // This first-proof path is pinned to the reviewed pair. Even a mutually
  // consistent catalog remapping needs a new review before it can qualify.
  if (canonicalModelId !== LIMITS.canonicalModelId) return fail();
  return { modelId: LIMITS.modelId, canonicalModelId,
    canonicalEndpointUrl: `${LIMITS.modelIdentityCatalogUrl}/${canonicalModelId}/endpoints` };
}
function selectModelIdentity(catalog: unknown) {
  if (!record(catalog) || !Array.isArray(catalog.data) || catalog.data.length > 20_000) return fail();
  const matches = catalog.data.filter(row => record(row) && row.id === LIMITS.modelId);
  if (matches.length !== 1 || !record(matches[0])) return fail();
  const row = matches[0], identity = modelIdentity(row.canonical_slug);
  // Do not follow arbitrary catalog-provided URLs, query strings or redirects.
  if (!record(row.links) || row.links.details !== new URL(identity.canonicalEndpointUrl).pathname) return fail();
  return identity;
}

function pricing(value: unknown) {
  if (!record(value)) return fail();
  const allowed = new Set(["prompt", "completion", "request", "input_cache_read", "input_cache_write", "internal_reasoning",
    "web_search", "image", "audio", "input_audio_cache", "discount", "overrides"]);
  const parseTier = (tier: Record<string, unknown>, base?: TokenRates) => {
    for (const [key, raw] of Object.entries(tier)) {
      if (key === "overrides" && !base) continue;
      if (key === "min_prompt_tokens" && base) { if (!Number.isSafeInteger(raw) || (raw as number) < 0) fail(); continue; }
      if (!allowed.has(key) || key === "overrides") fail();
      if (key === "discount") { if (raw !== 0 && raw !== "0") fail(); continue; }
      const rate = decimal(raw);
      if (key === "request" && rate !== ZERO) fail();
      // This is a text-only path. Reject unexplained nonzero ancillary charges.
      if (["image", "audio", "input_audio_cache"].includes(key) && rate !== ZERO) fail();
    }
    const get = (key: string, inherited: string | undefined, required = false) => {
      const raw = tier[key] === undefined ? inherited ?? (required ? undefined : "0") : tier[key];
      return decimalString(decimal(raw));
    };
    const rates: TokenRates = { prompt: get("prompt", base?.prompt, true), completion: get("completion", base?.completion, true),
      cacheRead: get("input_cache_read", base?.cacheRead), cacheWrite: get("input_cache_write", base?.cacheWrite),
      reasoning: get("internal_reasoning", base?.reasoning) };
    if (decimal(rates.prompt) === ZERO || decimal(rates.completion) === ZERO) fail();
    return { rates, minPromptTokens: base ? tier.min_prompt_tokens : 0,
      // Native search is deliberately separate from the explicitly selected Exa fee.
      nativeWebSearch: get("web_search", undefined) };
  };
  const base = parseTier(value);
  if (value.overrides !== undefined && (!Array.isArray(value.overrides) || value.overrides.length > 64)) fail();
  const tiers = (value.overrides as unknown[] | undefined ?? []).map(tier => {
    if (!record(tier) || !Object.hasOwn(tier, "min_prompt_tokens")) return fail();
    return parseTier(tier, base.rates);
  }).sort((a, b) => Number(a.minPromptTokens) - Number(b.minPromptTokens));
  if (new Set(tiers.map(tier => tier.minPromptTokens)).size !== tiers.length) fail();
  const tokenPricesUsd = Object.fromEntries(Object.keys(base.rates).map(key => [key,
    decimalString(max(...[base, ...tiers].map(tier => decimal(tier.rates[key as keyof TokenRates]))))])) as TokenRates;
  return { base, tiers, tokenPricesUsd };
}

function endpoint(value: unknown) {
  if (!record(value) || value.model_id !== LIMITS.modelId || value.tag !== LIMITS.providerEndpoint || value.provider_name !== LIMITS.providerName || value.status !== 0 ||
      typeof value.name !== "string" || !value.name.trim() || value.name.length > 300 || !positiveInteger(value.context_length) ||
      value.context_length < LIMITS.searchInputTokens + LIMITS.searchOutputTokens || !positiveInteger(value.max_completion_tokens) || value.max_completion_tokens < LIMITS.searchOutputTokens ||
      !Array.isArray(value.supported_parameters) || value.supported_parameters.length > 128 ||
      value.supported_parameters.some(parameter => typeof parameter !== "string") || new Set(value.supported_parameters).size !== value.supported_parameters.length ||
      requiredParameters.some(parameter => !(value.supported_parameters as unknown[]).includes(parameter))) return fail();
  if (value.max_prompt_tokens !== undefined && value.max_prompt_tokens !== null && (!positiveInteger(value.max_prompt_tokens) || value.max_prompt_tokens < LIMITS.searchInputTokens)) fail();
  return { modelId: value.model_id, providerEndpoint: value.tag, providerName: value.provider_name, name: value.name,
    status: value.status, contextLength: value.context_length, maxCompletionTokens: value.max_completion_tokens,
    maxPromptTokens: value.max_prompt_tokens ?? null, supportedParameters: [...value.supported_parameters].sort(), pricing: pricing(value.pricing) };
}
function select(catalog: unknown, kind: "model" | "zdr") {
  if (!record(catalog)) return fail();
  const rows = kind === "model" ? (record(catalog.data) && catalog.data.id === LIMITS.modelId ? catalog.data.endpoints : null) : catalog.data;
  if (!Array.isArray(rows) || rows.length > 20_000) return fail();
  const matches = rows.filter(row => record(row) && row.model_id === LIMITS.modelId && row.tag === LIMITS.providerEndpoint);
  if (matches.length !== 1) return fail();
  return endpoint(matches[0]);
}
function allowances(): PublicResearchQuote["allowances"] {
  return { searchInputTokens: LIMITS.searchInputTokens, searchOutputTokens: LIMITS.searchOutputTokens,
    maximumSelectorRequestBytes: LIMITS.maximumSelectorRequestBytes, selectorFormattingTokens: LIMITS.selectorFormattingTokens,
    selectorOutputTokens: LIMITS.selectorOutputTokens, searchRequests: 1, exaFastSearchFeeMicrousd: LIMITS.exaFastSearchFeeMicrousd };
}
function cost(rates: TokenRates, inputTokens: number, outputTokens: number): number {
  // Reserve full prompt/cache-read plus possible cache-write even if caching is
  // unlikely. Do not assume the cache-write figure replaces the prompt charge.
  const input = max(decimal(rates.prompt), decimal(rates.cacheRead)) + decimal(rates.cacheWrite);
  const output = max(decimal(rates.completion), decimal(rates.reasoning));
  return Number(ceil(BigInt(inputTokens) * input + BigInt(outputTokens) * output, MICRO_SCALE));
}
function quoteBody(quote: PublicResearchQuote) {
  // A refresh changes freshness only. Endpoint prices, tiers, identity, support,
  // context and allowances remain bound; changing any requires a new policy.
  const { verifiedAt, validUntil, quoteValidUntil, quoteHash, ...body } = quote;
  void verifiedAt; void validUntil; void quoteValidUntil; void quoteHash;
  return body;
}

export function qualifyPublicResearchQuote(input: {
  modelIdentityCatalog: PublicResearchCatalogSnapshot; modelCatalog: PublicResearchCatalogSnapshot;
  canonicalModelCatalog: PublicResearchCatalogSnapshot; zdrCatalog: PublicResearchCatalogSnapshot; now?: number; maximumMicrousd?: number;
}): PublicResearchQuoteV2 {
  const now = input.now ?? Date.now(), maximumMicrousd = input.maximumMicrousd ?? LIMITS.maximumMicrousd;
  if (!record(input.modelIdentityCatalog) || !record(input.modelCatalog) || !record(input.canonicalModelCatalog) || !record(input.zdrCatalog) ||
      input.modelIdentityCatalog.url !== LIMITS.modelIdentityCatalogUrl || input.modelCatalog.url !== LIMITS.modelCatalogUrl || input.zdrCatalog.url !== LIMITS.zdrCatalogUrl ||
      !positiveInteger(maximumMicrousd) || maximumMicrousd > LIMITS.maximumMicrousd) return fail();
  const identity = selectModelIdentity(input.modelIdentityCatalog.payload);
  if (input.canonicalModelCatalog.url !== identity.canonicalEndpointUrl) return fail();
  const verified = Math.min(...[input.modelIdentityCatalog, input.modelCatalog, input.canonicalModelCatalog, input.zdrCatalog].map(snapshot => fresh(snapshot.fetchedAt, now)));
  const model = select(input.modelCatalog.payload, "model"), canonicalModel = select(input.canonicalModelCatalog.payload, "model"), zdr = select(input.zdrCatalog.payload, "zdr");
  // Membership must be for this exact route, with mutually consistent current
  // facts. A model-wide ZDR badge or provider's base route is insufficient.
  const modelHash = hash(model), canonicalModelHash = hash(canonicalModel), zdrHash = hash(zdr);
  if (modelHash !== canonicalModelHash || modelHash !== zdrHash) return fail();
  const rates = model.pricing.tokenPricesUsd;
  const searchMicrousd = cost(rates, LIMITS.searchInputTokens, LIMITS.searchOutputTokens) + LIMITS.exaFastSearchFeeMicrousd;
  const selectorMicrousd = cost(rates, LIMITS.maximumSelectorRequestBytes + LIMITS.selectorFormattingTokens, LIMITS.selectorOutputTokens);
  const expiry = new Date(verified + LIMITS.freshnessMs).toISOString();
  const quote: PublicResearchQuoteV2 = { version: "r11.public-research-quote.2", modelId: LIMITS.modelId,
    canonicalModelId: identity.canonicalModelId, acceptedResponseModelIds: [LIMITS.modelId, identity.canonicalModelId],
    providerEndpoint: LIMITS.providerEndpoint, providerName: model.providerName,
    priceLimit: { prompt: perMillion(decimal(rates.prompt)), completion: perMillion(max(decimal(rates.completion), decimal(rates.reasoning))), request: 0 },
    tokenPricesUsd: rates, allowances: allowances(), maximumMicrousd, searchMicrousd, selectorMicrousd, totalMicrousd: searchMicrousd + selectorMicrousd,
    sourceHashes: { modelIdentity: hash(identity), modelCatalog: modelHash, canonicalModelCatalog: canonicalModelHash, zdrCatalog: zdrHash },
    verifiedAt: new Date(verified).toISOString(), validUntil: expiry, quoteValidUntil: expiry, quoteHash: "" };
  quote.quoteHash = hash(quoteBody(quote));
  validatePublicResearchQuote(quote, now);
  return quote;
}

/** Integrity/freshness validation, not authentication: callers must obtain the
 * quote through trusted catalog acquisition, never from owner/worker input. */
export function validatePublicResearchQuote(quote: PublicResearchQuote, now = Date.now()): void {
  if (!record(quote) || !["r11.public-research-quote.1", "r11.public-research-quote.2"].includes(quote.version) || quote.modelId !== LIMITS.modelId || quote.providerEndpoint !== LIMITS.providerEndpoint || quote.providerName !== LIMITS.providerName ||
      !record(quote.priceLimit) || !record(quote.sourceHashes) || !record(quote.tokenPricesUsd) ||
      !HASH.test(quote.sourceHashes.modelCatalog) || quote.sourceHashes.modelCatalog !== quote.sourceHashes.zdrCatalog || !HASH.test(quote.quoteHash)) fail();
  if (quote.version === "r11.public-research-quote.2") {
    const identity = modelIdentity(quote.canonicalModelId);
    if (canonical(quote.acceptedResponseModelIds) !== canonical([LIMITS.modelId, identity.canonicalModelId]) ||
        quote.sourceHashes.modelIdentity !== hash(identity) || quote.sourceHashes.canonicalModelCatalog !== quote.sourceHashes.modelCatalog ||
        Object.keys(quote.sourceHashes).sort().join(",") !== "canonicalModelCatalog,modelCatalog,modelIdentity,zdrCatalog") fail();
  } else if (Object.hasOwn(quote, "canonicalModelId") || Object.hasOwn(quote, "acceptedResponseModelIds") ||
      Object.keys(quote.sourceHashes).sort().join(",") !== "modelCatalog,zdrCatalog") fail();
  const verified = fresh(quote.verifiedAt, now);
  if (timestamp(quote.validUntil) !== verified + LIMITS.freshnessMs || quote.quoteValidUntil !== quote.validUntil || timestamp(quote.validUntil) <= now ||
      canonical(quote.allowances) !== canonical(allowances()) || !positiveInteger(quote.maximumMicrousd) || quote.maximumMicrousd > LIMITS.maximumMicrousd) fail();
  const rates = quote.tokenPricesUsd;
  if (Object.keys(rates).sort().join(",") !== "cacheRead,cacheWrite,completion,prompt,reasoning" || decimal(rates.prompt) === ZERO || decimal(rates.completion) === ZERO) fail();
  if (canonical(quote.priceLimit) !== canonical({ prompt: perMillion(decimal(rates.prompt)), completion: perMillion(max(decimal(rates.completion), decimal(rates.reasoning))), request: 0 })) fail();
  const search = cost(rates, LIMITS.searchInputTokens, LIMITS.searchOutputTokens) + LIMITS.exaFastSearchFeeMicrousd;
  const selector = cost(rates, LIMITS.maximumSelectorRequestBytes + LIMITS.selectorFormattingTokens, LIMITS.selectorOutputTokens);
  if (quote.searchMicrousd !== search || quote.selectorMicrousd !== selector || quote.totalMicrousd !== search + selector || quote.totalMicrousd > quote.maximumMicrousd || quote.quoteHash !== hash(quoteBody(quote))) fail();
}

/** Only four public GETs: fixed identity/alias/ZDR catalogs and the exact
 * canonical catalog established by the identity row. No key lookup, paid model
 * probe, redirects, retry, alternative endpoint or fallback. Fail closed. */
export async function fetchPublicResearchQuote(options: {
  fetch?: typeof fetch; now?: () => number; maximumMicrousd?: number;
} = {}): Promise<PublicResearchQuoteV2> {
  const fetcher = options.fetch ?? fetch, now = options.now ?? Date.now;
  async function read(url: string): Promise<PublicResearchCatalogSnapshot> {
    const startedAt = now();
    const response = await fetcher(url, { method: "GET", headers: { Accept: "application/json", "Cache-Control": "no-cache" },
      credentials: "omit", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!response.ok || !response.body || response.redirected || (response.url && response.url !== url)) return fail();
    const age = response.headers.get("age");
    if (age !== null && !/^\d{1,6}$/.test(age)) fail();
    const ageMs = Number(age ?? 0) * 1000;
    if (ageMs >= LIMITS.freshnessMs) fail();
    const reader = response.body.getReader(), parts: Uint8Array[] = []; let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        bytes += value.byteLength; if (bytes > 8_000_000) fail(); parts.push(value);
      }
    } finally { await reader.cancel(); }
    return { url, fetchedAt: new Date(startedAt - ageMs).toISOString(), payload: JSON.parse(Buffer.concat(parts).toString("utf8")) as unknown };
  }
  try {
    const modelIdentityCatalog = await read(LIMITS.modelIdentityCatalogUrl);
    const identity = selectModelIdentity(modelIdentityCatalog.payload);
    const modelCatalog = await read(LIMITS.modelCatalogUrl), canonicalModelCatalog = await read(identity.canonicalEndpointUrl), zdrCatalog = await read(LIMITS.zdrCatalogUrl);
    return qualifyPublicResearchQuote({ modelIdentityCatalog, modelCatalog, canonicalModelCatalog, zdrCatalog, now: now(), maximumMicrousd: options.maximumMicrousd });
  } catch { return fail(); }
}
