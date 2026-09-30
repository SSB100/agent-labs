import test from "node:test";
import assert from "node:assert/strict";
import budget from "../.core-tests/research/budget.js";
import registry from "../.core-tests/models/registry.js";
import models from "../.core-tests/models/openrouter.js";
import modelTypes from "../.core-tests/models/types.js";
import router from "../.core-tests/models/router.js";

const catalog = { data: [
  { id: "openai/gpt-5.6-luna", pricing: { prompt: "0.0000002", completion: "0.0000012", input_cache_read: "0.00000002", input_cache_write: "0.00000025", web_search: "0.01", overrides: [{ min_prompt_tokens: 272000, prompt: "0.0000004", completion: "0.0000018", input_cache_read: "0.00000004", input_cache_write: "0.0000005" }] } },
  { id: "google/gemini-3.6-flash", pricing: { prompt: "0.00000075", completion: "0.00000375", input_cache_read: "0.000000075", input_cache_write: "0.0000000416666666666667", internal_reasoning: "0.00000375" } },
] };
const quote = async modelId => budget.parseResearchPriceQuote(catalog, modelId);
const request = () => ({ model: registry.resolveModelRoute("standard.default").primary, schemaName: "budget_test", outputSchema: { type: "object", properties: {} }, messages: [{ role: "user", content: "Select one supplied evidence identifier." }], requestMetadata: {} });
const response = { output: {}, provider: "mock", providerModelId: "test", providerRequestId: "budget-test", latencyMs: 1,
  usage: { inputTokens: 20, outputTokens: 5, totalTokens: 25, cachedInputTokens: 0, reasoningTokens: 0, reportedCostUsd: 0.00001, estimatedCostUsd: 0.00001 }, metadata: {} };
