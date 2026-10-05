import assert from 'node:assert/strict';
import path from 'node:path';
import {actualZoomBrowser} from './browser-zoom.mjs';
import {bounded,observe,FIXTURE_ACTION_TIMEOUT_MS,FIXTURE_NAVIGATION_TIMEOUT_MS} from './async-bounds.mjs';
import {researchControl,researchRoute} from './r11-http.mjs';
import {r11Scope,r11ContinuationScope,R11_RESET,R11_RAW_SENTINEL,R11_INERT_SERVER_KEY} from './r11-research.mjs';

/** A redirect's Flight body may stay open; exact headers and fresh DOM prove rejection. */
export async function submitResearchConsentRejection(page,button,origin){
 const actionUrl=page.url(),destination=origin+researchRoute()+'&notice=consent-required';
 assert.equal(actionUrl,origin+researchRoute(),'Consent rejection must start on the fresh exact-Business route');
 let actionRequest;
 const capture=request=>{if(!actionRequest&&request.method()==='POST'&&request.url()===actionUrl&&request.headers()['next-action'])actionRequest=request;};
 page.on('request',capture);
 const observed=observe(page.waitForResponse(response=>!!actionRequest&&response.request()===actionRequest,{timeout:FIXTURE_ACTION_TIMEOUT_MS}));
 try{
  await button.click({timeout:FIXTURE_ACTION_TIMEOUT_MS});
  const result=await bounded(observed,'R11 exact consent action response headers',FIXTURE_ACTION_TIMEOUT_MS);
  if(!result.ok)throw result.error;
  assert.equal(result.value.request(),actionRequest);assert.equal(result.value.status(),200);
  const redirect=result.value.headers()['x-action-redirect'];assert.ok(redirect,'The exact consent action must return a redirect header');
  assert.equal(new URL(redirect.split(';')[0],actionUrl).href,destination);
  await page.waitForURL(destination,{timeout:FIXTURE_NAVIGATION_TIMEOUT_MS});
  await page.getByText(/Review both consent statements/).waitFor({state:'visible',timeout:FIXTURE_ACTION_TIMEOUT_MS});
  await button.waitFor({state:'visible',timeout:FIXTURE_ACTION_TIMEOUT_MS});
 }finally{page.off('request',capture);}
}

