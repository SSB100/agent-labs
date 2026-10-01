import { createHash } from "node:crypto";
import type { JsonObject } from "../core/contracts";
import { fetchCreativeModelQuote, type CreativeModelQuote } from "../creative/budget";
import { OpenRouterAdapter } from "../models/openrouter";
import { ModelProviderError, type ModelProviderResponse, type StructuredModelRequest, type WebSearchModelRequest } from "../models/types";
import { validateResearchRequest } from "../research/sources";
import { JsonSchemaValidationError } from "../workers/schema-validator";

/** V2 has a finite phase list. None of these keys authorizes a fallback or retry. */
export const DISCOVERY_V2_CALLS = ["plan:1", "search:1", "select:1", "search:2", "select:2", "strategy:1", "review:1"] as const;
export type DiscoveryV2Call = (typeof DISCOVERY_V2_CALLS)[number];
export const DISCOVERY_V2_BUDGET = {
  version: "discovery-estimate-2.0", maximumMicrousd: 2_000_000, formattingTokenAllowance: 8192,
  maximumSearchRequestBytes: 8192, searchInputTokenAllowance: 128_000, searchOutputTokenAllowance: 8000, exaFastSearchFeeMicrousd: 7000,
  pricingSource: "https://openrouter.ai/api/v1/models",
  toolPricingSource: "https://openrouter.ai/docs/guides/features/server-tools/web-search",
  phases: {
    plan: { maximumRequestBytes: 12288, outputTokens: 1500 },
    select: { maximumRequestBytes: 16384, outputTokens: 1000 },
    strategy: { maximumRequestBytes: 32768, outputTokens: 5000 },
    review: { maximumRequestBytes: 32768, outputTokens: 4000 },
  },
} as const;
export type DiscoveryV2BudgetScope = { intentId: string; maximumCollections: 1 | 2; maximumMicrousd: number; policyHash: string };
export type DiscoveryV2Reservation = { attemptKey: DiscoveryV2Call; reservedMicrousd: number; requestHash: string; estimate: JsonObject };
export interface DiscoveryV2Ledger {
  reserve(value: DiscoveryV2Reservation): Promise<{ shouldCall: boolean; totalReservedMicrousd: number }>;
  settle(attemptKey: DiscoveryV2Call, reportedMicrousd: number | null, providerRequestId: string | null): Promise<void>;
}
export type DiscoveryV2Provider = Pick<OpenRouterAdapter, "invokeStructured" | "invokeWebSearch">;
export const discoveryV2Model = (key: DiscoveryV2Call) => key === "review:1" ? "anthropic/claude-haiku-4.5" : "openai/gpt-5.6-luna";
const fail = (message: string) => new ModelProviderError("provider_rejected", message, false);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
function assertScope(scope: DiscoveryV2BudgetScope) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(scope.intentId) ||
      ![1, 2].includes(scope.maximumCollections) || !Number.isSafeInteger(scope.maximumMicrousd) || scope.maximumMicrousd < 1 ||
      scope.maximumMicrousd > DISCOVERY_V2_BUDGET.maximumMicrousd || !/^[a-f0-9]{64}$/.test(scope.policyHash)) throw fail("A persisted bounded discovery budget scope is required.");
}
function phase(key: DiscoveryV2Call) { return key.split(":")[0] as "plan" | "search" | "select" | "strategy" | "review"; }
function assertQuote(key: DiscoveryV2Call, quote: CreativeModelQuote) {
  if (!DISCOVERY_V2_CALLS.includes(key) || quote.modelId !== discoveryV2Model(key) || quote.source !== DISCOVERY_V2_BUDGET.pricingSource ||
      !Number.isFinite(Date.parse(quote.verifiedAt)) || Math.abs(Date.now() - Date.parse(quote.verifiedAt)) > 300000 ||
      [quote.inputPerMillion, quote.outputPerMillion, quote.cacheWritePerMillion].some(value => !Number.isFinite(value) || value < 0 || value > 1_000_000)) throw fail("Fresh pricing for the exact primary discovery model is required.");
}
function amount(key: DiscoveryV2Call, quote: CreativeModelQuote, requestBytes?: number) {
  assertQuote(key, quote);
  const kind = phase(key), search = kind === "search";
  const bounds = search ? null : DISCOVERY_V2_BUDGET.phases[kind];
  const inputTokenAllowance = search ? DISCOVERY_V2_BUDGET.searchInputTokenAllowance : (requestBytes ?? bounds!.maximumRequestBytes) + DISCOVERY_V2_BUDGET.formattingTokenAllowance;
  const outputTokenAllowance = search ? DISCOVERY_V2_BUDGET.searchOutputTokenAllowance : bounds!.outputTokens;
  const reservedMicrousd = Math.ceil(inputTokenAllowance * (quote.inputPerMillion + quote.cacheWritePerMillion) + outputTokenAllowance * quote.outputPerMillion + (search ? DISCOVERY_V2_BUDGET.exaFastSearchFeeMicrousd : 0));
  return { inputTokenAllowance, outputTokenAllowance, reservedMicrousd };
}
/** Reuses the audited fixed-model price parser; this does not reuse creative spending authority. */
export const fetchDiscoveryV2ModelQuote = fetchCreativeModelQuote;
export function quoteDiscoveryV2(scope: DiscoveryV2BudgetScope, quotes: { director: CreativeModelQuote; reviewer: CreativeModelQuote }) {
  assertScope(scope);
  const calls = DISCOVERY_V2_CALLS.filter(key => scope.maximumCollections === 2 || !key.endsWith(":2"));
  const ceilings = Object.fromEntries(calls.map(key => [key, amount(key, key === "review:1" ? quotes.reviewer : quotes.director).reservedMicrousd]));
  const maximumEstimateMicrousd = Object.values(ceilings).reduce((sum, value) => sum + value, 0);
  if (maximumEstimateMicrousd > scope.maximumMicrousd) throw fail("The complete finite discovery quote exceeds its approved allowance; no paid call is authorized.");
  return { version: DISCOVERY_V2_BUDGET.version, intentId: scope.intentId, policyHash: scope.policyHash,
    maximumCollections: scope.maximumCollections, maximumCalls: calls.length, maximumEstimateMicrousd, ceilings,
    directorModel: quotes.director.modelId, reviewerModel: quotes.reviewer.modelId, verifiedAt: new Date().toISOString(),
    sourceUrls: [DISCOVERY_V2_BUDGET.pricingSource, DISCOVERY_V2_BUDGET.toolPricingSource], primaryOnly: true, estimateOnly: true, providerInvoiceGuarantee: false };
}
export function reserveDiscoveryV2(scope: DiscoveryV2BudgetScope, key: DiscoveryV2Call, request: StructuredModelRequest | WebSearchModelRequest, quote: CreativeModelQuote): DiscoveryV2Reservation {
  assertScope(scope); assertQuote(key, quote);
  if (scope.maximumCollections === 1 && key.endsWith(":2")) throw fail("A second collection is outside this immutable discovery scope.");
  if (request.model.providerModelId !== discoveryV2Model(key) || request.model.provider !== "openrouter") throw fail("Discovery cannot change its primary model or provider.");
  const kind = phase(key), bytes = Buffer.byteLength(JSON.stringify(request), "utf8");
  const allowedKeys = kind === "search" ? ["model", "query", "allowedDomains", "providerPriceLimit", "providerOnly", "requireReturnedModel"]
    : ["model", "schemaName", "outputSchema", "messages", "requestMetadata", "maxOutputTokens", "providerPriceLimit", "providerOnly", "requireReturnedModel"];
  if (Object.keys(request).some(key => !allowedKeys.includes(key))) throw fail("Discovery request shape does not match its reserved phase.");
  if (kind === "search") {
    if (!("query" in request) || "messages" in request) throw fail("Search requires an exact bounded research request.");
    validateResearchRequest({query:request.query,allowedDomains:request.allowedDomains});
    if (bytes > DISCOVERY_V2_BUDGET.maximumSearchRequestBytes) throw fail("Discovery search exceeds its declared request-byte bound.");
  } else {
    if (!("messages" in request) || "query" in request || request.messages.some(message => (message.images?.length ?? 0) > 0)) throw fail("Discovery model stages accept scoped text only.");
    const bounds = DISCOVERY_V2_BUDGET.phases[kind];
    if (bytes > bounds.maximumRequestBytes || request.maxOutputTokens !== bounds.outputTokens) throw fail("Discovery request exceeds its declared phase input/output bound.");
    const upstream = key === "review:1" ? "anthropic" : "openai";
    if (request.providerOnly && (request.providerOnly.length !== 1 || request.providerOnly[0] !== upstream)) throw fail("Discovery upstream routing differs from its primary policy.");
  }
  const estimate = amount(key, quote, bytes);
  if (estimate.reservedMicrousd > scope.maximumMicrousd) throw fail("Discovery phase exceeds its approved allowance.");
  return { attemptKey: key, reservedMicrousd: estimate.reservedMicrousd, requestHash: hash(request),
    estimate: { version: DISCOVERY_V2_BUDGET.version, intentId: scope.intentId, policyHash: scope.policyHash,
      maximumCollections: scope.maximumCollections, maximumMicrousd: scope.maximumMicrousd, callKey: key,
      requestBytes: bytes, researchRequest: kind === "search" && "query" in request ? { query: request.query, allowedDomains: [...request.allowedDomains] } : null,
      ...estimate, quote: { ...quote }, primaryOnly: true, estimateOnly: true, providerInvoiceGuarantee: false } };
}
function chargedReceipt(error: unknown): { amount: number | null; requestId: string | null; original: JsonObject | null } {
  const receipt = error instanceof ModelProviderError && object(error.details.providerReceipt) ? structuredClone(error.details.providerReceipt) : null;
  const value = receipt && object(receipt.usage) ? receipt.usage.reportedCostUsd : null;
  return { amount: typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.ceil(value * 1e6) : null,
    requestId: receipt && typeof receipt.providerRequestId === "string" ? receipt.providerRequestId : null, original: receipt as JsonObject | null };
}
/** Safe accounting evidence for a paid response that later fails domain validation. */
export function discoveryResponseFailure(error:unknown,response:ModelProviderResponse){
  // Keep only bounded validator paths and fixed categories. Additional-property
  // names can come from untrusted output, so never retain those names or values.
  const validationIssues=error instanceof JsonSchemaValidationError?error.issues.slice(0,8).map(issue=>({
    path:issue.message!=="is not an allowed property"&&/^[\w$.[\]-]{1,160}$/.test(issue.path)?issue.path:"$",
    category:issue.message==="is required"?"required":issue.message==="is not an allowed property"?"additional_property":
      issue.message==="must match one of the declared enum values"?"enum":issue.message==="must equal the declared constant"?"constant":
      /^must contain no more than \d+ characters$/.test(issue.message)?"max_length":/^must contain at least \d+ characters$/.test(issue.message)?"min_length":
      /^must contain no more than \d+ items$/.test(issue.message)?"max_items":/^must contain at least \d+ items$/.test(issue.message)?"min_items":
      issue.message==="must contain unique items"?"unique_items":issue.message==="does not match the required pattern"?"pattern":
      issue.message==="must be a UUID"?"uuid":"schema_mismatch",
  })):[];
  const message=(error instanceof Error?error.message:"Discovery output failed its domain contract.")+
    (validationIssues.length?` ${validationIssues.map(issue=>`${issue.path}:${issue.category}`).join("; ")}`:"");
  return new ModelProviderError("malformed_model_output",message.slice(0,500),false,
    {settlementRecorded:true,...(validationIssues.length?{validationIssues}:{}),providerReceipt:{provider:response.provider,providerModelId:response.providerModelId,upstreamProvider:response.metadata.actualUpstreamProvider??null,
      providerRequestId:response.providerRequestId,latencyMs:response.latencyMs,usage:{...response.usage}}});
}
/** Caller validates/persists output separately. Settlement happens even if that validation fails. */
export async function callDiscoveryV2(options: { scope: DiscoveryV2BudgetScope; key: DiscoveryV2Call; request: StructuredModelRequest | WebSearchModelRequest;
  ledger: DiscoveryV2Ledger; provider?: DiscoveryV2Provider; prices?: typeof fetchDiscoveryV2ModelQuote }): Promise<ModelProviderResponse> {
  // Own all caller-controlled values before the first await. The price/ledger awaits
  // cannot change the model, prompt, source domains or authority covered by the hash.
  const scope = structuredClone(options.scope), key = options.key, originalRequest = structuredClone(options.request);
  const ledger = options.ledger, prices = options.prices ?? fetchDiscoveryV2ModelQuote;
  const provider = options.provider ?? new OpenRouterAdapter();
  const quote = structuredClone(await prices(discoveryV2Model(key)));
  const boundedRequest = { ...originalRequest, requireReturnedModel: true, providerOnly: [key === "review:1" ? "anthropic" : "openai"] };
  const reservation = reserveDiscoveryV2(scope, key, boundedRequest, quote);
  const reserved = await ledger.reserve(reservation);
  if (!reserved.shouldCall) throw fail("Discovery attempt already reserved; no automatic replay or retry is permitted.");
  const limits = { prompt: quote.inputPerMillion, completion: quote.outputPerMillion, request: 0 as const };
  let response: ModelProviderResponse;
  try {
    response = phase(key) === "search"
      ? await provider.invokeWebSearch({ ...(boundedRequest as WebSearchModelRequest), providerPriceLimit: limits })
      : await provider.invokeStructured({ ...(boundedRequest as StructuredModelRequest), providerPriceLimit: limits });
  } catch (error) {
    const receipt = chargedReceipt(error);
    let settlementRecorded = false;
    try { await ledger.settle(key, receipt.amount, receipt.requestId); settlementRecorded = true; } catch { /* Reservation remains unresolved; preserve the known receipt below. */ }
    throw new ModelProviderError("provider_rejected", error instanceof Error ? error.message.slice(0, 500) : "Discovery provider failed; no retry is permitted.", false,
      { attemptKey: key, requestedModel: quote.modelId, settlementRecorded, providerReceipt: receipt.original });
  }
  response = structuredClone(response);
  const reported = response.usage.reportedCostUsd;
  const actual = typeof reported === "number" && Number.isFinite(reported) && reported >= 0 ? Math.ceil(reported * 1e6) : null;
  const returnedReceipt = { provider: response.provider, providerModelId: response.providerModelId,
    upstreamProvider: response.metadata.actualUpstreamProvider ?? null, providerRequestId: response.providerRequestId,
    latencyMs: response.latencyMs, usage: { ...response.usage } };
  const returnedFailure = (message: string, settlementRecorded: boolean) => new ModelProviderError("provider_rejected",message,false,
    {attemptKey:key,requestedModel:quote.modelId,settlementRecorded,providerReceipt:returnedReceipt});
  try { await ledger.settle(key, actual, response.providerRequestId); }
  catch { throw returnedFailure("Discovery returned, but settlement persistence failed; no further paid call is permitted.",false); }
  const permitted = key.startsWith("search:") ? ["openrouter.exa"] : key === "review:1" ? ["openrouter", "anthropic", "Anthropic"] : ["openrouter", "openai", "OpenAI"];
  const upstream = response.metadata.actualUpstreamProvider;
  const expectedUpstream = key === "review:1" ? ["anthropic","Anthropic"] : ["openai","OpenAI"];
  if (upstream !== undefined && upstream !== null && !expectedUpstream.includes(String(upstream))) throw returnedFailure("Returned discovery upstream differs from the pinned provider; its known charge is preserved.",true);
  if (response.providerModelId !== discoveryV2Model(key) || !permitted.includes(response.provider)) throw returnedFailure("Returned discovery model/provider differs from the approval; its known charge is preserved.",true);
  return { ...response, metadata: { ...response.metadata, discoveryBudget: { ...reservation.estimate,
    totalReservedMicrousd: reserved.totalReservedMicrousd, reportedMicrousd: actual, unknownCharge: actual === null } } };
}
