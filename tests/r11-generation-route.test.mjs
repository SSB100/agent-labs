import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import routeModule from "../.core-tests/research/generation-route.js";

const { fetchGenerationRouteProof, qualifyGenerationRouteProof, validateGenerationRouteProof, GenerationRouteProofError } = routeModule;
const generationId = "gen-r11-route-fixture-123";
const alias = "openai/gpt-5.6-luna", canonical = "openai/gpt-5.6-luna-20260709";
const expected = () => ({ generationId, providerName: "Azure", acceptedResponseModelIds: [alias, canonical], requestedEndpoint: "azure/us" });
const config = { apiKey: "inert-route-fixture-key" };

// Inert wire snapshot using the official SDK inbound schema's snake_case names:
// https://raw.githubusercontent.com/OpenRouterTeam/typescript-sdk/main/src/models/generationresponse.ts
// https://raw.githubusercontent.com/OpenRouterTeam/typescript-sdk/main/src/models/providerresponse.ts
// No production responses, live credentials or provider traffic are used.
const documentedFixture = {
  data: {
    id: generationId, model: canonical, provider_name: "Azure", provider_responses: [
      { provider_name: "Azure", model_permaslug: canonical, status: 200,
        endpoint_id: "opaque-endpoint-private", id: "upstream-response-private", is_byok: false, latency: 231, routed_service_tier: "priority" },
    ],
    api_type: "completions", app_id: 12345, external_user: "external-user-private", session_id: "session-private",
    request_id: "request-group-private", upstream_id: "upstream-generation-private", workspace_id: "workspace-private",
    preset_id: "preset-private", http_referer: "https://private.invalid/work", origin: "https://private.invalid",
    user_agent: "user-agent-private", created_at: "2026-10-05T09:00:00Z", cancelled: false, total_cost: 0.01,
    data_region: "us", finish_reason: "stop", is_byok: false, service_tier: null,
  },
};
const fixture = () => structuredClone(documentedFixture);
const jsonResponse = (body = fixture(), init = {}) => new Response(JSON.stringify(body), { status: 200, ...init });
const read = (body = fixture(), options = {}) => fetchGenerationRouteProof({ ...expected(), config, fetcher: async () => jsonResponse(body), ...options });
const errorCode = code => error => {
  assert.ok(error instanceof GenerationRouteProofError);
  assert.equal(error.code, code);
  assert.equal(error.message, "public_research_generation_route_unverified");
  assert.equal(error.cause, undefined);
  return true;
};
const rejectPure = (body, code) => assert.throws(() => qualifyGenerationRouteProof(body, expected()), errorCode(code));
const hash = value => {
  const sort = x => Array.isArray(x) ? x.map(sort) : x && typeof x === "object"
    ? Object.fromEntries(Object.keys(x).sort().map(key => [key, sort(x[key])])) : x;
  return createHash("sha256").update(JSON.stringify(sort(value))).digest("hex");
};

test("R11 generation reader performs one fixed-origin non-generating GET and returns only canonical route proof", async () => {
  let calls = 0;
  const proof = await read(fixture(), { config: { ...config, baseUrl: "https://untrusted.invalid", appUrl: "https://private.invalid", appName: "private" },
    fetcher: async (url, init) => {
      calls++;
      assert.equal(url, `https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(generationId)}`);
      assert.equal(init.method, "GET");
      assert.equal(init.body, undefined);
      assert.equal(init.redirect, "error");
      assert.equal(init.cache, "no-store");
      assert.equal(init.credentials, "omit");
      assert.deepEqual(init.headers, { Authorization: `Bearer ${config.apiKey}`, Accept: "application/json" });
      assert.ok(init.signal instanceof AbortSignal);
      return jsonResponse();
    } });
  assert.equal(calls, 1);
  const body = { generationId, providerName: "Azure", modelId: canonical, requestedEndpoint: "azure/us",
    providerResponses: [{ providerName: "Azure", modelId: canonical, status: 200 }] };
  assert.deepEqual(proof, { ...body, proofHash: hash(body) });
  assert.ok(Object.isFrozen(proof));
  assert.ok(Object.isFrozen(proof.providerResponses));
  assert.ok(Object.isFrozen(proof.providerResponses[0]));
  assert.throws(() => { proof.providerResponses[0].status = 500; }, TypeError);
  assert.deepEqual(validateGenerationRouteProof(structuredClone(proof), expected()), proof);
});

