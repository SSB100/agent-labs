import test from 'node:test';
import assert from 'node:assert/strict';
import {createEtsySteelHandoffPort} from '../.core-tests/accounts/etsy-steel-handoff-port.js';
import {ETSY_INSIGHTS_DEFAULT_RENDERER_POLICY as POLICY,etsyInsightsRendererPolicyHash} from '../.core-tests/browser/etsy-insights-renderer-policy.js';
import {etsySteelHash as hash} from '../.core-tests/accounts/etsy-steel-handoff-contracts.js';
const id=n=>`78000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture(options={}){
 const events=[],cleanups=[],calls=[],handlers=new Map(),cdpCalls=[];let connected=true,url=options.initialUrl??'about:blank',released=false;
 const frame={url:()=>url};
 const page={mainFrame:()=>frame,on:(name,fn)=>handlers.set(name,fn),url:()=>url,goto:async value=>{events.push('goto');url=options.redirect??value;},removeAllListeners:async()=>{events.push('page-drain');if(options.hang==='page-drain')await new Promise(()=>{});}};
 const context={pages:()=>[page],serviceWorkers:()=>[],on:(name,fn)=>handlers.set(name,fn),routeWebSocket:async()=>{},
  newCDPSession:async()=>({on:(name,fn)=>handlers.set(name,fn),send:async(name,args)=>{cdpCalls.push({name,args});if(name==='Page.getFrameTree')return{frameTree:{frame:{id:'main'}}};if(name==='Target.closeTarget')return{success:!options.closeChildFail};},detach:async()=>{events.push('cdp-detach');if(options.hang==='cdp-detach')await new Promise(()=>{});}}),route:async()=>events.push('route'),unrouteAll:async()=>{events.push('unroute-drain');if(options.drainFail)throw Error('drain');if(options.hang==='unroute-drain')await new Promise(()=>{});},removeAllListeners:async()=>{events.push('context-drain');if(options.hang==='context-drain')await new Promise(()=>{});}};
 const browser={contexts:()=>[context],isConnected:()=>connected,close:async()=>{events.push('disconnect');if(options.hungClose||options.hang==='disconnect')await new Promise(()=>{});if(!options.disconnectFail)connected=false;}};
 const q={version:'etsy.owner-handoff-renderer-qualification.1',operationId:id(1),providerProjectId:id(4),policy:{...POLICY,...options.policy},policyHash:etsyInsightsRendererPolicyHash({...POLICY,...options.policy}),expiresAt:new Date(Date.now()+120000).toISOString(),...options.qualification};
 const qualification={...q,qualificationHash:hash(q)};
 const port=createEtsySteelHandoffPort({providerProjectId:id(4),rendererQualification:options.noQualification?undefined:qualification,config:{apiKey:'inert-port-key',baseUrl:'https://api.steel.dev'},beforeCreate:options.beforeCreate??(()=>events.push('marker')),
  admitDispatch:async()=>{events.push('admission');if(options.deny)throw Error('denied');},registerCleanup:work=>cleanups.push(work),
  connect:async endpoint=>{events.push('connect');assert.equal(new URL(endpoint).hostname,'connect.steel.dev');return options.connect?options.connect(browser):browser;},
  fetcher:async(address,init)=>{const path=new URL(address).pathname;calls.push({path,method:init.method??'GET'});
   if(path.endsWith('/release')){released=true;events.push('release');return Response.json({success:true});}
   if(path==='/v1/sessions'&&options.createFail)throw Error('ambiguous');
   return Response.json({id:id(1),projectId:id(4),profileId:id(2),status:released||options.notLive?'released':'live',debugUrl:`https://api.steel.dev/v1/sessions/${id(1)}/player`,solveCaptcha:false,proxyBytesUsed:0});
  }});
 return{port,events,calls,cleanups,browser,handlers,cdpCalls,request:{browserSessionId:id(1),profileId:null,timeoutMs:900000},signal:new AbortController().signal};
}
test('owner URL is returned only after physical CDP disconnect and current provider readback',async()=>{
 const f=fixture(),s=await f.port.createSession(f.request,f.signal);assert.equal(f.events.includes('disconnect'),false);
 const proof=await s.disconnectForOwner(f.signal);assert.equal(proof.cdpDisconnected,true);assert.equal(f.browser.isConnected(),false);
 assert.ok(f.events.indexOf('unroute-drain')<f.events.indexOf('disconnect'));assert.ok(f.events.indexOf('page-drain')<f.events.indexOf('disconnect'));
 assert.equal(f.calls.filter(c=>c.path==='/v1/sessions').length,1);await assert.rejects(s.disconnectForOwner(f.signal));await Promise.all(f.cleanups);
});
test('denied creation and reused profile never connect',async()=>{for(const deny of[true,false]){const f=fixture({deny});await assert.rejects(f.port.createSession({...f.request,profileId:deny?null:id(2)},f.signal));assert.equal(f.calls.length,0);assert.equal(f.events.includes('connect'),false);}});
for(const[label,options]of[['nonfresh',{initialUrl:'https://www.etsy.com/signin'}],['redirect',{redirect:'https://untrusted.example'}],['drain failure',{drainFail:true}],['disconnect failure',{disconnectFail:true}],['not live',{notLive:true}]])test(label+' fails closed and releases exact session',async()=>{const f=fixture(options);await assert.rejects(async()=>{const s=await f.port.createSession(f.request,f.signal);await s.disconnectForOwner(f.signal);});await Promise.all(f.cleanups);assert.ok(f.events.includes('release'));assert.equal(f.calls.filter(c=>c.path==='/v1/sessions').length,1);});
test('ambiguous create keeps exact known UUID and never retries',async()=>{const f=fixture({createFail:true});await assert.rejects(f.port.createSession(f.request,f.signal));await Promise.all(f.cleanups);assert.equal(f.calls.filter(c=>c.path==='/v1/sessions').length,1);assert.ok(f.calls.some(c=>c.path===`/v1/sessions/${id(1)}/release`));});
test('asynchronous wrapped guard cannot create or release unmarked session',async()=>{const f=fixture({beforeCreate:async()=>{throw Error('denied');}});await assert.rejects(f.port.createSession(f.request,f.signal));await Promise.all(f.cleanups);assert.equal(f.calls.length,0);assert.equal(f.events.includes('connect'),false);});
test('hung CDP close does not delay provider release',async()=>{const keepAlive=setTimeout(()=>{},7000);const f=fixture({initialUrl:'https://www.etsy.com/signin',hungClose:true});await assert.rejects(f.port.createSession(f.request,f.signal));for(let i=0;i<20&&!f.events.includes('release');i++)await new Promise(r=>setImmediate(r));assert.ok(f.events.includes('release'));await Promise.all(f.cleanups);clearTimeout(keepAlive);});
test('late CDP connection after Stop is disconnected and release is retained',async()=>{let resolve;const f=fixture({connect:()=>new Promise(r=>resolve=r)}),c=new AbortController();const opening=f.port.createSession(f.request,c.signal);for(let i=0;i<20&&!resolve;i++)await new Promise(r=>setImmediate(r));assert.equal(typeof resolve,'function');c.abort();await assert.rejects(opening);resolve(f.browser);await Promise.all(f.cleanups);assert.equal(f.browser.isConnected(),false);assert.ok(f.events.includes('release'));});

