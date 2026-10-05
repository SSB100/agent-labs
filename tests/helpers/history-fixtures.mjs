import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
const require = createRequire(import.meta.url), ts = require('typescript');
function load(file, dependencies) {
  const output = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const fixtureModule = { exports: {} };
  runInNewContext(`(function(require,module,exports){${output}\n})`, { URL, URLSearchParams, Date })(name => { assert.ok(Object.hasOwn(dependencies, name), `Unexpected history fixture dependency: ${name}`); return dependencies[name]; }, fixtureModule, fixtureModule.exports);
  return fixtureModule.exports;
}
export const ownerBusiness = load('src/lib/core-ui/owner-business.ts', {});
export const historyQuery = load('src/lib/core-ui/history-query.ts', {});
export const historyRead = load('src/lib/core-ui/history-read.ts', { './history-query': historyQuery });
export const collectionReads = load('src/lib/core-ui/console-collections.ts', {
  'server-only': {}, './owner-business': ownerBusiness, './console-collections-query': load('src/lib/core-ui/console-collections-query.ts', {}),
});
export const historyPager = load('src/components/console/history-pager.tsx', {
  'react/jsx-runtime': require('react/jsx-runtime'),
  'next/link': ({ children, href }) => require('react').createElement('a', { href }, children),
  'next/navigation': { usePathname: () => '/dashboard', useSearchParams: () => new URLSearchParams() },
});
/** Wire envelope only: the actual production history reader validates it. */
export function historyResponse(args, records, { selected = null, total = records?.length, ownerTotal = total, overrides = {} } = {}) {
  if (!Array.isArray(records)) return { data: { items: records } };
  const { limit = 25, offset = 0 } = args.p_query ?? {};
  const exact = selected ?? records.find(row => row.id === args.p_query?.selectedId) ?? null;
  return { data: { items: records.slice(offset, offset + limit), total, ownerTotal, limit, offset,
    observedAt: '2026-10-03T08:00:00.000Z', hasNext: offset + limit < total,
    selection: { status: exact ? 'found' : args.p_query?.selectedId ? 'missing' : 'none', item: exact }, ...overrides } };
}
export function accountHistoryResponse(args, workspace) {
  if (args.p_dataset === 'account_state') return { data: { ...workspace, observedAt: '2026-10-03T08:00:00.000Z', currentRuns: workspace.currentRuns ?? workspace.runs } };
  const rows = args.p_dataset === 'account_health' ? workspace.healthEvents : args.p_dataset === 'account_unresolved' && Array.isArray(workspace.runs)
    ? workspace.runs.filter(row => ['pending_approval','approved','preparation_started','owner_handoff'].includes(row.status)) : workspace.runs;
  return historyResponse(args, rows);
}
