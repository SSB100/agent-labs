import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {startFixtureBoundary} from './next-fixture/server.mjs';
import {r12RuntimeRpc,R12_RUNTIME_RPC_ARGUMENTS} from './next-fixture/r12-sql.mjs';

const args=()=>({p_business_id:'business',p_goal_id:'goal',p_scope_id:'recovery-scope',p_payload:{attemptId:'attempt',wireHash:'a'.repeat(64)},p_submission_id:'submission',p_server_key:'inert-controller',p_lease_token:'inert-lease',p_epoch:7,p_admission_key:'inert-admission'});
function sqlFixture({denied=false,timeout=false}={}){
 const calls=[],execs=[],db={close:async()=>{},exec:async sql=>{execs.push(sql);if(sql.startsWith('do $$'))throw Object.assign(Error('Synthetic deadline'),{code:'57014'});},query:async(sql,values)=>{
  if(sql.startsWith('select * from public.'))return{rows:[]};
  calls.push({sql,values});if(denied)throw Error('r12_recovery_dispatch_authority_required');return{rows:[{result:{shouldDispatch:true,reason:'marked'}}]};
 }};
 return{state:{r12:{db,simulateDispatchTimeout:timeout},db:{}},calls,execs};
}

test('Next recovery HTTP route forwards its nine exact arguments to the canonical recovery-only SQL function',async()=>{
 const boundary=await startFixtureBoundary(),f=sqlFixture();boundary.state().r12=f.state.r12;
 try{
  const client=createClient(boundary.origin,'inert-publishable-key',{auth:{autoRefreshToken:false,persistSession:false,detectSessionInUrl:false}});
  const result=await client.rpc('r12_recovery_dispatch',args());assert.equal(result.error,null);assert.deepEqual(result.data,{shouldDispatch:true,reason:'marked'});
  assert.deepEqual(f.calls,[{sql:'select public.r12_recovery_dispatch($1,$2,$3,$4,$5,$6,$7,$8,$9) result',values:['business','goal','recovery-scope',{attemptId:'attempt',wireHash:'a'.repeat(64)},'submission','inert-controller','inert-lease',7,'inert-admission']}]);
  assert.deepEqual(boundary.denied,[]);assert.deepEqual(boundary.effects,[]);assert.ok(f.execs.includes('set role anon'));assert.equal(f.execs.at(-1),'reset role');
 }finally{await boundary.close();}
});

test('Next recovery runtime forwards only inputs bind send with six exact scoped arguments',async()=>{
 const boundary=await startFixtureBoundary(),f=sqlFixture();boundary.state().r12=f.state.r12;
 try{
  const client=createClient(boundary.origin,'inert-publishable-key',{auth:{autoRefreshToken:false,persistSession:false,detectSessionInUrl:false}});
  for(const operation of ['inputs','bind','send']){
   const input={p_business_id:'business',p_scope_id:'scope',p_attempt_id:'attempt',p_operation:operation,p_payload:{inert:true},p_server_key:'inert-controller'};
   const result=await client.rpc('r12_recovery_server',input);assert.equal(result.error,null);
   assert.deepEqual(f.calls.at(-1),{sql:'select public.r12_recovery_server($1,$2,$3,$4,$5,$6) result',values:['business','scope','attempt',operation,{inert:true},'inert-controller']});
  }
  assert.deepEqual(boundary.denied,[]);assert.deepEqual(boundary.effects,[]);
  const input={p_business_id:'business',p_scope_id:'scope',p_attempt_id:'attempt',p_operation:'inputs',p_payload:{},p_server_key:'inert-controller'};
  for(const changed of [{...input,p_operation:'stage'},{...input,p_goal_id:'extra'},Object.fromEntries(Object.entries(input).filter(([key])=>key!=='p_scope_id'))])await assert.rejects(r12RuntimeRpc(f.state,'r12_recovery_server',changed),/signature|unavailable/);
  assert.equal(f.calls.length,3);
 }finally{await boundary.close();}
});

