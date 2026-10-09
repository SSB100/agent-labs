import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { r04SqlBootstrap } from './helpers/r04-sql-bootstrap.mjs';
import { sessionBootstrap } from './helpers/r10-sql-fixture.mjs';
import { ownerInitialSqlFixture, ownerInitialRpc, OWNER_BOOTSTRAP_KEY, sha, one } from './helpers/r12-owner-initial-sql-fixture.mjs';
import { r12QuoteFixture } from './helpers/r12-provider-fixture.mjs';
import { discoveryV2Hash } from '../.core-tests/products/discovery-v2.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = process.env.R12_SQL_TEST_HOST ?? process.env.R11_SQL_TEST_HOST;

// Independent adversarial qualification. Private records below are synthetic
// test enrollment only; this test creates no live grant, network call or charge.
test('owner-initial capability, current-owner, immutable registry, exact-purpose and cumulative renewal boundaries', { skip: !host, timeout: 120000 }, async () => {
  const require = createRequire(path.resolve(host, 'package.json'));
  const { PGlite } = require('@electric-sql/pglite');
  const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec(r04SqlBootstrap + sessionBootstrap);
    for (const file of readdirSync(root + '/supabase/migrations').filter(file => file.endsWith('.sql')).sort()) {
      await db.exec(readFileSync(root + '/supabase/migrations/' + file, 'utf8'));
    }
    const f = await ownerInitialSqlFixture(db, { maximumScopes: 2 });
    const count = async table => (await one(db, `select count(*)::int n from private.${table} where business_id=$1`, [f.businessId])).n;
    const preparePayload = input => ({ input, quote: r12QuoteFixture() });
    const newGoal = async objective => {
      const content = { ...structuredClone(f.content), originalIntent: objective, objective };
      const saved = await f.rpc('r04_quest_transition', [f.businessId, 'quest.save', { goalId: null, expectedRevision: 0, content }, randomUUID()]);
      await f.rpc('r04_quest_transition', [f.businessId, 'quest.preference', { goalId: saved.id, expectedRevision: 1, preference: 'ready' }, randomUUID()]);
      return saved.id;
    };
    const inputFor = (goalId, changes = {}) => ({ ...f.input, goalId, submissionId: randomUUID(), ...changes });

    // Registry/table ownership is never delegated to any application role.
    const acl = await db.query(`select n.nspname,c.relname,role,
      has_table_privilege(role,c.oid,'SELECT,INSERT,UPDATE,DELETE') allowed
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      cross join unnest(array['anon','authenticated','service_role']) role
      where n.nspname='private' and c.relkind='r' and c.relname like 'r12_owner_%'`);
    assert.ok(acl.rows.length >= 30);
    assert.ok(acl.rows.every(row => row.allowed === false), 'application roles must not access private owner registry tables');
    const helpers = await db.query(`select p.proname,role,has_function_privilege(role,p.oid,'EXECUTE') allowed
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      cross join unnest(array['anon','authenticated','service_role']) role
      where n.nspname='private' and p.proname like 'r12_owner_%'`);
    assert.ok(helpers.rows.length > 0);
    assert.ok(helpers.rows.every(row => row.allowed === false), 'private helpers must not be an authority-bypass API');
    await assert.rejects(db.query('update private.r12_owner_grant_roots set maximum_scopes=100 where id=$1', [f.rootId]), /immutable/);

    for (const key of ['', 'wrong-capability-that-is-deliberately-long-enough', null]) {
      await assert.rejects(f.server('prepare', preparePayload(inputFor(f.goalId)), key), /bootstrap_capability/);
    }
    const outsider = randomUUID();
    await db.query('insert into auth.users(id,email) values($1,$2)', [outsider, outsider + '@example.invalid']);
    await assert.rejects(ownerInitialRpc(db, outsider, 'r12_owner_research_read', [f.businessId, f.goalId, null]), /owner_required/);
    await assert.rejects(ownerInitialRpc(db, outsider, 'r12_owner_research_server', [f.businessId, 'prepare', preparePayload(inputFor(f.goalId)), OWNER_BOOTSTRAP_KEY]), /owner_required/);
    const forged = inputFor(f.goalId, { profileHash: '9'.repeat(64) });
    await assert.rejects(f.server('prepare', preparePayload(forged)), /profile_changed/);
    await assert.rejects(f.server('prepare', preparePayload(inputFor(f.goalId, { sourceReviews: [] }))), /keys|fields|shape/);
    assert.equal(await count('r12_owner_setups'), 0);
    assert.equal(await count('r12_discovery_authorities'), 0);

    const firstPayload = preparePayload(inputFor(f.goalId));
    const first = await f.server('prepare', firstPayload);
    assert.equal(first.activated, false);
    assert.equal((await f.server('prepare', firstPayload)).setupId, first.setupId);
    await assert.rejects(f.server('prepare', { ...firstPayload, input: { ...firstPayload.input, topicKey: 'gardening' } }), /idempotency/);
    const confirmation = f.confirmPayload(first);
    await assert.rejects(f.server('confirm', confirmation, ''), /bootstrap_capability/);
    await assert.rejects(f.server(null, confirmation, ''));
    await assert.rejects(f.server('confirm', { ...confirmation, controllerKeyHash: confirmation.admissionKeyHash }), /separate_keys/);
    assert.equal(await count('r12_discovery_authorities'), 0);
    assert.equal((await one(db, 'select count(*)::int n from private.r05_confirmations where business_id=$1', [f.businessId])).n, 0);
    const activated = await f.server('confirm', confirmation);
    assert.equal(activated.activated, true);
    assert.equal(activated.confirmed, true);
    assert.equal((await f.server('confirm', confirmation)).scopeId, activated.scopeId);

    // Neither a changed topic on the same canonical Goal nor a fresh Goal ID
    // for the exact same purpose can reset the one-initial-episode boundary.
    await assert.rejects(f.server('prepare', preparePayload(inputFor(f.goalId, { topicKey: 'gardening' }))), /initial_run_already_exists/);
    const duplicateGoal = await newGoal(f.content.objective);
    await assert.rejects(f.server('prepare', preparePayload(inputFor(duplicateGoal))), /exact_purpose_already_used/);
    const secondGoal = await newGoal('Investigate original gardening T-shirt opportunities for adult gardeners using bounded public evidence.');
    const second = await f.server('prepare', preparePayload(inputFor(secondGoal, { topicKey: 'gardening' })));
    const secondActive = await f.server('confirm', f.confirmPayload(second));
    assert.equal(secondActive.activated, true);
    assert.equal(second.preview.funding.binding.bindingId, first.preview.funding.binding.bindingId);
    assert.equal(second.preview.funding.binding.authorityRootId, f.businessId);
    assert.equal((await one(db, 'select count(*)::int n from public.product_experiments where business_id=$1', [f.businessId])).n, 0);

    const thirdGoal = await newGoal('Investigate original musician T-shirt opportunities for adult musicians using bounded public evidence.');
    await assert.rejects(f.server('prepare', preparePayload(inputFor(thirdGoal))), /grant_exhausted/);
    const renewedId = randomUUID(), renewedKey = 'inert-renewed-owner-capability-for-security-fixture';
    await db.query(`insert into private.r12_owner_bootstrap_grants
      (id,root_id,business_id,owner_id,profile_id,maximum_scopes,maximum_allocation_microunits,server_key_hash,approval_hash,valid_from,valid_until,business_revision,business_hash)
      values($1,$2,$3,$4,$5,2,8000000,$6,$7,$8,$9,$10,$11)`, [renewedId, f.rootId, f.businessId, f.ownerId, f.profileId, sha(renewedKey), '3'.repeat(64), f.profile.validFrom, f.profile.validUntil, f.businessRevision, f.businessHash]);
    await assert.rejects(f.server('prepare', preparePayload(inputFor(thirdGoal, { grantId: renewedId })), renewedKey), /grant_exhausted/);

    // A separately reviewed different topic/profile and explicit higher
    // cumulative grant may authorize a genuine new Goal, preserving usage.
    const profile = { ...structuredClone(f.profile), id: randomUUID(), title: 'Inert original music apparel profile', topics: [{ key: 'music', label: 'Adult musicians', audience: 'Adult amateur musicians', queryTopic: 'original musical-instrument T-shirt purchase criteria' }] };
    await db.query('insert into private.r12_owner_profiles values($1,$2,$3,$4,$5,clock_timestamp())', [profile.id, profile, discoveryV2Hash(profile), f.pins, discoveryV2Hash(f.pins)]);
    const expandedId = randomUUID(), expandedKey = 'inert-expanded-owner-capability-for-security-fixture';
    await db.query(`insert into private.r12_owner_bootstrap_grants
      (id,root_id,business_id,owner_id,profile_id,maximum_scopes,maximum_allocation_microunits,server_key_hash,approval_hash,valid_from,valid_until,business_revision,business_hash)
      values($1,$2,$3,$4,$5,3,8000000,$6,$7,$8,$9,$10,$11)`, [expandedId, f.rootId, f.businessId, f.ownerId, profile.id, sha(expandedKey), '4'.repeat(64), profile.validFrom, profile.validUntil, f.businessRevision, f.businessHash]);
    const thirdInput = inputFor(thirdGoal, { profileId: profile.id, profileHash: discoveryV2Hash(profile), topicKey: 'music', grantId: expandedId });
    const third = await f.server('prepare', preparePayload(thirdInput), expandedKey);
    const thirdActive = await f.server('confirm', f.confirmPayload(third), expandedKey);
    assert.equal(thirdActive.activated, true);
    assert.equal(third.preview.funding.binding.bindingId, first.preview.funding.binding.bindingId);
    assert.match(third.preview.approvedQuery, /musical-instrument/);
    assert.equal((await one(db, 'select count(*)::int n from private.r12_owner_activations where grant_root_id=$1', [f.rootId])).n, 3);
    assert.equal((await one(db, 'select maximum_scopes from private.r12_owner_grant_roots where id=$1', [f.rootId])).maximum_scopes, 2);
    await assert.rejects(f.server('prepare', preparePayload({ ...thirdInput, goalId: f.goalId, submissionId: randomUUID() }), expandedKey), /initial_run_already_exists/);

    // Generic profile proof cannot be reused for newly prohibited Business
    // activity. A new review must pin the changed Business version explicitly.
    const business = await one(db, 'select content from private.r04_business_versions where business_id=$1 and revision=$2', [f.businessId, f.businessRevision]);
    await f.rpc('r04_quest_transition', [f.businessId, 'business.save', { expectedRevision: f.businessRevision, content: { ...business.content, restrictions: 'No external public search or apparel research may be dispatched.' }, preference: 'setup' }, randomUUID()]);
    const fourthGoal = await newGoal('Investigate another original adult apparel topic after the Business restriction was changed.');
    await assert.rejects(f.server('prepare', preparePayload(inputFor(fourthGoal))), /reviewed_business_changed/);
    assert.equal((await f.read(fourthGoal)).profiles.length, 0);

    await db.query('insert into private.r12_owner_grant_revocations(grant_id,reason) values($1,$2)', [expandedId, 'Synthetic revocation test']);
    await db.query('insert into private.r12_owner_profile_revocations(profile_id,reason) values($1,$2)', [profile.id, 'Synthetic revocation test']);
    await assert.rejects(f.rpc('r12_discovery_scope_read', [f.businessId, third.scopeId]), /scope_binding|profile_unavailable/);
    // Owner Stop works after enrollment and catalog are unavailable, without
    // any bootstrap, controller, admission or provider credential.
    const stopped = await f.server('stop', { setupId: third.setupId, setupHash: third.setupHash, submissionId: randomUUID() }, '');
    assert.equal(stopped.stopped, true);
    assert.equal((await f.read(thirdGoal, third.setupId)).setups[0].stopped, true);
    await assert.rejects(ownerInitialRpc(db, outsider, 'r12_owner_research_server', [f.businessId, 'stop', { setupId: first.setupId, setupHash: first.setupHash, submissionId: randomUUID() }, '']), /owner_required/);
    const oldOwner = f.ownerId;
    await db.query('update public.businesses set owner_user_id=$2 where id=$1', [f.businessId, outsider]);
    await assert.rejects(ownerInitialRpc(db, oldOwner, 'r12_owner_research_read', [f.businessId, first.goalId, first.setupId]), /owner_required/);
    await assert.rejects(ownerInitialRpc(db, outsider, 'r12_owner_research_server', [f.businessId, 'confirm', f.confirmPayload(first), OWNER_BOOTSTRAP_KEY]), /exact_setup/);
    assert.equal(await count('r05_requests'), 0);
    assert.equal(await count('r07_plans'), 0);
  } finally { await db.close(); }
});
