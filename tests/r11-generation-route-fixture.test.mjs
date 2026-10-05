import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { fixtureData } from './next-fixture/data.mjs';
import { seedResearchFixture, researchGenerationFixture, researchOwnerFixture, researchRuntimeFixture,
 r11Scope, R11_INERT_SERVER_KEY, R11_RAW_SENTINEL } from './next-fixture/r11-research.mjs';
import { submitSavedRouteCheck } from './next-fixture/r11-journeys.mjs';
import { FIXTURE_ACTION_TIMEOUT_MS } from './next-fixture/async-bounds.mjs';

const require = createRequire(import.meta.url);
const alias = 'openai/gpt-5.6-luna', canonical = 'openai/gpt-5.6-luna-20260709';
const expectation = () => ({ generationId: 'gen-r11-historical-search-receipt', providerName: 'Azure',
 acceptedResponseModelIds: [alias, canonical], requestedEndpoint: 'azure/us' });
const inertKey = 'inert-r11-generation-placeholder';
const wire = expected => ({ method: 'GET', headers: { Authorization: `Bearer ${inertKey}`, Accept: 'application/json' },
 redirect: 'error', cache: 'no-store', credentials: 'omit', signal: new AbortController().signal,
 ...expected });

function loadSource(path, imports, globals = {}) {
 const source = ts.transpileModule(readFileSync(path, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
 }).outputText;
 const compiledModule = { exports: {} };
 runInNewContext(`(function(require,module,exports){${source}\n})`, {
  URL, Response, Headers, Buffer, TextDecoder, AbortController, AbortSignal, setTimeout, clearTimeout,
  process: { env: new Proxy({}, { get() { assert.fail('No private or public environment read is needed for the generation fixture'); } }) },
  fetch: () => assert.fail('The generation fixture must never contact any network'),
  ...globals,
 })(name => {
  if (Object.hasOwn(imports, name)) return imports[name];
  assert.equal(name, 'node:crypto', `Unexpected import: ${name}`);
  return require(name);
 }, compiledModule, compiledModule.exports);
 return compiledModule.exports;
}

function fixture(generationResponses = []) {
 const data = fixtureData(); data.r11Research = seedResearchFixture(data, { r11Historical: true });
 const state = { calls: [], fetches: [], runtimeArgs: [], loopbackReads: [], data, log: [] };
 const control = { r11GenerationResponses: [...generationResponses] };
 // The production reader owns expectation validation, transport constraints,
 // response parsing, projection and hashing. Only external capabilities differ.
 const route = loadSource('src/research/generation-route.ts', {
  '../models/openrouter': { getOpenRouterConfig: () => assert.fail('No private provider credential reads') },
 });
 const realReader = args => {
  state.calls.push(args);
  return route.fetchGenerationRouteProof({ ...args, fetcher: async (url, init) => {
   const response = await args.fetcher(url, init);
   const raw = await response.clone().json().catch(() => null);
   state.fetches.push({ url, init, status: response.status, raw });
   return response;
  } });
 };
 const exports = loadSource('tests/next-fixture/r11-dependencies.ts', {
  '@/models/openrouter': { OpenRouterAdapter: class { constructor() { assert.fail('Route checks do not construct a paid model adapter'); } } },
  '@/research/generation-route': { ...route, fetchGenerationRouteProof: realReader },
  '@/research/qualification-quote': { fetchPublicResearchQuote: () => assert.fail('Route checks do not fetch a catalog'), PUBLIC_RESEARCH_QUOTE_LIMITS: {} },
  '@/research/qualification-runtime': { publicResearchRuntime: (...args) => {
   state.runtimeArgs.push(args);
   return { rpc: 'preserved-rpc', settle: 'preserved-settle', verifyQuote: args[1],
    verifyGenerationRoute: () => assert.fail('Production route transport must be replaced in the Next fixture') };
  } },
 }, {
  process: { env: new Proxy({}, { get(_value, name) {
   assert.equal(name, 'R03_BOUNDARY', 'No private credential or unrelated configuration read');
   return 'http://127.0.0.1:12345';
  } }) },
  fetch: async (url, init) => {
   assert.equal(url, 'http://127.0.0.1:12345/r11/generation');
   assert.equal(init.method, 'POST');
   const body = JSON.parse(init.body);
   assert.deepEqual(Object.keys(body), ['url']);
   state.loopbackReads.push(body);
   return Response.json(researchGenerationFixture(data, body, state.log, control));
  },
 });
 return { state, route, dependencies: exports.researchQualificationDependencies() };
}
const plain = value => JSON.parse(JSON.stringify(value));

