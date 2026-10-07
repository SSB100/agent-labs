/** Actual anonymous recovery dispatch on a disposable, representative SQL fixture. */
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import path from 'node:path';

export async function exerciseFullShapeRecoveryDispatch({db,metadata,command,payload}){
 assert.equal(process.env.R12_REQUIRE_POSTGRES,'1');
 const target=new URL(process.env.R12_POSTGRES_URL);
 assert.ok(target.protocol==='postgresql:'&&target.hostname==='127.0.0.1'&&target.username==='r12_test'&&target.pathname==='/r12_test'&&!target.search&&!target.hash);
 if(process.env.R12_CI_POSTGRES_ADDRESS){assert.equal(process.env.CI,'true');assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(target.port,'5432');assert.equal(target.password,'r12-isolated-fixture');}
 const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
 assert.deepEqual(await one('select current_user role,current_database() db,host(inet_server_addr()) host'),{role:'r12_test',db:'r12_test',host:process.env.R12_CI_POSTGRES_ADDRESS??'127.0.0.1'});
 const sid=metadata.scopeId,abandoned=metadata.closedUnsent.scopeId,charged=metadata.closedFocused.scopeId;
 const report={version:'r12.synthetic-full-shape-recovery-dispatch.1',statementTimeoutMs:3000,providerCalls:0,transportCalls:0,trials:[],guards:[]};
 const sourceAt=async(at,current=true)=>(await one('select private.r12_pilot_unsent_recovery_source(s,$2::timestamptz,$3) result from private.r12_discovery_scopes s where id=$1',[sid,at,current])).result;
 const closures=async()=>one('select private.r12_pilot_unsent_closure($1) unsent,private.r12_pilot_successor_closure($2) charged',[abandoned,charged]);
 const fingerprint=async()=>one(`select
  (select jsonb_agg(to_jsonb(x) order by x.id) from private.r07_attempts x where x.goal_id=$1) attempts,
  (select to_jsonb(x) from private.r07_heads x where x.goal_id=$1) head,
  (select jsonb_agg(to_jsonb(x) order by x.request_id) from private.r05_markers x) financial_markers,
  (select jsonb_agg(to_jsonb(x) order by x.attempt_id) from private.r07_markers x) controller_markers,
  (select jsonb_agg(to_jsonb(x) order by x.request_id) from private.r12_discovery_transport_claims x) claims,
  (select jsonb_agg(to_jsonb(x) order by x.id) from private.r05_settlements x) settlements,
  (select jsonb_agg(to_jsonb(x) order by x.request_id) from private.r05_releases x) releases,
  private.stage13v2_budget_authority($2,false) budget`,[metadata.goalId,metadata.focusedProfile.budgetAuthorityRootId]);
 const counters=async()=>Object.fromEntries((await db.query("select funcname,calls,total_time from pg_stat_xact_user_functions where schemaname in ('private','public') and (funcname like 'r12_pilot_%' or funcname in ('r07_controller','r12_discovery_scope_current','r07_gate','r05_admissible','r05_admission_server','stage14_hash','stage14_canonical','r04_hash','r04_safe'))")).rows.map(x=>[x.funcname,{calls:Number(x.calls),totalMs:Number(x.total_time)}]));
 await db.exec('savepoint recovery_performance');
 try{
  await db.exec("set local track_functions='all';set local statement_timeout='30s'");
  const initial=await fingerprint(),at=new Date().toISOString(),source=await sourceAt(at),closed=await closures();
  report.shape=await one('select octet_length($1::jsonb::text) scope_bytes,octet_length($2::jsonb::text) complete_source_bytes',[metadata.focusedEnvelope,source]);
  assert.ok(report.shape.scope_bytes>=30000&&report.shape.scope_bytes<=65536);
  assert.ok(report.shape.complete_source_bytes>=200000&&report.shape.complete_source_bytes<=524288);
  await db.exec('discard plans');
  const trial=async(label,mutate=null)=>{
   await db.exec('savepoint recovery_dispatch_trial');let result;
   try{
    const claim=await command('claim',{seconds:60});if(mutate)await mutate();
    await db.exec("set local statement_timeout='3s'");
    const before=await counters(),started=performance.now();
    try{result={label,elapsedMs:0,result:await command('dispatch',payload,Number(claim.epoch)),timeout:false};}
    catch(error){result={label,elapsedMs:0,error:error.message,sqlState:error.code??null,timeout:error.code==='57014'};}
    result.elapsedMs=Math.round(performance.now()-started);
    const after=await counters();result.functions=Object.fromEntries(Object.entries(after).map(([name,row])=>[name,{calls:row.calls-(before[name]?.calls??0),totalMs:Math.round((row.totalMs-(before[name]?.totalMs??0))*100)/100}]).filter(([,row])=>row.calls));
   }finally{await db.exec('rollback to savepoint recovery_dispatch_trial');await db.exec('release savepoint recovery_dispatch_trial');}
   assert.deepEqual(await fingerprint(),initial,'Recovery trials restore all work, releases, markers, claims, settlements and funding');
   report.trials.push(result);console.log('R12 recovery dispatch trial:',JSON.stringify(result));return result;
  };
  const timings=[await trial('recovery_first_call'),await trial('recovery_warm')];
  report.passed=false;
  const writeReport=()=>{if(process.env.R12_FULL_SHAPE_RECOVERY_REPORT){const dest=path.resolve(process.env.R12_FULL_SHAPE_RECOVERY_REPORT);assert.ok(dest.startsWith('/tmp/r12-full-shape-recovery-'));writeFileSync(dest,JSON.stringify(report,null,2)+'\n');}};
  writeReport();
  for(const timing of timings){assert.equal(timing.error,undefined,timing.error);assert.equal(timing.timeout,false);assert.equal(timing.result.shouldDispatch,true);assert.ok(timing.elapsedMs<3000);assert.equal(timing.functions.r12_discovery_scope_current.calls,7);assert.equal(timing.functions.r07_gate.calls,3);assert.equal(timing.functions.r12_pilot_profile_validate.calls,35,'Five profile validations at each of seven outer boundaries');}
  assert.deepEqual(timings[0].result,timings[1].result);
  assert.deepEqual(await sourceAt(at),source);assert.deepEqual(await closures(),closed);
  report.guards.push('seven_scope_three_gate_five_profile_boundaries','source_and_both_closures_equal','financial_and_transport_rollback');
  const rejected=async(name,action,pattern)=>{await db.exec('savepoint recovery_rejection');try{await assert.rejects(action,pattern);}finally{await db.exec('rollback to savepoint recovery_rejection');await db.exec('release savepoint recovery_rejection');}report.guards.push(name);};
  const profileDefinition=(await one("select pg_get_functiondef('private.r12_pilot_profile_validate(private.r12_discovery_scopes,timestamptz,boolean)'::regprocedure) definition")).definition;
  for(const [scope,label]of [[abandoned,'abandoned'],[charged,'charged']])for(const kind of ['current_clock','caller_clock']){
   await db.exec('savepoint recovery_clock_probe');
   try{
    await db.exec(profileDefinition.replace('FUNCTION private.r12_pilot_profile_validate(','FUNCTION private.r12_recovery_profile_probe_original('));
    const now=Date.now(),effective=new Date(now+(kind==='current_clock'?60000:-1000)).toISOString(),created=new Date(now+(kind==='current_clock'?30000:-500)).toISOString();
    await db.exec(`create or replace function private.r12_pilot_profile_validate(s private.r12_discovery_scopes,effective_at timestamptz,p_current boolean default true) returns void language plpgsql stable set search_path='' as $$ begin
     if s.id='${scope}'::uuid then s.amendment:=jsonb_set(jsonb_set(s.amendment,'{createdAt}',to_jsonb('${created}'::text)),'{profile,createdAt}',to_jsonb('${created}'::text));
      s.amendment:=jsonb_set(s.amendment,'{profileHash}',to_jsonb(private.stage14_hash(s.amendment->'profile')));s.amendment_hash:=private.stage14_hash(s.amendment);end if;
     perform private.r12_recovery_profile_probe_original(s,effective_at,p_current);end $$;`);
    await assert.rejects(()=>sourceAt(effective,false),/r12_pilot_window/);report.guards.push(label+'_'+kind+'_window');
   }finally{await db.exec('rollback to savepoint recovery_clock_probe');await db.exec('release savepoint recovery_clock_probe');}
  }
  for(const role of ['anon','authenticated','service_role'])for(const signature of ['private.r12_pilot_unsent_closure_context(uuid)','private.r12_pilot_unsent_recovery_source(private.r12_discovery_scopes,timestamptz,boolean)'])assert.equal((await one("select has_function_privilege($1,$2,'EXECUTE') allowed",[role,signature])).allowed,false);
  report.guards.push('private_recovery_helpers');
  await rejected('current_expiry',()=>sourceAt(new Date(Date.parse(metadata.focusedEnvelope.expiresAt)+1000).toISOString()),/r12_pilot_window/);
  await rejected('credential_scan',()=>db.query("select private.r12_pilot_profile_validate(jsonb_populate_record(null::private.r12_discovery_scopes,to_jsonb(s)||jsonb_build_object('amendment',jsonb_set(amendment,'{profile,history,scopeChangeExplanation}',to_jsonb('Bearer syntheticcredentialfixture1234'::text)))),$2::timestamptz,true) from private.r12_discovery_scopes s where id=$1",[sid,at]),/r04_credential_content_rejected/);
  await rejected('immutable_profile_hash',()=>db.query("select private.r12_pilot_profile_validate(jsonb_populate_record(null::private.r12_discovery_scopes,to_jsonb(s)||jsonb_build_object('amendment_hash',repeat('0',64))),$2::timestamptz,true) from private.r12_discovery_scopes s where id=$1",[sid,at]),/r12_pilot_profile_identity/);
  const changed=await trial('owner_changed_after_source_read',()=>db.query('update public.businesses set owner_user_id=$1 where id=$2',['95050000-0000-4000-8000-000000000002',metadata.businessId]));
  assert.equal(changed.timeout,false);assert.match(changed.error??JSON.stringify(changed.result),/owner|authority|scope/i);report.guards.push('owner_toctou');
  await rejected('unsent_release_required',async()=>{await db.exec('alter table private.r05_releases disable trigger all');await db.query('delete from private.r05_releases where request_id=$1',[closed.unsent.requestId]);await sourceAt(at);},/r12_recovery_|no rows/);
  await rejected('charged_settlement_required',async()=>{await db.exec('alter table private.r05_settlements disable trigger all');await db.query('delete from private.r05_settlements where request_id=$1',[closed.charged.phases[1].requestId]);await sourceAt(at);},/r12_successor_predecessor_settlement_required/);
  assert.deepEqual(await fingerprint(),initial);assert.deepEqual(await closures(),closed);
  report.passed=true;writeReport();console.log('R12 full-shape recovery passed:',JSON.stringify(report));
 }finally{await db.exec('rollback to savepoint recovery_performance');await db.exec('release savepoint recovery_performance');}
 return{continueLifecycle:true};
}
