import { FatalError } from "workflow";
import type { JsonObject } from "../core/contracts";
import { createRuntimeClient } from "../lib/supabase/runtime";
import { EtsyError, requireEtsy } from "../etsy/contracts";
import { executeListingQualification, type QualificationState, type ListingQualificationRepository } from "../listing/qualification";
import type { ListingQualificationRuntimeInput } from "./listing-qualification-runtime";
async function transition(input:ListingQualificationRuntimeInput,operation:string,payload:JsonObject={}) {
  const result=await createRuntimeClient().rpc("listing_qualification_transition",{p_run_id:input.qualificationRunId,p_business_id:input.businessId,p_runtime_capability:input.runtimeCapability,p_operation:operation,p_payload:payload});
  if(result.error)throw new EtsyError("listing_qualification_state_unavailable");return result.data;
}
export function listingQualificationRepository(input:ListingQualificationRuntimeInput,runtimeRunId:string):ListingQualificationRepository {
  async function state(operation:"load"|"guard") {
    const result=await transition(input,operation,{runtimeRunId}) as QualificationState&{workflowRunId:string};
    requireEtsy(result.id===input.qualificationRunId && result.businessId===input.businessId && result.workflowRunId===input.coreWorkflowRunId,"listing_qualification_scope_mismatch");
    const {id,businessId,status,suiteHash,knowledgeHash,workerHashes,maximumMicrousd,quote,taskIds,cases}=result;
    return {id,businessId,status,suiteHash,knowledgeHash,workerHashes,maximumMicrousd,quote,taskIds,cases};
  }
  return {load:()=>state("load"),guard:()=>state("guard"),reserve:payload=>transition(input,"reserve",payload as unknown as JsonObject),
    settle:async payload=>{await transition(input,"settle",payload as unknown as JsonObject);},persist:async payload=>{await transition(input,"persist",payload as unknown as JsonObject);},
    finish:async()=>{await transition(input,"finish");},fail:async reason=>{await transition(input,"fail",{reason});}};
}
export async function executeListingQualificationStep(input:ListingQualificationRuntimeInput,runtimeRunId:string) {
  "use step";
  try{return await executeListingQualification(listingQualificationRepository(input,runtimeRunId),{maximumNewCalls:1});}
  catch{
    try{await transition(input,"fail",{reason:"listing_qualification_runtime_failed"});}catch{/* A lost state service remains unresolved; never retry a paid step. */}
    throw new FatalError("Listing worker qualification stopped. Its costs and history are preserved; no automatic retry is permitted.");
  }
}
executeListingQualificationStep.maxRetries=0;
