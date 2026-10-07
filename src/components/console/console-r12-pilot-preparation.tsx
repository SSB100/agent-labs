import Link from 'next/link';
import {randomUUID} from 'node:crypto';
import {notFound} from 'next/navigation';
import type {OwnerUiContext} from '@/lib/core-ui/data';
import {loadConsoleObservationTime} from '@/lib/core-ui/console-data';
import {readR12PilotPreparationSource} from '@/products/discovery-r12-pilot-preparation-server';
import {r12PilotGoalContent,r12PilotPreparationHref,validateR12PilotPreparation,R12_PILOT_OBJECTIVE,R12_PILOT_QUESTION} from '@/products/discovery-r12-pilot-preparation-contract';
import {ConsoleShell} from './console-shell';
import {ConsoleR12PilotPreparationForm} from './console-r12-pilot-preparation-form';
import './console-workspace.css';
export async function ConsoleR12PilotPreparation({context,query}:{context:OwnerUiContext;query:Record<string,string|string[]|undefined>}){
 if(Object.entries(query).some(([key,value])=>value!==undefined&&(!['view','type','business','source','preparation','setupUntil'].includes(key)||typeof value!=='string'))||query.view!=='research'||query.type!=='r12-pilot-prepare'||typeof query.business!=='string'||typeof query.source!=='string'||(query.preparation===undefined)!==(query.setupUntil===undefined))notFound();
 const now=await loadConsoleObservationTime(),input={businessId:query.business,sourceScopeId:query.source,preparationId:typeof query.preparation==='string'?query.preparation:randomUUID(),setupUntil:typeof query.setupUntil==='string'?query.setupUntil:new Date(Math.floor((now+6*3_600_000)/1000)*1000).toISOString()};
 try{validateR12PilotPreparation(input);}catch{notFound();}
 let lineage=null;try{lineage=await readR12PilotPreparationSource(context,input);}catch{/* A failed history read cannot authorize preparation. */}
 if(!lineage)return <ConsoleShell active="research" context={context} navigationBusinessId={input.businessId}><section className="r08Workspace"><h1>Prepare a focused pilot</h1><p role="alert">The stopped broad research, accepted earlier review and settled funding could not be verified. Preparation is unavailable.</p></section></ConsoleShell>;
 const content=r12PilotGoalContent(input),canPrepare=Date.parse(input.setupUntil)>now+3_600_000&&Date.parse(input.setupUntil)<=now+86_400_000;
 return <ConsoleShell active="research" context={context} navigationBusinessId={input.businessId}><section className="r08Workspace r12Preparation"><h1>Prepare one focused nature-design pilot</h1>
  <p>{R12_PILOT_OBJECTIVE}</p><p>{R12_PILOT_QUESTION}</p>
  <p>The broad four-market attempt reached its plan limit. Its Needs more evidence decision, all unanswered questions and every charge remain saved. This preparation creates a separate Goal for one private design experiment.</p>
  <p>One original leaf, winged seed and pebble composition, one GB audience and one learning question. Retail observations supply limited category context; print guidance supplies operating constraints. Sales, profit, product readiness and physical print quality remain unproven.</p>
  <p>The existing cumulative USD 2 research root and current Business ceiling remain binding. Two model calls may be proposed after review. Preparation creates no spending or image permission.</p>
  <p>Goal and setup deadline: <time dateTime={input.setupUntil}>{input.setupUntil}</time>. Source dates retain their own shorter limits. The 30-minute dispatch window and 30-minute receipt grace begin only at final scoped activation.</p>
  <details><summary>Scope and stop rules</summary><p>{String(content.parsed.scope)}</p><ul>{(content.parsed.stopConstraints as string[]).map(rule=><li key={rule}>{rule}</li>)}</ul></details>
  <Link href={`/dashboard?view=research&type=r12&business=${input.businessId}&selected=${input.sourceScopeId}&quest=${lineage.source.goalId}`}>Inspect closed research</Link>{' · '}
  <Link href={`/dashboard?view=research&type=r12&business=${input.businessId}&selected=${lineage.accepted.scopeId}&quest=${lineage.source.goalId}`}>Inspect accepted earlier review</Link>
  {!canPrepare?<p role="note">This setup window is closed. Saved history remains available.</p>:null}
  {!query.preparation?<p><Link href={r12PilotPreparationHref(input)}>Review this focused preparation</Link></p>:<ConsoleR12PilotPreparationForm input={input} canPrepare={canPrepare}/>}
 </section></ConsoleShell>;
}
