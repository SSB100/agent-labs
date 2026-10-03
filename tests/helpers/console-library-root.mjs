import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { findFixtureElement } from './guided-ui.mjs';
import { business, other, id, stamp, seed, together, fixture as libraryWire } from './console-library-data-fixtures.mjs';

const require = createRequire(import.meta.url), ts = require('typescript');
export const origin = 'https://agentlabs-library-root.test';
export const businessId = business, secondBusinessId = other, owner = id(10);
export { id };
export const oldAssetId = id(1000), oldCreativeRunId = id(2000), oldWorkflowId = id(4000), oldImageArtifactId = id(6000);
export const exactRecordId = id(90000), noAssetRunId = id(22000), noAssetWorkflowId = id(24000);
export const exactContent = { synthetic: true, title: 'Exact old saved source outside the first 125 rows', schemaVersion: 'source-v3', success: false, literal: '100%_\\ <script>must stay escaped</script>', evidence: 'Synthetic exact saved evidence, not successful live output. '.repeat(240), nested: { sourceOnly: true } };
export const exactContentHash = createHash('sha256').update(JSON.stringify(exactContent, null, 2)).digest('hex');
export const selectedDesignRoute = `/dashboard?view=library&type=designs&business=${businessId}&selected=${oldAssetId}`;
export const selectedRecordRoute = `/dashboard?view=library&type=records&business=${businessId}&selected=${exactRecordId}`;
export const selectedRunRoute = `/dashboard?view=library&type=designs&business=${businessId}&creativeRun=${noAssetRunId}`;
export const exactWorkHref = `/dashboard?view=work&business=${businessId}&selected=${oldWorkflowId}&artifact=${oldImageArtifactId}#artifact-${oldImageArtifactId}`;
const plain = value => JSON.parse(JSON.stringify(value));
export function fixtureTables({ perBusiness = 127 } = {}) {
  const db = together(seed(perBusiness, businessId), seed(perBusiness, secondBusinessId, 10000));
  for (const rows of Object.values(db)) for (let index = 0; index < rows.length; index++) {
    const row = rows[index], time = new Date(Date.UTC(2026, 4, 1 + index % perBusiness)).toISOString();
    for (const key of ['generated_at', 'created_at', 'updated_at', 'approved_at', 'started_at', 'completed_at']) if (row[key] !== undefined && row[key] !== null) row[key] = time;
    if (Object.hasOwn(row, 'prompt')) row.prompt = 'Synthetic duplicate woodland artwork '.repeat(12) + 'verylongunbrokenoriginalartworktitle'.repeat(8);
    if (Object.hasOwn(row, 'name')) row.name = 'Synthetic duplicate saved record '.repeat(12) + 'verylongunbrokenrecordname'.repeat(8);
  }
  for (const row of db.creative_assets.filter(row => [id(1007),id(11007)].includes(row.id))) row.prompt = 'Synthetic literal 100%_\\ saved prompt';
  for (const row of db.artifacts.filter(row => [id(6007),id(16007)].includes(row.id))) row.name = 'Synthetic literal 100%_\\ saved record';
  db.artifacts.push({ ...db.artifacts[0], id: exactRecordId, name: 'Synthetic exact saved source '.repeat(14), artifact_type: 'research.sources', media_type: 'application/json', storage_path: 'opaque/saved/reference-is-not-a-download', content: structuredClone(exactContent), metadata: { synthetic: true, origin: 'read-only regression fixture' }, checksum: exactContentHash, created_at: '2025-01-01T00:00:00.000Z', updated_at: stamp });
  // An exact failed paid history has no image or asset; inspecting it never invents one.
  const failed = seed(1, businessId, 20000);
  failed.creative_assets = []; failed.creative_reviews = []; failed.artifacts = []; failed.creative_phase_outputs = [];
  failed.workflow_runs[0].status = 'failed';
  failed.creative_cost_reservations.push({ ...failed.creative_cost_reservations[0], call_key: 'generate:2', reserved_microusd: 1700 });
  failed.creative_cost_settlements.push({ ...failed.creative_cost_settlements[0], call_key: 'generate:2', reported_microusd: null, provider_request_id: null, receipt: { synthetic: true, unavailable: true } });
  return together(db, failed);
}
/** Separate historical-cost regression; default fixtures and geometry stay unchanged. */
export function fixtureTablesWithUnverifiedProviderCharge({ creativeRunId = noAssetRunId, ...options } = {}) {
  const tables = fixtureTables(options);
  const reservation = tables.creative_cost_reservations.find(row => row.creative_run_id === creativeRunId);
  const settlement = tables.creative_cost_settlements.find(row => row.creative_run_id === creativeRunId);
  assert.ok(reservation && settlement, 'Synthetic cost regression requires an existing exact run');
  const calls = [
    { call_key: 'brief:1', reserved_microusd: 30051, reported_microusd: 1979, provider_request_id: 'synthetic-cost-truth-brief-1' },
    { call_key: 'screen:1', reserved_microusd: 99501, reported_microusd: 8301, provider_request_id: 'synthetic-cost-truth-screen-1' },
    { call_key: 'generate:1', reserved_microusd: 210000, reported_microusd: 210000, provider_request_id: null },
  ];
  tables.creative_cost_reservations = tables.creative_cost_reservations.filter(row => row.creative_run_id !== creativeRunId);
  tables.creative_cost_settlements = tables.creative_cost_settlements.filter(row => row.creative_run_id !== creativeRunId);
  for (const call of calls) {
    tables.creative_cost_reservations.push({ ...reservation, call_key: call.call_key, reserved_microusd: call.reserved_microusd, estimate: { synthetic: true, estimatedMicrousd: call.reserved_microusd } });
    tables.creative_cost_settlements.push({ ...settlement, call_key: call.call_key, reported_microusd: call.reported_microusd, provider_request_id: call.provider_request_id, receipt: { synthetic: true, reportedCostUsd: call.reported_microusd / 1e6, estimatedMicrousd: call.reserved_microusd } });
  }
  return tables;
}
export function queryFromRoute(route) {
  const params = new URL(route, origin).searchParams;
  return Object.fromEntries([...new Set(params.keys())].map(key => [key, params.getAll(key).length > 1 ? params.getAll(key) : params.get(key)]));
}
/** Actual owner-root and readers, with a bounded inert Supabase public-table transport.
 * All rows, receipts, owner identity and signed preview URLs are synthetic. No live client,
 * RPC, provider, credential, mutation, image download or outside network is available. */
