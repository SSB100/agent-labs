/** Actual owner source + migrated isolated SQL. The retained quote expires
 * naturally; all grants, approval, release and setup state use genuine APIs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';
import {setupRecoveryDatabase,setupRecoveryFixture,publishInertRepairRelease,applyReleaseSuccessor} from './helpers/r12-steel-setup-recovery-fixture.mjs';
import {one} from './helpers/r12-owner-initial-sql-fixture.mjs';
const require=createRequire(import.meta.url),root=resolve('.');
function sourceLoader(overrides){
 const cache=new Map();
 function load(name){const file=resolve(root,name);if(Object.hasOwn(overrides,file))return overrides[file];if(cache.has(file))return cache.get(file).exports;
  assert.ok(file.startsWith(root+'/src/'));const unit={exports:{}};cache.set(file,unit);
  const code=ts.transpileModule(readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('require','module','exports',code)(name=>{
   if(Object.hasOwn(overrides,name))return overrides[name];if(name==='server-only')return {};
   if(name.startsWith('.')||name.startsWith('@/'))return load((name.startsWith('@/')?resolve(root,'src',name.slice(2)):resolve(dirname(file),name))+'.ts');
   assert.ok(['node:crypto','playwright-core','sharp'].includes(name),'Unexpected external import '+name);return require(name);
  },unit,unit.exports);return unit.exports;
 }return load;
}
const counts=db=>one(db,`select (select count(*)::int from private.r12_etsy_steel_setups) setups,(select count(*)::int from private.r05_reservations) reservations,(select count(*)::int from private.r05_markers) markers,(select count(*)::int from private.r12_steel_setup_repair_debits) debits,(select count(*)::int from private.r12_steel_create_config_uses) config_uses`);
test('replacement owner preparation revalidates expired pricing before saving exact access without provider effects',{skip:!process.env.R12_SQL_TEST_HOST,timeout:240000},async()=>{
 const db=await setupRecoveryDatabase(),oldFetch=globalThis.fetch,oldEnv={...process.env};let networkCalls=0;
 globalThis.fetch=async()=>{networkCalls++;throw Error('External IO forbidden');};
 try{
  await applyReleaseSuccessor(db);
  const x=await setupRecoveryFixture(db,{quoteValidForMs:10000,setupScope:a=>({profileAccessExpiresAt:a.prepared.expiresAt})});
  await x.stop();const recovery=await x.recovery('record',{...x.pins,usage:x.usage});await publishInertRepairRelease(db,x);
  const {proposal:p}=await x.replacement('prepare',{operationId:x.setup.scope.operationId,recoveryHash:recovery.recoveryHash,submissionId:randomUUID()});
  await x.replacement('confirm',{proposalId:p.proposalId,proposalHash:p.proposalHash,submissionId:randomUUID()});
  Object.assign(process.env,{VERCEL_GIT_COMMIT_SHA:x.repair.deployment.releaseCommitSha,VERCEL_DEPLOYMENT_ID:x.repair.deployment.deploymentId});
  const calls=[],errors=[];let rejectRevalidation=false;
  const client=role=>({auth:{getClaims:async()=>({data:{claims:{sub:x.f.ownerId}},error:null})},rpc:async(name,args)=>{
   const allowed=role==='authenticated'?['r12_owner_direct_read','r12_owner_direct_server','r12_etsy_steel_owner','r12_owner_steel_replacement']:['r12_direct_setup_quote_revalidate','r12_etsy_steel_server'];assert.ok(allowed.includes(name));
   calls.push({role,name,operation:args.p_operation??args.p_kind,args:structuredClone(args)});
   if(rejectRevalidation&&name==='r12_direct_setup_quote_revalidate')return{data:null,error:{message:'inert revalidation rejected'}};
   await db.query("select set_config('request.jwt.claim.sub',$1,false)",[x.f.ownerId]);await db.exec('set role '+role);
   try{const names=Object.keys(args);return{data:(await one(db,`select public.${name}(${names.map((n,i)=>n+' => $'+(i+1)).join(',')}) result`,Object.values(args))).result,error:null};}
   catch(error){errors.push({name,operation:args.p_operation,message:error.message});return{data:null,error};}
   finally{await db.exec('reset role');}
  }});
  const context={userId:x.f.ownerId,businesses:[{id:x.f.businessId}],supabase:client('authenticated')},runtime=client('anon');
  const load=sourceLoader({[resolve('src/lib/supabase/runtime.ts')]:{createRuntimeClient:()=>runtime},[resolve('src/workflows/direct-research-runtime.ts')]:{directResearchRuntimeWorkflow:()=>assert.fail('No workflow'),directResearchResumeToken:()=>assert.fail('No workflow')},'workflow/api':Object.fromEntries(['start','resumeHook','getHookByToken'].map(k=>[k,()=>assert.fail('No workflow')])), 'workflow/internal/errors':{HookNotFoundError:{is:()=>false}}});
  const api=load('src/products/discovery-r12-public-owner-server.ts'),args=[context,x.f.businessId,x.f.goalId,x.authority.prepared.testEnvelopeId,x.setup.scope.expectedShopName,x.setup.scope.operationId];
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(x.authority.quote.validUntil)-Date.now()+25)));
  const before=await counts(db),envelope=(await one(db,'select to_jsonb(e) content from private.r12_direct_test_envelopes e where id=$1',[args[3]])).content;
  await assert.rejects(db.query("select private.r12_direct_setup_quote_current($1,$2,'setup')",[args[3],p.replacementOperationId]),/r12_direct_setup_quote_revalidation_required/);
  await db.exec('begin');try{
   await db.query("insert into private.r12_etsy_steel_key_revocations(key_hash) values(encode(extensions.digest($1,'sha256'),'hex'))",[x.bridge.keys.handoff]);
   await assert.rejects(api.prepareDirectEtsyAccess(...args));
  }finally{await db.exec('rollback');}
  assert.deepEqual(await counts(db),before,'Revoked genuine scoped key cannot save setup or reserve');calls.length=0;errors.length=0;
  const result=await api.prepareDirectEtsyAccess(...args).catch(error=>{error.message+=' '+JSON.stringify(errors);throw error;});
  assert.equal(result.operationId,p.replacementOperationId);
  const refreshed=calls.filter(c=>c.name==='r12_direct_setup_quote_revalidate');assert.equal(refreshed.length,1);assert.equal(refreshed[0].args.p_setup_operation_id,p.replacementOperationId);assert.equal(refreshed[0].args.p_kind,'setup');assert.equal(refreshed[0].args.p_server_key,x.bridge.keys.handoff);
  assert.ok(calls.indexOf(refreshed[0])<calls.findIndex(c=>c.name==='r12_etsy_steel_server'&&c.operation==='prepare'));
  const saved=(await one(db,'select scope from private.r12_etsy_steel_setups where operation_id=$1',[result.operationId])).scope;
  for(const k of ['ownerId','businessId','goalId','authorityRootId','testEnvelopeId','testEnvelopeHash','providerProjectId','accountId','expectedShopName','expectedShopId','maximumSessionMs','maximumBrowserMicrounits','verificationMaximumMicrounits','quoteHash','verificationQuoteHash','profileAccessExpiresAt'])assert.deepEqual(saved[k],x.setup.scope[k],k);
  for(const k of ['accountRevision','approvalId','approvalRevision','verificationOperationId'])assert.notEqual(saved[k],x.setup.scope[k]);
  assert.deepEqual(await counts(db),{...before,setups:before.setups+1});assert.equal(before.debits,1);
  assert.deepEqual((await one(db,'select to_jsonb(e) content from private.r12_direct_test_envelopes e where id=$1',[args[3]])).content,envelope);
  assert.equal((await one(db,'select private.r12_direct_research_unit_limit($1) n',[args[3]])).n,8);
  rejectRevalidation=true;assert.deepEqual(await api.prepareDirectEtsyAccess(...args),result,'Saved replacement is returned without refreshing or preparing again');
  assert.equal(calls.filter(c=>c.name==='r12_direct_setup_quote_revalidate').length,1);assert.deepEqual(await counts(db),{...before,setups:before.setups+1});assert.equal(networkCalls,0);
  console.log('Expired replacement quote regression',JSON.stringify({expiredQuote:true,operationRevalidation:true,unchangedEnvelope:true,researchUnits:8,providerCalls:networkCalls}));
 }finally{globalThis.fetch=oldFetch;for(const k of Object.keys(process.env))if(!(k in oldEnv))delete process.env[k];Object.assign(process.env,oldEnv);await db.close();}
});
