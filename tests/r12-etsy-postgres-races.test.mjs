import test from 'node:test';
import assert from 'node:assert/strict';
import {validateAdaptiveRaceEnvironment,exerciseAdaptivePostgresRaces} from './helpers/r12-adaptive-postgres-races.mjs';
import {prepareFourPlanEtsyFixture} from './helpers/r12-etsy-activation-fixture.mjs';
test('Etsy native race gate rejects production or unconstrained database targets',()=>{
 const valid={R12_REQUIRE_POSTGRES:'1',R12_SQL_TEST_HOST:'/tmp/inert-r12-host',R12_POSTGRES_URL:'postgresql://r12_test:inert@127.0.0.1:55417/r12_test'};
 assert.equal(validateAdaptiveRaceEnvironment(valid).address,'127.0.0.1');
 for(const change of [{R12_REQUIRE_POSTGRES:'0'},{PGOPTIONS:'-c role=postgres'},{R12_POSTGRES_URL:'postgresql://r12_test:x@production.example/r12_test'}])assert.throws(()=>validateAdaptiveRaceEnvironment({...valid,...change}));
});
const requested=process.env.R12_REQUIRE_POSTGRES==='1'||Boolean(process.env.R12_POSTGRES_URL);
test('native PostgreSQL serializes .2 activation, original-root caps, reserve, marker, send and Stop',{
 skip:requested?false:'Native PostgreSQL unavailable; PGlite is not race evidence',timeout:900000,
},async()=>{
 const report=await exerciseAdaptivePostgresRaces(process.env,{prepareFixture:prepareFourPlanEtsyFixture});
 assert.equal(report.passed,true);assert.equal(report.races.length,20);
 assert.ok(report.races.every(r=>r.observedLockWait));assert.equal(report.inertHistoryCalls,280);
 assert.equal(report.liveProviderCalls,0);assert.equal(report.externalHttpAttempts,0);
 console.log('Etsy owner-evidence PostgreSQL races:',JSON.stringify(report));
});
