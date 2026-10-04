import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import sharp from 'sharp';
import {createControlledCapture} from '../.core-tests/browser/watch/capture.js';
import {WATCH_SOURCE_URL} from '../.core-tests/browser/watch/contracts.js';
const hosted=process.env.GUIDED_UI_BROWSER==='1';
test('R10 actual Chromium confines a fresh source before first pixels and blocks navigation/extra contexts',{skip:!hosted},async()=>{
 const browser=await chromium.launch({headless:true}),external=[];let context,invalidations=0,capture;
 const connection={isConnected:()=>browser.isConnected(),on:(event,fn)=>browser.on(event,fn),close:options=>browser.close(options),async newContext(options){context=await browser.newContext(options);context.on('request',r=>{if(r.url()!==WATCH_SOURCE_URL)external.push(r.url());});return context;}};
 try{
  capture=await createControlledCapture(connection,()=>invalidations++);assert.ok(capture.eligible());assert.equal(context.pages().length,1);assert.equal(context.pages()[0].url(),WATCH_SOURCE_URL);assert.equal((await context.cookies()).length,0);
  const bytes=await capture.capture();assert.ok(bytes.length>1000&&bytes.length<=150000);await mkdir('test-results/guided-ui',{recursive:true});await writeFile('test-results/guided-ui/r10-confined-producer.png',await sharp(bytes).png().toBuffer());
  const page=context.pages()[0];await page.goto('https://private.invalid/secure').catch(()=>{});assert.ok(invalidations>0);await assert.rejects(capture.capture());assert.equal(external.filter(url=>url.startsWith('https://private.invalid')).length,1,'attempt is observed, denied by preinstalled route');
  await capture.dispose();capture=undefined;
 }finally{if(capture)await capture.dispose().catch(()=>{});if(browser.isConnected())await browser.close();}
});
