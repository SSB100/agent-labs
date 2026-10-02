import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { collectionClientState, collectionDocument, createCollectionBrowserFixture, origin } from './helpers/console-collection-browser.mjs';
import { artifactHash, businessId, exactArtifactId, oldEventId, oldRunId, owner, secondBusinessId, selectedActivityRoute, selectedArtifactRoute, selectedWorkRoute } from './helpers/console-collection-root.mjs';

test('Work actual-root document bundles the complete production shell and exact detail without provider or action transport',async()=>{
  const fixture=createCollectionBrowserFixture(),html=await collectionDocument(selectedArtifactRoute,{fixture});
  assert.deepEqual(fixture.loaderCalls.map(call=>call.name),['loadConsoleWorkPage','loadConsoleWorkDetail','loadRunCostData']);
  assert.match(html,/<div id="collection-root-island" style="display:contents"><!--\$-->/);assert.match(html,/hydrateRoot/);assert.match(html,/__loadCollectionRootFixture/);assert.match(html,/consoleCollectionToolbar/);
  assert.match(html,/1–25 of (?:<!-- -->)?127 runs/);assert.match(html,/100 loaded/);assert.match(html,/Exact selected artifact/);
  assert.doesNotMatch(html,/PRIVATE_ARTIFACT_PAYLOAD_|PRIVATE_STAGE_PAYLOAD|service_role|OPENROUTER_API_KEY/);assert.deepEqual(fixture.denied,[]);
});

test('Activity retained state is actual root output, independently counted and precisely scoped',async()=>{
  const fixture=createCollectionBrowserFixture(),state=await collectionClientState(`${selectedActivityRoute}&q=unmatched&page=2`,fixture);
  assert.equal(state.pane.data.page.total,0);assert.equal(state.pane.data.selection.item.id,oldEventId);assert.equal(state.command.businessId,businessId);assert.equal(state.detail,null);
  assert.deepEqual(fixture.loaderCalls.map(call=>call.name),['loadConsoleActivityPage']);assert.deepEqual(fixture.denied,[]);
});

