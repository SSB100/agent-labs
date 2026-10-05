import assert from 'node:assert/strict';
import {setTimeout as pause} from 'node:timers/promises';
import {RESEARCH_KEY,RESEARCH_OWNER,RESEARCH_OTHER,authenticate,seedResearch,admission,revoke,counts,guard,settle,collectionPayload,recanonicalizeCollection,research} from './r11-public-research-fixture.mjs';

/** Requires actual independent PostgreSQL sessions and an observed blocking PID.
 * PGlite does not qualify as concurrency evidence for these tests. */
export async function researchPostgresRaces(t,{db,Client,pgUrl}){
 if(!pgUrl){await t.test('actual PostgreSQL observed-lock revocation/expiry races',{skip:'Set R11_PUBLIC_RESEARCH_POSTGRES_URL to a fresh isolated loopback database; PGlite is not concurrency evidence'},()=>{});return;}
 async function client(){const c=new Client({connectionString:pgUrl,connectionTimeoutMillis:5000,statement_timeout:15000,application_name:'r11-public-research-race'});await c.connect();await authenticate(c);return c;}
 async function observedLock(runner,locker){
  const deadline=Date.now()+10000;
  while(Date.now()<deadline){const row=(await db.query('select wait_event_type,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=$1',[runner.processID])).rows[0];if(row?.wait_event_type==='Lock'&&row.blockers.includes(locker.processID))return;await pause(20);}
  assert.fail('The competing PostgreSQL query never entered an observed lock wait on the expected session');
 }
 async function race(s,before,after=async()=>{},phase='search'){
  const locker=await client(),runner=await client();let pending;
  try{
   await locker.query('begin');await before(locker);
   pending=runner.query('select public.r11_research_server($1,$2,$3,$4) result',[s.businessId,'guard',{policyId:s.policy.id,phase,collectionId:phase==='search'?null:s.collectionId,admission:admission(s,phase)},RESEARCH_KEY]).then(result=>({result:result.rows[0].result}),error=>({error}));
   await observedLock(runner,locker);await after();await locker.query('commit');return await pending;
  }finally{
   await locker.query('rollback').catch(()=>{});if(pending)await pending;await Promise.all([locker.end(),runner.end()]);
  }
 }
 await t.test('observed policy-revocation-before-dispatch race leaves no research marker or binding',async()=>{
  const s=await seedResearch(db),before=await counts(db,s);
  const outcome=await race(s,c=>revoke(c,s));
  assert.match(outcome.error?.message??'',/r11_.*(revok|inactive|unavailable|expired)/);
  assert.deepEqual(await counts(db,s),before);
 });
 for(const field of ['validUntil','quoteValidUntil'])for(const lock of ['policy','late financial registry'])await t.test(`observed ${field} expiry during ${lock} lock wait denies before any marker`,async()=>{
  const expires=Date.now()+1800,s=await seedResearch(db,{policyOverrides:{validUntil:new Date(expires).toISOString(),[field]:new Date(expires).toISOString()}}),before=await counts(db,s);
  const outcome=await race(s,c=>lock==='policy'?c.query('select id from private.r11_research_policies where id=$1 for update',[s.policy.id]):c.query("select operation_key from private.r05_operations where operation_key='research.search' for update"),()=>pause(Math.max(0,expires-Date.now()+120)));
  assert.match(outcome.error?.message??'',/r11_.*(expired|inactive|unavailable)/);
  assert.deepEqual(await counts(db,s),before);
 });
 for(const expiryKind of ['financial policy','financial proof'])for(const lock of ['operation','installed pack'])await t.test(`observed ${expiryKind} expiry during ${lock} lock wait is rechecked before the marker`,async()=>{
  const expires=Date.now()+1800,options=expiryKind==='financial policy'?{operatingExpiresAt:new Date(expires).toISOString()}:{proofValidUntil:new Date(expires).toISOString()},s=await seedResearch(db,options),before=await counts(db,s);
  assert.ok(Date.parse(s.policy.validUntil)>expires+60000,'R11 source policy must remain live to isolate financial expiry');
  const outcome=await race(s,c=>lock==='operation'?c.query("select operation_key from private.r05_operations where operation_key='research.search' for update"):c.query('select id from public.installed_packs where id=$1 for update',[s.installationId]),()=>pause(Math.max(0,expires-Date.now()+120)));
  assert.match(outcome.error?.message??'',/r11_.*(financial|admission|policy|rules)/);assert.deepEqual(await counts(db,s),before);
 });
 await t.test('observed collection expiry during late selector financial-registry wait is checked at the marker',async()=>{
  const s=await seedResearch(db),marked=await guard(db,s),receipt=`inert-expiry-${s.policy.id}`;await settle(db,s,marked.requestId,receipt);
  const expires=Date.now()+1800,payload=collectionPayload(s,marked.requestId,receipt);payload.collection.sources[0].retrievalExpiresAt=new Date(expires).toISOString();recanonicalizeCollection(payload);
  s.collectionId=(await research(db,s,'collect',payload)).collectionId;const before=await counts(db,s);
  const outcome=await race(s,c=>c.query("select operation_key from private.r05_operations where operation_key='research.model' for update"),()=>pause(Math.max(0,expires-Date.now()+120)),'select');
  assert.match(outcome.error?.message??'',/r11_research_collection_expired/);assert.deepEqual(await counts(db,s),before);
 });
 await t.test('observed owner-transfer-before-dispatch race cannot inherit prior owner research authority',async()=>{
  const s=await seedResearch(db),before=await counts(db,s);
  const outcome=await race(s,c=>c.query('update public.businesses set owner_user_id=$1 where id=$2',[RESEARCH_OTHER,s.businessId]));
  assert.match(outcome.error?.message??'',/r11_.*(owner|policy|unavailable)/);
  assert.deepEqual(await counts(db,s),before);
  await authenticate(db,RESEARCH_OWNER);
 });
}

