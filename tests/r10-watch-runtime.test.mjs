import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {openWatchStream} from '../.core-tests/browser/watch/runtime.js';
import {createWatchLifetime} from '../.core-tests/browser/watch/lifetime.js';
import {WATCH_HTML,WATCH_POLICY} from '../.core-tests/browser/watch/contracts.js';
const hash=createHash('sha256').update(WATCH_HTML).digest('hex');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
async function until(check){for(let i=0;i<100;i++){if(check())return;await pause(10);}assert.ok(check(),'bounded observable completion');}
function fixture(options={}){
 const state={status:'available',events:[],closed:[],creates:0,shots:0,releases:0,disposed:false,suspended:false,invalidator:null,clock:0,diagnostics:[],registered:false,cleanupDone:false};
 const control=new AbortController();
 const deps={diagnostic:event=>state.diagnostics.push(event),sourceHash:hash,authority:async(op,p={})=>{
  const now=Date.now(),stamp=()=>new Date(now).toISOString();
  state.events.push(op);if(options.authority){const v=await options.authority(op,p,state);if(v!==undefined)return v;}
  if(op==='claim'){state.status='starting';return{allowed:true,status:'starting',epoch:1,serverNow:stamp(),expiresAt:new Date(now+30_000).toISOString(),timeoutMs:30_000,policyVersion:WATCH_POLICY,sourceHash:hash};}
  if(op==='read')return{status:state.status};
  if(op==='close'){state.closed.push(p);state.status=state.status==='revocation_pending'?'revoked':'ended';return{status:state.status};}
  if(!['starting','watching'].includes(state.status))return{allowed:false};
  if(op==='attest')state.status='watching';
  if(op==='permit')return{allowed:true,epoch:1,serverNow:stamp(),leaseUntil:new Date(now+2000).toISOString()};
  return{allowed:true};
 },createProvider:async()=>{state.creates++;if(options.create)return options.create(state);return{providerSessionId:'provider-inert',endpoint:'wss://inert.invalid',receiptHash:'a'.repeat(64)};},
 createCapture:async(_endpoint,invalidate)=>{state.invalidator=invalidate;return{contextId:'00000000-0000-4000-8000-000000000001',pageId:'00000000-0000-4000-8000-000000000002',eligible:()=>!state.suspended,
  capture:async()=>{state.shots++;return options.capture?options.capture(state):new Uint8Array([255,216,255,219,0,1]);},suspend(){state.suspended=true;},
  async dispose(){state.disposed=true;if(options.disposeFail)throw Error('inert disposal failure');}};},
 releaseProvider:async()=>{state.releases++;if(options.releaseFail)throw Error('inert release failure');},
 ...(options.monotonic?{monotonic:()=>state.clock}:{})};
 return{state,control,deps,open:()=>{
  const lifetime=createWatchLifetime(completion=>{state.registered=true;state.events.push('hosting_registered');state.completion=completion;void completion.then(()=>{state.cleanupDone=true;});});
  state.lifetime=lifetime;
  return openWatchStream(deps,control.signal,lifetime);
 }};
}
test('R10 stream emits only bounded exact source JPEG packets then physically disposes before close ACK',async()=>{
 const f=fixture(),response=await f.open(),reader=response.body.getReader();assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
 const packet=JSON.parse(new TextDecoder().decode((await reader.read()).value));assert.deepEqual(Object.keys(packet).sort(),['capturedAt','data','epoch','mime','sequence','type']);assert.equal(packet.epoch,1);assert.equal(packet.sequence,1);assert.equal(packet.mime,'image/jpeg');assert.equal(f.state.shots,1);
 f.control.abort();await until(()=>f.state.closed.length===1);assert.ok(f.state.suspended&&f.state.disposed);assert.equal(f.state.releases,1);assert.equal(f.state.closed[0].releaseResult,'released');await assert.rejects(reader.read());
});
test('R10 rejects denied dispatch before any provider call',async()=>{
 const f=fixture({authority:op=>op==='create_dispatched'?{allowed:false}:undefined}),r=await f.open();await assert.rejects(r.body.getReader().read());await until(()=>f.state.closed.length===1);assert.equal(f.state.creates,0);assert.equal(f.state.closed[0].releaseResult,'not_created');
});
test('R10 independent revoke watcher errors an already open stream even under backpressure',async()=>{
 const f=fixture(),r=await f.open();await until(()=>f.state.status==='watching');assert.equal(f.state.shots,0);f.state.status='revocation_pending';await until(()=>f.state.closed.length===1);assert.equal(f.state.status,'revoked');assert.equal(f.state.shots,0);await assert.rejects(r.body.getReader().read());
});
test('R10 revoke during in-flight screenshot discards late buffered bytes and never enqueues them',async()=>{
 const shot=deferred(),pixels=new Uint8Array([255,216,255,219]),f=fixture({capture:()=>shot.promise}),r=await f.open(),reader=r.body.getReader(),read=reader.read();const rejected=assert.rejects(read);
 await until(()=>f.state.shots===1);f.state.status='revocation_pending';await until(()=>f.state.disposed);assert.equal(f.state.closed.length,0);shot.resolve(pixels);await rejected;await until(()=>pixels.every(x=>x===0)&&f.state.closed.length===1);assert.equal(f.state.closed[0].capturedFrames,1);assert.equal(f.state.closed[0].deliveredFrames,0);
});
test('R10 producer privacy event suspends before a frame can be delivered',async()=>{
 const f=fixture({capture:state=>{state.invalidator();return new Uint8Array([255,216,255]);}}),r=await f.open();await assert.rejects(r.body.getReader().read());await until(()=>f.state.closed.length===1);assert.equal(f.state.shots,1);
});
test('R10 elapsed request latency cannot renew an already expired capture permit',async()=>{
 const f=fixture({monotonic:true,authority:(op,_p,state)=>{if(op==='permit'){state.clock+=2001;return{allowed:true,epoch:1,serverNow:new Date(0).toISOString(),leaseUntil:new Date(2000).toISOString()};}}}),r=await f.open();await assert.rejects(r.body.getReader().read());await until(()=>f.state.closed.length===1);assert.equal(f.state.shots,0);
});
test('R10 stale screenshot crosses no final delivery fence',async()=>{
 const f=fixture({monotonic:true,capture:state=>{state.clock+=2001;return new Uint8Array([255,216,255]);}}),r=await f.open();await assert.rejects(r.body.getReader().read());await until(()=>f.state.closed.length===1);assert.equal(f.state.events.filter(x=>x==='permit').length,1);
});
test('R10 authority outage fails closed after a stream is established',async()=>{
 const f=fixture({authority:(op,_p,state)=>{if(op==='read'&&state.shots)throw Error('inert outage');}}),r=await f.open(),reader=r.body.getReader();await reader.read();await until(()=>f.state.closed.length===1);await assert.rejects(reader.read());
});
test('R10 ambiguous create is consumed once and cannot be mislabeled unsent',async()=>{
 const f=fixture({create:()=>{throw Error('ambiguous timeout');}}),r=await f.open();await assert.rejects(r.body.getReader().read());await until(()=>f.state.closed.length===1);assert.equal(f.state.creates,1);assert.equal(f.state.closed[0].outcome,'uncertain');assert.equal(f.state.closed[0].releaseResult,'unknown');
});
test('R10 failed context disposal never acknowledges physical stream closure',async()=>{
 const f=fixture({disposeFail:true}),r=await f.open(),reader=r.body.getReader();await reader.read();f.control.abort();await until(()=>f.state.disposed);await pause(30);assert.equal(f.state.closed.length,0);await assert.rejects(reader.read());
});
test('R10 release failure is recorded without claiming provider release',async()=>{
 const f=fixture({releaseFail:true}),r=await f.open();await r.body.getReader().read();f.control.abort();await until(()=>f.state.closed.length===1);assert.equal(f.state.closed[0].releaseResult,'failed');
});
test('R10 cancellation during provider creation releases late session without pixels or retry',async()=>{
 const created=deferred(),f=fixture({create:()=>created.promise}),r=await f.open(),read=r.body.getReader().read(),rejected=assert.rejects(read);await until(()=>f.state.creates===1);f.control.abort();created.resolve({providerSessionId:'late-inert',endpoint:'wss://inert.invalid',receiptHash:'a'.repeat(64)});await rejected;await until(()=>f.state.closed.length===1);assert.equal(f.state.creates,1);assert.equal(f.state.releases,1);assert.equal(f.state.shots,0);
});
test('R10 partial constructor cleanup failure cannot become physical close acknowledgment',async()=>{
 const {CaptureSetupFailure}=await import('../.core-tests/browser/watch/contracts.js');const f=fixture();f.deps.createCapture=async()=>{throw new CaptureSetupFailure(false);};const r=await f.open();await assert.rejects(r.body.getReader().read());await until(()=>f.state.releases===1);assert.equal(f.state.closed.length,0);
});
test('R10 partial constructor with verified cleanup may acknowledge closed stream',async()=>{
 const {CaptureSetupFailure}=await import('../.core-tests/browser/watch/contracts.js');const f=fixture();f.deps.createCapture=async()=>{throw new CaptureSetupFailure(true);};const r=await f.open();await assert.rejects(r.body.getReader().read());await until(()=>f.state.closed.length===1);assert.equal(f.state.releases,1);
});