const viewports=[{width:1280,height:720,slug:'1280'},{width:1440,height:900,slug:'1440'},{width:1000,height:760,slug:'1000-single'},{width:640,height:450,slug:'640-zoom'},{width:390,height:844,slug:'390'},{width:320,height:640,slug:'320'}];
const enabled=process.env.CI==='true'&&process.env.GUIDED_UI_BROWSER==='1';
async function ready(page){await page.waitForFunction(()=>window.__collectionHydrated===true&&!window.__collectionReadPending&&window.__collectionCommittedRoute===location.pathname+location.search+location.hash);assert.deepEqual(await page.evaluate(()=>window.__collectionErrors),[]);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
async function bounds(page,width,height){
  const result=await page.evaluate(()=>{const rect=node=>node?.getBoundingClientRect().toJSON();const toolbar=document.querySelector('.consoleCollectionToolbar');return {width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,toolbar:rect(toolbar),controls:[...toolbar.querySelectorAll('input:not([type=hidden]),select,button')].map(node=>({rect:rect(node),font:parseFloat(getComputedStyle(node).fontSize)})),footer:rect(document.querySelector('.consoleCollectionPagination')),body:rect(document.querySelector('.consoleCollectionBody'))};});
  const detail=JSON.stringify(result);assert.ok(result.width<=width+1,detail);if(width>900){assert.ok(result.height<=height+1,detail);assert.ok(result.footer.bottom<=height+1,detail);}
  for(const control of result.controls){assert.ok(control.rect.width>0&&control.rect.left>=-1&&control.rect.right<=width+1,detail);assert.ok(control.font>=12,detail);}
  for(let i=0;i<result.controls.length;i++)for(let j=i+1;j<result.controls.length;j++){const a=result.controls[i].rect,b=result.controls[j].rect;assert.ok(Math.min(a.right,b.right)-Math.max(a.left,b.left)<=1||Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)<=1,detail);}
}
async function focusVisible(page,selector,expectFocus=false){
  const result=await page.locator(selector).evaluate(node=>{const rect=node.getBoundingClientRect(),x=rect.left+Math.min(30,rect.width/2),y=rect.top+Math.min(8,rect.height/2),hit=document.elementFromPoint(x,y);return {rect:rect.toJSON(),width:innerWidth,height:innerHeight,focused:document.activeElement===node,hit:node===hit||node.contains(hit),scroll:document.scrollingElement.scrollTop};});
  assert.ok(result.rect.top>=-1&&result.rect.bottom<=result.height+1,JSON.stringify(result));assert.ok(result.hit,JSON.stringify(result));if(expectFocus)assert.equal(result.focused,true,JSON.stringify(result));if(result.width>900)assert.equal(result.scroll,0,JSON.stringify(result));
}
async function compactLongNames(page,width,kind){
 if(width<1200)return;
 const geometry=await page.evaluate(()=>{
  const rect=node=>node.getBoundingClientRect().toJSON(),rows=[...document.querySelectorAll('.consoleCollectionRow')];
  return {body:rect(document.querySelector('.consoleCollectionBody')),rows:rows.slice(0,2).map(node=>({row:rect(node),title:rect(node.querySelector('.consoleCollectionRowTitle')),business:rect(node.querySelector('.consoleCollectionBusiness'))})),heading:rect(document.querySelector('.consoleWorkDetail h3'))};
 });
 const evidence=JSON.stringify(geometry);
 for(const row of geometry.rows){assert.ok(row.row.height<=180,`Long ${kind} names expanded a row: ${evidence}`);assert.ok(row.title.height<=42,evidence);assert.ok(row.business.height<=20,evidence);}
 assert.ok(geometry.rows[1].row.top<geometry.body.bottom-80,`A second ${kind} row is not usable: ${evidence}`);
 assert.ok(geometry.heading.height<=46,`Selected long title hides key state: ${evidence}`);
 if(kind==='work'){
  await focusVisible(page,'.consoleWorkCost strong');
  await focusVisible(page,'.consoleWorkCost>p:first-of-type');
  assert.match(await page.getByRole('region',{name:'Recorded provider charges',exact:true}).innerText(),/unknown charge/);
 }
}
async function capture(page,directory,name){await page.screenshot({path:path.join(directory,`${name}-viewport.png`),fullPage:false});await page.screenshot({path:path.join(directory,`${name}.png`),fullPage:true});}
async function setup(browser,viewport,{retained=true}={}){
  const context=await browser.newContext({viewport,reducedMotion:'reduce',serviceWorkers:'block'}),fixture=createCollectionBrowserFixture(),denied=[],errors=[];
  await context.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());if(url.origin===origin&&url.pathname==='/dashboard'&&request.method()==='GET'&&request.resourceType()==='document'&&['work','activity'].includes(url.searchParams.get('view')))return route.fulfill({contentType:'text/html',body:await collectionDocument(url.pathname+url.search+url.hash,{fixture,retained})});denied.push(`${request.method()} ${request.url()}`);return route.abort();});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));let hold=null;
  await page.exposeFunction('__loadCollectionRootFixture',async route=>{if(hold&&hold.match(route)){const wait=hold;hold=null;await new Promise(resolve=>{wait.release=resolve;});}return collectionClientState(route,fixture);});
  return {page,context,fixture,denied,errors,holdRead(match){const wait={match,release:null};hold=wait;return wait;}};
}

