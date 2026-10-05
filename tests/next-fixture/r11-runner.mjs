import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {runResearchQualificationHttp,runResearchQualificationActionHttp} from './r11-http.mjs';
import {runPendingReceiptBrowser} from './r11-pending-journeys.mjs';
import {runPendingReceiptHttp} from './r11-pending-http.mjs';
import {runResearchQualificationBrowser} from './r11-journeys.mjs';

/** Independent runner keeps the earlier real-Next route matrix unchanged. */
export async function runResearchQualificationJourneys({origin,noKeyOrigin,boundary,output,httpOnly=false}) {
 const results=[],external=[],actions=[],requests=[];
 let browserStatus=httpOnly?'unrun (HTTP-only requested)':'unrun';
 const report=()=>writeFile(path.join(output,'r11-research-acceptance.json'),JSON.stringify({results,browser:browserStatus},null,2));
 const check=async(name,fn)=>{
  const result={name,status:'running'};results.push(result);console.log('START:',name);await report();
  try { await fn();result.status='passed';console.log('PASS:',name); }
  catch(error) { result.status='failed';result.error=String(error.stack??error);console.error('FAIL:',name,result.error); }
  finally { await report(); }
 };
 await runResearchQualificationHttp({origin,noKeyOrigin,boundary,check});
 await runResearchQualificationActionHttp({origin,noKeyOrigin,boundary,check});
 await runPendingReceiptHttp({origin,noKeyOrigin,boundary,check});
 await check('R11 actual Next HTTP transport performs no unsupported operation',async()=>{assert.deepEqual(boundary.denied,[]);});
 if(httpOnly){await report();assert.ok(results.every(result=>result.status==='passed'),'R11 HTTP checks failed; see r11-research-acceptance.json');return;}
 let browser;
 try { browser=await chromium.launch({headless:true,executablePath:process.env.GUIDED_UI_CHROMIUM_PATH,args:['--no-sandbox']});browserStatus='actual Chromium against production Next'; }
 catch(error){browserStatus='blocked before browser launch; browser journeys unrun';results.push({name:'Actual Chromium launch',status:'blocked',error:String(error)});await report();throw error;}
 try {
  const context=await browser.newContext({viewport:{width:1280,height:720},reducedMotion:'reduce'});
  context.setDefaultTimeout(20_000);context.setDefaultNavigationTimeout(30_000);
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(['http:','https:'].includes(url.protocol)&&![origin,noKeyOrigin].includes(url.origin)){external.push(url.origin);return route.abort('blockedbyclient');}return route.continue();});
  const page=await context.newPage();
  page.on('response',response=>{const request=response.request();if(response.headers()['content-type']?.includes('text/x-component'))requests.push({url:response.url(),status:response.status()});if(request.method()==='POST'&&request.headers()['next-action'])actions.push({url:response.url(),status:response.status(),revalidated:response.headers()['x-action-revalidated']??null});});
  await runResearchQualificationBrowser({page,context,origin,noKeyOrigin,boundary,output,check,requests,actions});
  await runPendingReceiptBrowser({page,context,origin,noKeyOrigin,boundary,output,check});
  await check('R11 inert Next boundary attempts no external request or unsupported write',async()=>{assert.deepEqual(external,[]);assert.deepEqual(boundary.denied,[]);});
  await context.close();
 } finally {
  await browser.close();await report();
  await writeFile(path.join(output,'r11-research-action-responses.json'),JSON.stringify(actions,null,2));
  await writeFile(path.join(output,'r11-research-rsc-responses.json'),JSON.stringify(requests,null,2));
 }
 assert.ok(results.every(result=>result.status==='passed'),'R11 actual Next checks failed; see r11-research-acceptance.json');
}
