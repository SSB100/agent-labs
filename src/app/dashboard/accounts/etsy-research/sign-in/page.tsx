import {notFound} from 'next/navigation';
import {requireOwnerUiContext} from '@/lib/core-ui/data';
import {readPrivateEtsySteelOwnerHandoff} from '@/accounts/etsy-steel-handoff-server';
import {handoffUuid} from '@/accounts/etsy-steel-handoff-contracts';
import {finishEtsyResearchSignIn} from '../actions';
export const dynamic='force-dynamic';export const revalidate=0;export const maxDuration=300;
export const metadata={robots:{index:false,follow:false},referrer:'no-referrer' as const};
/** Owner-authenticated private rendering only. Never include this URL in a
 * catalog, redirect, telemetry payload, model context or release artifact. */
export default async function EtsyOwnerSignIn({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const context=await requireOwnerUiContext(),q=await searchParams;
 const businessId=typeof q.business==='string'?q.business:'',operationId=typeof q.operation==='string'?q.operation:'',handoffId=typeof q.handoff==='string'?q.handoff:'';
 if(![businessId,operationId,handoffId].every(handoffUuid))notFound();
 let handoff:Awaited<ReturnType<typeof readPrivateEtsySteelOwnerHandoff>>|null=null;
 try{handoff=await readPrivateEtsySteelOwnerHandoff(context,businessId,operationId,handoffId);}catch{/* Closed, expired or unapproved handoffs never render a URL. */}
 return <main data-agent-labs-secure="true" data-private="true"><h1>Your private Etsy sign-in</h1>
 <p>Enter credentials only in the Etsy page below. Agent Labs has disconnected its observers. Steel still records the session under the disclosure you approved.</p>
 {handoff?<><p>This session expires at {handoff.expiresAt}. Verify the Etsy destination before entering anything. Do not accept unexpected account or subscription changes.</p><iframe src={handoff.viewerUrl} title="Owner-controlled Etsy sign-in in Steel" referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-forms" style={{width:'100%',height:'70vh',border:0}}/></>:<p role="alert">This private sign-in is unavailable or expired.</p>}
 <form action={finishEtsyResearchSignIn}><input type="hidden" name="businessId" value={businessId}/><input type="hidden" name="operationId" value={operationId}/><input type="hidden" name="handoffId" value={handoffId}/>{handoff&&<button name="action" value="return">I have finished signing in</button>}<button name="action" value="stop">Stop and close this session</button></form>
 </main>;
}
