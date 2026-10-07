import { ownerBusiness, historyRead, historyPager, collectionReads } from './helpers/history-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { creativeCostTruthFixture } from './helpers/creative-cost-truth-fixtures.mjs';
import { retainedFixture as retainedUiFixture } from './helpers/guided-ui.mjs';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const costDisplay = require('../.core-tests/creative/cost-display.js');

// Exercise the real server loader/page with offline, strict dependency boundaries.
// No Supabase, model, browser, or other network adapter is loaded by these fixtures.
function loadSource(path, dependencies) {
  const compiled = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const fixtureModule = { exports: {} };
  runInNewContext(`(function(require, module, exports) { ${compiled}\n})`, { URLSearchParams, URL })(name => {
    if (name.endsWith('/owner-business')) return ownerBusiness;
    if (name === '../lib/core-ui/history-read') return historyRead;
    if (name === '../lib/core-ui/console-collections') return collectionReads;
    if (name === '@/components/console/history-pager') return historyPager;
    if (name === "@/lib/core-ui/console-retained-feedback") return loadSource("src/lib/core-ui/console-retained-feedback.ts",{});
    if (name === '@/components/console/console-retained-workspace') return retainedUiFixture();
    if (!(name in dependencies)) throw new Error(`Unexpected fixture dependency: ${name}`);
    return dependencies[name];
  }, fixtureModule, fixtureModule.exports);
  return fixtureModule.exports;
}
const { loadCreativeWorkspace } = loadSource('src/creative/data.ts', {
  './cost-display': costDisplay, './production-approval': {}, '../products/data': {},
});

function fixture({ failures = [], empty = false, settled = false, unknown = false } = {}) {
  const time = '2026-09-01T10:00:00.000Z';
  const approval = { id: 'approval-fixture', business_id: '96060000-0000-4000-8000-000000000001', candidate_id: 'candidate-fixture', purpose: 'technical_qualification',
    snapshot: { concept: 'Synthetic cost fixture', audience: 'Adult fixture audience' }, maximum_microusd: 1_000_000, approved_at: time, expires_at: '2026-09-08T10:00:00.000Z' };
  const run = { id: 'run-fixture', business_id: '96060000-0000-4000-8000-000000000001', approval_id: approval.id, workflow_run_id: 'workflow-fixture', created_at: time, capability_expires_at: '2000-01-01T00:00:00.000Z' };
  const rows = {
    creative_approvals: [approval], creative_runs: [run], creative_assets: [], creative_reviews: [], creative_phase_outputs: [],
    workflow_runs: [{ id: run.workflow_run_id, status: 'needs_owner', current_stage_key: 'brief:1', state: { productionReady: false } }],
    creative_cost_reservations: empty ? [] : [{ creative_run_id: run.id, call_key: 'brief:1', reserved_microusd: 90_000, created_at: time }],
    creative_cost_settlements: !settled || empty ? [] : [{ creative_run_id: run.id, call_key: 'brief:1', reported_microusd: unknown ? null : 20_000, provider_request_id: 'mock-receipt', created_at: time }],
  };
  const queries = [];
  const context = { businesses: [{ id: '96060000-0000-4000-8000-000000000001', name: 'Fixture Business' }], supabase: {
    from(table) {
      assert.ok(table in rows, `Unexpected table ${table}`);
      const query = { table, filters: [] }; queries.push(query);
      const chain = { select() { return this; }, in(column, values) { query.filters.push([column, values]); return this; },
        eq(column, value) { query.filters.push([column, value]); return this; }, or(value) { query.or = value; return this; }, range(from,to) { query.range = [from,to]; return this; }, order() { return this; }, limit() { return this; }, then(resolve, reject) {
          return Promise.resolve(failures.includes(table) ? { data: null, error: { message: `${table} unavailable` } } : { data: query.range ? rows[table].slice(query.range[0],query.range[1]+1) : rows[table], count: rows[table].length, error: null }).then(resolve, reject);
        } };
      return chain;
    },
    storage: { from() { throw new Error('No fixture assets require storage access'); } },
  } };
  return { context, queries, rows };
}

