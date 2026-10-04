import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {openWatchStream} from '../.core-tests/browser/watch/runtime.js';
import {WATCH_HTML,WATCH_POLICY} from '../.core-tests/browser/watch/contracts.js';
const hash=createHash('sha256').update(WATCH_HTML).digest('hex');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
async function until(check){for(let i=0;i<100;i++){if(check())return;await pause(10);}assert.ok(check(),'bounded observable completion');}
function fixture(options={}){
 const state={status:'available',events:[],closed:[],creates:0,shots:0,releases:0,disposed:false,suspended:false,invalidator:null,clock:0};
 const control=new AbortController();
 const stamp=()=>new Date().toISOString();
 const deps={sourceHash:hash,authority:async(op,p={})=>{
  state.events.push(op);if(options.authority){const v=await options.authority(op,p,state);if(v!==undefined)return v;}
  if(op==='claim'){state.status='starting';return{allowed:true,status:'starting',epoch:1,serverNow:stamp(),expiresAt:new Date(Date.now()+30_000).toISOString(),timeoutMs:30_000,policyVersion:WATCH_POLICY,sourceHash:hash};}
  if(op==='read')return{status:state.status};
  if(op==='close'){state.closed.push(p);state.status=state.status==='revocation_pending'?'revoked':'ended';return{status:state.status};}
  if(!['starting','watching'].includes(state.status))return{allowed:false};
  if(op==='attest')state.status='watching';
  if(op==='permit')return{allowed:true,epoch:1,serverNow:stamp(),leaseUntil:new Date(Date.now()+2000).toISOString()};
  return{allowed:true};
 },createProvider:async()=>{state.creates++;if(options.create)return options.create(state);return{providerSessionId:'provider-inert',endpoint:'wss://inert.invalid',receiptHash:'a'.repeat(64)};},
 createCapture:async(_endpoint,invalidate)=>{state.invalidator=invalidate;return{contextId:'00000000-0000-4000-8000-000000000001',pageId:'00000000-0000-4000-8000-000000000002',eligible:()=>!state.suspended,
  capture:async()=>{state.shots++;return options.capture?options.capture(state):new Uint8Array([255,216,255,219,0,1]);},suspend(){state.suspended=true;},
  async dispose(){state.disposed=true;if(options.disposeFail)throw Error('inert disposal failure');}};},
 releaseProvider:async()=>{state.releases++;if(options.releaseFail)throw Error('inert release failure');},
 ...(options.monotonic?{monotonic:()=>state.clock}:{})};
 return{state,control,deps,open:()=>openWatchStream(deps,control.signal)};
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
