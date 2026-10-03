import { ownerBusiness, historyQuery } from './helpers/history-fixtures.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), ts = require('typescript');
function load(path, dependencies = {}) {
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Forbidden runtime dependency: ${name}`); return dependencies[name];
  }, loaded, loaded.exports);
  return loaded.exports;
}
const query = load('src/lib/core-ui/console-collections-query.ts');
const collections = load('src/lib/core-ui/console-collections.ts', { 'server-only': {}, './owner-business': ownerBusiness, './console-collections-query': query });
const workflows = load('src/lib/core-ui/workflows.ts');
const outcome = load('src/lib/core-ui/run-outcome.ts', { './workflows': workflows });
const costs = load('src/lib/core-ui/run-outcome-data.ts', { './run-outcome': outcome });
const { loadConsoleWorkDetail } = load('src/lib/core-ui/console-work-detail-data.ts', { 'server-only': {}, './history-query': historyQuery, './console-collections-query': query, './console-collections': collections, './run-outcome-data': costs });
const id = n => `92000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const business = id(1), other = id(2), defId = id(3), runId = id(4), otherRunId = id(5), workerId = id(6), stamp = '2026-10-02T00:00:00.000Z';
const run = { id: runId, business_id: business, workflow_definition_id: defId, status: 'running', current_stage_key: 'old.active', input: {}, state: {}, runtime_provider: null, runtime_run_id: null, started_at: stamp, completed_at: null, created_at: stamp, updated_at: stamp };
const definition = { id: defId, workflow_key: 'fixture.workflow', version: '1', name: 'Duplicate long name '.repeat(35), status: 'active', description: '', stage_definition: {} };
function rows(size, sameBusiness = business, sameRun = runId, offset = 0) {
  const common = n => ({ id: id(offset + n), business_id: sameBusiness, workflow_run_id: sameRun, status: 'completed', created_at: stamp, updated_at: stamp });
  return {
    workflow_stage_runs: Array.from({ length: size }, (_, n) => ({ ...common(1000 + n), stage_key: `stage.${n}`, sequence: n, attempt: 1, input: { shouldNotRead: true }, output: { shouldNotRead: true }, started_at: stamp, completed_at: stamp })),
    task_contracts: Array.from({ length: size }, (_, n) => ({ ...common(2000 + n), workflow_stage_run_id: id(offset + 1000 + n), worker_definition_id: workerId, objective: `Task ${n}`, completion_criteria: { shouldNotRead: true } })),
    worker_runs: Array.from({ length: size }, (_, n) => ({ ...common(3000 + n), task_contract_id: id(offset + 2000 + n), worker_definition_id: workerId, output: { shouldNotRead: true }, started_at: stamp, completed_at: stamp })),
    owner_interventions: Array.from({ length: size }, (_, n) => ({ ...common(4000 + n), intervention_type: 'fixture', title: `Decision ${n}`, description: '', requested_at: stamp, resolved_at: stamp, resolution: { shouldNotRead: true } })),
    artifacts: Array.from({ length: size }, (_, n) => ({ ...common(5000 + n), task_contract_id: id(offset + 2000 + n), artifact_type: 'fixture.output', name: `Output ${n}`, media_type: 'application/json', storage_path: null, content: { exact: id(offset + 5000 + n), large: 'PAYLOAD '.repeat(100) }, metadata: { label: 'metadata' } })),
  };
}
function fixture(tables = {}, options = {}) {
  const calls = [], db = { workflow_runs: [run, { ...run, id: otherRunId, business_id: other }], workflow_definitions: [definition], worker_definitions: [{ id: workerId, worker_key: 'fixture', version: '1', name: 'Saved worker', role: 'fixture', status: 'active' }], ...tables };
  const context = { businesses: [business, other].map(id => ({ id, name: definition.name, created_at: stamp, updated_at: stamp })), userId: id(7), supabase: { from(table) {
    const call = { table, filters: [], orders: [] }; calls.push(call);
    const q = {
      select(columns, config) { call.columns = columns; call.config = config; if(table !== 'businesses')assert.equal(config?.count, 'exact'); assert.ok(!columns.includes('*')); return q; },
      maybeSingle() { assert.equal(table, 'businesses'); assert.deepEqual(call.filters, [['eq','id',id(999)],['eq','owner_user_id',context.userId]]); return Promise.resolve({data:null,error:null}); },
      range(from,to) { call.range=[from,to]; return q; },
      eq(key, value) { call.filters.push(['eq', key, value]); return q; }, in(key, value) { call.filters.push(['in', key, value]); return q; },
      order(key, config) { call.orders.push([key, config.ascending]); return q; }, limit(n) { call.limit = n; return q; },
      then(resolve, reject) {
        if (options.throwTable === table) return Promise.reject(Error('read failed')).then(resolve, reject);
        assert.ok(call.range ? call.range[1]-call.range[0]===25 : Number.isSafeInteger(call.limit) && call.limit <= 1001, `Unbounded ${table}`);
        let result = structuredClone(db[table] ?? []);
        if (!options.ignore?.includes(table)) for (const [op, key, expected] of call.filters) result = result.filter(row => op === 'in' ? expected.includes(row[key]) : row[key] === expected);
        result.sort((left, right) => { for (const [key, asc] of call.orders) { const compared = String(left[key] ?? '').localeCompare(String(right[key] ?? '')); if (compared) return asc ? compared : -compared; } return 0; });
        const count = Object.hasOwn(options.counts ?? {}, table) ? options.counts[table] : result.length;
        result = call.range ? result.slice(call.range[0],call.range[1]+1) : result.slice(0, call.limit); if (Object.hasOwn(options.cap ?? {}, table)) result = result.slice(0, options.cap[table]);
        if (options.duplicate === table && result.length) result.push(result[0]);
        result = result.map(row => Object.fromEntries(call.columns.split(',').filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]])));
        if (options.transport) result = options.transport(table, result, call);
        call.returned = result.length; call.payloads = result.filter(row => Object.hasOwn(row, 'content')).map(row => row.id);
        return Promise.resolve({ data: options.failTable === table ? null : result, count, error: options.failTable === table ? true : null }).then(resolve, reject);
      },
    };
    return q;
  } } };
  return { calls, context, db };
}
test('each child is independently bounded for 135+ rows in each of two Businesses', async () => {
  const first = rows(136), second = rows(137, other, otherRunId, 10000), tables = Object.fromEntries(Object.keys(first).map(table => [table, [...first[table], ...second[table]]]));
  const h = fixture(tables);
  for (const [businessId, selectedRun, count] of [[business, runId, 136], [other, otherRunId, 137]]) {
    const result = await loadConsoleWorkDetail(h.context, selectedRun, { businessId });
    assert.equal(result.selection.status, 'found'); assert.equal(result.run.business_id, businessId); assert.equal(result.complete, false);
    for (const key of ['stages', 'tasks', 'workers', 'interventions', 'artifacts']) {
      assert.equal(result.completeness[key].loaded, 25); assert.equal(result.completeness[key].total, count); assert.equal(result.completeness[key].hasMore, true); assert.equal(result.completeness[key].complete, false);
    }
    assert.ok(result.artifacts.every(row => row.business_id === businessId && row.workflow_run_id === selectedRun && !Object.hasOwn(row, 'content')));
  }
  for (const call of h.calls.filter(call => Object.hasOwn(first, call.table))) {
    assert.deepEqual(call.range, [0,25]); assert.deepEqual(call.orders[1], ['id', false]);
    assert.equal(call.payloads.length, 0);
    assert.ok(call.filters.some(f => f[1] === 'workflow_run_id'));
  }
});
test('artifact payload is fetched only for exact old off-window ID with Business and run predicates', async () => {
  const data = rows(140), h = fixture(data), artifact = data.artifacts[0];
  const result = await loadConsoleWorkDetail(h.context, runId, { artifactId: artifact.id });
  assert.equal(result.artifactSelection.status, 'found'); assert.deepEqual(result.artifactSelection.item.content, artifact.content);
  assert.ok(!result.artifacts.some(row => row.id === artifact.id), 'selected payload is independent of metadata window');
  const payload = h.calls.filter(call => call.columns?.split(',').includes('content'));
  assert.equal(payload.length, 1); assert.equal(payload[0].limit, 2);
  assert.ok(payload[0].filters.some(f => f[1] === 'id' && f[2] === artifact.id));
  assert.ok(payload[0].filters.some(f => f[1] === 'workflow_run_id' && f[2] === runId));
  assert.ok(payload[0].filters.some(f => f[1] === 'business_id' && f[2].includes(business)));
  assert.deepEqual(payload[0].payloads, [artifact.id]);
});
test('same-Business cross-run and cross-Business artifacts are rejected without payload download', async () => {
  for (const [artifactBusiness, artifactRun] of [[business, otherRunId], [other, runId]]) {
    const artifact = rows(1, artifactBusiness, artifactRun).artifacts[0], h = fixture({ artifacts: [artifact] });
    const result = await loadConsoleWorkDetail(h.context, runId, { artifactId: artifact.id });
    assert.equal(result.artifactSelection.status, 'missing'); assert.equal(result.artifactSelection.item, null);
    assert.deepEqual(h.calls.flatMap(call => call.payloads), []);
  }
});
test('ignored row predicates, duplicate children and wrong exact IDs never become verified context', async () => {
  for (const table of ['workflow_stage_runs', 'task_contracts', 'worker_runs', 'owner_interventions', 'artifacts']) {
    const h = fixture(rows(1, other, otherRunId), { ignore: [table] });
    const result = await loadConsoleWorkDetail(h.context, runId);
    const key = { workflow_stage_runs: 'stages', task_contracts: 'tasks', worker_runs: 'workers', owner_interventions: 'interventions', artifacts: 'artifacts' }[table];
    assert.equal(result.completeness[key].loaded, 0); assert.equal(result.completeness[key].complete, false); assert.equal(result.completeness[key].total, null);
  }
  const duplicate = fixture(rows(1), { duplicate: 'task_contracts' });
  assert.equal((await loadConsoleWorkDetail(duplicate.context, runId)).completeness.tasks.complete, false);
  const wrongRun = fixture({}, { ignore: ['workflow_runs'] });
  assert.equal((await loadConsoleWorkDetail(wrongRun.context, runId)).selection.status, 'unavailable');
  assert.equal(wrongRun.calls.length, 1, 'no child reads before exact ownership verification');
});
test('missing/invalid counts, response caps and failures do not establish absent or current children', async () => {
  const tables = rows(130);
  for (const value of [null, -1, NaN, Infinity, 1.2, '130', Number.MAX_SAFE_INTEGER + 1]) {
    const h = fixture(tables, { counts: Object.fromEntries(Object.keys(tables).map(table => [table, value])) });
    const result = await loadConsoleWorkDetail(h.context, runId);
    for (const key of ['stages', 'tasks', 'workers', 'interventions', 'artifacts']) { assert.equal(result.completeness[key].total, null); assert.equal(result.completeness[key].complete, false); }
  }
  for (const flag of ['failTable', 'throwTable']) for (const table of Object.keys(tables)) {
    const h = fixture(tables, { [flag]: table }), result = await loadConsoleWorkDetail(h.context, runId);
    assert.equal(result.complete, false); assert.ok(result.errors.length);
  }
  const cap = fixture(tables, { cap: { workflow_stage_runs: 4, task_contracts: 4, worker_runs: 4, owner_interventions: 4, artifacts: 4 } });
  const result = await loadConsoleWorkDetail(cap.context, runId);
  for (const key of ['stages', 'tasks', 'workers', 'interventions', 'artifacts']) { assert.equal(result.completeness[key].loaded, 4); assert.equal(result.completeness[key].complete, false); assert.equal(result.completeness[key].total, null); }
});
test('complete empty and short reads report exact child totals without inventing activity', async () => {
  for (const count of [0, 1, 24, 25, 26, 49, 50, 51, 100]) {
    const h = fixture(rows(count)), result = await loadConsoleWorkDetail(h.context, runId);
    for (const key of ['stages', 'tasks', 'workers', 'interventions', 'artifacts']) { assert.equal(result.completeness[key].complete, count<=25); assert.equal(result.completeness[key].total, count); assert.equal(result.completeness[key].loaded, Math.min(count,25)); assert.equal(result.completeness[key].hasMore, count>25); }
    assert.equal(result.research.status, 'not-loaded'); assert.ok(!Object.hasOwn(result, 'currentWorker'));
  }
});
test('failed, capped, missing cost counts stay unavailable under established 1000-row contract', async () => {
  for (const options of [{ counts: { model_invocations: null } }, { failTable: 'model_invocations' }, { throwTable: 'model_invocations' }, { cap: { model_invocations: 3 } }]) {
    const invocations = Array.from({ length: 1002 }, (_, n) => ({ id: id(20000 + n), business_id: business, workflow_run_id: runId, status: 'completed', cost_usd: null }));
    const h = fixture({ model_invocations: invocations }, options), result = await loadConsoleWorkDetail(h.context, runId);
    assert.equal(result.costs.calls.status, 'unavailable'); assert.ok(result.errors.some(message => /cost/.test(message)));
    assert.equal(h.calls.find(call => call.table === 'model_invocations').limit, 1001);
  }
  const h = fixture({ model_invocations: Array.from({ length: 1002 }, (_, n) => ({ id: id(20000 + n), business_id: business, workflow_run_id: runId })) });
  assert.equal((await loadConsoleWorkDetail(h.context, runId)).costs.calls.status, 'unavailable');
});
test('missing definition does not guess a ready model ledger for a potentially different workflow', async () => {
  const h = fixture({ workflow_definitions: [] }), result = await loadConsoleWorkDetail(h.context, runId);
  assert.equal(result.costs.calls.status, 'unavailable'); assert.equal(result.definition, null);
  assert.ok(!h.calls.some(call => call.table === 'model_invocations'));
});
test('research context uses exact legacy experiment, never a sampled product workspace', async () => {
  const experimentId = id(8000), experiment = { id: experimentId, business_id: business, workflow_run_id: runId, discovery_version: 'pod-discovery-2.0', parent_discovery_id: null, status: 'completed', created_at: stamp };
  const tables = { workflow_runs: [{ ...run, input: { intentId: experimentId } }], workflow_definitions: [{ ...definition, workflow_key: 'product.discovery-v2.fixture' }], product_experiments: [experiment, { ...experiment, id: id(8001) }] };
  const h = fixture(tables), result = await loadConsoleWorkDetail(h.context, runId);
  assert.equal(result.research.status, 'found'); assert.equal(result.research.experiment.id, experimentId);
  const call = h.calls.find(call => call.table === 'product_experiments');
  assert.equal(call.limit, 2); assert.ok(call.filters.some(f => f[1] === 'id' && f[2] === experimentId)); assert.ok(call.filters.some(f => f[1] === 'workflow_run_id' && f[2] === runId));
  const invalid = fixture({ ...tables, product_experiments: [{ ...experiment, workflow_run_id: otherRunId }] }, { ignore: ['product_experiments'] });
  assert.equal((await loadConsoleWorkDetail(invalid.context, runId)).research.status, 'unavailable');
  assert.ok(!h.calls.some(call => /workspace/.test(call.table)));
});
test('foreign selected Business and malformed artifact identity fail before child data reads', async () => {
  const h = fixture(rows(1));
  await assert.rejects(loadConsoleWorkDetail(h.context, runId, { artifactId: 'not-an-id' }), /identity/);
  await assert.rejects(loadConsoleWorkDetail(h.context, runId, { businessId: id(999) }), /Business selection/);
  assert.deepEqual(h.calls.map(call => call.table), ['businesses']);
  const unavailable = await loadConsoleWorkDetail(h.context, runId, { businessId: other });
  assert.equal(unavailable.selection.status, 'missing'); assert.deepEqual(h.calls.map(call => call.table), ['businesses','workflow_runs']);
});

