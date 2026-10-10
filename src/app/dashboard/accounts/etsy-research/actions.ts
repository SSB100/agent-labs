'use server';
import {redirect} from 'next/navigation';
import {revalidatePath} from 'next/cache';
import {requireOwnerUiContext} from '@/lib/core-ui/data';
import {approveEtsySteelOwnerSetup,stopEtsySteelOwnerSetup,readEtsySteelOwnerSetup} from '@/accounts/etsy-steel-handoff-owner-server';
const field=(f:FormData,k:string)=>typeof f.get(k)==='string'?String(f.get(k)):'';
function done(businessId:string,operationId:string,result:string):never{revalidatePath('/dashboard/accounts/etsy-research');redirect(`/dashboard/accounts/etsy-research?${new URLSearchParams({business:businessId,operation:operationId,result})}`);}
export async function approveEtsyResearchAccess(form:FormData){
 const context=await requireOwnerUiContext(),businessId=field(form,'businessId'),operationId=field(form,'operationId');
 if(field(form,'persistentAccessConsent')!=='on')done(businessId,operationId,'consent-required');
 try{await approveEtsySteelOwnerSetup(context,businessId,operationId,{operationId,scopeHash:field(form,'scopeHash'),disclosureHash:field(form,'disclosureHash'),expectedApprovalRevision:field(form,'approvalRevision'),persistentAccessApproved:true,budgetApproved:true,...(form.has('rendererReviewHash')?{rendererReviewHash:field(form,'rendererReviewHash')}:{})});}catch{done(businessId,operationId,'unavailable');}
 done(businessId,operationId,'approved');
}
export async function stopEtsyResearchAccess(form:FormData){
 const context=await requireOwnerUiContext(),businessId=field(form,'businessId'),operationId=field(form,'operationId');
 try{const view=await readEtsySteelOwnerSetup(context,businessId,operationId),pending=view.receipts.find(r=>r.status==='awaiting_owner'&&r.handoffId);
  await stopEtsySteelOwnerSetup(context,businessId,operationId);
  if(pending?.handoffId){const{finishApprovedEtsySteelSetup}=await import('@/accounts/etsy-steel-handoff-server');await finishApprovedEtsySteelSetup(context,businessId,operationId,pending.handoffId,'stop');}
 }catch{done(businessId,operationId,'stop-unconfirmed');}
 done(businessId,operationId,'stop-recorded');
}
export async function startEtsyResearchSignIn(form:FormData){
 const context=await requireOwnerUiContext(),businessId=field(form,'businessId'),operationId=field(form,'operationId');
 let handoffId:string|null=null;
 try{const{startApprovedEtsySteelSetup}=await import('@/accounts/etsy-steel-handoff-server');const r=await startApprovedEtsySteelSetup(context,businessId,operationId);if(r.status==='awaiting_owner')handoffId=r.handoffId;}catch{done(businessId,operationId,'start-unconfirmed');}
 if(!handoffId)done(businessId,operationId,'start-unconfirmed');
 redirect(`/dashboard/accounts/etsy-research/sign-in?${new URLSearchParams({business:businessId,operation:operationId,handoff:handoffId})}`);
}
export async function finishEtsyResearchSignIn(form:FormData){
 const context=await requireOwnerUiContext(),businessId=field(form,'businessId'),operationId=field(form,'operationId'),handoffId=field(form,'handoffId'),action=field(form,'action');
 if(action!=='return'&&action!=='stop')done(businessId,operationId,'unavailable');
 let result='return-unconfirmed';
 try{const{finishApprovedEtsySteelSetup}=await import('@/accounts/etsy-steel-handoff-server');const r=await finishApprovedEtsySteelSetup(context,businessId,operationId,handoffId,action);result=r.accountingConfirmed?r.receipt.status:'accounting-pending';
 if(r.accountingConfirmed&&r.receipt.status==='profile_pending_verification'&&action==='return'){
  const{verifyApprovedEtsySteelSetup}=await import('@/accounts/etsy-steel-handoff-server');
  const verification=await verifyApprovedEtsySteelSetup(context,businessId,operationId);result=verification.status==='verified'?'account-verified':'verification-pending';
 }}catch{/* Safe status only; no private URL/provider error. */}
 done(businessId,operationId,result);
}
