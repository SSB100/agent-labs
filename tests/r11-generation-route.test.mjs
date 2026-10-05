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
const errorCode = (code, httpStatus, attempts) => error => {
  assert.ok(error instanceof GenerationRouteProofError);
  assert.equal(error.code, code);
  assert.equal(error.message, "public_research_generation_route_unverified");
  assert.equal(error.cause, undefined);
  assert.ok(error.httpStatus === null || (Number.isInteger(error.httpStatus) && error.httpStatus >= 100 && error.httpStatus <= 599));
  assert.ok(Number.isInteger(error.attempts) && error.attempts >= 0 && error.attempts <= 3);
  if (httpStatus !== undefined) assert.equal(error.httpStatus, httpStatus);
  if (attempts !== undefined) assert.equal(error.attempts, attempts);
  return true;
};
const rejectPure = (body, code) => assert.throws(() => qualifyGenerationRouteProof(body, expected()), errorCode(code, null, 0));
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
    { acceptedResponseModelIds: null }, { timeoutMs: 0 }, { timeoutMs: 20_001 }, { timeoutMs: 1.5 }, { timeoutMs: Infinity },
    { timeoutMs: null }, { fetcher: null },
  ]) await assert.rejects(fetchGenerationRouteProof({ ...expected(), ...options, ...change }), errorCode("invalid_request", null, 0));
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
    await assert.rejects(read(fixture(), { config: { apiKey }, fetcher: async () => { calls++; return jsonResponse(); } }), errorCode("configuration_unavailable", null, 0));
    assert.equal(calls, 0);
  }
});

const flush = () => new Promise(resolve => setImmediate(resolve));
const fakeTime = t => t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.parse("2026-10-05T12:00:00Z") });

