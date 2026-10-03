"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { saveOperatingControl } from "@/app/dashboard/quests/controls/actions";
import type { AdmissionOwnerOperation, AdmissionPauseScope, AdmissionRead, AdmissionScope, OperatingPolicy } from "@/core/admission-contract";
import type { R04Read } from "@/core/quest-contract";

function money(value:string) { const n=BigInt(value); return `${n/BigInt(1000000)}.${(n%BigInt(1000000)).toString().padStart(6,"0")}`; }
function micros(value:string) { if (!/^\d{1,9}(\.\d{1,6})?$/.test(value)) throw Error("Enter a non-negative USD amount with at most six decimal places."); const [whole,fraction=""]=value.split("."); return (BigInt(whole)*BigInt(1000000)+BigInt(fraction.padEnd(6,"0"))).toString(); }

export function OperatingControls({intent,state,ownerId,exactPolicy}:{intent:R04Read;state:AdmissionRead;ownerId:string;exactPolicy:boolean}) {
  const router=useRouter(), pending=useRef(new Map<string,string>());
  const [busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const selected=intent.selected;
  const base=`/dashboard/quests/controls?business=${intent.businessId}${selected?`&quest=${selected.id}`:""}`;
  async function save(operation:AdmissionOwnerOperation,payload:unknown) {
    if (busy) return;
    setBusy(true);setMessage("");
    try {
      const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify({operation,payload})));
      const fingerprint=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,"0")).join("");
      const key=`r05-request:v1:${ownerId}:${intent.businessId}:${fingerprint}`;
      let id=pending.current.get(key);try{id??=sessionStorage.getItem(key)??undefined;}catch{/* Opaque identity remains in memory. */}
      if (!id || !/^[0-9a-f-]{36}$/i.test(id)) id=crypto.randomUUID();
      pending.current.set(key,id);try{sessionStorage.setItem(key,id);}catch{/* No policy contents are stored. */}
      const result=await saveOperatingControl(intent.businessId,operation,payload,id);setMessage(result.message);
      if(result.ok){pending.current.delete(key);try{sessionStorage.removeItem(key);}catch{/* A verified action is complete. */}router.refresh();}
    }catch{setMessage("The response was interrupted. Retry the unchanged request here to recover its result. Keep this page open if session storage is unavailable.");}
    finally{setBusy(false);}
  }
  const scopes:Array<AdmissionPauseScope & {label:string}>=[{kind:"business",id:intent.businessId,label:"This Business"},...(selected?[{kind:"quest" as const,id:selected.id,label:selected.title}]:[]),...intent.references.packs.map(p=>({kind:"pack" as const,id:p.installationId,label:`${p.label} · ${p.version}`})),...intent.references.accounts.map(a=>({kind:"account" as const,id:a.id,label:a.label}))];
  return <div className="questWorkspace">
    <p className="coreNotice">These controls cover bounded USD model costs. Commerce, currency conversion, recurring commitments, loss and margin limits are unavailable. A target is not a profit guarantee; stopping automatically at a target is not qualified.</p>
    {message?<p role="status" className="coreNotice">{message}</p>:null}
    <section aria-labelledby="admission-status"><h2 id="admission-status">Current availability</h2>
      <p>{state.unavailableReason??"Qualified operation definitions are available for review."}</p>
      <p>{state.serverAuthorityConfigured?"Server authority is configured. Each dispatch still requires current eligibility and exact confirmed permission.":"Server dispatch authority is unavailable. Saving a policy does not enable provider work."}</p>
      <h3>Existing exposure</h3><p>Changing Quest or policy never resets this Business’s historical spend or outstanding liability.</p>
      {state.exposure.length?<ul>{state.exposure.map(e=><li key={e.currency}>{e.currency} {money(e.heldMicrounits)} held or spent{e.hasUnknown?" · unresolved liability; confirmation remains blocked":""}</li>)}</ul>:<p>No exposure is recorded.</p>}
      {state.capVersions.map(c=><p key={c.currency}>Business lifetime ceiling: {c.currency} {money(c.maximumMicrounits)} · version {c.revision}</p>)}
    </section>
    <section aria-labelledby="pause-controls"><h2 id="pause-controls">Pause new operations</h2><p>Pause takes effect at the next dispatch boundary. It cannot undo a request already sent. Existing-effect reconciliation preserves outstanding liability; resuming a scope does not start work or renew permission.</p>
      {scopes.map(scope=>{const paused=state.pauseStates.find(p=>p.kind===scope.kind&&p.id===scope.id)?.paused??(state.pauseStatesComplete?false:null);return <div key={`${scope.kind}:${scope.id}`}><p>{scope.label} · {scope.kind} · {paused===null?"status unavailable":paused?"paused":"not paused"}</p><button className="coreButton" disabled={busy||paused===null} onClick={()=>void save(paused?"resume":"pause",{kind:scope.kind,id:scope.id})}>{paused?"Resume":"Pause"} {scope.label}</button></div>;})}
      {!intent.references.accountsComplete||!intent.references.packsComplete?<p>Some scope references are unavailable. Reload before changing an unlisted scope.</p>:null}
    </section>
    <PolicyDraft intent={intent} state={state} busy={busy} onSave={p=>save("propose",p)} />
    <section aria-labelledby="saved-policies"><h2 id="saved-policies">Saved policies</h2><p>Review the saved policy before confirming its exact version. Confirmation grants only the listed scope; it does not start work.</p>
      {!state.policies.length?<p>No policies in this page.</p>:state.policies.map(p=><SavedPolicy key={p.id} entry={p} busy={busy} onSave={save} />)}
      {!exactPolicy?<><Link href={`${base}&offset=${Math.max(0,state.offset-state.limit)}`}>Previous policy page</Link>{" "}<Link href={`${base}&offset=${state.offset+state.limit}`}>Next policy page</Link></>:<Link href={base}>All policy pages</Link>}
    </section>
    <details><summary>Recent admission decisions</summary>{state.decisions.length?<ul>{state.decisions.map((d,i)=><li key={`${d.requestId}:${d.at}:${i}`}>{d.at} · {d.decision} · {d.reason.replaceAll("_"," ")}</li>)}</ul>:<p>No decisions in this page.</p>}</details>
  </div>;
}

