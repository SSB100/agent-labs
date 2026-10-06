import Link from 'next/link';
import {loadConsoleObservationTime} from '@/lib/core-ui/console-data';
import {notFound} from 'next/navigation';
import type {OwnerUiContext} from '@/lib/core-ui/data';
import {consoleR12ResearchSelection} from '@/lib/core-ui/console-research-query';
import {discoveryR12CanContinue,readDiscoveryR12Workspace,readDiscoveryR12Result,type DiscoveryR12Workspace} from '@/products/discovery-r12-owner';
import {formatResearchUsd} from '@/app/dashboard/research-qualification/presentation';
import {ConsoleShell} from './console-shell';
import {ConsoleR12Controls} from './console-r12-controls';
import {ConsoleR12Result} from './console-r12-result';
import type {DiscoveryR12Result} from '@/products/discovery-r12-runtime';
import './console-workspace.css';
const names={plan:'Planning original concepts',search1:'Collecting public context',select1:'Selecting exact evidence',strategy:'Comparing markets and candidates',review:'Independent review'};
const stamp=(value:string)=>new Date(value).toISOString().slice(0,19).replace('T',' ')+' UTC';
const cost=(value:string|null)=>value===null?'Not yet known':formatResearchUsd(Number(value));
export function ConsoleR12Progress({record,observedAt,details=false,result=null,resultAvailable=true}:{record:DiscoveryR12Workspace;observedAt:number;details?:boolean;result?:DiscoveryR12Result|null;resultAvailable?:boolean}){
 const current=record.phases.find(p=>p.status!=='completed'),completed=record.phases.filter(p=>p.status==='completed').length,waiting=current?.receipt,review=record.phases.find(p=>p.phase==='review');
 const decision=review?.outcome==='NEEDS_MORE_EVIDENCE'?'Needs more evidence':review?.outcome==='REJECT'?'Rejected':review?.outcome==='TEST'?'Bounded test recommended':null;
 const futureCheck=!record.policyRevoked&&!record.paused&&record.state!=='stopped'&&waiting&&['awaiting_receipt','checking_receipt'].includes(waiting.status)?waiting.nextCheckAt:null;
 const href=`/dashboard?view=research&type=r12&business=${record.businessId}&selected=${record.scopeId}&quest=${record.goalId}`;
 return <section className={details?'r12DiscoveryDetails':'r12Progress'} aria-label="Qualified discovery progress">
  <div className="r12ProgressHeading"><strong>{(record.state==='completed'||completed===5)?'Research execution completed':record.state==='stopped'?'Research stopped':current?`${completed+1}/5 · ${names[current.phase]}`:'Research awaiting scoped approval'}</strong>{decision?<span>{decision} · no creative generation authorized</span>:null}{!details?<Link href={href}>Research details</Link>:null}</div>
  {['blocked','needs_owner','paused'].includes(record.state)?<p><strong>{record.state==='paused'?'Paused':'Held'}</strong> · {record.reason?.replaceAll('_',' ')??'Review operating controls before continuing.'}</p>:null}
  {!record.activeWindow&&record.dispatchUntil&&Date.parse(record.dispatchUntil)<=observedAt&&completed<5?<p>Dispatch window expired. Saved output may still be checked within its receipt window.</p>:null}
  {current&&['dispatched','uncertain'].includes(current.status)&&!current.candidateSaved?<p>Dispatched outcome is unverified. Recorded charges and any unresolved liability are retained; another generation is blocked.</p>:null}
  {waiting&&waiting.status!=='verified'?<p>{current?.candidateSaved?'Output saved. ':''}{waiting.status==='terminal'?'Receipt verification failed.':waiting.status==='exhausted'?'Receipt checks exhausted.':waiting.status==='expired'?'Receipt window expired.':waiting.status==='stopped'?'Receipt checks stopped.':'Awaiting provider receipt.'} Check {waiting.attempts} of 3{waiting.nextCheckAt?<> · Next eligible check <time dateTime={waiting.nextCheckAt}>{stamp(waiting.nextCheckAt)}</time></>:null}. No background check is scheduled.</p>:null}
  <ConsoleR12Controls key={`${record.scopeId}:${record.state}:${waiting?.status}:${waiting?.attempts}:${waiting?.nextCheckAt}`} businessId={record.businessId} scopeId={record.scopeId} canContinue={discoveryR12CanContinue(record,observedAt)} canStop={!record.policyRevoked&&record.phases.length===5} nextEligibleAt={futureCheck} receiptUntil={waiting?.receiptExpiresAt??record.dispatchUntil}/>
  {details?<div className="r12DiscoveryScroll" role="region" tabIndex={0} aria-label="Discovery phases, scope and costs"><h2>{record.title}</h2><p>{record.approvedQuery}</p><p>Reviewed source hosts: {record.sourceDomains.join(', ')}</p><p>This discovery: {cost(record.cost.knownMicrousd)} known · {cost(record.cost.heldMicrousd)} still held{record.cost.hasUnknown?' · unresolved charge':''}. Business-wide liability is shown separately in Overview.</p><p>Original research allowance, including earlier rounds: {formatResearchUsd(Number(record.rootFunding.knownActualMicrousd))} known · {formatResearchUsd(Number(record.rootFunding.pendingExposureMicrousd))} held · {formatResearchUsd(Number(record.rootFunding.remainingMicrousd))} remaining of {formatResearchUsd(Number(record.rootFunding.maximumMicrousd))}{record.rootFunding.hasUncertainCosts?' · unresolved cost blocks further paid work':''}.</p>{result?<ConsoleR12Result result={result} observedAt={observedAt}/>:!resultAvailable?<p role="alert">The complete saved result could not be verified. Phase receipts remain available; no substitute decision is shown.</p>:record.state==='completed'?<p role="alert">The complete saved result is unavailable. Open the phase receipts for the preserved records.</p>:null}<ol>{record.phases.map(phase=><li key={phase.phase}><strong>{names[phase.phase]}</strong> · {phase.status.replaceAll('_',' ')}<p>{phase.candidateSaved?'Output saved':'No bounded response saved for this phase'} · {cost(phase.knownMicrousd)} known · {cost(phase.heldMicrousd)} held</p>{phase.artifactId?<Link href={`/dashboard?view=library&type=records&business=${record.businessId}&artifact=${phase.artifactId}`}>Verified phase receipt</Link>:null}</li>)}</ol><p>TEST is a discovery recommendation. Creative approval, original-design/IP review, fresh image admission and print validation remain separate gates.</p><nav className="r08Links"><Link href={`/dashboard?view=research&type=roots&business=${record.businessId}&selected=${record.priorRoundId}`}>Original research history</Link><Link href={`/dashboard/quests/controls?business=${record.businessId}&quest=${record.goalId}`}>Operating controls</Link><Link href={`/dashboard?view=overview&business=${record.businessId}&quest=${record.goalId}`}>Business Overview</Link></nav></div>:null}
 </section>;
}
export async function ConsoleR12Discovery({context,query}:{context:OwnerUiContext;query:Record<string,string|string[]|undefined>}){
 let selected;try{selected=consoleR12ResearchSelection(query);}catch{notFound();}
 const loaded=await readDiscoveryR12Workspace(context,selected.businessId,selected.scopeId);
 if(loaded.available&&!loaded.record||loaded.record&&selected.goalId&&loaded.record.goalId!==selected.goalId)notFound();
 const observedAt=await loadConsoleObservationTime();
 const result=loaded.record?await readDiscoveryR12Result(context,selected.businessId,selected.scopeId):{available:false,record:null};
 return <ConsoleShell active="research" context={context} navigationBusinessId={selected.businessId}><section className="r08Workspace">{loaded.record?<ConsoleR12Progress record={loaded.record} observedAt={observedAt} details result={result.record} resultAvailable={result.available}/>:<p role="alert">This exact discovery is unavailable. No other research has been substituted and no zero-cost conclusion is available.</p>}</section></ConsoleShell>;
}
