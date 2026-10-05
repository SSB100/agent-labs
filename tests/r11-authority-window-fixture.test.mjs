import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {id} from './next-fixture/data.mjs';
import {assertResearchPreparationWindow,researchPreparedMetadata} from './next-fixture/r11-http.mjs';
import {seedResearchFixture,installResearchContinuationFixture,researchOwnerFixture,researchRuntimeFixture,
 r11Scope,r11ContinuationScope,r11Search,R11_INERT_SERVER_KEY} from './next-fixture/r11-research.mjs';

const preparedAt='2026-10-05T11:00:00.000Z';
const preparation=mode=>({version:mode==='continuation'?'r11.owner-proof-preparation.3':'r11.owner-proof-preparation.2',mode,preparedAt,
 expiresAt:mode==='continuation'?'2026-10-05T11:30:00.000Z':'2026-10-05T11:04:59.000Z',
 quote:{version:'r11.public-research-quote.2',verifiedAt:'2026-10-05T10:59:59.000Z',validUntil:'2026-10-05T11:04:59.000Z',quoteValidUntil:'2026-10-05T11:04:59.000Z'}});
const render=value=>`<details id="research-setup-metadata"><summary>Prepared technical details</summary><pre>${JSON.stringify(value).replaceAll('"','&quot;')}</pre></details>`;

test('Next prepared metadata preserves initial .2 and independently validates continuation .3 thirty-minute authority',()=>{
 for(const mode of ['initial','continuation']){
  const value=preparation(mode);assertResearchPreparationWindow(value,mode);assert.deepEqual(researchPreparedMetadata(render(value),mode),value);
 }
 assert.throws(()=>researchPreparedMetadata(render(preparation('continuation'))),'Continuation must be selected explicitly');
 assert.throws(()=>researchPreparedMetadata(`<script>${render(preparation('initial'))}</script>${render(preparation('initial'))}`),'Duplicate metadata panels cannot be silently selected');
});

test('Next preparation checks reject broadened quote freshness, changed versions and caller-selected authority deadlines',()=>{
 for(const mode of ['initial','continuation'])for(const edit of [
  value=>{value.quote.validUntil=value.expiresAt;value.quote.quoteValidUntil=value.expiresAt;value.quote.verifiedAt=preparedAt;},
  value=>{value.quote.quoteValidUntil='2026-10-05T11:30:00.000Z';},
  value=>{value.quote.verifiedAt='invalid';},
  value=>{value.preparedAt='2026-10-05T11:05:00.000Z';},
  value=>{value.expiresAt='2026-10-05T11:30:00.001Z';},
  value=>{value.version=mode==='continuation'?'r11.owner-proof-preparation.2':'r11.owner-proof-preparation.3';},
  value=>{value.quote.version='r11.public-research-quote.3';},
 ]){
  const value=preparation(mode);edit(value);assert.throws(()=>assertResearchPreparationWindow(value,mode));
 }
});

const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const signed=value=>createHmac('sha256',R11_INERT_SERVER_KEY).update(canonical(value)).digest('base64url');
function continuationFixture(){
 const state={owner:id(911099),businesses:[{id:r11Scope.businessId}]},effects=[];
 state.r11Research=seedResearchFixture(state,{r11Historical:true});
 const stopped=researchOwnerFixture(state,'r11_research_stop_v2',{p_business_id:r11Scope.businessId,p_policy_id:r11Scope.policyId},effects,{});assert.equal(stopped.error,null);
 installResearchContinuationFixture(state);
 const entry=state.r11Research.continuationGrants[0];
 const activated=researchOwnerFixture(state,'r11_research_continue',{p_business_id:r11Scope.businessId,p_grant_id:entry.grantId,p_grant_hash:entry.grantHash},effects,{});assert.equal(activated.error,null);
 const scope={businessId:r11Scope.businessId,ownerId:state.owner,policyId:r11ContinuationScope.policyId,workflowRunId:r11ContinuationScope.workflowRunId};
 const authority=signed({version:'r11.attempt-admission.1',...scope}),runtimeCapability=signed({version:'r11.owner-runtime.1',...scope});
 const proof=state.r11Research.policies[1],payload={policyId:scope.policyId,phase:'search',collectionId:null,admission:{
  workflowRunId:scope.workflowRunId,runtimeCapability,operationKey:proof.operationKeys.search,requestHash:r11Search.requestHash,
  wireRequestHash:r11Search.wireHash,wireRequestBytes:r11Search.wireBytes,maximumOutputTokens:r11Search.maxTokens,
  idempotencyKey:`r11:${scope.policyId}:search`,accounting:{kind:'r05'},sourceDomains:[...proof.policy.allowedDomains]}};
 return{state,effects,proof,payload,guard:payload=>researchRuntimeFixture(state,'r11_research_server_v2',{
  p_business_id:scope.businessId,p_operation:'guard',p_server_key:authority,p_payload:payload},effects,{})};
}

test('Next continuation fixture installs fixed thirty-minute .2 scope without changing prior charges or initial .1 history',()=>{
 const f=continuationFixture(),p=f.proof.policy,prior=f.state.r11Research.policies[0];
 assert.equal(p.version,'r11.public-research.2');assert.equal(Date.parse(p.validUntil)-Date.parse(p.validFrom),30*60_000);assert.equal(p.quoteValidUntil,p.validUntil);
 assert.equal(prior.policy.version,'r11.public-research.1');assert.equal(Date.parse(prior.policy.validUntil)-Date.parse(prior.policy.validFrom),5*60_000);
 assert.equal(p.goalId,prior.goalId);assert.equal(p.maximumMicrousd,239932);assert.equal(f.state.r11Research.lifetimeCapMicrounits,'848063');
 assert.equal(f.state.r11Research.settlements[0].actualMicrounits,'10068');assert.equal(f.state.r11Research.providerCalls.length,1);
});

test('Next marker fixture rejects missing, stale and authority-length quotes while preserving the five-minute phase limit',()=>{
 const f=continuationFixture(),before=structuredClone(f.state.r11Research),effects=f.effects.length;
 for(const quoteValidUntil of [undefined,null,'invalid',new Date(Date.now()-1).toISOString(),new Date(Date.now()+5*60_000+1000).toISOString(),f.proof.policy.quoteValidUntil]){
  const payload={...f.payload,...(quoteValidUntil===undefined?{}:{quoteValidUntil})};
  assert.ok(f.guard(payload).error);assert.deepEqual(f.state.r11Research,before);assert.equal(f.effects.length,effects);
 }
 const quoteValidUntil=new Date(Date.now()+5*60_000).toISOString();
 assert.equal(f.guard({...f.payload,quoteValidUntil}).data.shouldDispatch,true);
 const marker=f.state.r11Research.markers.at(-1);assert.equal(marker.policyId,r11ContinuationScope.policyId);assert.equal(marker.quoteValidUntil,quoteValidUntil);
 assert.ok(Date.parse(marker.quoteValidUntil)>Date.parse(marker.markedAt));assert.ok(Date.parse(marker.quoteValidUntil)-Date.parse(marker.markedAt)<=5*60_000);
 assert.equal(f.guard({...f.payload,quoteValidUntil}).data.shouldDispatch,false);assert.equal(f.state.r11Research.markers.length,before.markers.length+1);
 assert.deepEqual(f.state.r11Research.providerCalls,before.providerCalls);assert.deepEqual(f.state.r11Research.settlements,before.settlements);
});