test("R11 generation route accepts only the exact reviewed alias/canonical pair and normalizes empty parent attempts", () => {
  for (const model of [alias, canonical]) {
    for (const responses of [undefined, null, []]) {
      const body = fixture(); body.data.model = model;
      if (responses === undefined) delete body.data.provider_responses;
      else body.data.provider_responses = responses;
      const proof = qualifyGenerationRouteProof(body, expected());
      assert.equal(proof.modelId, model);
      assert.deepEqual(proof.providerResponses, []);
      assert.ok(Object.isFrozen(proof.providerResponses));
      assert.equal(proof.proofHash, qualifyGenerationRouteProof({ data: { id: generationId, provider_name: "Azure", model } }, expected()).proofHash);
    }
  }
});

test("R11 supplied attempts independently require exact Azure, reviewed model and status 200", () => {
  for (const model of [alias, canonical]) {
    const body = fixture(); body.data.provider_responses[0].model_permaslug = model;
    assert.equal(qualifyGenerationRouteProof(body, expected()).providerResponses[0].modelId, model);
  }
  for (const bad of [null, "Azure", [], {}, { status: 200 }, { provider_name: "Azure", status: 200 },
    { model_permaslug: canonical, status: 200 }, { provider_name: "Azure", model_permaslug: canonical },
    { provider_name: null, model_permaslug: canonical, status: 200 }, { provider_name: "Azure", model_permaslug: null, status: 200 },
    { provider_name: "OpenAI", model_permaslug: canonical, status: 200 }, { provider_name: "Azure", model_permaslug: "openai/other", status: 200 },
    ...[null, 0, 199, 201, 400, 429, 500, 599, 600, "200", 200.5, true].map(status => ({ provider_name: "Azure", model_permaslug: canonical, status })),
  ]) {
    const body = fixture(); body.data.provider_responses.push(bad);
    rejectPure(body, "provider_responses_invalid");
  }
  for (const responses of [{}, "private-raw-error", 1, true, new Array(1), Array.from({ length: 65 }, () => documentedFixture.data.provider_responses[0])]) {
    const body = fixture(); body.data.provider_responses = responses;
    rejectPure(body, "provider_responses_invalid");
  }
});

test("R11 missing, null, wrong or malformed served identity never qualifies through chat provider or opaque endpoint hints", () => {
  for (const [field, badValues, code] of [
    ["id", [null, undefined, "", "gen-other", 12, generationId + " "], "generation_mismatch"],
    ["provider_name", [null, undefined, "", "azure", "Azure ", "azure/us", "OpenAI", 12, {}], "provider_mismatch"],
    ["model", [null, undefined, "", canonical + " ", alias + ":online", "openai/gpt-5.6-luna-20260710", 12, {}], "model_mismatch"],
  ]) {
    for (const value of badValues) {
      const body = fixture(); body.data[field] = value;
      body.provider = "Azure"; body.data.provider = "Azure";
      body.data.provider_responses[0].endpoint_id = "azure/us";
      rejectPure(body, code);
    }
  }
});

test("R11 no undocumented parent or internal endpoint semantics enter the route proof", () => {
  const base = qualifyGenerationRouteProof(fixture(), expected());
  const body = fixture();
  body.data.generation_type = "nonstandard-future-value";
  body.data.provider_responses[0].endpoint_id = "opaque-cannot-map-to-azure-region";
  body.data.data_region = "global";
  assert.deepEqual(qualifyGenerationRouteProof(body, expected()), base);
  assert.equal(base.requestedEndpoint, "azure/us", "This is admitted request provenance, not observed endpoint proof");
});

test("R11 generation route rejects malformed envelopes and mapped SDK identities", () => {
  for (const body of [null, [], "raw-private", true, 123, {}, { data: null }, { data: [] }, { error: "raw-private", data: fixture().data },
    { data: { id: generationId, providerName: "Azure", model: canonical, providerResponses: [] } },
  ]) rejectPure(body, body?.data?.providerName ? "provider_mismatch" : "response_invalid");
});

