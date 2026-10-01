import type { JsonObject } from "../core/contracts";
import { fetchCreativeModelQuote, type CreativeModelQuote } from "../creative/budget";
import { hash, requireEtsy, SHA256 } from "../etsy/contracts";
import type { StructuredModelRequest } from "../models/types";
import type { ListingRole } from "./runtime";

export const LISTING_BUDGET = Object.freeze({ version: "listing-estimate-1.0", maximumMicrousd: 1_000_000,
  maximumRequestBytes: 64_000, formattingTokenAllowance: 8192, outputTokens: 6000, maximumCalls: 2 } as const);
export const LISTING_PRICING_SOURCE = "https://openrouter.ai/api/v1/models";
export const LISTING_MODELS = Object.freeze({ specialist: "openai/gpt-5.6-luna", reviewer: "anthropic/claude-haiku-4.5" } as const);
export type ListingQuote = {
  version: "listing-estimate-1.0"; inputHash: string; maximumCalls: 2; maximumEstimateMicrousd: number;
  ceilings: { specialist: number; reviewer: number };
  models: { specialist: "openai/gpt-5.6-luna"; reviewer: "anthropic/claude-haiku-4.5" };
  verifiedAt: string; source: "https://openrouter.ai/api/v1/models";
  primaryOnly: true; estimateOnly: true; providerInvoiceGuarantee: false;
};
export type ListingPrices = { specialist: CreativeModelQuote; reviewer: CreativeModelQuote };
export type ListingPriceReader = (modelId: string) => Promise<CreativeModelQuote>;

function assertScope(inputHash: string, maximumMicrousd: number) {
  requireEtsy(SHA256.test(inputHash) && Number.isSafeInteger(maximumMicrousd) && maximumMicrousd > 0 &&
    maximumMicrousd <= LISTING_BUDGET.maximumMicrousd, "invalid_listing_budget_scope");
}
function assertPrice(role: ListingRole, quote: CreativeModelQuote, now: number) {
  requireEtsy(quote?.modelId === LISTING_MODELS[role] && quote.source === LISTING_PRICING_SOURCE && Number.isFinite(now) &&
    Number.isFinite(Date.parse(quote.verifiedAt)) && now - Date.parse(quote.verifiedAt) < 300_000 && Date.parse(quote.verifiedAt) <= now + 5000 &&
    [quote.inputPerMillion, quote.outputPerMillion, quote.cacheWritePerMillion].every(value => Number.isFinite(value) && value >= 0 && value <= 1_000_000),
    "fresh_listing_price_required");
}
function amount(quote: CreativeModelQuote, bytes: number) {
  // Match SQL numeric arithmetic on the serialized price exactly. Floating
  // addition (e.g. 0.1 + 0.2) can otherwise over-round a whole-microusd amount
  // and make an otherwise valid reservation disagree with its durable guard.
  const decimal = (value: number) => {
    const [coefficient, exponent = "0"] = String(value).toLowerCase().split("e");
    const [whole, fractional = ""] = coefficient.split(".");
    const scale = fractional.length - Number(exponent), units = BigInt(whole + fractional);
    return scale < 0 ? { units: units * BigInt(10) ** BigInt(-scale), scale: 0 } : { units, scale };
  };
  const components = [quote.inputPerMillion, quote.cacheWritePerMillion, quote.outputPerMillion].map(decimal);
  const scale = Math.max(...components.map(p => p.scale)), divisor = BigInt(10) ** BigInt(scale);
  const [prompt, cache, completion] = components.map(p => p.units * BigInt(10) ** BigInt(scale - p.scale));
  const numerator = BigInt(bytes + LISTING_BUDGET.formattingTokenAllowance) * (prompt + cache) + BigInt(LISTING_BUDGET.outputTokens) * completion;
  const value = Number((numerator + divisor - BigInt(1)) / divisor);
  requireEtsy(Number.isSafeInteger(value) && value >= 0, "invalid_listing_price_estimate");
  return value;
}
/** Complete two-call upper estimate, using the full request-byte allowance for
 * both phases. A UTF-8 byte is conservatively counted as one input token. */
