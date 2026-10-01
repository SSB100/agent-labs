import { FatalError, getWorkflowMetadata } from "workflow";
import { executeListingQualificationStep } from "./listing-qualification-runtime-steps";
export type ListingQualificationRuntimeInput={businessId:string;qualificationRunId:string;coreWorkflowRunId:string;runtimeCapability:string};
export async function listingQualificationWorkflow(input:ListingQualificationRuntimeInput) {
  "use workflow";
  const {workflowRunId}=getWorkflowMetadata();
  // One paid case per durable step keeps the finite evaluation within each
  // function execution window. Settled cases remain immutable across steps.
  for(let index=0;index<5;index++) {
    const result=await executeListingQualificationStep(input,workflowRunId);
    if(result.status!=="queued" && result.status!=="running")return result;
  }
  throw new FatalError("The fixed listing qualification case limit was reached.");
}
