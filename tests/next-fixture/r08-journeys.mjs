import assert from 'node:assert/strict';
import path from 'node:path';
import {id} from './data.mjs';
import {actualZoomBrowser} from './browser-zoom.mjs';
/** Read-only R08 journeys through unchanged production pages, RSC and Link navigation. */
export async function runWorkspaceJourneys({page,origin,boundary,output,check,requests,actions}){
 const business=id(1),quest=id(820000),episode=id(1001),before=boundary.effects.length,actionCount=actions.length;
 const control=v=>fetch(boundary.origin+'/control',{method:'POST',body:JSON.stringify(v)});
 await control({workspace:true});
 const route=(view,extra={})=>{const q=new URLSearchParams({view,business,quest,...extra});return '/dashboard?'+q;};
 const goto=(view,extra)=>page.goto(origin+route(view,extra));
 await check('R08 exact off-page Quest controls Overview without unrelated latest Quest work',async()=>{
  await goto('overview');await page.locator('.r08QuestSummary>summary').click();await page.getByRole('heading',{name:'Real progress',exact:true}).waitFor();
  assert.match(await page.locator('.r08Workspace').innerText(),/explicit Quest/);assert.match(await page.locator('.r08Workspace').innerText(),/1 of 2 planned steps/);
  assert.match(await page.locator('.r08Workspace').innerText(),/Target achievement unverified/);
  assert.equal(await page.locator('select[name=quest]').inputValue(),quest);
  await page.getByText('Quest history · 127',{exact:true}).click();await page.getByRole('link',{name:'Next Quests',exact:true}).click();await page.waitForURL(u=>u.searchParams.get('questPage')==='2');
  assert.equal(new URL(page.url()).searchParams.get('quest'),quest);await page.goBack();await page.waitForURL(u=>!u.searchParams.has('questPage'));await page.goForward();await page.reload();assert.equal(await page.locator('select[name=quest]').inputValue(),quest);
  await goto('overview',{quest:id(820126)});assert.match(await page.locator('.r08Workspace').innerText(),/No workflow episode exists for this Quest/);assert.doesNotMatch(await page.locator('.r08Workspace').innerText(),/Episode 00001001/);
 });
 await check('R08 Overview → Events → exact off-page Step/Agent outputs retains provenance',async()=>{
  await goto('overview');await page.locator('.consoleNavigation').getByRole('link',{name:'Events',exact:true}).click();await page.waitForURL(u=>u.searchParams.get('view')==='work');assert.equal(new URL(page.url()).searchParams.get('quest'),quest);
  await goto('work',{selected:episode,episode});await page.locator(`[data-work-detail="${episode}"]`).waitFor();
  await page.getByText('Steps in execution order',{exact:false}).click();
  const stages=boundary.state().db.workflow_stage_runs.filter(s=>s.workflow_run_id===episode).sort((a,b)=>a.sequence-b.sequence||a.attempt-b.attempt||a.id.localeCompare(b.id));
  if(stages.length){await goto('work',{selected:episode,episode,step:stages.at(-1).id});await page.getByLabel('Exact Step outputs and failure',{exact:true}).waitFor();assert.equal(new URL(page.url()).searchParams.get('step'),stages.at(-1).id);}
  const worker=boundary.state().db.worker_runs.find(w=>w.workflow_run_id===episode);if(worker){await goto('work',{selected:episode,episode,agent:worker.id});await page.getByLabel('Exact Agent output and execution receipts',{exact:true}).waitFor();await page.reload();await page.getByLabel('Exact Agent output and execution receipts',{exact:true}).waitFor();}
  const artifact=boundary.state().db.artifacts.find(a=>a.workflow_run_id===episode&&a.business_id===business&&a.artifact_type==='product.package.v1');
  await goto('work',{selected:episode,episode,artifact:artifact.id});await page.getByLabel('Exact selected artifact content',{exact:true}).waitFor();
  await page.locator('.consoleNavigation').getByRole('link',{name:'Library',exact:true}).click();await page.waitForURL(u=>u.searchParams.get('view')==='library');assert.equal(new URL(page.url()).searchParams.get('quest'),quest);assert.equal(new URL(page.url()).searchParams.get('sourceArtifact'),artifact.id);
  await page.goBack();await page.getByLabel('Exact selected artifact content',{exact:true}).waitFor();
 });
 await check('R08 Research and Library are Quest-scoped before counts; exact old selections and pages remain',async()=>{
  await goto('research');await page.getByRole('heading',{name:'Research',exact:true}).waitFor();
  const researchCalls=boundary.log.filter(c=>c.table==='r08_product_experiments');assert.ok(researchCalls.some(c=>c.operations.some(([op,k,v])=>op==='eq'&&k==='quest_id'&&v===quest)));
  const record=boundary.state().db.product_experiments.find(e=>e.business_id===business);await goto('research',{selected:record.id});await page.locator('body').waitFor();assert.doesNotMatch(await page.locator('body').innerText(),/Application error|This exact record could not be verified/);
  await goto('library',{type:'records',selected:id(880000)});await page.getByText('Exact original artifact',{exact:false}).waitFor({timeout:1000}).catch(()=>{});assert.match(await page.locator('body').innerText(),/Saved package 0/);
  const calls=boundary.log.filter(c=>c.table==='r08_artifacts');assert.ok(calls.some(c=>c.operations.some(([op,k,v])=>op==='eq'&&k==='quest_id'&&v===quest)));
  await page.reload();assert.match(await page.locator('body').innerText(),/Saved package 0/);
 });
 await check('R08 Product Package → same linked Listing → exact Library artifact preserves unqualified readiness',async()=>{
  await goto('products-catalog',{selected:id(880000)});await page.getByRole('heading',{name:'Readiness blockers',exact:true}).waitFor();assert.match(await page.locator('.r08Workspace').innerText(),/0–|1–25 of 127/);
  await page.getByRole('link',{name:new RegExp('Saved draft '+id(885000))}).click();await page.waitForURL(u=>u.searchParams.get('type')==='listings');assert.equal(new URL(page.url()).searchParams.get('selected'),id(885000));
  const detail=await page.getByLabel('Exact selected record',{exact:true}).innerText();assert.match(detail,/verified draft/);assert.match(detail,/unqualified/);assert.match(detail,/No matching supplier resource/);assert.doesNotMatch(detail,/sale-ready|Selling ready/);
  await page.getByRole('link',{name:'Exact source Product Package',exact:true}).click();await page.waitForURL(u=>u.searchParams.get('selected')===id(880000));
  await page.getByRole('link',{name:'Exact package artifact',exact:true}).click();await page.waitForURL(u=>u.searchParams.get('view')==='library');assert.equal(new URL(page.url()).searchParams.get('quest'),quest);await page.goBack();await page.waitForURL(u=>u.searchParams.get('view')==='products-catalog');
 });
 await check('R08 searchable automated decisions and controller-only owner exception stay distinct',async()=>{
  await goto('decision-log',{selected:'admission:1',q:'does not match',page:'6'});await page.getByLabel('Exact selected record',{exact:true}).waitFor();assert.match(await page.locator('.r08Workspace').innerText(),/Blocked original dispatch/);assert.match(await page.locator('.r08Pager').innerText(),/of 0/);
  await page.getByRole('link',{name:'All Business records',exact:true}).click();await page.waitForURL(u=>!u.searchParams.has('quest'));assert.match(await page.locator('.r08Workspace').innerText(),/Business records without a selected Quest/);
  await page.locator('input[name=q]').fill('Unlinked Business admission');await page.getByRole('button',{name:'Search',exact:true}).click();
  await page.waitForURL(u=>u.searchParams.get('q')==='Unlinked Business admission');await page.getByRole('link',{name:'Unlinked Business admission',exact:true}).waitFor();await page.locator('.r08Pager').filter({hasText:'of 1 ·'}).waitFor();
  const businessDecisionTotal=boundary.state().workspace.records.decisions.filter(record=>record.businessId===business).length;
  await page.goBack();await page.waitForURL(u=>!u.searchParams.has('quest')&&!u.searchParams.has('q'));await page.locator('.r08Pager').filter({hasText:`of ${businessDecisionTotal} ·`}).waitFor();
  await page.goBack();await page.waitForURL(u=>u.searchParams.get('quest')===quest&&u.searchParams.get('q')==='does not match');await page.getByLabel('Exact selected record',{exact:true}).waitFor();
  await page.getByRole('link',{name:'Needs owner queue',exact:true}).click();await page.waitForURL(u=>u.searchParams.get('view')==='decisions');await page.locator(`[data-controller-exception="${quest}"]`).waitFor();assert.match(await page.locator(`[data-controller-exception="${quest}"]`).innerText(),/New account scope requires confirmation/);
  assert.equal(new URL(page.url()).searchParams.get('quest'),quest);
 });
 await check('R08 cross-Business/Quest exact selections and unavailable reads fail closed',async()=>{
  await goto('products-catalog',{selected:id(881000)});assert.match(await page.locator('.r08Workspace').innerText(),/not in this Business\/Quest/);assert.doesNotMatch(await page.getByLabel('Exact selected record').innerText(),/Saved package/);
  const response=await goto('overview',{quest:id(821000)});assert.ok([200,404].includes(response.status()));assert.match(await page.locator('body').innerText(),/unavailable|not found/i);
  await control({failDataset:'products'});await goto('products-catalog');assert.match(await page.locator('.r08Workspace').innerText(),/read is unavailable or incomplete/);assert.match(await page.locator('.r08Pager').innerText(),/Count unavailable/);await control({failDataset:null});
 });
 const scenes=[['r08-overview',route('overview')],['r08-products',route('products-catalog',{selected:id(880000)})],['r08-listings',route('products-catalog',{type:'listings',selected:id(885000)})],['r08-decisions',route('decision-log',{selected:'admission:1'})],['r08-knowledge',route('knowledge',{selected:id(790000)})],['r08-needs-owner',route('decisions')]];
 for(const [name,url]of scenes)await check(`${name} populated desktop/mobile/zoom-equivalent layout`,async()=>{
  for(const [width,height]of [[1280,720],[1440,900],[390,844],[320,800],[640,360]]){
   await page.setViewportSize({width,height});await page.goto(origin+url);await page.locator('h1').waitFor();assert.equal(await page.getByText('Application error',{exact:false}).count(),0);
   if(name==='r08-knowledge')assert.match(await page.locator('.r08Workspace').innerText(),/Existing packs only/);
   const metrics=await page.evaluate(()=>({w:document.documentElement.scrollWidth,h:document.documentElement.scrollHeight}));assert.ok(metrics.w<=width+1,`${name} horizontal ${JSON.stringify(metrics)}`);if(width>=1280)assert.ok(metrics.h<=height+1,`${name} vertical ${JSON.stringify(metrics)}`);
   await page.screenshot({path:path.join(output,`${name}-${width}x${height}.png`),fullPage:true});
  }
 });
 await check('R08 actual 200 percent browser zoom preserves every new destination',async()=>{
  const zoom=await actualZoomBrowser();try{await zoom.context.route("**/*",route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());const p=await zoom.context.newPage();for(const [name,url]of scenes){await p.goto(origin+url);assert.equal(await zoom.set(p,2),2);await p.locator('h1').waitFor();const m=await p.evaluate(()=>({w:document.documentElement.scrollWidth,innerWidth}));assert.ok(m.w<=m.innerWidth+1);await p.screenshot({path:path.join(output,`${name}-zoom200.png`),fullPage:true});}}finally{await zoom.close();}
 });
 assert.equal(boundary.effects.length,before,'R08 browsing created no effects');assert.equal(actions.length,actionCount,'R08 browsing invoked no server actions');assert.ok(requests.length>0,'Real Next requests observed');
 await page.setViewportSize({width:1280,height:720});
}
