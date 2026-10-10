import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ETSY_INSIGHTS_DEFAULT_RENDERER_POLICY as POLICY, etsyInsightsRendererPolicyHash, admitEtsyInsightsRendererRequest } from '../.core-tests/browser/etsy-insights-renderer-policy.js';
import { createEtsyInsightsPlaywrightPort, ETSY_INSIGHTS_VISIBLE_SELECTORS as S } from '../.core-tests/browser/etsy-insights-playwright.js';
import { ETSY_RENDERER_DOM_REFERENCE_MANIFEST as REFS, ETSY_RENDERER_DOM_REFERENCE_HASH as PROVENANCE } from '../.core-tests/browser/etsy-insights-renderer-evidence.js';
import { insightsHash as hash } from '../.core-tests/browser/etsy-insights-policy.js';
import {fixture,verificationFixture,open,search,NOW,id,H,ROOT,QUERY,deferred,tick} from './helpers/etsy-insights-playwright-fixture.mjs';
test('observed selectors are bounded to live Insights controls, separate results query and shop identity',()=>{
 assert.equal(S.query,'input[aria-label="Input to search for keywords"]');assert.equal(S.heading,'h3.wt-text-display');
 assert.match(S.shops,/shop-manager--channels-list/);assert.match(S.summary,/wt-sem-border-b-divider/);
 const source=readFileSync(new URL('../src/browser/etsy-insights-playwright.ts',import.meta.url),'utf8');
 for(const dangerous of [/\.cookies\(/,/\.storageState\(/,/\.inputValue\(/,/\.postData\(/,/\.response\(/,/\.content\(/,/\.setExtraHTTPHeaders\(/])assert.doesNotMatch(source,dangerous);
});
test('scoped Steel port binds profile/project, performs one visible query and captures only visible literal aggregate nodes',async()=>{
 const f=fixture(),session=await open(f),p=await search(f,session),capture=await session.captureSameEpoch(p.documentEpoch,f.stop.signal);
 assert.equal(capture.facts.find(x=>x.kind==='query').quote,f.s.query);assert.equal(capture.facts.find(x=>x.kind==='shop_name').quote,'Synthetic Shop');
 assert.equal(capture.facts.find(x=>x.kind==='searches').quote,'Searches\n2.4k');
 assert.ok(!capture.facts.some(x=>['shop_id','aggregate_region','timezone','price'].includes(x.kind)));
 assert.equal(session.page,undefined);assert.equal(session.automationEndpoint,undefined);assert.equal(session.persistProfile,false);
 await assert.rejects(session.captureSameEpoch(p.documentEpoch,f.stop.signal));assert.equal(f.events.filter(x=>x==='screenshot').length,1);
 assert.equal(f.events.filter(x=>x==='submit').length,1);assert.ok(f.events.indexOf('qualify-renderer')<f.events.indexOf('create'));
 const close=await session.close(session.sessionId);assert.equal(close.observersDisposed,true);assert.equal(close.terminalReadback,true);
 assert.ok(f.events.indexOf('route-drain')<f.events.indexOf('disconnect'));assert.ok(f.events.indexOf('release')<f.events.indexOf('route-drain'));
 await Promise.all(f.cleanup);
});
for(const [name,o] of [
 ['wrong profile revision',{resolved:{profileBindingRevision:id(44)}}],['wrong project',{resolved:{providerProjectId:id(44)}}],
 ['other provider session',{resolved:{sessionId:id(44)}}],['other source attempt',{resolved:{sourceAttemptId:id(44)}}],['other request',{resolved:{requestHash:H(44)}}],
 ['unqualified renderer',{qualificationDenied:true}],['expired renderer',{qualification:{expiresAt:new Date(NOW).toISOString()}}],
 ['unbounded renderer',{qualification:{maximumRequests:1000}}],['denied transport',{transportDenied:true}],
])test(`${name} cannot dispatch paid create`,async()=>{const f=fixture(o);await assert.rejects(f.port.createSession(f.s,f.stop.signal));assert.ok(!f.events.includes('create'));});
for(const [name,o] of [
 ['wrong visible shop',{shop:'Other Shop'}],['missing shop selector',{missingSelector:S.shopName}],['multiple shop links',{twoShops:true}],
 ['offscreen node',{offscreen:true}],['hidden node',{hidden:true}],['disabled query',{disabled:true}],
 ['visible dialog or credential overlay',{overlay:true}],
])test(`${name} cannot submit`,async()=>{const f=fixture(o),s=await open(f);await assert.rejects(search(f,s));assert.ok(!f.events.includes('submit'));await s.close(s.sessionId);});
for(const [name,o] of [['wrong result heading',{headingQuery:'stale query'}],['wrong summary query',{summaryQuery:'stale query'}],['loading result',{loading:true}],['capture changes result',{duringCapture:true}]])test(`${name} cannot yield capture`,async()=>{
 const f=fixture(o),s=await open(f);await assert.rejects(async()=>{const p=await search(f,s);await s.captureSameEpoch(p.documentEpoch,f.stop.signal);});await s.close(s.sessionId);
});
test('caller cannot change query, control, epoch, replay submit or reopen',async()=>{
 const f=fixture(),s=await open(f),p=await s.observeAggregateView(f.stop.signal);
 for(const args of [['wrong',p.documentEpoch,f.s.query],[p.queryControl.id,p.documentEpoch+1,f.s.query],[p.queryControl.id,p.documentEpoch,'other query']])await assert.rejects(s.submitObservedQuery(...args,f.stop.signal));
 await search(f,s);await assert.rejects(s.submitObservedQuery(p.queryControl.id,p.documentEpoch,f.s.query,f.stop.signal));await assert.rejects(s.openApprovedInsights(f.stop.signal));await s.close(s.sessionId);
});
test('CDP guard admits only reviewed metadata and blocks unapproved navigation before transport',async()=>{
 const f=fixture(),s=await open(f);
 await f.request(ROOT);assert.ok(f.cdpCommands.some(c=>c.name==='Fetch.continueRequest'));
 await f.request('https://www.etsy.com/your/orders');assert.ok(f.cdpCommands.some(c=>c.name==='Fetch.failRequest'));
 await assert.rejects(s.observeAggregateView(f.stop.signal));await s.close(s.sessionId);
});
test('denied renderer, websocket, popup and service worker invalidate the exact attempt',async()=>{
 for(const mode of ['renderer','websocket','popup','worker']){
  const f=fixture({rendererDenied:mode==='renderer'}),s=await open(f);
  if(mode==='renderer')await f.request(ROOT);
  if(mode==='websocket')f.handlers.get('websocket')({close(){}});
  if(mode==='popup')f.handlers.get('page')({close:async()=>{}});
  if(mode==='worker')f.handlers.get('serviceworker')({});
  await assert.rejects(s.observeAggregateView(f.stop.signal));await s.close(s.sessionId);await Promise.all(f.cleanup);
 }
});
test('Stop and expiry cannot perform later query/capture; exact cleanup still works',async()=>{
 for(const mode of ['stop','expiry']){const f=fixture(),s=await open(f);if(mode==='stop')f.stop.abort();else f.setTime(NOW+70000);
  await assert.rejects(search(f,s));assert.ok(!f.events.includes('submit'));await s.close(s.sessionId);await Promise.all(f.cleanup);assert.ok(f.events.includes('release'));}
});
test('unknown cleanup does not claim terminal released authority',async()=>{
 for(const o of [{releaseFail:true},{disconnectFail:true},{drainFail:true}]){const f=fixture(o),s=await open(f),r=await s.close(s.sessionId);assert.ok(!r.released||!r.terminalReadback||!r.observersDisposed);}
});
test('wrong close identity and duplicate creation cannot operate a different or second session',async()=>{
 const f=fixture(),s=await open(f);await assert.rejects(s.close(id(40)));assert.ok(!f.events.includes('release'));
 await assert.rejects(f.port.createSession(f.s,f.stop.signal));assert.equal(f.events.filter(x=>x==='create').length,1);await s.close(s.sessionId);await Promise.all(f.cleanup);
});
test('ambiguous create and late connection preserve exact cleanup, never retry creation',async()=>{
 const f=fixture({createFail:true});await assert.rejects(f.port.createSession(f.s,f.stop.signal));await Promise.all(f.cleanup);assert.equal(f.events.filter(x=>x==='create').length,1);assert.ok(f.events.includes('release'));
 const d=deferred(),g=fixture({connect:()=>d.promise}),opening=g.port.createSession(g.s,g.stop.signal);
 for(let i=0;i<30&&!g.events.includes('connect');i++)await tick();g.stop.abort();await assert.rejects(opening);d.resolve(g.browser);await Promise.all(g.cleanup);assert.equal(g.browser.isConnected(),false);
});
test('existing tabs or active service workers are rejected before any Etsy navigation',async()=>{
 for(const o of [{initialUrl:'https://www.etsy.com/signin'},{worker:true}]){const f=fixture(o);await assert.rejects(f.port.createSession(f.s,f.stop.signal));await Promise.all(f.cleanup);assert.ok(!f.events.includes('goto'));assert.ok(f.events.includes('release'));}
});
test('numeric shop-ID assertions are unsupported by this visible boundary',async()=>{
 const f=fixture(),b={...f.s.accountBinding,observedShopId:'123'};delete b.bindingHash;f.s.accountBinding={...b,bindingHash:hash(b)};
 await assert.rejects(f.port.createSession(f.s,f.stop.signal),/account_mismatch/);assert.ok(!f.events.includes('create'));
});

test('separate approved verification observes real landing identity/controls without a prior account binding or query',async()=>{
 const f=verificationFixture(),r=await f.verifier.verify(f.authority,f.stop.signal);assert.equal(r.status,'verified');assert.equal(r.release.terminalReadback,true);
 assert.equal(r.verification.operationId,f.authority.scope.operationId);assert.equal(r.verification.setupOperationId,f.authority.scope.setupOperationId);assert.equal(r.verification.observedShopName,'Synthetic Shop');
 assert.equal(r.verification.canonicalUrl,ROOT);assert.equal(r.verification.insightsHeading,'Marketplace Insights');assert.equal(r.verification.observedShopId,null);assert.equal(r.verification.expiresAt,f.authority.scope.profileAccessExpiresAt);
 assert.ok(!f.events.includes('fill'));assert.ok(!f.events.includes('submit'));assert.ok(!f.events.includes('screenshot'));assert.equal(r.verification.accountBindingHash,undefined);
 const {verificationHash,...body}=r.verification;assert.equal(verificationHash,hash(body));
 const context={...body};for(const k of ['version','expiresAt','accountIdentityVerified','insightsAccessVerified','verifiedContextHash'])delete context[k];
 assert.equal(body.verifiedContextHash,hash({version:'etsy.steel-visible-account-context.1',...context}));
 assert.ok(f.events.indexOf('release-readback')<f.events.indexOf('stage:accept'));await Promise.all(f.cleanup);
});
for(const [name,o] of [['other visible shop',{shop:'Other Shop'}],['missing Marketplace Insights heading',{verificationHeading:'Dashboard'}],['missing controls',{missingSelector:S.query}],['owner popup',{overlay:true}],['revoked approval',{stageDenied:'accept'}],['failed final release',{releaseFail:true}]])test(`verification ${name} cannot enable source authority`,async()=>{
 const f=verificationFixture(o),r=await f.verifier.verify(f.authority,f.stop.signal);assert.equal(r.status,'paused');assert.equal(r.verification,null);assert.ok(!f.events.includes('submit'));await Promise.all(f.cleanup);
});
test('verification rejects changed inputs, expired purpose and project before paid create',async()=>{
 for(const key of ['scopeHash','requestId']){const f=verificationFixture(),a=structuredClone(f.authority);a[key]='bad';await assert.rejects(f.verifier.verify(a,f.stop.signal));assert.ok(!f.events.includes('create'));}
 const f=verificationFixture(),a=structuredClone(f.authority);a.scope.expectedShopId='123';a.scopeHash=hash(a.scope);await assert.rejects(f.verifier.verify(a,f.stop.signal));assert.ok(!f.events.includes('create'));
});
test('verification early Stop cannot create and duplicate approval cannot create twice',async()=>{
 const f=verificationFixture();f.stop.abort();const r=await f.verifier.verify(f.authority,f.stop.signal);assert.equal(r.verification,null);assert.ok(!f.events.includes('create'));
 const g=verificationFixture();await g.verifier.verify(g.authority,g.stop.signal);await g.verifier.verify(g.authority,g.stop.signal);assert.equal(g.events.filter(x=>x==='create').length,1);
});
test('concrete renderer policy admits only bounded visible GET navigation and renderer-only GET assets',()=>{
 const request=(url,resourceType='script',method='GET',navigation=false)=>({url,resourceType,method,navigation});
 assert.doesNotThrow(()=>admitEtsyInsightsRendererRequest(POLICY,request(ROOT,'document','GET',true),null));
 assert.doesNotThrow(()=>admitEtsyInsightsRendererRequest(POLICY,request('https://www.etsy.com/assets/app.js'),QUERY));
 assert.doesNotThrow(()=>admitEtsyInsightsRendererRequest(POLICY,request('https://www.etsy.com/api/marketplace-insights?query=pottery+gift','xhr'),QUERY));
 for(const r of [request(ROOT,'document','POST',true),request(`${ROOT}/search?query=other`,'document','GET',true),request('https://www.etsy.com/your/orders','xhr'),request('https://www.etsy.com/api/v3/customer/1','xhr'),
  request('https://www.etsy.com/insights','fetch','POST'),request('https://arbitrary.invalid/assets.js'),request('https://cdn.etsystatic.com/a.js'),request('https://www.etsy.com/a?token=secret')])assert.throws(()=>admitEtsyInsightsRendererRequest(POLICY,r,QUERY));
 const reviewed={...POLICY,staticOrigins:['https://cdn.etsystatic.com']};assert.doesNotThrow(()=>admitEtsyInsightsRendererRequest(reviewed,request('https://cdn.etsystatic.com/a.js'),QUERY));
 assert.throws(()=>admitEtsyInsightsRendererRequest(reviewed,request('https://cdn.etsystatic.com/api','xhr'),QUERY));
});
test('async marker cannot silently bypass the synchronous one-shot dispatch barrier',async()=>{
 const f=fixture();f.input.beforeCreate=async()=>{};const port=createEtsyInsightsPlaywrightPort(f.input);await assert.rejects(port.createSession(f.s,f.stop.signal));assert.ok(!f.events.includes('create'));await Promise.all(f.cleanup);
});

for(const stage of ['route-drain','page-drain','context-drain','cdp-detach','disconnect']){
 test(`source ${stage} never resolving cannot delay provider release or certify disposal`,async()=>{
  const hold=setTimeout(()=>{},4000);try{
   const f=fixture({hang:stage}),s=await open(f),closing=s.close(s.sessionId);
   await tick();assert.ok(f.events.includes('release'));const r=await closing;
   assert.equal(r.released,true);assert.equal(r.terminalReadback,true);assert.equal(r.observersDisposed,false);
   await Promise.all(f.cleanup);
  }finally{clearTimeout(hold);}
 });
 test(`verification ${stage} never resolving cannot delay provider release or produce proof`,async()=>{
  const hold=setTimeout(()=>{},4000);try{
   const f=verificationFixture({hang:stage}),work=f.verifier.verify(f.authority,f.stop.signal);
   for(let i=0;i<100&&!f.events.includes('release');i++)await tick();assert.ok(f.events.includes('release'));
   const r=await work;assert.equal(r.status,'paused');assert.equal(r.verification,null);assert.equal(r.release.observersDisposed,false);
   assert.ok(!f.events.includes('stage:accept'));await Promise.all(f.cleanup);
  }finally{clearTimeout(hold);}
 });
}
test('source redirect successors and child documents are rejected even when URL would otherwise be approved',async()=>{
 for(const change of [{redirectedRequestId:'previous'},{frameId:'child'}]){
  const f=fixture(),s=await open(f);await f.request(ROOT,change);
  assert.ok(f.cdpCommands.some(c=>c.name==='Fetch.failRequest'));assert.ok(!f.cdpCommands.some(c=>c.name==='Fetch.continueRequest'));
  await assert.rejects(s.observeAggregateView(f.stop.signal));await s.close(s.sessionId);
 }
});
test('source child targets are paused and closed without resuming code or passing any auth data',async()=>{
 const f=fixture(),s=await open(f);f.cdpHandlers.get('Target.attachedToTarget')({targetInfo:{targetId:'worker'},waitingForDebugger:true});await tick();
 assert.ok(f.cdpCommands.some(c=>c.name==='Target.setAutoAttach'&&c.args.waitForDebuggerOnStart));
 assert.ok(f.cdpCommands.some(c=>c.name==='Target.closeTarget'));assert.ok(!f.cdpCommands.some(c=>c.name==='Runtime.runIfWaitingForDebugger'));
 await assert.rejects(s.observeAggregateView(f.stop.signal));await s.close(s.sessionId);
});

function policy2(){return{...POLICY,version:'etsy.insights-renderer-policy.2',staticAssets:[{...REFS.images[0]}],optionalTelemetry:[{...REFS.optionalTelemetry[0]}],provenanceHash:PROVENANCE};}
function p2options(changes={}){const policy=policy2();return{qualification:{policy,policyHash:etsyInsightsRendererPolicyHash(policy)},...changes};}
async function optionalTelemetry(f){const r=REFS.optionalTelemetry[0];await f.request(r.origin+r.path+'?tracking=private-value',{resourceType:'Script'});}
test('source optional telemetry is blocked, sanitized and recorded without invalidating independent visible capture',async()=>{
 const recorded=[],f=fixture(p2options({rendererRecorded:recorded})),s=await open(f);await optionalTelemetry(f);
 const disposition=recorded[0];assert.equal(disposition.version,'r12.etsy-insights-renderer-request.2');assert.equal(disposition.disposition,'deny_optional_telemetry');
 assert.equal(disposition.provenanceHash,PROVENANCE);assert.equal(disposition.policyHash,etsyInsightsRendererPolicyHash(policy2()));assert.doesNotMatch(JSON.stringify(recorded),/private-value|tracking=/);
 assert.ok(f.cdpCommands.some(c=>c.name==='Fetch.failRequest'));assert.ok(!f.cdpCommands.some(c=>c.name==='Fetch.continueRequest'));
 const p=await search(f,s),capture=await s.captureSameEpoch(p.documentEpoch,f.stop.signal);assert.equal(capture.facts.find(x=>x.kind==='query').quote,f.s.query);await s.close(s.sessionId);
});
for(const o of [{headingQuery:'stale query'},{loading:true},{shop:'Other Shop'}])test('optional telemetry never suppresses actual visible account/query/completeness failure '+Object.keys(o)[0],async()=>{
 const f=fixture(p2options(o)),s=await open(f);await optionalTelemetry(f);
 await assert.rejects(async()=>{const p=await search(f,s);await s.captureSameEpoch(p.documentEpoch,f.stop.signal);});await s.close(s.sessionId);
});
test('optional telemetry does not exempt material XHR failure or redirect denial',async()=>{
 for(const change of [{resourceType:'XHR'},{resourceType:'Script',redirectedRequestId:'old'}]){
  const f=fixture(p2options()),s=await open(f),r=REFS.optionalTelemetry[0];await f.request(r.origin+r.path,change);
  await assert.rejects(s.observeAggregateView(f.stop.signal));assert.ok(!f.cdpCommands.some(c=>c.name==='Fetch.continueRequest'));await s.close(s.sessionId);
 }
});
