import test from "node:test";
import assert from "node:assert/strict";
import routeModule from "../.core-tests/research/generation-route.js";

const { fetchGenerationRouteProof, fetchGenerationRouteProofOnce, qualifyGenerationRouteProof, GenerationRouteProofError, isTransientGenerationRouteFailure } = routeModule;
const generationId = "gen-r11-single-read-123", alias = "openai/gpt-5.6-luna", model = "openai/gpt-5.6-luna-20260709";
const expected = () => ({ generationId, providerName: "Azure", acceptedResponseModelIds: [alias, model], requestedEndpoint: "azure/us" });
const config = { apiKey: "inert-single-read-key" };
const now = Date.parse("2026-10-05T12:00:00.000Z");
const fixture = () => ({ data: { id: generationId, provider_name: "Azure", model, provider_responses: [] } });
const response = (status, headers = {}, body = { error: "PRIVATE_UPSTREAM_BODY" }) => new Response(JSON.stringify(body), { status, headers });
const read = options => fetchGenerationRouteProofOnce({ ...expected(), config, now: () => now, ...options });
const flush = () => new Promise(resolve => setImmediate(resolve));

function safeError(error, code, status, retryAfterAt = null) {
  assert.ok(error instanceof GenerationRouteProofError);
  assert.equal(error.message, "public_research_generation_route_unverified");
  assert.equal(error.code, code);
  assert.equal(error.httpStatus, status);
  assert.equal(error.attempts, 1);
  assert.equal(error.retryAfterAt, retryAfterAt);
  assert.equal(error.cause, undefined);
  assert.doesNotMatch(JSON.stringify(error) + error.stack, /PRIVATE|inert-single-read|openrouter\.ai|unexpected redirect/);
  return true;
}

test("R11 single-attempt reader performs exactly one fixed-origin GET and retains route proof validation", async () => {
  let calls = 0;
  const proof = await read({ config: { ...config, baseUrl: "https://untrusted.invalid" }, fetcher: async (url, init) => {
    calls++;
    assert.equal(url, `https://openrouter.ai/api/v1/generation?id=${generationId}`);
    assert.equal(init.method, "GET");
    assert.equal(init.body, undefined);
    assert.equal(init.redirect, "error");
    assert.equal(init.cache, "no-store");
    assert.equal(init.credentials, "omit");
    assert.deepEqual(init.headers, { Authorization: `Bearer ${config.apiKey}`, Accept: "application/json" });
    return response(200, {}, fixture());
  } });
  assert.equal(calls, 1);
  assert.deepEqual(proof, qualifyGenerationRouteProof(fixture(), expected()));
  assert.ok(Object.isFrozen(proof));
});

test("R11 single-attempt transient failures never schedule an internal retry", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now });
  for (const status of [404, 429, 500, 502, 503, 504, 599, null]) {
    let calls = 0;
    await assert.rejects(read({ fetcher: async () => {
      calls++;
      if (status === null) throw new TypeError("PRIVATE_TRANSPORT_ERROR", { cause: new Error("PRIVATE_HOST") });
      return response(status, { "retry-after": "5", "x-private": "PRIVATE_HEADER" });
    } }), error => {
      safeError(error, status === null ? "transport_failure" : "api_failure", status,
        status === null ? null : "2026-10-05T12:00:05.000Z");
      assert.equal(isTransientGenerationRouteFailure(error), true);
      return true;
    });
    t.mock.timers.tick(60_000); await flush();
    assert.equal(calls, 1);
  }
});

