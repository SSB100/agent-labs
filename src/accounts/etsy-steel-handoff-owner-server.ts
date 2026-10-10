import 'server-only';
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
