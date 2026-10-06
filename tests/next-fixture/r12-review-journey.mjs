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
 const fixture=()=>boundary.state().r12,reset=()=>control({r12Scenario:'review-preparation',r12Directory:directory,r12DelayReceipt:false,r12ReviewFailure:null});
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
 await check('Billed malformed reviewer response remains private and disables another generation',async()=>{
  await control({r12Scenario:'review-ready',r12Directory:directory,r12DelayReceipt:false,r12ReviewFailure:'json'});
  const page=await(await fetch(origin+researchRoute(),{signal:AbortSignal.timeout(30000)})).text(),form=renderedResearchForm(page,'Continue approved research',fixture().scopeId);
  const sent=await fetch(origin+researchRoute(),{method:'POST',headers:{origin,accept:'text/html'},body:form,signal:AbortSignal.timeout(30000)});assert.equal(sent.status,200);await sent.body?.cancel();
  const saved=(await r12OwnerRpc(boundary.state(),'r12_discovery_owner_read',{p_business_id:fixture().businessId,p_scope_id:fixture().scopeId,p_activation:false})).data;
  assert.equal(saved.phases[4].responseDiagnostic.code,'json_parse');assert.equal(saved.phases[4].responseObservation.contentState,'complete');assert.equal(saved.phases[4].candidateSaved,false);assert.equal(saved.cost.knownMicrousd,'50');assert.deepEqual(fixture().calls,['review']);assert.deepEqual(fixture().receipts,[]);
  const rendered=await(await fetch(origin+researchRoute(),{signal:AbortSignal.timeout(30000)})).text();assert.match(researchHtmlText(rendered),/Review response was not accepted/);assert.match(researchHtmlText(rendered),/required JSON object/);assert.doesNotMatch(rendered,/UNQUALIFIED_NEXT_JSON_SENTINEL/);
 });
 await check('Rendered factual addendum confirmation and final two-call execution preserve the accepted predecessor',async()=>{
  await control({r12Scenario:'evidence-preparation',r12Directory:directory,r12DelayReceipt:false,r12ReviewFailure:null});
  const before=(await workspace()).data,page=await read();assert.match(researchHtmlText(page),/Review additional research evidence/);assert.match(researchHtmlText(page),/two-call financial permission/);assert.match(researchHtmlText(page),/Synthetic nature shirt offer/);assert.equal(fixture().calls.length,0);
  const bad=renderedResearchForm(page,'Confirm additional evidence analysis',fixture().scopeId);bad.set('reviewed','on');bad.set('proposalHash','0'.repeat(64));await post(bad);assert.deepEqual((await workspace()).data,before);
  const form=renderedResearchForm(page,'Confirm additional evidence analysis',fixture().scopeId);form.set('reviewed','on');await post(form);const confirmed=(await workspace()).data;assert.equal(confirmed.proposal.operatingPolicy.maximumDispatches,2);assert.ok(confirmed.confirmation);await post(form);assert.deepEqual((await workspace()).data.confirmation,confirmed.confirmation);
  const recovery=renderedResearchForm(await read(),'Recover confirmed setup receipt',fixture().scopeId);recovery.set('reviewed','on');const html=await post(recovery,origin,true),match=html.match(/<label>Setup receipt<textarea[^>]*>([\s\S]*?)<\/textarea>/);assert.ok(match);const receipt=JSON.parse(researchHtmlText(match[1]));
  await control({r12ReviewActivate:receipt});const research=await(await fetch(origin+researchRoute(),{signal:AbortSignal.timeout(30000)})).text();const run=renderedResearchForm(research,'Continue approved research',fixture().scopeId);
  const sent=await fetch(origin+researchRoute(),{method:'POST',headers:{origin,accept:'text/html'},body:run,redirect:'manual',signal:AbortSignal.timeout(30000)});assert.ok([200,303].includes(sent.status));await sent.body?.cancel();
  const saved=(await r12OwnerRpc(boundary.state(),'r12_discovery_owner_read',{p_business_id:fixture().businessId,p_scope_id:fixture().scopeId,p_activation:false})).data;
  assert.equal(saved.state,'completed');assert.equal(saved.planVersion,4);assert.equal(saved.cost.knownMicrousd,'80');assert.equal(saved.priorStrategy.knownMicrousd,'10');assert.equal(saved.priorReviews.length,2);assert.deepEqual(fixture().calls,['strategy','review']);assert.deepEqual(fixture().receipts,['strategy','review']);
  const result=await(await fetch(origin+researchRoute(),{signal:AbortSignal.timeout(30000)})).text();assert.match(researchHtmlText(result),/Reviewed additional public observations/);assert.match(researchHtmlText(result),/Needs more evidence/);
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
   await check('Owner sees the exact failed output constraint, preserved cost and Stop without unqualified text',async()=>{
    await control({r12Scenario:'review-ready',r12Directory:directory,r12DelayReceipt:false,r12ReviewFailure:'schema'});await page.goto(origin+researchRoute());
    await action('Continue approved research',()=>page.getByText('Review response was not accepted.',{exact:true}).waitFor());
    await page.getByText('Validation details',{exact:true}).click();await page.getByText('$.checks[0].rationale: max length 240',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Continue approved research',exact:true}).isDisabled(),true);
    assert.deepEqual(fixture().calls,['review']);assert.deepEqual(fixture().receipts,[]);assert.equal(await page.getByRole('heading',{name:'Needs more evidence',exact:true}).count(),0);assert.doesNotMatch(await page.locator('body').innerText(),/x{241}/);
    for(const [width,height] of [[1280,900],[390,844]]){await page.setViewportSize({width,height});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(output,`r12-review-rejected-${width}.png`),fullPage:true});}
    await action('Stop research',()=>page.getByText('Research stopped',{exact:true}).waitFor());await page.reload();await page.getByText('Review response was not accepted.',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Stop research',exact:true}).isDisabled(),true);assert.deepEqual(fixture().calls,['review']);assert.deepEqual(fixture().receipts,[]);
   });
   await check('A separately confirmed successor retains the failed review charge and original evidence through the owner journey',async()=>{
    await control({r12Scenario:'review-successor-preparation',r12Directory:directory,r12DelayReceipt:false,r12ReviewFailure:null});await page.setViewportSize({width:1280,height:900});
    const previous=fixture().reviewEnvelope.reviewHistory[0];await page.goto(origin+'/dashboard?'+new URLSearchParams({view:'research',type:'r12',business:fixture().businessId,selected:previous.scopeId,quest:fixture().goalId}));
    await page.getByText('Research stopped',{exact:true}).waitFor();await page.getByRole('link',{name:'Review the remaining independent call',exact:true}).click();await page.getByRole('heading',{name:'Prepare the remaining review',exact:true}).waitFor();await page.getByText(/including 1 closed review attempt/).waitFor();
    await page.getByRole('checkbox',{name:/I reviewed the Business and Goal changes/}).check();await action('Confirm remaining review',()=>page.getByRole('heading',{name:'Remaining review prepared',exact:true}).waitFor());await page.getByText('Nonsecret operator setup receipt',{exact:true}).click();const nextReceipt=JSON.parse(await page.getByRole('textbox',{name:'Setup receipt',exact:true}).inputValue());
    await control({r12ReviewActivate:nextReceipt});await page.goto(origin+researchRoute());await page.getByRole('heading',{name:'Earlier closed reviews',exact:true}).waitFor();await action('Continue approved research',()=>page.getByRole('heading',{name:'Needs more evidence',exact:true}).waitFor());assert.deepEqual(fixture().calls,['review']);assert.deepEqual(fixture().receipts,['review']);
    const saved=(await r12OwnerRpc(boundary.state(),'r12_discovery_owner_read',{p_business_id:fixture().businessId,p_scope_id:fixture().scopeId,p_activation:false})).data;assert.equal(saved.planVersion,3);assert.equal(saved.priorReviews.length,1);assert.equal(saved.cost.knownMicrousd,'60');assert.equal(saved.priorReviews[0].knownMicrousd,'10');
    await page.getByRole('link',{name:'Review attempt 1',exact:true}).click();await page.getByText('Review response was not accepted.',{exact:true}).waitFor();await page.goBack();await page.getByRole('heading',{name:'Needs more evidence',exact:true}).waitFor();
    for(const [width,height] of [[1280,900],[390,844]]){await page.setViewportSize({width,height});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(output,`r12-review-successor-${width}.png`),fullPage:true});}
    await action('Stop research',()=>page.getByRole('button',{name:'Stop research',exact:true}).waitFor());await page.reload();assert.equal(await page.getByRole('button',{name:'Stop research',exact:true}).isDisabled(),true);assert.deepEqual(fixture().calls,['review']);
   });
   await check('Owner reviews factual addendum and completes exactly strategy plus review in the final plan slot',async()=>{
    await control({r12Scenario:'evidence-preparation',r12Directory:directory,r12DelayReceipt:false,r12ReviewFailure:null});
    for(const [width,height] of [[1280,900],[390,844],[320,800]]){
     await page.setViewportSize({width,height});await page.goto(origin+route());await page.getByRole('heading',{name:'Review additional research evidence',exact:true}).waitFor();
     await page.getByRole('region',{name:'Additional public observations',exact:true}).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
     await page.screenshot({path:path.join(output,`r12-evidence-preparation-${width}.png`),fullPage:true});
    }
    await page.setViewportSize({width:1280,height:900});await page.getByRole('checkbox',{name:/I reviewed the public-source observations/}).check();
    await action('Confirm additional evidence analysis',()=>page.getByRole('heading',{name:'Additional analysis prepared',exact:true}).waitFor());
    await page.getByText('Nonsecret operator setup receipt',{exact:true}).click();const prepared=JSON.parse(await page.getByRole('textbox',{name:'Setup receipt',exact:true}).inputValue());assert.equal(prepared.executionAuthorized,false);
    await page.getByRole('link',{name:'Inspect the saved decision and earlier research',exact:true}).click();await page.getByRole('heading',{name:'Needs more evidence',exact:true}).waitFor();
    await page.getByRole('link',{name:'Review additional evidence analysis',exact:true}).click();await page.getByRole('heading',{name:'Review additional research evidence',exact:true}).waitFor();
    await page.getByRole('checkbox',{name:/I reviewed the public-source observations/}).check();await action('Recover confirmed setup receipt',()=>page.getByRole('heading',{name:'Additional analysis prepared',exact:true}).waitFor());
    await page.getByText('Nonsecret operator setup receipt',{exact:true}).click();assert.deepEqual(JSON.parse(await page.getByRole('textbox',{name:'Setup receipt',exact:true}).inputValue()),prepared);assert.deepEqual(fixture().calls,[]);
    await control({r12ReviewActivate:prepared,r12DelayReceipt:true});await page.goto(origin+researchRoute());
    await action('Continue approved research',()=>page.getByText(/Output saved.*Awaiting provider receipt/).waitFor());assert.deepEqual(fixture().calls,['strategy']);assert.deepEqual(fixture().receipts,['strategy']);
    await page.reload();assert.equal(await page.getByRole('button',{name:'Continue approved research',exact:true}).isDisabled(),true);
    await control({r12Due:true,r12DelayReceipt:false});await page.reload();await action('Continue approved research',()=>page.getByRole('heading',{name:'Needs more evidence',exact:true}).waitFor());
    assert.deepEqual(fixture().calls,['strategy','review']);assert.deepEqual(fixture().receipts,['strategy','strategy','review']);
    await page.getByText('Reviewed additional public observations',{exact:true}).waitFor();
    const saved=(await r12OwnerRpc(boundary.state(),'r12_discovery_owner_read',{p_business_id:fixture().businessId,p_scope_id:fixture().scopeId,p_activation:false})).data;
    assert.equal(saved.planVersion,4);assert.equal(saved.cost.knownMicrousd,'80');assert.equal(saved.priorStrategy.knownMicrousd,'10');assert.equal(saved.priorReviews.length,2);
    const currentResultUrl=origin+researchRoute(),previousLink=page.getByRole('link',{name:'Inspect the earlier saved decision',exact:true});
    const previousHref=await previousLink.getAttribute('href');assert.ok(previousHref);
    // Both results have the same NME heading. Wait for the destination and its
    // active scope identity before Back, so the test cannot interrupt that visit.
    await Promise.all([page.waitForURL(origin+previousHref),previousLink.click()]);
    await page.getByRole('region',{name:'Qualified discovery progress',exact:true}).locator(`input[name="scopeId"][value="${fixture().predecessorScopeId}"]`).first().waitFor({state:'attached'});
    await page.getByRole('heading',{name:'Needs more evidence',exact:true}).waitFor();
    await page.goBack();await page.waitForURL(currentResultUrl);
    await page.getByRole('region',{name:'Qualified discovery progress',exact:true}).locator(`input[name="scopeId"][value="${fixture().scopeId}"]`).first().waitFor({state:'attached'});
    await page.getByText('Reviewed additional public observations',{exact:true}).waitFor();
    for(const [width,height] of [[1280,900],[390,844]]){await page.setViewportSize({width,height});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(output,`r12-evidence-result-${width}.png`),fullPage:true});}
    await action('Stop research',()=>page.getByRole('button',{name:'Stop research',exact:true}).waitFor());await page.reload();assert.equal(await page.getByRole('button',{name:'Stop research',exact:true}).isDisabled(),true);assert.deepEqual(fixture().calls,['strategy','review']);
   });
   await context.close();
  }finally{await browser.close();}
 }
 await control({r12ReviewFailure:null});assert.deepEqual(external,[]);assert.deepEqual(boundary.denied,[]);await report();
}
