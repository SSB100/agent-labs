import test from 'node:test';
import assert from 'node:assert/strict';
import {exerciseRendererRevocationRaces,validateRendererRevocationRaceEnvironment} from './helpers/r12-renderer-revocation-postgres-races.mjs';
test('renderer revocation race gate requires an explicit isolated native PostgreSQL target',()=>{
 assert.throws(()=>validateRendererRevocationRaceEnvironment({R12_SQL_TEST_HOST:'/tmp/inert'}));
 assert.throws(()=>validateRendererRevocationRaceEnvironment({R12_REQUIRE_POSTGRES:'1',R12_SQL_TEST_HOST:'/tmp/inert',R12_POSTGRES_URL:'postgresql://r12_test:inert@production.example/r12_test'}));
});
test('review revocations serialize both orders against genuine paid source admission',{
 skip:process.env.R12_REQUIRE_POSTGRES!=='1'?'Native PostgreSQL not requested; PGlite cannot qualify races':false,timeout:900000,
},async t=>{const report=await exerciseRendererRevocationRaces();assert.equal(report.races.length,10);assert.ok(report.races.every(x=>x.observedLockWait));t.diagnostic(JSON.stringify(report));});
