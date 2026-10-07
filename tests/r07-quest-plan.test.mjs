import test from 'node:test';
import assert from 'node:assert/strict';
import {compileQuestPlan,questFingerprint} from '../.core-tests/core/quest-plan.js';
import {driveQuestOnce,PRODUCTION_QUEST_ADAPTERS} from '../.core-tests/core/quest-controller.js';
const id=n=>`97070000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export function fixture(){
 const p={format:'r07.1',businessId:id(1),goalId:id(2),goalRevision:2,goalHash:'a'.repeat(64),businessRevision:1,businessHash:'b'.repeat(64),policyId:id(3),policyHash:'c'.repeat(64),authorityRootId:id(1),plannerWorkerDefinitionId:id(4),currency:'USD',maximumMicrounits:'900',deadline:'2027-01-01T00:00:00Z',expiresAt:'2027-01-01T00:00:00Z',maximumRepairs:3,maximumPivots:2,maximumChildren:12,maximumDispatches:10,requiredChecks:['challenge'],finishCondition:'all_required_outputs_verified',stopConditions:['no_permitted_work','deadline','repair_exhausted','owner_stopped'],steps:[]};
 for(const [i,key] of ['research','challenge','work'].entries())p.steps.push({key,kind:key,objective:'Finite objective',reason:'Fresh useful evidence',adapter:`fixture.${key}`,qualificationHash:'d'.repeat(64),installationId:id(10),packSnapshotHash:'e'.repeat(64),workflowDefinitionId:id(11),workerDefinitionId:id(20+i),role:key,operationKey:'research.model',purpose:'Research planning',dependsOn:i===0?[]:i===1?['research']:['challenge','research'],expectedArtifactType:`r07.${key}`,maximumMicrounits:'300',expiresAt:p.expiresAt,notBefore:'2026-10-01T00:00:00Z',measurement:null,maximumRepairs:2});
 return p;
}
test('R07 compiler is side-effect-free, detached and deterministic',()=>{
 const input=fixture(),compiled=compileQuestPlan(input);assert.deepEqual(compiled,input);assert.notEqual(compiled,input);
 input.steps[0].objective='changed';assert.notEqual(compiled.steps[0].objective,input.steps[0].objective);
 assert.equal(questFingerprint({a:1,b:2}),questFingerprint({b:2,a:1}));
});
for(const [name,change] of [
 ['missing field',p=>delete p.policyHash],['unknown field',p=>p.authorized=true],['no parent',p=>p.authorityRootId=id(99)],['foreign currency',p=>p.currency='NZD'],['float money',p=>p.maximumMicrounits='1.5'],['unsafe number',p=>p.maximumMicrounits='9007199254740992'],['negative money',p=>p.maximumMicrounits='-1'],['numeric money',p=>p.maximumMicrounits=900],['reset revision',p=>p.goalRevision=0],['unbounded repairs',p=>p.maximumRepairs=9],['unbounded pivots',p=>p.maximumPivots=4],['unbounded children',p=>p.maximumChildren=33],['unbounded dispatch',p=>p.maximumDispatches=65],['blank purpose',p=>p.steps[0].purpose=''],['timezone absent',p=>p.steps[0].notBefore='2026-10-01'],['wider expiry',p=>p.steps[0].expiresAt='2028-01-01T00:00:00Z'],['zero step cap',p=>p.steps[0].maximumMicrounits='0'],['over budget',p=>p.steps[0].maximumMicrounits='301'],['duplicate key',p=>p.steps[1].key='research'],['cycle',p=>p.steps[0].dependsOn=['work']],['duplicate dependency',p=>p.steps[1].dependsOn=['research','research']],['work before research',p=>p.steps[0].kind='work'],['missing challenge',p=>p.steps[1].kind='work'],['unreviewed work',p=>p.steps[2].dependsOn=['research']],['self review',p=>p.steps[1].workerDefinitionId=p.steps[0].workerDefinitionId],['planner self review',p=>p.steps[1].workerDefinitionId=p.plannerWorkerDefinitionId],['missing check',p=>p.requiredChecks=[]],['invalid check',p=>p.requiredChecks=['research']],['duplicate check',p=>p.requiredChecks=['challenge','challenge']],['unstated finish',p=>p.finishCondition='profit'],['unstated stop',p=>p.stopConditions=[]],['unbounded step repair',p=>p.steps[0].maximumRepairs=4],['missing measurement',p=>p.steps[2].kind='measure'],['secret content',p=>p.steps[0].objective='password: abcdefghijklmnop'],
])test(`R07 compiler rejects ${name}`,()=>assert.throws(()=>{const p=fixture();change(p);compileQuestPlan(p);},/r07_/));
test('R07 measurement is explicit, bounded and never equated to profit',()=>{
 const p=fixture();p.steps[2].kind='measure';p.steps[2].measurement={minimumObservations:25,closesAt:'2026-11-01T00:00:00Z'};assert.equal(compileQuestPlan(p).steps[2].measurement.minimumObservations,25);
 p.steps[2].measurement.closesAt='2028-01-01T00:00:00Z';assert.throws(()=>compileQuestPlan(p),/invalid_measurement/);
});
test('R07 default adapter registry has no production path or side effect',async()=>{
 const plan=fixture();let calls=0;
 const snapshot={businessId:plan.businessId,goalId:plan.goalId,planId:id(90),version:1,planHash:'a'.repeat(64),plan,head:{state:'ready'},attempts:[],reused:[]};
 const result=await driveQuestOnce({read:async()=>snapshot,command:async(op)=>{calls++;assert.equal(op,'claim');return {epoch:1};}});
 assert.deepEqual(PRODUCTION_QUEST_ADAPTERS,{});assert.equal(result.reason,'adapter_implementation_unavailable');assert.equal(calls,1);
});

function focusedPilot(){
 const p=fixture();p.format='r12.discovery-pilot.1';p.discoveryScopeId=id(100);p.discoveryScopeHash='f'.repeat(64);
 p.maximumRepairs=0;p.maximumPivots=0;p.maximumChildren=2;p.maximumDispatches=2;p.requiredChecks=['review'];
 p.steps=p.steps.slice(0,2).map((s,i)=>{const key=i?'review':'strategy';return{...s,key,kind:i?'review':'work',role:key,
  adapter:`r12.discovery.${p.discoveryScopeId}.${key}`,operationKey:`research.r12.${p.discoveryScopeId}.${key}`,
  expectedArtifactType:`r12.discovery.${key}`,dependsOn:i?['strategy']:[],maximumRepairs:0};});return p;
}
test('Focused pilot compiles only its two independent analysis effects, without inherited children',()=>{
 const p=focusedPilot();assert.deepEqual(compileQuestPlan(p),p);assert.equal(p.steps.length,2);
 assert.deepEqual(p.steps[0].dependsOn,[]);assert.deepEqual(p.steps[1].dependsOn,['strategy']);
});
for(const [name,change] of [
 ['extra dispatch',p=>p.maximumDispatches=3],['extra child',p=>p.maximumChildren=3],
 ['repair permission',p=>p.maximumRepairs=1],['pivot permission',p=>p.maximumPivots=1],
 ['old dependency reuse',p=>p.steps[0].dependsOn=['plan','search1','select1']],
 ['unreviewed strategy',p=>p.steps[1].dependsOn=[]],['same reviewer',p=>p.steps[1].workerDefinitionId=p.steps[0].workerDefinitionId],
 ['old evidence format',p=>p.format='r12.discovery-evidence.1'],
])test(`Focused pilot rejects ${name}`,()=>{const p=focusedPilot();change(p);assert.throws(()=>compileQuestPlan(p),/r07_/);});
