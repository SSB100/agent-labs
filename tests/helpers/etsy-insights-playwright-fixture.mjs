import {inertSteelCreateConfigurationGuard} from './etsy-steel-create-config-fixture.mjs';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const loadBrowser=name=>import(pathToFileURL(resolve(process.env.R12_INSIGHTS_CORE_DIR||'.core-tests','browser',name)).href);
const { ETSY_INSIGHTS_DEFAULT_RENDERER_POLICY:POLICY, etsyInsightsRendererPolicyHash } = await loadBrowser('etsy-insights-renderer-policy.js');
const { createEtsyInsightsPlaywrightPort, createEtsyInsightsVerificationPort, ETSY_INSIGHTS_VISIBLE_SELECTORS:S } = await loadBrowser('etsy-insights-playwright.js');
const { ETSY_INSIGHTS_SCOPE_VERSION } = await loadBrowser('etsy-insights-contracts.js');
const { ETSY_INSIGHTS_CAPTURE_POLICY_HASH, ETSY_INSIGHTS_SOURCE_POLICY_HASH, insightsHash:hash } = await loadBrowser('etsy-insights-policy.js');
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
 const drained=new Set();const drain=async name=>{if(o.strictDisposalOrdering)await tick();if(o.drainGate?.name===name)await o.drainGate.promise;drained.add(name);};
 let connected=true,cdpConnected=true, released=false, marked=false, time=NOW, url=o.initialUrl??'about:blank', queryInput='', view='landing', mutated=false;
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
   async click(){events.push('submit');await o.beforeSubmit?.(`${ROOT}/search?query=${encodeURIComponent(queryInput)}`);view='results';url=`${ROOT}/search?query=${encodeURIComponent(queryInput)}`;handlers.get('framenavigated')?.(frame);},
   async waitFor(){events.push('wait');},
  };
 }
 const frame={url:()=>url};
 const page={url:()=>url,mainFrame:()=>frame,viewportSize:()=>({width:1280,height:900}),locator:node,getByRole:role=>node(`role:${role}`),
  async setViewportSize(){events.push('viewport');},
  on(name,fn){handlers.set(name,fn);},
  async goto(value){events.push('goto');await o.beforeNavigate?.(value);url=o.redirect??value;handlers.get('framenavigated')?.(frame);},
  async waitForFunction(){events.push('readiness');if(o.notReady)throw Error('timed out');},
  async screenshot(args){events.push('screenshot');assert.ok(args.clip.x>=300);assert.equal(args.fullPage,undefined);if(o.duringCapture)mutated=true;return PNG;},
  async close(){events.push('page-close');},async removeAllListeners(){events.push('page-drain');if(o.hang==='page-drain')return hang();await drain('page');},
 };
 const context={pages:()=>[page],serviceWorkers:()=>o.worker?[{}]:[],
  async newCDPSession(){return{on(name,fn){cdpHandlers.set(name,fn);},async send(name,args){if(!cdpConnected||o.releaseClosesTarget&&released)throw Error('Session closed');events.push(name);cdpCommands.push({name,args});if(o.cdpFailCommand===name)throw Error('inert CDP failure');if(name==='Page.getFrameTree')return {frameTree:{frame:{id:'main'}}};},async detach(){events.push('cdp-detach');if(o.releaseClosesTarget&&released)throw Error('Terminal provider release already closed the target');if(o.hang==='cdp-detach')return hang();if(o.strictDisposalOrdering)assert.deepEqual([...drained].sort(),['context','page','route']);await drain('cdp');}};},
  on(name,fn){handlers.set(name,fn);},async route(pattern,fn){events.push('route');routes.push(fn);},
  async routeWebSocket(pattern,fn){events.push('websocket-guard');handlers.set('websocket',fn);},
  async unrouteAll(){events.push('route-drain');if(o.drainFail)throw Error('drain');if(o.hang==='route-drain')return hang();await drain('route');},async removeAllListeners(){events.push('context-drain');if(o.hang==='context-drain')return hang();await drain('context');},
 };
 const browser={contexts:()=>[context],isConnected:()=>connected,async close(){events.push('disconnect');if(o.disconnectFail)throw Error('disconnect');if(o.hang==='disconnect')return hang();if(o.strictDisposalOrdering)assert.deepEqual([...drained].sort(),['context','page','route'],'Disconnect cannot destroy pending observer acknowledgements');connected=false;cdpConnected=false;}};
 const input={providerProjectId:s.providerProjectId,createConfigurationGuard:Object.hasOwn(o,'createConfigurationGuard')?o.createConfigurationGuard:inertSteelCreateConfigurationGuard(),config:{apiKey:'inert-only-etsy-port-key',baseUrl:'https://api.steel.dev'},
  now:()=>time,registerCleanup:p=>cleanup.push(p),admitDispatch:async()=>{events.push('transport');if(o.transportDenied)throw Error('denied');},
  async resolveAttempt(arg){assert.ok(Object.isFrozen(arg.accountBinding));return {sourceAttemptId:s.sourceAttemptId,requestHash:hash(s),sessionId:id(90),profileId:id(91),providerProjectId:s.providerProjectId,
   accountBindingHash:s.accountBinding.bindingHash,profileBindingId:s.accountBinding.profileBindingId,profileBindingRevision:s.accountBinding.profileBindingRevision,...o.resolved};},
  async qualifyRenderer(){events.push('qualify-renderer');if(o.qualificationDenied)throw Error('unqualified');return{version:'r12.etsy-insights-renderer-qualification.1',requestHash:hash(s),qualificationHash:H(99),expiresAt:s.expiresAt,maximumRequests:POLICY.maximumRequests,policy:POLICY,policyHash:etsyInsightsRendererPolicyHash(POLICY),...o.qualification};},
  beforeCreate(){events.push('marker');if(marked)throw Error('already_admitted_recovery_required');marked=true;},
  async admitRenderer(request){events.push('renderer-admit');if(o.rendererRecorded)o.rendererRecorded.push(structuredClone(request));assert.ok(Object.isFrozen(request));assert.equal(request.sourceAttemptId,s.sourceAttemptId);assert.equal(request.requestHash,hash(s));assert.equal(request.headers,undefined);if(o.rendererDenied)throw Error('deny');},
  async connect(){events.push('connect');return o.connect?o.connect(browser):browser;},
  async fetcher(address,init){
   const path=new URL(address).pathname;
   if(path.endsWith('/release')){events.push('release');if(o.strictDisposalOrdering)assert.deepEqual([...drained].sort(),['context','page','route'],'Provider release cannot destroy pending observer acknowledgements');released=true;return Response.json({success:!o.releaseFail});}
   if(init.method==='POST'){events.push('create');const body=JSON.parse(init.body);assert.equal(body.profileId,id(91));assert.equal(body.persistProfile,false);assert.equal(body.projectId,s.providerProjectId);if(o.createFail)return new Response('private provider body',{status:500});}
   else events.push('release-readback');
   return Response.json({id:id(90),projectId:s.providerProjectId,profileId:id(91),status:released?'released':'live',debugUrl:`https://api.steel.dev/v1/sessions/${id(90)}/player`,solveCaptcha:false,useProxy:false,proxyBytesUsed:0,proxySource:null,timeout:s.limits.maximumSessionMs,duration:1000,...o.providerMetadata});
  },
 };
 const port=createEtsyInsightsPlaywrightPort(input),stop=new AbortController();
 return{s,port,input,stop,events,cleanup,routes,handlers,cdpHandlers,cdpCommands,request:async(url,changes={})=>cdpHandlers.get('Fetch.requestPaused')({requestId:'r'+cdpCommands.length,frameId:'main',resourceType:'Document',request:{url,method:'GET'},...changes}),browser,page,ownedCdpConnected:()=>cdpConnected,setTime:t=>{time=t;},getView:()=>view};
}
async function open(f){const session=await f.port.createSession(f.s,f.stop.signal);await session.openApprovedInsights(f.stop.signal);return session;}
async function search(f,session){const p=await session.observeAggregateView(f.stop.signal);await session.submitObservedQuery(p.queryControl.id,p.documentEpoch,f.s.query,f.stop.signal);return session.observeAggregateView(f.stop.signal);}

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
 return{...f,authority,verificationInput:input,verifier:createEtsyInsightsVerificationPort(input)};
}

export {fixture,verificationFixture,scope,open,search,NOW,id,H,ROOT,QUERY,PNG,deferred,tick};