function PolicyDraft({intent,state,busy,onSave}:{intent:R04Read;state:AdmissionRead;busy:boolean;onSave:(p:OperatingPolicy)=>Promise<void>}) {
  const [error,setError]=useState("");
  const selected=intent.selected,cap=state.capVersions.find(c=>c.currency==="USD");
  const blocked=!selected||selected.preference!=="ready"||Boolean(selected.content.ambiguities.length)||intent.business.preference!=="setup"||!state.eligibleOperations.length||state.exposure.some(e=>e.hasUnknown);
  function propose(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(blocked||!selected)return;
    try{
      const form=new FormData(event.currentTarget),value=(key:string)=>String(form.get(key)??"").trim();
      const operations:AdmissionScope[]=state.eligibleOperations.filter((_,index)=>form.getAll("operation").includes(String(index))).map(o=>({operationKey:o.operationKey,installationId:o.installationId,workflowDefinitionId:o.workflowDefinitionId,purpose:o.purpose,provider:o.provider,category:o.category,accountId:o.accountId,accountRevision:o.accountRevision,sourceDomains:[...o.sourceDomains],dataClasses:[...o.dataClasses],maximumPerOperationMicrounits:o.maximumPerOperationMicrounits}));
      const start=new Date(value("startsAt")),end=new Date(value("expiresAt"));
      if(!operations.length)throw Error("Choose at least one exact qualified operation.");
      if(!/Z$/.test(value("startsAt"))||!/Z$/.test(value("expiresAt"))||!Number.isFinite(start.valueOf())||!Number.isFinite(end.valueOf())||end<=start)throw Error("Use valid UTC start and expiry timestamps ending in Z, with expiry after start.");
      const limit=micros(value("policyLimit"));
      const p:OperatingPolicy={version:"r05.1",goalId:selected.id,goalRevision:selected.revision,businessRevision:intent.business.revision,currency:"USD",businessLifetimeLimitMicrounits:micros(value("businessLimit")),policyLimitMicrounits:limit,categoryLimits:[{category:"model",microunits:limit}],expectedCapRevision:cap?.revision??0,expectedExposureMicrounits:state.exposure.filter(e=>e.currency==="USD").reduce((sum,e)=>sum+BigInt(e.heldMicrounits),BigInt(0)).toString(),startsAt:start.toISOString(),expiresAt:end.toISOString(),maximumDispatches:Number(value("maximumDispatches")),minimumIntervalSeconds:Number(value("minimumIntervalSeconds")),stopOnTarget:false,operations,financialMode:"bounded_model_cost_only"};
      setError("");void onSave(p);
    }catch(e){setError(e instanceof Error?e.message:"Review the policy fields.");}
  }
  return <details><summary>Propose financial authority{selected?` for ${selected.title}`:""}</summary>
    <p>This is a separate confirmation from saved intent. It binds Business rules v{intent.business.revision} and Quest v{selected?.revision??"unavailable"}. Expiry cannot exceed the Quest deadline or 31 days from the start.</p>
    {blocked?<p>Proposal unavailable: a ready, unambiguous Quest, active Business setup, qualified operation and resolved existing exposure are required.</p>:null}
    {error?<p role="alert">{error}</p>:null}
    <form onSubmit={propose}><fieldset disabled={busy||blocked}><legend>Exact scope and spending limits</legend>
      <label>Business lifetime ceiling (USD)<input name="businessLimit" required inputMode="decimal" defaultValue={cap?money(cap.maximumMicrounits):""}/></label>
      <label>This policy’s model cost ceiling (USD)<input name="policyLimit" required inputMode="decimal"/></label>
      <label>Maximum dispatch count<input name="maximumDispatches" required type="number" min="1" max="999999" step="1"/></label>
      <label>Minimum seconds between dispatches<input name="minimumIntervalSeconds" required type="number" min="0" max="999999" step="1"/></label>
      <label>Authorization starts (UTC)<input name="startsAt" required placeholder="2026-10-04T00:00:00Z"/></label>
      <label>Authorization expires (UTC)<input name="expiresAt" required placeholder="2026-10-05T00:00:00Z"/></label>
      <fieldset><legend>Qualified operations</legend>{state.eligibleOperations.map((o,index)=><label key={`${o.operationKey}:${o.installationId}`}><input type="checkbox" name="operation" value={index}/><span>{o.operationKey} · {o.purpose} · {o.providerModelId}<br/>At most USD {money(o.maximumPerOperationMicrounits)} per dispatch; {o.maximumOutputTokens} output tokens; {o.maximumRequestBytes} request bytes.<br/>Data: {o.dataClasses.join(", ")}. Sources: {o.sourceDomains.join(", ")||"none"}. Eligibility expires {o.validUntil}.<br/>Pack installation {o.installationId}; workflow {o.workflowDefinitionId}.</span></label>)}</fieldset>
      <button className="coreButton" type="submit">Save proposal for review</button>
    </fieldset></form>
  </details>;
}