test('research without exact experiment identity remains explicitly not loaded and incomplete', async () => {
  const h = fixture({ workflow_definitions: [{ ...definition, workflow_key: 'product.discovery-v2.fixture' }] });
  const result = await loadConsoleWorkDetail(h.context, runId);
  assert.equal(result.research.status, 'not-loaded'); assert.equal(result.complete, false);
  assert.ok(result.errors.some(message => /research context is not loaded/.test(message)));
  assert.ok(!h.calls.some(call => call.table === 'product_experiments'));
});

test('exact selected Work detail retains its full saved input/state payloads independently of metadata lists', async () => {
  const input = { intent: 'x'.repeat(250_000) }, state = { context: 'y'.repeat(250_000) };
  const h = fixture({ workflow_runs: [{ ...run, input, state }] });
  const result = await loadConsoleWorkDetail(h.context, runId);
  assert.deepEqual(result.run.input, input); assert.deepEqual(result.run.state, state);
  const call = h.calls.find(call => call.table === 'workflow_runs');
  assert.equal(call.limit, 2); assert.ok(call.columns.split(',').includes('input')); assert.ok(call.columns.split(',').includes('state'));
  assert.ok(call.filters.some(f => f[1] === 'id' && f[2] === runId));
  assert.ok(call.filters.some(f => f[1] === 'business_id'));
});