// Hosted only: no executablePath or local Chromium fallback is permitted.
// These exercise native DOM and retained React state, not Next's real RSC/cache/action queue.
test('hosted actual-root Work/Activity compact geometry, exact artifact hash, filters, selection and retained navigation',{skip:!enabled,timeout:240000},async t=>{
 const browser=await chromium.launch({headless:true}),directory=path.resolve('test-results/guided-ui');mkdirSync(directory,{recursive:true});
 try{for(const viewport of viewports)await t.test(viewport.slug,async()=>{
  const h=await setup(browser,viewport),{page,fixture}=h;try{
   await page.goto(origin+selectedWorkRoute);await ready(page);await bounds(page,viewport.width,viewport.height);await focusVisible(page,'.consoleCollectionDetail>header h2');
   assert.equal(await page.locator('.consoleCollectionList [data-record-id]').count(),25);assert.equal(await page.locator('[data-work-detail]').getAttribute('data-work-detail'),oldRunId);
   await compactLongNames(page,viewport.width,'work');await capture(page,directory,`console-r02-work-selected-${viewport.slug}`);
   // Exact selected identity remains independent of a new server filter and page.
   await page.locator('[name=status]').selectOption('completed');await page.locator('.consoleCollectionToolbar button[type=submit]').click();await ready(page);
   assert.equal(new URL(page.url()).searchParams.get('status'),'completed');assert.equal(await page.locator('[data-work-detail]').getAttribute('data-work-detail'),oldRunId);
   await page.goBack();await ready(page);assert.equal(await page.locator('[name=status]').inputValue(),'all');
   await page.goForward();await ready(page);assert.equal(await page.locator('[name=status]').inputValue(),'completed');
   await page.getByRole('link',{name:'Close detail',exact:true}).click();await ready(page);assert.equal(await page.locator('.consoleCollectionDetail').count(),0);
   const row=page.locator('.consoleCollectionList [data-record-id] a').first();await row.focus();await page.keyboard.press('Enter');await ready(page);assert.equal(await page.locator('.consoleCollectionDetail').count(),1);
   await page.reload();await ready(page);await bounds(page,viewport.width,viewport.height);
   await page.evaluate(route=>window.__collectionNavigate(route),selectedArtifactRoute);await ready(page);
   const payload=await page.getByRole('textbox',{name:'Exact selected artifact content'}).count();assert.equal(payload,0); // pre remains a keyboard-scrollable saved record, not an editable field
   const content=await page.locator('[aria-label="Exact selected artifact content"]').textContent();assert.equal(createHash('sha256').update(content).digest('hex'),artifactHash);
   await focusVisible(page,`#artifact-${exactArtifactId}>summary`,true);await bounds(page,viewport.width,viewport.height);await capture(page,directory,`console-r02-work-exact-artifact-${viewport.slug}`);
   await page.reload();await ready(page);assert.equal(createHash('sha256').update(await page.locator('[aria-label="Exact selected artifact content"]').textContent()).digest('hex'),artifactHash);
   await page.evaluate(route=>window.__collectionNavigate(route),selectedActivityRoute);await ready(page);await bounds(page,viewport.width,viewport.height);await focusVisible(page,'.consoleCollectionDetail>header h2');
   assert.match(await page.locator('.consoleCollectionHeader').innerText(),/Underlying audit events/);assert.equal(await page.locator('.consoleCollectionList [data-record-id]').count(),25);await compactLongNames(page,viewport.width,'activity');await capture(page,directory,`console-r02-activity-selected-${viewport.slug}`);
   await page.getByRole('link',{name:'Next',exact:true}).click();await ready(page);assert.equal(new URL(page.url()).searchParams.get('page'),'2');assert.equal(new URL(page.url()).searchParams.get('selected'),oldEventId);
   await page.goBack();await ready(page);await page.goForward();await ready(page);await page.reload();await ready(page);
   assert.deepEqual(h.denied,[]);assert.deepEqual(h.errors,[]);assert.deepEqual(fixture.denied,[]);assert.equal(await page.evaluate(()=>window.__collectionPaidCalls),0);
  }catch(error){await capture(page,directory,`console-r02-failure-${viewport.slug}`).catch(()=>{});throw error;}finally{await h.context.close();}
 });}finally{await browser.close();}
});