test('R10 hosting lifetime is registered before claim, early rejection and pre-first-frame capture failure',async()=>{
 for(const mode of ['claim','capture']){
  const f=fixture({authority:op=>{if(mode==='claim'&&op==='claim')throw Error('hostile https://endpoint.invalid/?key=SECRET');},capture:()=>{throw Error('hostile SECRET screenshot');}});
  if(mode==='claim')await assert.rejects(f.open());else{const response=await f.open();await assert.rejects(response.body.getReader().read());}
  await f.state.completion;assert.equal(f.state.events[0],'hosting_registered');assert.equal(f.state.cleanupDone,true);assert.equal(f.state.closed.length,1);
  assert.equal(f.state.closed[0].deliveredFrames,0);assert.equal(f.state.creates,mode==='claim'?0:1);
 }
});

test('R10 hosting registration precedes an already aborted request without any create',async()=>{
 const f=fixture();f.control.abort();await assert.rejects(f.open());await f.state.completion;
 assert.equal(f.state.events[0],'hosting_registered');assert.equal(f.state.creates,0);assert.equal(f.state.cleanupDone,true);
});

test('R10 rejected and stalled disposal cannot delay exact-session release or manufacture ACK',async()=>{
 for(const rejected of [false,true]){
  const gate=deferred(),f=fixture(),original=f.deps.createCapture;
  f.deps.createCapture=async(...args)=>{const capture=await original(...args);return{...capture,dispose:async()=>{f.state.disposed=true;if(rejected)throw Error('private close error');await gate.promise;}};};
  const response=await f.open(),reader=response.body.getReader();await reader.read();f.control.abort();await assert.rejects(reader.read());
  await until(()=>f.state.releases===1);assert.equal(f.state.closed.length,0);assert.equal(f.state.suspended,true);
  if(!rejected){assert.equal(f.state.cleanupDone,false);gate.resolve();}
  await f.state.completion;assert.equal(f.state.closed.length,rejected?0:1);assert.equal(f.state.creates,1);
 }
});