test('artifact windows omit JSON metadata too; only the exact selected record receives it', async () => {
  const data = rows(3), artifact = data.artifacts[0];
  artifact.metadata = { retainedExact: 'm'.repeat(250000) }; artifact.content = null;
  const h = fixture(data), result = await loadConsoleWorkDetail(h.context, runId, { artifactId: artifact.id });
  assert.ok(result.artifacts.every(row => !Object.hasOwn(row, 'content') && !Object.hasOwn(row, 'metadata')));
  assert.equal(result.artifactSelection.status, 'found'); assert.deepEqual(result.artifactSelection.item.metadata, artifact.metadata);
  const calls = h.calls.filter(call => call.table === 'artifacts');
  assert.equal(calls.filter(call => call.columns.split(',').includes('metadata')).length, 1);
  assert.ok(calls.filter(call => !call.columns.split(',').includes('content')).every(call => !call.columns.split(',').includes('metadata')));
});

test('post-transport missing or invalid execution timestamps fail closed before detail or child truth', async () => {
  const invalids = [undefined, '', ' ', 'not-a-time', '2026-02-30T12:00:00Z', '2026-10-02', 0, {}];
  for (const table of ['workflow_runs', 'workflow_stage_runs', 'worker_runs']) for (const field of ['started_at', 'completed_at']) for (const value of invalids) {
    const h = fixture(rows(1), { transport(source, records) {
      return source !== table ? records : records.map(row => { const next = { ...row }; if (value === undefined) delete next[field]; else next[field] = value; return next; });
    } });
    const result = await loadConsoleWorkDetail(h.context, runId);
    assert.equal(result.complete, false, `${table}.${field}=${String(value)}`);
    if (table === 'workflow_runs') { assert.equal(result.selection.status, 'unavailable'); assert.equal(result.run, null); assert.equal(h.calls.length, 1); }
    else { const key = table === 'workflow_stage_runs' ? 'stages' : 'workers'; assert.equal(result.completeness[key].complete, false); assert.equal(result.completeness[key].total, null); assert.equal(result.completeness[key].loaded, 0); }
  }
});

