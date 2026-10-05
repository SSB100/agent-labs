import test from "node:test";
import assert from "node:assert/strict";
import quoteModule from "../.core-tests/research/qualification-quote.js";

const { PUBLIC_RESEARCH_QUOTE_LIMITS: limits, qualifyPublicResearchQuote, validatePublicResearchQuote, fetchPublicResearchQuote } = quoteModule;
const now = Date.parse("2026-10-05T03:43:00.000Z");
// Inert snapshot of public endpoint facts. No credential, inference or paid call.
const endpoint = {
  name: "Azure | openai/gpt-5.6-luna-20260709", model_id: "openai/gpt-5.6-luna", provider_name: "Azure", tag: "azure/us", status: 0,
  context_length: 1_050_000, max_completion_tokens: 128_000,
  supported_parameters: ["reasoning", "include_reasoning", "max_completion_tokens", "tools", "tool_choice", "seed", "response_format", "structured_outputs", "verbosity", "reasoning_effort"],
  pricing: { prompt: "0.00000022", completion: "0.00000132", web_search: "0.01", input_cache_read: "0.000000022", input_cache_write: "0.000000275", discount: 0,
    overrides: [{ min_prompt_tokens: 272_000, prompt: "0.00000044", completion: "0.00000198", input_cache_read: "0.000000044", input_cache_write: "0.00000055" }] },
};
function fixture() {
  return { now, modelCatalog: { url: limits.modelCatalogUrl, fetchedAt: new Date(now).toISOString(),
    payload: { data: { id: limits.modelId, name: "GPT-5.6 Luna", endpoints: [structuredClone(endpoint)] } } },
  zdrCatalog: { url: limits.zdrCatalogUrl, fetchedAt: new Date(now).toISOString(), payload: { data: [structuredClone(endpoint)] } } };
}
function mutateEndpoints(input, mutate) {
  mutate(input.modelCatalog.payload.data.endpoints[0]); mutate(input.zdrCatalog.payload.data[0]); return input;
}
const reject = value => assert.throws(() => qualifyPublicResearchQuote(value), /public_research_quote_unavailable/);

test("R11 exact Azure regional quote includes conservative worst tiers, cache writes, one Exa fee and bounded selector", () => {
  const result = qualifyPublicResearchQuote(fixture());
  assert.equal(result.modelId, "openai/gpt-5.6-luna");
  assert.equal(result.providerEndpoint, "azure/us");
  assert.equal(result.providerName, "Azure", "Expected returned provider name is not the routing tag");
  assert.deepEqual(result.priceLimit, { prompt: 0.44, completion: 1.98, request: 0 });
  assert.deepEqual(result.tokenPricesUsd, { prompt: "0.00000044", completion: "0.00000198", cacheRead: "0.000000044", cacheWrite: "0.00000055", reasoning: "0" });
  assert.equal(result.searchMicrousd, 149_560);
  assert.equal(result.selectorMicrousd, 26_311);
  assert.equal(result.totalMicrousd, 175_871);
  assert.equal(result.maximumMicrousd, 250_000);
  assert.equal(result.allowances.searchInputTokens, 128_000);
  assert.equal(result.allowances.searchOutputTokens, 8_000);
  assert.equal(result.allowances.maximumSelectorRequestBytes, 16_384);
  assert.equal(result.allowances.selectorFormattingTokens, 8_192);
  assert.equal(result.allowances.selectorOutputTokens, 1_000);
  assert.equal(result.allowances.searchRequests, 1);
  assert.equal(result.allowances.exaFastSearchFeeMicrousd, 7_000, "Native endpoint web_search fee is not the Exa server-tool fee");
  assert.equal(result.verifiedAt, "2026-10-05T03:43:00.000Z");
  assert.equal(result.validUntil, "2026-10-05T03:48:00.000Z");
  assert.equal(result.quoteValidUntil, result.validUntil);
  assert.match(result.quoteHash, /^[a-f0-9]{64}$/);
  assert.equal(result.sourceHashes.modelCatalog, result.sourceHashes.zdrCatalog);
  validatePublicResearchQuote(result, now);
});

