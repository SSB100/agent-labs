import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { seed, together, fixture as metadataWire, id } from './console-research-data-fixtures.mjs';
import { make, id as evidenceId } from './console-research-evidence-fixtures.mjs';
const require = createRequire(import.meta.url), ts = require('typescript');
const producer = make();
export const businessId = producer.f.scope.businessId, secondBusinessId = evidenceId(2), selectedId = producer.f.experiment.id;
export { id };
export const origin = 'https://agentlabs-research-root.test';
const plain = value => JSON.parse(JSON.stringify(value));
export function researchTables() {
  const seeded = together(seed(127, businessId), seed(127, secondBusinessId, 10000)), saved = structuredClone(producer.db);
  for (let index = 0; index < seeded.product_experiments.length; index++) seeded.product_experiments[index].created_at = new Date(Date.UTC(2024, 0, 1 + index % 127)).toISOString();
  const prototype = seeded.product_experiments[0], workflow = seeded.workflow_runs[0], definition = seeded.workflow_definitions[0];
  saved.product_experiments = saved.product_experiments.map(row => ({ ...prototype, ...row, created_at: '2023-01-01T00:00:00Z', started_at: '2023-01-01T00:00:00Z', basis_artifact_id: null, variables: { ...row.variables, budgetAuthorityRootId: row.id, semanticGoalHash: 'a'.repeat(64) } }));
  saved.workflow_runs = saved.workflow_runs.map(row => ({ ...workflow, ...row }));
  saved.workflow_definitions = saved.workflow_definitions.map(row => ({ ...definition, ...row }));
  return Object.fromEntries(Object.keys(saved).map(table => [table, [...(seeded[table] ?? []), ...saved[table]]]));
}
function find(tree, name) {
  for (const element of Array.isArray(tree) ? tree : [tree]) if (React.isValidElement(element)) {
    if (element.type?.name === name) return element;
    const child = find(element.props.children, name); if (child) return child;
  }
  return null;
}
export function queryFromRoute(route) { const params = new URL(route, origin).searchParams; return Object.fromEntries([...new Set(params.keys())].map(key => [key, params.getAll(key).length > 1 ? params.getAll(key) : params.get(key)])); }
/** Actual owner route, metadata readers and evidence adapter. The public-table fixture
 * denies every mutation, provider, auth, signing, RPC, credential and network path.
 * Static fallback/resolved rendering does not emulate Next's RSC/cache transport. */
