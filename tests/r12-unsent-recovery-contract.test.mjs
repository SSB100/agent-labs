import test from 'node:test';
import assert from 'node:assert/strict';
import {validateR12FocusedSuccessor,validateR12FocusedUnsentClosure,R12_UNSENT_RECOVERY_LIMITS} from '../.core-tests/products/discovery-r12-focused-successor.js';
import {discoveryV2Hash as hash} from '../.core-tests/products/discovery-v2.js';
import {r12PilotGoalContent} from '../.core-tests/products/discovery-r12-pilot-preparation-contract.js';
import {STAGING_SQL,ACTIVATION_SQL,CLOSE_SQL,runOperatorRecipe} from '../scripts/r12-focused-pilot-unsent-recovery-bootstrap.mjs';
import {STAGING_SQL as ORIGINAL_STAGE,ACTIVATION_SQL as ORIGINAL_ACTIVATE,CLOSE_SQL as ORIGINAL_CLOSE} from '../scripts/r12-focused-pilot-bootstrap.mjs';
const id=n=>`cccccccc-cccc-4ccc-8ccc-${String(n).padStart(12,'0')}`;
function fixture(){
 const h=label=>hash({label}),now=Math.floor(Date.now()/1000)*1000,createdAt=new Date(now-1000).toISOString(),expiresAt=new Date(now+7200000).toISOString();
 const closure={version:'r12.focused-pilot-closure.1',businessId:id(100),scopeId:id(101),scopeHash:h('priorScope'),goalId:id(102),planId:id(103),planHash:h('priorPlan'),policyId:id(104),policyHash:h('priorPolicy'),profileHash:h('priorProfile'),budgetAuthorityRootId:id(105),priorRoundId:id(106),originalGoalId:id(107),originalClosedPlanId:id(108),originalClosedPlanHash:h('broadPlan'),acceptedReviewScopeId:id(109),acceptedReviewHash:h('broadReview'),controllerKeyHash:h('priorController'),admissionKeyHash:h('priorAdmission'),dispatches:2,childrenCreated:2,repairsUsed:0,pivotsUsed:0,authorityClosed:true,knownMicrousd:'20',phases:['strategy','review'].map((phase,i)=>({phase,attemptId:id(120+i),requestId:id(130+i),wireBindingHash:h(`wire${i}`),candidateHash:h(`candidate${i}`),routeProofHash:h(`proof${i}`),settlementHash:h(`settlement${i}`),actualMicrousd:'10',acceptedResponseHash:i?null:h('response'),artifactId:i?null:id(140),receivedObservationHash:i?h('received'):null,rejectedDiagnosticHash:i?h('rejected'):null}))};
 const u={version:'r12.focused-pilot-unsent-closure.1',businessId:closure.businessId,scopeId:id(1),goalId:id(2),planId:id(3),policyId:id(4),budgetAuthorityRootId:closure.budgetAuthorityRootId,priorRoundId:closure.priorRoundId,attemptId:id(5),requestId:id(6),dispatches:0,childrenCreated:1,repairsUsed:0,pivotsUsed:0,authorityClosed:true,knownMicrousd:'0',heldMicrousd:'0'};
 for(const k of ['scopeHash','planHash','policyHash','profileHash','successorAuthorizationHash','controllerKeyHash','admissionKeyHash','requestHash','wireBindingHash','wireHash','reservationHash','releaseHash','releaseEvidenceHash','decisionHash','absenceHash'])u[k]=h(k);
 const p={businessId:closure.businessId,id:id(200),goalId:id(201),researchAllocationMicrousd:277907,expiresAt};
 const envelope={id:p.id,businessId:p.businessId,goalId:p.goalId,profile:p,profileHash:hash(p),createdAt,expiresAt,approvalHash:h('approval'),closedPlanId:u.planId,closedPlanHash:u.planHash,originalGoalId:closure.originalGoalId,acceptedReviewScopeId:closure.acceptedReviewScopeId,acceptedReviewHash:closure.acceptedReviewHash,budgetAuthorityRootId:closure.budgetAuthorityRootId,priorRoundId:closure.priorRoundId};
 const authorization={version:'r12.focused-pilot-unsent-recovery-authorization.1',businessId:p.businessId,ownerId:id(202),scopeId:p.id,scopeHash:hash(envelope),goalId:p.goalId,preparedGoalRevision:2,preparedGoalHash:h('goal'),profileHash:envelope.profileHash,ownerApprovalEvidenceHash:envelope.approvalHash,predecessorClosure:closure,limits:R12_UNSENT_RECOVERY_LIMITS,unsentClosure:u,createdAt,expiresAt};
 return {p,envelope,closure,pins:{businessId:p.businessId,scopeId:p.id,goalId:p.goalId,ownerId:authorization.ownerId},proof:{authorization,authorizationHash:hash(authorization)},u};
}
test('recovery binds distinct unsent plan and original charged predecessor without modifying either proof',()=>{
 const f=fixture(),before=structuredClone(f.proof);assert.deepEqual(validateR12FocusedSuccessor(f.proof,{...f.pins,scope:f.envelope}),before);
 assert.notEqual(f.u.planId,f.closure.planId);assert.deepEqual(f.proof.authorization.predecessorClosure,f.closure);
 for(const mutate of [a=>a.unsentClosure.dispatches=1,a=>a.unsentClosure.childrenCreated=2,a=>a.unsentClosure.heldMicrousd='1',a=>a.unsentClosure.knownMicrousd='1',a=>a.unsentClosure.authorityClosed=false,a=>a.unsentClosure.scopeId=a.scopeId,a=>a.unsentClosure.goalId=a.goalId,a=>a.unsentClosure.planId=a.predecessorClosure.planId,a=>a.unsentClosure.budgetAuthorityRootId=id(90),a=>a.unsentClosure.releaseHash=null,a=>a.limits.maximumRecoveries=2,a=>a.limits.paidRetryAllowed=true,a=>a.version='r12.focused-pilot-successor-authorization.1']){
  const p=structuredClone(f.proof);mutate(p.authorization);p.authorizationHash=hash(p.authorization);assert.throws(()=>validateR12FocusedSuccessor(p,{...f.pins,scope:f.envelope}));
 }
 const pins={businessId:f.u.businessId,scopeId:f.u.scopeId,goalId:f.u.goalId,successorAuthorizationHash:f.u.successorAuthorizationHash};
 assert.deepEqual(validateR12FocusedUnsentClosure(f.u,pins),f.u);assert.throws(()=>validateR12FocusedUnsentClosure({...f.u,extra:true},pins));assert.throws(()=>validateR12FocusedUnsentClosure(f.u,{...pins,successorAuthorizationHash:'0'.repeat(64)}));
 assert.deepEqual(f.proof,before);
});
test('recovery Goal states permanent one-time boundary, fresh authority and separately approved creative',()=>{
 const f=fixture(),content=r12PilotGoalContent({businessId:f.p.businessId,sourceScopeId:f.u.scopeId,preparationId:f.p.id,setupUntil:f.p.expiresAt},true,true);
 assert.match(content.title,/proven-unsent recovery/);const text=content.parsed.stopConstraints.join(' ');for(const pattern of [/Only one recovery/,/fresh authority is required/,/0.277907/,/Stop before the reviewer/,/No image, publication/])assert.match(text,pattern);
});
test('recovery operator composes frozen originals and exact closure with no automatic retries',async()=>{
 assert.ok(STAGING_SQL.endsWith(ORIGINAL_STAGE));assert.ok(ACTIVATION_SQL.endsWith(ORIGINAL_ACTIVATE));assert.ok(CLOSE_SQL.includes(ORIGINAL_CLOSE));
 assert.match(STAGING_SQL,/r12_pilot_unsent_recovery_validate/);assert.match(STAGING_SQL,/abandoned_scope_id/);assert.match(CLOSE_SQL,/r12_pilot_unsent_recovery_release/);
 const calls=[],client={query:async(sql)=>{calls.push(sql);if(sql.includes('DO $recovery$'))throw Error('blocked');return{rows:[]};}};
 await assert.rejects(runOperatorRecipe(client,'activate',{}),/blocked/);assert.equal(calls.filter(x=>x.includes('DO $recovery$')).length,1);assert.equal(calls.at(-1),'rollback');
});
