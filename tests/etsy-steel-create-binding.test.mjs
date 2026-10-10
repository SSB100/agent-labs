import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {createConfigHash as hash,inertSteelCreateConfigurationGuard as guard,inertSteelCreateConfigurationPermit as permit} from './helpers/etsy-steel-create-config-fixture.mjs';
const require=createRequire(import.meta.url),core=resolve(process.env.R12_STEEL_BINDING_CORE_DIR||'.core-tests');
const binding=require(resolve(core,'browser/etsy-steel-create-binding.js')),{SteelBrowserAdapter}=require(resolve(core,'browser/providers/steel.js'));
const id=n=>`76000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const config=()=>({apiKey:'inert-never-live-steel-key',baseUrl:'https://api.steel.dev',region:null});
const body=()=>JSON.stringify({sessionId:id(1),projectId:id(4),profileId:id(2),timeout:30000});
const admission=(c=config(),g=guard(),b=body())=>binding.steelCreateConfigurationAdmission(c,g,id(1),id(4),b);
test('opaque configuration fingerprint binds the exact captured credential and independently pinned config',()=>{
 const c=config(),g=guard(),r=admission(c,g);
 const expected=hash({version:'r12.steel-runtime-configuration.1',provider:'steel',baseUrl:c.baseUrl,region:null,providerProjectId:id(4),...g.deployment});
 assert.equal(r.configurationHash,expected);assert.equal(r.credentialBindingHash,createHmac('sha256',c.apiKey).update('r12.steel-credential-binding.1\n'+expected).digest('hex'));
 assert.equal(r.requestBodyHash,hash(JSON.parse(body())));assert.ok(Object.isFrozen(r));assert.ok(!JSON.stringify(r).includes(c.apiKey));assert.equal(r.apiKey,undefined);assert.equal(r.profileId,undefined);
});
for(const[name,mutate]of [['credential',c=>{c.apiKey+='-changed';}],['region',c=>{c.region='another-region';}]])test(`changed ${name} invalidates the privately compared fingerprint`,()=>{const c=config(),before=admission(c);mutate(c);assert.notEqual(admission(c).credentialBindingHash,before.credentialBindingHash);});
for(const key of ['deploymentId','releaseCommitSha'])test(`changed ${key} cannot reuse a configuration permit`,()=>{const g=guard(),before=admission(config(),g);g.deployment[key]=key==='deploymentId'?'dpl_other':'2'.repeat(40);const after=admission(config(),g);assert.notEqual(before.configurationHash,after.configurationHash);assert.throws(()=>binding.validateSteelCreateConfigurationPermit(permit(before),after));});
test('unreviewed endpoint and missing production deployment identity fail closed',()=>{
 for(const baseUrl of ['https://other.invalid','https://api.steel.dev/','http://api.steel.dev'])assert.throws(()=>admission({...config(),baseUrl}));
 for(const env of [{},{VERCEL_ENV:'preview',VERCEL_DEPLOYMENT_ID:'dpl_fixture',VERCEL_GIT_COMMIT_SHA:'1'.repeat(40)},{VERCEL_ENV:'production',VERCEL_DEPLOYMENT_ID:'dpl_fixture'}])assert.throws(()=>binding.getSteelCreateDeployment(env));
 assert.deepEqual(binding.getSteelCreateDeployment({VERCEL_ENV:'production',VERCEL_DEPLOYMENT_ID:'dpl_fixture',VERCEL_GIT_COMMIT_SHA:'1'.repeat(40)}),{environment:'production',deploymentId:'dpl_fixture',releaseCommitSha:'1'.repeat(40)});
});
for(const key of ['operationId','scopeHash','providerProjectId','requestBodyHash','configurationHash','credentialBindingHash','deploymentId','attestationHash','admissionHash','validUntil'])test(`permit missing or substituted ${key} is rejected`,()=>{const r=admission(),p=permit(r);const absent={...p};delete absent[key];assert.throws(()=>binding.validateSteelCreateConfigurationPermit(absent,r));assert.throws(()=>binding.validateSteelCreateConfigurationPermit({...p,[key]:'different'},r));});
test('cross-operation body changes and stale, expanded or extra permits cannot authorize create',()=>{
 const r=admission(),now=Date.now(),p=permit(r,now);assert.deepEqual(binding.validateSteelCreateConfigurationPermit(p,r,now),p);
 for(const value of [{...p,extra:true},{...p,version:'legacy'},permit(r,now-30000),permit(r,now+10000)])assert.throws(()=>binding.validateSteelCreateConfigurationPermit(value,r,now));
 for(const changes of [{timeout:30001},{profileId:id(3)}])assert.throws(()=>binding.validateSteelCreateConfigurationPermit(p,admission(config(),guard(),JSON.stringify({...JSON.parse(body()),...changes})),now));
});
function provider(options={}){
 const events=[],calls=[],requests=[];let markers=0;
 const c=options.config??config(),g=options.guard===null?undefined:options.guard??guard({admit:async(r,s)=>{s.throwIfAborted();events.push('config');requests.push(r);return permit(r);}});
 const adapter=new SteelBrowserAdapter({config:c,createConfigurationGuard:g,admitDispatch:async r=>{events.push('transport');await options.transport?.(r);},fetcher:async(url,init)=>{events.push('POST');calls.push({url,init});const b=JSON.parse(init.body);return Response.json({id:b.sessionId,projectId:b.projectId,profileId:b.profileId??id(2),status:'live',debugUrl:`https://api.steel.dev/v1/sessions/${b.sessionId}/player`,solveCaptcha:false,useProxy:false,proxyBytesUsed:0});}});
 return{adapter,events,calls,requests,create:(signal)=>adapter.createInsightsSession(id(1),id(4),id(2),30000,()=>{events.push('marker');markers++;},signal),markers:()=>markers};
}
test('actual adapter admits captured config before transport and one-shot POST',async()=>{const f=provider();await f.create();assert.deepEqual(f.events,['config','transport','marker','POST']);assert.equal(f.calls.length,1);assert.equal(f.requests[0].requestBodyHash,hash(JSON.parse(f.calls[0].init.body)));assert.equal(f.calls[0].init.headers['steel-api-key'],config().apiKey);});
test('mutating caller config/deployment after construction cannot change the validated HTTP or CDP key',async()=>{
 const c=config(),g=guard(),expected=c.apiKey,f=provider({config:c,guard:g});c.apiKey='different';c.baseUrl='https://other.invalid';g.deployment.deploymentId='dpl_changed';g.scopeHash=hash('changed');
 const r=await f.create();assert.equal(f.calls[0].init.headers['steel-api-key'],expected);assert.equal(new URL(r.automationEndpoint).searchParams.get('apiKey'),expected);
});
test('missing, denied or mismatched configuration authority makes zero transport calls and zero paid POSTs',async()=>{
 for(const g of [null,guard({admit:async()=>{throw Error('private-key-value');}}),guard({admit:async r=>({...permit(r),requestBodyHash:hash('other')})})]){const f=provider({guard:g});await assert.rejects(f.create(),e=>{assert.doesNotMatch(e.message,/private-key-value/);return true;});assert.equal(f.calls.length,0);assert.equal(f.markers(),0);assert.ok(!f.events.includes('transport'));}
});
test('permit expiring during transport admission cannot reach the synchronous marker or POST',async()=>{let now=Date.now();const f=provider({guard:guard({now:()=>now,admit:async r=>permit(r,now)}),transport:async()=>{now+=25000;}});await assert.rejects(f.create());assert.equal(f.calls.length,0);assert.equal(f.markers(),0);});
test('the consumed create admission cannot send a second paid POST',async()=>{let admitted=false;const f=provider({transport:async()=>{if(admitted)throw Error('inert consumed SQL permit');admitted=true;}});await f.create();await assert.rejects(f.create());assert.equal(f.calls.length,1);assert.equal(f.markers(),1);});
test('config mutation during admission cannot substitute the key after fingerprint comparison',async()=>{const c=config(),expected=c.apiKey,f=provider({config:c,transport:async()=>{c.apiKey='changed-after-comparison';}});const result=await f.create();assert.equal(f.calls[0].init.headers['steel-api-key'],expected);assert.equal(new URL(result.automationEndpoint).searchParams.get('apiKey'),expected);});
test('aborted unresolved configuration admission cannot create or later upgrade itself',async()=>{const stop=new AbortController();let finish,started;const ready=new Promise(r=>started=r),pending=new Promise(r=>finish=r),f=provider({guard:guard({admit:async r=>{started(r);return pending;}})});const work=f.create(stop.signal),r=await ready;stop.abort();await assert.rejects(work);finish(permit(r));await Promise.resolve();assert.equal(f.calls.length,0);assert.equal(f.markers(),0);});
test('inactive create authority does not block exact-session release or terminal receipt readback',async()=>{const calls=[],adapter=new SteelBrowserAdapter({config:config(),admitDispatch:async()=>{},fetcher:async(url)=>{calls.push(String(url));return Response.json(calls.length===1?{success:true}:{id:id(1),projectId:id(4),status:'released'});}});assert.deepEqual(await adapter.releaseOwnerHandoffSession(id(1),id(4)),{sessionId:id(1),released:true,terminalReadback:true});assert.equal(calls.length,2);});
