import assert from 'node:assert/strict';
import path from 'node:path';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {bounded,observe} from './async-bounds.mjs';
import {renderedResearchForm,researchHtmlText} from './r11-http.mjs';
import {r12OwnerRpc} from './r12-sql.mjs';
import {runR12CreativeOwnerHttp,runR12CreativeOwnerBrowser} from './r12-creative-journey.mjs';

/** Complete owner path with real SQL; fixture controls perform operator staging only. */
export async function runR12PilotJourney({origin,noKeyOrigin,boundary,output,directory,httpOnly=false}){
 const results=[],external=[],actions=[];
 const report=()=>writeFile(path.join(output,'r12-focused-pilot-acceptance.json'),JSON.stringify({results,external,actions,browser:httpOnly?'unrun HTTP-only':'actual Chromium'},null,2));
 const control=async value=>{const response=await fetch(boundary.origin+'/control',{method:'POST',body:JSON.stringify(value),signal:AbortSignal.timeout(60000)});assert.equal(response.status,200,await response.text());};
 const fixture=()=>boundary.state().r12;
 const reset=()=>control({r12Scenario:'pilot-preparation',r12Directory:directory,r12DelayReceipt:false,r12ReviewFailure:null});
 const preparation=()=>'/dashboard?'+new URLSearchParams({view:'research',type:'r12-pilot-prepare',business:fixture().businessId,source:fixture().sourceScopeId,preparation:fixture().preparationId,setupUntil:fixture().setupUntil});
 const permission=()=>'/dashboard?'+new URLSearchParams({view:'research',type:'r12-review-prepare',business:fixture().businessId,selected:fixture().scopeId});
 const progress=()=>'/dashboard?'+new URLSearchParams({view:'research',type:'r12',business:fixture().businessId,selected:fixture().scopeId,quest:fixture().goalId});
 const read=async route=>{const response=await fetch(origin+route,{signal:AbortSignal.timeout(30000)});assert.equal(response.status,200);return response.text();};
 const post=async(route,form,base=origin)=>{const response=await fetch(base+route,{method:'POST',headers:{origin:base,accept:'text/html'},body:form,signal:AbortSignal.timeout(30000)});const finalUrl=new URL(response.url);actions.push({transport:'http',status:response.status,path:finalUrl.pathname,error:finalUrl.searchParams.get('error'),message:finalUrl.searchParams.get('message')});assert.equal(response.status,200);return response.text();};
 const check=async(name,fn)=>{console.log('START:',name);try{await fn();results.push({name,status:'passed'});console.log('PASS:',name);}catch(error){results.push({name,status:'failed',error:String(error.stack??error)});await report();throw error;}await report();};
 const receipt=(html,label)=>{const escaped=label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),match=html.match(new RegExp('<label>'+escaped+'<textarea[^>]*>([\\s\\S]*?)<\\/textarea>'));assert.ok(match,`${label} visible`);return JSON.parse(researchHtmlText(match[1]));};
 const goals=()=>r12OwnerRpc(boundary.state(),'r04_quest_read',{p_business_id:fixture().businessId,p_goal_id:null,p_limit:20,p_offset:0});
 const current=()=>r12OwnerRpc(boundary.state(),'r12_discovery_owner_read',{p_business_id:fixture().businessId,p_scope_id:fixture().scopeId,p_activation:false});
 await reset();let prepared;
 await check('Focused owner preparation preserves closed history and creates one separate Goal with idempotent recovery',async()=>{
  const route=preparation(),html=await read(route),before=JSON.stringify((await goals()).data);assert.match(researchHtmlText(html),/Prepare one focused nature-design pilot/);
  const denied=renderedResearchForm(html,'Save focused pilot Goal',fixture().preparationId);denied.set('reviewed','on');await post(route,denied,noKeyOrigin);assert.equal(JSON.stringify((await goals()).data),before);
  const form=renderedResearchForm(html,'Save focused pilot Goal',fixture().preparationId);form.set('reviewed','on');prepared=receipt(await post(route,form),'Preparation receipt');assert.equal(prepared.authorityCreated,false);assert.notEqual(prepared.goalId,prepared.originalGoalId);
  const repeated=receipt(await post(route,form),'Preparation receipt');assert.deepEqual(repeated,prepared);assert.equal((await goals()).data.quests.filter(q=>q.title==='One original nature-design pilot for GB').length,1);assert.deepEqual(fixture().calls,[]);assert.equal(fixture().quoteReads,0);
 });
 await check('Focused staged permission is confirmed through the native form and executes exactly the two reviewed phases',async()=>{
  await control({r12PilotStage:prepared});const route=permission(),html=await read(route);assert.match(researchHtmlText(html),/Confirm the focused design pilot/);assert.match(researchHtmlText(html),/Earlier questions remain unresolved/);
  const form=renderedResearchForm(html,'Confirm focused pilot permission',fixture().scopeId);form.set('reviewed','on');const confirmed=receipt(await post(route,form),'Setup receipt');assert.equal(confirmed.executionAuthorized,false);
  await control({r12PilotActivate:confirmed});const run=renderedResearchForm(await read(progress()),'Continue approved research',fixture().scopeId);await post(progress(),run);
  const saved=(await current()).data;assert.equal(saved.state,'completed');assert.equal(saved.planVersion,1);assert.deepEqual(saved.phases.map(p=>p.phase),['strategy','review']);assert.equal(saved.cost.knownMicrousd,'20');assert.deepEqual(fixture().calls,['strategy','review']);assert.equal(saved.phases[1].outcome,'TEST');assert.ok(saved.focusedPilot);
  const result=researchHtmlText(await read(progress()));assert.match(result,/Bounded test recommended/);assert.match(result,/Focused original concept and learning question/);assert.doesNotMatch(result,/5 · Independent review/);
 });
 await runR12CreativeOwnerHttp({boundary,fixture,control,check,read,post,progress,receipt,noKeyOrigin});
 if(!httpOnly){
  await reset();const browser=await chromium.launch({headless:true,executablePath:process.env.GUIDED_UI_CHROMIUM_PATH,args:['--no-sandbox']});
  try{
   const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});context.setDefaultTimeout(20000);context.setDefaultNavigationTimeout(30000);
   await context.route('**/*',route=>{const u=new URL(route.request().url());if(['http:','https:'].includes(u.protocol)&&![origin,noKeyOrigin].includes(u.origin)){external.push(u.origin);return route.abort('blockedbyclient');}return route.continue();});
   const page=await context.newPage();
   const action=async(name,settled)=>{let sent;const capture=request=>{if(!sent&&request.method()==='POST'&&request.headers()['next-action'])sent=request;};page.on('request',capture);const response=observe(page.waitForResponse(r=>!!sent&&r.request()===sent,{timeout:20000}));try{await page.getByRole('button',{name,exact:true}).click();const seen=await bounded(response,'Focused pilot action headers');if(!seen.ok)throw seen.error;assert.equal(seen.value.status(),200);actions.push({status:seen.value.status(),url:seen.value.url()});await bounded(settled(),'Focused pilot rendered outcome');}finally{page.off('request',capture);}};
   await check('Hydrated focused Goal and exact permission preserve original records through refresh and duplicate confirmation',async()=>{
    const route=preparation();for(const[width,height]of[[1280,900],[390,844],[320,800]]){await page.setViewportSize({width,height});await page.goto(origin+route);await page.getByRole('heading',{name:'Prepare one focused nature-design pilot',exact:true}).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(output,`r12-pilot-prepare-${width}.png`),fullPage:true});}
    await page.setViewportSize({width:1280,height:900});await page.getByRole('checkbox',{name:/I reviewed this separate focused Goal/}).check();await action('Save focused pilot Goal',()=>page.getByRole('heading',{name:'Focused Goal prepared',exact:true}).waitFor());
    await page.getByText('Nonsecret setup receipt',{exact:true}).click();prepared=JSON.parse(await page.getByRole('textbox',{name:'Preparation receipt',exact:true}).inputValue());await page.reload();await page.getByRole('checkbox',{name:/I reviewed this separate focused Goal/}).check();await action('Save focused pilot Goal',()=>page.getByRole('heading',{name:'Focused Goal prepared',exact:true}).waitFor());await page.getByText('Nonsecret setup receipt',{exact:true}).click();assert.deepEqual(JSON.parse(await page.getByRole('textbox',{name:'Preparation receipt',exact:true}).inputValue()),prepared);
    await control({r12PilotStage:prepared});await page.goto(origin+permission());await page.getByRole('heading',{name:'Confirm the focused design pilot',exact:true}).waitFor();
    await page.getByRole('checkbox',{name:/I reviewed the focused Goal/}).check();await action('Confirm focused pilot permission',()=>page.getByRole('heading',{name:'Focused pilot prepared',exact:true}).waitFor());await page.getByText('Nonsecret operator setup receipt',{exact:true}).click();const confirmed=JSON.parse(await page.getByRole('textbox',{name:'Setup receipt',exact:true}).inputValue());
    await page.reload();await page.getByRole('checkbox',{name:/I reviewed the focused Goal/}).check();await action('Recover confirmed setup receipt',()=>page.getByRole('heading',{name:'Focused pilot prepared',exact:true}).waitFor());await page.getByText('Nonsecret operator setup receipt',{exact:true}).click();assert.deepEqual(JSON.parse(await page.getByRole('textbox',{name:'Setup receipt',exact:true}).inputValue()),confirmed);assert.deepEqual(fixture().calls,[]);
    for(const[width,height]of[[1280,900],[390,844]]){await page.setViewportSize({width,height});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(output,`r12-pilot-permission-${width}.png`),fullPage:true});}
    await control({r12PilotActivate:confirmed,r12DelayReceipt:true});
   });
   await check('Focused two-phase receipt wait resumes saved output once and retains the independent TEST after Stop',async()=>{
    await page.goto(origin+progress());await action('Continue approved research',()=>page.getByText(/Output saved.*Awaiting provider receipt/).waitFor());assert.deepEqual(fixture().calls,['strategy']);await page.reload();assert.equal(await page.getByRole('button',{name:'Continue approved research',exact:true}).isDisabled(),true);
    await control({r12Due:true,r12DelayReceipt:false});await page.reload();await action('Continue approved research',()=>page.getByRole('heading',{name:'Bounded test recommended',exact:true}).waitFor());assert.deepEqual(fixture().calls,['strategy','review']);assert.deepEqual(fixture().receipts,['strategy','strategy','review']);
    await page.getByText('Focused original concept and learning question',{exact:true}).waitFor();for(const[width,height]of[[1280,900],[390,844],[320,800]]){await page.setViewportSize({width,height});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(output,`r12-pilot-result-${width}.png`),fullPage:true});}
    await action('Stop research',()=>page.getByRole('button',{name:'Stop research',exact:true}).waitFor());await page.reload();assert.equal(await page.getByRole('button',{name:'Stop research',exact:true}).isDisabled(),true);await page.getByRole('heading',{name:'Bounded test recommended',exact:true}).waitFor();assert.equal((await current()).data.policyRevoked,true);assert.deepEqual(fixture().calls,['strategy','review']);
   });
   await runR12CreativeOwnerBrowser({boundary,fixture,control,check,page,action,origin,progress,output});
   await context.close();
  }finally{await browser.close();}
 }
 assert.deepEqual(external,[]);assert.deepEqual(boundary.denied,[]);await report();
}
