import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSource } from './helpers/guided-ui.mjs';
import * as ownerEntry from '../.core-tests/core/owner-entry.js';

async function contextFor(count, error = null, { selectedError = null, selectedId = null, selectedRow = null } = {}) {
  const reads = [];
  const client = { auth: { getClaims: async () => ({ data: { claims: { sub: '00000000-0000-4000-8000-000000000001', email: 'fixture@example.invalid' } }, error: null }) },
    from(table) {
      reads.push(table);
      let exact = false;
      const result = table === 'owner_interventions' ? { data: null, count, error } : table === 'businesses' ? { data: [], count: 0, error: null } : { data: { display_name: 'Synthetic owner' }, error: null };
      const q = { select() { return q; }, eq(key) { if (table === 'businesses' && key === 'id') exact = true; return q; }, order() { return q; }, range() { return q; }, maybeSingle() { return q; }, then(resolve, reject) { return Promise.resolve(exact ? { data: selectedRow, error: selectedError } : result).then(resolve, reject); } };
      return q;
    },
  };
  const { requireOwnerUiContext } = loadSource('src/lib/core-ui/data.ts', {
    'next/navigation': { notFound: () => { throw Error('Unexpected record lookup'); }, redirect: () => { throw Error('Unexpected authentication redirect'); } },
    'next/headers': { headers: async () => ({ get: () => `/dashboard/quests${selectedId ? `?business=${selectedId}` : ''}` }) },
    '@/core/owner-entry': ownerEntry,
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


test('exact Business outages remain unavailable while definitive missing identity stays not-found', async () => {
 const selectedId='00000000-0000-4000-8000-000000000901';
 const {context,reads}=await contextFor(2,null,{selectedId,selectedError:{message:'private transport outage'}});
 assert.equal(context.businessesUnavailable,true);assert.equal(context.businessDirectory.available,true);
 assert.equal(context.businesses.length,0);assert.equal(context.readSearch,`?business=${selectedId}`);
 assert.equal(reads.filter(table=>table==='businesses').length,2);assert.equal(context.needsYouCount,2);
 assert.doesNotMatch(JSON.stringify({...context,supabase:undefined}),/private transport outage/);
 await assert.rejects(contextFor(2,null,{selectedId}),/Unexpected record lookup/);
 const found=await contextFor(2,null,{selectedId,selectedRow:{id:selectedId,name:'Exact owned Business'}});
 assert.equal(found.context.businessesUnavailable,false);assert.equal(found.context.businesses[0].id,selectedId);
 assert.equal(found.context.businessDirectory.total,0);
});
