import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireOwnerUiContext } from "@/lib/core-ui/data";
import { completeEtsyReadConnection } from "@/connections/server";
import { ETSY_CALLBACK } from "@/connections/contracts";
export const dynamic="force-dynamic";
export const maxDuration=60;
export async function GET(request:Request){
  const destination=new URL("/dashboard/connections",ETSY_CALLBACK),jar=await cookies(),cookie=jar.get("r11-etsy-oauth")?.value;
  jar.delete({name:"r11-etsy-oauth",path:"/api/etsy/r11/callback"});
  try{
    if(!cookie)throw new Error("no_binding");const context=await requireOwnerUiContext();
    const businessId=await completeEtsyReadConnection(context,cookie,new URL(request.url).searchParams);destination.searchParams.set("business",businessId);
    // The persisted receipt, never a query-string success claim, is authoritative.
  }catch{/* No provider, auth, request URL or credential details are logged. */}
  const result=NextResponse.redirect(destination,303);result.headers.set("Cache-Control","private, no-store");result.headers.set("Referrer-Policy","no-referrer");return result;
}
