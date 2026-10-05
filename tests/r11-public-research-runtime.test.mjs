import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const q=require('../.core-tests/research/qualification.js');
const rt=require('../.core-tests/research/qualification-runtime.js');
const {OpenRouterAdapter}=require('../.core-tests/models/openrouter.js');
const {resolveModelRoute}=require('../.core-tests/models/registry.js');
const id=n=>`11000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const config={apiKey:'inert-r11-test-key',baseUrl:'https://openrouter.ai/api/v1',appUrl:'https://example.invalid',appName:'R11 fixture'};
async function fixture(options={}){
 const now=Date.now(),query='What public industry reporting describes practical adult gardening product preferences?';let clock=now;
 const model=structuredClone(resolveModelRoute('standard.default').primary);
 const policy={version:'r11.public-research.1',id:id(1),businessId:id(2),ownerId:id(3),workflowRunId:id(4),goalId:id(5),operatingPolicyId:id(6),query,
  allowedDomains:['gardening.example'],excludedDomains:[...q.R11_RESTRICTED_SOURCE_DOMAINS],sourceReviews:[{domain:'gardening.example',basis:'documented_api_factual_snippets',reviewHash:'1'.repeat(64)}],
  queryReviewHash:q.publicResearchHash({query,classification:'generic_nonpersonal_public_research'}),termsReviewHash:'2'.repeat(64),independentReviewHash:'3'.repeat(64),approvalHash:'4'.repeat(64),modelId:model.providerModelId,providerEndpoint:'azure/us',
  recipients:{router:'openrouter.ai',search:'exa.ai',inferenceEndpoint:'azure/us'},retention:{inference:'no_training_zdr',search:'query_retention_improvement_training_possible',application:'bounded_attributed_audit_evidence'},
  validFrom:new Date(now-60000).toISOString(),validUntil:new Date(now+240000).toISOString(),maximumMicrousd:250000,searchMicrousd:180000,selectorMicrousd:20000,priceLimit:{prompt:0.44,completion:1.98,request:0},quoteHash:'5'.repeat(64),quoteValidUntil:new Date(now+240000).toISOString()};
 const scope={businessId:policy.businessId,coreWorkflowRunId:policy.workflowRunId,runtimeCapability:'inert-runtime-capability'};
 const search=await rt.inspectPublicResearchWire(q.publicResearchSearchRequest(policy,model,now),'search');
 const loaded={policy,policyHash:q.publicResearchHash(policy),search,collection:null};
 const events=[],sent=[],settlements=[],marked=new Set();
 const excerpt='Adult gardeners often value practical tools and containers suited to the available growing space. This is a bounded public observation.';
 const runtime={now:()=>clock,model,
  async verifyQuote(p){events.push('quote');if(options.quoteFailure)throw Error('stale quote');assert.equal(p.quoteHash,policy.quoteHash);return{providerName:'Azure'};},
  async rpc(operation,payload){events.push(operation);if(operation==='load')return structuredClone(loaded);
   if(operation==='guard'){
    assert.equal(payload.admission.accounting.kind,'r05');assert.deepEqual(payload.admission.sourceDomains,policy.allowedDomains);assert.deepEqual(payload.admission.dataClasses,['generic_public_query','public_evidence']);
    if(options.deny===payload.phase||marked.has(payload.phase))return{decision:'blocked',shouldDispatch:false,requestId:id(payload.phase==='search'?10:11)};
    marked.add(payload.phase);if(options.guardLoss===payload.phase)throw Error('lost marker response');return{decision:'allowed',shouldDispatch:true,requestId:id(payload.phase==='search'?10:11)};
   }
   if(operation==='collect'){
    if(options.collectFailure)throw Error('collection write failed');
    assert.equal(q.publicResearchHash(JSON.parse(payload.collectionCanonical)),payload.collectionHash);
    assert.equal(q.publicResearchHash(JSON.parse(payload.lineageCanonical)),payload.lineageHash);
    loaded.collection={id:id(20),collection:payload.collection,collectionHash:payload.collectionHash,lineage:payload.lineage,lineageHash:payload.lineageHash,selector:{requestHash:payload.selectorRequestHash,wireHash:payload.selectorWireHash,wireBytes:payload.selectorWireBytes,maxTokens:payload.selectorMaxTokens}};
    if(options.expireBeforeSelector)clock=Date.parse(policy.validUntil)+1;
    return{collectionId:id(20),collectionHash:payload.collectionHash,lineageHash:payload.lineageHash,replayed:false};
   }
   if(operation==='complete'){
    if(options.completeFailure)throw Error('result write failed');
    assert.equal(payload.evidencePackHash,q.publicResearchHash(JSON.parse(payload.evidencePackCanonical)));
    return{resultId:id(21),evidencePackHash:payload.evidencePackHash,replayed:false};
   }
   throw Error('unexpected operation');
  },
  async settle(requestId,receipt){events.push('settle');settlements.push({requestId,receipt});if(options.settleFailure)throw Error('settlement unavailable');},
  provider:admit=>new OpenRouterAdapter({config,admitDispatch:admit,fetcher:async(url,init)=>{
   const body=JSON.parse(init.body),phase=body.tools?'search':'select';events.push(`send:${phase}`);sent.push({url,body,redirect:init.redirect});
   if(options.transportFailure===phase)throw Error('uncertain transport failure');
   if(phase==='select'&&options.lateSelector)clock=Date.parse(policy.validUntil)+1000;
   const content=phase==='search'?{content:'Search result',annotations:[{type:'url_citation',url_citation:{url:options.badOrigin?'https://etsy.com/listing/1':'https://gardening.example/report',title:'Public report',content:excerpt}}]}:{content:JSON.stringify({selections:[{sourceKey:'S1',quote:options.badSelection?'This invented quote is not present in the source excerpt.':excerpt.slice(0,98).trim()}],limitations:['limited_sources']})};
   return new Response(JSON.stringify({id:`inert-${phase}-receipt`,provider:options.wrongProvider?'OpenAI':'Azure',model:options.wrongModel?'other/model':model.providerModelId,
    choices:[{finish_reason:'stop',message:content}],usage:{prompt_tokens:10,completion_tokens:10,...(options.unknownCost?{}:{cost:Object.hasOwn(options,'rawCost')?options.rawCost:options.overage?0.26:0.001}),...(phase==='search'?{server_tool_use:{web_search_requests:1}}:{})}}),{status:options.httpError?400:200});
  }})};
 return{now,policy,scope,runtime,loaded,events,sent,settlements,marked};
}
test('R11 bounded runner makes exactly one search plus selector with durable lineage and original R05 authority',async()=>{
 const f=await fixture(),result=await rt.runPublicResearchQualification(f.scope,f.policy.id,f.runtime);
 assert.equal(f.sent.length,2);assert.equal(f.settlements.length,2);assert.deepEqual(f.events,['load','quote','guard','send:search','settle','collect','quote','guard','send:select','settle','complete']);
 assert.equal(result.collectionId,id(20));assert.equal(result.receipts.length,2);assert.equal(result.evidencePack.sourceLineage.policyId,f.policy.id);
 assert.ok(f.sent.every(x=>x.redirect==='error'));assert.deepEqual(f.sent[0].body.provider.only,['azure/us']);assert.equal(f.sent[1].body.tools,undefined);
 assert.ok(!JSON.stringify(f.sent).includes(f.scope.runtimeCapability));assert.ok(!JSON.stringify(f.sent).includes(f.scope.businessId));
 await assert.rejects(rt.runPublicResearchQualification(f.scope,f.policy.id,f.runtime));assert.equal(f.sent.length,2,'repeated invocation cannot spend again');
});
test('R11 completed collection resumes selection without repeating the search',async()=>{
 const f=await fixture({deny:'select'});await assert.rejects(rt.runPublicResearchQualification(f.scope,f.policy.id,f.runtime));assert.equal(f.sent.length,1);assert.ok(f.loaded.collection);
 const g=await fixture();g.loaded.collection=f.loaded.collection;g.loaded.policy=f.policy;g.loaded.policyHash=q.publicResearchHash(f.policy);g.loaded.search=f.loaded.search;
 const result=await rt.runPublicResearchQualification(f.scope,f.policy.id,g.runtime);assert.equal(g.sent.length,1);assert.equal(g.sent[0].body.tools,undefined);assert.equal(result.receipts.length,1);
});
for(const options of [{quoteFailure:true},{deny:'search'},{guardLoss:'search'}])test('R11 missing/denied/uncertain authority sends zero provider calls',async()=>{
 const f=await fixture(options);await assert.rejects(rt.runPublicResearchQualification(f.scope,f.policy.id,f.runtime));assert.equal(f.sent.length,0);assert.equal(f.settlements.length,0);
});
for(const options of [{collectFailure:true},{settleFailure:true},{badOrigin:true},{unknownCost:true},{overage:true},{wrongProvider:true},{wrongModel:true},{transportFailure:'search'}])test('R11 failed search proof or uncertain liability never proceeds to selector or retries',async()=>{
 const f=await fixture(options);await assert.rejects(rt.runPublicResearchQualification(f.scope,f.policy.id,f.runtime));assert.equal(f.sent.length,1);
 await assert.rejects(rt.runPublicResearchQualification(f.scope,f.policy.id,f.runtime));assert.equal(f.sent.length,1);
});
test('R11 invalid paid selector preserves both receipts and cannot repeat the selector',async()=>{
 const f=await fixture({badSelection:true});await assert.rejects(rt.runPublicResearchQualification(f.scope,f.policy.id,f.runtime));assert.equal(f.sent.length,2);assert.equal(f.settlements.length,2);
 await assert.rejects(rt.runPublicResearchQualification(f.scope,f.policy.id,f.runtime));assert.equal(f.sent.length,2);
});
test('R11 missing durable result never becomes claimed success and never repeats a paid phase',async()=>{
 const f=await fixture({completeFailure:true});await assert.rejects(rt.runPublicResearchQualification(f.scope,f.policy.id,f.runtime));assert.equal(f.sent.length,2);assert.equal(f.settlements.length,2);
 await assert.rejects(rt.runPublicResearchQualification(f.scope,f.policy.id,f.runtime));assert.equal(f.sent.length,2);
});
test('R11 already admitted selector output survives policy expiry through bounded audit completion',async()=>{
 const f=await fixture({lateSelector:true}),result=await rt.runPublicResearchQualification(f.scope,f.policy.id,f.runtime);assert.equal(result.resultId,id(21));assert.equal(f.sent.length,2);assert.equal(f.settlements.length,2);assert.equal(f.events.at(-1),'complete');
 await assert.rejects(rt.runPublicResearchQualification(f.scope,f.policy.id,f.runtime));assert.equal(f.sent.length,2);
});
test('R11 post-dispatch retention does not authorize a selector that was not admitted before expiry',async()=>{
 const f=await fixture({expireBeforeSelector:true});await assert.rejects(rt.runPublicResearchQualification(f.scope,f.policy.id,f.runtime));assert.equal(f.sent.length,1);assert.equal(f.events.includes('complete'),false);
});
test('R11 mismatched trusted wire, owner/root scope or forged loaded lineage fails before dispatch',async()=>{
 for(const mutate of [f=>f.loaded.search.wireHash='a'.repeat(64),f=>f.scope.businessId=id(99),f=>f.scope.coreWorkflowRunId=id(99),f=>f.loaded.policy.ownerId=id(99),f=>f.loaded.policyHash='a'.repeat(64)]){
  const f=await fixture();mutate(f);await assert.rejects(rt.runPublicResearchQualification(f.scope,f.policy.id,f.runtime));assert.equal(f.sent.length,0);
 }
});
test('R11 inert wire inspection never reads environment credentials or dispatches',async()=>{
 const f=await fixture();const source=q.publicResearchSearchRequest(f.policy,f.runtime.model,f.now),wire=await rt.inspectPublicResearchWire(source,'search');
 assert.equal(wire.requestHash,q.publicResearchHash(source));assert.equal(wire.maxTokens,4000);assert.match(wire.wireHash,/^[a-f0-9]{64}$/);assert.deepEqual(f.events,[]);
});
for(const rawCost of ['0x0','0b0','1e-9999','0.000000000000000000000001',' ',[],{},true,null,'NaN','Infinity','not-a-cost'])test('R11 malformed provider accounting cannot become a zero-cost settlement',async()=>{
 for(const httpError of [false,true]){
  const f=await fixture({rawCost,httpError});await assert.rejects(rt.runPublicResearchQualification(f.scope,f.policy.id,f.runtime));assert.equal(f.sent.length,1);assert.equal(f.settlements[0].receipt.reportedMicrousd,null);
 }
});
