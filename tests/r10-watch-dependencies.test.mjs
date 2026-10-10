import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const identity = {
  sessionId: '10000000-0000-4000-8000-000000000001',
  businessId: '10000000-0000-4000-8000-000000000002',
  questId: '10000000-0000-4000-8000-000000000003',
  workflowRunId: '10000000-0000-4000-8000-000000000004',
  ownerId: '10000000-0000-4000-8000-000000000005',
  authSessionId: '10000000-0000-4000-8000-000000000006',
};
const providerId = '20000000-0000-4000-8000-000000000001';

// Load the real production factory and Steel transport, replacing only external
// capabilities. The VM has no real environment, browser connector or fetch.
function loadSource(file, mocks = {}, globals = {}) {
  const compiled = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiledModule = { exports: {} };
  runInNewContext(`(function(require,module,exports){${compiled}\n})`, {
    URL, Response, Buffer, Date, AbortController, AbortSignal, setTimeout, clearTimeout, ...globals,
  })(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    assert.equal(name, 'node:crypto', `Unexpected production seam import: ${name}`);
    return require(name);
  }, compiledModule, compiledModule.exports);
  return compiledModule.exports;
}

function fixture(options = {}) {
  const state = { clock: 0, fetches: [], rpcs: [], clients: 0, configReads: 0, diagnostics: [] };
  const env = {
    STEEL_API_KEY: 'INERT_PROVIDER_KEY',
    R10_VIEWER_SERVER_KEY: 'INERT_AUTHORITY_NOT_A_REAL_KEY_123456',
    ...options.env,
  };
  const globals = {
    console: { info: (...values) => state.diagnostics.push(values) },
    process: { env }, performance: { now: () => state.clock },
    fetch: async (url, init) => {
      state.fetches.push({ url: String(url), init });
      if(String(url).endsWith('/release')) return Response.json({success:true,message:'Inert release acknowledged'});
      return Response.json({ id: options.providerId ?? providerId,
        websocketUrl: 'wss://untrusted.invalid/never-use-this',
        debugUrl: 'https://untrusted.invalid/never-return-this', profileId: 'untrusted-profile' });
    },
  };
  const contracts = loadSource('src/browser/watch/contracts.ts');
  const types = loadSource('src/browser/types.ts');
  const admission = loadSource('src/core/transport-admission.ts');
  const provider = loadSource('src/browser/providers/steel.ts', {
    '../types': types, '../../core/transport-admission': admission,
    '../../core/request-deadline': loadSource('src/core/request-deadline.ts', {}, globals),
    '../etsy-steel-create-binding': loadSource('src/browser/etsy-steel-create-binding.ts', {
      '../products/discovery-v2-hash': loadSource('src/products/discovery-v2-hash.ts'),
    }, globals),
  }, globals);
  const originalConfig = provider.getSteelConfig;
  const factory = loadSource('src/browser/watch-dependencies.ts', {
    'server-only': {},
    './providers/steel': { ...provider, getSteelConfig: () => { state.configReads++; return originalConfig(); } },
    './watch/capture': { connectControlledCapture: () => { throw Error('Real capture is forbidden in this inert fixture'); } },
    './watch/contracts': contracts,
    './watch/diagnostics': loadSource('src/browser/watch/diagnostics.ts'),
    '@/lib/supabase/runtime': { createRuntimeClient: () => {
      state.clients++;
      return { rpc: async (name, args) => {
        state.rpcs.push({ name, args });
        state.clock += options.readDelayMs ?? 0;
        options.afterRead?.();
        return options.rpcResult ?? { data: { status: 'starting', createDispatched: true }, error: null };
      } };
    } },
  }, globals).createViewerDependencies;
  return { state, create: () => factory(identity) };
}

test('R10 production factory stays inert without separately configured authority', () => {
  for (const key of [undefined, '', '   ']) {
    const f = fixture({ env: { R10_VIEWER_SERVER_KEY: key } });
    assert.throws(f.create, /viewer_authority_unavailable/);
    assert.equal(f.state.clients, 0);
    assert.equal(f.state.configReads, 0);
    assert.equal(f.state.rpcs.length, 0);
    assert.equal(f.state.fetches.length, 0);
  }
});