export async function runResearchQualificationBrowser({page,context,origin,noKeyOrigin,boundary,output,check,actions}) {
 const control=values=>researchControl(boundary,values);
 const fixture=()=>boundary.state().r11Research;
 const proof=target=>target.locator(`[data-r11-policy="${r11Scope.policyId}"]`);
 const grant=target=>target.locator(`[data-r11-grant="${r11Scope.grantId}"]`);
 const runButton=target=>proof(target).getByRole('button',{name:'Run public evidence proof',exact:true});
 const stopButton=target=>proof(target).getByRole('button',{name:'Stop this proof',exact:true});
 const result=target=>proof(target).locator('[data-r11-result]');
 const reset=async(extra={})=>{await control({...R11_RESET,...extra});await context.clearCookies();await page.goto(origin+researchRoute());await page.locator('[data-r11-research-root]').waitFor();};
 const activate=async(target=page)=>{await grant(target).locator('input[name=readConsent]').check();await grant(target).locator('input[name=retentionConsent]').check();await grant(target).getByRole('button',{name:'Activate reviewed proof',exact:true}).click();await proof(target).waitFor();};
 const submitRunEvenIfDisabled=async(target=page)=>{const response=target.waitForResponse(response=>response.request().method()==='POST'&&!!response.request().headers()['next-action']);await proof(target).locator('form').first().evaluate(form=>form.requestSubmit());await response;await target.waitForURL(/notice=review-proof/);};

 await check('R11 prepare is an explicit real server action with stable exact IDs and no authority or paid call',async()=>{
  await reset();const before=boundary.effects.length,catalogBefore=boundary.log.filter(item=>item.kind==='inert-r11-public-catalog').length;
  const form=page.getByRole('button',{name:'Prepare public quote and setup',exact:true}).locator('..');
  const policy=await form.locator('input[name=policyId]').inputValue(),workflow=await form.locator('input[name=workflowRunId]').inputValue();
  assert.equal(catalogBefore,boundary.log.filter(item=>item.kind==='inert-r11-public-catalog').length);
  await page.getByRole('button',{name:'Prepare public quote and setup',exact:true}).click();await page.locator('#research-setup-metadata pre').waitFor();
  const preparation=JSON.parse(await page.locator('#research-setup-metadata pre').innerText());
  assert.equal(preparation.businessId,r11Scope.businessId);assert.equal(preparation.policyId,policy);assert.equal(preparation.workflowRunId,workflow);assert.equal(preparation.authorityCreated,false);assert.equal(preparation.paidCalls,0);
  assert.match(preparation.serverKeyHash,/^[a-f0-9]{64}$/);assert.match(preparation.runtimeCapabilityHash,/^[a-f0-9]{64}$/);assert.equal(preparation.quote.maximumMicrousd,250000);
  assert.equal(await form.locator('input[name=policyId]').inputValue(),policy);assert.equal(await form.locator('input[name=workflowRunId]').inputValue(),workflow);
  assert.equal(boundary.effects.length,before);assert.equal(boundary.log.filter(item=>item.kind==='inert-r11-public-catalog').length,catalogBefore+4);assert.equal(fixture().providerCalls.length,0);
  assert.doesNotMatch(await page.locator('[data-r11-research-root]').innerText(),new RegExp(R11_INERT_SERVER_KEY+'|inert-r11-provider-placeholder|"runtimeCapability"'));
  for(const [width,height] of [[1280,720],[320,800]]){
   await page.setViewportSize({width,height});await page.locator('#research-setup-metadata').scrollIntoViewIfNeeded();
   const geometry=await page.evaluate(()=>({width:document.documentElement.scrollWidth,innerWidth}));assert.ok(geometry.width<=geometry.innerWidth+1,JSON.stringify({width,geometry}));
   await page.screenshot({path:path.join(output,`r11-research-prepared-${width}x${height}.png`),fullPage:true});
   await grant(page).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,`r11-research-consent-${width}x${height}.png`),fullPage:true});
  }
  await page.setViewportSize({width:1280,height:720});

  await page.reload();assert.equal(await page.locator('#research-setup-metadata').count(),0);assert.equal(boundary.effects.length,before);assert.equal(boundary.log.filter(item=>item.kind==='inert-r11-public-catalog').length,catalogBefore+4);
 });
 await check('R11 both explicit consents are enforced by the action and duplicate activation retains one exact proof',async()=>{
  await reset();await grant(page).locator('form').evaluate(form=>{form.noValidate=true;});
  await grant(page).getByRole('button',{name:'Activate reviewed proof',exact:true}).click();await page.waitForURL(/notice=consent-required/);assert.equal(fixture().policies.length,0);
  await grant(page).locator('input[name=readConsent]').check();await grant(page).locator('form').evaluate(form=>{form.noValidate=true;});await grant(page).getByRole('button',{name:'Activate reviewed proof',exact:true}).click();await page.getByText(/Review both consent statements/).waitFor();assert.equal(fixture().policies.length,0);
  const second=await context.newPage();try{
   await second.goto(origin+researchRoute());for(const target of [page,second]){await grant(target).locator('input[name=readConsent]').check();await grant(target).locator('input[name=retentionConsent]').check();}
   await Promise.all([page,second].map(target=>grant(target).getByRole('button',{name:'Activate reviewed proof',exact:true}).click()));await Promise.all([page,second].map(target=>proof(target).waitFor()));
   assert.equal(fixture().policies.length,1);assert.equal(boundary.effects.filter(item=>item.kind==='in-memory-r11-research-activation').at(-1).business,r11Scope.businessId);assert.equal(fixture().providerCalls.length,0);
   await proof(page).getByRole('heading',{name:'Ready · pending proof',exact:true}).waitFor();assert.equal(await runButton(page).isEnabled(),true);
  }finally{await second.close();}
 });
 await check('R11 same-owner cross-Business form tampering and foreign owner navigation cannot widen the proof',async()=>{
  await reset();await grant(page).locator('input[name=businessId]').evaluate((input,value)=>{input.value=value;},r11Scope.otherBusinessId);await grant(page).locator('input[name=readConsent]').check();await grant(page).locator('input[name=retentionConsent]').check();await grant(page).getByRole('button',{name:'Activate reviewed proof',exact:true}).click();await page.waitForURL(new RegExp(r11Scope.otherBusinessId));assert.equal(fixture().policies.length,0);
  await page.goto(origin+researchRoute());await activate();await proof(page).locator('form').first().locator('input[name=businessId]').evaluate((input,value)=>{input.value=value;},r11Scope.otherBusinessId);await runButton(page).click();await page.waitForURL(new RegExp(r11Scope.otherBusinessId));assert.equal(fixture().providerCalls.length,0);assert.equal(await page.locator('[data-r11-policy]').count(),0);
  const response=await page.goto(origin+researchRoute(r11Scope.foreignBusinessId));assert.equal(response.status(),404);assert.equal(await page.locator('[data-r11-policy]').count(),0);assert.equal(fixture().providerCalls.length,0);
 });
 await check('R11 uncertain search persists a typed failure and independent revocation without making unknown cost known',async()=>{
  await reset();await activate();await control({r11ProviderFailure:'search'});await runButton(page).click();await page.waitForURL(/notice=review-proof/);await proof(page).getByRole('heading',{name:'Stopped · saved revocation',exact:true}).waitFor();
  assert.equal(fixture().providerCalls.length,1);assert.equal(fixture().markers.length,1);assert.equal(fixture().settlements.length,0);assert.equal(fixture().results.length,0);assert.equal(await result(page).count(),0);await page.getByText(/Unknown charge remains held/).waitFor();await proof(page).getByRole('heading',{name:'Saved proof failure',exact:true}).waitFor();assert.equal(fixture().outcomes.length,1);assert.equal(fixture().outcomes[0].kind,'failure');assert.equal(fixture().policies[0].workflowStatus,'needs_owner');assert.equal(await runButton(page).isDisabled(),true);
  await submitRunEvenIfDisabled();await page.reload();assert.equal(fixture().providerCalls.length,1);assert.equal(await result(page).count(),0);assert.equal(fixture().outcomes.length,1);
 });
 await check('R11 safe response diagnostics survive reload without raw provider text or false result success',async()=>{
  for(const scenario of [{r11InvalidSources:true},{r11InvalidModel:true},{r11InvalidSelection:true},{r11CompleteFailure:true}]){
   await reset();await activate();await control(scenario);await runButton(page).click();await page.waitForURL(/notice=review-proof/);await proof(page).getByRole('heading',{name:'Saved proof failure',exact:true}).waitFor();
   const calls=scenario.r11InvalidSources||scenario.r11InvalidModel?1:2;assert.equal(fixture().providerCalls.length,calls);assert.equal(fixture().settlements.length,calls);assert.equal(fixture().results.length,0);assert.equal(await result(page).count(),0);assert.equal(await runButton(page).isDisabled(),true);assert.equal(fixture().policies[0].workflowStatus,'needs_owner');assert.ok(!JSON.stringify(fixture().outcomes).includes(R11_RAW_SENTINEL));
   await proof(page).getByText('Safe observed response details',{exact:true}).click();assert.ok(!(await proof(page).innerText()).includes(R11_RAW_SENTINEL));
   if(scenario.r11InvalidSources){await proof(page).getByText('Model identity: approved canonical model',{exact:true}).waitFor();await proof(page).getByText('Rejected source domains: 1; malformed annotations: 1',{exact:true}).waitFor();await page.setViewportSize({width:320,height:800});await page.screenshot({path:path.join(output,'r11-research-safe-failure-320x800.png'),fullPage:true});await page.setViewportSize({width:1280,height:720});}
   await submitRunEvenIfDisabled();await page.reload();assert.equal(fixture().providerCalls.length,calls);assert.equal(await result(page).count(),0);
  }
 });
 await check('R11 journal persistence error stays visibly unconfirmed and explicit key-free Stop remains independently saved',async()=>{
  await reset();await activate();await control({r11InvalidSources:true,r11FailJournalFailure:true});await runButton(page).click();await page.getByText(/failure diagnostic could not be saved/).waitFor();await proof(page).getByText(/No typed validation outcome is saved/).waitFor();assert.equal(fixture().outcomes.length,0);assert.equal(fixture().policies[0].revoked,false);assert.equal(fixture().settlements[0].actualMicrounits,'10068');assert.equal(await runButton(page).isDisabled(),true);
  await control({r11StopFailure:true});await stopButton(page).click();await page.waitForURL(/notice=review-stop/);assert.equal(fixture().policies[0].revoked,false);assert.equal(await proof(page).getByRole('heading',{name:'Saved owner Stop',exact:true}).count(),0);
  await control({r11StopFailure:false});await page.goto(noKeyOrigin+researchRoute());await stopButton(page).click();await proof(page).getByRole('heading',{name:'Saved owner Stop',exact:true}).waitFor();assert.equal(fixture().outcomes.length,1);assert.equal(fixture().outcomes[0].kind,'owner_stopped');await proof(page).getByText(/No typed validation outcome is saved/).waitFor();assert.equal(fixture().policies[0].workflowStatus,'cancelled');assert.equal(fixture().providerCalls.length,1);assert.equal(fixture().settlements[0].actualMicrounits,'10068');
 });
 await check('R11 actual bounded runner saves one attributed result after concurrent clicks and preserves it across refresh and history',async()=>{
  await reset();await activate();const second=await context.newPage();try{
   await second.goto(origin+researchRoute());await Promise.all([runButton(page).click(),runButton(second).click()]);await Promise.any([result(page).waitFor(),result(second).waitFor()]);await Promise.all([page.reload(),second.reload()]);await Promise.all([result(page).waitFor(),result(second).waitFor()]);
  }finally{await second.close();}
  assert.equal(fixture().providerCalls.length,2);assert.deepEqual(fixture().providerCalls.map(item=>item.phase),['search','select']);assert.equal(fixture().settlements.length,2);assert.equal(fixture().collections.length,1);assert.equal(fixture().results.length,1);
  await proof(page).getByRole('heading',{name:'Complete · saved validated evidence',exact:true}).waitFor();await proof(page).getByRole('heading',{name:'Saved validated evidence',exact:true}).waitFor();
  assert.equal(await result(page).getByRole('link',{name:'Synthetic public gardening report',exact:true}).getAttribute('href'),'https://gardening.example/report');assert.match(await result(page).innerText(),/Adult gardeners often value practical tools/);assert.equal(await runButton(page).isDisabled(),true);
  assert.ok(actions.some(item=>item.url.includes('/dashboard/research-qualification')&&Number(item.revalidated)>0),'Real server action must revalidate the unchanged page');
  await submitRunEvenIfDisabled();await page.reload();await result(page).waitFor();await page.getByRole('link',{name:'Back to Research',exact:true}).click();await page.waitForURL(/view=research/);await page.goBack();await result(page).waitFor();await page.goForward();await page.waitForURL(/view=research/);await page.goBack();await result(page).waitFor();assert.equal(fixture().providerCalls.length,2);
 });
 await check('R11 terminal evidence survives expiry and missing server key while Stop remains explicit and usable',async()=>{
  await control({r11Expired:true});await page.reload();await result(page).waitFor();await proof(page).getByText(/Expired: no new dispatch is authorized/).waitFor();assert.equal(await runButton(page).isDisabled(),true);
  await page.goto(noKeyOrigin+researchRoute());await result(page).waitFor();await page.getByText(/dedicated admission or provider configuration is incomplete/).waitFor();assert.equal(await page.getByRole('button',{name:'Prepare continuation quote and setup',exact:true}).isDisabled(),true);assert.equal(await runButton(page).isDisabled(),true);assert.equal(await stopButton(page).isEnabled(),true);
  await stopButton(page).click();await page.waitForURL(/notice=review-stop/);await proof(page).getByText(/Revoked: further dispatch is stopped/).waitFor();await result(page).waitFor();assert.equal(fixture().providerCalls.length,2);assert.equal(await stopButton(page).isDisabled(),true);
 });
 await check('R11 saved result and exact controls reflow at both desktop and mobile sizes',async()=>{
  for(const [width,height] of [[1280,720],[1440,900],[390,844],[320,800],[640,360]]){
   await page.setViewportSize({width,height});await page.goto(origin+researchRoute());await result(page).waitFor();
   const geometry=await page.evaluate(()=>({width:document.documentElement.scrollWidth,innerWidth}));assert.ok(geometry.width<=geometry.innerWidth+1,JSON.stringify({width,height,geometry}));
   await result(page).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,`r11-research-proof-${width}x${height}.png`),fullPage:true});
  }
 });
 await check('R11 real 200 percent browser zoom keeps saved evidence and owner controls reachable',async()=>{
  const zoom=await actualZoomBrowser();try{
   await zoom.context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());const p=await zoom.context.newPage();await p.goto(origin+researchRoute());assert.equal(await zoom.set(p,2),2);await result(p).waitFor();
   const geometry=await p.evaluate(()=>({width:document.documentElement.scrollWidth,innerWidth}));assert.ok(geometry.width<=geometry.innerWidth+1,JSON.stringify(geometry));await result(p).scrollIntoViewIfNeeded();await p.screenshot({path:path.join(output,'r11-research-proof-zoom200.png'),fullPage:true});assert.equal(fixture().providerCalls.length,2);
  }finally{await zoom.close();}
 });
 await check('R11 historical Stop reconciliation remains key-free, preserves known charge and never invents the original failure reason',async()=>{
  await reset({r11Historical:true});await page.goto(noKeyOrigin+researchRoute());await proof(page).getByText(/Search: Dispatched; reported \$0\.010068 USD/).waitFor();await proof(page).getByText('Evidence selection: no dispatch recorded',{exact:true}).waitFor();assert.equal(fixture().collections.length,0);assert.equal(fixture().markers.filter(item=>item.phase==='select').length,0);
  const settlement=structuredClone(fixture().settlements),catalogs=boundary.log.filter(item=>item.kind==='inert-r11-public-catalog').length;
  await proof(page).getByRole('button',{name:'Reconcile saved Stop',exact:true}).click();await proof(page).getByText(/original stop cause remains undetermined/).waitFor();await proof(page).getByRole('heading',{name:'Saved owner Stop',exact:true}).waitFor();assert.equal(fixture().policies[0].workflowStatus,'cancelled');assert.equal(fixture().outcomes.length,2);assert.equal(fixture().outcomes[0].observation,null);assert.deepEqual(fixture().settlements,settlement);assert.equal(fixture().providerCalls.length,1);assert.equal(boundary.log.filter(item=>item.kind==='inert-r11-public-catalog').length,catalogs);
  await page.reload();await proof(page).getByText(/original stop cause remains undetermined/).waitFor();assert.equal(await proof(page).getByRole('button',{name:'Reconcile saved Stop',exact:true}).count(),0);
  await page.setViewportSize({width:320,height:800});await page.screenshot({path:path.join(output,'r11-research-legacy-reconciled-320x800.png'),fullPage:true});await page.setViewportSize({width:1280,height:720});
 });
 await check('R11 same-Goal continuation binds remaining allowance and two explicit consents without another lifetime budget',async()=>{
  await page.goto(origin+researchRoute());const prepare=page.getByRole('button',{name:'Prepare continuation quote and setup',exact:true}),form=prepare.locator('..');await prepare.waitFor();await page.getByText(/Remaining allowance: \$0\.239932 USD/).waitFor();assert.equal(await form.locator('input[name=maximumMicrousd],input[name=lifetimeCapMicrounits]').count(),0);
  await form.locator('input[name=predecessorPolicyId]').evaluate((input,value)=>{input.value=value;},r11Scope.otherBusinessId);await prepare.click();await page.getByText(/Continuation setup could not be verified/).waitFor();assert.equal(await page.locator('#research-setup-metadata').count(),0);
  await page.reload();await prepare.click();await page.locator('#research-setup-metadata pre').waitFor();const prepared=JSON.parse(await page.locator('#research-setup-metadata pre').innerText());assert.equal(prepared.mode,'continuation');assert.equal(prepared.continuation.goalId,r11Scope.goalId);assert.equal(prepared.continuation.lifetimeCapMicrounits,'848063');assert.equal(prepared.quote.maximumMicrousd,239932);assert.equal(fixture().providerCalls.length,1);assert.equal(fixture().policies.length,1);
  await control({r11InstallContinuation:true});await page.reload();const freshGrant=page.locator(`[data-r11-grant="${r11ContinuationScope.grantId}"]`),freshProof=page.locator(`[data-r11-policy="${r11ContinuationScope.policyId}"]`),activateButton=freshGrant.getByRole('button',{name:'Activate reviewed proof',exact:true});
  await freshGrant.getByText(/New one-time research cap: \$0\.239932 USD/).waitFor();await freshGrant.getByText(/authorize this one fresh continuation attempt/).waitFor();
  for(const readConsent of [false,true]){
   // A clean route makes each rejected action's notice a new navigation. Waiting
   // for an already-current notice URL would race the second action's refresh.
   await page.goto(origin+researchRoute());await freshGrant.waitFor();
   if(readConsent)await freshGrant.locator('input[name=readConsent]').check();
   await freshGrant.locator('form').evaluate(form=>{form.noValidate=true;});
   await submitResearchConsentRejection(page,activateButton,origin);assert.equal(fixture().policies.length,1);
  }
  await page.setViewportSize({width:320,height:800});await freshGrant.scrollIntoViewIfNeeded();const geometry=await page.evaluate(()=>({width:document.documentElement.scrollWidth,innerWidth}));assert.ok(geometry.width<=geometry.innerWidth+1,JSON.stringify(geometry));await page.screenshot({path:path.join(output,'r11-research-continuation-consent-320x800.png'),fullPage:true});await page.setViewportSize({width:1280,height:720});
  await freshGrant.locator('input[name=readConsent]').check();await freshGrant.locator('input[name=retentionConsent]').check();await activateButton.click();await freshProof.waitFor();assert.equal(fixture().policies.length,2);assert.equal(fixture().policies[1].goalId,r11Scope.goalId);assert.equal(fixture().policies[1].policy.maximumMicrousd,239932);assert.equal(fixture().lifetimeCapMicrounits,'848063');assert.equal(fixture().settlements[0].actualMicrounits,'10068');
  await freshProof.getByRole('button',{name:'Run public evidence proof',exact:true}).click();await freshProof.locator('[data-r11-result]').waitFor();assert.equal(fixture().providerCalls.length,3);assert.deepEqual(fixture().providerCalls.filter(item=>item.policyId===r11ContinuationScope.policyId).map(item=>item.phase),['search','select']);assert.equal(fixture().results.length,1);
  const response=page.waitForResponse(response=>response.request().method()==='POST'&&!!response.request().headers()['next-action']);await freshProof.locator('form').first().evaluate(form=>form.requestSubmit());await response;await page.reload();await freshProof.locator('[data-r11-result]').waitFor();await page.getByRole('link',{name:'Back to Research',exact:true}).click();await page.waitForURL(/view=research/);await page.goBack();await freshProof.locator('[data-r11-result]').waitFor();assert.equal(fixture().providerCalls.length,3);assert.equal(fixture().settlements[0].actualMicrounits,'10068');
 });
 await page.setViewportSize({width:1280,height:720});
}
