import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';
import { installEtsyRequestAdmission, releaseEtsyTransportAndDispose } from '../.core-tests/browser/etsy-request-admission.js';

const tick=()=>new Promise(r=>setImmediate(r));
function cdpFixture(){
 const handlers=new Map(),calls=[],reasons=[],admitted=[];
 const cdp={on(name,fn){handlers.set(name,fn);},async send(name,args){calls.push({name,args});if(name==='Page.getFrameTree')return{frameTree:{frame:{id:'main'}}};}};
 return{cdp,handlers,calls,reasons,admitted,input:{cdp,signal:new AbortController().signal,admit:async r=>admitted.push(r),invalidate:r=>reasons.push(r)}};
}
test('Request stage covers every hop and exposes only a frozen metadata projection',async()=>{
 const f=cdpFixture();await installEtsyRequestAdmission(f.input);
 const request={url:'https://www.etsy.com/approved',method:'GET'};
 for(const key of ['headers','postData','cookies'])Object.defineProperty(request,key,{get(){assert.fail(`must not read ${key}`);}});
 await f.handlers.get('Fetch.requestPaused')({requestId:'1',frameId:'main',resourceType:'Document',request});
 assert.deepEqual(f.admitted,[{url:request.url,method:'GET',resourceType:'document',navigation:true}]);assert.ok(Object.isFrozen(f.admitted[0]));
 await f.handlers.get('Fetch.requestPaused')({requestId:'2',redirectedRequestId:'1',frameId:'main',resourceType:'Document',request});
 assert.equal(f.admitted.length,1);assert.ok(f.calls.some(c=>c.name==='Fetch.failRequest'&&c.args.requestId==='2'));
 assert.ok(!f.calls.some(c=>c.name==='Fetch.continueRequest'&&c.args.requestId==='2'));
 assert.deepEqual(f.calls.find(c=>c.name==='Fetch.enable').args,{patterns:[{urlPattern:'*',requestStage:'Request'}],handleAuthRequests:true});
});
test('auth challenges are cancelled without reading authentication material',async()=>{
 const f=cdpFixture();await installEtsyRequestAdmission(f.input);const event={requestId:'auth'};
 Object.defineProperty(event,'authChallenge',{get(){assert.fail('authentication data must not be read');}});
 f.handlers.get('Fetch.authRequired')(event);await tick();
 assert.deepEqual(f.calls.find(c=>c.name==='Fetch.continueWithAuth').args,{requestId:'auth',authChallengeResponse:{response:'CancelAuth'}});
 assert.deepEqual(f.reasons,['renderer_authentication_denied']);
});
test('failed admission is redacted and never dispatches the paused request',async()=>{
 const f=cdpFixture();f.input.admit=async()=>{throw Error('secret provider response');};await installEtsyRequestAdmission(f.input);
 await f.handlers.get('Fetch.requestPaused')({requestId:'denied',frameId:'main',resourceType:'Document',request:{url:'https://www.etsy.com/',method:'GET'}});
 assert.deepEqual(f.reasons,['renderer_request_denied']);assert.ok(!f.calls.some(c=>c.name==='Fetch.continueRequest'));
});
test('drain tracks child-close acknowledgements added while an earlier snapshot is pending',async()=>{
 const f=cdpFixture(),acks=new Map(),send=f.cdp.send;
 f.cdp.send=(name,args)=>name==='Target.closeTarget'?new Promise(resolve=>acks.set(args.targetId,resolve)):send(name,args);
 const guard=await installEtsyRequestAdmission(f.input);
 f.handlers.get('Target.attachedToTarget')({targetInfo:{targetId:'one'}});
 let done=false;const draining=guard.drain().then(value=>{done=true;return value;});
 f.handlers.get('Target.attachedToTarget')({targetInfo:{targetId:'two'}});
 acks.get('one')({success:true});await tick();assert.equal(done,false);
 acks.get('two')({success:true});assert.equal(await draining,true);
});
test('unconfirmed child-target closure cannot certify drained observers',async()=>{
 for(const answer of [{success:false},null]){
  const f=cdpFixture(),send=f.cdp.send;
  f.cdp.send=async(name,args)=>{if(name!=='Target.closeTarget')return send(name,args);if(answer===null)throw Error('closed transport');return answer;};
  const guard=await installEtsyRequestAdmission(f.input);
  f.handlers.get('Target.attachedToTarget')({targetInfo:{targetId:'child'}});
  assert.equal(await guard.drain(),false);
 }
});
test('unknown provider release retains the request guard and cannot claim disposal',async()=>{
 const work=[],calls=[];
 const result=await releaseEtsyTransportAndDispose({sessionId:'one',marked:true,registerCleanup:p=>work.push(p),
  release:async()=>{calls.push('release');throw Error('unknown');},dispose:[async()=>calls.push('detach')]});
 assert.deepEqual(result,{sessionId:'one',released:false,terminalReadback:false,observersDisposed:false});
 await Promise.all(work);assert.deepEqual(calls,['release']);
});
test('late release after caller timeout cleans up but does not upgrade returned authority',async()=>{
 const hold=setTimeout(()=>{},4000);let finish;const pending=new Promise(r=>{finish=r;}),work=[],calls=[];
 try{
  const result=await releaseEtsyTransportAndDispose({sessionId:'one',marked:true,registerCleanup:p=>work.push(p),
   release:async()=>{calls.push('release');return pending;},dispose:[async()=>calls.push('detach')]});
  assert.equal(result.observersDisposed,false);assert.deepEqual(calls,['release']);
  finish({sessionId:'one',released:true,terminalReadback:true});await Promise.all(work);
  assert.deepEqual(calls,['release','detach']);assert.equal(result.released,false);
 }finally{clearTimeout(hold);}
});

