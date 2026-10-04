import assert from 'node:assert/strict';
import path from 'node:path';
import {id} from './data.mjs';
import {knowledgeId,knowledgePackKey} from './knowledge.mjs';
import {knowledgeRoute} from './r09-http.mjs';
import {actualZoomBrowser} from './browser-zoom.mjs';

export async function runKnowledgeJourneys({page,context,origin,boundary,output,check,requests,actions}){
 const control=value=>fetch(boundary.origin+'/control',{method:'POST',body:JSON.stringify(value)});
 await control({workspace:true,knowledge:true,resetKnowledge:true});
 const business=id(1),goto=(type,extra={})=>page.goto(origin+knowledgeRoute(type,extra));
 const detail=()=>page.locator('.r09Detail'),effects=()=>boundary.effects.filter(e=>e.kind==='in-memory-knowledge');
 const application=()=>boundary.state().knowledge.applications.find(a=>a.businessId===business&&a.packKey===knowledgePackKey&&a.isCurrent);
 const initialEffects=effects().length,initialActions=actions.length;
 const history=JSON.stringify(boundary.state().knowledge.usage);
 const waitForSaved=async(operation,previousId=null,current=page)=>{await current.waitForURL(u=>u.searchParams.get('outcome')===operation&&u.searchParams.has('selected')&&(!previousId||u.searchParams.get('selected')!==previousId));await current.locator('.r09Outcome').waitFor();await current.locator('[data-knowledge-detail]').waitFor();assert.equal(new URL(current.url()).searchParams.get('selected'),await current.locator('.r09Detail').getAttribute('data-knowledge-detail'));};
 const fillProposal=async(form,title='Inert private lesson from actual Next')=>{
  await form.getByLabel('Lesson title',{exact:true}).fill(title);
  await form.getByLabel('Provisional lesson',{exact:true}).fill('Compare independent attributable public sources before drawing a provisional synthetic conclusion.');
  await form.getByLabel('Applicable scope',{exact:true}).fill('Synthetic source comparison only');
  await form.getByLabel('Limitations, one per line',{exact:true}).fill('One local experiment does not establish generalizability.');
  await form.getByLabel('Owned evidence artifact UUIDs',{exact:true}).fill(knowledgeId('artifact'));
 };
 await check('R09 retained installed Knowledge and private review distinguish original evidence from safe guidance',async()=>{
  await goto('installed',{selected:id(790000)});await page.getByRole('heading',{name:'Knowledge',exact:true}).waitFor();
  assert.match(await page.locator('.r09Workspace').innerText(),/Installed pack snapshots/);
  assert.match(await detail().innerText(),/2026-10-02T04:10:20/);
  await page.getByRole('link',{name:'Private proposals',exact:true}).click();await page.waitForURL(u=>u.searchParams.get('type')==='proposals');
  await goto('proposals',{selected:knowledgeId('version')});await detail().waitFor();
  assert.match(await detail().innerText(),/Rejected redaction preserves this private evidence/);
  assert.match(await detail().innerText(),/rejected|Redaction/i);assert.match(await detail().innerText(),/proof|generaliz/i);
  assert.equal(await detail().getByRole('button',{name:/Apply|Promote|Approve/}).count(),0);
  await goto('releases',{selected:knowledgeId('release',0,1)});
  assert.match(await detail().innerText(),/Reviewed source comparison guidance/);
  assert.doesNotMatch(await detail().innerText(),/PRIVATE_BUSINESS_EVIDENCE_|FOREIGN_OWNER_EVIDENCE_|PRIVATE_ACCOUNT_|PRIVATE_CUSTOMER_/);
  assert.match(await detail().innerText(),/review|source|scope/i);
  await goto('usage',{selected:knowledgeId('usage',0,1)});await detail().waitFor();assert.match(await detail().innerText(),/Exact plan v2/);assert.match(await detail().innerText(),/2\.0\.0/);
  await goto('usage',{selected:knowledgeId('usage')});assert.match(await detail().innerText(),/Exact plan v1/);assert.match(await detail().innerText(),/1\.0\.0/);
 });
 await check('R09 Overview links the exact historical Knowledge plan and native Back preserves Quest context',async()=>{
  await page.goto(origin+`/dashboard?view=overview&business=${business}&quest=${id(820000)}`);await page.locator('.r08QuestSummary>summary').click();await page.getByRole('link',{name:'Exact Knowledge pins',exact:true}).click();
  await page.waitForURL(u=>u.searchParams.get('type')==='usage'&&u.searchParams.get('selected')===knowledgeId('usage'));assert.equal(new URL(page.url()).searchParams.get('quest'),id(820000));await detail().waitFor();assert.match(await detail().innerText(),/Exact plan v1/);
  await page.goBack();await page.waitForURL(u=>u.searchParams.get('view')==='overview');assert.equal(new URL(page.url()).searchParams.get('quest'),id(820000));await page.goForward();await page.waitForURL(u=>u.searchParams.get('selected')===knowledgeId('usage'));await page.reload();await detail().waitFor();
 });
 await check('R09 Knowledge → Pack tools → exact learned release preserves selected Quest and native history',async()=>{
  const quest=id(820000),episode=id(1001),sourceArtifact=knowledgeId('artifact');
  await goto('installed',{selected:id(790000),quest,episode,sourceArtifact});
  await detail().getByRole('link',{name:'Pack tools and installation history',exact:true}).click();await page.waitForURL(u=>u.pathname==='/dashboard/packs');
  for(const[key,value]of Object.entries({business,quest,episode,sourceArtifact}))assert.equal(new URL(page.url()).searchParams.get(key),value,`Pack tools retained ${key}`);
  const learned=page.locator('.packCard').filter({has:page.getByRole('heading',{name:'Reviewed source comparison guidance',exact:true})});
  await learned.getByRole('link',{name:'Review and deliberately apply this Knowledge version',exact:true}).click();await page.waitForURL(u=>u.searchParams.get('view')==='knowledge'&&u.searchParams.get('type')==='releases'&&u.searchParams.get('selected')===knowledgeId('release',0,1));await detail().waitFor();
  for(const[key,value]of Object.entries({business,quest,episode,sourceArtifact}))assert.equal(new URL(page.url()).searchParams.get(key),value,`Learned release retained ${key}`);
  await page.goBack();await page.waitForURL(u=>u.pathname==='/dashboard/packs');assert.equal(new URL(page.url()).searchParams.get('quest'),quest);await page.goBack();await page.waitForURL(u=>u.searchParams.get('type')==='installed');assert.equal(new URL(page.url()).searchParams.get('selected'),id(790000));assert.equal(new URL(page.url()).searchParams.get('quest'),quest);
  await page.goForward();await page.waitForURL(u=>u.pathname==='/dashboard/packs');await page.goForward();await page.waitForURL(u=>u.searchParams.get('selected')===knowledgeId('release',0,1));await page.reload();await detail().waitFor();assert.equal(new URL(page.url()).searchParams.get('quest'),quest);
 });
 await check('R09 same-Quest private evidence opens the exact scoped Library artifact and returns to its proposal',async()=>{
  const quest=id(820000),episode=id(1001),artifact=knowledgeId('artifact'),proposal=knowledgeId('version');
  await goto('proposals',{selected:proposal,quest,episode});await detail().getByRole('link',{name:new RegExp(`^Exact owned artifact ${artifact}`)}).click();await page.waitForURL(u=>u.searchParams.get('view')==='library'&&u.searchParams.get('selected')===artifact);
  for(const[key,value]of Object.entries({business,quest,episode}))assert.equal(new URL(page.url()).searchParams.get(key),value,`Private artifact retained ${key}`);
  await page.locator(`[data-library-artifact="${artifact}"]`).waitFor();assert.match(await page.locator(`[data-library-artifact="${artifact}"]`).innerText(),/Private synthetic evidence 0:0/);assert.doesNotMatch(await page.locator('body').innerText(),/This exact record could not be verified|No substitute/);
  const reads=boundary.log.filter(call=>call.table==='r08_artifacts');assert.ok(reads.some(call=>call.operations.some(([op,key,value])=>op==='eq'&&key==='quest_id'&&value===quest)&&call.operations.some(([op,key,value])=>op==='eq'&&key==='id'&&value===artifact)),'Library independently verifies exact artifact under the selected Quest');
  await page.goBack();await page.waitForURL(u=>u.searchParams.get('type')==='proposals'&&u.searchParams.get('selected')===proposal);await detail().waitFor();assert.equal(new URL(page.url()).searchParams.get('quest'),quest);await page.goForward();await page.waitForURL(u=>u.searchParams.get('view')==='library');await page.reload();await page.locator(`[data-library-artifact="${artifact}"]`).waitFor();
 });
 await check('R09 paged Knowledge exact off-page selection survives search, Back, Forward, close and reload',async()=>{
  for(const type of ['proposals','releases','applications','usage']){
   const selected=knowledgeId({proposals:'version',releases:'release',applications:'application',usage:'usage'}[type]);
   await goto(type,{selected});await detail().waitFor();
   assert.equal(new URL(page.url()).searchParams.get('selected'),selected);
   const call=boundary.log.findLast(r=>r.rpc==='r09_knowledge_read'&&r.dataset===type&&r.query.selectedId===selected);
   assert.equal(call.total,127);assert.equal(call.selection,'selected');assert.ok(!call.ids.includes(selected),'Exact original must be off the first page');
   await page.locator('.r09Pager').getByRole('link',{name:'Next',exact:true}).click();await page.waitForURL(u=>u.searchParams.get('page')==='2');
   assert.equal(new URL(page.url()).searchParams.get('selected'),selected);
   await page.goBack();await page.waitForURL(u=>!u.searchParams.has('page'));await page.goForward();await page.reload();await detail().waitFor();
   assert.equal(new URL(page.url()).searchParams.get('selected'),selected);
   await goto(type,{selected,q:'no fixture result matches this search',page:'4'});await detail().waitFor();assert.match(await page.locator('.r09Pager').innerText(),/of 0/);
   assert.doesNotMatch(await detail().innerText(),/No substitute|not in this Business/);
   await detail().getByRole('link',{name:'Close detail',exact:true}).click();await page.waitForURL(u=>!u.searchParams.has('selected'));assert.equal(await detail().getAttribute('data-knowledge-detail'),null);
   await page.goBack();await detail().waitFor();assert.equal(new URL(page.url()).searchParams.get('selected'),selected);
  }
 });
 await check('R09 private same-owner and cross-owner selections never substitute records; unavailable is not empty',async()=>{
  for(const type of ['proposals','applications','usage']){
   const kind={proposals:'version',applications:'application',usage:'usage'}[type];
   for(const other of [1,2]){
    await goto(type,{selected:knowledgeId(kind,other)});await detail().waitFor();assert.match(await detail().innerText(),/not in this Business|unavailable|No substitute/i);
    assert.doesNotMatch(await detail().innerText(),/PRIVATE_BUSINESS_EVIDENCE_|FOREIGN_OWNER_EVIDENCE_/);
   }
  }
  for(const failure of ['failDataset','shortDataset']){
   await control({[failure]:'proposals'});await goto('proposals');await page.getByRole('alert').waitFor();
   assert.match(await page.locator('.r09Pager').innerText(),/Count unavailable/);
   assert.equal(await page.getByRole('button',{name:'Submit private lesson',exact:true}).count(),0);
   await control({[failure]:null});
  }
  await context.addCookies([{name:'r03-mode',value:'empty',url:origin}]);try{await goto('usage');assert.match(await page.locator('.r09Pager').innerText(),/of 0/);assert.equal(await page.getByRole('alert').count(),0);}finally{await context.clearCookies({name:'r03-mode'});}
 });
 await check('R09 newer exact Knowledge navigation wins over delayed old selection',async()=>{
  await goto('releases');const rows=page.locator('.r09List a');
  const first=new URL(await rows.nth(0).getAttribute('href'),origin).searchParams.get('selected'),second=new URL(await rows.nth(1).getAttribute('href'),origin).searchParams.get('selected');
  await control({delayId:first,delayMs:1200});await rows.nth(0).click();await rows.nth(1).click();
  await page.waitForURL(u=>u.searchParams.get('selected')===second);await detail().waitFor();await page.waitForTimeout(1300);
  assert.equal(new URL(page.url()).searchParams.get('selected'),second);assert.equal(await detail().getAttribute('data-knowledge-detail'),second);
  await control({delayId:null,delayMs:0});
 });
 assert.equal(effects().length,initialEffects,'R09 browsing created no mutations');assert.equal(actions.length,initialActions,'R09 browsing invoked no server actions');
 await check('R09 private proposal preserves failed form, rejects foreign evidence and retries one exact save',async()=>{
  await goto('proposals');await page.getByText('Propose a private lesson',{exact:true}).click();const form=page.getByRole('form',{name:'Submit private lesson',exact:true});await fillProposal(form);
  const preCredentialActions=actions.length;await form.getByLabel('Provisional lesson',{exact:true}).fill('password=inert-fixture-only-never-a-real-credential');await form.getByRole('button',{name:'Submit private lesson',exact:true}).click();await form.getByRole('status').filter({hasText:'Credential-like content was rejected'}).waitFor();assert.equal(actions.length,preCredentialActions);await fillProposal(form);
  await form.getByLabel('Owned evidence artifact UUIDs',{exact:true}).fill(knowledgeId('artifact',1));await form.getByRole('button',{name:'Submit private lesson',exact:true}).click();await form.getByRole('status').filter({hasText:'could not be verified'}).waitFor();assert.equal(effects().length,initialEffects);
  await form.getByLabel('Owned evidence artifact UUIDs',{exact:true}).fill(knowledgeId('artifact'));
  await control({actionMode:'uncertain'});await form.getByRole('button',{name:'Submit private lesson',exact:true}).click();await form.getByRole('status').filter({hasText:'could not be verified'}).waitFor();assert.equal(await form.getByLabel('Lesson title',{exact:true}).inputValue(),'Inert private lesson from actual Next');assert.equal(effects().length,initialEffects);
  await control({actionMode:'success',actionDelayMs:700});await form.getByRole('button',{name:'Submit private lesson',exact:true}).click();await form.getByRole('button',{name:'Saving…',exact:true}).waitFor();assert.equal(await form.getByRole('button',{name:'Saving…',exact:true}).isDisabled(),true);await waitForSaved('propose');
  const savedId=new URL(page.url()).searchParams.get('selected');assert.equal(effects().length,initialEffects+1);
  await goto('proposals');await page.getByText('Propose a private lesson',{exact:true}).click();const repeat=page.getByRole('form',{name:'Submit private lesson',exact:true});await fillProposal(repeat);await repeat.getByRole('button',{name:'Submit private lesson',exact:true}).click();await waitForSaved('propose');assert.equal(new URL(page.url()).searchParams.get('selected'),savedId);assert.equal(effects().length,initialEffects+1,'Repeated unchanged submit must recover one proposal');
  assert.match(await detail().innerText(),/Inert private lesson from actual Next/);assert.equal(new URL(page.url()).searchParams.get('business'),business);
  const saved=boundary.state().knowledge.proposals.find(p=>p.id===savedId);assert.equal(saved.businessId,business);assert.equal(saved.status,'proposed');assert.equal(saved.reviewId,null);
  await page.reload();assert.match(await detail().innerText(),/Inert private lesson from actual Next/);
  const original=JSON.stringify(saved);await page.getByText('Revise as a new private version',{exact:true}).click();const revise=page.getByRole('form',{name:'Revise private lesson',exact:true});await revise.getByLabel('Lesson title',{exact:true}).fill('Revised private synthetic lesson');await revise.getByRole('button',{name:'Save new private version',exact:true}).click();await waitForSaved('propose',savedId);assert.equal(effects().length,initialEffects+2);assert.equal(JSON.stringify(saved),original,'Original private proposal version is immutable');assert.match(await detail().innerText(),/Revised private synthetic lesson.*private v2/);
  assert.doesNotMatch(await page.locator('body').innerText(),/Private inert Knowledge diagnostic/);await control({actionDelayMs:0});
 });
 await check('R09 apply race selects one exact Business version; rollback and remove preserve immutable usage',async()=>{
  await goto('releases',{selected:knowledgeId('release',0,1)});const second=await context.newPage();await second.goto(page.url());
  const form=page.getByRole('form',{name:'Apply this version',exact:true}),other=second.getByRole('form',{name:'Apply this version',exact:true});
  for(const f of [form,other])await f.getByLabel('Reason for this Business',{exact:true}).fill('Use the reviewed second source comparison version for this exact Business.');
  const before=effects().length;await control({actionDelayMs:400});await Promise.all([form.getByRole('button',{name:'Apply this version',exact:true}).click(),other.getByRole('button',{name:'Apply this version',exact:true}).click()]);
  const feedback=current=>current.locator('.r09Outcome,.r09Form [role=status]');await Promise.all([feedback(page).waitFor(),feedback(second).waitFor()]);
  const statuses=await Promise.all([feedback(page).innerText(),feedback(second).innerText()]);assert.equal(statuses.filter(t=>t.includes('Exact reviewed version selected')).length,1);assert.equal(statuses.filter(t=>t.includes('could not be verified')).length,1);assert.equal(effects().length,before+1);
  assert.equal(application().releaseId,knowledgeId('release',0,1));assert.equal(boundary.state().knowledge.applications.find(a=>a.businessId===id(2)&&a.packKey===knowledgePackKey&&a.isCurrent).releaseId,knowledgeId('release'));
  await second.close();await control({actionDelayMs:0});
  await goto('applications',{selected:knowledgeId('application')});const rollback=page.getByRole('form',{name:'Roll back to this version',exact:true});await rollback.getByLabel('Reason for this Business',{exact:true}).fill('Restore the first reviewed version for this Business.');await rollback.getByRole('button',{name:'Roll back to this version',exact:true}).click();await waitForSaved('rollback');assert.equal(application().releaseId,knowledgeId('release'));
  const remove=page.getByRole('form',{name:'Remove future selection',exact:true});await remove.getByLabel('Reason for this Business',{exact:true}).fill('Remove the optional lesson from this Business future plans.');await remove.getByRole('button',{name:'Remove future selection',exact:true}).click();await waitForSaved('remove');assert.equal(application().releaseId,null);assert.equal(application().operation,'remove');
  assert.equal(JSON.stringify(boundary.state().knowledge.usage),history,'Application changes cannot mutate historical plan/task pins');
  await goto('usage',{selected:knowledgeId('usage')});await detail().waitFor();assert.match(await detail().innerText(),/1\.0\.0/);assert.match(await detail().innerText(),new RegExp(knowledgeId('release')));assert.doesNotMatch(await detail().innerText(),new RegExp(knowledgeId('release',0,1)));
 });
 await check('R09 late action after Close detail cannot reopen an obsolete selection; intentional retry recovers the saved version',async()=>{
  const target=knowledgeId('version',0,20),title='Delayed private revision after closing exact detail',before=effects().length;
  await goto('proposals',{selected:target});await page.getByText('Revise as a new private version',{exact:true}).click();const revise=page.getByRole('form',{name:'Revise private lesson',exact:true});await revise.getByLabel('Lesson title',{exact:true}).fill(title);
  const logBefore=boundary.log.length;await control({holdKnowledgeActions:true});
  const actionResponse=page.waitForResponse(response=>response.request().method()==='POST'&&!!response.request().headers()['next-action']);
  await revise.getByRole('button',{name:'Save new private version',exact:true}).click();await revise.getByRole('button',{name:'Saving…',exact:true}).waitFor();
  const held=()=>boundary.log.slice(logBefore).some(call=>call.rpc==='r09_knowledge_owner'&&call.held===true);for(let attempts=0;attempts<200&&!held();attempts++)await new Promise(resolve=>setTimeout(resolve,25));assert.ok(held(),'The inert RPC must be held before navigating away');
  await detail().getByRole('link',{name:'Close detail',exact:true}).click();await page.waitForURL(u=>u.searchParams.get('type')==='proposals'&&!u.searchParams.has('selected'));const newer=page.url();
  await control({holdKnowledgeActions:false});await (await actionResponse).finished();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(page.url(),newer,'A completed obsolete action must not push its former selection');assert.equal(await detail().getAttribute('data-knowledge-detail'),null);assert.equal(await page.locator('.r09Outcome').count(),0);assert.equal(effects().length,before+1);
  const saved=boundary.state().knowledge.proposals.find(p=>p.title===title);assert.ok(saved);assert.equal(saved.version,2);assert.equal(saved.businessId,business);
  await goto('proposals',{selected:saved.id});assert.match(await detail().innerText(),/Delayed private revision after closing exact detail/);
  await goto('proposals',{selected:target});await page.getByText('Revise as a new private version',{exact:true}).click();const retry=page.getByRole('form',{name:'Revise private lesson',exact:true});await retry.getByLabel('Lesson title',{exact:true}).fill(title);await retry.getByRole('button',{name:'Save new private version',exact:true}).click();await waitForSaved('propose');assert.equal(new URL(page.url()).searchParams.get('selected'),saved.id);assert.equal(effects().length,before+1,'Unchanged request recovers the single saved version after navigation');
 });
 await check('R09 stale and withdrawn reviewed versions remain inspectable but cannot apply to new work',async()=>{
  const before=effects().length;
  for(const n of [2,3]){await goto('releases',{selected:knowledgeId('release',0,n)});await detail().waitFor();assert.match(await detail().innerText(),n===2?/stale|expired|refresh/i:/withdrawn/i);const apply=detail().getByRole('button',{name:'Apply this version',exact:true});assert.ok(await apply.count()===0||await apply.isDisabled());}
  assert.equal(effects().length,before);
 });
 const scenes=[['r09-installed','installed',{selected:id(790000)}],['r09-private-review','proposals',{selected:knowledgeId('version')}],['r09-reviewed-v2','releases',{selected:knowledgeId('release',0,1)}],['r09-stale','releases',{selected:knowledgeId('release',0,2)}],['r09-withdrawn','releases',{selected:knowledgeId('release',0,3)}],['r09-applications','applications',{selected:knowledgeId('application')}],['r09-exact-usage','usage',{selected:knowledgeId('usage')}]];
 for(const[name,type,extra]of scenes)await check(`${name} desktop, narrow mobile and reflow layouts`,async()=>{
  for(const[width,height]of [[1280,720],[1440,900],[390,844],[320,800],[640,360]]){
   await page.setViewportSize({width,height});await goto(type,extra);await page.getByRole('heading',{name:'Knowledge',exact:true}).waitFor();await detail().waitFor();
   assert.equal(await page.getByText('Application error',{exact:false}).count(),0);const metrics=await page.evaluate(()=>({w:document.documentElement.scrollWidth,h:document.documentElement.scrollHeight}));assert.ok(metrics.w<=width+1,`${name} horizontal ${JSON.stringify(metrics)}`);if(width>=1280)assert.ok(metrics.h<=height+1,`${name} vertical ${JSON.stringify(metrics)}`);
   await page.screenshot({path:path.join(output,`${name}-${width}x${height}.png`),fullPage:true});
  }
 });
 await check('R09 private form controls are reachable on narrow and desktop viewports',async()=>{
  for(const[width,height]of [[1280,720],[1440,900],[390,844],[320,800],[640,360]]){
   await page.setViewportSize({width,height});await goto('proposals');await page.getByText('Propose a private lesson',{exact:true}).click();const field=page.getByRole('form',{name:'Submit private lesson',exact:true}).getByLabel('Owned evidence artifact UUIDs',{exact:true});await field.scrollIntoViewIfNeeded();await field.focus();assert.equal(await field.evaluate(n=>document.activeElement===n),true);const box=await field.boundingBox();assert.ok(box.width>=100&&box.height>=44);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(output,`r09-proposal-form-${width}x${height}.png`),fullPage:true});
  }
 });
 await check('R09 actual 200 percent browser zoom preserves Knowledge details and private proposal controls',async()=>{
  const zoom=await actualZoomBrowser();try{
   await zoom.context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort('blockedbyclient'));const p=await zoom.context.newPage();
   for(const[name,type,extra]of scenes){await p.goto(origin+knowledgeRoute(type,extra));assert.equal(await zoom.set(p,2),2);await p.locator('.r09Detail').waitFor();assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await p.screenshot({path:path.join(output,`${name}-zoom200.png`),fullPage:true});}
   await p.goto(origin+knowledgeRoute('proposals'));await zoom.set(p,2);await p.getByText('Propose a private lesson',{exact:true}).click();const field=p.getByRole('form',{name:'Submit private lesson',exact:true}).getByLabel('Owned evidence artifact UUIDs',{exact:true});await field.scrollIntoViewIfNeeded();await field.focus();assert.equal(await field.evaluate(n=>document.activeElement===n),true);assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await p.screenshot({path:path.join(output,'r09-proposal-form-zoom200.png')});
  }finally{await zoom.close();}
 });
 assert.ok(requests.length>0,'R09 real Next RSC navigation must be observed');assert.ok(actions.slice(initialActions).some(a=>a.status===200),'R09 real server actions must be observed');assert.ok(actions.slice(initialActions).some(a=>Number(a.revalidated)>0),'R09 successful server action must report revalidation');assert.equal(JSON.stringify(boundary.state().knowledge.usage),history);
 await page.setViewportSize({width:1280,height:720});
}