test("R11 same endpoint facts retain immutable approval hash after fresh retrieval", () => {
  const original = qualifyPublicResearchQuote(fixture());
  const refreshed = fixture(); refreshed.now += 120_000;
  refreshed.modelCatalog.fetchedAt = refreshed.zdrCatalog.fetchedAt = new Date(refreshed.now).toISOString();
  mutateEndpoints(refreshed, value => { value.uptime_last_5m = 99; value.latency_last_30m = { p50: 0.25 }; value.supported_parameters.reverse(); });
  refreshed.modelCatalog.payload.data.endpoints.unshift({ ...endpoint, tag: "azure", pricing: { prompt: "0.0000002" } });
  refreshed.zdrCatalog.payload.data.push({ model_id: "unrelated/model", tag: "other" });
  const result = qualifyPublicResearchQuote(refreshed);
  assert.equal(result.quoteHash, original.quoteHash);
  assert.notEqual(result.verifiedAt, original.verifiedAt);
  assert.notEqual(result.validUntil, original.validUntil);
});

test("R11 changed exact endpoint price, tier, context, identity or capability changes quote hash", () => {
  const original = qualifyPublicResearchQuote(fixture());
  for (const mutate of [
    value => { value.pricing.overrides[0].prompt = "0.00000045"; },
    value => { value.pricing.overrides[0].min_prompt_tokens = 300_000; },
    value => { value.context_length += 1; },
    value => { value.max_completion_tokens += 1; },
    value => { value.max_prompt_tokens = 1_000_000; },
    value => { value.name += "-revision"; },
    value => { value.supported_parameters.push("temperature"); },
  ]) assert.notEqual(qualifyPublicResearchQuote(mutateEndpoints(fixture(), mutate)).quoteHash, original.quoteHash);
});

test("R11 catalog URLs are exact public sources and cannot be aliases, injected URLs or stale snapshots", () => {
  for (const catalog of ["modelCatalog", "zdrCatalog"]) {
    for (const url of ["https://example.com/catalog", limits[catalog === "modelCatalog" ? "modelCatalogUrl" : "zdrCatalogUrl"] + "?key=x", limits.modelCatalogUrl.replace("azure", "other" ) + "/"]) {
      const input = fixture(); input[catalog].url = url; reject(input);
    }
    for (const fetchedAt of ["invalid", new Date(now + 1).toISOString(), new Date(now - 300_000).toISOString(), new Date(now - 300_001).toISOString()]) {
      const input = fixture(); input[catalog].fetchedAt = fetchedAt; reject(input);
    }
  }
  const input = fixture(); input.modelCatalog.fetchedAt = new Date(now - 299_999).toISOString();
  const result = qualifyPublicResearchQuote(input);
  assert.equal(Date.parse(result.validUntil) - now, 1, "Expiry uses older source, never newer source");
  assert.throws(() => validatePublicResearchQuote(result, now + 1), /public_research_quote_unavailable/);
});

test("R11 exact model and endpoint must occur once in both catalogs; model-wide ZDR flags cannot qualify", () => {
  for (const catalog of ["modelCatalog", "zdrCatalog"]) {
    for (const mutate of [
      value => { value.tag = "azure"; }, value => { value.tag = "azure/eu"; }, value => { value.tag = "azure/us/extra"; },
      value => { value.model_id = "openai/gpt-5.6-luna:online"; }, value => { value.model_id = "openai/gpt-5.6-luna-20260709"; },
      value => { value.provider_name = "OpenAI"; }, value => { value.provider_name = "azure/us"; },
    ]) {
      const input = fixture(); const rows = catalog === "modelCatalog" ? input.modelCatalog.payload.data.endpoints : input.zdrCatalog.payload.data;
      mutate(rows[0]); reject(input);
    }
    const duplicate = fixture();
    const rows = catalog === "modelCatalog" ? duplicate.modelCatalog.payload.data.endpoints : duplicate.zdrCatalog.payload.data;
    rows.push(structuredClone(endpoint)); reject(duplicate);
  }
  const missing = fixture(); missing.zdrCatalog.payload.data = []; missing.modelCatalog.payload.data.endpoints[0].zdr = true; reject(missing);
  const wrongModel = fixture(); wrongModel.modelCatalog.payload.data.id = "openai/gpt-5.6-luna:online"; reject(wrongModel);
});

