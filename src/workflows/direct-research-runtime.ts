import {createHook,getWorkflowMetadata} from 'workflow';
import type {PublicResearchRuntimeInput} from '../products/discovery-r12-public-runtime';
import {executeDirectResearchPhase} from './direct-research-runtime-steps';
export const directResearchResumeToken=(scopeId:string)=>`agent-labs:direct-etsy-reconcile:${scopeId}`;
export async function directResearchRuntimeWorkflow(input:PublicResearchRuntimeInput){
 'use workflow';
 const {workflowRunId}=getWorkflowMetadata();
 using hook=createHook<{operation:'reconcile'}>({token:directResearchResumeToken(input.scopeId)});
 // Registration is committed before any phase. A duplicate hosting invocation
 // cannot acquire the hook or perform a second SQL attachment/paid operation.
 const conflict=await hook.getConflict();if(conflict)return{continue:false,reason:'existing_runtime_requires_reconciliation',questComplete:false};
 const signals=hook[Symbol.asyncIterator]();
 for(;;){
  let result;
  try{result=await executeDirectResearchPhase(input,workflowRunId);}
  catch{result={continue:false,reason:'durable_receipt_reconciliation_required',questComplete:false};}
  if(result.continue)continue;
  if(result.reason==='research_window_complete'||result.reason==='existing_runtime_requires_reconciliation')return result;
  // A pause retains the same immutable runtime identity. Only the authenticated
  // owner server can resume this hook; SQL decides receipt-only vs fresh work.
  await signals.next();
 }
}
