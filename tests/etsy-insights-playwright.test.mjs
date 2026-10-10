import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ETSY_INSIGHTS_DEFAULT_RENDERER_POLICY as POLICY, etsyInsightsRendererPolicyHash, admitEtsyInsightsRendererRequest } from '../.core-tests/browser/etsy-insights-renderer-policy.js';
import { createEtsyInsightsPlaywrightPort, createEtsyInsightsVerificationPort, ETSY_INSIGHTS_VISIBLE_SELECTORS as S } from '../.core-tests/browser/etsy-insights-playwright.js';
import { ETSY_INSIGHTS_SCOPE_VERSION } from '../.core-tests/browser/etsy-insights-contracts.js';
import { ETSY_INSIGHTS_CAPTURE_POLICY_HASH, ETSY_INSIGHTS_SOURCE_POLICY_HASH, insightsHash as hash } from '../.core-tests/browser/etsy-insights-policy.js';
// Inert structural Playwright/Steel doubles, not a live paid renderer qualification.
const NOW = Date.parse('2026-10-10T11:40:00.000Z');
const id = n => `30000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const H = n => n.toString(16).padStart(64,'0');
const ROOT = 'https://www.etsy.com/your/shops/me/marketplace-insights';
const QUERY = 'pottery gift';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9X8AAAAASUVORK5CYII=', 'base64');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve=r; }); return { promise,resolve }; };
const tick = () => new Promise(r => setImmediate(r));
function scope(changes={}) {
  const b={version:'r12.etsy-insights-account-binding.1',businessId:id(2),goalId:id(3),authorityRootId:id(4),purpose:'etsy_insights_read_only',
    providerProjectId:id(24),testEnvelopeId:id(25),testEnvelopeHash:H(25),profileBindingId:id(20),profileBindingRevision:id(21),approvalId:id(22),approvalRevision:id(23),disclosureHash:H(20),handoffReceiptHash:H(21),
    profileCandidateHash:H(22),accountVerificationHash:H(23),verifiedContextHash:H(24),observedShopName:'Synthetic Shop',observedShopId:null,
    verifiedAt:new Date(NOW-1000).toISOString(),expiresAt:new Date(NOW+120000).toISOString()};
  const s={version:ETSY_INSIGHTS_SCOPE_VERSION,operationId:id(90),sourceAttemptId:id(6),businessId:id(2),goalId:id(3),authorityRootId:id(4),scopeId:id(5),
    scopeHash:H(1),originDirectRunId:id(7),providerProjectId:id(24),window:{version:'r12.research-attempt-window.1',windowId:id(8),windowOrdinal:1,maximumAttemptsInWindow:16,baseAttemptsStarted:0,continuationHash:H(9)},
    attemptOrdinal:1,windowAttemptOrdinal:1,criteriaHash:H(2),questionHash:H(3),quoteHash:H(4),executionQuoteHash:H(5),executionQuoteProofHash:H(6),sourcePolicyHash:ETSY_INSIGHTS_SOURCE_POLICY_HASH,
    accountBinding:{...b,bindingHash:hash(b)},capturePolicyHash:ETSY_INSIGHTS_CAPTURE_POLICY_HASH,query:QUERY,expiresAt:new Date(NOW+60000).toISOString(),
    maximumBrowserMicrounits:'20000',limits:{maximumSessionMs:30000,maximumActions:3,maximumTextBytes:3000,maximumScreenshotBytes:1000,maximumTotalCaptureBytes:4000}};
  return {...s,...changes,window:{...s.window,...changes.window},limits:{...s.limits,...changes.limits}};
}

function fixture(o={}) {
 const s=scope(), events=[], cleanup=[], routes=[], handlers=new Map(),cdpHandlers=new Map(),cdpCommands=[];
 const hang=()=>new Promise(()=>{});
 let connected=true, released=false, marked=false, time=NOW, url=o.initialUrl??'about:blank', queryInput='', view='landing', mutated=false;
 const rect={x:300,y:150,width:700,height:80};
 function node(key){
  return {
   key, locator(selector){if(selector==='..')return node(`${key}:parent`);return node(`${key} ${selector}`);},
   getByRole(role,args){return node(`${key} role:${role}:${args.name}`);},
   getByText(value){return node(`${key} text:${value}`);},
   filter(args){return node(`${key}${args.hasText?` filter:${args.hasText}`:''}${args.visible?' visible':''}`);},
   async count(){if(key.includes('role:dialog')||key.includes('input[type="password"]'))return o.overlay?1:0;if(key.includes('text:Loading'))return o.loading?1:0;if(key===S.shops)return o.twoShops?2:1;if(o.missingSelector&&key.includes(o.missingSelector))return 0;return 1;},
   async isVisible(){return !o.hidden;},
   async boundingBox(){return o.offscreen?{...rect,x:-1}:key.endsWith(S.summary)?{...rect,y:250}:rect;},
   async isEnabled(){return !o.disabled;},
   async getAttribute(name){if(name==='aria-label')return key.includes(S.query)?'Input to search for keywords':'search bar form';if(name==='href')return `/shop/${o.shop??'Synthetic Shop'}?ref=seller-platform-mcnav`;if(name==='type')return key.includes('role:button')?'submit':'text';return null;},
   async innerText(){
    if(key.includes('role:heading:Marketplace Insights'))return o.verificationHeading??'Marketplace Insights';
    if(key.includes(S.shopName))return o.shop??'Synthetic Shop';
    if(key.includes(S.metricValue))return key.includes('Search results')?'20k':'2.4k';
    if(key.includes(S.metricLabel))return key.includes('Search results')?'Search results':'Searches';
    if(key.includes(S.summaryQuery))return o.summaryQuery??(mutated?'changed query':s.query);
    if(key.includes(S.heading))return o.headingQuery??(mutated?'changed query':s.query);
    if(key.includes(S.window)||key.includes(S.date))return 'Last 30 days';
    if(key.includes(S.conversion))return 'Very low conversion rate';
    if(key.includes(S.trend))return '+10%';
    throw Error(`Unhandled inert node ${key}`);
   },
   async fill(value){events.push('fill');queryInput=value;if(o.fillChange)mutated=true;},
   async click(){events.push('submit');view='results';url=`${ROOT}/search?query=${encodeURIComponent(queryInput)}`;handlers.get('framenavigated')?.(frame);},
   async waitFor(){events.push('wait');},
  };
 }
 const frame={url:()=>url};
 const page={url:()=>url,mainFrame:()=>frame,viewportSize:()=>({width:1280,height:900}),locator:node,getByRole:role=>node(`role:${role}`),
  async setViewportSize(){events.push('viewport');},
  on(name,fn){handlers.set(name,fn);},
  async goto(value){events.push('goto');url=o.redirect??value;handlers.get('framenavigated')?.(frame);},
  async waitForFunction(){events.push('readiness');if(o.notReady)throw Error('timed out');},
  async screenshot(args){events.push('screenshot');assert.ok(args.clip.x>=300);assert.equal(args.fullPage,undefined);if(o.duringCapture)mutated=true;return PNG;},
  async close(){events.push('page-close');},async removeAllListeners(){events.push('page-drain');if(o.hang==='page-drain')return hang();},
 };
 const context={pages:()=>[page],serviceWorkers:()=>o.worker?[{}]:[],
  async newCDPSession(){return{on(name,fn){cdpHandlers.set(name,fn);},async send(name,args){events.push(name);cdpCommands.push({name,args});if(name==='Page.getFrameTree')return {frameTree:{frame:{id:'main'}}};},async detach(){events.push('cdp-detach');if(o.hang==='cdp-detach')return hang();}};},
  on(name,fn){handlers.set(name,fn);},async route(pattern,fn){events.push('route');routes.push(fn);},
  async routeWebSocket(pattern,fn){events.push('websocket-guard');handlers.set('websocket',fn);},
  async unrouteAll(){events.push('route-drain');if(o.drainFail)throw Error('drain');if(o.hang==='route-drain')return hang();},async removeAllListeners(){events.push('context-drain');if(o.hang==='context-drain')return hang();},
 };
 const browser={contexts:()=>[context],isConnected:()=>connected,async close(){events.push('disconnect');if(o.disconnectFail)throw Error('disconnect');if(o.hang==='disconnect')return hang();connected=false;}};
 const input={providerProjectId:s.providerProjectId,config:{apiKey:'inert-only-etsy-port-key',baseUrl:'https://api.steel.dev'},
  now:()=>time,registerCleanup:p=>cleanup.push(p),admitDispatch:async()=>{events.push('transport');if(o.transportDenied)throw Error('denied');},
  async resolveAttempt(arg){assert.ok(Object.isFrozen(arg.accountBinding));return {sourceAttemptId:s.sourceAttemptId,requestHash:hash(s),sessionId:id(90),profileId:id(91),providerProjectId:s.providerProjectId,
   accountBindingHash:s.accountBinding.bindingHash,profileBindingId:s.accountBinding.profileBindingId,profileBindingRevision:s.accountBinding.profileBindingRevision,...o.resolved};},
  async qualifyRenderer(){events.push('qualify-renderer');if(o.qualificationDenied)throw Error('unqualified');return{version:'r12.etsy-insights-renderer-qualification.1',requestHash:hash(s),qualificationHash:H(99),expiresAt:s.expiresAt,maximumRequests:POLICY.maximumRequests,policy:POLICY,policyHash:etsyInsightsRendererPolicyHash(POLICY),...o.qualification};},
  beforeCreate(){events.push('marker');if(marked)throw Error('already_admitted_recovery_required');marked=true;},
  async admitRenderer(request){events.push('renderer-admit');assert.ok(Object.isFrozen(request));assert.equal(request.sourceAttemptId,s.sourceAttemptId);assert.equal(request.requestHash,hash(s));assert.equal(request.headers,undefined);if(o.rendererDenied)throw Error('deny');},
  async connect(){events.push('connect');return o.connect?o.connect(browser):browser;},
  async fetcher(address,init){
   const path=new URL(address).pathname;
   if(path.endsWith('/release')){events.push('release');released=true;return Response.json({success:!o.releaseFail});}
   if(init.method==='POST'){events.push('create');const body=JSON.parse(init.body);assert.equal(body.profileId,id(91));assert.equal(body.persistProfile,false);assert.equal(body.projectId,s.providerProjectId);if(o.createFail)return new Response('private provider body',{status:500});}
   else events.push('release-readback');
   return Response.json({id:id(90),projectId:s.providerProjectId,profileId:id(91),status:released?'released':'live',debugUrl:`https://api.steel.dev/v1/sessions/${id(90)}/player`,solveCaptcha:false,useProxy:false,proxyBytesUsed:0});
  },
 };
 const port=createEtsyInsightsPlaywrightPort(input),stop=new AbortController();
 return{s,port,input,stop,events,cleanup,routes,handlers,cdpHandlers,cdpCommands,request:async(url,changes={})=>cdpHandlers.get('Fetch.requestPaused')({requestId:'r'+cdpCommands.length,frameId:'main',resourceType:'Document',request:{url,method:'GET'},...changes}),browser,page,setTime:t=>{time=t;},getView:()=>view};
}
async function open(f){const session=await f.port.createSession(f.s,f.stop.signal);await session.openApprovedInsights(f.stop.signal);return session;}
async function search(f,session){const p=await session.observeAggregateView(f.stop.signal);await session.submitObservedQuery(p.queryControl.id,p.documentEpoch,f.s.query,f.stop.signal);return session.observeAggregateView(f.stop.signal);}

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