test('R11 Next fixture uses the real generation reader with one exact inert documented GET', async () => {
 const f = fixture(), expected = expectation();
 const proof = await f.dependencies.fetchGenerationRoute(expected);
 assert.equal(f.state.calls.length, 1);
 assert.deepEqual(plain(f.state.calls[0].config), { apiKey: inertKey });
 assert.equal(f.state.fetches.length, 1);
 const request = f.state.fetches[0];
 assert.equal(request.url, `https://openrouter.ai/api/v1/generation?id=${expected.generationId}`);
 assert.equal(request.init.method, 'GET');
 assert.equal(request.init.body, undefined);
 assert.equal(request.init.redirect, 'error');
 assert.equal(request.init.cache, 'no-store');
 assert.equal(request.init.credentials, 'omit');
 assert.deepEqual(plain(request.raw), { data: { id: expected.generationId, provider_name: 'Azure', model: canonical,
  provider_responses: [{ provider_name: 'Azure', model_permaslug: canonical, status: 200 }] } });
 assert.deepEqual(plain(proof), plain(f.route.qualifyGenerationRouteProof(request.raw, expected)));
 assert.deepEqual(plain(f.route.validateGenerationRouteProof(proof, expected)), plain(proof));
 assert.equal(proof.requestedEndpoint, 'azure/us');
 assert.match(proof.proofHash, /^[a-f0-9]{64}$/);
 assert.doesNotMatch(JSON.stringify(proof), /inert-r11-generation-placeholder|provider_name|generation_type|endpoint_id/);
});

test('R11 runtime and saved owner route checks share the inert real reader without changing runtime scope', async () => {
 const f = fixture(), scope = { businessId: 'owned-business', coreWorkflowRunId: 'saved-run',
  runtimeCapability: 'PRIVATE_RUNTIME_AUTHORITY', admissionKey: 'PRIVATE_ADMISSION_AUTHORITY' };
 const verifyQuote = async () => ({ providerName: 'Azure' });
 const runtime = f.dependencies.makeRuntime(scope, verifyQuote);
 assert.equal(f.state.runtimeArgs.length, 1);
 assert.equal(f.state.runtimeArgs[0][0], scope);
 assert.equal(f.state.runtimeArgs[0][1], verifyQuote);
 assert.equal(runtime.rpc, 'preserved-rpc');
 assert.equal(runtime.settle, 'preserved-settle');
 assert.equal(runtime.verifyQuote, verifyQuote);
 assert.equal(runtime.verifyGenerationRoute, f.dependencies.fetchGenerationRoute);
 const proof = await runtime.verifyGenerationRoute(expectation());
 assert.equal(proof.providerName, 'Azure');
 assert.equal(proof.modelId, canonical);
 assert.equal(f.state.fetches.length, 1);
 assert.doesNotMatch(JSON.stringify(f.state.fetches), /PRIVATE_RUNTIME_AUTHORITY|PRIVATE_ADMISSION_AUTHORITY/);
});

test('R11 Next transport recovers a transient receipt 404 through the real reader without changing any saved state', async () => {
 const f = fixture(['not_found', 'success']), original = structuredClone(f.state.data.r11Research);
 const proof = await f.dependencies.fetchGenerationRoute(expectation());
 assert.equal(proof.generationId, expectation().generationId);
 assert.equal(f.state.calls.length, 1, 'One reader invocation, never a repeated paid call');
 assert.deepEqual(f.state.fetches.map(row => row.status), [404, 200]);
 assert.deepEqual(f.state.fetches.map(row => row.url), Array(2).fill(`https://openrouter.ai/api/v1/generation?id=${proof.generationId}`));
 assert.equal(f.state.loopbackReads.length, 2);
 assert.deepEqual(f.state.data.r11Research, original);
 assert.doesNotMatch(JSON.stringify(proof), new RegExp(R11_RAW_SENTINEL));
});

test('R11 Next transport preserves terminal auth, invalid JSON, invalid envelope and identity diagnostics with one GET', async () => {
 for (const [scenario, code, httpStatus] of [['unauthorized', 'api_failure', 401], ['invalid_json', 'json_invalid', 200],
  ['invalid_envelope', 'response_invalid', 200], ['wrong_generation', 'generation_mismatch', 200]]) {
  const f = fixture([scenario]), original = structuredClone(f.state.data.r11Research);
  await assert.rejects(f.dependencies.fetchGenerationRoute(expectation()), error => {
   assert.equal(error.name, 'GenerationRouteProofError');assert.equal(error.code, code);
   assert.equal(error.httpStatus, httpStatus);assert.equal(error.attempts, 1);
   assert.equal(error.message, 'public_research_generation_route_unverified');
   assert.doesNotMatch(JSON.stringify(error), new RegExp(R11_RAW_SENTINEL));return true;
  });
  assert.equal(f.state.calls.length, 1);assert.equal(f.state.fetches.length, 1);assert.equal(f.state.loopbackReads.length, 1);
  assert.deepEqual(f.state.data.r11Research, original);
 }
});

