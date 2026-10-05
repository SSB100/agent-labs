import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {discoveryKnowledgeFixture} from './discovery-v2-fixtures.mjs';
const require=createRequire(import.meta.url);
const runtime=require('../.core-tests/products/discovery-v2-runtime.js');
const {discoveryV2Hash}=require('../.core-tests/products/discovery-v2.js');
const {discoveryV2PackManifests}=require('../.core-tests/products/discovery-v2-packs.js');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture(){
  const intent={version:'pod-discovery-2.0',id:id(1),businessId:id(2),objective:'Compare supported geographic starting markets for original adult nature T-shirts.',comparisonUniverse:{productType:'original_pod_tshirt',markets:[{countryCode:'US',currency:'USD'},{countryCode:'GB',currency:'GBP'}],audiences:['Adult nature enthusiasts'],sourceDomains:['etsy.com','printful.com'],selectionQuestion:'Which declared starting geography has the best-supported bounded original-shirt experiment?'},limits:{maximumAlternatives:3,maximumNewCollections:1,maximumMicrousd:500000,maximumGenerations:1},expiresAt:new Date(Date.now()+3600000).toISOString()};
  const knowledge=discoveryKnowledgeFixture();
  const scope={version:'pod-discovery-2.0',rootId:intent.id,intent,quote:{intentId:intent.id,policyHash:discoveryV2Hash(intent)},budgetScope:{intentId:intent.id,maximumCollections:1,maximumMicrousd:500000,policyHash:discoveryV2Hash(intent)},committedMicrousd:0,hasUncertainCosts:false};
  const worker=discoveryV2PackManifests().find(p=>p.packKey==='worker.product-discovery-v2-plan').workers[0];
  const phase={kind:'plan',intent,focus:intent.objective,knowledge};
  const artifacts=[{id:id(3),artifactType:'pack.stage-input',name:'Immutable plan input',mediaType:'application/json',content:phase,metadata:{}},...worker.manifest.knowledgeRequirements.map((key,i)=>({id:id(10+i),artifactType:'knowledge.snapshot',name:key,mediaType:'application/json',content:{fixture:true},metadata:{knowledgeKey:key}}))];
  const context={taskContract:{id:id(4),objective:'Prepare the finite scoped comparison plan.',inputArtifactIds:artifacts.map(a=>a.id),permittedCapabilities:[],requiredKnowledge:worker.manifest.knowledgeRequirements,requiredOutputSchema:worker.manifest.outputSchema,completionCriteria:{outputContract:'DiscoveryPlanV2',finiteQueries:1},failureCriteria:{},nonGoals:['No extra research or publication'],escalationRules:{maximumAttempts:1}},inputArtifacts:artifacts};
  return{scope,prepared:{productScope:scope,discoveryPhase:phase,worker,context},output:{comparisonRationale:'Compare only the declared starting countries using dated sources, without claiming a universal winner.',queryFocus:['Find original adult nature-shirt buyer observations with country and delivered-price limitations.'],proposals:[{concept:'Original understated woodland shirt',audience:intent.comparisonUniverse.audiences[0],hypothesis:'Adult nature enthusiasts may prefer an understated original motif; demand remains unproven.',differentiationHypothesis:'Test original composition and negative space without copying competitor art.'}]}};
}
test('persisted runtime authority rejects omitted, spoofed, cross-Business and unknown product scope',()=>{
  const f=fixture();assert.deepEqual(runtime.readProductRuntimeScope(f.prepared,id(2)),f.scope);
  assert.throws(()=>runtime.readProductRuntimeScope({},id(2)),/missing/);
  assert.equal(runtime.readProductRuntimeScope({productScope:null},id(2)),null);
  assert.throws(()=>runtime.readProductRuntimeScope({productScope:null},id(2),id(9)),/hints/);
  assert.throws(()=>runtime.readProductRuntimeScope(f.prepared,id(99)),/Business/);
  assert.throws(()=>runtime.readProductRuntimeScope({...f.prepared,productScope:{...f.scope,version:'future'}},id(2)),/Unknown/);
  assert.throws(()=>runtime.readProductRuntimeScope({...f.prepared,productScope:{...f.scope,budgetScope:{...f.scope.budgetScope,maximumMicrousd:999999}}},id(2)),/binding/);
  const v1={version:'pod-discovery-1.0',experimentId:id(8)};
  assert.deepEqual(runtime.readProductRuntimeScope({productScope:v1},id(2)),v1);
  assert.throws(()=>runtime.readProductRuntimeScope({productScope:v1},id(2),id(9)),/hint/);
});
test('v2 actual execution is metered and emits a real typed plan plus canonical task receipt',async()=>{
  const f=fixture(),calls=[],reservations=[],settlements=[];
  const result=await runtime.executePreparedDiscoveryV2(f.scope,f.prepared,'plan',{ledger:{reserve:async r=>{reservations.push(r);return{shouldCall:true,totalReservedMicrousd:r.reservedMicrousd};},settle:async(...args)=>{settlements.push(args);}},prices:async modelId=>({modelId,verifiedAt:new Date().toISOString(),source:'https://openrouter.ai/api/v1/models',inputPerMillion:.4,outputPerMillion:1.8,cacheWritePerMillion:.5}),provider:{invokeWebSearch:async()=>{throw Error('Unexpected search');},invokeStructured:async request=>{calls.push(request);return{provider:'openrouter',providerModelId:request.model.providerModelId,providerRequestId:'synthetic-metered-plan',output:f.output,metadata:{actualUpstreamProvider:'OpenAI'},usage:{inputTokens:1,outputTokens:1,totalTokens:2,reportedCostUsd:.000001,estimatedCostUsd:0,cachedInputTokens:0,reasoningTokens:0},latencyMs:1};}}});
  assert.equal(calls.length,1);assert.equal(reservations[0].attemptKey,'plan:1');assert.equal(settlements[0][1],1);
  assert.equal(result.output.version,'pod-discovery-2.0');assert.equal(result.output.stopReason,undefined);
  assert.equal(result.receipt.workerKey,'product.discovery-v2.plan');assert.equal(result.receipt.taskContractId,id(4));
  assert.equal(result.receipt.providerRequestId,'synthetic-metered-plan');assert.equal(result.receipt.actualProviderModelId,'openai/gpt-5.6-luna');
  assert.equal(result.receipt.stopReason,'bounded_discovery_phase_completed');
});
test('uncertain charges, changed phase and wrong worker stop before pricing or reservation',async()=>{
  for(const mutate of [f=>{f.scope.hasUncertainCosts=true;},f=>{f.prepared.discoveryPhase=structuredClone(f.prepared.discoveryPhase);f.prepared.discoveryPhase.intent.objective='A changed objective outside the persisted task.';},f=>{f.prepared.worker.manifest.worker.workerKey='product.discovery-v2.review';}]){
    const f=fixture();mutate(f);let priceCalls=0;
    await assert.rejects(()=>runtime.executePreparedDiscoveryV2(f.scope,f.prepared,'plan',{prices:async()=>{priceCalls++;throw Error('No price read expected');},ledger:{reserve:async()=>{throw Error('No reserve expected');},settle:async()=>{}}}));
    assert.equal(priceCalls,0);
  }
});
function loadSteps(overrides){const file='src/workflows/installed-pack-runtime-steps.ts';const output=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const sourceModule={exports:{}};new Function('require','module','exports',output)(name=>Object.hasOwn(overrides,name)?overrides[name]:{},sourceModule,sourceModule.exports);return sourceModule.exports;}
test('installed runtime meters linked v1 research even when the caller omits its optional experiment hint',async()=>{
  const markers=[];const prepared={productScope:{version:'pod-discovery-1.0',experimentId:id(8)},worker:{execution:{kind:'web.research'},manifest:{inputSchema:{type:'object'}}},context:{taskContract:{permittedCapabilities:['web.research']},inputArtifacts:[{artifactType:'pack.stage-input',content:{question:'A persisted research question',sourceDomains:['etsy.com']}}]}};
  const steps=loadSteps({'workflow':{FatalError:Error},'../lib/supabase/runtime':{createRuntimeClient:()=>({rpc:async()=>({data:prepared,error:null})})},'../products/discovery-v2-runtime':runtime,'../research/budget':{BudgetedResearchAdapter:class{constructor(){markers.push('metered');}}},'../research/runtime-budget':{runtimeResearchBudget:()=>({})},'../models/openrouter':{OpenRouterAdapter:class{constructor(){throw Error('Unmetered adapter constructed');}}},'../workers/runtime':{validateWorkerInvocationContext:()=>{}},'../workers/schema-validator':{assertJsonSchemaValue:()=>{}},'../research/worker':{executeMarketResearcher:async()=>({output:{},receipt:{}})}});
  await steps.executeInstalledPackStage({businessId:id(2),coreWorkflowRunId:id(5),runtimeCapability:'synthetic-capability'},'research');
  assert.deepEqual(markers,['metered']);
});
test('installed runtime denies missing authority before choosing any executor',async()=>{
  const steps=loadSteps({'workflow':{FatalError:Error},'../lib/supabase/runtime':{createRuntimeClient:()=>({rpc:async()=>({data:{completed:false},error:null})})},'../products/discovery-v2-runtime':runtime});
  await assert.rejects(()=>steps.executeInstalledPackStage({businessId:id(2),coreWorkflowRunId:id(5),runtimeCapability:'synthetic-capability'},'research'),/scope is missing/);
});
test('actual paid failure receipt is persisted before workflow error serialization',async()=>{
  const f=fixture(),calls=[];const {ModelProviderError}=require('../.core-tests/models/types.js');
  const originalReceipt={provider:'openrouter',providerModelId:'observed/wrong-model',providerRequestId:'paid-wrong-model',upstreamProvider:'Observed upstream',latencyMs:15,usage:{reportedCostUsd:.002,inputTokens:10,outputTokens:5}};
  const steps=loadSteps({'workflow':{FatalError:Error},'../lib/supabase/runtime':{createRuntimeClient:()=>({rpc:async(_name,args)=>{calls.push(args);return{data:args.p_operation==='prepare'?f.prepared:{status:'failed'},error:null};}})},'../products/discovery-v2-runtime':{...runtime,executePreparedDiscoveryV2:async()=>{throw new ModelProviderError('malformed_model_output','Paid output failed its contract.',false,{providerReceipt:originalReceipt,requestedModel:'requested/model',settlementRecorded:true});}},'../models/types':{ModelProviderError},'../research/runtime-budget':{runtimeResearchBudget:()=>({})}});
  await assert.rejects(()=>steps.executeInstalledPackStage({businessId:baseBusiness(),coreWorkflowRunId:id(5),runtimeCapability:'synthetic-capability'},'plan'),/Paid output/);
  assert.deepEqual(calls.map(c=>c.p_operation),['prepare','fail']);
  assert.deepEqual(calls[1].p_payload.providerReceipt,originalReceipt);assert.equal(calls[1].p_payload.requestedModel,'requested/model');assert.equal(calls[1].p_payload.settlementRecorded,true);
  assert.equal(calls[1].p_payload.request,undefined);assert.equal(calls[1].p_payload.output,undefined);
});
function baseBusiness(){return id(2);}


