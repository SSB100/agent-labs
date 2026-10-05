import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const q=require('../.core-tests/research/qualification.js');
const {resolveModelRoute}=require('../.core-tests/models/registry.js');
const id=n=>`11000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const model=()=>structuredClone(resolveModelRoute('standard.default').primary);
function fixture(){
 const now=Date.now(),query='What public reports describe adult gardening gift formats and practical product preferences?';
 const policy={version:'r11.public-research.1',id:id(1),businessId:id(2),ownerId:id(3),workflowRunId:id(4),goalId:id(5),operatingPolicyId:id(6),query,
  allowedDomains:['gardening.example','retail.example'],excludedDomains:[...q.R11_RESTRICTED_SOURCE_DOMAINS,'restricted.example'],
  sourceReviews:['gardening.example','retail.example'].map(domain=>({domain,basis:'documented_api_factual_snippets',reviewHash:'1'.repeat(64)})),
  queryReviewHash:q.publicResearchHash({query,classification:'generic_nonpersonal_public_research'}),termsReviewHash:'2'.repeat(64),independentReviewHash:'3'.repeat(64),approvalHash:'4'.repeat(64),
  modelId:model().providerModelId,providerEndpoint:'azure/us',recipients:{router:'openrouter.ai',search:'exa.ai',inferenceEndpoint:'azure/us'},
  retention:{inference:'no_training_zdr',search:'query_retention_improvement_training_possible',application:'bounded_attributed_audit_evidence'},
  validFrom:new Date(now-60000).toISOString(),validUntil:new Date(now+240000).toISOString(),maximumMicrousd:250000,searchMicrousd:180000,selectorMicrousd:20000,
  priceLimit:{prompt:0.44,completion:1.98,request:0},quoteHash:'5'.repeat(64),quoteValidUntil:new Date(now+240000).toISOString()};
 const response={provider:'openrouter.exa',providerModelId:policy.modelId,providerRequestId:'inert-provider-request',output:{annotations:[{type:'url_citation',url_citation:{url:'https://gardening.example/report',title:'Independent gardening report',content:'Adult gardeners often value practical tools and containers suited to the available growing space. This observation does not establish sales or profitability.'}}]},metadata:{searchRequests:1,actualUpstreamProvider:'Azure'},latencyMs:1,usage:{reportedCostUsd:0.001}};
 return{policy,now,response};
}
test('R11 useful public snippet policy supports task-selected topics without an open-license assertion',()=>{
 const {policy,now}=fixture();q.validatePublicResearchPolicy(policy,now);
 for(const query of ['What public reports describe adult cycling accessory formats and commuting preferences?','What practical storage product problems do adult renters discuss in public trade reports?']){
  policy.query=query;policy.queryReviewHash=q.publicResearchHash({query,classification:'generic_nonpersonal_public_research'});q.validatePublicResearchPolicy(policy,now);
 }
 assert.equal(JSON.stringify(policy).includes('CC0'),false);
});
test('R11 source and inference controls are included before model dispatch',()=>{
 const {policy,now}=fixture(),request=q.publicResearchSearchRequest(policy,model(),now);
 assert.deepEqual(request.allowedDomains,policy.allowedDomains);assert.deepEqual(request.excludedDomains,policy.excludedDomains);
 assert.deepEqual(request.providerOnly,['azure/us']);assert.equal(request.providerDataCollection,'deny');assert.equal(request.providerZdr,true);
 assert.equal(request.query,policy.query);assert.equal('businessId' in request,false);assert.equal('messages' in request,false);
 policy.query='Changed after build';policy.allowedDomains.push('etsy.com');policy.priceLimit.prompt=0;
 assert.equal(request.allowedDomains.length,2);assert.equal(request.providerPriceLimit.prompt,0.44);assert.notEqual(request.query,policy.query);
});
for(const mutation of [
 p=>p.excludedDomains.splice(p.excludedDomains.indexOf('etsy.com'),1),
 p=>p.allowedDomains[0]='etsy.com',p=>p.allowedDomains[0]='www.etsy.com',p=>p.allowedDomains[0]='api.etsy.com',
 p=>p.allowedDomains[0]='restricted.example',p=>p.allowedDomains[0]='sub.restricted.example',p=>p.allowedDomains[0]='com',
 p=>p.sourceReviews[0].basis='owner_asserted',p=>p.sourceReviews[0].domain='unreviewed.example',p=>p.sourceReviews.pop(),
 p=>p.query='Private shop strategy appended without a matching reviewed query',p=>p.recipients.search='other.example',
 p=>p.recipients.inferenceEndpoint='openai',p=>p.retention.search='zero_retention_guaranteed',p=>p.retention.inference='default',
 p=>p.extraBusinessContext='Private business context',p=>p.priceLimit.extra=1,p=>p.maximumMicrousd=250001,
 p=>p.selectorMicrousd=80000,p=>p.searchMicrousd=-1,p=>p.priceLimit.prompt=NaN,p=>p.priceLimit.request=1,
 p=>p.validUntil=p.validFrom,p=>p.quoteValidUntil=p.validFrom,p=>p.providerEndpoint='azure/us?key=bad',p=>p.ownerId='not-a-uuid',
])test('R11 altered/unreviewed policy fails closed',()=>{const {policy,now}=fixture();mutation(policy);assert.throws(()=>q.validatePublicResearchPolicy(policy,now));});
test('R11 immutable source lineage retains exact query, citation hashes and policy version',()=>{
 const {policy,now,response}=fixture(),{collection,lineage}=q.collectQualifiedPublicSources(policy,response,id(10),now);
 q.validatePublicResearchLineage(policy,collection,lineage,now);assert.equal(lineage.collectionHash,q.publicResearchHash(collection));
 assert.deepEqual(lineage.sourceDomains,policy.allowedDomains);assert.equal(collection.providerMetadata.policyHash,q.publicResearchHash(policy));
 const request=q.publicResearchSelectorRequest(policy,model(),collection,lineage,now);
 assert.deepEqual(Object.keys(JSON.parse(request.messages[1].content)).sort(),['question','sources']);assert.deepEqual(request.requestMetadata,{});
 for(const secret of [policy.businessId,policy.ownerId,policy.workflowRunId,policy.operatingPolicyId,policy.id])assert.equal(JSON.stringify(request.messages).includes(secret),false);
 const output=q.qualifiedPublicEvidence(policy,collection,lineage,{selections:[{sourceKey:'S1',quote:'Adult gardeners often value practical tools and containers suited to the available growing space.'}],limitations:['limited_sources']},now);
 assert.equal(output.sourceLineage.collectionHash,lineage.collectionHash);assert.ok(output.limitations.includes('no_sales_metrics'));assert.ok(output.limitations.includes('not_profitability_proof'));
});
for(const url of ['https://etsy.com/listing/1','https://www.etsy.com/listing/1','https://api.etsy.com/listing/1','https://evil.example/report','http://gardening.example/report','https://user:pass@gardening.example/report','https://gardening.example:444/report','https://gardening.example/report?token=private','not-a-url'])test(`R11 malformed/restricted origin ${url} is not silently discarded`,()=>{
 const {policy,now,response}=fixture();response.output.annotations.push({type:'url_citation',url_citation:{url,content:'A prohibited source must invalidate the collection, even alongside a permitted result.'}});
 assert.throws(()=>q.collectQualifiedPublicSources(policy,response,id(10),now));
});
test('R11 tampered derivative, foreign owner/policy, stale evidence and forged request identity cannot inherit lineage',()=>{
 const {policy,now,response}=fixture(),{collection,lineage}=q.collectQualifiedPublicSources(policy,response,id(10),now);
 for(const mutation of [c=>c.sources[0].excerpt+=' Extra copied text',c=>c.query+=' changed',c=>c.providerMetadata.searchRequestId=id(40),c=>c.providerMetadata.policyId=id(40)]){
  const changed=structuredClone(collection);mutation(changed);assert.throws(()=>q.validatePublicResearchLineage(policy,changed,lineage,now));
 }
 for(const mutation of [p=>p.ownerId=id(50),p=>p.workflowRunId=id(50),p=>p.operatingPolicyId=id(50),p=>p.id=id(50)]){
  const changed=structuredClone(policy);mutation(changed);assert.throws(()=>q.validatePublicResearchLineage(changed,collection,lineage,now));
 }
 assert.throws(()=>q.validatePublicResearchLineage(policy,collection,{...lineage,searchRequestId:id(50)},now));
 assert.throws(()=>q.validatePublicResearchLineage(policy,collection,{...lineage,sourceDomains:[]},now));
 assert.throws(()=>q.validatePublicResearchLineage(policy,collection,lineage,now+86400001));
});
test('R11 deterministic hashes ignore object order but retain every content/array difference',()=>{
 assert.equal(q.publicResearchHash({b:1,a:[2,3]}),q.publicResearchHash({a:[2,3],b:1}));assert.notEqual(q.publicResearchHash({a:[2,3]}),q.publicResearchHash({a:[3,2]}));
 assert.throws(()=>q.publicResearchHash({bad:undefined}));assert.throws(()=>q.publicResearchHash(Infinity));
});

test('R11 pure source model gate accepts an exact canonical identity only with a trusted verified mapping',()=>{
 const {policy,now,response}=fixture();response.providerModelId='openai/gpt-5.6-luna-20260709';
 assert.throws(()=>q.collectQualifiedPublicSources(policy,response,id(10),now));
 const accepted=[policy.modelId,'openai/gpt-5.6-luna-20260709'];
 assert.equal(q.collectQualifiedPublicSources(policy,response,id(10),now,accepted).collection.sources.length,1);
 for(const model of ['openai/gpt-5.6-luna-20260710','openai/gpt-5.6-luna-20260709-extra','unknown/model']){
  response.providerModelId=model;assert.throws(()=>q.collectQualifiedPublicSources(policy,response,id(10),now,accepted));
 }
 response.providerModelId=accepted[1];response.metadata.actualUpstreamProvider='Azure EU';
 assert.throws(()=>q.collectQualifiedPublicSources(policy,response,id(10),now,accepted));
});
