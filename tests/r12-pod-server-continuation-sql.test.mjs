/** Socket-free qualification of fresh durable steps over the real server,
 * controller store and SQL. Only external transports are inert. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {createHmac,randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {r04SqlBootstrap} from './helpers/r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './helpers/r10-sql-fixture.mjs';
import {podSqlFixture,podQuoteFixture,podPlannerPreflight,podSha,podInertOutputs,podOne} from './helpers/r12-pod-sql-fixture.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(import.meta.url),ts=require('typescript');
const host=process.env.R12_SQL_TEST_HOST??process.env.R11_SQL_TEST_HOST;
const inertRoot='inert-socket-free-pod-runtime-root-0123456789';
const capability=createHmac('sha256',inertRoot).update('r12.pod-owner-application.1').digest('base64url');

async function continuationFixture(db){
 const log=[],generations=new Map(),modules=new Map();
 const seedDb={exec:(...args)=>db.exec(...args),query:(sql,args)=>{
  if(sql.startsWith('insert into private.r12_pod_templates(')){args=[...args];args[6]=podSha(capability);}
  return db.query(sql,args);
 }};
 const f=await podSqlFixture(seedDb),quote=podQuoteFixture();
 const prepared=await f.server('prepare',{input:f.input,quote},capability);
 const derive=role=>createHmac('sha256',inertRoot).update(JSON.stringify({version:'r12.scoped-authority.1',role,businessId:f.businessId,ownerId:f.ownerId,scopeId:prepared.scopeId})).digest('base64url');
 await f.server('confirm',{setupId:prepared.setupId,setupHash:prepared.setupHash,submissionId:randomUUID(),controllerKeyHash:podSha(derive('controller')),admissionKeyHash:podSha(derive('admission')),quote,preflight:await podPlannerPreflight(prepared,quote)},capability);
 const client={rpc:async(name,args)=>{
  assert.ok(['r12_pod_runtime_read','r12_pod_pass_server','r07_controller','r12_discovery_server'].includes(name));
  await db.query("select set_config('request.jwt.claim.sub','',false)");await db.exec('set role anon');
  try{
   const keys=Object.keys(args),result=await db.query(`select public.${name}(${keys.map((k,i)=>k+' => $'+(i+1)).join(',')}) result`,Object.values(args));
   log.push({rpc:name,operation:args.p_operation,leaseHash:args.p_lease_token?podSha(args.p_lease_token):null});
   return{data:result.rows[0].result,error:null};
  }catch(error){log.push({rpc:name,operation:args.p_operation,error:error.message});return{data:null,error:{message:error.message}};}
  finally{await db.exec('reset role');}
 }};
 const fetcher=phase=>async(url,init)=>{
  const model=phase==='review'?'anthropic/claude-4.5-haiku-20251001':'openai/gpt-5.6-luna-20260709';
  if(init.method==='POST'){
   const attempt=await podOne(db,"select a.id,a.adaptive_action_ordinal ordinal from private.r07_attempts a join private.r07_plans p on p.id=a.plan_id where p.content->>'discoveryScopeId'=$1 and a.step_key=$2 and a.status='dispatched' order by a.adaptive_action_ordinal desc limit 1",[prepared.scopeId,phase]);
   assert.ok(attempt);const output=podInertOutputs({passOrdinal:attempt.ordinal,useful:attempt.ordinal===1}),id='gen-inert-socket-'+attempt.id;
   assert.equal(generations.has(id),false,'A fresh durable invocation cannot replay a paid POST');generations.set(id,phase);
   log.push({provider:'POST',phase,ordinal:attempt.ordinal,attemptId:attempt.id});
   const message=phase==='search1'?{content:'Explicitly synthetic source material.',annotations:output.search1.annotations}:{content:JSON.stringify(output[phase])};
   return new Response(JSON.stringify({id,model,choices:[{finish_reason:'stop',message}],usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150,cost:0.00001,...(phase==='search1'?{server_tool_use_details:{web_search_requests:1}}:{})}}),{status:200});
  }
  assert.equal(init.method,'GET');const id=new URL(url).searchParams.get('id');assert.ok(generations.has(id));
  assert.equal((await podOne(db,"select count(*)::int n from private.r12_discovery_candidates where candidate->>'providerRequestId'=$1",[id])).n,1);
  log.push({provider:'GET',phase});
  return new Response(JSON.stringify({data:{id,provider_name:phase==='review'?'Amazon Bedrock':'Azure',model}}),{status:200});
 };
 function source(name){
  const file=path.resolve(root,'src',name.endsWith('.ts')?name:name+'.ts');
  if(modules.has(file))return modules.get(file).exports;
  const mod={exports:{}};modules.set(file,mod);
  const code=ts.transpileModule(readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const local=name=>{
   if(name==='server-only')return{};
   if(!name.startsWith('.'))return require(name);
   let resolved=path.resolve(path.dirname(file),name);
   if(resolved===path.join(root,'src/lib/supabase/runtime'))return{createRuntimeClient:()=>client};
   if(resolved===path.join(root,'src/products/discovery-r12-server-dependencies'))return{discoveryR12ServerDependencies:()=>({
    // Fresh real stores deliberately receive distinct random lease tokens.
    createController:source('lib/quest-controller-runtime').createQuestControllerStore,
    createClient:()=>client,quote:async()=>podQuoteFixture(),
    createAdapter:options=>source('products/discovery-r12-adapter').createDiscoveryR12QuestAdapter({...options,
     config:{apiKey:'inert-no-network',baseUrl:'https://openrouter.ai/api/v1',appUrl:'https://agent-labs-two.vercel.app',appName:'Agent Labs'},fetcher:fetcher(options.phase)}),
   })};
   if(existsSync(resolved+'.ts'))resolved+='.ts';else if(existsSync(path.join(resolved,'index.ts')))resolved=path.join(resolved,'index.ts');else return require(resolved);
   return source(path.relative(path.join(root,'src'),resolved));
  };
  new Function('require','module','exports',code)(local,mod,mod.exports);return mod.exports;
 }
 const server=source('products/discovery-r12-server');
 return{f,prepared,log,run:()=>server.continuePodResearchRuntime(f.businessId,prepared.scopeId),
  posts:()=>log.filter(x=>x.provider==='POST'),claims:()=>log.filter(x=>x.rpc==='r07_controller'&&x.operation==='claim'),
  expireLease:()=>db.query("update private.r07_heads set lease_expires_at=clock_timestamp()-interval '1 second' where business_id=$1 and goal_id=$2",[f.businessId,f.goalId]),
  head:()=>podOne(db,'select lease_expires_at,state,reason from private.r07_heads where business_id=$1 and goal_id=$2',[f.businessId,f.goalId]),
 };
}

test('POD real server resumes across a fresh durable-step controller lease without paid replay',{skip:!host,timeout:180000},async t=>{
 const envKeys=['VERCEL_ENV','R05_ADMISSION_SERVER_KEY','OPENROUTER_API_KEY','VERCEL_GIT_COMMIT_SHA','VERCEL_DEPLOYMENT_ID'];
 const oldEnv=Object.fromEntries(envKeys.map(key=>[key,process.env[key]])),oldFetch=globalThis.fetch;
 Object.assign(process.env,{VERCEL_ENV:'production',R05_ADMISSION_SERVER_KEY:inertRoot,OPENROUTER_API_KEY:'inert-no-network',VERCEL_GIT_COMMIT_SHA:'a'.repeat(40),VERCEL_DEPLOYMENT_ID:'dpl_inert_socket_free'});
 let network=0;globalThis.fetch=async()=>{network++;throw Error('External network forbidden in socket-free qualification');};
 const hostRequire=createRequire(path.resolve(host,'package.json')),{PGlite}=hostRequire('@electric-sql/pglite'),{pgcrypto}=hostRequire('@electric-sql/pglite/contrib/pgcrypto');
 const db=new PGlite({extensions:{pgcrypto}});
 try{
  await db.exec(r04SqlBootstrap+sessionBootstrap);
  for(const file of readdirSync(root+'/supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync(root+'/supabase/migrations/'+file,'utf8'));
  async function atStepBoundary(){
   const a=await continuationFixture(db),first=await a.run();assert.equal(first.status,'waiting');assert.equal(first.reason,'continue_saved_progress');assert.equal(a.posts().length,6);
   assert.deepEqual(a.posts().map(x=>[x.ordinal,x.phase]),[[0,'plan'],[0,'search1'],[0,'select1'],[0,'strategy'],[0,'review'],[1,'plan']]);
   const priorClaims=a.claims().length,priorPosts=a.posts().length,head=await a.head(),waiting=await a.run();
   assert.equal(waiting.status,'waiting');assert.equal(waiting.reason,'controller_lease_pending');assert.equal(Date.parse(waiting.wakeAt),new Date(head.lease_expires_at).getTime()+1000);
   assert.equal(a.claims().length,priorClaims,'A live prior lease is observed before any fresh claim');assert.equal(a.posts().length,priorPosts);
   return a;
  }
  await t.test('24-transition boundary waits on the live lease then resumes the saved second planner and useful review',async()=>{
   const a=await atStepBoundary(),oldClaims=a.claims().length;
   // Mutable lease clock in the isolated database only. No process waits,
   // immutable receipts, SQL guards or production clock are changed.
   await a.expireLease();const final=await a.run();assert.equal(final.status,'completed');assert.equal(final.reason,'reviewed_hypothesis_ready');
   assert.equal(a.posts().length,10);assert.equal(a.log.filter(x=>x.provider==='GET').length,10);assert.equal(new Set(a.posts().map(x=>x.attemptId)).size,10);
   assert.notEqual(a.claims()[oldClaims].leaseHash,a.claims()[0].leaseHash,'Distinct durable invocations retain distinct lease tokens');
   assert.deepEqual((await db.query('select ordinal,outcome from private.r12_pod_pass_closures where scope_id=$1 order by ordinal',[a.prepared.scopeId])).rows,[{ordinal:0,outcome:'INSUFFICIENT_EVIDENCE'},{ordinal:1,outcome:'HYPOTHESIS_TO_TEST'}]);
   assert.equal((await a.f.read()).finance.committedMicrounits,'100');assert.equal((await a.f.read()).finance.hasUnknown,false);
   assert.equal(a.log.some(x=>x.error),false,JSON.stringify(a.log.filter(x=>x.error)));
  });
  await t.test('Stop at the durable-step boundary never sends again while waiting or after exact lease expiry',async()=>{
   const a=await atStepBoundary();await a.f.server('stop',{setupId:a.prepared.setupId,setupHash:a.prepared.setupHash,submissionId:randomUUID()},'');
   const claims=a.claims().length,waiting=await a.run();assert.equal(waiting.reason,'controller_lease_pending');assert.equal(a.claims().length,claims);assert.equal(a.posts().length,6);
   await a.expireLease();const stopped=await a.run();assert.ok(['blocked','stopped'].includes(stopped.status),JSON.stringify(stopped));assert.equal(a.posts().length,6);
   assert.equal((await a.f.read()).finance.committedMicrounits,'60');assert.equal((await a.f.read()).finance.hasUnknown,false);
   assert.equal((await podOne(db,'select count(*)::int n from private.r12_pod_passes where scope_id=$1',[a.prepared.scopeId])).n,2);
   assert.equal(a.log.some(x=>x.error),false,JSON.stringify(a.log.filter(x=>x.error)));
  });
  assert.equal(network,0);
 }finally{await db.close();globalThis.fetch=oldFetch;for(const [key,value]of Object.entries(oldEnv)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
