import test from 'node:test';
import assert from 'node:assert/strict';
import { discoveryV2Hash } from '../.core-tests/products/discovery-v2.js';
import { validateOwnerResearchProfile, selectOwnerResearchPublicScope, validateDiscoveryOwnerInitialScope } from '../.core-tests/products/discovery-r12-goal-scope.js';
import { prepareOwnerResearchPreview, prepareOwnerResearchEpisodePreview, validateOwnerResearchPreparationInput, validateOwnerResearchQuote, ownerResearchExecutionIntent } from '../.core-tests/products/discovery-r12-goal-preparation-contract.js';
import { ownerGoalFixture, ownerGoalId } from './helpers/r12-owner-goal-fixture.mjs';

test('owner preparation preserves the real Goal and all cumulative funding while returning no authority',()=>{
  const f=ownerGoalFixture(),before=structuredClone(f.current),p=prepareOwnerResearchPreview(f.input,f.current,f.now);
  assert.equal(p.objective,f.current.goal.content.objective);assert.deepEqual(p.funding,f.current.funding);
  assert.equal(p.finance.businessCommittedMicrounits,'4800000');assert.equal(p.finance.minimumBusinessLimitMicrounits,'5206736');
  assert.equal(p.finance.proposedBusinessLimitMicrounits,'6000000');assert.equal(p.finance.changesBusinessLimit,true);
  assert.equal(p.authorityCreated,false);assert.equal(p.maximumCalls,5);assert.equal(p.maximumRepairs,0);assert.deepEqual(f.current,before);
  const intent=ownerResearchExecutionIntent(p,f.scope.id,f.scope.expiresAt);
  assert.equal(intent.limits.maximumMicrousd,406736);assert.ok(Number(p.finance.businessCommittedMicrounits)>2000000);
  assert.deepEqual(validateDiscoveryOwnerInitialScope(f.scope,f.now),f.scope);
});

test('reviewed public selections never interpolate private Goal prose',()=>{
  const f=ownerGoalFixture();f.current.goal.content.objective='Choose original apparel for my private unpublished Business strategy and annual product roadmap.';
  const p=prepareOwnerResearchPreview(f.input,f.current,f.now);
  assert.equal(p.approvedQuery,f.preview.approvedQuery);assert.doesNotMatch(p.approvedQuery,/private|unpublished|roadmap/);
  assert.throws(()=>selectOwnerResearchPublicScope(f.profile,{marketSetKey:'gb',topicKey:'gardening',goal:f.current.goal.content.objective},f.now));
  assert.throws(()=>selectOwnerResearchPublicScope(f.profile,{marketSetKey:'gb',topicKey:'unreviewed_topic'},f.now));
});

test('different supported subjects and market choices reuse configuration without a store or theme-specific path',()=>{
  const f=ownerGoalFixture(),selected=selectOwnerResearchPublicScope(f.profile,{marketSetKey:'us-gb',topicKey:'astronomy'},f.now);
  assert.deepEqual(selected.markets.map(m=>m.countryCode),['US','GB']);assert.match(selected.approvedQuery,/astronomy/);assert.doesNotMatch(selected.approvedQuery,/nature|gardening/);
  assert.notEqual(selected.approvedQuery,f.preview.approvedQuery);
});

test('a second genuine Goal retains funding and requires an explicit cumulative extension',()=>{
  const f=ownerGoalFixture();f.input.goalId=ownerGoalId(22);f.current.goal.id=f.input.goalId;
  f.current.goal.content.objective='Investigate a different original POD T-shirt opportunity for adult astronomy enthusiasts.';
  f.current.funding.committedMicrounits='1900000';
  assert.throws(()=>prepareOwnerResearchPreview(f.input,f.current,f.now),/funding_limit_exceeded/);
  f.input.researchLifetimeLimitMicrounits='2500000';const p=prepareOwnerResearchPreview(f.input,f.current,f.now);
  assert.equal(p.funding.maximumMicrounits,'2000000');assert.equal(p.funding.committedMicrounits,'1900000');assert.equal(p.finance.proposedResearchLimitMicrounits,'2500000');
  assert.equal(p.finance.changesResearchLimit,true);assert.equal(p.funding.binding.authorityRootId,f.scope.funding.authorityRootId);
});

