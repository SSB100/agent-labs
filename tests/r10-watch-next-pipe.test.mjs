import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';

// Resolve the real pinned Next installation in the checkout running this test.
const require=createRequire(`${process.cwd()}/package.json`);
const {pipeToNodeResponse}=require('next/dist/server/pipe-readable.js');

for(const name of ['Error','AbortError'])test(`R10 installed Next ${name} transport branch after an emitted frame`,{timeout:5000},async()=>{
 const events=[],failure=Object.assign(new Error('Read-only viewing ended. Saved records remain available.'),{name});
 let controller,scheduled,pulls=0;
 const body=new ReadableStream({
  start(value){controller=value;},
  pull(value){if(pulls++===0)value.enqueue(new Uint8Array([255,216,255,219]));},
 },{highWaterMark:0});
 const response=new EventEmitter();
 Object.assign(response,{
  writableFinished:false,errored:null,destroyed:false,
  flushHeaders(){events.push('headers');},
  write(chunk){
   assert.deepEqual([...chunk],[255,216,255,219]);events.push('write');
   // Fail only after Next actually writes the first chunk.
   scheduled=setImmediate(()=>controller.error(failure));return true;
  },
  destroy(error){events.push(`destroy:${error.name}`);this.errored=error;this.destroyed=true;this.emit('close');},
  end(){events.push('end');this.writableFinished=true;this.emit('finish');},
 });
 try{
  const piping=pipeToNodeResponse(body,response);
  if(name==='Error')await assert.rejects(piping,{message:'failed to pipe response'});
  else await piping;
  assert.deepEqual(events,['headers','write',`destroy:${name}`]);
  assert.equal(response.destroyed,true);assert.equal(response.writableFinished,false);
  assert.strictEqual(response.errored,failure);
  const reader=body.getReader();
  try{await assert.rejects(reader.read(),{name,message:failure.message});}finally{reader.releaseLock();}
 }finally{if(scheduled)clearImmediate(scheduled);}
});
