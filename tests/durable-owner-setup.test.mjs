import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {planOwnerSetupWake as plan} from '../.core-tests/core/durable-owner-setup.js';
const now=Date.parse('2026-10-11T21:40:00.000Z'), h='a'.repeat(64);
function state(phase='prepared'){
 const s={version:'core.durable-owner-setup.1',operationId:randomUUID(),businessId:randomUUID(),ownerId:randomUUID(),requestHash:h,scopeHash:h,revision:0,phase,
  approvedAt:'2026-10-11T21:00:00.000Z',expiresAt:'2026-10-12T02:06:00.000Z',stopped:false,revoked:false,createMarked:phase!=='prepared',
  sessionCheckpointHash:null,disconnectProofHash:null,handoffRecordHash:null,ownerReturned:false,terminalProofHash:null,profileReadyProofHash:null};
 if(['session_saved','preparing','disconnected','awaiting_owner','returned','profile_pending','pending_verification','complete'].includes(phase))s.sessionCheckpointHash=h;
 if(['disconnected','awaiting_owner','returned','profile_pending','pending_verification','complete'].includes(phase))s.disconnectProofHash=h;
 if(['awaiting_owner','returned','profile_pending','pending_verification','complete'].includes(phase))s.handoffRecordHash=h;
 if(['returned','profile_pending','pending_verification','complete'].includes(phase))s.ownerReturned=true;
 if(['profile_pending','pending_verification','complete','terminal'].includes(phase))s.terminalProofHash=h;
 if(['pending_verification','complete'].includes(phase))s.profileReadyProofHash=h;
 return s;
}
for(const [phase,action]of Object.entries({prepared:'admit_create',create_marked:'reconcile_create',session_saved:'admit_prepare',preparing:'release_exact_session',disconnected:'publish_saved_handoff',awaiting_owner:'wait_for_owner',returned:'release_exact_session',profile_pending:'read_exact_profile',pending_verification:'await_separate_verification',complete:'finish',cleanup_pending:'release_exact_session',terminal:'finish'}))test(`${phase} reconstructs one bounded ${action}`,()=>{
 const s=state(phase),copy=structuredClone(s),w=plan(s,now);assert.equal(w.action,action);assert.equal(w.operationId,s.operationId);assert.equal(w.deadline,s.expiresAt);assert.deepEqual(s,copy);
});
for(const phase of ['create_marked','session_saved','preparing','disconnected','awaiting_owner','returned'])for(const close of ['stop','revocation','expiry'])test(`${close} during ${phase} permits only exact-session cleanup`,()=>{
 const s=state(phase);s.stopped=close==='stop';s.revoked=close==='revocation';assert.equal(plan(s,close==='expiry'?Date.parse(s.expiresAt):now).action,'release_exact_session');
});
test('lost create response never produces another create across repeated wakes',()=>{
 const s=state('create_marked');for(let i=0;i<20;i++){const w=plan(structuredClone(s),now+i*1000);assert.equal(w.action,'reconcile_create');assert.equal(w.operationId,s.operationId);}
});
test('lost publish acknowledgement uses committed disconnect proof without connecting again',()=>{
 const s=state('disconnected');assert.equal(plan(s,now).action,'publish_saved_handoff');s.phase='awaiting_owner';s.handoffRecordHash=h;s.revision++;
 assert.equal(plan(s,now).action,'wait_for_owner');
});
test('consumed Stop does not require an unconsumed handoff to drive cleanup',()=>{
 const s=state('returned');s.stopped=true;s.phase='cleanup_pending';assert.equal(plan(s,now).action,'release_exact_session');
 s.terminalProofHash=h;assert.equal(plan(s,now).action,'finish');assert.equal(s.ownerReturned,true);
});
test('returned UPLOADING profile waits on the original profile without a new session',()=>{
 const s=state('profile_pending');for(let i=0;i<5;i++)assert.equal(plan(s,now+i*1000).action,'read_exact_profile');
 s.profileReadyProofHash=h;s.phase='pending_verification';assert.equal(plan(s,now).action,'await_separate_verification');
});
test('terminal provider status cannot invent disconnect or profile proof',()=>{
 for(const phase of ['disconnected','awaiting_owner','pending_verification']){
  const s=state(phase);s.disconnectProofHash=null;s.terminalProofHash=h;assert.throws(()=>plan(s,now),/checkpoint_unverified/);
 }
});
test('stopped pre-dispatch setup creates no cleanup transport or new authority',()=>{
 const s=state();s.stopped=true;assert.equal(plan(s,now).action,'finish');assert.equal(s.createMarked,false);
});
test('unproven post-dispatch terminal state cannot clear an unknown effect',()=>{
 const s=state('terminal');s.terminalProofHash=null;assert.throws(()=>plan(s,now),/checkpoint_unverified/);
});
test('old stopped handoff is not automatically converted into durable authority',()=>{
 const s=state();s.version='etsy.steel-owner-handoff-scope.1';assert.throws(()=>plan(s,now),/checkpoint_unverified/);
});
test('invalid revision, unknown fields and getters fail before any step',()=>{
 const s=state();s.revision=-1;assert.throws(()=>plan(s,now),/checkpoint_unverified/);
 const t=state();t.providerUrl='https://secret';assert.throws(()=>plan(t,now),/checkpoint_unverified/);
 const u=state();let n=0;Object.defineProperty(u,'phase',{get(){n++;return'prepared';},enumerable:true});assert.throws(()=>plan(u,now),/checkpoint_unverified/);assert.equal(n,0);
});
