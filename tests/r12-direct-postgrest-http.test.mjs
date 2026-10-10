/** Genuine native HTTP acceptance only; provider/catalog callbacks are inert. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {directControllerDatabase} from './helpers/r12-direct-controller-database.mjs';
import {directControllerFixture} from './helpers/r12-direct-controller-fixture.mjs';
import {directRuntimeComposition,INERT_DIRECT_RUNTIME_ROOT} from './helpers/r12-direct-runtime-composition-fixture.mjs';
import {prepareDirectHttpHistory,directHttpModelOutput,directHttpSchedulePayload} from './helpers/r12-direct-http-fixture.mjs';
import {one} from './helpers/r12-owner-initial-sql-fixture.mjs';
import {discoveryV2Hash as hash} from '../.core-tests/products/discovery-v2-hash.js';
import {validateR12HttpDatabase,configureR12HttpRoles,startR12Postgrest,r12HttpRpc} from './helpers/r12-postgrest-http.mjs';
const http=process.env.R12_REQUIRE_POSTGREST==='1',inertOnly=process.env.R12_DIRECT_HTTP_FIXTURE_ONLY==='1';
assert.ok(!(http&&inertOnly),'HTTP and inert SQL qualification are explicitly distinct');
if(http){assert.equal(process.env.R12_REQUIRE_POSTGRES,'1');assert.ok(process.env.R12_POSTGREST_BINARY);validateR12HttpDatabase(process.env.R12_POSTGRES_URL);}
if(inertOnly)assert.ok(process.env.R12_SQL_TEST_HOST);
test('direct HTTP gate rejects hosted or privileged databases and URI options',()=>{
 for(const value of ['postgresql://r12_test@host.example/r12_test','postgresql://postgres@127.0.0.1/r12_test','postgresql://r12_test@127.0.0.1/postgres','postgresql://r12_test@127.0.0.1/r12_test?options=bad'])assert.throws(()=>validateR12HttpDatabase(value));
});
async function qualify(useHttp){
 const db=await directControllerDatabase(),report={version:'r12.direct-http-qualification.1',http:useHttp,passed:false,externalProviderCalls:0,trials:[],guards:[]};
 const oldRoot=process.env.R05_ADMISSION_SERVER_KEY,oldEnv=process.env.VERCEL_ENV;
 let server,restoreRoles,locker;
 process.env.R05_ADMISSION_SERVER_KEY=INERT_DIRECT_RUNTIME_ROOT;process.env.VERCEL_ENV='production';
 try{
  for(const file of ['20261010120610_r12_direct_source_renderer_v2.sql','20261010120620_r12_direct_owner_server_context.sql','20261010120630_r12_direct_late_receipt_head_fence.sql','20261010120640_r12_direct_owner_access_navigation.sql','20261010120650_r12_direct_owner_test_exposure.sql','20261010120700_r12_direct_phase_repair.sql','20261010120750_r12_direct_legacy_compatibility.sql','20261010120755_r12_direct_grant_total_compatibility.sql'])await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
  const f=await directControllerFixture(db);f.authority.db=db;
  const state=await prepareDirectHttpHistory(f);report.priorRealCycles=state.windowAttemptsStarted;
  const before=await one(db,'select children_created,dispatches from private.r07_heads where goal_id=$1',[f.authority.f.goalId]);
  const signature='public.r12_direct_controller_server(uuid,uuid,text,jsonb,text)',ledgerSignature='public.r12_direct_browser_ledger(uuid,uuid,text,jsonb,text)';
  for(const sig of [signature,ledgerSignature]){
   const acl=await one(db,`select proconfig,prosecdef,has_function_privilege('anon',oid,'EXECUTE') anon,
    has_function_privilege('authenticated',oid,'EXECUTE') authenticated,has_function_privilege('service_role',oid,'EXECUTE') service,
    exists(select 1 from aclexplode(coalesce(proacl,acldefault('f',proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') public_execute from pg_proc where oid=$1::regprocedure`,[sig]);
   assert.deepEqual(acl,{proconfig:['search_path=""'],prosecdef:true,anon:true,authenticated:false,service:false,public_execute:false});
  }
  const fingerprint=()=>one(db,`select (select count(*)::int from private.r05_markers) markers,
   (select count(*)::int from private.r05_reservations) reservations,(select count(*)::int from private.r12_direct_phase_attempts) attempts,
   (select count(*)::int from private.r12_direct_phase_wires) wires,(select count(*)::int from private.r12_direct_source_transport_claims) source_claims`);
  let rpc,checked;
  if(useHttp){
   restoreRoles=await configureR12HttpRoles(db);
   await db.exec(`create function public.r12_direct_http_settings() returns jsonb language sql set search_path='' as $$select jsonb_build_object('role',current_user,'statementTimeout',current_setting('statement_timeout'),'timezone',current_setting('TimeZone'))$$;revoke all on function public.r12_direct_http_settings() from public,anon,authenticated,service_role;grant execute on function public.r12_direct_http_settings() to anon;`);
   server=await startR12Postgrest({binary:process.env.R12_POSTGREST_BINARY,databaseUrl:process.env.R12_POSTGRES_URL});report.postgrestVersion=server.version;
   rpc=r12HttpRpc(server.base,report.trials);
   checked=async(name,args)=>{const value=await rpc(name,args);assert.equal(value.ok,true,`${name}/${args.p_operation}: ${JSON.stringify(value.data)}`);assert.ok(value.elapsedMs<3000,'Actual anonymous RPC retains its three-second budget');return value.data;};
   assert.deepEqual(await checked('r12_direct_http_settings',{}),{role:'anon',statementTimeout:'3s',timezone:'UTC'});
   const args={p_business_id:f.authority.f.businessId,p_scope_id:f.prepared.scopeId,p_operation:'read',p_payload:{},p_server_key:f.keys.controller},initial=await fingerprint();
   for(const change of [{p_server_key:'inert-forbidden-key-01234567890123456789'},{p_scope_id:randomUUID()},{p_business_id:randomUUID()},{p_server_key:f.keys.source}]){const denied=await rpc('r12_direct_controller_server',{...args,...change});assert.equal(denied.ok,false);assert.equal(denied.data.code,'42501');}
   const forbidden=await rpc('r12_direct_browser_ledger',{p_business_id:f.authority.f.businessId,p_operation_id:randomUUID(),p_operation:'read',p_payload:{},p_server_key:f.keys.controller});assert.equal(forbidden.ok,false);
   assert.deepEqual(await fingerprint(),initial);report.guards.push('exact_scoped_key_and_purpose_no_mutation');
   const {Client}=createRequire(path.resolve(process.env.R12_SQL_TEST_HOST,'package.json'))('pg');locker=new Client({connectionString:process.env.R12_POSTGRES_URL});await locker.connect();
   await locker.query('begin');await locker.query('select 1 from public.businesses where id=$1 for update',[f.authority.f.businessId]);
   try{const blocked=await rpc('r12_direct_controller_server',{...args,p_operation:'schedule',p_payload:directHttpSchedulePayload(state)});assert.equal(blocked.ok,false);assert.equal(blocked.data.code,'57014');assert.ok(blocked.elapsedMs>=2800&&blocked.elapsedMs<5000);}finally{await locker.query('rollback');}
   assert.deepEqual(await fingerprint(),initial);report.guards.push('three_second_business_lock_timeout_no_partial_schedule');
  }
  // This authenticated read is intentionally separate from the runtime's
  // observe_quote operation. Exercise its real full-shape boundary as well.
  const quoteReadBefore=await fingerprint();
  const quoteContext=useHttp?await checked('r12_direct_controller_server',{p_business_id:f.authority.f.businessId,p_scope_id:f.prepared.scopeId,p_operation:'quote_context',p_payload:{},p_server_key:f.keys.controller}):await f.rpc('quote_context');
  assert.deepEqual(quoteContext.approvedQuote,f.quote);
  assert.equal(quoteContext.maximumAttemptsInWindow,10);assert.equal(quoteContext.originalRunMaximumMicrounits,'10000000');
  assert.equal(quoteContext.browserQuote.providerProjectId,f.authority.project);assert.equal(quoteContext.browserQuote.routeHash,f.authority.routeHash);
  assert.equal(quoteContext.browserQuote.maximumMicrounits,f.quote.browser.maximumMicrounits);
  const {proofHash,...routeProof}=quoteContext.browserRevalidation;assert.equal(proofHash,hash(routeProof));
  assert.equal(routeProof.testEnvelopeId,f.authority.prepared.testEnvelopeId);assert.equal(routeProof.testEnvelopeHash,f.authority.prepared.testEnvelopeHash);
  assert.equal(routeProof.approvedBrowserQuoteHash,f.quote.browser.browserQuoteHash);assert.equal(routeProof.executionBrowserQuoteHash,quoteContext.browserQuote.browserQuoteHash);
  assert.equal(routeProof.browserEvidenceKind,'still_valid_private_route_revalidation');assert.equal(routeProof.browserProviderFetched,false);
  assert.deepEqual(await fingerprint(),quoteReadBefore,'Read-only quote context cannot reserve or mark work');
  report.guards.push('actual_quote_context_preserves_approved_bounds_and_private_route_provenance');
  const challenged=new Set();
  const transport=useHttp?async(name,args)=>{
   if(name==='r12_direct_controller_server'&&['dispatch','source_admit'].includes(args.p_operation)&&!challenged.has(args.p_operation)){
    challenged.add(args.p_operation);const baseline=await fingerprint();
    const payload=structuredClone(args.p_payload);
    if(args.p_operation==='dispatch')payload.binding.wireHash='0'.repeat(64);else payload.request.scopeHash='0'.repeat(64);
    const denied=await rpc(name,{...args,p_payload:payload});assert.equal(denied.ok,false,'Full-shape altered binding must reject before admission');
    assert.deepEqual(await fingerprint(),baseline);report.guards.push('forged_'+args.p_operation+'_full_shape_has_no_marker');
   }
   return checked(name,args);
  }:null;
  const h=directRuntimeComposition(db,f,{rpcTransport:transport,modelOutput:a=>directHttpModelOutput(f,a)});
  if(useHttp){
   // Delay the real private post-marker body, while HTTP still enters the
   // unchanged outer RPC. The role deadline must roll back every actual write.
   const sig='private.r12_direct_dispatch(uuid,jsonb)',canonical=await one(db,'select pg_get_functiondef(oid) definition,proowner,proacl,proconfig,provolatile,prosecdef from pg_proc where oid=$1::regprocedure',[sig]);
   const anchor="return jsonb_build_object('shouldDispatch',true";assert.equal(canonical.definition.split(anchor).length,2);
   const timeoutBaseline=await fingerprint();
   await db.exec(canonical.definition.replace(anchor,'perform pg_sleep(4);'+anchor));
   try{
    const result=await h.step();assert.equal(result.reason,'pending');assert.equal(h.modelPosts.length,0);
    assert.ok(report.trials.some(t=>t.operation==='dispatch'&&t.code==='57014'));
    assert.deepEqual(await fingerprint(),{...timeoutBaseline,attempts:timeoutBaseline.attempts+1},'Only the separately committed schedule remains after dispatch timeout');
    const current=(await f.read()).state.attempts.at(-1).dispatches[0];assert.equal(current.receiptHash,null);
    assert.deepEqual(await one(db,`select a.status,(select count(*)::int from private.r05_markers where request_id=x.request_id) markers,
     (select count(*)::int from private.r05_reservations where request_id=x.request_id) reservations,(select count(*)::int from private.r12_direct_phase_wires where attempt_id=a.id) wires
     from private.r07_attempts a join private.r12_direct_phase_attempts x on x.attempt_id=a.id where a.id=$1`,[current.attemptId]),{status:'scheduled',markers:0,reservations:0,wires:0});
   }finally{await db.exec(canonical.definition);assert.deepEqual(await one(db,'select pg_get_functiondef(oid) definition,proowner,proacl,proconfig,provolatile,prosecdef from pg_proc where oid=$1::regprocedure',[sig]),canonical);}
   report.guards.push('actual_post_marker_timeout_rolls_back_reservation_wire_and_marker');
  }
  h.faults.proofUnavailable=true;
  assert.equal((await h.step()).reason,'pending');assert.equal(h.modelPosts.length,1);
  assert.equal((await h.step()).reason,'pending');assert.equal(h.modelPosts.length,1,'Pending receipt does not resend');
  h.faults.proofUnavailable=false;assert.equal((await h.step()).reason,'accepted');
  h.faults.sourceFinishUnavailable=1;assert.equal((await h.step()).reason,'source_recovery_pending');assert.equal(h.browserPosts.length,1);
  assert.equal((await h.step()).reason,'source_reconciled');assert.equal(h.browserPosts.length,1,'Saved source receipt recovery does not recreate browser');
  assert.equal((await h.step()).reason,'accepted');assert.equal((await h.step()).reason,'accepted');
  assert.equal(h.modelPosts.length,3);assert.equal(h.browserPosts.length,1);
  const final=await f.read();assert.equal(final.state.windowAttemptsStarted,9);assert.equal(final.state.questComplete,false);assert.equal(final.state.modelDispatchesUsed,27);assert.equal(final.state.sourceOperationsStarted,9);assert.equal(final.testExposure.knownActualMicrounits,'27');assert.equal(final.testExposure.boundedPendingMicrounits,'11000');
  assert.deepEqual(await one(db,'select children_created,dispatches from private.r07_heads where goal_id=$1',[f.authority.f.goalId]),{children_created:before.children_created,dispatches:before.dispatches+4});
  if(useHttp)await checked('r12_direct_controller_server',{p_business_id:f.authority.f.businessId,p_scope_id:f.prepared.scopeId,p_operation:'inputs',p_payload:{attemptId:h.modelPosts[0].attemptId},p_server_key:f.keys.controller});
  report.wires=(await db.query(`select a.phase,octet_length(w.binding->>'requestJson') request_bytes,octet_length(w.binding->>'wireBody') wire_bytes from private.r12_direct_phase_wires w join private.r12_direct_phase_attempts a on a.attempt_id=w.attempt_id where a.scope_id=$1 and a.ordinal=9 and a.phase<>'source' order by a.phase`,[f.prepared.scopeId])).rows;
  assert.equal(report.wires.length,3);assert.ok(report.wires.find(x=>x.phase==='plan').request_bytes>20000,'Actual late-history planner payload, not tiny manufactured input');
  report.inertModelPosts=h.modelPosts.length;report.inertBrowserCreates=h.browserPosts.length;report.actualRuntimeSourceHash=h.sourceHash;report.exposure=final.testExposure;
  report.guards.push('ninth_cycle_full_actual_driver_model_source_and_receipts','model_marker_before_post_browser_claim_before_create','receipt_recovery_without_resend');
  if(useHttp)for(const operation of ['read','quote_context','observe_quote','schedule','attempt','inputs','dispatch','candidate','model_receipt','source_admit','resolve_source','qualify_renderer','admit_renderer','source_transport','source_screenshot','source_receipt','source_finish','cleanup_complete'])assert.ok(report.trials.some(x=>x.operation===operation&&x.status===200),`Real HTTP coverage required: ${operation}`);
  report.passed=true;
 }finally{
  if(server)await server.close();if(locker)await locker.end();if(restoreRoles)await restoreRoles();await db.close();
  if(oldRoot===undefined)delete process.env.R05_ADMISSION_SERVER_KEY;else process.env.R05_ADMISSION_SERVER_KEY=oldRoot;
  if(oldEnv===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=oldEnv;
  if(process.env.R12_HTTP_REPORT){const p=path.resolve(process.env.R12_HTTP_REPORT);assert.ok(p.startsWith('/tmp/r12-http-'));writeFileSync(p,JSON.stringify(report,null,2)+'\n');}
  console.log('Direct HTTP qualification:',JSON.stringify(report));
 }
}
test('native PostgREST executes full ninth-cycle direct research under unchanged anon three-second deadline',{skip:!http,timeout:300000},()=>qualify(true));
test('inert SQL prepares the exact late-history HTTP fixture and actual driver without claiming HTTP qualification',{skip:!inertOnly,timeout:300000},()=>qualify(false));
