/** Native PostgreSQL sessions only. Genuine owner confirmations and separately
 * labeled synthetic accounting-only contenders share real Business/root locks.
 * No live provider, external HTTP, PGlite substitute, or database reset. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync, readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {r04SqlBootstrap} from './r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './r10-sql-fixture.mjs';
import {asRole, orderedRace, validateOwnerInitialRaceEnvironment} from './r12-owner-initial-postgres-races.mjs';
import {one} from './r12-owner-initial-sql-fixture.mjs';
import {prepareDirectTestAuthorityFixture} from './r12-direct-test-authority-fixture.mjs';
import {bindDirectHandoffFixture} from './r12-direct-approved-setup-fixture.mjs';
import {prepareDirectBrowserLedgerFixture} from './r12-direct-browser-ledger-fixture.mjs';
import {discoveryV2Hash as hash} from '../../.core-tests/products/discovery-v2.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const validateDirectRaceEnvironment = validateOwnerInitialRaceEnvironment;
// The direct phase controller is qualified separately. Never import an
// in-progress later migration accidentally just because it exists on disk.
export const DIRECT_RACE_MIGRATION_CUTOFF = '20261010120430';
export const directRaceMigrationFiles = files => files.filter(file => /^\d{14}_.+\.sql$/.test(file)
  && file.slice(0, 14) <= DIRECT_RACE_MIGRATION_CUTOFF).sort();
const owner = (db, x, operation, payload) => asRole(db, 'authenticated', 'r12_owner_direct_server',
  [x.f.businessId, operation, payload, operation === 'stop_test' ? '' : x.f.bootstrapKey], x.f.ownerId);
const stopPayload = x => ({...x.confirmPayload, submissionId: randomUUID()});
const grantUsage = async (db, f) => (await one(db, 'select private.r12_direct_grant_usage($1) value', [f.rootId])).value;

async function retainedHistory(db, f) {
  return one(db, `select
    private.r12_direct_origin_snapshot($1,$2,coalesce((select max(version) from private.r07_plans where business_id=$1 and goal_id=$2),0)) origin,
    (select coalesce(jsonb_agg(to_jsonb(h) order by h.goal_id),'[]') from private.r07_heads h where h.business_id=$1) heads,
    (select coalesce(jsonb_agg(to_jsonb(a) order by a.setup_id),'[]') from private.r12_owner_activations a where a.grant_root_id=$3) allocations,
    (select to_jsonb(g) from private.r12_owner_grant_roots g where g.id=$3) grant_root,
    (select coalesce(jsonb_agg(to_jsonb(v) order by v.revision),'[]') from private.r04_goal_versions v where v.business_id=$1 and v.goal_id=$2) goal_versions,
    (select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]') from public.product_experiments e where e.business_id=$1) legacy_experiments`,
  [f.businessId, f.goalId, f.rootId]);
}
async function authorityCounts(db, f) {
  return one(db, `select
    (select count(*)::int from private.r12_direct_test_envelopes where business_id=$1) envelopes,
    (select count(*)::int from private.r12_direct_test_confirmations where grant_root_id=$2) confirmations,
    (select count(*)::int from private.r12_direct_origin_freezes where business_id=$1) freezes,
    (select count(*)::int from private.r05_policies where business_id=$1) policies,
    (select count(*)::int from private.r05_confirmations where business_id=$1) policy_confirmations,
    (select count(*)::int from private.r05_cap_versions where business_id=$1) caps,
    (select count(*)::int from private.r12_owner_funding_revisions where binding_id=$3) funding_revisions,
    (select count(*)::int from private.r12_etsy_steel_keys k join private.r12_direct_test_envelopes e on e.id=k.envelope_id where e.business_id=$1) handoff_keys,
    (select count(*)::int from private.r12_direct_browser_evidence_keys k join private.r12_direct_test_envelopes e on e.id=k.envelope_id where e.business_id=$1) evidence_keys`,
  [f.businessId, f.rootId, f.bindingId]);
}
async function accountingCounts(db, envelopeId) {
  return one(db, `select
    (select count(*)::int from private.r12_direct_browser_operations where envelope_id=$1) operations,
    (select count(*)::int from private.r12_direct_request_bindings where envelope_id=$1) bindings,
    (select count(*)::int from private.r05_reservations r join private.r12_direct_request_bindings m using(request_id) where m.envelope_id=$1) reservations,
    (select count(*)::int from private.r05_markers r join private.r12_direct_request_bindings m using(request_id) where m.envelope_id=$1) markers,
    (select count(*)::int from private.r12_direct_browser_accounting a join private.r12_direct_browser_operations o on o.id=a.operation_id where o.envelope_id=$1) accounting,
    (select count(*)::int from private.r12_etsy_steel_dispatches d join private.r12_etsy_steel_setups s using(operation_id) where s.envelope_id=$1) steel_dispatches`, [envelopeId]);
}
async function assertOneAuthority(db, x, before, usageBefore) {
  const changed = Number(x.input.capProposal.business.proposedLimitMicrounits) !== Number(x.funding.business.currentLimitMicrounits);
  const rootChanged = x.funding.bindingKind === 'legacy_research_root'
    && Number(x.input.capProposal.root.proposedLimitMicrounits) > Number(x.funding.root.currentLimitMicrounits);
  assert.deepEqual(await authorityCounts(db, x.f), {...before, envelopes: 1, confirmations: 1, freezes: 1,
    policies: before.policies + 1, policy_confirmations: before.policy_confirmations + 1,
    caps: before.caps + Number(changed), funding_revisions: before.funding_revisions + Number(rootChanged),
    handoff_keys: 3, evidence_keys: 1});
  assert.deepEqual(await grantUsage(db, x.f), {scopes: usageBefore.scopes + 1,
    allocationMicrounits: String(BigInt(usageBefore.allocationMicrounits) + BigInt(x.input.maximumRunMicrounits))});
  for (const purpose of ['handoff', 'verification', 'cleanup', 'evidence']) {
    const table = purpose === 'evidence' ? 'r12_direct_browser_evidence_keys' : 'r12_etsy_steel_keys';
    assert.equal((await one(db, `select count(*)::int n from private.${table} where envelope_id=$1 and key_hash=$2`,
      [x.prepared.testEnvelopeId, x.sha(await x.key(purpose))])).n, 1);
  }
}

/** No explicit transaction and no role reset before the confirmation statement
 * commits. This catches guards which work only inside a SECURITY DEFINER frame
 * or when a race helper restores the privileged role before COMMIT. */
