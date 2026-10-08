import test from 'node:test';
import assert from 'node:assert/strict';
import {getEventListeners} from 'node:events';
import {createServer} from 'node:http';
import {awaitRequestDeadline,boundedRpc,deadlineFetch,requestDeadline} from '../.core-tests/core/request-deadline.js';

const pending=()=>new Promise(()=>{});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
async function within(work,ms=2000){
 let timer;
 try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Synthetic test guard expired')),ms);})]);}
 finally{clearTimeout(timer);}
}
function builder(work){
 const seen={signals:[],subscriptions:0};
 const query={abortSignal(signal){seen.signals.push(signal);return this;},then(resolve,reject){seen.subscriptions++;return work.then(resolve,reject);}};
 return{query,seen};
}

test('Caller deadline rejects a permanently pending operation without continuing dependent work',async()=>{
 const controller=new AbortController();let continued=0;
 const call=awaitRequestDeadline(pending(),controller.signal).then(()=>{continued++;});
 assert.equal(getEventListeners(controller.signal,'abort').length,1);
 controller.abort();
 await assert.rejects(within(call),/request_deadline_exceeded/);
 assert.equal(continued,0);
 assert.equal(getEventListeners(controller.signal,'abort').length,0);
});

test('Per-RPC deadline bounds a never-settling query and passes a combined signal through the PostgREST builder',async()=>{
 const controller=new AbortController(),f=builder(pending());
 await assert.rejects(within(boundedRpc(f.query,controller.signal,20)),/request_deadline_exceeded/);
 assert.equal(f.seen.signals.length,1);assert.equal(f.seen.subscriptions,1);
 assert.ok(f.seen.signals[0] instanceof AbortSignal);assert.equal(f.seen.signals[0].aborted,true);
 assert.equal(controller.signal.aborted,false);
 assert.equal(getEventListeners(f.seen.signals[0],'abort').length,0);
});

test('Inert promises without abortSignal retain the same finite caller timeout',async()=>{
 const controller=new AbortController();
 await assert.rejects(within(boundedRpc(pending(),controller.signal,20)),/request_deadline_exceeded/);
 assert.equal(controller.signal.aborted,false);
});

test('An already-aborted global deadline never starts a lazy RPC builder',async()=>{
 const controller=new AbortController(),reason=Error('Synthetic request already stopped'),f=builder(pending());
 controller.abort(reason);
 await assert.rejects(boundedRpc(f.query,controller.signal,1000),error=>error===reason);
 assert.deepEqual(f.seen,{signals:[],subscriptions:0});
});

test('An already-aborted deadline never subscribes to lazy work or calls provider fetch',()=>{
 const controller=new AbortController(),reason=Error('Synthetic request already stopped');
 controller.abort(reason);let subscribed=0,fetches=0;
 assert.throws(()=>awaitRequestDeadline({then(){subscribed++;}},controller.signal),error=>error===reason);
 const fetcher=deadlineFetch(controller.signal,()=>{fetches++;return Promise.resolve(new Response('unexpected'));});
 assert.throws(()=>fetcher('https://provider.invalid/inert'),error=>error===reason);
 assert.equal(subscribed,0);assert.equal(fetches,0);
});

test('An already-aborted provider-specific deadline never invokes its fetcher',()=>{
 const global=new AbortController(),local=new AbortController(),reason=Error('Synthetic provider already stopped');let fetches=0;
 local.abort(reason);
 const fetcher=deadlineFetch(global.signal,()=>{fetches++;return Promise.resolve(new Response('unexpected'));});
 assert.throws(()=>fetcher('https://provider.invalid/inert',{signal:local.signal}),error=>error===reason);
 assert.equal(fetches,0);assert.equal(global.signal.aborted,false);
});

test('Global deadline wins over a longer per-RPC timeout and prevents subsequent provider work',async()=>{
 const controller=new AbortController(),reason=Error('Synthetic global deadline'),f=builder(pending());let providerFetches=0;
 const provider=deadlineFetch(controller.signal,()=>{providerFetches++;return Promise.resolve(new Response('unexpected'));});
 const operation=(async()=>{await boundedRpc(f.query,controller.signal,10000);await provider('https://provider.invalid/inert');})();
 const timer=setTimeout(()=>controller.abort(reason),20);
 try{await assert.rejects(within(operation),/request_deadline_exceeded/);}finally{clearTimeout(timer);}
 assert.equal(f.seen.signals[0].reason,reason);assert.equal(providerFetches,0);
});

test('Late RPC completion after timeout cannot resume a dependent provider call',async()=>{
 const controller=new AbortController(),late=deferred();let providerFetches=0;
 const provider=deadlineFetch(controller.signal,()=>{providerFetches++;return Promise.resolve(new Response('unexpected'));});
 const operation=(async()=>{await boundedRpc(late.promise,controller.signal,20);await provider('https://provider.invalid/inert');})();
 await assert.rejects(within(operation),/request_deadline_exceeded/);
 late.resolve({data:{shouldDispatch:true},error:null});await delay(0);
 assert.equal(providerFetches,0);
});

