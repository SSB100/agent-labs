import {discoveryV2Hash as hash} from '../../.core-tests/products/discovery-v2.js';
import {id} from './r12-adaptive-fixture.mjs';
export function fundingProofFixture(scope,preview,currentRevision=null){
 const f=preview.funding,ownerId=id(950),policyId=id(41);
 const increased=f.currentLimitMicrounits!==f.proposedLimitMicrounits;
 const approvalRevision=increased?{bindingId:scope.funding.bindingId,revision:f.revision+1,previousHash:f.bindingHash,
  previousMaximumMicrounits:f.currentLimitMicrounits,maximumMicrounits:f.proposedLimitMicrounits,committedMicrounits:f.committedMicrounits,policyId,ownerId}:currentRevision;
 scope.fundingApproval={revision:f.revision+(increased?1:0),maximumMicrounits:f.proposedLimitMicrounits,
  hash:approvalRevision?hash(approvalRevision):f.bindingHash};
 const body={version:'r12.adaptive-funding-proof.1',businessId:scope.businessId,scopeId:scope.id,scopeHash:hash(scope),setupId:scope.setupId,setupHash:scope.setupHash,bindingId:scope.funding.bindingId,ownerId,policyId,currentRevision,approvalRevision};
 return {...body,proofHash:hash(body)};
}
export function repinFundingProof(proof,scope){const {proofHash,...body}=proof;void proofHash;body.scopeHash=hash(scope);return {...body,proofHash:hash(body)};}