test("R11 terminal HTTP failures retain exact status and never retry or expose raw errors", async () => {
  for (const status of [400, 401, 402, 403, 408, 418, 422]) {
    let calls = 0;
    await assert.rejects(read(fixture(), { fetcher: async () => {
      calls++;
      return jsonResponse({ error: "PRIVATE_API_RESPONSE" }, { status, headers: { "retry-after": "1", "x-private": "PRIVATE_HEADER" } });
    } }), error => {
      errorCode("api_failure", status, 1)(error);
      assert.doesNotMatch(JSON.stringify(error), /PRIVATE|inert-route|openrouter|Azure/);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test("R11 404 metadata visibility retries the same owned generation after two seconds", async t => {
  fakeTime(t);
  const request = expected(), mutableConfig = { ...config };
  const args = { ...request, config: mutableConfig };
  const calls = [], start = Date.now();
  args.fetcher = async (url, init) => {
    calls.push({ url, at: Date.now() - start, init });
    assert.equal(init.method, "GET");
    assert.equal(init.body, undefined);
    assert.equal(init.redirect, "error");
    assert.equal(init.cache, "no-store");
    assert.equal(init.credentials, "omit");
    assert.deepEqual(init.headers, { Authorization: `Bearer ${config.apiKey}`, Accept: "application/json" });
    if (calls.length === 1) {
      args.generationId = "gen-other";
      args.providerName = "OpenAI";
      args.requestedEndpoint = "azure/eu";
      request.acceptedResponseModelIds[1] = "openai/other";
      mutableConfig.apiKey = "PRIVATE_CHANGED_KEY";
      args.fetcher = () => assert.fail("Caller mutation cannot replace the captured transport");
      return jsonResponse({ error: "PRIVATE_NOT_READY" }, { status: 404 });
    }
    return jsonResponse();
  };
  const pending = fetchGenerationRouteProof(args);
  await flush();
  t.mock.timers.tick(1_999); await flush(); assert.equal(calls.length, 1);
  t.mock.timers.tick(1); await flush();
  const proof = await pending;
  assert.equal(proof.generationId, generationId);
  assert.deepEqual(calls.map(call => call.at), [0, 2_000]);
  assert.ok(calls.every(call => call.url === `https://openrouter.ai/api/v1/generation?id=${generationId}`));
  assert.ok(calls.every(call => call.init.signal.aborted));
  assert.notEqual(calls[0].init.signal, calls[1].init.signal);
  assert.deepEqual(proof, qualifyGenerationRouteProof(fixture(), expected()));
});

test("R11 Retry-After seconds and HTTP dates are lower bounds on retries", async t => {
  fakeTime(t);
  for (const value of ["5", () => new Date(Date.now() + 5_000).toUTCString(), " 5 "]) {
    let calls = 0;
    const pending = read(fixture(), { fetcher: async () => ++calls === 1
      ? jsonResponse({}, { status: 429, headers: { "retry-after": typeof value === "function" ? value() : value } }) : jsonResponse() });
    await flush();
    t.mock.timers.tick(4_999); await flush(); assert.equal(calls, 1);
    t.mock.timers.tick(1); await flush();
    assert.equal((await pending).generationId, generationId);
    assert.equal(calls, 2);
  }
});

test("R11 second retry waits at least eight seconds and honors a longer Retry-After", async t => {
  fakeTime(t);
  for (const secondWait of [8_000, 9_000]) {
    let calls = 0;
    const times = [], start = Date.now();
    const pending = read(fixture(), { fetcher: async () => {
      times.push(Date.now() - start);
      return ++calls < 3 ? jsonResponse({}, { status: 503, headers: { "retry-after": calls === 1 ? "1" : String(secondWait / 1_000) } }) : jsonResponse();
    } });
    await flush();
    t.mock.timers.tick(2_000); await flush(); assert.equal(calls, 2);
    t.mock.timers.tick(secondWait - 1); await flush(); assert.equal(calls, 2);
    t.mock.timers.tick(1); await flush();
    await pending;
    assert.deepEqual(times, [0, 2_000, 2_000 + secondWait]);
  }
});

test("R11 transient 5xx and network failures recover without a generation request", async t => {
  fakeTime(t);
  for (const status of [500, 502, 503, 504, 599, null]) {
    let calls = 0;
    const pending = read(fixture(), { fetcher: async (_url, init) => {
      assert.equal(init.method, "GET"); assert.equal(init.body, undefined);
      if (++calls === 1) {
        if (status === null) throw new TypeError("PRIVATE_NETWORK_ERROR", { cause: new Error("PRIVATE_HOST") });
        return jsonResponse({}, { status });
      }
      return jsonResponse();
    } });
    await flush(); t.mock.timers.tick(2_000); await flush();
    assert.equal((await pending).providerName, "Azure");
    assert.equal(calls, 2);
  }
});

test("R11 malformed or past Retry-After cannot shorten deterministic backoff", async t => {
  fakeTime(t);
  for (const retryAfter of ["0", "1", "-1", "0.5", "invalid PRIVATE_HEADER", "Mon, 05 Oct 2026 11:59:59 GMT"]) {
    let calls = 0;
    const pending = read(fixture(), { fetcher: async () => ++calls === 1
      ? jsonResponse({}, { status: 429, headers: { "retry-after": retryAfter } }) : jsonResponse() });
    await flush(); t.mock.timers.tick(1_999); await flush(); assert.equal(calls, 1);
    t.mock.timers.tick(1); await flush(); await pending; assert.equal(calls, 2);
  }
});

test("R11 never retries if waiting would consume the remaining cumulative budget", async t => {
  fakeTime(t);
  for (const [timeoutMs, retryAfter] of [[2_000, "0"], [20_000, "20"], [20_000, "21"], [20_000, "9".repeat(310)],
    [20_000, "Mon, 05 Oct 2026 12:00:20 GMT"]]) {
    let calls = 0;
    await assert.rejects(read(fixture(), { timeoutMs, fetcher: async () => {
      calls++; return jsonResponse({}, { status: 429, headers: { "retry-after": retryAfter } });
    } }), errorCode("api_failure", 429, 1));
    assert.equal(calls, 1);
  }
});

test("R11 retry cap is exactly three and terminal metadata describes only the last attempt", async t => {
  fakeTime(t);
  for (const lastStatus of [404, 429, 503, null]) {
    let calls = 0;
    const pending = assert.rejects(read(fixture(), { fetcher: async () => {
      calls++;
      if (calls === 3 && lastStatus === null) throw new Error("PRIVATE_TRANSPORT_ERROR");
      return jsonResponse({ error: "PRIVATE_RAW_BODY" }, { status: calls < 3 ? 503 : lastStatus });
    } }), error => {
      errorCode(lastStatus === null ? "transport_failure" : "api_failure", lastStatus, 3)(error);
      assert.doesNotMatch(JSON.stringify(error) + error.stack, /PRIVATE|inert-route|openrouter\.ai|Azure/);
      return true;
    });
    await flush(); t.mock.timers.tick(2_000); await flush();
    t.mock.timers.tick(7_999); await flush(); assert.equal(calls, 2);
    t.mock.timers.tick(1); await flush(); await pending;
    t.mock.timers.tick(20_000); await flush(); assert.equal(calls, 3);
  }
});

test("R11 timeout attempts are at most ten seconds and the cumulative default is twenty", async t => {
  fakeTime(t);
  const signals = [], times = [], start = Date.now();
  const pending = assert.rejects(read(fixture(), { fetcher: async (_url, init) => {
    signals.push(init.signal); times.push(Date.now() - start); return new Promise(() => {});
  } }), errorCode("timeout", null, 2));
  await flush(); t.mock.timers.tick(9_999); await flush(); assert.equal(signals[0].aborted, false);
  t.mock.timers.tick(1); await flush(); assert.equal(signals[0].aborted, true);
  t.mock.timers.tick(1_999); await flush(); assert.equal(signals.length, 1);
  t.mock.timers.tick(1); await flush(); assert.equal(signals.length, 2);
  t.mock.timers.tick(7_999); await flush(); assert.equal(signals[1].aborted, false);
  t.mock.timers.tick(1); await flush(); await pending;
  assert.deepEqual(times, [0, 12_000]);
  assert.ok(signals.every(signal => signal.aborted));
  t.mock.timers.tick(20_000); await flush(); assert.equal(signals.length, 2);
});

test("R11 synchronous work cannot qualify after an elapsed cumulative or per-attempt deadline", async t => {
  fakeTime(t);
  let calls = 0;
  await assert.rejects(read(fixture(), { fetcher: async () => {
    calls++; t.mock.timers.setTime(Date.now() + 20_000); return jsonResponse();
  } }), errorCode("timeout", 200, 1));
  assert.equal(calls, 1);
  calls = 0;
  const pending = read(fixture(), { fetcher: async () => {
    if (++calls === 1) t.mock.timers.setTime(Date.now() + 10_000);
    return jsonResponse();
  } });
  await flush(); assert.equal(calls, 1);
  t.mock.timers.tick(2_000); await flush();
  assert.equal((await pending).generationId, generationId);
  assert.equal(calls, 2);
});

test("R11 successful late fetches cannot mutate the next attempt or escape the hard deadline", async t => {
  fakeTime(t);
  let lateFetch, calls = 0;
  const pending = read(fixture(), { fetcher: async () => {
    if (++calls === 1) return new Promise(resolve => { lateFetch = resolve; });
    return jsonResponse();
  } });
  await flush(); t.mock.timers.tick(10_000); await flush();
  t.mock.timers.tick(2_000); await flush();
  const proof = await pending;
  let cancelled = false;
  lateFetch(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
  await flush();
  assert.equal(cancelled, true);
  assert.equal(calls, 2);
  assert.deepEqual(proof, qualifyGenerationRouteProof(fixture(), expected()));
});

test("R11 third attempt gets only the remaining deadline and preserves received HTTP status", async t => {
  fakeTime(t);
  let calls = 0, cancelled = false;
  const pending = assert.rejects(read(fixture(), { timeoutMs: 20_000, fetcher: async () => {
    calls++;
    if (calls < 3) {
      await new Promise(resolve => setTimeout(resolve, calls === 1 ? 3_000 : 5_000));
      return jsonResponse({}, { status: 404 });
    }
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  } }), errorCode("timeout", 200, 3));
  await flush(); t.mock.timers.tick(3_000); await flush();
  t.mock.timers.tick(2_000); await flush();
  t.mock.timers.tick(5_000); await flush();
  t.mock.timers.tick(8_000); await flush(); assert.equal(calls, 3);
  t.mock.timers.tick(1_999); await flush(); assert.equal(cancelled, false);
  t.mock.timers.tick(1); await flush(); await pending; assert.equal(cancelled, true);
});

test("R11 body, schema, and correlated identity failures are terminal even after a transient retry", async t => {
  fakeTime(t);
  const cases = [
    [() => new Response("PRIVATE_INVALID_JSON"), "json_invalid"],
    [() => jsonResponse({ data: null }), "response_invalid"],
    [() => jsonResponse({ data: { ...fixture().data, id: "gen-other" } }), "generation_mismatch"],
    [() => jsonResponse({ data: { ...fixture().data, provider_name: "PRIVATE_PROVIDER" } }), "provider_mismatch"],
    [() => jsonResponse({ data: { ...fixture().data, model: "PRIVATE_MODEL" } }), "model_mismatch"],
    [() => jsonResponse({ data: { ...fixture().data, provider_responses: [{ provider_name: "PRIVATE_ATTEMPT" }] } }), "provider_responses_invalid"],
    [() => jsonResponse({}, { headers: { "content-length": "65537" } }), "response_too_large"],
  ];
  for (const [response, code] of cases) {
    let calls = 0;
    const pending = assert.rejects(read(fixture(), { fetcher: async () => ++calls === 1
      ? jsonResponse({}, { status: 404 }) : response() }), error => {
      errorCode(code, 200, 2)(error);
      assert.doesNotMatch(JSON.stringify(error) + error.stack, /PRIVATE|inert-route|openrouter\.ai|Azure/);
      return true;
    });
    await flush(); t.mock.timers.tick(2_000); await flush(); await pending;
    t.mock.timers.tick(20_000); await flush(); assert.equal(calls, 2);
  }
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

test("R11 shortened cumulative deadline covers an uncooperative fetch and stalled response body", async () => {
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

test("R11 invalid JSON and UTF-8 are distinguished from an absent body or invalid schema", async () => {
  for (const [response, code] of [[new Response("RAW_PRIVATE_NOT_JSON"), "json_invalid"],
    [new Response(null), "response_invalid"], [new Response(""), "json_invalid"],
    [new Response(new Uint8Array([0xff, 0xfe])), "json_invalid"], [new Response("{\"data\":"), "json_invalid"],
    [jsonResponse({}), "response_invalid"]]) {
    let calls = 0;
    await assert.rejects(read(fixture(), { fetcher: async () => { calls++; return response; } }), errorCode(code, 200, 1));
    assert.equal(calls, 1);
  }
});

test("R11 Node redirect:error transport rejection is terminal and never leaks its cause", async () => {
  let calls = 0;
  await assert.rejects(read(fixture(), { fetcher: async () => {
    calls++;
    throw new TypeError("fetch failed PRIVATE_URL", { cause: new Error("unexpected redirect") });
  } }), error => {
    errorCode("redirect_rejected", null, 1)(error);
    assert.doesNotMatch(JSON.stringify(error) + error.stack, /PRIVATE|unexpected redirect|inert-route/);
    return true;
  });
  assert.equal(calls, 1);
});

test("R11 public error metadata has safe defaults and rejects invalid numeric metadata", () => {
  const error = new GenerationRouteProofError("response_invalid");
  errorCode("response_invalid", null, 0)(error);
  for (const [status, attempts] of [[0, -1], [600, 4], [NaN, Infinity], ["PRIVATE_STATUS", "PRIVATE_ATTEMPTS"], [200.5, 1.5]]) {
    errorCode("response_invalid", null, 0)(new GenerationRouteProofError("response_invalid", status, attempts));
  }
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