test('Successful and rejected operations clean up deadline listeners before later abort',async()=>{
 const controller=new AbortController(),value={data:{synthetic:true}};
 assert.equal(await awaitRequestDeadline(Promise.resolve(value),controller.signal),value);
 await delay(0);assert.equal(getEventListeners(controller.signal,'abort').length,0);
 const reason=Error('Synthetic RPC rejection');
 await assert.rejects(awaitRequestDeadline(Promise.reject(reason),controller.signal),error=>error===reason);
 await delay(0);assert.equal(getEventListeners(controller.signal,'abort').length,0);
 controller.abort();await delay(0);
});

test('Late rejection of an aborted operation is handled without an unhandled rejection',async()=>{
 const controller=new AbortController(),late=deferred(),unhandled=[];
 const collect=reason=>unhandled.push(reason);process.on('unhandledRejection',collect);
 try{
  const work=awaitRequestDeadline(late.promise,controller.signal);controller.abort();
  await assert.rejects(within(work),/request_deadline_exceeded/);
  late.reject(Error('Synthetic late backend failure'));await delay(20);
  assert.deepEqual(unhandled,[]);assert.equal(getEventListeners(controller.signal,'abort').length,0);
 }finally{process.removeListener('unhandledRejection',collect);}
});

test('Successful bounded RPC preserves result identity and performs no retry after a later abort',async()=>{
 const controller=new AbortController(),value={data:{shouldDispatch:false},error:null},f=builder(Promise.resolve(value));
 assert.equal(await boundedRpc(f.query,controller.signal,10000),value);
 await delay(0);assert.equal(getEventListeners(f.seen.signals[0],'abort').length,0);
 controller.abort();await delay(0);assert.equal(f.seen.subscriptions,1);assert.equal(f.seen.signals.length,1);
});

test('Provider fetch receives both deadlines and caller rejection is finite even when transport ignores abort',async()=>{
 const global=new AbortController(),local=new AbortController(),seen=[];
 const fetcher=deadlineFetch(global.signal,(input,init)=>{seen.push({input,init});return pending();});
 const call=fetcher('https://provider.invalid/inert',{method:'POST',body:'synthetic',signal:local.signal});
 local.abort(Error('Synthetic provider timeout'));
 await assert.rejects(within(call),/request_deadline_exceeded/);
 assert.equal(seen.length,1);assert.equal(seen[0].init.method,'POST');assert.equal(seen[0].init.body,'synthetic');
 assert.equal(seen[0].init.signal.aborted,true);assert.equal(seen[0].init.signal.reason,local.signal.reason);
 assert.equal(global.signal.aborted,false);
});

test('Global provider abort remains active after native fetch headers and interrupts the response body',async()=>{
 let requests=0;
 const server=createServer((_request,response)=>{
  requests++;response.writeHead(200,{'content-type':'application/json'});response.flushHeaders();response.write('{"synthetic":');
  // Deliberately leave the body incomplete. This is loopback-only inert I/O.
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const controller=new AbortController();
 try{
  const address=server.address();assert.equal(typeof address,'object');
  const response=await within(deadlineFetch(controller.signal)(`http://127.0.0.1:${address.port}/inert`));
  assert.equal(response.status,200);assert.equal(controller.signal.aborted,false);
  const body=response.text();controller.abort();
  await assert.rejects(within(body),error=>error.name==='AbortError');
  assert.equal(requests,1);
 }finally{
  controller.abort();server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
 }
});

const blockEventLoop=ms=>{const until=performance.now()+ms;while(performance.now()<until){ /* Deliberately starve timers in this isolated test. */ }};
test('monotonic deadline blocks a new fetch even before its delayed timer callback runs',()=>{
 const signal=requestDeadline(2);let calls=0;blockEventLoop(8);assert.equal(signal.aborted,false);
 assert.throws(()=>deadlineFetch(signal,async()=>{calls++;return new Response('inert');})('http://127.0.0.1/inert'),/request_deadline_exceeded/);assert.equal(calls,0);
});
test('late successful send permission cannot authorize fetch when synchronous work outruns its timer',async()=>{
 const signal=requestDeadline(2);let calls=0;
 const query={then(resolve){blockEventLoop(8);resolve({shouldDispatch:true});}};
 await assert.rejects(boundedRpc(query,signal,1000).then(()=>deadlineFetch(signal,async()=>{calls++;return new Response('inert');})('http://127.0.0.1/inert')),/request_deadline_exceeded/);
 assert.equal(calls,0,'Ambiguous committed send permission must not be retried or dispatched');
});
test('an already-started rejection is handled when monotonic expiry precedes the timer callback',async()=>{
 const signal=requestDeadline(2),errors=[],listener=error=>errors.push(error);process.on('unhandledRejection',listener);
 try{blockEventLoop(8);assert.equal(signal.aborted,false);const work=Promise.reject(Error('inert eager rejection'));
  assert.throws(()=>awaitRequestDeadline(work,signal),/request_deadline_exceeded/);await delay(20);assert.deepEqual(errors,[]);
 }finally{process.off('unhandledRejection',listener);}
});
test('an eager rejected RPC is observed when its global budget already expired',async()=>{
 const signal=requestDeadline(2),errors=[],listener=error=>errors.push(error);process.on('unhandledRejection',listener);
 try{blockEventLoop(8);const query=Promise.reject(Error('inert eager RPC rejection'));
  await assert.rejects(boundedRpc(query,signal,1000),/request_deadline_exceeded/);await delay(20);assert.deepEqual(errors,[]);
 }finally{process.off('unhandledRejection',listener);}
});