/** A separate fresh PostgreSQL service permits genuinely expiring immutable
 * registry rows without mutating or shortening the shared-suite fixtures. */
export async function researchOperationExpiryRace({db,Client,pgUrl,expires}){
 const s=await seedResearch(db),before=await counts(db,s);
 assert.ok(Date.parse(s.policy.validUntil)>expires+60000,'Source policy stays active throughout operation expiry');
 assert.ok(Date.parse(s.operatingPayload.expiresAt)>expires+60000,'Financial policy stays active throughout operation expiry');
 assert.equal((await db.query('select valid_until>$2::timestamptz valid from private.r05_policy_proofs where policy_id=$1',[s.operatingPolicyId,new Date(expires+60000).toISOString()])).rows[0].valid,true,'Financial proof stays active throughout operation expiry');
 const locker=new Client({connectionString:pgUrl,connectionTimeoutMillis:5000,statement_timeout:15000}),runner=new Client({connectionString:pgUrl,connectionTimeoutMillis:5000,statement_timeout:15000});let pending;
 try{
  await Promise.all([locker.connect(),runner.connect()]);await authenticate(runner);
  await locker.query('begin');await locker.query('select id from public.installed_packs where id=$1 for update',[s.installationId]);
  pending=guard(runner,s).then(result=>({result}),error=>({error}));
  const deadline=Date.now()+10000;let observed=false;
  while(Date.now()<deadline){const row=(await db.query('select wait_event_type,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=$1',[runner.processID])).rows[0];if(row?.wait_event_type==='Lock'&&row.blockers.includes(locker.processID)){observed=true;break;}await pause(20);}
  assert.equal(observed,true,'Operation must enter the actual installed-pack lock wait while its registry proof is still valid');
  await pause(Math.max(0,expires-Date.now()+150));await locker.query('commit');
  const outcome=await pending;assert.match(outcome.error?.message??'',/r11_research_financial_recheck: operation_evidence_unavailable/);
  assert.deepEqual(await counts(db,s),before,'Expired operation cannot leave prepared requests, reservations, bindings or sent markers');
 }finally{await locker.query('rollback').catch(()=>{});if(pending)await pending;await Promise.all([locker.end(),runner.end()]);}
}
