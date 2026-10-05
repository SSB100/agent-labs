import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const q=require('../.core-tests/research/qualification.js');
const rt=require('../.core-tests/research/qualification-runtime.js');
const outcome=require('../.core-tests/research/qualification-outcome.js');
const route=require('../.core-tests/research/generation-route.js');
const {OpenRouterAdapter}=require('../.core-tests/models/openrouter.js');
const {resolveModelRoute}=require('../.core-tests/models/registry.js');
const id=n=>`11000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const config={apiKey:'inert-r11-test-key',baseUrl:'https://openrouter.ai/api/v1',appUrl:'https://example.invalid',appName:'R11 fixture'};
async function baseFixture(options={}){
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
const pending=require('../.core-tests/research/qualification-pending.js');
async function fixture(options={}){
 const f=await baseFixture({attemptVersion:2,thirtyMinute:true,...options}),baseRpc=f.runtime.rpc;
 f.loaded.receiptCandidates=[];let stopped=false;const lost=new Set();
 const once=(key)=>{if(lost.has(key))return false;lost.add(key);return true;};
 const now=()=>f.runtime.now();
 const status=entry=>{
  if(stopped)entry.status='stopped';
  else if(now()>=Date.parse(entry.receiptExpiresAt))entry.status='expired';
  else if(entry.status==='checking_receipt'&&now()>=Date.parse(entry.nextCheckAt))entry.status=entry.attempts===3?'exhausted':'awaiting_receipt';
  return entry;
 };
 const metadata=entry=>{const {candidate,proof,...common}=status(entry);void candidate;void proof;return structuredClone(common);};
 f.runtime.requireDurableReceipts=true;
 f.runtime.verifyGenerationRoute=async()=>{throw Error('Durable runtime must not use the legacy multi-read path');};
 f.runtime.verifyGenerationRouteOnce=async expected=>{
  f.events.push('route:once');f.routeQueries.push(structuredClone(expected));
  const phase=expected.generationId.includes('search')?'search':'select',attempt=f.routeQueries.filter(x=>x.generationId===expected.generationId).length;
  if(options.read)await options.read({expected,phase,attempt,fixture:f});
  return route.qualifyGenerationRouteProof({data:{id:expected.generationId,provider_name:'Azure',model:'openai/gpt-5.6-luna-20260709',provider_responses:null}},expected);
 };
 f.runtime.rpc=async(operation,payload)=>{
  if(operation==='load'){
   f.loaded.receiptCandidates.forEach(status);
   if(stopped||f.loaded.receiptCandidates.some(x=>x.status==='expired'))throw Error('inactive receipt');
   return baseRpc(operation,payload);
  }
  if(!['stage_receipt','claim_receipt','record_receipt'].includes(operation)){
   if(stopped&&['guard','collect','complete'].includes(operation))throw Error('stopped');
   return baseRpc(operation,payload);
  }
  f.events.push(operation);
  if(stopped)throw Error('stopped');
  if(operation==='stage_receipt'){
   assert.equal(payload.candidateHash,q.publicResearchHash(payload.candidate));
   assert.ok(f.settlements.some(x=>x.requestId===payload.requestId&&x.receipt.reportedMicrousd===payload.candidate.reportedMicrousd),'settlement precedes retention');
   let entry=f.loaded.receiptCandidates.find(x=>x.phase===payload.candidate.phase);const replayed=!!entry;
   if(entry){assert.equal(entry.candidateHash,payload.candidateHash);assert.deepEqual(entry.candidate,payload.candidate);}
   else {entry={phase:payload.candidate.phase,requestId:payload.requestId,candidateHash:payload.candidateHash,status:'awaiting_receipt',attempts:0,nextCheckAt:null,
    receiptExpiresAt:new Date(Date.parse(f.policy.validUntil)+1800000).toISOString(),diagnostic:null,proofHash:null,candidate:structuredClone(payload.candidate),proof:null};f.loaded.receiptCandidates.push(entry);}
   if(options.loseStage===entry.phase&&once('stage'))throw Error('stage committed but reply lost');
   return{...metadata(entry),staged:true,replayed};
  }
  const entry=f.loaded.receiptCandidates.find(x=>x.phase===payload.phase);assert.ok(entry);assert.equal(entry.candidateHash,payload.candidateHash);status(entry);
  if(operation==='claim_receipt'){
   if(['verified','terminal','exhausted','expired','stopped'].includes(entry.status))return{...metadata(entry),claimed:false,claimId:null,reason:entry.status};
   if(entry.nextCheckAt&&now()<Date.parse(entry.nextCheckAt))return{...metadata(entry),claimed:false,claimId:null,reason:'cooldown'};
   entry.attempts++;assert.ok(entry.attempts<=3);entry.status='checking_receipt';entry.nextCheckAt=new Date(now()+120000).toISOString();
   entry.diagnostic=null;const claimId=id((entry.phase==='search'?100:200)+entry.attempts);f.claims??=[];f.claims.push({claimId,phase:entry.phase,attempt:entry.attempts});
   if(options.loseClaim===entry.phase&&(options.alwaysLoseClaim||once('claim')))throw Error('claim committed but reply lost');
   return{...metadata(entry),claimed:true,claimId,reason:'claimed'};
  }
  assert.deepEqual(Object.keys(payload).sort(),['candidateHash','claimId','diagnostic','phase','policyId','proof','retryAfterAt']);
  assert.equal(payload.claimId,id((entry.phase==='search'?100:200)+entry.attempts));
  if(payload.proof){assert.equal(payload.diagnostic,null);assert.equal(payload.retryAfterAt,null);entry.proof=structuredClone(payload.proof);entry.proofHash=payload.proof.proofHash;entry.status='verified';entry.nextCheckAt=null;entry.diagnostic=null;}
  else {
   assert.ok(payload.diagnostic);entry.diagnostic=structuredClone(payload.diagnostic);
   const error=new route.GenerationRouteProofError(payload.diagnostic.code,payload.diagnostic.httpStatus,1);
   entry.status=route.isTransientGenerationRouteFailure(error)?entry.attempts===3?'exhausted':'awaiting_receipt':'terminal';
   if(!['terminal','exhausted'].includes(entry.status))entry.nextCheckAt=new Date(Math.max(Date.parse(entry.nextCheckAt),payload.retryAfterAt?Date.parse(payload.retryAfterAt):0)).toISOString();else entry.nextCheckAt=null;
  }
  if(entry.status==='terminal')await baseRpc('fail',{policyId:f.policy.id,phase:entry.phase,requestId:entry.requestId,reason:'response_provider_unqualified',
   observation:{...entry.candidate.observation,inferenceRouteStatus:'invalid',inferenceRouteProofHash:null,inferenceRouteFailureCode:entry.diagnostic.code,inferenceRouteHttpStatus:entry.diagnostic.httpStatus,inferenceRouteAttempts:entry.attempts}});
  if(options.loseRecord===entry.phase&&once('record'))throw Error('record committed but reply lost');
  return{...metadata(entry),recorded:true,replayed:false};
 };
 return Object.assign(f,{stop:()=>{stopped=true;},metadata});
}
const run=f=>rt.runPublicResearchQualification(f.scope,f.policy.id,f.runtime);
const transient=(status=404,retryAfterAt=null)=>new route.GenerationRouteProofError('api_failure',status,1,retryAfterAt);

test('durable R11 settles then retains only bounded public projection before its first claimed GET',async()=>{
 const f=await fixture({read:()=>{throw transient();},mutateResponse:r=>{r.provider='private-wrapper-label';r.secret='private-envelope';r.choices[0].message.annotations[0].url_citation.title='  Public report  ';r.choices[0].message.annotations[0].secret='private-annotation';}});
 const result=await run(f),entry=f.loaded.receiptCandidates[0];
 assert.equal(result.status,'receipt_pending');assert.equal(result.receiptStatus,'awaiting_receipt');assert.equal(result.attempts,1);assert.equal(result.canContinue,true);
 assert.equal(f.sent.length,1);assert.equal(f.failures.length,0);assert.equal(f.routeQueries.length,1);assert.equal(f.settlements.length,1);
 assert.deepEqual(f.events,['load','quote','guard','send:search','settle','stage_receipt','claim_receipt','route:once','record_receipt']);
 assert.equal(entry.candidateHash,q.publicResearchHash(entry.candidate));assert.equal(entry.candidate.output[0].url_citation.title,'Public report');
 assert.doesNotMatch(JSON.stringify([entry,result]),/private-wrapper-label|private-envelope|private-annotation|inert-r11-test-key/);
 assert.equal('candidate' in result,false);assert.equal('evidencePack' in result,false);assert.equal(entry.candidate.observation.inferenceRouteStatus,'unrequested');
});

test('durable R11 resumes after navigation and >20 seconds without repeating generation or renewing source age',async()=>{
 const f=await fixture({read:({phase,attempt})=>{if(phase==='search'&&attempt===1)throw transient();}});
 const first=await run(f),received=f.loaded.receiptCandidates[0].candidate.receivedAt,hash=first.candidateHash;
 f.setClock(f.now+21000);assert.equal((await run(f)).receiptStatus,'awaiting_receipt');assert.equal(f.routeQueries.length,1);
 f.setClock(f.now+121000);f.runtime={...f.runtime};const result=await run(f);
 assert.equal(result.status,'completed');assert.equal(result.resultId,id(21));assert.equal(f.sent.length,2);assert.equal(f.routeQueries.length,3);assert.equal(f.failures.length,0);
 assert.equal(f.loaded.receiptCandidates[0].candidateHash,hash);assert.equal(result.evidencePack.sources[0].retrievedAt,received);
 assert.equal(Date.parse(result.evidencePack.sources[0].retrievalExpiresAt),Date.parse(received)+86400000);
 assert.equal(f.events.filter(x=>x==='quote').length,2,'read-only receipt resume needs no new catalog quote');
});

test('durable R11 both phases survive independent restarts and the selector output is retained once',async()=>{
 const f=await fixture({read:({attempt})=>{if(attempt===1)throw transient();}});
 assert.equal((await run(f)).phase,'search');f.setClock(f.now+121000);const second=await run(f);
 assert.equal(second.phase,'select');assert.equal(second.status,'receipt_pending');const selected=structuredClone(f.loaded.receiptCandidates.find(x=>x.phase==='select').candidate);
 f.setClock(f.now+242000);const result=await run(f);
 assert.equal(result.status,'completed');assert.equal(f.sent.length,2);assert.equal(f.routeQueries.length,4);assert.equal(f.failures.length,0);
 assert.deepEqual(f.loaded.receiptCandidates.find(x=>x.phase==='select').candidate,selected);assert.equal(f.events.filter(x=>x==='complete').length,1);
});

test('durable R11 a concurrent receipt claimant cannot read again or revoke the owned claim',async()=>{
 let signal,release;const started=new Promise(resolve=>signal=resolve),wait=new Promise(resolve=>release=resolve);
 const f=await fixture({read:async({phase})=>{if(phase==='search'){signal();await wait;}}});
 const first=run(f);await started;const second=await run(f);
 assert.equal(second.receiptStatus,'checking_receipt');assert.equal(f.routeQueries.length,1);assert.equal(f.failures.length,0);assert.equal(f.sent.length,1);
 release();assert.equal((await first).status,'completed');assert.equal(f.sent.length,2);assert.equal(f.routeQueries.length,2);assert.equal(f.failures.length,0);
});

test('durable R11 duplicate paid guard ownership remains distinct from a receipt claim',async()=>{
 let signal,release;const started=new Promise(resolve=>signal=resolve),wait=new Promise(resolve=>release=resolve);
 const f=await fixture({beforeResponse:async phase=>{if(phase==='search'){signal();await wait;}}});const first=run(f);await started;
 await assert.rejects(run(f),outcome.PublicResearchQualificationUnacquiredError);assert.equal(f.failures.length,0);assert.equal(f.routeQueries.length,0);
 release();assert.equal((await first).status,'completed');assert.equal(f.sent.length,2);
});

for(const kind of ['Stage','Claim','Record'])test(`durable R11 lost ${kind.toLowerCase()} reply resumes committed state without revoke or another paid call`,async()=>{
 const f=await fixture({[`lose${kind}`]:'search'});await assert.rejects(run(f),outcome.PublicResearchQualificationUnacquiredError);
 assert.equal(f.failures.length,0);assert.equal(f.loaded.receiptCandidates.length,1);assert.equal(f.sent.length,1);
 if(kind==='Claim'){assert.equal((await run(f)).receiptStatus,'checking_receipt');assert.equal(f.routeQueries.length,0);f.setClock(f.now+121000);}
 const result=await run(f);assert.equal(result.status,'completed');assert.equal(f.sent.length,2);assert.equal(f.failures.length,0);
 assert.equal(f.routeQueries.filter(x=>x.generationId.includes('search')).length,1);
});

test('durable R11 a lost claim consumes each durable budget slot, including the third',async()=>{
 const f=await fixture({loseClaim:'search',alwaysLoseClaim:true});
 for(let i=0;i<3;i++){f.setClock(f.now+i*121000);await assert.rejects(run(f),outcome.PublicResearchQualificationUnacquiredError);}
 f.setClock(f.now+363000);const result=await run(f);assert.equal(result.receiptStatus,'exhausted');assert.equal(result.attempts,3);assert.equal(result.canContinue,false);
 assert.equal(f.sent.length,1);assert.equal(f.routeQueries.length,0);assert.equal(f.failures.length,0);
});

test('durable R11 never uses more than three claims per phase or six total and holds exhausted output',async()=>{
 const f=await fixture({read:({phase,attempt})=>{if(phase==='select'||attempt<3)throw transient(503);}});
 for(let i=0;i<5;i++){f.setClock(f.now+i*121000);const value=await run(f);assert.equal(value.status,'receipt_pending');}
 const result=await run(f);assert.equal(result.receiptStatus,'exhausted');assert.equal(result.phase,'select');assert.equal(result.canContinue,false);
 assert.equal(f.routeQueries.length,6);assert.equal(f.sent.length,2);assert.equal(f.claims.length,6);assert.equal(f.failures.length,0);assert.equal(f.events.includes('complete'),false);
});

test('durable R11 obeys a longer Retry-After without treating the wait as authority renewal',async()=>{
 const f=await fixture({read:({phase,attempt,fixture})=>{if(phase==='search'&&attempt===1)throw transient(429,new Date(fixture.now+600000).toISOString());}});
 const first=await run(f);assert.equal(first.nextCheckAt,new Date(f.now+600000).toISOString());f.setClock(f.now+121000);
 assert.equal((await run(f)).nextCheckAt,first.nextCheckAt);assert.equal(f.routeQueries.length,1);f.setClock(f.now+600000);assert.equal((await run(f)).status,'completed');assert.equal(f.sent.length,2);
});

test('durable R11 expired search authority can verify its receipt but cannot collect or admit a selector',async()=>{
 const f=await fixture({read:({phase,attempt})=>{if(phase==='search'&&attempt===1)throw transient();}});await run(f);
 f.setClock(Date.parse(f.policy.validUntil)+1);const result=await run(f);
 assert.equal(result.status,'receipt_pending');assert.equal(result.receiptStatus,'verified');assert.equal(result.canContinue,false);assert.equal(f.loaded.collection,null);
 assert.equal(f.sent.length,1);assert.equal(f.events.filter(x=>x==='quote').length,1);assert.equal(f.routeQueries.length,2);assert.equal(f.events.includes('collect'),false);assert.equal(f.failures.length,0);
});

test('durable R11 already-admitted selector can complete within original receipt grace after authority expiry',async()=>{
 const f=await fixture({read:({phase,attempt})=>{if(phase==='select'&&attempt===1)throw transient();}});const initial=await run(f);assert.equal(initial.phase,'select');
 const sourceTime=f.loaded.collection.collection.sources[0].retrievedAt;f.setClock(Date.parse(f.policy.validUntil)+1);const result=await run(f);
 assert.equal(result.status,'completed');assert.equal(f.sent.length,2);assert.equal(f.events.filter(x=>x==='quote').length,2);assert.equal(result.evidencePack.sources[0].retrievedAt,sourceTime);assert.equal(f.failures.length,0);
});

for(const point of ['before_resume','during_read','grace_expired'])test(`durable R11 ${point} keeps Stop and the original receipt expiry authoritative`,async()=>{
 const f=await fixture({read:({phase,attempt,fixture})=>{if(phase==='search'&&attempt===1)throw transient();if(point==='during_read')fixture.stop();}});await run(f);f.setClock(f.now+121000);
 if(point==='before_resume')f.stop();if(point==='grace_expired')f.setClock(Date.parse(f.loaded.receiptCandidates[0].receiptExpiresAt));
 await assert.rejects(run(f),outcome.PublicResearchQualificationUnacquiredError);assert.equal(f.sent.length,1);assert.equal(f.failures.length,0);assert.equal(f.events.includes('collect'),false);
 assert.equal(f.routeQueries.length,point==='during_read'?2:1);
});

for(const [code,status] of [['api_failure',401],['api_failure',403],['json_invalid',200],['model_mismatch',200],['provider_mismatch',200],['redirect_rejected',302],['response_too_large',200],['response_invalid',200]])test(`durable R11 terminal ${code}/${status} retains audit output and cannot retry`,async()=>{
 const f=await fixture({read:()=>{throw new route.GenerationRouteProofError(code,status,1);}}),result=await run(f);
 assert.equal(result.receiptStatus,'terminal');assert.equal(result.canContinue,false);f.setClock(f.now+121000);await assert.rejects(run(f),outcome.PublicResearchQualificationUnacquiredError);
 assert.equal(f.routeQueries.length,1);assert.equal(f.sent.length,1);assert.equal(f.failures.length,1);assert.equal(f.failures[0].reason,'response_provider_unqualified');assert.equal(f.loaded.collection,null);
});

for(const change of [f=>{delete f.runtime.verifyGenerationRouteOnce;},f=>{delete f.loaded.receiptCandidates;}])test('durable production cannot downgrade a missing one-read capability or receipt contract',async()=>{
 const f=await fixture();change(f);await assert.rejects(run(f),outcome.PublicResearchQualificationUnacquiredError);assert.equal(f.sent.length,0);assert.equal(f.routeQueries.length,0);assert.equal(f.failures.length,0);
});

for(const options of [{badOrigin:true},{badSelection:true},{wrongModel:true},{unknownCost:true},{mutateResponse:r=>{r.choices[0].finish_reason='length';}},{mutateResponse:r=>{r.choices[0].message.annotations=Array(5).fill(r.choices[0].message.annotations[0]);}}])test('durable R11 rejects all possible source/model/cost/selector gates before receipt I/O or retention',async()=>{
 const f=await fixture(options);await assert.rejects(run(f));const phase=options.badSelection?'select':'search';
 assert.equal(f.loaded.receiptCandidates.some(x=>x.phase===phase),false);assert.equal(f.routeQueries.filter(x=>x.generationId.includes(phase)).length,0);
});

for(const mutate of [entry=>{entry.candidate.output[0].url_citation.url='https://etsy.com/private';},entry=>{entry.candidate.receivedAt=new Date(Date.now()+86400000).toISOString();},entry=>{entry.candidate.raw='private secret';},entry=>{entry.candidateHash='f'.repeat(64);},entry=>{entry.candidate.observation.observedProvider='private';}])test('durable R11 revalidates saved output and hashes before any read or paid admission',async()=>{
 const f=await fixture({read:()=>{throw transient();}});await run(f);mutate(f.loaded.receiptCandidates[0]);f.setClock(f.now+121000);
 await assert.rejects(run(f),outcome.PublicResearchQualificationUnacquiredError);assert.equal(f.routeQueries.length,1);assert.equal(f.sent.length,1);assert.equal(f.failures.length,0);
});

test('durable R11 verified saved proof allows promotion after a lost response without another receipt GET',async()=>{
 const f=await fixture({loseRecord:'search'});await assert.rejects(run(f),outcome.PublicResearchQualificationUnacquiredError);
 const entry=f.loaded.receiptCandidates[0];assert.equal(pending.pendingReceiptResult(f.policy,entry,f.now).canContinue,true);assert.equal(entry.status,'verified');
 assert.equal((await run(f)).status,'completed');assert.equal(f.routeQueries.filter(x=>x.generationId.includes('search')).length,1);assert.equal(f.sent.length,2);
});

test('durable R11 terminal record reply loss preserves one atomic failure without a second fail RPC',async()=>{
 const f=await fixture({loseRecord:'search',read:()=>{throw new route.GenerationRouteProofError('provider_mismatch',200,1);}});
 await assert.rejects(run(f),outcome.PublicResearchQualificationUnacquiredError);assert.equal(f.failures.length,1);
 await assert.rejects(run(f),outcome.PublicResearchQualificationUnacquiredError);assert.equal(f.failures.length,1);assert.equal(f.routeQueries.length,1);assert.equal(f.sent.length,1);
});

test('durable R11 an untrusted adapter transport label cannot be rewritten into source provenance',async()=>{
 const f=await fixture(),provider=f.runtime.provider;f.runtime.provider=(...args)=>{const adapter=provider(...args);return{invokeWebSearch:async request=>({...await adapter.invokeWebSearch(request),provider:'not-the-reviewed-adapter'}),invokeStructured:request=>adapter.invokeStructured(request)};};
 await assert.rejects(run(f));assert.equal(f.sent.length,1);assert.equal(f.routeQueries.length,0);assert.equal(f.loaded.receiptCandidates.length,0);
});

for(const content of ['Contains a null\u0000 which PostgreSQL cannot retain as source data.', 'Contains an invalid surrogate \ud800 which cannot be canonical UTF-8.'])test('durable R11 rejects source text that cannot be represented canonically before staging',async()=>{
 const f=await fixture({mutateResponse:r=>{r.choices[0].message.annotations[0].url_citation.content=content;}});await assert.rejects(run(f));
 assert.equal(f.routeQueries.length,0);assert.equal(f.loaded.receiptCandidates.length,0);
});

test('durable R11 real one-read adapter returns after first404 and resumes a saved candidate after cooldown',async()=>{
 const f=await fixture(),gets=[];f.runtime.verifyGenerationRouteOnce=expected=>route.fetchGenerationRouteProofOnce({...expected,config,now:f.runtime.now,fetcher:async(url,init)=>{
  gets.push({url,method:init.method});if(gets.length===1)return new Response('private metadata error',{status:404,headers:{'retry-after':'180'}});
  return new Response(JSON.stringify({data:{id:expected.generationId,provider_name:'Azure',model:'openai/gpt-5.6-luna-20260709',provider_responses:[]}}));
 }});
 const first=await run(f);assert.equal(first.status,'receipt_pending');assert.equal(first.nextCheckAt,new Date(f.now+180000).toISOString());assert.equal(gets.length,1);assert.equal(f.sent.length,1);
 f.setClock(f.now+180001);assert.equal((await run(f)).status,'completed');assert.equal(gets.length,3);assert.ok(gets.every(x=>x.method==='GET'));assert.equal(f.sent.length,2);
});

for(const operation of ['collect','complete'])test(`durable R11 lost committed ${operation} reply never repeats a paid call or revokes saved output`,async()=>{
 const f=await fixture(),rpc=f.runtime.rpc;let lost=false;f.runtime.rpc=async(op,payload)=>{const result=await rpc(op,payload);if(op===operation&&!lost){lost=true;throw Error('committed reply lost');}return result;};
 await assert.rejects(run(f),outcome.PublicResearchQualificationUnacquiredError);assert.equal(f.failures.length,0);
 assert.equal((await run(f)).status,'completed');assert.equal(f.sent.length,2);assert.equal(f.routeQueries.length,2);assert.equal(f.failures.length,0);
});

test('durable R11 failed route-proof enrichment reuses saved proof and original cost on Continue',async()=>{
 const f=await fixture(),settle=f.runtime.settle;let lost=false;f.runtime.settle=async(requestId,receipt)=>{if(receipt.generationRouteProof&&!lost){lost=true;throw Error('settlement reply lost');}return settle(requestId,receipt);};
 await assert.rejects(run(f),outcome.PublicResearchQualificationUnacquiredError);assert.equal(f.loaded.receiptCandidates[0].status,'verified');assert.equal(f.failures.length,0);
 assert.equal((await run(f)).status,'completed');assert.equal(f.sent.length,2);assert.equal(f.routeQueries.length,2);assert.equal(f.failures.length,0);
});

for(const [field,width] of [['content',1800],['title',250]])test(`durable R11 ${field} truncation at a whitespace boundary is idempotent and retained`,async()=>{
 const f=await fixture({read:()=>{throw transient();},mutateResponse:r=>{r.choices[0].message.annotations[0].url_citation[field]='a'.repeat(width-1)+' b';}});
 const result=await run(f);assert.equal(result.status,'receipt_pending');assert.equal(f.failures.length,0);assert.equal(f.sent.length,1);assert.equal(f.routeQueries.length,1);
 const entry=f.loaded.receiptCandidates[0],projection=entry.candidate.output[0].url_citation;
 assert.equal(projection[field],'a'.repeat(width-1));
 assert.deepEqual(pending.normalizeReceiptSearchOutput(entry.candidate.output,f.policy),entry.candidate.output);
 assert.deepEqual(pending.validateReceiptCandidate(entry.candidate,f.policy,null,f.now),entry.candidate);
 assert.equal(q.publicResearchHash(entry.candidate),entry.candidateHash);
});

test('durable R11 an oversized valid Retry-After stays held throughout the original receipt grace',async()=>{
 const f=await fixture(),gets=[];f.runtime.verifyGenerationRouteOnce=expected=>route.fetchGenerationRouteProofOnce({...expected,config,now:f.runtime.now,fetcher:async(url,init)=>{
  gets.push({url,method:init.method});return new Response('private retry body',{status:429,headers:{'retry-after':'315360000000'}});
 }});
 const result=await run(f);assert.equal(result.status,'receipt_pending');assert.equal(result.nextCheckAt,'9999-12-31T23:59:59.999Z');assert.equal(gets.length,1);
 for(const offset of [121000,1800001,3599999]){
  f.setClock(f.now+offset);const retained=await run(f);assert.equal(retained.status,'receipt_pending');assert.equal(retained.nextCheckAt,'9999-12-31T23:59:59.999Z');assert.equal(gets.length,1);
 }
 f.setClock(Date.parse(result.receiptExpiresAt));await assert.rejects(run(f),outcome.PublicResearchQualificationUnacquiredError);
 assert.equal(gets.length,1);assert.equal(f.sent.length,1);assert.equal(f.failures.length,0);assert.equal(f.events.includes('collect'),false);
});

for(const [field,width] of [['content',1800],['title',250]])test(`durable R11 ${field} truncation preserves whole Unicode scalars at its UTF-16 boundary`,async()=>{
 const f=await fixture({read:()=>{throw transient();},mutateResponse:r=>{r.choices[0].message.annotations[0].url_citation[field]='a'.repeat(width-1)+'🌱';}});
 const result=await run(f);assert.equal(result.status,'receipt_pending');assert.equal(f.failures.length,0);assert.equal(f.sent.length,1);assert.equal(f.routeQueries.length,1);
 const entry=f.loaded.receiptCandidates[0],projection=entry.candidate.output[0].url_citation;
 assert.equal(projection[field],'a'.repeat(width-1));assert.ok(projection[field].length<=width);assert.equal(Buffer.from(projection[field],'utf8').toString('utf8'),projection[field]);
 assert.deepEqual(pending.normalizeReceiptSearchOutput(entry.candidate.output,f.policy),entry.candidate.output);
 assert.deepEqual(pending.validateReceiptCandidate(entry.candidate,f.policy,null,f.now),entry.candidate);assert.equal(q.publicResearchHash(entry.candidate),entry.candidateHash);
 const fullScalar=structuredClone(entry.candidate.output);fullScalar[0].url_citation[field]='a'.repeat(width-2)+'🌱';
 assert.equal(pending.normalizeReceiptSearchOutput(fullScalar,f.policy)[0].url_citation[field],'a'.repeat(width-2)+'🌱');
});

for(const invalid of ['\ud800','\udc00','\u0000'])test('durable R11 bounded title projection still rejects original invalid Unicode and nulls',async()=>{
 const f=await fixture({mutateResponse:r=>{r.choices[0].message.annotations[0].url_citation.title='a'.repeat(249)+invalid;}});await assert.rejects(run(f));
 assert.equal(f.routeQueries.length,0);assert.equal(f.loaded.receiptCandidates.length,0);
});

for(const duplicate of ['url','content'])test(`durable R11 preserves historical greedy source deduplication for repeated ${duplicate}`,async()=>{
 const f=await fixture({read:({phase,attempt})=>{if(phase==='search'&&attempt===1)throw transient();},mutateResponse:(r,phase)=>{
  if(phase!=='search')return;const first=r.choices[0].message.annotations[0],repeated=structuredClone(first);
  if(duplicate==='url')repeated.url_citation.content='A second bounded observation from the same public article remains fully validated before source deduplication.';
  else repeated.url_citation.url='https://gardening.example/another-report';
  repeated.url_citation.title='A repeated public source';r.choices[0].message.annotations.push(repeated);
 }});
 const waiting=await run(f);assert.equal(waiting.status,'receipt_pending');assert.equal(f.failures.length,0);
 const staged=structuredClone(f.loaded.receiptCandidates[0]);assert.equal(staged.candidate.output.length,2);assert.equal(staged.candidate.observation.annotationCount,2);
 assert.deepEqual(staged.candidate.observation.approvedDomainCounts,[{domain:'gardening.example',count:2}]);
 f.setClock(f.now+121000);const result=await run(f);
 assert.equal(result.status,'completed');assert.equal(f.sent.length,2);assert.equal(f.routeQueries.length,3);assert.equal(f.failures.length,0);
 assert.equal(f.loaded.collection.collection.sources.length,1);assert.equal(result.evidencePack.sources.length,1);
 assert.equal(result.evidencePack.sources[0].url,'https://gardening.example/report');
 assert.deepEqual(f.loaded.receiptCandidates[0].candidate,staged.candidate);assert.equal(f.loaded.receiptCandidates[0].candidateHash,staged.candidateHash);
});

test('durable R11 duplicate citation preservation still validates every annotation before staging',async()=>{
 const f=await fixture({mutateResponse:(r,phase)=>{if(phase!=='search')return;const repeated=structuredClone(r.choices[0].message.annotations[0]);repeated.url_citation.url='https://etsy.com/restricted';r.choices[0].message.annotations.push(repeated);}});
 await assert.rejects(run(f));assert.equal(f.sent.length,1);assert.equal(f.routeQueries.length,0);assert.equal(f.loaded.receiptCandidates.length,0);
});
