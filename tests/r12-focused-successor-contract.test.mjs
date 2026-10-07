import test from 'node:test';
import assert from 'node:assert/strict';
import {focusedSuccessorFixture} from './helpers/r12-focused-successor-fixture.mjs';
import {validateR12FocusedSuccessor} from '../.core-tests/products/discovery-r12-focused-successor.js';
import {discoveryV2Hash as hash} from '../.core-tests/products/discovery-v2.js';
import {buildDiscoveryR12PhaseRequest,readDiscoveryR12PhaseInputs,reconstructDiscoveryR12Result} from '../.core-tests/products/discovery-r12-runtime.js';
import {focusedStrategyOutput,focusedReviewerOutput} from './helpers/r12-focused-profile-fixture.mjs';
import {context,phase,withClock,now} from './r12-focused-pilot-runtime.test.mjs';
import {routeDiscoveryR12Request,inspectDiscoveryR12Wire} from '../.core-tests/products/discovery-r12-wire.js';
import {focusedPilotStrategySchema} from '../.core-tests/products/discovery-r12-focused-pilot-contract.js';
import {discoveryR12StaticSchema} from '../.core-tests/products/discovery-r12-schemas.js';
import {DISCOVERY_R12_PILOT_REQUEST_BYTES} from '../.core-tests/products/discovery-r12-quote.js';
const id=n=>`eeeeeeee-eeee-4eee-8eee-${String(n).padStart(12,'0')}`;

test('successor proof binds actual focused closure and preserves distinct broad anchor',()=>withClock(now,()=>{
 const f=focusedSuccessorFixture(),proof=validateR12FocusedSuccessor(f.successor,f.pins,now);assert.deepEqual(proof,f.successor);assert.notEqual(proof.authorization.predecessorClosure.planId,proof.authorization.predecessorClosure.originalClosedPlanId);
 for(const mutate of [a=>a.preparedGoalRevision=3,a=>a.scopeHash='0'.repeat(64),a=>a.profileHash='0'.repeat(64),a=>a.ownerApprovalEvidenceHash='0'.repeat(64),a=>a.goalId=a.predecessorClosure.goalId,a=>a.predecessorClosure.scopeId=a.scopeId,a=>a.predecessorClosure.planId=a.predecessorClosure.originalClosedPlanId,a=>a.predecessorClosure.authorityClosed=false,a=>a.predecessorClosure.knownMicrousd='0',a=>a.predecessorClosure.phases[1].artifactId=id(99),a=>a.predecessorClosure.phases[1].rejectedDiagnosticHash=null,a=>a.predecessorClosure.phases[0].acceptedResponseHash=null,a=>a.limits.maximumPaidCalls=3,a=>a.limits.imageAllowed=true,a=>a.limits.maximumMicrousd++,a=>a.limits.stopOnAnyNegative=false,a=>a.predecessorClosure.successor={}]){
  const p=structuredClone(proof);mutate(p.authorization);p.authorizationHash=hash(p.authorization);assert.throws(()=>validateR12FocusedSuccessor(p,f.pins,now));
 }
 for(const bad of [undefined,null,{}, {...proof,extra:true},{...proof,authorizationHash:'0'.repeat(64)}])assert.throws(()=>validateR12FocusedSuccessor(bad,f.pins,now));
 assert.throws(()=>validateR12FocusedSuccessor(proof,{...f.pins,ownerId:id(100)},now));assert.throws(()=>validateR12FocusedSuccessor(proof,f.pins,Date.parse(proof.authorization.expiresAt)));
}));

test('valid successor negative strategy is accepted but cannot produce a reviewer request',()=>withClock(now,()=>{
 for(const outcome of ['NEEDS_MORE_EVIDENCE','REJECT']){
  const f=focusedSuccessorFixture(),output=focusedStrategyOutput(f.prepared);output.recommendation.proposedOutcome=outcome;output.usesPinnedLearningPlan=false;
  const first=phase(f.ctx,f.value,output,now);assert.equal(first.current.response.outcome,'accepted');assert.equal(first.current.response.result.outcome,outcome);
  const ctx=context(f.ctx.plan,'review',[first.current],700);ctx.planId=f.ctx.planId;
  assert.throws(()=>buildDiscoveryR12PhaseRequest(ctx,readDiscoveryR12PhaseInputs(ctx,f.raw(ctx,[first.current]))),/negative_strategy/);
 }
}));