test("R11 single-attempt retry timestamps normalize seconds and all HTTP-date formats", async () => {
  for (const [header, timestamp] of [
    ["5", "2026-10-05T12:00:05.000Z"],
    [" 005 ", "2026-10-05T12:00:05.000Z"],
    ["Mon, 05 Oct 2026 12:00:07 GMT", "2026-10-05T12:00:07.000Z"],
    ["Monday, 05-Oct-26 12:00:07 GMT", "2026-10-05T12:00:07.000Z"],
    ["Mon Oct  5 12:00:07 2026", "2026-10-05T12:00:07.000Z"],
    ["Tue, 29 Feb 2028 12:00:00 GMT", "2028-02-29T12:00:00.000Z"],
  ]) {
    let calls = 0;
    await assert.rejects(read({ fetcher: async () => { calls++; return response(429, { "retry-after": header }); } }),
      error => safeError(error, "api_failure", 429, timestamp));
    assert.equal(calls, 1);
  }
});

test("R11 malformed and past Retry-After values expose no unsafe timestamp", async () => {
  for (const header of [null, "", "0", "-1", "0.5", "1e3", "Infinity", "PRIVATE_HEADER", "5 PRIVATE_HEADER",
    "2026-10-05T12:00:07.000Z", "Mon, 05 Oct 2026 11:59:59 GMT", "Mon, 05 Oct 2026 12:00:00 GMT",
    "Mon, 05 Oct 2026 12:00:07 GMT PRIVATE_HEADER", "Tue, 05 Oct 2026 12:00:07 GMT", "Funday, 05-Oct-26 12:00:07 GMT",
    "Mon, 05 Oct 2026 25:00:00 GMT", "Mon, 05 Oct 2026 12:60:00 GMT", "Wed, 30 Feb 2028 12:00:00 GMT",
  ]) {
    let calls = 0;
    await assert.rejects(read({ fetcher: async () => {
      calls++; return response(503, header === null ? {} : { "retry-after": header });
    } }), error => safeError(error, "api_failure", 503));
    assert.equal(calls, 1);
  }
});

test("R11 large numeric retry delays saturate four-digit timestamps without discarding the provider wait", async () => {
  const latest = "9999-12-31T23:59:59.999Z";
  const cases = ["9999-12-31T23:59:59.000Z", "+010000-01-01T00:00:00.000Z", "+010001-01-01T00:00:00.000Z"].map(timestamp => {
    const seconds = (Date.parse(timestamp) - now) / 1_000;
    assert.ok(Number.isSafeInteger(seconds));
    return [String(seconds), timestamp.startsWith("+") ? latest : timestamp];
  });
  cases.push(...["315360000000", "9".repeat(310), "8640000000000000", "9999999999999999"].map(header => [header, latest]));
  for (const reader of [fetchGenerationRouteProofOnce, fetchGenerationRouteProof]) {
    for (const [header, timestamp] of cases) {
      let calls = 0;
      await assert.rejects(reader({ ...expected(), config, now: () => now, fetcher: async () => {
        calls++; return response(429, { "retry-after": header });
      } }), error => safeError(error, "api_failure", 429, timestamp));
      assert.equal(calls, 1);
    }
  }
  for (const timestamp of ["+010000-01-01T00:00:00.000Z", "-000001-01-01T00:00:00.000Z"]) {
    assert.equal(new GenerationRouteProofError("api_failure", 429, 1, timestamp).retryAfterAt, null);
  }
});