async function renderWorkspace(context, data, query = {}, scopes = []) {
  const passChildren = ({ children }) => React.createElement('div', null, children);
  const { default: Page } = loadSource('src/app/dashboard/artifacts/page.tsx', {
    '@/components/console/console-focused-run-controls':{ConsoleFocusedRunControls:()=>null},'@/components/console/console-focused-physical-fields':{ConsoleFocusedPhysicalFields:()=>null},
    'react/jsx-runtime': require('react/jsx-runtime'), 'node:crypto': require('node:crypto'),
    'next/navigation': { notFound: () => { throw new Error('not-found'); } },
    'next/link': ({ children, href }) => React.createElement('a', { href }, children),
    '@/components/stage7/app-shell': { AppShell: passChildren, PageHeader: () => null },
    '@/components/stage13/products-workspace': { ProductSubmitButton: ({ children, disabled }) => React.createElement('button', { disabled }, children) },
    '@/creative/data': { loadCreativeWorkspace: async scope => { scopes.push(scope.businesses.map(item => item.id)); return data; }, loadProductionCandidates: async scope => { scopes.push(scope.businesses.map(item => item.id)); return { candidates: [], errors: [] }; } },
    '@/creative/cost-display': costDisplay,
    '@/creative/image-provider': require('../.core-tests/creative/image-provider.js'),
    '@/creative/proposal': { FLUX_KLEIN_PROVIDER_TERMS: ['https://bfl.ai/legal/developer-terms-of-service', 'https://bfl.ai/legal/flux-api-service-terms'], CREATIVE_PROVIDER_TERMS: 'https://example.com/terms', TECHNICAL_PRINT_SPECIFICATION: { sourceUrl: 'https://example.com/spec', verifiedAt: '2026-09-01T10:00:00.000Z' } },
    '@/creative/types': { SCREEN_CATEGORIES: [] }, '@/lib/core-ui/data': { requireOwnerUiContext: async () => context },
    './actions': {}, './artifacts.css': {},
  });
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(query) }));
}

for (const failures of [['creative_cost_reservations'], ['creative_cost_settlements'], ['creative_cost_reservations', 'creative_cost_settlements'], ['creative_runs']]) {
  test(`failed cost read is visibly unavailable: ${failures.join(', ')}`, async () => {
    const { context } = fixture({ failures, settled: true });
    const data = await loadCreativeWorkspace(context);
    assert.equal(data.costsAvailable, false);
    assert.ok(data.errors.length);
    if (failures.length === 1 && failures[0] !== 'creative_runs') assert.equal(data.costs.length, 1, 'A successful side of the ledger is retained');
    const html = await renderWorkspace(context, data);
    assert.match(html, /Reported: Unavailable/);
    assert.match(html, /The cost ledger could not be fully loaded/);
    assert.doesNotMatch(html, /No calls recorded|Conservative budget committed:/);
    if (failures.includes('creative_runs')) {
      assert.match(html, /Run status unavailable/);
      assert.match(html, /<button disabled="">Start approved creative run<\/button>/);
      assert.doesNotMatch(html, /Approved · not started/);
    }
  });
}

test('loader and page retain the pending charge after an expired run', async () => {
  const { context, queries } = fixture();
  const data = await loadCreativeWorkspace(context);
  assert.equal(data.costsAvailable, true);
  assert.equal(data.runs[0].capabilityExpired, true);
  assert.equal(data.costs.length, 1);
  for (const table of ['creative_cost_reservations', 'creative_cost_settlements']) {
    const query = queries.find(q => q.table === table);
    assert.equal(JSON.stringify(query.filters), JSON.stringify([['creative_run_id', ['run-fixture']]]));
  }
  const html = await renderWorkspace(context, data);
  assert.match(html, /1 charge\(s\) remain unknown/);
  assert.match(html, /Receipt missing after run expiry; charge unknown; reservation retained/);
  assert.match(html, /Conservative budget committed: US\$0\.090000/);
  assert.doesNotMatch(html, /No calls recorded/);
});

test('known and unknown settlements render without double counting or erasing uncertainty', async () => {
  for (const unknown of [false, true]) {
    const { context } = fixture({ settled: true, unknown });
    const html = await renderWorkspace(context, await loadCreativeWorkspace(context));
    assert.match(html, /Conservative budget committed: US\$0\.090000/);
    assert.doesNotMatch(html, /US\$0\.110000/);
    if (unknown) assert.match(html, /Receipt has no reported cost; charge unknown; reservation retained/);
    else { assert.match(html, /Reported: US\$0\.020000/); assert.doesNotMatch(html, /charge\(s\) remain unknown/); }
  }
});