test('hosted native GET Back restores controls to URL and results rather than the edited former form',{skip:!enabled,timeout:90000},async()=>{
 const browser=await chromium.launch({headless:true}),h=await setup(browser,{width:1280,height:720},{retained:false}),{page}=h;
 try{await page.goto(origin+selectedWorkRoute);await ready(page);await page.locator('[name=status]').selectOption('completed');await page.locator('[name=sort]').selectOption('oldest');await page.locator('[name=q]').fill('Duplicate');
  await Promise.all([page.waitForURL(url=>url.searchParams.get('status')==='completed'),page.locator('.consoleCollectionToolbar button[type=submit]').click()]);await ready(page);
  await page.goBack();await ready(page);assert.equal(new URL(page.url()).searchParams.has('status'),false);assert.equal(await page.locator('[name=status]').inputValue(),'all');assert.equal(await page.locator('[name=sort]').inputValue(),'newest');assert.equal(await page.locator('[name=q]').inputValue(),'');
  assert.match(await page.locator('.consoleCollectionCount').innerText(),/127 runs/);assert.equal(await page.locator('[data-work-detail]').getAttribute('data-work-detail'),oldRunId);
  await page.goForward();await ready(page);assert.equal(await page.locator('[name=status]').inputValue(),'completed');assert.equal(await page.locator('[name=sort]').inputValue(),'oldest');assert.equal(await page.locator('[name=q]').inputValue(),'Duplicate');assert.deepEqual(h.denied,[]);assert.deepEqual(h.errors,[]);
 }finally{await h.context.close();await browser.close();}
});

test('hosted retained delayed reads retain native modal barrier, saved draft fields and newest navigation',{skip:!enabled,timeout:120000},async()=>{
 const browser=await chromium.launch({headless:true}),h=await setup(browser,{width:1280,height:720}),{page}=h;
 try{
  await page.goto(origin+'/dashboard?view=work');await ready(page);
  const draft={version:1,ownerId:owner,draft:{businessId:secondBusinessId,goal:'Compare original nature T-shirt markets and preserve my saved goal',audienceHint:'Adult woodland enthusiasts',maximumCollections:'2',maximumUsd:'0.80'},step:0,reviewedEstimate:null};
  await page.evaluate(({owner,draft})=>sessionStorage.setItem(`agentlabs:research-draft:v1:${owner}`,JSON.stringify(draft)),{owner,draft});
  assert.equal(await page.locator('#console-command-input').inputValue(),'');await page.getByRole('button',{name:/Choose Business/}).click();await ready(page);
  await page.locator('dialog:modal').waitFor();await page.waitForFunction(()=>document.querySelector('[name=goal]')?.value.includes('preserve my saved goal'));
  assert.equal(await page.locator('dialog [name=businessId]').inputValue(),secondBusinessId);assert.equal(await page.locator('dialog [name=audienceHint]').inputValue(),draft.draft.audienceHint);
  assert.deepEqual(await page.evaluate(owner=>JSON.parse(sessionStorage.getItem(`agentlabs:research-draft:v1:${owner}`)).draft,owner),draft.draft);
  const wait=h.holdRead(route=>!new URL(route,origin).searchParams.has('sheet'));await page.getByRole('button',{name:'Close research setup'}).click();await page.waitForFunction(()=>window.__collectionReadPending===true);
  assert.equal(await page.locator('dialog:modal').count(),1);assert.equal(await page.locator('.consoleResearchBody').getAttribute('inert'),'');
  // Modal top layer keeps outside controls unreachable during a retained read.
  await page.locator('#console-command-input').evaluate(node=>node.focus());assert.equal(await page.locator('#console-command-input').evaluate(node=>document.activeElement===node),false);
  while(!wait.release)await new Promise(resolve=>setTimeout(resolve,5));wait.release();await ready(page);assert.equal(await page.locator('dialog:modal').count(),0);
  await page.getByRole('button',{name:/Choose Business/}).click();await ready(page);await page.waitForFunction(()=>document.querySelector('[name=goal]')?.value.includes('preserve my saved goal'));
  assert.equal(await page.locator('dialog [name=audienceHint]').inputValue(),draft.draft.audienceHint);await page.getByRole('button',{name:'Close research setup'}).click();await ready(page);
  const first=h.holdRead(route=>route.includes('page=2'));await page.evaluate(()=>{window.__collectionNavigate('/dashboard?view=work&page=2');});await page.waitForFunction(()=>window.__collectionReadPending);
  await page.evaluate(route=>window.__collectionNavigate(route),selectedActivityRoute);await ready(page);while(!first.release)await new Promise(resolve=>setTimeout(resolve,5));first.release();await page.waitForFunction(()=>window.__collectionDiscarded===1);
  assert.equal(new URL(page.url()).searchParams.get('view'),'activity');assert.equal(await page.locator('.consoleCollectionPane').getAttribute('data-collection'),'activity');
  assert.deepEqual(h.denied,[]);assert.deepEqual(h.errors,[]);assert.equal(await page.evaluate(()=>window.__collectionPaidCalls),0);
 }finally{await h.context.close();await browser.close();}
});

