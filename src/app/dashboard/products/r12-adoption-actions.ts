"use server";
import {requireOwnerUiContext} from '@/lib/core-ui/data';
import {adoptFocusedPilotTest} from '@/creative/focused-owner-server';
export async function adoptR12FocusedTestAction(_previous:{message:string;candidateId:string|null},form:FormData){
 try{if(form.get('reviewed')!=='on')throw Error('review_required');const input=['businessId','scopeId','resultHash'].map(key=>{const values=form.getAll(key);if(values.length!==1||typeof values[0]!=='string')throw Error('invalid');return values[0];});
  const saved=await adoptFocusedPilotTest(await requireOwnerUiContext(),input[0],input[1],input[2]);return {message:'The exact independently reviewed TEST is recorded for separate production design approval. No image or spending permission was created.',candidateId:saved.candidateId};
 }catch{return {message:'The current focused TEST could not be adopted. Its exact result, ownership, freshness and Goal must still match.',candidateId:null};}
}