test('missing/blank run, stage, task and worker statuses remain unavailable while future nonempty statuses survive', async () => {
  for (const table of ['workflow_runs', 'workflow_stage_runs', 'task_contracts', 'worker_runs']) for (const value of [undefined, null, '', '  ', 1]) {
    const h = fixture(rows(1), { transport(source, records) {
      return source === table ? records.map(row => { const next = { ...row, status: value }; if (value === undefined) delete next.status; return next; }) : records;
    } });
    const result = await loadConsoleWorkDetail(h.context, runId);
    assert.equal(result.complete, false);
    if (table === 'workflow_runs') assert.equal(result.selection.status, 'unavailable');
    else { const key = { workflow_stage_runs: 'stages', task_contracts: 'tasks', worker_runs: 'workers' }[table]; assert.equal(result.completeness[key].loaded, 0); assert.equal(result.completeness[key].complete, false); }
  }
  const h = fixture(rows(1), { transport(table, records) { return ['workflow_runs', 'workflow_stage_runs', 'task_contracts', 'worker_runs'].includes(table) ? records.map(row => ({ ...row, status: 'future_saved_state', ...(['workflow_runs', 'workflow_stage_runs', 'worker_runs'].includes(table) ? { started_at: null, completed_at: null } : {}) })) : records; } });
  const result = await loadConsoleWorkDetail(h.context, runId);
  assert.equal(result.complete, true);
  for (const row of [result.run, ...result.stages, ...result.tasks, ...result.workerRuns]) assert.equal(row.status, 'future_saved_state');
});

