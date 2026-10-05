import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const q=require('../.core-tests/research/qualification.js');
const rt=require('../.core-tests/research/qualification-runtime.js');
const {ModelProviderError}=require('../.core-tests/models/types.js');
const outcome=require('../.core-tests/research/qualification-outcome.js');
const route=require('../.core-tests/research/generation-route.js');
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
 if(options.thirtyMinute){policy.version='r11.public-research.2';policy.validFrom=new Date(now).toISOString();policy.validUntil=new Date(now+1800000).toISOString();policy.quoteValidUntil=policy.validUntil;}
 const scope={businessId:policy.businessId,coreWorkflowRunId:policy.workflowRunId,runtimeCapability:'inert-runtime-capability'};
 const search=await rt.inspectPublicResearchWire(q.publicResearchSearchRequest(policy,model,now),'search');
 const attemptVersion=options.attemptVersion??1;
 const loaded={policy,policyHash:q.publicResearchHash(policy),search,collection:null,attemptVersion,operationKeys:attemptVersion===2?{search:`research.search.r11v2.${policy.id}`,select:`research.model.r11v2.${policy.id}`}:{search:'research.search',select:'research.model'}};
 const events=[],sent=[],settlements=[],routeQueries=[],failures=[],marked=new Set();let revoked=false,resultCommitted=false;
 const excerpt='Adult gardeners often value practical tools and containers suited to the available growing space. This is a bounded public observation.';
 const runtime={now:()=>clock,model,
  async verifyQuote(p){events.push('quote');if(options.quoteFailure)throw Error('stale quote');assert.equal(p.quoteHash,policy.quoteHash);const quote={providerName:'Azure',acceptedResponseModelIds:[model.providerModelId,'openai/gpt-5.6-luna-20260709'],quoteValidUntil:new Date(clock+300000).toISOString()};options.mutateQuote?.(quote,clock);return quote;},
  async verifyGenerationRoute(expected){events.push('route');routeQueries.push(structuredClone(expected));if(options.routeError)throw options.routeError===true?Error('private route lookup failure'):options.routeError;if(options.routeNull)return null;
   const raw={data:{id:expected.generationId,provider_name:'Azure',model:'openai/gpt-5.6-luna-20260709',provider_responses:null}};options.mutateRoute?.(raw);return route.qualifyGenerationRouteProof(raw,expected);},
  async rpc(operation,payload){events.push(operation);if(operation==='load'){if(revoked)throw Error('policy revoked');return structuredClone(loaded);}
   if(operation==='fail'){if(options.journalFailure)throw Error('journal unavailable');
    if(options.supersedeProgressedPhase&&((payload.phase==='search'&&loaded.collection)||(payload.phase==='select'&&resultCommitted)))return{recorded:false,superseded:true,reason:'phase_progressed',workflowStatus:resultCommitted?'completed':'running'};
    failures.push(structuredClone(payload));revoked=true;return{outcomeId:id(90),recorded:true,replayed:false,workflowStatus:'needs_owner'};}
   if(operation==='guard'){
    if(policy.version==='r11.public-research.2'){assert.equal(payload.quoteValidUntil,new Date(clock+300000).toISOString());assert.equal('quoteValidUntil' in payload.admission,false);}
    assert.equal(payload.admission.operationKey,loaded.operationKeys[payload.phase]);assert.equal(payload.admission.accounting.kind,'r05');assert.deepEqual(payload.admission.sourceDomains,policy.allowedDomains);assert.deepEqual(payload.admission.dataClasses,['generic_public_query','public_evidence']);
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
    resultCommitted=true;return{resultId:id(21),evidencePackHash:payload.evidencePackHash,replayed:false};
   }
   throw Error('unexpected operation');
  },
  async settle(requestId,receipt){events.push('settle');settlements.push({requestId,receipt});if(options.settleFailure||(options.enrichmentFailure&&receipt.generationRouteProof))throw Error('settlement unavailable');},
  provider:(admit,observeResponse)=>new OpenRouterAdapter({config,admitDispatch:admit,...(options.omitObserver?{}:{observeResponse}),fetcher:async(url,init)=>{
   const body=JSON.parse(init.body),phase=body.tools?'search':'select';events.push(`send:${phase}`);sent.push({url,body,redirect:init.redirect});
   await options.beforeResponse?.(phase);
   if(options.transportFailure===phase)throw Error('uncertain transport failure');
   if(phase==='select'&&options.lateSelector)clock=Date.parse(policy.validUntil)+1000;
   const content=phase==='search'?{content:'Search result',annotations:[{type:'url_citation',url_citation:{url:options.badOrigin?'https://etsy.com/listing/1':'https://gardening.example/report',title:'Public report',content:excerpt}}]}:{content:JSON.stringify({selections:[{sourceKey:'S1',quote:options.badSelection?'This invented quote is not present in the source excerpt.':excerpt.slice(0,98).trim()}],limitations:['limited_sources']})};
   const response={id:`gen-inert-${phase}-receipt`,provider:options.wrongProvider?'private-provider-secret':'Azure',model:options.wrongModel?'private/model-secret':options.canonicalModel?'openai/gpt-5.6-luna-20260709':model.providerModelId,
    choices:[{finish_reason:'stop',message:content}],usage:{prompt_tokens:10,completion_tokens:10,...(options.unknownCost?{}:{cost:Object.hasOwn(options,'rawCost')?options.rawCost:options.overage?0.26:0.001}),...(phase==='search'?{server_tool_use:{web_search_requests:1}}:{})}};
   options.mutateResponse?.(response,phase);
   return new Response(JSON.stringify(response),{status:options.httpError?400:200});
  }})};
 return{now,policy,scope,runtime,loaded,events,sent,settlements,routeQueries,failures,marked,setClock:value=>clock=value};
}
test('R11 thirty-minute authority refreshes and separately binds both phase quote deadlines after the original quote expired',async()=>{
 const f=await fixture({attemptVersion:2,thirtyMinute:true});f.setClock(f.now+6*60000);
 const result=await rt.runPublicResearchQualification(f.scope,f.policy.id,f.runtime);
 assert.equal(f.sent.length,2);assert.equal(f.routeQueries.length,2);assert.equal(result.evidencePack.sourceLineage.version,'r11.public-research.2');
 assert.equal(f.events.filter(x=>x==='quote').length,2);
});
for(const mutateQuote of [q=>delete q.quoteValidUntil,q=>q.quoteValidUntil='bad',(q,now)=>q.quoteValidUntil=new Date(now).toISOString(),(q,now)=>q.quoteValidUntil=new Date(now+300001).toISOString()])test('R11 thirty-minute authority cannot dispatch with missing, stale or overlong phase quote freshness',async()=>{
 const f=await fixture({attemptVersion:2,thirtyMinute:true,mutateQuote});await assert.rejects(rt.runPublicResearchQualification(f.scope,f.policy.id,f.runtime));
 assert.equal(f.sent.length,0);assert.equal(f.events.includes('guard'),false);assert.equal(f.settlements.length,0);
});
test('R11 a fresh phase quote cannot extend the fixed thirty-minute source authority',async()=>{
 const f=await fixture({attemptVersion:2,thirtyMinute:true});f.setClock(Date.parse(f.policy.validUntil));
 await assert.rejects(rt.runPublicResearchQualification(f.scope,f.policy.id,f.runtime));assert.equal(f.sent.length,0);assert.equal(f.events.includes('quote'),false);
});
test('R11 bounded runner makes exactly one search plus selector with durable lineage and original R05 authority',async()=>{
 const f=await fixture(),result=await rt.runPublicResearchQualification(f.scope,f.policy.id,f.runtime);
 assert.equal(f.sent.length,2);assert.equal(f.settlements.length,4);assert.deepEqual(f.events,['load','quote','guard','send:search','settle','route','settle','collect','quote','guard','send:select','settle','route','settle','complete']);
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
for(const options of [{collectFailure:true},{settleFailure:true},{badOrigin:true},{unknownCost:true},{overage:true},{routeError:true},{wrongModel:true},{transportFailure:'search'}])test('R11 failed search proof or uncertain liability never proceeds to selector or retries',async()=>{
 const f=await fixture(options);await assert.rejects(rt.runPublicResearchQualification(f.scope,f.policy.id,f.runtime));assert.equal(f.sent.length,1);
 await assert.rejects(rt.runPublicResearchQualification(f.scope,f.policy.id,f.runtime));assert.equal(f.sent.length,1);
});
test('R11 invalid paid selector preserves both receipts and cannot repeat the selector',async()=>{
 const f=await fixture({badSelection:true});await assert.rejects(rt.runPublicResearchQualification(f.scope,f.policy.id,f.runtime));assert.equal(f.sent.length,2);assert.equal(f.settlements.length,4);
 await assert.rejects(rt.runPublicResearchQualification(f.scope,f.policy.id,f.runtime));assert.equal(f.sent.length,2);
});
test('R11 missing durable result never becomes claimed success and never repeats a paid phase',async()=>{
 const f=await fixture({completeFailure:true});await assert.rejects(rt.runPublicResearchQualification(f.scope,f.policy.id,f.runtime));assert.equal(f.sent.length,2);assert.equal(f.settlements.length,4);
 await assert.rejects(rt.runPublicResearchQualification(f.scope,f.policy.id,f.runtime));assert.equal(f.sent.length,2);
});
test('R11 already admitted selector output survives policy expiry through bounded audit completion',async()=>{
 const f=await fixture({lateSelector:true}),result=await rt.runPublicResearchQualification(f.scope,f.policy.id,f.runtime);assert.equal(result.resultId,id(21));assert.equal(f.sent.length,2);assert.equal(f.settlements.length,4);assert.equal(f.events.at(-1),'complete');
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

async function stopped(f,reason){
 let failure;try{await rt.runPublicResearchQualification(f.scope,f.policy.id,f.runtime);}catch(error){failure=error;}
 assert.ok(failure instanceof outcome.PublicResearchQualificationError);assert.equal(failure.reason,reason);return failure;
}
for(const canonicalModel of [false,true])test(`R11 V2 accepts only the quote-verified ${canonicalModel?'canonical':'alias'} response identity without rewriting the receipt`,async()=>{
 const f=await fixture({attemptVersion:2,canonicalModel});f.scope.admissionKey='server-only-inert-key';
 const result=await rt.runPublicResearchQualification(f.scope,f.policy.id,f.runtime);
 assert.equal(f.sent.length,2);assert.equal(result.receipts[0].providerModelId,canonicalModel?'openai/gpt-5.6-luna-20260709':f.policy.modelId);
 assert.equal(f.failures.length,0);assert.ok(!JSON.stringify(f.sent).includes('server-only-inert-key'));
});
for(const model of ['openai/gpt-5.6-luna-20260710','openai/gpt-5.6-luna:online','openai/gpt-5.6-luna-20260709-extra','malicious-private-model'])test('R11 model matching never broadens to prefixes, variants or unknown text',async()=>{
 const f=await fixture({attemptVersion:2,mutateResponse:r=>{r.model=model;}}),error=await stopped(f,'response_model_unqualified');
 assert.equal(error.observation.modelIdentity,'other');assert.equal(error.observation.observedModelId,null);assert.equal(error.recorded,true);
 assert.equal(f.sent.length,1);assert.equal(f.settlements.length,1);assert.ok(!JSON.stringify([...f.failures,...f.settlements]).includes(model));
});
test('R11 an unknown wrapper label stays observational while documented inference proof qualifies',async()=>{
 const f=await fixture({wrongProvider:true}),result=await rt.runPublicResearchQualification(f.scope,f.policy.id,f.runtime);
 assert.equal(result.resultId,id(21));assert.equal(f.settlements[0].receipt.responseProviderIdentity,'other');assert.equal(f.settlements[0].receipt.observedResponseProvider,null);
 assert.ok(!JSON.stringify([result,...f.failures,...f.settlements]).includes('private-provider-secret'));
 assert.equal(f.settlements[1].receipt.generationRouteProof.providerName,'Azure');assert.equal(f.routeQueries.length,2);
});
for(const [mutateResponse,reason,check] of [
 [(r)=>{delete r.model;},'response_model_unqualified',o=>assert.equal(o.modelIdentity,'missing')],
 [(r)=>{r.model={secret:'unknown-model'};},'response_model_unqualified',o=>assert.equal(o.modelIdentity,'invalid')],
 [(r)=>{delete r.usage.server_tool_use;},'source_contract_invalid',o=>assert.equal(o.searchRequests,null)],
 [(r)=>{r.usage.server_tool_use.web_search_requests=2;},'source_contract_invalid',o=>assert.equal(o.searchRequests,2)],
 [(r)=>{delete r.choices[0].message.annotations;},'source_contract_invalid',o=>assert.equal(o.annotationCount,null)],
 [(r)=>{r.choices[0].message.annotations=[];},'source_contract_invalid',o=>assert.equal(o.annotationCount,0)],
 [(r)=>{r.choices[0].message.annotations.push(null);},'source_contract_invalid',o=>{assert.equal(o.annotationCount,2);assert.equal(o.malformedAnnotationCount,1);}],
 [(r)=>{r.choices[0].message.annotations[0].url_citation.url='https://private-unapproved.example/secret?data=private';},'source_contract_invalid',o=>assert.equal(o.rejectedDomainCount,1)],
 [(r)=>{r.choices[0].message.annotations[0].url_citation.content={secret:'private'};},'source_contract_invalid',o=>assert.equal(o.malformedAnnotationCount,1)],
 [(r)=>{r.choices[0].message.annotations[0].url_citation.url='https://gardening.example/secret?token=private';},'source_contract_invalid',o=>assert.equal(o.malformedAnnotationCount,1)],
])test(`R11 ${reason} keeps bounded shape before rejected annotations disappear`,async()=>{
 const f=await fixture({mutateResponse}),error=await stopped(f,reason);check(error.observation);
 assert.equal(f.sent.length,1);assert.equal(f.settlements.length,reason==='response_model_unqualified'?1:2);assert.equal(error.recorded,true);assert.equal(error.phase,'search');assert.equal(error.requestId,id(10));
 assert.equal(f.events.at(-1),'fail');assert.ok(f.events.indexOf('settle')<f.events.indexOf('fail'));
 const persisted=JSON.stringify(f.failures);for(const secret of ['private','https://','Search result','Adult gardeners','unknown-model'])assert.ok(!persisted.includes(secret));
});
for(const [options,reason,phase] of [
 [{collectFailure:true},'collection_persistence_failed','search'],[{settleFailure:true},'cost_unverified_or_over_cap','search'],
 [{unknownCost:true},'cost_unverified_or_over_cap','search'],[{overage:true},'cost_unverified_or_over_cap','search'],
 [{completeFailure:true},'result_persistence_failed','select'],[{badSelection:true},'selector_output_invalid','select'],
 [{transportFailure:'search'},'provider_response_invalid','search'],
])test(`R11 durable ${reason} journal survives safe rethrow without retry`,async()=>{
 const f=await fixture(options),error=await stopped(f,reason),calls=f.sent.length;
 assert.equal(error.recorded,true);assert.equal(error.outcomeId,id(90));assert.equal(error.phase,phase);assert.equal(f.failures.length,1);
 await assert.rejects(rt.runPublicResearchQualification(f.scope,f.policy.id,f.runtime));assert.equal(f.sent.length,calls);assert.equal(f.failures.length,1);
 if(options.unknownCost)assert.equal(f.settlements[0].receipt.reportedMicrousd,null);
});
test('R11 malformed selector JSON preserves returned response shape and records its exact gate',async()=>{
 const f=await fixture({mutateResponse:(r,phase)=>{if(phase==='select'){r.choices[0].finish_reason='length';r.choices[0].message.content='private rejected selector output';}}});
 const error=await stopped(f,'selector_output_invalid');assert.equal(error.observation.finishReason,'length');assert.equal(error.observation.providerError,'malformed_model_output');
 assert.equal(f.settlements.length,4);assert.ok(!JSON.stringify(f.failures).includes('private rejected'));
});
test('R11 legacy adapter observation upgrades exact Azure hash while verifying its route without a callback',async()=>{
 const f=await fixture(),original=f.runtime.provider;
 const observation=outcome.observePublicResearchResponse({model:f.policy.modelId,provider:'Azure',choices:[{finish_reason:'length',message:{annotations:[]}}],usage:{server_tool_use:{web_search_requests:1}}},
  {modelId:f.policy.modelId,acceptedResponseModelIds:[f.policy.modelId],allowedDomains:f.policy.allowedDomains,excludedDomains:f.policy.excludedDomains});
 delete observation.responseProviderHash;delete observation.inferenceRouteStatus;delete observation.inferenceRouteProofHash;
 delete observation.inferenceRouteFailureCode;delete observation.inferenceRouteHttpStatus;delete observation.inferenceRouteAttempts;
 f.runtime.provider=(admit)=>{
  const adapter=original(admit);return{invokeStructured:r=>adapter.invokeStructured(r),async invokeWebSearch(r){
   const response=await adapter.invokeWebSearch(r);
   throw new ModelProviderError('malformed_model_output','private provider error',false,{validationGate:'source_contract',researchObservation:observation,
    providerReceipt:{providerModelId:response.providerModelId,upstreamProvider:'Azure',providerRequestId:response.providerRequestId,usage:{reportedCostUsd:.001}}});
  }};
 };
 const error=await stopped(f,'source_contract_invalid');assert.equal(error.observation.annotationCount,0);assert.equal(error.observation.finishReason,'length');assert.equal(error.observation.searchRequests,1);
 assert.equal(f.settlements.length,2);assert.ok(!JSON.stringify(f.failures).includes('private provider error'));
 assert.equal(Object.keys(error.observation).length,17);assert.equal(error.observation.responseProviderHash,require('node:crypto').createHash('sha256').update('Azure').digest('hex'));
 assert.equal(error.observation.inferenceRouteStatus,'verified');assert.deepEqual(outcome.validateResearchObservation(error.observation,f.policy.allowedDomains,f.policy.modelId),error.observation);
});
test('R11 a failed journal never masquerades as a persisted diagnosis or retries payment',async()=>{
 const f=await fixture({badOrigin:true,journalFailure:true}),error=await stopped(f,'source_contract_invalid');
 assert.equal(error.recorded,false);assert.equal(error.outcomeId,null);assert.equal(f.sent.length,1);assert.equal(f.events.at(-1),'fail');
 await assert.rejects(rt.runPublicResearchQualification(f.scope,f.policy.id,f.runtime));assert.equal(f.sent.length,1);
});
for(const mutate of [
 f=>{f.loaded.operationKeys.search='research.search.r11v2.'+id(90);},
 f=>{f.loaded.operationKeys.select='research.model.r11v2.'+id(90);},
 f=>{f.loaded.operationKeys.extra='research.search';},f=>{delete f.loaded.operationKeys;},
 f=>{f.loaded.attemptVersion=3;},f=>{f.loaded.operationKeys.search='research.search';},
])test('R11 V2 rejects tampered, arbitrary or downgraded loaded operation identity before dispatch',async()=>{
 const f=await fixture({attemptVersion:2});mutate(f);await assert.rejects(rt.runPublicResearchQualification(f.scope,f.policy.id,f.runtime),outcome.PublicResearchQualificationUnacquiredError);assert.equal(f.sent.length,0);assert.equal(f.events.includes('guard'),false);assert.equal(f.failures.length,0);
});
test('R11 observation parser rejects free text, unknown identifiers, extra fields and unbounded/incoherent counters',()=>{
 const context={modelId:'openai/gpt-5.6-luna',acceptedResponseModelIds:['openai/gpt-5.6-luna','openai/gpt-5.6-luna-20260709'],allowedDomains:['gardening.example'],excludedDomains:[]};
 const observation=outcome.observePublicResearchResponse({model:context.acceptedResponseModelIds[1],provider:'Azure',choices:[{finish_reason:'private reason',message:{annotations:[]}}]},context);
 assert.equal(observation.finishReason,'other');assert.equal(observation.modelIdentity,'canonical');
 assert.deepEqual(outcome.validateResearchObservation(observation,context.allowedDomains,context.modelId),observation);
 for(const mutate of [o=>{o.observedModelId='private';},o=>{o.observedProvider='private';},o=>{o.providerError='private';},o=>{o.raw='private';},
  o=>{o.searchRequests=1001;},o=>{o.annotationCount=-1;},o=>{o.approvedDomainCounts[0].domain='unapproved.example';},o=>{o.approvedDomainCounts[0].count=1;},
  o=>{o.approvedDomainCounts=[];},o=>{o.modelIdentity='other';},o=>{o.finishReason='private';}]){
  const changed=structuredClone(observation);mutate(changed);assert.throws(()=>outcome.validateResearchObservation(changed,context.allowedDomains,context.modelId));
 }
 const many=outcome.observePublicResearchResponse({choices:[{message:{annotations:Array(1001).fill(null)}}]},context);
 assert.equal(many.annotationCount,null);assert.equal(many.malformedAnnotationCount,1000);
});

test('R11 malformed provider choice envelope has a distinct gate and settles its known charge first',async()=>{
 const f=await fixture({mutateResponse:r=>{r.choices={private:'not-an-array'};}}),error=await stopped(f,'provider_response_invalid');
 assert.equal(error.observation.annotationCount,null);assert.equal(error.observation.finishReason,'missing');assert.equal(error.observation.searchRequests,1);
 assert.equal(f.settlements[0].receipt.reportedMicrousd,1000);assert.ok(f.events.indexOf('settle')<f.events.indexOf('fail'));assert.ok(!JSON.stringify(error).includes('not-an-array'));
});
test('R11 four-source bound reports the unfiltered count on rejection',async()=>{
 const f=await fixture({mutateResponse:r=>{r.choices[0].message.annotations=Array(5).fill(r.choices[0].message.annotations[0]);}}),error=await stopped(f,'source_contract_invalid');
 assert.equal(error.observation.annotationCount,5);assert.deepEqual(error.observation.approvedDomainCounts,[{domain:'gardening.example',count:5}]);assert.equal(f.sent.length,1);
});

for(const waitingPhase of ['search','select'])test(`R11 denied concurrent ${waitingPhase} invocation cannot revoke the admitted caller or its eventual result`,async()=>{
 let release,signalStarted;const started=new Promise(resolve=>{signalStarted=resolve;}),resume=new Promise(resolve=>{release=resolve;});
 const f=await fixture({attemptVersion:2,beforeResponse:async phase=>{if(phase===waitingPhase){signalStarted();await resume;}}});
 const first=rt.runPublicResearchQualification(f.scope,f.policy.id,f.runtime);
 await started;
 await assert.rejects(rt.runPublicResearchQualification(f.scope,f.policy.id,f.runtime),error=>{
  assert.ok(error instanceof outcome.PublicResearchQualificationUnacquiredError);
  assert.equal(error instanceof outcome.PublicResearchQualificationError,false);assert.equal(error.message,'public_research_qualification_unacquired');return true;
 });
 assert.equal(f.failures.length,0);assert.equal(f.events.includes('fail'),false,'duplicate must not submit a failure for the real caller');
 release();const result=await first;
 assert.equal(result.resultId,id(21));assert.equal(f.sent.length,2);assert.equal(f.settlements.length,4);assert.equal(f.events.filter(e=>e==='complete').length,1);
 assert.equal(f.failures.length,0);assert.equal(f.loaded.collection.id,id(20));
});
test('R11 uncertain guard response never borrows its persisted marker or misreports journal failure',async()=>{
 const f=await fixture({guardLoss:'search'});
 await assert.rejects(rt.runPublicResearchQualification(f.scope,f.policy.id,f.runtime),outcome.PublicResearchQualificationUnacquiredError);
 assert.equal(f.marked.has('search'),true);assert.equal(f.sent.length,0);assert.equal(f.failures.length,0);assert.equal(f.events.includes('fail'),false);
 await assert.rejects(rt.runPublicResearchQualification(f.scope,f.policy.id,f.runtime),outcome.PublicResearchQualificationUnacquiredError);
 assert.equal(f.sent.length,0);assert.equal(f.failures.length,0);
});

test('R11 completed search ownership cannot revoke a concurrent selector during the first callers later preflight failure',async()=>{
 let collectionReady,releaseFirst,selectorStarted,releaseSecond;
 const ready=new Promise(resolve=>{collectionReady=resolve;}),resumeFirst=new Promise(resolve=>{releaseFirst=resolve;});
 const selecting=new Promise(resolve=>{selectorStarted=resolve;}),resumeSecond=new Promise(resolve=>{releaseSecond=resolve;});
 const f=await fixture({attemptVersion:2,beforeResponse:async phase=>{if(phase==='select'){selectorStarted();await resumeSecond;}}});
 let quotes=0;
 const firstRuntime={...f.runtime,async verifyQuote(policy){if(++quotes===2)throw Error('later selector quote unavailable');return f.runtime.verifyQuote(policy);},
  async rpc(operation,payload){const value=await f.runtime.rpc(operation,payload);if(operation==='collect'){collectionReady();await resumeFirst;}return value;}};
 const first=rt.runPublicResearchQualification(f.scope,f.policy.id,firstRuntime);
 await ready;const second=rt.runPublicResearchQualification(f.scope,f.policy.id,f.runtime);await selecting;
 releaseFirst();await assert.rejects(first,outcome.PublicResearchQualificationUnacquiredError);assert.equal(f.failures.length,0);
 releaseSecond();assert.equal((await second).resultId,id(21));assert.equal(f.sent.length,2);assert.equal(f.events.filter(e=>e==='complete').length,1);
});

for(const reply of ['lost','malformed'])test(`R11 ${reply} collect reply cannot revoke a concurrent selector after the collection already committed`,async()=>{
 let collectionReady,releaseFirst,selectorStarted,releaseSecond;
 const ready=new Promise(resolve=>{collectionReady=resolve;}),resumeFirst=new Promise(resolve=>{releaseFirst=resolve;});
 const selecting=new Promise(resolve=>{selectorStarted=resolve;}),resumeSecond=new Promise(resolve=>{releaseSecond=resolve;});
 const f=await fixture({attemptVersion:2,supersedeProgressedPhase:true,beforeResponse:async phase=>{if(phase==='select'){selectorStarted();await resumeSecond;}}});
 const firstRuntime={...f.runtime,async rpc(operation,payload){const value=await f.runtime.rpc(operation,payload);if(operation==='collect'){
   collectionReady();await resumeFirst;if(reply==='lost')throw Error('collect reply lost after commit');return{collectionId:'malformed-committed-reply'};
  }return value;}};
 const first=rt.runPublicResearchQualification(f.scope,f.policy.id,firstRuntime);
 await ready;const second=rt.runPublicResearchQualification(f.scope,f.policy.id,f.runtime);await selecting;
 releaseFirst();await assert.rejects(first,error=>{assert.ok(error instanceof outcome.PublicResearchQualificationUnacquiredError);assert.equal(error instanceof outcome.PublicResearchQualificationError,false);return true;});
 assert.equal(f.events.filter(e=>e==='fail').length,1,'database arbitrates ambiguous persistence exactly once');
 assert.equal(f.failures.length,0,'superseded failure must not append an event or revoke');
 releaseSecond();assert.equal((await second).resultId,id(21));assert.equal(f.sent.length,2);assert.equal(f.settlements.length,4);assert.equal(f.events.filter(e=>e==='complete').length,1);
 assert.equal(f.failures.length,0);assert.equal(f.loaded.collection.id,id(20));
});
for(const reply of ['lost','malformed'])test(`R11 ${reply} completion reply reads back its committed result instead of claiming a diagnostic-write failure`,async()=>{
 const f=await fixture({attemptVersion:2,supersedeProgressedPhase:true}),rpc=f.runtime.rpc;
 f.runtime.rpc=async(operation,payload)=>{const value=await rpc(operation,payload);if(operation==='complete'){if(reply==='lost')throw Error('complete reply lost after commit');return{};}return value;};
 await assert.rejects(rt.runPublicResearchQualification(f.scope,f.policy.id,f.runtime),outcome.PublicResearchQualificationUnacquiredError);
 assert.equal(f.failures.length,0);assert.equal(f.sent.length,2);assert.equal(f.settlements.length,4);assert.equal(f.events.filter(e=>e==='complete').length,1);
 await assert.rejects(rt.runPublicResearchQualification(f.scope,f.policy.id,f.runtime),outcome.PublicResearchQualificationUnacquiredError);assert.equal(f.sent.length,2);assert.equal(f.failures.length,0);
});
test('R11 only an explicit validated phase-progressed response becomes safe readback',async()=>{
 const f=await fixture({collectFailure:true}),rpc=f.runtime.rpc;
 f.runtime.rpc=async(operation,payload)=>operation==='fail'?{recorded:false,superseded:true,reason:'unverified-other-status',workflowStatus:'running'}:rpc(operation,payload);
 const error=await stopped(f,'collection_persistence_failed');assert.equal(error.recorded,false);assert.equal(error.outcomeId,null);assert.equal(f.sent.length,1);
});

for(const wrapper of [undefined,'private-unknown-wrapper',{opaque:'private-label'}])test('R11 documented generation route permits an omitted or different wrapper provider without storing its text',async()=>{
 const f=await fixture({mutateResponse:r=>{if(wrapper===undefined)delete r.provider;else r.provider=wrapper;}}),result=await rt.runPublicResearchQualification(f.scope,f.policy.id,f.runtime);
 assert.equal(result.resultId,id(21));assert.equal(f.routeQueries.length,2);assert.equal(f.settlements.length,4);
 assert.deepEqual(f.routeQueries.map(x=>x.generationId),['gen-inert-search-receipt','gen-inert-select-receipt']);
 assert.ok(f.routeQueries.every(x=>x.requestedEndpoint==='azure/us'&&x.providerName==='Azure'&&x.acceptedResponseModelIds.length===2));
 for(const offset of [0,2]){
  const first=f.settlements[offset],last=f.settlements[offset+1];assert.equal(first.requestId,last.requestId);
  assert.equal(first.receipt.reportedMicrousd,last.receipt.reportedMicrousd);assert.equal(first.receipt.providerRequestId,last.receipt.providerRequestId);
  assert.equal(first.receipt.generationRouteProof,undefined);assert.equal(last.receipt.generationRouteProof.generationId,last.receipt.providerRequestId);
  assert.notEqual(q.publicResearchHash(first.receipt),q.publicResearchHash(last.receipt));assert.equal(last.receipt.generationRouteProof.modelId,'openai/gpt-5.6-luna-20260709');
 }
 assert.equal(JSON.stringify([result,...f.settlements]).includes('private-'),false);
 assert.deepEqual(f.events.filter(e=>['settle','route'].includes(e)),['settle','route','settle','settle','route','settle']);
});
for(const [options,status] of [
 [{routeError:true},'unavailable'],[{routeNull:true},'invalid'],
 [{mutateRoute:r=>{r.data.id='gen-another-request';}},'invalid'],
 [{mutateRoute:r=>{r.data.provider_name='private-non-Azure';}},'invalid'],
 [{mutateRoute:r=>{r.data.model='unknown/private-model';}},'invalid'],
 [{mutateRoute:r=>{r.data.provider_responses=[{provider_name:'Azure',model_permaslug:'openai/gpt-5.6-luna-20260709',status:500}];}},'invalid'],
])test(`R11 ${status} documented route keeps the first known charge and stops without a selector or fallback`,async()=>{
 const f=await fixture(options),error=await stopped(f,'response_provider_unqualified');
 assert.equal(error.observation.inferenceRouteStatus,status);assert.equal(error.observation.inferenceRouteProofHash,null);assert.equal(error.recorded,true);
 assert.equal(f.sent.length,1);assert.equal(f.settlements.length,1);assert.equal(f.settlements[0].receipt.reportedMicrousd,1000);assert.equal(f.routeQueries.length,1);
 assert.deepEqual(f.events.filter(e=>['settle','route'].includes(e)),['settle','route']);
 assert.ok(!JSON.stringify([error,...f.failures,...f.settlements]).includes('private-'));
 await assert.rejects(rt.runPublicResearchQualification(f.scope,f.policy.id,f.runtime));assert.equal(f.routeQueries.length,1);assert.equal(f.sent.length,1);
});
test('R11 route-proof enrichment failure retains original accounting and cannot authorize a selector',async()=>{
 const f=await fixture({enrichmentFailure:true}),error=await stopped(f,'cost_unverified_or_over_cap');
 assert.equal(f.sent.length,1);assert.equal(f.routeQueries.length,1);assert.equal(f.settlements.length,2);
 assert.equal(f.settlements[0].receipt.generationRouteProof,undefined);assert.equal(f.settlements[0].receipt.reportedMicrousd,1000);
 assert.equal(error.observation.inferenceRouteStatus,'verified');assert.equal(error.observation.inferenceRouteProofHash,f.settlements[1].receipt.generationRouteProof.proofHash);
});
for(const options of [{deny:'search'},{guardLoss:'search'},{transportFailure:'search'},{unknownCost:true},{overage:true},{settleFailure:true}])test('R11 no generation GET runs without an owned response and successfully settled in-cap cost',async()=>{
 const f=await fixture(options);await assert.rejects(rt.runPublicResearchQualification(f.scope,f.policy.id,f.runtime));assert.equal(f.routeQueries.length,0);
});
test('R11 malformed generation IDs never reach the reader, even after a marked response',async()=>{
 const f=await fixture({mutateResponse:r=>{r.id='not-a-generation-id';}}),error=await stopped(f,'response_provider_unqualified');
 assert.equal(f.settlements.length,1);assert.equal(f.routeQueries.length,0);assert.equal(error.observation.inferenceRouteStatus,'invalid');
});
test('R11 a missing injected route reader cannot be replaced with a wrapper-label assertion',async()=>{
 const f=await fixture();delete f.runtime.verifyGenerationRoute;const error=await stopped(f,'response_provider_unqualified');
 assert.equal(f.routeQueries.length,0);assert.equal(f.settlements.length,1);assert.equal(error.observation.providerIdentity,'exact');assert.equal(error.observation.inferenceRouteStatus,'invalid');
});
test('R11 legacy injected quote without a verified two-model mapping cannot fabricate a generation proof',async()=>{
 const f=await fixture();f.runtime.verifyQuote=async()=>({providerName:'Azure'});const error=await stopped(f,'response_provider_unqualified');
 assert.equal(f.sent.length,1);assert.equal(f.routeQueries.length,0);assert.equal(error.observation.inferenceRouteStatus,'invalid');
});
test('R11 adapter source rejection verifies its marked generation after settling, without treating unknown wrapper text as inference',async()=>{
 const f=await fixture({wrongProvider:true,mutateResponse:r=>{delete r.choices[0].message.annotations;}}),error=await stopped(f,'source_contract_invalid');
 assert.equal(f.routeQueries.length,1);assert.equal(f.settlements.length,2);assert.equal(error.observation.providerIdentity,'other');
 assert.equal(error.observation.inferenceRouteStatus,'verified');assert.equal(error.observation.inferenceRouteProofHash,f.settlements[1].receipt.generationRouteProof.proofHash);
 assert.ok(!JSON.stringify([error,...f.failures,...f.settlements]).includes('private-provider-secret'));
});

for(const field of ['generationId','acceptedResponseModelIds','requestedEndpoint'])test(`R11 injected generation reader cannot change the admitted ${field} across its async boundary`,async()=>{
 const f=await fixture();f.runtime.verifyGenerationRoute=async expected=>{
  const original=structuredClone(expected);await Promise.resolve();
  if(field==='generationId')expected.generationId='gen-another-paid-generation';
  if(field==='acceptedResponseModelIds')expected.acceptedResponseModelIds[1]='unreviewed/private-model';
  if(field==='requestedEndpoint')expected.requestedEndpoint='azure/eu';
  const verified=route.qualifyGenerationRouteProof({data:{id:original.generationId,provider_name:'Azure',model:original.acceptedResponseModelIds[1],provider_responses:null}},original);
  const altered={...verified,...(field==='generationId'?{generationId:expected.generationId}:field==='acceptedResponseModelIds'?{modelId:expected.acceptedResponseModelIds[1]}:{requestedEndpoint:expected.requestedEndpoint})};
  const {proofHash,...body}=altered;void proofHash;return{...body,proofHash:q.publicResearchHash(body)};
 };
 const error=await stopped(f,'response_provider_unqualified');assert.equal(error.observation.inferenceRouteStatus,'invalid');assert.equal(f.sent.length,1);assert.equal(f.settlements.length,1);
 assert.equal(f.settlements[0].receipt.providerRequestId,'gen-inert-search-receipt');assert.ok(!JSON.stringify(f.failures).includes('unreviewed/private-model'));
});


for(const [code,httpStatus,attempts,status] of [['api_failure',404,3,'unavailable'],['api_failure',401,1,'unavailable'],['transport_failure',null,3,'unavailable'],['timeout',null,2,'unavailable'],['json_invalid',200,1,'invalid'],['response_invalid',200,1,'invalid']])test(`R11 receipt ${code}/${httpStatus} records exact safe terminal metadata without another generation`,async()=>{
 const failure=new route.GenerationRouteProofError(code,httpStatus,attempts);failure.privateBody='private prompt or credential';
 const f=await fixture({routeError:failure}),error=await stopped(f,'response_provider_unqualified');
 assert.equal(error.observation.inferenceRouteFailureCode,code);assert.equal(error.observation.inferenceRouteHttpStatus,httpStatus);assert.equal(error.observation.inferenceRouteAttempts,attempts);assert.equal(error.observation.inferenceRouteStatus,status);
 assert.equal(f.sent.length,1);assert.equal(f.settlements.length,1);assert.equal(error.recorded,true);assert.doesNotMatch(JSON.stringify(f.failures),/private prompt|credential/);
 assert.deepEqual(outcome.validateResearchObservation(error.observation,f.policy.allowedDomains,f.policy.modelId),error.observation);
});
test('R11 holds each paid public response through transient receipt reads and never repeats generation',{timeout:10000},async()=>{
 const f=await fixture({attemptVersion:2,thirtyMinute:true}),reads=[];
 f.runtime.verifyGenerationRoute=expected=>route.fetchGenerationRouteProof({...expected,config,fetcher:async(url,init)=>{
  reads.push({url,method:init.method,id:expected.generationId});
  if(reads.filter(x=>x.id===expected.generationId).length===1)return new Response('private transient error body',{status:404});
  return new Response(JSON.stringify({data:{id:expected.generationId,provider_name:'Azure',model:'openai/gpt-5.6-luna-20260709',provider_responses:[]}}),{status:200});
 }});
 const result=await rt.runPublicResearchQualification(f.scope,f.policy.id,f.runtime);
 assert.equal(result.resultId,id(21));assert.equal(f.sent.length,2);assert.equal(f.settlements.length,4);assert.equal(reads.length,4);assert.ok(reads.every(x=>x.method==='GET'));
 assert.equal(reads.filter(x=>x.id==='gen-inert-search-receipt').length,2);assert.equal(reads.filter(x=>x.id==='gen-inert-select-receipt').length,2);assert.equal(f.failures.length,0);
});
