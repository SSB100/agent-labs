import assert from 'node:assert/strict';
import path from 'node:path';
import { id } from './data.mjs';
import { questIntent } from './quests.mjs';
import { actualZoomBrowser } from './browser-zoom.mjs';

export async function runQuestJourneys({page,context,origin,boundary,output,check,requests,actions,zoomOnly=false}) {
  const business=id(1),quest=id(820000),base=`/dashboard/quests?business=${business}`,exact=`${base}&quest=${quest}`;
  const selected=()=>page.getByRole('heading',{name:'Exact original Quest outside the newest page · version 2',exact:true});
  const control=values=>fetch(boundary.origin+'/control',{method:'POST',body:JSON.stringify(values)});
  const initialEffects=boundary.effects.length;
  await check('R04 actual Next Settings Link reaches exact Business and old off-page Quest',async()=>{
    await page.goto(origin+`/dashboard/settings?business=${business}&panel=businesses`);
    const before=requests.length;
    await page.getByRole('link',{name:'Business rules & Quests',exact:true}).click();
    await page.waitForURL(url=>url.pathname==='/dashboard/quests'&&url.searchParams.get('business')===business);
    await page.getByRole('heading',{name:'Saved Quests',exact:true}).waitFor();
    assert.ok(requests.length>before,'Quest Link must use genuine Next RSC');
    await page.goto(origin+exact);await selected().waitFor();
    assert.equal(await page.locator('#quest-list').locator('..').getByRole('link',{name:'Exact original Quest outside the newest page',exact:true}).count(),0,'Exact selected Quest must be outside list page');
    assert.match(await page.locator('.questWorkspace').innerText(),/127 saved/);
    await page.getByRole('link',{name:'Next Quests',exact:true}).click();await page.waitForURL(url=>url.searchParams.get('offset')==='20');await selected().waitFor();
    assert.equal(new URL(page.url()).searchParams.get('quest'),quest);
    await page.goBack();await page.waitForURL(url=>!url.searchParams.has('offset'));await selected().waitFor();
    await page.goForward();await page.waitForURL(url=>url.searchParams.get('offset')==='20');await selected().waitFor();await page.reload();await selected().waitFor();
  });
  await check('R04 exact missing and same-owner foreign Business Quest never substitute',async()=>{
    for(const selection of [id(821000),id(899999)]){
      await page.goto(origin+base+'&quest='+selection);
      await page.getByRole('alert').filter({hasText:'This exact Business or Quest is unavailable'}).waitFor();
      assert.equal(await page.locator('.questWorkspace').count(),0);
    }
    const response=await page.goto(origin+`/dashboard/quests?business=${id(999999)}`);assert.equal(response.status(),404);
  });
  await check('R04 empty and unavailable reads stay explicit with no effects',async()=>{
    for(const mode of ['empty','unavailable']){
      await context.addCookies([{name:'r03-mode',value:mode,url:origin}]);
      try {
        await page.goto(origin+base);
        if(mode==='empty'){await page.getByRole('heading',{name:'Create a Quest',exact:true}).waitFor();assert.match(await page.locator('.questWorkspace').innerText(),/0 saved/);}
        else await page.getByRole('alert').filter({hasText:'This exact Business or Quest is unavailable'}).waitFor();
      }finally{await context.clearCookies({name:'r03-mode'});}
    }
    assert.equal(boundary.effects.length,initialEffects);
  });
  for(const [width,height] of [[1280,720],[1440,900],[390,844],[320,800],[640,360]])await check(`R04 actual Quest route geometry and reachable controls ${width}x${height}`,async()=>{
    await page.setViewportSize({width,height});await page.goto(origin+exact);await selected().waitFor();
    await page.getByText('Business rules · version 1 · setup',{exact:true}).click();
    await page.getByText('Draft the complete operating envelope',{exact:true}).click();
    const metrics=await page.evaluate(()=>({width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,clientWidth:document.documentElement.clientWidth,clientHeight:document.documentElement.clientHeight}));
    assert.ok(metrics.width<=metrics.clientWidth+1,JSON.stringify(metrics));
    if(width>=1280)assert.ok(metrics.height<=metrics.clientHeight+1,JSON.stringify(metrics));
    for(const name of ['Brand and Business context','Permitted business purposes (one per line)','Your Quest in plain language']){
      const input=page.getByRole('textbox',{name,exact:true});await input.scrollIntoViewIfNeeded();await input.focus();
      assert.equal(await input.evaluate(node=>document.activeElement===node),true,name+' reachable focus');
      const box=await input.boundingBox();assert.ok(box&&box.width>=100&&box.height>=43.5,name+' readable input');
      const focus=await input.evaluate(node=>({visible:node.matches(':focus-visible'),outline:parseFloat(getComputedStyle(node).outlineWidth)}));assert.ok(focus.visible&&focus.outline>=2,name+' visible focus');
    }
    if(width<=390){
      const small=await page.locator('.questWorkspace button:not(:disabled),.questWorkspace summary,.questWorkspace a,.questWorkspace input:not([type=checkbox]),.questWorkspace textarea').evaluateAll(nodes=>nodes.filter(node=>{const r=node.getBoundingClientRect();return r.width&&r.height&&(r.width<43.5||r.height<43.5);}).map(node=>({text:node.textContent?.slice(0,50),w:node.getBoundingClientRect().width,h:node.getBoundingClientRect().height})));
      assert.deepEqual(small,[],'Quest mobile touch controls');
    }
    await page.getByRole('textbox',{name:'Your Quest in plain language'}).fill(questIntent);
    await page.getByRole('checkbox',{name:/I reviewed the extracted facts/}).check();
    await page.getByRole('button',{name:'Save Quest draft',exact:true}).scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(output,`quests-entry-${width}x${height}.png`)});
    await selected().scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(output,`quests-${width}x${height}.png`)});
    assert.equal(boundary.effects.length,initialEffects,'Viewport/focus/form editing must not submit');
  });
  await check('R04 real server action rejects credential text and saves one exact inert Quest',async()=>{
    await page.goto(origin+base);await page.getByRole('heading',{name:'Create a Quest',exact:true}).waitFor();
    await page.getByRole('textbox',{name:'Quest title',exact:true}).fill('Quest saved by the real Next server action');
    const text=page.getByRole('textbox',{name:'Your Quest in plain language',exact:true});
    await text.fill(questIntent);await text.fill('password\nsynthetic-must-not-leave-browser');
    assert.equal(await text.inputValue(),questIntent);
    assert.equal(boundary.effects.length,initialEffects);
    await page.getByRole('checkbox',{name:/I reviewed the extracted facts/}).check();
    await control({actionMode:'conflict'});
    await page.getByRole('button',{name:'Save Quest draft',exact:true}).click();
    await page.getByRole('status').filter({hasText:'The save could not be verified'}).waitFor();
    assert.equal(await text.inputValue(),questIntent);assert.equal(boundary.effects.length,initialEffects);
    await control({actionMode:'success'});
    await page.getByRole('button',{name:'Save Quest draft',exact:true}).click();
    await page.waitForURL(url=>url.searchParams.has('quest'));
    const saved=boundary.effects.filter(effect=>effect.kind==='in-memory-quest');assert.equal(saved.length,1);
    assert.equal(new URL(page.url()).searchParams.get('business'),business);assert.equal(new URL(page.url()).searchParams.get('quest'),saved[0].id);
    await page.getByRole('heading',{name:'Quest saved by the real Next server action · version 1',exact:true}).waitFor();await page.reload();
    await page.getByRole('heading',{name:'Quest saved by the real Next server action · version 1',exact:true}).waitFor();
    assert.ok(actions.some(action=>new URL(action.url).pathname==='/dashboard/quests'&&action.status===200),'No actual Quest Next server action response');
    await page.getByText('Draft the complete operating envelope',{exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'Save proposal for complete review',exact:true}).isDisabled(),true,'New draft has no ready envelope');
  });
  if(zoomOnly)await check('R04 actual browser zoom 200 percent retains readable Quest entry',async()=>{
    const zoom=await actualZoomBrowser();
    try{
      await zoom.context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort('blockedbyclient'));
      const zoomPage=await zoom.context.newPage();await zoomPage.goto(origin+exact);
      assert.equal(await zoom.set(zoomPage,2),2);
      await zoomPage.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const input=zoomPage.getByRole('textbox',{name:'Your Quest in plain language',exact:true});await input.scrollIntoViewIfNeeded();await input.focus();
      const metrics=await zoomPage.evaluate(()=>({w:innerWidth,scrollWidth:document.documentElement.scrollWidth}));assert.ok(metrics.w>=630&&metrics.w<=650);assert.ok(metrics.scrollWidth<=metrics.w+1);
      await input.fill(questIntent);await zoomPage.getByRole('checkbox',{name:/I reviewed the extracted facts/}).check();
      await zoomPage.getByRole('button',{name:'Save Quest draft',exact:true}).scrollIntoViewIfNeeded();
      const saveBox=await zoomPage.getByRole('button',{name:'Save Quest draft',exact:true}).boundingBox();
      assert.ok(saveBox&&saveBox.width>=100&&saveBox.height>=44,'Actual zoom save control remains readable');
      // Use a stable top-viewport capture after testing the lower controls. Native
      // zoom screenshots at deep scroll offsets are unreliable in local headless Edge.
      // Detailed form pixels are separately captured at the 640px reflow viewport.
      await zoomPage.evaluate(()=>{window.scrollTo(0,0);document.querySelector('main').scrollTop=0;return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
      await zoomPage.screenshot({path:path.join(output,'quests-zoom200.png')});
    }finally{await zoom.close();}
  });
}
