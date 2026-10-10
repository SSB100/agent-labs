import test from 'node:test';
import assert from 'node:assert/strict';
import { compileQuestPlan } from '../.core-tests/core/quest-plan.js';
import { driveQuestOnce } from '../.core-tests/core/quest-controller.js';
import { validateAdaptiveResearchPlan } from '../.core-tests/products/discovery-r12-adaptive-scope.js';
import { fixture, planFixture, now } from './helpers/r12-adaptive-fixture.mjs';

test('adaptive plan has five new reusable slots, shared $10 envelope and cumulative original counters',()=>{
  for(const native of [false,true]) {
    const f=planFixture(fixture(native));
    assert.deepEqual(validateAdaptiveResearchPlan(f.plan,f.preview,f.scope,now),f.plan);
    assert.equal(f.plan.steps.length,5);assert.equal(f.plan.maximumChildren,24);assert.equal(f.plan.maximumDispatches,64);
  }
});
test('new format cannot reset costs or counters, widen the envelope, change pins or lose independent review',()=>{
  for(const mutate of [p=>p.maximumChildren=5,p=>p.maximumDispatches=47,p=>p.maximumMicrounits='10000000',p=>p.maximumRepairs=0,p=>p.maximumPivots=0,
    p=>p.steps[0].maximumMicrounits='10000001',p=>p.goalHash='0'.repeat(64),p=>p.steps[4].workerDefinitionId=p.plannerWorkerDefinitionId,p=>p.requiredChecks=['strategy'],p=>p.discoveryScopeHash='0'.repeat(64)]) {
    const f=planFixture();mutate(f.plan);assert.throws(()=>validateAdaptiveResearchPlan(f.plan,f.preview,f.scope,now));
  }
});
test('legacy formats do not inherit overlapping capability budgets or the adaptive effort limits',()=>{
  for(const format of ['r07.1','r12.discovery.1','r12.discovery-episode.1']) {
    const f=planFixture();f.plan.format=format;assert.throws(()=>compileQuestPlan(f.plan));
  }
  for(const mutate of [p=>p.maximumChildren=33,p=>p.maximumDispatches=65,p=>p.steps.push({...p.steps[0],key:'extra'}),p=>p.steps[2].dependsOn=[]]) {
    const f=planFixture();mutate(f.plan);assert.throws(()=>compileQuestPlan(f.plan));
  }
});
test('static legacy controller cannot accidentally finish or dispatch an adaptive plan',async()=>{
  const f=planFixture();let commands=0;
  const store={read:async()=>({plan:f.plan}),command:async()=>{commands++;throw new Error('must not claim or dispatch');}};
  assert.deepEqual(await driveQuestOnce(store),{status:'blocked',reason:'adaptive_action_runtime_required'});assert.equal(commands,0);
});
