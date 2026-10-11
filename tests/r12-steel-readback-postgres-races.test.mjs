import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSteelReadbackRaceEnvironment,readbackMigrations,exerciseSteelReadbackPostgresRaces} from './helpers/r12-steel-readback-postgres-races.mjs';
test('one-shot native metadata gate requires the final migration and a constrained isolated PostgreSQL target',()=>{
 const valid={R12_REQUIRE_POSTGRES:'1',R12_SQL_TEST_HOST:'/tmp/inert-host',R12_POSTGRES_URL:'postgresql://r12_test:inert@127.0.0.1:55417/r12_test'};assert.equal(validateSteelReadbackRaceEnvironment(valid).address,'127.0.0.1');
 for(const changed of [{R12_REQUIRE_POSTGRES:'0'},{R12_SQL_TEST_HOST:''},{R12_POSTGRES_URL:'postgresql://r12_test:inert@production.example/r12_test'},{R12_POSTGRES_URL:'postgresql://postgres:inert@127.0.0.1:55417/production'},{PGOPTIONS:'-c role=postgres'},{PGSERVICE:'production'}])assert.throws(()=>validateSteelReadbackRaceEnvironment({...valid,...changed}));
 assert.deepEqual(readbackMigrations(['20261010121400_metadata.sql','20261010230616_authorization.sql.wip','20261010230616_authorization.sql','20261010230617_future.sql']),['20261010121400_metadata.sql','20261010230616_authorization.sql']);
});
const requested=process.env.R12_REQUIRE_POSTGRES==='1'||Boolean(process.env.R12_POSTGRES_URL);
test('native metadata claim, cancellation, proof and revocation share positively observed Business and root-key locks',{skip:requested?false:'Native PostgreSQL not requested; PGlite is not race evidence',timeout:240000},async()=>{
 const result=await exerciseSteelReadbackPostgresRaces();assert.equal(result.passed,true);assert.equal(result.engine,'postgresql');assert.equal(result.races.length,34);assert.ok(result.races.every(r=>r.observedLockWait));assert.equal(result.providerCalls,0);assert.equal(result.externalCalls,0);console.log('Historical and one-shot native metadata race qualification:',JSON.stringify(result));
});
