/** Actual durable driver composition. All external IO is inert and bounded. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {directControllerDatabase} from './helpers/r12-direct-controller-database.mjs';
import {directControllerFixture} from './helpers/r12-direct-controller-fixture.mjs';
import {directRuntimeComposition,INERT_DIRECT_RUNTIME_ROOT} from './helpers/r12-direct-runtime-composition-fixture.mjs';
import {one} from './helpers/r12-owner-initial-sql-fixture.mjs';
import {validatePublicResearchState} from '../.core-tests/products/discovery-r12-public-cycle.js';
const enabled=process.env.R12_SQL_TEST_HOST||process.env.R12_REQUIRE_POSTGRES||process.env.R12_POSTGRES_URL;

test('actual durable driver executes four SQL-backed phases, recovers receipts without resending and honors Stop',
 {skip:!enabled,timeout:240000},async t=>{
 const db=await directControllerDatabase(),oldFetch=globalThis.fetch,oldRoot=process.env.R05_ADMISSION_SERVER_KEY,oldEnv=process.env.VERCEL_ENV;
 let network=0;globalThis.fetch=async()=>{network++;throw Error('External transport forbidden');};
 process.env.R05_ADMISSION_SERVER_KEY=INERT_DIRECT_RUNTIME_ROOT;process.env.VERCEL_ENV='production';
 try{
  await db.exec(readFileSync('supabase/migrations/20261010120610_r12_direct_source_renderer_v2.sql','utf8'));
  const f=await directControllerFixture(db),h=directRuntimeComposition(db,f);
  t.diagnostic('Actual runtime source SHA256: '+h.sourceHash);
  h.faults.proofUnavailable=true;
  assert.equal((await h.step()).reason,'pending',JSON.stringify(h.modelResults));assert.equal(h.modelPosts.length,1);
  const plannerId=h.modelPosts[0].attemptId,first=(await f.read()).state;
  assert.equal(first.attempts[0].dispatches[0].receiptHash,null);
  assert.equal((await h.step()).reason,'pending');assert.equal(h.modelPosts.length,1);assert.equal(h.modelGets.length,2);
  assert.equal(h.calls.filter(x=>x.operation==='schedule').length,1,'Duplicate invocation reuses scheduled attempt');
  h.faults.proofUnavailable=false;assert.equal((await h.step()).reason,'accepted',JSON.stringify(h.modelResults));assert.equal(h.modelPosts.length,1);
  assert.equal(h.calls.filter(x=>x.operation==='attach_runtime').length,1);
  const beforeForeign={posts:h.modelPosts.length,browser:h.browserPosts.length,schedules:h.calls.filter(x=>x.operation==='schedule').length};
  assert.equal((await h.step('inert-foreign-'+randomUUID())).reason,'existing_runtime_requires_reconciliation');
  assert.deepEqual({posts:h.modelPosts.length,browser:h.browserPosts.length,schedules:h.calls.filter(x=>x.operation==='schedule').length},beforeForeign);
  // A source-finish outage occurs after genuine renderer capture, durable
  // receipt, physical release and qualified held accounting have all completed.
  h.faults.sourceFinishUnavailable=1;
  assert.equal((await h.step()).reason,'source_recovery_pending',JSON.stringify({results:h.sourceResults,errors:h.sqlErrors}));
  assert.equal(h.browserPosts.length,1);assert.equal(h.sourceResults[0].run.receipt.status,'completed',JSON.stringify(h.sourceResults));
  assert.equal(h.sourceResults[0].accounting,'qualified_bounded_pending');assert.equal(h.sourceResults[0].completion,null);
  const sourceId=h.browserPosts[0].attemptId;
  assert.equal((await h.step()).reason,'source_reconciled',JSON.stringify(h.sqlErrors));assert.equal(h.browserPosts.length,1);
  assert.equal((await h.step()).reason,'accepted',JSON.stringify(h.modelResults));
  assert.equal((await h.step()).reason,'accepted',JSON.stringify(h.modelResults));
  const final=(await f.read()).state;validatePublicResearchState(final,f.policy);
  assert.equal(final.windowAttemptsStarted,1);assert.equal(final.attempts[0].status,'completed');assert.equal(final.attempts[0].review.outcome,'NME');
  assert.equal(final.nextAttemptKind,'targeted');assert.equal(final.questComplete,false);assert.equal(final.modelDispatchesUsed,3);assert.equal(final.sourceOperationsStarted,1);
  assert.deepEqual(h.modelPosts.map(x=>x.phase),['plan','strategy','review']);assert.equal(new Set(h.modelPosts.map(x=>x.attemptId)).size,3);
  assert.equal(h.calls.filter(x=>x.operation==='schedule').length,4);assert.equal(h.calls.filter(x=>x.operation==='dispatch').length,3);
  assert.equal((await one(db,'select count(*)::int n from private.r12_direct_source_transport_claims where attempt_id=$1',[sourceId])).n,1);
  assert.equal((await one(db,'select count(*)::int n from private.r12_direct_source_renderer_requests where attempt_id=$1',[sourceId])).n,2);
  assert.equal((await one(db,'select count(*)::int n from private.r12_direct_source_pngs where attempt_id=$1',[sourceId])).n,1);
  assert.equal(h.browsers[0].events.filter(x=>x==='submit').length,1);assert.equal(h.browsers[0].browser.isConnected(),false);
  const finance=await one(db,'select sum(held)::text held,sum(pending_maximum)::text pending,sum(known_actual)::text actual,bool_or(unknown) unknown from private.r12_direct_browser_exposure($1)',[f.authority.f.businessId]);
  assert.deepEqual(finance,{held:'3000',pending:'3000',actual:'0',unknown:false},'Login, verification and source maxima remain held until billing evidence');
  assert.equal((await one(db,'select count(*)::int n from private.r05_settlements z join private.r12_direct_phase_attempts a on a.request_id=z.request_id where a.scope_id=$1',[f.prepared.scopeId])).n,3);
  assert.ok((await one(db,'select candidate from private.r12_direct_model_candidates where attempt_id=$1',[plannerId])).candidate);
  // The review proposed one legitimate next planner. Stop after its response
  // is durably saved but before independent receipt metadata is available.
  h.faults.proofUnavailable=true;
  assert.equal((await h.step()).reason,'pending');assert.equal(h.modelPosts.length,4);
  const pendingId=h.modelPosts.at(-1).attemptId;
  await f.authority.server('stop_test',{testEnvelopeId:f.authority.prepared.testEnvelopeId,testEnvelopeHash:f.authority.prepared.testEnvelopeHash,submissionId:randomUUID()});
  h.faults.proofUnavailable=false;
  assert.equal((await h.step()).reason,'accepted',JSON.stringify({results:h.modelResults,errors:h.sqlErrors}));
  assert.equal(h.modelPosts.length,4);assert.equal(h.browserPosts.length,1);assert.equal(h.calls.filter(x=>x.operation==='attach_runtime').length,1,'Receipt recovery uses existing attachment after Stop');
  assert.equal((await one(db,'select count(*)::int n from private.r12_direct_phase_receipts where attempt_id=$1',[pendingId])).n,1);
  assert.equal((await one(db,'select h.state from private.r07_heads h where goal_id=$1',[f.authority.f.goalId])).state,'stopped');
  await assert.rejects(h.step(),/r12_direct_runtime_unconfirmed/);assert.equal(h.modelPosts.length,4);assert.equal(h.browserPosts.length,1);
  assert.equal(network,0);
 }finally{
  globalThis.fetch=oldFetch;if(oldRoot===undefined)delete process.env.R05_ADMISSION_SERVER_KEY;else process.env.R05_ADMISSION_SERVER_KEY=oldRoot;
  if(oldEnv===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=oldEnv;await db.close();
 }
});
