"use client";
import {useActionState,useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import {continueDiscoveryR12Action,stopDiscoveryR12Action} from '@/app/dashboard/products/r12-actions';
import {ResearchSubmitButton} from '@/app/dashboard/research-qualification/submit-button';
const initial={message:'',version:0};
export function ConsoleR12Controls({businessId,scopeId,canContinue,canStop,nextEligibleAt,receiptUntil}:{businessId:string;scopeId:string;canContinue:boolean;canStop:boolean;nextEligibleAt?:string|null;receiptUntil?:string|null}){
 const router=useRouter(),[run,runAction]=useActionState(continueDiscoveryR12Action,initial),[stop,stopAction]=useActionState(stopDiscoveryR12Action,initial),[due,setDue]=useState(false),[expired,setExpired]=useState(false);
 const latest=run.version>stop.version?run:stop;
 useEffect(()=>{if(latest.version)router.refresh();},[latest.version,router]);
 useEffect(()=>{if(!nextEligibleAt||!receiptUntil)return;const next=Date.parse(nextEligibleAt),expiry=Date.parse(receiptUntil);if(!Number.isFinite(next)||!Number.isFinite(expiry)||expiry<=next||expiry<=Date.now())return;const timeout=setTimeout(()=>setDue(true),Math.max(0,next-Date.now()));return()=>clearTimeout(timeout);},[nextEligibleAt,receiptUntil]);
 useEffect(()=>{if(!receiptUntil)return;const until=Date.parse(receiptUntil);if(!Number.isFinite(until))return;const timeout=setTimeout(()=>setExpired(true),Math.max(0,until-Date.now()));return()=>clearTimeout(timeout);},[receiptUntil]);
 return <div className="r12Controls"><form action={runAction}><input type="hidden" name="businessId" value={businessId}/><input type="hidden" name="scopeId" value={scopeId}/><ResearchSubmitButton pendingLabel="Saving progress…" disabled={expired||(!canContinue&&!due)}>Continue approved research</ResearchSubmitButton></form><form action={stopAction}><input type="hidden" name="businessId" value={businessId}/><input type="hidden" name="scopeId" value={scopeId}/><ResearchSubmitButton pendingLabel="Stopping…" disabled={!canStop}>Stop research</ResearchSubmitButton></form>{expired?<p className="r12ActionStatus">This window has ended. Reload the saved state.</p>:null}{latest.message?<p role="status" className="r12ActionStatus">{latest.message}</p>:null}</div>;
}
