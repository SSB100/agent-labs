import { getWorkflowMetadata } from "workflow";
import { executeListingPreparation } from "./listing-runtime-steps";
export type ListingRuntimeInput={businessId:string;listingRunId:string;coreWorkflowRunId:string;runtimeCapability:string};
export async function listingRuntimeWorkflow(input:ListingRuntimeInput) {
  "use workflow";
  const {workflowRunId}=getWorkflowMetadata();
  return executeListingPreparation(input,workflowRunId);
}
