import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {renderedResearchForm,researchHtmlText} from './r11-http.mjs';
import {r12OwnerRpc} from './r12-sql.mjs';
import {extendOwnerInitialNextAllowance,enrollAdaptiveOwnerNextAllowance} from './r12-owner-initial.mjs';
import {snapshotConfirmedEtsyBranch} from './r12-etsy-branch.mjs';

/** Actual generated Next actions and actual migrated SQL, with inert transport.
 * This independently verifies HTTP effects, never browser hydration or pixels. */
export async function runEtsyOwnerHttp({origin,boundary,output,fixture}) {
 const manifest=JSON.parse(await readFile(path.join(fixture,'.next/server/server-reference-manifest.json'),'utf8'));
 const results=[];let technicalScenario='etsy-owner-http';
 const report=()=>writeFile(path.join(output,'etsy-http-acceptance.json'),JSON.stringify({results,browser:'unrun HTTP-only',boundary:'loopback SQL and synthetic provider transport',purpose:'technical qualification only; no Etsy account, market evidence or paid call'},null,2));
 const check=async(name,work)=>{console.log('START:',name);try{await work();results.push({name,status:'passed',technicalScenario});console.log('PASS:',name);}catch(error){results.push({name,status:'failed',technicalScenario,error:String(error.stack??error)});await report();throw error;}await report();};
 const current=()=>boundary.state().r12;
 const control=async input=>{const response=await fetch(boundary.origin+'/control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(90000)});assert.equal(response.status,200,await response.text());};
 const route=()=>`/dashboard/quests/research?business=${current().businessId}&quest=${current().goalId}`;
 const catalog=async setupId=>{const result=await r12OwnerRpc(boundary.state(),'r12_owner_adaptive_read',{p_business_id:current().businessId,p_goal_id:current().goalId,p_setup_id:setupId??null});assert.equal(result.error,null);return result.data;};
 const read=async href=>{const response=await fetch(origin+href,{signal:AbortSignal.timeout(30000)});assert.equal(response.status,200);return response.text();};
 async function action(name,args,href=route()){
  const entries=Object.entries(manifest.node).filter(([,entry])=>entry.exportedName===name);assert.equal(entries.length,1,`Exact generated ${name}`);
  const response=await fetch(origin+href,{method:'POST',headers:{origin,'next-action':entries[0][0],accept:'text/x-component','content-type':'text/plain;charset=UTF-8'},body:JSON.stringify(args),signal:AbortSignal.timeout(90000)});assert.equal(response.status,200);
  const body=await response.text(),values=body.split('\n').flatMap(line=>{const split=line.indexOf(':');if(split<0)return[];try{return[JSON.parse(line.slice(split+1))];}catch{return[];}});
  const result=values.find(value=>value&&typeof value==='object'&&typeof value.ok==='boolean');assert.ok(result,`${name} returned no action receipt`);return result;
 }
 const exactAction=receipt=>({businessId:receipt.businessId,setupId:receipt.setupId,setupHash:receipt.setupHash,submissionId:randomUUID()});
 const advance=async(receipt,mode='run')=>{
  // Real saved-receipt cooldown is 120 seconds; leave room for its next wake.
  const until=Date.now()+180000;let result;
  while(Date.now()<until){const response=await action(mode==='receipt'?'checkAdaptiveOwnerReceiptsAction':'continueAdaptiveOwnerResearchAction',[receipt.businessId,receipt.scopeId]);assert.equal(response.ok,true,response.message);result=response.result;
   if(result.status!=='waiting'||!['continue_saved_progress','receipt_pending'].includes(result.reason))return result;
   if(mode==='pending'&&result.reason==='receipt_pending')return result;
   const wake=Date.parse(result.wakeAt??'');await new Promise(resolve=>setTimeout(resolve,Number.isFinite(wake)?Math.max(0,Math.min(until-Date.now(),wake-Date.now())):40));
  }
  throw Error(`Timed out advancing ${mode}: ${JSON.stringify(result)}`);
 };
 await control({r12Scenario:'owner-initial-native',r12DelayReceipt:false,r12HoldAdaptiveResponse:false,r12DelayAdaptiveReceipt:false});
 let observation,receipt,startReceiptBranch;
 await check('Etsy HTTP retains an actual closed initial owner result before creating a new mode',async()=>{
  assert.equal(current().initialInput.grantId,current().continuationGrantId);assert.notEqual(current().initialInput.grantId,current().grantId);
  for(let retry=0;retry<2;retry++){const stale=await action('prepareOwnerResearchAction',[{...current().initialInput,grantId:current().grantId,submissionId:randomUUID()}]);assert.equal(stale.ok,false,'A stale initial grant cannot substitute for the exact current catalog selection');}
  assert.equal((await current().db.query('select count(*)::int n from private.r12_owner_setups')).rows[0].n,0);
  const prepared=await action('prepareOwnerResearchAction',[{...current().initialInput,submissionId:randomUUID()}]);assert.equal(prepared.ok,true,prepared.message);assert.equal(prepared.receipt.grantId,current().continuationGrantId);
  const confirmed=await action('confirmOwnerResearchAction',[exactAction(prepared.receipt)]);assert.equal(confirmed.ok,true,confirmed.message);
  const href=`/dashboard?view=research&type=r12&business=${current().businessId}&selected=${confirmed.receipt.scopeId}&quest=${current().goalId}`;
  const form=renderedResearchForm(await read(href),'Continue approved research',confirmed.receipt.scopeId);
  const response=await fetch(origin+href,{method:'POST',headers:{origin,accept:'text/html'},body:form,redirect:'manual',signal:AbortSignal.timeout(120000)});assert.ok([200,303].includes(response.status));await response.body?.cancel();
  assert.deepEqual(current().calls,['plan','search1','select1','strategy','review']);
  assert.match(researchHtmlText(await read(href)),/Needs more evidence/);
  const stopped=await action('stopOwnerResearchAction',[exactAction(confirmed.receipt)]);assert.equal(stopped.ok,true,stopped.message);assert.equal(stopped.receipt.stopped,true);
  const content=structuredClone(current().goalContent);content.parsed.budget.amount='10';content.originalIntent+=' Budget USD 10 for the next bounded original research run.';
  const saved=await action('saveQuestIntent',[current().businessId,'quest.save',{goalId:current().goalId,expectedRevision:2,content},randomUUID()],`/dashboard/quests?business=${current().businessId}`);assert.equal(saved.ok,true,saved.message);
  const ready=await action('saveQuestIntent',[current().businessId,'quest.preference',{goalId:current().goalId,expectedRevision:saved.result.revision,preference:'ready'},randomUUID()],`/dashboard/quests?business=${current().businessId}`);assert.equal(ready.ok,true,ready.message);
 });
 await check('Etsy HTTP saves exact private capture, retries idempotently and discloses selected records without a grant',async()=>{
  const stamp=delta=>new Date(Date.now()+delta).toISOString(),createdAt=stamp(-1000);
  const input={id:randomUUID(),createdAt,productFormat:'Original adult printed T-shirt',category:'Adult apparel',windowStart:stamp(-172800000),windowEnd:stamp(-86400000),locale:'en-GB',privacyReviewed:true,
   observations:['Original astronomy star chart','Original astronomy lunar geometry','Negative reference plain shirt'].map(query=>({id:randomUUID(),query,url:'https://www.etsy.com/your/shops/me/marketplace-insights',interface:'Etsy Marketplace Insights',capturedAt:stamp(-3600000),content:`${query}. Conversion: Very low. Exposure and buyer country not displayed. Explicitly synthetic technical fixture.`,excerpt:'Conversion: Very low.',limitations:'Ordinal label only; exposure, numeric conversion, item sales, buyer geography and profit are unknown.'})),
   baseline:{hypothesis:'An astronomy design might show a useful contrast to the negative reference under comparable exposure.',positiveCriterion:'A supported contrast under known exposure may justify a separately approved bounded experiment.',negativeCriterion:'Equal or weaker observed response under comparable exposure contradicts the candidate premise.',inconclusiveCriterion:'Absent comparable exposure or numeric rate leaves candidate demand unknown.'}};
  for(let attempt=0;attempt<2;attempt++){const saved=await action('saveOwnerObservationAction',[current().businessId,'',input]);assert.equal(saved.ok,true,saved.message);observation=saved;}
  const listed=await action('listOwnerObservationsAction',[current().businessId,'']);assert.equal(listed.ok,true,listed.message);assert.equal(listed.items.length,1);assert.equal(listed.items[0].bundle.bundleHash,observation.bundle.bundleHash);
  const disclosure=await action('readOwnerObservationDisclosureAction',[current().businessId,'',observation.selection]);assert.equal(disclosure.ok,true,disclosure.message);assert.equal(disclosure.manifestHash,observation.selection.manifestHash);assert.equal(disclosure.records[0].observations.length,3);assert.equal(disclosure.records[0].baseline.candidateObservationIds.length,2);
  assert.equal((await catalog()).grants.length,0);assert.equal(current().calls.length,5);assert.equal((await current().db.query('select count(*)::int n from private.r12_adaptive_setups')).rows[0].n,0);
 });
 await check('Etsy HTTP prepares and confirms explicit .2 three-role authority with exact loaded capture disclosure',async()=>{
  await extendOwnerInitialNextAllowance(current());await enrollAdaptiveOwnerNextAllowance(current(),current().goalId);
  const c=await catalog(),profile=c.profiles.find(row=>row.profile.id===current().adaptiveProfileId),grant=c.grants.find(row=>row.id===current().adaptiveGrantId),p=c.predecessorClosure;
  assert.equal(c.eligible,true,c.reason);assert.equal(profile.profile.version,'r12.owner-research-profile.3');assert.deepEqual(profile.profile.allowedDomains,['etsy.com']);assert.deepEqual(profile.profile.excludedDomains,['etsy.com','etsy.me','etsystatic.com']);assert.equal(profile.profile.sourceReviews[0].basis,'owner_reported_capture');
  const input={businessId:c.businessId,goalId:c.goalId,goalRevision:p.goalRevision,profileId:profile.profile.id,profileHash:profile.profileHash,grantId:grant.id,marketSetKey:'gb',topicKey:'astronomy',maximumActions:10,maximumRunMicrounits:'10000000',ownerObservationRef:observation.selection,predecessorPlanId:p.predecessorPlanId,predecessorPlanHash:p.predecessorPlanHash,predecessorScopeId:p.predecessorScopeId,predecessorScopeHash:p.predecessorScopeHash,businessLifetimeLimitMicrounits:String(Math.max(Number(c.business.currentLimitMicrounits),Number(c.business.committedMicrounits)+10000000)),researchLifetimeLimitMicrounits:String(Math.max(Number(c.funding.currentLimitMicrounits),Number(c.funding.committedMicrounits)+10000000)),submissionId:randomUUID()};
  const prepared=await action('prepareAdaptiveOwnerResearchAction',[input]);assert.equal(prepared.ok,true,prepared.message);receipt=prepared.receipt;
  assert.equal(receipt.quote.version,'r12.adaptive-quote.2');assert.deepEqual(Object.keys(receipt.quote.ceilings).sort(),['plan','review','strategy']);assert.deepEqual(receipt.ownerObservationRef,observation.selection);
  const html=researchHtmlText(await read(`${route()}&adaptiveSetup=${receipt.setupId}`));assert.match(html,/three actual inference roles/);assert.match(html,/No Exa or Etsy API request/);
  const confirmed=await action('confirmAdaptiveOwnerResearchAction',[exactAction(receipt)]);assert.equal(confirmed.ok,true,confirmed.message);receipt=confirmed.receipt;
  assert.equal(receipt.activated,true);assert.deepEqual(current().adaptiveCalls,[]);assert.equal(current().adaptiveScope.version,'r12.discovery-owner-adaptive.2');
  startReceiptBranch=await snapshotConfirmedEtsyBranch(boundary.state());
 });
 await check('Etsy HTTP runs planner strategist reviewer and repeated Run pauses before any missing-source action',async()=>{
  const result=await advance(receipt);assert.equal(result.status,'waiting');assert.equal(result.reason,'owner_source_operation_required');
  assert.deepEqual(current().adaptiveCalls.map(row=>row.phase),['plan','strategy','review']);
  const latest=(await catalog(receipt.setupId)).setups[0];assert.equal(latest.actions.length,1);assert.equal(latest.actions[0].outcome,'NEEDS_MORE_EVIDENCE');
  for(let attempt=0;attempt<2;attempt++){const repeated=await advance(receipt);assert.equal(repeated.reason,'owner_source_operation_required');assert.equal(current().adaptiveCalls.length,3);}
  const admissions=(await current().db.query('select action_phase from private.r12_adaptive_call_admissions where scope_id=$1 order by action_phase',[receipt.scopeId])).rows;assert.deepEqual(admissions.map(row=>row.action_phase),['plan','review','strategy']);
  const stopped=await action('stopAdaptiveOwnerResearchAction',[exactAction(receipt)]);assert.equal(stopped.ok,true,stopped.message);assert.equal(stopped.receipt.stopped,true);assert.equal(current().adaptiveCalls.length,3);
 });
 await check('independent Etsy HTTP receipt branch stops and settles repeated receipt checks with zero resends',async()=>{
  technicalScenario='independent-etsy-http-receipt-stop';await startReceiptBranch(process.env.R12_SQL_TEST_HOST);await control({r12DelayAdaptiveReceipt:true});
  const pending=await advance(receipt,'pending');assert.equal(pending.reason,'receipt_pending');assert.deepEqual(current().adaptiveCalls.map(row=>row.phase),['plan','strategy','review']);
  const stopped=await action('stopAdaptiveOwnerResearchAction',[exactAction(receipt)]);assert.equal(stopped.ok,true,stopped.message);assert.equal(stopped.receipt.stopped,true);
  assert.equal((await catalog(receipt.setupId)).activation.pendingReceiptReadback,true);await control({r12DelayAdaptiveReceipt:false});
  const recovered=await advance(receipt,'receipt');assert.equal(recovered.status,'stopped');assert.equal(recovered.reason,'saved_receipt_readback_recorded');
  assert.equal((await catalog(receipt.setupId)).activation.pendingReceiptReadback,false);
  for(let attempt=0;attempt<2;attempt++){await action('checkAdaptiveOwnerReceiptsAction',[receipt.businessId,receipt.scopeId]);assert.equal(current().adaptiveCalls.length,3);}
  assert.ok(current().adaptiveReceipts.every(row=>['plan','strategy','review'].includes(row.phase)));assert.equal((await catalog(receipt.setupId)).setups[0].stopped,true);
 });
 assert.deepEqual(boundary.denied,[]);await report();
}
