import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {createWatchLifetime,withinWatchLifetime} from '../.core-tests/browser/watch/lifetime.js';

const require=createRequire(import.meta.url);
const contracts=require('../.core-tests/browser/watch/contracts.js');
const runtime=require('../.core-tests/browser/watch/runtime.js');
const scope={sessionId:'10000000-0000-4000-8000-000000000001',businessId:'10000000-0000-4000-8000-000000000002',questId:'10000000-0000-4000-8000-000000000003',workflowRunId:'10000000-0000-4000-8000-000000000004'};
const ownerId='10000000-0000-4000-8000-000000000005',authSessionId='10000000-0000-4000-8000-000000000006';
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{resolve,promise};};
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
function fixture(options={}){
 const events=[],state={events,completion:null,settled:false,factories:0};
 const client={auth:{getClaims:async()=>{events.push('auth');if(options.authGate)await options.authGate;return{data:options.unauthorized?null:{claims:{sub:ownerId,session_id:authSessionId}},error:null};},getUser:async()=>({data:{user:options.unauthorized?null:{id:ownerId}},error:null})},rpc:async()=>({data:scope,error:null})};
 const mocks={
  'server-only':{},'next/server':{after:completion=>{events.push('registered');assert.ok(completion instanceof Promise);state.completion=completion;void completion.then(()=>{state.settled=true;});}},
  '@/lib/supabase/server':{createClient:async()=>client},'./watch/contracts':contracts,
  './watch/lifetime':{createWatchLifetime,withinWatchLifetime},'./watch/runtime':runtime,
  './watch-dependencies':{createViewerDependencies:()=>{state.factories++;if(options.factoryThrows)throw Error('hostile private identity');return{sourceHash:'b'.repeat(64),authority:async op=>{events.push(op);if(op==='claim')throw Error('hostile provider/auth information');return{};},createProvider:async()=>{throw Error('must not create');}};}},
 };
 const loaded={exports:{}},compiled=ts.transpileModule(readFileSync('src/browser/watch-server.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 runInNewContext(`(function(require,module,exports){${compiled}\n})`,{Response,URL,Promise,performance,setTimeout,clearTimeout})(name=>{assert.ok(Object.hasOwn(mocks,name),name);return mocks[name];},loaded,loaded.exports);
 return{state,open:signal=>loaded.exports.openOwnedBrowserWatch(new Request('https://inert.invalid/watch',{signal}),scope)};
}
for(const mode of ['unauthorized','factoryThrows','claim'])test(`R10 production after promise is registered before ${mode} and always settles`,async()=>{
 const f=fixture({[mode]:true}),response=await f.open();assert.equal(response.status,mode==='unauthorized'?404:409);await f.state.completion;
 assert.equal(f.state.events[0],'registered');assert.equal(f.state.settled,true);assert.doesNotMatch(await response.text(),/hostile|private|identity|provider/);
});
test('R10 production aborted authentication settles registration and cannot launch from a late result',async()=>{
 const gate=deferred(),control=new AbortController(),f=fixture({authGate:gate.promise});
 const opening=f.open(control.signal);await flush();assert.equal(f.state.events[0],'registered');control.abort();assert.equal((await opening).status,409);await f.state.completion;
 assert.equal(f.state.factories,0);gate.resolve();await flush();assert.equal(f.state.factories,0);assert.equal(f.state.settled,true);
});
test('R10 production already aborted request cannot enter provider factory',async()=>{
 const control=new AbortController();control.abort();const f=fixture();assert.equal((await f.open(control.signal)).status,409);await f.state.completion;assert.equal(f.state.factories,0);
});
test('R10 hosting work stops at150s and final completion is bounded to165s below route180s',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let registered,completed=false;
 const lifetime=createWatchLifetime(p=>{registered=p;void p.then(()=>{completed=true;});});assert.equal(registered,lifetime.completion);
 const admission=assert.rejects(withinWatchLifetime(lifetime,()=>new Promise(()=>{})),/viewer_hosting_unavailable/);
 t.mock.timers.tick(149_999);assert.equal(lifetime.signal.aborted,false);assert.equal(completed,false);
 t.mock.timers.tick(1);await admission;assert.equal(lifetime.signal.aborted,true);assert.equal(completed,false);
 t.mock.timers.tick(14_999);await flush();assert.equal(completed,false);t.mock.timers.tick(1);await lifetime.completion;assert.equal(completed,true);
 assert.match(readFileSync('src/app/api/browser/sessions/[browserSessionId]/watch/route.ts','utf8'),/maxDuration = 180/);
});
test('R10 host expiry settles a hung authenticated handler without creating dependencies',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture({authGate:new Promise(()=>{})}),opening=f.open();await flush();t.mock.timers.tick(150_000);
 assert.equal((await opening).status,409);await f.state.completion;assert.equal(f.state.factories,0);assert.equal(f.state.settled,true);
});
test('R10 missing hosting registration fails before admission and leaves no pending completion',async()=>{
 let registered;assert.throws(()=>createWatchLifetime(p=>{registered=p;throw Error('private host failure');}),/viewer_hosting_unavailable/);await registered;
});

function routeFixture(options={}){
 const state={events:[],completion:null,opened:false,finished:false};
 const mocks={
  'next/server':{after:p=>{state.events.push('registered');state.completion=p;void p.then(()=>{state.finished=true;});}},
  '@/browser/watch/lifetime':{createWatchLifetime,withinWatchLifetime},
  '@/browser/watch-server':{
   readWatchRequest:async()=>{state.events.push('body');return options.bodyGate?await options.bodyGate:null;},
   openOwnedBrowserWatch:async(_request,_scope,lifetime)=>{state.opened=true;assert.equal(lifetime.completion,state.completion);lifetime.finish();return new Response(null,{status:200});},
  },
 };
 const loaded={exports:{}},compiled=ts.transpileModule(readFileSync('src/app/api/browser/sessions/[browserSessionId]/watch/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 runInNewContext(`(function(require,module,exports){${compiled}\n})`,{Response})(name=>{assert.ok(Object.hasOwn(mocks,name),name);return mocks[name];},loaded,loaded.exports);
 return{state,post:signal=>loaded.exports.POST(new Request('https://inert.invalid/watch',{signal}),{params:Promise.resolve({browserSessionId:scope.sessionId})})};
}
test('R10 route registers before even invalid body parsing and settles its own early response',async()=>{
 const f=routeFixture();assert.equal((await f.post()).status,400);await f.state.completion;assert.deepEqual(f.state.events,['registered','body']);assert.equal(f.state.opened,false);
});
test('R10 slow request body shares the original hosting cutoff and cannot launch after a late result',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const gate=deferred(),f=routeFixture({bodyGate:gate.promise}),response=f.post();await flush();assert.deepEqual(f.state.events,['registered','body']);
 t.mock.timers.tick(150_000);assert.equal((await response).status,409);await f.state.completion;gate.resolve(scope);await flush();assert.equal(f.state.opened,false);assert.equal(f.state.finished,true);
});
test('R10 admitted route hands the same registered completion into the authenticated handler',async()=>{
 const f=routeFixture({bodyGate:Promise.resolve(scope)});assert.equal((await f.post()).status,200);await f.state.completion;assert.equal(f.state.opened,true);assert.equal(f.state.finished,true);
});
