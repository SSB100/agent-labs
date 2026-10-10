import test from 'node:test';
import assert from 'node:assert/strict';
import {createEtsySteelHandoffPort} from '../.core-tests/accounts/etsy-steel-handoff-port.js';
const id=n=>`78000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture(options={}){
 const events=[],cleanups=[],calls=[];let connected=true,url=options.initialUrl??'about:blank',released=false;
 const page={url:()=>url,goto:async value=>{events.push('goto');url=options.redirect??value;},removeAllListeners:async()=>events.push('page-drain')};
 const context={pages:()=>[page],route:async()=>events.push('route'),unrouteAll:async()=>{events.push('unroute-drain');if(options.drainFail)throw Error('drain');},removeAllListeners:async()=>events.push('context-drain')};
 const browser={contexts:()=>[context],isConnected:()=>connected,close:async()=>{events.push('disconnect');if(options.hungClose)await new Promise(()=>{});if(!options.disconnectFail)connected=false;}};
 const port=createEtsySteelHandoffPort({providerProjectId:id(4),config:{apiKey:'inert-port-key',baseUrl:'https://api.steel.dev'},beforeCreate:options.beforeCreate??(()=>events.push('marker')),
  admitDispatch:async()=>{events.push('admission');if(options.deny)throw Error('denied');},registerCleanup:work=>cleanups.push(work),
  connect:async endpoint=>{events.push('connect');assert.equal(new URL(endpoint).hostname,'connect.steel.dev');return options.connect?options.connect(browser):browser;},
  fetcher:async(address,init)=>{const path=new URL(address).pathname;calls.push({path,method:init.method??'GET'});
   if(path.endsWith('/release')){released=true;events.push('release');return Response.json({success:true});}
   if(path==='/v1/sessions'&&options.createFail)throw Error('ambiguous');
   return Response.json({id:id(1),projectId:id(4),profileId:id(2),status:released||options.notLive?'released':'live',debugUrl:`https://api.steel.dev/v1/sessions/${id(1)}/player`,solveCaptcha:false,proxyBytesUsed:0});
  }});
 return{port,events,calls,cleanups,browser,request:{browserSessionId:id(1),profileId:null,timeoutMs:900000},signal:new AbortController().signal};
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
