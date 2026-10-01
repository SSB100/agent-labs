"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { start } from "workflow/api";
import { requireOwnerUiContext } from "@/lib/core-ui/data";
import { beginListingPreparation, beginListingQualification, listingOwnerRpc } from "@/listing/server";
import { listingRuntimeWorkflow } from "@/workflows/listing-runtime";
import { listingQualificationWorkflow } from "@/workflows/listing-qualification-runtime";
const field=(form:FormData,key:string)=>String(form.get(key)??"");
function done(businessId:string,message:string):never {
  revalidatePath("/dashboard/etsy");revalidatePath("/dashboard/workflows");
  redirect(`/dashboard/etsy?business=${encodeURIComponent(businessId)}&message=${encodeURIComponent(message)}`);
}
export async function startListingPreparation(form:FormData) {
  const context=await requireOwnerUiContext(),businessId=field(form,"businessId");
  if(field(form,"listingConsent")!=="on")done(businessId,"listing-consent-required");
  const amount=field(form,"listingBudgetUsd");
  if(!/^(?:0(?:\.\d{1,2})?|1(?:\.0{1,2})?)$/.test(amount))done(businessId,"listing-budget-invalid");
  const maximumMicrousd=Math.round(Number(amount)*1_000_000);
  let launch:Awaited<ReturnType<typeof beginListingPreparation>>;
  try{launch=await beginListingPreparation(context,businessId,field(form,"sourceArtifactId"),field(form,"inputHash"),maximumMicrousd);}
  catch{done(businessId,"listing-blocked");}
  if(launch.shouldStart) {
    try{await start(listingRuntimeWorkflow,[{businessId,listingRunId:launch.runId,coreWorkflowRunId:launch.workflowRunId,runtimeCapability:launch.runtimeCapability}]);}
    catch{try{await listingOwnerRpc(context,businessId,"fail_launch",{runId:launch.runId,launchNonce:launch.launchNonce});}catch{/* Preserve the existing durable launch; never resend. */}done(businessId,"listing-launch-uncertain");}
  }
  revalidatePath("/dashboard/etsy");redirect(`/dashboard/workflows/${launch.workflowRunId}`);
}
export async function stopListingPreparation(form:FormData) {
  const context=await requireOwnerUiContext(),businessId=field(form,"businessId");
  try{await listingOwnerRpc(context,businessId,"cancel",{runId:field(form,"listingRunId")});}catch{done(businessId,"listing-action-unavailable");}
  done(businessId,"listing-stopped");
}
export async function closeExpiredListingPreparation(form:FormData) {
  const context=await requireOwnerUiContext(),businessId=field(form,"businessId");
  try{await listingOwnerRpc(context,businessId,"close",{runId:field(form,"listingRunId")});}catch{done(businessId,"listing-action-unavailable");}
  done(businessId,"listing-stopped");
}

export async function startListingQualification(form:FormData) {
  const context=await requireOwnerUiContext(),businessId=field(form,"businessId");
  if(field(form,"qualificationConsent")!=="on")done(businessId,"qualification-consent-required");
  const amount=field(form,"qualificationBudgetUsd");
  if(!/^(?:0(?:\.\d{1,2})?|1(?:\.0{1,2})?)$/.test(amount))done(businessId,"listing-budget-invalid");
  let launch:Awaited<ReturnType<typeof beginListingQualification>>;
  try{launch=await beginListingQualification(context,businessId,field(form,"suiteHash"),Math.round(Number(amount)*1_000_000),field(form,"qualificationLaunchNonce"));}
  catch{done(businessId,"qualification-blocked");}
  if(launch.shouldStart) {
    try{await start(listingQualificationWorkflow,[{businessId,qualificationRunId:launch.runId,coreWorkflowRunId:launch.workflowRunId,runtimeCapability:launch.runtimeCapability}]);}
    catch{try{await listingOwnerRpc(context,businessId,"fail_qualification_launch",{runId:launch.runId,launchNonce:launch.launchNonce});}catch{/* Keep the original durable launch, never resend. */}done(businessId,"listing-launch-uncertain");}
  }
  revalidatePath("/dashboard/etsy");redirect(`/dashboard/workflows/${launch.workflowRunId}`);
}
export async function stopListingQualification(form:FormData) {
  const context=await requireOwnerUiContext(),businessId=field(form,"businessId");
  try{await listingOwnerRpc(context,businessId,"cancel_qualification",{runId:field(form,"qualificationRunId")});}catch{done(businessId,"listing-action-unavailable");}
  done(businessId,"listing-stopped");
}
