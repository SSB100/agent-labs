"use client";
import Link from 'next/link';
import {useActionState} from 'react';
import {prepareR12PilotOwnerAction} from '@/app/dashboard/products/r12-pilot-preparation-actions';
import {ResearchSubmitButton} from '@/app/dashboard/research-qualification/submit-button';
import type {R12PilotPreparationInput} from '@/products/discovery-r12-pilot-preparation-contract';
export function ConsoleR12PilotPreparationForm({input,canPrepare}:{input:R12PilotPreparationInput;canPrepare:boolean}){
 const [state,action]=useActionState(prepareR12PilotOwnerAction,{message:'',receipt:null});
 return <><form action={action}>{Object.entries(input).map(([name,value])=><input key={name} type="hidden" name={name} value={value}/>)}
  <label><input type="checkbox" name="reviewed" required/>I reviewed this separate focused Goal and its learning question. Preserve the closed research and all earlier costs.</label>
  <ResearchSubmitButton pendingLabel="Saving focused Goal…" disabled={!canPrepare||!!state.receipt}>Save focused pilot Goal</ResearchSubmitButton>
 </form>{state.message?<p role="status">{state.message}</p>:null}{state.receipt?<section aria-label="Focused pilot preparation receipt"><h2>Focused Goal prepared</h2><p>Scope staging and exact financial confirmation come next. No provider authority or paid call was created.</p>
  <Link href={`/dashboard/quests?business=${input.businessId}&quest=${state.receipt.goalId}`}>Inspect the focused Goal</Link>{' · '}
  <Link href={`/dashboard?view=research&type=r12-review-prepare&business=${input.businessId}&selected=${input.preparationId}`}>Review scoped permission after staging</Link>
  <details><summary>Nonsecret setup receipt</summary><p>These identifiers and verifier hashes cannot dispatch a call by themselves.</p><label>Preparation receipt<textarea readOnly rows={12} value={JSON.stringify(state.receipt,null,2)}/></label></details>
 </section>:null}</>;
}
