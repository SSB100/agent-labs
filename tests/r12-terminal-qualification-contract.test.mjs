import test from 'node:test';
import assert from 'node:assert/strict';
import {focusedSuccessorFixture} from './helpers/r12-focused-successor-fixture.mjs';
import {discoveryV2Hash as hash} from '../.core-tests/products/discovery-v2.js';
import {validateR12FocusedSuccessor,validateR12MarkedPretransportClosure,R12_TERMINAL_QUALIFICATION_LIMITS} from '../.core-tests/products/discovery-r12-focused-successor.js';
import {STAGING_SQL,ACTIVATION_SQL,CLOSE_SQL,RECONCILIATION_SQL,runOperatorRecipe} from '../scripts/r12-terminal-technical-qualification-bootstrap.mjs';
import {STAGING_SQL as ORIGINAL_STAGE,ACTIVATION_SQL as ORIGINAL_ACTIVATE,CLOSE_SQL as ORIGINAL_CLOSE} from '../scripts/r12-focused-pilot-bootstrap.mjs';
const id=n=>`eeeeeeee-eeee-4eee-8eee-${String(n).padStart(12,'0')}`;
function terminal(){
 const f=focusedSuccessorFixture(),before=structuredClone(f.successor);
 const c={version:'r12.focused-pilot-marked-pretransport-closure.1',businessId:f.p.businessId,scopeId:id(1),goalId:id(2),planId:id(3),policyId:id(4),
 budgetAuthorityRootId:f.p.budgetAuthorityRootId,priorRoundId:f.p.priorRoundId,attemptId:id(5),requestId:id(6),reconciliationEventId:'7',
 dispatches:1,childrenCreated:1,repairsUsed:0,pivotsUsed:0,authorityClosed:true,knownMicrousd:'0',heldMicrousd:'0'};
 for(const k of ['scopeHash','planHash','policyHash','profileHash','recoveryAuthorizationHash','controllerKeyHash','admissionKeyHash','requestHash','wireBindingHash','wireHash','reservationHash','financialMarkerHash','controllerMarkerHash','revocationsHash','reconciliationProofHash','releaseHash','releaseEvidenceHash','decisionHash','absenceHash'])c[k]=hash({field:k});
 c.releaseEvidenceHash=c.reconciliationProofHash;
 f.envelope.closedPlanId=c.planId;f.envelope.closedPlanHash=c.planHash;
 const a={...f.successor.authorization,version:'r12.focused-pilot-terminal-qualification-authorization.1',scopeHash:hash(f.envelope),limits:structuredClone(R12_TERMINAL_QUALIFICATION_LIMITS),markedClosure:c};
 return{...f,before,c,pair:{authorization:a,authorizationHash:hash(a)}};
}
test('terminal authorization binds compact marked reconciliation and preserves the charged proof',()=>{
 const f=terminal(),before=structuredClone(f.pair);
 assert.deepEqual(validateR12FocusedSuccessor(f.pair,f.pins,f.now),before);
 assert.deepEqual(f.pair.authorization.predecessorClosure,f.before.authorization.predecessorClosure);
 assert.equal(Object.hasOwn(f.pair.authorization,'unsentClosure'),false);
 assert.ok(Buffer.byteLength(JSON.stringify(f.pair),'utf8')<8192);
 const pins={businessId:f.c.businessId,scopeId:f.c.scopeId,goalId:f.c.goalId,planId:f.c.planId,recoveryAuthorizationHash:f.c.recoveryAuthorizationHash};
 assert.deepEqual(validateR12MarkedPretransportClosure(f.c,pins),f.c);
 for(const change of [{heldMicrousd:'1'},{knownMicrousd:'1'},{dispatches:0},{dispatches:2},{childrenCreated:2},{repairsUsed:1},{pivotsUsed:1},{authorityClosed:false},{financialMarkerHash:null},{controllerMarkerHash:null},{revocationsHash:null},{reconciliationEventId:'0'},{reconciliationEventId:'9223372036854775808'},{releaseEvidenceHash:'0'.repeat(64)},{transportClaim:false}])assert.throws(()=>validateR12MarkedPretransportClosure({...f.c,...change},pins));
 assert.throws(()=>validateR12MarkedPretransportClosure(f.c,{...pins,recoveryAuthorizationHash:'0'.repeat(64)}));
 assert.deepEqual(f.pair,before);
});
test('terminal rejects lineage substitution, broader limits, wrong version and nested recovery permissions',()=>{
 const f=terminal();
 for(const mutate of [a=>a.markedClosure.scopeId=a.scopeId,a=>a.markedClosure.goalId=a.goalId,a=>a.markedClosure.planId=a.predecessorClosure.planId,
 a=>a.markedClosure.budgetAuthorityRootId=id(30),a=>a.markedClosure.priorRoundId=id(31),a=>a.markedClosure.planHash='0'.repeat(64),
 a=>a.limits.maximumTechnicalQualifications=2,a=>a.limits.maximumPaidCalls=3,a=>a.limits.maximumMicrousd=277908,a=>a.limits.paidRetryAllowed=true,
 a=>a.unsentClosure=a.markedClosure,a=>a.evidenceRefresh={},a=>a.version='r12.focused-pilot-unsent-recovery-authorization.1',
 a=>a.predecessorClosure.phases[1].actualMicrousd='0',a=>a.ownerApprovalEvidenceHash='0'.repeat(64),a=>a.expiresAt='2000-01-01T00:00:00Z']){
  const pair=structuredClone(f.pair);mutate(pair.authorization);pair.authorizationHash=hash(pair.authorization);
  assert.throws(()=>validateR12FocusedSuccessor(pair,f.pins,f.now));
 }
 assert.throws(()=>validateR12FocusedSuccessor({...f.pair,authorizationHash:'0'.repeat(64)},f.pins,f.now));
});
test('terminal operator preserves reviewed originals and never retries a failed mutation',async()=>{
 assert.ok(STAGING_SQL.endsWith(ORIGINAL_STAGE));assert.ok(ACTIVATION_SQL.endsWith(ORIGINAL_ACTIVATE));assert.ok(CLOSE_SQL.includes(ORIGINAL_CLOSE));
 assert.match(RECONCILIATION_SQL,/r12_pilot_marked_pretransport_reconcile/);assert.match(STAGING_SQL,/reconciliation_event_id/);
 assert.match(CLOSE_SQL,/r12_pilot_terminal_release/);assert.match(CLOSE_SQL,/EXCEPTION WHEN query_canceled/);
 const calls=[],client={query:async(sql)=>{calls.push(sql);if(sql===RECONCILIATION_SQL)throw Error('proof denied');return{rows:[]};}};
 await assert.rejects(runOperatorRecipe(client,'reconcile',{}),/proof denied/);
 assert.equal(calls.filter(sql=>sql===RECONCILIATION_SQL).length,1);assert.equal(calls.at(-1),'rollback');
});