test('invalid and inconsistent successor strategy is never promoted or converted to TEST',()=>withClock(now,()=>{
 for(const mutate of [o=>o.usesPinnedLearningPlan=false,o=>o.recommendation.proposedOutcome='NEEDS_MORE_EVIDENCE',o=>o.candidates[0].dimensions[0].uncertainties.push({question:'Is this exact learning proposal blocked?',blockingForTest:true,reason:'The unresolved constraint prevents recommending the exact proposal.'}),o=>o.testPlan={}]){
  const f=focusedSuccessorFixture(),output=focusedStrategyOutput(f.prepared);mutate(output);assert.throws(()=>phase(f.ctx,f.value,output,now));
 }
}));

test('successor TEST reconstructs unchanged research result, pins proof per call and preserves schema and wire limits',async()=>{
 const f=withClock(now,focusedSuccessorFixture),first=withClock(now,()=>phase(f.ctx,f.value,focusedStrategyOutput(f.prepared),now));
 const ctx=context(f.ctx.plan,'review',[first.current],710);ctx.planId=f.ctx.planId;
 const last=withClock(now,()=>phase(ctx,f.raw(ctx,[first.current]),focusedReviewerOutput(f.prepared),now));
 const result=withClock(now,()=>reconstructDiscoveryR12Result(last.saved,f.p.businessId,f.p.id));assert.equal(result.version,'r12.discovery-focused-pilot-result.1');assert.equal(result.review.outcome,'TEST');assert.equal(result.executionAuthorized,false);assert.equal(result.assessment.testPlan.generationAuthorized,false);assert.equal(result.assessment.testPlan.spendingAuthorized,false);assert.equal(result.successor,undefined);
 withClock(now+86400000,()=>assert.deepEqual(reconstructDiscoveryR12Result(last.saved,f.p.businessId,f.p.id),result));
 for(const [key,done] of [['strategy',first],['review',last]]){
  assert.equal(done.request.requestMetadata.r12FocusedSuccessorAuthorizationHash,f.successor.authorizationHash);assert.deepEqual(done.request.outputSchema,key==='strategy'?focusedPilotStrategySchema():discoveryR12StaticSchema('review'));
  const routed=routeDiscoveryR12Request(done.request,key,{modelId:done.request.model.providerModelId,endpoint:key==='strategy'?'azure/us':'amazon-bedrock/us',priceLimit:{prompt:1,completion:1,request:0}},true),wire=await inspectDiscoveryR12Wire(routed,key,false,true);
  assert.ok(Buffer.byteLength(JSON.stringify(routed))<=DISCOVERY_R12_PILOT_REQUEST_BYTES);assert.ok(Buffer.byteLength(wire.wire.body)<=DISCOVERY_R12_PILOT_REQUEST_BYTES);
 }
 for(const mutate of [raw=>delete raw.focusedPilot.successor,raw=>raw.focusedPilot.successor=null,raw=>raw.dependencies[0].binding.request.requestMetadata.r12FocusedSuccessorAuthorizationHash='0'.repeat(64),raw=>raw.dependencies[0]=f.old.saved.inputs.dependencies[3]]){
  const raw=structuredClone(f.raw(ctx,[first.current]));mutate(raw);assert.throws(()=>withClock(now,()=>buildDiscoveryR12PhaseRequest(ctx,readDiscoveryR12PhaseInputs(ctx,raw))));
 }
 const state=withClock(now,()=>readDiscoveryR12PhaseInputs(f.ctx,f.value));withClock(Date.parse(f.p.expiresAt),()=>assert.throws(()=>buildDiscoveryR12PhaseRequest(f.ctx,state)));
});
