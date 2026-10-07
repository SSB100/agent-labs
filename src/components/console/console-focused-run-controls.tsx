"use client";
import Link from 'next/link';
import {useActionState} from 'react';
import {focusedCreativeRunAction} from '@/app/dashboard/artifacts/focused-actions';
import {ProductSubmitButton} from '@/components/stage13/products-workspace';
export function ConsoleFocusedRunControls({approvalId,businessId,goalId}:{approvalId:string;businessId:string;goalId:string}){
 const [state,action]=useActionState(focusedCreativeRunAction,{message:'',receipt:null,workflowRunId:null});
 return <section aria-label="Focused production run controls"><p>Preparation creates this one private workflow with time-limited access. After its separately approved financial scope is activated, start the four-phase workflow. One image, no repair or repeated generation.</p><form action={action}><input type="hidden" name="approvalId" value={approvalId}/><input type="hidden" name="operation" value="prepare"/><ProductSubmitButton pendingText="Preparing exact run…">{state.receipt?'Recover prepared creative run':'Prepare focused creative run'}</ProductSubmitButton></form>
  {state.receipt?<><details><summary>Nonsecret creative setup receipt</summary><label>Creative setup receipt<textarea readOnly rows={12} value={JSON.stringify(state.receipt,null,2)}/></label></details><form action={action}><input type="hidden" name="approvalId" value={approvalId}/><input type="hidden" name="operation" value="start"/><ProductSubmitButton pendingText="Checking active scope…">Start scoped production design</ProductSubmitButton></form></>:null}
  {state.message?<p role="status">{state.message}</p>:null}{state.workflowRunId?<Link href={`/dashboard/workflows/${state.workflowRunId}?business=${businessId}`}>Inspect the exact creative workflow</Link>:null}{' · '}<Link href={`/dashboard/quests/controls?business=${businessId}&quest=${goalId}`}>Review or stop financial permission</Link>
 </section>;
}
