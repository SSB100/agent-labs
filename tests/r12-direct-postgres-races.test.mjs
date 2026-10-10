import test from 'node:test';
import assert from 'node:assert/strict';
import {DIRECT_RACE_MIGRATION_CUTOFF, directRaceMigrationFiles,
  validateDirectRaceEnvironment, exerciseDirectPostgresRaces} from './helpers/r12-direct-postgres-races.mjs';

test('direct race gate refuses remote, unrequested, non-test and inherited-options targets without a PGlite fallback', () => {
  const valid = {R12_REQUIRE_POSTGRES: '1', R12_SQL_TEST_HOST: '/tmp/inert-r12-host',
    R12_POSTGRES_URL: 'postgresql://r12_test:inert@127.0.0.1:55417/r12_test'};
  assert.equal(validateDirectRaceEnvironment(valid).address, '127.0.0.1');
  for (const change of [{R12_REQUIRE_POSTGRES: '0'}, {R12_REQUIRE_POSTGRES: undefined}, {R12_SQL_TEST_HOST: ''},
    {PGOPTIONS: '-c role=postgres'}, {PGSERVICE: 'production'}, {PGSERVICEFILE: '/tmp/config'},
    {R12_POSTGRES_URL: 'postgresql://r12_test:inert@production.example/r12_test'},
    {R12_POSTGRES_URL: 'postgresql://postgres:inert@127.0.0.1/r12_test'},
    {R12_POSTGRES_URL: 'postgresql://r12_test:inert@127.0.0.1/production'},
    {R12_POSTGRES_URL: 'postgresql://r12_test:inert@127.0.0.1/r12_test?options=bad'},
    {R12_POSTGRES_URL: 'postgresql://r12_test:inert@127.0.0.1/r12_test#extra'},
    {R12_POSTGRES_URL: 'https://127.0.0.1/r12_test'}, {R12_POSTGRES_URL: undefined}]) {
    assert.throws(() => validateDirectRaceEnvironment({...valid, ...change}));
  }
});

test('direct bootstrap race slice includes authority and excludes the in-flight controller', () => {
  assert.equal(DIRECT_RACE_MIGRATION_CUTOFF, '20261010120430');
  assert.deepEqual(directRaceMigrationFiles(['20261010120600_r12_direct_phase_controller.sql',
    '20261010120430_later_renewal.sql', '20261010120406_r12_direct_research_authority.sql',
    'notes.sql', '20261010115441_r12_direct_browser_accounting.sql', '20261010120300_r12_direct_origin_history.sql']),
  ['20261010115441_r12_direct_browser_accounting.sql', '20261010120300_r12_direct_origin_history.sql',
    '20261010120406_r12_direct_research_authority.sql', '20261010120430_later_renewal.sql']);
});

const requested = process.env.R12_REQUIRE_POSTGRES === '1' || process.env.R12_DIRECT_RACES === '1'
  || Boolean(process.env.R12_POSTGRES_URL);
test('native PostgreSQL serializes direct owner confirmation, Stop, finite browser reservations and reconciliation', {
  skip: requested ? false : 'Native PostgreSQL not requested; no race evidence is claimed from PGlite', timeout: 900000,
}, async () => {
  const report = await exerciseDirectPostgresRaces();
  assert.equal(report.engine, 'postgresql'); assert.equal(report.passed, true);
  assert.equal(report.races.length, 16);
  assert.equal(new Set(report.races.map(race => race.name)).size, 16);
  assert.ok(report.races.every(race => race.observedLockWait));
  assert.equal(report.races.filter(race => race.fixtureKind === 'genuine-owner-authority').length, 10);
  assert.equal(report.races.filter(race => race.fixtureKind === 'accounting-only').length, 6);
  assert.equal(report.autocommitConfirmations.length, 4);
  assert.ok(report.autocommitConfirmations.every(proof => proof.role === 'authenticated' && proof.confirmed));
  assert.equal(report.inertHistoryCalls, 110);
  assert.equal(report.providerCalls, 0); assert.equal(report.transportHttpCalls, 0);
  console.log('Direct PostgreSQL bootstrap/accounting race qualification:', JSON.stringify(report));
});
