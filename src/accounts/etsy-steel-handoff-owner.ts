import {buildEtsySteelHandoffDisclosure,etsySteelHash,handoffAssert,handoffExact,handoffHash,handoffUuid,validateEtsySteelHandoffScope,type EtsySteelHandoffScope,type EtsySteelHandoffReceipt} from './etsy-steel-handoff-contracts';
export type EtsySteelOwnerView={operationId:string;scope:EtsySteelHandoffScope;scopeHash:string;disclosure:ReturnType<typeof buildEtsySteelHandoffDisclosure>;status:'pending_approval'|'approved'|'expired'|'stopped';cleanupPending:boolean;receipts:EtsySteelHandoffReceipt[]};
export function validateEtsySteelOwnerView(raw:unknown,expected:{ownerId:string;businessId:string;operationId:string}):EtsySteelOwnerView{
 handoffExact(raw,'operationId,scope,scopeHash,disclosure,status,cleanupPending,receipts','handoff_owner_view_invalid');const v=raw as EtsySteelOwnerView,s=validateEtsySteelHandoffScope(v.scope);
 handoffAssert(v.operationId===expected.operationId&&s.operationId===v.operationId&&s.ownerId===expected.ownerId&&s.businessId===expected.businessId&&v.scopeHash===etsySteelHash(s)&&etsySteelHash(v.disclosure)===s.disclosureHash&&['pending_approval','approved','expired','stopped'].includes(v.status)&&typeof v.cleanupPending==='boolean'&&Array.isArray(v.receipts)&&v.receipts.length<=32,'handoff_owner_view_invalid');
 for(const r of v.receipts){
  handoffExact(r,'version,operationId,scopeHash,handoffId,status,reason,releaseState,liabilityState,reservationId,reservationHash,profileBindingId,profileBindingRevision,accountIdentityVerified,insightsAccessVerified,receiptHash','handoff_owner_receipt_invalid');
  handoffAssert(r.version==='etsy.steel-owner-handoff-receipt.1'&&r.operationId===v.operationId&&r.scopeHash===v.scopeHash&&['awaiting_owner','profile_pending_verification','stopped','failed'].includes(r.status)&&typeof r.reason==='string'&&/^[a-z][a-z0-9_]{0,99}$/.test(r.reason)&&['not_created','held_for_owner','verified','unconfirmed'].includes(r.releaseState)&&['not_dispatched','held','receipt_required','unknown'].includes(r.liabilityState)&&[r.handoffId,r.reservationId,r.profileBindingId,r.profileBindingRevision].every(x=>x===null||handoffUuid(x))&&(r.reservationHash===null||handoffHash(r.reservationHash))&&r.accountIdentityVerified===false&&r.insightsAccessVerified===false,'handoff_owner_receipt_invalid');
  const{receiptHash,...body}=r;handoffAssert(receiptHash===etsySteelHash(body),'handoff_owner_receipt_invalid');
 }return structuredClone(v);
}
export function etsySteelOwnerApproval(view:EtsySteelOwnerView,input:unknown){
 handoffExact(input,'operationId,scopeHash,disclosureHash,expectedApprovalRevision,persistentAccessApproved,budgetApproved','handoff_owner_approval_required');
 handoffAssert(view.status==='pending_approval'&&input.operationId===view.operationId&&input.scopeHash===view.scopeHash&&input.disclosureHash===view.scope.disclosureHash&&input.expectedApprovalRevision===view.scope.approvalRevision&&input.persistentAccessApproved===true&&input.budgetApproved===true,'handoff_owner_approval_required');return structuredClone(input);
}
export type EtsySteelOwnerVerificationView={version:'etsy.steel-owner-verification-view.1';operationId:string;status:'pending_verification'|'verified'|'stopped'|'expired'|'invalidated'|'failed';accountBindingHash:string|null;observedShopName:string|null;verifiedAt:string|null;expiresAt:string|null;reason:string};
export function validateEtsySteelOwnerVerificationView(raw:unknown,operationId:string):EtsySteelOwnerVerificationView|null{
 if(raw===null)return null;
 handoffExact(raw,'version,operationId,status,accountBindingHash,observedShopName,verifiedAt,expiresAt,reason','verification_owner_view_invalid');
 const v=raw as EtsySteelOwnerVerificationView;
 handoffAssert(v.version==='etsy.steel-owner-verification-view.1'&&v.operationId===operationId&&handoffUuid(operationId)&&['pending_verification','verified','stopped','expired','invalidated','failed'].includes(v.status)&&['awaiting_verification','verification_in_progress','binding_persistence_pending','verification_verified','verification_paused','verification_failed','owner_stopped','verification_expired','account_revision_changed','authority_inactive'].includes(v.reason),'verification_owner_view_invalid');
 if(v.status==='verified')handoffAssert(handoffHash(v.accountBindingHash)&&typeof v.observedShopName==='string'&&v.observedShopName.trim()===v.observedShopName&&v.observedShopName.length>0&&v.observedShopName.length<=120&&typeof v.verifiedAt==='string'&&typeof v.expiresAt==='string'&&Number.isFinite(Date.parse(v.verifiedAt))&&Date.parse(v.expiresAt)>Date.parse(v.verifiedAt)&&v.reason==='verification_verified','verification_owner_view_invalid');
 else handoffAssert([v.accountBindingHash,v.observedShopName,v.verifiedAt,v.expiresAt].every(x=>x===null),'verification_owner_view_invalid');
 return structuredClone(v);
}
