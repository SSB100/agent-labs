import test from 'node:test';
import assert from 'node:assert/strict';
import {validateOwnerEpisodeRaceEnvironment,exerciseOwnerEpisodePostgresRaces} from './helpers/r12-owner-episode-postgres-races.mjs';
test('Owner episode race gate rejects PGlite, remote and inherited database options',()=>{
 const valid={R12_REQUIRE_POSTGRES:'1',R12_SQL_TEST_HOST:'/tmp/inert-r12-host',R12_POSTGRES_URL:'postgresql://r12_test:inert@127.0.0.1:55417/r12_test'};
 assert.equal(validateOwnerEpisodeRaceEnvironment(valid).address,'127.0.0.1');
 for(const change of [{R12_REQUIRE_POSTGRES:'0'},{PGOPTIONS:'-c role=postgres'},{PGSERVICE:'production'},{R12_POSTGRES_URL:'postgresql://r12_test:x@production.example/r12_test'},{R12_POSTGRES_URL:'postgresql://postgres:x@127.0.0.1/r12_test'}])assert.throws(()=>validateOwnerEpisodeRaceEnvironment({...valid,...change}));
});
const requested=process.env.R12_REQUIRE_POSTGRES==='1'||process.env.R12_OWNER_EPISODE_RACES==='1'||Boolean(process.env.R12_POSTGRES_URL);
test('Actual PostgreSQL serializes episode confirmation, Stop, stale closure and finite allocation',{
 skip:requested?false:'Native PostgreSQL unavailable; PGlite is not race evidence',timeout:120000,
},async()=>{const report=await exerciseOwnerEpisodePostgresRaces();assert.equal(report.passed,true);assert.equal(report.races.length,11);assert.ok(report.races.every(r=>r.observedLockWait));assert.equal(report.providerCalls,0);assert.equal(report.transportHttpCalls,0);console.log('Owner episode PostgreSQL races:',JSON.stringify(report));});
