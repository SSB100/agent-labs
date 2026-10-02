import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSource } from './helpers/guided-ui.mjs';

async function contextFor(count, error = null) {
  const reads = [];
  const client = { auth: { getClaims: async () => ({ data: { claims: { sub: '00000000-0000-4000-8000-000000000001', email: 'fixture@example.invalid' } }, error: null }) },
    from(table) {
      reads.push(table);
      const result = table === 'owner_interventions' ? { data: null, count, error } : table === 'businesses' ? { data: [], error: null } : { data: { display_name: 'Synthetic owner' }, error: null };
      const q = { select() { return q; }, eq() { return q; }, order() { return q; }, maybeSingle() { return q; }, then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); } };
      return q;
    },
  };
  const { requireOwnerUiContext } = loadSource('src/lib/core-ui/data.ts', {
    'next/navigation': { notFound: () => { throw Error('Unexpected record lookup'); }, redirect: () => { throw Error('Unexpected authentication redirect'); } },
    '@/lib/supabase/server': { createClient: async () => client },
  });
  return { context: await requireOwnerUiContext(), reads };
}

test('owner global count accepts only a verified nonnegative safe integer', async () => {
  for (const count of [0, 1, 143]) {
    const { context, reads } = await contextFor(count);
    assert.equal(context.needsYouCount, count); assert.equal(context.needsYouUnavailable, false);
    assert.deepEqual(reads.sort(), ['businesses', 'owner_interventions', 'profiles']);
  }
  for (const count of [null, undefined, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, '0']) {
    const { context } = await contextFor(count);
    assert.equal(context.needsYouUnavailable, true, String(count));
    assert.equal(context.needsYouCount, 0, 'Internal fallback is always marked unavailable; never a verified zero');
  }
  const { context } = await contextFor(0, { message: 'Private read failure' });
  assert.equal(context.needsYouUnavailable, true);
});
