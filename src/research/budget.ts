import { createHash } from "node:crypto";
import type { JsonObject } from "../core/contracts";
import { OpenRouterAdapter } from "../models/openrouter";
import { ModelProviderError, type ModelProviderAdapter, type ModelProviderResponse, type ProviderPriceLimit, type StructuredModelRequest, type WebSearchModelRequest } from "../models/types";

export const PRODUCT_RESEARCH_BUDGET = {
  version: "discovery-estimate-1.0", maximumMicrousd: 1_000_000,
  maximumSearchAttempts: 2, maximumSelectorAttempts: 2, searchOutputTokensPerTurn: 4000,
  searchModelTurns: 2, searchInputTokenAllowancePerTurn: 64_000,
  selectorOutputTokens: 1000, maximumSelectorRequestBytes: 32_768, selectorFormattingTokenAllowance: 8192,
  exaFastSearchFeeMicrousd: 7000, pricingSource: "https://openrouter.ai/api/v1/models",
  toolPricingSource: "https://openrouter.ai/docs/guides/features/server-tools/web-search",
} as const;
export type ResearchPriceQuote = {
  modelId: string; verifiedAt: string; source: string; promptPerMillionUsd: number; completionPerMillionUsd: number;
  cacheWritePerMillionUsd: number; cacheReadPerMillionUsd: number;
};
export type ResearchCostReservation = { attemptKey: string; reservedMicrousd: number; requestHash: string; estimate: JsonObject };
export interface ResearchBudgetLedger {
  reserve(reservation: ResearchCostReservation): Promise<{ shouldCall: boolean; totalReservedMicrousd: number }>;
  settle(attemptKey: string, reportedMicrousd: number | null, providerRequestId: string | null): Promise<void>;
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const allowedModels = new Set(["openai/gpt-5.6-luna", "google/gemini-3.6-flash"]);
function rate(value: unknown, optional = false) {
  if (optional && value === undefined) return 0;
  const parsed = typeof value === "string" && value.trim() ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed) || parsed < 0 || parsed > 1) throw new ModelProviderError("provider_rejected", "Research pricing is missing or unbounded.", false);
  return Math.ceil(parsed * 1_000_000 * 1_000_000_000) / 1_000_000_000;
}
export function parseResearchPriceQuote(catalog: unknown, modelId: string, verifiedAt = new Date().toISOString()): ResearchPriceQuote {
  if (!allowedModels.has(modelId) || !record(catalog) || !Array.isArray(catalog.data)) throw new ModelProviderError("provider_rejected", "Unpriced research model.", false);
  const model = catalog.data.find(item => record(item) && item.id === modelId);
  if (!record(model) || !record(model.pricing)) throw new ModelProviderError("provider_rejected", "Current research model pricing unavailable.", false);
  const pricing = model.pricing;
  const understood = new Set(["prompt", "completion", "request", "image", "audio", "input_audio_cache", "web_search", "internal_reasoning", "input_cache_read", "input_cache_write", "overrides"]);
  if (Object.keys(pricing).some(key => !understood.has(key) && Number(pricing[key]) !== 0) || rate(pricing.request, true) !== 0) throw new ModelProviderError("provider_rejected", "Unexpected research pricing fee; review required.", false);
  const tiers = [pricing, ...(Array.isArray(pricing.overrides) ? pricing.overrides.filter(record) : [])];
  if (pricing.overrides !== undefined && (!Array.isArray(pricing.overrides) || pricing.overrides.some(tier => !record(tier)))) throw new ModelProviderError("provider_rejected", "Unrecognized research price tier.", false);
  return { modelId, verifiedAt, source: PRODUCT_RESEARCH_BUDGET.pricingSource,
    promptPerMillionUsd: Math.max(...tiers.map(tier => rate(tier.prompt ?? pricing.prompt))),
    completionPerMillionUsd: Math.max(...tiers.map(tier => Math.max(rate(tier.completion ?? pricing.completion), rate(tier.internal_reasoning ?? pricing.internal_reasoning, true)))),
    cacheWritePerMillionUsd: Math.max(...tiers.map(tier => rate(tier.input_cache_write ?? pricing.input_cache_write, true))),
    cacheReadPerMillionUsd: Math.max(...tiers.map(tier => rate(tier.input_cache_read ?? pricing.input_cache_read, true))) };
}
export async function fetchResearchPriceQuote(modelId: string, fetcher: typeof fetch = fetch): Promise<ResearchPriceQuote> {
  const response = await fetcher(PRODUCT_RESEARCH_BUDGET.pricingSource, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!response.ok || !response.body) throw new ModelProviderError("provider_rejected", "Current provider prices could not be verified.", false);
  const reader = response.body.getReader(); const parts: Uint8Array[] = []; let bytes = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; if (bytes > 2_000_000) throw new Error("Provider catalog exceeds bounded size."); parts.push(value); } }
  finally { await reader.cancel(); }
  return parseResearchPriceQuote(JSON.parse(Buffer.concat(parts).toString("utf8")), modelId);
}
function quoteLimits(quote: ResearchPriceQuote): ProviderPriceLimit {
  return { prompt: quote.promptPerMillionUsd, completion: quote.completionPerMillionUsd, request: 0 };
}
/** This is a conservative spend estimate, not a provider-enforced invoice guarantee. */
export function estimateResearchReservation(phase: "search" | "selector", request: WebSearchModelRequest | StructuredModelRequest, quote: ResearchPriceQuote): ResearchCostReservation {
  if (quote.modelId !== request.model.providerModelId || !Number.isFinite(Date.parse(quote.verifiedAt)) || Math.abs(Date.now() - Date.parse(quote.verifiedAt)) > 300_000) throw new ModelProviderError("provider_rejected", "Fresh pricing for the exact selected model is required.", false);
  const requestBytes = Buffer.byteLength(JSON.stringify(request), "utf8");
  if (phase === "selector" && requestBytes > PRODUCT_RESEARCH_BUDGET.maximumSelectorRequestBytes) throw new ModelProviderError("provider_rejected", "Research selection context exceeds its explicit input budget.", false);
  if (phase === "search" && (!('query' in request) || request.query.length > 800 || request.allowedDomains.length > 6)) throw new ModelProviderError("provider_rejected", "Research search scope exceeds its budget.", false);
  const inputTokens = phase === "search" ? PRODUCT_RESEARCH_BUDGET.searchInputTokenAllowancePerTurn * PRODUCT_RESEARCH_BUDGET.searchModelTurns : requestBytes + PRODUCT_RESEARCH_BUDGET.selectorFormattingTokenAllowance;
  const outputTokens = phase === "search" ? PRODUCT_RESEARCH_BUDGET.searchOutputTokensPerTurn * PRODUCT_RESEARCH_BUDGET.searchModelTurns : PRODUCT_RESEARCH_BUDGET.selectorOutputTokens;
  // Reserve input plus possible cache-write charge even when no cache write is expected.
  const reservedMicrousd = Math.ceil(inputTokens * (Math.max(quote.promptPerMillionUsd, quote.cacheReadPerMillionUsd) + quote.cacheWritePerMillionUsd) + outputTokens * quote.completionPerMillionUsd + (phase === "search" ? PRODUCT_RESEARCH_BUDGET.exaFastSearchFeeMicrousd : 0));
  if (reservedMicrousd > PRODUCT_RESEARCH_BUDGET.maximumMicrousd) throw new ModelProviderError("provider_rejected", "This research attempt exceeds the US$1 budget estimate.", false);
  return { attemptKey: `${phase}:${request.model.modelKey}`, reservedMicrousd,
    requestHash: createHash("sha256").update(JSON.stringify(request)).digest("hex"),
    estimate: { version: PRODUCT_RESEARCH_BUDGET.version, phase, requestBytes, inputTokenAllowance: inputTokens, outputTokenAllowance: outputTokens,
      reservedMicrousd, quote: { ...quote }, estimateOnly: true, providerInvoiceGuarantee: false } };
}
export class BudgetedResearchAdapter implements ModelProviderAdapter {
  constructor(private readonly ledger: ResearchBudgetLedger, private readonly adapter = new OpenRouterAdapter(), private readonly prices = fetchResearchPriceQuote) {}
  async invokeStructured(request: StructuredModelRequest): Promise<ModelProviderResponse> {
    const bounded = { ...request, maxOutputTokens: PRODUCT_RESEARCH_BUDGET.selectorOutputTokens };
    return this.invoke("selector", bounded, async limits => this.adapter.invokeStructured({ ...bounded, providerPriceLimit: limits }));
  }
  async invokeWebSearch(request: WebSearchModelRequest): Promise<ModelProviderResponse> {
    return this.invoke("search", request, async limits => this.adapter.invokeWebSearch({ ...request, providerPriceLimit: limits }));
  }
  async qualifyToolUse(): Promise<never> { throw new ModelProviderError("provider_rejected", "The candidate research budget does not authorize model qualification.", false); }
  private async invoke(phase: "search" | "selector", request: WebSearchModelRequest | StructuredModelRequest, call: (limits: ProviderPriceLimit) => Promise<ModelProviderResponse>): Promise<ModelProviderResponse> {
    let quote: ResearchPriceQuote, reservation: ResearchCostReservation, reserved: { shouldCall: boolean; totalReservedMicrousd: number };
    try { quote = await this.prices(request.model.providerModelId); reservation = estimateResearchReservation(phase, request, quote); reserved = await this.ledger.reserve(reservation); }
    catch (error) { throw new ModelProviderError("provider_rejected", error instanceof Error ? error.message : "Research budget preflight failed.", false); }
    if (!reserved.shouldCall) throw new ModelProviderError("provider_rejected", "This provider attempt was already reserved. Its charge may be uncertain; automatic replay is blocked.", false);
    let result: ModelProviderResponse;
    try { result = await call(quoteLimits(quote)); }
    catch (error) { await this.ledger.settle(reservation.attemptKey, null, null).catch(() => undefined); throw error; }
    const reported = result.usage.reportedCostUsd === null ? null : Math.ceil(result.usage.reportedCostUsd * 1_000_000);
    try { await this.ledger.settle(reservation.attemptKey, reported, result.providerRequestId); }
    catch { throw new ModelProviderError("provider_rejected", "Provider returned, but cost settlement could not be persisted. Further calls are stopped.", false); }
    return { ...result, metadata: { ...result.metadata, budget: { ...reservation.estimate,
      totalReservedMicrousd: reserved.totalReservedMicrousd, reportedMicrousd: reported, maximumMicrousd: PRODUCT_RESEARCH_BUDGET.maximumMicrousd } } };
  }
}
