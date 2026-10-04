import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import sharp from 'sharp';
import {createControlledCapture} from '../.core-tests/browser/watch/capture.js';
import {WATCH_SOURCE_URL} from '../.core-tests/browser/watch/contracts.js';
const hosted=process.env.GUIDED_UI_BROWSER==='1';
const pixelOptions={format:'jpeg',quality:65,fromSurface:true,captureBeyondViewport:false,clip:{x:0,y:0,width:960,height:540,scale:1}};
test('R10 actual Chromium confines a fresh exact-page CDP source before first pixels and blocks navigation/extra contexts',{skip:!hosted},async()=>{
 const browser=await chromium.launch({headless:true}),external=[],commands=[];let context,invalidations=0,capture,attaches=0;
 const connection={isConnected:()=>browser.isConnected(),on:(event,fn)=>browser.on(event,fn),close:options=>browser.close(options),async newContext(options){
  assert.equal(options.deviceScaleFactor,1);assert.deepEqual(options.viewport,{width:960,height:540});context=await browser.newContext(options);context.on('request',r=>{if(r.url()!==WATCH_SOURCE_URL)external.push(r.url());});
  const attach=context.newCDPSession.bind(context);context.newCDPSession=async page=>{
   assert.strictEqual(page,context.pages()[0]);assert.equal(context.pages().length,1);attaches++;page.screenshot=()=>{throw Error('No high-level screenshot fallback');};const session=await attach(page),send=session.send.bind(session);
   session.send=async(method,params)=>{commands.push({method,params});return send(method,params);};return session;
  };return context;
 }};
 try{
  capture=await createControlledCapture(connection,()=>invalidations++);assert.ok(capture.eligible());assert.equal(context.pages().length,1);assert.equal(context.pages()[0].url(),WATCH_SOURCE_URL);assert.equal((await context.cookies()).length,0);assert.equal(attaches,1);assert.deepEqual(commands,[{method:'Page.getLayoutMetrics',params:undefined}]);
  const bytes=await capture.capture();assert.ok(bytes.length>1000&&bytes.length<=150000);const metadata=await sharp(bytes).metadata();assert.equal(metadata.format,'jpeg');assert.equal(metadata.width,960);assert.equal(metadata.height,540);assert.deepEqual(commands.at(-1),{method:'Page.captureScreenshot',params:pixelOptions});assert.equal(commands.length,2);
  await mkdir('test-results/guided-ui',{recursive:true});await writeFile('test-results/guided-ui/r10-confined-producer.png',await sharp(bytes).png().toBuffer());bytes.fill(0);
  const next=await capture.capture();assert.ok(next.length>1000);next.fill(0);assert.equal(commands.filter(command=>command.method==='Page.captureScreenshot').length,2,'one fresh pixel command for each capture');assert.equal(commands.filter(command=>command.method==='Page.getLayoutMetrics').length,1,'layout inspection happens only during setup');
  const page=context.pages()[0];await page.goto('https://private.invalid/secure').catch(()=>{});assert.ok(invalidations>0);await assert.rejects(capture.capture());assert.equal(external.filter(url=>url.startsWith('https://private.invalid')).length,1,'attempt is observed, denied by preinstalled route');
  await capture.dispose();capture=undefined;
 }finally{if(capture)await capture.dispose().catch(()=>{});if(browser.isConnected())await browser.close();}
});
test('R10 actual Chromium CDP session close invalidates capture before another pixel command',{skip:!hosted},async()=>{
 const browser=await chromium.launch({headless:true});let capture,session,invalidations=0,pixelCommands=0;
 const connection={isConnected:()=>browser.isConnected(),on:(event,fn)=>browser.on(event,fn),close:options=>browser.close(options),async newContext(options){
  const context=await browser.newContext(options),attach=context.newCDPSession.bind(context);context.newCDPSession=async page=>{session=await attach(page);const send=session.send.bind(session);session.send=async(method,params)=>{if(method==='Page.captureScreenshot')pixelCommands++;return send(method,params);};return session;};return context;
 }};
 try{capture=await createControlledCapture(connection,()=>invalidations++);assert.ok(capture.eligible());await session.detach();assert.ok(invalidations);assert.equal(capture.eligible(),false);await assert.rejects(capture.capture());assert.equal(pixelCommands,0);await capture.dispose();capture=undefined;}
 finally{if(capture)await capture.dispose().catch(()=>{});if(browser.isConnected())await browser.close();}
});
