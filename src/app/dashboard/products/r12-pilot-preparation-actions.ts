"use server";
import {requireOwnerUiContext} from '@/lib/core-ui/data';
import {prepareR12PilotGoal} from '@/products/discovery-r12-pilot-preparation-server';
import type {R12PilotPreparationInput,R12PilotPreparationState} from '@/products/discovery-r12-pilot-preparation-contract';
export async function prepareR12PilotOwnerAction(_previous:R12PilotPreparationState,form:FormData):Promise<R12PilotPreparationState>{
 try{
  if(form.get('reviewed')!=='on')throw Error('review_required');
  const input=Object.fromEntries(['businessId','sourceScopeId','preparationId','setupUntil'].map(key=>{const values=form.getAll(key);if(values.length!==1||typeof values[0]!=='string')throw Error('invalid_field');return[key,values[0]];})) as R12PilotPreparationInput;
  const receipt=await prepareR12PilotGoal(await requireOwnerUiContext(),input);
  return {message:'The focused pilot Goal is saved and ready. The closed broad research and cumulative funding history are preserved. Separate scope and financial confirmation are still required.',receipt};
 }catch{return {message:'The stopped source and this exact preparation could not be verified. Retry the same setup URL to recover an interrupted save; changed inputs cannot create another pilot from that save.',receipt:null};}
}
