import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {awaitRenderedResearchCheckpoint} from './browser-action.mjs';

test('real DOM requires the exact durable receipt, lease or TEST checkpoint through controls replacement',async()=>{
 const executablePath=process.env.GUIDED_UI_CHROMIUM_PATH;
 const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{}),args:['--no-sandbox']});
 try{
  const page=await browser.newPage(),at='2026-10-08T02:10:58.000Z';
  const render=(text,stamp=at,disabled=true)=>`<section class="r12DiscoveryDetails" aria-label="Qualified discovery progress"><p>${text}</p><time datetime="${stamp}"></time><div class="r12Controls"><button ${disabled?'disabled':''}>Continue approved research</button></div></section>`;
  const receipt={kind:'receipt',attempts:1,at};
  await page.setContent(render('Output saved. Awaiting provider receipt. Check 0 of 3'));
  await assert.rejects(awaitRenderedResearchCheckpoint(page,receipt,30),/Timeout/);
  await page.setContent(render('Output saved. Awaiting provider receipt. Check 1 of 3',at,false));
  await assert.rejects(awaitRenderedResearchCheckpoint(page,receipt,30),/Timeout/);
  await page.setContent(render('Output saved. Awaiting provider receipt. Check 1 of 3','2026-10-08T02:09:58.000Z'));
  await assert.rejects(awaitRenderedResearchCheckpoint(page,receipt,30),/Timeout/);
  await page.setContent(render('Output saved. Awaiting provider receipt. Check 1 of 3'));
  await page.evaluate(()=>{document.querySelector('.r12Controls').outerHTML='<div class="r12Controls"><button disabled>Continue approved research</button></div>';});
  await awaitRenderedResearchCheckpoint(page,receipt,1000);
  await page.setContent(render('Saved progress is preserved. Continue becomes available after'));
  await awaitRenderedResearchCheckpoint(page,{kind:'lease',at},1000);
  await page.setContent(render('Research execution completed. Rejected.'));
  await assert.rejects(awaitRenderedResearchCheckpoint(page,{kind:'completed'},30),/Timeout/);
  await page.setContent(render('Research execution completed. Bounded test recommended'));
  await awaitRenderedResearchCheckpoint(page,{kind:'completed'},1000);
 }finally{await browser.close();}
});
