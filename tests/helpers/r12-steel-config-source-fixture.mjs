/** Successor-only copy of the frozen proof-bound driver fixture. New inputs
 * inject current Steel configuration admission; real driver/source RPCs remain. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {INERT_STEEL_CONFIG,INERT_STEEL_DEPLOYMENT,admitSteelConfig} from './r12-steel-config-sql-fixture.mjs';
import {discoveryV2Hash as hash} from '../../.core-tests/products/discovery-v2-hash.js';
import {one,ownerInitialRuntimeRpc} from './r12-owner-initial-sql-fixture.mjs';
import {researchRendererFixture} from './etsy-insights-research-renderer-fixture.mjs';
import {resolve} from 'node:path';
import {r12CatalogFixture} from './r12-provider-fixture.mjs';
import {directSonnetCatalogFixture} from './r12-direct-sonnet-catalog-fixture.mjs';
import {r12PhaseOutputFixture} from './r12-phase-output-fixture.mjs';
import {directModelExpectation} from './r12-direct-controller-model-fixture.mjs';
import {directRepairModelExpectation} from './r12-direct-controller-repair-model-fixture.mjs';
const require=createRequire(import.meta.url),ts=require('typescript');
const core=name=>require('../../.core-tests/'+name+'.js');
const model=core('products/discovery-r12-public-model'),modelRuntime=core('products/discovery-r12-public-model-runtime');
const quote=core('products/discovery-r12-adaptive-quote'),sourceRuntime=require(resolve(process.env.R12_INSIGHTS_CORE_DIR||'.core-tests','browser/etsy-insights-rpc-runtime.js'));
const {PUBLIC_RESEARCH_DIMENSIONS}=core('products/discovery-r12-public-quality');
const {publicResearchQuestionHash}=core('products/discovery-r12-public-contracts');
export const INERT_DIRECT_RUNTIME_ROOT='inert-owner-initial-runtime-bootstrap-root-0123456789';

function actualSourceModule(file,deps){
 const source=readFileSync(file,'utf8'),loadedModule={exports:{}};
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','module','exports',code)(name=>{assert.ok(Object.hasOwn(deps,name),'Unexpected runtime import: '+name);return deps[name];},loadedModule,loadedModule.exports);
 return {...loadedModule.exports,sourceHash:createHash('sha256').update(source).digest('hex')};
}
function outputFor(f,attempt){
 const raw=r12PhaseOutputFixture(f.profile.audience),i=attempt.inputs;
 if(attempt.phase==='plan'){raw.plan.queryFocus=[];return raw.plan;}
 if(attempt.phase==='strategy'){raw.strategy.marketComparisons=raw.strategy.marketComparisons.filter(x=>x.countryCode==='GB');return{assessment:raw.strategy,measurement:null};}
 assert.equal(attempt.phase,'review');
 const ctx=model.readPublicResearchModelInputs(i,f.policy.version==='r12.direct-etsy-attempt-policy.2'?directRepairModelExpectation(i):directModelExpectation(i)),ref=ctx.evidence.find(x=>x.kind==='searches').ref;
 const quality=Object.fromEntries(PUBLIC_RESEARCH_DIMENSIONS.map(d=>[d,{score:3,anchorId:`${d}.3`,rationale:'Literal aggregate observations leave candidate demand and exposure unresolved.',evidenceRefs:[ref],contraryRefs:[ref],missingFacts:['Eligible exposure is unknown.']}]));
 const next={...f.initial,query:'astronomy graduation gifts',namedGap:'Which astronomy graduation gift wording is visible?',questionHash:publicResearchQuestionHash('Which astronomy graduation gift wording is visible?')};
 return{version:'r12.direct-etsy-review.1',proposalHash:i.dependencies.strategy.response.result.proposalHash,quality,hypothesisFinding:'undetermined',learningRecommendation:'NME',conclusion:'The descriptive result is concrete but the hypothesis remains unmeasured.',conclusionEvidenceRefs:[ref],contraryEvidenceRefs:[ref],proposedCommand:next};
}

export function steelConfigResearchRuntimeComposition(db,f,{rpcTransport=null,modelOutput=null,policyVersion='r12.direct-etsy-attempt-policy.1',browserFactory=researchRendererFixture,afterSourceCreate=null,configurationAdmit=null}={}){
 assert.equal(f.policy.version,policyVersion,'The fixture must explicitly select the versioned authority under test');
 const calls=[],modelPosts=[],modelGets=[],catalogGets=[],browserPosts=[],browsers=[],sourceResults=[],modelResults=[],sqlErrors=[];
 const faults={proofUnavailable:false,sourceFinishUnavailable:0,failModelPhaseOnce:null};
 const client={rpc:async(name,args)=>{
  assert.ok(['r12_direct_controller_server','r12_direct_browser_ledger'].includes(name));
  const operation=args.p_operation;calls.push({name,operation,payload:structuredClone(args.p_payload)});
  assert.equal(args.p_business_id,f.authority.f.businessId);
  const purpose=name==='r12_direct_browser_ledger'?'evidence':operation==='dispatch'?'admission':
   ['source_admit','source_screenshot','source_receipt','source_finish','resolve_source','qualify_renderer','admit_renderer','source_transport','cleanup_due','cleanup_complete'].includes(operation)?'source':'controller';
  assert.equal(args.p_server_key,purpose==='evidence'?f.approved.keys.evidence:f.keys[purpose],'Real runtime HMAC must match the independently enrolled SQL key');
  if(name==='r12_direct_controller_server')assert.equal(args.p_scope_id,f.prepared.scopeId);
  if(operation==='source_finish'&&faults.sourceFinishUnavailable>0){faults.sourceFinishUnavailable--;return{data:null,error:new Error('Inert unavailable source finish before SQL')};}
  const values=name==='r12_direct_controller_server'?[args.p_business_id,args.p_scope_id,operation,args.p_payload,args.p_server_key]:[args.p_business_id,args.p_operation_id,operation,args.p_payload,args.p_server_key];
  try{return{data:rpcTransport?await rpcTransport(name,args):await ownerInitialRuntimeRpc(db,name,values),error:null};}
  catch(error){sqlErrors.push({operation,message:error.message});return{data:null,error};}
 }};
 const catalogFetch=async(address,init)=>{
  assert.equal(init.method,'GET');assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');
  const item=Object.values(f.quote.version==='r12.public-research-quote.3'?directSonnetCatalogFixture(Date.now()):r12CatalogFixture()).find(x=>x.url===String(address));assert.ok(item,'Only fixed public catalog endpoints may be read');
  catalogGets.push(String(address));return Response.json(item.payload);
 };
 const modelProvider=attemptId=>modelRuntime.createPublicResearchModelProvider({
  config:{apiKey:'inert-direct-model-key',baseUrl:'https://openrouter.ai/api/v1',appUrl:'https://example.invalid',appName:'inert'},
  fetcher:async(address,init)=>{
   const attempt=await f.rpc('attempt',{attemptId}),route=f.quote.inference[attempt.phase==='review'?'reviewer':'luna'];
   if(init.method==='POST'){
    assert.equal(String(address),'https://openrouter.ai/api/v1/chat/completions');assert.equal(attempt.dispatched,true);
    const wire=await one(db,'select binding from private.r12_direct_phase_wires where attempt_id=$1',[attemptId]);
    assert.equal(init.body,wire.binding.wireBody);assert.equal(modelPosts.some(x=>x.attemptId===attemptId),false,'Never resend an admitted model attempt');
    const providerRequestId='gen-inert-driver-'+randomUUID();modelPosts.push({attemptId,phase:attempt.phase,providerRequestId});
    const output=faults.failModelPhaseOnce===attempt.phase?(faults.failModelPhaseOnce=null,{}):modelOutput?modelOutput(attempt):outputFor(f,attempt);
    return Response.json({id:providerRequestId,model:route.modelId,choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}],usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150,cost:0.000001}});
   }
   assert.equal(init.method,'GET');assert.ok(attempt.candidate,'Candidate persistence must precede route receipt lookup');
   const url=new URL(address);assert.equal(url.origin+url.pathname,'https://openrouter.ai/api/v1/generation');assert.equal(url.searchParams.get('id'),attempt.candidate.providerRequestId);
   modelGets.push({attemptId,phase:attempt.phase});if(faults.proofUnavailable)return Response.json({error:'Inert indexing delay'},{status:404});
   return Response.json({data:{id:attempt.candidate.providerRequestId,provider_name:route.providerName,model:route.modelId}});
  },
 });
 function actualSource(input){
  const s=input.scope,options={shop:s.accountBinding.observedShopName,summaryQuery:s.query,headingQuery:s.query};
  const browser=browserFactory(options);browsers.push(browser);let released=false,created=false;

  browser.page.screenshot=async({clip})=>{browser.events.push('screenshot');assert.ok(clip.x>=300);return sharp({create:{width:clip.width,height:clip.height,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).png({compressionLevel:9,palette:true}).toBuffer();};
  const runtime=sourceRuntime.createEtsyInsightsRpcRuntime({...input,config:INERT_STEEL_CONFIG,connect:browser.input.connect,
   createConfigurationGuard:{scopeHash:hash(s),deployment:INERT_STEEL_DEPLOYMENT,admit:request=>configurationAdmit?configurationAdmit(request):admitSteelConfig(db,f.authority.f.businessId,request,f.keys.source)},
   fetcher:async(address,init={})=>{
    const url=new URL(address),method=init.method??'GET';assert.equal(url.origin,'https://api.steel.dev');
    if(url.pathname==='/v1/sessions'){
     assert.equal(method,'POST');assert.equal(created,false);created=true;
     assert.equal((await one(db,'select count(*)::int n from private.r12_direct_source_transport_claims where attempt_id=$1',[s.sourceAttemptId])).n,1);
     const body=JSON.parse(init.body);assert.deepEqual(body,{sessionId:s.operationId,projectId:s.providerProjectId,timeout:s.limits.maximumSessionMs,persistProfile:false,profileId:f.approved.profileId,debugConfig:{interactive:false,systemCursor:false},useProxy:false,solveCaptcha:false,stealthConfig:{autoCaptchaSolving:false,humanizeInteractions:false,skipFingerprintInjection:true}});
     browserPosts.push({operationId:s.operationId,attemptId:s.sourceAttemptId});if(afterSourceCreate)await afterSourceCreate({scope:s,browser});
    }else if(url.pathname===`/v1/sessions/${s.operationId}/release`){assert.equal(method,'POST');assert.equal(created,true);assert.equal(released,false);released=true;return Response.json({success:true});}
    else{assert.equal(method,'GET');assert.equal(url.pathname,`/v1/sessions/${s.operationId}`);assert.equal(released,true);}
    return Response.json({id:s.operationId,projectId:s.providerProjectId,profileId:f.approved.profileId,status:released?'released':'live',debugUrl:`https://api.steel.dev/v1/sessions/${s.operationId}/player`,solveCaptcha:false,useProxy:false,proxyBytesUsed:0,proxySource:null,timeout:s.limits.maximumSessionMs,duration:1000});
   },
  });
  return{...runtime,async run(){const result=await runtime.run();sourceResults.push(result);return result;}};
 }
 const loaded=actualSourceModule('src/products/discovery-r12-public-runtime.ts',{
  'node:crypto':require('node:crypto'),'../core/request-deadline':core('core/request-deadline'),
  '../lib/supabase/runtime':{createRuntimeClient:()=>client},
  './discovery-r12-public-server-key':core('products/discovery-r12-public-server-key'),
  './discovery-r12-public-utils':core('products/discovery-r12-public-utils'),
  './discovery-r12-public-contracts':core('products/discovery-r12-public-contracts'),
  './discovery-r12-public-preparation':core('products/discovery-r12-public-preparation'),
  './discovery-r12-public-driver':core('products/discovery-r12-public-driver'),
  './discovery-r12-public-cycle':core('products/discovery-r12-public-cycle'),
  './discovery-r12-public-repair':core('products/discovery-r12-public-repair'),
  './discovery-r12-adaptive-quote':{...quote,fetchAdaptiveResearchQuote:options=>quote.fetchAdaptiveResearchQuote({...options,fetch:catalogFetch})},
  get './discovery-r12-public-reviewer-quote'(){const actual=core('products/discovery-r12-public-reviewer-quote');return{...actual,fetchDirectSonnetInferenceQuote:options=>actual.fetchDirectSonnetInferenceQuote({...options,fetch:catalogFetch})};},
  './discovery-r12-public-model-runtime':{...modelRuntime,async runPublicResearchModelAttempt(args,deps){const result=await modelRuntime.runPublicResearchModelAttempt(args,{...deps,provider:modelProvider(args.attemptId)});modelResults.push(result);return result;}},
  get '../browser/etsy-steel-create-binding'(){return core('browser/etsy-steel-create-binding');},
  '../browser/etsy-insights-rpc-runtime':{...sourceRuntime,createEtsyInsightsRpcRuntime:actualSource},
 });
 const input={businessId:f.authority.f.businessId,goalId:f.authority.f.goalId,ownerId:f.authority.f.ownerId,grantId:f.authority.f.grantId,
  testEnvelopeId:f.authority.prepared.testEnvelopeId,envelopeHash:f.authority.prepared.testEnvelopeHash,routeHash:f.authority.routeHash,
  scopeId:f.prepared.scopeId,scopeHash:f.prepared.scopeHash,planHash:f.prepared.planHash,profileHash:f.profile.profileHash,policyHash:f.policy.policyHash};
 const runtimeRunId='inert-driver-'+randomUUID();
 return{input,runtimeRunId,sourceHash:loaded.sourceHash,calls,modelPosts,modelGets,catalogGets,browserPosts,browsers,sourceResults,modelResults,sqlErrors,faults,
  step:(id=runtimeRunId,pins=input)=>loaded.executePublicResearchRuntimeStep(pins,id)};
}
