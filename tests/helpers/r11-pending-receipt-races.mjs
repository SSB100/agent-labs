import assert from 'node:assert/strict';
import {setTimeout as pause} from 'node:timers/promises';
import {authenticate,value,counts} from './r11-public-research-fixture.mjs';
import {researchV2,repairStop} from './r11-public-research-repair-fixture.mjs';
import {pendingFixture,stagePending,claimPending,pendingProof,recordPending,seedPastClaims} from './r11-pending-receipt-fixture.mjs';

/** These assertions require separate physical PostgreSQL sessions, an observed
 * blocker PID and commit ordering. PGlite cannot supply concurrency evidence. */
export async function pendingReceiptPostgresRaces(t,{db,Client,pgUrl}){
 async function client(){
  const c=new Client({connectionString:pgUrl,connectionTimeoutMillis:5000,statement_timeout:15000,application_name:'r11-pending-receipt-race'});await c.connect();
  assert.equal(c.connection.stream.remoteAddress,'127.0.0.1');assert.notEqual(c.processID,db.processID);await authenticate(c);return c;
 }
 async function observedLock(runner,blockers){
  const deadline=Date.now()+10000;
  while(Date.now()<deadline){const row=(await db.query('select wait_event_type,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=$1',[runner.processID])).rows[0];if(row?.wait_event_type==='Lock'&&row.blockers.some(pid=>blockers.includes(pid)))return;await pause(20);}
  assert.fail('The receipt RPC did not enter an observed PostgreSQL lock wait on the expected physical session');
 }
 const outcome=promise=>promise.then(result=>({result}),error=>({error}));
 async function simultaneous(s,call){
  const locker=await client(),left=await client(),right=await client();let a,b;
  try{
   assert.notEqual(left.processID,right.processID);await locker.query('begin');await locker.query('select id from public.businesses where id=$1 for update',[s.businessId]);
   a=outcome(call(left));b=outcome(call(right));
   // A tuple waiter can block on another queued waiter rather than directly on
   // the initial row holder. Both must be observed in this physical lock chain.
   await observedLock(left,[locker.processID,right.processID]);await observedLock(right,[locker.processID,left.processID]);
   await locker.query('commit');return await Promise.all([a,b]);
  }finally{await locker.query('rollback').catch(()=>{});if(a)await a;if(b)await b;await Promise.all([locker.end(),left.end(),right.end()]);}
 }
 async function stopWins(s,call){
  const stopper=await client(),runner=await client();let pending;
  try{
   await stopper.query('begin');await repairStop(stopper,s);pending=outcome(call(runner));
   await observedLock(runner,[stopper.processID]);await stopper.query('commit');return await pending;
  }finally{await stopper.query('rollback').catch(()=>{});if(pending)await pending;await Promise.all([stopper.end(),runner.end()]);}
 }
 await t.test('physical due-claim race grants only the last available lease and cannot exceed three claims',async()=>{
  const s=await pendingFixture(db);await stagePending(db,s);await seedPastClaims(db,s,2);const before=await counts(db,s);
  const replies=await simultaneous(s,c=>claimPending(c,s));for(const reply of replies)assert.equal(reply.error,undefined);
  const results=replies.map(r=>r.result);assert.equal(results.filter(r=>r.claimed).length,1);assert.equal(results.filter(r=>!r.claimed&&r.reason==='cooldown').length,1);assert.ok(results.every(r=>r.attempts===3));assert.equal(results.find(r=>!r.claimed).claimId,null);
  const granted=results.find(r=>r.claimed);assert.ok(granted.claimId);assert.equal(await value(db,'select count(*)::int result from private.r11_research_receipt_checks where request_id=$1',[s.marked.requestId]),3);assert.deepEqual(await counts(db,s),before);
  await recordPending(db,s,granted,{diagnostic:{code:'api_failure',httpStatus:404}});assert.equal((await claimPending(db,s)).reason,'exhausted');
 });
 await t.test('Stop committed during a physical claim lock wait prevents the GET lease',async()=>{
  const s=await pendingFixture(db);await stagePending(db,s);const before=await counts(db,s),reply=await stopWins(s,c=>claimPending(c,s));assert.equal(reply.error,undefined);assert.equal(reply.result.claimed,false);assert.equal(reply.result.reason,'stopped');
  assert.equal(await value(db,'select count(*)::int result from private.r11_research_receipt_checks where request_id=$1',[s.marked.requestId]),0);assert.deepEqual(await counts(db,s),before);
 });
 await t.test('Stop committed during a physical promotion lock wait fences previously verified staged output',async()=>{
  const s=await pendingFixture(db);await stagePending(db,s);const claim=await claimPending(db,s);await recordPending(db,s,claim,{proof:pendingProof(s)});const before=await counts(db,s);
  const reply=await stopWins(s,c=>researchV2(c,s,'collect',s.payload));assert.match(reply.error?.message??'',/r11_research_policy_inactive|r11_research_verified_receipt_required/);
  assert.equal(await value(db,'select count(*)::int result from private.r11_research_collections where policy_id=$1',[s.policy.id]),0);assert.equal(await value(db,'select count(*)::int result from private.r11_research_results where policy_id=$1',[s.policy.id]),0);assert.deepEqual(await counts(db,s),before);
 });
 await t.test('Stop committed during a physical receipt-record lock wait prevents proof promotion',async()=>{
  const s=await pendingFixture(db);await stagePending(db,s);const claim=await claimPending(db,s),before=await counts(db,s);
  const reply=await stopWins(s,c=>recordPending(c,s,claim,{proof:pendingProof(s)}));assert.match(reply.error?.message??'',/r11_research_receipt_inactive/);
  assert.equal(await value(db,'select count(*)::int result from private.r11_research_receipt_observations where check_id=$1',[claim.claimId]),0);assert.deepEqual(await counts(db,s),before);
 });
 await t.test('physical concurrent terminal records append one observation/outcome/revocation and replay identically',async()=>{
  const s=await pendingFixture(db);await stagePending(db,s);const claim=await claimPending(db,s),before=await counts(db,s),diagnostic={code:'provider_mismatch',httpStatus:200};
  const replies=await simultaneous(s,c=>recordPending(c,s,claim,{diagnostic}));for(const reply of replies)assert.equal(reply.error,undefined);
  const results=replies.map(r=>r.result);assert.equal(results.filter(r=>r.recorded&&!r.replayed).length,1);assert.equal(results.filter(r=>r.recorded&&r.replayed).length,1);assert.ok(results.every(r=>r.status==='terminal'));
  assert.equal(await value(db,'select count(*)::int result from private.r11_research_receipt_observations where check_id=$1',[claim.claimId]),1);assert.equal(await value(db,"select count(*)::int result from private.r11_research_outcomes where policy_id=$1 and kind='failure'",[s.policy.id]),1);assert.equal(await value(db,'select count(*)::int result from private.r11_research_revocations where policy_id=$1',[s.policy.id]),1);assert.equal(await value(db,'select status result from public.workflow_runs where id=$1',[s.workflowRunId]),'needs_owner');assert.deepEqual(await counts(db,s),before);
 });
}
