import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { id } from './data.mjs';

export async function runNextJourneys({origin,boundary,output,httpOnly=false}) {
  const results=[];
  const report=()=>writeFile(path.join(output,'acceptance.json'),JSON.stringify({results,browser:httpOnly?'unrun':'actual Chromium against production Next'},null,2));
  const check=async(name,fn)=>{try{await fn();results.push({name,status:'passed'});}catch(error){results.push({name,status:'failed',error:String(error.stack)});await report();}finally{await fetch(boundary.origin+'/control',{method:'POST',body:JSON.stringify({delayId:null,delayMs:0,failTable:null,actionMode:'success'})});}};
  await check('real Next History redirect selects ended outcomes',async()=>{
    const response=await fetch(origin+`/dashboard/history?business=${id(1)}`,{redirect:'manual'});
    assert.equal(response.status,307);assert.match(response.headers.get('location'),/view=work/);assert.match(response.headers.get('location'),/status=ended/);
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
    const page=await context.newPage(), requests=[], external=[];
    await context.route('**/*',route=>{const u=new URL(route.request().url());if(['http:','https:'].includes(u.protocol)&&u.origin!==origin){external.push(u.origin);return route.abort('blockedbyclient');}return route.continue();});
    page.on('response',r=>{if(r.headers()['content-type']?.includes('text/x-component'))requests.push({url:r.url(),status:r.status()});});
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
      await page.reload();await page.getByRole('heading',{name:saved.concept,exact:true}).waitFor();
      await page.goto(target);await page.locator('input[name=concept]').fill('New uncertain inert draft');await page.locator('input[name=audience]').fill('Synthetic weekend hikers');await page.locator('textarea[name=hypothesis]').fill('A separate valid synthetic hypothesis for an uncertain server outcome.');await page.locator('input[name=sourceDomains]').fill('example.invalid');await page.locator('input[name=originalDesign]').check();
      await control({actionMode:'uncertain'});await page.getByRole('button',{name:'Save candidate',exact:true}).click();await page.waitForURL(/error=candidate-outcome-unconfirmed/);
      assert.equal(await page.locator('input[name=concept]').inputValue(),'New uncertain inert draft');
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
      await page.reload();await page.getByText('Stopped · reviewed',{exact:true}).waitFor();
      const request=boundary.state().db.owner_interventions.find(n=>n.intervention_type==='creative_review'&&n.status==='open');
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
    const effectCount=boundary.effects.length;
    await check('workflow server error boundary reloads the same exact owned record without a new effect',async()=>{
      await control({failTable:'workflow_runs'});await page.goto(origin+`/dashboard/workflows/${id(1001)}?business=${business}`);
      await page.getByRole('heading',{name:'This work could not be loaded',exact:true}).waitFor();
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
        await page.setViewportSize({width,height});const url=new URL(route,origin);url.searchParams.set('business',business);await page.goto(url.href);await page.locator('body').waitFor();
        await page.screenshot({path:path.join(output,`${name}-${width}x${height}.png`),fullPage:true,mask:[page.locator('[data-private=true]')]});
        assert.equal(await page.getByText('Application error',{exact:false}).count(),0);
        const metrics=await page.evaluate(()=>({width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,innerWidth,innerHeight}));
        assert.ok(metrics.width<=width+1,`Horizontal overflow ${JSON.stringify(metrics)}`);
        if(width>=1280)assert.ok(metrics.height<=height+1,`Document viewport overflow ${JSON.stringify(metrics)}`);

        if(width===640)results.push({name:`${name} 200 percent desktop reflow equivalent`,status:'passed',viewport:'640x360 CSS pixels corresponds to 1280x720 at 200 percent zoom'});
      }
    });
    await check('signed-out root and private entry recovery remain readable and do not expose records',async()=>{
      const signedOut=await browser.newContext({reducedMotion:'reduce'});
      await signedOut.addCookies([{name:'r03-session',value:'off',url:origin}]);
      const entry=await signedOut.newPage();await entry.goto(origin+'/');await entry.waitForURL(/\/login/);await entry.getByRole('heading',{name:'Sign in',exact:true}).waitFor();
      for(const [name,route]of [['login','/login?error=session-required'],['auth-error','/auth/error?error=untrusted-private-message']])for(const [width,height]of [[1280,720],[1440,900],[390,844],[320,800],[640,360]]){
        await entry.setViewportSize({width,height});await entry.goto(origin+route);
        assert.equal(await entry.getByText('untrusted-private-message',{exact:false}).count(),0);
        const metrics=await entry.evaluate(()=>({w:document.documentElement.scrollWidth,h:document.documentElement.scrollHeight}));assert.ok(metrics.w<=width+1);if(width>=1280)assert.ok(metrics.h<=height+1);
        await entry.screenshot({path:path.join(output,`${name}-${width}x${height}.png`),fullPage:true});
      }
      await entry.goto(origin+`/dashboard/products?business=${business}`);await entry.waitForURL(/\/login/);assert.equal(await entry.locator('[data-record-id]').count(),0);await signedOut.close();
    });
    assert.deepEqual(external,[],'Browser attempted external effects');
    assert.equal(boundary.effects.length,effectCount,'Route reads caused an additional mutable effect');
    await writeFile(path.join(output,'rsc-responses.json'),JSON.stringify(requests,null,2));assert.ok(results.every(result=>result.status==='passed'), 'Actual Next checks failed; see acceptance.json');await context.close();
  }finally{await browser.close();await report();}
}