export function quoteListing(inputHash: string, maximumMicrousd: number, prices: ListingPrices, now = Date.now()): ListingQuote {
  assertScope(inputHash, maximumMicrousd);
  assertPrice("specialist", prices.specialist, now); assertPrice("reviewer", prices.reviewer, now);
  const ceilings = { specialist: amount(prices.specialist, LISTING_BUDGET.maximumRequestBytes), reviewer: amount(prices.reviewer, LISTING_BUDGET.maximumRequestBytes) };
  const maximumEstimateMicrousd = ceilings.specialist + ceilings.reviewer;
  requireEtsy(Number.isSafeInteger(maximumEstimateMicrousd) && maximumEstimateMicrousd <= maximumMicrousd, "listing_complete_quote_exceeds_cap");
  return { version: LISTING_BUDGET.version, inputHash, maximumCalls: 2, maximumEstimateMicrousd, ceilings,
    models: { ...LISTING_MODELS }, verifiedAt: new Date(now).toISOString(), source: LISTING_PRICING_SOURCE,
    primaryOnly: true, estimateOnly: true, providerInvoiceGuarantee: false };
}
export async function currentListingQuote(inputHash: string, maximumMicrousd: number, prices: ListingPriceReader = fetchCreativeModelQuote): Promise<ListingQuote> {
  assertScope(inputHash, maximumMicrousd);
  const specialist = structuredClone(await prices(LISTING_MODELS.specialist));
  const reviewer = structuredClone(await prices(LISTING_MODELS.reviewer));
  return quoteListing(inputHash, maximumMicrousd, { specialist, reviewer });
}
/** A persisted approval is immutable but need not stay five minutes old forever:
 * each dispatch obtains fresh prices and stays within its approved phase ceiling. */
export function validateListingQuote(quote: ListingQuote, inputHash: string, maximumMicrousd: number) {
  assertScope(inputHash, maximumMicrousd);
  requireEtsy(quote?.version === LISTING_BUDGET.version && quote.inputHash === inputHash && quote.maximumCalls === 2 &&
    quote.source === LISTING_PRICING_SOURCE && quote.primaryOnly === true && quote.estimateOnly === true && quote.providerInvoiceGuarantee === false &&
    quote.models?.specialist === LISTING_MODELS.specialist && quote.models.reviewer === LISTING_MODELS.reviewer &&
    Number.isFinite(Date.parse(quote.verifiedAt)) && [quote.ceilings?.specialist, quote.ceilings?.reviewer].every(v => Number.isSafeInteger(v) && v >= 0) &&
    quote.maximumEstimateMicrousd === quote.ceilings.specialist + quote.ceilings.reviewer && quote.maximumEstimateMicrousd <= maximumMicrousd,
    "invalid_listing_quote");
}

/** The semantic fingerprint remains prepared.requestHash. This separate hash
 * binds the exact adapter request, including current routing and price limits. */
export function listingCallReservation(role: ListingRole, request: StructuredModelRequest, price: CreativeModelQuote,
  approved: ListingQuote, maximumMicrousd: number, now = Date.now()) {
  validateListingQuote(approved, approved.inputHash, maximumMicrousd); assertPrice(role, price, now);
  const allowed = ["model", "schemaName", "outputSchema", "messages", "requestMetadata", "maxOutputTokens", "requireReturnedModel", "providerOnly", "providerPriceLimit"];
  requireEtsy(Object.keys(request).every(key => allowed.includes(key)) && request.model.provider === "openrouter" &&
    request.model.providerModelId === LISTING_MODELS[role] && request.requireReturnedModel === true && request.maxOutputTokens === LISTING_BUDGET.outputTokens &&
    Array.isArray(request.messages) && request.messages.every(m => typeof m.content === "string" && (m.images?.length ?? 0) === 0) &&
    request.providerOnly?.length === 1 && request.providerOnly[0] === (role === "specialist" ? "openai" : "anthropic") &&
    hash(request.providerPriceLimit) === hash({ prompt: price.inputPerMillion, completion: price.outputPerMillion, request: 0 }),
    "invalid_listing_transport_request");
  const requestBytes = Buffer.byteLength(JSON.stringify(request), "utf8");
  requireEtsy(requestBytes <= LISTING_BUDGET.maximumRequestBytes, "listing_request_too_large");
  const reservedMicrousd = amount(price, requestBytes);
  // Check the *complete* phase ceiling with fresh prices, even when this request
  // is smaller, so higher unit prices never silently broaden an approval.
  requireEtsy(amount(price, LISTING_BUDGET.maximumRequestBytes) <= approved.ceilings[role] && reservedMicrousd <= maximumMicrousd,
    "listing_price_exceeds_approved_ceiling");
  const transportRequestHash = hash(request);
  return { reservedMicrousd, transportRequestHash, estimate: {
    version: LISTING_BUDGET.version, role, inputHash: approved.inputHash, maximumMicrousd, approvedPhaseCeilingMicrousd: approved.ceilings[role],
    requestBytes, inputTokenAllowance: requestBytes + LISTING_BUDGET.formattingTokenAllowance, outputTokenAllowance: LISTING_BUDGET.outputTokens,
    reservedMicrousd, transportRequestHash, quote: { ...price }, primaryOnly: true, estimateOnly: true, providerInvoiceGuarantee: false,
  } satisfies JsonObject };
}
