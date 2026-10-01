import { FatalError } from "workflow";
import type { JsonObject } from "../core/contracts";
import { createRuntimeClient } from "../lib/supabase/runtime";
import { EtsyError, requireEtsy } from "../etsy/contracts";
import { executeListingRun, type ListingRunState, type ListingRunRepository } from "../listing/engine";
import { assertRuntimeListingSource, issueListingEnvelopes } from "../listing/server";
import type { ListingRuntimeInput } from "./listing-runtime";

async function transition(input:ListingRuntimeInput,operation:string,payload:JsonObject={}) {
  const result=await createRuntimeClient().rpc("listing_runtime_transition",{p_run_id:input.listingRunId,p_business_id:input.businessId,p_runtime_capability:input.runtimeCapability,p_operation:operation,p_payload:payload});
  if(result.error)throw new EtsyError("listing_runtime_state_unavailable");return result.data;
}
export function listingRuntimeRepository(input:ListingRuntimeInput,runtimeRunId:string):ListingRunRepository {
  async function state(operation:"load"|"guard") {
    const result=await transition(input,operation,{runtimeRunId}) as ListingRunState&{sourceEnvelope:string};
    requireEtsy(result.id===input.listingRunId && result.businessId===input.businessId && result.workflowRunId===input.coreWorkflowRunId,"listing_runtime_scope_mismatch");
    if(result.status==="queued" || result.status==="running")assertRuntimeListingSource(result);
    const {id,businessId,workflowRunId,sourceArtifactId,outputArtifactId,input:sourceInput,inputHash,knowledgeHash,workerHashes,status,phase,maximumMicrousd,quote,taskIds,outputs}=result;
    return {id,businessId,workflowRunId,sourceArtifactId,outputArtifactId,input:sourceInput,inputHash,knowledgeHash,workerHashes,status,phase,maximumMicrousd,quote,taskIds,outputs};
  }
  return {load:()=>state("load"),guard:()=>state("guard"),reserve:payload=>transition(input,"reserve",payload as unknown as JsonObject),
    settle:async payload=>{await transition(input,"settle",payload as unknown as JsonObject);},
    persist:async payload=>{await transition(input,"persist",payload as unknown as JsonObject);},
    finish:async payload=>{await transition(input,"finish",payload as unknown as JsonObject);},
    fail:async reason=>{await transition(input,"fail",{reason});}};
}
export async function executeListingPreparation(input:ListingRuntimeInput,runtimeRunId:string) {
  "use step";
  try{return await executeListingRun(listingRuntimeRepository(input,runtimeRunId),{issue:async(product,review)=>issueListingEnvelopes(product,review)});}
  catch{
    try{await transition(input,"fail",{reason:"listing_runtime_failed"});}catch{/* A lost state service remains unresolved; never retry a paid step. */}
    throw new FatalError("Listing preparation stopped. Inspect its durable history; no automatic retry is permitted.");
  }
}
executeListingPreparation.maxRetries=0;
