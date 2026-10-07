"use server";
import {requireOwnerUiContext} from '@/lib/core-ui/data';
import {prepareFocusedCreativeRun,startFocusedCreativeRun,type FocusedRunReceipt} from '@/creative/focused-owner-server';
export type FocusedRunState={message:string;receipt:FocusedRunReceipt|null;workflowRunId:string|null};
export async function focusedCreativeRunAction(previous:FocusedRunState,form:FormData):Promise<FocusedRunState>{
 try{const values=form.getAll('approvalId'),ops=form.getAll('operation'),op=ops[0];if(values.length!==1||typeof values[0]!=='string'||ops.length!==1||!['prepare','start'].includes(String(op)))throw Error('invalid');
  if(op==='prepare'){const receipt=await prepareFocusedCreativeRun(await requireOwnerUiContext(),values[0]);return {message:'The exact creative run is prepared. Confirm and activate its four-call financial scope before starting.',receipt,workflowRunId:receipt.workflowRunId};}
  const outcome=await startFocusedCreativeRun(await requireOwnerUiContext(),values[0]);return {...previous,workflowRunId:outcome.workflowRunId,message:outcome.started?'The approved four-phase workflow has started. Original bytes, costs and receipt waits are retained.':'This workflow launch was already claimed. Inspect the existing run; no second launch was issued.'};
 }catch{return {...previous,message:'The current focused run or its exact scoped permission could not be verified. No additional workflow or provider retry is authorized.'};}
}