test('invalid child transport cannot crash actual detail badges or animate an active worker', async () => {
  const { workDetailUi } = await import('./helpers/console-collection-fixtures.mjs');
  const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
  const motion = load('src/lib/core-ui/console-motion.ts', { './workflows': workflows });
  for (const [table, field] of [['workflow_stage_runs', 'status'], ['task_contracts', 'status'], ['worker_runs', 'status'], ['worker_runs', 'completed_at']]) {
    const h = fixture(rows(1), { transport(source, records) { return source === table ? records.map(row => { const next = { ...row }; delete next[field]; return next; }) : records; } });
    const detail = await loadConsoleWorkDetail(h.context, runId);
    let markup;
    assert.doesNotThrow(() => { markup = renderToStaticMarkup(React.createElement(workDetailUi.ConsoleWorkDetail, { detail, searchParams: { view: 'work', selected: runId } })); });
    assert.match(markup, /Incomplete history/); assert.doesNotMatch(markup, /undefined/);
    const now = Date.parse(stamp), snapshot = motion.deriveConsoleMotionSnapshot({ runs: detail.run ? [detail.run] : [], stages: detail.stages, tasks: detail.tasks, workerRuns: detail.workerRuns, artifacts: detail.artifacts, interventions: detail.interventions, errors: detail.errors }, { businessIds: [business], observedAt: now, unavailable: !detail.complete });
    const ledger = motion.advanceConsoleMotion(null, snapshot, now);
    for (const target of ['core', 'run', 'stage', 'worker']) assert.equal(motion.consoleMotionPresentation(ledger, target, id(3000), now).state, 'unavailable');
  }
});
