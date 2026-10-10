import test from 'node:test';import assert from 'node:assert/strict';
import{validateEtsySteelOwnerView,etsySteelOwnerApproval,validateEtsySteelOwnerRendererReview}from'../.core-tests/accounts/etsy-steel-handoff-owner.js';
import{scope,hash,id,contracts}from'./helpers/etsy-steel-owner-view-fixture.mjs';
const view=()=>{const s=scope();return{operationId:s.operationId,scope:s,scopeHash:hash(s),disclosure:contracts.buildEtsySteelHandoffDisclosure(s),status:'pending_approval',cleanupPending:false,receipts:[]};};
test('safe owner catalog rejects private viewer/profile/envelope fields',()=>{const v=view(),e={ownerId:v.scope.ownerId,businessId:v.scope.businessId,operationId:v.operationId};assert.deepEqual(validateEtsySteelOwnerView(v,e),v);for(const k of['viewerUrl','profileId','envelope'])assert.throws(()=>validateEtsySteelOwnerView({...v,[k]:'private'},e));assert.throws(()=>validateEtsySteelOwnerView(v,{...e,ownerId:id(99)}));});
test('reviewed access requires exact current hashes and explicit true consent',()=>{const v=view(),i={operationId:v.operationId,scopeHash:v.scopeHash,disclosureHash:v.scope.disclosureHash,expectedApprovalRevision:v.scope.approvalRevision,persistentAccessApproved:true,budgetApproved:true};assert.deepEqual(etsySteelOwnerApproval(v,i),i);for(const change of[{persistentAccessApproved:false},{budgetApproved:false},{scopeHash:'a'.repeat(64)},{expectedApprovalRevision:id(99)},{extra:true}])assert.throws(()=>etsySteelOwnerApproval(v,{...i,...change}));assert.throws(()=>etsySteelOwnerApproval({...v,status:'stopped'},i));});

test('candidate renderer approval carries an explicit exact hash without changing legacy payload',()=>{const v=view(),i={operationId:v.operationId,scopeHash:v.scopeHash,disclosureHash:v.scope.disclosureHash,expectedApprovalRevision:v.scope.approvalRevision,persistentAccessApproved:true,budgetApproved:true};
 assert.deepEqual(etsySteelOwnerApproval(v,i),i);
 const pinned={...i,rendererReviewHash:hash({inertCandidateReview:true})};assert.deepEqual(etsySteelOwnerApproval(v,pinned),pinned);
 for(const rendererReviewHash of[undefined,null,'','a'.repeat(63),'A'.repeat(64),42])assert.throws(()=>etsySteelOwnerApproval(v,{...i,rendererReviewHash}));
 assert.throws(()=>etsySteelOwnerApproval(v,{...pinned,rendererPolicy:{allowAll:true}}));
});

const renderer=()=>({version:'etsy.steel-owner-renderer-review.1',operationId:id(1),status:'awaiting_approval',reviewHash:hash({review:1}),policyVersion:'etsy.insights-renderer-candidate-policy.3',policyHash:hash({policy:1}),landingControlsVersion:'etsy.insights-landing-controls.2',landingControlsHash:hash({controls:1}),purpose:'etsy_insights_verify_only',expiresAt:'2026-10-10T18:00:00.000Z',sourceReadiness:'unqualified'});
test('owner renderer sidecar is exact, nonsecret and cannot claim query readiness',()=>{
 const r=renderer();assert.deepEqual(validateEtsySteelOwnerRendererReview(r,r.operationId),r);
 for(const status of['approved','inactive'])assert.equal(validateEtsySteelOwnerRendererReview({...r,status},r.operationId).status,status);
 for(const change of[{sourceReadiness:'qualified'},{purpose:'etsy_insights_research'},{policyVersion:'etsy.insights-renderer-research-policy.4'},{policyHash:'bad'},{reviewHash:null},{landingControlsVersion:'unknown'},{expiresAt:'tomorrow'},{expiresAt:'2026-10-10'},{viewerUrl:'https://private.invalid'},{profileId:'private'},{status:'unknown'}])assert.throws(()=>validateEtsySteelOwnerRendererReview({...r,...change},r.operationId));
 assert.throws(()=>validateEtsySteelOwnerRendererReview(r,id(99)));
 for(const key of Object.keys(r)){const missing={...r};delete missing[key];assert.throws(()=>validateEtsySteelOwnerRendererReview(missing,r.operationId));}
});
test('legacy is explicit and cannot retain a candidate hash or be inferred from malformed data',()=>{
 const r=renderer(),legacy={...r,status:'legacy',reviewHash:null,policyVersion:null,policyHash:null,landingControlsVersion:null,landingControlsHash:null,purpose:null,expiresAt:null};
 assert.deepEqual(validateEtsySteelOwnerRendererReview(legacy,r.operationId),legacy);
 assert.equal(validateEtsySteelOwnerRendererReview(null,r.operationId),null);
 for(const key of['reviewHash','policyVersion','policyHash','landingControlsVersion','landingControlsHash','purpose','expiresAt'])assert.throws(()=>validateEtsySteelOwnerRendererReview({...legacy,[key]:r[key]},r.operationId));
 assert.throws(()=>validateEtsySteelOwnerRendererReview({},r.operationId));
});