function ledgerFixture() {
  const reservations = new Map(), settlements = [], state = { calls: 0 };
  return { reservations, settlements, state, ledger: {
    reserve: async reservation => {
      if (reservations.has(reservation.attemptKey)) return { shouldCall: false, totalReservedMicrousd: [...reservations.values()].reduce((sum, r) => sum + r.reservedMicrousd, 0) };
      const total = [...reservations.values()].reduce((sum, r) => sum + r.reservedMicrousd, reservation.reservedMicrousd);
      if (total > 1_000_000) throw new Error("Budget exhausted");
      reservations.set(reservation.attemptKey, reservation); return { shouldCall: true, totalReservedMicrousd: total };
    },
    settle: async (...args) => { settlements.push(args); },
  } };
}
test("current prices include long-context and cache-write allowances without claiming an invoice guarantee", async () => {
  const primary = await quote("openai/gpt-5.6-luna");
  assert.equal(primary.promptPerMillionUsd, 0.4); assert.equal(primary.completionPerMillionUsd, 1.8); assert.equal(primary.cacheWritePerMillionUsd, 0.5);
  const estimated = budget.estimateResearchReservation("search", { model: request().model, query: "Original camping T-shirt opportunity", allowedDomains: ["etsy.com", "printful.com"] }, primary);
  assert.equal(estimated.reservedMicrousd, 136600); assert.equal(estimated.estimate.inputTokenAllowance, 128000);
  assert.equal(estimated.estimate.outputTokenAllowance, 8000); assert.equal(estimated.estimate.providerInvoiceGuarantee, false);
  assert.equal(estimated.estimate.estimateOnly, true);
});
test("pricing preflight rejects unknown fees, missing models, corrupt prices and stale quotes", async () => {
  for (const mutation of [c => { c.data[0].pricing.new_fee = "0.01"; }, c => { c.data[0].pricing.request = "0.01"; }, c => { delete c.data[0].pricing.prompt; }, c => { c.data[0].pricing.completion = "invalid"; }, c => { c.data[0].pricing.overrides = "unknown"; }]) {
    const bad = structuredClone(catalog); mutation(bad); assert.throws(() => budget.parseResearchPriceQuote(bad, "openai/gpt-5.6-luna"));
  }
  assert.throws(() => budget.parseResearchPriceQuote(catalog, "unpriced/model"));
  const stale = { ...await quote(request().model.providerModelId), verifiedAt: "2000-01-01" };
  assert.throws(() => budget.estimateResearchReservation("selector", request(), stale), /Fresh pricing/);
});
test("selector preflight bounds assembled UTF8 input and 1000 output tokens", async () => {
  const estimated = budget.estimateResearchReservation("selector", request(), await quote(request().model.providerModelId));
  assert.equal(estimated.estimate.outputTokenAllowance, 1000);
  assert.equal(estimated.estimate.inputTokenAllowance, Buffer.byteLength(JSON.stringify(request())) + 8192);
  assert.throws(() => budget.estimateResearchReservation("selector", { ...request(), messages: [{ role: "user", content: "a".repeat(33000) }] }, budget.parseResearchPriceQuote(catalog, request().model.providerModelId)), /input budget/);
});
test("worst declared input allowance for all four attempts remains below approved one-dollar estimate", async () => {
  let total = 0;
  for (const model of registry.resolveModelRoute("standard.default").candidates) {
    const rates = await quote(model.providerModelId);
    total += budget.estimateResearchReservation("search", { model, query: "Candidate research", allowedDomains: ["etsy.com"] }, rates).reservedMicrousd;
    total += Math.ceil((32768 + 8192) * (Math.max(rates.promptPerMillionUsd, rates.cacheReadPerMillionUsd) + rates.cacheWritePerMillionUsd) + 1000 * rates.completionPerMillionUsd);
  }
  assert.equal(total, 349775); assert.ok(total < 1_000_000);
});
test("reservation is persisted before request, recorded charge remains separate and replay cannot call again", async () => {
  const fixture = ledgerFixture();
  const adapter = new budget.BudgetedResearchAdapter(fixture.ledger, { invokeStructured: async req => {
    assert.equal(fixture.reservations.size, 1); assert.equal(req.maxOutputTokens, 1000); assert.deepEqual(req.providerPriceLimit, { prompt: 0.4, completion: 1.8, request: 0 }); fixture.state.calls++; return response;
  } }, quote);
  const output = await adapter.invokeStructured(request());
  assert.equal(fixture.state.calls, 1); assert.deepEqual(fixture.settlements[0], ["selector:luna.standard", 10, "budget-test"]);
  assert.equal(output.metadata.budget.reportedMicrousd, 10);
  await assert.rejects(adapter.invokeStructured(request()), /already reserved/); assert.equal(fixture.state.calls, 1);
});
test("uncertain failed charge retains reservation and only recoverable failure can reach bounded fallback", async () => {
  const fixture = ledgerFixture(); let calls = 0;
  const adapter = new budget.BudgetedResearchAdapter(fixture.ledger, { invokeStructured: async () => { calls++; if (calls === 1) throw new modelTypes.ModelProviderError("provider_timeout", "Uncertain timeout", true); return response; } }, quote);
  await router.runModelRoute({ adapter, routeKey: "standard.default", schemaName: "budget", outputSchema: { type: "object" }, messages: [], maxOutputTokens: 1000 });
  assert.equal(calls, 2); assert.equal(fixture.reservations.size, 2);
  assert.deepEqual(fixture.settlements[0], ["selector:luna.standard", null, null]);
  await assert.rejects(adapter.invokeStructured(request()), /already reserved/); assert.equal(calls, 2);
});
test("failed preflight, exhausted envelope, or unpersisted settlement stops further provider calls", async () => {
  const fixture = ledgerFixture(); let calls = 0;
  const adapter = new budget.BudgetedResearchAdapter({ ...fixture.ledger, reserve: async () => { throw new Error("Budget exhausted"); } }, { invokeStructured: async () => { calls++; return response; } }, quote);
  await assert.rejects(router.runModelRoute({ adapter, routeKey: "standard.default", schemaName: "budget", outputSchema: { type: "object" }, messages: [] }), /Budget exhausted/); assert.equal(calls, 0);
  const unsettled = new budget.BudgetedResearchAdapter({ ...fixture.ledger, settle: async () => { throw new Error("Database unavailable"); } }, { invokeStructured: async () => { calls++; return response; } }, quote);
  await assert.rejects(router.runModelRoute({ adapter: unsettled, routeKey: "standard.default", schemaName: "budget", outputSchema: { type: "object" }, messages: [] }), /settlement/); assert.equal(calls, 1);
});
test("provider cap applies to both search and selection and disables extra provider fallback", async () => {
  const bodies = [];
  const adapter = new models.OpenRouterAdapter({ config: { apiKey: "test", baseUrl: "https://openrouter.ai/api/v1", appUrl: "https://agent-labs-two.vercel.app", appName: "Agent Labs" }, fetcher: async (_url, options) => {
    bodies.push(JSON.parse(options.body)); return new Response(JSON.stringify({ choices: [{ message: { content: "{}", annotations: [{ type: "url_citation" }] } }], usage: { server_tool_use_details: { web_search_requests: 1 } } }), { status: 200 });
  } });
  const providerPriceLimit = { prompt: 0.4, completion: 1.8, request: 0 };
  await adapter.invokeStructured({ ...request(), maxOutputTokens: 1000, providerPriceLimit });
  await adapter.invokeWebSearch({ model: request().model, query: "Candidate research", allowedDomains: ["etsy.com"], providerPriceLimit });
  for (const body of bodies) { assert.equal(body.provider.allow_fallbacks, false); assert.equal(body.provider.require_parameters, true); assert.deepEqual(body.provider.max_price, providerPriceLimit); }
  assert.equal(bodies[1].max_tool_calls, 1); assert.equal(bodies[1].tools[0].parameters.max_characters, 1800);
});
