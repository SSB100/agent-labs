import assert from 'node:assert/strict';
import path from 'node:path';
import {viewerRoute,viewerEndpoint} from './r10-http.mjs';
import {r10Scope,r10LegacyScopes,r10Lineage} from './r10.mjs';
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
 await check('R10 mixed-Quest legacy metadata keeps live pixels and exact Record, Events, Agent, task and audit provenance',async()=>{
  await reset();
  const picker=page.locator('select[name=browserRun]');assert.equal(await picker.locator(`option[value="${r10LegacyScopes.sameQuest.workflowRunId}"]`).count(),1);assert.equal(await picker.locator(`option[value="${r10LegacyScopes.otherQuest.workflowRunId}"]`).count(),0);
  await page.getByRole('button',{name:'Watch',exact:true}).click();await frames().waitFor({state:'visible'});await stop();
  const record=page.getByRole('link',{name:'Inspect saved workflow record',exact:true}),recordUrl=new URL(await record.getAttribute('href'),origin);
  for(const [key,value]of Object.entries({business:r10Scope.businessId,quest:r10Scope.questId,run:r10Scope.workflowRunId,episode:r10Scope.workflowRunId}))assert.equal(recordUrl.searchParams.get(key),value);
  await record.click();await page.locator(`[data-work-detail="${r10Scope.workflowRunId}"]`).waitFor();
  const recordAudit=new URL(await page.getByRole('link',{name:'Underlying audit activity',exact:true}).getAttribute('href'),origin);assert.equal(recordAudit.searchParams.get('runFilter'),r10Scope.workflowRunId);assert.equal(recordAudit.searchParams.get('quest'),r10Scope.questId);
  await page.goBack();await page.locator('.consoleBrowserContent').waitFor();
  await page.getByRole('navigation',{name:'Centre view'}).getByRole('link',{name:'Overview',exact:true}).click();await page.locator('.consoleCoreVisual').waitFor();
  // Enrollment, claim and physical closure project this same R10 task/worker
  // chain, matching the production migration. No unrelated episode substitutes.
  const tile=page.locator(`.consoleWorkerTile[data-worker-id="${r10Lineage.workerRunId}"]`);await tile.waitFor();
  const workerId=await tile.getAttribute('data-worker-id'),worker=boundary.state().db.worker_runs.find(row=>row.id===workerId),task=boundary.state().db.task_contracts.find(row=>row.id===worker?.task_contract_id);assert.ok(worker&&task);assert.equal(worker.workflow_run_id,r10Scope.workflowRunId);assert.equal(workerId,r10Lineage.workerRunId);assert.equal(task.id,r10Lineage.taskId);assert.equal(worker.status,'completed');assert.equal(worker.output.auditArtifactId,r10Lineage.auditArtifactId);assert.equal(worker.business_id,r10Scope.businessId);assert.equal(task.workflow_run_id,worker.workflow_run_id);assert.equal(task.workflow_stage_run_id,null);
  const episodeUrl=new URL(await tile.getAttribute('href'),origin);assert.equal(episodeUrl.searchParams.get('view'),'work');assert.equal(episodeUrl.searchParams.get('selected'),worker.workflow_run_id);assert.equal(episodeUrl.searchParams.get('episode'),worker.workflow_run_id);assert.equal(episodeUrl.searchParams.get('quest'),r10Scope.questId);
  await tile.click();await page.getByRole('heading',{name:'Events',exact:true}).waitFor();const detail=page.locator(`[data-work-detail="${worker.workflow_run_id}"]`);await detail.waitFor();
  const tasks=detail.locator('details[data-console-disclosure$=":Saved tasks, newest first"]');
  assert.match(await tasks.innerText(),/Saved tasks, newest first · 1 loaded of 1/);await tasks.locator('summary').click();assert.match(await tasks.innerText(),/Render the fixed reviewed public R10 source/);assert.doesNotMatch(await tasks.innerText(),/Total unavailable|Incomplete history/);
  const agents=detail.locator('details[data-console-disclosure$=":Participating Agents (Worker Runs)"]');await agents.locator('summary').click();
  const agentLink=agents.locator(`a[href*="agent=${workerId}"]`),sourceCount=boundary.state().db.worker_runs.filter(row=>row.business_id===r10Scope.businessId&&row.workflow_run_id===worker.workflow_run_id).length;
  for(let workerPage=1;await agentLink.count()===0;workerPage++){
   assert.ok(workerPage<Math.ceil(sourceCount/25),'The exact Overview Worker receipt is missing from its counted episode history');
   await agents.getByRole('link',{name:'Next Agents',exact:true}).click();await page.waitForURL(url=>url.searchParams.get('workerPage')===String(workerPage+1));
   if(!await agents.evaluate(element=>element.open))await agents.locator('summary').click();
  }
  await agentLink.click();await page.getByLabel('Exact Agent output and execution receipts',{exact:true}).waitFor();
  const chain=page.getByLabel('Exact Step and Agent evidence',{exact:true});assert.match(await chain.innerText(),/Run-level task · No stage assigned/);assert.doesNotMatch(await chain.innerText(),/Step outputs/);assert.match(await chain.innerText(),new RegExp('Actual Worker Run '+workerId+' · Task '+task.id));assert.equal(new URL(page.url()).searchParams.get('episode'),worker.workflow_run_id);assert.equal(new URL(page.url()).searchParams.get('quest'),r10Scope.questId);
  const toolsUrl=new URL(await chain.getByRole('link',{name:'Saved worker tools and receipts',exact:true}).getAttribute('href'),origin);assert.equal(toolsUrl.pathname,`/dashboard/workflows/${worker.workflow_run_id}`);assert.equal(toolsUrl.searchParams.get('business'),r10Scope.businessId);assert.equal(toolsUrl.searchParams.get('quest'),r10Scope.questId);assert.equal(toolsUrl.searchParams.get('agent'),workerId);
  const outputs=detail.locator('details[data-console-disclosure$=":Saved output metadata"]');await outputs.locator('summary').click();const auditArtifact=outputs.getByRole('link',{name:'Controlled public viewer closure audit',exact:true});const auditArtifactUrl=new URL(await auditArtifact.getAttribute('href'),origin);assert.equal(auditArtifactUrl.searchParams.get('artifact'),r10Lineage.auditArtifactId);assert.equal(auditArtifactUrl.searchParams.get('selected'),r10Scope.workflowRunId);assert.equal(auditArtifactUrl.searchParams.get('quest'),r10Scope.questId);
  await page.getByRole('link',{name:'Underlying audit activity',exact:true}).click();await page.getByRole('heading',{name:'Recorded activity',exact:true}).waitFor();const auditUrl=new URL(page.url());assert.equal(auditUrl.searchParams.get('runFilter'),worker.workflow_run_id);assert.equal(auditUrl.searchParams.get('quest'),r10Scope.questId);
  await page.locator(`.consoleCollectionRow[data-record-id="${r10Lineage.eventId}"]`).waitFor();
  const audited=await page.locator('.consoleCollectionRow .consoleCollectionIdentity[title^="Run "]').evaluateAll(elements=>elements.map(element=>element.title));assert.ok(audited.length>0);assert.ok(audited.every(title=>title===`Run ${worker.workflow_run_id}`));assert.match(await page.locator(`.consoleCollectionRow[data-record-id="${r10Lineage.eventId}"]`).innerText(),/r10.viewer.closed/);
  await page.goBack();await page.getByLabel('Exact Agent output and execution receipts',{exact:true}).waitFor();await page.reload();await page.getByLabel('Exact Agent output and execution receipts',{exact:true}).waitFor();assert.equal(new URL(page.url()).searchParams.get('agent'),workerId);
 });
 await check('R10 navigation and Back/Forward never resurrect pixels or restart a consumed watch',async()=>{
  await reset();await page.getByRole('button',{name:'Watch',exact:true}).click();await frames().waitFor({state:'visible'});const count=watchRequests.length;
  await page.getByRole('navigation',{name:'Centre view'}).getByRole('link',{name:'Overview',exact:true}).click();await page.locator('.consoleCoreVisual').waitFor();assert.equal(await page.locator('.consoleBrowserWatch').count(),0);
  await page.goBack();await page.locator('.consoleBrowserContent').waitFor();assert.equal(await frames().count(),0);assert.equal(watchRequests.length,count);
  await page.goForward();await page.locator('.consoleCoreVisual').waitFor();await page.reload();assert.equal(watchRequests.length,count);
 });
 await check('R10 genuine owner refresh keeps the mounted stream and only narrows changed expiry',async()=>{
  await reset();await page.getByRole('button',{name:'Watch',exact:true}).click();await frames().waitFor({state:'visible'});
  const original=await frames().elementHandle(),count=watchRequests.length,claims=boundary.effects.filter(effect=>effect.operation==='claim').length;
  const refresh=async remaining=>{
   const reads=boundary.log.filter(call=>call.rpc==='r10_viewer_catalog').length;await control({viewerExpiresInMs:remaining});const expiresAt=boundary.state().viewer.expiresAt;
   // This is the production LiveRefresh focus handler and real router.refresh,
   // not a reload, component replacement, or a fixture-only router substitute.
   await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
   await page.waitForFunction(value=>document.querySelector('.consoleBrowserWatch')?.getAttribute('data-watch-expires-at')===value,expiresAt);
   assert.ok(boundary.log.filter(call=>call.rpc==='r10_viewer_catalog').length>reads);assert.equal(await frames().evaluate((canvas,previous)=>canvas===previous,original),true);assert.equal(await frames().evaluate(canvas=>canvas.width),960);assert.equal(watchRequests.length,count);assert.equal(boundary.effects.filter(effect=>effect.operation==='claim').length,claims);
  };
  await refresh(60_000);assert.equal(await page.getByText('Watching · read-only',{exact:true}).count(),1);
  await refresh(5_000);await refresh(120_000);
  // The newer, longer metadata must not renew this already narrowed UI deadline.
  await page.waitForFunction(()=>document.querySelector('.consoleBrowserWatch canvas')?.width===0);await cleared();await page.getByText('Stopped · server confirmed',{exact:true}).waitFor();assert.equal(watchRequests.length,count);await original.dispose();
 });
 await check('R10 Enlarge and Compact preserve the exact canvas and stream with native modal focus and Escape',async()=>{
  await page.setViewportSize({width:1280,height:720});await reset();await page.getByRole('button',{name:'Watch',exact:true}).click();await frames().waitFor({state:'visible'});
  const original=await frames().elementHandle(),core=await page.locator('[data-console-panel=core]').boundingBox(),count=watchRequests.length;
  await page.getByRole('button',{name:'Enlarge viewer',exact:true}).click();const modal=page.locator('.consoleBrowserWatch:modal');await modal.waitFor();
  assert.equal(await frames().evaluate((canvas,previous)=>canvas===previous,original),true);assert.equal(watchRequests.length,count);assert.equal(await frames().evaluate(canvas=>canvas.width),960);
  const bounds=await modal.boundingBox(),stage=await page.locator('.consoleBrowserWatchStage').boundingBox();assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=1281&&bounds.y+bounds.height<=721);assert.ok(Math.min(stage.width/960,stage.height/540)*540>=450,'Enlarged source pixels must be large enough to read at desktop');
  for(let n=0;n<4;n++){await page.keyboard.press('Tab');assert.equal(await modal.evaluate(dialog=>dialog.contains(document.activeElement)),true,'Native modal keeps keyboard focus inside viewer');}
  for(let n=0;n<4;n++){await page.keyboard.press('Shift+Tab');assert.equal(await modal.evaluate(dialog=>dialog.contains(document.activeElement)),true,'Reverse Tab stays inside the enlarged viewer');}
  await page.keyboard.press('Escape');assert.equal(await modal.count(),0);assert.equal(await page.getByRole('button',{name:'Enlarge viewer',exact:true}).evaluate(button=>button===document.activeElement),true);assert.deepEqual(await page.locator('[data-console-panel=core]').boundingBox(),core);assert.equal(await frames().evaluate((canvas,previous)=>canvas===previous,original),true);
  await page.getByRole('button',{name:'Enlarge viewer',exact:true}).click();await modal.waitFor();await page.getByRole('button',{name:'Compact viewer',exact:true}).click();assert.equal(await modal.count(),0);assert.equal(watchRequests.length,count);assert.equal(await frames().evaluate((canvas,previous)=>canvas===previous,original),true);
  await page.getByRole('button',{name:'Enlarge viewer',exact:true}).click();await modal.waitFor();await stop();assert.equal(await page.getByRole('button',{name:'Compact viewer',exact:true}).evaluate(button=>button===document.activeElement),true,'Removing Stop restores the remaining local control');await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');assert.equal(await modal.evaluate(dialog=>dialog.contains(document.activeElement)),true);await page.keyboard.press('Escape');assert.equal(await modal.count(),0);await cleared();await original.dispose();
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
  const legacy=boundary.state().db.browser_sessions.find(session=>session.id===r10LegacyScopes.sameQuest.sessionId);assert.ok(legacy);
  await page.goto(origin+viewerRoute({browserRun:legacy.workflow_run_id}));await page.getByText('Live viewing unavailable for this session',{exact:true}).waitFor();assert.equal(await page.locator('.consoleBrowserWatch').count(),0);
 });
 await check('R10 live centre fits both desktops and reflows with accessible frame status and controls',async()=>{
  for(const [width,height]of [[1280,720],[1440,900],[390,844],[320,800],[640,360]]){
   await page.setViewportSize({width,height});await reset();await page.getByRole('button',{name:'Watch',exact:true}).click();await frames().waitFor({state:'visible'});
   const metrics=await page.evaluate(()=>({w:document.documentElement.scrollWidth,h:document.documentElement.scrollHeight}));assert.ok(metrics.w<=width+1,JSON.stringify({width,metrics}));if(width>=1280)assert.ok(metrics.h<=height+1,JSON.stringify({height,metrics}));
   const box=await page.locator('.consoleBrowserWatch').boundingBox(),core=await page.locator('[data-console-panel=core]').boundingBox();assert.ok(box.y+box.height<=core.y+core.height+1);
   const controls=await page.locator('.consoleBrowserWatch button,.consoleCentreTabs a').evaluateAll(elements=>elements.map(e=>({height:e.getBoundingClientRect().height,font:parseFloat(getComputedStyle(e).fontSize)})));assert.ok(controls.every(c=>c.height>=(width>900?24:44)&&c.font>=12));
   await page.screenshot({path:path.join(output,`r10-live-watch-${width}x${height}.png`),fullPage:true});
   await page.getByRole('button',{name:'Enlarge viewer',exact:true}).click();await page.locator('.consoleBrowserWatch:modal').waitFor();const enlarged=await page.locator('.consoleBrowserWatch:modal').boundingBox();assert.ok(enlarged.x>=0&&enlarged.y>=0&&enlarged.x+enlarged.width<=width+1&&enlarged.y+enlarged.height<=height+1);
   await page.screenshot({path:path.join(output,`r10-enlarged-watch-${width}x${height}.png`),fullPage:true});await page.getByRole('button',{name:'Compact viewer',exact:true}).click();await stop();
  }
 });
 await check('R10 actual 200 percent browser zoom preserves the bounded public viewer',async()=>{
  await control({resetViewer:true});const zoom=await actualZoomBrowser();try{
   await zoom.context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());const p=await zoom.context.newPage();await p.goto(origin+viewerRoute());assert.equal(await zoom.set(p,2),2);
   await p.getByRole('button',{name:'Watch',exact:true}).click();await p.locator('.consoleBrowserWatch canvas[data-frame-sequence]').waitFor({state:'visible'});
   const m=await p.evaluate(()=>({width:document.documentElement.scrollWidth,innerWidth}));assert.ok(m.width<=m.innerWidth+1);await p.screenshot({path:path.join(output,'r10-live-watch-zoom200.png'),fullPage:true});await p.getByRole('button',{name:'Enlarge viewer',exact:true}).click();await p.locator('.consoleBrowserWatch:modal').waitFor();await p.screenshot({path:path.join(output,'r10-enlarged-watch-zoom200.png'),fullPage:true});await p.getByRole('button',{name:'Compact viewer',exact:true}).click();await p.getByRole('button',{name:'Stop watching',exact:true}).click();await p.getByText('Stopped · server confirmed',{exact:true}).waitFor();
  }finally{await zoom.close();}
 });
 await page.setViewportSize({width:1280,height:720});
}
