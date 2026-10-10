/** Actual server-only source; only inert owner reads, no RPC or provider IO. */
import {readFileSync} from 'node:fs';
import test from 'node:test';import assert from 'node:assert/strict';import {createHash,randomUUID} from 'node:crypto';
import {readbackSource} from './helpers/r12-steel-readback-sql-fixture.mjs';
const source=readbackSource(),server=source.load('src/accounts/etsy-steel-readback-owner-server.ts'),contracts=source.load('src/accounts/etsy-steel-readback-contracts.ts');
const ROOT='inert-configured-r05-fingerprint-not-a-live-credential',keyHash=createHash('sha256').update(ROOT).digest('hex');
const env={VERCEL_ENV:process.env.VERCEL_ENV,R05_ADMISSION_SERVER_KEY:process.env.R05_ADMISSION_SERVER_KEY};const priorFetch=globalThis.fetch;let fetches=0;
test.before(()=>{process.env.VERCEL_ENV='production';process.env.R05_ADMISSION_SERVER_KEY=ROOT;globalThis.fetch=async()=>{fetches++;throw Error('No provider access');};});
test.after(()=>{for(const[k,v]of Object.entries(env))if(v===undefined)delete process.env[k];else process.env[k]=v;globalThis.fetch=priorFetch;assert.equal(fetches,0);});
function fixture(options={}){
 const businessId=randomUUID(),userId=randomUUID(),calls=[];
 const context={userId,businesses:[{id:businessId}],supabase:{auth:{getClaims:async()=>{calls.push({kind:'claims'});return{data:{claims:{sub:options.wrongClaims?randomUUID():userId}},error:options.claimsError?Error(ROOT):null};}},from:table=>{
  calls.push({kind:'from',table});const filters={};const chain={select:columns=>{calls.push({kind:'select',columns});return chain;},eq:(k,v)=>{filters[k]=v;return chain;},maybeSingle:async()=>{calls.push({kind:'ownerRead',filters});if(options.throws)throw Error(ROOT);return{data:options.foreign?null:{id:options.wrongBusiness?randomUUID():businessId},error:options.readError?{message:ROOT}:null};}};return chain;
 },rpc:async()=>{throw Error('No status RPC is permitted');}}};
 return{businessId,context,calls,read:()=>server.readConfiguredR05Fingerprint(context,businessId)};
}
test('actual configured fingerprint requires fresh exact-owner SELECT and sends no key or digest to any service',async()=>{
 const f=fixture(),out=await f.read();assert.equal(out.keyHash,keyHash);assert.equal(out.status,'configured');assert.deepEqual(Object.keys(out).sort(),['version','businessId','keyHash','status','checkedAt'].sort());
 assert.deepEqual(f.calls,[{kind:'claims'},{kind:'from',table:'businesses'},{kind:'select',columns:'id'},{kind:'ownerRead',filters:{id:f.businessId,owner_user_id:f.context.userId}}]);
 assert.doesNotMatch(JSON.stringify(f.calls),new RegExp(ROOT+'|'+keyHash));assert.doesNotMatch(JSON.stringify(out),new RegExp(ROOT));assert.equal(fetches,0);
});
for(const option of ['foreign','wrongClaims','claimsError','wrongBusiness','readError','throws'])test(`${option} is denied despite a cached matching Business entry`,async()=>{const f=fixture({[option]:true});await assert.rejects(f.read(),e=>e.message==='Server configuration fingerprint is unavailable.'&&!String(e).includes(ROOT));assert.equal(fetches,0);if(['wrongClaims','claimsError'].includes(option))assert.deepEqual(f.calls,[{kind:'claims'}]);});
for(const configured of [undefined,'','short','x'.repeat(201)])test(`missing or invalid configured key yields no fingerprint (${configured?.length??'absent'})`,async()=>{
 const saved=process.env.R05_ADMISSION_SERVER_KEY;if(configured===undefined)delete process.env.R05_ADMISSION_SERVER_KEY;else process.env.R05_ADMISSION_SERVER_KEY=configured;
 try{const f=fixture(),out=await f.read();assert.equal(out.status,'not_configured');assert.equal(out.keyHash,null);assert.equal('rootEligible'in out,false);assert.equal('registered'in out,false);assert.equal(f.calls.filter(x=>x.kind==='ownerRead').length,1);}finally{process.env.R05_ADMISSION_SERVER_KEY=saved;}
});
test('fingerprint matches the trimmed credential used by the deployed readback',async()=>{process.env.R05_ADMISSION_SERVER_KEY='  '+ROOT+'  ';try{assert.equal((await fixture().read()).keyHash,keyHash);}finally{process.env.R05_ADMISSION_SERVER_KEY=ROOT;}});
test('preview environment cannot expose the fingerprint',async()=>{process.env.VERCEL_ENV='preview';try{await assert.rejects(fixture().read(),/fingerprint is unavailable/);}finally{process.env.VERCEL_ENV='production';}});
test('invalid identity fails before claims or ownership reads',async()=>{const f=fixture();await assert.rejects(server.readConfiguredR05Fingerprint(f.context,'not-a-business'),/fingerprint is unavailable/);assert.deepEqual(f.calls,[]);});
test('fingerprint DTO rejects authority claims, extra/private fields, malformed values and accessors',async()=>{
 const f=fixture(),value=await f.read();for(const change of [{registered:true},{rootEligible:true},{revoked:false},{credential:ROOT},{status:'active'},{keyHash:'not-a-digest'},{keyHash:null},{checkedAt:'infinity'},{businessId:randomUUID()}])assert.throws(()=>contracts.validateConfiguredR05Fingerprint({...value,...change},f.businessId));
 let accessed=false;Object.defineProperty(value,'keyHash',{enumerable:true,get(){accessed=true;return keyHash;}});assert.throws(()=>contracts.validateConfiguredR05Fingerprint(value,f.businessId));assert.equal(accessed,false);
});

test('all explicit Next readback facades map the genuine fingerprint helper',()=>{
 for(const file of ['scripts/verify-r12-direct-owner-next.mjs','scripts/verify-r12-direct-enrollment-owner-next.mjs','scripts/verify-r12-steel-current-owner-next.mjs'])assert.match(readFileSync(file,'utf8'),/readback:\['readConfiguredR05Fingerprint','readSteelConfigReadback'/);
 for(const file of ['tests/helpers/r12-direct-owner-journey-fixture.mjs','tests/helpers/r12-direct-enrollment-owner-journey-fixture.mjs','tests/helpers/r12-steel-current-owner-journey-fixture.mjs'])assert.match(readFileSync(file,'utf8'),/src\/accounts\/etsy-steel-readback-owner-server\.ts/);
});