async function authenticatedAutocommitConfirmation(db, x) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [x.f.ownerId]);
  await db.query('set role authenticated');
  try {
    assert.equal((await one(db, 'select current_user actor')).actor, 'authenticated');
    const result = (await one(db, 'select public.r12_owner_direct_server($1,$2,$3,$4) value',
      [x.f.businessId, 'confirm_test', x.confirmPayload, x.f.bootstrapKey])).value;
    assert.equal((await one(db, 'select current_user actor')).actor, 'authenticated');
    assert.equal(result.confirmed, true);
    return result;
  } finally {
    await db.query('reset role');
  }
}

const ledger = (db, x, a, operation, payload) => asRole(db, 'anon', 'r12_direct_browser_ledger',
  [x.f.businessId, a.operationId, operation, payload, x.key]);
const reconcilePayload = (a, billingProofHash = null) => ({releaseProofHash: a.releaseHash,
  usageProofHash: a.usageHash, billingProofHash});
const register = async (db, x, a) => (await one(db,
  'select private.r12_direct_browser_register($1,$2,$3,$4,$5,$6,$7) value',
  [x.id, a.operationId, a.requestId, 'owner_setup', a.scope, a.scope.quoteHash, x.routeHash])).value;

/** Accounting-only fixture: register and qualify one real R05 hold in the
 * winning transaction. Thus the loser is rejected for finite envelope headroom,
 * not merely because the winner still has an unknown/unreconciled cost. */