test("R11 endpoint status, exact necessary capabilities and usable token ceilings are fail closed", () => {
  for (const mutate of [
    value => { value.status = 1; }, value => { delete value.status; }, value => { value.status = "0"; },
    value => { value.context_length = 135_999; }, value => { value.context_length = "1050000"; },
    value => { value.max_completion_tokens = 7_999; }, value => { delete value.max_completion_tokens; },
    value => { value.max_prompt_tokens = 127_999; }, value => { value.max_prompt_tokens = 1.5; },
    value => { value.name = ""; }, value => { value.supported_parameters.push("tools"); },
    ...["tools", "tool_choice", "max_completion_tokens", "structured_outputs", "response_format", "reasoning"].map(parameter =>
      value => { value.supported_parameters = value.supported_parameters.filter(item => item !== parameter); }),
  ]) reject(mutateEndpoints(fixture(), mutate));
});

test("R11 mismatched catalogs cannot qualify a route with one stale price, context or provider fact", () => {
  for (const mutate of [value => { value.pricing.prompt = "0.00000021"; }, value => { value.context_length += 1; }, value => { value.name += "v2"; }]) {
    const input = fixture(); mutate(input.zdrCatalog.payload.data[0]); reject(input);
  }
});

test("R11 price strings have exact decimal units and reject coercion, negatives, overflow and malformed tiers", () => {
  for (const price of [0.00000022, null, "", " 0.00000022 ", "2.2e-7", "NaN", "Infinity", "-0.1", "1.1", "0.0000000000000000001", "0x1", "0", "00.1"]) {
    reject(mutateEndpoints(fixture(), value => { value.pricing.prompt = price; }));
  }
  for (const mutate of [
    value => { delete value.pricing.completion; },
    value => { value.pricing.request = "0.000001"; },
    value => { value.pricing.overrides[0].request = "0.000001"; },
    value => { value.pricing.unknown_fee = "0.01"; },
    value => { value.pricing.overrides[0].unknown_fee = "0.01"; },
    value => { value.pricing.image = "0.01"; },
    value => { value.pricing.discount = 0.1; },
    value => { value.pricing.overrides = {}; },
    value => { value.pricing.overrides = [null]; },
    value => { delete value.pricing.overrides[0].min_prompt_tokens; },
    value => { value.pricing.overrides[0].min_prompt_tokens = "272000"; },
    value => { value.pricing.overrides[0].min_prompt_tokens = -1; },
    value => { value.pricing.overrides.push(structuredClone(value.pricing.overrides[0])); },
  ]) reject(mutateEndpoints(fixture(), mutate));
});

test("R11 reserves cache-read and reasoning worst-case prices and inherits unspecified tier rates", () => {
  const input = mutateEndpoints(fixture(), value => {
    value.pricing.input_cache_read = "0.0000005"; value.pricing.internal_reasoning = "0.000002";
    value.pricing.overrides[0] = { min_prompt_tokens: 272_000, input_cache_write: "0.0000006" };
  });
  const result = qualifyPublicResearchQuote(input);
  assert.equal(result.priceLimit.prompt, 0.22);
  assert.equal(result.priceLimit.completion, 2);
  assert.equal(result.searchMicrousd, 163_800);
  assert.equal(result.selectorMicrousd, 29_034);
});

test("R11 exact arithmetic rounds each reservation upward without decimal floating-point artifacts", () => {
  const input = mutateEndpoints(fixture(), value => {
    value.pricing = { prompt: "0.0000001", completion: "0.0000001", input_cache_write: "0.000000000000000001", request: "0" };
  });
  const result = qualifyPublicResearchQuote(input);
  assert.equal(result.searchMicrousd, 20_601, "Sub-microusd liability still rounds up");
  assert.equal(result.selectorMicrousd, 2_558);
});

test("R11 quote is constrained by proposed total cap, never creates approval, and cannot silently raise it", () => {
  for (const maximumMicrousd of [0, -1, 250_001, Infinity, 175_870, "250000", 250_000.1]) reject({ ...fixture(), maximumMicrousd });
  const result = qualifyPublicResearchQuote({ ...fixture(), maximumMicrousd: 175_871 });
  assert.equal(result.totalMicrousd, result.maximumMicrousd);
  assert.equal(result.approved, undefined);
  assert.equal(result.approvalHash, undefined);
  reject(mutateEndpoints(fixture(), value => { value.pricing.overrides[0].input_cache_write = "0.0000015"; }));
});

