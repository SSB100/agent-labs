import test from 'node:test';
import assert from 'node:assert/strict';
import {validateOwnerInitialRaceEnvironment,conservativeOwnerRaceQuote,exerciseOwnerInitialPostgresRaces} from './helpers/r12-owner-initial-postgres-races.mjs';

test('Owner-initial native race gate refuses remote/non-test/options targets and never falls back to PGlite',()=>{
 const valid={R12_REQUIRE_POSTGRES:'1',R12_SQL_TEST_HOST:'/tmp/inert-r12-host',R12_POSTGRES_URL:'postgresql://r12_test:inert@127.0.0.1:55417/r12_test'};
 assert.equal(validateOwnerInitialRaceEnvironment(valid).address,'127.0.0.1');
 for(const change of [{R12_REQUIRE_POSTGRES:'0'},{R12_SQL_TEST_HOST:''},{PGOPTIONS:'-c role=postgres'},{PGSERVICE:'production'},{PGSERVICEFILE:'/tmp/config'},
  {R12_POSTGRES_URL:'postgresql://r12_test:inert@production.example/r12_test'},
  {R12_POSTGRES_URL:'postgresql://postgres:inert@127.0.0.1/r12_test'},
  {R12_POSTGRES_URL:'postgresql://r12_test:inert@127.0.0.1/production'},
  {R12_POSTGRES_URL:'postgresql://r12_test:inert@127.0.0.1/r12_test?options=bad'}])assert.throws(()=>validateOwnerInitialRaceEnvironment({...valid,...change}));
 const quote=conservativeOwnerRaceQuote();assert.equal(quote.maximumCalls,5);assert.equal(quote.maximumCollections,1);assert.ok(quote.maximumMicrousd<2000000);assert.ok(2*quote.ceilings.plan>quote.maximumMicrousd);
});
const requested=process.env.R12_REQUIRE_POSTGRES==='1'||process.env.R12_OWNER_INITIAL_RACES==='1'||Boolean(process.env.R12_POSTGRES_URL);
test('Actual PostgreSQL sessions serialize owner activation, Stop, grants and cumulative reservation races',{
 skip:requested?false:'Native PostgreSQL not requested; no race evidence is claimed from PGlite',timeout:120000,
},async()=>{
 const report=await exerciseOwnerInitialPostgresRaces();assert.equal(report.passed,true);assert.equal(report.races.length,9);assert.ok(report.races.every(r=>r.observedLockWait));assert.equal(report.providerCalls,0);assert.equal(report.transportHttpCalls,0);
 console.log('Owner-initial native PostgreSQL race qualification:',JSON.stringify(report));
});
