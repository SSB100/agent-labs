import "server-only";
import { randomUUID } from "node:crypto";
import type { OwnerUiContext } from "../lib/core-ui/data";
import type { OwnerInterventionRecord } from "../lib/core-ui/workflows";
import { etsyConfigured, etsyConfig, ownerBusiness, resolveEtsyConnection } from "../etsy/server";
import { EtsyError, hash, record, requireEtsy, sameScope, SHA256, UUID, validatePackage, type EtsyProductPackage } from "../etsy/contracts";
import { randomSecret, unseal } from "../etsy/vault";
import { authenticateListingReview } from "../listing/intake";
import type { ReviewedListing } from "../listing/runtime";
import { EtsyPublicationAdapter } from "./adapter";
import { executeEtsyPublication, type PublicationContext, type PublicationRepository, type PublicationState } from "./engine";
import { publicationRequestHash, validatePublicationPreflight, validateVerifiedDraft, verifyPublicationReadback,
  type PublicationApproval, type PublicationFeeQuote, type PublicationPreflight, type VerifiedPublicationDraft } from "./contracts";
import { assertPublicationPolicyFresh, publicationDisclosureHash, publicationFeeReadiness, publicationPolicy, type PublicationFeeReadiness } from "./policy";

export type PublicationDraftChoice = { id: string; title: string; packageArtifactId: string; packageHash: string; listingId: number; shopId: number; quantity: number; priceMinor: number; currency: string; verifiedAt: string };
export type PublicationRunView = { id: string; title: string; status: string; providerState: string; listingId: number | null; reason: string | null; stopRequested: boolean; activationSent: boolean };
export type PublicationWorkspaceData = { businessId: string; configured: boolean; unavailable: boolean; feeReadiness: PublicationFeeReadiness; drafts: PublicationDraftChoice[]; runs: PublicationRunView[] };
export async function publicationRpc(context: OwnerUiContext, businessId: string, operation: string, payload: Record<string, unknown> = {}) {
  ownerBusiness(context,businessId);
  const {data,error}=await context.supabase.rpc("etsy_publication_owner_transition",{p_business_id:businessId,p_operation:operation,p_payload:payload,p_server_key:operation === "workspace" || operation === "cancel" ? "" : etsyConfig().serverKey});
  if(error)throw new EtsyError("publication_state_unavailable");return record(data);
}
export async function loadPublicationWorkspace(context: OwnerUiContext,businessId:string,interventionId?:string|null):Promise<PublicationWorkspaceData> {
  ownerBusiness(context,businessId);
  const view:PublicationWorkspaceData={businessId,configured:etsyConfigured(),unavailable:false,feeReadiness:publicationFeeReadiness(),drafts:[],runs:[]};
  try {
    requireEtsy(!interventionId || UUID.test(interventionId),"publication_request_invalid");
    const raw=await publicationRpc(context,businessId,"workspace",interventionId?{interventionId}:{});
    requireEtsy(Array.isArray(raw.drafts)&&Array.isArray(raw.runs),"publication_state_unavailable");
    view.drafts=raw.drafts as PublicationDraftChoice[];
    view.runs=raw.runs.map(value=>{const row=record(value);return{id:String(row.id),title:String(row.title),status:String(row.status),providerState:String(row.providerState??"unknown"),listingId:typeof row.listingId === "number" ? row.listingId:null,reason:typeof row.reason === "string"?row.reason:null,stopRequested:row.stopRequested===true,activationSent:row.activationSent===true || row.attemptedAt!=null};});
  }catch{view.unavailable=true;}
  return view;
}
/** Publication exceptions can outlive and are not attached to the completed
 * listing workflow. Fetch only this exact intervention type and owned Businesses. */
export async function loadPublicationInterventions(context:OwnerUiContext):Promise<{records:OwnerInterventionRecord[];unavailable:boolean}>{
  const businesses=context.businesses.map(value=>value.id);if(!businesses.length)return{records:[],unavailable:false};
  try{
    const {data,error,count}=await context.supabase.from("owner_interventions").select("id,business_id,workflow_run_id,intervention_type,status,title,description,options,resolution,requested_at,resolved_at,created_at,updated_at",{count:"exact"}).in("business_id",businesses).eq("intervention_type","etsy.publication.reconcile").eq("status","open").order("requested_at",{ascending:true}).limit(100);
    if(error || !Array.isArray(data))return{records:[],unavailable:true};
    if(data.some(row=>!businesses.includes(row.business_id) || row.intervention_type!=="etsy.publication.reconcile" || row.status!=="open"))return{records:[],unavailable:true};
    return{records:data as OwnerInterventionRecord[],unavailable:!Number.isSafeInteger(count) || count!==data.length};
  }catch{return{records:[],unavailable:true};}
}
export type PublicationSource = {
  package:EtsyProductPackage;draft:VerifiedPublicationDraft;draftReceipt:Record<string,unknown>;draftReceiptHash:string;
  review:ReviewedListing;reviewHash:string;packageHash:string;packageEnvelope:string;reviewEnvelope:string;
  artifactContent:Record<string,unknown>;connectionId:string;connectionRevision:string;shopId:number;
};
/** SQL resolves immutable producer records; both independent envelopes are then
 * authenticated again on the server. Reconciliation may inspect that original
 * snapshot after expiry but cannot grant mutation authority. */