test('successful empty cost reads alone display no calls recorded', async () => {
  const { context } = fixture({ empty: true });
  const data = await loadCreativeWorkspace(context);
  assert.equal(data.costsAvailable, true);
  assert.equal(data.costs.length, 0);
  const html = await renderWorkspace(context, data);
  assert.match(html, /No calls recorded/);
  assert.doesNotMatch(html, /ledger could not be fully loaded|charge\(s\) remain unknown/);
});


test('derived PNG gallery distinguishes retained provider WebP and its immutable source hash', async () => {
  const { context } = fixture({ empty: true });
  const data = await loadCreativeWorkspace(context);
  data.assets = [{ id: 'asset-fixture', creative_run_id: 'run-fixture', business_id: '96060000-0000-4000-8000-000000000001', candidate_id: 'candidate-fixture',
    version: 1, brief_hash: 'a'.repeat(64), asset_hash: 'b'.repeat(64), storage_path: 'private-fixture/version-1.png',
    inspection: { width: 1024, height: 1024, effectiveDpi: 157.53, colorSpace: 'srgb', failedCriteria: [] },
    prompt: 'Synthetic original instruction fixture', provider: 'openrouter', model: 'recraft/recraft-v4.1-pro', generated_at: '2026-09-01T10:00:00Z',
    signedUrl: 'https://example.invalid/private-derived', sourceSignedUrl: 'https://example.invalid/private-original',
    provenance: { conversion: 'lossless_webp_to_png', detectedMediaType: 'image/webp', originalSha256: 'c'.repeat(64),
      version: 'creative-image-normalization-1.0', verification: 'decoded_pixels_equal', decoder: 'fixture-decoder', encoder: 'fixture-encoder' } }];
  const html = await renderWorkspace(context, data);
  assert.match(html, /Provider returned lossless WebP/);
  assert.match(html, /derived print\/review representation/);
  assert.match(html, /Original SHA-256/);
  assert.match(html, /c{64}/);
  assert.match(html, /b{64}/);
  assert.match(html, /Open original provider file/);
  assert.match(html, /Pixel equality does not claim/);
});


function retainedFixture() {
  const f = fixture({ settled: true });
  const businessId = '00000000-0000-4000-8000-000000000001', runId = '00000000-0000-4000-8000-000000000002';
  f.context.businesses[0].id = businessId; f.rows.creative_approvals[0].business_id = businessId;
  Object.assign(f.rows.creative_runs[0], { id: runId, business_id: businessId });
  for (const name of ['creative_cost_reservations', 'creative_cost_settlements']) Object.assign(f.rows[name][0], { creative_run_id: runId, call_key: 'generate:1' });
  const source = { storagePath: `${businessId}/${runId}/version-1.original.webp`, mediaType: 'image/webp', bytes: 2000, sha256: 'a'.repeat(64), uploadConfirmed: true, downloadVerified: true };
  f.rows.creative_cost_settlements[0].receipt = { outputValidated: false, sourcePreservation: source };
  const signed = [];
  f.context.supabase.storage = { from(bucket) { assert.equal(bucket, 'creative-assets'); return { async createSignedUrls(paths, expiry) {
    signed.push(...paths); assert.equal(expiry, 1200);
    return { error: null, data: paths.map(path => ({ path, signedUrl: 'https://example.invalid/private-unvalidated' })) };
  } }; } };
  return { ...f, source, signed };
}
test('owner sees retained paid source as explicitly unvalidated, separate from approved gallery', async () => {
  const f = retainedFixture(), data = await loadCreativeWorkspace(f.context);
  assert.deepEqual(f.signed, [f.source.storagePath]);
  assert.equal(data.assets.length, 0); assert.equal(data.retainedSources.length, 1);
  assert.equal(data.retainedSources[0].sha256, f.source.sha256);
  const html = await renderWorkspace(f.context, data);
  assert.match(html, /Unvalidated provider source retained after failure/);
  assert.match(html, /not a validated design or review PASS/);
  assert.match(html, /No validated images were returned in this loaded gallery window/);
  assert.match(html, /Open retained unvalidated source/);
  assert.doesNotMatch(html, /Nothing has been generated yet/);
});
test('retained source signing rejects forged owners, runs, paths and metadata', async () => {
  for (const alter of [
    f => { f.rows.creative_runs[0].business_id = '00000000-0000-4000-8000-000000000009'; },
    f => { f.source.storagePath = f.source.storagePath.replace('000000000002/', '000000000009/'); },
    f => { f.source.storagePath += '/extra'; },
    f => { f.source.storagePath = '../' + f.source.storagePath; },
    f => { f.source.storagePath = 'https://example.invalid/file'; },
    f => { f.source.mediaType = 'image/png'; },
    f => { f.source.sha256 = 'not-a-hash'; },
    f => { f.source.bytes = 7_000_001; },
    f => { f.source.uploadConfirmed = false; },
    f => { f.rows.creative_cost_settlements[0].receipt.outputValidated = true; },
    f => { delete f.rows.creative_cost_settlements[0].receipt.outputValidated; },
    f => { f.rows.creative_cost_settlements[0].call_key = 'generate:2'; },
  ]) {
    const f = retainedFixture(); alter(f); const data = await loadCreativeWorkspace(f.context);
    assert.equal(data.retainedSources.length, 0);
    assert.equal(f.signed.length, 0);
    assert.equal(data.costs.length >= 1, true, 'Rejecting source metadata must not erase charged history');
  }
});