test("R11 reader validates and snapshots the exact expectation before transport", async () => {
  let calls = 0;
  const options = { config, fetcher: async () => { calls++; return jsonResponse(); } };
  for (const change of [
    { generationId: "" }, { generationId: "gen-" }, { generationId: "gen-a?other=private" }, { generationId: "gen-a#private" },
    { generationId: "https://untrusted.invalid" }, { generationId: "gen-a/b" }, { generationId: "gen-a%2Fb" },
    { generationId: "gen-a\r\nprivate" }, { generationId: "gen-" + "a".repeat(297) }, { generationId: null },
    ...["\n", "\r", "\r\n", "\u2028", "\u2029"].map(ending => ({ generationId: `gen-a${ending}` })),
    { providerName: "azure" }, { providerName: "OpenAI" }, { requestedEndpoint: "azure" }, { requestedEndpoint: "azure/eu" },
    { acceptedResponseModelIds: [alias] }, { acceptedResponseModelIds: [canonical, alias] },
    { acceptedResponseModelIds: [alias, canonical, "other"] }, { acceptedResponseModelIds: [alias, "openai/gpt-5.6-luna-20260710"] },
    { acceptedResponseModelIds: null }, { timeoutMs: 0 }, { timeoutMs: 10_001 }, { timeoutMs: 1.5 }, { timeoutMs: Infinity },
    { timeoutMs: null }, { fetcher: null },
  ]) await assert.rejects(fetchGenerationRouteProof({ ...expected(), ...options, ...change }), errorCode("invalid_request"));
  assert.equal(calls, 0);
  const request = expected();
  const result = await fetchGenerationRouteProof({ ...request, config, fetcher: async () => {
    request.acceptedResponseModelIds[1] = "openai/other";
    return jsonResponse();
  } });
  assert.equal(result.modelId, canonical);
});

test("R11 malformed inert configs fail safely before fetching and never resolve a real credential", async () => {
  for (const apiKey of ["", " ", null, 123, "private\r\nheader", "x".repeat(4097)]) {
    let calls = 0;
    await assert.rejects(read(fixture(), { config: { apiKey }, fetcher: async () => { calls++; return jsonResponse(); } }), errorCode("configuration_unavailable"));
    assert.equal(calls, 0);
  }
});

test("R11 typed API and transport failures do not retry or expose raw errors", async () => {
  for (const status of [400, 401, 403, 404, 408, 429, 500, 503]) {
    let calls = 0;
    await assert.rejects(read(fixture(), { fetcher: async () => { calls++; return jsonResponse({ error: "PRIVATE_API_RESPONSE" }, { status }); } }), errorCode("api_failure"));
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(read(fixture(), { fetcher: async () => { calls++; throw new Error("PRIVATE_TRANSPORT_ERROR"); } }), error => {
    errorCode("transport_failure")(error);
    assert.ok(!String(error.stack).includes("PRIVATE_TRANSPORT_ERROR"));
    assert.ok(!JSON.stringify(error).includes("PRIVATE"));
    return true;
  });
  assert.equal(calls, 1);
});

test("R11 every redirect or changed response URL fails without a second request", async () => {
  for (const mutate of [
    () => new Response(null, { status: 302, headers: { location: "https://untrusted.invalid/private" } }),
    () => { const response = jsonResponse(); Object.defineProperty(response, "redirected", { value: true }); return response; },
    () => { const response = jsonResponse(); Object.defineProperty(response, "url", { value: "https://untrusted.invalid/private" }); return response; },
    () => { const response = jsonResponse(); Object.defineProperty(response, "type", { value: "opaqueredirect" }); return response; },
  ]) {
    let calls = 0;
    await assert.rejects(read(fixture(), { fetcher: async () => { calls++; return mutate(); } }), errorCode("redirect_rejected"));
    assert.equal(calls, 1);
  }
});

test("R11 ten-second maximum covers an uncooperative fetch and stalled response body", async () => {
  let calls = 0, signal;
  await assert.rejects(read(fixture(), { timeoutMs: 10, fetcher: async (_url, init) => {
    calls++; signal = init.signal; return new Promise(() => {});
  } }), errorCode("timeout"));
  assert.equal(calls, 1);
  assert.equal(signal.aborted, true);
  let cancelled = false;
  await assert.rejects(read(fixture(), { timeoutMs: 10, fetcher: async () => new Response(new ReadableStream({
    start() {}, cancel() { cancelled = true; },
  })) }), errorCode("timeout"));
  assert.equal(cancelled, true);
});

test("R11 bounded 64 KiB response applies to header, streaming bytes and multibyte content", async () => {
  await assert.rejects(read(fixture(), { fetcher: async () => jsonResponse(fixture(), { headers: { "content-length": "65537" } }) }), errorCode("response_too_large"));
  let cancelled = false;
  await assert.rejects(read(fixture(), { fetcher: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(40_000)); controller.enqueue(new Uint8Array(40_000)); },
    cancel() { cancelled = true; },
  }), { headers: { "content-length": "1" } }) }), errorCode("response_too_large"));
  assert.equal(cancelled, true);
  const body = fixture(); body.data.untrusted_extra = "é".repeat(33_000);
  await assert.rejects(read(body), errorCode("response_too_large"));
  const minimal = { data: { id: generationId, provider_name: "Azure", model: canonical } };
  const raw = JSON.stringify(minimal);
  const padded = raw + " ".repeat(65_536 - Buffer.byteLength(raw));
  assert.equal((await read(minimal, { fetcher: async () => new Response(padded) })).providerName, "Azure");
});

