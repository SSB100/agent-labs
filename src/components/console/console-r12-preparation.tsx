import Link from 'next/link';
import {randomUUID} from 'node:crypto';
import {notFound} from 'next/navigation';
import type {OwnerUiContext} from '@/lib/core-ui/data';
import {loadConsoleObservationTime} from '@/lib/core-ui/console-data';
import {verifyOwnerBusiness} from '@/lib/core-ui/owner-business';
import {R12_ORIGINAL_OBJECTIVE,r12PreparationGoalContent,r12PreparationHref,validateR12PreparationIdentity} from '@/products/discovery-r12-preparation-contract';
import {readR12Preparation} from '@/products/discovery-r12-preparation-server';
import {ConsoleShell} from './console-shell';
import {ConsoleR12PreparationForm} from './console-r12-preparation-form';
import './console-workspace.css';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export async function ConsoleR12Preparation({context,query}:{context:OwnerUiContext;query:Record<string,string|string[]|undefined>}){
 const allowed=new Set(['view','type','business','prior','preparation','sourceCutoff']);
 if(Object.entries(query).some(([k,v])=>v!==undefined&&(!allowed.has(k)||typeof v!=='string'))||query.view!=='research'||query.type!=='r12-prepare'||typeof query.business!=='string'||!UUID.test(query.business)||typeof query.prior!=='string'||!UUID.test(query.prior)||(query.preparation===undefined)!==(query.sourceCutoff===undefined)||!await verifyOwnerBusiness(context,query.business))notFound();
 const business=context.businesses.find(b=>b.id===query.business),now=await loadConsoleObservationTime();
 const input={businessId:query.business,priorRoundId:query.prior,preparationId:typeof query.preparation==='string'?query.preparation:randomUUID(),sourceCutoff:typeof query.sourceCutoff==='string'?query.sourceCutoff:new Date(Math.floor((now+7200000)/1000)*1000).toISOString()};
 try{validateR12PreparationIdentity(input);}catch{notFound();}
 let receipt=null,available=true;
 if(query.preparation)try{receipt=await readR12Preparation(context,input);}catch{available=false;}
 const canPrepare=Date.parse(input.sourceCutoff)>now+1800000&&Date.parse(input.sourceCutoff)<=now+86400000;
 const content=r12PreparationGoalContent(input.sourceCutoff);
 return <ConsoleShell active="research" context={context} navigationBusinessId={input.businessId}><section className="r08Workspace r12Preparation"><h1>Prepare original research</h1><p>{business?.name??'This Business'} · Existing owner profile and research history</p>
  <p>{R12_ORIGINAL_OBJECTIVE}</p><p>US / GB / AU / NZ · one research packet · original cumulative USD 2 allowance. The existing funding root and prior charges are preserved.</p>
  <p>Setup and Goal deadline: <time dateTime={input.sourceCutoff}>{input.sourceCutoff}</time>. The separate 30-minute dispatch clock starts only after approved final activation, with 30 more minutes for existing receipts.</p>
  <p>This preparation saves the original Goal, marks it ready and associates its existing research history. It does not create a provider grant, financial policy, key enrollment or paid call.</p>
  <details><summary>Review the saved scope and stop rules</summary><p>{String(content.parsed.scope)}</p><ul>{(content.parsed.stopConstraints as string[]).map(rule=><li key={rule}>{rule}</li>)}</ul></details>
  {!canPrepare?<p role="note">This setup window is closed for new preparation. Existing saved intent and its setup receipt remain readable.</p>:null}
  {!query.preparation?<><p>Open a stable setup URL before saving. Keep that URL to recover an interrupted response without creating another Goal.</p><Link href={r12PreparationHref(input)}>Review this preparation</Link></>:available?<ConsoleR12PreparationForm input={input} receipt={receipt} canPrepare={canPrepare}/>:<p role="alert">This exact original lineage or saved setup could not be verified. No Goal, funding or authority has been changed by this read. Reopen the same setup URL after checking the saved records.</p>}
 </section></ConsoleShell>;
}
