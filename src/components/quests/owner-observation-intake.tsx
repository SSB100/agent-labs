"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { OwnerObservationBundle, OwnerObservationSelection } from "@/products/discovery-r12-owner-observation";
import type { OwnerObservationIntake } from "@/products/discovery-r12-owner-observation-intake";
import { listOwnerObservationsAction, saveOwnerObservationAction } from "@/app/dashboard/quests/research/actions";

type Item = { bundle: OwnerObservationBundle; selection: OwnerObservationSelection };
type Props = { businessId:string; grantId:string; disabled:boolean; selectionLocked?:boolean; onBusyChange?:(busy:boolean)=>void;
  selection:OwnerObservationSelection|null; onSelect:(selection:OwnerObservationSelection|null)=>void };
const blankRow=()=>({id:crypto.randomUUID(),query:"",url:"",interface:"",capturedAt:"",content:"",excerpt:"",limitations:""});
const instant=(value:string)=>new Date(`${value}Z`).toISOString();

export function OwnerObservationIntakeForm({businessId,grantId,disabled,selectionLocked=false,selection,onSelect,onBusyChange}:Props) {
  const id=useId(),mounted=useRef(true),generation=useRef(0),pending=useRef(false);
  const [items,setItems]=useState<Item[]>([]),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
  const [rows,setRows]=useState<ReturnType<typeof blankRow>[]>([]);
  const [common,setCommon]=useState({productFormat:"",category:"",windowStart:"",windowEnd:"",locale:""});
  const [baseline,setBaseline]=useState({hypothesis:"",positiveCriterion:"",negativeCriterion:"",inconclusiveCriterion:""});
  const [comparison,setComparison]=useState(false),[privacy,setPrivacy]=useState(false),[review,setReview]=useState<OwnerObservationIntake|null>(null);
  useEffect(()=>{const token=generation;mounted.current=true;return()=>{mounted.current=false;token.current++;};},[]);
  useEffect(()=>{const token=++generation.current;
    void listOwnerObservationsAction(businessId,grantId).then(result=>{if(!mounted.current||token!==generation.current)return;
      if(result.ok)setItems(result.items);else setMessage(result.message);}).catch(()=>{if(mounted.current&&token===generation.current)setMessage("Saved capture history could not be loaded. Retry after reloading.");});
  },[businessId,grantId]);
  const update= (action:()=>void)=>{setReview(null);setPrivacy(false);action();};
  function prepareReview() {
    if(pending.current||disabled)return;
    try {
      if(rows.length<1 || comparison && ![3,4].includes(rows.length)) {setMessage("Add two or three candidates followed by one negative/reference capture for a comparison, or save exploratory evidence without a baseline.");return;}
      setReview({id:crypto.randomUUID(),createdAt:new Date().toISOString(),...common,
        windowStart:instant(common.windowStart),windowEnd:instant(common.windowEnd),
        observations:rows.map(row=>({...row,capturedAt:instant(row.capturedAt)})),baseline:comparison?baseline:null,privacyReviewed:true});
      setPrivacy(false);setMessage("");
    } catch {setMessage("Enter valid capture and reporting-window dates before reviewing.");}
  }
  async function save() {
    if(!review||!privacy||pending.current||disabled)return;
    pending.current=true;setBusy(true);onBusyChange?.(true);const token=generation.current;
    try {
      const result=await saveOwnerObservationAction(businessId,grantId,review);
      if(!mounted.current||token!==generation.current)return;
      if(!result.ok){setMessage(result.message);return;}
      setItems(previous=>[result,...previous.filter(item=>item.bundle.id!==result.bundle.id)].slice(0,20));
      if(!selectionLocked)onSelect(result.selection);setReview(null);setRows([]);setPrivacy(false);
      setMessage(selectionLocked?"Immutable capture saved privately. This existing packet keeps its exact approved selection; a saved capture cannot add execution authority.":"Immutable owner capture saved and selected. No Etsy access or paid call occurred. Review its disclosure again in the research packet before any execution.");
    } catch {if(mounted.current&&token===generation.current)setMessage("Save was interrupted. Retry this unchanged reviewed capture to recover its saved receipt; success was not assumed.");}
    finally {if(mounted.current&&token===generation.current){pending.current=false;setBusy(false);onBusyChange?.(false);}}
  }
  return <section className="ownerObservationIntake" aria-label="Etsy owner observations">
    <h3>Actual Etsy observations</h3>
    <p>Copy aggregate facts you can see in Etsy. Save exact displayed text, including weak or missing results. This records your capture and attribution; it does not independently verify Etsy, convert labels into percentages, infer buyer geography, or establish profit.</p>
    {message?<p role="status">{message}</p>:null}
    <fieldset disabled={disabled||busy||selectionLocked}><legend>Saved capture selection</legend>
      <label htmlFor={`${id}-saved`}>Reviewed immutable capture bundle</label>
      <select id={`${id}-saved`} value={selection?.manifest[0]?.bundleId??""} onChange={event=>onSelect(items.find(item=>item.bundle.id===event.target.value)?.selection??null)}>
        <option value="">No owner capture selected</option>{selection&&!items.some(item=>item.bundle.id===selection.manifest[0]?.bundleId)?<option value={selection.manifest[0].bundleId}>Exact saved selection · {selection.manifest[0].bundleId}</option>:null}{items.map(item=><option key={item.bundle.id} value={item.bundle.id}>{item.bundle.createdAt} · {item.bundle.observations.map(o=>o.context.query).join(" / ")}</option>)}
      </select>
      <p>Selection includes all displayed records and the comparison declaration in that bundle. They may reach the inference providers named in the exact approval packet. Saving alone stays private.</p>
      {items.filter(item=>item.bundle.id===selection?.manifest[0]?.bundleId).map(item=><div key={item.bundle.id}>
        {item.bundle.observations.map(o=><details key={o.id}><summary>{o.context.query} · {o.source.capturedAt}</summary><p>{o.source.interface} · {o.source.url}</p><p>{o.context.windowStart} to {o.context.windowEnd} · account locale {o.context.locale} · buyer geography unknown</p><pre>{o.content}</pre><p>{o.limitations.join("; ")}</p></details>)}
        <p>Content identity: {item.bundle.bundleHash}. {item.bundle.baseline?"Retrospective comparison with negative/reference capture.":"Exploratory observations; no comparable baseline asserted."}</p>
      </div>)}
    </fieldset>
    <details><summary>Save a new Etsy capture</summary>
      <fieldset disabled={disabled||busy||!!review}><legend>Shared reporting context</legend>
        {([['productFormat','Product format'],['category','Category'],['windowStart','Reporting window starts (UTC)'],['windowEnd','Reporting window ends (UTC)'],['locale','Account display locale']] as const).map(([key,label])=><div className="ownerResearchField" key={key}><label htmlFor={`${id}-${key}`}>{label}</label><input id={`${id}-${key}`} type={key.startsWith('window')?'datetime-local':'text'} maxLength={160} value={common[key]} onChange={event=>update(()=>setCommon({...common,[key]:event.target.value}))}/></div>)}
        {rows.map((row,index)=><fieldset key={row.id}><legend>Capture {index+1}{comparison&&index===rows.length-1?' · negative/reference':''}</legend>
          {([['query','Observed search term / hypothesis'],['url','Exact Etsy interface URL (no query parameters)'],['interface','Interface name'],['capturedAt','Captured at (UTC)'],['content','Exact displayed aggregate source text'],['excerpt','Exact citable excerpt from that text (up to 160 characters)'],['limitations','Coverage, units/currency, missing values and limitations']] as const).map(([key,label])=><div className="ownerResearchField" key={key}><label htmlFor={`${id}-${row.id}-${key}`}>{label}</label>{key==='content'||key==='limitations'?<textarea id={`${id}-${row.id}-${key}`} maxLength={key==='content'?3000:300} value={row[key]} onChange={event=>update(()=>setRows(rows.map((v,i)=>i===index?{...v,[key]:event.target.value}:v)))}/>:<input id={`${id}-${row.id}-${key}`} type={key==='capturedAt'?'datetime-local':'text'} maxLength={key==='url'?800:160} value={row[key]} onChange={event=>update(()=>setRows(rows.map((v,i)=>i===index?{...v,[key]:event.target.value}:v)))}/>}</div>)}
          <button type="button" onClick={()=>update(()=>setRows(rows.filter((_,i)=>i!==index)))}>Remove unsaved capture {index+1}</button>
        </fieldset>)}
        <button type="button" disabled={rows.length>=4} onClick={()=>update(()=>setRows([...rows,blankRow()]))}>Add capture</button>
        <label><input type="checkbox" checked={comparison} onChange={event=>update(()=>setComparison(event.target.checked))}/>Declare a retrospective baseline: two or three candidates, then a distinct negative/reference term</label>
        {comparison?Object.entries({hypothesis:'Falsifiable hypothesis',positiveCriterion:'Success criterion / useful next experiment',negativeCriterion:'Failure criterion',inconclusiveCriterion:'Inconclusive criterion'}).map(([key,label])=><div className="ownerResearchField" key={key}><label htmlFor={`${id}-${key}`}>{label}</label><textarea id={`${id}-${key}`} maxLength={600} value={baseline[key as keyof typeof baseline]} onChange={event=>update(()=>setBaseline({...baseline,[key]:event.target.value}))}/></div>):null}
        <button type="button" disabled={!rows.length} onClick={prepareReview}>Review capture before saving</button>
      </fieldset>
      {review?<section aria-label="Review owner capture"><h4>Review exact private capture</h4><pre>{JSON.stringify(review,null,2)}</pre><p>The final record is immutable. Changes become a new capture; older negative findings remain. Capture text is untrusted evidence and cannot grant permission.</p><label><input type="checkbox" disabled={busy||disabled} checked={privacy} onChange={event=>setPrivacy(event.target.checked)}/>I checked these exact aggregate observations contain no credentials, customer information or other personal data.</label><button type="button" disabled={!privacy||busy||disabled} onClick={()=>void save()}>Save this exact capture</button><button type="button" disabled={busy||disabled} onClick={()=>{setReview(null);setPrivacy(false);}}>Back to edit</button></section>:null}
    </details>
  </section>;
}
