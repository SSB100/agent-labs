/** Explicit isolated diagnostic, never release qualification or live authority. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {r04SqlBootstrap} from './helpers/r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './helpers/r10-sql-fixture.mjs';
import {validateOwnerInitialRaceEnvironment} from './helpers/r12-owner-initial-postgres-races.mjs';
import {preparePodDispatchProfile} from './helpers/r12-pod-dispatch-profile.mjs';
import {seedLegacyShape} from './helpers/r12-pod-diagnostic-legacy.mjs';
import {podOne} from './helpers/r12-pod-sql-fixture.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
test('Current POD dispatch is the first application call on each fresh native backend',{
 skip:process.env.R12_POD_FRESH_BACKEND!=='1',timeout:180000,
},async()=>{
 const target=validateOwnerInitialRaceEnvironment(process.env),require=createRequire(path.resolve(target.host,'package.json'));
 assert.equal(require('pg/package.json').version,'8.16.3');const {Client}=require('pg');
 const report={version:'r12.pod-fresh-backend-diagnostic.1',releaseQualified:false,providerCalls:0,
  candidateFirst:true,sharedBuffersCold:false,history:'synthetic aggregate shape; no private rows exported',trials:[]};
 const clients=[],originalFetch=globalThis.fetch;let externalHttp=0;
 globalThis.fetch=async()=>{externalHttp++;throw Error('External HTTP forbidden in this isolated diagnostic');};
 const connect=async label=>{const db=new Client({connectionString:target.url,ssl:false,connectionTimeoutMillis:5000,application_name:label});clients.push(db);await db.connect();db.exec=sql=>db.query(sql);return db;};
 try{
  const setup=await connect('pod-fresh-setup');report.setupPid=setup.processID;
  assert.deepEqual(await podOne(setup,'select current_user role,current_database() db,host(inet_server_addr()) host'),{role:'r12_test',db:'r12_test',host:target.address});
  assert.equal((await podOne(setup,"select count(*)::int n from pg_tables where schemaname in ('public','private')")).n,0,'Fresh isolated service database required');
  await setup.exec(r04SqlBootstrap+sessionBootstrap);
  for(const file of readdirSync(root+'/supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await setup.exec(readFileSync(root+'/supabase/migrations/'+file,'utf8'));
  const a=await preparePodDispatchProfile(setup,{seedHistory:seedLegacyShape,additionalUnsent:1});report.legacyShape=a.legacyShape;
  const claim=await a.command('claim',{seconds:120}),attempt=a.attempt;
  const fingerprint=db=>podOne(db,`select
   (select count(*)::int from private.r05_markers where request_id=$1) admission_markers,
   (select count(*)::int from private.r07_markers where attempt_id=$2) controller_markers,
   (select count(*)::int from private.r12_discovery_transport_claims where request_id=$1) transport_claims,
   (select status from private.r07_attempts where id=$2) attempt_status,
   private.r12_pod_finance($3) finance`,[attempt.requestId,attempt.id,a.f.businessId]);
  const initial=await fingerprint(setup);assert.equal(initial.attempt_status,'reserved');assert.equal(initial.admission_markers,0);assert.equal(initial.transport_claims,0);
  report.shape=await podOne(setup,`select
   (select count(*)::int from private.r05_requests where business_id=$1) requests,
   (select count(*)::int from private.r05_markers where business_id=$1) markers,
   (select count(*)::int from private.r05_settlements where business_id=$1) settlements,
   (select octet_length(pins::text) from private.r12_pod_templates where id=$2) pins_bytes,
   (select octet_length(source_policy::text) from private.r12_pod_templates where id=$2) source_policy_bytes`,[a.f.businessId,a.f.templateId]);
  assert.deepEqual(report.shape,{requests:31,markers:28,settlements:44,pins_bytes:27731,source_policy_bytes:919});
  await setup.end();report.setupConnectionClosed=true;
  const backendPids=new Set([report.setupPid]);
  for(let backend=0;backend<2;backend++){
   const db=await connect('pod-fresh-candidate-'+backend);
   assert.equal(backendPids.has(db.processID),false,'Each candidate trial pair requires a distinct backend');backendPids.add(db.processID);
   assert.equal((await podOne(db,'select count(*)::int n from pg_stat_activity where pid=$1',[report.setupPid])).n,0);
   await db.exec("set jit='off';set work_mem='2184kB'");
   report.engine=await podOne(db,"select version() version,current_setting('server_version') server_version,current_setting('jit') jit,current_setting('work_mem') work_mem,current_setting('shared_buffers') shared_buffers,current_setting('plan_cache_mode') plan_cache_mode");
   // No original implementation trial, claim, validation or application read is
   // executed on this connection before the first measured candidate dispatch.
   for(const warmth of ['fresh_backend','same_backend_warm']){
    const trial={backend,pid:db.processID,warmth};report.trials.push(trial);
    await db.exec("begin;set local track_functions='all';set local statement_timeout='3s';set local lock_timeout='500ms';set local role anon;savepoint dispatch_trial");
    assert.deepEqual(await podOne(db,"select current_user actor,current_setting('statement_timeout') deadline"),{actor:'anon',deadline:'3s'});
    const started=performance.now();
    try{trial.result=(await podOne(db,'select public.r07_controller($1,$2,$3,$4,$5,$6,$7,$8,$9) result',
     [a.f.businessId,a.f.goalId,'dispatch',{attemptId:attempt.id,wireHash:attempt.wireHash},randomUUID(),a.controller,a.lease,claim.epoch,a.admission])).result;}
    catch(error){trial.error=error.message;trial.sqlState=error.code;trial.context=error.where;}
    finally{trial.elapsedMs=Math.round(performance.now()-started);await db.exec('rollback to savepoint dispatch_trial;reset role');}
    trial.functions=(await db.query("select schemaname||'.'||funcname name,calls,total_time total_ms,self_time self_ms from pg_stat_xact_user_functions where schemaname in ('private','public') and calls>0 order by self_time desc")).rows;
    await db.exec('rollback');assert.deepEqual(await fingerprint(db),initial,'Every dispatch trial restores the complete financial/marker/attempt fingerprint');
    trial.rollbackVerified=true;
   }
   await db.end();
  }
  // Positive native deadline control, separate from every measured backend.
  const control=await connect('pod-fresh-deadline-control');await control.exec("set statement_timeout='3s'");
  await assert.rejects(control.query('select pg_sleep(3.2)'),error=>error.code==='57014');report.nativeDeadlineEnforced=true;
  assert.equal(externalHttp,0);
  report.passed=report.trials.every(t=>!t.error&&t.result?.shouldDispatch===true&&t.elapsedMs<3000);
  assert.equal(report.passed,true,'A fresh candidate backend must complete the unchanged full dispatch within three seconds');
 }finally{
  globalThis.fetch=originalFetch;
  await Promise.all(clients.map(db=>db.end().catch(()=>{})));
  writeFileSync('/tmp/r12-pod-fresh-backend.json',JSON.stringify(report,null,2)+'\n');
  console.log('POD fresh-backend diagnostic:',JSON.stringify({passed:report.passed??false,releaseQualified:false,providerCalls:0,trials:report.trials.map(({functions,...t})=>({...t,functionCount:functions?.length??0}))}));
 }
});
