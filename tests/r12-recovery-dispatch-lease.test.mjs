import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {driveQuestOnce} from '../.core-tests/core/quest-controller.js';
import {compileQuestPlan} from '../.core-tests/core/quest-plan.js';

const id=n=>`98120000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const hash=value=>createHash('sha256').update(value).digest('hex');
const start=Date.parse('2026-10-07T00:00:00Z');
const stamp=ms=>new Date(ms).toISOString();
function planFixture(generic=false){
 const plan={format:generic?'r07.1':'r12.discovery-pilot.1',businessId:id(1),goalId:id(2),goalRevision:2,goalHash:'a'.repeat(64),businessRevision:1,businessHash:'b'.repeat(64),policyId:id(3),policyHash:'c'.repeat(64),authorityRootId:id(1),plannerWorkerDefinitionId:id(4),currency:'USD',maximumMicrounits:'900',deadline:'2027-01-01T00:00:00Z',expiresAt:'2027-01-01T00:00:00Z',maximumRepairs:0,maximumPivots:0,maximumChildren:generic?3:2,maximumDispatches:generic?3:2,requiredChecks:[generic?'challenge':'review'],finishCondition:'all_required_outputs_verified',stopConditions:['no_permitted_work','deadline','repair_exhausted','owner_stopped'],steps:[]};
 if(!generic)Object.assign(plan,{discoveryScopeId:id(5),discoveryScopeHash:'f'.repeat(64)});
 for(const [i,key] of (generic?['research','challenge','work']:['strategy','review']).entries()){
  const kind=generic?key:i?'review':'work';
  plan.steps.push({key,kind,objective:'Finite scoped research objective',reason:'Independent bounded research evidence',adapter:generic?`inert.${key}`:`r12.discovery.${plan.discoveryScopeId}.${key}`,qualificationHash:'d'.repeat(64),installationId:id(10),packSnapshotHash:'e'.repeat(64),workflowDefinitionId:id(11),workerDefinitionId:id(20+i),role:key,operationKey:generic?'research.model':`research.r12.${plan.discoveryScopeId}.${key}`,purpose:'Research qualification only',dependsOn:i===0?[]:i===1?[generic?'research':'strategy']:['research','challenge'],expectedArtifactType:generic?`r07.${key}`:`r12.discovery.${key}`,maximumMicrounits:'300',expiresAt:plan.expiresAt,notBefore:stamp(start-1),measurement:null,maximumRepairs:0});
 }
 return compileQuestPlan(plan);
}
function fixture({generic=false,optIn=true,status='reserved',prepareMs=0,renewEpoch,renewReplayed=false,mutate,prepareError,renewError,readMissing=false,dispatchDenied=false}={}){
 const plan=planFixture(generic),step=plan.steps[generic?0:1],events=[];
 const wireBody=JSON.stringify({model:'openai/inert',max_tokens:100,stream:false}),wireHash=hash(wireBody);
 const dependency={id:id(30),stepKey:'strategy',attempt:1,status:'completed',reason:'Verified prior synthetic evidence',inputHash:'1'.repeat(64),dependencyPins:[],repairEvidenceHash:'2'.repeat(64),wireHash:'3'.repeat(64),requestId:id(31),responseHash:'4'.repeat(64)};
 const pending={id:id(40),stepKey:step.key,attempt:1,status,reason:'Exact bounded synthetic attempt',inputHash:'5'.repeat(64),dependencyPins:generic?[]:[{stepKey:'strategy',attemptId:dependency.id,resultHash:dependency.responseHash}],repairEvidenceHash:'6'.repeat(64),wireHash,requestId:id(41),responseHash:null};
 const snapshot={businessId:plan.businessId,goalId:plan.goalId,planId:id(90),version:1,planHash:hash(JSON.stringify(plan)),plan,head:{planId:id(90),revision:1,state:'running',reason:'reserved',epoch:7,leaseExpiresAt:stamp(start+60000),repairsUsed:0,pivotsUsed:0,childrenCreated:2,dispatches:1},attempts:generic?[pending]:[dependency,pending],reused:[],knowledge:{format:'r09.1',businessId:plan.businessId,planId:id(90),pins:[]}};
 let now=start,claims=0,reads=0,posts=0,markers=0;
 const store={...(optIn?{recoveryDispatchLeaseScopeId:plan.discoveryScopeId??id(5)}:{}),
  read:async()=>{events.push('read');reads++;if(reads===3){if(readMissing)return null;mutate?.(snapshot);}return structuredClone(snapshot);},
  command:async(operation,payload,epoch)=>{
   events.push(operation);
   if(operation==='claim'){
    claims++;assert.deepEqual(payload,{seconds:60});assert.equal(epoch,undefined);
    if(claims===2&&renewError)throw Error('synthetic renewal failure');
    if(now>=Date.parse(snapshot.head.leaseExpiresAt))snapshot.head.epoch++;
    if(claims===2&&renewEpoch!==undefined)snapshot.head.epoch=renewEpoch;
    snapshot.head.leaseExpiresAt=stamp(now+60000);
    snapshot.head.revision++;
    return{epoch:snapshot.head.epoch,expiresAt:snapshot.head.leaseExpiresAt,replayed:claims===2&&renewReplayed};
   }
   assert.equal(epoch,7);
   if(operation==='reserve')return{status:'reserved'};
   if(operation==='finish')return{reason:'synthetic_completed'};
   if(operation==='dispatch'){
    assert.deepEqual(payload,{attemptId:pending.id,wireHash});
    assert.ok(Date.parse(snapshot.head.leaseExpiresAt)>now,'Dispatch still requires a current lease');
    if(dispatchDenied)return{shouldDispatch:false,reason:'synthetic_dispatch_denied'};
    markers++;return{shouldDispatch:true};
   }
   assert.ok(['settle','response'].includes(operation));return{};
  }};
 const adapter={qualificationHash:step.qualificationHash,workflowDefinitionId:step.workflowDefinitionId,workerDefinitionId:step.workerDefinitionId,mode:'qualification',
  prepare:async context=>{
   events.push('prepare');assert.ok(Object.isFrozen(context.attempt.dependencyPins));now+=prepareMs;
   if(prepareError)throw Error('synthetic preparation failure');
   return{wire:{url:'https://openrouter.ai/api/v1/chat/completions',method:'POST',body:wireBody},descriptor:{workflowRunId:pending.id,operationKey:step.operationKey,idempotencyKey:`r07:${pending.id}`,providerModelId:'openai/inert',wireRequestHash:wireHash,wireRequestBytes:Buffer.byteLength(wireBody),maximumOutputTokens:100,accounting:{kind:'r05'}}};
  },
  dispatch:async()=>{events.push('transport');posts++;return{outcome:'accepted',result:{synthetic:true},checkedArtifacts:pending.dependencyPins,settlement:{actualMicrounits:'1',providerRequestId:'gen-inert',receiptHash:'7'.repeat(64)}};},
  reconcile:async()=>{events.push('reconcile');return{status:'unknown'};}};
 return{store,snapshot,events,run:()=>driveQuestOnce(store,{adapters:{[step.adapter]:adapter},reconcile:true}),counts:()=>({claims,reads,posts,markers}),now:()=>now};
}

test('Recovery renews once after preparation, keeps epoch, rereads exact pins, then marks and sends',async()=>{
 const f=fixture({prepareMs:59000});
 assert.deepEqual(await f.run(),{status:'progress',reason:'response_persisted'});
 assert.deepEqual(f.events,['read','claim','read','prepare','claim','read','dispatch','transport','settle','response']);
 assert.deepEqual(f.counts(),{claims:2,reads:3,posts:1,markers:1});
 assert.equal(f.snapshot.head.epoch,7);
 assert.equal(f.snapshot.head.revision,3);
 assert.equal(Date.parse(f.snapshot.head.leaseExpiresAt)-f.now(),60000);
});

test('An already expired same-token lease changes epoch and cannot mark or send the prepared call',async()=>{
 const f=fixture({prepareMs:60000});
 await assert.rejects(f.run(),/r07_recovery_lease_epoch_changed/);
 assert.deepEqual(f.counts(),{claims:2,reads:2,posts:0,markers:0});
});
for(const epoch of [0,8,'invalid',null])test(`Recovery rejects renewal epoch ${String(epoch)}`,async()=>{
 const f=fixture({renewEpoch:epoch});await assert.rejects(f.run(),/r07_recovery_lease_epoch_changed/);
 assert.equal(f.counts().posts,0);assert.equal(f.counts().markers,0);
});
test('A replayed claim result cannot renew the prepared dispatch lease',async()=>{
 const f=fixture({renewReplayed:true});await assert.rejects(f.run(),/r07_recovery_lease_unverified/);
 assert.deepEqual(f.counts(),{claims:2,reads:2,posts:0,markers:0});
});

for(const [name,mutate] of [
 ['Business',s=>s.businessId=id(99)],['Goal',s=>s.goalId=id(99)],['plan identity',s=>s.planId=id(99)],
 ['plan hash',s=>s.planHash='0'.repeat(64)],['plan version',s=>s.version++],['plan content',s=>s.plan.steps[1].objective='Changed scoped objective'],
 ['head epoch',s=>s.head.epoch++],['head plan',s=>s.head.planId=id(99)],['head state',s=>s.head.state='stopped'],
 ['unchanged head revision',s=>s.head.revision--],['extra head revision',s=>s.head.revision++],
 ['lease expiry mismatch',s=>s.head.leaseExpiresAt=stamp(start+90000)],
 ['attempt removal',s=>s.attempts.pop()],['attempt status',s=>s.attempts[1].status='dispatched'],
 ['attempt identity',s=>s.attempts[1].id=id(99)],['request identity',s=>s.attempts[1].requestId=id(99)],
 ['input hash',s=>s.attempts[1].inputHash='0'.repeat(64)],['wire hash',s=>s.attempts[1].wireHash='0'.repeat(64)],
 ['dependency pin',s=>s.attempts[1].dependencyPins[0].resultHash='0'.repeat(64)],
 ['dependency result',s=>s.attempts[0].responseHash='0'.repeat(64)],['dependency status',s=>s.attempts[0].status='rejected'],
 ['reused lineage',s=>s.reused.push({stepKey:'strategy',attemptId:id(99),resultHash:'0'.repeat(64)})],
 ['knowledge',s=>s.knowledge.planId=id(99)],
])test(`Recovery rejects ${name} drift before any mark or transport`,async()=>{
 const f=fixture({mutate});await assert.rejects(f.run(),/r07_recovery_dispatch_pins_changed/);
 assert.deepEqual(f.counts(),{claims:2,reads:3,posts:0,markers:0});
});
test('Missing renewed snapshot fails closed',async()=>{
 const f=fixture({readMissing:true});await assert.rejects(f.run(),/r07_recovery_dispatch_pins_changed/);
 assert.equal(f.counts().posts,0);assert.equal(f.counts().markers,0);
});
test('Scoped lease capability cannot enable another pilot or generic plan',async()=>{
 const f=fixture();f.store.recoveryDispatchLeaseScopeId=id(99);
 await assert.rejects(f.run(),/r07_recovery_lease_scope_mismatch/);
 assert.deepEqual(f.events,['read','claim','read']);
 const generic=fixture({generic:true});await assert.rejects(generic.run(),/r07_recovery_lease_scope_mismatch/);
 assert.equal(generic.counts().posts,0);assert.equal(generic.counts().markers,0);
});
test('Generic stores and pilot stores without explicit capability keep the original sequence',async()=>{
 for(const generic of [false,true]){
  const f=fixture({generic,optIn:false});assert.equal((await f.run()).reason,'response_persisted');
  assert.deepEqual(f.events,['read','claim','read','prepare','dispatch','transport','settle','response']);
  assert.deepEqual(f.counts(),{claims:1,reads:2,posts:1,markers:1});
 }
});
test('Scheduling/reservation and receipt reconciliation do not renew a dispatch lease',async()=>{
 const scheduled=fixture({status:'scheduled'});assert.equal((await scheduled.run()).reason,'reserved');
 assert.deepEqual(scheduled.events,['read','claim','read','prepare','reserve']);
 for(const status of ['dispatched','uncertain']){
  const f=fixture({status});assert.equal((await f.run()).reason,'effect_still_uncertain');
  assert.deepEqual(f.events,['read','claim','read','reconcile']);
 }
 const responded=fixture({status:'responded'});assert.equal((await responded.run()).reason,'response_projected');
 assert.deepEqual(responded.events,['read','claim','read','finish']);
});
test('Preparation, renewal and dispatch denial never produce a transport retry',async()=>{
 const preparation=fixture({prepareError:true});await assert.rejects(preparation.run(),/synthetic preparation failure/);
 assert.deepEqual(preparation.counts(),{claims:1,reads:2,posts:0,markers:0});
 const renewal=fixture({renewError:true});await assert.rejects(renewal.run(),/synthetic renewal failure/);
 assert.deepEqual(renewal.counts(),{claims:2,reads:2,posts:0,markers:0});
 const denied=fixture({dispatchDenied:true});assert.equal((await denied.run()).reason,'synthetic_dispatch_denied');
 assert.deepEqual(denied.counts(),{claims:2,reads:3,posts:0,markers:0});
});