test('Library business filter keeps reads in the selected owner Business and rejects foreign context', async () => {
 const { context } = fixture(); const data = await loadCreativeWorkspace(context); const selected = context.businesses[0];
 const scope = { ...context, businesses: [...context.businesses, { id: 'other-owned-business', name: 'Other owned Business' }] };
 const seen = []; const html = await renderWorkspace(scope, data, { business: selected.id }, seen);
 assert.deepEqual(JSON.parse(JSON.stringify(seen)), [[selected.id], [selected.id]]); assert.match(html, /View all businesses/);
 const rejected = []; await assert.rejects(renderWorkspace(scope, data, { business: 'foreign-business' }, rejected), /not-found/); assert.deepEqual(rejected, []);
});


test('legacy receipt history qualifies exact three-call costs without relabelling the saved generation amount', async () => {
  const f = fixture({ settled: true });
  const analogue = creativeCostTruthFixture({ creativeRunId: f.rows.creative_runs[0].id, businessId: f.context.businesses[0].id });
  f.rows.creative_cost_reservations = analogue.reservations;
  f.rows.creative_cost_settlements = analogue.settlements;
  const rawBefore = structuredClone(f.rows), data = await loadCreativeWorkspace(f.context);
  const html = await renderWorkspace(f.context, data);
  assert.match(html, /Reported: US\$0\.010280/);
  assert.match(html, /1 charge\(s\) remain unknown · US\$0\.210000 reserved/);
  assert.match(html, /Conservative budget committed: US\$0\.339552/);
  assert.match(html, /Unverified saved amount: US\$0\.210000 · excluded from reported charges/);
  assert.match(html, /reservation or saved amount, not both; unverified saved amounts are retained conservatively/);
  assert.doesNotMatch(html, /Reported: US\$0\.220280|Reported provider charge · US\$0\.210000/);
  assert.equal(data.costs.find(row => row.call_key === 'generate:1').reported_microusd, 210000);
  assert.deepEqual(f.rows, rawBefore);
});

test('legacy direct-record summaries never turn unlinked saved zero or positive amounts into reported charges', async () => {
  const { context } = fixture({ settled: true }), data = await loadCreativeWorkspace(context);
  for (const provider_request_id of [null, '', '   ']) for (const reported_microusd of [0, 210000]) {
    const raw = { ...data.costs[0], provider_request_id, reported_microusd };
    const html = await renderWorkspace(context, { ...data, costs: [raw] });
    assert.match(html, /Reported: No charge reported; charge unknown/);
    assert.match(html, /1 charge\(s\) remain unknown/);
    assert.match(html, /Unverified saved amount: US\$/);
    assert.doesNotMatch(html, /Reported provider charge/);
    assert.equal(raw.reported_microusd, reported_microusd);
  }
});
test('immutable pre-inspection image receipt does not duplicate the later validated asset as a failure',async()=>{
 const f=retainedFixture();f.rows.creative_assets.push({id:'asset',business_id:f.context.businesses[0].id,creative_run_id:f.rows.creative_runs[0].id,version:1,storage_path:f.source.storagePath});
 const data=await loadCreativeWorkspace(f.context);assert.equal(data.assets.length,1);assert.equal(data.retainedSources.length,0);assert.equal(data.costs.length,1);
});
