import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import {bounded,setFixtureBrowserTimeouts,FIXTURE_ACTION_TIMEOUT_MS,FIXTURE_NAVIGATION_TIMEOUT_MS} from './async-bounds.mjs';

/** Chromium's real per-tab browser zoom, not CSS zoom, pinch zoom or only a smaller viewport.
 * A fresh disposable profile and a local MV3 extension have no host permissions or credentials.
 * Official APIs: playwright.dev/docs/chrome-extensions and chrome.tabs.setZoom/setZoomSettings.
 */
export async function actualZoomBrowser() {
  const directory=await mkdtemp(path.join(tmpdir(),'agent-labs-r03-zoom-'));
  const relative=path.relative(path.resolve(tmpdir()),path.resolve(directory));
  assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(directory).startsWith('agent-labs-r03-zoom-'),'Zoom profile cleanup must remain inside the temporary directory');
  const extension=path.join(directory,'extension');await mkdir(extension);
  await writeFile(path.join(extension,'manifest.json'),JSON.stringify({manifest_version:3,name:'Inert R03 accessibility zoom',version:'1.0',permissions:['tabs'],background:{service_worker:'zoom.js'}}));
  await writeFile(path.join(extension,'zoom.js'),'chrome.runtime.onInstalled.addListener(() => {});\n');
  let context;
  try {
    context=await chromium.launchPersistentContext(path.join(directory,'profile'),{...(process.env.GUIDED_UI_CHROMIUM_PATH?{executablePath:process.env.GUIDED_UI_CHROMIUM_PATH}:{channel:'chromium'}),headless:true,timeout:FIXTURE_NAVIGATION_TIMEOUT_MS,viewport:{width:1280,height:720},reducedMotion:'reduce',args:['--no-sandbox',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
    setFixtureBrowserTimeouts(context);
    const worker=context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker',{timeout:FIXTURE_ACTION_TIMEOUT_MS});
    return {context,async set(page,factor){
      return bounded(worker.evaluate(async({url,factor})=>{
        const tab=(await chrome.tabs.query({})).find(tab=>tab.url===url);if(!tab)throw Error('Exact inert zoom tab not found');
        await chrome.tabs.setZoomSettings(tab.id,{mode:'automatic',scope:'per-tab'});
        await chrome.tabs.setZoom(tab.id,factor);return chrome.tabs.getZoom(tab.id);
      },{url:page.url(),factor}),'Real browser zoom update');
    },async close(){await bounded(context.close(),'Zoom browser close');await rm(directory,{recursive:true,force:true});}};
  }catch(error){
    try{if(context)await bounded(context.close(),'Failed zoom browser close');await rm(directory,{recursive:true,force:true});}
    catch(cleanupError){throw new AggregateError([error,cleanupError],'Zoom browser initialization and cleanup both failed');}
    throw error;
  }
}
