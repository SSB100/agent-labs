import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {driveQuestOnce} from '../.core-tests/core/quest-controller.js';
import {planFixture,id} from './helpers/r12-adaptive-fixture.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
function fixture(){
 const {plan}=planFixture(),events=[],actionHash='a'.repeat(64);
 const attempt=(key,n,status='completed')=>({id:id(n),stepKey:key,attempt:1,status,reason:'Inert separately bound phase',inputHash:'b'.repeat(64),dependencyPins:[],repairEvidenceHash:'c'.repeat(64),wireHash:null,requestId:null,responseHash:status==='completed'?hash(key+n):null});
 const old=plan.steps.map((s,i)=>attempt(s.key,100+i));
 const projection={actionHash,ordinal:1,phaseKeys:['search1','select1','strategy','review'],attemptIds:[],reused:[{stepKey:'plan',attemptId:old[0].id,resultHash:old[0].responseHash}]};
 const snapshot={businessId:plan.businessId,goalId:plan.goalId,planId:id(90),version:8,planHash:hash(JSON.stringify(plan)),plan,head:{planId:id(90),revision:1,state:'completed',reason:'previous_action_complete',epoch:1,leaseExpiresAt:'2026-10-10T09:00:00Z',repairsUsed:0,pivotsUsed:0,childrenCreated:24,dispatches:22},attempts:old,reused:old.map(a=>({stepKey:a.stepKey,attemptId:a.id,resultHash:a.responseHash}))};
 let posts=0,stale=false,loseResponse=false;
 const current=a=>projection.attemptIds.includes(a.id)&&a.adaptiveActionHash===actionHash&&a.adaptiveActionOrdinal===1;
 const store={read:async()=>structuredClone(snapshot),readAdaptiveAction:async()=>structuredClone(projection),command:async(op,payload)=>{
  events.push({op,payload});if(op==='claim')return{epoch:1};
  if(stale)throw Error('sql_adaptive_action_changed');
  if(op==='schedule') {assert.equal(payload.actionHash,actionHash);assert.equal(payload.actionOrdinal,1);const a=attempt(payload.stepKey,200+snapshot.attempts.length,'scheduled');a.id=payload.attemptId;a.adaptiveActionHash=actionHash;a.adaptiveActionOrdinal=1;a.dependencyPins=structuredClone(projection.reused);snapshot.attempts.push(a);projection.attemptIds.push(a.id);return{status:'scheduled'};}
  if(op==='adaptive_complete_action'){assert.equal(payload.actionHash,actionHash);assert.equal(payload.actionOrdinal,1);return{closed:projection.phaseKeys.every(k=>snapshot.attempts.some(a=>current(a)&&a.stepKey===k&&a.status==='completed'))};}
  const a=snapshot.attempts.find(a=>a.id===payload.attemptId);assert.ok(a);if(!current(a))throw Error('sql_foreign_adaptive_attempt');
  if(op==='reserve'){a.status='reserved';a.wireHash=payload.descriptor.wireRequestHash;return{status:'reserved'};}
  if(op==='dispatch'){if(a.status!=='reserved')return{shouldDispatch:false};a.status='dispatched';return{shouldDispatch:true};}
  if(op==='response'){a.status='responded';a.responseHash=hash(JSON.stringify(payload.result));return{};}
  if(op==='finish'){a.status='completed';return{};}
  if(op==='uncertain'){a.status='uncertain';return{};}
  if(op==='settle')return{};
  throw Error(`unexpected ${op}`);
 }};
 const adapters=Object.fromEntries(plan.steps.map(step=>[step.adapter,{qualificationHash:step.qualificationHash,workflowDefinitionId:step.workflowDefinitionId,workerDefinitionId:step.workerDefinitionId,mode:'qualification',prepare:async c=>{assert.ok(Object.isFrozen(c.attempt));const body=JSON.stringify({model:'openai/inert',max_tokens:100,stream:false});return{wire:{url:'https://openrouter.ai/api/v1/chat/completions',method:'POST',body},descriptor:{workflowRunId:c.attempt.id,idempotencyKey:`r07:${c.attempt.id}`,operationKey:step.operationKey,wireRequestHash:hash(body),wireRequestBytes:Buffer.byteLength(body),providerModelId:'openai/inert',maximumOutputTokens:100,accounting:{kind:'r05'}}};},dispatch:async(_call,c)=>{posts++;if(loseResponse)throw Error('synthetic transport response lost');return{outcome:'accepted',result:{inert:true},checkedArtifacts:c.attempt.dependencyPins,settlement:{actualMicrounits:'1',providerRequestId:'gen-inert',receiptHash:'d'.repeat(64)}};},reconcile:async()=>({status:'unknown'})}]));
 return{store,snapshot,projection,events,attempt,old,run:()=>driveQuestOnce(store,{adapters}),posts:()=>posts,stale:()=>{stale=true;},loseResponse:()=>{loseResponse=true;}};
}
test('old successful phases and completed head cannot finish or skip a new adaptive action',async()=>{const f=fixture();assert.equal((await f.run()).reason,'scheduled');const event=f.events.find(e=>e.op==='schedule');assert.equal(event.payload.stepKey,'search1');assert.equal(event.payload.actionHash,f.projection.actionHash);assert.equal(event.payload.actionOrdinal,1);assert.ok(!f.events.some(e=>['evaluate','adaptive_complete_action'].includes(e.op)));assert.equal(f.posts(),0);});
test('only exact immutable imported dependency receipts can satisfy omitted phases',async()=>{for(const mutate of[f=>f.projection.reused[0].resultHash='0'.repeat(64),f=>f.projection.reused[0].attemptId=id(999),f=>f.projection.reused[0].stepKey='review']){const f=fixture();mutate(f);await assert.rejects(f.run(),/projection_unverified/);assert.equal(f.posts(),0);assert.ok(!f.events.some(e=>e.op==='schedule'));}const f=fixture();await f.run();assert.deepEqual(f.snapshot.attempts.at(-1).dependencyPins,f.projection.reused);});
test('one current phase reserves then sends exactly once; restart projects response instead of resending',async()=>{const f=fixture();assert.equal((await f.run()).reason,'scheduled');assert.equal((await f.run()).reason,'reserved');assert.equal((await f.run()).reason,'response_persisted');assert.equal(f.posts(),1);assert.equal((await f.run()).reason,'response_projected');assert.equal(f.posts(),1);assert.equal(f.events.filter(e=>e.op==='dispatch').length,1);});
test('lost response leaves dispatch marker and requires trusted readback without retry',async()=>{const f=fixture();await f.run();await f.run();f.loseResponse();await assert.rejects(f.run(),/response lost/);assert.equal((await f.run()).reason,'trusted_readback_required');assert.equal((await f.run()).reason,'trusted_readback_required');assert.equal(f.posts(),1);});
test('foreign phase IDs fail structural projection before any adapter call',async()=>{for(const mutate of[f=>f.projection.attemptIds=[id(999)],f=>f.projection.attemptIds=[f.old[0].id]]){const f=fixture();mutate(f);await assert.rejects(f.run(),/projection_unverified/);assert.equal(f.posts(),0);}});
test('SQL action freshness rejection prevents transport after preparation',async()=>{const f=fixture();await f.run();await f.run();f.stale();await assert.rejects(f.run(),/sql_adaptive_action_changed/);assert.equal(f.posts(),0);});
test('all current action phases close the action without evaluating or completing the Goal',async()=>{const f=fixture();for(const[key,i]of f.projection.phaseKeys.map((k,i)=>[k,i])){const a=f.attempt(key,300+i);Object.assign(a,{adaptiveActionHash:f.projection.actionHash,adaptiveActionOrdinal:1});f.snapshot.attempts.push(a);f.projection.attemptIds.push(a.id);}const result=await f.run();assert.deepEqual(result,{status:'progress',reason:'adaptive_action_closed'});assert.ok(f.events.some(e=>e.op==='adaptive_complete_action'));assert.ok(!f.events.some(e=>e.op==='evaluate'));assert.equal(f.posts(),0);});
test('same-phase historical or foreign action attempt cannot enter the current projection',async()=>{for(const mutate of[f=>f.projection.attemptIds=[f.old[1].id],f=>f.snapshot.attempts.at(-1).adaptiveActionHash='0'.repeat(64),f=>f.snapshot.attempts.at(-1).adaptiveActionOrdinal=0]){const f=fixture();await f.run();mutate(f);await assert.rejects(f.run(),/projection_unverified/);assert.equal(f.posts(),0);assert.ok(!f.events.some(e=>e.op==='reserve'));}});
