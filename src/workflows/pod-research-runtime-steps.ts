import {FatalError} from "workflow";
import {continuePodResearchRuntime} from "../products/discovery-r12-server";
export async function executePodResearchStep(input:{businessId:string;scopeId:string}){
 "use step";
 try{return await continuePodResearchRuntime(input.businessId,input.scopeId);}
 catch(error){
  // The database detail can contain authority arguments. Expose only this
  // fixed, allowlisted category; retain fail-closed, zero automatic retries.
  const reason=error instanceof Error&&error.message==="quest_controller_statement_cancelled"?"Database statement was cancelled or timed out. ":"";
  throw new FatalError(`${reason}Research paused. Reconcile the existing attempt and cost before continuing; no replacement call was started.`);
 }
}
// A hosting retry never resends a paid request. Resumption reads exact R07 state.
executePodResearchStep.maxRetries=0;
