/** Opt-in native HTTP acceptance; all provider transport remains an inert fixture. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {validateR12HttpDatabase,configureR12HttpRoles,startR12Postgrest,r12HttpRpc,prepareCommittedR12Recovery,R12_RPC_ARGUMENTS} from './helpers/r12-postgrest-http.mjs';
import {acceptedR12ResponseBoundaryFixture,r12ShapeMetrics} from './helpers/r12-response-boundary-fixture.mjs';
const binary=process.env.R12_POSTGREST_BINARY,enabled=process.env.R12_REQUIRE_POSTGREST==='1',sequenceOnly=process.env.R12_HTTP_SEQUENCE_ONLY==='1';
if(sequenceOnly)assert.ok(enabled,'Sequence mode requires the explicit native HTTP flag');
if(enabled)assert.ok(binary,'Pinned R12_POSTGREST_BINARY is required');
test('R12 HTTP harness rejects hosted databases, privileged identities and URI options',()=>{
 for(const value of ['postgresql://r12_test@host.example/r12_test','postgresql://postgres@127.0.0.1/r12_test','postgresql://r12_test@127.0.0.1/postgres','postgresql://r12_test@127.0.0.1/r12_test?options=bad'])assert.throws(()=>validateR12HttpDatabase(value));
});
test('Recovery uses hoisted 8s RPC, 3s locks and unchanged 3s send through real PostgREST',{skip:!enabled||sequenceOnly,timeout:240000},async()=>{
 validateR12HttpDatabase(process.env.R12_POSTGRES_URL);
 process.env.R12_RPC_HTTP_ONLY='1';process.env.R12_SQL_FULL_SHAPE='1';process.env.R12_REQUIRE_POSTGRES='1';
 const report={version:'r12.recovery-http-deadline.1',providerCalls:0,trials:[],guards:[],passed:false,refreshedEvidence:true};
 const prepareStarted=performance.now(),fixture=await prepareCommittedR12Recovery(),ctx=fixture.context,db=ctx.db;report.prepareMs=Math.round(performance.now()-prepareStarted);report.sendFreshness=ctx.sendFreshness;let server,locker,resetRoles;
 const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
 const controllerSignature='public.r07_controller(uuid,uuid,text,jsonb,uuid,text,text,bigint,text)';
 const canonical=(await one('select pg_get_functiondef($1::regprocedure) definition',[controllerSignature])).definition;
 const fingerprint=()=>one(`select (select count(*)::int from private.r05_markers where request_id in(select request_id from private.r07_bindings where attempt_id=$1)) admission_markers,(select count(*)::int from private.r07_markers where attempt_id=$1) controller_markers,(select count(*)::int from private.r12_discovery_transport_claims where request_id in(select request_id from private.r07_bindings where attempt_id=$1)) claims,(select status from private.r07_attempts where id=$1) status`,[ctx.payload.attemptId]);
 try{
  resetRoles=await configureR12HttpRoles(db);
  await db.exec(`create function public.r12_http_settings() returns jsonb language sql set search_path='' as $$select jsonb_build_object('role',current_user,'statementTimeout',current_setting('statement_timeout'),'timezone',current_setting('TimeZone'))$$;revoke all on function public.r12_http_settings() from public,anon,authenticated,service_role;grant execute on function public.r12_http_settings() to anon;`);
  const configs=await one("select (select proconfig from pg_proc where oid=$1::regprocedure) original,(select proconfig from pg_proc where oid='public.r12_recovery_dispatch(uuid,uuid,uuid,jsonb,uuid,text,text,bigint,text)'::regprocedure) recovery",[controllerSignature]);
  assert.deepEqual(configs.original,['search_path=""']);assert.ok(configs.recovery.includes('statement_timeout=8s'));assert.ok(configs.recovery.includes('lock_timeout=3s'));
  const recoverySignature='public.r12_recovery_dispatch(uuid,uuid,uuid,jsonb,uuid,text,text,bigint,text)';
  const acl=await one(`select has_function_privilege('anon',p.oid,'EXECUTE') anon,has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,has_function_privilege('service_role',p.oid,'EXECUTE') service_role,exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') public_execute from pg_proc p where p.oid=$1::regprocedure`,[recoverySignature]);
  assert.deepEqual(acl,{anon:true,authenticated:false,service_role:false,public_execute:false});report.guards.push('recovery_anon_only_execute_no_public_grant');
  server=await startR12Postgrest({binary,databaseUrl:process.env.R12_POSTGRES_URL});report.postgrestVersion=server.version;
  const rpc=r12HttpRpc(server.base,report.trials);
  const checked=async(name,args)=>{const r=await rpc(name,args);assert.ok(r.ok,`${name}: ${r.data.code} ${r.data.message}`);return r.data;};
  const command=async(op,payload={},epoch=null)=>checked('r07_controller',{p_business_id:ctx.metadata.businessId,p_goal_id:ctx.metadata.goalId,p_operation:op,p_payload:payload,p_submission_id:randomUUID(),p_server_key:ctx.controller,p_lease_token:ctx.lease,p_epoch:epoch,p_admission_key:ctx.admission});
  const dispatchArgs=async()=>{const claim=await command('claim',{seconds:60});return{p_business_id:ctx.metadata.businessId,p_goal_id:ctx.metadata.goalId,p_scope_id:ctx.scopeId,p_payload:ctx.payload,p_submission_id:randomUUID(),p_server_key:ctx.controller,p_lease_token:ctx.lease,p_epoch:Number(claim.epoch),p_admission_key:ctx.admission};};
  const baseline=await fingerprint();assert.deepEqual(baseline,{admission_markers:0,controller_markers:0,claims:0,status:'reserved'});
  assert.equal(ctx.metadata.authorization.evidenceRefresh.version,'r12.focused-pilot-evidence-refresh.1');report.guards.push('reviewed_refreshed_evidence_same_recovery_slot');
  assert.deepEqual(await checked('r12_http_settings',{}),{role:'anon',statementTimeout:'3s',timezone:'UTC'});
  // Real new runtime endpoint, not only an artificial timeout function. The
  // canonical inputs body is delayed without removing any of its validation.
  const runtimeSignature='public.r12_recovery_server(uuid,uuid,uuid,text,jsonb,text)',ordinarySignature='public.r12_discovery_server(uuid,uuid,text,jsonb,text)';
  const runtimeCatalog=await one(`select (select proconfig from pg_proc where oid=$1::regprocedure) scoped,(select proconfig from pg_proc where oid=$2::regprocedure) ordinary,has_function_privilege('anon',$1,'EXECUTE') anon,has_function_privilege('authenticated',$1,'EXECUTE') authenticated,has_function_privilege('service_role',$1,'EXECUTE') service_role`,[runtimeSignature,ordinarySignature]);
  assert.deepEqual(runtimeCatalog.ordinary,['search_path=""']);assert.ok(runtimeCatalog.scoped.includes('statement_timeout=8s'));assert.ok(runtimeCatalog.scoped.includes('lock_timeout=3s'));assert.deepEqual([runtimeCatalog.anon,runtimeCatalog.authenticated,runtimeCatalog.service_role],[true,false,false]);
  const runtimeArgs={p_business_id:ctx.metadata.businessId,p_scope_id:ctx.scopeId,p_attempt_id:ctx.payload.attemptId,p_operation:'inputs',p_payload:{},p_server_key:ctx.controller};
  for(const change of [{p_server_key:'bad'},{p_scope_id:randomUUID()},{p_attempt_id:randomUUID()},{p_operation:'stage'},{p_payload:{extra:true}}]){const denied=await rpc('r12_recovery_server',{...runtimeArgs,...change});assert.equal(denied.ok,false);assert.equal(denied.data.code,'42501');}
  const ordinaryDefinition=(await one('select pg_get_functiondef($1::regprocedure) definition',[ordinarySignature])).definition,anchor="if p_operation='inputs' then";
  assert.equal(ordinaryDefinition.split(anchor).length,2);
  await db.exec(ordinaryDefinition.replace(anchor,anchor+' perform pg_sleep(4);'));
  try{
   const ordinaryArgs={...runtimeArgs};delete ordinaryArgs.p_scope_id;
   const timedOut=await rpc('r12_discovery_server',ordinaryArgs);assert.equal(timedOut.ok,false);assert.equal(timedOut.data.code,'57014');
   const scoped=await rpc('r12_recovery_server',runtimeArgs);assert.equal(scoped.ok,true);assert.ok(scoped.elapsedMs>=3900&&scoped.elapsedMs<8000);
  }finally{await db.exec(ordinaryDefinition);}
  assert.deepEqual(await fingerprint(),baseline);report.guards.push('scoped_runtime_exact_operations_scope_and_keys','actual_inputs_rpc_hoisted_8s_generic_3s_preserved');
  // A private function SET is intentionally insufficient under an outer 3s RPC.
  await db.exec(`create function private.r12_http_inner(seconds double precision) returns boolean language plpgsql set statement_timeout='8s' as $$begin perform pg_sleep(seconds);return true;end$$;
   create function public.r12_http_default(seconds double precision) returns boolean language sql security definer set search_path='' as $$select private.r12_http_inner(seconds)$$;
   create function public.r12_http_scoped(seconds double precision) returns boolean language sql security definer set search_path='' set statement_timeout='8s' as $$select private.r12_http_inner(seconds)$$;
   revoke all on function private.r12_http_inner(double precision) from public,anon,authenticated,service_role;
   revoke all on function public.r12_http_default(double precision),public.r12_http_scoped(double precision) from public,anon,authenticated,service_role;
   grant execute on function public.r12_http_default(double precision),public.r12_http_scoped(double precision) to anon;notify pgrst,'reload schema';`);
  for(let i=0;i<30;i++){const probe=await rpc('r12_http_scoped',{seconds:0});if(probe.ok)break;if(i===29)assert.fail('Schema reload did not expose fixture RPC');await delay(100);}
  let result=await rpc('r12_http_default',{seconds:4});assert.equal(result.ok,false);assert.equal(result.data.code,'57014');assert.ok(result.elapsedMs>=2800&&result.elapsedMs<5000);
  result=await rpc('r12_http_scoped',{seconds:4});assert.equal(result.ok,true);assert.equal(result.data,true);assert.ok(result.elapsedMs>=3900&&result.elapsedMs<7000);
  result=await rpc('r12_http_scoped',{seconds:9});assert.equal(result.ok,false);assert.equal(result.data.code,'57014');assert.ok(result.elapsedMs>=7800&&result.elapsedMs<11000);
  report.guards.push('nested_set_does_not_extend_default','hoisted_outer_rpc_exceeds_three_seconds','eight_second_upper_bound');
  for(const change of [{p_server_key:'bad'},{p_admission_key:'inert-wrong-admission-key-0123456789'},{p_scope_id:randomUUID()},{p_goal_id:randomUUID()},{p_payload:{...ctx.payload,operation:'reserve'}}]){
   const denied=await rpc('r12_recovery_dispatch',{...await dispatchArgs(),...change});assert.equal(denied.ok,false);assert.equal(denied.data.code,'42501');
  }
  assert.deepEqual(await fingerprint(),baseline);report.guards.push('wrong_authority_scope_goal_payload_rejected');
  const sqlRequire=createRequire(path.resolve(process.env.R12_SQL_TEST_HOST??process.env.R11_SQL_TEST_HOST,'package.json')),{Client}=sqlRequire('pg');locker=new Client({connectionString:process.env.R12_POSTGRES_URL});await locker.connect();
  let args=await dispatchArgs();await locker.query('begin');await locker.query('select 1 from public.businesses where id=$1 for update',[ctx.metadata.businessId]);
  try{const started=performance.now(),denied=await rpc('r12_recovery_dispatch',{...args,p_server_key:'inert-wrong-controller-key-0123456789'});assert.equal(denied.data.code,'42501');assert.ok(performance.now()-started<1500,'Wrong keys reject without waiting on Business lock');
   result=await rpc('r12_recovery_dispatch',args);assert.equal(result.ok,false);assert.equal(result.data.code,'55P03');assert.ok(result.elapsedMs>=2800&&result.elapsedMs<5000);
  }finally{await locker.query('rollback');}assert.deepEqual(await fingerprint(),baseline);report.guards.push('invalid_key_before_business_lock','three_second_lock_wait_cap');
  // Extend the true canonical body with a fixture-only post-write sleep. Timeout
  // must roll back the actual controller/R05 markers, not merely a sleep probe.
  await db.exec(canonical.replace('FUNCTION public.r07_controller(','FUNCTION private.r12_http_original_controller('));
  await db.exec("revoke all on function private.r12_http_original_controller(uuid,uuid,text,jsonb,uuid,text,text,bigint,text) from public,anon,authenticated,service_role;");
  await db.exec(`create or replace function public.r07_controller(p_business_id uuid,p_goal_id uuid,p_operation text,p_payload jsonb,p_submission_id uuid,p_server_key text,p_lease_token text default null,p_epoch bigint default null,p_admission_key text default null) returns jsonb language plpgsql security definer set search_path='' as $$declare result jsonb;begin result:=private.r12_http_original_controller(p_business_id,p_goal_id,p_operation,p_payload,p_submission_id,p_server_key,p_lease_token,p_epoch,p_admission_key);if p_operation='dispatch' then perform pg_sleep(9);end if;return result;end$$;`);
  try{result=await rpc('r12_recovery_dispatch',await dispatchArgs());assert.equal(result.data.code,'57014');assert.ok(result.elapsedMs>=7800&&result.elapsedMs<11000);assert.deepEqual(await fingerprint(),baseline);}finally{await db.exec(canonical);}
  report.guards.push('actual_marker_writes_rollback_on_timeout');
  // An owner lease expiring while the Business lock is held cannot dispatch.
  args=await dispatchArgs();await db.query("update private.r07_heads set lease_expires_at=clock_timestamp()+interval '700 milliseconds' where goal_id=$1",[ctx.metadata.goalId]);
  await locker.query('begin');await locker.query('select 1 from public.businesses where id=$1 for update',[ctx.metadata.businessId]);
  const expiring=rpc('r12_recovery_dispatch',args);await delay(1000);await locker.query('rollback');result=await expiring;assert.equal(result.ok,false);assert.match(result.data.message,/stale_controller|authority_required/);assert.deepEqual(await fingerprint(),baseline);report.guards.push('lease_expiry_after_lock_wait');
  // Continue both real SQL phases over HTTP; only provider POST/GET is inert.
  ctx.httpRuntime.useRpc(async(name,values)=>{
   assert.ok(R12_RPC_ARGUMENTS[name],name);const named=Object.fromEntries(R12_RPC_ARGUMENTS[name].map((key,i)=>[key,values[i]??null]));
   if(name==='r07_controller'&&named.p_operation==='dispatch'){delete named.p_operation;named.p_scope_id=ctx.scopeId;return checked('r12_recovery_dispatch',named);}
   return checked(name,named);
  });
  ctx.httpRuntime.receiptReady();
  let completed=false;for(let i=0;i<14;i++){const tick=await ctx.httpRuntime.tick();if(tick.status==='completed'){completed=true;break;}assert.notEqual(tick.status,'blocked',JSON.stringify(tick));}
  assert.equal(completed,true);assert.deepEqual(ctx.httpRuntime.counters(),{inertPosts:2,inertReceiptGets:2});
  const successfulDispatches=report.trials.filter(t=>t.rpc==='r12_recovery_dispatch'&&t.status===200),sends=report.trials.filter(t=>t.rpc==='r12_discovery_server'&&t.operation==='send');
  assert.equal(successfulDispatches.length,2);assert.equal(sends.length,2);for(const t of successfulDispatches)assert.ok(t.elapsedMs<8000);for(const t of sends){assert.equal(t.status,200);assert.ok(t.elapsedMs<3000,'Separate transport send retains the anonymous 3s budget');}
  const settled=await one("select count(*)::int attempts,count(*) filter(where status='completed')::int completed from private.r07_attempts where plan_id=$1",[ctx.planId]);assert.deepEqual(settled,{attempts:2,completed:2});
  report.guards.push('full_shape_strategy_and_review_real_http','separate_send_stays_under_three_seconds','two_inert_posts_two_receipts_no_paid_calls');
  await db.exec('begin');try{const closed=await ctx.closeRun();assert.equal(closed.activeAuthority,false);await db.exec('commit');}catch(error){await db.exec('rollback');throw error;}
  report.guards.push('owner_stop_and_exact_verifier_closeout');report.activeAuthority=false;report.passed=true;
 }finally{
  if(server)await server.close();if(locker)await locker.end();if(resetRoles)await resetRoles();await fixture.close();
  if(process.env.R12_HTTP_REPORT){const dest=path.resolve(process.env.R12_HTTP_REPORT);assert.ok(dest.startsWith('/tmp/r12-http-'));writeFileSync(dest,JSON.stringify(report,null,2)+'\n');}
  console.log('R12 PostgREST HTTP qualification:',JSON.stringify(report));
 }
});

// Offline alternate mode in this existing gate, not an additional CI job. It
// starts before the first schedule/prepare, unlike the reserved-state fault
// fixture above. Fresh PostgREST backends have no earlier runtime call plans;
// database shared pages are necessarily warm from immutable fixture preparation.
test('Terminal qualification cold-backend whole sequence with maximum accepted response family',{skip:!enabled||!sequenceOnly,timeout:240000},async()=>{
 validateR12HttpDatabase(process.env.R12_POSTGRES_URL);
 process.env.R12_RPC_HTTP_ONLY='1';process.env.R12_SQL_FULL_SHAPE='1';process.env.R12_REQUIRE_POSTGRES='1';
 const report={version:'r12.recovery-cold-sequence.1',providerCalls:0,trials:[],responses:[],ticks:[],passed:false,
  qualification:'Fresh PostgREST backend plans; shared database pages warmed by historical fixture setup. Inert provider/catalog transport. Local durations and remaining SQL budgets do not guarantee Production latency or a complete caller deadline.'};
 const prepareStarted=performance.now();let successfulSends=0,responseCount=0,server,resetRoles;
 const fixture=await prepareCommittedR12Recovery({coldSequence:true,terminal:true,responseFixture:args=>{
  assert.equal(successfulSends,++responseCount,'Every inert provider POST requires its own committed final admission');
  try{return acceptedR12ResponseBoundaryFixture(args,report.responses);}catch(error){report.responseFixtureError=error.message;throw error;}
 }}),ctx=fixture.context,db=ctx.db;report.prepareMs=Math.round(performance.now()-prepareStarted);
 const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
 try{
  assert.deepEqual(await one('select count(*)::int attempts from private.r07_attempts where plan_id=$1',[ctx.planId]),{attempts:0});
  resetRoles=await configureR12HttpRoles(db);
  assert.equal(ctx.metadata.authorization.version,'r12.focused-pilot-terminal-qualification-authorization.1');report.authorizationVersion=ctx.metadata.authorization.version;
  report.source=r12ShapeMetrics(ctx.metadata.focusedProfile);
  server=await startR12Postgrest({binary,databaseUrl:process.env.R12_POSTGRES_URL});report.postgrestVersion=server.version;
  const rpc=r12HttpRpc(server.base,report.trials);let firstRuntimeCall=true;
  ctx.httpRuntime.useRpc(async(name,values)=>{
   assert.ok(R12_RPC_ARGUMENTS[name],name);const named=Object.fromEntries(R12_RPC_ARGUMENTS[name].map((key,i)=>[key,values[i]??null]));
   if(firstRuntimeCall){assert.equal(name,'r07_controller');assert.equal(named.p_operation,'read');firstRuntimeCall=false;}
   const operation=named.p_operation,payloadShape=r12ShapeMetrics(named.p_payload);
   if(name==='r07_controller'&&operation==='dispatch'){name='r12_recovery_dispatch';delete named.p_operation;named.p_scope_id=ctx.scopeId;}
   if(name==='r12_discovery_server'&&['inputs','bind','send'].includes(operation)){name='r12_recovery_server';named.p_scope_id=ctx.scopeId;}
   const result=await rpc(name,named),trial=report.trials.at(-1);trial.payloadShape=payloadShape;trial.responseShape=r12ShapeMetrics(result.data);trial.remainingStatementBudgetMs=(['r12_recovery_dispatch','r12_recovery_server'].includes(name)?8000:3000)-result.elapsedMs;
   assert.ok(result.ok,`${name}/${operation}: ${result.data.code} ${result.data.message}`);
   if(name==='r12_recovery_server'&&operation==='send'){assert.equal(result.data.shouldDispatch,true);successfulSends++;}
   return result.data;
  });
  ctx.httpRuntime.receiptReady();let completed=false;
  for(let i=0;i<16;i++){const start=performance.now(),tick=await ctx.httpRuntime.tick();report.ticks.push({status:tick.status,reason:tick.reason??null,elapsedMs:Math.round(performance.now()-start)});if(tick.status==='completed'){completed=true;break;}assert.notEqual(tick.status,'blocked',JSON.stringify(tick));}
  assert.equal(completed,true);assert.deepEqual(ctx.httpRuntime.counters(),{inertPosts:2,inertReceiptGets:2});assert.equal(successfulSends,2);
  for(const operation of ['inputs','bind','send','observe','load','stage','claim','record'])assert.ok(report.trials.some(t=>t.rpc===(['inputs','bind','send'].includes(operation)?'r12_recovery_server':'r12_discovery_server')&&t.operation===operation&&t.status===200),`Whole sequence must exercise ${operation}`);
  for(const operation of ['schedule','reserve','settle','response','finish'])assert.ok(report.trials.some(t=>t.rpc==='r07_controller'&&t.operation===operation&&t.status===200),`Whole sequence must exercise ${operation}`);
  assert.equal(report.trials.filter(t=>t.rpc==='r12_recovery_dispatch'&&t.status===200).length,2);
  report.wires=(await db.query("select binding->>'phase' phase,octet_length(binding::text) binding_bytes,octet_length(binding->>'requestJson') request_bytes,octet_length(binding->>'wireBody') wire_bytes from private.r12_discovery_wires where scope_id=$1 order by binding->>'phase'",[ctx.scopeId])).rows;
  assert.deepEqual(await one("select count(*)::int attempts,count(*) filter(where status='completed')::int completed from private.r07_attempts where plan_id=$1",[ctx.planId]),{attempts:2,completed:2});
  await db.exec('begin');try{assert.equal((await ctx.closeRun()).activeAuthority,false);await db.exec('commit');}catch(error){await db.exec('rollback');throw error;}
  report.activeAuthority=false;report.passed=true;
 }finally{
  if(server)await server.close();if(resetRoles)await resetRoles();await fixture.close();
  if(process.env.R12_HTTP_REPORT){const dest=path.resolve(process.env.R12_HTTP_REPORT);assert.ok(dest.startsWith('/tmp/r12-http-'));writeFileSync(dest,JSON.stringify(report,null,2)+'\n');}
  console.log('R12 cold-backend sequence:',JSON.stringify(report));
 }
});
