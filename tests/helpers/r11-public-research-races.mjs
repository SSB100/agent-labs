import assert from 'node:assert/strict';
import {setTimeout as pause} from 'node:timers/promises';
import {RESEARCH_KEY,RESEARCH_SESSION,sha,value,RESEARCH_OWNER,RESEARCH_OTHER,authenticate,seedResearch,admission,revoke,counts,guard,settle,collectionPayload,recanonicalizeCollection,research} from './r11-public-research-fixture.mjs';
import {completionPayload} from './r11-public-research-owner-proof.mjs';
import {seedWindowResearch,windowGuard,freshPhaseQuote} from './r11-public-research-window-fixture.mjs';

/** Requires actual independent PostgreSQL sessions and an observed blocking PID.
 * PGlite does not qualify as concurrency evidence for these tests. */
export async function researchPostgresRaces(t,{db,Client,pgUrl}){
 if(!pgUrl){await t.test('actual PostgreSQL observed-lock revocation/expiry races',{skip:'Set R11_PUBLIC_RESEARCH_POSTGRES_URL to a fresh isolated loopback database; PGlite is not concurrency evidence'},()=>{});return;}
 for(const phase of ['search','select'])await t.test(`observed source2 ${phase} quote expiry during operation-row wait rolls back admission`,()=>researchPhaseQuoteExpiryRace({db,Client,pgUrl,phase}));
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
 await t.test('observed workflow-row wait through key grace expiry rolls back completed result and workflow update',async()=>{
  const s=await seedResearch(db),key=`inert-result-grace-${s.policy.id}`,expires=Date.now()+3000;
  await db.query('insert into private.r05_server_keys(key_hash,expires_at) values($1,$2)',[sha(key),new Date(expires).toISOString()]);
  const call=(client,op,payload)=>research(client,s,op,payload,key);
  const searched=await call(db,'guard',{policyId:s.policy.id,phase:'search',collectionId:null,admission:admission(s,'search')}),searchReceipt=`inert-grace-search-${s.policy.id}`;
  await settle(db,s,searched.requestId,searchReceipt);const collection=collectionPayload(s,searched.requestId,searchReceipt);
  s.collectionId=(await call(db,'collect',collection)).collectionId;s.lineage=collection.lineage;
  const selected=await call(db,'guard',{policyId:s.policy.id,phase:'select',collectionId:s.collectionId,admission:admission(s,'select')}),receipt=`inert-grace-selector-${s.policy.id}`;await settle(db,s,selected.requestId,receipt);
  const before=await counts(db,s),statusBefore=await value(db,'select status result from public.workflow_runs where id=$1',[s.workflowRunId]),payload=completionPayload(s,collection.collection,selected.requestId,receipt);
  const locker=await client(),runner=await client();let pending;
  try{
   await locker.query('begin');await locker.query('select id from public.workflow_runs where id=$1 for update',[s.workflowRunId]);
   pending=call(runner,'complete',payload).then(result=>({result}),error=>({error}));
   await observedLock(runner,locker);assert.ok(Date.now()<expires,'Completion must enter the real workflow row wait while authority is still live');
   await pause(Math.max(0,expires-Date.now()+150));await locker.query('commit');const outcome=await pending;
   assert.match(outcome.error?.message??'',/r11_research_authority_required/);
   assert.equal(await value(db,'select count(*)::int result from private.r11_research_results where policy_id=$1',[s.policy.id]),0,'No success may survive a final lock wait past key grace');
   assert.equal(await value(db,'select status result from public.workflow_runs where id=$1',[s.workflowRunId]),statusBefore);
   assert.deepEqual(await counts(db,s),before,'Existing two marked/settled calls remain recorded without a new attempt');
  }finally{await locker.query('rollback').catch(()=>{});if(pending)await pending;await Promise.all([locker.end(),runner.end()]);}
 });
 await t.test('actual concurrent guards cannot let the unacquired caller terminalize the one marked search',async()=>{
  const s=await seedResearch(db),left=await client(),right=await client();
  try{
   const replies=await Promise.all([guard(left,s),guard(right,s)]);assert.equal(replies.filter(r=>r.shouldDispatch===true).length,1);assert.equal(replies.filter(r=>r.shouldDispatch===false).length,1);assert.equal(replies[0].requestId,replies[1].requestId);
   const before=await counts(db,s),loser=replies[0].shouldDispatch?right:left;
   await assert.rejects(value(loser,'select public.r11_research_server_v2($1,$2,$3,$4) result',[s.businessId,'fail',{policyId:s.policy.id,phase:'search',requestId:null,reason:'internal_failure',observation:null},RESEARCH_KEY]),/r11_research_outcome_request/);
   assert.deepEqual(await counts(db,s),before);assert.equal(await value(db,'select count(*)::int result from private.r11_research_outcomes where policy_id=$1',[s.policy.id]),0);assert.equal(await value(db,'select count(*)::int result from private.r11_research_revocations where policy_id=$1',[s.policy.id]),0);assert.equal(await value(db,'select status result from public.workflow_runs where id=$1',[s.workflowRunId]),'running');
  }finally{await Promise.all([left.end(),right.end()]);}
 });
 await t.test('observed lost-collect reply race cannot revoke the separately acquired selector',async()=>{
  const s=await seedResearch(db),searched=await guard(db,s),searchReceipt=`inert-lost-collect-${s.policy.id}`;await settle(db,s,searched.requestId,searchReceipt);
  const collection=collectionPayload(s,searched.requestId,searchReceipt);await research(db,s,'collect',collection); // Commit succeeded; simulate its reply being discarded by the search caller.
  s.lineage=collection.lineage;const selector=await client(),searchCaller=await client();let pending;
  try{
   const loaded=await research(selector,s,'load',{policyId:s.policy.id});s.collectionId=loaded.collection.id;
   await selector.query('begin');const selected=await guard(selector,s,'select');assert.equal(selected.shouldDispatch,true);
   pending=value(searchCaller,'select public.r11_research_server_v2($1,$2,$3,$4) result',[s.businessId,'fail',{policyId:s.policy.id,phase:'search',requestId:searched.requestId,reason:'collection_persistence_failed',observation:null},RESEARCH_KEY]).then(result=>({result}),error=>({error}));
   await observedLock(searchCaller,selector);await selector.query('commit');const outcome=await pending;assert.equal(outcome.error,undefined);assert.equal(outcome.result.recorded,false);assert.equal(outcome.result.superseded,true);assert.equal(outcome.result.reason,'phase_progressed');
   assert.equal(await value(db,'select count(*)::int result from private.r11_research_outcomes where policy_id=$1',[s.policy.id]),0);assert.equal(await value(db,'select count(*)::int result from private.r11_research_revocations where policy_id=$1',[s.policy.id]),0);assert.equal(await value(db,'select status result from public.workflow_runs where id=$1',[s.workflowRunId]),'running');
   const receipt=`inert-owned-selector-${s.policy.id}`;await settle(selector,s,selected.requestId,receipt);const completed=await research(selector,s,'complete',completionPayload(s,collection.collection,selected.requestId,receipt));assert.ok(completed.resultId);assert.equal(await value(db,'select status result from public.workflow_runs where id=$1',[s.workflowRunId]),'completed');assert.equal((await counts(db,s)).markers,2);
  }finally{await selector.query('rollback').catch(()=>{});if(pending)await pending;await Promise.all([selector.end(),searchCaller.end()]);}
 });
 await t.test('observed failure projection lock wait cannot commit an outcome after key grace expires',async()=>{
  const s=await seedResearch(db),key=`inert-outcome-grace-${s.policy.id}`,expires=Date.now()+3000;
  await db.query('insert into private.r05_server_keys values($1,$2)',[sha(key),new Date(expires).toISOString()]);
  const marked=await research(db,s,'guard',{policyId:s.policy.id,phase:'search',collectionId:null,admission:admission(s)},key);await settle(db,s,marked.requestId,`inert-outcome-${s.policy.id}`);
  const before=await counts(db,s),locker=await client(),runner=await client();let pending;
  try{
   await locker.query('begin');await locker.query('select id from public.workflow_runs where id=$1 for update',[s.workflowRunId]);
   pending=value(runner,'select public.r11_research_server_v2($1,$2,$3,$4) result',[s.businessId,'fail',{policyId:s.policy.id,phase:'search',requestId:marked.requestId,reason:'source_contract_invalid',observation:null},key]).then(result=>({result}),error=>({error}));
   await observedLock(runner,locker);assert.ok(Date.now()<expires);await pause(Math.max(0,expires-Date.now()+150));await locker.query('commit');assert.match((await pending).error?.message??'',/r11_research_authority_required/);
   assert.deepEqual(await counts(db,s),before);assert.equal(await value(db,'select count(*)::int result from private.r11_research_outcomes where policy_id=$1',[s.policy.id]),0);assert.equal(await value(db,'select count(*)::int result from private.r11_research_revocations where policy_id=$1',[s.policy.id]),0);assert.equal(await value(db,'select status result from public.workflow_runs where id=$1',[s.workflowRunId]),'running');
  }finally{await locker.query('rollback').catch(()=>{});if(pending)await pending;await Promise.all([locker.end(),runner.end()]);}
 });
 await t.test('observed Stop projection lock wait rechecks owner session expiry and rolls back',async()=>{
  const s=await seedResearch(db),expires=Date.now()+3000,locker=await client(),runner=await client();let pending;
  await db.query('update auth.sessions set not_after=$2 where id=$1',[RESEARCH_SESSION,new Date(expires).toISOString()]);
  try{
   await locker.query('begin');await locker.query('select id from public.workflow_runs where id=$1 for update',[s.workflowRunId]);
   pending=value(runner,'select public.r11_research_stop_v2($1,$2) result',[s.businessId,s.policy.id]).then(result=>({result}),error=>({error}));
   await observedLock(runner,locker);assert.ok(Date.now()<expires);await pause(Math.max(0,expires-Date.now()+150));await locker.query('commit');assert.match((await pending).error?.message??'',/r11_research_owner_session_required/);
   assert.equal(await value(db,'select count(*)::int result from private.r11_research_outcomes where policy_id=$1',[s.policy.id]),0);assert.equal(await value(db,'select count(*)::int result from private.r11_research_revocations where policy_id=$1',[s.policy.id]),0);assert.equal(await value(db,'select status result from public.workflow_runs where id=$1',[s.workflowRunId]),'running');
  }finally{await locker.query('rollback').catch(()=>{});if(pending)await pending;await Promise.all([locker.end(),runner.end()]);await db.query('update auth.sessions set not_after=null where id=$1',[RESEARCH_SESSION]);}
 });
 await t.test('observed owner-transfer-before-dispatch race cannot inherit prior owner research authority',async()=>{
  const s=await seedResearch(db),before=await counts(db,s);
  const outcome=await race(s,c=>c.query('update public.businesses set owner_user_id=$1 where id=$2',[RESEARCH_OTHER,s.businessId]));
  assert.match(outcome.error?.message??'',/r11_.*(owner|policy|unavailable)/);
  assert.deepEqual(await counts(db,s),before);
  await authenticate(db,RESEARCH_OWNER);
 });
}