test('R10 production factory forwards exact private scope and fixes provider destinations', async () => {
  const f = fixture(), deps = f.create();
  const created = await deps.createProvider(15_000, () => {});
  assert.equal(f.state.fetches.length, 1);
  assert.equal(f.state.rpcs.length, 1);
  const { name, args } = f.state.rpcs[0];
  assert.equal(name, 'r10_viewer_server');
  for (const [key, parameter] of Object.entries({ sessionId: 'session', businessId: 'business', questId: 'quest', workflowRunId: 'workflow_run', ownerId: 'owner', authSessionId: 'auth_session' })) {
    assert.equal(args[`p_${parameter}_id`], identity[key]);
  }
  assert.equal(args.p_operation, 'read');
  assert.equal(args.p_server_key, 'INERT_AUTHORITY_NOT_A_REAL_KEY_123456');
  const request = f.state.fetches[0], endpoint = new URL(created.endpoint);
  assert.equal(request.url, 'https://api.steel.dev/v1/sessions');
  assert.equal(request.init.redirect, 'error');
  assert.equal(JSON.parse(request.init.body).persistProfile, false);
  assert.equal(endpoint.origin, 'wss://connect.steel.dev');
  assert.equal(endpoint.pathname, '/');
  assert.equal(endpoint.searchParams.get('sessionId'), providerId);
  assert.equal(endpoint.searchParams.get('apiKey'), 'INERT_PROVIDER_KEY');
  assert.deepEqual([...endpoint.searchParams.keys()].sort(), ['apiKey', 'sessionId']);
  assert.equal(created.providerSessionId, providerId);
  assert.match(created.receiptHash, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(created), /untrusted\.invalid|untrusted-profile/);
  await deps.releaseProvider(providerId);
  assert.equal(f.state.rpcs.length, 1, 'Cleanup must not require fresh dispatch authorization');
  assert.equal(f.state.fetches[1].url, `https://api.steel.dev/v1/sessions/${providerId}/release`);
  assert.equal(f.state.fetches[1].init.redirect, 'error');
});

test('R10 production admission rejects missing dispatch proof, revocation and malformed RPC replies', async () => {
  for (const rpcResult of [
    { data: { status: 'starting' }, error: null },
    { data: { status: 'starting', createDispatched: false }, error: null },
    { data: { status: 'revocation_pending', createDispatched: true }, error: null },
    { data: null, error: null }, { data: [], error: null },
    { data: { status: 'starting', createDispatched: true }, error: { message: 'inert failure' } },
  ]) {
    const f = fixture({ rpcResult });
    await assert.rejects(f.create().createProvider(15_000, () => {}));
    assert.equal(f.state.fetches.length, 0);
  }
});

test('R10 production admission includes RPC latency and rejects final runtime stop before fetch', async () => {
  for (const readDelayMs of [1_850, 1_851]) {
    const f = fixture({ readDelayMs });
    await assert.rejects(f.create().createProvider(15_000, () => {}));
    assert.equal(f.state.fetches.length, 0);
  }
  let stopped = false;
  const f = fixture({ afterRead: () => { stopped = true; } });
  await assert.rejects(f.create().createProvider(15_000, () => { if (stopped) throw Error('Runtime stopped during admission'); }));
  assert.equal(f.state.fetches.length, 0);
});

test('R10 production factory refuses noncanonical provider configuration and ambiguous IDs', async () => {
  for (const baseUrl of ['https://foreign.invalid', 'https://api.steel.dev/other', 'http://api.steel.dev']) {
    const f = fixture({ env: { STEEL_API_BASE_URL: baseUrl } });
    assert.throws(f.create, /viewer_provider_unavailable/);
    assert.equal(f.state.fetches.length, 0);
  }
  const f = fixture({ providerId: 'ambiguous-id' }), deps = f.create();
  await assert.rejects(deps.createProvider(15_000, () => {}));
  assert.equal(f.state.fetches.length, 1, 'An ambiguous create is never automatically retried');
  await assert.rejects(deps.releaseProvider('ambiguous-id'));
  assert.equal(f.state.fetches.length, 1);
});


test('R10 production diagnostics rebuild a strict field/code/numeric allowlist without secrets',()=>{
 const f=fixture(),deps=f.create(),safe={phase:'capture',reason:'failed',durationMs:1499,remainingMs:5000,capturedFrames:0,deliveredFrames:0};
 deps.diagnostic({...safe,message:'PRIVATE_CONTENT',stack:'secret',endpoint:'https://secret.invalid?apiKey=SECRET',providerSessionId:providerId,authSessionId:identity.authSessionId});
 assert.equal(f.state.diagnostics.length,1);assert.equal(f.state.diagnostics[0][0],'r10_viewer');assert.deepEqual(JSON.parse(JSON.stringify(f.state.diagnostics[0][1])),safe);
 for(const value of [{...safe,phase:'SECRET'}, {...safe,reason:'https://private.invalid'}, {...safe,durationMs:NaN}, {...safe,remainingMs:Infinity}, {...safe,capturedFrames:121}, {...safe,deliveredFrames:1}, new Error('SECRET')])deps.diagnostic(value);
 assert.equal(f.state.diagnostics.length,1);assert.doesNotMatch(JSON.stringify(f.state.diagnostics),/SECRET|PRIVATE|https|providerSession|authSession/);
});
