import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
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
  runInNewContext(`(function(require, module, exports) { ${compiled}\n})`)(name => {
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
  const approval = { id: 'approval-fixture', business_id: 'business-fixture', candidate_id: 'candidate-fixture', purpose: 'technical_qualification',
    snapshot: { concept: 'Synthetic cost fixture', audience: 'Adult fixture audience' }, maximum_microusd: 1_000_000, approved_at: time, expires_at: '2026-09-08T10:00:00.000Z' };
  const run = { id: 'run-fixture', business_id: 'business-fixture', approval_id: approval.id, workflow_run_id: 'workflow-fixture', created_at: time, capability_expires_at: '2000-01-01T00:00:00.000Z' };
  const rows = {
    creative_approvals: [approval], creative_runs: [run], creative_assets: [], creative_reviews: [],
    workflow_runs: [{ id: run.workflow_run_id, status: 'needs_owner', current_stage_key: 'brief:1', state: { productionReady: false } }],
    creative_cost_reservations: empty ? [] : [{ creative_run_id: run.id, call_key: 'brief:1', reserved_microusd: 90_000, created_at: time }],
    creative_cost_settlements: !settled || empty ? [] : [{ creative_run_id: run.id, call_key: 'brief:1', reported_microusd: unknown ? null : 20_000, provider_request_id: 'mock-receipt', created_at: time }],
  };
  const queries = [];
  const context = { businesses: [{ id: 'business-fixture', name: 'Fixture Business' }], supabase: {
    from(table) {
      assert.ok(table in rows, `Unexpected table ${table}`);
      const query = { table, filters: [] }; queries.push(query);
      const chain = { select() { return this; }, in(column, values) { query.filters.push([column, values]); return this; },
        order() { return this; }, limit() { return this; }, then(resolve, reject) {
          return Promise.resolve(failures.includes(table) ? { data: null, error: { message: `${table} unavailable` } } : { data: rows[table], error: null }).then(resolve, reject);
        } };
      return chain;
    },
    storage: { from() { throw new Error('No fixture assets require storage access'); } },
  } };
  return { context, queries };
}

async function renderWorkspace(context, data) {
  const passChildren = ({ children }) => React.createElement('div', null, children);
  const { default: Page } = loadSource('src/app/dashboard/artifacts/page.tsx', {
    'react/jsx-runtime': require('react/jsx-runtime'), 'node:crypto': require('node:crypto'),
    'next/link': ({ children, href }) => React.createElement('a', { href }, children),
    '@/components/stage7/app-shell': { AppShell: passChildren, PageHeader: () => null },
    '@/components/stage13/products-workspace': { ProductSubmitButton: ({ children, disabled }) => React.createElement('button', { disabled }, children) },
    '@/creative/data': { loadCreativeWorkspace: async () => data, loadProductionCandidates: async () => ({ candidates: [], errors: [] }) },
    '@/creative/cost-display': costDisplay,
    '@/creative/proposal': { CREATIVE_PROVIDER_TERMS: 'https://example.com/terms', TECHNICAL_PRINT_SPECIFICATION: { sourceUrl: 'https://example.com/spec', verifiedAt: '2026-09-01T10:00:00.000Z' } },
    '@/creative/types': { SCREEN_CATEGORIES: [] }, '@/lib/core-ui/data': { requireOwnerUiContext: async () => context },
    './actions': {}, './artifacts.css': {},
  });
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
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