function verificationFixture(o={}){
 const f=fixture(o),scope={version:'etsy.steel-account-verification-scope.1',operationId:id(90),setupOperationId:id(1),handoffId:id(100),ownerId:id(101),businessId:f.s.businessId,goalId:f.s.goalId,authorityRootId:f.s.authorityRootId,
  testEnvelopeId:f.s.accountBinding.testEnvelopeId,testEnvelopeHash:f.s.accountBinding.testEnvelopeHash,providerProjectId:f.s.providerProjectId,profileBindingId:id(20),profileBindingRevision:id(21),profileCandidateHash:H(22),profileId:id(91),
  approvalId:id(22),approvalRevision:id(23),disclosureHash:H(20),purpose:'etsy_insights_verify_only',expectedShopName:'Synthetic Shop',expectedShopId:null,quoteHash:H(50),maximumBrowserMicrounits:'20000',maximumSessionMs:30000,
  expiresAt:new Date(NOW+60000).toISOString(),profileAccessExpiresAt:new Date(NOW+86400000).toISOString()};
 const authority={scope,scopeHash:hash(scope),requestId:id(102),workflowRunId:id(103)};
 const input={...f.input,async admitStage(r){f.events.push(`stage:${r.operation}`);assert.ok(Object.isFrozen(r));assert.equal(r.operationId,scope.operationId);assert.equal(r.scopeHash,hash(scope));
  if(o.stageDenied===r.operation)throw Error('denied');},beforeCreate(a){assert.equal(a.scope.profileId,id(91));assert.equal(a.scope.operationId,id(90));assert.ok(Object.isFrozen(a.scope));f.input.beforeCreate();},
  async qualifyRenderer(s){assert.equal(s.purpose,'etsy_insights_verify_only');return{version:'r12.etsy-insights-renderer-qualification.1',requestHash:authority.scopeHash,qualificationHash:H(99),expiresAt:scope.expiresAt,
   maximumRequests:POLICY.maximumRequests,policy:POLICY,policyHash:etsyInsightsRendererPolicyHash(POLICY)};},
  async admitRenderer(r){assert.equal(r.version,'etsy.insights-verification-renderer-request.1');assert.equal(r.requestId,authority.requestId);},
 };
 return{...f,authority,verifier:createEtsyInsightsVerificationPort(input)};
}
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