test('hosted no-hash selected links reveal detail and preserve exact expanded reading positions through Back and reload',{skip:!enabled,timeout:120000},async t=>{
 const browser=await chromium.launch({headless:true});
 try{for(const viewport of [{width:390,height:844},{width:640,height:450},{width:1000,height:760},{width:1280,height:720}])await t.test(`${viewport.width}px`,async()=>{
  const h=await setup(browser,viewport),{page}=h;try{
   await page.goto(origin+`/dashboard?view=work&selected=${oldRunId}`);await ready(page);await focusVisible(page,'.consoleCollectionDetail>header h2');
   assert.match(await page.locator('.consoleWorkspaceContext').innerText(),/All owned Businesses/);assert.equal(await page.locator('.consoleCollectionToolbar [name=business]').inputValue(),'');
   for(const view of ['library','connections'])assert.ok(await page.locator(`.consoleNavigation a[href*="view=${view}"]`).getAttribute('href').then(href=>href.includes('business='+businessId)));
   const disclosure=page.locator('.consoleWorkSection').filter({has:page.locator('summary').filter({hasText:'Saved output metadata'})});
   await disclosure.locator('summary').click();
   const before=await page.evaluate(()=>{const detail=document.querySelector('.consoleCollectionDetail'),body=document.querySelector('.consoleCollectionBody');if(innerWidth>=1200){detail.scrollTop=1800;return {kind:'detail',position:detail.scrollTop};}if(innerWidth>900){body.scrollTop=body.scrollHeight-500;return {kind:'body',position:body.scrollTop};}window.scrollTo(0,document.querySelector('.consoleCollectionDetail').getBoundingClientRect().top+scrollY+900);return {kind:'document',position:scrollY};});
   assert.ok(before.position>100);await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,160)));
   await page.evaluate(()=>window.__collectionNavigate(location.pathname+location.search+'&page=2'));await ready(page);await page.goBack();await ready(page);
   assert.equal(await disclosure.getAttribute('open'),'');
   const position=()=>page.evaluate(kind=>kind==='detail'?document.querySelector('.consoleCollectionDetail').scrollTop:kind==='body'?document.querySelector('.consoleCollectionBody').scrollTop:scrollY,before.kind);
   assert.ok(Math.abs(await position()-before.position)<4,`Back lost ${before.kind} position`);
   await page.reload();await ready(page);assert.equal(await disclosure.getAttribute('open'),'');assert.ok(Math.abs(await position()-before.position)<4,`Reload lost ${before.kind} position`);
   assert.deepEqual(h.denied,[]);assert.deepEqual(h.errors,[]);
  }finally{await h.context.close();}
 });}finally{await browser.close();}
});