test('R11 saved-route browser helper bounds exact action headers and success/error DOM without reading Flight EOF', async () => {
 for (const failure of [null, /Receipt metadata check: api_failure; HTTP 401; reads attempted 1/]) {
  const events = [], actionUrl = 'http://127.0.0.1:12345/dashboard/research-qualification';
  const request = { method: () => 'POST', url: () => actionUrl, headers: () => ({ 'next-action': 'inert-action' }) };
  const response = { request: () => request, status: () => 200, headers: () => ({}),
   finished: () => assert.fail('Must not wait for Flight EOF'), body: () => assert.fail('Must not consume Flight body') };
  let capture, sendHeaders;
  const waitFor = label => async options => { assert.deepEqual(options, { state: 'visible', timeout: FIXTURE_ACTION_TIMEOUT_MS });events.push(label); };
  const button = { waitFor: waitFor('button'), click: async options => {
   assert.deepEqual(options, { timeout: FIXTURE_ACTION_TIMEOUT_MS });capture(request);sendHeaders();
  } };
  const page = { url: () => actionUrl,
   on: (event, handler) => { assert.equal(event, 'request');capture = handler; },
   off: (event, handler) => { assert.equal(event, 'request');assert.equal(handler, capture);events.push('cleanup'); },
   waitForResponse: (predicate, options) => {
    assert.deepEqual(options, { timeout: FIXTURE_ACTION_TIMEOUT_MS });
    return new Promise(resolve => { sendHeaders = () => {
     assert.equal(predicate({ ...response, request: () => ({ ...request }) }), false, 'Only the captured request identity is accepted');
     assert.equal(predicate(response), true);events.push('headers');resolve(response);
    }; });
   },
  };
  const route = { getByRole: (role, options) => {
   if(role === 'button'){assert.deepEqual(options, { name: 'Verify saved inference route', exact: true });return button;}
   assert.equal(role, 'alert');return { filter: options => {assert.equal(options.hasText, failure);return { waitFor: waitFor('alert') };} };
  }, locator: selector => { assert.equal(selector, '[data-r11-route-evidence]');return { waitFor: waitFor('evidence') }; } };
  await submitSavedRouteCheck(page, route, failure);
  assert.deepEqual(events, ['headers', failure ? 'alert' : 'evidence', 'button', 'cleanup']);
 }
});

test('R11 generation fixture rejects URL, method, request body and transport-policy drift', async () => {
 const f = fixture(), expected = expectation();
 await f.dependencies.fetchGenerationRoute(expected);
 const fetcher = f.state.calls[0].fetcher;
 const url = `https://openrouter.ai/api/v1/generation?id=${expected.generationId}`;
 for (const badUrl of [url + '&extra=1', url.replace(expected.generationId, 'gen-other'),
  url.replace('openrouter.ai', 'other.invalid'), url.replace('/generation?', '/chat/completions?'),
  url.replace('https:', 'http:'), url + '#private']) {
  await assert.rejects(fetcher(badUrl, wire()), /inert_exact_generation_wire_required/);
 }
 for (const drift of [
  { method: 'POST' }, { method: undefined }, { body: '' }, { body: '{}' }, { body: null },
  { redirect: 'follow' }, { cache: 'default' }, { credentials: 'include' }, { signal: undefined },
  { headers: { Authorization: 'Bearer PRIVATE_CREDENTIAL', Accept: 'application/json' } },
  { headers: { Authorization: `Bearer ${inertKey}`, Accept: 'text/plain' } },
  { headers: { Authorization: `Bearer ${inertKey}`, Accept: 'application/json', 'X-Private': 'private' } },
 ]) await assert.rejects(fetcher(url, wire(drift)), /inert_exact_generation_wire_required/);
});

test('R11 generation fixture preserves invalid expectation rejection before synthetic transport', async () => {
 for (const drift of [{ generationId: 'inert-r11-invalid-old-id' }, { generationId: 'gen-private?extra=1' },
  { providerName: 'OpenAI' }, { requestedEndpoint: 'azure/eu' }, { acceptedResponseModelIds: [canonical] }]) {
  const f = fixture();
  await assert.rejects(f.dependencies.fetchGenerationRoute({ ...expectation(), ...drift }), error => {
   assert.equal(error.code, 'invalid_request');
   assert.equal(error.message, 'public_research_generation_route_unverified');
   return true;
  });
  assert.equal(f.state.fetches.length, 0);
 }
});

