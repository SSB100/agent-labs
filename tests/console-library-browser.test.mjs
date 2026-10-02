import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { createLibraryBrowserFixture, libraryClientState, libraryDocument, origin } from './helpers/console-library-browser.mjs';
import { businessId, secondBusinessId, owner, exactContentHash, exactRecordId, exactWorkHref, id, noAssetRunId, oldAssetId, selectedDesignRoute, selectedRecordRoute, selectedRunRoute } from './helpers/console-library-root.mjs';

for(const [kind,route]of [['designs',selectedDesignRoute],['records',selectedRecordRoute],['no-asset',selectedRunRoute]])test(`synthetic actual-root Library ${kind} document bundles production shell/pane with no provider transport`,async()=>{
  const fixture=createLibraryBrowserFixture(),html=await libraryDocument(route,{fixture});
  assert.deepEqual(fixture.loaderCalls.map(call=>call.name),[kind==='records'?'loadConsoleLibraryRecordsPage':'loadConsoleLibraryPage']);assert.match(html,/<div id="library-root-island" style="display:contents"><!--\$-->/);assert.match(html,/hydrateRoot/);assert.match(html,/__loadLibraryRootFixture/);assert.match(html,/consoleLibraryToolbar/);assert.match(html,/SYNTHETIC actual-root read-only Library fixture/);
  assert.doesNotMatch(html,/service_role|OPENROUTER_API_KEY|NEXT_PUBLIC_SUPABASE|https:\/\/[^"\s]+supabase/);assert.equal(fixture.ancillaryCalls.length,0);assert.deepEqual(fixture.denied,[]);
});

test('synthetic expired-preview document can delay hydration without changing preview destinations',async()=>{
 const fixture=createLibraryBrowserFixture(),html=await libraryDocument(selectedDesignRoute,{fixture,deferHydration:true});
 assert.match(html,/window\.__libraryHydrationDeferred=true;window\.__libraryStartHydration=\(\)=>/);assert.match(html,/Synthetic hydration already started/);assert.match(html,/class="consoleLibraryPreview consoleLibraryPreviewLarge"/);assert.match(html,/https:\/\/storage\.fixture\/proxy\/storage\/v1\/object\/sign\/creative-assets\//);assert.deepEqual(fixture.denied,[]);assert.equal(fixture.ancillaryCalls.length,0);
});

test('retained Library fixture state is actual-root-derived, exact selected identity preserves aggregate list and scopes command',async()=>{
  const fixture=createLibraryBrowserFixture(),state=await libraryClientState(`/dashboard?view=library&type=designs&selected=${id(11000)}&page=2`,fixture);
  assert.equal(state.pane.data.page.total,254);assert.equal(state.pane.data.selection.item.id,id(11000));assert.equal(state.pane.searchParams.business,undefined);assert.equal(state.command.businessId,secondBusinessId);assert.equal(state.shell.navigationBusinessId,secondBusinessId);assert.equal(state.shell.context.supabase,undefined);assert.equal(state.sheet,null);assert.deepEqual(fixture.denied,[]);
});

const viewports=[{width:1280,height:720,slug:'1280'},{width:1440,height:900,slug:'1440'},{width:1000,height:760,slug:'1000-single'},{width:640,height:450,slug:'640-zoom'},{width:390,height:844,slug:'390'},{width:320,height:640,slug:'320'}];
const enabled=process.env.CI==='true'&&process.env.GUIDED_UI_BROWSER==='1';
const directory=path.resolve('test-results/guided-ui');
// Deterministic local512×512 PNG for fit inspection. This synthetic graphic is not
// saved provider artwork and its visual bytes do not assert any qualification or receipt.
const syntheticPng=await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
 <rect width="512" height="512" fill="#eef0da"/><path d="M0 0h256v256H0zm256 256h256v256H256z" fill="#dce5cf"/>
 <circle cx="392" cy="118" r="58" fill="#edba5c"/><path d="M26 370 178 168l140 202zm178 0L344 194l142 176z" fill="#9eafa2"/>
 <path d="m139 129-87 168h43l-65 111h219l-68-111h43zm209 61-73 147h37l-57 86h187l-58-86h37z" fill="#244b47"/>
 <path d="M124 345h30v99h-30zm210 36h26v71h-26z" fill="#82694e"/>
 <rect x="12" y="12" width="488" height="488" rx="12" fill="none" stroke="#244b47" stroke-width="6"/>
 <path d="M29 44h52M55 18v52M431 44h52M457 18v52M29 468h52M55 442v52M431 468h52M457 442v52" stroke="#517e7a" stroke-width="3"/>
 <rect x="50" y="50" width="412" height="49" rx="8" fill="#173b3a"/>
 <text x="256" y="82" text-anchor="middle" font-family="sans-serif" font-size="24" font-weight="700" fill="#fffdf0">SYNTHETIC TEST ARTWORK</text>
 <rect x="96" y="450" width="320" height="32" rx="6" fill="#173b3a"/><text x="256" y="472" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#fffdf0">512 × 512 · LOCAL FIXTURE</text>
</svg>`)).png().toBuffer();
test('synthetic route-intercepted preview is a deterministic local512px PNG',async()=>{
 const metadata=await sharp(syntheticPng).metadata();assert.equal(metadata.format,'png');assert.equal(metadata.width,512);assert.equal(metadata.height,512);assert.ok(syntheticPng.length>1000);
});
async function ready(page){await page.waitForFunction(()=>window.__libraryHydrated===true&&!window.__libraryReadPending&&window.__libraryCommittedRoute===location.pathname+location.search+location.hash);assert.deepEqual(await page.evaluate(()=>window.__libraryErrors),[]);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
async function bounds(page,width,height){
 const result=await page.evaluate(()=>{const rect=node=>node?.getBoundingClientRect().toJSON(),toolbar=document.querySelector('.consoleLibraryToolbar');return {width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,toolbar:rect(toolbar),controls:[...toolbar.querySelectorAll('input:not([type=hidden]),select,button')].map(node=>({rect:rect(node),font:parseFloat(getComputedStyle(node).fontSize)})),footer:rect(document.querySelector('.consoleCollectionPagination')),body:rect(document.querySelector('.consoleCollectionBody')),command:rect(document.querySelector('.consoleCommandDock'))};});
 const detail=JSON.stringify(result);assert.ok(result.width<=width+1,detail);if(width>900){assert.ok(result.height<=height+1,detail);assert.ok(result.footer.bottom<=height+1,detail);assert.ok(result.footer.height>=33,detail);}
 for(const control of result.controls){assert.ok(control.rect.width>0&&control.rect.height>=(width>900?33:43)&&control.rect.left>=-1&&control.rect.right<=width+1,detail);assert.ok(control.font>=12,detail);}
 for(let i=0;i<result.controls.length;i++)for(let j=i+1;j<result.controls.length;j++){const a=result.controls[i].rect,b=result.controls[j].rect;assert.ok(Math.min(a.right,b.right)-Math.max(a.left,b.left)<=1||Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)<=1,detail);}
}
async function visible(page,selector,{focus=false,scroll=false,startOnly=false}={}){
 const locator=page.locator(selector).first();if(scroll)await locator.scrollIntoViewIfNeeded();if(focus)await locator.focus();
 const result=await locator.evaluate((node,startOnly)=>{const rect=node.getBoundingClientRect(),x=rect.left+Math.min(15,rect.width/2),top=rect.top+Math.min(8,rect.height/2),bottom=startOnly?Math.min(rect.bottom-4,rect.top+48):rect.bottom-4,hits=[document.elementFromPoint(x,top),document.elementFromPoint(x,bottom)];return {rect:{...rect.toJSON(),bottom:startOnly?Math.min(rect.bottom,rect.top+52):rect.bottom},width:innerWidth,height:innerHeight,focused:document.activeElement===node,hit:hits.every(hit=>node===hit||node.contains(hit)),scroll:document.scrollingElement.scrollTop};},startOnly);
 assert.ok(result.rect.top>=-1&&result.rect.bottom<=result.height+1,JSON.stringify(result));assert.ok(result.rect.left>=-1&&result.rect.right<=result.width+1,JSON.stringify(result));assert.ok(result.hit,JSON.stringify(result));if(focus)assert.equal(result.focused,true,JSON.stringify(result));if(result.width>900)assert.equal(result.scroll,0,JSON.stringify(result));
}
async function compact(page,width,kind){
 if(width<1200)return;
 const geometry=await page.evaluate(()=>{const rect=node=>node.getBoundingClientRect().toJSON(),rows=[...document.querySelectorAll('.consoleLibraryRow')];return {body:rect(document.querySelector('.consoleLibraryBody')),rows:rows.slice(0,2).map(node=>({row:rect(node),title:rect(node.querySelector('.consoleLibraryTitle')),business:rect(node.querySelector('.consoleLibraryBusiness'))})),heading:rect(document.querySelector('.consoleLibraryDetailTitle')??document.querySelector('.consoleLibraryRunHeadline'))};});
 const evidence=JSON.stringify(geometry);for(const row of geometry.rows){assert.ok(row.row.height<=230,`Long ${kind} metadata expanded the row: ${evidence}`);assert.ok(row.title.height<=46,evidence);assert.ok(row.business.height<=20,evidence);}assert.ok(geometry.rows[1].row.top<geometry.body.bottom-60,`A second ${kind} row is not usable: ${evidence}`);assert.ok(geometry.heading.height<=48,evidence);
 if(kind==='designs'){await visible(page,'.consoleLibraryDesignSummary');assert.match(await page.locator('.consoleLibraryBoundaries').innerText(),/Visual review unavailable/);assert.match(await page.locator('.consoleLibraryBoundaries').innerText(),/Market ProductTEST/);assert.match(await page.locator('.consoleLibraryBoundaries').innerText(),/not established here/i);}
 if(kind==='records')await visible(page,'[aria-label="Exact selected artifact content JSON"]',{startOnly:true});
 if(kind==='no-asset'){await visible(page,'.consoleLibraryRunHeadline');await visible(page,'.consoleLibraryCharge');await visible(page,'.consoleLibraryCosts>.consoleLibraryWarning');}
}
async function capture(page,name){mkdirSync(directory,{recursive:true});await page.screenshot({path:path.join(directory,`${name}-viewport.png`),fullPage:false});await page.screenshot({path:path.join(directory,`${name}.png`),fullPage:true});}
async function setup(browser,viewport,{retained=true,fixtureOptions={},imageFailure=false,deferHydration=false}={}){
 let failImages=imageFailure;
 const context=await browser.newContext({viewport,reducedMotion:'reduce',serviceWorkers:'block'}),fixture=createLibraryBrowserFixture(fixtureOptions),denied=[],errors=[],previews=[];
 await context.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());
  if(url.origin===origin&&url.pathname==='/dashboard'&&request.method()==='GET'&&request.resourceType()==='document'&&url.searchParams.get('view')==='library'&&url.searchParams.get('type')!=='research')return route.fulfill({contentType:'text/html',body:await libraryDocument(url.pathname+url.search+url.hash,{fixture,retained,deferHydration})});
  const prefix='/proxy/storage/v1/object/sign/creative-assets/',storagePath=url.pathname.startsWith(prefix)?url.pathname.slice(prefix.length):null;
  if(url.origin==='https://storage.fixture'&&request.method()==='GET'&&request.resourceType()==='image'&&url.searchParams.get('token')==='fixture'&&[...url.searchParams].length===1&&fixture.signs.flat().includes(storagePath)){previews.push(storagePath);return failImages?route.fulfill({status:403,contentType:'text/plain',headers:{'cache-control':'no-store'},body:'Synthetic expired preview'}):route.fulfill({contentType:'image/png',headers:{'cache-control':'no-store'},body:syntheticPng});}
  denied.push(`${request.method()} ${request.url()}`);return route.abort();
 });
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));let hold=null;
 await page.exposeFunction('__loadLibraryRootFixture',async route=>{if(hold&&hold.match(route)){const wait=hold;hold=null;await new Promise(resolve=>{wait.release=resolve;});}return libraryClientState(route,fixture);});
 return {page,context,fixture,denied,errors,previews,setImageFailure(value){failImages=value;},holdRead(match){const wait={match,release:null};hold=wait;return wait;}};
}
function clean(h){assert.deepEqual(h.denied,[]);assert.deepEqual(h.errors,[]);assert.deepEqual(h.fixture.denied,[]);}
async function paidCalls(page){assert.equal(await page.evaluate(()=>window.__libraryPaidCalls),0);}

// Hosted only. No executablePath or local Chromium fallback. R03: the retained transport
// is intentionally synthetic and does not qualify real Next RSC/cache/server-action ordering.
test('hosted synthetic Library actual-root compact viewport journeys, filters, exact identity, Close, Back/Forward and reload',{skip:!enabled,timeout:300000},async t=>{
 const browser=await chromium.launch({headless:true});try{for(const viewport of viewports)await t.test(viewport.slug,async()=>{
  const h=await setup(browser,viewport),{page,fixture}=h;try{
   await page.goto(origin+selectedDesignRoute);await ready(page);await bounds(page,viewport.width,viewport.height);await visible(page,'.consoleCollectionDetail>header h2');assert.equal(await page.locator('.consoleLibraryList [data-record-id]').count(),25);assert.equal(await page.locator('[data-library-design]').getAttribute('data-library-design'),oldAssetId);
   assert.equal(await page.getByRole('link',{name:'Open exact Work output',exact:true}).getAttribute('href'),exactWorkHref);await compact(page,viewport.width,'designs');await capture(page,`console-r02-library-design-selected-${viewport.slug}`);
   await page.locator('form.consoleCollectionToolbar [name=q]').fill('Synthetic');await page.locator('form.consoleCollectionToolbar [name=sort]').selectOption('oldest');await page.locator('form.consoleCollectionToolbar button[type=submit]').click();await ready(page);
   assert.equal(new URL(page.url()).searchParams.get('sort'),'oldest');assert.equal(await page.locator('[data-library-design]').getAttribute('data-library-design'),oldAssetId);
   await page.goBack();await ready(page);assert.equal(await page.locator('form.consoleCollectionToolbar [name=sort]').inputValue(),'newest');assert.equal(await page.locator('form.consoleCollectionToolbar [name=q]').inputValue(),'');
   await page.goForward();await ready(page);assert.equal(await page.locator('form.consoleCollectionToolbar [name=sort]').inputValue(),'oldest');assert.equal(await page.locator('form.consoleCollectionToolbar [name=q]').inputValue(),'Synthetic');
   await page.getByRole('link',{name:'Close detail',exact:true}).click();await ready(page);assert.equal(await page.locator('.consoleLibraryDetail').count(),0);assert.equal(new URL(page.url()).searchParams.get('business'),businessId);
   const row=page.locator('.consoleLibraryList .consoleLibraryTitle').first();await row.focus();await page.keyboard.press('Enter');await ready(page);assert.equal(await page.locator('.consoleLibraryDetail').count(),1);await visible(page,'.consoleLibraryDetail>header h2');await page.reload();await ready(page);await bounds(page,viewport.width,viewport.height);
   await page.evaluate(route=>window.__libraryNavigate(route),selectedRecordRoute);await ready(page);await bounds(page,viewport.width,viewport.height);await visible(page,'.consoleLibraryDetail>header h2');assert.equal(await page.locator('[data-library-artifact]').getAttribute('data-library-artifact'),exactRecordId);
   assert.equal(createHash('sha256').update(await page.locator('[aria-label="Exact selected artifact content JSON"]').textContent()).digest('hex'),exactContentHash);assert.equal(await page.getByRole('textbox',{name:'Exact selected artifact content JSON'}).count(),0);await compact(page,viewport.width,'records');await capture(page,`console-r02-library-record-selected-${viewport.slug}`);
   await visible(page,'[aria-label="Exact selected artifact content JSON"]',{focus:true,scroll:true});await page.reload();await ready(page);assert.equal(createHash('sha256').update(await page.locator('[aria-label="Exact selected artifact content JSON"]').textContent()).digest('hex'),exactContentHash);
   await page.evaluate(route=>window.__libraryNavigate(route),selectedRunRoute);await ready(page);await bounds(page,viewport.width,viewport.height);await visible(page,'.consoleLibraryDetail>header h2');assert.equal(await page.locator('[data-library-creative-run]').getAttribute('data-library-creative-run'),noAssetRunId);assert.match(await page.locator('.consoleLibraryExactRun').innerText(),/No saved asset is recorded/);assert.match(await page.locator('.consoleLibraryCosts').innerText(),/charge\(s\) remain unknown/);await compact(page,viewport.width,'no-asset');await capture(page,`console-r02-library-paid-no-asset-${viewport.slug}`);
   if(viewport.width===1000){await openRunLookup(page);await bounds(page,viewport.width,viewport.height);await visible(page,'.consoleLibraryRunLookup input[name=creativeRun]',{focus:true});await page.locator('.consoleLibraryDetail>header h2').scrollIntoViewIfNeeded();await visible(page,'.consoleLibraryRunHeadline');await visible(page,'.consoleLibraryCharge');await visible(page,'.consoleLibraryCosts>.consoleLibraryWarning');await capture(page,'console-r02-library-paid-no-asset-1000-expanded-lookup');await page.locator('.consoleLibraryRunLookup>summary').click();} 
   await page.getByRole('link',{name:'Next',exact:true}).click();await ready(page);assert.equal(new URL(page.url()).searchParams.get('page'),'2');assert.equal(new URL(page.url()).searchParams.get('creativeRun'),noAssetRunId);await page.goBack();await ready(page);await page.goForward();await ready(page);await page.reload();await ready(page);
   await page.locator('.consoleCollectionPagination').scrollIntoViewIfNeeded();await visible(page,'.consoleCollectionPagination');await capture(page,`console-r02-library-footer-${viewport.slug}`);
   assert.equal(fixture.ancillaryCalls.length,0);assert.ok(h.previews.length>0);clean(h);await paidCalls(page);
  }catch(error){await capture(page,`console-r02-library-failure-${viewport.slug}`).catch(()=>{});throw error;}finally{await h.context.close();}
 });}finally{await browser.close();}
});

for(const kind of ['designs','records'])test(`hosted native GET Library ${kind} Back restores Business/filter controls to URL and exact selection`,{skip:!enabled,timeout:90000},async()=>{
 const browser=await chromium.launch({headless:true}),h=await setup(browser,{width:1280,height:720},{retained:false}),{page}=h,route=kind==='designs'?selectedDesignRoute:selectedRecordRoute;
 try{await page.goto(origin+route);await ready(page);await page.locator('form.consoleCollectionToolbar [name=q]').fill('Synthetic');await page.locator('form.consoleCollectionToolbar [name=sort]').selectOption('oldest');await page.locator('form.consoleCollectionToolbar [name=business]').selectOption('');if(kind==='records'){await page.locator('form.consoleCollectionToolbar [name=mediaType]').selectOption('image/png');await page.locator('form.consoleCollectionToolbar [name=artifactType]').selectOption('creative.image');}
  await Promise.all([page.waitForURL(url=>url.searchParams.get('sort')==='oldest'),page.locator('form.consoleCollectionToolbar button[type=submit]').click()]);await ready(page);assert.equal(await page.locator('form.consoleCollectionToolbar [name=business]').inputValue(),'');
  await page.goBack();await ready(page);assert.equal(await page.locator('form.consoleCollectionToolbar [name=sort]').inputValue(),'newest');assert.equal(await page.locator('form.consoleCollectionToolbar [name=q]').inputValue(),'');assert.equal(await page.locator('form.consoleCollectionToolbar [name=business]').inputValue(),businessId);assert.equal(new URL(page.url()).searchParams.get('selected'),kind==='designs'?oldAssetId:exactRecordId);
  if(kind==='records'){assert.equal(await page.locator('form.consoleCollectionToolbar [name=mediaType]').inputValue(),'all');assert.equal(await page.locator('form.consoleCollectionToolbar [name=artifactType]').inputValue(),'all');}
  await page.goForward();await ready(page);assert.equal(await page.locator('form.consoleCollectionToolbar [name=sort]').inputValue(),'oldest');assert.equal(await page.locator('form.consoleCollectionToolbar [name=q]').inputValue(),'Synthetic');assert.equal(await page.locator('form.consoleCollectionToolbar [name=business]').inputValue(),'');if(kind==='records'){assert.equal(await page.locator('form.consoleCollectionToolbar [name=mediaType]').inputValue(),'image/png');assert.equal(await page.locator('form.consoleCollectionToolbar [name=artifactType]').inputValue(),'creative.image');}
  await capture(page,`console-r02-library-native-get-${kind}`);assert.equal(h.fixture.ancillaryCalls.length,0);clean(h);await paidCalls(page);
 }catch(error){await capture(page,`console-r02-library-native-get-failure-${kind}`).catch(()=>{});throw error;}finally{await h.context.close();await browser.close();}
});

test('hosted Library exact disclosures and all reading positions survive retained Back/reload and Close returns list scope',{skip:!enabled,timeout:180000},async t=>{
 const browser=await chromium.launch({headless:true});try{for(const viewport of [viewports[0],viewports[2],viewports[3],viewports[4]])await t.test(viewport.slug,async()=>{
  const h=await setup(browser,viewport),{page}=h;try{
   await page.goto(origin+selectedRecordRoute);await ready(page);const disclosure=page.locator(`[data-console-disclosure="metadata:${exactRecordId}"]`);await disclosure.locator('summary').click();
   const before=await page.evaluate(()=>{const detail=document.querySelector('.consoleLibraryDetail'),body=document.querySelector('.consoleLibraryBody');if(innerWidth>=1200){detail.scrollTop=detail.scrollHeight-400;return {kind:'detail',position:detail.scrollTop};}if(innerWidth>900){body.scrollTop=body.scrollHeight-450;return {kind:'body',position:body.scrollTop};}window.scrollTo(0,document.querySelector('.consoleLibraryDetail').getBoundingClientRect().top+scrollY+450);return {kind:'document',position:scrollY};});
   assert.ok(before.position>100);await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,160)));await page.evaluate(()=>window.__libraryNavigate(location.pathname+location.search+'&page=2'));await ready(page);await page.goBack();await ready(page);assert.equal(await disclosure.getAttribute('open'),'');
   const position=()=>page.evaluate(kind=>kind==='detail'?document.querySelector('.consoleLibraryDetail').scrollTop:kind==='body'?document.querySelector('.consoleLibraryBody').scrollTop:scrollY,before.kind);assert.ok(Math.abs(await position()-before.position)<4,`Back lost ${before.kind} scroll`);
   await page.reload();await ready(page);assert.equal(await disclosure.getAttribute('open'),'');assert.ok(Math.abs(await position()-before.position)<4,`Reload lost ${before.kind} scroll`);await capture(page,`console-r02-library-retained-reading-${viewport.slug}`);
   await page.getByRole('link',{name:'Close detail',exact:true}).click();await ready(page);assert.equal(new URL(page.url()).searchParams.get('business'),businessId);assert.equal(new URL(page.url()).searchParams.get('type'),'records');assert.equal(await page.locator('.consoleLibraryDetail').count(),0);clean(h);await paidCalls(page);
  }catch(error){await capture(page,`console-r02-library-reading-failure-${viewport.slug}`).catch(()=>{});throw error;}finally{await h.context.close();}
 });}finally{await browser.close();}
});

test('hosted Library retained delayed reads preserve the native modal barrier, saved draft and newest navigation',{skip:!enabled,timeout:120000},async()=>{
 const browser=await chromium.launch({headless:true}),h=await setup(browser,{width:1280,height:720}),{page}=h;
 try{await page.goto(origin+'/dashboard?view=library&type=designs');await ready(page);const draft={version:1,ownerId:owner,draft:{businessId:secondBusinessId,goal:'Compare synthetic woodland markets and preserve my saved goal',audienceHint:'Adult woodland enthusiasts',maximumCollections:'2',maximumUsd:'0.80'},step:0,reviewedEstimate:null};
  await page.evaluate(({owner,draft})=>sessionStorage.setItem(`agentlabs:research-draft:v1:${owner}`,JSON.stringify(draft)),{owner,draft});assert.equal(await page.locator('#console-command-input').inputValue(),'');assert.equal(h.fixture.ancillaryCalls.length,0);
  await page.getByRole('button',{name:/Choose Business/}).click();await ready(page);await page.locator('dialog:modal').waitFor();await page.waitForFunction(()=>document.querySelector('[name=goal]')?.value.includes('preserve my saved goal'));assert.equal(await page.locator('dialog [name=businessId]').inputValue(),secondBusinessId);assert.equal(await page.locator('dialog [name=audienceHint]').inputValue(),draft.draft.audienceHint);
  assert.deepEqual(await page.evaluate(owner=>JSON.parse(sessionStorage.getItem(`agentlabs:research-draft:v1:${owner}`)).draft,owner),draft.draft);const hold=h.holdRead(route=>!new URL(route,origin).searchParams.has('sheet'));await page.getByRole('button',{name:'Close research setup'}).click();await page.waitForFunction(()=>window.__libraryReadPending===true);
  assert.equal(await page.locator('dialog:modal').count(),1);assert.equal(await page.locator('.consoleResearchBody').getAttribute('inert'),'');await page.locator('#console-command-input').evaluate(node=>node.focus());assert.equal(await page.locator('#console-command-input').evaluate(node=>document.activeElement===node),false);while(!hold.release)await new Promise(resolve=>setTimeout(resolve,5));hold.release();await ready(page);assert.equal(await page.locator('dialog:modal').count(),0);
  await page.getByRole('button',{name:/Choose Business/}).click();await ready(page);await page.waitForFunction(()=>document.querySelector('[name=goal]')?.value.includes('preserve my saved goal'));assert.equal(await page.locator('dialog [name=audienceHint]').inputValue(),draft.draft.audienceHint);await page.getByRole('button',{name:'Close research setup'}).click();await ready(page);
  const stale=h.holdRead(route=>route.includes('page=2'));await page.evaluate(()=>{window.__libraryNavigate('/dashboard?view=library&type=designs&page=2');});await page.waitForFunction(()=>window.__libraryReadPending);await page.evaluate(route=>window.__libraryNavigate(route),selectedRecordRoute);await ready(page);while(!stale.release)await new Promise(resolve=>setTimeout(resolve,5));stale.release();await page.waitForFunction(()=>window.__libraryDiscarded===1);assert.equal(await page.locator('.consoleLibraryPane').getAttribute('data-library-kind'),'records');assert.equal(new URL(page.url()).searchParams.get('selected'),exactRecordId);
  await capture(page,'console-r02-library-retained-modal-return');clean(h);await paidCalls(page);
 }catch(error){await capture(page,'console-r02-library-modal-failure').catch(()=>{});throw error;}finally{await h.context.close();await browser.close();}
});

async function assertExpiredPreview(page){
 assert.match(await page.locator('.consoleLibraryPreviewLarge').innerText(),/Private preview unavailable[\s\S]*Reload to refresh private access/);
 assert.match(await page.locator('.consoleLibraryPreviewLarge .consoleLibraryPreviewMissing').getAttribute('aria-label'),/may have expired/);
}

for(const mode of ['expired-preview','missing-preview','null-count','corrupt-page','cost-unavailable'])test(`hosted Library ${mode} keeps explicit failure/unknown truth and exact selection`,{skip:!enabled,timeout:90000},async()=>{
 const fixtureOptions=mode==='missing-preview'?{readOptions:{signResult:()=>({data:[],error:null})}}:mode==='null-count'?{readOptions:{transport(_table,result,read){return read.range?{...result,count:null}:result;}}}:mode==='corrupt-page'?{readOptions:{transport(_table,result,read){return read.range?{...result,data:result.data.map((row,index)=>index?row:{...row,generated_at:'invalid'})}:result;}}}:mode==='cost-unavailable'?{readOptions:{counts:{creative_cost_settlements:null}}}:{};
 const browser=await chromium.launch({headless:true}),h=await setup(browser,{width:1280,height:720},{fixtureOptions,imageFailure:mode==='expired-preview',deferHydration:mode==='expired-preview'}),{page}=h;
 try{await page.goto(origin+selectedDesignRoute);
  if(mode==='expired-preview'){
   assert.equal(await page.evaluate(()=>window.__libraryHydrationDeferred),true);assert.equal(await page.evaluate(()=>window.__libraryHydrated),undefined);
   await page.locator('.consoleLibraryPreviewLarge img').scrollIntoViewIfNeeded();
   await page.waitForFunction(()=>{const img=document.querySelector('.consoleLibraryPreviewLarge img');return img?.complete&&img.naturalWidth===0&&img.currentSrc!=='';});
   const failedImage=await page.locator('.consoleLibraryPreviewLarge img').evaluate(img=>({src:img.src,attribute:img.getAttribute('src'),currentSrc:img.currentSrc,complete:img.complete,naturalWidth:img.naturalWidth}));
   assert.ok(failedImage.complete&&failedImage.naturalWidth===0&&failedImage.currentSrc===failedImage.src&&failedImage.src===failedImage.attribute,JSON.stringify(failedImage));
   assert.ok(h.previews.includes(new URL(failedImage.src).pathname.split('/creative-assets/')[1]),JSON.stringify(failedImage));
   assert.equal(await page.evaluate(()=>window.__libraryHydrated),undefined,'The selected SSR image must fail before React attaches its handlers');
   await capture(page,'console-r02-library-expired-before-hydration');await page.evaluate(()=>window.__libraryStartHydration());
  }
  await ready(page);assert.equal(await page.locator('[data-library-design]').getAttribute('data-library-design'),oldAssetId);await bounds(page,1280,720);
  if(mode.includes('preview')){await page.locator('.consoleLibraryPreviewLarge .consoleLibraryPreviewMissing').waitFor();assert.equal(await page.locator('.consoleLibraryPreviewLarge img').count(),0);assert.equal(await page.getByRole('link',{name:'Open full image ↗',exact:true}).count(),0);if(mode==='expired-preview')await assertExpiredPreview(page);}
  if(mode==='null-count'||mode==='corrupt-page')assert.match(await page.locator('.consoleCollectionCount').innerText(),/unverified|unavailable|unknown/i);
  if(mode==='cost-unavailable'){await page.locator(`[data-console-disclosure="run:${id(2000)}"]>summary`).click();assert.match(await page.locator('.consoleLibraryCosts').innerText(),/charge unknown|Do not assume zero spend/);}
  await capture(page,`console-r02-library-${mode}`);
  if(mode==='expired-preview'){
   // A second registered asset fails after hydration, through its real intercepted image request.
   const laterAsset=id(1001),laterRoute=selectedDesignRoute.replace(oldAssetId,laterAsset)+'&q=unmatched';
   await page.evaluate(route=>window.__libraryNavigate(route),laterRoute);await ready(page);await page.locator('.consoleLibraryPreviewLarge .consoleLibraryPreviewMissing').waitFor();
   assert.equal(await page.locator('[data-library-design]').getAttribute('data-library-design'),laterAsset);assert.equal(await page.locator('.consoleLibraryPreviewLarge img').count(),0);assert.equal(await page.locator('.consoleLibraryPreviewLarge a').count(),0);await assertExpiredPreview(page);
   assert.ok(h.previews.includes(h.fixture.tables.creative_assets.find(asset=>asset.id===laterAsset).storage_path));await capture(page,'console-r02-library-expired-after-hydration');
   // Reset by selecting the original registered asset with healthy deterministic fixture bytes.
   // The URL domain, signed-path/token rules and denied-request policy remain unchanged.
   h.setImageFailure(false);const prior=h.previews.length;await page.evaluate(route=>window.__libraryNavigate(route),selectedDesignRoute+'&q=unmatched');await ready(page);
   await page.waitForFunction(()=>{const img=document.querySelector('.consoleLibraryPreviewLarge img');return img?.complete&&img.naturalWidth>0;});
   assert.equal(await page.locator('[data-library-design]').getAttribute('data-library-design'),oldAssetId);assert.equal(await page.locator('.consoleLibraryPreviewLarge .consoleLibraryPreviewMissing').count(),0);
   const recoveredSrc=await page.locator('.consoleLibraryPreviewLarge img').getAttribute('src');assert.equal(await page.locator('.consoleLibraryPreviewLarge a').getAttribute('href'),recoveredSrc);assert.ok(h.previews.slice(prior).includes(new URL(recoveredSrc).pathname.split('/creative-assets/')[1]));await capture(page,'console-r02-library-expired-preview-reset');
  }
  assert.equal(h.fixture.ancillaryCalls.length,0);clean(h);await paidCalls(page);
 }catch(error){await capture(page,`console-r02-library-${mode}-failure`).catch(()=>{});throw error;}finally{await h.context.close();await browser.close();}
});

test('hosted narrow direct Library missing/unavailable selections reveal the exact error above the footer',{skip:!enabled,timeout:120000},async t=>{
 const browser=await chromium.launch({headless:true});
 try{for(const viewport of [{width:390,height:844},{width:640,height:450}])for(const state of ['missing','unavailable'])await t.test(`${state}-${viewport.width}`,async()=>{
  const fixtureOptions=state==='unavailable'?{readOptions:{transport(table,result,read){return table==='creative_assets'&&read.columns.includes('inspection')?{data:null,count:null,error:true}:result;}}}:{};
  const h=await setup(browser,viewport,{fixtureOptions}),{page}=h;
  try{const route=state==='missing'?selectedDesignRoute.replace(oldAssetId,id(999999)):selectedDesignRoute;await page.goto(origin+route);await ready(page);
   assert.equal(await page.locator('.consoleLibraryDetail').getAttribute('data-console-selection'),state);await visible(page,'.consoleLibraryDetail>header h2');await visible(page,'.consoleLibraryDetail>p');
   assert.equal(await page.locator('[data-library-design]').count(),0);await bounds(page,viewport.width,viewport.height);
   await capture(page,`console-r02-library-exact-${state}-${viewport.width}`);clean(h);await paidCalls(page);
  }finally{await h.context.close();}
 });}finally{await browser.close();}
});

async function openRunLookup(page){
 const lookup=page.locator('.consoleLibraryRunLookup'),summary=lookup.locator(':scope>summary');
 if(await lookup.getAttribute('open')===null){await summary.focus();await page.keyboard.press('Enter');}
 assert.equal(await lookup.getAttribute('open'),'');return lookup.locator('input[name=creativeRun]');
}
async function assertRunLookupIdentity(page,runId){
 assert.equal(new URL(page.url()).searchParams.get('creativeRun'),runId);
 assert.equal(new URL(page.url()).searchParams.get('selected'),null);
 assert.equal(await page.locator('[data-library-creative-run]').getAttribute('data-library-creative-run'),runId);
 assert.equal(await page.locator('.consoleLibraryRunLookup input[name=creativeRun]').inputValue(),runId);
}

for(const retained of [false,true])test(`hosted Library ${retained?'retained':'native GET'} exact-run lookup keeps URL, displayed run and restored field aligned on Back/Forward`,{skip:!enabled,timeout:90000},async()=>{
 const browser=await chromium.launch({headless:true}),h=await setup(browser,{width:1280,height:720},{retained}),{page}=h,secondRun=id(2000),name=retained?'retained':'native-get';
 try{
  await page.goto(origin+selectedRunRoute);await ready(page);await assertRunLookupIdentity(page,noAssetRunId);
  const input=await openRunLookup(page);await input.fill(secondRun);await visible(page,'.consoleLibraryRunLookup input[name=creativeRun]',{focus:true});
  // Inspect is a native GET form and is operable from the keyboard, without a new action channel.
  await Promise.all([page.waitForURL(url=>url.searchParams.get('creativeRun')===secondRun),page.keyboard.press('Enter')]);await ready(page);await assertRunLookupIdentity(page,secondRun);
  await page.goBack();await ready(page);await assertRunLookupIdentity(page,noAssetRunId);
  await page.goForward();await ready(page);await assertRunLookupIdentity(page,secondRun);
  await page.goBack();await ready(page);await assertRunLookupIdentity(page,noAssetRunId);
  await openRunLookup(page);await page.locator('.consoleLibraryRunLookup input[name=creativeRun]').focus();await page.keyboard.press('Tab');assert.equal(await page.getByRole('button',{name:'Inspect run',exact:true}).evaluate(node=>node===document.activeElement),true);
  await capture(page,`console-r02-library-run-lookup-${name}`);assert.equal(h.fixture.ancillaryCalls.length,0);clean(h);await paidCalls(page);
 }catch(error){await capture(page,`console-r02-library-run-lookup-${name}-failure`).catch(()=>{});throw error;}finally{await h.context.close();await browser.close();}
});

test('hosted Library exact-run history reconciliation does not overwrite a newer unsent edit or move focus on unchanged retained refresh',{skip:!enabled,timeout:90000},async()=>{
 const browser=await chromium.launch({headless:true}),h=await setup(browser,{width:1280,height:720}),{page}=h;
 try{
  await page.goto(origin+selectedRunRoute);await ready(page);const input=await openRunLookup(page);
  await input.fill(id(2000));await page.keyboard.press('Enter');await ready(page);await assertRunLookupIdentity(page,id(2000));await openRunLookup(page);await input.focus();
  const held=h.holdRead(route=>new URL(route,origin).searchParams.get('creativeRun')===noAssetRunId);await page.goBack();await page.waitForFunction(()=>window.__libraryReadPending===true);
  const unsentRun=id(2001);
  // Back has changed the URL while retaining the old tree. pageshow queues production history restoration. An actual input event in the same task
  // is newer than that queued restoration; it must win without changing URL/detail identity.
  const before=await page.evaluate(unsentRun=>{
   const field=document.querySelector('.consoleLibraryRunLookup input[name=creativeRun]');
   window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));
   Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,unsentRun);
   field.setSelectionRange(4,12);field.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:unsentRun}));
   return {scrollX,scrollY,start:field.selectionStart,end:field.selectionEnd,commits:window.__libraryCommits,reads:window.__libraryReadRequests.length};
  },unsentRun);
  await page.evaluate(()=>new Promise(resolve=>setTimeout(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)),0)));
  assert.equal(await input.inputValue(),unsentRun);assert.equal(new URL(page.url()).searchParams.get('creativeRun'),noAssetRunId);assert.equal(await page.locator('[data-library-creative-run]').getAttribute('data-library-creative-run'),id(2000));
  while(!held.release)await new Promise(resolve=>setTimeout(resolve,5));held.release();await ready(page);
  assert.equal(await input.inputValue(),unsentRun);assert.equal(await page.locator('[data-library-creative-run]').getAttribute('data-library-creative-run'),noAssetRunId);
  const selection=()=>input.evaluate(node=>({focused:node===document.activeElement,start:node.selectionStart,end:node.selectionEnd,x:scrollX,y:scrollY}));
  assert.deepEqual(await selection(),{focused:true,start:before.start,end:before.end,x:before.scrollX,y:before.scrollY});
  assert.equal(await page.evaluate(()=>window.__libraryReadRequests.length),before.reads);
  const refreshCommit=await page.evaluate(()=>window.__libraryCommits);await page.evaluate(()=>window.__libraryRouter.refresh());await page.waitForFunction(commits=>window.__libraryCommits>commits,refreshCommit);await ready(page);
  assert.equal(await page.evaluate(()=>window.__libraryReadRequests.length),before.reads+1);
  assert.equal(await input.inputValue(),unsentRun);assert.equal(new URL(page.url()).searchParams.get('creativeRun'),noAssetRunId);assert.equal(await page.locator('[data-library-creative-run]').getAttribute('data-library-creative-run'),noAssetRunId);
  assert.deepEqual(await selection(),{focused:true,start:before.start,end:before.end,x:before.scrollX,y:before.scrollY});
  await capture(page,'console-r02-library-run-lookup-unsent-edit');assert.equal(h.fixture.ancillaryCalls.length,0);clean(h);await paidCalls(page);
 }catch(error){await capture(page,'console-r02-library-run-lookup-unsent-edit-failure').catch(()=>{});throw error;}finally{await h.context.close();await browser.close();}
});
