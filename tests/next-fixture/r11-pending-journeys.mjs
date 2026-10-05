import assert from 'node:assert/strict';
import path from 'node:path';
import {bounded,observe,FIXTURE_ACTION_TIMEOUT_MS} from './async-bounds.mjs';
import {researchControl,researchRoute} from './r11-http.mjs';
import {assertPrivateReceiptHtml} from './r11-pending-http.mjs';
import {r11Scope,R11_RESET} from './r11-research.mjs';
/** Bind exact request headers and a fresh rendered outcome, never an open Flight body. */
export async function submitReceiptAction(page,button,settled,{force=false}={}){
 const actionUrl=page.url();let actionRequest;
 const capture=request=>{if(!actionRequest&&request.method()==='POST'&&request.url()===actionUrl&&request.headers()['next-action'])actionRequest=request;};
 page.on('request',capture);const response=observe(page.waitForResponse(value=>!!actionRequest&&value.request()===actionRequest,{timeout:FIXTURE_ACTION_TIMEOUT_MS}));
 try{
  if(force)await button.locator('..').evaluate(form=>form.requestSubmit());else await button.click({timeout:FIXTURE_ACTION_TIMEOUT_MS});
  const received=await bounded(response,'R11 saved-receipt action headers');if(!received.ok)throw received.error;
  assert.equal(received.value.request(),actionRequest);assert.equal(received.value.status(),200);assert.ok(received.value.headers()['x-action-redirect']);
  await bounded(settled(),'R11 saved-receipt rendered outcome');
 }finally{page.off('request',capture);}
}
export async function runPendingReceiptBrowser({page,context,origin,noKeyOrigin,boundary,output,check}){
 const control=values=>researchControl(boundary,values),fixture=()=>boundary.state().r11Research,reads=()=>boundary.log.filter(row=>row.kind==='inert-r11-generation-read');
 const proof=p=>p.locator(`[data-r11-policy="${r11Scope.policyId}"]`),button=(p,name)=>proof(p).getByRole('button',{name,exact:true}),receipt=(p,phase)=>proof(p).locator(`[data-r11-receipt-phase="${phase}"]`);
 const pending=(p,phase,count)=>receipt(p,phase).getByText(new RegExp(`Awaiting generation receipt.*${count} of 3 reads claimed`)).waitFor({state:'visible',timeout:FIXTURE_ACTION_TIMEOUT_MS});
 const start=async(extra={})=>{
  const now=Date.now();await control({...R11_RESET,r11Now:now,r11ReceiptDelayMs:120_001,...extra});await context.clearCookies();await page.goto(origin+researchRoute());
  const grant=page.locator(`[data-r11-grant="${r11Scope.grantId}"]`);await grant.locator('input[name=readConsent]').check();await grant.locator('input[name=retentionConsent]').check();await grant.getByRole('button',{name:'Activate reviewed proof',exact:true}).click();await proof(page).waitFor();return now;
 };
 await check('R11 hydrated Continue retains delayed paid responses across reload and native history, and completes only the unused phase',async()=>{
  const now=await start(),before=reads().length;
  await submitReceiptAction(page,button(page,'Run public evidence proof'),()=>pending(page,'search',1));assert.equal(fixture().providerCalls.length,1);assert.equal(fixture().results.length,0);assert.equal(reads().length,before+1);assertPrivateReceiptHtml(await page.content());
  const search=structuredClone(fixture().receiptCandidates[0].candidate),searchHash=fixture().receiptCandidates[0].candidateHash;assert.equal(await button(page,'Continue saved proof').isDisabled(),true);
  await page.reload();await pending(page,'search',1);await page.getByRole('link',{name:'Back to Research',exact:true}).click();await page.waitForURL(/view=research/);await page.goBack();await pending(page,'search',1);assert.equal(reads().length,before+1);assert.deepEqual(fixture().receiptCandidates[0].candidate,search);assertPrivateReceiptHtml(await page.content());
  await page.goto(origin+researchRoute());await submitReceiptAction(page,button(page,'Continue saved proof'),()=>page.waitForURL(/notice=review-receipt/),{force:true});assert.equal(fixture().providerCalls.length,1);assert.equal(reads().length,before+1);
  await page.setViewportSize({width:320,height:800});await proof(page).scrollIntoViewIfNeeded();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(output,'r11-research-awaiting-receipt-320x800.png'),fullPage:true});await page.setViewportSize({width:1280,height:720});
  await control({r11Now:now+120_002});await page.reload();assert.equal(await button(page,'Continue saved proof').isEnabled(),true);
  const second=await context.newPage();try{
   await second.goto(origin+researchRoute());await Promise.all([
    submitReceiptAction(page,button(page,'Continue saved proof'),()=>page.waitForURL(/notice=review-receipt/)),
    submitReceiptAction(second,button(second,'Continue saved proof'),()=>second.waitForURL(/notice=review-receipt/)),
   ]);
  }finally{await second.close();}
  await page.reload();await pending(page,'select',1);
  assert.equal(fixture().providerCalls.length,2);assert.equal(fixture().collections.length,1);assert.equal(fixture().receiptCandidates[0].candidateHash,searchHash);assert.deepEqual(fixture().receiptCandidates[0].candidate,search);assert.equal(reads().length,before+3);assert.equal(fixture().outcomes.length,0);assertPrivateReceiptHtml(await page.content());
  const selector=structuredClone(fixture().receiptCandidates[1].candidate);await page.reload();await pending(page,'select',1);assert.equal(await button(page,'Continue saved proof').isDisabled(),true);
  await control({r11Now:now+240_004});await page.reload();await proof(page).getByText(/Expired: no new dispatch is authorized/).waitFor();assert.equal(await button(page,'Continue saved proof').isEnabled(),true);
  await submitReceiptAction(page,button(page,'Continue saved proof'),()=>proof(page).locator('[data-r11-result]').waitFor());assert.equal(fixture().results.length,1);assert.equal(fixture().providerCalls.length,2);assert.equal(fixture().settlements.length,4);assert.deepEqual(fixture().receiptCandidates[1].candidate,selector);assert.equal(fixture().outcomes.length,0);
  const calls=fixture().providerCalls;assert.deepEqual(reads().slice(before).map(row=>row.generationId),[calls[0].receiptId,calls[0].receiptId,calls[1].receiptId,calls[1].receiptId]);
  await page.reload();await page.getByRole('link',{name:'Back to Research',exact:true}).click();await page.waitForURL(/view=research/);await page.goBack();await proof(page).locator('[data-r11-result]').waitFor();assert.equal(reads().length,before+4);assert.equal(fixture().providerCalls.length,2);
 });
 await check('R11 hydrated Continue recovers uncertain collection and result persistence from the exact verified candidate',async()=>{
  for(const failed of ['r11CollectFailure','r11CompleteFailure']){
   await start({r11ReceiptDelayMs:0,[failed]:true});const before=reads().length;
   await submitReceiptAction(page,button(page,'Run public evidence proof'),()=>proof(page).getByRole('heading',{name:'Receipt verified · saved proof pending',exact:true}).waitFor());
   const count=failed==='r11CollectFailure'?1:2,staged=structuredClone(fixture().receiptCandidates);assert.equal(fixture().providerCalls.length,count);assert.equal(fixture().results.length,0);assert.equal(fixture().outcomes.length,0);assert.equal(fixture().policies[0].revoked,false);assert.equal(reads().length,before+count);assertPrivateReceiptHtml(await page.content());
   await page.reload();assert.equal(await button(page,'Continue saved proof').isEnabled(),true);await control({[failed]:false});
   await submitReceiptAction(page,button(page,'Continue saved proof'),()=>proof(page).locator('[data-r11-result]').waitFor());assert.equal(fixture().results.length,1);assert.equal(fixture().providerCalls.length,2);assert.equal(fixture().settlements.length,4);assert.equal(reads().length,before+2);assert.equal(fixture().outcomes.length,0);
   for(const entry of staged)assert.deepEqual(fixture().receiptCandidates.find(row=>row.requestId===entry.requestId),entry);
  }
 });
 await check('R11 hydrated terminal receipt 401 records one bounded revocation and never displays staged output',async()=>{
  await start({r11ReceiptDelayMs:0,r11GenerationResponses:['unauthorized']});const before=reads().length;
  await submitReceiptAction(page,button(page,'Run public evidence proof'),()=>proof(page).getByRole('heading',{name:'Saved proof failure',exact:true}).waitFor());
  await proof(page).getByText('Safe observed response details',{exact:true}).click();await proof(page).getByText(/Generation receipt HTTP status: 401/).waitFor();assert.equal(reads().length,before+1);assert.equal(fixture().providerCalls.length,1);assert.equal(fixture().outcomes.length,1);assert.equal(fixture().policies[0].revoked,true);assert.equal(fixture().results.length,0);assertPrivateReceiptHtml(await page.content());
  assert.equal(await button(page,'Continue saved proof').isDisabled(),true);await page.reload();assert.equal(reads().length,before+1);
 });
 await check('R11 hydrated Stop preserves paid accounting and fences the pending receipt after navigation',async()=>{
  await start();await submitReceiptAction(page,button(page,'Run public evidence proof'),()=>pending(page,'search',1));const before=reads().length;
  await page.goto(noKeyOrigin+researchRoute());await submitReceiptAction(page,button(page,'Stop this proof'),()=>proof(page).getByRole('heading',{name:'Saved owner Stop',exact:true}).waitFor());
  await page.goto(origin+researchRoute());assert.equal(await button(page,'Continue saved proof').isDisabled(),true);assertPrivateReceiptHtml(await page.content());assert.equal(fixture().providerCalls.length,1);assert.equal(fixture().settlements[0].actualMicrounits,'10068');assert.equal(reads().length,before);assert.equal(fixture().collections.length,0);assert.equal(fixture().results.length,0);
 });
 await control({...R11_RESET});
}