export function authenticatePublicationSource(raw:unknown,businessId:string,mode:"publish"|"reconcile",vaultKey:string):PublicationSource {
  const source=record(raw) as unknown as PublicationSource,p=source.package;
  validatePackage(p,businessId,mode === "publish"?Date.now():Date.parse(p.approvedAt));
  requireEtsy(typeof source.packageEnvelope === "string" && typeof source.reviewEnvelope === "string" && source.packageHash===hash(p),"publication_source_mismatch");
  const sealed=unseal<EtsyProductPackage>(source.packageEnvelope,`product-package:${businessId}:${p.id}`,vaultKey);
  requireEtsy(hash(sealed)===source.packageHash,"publication_source_mismatch");
  const review=mode === "publish"?authenticateListingReview(source.reviewEnvelope,p,vaultKey):unseal<ReviewedListing>(source.reviewEnvelope,`listing-review:${businessId}:${p.id}`,vaultKey);
  requireEtsy(hash(review)===source.reviewHash && hash(source.review)===source.reviewHash && review.productPackageHash===source.packageHash && review.outputArtifactId===p.id,"publication_source_mismatch");
  requireEtsy(source.artifactContent?.etsyDraftEnvelope===source.packageEnvelope && source.artifactContent?.listingReviewEnvelope===source.reviewEnvelope && hash(source.draftReceipt)===source.draftReceiptHash,"publication_source_mismatch");
  validateVerifiedDraft(source.draft,{businessId,connectionId:source.connectionId,shopId:source.shopId},p,source.draft.listingId,source.draft.identity);
  return source;
}
export async function loadPublicationSource(context:OwnerUiContext,businessId:string,draftRunId:string) {
  requireEtsy(UUID.test(draftRunId),"verified_draft_required");
  return authenticatePublicationSource(await publicationRpc(context,businessId,"source",{draftRunId}),businessId,"publish",etsyConfig().vaultKey);
}
/** No current integration can establish the account-specific all-in bound.
 * Adding an authenticated provider or account-rule producer requires its own
 * reviewed implementation. A caller cannot submit this evidence through a form. */