export function rootLibraryFixture({ tables = fixtureTables(), readOptions = {}, ownedBusinesses, businessesUnavailable = false } = {}) {
  const wire = libraryWire(tables, readOptions), cache = new Map(), loaderCalls = [], ancillaryCalls = [];
  const denied = wire.forbidden;
  const deny = (...args) => { denied.push(args.map(value => typeof value === 'string' ? value : 'non-text')); throw Error('Read-only Library fixture denies actions, provider, credentials and outside network'); };
  const context = { ...wire.context, email: 'synthetic-owner@example.invalid', displayName: 'Synthetic Owner', businesses: ownedBusinesses ?? wire.context.businesses, businessesUnavailable, needsYouCount: 3, needsYouUnavailable: false };
  const deniedModule = new Proxy({}, { get: (_target, name) => name === '__esModule' ? true : deny });
  const notFound = () => { const error = Error('Synthetic fixture route not found'); error.code = 'FIXTURE_NOT_FOUND'; throw error; };
  const overrides = {
    '@/lib/core-ui/data': { requireOwnerUiContext: async () => context, loadWorkflowCollection: deny, loadWorkflowDetail: deny },
    '@/lib/core-ui/console-data': { loadConsoleObservationTime: async () => Date.parse(stamp), loadConsoleResearchQuote: async ctx => { ancillaryCalls.push({ name: 'researchQuote', businesses: ctx.businesses.map(row => row.id) }); return { one: 370395, two: 530914, verifiedAt: stamp }; } },
    '@/accounts/server': { loadAccountSetupInterventions: async () => ({ records: [], unavailable: false }) },
    '@/products/discovery-v2-data': { loadDiscoveryGoalData: async ctx => { ancillaryCalls.push({ name: 'researchCatalog', businesses: ctx.businesses.map(row => row.id) }); return { available: true, analysisAvailable: true, records: [], errors: [] }; } },
    '@/components/stage7/live-refresh': { LiveRefresh: () => null },
    'next/navigation': { notFound, useRouter: () => ({ push: deny, replace: deny, refresh: deny }) },
    'server-only': {},
  };
  const forbidden = /(?:^@\/(?:accounts|creative|products|browser)\/(?:server|data|console-server)$|\/actions$|\/discovery-actions$|\/terminal-review-actions$|\/browser-actions$|legacy-dashboard$|workflow\/api|supabase|openrouter|provider)/;
  const inert = new Set(['@/components/guided/creative-library', '@/components/console/console-work-pane', '@/components/stage13/discovery-goal-workspace', './accounts/account-workspace', '@/lib/core-ui/console-decisions-data', '@/components/console/console-compact-decisions']);
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {}, fixtureModule = { exports }; cache.set(file, exports);
    const source = ts.transpileModule(readFileSync(file, 'utf8'), { fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    runInNewContext(`(function(require,module,exports){${source}\n})`, { Date, URL, URLSearchParams, Buffer, structuredClone, crypto: require('node:crypto'), process: { env: { AGENTLABS_GUIDED_UI: 'guided', NODE_ENV: 'test' } } })(name => {
      if (['react', 'react/jsx-runtime', 'react-dom', 'node:crypto'].includes(name)) return require(name);
      if (name === 'next/link') return function Link({ children, ...props }) { delete props.prefetch; return React.createElement('a', props, children); };
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (name.endsWith('.css')) return {};
      if (forbidden.test(name) || inert.has(name)) return deniedModule;
      let target = name.startsWith('@/') ? `src/${name.slice(2)}` : name.startsWith('.') ? path.join(path.dirname(file), name) : null;
      assert.ok(target, `Forbidden Library dependency ${name} in ${file}`);
      target = [target, `${target}.ts`, `${target}.tsx`].find(candidate => existsSync(candidate) && /\.tsx?$/.test(candidate));
      assert.ok(target, `Unresolved Library fixture source ${name} in ${file}`);
      target = target.replaceAll('\\', '/');
      assert.ok(target === 'src/core/quest-intake.ts' || /^src\/(lib\/core-ui|components\/(console|guided|stage7)|browser\/console-view|creative\/(cost-display|types)|app\/dashboard\/console-populated-dashboard)/.test(target), `Non-read-only Library dependency ${target}`);
      return load(target);
    }, fixtureModule, exports);
    for (const name of ['loadConsoleLibraryPage', 'loadConsoleLibraryRecordsPage', 'loadConsoleLibraryRunDetail']) if (typeof fixtureModule.exports[name] === 'function') {
      const actual = fixtureModule.exports[name]; fixtureModule.exports[name] = async (...args) => { const call = { name, arguments: plain(args.slice(1)) }; loaderCalls.push(call); const result = await actual(...args); call.result = result; return result; };
    }
    cache.set(file, fixtureModule.exports); return fixtureModule.exports;
  }
  async function render(route = '/dashboard?view=library') {
    let tree = await load('src/app/dashboard/page.tsx').default({ searchParams: Promise.resolve(queryFromRoute(route)) });
    if (React.isValidElement(tree) && tree.type?.name === 'ConsoleLibraryDashboard') tree = await tree.type(tree.props);
    const pane = findFixtureElement(tree, 'ConsoleLibraryPane');
    assert.ok(pane, 'Actual DashboardPage must return its bounded Library root');
    const sheet = findFixtureElement(tree, 'ConsoleResearchSheet');
    return { tree, pane, sheet, data: pane.props.data, props: pane.props, markup: renderToString(tree) };
  }
  return { render, load, context, tables, reads: wire.calls, signs: wire.signs, denied, loaderCalls, ancillaryCalls };
}
