"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOwnerUiContext } from "@/lib/core-ui/data";
import { beginEtsyPublication, publicationRpc, runEtsyPublication } from "@/etsy-publication/server";
const field=(form:FormData,key:string)=>String(form.get(key)??"");
function done(businessId:string,message:string):never{revalidatePath("/dashboard/etsy");revalidatePath("/dashboard/needs-you");redirect(`/dashboard/etsy?business=${encodeURIComponent(businessId)}&message=${encodeURIComponent(message)}`);}
export async function publishReviewedEtsyDraft(form:FormData){
  const context=await requireOwnerUiContext(),businessId=field(form,"businessId");
  const consents={publication:field(form,"publicationConsent")==="on",publicData:field(form,"publicDataConsent")==="on",fee:field(form,"feeConsent")==="on",renewal:field(form,"renewalConsent")==="on"};
  if(!Object.values(consents).every(Boolean))done(businessId,"publication-consent-required");
  let status="needs_owner";
  try{const prepared=await beginEtsyPublication(context,businessId,field(form,"draftRunId"),{packageHash:field(form,"packageHash"),reviewHash:field(form,"reviewHash"),preflightHash:field(form,"preflightHash"),disclosureHash:field(form,"disclosureHash"),feeQuoteHash:field(form,"feeQuoteHash")},consents);status=(await runEtsyPublication(context,businessId,String(prepared.runId))).status;}
  catch{done(businessId,"publication-blocked");}
  done(businessId,status==="verified"?"publication-verified":"publication-needs-review");
}
export async function reconcileEtsyPublication(form:FormData){
  const context=await requireOwnerUiContext(),businessId=field(form,"businessId");let status="needs_owner";
  try{status=(await runEtsyPublication(context,businessId,field(form,"runId"),true)).status;}catch{done(businessId,"publication-needs-review");}
  done(businessId,status==="verified"?"publication-verified":"publication-needs-review");
}
export async function stopEtsyPublication(form:FormData){
  const context=await requireOwnerUiContext(),businessId=field(form,"businessId");
  try{await publicationRpc(context,businessId,"cancel",{runId:field(form,"runId")});}catch{done(businessId,"publication-needs-review");}
  done(businessId,"publication-stopped");
}
