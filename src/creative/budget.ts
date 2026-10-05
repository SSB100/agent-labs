import { createHash } from "node:crypto";
import type { JsonObject } from "../core/contracts";
import { OpenRouterAdapter } from "../models/openrouter";
import { ModelProviderError, type ModelDispatchAdmission, type ModelProviderAdapter, type ModelProviderResponse, type StructuredModelRequest } from "../models/types";
import { JsonSchemaValidationError } from "../workers/schema-validator";
import { creativeFailureMessage } from "./errors";

export const CREATIVE_BUDGET = { version: "creative-estimate-1.0", maximumMicrousd: 1_000_000,
  maximumTextRequestBytes: 24_576, formattingTokenAllowance: 8192, imageTokenAllowance: 8192,
  briefOutputTokens: 2500, reviewOutputTokens: 1800, maximumCalls: 6,
  pricingSource: "https://openrouter.ai/api/v1/models" } as const;
export type CreativeCallKey = "brief:1" | "screen:1" | "generate:1" | "review:1" | "generate:2" | "review:2";
export type CreativeModelCallKey = Exclude<CreativeCallKey, "generate:1" | "generate:2">;
export type CreativeModelQuote = { modelId: string; verifiedAt: string; source: string; inputPerMillion: number; outputPerMillion: number; cacheWritePerMillion: number };
export type CreativeReservation = { callKey: CreativeCallKey; reservedMicrousd: number; requestHash: string; model: string; provider: "openrouter"; estimate: JsonObject };
export interface CreativeLedger {
  admissionFor?(reservation: CreativeReservation): ModelDispatchAdmission;
  reserve(reservation: CreativeReservation): Promise<{ shouldExecute: boolean; committedMicrousd: number }>;
  record(callKey: CreativeCallKey, reportedMicrousd: number | null, providerRequestId: string | null, receipt: JsonObject): Promise<void>;
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const expectedModel = (key: CreativeModelCallKey) => key === "brief:1" ? "openai/gpt-5.6-luna" : "anthropic/claude-haiku-4.5";
const fail = (message: string) => new ModelProviderError("provider_rejected", message, false);
function rate(value: unknown, optional = false): number {
  if (optional && value === undefined) return 0;
  const n = typeof value === "string" && value.trim() ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1) throw fail("Creative model price is unavailable.");
  return Math.ceil(n * 1e15) / 1e9;
}
export function parseCreativeModelQuote(catalog: unknown, modelId: string, verifiedAt = new Date().toISOString()): CreativeModelQuote {
  if (!["openai/gpt-5.6-luna", "anthropic/claude-haiku-4.5"].includes(modelId) || !record(catalog) || !Array.isArray(catalog.data)) throw fail("Creative model is not explicitly priced.");
  const model = catalog.data.find(m => record(m) && m.id === modelId);
  if (!record(model) || !record(model.pricing)) throw fail("Current creative model pricing missing.");
  const p = model.pricing;
  const keys = new Set(["prompt", "completion", "request", "image", "web_search", "input_cache_read", "input_cache_write", "input_cache_write_1h", "internal_reasoning", "overrides"]);
  if (Object.keys(p).some(k => !keys.has(k) && Number(p[k]) !== 0) || rate(p.request, true) !== 0 || rate(p.image, true) !== 0 ||
    (p.overrides !== undefined && (!Array.isArray(p.overrides) || p.overrides.some(v => !record(v))))) throw fail("Unexpected creative model fees; review required.");
  const tiers = [p, ...(Array.isArray(p.overrides) ? p.overrides.filter(record) : [])];
  if (tiers.some(tier => Object.keys(tier).some(key => !keys.has(key) && key !== "min_prompt_tokens" && Number(tier[key]) !== 0))) throw fail("Unexpected creative price-tier fees; review required.");
  return { modelId, source: CREATIVE_BUDGET.pricingSource, verifiedAt,
    inputPerMillion: Math.max(...tiers.map(t => Math.max(rate(t.prompt ?? p.prompt), rate(t.input_cache_read ?? p.input_cache_read, true)))),
    outputPerMillion: Math.max(...tiers.map(t => Math.max(rate(t.completion ?? p.completion), rate(t.internal_reasoning ?? p.internal_reasoning, true)))),
    cacheWritePerMillion: Math.max(...tiers.map(t => Math.max(rate(t.input_cache_write ?? p.input_cache_write, true), rate(t.input_cache_write_1h ?? p.input_cache_write_1h, true)))) };
}
export async function fetchCreativeModelQuote(modelId: string, fetcher: typeof fetch = fetch): Promise<CreativeModelQuote> {
  const response = await fetcher(CREATIVE_BUDGET.pricingSource, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000) });
  if (!response.ok || !response.body) throw fail("Unable to verify current creative model prices.");
  const reader = response.body.getReader(), parts: Uint8Array[] = []; let size = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 2_000_000) throw fail("Price catalog exceeds the size limit."); parts.push(value); } }
  finally { await reader.cancel(); }
  return parseCreativeModelQuote(JSON.parse(Buffer.concat(parts).toString("utf8")), modelId);
}
export function creativeModelReservation(callKey: CreativeModelCallKey, request: StructuredModelRequest, quote: CreativeModelQuote): CreativeReservation {
  if (quote.modelId !== expectedModel(callKey) || request.model.providerModelId !== quote.modelId || !Number.isFinite(Date.parse(quote.verifiedAt)) ||
    Math.abs(Date.now() - Date.parse(quote.verifiedAt)) > 300000) throw fail("Fresh pricing for the fixed independent creative model is required.");
  const images = request.messages.flatMap(message => message.images ?? []);
  const visual = callKey.startsWith("review:");
  if (images.length !== (visual ? 1 : 0)) throw fail("The visual Reviewer must receive exactly one actual image; other phases receive no image.");
  const boundedText = { ...request, messages: request.messages.map(({ role, content }) => ({ role, content })) };
  const bytes = Buffer.byteLength(JSON.stringify(boundedText), "utf8");
  if (bytes > CREATIVE_BUDGET.maximumTextRequestBytes) throw fail("Creative context exceeds its declared input allowance.");
  const inputTokens = bytes + CREATIVE_BUDGET.formattingTokenAllowance + (visual ? CREATIVE_BUDGET.imageTokenAllowance : 0);
  const outputTokens = callKey === "brief:1" ? CREATIVE_BUDGET.briefOutputTokens : CREATIVE_BUDGET.reviewOutputTokens;
  if (request.maxOutputTokens !== outputTokens) throw fail("Creative output token limit does not match its phase.");
  const reservedMicrousd = Math.ceil(inputTokens * (quote.inputPerMillion + quote.cacheWritePerMillion) + outputTokens * quote.outputPerMillion);
  if (reservedMicrousd > CREATIVE_BUDGET.maximumMicrousd) throw fail("Creative model attempt exceeds the approved estimate.");
  return { callKey, reservedMicrousd, requestHash: createHash("sha256").update(JSON.stringify(request)).digest("hex"), model: quote.modelId, provider: "openrouter",
    estimate: { version: CREATIVE_BUDGET.version, inputTokenAllowance: inputTokens, outputTokenAllowance: outputTokens, textRequestBytes: bytes, quote: { ...quote }, estimateOnly: true, providerInvoiceGuarantee: false } };
}
/** No automatic model fallback: uncertain/replayed attempts stay spent until reconciled. */
export async function callCreativeModel(options: { callKey: CreativeModelCallKey; request: StructuredModelRequest; ledger: CreativeLedger;
  validateOutput: (output: JsonObject) => void; adapter?: ModelProviderAdapter; prices?: typeof fetchCreativeModelQuote }): Promise<ModelProviderResponse> {
  options = { ...options, request: structuredClone(options.request) };
  const quote = structuredClone(await (options.prices ?? fetchCreativeModelQuote)(options.request.model.providerModelId));
  const reservation = creativeModelReservation(options.callKey, options.request, quote);
  const reserved = await options.ledger.reserve(structuredClone(reservation));
  if (!reserved.shouldExecute) throw fail("Creative provider attempt was already reserved; automatic replay is blocked.");
  let response: ModelProviderResponse | null = null;
  try {
    response = await (options.adapter ?? new OpenRouterAdapter({ admitDispatch: options.ledger.admissionFor?.(reservation) })).invokeStructured({ ...options.request,
      providerOnly: [options.callKey === "brief:1" ? "openai" : "anthropic"],
      providerPriceLimit: { prompt: quote.inputPerMillion, completion: quote.outputPerMillion, request: 0 } });
    if (response.providerModelId !== quote.modelId) throw fail("Provider returned a different creative model; its charge is preserved for review.");
    const permittedProviders = options.callKey === "brief:1" ? ["openrouter", "openai", "OpenAI"] : ["openrouter", "anthropic", "Anthropic"];
    if (!permittedProviders.includes(response.provider)) throw fail("Provider returned an unexpected creative upstream; its charge is preserved for review.");
    options.validateOutput(response.output);
  } catch (error) {
    // Preserve useful validation paths without storing the rejected design or raw provider body.
    const validationIssues = error instanceof JsonSchemaValidationError ? error.issues.slice(0, 8).map(issue => ({
      path: issue.message !== "is not an allowed property" && /^[\w$.[\]-]{1,160}$/.test(issue.path) ? issue.path : "$", message: issue.message.slice(0, 180),
    })) : [];
    const failure = (creativeFailureMessage(error, "Creative model failed; no automatic retry.") +
      (validationIssues.length ? ` ${validationIssues.map(issue => `${issue.path}: ${issue.message}`).join("; ")}` : "")).slice(0, 500);
    const received = error instanceof ModelProviderError && record(error.details.providerReceipt) ? error.details.providerReceipt : null;
    const actual = response?.usage.reportedCostUsd ?? (received && record(received.usage) ? received.usage.reportedCostUsd : null);
    const requestId = response?.providerRequestId ?? (received && typeof received.providerRequestId === "string" ? received.providerRequestId : null);
    await options.ledger.record(options.callKey, typeof actual === "number" && Number.isFinite(actual) && actual >= 0 ? Math.ceil(actual * 1e6) : null, requestId,
      { model: quote.modelId, provider: "openrouter", providerRequestId: requestId, outputValidated: false, executionMode: "creative.model", mockProvider: false,
        actualProviderModelId: response?.providerModelId ?? (received && typeof received.providerModelId === "string" ? received.providerModelId : null),
        upstreamProvider: response?.provider ?? (received && typeof received.provider === "string" ? received.provider : null),
        ...(received ? { receivedProviderReceipt: received } : {}),
        failure, ...(validationIssues.length ? { validationIssues } : {}) }).catch(() => undefined);
    throw fail(failure);
  }
  const actual = response.usage.reportedCostUsd;
  await options.ledger.record(options.callKey, actual === null ? null : Math.ceil(actual * 1e6), response.providerRequestId,
    { model: quote.modelId, provider: "openrouter", providerRequestId: response.providerRequestId, outputValidated: true, executionMode: "creative.model", mockProvider: false,
      actualProviderModelId: response.providerModelId, upstreamProvider: response.provider,
      inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens, reportedCostUsd: actual, estimatedCostUsd: response.usage.estimatedCostUsd, latencyMs: response.latencyMs });
  return response;
}
