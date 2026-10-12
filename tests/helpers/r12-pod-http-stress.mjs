/** Isolated HTTP comparison only. No hosted URL, real key or provider request. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {randomUUID} from 'node:crypto';
import {configureR12HttpRoles,startR12Postgrest,r12HttpRpc} from './r12-postgrest-http.mjs';
import {podOne,podRpc} from './r12-pod-sql-fixture.mjs';

export async function exercisePodHttpStress({db,a,claim,original,candidate,fingerprint,initial,report}){
 const container=process.env.R12_POD_POSTGRES_CONTAINER;assert.match(container??'',/^[a-f0-9]{64}$/);
 const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8'}).trim();
 const cpuBefore=Number(docker('inspect','--format','{{.HostConfig.NanoCpus}}',container));assert.equal(cpuBefore,0);
 Object.assign(report,{version:'r12.pod-http-stress.1',hardwareReplica:false,sharedBuffersCold:false,transactionEnd:'rollback',providerCalls:0,trials:[],guards:[]});
 const restoreRoles=await configureR12HttpRoles(db);let server;const pids=new Set();
 const args=()=>({p_business_id:a.f.businessId,p_goal_id:a.f.goalId,p_operation:'dispatch',p_payload:{attemptId:a.attempt.id,wireHash:a.attempt.wireHash},p_submission_id:randomUUID(),p_server_key:a.controller,p_lease_token:a.lease,p_epoch:claim.epoch,p_admission_key:a.admission});
 try{
  await db.exec("alter role r12_test set jit='off';alter role r12_test set work_mem='2184kB'");
  await db.exec(`create function public.r12_pod_http_context() returns jsonb language sql set search_path='' as $$select jsonb_build_object('actor',current_user,'deadline',current_setting('statement_timeout'),'pid',pg_backend_pid(),'jit',current_setting('jit'),'workMem',current_setting('work_mem'))$$;
   revoke all on function public.r12_pod_http_context() from public,anon,authenticated,service_role;grant execute on function public.r12_pod_http_context() to anon;`);
  for(const cpus of [1,0.25]){
   docker('update','--cpus',String(cpus),container);assert.equal(Number(docker('inspect','--format','{{.HostConfig.NanoCpus}}',container)),cpus*1e9);
   for(const [variant,definition] of [['current_sql',original],['cached_generic',candidate]]){
    await db.exec(definition);
    server=await startR12Postgrest({binary:process.env.R12_POSTGREST_BINARY,databaseUrl:process.env.R12_POSTGRES_URL,pool:1,rollback:true});report.postgrestVersion=server.version;
    const rpc=r12HttpRpc(server.base);
    const context=await rpc('r12_pod_http_context',{});assert.equal(context.ok,true,JSON.stringify(context.data));
    assert.equal(context.data.actor,'anon');assert.equal(context.data.deadline,'3s');assert.equal(context.data.jit,'off');assert.equal(context.data.workMem,'2184kB');
    assert.equal(pids.has(context.data.pid),false);pids.add(context.data.pid);
    for(const warmth of ['fresh_backend','same_backend_warm']){
     const result=await rpc('r07_controller',args(),{timeoutMs:10000});
     report.trials.push({cpus,variant,warmth,pid:context.data.pid,elapsedMs:result.elapsedMs,status:result.status,sqlState:result.data.code??null,decision:result.data.decision??null,shouldDispatch:result.data.shouldDispatch??false});
     const afterContext=await rpc('r12_pod_http_context',{});assert.equal(afterContext.data.pid,context.data.pid,'Warm comparisons cannot silently switch PostgreSQL backends');
     assert.deepEqual(await fingerprint(db),initial,'Real HTTP request must restore exact reservation, marker, attempt and financial fingerprint');
     if(result.ok)assert.equal(result.data.shouldDispatch,true,JSON.stringify(result.data));
     else assert.equal(result.data.code,'57014',JSON.stringify(result.data));
     if(variant==='cached_generic'||cpus===1)assert.equal(result.ok,true,'Normal and optimized HTTP dispatch must fit the actual anon deadline');
    }
    await server.close();server=null;
   }
  }
  // Real Business-row lock contention must still time out without admitting.
  docker('update','--cpus','1',container);await db.exec(candidate);
  server=await startR12Postgrest({binary:process.env.R12_POSTGREST_BINARY,databaseUrl:process.env.R12_POSTGRES_URL,pool:1,rollback:true});
  const rpc=r12HttpRpc(server.base),warmContext=await rpc('r12_pod_http_context',{});const warm=await rpc('r07_controller',args());assert.equal(warm.data.shouldDispatch,true);
  assert.equal((await rpc('r12_pod_http_context',{})).data.pid,warmContext.data.pid);
  await db.exec('begin');await db.query('select 1 from public.businesses where id=$1 for update',[a.f.businessId]);
  try{const pending=rpc('r07_controller',args());let waiting=false;
   for(let n=0;n<40&&!waiting;n++){await db.query('select pg_stat_clear_snapshot()');waiting=(await podOne(db,"select exists(select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock' and pg_backend_pid()=any(pg_blocking_pids(pid))) waiting",[warmContext.data.pid])).waiting;if(!waiting)await delay(50);}
   const locked=await pending;assert.equal(waiting,true,'Observe the exact HTTP backend waiting on our held Business lock');assert.equal(locked.ok,false);assert.equal(locked.data.code,'57014');report.lock={elapsedMs:locked.elapsedMs,sqlState:locked.data.code,observedBackendLock:true};}
  finally{await db.exec('rollback');}
  assert.deepEqual(await fingerprint(db),initial);report.guards.push('business_lock_respects_3s_and_no_marker');
  assert.equal((await rpc('r12_pod_http_context',{})).data.pid,warmContext.data.pid,'Stop checks the already-warmed backend');
  // Commit genuine isolated owner Stop after warming the same HTTP backend.
  await podRpc(db,'authenticated',a.f.ownerId,'r12_pod_owner_server',[a.f.businessId,'stop',{setupId:a.prepared.setupId,setupHash:a.prepared.setupHash,submissionId:randomUUID()},a.f.bootstrapKey]);
  const stopped=await rpc('r07_controller',args());assert.equal(stopped.data.shouldDispatch,false);assert.equal(stopped.data.decision,'blocked');assert.equal((await rpc('r12_pod_http_context',{})).data.pid,warmContext.data.pid);
  const after=await fingerprint(db);assert.equal(after.admission_markers,0);assert.equal(after.transport_claims,0);assert.deepEqual(after.finance,initial.finance);
  assert.equal((await podOne(db,'select count(*)::int n from private.r05_revocations where policy_id=(select policy_id from private.r12_pod_setups where id=$1)',[a.prepared.setupId])).n,1);
  report.guards.push('warmed_http_owner_stop_blocks','old_unknown_and_new_reservation_retained','provider_transport_never_called');
  report.passed=true;return report;
 }finally{
  try{if(server)await server.close();}finally{docker('update','--cpus',String(cpuBefore/1e9),container);
  await db.exec(original);await db.exec('drop function if exists public.r12_pod_http_context();alter role r12_test reset jit;alter role r12_test reset work_mem;');await restoreRoles();}
 }
}
