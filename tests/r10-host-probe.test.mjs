import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import * as probe from '../.core-tests/browser/watch/host-probe.js';
import * as page from '../.core-tests/browser/watch/host-probe-page.js';
const origin='https://inert.invalid';
const request=(mode,options={})=>new Request(origin+'/api/health/r10-host-probe',{
 method:'POST',headers:{origin,'content-type':'application/json','sec-fetch-site':'same-origin'},body:JSON.stringify({case:mode}),...options,
});
const begin=async(mode,options={})=>{
 const events=[];let completion;
 const original=console.info;console.info=(prefix,event)=>{assert.equal(prefix,'[r10-host-probe]');events.push(JSON.parse(event));};
 try {
  const response=await probe.runHostProbe(request(mode,options),p=>{completion=p;events.push({phase:'registered'});});
  return{response,events,completion,restore:()=>{console.info=original;}};
 }catch(e){console.info=original;throw e;}
};
const completionFence=async p=>{let timer;try{await Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('probe did not complete')),5500);})]);}finally{clearTimeout(timer);}};
const has=(events,phase,reason)=>events.some(event=>event.phase===phase&&event.reason===reason);

test('host probe normal JSON returns before retained work completes',async()=>{
 const f=await begin('normal-response');try{
  assert.equal(f.response.status,200);assert.deepEqual(await f.response.json(),{diagnostic:'provider-free',qualification:false,case:'normal-response'});
  assert.equal(has(f.events,'control','completed'),false);await completionFence(f.completion);
  assert.equal(f.events[0].phase,'registered');assert.ok(has(f.events,'control','completed'));assert.ok(has(f.events,'hosting','completed'));
 }finally{f.restore();}
});
for(const mode of ['early-empty-eof','post-frame-failure','owner-revoke','client-cancel'])test(`host probe ${mode} retains fake disposal, release and close after transport termination`,async()=>{
 const control=new AbortController(),f=await begin(mode,{signal:control.signal});try{
  assert.equal(f.response.status,200);assert.match(f.response.headers.get('cache-control'),/no-store/);
  const reader=f.response.body.getReader();
  if(mode==='early-empty-eof')assert.equal((await reader.read()).done,true);
  else{
   const packet=JSON.parse(new TextDecoder().decode((await reader.read()).value));assert.equal(packet.data,'/9j/2Q==');
   if(mode==='client-cancel')control.abort();
   await assert.rejects(reader.read());
  }
  assert.equal(has(f.events,'fake_close','completed'),false);
  await completionFence(f.completion);
  for(const phase of ['dispose','release','fake_close','close','cleanup','hosting'])assert.ok(has(f.events,phase,'completed'),phase);
  assert.equal(f.events.filter(e=>e.phase==='fake_close').length,1);
  assert.equal(f.events.find(e=>e.phase==='fake_close').capturedFrames,mode==='early-empty-eof'?0:1);
  const closeIndex=f.events.findIndex(e=>e.phase==='fake_close');
  assert.ok(f.events.findIndex(e=>e.phase==='release')<closeIndex);assert.ok(f.events.findIndex(e=>e.phase==='dispose')<closeIndex);
  assert.equal(has(f.events,'hard_limit','timeout'),false);
  for(const event of f.events.filter(e=>e.phase!=='registered')){
   assert.deepEqual(Object.keys(event).sort(),['capturedFrames','deliveredFrames','durationMs','phase','reason','remainingMs']);
   for(const key of ['capturedFrames','deliveredFrames','durationMs','remainingMs'])assert.ok(Number.isInteger(event[key])&&event[key]>=0&&event[key]<=5000);
  }
  assert.doesNotMatch(JSON.stringify(f.events),/https|inert|cookie|token|SECRET|writerId|pageId|endpoint/);
 }finally{f.restore();}
});
test('host probe reader cancellation also retains cleanup',async()=>{
 const f=await begin('client-cancel');try{const reader=f.response.body.getReader();await reader.read();await reader.cancel();await completionFence(f.completion);assert.ok(has(f.events,'fake_close','completed'));}finally{f.restore();}
});
test('host probe no-consumption path ends within fixed work cutoff',async()=>{
 const f=await begin('client-cancel');try{
  await completionFence(f.completion);assert.equal((await f.response.body.getReader().read()).done,true);
  assert.ok(has(f.events,'fake_close','completed'));assert.equal(has(f.events,'hard_limit','timeout'),false);
  assert.equal(f.events.find(e=>e.phase==='fake_close').capturedFrames,0);
 }finally{f.restore();}
});
test('host probe rejects non-exact, oversized, slow and hostile input without starting runtime',async()=>{
 for(const body of ['{}','{"case":"unknown"}','{"case":"normal-response","duration":999999}',' '+JSON.stringify({case:'normal-response'}),'x'.repeat(1000),'SECRET_AUTH https://endpoint.invalid/']){
  const f=await begin('normal-response',{body});try{assert.equal(f.response.status,400);await completionFence(f.completion);assert.equal(f.events.length,2);}finally{f.restore();}
 }
 const body=new ReadableStream({start(){}}),f=await begin('normal-response',{body,duplex:'half'});try{assert.equal(f.response.status,400);await completionFence(f.completion);assert.equal(f.events.length,2);}finally{f.restore();}
});
test('host probe strict same-origin, metadata, query and content-type guards',async()=>{
 for(const headers of [{origin:'https://other.invalid','content-type':'application/json'},{'content-type':'application/json'},{origin,'content-type':'text/plain'},{origin,'content-type':'application/json','sec-fetch-site':'cross-site'},{origin,'content-type':'application/json','sec-fetch-site':'same-site'}]){
  let completion;const response=await probe.runHostProbe(request('normal-response',{headers}),p=>{completion=p;});assert.ok([400,403].includes(response.status));if(completion)await completionFence(completion);
 }
 assert.equal(probe.isHostProbeRequest(new Request(origin+'/api/health/r10-host-probe?case=normal-response'),false),false);
 assert.equal(probe.isHostProbeRequest(new Request(origin+'/api/health/r10-host-probe',{headers:{'sec-fetch-site':'none'}}),false),true);
});
test('host registration failure fails before any inert work or response',async()=>{
 let completion;const response=await probe.runHostProbe(request('normal-response'),p=>{completion=p;throw Error('SECRET');});assert.equal(response.status,503);await completionFence(completion);
});
function loadRoute(environment){
 const mocks={'next/server':{after(){throw Error('must not register');}},'@/browser/watch/host-probe':probe,'@/browser/watch/host-probe-page':page};
 const loaded={exports:{}},compiled=ts.transpileModule(readFileSync('src/app/api/health/r10-host-probe/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 runInNewContext(`(function(require,module,exports){${compiled}\n})`,{process:{env:{VERCEL_ENV:environment}}})(name=>{assert.ok(Object.hasOwn(mocks,name),name);return mocks[name];},loaded,loaded.exports);return loaded.exports;
}
test('host probe route is404 outside preview and maxDuration stays10',async()=>{
 for(const environment of [undefined,'development','production','preview ']){const route=loadRoute(environment);assert.equal(route.maxDuration,10);assert.equal((await route.GET(new Request(origin))).status,404);assert.equal((await route.POST(request('normal-response'))).status,404);}
 assert.equal((await loadRoute('preview').GET(new Request(origin))).status,200);
});
test('host probe UI has exact buttons, inert marker checking, normal fetch abort and hash-only CSP',async()=>{
 const response=page.hostProbePage(),html=await response.text(),csp=response.headers.get('content-security-policy');
 for(const mode of probe.HOST_PROBE_CASES)assert.equal(html.split(`data-case="${mode}"`).length,2);
 for(const tag of ['script','style']){const body=html.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))[1];assert.ok(csp.includes(`'sha256-${createHash('sha256').update(body).digest('base64')}'`));}
 assert.doesNotMatch(csp,/unsafe-inline|unsafe-eval/);assert.match(csp,/connect-src 'self'/);assert.match(csp,/frame-ancestors 'none'/);
 assert.match(html,/control\.abort\(\)/);assert.match(html,/No viewer qualification/);assert.doesNotMatch(html,/https?:\/\/|<img|<iframe|<form/);
});
test('host probe dependency closure excludes provider, auth, SQL and secrets; existing proxy remains unchanged',()=>{
 for(const file of ['host-probe.ts','host-probe-page.ts']){
  const source=readFileSync('src/browser/watch/'+file,'utf8');const imports=[...source.matchAll(/from "([^"]+)"/g)].map(m=>m[1]);
  assert.ok(imports.every(value=>['node:crypto','./contracts','./lifetime','./runtime','./host-probe'].includes(value)),JSON.stringify(imports));
  assert.doesNotMatch(source,/process\.env|createViewerDependencies|createClient|supabase|\.rpc\(/);
 }
 const route=readFileSync('src/app/api/health/r10-host-probe/route.ts','utf8');assert.equal((route.match(/process\.env\./g)||[]).length,2);assert.match(route,/completion => after\(completion\)/);
 assert.match(readFileSync('src/proxy.ts','utf8'),/api\/health/);
});
