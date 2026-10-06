import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareAmendedDiscoveryScope} from '../.core-tests/products/discovery-r12-scope.js';
import {validateDiscoveryReviewContinuation,discoveryReviewExecutionIntent} from '../.core-tests/products/discovery-r12-review-continuation.js';
import {parseR12ReviewOwnerWorkspace} from '../.core-tests/products/discovery-r12-review-preparation-contract.js';
import {buildDiscoveryIntentFromGoal,DISCOVERY_GOAL_DEFAULT} from '../.core-tests/products/discovery-v2-goal.js';
import {discoveryV2Hash} from '../.core-tests/products/discovery-v2.js';
const id=n=>`12000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const at=Date.parse('2026-10-06T07:00:00Z');
function fixture(){
 const priorIntent=buildDiscoveryIntentFromGoal({id:id(2),businessId:id(1),goal:DISCOVERY_GOAL_DEFAULT,maximumMicrousd:2000000,maximumCollections:1,now:at-86400000});
 const original={businessId:id(1),budgetAuthorityRootId:id(3),priorRoundId:id(2),semanticGoalHash:'a'.repeat(64),priorIntent,maximumMicrousd:2000000,committedMicrousd:121627,hasUncertainCosts:false};
 const query='Compare adult nature-shirt purchase criteria in US, GB, AU and NZ using dated factual public snippets, retaining all geographic, population, measurement and operating limitations.';
 const amendment={version:'r12.discovery-source-scope.1',id:id(4),businessId:id(1),goalId:id(5),budgetAuthorityRootId:id(3),priorRoundId:id(2),originalIntentHash:discoveryV2Hash(priorIntent),originalSemanticGoalHash:original.semanticGoalHash,allowedDomains:['adult-outdoors.example'],excludedDomains:['etsy.com','etsy.me','etsystatic.com'],sourceReviews:[{domain:'adult-outdoors.example',basis:'documented_api_factual_snippets',reviewHash:'b'.repeat(64)}],approvalHash:'c'.repeat(64),independentReviewHash:'d'.repeat(64),approvedQuery:query,purposeReviewHash:discoveryV2Hash({query,classification:'generic_nonpersonal_public_research'}),createdAt:new Date(at-60000).toISOString(),expiresAt:new Date(at+3600000).toISOString()};
 const source=prepareAmendedDiscoveryScope(original,amendment,at);
 const now=at+7200000,envelope={version:'r12.discovery-review-continuation.1',id:id(20),businessId:id(1),goalId:id(5),budgetAuthorityRootId:id(3),priorRoundId:id(2),sourceScopeId:id(4),sourceScopeHash:source.amendmentHash,sourcePlanId:id(21),sourcePlanHash:'e'.repeat(64),sourceReviewAttemptId:id(22),sourcePhases:['plan','search1','select1','strategy'].map((stepKey,i)=>({stepKey,attemptId:id(30+i),artifactId:id(40+i),responseHash:String(i+1).repeat(64)})),baseDispatches:4,baseChildren:5,baseKnownMicrounits:'19268',allowedDomains:amendment.allowedDomains,excludedDomains:amendment.excludedDomains,approvedQuery:query,approvalHash:'f'.repeat(64),independentReviewHash:'9'.repeat(64),createdAt:new Date(now-60000).toISOString(),expiresAt:new Date(now+1800000).toISOString()};
 return{source,envelope,now};
}
test('review continuation derives a separate execution deadline and preserves every original source field',()=>{
 const f=fixture(),before=structuredClone(f.source);assert.ok(Date.parse(f.source.intent.expiresAt)<f.now);
 assert.deepEqual(validateDiscoveryReviewContinuation(f.envelope,f.source,f.now),f.envelope);
 const execution=discoveryReviewExecutionIntent(f.source,f.envelope,f.now);
 assert.deepEqual(execution,{...before.intent,expiresAt:f.envelope.expiresAt});assert.deepEqual(f.source,before);
});
test('lineage-aware review retains bounded prior history without changing original source intent',()=>{
 const f=fixture(),previous=index=>({scopeId:id(70+index),scopeHash:'7'.repeat(64),planId:id(80+index),planHash:'8'.repeat(64),attemptId:id(90+index),requestId:id(100+index),settlementHash:'6'.repeat(64),actualMicrounits:'17713'});
 for(const count of [1,2]){const reviewHistory=Array.from({length:count},(_,index)=>previous(index));const envelope={...f.envelope,version:'r12.discovery-review-continuation.2',reviewHistory,predecessorPlanId:reviewHistory.at(-1).planId,baseDispatches:4+count,baseChildren:5+count,baseKnownMicrounits:String(19268+17713*count)};
  assert.deepEqual(validateDiscoveryReviewContinuation(envelope,f.source,f.now),envelope);assert.equal(discoveryReviewExecutionIntent(f.source,envelope,f.now).id,f.source.intent.id);
  for(const mutate of [e=>e.reviewHistory=[],e=>e.reviewHistory.push(previous(3)),e=>e.predecessorPlanId=e.sourcePlanId,e=>e.baseDispatches=4,e=>e.baseChildren=5,e=>e.baseKnownMicrounits='0',e=>e.reviewHistory[0].actualMicrounits='-1',e=>e.reviewHistory[0].attemptId=e.sourcePhases[0].attemptId,e=>e.reviewHistory[0].settlementHash='bad',e=>e.reviewHistory[0].unapprovedField=true]){const bad=structuredClone(envelope);mutate(bad);assert.throws(()=>validateDiscoveryReviewContinuation(bad,f.source,f.now));}
 }
});
for(const [label,change] of [
 ['unknown format',e=>e.version='r12.generic.1'],['new source query',e=>e.approvedQuery+=' More sources'],['new domain',e=>e.allowedDomains=['other.example']],['omitted restriction',e=>e.excludedDomains=[]],['other Goal',e=>e.goalId=id(99)],['other root',e=>e.budgetAuthorityRootId=id(99)],['source hash',e=>e.sourceScopeHash='0'.repeat(64)],['missing phase',e=>e.sourcePhases.pop()],['phase substitution',e=>e.sourcePhases[3].stepKey='review'],['duplicate attempt',e=>e.sourcePhases[1].attemptId=e.sourcePhases[0].attemptId],['unsent source',e=>e.sourcePhases[3].attemptId=e.sourceReviewAttemptId],['reset count',e=>e.baseDispatches=0],['more children',e=>e.baseChildren=6],['negative cost',e=>e.baseKnownMicrounits='-1'],['invented permission',e=>e.executionAuthorized=true],['expired window',e=>e.expiresAt=e.createdAt],
])test(`review continuation rejects ${label}`,()=>{const f=fixture();change(f.envelope);assert.throws(()=>validateDiscoveryReviewContinuation(f.envelope,f.source,f.now));});
test('owner preparation reads the exact one-call proposal through either source link and rejects wider permission',()=>{
 const f=fixture(),ownerId=id(60),proposal={version:'r12.review-owner-proposal.1',scopeId:f.envelope.id,scopeHash:discoveryV2Hash(f.envelope),businessId:id(1),ownerId,goalId:id(5),expectedBusinessRevision:7,expectedBusinessHash:'1'.repeat(64),expectedGoalRevision:2,expectedGoalHash:'2'.repeat(64),businessContent:{brandContext:'Original Business',operatingRules:'One remaining review only',allowedActivity:'Review saved outputs',restrictions:'No other effects'},goalContent:{title:'Original research',originalIntent:DISCOVERY_GOAL_DEFAULT,objective:DISCOVERY_GOAL_DEFAULT,parsed:{},ambiguities:[]},operatingPolicy:{version:'r05.1',goalId:id(5),businessRevision:8,goalRevision:4,currency:'USD',maximumDispatches:1,policyLimitMicrounits:'157168',businessLifetimeLimitMicrounits:'1053587',expiresAt:f.envelope.expiresAt,operations:[{operationKey:`research.r12.${f.envelope.id}.review`,maximumPerOperationMicrounits:'157168'}]},interpretationHash:'3'.repeat(64)};
 const view={version:'r12.review-owner-workspace.1',businessId:id(1),scopeId:f.envelope.id,scope:f.envelope,proposalHash:discoveryV2Hash(proposal),proposal,confirmation:null,eligible:true,reason:null};
 for(const scopeId of [f.envelope.id,f.envelope.sourceScopeId])assert.deepEqual(parseR12ReviewOwnerWorkspace(view,id(1),scopeId,ownerId),view);
 const changed=structuredClone(view);changed.proposal.businessContent.allowedActivity='Changed after the displayed hash';assert.throws(()=>parseR12ReviewOwnerWorkspace(changed,id(1),f.envelope.id,ownerId));
 for(const mutate of [v=>v.proposal.ownerId=id(61),v=>v.proposal.operatingPolicy.maximumDispatches=5,v=>v.proposal.operatingPolicy.operations.push(v.proposal.operatingPolicy.operations[0]),v=>v.proposal.operatingPolicy.operations[0].operationKey='research.search',v=>v.proposal.operatingPolicy.goalRevision=2,v=>v.proposal.scopeHash='0'.repeat(64),v=>v.confirmation={policyId:id(70),policyHash:'5'.repeat(64),businessRevision:7,goalRevision:2}]){const bad=structuredClone(view);mutate(bad);bad.proposalHash=discoveryV2Hash(bad.proposal);assert.throws(()=>parseR12ReviewOwnerWorkspace(bad,id(1),f.envelope.id,ownerId));}
});

test('remaining-review server action keeps owner authentication and recovers a lost confirmation response',async()=>{
 const {loadSource}=await import('./helpers/guided-ui.mjs');
 const f=fixture(),ownerId=id(60),scopeId=f.envelope.id;
 const proposal={version:'r12.review-owner-proposal.1',scopeId,scopeHash:discoveryV2Hash(f.envelope),businessId:id(1),ownerId,goalId:id(5),expectedBusinessRevision:7,expectedBusinessHash:'1'.repeat(64),expectedGoalRevision:2,expectedGoalHash:'2'.repeat(64),businessContent:{brandContext:'Original Business',operatingRules:'One remaining review only',allowedActivity:'Review saved outputs',restrictions:'No other effects'},goalContent:{title:'Original research',originalIntent:DISCOVERY_GOAL_DEFAULT,objective:DISCOVERY_GOAL_DEFAULT,parsed:{},ambiguities:[]},operatingPolicy:{version:'r05.1',goalId:id(5),businessRevision:8,goalRevision:4,currency:'USD',maximumDispatches:1,policyLimitMicrounits:'157168',businessLifetimeLimitMicrounits:'1053587',expiresAt:f.envelope.expiresAt,operations:[{operationKey:`research.r12.${scopeId}.review`,maximumPerOperationMicrounits:'157168'}]},interpretationHash:'3'.repeat(64)};
 const view={version:'r12.review-owner-workspace.1',businessId:id(1),scopeId,scope:f.envelope,proposalHash:discoveryV2Hash(proposal),proposal,confirmation:null,eligible:true,reason:null};
 let owner=true,claimsOwner=ownerId,derivations=0,confirms=0,drop=true;const calls=[];
 const context={userId:ownerId,get businesses(){return owner?[{id:id(1),name:'Inert original Business'}]:[];},supabase:{auth:{getClaims:async()=>({data:{claims:{sub:claimsOwner}},error:null})},rpc:async(name,args)=>{
  calls.push(name);assert.equal(args.p_business_id,id(1));assert.equal(args.p_scope_id,scopeId);
  if(name==='r12_review_owner_read')return{data:structuredClone(view),error:null};
  assert.equal(name,'r12_review_owner_confirm');assert.equal(args.p_proposal_hash,view.proposalHash);confirms++;
  view.confirmation={policyId:id(70),policyHash:'5'.repeat(64),businessRevision:8,goalRevision:4};view.eligible=false;view.reason='already_confirmed';
  if(drop){drop=false;return{data:null,error:Error('Simulated lost response after saved transaction')};}
  return{data:{scopeId,...view.confirmation,executionAuthorized:false,replayed:true},error:null};
 }}};
 const contract=await import('../.core-tests/products/discovery-r12-review-preparation-contract.js');
 const server=loadSource('src/products/discovery-r12-review-preparation-server.ts',{'server-only':{},'../lib/core-ui/owner-business':{verifyOwnerBusiness:async()=>owner},'./discovery-r12-server':{prepareDiscoveryR12Authority:async(c,b,s)=>{assert.equal(c,context);assert.equal(b,id(1));assert.equal(s,scopeId);derivations++;return{controllerKeyHash:'6'.repeat(64),admissionKeyHash:'7'.repeat(64),authorityCreated:false};}},'./discovery-r12-review-preparation-contract':contract});
 owner=false;await assert.rejects(server.confirmR12ReviewPreparation(context,id(1),scopeId,view.proposalHash));assert.equal(calls.length,0);
 owner=true;claimsOwner=id(61);await assert.rejects(server.confirmR12ReviewPreparation(context,id(1),scopeId,view.proposalHash));assert.equal(calls.length,0);
 claimsOwner=ownerId;await assert.rejects(server.confirmR12ReviewPreparation(context,id(1),scopeId,'0'.repeat(64)));assert.equal(derivations,0);
 await assert.rejects(server.confirmR12ReviewPreparation(context,id(1),scopeId,view.proposalHash));assert.equal(confirms,1);assert.ok(view.confirmation);
 const result=await server.confirmR12ReviewPreparation(context,id(1),scopeId,view.proposalHash);assert.equal(confirms,2);assert.equal(derivations,2);assert.equal(result.policyId,id(70));assert.equal(result.executionAuthorized,false);
 assert.deepEqual(Object.keys(result).sort(),['admissionKeyHash','businessId','businessRevision','controllerKeyHash','executionAuthorized','goalId','goalRevision','policyHash','policyId','proposalHash','scopeId'].sort());
 assert.deepEqual(new Set(calls),new Set(['r12_review_owner_read','r12_review_owner_confirm']));
});
