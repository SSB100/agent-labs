/** Real Chromium locator behavior against synthetic static DOM only. Logical
 * Etsy URLs are test metadata; goto is replaced with setContent. No Etsy or
 * other external request is made, and no actual account/provenance is claimed. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const load=name=>import(pathToFileURL(resolve(process.env.R12_INSIGHTS_CORE_DIR||'.core-tests','browser',name+'.js')).href);
const {createEtsyInsightsPlaywrightPort}=await load('etsy-insights-playwright');
const {ETSY_INSIGHTS_LANDING_LABEL:LABEL}=await load('etsy-insights-landing-controls');
import {researchRendererFixture} from './helpers/etsy-insights-research-renderer-fixture.mjs';
import {open,search,ROOT} from './helpers/etsy-insights-playwright-fixture.mjs';
const executablePath=process.env.AGENT_LABS_LOCAL_CHROMIUM;
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const shopHtml=name=>`<nav id="shop-manager--channels-list"><a href="/shop/${encodeURIComponent(name)}?ref=seller-platform-mcnav"><span data-test-id="unsanitize">${escape(name)}</span></a></nav>`;
const documentHtml=(shop,main)=>`<!doctype html><html><head><style>body{font:16px sans-serif;margin:20px} main{width:800px} input{width:350px;height:30px} button{min-width:55px;min-height:30px} .region{margin:12px 0;padding:8px} h3{margin:8px 0} .row{display:inline-block;margin-right:30px}</style></head><body>${shopHtml(shop)}<main id="main-content">${main}</main></body></html>`;
function landingHtml(shop,o={}){
 const field=`<input id="keyword-research-search-input" name="${o.wrongInputName?'other':'keyword_search_input'}" type="text" aria-labelledby="mi-search-input-label" placeholder="Try a search term like “vase”">`;
 const button='<button type="submit" aria-labelledby="synthetic-search-name"><svg aria-hidden="true" width="12" height="12"></svg></button>';
 return documentHtml(shop,`<h3>Marketplace Insights</h3><p id="mi-search-input-label" ${o.hiddenLabel?'style="display:none"':''}>${escape(LABEL)}</p><div>${field}${o.duplicateInput?field:''}${o.nestedSubmit?`<span>${button}</span>`:button}${o.extraButton?'<button>Other</button>':''}<span id="synthetic-search-name">Search</span></div>`);
}
function resultHtml(shop,query,o={}){
 return documentHtml(shop,`<div class="wt-sem-mt-page-tight wt-sem-mb-page-tight region"><h3 class="wt-text-display">${escape(o.headingQuery??query)}</h3><clg-signal variant="subtle"><span>Last 30 days</span></clg-signal><div id="mi-walkthrough-cvr-anchor"><button slot="trigger">Very low conversion rate</button></div></div><div class="wt-sem-border-b-divider region"><span class="wt-text-title-small wt-break-word">${escape(o.summaryQuery??query)}</span><div><div class="row"><div class="wt-text-title-small wt-sem-text-primary">Searches</div><div class="wt-text-body">2.4k</div></div><div class="row"><div class="wt-text-title-small wt-sem-text-primary">Search results</div><div class="wt-text-body">20k</div></div></div><button data-testid="wow-trend-indicator">+10%</button></div><button id="mi-walkthrough-time-range-anchor">Last 30 days</button><form aria-label="search bar form"><input type="text" aria-label="Input to search for keywords"><button type="submit">Search</button></form>`);
}
async function nativeFixture(o={}){
 const f=researchRendererFixture({candidateBlock:false}),browser=await chromium.launch({executablePath,headless:true}),context=await browser.newContext({serviceWorkers:'block',viewport:{width:1280,height:900}}),page=await context.newPage();
 const requests=[],actions=[],nativeCdps=[];page.on('request',r=>requests.push(r.url()));
 let url='about:blank';const frame=page.mainFrame(),frameProxy=new Proxy(frame,{get(t,k){if(k==='url')return()=>url;const v=Reflect.get(t,k);return typeof v==='function'?v.bind(t):v;}});
 const unwrap=new WeakMap();
 function locator(l){const proxy=new Proxy(l,{get(t,k){
  if(['locator','getByRole','getByText','filter','and','first','nth'].includes(k))return(...args)=>locator(t[k](...args.map(a=>unwrap.get(a)??a)));
  if(k==='fill')return async(...args)=>{actions.push('fill');await t.fill(...args);if(o.changeShopAfterFill){await page.locator('[data-test-id="unsanitize"]').evaluate(el=>{el.textContent='Other Synthetic Shop';});}};
  if(k==='click')return async(...args)=>{assert.equal(await page.locator('#keyword-research-search-input').inputValue(),f.s.query);actions.push('submit');await t.click(...args);url=`${ROOT}/search?query=${encodeURIComponent(f.s.query)}`;await page.setContent(resultHtml(f.s.accountBinding.observedShopName,f.s.query,o));};
  const v=Reflect.get(t,k);return typeof v==='function'?v.bind(t):v;
 }});unwrap.set(proxy,l);return proxy;}
 const pageProxy=new Proxy(page,{get(t,k){
  if(k==='url')return()=>url;if(k==='mainFrame')return()=>frameProxy;
  if(['locator','getByRole','getByText'].includes(k))return(...args)=>locator(t[k](...args));
  if(k==='goto')return async target=>{assert.equal(target,ROOT);url=target;await page.setContent(landingHtml(o.shop??f.s.accountBinding.observedShopName,o));return null;};
  if(k==='on')return(name,fn)=>{t.on(name,name==='framenavigated'?f=>fn(f===frame?frameProxy:f):fn);return pageProxy;};
  const v=Reflect.get(t,k);return typeof v==='function'?v.bind(t):v;
 }});
 const contextProxy=new Proxy(context,{get(t,k){if(k==='pages')return()=>[pageProxy];if(k==='newCDPSession')return async()=>{const c=await t.newCDPSession(page);nativeCdps.push(c);return c;};const v=Reflect.get(t,k);return typeof v==='function'?v.bind(t):v;}});
 const browserProxy=new Proxy(browser,{get(t,k){if(k==='contexts')return()=>[contextProxy];const v=Reflect.get(t,k);return typeof v==='function'?v.bind(t):v;}});
 f.input.connect=async()=>browserProxy;f.port=createEtsyInsightsPlaywrightPort(f.input);
 return{...f,nativeBrowser:browser,nativeCdps,requests,actions};
}

test('actual Chromium distinguishes observed landing controls from retained result selectors without Etsy traffic',{skip:!executablePath,timeout:60000},async()=>{
 const f=await nativeFixture();let session;
 try{session=await open(f);const landing=await session.observeAggregateView(f.stop.signal);assert.equal(landing.queryControl.id,'observed-insights-landing-controls.2');assert.equal(landing.visibleShopName,f.s.accountBinding.observedShopName);assert.equal(landing.query,null);assert.deepEqual(f.actions,[]);
  const result=await search(f,session),capture=await session.captureSameEpoch(result.documentEpoch,f.stop.signal);assert.equal(result.queryControl.id,'observed-insights-query-form');assert.equal(result.query,f.s.query);assert.equal(result.visibleShopName,f.s.accountBinding.observedShopName);assert.equal(capture.facts.find(x=>x.kind==='query').quote,f.s.query);assert.equal(capture.facts.find(x=>x.kind==='searches').quote,'Searches\n2.4k');assert.equal(capture.facts.find(x=>x.kind==='reporting_window').quote,'Last 30 days');assert.deepEqual(f.actions,['fill','submit']);assert.deepEqual(f.requests,[]);
  const cleanup=await session.close(session.sessionId);assert.equal(cleanup.observersDisposed,true,JSON.stringify({cleanup,browserConnected:f.nativeBrowser.isConnected()}));assert.equal(f.nativeBrowser.isConnected(),false);assert.equal(f.nativeCdps.length,1);for(const c of f.nativeCdps)await assert.rejects(c.send('Page.getFrameTree'));
 }finally{if(f.nativeBrowser.isConnected())await f.nativeBrowser.close();}
});
test('actual Chromium ambiguity, identity change and independent result mismatch fail closed',{skip:!executablePath,timeout:90000},async t=>{
 for(const [label,options] of Object.entries({duplicateInput:{duplicateInput:true},wrongInputName:{wrongInputName:true},hiddenLabel:{hiddenLabel:true},nestedSubmit:{nestedSubmit:true},extraButton:{extraButton:true},wrongShop:{shop:'Other Synthetic Shop'},changedAfterFill:{changeShopAfterFill:true},wrongHeading:{headingQuery:'different query'},wrongSummary:{summaryQuery:'different query'}}))await t.test(label,async()=>{
  const f=await nativeFixture(options);let session;
  try{session=await open(f);await assert.rejects(search(f,session));assert.ok(f.actions.filter(x=>x==='submit').length<=1);if(!options.headingQuery&&!options.summaryQuery)assert.equal(f.actions.includes('submit'),false);assert.deepEqual(f.requests,[]);await session.close(session.sessionId);}
  finally{if(f.nativeBrowser.isConnected())await f.nativeBrowser.close();}
 });
});
