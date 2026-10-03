import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { findFixtureElement } from './guided-ui.mjs';

const require = createRequire(import.meta.url), ts = require('typescript');
export const origin = 'https://agentlabs-collection-root.test';
export const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
export const owner = id(900), businessId = id(1), secondBusinessId = id(2);
export const time = '2026-10-02T04:10:20.123Z';
export const businesses = [businessId, secondBusinessId].map(id => ({ id, name: 'Duplicate North Star Design Studio '.repeat(6), created_at: time, updated_at: time }));
const date = index => new Date(Date.UTC(2026, 0, 1 + Math.floor(index / 2))).toISOString();
export const oldRunId = id(1001), oldActiveRunId = id(1000), oldEventId = id(10001), exactArtifactId = id(40000);
export const artifactContent = { exact: 'Old exact saved artifact, outside the 100-row metadata window', document: 'Long evidence with literal 100%_\\ content. '.repeat(180), nested: { sourceOnly: true, successfulOutput: false, note: '<script>must remain escaped</script>' } };
export const artifactHash = createHash('sha256').update(JSON.stringify(artifactContent, null, 2)).digest('hex');
export function fixtureTables({ perBusiness = 127 } = {}) {
  const tables = { businesses: structuredClone(businesses), workflow_runs: [], workflow_definitions: [], events: [], workflow_stage_runs: [], task_contracts: [], worker_runs: [], worker_definitions: [], owner_interventions: [], artifacts: [], model_invocations: [], product_experiments: [] };
  tables.workflow_definitions.push({ id: id(50), workflow_key: 'fixture.read-only', version: '1.0.0', name: 'Duplicate saved workflow name '.repeat(7) + 'verylongunbrokenname'.repeat(9), description: '', status: 'qualified', stage_definition: {} },
    { id: id(51), workflow_key: 'fixture.literal-search', version: '1.0.0', name: 'Literal 100%_\\ saved workflow', description: '', status: 'qualified', stage_definition: {} });
  for (let business = 0; business < 2; business++) for (let index = 0; index < perBusiness; index++) {
    const runId = id(1000 + business * 1000 + index), business_id = businesses[business].id;
    const status = index === 1 ? 'needs_owner' : ['running','completed','failed','needs_owner','cancelled','queued','waiting','review','future_unsupported_state'][index % 9];
    tables.workflow_runs.push({ id: runId, business_id, workflow_definition_id: id(index === 7 ? 51 : 50), status, current_stage_key: 'saved_evidence', input: { fixture: true }, state: {}, runtime_provider: 'fixture', runtime_run_id: null, started_at: date(index), completed_at: index === 1 || ['completed','failed','cancelled'].includes(status) ? date(index + 1) : null, created_at: date(index), updated_at: date(index + 2) });
    tables.events.push({ id: id(10000 + business * 1000 + index), business_id, workflow_run_id: runId, event_type: index === 7 ? 'workflow.literal_100%_\\.recorded' : `workflow.${status}.recorded_${'long_event_name'.repeat(6)}`, actor_type: 'system', actor_id: null, payload: { exact: index, privateSearchTerm: 'payload-only-search-term', evidence: 'Long audit content '.repeat(50) }, occurred_at: date(index), created_at: date(index) });
  }
  tables.worker_definitions.push({ id: id(60), worker_key: 'fixture.saved', version: '1.0.0', name: 'Saved read-only worker', role: 'research', status: 'qualified' });
  for (let index = 0; index < 133; index++) {
    const base = { business_id: businessId, workflow_run_id: oldRunId, created_at: date(index), updated_at: date(index) };
    tables.workflow_stage_runs.push({ id: id(20000 + index), workflow_run_id: oldRunId, stage_key: `saved-stage-${index}`, sequence: index, attempt: 1, status: 'failed', started_at: date(index), completed_at: date(index), created_at: date(index), updated_at: date(index), failure: { mustNotPreload: 'PRIVATE_STAGE_PAYLOAD' } });
    tables.task_contracts.push({ ...base, id: id(21000 + index), workflow_stage_run_id: id(20000 + index), worker_definition_id: id(60), status: 'failed', objective: `Saved task ${index} ` + 'long original objective '.repeat(8), input: { mustNotPreload: 'PRIVATE_TASK_PAYLOAD' } });
    tables.worker_runs.push({ ...base, id: id(22000 + index), task_contract_id: id(21000 + index), worker_definition_id: id(60), status: 'failed', started_at: date(index), completed_at: date(index), output: { mustNotPreload: 'PRIVATE_WORKER_PAYLOAD' } });
    tables.owner_interventions.push({ ...base, id: id(23000 + index), intervention_type: 'fixture_review', status: 'open', title: `Saved notice ${index}`, description: 'Opening this notice authorizes no execution.', requested_at: date(index), resolved_at: null, resolution: { mustNotPreload: 'PRIVATE_NOTICE_PAYLOAD' } });
    tables.artifacts.push({ ...base, id: id(40000 + index), task_contract_id: null, artifact_type: 'fixture.saved.source', name: `Saved artifact ${index} ` + 'verylongunbrokenname'.repeat(5), media_type: 'application/json', storage_path: null, metadata: { provenance: 'Synthetic saved source, not successful output' }, content: index === 0 ? structuredClone(artifactContent) : { mustNotPreload: `PRIVATE_ARTIFACT_PAYLOAD_${index}` } });
  }
  for (const [index, amount] of [.01, 0, null].entries()) tables.model_invocations.push({ id: id(50000 + index), business_id: businessId, workflow_run_id: oldRunId, reported_cost_usd: amount, provider_request_id: `fixture-receipt-${index}` });
  return tables;
}
const plain = value => JSON.parse(JSON.stringify(value));
export function queryFromRoute(route) { const values = new URL(route, origin).searchParams; return Object.fromEntries([...new Set(values.keys())].map(key => [key, values.getAll(key).length > 1 ? values.getAll(key) : values.get(key)])); }
export const selectedWorkRoute = `/dashboard?view=work&business=${businessId}&run=${oldRunId}`;
export const selectedArtifactRoute = `${selectedWorkRoute}&artifact=${exactArtifactId}#artifact-${exactArtifactId}`;
export const selectedActivityRoute = `/dashboard?view=activity&business=${businessId}&selected=${oldEventId}`;
function literalPattern(pattern) { assert.ok(pattern.startsWith('%') && pattern.endsWith('%')); return pattern.slice(1, -1).replace(/\\([\\%_])/g, '$1').toLowerCase(); }
/** Owner-session data only. This is the public-table transport boundary, not a mocked reader. */
export function collectionWire(tables, options = {}) {
  const reads = [], denied = [];
  const deny = (...args) => { denied.push(args); throw Error('Read-only fixture denies RPC, mutations, storage, auth and network'); };
  const client = new Proxy({ from(table) {
    assert.ok(Object.hasOwn(tables, table), `Unregistered fixture table: ${table}`);
    const read = { table, filters: [], order: [] }; reads.push(read);
    const builder = {
      select(columns, spec = {}) { assert.notEqual(columns, '*', 'Unbounded column projection is forbidden'); read.columns = columns; read.options = spec; return this; },
      eq(column, value) { read.filters.push(['eq', column, value]); return this; },
      in(column, values) { read.filters.push(['in', column, [...values]]); return this; },
      is(column, value) { read.filters.push(['is', column, value]); return this; },
      not(column, operator, value) { assert.equal(operator, 'is'); read.filters.push(['not', column, value]); return this; },
      ilike(column, value) { read.filters.push(['ilike', column, value]); return this; },
      order(column, spec) { read.order.push([column, spec.ascending]); return this; },
      range(from, to) { read.range = [from, to]; return this; },
      limit(value) { read.limit = value; return this; },
      then(resolve, reject) {
        return Promise.resolve().then(async () => {
          if (options.delay) await options.delay(read);
          if (options.throw?.(read)) throw Error('PRIVATE_TRANSPORT_ERROR');
          if (options.error?.(read)) return { data: null, error: { message: 'PRIVATE_DATABASE_ERROR' }, count: null };
          let rows = tables[table].map(row => ({ ...row }));
          if (read.columns?.includes('definition:workflow_definitions!inner(name)')) rows = rows.map(row => ({ ...row, definition: { name: tables.workflow_definitions.find(def => def.id === row.workflow_definition_id)?.name } }));
          rows = rows.filter(row => read.filters.every(([operator, column, value]) => { const actual = column.split('.').reduce((item, key) => item?.[key], row); return operator === 'not' ? actual !== value : operator === 'in' ? value.includes(actual) : operator === 'ilike' ? typeof actual === 'string' && actual.toLowerCase().includes(literalPattern(value)) : actual === value; }));
          const count = rows.length;
          rows.sort((left, right) => { for (const [column, ascending] of read.order) { const comparison = String(left[column] ?? '').localeCompare(String(right[column] ?? '')); if (comparison) return comparison * (ascending ? 1 : -1); } return 0; });
          if (read.range) rows = rows.slice(read.range[0], read.range[1] + 1); else if (read.limit !== undefined) rows = rows.slice(0, read.limit);
          if (options.cap?.(read) !== undefined) rows = rows.slice(0, options.cap(read));
          const columns = read.columns?.split(/,(?![^()]*\))/) ?? [];
          rows = rows.map(row => Object.fromEntries(columns.map(column => column.includes(':') ? [column.split(':')[0], row[column.split(':')[0]]] : [column, row[column]]).filter(([, value]) => value !== undefined)));
          if (options.inject) rows = options.inject(read, rows);
          read.returned = rows.length; read.count = options.nullCount?.(read) ? null : count;
          return { data: rows, count: read.count, error: null };
        }).then(resolve, reject);
      },
    };
    return new Proxy(builder, { get(target, name) { if (name in target) return target[name]; return deny; } });
  } }, { get(target, name) { return name in target ? target[name] : deny; } });
  return { client, reads, denied, deny };
}