test('R10 cancellation during capture setup releases before setup finishes and disposes late constructor',async()=>{
 const gate=deferred(),f=fixture(),original=f.deps.createCapture;
 f.deps.createCapture=async(...args)=>{const value=await original(...args);await gate.promise;return value;};
 const response=await f.open(),reader=response.body.getReader(),reading=assert.rejects(reader.read());
 await until(()=>f.state.invalidator!==null);f.control.abort();await until(()=>f.state.releases===1);
 assert.equal(f.state.disposed,false);assert.equal(f.state.closed.length,0);gate.resolve();await reading;await f.state.completion;
 assert.equal(f.state.suspended,true);assert.equal(f.state.disposed,true);assert.equal(f.state.closed.length,1);assert.equal(f.state.shots,0);assert.equal(f.state.creates,1);
});

test('R10 cleanup timeout settles the registered lifetime without ACK and late pixels are zeroed',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const gate=deferred(),pixels=new Uint8Array([255,216,255]),f=fixture({capture:()=>gate.promise}),response=await f.open(),reader=response.body.getReader();
 const reading=assert.rejects(reader.read());await until(()=>f.state.shots===1);
 f.control.abort();for(let i=0;i<30;i++)await Promise.resolve();assert.equal(f.state.disposed,true);
 t.mock.timers.tick(15_001);for(let i=0;i<30;i++)await Promise.resolve();
 await f.state.completion;assert.equal(f.state.closed.length,0);assert.equal(f.state.releases,1);assert.equal(f.state.creates,1);
 gate.resolve(pixels);await reading;for(let i=0;i<15;i++)await Promise.resolve();assert.ok(pixels.every(byte=>byte===0));assert.equal(f.state.closed.length,0);
 assert.ok(f.state.diagnostics.some(event=>event.phase==='capture_settle'&&event.reason==='timeout'));
});

