"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOwnerUiContext } from "@/lib/core-ui/data";
import { beginEtsyReadConnection,qualifyPrintfulEnvironment,disconnectQualifiedConnection } from "@/connections/server";
import { UUID } from "@/connections/contracts";
import { performEtsyDraftStatusRead,revokeEtsyReadWindow } from "@/connections/refresh-server";
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

export async function readOwnShopDraftStatus(form:FormData){
 const businessId=String(form.get("businessId")??"");if(!UUID.test(businessId))throw new Error("Exact Business unavailable");
 let notice="";
 try{const result=await performEtsyDraftStatusRead(await requireOwnerUiContext(),businessId,String(form.get("windowId")??""),String(form.get("operationId")??""));if(result.status!=="succeeded")notice="&readNotice=check-saved-state";}
 catch{notice="&readNotice=check-saved-state";}
 revalidatePath("/dashboard/connections");redirect(`/dashboard/connections?business=${businessId}${notice}`);
}
export async function stopOwnShopReads(form:FormData){
 const businessId=String(form.get("businessId")??"");if(!UUID.test(businessId))throw new Error("Exact Business unavailable");
 try{await revokeEtsyReadWindow(await requireOwnerUiContext(),businessId,String(form.get("windowId")??""));}catch{/* Saved authority/status is reread; no invented success. */}
 revalidatePath("/dashboard/connections");redirect(`/dashboard/connections?business=${businessId}`);
}
