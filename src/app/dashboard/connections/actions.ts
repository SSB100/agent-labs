"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOwnerUiContext } from "@/lib/core-ui/data";
import { beginEtsyReadConnection,qualifyPrintfulEnvironment,disconnectQualifiedConnection } from "@/connections/server";
import { UUID } from "@/connections/contracts";
export async function qualifyConnection(form:FormData){
 const businessId=String(form.get("businessId")??""),grantId=String(form.get("grantId")??""),provider=String(form.get("provider")??"");
 if(!UUID.test(businessId)||!UUID.test(grantId))throw new Error("Exact qualification unavailable");
 const destination=`/dashboard/connections?business=${businessId}`;let url:string|null=null;
 if(form.get("readConsent")!=="on"||form.get("custodyConsent")!=="on")redirect(destination);
 try{
  const context=await requireOwnerUiContext();
  if(provider==="etsy"){
   const flow=await beginEtsyReadConnection(context,businessId,grantId);url=flow.url;
   (await cookies()).set("r11-etsy-oauth",flow.cookie,{httpOnly:true,secure:true,sameSite:"lax",path:"/api/etsy/r11/callback",maxAge:600});
  }else if(provider==="printful")await qualifyPrintfulEnvironment(context,businessId,grantId);
 }catch{/* Status is reread from scoped durable records; no invented success. */}
 revalidatePath("/dashboard/connections");redirect(url??destination);
}

export async function disconnectConnection(form:FormData){
 const businessId=String(form.get("businessId")??"");if(!UUID.test(businessId))throw new Error("Exact Business unavailable");
 try{await disconnectQualifiedConnection(await requireOwnerUiContext(),businessId,String(form.get("connectionId")??""),String(form.get("revision")??""));}catch{/* Persisted status remains authoritative. */}
 revalidatePath("/dashboard/connections");redirect(`/dashboard/connections?business=${businessId}`);
}
