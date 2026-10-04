import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';

const require=createRequire(`${process.cwd()}/package.json`);
const {pipeToNodeResponse}=require('next/dist/server/pipe-readable.js');
const turn=()=>new Promise(resolve=>setImmediate(resolve));

// This exercises the installed Next writer, not Vercel retention or real TCP.
for(const termination of ['close','error'])for(const backpressure of [false,true]){
 test(`R10 installed Next ${termination} with ${backpressure?'blocked':'accepted'} downstream write`,{timeout:5000},async t=>{
  const events=[];let controller,pulled=false,written;
  const firstWrite=new Promise(resolve=>{written=resolve;});
  const body=new ReadableStream({
   start(value){controller=value;},
   pull(value){if(!pulled){pulled=true;value.enqueue(new Uint8Array([255,216,255,219]));}},
  },{highWaterMark:0});
  const response=new EventEmitter();
  Object.assign(response,{
   writableFinished:false,errored:null,destroyed:false,
   flushHeaders(){events.push('headers');},
   write(chunk){assert.deepEqual([...chunk],[255,216,255,219]);events.push('write');written();return !backpressure;},
   destroy(error){events.push('destroy');this.errored=error;this.destroyed=true;this.emit('close');},
   end(){events.push('end');this.writableFinished=true;this.emit('finish');},
  });
  const piping=pipeToNodeResponse(body,response);
  t.after(async()=>{response.emit('drain');await piping;});
  await firstWrite;await turn();
  // The source queue is empty even while Next has an unfinished downstream write.
  assert.equal(controller.desiredSize,0);
  if(termination==='close')controller.close();
  else controller.error(Object.assign(new Error('Read-only viewing ended. Saved records remain available.'),{name:'AbortError'}));
  await turn();
  if(backpressure){
   // Even the previous error path waits for this write before destroying Next's response.
   assert.deepEqual(events,['headers','write']);
   assert.equal(response.destroyed,false);assert.equal(response.writableFinished,false);
   response.emit('drain');
  }
  await piping;
  assert.deepEqual(events,['headers','write',termination==='close'?'end':'destroy']);
  assert.equal(response.destroyed,termination==='error');
  assert.equal(response.writableFinished,termination==='close');
 });
}