for(const stage of ['unroute-drain','page-drain','context-drain','cdp-detach','disconnect'])test(`owner ${stage} hang denies viewer proof and still releases provider`,async()=>{
 const hold=setTimeout(()=>{},5000);try{const f=fixture({hang:stage}),s=await f.port.createSession(f.request,f.signal);
 await assert.rejects(s.disconnectForOwner(f.signal));for(let i=0;i<20&&!f.events.includes('release');i++)await new Promise(r=>setImmediate(r));
 assert.ok(f.events.includes('release'));await Promise.all(f.cleanups);
 }finally{clearTimeout(hold);}
});
test('owner redirect successor is denied before network and no viewer can be exposed',async()=>{
 const f=fixture(),s=await f.port.createSession(f.request,f.signal);
 await f.handlers.get('Fetch.requestPaused')({requestId:'redirect',redirectedRequestId:'original',resourceType:'Document',frameId:'main',request:{url:'https://www.etsy.com/',method:'GET'}});
 assert.ok(f.cdpCalls.some(c=>c.name==='Fetch.failRequest'));assert.ok(!f.cdpCalls.some(c=>c.name==='Fetch.continueRequest'));
 await assert.rejects(s.disconnectForOwner(f.signal));await Promise.all(f.cleanups);assert.ok(f.events.includes('release'));
});
test('owner child target invalidation prevents viewer even after a successful close acknowledgement',async()=>{
 for(const closeChildFail of [false,true]){const f=fixture({closeChildFail}),s=await f.port.createSession(f.request,f.signal);
 f.handlers.get('Target.attachedToTarget')({targetInfo:{targetId:'child'}});await assert.rejects(s.disconnectForOwner(f.signal));await Promise.all(f.cleanups);
 assert.ok(f.cdpCalls.some(c=>c.name==='Target.closeTarget'));assert.ok(!f.cdpCalls.some(c=>c.name==='Runtime.runIfWaitingForDebugger'));}
});

for(const [name,options] of [['missing',{noQualification:true}],['different operation',{qualification:{operationId:id(5)}}],['different project',{qualification:{providerProjectId:id(5)}}],['expired',{qualification:{expiresAt:'2020-01-01T00:00:00.000Z'}}],['policy hash mismatch',{qualification:{policyHash:'a'.repeat(64)}}]])test(`handoff ${name} renderer qualification cannot create paid session`,async()=>{
 const f=fixture(options);await assert.rejects(f.port.createSession(f.request,f.signal));assert.equal(f.calls.length,0);assert.equal(f.events.includes('marker'),false);
});
test('handoff reviewed exact static origin is immutable and does not authorize an adjacent host',async()=>{
 const policy={staticOrigins:['https://synthetic.etsystatic.com']},f=fixture({policy}),s=await f.port.createSession(f.request,f.signal);
 policy.staticOrigins.push('https://other.etsystatic.com');
 const request=url=>({requestId:url,resourceType:'Script',frameId:'main',request:{url,method:'GET'}});
 await f.handlers.get('Fetch.requestPaused')(request('https://synthetic.etsystatic.com/file.js'));
 assert.ok(f.cdpCalls.some(c=>c.name==='Fetch.continueRequest'));
 await f.handlers.get('Fetch.requestPaused')(request('https://other.etsystatic.com/file.js'));
 assert.ok(f.cdpCalls.some(c=>c.name==='Fetch.failRequest'));
 await assert.rejects(s.disconnectForOwner(f.signal));await Promise.all(f.cleanups);
});