test('All three pre-existing Next runtime routes retain their exact SQL signatures',async()=>{
 const boundary=await startFixtureBoundary(),f=sqlFixture();boundary.state().r12=f.state.r12;
 const cases=[
  ['r07_controller',['p_business_id','p_goal_id','p_operation','p_payload','p_submission_id','p_server_key','p_lease_token','p_epoch','p_admission_key']],
  ['r12_discovery_server',['p_business_id','p_attempt_id','p_operation','p_payload','p_server_key']],
  ['creative_runtime_transition',['p_creative_run_id','p_business_id','p_runtime_capability','p_operation','p_payload']],
 ];
 try{
  const client=createClient(boundary.origin,'inert-publishable-key',{auth:{autoRefreshToken:false,persistSession:false,detectSessionInUrl:false}});
  for(const [name,keys]of cases){
   const input=Object.fromEntries(keys.map(key=>[key,key==='p_payload'?{inert:true}:key==='p_epoch'?9:key]));
   const result=await client.rpc(name,input);assert.equal(result.error,null);assert.deepEqual(f.calls.at(-1),{sql:`select public.${name}(${keys.map((_,i)=>`$${i+1}`).join(',')}) result`,values:keys.map(key=>input[key])});
  }
  assert.equal(f.calls.length,3);assert.deepEqual(boundary.denied,[]);assert.deepEqual(boundary.effects,[]);
 }finally{await boundary.close();}
});

test('Next recovery adapter cannot select a generic operation or fall back after a scope rejection',async()=>{
 const f=sqlFixture();for(const edited of [{...args(),p_operation:'reserve'},Object.fromEntries(Object.entries(args()).filter(([key])=>key!=='p_scope_id'))])await assert.rejects(r12RuntimeRpc(f.state,'r12_recovery_dispatch',edited),/exact dispatch signature/);
 await assert.rejects(r12RuntimeRpc(f.state,'unknown_runtime',args()),/RPC unavailable/);assert.deepEqual(f.calls,[]);assert.deepEqual(f.execs,[]);
 const rejected=sqlFixture({denied:true}),result=await r12RuntimeRpc(rejected.state,'r12_recovery_dispatch',{...args(),p_scope_id:'ordinary-successor-scope'});
 assert.equal(result.data,null);assert.match(result.error.message,/recovery_dispatch_authority_required/);assert.equal(rejected.calls.length,1);assert.match(rejected.calls[0].sql,/public\.r12_recovery_dispatch\(/);assert.equal(rejected.calls[0].values[2],'ordinary-successor-scope');
});

test('Next simulated pre-commit deadline preserves rollback for generic and recovery dispatch',async()=>{
 for(const name of ['r07_controller','r12_recovery_dispatch']){
  const f=sqlFixture({timeout:true}),input=name==='r07_controller'?{...args(),p_operation:'dispatch'}:args();if(name==='r07_controller')delete input.p_scope_id;
  const result=await r12RuntimeRpc(f.state,name,input);assert.equal(result.data,null);assert.equal(result.error.code,'57014');assert.equal(f.calls.length,1);assert.ok(f.calls[0].sql.startsWith(`select public.${name}(`));assert.deepEqual(f.calls[0].values,R12_RUNTIME_RPC_ARGUMENTS[name].map(key=>input[key]));assert.equal(f.execs[0],'begin');assert.equal(f.execs.at(-1),'rollback');
 }
});

test('Unknown or unloaded REST RPCs return a real 404 and Supabase error rather than HTTP 200 data',async()=>{
 const boundary=await startFixtureBoundary();
 try{
  const client=createClient(boundary.origin,'inert-publishable-key',{auth:{autoRefreshToken:false,persistSession:false,detectSessionInUrl:false}});
  for(const name of ['unknown_runtime','r12_recovery_dispatch','r12_recovery_server']){const result=await client.rpc(name,args());assert.equal(result.status,404);assert.equal(result.data,null);assert.equal(result.error.code,'PGRST202');}
  const f=sqlFixture();boundary.state().r12=f.state.r12;const result=await client.rpc('unknown_runtime',args());assert.equal(result.status,404);assert.equal(result.data,null);assert.equal(result.error.code,'PGRST202');assert.deepEqual(f.calls,[]);assert.deepEqual(boundary.effects,[]);assert.equal(boundary.denied.length,4);
 }finally{await boundary.close();}
});
