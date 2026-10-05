import test from "node:test";
import assert from "node:assert/strict";
import models from "../.core-tests/models/openrouter.js";
import registry from "../.core-tests/models/registry.js";

const config = { apiKey: "inert-r11-test-key", baseUrl: "https://openrouter.ai/api/v1", appUrl: "https://example.com", appName: "R11 fixture" };
const exactControls = { providerOnly: ["azure/us"], providerDataCollection: "deny", providerZdr: true,
  providerPriceLimit: { prompt: 0.44, completion: 1.98, request: 0 } };
const annotation = { type: "url_citation", url_citation: { url: "https://example.com/research", title: "Fixture",
  content: "This is an inert public-source fixture containing an inspectable factual excerpt." } };
function request(kind, extras = {}) {
  const model = structuredClone(registry.resolveModelRoute("standard.default").primary);
  return kind === "search" ? { model, query: "What public product comparison facts are available?", allowedDomains: ["example.com"], ...extras }
    : { model, schemaName: "r11_selector_fixture", outputSchema: { type: "object", properties: { selected: { type: "boolean" } } },
      messages: [{ role: "user", content: "Select only supplied factual evidence." }], requestMetadata: { phase: "selector" }, ...extras };
}
const invoke = (adapter, kind, input) => kind === "search" ? adapter.invokeWebSearch(input) : adapter.invokeStructured(input);
function fixture(kind, options = {}) {
  const seen = { admissions: [], calls: [] };
  const adapter = new models.OpenRouterAdapter({ config,
    admitDispatch: async value => { seen.admissions.push(structuredClone(value)); await options.admit?.(value); },
    fetcher: async (url, init) => {
      seen.calls.push({ url, body: JSON.parse(init.body), wire: init.body, redirect: init.redirect });
      if (options.fetcher) return options.fetcher(url, init);
      return new Response(JSON.stringify({ id: "r11-fixture", provider: "Azure",
        ...(options.omitModel ? {} : { model: "openai/gpt-5.6-luna" }),
        choices: [{ finish_reason: "stop", message: kind === "search" ? { content: "Fixture", annotations: [annotation] } : { content: '{"selected":true}' } }],
        usage: { prompt_tokens: 20, completion_tokens: 10, cost: 0.0071,
          ...(kind === "search" ? { server_tool_use: { web_search_requests: 1 } } : {}) } }), { status: 200 });
    } });
  return { adapter, seen };
}

test("R11 Exa wire has both provider-side domain filters and exact inference-only privacy routing", async () => {
  const { adapter, seen } = fixture("search");
  await adapter.invokeWebSearch(request("search", { ...exactControls, excludedDomains: ["blocked.example.com", "etsy.com"] }));
  assert.equal(seen.calls.length, 1);
  const body = seen.calls[0].body;
  assert.deepEqual(body.provider, { allow_fallbacks: false, require_parameters: true, max_price: exactControls.providerPriceLimit,
    only: ["azure/us"], data_collection: "deny", zdr: true });
  assert.deepEqual(body.tools, [{ type: "openrouter:web_search", parameters: { engine: "exa", mode: "fast", max_uses: 1,
    max_results: 4, max_total_results: 4, max_characters: 1800, allowed_domains: ["example.com"], excluded_domains: ["blocked.example.com", "etsy.com"] } }]);
  assert.equal(body.tool_choice, "required");
  assert.equal(body.max_tool_calls, 1);
  assert.equal(body.max_tokens, 4000);
  assert.equal(body.stream, false);
  assert.equal(body.plugins, undefined);
  assert.equal(body.tools[0].parameters.zdr, undefined, "Inference ZDR must not imply backend ZDR");
  assert.equal(seen.admissions[0].body, seen.calls[0].wire);
  assert.equal(seen.calls[0].redirect, "error");
});

test("R11 selector uses the same exact endpoint/privacy controls without adding a search tool", async () => {
  const { adapter, seen } = fixture("selector");
  await adapter.invokeStructured(request("selector", { ...exactControls, maxOutputTokens: 1000, reasoning: { effort: "none" } }));
  const body = seen.calls[0].body;
  assert.deepEqual(body.provider, { allow_fallbacks: false, require_parameters: true, max_price: exactControls.providerPriceLimit,
    only: ["azure/us"], data_collection: "deny", zdr: true });
  assert.equal(body.tools, undefined);
  assert.equal(body.max_tokens, 1000);
  assert.deepEqual(body.reasoning, { effort: "none" });
  assert.equal(body.response_format.type, "json_schema");
});