test('R10 only allowlisted phase/reason codes and bounded numeric fields survive hostile failures',async()=>{
 const hostile='SECRET_AUTH https://connect.steel.dev/?apiKey=SECRET provider-id owner-id page-content';
 const f=fixture({capture:()=>{throw new Error(hostile);}}),response=await f.open();await assert.rejects(response.body.getReader().read());await f.state.completion;
 assert.doesNotMatch(JSON.stringify(f.state.diagnostics),/SECRET|https|provider-id|owner-id|page-content/);
 for(const event of f.state.diagnostics){assert.deepEqual(Object.keys(event).sort(),['capturedFrames','deliveredFrames','durationMs','phase','reason','remainingMs']);for(const key of ['capturedFrames','deliveredFrames','durationMs','remainingMs'])assert.ok(Number.isFinite(event[key])&&event[key]>=0);}
 assert.ok(f.state.diagnostics.some(event=>event.phase==='capture'&&event.reason==='failed'),JSON.stringify(f.state.diagnostics));
 assert.ok(f.state.diagnostics.some(event=>event.phase==='capture_permit'&&event.reason==='completed'));
});

test('R10 permits retain measured latency and screenshot expiry diagnostics without extending capture time',async()=>{
 const f=fixture({monotonic:true,authority:(op,_payload,state)=>{if(op==='permit'){state.clock+=800;return{allowed:true,epoch:1,serverNow:new Date(0).toISOString(),leaseUntil:new Date(2000).toISOString()};}},capture:state=>{state.clock+=1100;return new Uint8Array([255,216,255]);}}),response=await f.open();
 await assert.rejects(response.body.getReader().read());await f.state.completion;
 assert.ok(f.state.diagnostics.some(event=>event.phase==='capture_permit'&&event.durationMs===800));assert.ok(f.state.diagnostics.some(event=>event.phase==='capture'&&event.durationMs===1100));
 assert.ok(f.state.diagnostics.some(event=>event.phase==='capture_lease'&&event.reason==='expired'));assert.equal(f.state.events.filter(value=>value==='permit').length,1);assert.equal(f.state.closed[0].deliveredFrames,0);
});


test('R10 a hung claim cannot hold the response after abort or fabricate settled setup',async()=>{
 const gate=deferred(),f=fixture({authority:op=>op==='claim'?gate.promise:undefined});
 const opening=assert.rejects(f.open());await until(()=>f.state.events.includes('claim'));f.control.abort();await opening;
 assert.equal(f.state.creates,0);assert.equal(f.state.closed.length,0);assert.equal(f.state.cleanupDone,false);
 gate.reject(new Error('private authority failure'));await f.state.completion;assert.equal(f.state.closed.length,1);assert.equal(f.state.closed[0].releaseResult,'not_created');
});


test('R10 hung disposal times out with release attempted and never ACKs even after late success',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const gate=deferred(),f=fixture(),original=f.deps.createCapture;
 f.deps.createCapture=async(...args)=>{const value=await original(...args);return{...value,dispose:async()=>{f.state.disposed=true;await gate.promise;}};};
 const response=await f.open(),reader=response.body.getReader();await reader.read();f.control.abort();for(let i=0;i<40;i++)await Promise.resolve();
 assert.equal(f.state.releases,1);assert.equal(f.state.closed.length,0);t.mock.timers.tick(15_001);for(let i=0;i<40;i++)await Promise.resolve();await f.state.completion;
 assert.equal(f.state.closed.length,0);gate.resolve();for(let i=0;i<20;i++)await Promise.resolve();assert.equal(f.state.closed.length,0);assert.ok(f.state.diagnostics.some(event=>event.phase==='dispose'&&event.reason==='timeout'));
});

test('R10 stalled release preserves unknown release truth and leaves time for a genuinely disposed close',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const gate=deferred(),f=fixture();f.deps.releaseProvider=async()=>{f.state.releases++;await gate.promise;};
 const response=await f.open();await response.body.getReader().read();f.control.abort();for(let i=0;i<40;i++)await Promise.resolve();assert.equal(f.state.disposed,true);assert.equal(f.state.closed.length,0);
 t.mock.timers.tick(10_001);for(let i=0;i<40;i++)await Promise.resolve();await f.state.completion;
 assert.equal(f.state.closed.length,1);assert.equal(f.state.closed[0].releaseResult,'unknown');assert.ok(f.state.diagnostics.some(event=>event.phase==='release'&&event.reason==='timeout'));gate.resolve();
});