async function registerBoundedAccounting(db, x, a) {
  const reservation = await register(db, x, a);
  const session = await ledger(db, x, a, 'bind_session', {sessionId: a.operationId,
    providerProjectId: x.project, providerAccountHash: hash({account: 'inert'})});
  const receiptBody = {version: 'etsy.steel-owner-handoff-receipt.1', operationId: a.operationId,
    scopeHash: hash(a.scope), handoffId: null, status: 'failed', reason: 'inert_accounting_fixture',
    releaseState: 'verified', liabilityState: 'receipt_required', reservationId: reservation.reservationId,
    reservationHash: reservation.reservationHash, profileBindingId: null, profileBindingRevision: null,
    accountIdentityVerified: false, insightsAccessVerified: false};
  await ledger(db, x, a, 'receipt', {...receiptBody, receiptHash: hash(receiptBody)});
  const base = {operationId: a.operationId, sessionId: a.operationId, providerProjectId: x.project};
  const providerReadbackHash = hash({operationId: a.operationId, providerStatus: 'released', durationMs: 1000});
  const release = await ledger(db, x, a, 'evidence', {kind: 'release', providerRecordId: randomUUID(),
    content: {...base, terminal: true, observersDisposed: true, providerStatus: 'released',
      providerReadbackHash, disposalProofHash: hash({operationId: a.operationId, disposed: true})}});
  const usage = await ledger(db, x, a, 'evidence', {kind: 'usage_bound', providerRecordId: randomUUID(),
    content: {...base, usageIdentityHash: session.usageIdentityHash, tariffHash: x.tariffHash,
      qualificationHash: x.qualificationHash, withinQualifiedLimits: true, maximumMicrounits: '1000',
      requestedTimeoutMs: 60000, providerTimeoutMs: 60000, durationMs: 1000, proxyBytesUsed: 0,
      proxySource: null, solveCaptcha: false, extraServicesDisabled: true, providerReadbackHash}});
  const reconciled = await ledger(db, x, a, 'reconcile', {releaseProofHash: release.evidenceHash,
    usageProofHash: usage.evidenceHash, billingProofHash: null});
  assert.equal(reconciled.accounting.status, 'qualified_bounded_pending');
  return reservation;
}
async function assertAccountingExposure(db, x, {actual, pending, legacy}) {
  const exposure = await x.exposure();
  assert.equal(exposure.knownActualMicrounits, String(actual));
  assert.equal(exposure.boundedPendingMicrounits, String(pending));
  assert.equal(exposure.committedMicrounits, String(actual + pending));
  assert.equal(exposure.hasUnknownOrUnbounded, false);
  const business = await one(db, 'select coalesce(sum(held),0)::text held,coalesce(bool_or(unknown),false) unknown from private.r12_direct_exposure($1)', [x.f.businessId]);
  assert.deepEqual(business, {held: String((legacy ? 1900000 : 0) + actual + pending), unknown: false});
  if (legacy) {
    const historical = (await one(db, 'select private.stage13v2_budget_authority($1,false) value', [x.root])).value;
    assert.equal(historical.knownActualMicrousd, 1900000 + actual);
    assert.equal(historical.pendingExposureMicrousd, pending);
    assert.equal(historical.committedMicrousd, 1900000 + actual + pending);
    assert.equal(historical.hasUncertainCosts, pending > 0);
    assert.equal(Number((await one(db, 'select private.stage13v2_funded_ceiling($1) value', [x.root])).value), 2000000);
  }
}

