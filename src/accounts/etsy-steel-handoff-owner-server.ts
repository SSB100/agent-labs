import 'server-only';
import {randomUUID} from 'node:crypto';
import {validateEtsySteelReplacementView} from './etsy-steel-replacement';
import type {OwnerUiContext} from '../lib/core-ui/data';
import {verifyOwnerBusiness} from '../lib/core-ui/owner-business';
import {boundedRpc,requestDeadline} from '../core/request-deadline';
import {handoffAssert,handoffUuid} from './etsy-steel-handoff-contracts';
import {etsySteelOwnerApproval,validateEtsySteelOwnerView,validateEtsySteelOwnerVerificationView,validateEtsySteelOwnerRendererReview} from './etsy-steel-handoff-owner';
async function ownerRpc(context:OwnerUiContext,businessId:string,operationId:string,operation:'read'|'approve'|'stop',payload:Record<string,unknown>){
 handoffAssert(handoffUuid(businessId)&&handoffUuid(operationId)&&handoffUuid(context.userId)&&await verifyOwnerBusiness(context,businessId),'handoff_owner_required');
 const claims=await context.supabase.auth.getClaims();handoffAssert(!claims.error&&claims.data?.claims?.sub===context.userId,'handoff_owner_required');
 const r=await boundedRpc(context.supabase.rpc('r12_etsy_steel_owner',{p_business_id:businessId,p_operation:operation,p_payload:payload}),requestDeadline(15000),10000);
 handoffAssert(!r.error,'handoff_owner_state_unavailable');return validateEtsySteelOwnerView(r.data,{ownerId:context.userId,businessId,operationId});
}
export function readEtsySteelOwnerSetup(context:OwnerUiContext,businessId:string,operationId:string){return ownerRpc(context,businessId,operationId,'read',{operationId});}
export async function approveEtsySteelOwnerSetup(context:OwnerUiContext,businessId:string,operationId:string,input:unknown){const current=await readEtsySteelOwnerSetup(context,businessId,operationId);return ownerRpc(context,businessId,operationId,'approve',etsySteelOwnerApproval(current,input));}
export function stopEtsySteelOwnerSetup(context:OwnerUiContext,businessId:string,operationId:string){return ownerRpc(context,businessId,operationId,'stop',{operationId});}

export async function readEtsySteelReplacement(context:OwnerUiContext,businessId:string,operationId:string){
 await readEtsySteelOwnerSetup(context,businessId,operationId);
 const r=await boundedRpc(context.supabase.rpc('r12_owner_steel_replacement',{p_business_id:businessId,p_operation:'read',p_payload:{operationId}}),requestDeadline(15000),10000);
 handoffAssert(!r.error,'steel_replacement_unavailable');return validateEtsySteelReplacementView(r.data,businessId,operationId);
}
export async function prepareEtsySteelReplacement(context:OwnerUiContext,businessId:string,operationId:string){
 const current=await readEtsySteelReplacement(context,businessId,operationId);
 handoffAssert(current.recovery&&['qualified_bounded_pending','final_actual'].includes(String(current.recovery.status)),'steel_replacement_recovery_required');
 const r=await boundedRpc(context.supabase.rpc('r12_owner_steel_replacement',{p_business_id:businessId,p_operation:'prepare',p_payload:{operationId,recoveryHash:current.recovery.recoveryHash,submissionId:randomUUID()}}),requestDeadline(15000),10000);
 handoffAssert(!r.error,'steel_replacement_unavailable');return validateEtsySteelReplacementView(r.data,businessId,operationId);
}
export async function confirmEtsySteelReplacement(context:OwnerUiContext,businessId:string,operationId:string,proposalId:string,proposalHash:string){
 const current=await readEtsySteelReplacement(context,businessId,operationId);
 handoffAssert(current.proposal?.proposalId===proposalId&&current.proposal.proposalHash===proposalHash,'steel_replacement_exact_review_required');
 handoffAssert(current.confirmed||Date.parse(current.proposal.expiresAt)>Date.now(),'steel_replacement_review_expired');
 const r=await boundedRpc(context.supabase.rpc('r12_owner_steel_replacement',{p_business_id:businessId,p_operation:'confirm',p_payload:{proposalId,proposalHash,submissionId:randomUUID()}}),requestDeadline(15000),10000);
 handoffAssert(!r.error,'steel_replacement_unavailable');return validateEtsySteelReplacementView(r.data,businessId,operationId);
}

export async function readEtsySteelOwnerVerification(context:OwnerUiContext,businessId:string,operationId:string){
 await readEtsySteelOwnerSetup(context,businessId,operationId);
 const r=await boundedRpc(context.supabase.rpc('r12_owner_etsy_steel_verification_read',{p_business_id:businessId,p_operation_id:operationId}),requestDeadline(15000),10000);
 handoffAssert(!r.error,'verification_owner_state_unavailable');return validateEtsySteelOwnerVerificationView(r.data,operationId);
}

export async function readEtsySteelOwnerRendererReview(context:OwnerUiContext,businessId:string,operationId:string){
 await readEtsySteelOwnerSetup(context,businessId,operationId);
 const r=await boundedRpc(context.supabase.rpc('r12_owner_etsy_steel_renderer_review',{p_business_id:businessId,p_operation_id:operationId}),requestDeadline(15000),10000);
 handoffAssert(!r.error,'renderer_owner_review_unavailable');const review=validateEtsySteelOwnerRendererReview(r.data,operationId);handoffAssert(review!==null,'renderer_owner_review_unavailable');return review;
}
