import assert from 'node:assert/strict';
import {researchControl,researchRoute,renderedResearchForm,researchRedirectUrl,researchHtmlText} from './r11-http.mjs';
import {r11Scope,r11ContinuationScope,R11_RESET,R11_RAW_SENTINEL,R11_EXCERPT} from './r11-research.mjs';
export const assertPrivateReceiptHtml=html=>{assert.doesNotMatch(html,new RegExp(R11_RAW_SENTINEL+'|'+R11_EXCERPT+'|Synthetic public gardening report|"url_citation"|data-r11-result='));};
export async function runPendingReceiptHttp({origin,noKeyOrigin,boundary,check}){
 const control=values=>researchControl(boundary,values),fixture=()=>boundary.state().r11Research,reads=()=>boundary.log.filter(row=>row.kind==='inert-r11-generation-read');
 const get=async()=>{const response=await fetch(origin+researchRoute(),{signal:AbortSignal.timeout(30_000)});assert.equal(response.status,200);return response.text();};
 const post=async(button,{html=null,values={},base=origin,identity=button==='Activate reviewed proof'?r11Scope.grantId:r11Scope.policyId}={})=>{
  const data=renderedResearchForm(html??await get(),button,identity);for(const [key,value]of Object.entries(values))data.set(key,value);
  const response=await fetch(base+researchRoute(),{method:'POST',headers:{origin:base,accept:'text/html'},body:data,redirect:'manual',signal:AbortSignal.timeout(30_000)});assert.ok([200,303].includes(response.status));
  if(response.status===303){const redirected=await fetch(researchRedirectUrl(response.headers.get('location'),base),{signal:AbortSignal.timeout(30_000)});assert.equal(redirected.status,200);return redirected.text();}return response.text();
 };
 const start=async extra=>{const now=Date.now();await control({...R11_RESET,r11Now:now,r11ReceiptDelayMs:120_001,...extra});await post('Activate reviewed proof',{values:{readConsent:'on',retentionConsent:'on'}});return now;};
 await check('R11 actual HTML saves delayed paid output before receipt I/O, reloads it privately, and Continue completes the exact two generations',async()=>{
  const now=await start(),before=reads().length,effectsBefore=boundary.effects.length;
  let html=await post('Run public evidence proof');assert.match(researchHtmlText(html),/Awaiting receipt/);assertPrivateReceiptHtml(html);assert.equal(fixture().providerCalls.length,1);assert.equal(fixture().settlements.length,1);assert.equal(fixture().receiptCandidates.length,1);assert.equal(reads().length,before+1);assert.equal(fixture().results.length,0);assert.equal(fixture().outcomes.length,0);
  const staged=structuredClone(fixture().receiptCandidates[0]),first=fixture().providerCalls[0];
  const stageIndex=boundary.effects.findIndex((row,i)=>i>=effectsBefore&&row.kind==='in-memory-r11-receipt-stage'&&row.requestId===first.requestId),claimIndex=boundary.effects.findIndex((row,i)=>i>stageIndex&&row.kind==='in-memory-r11-receipt-claim'&&row.requestId===first.requestId);assert.ok(stageIndex>=0&&claimIndex>stageIndex);
  const catalogs=boundary.log.filter(row=>row.kind==='inert-r11-public-catalog').length;
  for(let count=0;count<2;count++){html=await get();assertPrivateReceiptHtml(html);}
  assert.equal(reads().length,before+1);assert.equal(boundary.log.filter(row=>row.kind==='inert-r11-public-catalog').length,catalogs);
  const savedForm=html;await post('Continue saved proof',{html:savedForm});assert.equal(reads().length,before+1);assert.equal(fixture().providerCalls.length,1);assert.deepEqual(fixture().receiptCandidates[0],staged);
  for(const values of [{businessId:r11Scope.otherBusinessId},{policyId:r11Scope.otherBusinessId}])await post('Continue saved proof',{html:savedForm,values});
  assert.equal(reads().length,before+1);assert.equal(fixture().providerCalls.length,1);
  await control({r11Now:now+120_002});html=await post('Continue saved proof');assertPrivateReceiptHtml(html);assert.equal(fixture().providerCalls.length,2);assert.deepEqual(fixture().providerCalls.map(row=>row.phase),['search','select']);assert.equal(fixture().collections.length,1);assert.equal(fixture().results.length,0);assert.equal(fixture().receiptCandidates.length,2);assert.deepEqual(fixture().receiptCandidates[0].candidate,staged.candidate);assert.equal(fixture().receiptCandidates[0].candidateHash,staged.candidateHash);assert.equal(fixture().collections[0].collection.sources[0].retrievedAt,staged.candidate.receivedAt);
  const selector=fixture().providerCalls[1],savedSelection=structuredClone(fixture().receiptCandidates[1].candidate),priorReads=reads().length;
  await post('Continue saved proof',{html});assert.equal(reads().length,priorReads);assert.equal(fixture().providerCalls.length,2);
  await control({r11Now:now+240_004});html=await post('Continue saved proof');assert.match(html,/data-r11-result=/);assert.match(html,/Synthetic public gardening report/);assert.equal(fixture().results.length,1);assert.equal(fixture().providerCalls.length,2);assert.equal(fixture().settlements.length,4);assert.equal(fixture().outcomes.length,0);assert.deepEqual(fixture().receiptCandidates[1].candidate,savedSelection);
  assert.deepEqual(reads().slice(before).map(row=>row.generationId),[first.receiptId,first.receiptId,selector.receiptId,selector.receiptId]);assert.equal(fixture().results[0].selectorRequestId,selector.requestId);
  await post('Continue saved proof',{html:savedForm});await post('Run public evidence proof');await get();assert.equal(fixture().providerCalls.length,2);assert.equal(fixture().results.length,1);assert.equal(reads().length,before+4);
 });
 await check('R11 actual HTML retains verified staged output through uncertain collection or result persistence and resumes without replay',async()=>{
  for(const failed of ['r11CollectFailure','r11CompleteFailure']){
   await start({r11ReceiptDelayMs:0,[failed]:true});const before=reads().length;
   let html=await post('Run public evidence proof');assert.match(researchHtmlText(html),/Receipt verified.*saved proof pending/);assertPrivateReceiptHtml(html);assert.equal(fixture().outcomes.length,0);assert.equal(fixture().policies[0].revoked,false);assert.equal(fixture().results.length,0);
   const count=failed==='r11CollectFailure'?1:2,staged=structuredClone(fixture().receiptCandidates),settlements=structuredClone(fixture().settlements);assert.equal(fixture().providerCalls.length,count);assert.equal(reads().length,before+count);assert.equal(fixture().settlements.length,count*2);
   await get();assert.deepEqual(fixture().receiptCandidates,staged);assert.deepEqual(fixture().settlements,settlements);await control({[failed]:false});
   html=await post('Continue saved proof');assert.match(html,/data-r11-result=/);assert.equal(fixture().providerCalls.length,2);assert.equal(fixture().results.length,1);assert.equal(fixture().settlements.length,4);assert.equal(reads().length,before+2);assert.equal(fixture().outcomes.length,0);assert.equal(fixture().policies[0].revoked,false);
   for(const entry of staged)assert.deepEqual(fixture().receiptCandidates.find(row=>row.requestId===entry.requestId),entry);
  }
 });
 await check('R11 delayed V2 receipts preserve the original thirty-minute boundary for unused selection and staged-selection grace',async()=>{
  for(const expireSearch of [true,false]){
   await control({...R11_RESET,r11Historical:true,r11ReceiptDelayMs:120_001});await post('Reconcile saved Stop',{base:noKeyOrigin});await control({r11InstallContinuation:true});await post('Activate reviewed proof',{identity:r11ContinuationScope.grantId,values:{readConsent:'on',retentionConsent:'on'}});
   const policy=fixture().policies.find(row=>row.policyId===r11ContinuationScope.policyId),now=Date.parse(policy.policy.validFrom),deadline=policy.policy.validUntil,identity=policy.policyId,before=reads().length;
   assert.equal(Date.parse(deadline)-now,30*60_000);await control({r11Now:now});let html=await post('Run public evidence proof',{identity});assertPrivateReceiptHtml(html);assert.equal(fixture().providerCalls.length,2);assert.equal(reads().length,before+1);
   if(!expireSearch){await control({r11Now:now+120_002});html=await post('Continue saved proof',{identity});assertPrivateReceiptHtml(html);assert.equal(fixture().providerCalls.length,3);assert.equal(fixture().collections.length,1);assert.equal(fixture().results.length,0);}
   const catalogCount=boundary.log.filter(row=>row.kind==='inert-r11-public-catalog').length;
   await control({r11Now:Date.parse(deadline)+1});html=await post('Continue saved proof',{identity});assert.equal(policy.policy.validUntil,deadline);assert.equal(boundary.log.filter(row=>row.kind==='inert-r11-public-catalog').length,catalogCount,'Receipt grace cannot fetch a quote for another paid phase');assert.equal(fixture().outcomes.filter(row=>row.policyId===identity).length,0);
   if(expireSearch){assertPrivateReceiptHtml(html);assert.equal(fixture().providerCalls.length,2);assert.equal(fixture().collections.length,0);assert.equal(fixture().results.length,0);assert.equal(reads().length,before+2);}
   else{assert.match(html,/data-r11-result=/);assert.equal(fixture().providerCalls.length,3);assert.equal(fixture().results.length,1);assert.equal(fixture().results[0].policyId,identity);assert.equal(reads().length,before+4);}
  }
 });
 await check('R11 overlapping actual Continue claims one exact receipt and never regenerates either paid phase',async()=>{
  const now=await start(),before=reads().length;await post('Run public evidence proof');const html=await get();await control({r11Now:now+120_002});
  await Promise.all([post('Continue saved proof',{html}),post('Continue saved proof',{html})]);assert.equal(fixture().providerCalls.length,2);assert.equal(fixture().outcomes.length,0);assert.equal(fixture().results.length,0);assert.equal(fixture().receiptCandidates[0].claims.length,2);assert.equal(fixture().receiptCandidates[1].claims.length,1);assert.equal(reads().length,before+3);
 });
 await check('R11 saved Stop and receipt expiry fence stale actual Continue submissions before receipt GET or generation',async()=>{
  for(const stopped of [true,false]){
   const now=await start();await post('Run public evidence proof');const html=await get(),before=reads().length;
   if(stopped)await post('Stop this proof',{base:noKeyOrigin});else await control({r11Now:now+35*60_000});
   await post('Continue saved proof',{html});const retained=await get();assertPrivateReceiptHtml(retained);assert.equal(reads().length,before);assert.equal(fixture().providerCalls.length,1);assert.equal(fixture().results.length,0);assert.equal(fixture().collections.length,0);assert.equal(fixture().settlements[0].actualMicrounits,'10068');
  }
 });
 await control({...R11_RESET});
}