test('native Business funding uses its real R05 root and no second artificial research ceiling',()=>{
  const f=ownerGoalFixture();f.current.funding={...f.current.funding,binding:{kind:'r05_business',bindingId:ownerGoalId(6),authorityRootId:f.input.businessId,priorRoundId:null,originalSemanticGoalHash:null},
    maximumMicrounits:'5000000',committedMicrounits:'4800000'};
  f.input.researchLifetimeLimitMicrounits='6000000';const p=prepareOwnerResearchPreview(f.input,f.current,f.now);assert.equal(p.funding.binding.priorRoundId,null);
  f.input.researchLifetimeLimitMicrounits='7000000';assert.throws(()=>prepareOwnerResearchPreview(f.input,f.current,f.now),/native_business_funding_mismatch/);
});

for(const [name,change] of [
  ['quote supplied by browser',f=>f.input.quote=f.current.quote],['operation supplied by browser',f=>f.input.operationKey='research.any'],
  ['Goal revision changed',f=>f.current.goal.revision++],['Business substitution',f=>f.current.business.id=ownerGoalId(90)],
  ['already used initial Goal',f=>f.current.goal.initialRunExists=true],['paused Business',f=>f.current.business.paused=true],
  ['unresolved Business charge',f=>f.current.business.hasUnknown=true],['pending root charge',f=>f.current.funding.pendingMicrounits='1'],
  ['unresolved root charge',f=>f.current.funding.hasUnknown=true],['insufficient Business ceiling',f=>f.input.businessLifetimeLimitMicrounits='5000000'],
  ['changed profile',f=>f.profile.title+=' changed'],['expired quote',f=>f.now=Date.parse(f.current.quote.validUntil)],
  ['quote total changed',f=>f.current.quote.maximumMicrousd++],['missing phase',f=>delete f.current.quote.ceilings.review],
  ['insufficient profile ceiling',f=>{f.profile.maximumRunMicrousd=1;f.input.profileHash=discoveryV2Hash(f.profile);}],
])test(`owner preparation rejects ${name}`,()=>{const f=ownerGoalFixture();change(f);assert.throws(()=>prepareOwnerResearchPreview(f.input,f.current,f.now));});

for(const [name,change] of [
  ['restricted source',f=>f.profile.allowedDomains=['etsy.com']],['unreviewed source',f=>f.profile.sourceReviews=[]],
  ['private template placeholder',f=>f.profile.queryTemplate+=' {{goal}}'],['duplicate market',f=>f.profile.marketSets[0].markets.push(f.profile.marketSets[0].markets[0])],
  ['unknown public topic',f=>f.scope.selection.topicKey='other'],['different public query',f=>f.scope.approvedQuery+=' changed'],
  ['profile expired',f=>f.now=Date.parse(f.profile.validUntil)],['source expiry extended',f=>f.scope.expiresAt=new Date(f.now+2*86400000).toISOString()],
  ['wider intent source',f=>f.scope.intent.comparisonUniverse.sourceDomains.push('other.example')],['wider call count',f=>f.scope.intent.limits.maximumNewCollections=2],
  ['funding revision missing',f=>delete f.scope.fundingApproval.revision],['funding pin missing',f=>delete f.scope.fundingApproval.hash],
])test(`owner scope rejects ${name}`,()=>{const f=ownerGoalFixture();change(f);assert.throws(()=>validateDiscoveryOwnerInitialScope(f.scope,f.now));});

