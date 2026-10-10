import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,id,now} from './helpers/r12-adaptive-fixture.mjs';
import {ownerGoalFixture} from './helpers/r12-owner-goal-fixture.mjs';
import {r12CatalogFixture} from './helpers/r12-provider-fixture.mjs';
import {discoveryV2Hash} from '../.core-tests/products/discovery-v2.js';
import {qualifyAdaptiveResearchQuote} from '../.core-tests/products/discovery-r12-adaptive-quote.js';
import {prepareAdaptiveResearchPreview} from '../.core-tests/products/discovery-r12-adaptive-preparation.js';
function state(native=false) {
  const p=fixture(native),f=ownerGoalFixture(now);
  const profile={...f.profile,id:p.profileId,version:'r12.owner-research-profile.2',maximumRunMicrousd:10000000};
  const profileHash=discoveryV2Hash(profile),quote=qualifyAdaptiveResearchQuote(r12CatalogFixture(now),now);
  const input={businessId:p.businessId,goalId:p.goalId,goalRevision:p.predecessor.goalRevision,profileId:p.profileId,profileHash,grantId:id(80),
    predecessorPlanId:p.predecessor.predecessorPlanId,predecessorPlanHash:p.predecessor.predecessorPlanHash,
    predecessorScopeId:p.predecessor.predecessorScopeId,predecessorScopeHash:p.predecessor.predecessorScopeHash,
    maximumActions:10,maximumRunMicrounits:'10000000',marketSetKey:'gb',topicKey:'gardening',ownerObservationRef:null,
    businessLifetimeLimitMicrounits:p.business.proposedLimitMicrounits,researchLifetimeLimitMicrounits:p.funding.proposedLimitMicrounits,submissionId:id(81)};
  const snapshot={predecessor:p.predecessor,imports:p.imports,profile,quote,
    grant:{id:input.grantId,profileId:p.profileId,businessId:p.businessId,goalId:p.goalId,goalRevision:p.predecessor.goalRevision,goalHash:p.predecessor.goalHash,
      approvalHash:'a'.repeat(64),allowsPaidFollowups:true,maximumActions:10,maximumRunMicrounits:'10000000',remainingScopes:1,remainingAllocationMicrounits:'10000000',expiresAt:p.expiresAt},
    funding:p.funding,business:p.business,deadline:p.expiresAt};
  // Snapshot excludes proposed ceilings; the explicit form carries them.
  delete snapshot.funding.proposedLimitMicrounits;delete snapshot.business.proposedLimitMicrounits;
  return{input,snapshot};
}
test('new reviewed adaptive authority covers $10 without changing old ledger identities',()=>{
  for(const native of [false,true]) {
    const f=state(native),r=prepareAdaptiveResearchPreview(f.input,f.snapshot,now);
    assert.equal(r.preview.maximumRunMicrounits,'10000000');assert.equal(r.preview.maximumPaidCalls,47);
    assert.equal(r.preview.funding.authorityRootId,f.snapshot.predecessor.authorityRootId);
    assert.equal(r.authorityCreated,false);assert.equal(r.preview.authorityCreated,false);
  }
});
test('run approval cannot silently authorize an excessive Business or research lifetime cap',()=>{
  for(const field of ['businessLifetimeLimitMicrounits','researchLifetimeLimitMicrounits']) {
    const f=state();f.input[field]=String(BigInt(f.input[field])+1n);
    assert.throws(()=>prepareAdaptiveResearchPreview(f.input,f.snapshot,now),/preparation_unverified/);
  }
});
test('catalog lineage metadata remains outside the exact financial preview',()=>{
 const f=state();f.snapshot.business.revision=17;f.snapshot.business.hash='d'.repeat(64);
 const r=prepareAdaptiveResearchPreview(f.input,f.snapshot,now);
 assert.deepEqual(Object.keys(r.preview.business).sort(),['capRevision','committedMicrounits','currentLimitMicrounits','hasUnknown','proposedLimitMicrounits']);
 assert.equal(f.snapshot.business.revision,17);assert.equal(f.snapshot.business.hash,'d'.repeat(64));
});
test('consumed, stale, unrelated or retry-forbidden grants never become adaptive authority',()=>{
  for(const mutate of [s=>s.grant.remainingScopes=0,s=>s.grant.remainingAllocationMicrounits='9999999',s=>s.grant.allowsPaidFollowups=false,
    s=>s.grant.goalHash='f'.repeat(64),s=>s.grant.profileId=id(90),s=>s.grant.expiresAt=new Date(now-1).toISOString(),
    s=>s.funding.pendingMicrounits='1',s=>s.business.hasUnknown=true]) {
    const f=state();mutate(f.snapshot);assert.throws(()=>prepareAdaptiveResearchPreview(f.input,f.snapshot,now));
  }
});
