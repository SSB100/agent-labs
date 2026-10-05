import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadSource } from './helpers/guided-ui.mjs';

const query = loadSource('src/lib/core-ui/console-collections-query.ts');
const collections = loadSource('src/lib/core-ui/console-collections.ts', { 'server-only': {}, './console-collections-query': query });
const { ConsoleEpisodeEvidence } = loadSource('src/components/console/console-episode-evidence.tsx', { '@/lib/core-ui/console-collections': collections });
const id = n => `92000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const businessId = id(1), runId = id(2), agentId = id(3), taskId = id(4), stepId = id(5), definitionId = id(6), questId = id(7);
const unavailable = /This exact Step\/Agent\/task chain is unavailable.*No substitute was selected/;
function fixture(options = {}) {
  const calls = [], db = {
    workflow_stage_runs: { id: stepId, workflow_run_id: runId, stage_key: 'saved_stage', sequence: 1, attempt: 1, status: 'completed', output: {}, failure: {} },
    worker_runs: { id: agentId, business_id: businessId, workflow_run_id: runId, task_contract_id: taskId, worker_definition_id: definitionId, status: 'completed', output: {}, failure: {}, execution_metadata: {} },
    task_contracts: { id: taskId, business_id: businessId, workflow_run_id: runId, workflow_stage_run_id: options.stage === undefined ? null : options.stage, worker_definition_id: definitionId,
      objective: 'Render the fixed reviewed public R10 source, relay only bounded read-only frames, then acknowledge producer drain.' },
    worker_definitions: { id: definitionId, name: 'Controlled public capture worker', version: '1.0.0', role: 'read-only capture' },
  };
  const context = { readSearch: new URLSearchParams({ business: businessId, quest: questId, episode: runId, agent: agentId }).toString(), supabase: { from(table) {
    const call = { table, filters: [] }; calls.push(call);
    const q = { select(columns) { call.columns = columns; return q; }, eq(key, value) { call.filters.push([key, value]); return q; }, async maybeSingle() {
      const row = db[table], filtered = call.filters.every(([key, value]) => row[key] === value) ? structuredClone(row) : null;
      return { data: options.transport ? options.transport(table, filtered) : filtered, error: options.failTable === table ? true : null };
    } };
    return q;
  } } };
  return { calls, context };
}
async function markup(f, selection = {}) {
  return renderToStaticMarkup(await ConsoleEpisodeEvidence({ context: f.context, businessId, runId, agentId, ...selection }));
}

test('exact run-level Agent/task chain labels no stage and never reads or selects a substitute Step', async () => {
  const f = fixture(), html = await markup(f);
  assert.match(html, /Run-level task · No stage assigned/); assert.match(html, new RegExp(`Actual Worker Run ${agentId} · Task ${taskId}`));
  assert.doesNotMatch(html, /Exact Step outputs|Stage null|Stage undefined|unavailable/);
  assert.deepEqual(f.calls.map(call => call.table), ['worker_runs', 'task_contracts', 'worker_definitions']);
  assert.deepEqual(f.calls[1].filters, [['id', taskId], ['business_id', businessId], ['workflow_run_id', runId], ['worker_definition_id', definitionId]]);
  const href = new URL(/href="([^"]+)"/.exec(html)[1].replaceAll('&amp;', '&'), 'https://fixture.invalid');
  assert.equal(href.pathname, `/dashboard/workflows/${runId}`); assert.equal(href.searchParams.get('business'), businessId);
  assert.equal(href.searchParams.get('quest'), questId); assert.equal(href.searchParams.get('episode'), runId); assert.equal(href.searchParams.get('agent'), agentId); assert.equal(href.searchParams.get('step'), null);
});

test('explicit Step identity must match the exact non-null task stage; run-level tasks cannot borrow it', async () => {
  for (const stage of [null, id(99)]) {
    const f = fixture({ stage }), html = await markup(f, { stepId });
    assert.match(html, unavailable); assert.doesNotMatch(html, /Run-level task|Actual Worker Run/);
    assert.equal(f.calls.some(call => call.table === 'worker_definitions'), false);
  }
  const same = await markup(fixture({ stage: stepId }), { stepId });
  assert.match(same, new RegExp(`Exact Step ${stepId}`)); assert.match(same, new RegExp(`Stage ${stepId}`)); assert.doesNotMatch(same, unavailable);
  const agentOnly = fixture({ stage: stepId }), saved = await markup(agentOnly);
  assert.match(saved, new RegExp(`Stage ${stepId}`)); assert.doesNotMatch(saved, /Run-level task/); assert.equal(agentOnly.calls.some(call => call.table === 'workflow_stage_runs'), false);
});

test('omitted or malformed task stage is unavailable, never labeled as a run-level task', async () => {
  for (const value of [undefined, '', ' ', 'not-an-id', 0, false, {}, []]) {
    const f = fixture({ transport(table, row) {
      if (table !== 'task_contracts') return row;
      if (value === undefined) delete row.workflow_stage_run_id; else row.workflow_stage_run_id = value;
      return row;
    } });
    const html = await markup(f); assert.match(html, unavailable, String(value)); assert.doesNotMatch(html, /Run-level task|Actual Worker Run/);
    assert.equal(f.calls.some(call => call.table === 'worker_definitions'), false);
  }
});

test('ignored exact identity and scope predicates fail closed before following or displaying another chain', async () => {
  const cases = [
    ['worker_runs', 'id'], ['worker_runs', 'business_id'], ['worker_runs', 'workflow_run_id'],
    ['task_contracts', 'id'], ['task_contracts', 'business_id'], ['task_contracts', 'workflow_run_id'], ['task_contracts', 'worker_definition_id'],
    ['worker_definitions', 'id'], ['workflow_stage_runs', 'id'], ['workflow_stage_runs', 'workflow_run_id'],
  ];
  for (const [table, field] of cases) {
    const f = fixture({ stage: stepId, transport(source, row) { return source === table ? { ...row, [field]: id(99) } : row; } });
    const html = await markup(f, table === 'workflow_stage_runs' ? { stepId } : {});
    assert.match(html, unavailable, `${table}.${field}`); assert.doesNotMatch(html, /Actual Worker Run|Run-level task/);
    if (table === 'worker_runs') assert.equal(f.calls.some(call => call.table === 'task_contracts'), false);
    if (table === 'task_contracts' || table === 'workflow_stage_runs') assert.equal(f.calls.some(call => call.table === 'worker_definitions'), false);
  }
});

test('missing chain records and failed reads stay unavailable for null-stage Agent navigation', async () => {
  for (const table of ['worker_runs', 'task_contracts', 'worker_definitions']) {
    for (const data of [null, [], {}]) {
      assert.match(await markup(fixture({ transport(source, row) { return source === table ? data : row; } })), unavailable, `${table}=${JSON.stringify(data)}`);
    }
    assert.match(await markup(fixture({ failTable: table })), unavailable, table);
  }
  for (const field of ['task_contract_id', 'worker_definition_id']) {
    const f = fixture({ transport(table, row) { if (table === 'worker_runs') delete row[field]; return row; } });
    assert.match(await markup(f), unavailable); assert.equal(f.calls.some(call => call.table === 'task_contracts'), false);
  }
});
