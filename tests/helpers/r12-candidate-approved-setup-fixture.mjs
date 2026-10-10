/** Inert login receipt fixture; actual owner-server sidecar approval and verification runtime. */
import {randomUUID} from 'node:crypto';
import {bindDirectHandoffFixture} from './r12-direct-approved-setup-fixture.mjs';
import {candidateOwnerServer} from './r12-candidate-owner-server-fixture.mjs';
import {discoveryV2Hash as hash} from '../../.core-tests/products/discovery-v2-hash.js';
export async function runCandidateApprovedSetup(db,authority,{beforeApproval=null,beforeVerification=null,afterCreate=null,runVerification=null}={}){
 await authority.confirm();const x=await bindDirectHandoffFixture(db,authority),a=await x.prepare();
 const ownerAdapter=candidateOwnerServer(db,a.scope),rendererReview=await ownerAdapter.read();
 const approval={operationId:a.scope.operationId,scopeHash:hash(a.scope),disclosureHash:a.scope.disclosureHash,expectedApprovalRevision:a.scope.approvalRevision,persistentAccessApproved:true,budgetApproved:true,...(rendererReview.status==='legacy'?{}:{rendererReviewHash:rendererReview.reviewHash})};
 if(beforeApproval)await beforeApproval({authority,x,a,ownerAdapter,rendererReview,approval});
 await ownerAdapter.approve(approval);const reserved=await a.admit('create');
 await a.transport('browser.etsy.owner_handoff.create','POST','https://api.steel.dev/v1/sessions');
 if(afterCreate)await afterCreate({authority,x,a,reserved});
 const record=await a.publish();await a.admit('owner_view');const returned=await a.admit('owner_return');
 await x.server('consume',{record,owner:a.owner,action:'return',permit:returned});await a.admit('profile_readback');
 await a.transport('browser.etsy.profile.readback','GET','https://api.steel.dev/v1/profiles/'+a.profileId);
 const accept=await a.admit('accept_profile'),body={version:'etsy.steel-profile-candidate.1',handoffId:a.handoffId,scopeHash:hash(a.scope),
  ...Object.fromEntries(['ownerId','businessId','testEnvelopeId','testEnvelopeHash','accountId','accountRevision','expectedShopName','expectedShopId','approvalId','approvalRevision','purpose','providerProjectId'].map(k=>[k,a.scope[k]])),
  profileId:a.profileId,sourceSessionId:a.scope.operationId,expiresAt:a.scope.profileAccessExpiresAt,accountIdentityVerified:false,insightsAccessVerified:false,reuseRequiresFreshAuthority:true};
 const candidate={...body,candidateHash:hash(body)},saved=await x.server('candidate',{candidate,permit:accept});
 const receiptBody={version:'etsy.steel-owner-handoff-receipt.1',operationId:a.scope.operationId,scopeHash:hash(a.scope),handoffId:a.handoffId,
  status:'profile_pending_verification',reason:'separate_account_and_insights_verification_required',releaseState:'verified',liabilityState:'receipt_required',
  reservationId:reserved.reservationId,reservationHash:reserved.reservationHash,profileBindingId:saved.bindingId,profileBindingRevision:saved.revision,accountIdentityVerified:false,insightsAccessVerified:false};
 const receipt={...receiptBody,receiptHash:hash(receiptBody)};await x.server('receipt',{receipt});
 async function finishAccounting(operationId,receipt){
  const session=await x.ledger(operationId,'bind_session',{sessionId:operationId,providerProjectId:a.scope.providerProjectId,providerAccountHash:hash({account:'inert'})});
  const providerReadbackHash=hash({operationId,providerStatus:'released',durationMs:1000});
  const release=await x.ledger(operationId,'evidence',{kind:'release',providerRecordId:randomUUID(),content:{operationId,sessionId:operationId,providerProjectId:a.scope.providerProjectId,terminal:true,observersDisposed:true,providerStatus:'released',providerReadbackHash,disposalProofHash:hash({operationId,disposed:true})}});
  await x.ledger(operationId,'receipt',receipt);
  const usage=await x.ledger(operationId,'evidence',{kind:'usage_bound',providerRecordId:randomUUID(),content:{operationId,sessionId:operationId,providerProjectId:a.scope.providerProjectId,usageIdentityHash:session.usageIdentityHash,tariffHash:authority.tariffHash,qualificationHash:authority.qualificationHash,withinQualifiedLimits:true,maximumMicrounits:'1000',requestedTimeoutMs:60000,providerTimeoutMs:60000,durationMs:1000,proxyBytesUsed:0,proxySource:null,solveCaptcha:false,extraServicesDisabled:true,providerReadbackHash}});
  const accounting=await x.ledger(operationId,'reconcile',{releaseProofHash:release.evidenceHash,usageProofHash:usage.evidenceHash,billingProofHash:null});
  return {release,accounting:accounting.accounting};
 }
 const setupAccounting=await finishAccounting(a.scope.operationId,receipt);
 await x.server('cleanup_complete',{operationId:a.scope.operationId,releaseEvidenceHash:setupAccounting.release.evidenceHash},'cleanup');
 if(beforeVerification)await beforeVerification({authority,x,a,record,candidate,receipt,saved,setupAccounting});
 if(runVerification)return runVerification({authority,x,a,record,candidate,receipt,saved,setupAccounting,ownerAdapter,rendererReview});
 throw Error('Candidate fixture requires the genuine verification runtime');
}