async function verifiedPublicationFeeQuote():Promise<PublicationFeeQuote|null>{return null;}
export async function beginEtsyPublication(context:OwnerUiContext,businessId:string,draftRunId:string,approvedBindings:{packageHash:string;reviewHash:string;preflightHash:string;disclosureHash:string;feeQuoteHash:string},consents:{publication:boolean;publicData:boolean;fee:boolean;renewal:boolean}) {
  ownerBusiness(context,businessId);
  requireEtsy(consents.publication && consents.publicData && consents.fee && consents.renewal,"publication_consent_required");
  requireEtsy(Object.values(approvedBindings).every(value=>SHA256.test(value)),"publication_review_required");
  assertPublicationPolicyFresh();
  const readiness=publicationFeeReadiness();requireEtsy(readiness.available,readiness.reason);
  const source=await loadPublicationSource(context,businessId,draftRunId),p=source.package;
  requireEtsy(source.packageHash===approvedBindings.packageHash && source.reviewHash===approvedBindings.reviewHash && approvedBindings.disclosureHash===publicationDisclosureHash && p.quantity===1,"stale_package_or_approval");
  const connection=await resolveEtsyConnection(context,businessId);sameScope(connection,{businessId,connectionId:source.connectionId,shopId:source.shopId});
  requireEtsy(connection.revision===source.connectionRevision,"account_access_revoked");
  const provider=new EtsyPublicationAdapter({authorize:()=>resolveEtsyConnection(context,businessId),apiKey:`${etsyConfig().keystring}:${etsyConfig().sharedSecret}`,scope:connection,connectionRevision:connection.revision,listingId:source.draft.listingId});
  await provider.shop();
  const listing=record(await provider.listing(source.draft.listingId));
  const preflight:PublicationPreflight={quantity:1,shouldAutoRenew:false,shippingProfileId:p.shippingProfileId,returnPolicyId:Number(listing.return_policy_id),shippingProfile:await provider.shippingProfile(p.shippingProfileId),returnPolicy:await provider.returnPolicy(Number(listing.return_policy_id)),processingProfile:await provider.processingProfile(p.readinessStateId)};
  validatePublicationPreflight(preflight,listing,connection,p);
  requireEtsy(hash(preflight)===approvedBindings.preflightHash,"stale_package_or_approval");
  verifyPublicationReadback({listing,images:await provider.images(source.draft.listingId),properties:await provider.properties(source.draft.listingId)},connection,p,source.draft,"draft");
  const quote=await verifiedPublicationFeeQuote();requireEtsy(quote,"publication_fee_evidence_required");
  requireEtsy(hash(quote)===approvedBindings.feeQuoteHash,"stale_package_or_approval");
  const binding={businessId,connectionId:connection.connectionId,connectionRevision:connection.revision,shopId:connection.shopId,listingId:source.draft.listingId,identity:source.draft.identity,packageHash:source.packageHash,reviewHash:source.reviewHash,draftReceiptHash:source.draftReceiptHash,disclosureHash:publicationDisclosureHash,preflightHash:hash(preflight)};
  const requestHash=publicationRequestHash(binding),approvedAt=new Date().toISOString();
  const approval:PublicationApproval={id:randomUUID(),requestHash,quoteHash:hash(quote),disclosureHash:publicationDisclosureHash,billingCurrency:quote.billingCurrency,maximumTotalMinor:quote.maximumTotalMinor,approvedQuantity:1,paymentMethod:"etsy_payment_account",commitment:"publish_existing_quantity_manual_renewal",dataSharing:"make_exact_reviewed_listing_public",approvedAt,expiresAt:new Date(Math.min(Date.parse(quote.expiresAt),Date.parse(p.expiresAt),Date.now()+300_000)).toISOString()};
  return publicationRpc(context,businessId,"prepare",{draftRunId,packageHash:source.packageHash,reviewHash:source.reviewHash,draftReceiptHash:source.draftReceiptHash,connectionRevision:connection.revision,preflight,preflightHash:hash(preflight),disclosure:publicationPolicy,disclosureHash:publicationDisclosureHash,feeEvidence:quote,approval,approvalHash:hash(approval),requestHash,approvePublication:true,approveFee:true});
}
export function publicationRepository(context:OwnerUiContext,businessId:string,runId:string):PublicationRepository {
  ownerBusiness(context,businessId);requireEtsy(UUID.test(runId),"publication_not_found");const lease=randomSecret();let revision=0;
  const rpc=(operation:string,payload:Record<string,unknown>={})=>publicationRpc(context,businessId,operation,{...payload,runId,lease});
  function acceptState(state:PublicationState,result:Record<string,unknown>){const next=result.state as PublicationState;requireEtsy(next && next.id===state.id && next.businessId===state.businessId && Number.isSafeInteger(result.revision) && Number(result.revision)>=revision,"publication_scope_mismatch");Object.assign(state,next);revision=Number(result.revision);}
  return {
    async acquire(){const result=await rpc("acquire");try{const state=result.state as PublicationState;requireEtsy(state && state.id===runId && state.businessId===businessId && Number.isSafeInteger(result.revision) && Number(result.revision)>=0,"publication_scope_mismatch");revision=Number(result.revision);return state;}catch(error){try{await rpc("release");}catch{/* Do not retry a failed lease cleanup. */}throw error;}},
    async save(state){const result=await rpc("save",{state,revision});acceptState(state,result);},
    async guard(mode){
      const raw=await rpc("guard",{mode}),source=authenticatePublicationSource(raw,businessId,mode,etsyConfig().vaultKey);
      const connection=await resolveEtsyConnection(context,businessId);sameScope(connection,{businessId,connectionId:source.connectionId,shopId:source.shopId});
      requireEtsy(connection.revision===source.connectionRevision,"account_access_revoked");
      if(mode === "publish"){assertPublicationPolicyFresh();requireEtsy(raw.disclosureHash===publicationDisclosureHash,"publication_policy_refresh_required");const readiness=publicationFeeReadiness();requireEtsy(readiness.available,readiness.reason);}
      return {package:source.package,draft:source.draft,connection,reviewHash:source.reviewHash,draftReceiptHash:source.draftReceiptHash,approvalHash:raw.approvalHash,disclosureHash:raw.disclosureHash,preflightHash:raw.preflightHash,requestHash:raw.requestHash,financial:raw.financial,preflight:raw.preflight,stopRequested:raw.stopRequested} as PublicationContext;
    },
    async finish(state,receipt,resource){const result=await rpc("finish",{state,receipt,resource,revision});acceptState(state,result);},
    async release(){await rpc("release");},
  };
}
export async function runEtsyPublication(context:OwnerUiContext,businessId:string,runId:string,reconcileOnly=false) {
  const repository=publicationRepository(context,businessId,runId),state=await repository.acquire();let engineEntered=false;
  try{
    if(reconcileOnly)requireEtsy(state.activation && typeof state.activation === "object" && !Array.isArray(state.activation),"publication_not_dispatched");
    const config=etsyConfig(),provider=new EtsyPublicationAdapter({authorize:()=>resolveEtsyConnection(context,businessId),apiKey:`${config.keystring}:${config.sharedSecret}`,scope:state,connectionRevision:state.connectionRevision,listingId:state.listingId});
    engineEntered=true;return await executeEtsyPublication({...repository,acquire:async()=>state},provider);
  }catch(error){if(!engineEntered){try{await repository.release();}catch{/* Preserve uncertain state without retry. */}}throw error;}
}
