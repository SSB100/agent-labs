import assert from 'node:assert/strict';
import path from 'node:path';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {bounded,observe} from './async-bounds.mjs';
import {renderedResearchForm,researchHtmlText} from './r11-http.mjs';
import {r12OwnerRpc} from './r12-sql.mjs';
import {actualZoomBrowser} from './browser-zoom.mjs';
export async function runR12Journeys({origin,noKeyOrigin,boundary,output,directory,httpOnly=false}){
 const results=[],external=[],actions=[];let browser,browserStatus=httpOnly?'unrun HTTP-only':'unrun';
 const report=()=>writeFile(path.join(output,'r12-research-acceptance.json'),JSON.stringify({results,actions,external,browser:browserStatus},null,2));
 const check=async(name,fn)=>{console.log('START:',name);const result={name,status:'running'};results.push(result);try{await fn();result.status='passed';console.log('PASS:',name);}catch(error){result.status='failed';result.error=String(error.stack??error);console.error('FAIL:',name,result.error);}await report();};
 const control=async values=>{const response=await fetch(boundary.origin+'/control',{method:'POST',body:JSON.stringify(values)});assert.equal(response.status,200);};
 const reset=async(scenario='current',extra={})=>control({r12Scenario:scenario,r12Directory:directory,r12DelayReceipt:false,...extra});
 const fixture=()=>boundary.state().r12;
 const route=(view='research',extra={})=>'/dashboard?'+new URLSearchParams({view,...(view==='research'?{type:'r12',selected:fixture().scopeId}:{}),business:fixture().businessId,quest:fixture().goalId,...extra});
 const read=async()=>{const r=fixture();const loaded=await r12OwnerRpc(boundary.state(),'r12_discovery_owner_read',{p_business_id:r.businessId,p_scope_id:r.scopeId,p_activation:false});assert.equal(loaded.error,null);return loaded.data;};
 const html=async(base=origin,url=route(),headers={})=>{const response=await fetch(base+url,{headers,signal:AbortSignal.timeout(30000)});return{status:response.status,body:await response.text()};};
 const until=async(predicate)=>{for(let n=0;n<200;n++){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('R12 saved outcome was not observed');};
 const post=async(button,base=origin)=>{const before=await html(base),form=renderedResearchForm(before.body,button,fixture().scopeId);const response=await fetch(base+route(),{method:'POST',headers:{origin:base,accept:'text/html'},body:form,redirect:'manual',signal:AbortSignal.timeout(30000)});assert.ok([200,303].includes(response.status));await response.body?.cancel();};
 await reset();
 await check('R12 real Next reads exact source scope and prepares hashes without authority or providers',async()=>{
  const before=fixture().calls.length,page=await html();assert.equal(page.status,200);assert.match(researchHtmlText(page.body),/Planning original concepts/);assert.equal(fixture().calls.length,before);assert.equal(fixture().quoteReads,0);
  const response=await fetch(origin+'/api/research/r12/prepare',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({businessId:fixture().businessId,scopeId:fixture().scopeId})});assert.equal(response.status,200);const prepared=await response.json();assert.equal(prepared.authorityCreated,false);assert.match(prepared.controllerKeyHash,/^[a-f0-9]{64}$/);assert.equal(fixture().calls.length,0);
  const cross=await fetch(origin+'/api/research/r12/prepare',{method:'POST',headers:{origin:'https://foreign.invalid','content-type':'application/json'},body:JSON.stringify({businessId:fixture().businessId,scopeId:fixture().scopeId})});assert.equal(cross.status,403);
 });
 await check('R12 real Next Continue persists delayed output and resumes actual SQL through all five phases once',async()=>{
  await control({r12DelayReceipt:true});await post('Continue approved research');await until(async()=>(await read()).phases[0].candidateSaved);assert.deepEqual(fixture().calls,['plan']);assert.deepEqual(fixture().receipts,['plan']);
  const waiting=await read();assert.equal(waiting.phases[0].receipt.attempts,1);assert.equal(waiting.phases[0].knownMicrousd,'10');const reload=await html();assert.match(researchHtmlText(reload.body),/Output saved.*Awaiting provider receipt/);assert.match(reload.body,/<button[^>]*disabled[^>]*>Continue approved research/);
  await post('Continue approved research');assert.equal(fixture().calls.length,1);assert.equal(fixture().receipts.length,1,'Forced early duplicate cannot check a receipt or regenerate');
  await control({r12Due:true,r12DelayReceipt:false});await post('Continue approved research');await until(async()=>(await read()).state==='completed');
  assert.deepEqual(fixture().calls,['plan','search1','select1','strategy','review']);assert.deepEqual(fixture().receipts,['plan','plan','search1','select1','strategy','review']);
  const final=await html();assert.match(researchHtmlText(final.body),/Needs more evidence/);assert.match(researchHtmlText(final.body),/Original concepts and hypotheses/);assert.match(researchHtmlText(final.body),/Geographic comparison/);assert.match(researchHtmlText(final.body),/grants no creative generation/);assert.match(final.body,/href="#r12-evidence-1"/,'Saved exact evidence is reachable from an assessment citation');assert.equal((await read()).cost.knownMicrousd,'50');
 });
 await check('R12 key-free actual Stop preserves completed results and blocks all subsequent work',async()=>{
  const before=fixture().calls.length;await post('Stop research',noKeyOrigin);await until(async()=>(await read()).policyRevoked);assert.equal((await read()).state,'completed');const saved=await html();assert.match(researchHtmlText(saved.body),/Needs more evidence/);assert.equal(fixture().calls.length,before);
  await post('Continue approved research');assert.equal(fixture().calls.length,before);assert.equal(fixture().receipts.length,6,'Completed Stop cannot repeat receipt work');
  const forbidden=await html(origin,route('research',{business:boundary.state().businesses.find(b=>b.id!==fixture().businessId).id}));assert.doesNotMatch(researchHtmlText(forbidden.body),/Original concepts and hypotheses/);
  const unauthenticated=await fetch(origin+route(),{headers:{cookie:'r03-session=off'},redirect:'manual'});assert.equal(unauthenticated.status,307);
 });
 await check('R12 key-free Stop fences a pending paid response even after receipt cooldown',async()=>{
  await reset('pending');await post('Stop research',noKeyOrigin);assert.equal((await read()).policyRevoked,true);assert.equal((await read()).phases[0].candidateSaved,true);await control({r12Due:true});await post('Continue approved research');assert.equal(fixture().calls.length,0);assert.equal(fixture().receipts.length,0);assert.equal((await read()).phases[0].knownMicrousd,'10');
 });
 if(!httpOnly){
  try{browser=await chromium.launch({headless:true,executablePath:process.env.GUIDED_UI_CHROMIUM_PATH,args:['--no-sandbox']});browserStatus='actual Chromium against production Next';}catch(error){browserStatus='blocked before browser launch; browser journeys unrun';results.push({name:'R12 Chromium launch',status:'blocked',error:String(error)});await report();throw error;}
  try{
   const context=await browser.newContext({viewport:{width:1280,height:720},reducedMotion:'reduce'});context.setDefaultTimeout(20000);context.setDefaultNavigationTimeout(30000);
   await context.route('**/*',route=>{const u=new URL(route.request().url());if(['http:','https:'].includes(u.protocol)&&![origin,noKeyOrigin].includes(u.origin)){external.push(u.origin);return route.abort('blockedbyclient');}return route.continue();});
   const page=await context.newPage();const progress=()=>page.getByRole('region',{name:'Qualified discovery progress',exact:true});
   const action=async(name,settled)=>{let sent;const capture=r=>{if(!sent&&r.method()==='POST'&&r.headers()['next-action'])sent=r;};page.on('request',capture);const response=observe(page.waitForResponse(r=>!!sent&&r.request()===sent,{timeout:20000}));try{await progress().getByRole('button',{name,exact:true}).click();const seen=await bounded(response,'R12 action response headers');if(!seen.ok)throw seen.error;assert.equal(seen.value.status(),200);actions.push({status:seen.value.status(),url:seen.value.url()});await bounded(settled(),'R12 rendered saved outcome');}finally{page.off('request',capture);}};
   await check('R12 hydrated owner workflow keeps delayed output across navigation and completes all phases once',async()=>{
    await reset('current',{r12DelayReceipt:true});await page.goto(origin+route('overview'));await page.getByRole('link',{name:'Research details',exact:true}).click();await progress().waitFor();
    await action('Continue approved research',()=>progress().getByText(/Output saved.*Awaiting provider receipt/).waitFor());assert.equal(fixture().calls.length,1);assert.equal(await progress().getByRole('button',{name:'Continue approved research',exact:true}).isDisabled(),true);
    await page.reload();await progress().waitFor();await page.getByRole('link',{name:'Business Overview',exact:true}).click();await page.waitForURL(u=>u.searchParams.get('view')==='overview');await page.goBack();await progress().waitFor();assert.equal(fixture().calls.length,1);assert.equal(fixture().receipts.length,1);
    await control({r12Due:true,r12DelayReceipt:false});await page.reload();await action('Continue approved research',()=>page.getByRole('heading',{name:'Needs more evidence',exact:true}).waitFor());assert.equal(fixture().calls.length,5);assert.equal(fixture().receipts.length,6);
    await page.reload();await page.getByText('Geographic comparison',{exact:true}).waitFor();assert.equal(fixture().calls.length,5);
   });
   await check('R12 actual Next desktop containment, mobile reflow and exact evidence links retain the full result',async()=>{
    for(const [width,height] of [[1280,720],[1440,900],[390,844],[320,800],[640,360]]){
     await page.setViewportSize({width,height});await page.goto(origin+route());await progress().waitFor();const metrics=await page.evaluate(()=>({height:innerHeight,width:innerWidth,scrollHeight:document.documentElement.scrollHeight,scrollWidth:document.documentElement.scrollWidth}));assert.ok(metrics.scrollWidth<=width+1,JSON.stringify(metrics));if(width>=1000)assert.ok(metrics.scrollHeight<=height+1,JSON.stringify(metrics));
     const region=page.getByRole('region',{name:'Discovery phases, scope and costs',exact:true});await region.focus();await page.keyboard.press('End');await page.screenshot({path:path.join(output,`r12-research-${width}x${height}.png`),fullPage:true});
    }
    await page.setViewportSize({width:1280,height:720});await page.goto(origin+route());await page.getByRole('link',{name:'Evidence 1',exact:true}).first().click();assert.equal(new URL(page.url()).hash,'#r12-evidence-1');assert.equal(fixture().calls.length,5);
   });
   await check('R12 actual 200 percent browser zoom preserves result access without horizontal overflow',async()=>{
    const zoom=await actualZoomBrowser();try{await zoom.context.route('**/*',route=>{const u=new URL(route.request().url());if(['http:','https:'].includes(u.protocol)&&![origin,noKeyOrigin].includes(u.origin)){external.push(u.origin);return route.abort('blockedbyclient');}return route.continue();});const zoomPage=await zoom.context.newPage();await zoomPage.goto(origin+route());assert.equal(await zoom.set(zoomPage,2),2);await zoomPage.getByRole('region',{name:'Qualified discovery progress',exact:true}).waitFor();assert.ok(await zoomPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));const viewport=zoomPage.viewportSize();for(const [name,target] of [['r12-research-zoom200.png',zoomPage.locator('.r12ProgressHeading')],['r12-research-result-zoom200.png',zoomPage.getByRole('heading',{name:'Needs more evidence',exact:true})]]){await target.scrollIntoViewIfNeeded();const png=await zoomPage.screenshot({path:path.join(output,name),fullPage:false});assert.equal(png.readUInt32BE(16),viewport.width,'Zoom capture preserves the full physical viewport width');assert.equal(png.readUInt32BE(20),viewport.height);}}finally{await zoom.close();}
   });
   await check('R12 hydrated key-free Stop retains results and malformed route cannot substitute another scope',async()=>{
    await page.goto(noKeyOrigin+route());await action('Stop research',()=>progress().getByRole('button',{name:'Stop research',exact:true}).waitFor({state:'visible'}));await until(async()=>(await read()).policyRevoked);await page.reload();assert.equal(await progress().getByRole('button',{name:'Stop research',exact:true}).isDisabled(),true);await page.getByRole('heading',{name:'Needs more evidence',exact:true}).waitFor();
    for(const suffix of [`&selected=${fixture().scopeId}`,`&quest=${crypto.randomUUID()}`]){await page.goto(origin+route()+suffix);assert.equal(await page.getByRole('heading',{name:'Needs more evidence',exact:true}).count(),0);}assert.equal(fixture().calls.length,5);
   });
   await context.close();
  }finally{await browser.close();}
 }
 await check('R12 Next boundary made no external request or unsupported operation',async()=>{assert.deepEqual(external,[]);assert.deepEqual(boundary.denied,[]);});await report();assert.ok(results.every(r=>r.status==='passed'),'R12 Next qualification failed; see r12-research-acceptance.json');
}
