import { ownerBusiness } from './helpers/history-fixtures.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), ts = require('typescript');
function load(path, dependencies = {}) {
  const loaded = { exports: {} };
  const source = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('require', 'module', 'exports', source)(name => { assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`); return dependencies[name]; }, loaded, loaded.exports);
  return loaded.exports;
}
const query = load('src/lib/core-ui/console-collections-query.ts');
const api = load('src/lib/core-ui/console-collections.ts', { 'server-only': {}, './owner-business': ownerBusiness, './console-collections-query': query });
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const a = id(1), b = id(2), foreign = id(3), def = id(4), time = '2026-10-02T01:00:00.000Z';
const definition = { id: def, workflow_key: 'fixture', name: `Duplicate ${'long-name '.repeat(30)} 50%_\\saved`, version: '1', description: '', status: 'active', stage_definition: {} };
const run = (n, business_id = a) => ({ id: id(1000 + n), business_id, workflow_definition_id: def, status: 'completed', created_at: time, updated_at: time, started_at: time, completed_at: time, current_stage_key: null, input: {}, state: {}, runtime_provider: null, runtime_run_id: null });
const event = (n, business_id = a, workflow_run_id = id(1000)) => ({ id: id(10000 + n), business_id, workflow_run_id, event_type: 'workflow.saved_50%', actor_type: 'system', actor_id: null, payload: { hidden: 'search must not use me' }, occurred_at: time, created_at: time });
function fixture(tables = {}, options = {}) {
  const calls = [];
  const value = (row, key) => key === 'definition.name' ? tables.workflow_definitions?.find(item => item.id === row.workflow_definition_id)?.name : row[key];
  const context = { businesses: [{ id: a, name: definition.name }, { id: b, name: definition.name }], userId: id(6), supabase: { from(table) {
    const call = { table, filters: [], orders: [] }; calls.push(call);
    const q = {
      maybeSingle() { assert.equal(table, 'businesses'); assert.deepEqual(call.filters, [['eq','id',foreign],['eq','owner_user_id',context.userId]]); return Promise.resolve({data:null,error:null}); },
      select(columns, settings) { assert.ok(!columns.includes('*')); call.columns = columns; call.settings = settings; return q; },
      eq(key, expected) { call.filters.push(['eq', key, expected]); return q; },
      in(key, expected) { call.filters.push(['in', key, expected]); return q; },
      is(key, expected) { call.filters.push(['is', key, expected]); return q; },
      not(key, operation, expected) { assert.equal(operation, 'is'); call.filters.push(['not', key, expected]); return q; },
      or(predicate) { assert.equal(predicate,'status.in.(completed,failed,cancelled),completed_at.not.is.null');call.filters.push(['ended']);return q; },
      ilike(key, expected) { call.filters.push(['ilike', key, expected]); return q; },
      order(key, config) { call.orders.push([key, config.ascending]); return q; },
      range(from, to) { call.range = [from, to]; return q; }, limit(n) { call.limit = n; return q; },
      then(resolve, reject) {
        if (options.throwTable === table) return Promise.reject(Error('offline')).then(resolve, reject);
        assert.ok(call.range || call.limit, `Unbounded ${table}`); assert.equal(call.settings.count, 'exact');
        let rows = structuredClone(tables[table] ?? []);
        if (!options.ignore?.includes(table)) for (const [op, key, expected] of call.filters) rows = rows.filter(row => {
          if(op==='ended')return ['completed','failed','cancelled'].includes(row.status)||row.completed_at!=null;
          const actual = value(row, key);
          if (op === 'in') return expected.includes(actual);
          if (op === 'is') return actual == null && expected === null;
          if (op === 'not') return actual != null && expected === null;
          if (op === 'ilike') return String(actual ?? '').toLowerCase().includes(expected.slice(1, -1).replace(/\\([\\%_])/g, '$1').toLowerCase());
          return actual === expected;
        });
        rows.sort((left, right) => { for (const [key, asc] of call.orders) { const compared = String(value(left, key) ?? '').localeCompare(String(value(right, key) ?? '')); if (compared) return asc ? compared : -compared; } return 0; });
        const count = Object.hasOwn(options.counts ?? {}, table) ? options.counts[table] : rows.length;
        if (call.range) rows = rows.slice(call.range[0], call.range[1] + 1); else rows = rows.slice(0, call.limit);
        if (options.cap?.[table] !== undefined) rows = rows.slice(0, options.cap[table]);
        if (options.duplicate === table && rows.length) rows.push(rows[0]);
        rows = rows.map(row => ({ ...Object.fromEntries(call.columns.split(',').filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]])), ...(call.columns.includes('definition:') ? { definition: { name: value(row, 'definition.name') } } : {}) }));
        if (options.transport) rows = options.transport(table, rows, call);
        call.returned = rows.length;
        return Promise.resolve({ data: options.failTable === table ? null : rows, count, error: options.failTable === table ? true : null }).then(resolve, reject);
      },
    }; return q;
  } } };
  return { context, calls };
}
function bounded(h) {
  for (const call of h.calls) {
    assert.equal(call.settings.count, 'exact'); assert.ok(call.range || call.limit);
    if (call.range) { assert.equal(call.range[1] - call.range[0], 25); assert.deepEqual(call.orders.map(([name]) => name), [call.table === 'events' ? 'occurred_at' : call.orders[0][0], 'id']); }
    if (call.limit) assert.ok(call.limit <= 27);
  }
}
for (const cardinality of [0, 1, 49, 50, 51, 126]) test(`Work and Activity server page/count truth at ${cardinality} rows per Business`, async () => {
  const runs = Array.from({ length: cardinality * 2 }, (_, n) => run(n, n % 2 ? a : b));
  const events = runs.map((row, n) => event(n, row.business_id, row.id));
  const h = fixture({ workflow_runs: runs, workflow_definitions: [definition], events });
  for (const businessId of [a, b]) for (const loader of [api.loadConsoleWorkPage, api.loadConsoleActivityPage]) {
    const seen = [];
    for (let page = 1; page <= Math.max(1, Math.ceil(cardinality / 25)); page++) {
      const result = await loader(h.context, { businessId, page });
      assert.equal(result.page.total, cardinality); assert.equal(result.page.complete, true);
      assert.equal(result.page.hasNext, page * 25 < cardinality);
      assert.ok(result.page.items.every(row => row.business_id === businessId));
      seen.push(...result.page.items.map(row => row.id));
    }
    assert.equal(seen.length, cardinality); assert.equal(new Set(seen).size, cardinality);
  }
  bounded(h);
});
test('old active exact selection is independent of newest terminal pages, search and aggregate Business', async () => {
  const runs = Array.from({ length: 272 }, (_, n) => run(n, n % 2 ? a : b));
  runs[0] = { ...runs[0], status: 'running', completed_at: null, created_at: '2020-01-01T00:00:00Z' };
  const h = fixture({ workflow_runs: runs, workflow_definitions: [definition] });
  const selected = await api.loadConsoleWorkPage(h.context, { page: 2, query: 'nonmatching', selectedId: runs[0].id });
  assert.equal(selected.page.total, 0); assert.equal(selected.selection.item.id, runs[0].id);
  assert.deepEqual(h.calls[0].filters[0], ['in', 'business_id', [a, b]], 'detail never narrows aggregate collection');
  const active = await api.loadConsoleWorkPage(h.context, { status: 'active' });
  assert.equal(active.page.total, 1); assert.equal(active.page.items[0].id, runs[0].id);
  const ended = { ...runs[0], completed_at: time };
  const endedFixture = fixture({ workflow_runs: [ended], workflow_definitions: [definition] });
  assert.equal((await api.loadConsoleWorkPage(endedFixture.context, { status: 'active' })).page.total, 0);
});
test('field-specific literal search escapes SQL wildcards and does not match payloads', async () => {
  const h = fixture({ workflow_runs: [run(0)], workflow_definitions: [definition], events: [event(0)] });
  const work = await api.loadConsoleWorkPage(h.context, { query: '50%_\\saved' });
  assert.equal(work.page.total, 1); assert.ok(h.calls.some(call => call.filters.some(f => f[1] === 'definition.name' && f[2] === '%50\\%\\_\\\\saved%')));
  const activity = await api.loadConsoleActivityPage(h.context, { query: 'saved_50%' });
  assert.equal(activity.page.total, 1);
  assert.ok(h.calls.some(call => call.filters.some(f => f[1] === 'event_type' && f[2] === '%saved\\_50\\%%')));
  assert.equal((await api.loadConsoleActivityPage(h.context, { query: 'search must not use me' })).page.total, 0);
});
test('Activity exact off-page selection preserves search but verifies runFilter Business and run', async () => {
  const ra = run(0), rb = run(1, b), rows = Array.from({ length: 270 }, (_, n) => event(n, n % 2 ? b : a, n % 2 ? rb.id : ra.id));
  const h = fixture({ workflow_runs: [ra, rb], events: rows });
  const page = await api.loadConsoleActivityPage(h.context, { page: 5, query: 'no-match', selectedId: rows[0].id, workflowRunId: ra.id });
  assert.equal(page.page.total, 0); assert.equal(page.selection.item.id, rows[0].id); assert.equal(page.workflowFilter.id, ra.id);
  const wrongRun = await api.loadConsoleActivityPage(h.context, { workflowRunId: rb.id, selectedId: rows[0].id });
  assert.equal(wrongRun.selection.status, 'missing');
  const wrongBusiness = await api.loadConsoleActivityPage(h.context, { businessId: a, workflowRunId: rb.id });
  assert.equal(wrongBusiness.page.total, null); assert.equal(wrongBusiness.page.complete, false);
  assert.ok(h.calls.filter(call => call.table === 'events' && call.limit).every(call => call.filters.some(f => f[1] === 'workflow_run_id')));
});
test('foreign rows, wrong run, ignored predicates and duplicate IDs fail closed', async () => {
  for (const table of ['workflow_runs', 'events']) {
    const h = fixture({ workflow_runs: [run(0, foreign)], events: [event(0, foreign)], workflow_definitions: [definition] }, { ignore: [table] });
    const result = await (table === 'events' ? api.loadConsoleActivityPage : api.loadConsoleWorkPage)(h.context, { businessId: a, selectedId: table === 'events' ? id(10000) : id(1000) });
    assert.equal(result.page.items.length, 0); assert.equal(result.page.total, null); assert.equal(result.selection.status, 'unavailable');
  }
  const ignored = fixture({ workflow_runs: [run(0)], events: [event(0, a, run(1).id)] }, { ignore: ['events'] });
  const result = await api.loadConsoleActivityPage(ignored.context, { workflowRunId: run(0).id, selectedId: event(0).id });
  assert.equal(result.page.items.length, 0); assert.equal(result.selection.status, 'unavailable');
  const duplicates = fixture({ workflow_runs: [run(0)], workflow_definitions: [definition] }, { duplicate: 'workflow_runs' });
  assert.equal((await api.loadConsoleWorkPage(duplicates.context)).page.total, null);
});
test('invalid, missing counts, caps and failed reads cannot fabricate zero or complete history', async () => {
  const rows = Array.from({ length: 135 }, (_, n) => run(n));
  for (const options of [{ counts: { workflow_runs: null } }, ...[-1, NaN, Infinity, 1.5, '135', Number.MAX_SAFE_INTEGER + 1].map(count => ({ counts: { workflow_runs: count } })), { cap: { workflow_runs: 8 } }, { failTable: 'workflow_runs' }, { throwTable: 'workflow_runs' }]) {
    const h = fixture({ workflow_runs: rows, workflow_definitions: [definition] }, options);
    const result = await api.loadConsoleWorkPage(h.context);
    assert.equal(result.page.total, null); assert.equal(result.page.complete, false); assert.ok(result.errors.length);
    if (options.counts) assert.equal(result.page.hasNext, true, 'valid sentinel still proves another page');
    const last = await api.loadConsoleWorkPage(h.context, { page: 6 });
    assert.equal(last.page.complete, false); assert.equal(last.page.hasNext, null);
  }
});
test('sort uses timestamp plus ID and deterministic oldest/updated direction', async () => {
  const h = fixture({ workflow_runs: [run(2), run(0), run(1)], workflow_definitions: [definition] });
  const result = await api.loadConsoleWorkPage(h.context, { sort: 'oldest' });
  assert.deepEqual(result.page.items.map(row => row.id), [run(0).id, run(1).id, run(2).id]);
  await api.loadConsoleWorkPage(h.context, { sort: 'updated' });
  assert.deepEqual(h.calls.filter(call => call.table === 'workflow_runs').map(call => call.orders), [[['created_at', true], ['id', true]], [['updated_at', false], ['id', false]]]);
});
test('invalid and duplicate URL identities are rejected, including alias conflicts', () => {
  for (const values of [{ business: [a, a] }, { selected: [id(1000), id(1000)] }, { run: [id(1000), id(1000)] }, { artifact: [id(2000), id(2000)] }, { page: ['1', '1'] }, { run: id(1000), selected: id(1001) }, { business: 'bad' }, { selected: 'bad' }, { artifact: id(2000) }, { decision: id(1) }, { connectionRun: id(1) }, { pageSize: '50' }, { page: '0' }, { page: '9007199254740991' }, { page: '1e2' }, { q: '*' }]) assert.throws(() => query.consoleCollectionOptionsFromSearch({ view: 'work', ...values }));
  assert.throws(() => query.consoleCollectionOptionsFromSearch({ view: 'activity', run: id(1000) }));
  assert.throws(() => query.consoleCollectionOptionsFromSearch({ view: 'work', runFilter: id(1000) }));
  assert.equal(query.consoleCollectionOptionsFromSearch({ view: 'work', run: id(1000), selected: id(1000) }).selectedId, id(1000));
});
test('close and paging preserve page/search/status/sort scope and accepted namespaces remain untouched', () => {
  const current = { view: 'work', page: '5', q: 'long name', sort: 'oldest', status: 'failed', run: id(1000), artifact: id(2000) };
  const close = new URL(query.consoleCollectionHref(current, { selected: null, artifact: null }), 'https://fixture.invalid');
  assert.equal(close.searchParams.get('page'), '5'); assert.equal(close.searchParams.get('q'), 'long name'); assert.equal(close.searchParams.get('run'), null); assert.equal(close.searchParams.get('business'), null);
  const next = new URL(query.consoleCollectionHref(current, { page: 6 }), 'https://fixture.invalid');
  assert.equal(next.searchParams.get('run'), id(1000)); assert.equal(next.searchParams.get('artifact'), id(2000));
  const changed = new URL(query.consoleCollectionHref(current, { selected: id(1001) }), 'https://fixture.invalid');
  assert.equal(changed.searchParams.get('run'), null); assert.equal(changed.searchParams.get('artifact'), null); assert.equal(changed.searchParams.get('page'), '5');
  assert.ok(!('loadConsoleDecisionPage' in api)); assert.ok(!('safeConsoleReturnPath' in query));
});
test('Business absence/unavailability never substitutes another Business', async () => {
  const h = fixture();
  await assert.rejects(api.loadConsoleWorkPage(h.context, { businessId: foreign }), /Business selection/);
  await assert.rejects(api.loadConsoleActivityPage({ ...h.context, businessesUnavailable: true }), /unavailable/);
  assert.deepEqual(h.calls.map(call => call.table), ['businesses']);
  assert.equal((await api.loadConsoleWorkPage({ ...h.context, businesses: [] })).page.total, 0);
});

test('current execution filters exclude stopped saved statuses and stopped filter is explicit', async () => {
  const active = ['running', 'queued', 'waiting', 'review', 'needs_owner'];
  const rows = active.flatMap((status, index) => [{ ...run(index), status, completed_at: null }, { ...run(10 + index), status, completed_at: time }]);
  rows.push(run(50));
  const h = fixture({ workflow_runs: rows, workflow_definitions: [definition] });
  for (const status of active) {
    const result = await api.loadConsoleWorkPage(h.context, { status });
    assert.equal(result.page.total, 1); assert.equal(result.page.items[0].completed_at, null);
  }
  const stopped = await api.loadConsoleWorkPage(h.context, { status: 'stopped' });
  assert.equal(stopped.page.total, 5); assert.ok(stopped.page.items.every(row => row.completed_at !== null && active.includes(row.status)));
  assert.ok(h.calls.some(call => call.filters.some(filter => filter[0] === 'not' && filter[1] === 'completed_at')));
  const ignored = fixture({ workflow_runs: rows.filter(row => row.status === 'running' && row.completed_at) }, { ignore: ['workflow_runs'] });
  assert.equal((await api.loadConsoleWorkPage(ignored.context, { status: 'running' })).page.total, null);
});

test('Activity missing count and capped/failed pages stay unknown even with an exact selected event', async () => {
  const events = Array.from({ length: 131 }, (_, n) => event(n)), tables = { events, workflow_runs: [run(0)] };
  for (const options of [{ counts: { events: null } }, { counts: { events: -1 } }, { cap: { events: 3 } }, { failTable: 'events' }]) {
    const h = fixture(tables, options), result = await api.loadConsoleActivityPage(h.context, { page: 5, selectedId: events[0].id });
    assert.equal(result.page.total, null); assert.equal(result.page.complete, false); assert.ok(result.errors.length);
    if (options.cap) assert.equal(result.selection.status, 'found');
    else assert.equal(result.selection.status, 'unavailable');
  }
});

test('Work and Activity list/context reads omit large JSON while exact selected Activity retains payload', async () => {
  const huge = { text: 'x'.repeat(250_000) }, fullRun = { ...run(0), input: huge, state: huge }, fullEvent = { ...event(0), payload: huge };
  const h = fixture({ workflow_runs: [fullRun], workflow_definitions: [{ ...definition, stage_definition: huge }], events: [fullEvent] });
  const work = await api.loadConsoleWorkPage(h.context, { selectedId: fullRun.id });
  for (const row of [...work.page.items, work.selection.item]) { assert.ok(!Object.hasOwn(row, 'input')); assert.ok(!Object.hasOwn(row, 'state')); }
  assert.ok(!Object.hasOwn(work.definitions[0], 'stage_definition'));
  const activity = await api.loadConsoleActivityPage(h.context, { selectedId: fullEvent.id });
  assert.ok(!Object.hasOwn(activity.page.items[0], 'payload')); assert.deepEqual(activity.selection.item.payload, huge);
  assert.ok(activity.runs.every(row => !Object.hasOwn(row, 'input') && !Object.hasOwn(row, 'state')));
  const filtered = await api.loadConsoleActivityPage(h.context, { workflowRunId: fullRun.id });
  assert.ok(!Object.hasOwn(filtered.workflowFilter, 'input')); assert.ok(!Object.hasOwn(filtered.workflowFilter, 'state'));
  for (const call of h.calls) {
    const fields = call.columns.split(',');
    if (call.table === 'workflow_runs') { assert.ok(!fields.includes('input')); assert.ok(!fields.includes('state')); }
    if (call.table === 'workflow_definitions') assert.ok(!fields.includes('stage_definition'));
    if (call.table === 'events' && call.range) assert.ok(!fields.includes('payload'));
    if (fields.includes('payload')) { assert.equal(call.limit, 2); assert.ok(call.filters.some(f => f[1] === 'id' && f[2] === fullEvent.id)); }
  }
});

test('post-transport execution omissions cannot certify Running pages or exact run context', async () => {
  const source = Array.from({ length: 71 }, (_, n) => ({ ...run(n), status: 'running', completed_at: null }));
  const invalids = [undefined, '', ' ', 'invalid', '2026-02-30T12:00:00Z', '2026-10-02', 0, {}];
  for (const field of ['started_at', 'completed_at']) for (const value of invalids) {
    const h = fixture({ workflow_runs: source, workflow_definitions: [definition], events: [event(0)] }, { transport(table, rows) {
      return table !== 'workflow_runs' ? rows : rows.map(row => { const changed = { ...row }; if (value === undefined) delete changed[field]; else changed[field] = value; return changed; });
    } });
    const result = await api.loadConsoleWorkPage(h.context, { status: 'running', selectedId: source[0].id });
    assert.equal(result.page.complete, false, `${field}=${String(value)}`); assert.equal(result.page.total, null); assert.equal(result.page.items.length, 0); assert.equal(result.selection.status, 'unavailable'); assert.ok(result.errors.length);
    assert.equal(h.calls.find(call => call.range).returned, 26, 'corruption occurs after filter/count/page transport');
    const activity = await api.loadConsoleActivityPage(h.context, { workflowRunId: source[0].id });
    assert.equal(activity.workflowFilter, null); assert.equal(activity.page.complete, false);
  }
  for (const status of [undefined, null, '', '  ', 123]) {
    const h = fixture({ workflow_runs: source, workflow_definitions: [definition] }, { transport(table, rows) {
      return table === 'workflow_runs' ? rows.map(row => { const next = { ...row, status }; if (status === undefined) delete next.status; return next; }) : rows;
    } });
    assert.equal((await api.loadConsoleWorkPage(h.context)).page.items.length, 0);
  }
});

test('required nullable timestamps accept explicit null and valid microsecond offsets; future statuses remain inspectable', async () => {
  const source = { ...run(0), status: 'future_recorded_state', started_at: null, completed_at: '2026-10-02T13:14:15.123456+12:00' };
  const h = fixture({ workflow_runs: [source], workflow_definitions: [definition] });
  const result = await api.loadConsoleWorkPage(h.context, { selectedId: source.id });
  assert.equal(result.page.complete, true); assert.equal(result.page.items[0].status, source.status); assert.equal(result.selection.item.completed_at, source.completed_at);
  for (const value of [undefined, null, '', '2026-02-29T01:00:00Z', '2026-04-31T01:00:00Z', '2026-10-02T24:00:00Z', '2026-10-02T01:00:00']) assert.equal(api.consoleValidTimestamp(value), false);
  for (const value of ['2024-02-29T01:00:00Z', '2026-10-02T01:00:00.123456+00:00']) assert.equal(api.consoleValidTimestamp(value), true);
});

test('malformed transported runs produce unavailable presentation without Running badges or motion', async () => {
  const { panes } = await import('./helpers/console-collection-fixtures.mjs');
  const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
  const workflows = load('src/lib/core-ui/workflows.ts'), motion = load('src/lib/core-ui/console-motion.ts', { './workflows': workflows });
  const h = fixture({ workflow_runs: [{ ...run(0), status: 'running', completed_at: null }], workflow_definitions: [definition] }, { transport(table, rows) {
    return table === 'workflow_runs' ? rows.map(row => { const next = { ...row }; delete next.completed_at; return next; }) : rows;
  } });
  const data = await api.loadConsoleWorkPage(h.context, { status: 'running', selectedId: run(0).id });
  let markup;
  assert.doesNotThrow(() => { markup = renderToStaticMarkup(React.createElement(panes.ConsoleWorkCollectionPane, { ownerId: id(6), businesses: h.context.businesses, searchParams: { view: 'work', status: 'running', selected: run(0).id }, data })); });
  assert.match(markup, /could not be verified|Records unavailable/); assert.doesNotMatch(markup, /data-record-id=|data-tone="active">Running/);
  const now = Date.parse(time), snapshot = motion.deriveConsoleMotionSnapshot({ runs: data.page.items, stages: [], tasks: [], workerRuns: [], artifacts: [], interventions: [], errors: data.errors }, { businessIds: [a, b], observedAt: now, unavailable: !data.page.complete });
  const ledger = motion.advanceConsoleMotion(null, snapshot, now);
  for (const target of ['core', 'run', 'worker']) assert.equal(motion.consoleMotionPresentation(ledger, target, run(0).id, now).state, 'unavailable');
});


test('ended History includes failed, cancelled and terminal needs-owner outcomes while preserving unsupported ended states', async()=>{
  const records=[{...run(1),status:'failed'},{...run(2),status:'cancelled'},{...run(3),status:'needs_owner'},{...run(4),status:'future_ended_state'},{...run(5),status:'running',completed_at:null}];
  const h=fixture({workflow_runs:records,workflow_definitions:[definition]});
  const result=await api.loadConsoleWorkPage(h.context,{status:'ended'});
  assert.equal(result.page.total,4);assert.deepEqual(new Set(result.page.items.map(r=>r.status)),new Set(['failed','cancelled','needs_owner','future_ended_state']));
  assert.equal(h.calls.some(c=>c.table==='events'),false);bounded(h);
});