test("R11 quote integrity validation rejects mutated caps, reservations, sources, identity, limits and expiry", () => {
  const original = qualifyPublicResearchQuote(fixture());
  for (const mutate of [
    value => { value.priceLimit.prompt = 0.2; }, value => { value.priceLimit.request = 1; },
    value => { value.tokenPricesUsd.cacheWrite = "0"; }, value => { value.searchMicrousd -= 1; },
    value => { value.selectorMicrousd -= 1; }, value => { value.totalMicrousd -= 1; },
    value => { value.maximumMicrousd = 250_001; }, value => { value.providerEndpoint = "azure"; },
    value => { value.providerName = "OpenAI"; }, value => { value.allowances.searchRequests = 2; },
    value => { value.sourceHashes.zdrCatalog = "a".repeat(64); }, value => { value.quoteHash = "a".repeat(64); },
    value => { value.validUntil = new Date(now + 300_001).toISOString(); },
    value => { value.quoteValidUntil = new Date(now + 300_001).toISOString(); },
    value => { value.verifiedAt = new Date(now + 1).toISOString(); },
  ]) { const result = structuredClone(original); mutate(result); assert.throws(() => validatePublicResearchQuote(result, now), /public_research_quote_unavailable/); }
});

function transport(overrides = {}) {
  const input = fixture(), calls = [];
  return { calls, fetch: async (url, init) => {
    calls.push({ url, init });
    if (overrides.handler) return overrides.handler(url, init, calls.length);
    return new Response(JSON.stringify(url === limits.modelCatalogUrl ? input.modelCatalog.payload : input.zdrCatalog.payload),
      { status: overrides.status ?? 200, headers: overrides.headers });
  } };
}

test("R11 fresh quote acquisition performs only two unauthenticated GETs on fixed exact public catalogs", async () => {
  const seen = transport();
  const result = await fetchPublicResearchQuote({ fetch: seen.fetch, now: () => now });
  assert.deepEqual(result, qualifyPublicResearchQuote(fixture()));
  assert.deepEqual(seen.calls.map(call => call.url), [limits.modelCatalogUrl, limits.zdrCatalogUrl]);
  for (const { init } of seen.calls) {
    assert.equal(init.method, "GET"); assert.equal(init.body, undefined);
    assert.deepEqual(init.headers, { Accept: "application/json", "Cache-Control": "no-cache" });
    assert.equal(init.credentials, "omit"); assert.equal(init.redirect, "error"); assert.equal(init.cache, "no-store");
    assert.equal(init.signal.aborted, false);
  }
});

test("R11 failed public catalogs never trigger a credential lookup, qualification POST, retry or alternate route", async () => {
  for (const handler of [
    async () => new Response("{}", { status: 403 }),
    async () => new Response("{}", { status: 404 }),
    async () => new Response("{}", { status: 503 }),
    async () => new Response("<html>not json</html>"),
    async () => { throw new Error("network unavailable"); },
    async () => new Response("{}", { headers: { age: "300" } }),
    async () => new Response("{}", { headers: { age: "-1" } }),
    async () => new Response("{}", { headers: { age: "invalid" } }),
    async () => new Response(" ".repeat(8_000_001)),
  ]) {
    const seen = transport({ handler });
    await assert.rejects(fetchPublicResearchQuote({ fetch: seen.fetch, now: () => now }), /public_research_quote_unavailable/);
    assert.equal(seen.calls.length, 1);
    assert.equal(seen.calls[0].url, limits.modelCatalogUrl);
  }
});

test("R11 stale cached or delayed responses cannot receive a new full freshness window", async () => {
  const seen = transport({ headers: { age: "120" } });
  const result = await fetchPublicResearchQuote({ fetch: seen.fetch, now: () => now });
  assert.equal(result.verifiedAt, new Date(now - 120_000).toISOString());
  assert.equal(result.validUntil, new Date(now + 180_000).toISOString());
  const delayed = transport(); let reads = 0;
  await assert.rejects(fetchPublicResearchQuote({ fetch: delayed.fetch, now: () => now + (reads++ === 0 ? 0 : 300_000) }), /public_research_quote_unavailable/);
  assert.equal(delayed.calls.length, 2);
});

test("R11 redirects and wrong response origins are rejected even with a custom transport", async () => {
  for (const property of [{ redirected: true }, { url: "https://unreviewed.example.com/endpoints" }]) {
    const seen = transport({ handler: async () => {
      const response = new Response("{}");
      for (const [key, value] of Object.entries(property)) Object.defineProperty(response, key, { value });
      return response;
    } });
    await assert.rejects(fetchPublicResearchQuote({ fetch: seen.fetch, now: () => now }), /public_research_quote_unavailable/);
    assert.equal(seen.calls.length, 1);
  }
});