test('profile and quote validation are inert and retain input bytes',()=>{
  const f=ownerGoalFixture(),p=JSON.stringify(f.profile),q=JSON.stringify(f.current.quote),i=JSON.stringify(f.input);
  validateOwnerResearchProfile(f.profile,f.now);validateOwnerResearchQuote(f.current.quote,f.now);validateOwnerResearchPreparationInput(f.input);
  assert.equal(JSON.stringify(f.profile),p);assert.equal(JSON.stringify(f.current.quote),q);assert.equal(JSON.stringify(f.input),i);
});

function episodeFixture() {
  const f=ownerGoalFixture();
  const closure={version:'r12.owner-episode-closure.1',businessId:f.input.businessId,goalId:f.input.goalId,
    predecessorPlanId:ownerGoalId(30),predecessorPlanHash:'7'.repeat(64),predecessorPlanVersion:1,
    predecessorScopeId:f.scope.id,predecessorScopeHash:discoveryV2Hash(f.scope),goalRevision:f.current.goal.revision,goalHash:f.current.goal.hash,
    businessRevision:f.current.business.revision,businessHash:f.current.business.hash,authorityRootId:f.current.funding.binding.authorityRootId,
    priorRoundId:f.current.funding.binding.priorRoundId,originalSemanticGoalHash:f.current.funding.binding.originalSemanticGoalHash,
    headRevision:7,headState:'completed',headReason:'bounded episode closed',baseChildren:5,baseDispatches:5,baseRepairs:0,basePivots:0,
    baseKnownMicrounits:'190000',historyHash:'8'.repeat(64)};
  f.current.goal.initialRunExists=true;
  f.current.goal.continuation={eligible:true,reason:null,predecessorClosure:closure,predecessorClosureHash:discoveryV2Hash(closure)};
  f.current.continuationBounds={maximumEpisodes:3,maximumAllocationMicrounits:'1000000',expiresAt:new Date(f.now+3600000).toISOString()};
  Object.assign(f.input,{predecessorPlanId:closure.predecessorPlanId,predecessorPlanHash:closure.predecessorPlanHash,
    predecessorScopeId:closure.predecessorScopeId,predecessorScopeHash:closure.predecessorScopeHash});
  return f;
}

test('continuation prepares the same saved Goal only from a valid exact closed predecessor',()=>{
  const f=episodeFixture(),before=structuredClone(f.current);
  const result=prepareOwnerResearchEpisodePreview(f.input,f.current,f.now);
  assert.equal(result.preview.objective,f.current.goal.content.objective);
  assert.equal(result.closureHash,f.current.goal.continuation.predecessorClosureHash);
  assert.deepEqual(f.current,before);
  assert.throws(()=>prepareOwnerResearchPreview(f.input,f.current,f.now),'Initial preparation remains closed');
});

for(const [name,change] of [
  ['missing closure',f=>{f.current.goal.continuation.predecessorClosure=null;}],
  ['forged closure hash',f=>{f.current.goal.continuation.predecessorClosureHash='0'.repeat(64);}],
  ['stale Goal',f=>{f.current.goal.revision++;f.input.goalRevision++;}],
  ['stale Business',f=>{f.current.business.revision++;}],
  ['wrong predecessor',f=>{f.input.predecessorPlanId=ownerGoalId(70);}],
  ['wrong funding root',f=>{f.current.funding.binding.authorityRootId=ownerGoalId(71);}],
  ['ineligible continuation',f=>{f.current.goal.continuation.eligible=false;f.current.goal.continuation.reason='head_open';}],
  ['no finite grant',f=>{f.current.continuationBounds=null;}],
  ['expired finite grant',f=>{f.current.continuationBounds.expiresAt=new Date(f.now-1).toISOString();}],
  ['insufficient episode allocation',f=>{f.current.continuationBounds.maximumAllocationMicrounits='1';}],
])test(`continuation rejects ${name}`,()=>{const f=episodeFixture();change(f);assert.throws(()=>prepareOwnerResearchEpisodePreview(f.input,f.current,f.now));});