/** Strict source loader: actual root, component, collection, detail and cost code.
 * No credential-bearing module is imported and no production network API exists in its VM. */
export function rootCollectionFixture({ tables = fixtureTables(), readOptions = {}, ownedBusinesses = businesses, businessesUnavailable = false } = {}) {
  const wire = collectionWire(tables, readOptions), loaderCalls = [], ancillaryCalls = [], cache = new Map();
  const context = { userId: owner, email: 'owner@example.invalid', displayName: 'Fixture Owner', businesses: ownedBusinesses, businessesUnavailable, needsYouCount: 133, needsYouUnavailable: false, supabase: wire.client };
  const deniedModule = new Proxy({}, { get: (_target, key) => key === '__esModule' ? true : wire.deny });
  const notFound = () => { const error = Error('Fixture record was not found'); error.code = 'FIXTURE_NOT_FOUND'; throw error; };
  let routeForHooks = '/dashboard';
  const overrides = {
    '@/lib/core-ui/data': { requireOwnerUiContext: async () => context, loadWorkflowCollection: wire.deny, loadWorkflowDetail: wire.deny },
    '@/lib/core-ui/console-data': { loadConsoleObservationTime: async () => Date.parse(time), loadConsoleResearchQuote: async ctx => { ancillaryCalls.push({ name: 'researchQuote', businesses: ctx.businesses.map(row => row.id) }); return { one: 370395, two: 530914, verifiedAt: time }; } },
    '@/accounts/server': { loadAccountSetupInterventions: async () => ({ records: [], unavailable: false }) },
    '@/products/discovery-v2-data': { loadDiscoveryGoalData: async ctx => { ancillaryCalls.push({ name: 'researchCatalog', businesses: ctx.businesses.map(row => row.id) }); return { available: true, analysisAvailable: true, records: [], errors: [] }; } },
    '@/components/stage7/live-refresh': { LiveRefresh: () => null },
    'next/navigation': { usePathname: () => new URL(routeForHooks, 'https://fixture.invalid').pathname, useSearchParams: () => new URL(routeForHooks, 'https://fixture.invalid').searchParams, notFound, useRouter: () => ({ push: wire.deny, replace: wire.deny, refresh: wire.deny }) },
    'server-only': {},
  };
  const forbidden = /(?:^@\/(?:accounts|creative|products|browser)\/(?:server|data|console-server)$|\/actions$|\/discovery-actions$|\/terminal-review-actions$|\/browser-actions$|legacy-dashboard$|workflow\/api|supabase|openrouter|provider)/;
  const inert = new Set(['@/components/guided/creative-library', '@/components/console/console-work-pane', '@/components/stage13/discovery-goal-workspace', './accounts/account-workspace', '@/lib/core-ui/console-decisions-data', '@/components/console/console-compact-decisions', '@/components/console/console-library-dashboard']);
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {}, fixtureModule = { exports }; cache.set(file, exports);
    const source = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    runInNewContext(`(function(require,module,exports){${source}\n})`, { Date, URL, URLSearchParams, Buffer, structuredClone, crypto: require('node:crypto'), process: { env: { AGENTLABS_GUIDED_UI: 'guided', NODE_ENV: 'test' } } })(name => {
      if (['react', 'react/jsx-runtime', 'react-dom', 'node:crypto'].includes(name)) return require(name);
      if (name === 'next/link') return function Link({ children, ...props }) { delete props.prefetch; return React.createElement('a', props, children); };
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (name.endsWith('.css')) return {};
      if (forbidden.test(name) || inert.has(name)) return deniedModule;
      let target = name.startsWith('@/') ? `src/${name.slice(2)}` : name.startsWith('.') ? path.join(path.dirname(file), name) : null;
      assert.ok(target, `Forbidden dependency ${name} in ${file}`);
      target = [target, `${target}.ts`, `${target}.tsx`].find(candidate => existsSync(candidate) && /\.tsx?$/.test(candidate));
      assert.ok(target, `Unresolved safe fixture source ${name} in ${file}`);
      target = target.replaceAll('\\', '/');
      assert.ok(target === 'src/core/quest-intake.ts' || /^src\/(lib\/core-ui|components\/(console|guided|stage7)|browser\/console-view|app\/dashboard\/console-populated-dashboard)/.test(target), `Non-read-only fixture dependency ${target}`);
      return load(target);
    }, fixtureModule, exports);
    const tracked = ['loadConsoleWorkPage', 'loadConsoleActivityPage', 'loadConsoleWorkDetail', 'loadRunCostData'];
    for (const key of tracked) if (typeof fixtureModule.exports[key] === 'function') {
      const actual = fixtureModule.exports[key]; fixtureModule.exports[key] = async (...args) => { const call = { name: key, arguments: plain(args.slice(1)) }; loaderCalls.push(call); const value = await actual(...args); call.result = value; return value; };
    }
    cache.set(file, fixtureModule.exports); return fixtureModule.exports;
  }
  async function render(route = '/dashboard?view=work') {
    routeForHooks = route;
    const page = load('src/app/dashboard/page.tsx');
    let tree = await page.default({ searchParams: Promise.resolve(queryFromRoute(route)) });
    // The server root may delegate through an async server component.
    if (React.isValidElement(tree) && tree.type?.name === 'ConsolePopulatedDashboard') tree = await tree.type(tree.props);
    const pane = findFixtureElement(tree, 'ConsoleWorkCollectionPane') ?? findFixtureElement(tree, 'ConsoleActivityCollectionPane');
    assert.ok(pane, 'Actual DashboardPage must return the bounded collection branch');
    const detail = findFixtureElement(tree, 'ConsoleWorkDetail'), boundary = findFixtureElement(tree, 'ConsoleMotionBoundary'), sheet = findFixtureElement(tree, 'ConsoleResearchSheet');
    return { tree, pane, detail, boundary, sheet, data: pane.props.data, props: pane.props, detailData: detail?.props.detail ?? null, markup: renderToString(tree) };
  }
  return { render, load, context, tables, reads: wire.reads, denied: wire.denied, loaderCalls, ancillaryCalls };
}
