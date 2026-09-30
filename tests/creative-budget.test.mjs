import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const budget = require("../.core-tests/creative/budget.js");
const { resolveModelRoute } = require("../.core-tests/models/registry.js");
const catalog = { data: [
  { id: "openai/gpt-5.6-luna", pricing: { prompt: "0.0000002", completion: "0.0000012", input_cache_write: "0.00000025", overrides: [{ prompt: "0.0000004", completion: "0.0000018", input_cache_write: "0.0000005" }] } },
  { id: "anthropic/claude-haiku-4.5", pricing: { prompt: "0.000001", completion: "0.000005", input_cache_write: "0.00000125", input_cache_write_1h: "0.000002" } },
] };
function request(key) { return { model: resolveModelRoute(key === "brief:1" ? "standard.default" : "reviewer.independent").primary, schemaName: "creative_test", outputSchema: { type: "object" }, messages: [{ role: "user", content: "Bounded synthetic context", ...(key.startsWith("review:") ? { images: [{ mediaType: "image/png", base64: "fixture-not-sent" }] } : {}) }], maxOutputTokens: key === "brief:1" ? 2500 : 1800, requestMetadata: {} }; }
const quote = model => budget.parseCreativeModelQuote(catalog, model);
test("creative estimates reserve worst catalog cache tier, bounded input and actual-image allowance", () => {
  const brief = request("brief:1"), screen = request("screen:1"), review = request("review:1");
  assert.equal(quote(brief.model.providerModelId).inputPerMillion, 0.4);
  assert.equal(quote(screen.model.providerModelId).cacheWritePerMillion, 2);
  const s = budget.creativeModelReservation("screen:1", screen, quote(screen.model.providerModelId));
  const r = budget.creativeModelReservation("review:1", review, quote(review.model.providerModelId));
  assert.equal(r.reservedMicrousd - s.reservedMicrousd, 8192 * 3);
  assert.equal(r.estimate.providerInvoiceGuarantee, false);
  assert.throws(() => budget.creativeModelReservation("review:1", { ...review, messages: [{ role: "user", content: "No pixels" }] }, quote(review.model.providerModelId)), /actual image/);
  assert.throws(() => budget.creativeModelReservation("screen:1", { ...screen, messages: [{ role: "user", content: "x".repeat(25000) }] }, quote(screen.model.providerModelId)), /input allowance/);
  assert.throws(() => budget.creativeModelReservation("screen:1", brief, quote(brief.model.providerModelId)), /independent/);
});
test("unpriced fees, wrong model, stale quote and widened token cap stop before spending", () => {
  const r = request("brief:1"), q = quote(r.model.providerModelId);
  const changed = structuredClone(catalog); changed.data[0].pricing.unknown_fee = 0.1;
  assert.throws(() => budget.parseCreativeModelQuote(changed, r.model.providerModelId), /fees/);
  assert.throws(() => budget.parseCreativeModelQuote(catalog, "other/model"), /priced/);
  assert.throws(() => budget.creativeModelReservation("brief:1", r, { ...q, verifiedAt: "2000-01-01T00:00:00Z" }), /Fresh/);
  assert.throws(() => budget.creativeModelReservation("brief:1", { ...r, maxOutputTokens: 2501 }, q), /token limit/);
});
test("creative provider failure and replay retain reservations, invalid paid outputs retain actual cost", async () => {
  const reservations = new Set(), receipts = []; let calls = 0;
  const ledger = { reserve: async r => { const shouldExecute = !reservations.has(r.callKey); reservations.add(r.callKey); return { shouldExecute, committedMicrousd: r.reservedMicrousd }; }, record: async (...args) => receipts.push(args) };
  const adapter = { invokeStructured: async () => { calls++; return { output: {}, provider: "openrouter", providerModelId: "openai/gpt-5.6-luna", providerRequestId: "receipt-1", usage: { reportedCostUsd: 0.003, estimatedCostUsd: 0.003, inputTokens: 100, outputTokens: 10 }, latencyMs: 1 }; } };
  const options = { callKey: "brief:1", request: request("brief:1"), ledger, adapter, prices: async m => quote(m), validateOutput: () => { throw Error("Invalid brief"); } };
  await assert.rejects(() => budget.callCreativeModel(options), /Invalid brief/);
  assert.equal(receipts[0][1], 3000); assert.equal(receipts[0][3].outputValidated, false);
  await assert.rejects(() => budget.callCreativeModel(options), /replay/); assert.equal(calls, 1);
});

test("malformed paid text retains provider receipt and mismatched identity remains explicit", async () => {
  const { OpenRouterAdapter } = require("../.core-tests/models/openrouter.js");
  for (const mismatch of [false, true]) {
    const receipts = []; let calls = 0;
    const adapter = new OpenRouterAdapter({ config: { apiKey: "mock-only", baseUrl: "https://openrouter.ai/api/v1", appUrl: "https://example.invalid", appName: "Mock" },
      fetcher: async () => { calls++; return new Response(JSON.stringify({ id: "known-paid-response", model: mismatch ? "other/model" : "openai/gpt-5.6-luna", provider: "OpenAI", choices: [{ message: { content: mismatch ? "{}" : "{malformed" } }], usage: { cost: 0.002, prompt_tokens: 20, completion_tokens: 10 } }), { status: 200, headers: { "content-type": "application/json" } }); } });
    const ledger = { reserve: async () => ({ shouldExecute: true, committedMicrousd: 20000 }), record: async (...args) => receipts.push(args) };
    await assert.rejects(() => budget.callCreativeModel({ callKey: "brief:1", request: request("brief:1"), ledger, adapter, prices: async model => quote(model), validateOutput: () => {} }));
    assert.equal(calls, 1); assert.equal(receipts[0][1], 2000); assert.equal(receipts[0][2], "known-paid-response");
    assert.equal(receipts[0][3].outputValidated, false);
    assert.equal(receipts[0][3].actualProviderModelId, mismatch ? "other/model" : "openai/gpt-5.6-luna");
  }
});
