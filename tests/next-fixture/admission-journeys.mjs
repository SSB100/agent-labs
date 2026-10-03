import assert from 'node:assert/strict';
import path from 'node:path';
import {writeFile} from 'node:fs/promises';
import sharp from 'sharp';
import {id} from './data.mjs';
import {actualZoomBrowser} from './browser-zoom.mjs';
export async function runAdmissionJourneys({page,context,origin,boundary,output,check,actions}){
 const business=id(1),quest=id(820001),base=`/dashboard/quests/controls?business=${business}&quest=${quest}`;
 const status=()=>page.getByRole('heading',{name:'Current availability',exact:true});
 const control=value=>fetch(boundary.origin+'/control',{method:'POST',body:JSON.stringify(value)});
 await check('R05 exact controls navigation and unavailable/foreign scope never substitute',async()=>{
  await page.goto(origin+`/dashboard/quests?business=${business}&quest=${quest}`);
  await page.getByRole('link',{name:'Review financial authority and pause controls',exact:true}).click();await status().waitFor();
  assert.equal(new URL(page.url()).searchParams.get('quest'),quest);
  for(const suffix of [`&quest=${id(821000)}`,`&policy=${id(959999)}`]){await page.goto(origin+`/dashboard/quests/controls?business=${business}${suffix}`);await page.getByRole('alert').filter({hasText:'Operating controls are unavailable'}).waitFor();assert.equal(await page.locator('.questWorkspace').count(),0);}
  await context.addCookies([{name:'r03-mode',value:'empty',url:origin}]);try{await page.goto(origin+`/dashboard/quests/controls?business=${business}`);await status().waitFor();assert.match(await page.locator('.questWorkspace').innerText(),/No qualified operation/);await page.getByText(/^Propose financial authority/).click();assert.equal(await page.getByRole('button',{name:'Save proposal for review',exact:true}).isDisabled(),true);}finally{await context.clearCookies({name:'r03-mode'});}
 });
 for(const [width,height] of [[1280,720],[1440,900],[390,844],[320,800],[640,360]])await check(`R05 financial controls readable and contained ${width}x${height}`,async()=>{
  await page.setViewportSize({width,height});await page.goto(origin+base);await status().waitFor();await page.getByText(/^Propose financial authority/).click();
  const size=await page.evaluate(()=>({w:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth,h:document.documentElement.scrollHeight,ch:document.documentElement.clientHeight}));assert.ok(size.w<=size.cw+1,JSON.stringify(size));if(width>=1280)assert.ok(size.h<=size.ch+1,JSON.stringify(size));
  for(const name of ['Business lifetime ceiling (USD)','Authorization expires (UTC)']){const input=page.getByRole('textbox',{name,exact:true});await input.scrollIntoViewIfNeeded();await input.focus();assert.equal(await input.evaluate(n=>document.activeElement===n),true);const box=await input.boundingBox();assert.ok(box.width>=100&&box.height>=44);}
  await page.getByRole('button',{name:'Save proposal for review',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,`controls-form-${width}x${height}.png`)});
  await status().scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,`controls-${width}x${height}.png`)});
 });
 await check('R05 real Next actions require reviewed exact policy and pause resume pause does not replay old pause',async()=>{
  await page.setViewportSize({width:1280,height:720});await page.goto(origin+base);await status().waitFor();
  for(const action of ['Pause','Resume','Pause']){await page.getByRole('button',{name:`${action} This Business`,exact:true}).click();await page.getByRole('button',{name:`${action==='Pause'?'Resume':'Pause'} This Business`,exact:true}).waitFor();}
  assert.equal(boundary.effects.filter(e=>e.kind==='in-memory-admission').length,3);
  await page.getByText(/^Propose financial authority/).click();
  for(const [name,value]of [['Business lifetime ceiling (USD)','1'],['This policy’s model cost ceiling (USD)','0.001'],['Authorization starts (UTC)','2027-01-01T00:00:00Z'],['Authorization expires (UTC)','2027-01-02T00:00:00Z']])await page.getByRole('textbox',{name,exact:true}).fill(value);
  await page.getByRole('spinbutton',{name:'Maximum dispatch count',exact:true}).fill('1');await page.getByRole('spinbutton',{name:'Minimum seconds between dispatches',exact:true}).fill('60');await page.getByRole('checkbox',{name:/research.model/}).check();
  await control({actionMode:'conflict'});await page.getByRole('button',{name:'Save proposal for review',exact:true}).click();await page.getByRole('status').filter({hasText:'could not be verified'}).waitFor();assert.equal(boundary.effects.filter(e=>e.kind==='in-memory-admission').length,3);
  await control({actionMode:'success'});await page.getByRole('button',{name:'Save proposal for review',exact:true}).click();await page.getByRole('heading',{name:/awaiting confirmation/}).waitFor();
  const confirm=page.getByRole('button',{name:'Confirm this exact policy',exact:true});assert.equal(await confirm.isDisabled(),true);await page.getByRole('checkbox',{name:/I reviewed this exact financial permission/}).check();await confirm.click();await page.getByRole('heading',{name:/confirmed; dispatch remains gated/}).waitFor();await page.reload();await page.getByRole('heading',{name:/confirmed; dispatch remains gated/}).waitFor();
  await page.getByRole('button',{name:'Revoke this policy',exact:true}).click();await page.getByRole('heading',{name:/revoked/}).waitFor();
  assert.deepEqual(boundary.effects.filter(e=>e.kind==='in-memory-admission').map(e=>e.operation),['pause','resume','pause','propose','confirm','revoke']);assert.ok(actions.some(a=>new URL(a.url).pathname==='/dashboard/quests/controls'&&a.status===200));
 });
 await check('R05 actual browser 200 percent zoom keeps pause and policy controls reachable',async()=>{
  const zoom=await actualZoomBrowser();try{
   await zoom.context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort('blockedbyclient'));
   const p=await zoom.context.newPage();await p.goto(origin+base);assert.equal(await zoom.set(p,2),2);await p.getByText(/^Propose financial authority/).click();const field=p.getByRole('textbox',{name:'Authorization expires (UTC)',exact:true});await field.scrollIntoViewIfNeeded();await field.focus();assert.equal(await field.evaluate(n=>document.activeElement===n),true);assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const visible=await field.evaluate(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,iw:innerWidth,ih:innerHeight,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===n};});assert.ok(visible.hit&&visible.y>=0&&visible.y+visible.h<=visible.ih,JSON.stringify(visible));const cdp=await zoom.context.newCDPSession(p);try{const capture=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});const pixels=Buffer.from(capture.data,'base64');await writeFile(path.join(output,'controls-form-zoom200.png'),pixels);assert.ok((await sharp(pixels).stats()).channels.some(c=>c.stdev>5),'Actual zoom form capture must contain rendered content');}finally{await cdp.detach();}
   await p.evaluate(()=>{window.scrollTo(0,0);document.querySelector('main').scrollTop=0;return new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});await p.screenshot({path:path.join(output,'controls-zoom200.png')});
  }finally{await zoom.close();}
 });
}