test('R11 generation fixture does not accept caller-supplied transport or credentials', async () => {
 const f = fixture();
 const proof = await f.dependencies.fetchGenerationRoute({ ...expectation(),
  config: { apiKey: 'PRIVATE_CALLER_KEY', baseUrl: 'https://private.invalid' },
  fetcher: () => assert.fail('Caller cannot replace the fixture transport'), timeoutMs: 1 });
 assert.equal(proof.providerName, 'Azure');
 assert.equal(f.state.fetches.length, 1);
 assert.deepEqual(plain(f.state.calls[0].config), { apiKey: inertKey });
 assert.equal(f.state.calls[0].timeoutMs, undefined);
 assert.doesNotMatch(JSON.stringify(f.state.calls), /PRIVATE_CALLER_KEY|private\.invalid/);
});

test('R11 generation boundary resolves only a saved inert receipt and retains provider mismatch rejection', () => {
 const state = fixtureData(); state.r11Research = seedResearchFixture(state, { r11Historical: true });
 const original = structuredClone(state.r11Research), log = [], generationId = original.providerCalls[0].receiptId;
 const input = { url: `https://openrouter.ai/api/v1/generation?id=${generationId}` };
 const f = fixture(), expected = { ...expectation(), generationId };
 const response = researchGenerationFixture(state, input, log, {});
 assert.equal(response.status, 200);assert.equal(f.route.qualifyGenerationRouteProof(JSON.parse(response.body), expected).providerName, 'Azure');
 assert.deepEqual(state.r11Research, original);
 assert.deepEqual(log, [{ kind: 'inert-r11-generation-read', url: input.url, generationId }]);
 const invalid = researchGenerationFixture(state, input, log, { r11InvalidProvider: true });
 assert.equal(JSON.parse(invalid.body).data.provider_name, R11_RAW_SENTINEL);
 assert.throws(() => f.route.qualifyGenerationRouteProof(JSON.parse(invalid.body), expected), error => error.code === 'provider_mismatch');
 for (const bad of [{ url: input.url + '&other=1' }, { url: input.url + '#private' },
  { url: input.url.replace('https:', 'http:') }, { url: input.url.replace(generationId, 'gen-unknown') },
  { url: input.url, config: { apiKey: 'PRIVATE' } }, {}, null]) {
  assert.throws(() => researchGenerationFixture(state, bad, log, {}));
 }
 assert.equal(log.length, 2);assert.deepEqual(state.r11Research, original);
});

test('R11 financial fixture preserves distinct receipt hashes, deduplicates repeats and takes maximum per-request exposure', () => {
 const state = fixtureData(); state.r11Research = seedResearchFixture(state, { r11Historical: true });
 const effects = [], original = structuredClone(state.r11Research.settlements[0]);
 const settle = payload => researchRuntimeFixture(state, 'r05_admission_server', {
  p_business_id: r11Scope.businessId, p_operation: 'settle', p_server_key: R11_INERT_SERVER_KEY, p_payload: payload,
 }, effects, {});
 const read = () => researchOwnerFixture(state, 'r11_research_workspace_v2', { p_business_id: r11Scope.businessId }, effects, {}).data;
 assert.equal(read().exposure.heldMicrounits, '608131');
 assert.equal(settle(original).error, null);assert.equal(state.r11Research.settlements.length, 1);assert.equal(effects.length, 0);
 const enriched = { ...original, receiptHash: 'e'.repeat(64) };
 assert.equal(settle(enriched).error, null);assert.equal(settle(enriched).error, null);
 assert.equal(state.r11Research.settlements.length, 2);assert.equal(effects.length, 1);
 assert.deepEqual(state.r11Research.settlements[0], original);
 assert.equal(read().exposure.heldMicrounits, '608131', 'Route enrichment never doubles the reported charge');
 assert.equal(read().policies[0].phases[0].actualMicrounits, '10068');
 assert.equal(read().continuation.remainingMicrounits, '239932');
 assert.ok(settle({ ...enriched, actualMicrounits: '10069' }).error, 'The same receipt hash cannot change its financial content');
 assert.equal(settle({ ...original, receiptHash: 'f'.repeat(64), actualMicrounits: null }).error, null);
 assert.equal(read().exposure.heldMicrounits, '608131');assert.equal(read().exposure.hasUnknown, false);
 assert.equal(settle({ ...original, receiptHash: 'a'.repeat(64), actualMicrounits: '10070' }).error, null);
 assert.equal(read().exposure.heldMicrounits, '608133');assert.equal(read().policies[0].phases[0].actualMicrounits, '10070');
 for (const drift of [{ receiptHash: 'bad' }, { providerRequestId: 'gen-foreign' }, { currency: 'NZD' },
  { actualMicrounits: '-1' }, { actualMicrounits: '9007199254740992' }]) {
  assert.ok(settle({ ...original, ...drift }).error);
 }
 assert.equal(state.r11Research.settlements.length, 4);
});