function SavedPolicy({entry,busy,onSave}:{entry:AdmissionRead["policies"][number];busy:boolean;onSave:(operation:AdmissionOwnerOperation,payload:unknown)=>Promise<void>}) {
  const [reviewed,setReviewed]=useState(false),p=entry.policy;
  return <article><h3>Quest {p.goalId} · version {p.goalRevision} · {entry.revoked?"revoked":entry.confirmed?"confirmed; dispatch remains gated":"awaiting confirmation"}</h3>
    <p>Business rules v{p.businessRevision}. Policy USD {money(p.policyLimitMicrounits)}; Business lifetime USD {money(p.businessLifetimeLimitMicrounits)}; model category USD {money(p.categoryLimits[0].microunits)}. Reviewed exposure USD {money(p.expectedExposureMicrounits)} at cap version {p.expectedCapRevision}.</p>
    <p>From {p.startsAt} until {p.expiresAt}; at most {p.maximumDispatches} dispatches, at least {p.minimumIntervalSeconds} seconds apart. No automatic target stop.</p>
    <ul>{p.operations.map(o=><li key={o.operationKey}>{o.operationKey} · {o.purpose} · {o.provider} · at most USD {money(o.maximumPerOperationMicrounits)} each. Data: {o.dataClasses.join(", ")}; sources: {o.sourceDomains.join(", ")||"none"}. Pack {o.installationId}; workflow {o.workflowDefinitionId}; account {o.accountId??"none"}{o.accountRevision?` revision ${o.accountRevision}`:""}.</li>)}</ul>
    <p>Exact policy {entry.id} · fingerprint {entry.hash}</p>
    {!entry.confirmed&&!entry.revoked?<><label><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>I reviewed this exact financial permission, its scope, exposure and expiry.</label><button className="coreButton" disabled={busy||!reviewed} onClick={()=>void onSave("confirm",{policyId:entry.id,policyHash:entry.hash})}>Confirm this exact policy</button></>:null}
    {!entry.revoked?<button className="coreButton" disabled={busy} onClick={()=>void onSave("revoke",{policyId:entry.id,policyHash:entry.hash})}>Revoke this policy</button>:null}
  </article>;
}
