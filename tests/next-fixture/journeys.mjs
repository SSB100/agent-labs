import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { id } from './data.mjs';

export async function runNextJourneys({origin,boundary,output,httpOnly=false}) {
  const results=[];
  const report=()=>writeFile(path.join(output,'acceptance.json'),JSON.stringify({results,browser:httpOnly?'unrun':'actual Chromium against production Next'},null,2));
  const check=async(name,fn)=>{try{await fn();results.push({name,status:'passed'});}catch(error){results.push({name,status:'failed',error:String(error.stack)});await report();}};
  await check('real Next History redirect selects ended outcomes',async()=>{
    const response=await fetch(origin+`/dashboard/history?business=${id(1)}`,{redirect:'manual'});
    assert.equal(response.status,307);assert.match(response.headers.get('location'),/view=work/);assert.match(response.headers.get('location'),/status=ended/);
  });
  if(httpOnly){await report();return;}
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
    assert.equal(boundary.effects.length,0,'Route reads must cause no mutable effect');
    const routes=[['overview','/dashboard'],['work','/dashboard?view=work'],['history','/dashboard/history'],['needs-you','/dashboard/needs-you'],['library','/dashboard?view=library'],['research','/dashboard?view=research'],['activity','/dashboard?view=activity'],['connections','/dashboard?view=connections'],['products','/dashboard/products'],['artifacts','/dashboard/artifacts'],['packs','/dashboard/packs'],['model-router','/dashboard/model-router'],['worker-proof','/dashboard/worker-proof'],['evaluations','/dashboard/worker-evaluations'],['settings','/dashboard/settings'],['diagnostics','/dashboard/accounts?diagnostics=platform'],['printful','/dashboard/printful'],['etsy','/dashboard/etsy'],['workflow','/dashboard/workflows/'+id(400050)],['secure','/dashboard/accounts/secure?run='+id(770000)],['password','/dashboard/accounts/password?account='+id(770000)],['registration','/dashboard/accounts/registration?run='+id(770000)]];
    for(const [name,route]of routes)await check(`actual retained route ${name}`,async()=>{
      for(const [width,height]of [[1280,720],[1440,900],[390,844]]){
        await page.setViewportSize({width,height});const url=new URL(route,origin);url.searchParams.set('business',business);await page.goto(url.href);await page.locator('body').waitFor();
        assert.equal(await page.getByText('Application error',{exact:false}).count(),0);
        const metrics=await page.evaluate(()=>({width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,innerWidth,innerHeight}));
        assert.ok(metrics.width<=width+1,`Horizontal overflow ${JSON.stringify(metrics)}`);
        if(width>=1280)assert.ok(metrics.height<=height+1,`Document viewport overflow ${JSON.stringify(metrics)}`);
        await page.screenshot({path:path.join(output,`${name}-${width}x${height}.png`),fullPage:true,mask:page.locator('[data-private=true]')});
      }
    });
    assert.deepEqual(external,[],'Browser attempted external effects');
    await writeFile(path.join(output,'rsc-responses.json'),JSON.stringify(requests,null,2));assert.ok(results.every(result=>result.status==='passed'), 'Actual Next checks failed; see acceptance.json');await context.close();
  }finally{await browser.close();await report();}
}
