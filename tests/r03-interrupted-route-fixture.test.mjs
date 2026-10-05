import test from 'node:test';
import assert from 'node:assert/strict';
import {interruptBusinessesRsc} from './next-fixture/journeys.mjs';
import {FIXTURE_ACTION_TIMEOUT_MS} from './next-fixture/async-bounds.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 const abort=deferred(),failed=deferred(),drain=deferred(),events=[];
 let handler,predicate;
 const request={headers:()=>({rsc:'1'}),failure:()=>({errorText:'net::ERR_ABORTED'})};
 const route={request:()=>request,abort:code=>{events.push(['abort',code]);return abort.promise;},fallback:()=>{events.push(['fallback']);return Promise.resolve();}};
 const page={
  waitForEvent(name,options){assert.equal(name,'requestfailed');assert.equal(options.timeout,FIXTURE_ACTION_TIMEOUT_MS);predicate=options.predicate;return failed.promise;},
  async route(pattern,value){assert.equal(pattern,'**/dashboard/settings?*panel=businesses*');handler=value;events.push(['registered']);},
  getByRole(role,options){assert.equal(role,'link');assert.deepEqual(options,{name:'Businesses',exact:true});return{async click(options){assert.equal(options.timeout,FIXTURE_ACTION_TIMEOUT_MS);events.push(['click']);}};},
  unrouteAll(options){events.push(['cleanup',options]);assert.deepEqual(options,{behavior:'wait'});return drain.promise;},
 };
 return{page,request,route,events,abort,drain,failed,dispatch:()=>handler(route),emit:request=>{if(predicate(request))failed.resolve(request);}};
}

test('R03 interruption waits for exact request failure, abort completion and handler drain before returning',{timeout:5000},async()=>{
 const f=fixture();let complete=false;const running=interruptBusinessesRsc(f.page).then(()=>{complete=true;});
 await turn();assert.deepEqual(f.events,[['registered'],['click']]);assert.equal(complete,false);
 const handling=f.dispatch();f.emit({headers:()=>({rsc:'1'})});await turn();assert.equal(complete,false);assert.equal(f.events.some(event=>event[0]==='cleanup'),false);
 f.emit(f.request);await turn();assert.equal(f.events.some(event=>event[0]==='cleanup'),false,'A requestfailed event alone must not remove the running abort handler');
 f.abort.resolve();await handling;await turn();assert.deepEqual(f.events.at(-1),['cleanup',{behavior:'wait'}]);assert.equal(complete,false,'The subsequent destination must wait for the route-handler drain');
 f.drain.resolve();await running;assert.equal(complete,true);
});

test('R03 interruption surfaces abort errors and still drains instead of hiding async handler failures',{timeout:5000},async()=>{
 const f=fixture(),error=new Error('abort transport failed');
 const running=interruptBusinessesRsc(f.page);const checked=assert.rejects(running,value=>value===error);
 await turn();const handling=f.dispatch();f.abort.reject(error);await handling;await turn();
 assert.deepEqual(f.events.at(-1),['cleanup',{behavior:'wait'}]);f.drain.resolve();await checked;
});

test('R03 interruption retains request-failure timeout and cleanup failures',{timeout:5000},async()=>{
 const f=fixture(),timeout=new Error('requestfailed timeout'),cleanup=new Error('route drain failed');
 const running=interruptBusinessesRsc(f.page);const checked=assert.rejects(running,error=>{
  assert.ok(error instanceof AggregateError);assert.deepEqual(error.errors,[timeout,cleanup]);return true;
 });
 await turn();const handling=f.dispatch();f.abort.resolve();await handling;f.failed.reject(timeout);await turn();
 assert.deepEqual(f.events.at(-1),['cleanup',{behavior:'wait'}]);f.drain.reject(cleanup);await checked;
});

test('R03 interruption leaves non-RSC navigation to the existing context allowlist',{timeout:5000},async()=>{
 const f=fixture(),running=interruptBusinessesRsc(f.page);await turn();
 const headers=f.request.headers;f.request.headers=()=>({});await f.dispatch();assert.deepEqual(f.events.at(-1),['fallback']);assert.equal(f.events.some(event=>event[0]==='abort'),false);
 f.request.headers=headers;const handling=f.dispatch();f.abort.resolve();f.emit(f.request);await handling;await turn();f.drain.resolve();await running;
});
