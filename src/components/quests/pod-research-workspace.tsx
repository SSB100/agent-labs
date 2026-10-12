"use client";
import {useEffect,useState,useTransition} from "react";
import {useRouter} from "next/navigation";
import {confirmPodResearchAction,preparePodResearchAction,resumePodResearchAction,stopPodResearchAction} from "@/app/dashboard/quests/research/pod/actions";
import {ownerResearchUsd,ownerResearchUsdMicrounits} from "@/lib/core-ui/owner-research-form";
import type {PodResearchCatalog,PodResearchEntry,PodResearchReceipt} from "@/products/discovery-r12-pod-owner-contract";
import type {reconstructPodResearchResult} from "@/products/discovery-r12-pod-runtime";
const usd=(v:string|number)=>ownerResearchUsd(String(v));
export type PodRunStatus={state:string;reason:string|null;activeWindow:boolean;receiptUntil:string|null;phases:Array<{phase:string;status:string;reason:string|null}>;cost:{knownMicrousd:string;heldMicrousd:string;hasUnknown:boolean}};
export function PodResearchWorkspace({catalog,selected,status,result}:{catalog:PodResearchCatalog;selected:PodResearchReceipt|null;status:PodRunStatus|null;result:ReturnType<typeof reconstructPodResearchResult>|null}){
 const router=useRouter(),[pending,startTransition]=useTransition(),[message,setMessage]=useState(""),[approved,setApproved]=useState(false);
 const [request,setRequest]=useState<PodResearchEntry|null>(null);
 const receipt=selected,finance=catalog.finance,ready=catalog.business?.ready&&catalog.template&&!finance.hasUnknown;
 useEffect(()=>{if(!receipt?.activated||receipt.stopped||result||["completed","stopped","blocked"].includes(status?.state??""))return;const timer=setInterval(()=>router.refresh(),10000);return()=>clearInterval(timer);},[receipt?.activated,receipt?.stopped,result,status?.state,router]);
 const actionInput=()=>({businessId:catalog.businessId,setupId:receipt!.setupId,setupHash:receipt!.setupHash,submissionId:crypto.randomUUID()});
 const open=(r:PodResearchReceipt)=>{router.push(`/dashboard/quests/research/pod?${new URLSearchParams({business:r.businessId,setup:r.setupId})}`);router.refresh();};
 return <section className="ownerResearchPage" aria-label="Goal-driven POD research">
  <h1>Research print-on-demand opportunities</h1><p>Set the goal and spending limit. Agent Labs forms the queries, selects permitted public sources, compares evidence and independently reviews its recommendation.</p>
  {message?<p role="status">{message}</p>:null}
  {!receipt?<>
   {!catalog.business?.ready?<p role="alert">Your Business operating rules need review before research can start.</p>:!catalog.template?<p role="status">The reviewed research capability is not available yet.</p>:finance.hasUnknown?<p role="alert">An earlier charge is unresolved. {usd(finance.pendingMicrounits)} remains held. New spending is blocked until that exact receipt is reconciled.</p>:null}
   <form onSubmit={event=>{event.preventDefault();const f=new FormData(event.currentTarget),amount=String(f.get("budget")??"");if(!/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(amount)||Number(amount)<=0||Number(amount)>2){setMessage("Enter a positive USD limit of at most $2.");return;}
    const value:PodResearchEntry={businessId:catalog.businessId,publicBrief:{objective:String(f.get("objective")??"").trim(),publicConstraints:[],fulfilmentContext:f.get("printful")==="on"?"printful_available":"unspecified"},maximumMicrounits:ownerResearchUsdMicrounits(amount)!,deadlineAt:new Date(Date.now()+60*60000).toISOString(),submissionId:crypto.randomUUID()};setRequest(value);startTransition(async()=>{const r=await preparePodResearchAction(value);if(r.ok)open(r.receipt);else setMessage(r.message);});}}>
    <label>Research goal<textarea name="objective" required minLength={20} maxLength={1200} defaultValue="Research viable print-on-demand products to sell on Etsy."/></label>
    <label>Maximum for this research pass (USD)<input name="budget" inputMode="decimal" required placeholder="For example, 1.00"/></label>
    <label><input name="printful" type="checkbox"/> Printful is available as fulfilment context</label>
    <p>Enter only the public research brief. Don’t include customer information, private shop records or credentials. No country, audience, theme or product shortlist is required.</p>
    <p>One bounded pass: up to five model calls, including one search with at most four short source excerpts. The result may be insufficient evidence. No Etsy marketplace scraping, shop login, listings or purchases.</p>
    <button disabled={pending||!ready} className="coreButton">Review cost and permissions</button>
   </form>
   {request&&message?<button disabled={pending} onClick={()=>startTransition(async()=>{const r=await preparePodResearchAction(request);if(r.ok)open(r.receipt);else setMessage(r.message);})}>Recover the same review</button>:null}
   {catalog.setups.length?<><h2>Saved research</h2><ul>{catalog.setups.map(r=><li key={r.setupId}><button onClick={()=>open(r)}>{r.preview.publicBrief.objective}</button> · {r.stopped?"Stopped":r.activated?"Approved":"Awaiting approval"}</li>)}</ul></>:null}
  </>:<>
   <h2>{receipt.preview.publicBrief.objective}</h2>
   {!receipt.activated&&!receipt.stopped?<section aria-label="Research permission review">
    <p>Fulfilment context: {receipt.preview.publicBrief.fulfilmentContext === "printful_available" ? "Printful is available" : "No fulfilment service specified"}.</p>
    <p>Additional public constraints: {receipt.preview.publicBrief.publicConstraints.length ? receipt.preview.publicBrief.publicConstraints.join("; ") : "None"}.</p>
    <p>Maximum model and search charge for this pass: <strong>{usd(receipt.preview.quote.maximumMicrousd)}</strong>. Your requested limit is {usd(receipt.preview.finance.runLimitMicrounits)}. This is one pay-as-you-go run using existing provider billing, with no subscription. Existing hosting-plan charges are outside this model/search cap.</p>
    <p>Current Business lifetime cap: {usd(receipt.preview.finance.maximumMicrounits)}. Proposed cumulative cap: {usd(receipt.preview.finance.proposedBusinessLimitMicrounits)}; already committed: {usd(receipt.preview.finance.committedMicrounits)}. Earlier costs stay counted.</p>
    <p>OpenRouter and its Azure model receive the public brief and research queries; Exa receives the bounded public query and domain filters. Amazon Bedrock receives the brief, retained public excerpts and assessment for independent review. Inference is routed with no-training/zero-data-retention controls. Exa may retain queries and use data to improve or train its service. Agent Labs retains attributed evidence and receipts for audit.</p>
    <p>Agent Labs chooses relevant public domains under the reviewed factual-snippet policy. Etsy marketplace domains are excluded from the search. Returned private/account URLs and restricted sources are rejected before evidence is retained; domain filters cannot guarantee which upstream page paths the search provider retrieves. Approval covers query changes within this policy; it does not grant publisher permission or account access.</p>
    <p>New calls may start for 30 minutes after approval. Exact already-sent receipts may be reconciled for another 30 minutes. Stop blocks further use immediately; already incurred charges remain payable. No refund is assumed for completed provider calls.</p>
    <label><input type="checkbox" checked={approved} onChange={e=>setApproved(e.target.checked)}/> I approve this public brief, recipients, bounded source policy and maximum charge.</label>
    <button className="coreButton" disabled={!approved||pending} onClick={()=>{if(!approved||pending)return;startTransition(async()=>{const r=await confirmPodResearchAction(actionInput());if(r.ok){setMessage(r.runtimeStarted?"Research started. You can leave this page; progress and receipts are saved.":"Approval was saved, but starting the background run could not be verified. Reload the saved run before continuing.");open(r.receipt);}else setMessage(r.message);});}}>Approve and research</button>
   </section>:null}
   {receipt.activated?<section aria-label="Saved research progress"><h3>{result?"Research result":receipt.stopped?"Stopped":status?.state??"Approved"}</h3>
    <p>{status?.reason?.replaceAll("_"," ")}</p>{status?<p>Known cost: {usd(status.cost.knownMicrousd)} · Held: {usd(status.cost.heldMicrousd)}{status.cost.hasUnknown?" · Exact receipt unresolved":""}</p>:null}
    <ol>{status?.phases.map(p=><li key={p.phase}>{({plan:"Plan",search1:"Collect evidence",select1:"Select evidence",strategy:"Assess opportunities",review:"Independent review"} as Record<string,string>)[p.phase]??p.phase}: {p.status.replaceAll("_"," ")}</li>)}</ol>
    {!result?<button disabled={pending} onClick={()=>startTransition(async()=>{const r=await resumePodResearchAction(actionInput());setMessage(r.ok?"Continuing the saved operation. Existing requests are reconciled, never blindly resent.":r.message);router.refresh();})}>{receipt.stopped?"Reconcile existing receipt":"Continue saved run"}</button>:null}
   </section>:null}
   {!receipt.stopped?<button disabled={pending} onClick={()=>startTransition(async()=>{const r=await stopPodResearchAction(actionInput());if(r.ok){setMessage("Stopped. Existing receipts and costs remain available.");open(r.receipt);}else setMessage(r.message);})}>Stop research</button>:null}
   {result?<section aria-label="Sourced research result"><h2>{result.review.outcome==="HYPOTHESIS_TO_TEST"?"A hypothesis worth testing":"The evidence is not yet sufficient"}</h2><p>{result.review.rationale}</p><h3>Recommended next test</h3><p>{result.review.nextTest}</p>
    <p>{result.assessment.explorationSummary}</p>{result.assessment.candidates.map((c,i)=><article key={i}><h3>{result.review.outcome === "HYPOTHESIS_TO_TEST" && result.review.candidateIndex === i ? "Recommended hypothesis: " : ""}{c.productType} · {c.niche}</h3><p>Audience: {c.audience}</p><p>{c.rationale}</p><p>Supporting evidence: {c.support.length ? c.support.join(", ") : "None"}. Contrary evidence: {c.counterevidence.length ? c.counterevidence.join(", ") : "None identified in this bounded pass"}.</p><p>Alternative explanation: {c.alternativeExplanation}</p><ul>{c.dimensions.map(d=><li key={d.dimension}><strong>{d.dimension.replaceAll("_"," ")}: {d.verdict}</strong>. {d.rationale} {d.evidence.join(", ")} {d.missing.join("; ")}</li>)}</ul></article>)}
    <h3>Sources and quoted evidence</h3><ol>{result.evidence.map(e=><li key={e.key}><a href={e.url} target="_blank" rel="noreferrer">{e.key}: {e.title}</a><p>{e.quote}</p><small>Retrieved {e.retrievedAt}; publication date not verified</small></li>)}</ol>
    <h3>Independent review</h3><ul>{result.review.checks.map(c=><li key={c.check}><strong>{c.check.replaceAll("_"," ")}: {c.verdict}</strong>. {c.rationale} {c.evidence.join(", ")}</li>)}</ul>
    <h3>What remains unknown</h3><ul>{[...result.review.missingEvidence,...result.evidenceLimitations].map((x,i)=><li key={i}>{x}</li>)}</ul><details><summary>Research provenance</summary><p>Submitted query: {result.submittedQuery}</p><p>{result.sourceChoiceRationale}</p><ul>{result.phaseReceipts.map(r=><li key={r.phase}>{r.phase}: {r.executingRelease.commitSha.slice(0,12)} · {r.executingRelease.deploymentId} · {r.providerRequestId}</li>)}</ul></details>
   </section>:null}
  </>}
 </section>;
}
