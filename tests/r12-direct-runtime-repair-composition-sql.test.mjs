/** Actual .2 durable driver + real provider adapter/source renderer and migrated
 * authority. Only external model/Steel/Playwright/catalog IO is inert. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {directRepairDatabase} from './helpers/r12-direct-controller-repair-database.mjs';
import {directRepairFixture} from './helpers/r12-direct-controller-repair-fixture.mjs';
import {directRuntimeComposition,INERT_DIRECT_RUNTIME_ROOT} from './helpers/r12-direct-runtime-composition-fixture.mjs';
import {one} from './helpers/r12-owner-initial-sql-fixture.mjs';
import {validatePublicResearchRepairState} from '../.core-tests/products/discovery-r12-public-repair.js';
test('actual .2 runtime settles failed strategy then replaces only it and completes first review using one source and two units',{
 skip:!process.env.R12_SQL_TEST_HOST,timeout:240000,
},async t=>{
 const db=await directRepairDatabase(),fetch=globalThis.fetch,env={VERCEL_ENV:process.env.VERCEL_ENV,R05_ADMISSION_SERVER_KEY:process.env.R05_ADMISSION_SERVER_KEY};let external=0;
 globalThis.fetch=async()=>{external++;throw Error('No external transport');};Object.assign(process.env,{VERCEL_ENV:'production',R05_ADMISSION_SERVER_KEY:INERT_DIRECT_RUNTIME_ROOT});
 try{
  const f=await directRepairFixture(db);f.authority.db=db;assert.equal(f.policy.version,'r12.direct-etsy-attempt-policy.2');
  const h=directRuntimeComposition(db,f,{policyVersion:'r12.direct-etsy-attempt-policy.2'});t.diagnostic('Actual runtime source SHA256: '+h.sourceHash);
  assert.equal((await h.step()).reason,'accepted',JSON.stringify(h.sqlErrors));
  assert.equal((await h.step()).reason,'source_recorded',JSON.stringify({sql:h.sqlErrors,source:h.sourceResults}));
  const witnessed=(await f.read()).state.logicalCycles[0].sourceProof;assert.ok(witnessed);assert.equal(h.browserPosts.length,1);
  h.faults.failModelPhaseOnce='strategy';assert.equal((await h.step()).reason,'failed_settled',JSON.stringify({sql:h.sqlErrors,models:h.modelResults}));
  const failed=(await f.read()).state;validatePublicResearchRepairState(failed,f.policy);assert.equal(failed.nextAction,'repair_model');assert.equal(failed.unitsReserved,1);assert.equal(failed.unitsConsumed,1);
  const failedId=h.modelPosts.at(-1).attemptId;assert.equal((await one(db,'select count(*)::int n from private.r07_responses where attempt_id=$1',[failedId])).n,0);
  assert.equal((await h.step()).reason,'accepted',JSON.stringify({sql:h.sqlErrors,models:h.modelResults}));
  const replacementId=h.modelPosts.at(-1).attemptId;assert.notEqual(replacementId,failedId);const replacement=await f.rpc('attempt',{attemptId:replacementId});
  assert.equal(replacement.inputs.repair.replacesAttemptId,failedId);assert.equal(replacement.inputs.repair.dependencies.source.phaseAttemptId,h.browserPosts[0].attemptId);assert.deepEqual(replacement.inputs.sourcePackets[0].accounting,witnessed.accounting);
  assert.equal((await h.step()).reason,'accepted',JSON.stringify({sql:h.sqlErrors,models:h.modelResults}));
  const final=(await f.read()).state;validatePublicResearchRepairState(final,f.policy);assert.equal(final.unitsReserved,2);assert.equal(final.unitsConsumed,2);assert.equal(final.logicalCyclesStarted,1);assert.equal(final.modelDispatchesUsed,4);assert.equal(final.sourceOperationsStarted,1);assert.equal(final.nextAction,'next_cycle');assert.equal(final.questComplete,false);assert.deepEqual(final.logicalCycles[0].sourceProof,witnessed);
  assert.deepEqual(h.modelPosts.map(x=>x.phase),['plan','strategy','strategy','review']);assert.equal(new Set(h.modelPosts.map(x=>x.attemptId)).size,4);assert.equal(h.browserPosts.length,1);assert.equal(h.browsers[0].events.filter(x=>x==='submit').length,1);
  const reviewer=await f.rpc('attempt',{attemptId:h.modelPosts.at(-1).attemptId});assert.equal(reviewer.inputs.repair.repairOrdinal,0);assert.equal(reviewer.inputs.repair.dependencies.strategy.phaseAttemptId,replacementId);assert.equal(reviewer.inputs.repair.dependencies.source.phaseAttemptId,h.browserPosts[0].attemptId);
  assert.equal((await one(db,"select count(*)::int n from private.r12_direct_phase_attempts where scope_id=$1 and phase='source'",[f.prepared.scopeId])).n,1);
  assert.equal((await one(db,'select count(*)::int n from private.r05_settlements s join private.r12_direct_phase_attempts a on a.request_id=s.request_id where a.scope_id=$1',[f.prepared.scopeId])).n,4);
  const before={models:h.modelPosts.length,sources:h.browserPosts.length};assert.equal((await h.step('inert-duplicate-host')).reason,'existing_runtime_requires_reconciliation');assert.deepEqual({models:h.modelPosts.length,sources:h.browserPosts.length},before);
  const finance=(await f.read()).testExposure;assert.equal(finance.knownActualMicrounits,'4');assert.equal(finance.boundedPendingMicrounits,'3000');assert.equal(finance.hasUnknownOrUnbounded,false);assert.equal(external,0);
 }finally{globalThis.fetch=fetch;for(const[k,v]of Object.entries(env))if(v===undefined)delete process.env[k];else process.env[k]=v;await db.close();}
});
