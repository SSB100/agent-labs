import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { renderToString } from 'react-dom/server';
const require = createRequire(import.meta.url), ts = require('typescript');
export const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
export const time = '2026-10-02T04:10:20.123456+00:00';
export const owner = id(900), businessId = id(1), secondBusinessId = id(2);
export const businesses = [businessId, secondBusinessId].map(id => ({ id, name: 'Same long studio name '.repeat(10), created_at: time, updated_at: time }));
export function load(file, dependencies = {}) {
  const output = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} };
  runInNewContext(`(function(require,module,exports){${output}\n})`, { URL, URLSearchParams, Date, structuredClone })(name => {
    if (['react', 'react/jsx-runtime', 'react-dom', 'node:crypto'].includes(name)) return require(name);
    if (name === 'next/link') return function Link({ children, ...props }) { delete props.prefetch; return React.createElement('a', props, children); };
    assert.ok(Object.hasOwn(dependencies, name), `Forbidden dependency in Decisions fixture: ${name}`); return dependencies[name];
  }, loaded, loaded.exports);
  return loaded.exports;
}
export const query = load('src/lib/core-ui/console-decisions-query.ts');
export const workflows = load('src/lib/core-ui/workflows.ts');
export const outcome = load('src/lib/core-ui/run-outcome.ts', { './workflows': workflows });
export const costLoader = load('src/lib/core-ui/run-outcome-data.ts', { './run-outcome': outcome });
export const terminal = load('src/creative/terminal-review.ts');
export const api = load('src/lib/core-ui/console-decisions-data.ts', { 'server-only': {}, './run-outcome-data': costLoader, './console-decisions-query': query, '../../creative/terminal-review': terminal });
export const model = load('src/lib/core-ui/console-decisions-view.ts', { './workflows': workflows, './run-outcome': outcome });
export const submit = load('src/components/console/console-decision-submit.tsx');
export const filters = load('src/components/console/console-decision-filters.tsx', { '@/lib/core-ui/console-decisions-query': query });
export const component = load('src/components/console/console-compact-decisions.tsx', { '@/lib/core-ui/workflows': workflows, '@/lib/core-ui/console-decisions-query': query, '@/lib/core-ui/console-decisions-view': model, './console-decision-submit': submit, './console-decision-filters': filters, './console-compact-decisions.css': {} });
export const definition = { id: id(50), workflow_key: 'etsy.creative-pipeline', version: '1.0.0', name: 'Creative pipeline with the same repeated name '.repeat(5), description: '', status: 'active', stage_definition: {} };
const deterministic = input => { const h = createHash('md5').update(input).digest('hex'); return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`; };
export function fixtureTables({ amountCase = 'encoding', count = 3 } = {}) {
  const tables = { owner_interventions: [], workflow_runs: [], workflow_definitions: [definition], workflow_stage_runs: [], artifacts: [], creative_runs: [], creative_approvals: [], creative_cost_reservations: [], creative_cost_settlements: [], worker_runs: [], task_contracts: [], action_intents: [], model_invocations: [] };
  for (let index = 0; index < count; index++) {
    const workflowRunId = id(1000 + index), creativeRunId = id(2000 + index), approvalId = id(3000 + index), interventionId = deterministic(`creative:needs-owner:${creativeRunId}`);
    const kind = count === 1 ? amountCase : ['encoding', 'png', 'brief'][index % 3];
    const reason = kind === 'encoding' ? 'The provider image contains unsupported animation, encoding, or metadata.' : kind === 'png' ? 'The provider must return exactly one PNG image.' : 'Brief schema validation failed; no output was saved.';
    const date = new Date(Date.UTC(2026, 9, 1, 0, 0, index)).toISOString();
    tables.owner_interventions.push({ id: interventionId, action_intent_id: null, business_id: businessId, workflow_run_id: workflowRunId, intervention_type: 'creative_review', status: 'open', title: 'Creative pipeline needs your review', description: reason, options: {}, resolution: {}, requested_at: date, resolved_at: null, created_at: date, updated_at: time });
    tables.workflow_runs.push({ id: workflowRunId, business_id: businessId, workflow_definition_id: definition.id, status: 'needs_owner', current_stage_key: kind === 'brief' ? 'brief:1' : 'generate:1', input: { creativeRunId, approvalId }, state: { productionReady: false, publicationAllowed: false }, started_at: date, completed_at: time, created_at: date, updated_at: time, runtime_provider: 'fixture', runtime_run_id: null });
    tables.workflow_stage_runs.push({ id: id(4000 + index), workflow_run_id: workflowRunId, stage_key: kind === 'brief' ? 'brief:1' : 'generate:1', sequence: 1, attempt: 1, status: 'failed', failure: { reason, rawProviderResponse: 'PRIVATE_PROVIDER_PAYLOAD_MUST_NOT_RENDER' }, started_at: date, completed_at: time, created_at: date, updated_at: time });
    tables.creative_runs.push({ id: creativeRunId, business_id: businessId, workflow_run_id: workflowRunId, approval_id: approvalId });
    tables.creative_approvals.push({ id: approvalId, business_id: businessId, purpose: 'technical_qualification', maximum_microusd: 500000, snapshot: { concept: `Saved concept ${index + 1}: original nocturnal garden illustration ` + 'long duplicate concept '.repeat(8) } });
    const costs = kind === 'encoding' ? [.01, .01, .2] : kind === 'png' ? [.005, .005, null] : [.002];
    costs.forEach((amount, call) => {
      const call_key = ['brief:1', 'screen:1', 'generate:1'][call];
      tables.creative_cost_reservations.push({ business_id: businessId, creative_run_id: creativeRunId, call_key, reserved_microusd: 250000 });
      if (amount !== null) tables.creative_cost_settlements.push({ business_id: businessId, creative_run_id: creativeRunId, call_key, reported_microusd: Math.round(amount * 1000000), provider_request_id: `fixture-receipt-${index}-${call}`, receipt: kind === 'encoding' && call === 2 ? { outputValidated: false, sourcePreservation: { uploadConfirmed: true, mediaType: 'image/png', bytes: 1200, sha256: 'a'.repeat(64), storagePath: `${businessId}/${creativeRunId}/version-1.png`, downloadVerified: true } } : {} });
    });
    if (kind !== 'brief') tables.artifacts.push({ id: id(5000 + index), business_id: businessId, workflow_run_id: workflowRunId, artifact_type: 'creative.brief', name: 'Saved creative brief', created_at: date });
  }
  return tables;
}
export function wire(tables = fixtureTables(), options = {}) {
  const calls = [];
  const supabase = { from(table) {
    assert.ok(Object.hasOwn(tables, table), `Forbidden table: ${table}`);
    const call = { table, filters: [], orders: [] }; calls.push(call);
    const q = {
      select(columns, options) { call.columns = columns; call.options = options; return q; },
      eq(key, value) { call.filters.push(['eq', key, value]); return q; }, in(key, value) { call.filters.push(['in', key, value]); return q; },
      order(key, { ascending }) { call.orders.push([key, ascending]); return q; }, range(from, to) { call.range = [from, to]; return q; }, limit(max) { call.limit = max; return q; },
      then(resolve, reject) {
        if (options.throwTable === table) return Promise.reject(Error('Read unavailable')).then(resolve, reject);
        let rows = [...tables[table]];
        if (!options.ignoreFilters?.includes(table)) rows = rows.filter(row => call.filters.every(([op, key, value]) => op === 'eq' ? row[key] === value : value.includes(row[key])));
        rows.sort((a, b) => { for (const [key, asc] of call.orders) { const order = String(a[key] ?? '').localeCompare(String(b[key] ?? '')); if (order) return asc ? order : -order; } return 0; });
        const count = Object.hasOwn(options.counts ?? {}, table) ? options.counts[table] : rows.length;
        if (call.range) rows = rows.slice(call.range[0], call.range[1] + 1);
        if (call.limit) rows = rows.slice(0, call.limit);
        if (options.cap?.[table]) rows = rows.slice(0, options.cap[table]);
        return Promise.resolve({ data: options.failTable === table ? null : rows, count, error: options.failTable === table ? { message: 'PRIVATE_DATABASE_FAILURE' } : null }).then(resolve, reject);
      },
    };
    return q;
  }, rpc() { throw Error('Mutation denied'); }, storage: { from() { throw Error('Storage/provider network denied'); } } };
  return { tables, calls, context: { userId: owner, supabase, businesses, email: 'synthetic@example.invalid', displayName: 'Synthetic owner', needsYouCount: tables.owner_interventions.length } };
}
export const origin = 'https://decisions-fixture.invalid';
export async function rendered(route = '/dashboard?view=decisions', options = {}) {
  const params = Object.fromEntries(new URL(route, origin).searchParams), h = wire(options.tables ?? fixtureTables(), options);
  if (options.businesses) h.context.businesses = options.businesses;
  const data = await api.loadConsoleDecisionPage(h.context, query.consoleDecisionOptionsFromSearch(params));
  const props = { data, businesses, businessId: params.business, ...options.props };
  return { h, data, props, html: renderToString(React.createElement(component.ConsoleCompactDecisions, props)) };
}
