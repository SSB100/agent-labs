import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import sharp from "sharp";
import images from "../.core-tests/creative/image-provider.js";

const { IMAGE_GENERATION_POLICY: policy, FLUX_KLEIN_PNG_POLICY: nativePolicy, getImageGenerationPolicy,
  OpenRouterImageAdapter, ImageProviderError, parseImageGenerationQuote } = images;
const config = { apiKey: "mock-only-key", baseUrl: "https://openrouter.ai/api/v1", appUrl: "https://agent-labs-two.vercel.app", appName: "Agent Labs" };
const timestamp = Date.parse("2026-09-30T09:30:00.000Z");
const request = { prompt: "An original geometric hiking badge with a intentionally opaque cream square background" };
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lX8AAAAASUVORK5CYII=", "base64");
const catalog = {
  id: "recraft/recraft-v4.1-pro",
  endpoints: [{ provider_name: "Recraft", provider_slug: "recraft", provider_tag: "recraft",
    supported_parameters: {
      aspect_ratio: { type: "enum", values: ["1:1", "4:3", "3:4", "16:9", "9:16", "auto"] },
      n: { type: "range", min: 1, max: 6 }, input_references: { type: "range", min: 0, max: 1 },
    }, allowed_passthrough_parameters: ["style", "controls", "text_layout"], supports_streaming: false,
    pricing: [{ billable: "output_image", unit: "image", cost_usd: 0.21 }],
  }],
};
const success = () => ({ data: [{ b64_json: png.toString("base64"), media_type: "image/png" }],
  usage: { prompt_tokens: 12, completion_tokens: 0, total_tokens: 12, cost: 0.21 } });
