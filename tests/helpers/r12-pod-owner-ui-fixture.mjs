// Inert owner-journey fixtures. No browser, network, provider call, credentials,
// database authority, production mutation, or real market evidence is involved.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const sourceRoot = fileURLToPath(new URL('../../src/', import.meta.url));
export const id = n => `12130000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const OBJECTIVE = 'Research viable print-on-demand products to sell on Etsy.';
export const PHASES = ['plan', 'search1', 'select1', 'strategy', 'review'];
const Link = ({ children, ...props }) => React.createElement('a', props, children);
export function source(file, dependencies = {}, globals = {}, cache = new Map()) {
  let filename = resolve(sourceRoot, file);
  if (!/\.[cm]?[jt]sx?$/.test(filename)) filename += existsSync(filename + '.ts') ? '.ts' : '.tsx';
  assert.ok(filename.startsWith(sourceRoot.endsWith(sep) ? sourceRoot : sourceRoot + sep));
  if (cache.has(filename)) return cache.get(filename).exports;
  const mod = { exports: {} };
  cache.set(filename, mod);
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  new Function('require', 'module', 'exports', ...Object.keys(globals), code)(name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name === 'server-only' || name.endsWith('.css')) return {};
    if (name === 'next/link') return Link;
    if (name.startsWith('node:') || ['react', 'react/jsx-runtime'].includes(name)) return require(name);
    if (name.startsWith('.')) return source(resolve(dirname(filename), name), dependencies, globals, cache);
    if (name.startsWith('@/')) return source(name.slice(2), dependencies, globals, cache);
    throw Error(`Unstubbed external boundary: ${name}`);
  }, mod, mod.exports, ...Object.values(globals));
  return mod.exports;
}
const hash = source('products/discovery-v2-hash').discoveryV2Hash;
export function fixture() {
  const now = Date.now();
  const sourcePolicy = {
    version: 'r12.pod-source-policy.1', reviewId: id(9), method: 'openrouter_exa_factual_snippets', purpose: 'public_pod_market_research',
    excludedDomains: ['etsy.com', 'etsy.me', 'etsystatic.com'], restrictionsRevision: '1'.repeat(64), termsReviewHash: '2'.repeat(64), independentReviewHash: '3'.repeat(64),
    recipients: { router: 'openrouter.ai', search: 'exa.ai', researcher: 'azure/us', reviewer: 'amazon-bedrock/us' },
    retention: { inference: 'no_training_zdr', search: 'query_retention_improvement_training_possible', application: 'bounded_attributed_audit_evidence' },
    validFrom: new Date(now - 60000).toISOString(), validUntil: new Date(now + 86400000).toISOString(),
  };
  const publicBrief = { objective: OBJECTIVE, publicConstraints: [], fulfilmentContext: 'unspecified' };
  const finance = { authorityRootId: id(1), capRevision: 1, maximumMicrounits: '300000', committedMicrounits: '100000', hasUnknown: false, pendingMicrounits: '0', proposedBusinessLimitMicrounits: '600000', runLimitMicrounits: '1000000' };
  const quote = { version: 'inert-ui-quote', maximumMicrousd: 500000, verifiedAt: new Date(now - 1000).toISOString(), validUntil: new Date(now + 300000).toISOString(), ceilings: Object.fromEntries(PHASES.map(p => [p, 100000])), luna: { endpoint: 'azure/us' }, reviewer: { endpoint: 'amazon-bedrock/us' } };
  const preview = { version: 'r12.pod-research-preview.1', businessId: id(1), goalId: id(2), goalRevision: 2, goalHash: 'a'.repeat(64), businessRevision: 1, businessHash: 'b'.repeat(64), publicBrief, templateId: id(3), templateHash: 'c'.repeat(64), sourcePolicy, sourcePolicyHash: hash(sourcePolicy), finance, quote, maximumCalls: 5, maximumCollections: 1, maximumRepairs: 0, dispatchMinutes: 30, receiptMinutes: 30, maximumReceiptChecks: 15, authorityCreated: false };
  const receipt = { version: 'r12.pod-setup-receipt.1', businessId: id(1), goalId: id(2), setupId: id(4), scopeId: id(5), setupHash: hash(preview), policyId: id(6), policyHash: 'd'.repeat(64), submissionId: id(7), confirmed: false, activated: false, stopped: false, preview };
  const catalog = { version: 'r12.pod-catalog.1', businessId: id(1), business: { revision: 1, hash: preview.businessHash, ready: true }, goal: null, finance, template: { id: id(3), hash: preview.templateHash, sourcePolicy, sourcePolicyHash: preview.sourcePolicyHash, validUntil: sourcePolicy.validUntil }, setups: [] };
  const entry = { businessId: id(1), publicBrief: structuredClone(publicBrief), maximumMicrounits: '1000000', deadlineAt: new Date(now + 3600000).toISOString(), submissionId: receipt.submissionId };
  return { now, receipt, catalog, entry, quote };
}
export const elements = (tree, predicate) => !tree || typeof tree !== 'object' ? [] : [
  ...(predicate(tree) ? [tree] : []),
  ...React.Children.toArray(tree.props?.children).flatMap(child => elements(child, predicate)),
];
export const text = tree => tree === null || tree === undefined || typeof tree === 'boolean' ? '' : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : React.Children.toArray(tree.props?.children).map(text).join('');
export function button(tree, label) {
  const value = elements(tree, e => e.type === 'button' && text(e) === label)[0];
  assert.ok(value, `Expected button: ${label}`);
  return value;
}
export const html = renderToStaticMarkup;
export const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

export function workspace(f = fixture(), { selected = null, status = null, result = null, actions = {}, storage = new Map() } = {}) {
  let stateIndex = 0, refIndex = 0, effectIndex = 0, sequence = 100, pending = false;
  const states = [], refs = [], effects = [], jobs = [], calls = [], navigation = [], listeners = new Map(), intervals = new Map();
  const hooks = {
    ...React,
    useState(initial) { const i = stateIndex++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
    useRef(initial) { const i = refIndex++; return refs[i] ??= { current: initial }; },
    useId: () => ':inert-pod-owner:',
    useMemo: fn => fn(), useCallback: fn => fn,
    useTransition() { return [pending, callback => { pending = true; const job = Promise.resolve().then(callback).finally(() => { pending = false; }); jobs.push(job); }]; },
    useEffect(fn, deps) { const i = effectIndex++, old = effects[i]; if (!old || !deps || deps.some((value, index) => !Object.is(value, old.deps?.[index]))) effects[i] = { fn, deps, dirty: true, cleanup: old?.cleanup }; },
  };
  const actionModule = Object.fromEntries(['preparePodResearchAction', 'confirmPodResearchAction', 'resumePodResearchAction', 'stopPodResearchAction'].map(name => [name, async input => {
    calls.push({ name, input: structuredClone(input) });
    if (actions[name]) return actions[name](input);
    return { ok: true, runtimeStarted: true, receipt: { ...f.receipt, confirmed: name === 'confirmPodResearchAction', activated: name === 'confirmPodResearchAction', stopped: name === 'stopPodResearchAction' } };
  }]));
  const router = { push: href => navigation.push(['push', href]), replace: href => navigation.push(['replace', href]), refresh: () => navigation.push(['refresh']) };
  const sessionStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  const window = { sessionStorage, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const setInterval = callback => { const key = intervals.size + 1; intervals.set(key, callback); return key; }, clearInterval = key => intervals.delete(key);
  Object.assign(window, { setInterval, clearInterval });
  const view = source('components/quests/pod-research-workspace.tsx', { react: hooks, 'next/navigation': { useRouter: () => router }, '@/app/dashboard/quests/research/pod/actions': actionModule }, {
    crypto: { subtle: webcrypto.subtle, randomUUID: () => id(++sequence) }, window, setInterval, clearInterval,
    FormData: class { constructor(fields) { this.fields = fields; } get(key) { return this.fields[key] ?? null; } },
  });
  const props = { catalog: f.catalog, selected, status, result };
  function render(changes = {}) { Object.assign(props, changes); stateIndex = 0; refIndex = 0; effectIndex = 0; const tree = view.PodResearchWorkspace(props); for (const effect of effects) if (effect.dirty) { effect.cleanup?.(); effect.cleanup = effect.fn(); effect.dirty = false; } return tree; }
  return { render, calls, navigation, states, storage, intervals,
    async settle() { while (jobs.length) await Promise.all(jobs.splice(0)); },
    event: name => listeners.get(name)?.(),
    submit(fields = {}) { const form = elements(render(), e => e.type === 'form')[0]; assert.ok(form); form.props.onSubmit({ preventDefault() {}, currentTarget: { objective: OBJECTIVE, budget: '1.00', ...fields } }); },
    unmount() { for (const effect of effects) effect.cleanup?.(); },
  };
}

export function actionHarness(f = fixture(), { server = {}, start = async () => ({ runId: 'inert-workflow' }) } = {}) {
  const calls = [], context = { userId: id(90) }, workflow = Object.freeze({ inert: 'pod-runtime-boundary' });
  const implementation = Object.fromEntries(['preparePodResearch', 'confirmPodResearch', 'readPodResearch', 'stopPodResearch'].map(name => [name, async (...args) => {
    calls.push({ name, args });
    assert.equal(args[0], context);
    if (server[name]) return server[name](...args);
    if (name === 'readPodResearch') return { ...f.catalog, setups: [{ ...f.receipt, confirmed: true, activated: true }] };
    return { ...f.receipt, confirmed: name === 'confirmPodResearch', activated: name === 'confirmPodResearch', stopped: name === 'stopPodResearch' };
  }]));
  const actions = source('app/dashboard/quests/research/pod/actions.ts', {
    'workflow/api': { start: async (...args) => { calls.push({ name: 'start', args }); assert.equal(args[0], workflow); return start(...args); } },
    '@/lib/core-ui/data': { requireOwnerUiContext: async () => { calls.push({ name: 'auth' }); return context; } },
    '@/products/discovery-r12-pod-owner-server': implementation,
    '@/workflows/pod-research-runtime': { podResearchRuntimeWorkflow: workflow },
  });
  return { actions, calls, context };
}

export function serverHarness(f = fixture(), { rpc, quote } = {}) {
  const calls = [], context = { userId: id(90), businesses: [{ id: f.catalog.businessId, name: 'Inert Business' }], supabase: {
    auth: { getClaims: async () => ({ data: { claims: { sub: id(90) } }, error: null }) },
    rpc: async (name, args) => { calls.push({ name, args: structuredClone(args) }); return rpc(name, args); },
  } };
  const unexpected = () => { throw Error('This owner preparation test must not establish runtime authority or dispatch.'); };
  const server = source('products/discovery-r12-pod-owner-server.ts', {
    './discovery-r12-pod-server-key': { podApplicationCapability: () => 'inert-unit-test-capability-not-a-live-credential' },
    './discovery-r12-server-dependencies': { discoveryR12ServerDependencies: () => ({ quote: async () => { calls.push({ name: 'quote' }); return quote ? quote() : structuredClone(f.quote); } }) },
    './discovery-r12-server': { prepareDiscoveryR12Authority: unexpected },
    './discovery-r12-pod-runtime': { buildPodPlannerRequest: unexpected, readPodResearchPhaseInputs: unexpected, reconstructPodResearchResult: unexpected },
    './discovery-r12-wire': { inspectDiscoveryR12Wire: unexpected, routeDiscoveryR12Request: unexpected },
  });
  return { server, calls, context };
}

export function releaseRouteHarness({ owner = id(90), claimsError = null, business = { id: id(1) }, businessError = null, env = {} } = {}) {
  const calls = [], fixtureEnv = { VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40), VERCEL_DEPLOYMENT_ID: 'dpl_inert_owner_metadata', R05_ADMISSION_SERVER_KEY: 'inert-unit-test-existing-root-not-a-live-secret', ...env };
  const globals = { process: { env: fixtureEnv } }, modules = new Map();
  const pure = file => source(file, {}, globals, modules);
  const capability = pure('products/discovery-r12-pod-server-key'), release = pure('products/discovery-r12-pod-release');
  const runtime = pure('products/discovery-r12-pod-runtime'), packs = pure('products/discovery-r12-pod-packs');
  const query = {
    select: fields => { calls.push(['select', fields]); return query; },
    eq: (field, value) => { calls.push(['eq', field, value]); return query; },
    maybeSingle: async () => { calls.push(['maybeSingle']); return { data: business, error: businessError }; },
  };
  const client = {
    auth: { getClaims: async () => { calls.push(['getClaims']); return { data: { claims: { sub: owner } }, error: claimsError }; } },
    from: table => { calls.push(['from', table]); assert.equal(table, 'businesses'); return query; },
  };
  const route = source('app/api/research/pod/release/route.ts', {
    'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
    '@/lib/supabase/server': { createClient: async () => { calls.push(['createClient']); return client; } },
    '@/products/discovery-r12-pod-server-key': { podApplicationCapability: () => { calls.push(['capability']); return capability.podApplicationCapability(); } },
    '@/products/discovery-r12-pod-release': { podExecutingRelease: () => { calls.push(['release']); return release.podExecutingRelease(); } },
    '@/products/discovery-r12-pod-runtime': { podResearchSchemaPins: () => { calls.push(['schemas']); return runtime.podResearchSchemaPins(); } },
    '@/products/discovery-r12-pod-packs': { podResearchPackManifests: () => { calls.push(['packs']); return packs.podResearchPackManifests(); } },
  }, globals);
  return { calls, fixtureEnv,
    get: (businessId = id(1)) => route.GET(new Request(`https://agent-labs.example.invalid/api/research/pod/release${businessId === null ? '' : `?business=${encodeURIComponent(businessId)}`}`)),
    expectedSchemas: () => runtime.podResearchSchemaPins(),
    expectedPacks: () => packs.podResearchPackManifests().map(p => ({ packKey: p.packKey, version: p.version, manifestHash: hash(p) })),
  };
}
