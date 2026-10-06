"use server";
import { revalidatePath } from "next/cache";
import { requireOwnerUiContext } from "@/lib/core-ui/data";
import { continueDiscoveryR12, stopDiscoveryR12 } from "@/products/discovery-r12-server";
export type R12ActionState={message:string;version:number};
function selection(form:FormData){const business=form.get('businessId'),scope=form.get('scopeId');if(typeof business!=='string'||typeof scope!=='string')throw Error('selection_required');return{business,scope};}
export async function continueDiscoveryR12Action(_previous:R12ActionState,form:FormData):Promise<R12ActionState>{
 try{const {business,scope}=selection(form),context=await requireOwnerUiContext(),result=await continueDiscoveryR12(context,business,scope);revalidatePath('/dashboard');
  return{version:Date.now(),message:result.status==='completed'?'Research execution completed. Read the decision before considering creative work.':result.reason==='receipt_pending'?'The output is saved. Wait until the next eligible receipt check, then Continue.':result.status==='stopped'?'Research is stopped. Saved results and charges are retained.':result.status==='blocked'?'Further work is blocked. Review the saved phase and operating controls.':'Progress is saved. Continue when the approved window and receipt status allow it.'};
 }catch{return{version:Date.now(),message:'This transition could not be verified. Reload the saved state before retrying; an already dispatched call will not be regenerated.'};}
}
export async function stopDiscoveryR12Action(_previous:R12ActionState,form:FormData):Promise<R12ActionState>{
 try{const {business,scope}=selection(form),context=await requireOwnerUiContext();await stopDiscoveryR12(context,business,scope);revalidatePath('/dashboard');return{version:Date.now(),message:'Stopped. New calls and receipt checks are blocked; existing output and charges are retained.'};}
 catch{return{version:Date.now(),message:'Stop could not be verified. Reload the saved state and use the operating controls if needed.'};}
}
