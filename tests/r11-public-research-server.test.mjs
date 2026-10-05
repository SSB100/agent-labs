import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript'),crypto=require('node:crypto');
const Q=require('../.core-tests/research/qualification.js'),QR=require('../.core-tests/research/qualification-quote.js'),R=require('../.core-tests/research/qualification-runtime.js');
const generationRoute=require('../.core-tests/research/generation-route.js');
const registry=require('../.core-tests/models/registry.js'),sources=require('../.core-tests/research/sources.js'),profile=require('../.core-tests/research/qualification-profile.js');
const id=n=>`11000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function freshQuote({maximumMicrousd=250000}={}){
 const now=Date.now(),l=QR.PUBLIC_RESEARCH_QUOTE_LIMITS,e={name:'Azure | openai/gpt-5.6-luna-20260709',model_id:l.modelId,provider_name:'Azure',tag:'azure/us',status:0,context_length:1050000,max_completion_tokens:128000,
  supported_parameters:['reasoning','max_completion_tokens','tools','tool_choice','response_format','structured_outputs'],pricing:{prompt:'0.00000022',completion:'0.00000132',input_cache_read:'0.000000022',input_cache_write:'0.000000275',overrides:[{min_prompt_tokens:272000,prompt:'0.00000044',completion:'0.00000198',input_cache_write:'0.00000055'}]}};
 return QR.qualifyPublicResearchQuote({now,maximumMicrousd,modelIdentityCatalog:{url:l.modelIdentityCatalogUrl,fetchedAt:new Date(now).toISOString(),payload:{data:[{id:l.modelId,canonical_slug:'openai/gpt-5.6-luna-20260709',links:{details:'/api/v1/models/openai/gpt-5.6-luna-20260709/endpoints'}}]}},canonicalModelCatalog:{url:'https://openrouter.ai/api/v1/models/openai/gpt-5.6-luna-20260709/endpoints',fetchedAt:new Date(now).toISOString(),payload:{data:{id:l.modelId,endpoints:[e]}}},modelCatalog:{url:l.modelCatalogUrl,fetchedAt:new Date(now).toISOString(),payload:{data:{id:l.modelId,endpoints:[e]}}},zdrCatalog:{url:l.zdrCatalogUrl,fetchedAt:new Date(now).toISOString(),payload:{data:[e]}}});
}
function harness(){
 const businessId=id(1),ownerId=id(2),policyId=id(3),workflowRunId=id(4),calls=[],effects=[],env={VERCEL_ENV:'production',R05_ADMISSION_SERVER_KEY:'inert-r11-owner-server-key-'.repeat(2),OPENROUTER_API_KEY:'inert-openrouter-key'};
 const q=freshQuote(),p=profile.PUBLIC_RESEARCH_PROOF_PROFILE,now=Date.now();
 const policy={version:'r11.public-research.1',id:policyId,businessId,ownerId,workflowRunId,goalId:id(5),operatingPolicyId:id(6),query:p.query,allowedDomains:[...p.allowedDomains],excludedDomains:[...p.excludedDomains],sourceReviews:p.sourceReviews.map(x=>({...x})),queryReviewHash:Q.publicResearchHash({query:p.query,classification:'generic_nonpersonal_public_research'}),termsReviewHash:p.termsReviewHash,independentReviewHash:'2'.repeat(64),approvalHash:'3'.repeat(64),modelId:q.modelId,providerEndpoint:q.providerEndpoint,recipients:{router:'openrouter.ai',search:'exa.ai',inferenceEndpoint:q.providerEndpoint},retention:{inference:'no_training_zdr',search:'query_retention_improvement_training_possible',application:'bounded_attributed_audit_evidence'},validFrom:new Date(now-1000).toISOString(),validUntil:q.validUntil,maximumMicrousd:250000,searchMicrousd:q.searchMicrousd,selectorMicrousd:q.selectorMicrousd,priceLimit:q.priceLimit,quoteHash:q.quoteHash,quoteValidUntil:q.validUntil};
 const cap=()=>crypto.createHmac('sha256',env.R05_ADMISSION_SERVER_KEY).update(Q.canonicalPublicResearchJson({version:'r11.owner-runtime.1',businessId,ownerId,policyId,workflowRunId})).digest('base64url');
 const researchPolicy=structuredClone(policy);for(const key of ['id','businessId','ownerId','workflowRunId','goalId','operatingPolicyId'])delete researchPolicy[key];
 const grant={version:'r11.owner-proof-grant.1',id:id(7),businessId,ownerId,policyId,workflowRunId,serverKeyHash:sha(env.R05_ADMISSION_SERVER_KEY),runtimeCapabilityHash:sha(cap()),researchPolicy,installationSnapshotHash:'4'.repeat(64)};
 const savedPolicy={policyId,workflowRunId,goalId:policy.goalId,operatingPolicyId:policy.operatingPolicyId,policy,policyHash:Q.publicResearchHash(policy),status:'ready',revoked:false,expired:false,phases:[],result:null};
 const row={businessId,ownerId,exposure:{currency:'USD',heldMicrounits:'598063',hasUnknown:false},policies:[savedPolicy],grants:[{grantId:grant.id,grantHash:Q.publicResearchHash(grant),grant,used:false,expired:false,revoked:false}],policyTotal:1,grantTotal:1};
 let readError=false,quoteHook=()=>{},runHook=()=>{},generationHook=()=>{},generationMutate=proof=>proof;
 const context={userId:ownerId,businesses:[{id:businessId}],supabase:{auth:{getClaims:async()=>({data:{claims:{sub:context.userId,session_id:id(8)}}})},rpc:async(name,args)=>{
  calls.push({name,args:structuredClone(args)});if(name==='r11_research_workspace_v2')return readError?{error:{message:'PRIVATE ERROR'}}:{data:structuredClone(row)};
  if(name==='r11_research_bootstrap'||name==='r11_research_continue'){const source=[...row.grants,...(row.continuationGrants??[])].find(x=>x.grantId===args.p_grant_id).grant;return{data:{policyId:source.policyId,workflowRunId:source.workflowRunId,replayed:false}};}
  if(name==='r11_research_stop_v2'){savedPolicy.revoked=true;savedPolicy.status='revoked';return{data:{policyId,revoked:true}};}
  throw Error('unexpected RPC');
 }}};
 function complete(){
  const response={provider:'openrouter.exa',providerModelId:policy.modelId,providerRequestId:'gen-inert-search-receipt',metadata:{searchRequests:1,actualUpstreamProvider:'Azure'},output:{annotations:[{type:'url_citation',url_citation:{url:'https://spiegel.medill.northwestern.edu/mothersday2026/',title:'Public gifting analysis',content:'The adult-consumer survey considered uniqueness, creating special memories, convenience, and cost when choosing gifts for this occasion.'}}]}};
  const expectation={generationId:response.providerRequestId,providerName:'Azure',acceptedResponseModelIds:[policy.modelId,QR.PUBLIC_RESEARCH_QUOTE_LIMITS.canonicalModelId],requestedEndpoint:'azure/us'},routeProof=generationRoute.qualifyGenerationRouteProof({data:{id:response.providerRequestId,provider_name:'Azure',model:QR.PUBLIC_RESEARCH_QUOTE_LIMITS.canonicalModelId}},expectation);
  const {collection,lineage}=Q.collectQualifiedPublicSources(policy,response,id(10),Date.now(),expectation.acceptedResponseModelIds,routeProof),evidencePack=Q.qualifiedPublicEvidence(policy,collection,lineage,{selections:[{sourceKey:'S1',quote:collection.sources[0].excerpt}],limitations:['limited_sources']});
  savedPolicy.phases=[{phase:'search',requestId:id(10),marked:true,settled:true,actualMicrounits:'7000',providerRequestId:'gen-inert-search-receipt'},{phase:'select',requestId:id(11),marked:true,settled:true,actualMicrounits:'1000',providerRequestId:'gen-inert-selector-receipt'}];
  savedPolicy.result={resultId:id(12),evidencePack,evidencePackHash:Q.publicResearchHash(evidencePack),collectionId:id(13),selectorRequestId:id(11),providerRequestId:'gen-inert-selector-receipt',createdAt:new Date().toISOString()};savedPolicy.status='completed';
 }
 const deps={'server-only':{},'node:crypto':crypto,'../lib/core-ui/owner-business':{verifyOwnerBusiness:async(c,b)=>c.userId===ownerId&&b===businessId},'../models/registry':registry,'./sources':sources,'./qualification':Q,'./qualification-quote':QR,'./qualification-profile':profile,'./qualification-owner-contract':require('../.core-tests/research/qualification-owner-contract.js'),'./qualification-outcome':require('../.core-tests/research/qualification-outcome.js'),
  './generation-route':generationRoute,
  './qualification-runtime':{...R,runPublicResearchQualification:async(scope,selected,runtime)=>{effects.push({kind:'run',scope:structuredClone(scope),selected});await runtime.verifyQuote(policy);if(runHook()!==false)complete();}},
  './qualification-server-dependencies':{researchQualificationDependencies:()=>({fetchGenerationRoute:async(expectation)=>{effects.push({kind:'generation-read',expectation:structuredClone(expectation)});generationHook(expectation);return generationMutate(generationRoute.qualifyGenerationRouteProof({data:{id:expectation.generationId,provider_name:'Azure',model:'openai/gpt-5.6-luna-20260709',provider_responses:[]}},expectation));},fetchQuote:async(options)=>{effects.push({kind:'quote',options:structuredClone(options)});quoteHook();return freshQuote(options);},makeRuntime:(scope,verifyQuote)=>({scope,verifyQuote})})}};
 const source=ts.transpileModule(readFileSync('src/research/qualification-server.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,m={exports:{}};
 runInNewContext(`(function(require,module,exports){${source}\n})`,{process:{env},Buffer,Date,URL,BigInt,structuredClone})(n=>{assert.ok(n in deps,n);return deps[n];},m,m.exports);
 return{...m.exports,context,row,policy,grant,savedPolicy,businessId,ownerId,policyId,workflowRunId,calls,effects,env,cap,complete,setReadError:v=>readError=v,onQuote:fn=>quoteHook=fn,onRun:fn=>runHook=fn,onGeneration:fn=>generationHook=fn,mutateGeneration:fn=>generationMutate=fn};
}

test('R11 owner read is quote-free, key-free and removes execution verifier metadata',async()=>{
 const h=harness();delete h.env.R05_ADMISSION_SERVER_KEY;
 const view=await h.readResearchQualification(h.context,h.businessId);assert.equal(view.unavailable,false);assert.equal(view.configured,false);assert.equal(view.exposure.heldMicrounits,'598063');assert.deepEqual(h.effects,[]);
 assert.deepEqual(h.calls.map(x=>x.name),['r11_research_workspace_v2']);assert.equal('serverKeyHash' in view.grants[0].grant,false);assert.equal('runtimeCapabilityHash' in view.grants[0].grant,false);
});
test('R11 explicit Prepare returns exact HMAC verifier metadata and fresh quote without creating authority or paid calls',async()=>{
 const h=harness();h.row.policies=[];h.row.policyTotal=0;const prepared=await h.prepareResearchBootstrap(h.context,h.businessId,h.policyId,h.workflowRunId);
 assert.equal(prepared.runtimeCapabilityHash,sha(h.cap()));assert.equal(prepared.serverKeyHash,sha(h.env.R05_ADMISSION_SERVER_KEY));assert.equal(prepared.authorityCreated,false);assert.equal(prepared.paidCalls,0);
 assert.equal(prepared.version,'r11.owner-proof-preparation.2');assert.equal(prepared.expiresAt,prepared.quote.validUntil);
 assert.equal(prepared.quote.totalMicrousd,175871);assert.equal(prepared.search.maxTokens,4000);assert.equal(prepared.sourceProfile.query,profile.PUBLIC_RESEARCH_PROOF_PROFILE.query);
 assert.equal(JSON.stringify(prepared).includes(h.cap()),false);assert.equal(JSON.stringify(prepared).includes(h.env.R05_ADMISSION_SERVER_KEY),false);assert.deepEqual(h.effects.map(e=>e.kind),['quote']);assert.ok(h.calls.every(c=>c.name==='r11_research_workspace_v2'));
});
for(const mode of ['preview','missing-key','missing-model-key','foreign-owner','foreign-business','expired-session','unavailable'])test('R11 invalid owner/configuration cannot prepare or activate paid proof',async()=>{
 const h=harness();h.row.policies=[];h.row.policyTotal=0;let business=h.businessId;if(mode==='preview')h.env.VERCEL_ENV='preview';if(mode==='missing-key')delete h.env.R05_ADMISSION_SERVER_KEY;if(mode==='missing-model-key')delete h.env.OPENROUTER_API_KEY;if(mode==='foreign-owner')h.context.userId=id(80);if(mode==='foreign-business')business=id(80);if(mode==='expired-session')h.context.supabase.auth.getClaims=async()=>({data:{claims:{sub:h.ownerId}}});if(mode==='unavailable')h.setReadError(true);
 await assert.rejects(h.prepareResearchBootstrap(h.context,business,h.policyId,h.workflowRunId));await assert.rejects(h.activateResearchGrant(h.context,business,h.grant.id,h.row.grants[0].grantHash));assert.deepEqual(h.effects,[]);assert.ok(h.calls.every(c=>c.name==='r11_research_workspace_v2'));
});
test('R11 configuration/owner drift while public quote is fetched cannot mint stale setup metadata',async()=>{
 for(const kind of ['key','owner']){const h=harness();h.row.policies=[];h.row.policyTotal=0;h.onQuote(()=>{if(kind==='key')h.env.R05_ADMISSION_SERVER_KEY='changed-inert-key'.repeat(3);else h.context.userId=id(80);});await assert.rejects(h.prepareResearchBootstrap(h.context,h.businessId,h.policyId,h.workflowRunId));assert.equal(h.effects.length,1);}
});
test('R11 activation uses actual owner RPC only after exact saved hash and configured HMAC match',async()=>{
 const h=harness(),result=await h.activateResearchGrant(h.context,h.businessId,h.grant.id,h.row.grants[0].grantHash);assert.equal(result.policyId,h.policyId);assert.equal(h.calls.at(-1).name,'r11_research_bootstrap');assert.deepEqual(h.effects,[]);
 for(const change of [g=>g.serverKeyHash='a'.repeat(64),g=>g.runtimeCapabilityHash='a'.repeat(64),g=>g.workflowRunId=id(40)]){const x=harness();change(x.grant);x.row.grants[0].grantHash=Q.publicResearchHash(x.grant);await assert.rejects(x.activateResearchGrant(x.context,x.businessId,x.grant.id,x.row.grants[0].grantHash));assert.ok(x.calls.every(c=>c.name==='r11_research_workspace_v2'));}
});
test('R11 owner run uses only policy-bound server capability, records result, and repeated action is inert',async()=>{
 const h=harness(),cap=h.cap(),result=await h.runResearchProof(h.context,h.businessId,h.policyId);assert.equal(result.status,'completed');assert.equal(h.effects.filter(e=>e.kind==='run').length,1);assert.equal(h.effects.find(e=>e.kind==='run').scope.runtimeCapability,cap);
 const count=h.effects.length;delete h.env.R05_ADMISSION_SERVER_KEY;assert.equal((await h.runResearchProof(h.context,h.businessId,h.policyId)).status,'completed');assert.equal(h.effects.length,count);
 const view=await h.readResearchQualification(h.context,h.businessId);assert.equal(view.unavailable,false);assert.ok(view.policies[0].result);assert.equal(JSON.stringify(view).includes(cap),false);
});
test('R11 Stop works without execution keys, and stopped or uncertain slots never run',async()=>{
 const h=harness();delete h.env.R05_ADMISSION_SERVER_KEY;assert.equal((await h.stopResearchProof(h.context,h.businessId,h.policyId)).revoked,true);assert.deepEqual(h.effects,[]);assert.equal(h.calls.at(-1).name,'r11_research_stop_v2');
 for(const status of ['revoked','expired','search_recording_pending','selection_recording_pending']){const x=harness();x.savedPolicy.status=status;if(status==='revoked')x.savedPolicy.revoked=true;if(status==='expired')x.savedPolicy.expired=true;await assert.rejects(x.runResearchProof(x.context,x.businessId,x.policyId));assert.deepEqual(x.effects,[]);}
});
test('R11 read rejects forged or malformed persisted results rather than rendering success',async()=>{
 for(const mutate of [r=>r.evidencePackHash='a'.repeat(64),r=>r.evidencePack.claims[0].text='invented',r=>r.selectorRequestId=id(90),r=>r.providerRequestId='foreign',r=>r.evidencePack.sourceLineage.policyId=id(90)]){const h=harness();h.complete();mutate(h.savedPolicy.result);const view=await h.readResearchQualification(h.context,h.businessId);assert.equal(view.unavailable,true);assert.equal(view.policies.length,0);assert.deepEqual(h.effects,[]);}
});
test('R11 owner read fails closed for malformed exact money, totals, source scope or completion projection',async()=>{
 for(const mutate of [r=>r.exposure.heldMicrounits='0x0',r=>r.policyTotal=0,r=>r.policies[0].status='completed',r=>r.policies[0].policy.allowedDomains=['etsy.com'],r=>r.grants[0].grantHash='a'.repeat(64)]){const h=harness();mutate(h.row);assert.equal((await h.readResearchQualification(h.context,h.businessId)).unavailable,true);}
});

function makeContinuation(h){
 h.row.exposure.heldMicrounits='608131';h.savedPolicy.revoked=true;h.savedPolicy.expired=true;h.savedPolicy.status='revoked';
 const c={predecessorPolicyId:h.policyId,predecessorWorkflowRunId:h.workflowRunId,currentOperatingPolicyId:h.policy.operatingPolicyId,
  goalId:h.policy.goalId,goalRevision:2,businessRevision:1,capRevision:1,lifetimeCapMicrounits:'848063',exposureMicrounits:'608131',remainingMicrounits:'239932',eligible:true,reason:'ready'};
 h.row.continuation=c;return c;
}
test('R11 continuation Prepare binds exact predecessor, unchanged lifetime balance and a server-only per-attempt verifier',async()=>{
 const h=harness(),c=makeContinuation(h),policyId=id(30),workflowRunId=id(31);
 const prepared=await h.prepareResearchBootstrap(h.context,h.businessId,policyId,workflowRunId,h.policyId);
 const derived=crypto.createHmac('sha256',h.env.R05_ADMISSION_SERVER_KEY).update(Q.canonicalPublicResearchJson({version:'r11.attempt-admission.1',businessId:h.businessId,ownerId:h.ownerId,policyId,workflowRunId})).digest('base64url');
 assert.equal(prepared.version,'r11.owner-proof-preparation.3');assert.equal(prepared.mode,'continuation');assert.deepEqual(prepared.continuation,c);
 assert.equal(Date.parse(prepared.expiresAt)-Date.parse(prepared.preparedAt),1800000);
 assert.equal(Date.parse(prepared.quote.validUntil)-Date.parse(prepared.quote.verifiedAt),300000);
 assert.ok(Date.parse(prepared.expiresAt)>Date.parse(prepared.quote.validUntil));
 assert.equal(prepared.quote.maximumMicrousd,239932);assert.equal(prepared.quote.version,'r11.public-research-quote.2');assert.equal(prepared.serverKeyHash,sha(derived));
 assert.notEqual(prepared.serverKeyHash,sha(h.env.R05_ADMISSION_SERVER_KEY));assert.equal(JSON.stringify(prepared).includes(derived),false);
 assert.equal(prepared.authorityCreated,false);assert.equal(prepared.paidCalls,0);assert.deepEqual(h.effects.map(x=>x.kind),['quote']);
});
test('R11 continuation preparation rejects replacement roots, unknown cost and state drift without authority',async()=>{
 for(const change of [h=>h.row.continuation.remainingMicrounits='250000',h=>h.row.continuation.eligible=false,h=>h.row.exposure.hasUnknown=true]){
  const h=harness();makeContinuation(h);change(h);await assert.rejects(h.prepareResearchBootstrap(h.context,h.businessId,id(30),id(31),h.policyId));assert.deepEqual(h.effects,[]);
 }
 const h=harness();makeContinuation(h);h.onQuote(()=>h.row.continuation.capRevision++);await assert.rejects(h.prepareResearchBootstrap(h.context,h.businessId,id(30),id(31),h.policyId));assert.equal(h.effects.length,1);
 const prior=harness();await assert.rejects(prior.prepareResearchBootstrap(prior.context,prior.businessId,id(30),id(31)));assert.deepEqual(prior.effects,[]);
});
test('R11 continuation activation uses the exact derived verifier and dedicated owner transition',async()=>{
 const h=harness(),c=makeContinuation(h),policyId=id(30),workflowRunId=id(31),g=structuredClone(h.grant);
 Object.assign(g,{version:'r11.owner-continuation-grant.1',id:id(32),policyId,workflowRunId,continuation:c});
 const derive=version=>crypto.createHmac('sha256',h.env.R05_ADMISSION_SERVER_KEY).update(Q.canonicalPublicResearchJson({version,businessId:h.businessId,ownerId:h.ownerId,policyId,workflowRunId})).digest('base64url');
 g.serverKeyHash=sha(derive('r11.attempt-admission.1'));g.runtimeCapabilityHash=sha(derive('r11.owner-runtime.1'));
 const entry={grantId:g.id,grantHash:Q.publicResearchHash(g),grant:g,used:false,expired:false,revoked:false};h.row.continuationGrants=[entry];h.row.continuationGrantTotal=1;
 assert.equal((await h.activateResearchGrant(h.context,h.businessId,g.id,entry.grantHash)).policyId,policyId);assert.equal(h.calls.at(-1).name,'r11_research_continue');
 h.calls.length=0;g.serverKeyHash=sha(h.env.R05_ADMISSION_SERVER_KEY);entry.grantHash=Q.publicResearchHash(g);
 await assert.rejects(h.activateResearchGrant(h.context,h.businessId,g.id,entry.grantHash));assert.ok(h.calls.every(x=>x.name==='r11_research_workspace_v2'));
});
test('R11 explicit historical Stop reconciliation is key-free and requires a saved revocation',async()=>{
 const h=harness();delete h.env.R05_ADMISSION_SERVER_KEY;h.savedPolicy.revoked=true;h.savedPolicy.terminalReconciliationRequired=true;
 assert.equal((await h.reconcileResearchProof(h.context,h.businessId,h.policyId)).revoked,true);assert.equal(h.calls.at(-1).name,'r11_research_stop_v2');assert.deepEqual(h.effects,[]);
 const x=harness();x.savedPolicy.terminalReconciliationRequired=true;await assert.rejects(x.reconcileResearchProof(x.context,x.businessId,x.policyId));assert.ok(x.calls.every(c=>c.name==='r11_research_workspace_v2'));
});
test('R11 durable outcome reader exposes only bounded catalog identities and recorded stop/failure history',async()=>{
 const h=harness(),observation={modelIdentity:'canonical',observedModelId:'openai/gpt-5.6-luna-20260709',providerIdentity:'exact',observedProvider:'Azure',finishReason:'stop',searchRequests:1,annotationCount:1,
  approvedDomainCounts:[{domain:'spiegel.medill.northwestern.edu',count:1}],rejectedDomainCount:0,malformedAnnotationCount:0,providerError:null};
 h.savedPolicy.outcomes=[{outcomeId:id(60),kind:'failure',phase:'search',requestId:id(10),reason:'source_contract_invalid',observation,createdAt:new Date().toISOString()},
  {outcomeId:id(61),kind:'owner_stopped',phase:'none',requestId:null,reason:'owner_stopped',observation:null,createdAt:new Date().toISOString()}];
 const view=await h.readResearchQualification(h.context,h.businessId);assert.equal(view.unavailable,false);assert.equal(view.policies[0].outcomeEvents.length,2);assert.equal(view.policies[0].outcomeEvents[0].observation.observedModelId,observation.observedModelId);
 for(const state of ['needs_owner','cancelled','failed']){h.savedPolicy.status=state;assert.equal((await h.readResearchQualification(h.context,h.businessId)).unavailable,false);await assert.rejects(h.runResearchProof(h.context,h.businessId,h.policyId));}
 observation.rawResponse='PRIVATE RAW PROVIDER TEXT';const denied=await h.readResearchQualification(h.context,h.businessId);assert.equal(denied.unavailable,true);assert.equal(JSON.stringify(denied).includes('PRIVATE RAW'),false);
});
test('R11 continuation reads cannot expose extra metadata or claim eligibility over changed financial exposure',async()=>{
 for(const mutate of [c=>c.secret='NOT A REAL SECRET',c=>c.remainingMicrounits='250000']){const h=harness();const c=makeContinuation(h);mutate(c);assert.equal((await h.readResearchQualification(h.context,h.businessId)).unavailable,true);}
 const h=harness();makeContinuation(h);h.row.exposure.heldMicrounits='608132';assert.equal((await h.readResearchQualification(h.context,h.businessId)).unavailable,true);await assert.rejects(h.prepareResearchBootstrap(h.context,h.businessId,id(30),id(31),h.policyId));assert.deepEqual(h.effects,[]);
});

function savedGeneration(h,{generationId='gen-owner-receipt-1',requestId=id(70)}={}){
 const phase={phase:'search',requestId,marked:true,settled:true,actualMicrounits:'9378',providerRequestId:generationId};
 h.savedPolicy.phases=[phase];h.savedPolicy.revoked=true;h.savedPolicy.expired=true;h.savedPolicy.status='revoked';return phase;
}
test('R11 owner route verification reads only the saved settled generation, without R05 authority or mutations',async()=>{
 const h=harness(),phase=savedGeneration(h);delete h.env.R05_ADMISSION_SERVER_KEY;h.env.VERCEL_ENV='preview';
 const before=structuredClone(h.row),result=await h.verifySavedResearchInferenceRoute(h.context,h.businessId,h.policyId,phase.requestId);
 assert.equal(result.proof.generationId,phase.providerRequestId);assert.equal(result.proof.providerName,'Azure');assert.equal(result.proof.modelId,'openai/gpt-5.6-luna-20260709');assert.match(result.proof.proofHash,/^[a-f0-9]{64}$/);assert.equal(result.requestId,phase.requestId);
 assert.deepEqual(h.row,before);assert.deepEqual(h.effects.map(x=>x.kind),['generation-read']);assert.ok(h.calls.every(c=>c.name==='r11_research_workspace_v2'));assert.equal(h.calls.length,2);
 assert.deepEqual(h.effects[0].expectation,{generationId:'gen-owner-receipt-1',providerName:'Azure',acceptedResponseModelIds:['openai/gpt-5.6-luna','openai/gpt-5.6-luna-20260709'],requestedEndpoint:'azure/us'});
});
test('R11 owner route read rejects unknown, cross-Business, unmarked and unsettled receipt scopes before external I/O',async()=>{
 for(const change of [p=>p.marked=false,p=>p.settled=false,p=>p.providerRequestId=null,p=>p.providerRequestId='https://evil.test/receipt',p=>p.providerRequestId='unknown']){const h=harness(),phase=savedGeneration(h);change(phase);await assert.rejects(h.verifySavedResearchInferenceRoute(h.context,h.businessId,h.policyId,phase.requestId));assert.deepEqual(h.effects,[]);}
 for(const scope of [{businessId:id(90)},{policyId:id(90)},{requestId:id(90)},{requestId:'gen-client-supplied'}]){const h=harness(),phase=savedGeneration(h);await assert.rejects(h.verifySavedResearchInferenceRoute(h.context,scope.businessId??h.businessId,scope.policyId??h.policyId,scope.requestId??phase.requestId));assert.deepEqual(h.effects,[]);}
 const h=harness(),phase=savedGeneration(h);h.context.userId=id(90);await assert.rejects(h.verifySavedResearchInferenceRoute(h.context,h.businessId,h.policyId,phase.requestId));assert.deepEqual(h.effects,[]);
});
test('R11 generation route result is revalidated and owner/receipt drift cannot disclose a stale proof',async()=>{
 for(const kind of ['owner','receipt','proof']){const h=harness(),phase=savedGeneration(h);if(kind==='owner')h.onGeneration(()=>h.context.userId=id(90));if(kind==='receipt')h.onGeneration(()=>phase.providerRequestId='gen-changed-receipt');if(kind==='proof')h.mutateGeneration(proof=>({...proof,proofHash:'f'.repeat(64)}));await assert.rejects(h.verifySavedResearchInferenceRoute(h.context,h.businessId,h.policyId,phase.requestId));assert.deepEqual(h.effects.map(x=>x.kind),['generation-read']);assert.ok(h.calls.every(c=>c.name==='r11_research_workspace_v2'));}
});
test('R11 metadata read may inspect a settled receipt with unknown cost without calling it a verified charge',async()=>{
 const h=harness(),phase=savedGeneration(h);phase.actualMicrounits=null;h.row.exposure.hasUnknown=true;const result=await h.verifySavedResearchInferenceRoute(h.context,h.businessId,h.policyId,phase.requestId);assert.equal(result.proof.generationId,phase.providerRequestId);assert.equal(h.savedPolicy.phases[0].actualMicrounits,null);assert.equal(h.row.exposure.hasUnknown,true);assert.deepEqual(h.effects.map(x=>x.kind),['generation-read']);
});

test('R11 async injected route reader cannot mutate the independent expected receipt scope',async()=>{
 const h=harness(),phase=savedGeneration(h);h.onGeneration(expectation=>{expectation.generationId='gen-another-existing-call';});
 await assert.rejects(h.verifySavedResearchInferenceRoute(h.context,h.businessId,h.policyId,phase.requestId));assert.equal(phase.providerRequestId,'gen-owner-receipt-1');assert.equal(h.effects.length,1);assert.ok(h.calls.every(c=>c.name==='r11_research_workspace_v2'));
 for(const mutate of [e=>e.providerName='Other',e=>e.requestedEndpoint='azure/eu',e=>e.acceptedResponseModelIds.splice(0,2,'other/model','other/model-canonical')]){const x=harness(),p=savedGeneration(x);x.onGeneration(mutate);await assert.rejects(x.verifySavedResearchInferenceRoute(x.context,x.businessId,x.policyId,p.requestId));assert.equal(x.effects.length,1);}
});


test('R11 read-only failure diagnostics still recheck current owner and exact receipt after metadata I/O',async()=>{
 const error=new generationRoute.GenerationRouteProofError('api_failure',404,3);
 const h=harness();h.complete();h.onGeneration(()=>{throw error;});
 await assert.rejects(h.verifySavedResearchInferenceRoute(h.context,h.businessId,h.policyId,id(10)),value=>value===error);
 assert.equal(h.calls.filter(x=>x.name==='r11_research_workspace_v2').length,2);
 const changed=harness();changed.complete();changed.onGeneration(()=>{changed.context.userId=id(99);throw error;});
 await assert.rejects(changed.verifySavedResearchInferenceRoute(changed.context,changed.businessId,changed.policyId,id(10)),value=>{assert.notEqual(value,error);assert.doesNotMatch(value.message,/api_failure|404/);return true;});
 assert.equal(changed.effects.filter(x=>x.kind==='generation-read').length,1);
});

function stagedReceipt(h,{phase='search',status='awaiting_receipt',due=true,attempts=1}={}){
 const requestId=id(phase==='search'?10:11);
 h.savedPolicy.status=phase==='search'?'search_recording_pending':'selection_recording_pending';
 h.savedPolicy.phases=[{phase,requestId,marked:true,settled:true,actualMicrounits:'7000',providerRequestId:`gen-inert-${phase}-receipt`}];
 const check={phase,requestId,candidateHash:'a'.repeat(64),status,attempts,nextCheckAt:new Date(Date.now()+(due?-1000:120000)).toISOString(),receiptExpiresAt:new Date(Date.parse(h.policy.validUntil)+1800000).toISOString(),diagnostic:{code:'api_failure',httpStatus:404},proofHash:null};
 if(status==='verified'){check.diagnostic=null;check.proofHash='b'.repeat(64);check.nextCheckAt=null;}
 h.savedPolicy.receiptChecks=[check];return check;
}
test('R11 owner acknowledges only durably staged pending output and explicit Continue cannot repeat Run',async()=>{
 const h=harness();h.onRun(()=>{stagedReceipt(h);return false;});
 assert.equal((await h.runResearchProof(h.context,h.businessId,h.policyId)).status,'receipt_pending');
 const count=h.effects.length;await assert.rejects(h.runResearchProof(h.context,h.businessId,h.policyId));assert.equal(h.effects.length,count);
 assert.equal((await h.continueResearchProof(h.context,h.businessId,h.policyId)).status,'receipt_pending');
 const view=await h.readResearchQualification(h.context,h.businessId);assert.equal(view.policies[0].receiptChecks[0].attempts,1);assert.equal(view.policies[0].result,null);
});
test('R11 Continue requires exact saved phase, due cooldown, current owner and usable receipt grace',async()=>{
 for(const mode of ['missing','cooldown','terminal','exhausted','expired','stopped','revoked','unknown','foreign','missing-key']){
  const h=harness(),check=stagedReceipt(h);
  if(mode==='missing')delete h.savedPolicy.receiptChecks;
  if(mode==='cooldown')check.nextCheckAt=new Date(Date.now()+120000).toISOString();
  if(['terminal','exhausted','expired','stopped'].includes(mode))check.status=mode;
  if(mode==='exhausted')check.attempts=3;
  if(mode==='revoked')h.savedPolicy.revoked=true;
  if(mode==='unknown')h.row.exposure.hasUnknown=true;
  if(mode==='foreign')h.context.userId=id(80);
  if(mode==='missing-key')delete h.env.R05_ADMISSION_SERVER_KEY;
  await assert.rejects(h.continueResearchProof(h.context,h.businessId,h.policyId),mode);assert.deepEqual(h.effects,[],mode);
 }
});
test('R11 owner receipt projection rejects private payloads and cross-phase identity without disclosing them',async()=>{
 for(const mutate of [c=>c.candidate={content:'PRIVATE STAGED OUTPUT'},c=>c.requestId=id(99),c=>c.attempts=4,c=>c.nextCheckAt='bad',c=>c.receiptExpiresAt=new Date(Date.parse(c.receiptExpiresAt)+1).toISOString(),c=>c.diagnostic={code:'raw-provider-text',httpStatus:404},c=>c.proofHash='bad']){
  const h=harness(),check=stagedReceipt(h);mutate(check);const view=await h.readResearchQualification(h.context,h.businessId);assert.equal(view.unavailable,true);assert.equal(JSON.stringify(view).includes('PRIVATE STAGED'),false);assert.deepEqual(h.effects,[]);
 }
});
test('R11 verified staged response can finish through explicit Continue and completed replay is inert',async()=>{
 const h=harness();stagedReceipt(h,{status:'verified'});
 assert.equal((await h.continueResearchProof(h.context,h.businessId,h.policyId)).status,'completed');
 const count=h.effects.length;delete h.env.R05_ADMISSION_SERVER_KEY;assert.equal((await h.continueResearchProof(h.context,h.businessId,h.policyId)).status,'completed');assert.equal(h.effects.length,count);
});

test('independent historical diagnostic reads cannot bypass durable claim budgets or an active staging window',async()=>{
 for(const status of ['awaiting_receipt','checking_receipt','verified','terminal','exhausted','expired','stopped']){
  const h=harness(),check=stagedReceipt(h,{status,attempts:status==='exhausted'?3:1});h.savedPolicy.revoked=true;h.savedPolicy.expired=true;
  for(let i=0;i<7;i++)await assert.rejects(h.verifySavedResearchInferenceRoute(h.context,h.businessId,h.policyId,check.requestId));
  assert.deepEqual(h.effects,[],status);assert.equal(check.attempts,status==='exhausted'?3:1);
 }
 for(const expired of [false,true]){
  const h=harness(),phase=savedGeneration(h);h.savedPolicy.revoked=false;h.savedPolicy.expired=expired;h.savedPolicy.status=expired?'expired':'search_recording_pending';
  await assert.rejects(h.verifySavedResearchInferenceRoute(h.context,h.businessId,h.policyId,phase.requestId));assert.deepEqual(h.effects,[]);
 }
 const h=harness(),check=stagedReceipt(h);h.savedPolicy.revoked=true;h.savedPolicy.phases.push({phase:'select',requestId:id(11),marked:true,settled:true,actualMicrounits:'1000',providerRequestId:'gen-select-not-staged-yet'});
 await assert.rejects(h.verifySavedResearchInferenceRoute(h.context,h.businessId,h.policyId,id(11)));assert.deepEqual(h.effects,[]);assert.equal(check.attempts,1);
});
