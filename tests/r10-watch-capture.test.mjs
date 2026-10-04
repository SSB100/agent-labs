import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createControlledCapture} from '../.core-tests/browser/watch/capture.js';
import {SteelBrowserAdapter} from '../.core-tests/browser/providers/steel.js';
import {CaptureFailure,CaptureSetupFailure,WATCH_DISPOSE_TIMEOUT_MS,WATCH_HTML,WATCH_MAX_FRAME_BYTES,WATCH_SOURCE_URL,WATCH_CSP} from '../.core-tests/browser/watch/contracts.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const drainMicrotasks=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
const frame=data=>({data:Buffer.from(data).toString('base64')});
const defaultMetrics=()=>({cssLayoutViewport:{pageX:0,pageY:0,clientWidth:960,clientHeight:540},cssVisualViewport:{pageX:0,pageY:0,offsetX:0,offsetY:0,clientWidth:960,clientHeight:540,scale:1,zoom:1}});
const pixelOptions={format:'jpeg',quality:65,fromSurface:true,captureBeyondViewport:false,clip:{x:0,y:0,width:960,height:540,scale:1}};
function browserFixture(){
 const browser=new EventEmitter(),context=new EventEmitter(),page=new EventEmitter(),session=new EventEmitter(),events=[];let route,ws,readyUrl='about:blank',closed=false,ctxClosed=false;
 const fixture={browser,context,page,session,events,websocket:()=>ws,capture:async()=>frame([255,216,255,219]),metrics:async()=>defaultMetrics()};
 const main={url:()=>readyUrl};Object.assign(page,{mainFrame:()=>main,context:()=>context,viewportSize:()=>({width:960,height:540}),url:()=>readyUrl,isClosed:()=>closed,frames:()=>[main],screenshot:()=>{throw Error('Playwright screenshot must never be called');},
 goto:async url=>{await route({request:()=>({url:()=>url,method:()=> 'GET',isNavigationRequest:()=>true,frame:()=>main}),fulfill:async response=>{events.push(response);readyUrl=url;page.emit('framenavigated',main);},abort:async()=>{events.push('abort');}});}});
 Object.assign(context,{routeWebSocket:async(_,handler)=>{ws=handler;},route:async(_,handler)=>{route=handler;},newPage:async()=>{events.push('page');context.emit('page',page);return page;},newCDPSession:async candidate=>{assert.strictEqual(candidate,page);events.push('attach');return session;},pages:()=>[page],cookies:async()=>[],close:async()=>{ctxClosed=true;closed=true;context.emit('close');session.emit('close');}});
 Object.assign(session,{send:async(method,params)=>{events.push({method,params});if(method==='Page.getLayoutMetrics')return fixture.metrics();if(method==='Page.captureScreenshot')return fixture.capture(params);throw Error('Disallowed protocol method');},detach:async()=>{events.push('detach');session.emit('close');}});
 Object.assign(browser,{newContext:async options=>{events.push(options);return context;},contexts:()=>{throw Error('default context must never be read');},newBrowserCDPSession:()=>{throw Error('browser session must never be used');},isConnected:()=>!ctxClosed,close:async()=>{events.push('disconnect');}});
 return fixture;
}
test('R10 producer installs confinement and exact-page CDP before any pixels, then issues one fixed capture command',async()=>{
 const b=browserFixture();let invalid=0;const source=await createControlledCapture(b.browser,()=>invalid++);assert.equal(invalid,0);assert.equal(source.eligible(),true);
 const options=b.events[0];assert.deepEqual(options.permissions,[]);assert.equal(options.javaScriptEnabled,false);assert.equal(options.serviceWorkers,'block');assert.equal(options.acceptDownloads,false);assert.ok(!('storageState'in options));assert.equal(options.deviceScaleFactor,1);assert.deepEqual(options.viewport,{width:960,height:540});
 const fulfilled=b.events.find(x=>x?.body);assert.equal(fulfilled.body,WATCH_HTML);assert.equal(fulfilled.headers['content-security-policy'],WATCH_CSP);assert.match(WATCH_CSP,/default-src 'none'/);assert.deepEqual(b.events.filter(x=>x?.method).map(x=>x.method),['Page.getLayoutMetrics']);assert.equal(b.events.filter(x=>x==='attach').length,1);
 const pixels=await source.capture();assert.equal(pixels[0],255);assert.deepEqual(b.events.filter(x=>x?.method),[{method:'Page.getLayoutMetrics',params:undefined},{method:'Page.captureScreenshot',params:pixelOptions}]);await source.dispose();assert.equal(source.eligible(),false);assert.equal(invalid,0);
});
test('R10 remote-latency simulation uses one 380ms pixel RPC within unchanged 1500ms budget',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const b=browserFixture(),source=await createControlledCapture(b.browser,()=>{});b.capture=async()=>{await new Promise(resolve=>setTimeout(resolve,380));return frame([255,216,255]);};
 let settled=false;const capture=source.capture(performance.now()+1850).then(bytes=>{settled=true;return bytes;});await drainMicrotasks();t.mock.timers.tick(379);await drainMicrotasks();assert.equal(settled,false);t.mock.timers.tick(1);const bytes=await capture;assert.equal(bytes[0],255);assert.equal(b.events.filter(x=>x?.method==='Page.captureScreenshot').length,1);assert.ok(source.eligible());await source.dispose();
});
test('R10 attempted later navigation suspends capture before any request continues',async()=>{
 const b=browserFixture();let invalid=0;const source=await createControlledCapture(b.browser,()=>invalid++);await b.page.goto('https://private.invalid/signin');assert.ok(invalid);assert.equal(source.eligible(),false);assert.equal(b.events.at(-1),'abort');await assert.rejects(source.capture());await source.dispose();
});
for(const event of ['popup','download','dialog','crash','frameattached','close'])test(`R10 ${event} event discards capture eligibility`,async()=>{
 const b=browserFixture();let invalid=0;const source=await createControlledCapture(b.browser,()=>invalid++);b.page.emit(event,{});assert.ok(invalid);await assert.rejects(source.capture());await source.dispose();
});
test('R10 websocket and unexpected context page cannot retain eligibility',async()=>{
 const b=browserFixture();let invalid=0,closed=false;const source=await createControlledCapture(b.browser,()=>invalid++);b.websocket()({close:()=>closed=true});assert.ok(closed&&invalid);b.context.emit('page',{});assert.equal(source.eligible(),false);await source.dispose();
});
for(const event of ['session','browser','context'])test(`R10 ${event} close synchronously invalidates exact-page CDP eligibility`,async()=>{
 const b=browserFixture();let invalid=0;const source=await createControlledCapture(b.browser,()=>invalid++);b[event].emit(event==='browser'?'disconnected':'close');assert.ok(invalid);assert.equal(source.eligible(),false);await assert.rejects(source.capture(),error=>error instanceof CaptureFailure&&error.reason==='source_invalidated');assert.equal(b.events.filter(x=>x?.method==='Page.captureScreenshot').length,0);await source.dispose();
});
for(const kind of ['wrong_context','wrong_page','extra_frame','wrong_viewport'])test(`R10 ${kind} never starts a pixel command`,async()=>{
 const b=browserFixture(),source=await createControlledCapture(b.browser,()=>{});if(kind==='wrong_context')b.page.context=()=>({});if(kind==='wrong_page')b.context.pages=()=>[{}];if(kind==='extra_frame')b.page.frames=()=>[b.page.mainFrame(),{}];if(kind==='wrong_viewport')b.page.viewportSize=()=>({width:1920,height:1080});
 await assert.rejects(source.capture(),error=>error instanceof CaptureFailure&&error.reason==='source_invalidated');assert.equal(b.events.filter(x=>x?.method==='Page.captureScreenshot').length,0);await source.dispose();
});
for(const kind of ['offset','scale','zoom','width','height','missing','viewport','shrunken','nan','infinite','string_dimensions','fractional'])test(`R10 setup ${kind} mismatch refuses eligibility without pixels`,async()=>{
 const b=browserFixture();b.metrics=async()=>{const m=defaultMetrics();if(kind==='offset')m.cssVisualViewport.pageY=1;if(kind==='scale')m.cssVisualViewport.scale=2;if(kind==='zoom')m.cssVisualViewport.zoom=2;if(kind==='width')m.cssLayoutViewport.clientWidth=961;if(kind==='height')m.cssVisualViewport.clientHeight=541;if(kind==='missing')delete m.cssVisualViewport;if(kind==='viewport')b.page.viewportSize=()=>({width:1920,height:1080});if(kind==='shrunken')m.cssLayoutViewport.clientWidth=m.cssVisualViewport.clientWidth=100;if(kind==='nan')m.cssLayoutViewport.clientWidth=m.cssVisualViewport.clientWidth=NaN;if(kind==='infinite')m.cssLayoutViewport.clientWidth=m.cssVisualViewport.clientWidth=Infinity;if(kind==='string_dimensions')m.cssLayoutViewport.clientWidth=m.cssVisualViewport.clientWidth='960';if(kind==='fractional')m.cssLayoutViewport.clientWidth=m.cssVisualViewport.clientWidth=950.5;return m;};
 await assert.rejects(createControlledCapture(b.browser,()=>{}),error=>error instanceof CaptureSetupFailure&&error.closureConfirmed);assert.equal(b.events.filter(x=>x?.method==='Page.captureScreenshot').length,0);assert.ok(b.events.includes('disconnect'));
});
test('R10 setup accepts scrollbar-excluding CDP metrics while maintaining exact outer viewport and clip',async()=>{
 const b=browserFixture();b.metrics=async()=>{const m=defaultMetrics();m.cssLayoutViewport.clientWidth=m.cssVisualViewport.clientWidth=945;return m;};const source=await createControlledCapture(b.browser,()=>{});assert.ok(source.eligible());await source.capture();assert.deepEqual(b.events.find(x=>x?.method==='Page.captureScreenshot').params,pixelOptions);await source.dispose();
});
test('R10 privacy transition before capture reply drops base64 without decoding',async t=>{
 const b=browserFixture(),source=await createControlledCapture(b.browser,()=>{}),reply=frame([255,216,255]);let decodes=0;const original=Buffer.from;t.mock.method(Buffer,'from',function(value,...args){if(args[0]==='base64')decodes++;return original(value,...args);});
 b.capture=async()=>{b.page.emit('popup',{});return reply;};await assert.rejects(source.capture(),error=>error instanceof CaptureFailure&&error.reason==='source_invalidated');assert.equal(decodes,0);assert.equal(reply.data,'');await source.dispose();
});
test('R10 capture is bounded to 1500ms and raw pending work prevents physical ACK despite successful closes',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const b=browserFixture(),gate=deferred(),source=await createControlledCapture(b.browser,()=>{});b.capture=()=>gate.promise;
 const rejected=assert.rejects(source.capture(),error=>error instanceof CaptureFailure&&error.reason==='timeout'&&error.cause===undefined);await drainMicrotasks();assert.deepEqual(b.events.find(x=>x?.method==='Page.captureScreenshot').params,pixelOptions);
 t.mock.timers.tick(1499);await drainMicrotasks();assert.ok(source.eligible());t.mock.timers.tick(1);await rejected;assert.equal(source.eligible(),false);
 const disposal=source.dispose(),unconfirmed=assert.rejects(disposal,{message:'capture_disposal_unconfirmed'});await drainMicrotasks();assert.ok(b.events.includes('disconnect'));t.mock.timers.tick(WATCH_DISPOSE_TIMEOUT_MS);await unconfirmed;assert.strictEqual(source.dispose(),disposal);
 const reply=frame([255,216,255]);gate.resolve(reply);await drainMicrotasks();assert.equal(reply.data,'');await assert.rejects(source.dispose(),{message:'capture_disposal_unconfirmed'});
});
test('R10 shorter absolute trusted capture cutoff bounds the raw command without extending the 1500ms ceiling',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const b=browserFixture(),gate=deferred(),source=await createControlledCapture(b.browser,()=>{});b.capture=()=>gate.promise;
 const rejected=assert.rejects(source.capture(performance.now()+240),error=>error instanceof CaptureFailure&&error.reason==='timeout');await drainMicrotasks();t.mock.timers.tick(239);await drainMicrotasks();assert.ok(source.eligible());t.mock.timers.tick(1);await rejected;gate.reject(Error('private do-not-expose'));await drainMicrotasks();await source.dispose();
});
for(const cutoff of [0,-1,NaN,Infinity])test(`R10 invalid capture cutoff ${cutoff} dispatches no command`,async()=>{
 const b=browserFixture(),source=await createControlledCapture(b.browser,()=>{});await assert.rejects(source.capture(cutoff),error=>error instanceof CaptureFailure&&error.reason==='timeout');assert.equal(b.events.filter(x=>x?.method==='Page.captureScreenshot').length,0);await source.dispose();
});
for(const phase of ['delayed_entry','eligibility_stall','queued_eligibility_stall','queued_send'])test(`R10 ${phase} cannot renew the absolute trusted capture cutoff or dispatch after it`,async t=>{
 let now=100;t.mock.method(performance,'now',()=>now);const b=browserFixture(),source=await createControlledCapture(b.browser,()=>{}),cutoff=340;
 if(phase==='delayed_entry')now=cutoff;
 if(phase==='eligibility_stall'||phase==='queued_eligibility_stall'){const viewport=b.page.viewportSize;let checks=0;b.page.viewportSize=()=>{checks++;if(phase==='eligibility_stall'||checks>2)now=cutoff;return viewport();};}
 const capture=source.capture(cutoff);if(phase==='queued_send')now=cutoff;
 await assert.rejects(capture,error=>error instanceof CaptureFailure&&error.reason==='timeout');assert.equal(b.events.filter(x=>x?.method==='Page.captureScreenshot').length,0);assert.equal(source.eligible(),false);await source.dispose();
});
test('R10 late protocol response is rejected by monotonic cutoff even when timeout callback has not run',async t=>{
 let now=100;t.mock.method(performance,'now',()=>now);const b=browserFixture(),source=await createControlledCapture(b.browser,()=>{}),reply=frame([255,216,255]);let decodes=0;const original=Buffer.from;t.mock.method(Buffer,'from',function(value,...args){if(args[0]==='base64')decodes++;return original(value,...args);});b.capture=async()=>{now+=1500;return reply;};
 await assert.rejects(source.capture(),error=>error instanceof CaptureFailure&&error.reason==='timeout');assert.equal(decodes,0);assert.equal(reply.data,'');assert.equal(source.eligible(),false);await source.dispose();
});
test('R10 invalidation during decode zeroes decoded bytes synchronously and withholds them',async t=>{
 const b=browserFixture(),source=await createControlledCapture(b.browser,()=>{}),reply=frame([255,216,255]);b.capture=async()=>reply;let decoded;const original=Buffer.from;t.mock.method(Buffer,'from',function(value,...args){const bytes=original(value,...args);if(args[0]==='base64'){decoded=bytes;b.session.emit('close');}return bytes;});
 await assert.rejects(source.capture(),error=>error instanceof CaptureFailure&&error.reason==='source_invalidated');assert.ok(decoded.every(x=>x===0));await source.dispose();
});
test('R10 an ineligible producer classifies invalidation before sending a pixel command',async()=>{
 const b=browserFixture(),source=await createControlledCapture(b.browser,()=>{});source.suspend();await assert.rejects(source.capture(),error=>error instanceof CaptureFailure&&error.reason==='source_invalidated');assert.equal(b.events.filter(x=>x?.method==='Page.captureScreenshot').length,0);await source.dispose();
});
test('R10 command rejection after a privacy event returns only source invalidation',async()=>{
 const b=browserFixture(),source=await createControlledCapture(b.browser,()=>{});b.capture=async()=>{b.page.emit('popup',{});throw Error('private screenshot failure do-not-expose');};
 await assert.rejects(source.capture(),error=>error instanceof CaptureFailure&&error.reason==='source_invalidated'&&error.cause===undefined&&!String(error).includes('do-not-expose'));await source.dispose();
});
for(const kind of ['forged_timeout','hostile_fields','string','sync_throw'])test(`R10 untrusted CDP ${kind} cannot supply diagnostic codes or raw details`,async()=>{
 const b=browserFixture(),source=await createControlledCapture(b.browser,()=>{});let reads=0,hostile='private failure do-not-expose';
 if(kind==='forged_timeout')hostile=Object.assign(Error('private timeout do-not-expose'),{name:'TimeoutError',reason:'timeout'});
 if(kind==='hostile_fields'){hostile={};for(const key of ['name','message','stack','reason'])Object.defineProperty(hostile,key,{get(){reads++;throw Error('do-not-expose');}});}
 if(kind==='sync_throw')b.session.send=()=>{throw hostile;};else b.capture=()=>{throw hostile;};await assert.rejects(source.capture(),error=>error instanceof Error&&!(error instanceof CaptureFailure)&&error.message==='capture_unavailable'&&error.cause===undefined&&error.reason===undefined);assert.equal(reads,0);assert.equal(source.eligible(),true);await source.dispose();
});
for(const kind of ['oversize','bad_jpeg','empty','malformed','bad_padding','not_string'])test(`R10 ${kind} frame is bounded and withheld, with decoded bytes zeroed`,async t=>{
 const b=browserFixture(),source=await createControlledCapture(b.browser,()=>{});let reply=kind==='oversize'?frame(Buffer.alloc(WATCH_MAX_FRAME_BYTES+1,1)):kind==='bad_jpeg'?frame([255,0,255]):{data:''};if(kind==='malformed')reply={data:'%%%='};if(kind==='bad_padding')reply={data:'AA=A'};if(kind==='not_string')reply={data:8};b.capture=async()=>reply;let decoded;const original=Buffer.from;t.mock.method(Buffer,'from',function(value,...args){const bytes=original(value,...args);if(args[0]==='base64')decoded=bytes;return bytes;});
 await assert.rejects(source.capture(),error=>error instanceof CaptureFailure&&error.reason==='frame_invalid');assert.equal(reply.data,'');if(kind==='bad_jpeg')assert.ok(decoded.every(x=>x===0));else assert.equal(decoded,undefined);await source.dispose();
});
for(const phase of ['attach','layout'])test(`R10 hanging raw ${phase} setup cannot be acknowledged by timeout and successful close`,async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const b=browserFixture(),gate=deferred();if(phase==='attach')b.context.newCDPSession=()=>gate.promise;else b.metrics=()=>gate.promise;
 const rejected=assert.rejects(createControlledCapture(b.browser,()=>{}),error=>error instanceof CaptureSetupFailure&&error.closureConfirmed===false);await drainMicrotasks();t.mock.timers.tick(1500);await drainMicrotasks();assert.ok(b.events.includes('disconnect'));t.mock.timers.tick(WATCH_DISPOSE_TIMEOUT_MS);await rejected;
 gate.resolve(phase==='attach'?b.session:defaultMetrics());await drainMicrotasks();assert.equal(b.events.filter(x=>x?.method==='Page.captureScreenshot').length,0);if(phase==='attach')assert.equal(b.events.filter(x=>x?.method==='Page.getLayoutMetrics').length,0);
});
test('R10 late attach settling within disposal still sends no commands and requires positive physical closes',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const b=browserFixture(),gate=deferred();b.context.newCDPSession=()=>gate.promise;const rejected=assert.rejects(createControlledCapture(b.browser,()=>{}),error=>error instanceof CaptureSetupFailure&&error.closureConfirmed===true);
 await drainMicrotasks();t.mock.timers.tick(1500);await drainMicrotasks();assert.ok(b.events.includes('disconnect'));gate.resolve(b.session);await rejected;assert.equal(b.events.filter(x=>x?.method).length,0);
});
test('R10 wrong page appearing during attach prevents setup commands or pixels',async()=>{
 const b=browserFixture();b.context.newCDPSession=async target=>{assert.strictEqual(target,b.page);b.context.pages=()=>[{}];return b.session;};await assert.rejects(createControlledCapture(b.browser,()=>{}),error=>error instanceof CaptureSetupFailure&&error.closureConfirmed);assert.equal(b.events.filter(x=>x?.method).length,0);
});
test('R10 disposal waits for actual in-flight raw capture settlement and discards late base64',async t=>{
 const b=browserFixture(),gate=deferred(),source=await createControlledCapture(b.browser,()=>{});b.capture=()=>gate.promise;const rejected=assert.rejects(source.capture(),error=>error instanceof CaptureFailure&&error.reason==='source_invalidated');await drainMicrotasks();
 let settled=false;const disposal=source.dispose();disposal.then(()=>settled=true);await drainMicrotasks();assert.ok(b.events.includes('disconnect'));assert.equal(settled,false);const reply=frame([255,216,255]);let decodes=0;const original=Buffer.from;t.mock.method(Buffer,'from',function(value,...args){if(args[0]==='base64')decodes++;return original(value,...args);});gate.resolve(reply);await rejected;await disposal;assert.equal(decodes,0);assert.equal(reply.data,'');assert.equal(settled,true);
});
test('R10 overlapping pixel requests suspend the producer without issuing a second command',async()=>{
 const b=browserFixture(),gate=deferred(),source=await createControlledCapture(b.browser,()=>{});b.capture=()=>gate.promise;const first=assert.rejects(source.capture(),error=>error instanceof CaptureFailure&&error.reason==='source_invalidated');await drainMicrotasks();await assert.rejects(source.capture(),error=>error instanceof CaptureFailure&&error.reason==='source_invalidated');assert.equal(b.events.filter(x=>x?.method==='Page.captureScreenshot').length,1);gate.resolve(frame([255,216,255]));await first;await source.dispose();
});
test('R10 Steel creation is separately bounded, nonpersistent and has no profile/context/control request',async()=>{
 const calls=[];const adapter=new SteelBrowserAdapter({config:{apiKey:'inert-test-key',baseUrl:'https://api.steel.dev'},admitDispatch:async r=>calls.push(r),fetcher:async(url,init)=>{
  calls.push({url:String(url),...init});return Response.json({id:'00000000-0000-4000-8000-000000000001',debugUrl:'https://inert.invalid/debug',websocketUrl:'wss://inert.invalid/connect'});
 }});await adapter.createViewerSession(120000,()=>{});const req=calls.find(x=>x.body),body=JSON.parse(req.body);assert.deepEqual(body,{debugConfig:{interactive:false,systemCursor:false},persistProfile:false,useProxy:false,solveCaptcha:false,timeout:120000});assert.equal(req.redirect,'error');assert.equal(calls.filter(x=>x.body).length,1);await assert.rejects(adapter.createViewerSession(120001,()=>{}));await assert.rejects(adapter.createViewerSession(0,()=>{}));
});
test('R10 producer/source boundaries do not reuse saved profiles or broaden embedding headers',()=>{
 const source=readFileSync('src/browser/watch/capture.ts','utf8');assert.ok(!source.includes('contexts()[0]'));assert.ok(!source.includes('route.continue'));assert.ok(!source.includes('setInputFiles'));assert.deepEqual([...source.matchAll(/\.send\("([^"]+)"/g)].map(match=>match[1]),['Page.getLayoutMetrics','Page.captureScreenshot']);assert.ok(!/newBrowserCDPSession|Target\.|Page\.startScreencast|Page\.captureSnapshot|\.screenshot\(/.test(source));
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
