import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {pilotOwnerSqlApi} from './helpers/r12-pilot-owner-sql-fixture.mjs';
import {R12_INERT_ROOT} from './next-fixture/r12-sql.mjs';
const id=n=>`12000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('real owner fixture preparation uses only its isolated inert configuration, with absent or conflicting host env',async()=>{
 const keys=['VERCEL_ENV','R05_ADMISSION_SERVER_KEY','OPENROUTER_API_KEY'],prior=Object.fromEntries(keys.map(key=>[key,process.env[key]]));let sqlCalls=0;
 const db={query:async()=>{sqlCalls++;assert.fail('Nonsecret preparation must not issue SQL');},exec:async()=>{sqlCalls++;assert.fail('Nonsecret preparation must not issue SQL');}};
 const businessId=id(1),ownerId=id(2),scopeId=id(3),sha=value=>createHash('sha256').update(value).digest('hex');
 const expected=role=>sha(createHmac('sha256',R12_INERT_ROOT).update(JSON.stringify({version:'r12.scoped-authority.1',role,businessId,ownerId,scopeId})).digest('base64url'));
 try{
  for(const environment of [{},{VERCEL_ENV:'preview',R05_ADMISSION_SERVER_KEY:'deliberately-different-inert-root-0123456789',OPENROUTER_API_KEY:''}]){
   for(const key of keys){if(environment[key]===undefined)delete process.env[key];else process.env[key]=environment[key];}
   const before=Object.fromEntries(keys.map(key=>[key,process.env[key]])),api=pilotOwnerSqlApi(db,businessId,ownerId);
   assert.deepEqual(await api.server.prepareDiscoveryR12Authority(api.context,businessId,scopeId),{controllerKeyHash:expected('controller'),admissionKeyHash:expected('admission'),authorityCreated:false});
   assert.deepEqual(Object.fromEntries(keys.map(key=>[key,process.env[key]])),before,'The loader must not change global configuration');
   await assert.rejects(api.server.prepareDiscoveryR12Authority(api.context,businessId,'invalid-scope'),/owner_action_unavailable/);
  }
  assert.equal(sqlCalls,0);
 }finally{for(const[key,value]of Object.entries(prior)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
