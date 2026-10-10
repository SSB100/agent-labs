import test from 'node:test';
import assert from 'node:assert/strict';
import {SteelBrowserAdapter} from '../.core-tests/browser/providers/steel.js';
const id=n=>`76000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const session=()=>({id:id(1),projectId:id(4),profileId:id(2),status:'live',debugUrl:`https://api.steel.dev/v1/sessions/${id(1)}/player`,solveCaptcha:false,useProxy:false,proxyBytesUsed:0,stealthConfig:{autoCaptchaSolving:false,humanizeInteractions:false,skipFingerprintInjection:true},websocketUrl:'wss://untrusted.example/never-use'});
function fixture({admit=async()=>{},response=session(),baseUrl='https://api.steel.dev',fetcher}={}){
 const calls=[],admissions=[];let markers=0;
 const adapter=new SteelBrowserAdapter({config:{apiKey:'inert-test-key',baseUrl},admitDispatch:async r=>{admissions.push(r);await admit(r);},fetcher:fetcher??(async(url,init)=>{calls.push({url:String(url),init});return Response.json(response);})});
 return{adapter,calls,admissions,marker:()=>{markers++;},markers:()=>markers};
}
test('exact one-shot owner session uses disabled proxy, captcha and fingerprint features',async()=>{
 const f=fixture(),r=await f.adapter.createOwnerHandoffSession(id(1),id(4),900000,f.marker);
 assert.equal(f.calls.length,1);assert.equal(f.markers(),1);assert.equal(f.admissions[0].operation,'browser.etsy.owner_handoff.create');
 const {url,init}=f.calls[0];assert.equal(url,'https://api.steel.dev/v1/sessions');assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');
 assert.deepEqual(JSON.parse(init.body),{sessionId:id(1),projectId:id(4),timeout:900000,persistProfile:true,debugConfig:{interactive:true,systemCursor:true},useProxy:false,solveCaptcha:false,stealthConfig:{autoCaptchaSolving:false,humanizeInteractions:false,skipFingerprintInjection:true}});
 assert.equal(new URL(r.automationEndpoint).origin,'wss://connect.steel.dev');assert.equal(r.sessionViewerUrl,null);assert.doesNotMatch(JSON.stringify(r),/untrusted.example/);
});
test('Insights exact approved profile is not persisted anew',async()=>{const f=fixture();await f.adapter.createInsightsSession(id(1),id(4),id(2),120000,f.marker);const body=JSON.parse(f.calls[0].init.body);assert.equal(body.profileId,id(2));assert.equal(body.persistProfile,false);assert.equal(body.debugConfig.interactive,false);assert.equal(body.sessionContext,undefined);assert.equal(body.credentials,undefined);});
for(const [label,change] of [['denied admission',()=>{throw Error('denied');}],['expired approval',()=>{throw Error('expired');}]])test(label+' never sends',async()=>{const f=fixture({admit:change});await assert.rejects(f.adapter.createOwnerHandoffSession(id(1),id(4),30000,f.marker));assert.equal(f.calls.length,0);assert.equal(f.markers(),0);});
test('invalid lifetimes, identifiers and route never send',async()=>{
 for(const [sid,pid,ms]of[['../context',id(4),30000],[id(1),'bad',30000],[id(1),id(4),900001],[id(1),id(4),14999],[id(1),id(4),NaN]]){const f=fixture();await assert.rejects(f.adapter.createOwnerHandoffSession(sid,pid,ms,f.marker));assert.equal(f.calls.length,0);}
 for(const baseUrl of ['https://evil.example','https://api.steel.dev/','http://api.steel.dev']){const f=fixture({baseUrl});await assert.rejects(f.adapter.createOwnerHandoffSession(id(1),id(4),30000,f.marker));assert.equal(f.calls.length,0);}
});
for(const [label,mutate]of[['session',r=>r.id=id(3)],['project',r=>r.projectId=id(3)],['viewer',r=>r.debugUrl='https://evil.example'],['viewer query',r=>r.debugUrl+='?token=private'],['profile',r=>delete r.profileId],['status',r=>r.status='released'],['captcha',r=>r.solveCaptcha=true],['proxy',r=>r.useProxy=true],['proxy bytes',r=>r.proxyBytesUsed=1],['auto captcha',r=>r.stealthConfig.autoCaptchaSolving=true],['humanization',r=>r.stealthConfig.humanizeInteractions=true],['fingerprint',r=>r.stealthConfig.skipFingerprintInjection=false]])test('rejects substituted '+label+' without retry',async()=>{const response=session();mutate(response);const f=fixture({response});await assert.rejects(f.adapter.createOwnerHandoffSession(id(1),id(4),30000,f.marker));assert.equal(f.calls.length,1);});
test('profile substitution rejected without a second create',async()=>{const f=fixture();await assert.rejects(f.adapter.createInsightsSession(id(1),id(4),id(3),30000,f.marker));assert.equal(f.calls.length,1);});
test('provider errors and redirects remain sanitized and nonretryable',async()=>{for(const status of[302,401,403,429,500]){let n=0;const f=fixture({fetcher:async()=>{n++;return new Response('password=secret',{status,headers:{location:'https://evil.example'}});}});await assert.rejects(f.adapter.createOwnerHandoffSession(id(1),id(4),30000,f.marker),e=>{assert.doesNotMatch(JSON.stringify(e)+e.message,/password|secret|evil.example/);assert.equal(e.retryable,false);return true;});assert.equal(n,1);}});
test('profile read returns only exact metadata',async()=>{const f=fixture({response:{id:id(2),projectId:id(4),sourceSessionId:id(1),status:'READY',cookies:'must not leak'}});assert.deepEqual(await f.adapter.retrieveOwnerHandoffProfile(id(2),id(4)),{id:id(2),sourceSessionId:id(1),status:'READY'});});
test('Stop cleanup requires exact cleanup admission and terminal readback',async()=>{
 const calls=[],f=fixture({admit:async r=>{assert.ok(['browser.etsy.session.release','browser.etsy.session.release_readback'].includes(r.operation));},fetcher:async(url,init)=>{calls.push({url:String(url),init});return Response.json(calls.length===1?{success:true}:{id:id(1),projectId:id(4),status:'released'});}});
 assert.deepEqual(await f.adapter.releaseOwnerHandoffSession(id(1),id(4)),{sessionId:id(1),released:true,terminalReadback:true});assert.equal(f.admissions.length,2);assert.equal(calls.length,2);
});
test('cleanup without ownership admission sends nothing',async()=>{const f=fixture({admit:async()=>{throw Error('not owned');}});await assert.rejects(f.adapter.releaseOwnerHandoffSession(id(1),id(4)));assert.equal(f.calls.length,0);});
test('release ack alone does not claim terminal settlement',async()=>{let n=0;const f=fixture({fetcher:async()=>Response.json(++n===1?{success:true}:{id:id(3),status:'released'})});assert.equal((await f.adapter.releaseOwnerHandoffSession(id(1),id(4))).terminalReadback,false);});
test('async guard is rejected before create',async()=>{const f=fixture();await assert.rejects(f.adapter.createOwnerHandoffSession(id(1),id(4),30000,async()=>{throw Error('denied');}));assert.equal(f.calls.length,0);});
test('oversized provider payload fails closed',async()=>{const f=fixture({fetcher:async()=>new Response('x'.repeat(65537))});await assert.rejects(f.adapter.createOwnerHandoffSession(id(1),id(4),30000,f.marker));});
test('terminal usage retains observed dimensions only and never exposes private response fields',async()=>{
 const f=fixture({response:{...session(),status:'released',timeout:30000,duration:1234,proxySource:null,creditsUsed:91,cookies:'private',debugUrl:'private'}});
 const r=await f.adapter.retrieveScopedTerminalUsage(id(1),id(4));
 assert.deepEqual(r,{version:'etsy.steel-terminal-usage.1',sessionId:id(1),providerProjectId:id(4),providerStatus:'released',providerTimeoutMs:30000,durationMs:1234,proxyBytesUsed:0,proxySource:null,solveCaptcha:false});
 assert.equal(f.admissions[0].operation,'browser.etsy.session.release_readback');assert.doesNotMatch(JSON.stringify(r),/private|credits|debug|cookie/);
});
test('missing terminal usage dimensions remain unknown and identity mismatch fails',async()=>{
 const f=fixture({response:{id:id(1),projectId:id(4),status:'failed'}}),r=await f.adapter.retrieveScopedTerminalUsage(id(1),id(4));
 assert.equal(r.durationMs,null);assert.equal(r.providerTimeoutMs,null);assert.equal(r.proxyBytesUsed,null);assert.equal(r.proxySource,'unknown');assert.equal(r.solveCaptcha,null);
 for(const response of[{id:id(2),projectId:id(4),status:'released'},{id:id(1),projectId:id(3),status:'released'},{id:id(1),projectId:id(4),status:'live'}])await assert.rejects(fixture({response}).adapter.retrieveScopedTerminalUsage(id(1),id(4)));
});
