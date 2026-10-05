import "server-only";
import { verifyOwnerBusiness } from "../lib/core-ui/owner-business";
import { readHistory, readState, historyRows } from "../lib/core-ui/history-read";
import type { HistoryPage } from "../lib/core-ui/history-query";
import { randomUUID } from "node:crypto";
import type { OwnerUiContext } from "../lib/core-ui/data";
import type { JsonObject } from "../core/contracts";
import { EtsyError, hash, record, requireEtsy, UUID, type EtsyProductPackage } from "../etsy/contracts";
import { seal, unseal, randomSecret } from "../etsy/vault";
import { loadVerifiedListingInput, type ListingEvidenceReader, type ListingArtifactRow, type ListingReceiptRow, type ListingCreativeApprovalRow, type ListingAssetRow } from "./sources";
import { fetchCreativeModelQuote, type CreativeModelQuote } from "../creative/budget";
import { currentListingQuote, LISTING_BUDGET, type ListingQuote } from "./budget";
import { listingKnowledgeHash } from "./knowledge";
import { listingWorker } from "./packs";
import { assertReviewedListing, type ReviewedListing } from "./runtime";
import { validateListingInput, type ListingInput } from "./contracts";
import { qualificationQuote, listingQualificationSuiteHash, type ListingQualificationQuote } from "./qualification";

export function listingConfigured() { return /^[a-f0-9]{64}$/.test(process.env.ETSY_VAULT_KEY ?? "") && (process.env.ETSY_SERVER_KEY?.length ?? 0) >= 32; }
export function listingConfig() {
  requireEtsy(listingConfigured(),"listing_secure_setup_required");
  return { vaultKey: process.env.ETSY_VAULT_KEY!, serverKey: process.env.ETSY_SERVER_KEY! };
}
function owner(context: OwnerUiContext, businessId: string) { requireEtsy(UUID.test(businessId) && context.businesses.some(b => b.id===businessId),"owner_required"); }
export async function listingOwnerRpc(context: OwnerUiContext, businessId: string, operation: string, payload: JsonObject = {}) {
  if(businessId && !(await verifyOwnerBusiness(context,businessId)))throw new EtsyError("owner_required");
  owner(context,businessId);
  const result=await context.supabase.rpc("listing_owner_transition",{p_business_id:businessId,p_operation:operation,p_payload:payload,p_server_key:listingConfigured()?listingConfig().serverKey:""});
  if(result.error) throw new EtsyError("listing_state_unavailable");
  return record(result.data);
}
export function listingEvidenceReader(context: OwnerUiContext,businessId: string): ListingEvidenceReader {
  owner(context,businessId);
  async function one<T>(table:string,columns:string,id:string):Promise<T|null> {
    requireEtsy(UUID.test(id),"invalid_listing_evidence_identity");
    const result=await context.supabase.from(table).select(columns).eq("business_id",businessId).eq("id",id).maybeSingle();
    if(result.error)throw new EtsyError("listing_evidence_unavailable"); return result.data as T|null;
  }
  return {
    readArtifact:id=>one<ListingArtifactRow>("artifacts","id,business_id,artifact_type,content",id),
    readReceipt:id=>one<ListingReceiptRow>("action_receipts","id,business_id,provider,outcome,response_summary",id),
    readCreativeApproval:id=>one<ListingCreativeApprovalRow>("creative_approvals","id,business_id,purpose,snapshot",id),
    readAsset:id=>one<ListingAssetRow>("creative_assets","id,business_id,creative_run_id,asset_hash,storage_path,inspection",id),
    async imageBytes(path) {
      requireEtsy(path.startsWith(`${businessId}/`) && path.split("/").length===3,"listing_asset_binding_mismatch");
      const result=await context.supabase.storage.from("creative-assets").download(path);
      requireEtsy(!result.error && result.data && result.data.size<=7_000_000,"listing_image_bytes_unavailable");
      return new Uint8Array(await result.data.arrayBuffer());
    },
    async assertPackage(product) {
      const result=await context.supabase.rpc("etsy_owner_transition",{p_business_id:businessId,p_operation:"validate_package",p_payload:{package:product},p_server_key:listingConfig().serverKey});
      requireEtsy(!result.error,"listing_upstream_qualification_required");
    },
  };
}
export async function loadListingSource(context:OwnerUiContext,businessId:string,sourceArtifactId:string) {
  if(businessId && !(await verifyOwnerBusiness(context,businessId)))throw new EtsyError("owner_required");
  owner(context,businessId);
  return loadVerifiedListingInput({businessId,sourceArtifactId,reader:listingEvidenceReader(context,businessId),vaultKey:listingConfig().vaultKey});
}
export type ListingSourceChoice={id:string;title:string;inputHash:string;expiresAt:string;quote:ListingQuote};
export type ListingRunView={id:string;workflowRunId:string;sourceArtifactId:string;outputArtifactId:string;status:string;phase:string;reason:string|null;maximumMicrousd:number;createdAt:string;expiresAt:string;expired:boolean;
  costs:{role:string;reservedMicrousd:number;reportedMicrousd:number|null;settled:boolean}[];review?:ReviewedListing["review"]|null;proposal?:ReviewedListing["proposal"]|null};
