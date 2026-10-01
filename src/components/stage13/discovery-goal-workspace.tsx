import Link from "next/link";
import {ProductSubmitButton} from "./products-workspace";
import {startGeographicDiscovery,refreshGeographicDiscovery} from "@/app/dashboard/products/discovery-actions";
import {DISCOVERY_GOAL_DEFAULT,DISCOVERY_MARKET_SCOPE} from "@/products/discovery-v2-goal";
import type {DiscoveryGoalData,DiscoveryGoalRecord} from "@/products/discovery-v2-data";
import type {DiscoveryIntentV2,EvidenceRefV2} from "@/products/discovery-v2";
export type DiscoveryQuotePreview={one:number;two:number;verifiedAt:string}|null;
function money(value:number){return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:6}).format(value/1e6);}
function safeUrl(value:unknown){if(typeof value!=='string')return null;try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}}
const names:Record<string,string>={US:'United States',GB:'United Kingdom',AU:'Australia',NZ:'New Zealand'};
function goalTitle(intent:DiscoveryIntentV2|null){return intent?.objective||'Preserved geographic research goal';}
export function DiscoveryGoalForm({businesses,available,quote}:{businesses:{id:string;name:string}[];available:boolean;quote:DiscoveryQuotePreview}){
  const ready=available&&quote!==null&&businesses.length>0;
  return <section className="productCreate" id="discovery-goal" aria-labelledby="discovery-goal-title">
    <div className="sectionTitleRow"><div><p className="coreEyebrow">Goal → Research → Strategy → Independent review</p><h2 id="discovery-goal-title">Give your research a goal</h2></div><span className="productTag">Bounded qualification workflow</span></div>
    <p>{DISCOVERY_MARKET_SCOPE}</p>
    {!available?<p className="coreNotice" role="status">This version is awaiting its registered workflow and safety checks. Saved research remains available below.</p>:null}
    {available&&!quote?<p className="coreNotice" role="status">Current provider prices are unavailable. Research cannot start until its complete quote is verified.</p>:null}
    <form action={startGeographicDiscovery} className="productForm productCreateForm">
      <label htmlFor="goal-business">Business<select id="goal-business" name="businessId" required defaultValue={businesses[0]?.id}>{businesses.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <label htmlFor="research-goal">What do you want to learn?<textarea id="research-goal" name="goal" rows={3} minLength={20} maxLength={1200} required defaultValue={DISCOVERY_GOAL_DEFAULT}/><small>This workflow researches original POD T-shirts. It returns a supported recommendation, alternatives and unanswered questions.</small></label>
      <label htmlFor="goal-audience">Optional audience constraint<input id="goal-audience" name="audienceHint" maxLength={160} placeholder="Leave blank to explore adult outdoor and nature audiences"/><small>The app proposes the concepts and research questions. You don’t need to choose the winning market.</small></label>
      <div className="productFormGrid"><label htmlFor="goal-collections">Fixed research scope<select id="goal-collections" name="maximumCollections" defaultValue="1"><option value="1">One source collection · 5 paid calls</option><option value="2">Two source collections · 7 paid calls</option></select><small>{quote?`Current complete estimates: ${money(quote.one)} for one collection; ${money(quote.two)} for two. Checked ${new Date(quote.verifiedAt).toISOString()}.`:'No verified price quote'}</small></label>
        <label htmlFor="goal-allowance">Research allowance (USD)<input id="goal-allowance" name="maximumUsd" inputMode="decimal" type="number" min="0.000001" max="1" step="0.000001" defaultValue="0.50" required/><small>The full fresh estimate must fit this allowance. Calls stop on uncertain charges; there is no automatic retry.</small></label></div>
      <p className="productSubtle">The finite process plans the query, collects public sources, selects exact quotations, evaluates nine product dimensions and obtains an independent review. A limited result may honestly need more evidence. Seller bank country remains unknown; any fee scenarios are labelled. Original goals and receipts stay private to this Business.</p>
      <label className="productCheckbox"><input type="checkbox" name="confirmResearch" value="on" required disabled={!ready}/><span>I approve only this bounded research process and its allowance through the existing OpenRouter connection. A recommendation does not approve image generation, listings, advertising or purchases.</span></label>
      <div className="productCreateFooter"><ProductSubmitButton disabled={!ready} pendingText="Reserving the research workflow…">Start bounded research</ProductSubmitButton><p>Repeated submissions reuse the saved goal. A later evidence refresh needs a focused reason and the remaining shared allowance.</p></div>
    </form>
  </section>;
}
function EvidenceQuote({reference,relevance,record}:{reference:EvidenceRefV2;relevance?:string;record:DiscoveryGoalRecord}){
  const pack=record.sourcePacks.find(item=>item.id===reference.artifactId)?.content.evidencePack as {sources?:{id:string;contentHash:string;excerpt:string;url:string}[];evidence?:{id:string;sourceId:string;quote:string}[]}|undefined;
  const source=pack?.sources?.find(s=>s.id===reference.sourceId&&s.contentHash===reference.sourceContentHash);
  const selected=pack?.evidence?.find(e=>e.id===reference.evidenceId&&e.sourceId===reference.sourceId);
  const quote=source?Array.from(source.excerpt).slice(reference.start,reference.end).join(''):null;
  const url=safeUrl(source?.url);
  if(!quote||!selected||!selected.quote.includes(quote))return <p>Exact citation unavailable in this view; inspect its preserved workflow artifact.</p>;
  return <div>{relevance?<p>{relevance}</p>:null}<blockquote>{quote}</blockquote>{url?<a href={url} target="_blank" rel="noreferrer">Read this evidence source</a>:null}</div>;
}
function DiscoveryResult({record}:{record:DiscoveryGoalRecord}){
  const {root,strategy,dossier}=record;
  const review=root.status==="completed"?record.review:null;
  const selected=dossier?.shortlist?.find(c=>c.id===review?.candidateId);
  const assessment=strategy?.candidates?.find(c=>c.candidateId===review?.candidateId);
  return <article className="productCard">
    <div className="sectionTitleRow"><h3>{goalTitle(record.intent)}</h3><span className="productTag">{review?.outcome?.replaceAll('_',' ')||root.status}</span></div>
    <p className="productSubtle">{root.created_at} · <Link className="productTextLink" href={`/dashboard/workflows/${root.workflow_run_id}`}>Workflow, costs and receipts</Link></p>
    {root.failure?<p role="status">{root.failure} The failed history is preserved; no automatic retry is running.</p>:null}
    {record.review&&!review?<p>The independent review output is preserved in the workflow, but final registry validation has not accepted it as a recommendation.</p>:null}
    {!review?<p>{root.status==='completed'?'A readable final review is not available here; inspect the preserved workflow result.':'The recommendation appears only after the independent review completes.'}</p>:<>
      <h4>{review.marketCountryCode?`${names[review.marketCountryCode]??review.marketCountryCode} · `:''}{selected?.concept||'No candidate selected'}</h4>
      <p>{review.sufficiencyRationale}</p>
      <p className="productSubtle">This is a research recommendation. Owner creative approval, fresh funding, concept-specific rights/IP screening and print validation remain required before any creative execution.</p>
      {strategy?.marketComparisons?.length?<details><summary>Compared geographic markets</summary>{strategy.marketComparisons.map(m=><section key={m.countryCode}><h5>{names[m.countryCode]??m.countryCode} · {m.currency}</h5><p>{m.assessment}</p>{m.evidenceRefs.map((reference,i)=><EvidenceQuote key={i} reference={reference} record={record}/>)}<ul>{[...m.assumptions,...m.limitations].map((value,i)=><li key={i}>{value}</li>)}</ul>{m.feeScenarios.map((f,i)=><p key={i}>Hypothetical seller-bank scenario {f.sellerBankCountry}: {f.explanation}</p>)}</section>)}</details>:null}
      {assessment?<details><summary>Nine-dimensional evidence review</summary>{assessment.dimensions.map(d=><section key={d.dimension}><h5>{d.dimension.replaceAll('_',' ')} · {d.finding}</h5><p>{d.rationale}</p>{d.facts.map((fact,i)=><EvidenceQuote key={i} reference={fact.reference} relevance={fact.relevance} record={record}/>)}<p>Evidence strength: {d.evidenceStrength}</p><ul>{d.uncertainties.map((u,i)=><li key={i}>{u.question} {u.reason} {u.blockingForTest?'Blocks this test.':'Retained uncertainty.'}</li>)}</ul><p>{review.dimensions.find(r=>r.dimension===d.dimension)?.rationale}</p></section>)}</details>:null}
      {review.missingQuestions?.length?<section><h4>What still needs to be learned</h4><ul>{review.missingQuestions.map((q,i)=><li key={i}>{q}</li>)}</ul><p>A follow-up must target a recorded gap and fit the original shared research allowance. This result does not start it automatically.</p></section>:null}
      {review.outcome==='TEST'&&strategy?.testPlan?<section><h4>Proposed learning experiment: {strategy.testPlan.name}</h4><p>{strategy.testPlan.hypothesis}</p><p>{strategy.testPlan.deliverable}</p><p>Proposed ceiling: {money(strategy.testPlan.maximumMicrousd)}. No funding or generation is authorized by this proposal.</p><ul>{strategy.testPlan.successCriteria.map((c,i)=><li key={`s${i}`}>Success: {c}</li>)}{strategy.testPlan.failureCriteria.map((c,i)=><li key={`f${i}`}>Failure: {c}</li>)}</ul><p>Stop: {strategy.testPlan.stopRule}</p></section>:null}
      <details><summary>Independent checks and additional questions</summary>{review.checks.map(c=><p key={c.check}>{c.check.replaceAll('_',' ')} · {c.outcome}: {c.rationale}</p>)}{review.additionalUncertainties.map((u,i)=><p key={i}>{u.dimension.replaceAll('_',' ')}: {u.question} {u.reason}</p>)}</details>
    </>}
    {(root.status==='failed'||root.status==='completed'&&review?.outcome==='NEEDS_MORE_EVIDENCE')&&record.intent?<details><summary>Request one focused evidence refresh</summary><form action={refreshGeographicDiscovery} className="productForm"><input type="hidden" name="rootId" value={root.id}/><label>Recorded gap<select name="question" required>{root.status==='failed'?<option value="retry_after_known_failed_call">Continue after the known failed call using preserved evidence</option>:review?.missingQuestions.map(q=><option key={q} value={q}>{q}</option>)}</select></label><p>This continuation is at most one collection and five paid calls. It reuses fresh validated evidence and shares the original goal allowance. Unknown charges or insufficient remaining funds block it; the allowance is not reset.</p><label className="productCheckbox"><input type="checkbox" name="confirmResearch" value="on" required/><span>I approve this focused continuation only if its fresh full quote fits the original remaining allowance.</span></label><ProductSubmitButton pendingText="Checking the preserved evidence and remaining allowance…">Check and start focused research</ProductSubmitButton></form></details>:null}
    {record.sourcePacks.length?<details><summary>Exact collected evidence</summary>{record.sourcePacks.map(item=>{const pack=item.content.evidencePack as {question?:string;sources?:{id:string;url:string;retrievedAt:string;publishedAt:string|null}[];evidence?:{id:string;sourceId:string;quote:string}[]};return <section key={item.id}><h5>{pack.question||'Preserved Evidence Pack'}</h5>{pack.evidence?.map(e=>{const source=pack.sources?.find(s=>s.id===e.sourceId),url=safeUrl(source?.url);return <div key={e.id}><blockquote>{e.quote}</blockquote>{url?<a href={url} target="_blank" rel="noreferrer">Source</a>:<span>Source link unavailable</span>}<small> Retrieved {source?.retrievedAt||'unknown'}; publication {source?.publishedAt||'unknown'}</small></div>;})}</section>;})}</details>:null}
  </article>;
}
export function DiscoveryGoalResults({data}:{data:DiscoveryGoalData}){return <section aria-labelledby="discovery-goal-results"><h2 id="discovery-goal-results">Researched recommendations</h2>{data.errors.map(error=><p role="alert" key={error}>{error}</p>)}{data.records.length?data.records.map(record=><DiscoveryResult key={record.root.id} record={record}/>):<p>No geographic discovery result has been recorded yet. Starting research saves its full history, even if it stops without a recommendation.</p>}</section>;}
