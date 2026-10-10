import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/r12-adaptive-inputs-fixture.mjs';
import {id,now} from './helpers/r12-adaptive-fixture.mjs';
import {fundingProofFixture} from './helpers/r12-funding-proof-fixture.mjs';
import {discoveryV2Hash as hash} from '../.core-tests/products/discovery-v2.js';
import {validateAdaptiveFundingProof as check} from '../.core-tests/products/discovery-r12-adaptive-funding-proof.js';
import {validateAdaptiveExecutionScope} from '../.core-tests/products/discovery-r12-adaptive-execution-scope.js';
const resign=p=>{const {proofHash,...body}=p;void proofHash;p.proofHash=hash(body);};
test('legacy increased funding reproduces the chained SQL approval, never compact or absent proof',()=>{
 const {raw:r}=fixture();assert.doesNotThrow(()=>validateAdaptiveExecutionScope(r.scope,r.preview,now,r.fundingProof));
 assert.throws(()=>check(r.scope,r.preview));
 const bad=structuredClone(r.scope);bad.fundingApproval.hash=hash({bindingId:bad.funding.bindingId,revision:1,maximumMicrounits:bad.fundingApproval.maximumMicrounits});
 assert.throws(()=>check(bad,r.preview,r.fundingProof));
});
test('sidecar rewrites cannot change stored approved funding identities even after rehash',()=>{
 for(const mutate of [p=>p.scopeId=id(999),p=>p.scopeHash='a'.repeat(64),p=>p.setupHash='a'.repeat(64),p=>p.setupId=id(999),p=>p.businessId=id(999),p=>p.bindingId=id(999),p=>p.ownerId=id(999),p=>p.policyId=id(999),p=>p.approvalRevision.previousHash='a'.repeat(64),p=>p.approvalRevision.previousMaximumMicrounits='1',p=>p.approvalRevision.committedMicrounits='0',p=>p.approvalRevision.revision=2,p=>p.currentRevision={},p=>p.approvalRevision.extra=true]){
  const {raw:r}=fixture();mutate(r.fundingProof);resign(r.fundingProof);assert.throws(()=>check(r.scope,r.preview,r.fundingProof));
 }
});
test('unchanged legacy positive revision verifies its stored body and cannot be replaced with a compact hash',()=>{
 const {raw:r}=fixture(),prior=r.fundingProof.approvalRevision;
 Object.assign(r.preview.funding,{revision:1,bindingHash:hash(prior),currentLimitMicrounits:prior.maximumMicrounits,proposedLimitMicrounits:prior.maximumMicrounits});
 const proof=fundingProofFixture(r.scope,r.preview,prior);assert.doesNotThrow(()=>check(r.scope,r.preview,proof));
 proof.approvalRevision={...prior,committedMicrounits:'1'};resign(proof);assert.throws(()=>check(r.scope,r.preview,proof));
});
test('native and legacy zero revisions retain compact semantics and reject injected legacy proofs',()=>{
 for(const kind of ['r05_business','legacy_research_root']){
  const {raw:r}=fixture();r.scope.funding.kind=kind;
  if(kind==='legacy_research_root')r.preview.funding.proposedLimitMicrounits=r.preview.funding.currentLimitMicrounits;
  const revision=r.preview.funding.revision+(r.preview.funding.currentLimitMicrounits===r.preview.funding.proposedLimitMicrounits?0:1);
  r.scope.fundingApproval={revision,maximumMicrounits:r.preview.funding.proposedLimitMicrounits,hash:hash({bindingId:r.scope.funding.bindingId,revision,maximumMicrounits:r.preview.funding.proposedLimitMicrounits})};
  assert.doesNotThrow(()=>check(r.scope,r.preview));assert.throws(()=>check(r.scope,r.preview,r.fundingProof));
 }
});
