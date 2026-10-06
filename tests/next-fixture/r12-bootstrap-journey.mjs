import assert from 'node:assert/strict';
import path from 'node:path';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {bounded,observe} from './async-bounds.mjs';
import {renderedResearchForm,researchHtmlText} from './r11-http.mjs';
import {r12OwnerRpc} from './r12-sql.mjs';

/** Actual owner forms and SQL; operator-only staging stays in the inert Node fixture. */
export async function runR12BootstrapJourney({origin,noKeyOrigin,boundary,output,directory,httpOnly=false}){
 const results=[],external=[],actions=[];let browser;
 const report=()=>writeFile(path.join(output,'r12-bootstrap-acceptance.json'),JSON.stringify({results,external,actions,browser:httpOnly?'unrun HTTP-only':'actual Chromium'},null,2));
 const control=async input=>{const response=await fetch(boundary.origin+'/control',{method:'POST',body:JSON.stringify(input),signal:AbortSignal.timeout(30000)});assert.equal(response.status,200,await response.text());};
 const fixture=()=>boundary.state().r12;
 const reset=()=>control({r12Scenario:'bootstrap',r12Directory:directory,r12DelayReceipt:false});
 const route=()=>'/dashboard?'+new URLSearchParams({view:'research',type:'r12-prepare',business:fixture().businessId,prior:fixture().priorRoundId,preparation:fixture().scopeId,sourceCutoff:fixture().sourceCutoff});
 const read=async(base=origin)=>{const response=await fetch(base+route(),{signal:AbortSignal.timeout(30000)});assert.equal(response.status,200);return response.text();};
 const check=async(name,fn)=>{console.log('START:',name);try{await fn();results.push({name,status:'passed'});console.log('PASS:',name);}catch(error){results.push({name,status:'failed',error:String(error.stack??error)});await report();throw error;}await report();};
 const intent=()=>r12OwnerRpc(boundary.state(),'r04_quest_read',{p_business_id:fixture().businessId,p_goal_id:null,p_limit:20,p_offset:0});
 await reset();
 await check('R12 preparation GET has no intent or authority effects; key-free submission saves nothing',async()=>{
  const before=JSON.stringify((await intent()).data),page=await read();assert.match(researchHtmlText(page),/Save original Goal and prepare setup/);assert.deepEqual(fixture().calls,[]);assert.equal(JSON.stringify((await intent()).data),before);
  await read(noKeyOrigin);const form=renderedResearchForm(page,'Save original Goal and prepare setup',fixture().scopeId);form.set('reviewed','on');
  const response=await fetch(noKeyOrigin+route(),{method:'POST',headers:{origin:noKeyOrigin,accept:'text/html'},body:form,redirect:'manual',signal:AbortSignal.timeout(30000)});assert.ok([200,303].includes(response.status));await response.body?.cancel();
  assert.equal(JSON.stringify((await intent()).data),before);assert.deepEqual(fixture().calls,[]);
 });
 await check('R12 native rendered preparation form saves one exact Goal and recovers repeat submissions',async()=>{
  const form=renderedResearchForm(await read(),'Save original Goal and prepare setup',fixture().scopeId);form.set('reviewed','on');
  for(let attempt=0;attempt<2;attempt++){const response=await fetch(origin+route(),{method:'POST',headers:{origin,accept:'text/html'},body:form,redirect:'manual',signal:AbortSignal.timeout(30000)});assert.ok([200,303].includes(response.status));await response.body?.cancel();assert.match(researchHtmlText(await read()),/Original research setup prepared/);}
  const linked=(await intent()).data.quests.filter(q=>q.title==='Original nature-shirt geographic research');assert.equal(linked.length,1);assert.equal(linked[0].revision,2);assert.deepEqual(fixture().calls,[]);assert.equal(fixture().quoteReads,0);
 });
 if(!httpOnly){
  await reset();browser=await chromium.launch({headless:true,executablePath:process.env.GUIDED_UI_CHROMIUM_PATH,args:['--no-sandbox']});
  try{
   const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});context.setDefaultTimeout(20000);context.setDefaultNavigationTimeout(30000);
   await context.route('**/*',route=>{const u=new URL(route.request().url());if(['http:','https:'].includes(u.protocol)&&![origin,noKeyOrigin].includes(u.origin)){external.push(u.origin);return route.abort('blockedbyclient');}return route.continue();});
   const page=await context.newPage();
   const action=async(button,settled)=>{let sent;const capture=r=>{if(!sent&&r.method()==='POST'&&r.headers()['next-action'])sent=r;};page.on('request',capture);const response=observe(page.waitForResponse(r=>!!sent&&r.request()===sent,{timeout:20000}));try{await button.click();const seen=await bounded(response,'Owner bootstrap response headers');if(!seen.ok)throw seen.error;assert.equal(seen.value.status(),200);actions.push({status:seen.value.status(),url:seen.value.url()});await bounded(settled(),'Owner bootstrap rendered result');}finally{page.off('request',capture);}};
   let receipt;
   await check('R12 visible preparation form saves and reloads the original Goal without duplicate intent',async()=>{
    await page.goto(origin+route());await page.getByRole('checkbox',{name:/I reviewed the exact original Goal/}).check();
    await action(page.getByRole('button',{name:'Save original Goal and prepare setup',exact:true}),()=>page.getByRole('heading',{name:'Original research setup prepared',exact:true}).waitFor());
    await page.getByText('Nonsecret operator setup receipt',{exact:true}).click();receipt=JSON.parse(await page.getByRole('textbox',{name:'Setup receipt',exact:true}).inputValue());
    assert.equal(receipt.authorityCreated,false);assert.equal(receipt.rootId,fixture().budgetAuthorityRootId);assert.equal(receipt.ownerId,fixture().ownerId);assert.equal(receipt.businessId,fixture().businessId);assert.match(receipt.controllerKeyHash,/^[a-f0-9]{64}$/);assert.match(receipt.admissionKeyHash,/^[a-f0-9]{64}$/);
    await page.reload();await page.getByRole('heading',{name:'Original research setup prepared',exact:true}).waitFor();await page.getByText('Nonsecret operator setup receipt',{exact:true}).click();assert.deepEqual(JSON.parse(await page.getByRole('textbox',{name:'Setup receipt',exact:true}).inputValue()),receipt);assert.deepEqual(fixture().calls,[]);assert.equal(fixture().quoteReads,0);
    await page.screenshot({path:path.join(output,'r12-bootstrap-prepared.png'),fullPage:true});
   });
   await check('R12 actual staged operations can be proposed and confirmed through the owner financial form',async()=>{
    await control({r12BootstrapStage:receipt});const policy=fixture().staged.policyPayload;
    await page.getByRole('link',{name:'Review financial permission after staging',exact:true}).click();await page.getByText(/^Propose financial authority for /).click();
    for(const [name,value] of Object.entries({businessLimit:'1.053587',policyLimit:'0.406736',maximumDispatches:'5',minimumIntervalSeconds:'0',startsAt:policy.startsAt,expiresAt:policy.expiresAt}))await page.locator(`input[name="${name}"]`).fill(value);
    const operations=page.getByRole('checkbox',{name:new RegExp('^research\\.r12\\.'+fixture().scopeId+'\\.')});assert.equal(await operations.count(),5);
    for(const operation of await operations.all())await operation.check();
    await action(page.getByRole('button',{name:'Save proposal for review',exact:true}),()=>page.getByRole('button',{name:'Confirm this exact policy',exact:true}).waitFor());
    const confirmation=page.getByRole('button',{name:'Confirm this exact policy',exact:true});const article=confirmation.locator('..');await article.getByRole('checkbox',{name:'I reviewed this exact financial permission, its scope, exposure and expiry.',exact:true}).check();
    await action(confirmation,()=>page.getByRole('heading',{name:new RegExp('Quest '+receipt.goalId+' .*confirmed; dispatch remains gated')}).waitFor());
    assert.deepEqual(fixture().calls,[]);await control({r12BootstrapActivate:true});assert.equal(fixture().activated.providerCalls,0);
    await page.screenshot({path:path.join(output,'r12-bootstrap-confirmed.png'),fullPage:true});
   });
   await check('R12 prepared and UI-confirmed scope completes five actual SQL phases once and preserves the result after Stop',async()=>{
    await page.goto(origin+'/dashboard?'+new URLSearchParams({view:'research',type:'r12',business:receipt.businessId,selected:receipt.scopeId,quest:receipt.goalId}));
    await action(page.getByRole('button',{name:'Continue approved research',exact:true}),()=>page.getByRole('heading',{name:'Needs more evidence',exact:true}).waitFor());
    assert.deepEqual(fixture().calls,['plan','search1','select1','strategy','review']);assert.deepEqual(fixture().receipts,fixture().calls);
    await action(page.getByRole('button',{name:'Stop research',exact:true}),()=>page.getByRole('button',{name:'Stop research',exact:true}).waitFor());await page.reload();await page.getByRole('heading',{name:'Needs more evidence',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Stop research',exact:true}).isDisabled(),true);
    const saved=await r12OwnerRpc(boundary.state(),'r12_discovery_owner_read',{p_business_id:receipt.businessId,p_scope_id:receipt.scopeId,p_activation:false});assert.equal(saved.data.policyRevoked,true);assert.equal(saved.data.cost.knownMicrousd,'50');assert.equal((await intent()).data.business.revision,6);assert.equal(fixture().calls.length,5);
    await page.screenshot({path:path.join(output,'r12-bootstrap-result.png'),fullPage:true});
   });
   await context.close();
  }finally{await browser.close();}
 }
 assert.deepEqual(external,[]);assert.deepEqual(boundary.denied,[]);await report();
}
