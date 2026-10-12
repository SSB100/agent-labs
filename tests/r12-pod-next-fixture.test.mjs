// Socket-free preflight only. Hosted/browser acceptance is a separate CI runner.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, createHmac } from 'node:crypto';
import { seedPodNextDatabase, podNextProvider, assertPodLeaseQuiet, podSafeRpcError } from './next-fixture/r12-pod-boundary.mjs';
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
  assert.match(journey, /const deadline = Date\.now\(\) \+ 180000/); assert.match(journey, /assertPodLeaseQuiet\(boundary\.logs, leaseHandoff\)/);
  assert.match(journey, /current\(\)\.calls\.length, leaseHandoff\.providerCalls/); assert.match(journey, /resumed\.at >= expiry/);
  const boundary = readFileSync(new URL('./next-fixture/r12-pod-boundary.mjs', import.meta.url), 'utf8');
  assert.match(boundary, /leaseExpiresAt: data\?\.head\?\.leaseExpiresAt/);
  assert.doesNotMatch(boundary, /(?:update|set)\s+[^;\n]*lease_expires_at/i);
});
test('POD lease handoff observer rejects work or premature host retries until the real saved expiry', () => {
  const at = 100000, expiry = at + 60000;
  const handoff = { kind: 'actual-workflow-controller-snapshot', at, leaseExpiresAt: new Date(expiry).toISOString(), runtimeReadOrdinal: 2, providerCalls: 6, receipts: 6 };
  const before = { kind: 'inert-pod-provider', at: at - 1, method: 'POST', phase: 'plan' };
  const resumed = { kind: 'actual-workflow-runtime-read', at: expiry, runtimeReadOrdinal: 3 };
  assert.doesNotThrow(() => assertPodLeaseQuiet([before, handoff, resumed, { kind: 'inert-pod-provider', at: expiry + 1, method: 'POST', phase: 'search1' }], handoff));
  for (const event of [
    { kind: 'inert-pod-provider', method: 'POST' },
    { kind: 'actual-workflow-controller-call', operation: 'claim' },
    { kind: 'actual-workflow-controller-call', operation: 'cancel' },
    { kind: 'actual-workflow-runtime-read', runtimeReadOrdinal: 3 },
    { kind: 'actual-workflow-pass', operation: 'admit' },
  ]) assert.throws(() => assertPodLeaseQuiet([before, handoff, { ...event, at: expiry - 1 }], handoff), /neither claim nor send/);
  assert.throws(() => assertPodLeaseQuiet([], handoff), /real controller snapshot/);
  const expired = { ...handoff, at: expiry }; assert.throws(() => assertPodLeaseQuiet([expired], expired), /real controller snapshot/);
});
test('POD runtime diagnostics retain exact symbolic SQL failure without raw keys, arguments or database detail', () => {
  assert.deepEqual(podSafeRpcError({ code: '42501', message: 'r07_lease_held', detail: 'must never be persisted' }), { code: '42501', reason: 'r07_lease_held' });
  for (const message of [R12_INERT_ROOT, 'r07_lease_held: p_server_key=private', 'f'.repeat(64), 'select private_key from secret']) {
    const diagnostic = podSafeRpcError({ code: 'not-a-code', message, detail: R12_INERT_ROOT, parameters: { p_server_key: R12_INERT_ROOT } });
    assert.deepEqual(diagnostic, { code: null, reason: 'redacted_database_error' });
    assert.ok(!JSON.stringify(diagnostic).includes(R12_INERT_ROOT));
  }
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
