"use client";
import Link from 'next/link';
import {useActionState} from 'react';
import {adoptR12FocusedTestAction} from '@/app/dashboard/products/r12-adoption-actions';
import {ResearchSubmitButton} from '@/app/dashboard/research-qualification/submit-button';
export function ConsoleR12AdoptionForm({businessId,scopeId,resultHash}:{businessId:string;scopeId:string;resultHash:string}){
 const [state,action]=useActionState(adoptR12FocusedTestAction,{message:'',candidateId:null});
 return <section aria-label="Adopt focused TEST for design approval"><h2>Prepare separate production design approval</h2><p>This records the exact focused TEST as a candidate. The next approval must specify the original design, print requirements, provider terms and budget.</p>
  <form action={action}><input type="hidden" name="businessId" value={businessId}/><input type="hidden" name="scopeId" value={scopeId}/><input type="hidden" name="resultHash" value={resultHash}/><label><input type="checkbox" name="reviewed" required/>I reviewed this focused TEST and its limits. Preserve it for separate private production-design approval.</label><ResearchSubmitButton pendingLabel="Checking the exact TEST…" disabled={!!state.candidateId}>Adopt focused TEST</ResearchSubmitButton></form>
  {state.message?<p role="status">{state.message}</p>:null}{state.candidateId?<Link href={`/dashboard/artifacts?business=${businessId}&candidate=${state.candidateId}&panel=production`}>Review the production design approval</Link>:null}
 </section>;
}
