/** Actual anonymous HTTP repair admission; all external provider IO is inert. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {directRepairDatabase} from './helpers/r12-direct-controller-repair-database.mjs';
import {directRepairFixture} from './helpers/r12-direct-controller-repair-fixture.mjs';
import {directRuntimeComposition,INERT_DIRECT_RUNTIME_ROOT} from './helpers/r12-direct-runtime-composition-fixture.mjs';
import {installDirectHttpDispatchFault} from './helpers/r12-direct-http-dispatch-fault.mjs';
import {one} from './helpers/r12-owner-initial-sql-fixture.mjs';
import {validateR12HttpDatabase,configureR12HttpRoles,startR12Postgrest,r12HttpRpc} from './helpers/r12-postgrest-http.mjs';
import {discoveryV2Hash as hash} from '../.core-tests/products/discovery-v2-hash.js';
import {validatePublicResearchRepairState} from '../.core-tests/products/discovery-r12-public-repair.js';
const http=process.env.R12_REQUIRE_POSTGREST==='1',inertOnly=process.env.R12_DIRECT_HTTP_FIXTURE_ONLY==='1';
assert.ok(!(http&&inertOnly),'HTTP and inert SQL qualification are explicitly distinct');
if(http){assert.equal(process.env.R12_REQUIRE_POSTGRES,'1');assert.ok(process.env.R12_POSTGREST_BINARY);validateR12HttpDatabase(process.env.R12_POSTGRES_URL);}
if(inertOnly)assert.ok(process.env.R12_SQL_TEST_HOST);
test('repair HTTP gate rejects hosted or privileged databases and URI options',()=>{
 for(const value of ['postgresql://r12_test@host.example/r12_test','postgresql://postgres@127.0.0.1/r12_test','postgresql://r12_test@127.0.0.1/postgres','postgresql://r12_test@127.0.0.1/r12_test?options=bad'])assert.throws(()=>validateR12HttpDatabase(value));
});
async function qualify(useHttp){
 const db=await directRepairDatabase(),report={version:'r12.direct-repair-http-qualification.1',http:useHttp,passed:false,externalProviderCalls:0,trials:[],guards:[]};
 const oldRoot=process.env.R05_ADMISSION_SERVER_KEY,oldEnv=process.env.VERCEL_ENV;
 let server,restoreRoles,locker;process.env.R05_ADMISSION_SERVER_KEY=INERT_DIRECT_RUNTIME_ROOT;process.env.VERCEL_ENV='production';
 try{
  for(const file of ['20261010120750_r12_direct_legacy_compatibility.sql','20261010120755_r12_direct_grant_total_compatibility.sql','20261010120760_r12_historical_attempt_projection.sql'])await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
  const f=await directRepairFixture(db);f.authority.db=db;const policyVersion='r12.direct-etsy-attempt-policy.2';assert.equal(f.policy.version,policyVersion);
  const rootBefore=await one(db,'select children_created,dispatches from private.r07_heads where goal_id=$1',[f.authority.f.goalId]);
  const fingerprint=()=>one(db,`select (select count(*)::int from private.r05_requests) requests,
   (select count(*)::int from private.r05_markers) markers,(select count(*)::int from private.r05_reservations) reservations,
   (select count(*)::int from private.r12_direct_phase_attempts) attempts,(select count(*)::int from private.r12_direct_phase_wires) wires,
   (select count(*)::int from private.r12_direct_source_transport_claims) source_claims`);
  for(const signature of ['public.r12_direct_controller_server(uuid,uuid,text,jsonb,text)','public.r12_direct_browser_ledger(uuid,uuid,text,jsonb,text)']){
   const acl=await one(db,`select proconfig,prosecdef,has_function_privilege('anon',oid,'EXECUTE') anon,
    has_function_privilege('authenticated',oid,'EXECUTE') authenticated,has_function_privilege('service_role',oid,'EXECUTE') service,
    exists(select 1 from aclexplode(coalesce(proacl,acldefault('f',proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') public_execute from pg_proc where oid=$1::regprocedure`,[signature]);
   assert.deepEqual(acl,{proconfig:['search_path=""'],prosecdef:true,anon:true,authenticated:false,service:false,public_execute:false});
  }
  const base={p_business_id:f.authority.f.businessId,p_scope_id:f.prepared.scopeId,p_operation:'read',p_payload:{},p_server_key:f.keys.controller};
  let rpc,checked;
  if(useHttp){
   restoreRoles=await configureR12HttpRoles(db);
   await db.exec(`create function public.r12_repair_http_settings() returns jsonb language sql set search_path='' as $$select jsonb_build_object('role',current_user,'statementTimeout',current_setting('statement_timeout'),'timezone',current_setting('TimeZone'))$$;revoke all on function public.r12_repair_http_settings() from public,anon,authenticated,service_role;grant execute on function public.r12_repair_http_settings() to anon;`);
   server=await startR12Postgrest({binary:process.env.R12_POSTGREST_BINARY,databaseUrl:process.env.R12_POSTGRES_URL});report.postgrestVersion=server.version;
   rpc=r12HttpRpc(server.base,report.trials);
   checked=async(name,args)=>{const value=await rpc(name,args);assert.equal(value.ok,true,`${name}/${args.p_operation}: ${JSON.stringify(value.data)}`);assert.ok(value.elapsedMs<3000,'Anonymous RPC retains its three-second budget');return value.data;};
   assert.deepEqual(await checked('r12_repair_http_settings',{}),{role:'anon',statementTimeout:'3s',timezone:'UTC'});
   const initial=await fingerprint();
   for(const change of [{p_server_key:'inert-forbidden-repair-key-01234567890123456789'},{p_scope_id:randomUUID()},{p_business_id:randomUUID()},{p_server_key:f.keys.source}]){const denied=await rpc('r12_direct_controller_server',{...base,...change});assert.equal(denied.ok,false);assert.equal(denied.data.code,'42501');}
   assert.deepEqual(await fingerprint(),initial);report.guards.push('exact_repair_scope_and_purpose_no_mutation');
  }
  const quoteBefore=await fingerprint();
  const quoteContext=useHttp?await checked('r12_direct_controller_server',{...base,p_operation:'quote_context'}):await f.rpc('quote_context');
  assert.deepEqual(quoteContext.approvedQuote,f.quote);assert.equal(quoteContext.maximumAttemptsInWindow,10);assert.equal(quoteContext.originalRunMaximumMicrounits,'10000000');
  assert.equal(quoteContext.browserQuote.providerProjectId,f.authority.project);assert.equal(quoteContext.browserQuote.routeHash,f.authority.routeHash);
  const {proofHash,...routeProof}=quoteContext.browserRevalidation;assert.equal(proofHash,hash(routeProof));
  assert.equal(routeProof.testEnvelopeId,f.authority.prepared.testEnvelopeId);assert.equal(routeProof.testEnvelopeHash,f.authority.prepared.testEnvelopeHash);
  assert.equal(routeProof.browserEvidenceKind,'still_valid_private_route_revalidation');assert.equal(routeProof.browserProviderFetched,false);
  assert.deepEqual(await fingerprint(),quoteBefore);report.guards.push('actual_repair_quote_context_is_read_only_and_preserves_private_provenance');
  const challenged=new Set();
  const transport=useHttp?async(name,args)=>{
   if(name==='r12_direct_controller_server'&&['dispatch','source_admit'].includes(args.p_operation)&&!challenged.has(args.p_operation)){
    challenged.add(args.p_operation);const baseline=await fingerprint(),payload=structuredClone(args.p_payload);
    if(args.p_operation==='dispatch')payload.binding.wireHash='0'.repeat(64);else payload.request.scopeHash='0'.repeat(64);
    const denied=await rpc(name,{...args,p_payload:payload});assert.equal(denied.ok,false);assert.deepEqual(await fingerprint(),baseline);report.guards.push('forged_'+args.p_operation+'_no_paid_marker');
   }return checked(name,args);
  }:null;
  const h=directRuntimeComposition(db,f,{rpcTransport:transport,policyVersion});
  h.faults.proofUnavailable=true;
  assert.equal((await h.step()).reason,'pending');assert.equal(h.modelPosts.length,1);
  assert.equal((await h.step()).reason,'pending');assert.equal(h.modelPosts.length,1,'Pending original receipt must not resend');
  h.faults.proofUnavailable=false;assert.equal((await h.step()).reason,'accepted');
  h.faults.sourceFinishUnavailable=1;assert.equal((await h.step()).reason,'source_recovery_pending');assert.equal(h.browserPosts.length,1);
  assert.equal((await h.step()).reason,'source_reconciled');assert.equal(h.browserPosts.length,1,'Receipt-only source recovery must not recreate a browser');
  const witnessed=(await f.read()).state.logicalCycles[0].sourceProof;assert.ok(witnessed);
  h.faults.failModelPhaseOnce='strategy';assert.equal((await h.step()).reason,'failed_settled',JSON.stringify(h.sqlErrors));
  const failed=(await f.read()).state;validatePublicResearchRepairState(failed,f.policy);
  assert.equal(failed.nextAction,'repair_model');assert.equal(failed.unitsReserved,1);assert.equal(failed.unitsConsumed,1);
  const failedId=h.modelPosts.at(-1).attemptId;
  const savedFailure=(await one(db,'select to_jsonb(r) value from private.r12_direct_phase_receipts r where attempt_id=$1',[failedId])).value;
  assert.ok(savedFailure);assert.equal((await one(db,'select count(*)::int n from private.r07_responses where attempt_id=$1',[failedId])).n,0);
  if(useHttp){
   const {Client}=createRequire(path.resolve(process.env.R12_SQL_TEST_HOST,'package.json'))('pg');locker=new Client({connectionString:process.env.R12_POSTGRES_URL});await locker.connect();
   const before=await fingerprint();await locker.query('begin');await locker.query('select 1 from public.businesses where id=$1 for update',[f.authority.f.businessId]);
   try{
    const blocked=await rpc('r12_direct_controller_server',{...base,p_operation:'schedule',p_payload:{phase:'strategy',attemptId:randomUUID(),runtimeCapability:'inert-http-repair-runtime-'+randomUUID(),expectedStateHash:failed.stateHash}});
    assert.equal(blocked.ok,false);assert.equal(blocked.data.code,'57014');assert.ok(blocked.elapsedMs>=2800&&blocked.elapsedMs<5000);
   }finally{await locker.query('rollback');}
   assert.deepEqual(await fingerprint(),before);assert.deepEqual((await f.read()).state,failed);report.guards.push('repair_schedule_lock_timeout_has_no_reserved_unit_or_partial_attempt');
  }
  const fault=await installDirectHttpDispatchFault(db,f.prepared.scopeId,policyVersion);report.faultDelegate=fault.signature;
  assert.equal(fault.signature,'private.r12_direct_repair_dispatch(uuid,jsonb)','Fault must execute the actual .2 delegate');
  try{
   if(useHttp){
    const before=await fingerprint();assert.equal((await h.step()).reason,'pending');assert.equal(h.modelPosts.length,2,'Timed-out replacement never reaches provider transport');
    assert.ok(report.trials.some(x=>x.operation==='dispatch'&&x.code==='57014'));
    assert.deepEqual(await fingerprint(),{...before,attempts:before.attempts+1},'Only the separately committed replacement schedule remains');
    const pending=(await f.read()).state;validatePublicResearchRepairState(pending,f.policy);
    assert.equal(pending.unitsReserved,2);assert.equal(pending.unitsConsumed,1);assert.equal(pending.modelDispatchesUsed,2);assert.equal(pending.sourceOperationsStarted,1);
    assert.deepEqual(pending.logicalCycles[0].sourceProof,witnessed);
    const call=pending.actualPhaseCalls.at(-1);assert.equal(call.status,'scheduled');assert.equal(call.replacesAttemptId,failedId);assert.equal(call.phase,'strategy');assert.equal(call.repairOrdinal,1);
    assert.deepEqual(await one(db,`select a.status,(select count(*)::int from private.r05_requests where id=x.request_id) requests,
     (select count(*)::int from private.r05_markers where request_id=x.request_id) markers,(select count(*)::int from private.r05_reservations where request_id=x.request_id) reservations,
     (select count(*)::int from private.r12_direct_phase_wires where attempt_id=a.id) wires from private.r07_attempts a join private.r12_direct_phase_attempts x on x.attempt_id=a.id where a.id=$1`,[call.phaseAttemptId]),{status:'scheduled',requests:0,markers:0,reservations:0,wires:0});
    report.guards.push('actual_repair_post_marker_timeout_rolls_back_request_wire_reservation_marker_and_consumption');
   }else report.guards.push('dry_exact_repair_router_resolution_and_restoration');
  }finally{await fault.restore();}
  assert.equal((await h.step()).reason,'accepted',JSON.stringify(h.sqlErrors));const replacementId=h.modelPosts.at(-1).attemptId;assert.notEqual(replacementId,failedId);
  const replacement=await f.rpc('attempt',{attemptId:replacementId});assert.equal(replacement.inputs.repair.replacesAttemptId,failedId);
  assert.equal(replacement.inputs.repair.dependencies.source.phaseAttemptId,h.browserPosts[0].attemptId);assert.deepEqual(replacement.inputs.sourcePackets[0].accounting,witnessed.accounting);
  assert.equal((await h.step()).reason,'accepted',JSON.stringify(h.sqlErrors));
  const final=await f.read();validatePublicResearchRepairState(final.state,f.policy);
  for(const [key,value]of Object.entries({unitsReserved:2,unitsConsumed:2,logicalCyclesStarted:1,modelDispatchesUsed:4,sourceOperationsStarted:1,nextAction:'next_cycle',questComplete:false}))assert.equal(final.state[key],value,key);
  assert.deepEqual(final.state.logicalCycles[0].sourceProof,witnessed);assert.deepEqual(h.modelPosts.map(x=>x.phase),['plan','strategy','strategy','review']);assert.equal(new Set(h.modelPosts.map(x=>x.attemptId)).size,4);
  assert.equal(h.browserPosts.length,1);assert.equal(h.browsers[0].events.filter(x=>x==='submit').length,1);
  assert.deepEqual((await one(db,'select to_jsonb(r) value from private.r12_direct_phase_receipts r where attempt_id=$1',[failedId])).value,savedFailure,'The settled failure remains immutable after repair');
  const reviewId=h.modelPosts.at(-1).attemptId,reviewer=await f.rpc('attempt',{attemptId:reviewId});
  assert.equal(reviewer.inputs.repair.repairOrdinal,0);assert.equal(reviewer.inputs.repair.countedUnitOrdinal,1);assert.equal(reviewer.inputs.repair.dependencies.strategy.phaseAttemptId,replacementId);assert.equal(reviewer.inputs.repair.dependencies.source.phaseAttemptId,h.browserPosts[0].attemptId);
  assert.equal(final.testExposure.knownActualMicrounits,'4');assert.equal(final.testExposure.boundedPendingMicrounits,'3000');assert.equal(final.testExposure.hasUnknownOrUnbounded,false);
  assert.deepEqual(await one(db,'select children_created,dispatches from private.r07_heads where goal_id=$1',[f.authority.f.goalId]),{children_created:rootBefore.children_created,dispatches:rootBefore.dispatches+5});
  assert.equal((await h.step('inert-duplicate-repair-host')).reason,'existing_runtime_requires_reconciliation');assert.equal(h.modelPosts.length,4);assert.equal(h.browserPosts.length,1);
  if(useHttp){
   await checked('r12_direct_controller_server',{...base,p_operation:'inputs',p_payload:{attemptId:replacementId}});
   for(const operation of ['read','quote_context','observe_quote','schedule','attempt','inputs','dispatch','candidate','model_receipt','source_admit','resolve_source','qualify_renderer','admit_renderer','source_transport','source_screenshot','source_receipt','source_finish','cleanup_complete'])assert.ok(report.trials.some(x=>x.operation===operation&&x.status===200),`Real repair HTTP coverage: ${operation}`);
  }
  report.wires=(await db.query(`select a.phase,octet_length(w.binding->>'requestJson') request_bytes,octet_length(w.binding->>'wireBody') wire_bytes from private.r12_direct_phase_wires w join private.r12_direct_phase_attempts a on a.attempt_id=w.attempt_id where a.scope_id=$1 and a.phase<>'source' order by a.created_at,a.attempt_id`,[f.prepared.scopeId])).rows;
  assert.equal(report.wires.length,4);report.inertModelPosts=h.modelPosts.length;report.inertBrowserCreates=h.browserPosts.length;report.units={reserved:final.state.unitsReserved,consumed:final.state.unitsConsumed,logicalCycles:final.state.logicalCyclesStarted};report.exposure=final.testExposure;report.actualRuntimeSourceHash=h.sourceHash;
  report.guards.push('genuine_settled_failure_replacement_and_first_review','one_immutable_source_two_counted_units','all_failed_and_successful_costs_retained','receipt_recovery_without_resend');report.passed=true;
 }finally{
  if(server)await server.close();if(locker)await locker.end();if(restoreRoles)await restoreRoles();await db.close();
  if(oldRoot===undefined)delete process.env.R05_ADMISSION_SERVER_KEY;else process.env.R05_ADMISSION_SERVER_KEY=oldRoot;
  if(oldEnv===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=oldEnv;
  if(process.env.R12_HTTP_REPORT){const p=path.resolve(process.env.R12_HTTP_REPORT);assert.ok(p.startsWith('/tmp/r12-http-'));writeFileSync(p,JSON.stringify(report,null,2)+'\n');}
  console.log('Repair HTTP qualification:',JSON.stringify(report));
 }
}
test('native PostgREST executes actual strategy repair under unchanged anon three-second deadline',{skip:!http,timeout:240000},()=>qualify(true));
test('inert SQL qualifies the actual repair HTTP fixture and exact fault delegate without claiming HTTP execution',{skip:!inertOnly,timeout:240000},()=>qualify(false));
