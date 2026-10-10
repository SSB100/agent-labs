import test from 'node:test';
import assert from 'node:assert/strict';
import {validateEnrollmentRaceEnvironment,enrollmentRaceMigrations,exerciseEnrollmentPostgresRaces} from './helpers/r12-direct-enrollment-postgres-races.mjs';
test('enrollment native race gate rejects remote/unrequested databases and excludes later authority',()=>{
 const valid={R12_REQUIRE_POSTGRES:'1',R12_SQL_TEST_HOST:'/tmp/inert-host',R12_POSTGRES_URL:'postgresql://r12_test:inert@127.0.0.1:55417/r12_test'};
 assert.equal(validateEnrollmentRaceEnvironment(valid).address,'127.0.0.1');
 for(const change of [{R12_REQUIRE_POSTGRES:'0'},{R12_POSTGRES_URL:'postgresql://r12_test:inert@production.example/r12_test'},{PGOPTIONS:'-c role=postgres'}])assert.throws(()=>validateEnrollmentRaceEnvironment({...valid,...change}));
 assert.deepEqual(enrollmentRaceMigrations(['20261010121000_enrollment.sql','20261010121200_sonnet.sql','20261010121000_enrollment.sql.wip']),['20261010121000_enrollment.sql']);
});
const requested=process.env.R12_REQUIRE_POSTGRES==='1'||Boolean(process.env.R12_POSTGRES_URL);
test('native enrollment confirmation and review revocation share observed Business/root locks',{skip:requested?false:'Native PostgreSQL is not requested; PGlite is not concurrency evidence',timeout:900000},async()=>{
 const report=await exerciseEnrollmentPostgresRaces();assert.equal(report.engine,'postgresql');assert.equal(report.passed,true);assert.equal(report.authenticatedAutocommit,true);assert.equal(report.races.length,5);assert.ok(report.races.every(x=>x.observedLockWait));assert.equal(report.providerCalls,0);assert.equal(report.externalCalls,0);console.log('Native enrollment race qualification:',JSON.stringify(report));
});
