import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createControlledCapture} from '../.core-tests/browser/watch/capture.js';
import {SteelBrowserAdapter} from '../.core-tests/browser/providers/steel.js';
import {WATCH_HTML,WATCH_SOURCE_URL,WATCH_CSP} from '../.core-tests/browser/watch/contracts.js';
function browserFixture(){
 const browser=new EventEmitter(),context=new EventEmitter(),page=new EventEmitter(),events=[];let route,ws,readyUrl='about:blank',closed=false,ctxClosed=false;
 const main={url:()=>readyUrl};Object.assign(page,{mainFrame:()=>main,url:()=>readyUrl,isClosed:()=>closed,frames:()=>[main],screenshot:async()=>{events.push('screenshot');return Buffer.from([255,216,255,219]);},
 goto:async url=>{await route({request:()=>({url:()=>url,method:()=> 'GET',isNavigationRequest:()=>true,frame:()=>main}),fulfill:async response=>{events.push(response);readyUrl=url;page.emit('framenavigated',main);},abort:async()=>{events.push('abort');}});}});
 Object.assign(context,{routeWebSocket:async(_,handler)=>{ws=handler;},route:async(_,handler)=>{route=handler;},newPage:async()=>{events.push('page');context.emit('page',page);return page;},pages:()=>[page],cookies:async()=>[],close:async()=>{ctxClosed=true;closed=true;context.emit('close');}});
 Object.assign(browser,{newContext:async options=>{events.push(options);return context;},contexts:()=>{throw Error('default context must never be read');},isConnected:()=>!ctxClosed,close:async()=>{events.push('disconnect');}});
 return{browser,context,page,events,websocket:()=>ws};
}
test('R10 producer installs confinement before page creation and withholds pixels until exact trusted document',async()=>{
 const b=browserFixture();let invalid=0;const source=await createControlledCapture(b.browser,()=>invalid++);assert.equal(invalid,0);assert.equal(source.eligible(),true);
 const options=b.events[0];assert.deepEqual(options.permissions,[]);assert.equal(options.javaScriptEnabled,false);assert.equal(options.serviceWorkers,'block');assert.equal(options.acceptDownloads,false);assert.ok(!('storageState'in options));
 const fulfilled=b.events.find(x=>x?.body);assert.equal(fulfilled.body,WATCH_HTML);assert.equal(fulfilled.headers['content-security-policy'],WATCH_CSP);assert.match(WATCH_CSP,/default-src 'none'/);assert.equal(b.events.includes('screenshot'),false);
 const pixels=await source.capture();assert.equal(pixels[0],255);await source.dispose();assert.equal(source.eligible(),false);assert.equal(invalid,0);
});
test('R10 attempted later navigation suspends capture before any request continues',async()=>{
 const b=browserFixture();let invalid=0;const source=await createControlledCapture(b.browser,()=>invalid++);await b.page.goto('https://private.invalid/signin');assert.ok(invalid);assert.equal(source.eligible(),false);assert.equal(b.events.at(-1),'abort');await assert.rejects(source.capture());await source.dispose();
});
for(const event of ['popup','download','dialog','crash','frameattached'])test(`R10 ${event} event discards capture eligibility`,async()=>{
 const b=browserFixture();let invalid=0;const source=await createControlledCapture(b.browser,()=>invalid++);b.page.emit(event,{});assert.ok(invalid);await assert.rejects(source.capture());await source.dispose();
});
test('R10 websocket and unexpected context page cannot retain eligibility',async()=>{
 const b=browserFixture();let invalid=0,closed=false;const source=await createControlledCapture(b.browser,()=>invalid++);b.websocket()({close:()=>closed=true});assert.ok(closed&&invalid);b.context.emit('page',{});assert.equal(source.eligible(),false);await source.dispose();
});
test('R10 privacy transition during capture rejects and zeroes completed bytes',async()=>{
 const b=browserFixture(),pixels=Buffer.from([255,216,255]);const source=await createControlledCapture(b.browser,()=>{});b.page.screenshot=async()=>{b.page.emit('popup',{});return pixels;};await assert.rejects(source.capture());assert.ok(pixels.every(x=>x===0));await source.dispose();
});
test('R10 Steel creation is separately bounded, nonpersistent and has no profile/context/control request',async()=>{
 const calls=[];const adapter=new SteelBrowserAdapter({config:{apiKey:'inert-test-key',baseUrl:'https://api.steel.dev'},admitDispatch:async r=>calls.push(r),fetcher:async(url,init)=>{
  calls.push({url:String(url),...init});return Response.json({id:'00000000-0000-4000-8000-000000000001',debugUrl:'https://inert.invalid/debug',websocketUrl:'wss://inert.invalid/connect'});
 }});await adapter.createViewerSession(120000,()=>{});const req=calls.find(x=>x.body),body=JSON.parse(req.body);assert.deepEqual(body,{debugConfig:{interactive:false,systemCursor:false},persistProfile:false,useProxy:false,solveCaptcha:false,timeout:120000});assert.equal(req.redirect,'error');assert.equal(calls.filter(x=>x.body).length,1);await assert.rejects(adapter.createViewerSession(120001,()=>{}));await assert.rejects(adapter.createViewerSession(0,()=>{}));
});
test('R10 producer/source boundaries do not reuse saved profiles or broaden embedding headers',()=>{
 const source=readFileSync('src/browser/watch/capture.ts','utf8');assert.ok(!source.includes('contexts()[0]'));assert.ok(!source.includes('route.continue'));assert.ok(!source.includes('setInputFiles'));assert.ok(!source.includes('send('));
 assert.equal(createHash('sha256').update(WATCH_HTML).digest('hex'),'9165948e0a968e0a00be7bc22d4ec89862b84733577ca4a4fb9622238c2c42cd');assert.equal(WATCH_SOURCE_URL,'https://r10-viewer.invalid/controlled-public');assert.match(readFileSync('next.config.ts','utf8'),/key: "X-Frame-Options",\s+value: "DENY"/);
});
test('R10 partial constructor preserves unconfirmed cleanup failures',async()=>{
 const b=browserFixture();b.context.routeWebSocket=async()=>{throw Error('inert setup failure');};b.context.close=async()=>{throw Error('inert close failure');};b.browser.close=async()=>{throw Error('inert disconnect failure');};await assert.rejects(createControlledCapture(b.browser,()=>{}),error=>error.closureConfirmed===false);
});
test('R10 Steel fixed-origin session binding ignores returned native endpoints',async()=>{
 const adapter=new SteelBrowserAdapter({config:{apiKey:'inert-test-key',baseUrl:'https://api.steel.dev'},admitDispatch:async()=>{},fetcher:async()=>Response.json({id:'00000000-0000-4000-8000-000000000001',websocketUrl:'wss://untrusted.invalid/cdp',debugUrl:'https://untrusted.invalid/control'})});const result=await adapter.createViewerSession(15000,()=>{}),url=new URL(result.automationEndpoint);assert.equal(url.origin,'wss://connect.steel.dev');assert.equal(url.searchParams.get('sessionId'),result.providerSessionId);assert.equal(url.searchParams.get('apiKey'),'inert-test-key');assert.equal(result.debugUrl,'');assert.equal(result.sessionViewerUrl,null);
});
test('R10 final synchronous dispatch fence rejects after delayed admission without transport',async()=>{
 let sent=0,revoked=false;const adapter=new SteelBrowserAdapter({config:{apiKey:'inert-test-key',baseUrl:'https://api.steel.dev'},admitDispatch:async()=>{await Promise.resolve();revoked=true;},fetcher:async()=>{sent++;throw Error('must not dispatch');}});await assert.rejects(adapter.createViewerSession(15000,()=>{if(revoked)throw Error('revoked');}));assert.equal(sent,0);
});