test("R11 single-attempt auth, schema, identity, redirect, and oversize failures stay terminal", async () => {
  const cases = [
    ...[400, 401, 402, 403, 408, 418, 422].map(status => [() => response(status, { "retry-after": "5" }), "api_failure", status]),
    [() => response(200, {}, {}), "response_invalid", 200],
    [() => new Response("PRIVATE_INVALID_JSON"), "json_invalid", 200],
    [() => response(200, {}, { data: { ...fixture().data, id: "gen-other" } }), "generation_mismatch", 200],
    [() => response(200, {}, { data: { ...fixture().data, model: "PRIVATE_MODEL" } }), "model_mismatch", 200],
    [() => response(200, {}, { data: { ...fixture().data, provider_name: "PRIVATE_PROVIDER" } }), "provider_mismatch", 200],
    [() => response(200, {}, { data: { ...fixture().data, provider_responses: [{}] } }), "provider_responses_invalid", 200],
    [() => response(503, { "content-length": "65537", "retry-after": "5" }), "response_too_large", 503],
    [() => new Response(null, { status: 302, headers: { location: "https://untrusted.invalid/PRIVATE_PATH" } }), "redirect_rejected", 302],
    [() => { throw new TypeError("PRIVATE_FETCH_ERROR", { cause: new Error("unexpected redirect") }); }, "redirect_rejected", null],
  ];
  for (const [makeResponse, code, status] of cases) {
    let calls = 0;
    await assert.rejects(read({ fetcher: async () => { calls++; return makeResponse(); } }), error => {
      safeError(error, code, status);
      assert.equal(isTransientGenerationRouteFailure(error), false);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test("R11 single-attempt deadlines use real elapsed time even with a frozen trusted timestamp clock", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now });
  for (const timeoutMs of [20_000, 17]) {
    let calls = 0, signal;
    const pending = assert.rejects(read({ timeoutMs, fetcher: async (_url, init) => {
      calls++; signal = init.signal; return new Promise(() => {});
    } }), error => {
      safeError(error, "timeout", null);
      assert.equal(isTransientGenerationRouteFailure(error), true);
      return true;
    });
    await flush();
    t.mock.timers.tick(Math.min(10_000, timeoutMs) - 1); await flush();
    assert.equal(signal.aborted, false);
    t.mock.timers.tick(1); await flush(); await pending;
    assert.equal(signal.aborted, true);
    t.mock.timers.tick(60_000); await flush();
    assert.equal(calls, 1);
  }
});

test("R11 invalid trusted Retry-After clocks fail before any GET without leaking exceptions", async () => {
  for (const clock of [null, 1, () => NaN, () => Infinity, () => "PRIVATE_TIME", () => 1.5, () => 8_640_000_000_000_001,
    () => { throw new Error("PRIVATE_CLOCK_ERROR"); }]) {
    let calls = 0;
    await assert.rejects(read({ now: clock, fetcher: async () => { calls++; return response(200, {}, fixture()); } }), error => {
      assert.ok(error instanceof GenerationRouteProofError);
      assert.equal(error.code, "invalid_request");
      assert.equal(error.attempts, 0);
      assert.equal(error.retryAfterAt, null);
      assert.equal(isTransientGenerationRouteFailure(error), false);
      assert.doesNotMatch(JSON.stringify(error) + error.stack, /PRIVATE/);
      return true;
    });
    assert.equal(calls, 0);
  }
});

test("R11 transient classification trusts only reader errors and public retry metadata is canonical", () => {
  for (const value of [null, {}, new Error("PRIVATE_ERROR"), { code: "transport_failure" }, { code: "api_failure", httpStatus: 429 }]) {
    assert.equal(isTransientGenerationRouteFailure(value), false);
  }
  for (const code of ["invalid_request", "configuration_unavailable", "redirect_rejected", "response_too_large", "json_invalid",
    "response_invalid", "generation_mismatch", "provider_mismatch", "model_mismatch", "provider_responses_invalid"]) {
    assert.equal(isTransientGenerationRouteFailure(new GenerationRouteProofError(code, 503, 1)), false);
  }
  for (const value of [undefined, null, 5, "PRIVATE_HEADER", "Mon, 05 Oct 2026 12:00:05 GMT", "2026-10-05T12:00:05Z",
    "2026-02-30T12:00:00.000Z", "2026-10-05T12:00:05.000Z PRIVATE_HEADER"]) {
    const error = new GenerationRouteProofError("api_failure", 429, 1, value);
    assert.equal(error.retryAfterAt, null);
    assert.doesNotMatch(JSON.stringify(error), /PRIVATE/);
  }
  assert.equal(new GenerationRouteProofError("api_failure", 429, 1, "2026-10-05T12:00:05.000Z").retryAfterAt, "2026-10-05T12:00:05.000Z");
});