export function rootResearchFixture({ tables = researchTables(), readOptions = {}, businessesUnavailable = false, ownedBusinesses } = {}) {
  const wire = metadataWire(tables, readOptions), cache = new Map(), calls = [], ancillaryCalls = [], denied = wire.forbidden;
  const deny = (...args) => { denied.push(args.map(value => typeof value === 'string' ? value : 'non-text')); throw Error('Read-only Research fixture denies external effects'); };
  const context = { ...wire.context, userId: id(10), businesses: ownedBusinesses ?? [businessId, secondBusinessId].map((id, index) => ({ id, name: `Synthetic Business ${index + 1}`, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z' })), businessesUnavailable, email: 'synthetic-owner@example.invalid', displayName: 'Synthetic Owner', needsYouCount: 3, needsYouUnavailable: false };
  const notFound = () => { const error = Error('Fixture not found'); error.code = 'FIXTURE_NOT_FOUND'; throw error; };
  const redirect = href => { const error = Error('Fixture redirect'); error.code = 'FIXTURE_REDIRECT'; error.href = href; throw error; };
  const deniedModule = new Proxy({}, { get: (_target, key) => key === '__esModule' ? true : deny });
  let routeForHooks = '/dashboard';
  const overrides = {
    '@/lib/core-ui/data': { requireOwnerUiContext: async () => { calls.push({ name: 'ownerGuard' }); return context; }, loadWorkflowCollection: deny },
    '@/accounts/server': { loadAccountSetupInterventions: async () => ({ records: [], unavailable: false }) },
    '@/connections/server': { readConnectionQualification: async () => { throw Error('Unexpected connection qualification read'); } },
    '@/lib/core-ui/console-data': { loadConsoleObservationTime: async () => Date.parse('2026-10-02T03:00:00Z'), loadConsoleResearchQuote: async ctx => { ancillaryCalls.push({ name: 'quote', businesses: ctx.businesses.map(row => row.id) }); return { one: 100, two: 200, verifiedAt: '2026-10-02T03:00:00Z' }; } },
    '@/products/discovery-v2-data': { loadDiscoveryGoalData: async ctx => { ancillaryCalls.push({ name: 'catalogue', businesses: ctx.businesses.map(row => row.id) }); return { available: true, records: [], errors: [] }; } },
    '@/components/stage7/live-refresh': { LiveRefresh: () => null },
    'next/navigation': { usePathname: () => new URL(routeForHooks, 'https://fixture.invalid').pathname, useSearchParams: () => new URL(routeForHooks, 'https://fixture.invalid').searchParams, notFound, redirect, useRouter: () => ({ push: deny, replace: deny, refresh: deny }) },
    'server-only': {},
  };
  const inert = new Set(['./legacy-dashboard', '@/components/console/console-populated-dashboard', '@/components/console/console-library-dashboard', '@/components/console/console-compact-decisions', '@/lib/core-ui/console-decisions-data', '@/components/console/console-overview', '@/components/console/console-motion', './accounts/account-workspace', '@/components/stage13/products-workspace', '@/components/stage13/discovery-goal-workspace']);
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const fixtureModule = { exports: {} }; cache.set(file, fixtureModule.exports);
    const source = ts.transpileModule(readFileSync(file, 'utf8'), { fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    runInNewContext(`(function(require,module,exports){${source}\n})`, { Date, URL, URLSearchParams, Event, Buffer, structuredClone, crypto: require('node:crypto'), process: { env: { AGENTLABS_GUIDED_UI: 'guided', NODE_ENV: 'test' } } })(name => {
      if (['react','react/jsx-runtime','react-dom','node:crypto','node:util'].includes(name)) return require(name);
      if (name === 'next/link') return function Link({ children, ...props }) { delete props.prefetch; return React.createElement('a', props, children); };
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (name.endsWith('.css')) return {};
      if (inert.has(name) || /(?:\/actions$|\/discovery-actions$|\/terminal-review-actions$|\/browser-actions$|workflow\/api|supabase|openrouter|provider)/.test(name) || ['@/products/data','@/creative/data','@/browser/console-server','@/lib/core-ui/run-outcome-data'].includes(name)) return deniedModule;
      let target = name.startsWith('@/') ? `src/${name.slice(2)}` : name.startsWith('.') ? path.join(path.dirname(file), name) : null;
      assert.ok(target, `Forbidden Research dependency ${name}`);
      target = [target,`${target}.ts`,`${target}.tsx`].find(candidate => existsSync(candidate) && /\.tsx?$/.test(candidate)); assert.ok(target, `Unresolved Research dependency ${name}`);
      return load(target);
    }, fixtureModule, fixtureModule.exports);
    for (const name of ['loadConsoleResearchPage','loadConsoleResearchRecordsPage','loadConsoleResearchEvidence']) if (typeof fixtureModule.exports[name] === 'function') {
      const actual = fixtureModule.exports[name]; fixtureModule.exports[name] = async (...args) => { const call = { name, arguments: plain(args.slice(1)) }; calls.push(call); const value = await actual(...args); call.result = value; return value; };
    }
    cache.set(file, fixtureModule.exports); return fixtureModule.exports;
  }
  async function render(route = '/dashboard?view=research', { evidence = false } = {}) {
    routeForHooks = route;
    const Page = load('src/app/dashboard/page.tsx').default; let canonicalRoute = route, redirectedFrom = null, tree;
    try { tree = await Page({ searchParams: Promise.resolve(queryFromRoute(route)) }); } catch (error) {
      if (error.code !== 'FIXTURE_REDIRECT') throw error; redirectedFrom = route; canonicalRoute = error.href;
      tree = await Page({ searchParams: Promise.resolve(queryFromRoute(canonicalRoute)) });
    }
    assert.equal(tree.type.name, 'ConsoleResearchDashboard'); tree = await tree.type(tree.props);
    const pane = find(tree, 'ConsoleResearchPane'), sheet = find(tree, 'ConsoleResearchSheet'); assert.ok(pane);
    const boundary = pane.props.evidenceContent;
    let content = boundary?.props.fallback, exact = null;
    if (evidence && boundary) { const leaf = boundary.props.children; exact = await leaf.type(leaf.props); content = React.cloneElement(boundary, {}, exact); }
    const renderedPane = React.cloneElement(pane, { evidenceContent: content });
    const rendered = React.cloneElement(tree, {}, React.Children.map(tree.props.children, child => child === pane ? renderedPane : child));
    return { tree, pane, sheet, canonicalRoute, redirectedFrom, data: pane.props.data, command: tree.props.commandBar.props, exact, markup: renderToStaticMarkup(rendered) };
  }
  return { context, load, render, tables, calls, ancillaryCalls, denied, reads: wire.calls };
}
