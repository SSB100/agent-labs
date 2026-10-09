import test from 'node:test';
import assert from 'node:assert/strict';
import {ownerGoalFixture,ownerGoalId as id} from './helpers/r12-owner-goal-fixture.mjs';
import {discoveryV2Hash} from '../.core-tests/products/discovery-v2.js';
import {compileQuestPlan} from '../.core-tests/core/quest-plan.js';
import {validateOwnerEpisodeClosure,validateDiscoveryOwnerEpisodeScope,validateOwnerEpisodePlan} from '../.core-tests/products/discovery-r12-owner-episode.js';
import {validateDiscoveryOwnerInitialScope} from '../.core-tests/products/discovery-r12-goal-scope.js';

// Synthetic contract data only. SQL integration independently proves genuine
// predecessor history, grants, final costs and atomic activation.
function fixture(native=false){
 const f=ownerGoalFixture(),s=f.scope;
 if(native)s.funding={kind:'r05_business',bindingId:id(6),authorityRootId:s.businessId,priorRoundId:null,originalSemanticGoalHash:null};
 const closure={version:'r12.owner-episode-closure.1',businessId:s.businessId,goalId:s.goalId,
  predecessorPlanId:id(50),predecessorPlanHash:'a'.repeat(64),predecessorPlanVersion:native?1:4,
  predecessorScopeId:id(51),predecessorScopeHash:'b'.repeat(64),goalRevision:s.goalRevision,goalHash:s.goalHash,businessRevision:s.businessRevision,businessHash:s.businessHash,
  authorityRootId:s.funding.authorityRootId,priorRoundId:s.funding.priorRoundId,originalSemanticGoalHash:s.funding.originalSemanticGoalHash,
  headRevision:84,headState:'running',headReason:'phase_completed',baseChildren:native?5:8,baseDispatches:native?5:7,baseRepairs:0,basePivots:0,baseKnownMicrounits:'195052',historyHash:'c'.repeat(64)};
 const scope={...s,version:'r12.discovery-owner-episode.1',episodeNumber:1,predecessorClosure:closure,predecessorClosureHash:discoveryV2Hash(closure)};
 const plan={format:'r12.discovery-episode.1',discoveryScopeId:scope.id,discoveryScopeHash:discoveryV2Hash(scope),businessId:scope.businessId,goalId:scope.goalId,goalRevision:scope.goalRevision,goalHash:scope.goalHash,businessRevision:scope.businessRevision,businessHash:scope.businessHash,policyId:id(60),policyHash:'d'.repeat(64),authorityRootId:scope.businessId,plannerWorkerDefinitionId:id(61),currency:'USD',maximumMicrounits:String(Number(closure.baseKnownMicrounits)+scope.intent.limits.maximumMicrousd),deadline:scope.expiresAt,expiresAt:scope.expiresAt,maximumRepairs:0,maximumPivots:0,maximumChildren:closure.baseChildren+5,maximumDispatches:closure.baseDispatches+5,requiredChecks:['review'],finishCondition:'all_required_outputs_verified',stopConditions:['no_permitted_work','deadline','repair_exhausted','owner_stopped'],steps:[]};
 const keys=['plan','search1','select1','strategy','review'];
 for(const [i,key]of keys.entries())plan.steps.push({key,kind:key==='search1'?'research':key==='review'?'review':'work',objective:'One bounded fresh research phase',reason:'Separately approved continuation evidence',adapter:`r12.discovery.${scope.id}.${key}`,qualificationHash:'e'.repeat(64),installationId:id(62),packSnapshotHash:'f'.repeat(64),workflowDefinitionId:id(63),workerDefinitionId:id(70+i),role:key,operationKey:`research.r12.${scope.id}.${key}`,purpose:'Original adult apparel research',dependsOn:keys.slice(0,i),expectedArtifactType:`r12.discovery.${key}`,maximumMicrounits:String(f.preview.quote.ceilings[key]),expiresAt:scope.expiresAt,notBefore:scope.createdAt,measurement:null,maximumRepairs:0});
 return{...f,scope,closure,plan};
}

test('episode retains same Goal and original root, with five effects and cumulative limits',()=>{
 for(const native of [false,true]){const f=fixture(native);assert.deepEqual(validateOwnerEpisodeClosure(f.closure),f.closure);assert.deepEqual(validateDiscoveryOwnerEpisodeScope(f.scope,f.now),f.scope);assert.deepEqual(compileQuestPlan(f.plan),f.plan);assert.doesNotThrow(()=>validateOwnerEpisodePlan(f.plan,f.scope));assert.equal(f.plan.steps.filter(s=>s.key==='search1').length,1);assert.throws(()=>validateDiscoveryOwnerInitialScope(f.scope,f.now));}
});
test('episode closure rejects missing identities, altered funding and exhausted lifetime counters',()=>{
 const cases=[v=>delete v.historyHash,v=>v.extraAuthority=true,v=>v.predecessorPlanVersion=0,v=>v.baseChildren=28,v=>v.baseDispatches=60,v=>v.baseKnownMicrounits='-1',v=>v.baseKnownMicrounits='9007199254740992',v=>v.priorRoundId=null,v=>v.originalSemanticGoalHash=null,v=>v.headRevision=-1];
 for(const mutate of cases){const f=fixture();mutate(f.closure);assert.throws(()=>validateOwnerEpisodeClosure(f.closure),/episode_unverified/);}
 const native=fixture(true);native.closure.priorRoundId=id(99);assert.throws(()=>validateOwnerEpisodeClosure(native.closure));
});
test('episode scope binds immutable closure, funding and current owner revisions',()=>{
 for(const mutate of [s=>s.predecessorClosure.historyHash='0'.repeat(64),s=>s.goalId=id(99),s=>s.goalRevision++,s=>s.businessRevision++,s=>s.episodeNumber=6,s=>s.funding.authorityRootId=id(99),s=>s.id=s.predecessorClosure.predecessorScopeId,s=>s.predecessorClosureHash='0'.repeat(64),s=>s.version='r12.discovery-owner-initial.1']){const f=fixture();mutate(f.scope);assert.throws(()=>validateDiscoveryOwnerEpisodeScope(f.scope,f.now));}
});
test('new format cannot reset cumulative plan ceilings or grant extra phase allowance',()=>{
 for(const mutate of [p=>p.maximumChildren=5,p=>p.maximumDispatches=5,p=>p.maximumMicrounits=String(Number(p.maximumMicrounits)-195052),p=>p.maximumMicrounits=String(Number(p.maximumMicrounits)+1),p=>p.steps[0].maximumMicrounits=String(Number(p.steps[0].maximumMicrounits)+1),p=>p.discoveryScopeHash='0'.repeat(64),p=>p.format='r12.discovery.1']){const f=fixture();mutate(f.plan);assert.throws(()=>validateOwnerEpisodePlan(f.plan,f.scope));}
});
test('episode keeps historical topology restrictions and fixed 32/64 ceilings',()=>{
 for(const mutate of [p=>p.maximumChildren=33,p=>p.maximumDispatches=65,p=>p.maximumRepairs=1,p=>p.maximumPivots=1,p=>p.steps.push({...p.steps[0],key:'retry'}),p=>p.steps[4].dependsOn=['strategy'],p=>p.format='r12.discovery.1']){const f=fixture();mutate(f.plan);assert.throws(()=>compileQuestPlan(f.plan),/r07_/);}
});
