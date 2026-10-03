import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSource } from './helpers/guided-ui.mjs';
import * as ownerEntry from '../.core-tests/core/owner-entry.js';
const { loadWorkflowCollection } = loadSource('src/lib/core-ui/data.ts', {
  'next/navigation': { notFound() { throw new Error('missing'); }, redirect() { throw new Error('redirect'); } },
  'next/headers': { headers() { throw new Error('Read-only collection fixture must not request entry recovery'); } },
  '@/core/owner-entry': ownerEntry,
  '@/lib/supabase/server': { createClient() { throw new Error('not used'); } },
});
function fixture(count, failed = false) {
  const calls = [];
  const run = { id: 'recent-run', business_id: 'owner-business', workflow_definition_id: 'definition' };
  return { calls, context: { businesses: [{ id: 'owner-business' }], supabase: { from(table) {
    const call = { table, filters: [] }; calls.push(call);
    const query = {
      select(columns, options) { call.options = options; return query; },
      in(key, value) { call.filters.push([key, value]); return query; },
      order() { return query; }, limit(value) { call.limit = value; return query; },
      then(resolve, reject) { return Promise.resolve({ data: table === 'workflow_runs' ? [run] : [], count: table === 'workflow_runs' ? count : 0, error: table === 'workflow_runs' && failed ? { message: 'read failed' } : null }).then(resolve, reject); },
    }; return query;
  } } } };
}
test('bounded recent workflow reads retain the exact owner-scoped total without fetching every run', async () => {
  const h = fixture(101), result = await loadWorkflowCollection(h.context, { limit: 80 });
  assert.equal(result.runs.length, 1);
  assert.equal(result.runCount, 101);
  assert.equal(result.truncated, true);
  assert.equal(h.calls[0].options.count, 'exact');
  assert.equal(h.calls[0].limit, 80);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].filters)), [['business_id', ['owner-business']]]);
});
test('unknown or failed run counts cannot establish completeness', async () => {
  for (const count of [null, undefined]) {
    const h = fixture(count), result = await loadWorkflowCollection(h.context);
    assert.equal(result.runCount, null); assert.equal(result.truncated, true);
  }
  const result = await loadWorkflowCollection(fixture(null, true).context);
  assert.ok(result.errors.length); assert.equal(result.truncated, true);
  assert.equal((await loadWorkflowCollection(fixture(1).context)).truncated, false);
});
