import assert from 'node:assert/strict';
import path from 'node:path';
import {id} from './data.mjs';
import {viewerRoute,viewerEndpoint} from './r10-http.mjs';
import {r10Scope} from './r10.mjs';
import {actualZoomBrowser} from './browser-zoom.mjs';
import {setFixtureBrowserTimeouts} from './async-bounds.mjs';

/** Production Next pages, client, routes and streaming runtime. Only the boundary
 * dependency factory supplies inert authority and synthetic JPEG bytes. */
export async function runViewerJourneys({page,context,origin,boundary,output,check}){
 setFixtureBrowserTimeouts(context);
 const control=values=>fetch(boundary.origin+'/control',{method:'POST',body:JSON.stringify(values),signal:AbortSignal.timeout(10_000)});
 const reset=async values=>{await page.goto(origin+'/dashboard?view=overview');await control({workspace:true,viewer:true,resetViewer:true,viewerCloseUnconfirmed:false,viewerCorruptFrame:false,viewerPermitDenied:false,...values});await page.goto(origin+viewerRoute());await page.getByRole('button',{name:'Watch',exact:true}).waitFor();};
 const frames=()=>page.locator('.consoleBrowserWatch canvas[data-frame-sequence]');
 const cleared=async()=>{assert.equal(await frames().count(),0);assert.equal(await page.locator('.consoleBrowserWatch canvas').evaluate(canvas=>canvas.width===0&&canvas.height===0&&canvas.hidden),true);};
 const stop=async()=>{await page.getByRole('button',{name:'Stop watching',exact:true}).click();await page.getByText('Stopped · server confirmed',{exact:true}).waitFor();await cleared();};
 const watchRequests=[];page.on('request',request=>{if(request.url()===origin+viewerEndpoint&&request.method()==='POST')watchRequests.push(request);});
 await check('R10 explicit Watch paints actual streamed JPEG; repeated click starts only one bounded source',async()=>{
  await reset();const before=watchRequests.length;assert.equal(await frames().count(),0);
  await page.getByRole('button',{name:'Watch',exact:true}).evaluate(button=>{button.click();button.click();});
  await frames().waitFor({state:'visible'});assert.equal(watchRequests.length,before+1);
  const pixels=await frames().evaluate(canvas=>({w:canvas.width,h:canvas.height,p:[...canvas.getContext('2d').getImageData(50,50,1,1).data]}));assert.equal(pixels.w,960);assert.equal(pixels.h,540);assert.ok(pixels.p[3]>0);
  const request=watchRequests.at(-1);assert.deepEqual(request.postDataJSON(),{businessId:r10Scope.businessId,questId:r10Scope.questId,workflowRunId:r10Scope.workflowRunId});
  assert.match(await page.locator('.consoleBrowserWatch').innerText(),/Captured/);assert.equal(await page.locator('iframe,video,object,embed').count(),0);
  await stop();assert.equal(await page.getByRole('button',{name:'Watch',exact:true}).count(),0);
  await page.reload();assert.equal(await page.getByRole('button',{name:'Watch',exact:true}).count(),0);await cleared();
 });
 await check('R10 navigation and Back/Forward never resurrect pixels or restart a consumed watch',async()=>{
  await reset();await page.getByRole('button',{name:'Watch',exact:true}).click();await frames().waitFor({state:'visible'});const count=watchRequests.length;
  await page.getByRole('link',{name:'Overview',exact:true}).click();await page.locator('.consoleCoreVisual').waitFor();assert.equal(await page.locator('.consoleBrowserWatch').count(),0);
  await page.goBack();await page.locator('.consoleBrowserContent').waitFor();assert.equal(await frames().count(),0);assert.equal(watchRequests.length,count);
  await page.goForward();await page.locator('.consoleCoreVisual').waitFor();await page.reload();assert.equal(watchRequests.length,count);
 });
 await check('R10 revocation failure clears pixels immediately and never claims a confirmed stop',async()=>{
  await reset({viewerCloseUnconfirmed:true});await page.getByRole('button',{name:'Watch',exact:true}).click();await frames().waitFor({state:'visible'});
  await page.getByRole('button',{name:'Stop watching',exact:true}).click();await page.getByText('Stopping · server confirmation pending',{exact:true}).waitFor();await cleared();
  await page.getByText('Pixels are cleared. Server stop is not yet confirmed.',{exact:true}).waitFor();assert.equal(await page.getByText('Stopped · server confirmed',{exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Watch',exact:true}).count(),0);
 });
 await check('R10 expiry and invalid decoded JPEG clear the canvas without reconnect',async()=>{
  await reset({viewerExpiresInMs:8_000});await page.getByRole('button',{name:'Watch',exact:true}).click();await frames().waitFor({state:'visible'});const count=watchRequests.length;
  await page.waitForFunction(()=>document.querySelector('.consoleBrowserWatch canvas')?.width===0);await cleared();assert.equal(watchRequests.length,count);
  await reset({viewerCorruptFrame:true});const before=watchRequests.length;await page.getByRole('button',{name:'Watch',exact:true}).click();await page.getByText(/frame stream could not be verified/).waitFor();await cleared();assert.equal(watchRequests.length,before+1);
 });
 await check('R10 hydrated client rejects adversarial replayed, stale and oversized NDJSON without retaining pixels',async()=>{
  await control({viewerCorruptFrame:false});
  const jpeg=Buffer.from(await (await fetch(boundary.origin+'/r10/capture',{method:'POST',signal:AbortSignal.timeout(10_000)})).arrayBuffer()).toString('base64');
  for(const kind of ['replay','stale','oversized']){
   await reset();const before=watchRequests.length;
   const handler=async route=>{
    const frame={type:'frame',epoch:1,sequence:1,capturedAt:new Date().toISOString(),mime:'image/jpeg',data:jpeg};
    const bad=kind==='replay'?{...frame}:kind==='stale'?{...frame,sequence:2,capturedAt:new Date(Date.now()-10_000).toISOString()}:{...frame,sequence:2,data:'/9j/'+ 'A'.repeat(205_000)};
    await route.fulfill({status:200,contentType:'application/x-ndjson',headers:{'cache-control':'no-store'},body:JSON.stringify(frame)+'\n'+JSON.stringify(bad)+'\n'});
   };
   await page.route(origin+viewerEndpoint,handler);
   try{await page.getByRole('button',{name:'Watch',exact:true}).click();await page.getByText(/frame stream could not be verified/).waitFor();await cleared();assert.equal(watchRequests.length,before+1);}
   finally{await page.unroute(origin+viewerEndpoint,handler);}
  }
 });
 await check('R10 hidden-page event clears and revokes without reconnect; legacy Browser remains metadata only',async()=>{
  await reset();await page.getByRole('button',{name:'Watch',exact:true}).click();await frames().waitFor({state:'visible'});const count=watchRequests.length;
  // Dispatch the actual page lifecycle event; no browser input/provider action is synthesized.
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));await page.getByText('Stopped · server confirmed',{exact:true}).waitFor();await cleared();assert.equal(watchRequests.length,count);
  const legacy=boundary.state().db.browser_sessions.find(session=>session.business_id===id(1));assert.ok(legacy);
  await page.goto(origin+viewerRoute({browserRun:legacy.workflow_run_id}));await page.getByText('Live viewing unavailable for this session',{exact:true}).waitFor();assert.equal(await page.locator('.consoleBrowserWatch').count(),0);
 });
 await check('R10 live centre fits both desktops and reflows with accessible frame status and controls',async()=>{
  for(const [width,height]of [[1280,720],[1440,900],[390,844],[320,800],[640,360]]){
   await page.setViewportSize({width,height});await reset();await page.getByRole('button',{name:'Watch',exact:true}).click();await frames().waitFor({state:'visible'});
   const metrics=await page.evaluate(()=>({w:document.documentElement.scrollWidth,h:document.documentElement.scrollHeight}));assert.ok(metrics.w<=width+1,JSON.stringify({width,metrics}));if(width>=1280)assert.ok(metrics.h<=height+1,JSON.stringify({height,metrics}));
   const box=await page.locator('.consoleBrowserWatch').boundingBox(),core=await page.locator('[data-console-panel=core]').boundingBox();assert.ok(box.y+box.height<=core.y+core.height+1);
   const controls=await page.locator('.consoleBrowserWatch button,.consoleCentreTabs a').evaluateAll(elements=>elements.map(e=>({height:e.getBoundingClientRect().height,font:parseFloat(getComputedStyle(e).fontSize)})));assert.ok(controls.every(c=>c.height>=(width>900?24:44)&&c.font>=12));
   await page.screenshot({path:path.join(output,`r10-live-watch-${width}x${height}.png`),fullPage:true});await stop();
  }
 });
 await check('R10 actual 200 percent browser zoom preserves the bounded public viewer',async()=>{
  await control({resetViewer:true});const zoom=await actualZoomBrowser();try{
   await zoom.context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());const p=await zoom.context.newPage();await p.goto(origin+viewerRoute());assert.equal(await zoom.set(p,2),2);
   await p.getByRole('button',{name:'Watch',exact:true}).click();await p.locator('.consoleBrowserWatch canvas[data-frame-sequence]').waitFor({state:'visible'});
   const m=await p.evaluate(()=>({width:document.documentElement.scrollWidth,innerWidth}));assert.ok(m.width<=m.innerWidth+1);await p.screenshot({path:path.join(output,'r10-live-watch-zoom200.png'),fullPage:true});await p.getByRole('button',{name:'Stop watching',exact:true}).click();await p.getByText('Stopped · server confirmed',{exact:true}).waitFor();
  }finally{await zoom.close();}
 });
 await page.setViewportSize({width:1280,height:720});
}