test("R11 invalid JSON, empty response, and invalid UTF-8 fail without raw text", async () => {
  for (const response of [new Response("RAW_PRIVATE_NOT_JSON"), new Response(null), new Response(""),
    new Response(new Uint8Array([0xff, 0xfe])), new Response("{\"data\":"),
  ]) await assert.rejects(read(fixture(), { fetcher: async () => response }), errorCode("response_invalid"));
});

test("R11 proof excludes account/app/session/key/upstream IDs and raw text; redacted fields do not affect hash", async () => {
  const body = fixture();
  body.data.api_key = "PRIVATE_KEY"; body.data.prompt = "PRIVATE_PROMPT"; body.data.completion = "PRIVATE_COMPLETION";
  body.data.provider_responses[0].raw_response = "PRIVATE_UPSTREAM_RESPONSE";
  const proof = await read(body), text = JSON.stringify(proof);
  for (const value of ["private", "PRIVATE", "api_key", "app_id", "session_id", "upstream_id", "endpoint_id", "workspace_id", config.apiKey]) {
    assert.ok(!text.includes(value), value);
  }
  assert.equal(proof.proofHash, qualifyGenerationRouteProof(fixture(), expected()).proofHash);
});

test("R11 consumer validation rechecks exact keys, route identities, attempt statuses and canonical hash", () => {
  const original = qualifyGenerationRouteProof(fixture(), expected());
  for (const mutate of [
    proof => { proof.extra = "PRIVATE"; }, proof => { proof.providerResponses[0].extra = "PRIVATE"; },
    proof => { proof.generationId = "gen-other"; }, proof => { proof.providerName = "OpenAI"; },
    proof => { proof.modelId = "openai/other"; }, proof => { proof.requestedEndpoint = "azure/eu"; },
    proof => { proof.providerResponses = null; }, proof => { delete proof.providerResponses; }, proof => { delete proof.providerResponses[0]; },
    proof => { proof.providerResponses[0].status = 500; }, proof => { delete proof.providerResponses[0].providerName; },
    proof => { proof.proofHash = "0".repeat(64); }, proof => { proof.proofHash = proof.proofHash.toUpperCase(); },
    proof => { proof.modelId = alias; },
  ]) {
    const proof = structuredClone(original); mutate(proof);
    assert.throws(() => validateGenerationRouteProof(proof, expected()), GenerationRouteProofError);
  }
  const rekeyed = Object.fromEntries(Object.entries(structuredClone(original)).reverse());
  rekeyed.providerResponses[0] = Object.fromEntries(Object.entries(rekeyed.providerResponses[0]).reverse());
  assert.deepEqual(validateGenerationRouteProof(rekeyed, expected()), original);
});