test("R11 additive controls preserve established routes when omitted", async () => {
  for (const kind of ["search", "selector"]) {
    const { adapter, seen } = fixture(kind);
    await invoke(adapter, kind, request(kind));
    const body = seen.calls[0].body;
    if (kind === "search") {
      assert.equal(body.provider, undefined);
      assert.equal(body.tools[0].parameters.excluded_domains, undefined);
    } else assert.deepEqual(body.provider, { allow_fallbacks: true, require_parameters: true });
  }
});

test("R11 optional privacy controls are emitted independently and reject weakening values", async () => {
  for (const kind of ["search", "selector"]) {
    for (const controls of [{ providerDataCollection: "deny" }, { providerZdr: true }]) {
      const { adapter, seen } = fixture(kind);
      await invoke(adapter, kind, request(kind, controls));
      assert.equal(seen.calls[0].body.provider.data_collection, controls.providerDataCollection);
      assert.equal(seen.calls[0].body.provider.zdr, controls.providerZdr);
    }
    for (const controls of [{ providerDataCollection: "allow" }, { providerDataCollection: null }, { providerZdr: false }, { providerZdr: "true" }, { providerZdr: null }]) {
      const { adapter, seen } = fixture(kind);
      await assert.rejects(invoke(adapter, kind, request(kind, controls)), /Invalid inference privacy/);
      assert.equal(seen.admissions.length, 0);
      assert.equal(seen.calls.length, 0);
    }
  }
});

test("R11 exact endpoint slugs retain their suffix and never broaden to the base route", async () => {
  for (const kind of ["search", "selector"]) {
    for (const slug of ["azure", "azure/us", "google-vertex/us-east5", "amazon-bedrock/us-east-1", "deepinfra/turbo"]) {
      const { adapter, seen } = fixture(kind);
      await invoke(adapter, kind, request(kind, { providerOnly: [slug] }));
      assert.deepEqual(seen.calls[0].body.provider.only, [slug]);
      assert.equal(seen.calls[0].body.provider.allow_fallbacks, false);
    }
    for (const providerOnly of [[], ["azure/us", "openai"], ["azure/"], ["azure//us"], ["azure/us/extra"], ["Azure/us"], ["azure/../us"], ["azure/us?fallback=openai"], [" azure/us"], ["https://azure/us"], ["azure/" + "a".repeat(61)], [null], "azure/us", null]) {
      const { adapter, seen } = fixture(kind);
      await assert.rejects(invoke(adapter, kind, request(kind, { providerOnly })), /Invalid fixed provider/);
      assert.equal(seen.admissions.length, 0);
      assert.equal(seen.calls.length, 0);
    }
  }
});

test("R11 exclusions opt into bounded canonical allow/exclude hostname validation before admission", async () => {
  const invalidDomains = ["Example.com", "example.com.", "https://example.com", "example.com/path", "*.example.com", "example.com:443",
    "user@example.com", "-bad.example.com", "bad-.example.com", "under_score.example.com", "127.0.0.1", "localhost", "example.local", "example.internal", "a".repeat(64) + ".com", "a".repeat(201), null, 4];
  const invalidFilters = [
    ...invalidDomains.flatMap(domain => [{ allowedDomains: [domain], excludedDomains: [] }, { excludedDomains: [domain] }]),
    { allowedDomains: [], excludedDomains: [] }, { allowedDomains: null, excludedDomains: [] },
    { allowedDomains: new Array(1), excludedDomains: [] }, { excludedDomains: new Array(1) },
    { allowedDomains: ["example.com", "example.com"], excludedDomains: [] },
    { allowedDomains: Array.from({ length: 7 }, (_, i) => `a${i}.example.com`), excludedDomains: [] },
    { excludedDomains: ["example.com", "example.com"] }, { excludedDomains: null }, { excludedDomains: "example.com" },
    { excludedDomains: Array.from({ length: 33 }, (_, i) => `a${i}.example.com`) },
  ];
  for (const filters of invalidFilters) {
    const { adapter, seen } = fixture("search");
    await assert.rejects(adapter.invokeWebSearch(request("search", filters)), /Invalid bounded research domain/);
    assert.equal(seen.admissions.length, 0);
    assert.equal(seen.calls.length, 0);
  }
  const { adapter, seen } = fixture("search");
  await adapter.invokeWebSearch(request("search", { excludedDomains: [] }));
  assert.deepEqual(seen.calls[0].body.tools[0].parameters.excluded_domains, []);
});