/** Real independent PostgreSQL sessions only: the 30-minute authority remains
 * live while its independently bound phase quote expires at an observed wait. */
export async function researchPhaseQuoteExpiryRace({db,Client,pgUrl,phase='search'}){
 const s=await seedWindowResearch(db);
 if(phase==='select'){
  const marked=await windowGuard(db,s),receipt=`inert-window-race-${s.policy.id}`;await settle(db,s,marked.requestId,receipt);
  const payload=collectionPayload(s,marked.requestId,receipt);s.collectionId=(await research(db,s,'collect',payload)).collectionId;
 }
 const before=await counts(db,s),expires=Date.now()+2500,quoteValidUntil=freshPhaseQuote(expires,0);
 assert.ok(Date.parse(s.policy.validUntil)>expires+20*60000,'Reviewed authority must remain live throughout the quote race');
 assert.ok(Date.parse(s.policy.quoteValidUntil)>expires+20*60000,'The policy-level ceiling is not the expiring per-phase quote');
 assert.equal(await value(db,'select valid_until>$2::timestamptz result from private.r05_operations where operation_key=$1',[phase==='search'?'research.search':'research.model',new Date(expires+60000).toISOString()]),true,'Financial registry stays valid');
 const locker=new Client({connectionString:pgUrl,connectionTimeoutMillis:5000,statement_timeout:15000,application_name:'r11-window-quote-locker'}),runner=new Client({connectionString:pgUrl,connectionTimeoutMillis:5000,statement_timeout:15000,application_name:'r11-window-quote-runner'});let pending;
 try{
  await Promise.all([locker.connect(),runner.connect()]);await authenticate(runner);
  await locker.query('begin');await locker.query('select operation_key from private.r05_operations where operation_key=$1 for update',[phase==='search'?'research.search':'research.model']);
  pending=windowGuard(runner,s,phase,quoteValidUntil).then(result=>({result}),error=>({error}));
  const waitDeadline=Date.now()+10000;let observed=false;
  while(Date.now()<waitDeadline){const row=(await db.query('select wait_event_type,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=$1',[runner.processID])).rows[0];if(row?.wait_event_type==='Lock'&&row.blockers.includes(locker.processID)){observed=true;break;}await pause(20);}
  assert.equal(observed,true,'The guard must block on the locked operation row in a separate PostgreSQL session');assert.ok(Date.now()<expires,'The phase quote must be live when the actual lock wait is observed');
  await pause(Math.max(0,expires-Date.now()+150));await locker.query('commit');
  assert.match((await pending).error?.message??'',/r11_research_fresh_quote_required/);
  assert.deepEqual(await counts(db,s),before,'Expired phase quote cannot commit any additional request, reservation, binding, collection, or sent marker');
  assert.equal(await value(db,'select count(*)::int result from private.r11_research_bindings where policy_id=$1 and phase=$2',[s.policy.id,phase]),0);
 }finally{await locker.query('rollback').catch(()=>{});if(pending)await pending;await Promise.all([locker.end(),runner.end()]);}
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
