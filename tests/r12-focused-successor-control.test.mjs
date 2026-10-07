import test from 'node:test';
import assert from 'node:assert/strict';
import {startFixtureBoundary} from './next-fixture/server.mjs';
test('every new successor HTTP command enters real SQL controls and rejects absent state',async()=>{
 const boundary=await startFixtureBoundary();try{
  for(const command of ['r12FocusedSuccessorStage','r12FocusedSuccessorActivate','r12FocusedSuccessorClose']){const response=await fetch(boundary.origin+'/control',{method:'POST',body:JSON.stringify({[command]:{}}),signal:AbortSignal.timeout(5000)});assert.equal(response.status,500,command);assert.equal((await response.json()).error.message,'Inert boundary rejected request');assert.equal(boundary.denied.at(-1).kind,'boundary-error');}
  assert.equal(boundary.denied.length,3);assert.deepEqual(boundary.effects,[]);
 }finally{await boundary.close();}
});
