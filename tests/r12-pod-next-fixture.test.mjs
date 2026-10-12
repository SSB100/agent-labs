// Socket-free preflight only. Hosted/browser acceptance is a separate CI runner.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, createHmac } from 'node:crypto';
import { seedPodNextDatabase } from './next-fixture/r12-pod-boundary.mjs';
import { R12_INERT_ROOT } from './next-fixture/r12-sql.mjs';
import { r12QuoteFixture } from './helpers/r12-provider-fixture.mjs';
import { podRpc } from './helpers/r12-pod-sql-fixture.mjs';
const host = process.env.R12_SQL_TEST_HOST;
test('POD Next runner preserves production actions and Workflow host while blocking external transport', () => {
  const runner = readFileSync(new URL('./next-fixture/r12-pod-runner.mjs', import.meta.url), 'utf8');
  assert.match(runner, /WORKFLOW_TARGET_WORLD:'local'/); assert.match(runner, /WORKFLOW_LOCAL_BASE_URL:origin/);
  assert.match(runner, /block-network\.mjs/); assert.match(runner, /runPodNextJourney/);
  const edited = [...runner.matchAll(/writeFile\(path\.join\(fixture,'([^']+)'\)/g)].map(match => match[1]).sort();
  assert.deepEqual(edited, ['next.config.ts', 'src/lib/supabase/client.ts', 'src/lib/supabase/inert-transport.d.mts', 'src/lib/supabase/proxy.ts', 'src/lib/supabase/server.ts']);
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
    const prepared = await podRpc(db, 'authenticated', seeded.ownerId, 'r12_pod_owner_server', [seeded.businessId, 'prepare', { input: seeded.input, quote: r12QuoteFixture() }, capability]);
    assert.equal(prepared.activated, false); assert.equal(prepared.confirmed, false);
    assert.deepEqual((await db.query('select (select count(*)::int from private.r12_discovery_scopes) scopes,(select count(*)::int from private.r05_requests) requests')).rows[0], { scopes: 0, requests: 0 });
  } finally { await db.close(); }
});
