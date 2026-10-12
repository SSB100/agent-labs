import {createHook,sleep} from "workflow";
import {executePodResearchStep} from "./pod-research-runtime-steps";
export const podResearchResumeToken=(scopeId:string)=>`agent-labs:pod-research:${scopeId}`;
export async function podResearchRuntimeWorkflow(input:{businessId:string;scopeId:string}){
 "use workflow";
 using hook=createHook({token:podResearchResumeToken(input.scopeId)});
 if(await hook.getConflict())return{status:"waiting",reason:"existing_runtime"};
 for(;;){
  const result=await executePodResearchStep(input);
  if(result.status!=="waiting"&&result.status!=="progress")return result;
  const now=Date.now(),wake=result.wakeAt?Date.parse(result.wakeAt):now+1000;
  if(!Number.isFinite(wake)||wake>=Date.parse(result.receiptUntil)||now>=Date.parse(result.receiptUntil))return{status:"stopped",reason:"receipt_window_expired"};
  if(!result.wakeAt&&result.reason!=="continue_saved_progress"&&result.status!=="progress")return result;
  await sleep(new Date(Math.max(now+1000,wake)));
 }
}
