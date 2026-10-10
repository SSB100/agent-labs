/** Actual workflow wrapper under an inert hook host. This proves local ordering
 * and pause/resume wiring, not the deployed SDK's event-sourcing/race behavior. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadActualOwnerModule} from './helpers/r12-direct-owner-journey-fixture.mjs';
const deferred=()=>{let resolve;return{promise:new Promise(r=>{resolve=r;}),resolve};};
const tick=()=>new Promise(r=>setImmediate(r));
function fixture({conflict=null,results=[]}={}){
 const registered=deferred(),calls=[],waits=[],events=[];let resolveSignal,disposed=false;
 const hook={getConflict:()=>registered.promise,[Symbol.asyncIterator]:()=>({next:()=>{events.push('waiting');waits.push(1);return new Promise(r=>{resolveSignal=r;});}}),[Symbol.dispose](){disposed=true;events.push('disposed');}};
 const actual=loadActualOwnerModule('src/workflows/direct-research-runtime.ts',{
  workflow:{createHook:options=>{events.push('create');assert.equal(options.token,'agent-labs:direct-etsy-reconcile:scope');return hook;},getWorkflowMetadata:()=>({workflowRunId:'immutable-run'})},
  './direct-research-runtime-steps':{executeDirectResearchPhase:async(input,id)=>{calls.push({input,id});events.push('phase');const r=results.shift();if(r instanceof Error)throw r;assert.ok(r,'Unexpected phase invocation');return r;}},
 });
 return{actual,calls,events,waits,register:()=>{events.push('registered');registered.resolve(conflict);},resume:()=>{assert.ok(resolveSignal);const resolve=resolveSignal;resolveSignal=null;resolve({value:{operation:'reconcile'},done:false});},get disposed(){return disposed;}};
}
test('hook registration fences all phase work; a conflicting hosting invocation performs none',async()=>{
 const f=fixture({conflict:{runId:'already-owner'}}),run=f.actual.directResearchRuntimeWorkflow({scopeId:'scope'});await tick();assert.equal(f.calls.length,0);assert.equal(f.disposed,false);f.register();assert.equal((await run).reason,'existing_runtime_requires_reconciliation');assert.equal(f.calls.length,0);assert.equal(f.disposed,true);
});
test('pause and thrown phase retain one runtime until owner reconciliation; terminal window releases hook',async()=>{
 const pause={continue:false,reason:'receipt_required',questComplete:false},end={continue:false,reason:'research_window_complete',questComplete:false};
 const f=fixture({results:[{continue:true,reason:'accepted',questComplete:false},pause,new Error('unavailable'),end]}),input={scopeId:'scope'},run=f.actual.directResearchRuntimeWorkflow(input);
 await tick();assert.equal(f.calls.length,0);f.register();await tick();assert.equal(f.calls.length,2);assert.equal(f.waits.length,1);assert.equal(f.disposed,false);
 await tick();assert.equal(f.calls.length,2,'No automatic paid retry on pause');f.resume();await tick();assert.equal(f.calls.length,3);assert.equal(f.waits.length,2);assert.equal(f.disposed,false);
 f.resume();assert.deepEqual(await run,end);assert.equal(f.calls.length,4);assert.ok(f.calls.every(c=>c.id==='immutable-run'&&c.input===input));assert.equal(f.disposed,true);assert.ok(f.events.indexOf('registered')<f.events.indexOf('phase'));
});
test('the real hosting step has zero retries and scrubs runtime failures',async()=>{
 class FatalError extends Error{}let calls=0;
 const m=loadActualOwnerModule('src/workflows/direct-research-runtime-steps.ts',{workflow:{FatalError},'../products/discovery-r12-public-runtime':{executePublicResearchRuntimeStep:async()=>{calls++;throw Error('private provider error');}}});
 assert.equal(m.executeDirectResearchPhase.maxRetries,0);await assert.rejects(m.executeDirectResearchPhase({},'one'),error=>error instanceof FatalError&&!error.message.includes('private'));assert.equal(calls,1);
});
