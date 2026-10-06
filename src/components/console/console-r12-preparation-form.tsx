"use client";
import Link from 'next/link';
import {useActionState} from 'react';
import {prepareR12OwnerAction} from '@/app/dashboard/products/r12-preparation-actions';
import {ResearchSubmitButton} from '@/app/dashboard/research-qualification/submit-button';
import type {R12PreparationInput,R12PreparationReceipt} from '@/products/discovery-r12-preparation-contract';
export function ConsoleR12PreparationForm({input,receipt:initial,canPrepare}:{input:R12PreparationInput;receipt:R12PreparationReceipt|null;canPrepare:boolean}){
 const [state,action]=useActionState(prepareR12OwnerAction,{message:'',receipt:initial});const receipt=state.receipt??initial;
 return <><form action={action}>{Object.entries(input).map(([name,value])=><input key={name} type="hidden" name={name} value={value}/>)}
  <label><input type="checkbox" name="reviewed" required/>I reviewed the exact original Goal, deadline and history association. Save intent only.</label>
  <ResearchSubmitButton pendingLabel="Saving original intent…" disabled={!!receipt||!canPrepare}>Save original Goal and prepare setup</ResearchSubmitButton>
 </form>{state.message?<p role="status">{state.message}</p>:null}{receipt?<section aria-label="Verified preparation receipt"><h2>Original research setup prepared</h2><p>The original funding history is linked. The operator must separately stage the reviewed installation and operations before financial confirmation. This preparation did not enroll a scope or key. Current permissions are shown in Research and the operating controls.</p>
  <Link href={`/dashboard/quests?business=${receipt.businessId}&quest=${receipt.goalId}`}>Inspect the original Goal and association</Link>{' · '}<Link href={`/dashboard/quests/controls?business=${receipt.businessId}&quest=${receipt.goalId}`}>Review financial permission after staging</Link>
  <details><summary>Nonsecret operator setup receipt</summary><p>These identifiers and verifier hashes cannot dispatch work by themselves. No key or session token is included.</p><label>Setup receipt<textarea readOnly rows={12} value={JSON.stringify(receipt,null,2)}/></label></details>
  <Link href={`/dashboard?view=research&type=r12&business=${receipt.businessId}&selected=${receipt.preparationId}&quest=${receipt.goalId}`}>Open research after scoped activation</Link>
 </section>:null}</>;
}
