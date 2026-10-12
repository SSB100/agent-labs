// Socket-free preflight only. Hosted/browser acceptance is a separate CI runner.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, createHmac } from 'node:crypto';
import { seedPodNextDatabase, podNextProvider } from './next-fixture/r12-pod-boundary.mjs';
import { R12_INERT_ROOT } from './next-fixture/r12-sql.mjs';
import { podRpc, podQuoteFixture, podInertOutputs, POD_PHASES } from './helpers/r12-pod-sql-fixture.mjs';
const host = process.env.R12_SQL_TEST_HOST;
test('POD Next runner preserves production actions and Workflow host while blocking external transport', () => {
  const runner = readFileSync(new URL('./next-fixture/r12-pod-runner.mjs', import.meta.url), 'utf8');
  assert.match(runner, /WORKFLOW_TARGET_WORLD:'local'/); assert.match(runner, /WORKFLOW_LOCAL_BASE_URL:origin/);
  assert.match(runner, /block-network\.mjs/); assert.match(runner, /runPodNextJourney/);
  const edited = [...runner.matchAll(/writeFile\(path\.join\(fixture,'([^']+)'\)/g)].map(match => match[1]).sort();
  assert.deepEqual(edited, ['next.config.ts', 'src/lib/supabase/client.ts', 'src/lib/supabase/inert-transport.d.mts', 'src/lib/supabase/proxy.ts', 'src/lib/supabase/server.ts', 'src/products/discovery-r12-server-dependencies.ts']);
  const journey = readFileSync(new URL('./next-fixture/r12-pod-journey.mjs', import.meta.url), 'utf8');
  assert.match(journey, /actual-workflow-runtime-read/); assert.match(journey, /boundary\.result\(receipt\.scopeId\)/);
  assert.doesNotMatch(journey, /continuePodResearchRuntime\(/);
});
test('POD Next seed uses actual migrations and a synthetic template without execution authority', { skip: !host, timeout: 90000 }, async () => {
  const { db, seeded } = await seedPodNextDatabase(host);
  try {
    const capability = createHmac('sha256', R12_INERT_ROOT).update('r12.pod-owner-application.1').digest('base64url');
    const catalog = await podRpc(db, 'authenticated', seeded.ownerId, 'r12_pod_research_read', [seeded.businessId, null, null, null]);
    assert.equal(catalog.setups.length, 0); assert.equal(catalog.business.ready, true);
    const stored = (await db.query('select server_key_hash from private.r12_pod_templates where id=$1', [seeded.templateId])).rows[0];
    assert.equal(stored.server_key_hash, createHash('sha256').update(capability).digest('hex'));
    const prepared = await podRpc(db, 'authenticated', seeded.ownerId, 'r12_pod_owner_server', [seeded.businessId, 'prepare', { input: seeded.input, quote: podQuoteFixture() }, capability]);
    assert.equal(prepared.activated, false); assert.equal(prepared.confirmed, false);
    assert.equal(prepared.preview.version, 'r12.pod-research-preview.2'); assert.equal(prepared.preview.quote.version, 'r12.pod-quote.2');
    assert.equal(prepared.preview.maximumPasses, 5); assert.equal(prepared.preview.maximumCalls, 25); assert.equal(prepared.preview.maximumCollections, 5);
    assert.deepEqual((await db.query('select (select count(*)::int from private.r12_discovery_scopes) scopes,(select count(*)::int from private.r05_requests) requests')).rows[0], { scopes: 0, requests: 0 });
  } finally { await db.close(); }
});

test('POD browser provider double binds every phase to its admitted pass and refines one weak query', () => {
  const state = { r12: { scopeId: 'inert-scope', calls: [], receipts: [], podPass: null } }, phase0 = podInertOutputs({ passOrdinal: 0 });
  const request = (ordinal, phase) => {
    const output = podInertOutputs({ passOrdinal: ordinal, useful: ordinal === 1 });
    const refinement = ordinal === 0 ? null : { previousPass: 0, review: phase0.review, priorQueries: [{ query: phase0.plan.query }] };
    return { phase, method: 'POST', url: 'https://openrouter.ai/api/v1/chat/completions', body: { provider: { only: [phase === 'review' ? 'amazon-bedrock/us' : 'azure/us'], zdr: true }, messages: [{ role: 'system', content: 'Inert fixture request' }, { role: 'user', content: phase === 'search1' ? output.plan.query : JSON.stringify({ refinement }) }], ...(phase === 'search1' ? { tools: [{ parameters: { allowed_domains: output.plan.sourceDomains } }] } : {}) } };
  };
  assert.throws(() => podNextProvider(state, request(0, 'plan')), /real admitted/);
  const outputs = [];
  for (const ordinal of [0, 1]) {
    state.r12.podPass = { ordinal, actionHash: String(ordinal).repeat(64) };
    for (const phase of POD_PHASES) {
      const input = request(ordinal, phase), response = podNextProvider(state, input); assert.equal(response.status, 200);
      assert.throws(() => podNextProvider(state, input), /never regenerate/);
      assert.equal(podNextProvider(state, { method: 'GET', phase, url: `https://openrouter.ai/api/v1/generation?id=${response.body.id}` }).body.data.id, response.body.id);
      if (phase === 'review') outputs.push(JSON.parse(response.body.choices[0].message.content).outcome);
    }
  }
  assert.deepEqual(outputs, ['INSUFFICIENT_EVIDENCE', 'HYPOTHESIS_TO_TEST']);
  assert.equal(state.r12.calls.length, 10); assert.equal(state.r12.receipts.length, 10);
  const searches = state.r12.calls.filter(call => call.phase === 'search1'); assert.notEqual(searches[0].query, searches[1].query);
  state.r12.podPass = { ordinal: 2, actionHash: '2'.repeat(64) }; assert.throws(() => podNextProvider(state, request(1, 'plan')), /real admitted/);
});