test('rejected paid plan reaches the durable workflow failure with safe diagnostics and cannot replay its charge',async()=>{
  const {OpenRouterAdapter}=require('../.core-tests/models/openrouter.js');
  const {ModelProviderError}=require('../.core-tests/models/types.js');
  for(const scenario of ['audience','length','query_focus_length','extra_property']){
    const f=fixture(),transitions=[],settlements=[],reserved=new Set();
    const privateText='private rejected wording that must never enter a workflow receipt';
    const output=structuredClone(f.output);
    if(scenario==='audience')output.proposals[0].audience=privateText;
    if(scenario==='length')output.comparisonRationale=privateText.repeat(20);
    if(scenario==='query_focus_length')output.queryFocus=[privateText.repeat(20)];
    if(scenario==='extra_property')output[privateText]=privateText;
    let providerCalls=0;
    const adapter=new OpenRouterAdapter({ admitDispatch: async () => {},
      config:{apiKey:'synthetic-only',baseUrl:'https://provider.invalid/api/v1',appUrl:'https://app.invalid',appName:'Synthetic fixture'},
      fetcher:async()=>{
        providerCalls++;
        return new Response(JSON.stringify({id:'synthetic-paid-invalid-plan',model:'openai/gpt-5.6-luna',provider:'OpenAI',
          choices:[{message:{content:JSON.stringify(output)},finish_reason:'stop'}],
          usage:{prompt_tokens:100,completion_tokens:50,cost:.001181}}),{status:200});
      },
    });
    const ledger={
      reserve:async reservation=>{
        const shouldCall=!reserved.has(reservation.attemptKey);reserved.add(reservation.attemptKey);
        return{shouldCall,totalReservedMicrousd:reservation.reservedMicrousd};
      },
      settle:async(...args)=>{settlements.push(args);},
    };
    const steps=loadSteps({
      'workflow':{FatalError:Error},
      '../lib/supabase/runtime':{createRuntimeClient:()=>({rpc:async(_name,args)=>{
        transitions.push(args);return{data:args.p_operation==='prepare'?f.prepared:{status:'failed'},error:null};
      }})},
      '../products/discovery-v2-runtime':{...runtime,executePreparedDiscoveryV2:(scope,prepared,stage,services)=>
        runtime.executePreparedDiscoveryV2(scope,prepared,stage,{...services,provider:adapter,
          prices:async modelId=>({modelId,verifiedAt:new Date().toISOString(),source:'https://openrouter.ai/api/v1/models',inputPerMillion:.4,outputPerMillion:1.8,cacheWritePerMillion:.5})})},
      '../models/types':{ModelProviderError},
      '../research/runtime-budget':{runtimeResearchBudget:()=>ledger},
    });
    const input={businessId:baseBusiness(),coreWorkflowRunId:id(5),runtimeCapability:'synthetic-capability'};
    await assert.rejects(()=>steps.executeInstalledPackStage(input,'plan'),/JSON schema/);
    const failure=transitions.find(t=>t.p_operation==='fail').p_payload;
    const diagnostic=scenario==='audience'?'$.proposals[0].audience:enum':scenario==='length'?'$.comparisonRationale:max_length':scenario==='query_focus_length'?'$.queryFocus[0]:max_length':'$:additional_property';
    assert.ok(failure.message.includes(diagnostic),failure.message);
    assert.equal(failure.settlementRecorded,true);
    assert.equal(failure.providerReceipt.providerRequestId,'synthetic-paid-invalid-plan');
    assert.equal(failure.providerReceipt.usage.reportedCostUsd,.001181);
    assert.equal(failure.providerReceipt.providerModelId,'openai/gpt-5.6-luna');
    assert.equal(failure.output,undefined);assert.equal(failure.request,undefined);
    assert.ok(!JSON.stringify(failure).includes(privateText));
    assert.deepEqual(settlements,[['plan:1',1181,'synthetic-paid-invalid-plan']]);
    await assert.rejects(()=>steps.executeInstalledPackStage(input,'plan'),/already reserved/);
    assert.equal(providerCalls,1);assert.equal(settlements.length,1);
    assert.deepEqual(transitions.map(t=>t.p_operation),['prepare','fail','prepare','fail']);
  }
});
