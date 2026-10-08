import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {settledBrowserAction,researchActionCheckpoint} from './next-fixture/browser-action.mjs';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
function fixture(status=200){
 const page=new EventEmitter(),headers=deferred(),clicked=deferred();
 const request={method:()=> 'POST',headers:()=>({'next-action':'inert'})};let predicate,streamReads=0;
 page.waitForResponse=filter=>{predicate=filter;return headers.promise;};
 page.getByRole=()=>({
  click:async()=>{page.emit('request',request);clicked.resolve();},
 });
 const response={request:()=>request,status:()=>status,finished:()=>{streamReads++;return new Promise(()=>{});}};
 return{page,clicked,get streamReads(){return streamReads;},respond(){assert.equal(predicate({request:()=>({})}),false);assert.equal(predicate(response),true);headers.resolve(response);}};
}
test('terminal action waits for its rendered result even with an open response stream',async()=>{
 const f=fixture(),outcome=deferred(),phases=[];let finished=false;
 const action=settledBrowserAction({page:f.page,name:'Continue approved research',settled:()=>outcome.promise,timeout:200,onProgress:v=>phases.push(v.phase)}).then(()=>{finished=true;});
 await f.clicked.promise;f.respond();await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,false,'Old visible state and headers cannot settle an action');
 outcome.resolve();await action;assert.deepEqual(phases,['click','headers','settled']);assert.equal(f.streamReads,0);assert.equal(f.page.listenerCount('request'),0);
});
test('terminal action rejects a missing rendered result and removes its request listener',async()=>{
 const f=fixture();const action=settledBrowserAction({page:f.page,name:'Continue approved research',settled:()=>new Promise(()=>{}),timeout:10});
 await f.clicked.promise;f.respond();await assert.rejects(action,/rendered result timed out/);assert.equal(f.page.listenerCount('request'),0);
});
test('terminal action rejects an HTTP failure even when the form returns',async()=>{
 const f=fixture(500);const action=settledBrowserAction({page:f.page,name:'Continue approved research',settled:async()=>assert.fail('Cannot accept a failed request'),timeout:200});
 await f.clicked.promise;f.respond();await assert.rejects(action,/action HTTP status/);assert.equal(f.page.listenerCount('request'),0);
});
test('durable checkpoint rejects time-only changes, stale receipts and unsafe terminal state',()=>{
 const now=Date.parse('2026-10-08T02:00:00Z'),at='2026-10-08T02:02:00Z';
 const before={state:'prepared',planId:null,planVersion:null,cost:{knownMicrousd:'0'},continueAfter:null,phases:[{phase:'strategy',status:'not_started',candidateSaved:false},{phase:'review',status:'not_started',outcome:null}]};
 assert.throws(()=>researchActionCheckpoint(before,{...before,activeWindow:false},now),/substantive/);
 assert.throws(()=>researchActionCheckpoint({...before,continueAfter:at},{...before,continueAfter:null},now),/substantive/);
 const lease={...before,continueAfter:at};assert.deepEqual(researchActionCheckpoint(before,lease,now),{kind:'lease',at});
 const receipt={...before,state:'running',planId:'inert-plan',phases:[{phase:'strategy',status:'dispatched',candidateSaved:true,receipt:{status:'awaiting_receipt',attempts:1,nextCheckAt:at}},before.phases[1]]};
 assert.deepEqual(researchActionCheckpoint(before,receipt,now),{kind:'receipt',attempts:1,at});
 assert.throws(()=>researchActionCheckpoint(receipt,receipt,now),/substantive/);
 assert.throws(()=>researchActionCheckpoint(before,{...receipt,state:'blocked'},now),/blocked/);
 assert.throws(()=>researchActionCheckpoint(before,{...lease,paused:true},now),/blocked/);
 for(const status of ['rejected','failed','cancelled'])assert.throws(()=>researchActionCheckpoint(before,{...lease,phases:[{phase:'strategy',status}]},now),/failed phase/);
 for(const status of ['terminal','exhausted','expired','stopped'])assert.throws(()=>researchActionCheckpoint(before,{...lease,phases:[{phase:'strategy',status:'dispatched',candidateSaved:true,receipt:{status}}]},now),/failed receipt/);
 assert.throws(()=>researchActionCheckpoint(before,{...receipt,phases:[{...receipt.phases[0],candidateSaved:false}]},now),/unsaved/);
 const completed={...receipt,state:'completed',phases:receipt.phases.map(phase=>({...phase,status:'completed',outcome:'TEST'}))};
 assert.deepEqual(researchActionCheckpoint(receipt,completed,now),{kind:'completed'});
 assert.throws(()=>researchActionCheckpoint(receipt,{...completed,phases:completed.phases.map(phase=>({...phase,outcome:'REJECT'}))},now),/negative/);
});
