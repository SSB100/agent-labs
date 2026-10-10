"use client";
import {useEffect,useState} from "react";
import type {AdaptiveOwnerReceipt} from "@/products/discovery-r12-adaptive-owner-contract";
import {readOwnerObservationDisclosureAction} from "@/app/dashboard/quests/research/actions";
type Result=Awaited<ReturnType<typeof readOwnerObservationDisclosureAction>>;
export function OwnerObservationDisclosure({receipt,onVerified}:{receipt:AdaptiveOwnerReceipt;onVerified:(hash:string|null)=>void}) {
  const [result,setResult]=useState<Result|null>(null);
  useEffect(()=>{
    let current=true;onVerified(null);
    const selection=receipt.ownerObservationRef;
    if(!selection)return;
    void readOwnerObservationDisclosureAction(receipt.businessId,receipt.grantId,selection).then(value=>{
      if(!current)return;
      if(value.ok && value.manifestHash!==selection.manifestHash) {setResult({ok:false,message:"Selected capture identity changed. Reload before confirming."});return;}
      setResult(value);if(value.ok)onVerified(value.manifestHash);
    }).catch(()=>{if(current)setResult({ok:false,message:"Capture readback was interrupted. Reload before confirming."});});
    return()=>{current=false;};
  },[receipt.businessId,receipt.grantId,receipt.ownerObservationRef,onVerified]);
  if(!receipt.ownerObservationRef)return null;
  return <section className="ownerObservationDisclosure" aria-label="Exact selected owner capture disclosure"><h3>Exact selected Etsy capture disclosure</h3>
    {!result?<p role="status">Loading the immutable selected records for review…</p>:!result.ok?<p role="alert">{result.message}</p>:result.records.map(record=><div key={record.bundleId}>
      {record.observations.map(o=><article key={o.id}><h4>{o.context.query}</h4><p>{o.source.interface} · {o.source.url}<br/>Captured {o.source.capturedAt}; reporting window {o.context.windowStart} to {o.context.windowEnd}<br/>Account locale {o.context.locale}; buyer geography {o.context.geography.kind}: {o.context.geography.basis}</p><pre>{o.content}</pre><p>{o.limitations.join("; ")}</p><p>Content hash {o.contentHash}. Source capture hash {o.source.captureHash}.</p></article>)}
      {record.baseline?<><h4>Retrospective comparison declaration</h4><p>{record.baseline.hypothesis}</p><p>Success: {record.baseline.positiveCriterion}<br/>Failure: {record.baseline.negativeCriterion}<br/>Inconclusive: {record.baseline.inconclusiveCriterion}</p></>:<p>No fully selected comparable baseline. Withheld or missing observations are unavailable, never zero.</p>}
    </div>)}
    <p>The selected text, attribution, context, limitations and fully selected comparison declaration may reach the inference recipients named in this packet. They remain owner-reported and untrusted, never permission or independent Etsy verification.</p>
  </section>;
}
