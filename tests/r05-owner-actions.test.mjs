import test from 'node:test';
import assert from 'node:assert/strict';
import {loadSource} from './helpers/guided-ui.mjs';
import * as guard from '../.core-tests/core/quest-intake.js';
const business='00000000-0000-4000-8000-000000000001',submission='00000000-0000-4000-8000-000000000002';
function fixture({signedIn=true,error=null}={}){
 const calls=[];let clients=0;
 const api=loadSource('src/app/dashboard/quests/controls/actions.ts',{
  '@/core/admission-contract':loadSource('src/core/admission-contract.ts'),'@/core/quest-intake':guard,
  '@/lib/supabase/server':{createClient:async()=>{clients++;return{auth:{getClaims:async()=>({data:{claims:signedIn?{sub:'owner'}:null},error:null})},rpc:async(name,args)=>{calls.push({name,args});return{error,data:{id:submission}};}};}},
 });return{...api,calls,clients:()=>clients};
}
test('financial actions reject malformed scope, unsupported operation and secrets before RPC',async()=>{
 for(const [b,op,payload]of [['foreign','pause',{}],[business,'dispatch',{}],[business,'propose',{secret:'password\nprivate-value'}],[business,'propose',{large:'a'.repeat(24001)}]]){
  const f=fixture();assert.equal((await f.saveOperatingControl(b,op,payload,submission)).ok,false);assert.equal(f.clients(),0);assert.equal(f.calls.length,0);
 }
 const f=fixture({signedIn:false});assert.equal((await f.saveOperatingControl(business,'pause',{kind:'business',id:business},submission)).ok,false);assert.equal(f.calls.length,0);
});
test('financial confirmation forwards exact fingerprint and retry identity with no dispatch dependency',async()=>{
 const f=fixture(),payload={policyId:submission,policyHash:'a'.repeat(64)};
 for(let n=0;n<2;n++)assert.equal((await f.saveOperatingControl(business,'confirm',payload,submission)).ok,true);
 for(const c of f.calls){assert.equal(c.name,'r05_policy_owner');assert.equal(c.args.p_business_id,business);assert.equal(c.args.p_submission_id,submission);assert.deepEqual(c.args.p_payload,payload);}
});
test('financial action failure redacts internal diagnostics and never claims confirmation',async()=>{
 const f=fixture({error:{message:'private-server-diagnostic'}}),result=await f.saveOperatingControl(business,'confirm',{policyId:submission,policyHash:'a'.repeat(64)},submission);
 assert.equal(result.ok,false);assert.match(result.message,/could not be verified/);assert.ok(!result.message.includes('private-server-diagnostic'));
});
