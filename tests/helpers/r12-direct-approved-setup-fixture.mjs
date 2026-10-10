/** Actual reviewed test envelope + owner handoff + separately charged verification.
 * Provider callbacks below are inert synthetic qualification, never real access. */
import {randomUUID} from 'node:crypto';
import {one,ownerInitialRpc,ownerInitialRuntimeRpc} from './r12-owner-initial-sql-fixture.mjs';
import {discoveryV2Hash as hash} from '../../.core-tests/products/discovery-v2-hash.js';
export async function bindDirectHandoffFixture(db,authority){
 const x=authority,id=x.prepared.testEnvelopeId,envelope=x.prepared.preview;
 const keys=Object.fromEntries(await Promise.all(['handoff','verification','cleanup','evidence'].map(async p=>[p,await x.key(p)])));
 const server=(operation,payload={},purpose='handoff')=>ownerInitialRuntimeRpc(db,'r12_etsy_steel_server',[x.f.businessId,operation,payload,keys[purpose]??purpose]);
 const owner=(operation,payload,actor=x.f.ownerId)=>ownerInitialRpc(db,actor,'r12_etsy_steel_owner',[x.f.businessId,operation,payload]);
 const ledger=(operationId,operation,payload)=>ownerInitialRuntimeRpc(db,'r12_direct_browser_ledger',[x.f.businessId,operationId,operation,payload,keys.evidence]);
 const verifier=(operation,payload)=>ownerInitialRuntimeRpc(db,'r12_etsy_steel_verification_server',[x.f.businessId,operation,payload,keys.verification]);
 const setupOperation=envelope.setupOperation,verificationOperation=envelope.verificationOperation;
 async function prepare(overrides={}){
  const now=Date.now(),scope={version:'etsy.steel-owner-handoff-scope.1',operationId:randomUUID(),ownerId:x.f.ownerId,businessId:x.f.businessId,
   goalId:x.f.goalId,authorityRootId:envelope.authorityRootId,testEnvelopeId:id,testEnvelopeHash:hash(envelope),providerProjectId:x.project,
   verificationOperationId:randomUUID(),verificationMaximumMicrounits:'1000',verificationQuoteHash:verificationOperation.quoteHash,
   accountId:randomUUID(),accountRevision:randomUUID(),expectedShopName:'InertVisibleShop',expectedShopId:null,purpose:'etsy_insights_read_only',
   approvalId:randomUUID(),approvalRevision:randomUUID(),approvedAt:new Date(now-1000).toISOString(),approvalExpiresAt:new Date(now+900000).toISOString(),
   profileAccessExpiresAt:new Date(Math.min(now+3500000,Date.parse(envelope.expiresAt))).toISOString(),maximumSessionMs:60000,maximumBrowserMicrounits:'1000',currency:'USD',quoteHash:setupOperation.quoteHash,...overrides};
  const disclosure=(await one(db,'select private.r12_etsy_steel_disclosure($1) value',[scope])).value;scope.disclosureHash=hash(disclosure);
  const prepared=await server('prepare',{scope,disclosure});
  const approve=()=>owner('approve',{operationId:scope.operationId,scopeHash:hash(scope),disclosureHash:scope.disclosureHash,expectedApprovalRevision:scope.approvalRevision,persistentAccessApproved:true,budgetApproved:true});
  let reservation=null;const handoffId=randomUUID(),profileId=randomUUID();
  function request(operation){return {version:'etsy.steel-owner-handoff-admission.1',operation,requestId:randomUUID(),scopeHash:hash(scope),
   ...Object.fromEntries(['operationId','ownerId','businessId','authorityRootId','testEnvelopeId','testEnvelopeHash','providerProjectId','accountId','accountRevision','approvalId','approvalRevision','disclosureHash','quoteHash','maximumBrowserMicrounits'].map(k=>[k,scope[k]])),
   handoffId:operation==='create'?null:handoffId,sessionId:operation==='create'?null:scope.operationId,profileId:operation==='create'?null:profileId,
   reservationId:operation==='create'?null:reservation?.reservationId??null,reservationHash:operation==='create'?null:reservation?.reservationHash??null};}
  async function admit(operation){const p=await server('admit',{request:request(operation)});if(operation==='create')reservation=p;return p;}
  const transport=(operation,method,endpoint,purpose='handoff')=>server('transport',{operationId:scope.operationId,request:{provider:'steel',operation,method,endpoint}},purpose);
  async function publish(changes={}){
   const permit=await admit('publish_handoff'),now=Date.now(),body={version:'etsy.steel-owner-handoff-record.1',id:handoffId,scope,scopeHash:hash(scope),
    reservationId:reservation.reservationId,reservationHash:reservation.reservationHash,envelope:'account-v1.inert_abcdefghij.inert_abcdefghijklmn.inert_abcdefghijklmnopqrst',disconnectProof:{version:'etsy.steel-owner-disconnect.1',sessionId:scope.operationId,cdpDisconnected:true,observersDrained:true,inFlightCommandsSettled:true,appCaptureStopped:true,routeHandlersDrained:true,eventListenersRemoved:true},createdAt:new Date(now-100).toISOString(),expiresAt:new Date(Math.min(now+59000,Date.parse(scope.approvalExpiresAt))).toISOString(),...changes};
   const record={...body,recordHash:hash(body)};await server('store',{record,permit});return record;
  }
  return {scope,prepared,approve,request,admit,transport,publish,handoffId,profileId,owner:{ownerId:scope.ownerId,businessId:scope.businessId}};
 }
 return {x,id,envelope,keys,server,owner,ledger,verifier,prepare};
}
export async function runDirectApprovedSetup(db,authority){
 await authority.confirm();const x=await bindDirectHandoffFixture(db,authority),a=await x.prepare();
 await a.approve();const reserved=await a.admit('create');
 await a.transport('browser.etsy.owner_handoff.create','POST','https://api.steel.dev/v1/sessions');
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
 const verificationInputs=await x.verifier('prepare',{setupOperationId:a.scope.operationId}),vs=verificationInputs.scope;
 await x.verifier('admit',{operationId:vs.operationId});await x.verifier('transport',{operationId:vs.operationId,request:{provider:'steel',operation:'browser.etsy.insights.create',method:'POST',endpoint:'https://api.steel.dev/v1/sessions'}});
 const vrBody={version:'etsy.steel-account-verification-receipt.1',operationId:vs.operationId,scopeHash:verificationInputs.scopeHash,status:'verified',releaseState:'verified',liabilityState:'receipt_required'};
 const verificationAccounting=await finishAccounting(vs.operationId,{...vrBody,receiptHash:hash(vrBody)});
 await x.verifier('cleanup_complete',{operationId:vs.operationId,releaseEvidenceHash:verificationAccounting.release.evidenceHash});
 const context={version:'etsy.steel-visible-account-context.1',operationId:vs.operationId,setupOperationId:a.scope.operationId,handoffId:a.handoffId,testEnvelopeId:a.scope.testEnvelopeId,testEnvelopeHash:a.scope.testEnvelopeHash,sessionId:vs.operationId,contextId:randomUUID(),pageId:randomUUID(),providerProjectId:a.scope.providerProjectId,profileId:a.profileId,observedShopName:a.scope.expectedShopName,observedShopId:null,
  profileBindingId:saved.bindingId,profileBindingRevision:saved.revision,documentEpoch:1,canonicalUrl:'https://www.etsy.com/your/shops/me/marketplace-insights',visibleShopHref:'https://www.etsy.com/shop/'+a.scope.expectedShopName+'?ref=seller-platform-mcnav',insightsHeading:'Marketplace Insights',
  queryControlWitnessHash:hash({formAriaLabel:'search bar form',inputAriaLabel:'Input to search for keywords',inputType:'text',buttonName:'Search',buttonType:'submit',formVisible:true,inputVisible:true,inputEnabled:true,buttonVisible:true,buttonEnabled:true}),verifiedAt:new Date(Date.now()-1000).toISOString()};
 const proofBody={version:'etsy.steel-account-verification.1',...Object.fromEntries(Object.entries(context).filter(([key])=>key!=='version')),expiresAt:a.scope.profileAccessExpiresAt,accountIdentityVerified:true,insightsAccessVerified:true,verifiedContextHash:hash(context)};
 const verification={...proofBody,verificationHash:hash(proofBody)},bindingBody={version:'r12.etsy-insights-account-binding.1',
  ...Object.fromEntries(['businessId','goalId','authorityRootId','testEnvelopeId','testEnvelopeHash','purpose','providerProjectId','approvalId','approvalRevision','disclosureHash'].map(k=>[k,a.scope[k]])),
  ...Object.fromEntries(['profileBindingId','profileBindingRevision','verifiedContextHash','observedShopName','observedShopId','verifiedAt','expiresAt'].map(k=>[k,verification[k]])),
  handoffReceiptHash:receipt.receiptHash,profileCandidateHash:candidate.candidateHash,accountVerificationHash:verification.verificationHash};
 const binding={...bindingBody,bindingHash:hash(bindingBody)};
 await x.verifier('verify',{binding,verification});await x.server('resolve',{binding});
 return {f:authority.f,envelope:authority.prepared.preview,accountBinding:binding,bootstrapKey:authority.f.bootstrapKey,setupOperation:a.scope.operationId,verificationOperation:vs.operationId,setupAccounting:setupAccounting.accounting,verificationAccounting:verificationAccounting.accounting,keys:x.keys,server:x.server,verifier:x.verifier,ledger:x.ledger,owner:x.owner,scope:a.scope,profileId:a.profileId};
}
