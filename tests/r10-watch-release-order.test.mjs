import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter,getEventListeners} from 'node:events';
import {readFileSync} from 'node:fs';
import {Module,createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {openWatchStream} from '../.core-tests/browser/watch/runtime.js';
import {createControlledCapture} from '../.core-tests/browser/watch/capture.js';
import {WATCH_POLICY} from '../.core-tests/browser/watch/contracts.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<100;i++)await Promise.resolve();};

// Independent monotonic/host clocks and deterministic timers exercise the
// original deadlines without real providers, network requests, or long waits.
function fixture(t,options={}){
 t.mock.timers.enable({apis:['setTimeout','setInterval']});
 const state={now:0,status:'starting',events:[],closed:[],releases:[],shots:0,disposed:false,suspended:false,finished:false,hostDeadline:150000};
 const control=new AbortController(),host=new AbortController(),completion=deferred(),dispose=deferred(),timeouts=new Map();
 t.mock.method(performance,'now',()=>state.now);
 const set=globalThis.setTimeout,clear=globalThis.clearTimeout;
 t.mock.method(globalThis,'setTimeout',(callback,ms,...args)=>{
  let timer;timer=set(()=>{timeouts.delete(timer);callback(...args);},ms);timeouts.set(timer,ms);return timer;
 });
 t.mock.method(globalThis,'clearTimeout',timer=>{timeouts.delete(timer);clear(timer);});
 const lifetime={signal:host.signal,completion:completion.promise,get workDeadline(){return state.hostDeadline;},finish(){state.finished=true;completion.resolve();}};
 const capture={contextId:'context-inert',pageId:'page-inert',eligible:()=>!state.suspended,
  async capture(){state.shots++;return options.capture?options.capture(state):new Uint8Array([255,216,255,219]);},
  suspend(){state.suspended=true;state.events.push('suspend');},
  async dispose(){state.disposed=true;state.events.push('dispose');await dispose.promise;state.events.push('disposed');},
 };
 const deps={sourceHash:'inert-source',monotonic:()=>state.now,diagnostic(event){
  state.events.push(`${event.phase}:${event.reason}`);
  if(event.phase==='stop')options.onStop?.(state);
 },async authority(op,payload){
  state.events.push(op);
  if(op==='claim')return{allowed:true,epoch:1,serverNow:new Date(0).toISOString(),expiresAt:new Date(options.grantMs??30000).toISOString(),
   timeoutMs:options.timeoutMs??30000,policyVersion:WATCH_POLICY,sourceHash:'inert-source'};
  if(op==='read')return{status:state.status};
  if(op==='close'){state.closed.push(payload);if(options.close)await options.close();return{status:'ended'};}
  if(op==='attest'&&options.attest)await options.attest();
  if(op==='permit')return{allowed:true,epoch:1,serverNow:new Date(0).toISOString(),leaseUntil:new Date(2000).toISOString()};
  return{allowed:true};
 },async createProvider(){state.events.push('create');if(options.provider)await options.provider();return{providerSessionId:'exact-inert-provider',endpoint:'wss://inert.invalid',receiptHash:'a'.repeat(64)};},
 async createCapture(_endpoint,invalidate){state.invalidate=invalidate;if(options.construct)await options.construct();return capture;},
 async releaseProvider(id){state.releases.push({id,at:state.now});state.events.push('release');if(options.release)await options.release();},
 };
 const f={state,control,host,dispose,deps,lifetime,timeouts,capture,
  async advance(ms){state.now+=ms;t.mock.timers.tick(ms);await flush();},
  async open(){const response=await openWatchStream(deps,control.signal,lifetime);await flush();return response;},
  async revoke(){state.status='revocation_pending';await f.advance(250);},
 };
 t.after(async()=>{control.abort();dispose.resolve();await flush();});
 return f;
}
const eof=async response=>assert.deepEqual(await response.body.getReader().read(),{done:true,value:undefined});
const noListeners=f=>{assert.equal(getEventListeners(f.control.signal,'abort').length,0);assert.equal(getEventListeners(f.host.signal,'abort').length,0);};

test('R10 owner revoke gives complete context/disconnect disposal a head start before destructive release',async t=>{
 const context=deferred(),disconnect=deferred(),f=fixture(t),events=[];
 f.capture.dispose=async()=>{f.state.disposed=true;events.push('context:start');await context.promise;events.push('context:closed');
  events.push('disconnect:start');await disconnect.promise;events.push('disconnect:closed');};
 f.deps.releaseProvider=async id=>{assert.equal(id,'exact-inert-provider');events.push('release');f.state.releases.push(id);
  assert.deepEqual(events.slice(0,-1),['context:start','context:closed','disconnect:start','disconnect:closed']);};
 const response=await f.open();await f.revoke();await eof(response);
 assert.equal(f.state.suspended,true);assert.equal(f.state.shots,0);assert.equal(f.state.releases.length,0);assert.equal(f.state.closed.length,0);
 context.resolve();await flush();assert.equal(f.state.releases.length,0);
 disconnect.resolve();await flush();assert.equal(f.state.releases.length,1);assert.equal(f.state.closed.length,1);
 assert.equal(f.state.closed[0].releaseResult,'released');assert.equal(f.state.finished,true);noListeners(f);assert.equal(f.timeouts.size,0);
 await f.advance(20000);f.control.abort();f.host.abort();f.state.invalidate();await flush();assert.equal(f.state.releases.length,1);
});

test('R10 held disposal releases at the two-second cutoff without inventing proof, then accepts genuine late proof in budget',async t=>{
 const f=fixture(t),response=await f.open();await f.revoke();await eof(response);
 assert.equal(f.state.releases.length,0);assert.equal(f.state.closed.length,0);assert.equal(f.state.disposed,true);
 await f.advance(1999);assert.equal(f.state.releases.length,0);
 await f.advance(1);assert.deepEqual(f.state.releases,[{id:'exact-inert-provider',at:2250}]);
 assert.equal(f.state.closed.length,0);noListeners(f);
 f.dispose.resolve();await flush();assert.equal(f.state.closed.length,1);assert.equal(f.state.finished,true);assert.equal(f.timeouts.size,0);
 await f.advance(20000);assert.equal(f.state.releases.length,1);
});

test('R10 rejected disposal dispatches release immediately on settlement and never ACKs',async t=>{
 const f=fixture(t),response=await f.open();await f.revoke();await eof(response);await f.advance(700);
 f.dispose.reject(Error('inert failed closure'));await flush();assert.deepEqual(f.state.releases,[{id:'exact-inert-provider',at:950}]);
 assert.equal(f.state.closed.length,0);assert.equal(f.state.finished,true);noListeners(f);assert.equal(f.timeouts.size,0);
 await f.advance(20000);assert.equal(f.state.releases.length,1);assert.equal(f.state.closed.length,0);
});

test('R10 head-start cutoff cannot acknowledge hung disposal, even after late success beyond cleanup',async t=>{
 const f=fixture(t),response=await f.open();await f.revoke();await eof(response);
 await f.advance(2000);assert.equal(f.state.releases.length,1);assert.equal(f.state.closed.length,0);
 await f.advance(13000);assert.equal(f.state.finished,true);assert.equal(f.state.closed.length,0);
 f.dispose.resolve();await flush();assert.equal(f.state.closed.length,0);noListeners(f);assert.equal(f.timeouts.size,0);
});

for(const kind of ['request','host'])test(`R10 ${kind} abort during grace releases immediately and removes both dedicated listeners`,async t=>{
 const f=fixture(t),response=await f.open();await f.revoke();await eof(response);
 assert.equal(getEventListeners(f.control.signal,'abort').length,1);assert.equal(getEventListeners(f.host.signal,'abort').length,1);
 await f.advance(300);(kind==='request'?f.control:f.host).abort();await flush();
 assert.deepEqual(f.state.releases,[{id:'exact-inert-provider',at:550}]);noListeners(f);assert.equal(f.state.closed.length,0);
 f.dispose.resolve();await flush();await f.advance(20000);assert.equal(f.state.releases.length,1);assert.equal(f.timeouts.size,0);
});

for(const limit of ['grant','provider'])test(`R10 ${limit} original deadline clips grace without renewing the 120-second cap`,async t=>{
 const f=fixture(t,limit==='grant'?{grantMs:30000,timeoutMs:120000}:{grantMs:120000,timeoutMs:30000}),response=await f.open();
 await f.advance(29000);await f.revoke();await eof(response);assert.equal(f.state.releases.length,0);
 await f.advance(599);assert.equal(f.state.releases.length,0);await f.advance(1);
 assert.deepEqual(f.state.releases,[{id:'exact-inert-provider',at:29850}]);assert.equal(f.state.closed.length,0);
 f.dispose.resolve();await flush();assert.equal(f.state.closed.length,1);
});

test('R10 original host work deadline clips grace even before its abort signal fires',async t=>{
 const f=fixture(t),response=await f.open();f.state.hostDeadline=1000;await f.revoke();await eof(response);
 await f.advance(749);assert.equal(f.state.releases.length,0);await f.advance(1);
 assert.deepEqual(f.state.releases,[{id:'exact-inert-provider',at:1000}]);assert.equal(f.host.signal.aborted,false);
 f.dispose.resolve();await flush();assert.equal(f.state.closed.length,1);
});

test('R10 cleanup budget clips grace after synchronous stop work and reserves release plus ACK time',async t=>{
 const f=fixture(t,{onStop:state=>{state.now+=1250;}}),response=await f.open();await f.revoke();await eof(response);
 await f.advance(749);assert.equal(f.state.releases.length,0);await f.advance(1);
 assert.deepEqual(f.state.releases,[{id:'exact-inert-provider',at:2250}]);f.dispose.resolve();await flush();assert.equal(f.state.closed.length,1);
});

test('R10 release operation retains its full ten seconds after grace and close retains the three-second reserve',async t=>{
 const release=deferred(),close=deferred(),f=fixture(t,{release:()=>release.promise,close:()=>close.promise}),response=await f.open();
 await f.revoke();await eof(response);await f.advance(2000);assert.equal(f.state.releases.length,1);
 f.dispose.resolve();await flush();await f.advance(9999);assert.equal(f.state.closed.length,0);assert.equal(f.state.finished,false);
 await f.advance(1);assert.equal(f.state.closed.length,1);assert.equal(f.state.closed[0].releaseResult,'unknown');assert.equal(f.state.finished,false);
 await f.advance(2999);assert.equal(f.state.finished,false);close.resolve();release.resolve();await flush();
 assert.equal(f.state.finished,true);assert.equal(f.state.now,15249);assert.equal(f.timeouts.size,0);noListeners(f);
});

for(const path of ['request-abort','host-abort','cancel','expired','host-expired','no-budget'])test(`R10 ${path} retains immediate release while disposal is held`,async t=>{
 const f=fixture(t,path==='no-budget'?{onStop:state=>{state.now+=2000;}}:{}),response=await f.open();
 let cancelled;
 if(path==='request-abort')f.control.abort();
 else if(path==='host-abort')f.host.abort();
 else if(path==='cancel')cancelled=response.body.cancel();
 else if(path==='expired')await f.advance(29850);
 else {if(path==='host-expired')f.state.hostDeadline=0;await f.revoke();}
 await flush();assert.equal(f.state.releases.length,1);assert.equal(f.state.releases[0].at,f.state.now);
 assert.equal(f.state.closed.length,0);assert.equal(f.state.disposed,true);noListeners(f);
 if(path!=='cancel')await eof(response);f.dispose.resolve();await cancelled;await flush();assert.equal(f.state.closed.length,1);
});

test('R10 known provider with unfinished capture construction releases without waiting for construction',async t=>{
 const construct=deferred(),f=fixture(t,{construct:()=>construct.promise}),response=await f.open();
 await f.revoke();await eof(response);assert.equal(f.state.releases.length,1);assert.equal(f.state.disposed,false);assert.equal(f.state.closed.length,0);
 construct.resolve();await flush();assert.equal(f.state.disposed,true);assert.equal(f.state.shots,0);
 f.dispose.resolve();await flush();assert.equal(f.state.closed.length,1);assert.equal(f.state.releases.length,1);
});

test('R10 provider identity arriving after non-abort stop is released immediately without a new head start',async t=>{
 const provider=deferred(),f=fixture(t,{provider:()=>provider.promise}),response=await f.open();
 await f.revoke();await eof(response);assert.equal(f.state.releases.length,0);assert.equal(f.state.closed.length,0);
 await f.advance(400);provider.resolve();await flush();assert.deepEqual(f.state.releases,[{id:'exact-inert-provider',at:650}]);
 assert.equal(f.state.disposed,false);assert.equal(f.state.shots,0);assert.equal(f.state.closed.length,1);noListeners(f);assert.equal(f.timeouts.size,0);
});

test('R10 non-abort queued-packet path purges bytes and releases immediately with held disposal',async t=>{
 const shot=deferred(),f=fixture(t,{capture:()=>shot.promise}),response=await f.open(),reader=response.body.getReader();
 const read=assert.rejects(reader.read(),{name:'TypeError'});await flush();assert.equal(f.state.shots,1);reader.releaseLock();await read;
 shot.resolve(new Uint8Array([255,216,255,219]));await flush();assert.ok(f.state.events.includes('delivery:completed'));
 await f.revoke();assert.equal(f.state.releases.length,1);assert.equal(f.state.closed.length,0);assert.equal(f.state.suspended,true);
 await assert.rejects(response.body.getReader().read(),{name:'AbortError'});f.dispose.resolve();await flush();assert.equal(f.state.closed.length,1);
});

for(const path of ['unknown-queue','close-throws'])test(`R10 ${path} cannot retain release grace and the source predicate is sampled once`,async t=>{
 const f=fixture(t),Stream=globalThis.ReadableStream;let samples=0,sourceController;
 t.mock.method(globalThis,'ReadableStream',function(source,strategy){return new Stream({...source,start(controller){
  sourceController=controller;Object.defineProperty(controller,'desiredSize',{get(){samples++;return path==='unknown-queue'?null:0;}});
  if(path==='close-throws')controller.close=()=>{throw Error('inert cancelled source');};return source.start(controller);
 }},strategy);});
 const response=await f.open();await f.revoke();assert.equal(samples,1);assert.equal(f.state.releases.length,1);assert.equal(f.state.closed.length,0);noListeners(f);
 if(path==='unknown-queue')await assert.rejects(response.body.getReader().read(),{name:'AbortError'});
 else sourceController.error(Error('inert test teardown'));
 f.dispose.resolve();await flush();assert.equal(f.state.releases.length,1);assert.equal(f.timeouts.size,0);
});

test('R10 no source controller on claim failure cannot create a head start or provider',async t=>{
 const f=fixture(t);f.deps.authority=async()=>{throw Error('inert claim rejection');};
 await assert.rejects(f.open());await flush();assert.equal(f.state.releases.length,0);assert.equal(f.state.disposed,false);
 assert.equal(f.state.finished,true);assert.equal(f.timeouts.size,0);noListeners(f);
});

test('R10 repeated invalidation cannot renew the original release cutoff',async t=>{
 const f=fixture(t),response=await f.open();await f.revoke();await eof(response);await f.advance(1000);
 f.state.invalidate();f.state.invalidate();await flush();await f.advance(999);assert.equal(f.state.releases.length,0);
 await f.advance(1);assert.deepEqual(f.state.releases,[{id:'exact-inert-provider',at:2250}]);
 f.dispose.resolve();await flush();assert.equal(f.state.closed.length,1);assert.equal(f.timeouts.size,0);
});

test('R10 installed capture does not wait for a stalled final attest before disposal or bounded release',async t=>{
 const attest=deferred(),f=fixture(t,{attest:()=>attest.promise}),response=await f.open();
 await f.revoke();await eof(response);assert.equal(f.state.disposed,true);assert.equal(f.state.releases.length,0);
 await f.advance(2000);assert.equal(f.state.releases.length,1);assert.equal(f.state.closed.length,0);
 f.dispose.resolve();await flush();assert.equal(f.state.closed.length,0);
 await f.advance(13000);assert.equal(f.state.finished,true);assert.equal(f.state.closed.length,0);
 attest.resolve();await flush();assert.equal(f.state.releases.length,1);assert.equal(f.state.closed.length,0);
});

// Exact installed SDK close methods, with only the channel endpoints inert.
// Keep this separate from the original capture-proof suite so none of its
// abort-driven immediate-release guards need modification for the new grace.
const sdkFile=join(dirname(createRequire(import.meta.url).resolve('playwright-core/package.json')),'lib/coreBundle.js');
const sdkModule=new Module(sdkFile);sdkModule.filename=sdkFile;sdkModule.paths=Module._nodeModulePaths(dirname(sdkFile));
sdkModule._compile(readFileSync(sdkFile,'utf8')+'\nmodule.exports.__releaseProofHarness={Browser2,BrowserContext2,CRConnection,CDPSession,nullProgress};',sdkFile);
const {Browser2,BrowserContext2,CRConnection,CDPSession,nullProgress}=sdkModule.exports.__releaseProofHarness;
function sdkBrowserFixture(){
 const browser=new EventEmitter(),context=new EventEmitter(),page=new EventEmitter(),session=new EventEmitter(),events=[];
 const contextClosed=deferred(),browserClosed=deferred();let route,url='about:blank',closed=false,connected=true;
 const b={browser,context,page,session,events,capture:async()=>({data:Buffer.from([255,216,255,219]).toString('base64')}),
  closeContext(){if(closed)return;closed=true;context._closingStatus='closed';events.push('context-close-observed');context.emit('close');session.emit('close');contextClosed.resolve();},
  disconnect(){if(!connected)return;connected=false;events.push('disconnect-observed');browser.emit('disconnected');browserClosed.resolve();},
 };
 b.contextCommand=async()=>{b.closeContext();};b.disconnectCommand=async()=>{b.disconnect();};
 const main={url:()=>url};Object.assign(page,{mainFrame:()=>main,context:()=>context,viewportSize:()=>({width:960,height:540}),url:()=>url,isClosed:()=>closed,frames:()=>[main],
  async goto(next){await route({request:()=>({url:()=>next,method:()=> 'GET',isNavigationRequest:()=>true,frame:()=>main}),
   fulfill:async()=>{url=next;page.emit('framenavigated',main);},abort:async()=>{throw Error('unexpected request');}});},
 });
 Object.assign(context,{routeWebSocket:async()=>{},route:async(_,handler)=>{route=handler;},newPage:async()=>{context.emit('page',page);return page;},
  newCDPSession:async candidate=>{assert.strictEqual(candidate,page);return session;},pages:()=>[page],cookies:async()=>[],
  _closingStatus:'none',isClosed:BrowserContext2.prototype.isClosed,request:{dispose:async()=>{}},
  _instrumentation:{runBeforeCloseBrowserContext:async()=>{}},tracing:{_exportAllHars:async()=>{}},_closedPromise:contextClosed.promise,
  _channel:{close:async()=>{events.push('context-close-command');await b.contextCommand();}},close:options=>BrowserContext2.prototype.close.call(context,options),
 });
 Object.assign(session,{async send(method){
  if(method==='Page.getLayoutMetrics')return{cssLayoutViewport:{pageX:0,pageY:0,clientWidth:960,clientHeight:540},
   cssVisualViewport:{pageX:0,pageY:0,offsetX:0,offsetY:0,clientWidth:960,clientHeight:540,scale:1,zoom:1}};
  if(method==='Page.captureScreenshot'){events.push('raw-capture');return b.capture();}throw Error('unexpected protocol method');
 }});
 Object.assign(browser,{newContext:async()=>context,isConnected:()=>connected,_shouldCloseConnectionOnClose:false,_closedPromise:browserClosed.promise,
  _channel:{close:async()=>{events.push('browser-close-command');await b.disconnectCommand();}},close:options=>Browser2.prototype.close.call(browser,options),
 });
 return b;
}
function sdkFixture(t){
 const f=fixture(t),b=sdkBrowserFixture(),release=f.deps.releaseProvider;
 f.deps.createCapture=async(_endpoint,invalidate)=>{const source=await createControlledCapture(b.browser,invalidate);f.state.source=source;return source;};
 f.deps.releaseProvider=async id=>{b.events.push('release');b.closeContext();b.disconnect();await release(id);};
 return{f,b};
}

test('R10 owner revoke with installed SDK proves context close and disconnect before destructive release and ACK',async t=>{
 const {f,b}=sdkFixture(t),response=await f.open(),reader=response.body.getReader();await reader.read();
 await f.revoke();assert.deepEqual(await reader.read(),{done:true,value:undefined});
 assert.deepEqual(b.events,['raw-capture','context-close-command','context-close-observed','browser-close-command','disconnect-observed','release']);
 assert.equal(f.state.source.eligible(),false);assert.deepEqual(f.state.releases,[{id:'exact-inert-provider',at:250}]);
 assert.equal(f.state.closed.length,1);assert.equal(f.state.closed[0].releaseResult,'released');assert.equal(f.state.closed[0].deliveredFrames,1);
 assert.equal(f.state.finished,true);assert.equal(f.timeouts.size,0);noListeners(f);await f.advance(20000);assert.equal(f.state.releases.length,1);
});

for(const phase of ['context','disconnect'])test(`R10 installed SDK held ${phase} command releases at cutoff but cannot ACK on timeout or late command settlement`,async t=>{
 const {f,b}=sdkFixture(t),gate=deferred();
 if(phase==='context')b.contextCommand=async()=>{await gate.promise;b.closeContext();};
 else b.disconnectCommand=async()=>{await gate.promise;b.disconnect();};
 const response=await f.open();await f.revoke();await eof(response);assert.equal(f.state.releases.length,0);
 await f.advance(1999);assert.equal(f.state.releases.length,0);await f.advance(1);assert.equal(f.state.releases.length,1);assert.equal(f.state.closed.length,0);
 await f.advance(3000);assert.equal(f.state.closed.length,0);assert.equal(f.state.finished,true);
 gate.resolve();await flush();assert.equal(f.state.closed.length,0);assert.equal(f.state.releases.length,1);noListeners(f);assert.equal(f.timeouts.size,0);
});

test('R10 installed SDK rejected context proof releases on disposal rejection without ACK or the full grace',async t=>{
 const {f,b}=sdkFixture(t);b.contextCommand=async()=>{throw Error('inert failed context command');};
 const response=await f.open();await f.revoke();await eof(response);
 assert.deepEqual(f.state.releases,[{id:'exact-inert-provider',at:250}]);assert.equal(f.state.closed.length,0);assert.equal(f.state.finished,true);
 assert.ok(b.events.indexOf('browser-close-command')<b.events.indexOf('release'));assert.equal(f.timeouts.size,0);noListeners(f);
});

test('R10 installed SDK nested raw command remains unconfirmed after grace release and transport loss without exact detach',async t=>{
 const {f,b}=sdkFixture(t),transport={send(){},close(){}},connection=new CRConnection({attribution:{},instrumentation:{}},transport,()=>{},{recentLogs:()=>[]});
 const browserSession=new CDPSession(connection.rootSession,'browser-session'),pageSession=new CDPSession(browserSession._session,'exact-page-session');
 b.capture=()=>pageSession.send(nullProgress,'Page.captureScreenshot',{});const release=f.deps.releaseProvider;
 f.deps.releaseProvider=async id=>{transport.onclose('inert loss without detach');await release(id);};
 const response=await f.open(),read=response.body.getReader().read();await flush();assert.ok(b.events.includes('raw-capture'));
 await f.revoke();assert.deepEqual(await read,{done:true,value:undefined});assert.equal(f.state.releases.length,0);
 await f.advance(2000);assert.equal(f.state.releases.length,1);assert.equal(f.state.closed.length,0);assert.equal(f.state.finished,false);
 await f.advance(3000);assert.equal(f.state.closed.length,0);assert.equal(f.state.finished,true);
 pageSession._onClose();await flush();assert.equal(f.state.closed.length,0);assert.equal(f.state.releases.length,1);assert.equal(f.timeouts.size,0);noListeners(f);
});
