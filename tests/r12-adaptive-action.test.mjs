import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAdaptiveResearchAction } from '../.core-tests/products/discovery-r12-adaptive-action.js';
import { fixture, id, now } from './helpers/r12-adaptive-fixture.mjs';

function initial() {
  const preview=fixture(), scopeHash='6'.repeat(64);
  const action={version:'r12.adaptive-action.1',scopeId:id(40),scopeHash,ordinal:0,kind:'initial',previousActionHash:null,previousReviewHash:preview.imports[4].responseHash,
    question:'What evidence supports and contradicts the next candidate comparison?',hypothesis:'A distinct original concept may support a bounded private learning test.',expectedInformationGain:'Identify whether candidate-specific evidence changes the experiment decision.',counterevidenceQuestion:'Which observations would refute the candidate hypothesis?',phases:['plan','search','select','strategy','review'],repair:null};
  const context={preview,scopeId:action.scopeId,scopeHash,nextOrdinal:0,previousActionHash:null,previousReviewHash:action.previousReviewHash,previousActionClosed:true,ownerStopped:false,
    capacity:{extraActionsUsed:0,childrenUsed:19,dispatchesUsed:17,createdPhaseSlots:[],runCommittedMicrousd:0,rootHeadroomMicrousd:10000000,businessHeadroomMicrousd:10000000,hasUnknownLiability:false,authorityActive:true,expired:false},
    phaseCeilings:{plan:23246,search:149560,select:26311,strategy:50451,review:157168},repairableFailure:null};
  return {action,context};
}
function followup(ordinal=1) {
  const f=initial();
  Object.assign(f.action,{ordinal,kind:'followup',previousActionHash:'7'.repeat(64),phases:['search','select','strategy','review']});
  Object.assign(f.context,{nextOrdinal:ordinal,previousActionHash:f.action.previousActionHash});
  Object.assign(f.context.capacity,{extraActionsUsed:ordinal-1,childrenUsed:24,dispatchesUsed:22+(ordinal-1)*4,createdPhaseSlots:['plan','search','select','strategy','review'],runCommittedMicrousd:406736+(ordinal-1)*383490});
  return f;
}
test('initial uses five fresh phase slots; ten followups preserve slots and account for all 45 paid calls',()=>{
  const f=initial();const first=validateAdaptiveResearchAction(f.action,f.context,now);
  assert.equal(first.extraActionIncrement,0);assert.equal(first.admission.paidCalls,5);assert.equal(first.admission.decision,'eligible_for_atomic_admission');
  for(let ordinal=1;ordinal<=10;ordinal++) {
    const next=followup(ordinal);const result=validateAdaptiveResearchAction(next.action,next.context,now);
    assert.equal(result.extraActionIncrement,1);assert.equal(result.admission.paidCalls,4);assert.equal(result.admission.requiredNewChildren,0);assert.equal(result.admission.decision,'eligible_for_atomic_admission');
  }
  const extra=followup(11);assert.throws(()=>validateAdaptiveResearchAction(extra.action,extra.context,now));
});
test('stop, forged predecessor, incomplete phase chain and counter resets fail before admission',()=>{
  for(const mutate of [f=>f.context.ownerStopped=true,f=>f.context.previousActionClosed=false,f=>f.action.previousReviewHash='0'.repeat(64),f=>f.action.previousActionHash='8'.repeat(64),f=>f.action.phases.pop(),f=>f.context.capacity.childrenUsed=19,f=>f.context.capacity.dispatchesUsed=0,f=>f.action.scopeId=id(99)]) {
    const f=followup();mutate(f);assert.throws(()=>validateAdaptiveResearchAction(f.action,f.context,now));
  }
});
test('NME cannot manufacture a format or reasoning repair',()=>{
  const f=followup();f.action.kind='repair';f.action.phases=['review'];f.action.repair={failedAttemptId:id(50),failureHash:'8'.repeat(64),defect:'schema'};
  assert.throws(()=>validateAdaptiveResearchAction(f.action,f.context,now));
  f.context.repairableFailure={attemptId:id(50),failureHash:'8'.repeat(64),phase:'review',defect:'schema'};
  assert.throws(()=>validateAdaptiveResearchAction(f.action,f.context,now),'Review-only cannot relabel a previous action strategy');
  f.action.phases=['strategy','review'];
  assert.equal(validateAdaptiveResearchAction(f.action,f.context,now).admission.paidCalls,2);
});
test('repairs account for a complete coherent context and every downstream call',()=>{
  for(const [phase,phases] of [['plan',['plan','search','select','strategy','review']],['search',['search','select','strategy','review']],['select',['search','select','strategy','review']],['strategy',['strategy','review']],['review',['strategy','review']]]) {
    const f=followup();f.action.kind='repair';f.action.phases=phases;
    f.action.repair={failedAttemptId:id(50),failureHash:'8'.repeat(64),defect:'format'};
    f.context.repairableFailure={...f.action.repair,attemptId:id(50),phase};delete f.context.repairableFailure.failedAttemptId;
    const result=validateAdaptiveResearchAction(f.action,f.context,now);
    assert.equal(result.admission.paidCalls,phases.length);assert.equal(result.extraActionIncrement,1);
    f.context.capacity.dispatchesUsed=64-phases.length+1;
    assert.throws(()=>validateAdaptiveResearchAction(f.action,f.context,now));
  }
});
test('an approved lower envelope cannot silently become the generic $10 ceiling',()=>{
  const f=followup();f.context.preview.maximumRunMicrounits='500000';
  const result=validateAdaptiveResearchAction(f.action,f.context,now);
  assert.equal(result.admission.decision,'pause');assert.equal(result.admission.reason,'approved_run_budget');
});
test('longer pivots consume five calls and cannot evade the cumulative dispatch ceiling',()=>{
  const f=followup(10);f.action.kind='pivot';f.action.phases=['plan','search','select','strategy','review'];
  assert.equal(validateAdaptiveResearchAction(f.action,f.context,now).admission.paidCalls,5);
  f.context.capacity.dispatchesUsed=60;
  assert.throws(()=>validateAdaptiveResearchAction(f.action,f.context,now));
});
