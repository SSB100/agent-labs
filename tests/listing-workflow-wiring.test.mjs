import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {applySwcTransform} from '@workflow/builders';
const require=createRequire(import.meta.url),ts=require('typescript');
function load(path,deps){const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const m={exports:{}};runInNewContext(`(function(require,module,exports){${code}\n})`,{structuredClone})(name=>{assert.ok(name in deps,`Unexpected dependency ${name}`);return deps[name];},m,m.exports);return m.exports;}
const contracts=require('../.core-tests/etsy/contracts.js');
function production(throwEarly=false){
 const calls=[],verified=[];let repository;
 const input={businessId:'business',listingRunId:'run',coreWorkflowRunId:'workflow',runtimeCapability:'fixture-capability'};
 let raw={id:'run',businessId:'business',workflowRunId:'workflow',sourceArtifactId:'source',outputArtifactId:'output',input:{},inputHash:'hash',knowledgeHash:'knowledge',workerHashes:{},status:'running',phase:'specialist',maximumMicrousd:100000,quote:{},taskIds:{},outputs:{},sourceEnvelope:'fixture-source-envelope',costs:{committedMicrousd:1},reason:null};
 const rpc=async(name,args)=>{calls.push({name,args});return{data:raw};};
 const exports=load('src/workflows/listing-runtime-steps.ts',{'workflow':{FatalError:class extends Error{}},'../lib/admission-runtime':{settleLegacyAdmission:async(scope,payload)=>{calls.push({name:'trusted-settlement',args:{scope,payload}});},modelDispatchAdmission:()=>async()=>{throw Error('Fixture does not authorize dispatch');}},'../lib/supabase/runtime':{createRuntimeClient:()=>({rpc})},'../etsy/contracts':contracts,'../listing/engine':{executeListingRun:async value=>{repository=value;if(throwEarly)throw new Error('private model configuration');return{status:'completed'};}},'../listing/server':{assertRuntimeListingSource:value=>verified.push(value),issueListingEnvelopes:()=>({})}});
 return{calls,verified,input,exports,getRepository:async()=>{await exports.executeListingPreparation(input,'runtime-workflow');return repository;},setRaw:value=>raw=value,raw};
}
function qualification(throwEarly=false){
 const calls=[];let repository;
 const input={businessId:'business',qualificationRunId:'qual-run',coreWorkflowRunId:'workflow',runtimeCapability:'fixture-capability'};
 const raw={id:'qual-run',businessId:'business',workflowRunId:'workflow',status:'running',suiteHash:'suite',knowledgeHash:'policy',workerHashes:{},maximumMicrousd:100000,quote:{},taskIds:{},cases:{},costs:{committedMicrousd:1},reason:'private'};
 const exports=load('src/workflows/listing-qualification-runtime-steps.ts',{'workflow':{FatalError:class extends Error{}},'../lib/admission-runtime':{settleLegacyAdmission:async(scope,payload)=>{calls.push({name:'trusted-settlement',args:{scope,payload}});},modelDispatchAdmission:()=>async()=>{throw Error('Fixture does not authorize dispatch');}},'../lib/supabase/runtime':{createRuntimeClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return{data:raw};}})},'../etsy/contracts':contracts,'../listing/qualification':{executeListingQualification:async value=>{repository=value;if(throwEarly)throw new Error('private setup detail');return{status:'passed'};}}});
 return{calls,input,exports,getRepository:async()=>{await exports.executeListingQualificationStep(input,'runtime');return repository;}};
}
test('listing durable repository binds business, workflow and one-run capability on every RPC',async()=>{
 const f=production(),r=await f.getRepository();const state=await r.load();await r.guard();await r.reserve({role:'specialist'});
 assert.ok(f.calls.every(c=>c.name==='listing_runtime_transition'&&c.args.p_business_id==='business'&&c.args.p_run_id==='run'&&c.args.p_runtime_capability==='fixture-capability'));
 assert.equal(f.calls[0].args.p_payload.runtimeRunId,'runtime-workflow');assert.equal(f.verified.length,2);assert.equal('costs' in state,false);assert.equal('sourceEnvelope' in state,false);assert.equal('reason' in state,false);assert.equal(f.exports.executeListingPreparation.maxRetries,0);
});
test('wrong run scope fails before source verification or dispatch',async()=>{
 const f=production(),r=await f.getRepository();f.setRaw({...f.raw,businessId:'foreign'});await assert.rejects(r.guard(),/listing_runtime_scope_mismatch/);assert.equal(f.verified.length,0);
});
test('both listing lanes use trusted atomic settlement with their original run and receipt',async()=>{
 for(const [make,kind,key]of [[production,'listing','role'],[qualification,'listing_qualification','caseKey']]){
  const f=make(),repo=await f.getRepository(),receipt={actualProvider:'inert',outputValidated:false};
  await repo.settle({[key]:'specialist',reportedMicrousd:7000,providerRequestId:'original-receipt',receipt});
  const call=f.calls.at(-1);assert.equal(call.name,'trusted-settlement');assert.equal(call.args.payload.kind,kind);assert.equal(call.args.payload.callKey,'specialist');assert.equal(call.args.payload.reportedMicrousd,7000);assert.equal(call.args.payload.providerRequestId,'original-receipt');assert.deepEqual(call.args.payload.receipt,receipt);assert.equal(call.args.scope.businessId,'business');assert.equal(call.args.payload.runId,kind==='listing'?'run':'qual-run');
 }
});
test('qualification lane uses its separate RPC and exact case-state projection with no retry',async()=>{
 const f=qualification(),r=await f.getRepository();const state=await r.load();await r.finish();
 assert.ok(f.calls.every(c=>c.name==='listing_qualification_transition'&&c.args.p_run_id==='qual-run'));assert.equal('costs' in state,false);assert.equal('reason' in state,false);assert.equal(f.exports.executeListingQualificationStep.maxRetries,0);assert.equal(f.calls.at(-1).args.p_operation,'finish');
});
test('durable qualification workflow stops at five one-call steps and preserves early terminal results',async()=>{
 let calls=0;const deps={'workflow':{FatalError:class extends Error{},getWorkflowMetadata:()=>({workflowRunId:'runtime'})},'./listing-qualification-runtime-steps':{executeListingQualificationStep:async()=>({status:++calls===5?'passed':'running'})}};
 const {listingQualificationWorkflow}=load('src/workflows/listing-qualification-runtime.ts',deps);
 assert.equal((await listingQualificationWorkflow({})).status,'passed');assert.equal(calls,5);
 calls=0;deps['./listing-qualification-runtime-steps'].executeListingQualificationStep=async()=>{calls++;return{status:'failed'};};assert.equal((await listingQualificationWorkflow({})).status,'failed');assert.equal(calls,1);
});
test('early adapter/configuration failure records a safe terminal reason in both lanes',async()=>{
 const f=production(true);await assert.rejects(f.exports.executeListingPreparation(f.input,'runtime'),/^Error: Listing preparation stopped/);assert.equal(f.calls.length,1);assert.equal(f.calls[0].args.p_operation,'fail');assert.equal(f.calls[0].args.p_payload.reason,'listing_runtime_failed');
 const q=qualification(true);await assert.rejects(q.exports.executeListingQualificationStep(q.input,'runtime'),/^Error: Listing worker qualification stopped/);assert.equal(q.calls.length,1);assert.equal(q.calls[0].args.p_operation,'fail');assert.equal(q.calls[0].args.p_payload.reason,'listing_qualification_runtime_failed');
});
test('real Workflow compiler removes all Node-only repository dependencies from workflow-mode step modules',async()=>{
 for(const [path,step] of [['src/workflows/listing-runtime-steps.ts','executeListingPreparation'],['src/workflows/listing-qualification-runtime-steps.ts','executeListingQualificationStep']]){
  const {code,workflowManifest}=await applySwcTransform(path,readFileSync(path,'utf8'),'workflow');
  assert.equal(workflowManifest.steps[path][step].stepId,`step//./${path.slice(0,-3)}//${step}`);
  assert.match(code,/WORKFLOW_USE_STEP/);assert.match(code,/maxRetries = 0/);
  assert.doesNotMatch(code,/\bimport\s|createRuntimeClient|listingRuntimeRepository|listingQualificationRepository|assertRuntimeListingSource|node:crypto/);
 }
});