// Optional local, inert integration qualification. No external hosts, owner
// profile or paid browser. CI must explicitly provide its installed Chromium.
test('actual Chromium blocks redirect destinations before any HTTP request',
 {skip:!process.env.AGENT_LABS_LOCAL_CHROMIUM,timeout:30000},async()=>{
  const hits=[];
  const server=createServer((req,res)=>{
   hits.push(req.url);
   if(req.url==='/navigation'||req.url==='/image'||req.url==='/fetch'){
    res.writeHead(302,{Location:'/denied'});res.end();return;
   }
   res.setHeader('content-type','text/html');
   if(req.url==='/image-page')res.end('<!doctype html><img src="/image">');
   else if(req.url==='/fetch-page')res.end('<!doctype html><script>fetch("/fetch").catch(()=>{});</script>');
   else res.end('forbidden destination');
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  let browser;
  try{
   const origin=`http://127.0.0.1:${server.address().port}`;
   browser=await chromium.launch({executablePath:process.env.AGENT_LABS_LOCAL_CHROMIUM,headless:true});
   for(const entry of ['/navigation','/image-page','/fetch-page']){
    const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage(),cdp=await context.newCDPSession(page);
    const reasons=[],admitted=[];
    await context.route('**/*',async route=>{if(route.request().frame()!==page.mainFrame())await route.abort();else await route.continue();});
    const guard=await installEtsyRequestAdmission({cdp,signal:AbortSignal.timeout(10000),invalidate:r=>reasons.push(r),
     async admit(r){admitted.push(r);assert.equal(new URL(r.url).origin,origin);assert.equal(r.method,'GET');}
    });
    await page.goto(origin+entry,{waitUntil:'load',timeout:5000}).catch(()=>undefined);
    const deadline=Date.now()+2000;while(!reasons.length&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));
    assert.ok(reasons.includes('renderer_redirect_denied'),`${entry} must pause its redirected request`);
    assert.equal(hits.filter(x=>x==='/denied').length,0,`${entry}: denied destination received ZERO requests`);
    assert.ok(!admitted.some(r=>new URL(r.url).pathname==='/denied'),'redirect never reaches admission callback');
    guard.seal();await context.close();await guard.drain();
   }
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
 });