export async function exerciseDirectPostgresRaces(env = process.env) {
  const target = validateDirectRaceEnvironment(env);
  const require = createRequire(path.resolve(target.host, 'package.json'));
  assert.equal(require('pg/package.json').version, '8.16.3', 'Pinned native pg client required');
  const {Client} = require('pg');
  const clients = ['observer', 'holder', 'waiter'].map(label => new Client({connectionString: target.url,
    ssl: false, application_name: 'r12-direct-races-' + label, connectionTimeoutMillis: 5000}));
  const [db, holder, waiter] = clients, connected = new Set(), races = [], autocommitConfirmations = [];
  const originalFetch = globalThis.fetch;
  let transportHttpCalls = 0, completedHistoryFixtures = 0;
  globalThis.fetch = async () => { transportHttpCalls++; throw Error('External HTTP is forbidden in direct PostgreSQL races'); };
  const race = actions => orderedRace({observer: db, holder, waiter, ...actions});
  const record = (name, result, fixtureKind) => {
    assert.equal(result.observedLockWait, true);
    races.push({name, fixtureKind, observedLockWait: true, waitEvent: result.waitEvent});
  };
  const authority = async legacy => {
    const x = await prepareDirectTestAuthorityFixture(db, {legacy});
    completedHistoryFixtures++;
    return x;
  };
  try {
    for (const client of clients) {
      await client.connect(); connected.add(client); client.exec = sql => client.query(sql);
      await client.query("set timezone='UTC'");
      assert.deepEqual(await one(client, 'select current_user actor,current_database() db,host(inet_server_addr()) address'),
        {actor: 'r12_test', db: 'r12_test', address: target.address});
    }
    assert.equal((await one(db, "select count(*)::int n from pg_tables where schemaname in ('public','private')")).n,
      0, 'Refuse nonempty database; use the existing guarded reset before the native suite');
    assert.deepEqual((await db.query("select rolname from pg_roles where rolname in ('anon','authenticated','service_role')")).rows,
      [], 'Fresh synthetic API roles required');
    await db.exec(r04SqlBootstrap + sessionBootstrap);
    const files = directRaceMigrationFiles(readdirSync(root + '/supabase/migrations'));
    assert.ok(files.some(file => file.startsWith(DIRECT_RACE_MIGRATION_CUTOFF + '_')), 'Required authority migration missing');
    for (const file of files) await db.exec(readFileSync(root + '/supabase/migrations/' + file, 'utf8'));
    assert.deepEqual(await one(db, `select
      has_function_privilege('authenticated','public.r12_owner_direct_server(uuid,text,jsonb,text)','execute') owner_confirm,
      has_function_privilege('anon','public.r12_owner_direct_server(uuid,text,jsonb,text)','execute') anonymous_confirm,
      has_function_privilege('anon','public.r12_direct_browser_ledger(uuid,uuid,text,jsonb,text)','execute') evidence_bridge,
      has_function_privilege('authenticated','private.r12_direct_browser_register(uuid,uuid,uuid,text,jsonb,text,text)','execute') private_register,
      has_table_privilege('authenticated','private.r12_direct_test_confirmations','insert') private_confirm`),
    {owner_confirm: true, anonymous_confirm: false, evidence_bridge: true, private_register: false, private_confirm: false});

    for (const kind of ['native', 'legacy']) {
      const legacy = kind === 'legacy' ? {committedMicrounits: 1900000} : null;
      // Two exact owner submissions must return the same immutable receipt.
      const exact = await authority(legacy), exactBefore = await authorityCounts(db, exact.f);
      const exactUsage = await grantUsage(db, exact.f), exactHistory = await retainedHistory(db, exact.f);
      const duplicate = await race({first: c => owner(c, exact, 'confirm_test', exact.confirmPayload),
        second: c => owner(c, exact, 'confirm_test', exact.confirmPayload)});
      assert.equal(duplicate.first.confirmed, true); assert.equal(duplicate.second.error, undefined);
      assert.deepEqual(duplicate.second.value, duplicate.first);
      await assertOneAuthority(db, exact, exactBefore, exactUsage);
      assert.deepEqual(await retainedHistory(db, exact.f), exactHistory);
      assert.deepEqual(await accountingCounts(db, exact.prepared.testEnvelopeId),
        {operations: 0, bindings: 0, reservations: 0, markers: 0, accounting: 0, steel_dispatches: 0});
      record(kind + '-duplicate-exact-confirmation-one-authority', duplicate, 'genuine-owner-authority');

      // Different immutable drafts consume the same current predecessor once.
      const drafts = await authority(legacy), secondDraft = await drafts.prepare({submissionId: randomUUID()});
      assert.notEqual(secondDraft.testEnvelopeId, drafts.prepared.testEnvelopeId);
      assert.equal(secondDraft.preview.originHash, drafts.prepared.preview.originHash);
      const draftsBefore = await authorityCounts(db, drafts.f), draftsUsage = await grantUsage(db, drafts.f);
      const draftsHistory = await retainedHistory(db, drafts.f);
      const competing = await race({first: c => owner(c, drafts, 'confirm_test', drafts.confirmPayload),
        second: c => owner(c, drafts, 'confirm_test', {testEnvelopeId: secondDraft.testEnvelopeId,
          testEnvelopeHash: secondDraft.testEnvelopeHash, submissionId: randomUUID()})});
      assert.equal(competing.first.confirmed, true);
      assert.match(competing.second.error?.message ?? '', /r12_direct_(stale_financial_snapshot|grant_exhausted|origin_current_predecessor_required|origin_or_lifetime_bound)/);
      await assertOneAuthority(db, drafts, draftsBefore, draftsUsage);
      assert.deepEqual(await retainedHistory(db, drafts.f), draftsHistory);
      assert.equal((await one(db, 'select count(*)::int n from private.r12_direct_test_drafts where business_id=$1', [drafts.f.businessId])).n, 2);
      assert.equal((await one(db, 'select count(*)::int n from private.r12_direct_test_envelopes where id=$1', [secondDraft.testEnvelopeId])).n, 0);
      record(kind + '-competing-drafts-one-current-origin-confirmation', competing, 'genuine-owner-authority');

      const stopped = await authority(legacy), stoppedBefore = await authorityCounts(db, stopped.f);
      const stoppedUsage = await grantUsage(db, stopped.f), stoppedHistory = await retainedHistory(db, stopped.f);
      const stopFirst = await race({first: c => owner(c, stopped, 'stop_test', stopPayload(stopped)),
        second: c => owner(c, stopped, 'confirm_test', stopped.confirmPayload)});
      assert.equal(stopFirst.first.stopped, true); assert.equal(stopFirst.first.confirmed, false);
      assert.match(stopFirst.second.error?.message ?? '', /r12_direct_test_stopped/);
      assert.deepEqual(await authorityCounts(db, stopped.f), stoppedBefore);
      assert.deepEqual(await grantUsage(db, stopped.f), stoppedUsage);
      assert.deepEqual(await retainedHistory(db, stopped.f), stoppedHistory);
      assert.deepEqual(await accountingCounts(db, stopped.prepared.testEnvelopeId),
        {operations: 0, bindings: 0, reservations: 0, markers: 0, accounting: 0, steel_dispatches: 0});
      assert.equal((await one(db, 'select count(*)::int n from private.r12_direct_draft_stops where draft_id=$1', [stopped.prepared.testEnvelopeId])).n, 1);
      record(kind + '-stop-before-confirmation-no-authority', stopFirst, 'genuine-owner-authority');

      // Actual owner-approved setup reservation, with a fresh direct confirmation
      // committed while still authenticated, not under the race admin role.
      for (const stopWins of [true, false]) {
        const x = await authority(legacy), before = await authorityCounts(db, x.f), usageBefore = await grantUsage(db, x.f);
        await authenticatedAutocommitConfirmation(db, x);
        await assertOneAuthority(db, x, before, usageBefore);
        autocommitConfirmations.push({fundingKind: kind, stopWins, role: 'authenticated', confirmed: true});
        const handoff = await bindDirectHandoffFixture(db, x), operation = await handoff.prepare();
        await operation.approve();
        const request = operation.request('create'), payload = stopPayload(x);
        const reserve = c => asRole(c, 'anon', 'r12_etsy_steel_server', [x.f.businessId, 'admit', {request}, handoff.keys.handoff]);
        const stop = c => owner(c, x, 'stop_test', payload);
        const history = await retainedHistory(db, x.f), usage = await grantUsage(db, x.f), counts = await authorityCounts(db, x.f);
        const ordered = await race({first: stopWins ? stop : reserve, second: stopWins ? reserve : stop});
        if (stopWins) {
          assert.equal(ordered.first.stopped, true);
          assert.match(ordered.second.error?.message ?? '', /etsy_handoff_authority_inactive|r12_direct_authority_unavailable/);
        } else {
          assert.ok(ordered.first.reservationId); assert.equal(ordered.second.error, undefined);
          assert.equal(ordered.second.value.stopped, true);
        }
        assert.deepEqual(await authorityCounts(db, x.f), counts);
        assert.deepEqual(await grantUsage(db, x.f), usage, 'Stop never refunds the combined test allocation');
        assert.deepEqual(await retainedHistory(db, x.f), history);
        const admitted = Number(!stopWins);
        assert.deepEqual(await accountingCounts(db, x.prepared.testEnvelopeId),
          {operations: admitted, bindings: admitted, reservations: admitted, markers: admitted, accounting: 0, steel_dispatches: 0});
        assert.equal((await one(db, 'select count(*)::int n from private.r12_direct_test_revocations where envelope_id=$1', [x.prepared.testEnvelopeId])).n, 1);
        assert.equal((await one(db, 'select count(*)::int n from private.r05_revocations where policy_id=$1', [x.prepared.preview.policyId])).n, 1);
        const exposure = (await one(db, 'select private.r12_direct_test_exposure($1) value', [x.prepared.testEnvelopeId])).value;
        assert.equal(exposure.committedMicrounits, String(admitted * 1000));
        assert.equal(exposure.hasUnknownOrUnbounded, !stopWins);
        await assert.rejects(db.query('select private.r12_direct_financial_check($1,0)', [x.prepared.testEnvelopeId]), /authority_unavailable/);
        record(kind + (stopWins ? '-stop-before-reserve-no-spend' : '-reserve-before-stop-preserves-hold'), ordered, 'genuine-owner-authority');
      }

      // The following fixtures exercise accounting concurrency only. They do
      // not claim a genuine direct owner enrollment, profile, or provider run.
      const finite = await prepareDirectBrowserLedgerFixture(db, {maximum: 1500, legacy});
      const first = await finite.createOperation({admit: false}), second = await finite.createOperation({admit: false});
      assert.equal(first.scope.testEnvelopeId, second.scope.testEnvelopeId);
      assert.equal(first.scope.authorityRootId, second.scope.authorityRootId);
      assert.notEqual(first.operationId, second.operationId); assert.notEqual(first.requestId, second.requestId);
      const finiteHistory = await retainedHistory(db, finite.f), finiteUsage = await grantUsage(db, finite.f);
      const headroom = await race({first: c => registerBoundedAccounting(c, finite, first), second: c => register(c, finite, second)});
      assert.equal(headroom.first.shouldDispatch, true);
      assert.equal(headroom.first.reservationId, first.requestId);
      assert.equal((await one(db, 'select count(*)::int n from private.r05_reservations where request_id=$1', [second.requestId])).n, 0);
      assert.match(headroom.second.error?.message ?? '', /r12_direct_test_limit/);
      assert.deepEqual(await accountingCounts(db, finite.id),
        {operations: 1, bindings: 1, reservations: 1, markers: 1, accounting: 1, steel_dispatches: 0});
      await assertAccountingExposure(db, finite, {actual: 0, pending: 1000, legacy});
      await finite.check(500); await assert.rejects(finite.check(501), /test_limit/);
      assert.deepEqual(await retainedHistory(db, finite.f), finiteHistory);
      assert.deepEqual(await grantUsage(db, finite.f), finiteUsage);
      record(kind + '-accounting-only-two-reservations-one-finite-envelope', headroom, 'accounting-only');

      const duplicateLedger = await prepareDirectBrowserLedgerFixture(db, {legacy});
      const a = await duplicateLedger.createOperation(), billing = await a.bill(200);
      const reconcileHistory = await retainedHistory(db, duplicateLedger.f), reconcileUsage = await grantUsage(db, duplicateLedger.f);
      const reconciliation = await race({first: c => ledger(c, duplicateLedger, a, 'reconcile', reconcilePayload(a, billing)),
        second: c => ledger(c, duplicateLedger, a, 'reconcile', reconcilePayload(a, billing))});
      assert.equal(reconciliation.first.accepted, true); assert.equal(reconciliation.first.replayed, false);
      assert.equal(reconciliation.second.error, undefined); assert.equal(reconciliation.second.value.replayed, true);
      assert.deepEqual(reconciliation.second.value.accounting, reconciliation.first.accounting);
      assert.deepEqual(await accountingCounts(db, duplicateLedger.id),
        {operations: 1, bindings: 1, reservations: 1, markers: 1, accounting: 1, steel_dispatches: 0});
      assert.equal((await one(db, 'select count(*)::int n from private.r05_settlements where request_id=$1', [a.requestId])).n, 1);
      await assertAccountingExposure(db, duplicateLedger, {actual: 200, pending: 0, legacy});
      assert.deepEqual(await retainedHistory(db, duplicateLedger.f), reconcileHistory);
      assert.deepEqual(await grantUsage(db, duplicateLedger.f), reconcileUsage);
      record(kind + '-accounting-only-duplicate-reconciliation-one-row', reconciliation, 'accounting-only');

      const lower = await prepareDirectBrowserLedgerFixture(db, {legacy}), lowerOperation = await lower.createOperation();
      const pending = await lowerOperation.reconcile();
      const highBill = await lowerOperation.bill(200), lowBill = await lowerOperation.bill(50);
      const lowerHistory = await retainedHistory(db, lower.f), lowerUsage = await grantUsage(db, lower.f);
      const lateLower = await race({first: c => ledger(c, lower, lowerOperation, 'reconcile', reconcilePayload(lowerOperation, highBill)),
        second: c => ledger(c, lower, lowerOperation, 'reconcile', reconcilePayload(lowerOperation, lowBill))});
      assert.equal(lateLower.first.accounting.actualMicrounits, '200');
      assert.equal(lateLower.second.error, undefined); assert.equal(lateLower.second.value.accounting.actualMicrounits, '50');
      assert.equal(lateLower.first.accounting.previousRecordHash, pending.accounting.recordHash);
      assert.equal(lateLower.second.value.accounting.previousRecordHash, lateLower.first.accounting.recordHash);
      assert.equal(lateLower.second.value.accounting.revision, 3);
      assert.deepEqual(await accountingCounts(db, lower.id),
        {operations: 1, bindings: 1, reservations: 1, markers: 1, accounting: 3, steel_dispatches: 0});
      assert.deepEqual((await one(db, 'select array_agg(actual_microunits::text order by actual_microunits) amounts,max(actual_microunits)::text maximum from private.r05_settlements where request_id=$1', [lowerOperation.requestId])),
        {amounts: ['50', '200'], maximum: '200'});
      await assertAccountingExposure(db, lower, {actual: 200, pending: 0, legacy});
      assert.deepEqual(await retainedHistory(db, lower.f), lowerHistory);
      assert.deepEqual(await grantUsage(db, lower.f), lowerUsage);
      record(kind + '-accounting-only-late-lower-final-cannot-reduce-exposure', lateLower, 'accounting-only');
    }
    assert.equal(transportHttpCalls, 0);
    return {version: 'r12.direct-postgres-races.1', engine: 'postgresql', passed: true,
      migrationCutoff: DIRECT_RACE_MIGRATION_CUTOFF, providerCalls: 0, transportHttpCalls,
      // exerciseOwnerInitialRuntime asserts exactly five inert POST callbacks
      // and six inert receipt callbacks per genuine completed origin fixture.
      inertHistoryCalls: completedHistoryFixtures * 11, autocommitConfirmations, races};
  } finally {
    globalThis.fetch = originalFetch;
    await Promise.all(clients.map(async client => {
      if (connected.has(client)) await client.query('rollback').catch(() => {});
      await client.end().catch(() => {});
    }));
  }
}
