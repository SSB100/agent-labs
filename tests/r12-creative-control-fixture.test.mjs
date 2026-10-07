import test from 'node:test';
import assert from 'node:assert/strict';
import {startFixtureBoundary} from './next-fixture/server.mjs';

// A declared creative control must enter the real SQL handler. Without a loaded
// SQL scope it must reject, rather than acknowledge an unperformed operation.
test('every R12 creative HTTP control rejects absent SQL state instead of silently succeeding',async()=>{
 const boundary=await startFixtureBoundary();
 try{
  for(const key of ['r12CreativeInstall','r12CreativeStage','r12CreativeActivate']){
   const response=await fetch(boundary.origin+'/control',{method:'POST',body:JSON.stringify({[key]:{}}),signal:AbortSignal.timeout(5000)});
   assert.equal(response.status,500,`${key} must reach the real scoped SQL control handler`);
   assert.equal((await response.json()).error.message,'Inert boundary rejected request');
   assert.equal(boundary.denied.at(-1).kind,'boundary-error');
  }
  assert.equal(boundary.denied.length,3);assert.deepEqual(boundary.effects,[]);
 }finally{await boundary.close();}
});
