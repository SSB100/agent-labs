// Current-source, isolated SQL only. Every provider response is synthetic and
// all transport is inert; no live DB, provider request, grant or owner data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {r04SqlBootstrap} from './helpers/r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './helpers/r10-sql-fixture.mjs';
import {validateOwnerInitialRaceEnvironment,orderedRace,asRole} from './helpers/r12-owner-initial-postgres-races.mjs';
import {podThoroughSqlActivation as thoroughActivation,podThoroughSqlQuote as quote,podThoroughFailedReviewRuntime} from './helpers/r12-pod-thorough-sql-fixture.mjs';
import {podSource,podHash,podOne,podActivate,podSqlFixture} from './helpers/r12-pod-sql-fixture.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const host=process.env.R12_SQL_TEST_HOST??process.env.R11_SQL_TEST_HOST;
const nativeRequested=process.env.R12_REQUIRE_POSTGRES==='1';
async function openDatabase(){
 if(!nativeRequested){const require=createRequire(path.resolve(host,'package.json')),{PGlite}=require('@electric-sql/pglite'),{pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');return new PGlite({extensions:{pgcrypto}});}
 const target=validateOwnerInitialRaceEnvironment(process.env),require=createRequire(path.resolve(target.host,'package.json'));
 assert.equal(require('pg/package.json').version,'8.16.3');const {Client}=require('pg'),db=new Client({connectionString:target.url,ssl:false,application_name:'r12-counted-failure-inert-fixture',connectionTimeoutMillis:5000});
 try{await db.connect();db.exec=sql=>db.query(sql);
 assert.deepEqual(await podOne(db,'select current_user actor,current_database() db,host(inet_server_addr()) address'),{actor:'r12_test',db:'r12_test',address:target.address});
 assert.equal((await podOne(db,"select count(*)::int n from pg_tables where schemaname in ('public','private')")).n,0,'Refuse populated native database; this test never resets shared state');
 assert.deepEqual((await db.query("select rolname from pg_roles where rolname in ('anon','authenticated','service_role')")).rows,[]);
 db.close=()=>db.end();return db;}catch(error){await db.end().catch(()=>{});throw error;}
}
async function nativeClients(){
 const target=validateOwnerInitialRaceEnvironment(process.env),require=createRequire(path.resolve(target.host,'package.json')),{Client}=require('pg');
 const clients=['holder','waiter'].map(label=>new Client({connectionString:target.url,ssl:false,application_name:'r12-counted-contention-'+label,connectionTimeoutMillis:5000}));
 try{for(const client of clients){await client.connect();client.exec=sql=>client.query(sql);assert.deepEqual(await podOne(client,'select current_user actor,current_database() db,host(inet_server_addr()) address'),{actor:'r12_test',db:'r12_test',address:target.address});}return clients;}catch(error){await Promise.all(clients.map(c=>c.end().catch(()=>{})));throw error;}
}
function fullThoroughQuote(){const q=quote();q.ceilings={plan:2000000,search1:2000000,select1:2000000,strategy:2000000,review:2000000};q.maximumMicrousd=10000000;const{quoteHash:_hash,verifiedAt:_verified,validUntil:_valid,...body}=q;void[_hash,_verified,_valid];q.quoteHash=podHash(body);return q;}
async function competingPasses(db){
 const f=await podSqlFixture(db),quoted=fullThoroughQuote(),first=await thoroughActivation(db,{fixture:f,quoteOverride:quoted});
 const goal=await f.rpc('r04_quest_transition',[f.businessId,'quest.save',{goalId:null,expectedRevision:0,content:{...structuredClone(f.content),title:'Independent competing synthetic POD research'}},randomUUID()]);
 await f.rpc('r04_quest_transition',[f.businessId,'quest.preference',{goalId:goal.id,expectedRevision:1,preference:'ready'},randomUUID()]);
 const second=await thoroughActivation(db,{fixture:f,goalId:goal.id,quoteOverride:quoted});return{f,quoted,first,second};
}
const migration=readFileSync(root+'supabase/migrations/20261012213500_r12_pod_counted_failure_runtime.sql','utf8');
const release={version:'r12.executing-release.1',repository:'SSB100/agent-labs',environment:'production',commitSha:'b'.repeat(40),deploymentId:'dpl_inert_counted_failure_sql'};
async function failedPlan(db,{stage=true,kind='json_parse',amount='10',activation=null,quoteOverride=null,reserveOnly=false}={}){
 const a=activation??await thoroughActivation(db,{quoteOverride});await a.pass('admit',{quote:quoteOverride??quote()});
 const action=await a.pass('context'),claim=await a.command('claim',{seconds:120}),attemptId=randomUUID(),runtimeCapability='inert-counted-runtime-'+randomUUID();
 await a.command('schedule',{stepKey:'plan',attemptId,actionHash:action.actionHash,actionOrdinal:action.ordinal,reason:'Synthetic failed planner',evidenceHash:'8'.repeat(64),runtimeCapability},claim.epoch);
 const context=async()=>{const s=await a.read();return{planId:s.planId,planHash:s.planHash,plan:s.plan,step:s.plan.steps[0],attempt:s.attempts.find(x=>x.id===attemptId),knowledge:s.knowledge};};
 const runtime=podSource('products/discovery-r12-runtime');
 const adapter=podSource('products/discovery-r12-adapter').createDiscoveryR12QuestAdapter({scope:a.scope,phase:'plan',identity:{qualificationHash:a.plan.steps[0].qualificationHash,workflowDefinitionId:a.plan.steps[0].workflowDefinitionId,workerDefinitionId:a.plan.steps[0].workerDefinitionId,mode:'qualification'},executingRelease:release,
 dataClasses:a.operations.find(x=>x.operationKey===a.plan.steps[0].operationKey).dataClasses,
 store:{operation:a.effect,settle:(id,settlement)=>a.command('settle',{attemptId:id,settlement},claim.epoch),dispatchedAt:async()=>{throw Error('No provider dispatch in this fixture');}},
 request:async ctx=>runtime.buildDiscoveryR12PhaseRequest(ctx,runtime.readDiscoveryR12PhaseInputs(ctx,await a.effect(attemptId,'inputs'))),quote:async()=>quoteOverride??quote(),project:async()=>{throw Error('No candidate projection in this fixture');},
 config:{apiKey:'inert-counted-no-network',baseUrl:'https://openrouter.ai/api/v1',appUrl:'https://agent-labs-two.vercel.app',appName:'Agent Labs'},fetcher:async()=>{throw Error('Provider transport forbidden');}});
 const call=await adapter.prepare(await context());
 await a.command('reserve',{attemptId,descriptor:call.descriptor,runtimeCapability},claim.epoch);
 await adapter.prepare(await context());
 const ctx=await context();if(reserveOnly)return{...a,ctx,action,epoch:claim.epoch,attemptId,call};
 assert.equal((await a.command('dispatch',{attemptId,wireHash:call.descriptor.wireRequestHash},claim.epoch)).shouldDispatch,true);
 await assert.rejects(a.command('release_lease',{planId:ctx.planId,planHash:ctx.planHash},claim.epoch),/unclaimed_dispatch_lease/);
 assert.equal((await a.effect(attemptId,'send',{wireHash:call.descriptor.wireRequestHash,executingRelease:release})).shouldDispatch,true);
 const received={providerRequestId:'gen-inert-counted-'+attemptId,providerModelId:'openai/gpt-5.6-luna-20260709',actualMicrounits:amount};
 const raw=podSource('products/discovery-r12-observation').observeR12ReviewResponse({id:received.providerRequestId,model:received.providerModelId,choices:[{finish_reason:kind==='finish_reason'?'length':'stop',message:{content:'{"broken":'}}]},
 {scopeId:a.scope.id,attemptId,requestId:ctx.attempt.requestId},new Date().toISOString());
 await a.effect(attemptId,'observe',{observation:raw,observationHash:podHash(raw)});
 const diagnostic={version:'r12.review-diagnostic.1',scopeId:a.scope.id,attemptId,requestId:ctx.attempt.requestId,recordedAt:new Date().toISOString(),code:kind,httpStatus:null,observationSaved:true,issues:[]};
 await a.effect(attemptId,'diagnose',{diagnostic,diagnosticHash:podHash(diagnostic)});
 const staged=stage?await a.effect(attemptId,'failure_stage',{received}):null;
 return{...a,ctx,adapter,action,epoch:claim.epoch,attemptId,received,diagnostic,staged};
}
function proofFor(f,changes={}){const body={generationId:f.received.providerRequestId,providerName:'Azure',modelId:f.received.providerModelId,requestedEndpoint:'azure/us',providerResponses:[],...changes};return{...body,proofHash:podHash(body)};}
async function qualifyFailure(f){
 const subjectHash=f.staged.subjectHash,claim=await f.effect(f.attemptId,'failure_claim',{subjectHash});assert.equal(claim.claimed,true);
 const proof=proofFor(f);
 await assert.rejects(f.effect(f.attemptId,'failure_record',{subjectHash,claimId:claim.claimId,proof:proofFor(f,{generationId:'gen-wrong-subject'}),diagnostic:null,retryAfterAt:null}),/proof_invalid/);
 const recorded=await f.effect(f.attemptId,'failure_record',{subjectHash,claimId:claim.claimId,proof,diagnostic:null,retryAfterAt:null});assert.equal(recorded.status,'verified');return proof;
}
function failedResponse(f,proof,amount=f.received.actualMicrounits){return{attemptId:f.attemptId,planHash:f.ctx.planHash,inputHash:f.ctx.attempt.inputHash,outcome:'failed',result:{verdict:'reject',failureSubjectHash:f.staged.subjectHash,routeProofHash:proof.proofHash,diagnosticHash:podHash(f.diagnostic)},checkedArtifacts:[],settlement:{actualMicrounits:amount,providerRequestId:f.received.providerRequestId,receiptHash:f.staged.subjectHash}};}

test('counted-failure migration preserves one receipt ledger and exact scoped gates',()=>{
 assert.match(migration,/foreign key\(request_id\) references private\.r12_discovery_wires/);
 assert.doesNotMatch(migration,/drop constraint r12_discovery_receipt_checks_attempt_check/);
 assert.doesNotMatch(migration,/insert into private\.r12_discovery_candidates/);
 assert.match(migration,/FAILED_OUTPUT/);assert.match(migration,/lease_epoch is distinct from p_epoch/);
 assert.match(migration,/failure_stage','failure_claim','failure_record/);
 assert.match(migration,/r12_pod_failed_response_valid\(a,p,new.content\) is distinct from true/);
});

test('qualified .3 failure closure retains accounting, provenance, counted limits and caller lease fence',{skip:!host&&!nativeRequested,timeout:180000},async t=>{
 const db=await openDatabase();
 try{
 await db.exec(r04SqlBootstrap+sessionBootstrap);
 for(const file of readdirSync(root+'supabase/migrations').filter(x=>x.endsWith('.sql')).sort())await db.exec(readFileSync(root+'supabase/migrations/'+file,'utf8'));
 if(nativeRequested)await db.query("set statement_timeout='3000ms'");
 await t.test('native .3 first prepared dispatch and send fit the production three-second statement budget',{skip:!nativeRequested},async()=>{
  // Prepare the exact current-source adapter wire on the ordinary connection.
  // The timing backend is new and has never entered a dispatch/source gate.
  const a=await failedPlan(db,{reserveOnly:true}),snapshot=await a.read(),attempt=a.ctx.attempt;
  assert.equal(a.scope.version,'r12.pod-research-goal.3');assert.equal(attempt.status,'reserved');
  const wire=await podOne(db,'select request_id,binding from private.r12_discovery_wires where attempt_id=$1',[attempt.id]);
  assert.equal(wire.request_id,attempt.requestId);assert.equal(wire.binding.wireHash,a.call.descriptor.wireRequestHash);
  assert.equal(wire.binding.wireBody,a.call.wire.body);assert.equal(wire.binding.quote.profileHash,podHash(podSource('products/discovery-r12-pod-profile').POD_THOROUGH_LIMITS));
  const target=validateOwnerInitialRaceEnvironment(process.env),require=createRequire(path.resolve(target.host,'package.json')),{Client}=require('pg');
  const cold=new Client({connectionString:target.url,ssl:false,application_name:'r12-pod-thorough-cold-dispatch',connectionTimeoutMillis:5000});let timing;
  try{
   await cold.connect();assert.deepEqual(await podOne(cold,'select current_user actor,current_database() db,host(inet_server_addr()) address'),{actor:'r12_test',db:'r12_test',address:target.address});
   await cold.query('begin');await cold.query("set local timezone='UTC'");await cold.query("set local statement_timeout='3000ms'");await cold.query('set local role anon');
   assert.deepEqual(await podOne(cold,"select current_user actor,current_setting('statement_timeout') timeout"),{actor:'anon',timeout:'3s'});
   let start=performance.now();
   const dispatch=(await podOne(cold,'select public.r07_controller($1,$2,$3,$4,$5,$6,$7,$8,$9) result',[
    a.f.businessId,a.f.goalId,'dispatch',{attemptId:attempt.id,wireHash:attempt.wireHash},randomUUID(),a.controller,a.lease,a.epoch,a.admission])).result;
   const dispatchElapsedMs=Math.round((performance.now()-start)*1000)/1000;assert.equal(dispatch.shouldDispatch,true,JSON.stringify(dispatch));
   start=performance.now();
   const send=(await podOne(cold,'select public.r12_discovery_server($1,$2,$3,$4,$5) result',[
    a.f.businessId,attempt.id,'send',{wireHash:attempt.wireHash,executingRelease:release},a.controller])).result;
   const sendElapsedMs=Math.round((performance.now()-start)*1000)/1000;assert.equal(send.shouldDispatch,true,JSON.stringify(send));
   timing={engine:'native-postgresql',session:'fresh-backend',role:'anon',scopeVersion:a.scope.version,phase:'first-plan',statementTimeoutMs:3000,dispatchElapsedMs,sendElapsedMs,shouldDispatch:true,shouldSend:true,rolledBack:true,providerCalls:0};
  }finally{await cold.query('rollback').catch(()=>{});await cold.end().catch(()=>{});}
  assert.deepEqual(await podOne(db,`select
   (select count(*)::int from private.r05_markers where request_id=$1) financial_markers,
   (select count(*)::int from private.r07_markers where attempt_id=$2) controller_markers,
   (select count(*)::int from private.r12_discovery_transport_claims where request_id=$1) transport_claims`,[attempt.requestId,attempt.id]),{financial_markers:0,controller_markers:0,transport_claims:0});
  const after=await a.read();assert.equal(after.head.dispatches,snapshot.head.dispatches);assert.equal(after.attempts.find(x=>x.id===attempt.id).status,'reserved');
  t.diagnostic('Thorough POD native cold dispatch and send timing: '+JSON.stringify(timing));
 });
 await t.test('legacy scopes cannot use the qualified .3 lease operation',async()=>{
  const a=await podActivate(db),s=await a.store.read(),claim=await a.command('claim',{seconds:120});
  await assert.rejects(a.command('release_lease',{planId:s.planId,planHash:s.planHash},claim.epoch),/pod_lease_plan_required/);
 });
 await t.test('observed known cost survives before settlement; route proof alone cannot accept or close; next pass is counted',async()=>{
  const f=await failedPlan(db),saved=f.staged;
  assert.equal(saved.subject.version,'r12.pod-failed-effect.3');assert.equal(saved.subjectHash,podHash(saved.subject));assert.equal(saved.subject.actualMicrounits,'10');
  assert.equal((await f.f.read()).finance.hasUnknown,true,'staging an observed amount does not erase R05 liability');
  assert.equal((await podOne(db,'select count(*)::int n from private.r12_discovery_candidates where request_id=$1',[f.ctx.attempt.requestId])).n,0);
  assert.equal((await f.effect(f.attemptId,'load')).failedEffect.subjectHash,saved.subjectHash);
  assert.deepEqual((await f.f.rpc('r12_discovery_owner_read',[f.f.businessId,f.scope.id,false])).podRuntime,{latestPassOrdinal:0,currentPassOpen:true,latestClosureOutcome:null,failedEffectReceiptStatus:'awaiting_receipt'});
  assert.equal((await f.effect(f.attemptId,'failure_stage',{received:f.received})).replayed,true);
  await assert.rejects(f.effect(f.attemptId,'failure_stage',{received:{...f.received,actualMicrounits:'11'}}),/failed_effect_conflict/);
  await assert.rejects(f.effect(f.attemptId,'failure_stage',{received:{...f.received,providerRequestId:'gen-other'}}),/known_recoverable_failure/);
  await assert.rejects(db.query('update private.r12_pod_failed_effects set subject_hash=$1 where request_id=$2',['0'.repeat(64),f.ctx.attempt.requestId]),/immutable/);
  const proof=await qualifyFailure(f),response=failedResponse(f,proof);
  const valid=async v=>(await podOne(db,'select private.r12_pod_failed_response_valid(a,p,$2::jsonb) valid from private.r07_attempts a join private.r07_plans p on p.id=a.plan_id where a.id=$1',[f.attemptId,JSON.stringify(v)])).valid;
  assert.equal(await valid(response),false,'route proof without R05 settlement cannot complete a failed effect');
  await assert.rejects(f.command('response',failedResponse(f,proof,'11'),f.epoch),/failed_response_unverified/);
  assert.equal((await f.f.read()).finance.hasUnknown,true);
  await assert.rejects(f.command('response',{...response,outcome:'accepted'},f.epoch),/failed_response_unverified/);
  await f.command('response',response,f.epoch);
  assert.equal((await f.command('finish',{attemptId:f.attemptId},f.epoch)).status,'failed');
  assert.equal((await f.pass('complete',{actionHash:f.action.actionHash,actionOrdinal:0})).outcome,'FAILED_OUTPUT');
  const closed=await podOne(db,'select outcome,review_attempt_id,review_hash,failed_attempt_id,failure_subject_hash from private.r12_pod_pass_closures where scope_id=$1',[f.scope.id]);assert.equal(closed.outcome,'FAILED_OUTPUT');assert.equal(closed.review_attempt_id,null);assert.equal(closed.review_hash,null);assert.equal(closed.failed_attempt_id,f.attemptId);assert.equal(closed.failure_subject_hash,saved.subjectHash);
  assert.equal((await f.pass('complete',{actionHash:f.action.actionHash,actionOrdinal:0})).replayed,true);
  const next=await f.pass('admit',{quote:quote()});assert.equal(next.ordinal,1);assert.equal(next.admitted,true);
  assert.deepEqual((await f.f.rpc('r12_discovery_owner_read',[f.f.businessId,f.scope.id,false])).podRuntime,{latestPassOrdinal:1,currentPassOpen:true,latestClosureOutcome:'FAILED_OUTPUT',failedEffectReceiptStatus:null});
  const history=(await podOne(db,'select private.r12_pod_pass_history(p,1) history from private.r07_plans p where id=$1',[f.ctx.planId])).history;
  assert.equal(history.version,'r12.pod-failed-pass-history.3');assert.equal(history.reviewAccepted,false);assert.equal(history.failureSubjectHash,saved.subjectHash);assert.deepEqual(history.priorQueries,[]);
  const s=await f.read();assert.equal(s.head.dispatches,1);assert.equal(s.head.repairsUsed,0);assert.equal(s.head.pivotsUsed,0);assert.equal(s.plan.maximumDispatches,25);
  assert.equal((await f.f.read()).finance.committedMicrounits,'10');
  const releasePayload={planId:s.planId,planHash:s.planHash};
  await assert.rejects(f.command('release_lease',releasePayload,f.epoch,'inert-wrong-token-'+randomUUID()),/stale_controller/);
  await assert.rejects(f.command('release_lease',{...releasePayload,planHash:'0'.repeat(64)},f.epoch),/lease_plan_required/);
  assert.equal((await f.command('release_lease',releasePayload,f.epoch)).released,true);
  await assert.rejects(f.command('release_lease',releasePayload,f.epoch),/stale_controller/);
  const newToken='inert-next-token-'+randomUUID(),claimed=await f.command('claim',{seconds:120},null,newToken);assert.ok(claimed.epoch>f.epoch);
  await assert.rejects(f.command('release_lease',releasePayload,f.epoch),/stale_controller/);
 });
 await t.test('a rejected review after four real accepted phases retains exact 4/20/4 and USD 9.971088 headroom',async()=>{
  const a=await podThoroughFailedReviewRuntime(db);
  for(let i=0;i<35;i++){
   const closed=await podOne(db,'select outcome from private.r12_pod_pass_closures where scope_id=$1 and ordinal=0',[a.scope.id]);if(closed)break;
   try{const result=await a.tick();assert.equal(result.status,'progress',JSON.stringify(result));}catch(error){if(error.message!=='r12_discovery_receipt_pending')throw error;}
  }
  const closed=await podOne(db,'select * from private.r12_pod_pass_closures where scope_id=$1 and ordinal=0',[a.scope.id]);assert.ok(closed);assert.equal(closed.outcome,'FAILED_OUTPUT');
  assert.equal(closed.review_attempt_id,null);assert.equal(closed.review_hash,null);assert.ok(closed.failed_attempt_id);assert.equal(Number(closed.committed_microunits),28912);
  assert.deepEqual(a.posted,['plan','search1','select1','strategy','review']);assert.deepEqual(a.got,['plan','search1','select1','strategy','review']);
  const snapshot=await a.read();assert.equal(snapshot.attempts.filter(x=>x.status==='completed').length,4);assert.equal(snapshot.attempts.filter(x=>x.status==='failed').length,1);
  assert.equal((await podOne(db,'select count(*)::int n from private.r12_discovery_candidates c join private.r12_pod_pass_calls call using(request_id) where call.scope_id=$1',[a.scope.id])).n,4,'rejected review never becomes candidate');
  const finance=(await a.f.read()).finance;assert.equal(finance.committedMicrounits,'28912');assert.equal(finance.maximumMicrounits,'10000000');
  assert.equal(Number(finance.maximumMicrounits)-Number(finance.committedMicrounits),9971088);
  const counts=await podOne(db,"select (select count(*)::int from private.r12_pod_passes where scope_id=$1) passes,count(*)::int calls,count(*)filter(where phase='search1')::int searches from private.r12_pod_pass_calls where scope_id=$1",[a.scope.id]);
  assert.deepEqual({passes:5-counts.passes,calls:25-counts.calls,searches:5-counts.searches},{passes:4,calls:20,searches:4});
  const next=await a.pass('admit',{quote:quote()});assert.equal(next.ordinal,1);assert.equal(next.admitted,true);
  const history=(await podOne(db,'select private.r12_pod_pass_history(p,1) history from private.r07_plans p where id=$1',[snapshot.planId])).history;
  assert.equal(history.reviewAccepted,false);assert.equal(history.failedPhase,'review');assert.equal(history.priorQueries.length,1);assert.equal(history.acceptedOutputHashes.length,4);
  assert.equal(snapshot.head.repairsUsed,0);assert.equal(snapshot.head.pivotsUsed,0);assert.equal(snapshot.head.dispatches,5);
  // Exercise the actual next planner and its new independent review, rather
  // than stopping at an admission row that may not compose through runtime.
  for(let i=0;i<35;i++){
   const second=await podOne(db,'select outcome from private.r12_pod_pass_closures where scope_id=$1 and ordinal=1',[a.scope.id]);if(second)break;
   try{const result=await a.tick();assert.equal(result.status,'progress',JSON.stringify(result));}catch(error){if(error.message!=='r12_discovery_receipt_pending')throw error;}
  }
  const second=await podOne(db,'select outcome from private.r12_pod_pass_closures where scope_id=$1 and ordinal=1',[a.scope.id]);assert.equal(second?.outcome,'HYPOTHESIS_TO_TEST');
  const nextPlanner=a.sent.find(x=>x.phase==='plan'&&x.ordinal===1);assert.ok(nextPlanner);
  assert.equal(JSON.parse(nextPlanner.request.messages[1].content).refinement.reviewAccepted,false);
  assert.equal(a.posted.length,10);assert.equal(a.got.length,10);
  const terminal=await a.pass('admit',{quote:quote()});assert.equal(terminal.admitted,false);assert.equal(terminal.completed,true);assert.equal(a.posted.length,10);
  assert.deepEqual(await podOne(db,'select * from private.r12_pod_pass_closures where scope_id=$1 and ordinal=0',[a.scope.id]),closed,'The failed first pass remains immutable history');
 });
 await t.test('unknown charge and generic unsafe/domain failures do not create failure authority',async()=>{
  const f=await failedPlan(db,{stage:false});
  await assert.rejects(f.effect(f.attemptId,'failure_stage',{received:{...f.received,actualMicrounits:null}}),/known_recoverable_failure/);
  assert.equal((await podOne(db,'select count(*)::int n from private.r12_pod_failed_effects where request_id=$1',[f.ctx.attempt.requestId])).n,0);
  await assert.rejects(f.pass('complete',{actionHash:f.action.actionHash,actionOrdinal:0}),/unsettled/);
  const unsafe=await failedPlan(db,{stage:false,kind:'domain_validation'});
  await assert.rejects(unsafe.effect(unsafe.attemptId,'failure_stage',{received:unsafe.received}),/known_recoverable_failure/);
 });
 await t.test('actual adapter rejects permitted-host account/profile citations without autonomous failure continuation',async()=>{
  for(const path of ['/account','/profile']){
   const a=await podThoroughFailedReviewRuntime(db,{unsafeSearchPath:path,failedReviewPass:null});let rejected;
   for(let i=0;i<16;i++)try{await a.tick();}catch(error){if(error.message==='r12_discovery_receipt_pending')continue;rejected=error;break;}
   assert.ok(rejected,'The paid search with private-path citation must be rejected');
   assert.deepEqual(a.posted,['plan','search1']);assert.deepEqual(a.got,['plan']);
   const state=await a.read(),search=state.attempts.find(x=>x.stepKey==='search1'),saved=await a.effect(search.id,'load');
   assert.equal(saved.diagnostic.code,'domain_validation');assert.equal(saved.failedEffect,null);assert.equal(saved.candidate,null);
   assert.equal((await a.f.read()).finance.committedMicrounits,'13000');assert.equal((await a.f.read()).finance.hasUnknown,false,'known charge is retained without promoting the unsafe source');
   await assert.rejects(a.effect(search.id,'failure_stage',{received:{providerRequestId:'gen-inert-counted-review-'+search.id,providerModelId:'openai/gpt-5.6-luna-20260709',actualMicrounits:'8000'}}),/known_recoverable_failure/);
   for(let i=0;i<2;i++){const result=await a.tick();assert.equal(result.status,'blocked');}
   assert.equal(a.posted.length,2);assert.equal((await podOne(db,'select count(*)::int n from private.r12_pod_passes where scope_id=$1',[a.scope.id])).n,1);
   assert.equal((await podOne(db,'select count(*)::int n from private.r12_pod_pass_closures where scope_id=$1',[a.scope.id])).n,0);
  }
 });
 await t.test('next-consumer-capacity keeps exact candidate integer 123 microUSD and reuses its receipt proof',async()=>{
  const a=await podThoroughFailedReviewRuntime(db,{failedReviewPass:null,nextConsumerCapacity:true});
  for(let i=0;i<30;i++){
   const closed=await podOne(db,'select outcome from private.r12_pod_pass_closures where scope_id=$1 and ordinal=0',[a.scope.id]);if(closed)break;
   try{const result=await a.tick();assert.equal(result.status,'progress',JSON.stringify(result));}catch(error){if(error.message!=='r12_discovery_receipt_pending')throw error;}
  }
  const saved=await podOne(db,"select f.subject,f.subject_hash,c.candidate,(select count(*)::int from private.r12_discovery_receipt_checks where request_id=f.request_id) checks from private.r12_pod_failed_effects f join private.r12_discovery_candidates c using(request_id) where f.scope_id=$1",[a.scope.id]);
  assert.ok(saved,'A schema-valid strategy must retain its candidate before consumer-capacity failure');assert.equal(saved.subject.phase,'strategy');assert.equal(saved.subject.failureKind,'next_consumer_capacity');
  assert.equal(saved.candidate.reportedMicrousd,123);assert.equal(saved.subject.actualMicrounits,'123');assert.equal(saved.checks,1,'Existing route proof is reused without another metadata allowance');
  assert.deepEqual(a.posted,['plan','search1','select1','strategy']);assert.deepEqual(a.got,['plan','search1','select1','strategy']);
  const settlements=(await db.query('select distinct actual_microunits::text amount from private.r05_settlements where request_id=$1',[saved.subject.requestId])).rows;assert.deepEqual(settlements,[{amount:'123'}]);
  const closed=await podOne(db,'select outcome,committed_microunits from private.r12_pod_pass_closures where scope_id=$1 and ordinal=0',[a.scope.id]);assert.equal(closed.outcome,'FAILED_OUTPUT');assert.equal(Number(closed.committed_microunits),18123);
  assert.equal((await a.pass('admit',{quote:quote()})).ordinal,1);assert.equal(a.posted.length,4);
 });
 await t.test('temporary .3 competing pass/reservation holds wait without completing or discounting real admission',async()=>{
  const{f,quoted,first,second}=await competingPasses(db);let waiting;
  if(nativeRequested){
   const[holder,waiter]=await nativeClients();try{
    const race=await orderedRace({observer:db,holder,waiter,first:client=>asRole(client,'anon','r12_pod_pass_server',[f.businessId,first.scope.id,'admit',{quote:quoted},first.controller]),second:client=>asRole(client,'anon','r12_pod_pass_server',[f.businessId,second.scope.id,'admit',{quote:quoted},second.controller])});
    assert.equal(race.observedLockWait,true);assert.equal(race.first.admitted,true);assert.equal(race.second.error,undefined);waiting=race.second.value;
    console.log('Counted POD native contention race: observed Business lock wait; losing admission remained nonterminal.');
   }finally{await Promise.all([holder,waiter].map(c=>c.end()));}
  }else{assert.equal((await first.pass('admit',{quote:quoted})).admitted,true);waiting=await second.pass('admit',{quote:quoted});}
  assert.equal(waiting.admitted,false);assert.equal(waiting.waiting,true);assert.equal(waiting.reason,'pass_funding_contention');assert.ok(Date.parse(waiting.wakeAt)<=Date.parse(second.scope.expiresAt));
  assert.equal((await second.read()).head.state,'ready');assert.equal((await podOne(db,'select count(*)::int n from private.r12_pod_passes where scope_id=$1',[second.scope.id])).n,0);
  const reserved=await failedPlan(db,{activation:first,quoteOverride:quoted,reserveOnly:true});
  assert.equal(Number((await podOne(db,'select private.r12_pod_transient_reservations($1) amount',[f.businessId])).amount),2000000);
  const again=await second.pass('admit',{quote:quoted});assert.equal(again.reason,'pass_funding_contention');assert.notEqual((await second.read()).head.state,'completed');
  assert.equal(Number((await podOne(db,'select sum(held) held from private.r05_exposure($1)',[f.businessId])).held),2000000,'Waiting does not release the actual reservation');
  assert.equal(Number((await podOne(db,'select private.r12_adaptive_outstanding_hold($1) held',[f.businessId])).held),8000000);
  await first.command('cancel',{attemptId:reserved.attemptId,evidenceHash:podHash({kind:'inert-contention-cancel',attemptId:reserved.attemptId})},reserved.epoch);
  assert.equal(Number((await podOne(db,'select private.r12_pod_transient_reservations($1) amount',[f.businessId])).amount),0);
  assert.equal((await second.pass('admit',{quote:quoted})).reason,'pass_funding_contention','The unissued pass hold still prevents actual admission');
  await first.f.server('stop',{setupId:first.prepared.setupId,setupHash:first.prepared.setupHash,submissionId:randomUUID()},'');
  const released=await second.pass('admit',{quote:quoted});assert.equal(released.admitted,true);assert.equal(released.ordinal,0);
  assert.equal(Number((await podOne(db,'select private.r12_adaptive_outstanding_hold($1) held',[f.businessId])).held),10000000);
  assert.equal((await podOne(db,'select count(*)::int n from private.r05_markers where business_id=$1',[f.businessId])).n,0);
  assert.equal((await second.read()).plan.maximumMicrounits,'10000000');
 });
 await t.test('Stop wins over a waiting .3 contention retry; a fixed settled shortfall remains terminal',async()=>{
  const{f,quoted,first,second}=await competingPasses(db);await first.pass('admit',{quote:quoted});assert.equal((await second.pass('admit',{quote:quoted})).reason,'pass_funding_contention');
  const stop={setupId:second.prepared.setupId,setupHash:second.prepared.setupHash,submissionId:randomUUID()};
  if(nativeRequested){const[holder,waiter]=await nativeClients();try{
   const race=await orderedRace({observer:db,holder,waiter,first:client=>asRole(client,'authenticated','r12_pod_owner_server',[f.businessId,'stop',stop,''],f.ownerId),second:client=>asRole(client,'anon','r12_pod_pass_server',[f.businessId,second.scope.id,'admit',{quote:quoted},second.controller])});
   assert.equal(race.observedLockWait,true);assert.equal(race.first.stopped,true);assert.match(race.second.error?.message??'',/stopped_or_changed|gate_closed/);
   console.log('Counted POD native Stop race: observed Business lock wait; stopped waiting grant admitted no pass.');
  }finally{await Promise.all([holder,waiter].map(c=>c.end()));}}else{await f.server('stop',stop,'');await assert.rejects(second.pass('admit',{quote:quoted}),/stopped_or_changed|gate_closed/);}
  assert.equal((await podOne(db,'select count(*)::int n from private.r12_pod_passes where scope_id=$1',[second.scope.id])).n,0);
  const spent=await failedPlan(db,{quoteOverride:fullThoroughQuote()}),proof=await qualifyFailure(spent);
  assert.equal(Number((await podOne(db,'select private.r12_pod_transient_reservations($1) amount',[spent.f.businessId])).amount),0,'Marked unknown charges are never transient');
  await spent.command('response',failedResponse(spent,proof),spent.epoch);await spent.command('finish',{attemptId:spent.attemptId},spent.epoch);await spent.pass('complete',{actionHash:spent.action.actionHash,actionOrdinal:0});
  assert.equal(Number((await podOne(db,'select private.r12_pod_transient_reservations($1) amount',[spent.f.businessId])).amount),0,'Settled money is never transient');
  const exhausted=await spent.pass('admit',{quote:fullThoroughQuote()});assert.equal(exhausted.completed,true);assert.equal(exhausted.reason,'remaining_budget_below_quoted_pass');
 });
 await t.test('the same three receipt checks use immediate, +2m, +8m and honor later Retry-After/cutoff',async()=>{
  const f=await failedPlan(db),subjectHash=f.staged.subjectHash,request=f.ctx.attempt.requestId;
  const first=await f.effect(f.attemptId,'failure_claim',{subjectHash});assert.equal(first.claimed,true);assert.equal(first.attempts,1);
  const row=await podOne(db,'select created_at from private.r12_discovery_receipt_checks where id=$1',[first.claimId]);
  assert.equal(Date.parse(first.nextCheckAt)-new Date(row.created_at).getTime(),120000);
  const retry=new Date(Date.now()+600000).toISOString();
  await f.effect(f.attemptId,'failure_record',{subjectHash,claimId:first.claimId,proof:null,diagnostic:{code:'api_failure',httpStatus:429},retryAfterAt:retry});
  const cooldown=await f.effect(f.attemptId,'failure_claim',{subjectHash});assert.equal(cooldown.claimed,false);assert.equal(cooldown.reason,'cooldown');assert.equal(Date.parse(cooldown.nextCheckAt),Date.parse(retry));
  const second=await failedPlan(db),r=second.ctx.attempt.requestId;
  // Backdated INSERTS are synthetic fixtures only. History is never updated.
  const firstId=randomUUID(),secondId=randomUUID();
  await db.query("insert into private.r12_discovery_receipt_checks(id,request_id,attempt,created_at) values($1,$3,1,clock_timestamp()-interval '3 minutes'),($2,$3,2,clock_timestamp()-interval '1 minute')",[firstId,secondId,r]);
  const schedule=(await podOne(db,"select private.r12_pod_counted_receipt_status($1,clock_timestamp()+interval '20 minutes') result, (select created_at from private.r12_discovery_receipt_checks where id=$2) first_at",[r,firstId]));
  assert.equal(Date.parse(schedule.result.nextCheckAt)-new Date(schedule.first_at).getTime(),480000);
  const thirdId=randomUUID();await db.query('insert into private.r12_discovery_receipt_checks(id,request_id,attempt) values($1,$2,3)',[thirdId,r]);
  const inFlight=(await second.effect(second.attemptId,'load')).failedEffect.receipt;assert.equal(inFlight.status,'checking_receipt');assert.equal(inFlight.attempts,3);
  await assert.rejects(second.adapter.reconcile(second.ctx),error=>{
   assert.equal(error.message,'r12_discovery_receipt_pending');assert.equal(error.receipt.status,'checking_receipt');assert.equal(error.receipt.attempts,3);
   assert.equal(error.receipt.nextCheckAt,inFlight.nextCheckAt);assert.equal(error.receipt.receiptExpiresAt,inFlight.receiptExpiresAt);return true;
  },'The actual adapter waits for the saved third in-flight read without issuing another provider GET or POST');
  assert.equal((await second.effect(second.attemptId,'failure_claim',{subjectHash:second.staged.subjectHash})).claimed,false);
  const exhausted=await second.effect(second.attemptId,'failure_record',{subjectHash:second.staged.subjectHash,claimId:thirdId,proof:null,diagnostic:{code:'api_failure',httpStatus:404},retryAfterAt:null});assert.equal(exhausted.status,'exhausted');
  assert.deepEqual(await second.adapter.reconcile(second.ctx),{status:'unknown'},'An observed unsuccessful third read is terminal for metadata checks');
  assert.equal((await second.effect(second.attemptId,'failure_claim',{subjectHash:second.staged.subjectHash})).claimed,false);
  await assert.rejects(db.query('insert into private.r12_discovery_receipt_checks(request_id,attempt) values($1,4)',[r]),/check constraint/);
  assert.equal((await podOne(db,'select count(*)::int n from private.r12_discovery_receipt_checks where request_id=$1',[r])).n,3);
  const cutoff=(await podOne(db,'select private.r12_pod_counted_receipt_status($1,clock_timestamp()) result',[request])).result;assert.equal(cutoff.status,'expired');
  assert.equal((await second.effect(second.attemptId,'failure_stage',{received:second.received})).receipt.attempts,3,'Re-staging never resets the receipt count');
 });
 await t.test('Stop preserves receipt-only reconciliation and cannot authorize another call',async()=>{
  const f=await failedPlan(db);await f.f.server('stop',{setupId:f.prepared.setupId,setupHash:f.prepared.setupHash,submissionId:randomUUID()},'');
  const proof=await qualifyFailure(f);await f.command('response',failedResponse(f,proof),f.epoch);await f.command('finish',{attemptId:f.attemptId},f.epoch);
  await f.pass('complete',{actionHash:f.action.actionHash,actionOrdinal:0});
  await assert.rejects(f.pass('admit',{quote:quote()}),/stopped_or_changed/);
  assert.equal((await f.read()).head.dispatches,1);assert.equal((await f.f.read()).finance.committedMicrounits,'10');
 });
 }finally{await db.close();}
});