test("R11 admission cannot change caller-owned wire controls, model identity or receipt metadata", async () => {
  for (const kind of ["search", "selector"]) {
    const input = request(kind, { ...structuredClone(exactControls), ...(kind === "search" ? { excludedDomains: ["etsy.com"] } : {}), requireReturnedModel: false });
    const original = structuredClone(input);
    const { adapter, seen } = fixture(kind, { omitModel: true, admit: async admission => {
      input.providerOnly[0] = "openai";
      input.providerPriceLimit.prompt = 999;
      input.providerDataCollection = "allow";
      input.providerZdr = false;
      input.model.providerModelId = "changed/model";
      input.model.modelKey = "changed-model-key";
      input.model.pricing.inputPerMillionUsd = 999;
      input.requireReturnedModel = true;
      if (kind === "search") { input.allowedDomains.push("unapproved.com"); input.excludedDomains.length = 0; input.query = "Changed private query"; }
      else { input.messages[0].content = "Changed prompt"; input.outputSchema.properties.injected = { type: "string" }; input.requestMetadata.phase = "changed"; }
      admission.body = "{}";
      admission.url = "https://unapproved.example.com";
      await Promise.resolve();
    } });
    const response = await invoke(adapter, kind, input);
    const body = seen.calls[0].body;
    assert.equal(body.model, original.model.providerModelId);
    assert.deepEqual(body.provider.only, ["azure/us"]);
    assert.deepEqual(body.provider.max_price, original.providerPriceLimit);
    assert.equal(body.provider.data_collection, "deny");
    assert.equal(body.provider.zdr, true);
    assert.equal(seen.calls[0].url, config.baseUrl + "/chat/completions");
    assert.equal(seen.calls[0].wire, seen.admissions[0].body);
    assert.equal(response.providerModelId, original.model.providerModelId);
    assert.equal(response.metadata.modelKey, original.model.modelKey);
    if (kind === "search") {
      assert.deepEqual(body.tools[0].parameters.allowed_domains, original.allowedDomains);
      assert.deepEqual(body.tools[0].parameters.excluded_domains, original.excludedDomains);
      assert.equal(body.messages[1].content, original.query);
    } else {
      assert.deepEqual(body.messages, original.messages);
      assert.equal(body.response_format.json_schema.schema.properties.injected, undefined);
      assert.deepEqual(response.metadata.routeMetadata, original.requestMetadata);
    }
  }
});

test("R11 unavailable exact route and admission denial do not trigger transport fallback or replay", async () => {
  for (const kind of ["search", "selector"]) {
    const unavailable = fixture(kind, { fetcher: async () => new Response(JSON.stringify({ error: { message: "No endpoint matches the requested privacy controls" } }), { status: 404 }) });
    await assert.rejects(invoke(unavailable.adapter, kind, request(kind, exactControls)), error => error.category === "provider_rejected" && error.retryable === false);
    assert.equal(unavailable.seen.calls.length, 1);
    const denied = fixture(kind, { admit: async () => { throw new Error("Policy expired"); } });
    await assert.rejects(invoke(denied.adapter, kind, request(kind, exactControls)), /Operating policy denied/);
    assert.equal(denied.seen.calls.length, 0);
  }
});

test("R11 reviewed POST origin cannot follow redirects or retry a redirect rejection", async () => {
  for (const kind of ["search", "selector"]) {
    const { adapter, seen } = fixture(kind, { fetcher: async (_url, init) => {
      assert.equal(init.redirect, "error", "The admitted POST must not follow any redirect");
      throw new TypeError("Redirect rejected by transport");
    } });
    await assert.rejects(invoke(adapter, kind, request(kind, exactControls)), error => error.category === "provider_unavailable");
    assert.equal(seen.admissions.length, 1);
    assert.equal(seen.calls.length, 1);
    assert.equal(seen.calls[0].url, config.baseUrl + "/chat/completions");
  }
});
