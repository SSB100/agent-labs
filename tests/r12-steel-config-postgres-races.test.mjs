import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSteelConfigRaceEnvironment,steelConfigRaceMigrations,exerciseSteelConfigPostgresRaces} from './helpers/r12-steel-config-postgres-races.mjs';
test('Steel native gate requires a constrained isolated PostgreSQL target and final successor migration',()=>{
 const valid={R12_REQUIRE_POSTGRES:'1',R12_SQL_TEST_HOST:'/tmp/inert-host',R12_POSTGRES_URL:'postgresql://r12_test:inert@127.0.0.1:55417/r12_test'};
 assert.equal(validateSteelConfigRaceEnvironment(valid).address,'127.0.0.1');
 for(const changed of [{R12_REQUIRE_POSTGRES:'0'},{R12_POSTGRES_URL:'postgresql://r12_test:inert@production.example/r12_test'},{PGOPTIONS:'-c role=postgres'}])assert.throws(()=>validateSteelConfigRaceEnvironment({...valid,...changed}));
 assert.deepEqual(steelConfigRaceMigrations(['20261010121200_sonnet.sql','20261010121300_steel.sql','20261010121300_steel.sql.wip','20261010121400_future.sql']),['20261010121200_sonnet.sql','20261010121300_steel.sql']);
});
const requested=process.env.R12_REQUIRE_POSTGRES==='1'||Boolean(process.env.R12_POSTGRES_URL);
test('native Steel config revocation and once-only create share observed Business locks',{skip:requested?false:'Native PostgreSQL is not requested; PGlite is not concurrency evidence',timeout:900000},async()=>{
 const result=await exerciseSteelConfigPostgresRaces();assert.equal(result.engine,'postgresql');assert.equal(result.passed,true);assert.equal(result.races.length,3);assert.ok(result.races.every(r=>r.observedLockWait));assert.equal(result.externalCalls,0);assert.equal(result.providerCalls,0);console.log('Native Steel config race qualification:',JSON.stringify(result));
});
