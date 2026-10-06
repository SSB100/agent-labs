"use server";
import {requireOwnerUiContext} from '@/lib/core-ui/data';
import {prepareR12OwnerSetup} from '@/products/discovery-r12-preparation-server';
import type {R12PreparationInput,R12PreparationState} from '@/products/discovery-r12-preparation-contract';
export async function prepareR12OwnerAction(_previous:R12PreparationState,form:FormData):Promise<R12PreparationState>{
 try{
  if(form.get('reviewed')!=='on')throw Error('review_required');
  const input=Object.fromEntries(['businessId','priorRoundId','preparationId','sourceCutoff'].map(key=>{const values=form.getAll(key);if(values.length!==1||typeof values[0]!=='string')throw Error('invalid_field');return[key,values[0]];})) as R12PreparationInput;
  const receipt=await prepareR12OwnerSetup(await requireOwnerUiContext(),input);
  return{message:'Original research Goal saved, marked ready and linked to its existing history. No spending or provider authority was created.',receipt};
 }catch{return{message:'Preparation could not be verified. Keep this setup URL and retry it unchanged to recover an interrupted save. Changed intent or cutoff requires review; a second Goal is not created.',receipt:null};}
}
