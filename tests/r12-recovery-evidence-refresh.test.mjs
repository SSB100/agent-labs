import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateR12EvidenceRefresh} from '../.core-tests/products/discovery-r12-evidence-refresh.js';
import {discoveryV2Hash as hash} from '../.core-tests/products/discovery-v2.js';
import {discoveryAddendumReferences} from '../.core-tests/products/discovery-r12-evidence-addendum.js';
import {focusedProfileFixture} from './helpers/r12-focused-profile-fixture.mjs';
import {refreshR12ObservationsFixture,r12EvidenceRefreshCertificateFixture} from './helpers/r12-evidence-refresh-fixture.mjs';
const id=n=>`bbbbbbbb-bbbb-4bbb-8bbb-${String(n).padStart(12,'0')}`;
const digest=s=>createHash('sha256').update(s,'utf8').digest('hex');
function fixture(unicode=false){
 const now=Date.parse('2026-10-07T12:00:00.000Z'),old=focusedProfileFixture(),start=new Date(now-1000).toISOString();
 old.createdAt=new Date(now-60000).toISOString();old.expiresAt=new Date(now+7200000).toISOString();
 old.observations.observations.forEach(o=>{o.retrievedAt=new Date(now-120000).toISOString();o.expiresAt=old.expiresAt;});old.observations.observations[0].access='public_search_index';
 if(unicode){const o=old.observations.observations[0];o.context='🍃 Café. Synthetic quoted fact.';o.contentHash=digest(o.context);o.start=2;o.end=Array.from(o.context).length;}
 old.pinnedLearningPlan.evidenceRefs=discoveryAddendumReferences(old.observations);
 const oldEnvelope={id:old.id,businessId:old.businessId,goalId:old.goalId,budgetAuthorityRootId:old.budgetAuthorityRootId,profile:old,profileHash:hash(old),approvalHash:old.observations.approvalHash,independentReviewHash:old.observations.independentReviewHash};
 const oldScope={id:old.id,amendment:oldEnvelope,amendment_hash:hash(oldEnvelope)},profile=structuredClone(old);
 profile.id=id(20);profile.goalId=id(21);profile.createdAt=start;profile.expiresAt=new Date(now+10800000).toISOString();profile.observations.id=id(22);profile.observations.goalId=profile.goalId;profile.observations.createdAt=start;profile.observations.expiresAt=profile.expiresAt;profile.observations.approvalHash=digest('fresh synthetic owner review');
 const review=refreshR12ObservationsFixture(oldScope,profile,start);
 const scope={...oldEnvelope,id:profile.id,goalId:profile.goalId,profile,profileHash:hash(profile),approvalHash:profile.observations.approvalHash,independentReviewHash:review,createdAt:start,expiresAt:profile.expiresAt};
 const certificate=r12EvidenceRefreshCertificateFixture(oldScope,scope,id(23)),pins={businessId:scope.businessId,ownerId:id(23),scopeId:scope.id,goalId:scope.goalId,budgetAuthorityRootId:scope.budgetAuthorityRootId,abandonedScopeId:oldScope.id,abandonedScopeHash:oldScope.amendment_hash,ownerApprovalEvidenceHash:scope.approvalHash,createdAt:scope.createdAt,scope};
 return{now,oldScope,scope,certificate,pins};
}
test('Reviewed refresh binds the complete new bundle and preserves exact Unicode cited bytes',()=>{
 for(const unicode of [false,true]){const f=fixture(unicode),before=structuredClone(f.oldScope);assert.deepEqual(validateR12EvidenceRefresh(f.certificate,f.pins,f.now),f.certificate);assert.deepEqual(f.oldScope,before);assert.equal(f.scope.profile.observations.observations[0].access,'public_document_read');assert.equal(f.scope.profile.observations.observations[0].captureHash,f.oldScope.amendment.profile.observations.observations[0].captureHash);assert.notEqual(f.scope.profile.observations.observations[0].contentHash,f.oldScope.amendment.profile.observations.observations[0].contentHash);for(const [n,pair]of f.certificate.pairs.entries()){const old=f.oldScope.amendment.profile.observations.observations[n],fresh=f.scope.profile.observations.observations[n];assert.equal(Array.from(old.context).slice(old.start,old.end).join(''),Array.from(fresh.context).slice(fresh.start,fresh.end).join(''));assert.notEqual(pair.priorObservationId,pair.refreshedObservationId);assert.equal(pair.factSpanHash,digest(Array.from(old.context).slice(old.start,old.end).join('')));}}
});
test('Refresh certificate rejects wrong complete hashes, review, identities, future times and unbound additions',()=>{
 const mutations=[
  c=>{c.scopeId=id(70);},c=>{c.ownerId=id(70);},c=>{c.goalId=id(70);},c=>{c.businessId=id(70);},c=>{c.budgetAuthorityRootId=id(70);},c=>{c.abandonedScopeId=id(70);},c=>{c.abandonedScopeHash='0'.repeat(64);},
  c=>{c.refreshedObservationsHash='0'.repeat(64);},c=>{c.refreshedAddendumHash='0'.repeat(64);},c=>{c.refreshedEvidenceRefsHash='0'.repeat(64);},
  c=>{c.ownerApprovalEvidenceHash='0'.repeat(64);},c=>{c.independentReviewHash='0'.repeat(64);},c=>{c.reviewedAt='2026-10-07T12:01:00.000Z';},
  c=>{c.pairs[0].pairReviewHash='0'.repeat(64);},c=>{c.pairs[0].refreshedObservationHash='0'.repeat(64);},c=>{c.pairs[0].factSpanHash='0'.repeat(64);},
  c=>{c.pairs.pop();},c=>{c.pairs.push(c.pairs[0]);},c=>{c.unapproved='extra';},c=>{c.pairs[0].unapproved='extra';},
 ];
 for(const mutate of mutations){const f=fixture();mutate(f.certificate);assert.throws(()=>validateR12EvidenceRefresh(f.certificate,f.pins,f.now),/r12_recovery_evidence_refresh_unverified/);}
});
test('Certificate pair review is tied to scope, both complete observations, cited span and independent review time',()=>{
 const f=fixture(),pair=f.certificate.pairs[0];
 assert.equal(pair.pairReviewHash,hash({version:'r12.focused-pilot-evidence-pair-review.1',scopeId:f.certificate.scopeId,priorObservationHash:pair.priorObservationHash,refreshedObservationHash:pair.refreshedObservationHash,factSpanHash:pair.factSpanHash,independentReviewHash:f.certificate.independentReviewHash,reviewedAt:f.certificate.reviewedAt}));
 for(const field of ['scopeId','priorObservationHash','refreshedObservationHash','factSpanHash','independentReviewHash','reviewedAt']){const bad=structuredClone(f.certificate);if(field in bad.pairs[0])bad.pairs[0][field]='0'.repeat(64);else bad[field]=field==='reviewedAt'?'2026-10-07T11:59:58.000Z':id(70);assert.throws(()=>validateR12EvidenceRefresh(bad,f.pins,f.now));}
});
test('Current profile cannot silently substitute an observation, citation, source review or approval container',()=>{
 for(const edit of [s=>s.profile.observations.observations[0].url+='?different',s=>s.profile.observations.observations[0].context+=' changed',s=>s.profile.observations.observations[0].sourceReviewHash='0'.repeat(64),s=>s.profile.pinnedLearningPlan.evidenceRefs.reverse(),s=>s.profile.observations.approvalHash='0'.repeat(64),s=>s.profile.observations.independentReviewHash='0'.repeat(64)]){const f=fixture();edit(f.scope);assert.throws(()=>validateR12EvidenceRefresh(f.certificate,f.pins,f.now));}
});

test('Refresh certificate size stays bounded even for a parseable long review timestamp',()=>{
 const f=fixture();f.certificate.reviewedAt='Wed, 07 Oct 2026 11:59:59 GMT'+' '.repeat(9000);assert.equal(Date.parse(f.certificate.reviewedAt),Date.parse(f.scope.createdAt));
 for(const pair of f.certificate.pairs)pair.pairReviewHash=hash({version:'r12.focused-pilot-evidence-pair-review.1',scopeId:f.certificate.scopeId,priorObservationHash:pair.priorObservationHash,refreshedObservationHash:pair.refreshedObservationHash,factSpanHash:pair.factSpanHash,independentReviewHash:f.certificate.independentReviewHash,reviewedAt:f.certificate.reviewedAt});
 assert.ok(Buffer.byteLength(JSON.stringify(f.certificate),'utf8')>8192);assert.throws(()=>validateR12EvidenceRefresh(f.certificate,f.pins,f.now));
});
