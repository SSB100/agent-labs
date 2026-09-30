import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import sharp from "sharp";
import images from "../.core-tests/creative/image-provider.js";

const { IMAGE_GENERATION_POLICY: policy, OpenRouterImageAdapter, ImageProviderError, parseImageGenerationQuote } = images;
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
  const adapter = new OpenRouterImageAdapter({ config, now: () => timestamp, ...options, fetcher: async (url, init) => {
    calls.push({ url, init });
    if (options.fetcher) return options.fetcher(url, init, calls.length);
    return init.method === "GET" ? json(catalog) : json(success(), { headers: { "x-request-id": "image-request-1" } });
  } });
  return { adapter, calls, paidCalls: () => calls.filter(call => call.init.method === "POST") };
}
const isError = category => error => error instanceof ImageProviderError && error.category === category && error.retryable === false;

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
    assert.throws(() => new OpenRouterImageAdapter({ config, ...options }), isError("configuration_required"));
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
