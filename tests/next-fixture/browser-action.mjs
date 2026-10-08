import assert from 'node:assert/strict';
import {bounded,observe} from './async-bounds.mjs';

/** Match the actual POST, then require the action's semantic rendered result.
 * Streaming transport completion is not a substitute for a rendered result. */
export async function settledBrowserAction({page,name,settled,timeout=20000,onProgress=()=>{}}){
 let sent;
 const started=Date.now(),progress=phase=>onProgress({name,phase,elapsedMs:Date.now()-started});
 const capture=request=>{if(!sent&&request.method()==='POST'&&request.headers()['next-action'])sent=request;};
 page.on('request',capture);
 const response=observe(page.waitForResponse(value=>!!sent&&value.request()===sent,{timeout}));
 try{
  progress('click');await page.getByRole('button',{name,exact:true}).click();
  const received=await bounded(response,`${name}: response headers`,timeout);if(!received.ok)throw received.error;
  assert.equal(received.value.status(),200,`${name}: action HTTP status`);progress('headers');
  await bounded(settled(),`${name}: rendered result`,timeout);progress('settled');
 }finally{page.off('request',capture);}
}

const substantive=record=>JSON.stringify({planId:record.planId,planVersion:record.planVersion,state:record.state,cost:record.cost,phases:record.phases});
export function researchActionCheckpoint(before,after,now=Date.now()){
 assert.ok(!['blocked','needs_owner','paused','stopped'].includes(after.state)&&!after.policyRevoked&&!after.paused,'Continue cannot accept a blocked or stopped result');
 for(const phase of after.phases){
  assert.ok(!['rejected','failed','cancelled'].includes(phase.status),'Continue cannot accept a failed phase');
  assert.ok(!['terminal','exhausted','expired','stopped'].includes(phase.receipt?.status),'Continue cannot accept a failed receipt');
  assert.ok(!phase.responseDiagnostic,'Continue cannot accept an unverified response');
  assert.ok(!['dispatched','uncertain'].includes(phase.status)||phase.candidateSaved,'Continue cannot accept an unsaved dispatched response');
  assert.ok(!phase.outcome||phase.outcome==='TEST','This TEST journey cannot accept a negative result');
 }
 const advancedLease=Date.parse(after.continueAfter)>now&&Date.parse(after.continueAfter)>Date.parse(before.continueAfter??'1970-01-01');
 assert.ok(substantive(before)!==substantive(after)||advancedLease,'Continue must advance a substantive saved checkpoint');
 if(after.state==='completed'){
  assert.equal(after.phases.find(phase=>phase.phase==='review')?.outcome,'TEST');return{kind:'completed'};
 }
 const pending=after.phases.find(phase=>phase.status!=='completed');
 if(pending?.candidateSaved&&pending.receipt?.status==='awaiting_receipt'){
  assert.ok(Date.parse(pending.receipt.nextCheckAt)>now,'Receipt checkpoint must retain its future check boundary');
  return{kind:'receipt',attempts:pending.receipt.attempts,at:pending.receipt.nextCheckAt};
 }
 assert.ok(advancedLease,'An incomplete checkpoint must expose its newly advanced lease boundary');
 return{kind:'lease',at:after.continueAfter};
}
export async function awaitRenderedResearchCheckpoint(page,checkpoint,timeout=20000){
 await page.waitForFunction(expected=>{
  const section=document.querySelector('section.r12DiscoveryDetails[aria-label="Qualified discovery progress"]');if(!section)return false;
  const text=section.textContent.replace(/\s+/g,' ');
  if(expected.kind==='completed')return text.includes('Research execution completed')&&text.includes('Bounded test recommended');
  const message=expected.kind==='receipt'?`Output saved. Awaiting provider receipt. Check ${expected.attempts} of 3`:'Saved progress is preserved. Continue becomes available after';
  const time=Array.from(section.querySelectorAll('time')).some(node=>node.dateTime===expected.at);
  const button=Array.from(section.querySelectorAll('button')).find(node=>node.textContent.trim()==='Continue approved research');
  return text.includes(message)&&time&&button?.disabled===true;
 },checkpoint,{timeout});
}
