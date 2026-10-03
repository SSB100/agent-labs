import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { id } from './data.mjs';
import { actualZoomBrowser } from './browser-zoom.mjs';

export async function runNextJourneys({origin,boundary,output,httpOnly=false}) {
  const results=[];
  const report=()=>writeFile(path.join(output,'acceptance.json'),JSON.stringify({results,browser:httpOnly?'unrun':'actual Chromium against production Next'},null,2));
  const check=async(name,fn)=>{try{await fn();results.push({name,status:'passed'});console.log('PASS:',name);}catch(error){results.push({name,status:'failed',error:String(error.stack)});console.error('FAIL:',name,String(error.stack));await report();}finally{await fetch(boundary.origin+'/control',{method:'POST',body:JSON.stringify({delayId:null,delayMs:0,failTable:null,actionMode:'success'})});}};
  await check('real Next History redirect selects ended outcomes',async()=>{
    const response=await fetch(origin+`/dashboard/history?business=${id(1)}`,{redirect:'manual'});
    assert.equal(response.status,307);assert.match(response.headers.get('location'),/view=work/);assert.match(response.headers.get('location'),/status=ended/);
  });
  await check('real private entry overwrites forged return headers and keeps the actual requested route',async()=>{
    const destination=`/dashboard/products?business=${id(1)}&panel=new&recentPage=2`;
    const response=await fetch(origin+destination,{redirect:'manual',headers:{cookie:'r03-session=off','x-agent-labs-return-path':'/dashboard?business=forged'}});
    assert.equal(response.status,307);const location=new URL(response.headers.get('location'),origin);
    assert.equal(location.pathname,'/login');assert.equal(location.searchParams.get('error'),'session-required');
    assert.equal(location.searchParams.get('returnTo'),destination);
  });
  await check('real Next Suspense streams the detail fallback before delayed saved content',async()=>{
    await fetch(boundary.origin+'/control',{method:'POST',body:JSON.stringify({delayId:id(1001),delayMs:1200})});
    const response=await fetch(origin+`/dashboard/workflows/${id(1001)}?business=${id(1)}`);
    const start=Date.now(),reader=response.body.getReader();let text='',chunks=0,first='';
    for(;;){const value=await reader.read();if(value.done)break;chunks++;const part=new TextDecoder().decode(value.value);text+=part;if(chunks===1)first=part;}
    assert.match(first,/Loading exact saved workflow/);assert.ok(chunks>1);assert.ok(Date.now()-start>=900,'No delayed stream boundary observed');assert.match(text,/data-work-detail/);
    await fetch(boundary.origin+'/control',{method:'POST',body:JSON.stringify({delayId:null,delayMs:0})});
  });
  if(httpOnly){await report();assert.ok(results.every(result=>result.status==='passed'),'HTTP streaming checks failed; see acceptance.json');return;}
  const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  try {
    const context=await browser.newContext({viewport:{width:1280,height:720},reducedMotion:'reduce'});
    const page=await context.newPage(), requests=[], actions=[], external=[];
    await context.route('**/*',route=>{const u=new URL(route.request().url());if(['http:','https:'].includes(u.protocol)&&u.origin!==origin){external.push(u.origin);return route.abort('blockedbyclient');}return route.continue();});
    page.on('response',r=>{if(r.headers()['content-type']?.includes('text/x-component'))requests.push({url:r.url(),status:r.status()});if(r.request().method()==='POST'&&r.request().headers()['next-action'])actions.push({url:r.url(),status:r.status(),revalidated:r.headers()['x-action-revalidated']??null,redirect:r.headers()['x-action-redirect']??null});});
    const business=id(1);
    await check('production Next Link navigation emits RSC responses',async()=>{
      await page.goto(origin+`/dashboard/settings?business=${business}`);await page.getByRole('link',{name:'Businesses',exact:true}).click();await page.waitForURL(/panel=businesses/);await page.getByRole('heading',{name:'Owned Businesses'}).waitFor();assert.ok(requests.length>0,'No genuine RSC Link response observed');
    });
    const control=values=>fetch(boundary.origin+'/control',{method:'POST',body:JSON.stringify(values)});
    await check('delayed record A to B navigation commits only the newer exact record',async()=>{
      await page.goto(origin+`/dashboard?view=work&business=${business}`);
      const rows=page.locator('.consoleCollectionRow');
      const a=await rows.nth(0).getAttribute('data-record-id'),b=await rows.nth(1).getAttribute('data-record-id');
      await control({delayId:a,delayMs:1800});
      await rows.nth(0).locator('.consoleCollectionRowTitle').click();
      await page.locator(`.consoleCollectionRow[data-record-id="${b}"] .consoleCollectionRowTitle`).click();
      await page.locator(`[data-work-detail="${b}"]`).waitFor();
      await page.waitForTimeout(1900);
      assert.equal(await page.locator(`[data-work-detail="${a}"]`).count(),0);
      assert.equal(new URL(page.url()).searchParams.get('selected'),b);
      await control({delayId:null,delayMs:0});
      await page.goBack();await page.goForward();await page.locator(`[data-work-detail="${b}"]`).waitFor();
    });
    await check('interrupted real RSC request permits a subsequent destination',async()=>{
      await page.goto(origin+`/dashboard/settings?business=${business}`);
      const matcher='**/dashboard/settings?*panel=businesses*';
      await page.route(matcher,route=>route.abort('aborted'));
      await page.getByRole('link',{name:'Businesses',exact:true}).click();
      await page.unroute(matcher);
      await page.getByRole('link',{name:'Work',exact:true}).click();
      await page.waitForURL(/view=work/);await page.getByRole('heading',{name:'Work',exact:true}).waitFor();
    });
    await check('unsaved nonsecret tool draft survives real tabs, Back and reload',async()=>{
      await page.goto(origin+`/dashboard/products?business=${business}&panel=new`);
      await page.locator('input[name=concept]').fill('Unsaved inert original concept');
      await page.getByRole('link',{name:'Candidates',exact:true}).click();
      await page.waitForURL(/panel=candidates/);await page.goBack();await page.waitForURL(/panel=new/);await page.locator('input[name=concept]').waitFor();assert.equal(await page.locator('input[name=concept]').inputValue(),'Unsaved inert original concept');
      await page.reload();assert.equal(await page.locator('input[name=concept]').inputValue(),'Unsaved inert original concept');
      await page.goto(origin+`/dashboard/products?business=${id(2)}&panel=new`);
      assert.equal(await page.locator('input[name=concept]').inputValue(),'');
    });
    await check('retained candidate server action preserves exact Business, duplicate outcome and error drafts',async()=>{
      const target=origin+`/dashboard/products?business=${business}&panel=new`;
      const second=await context.newPage();await Promise.all([page.goto(target),second.goto(target)]);
      for(const current of [page,second]){
        await current.locator('input[name=concept]').fill('New inert candidate from real Next action');await current.locator('input[name=audience]').fill('Synthetic weekend hikers');
        await current.locator('textarea[name=hypothesis]').fill('We expect this synthetic adult audience to prefer an original trail journal graphic.');
        await current.locator('input[name=sourceDomains]').fill('example.invalid');await current.locator('input[name=originalDesign]').check();
      }
      await Promise.all([page.getByRole('button',{name:'Save candidate',exact:true}).click(),second.getByRole('button',{name:'Save candidate',exact:true}).click()]);
      await Promise.all([page.waitForURL(/message=candidate-(saved|reused)/),second.waitForURL(/message=candidate-(saved|reused)/)]);
      assert.equal(boundary.effects.filter(e=>e.kind==='in-memory-candidate').length,1);
      const saved=boundary.state().db.product_candidates.find(c=>c.concept==='New inert candidate from real Next action');
      assert.equal(new URL(page.url()).searchParams.get('candidate'),saved.id);assert.equal(new URL(page.url()).searchParams.get('business'),business);
      await page.getByRole('heading',{name:saved.concept,exact:true}).waitFor();assert.ok(actions.some(action=>new URL(action.url).pathname==='/dashboard/products'&&Number(action.revalidated)>0),'Real Next action must report cache revalidation before manual reload');
      await page.reload();await page.getByRole('heading',{name:saved.concept,exact:true}).waitFor();
      await page.goto(target);await page.locator('input[name=concept]').fill('New uncertain inert draft');await page.locator('input[name=audience]').fill('Synthetic weekend hikers');await page.locator('textarea[name=hypothesis]').fill('A separate valid synthetic hypothesis for an uncertain server outcome.');await page.locator('input[name=sourceDomains]').fill('example.invalid');await page.locator('input[name=originalDesign]').check();
      await control({actionMode:'uncertain'});await page.getByRole('button',{name:'Save candidate',exact:true}).click();await page.waitForURL(/error=candidate-outcome-unconfirmed/);
      await page.waitForFunction(()=>document.querySelector('input[name=concept]')?.value==='New uncertain inert draft');assert.equal(await page.locator('input[name=concept]').inputValue(),'New uncertain inert draft');assert.equal(await page.locator('input[name=originalDesign]').isChecked(),false,'Consent must not be restored with the draft');
      await control({actionMode:'success'});await second.close();
    });
    await check('duplicate real server actions have one exact inert acknowledgment and revalidate saved state',async()=>{
      const notice=boundary.state().db.owner_interventions.find(n=>n.intervention_type==='creative_review');
      const target=origin+`/dashboard?view=decisions&business=${business}&decision=${notice.id}`;
      const second=await context.newPage();await Promise.all([page.goto(target),second.goto(target)]);
      await Promise.all([page.getByRole('button',{name:'Mark reviewed',exact:true}).click(),second.getByRole('button',{name:'Mark reviewed',exact:true}).click()]);
      await Promise.all([page.waitForURL(/message=terminal-review/),second.waitForURL(/message=terminal-review/)]);
      assert.equal(boundary.effects.filter(e=>e.id===notice.id).length,1);
      assert.equal(boundary.state().db.owner_interventions.find(n=>n.id===notice.id).status,'resolved');
      await page.getByText('Stopped · reviewed',{exact:true}).waitFor();assert.ok(actions.some(action=>new URL(action.url).pathname==='/dashboard'&&Number(action.revalidated)>0),'Real Next acknowledgment must commit refreshed saved state before manual reload');
      await page.reload();await page.getByText('Stopped · reviewed',{exact:true}).waitFor();
      const request=boundary.state().db.owner_interventions.find(n=>n.intervention_type==='creative_review'&&n.status==='open'&&n.workflow_run_id!==id(1001));
      for(const [actionMode,outcome]of [['conflict','terminal-review-conflict'],['uncertain','terminal-review-failed']]){
        await control({actionMode});await page.goto(origin+`/dashboard?view=decisions&business=${business}&decision=${request.id}`);
        await page.getByRole('button',{name:'Mark reviewed',exact:true}).click();await page.waitForURL(new RegExp('error='+outcome));
        assert.equal(boundary.state().db.owner_interventions.find(n=>n.id===request.id).status,'open');
      }
      await control({actionMode:'success'});await second.close();
    });
    await check('new browser history navigation interrupts a pending modal dismissal',async()=>{
      await page.goto(origin+`/dashboard/settings?business=${business}`);
      await page.getByRole('link',{name:'Work',exact:true}).click();await page.waitForURL(/view=work/);
      await page.locator('#console-command-input').fill('Inert research draft');await page.getByRole('button',{name:'Review goal',exact:false}).click();await page.getByRole('dialog').waitFor();
      const pattern='**/dashboard?*';
      await page.route(pattern,async route=>{const u=new URL(route.request().url());if(u.searchParams.get('view')==='work' && !u.searchParams.has('sheet') && u.searchParams.has('_rsc'))await new Promise(resolve=>setTimeout(resolve,1800));return route.continue().catch(()=>{});});
      await page.getByRole('button',{name:'Close research setup',exact:true}).click();
      // Native browser history events exercise Next's real popstate integration.
      await page.evaluate(()=>history.go(-2));await page.waitForURL(/dashboard\/settings/);await page.getByRole('heading',{name:'Owner profile',exact:true}).waitFor();
      await page.waitForTimeout(1900);assert.match(page.url(),/dashboard\/settings/);assert.equal(await page.getByRole('dialog').count(),0);await page.unroute(pattern);
    });
    await check('real installed Pack validation preserves its Business and draft without a runtime reservation',async()=>{
      const before=boundary.effects.length;await page.goto(origin+`/dashboard/packs?business=${business}&panel=installed`);
      const input=page.locator('textarea[name=input]').first();await input.fill('{"inertIncompleteJson":');
      await input.locator('xpath=ancestor::form').getByRole('button',{name:/^Run /}).click();await page.waitForURL(/error=workflow-input-invalid/);
      assert.equal(new URL(page.url()).searchParams.get('business'),business);assert.equal(new URL(page.url()).searchParams.get('panel'),'installed');
      await page.waitForFunction(()=>document.querySelector('textarea[name=input]')?.value==='{"inertIncompleteJson":');assert.equal(boundary.effects.length,before);
    });
    await check('old exact model and worker proof links bypass the bounded loaded window',async()=>{
      for(const [route,offset]of [['model-router',700000],['worker-proof',710000]]){
        await page.goto(origin+`/dashboard/${route}?business=${business}&run=${id(offset)}&panel=history`);
        await page.locator('.workflowCard[open]').waitFor();assert.match(await page.locator('main').innerText(),new RegExp(id(offset)));
        const calls=boundary.log.filter(c=>c.table==='workflow_runs'&&c.operations?.some(([op,key,value])=>op==='eq'&&key==='id'&&value===id(offset)));
        assert.ok(calls.some(c=>c.operations.some(([op,max])=>op==='limit'&&max===2)),'Exact lookup must be independent and bounded');
      }
    });
    await check('old exact workflow child links bypass the loaded window and reject a different parent',async()=>{
      for(const [kind,panel,table,record] of [['stage','stages','workflow_stage_runs',id(20000)],['task','tasks','task_contracts',id(21000)],['worker','workers','worker_runs',id(22000)]]){
        await page.goto(origin+`/dashboard/workflows/${id(1001)}?business=${business}&panel=${panel}&${kind}=${record}`);
        const payload=page.getByRole('heading',{name:`Exact saved ${kind} · ${record}`,exact:true});await payload.waitFor();
        assert.match(await page.getByLabel(`Exact ${kind} content`,{exact:true}).innerText(),new RegExp(record));
        const calls=boundary.log.filter(c=>c.table===table&&c.operations?.some(([op,key,value])=>op==='eq'&&key==='id'&&value===record));
        assert.ok(calls.some(c=>c.operations.some(([op,key,value])=>op==='eq'&&key==='workflow_run_id'&&value===id(1001))&&c.operations.some(([op,max])=>op==='limit'&&max===2)),'Independent exact child query must retain its parent');
        await page.reload();await payload.waitFor();
        await page.goto(origin+`/dashboard/workflows/${id(1002)}?business=${business}&panel=${panel}&${kind}=${record}`);
        await page.getByText(`This exact ${kind} is missing. No replacement record was selected.`,{exact:true}).waitFor();assert.equal(await page.getByLabel(`Exact ${kind} content`,{exact:true}).count(),0);
      }
    });
    await check('actual streamed workflow loading stays compact and exposes no action',async()=>{
      await page.setViewportSize({width:1280,height:720});await control({delayId:id(1001),delayMs:2400});
      await page.goto(origin+`/dashboard/workflows/${id(1001)}?business=${business}`,{waitUntil:'commit'});
      await page.getByRole('heading',{name:'Loading exact saved workflow',exact:true}).waitFor();
      await page.screenshot({path:path.join(output,'workflow-loading-1280x720.png')});
      assert.equal(await page.locator('main form').count(),0,'Loading cannot expose an action');
      await page.locator(`[data-work-detail="${id(1001)}"]`).waitFor();await control({delayId:null,delayMs:0});
    });
    await check('isolated secure entry returns to the same Business and exact request through real Next links',async()=>{
      for(const [route,key,label] of [['secure','run','Back to Connections'],['registration','run','Back to account setup'],['password','account','Back to Accounts']]){
        const requested=id(770000),query=new URLSearchParams({business,[key]:requested});
        const target=origin+`/dashboard/accounts/${route}?${query}`;await page.goto(target);
        const link=page.getByRole('link',{name:label,exact:true}).first();await link.waitFor();const url=new URL(await link.getAttribute('href'),origin);
        assert.equal(url.searchParams.get('business'),business);assert.equal(url.searchParams.get('view'),'connections');if(key==='run')assert.equal(url.searchParams.get('connectionRun'),requested);
        const before=boundary.effects.length;await link.click();await page.waitForURL(u=>u.pathname==='/dashboard'&&u.searchParams.get('view')==='connections');assert.equal(boundary.effects.length,before);
        await page.goBack();await page.waitForURL(u=>u.pathname===`/dashboard/accounts/${route}`);await page.reload();await link.waitFor();assert.equal(await page.locator('input[type=password]').count(),0,'Expired/unavailable entry must expose no credential input');
      }
    });
    const effectCount=boundary.effects.length;
    await check('workflow server error boundary reloads the same exact owned record without a new effect',async()=>{
      await control({failTable:'workflow_runs'});await page.goto(origin+`/dashboard/workflows/${id(1001)}?business=${business}`);
      await page.getByRole('heading',{name:'This work could not be loaded',exact:true}).waitFor();
      for(const [width,height]of [[1280,720],[1440,900],[390,844],[320,800],[640,360]]){await page.setViewportSize({width,height});await page.screenshot({path:path.join(output,`workflow-error-${width}x${height}.png`)});const m=await page.evaluate(()=>({w:document.documentElement.scrollWidth,h:document.documentElement.scrollHeight}));assert.ok(m.w<=width+1);if(width>=1280)assert.ok(m.h<=height+1);}
      await control({failTable:null});await page.getByRole('button',{name:'Reload saved work',exact:true}).click();await page.locator(`[data-work-detail="${id(1001)}"]`).waitFor();
      assert.equal(boundary.effects.length,effectCount);
    });
    await check('invalid explicit Business on retained operational routes never selects another Business',async()=>{
      for(const route of ['etsy','printful','packs','products','model-router','worker-proof']){
        const response=await page.goto(origin+`/dashboard/${route}?business=${id(999999)}`);assert.equal(response.status(),404,route);assert.equal(await page.locator('form[action]').count(),0);
      }
    });
    const routes=[['overview','/dashboard'],['work','/dashboard?view=work'],['history','/dashboard/history'],['workflows-alias','/dashboard/workflows'],['needs-you','/dashboard/needs-you'],['library','/dashboard?view=library'],['research','/dashboard?view=research'],['activity','/dashboard?view=activity'],['connections','/dashboard?view=connections'],['products','/dashboard/products'],['artifacts','/dashboard/artifacts'],['packs','/dashboard/packs'],['model-router','/dashboard/model-router'],['worker-proof','/dashboard/worker-proof'],['evaluations','/dashboard/worker-evaluations'],['settings','/dashboard/settings'],['diagnostics','/dashboard/accounts?diagnostics=platform'],['printful','/dashboard/printful'],['etsy','/dashboard/etsy'],['workflow','/dashboard/workflows/'+id(1001)],['secure','/dashboard/accounts/secure?run='+id(770000)],['password','/dashboard/accounts/password?account='+id(770000)],['registration','/dashboard/accounts/registration?run='+id(770000)]];
    for(const [name,route]of routes)await check(`actual retained route ${name}`,async()=>{
      for(const [width,height]of [[1280,720],[1440,900],[390,844],[320,800],[640,360]]){
        await page.setViewportSize({width,height});const url=new URL(route,origin);url.searchParams.set('business',business);await page.goto(url.href);await page.locator('body').waitFor();if(name==='workflow')await page.locator(`[data-work-detail="${id(1001)}"]`).waitFor();
        await page.screenshot({path:path.join(output,`${name}-${width}x${height}.png`),fullPage:true,mask:[page.locator('[data-private=true]')],maskColor:'#142b3b'});
        assert.equal(await page.getByText('Application error',{exact:false}).count(),0);
        const metrics=await page.evaluate(()=>({width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,innerWidth,innerHeight}));
        assert.ok(metrics.width<=width+1,`Horizontal overflow ${JSON.stringify(metrics)}`);
        if(width>=1280)assert.ok(metrics.height<=height+1,`Document viewport overflow ${JSON.stringify(metrics)}`);

        if(width===390){
          const targets=await page.locator('.consoleRetained button:not(:disabled),.consoleRetained a,.consoleRetained summary,.consoleRetained select,.consoleRetained input:not([type=checkbox]):not([type=radio]):not([type=hidden])').evaluateAll(nodes=>nodes.filter(node=>{const b=node.getBoundingClientRect();return b.width>0&&b.height>0&&(b.width<43.5||b.height<43.5);}).map(node=>({text:node.textContent?.slice(0,60),name:node.getAttribute('name'),w:node.getBoundingClientRect().width,h:node.getBoundingClientRect().height})));
          assert.deepEqual(targets,[],name+' actual primary touch targets');
        }
        if(width===640)results.push({name:`${name} 200 percent desktop reflow equivalent`,status:'passed',viewport:'640x360 CSS pixels corresponds to 1280x720 at 200 percent zoom'});
      }
    });
    const toolSections=[['products',['recovery','candidates','new','capabilities']],['artifacts',['production','technical','gallery','scope']],['packs',['installed','qualification']],['model-router',['routes','models','launch']],['worker-proof',['launch']],['worker-evaluations',['suite','promotions']],['settings',['businesses','boundaries']],['accounts',['requests','etsy','printful']],['printful',['calculator','catalog','connection','qualification']],['etsy',['drafts','publication']],['workflows/'+id(1001),['stages','tasks','workers','outputs','products','browser','activity']]];
    for(const [route,panels]of toolSections)for(const panel of panels)await check(`retained section ${route} ${panel} uses real Next navigation`,async()=>{
      for(const [width,height]of [[1280,720],[390,844]]){
        await page.setViewportSize({width,height});const query=new URLSearchParams({business,panel});if(route==='accounts')query.set('diagnostics','platform');
        await page.goto(origin+`/dashboard/${route}?${query}`);
        const nav=page.getByRole('navigation',{name:'Tool sections'}),active=nav.locator(`[aria-current=page][href*="panel=${panel}"]`);await nav.waitFor();await active.waitFor();await page.locator('[data-retained-active=true]').waitFor();
        assert.ok(await active.count(),'Requested section is missing');assert.equal(new URL(await active.getAttribute('href'),origin).searchParams.get('panel'),panel,'Unknown section silently fell back');
        if(width===390){
          const small=await page.locator('[data-retained-active=true] a,[data-retained-active=true] summary,[data-retained-active=true] button:not(:disabled)').evaluateAll(nodes=>nodes.filter(node=>{const b=node.getBoundingClientRect();return b.width>0&&b.height>0&&(b.width<43.5||b.height<43.5);}).map(node=>({text:node.textContent?.slice(0,80),width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height})));
          assert.deepEqual(small,[],route+' '+panel+' mobile touch areas');
        }
        if(route==='packs'&&panel==='qualification')await page.getByRole('heading',{name:'No qualification tools in the loaded catalog',exact:true}).waitFor();
        if(route==='settings'&&panel==='businesses'){
          const buttons=await page.locator('.consoleBusinessActions a').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().width));assert.ok(buttons.length>0&&buttons.every(width=>width>=109),'Business row actions must stay readable');
        }
        await page.screenshot({path:path.join(output,`section-${route.replaceAll('/','-')}-${panel}-${width}x${height}.png`),fullPage:true,mask:[page.locator('[data-private=true]')],maskColor:'#142b3b'});
        const metrics=await page.evaluate(()=>({w:document.documentElement.scrollWidth,h:document.documentElement.scrollHeight}));assert.ok(metrics.w<=width+1);if(width>=1280)assert.ok(metrics.h<=height+1);
        // Click a distinct real Link and use native Back to return to this exact section.
        const other=nav.locator('a:not([aria-current=page])').first();const nextPanel=new URL(await other.getAttribute('href'),origin).searchParams.get('panel');
        await other.click();await page.waitForURL(url=>url.searchParams.get('panel')===nextPanel);await nav.locator(`[aria-current=page][href*="panel=${nextPanel}"]`).waitFor();
        await page.goBack();await page.waitForURL(url=>url.searchParams.get('panel')===panel);await active.waitFor();
        await page.goForward();await page.waitForURL(url=>url.searchParams.get('panel')===nextPanel);await nav.locator(`[aria-current=page][href*="panel=${nextPanel}"]`).waitFor();
        await page.goBack();await page.waitForURL(url=>url.searchParams.get('panel')===panel);await active.waitFor();await page.reload();await active.waitFor();
        await page.keyboard.press('Tab');const focus=await page.evaluate(()=>{const node=document.activeElement,style=getComputedStyle(node);return {tag:node.tagName,visible:node.matches(':focus-visible'),outline:parseFloat(style.outlineWidth)};});
        assert.notEqual(focus.tag,'BODY');assert.ok(focus.visible&&focus.outline>=2,'Visible keyboard focus');
      }
    });
    await check('retained loaded-window paging keeps reading position through Back and reload',async()=>{
      await page.setViewportSize({width:1280,height:720});await page.goto(origin+`/dashboard/products?business=${business}&panel=candidates`);
      const viewer=page.locator('.productCandidate').first();await viewer.locator(':scope > summary').click();
      const body=page.locator('[data-retained-active=true]');await body.evaluate(node=>{node.scrollTop=180;node.dispatchEvent(new Event('scroll'));});const scroll=await body.evaluate(node=>node.scrollTop);assert.ok(scroll>0);
      await page.getByRole('link',{name:'New candidate',exact:true}).click();await page.waitForURL(/panel=new/);await page.goBack();await page.waitForURL(/panel=candidates/);
      assert.ok(Math.abs((await body.evaluate(node=>node.scrollTop))-scroll)<=2,'Reading position after Back');await page.reload();assert.ok(Math.abs((await body.evaluate(node=>node.scrollTop))-scroll)<=2,'Reading position after reload');assert.equal(await viewer.evaluate(node=>node.open),true,'Exact disclosure survives reload');
    });
    for(const mode of ['empty','unavailable'])await check(`actual retained ${mode} reads remain explicit and inert`,async()=>{
      await context.addCookies([{name:'r03-mode',value:mode,url:origin}]);
      try {for(const route of ['products','artifacts','packs','model-router','worker-proof','worker-evaluations','settings']){
        await page.setViewportSize({width:1280,height:720});await page.goto(origin+`/dashboard/${route}`);
        await page.screenshot({path:path.join(output,`${route}-${mode}-1280x720.png`),fullPage:true,mask:[page.locator('[data-private=true]')],maskColor:'#142b3b'});
        assert.equal(await page.getByText('Application error',{exact:false}).count(),0);
        if(mode==='unavailable'){
          assert.match(await page.locator('main').innerText(),/unavailable|could not|cannot be loaded|couldn.t be loaded|unknown/i,route);
          if(route==='settings'){
            assert.equal(await page.getByRole('navigation',{name:'Tool sections'}).getByRole('link',{name:'Profile',exact:true}).getAttribute('aria-current'),'page');
            await page.getByRole('alert').filter({hasText:'Business directory unavailable'}).waitFor({state:'visible'});
          }
        }
      }}finally{await context.clearCookies({name:'r03-mode'});}
    });
    await check('actual Chromium 200 percent browser zoom reflows all retained routes',async()=>{
      const zoom=await actualZoomBrowser();
      try {
        await zoom.context.route('**/*',route=>{const u=new URL(route.request().url());if(['http:','https:'].includes(u.protocol)&&u.origin!==origin){external.push(u.origin);return route.abort('blockedbyclient');}return route.continue();});
        const zoomPage=await zoom.context.newPage();
        for(const [name,route]of routes){
          const url=new URL(route,origin);url.searchParams.set('business',business);await zoomPage.goto(url.href);if(name==='workflow')await zoomPage.locator(`[data-work-detail="${id(1001)}"]`).waitFor();
          assert.equal(await zoom.set(zoomPage,2),2);await zoomPage.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
          const metrics=await zoomPage.evaluate(()=>({w:innerWidth,h:innerHeight,scrollWidth:document.documentElement.scrollWidth}));
          await zoomPage.screenshot({path:path.join(output,`${name}-zoom200.png`),mask:[zoomPage.locator('[data-private=true]')],maskColor:'#142b3b'});
          assert.ok(metrics.w>=630&&metrics.w<=650,`Actual browser zoom did not halve CSS viewport: ${JSON.stringify(metrics)}`);
          assert.ok(metrics.scrollWidth<=metrics.w+1,`${name} actual 200 percent horizontal overflow: ${JSON.stringify(metrics)}`);
          await zoomPage.keyboard.press('Tab');
          const focus=await zoomPage.evaluate(()=>{const node=document.activeElement,style=getComputedStyle(node);return {tag:node.tagName,visible:node.matches(':focus-visible'),outline:parseFloat(style.outlineWidth)};});
          assert.notEqual(focus.tag,'BODY',name+' keyboard focus');assert.ok(focus.visible&&focus.outline>=2,name+' visible keyboard focus');
          results.push({name:`${name} actual browser zoom 200 percent`,status:'passed',metrics});
          await zoom.set(zoomPage,1);
        }
        await zoom.context.addCookies([{name:'r03-session',value:'off',url:origin}]);
        for(const [name,route]of [['login','/login?error=session-required'],['auth-error','/auth/error']]){
          await zoomPage.goto(origin+route);assert.equal(await zoom.set(zoomPage,2),2);await zoomPage.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
          const metrics=await zoomPage.evaluate(()=>({w:innerWidth,h:innerHeight,scrollWidth:document.documentElement.scrollWidth}));assert.ok(metrics.w>=630&&metrics.w<=650);assert.ok(metrics.scrollWidth<=metrics.w+1);
          await zoomPage.screenshot({path:path.join(output,`${name}-zoom200.png`)});results.push({name:`${name} actual browser zoom 200 percent`,status:'passed',metrics});await zoom.set(zoomPage,1);
        }
      }finally{await zoom.close();}
    });
    await check('signed-out root and private entry recovery remain readable and do not expose records',async()=>{
      const signedOut=await browser.newContext({reducedMotion:'reduce'});
      await signedOut.addCookies([{name:'r03-session',value:'off',url:origin}]);
      const entry=await signedOut.newPage();await entry.goto(origin+'/');await entry.waitForURL(/\/login/);await entry.getByRole('heading',{name:'Sign in',exact:true}).waitFor();
      for(const [name,route]of [['login','/login?error=session-required'],['auth-error','/auth/error?error=untrusted-private-message']])for(const [width,height]of [[1280,720],[1440,900],[390,844],[320,800],[640,360]]){
        await entry.setViewportSize({width,height});await entry.goto(origin+route);
        assert.equal(await entry.getByText('untrusted-private-message',{exact:false}).count(),0);
        await entry.screenshot({path:path.join(output,`${name}-${width}x${height}.png`),fullPage:true});
        const metrics=await entry.evaluate(()=>({w:document.documentElement.scrollWidth,h:document.documentElement.scrollHeight}));assert.ok(metrics.w<=width+1);if(width>=1280)assert.ok(metrics.h<=height+1);
        await entry.screenshot({path:path.join(output,`${name}-${width}x${height}.png`),fullPage:true});
      }
      const destination=`/dashboard/workflows/${id(1001)}?business=${business}&panel=tasks&task=${id(21000)}&recentPage=2`;
      await signedOut.setExtraHTTPHeaders({'x-agent-labs-return-path':'/dashboard?business=untrusted-header'});
      await entry.goto(origin+destination);await entry.waitForURL(/\/login/);assert.equal(await entry.locator('[data-record-id]').count(),0);
      assert.equal(new URL(entry.url()).searchParams.get('returnTo'),destination,'Private entry must retain the actual request, not a supplied header');
      assert.equal(await entry.locator('input[name=returnTo]').inputValue(),destination);
      // Submit an empty invalid form only. No credential reaches the denied auth transport.
      await entry.locator('form').evaluate(form=>{form.noValidate=true;form.requestSubmit();});
      await entry.waitForURL(/error=invalid-fields/);assert.equal(new URL(entry.url()).searchParams.get('returnTo'),destination);
      await entry.getByRole('alert').filter({hasText:'Enter a valid email and password.'}).waitFor();
      await entry.reload();assert.equal(await entry.locator('input[name=returnTo]').inputValue(),destination);
      const recovery=entry.url();await signedOut.addCookies([{name:'r03-session',value:'on',url:origin}]);
      await entry.goto(recovery);await entry.waitForURL(url=>url.pathname+url.search===destination);
      await entry.locator('[aria-current=page][href*="panel=tasks"]').waitFor();
      await entry.getByRole('heading',{name:`Exact saved task · ${id(21000)}`,exact:true}).waitFor();
      await signedOut.close();
    });
    assert.deepEqual(external,[],'Browser attempted external effects');
    assert.equal(boundary.effects.length,effectCount,'Route reads caused an additional mutable effect');
    await writeFile(path.join(output,'action-responses.json'),JSON.stringify(actions,null,2));
    await writeFile(path.join(output,'rsc-responses.json'),JSON.stringify(requests,null,2));assert.ok(results.every(result=>result.status==='passed'), 'Actual Next checks failed; see acceptance.json');await context.close();
  }finally{await browser.close();await report();}
}
