import {FatalError} from "workflow";
import {continuePodResearchRuntime} from "../products/discovery-r12-server";
export async function executePodResearchStep(input:{businessId:string;scopeId:string}){
 "use step";
 try{return await continuePodResearchRuntime(input.businessId,input.scopeId);}
 catch{throw new FatalError("Research paused. Reconcile the existing attempt and cost before continuing; no replacement call was started.");}
}
// A hosting retry never resends a paid request. Resumption reads exact R07 state.
executePodResearchStep.maxRetries=0;