const json = (body, options = {}) => new Response(JSON.stringify(body), { status: 200, ...options, headers: { "content-type": "application/json", ...options.headers } });
const authorization = quote => ({ quote, reservationId: "creative:attempt-1", reservedMicrousd: 210000, preauthorized: true });
function fixture(options = {}) {
  const calls = [];
  const adapter = new OpenRouterImageAdapter({ admitDispatch: async () => {}, config, now: () => timestamp, ...options, fetcher: async (url, init) => {
    calls.push({ url, init });
    if (options.fetcher) return options.fetcher(url, init, calls.length);
    return init.method === "GET" ? json(catalog) : json(success(), { headers: { "x-request-id": "image-request-1" } });
  } });
  return { adapter, calls, paidCalls: () => calls.filter(call => call.init.method === "POST") };
}
const isError = category => error => error instanceof ImageProviderError && error.category === category && error.retryable === false;
test('image generation without operating admission sends no paid request', async()=>{
  const f=fixture({admitDispatch:undefined}),quote=await f.adapter.preflight(request);
  await assert.rejects(f.adapter.generate(request,authorization(quote)), error =>
    error instanceof ImageProviderError && error.requestDispatched === false && error.providerRequestId === null && error.receipt === null);
  assert.equal(f.paidCalls().length,0);
});
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` :
  value !== null && typeof value === "object" ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
const hash = value => createHash("sha256").update(value).digest("hex");
const rehashQuote = quote => {
  const fields = { ...quote };
  delete fields.quoteId;
  return { ...fields, quoteId: hash(canonical(fields)) };
};
const nativeCatalog = {
  id: "black-forest-labs/flux.2-klein-4b",
  endpoints: [{ provider_name: "Black Forest Labs", provider_slug: "black-forest-labs", provider_tag: "black-forest-labs",
    supported_parameters: {
      aspect_ratio: { type: "enum", values: ["1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16", "21:9", "auto"] },
      output_format: { type: "enum", values: ["png", "jpeg"] }, n: { type: "range", min: 1, max: 1 },
      input_references: { type: "range", min: 0, max: 4 }, seed: { type: "boolean" },
    }, allowed_passthrough_parameters: ["steps", "guidance", "safety_tolerance"], supports_streaming: false,
    pricing: [{ billable: "output_image", unit: "megapixel", cost_usd: 0.014 }],
  }],
};
const nativeSuccess = () => ({ ...success(), model: nativePolicy.modelId, provider: "Black Forest Labs",
  usage: { cost: 0.028, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } });
const nativeAuthorization = quote => ({ quote, reservationId: "creative:native-attempt-1", reservedMicrousd: 70000, preauthorized: true });
const nativeFixture = (options = {}) => fixture({ modelId: nativePolicy.modelId,
  fetcher: (_url, init) => json(init.method === "GET" ? nativeCatalog : nativeSuccess()), ...options });

test("public preflight exposes a traceable fixed per-image estimate without credentials or prompt transmission", async () => {
  const { adapter, calls } = fixture();
  const quote = await adapter.preflight(request);
  assert.equal(quote.estimatedMicrousd, 210000);
  assert.equal(quote.source, policy.pricingSource);
  assert.equal(quote.verifiedAt, "2026-09-30T09:30:00.000Z");
  assert.equal(quote.modelId, "recraft/recraft-v4.1-pro");
  assert.equal(quote.upstreamProvider, "recraft");
  assert.equal(quote.promptHash, createHash("sha256").update(request.prompt).digest("hex"));
  assert.match(quote.requestHash, /^[a-f0-9]{64}$/);
  assert.match(quote.quoteId, /^[a-f0-9]{64}$/);
  assert.equal(quote.estimateOnly, true);
  assert.equal(quote.providerInvoiceGuarantee, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers, undefined);
  assert.equal(calls[0].init.body, undefined);
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(calls[0].init.cache, "no-store");
});

test("reserved image.generate rechecks prices then makes one fixed pinned request and returns bytes plus receipt", async () => {
  const { adapter, calls, paidCalls } = fixture();
  const quote = await adapter.preflight(request);
  const result = await adapter.generate(request, authorization(quote));
  assert.deepEqual(calls.map(call => call.init.method), ["GET", "GET", "POST"]);
  assert.equal(paidCalls()[0].url, "https://openrouter.ai/api/v1/images");
  assert.deepEqual(JSON.parse(paidCalls()[0].init.body), {
    model: "recraft/recraft-v4.1-pro", prompt: request.prompt,
    aspect_ratio: "1:1", n: 1,
    provider: { only: ["recraft"], allow_fallbacks: false },
  });
  assert.equal(paidCalls()[0].init.headers.Authorization, "Bearer mock-only-key");
  assert.equal(result.mediaType, "image/png");
  assert.deepEqual(Buffer.from(result.bytes), png);
  const { imageResponse, ...costReceipt } = result.receipt;
  assert.equal(imageResponse.reason, "bounded_source_only");
  assert.equal(imageResponse.originalSha256, createHash("sha256").update(png).digest("hex"));
  assert.deepEqual(costReceipt, { capability: "image.generate", provider: "openrouter", upstreamProvider: "recraft",
    modelId: policy.modelId, providerRequestId: "image-request-1", reservationId: "creative:attempt-1", quoteId: quote.quoteId,
    promptHash: quote.promptHash, requestHash: quote.requestHash, elapsedMs: 0, estimatedMicrousd: 210000,
    reportedCostUsd: 0.21, reportedMicrousd: 210000, inputTokens: 12, outputTokens: 0, totalTokens: 12 });
  await assert.rejects(adapter.generate(request, authorization(quote)), isError("authorization_required"));
  assert.equal(paidCalls().length, 1);
});

test("preflight fails closed for unknown fees, price changes, missing prices, and unavailable capabilities", () => {
  const changes = [
    c => { c.id = "other/model"; },
    c => { c.endpoints[0].provider_tag = null; },
    c => { c.endpoints.push(structuredClone(c.endpoints[0])); },
    c => { c.endpoints[0].provider_slug = "other"; },
    c => { c.endpoints[0].pricing.push({ billable: "request", unit: "request", cost_usd: 0.01 }); },
    c => { c.endpoints[0].pricing[0].cost_usd = 0.16; },
    c => { c.endpoints[0].pricing[0].cost_usd = "0.21"; },
    c => { c.endpoints[0].pricing[0].minimum_charge = 0.01; },
    c => { c.endpoints[0].pricing[0].billable = "input_image"; },
    c => { c.endpoints[0].pricing[0].unit = "megapixel"; },
    c => { c.endpoints[0].pricing[0].variant = "unknown"; },
    c => { c.endpoints[0].pricing[0].variant = "base"; },
    c => { c.endpoints[0].pricing.pop(); },
    c => { c.endpoints[0].supported_parameters.aspect_ratio.values = ["16:9"]; },
    c => { c.endpoints[0].supported_parameters.n.max = 10; },
  ];
  for (const change of changes) {
    const changed = structuredClone(catalog); change(changed);
    assert.throws(() => parseImageGenerationQuote(changed, request), isError("preflight_rejected"));
  }
});

test("prompt bounds use UTF-8 and reject additional references, URLs, tools or model options before network calls", async () => {
  const { adapter, calls } = fixture();
  for (const invalid of [null, {}, { prompt: " " }, { prompt: 3 }, { prompt: "é".repeat(3001) },
    { ...request, input_references: [] }, { ...request, url: "https://example.com/image.png" },
    { ...request, tools: [] }, { ...request, n: 2 }, { ...request, model: "another/model" }]) {
    await assert.rejects(adapter.preflight(invalid), isError("invalid_request"));
  }
  assert.equal(calls.length, 0);
  await adapter.preflight({ prompt: "é".repeat(3000) });
  assert.equal(calls.length, 1);
});

test("missing, unreserved, tampered, stale, future or mismatched approval cannot spend", async () => {
  const { adapter, paidCalls } = fixture();
  const quote = await adapter.preflight(request);
  for (const invalid of [undefined, {}, { ...authorization(quote), preauthorized: false },
    { ...authorization(quote), reservationId: "" }, { ...authorization(quote), reservedMicrousd: 209999 },
    { ...authorization(quote), reservedMicrousd: Infinity },
    authorization({ ...quote, modelId: "different/model" }),
    authorization(parseImageGenerationQuote(catalog, { prompt: "Different prompt" }, quote.verifiedAt)),
    authorization(parseImageGenerationQuote(catalog, request, new Date(timestamp - 300001).toISOString())),
    authorization(parseImageGenerationQuote(catalog, request, new Date(timestamp + 1).toISOString())),
  ]) await assert.rejects(adapter.generate(request, invalid), isError("authorization_required"));
  assert.equal(paidCalls().length, 0);
});

test("pricing and capability changes between quote and paid request prevent spending", async () => {
  for (const change of [c => { c.endpoints[0].pricing[0].cost_usd = 0.211; },
    c => { c.endpoints[0].supported_parameters.aspect_ratio.values.push("2:1"); }]) {
    const changed = structuredClone(catalog); change(changed);
    const { adapter, paidCalls } = fixture({ fetcher: (_url, _init, call) => json(call === 1 ? catalog : changed) });
    const quote = await adapter.preflight(request);
    await assert.rejects(adapter.generate(request, authorization(quote)), error => isError("preflight_rejected")(error) && !error.requestDispatched);
    assert.equal(paidCalls().length, 0);
  }
});

test("concurrent duplicate calls consume a reservation only once", async () => {
  const { adapter, paidCalls } = fixture();
  const quote = await adapter.preflight(request);
  const results = await Promise.allSettled([adapter.generate(request, authorization(quote)), adapter.generate(request, authorization(quote))]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(paidCalls().length, 1);
});

test("caller mutation during async price recheck cannot replace the authorized prompt or receipt", async () => {
  let resume;
  const held = new Promise(resolve => { resume = resolve; });
  const { adapter, paidCalls } = fixture({ fetcher: async (_url, init, call) => {
    if (call === 2) await held;
    return json(init.method === "GET" ? catalog : success());
  } });
  const mutableRequest = { ...request }, quote = await adapter.preflight(mutableRequest), auth = authorization(quote);
  const pending = adapter.generate(mutableRequest, auth);
  mutableRequest.prompt = "Unauthorized replacement";
  auth.reservationId = "replacement"; auth.quote.promptHash = "replacement";
  resume();
  const result = await pending;
  assert.equal(JSON.parse(paidCalls()[0].init.body).prompt, request.prompt);
  assert.equal(result.receipt.reservationId, "creative:attempt-1");
  assert.notEqual(result.receipt.promptHash, "replacement");
});

test("missing usage remains unknown, while safe string usage and zero charges remain valid", async () => {
  for (const usage of [undefined, { cost: "0", prompt_tokens: "8", completion_tokens: "2", total_tokens: "10" },
    { cost: -1, prompt_tokens: -1, completion_tokens: 1.5, total_tokens: "NaN" }]) {
    const { adapter } = fixture({ fetcher: (_url, init) => json(init.method === "GET" ? catalog : { data: success().data, usage }) });
    const quote = await adapter.preflight(request), result = await adapter.generate(request, authorization(quote));
    assert.equal(result.receipt.reportedCostUsd, usage?.cost === "0" ? 0 : null);
    assert.equal(result.receipt.reportedMicrousd, usage?.cost === "0" ? 0 : null);
    assert.equal(result.receipt.inputTokens, usage?.cost === "0" ? 8 : null);
  }
});

test("invalid image output is rejected without retries and retains the paid response receipt", async () => {
  const invalidOutputs = [
    [], [...success().data, ...success().data], [{ b64_json: "https://example.com/image.png", media_type: "image/png" }],
    [{ ...success().data[0], url: "https://example.com/image.png" }],
    [{ ...success().data[0], b64_json: `${png.toString("base64")}!` }],
    [{ ...success().data[0], b64_json: png.toString("base64").slice(0, -1) }],
    [{ ...success().data[0], b64_json: ` ${png.toString("base64")}` }],
    [{ ...success().data[0], b64_json: Buffer.alloc(33).toString("base64") }],
    [{ ...success().data[0], b64_json: png.subarray(0, 8).toString("base64") }],
    [{ ...success().data[0], b64_json: Buffer.alloc(policy.maximumPngBytes + 1).toString("base64") }],
  ];
  for (const data of invalidOutputs) {
    const { adapter, paidCalls } = fixture({ fetcher: (_url, init) => json(init.method === "GET" ? catalog : { ...success(), data }, { headers: { "x-openrouter-request-id": "invalid-image-receipt" } }) });
    const quote = await adapter.preflight(request);
    await assert.rejects(adapter.generate(request, authorization(quote)), error => {
      assert.equal(error.category, "malformed_image_output"); assert.equal(error.retryable, false); assert.equal(error.requestDispatched, true);
      assert.equal(error.receipt.reportedMicrousd, 210000); assert.equal(error.providerRequestId, "invalid-image-receipt"); return true;
    });
    assert.equal(paidCalls().length, 1);
  }
});

test("unexpected model, provider, and error envelopes are rejected even with image data", async () => {
  for (const extra of [{ model: "other/model" }, { provider: "Sourceful" }, { provider: "unknown" }, { error: { message: "Not an image" } }]) {
    const { adapter } = fixture({ fetcher: (_url, init) => json(init.method === "GET" ? catalog : { ...success(), ...extra }) });
    const quote = await adapter.preflight(request);
    await assert.rejects(adapter.generate(request, authorization(quote)), isError("malformed_image_output"));
  }
});

test("HTTP failures, network failures and timeout never retry and retain reservation uncertainty", async () => {
  for (const status of [400, 401, 403, 408, 429, 500, 502, 504]) {
    const { adapter, paidCalls } = fixture({ fetcher: (_url, init) => init.method === "GET" ? json(catalog) : json({ error: { message: "sensitive-provider-echo" } }, { status }) });
    const quote = await adapter.preflight(request);
    await assert.rejects(adapter.generate(request, authorization(quote)), error => {
      assert.equal(error.retryable, false); assert.equal(error.requestDispatched, true); assert.equal(error.receipt, null);
      assert.ok(!error.message.includes("sensitive-provider-echo")); return true;
    });
    assert.equal(paidCalls().length, 1);
  }
  for (const hanging of [false, true]) {
    const { adapter, paidCalls } = fixture({ timeoutMs: 10, fetcher: (_url, init) => {
      if (init.method === "GET") return json(catalog);
      if (hanging) return new Promise(() => {});
      throw new Error("mock-only-key sensitive-provider-echo");
    } });
    const quote = await adapter.preflight(request);
    await assert.rejects(adapter.generate(request, authorization(quote)), error => {
      assert.equal(error.category, hanging ? "provider_timeout" : "provider_unavailable"); assert.equal(error.requestDispatched, true);
      assert.ok(!error.message.includes("mock-only-key")); return true;
    });
    assert.equal(paidCalls().length, 1);
  }
});

test("JSON envelopes are bounded by actual streamed bytes, with or without Content-Length", async () => {
  for (const declared of [false, true]) {
    const { adapter, paidCalls } = fixture({ fetcher: (_url, init) => init.method === "GET" ? json(catalog) : new Response(new Uint8Array(policy.maximumResponseBytes + 1),
      { headers: { "content-type": "application/json", ...(declared ? { "content-length": `${policy.maximumResponseBytes + 1}` } : {}) } }) });
    const quote = await adapter.preflight(request);
    await assert.rejects(adapter.generate(request, authorization(quote)), isError("response_too_large"));
    assert.equal(paidCalls().length, 1);
  }
});

test("non-JSON content, invalid UTF-8/JSON, non-object envelopes and slow bodies fail safely", async () => {
  const responses = [
    () => new Response("<html>Bad gateway</html>", { headers: { "content-type": "text/html" } }),
    () => new Response("not json", { headers: { "content-type": "application/json" } }),
    () => new Response(new Uint8Array([255]), { headers: { "content-type": "application/json" } }),
    () => json([]),
    () => new Response(new ReadableStream({ start() {} }), { headers: { "content-type": "application/json" } }),
  ];
  for (const [index, response] of responses.entries()) {
    const { adapter, paidCalls } = fixture({ timeoutMs: 10, fetcher: (_url, init) => init.method === "GET" ? json(catalog) : response() });
    const quote = await adapter.preflight(request);
    await assert.rejects(adapter.generate(request, authorization(quote)), isError(index === 4 ? "provider_timeout" : "malformed_image_output"));
    assert.equal(paidCalls().length, 1);
  }
});

test("failed or oversized catalog validation never sends a paid request", async () => {
  for (const response of [() => json({}, { status: 503 }), () => json({}),
    () => new Response(new Uint8Array(policy.maximumCatalogBytes + 1), { headers: { "content-type": "application/json" } })]) {
    const { adapter, paidCalls } = fixture({ fetcher: response });
    await assert.rejects(adapter.preflight(request), error => error instanceof ImageProviderError && !error.requestDispatched);
    assert.equal(paidCalls().length, 0);
  }
});

test("configuration cannot send credentials to other origins or raise the hard timeout", () => {
  for (const options of [{ config: { ...config, baseUrl: "https://attacker.example/api/v1" } }, { timeoutMs: 120001 }, { timeoutMs: 0 }, { timeoutMs: Infinity }]) {
    assert.throws(() => new OpenRouterImageAdapter({ admitDispatch: async () => {}, config, ...options }), isError("configuration_required"));
  }
});


test("bounded source accepts documented omitted MIME but records the actual detected bytes", async () => {
  const { adapter } = fixture({ fetcher: (_url, init) => json(init.method === "GET" ? catalog : {
    ...success(), created: 1790795681, data: [{ b64_json: png.toString("base64") }],
  }, { headers: { "x-generation-id": "gen-retained-source", "x-request-id": "generic-request" } }) });
  const result = await adapter.generate(request, authorization(await adapter.preflight(request)));
  assert.equal(result.mediaType, "image/png");
  assert.equal(result.receipt.providerRequestId, "gen-retained-source");
  assert.equal(result.receipt.imageResponse.declaredMediaType, "absent");
  assert.equal(result.receipt.imageResponse.detectedMediaType, "image/png");
  assert.equal(result.receipt.imageResponse.created, 1790795681);
});

test("bounded WebP source is distinctly labelled for preservation before full normalization", async () => {
  const original = await sharp({ create: { width: 16, height: 16, channels: 4, background: '#abc' } }).webp({ lossless: true }).toBuffer();
  const { adapter, paidCalls } = fixture({ fetcher: (_url, init) => json(init.method === "GET" ? catalog : {
    ...success(), data: [{ b64_json: original.toString("base64"), media_type: "image/webp" }],
  }) });
  const result = await adapter.generate(request, authorization(await adapter.preflight(request)));
  assert.equal(result.mediaType, "image/webp");
  assert.deepEqual(Buffer.from(result.bytes), original);
  assert.equal(result.receipt.imageResponse.reason, "bounded_source_only");
  assert.equal(result.receipt.imageResponse.originalSha256, createHash("sha256").update(original).digest("hex"));
  assert.equal(paidCalls().length, 1);
});

test("source failures retain bounded diagnostic reasons, never arbitrary MIME or raw image data", async () => {
  for (const [patch, reason] of [
    [{ b64_json: 'secret-image-blob' }, 'invalid_base64'],
    [{ url: 'https://secret.example/file' }, 'remote_image_url_rejected'],
  ]) {
    const { adapter } = fixture({ fetcher: (_url, init) => json(init.method === "GET" ? catalog : {
      ...success(), data: [{ ...success().data[0], ...patch }],
    }, { headers: { 'x-generation-id': 'gen-failed-source' } }) });
    await assert.rejects(adapter.generate(request, authorization(await adapter.preflight(request))), error => {
      assert.equal(error.receipt.imageResponse.reason, reason);
      assert.equal(error.receipt.reportedMicrousd, 210000);
      assert.equal(error.providerRequestId, 'gen-failed-source');
      assert.doesNotMatch(JSON.stringify(error.receipt), /secret-provider|secret-image|secret.example/);
      return true;
    });
  }
});


test("recognized bounded source is retained for private storage even when its declared MIME conflicts", async () => {
  for (const media_type of ['image/jpeg', null, 'secret-provider-value']) {
    const { adapter } = fixture({ fetcher: (_url, init) => json(init.method === 'GET' ? catalog : {
      ...success(), data: [{ ...success().data[0], media_type }],
    }) });
    const result = await adapter.generate(request, authorization(await adapter.preflight(request)));
    assert.deepEqual(Buffer.from(result.bytes), png);
    assert.equal(result.mediaType, 'image/png');
    assert.equal(result.receipt.imageResponse.reason, 'bounded_source_media_type_conflict');
    assert.doesNotMatch(JSON.stringify(result.receipt), /secret-provider-value/);
  }
});

test("policy lookup is a frozen closed allowlist and preserves the legacy default", () => {
  assert.equal(getImageGenerationPolicy(), policy);
  assert.equal(getImageGenerationPolicy(policy.modelId), policy);
  assert.equal(getImageGenerationPolicy(nativePolicy.modelId), nativePolicy);
  assert.equal(policy.nativePngRequired, false);
  assert.equal(nativePolicy.nativePngRequired, true);
  assert.equal(nativePolicy.version, "flux-klein-png-1.0");
  assert.equal(nativePolicy.estimatedMicrousd, 70000);
  assert.equal(nativePolicy.outputFormat, "png");
  assert.equal(nativePolicy.requestedSize, "1024x1024");
  assert.ok(Object.isFrozen(policy) && Object.isFrozen(nativePolicy));
  for (const modelId of ["", "black-forest-labs/flux.2-klein-9b", "flux.2-klein-4b", "recraft/recraft-v4", "toString", null, {}]) {
    assert.throws(() => getImageGenerationPolicy(modelId), isError("configuration_required"));
    assert.throws(() => new OpenRouterImageAdapter({ admitDispatch: async () => {}, config, modelId }), isError("configuration_required"));
    assert.throws(() => parseImageGenerationQuote(nativeCatalog, request, new Date(timestamp).toISOString(), modelId), isError("configuration_required"));
  }
});

test("legacy quote canonical fields and request binding remain identical after introducing a second policy", () => {
  const verifiedAt = new Date(timestamp).toISOString();
  const fields = {
    version: "recraft-image-1.0", provider: "openrouter", upstreamProvider: "recraft", modelId: "recraft/recraft-v4.1-pro",
    promptHash: hash(request.prompt),
    requestHash: hash(canonical({ model: "recraft/recraft-v4.1-pro", prompt: request.prompt, aspect_ratio: "1:1", n: 1,
      provider: { only: ["recraft"], allow_fallbacks: false } })),
    pricingFingerprint: hash(canonical({ supported_parameters: catalog.endpoints[0].supported_parameters, pricing: catalog.endpoints[0].pricing })),
    estimatedMicrousd: 210000, verifiedAt, source: "https://openrouter.ai/api/v1/images/models/recraft/recraft-v4.1-pro/endpoints",
    estimateOnly: true, providerInvoiceGuarantee: false,
  };
  assert.deepEqual(parseImageGenerationQuote(catalog, request, verifiedAt), { ...fields, quoteId: hash(canonical(fields)) });
  assert.deepEqual(parseImageGenerationQuote(catalog, request, verifiedAt, policy.modelId), parseImageGenerationQuote(catalog, request, verifiedAt));
});

test("native-PNG preflight is public and quotes a conservative megapixel reservation without a price-cap guarantee", async () => {
  const { adapter, calls } = nativeFixture();
  const quote = await adapter.preflight(request);
  assert.equal(quote.version, "flux-klein-png-1.0");
  assert.equal(quote.provider, "openrouter");
  assert.equal(quote.upstreamProvider, "black-forest-labs");
  assert.equal(quote.modelId, "black-forest-labs/flux.2-klein-4b");
  assert.equal(quote.estimatedMicrousd, 5 * 0.014 * 1000000);
  assert.equal(quote.estimateOnly, true);
  assert.equal(quote.providerInvoiceGuarantee, false);
  assert.equal(quote.verifiedAt, new Date(timestamp).toISOString());
  assert.equal(quote.promptHash, hash(request.prompt));
  assert.equal(quote.pricingFingerprint, hash(canonical({ supported_parameters: nativeCatalog.endpoints[0].supported_parameters, pricing: nativeCatalog.endpoints[0].pricing })));
  assert.deepEqual(quote, rehashQuote(quote));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, nativePolicy.pricingSource);
  assert.equal(quote.source, calls[0].url);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.headers, undefined);
  assert.equal(calls[0].init.body, undefined);
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(calls[0].init.cache, "no-store");
});

test("native-PNG generation dispatches only the exact pinned PNG, square, explicit-pixel body", async () => {
  const { adapter, calls, paidCalls } = nativeFixture();
  const quote = await adapter.preflight(request);
  const result = await adapter.generate(request, nativeAuthorization(quote));
  assert.deepEqual(calls.map(call => call.init.method), ["GET", "GET", "POST"]);
  assert.equal(calls[0].url, nativePolicy.pricingSource);
  assert.equal(calls[1].url, nativePolicy.pricingSource);
  const body = JSON.parse(paidCalls()[0].init.body);
  assert.deepEqual(body, {
    model: "black-forest-labs/flux.2-klein-4b", prompt: request.prompt,
    aspect_ratio: "1:1", n: 1, output_format: "png", size: "1024x1024",
    provider: { only: ["black-forest-labs"], allow_fallbacks: false },
  });
  assert.equal(paidCalls()[0].url, "https://openrouter.ai/api/v1/images");
  assert.equal(paidCalls()[0].init.headers.Authorization, "Bearer mock-only-key");
  assert.equal(quote.requestHash, hash(canonical(body)));
  assert.equal(result.nativePngRequired, true);
  assert.equal(result.mediaType, "image/png");
  assert.equal(result.declaredMediaType, "image/png");
  assert.deepEqual(Buffer.from(result.bytes), png);
  assert.equal(result.receipt.modelId, nativePolicy.modelId);
  assert.equal(result.receipt.upstreamProvider, nativePolicy.upstreamProvider);
  assert.equal(result.receipt.reservationId, "creative:native-attempt-1");
  assert.equal(result.receipt.estimatedMicrousd, 70000);
  assert.equal(result.receipt.reportedMicrousd, 28000);
  assert.equal(result.receipt.quoteId, quote.quoteId);
});

test("native-PNG preflight rejects wrong routes, missing capabilities, fee drift and non-megapixel prices", () => {
  const changes = [
    c => { c.id = policy.modelId; },
    c => { c.endpoints[0].provider_tag = "recraft"; },
    c => { c.endpoints[0].provider_slug = "recraft"; },
    c => { c.endpoints.push(structuredClone(c.endpoints[0])); },
    c => { c.endpoints = []; },
    c => { delete c.endpoints[0].supported_parameters.output_format; },
    c => { c.endpoints[0].supported_parameters.output_format = { type: "boolean" }; },
    c => { c.endpoints[0].supported_parameters.output_format.values = ["jpeg"]; },
    c => { c.endpoints[0].supported_parameters.aspect_ratio.values = ["16:9"]; },
    c => { c.endpoints[0].supported_parameters.n.min = 0; },
    c => { c.endpoints[0].supported_parameters.n.max = 2; },
    c => { c.endpoints[0].supported_parameters.n = { type: "enum", values: [1] }; },
    c => { c.endpoints[0].pricing = []; },
    c => { c.endpoints[0].pricing.push({ billable: "request", unit: "request", cost_usd: 0.001 }); },
    c => { c.endpoints[0].pricing[0].cost_usd = 0.015; },
    c => { c.endpoints[0].pricing[0].cost_usd = 0.013; },
    c => { c.endpoints[0].pricing[0].cost_usd = "0.014"; },
    c => { c.endpoints[0].pricing[0].unit = "image"; },
    c => { c.endpoints[0].pricing[0].billable = "input_image"; },
    c => { c.endpoints[0].pricing[0].minimum_charge = 0.1; },
    c => { c.endpoints[0].pricing[0].variant = "base"; },
  ];
  for (const change of changes) {
    const changed = structuredClone(nativeCatalog); change(changed);
    assert.throws(() => parseImageGenerationQuote(changed, request, new Date(timestamp).toISOString(), nativePolicy.modelId), isError("preflight_rejected"));
  }
});

test("native-PNG pricing and capability drift during reservation consumes the attempt without dispatching", async () => {
  for (const change of [c => { c.endpoints[0].pricing[0].cost_usd = 0.015; },
    c => { c.endpoints[0].supported_parameters.output_format.values.push("webp"); },
    c => { c.endpoints[0].supported_parameters.aspect_ratio.values.push("2:1"); },
    c => { c.endpoints[0].supported_parameters.input_references.max = 5; }]) {
    const changed = structuredClone(nativeCatalog); change(changed);
    const { adapter, paidCalls } = nativeFixture({ fetcher: (_url, _init, call) => json(call === 1 ? nativeCatalog : changed) });
    const quote = await adapter.preflight(request);
    await assert.rejects(adapter.generate(request, nativeAuthorization(quote)), error => isError("preflight_rejected")(error) && !error.requestDispatched);
    await assert.rejects(adapter.generate(request, nativeAuthorization(quote)), isError("authorization_required"));
    assert.equal(paidCalls().length, 0);
  }
});

test("native-PNG approvals reject rehashed policy tampering, under-reservation, old quotes and caller options", async () => {
  const { adapter, calls, paidCalls } = nativeFixture();
  const quote = await adapter.preflight(request);
  for (const patch of [{ version: policy.version }, { provider: "other" }, { upstreamProvider: "recraft" }, { modelId: policy.modelId },
    { source: policy.pricingSource }, { estimatedMicrousd: 69999 }, { providerInvoiceGuarantee: true }, { estimateOnly: false },
    { requestHash: hash("different request") }, { promptHash: hash("different prompt") },
    { verifiedAt: new Date(timestamp - 300001).toISOString() }, { verifiedAt: new Date(timestamp + 1).toISOString() }]) {
    await assert.rejects(adapter.generate(request, nativeAuthorization(rehashQuote({ ...quote, ...patch }))), isError("authorization_required"));
  }
  for (const reservedMicrousd of [69999, 0, -1, 70000.5, Infinity, NaN, "70000"]) {
    await assert.rejects(adapter.generate(request, { ...nativeAuthorization(quote), reservedMicrousd }), isError("authorization_required"));
  }
  for (const patch of [{ model: policy.modelId }, { n: 2 }, { size: "2048x2048" }, { output_format: "jpeg" },
    { provider: { only: ["other"], allow_fallbacks: true } }, { input_references: [] }, { safety_tolerance: 6 }]) {
    await assert.rejects(adapter.preflight({ ...request, ...patch }), isError("invalid_request"));
    await assert.rejects(adapter.generate({ ...request, ...patch }, nativeAuthorization(quote)), isError("invalid_request"));
  }
  assert.equal(calls.length, 1);
  assert.equal(paidCalls().length, 0);
});

test("a quote for one policy can never authorize the other policy", async () => {
  const legacy = fixture(), native = nativeFixture();
  const legacyQuote = await legacy.adapter.preflight(request), nativeQuote = await native.adapter.preflight(request);
  await assert.rejects(native.adapter.generate(request, authorization(legacyQuote)), isError("authorization_required"));
  await assert.rejects(legacy.adapter.generate(request, { ...nativeAuthorization(nativeQuote), reservedMicrousd: 210000 }), isError("authorization_required"));
  assert.equal(legacy.calls.length, 1);
  assert.equal(native.calls.length, 1);
  assert.equal(legacy.paidCalls().length + native.paidCalls().length, 0);
});

test("native-PNG duplicate, failed and concurrent attempts never retry or fall back", async () => {
  for (const fail of [false, true]) {
    const { adapter, paidCalls } = nativeFixture({ fetcher: (_url, init) => init.method === "GET" ? json(nativeCatalog) :
      fail ? json({ error: { message: "upstream unavailable" } }, { status: 503 }) : json(nativeSuccess()) });
    const quote = await adapter.preflight(request);
    const results = await Promise.allSettled([adapter.generate(request, nativeAuthorization(quote)), adapter.generate(request, nativeAuthorization(quote))]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, fail ? 0 : 1);
    assert.equal(paidCalls().length, 1);
    assert.deepEqual(JSON.parse(paidCalls()[0].init.body).provider, { only: ["black-forest-labs"], allow_fallbacks: false });
    await assert.rejects(adapter.generate(request, nativeAuthorization(quote)), isError("authorization_required"));
    assert.equal(paidCalls().length, 1);
  }
});

test("native-PNG receipts reject wrong providers/models and only accept verified provider aliases", async () => {
  for (const extra of [{ model: policy.modelId }, { model: "flux.2-klein-4b" }, { model: null },
    { provider: "recraft" }, { provider: "Recraft" }, { provider: "Black Forest Labs/other" }, { provider: "bfl" }, { provider: null },
    { error: { message: "upstream error" } }]) {
    const { adapter, paidCalls } = nativeFixture({ fetcher: (_url, init) => json(init.method === "GET" ? nativeCatalog : { ...nativeSuccess(), ...extra }) });
    await assert.rejects(adapter.generate(request, nativeAuthorization(await adapter.preflight(request))), error => {
      assert.equal(error.category, "malformed_image_output");
      assert.equal(error.requestDispatched, true);
      assert.equal(error.receipt.reportedMicrousd, 28000);
      assert.equal(error.receipt.upstreamProvider, "black-forest-labs");
      return true;
    });
    assert.equal(paidCalls().length, 1);
  }
  for (const provider of ["black-forest-labs", "Black Forest Labs", undefined]) {
    const { adapter } = nativeFixture({ fetcher: (_url, init) => json(init.method === "GET" ? nativeCatalog : { ...nativeSuccess(), provider }) });
    assert.equal((await adapter.generate(request, nativeAuthorization(await adapter.preflight(request)))).receipt.upstreamProvider, "black-forest-labs");
  }
});

test("native-PNG reservation remains an estimate when the reported charge exceeds it", async () => {
  const { adapter, paidCalls } = nativeFixture({ fetcher: (_url, init) => json(init.method === "GET" ? nativeCatalog : {
    ...nativeSuccess(), usage: { cost: 0.084 },
  }) });
  const quote = await adapter.preflight(request);
  const result = await adapter.generate(request, nativeAuthorization(quote));
  assert.equal(quote.providerInvoiceGuarantee, false);
  assert.equal(result.receipt.estimatedMicrousd, 70000);
  assert.equal(result.receipt.reportedMicrousd, 84000);
  assert.equal(paidCalls().length, 1);
  assert.equal(JSON.parse(paidCalls()[0].init.body).provider.max_price, undefined);
});

test("native-PNG policy preserves recognized source bytes and MIME conflict before runtime enforcement", async () => {
  const webp = await sharp({ create: { width: 16, height: 16, channels: 4, background: "#abc" } }).webp({ lossless: true }).toBuffer();
  for (const [original, actualType, declaredType] of [[png, "image/png", "image/jpeg"], [png, "image/png", undefined],
    [png, "image/png", "untrusted-mime"], [webp, "image/webp", "image/png"], [webp, "image/webp", "image/webp"]]) {
    const { adapter } = nativeFixture({ fetcher: (_url, init) => json(init.method === "GET" ? nativeCatalog : {
      ...nativeSuccess(), data: [{ b64_json: original.toString("base64"), media_type: declaredType }],
    }) });
    const result = await adapter.generate(request, nativeAuthorization(await adapter.preflight(request)));
    assert.deepEqual(Buffer.from(result.bytes), original);
    assert.equal(result.mediaType, actualType);
    assert.equal(result.nativePngRequired, true);
    assert.equal(result.declaredMediaType, declaredType === undefined ? "absent" : declaredType === "untrusted-mime" ? "other" : declaredType);
    assert.equal(result.receipt.imageResponse.originalSha256, hash(original));
    assert.equal(result.receipt.imageResponse.reason, declaredType === undefined || declaredType === actualType ? "bounded_source_only" : "bounded_source_media_type_conflict");
    assert.equal(result.receipt.reportedMicrousd, 28000);
    assert.doesNotMatch(JSON.stringify(result.receipt), /untrusted-mime/);
  }
});

test("preflight snapshots each policy's prompt before its asynchronous public catalog request", async () => {
  for (const makeFixture of [fixture, nativeFixture]) {
    let resume;
    const held = new Promise(resolve => { resume = resolve; });
    const selectedCatalog = makeFixture === fixture ? catalog : nativeCatalog;
    const { adapter } = makeFixture({ fetcher: async () => { await held; return json(selectedCatalog); } });
    const mutableRequest = { ...request }, pending = adapter.preflight(mutableRequest);
    mutableRequest.prompt = "Changed after preflight began";
    resume();
    assert.equal((await pending).promptHash, hash(request.prompt));
  }
});


test("image admission receives the immutable exact UTF-8 wire for each supported provider", async () => {
  for (const native of [false, true]) {
    let admitted;
    const input = { prompt: "Original café field notes with ferns 🌿, no text or reference artwork" };
    const f = (native ? nativeFixture : fixture)({ admitDispatch: async wire => {
      assert.equal(f.paidCalls().length, 0);
      assert.equal(Object.isFrozen(wire), true);
      assert.equal(Reflect.set(wire, "body", "tampered"), false);
      assert.deepEqual(Object.keys(wire).sort(), ["body", "endpoint", "method", "operation", "provider", "wireRequestBytes", "wireRequestHash"].sort());
      assert.equal(wire.provider, "openrouter");
      assert.equal(wire.operation, "image.generate");
      assert.equal(wire.method, "POST");
      assert.equal(wire.endpoint, "https://openrouter.ai/api/v1/images");
      assert.equal(wire.wireRequestHash, hash(wire.body));
      assert.equal(wire.wireRequestBytes, Buffer.byteLength(wire.body, "utf8"));
      assert.ok(wire.wireRequestBytes > wire.body.length);
      admitted = wire;
      input.prompt = "Caller mutation after admission cannot change the serialized body";
    } });
    const quote = await f.adapter.preflight(input);
    await f.adapter.generate(input, (native ? nativeAuthorization : authorization)(quote));
    assert.equal(f.paidCalls().length, 1);
    assert.equal(f.paidCalls()[0].init.body, admitted.body);
    assert.equal(hash(f.paidCalls()[0].init.body), admitted.wireRequestHash);
    assert.equal(JSON.parse(admitted.body).prompt, "Original café field notes with ferns 🌿, no text or reference artwork");
    assert.equal(JSON.parse(admitted.body).model, native ? nativePolicy.modelId : policy.modelId);
  }
});

test("rejected image admission remains undispatched and sends no paid request", async () => {
  let admissions = 0;
  const f = fixture({ admitDispatch: async () => { admissions++; throw new Error("fixture admission denied"); } });
  const quote = await f.adapter.preflight(request);
  await assert.rejects(f.adapter.generate(request, authorization(quote)), error => {
    assert.equal(error instanceof ImageProviderError, true);
    assert.equal(error.requestDispatched, false);
    assert.equal(error.providerRequestId, null);
    assert.equal(error.receipt, null);
    return true;
  });
  assert.equal(admissions, 1);
  assert.equal(f.paidCalls().length, 0);
});

test("timeout during image admission stays undispatched even when admission later resolves", async () => {
  let resume;
  const admission = new Promise(resolve => { resume = resolve; });
  const f = fixture({ timeoutMs: 10, admitDispatch: async () => admission });
  const quote = await f.adapter.preflight(request);
  await assert.rejects(f.adapter.generate(request, authorization(quote)), error =>
    isError("provider_timeout")(error) && error.requestDispatched === false);
  resume();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.paidCalls().length, 0);
});

test("synchronous paid-fetch failure is dispatched after the exact admission", async () => {
  let admitted = false;
  const adapter = new OpenRouterImageAdapter({ config, now: () => timestamp,
    admitDispatch: async wire => { assert.equal(wire.wireRequestHash, hash(wire.body)); admitted = true; },
    fetcher: (_url, init) => {
      if (init.method === "GET") return Promise.resolve(json(catalog));
      assert.equal(admitted, true);
      throw new Error("fixture synchronous transport failure");
    },
  });
  const quote = await adapter.preflight(request);
  await assert.rejects(adapter.generate(request, authorization(quote)), error =>
    isError("provider_unavailable")(error) && error.requestDispatched === true);
});
