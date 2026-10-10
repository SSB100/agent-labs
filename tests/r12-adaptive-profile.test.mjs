import test from 'node:test';
import assert from 'node:assert/strict';
import { ownerGoalFixture } from './helpers/r12-owner-goal-fixture.mjs';
import { validateOwnerResearchProfile, validateAdaptiveOwnerResearchProfile, selectOwnerResearchPublicScope, selectAdaptiveOwnerResearchPublicScope } from '../.core-tests/products/discovery-r12-goal-scope.js';

test('a separately reviewed profile version supports the $10 adaptive envelope',()=>{
  const f=ownerGoalFixture(),profile={...f.profile,version:'r12.owner-research-profile.2',maximumRunMicrousd:10000000};
  assert.deepEqual(validateAdaptiveOwnerResearchProfile(profile,f.now),profile);
  const selected=selectAdaptiveOwnerResearchPublicScope(profile,{marketSetKey:f.input.marketSetKey,topicKey:f.input.topicKey},f.now);
  assert.equal(selected.audience,profile.topics[0].audience);assert.deepEqual(selected.allowedDomains,profile.allowedDomains);
});
test('historical profiles keep their original version and $2 structural ceiling',()=>{
  const f=ownerGoalFixture();
  assert.deepEqual(validateOwnerResearchProfile(f.profile,f.now),f.profile);
  assert.throws(()=>validateOwnerResearchProfile({...f.profile,maximumRunMicrousd:10000000},f.now));
  assert.throws(()=>validateAdaptiveOwnerResearchProfile(f.profile,f.now));
  const profile={...f.profile,version:'r12.owner-research-profile.2',maximumRunMicrousd:10000000};
  assert.throws(()=>selectOwnerResearchPublicScope(profile,{marketSetKey:'gb',topicKey:'gardening'},f.now));
});
test('adaptive price approval cannot widen source permission or freshness',()=>{
  for(const mutate of [p=>p.maximumRunMicrousd=10000001,p=>p.sourceReviews=[],p=>p.allowedDomains=['etsy.com'],p=>p.validUntil='2000-01-01T00:00:00Z',p=>p.queryTemplate='{{owner_private_goal}}',p=>p.extraPermission=true]) {
    const f=ownerGoalFixture(),profile={...f.profile,version:'r12.owner-research-profile.2',maximumRunMicrousd:10000000};
    mutate(profile);assert.throws(()=>validateAdaptiveOwnerResearchProfile(profile,f.now));
  }
});

test('V2 can retain four historical domains plus two separately reviewed sources; V1 cannot',()=>{
  const f=ownerGoalFixture(),domains=['a.example','b.example','c.example','d.example','e.example','f.example'];
  const profile={...f.profile,version:'r12.owner-research-profile.2',maximumRunMicrousd:10000000,allowedDomains:domains,
    sourceReviews:domains.map(domain=>({domain,basis:'documented_api_factual_snippets',reviewHash:'a'.repeat(64)}))};
  assert.deepEqual(validateAdaptiveOwnerResearchProfile(profile,f.now).allowedDomains,domains);
  assert.throws(()=>validateOwnerResearchProfile({...profile,version:'r12.owner-research-profile.1',maximumRunMicrousd:2000000},f.now));
  assert.throws(()=>validateAdaptiveOwnerResearchProfile({...profile,sourceReviews:profile.sourceReviews.slice(0,5)},f.now));
  assert.throws(()=>validateAdaptiveOwnerResearchProfile({...profile,allowedDomains:[...domains,'g.example'],sourceReviews:[...profile.sourceReviews,{...profile.sourceReviews[0],domain:'g.example'}]},f.now));
});
