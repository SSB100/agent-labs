/** Real loopback PostgREST only. This helper never accepts a hosted DB/API URL. */
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
export const POSTGREST_VERSION='13.0.7';
export const POSTGREST_ARCHIVE_SHA256='4153f81ccc40e7b735edc89cd84b49da25ba27eb37d57c7f6a82c9005a0b762b';
export const POSTGREST_ARCHIVE_URL=`https://github.com/PostgREST/postgrest/releases/download/v${POSTGREST_VERSION}/postgrest-v${POSTGREST_VERSION}-linux-static-x86-64.tar.xz`;
export function validateR12HttpDatabase(value){
 const url=new URL(value);
 assert.ok(url.protocol==='postgresql:'&&url.hostname==='127.0.0.1'&&url.username==='r12_test'&&url.pathname==='/r12_test'&&!url.search&&!url.hash,'Only fresh isolated loopback r12_test is allowed');
 return value;
}
const freePort=async()=>{const server=createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const port=server.address().port;await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));return port;};
export async function startR12Postgrest({binary,databaseUrl}){
 validateR12HttpDatabase(databaseUrl);assert.equal(execFileSync(binary,['--version'],{encoding:'utf8'}).trim(),`PostgREST ${POSTGREST_VERSION}`,'Pinned official PostgREST required');
 const port=await freePort(),base=`http://127.0.0.1:${port}`;let log='';
 const child=spawn(binary,[],{env:{...process.env,PGRST_DB_URI:databaseUrl,PGRST_DB_SCHEMAS:'public',PGRST_DB_ANON_ROLE:'anon',PGRST_SERVER_HOST:'127.0.0.1',PGRST_SERVER_PORT:String(port),PGRST_DB_POOL:'3',PGRST_DB_POOL_ACQUISITION_TIMEOUT:'3',PGRST_DB_HOISTED_TX_SETTINGS:'statement_timeout,plan_filter.statement_cost_limit,default_transaction_isolation',PGRST_JWT_SECRET:'inert-r12-http-qualification-secret-only-0123456789',PGRST_LOG_LEVEL:'crit'},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',b=>{log=(log+b).slice(-10000);});child.stderr.on('data',b=>{log=(log+b).slice(-10000);});
 const close=async()=>{if(child.exitCode!==null)return;child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),delay(3000).then(()=>{if(child.exitCode===null)child.kill('SIGKILL');})]);};
 try{for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error(`PostgREST exited: ${log}`);try{const r=await fetch(base,{signal:AbortSignal.timeout(500)});if(r.ok)return{base,close,version:POSTGREST_VERSION};}catch{}await delay(100);}throw Error(`PostgREST startup timeout: ${log}`);}catch(error){await close();throw error;}
}
export function r12HttpRpc(base,report=[]){
 const url=new URL(base);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.protocol,'http:');
 return async(name,args,{timeoutMs=12000}={})=>{
  assert.match(name,/^[a-z][a-z0-9_]+$/);const start=performance.now();
  const response=await fetch(`${base}/rpc/${name}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(timeoutMs)});
  const data=await response.json(),elapsedMs=Math.round(performance.now()-start);
  // Only nonsecret timings/statuses leave the harness. Never record RPC args.
  report.push({rpc:name,operation:args.p_operation??(name==='r12_recovery_dispatch'?'dispatch':null),elapsedMs,status:response.status,code:response.ok?null:data.code??null});
  return{ok:response.ok,status:response.status,data,elapsedMs};
 };
}
export async function prepareCommittedR12Recovery(){
 assert.equal(process.env.R12_RPC_HTTP_ONLY,'1');assert.equal(process.env.R12_SQL_FULL_SHAPE,'1');validateR12HttpDatabase(process.env.R12_POSTGRES_URL);
 const {prepareR12OwnerWorkflows}=await import('../r12-discovery-scope-sql.test.mjs');
 const {createClosedUnsentSuccessor,exerciseFocusedPilotUnsentRecoveryLifecycle}=await import('./r12-focused-pilot-unsent-recovery-sql-fixture.mjs');
 const {fullShapeProfileFixture,fullShapeFocusedStrategyOutput}=await import('./r12-full-shape-fixture.mjs');
 const fixture=await prepareR12OwnerWorkflows();let context;
 try{await fixture.captureFocusedHttp(async({db,closedFocused})=>{
  const closedUnsent=await createClosedUnsentSuccessor(db,closedFocused,{nested:true,profileFixture:fullShapeProfileFixture,strategyOutput:fullShapeFocusedStrategyOutput});
  await(await import('./r12-next-refreshed-preparation.mjs')).exerciseR12NextRefreshedPreparation(db,closedUnsent);
  const result=await exerciseFocusedPilotUnsentRecoveryLifecycle(db,closedUnsent,{nested:true,refreshEvidence:true,profileFixture:fullShapeProfileFixture,strategyOutput:fullShapeFocusedStrategyOutput,onReservedDispatch:async ctx=>{ctx.sendFreshness=await(await import('./r12-recovery-send-freshness.mjs')).exerciseRecoverySendFreshness(ctx);context=ctx;return{capturedHttp:true};}});
  assert.deepEqual(result,{capturedHttp:true});
 });assert.ok(context);return{...fixture,context};}catch(error){await fixture.close();throw error;}
}
export const R12_RPC_ARGUMENTS={
 r07_controller:['p_business_id','p_goal_id','p_operation','p_payload','p_submission_id','p_server_key','p_lease_token','p_epoch','p_admission_key'],
 r12_discovery_server:['p_business_id','p_attempt_id','p_operation','p_payload','p_server_key'],
};