export type ListingQualificationRunView={id:string;workflowRunId:string;status:string;reason:string|null;maximumMicrousd:number;createdAt:string;expiresAt:string;
  costs:{caseKey:string;reservedMicrousd:number;reportedMicrousd:number|null;settled:boolean}[]};
export type ListingWorkspaceData={ runsPage?:HistoryPage; qualificationsPage?:HistoryPage; sourcesPage?:HistoryPage;businessId:string;configured:boolean;qualified:boolean;unavailable:boolean;sources:ListingSourceChoice[];runs:ListingRunView[];sourceBlocker:boolean;
  qualificationRuns:ListingQualificationRunView[];qualificationQuote:ListingQualificationQuote|null;qualificationQuoteUnavailable:boolean;qualificationLaunchNonce:string|null};
export async function loadListingWorkspace(context:OwnerUiContext,businessId:string):Promise<ListingWorkspaceData> {
  if(businessId && !(await verifyOwnerBusiness(context,businessId)))throw new EtsyError("owner_required");
  owner(context,businessId);
  const data:ListingWorkspaceData={businessId,configured:listingConfigured(),qualified:false,unavailable:false,sources:[],runs:[],sourceBlocker:false,qualificationRuns:[],qualificationQuote:null,qualificationQuoteUnavailable:false,qualificationLaunchNonce:null};
  try {
    const [state,runs,qualification,candidates] = await Promise.all([readState(context,businessId,"listing_state"),readHistory<ListingRunView>(context,businessId,"listing_runs","listing"),readHistory<ListingQualificationRunView>(context,businessId,"listing_qualifications","listingQualification"),readHistory<{id:string}>(context,businessId,"listing_sources","listingSource")]);
    requireEtsy(typeof state.qualified==="boolean" && typeof state.activeQualification==="boolean","listing_state_unavailable");
    const workspace={...state,authorityConfigured:listingConfigured(),qualified:state.qualified,runs:historyRows(runs),qualificationRuns:historyRows(qualification)};
    data.runsPage=runs.page;data.qualificationsPage=qualification.page;data.sourcesPage=candidates.page;
    data.configured=data.configured && workspace.authorityConfigured===true;data.qualified=workspace.qualified===true;
    data.runs=Array.isArray(workspace.runs)?(workspace.runs as ListingRunView[]).map(run=>({...run,expired:Number.isFinite(Date.parse(run.expiresAt))&&Date.parse(run.expiresAt)<=Date.now()})):[];
    data.qualificationRuns=Array.isArray(workspace.qualificationRuns)?workspace.qualificationRuns as ListingQualificationRunView[]:[];
    if(data.configured && !data.qualified && state.activeQualification!==true) {
      try{data.qualificationQuote=await qualificationQuote(LISTING_BUDGET.maximumMicrousd);data.qualificationLaunchNonce=randomUUID();}catch{data.qualificationQuoteUnavailable=true;}
    }
    if(!data.configured || !data.qualified)return data;
    const prices=new Map<string,Promise<CreativeModelQuote>>();
    const currentPrice=(modelId:string)=>{let price=prices.get(modelId);if(!price){price=fetchCreativeModelQuote(modelId);prices.set(modelId,price);}return price;};
    for(const row of historyRows(candidates)) {
      try {
        const source=await loadListingSource(context,businessId,row.id);

        const quote=await currentListingQuote(source.inputHash,LISTING_BUDGET.maximumMicrousd,currentPrice);
        data.sources.push({id:row.id,title:source.input.product.title,inputHash:source.inputHash,expiresAt:source.input.product.expiresAt,quote});
      }catch{data.sourceBlocker=true;}
    }
  }catch{data.unavailable=true;}
  return data;
}
export async function beginListingPreparation(context:OwnerUiContext,businessId:string,sourceArtifactId:string,expectedInputHash:string,maximumMicrousd:number) {
  if(businessId && !(await verifyOwnerBusiness(context,businessId)))throw new EtsyError("owner_required");
  owner(context,businessId);
  requireEtsy(Number.isSafeInteger(maximumMicrousd) && maximumMicrousd>0 && maximumMicrousd<=LISTING_BUDGET.maximumMicrousd,"invalid_listing_budget_scope");
  const source=await loadListingSource(context,businessId,sourceArtifactId);
  requireEtsy(source.inputHash===expectedInputHash,"listing_source_changed");
  const quote=await currentListingQuote(source.inputHash,maximumMicrousd),runtimeCapability=randomSecret(),launchNonce=randomUUID();
  const result=await listingOwnerRpc(context,businessId,"start",{approveModelCalls:true,sourceArtifactId,sourceContentHash:source.sourceContentHash,sourceEnvelope:source.sourceEnvelope,input:source.input as unknown as JsonObject,inputHash:source.inputHash,quote:quote as unknown as JsonObject,maximumMicrousd,runtimeCapability,launchNonce,knowledgeHash:listingKnowledgeHash(),workerHashes:{specialist:hash(listingWorker("specialist").manifest),reviewer:hash(listingWorker("reviewer").manifest)}});
  requireEtsy(typeof result.runId==="string" && UUID.test(result.runId) && typeof result.workflowRunId==="string" && UUID.test(result.workflowRunId),"listing_launch_unavailable");
  return {runId:result.runId,workflowRunId:result.workflowRunId,shouldStart:result.shouldStart===true,runtimeCapability,launchNonce};
}
/** Called by the guarded durable engine only, after reading its actual persisted
 * model settlements/outputs. There is no owner-facing envelope issuance endpoint. */
