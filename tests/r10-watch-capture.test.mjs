import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {errors} from 'playwright-core';
import {createControlledCapture} from '../.core-tests/browser/watch/capture.js';
import {SteelBrowserAdapter} from '../.core-tests/browser/providers/steel.js';
import {CaptureFailure,CaptureSetupFailure,WATCH_DISPOSE_TIMEOUT_MS,WATCH_HTML,WATCH_MAX_FRAME_BYTES,WATCH_SOURCE_URL,WATCH_CSP} from '../.core-tests/browser/watch/contracts.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const drainMicrotasks=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
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
 const b=browserFixture(),pixels=Buffer.from([255,216,255]);const source=await createControlledCapture(b.browser,()=>{});b.page.screenshot=async()=>{b.page.emit('popup',{});return pixels;};await assert.rejects(source.capture(),error=>error instanceof CaptureFailure&&error.reason==='source_invalidated');assert.ok(pixels.every(x=>x===0));await source.dispose();
});
test('R10 known Playwright screenshot timeout has a safe fixed reason without changing the capture budget',async()=>{
 const b=browserFixture(),source=await createControlledCapture(b.browser,()=>{}),hostile=new errors.TimeoutError('wss://private.invalid/?apiKey=do-not-expose');let options;
 b.page.screenshot=async input=>{options=input;throw hostile;};await assert.rejects(source.capture(),error=>error instanceof CaptureFailure&&error.reason==='timeout'&&error!==hostile&&error.cause===undefined&&!String(error).includes('do-not-expose'));
 assert.deepEqual(options,{type:'jpeg',quality:65,fullPage:false,timeout:1500,animations:'disabled'});assert.equal(source.eligible(),true);await source.dispose();
});
test('R10 an ineligible producer classifies source invalidation before attempting a screenshot',async()=>{
 const b=browserFixture(),source=await createControlledCapture(b.browser,()=>{});source.suspend();await assert.rejects(source.capture(),error=>error instanceof CaptureFailure&&error.reason==='source_invalidated');assert.equal(b.events.includes('screenshot'),false);await source.dispose();
});
test('R10 screenshot rejection after a privacy event reports source invalidation without raw failure details',async()=>{
 const b=browserFixture(),source=await createControlledCapture(b.browser,()=>{});b.page.screenshot=async()=>{b.page.emit('popup',{});throw Error('private screenshot failure do-not-expose');};
 await assert.rejects(source.capture(),error=>error instanceof CaptureFailure&&error.reason==='source_invalidated'&&error.cause===undefined&&!String(error).includes('do-not-expose'));await source.dispose();
});
test('R10 a known screenshot timeout keeps its fixed classification even when the source was invalidated',async()=>{
 const b=browserFixture(),source=await createControlledCapture(b.browser,()=>{});b.page.screenshot=async()=>{b.page.emit('popup',{});throw new errors.TimeoutError('inert timeout');};await assert.rejects(source.capture(),error=>error instanceof CaptureFailure&&error.reason==='timeout');assert.equal(source.eligible(),false);await source.dispose();
});
for(const kind of ['forged_timeout','hostile_fields','string'])test(`R10 untrusted screenshot ${kind} cannot supply diagnostic codes or raw details`,async()=>{
 const b=browserFixture(),source=await createControlledCapture(b.browser,()=>{});let reads=0,hostile='private failure do-not-expose';
 if(kind==='forged_timeout')hostile=Object.assign(Error('private timeout do-not-expose'),{name:'TimeoutError',reason:'timeout'});
 if(kind==='hostile_fields'){hostile={};for(const key of ['name','message','stack','reason'])Object.defineProperty(hostile,key,{get(){reads++;throw Error('do-not-expose');}});}
 b.page.screenshot=()=>{throw hostile;};await assert.rejects(source.capture(),error=>error instanceof Error&&!(error instanceof CaptureFailure)&&error.message==='capture_unavailable'&&error.cause===undefined&&error.reason===undefined);assert.equal(reads,0);assert.equal(source.eligible(),true);await source.dispose();
});
for(const kind of ['oversize','bad_jpeg','empty'])test(`R10 ${kind} screenshot is zeroed and classified as an invalid frame`,async()=>{
 const b=browserFixture(),source=await createControlledCapture(b.browser,()=>{}),pixels=kind==='oversize'?Buffer.alloc(WATCH_MAX_FRAME_BYTES+1,1):kind==='bad_jpeg'?Buffer.from([255,0,255]):Buffer.alloc(0);
 if(kind==='oversize'){pixels[0]=255;pixels[1]=216;}b.page.screenshot=async()=>pixels;await assert.rejects(source.capture(),error=>error instanceof CaptureFailure&&error.reason==='frame_invalid');assert.ok(pixels.every(x=>x===0));await source.dispose();
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
 const b=browserFixture(),calls=[];b.context.routeWebSocket=async()=>{throw Error('inert setup failure');};b.context.close=async()=>{calls.push('context');throw Error('inert close failure');};b.browser.close=async()=>{calls.push('disconnect');throw Error('inert disconnect failure');};await assert.rejects(createControlledCapture(b.browser,()=>{}),error=>error instanceof CaptureSetupFailure&&error.closureConfirmed===false&&error.message==='capture_confinement_unavailable');assert.deepEqual(calls,['context','disconnect']);
});
test('R10 disposal is idempotent and suspends synchronously before confirmed context close and disconnect',async()=>{
 const b=browserFixture(),calls=[],contextGate=deferred(),disconnectGate=deferred();let invalid=0;
 b.context.close=async()=>{calls.push('context');await contextGate.promise;calls.push('context_closed');};
 b.browser.close=async()=>{calls.push('disconnect');await disconnectGate.promise;calls.push('disconnected');};
 const source=await createControlledCapture(b.browser,()=>invalid++),first=source.dispose();let settled=false;first.then(()=>settled=true);
 assert.equal(source.eligible(),false);assert.strictEqual(source.dispose(),first);await drainMicrotasks();assert.deepEqual(calls,['context']);assert.equal(settled,false);
 contextGate.resolve();await drainMicrotasks();assert.deepEqual(calls,['context','context_closed','disconnect']);assert.equal(settled,false);
 disconnectGate.resolve();await first;assert.deepEqual(calls,['context','context_closed','disconnect','disconnected']);assert.strictEqual(source.dispose(),first);assert.equal(invalid,0);
});
test('R10 rejected context close still disconnects and keeps a sanitized idempotent disposal failure',async()=>{
 const b=browserFixture(),calls=[];b.context.close=()=>{calls.push('context');throw Error('inert private endpoint apiKey=do-not-expose');};b.browser.close=async()=>{calls.push('disconnect');};
 const source=await createControlledCapture(b.browser,()=>{}),disposal=source.dispose();await assert.rejects(disposal,{message:'capture_disposal_unconfirmed'});
 assert.deepEqual(calls,['context','disconnect']);assert.equal(source.eligible(),false);assert.strictEqual(source.dispose(),disposal);await assert.rejects(source.dispose(),{message:'capture_disposal_unconfirmed'});assert.deepEqual(calls,['context','disconnect']);
});
test('R10 hanging context close has a deadline, still disconnects, and late success never fabricates closure',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const b=browserFixture(),calls=[],contextGate=deferred();let invalid=0;
 b.context.close=async()=>{calls.push('context');await contextGate.promise;calls.push('context_closed');b.context.emit('close');};b.browser.close=async()=>{calls.push('disconnect');};
 const source=await createControlledCapture(b.browser,()=>invalid++),disposal=source.dispose(),rejected=assert.rejects(disposal,{message:'capture_disposal_unconfirmed'});
 await drainMicrotasks();assert.deepEqual(calls,['context']);t.mock.timers.tick(WATCH_DISPOSE_TIMEOUT_MS-1);await drainMicrotasks();assert.deepEqual(calls,['context']);
 t.mock.timers.tick(1);await rejected;assert.deepEqual(calls,['context','disconnect']);assert.equal(source.eligible(),false);
 contextGate.resolve();await drainMicrotasks();assert.deepEqual(calls,['context','disconnect','context_closed']);assert.strictEqual(source.dispose(),disposal);await assert.rejects(source.dispose(),{message:'capture_disposal_unconfirmed'});assert.equal(invalid,0);
});
for(const failure of ['reject','hang'])test(`R10 ${failure} during disconnect cannot report successful physical disposal`,async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const b=browserFixture(),calls=[],disconnectGate=deferred();b.context.close=async()=>{calls.push('context');};
 b.browser.close=async()=>{calls.push('disconnect');if(failure==='reject')throw Error('inert private disconnect detail');await disconnectGate.promise;};
 const source=await createControlledCapture(b.browser,()=>{}),disposal=source.dispose(),rejected=assert.rejects(disposal,{message:'capture_disposal_unconfirmed'});
 await drainMicrotasks();assert.deepEqual(calls,['context','disconnect']);if(failure==='hang')t.mock.timers.tick(WATCH_DISPOSE_TIMEOUT_MS);await rejected;assert.equal(source.eligible(),false);assert.strictEqual(source.dispose(),disposal);
 disconnectGate.resolve();await drainMicrotasks();await assert.rejects(source.dispose(),{message:'capture_disposal_unconfirmed'});
});
test('R10 context and disconnect hangs are independently bounded within two cleanup steps',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const b=browserFixture(),calls=[];b.context.close=async()=>{calls.push('context');await new Promise(()=>{});};b.browser.close=async()=>{calls.push('disconnect');await new Promise(()=>{});};
 const source=await createControlledCapture(b.browser,()=>{}),disposal=source.dispose(),rejected=assert.rejects(disposal,{message:'capture_disposal_unconfirmed'});await drainMicrotasks();assert.deepEqual(calls,['context']);
 t.mock.timers.tick(WATCH_DISPOSE_TIMEOUT_MS);await drainMicrotasks();assert.deepEqual(calls,['context','disconnect']);t.mock.timers.tick(WATCH_DISPOSE_TIMEOUT_MS);await rejected;assert.strictEqual(source.dispose(),disposal);
});
test('R10 partial constructor only confirms cleanup after context close and browser disconnect both succeed',async()=>{
 const b=browserFixture(),calls=[];b.context.routeWebSocket=async()=>{throw Error('inert setup failure');};b.context.close=async()=>{calls.push('context');};b.browser.close=async()=>{calls.push('disconnect');};
 await assert.rejects(createControlledCapture(b.browser,()=>{}),error=>error instanceof CaptureSetupFailure&&error.closureConfirmed===true&&error.message==='capture_confinement_unavailable');assert.deepEqual(calls,['context','disconnect']);
});
test('R10 partial constructor context hang still disconnects and remains unconfirmed after late closure',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const b=browserFixture(),calls=[],contextGate=deferred();let setupError;
 b.context.routeWebSocket=async()=>{throw Error('inert setup failure');};b.context.close=async()=>{calls.push('context');await contextGate.promise;};b.browser.close=async()=>{calls.push('disconnect');};
 const rejected=assert.rejects(createControlledCapture(b.browser,()=>{}),error=>{setupError=error;return error instanceof CaptureSetupFailure&&error.closureConfirmed===false&&error.message==='capture_confinement_unavailable';});
 await drainMicrotasks();assert.deepEqual(calls,['context']);t.mock.timers.tick(WATCH_DISPOSE_TIMEOUT_MS);await rejected;assert.deepEqual(calls,['context','disconnect']);contextGate.resolve();await drainMicrotasks();assert.equal(setupError.closureConfirmed,false);
});
for(const failure of ['reject','hang'])test(`R10 partial constructor disconnect ${failure} preserves unconfirmed cleanup`,async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const b=browserFixture(),calls=[];b.context.routeWebSocket=async()=>{throw Error('inert setup failure');};b.context.close=async()=>{calls.push('context');};
 b.browser.close=async()=>{calls.push('disconnect');if(failure==='reject')throw Error('inert private disconnect detail');await new Promise(()=>{});};
 const rejected=assert.rejects(createControlledCapture(b.browser,()=>{}),error=>error instanceof CaptureSetupFailure&&error.closureConfirmed===false&&error.message==='capture_confinement_unavailable');
 await drainMicrotasks();assert.deepEqual(calls,['context','disconnect']);if(failure==='hang')t.mock.timers.tick(WATCH_DISPOSE_TIMEOUT_MS);await rejected;
});
test('R10 Steel fixed-origin session binding ignores returned native endpoints',async()=>{
 const adapter=new SteelBrowserAdapter({config:{apiKey:'inert-test-key',baseUrl:'https://api.steel.dev'},admitDispatch:async()=>{},fetcher:async()=>Response.json({id:'00000000-0000-4000-8000-000000000001',websocketUrl:'wss://untrusted.invalid/cdp',debugUrl:'https://untrusted.invalid/control'})});const result=await adapter.createViewerSession(15000,()=>{}),url=new URL(result.automationEndpoint);assert.equal(url.origin,'wss://connect.steel.dev');assert.equal(url.searchParams.get('sessionId'),result.providerSessionId);assert.equal(url.searchParams.get('apiKey'),'inert-test-key');assert.equal(result.debugUrl,'');assert.equal(result.sessionViewerUrl,null);
});
test('R10 final synchronous dispatch fence rejects after delayed admission without transport',async()=>{
 let sent=0,revoked=false;const adapter=new SteelBrowserAdapter({config:{apiKey:'inert-test-key',baseUrl:'https://api.steel.dev'},admitDispatch:async()=>{await Promise.resolve();revoked=true;},fetcher:async()=>{sent++;throw Error('must not dispatch');}});await assert.rejects(adapter.createViewerSession(15000,()=>{if(revoked)throw Error('revoked');}));assert.equal(sent,0);
});
