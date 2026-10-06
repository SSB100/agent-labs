import assert from 'node:assert/strict';
import path from 'node:path';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {bounded,observe} from './async-bounds.mjs';
import {renderedResearchForm,researchHtmlText} from './r11-http.mjs';
import {r12OwnerRpc} from './r12-sql.mjs';

export async function runR12ReviewJourney({origin,noKeyOrigin,boundary,output,directory,httpOnly=false}){
 const results=[],external=[],actions=[];
 const report=()=>writeFile(path.join(output,'r12-review-continuation-acceptance.json'),JSON.stringify({results,external,actions,browser:httpOnly?'unrun HTTP-only':'actual Chromium'},null,2));
 const control=async input=>{const response=await fetch(boundary.origin+'/control',{method:'POST',body:JSON.stringify(input),signal:AbortSignal.timeout(30000)});assert.equal(response.status,200,await response.text());};
 const fixture=()=>boundary.state().r12,reset=()=>control({r12Scenario:'review-preparation',r12Directory:directory,r12DelayReceipt:false});
 const route=()=>'/dashboard?'+new URLSearchParams({view:'research',type:'r12-review-prepare',business:fixture().businessId,selected:fixture().scopeId});
 const researchRoute=()=>'/dashboard?'+new URLSearchParams({view:'research',type:'r12',business:fixture().businessId,selected:fixture().scopeId,quest:fixture().goalId});
 const read=async(base=origin)=>{const response=await fetch(base+route(),{signal:AbortSignal.timeout(30000)});assert.equal(response.status,200);return response.text();};
 const workspace=()=>r12OwnerRpc(boundary.state(),'r12_review_owner_read',{p_business_id:fixture().businessId,p_scope_id:fixture().scopeId});
 const check=async(name,fn)=>{console.log('START:',name);try{await fn();results.push({name,status:'passed'});console.log('PASS:',name);}catch(error){results.push({name,status:'failed',error:String(error.stack??error)});await report();throw error;}await report();};
 const post=async(form,base=origin,capture=false)=>{const response=await fetch(base+route(),{method:'POST',headers:{origin:base,accept:'text/html'},body:form,redirect:'manual',signal:AbortSignal.timeout(30000)});assert.ok([200,303].includes(response.status));if(capture)return response.text();await response.body?.cancel();return null;};
 await reset();
 await check('Remaining-review GET and key-free failed confirmation preserve the exact staged proposal without effects',async()=>{
  const before=JSON.stringify((await workspace()).data),page=await read();assert.match(researchHtmlText(page),/Prepare the remaining review/);assert.match(researchHtmlText(page),/one independent reviewer call/);assert.equal(fixture().calls.length,0);assert.equal(fixture().quoteReads,0);
  const unavailable=await fetch(origin+route(),{headers:{cookie:'r03-mode=unavailable'},signal:AbortSignal.timeout(30000)});assert.equal(unavailable.status,200);const unavailableHtml=await unavailable.text();assert.match(researchHtmlText(unavailableHtml),/remaining-review proposal is unavailable/);assert.doesNotMatch(unavailableHtml,/>Confirm remaining review<\/button>/);
  const form=renderedResearchForm(page,'Confirm remaining review',fixture().scopeId);form.set('reviewed','on');await post(form,noKeyOrigin);assert.equal(JSON.stringify((await workspace()).data),before);
  const tampered=renderedResearchForm(page,'Confirm remaining review',fixture().scopeId);tampered.set('reviewed','on');tampered.set('proposalHash','0'.repeat(64));await post(tampered);assert.equal(JSON.stringify((await workspace()).data),before);
 });
 await check('Rendered owner confirmation appends exact same-Goal revisions once and recovers repeated submission',async()=>{
  const before=(await workspace()).data,form=renderedResearchForm(await read(),'Confirm remaining review',fixture().scopeId);form.set('reviewed','on');await post(form);const saved=(await workspace()).data;assert.ok(saved.confirmation);assert.equal(saved.confirmation.businessRevision,before.proposal.expectedBusinessRevision+1);assert.equal(saved.confirmation.goalRevision,before.proposal.expectedGoalRevision+2);assert.equal(saved.proposal.operatingPolicy.maximumDispatches,1);
  await post(form);assert.deepEqual((await workspace()).data.confirmation,saved.confirmation);assert.match(researchHtmlText(await read()),/already confirmed/);assert.equal(fixture().calls.length,0);
 });
 await check('Native owner-confirmed continuation activates through the actual recipe and executes only its missing review',async()=>{
  const stagedRead=await r12OwnerRpc(boundary.state(),'r12_discovery_owner_read',{p_business_id:fixture().businessId,p_scope_id:fixture().scopeId,p_activation:false});assert.equal(stagedRead.data.state,'awaiting_authority');assert.equal(stagedRead.data.cost.knownMicrousd,'40');assert.equal(stagedRead.data.phases.filter(phase=>phase.status==='completed').length,4);
  const recovery=renderedResearchForm(await read(),'Recover confirmed setup receipt',fixture().scopeId);recovery.set('reviewed','on');const html=await post(recovery,origin,true),match=html.match(/<label>Setup receipt<textarea[^>]*>([\s\S]*?)<\/textarea>/);assert.ok(match,'Owner response renders its nonsecret setup receipt');const receipt=JSON.parse(researchHtmlText(match[1]));assert.equal(receipt.executionAuthorized,false);
  await control({r12ReviewActivate:receipt});const response=await fetch(origin+researchRoute(),{signal:AbortSignal.timeout(30000)}),page=await response.text();assert.equal(response.status,200);const form=renderedResearchForm(page,'Continue approved research',fixture().scopeId);
  const sent=await fetch(origin+researchRoute(),{method:'POST',headers:{origin,accept:'text/html'},body:form,redirect:'manual',signal:AbortSignal.timeout(30000)});assert.ok([200,303].includes(sent.status));await sent.body?.cancel();
  const final=await r12OwnerRpc(boundary.state(),'r12_discovery_owner_read',{p_business_id:fixture().businessId,p_scope_id:fixture().scopeId,p_activation:false});assert.equal(final.data.state,'completed');assert.equal(final.data.cost.knownMicrousd,'50');assert.deepEqual(fixture().calls,['review']);assert.deepEqual(fixture().receipts,['review']);
 });
 if(!httpOnly){
  await reset();const browser=await chromium.launch({headless:true,executablePath:process.env.GUIDED_UI_CHROMIUM_PATH,args:['--no-sandbox']});
  try{
   const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});context.setDefaultTimeout(20000);context.setDefaultNavigationTimeout(30000);
   await context.route('**/*',route=>{const u=new URL(route.request().url());if(['http:','https:'].includes(u.protocol)&&![origin,noKeyOrigin].includes(u.origin)){external.push(u.origin);return route.abort('blockedbyclient');}return route.continue();});
   const page=await context.newPage();
   const action=async(name,settled)=>{let sent;const capture=request=>{if(!sent&&request.method()==='POST'&&request.headers()['next-action'])sent=request;};page.on('request',capture);const response=observe(page.waitForResponse(response=>!!sent&&response.request()===sent,{timeout:20000}));try{await page.getByRole('button',{name,exact:true}).click();const seen=await bounded(response,'Remaining review action headers');if(!seen.ok)throw seen.error;assert.equal(seen.value.status(),200);actions.push({status:seen.value.status(),url:seen.value.url()});await bounded(settled(),'Remaining review saved outcome');}finally{page.off('request',capture);}};
   let receipt;
   await check('Hydrated remaining-review form preserves original intent through confirmation, Back and receipt recovery',async()=>{
    for(const [width,height] of [[1280,900],[390,844],[320,800]]){await page.setViewportSize({width,height});await page.goto(origin+route());await page.getByRole('heading',{name:'Prepare the remaining review',exact:true}).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(output,`r12-review-preparation-${width}.png`),fullPage:true});}
    await page.setViewportSize({width:1280,height:900});await page.goto(origin+route());await page.getByRole('checkbox',{name:/I reviewed the Business and Goal changes/}).check();await action('Confirm remaining review',()=>page.getByRole('heading',{name:'Remaining review prepared',exact:true}).waitFor());
    await page.getByText('Nonsecret operator setup receipt',{exact:true}).click();receipt=JSON.parse(await page.getByRole('textbox',{name:'Setup receipt',exact:true}).inputValue());assert.equal(receipt.executionAuthorized,false);assert.match(receipt.controllerKeyHash,/^[a-f0-9]{64}$/);assert.match(receipt.admissionKeyHash,/^[a-f0-9]{64}$/);
    await page.getByRole('link',{name:'Inspect the four saved phases',exact:true}).click();await page.getByRole('region',{name:'Qualified discovery progress',exact:true}).waitFor();await page.goBack();await page.reload();await page.getByRole('checkbox',{name:/I reviewed the Business and Goal changes/}).check();await action('Recover confirmed setup receipt',()=>page.getByRole('heading',{name:'Remaining review prepared',exact:true}).waitFor());await page.getByText('Nonsecret operator setup receipt',{exact:true}).click();assert.deepEqual(JSON.parse(await page.getByRole('textbox',{name:'Setup receipt',exact:true}).inputValue()),receipt);assert.equal(fixture().calls.length,0);
   });
   await check('Same owner-confirmed continuation activates through the operator recipe and completes only one delayed reviewer',async()=>{
    await control({r12ReviewActivate:receipt,r12DelayReceipt:true});await page.goto(origin+researchRoute());await action('Continue approved research',()=>page.getByText(/Output saved.*Awaiting provider receipt/).waitFor());assert.deepEqual(fixture().calls,['review']);assert.deepEqual(fixture().receipts,['review']);
    await page.reload();await page.getByText(/Output saved.*Awaiting provider receipt/).waitFor();assert.equal(await page.getByRole('button',{name:'Continue approved research',exact:true}).isDisabled(),true);
    await control({r12Due:true,r12DelayReceipt:false});await page.reload();await action('Continue approved research',()=>page.getByRole('heading',{name:'Needs more evidence',exact:true}).waitFor());assert.deepEqual(fixture().calls,['review']);assert.deepEqual(fixture().receipts,['review','review']);
    await action('Stop research',()=>page.getByRole('button',{name:'Stop research',exact:true}).waitFor());await page.reload();await page.getByRole('heading',{name:'Needs more evidence',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Stop research',exact:true}).isDisabled(),true);
    const saved=await r12OwnerRpc(boundary.state(),'r12_discovery_owner_read',{p_business_id:fixture().businessId,p_scope_id:fixture().scopeId,p_activation:false});assert.equal(saved.data.cost.knownMicrousd,'50');assert.equal(saved.data.phases.filter(p=>p.status==='completed').length,5);assert.equal(saved.data.policyRevoked,true);await page.screenshot({path:path.join(output,'r12-review-continuation-result.png'),fullPage:true});
   });
   await context.close();
  }finally{await browser.close();}
 }
 assert.deepEqual(external,[]);assert.deepEqual(boundary.denied,[]);await report();
}
