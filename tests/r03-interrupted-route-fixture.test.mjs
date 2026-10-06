import test from 'node:test';
import assert from 'node:assert/strict';
import {createFixtureRequestRouter} from './next-fixture/journeys.mjs';
import {FIXTURE_ACTION_TIMEOUT_MS} from './next-fixture/async-bounds.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({click}={}){
 const abort=deferred(),failed=deferred(),events=[],external=[],router=createFixtureRequestRouter('http://localhost:3000',external);
 let predicate;
 const request={url:()=> 'http://localhost:3000/dashboard/settings?panel=businesses&_rsc=inert',headers:()=>({rsc:'1'}),failure:()=>({errorText:'net::ERR_ABORTED'})};
 const route={request:()=>request,abort:code=>{events.push(['abort',code]);return abort.promise;},continue:()=>{events.push(['continue']);return Promise.resolve();}};
 const page={
  waitForEvent(name,options){assert.equal(name,'requestfailed');assert.equal(options.timeout,FIXTURE_ACTION_TIMEOUT_MS);predicate=options.predicate;return failed.promise;},
  getByRole(role,options){assert.equal(role,'link');assert.deepEqual(options,{name:'Businesses',exact:true});return{async click(options){assert.equal(options.timeout,FIXTURE_ACTION_TIMEOUT_MS);events.push(['click']);if(click)await click.promise;}};},
  async route(){assert.fail('Must not add overlapping page interception');},async unrouteAll(){assert.fail('Must not reconfigure routing while a request is active');},
 };
 return{page,router,request,route,events,external,abort,failed,dispatch:()=>router.handle(route),emit:request=>{if(predicate(request))failed.resolve(request);}};
}

test('R03 stable context route waits for exact request failure and abort completion',{timeout:5000},async()=>{
 const f=fixture();let complete=false;const running=f.router.interruptBusinessesRsc(f.page).then(()=>{complete=true;});
 await turn();assert.deepEqual(f.events,[['click']]);const handling=f.dispatch();f.emit({headers:()=>({rsc:'1'})});await turn();assert.equal(complete,false);
 f.emit(f.request);await turn();assert.equal(complete,false,'Failure event must not outrun the actual abort');f.abort.resolve();await handling;await running;assert.equal(complete,true);
 await f.dispatch();assert.deepEqual(f.events,[['click'],['abort','aborted'],['continue']],'Later navigation uses the same stable origin guard');
});

test('R03 stable interruption surfaces abort errors without a detached route rejection',{timeout:5000},async()=>{
 const f=fixture(),error=new Error('abort transport failed'),running=f.router.interruptBusinessesRsc(f.page),checked=assert.rejects(running,value=>value===error);
 await turn();const handling=f.dispatch();f.abort.reject(error);await handling;await checked;await f.dispatch();assert.deepEqual(f.events.at(-1),['continue']);
});

test('R03 interrupted request-failure timeout remains a failed assertion',{timeout:5000},async()=>{
 const f=fixture(),timeout=new Error('requestfailed timeout'),running=f.router.interruptBusinessesRsc(f.page),checked=assert.rejects(running,value=>value===timeout);
 await turn();const handling=f.dispatch();f.abort.resolve();await handling;f.failed.reject(timeout);await checked;await f.dispatch();assert.deepEqual(f.events.at(-1),['continue']);
});

test('R03 failed click still awaits its in-flight abort and preserves both failures',{timeout:5000},async()=>{
 const click=deferred(),f=fixture({click}),clickError=new Error('click failed'),abortError=new Error('abort failed'),running=f.router.interruptBusinessesRsc(f.page);
 const checked=assert.rejects(running,error=>{assert.ok(error instanceof AggregateError);assert.deepEqual(error.errors,[clickError,abortError]);return true;});
 await turn();const handling=f.dispatch();click.reject(clickError);await turn();f.abort.reject(abortError);await handling;await checked;
});

test('R03 one-shot interruption preserves origin blocking and unrelated or concurrent navigation',{timeout:5000},async()=>{
 const f=fixture(),running=f.router.interruptBusinessesRsc(f.page);await turn();
 const make=(url,headers={rsc:'1'})=>({request:()=>({url:()=>url,headers:()=>headers}),abort:async code=>f.events.push(['other-abort',code]),continue:async()=>f.events.push(['other-continue'])});
 await f.router.handle(make('https://example.invalid/dashboard/settings?panel=businesses'));assert.deepEqual(f.external,['https://example.invalid']);assert.deepEqual(f.events.at(-1),['other-abort','blockedbyclient']);
 await f.router.handle(make('http://localhost:3000/dashboard/settings?panel=businesses',{}));await f.router.handle(make('http://localhost:3000/dashboard?view=work'));
 const handling=f.dispatch();await f.router.handle(make('http://localhost:3000/dashboard/settings?panel=businesses&_rsc=second'));assert.deepEqual(f.events.at(-1),['other-continue']);
 f.abort.resolve();f.emit(f.request);await handling;await running;assert.equal(f.events.filter(e=>e[0]==='abort').length,1);assert.equal(f.events.filter(e=>e[0]==='other-continue').length,3);
});
