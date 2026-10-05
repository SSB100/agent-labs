import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript'),crypto=require('node:crypto');
const Q=require('../.core-tests/research/qualification.js'),QR=require('../.core-tests/research/qualification-quote.js'),R=require('../.core-tests/research/qualification-runtime.js');
const registry=require('../.core-tests/models/registry.js'),sources=require('../.core-tests/research/sources.js'),profile=require('../.core-tests/research/qualification-profile.js');
const id=n=>`11000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function freshQuote(){
 const now=Date.now(),l=QR.PUBLIC_RESEARCH_QUOTE_LIMITS,e={name:'Azure | openai/gpt-5.6-luna-20260709',model_id:l.modelId,provider_name:'Azure',tag:'azure/us',status:0,context_length:1050000,max_completion_tokens:128000,
  supported_parameters:['reasoning','max_completion_tokens','tools','tool_choice','response_format','structured_outputs'],pricing:{prompt:'0.00000022',completion:'0.00000132',input_cache_read:'0.000000022',input_cache_write:'0.000000275',overrides:[{min_prompt_tokens:272000,prompt:'0.00000044',completion:'0.00000198',input_cache_write:'0.00000055'}]}};
 return QR.qualifyPublicResearchQuote({now,modelCatalog:{url:l.modelCatalogUrl,fetchedAt:new Date(now).toISOString(),payload:{data:{id:l.modelId,endpoints:[e]}}},zdrCatalog:{url:l.zdrCatalogUrl,fetchedAt:new Date(now).toISOString(),payload:{data:[e]}}});
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
 let readError=false,quoteHook=()=>{},runHook=()=>{};
 const context={userId:ownerId,businesses:[{id:businessId}],supabase:{auth:{getClaims:async()=>({data:{claims:{sub:context.userId,session_id:id(8)}}})},rpc:async(name,args)=>{
  calls.push({name,args:structuredClone(args)});if(name==='r11_research_workspace')return readError?{error:{message:'PRIVATE ERROR'}}:{data:structuredClone(row)};
  if(name==='r11_research_bootstrap')return{data:{policyId,workflowRunId,replayed:false}};
  if(name==='r11_research_revoke'){savedPolicy.revoked=true;savedPolicy.status='revoked';return{data:{policyId,revoked:true}};}
  throw Error('unexpected RPC');
 }}};
 function complete(){
  const response={provider:'openrouter.exa',providerModelId:policy.modelId,providerRequestId:'inert-search-receipt',metadata:{searchRequests:1},output:{annotations:[{type:'url_citation',url_citation:{url:'https://spiegel.medill.northwestern.edu/mothersday2026/',title:'Public gifting analysis',content:'The adult-consumer survey considered uniqueness, creating special memories, convenience, and cost when choosing gifts for this occasion.'}}]}};
  const {collection,lineage}=Q.collectQualifiedPublicSources(policy,response,id(10)),evidencePack=Q.qualifiedPublicEvidence(policy,collection,lineage,{selections:[{sourceKey:'S1',quote:collection.sources[0].excerpt}],limitations:['limited_sources']});
  savedPolicy.phases=[{phase:'search',requestId:id(10),marked:true,settled:true,actualMicrounits:'7000',providerRequestId:'inert-search-receipt'},{phase:'select',requestId:id(11),marked:true,settled:true,actualMicrounits:'1000',providerRequestId:'inert-selector-receipt'}];
  savedPolicy.result={resultId:id(12),evidencePack,evidencePackHash:Q.publicResearchHash(evidencePack),collectionId:id(13),selectorRequestId:id(11),providerRequestId:'inert-selector-receipt',createdAt:new Date().toISOString()};savedPolicy.status='completed';
 }
 const deps={'server-only':{},'node:crypto':crypto,'../lib/core-ui/owner-business':{verifyOwnerBusiness:async(c,b)=>c.userId===ownerId&&b===businessId},'../models/registry':registry,'./sources':sources,'./qualification':Q,'./qualification-quote':QR,'./qualification-profile':profile,
  './qualification-runtime':{...R,runPublicResearchQualification:async(scope,selected,runtime)=>{effects.push({kind:'run',scope:structuredClone(scope),selected});await runtime.verifyQuote(policy);runHook();complete();}},
  './qualification-server-dependencies':{researchQualificationDependencies:()=>({fetchQuote:async()=>{effects.push({kind:'quote'});quoteHook();return structuredClone(q);},makeRuntime:(scope,verifyQuote)=>({scope,verifyQuote})})}};
 const source=ts.transpileModule(readFileSync('src/research/qualification-server.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,m={exports:{}};
 runInNewContext(`(function(require,module,exports){${source}\n})`,{process:{env},Buffer,Date,URL,BigInt,structuredClone})(n=>{assert.ok(n in deps,n);return deps[n];},m,m.exports);
 return{...m.exports,context,row,policy,grant,savedPolicy,businessId,ownerId,policyId,workflowRunId,calls,effects,env,cap,complete,setReadError:v=>readError=v,onQuote:fn=>quoteHook=fn,onRun:fn=>runHook=fn};
}

test('R11 owner read is quote-free, key-free and removes execution verifier metadata',async()=>{
 const h=harness();delete h.env.R05_ADMISSION_SERVER_KEY;
 const view=await h.readResearchQualification(h.context,h.businessId);assert.equal(view.unavailable,false);assert.equal(view.configured,false);assert.equal(view.exposure.heldMicrounits,'598063');assert.deepEqual(h.effects,[]);
 assert.deepEqual(h.calls.map(x=>x.name),['r11_research_workspace']);assert.equal('serverKeyHash' in view.grants[0].grant,false);assert.equal('runtimeCapabilityHash' in view.grants[0].grant,false);
});
test('R11 explicit Prepare returns exact HMAC verifier metadata and fresh quote without creating authority or paid calls',async()=>{
 const h=harness(),prepared=await h.prepareResearchBootstrap(h.context,h.businessId,h.policyId,h.workflowRunId);
 assert.equal(prepared.runtimeCapabilityHash,sha(h.cap()));assert.equal(prepared.serverKeyHash,sha(h.env.R05_ADMISSION_SERVER_KEY));assert.equal(prepared.authorityCreated,false);assert.equal(prepared.paidCalls,0);
 assert.equal(prepared.quote.totalMicrousd,175871);assert.equal(prepared.search.maxTokens,4000);assert.equal(prepared.sourceProfile.query,profile.PUBLIC_RESEARCH_PROOF_PROFILE.query);
 assert.equal(JSON.stringify(prepared).includes(h.cap()),false);assert.equal(JSON.stringify(prepared).includes(h.env.R05_ADMISSION_SERVER_KEY),false);assert.deepEqual(h.effects.map(e=>e.kind),['quote']);assert.ok(h.calls.every(c=>c.name==='r11_research_workspace'));
});
for(const mode of ['preview','missing-key','missing-model-key','foreign-owner','foreign-business','expired-session','unavailable'])test('R11 invalid owner/configuration cannot prepare or activate paid proof',async()=>{
 const h=harness();let business=h.businessId;if(mode==='preview')h.env.VERCEL_ENV='preview';if(mode==='missing-key')delete h.env.R05_ADMISSION_SERVER_KEY;if(mode==='missing-model-key')delete h.env.OPENROUTER_API_KEY;if(mode==='foreign-owner')h.context.userId=id(80);if(mode==='foreign-business')business=id(80);if(mode==='expired-session')h.context.supabase.auth.getClaims=async()=>({data:{claims:{sub:h.ownerId}}});if(mode==='unavailable')h.setReadError(true);
 await assert.rejects(h.prepareResearchBootstrap(h.context,business,h.policyId,h.workflowRunId));await assert.rejects(h.activateResearchGrant(h.context,business,h.grant.id,h.row.grants[0].grantHash));assert.deepEqual(h.effects,[]);assert.ok(h.calls.every(c=>c.name==='r11_research_workspace'));
});
test('R11 configuration/owner drift while public quote is fetched cannot mint stale setup metadata',async()=>{
 for(const kind of ['key','owner']){const h=harness();h.onQuote(()=>{if(kind==='key')h.env.R05_ADMISSION_SERVER_KEY='changed-inert-key'.repeat(3);else h.context.userId=id(80);});await assert.rejects(h.prepareResearchBootstrap(h.context,h.businessId,h.policyId,h.workflowRunId));assert.equal(h.effects.length,1);}
});
test('R11 activation uses actual owner RPC only after exact saved hash and configured HMAC match',async()=>{
 const h=harness(),result=await h.activateResearchGrant(h.context,h.businessId,h.grant.id,h.row.grants[0].grantHash);assert.equal(result.policyId,h.policyId);assert.equal(h.calls.at(-1).name,'r11_research_bootstrap');assert.deepEqual(h.effects,[]);
 for(const change of [g=>g.serverKeyHash='a'.repeat(64),g=>g.runtimeCapabilityHash='a'.repeat(64),g=>g.workflowRunId=id(40)]){const x=harness();change(x.grant);x.row.grants[0].grantHash=Q.publicResearchHash(x.grant);await assert.rejects(x.activateResearchGrant(x.context,x.businessId,x.grant.id,x.row.grants[0].grantHash));assert.ok(x.calls.every(c=>c.name==='r11_research_workspace'));}
});
test('R11 owner run uses only policy-bound server capability, records result, and repeated action is inert',async()=>{
 const h=harness(),cap=h.cap(),result=await h.runResearchProof(h.context,h.businessId,h.policyId);assert.equal(result.status,'completed');assert.equal(h.effects.filter(e=>e.kind==='run').length,1);assert.equal(h.effects.find(e=>e.kind==='run').scope.runtimeCapability,cap);
 const count=h.effects.length;delete h.env.R05_ADMISSION_SERVER_KEY;assert.equal((await h.runResearchProof(h.context,h.businessId,h.policyId)).status,'completed');assert.equal(h.effects.length,count);
 const view=await h.readResearchQualification(h.context,h.businessId);assert.equal(view.unavailable,false);assert.ok(view.policies[0].result);assert.equal(JSON.stringify(view).includes(cap),false);
});
test('R11 Stop works without execution keys, and stopped or uncertain slots never run',async()=>{
 const h=harness();delete h.env.R05_ADMISSION_SERVER_KEY;assert.equal((await h.stopResearchProof(h.context,h.businessId,h.policyId)).revoked,true);assert.deepEqual(h.effects,[]);assert.equal(h.calls.at(-1).name,'r11_research_revoke');
 for(const status of ['revoked','expired','search_recording_pending','selection_recording_pending']){const x=harness();x.savedPolicy.status=status;if(status==='revoked')x.savedPolicy.revoked=true;if(status==='expired')x.savedPolicy.expired=true;await assert.rejects(x.runResearchProof(x.context,x.businessId,x.policyId));assert.deepEqual(x.effects,[]);}
});
test('R11 read rejects forged or malformed persisted results rather than rendering success',async()=>{
 for(const mutate of [r=>r.evidencePackHash='a'.repeat(64),r=>r.evidencePack.claims[0].text='invented',r=>r.selectorRequestId=id(90),r=>r.providerRequestId='foreign',r=>r.evidencePack.sourceLineage.policyId=id(90)]){const h=harness();h.complete();mutate(h.savedPolicy.result);const view=await h.readResearchQualification(h.context,h.businessId);assert.equal(view.unavailable,true);assert.equal(view.policies.length,0);assert.deepEqual(h.effects,[]);}
});
test('R11 owner read fails closed for malformed exact money, totals, source scope or completion projection',async()=>{
 for(const mutate of [r=>r.exposure.heldMicrounits='0x0',r=>r.policyTotal=0,r=>r.policies[0].status='completed',r=>r.policies[0].policy.allowedDomains=['etsy.com'],r=>r.grants[0].grantHash='a'.repeat(64)]){const h=harness();mutate(h.row);assert.equal((await h.readResearchQualification(h.context,h.businessId)).unavailable,true);}
});