export function issueListingEnvelopes(product:EtsyProductPackage,reviewedListing:ReviewedListing) {
  assertReviewedListing(reviewedListing,product);
  const {vaultKey}=listingConfig();
  return {etsyDraftEnvelope:seal(product,`product-package:${product.businessId}:${product.id}`,vaultKey),
    listingReviewEnvelope:seal(reviewedListing,`listing-review:${product.businessId}:${product.id}`,vaultKey)};
}
/** Reauthenticates the upstream handoff returned by the one-run capability RPC.
 * The RPC independently resolves and compares every current source record. */
export function assertRuntimeListingSource(state:{businessId:string;sourceArtifactId:string;sourceEnvelope:string;input:ListingInput;inputHash:string}) {
  const input=unseal<ListingInput>(state.sourceEnvelope,`listing-input:${state.businessId}:${state.sourceArtifactId}`,listingConfig().vaultKey);
  validateListingInput(input);
  requireEtsy(input.evidenceMode==="live" && input.product.businessId===state.businessId && input.product.id===state.sourceArtifactId && hash(input)===state.inputHash && hash(state.input)===state.inputHash,"listing_source_changed");
}

export async function beginListingQualification(context:OwnerUiContext,businessId:string,expectedSuiteHash:string,maximumMicrousd:number,launchNonce:string) {
  if(businessId && !(await verifyOwnerBusiness(context,businessId)))throw new EtsyError("owner_required");
  owner(context,businessId);listingConfig();
  requireEtsy(expectedSuiteHash===listingQualificationSuiteHash() && UUID.test(launchNonce),"listing_qualification_suite_changed");
  const quote=await qualificationQuote(maximumMicrousd),runtimeCapability=randomSecret();
  const result=await listingOwnerRpc(context,businessId,"start_qualification",{approveModelCalls:true,suiteHash:listingQualificationSuiteHash(),knowledgeHash:listingKnowledgeHash(),workerHashes:{specialist:hash(listingWorker("specialist").manifest),reviewer:hash(listingWorker("reviewer").manifest)},quote:quote as unknown as JsonObject,maximumMicrousd,runtimeCapability,launchNonce});
  requireEtsy(typeof result.runId==="string" && UUID.test(result.runId) && typeof result.workflowRunId==="string" && UUID.test(result.workflowRunId),"listing_qualification_launch_unavailable");
  return {runId:result.runId,workflowRunId:result.workflowRunId,shouldStart:result.shouldStart===true,runtimeCapability,launchNonce};
}
