import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {observeResearchActionStatus,awaitResearchActionStatus,releaseResearchActionStatus} from './browser-action.mjs';

test('real DOM witness rejects stale or failed results and retains a fresh result through immediate remount',async()=>{
 const executablePath=process.env.GUIDED_UI_CHROMIUM_PATH;
 const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{}),args:['--no-sandbox']});
 try{
  const page=await browser.newPage();
  await page.setContent('<div class="r12Controls"><p role="status">Progress is saved.</p></div>');
  await assert.rejects(observeResearchActionStatus(page),/fresh control render/);
  await page.setContent('<div class="r12Controls"><button>Continue approved research</button></div>');
  await observeResearchActionStatus(page);await assert.rejects(awaitResearchActionStatus(page,30),/Timeout/);
  await page.evaluate(()=>{const parent=document.querySelector('.r12Controls'),p=document.createElement('p');p.setAttribute('role','status');p.textContent='Progress is saved. Continue when permitted.';parent.append(p);parent.replaceWith(document.createElement('div'));});
  await awaitResearchActionStatus(page,1000);await releaseResearchActionStatus(page);
  await page.setContent('<div class="r12Controls"></div>');await observeResearchActionStatus(page);
  await page.evaluate(()=>{document.querySelector('.r12Controls').innerHTML='<p role="status">This transition could not be verified.</p>';});
  await assert.rejects(awaitResearchActionStatus(page,1000),/verified progress result/);await releaseResearchActionStatus(page);
 }finally{await browser.close();}
});
