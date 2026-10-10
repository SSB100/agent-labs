import test from 'node:test';
import assert from 'node:assert/strict';
import { ETSY_INSIGHTS_SCOPE_VERSION } from '../.core-tests/browser/etsy-insights-contracts.js';
import { ETSY_INSIGHTS_CAPTURE_POLICY_HASH, ETSY_INSIGHTS_SOURCE_POLICY_HASH, insightsHash as hash, validateEtsyInsightsScope,
 etsyInsightsUrl, buildEtsyInsightsCapture, etsyInsightsWitnesses, validateEtsyInsightsReceipt } from '../.core-tests/browser/etsy-insights-policy.js';
import { runEtsyInsightsResearch } from '../.core-tests/browser/etsy-insights-runtime.js';
// Semantically reconstructed after workspace loss; fake providers only.
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
  const s={version:ETSY_INSIGHTS_SCOPE_VERSION,operationId:id(1),sourceAttemptId:id(6),businessId:id(2),goalId:id(3),authorityRootId:id(4),scopeId:id(5),
    scopeHash:H(1),originDirectRunId:id(7),providerProjectId:id(24),window:{version:'r12.research-attempt-window.1',windowId:id(8),windowOrdinal:1,maximumAttemptsInWindow:16,baseAttemptsStarted:0,continuationHash:H(9)},
    attemptOrdinal:1,windowAttemptOrdinal:1,criteriaHash:H(2),questionHash:H(3),quoteHash:H(4),executionQuoteHash:H(40),executionQuoteProofHash:H(41),sourcePolicyHash:ETSY_INSIGHTS_SOURCE_POLICY_HASH,
    accountBinding:{...b,bindingHash:hash(b)},capturePolicyHash:ETSY_INSIGHTS_CAPTURE_POLICY_HASH,query:QUERY,expiresAt:new Date(NOW+60000).toISOString(),
    maximumBrowserMicrounits:'20000',limits:{maximumSessionMs:30000,maximumActions:3,maximumTextBytes:3000,maximumScreenshotBytes:1000,maximumTotalCaptureBytes:4000}};
  return {...s,...changes,window:{...s.window,...changes.window},limits:{...s.limits,...changes.limits}};
}

function identity(s){return{sessionId:id(90),contextId:id(91),pageId:id(92),providerProjectId:s.providerProjectId,profileBindingId:s.accountBinding.profileBindingId,profileBindingRevision:s.accountBinding.profileBindingRevision,accountBindingHash:s.accountBinding.bindingHash};}
function page(s,view='results',changes={}){return{...identity(s),documentEpoch:view==='landing'?1:2,url:view==='landing'?ROOT:`${ROOT}/search?search_trigger=landing_search_bar&query=${encodeURIComponent(s.query)}`,
 view,block:'none',unexpectedNavigation:false,unapprovedRequest:false,popupOpened:false,visibleShopName:s.accountBinding.observedShopName,visibleShopId:null,query:view==='results'?s.query:null,
 queryControl:{id:'insights-query',kind:'insights_query',sensitive:false},...changes};}
function frame(s,p=page(s),changes={}){
 const lines=[['shop_name',s.accountBinding.observedShopName],['query',s.query],['reporting_window','Last 30 days'],['searches','Searches: 2.4k'],['results','Results: 20k'],['conversion_statement','Conversion: Very low.'],['price','NZ$12.50–18.75'],['currency','NZD'],['aggregate_region','Region: Worldwide']];
 const text='🌿 '+lines.map(([,v])=>v).join('\n');
 const facts=lines.map(([kind,quote])=>{const start=Array.from(text.slice(0,text.indexOf(quote))).length;return{kind,start,end:start+Array.from(quote).length,quote};});
 return{...identity(s),beforeEpoch:p.documentEpoch,afterEpoch:p.documentEpoch,url:p.url,capturedAt:new Date(NOW).toISOString(),text,screenshot:Uint8Array.from(PNG),mimeType:'image/png',viewport:{width:1,height:1},extraction:'visible_aggregate_viewport',facts,...changes};
}
function fixture(changes={}){
 const s=scope(changes),events=[],requests=[],receipts=[],uploads=[],cleanups=[],stop=new AbortController();let time=NOW,view='landing',admitted=false;
 const session={...identity(s),persistProfile:false,
  async openApprovedInsights(){events.push('open');},async observeAggregateView(){events.push('observe');return page(s,view);},
  async submitObservedQuery(control,epoch,query){assert.equal(control,'insights-query');assert.equal(epoch,1);assert.equal(query,s.query);events.push('query');view='results';},
  async captureSameEpoch(epoch){assert.equal(epoch,2);events.push('capture');return frame(s);},
  async close(expected){events.push('close');assert.equal(expected,id(90));return{sessionId:expected,released:true,terminalReadback:true,observersDisposed:true};},
 };
 const d={signal:stop.signal,now:()=>time,monotonic:()=>time-NOW,registerCleanup(p){events.push('registered');cleanups.push(p);},
  async admit(r){events.push(`admit:${r.operation}`);assert.ok(Object.isFrozen(r));requests.push(structuredClone(r));if(r.operation==='create'){if(admitted)throw Error('duplicate');admitted=true;}
   return{version:'r12.etsy-insights-source-permit.1',admissionHash:hash(r),reservationId:id(80),reservationHash:H(80),reservedBrowserMicrounits:s.maximumBrowserMicrounits,expiresAt:new Date(time+5000).toISOString()};},
  async createSession(input){events.push('create');assert.ok(Object.isFrozen(input.accountBinding));assert.deepEqual(input,s);return session;},
  async storeScreenshot(c,bytes){events.push('store');assert.ok(Object.isFrozen(c.facts));uploads.push({capture:structuredClone(c),bytes:Uint8Array.from(bytes)});const b={version:'r12.etsy-insights-screenshot-storage.1',captureHash:c.captureHash,screenshotHash:c.screenshotHash,byteLength:bytes.byteLength,storageObjectId:id(81)};return{...b,storageReceiptHash:hash(b)};},
  async recordRelease(e){events.push('release_receipt');assert.equal(e.sourceAttemptId,s.sourceAttemptId);},
  async recordReceipt(r){events.push('receipt');receipts.push(structuredClone(r));return{receiptHash:r.receiptHash,persisted:true};},
 };
 return{s,events,requests,receipts,uploads,cleanups,stop,session,d,setTime:t=>{time=t;}};
}
const rehash=r=>{const {receiptHash,...body}=r;void receiptHash;return{...body,receiptHash:hash(body)};};
async function run(f){return runEtsyInsightsResearch(f.s,f.d);}

test('finite window configuration preserves global ordinal without a hard ten cap',()=>{
 assert.equal(validateEtsyInsightsScope(scope({attemptOrdinal:11,windowAttemptOrdinal:11}),NOW).attemptOrdinal,11);
 assert.equal(validateEtsyInsightsScope(scope({window:{windowOrdinal:2,baseAttemptsStarted:16,maximumAttemptsInWindow:8},attemptOrdinal:17,windowAttemptOrdinal:1}),NOW).attemptOrdinal,17);
 for(const c of [{attemptOrdinal:2},{windowAttemptOrdinal:17,attemptOrdinal:17},{window:{maximumAttemptsInWindow:33}},{window:{baseAttemptsStarted:3}}])assert.throws(()=>validateEtsyInsightsScope(scope(c),NOW));
});
test('exact scopes reject altered policies, revisions, purpose, account and arbitrary query URLs',()=>{
 const s=scope();assert.deepEqual(validateEtsyInsightsScope(s,NOW),s);
 for(const c of [{capturePolicyHash:H(99)},{sourcePolicyHash:H(99)},{query:'https://example.test'},{accountBinding:{...s.accountBinding,profileBindingRevision:id(99)}},
  {accountBinding:{...s.accountBinding,purpose:'listing_write'}},{providerProjectId:id(99)},{expiresAt:new Date(NOW+150000).toISOString()},{maximumBrowserMicrounits:'0'},{extra:true}])assert.throws(()=>validateEtsyInsightsScope({...s,...c},NOW));
});
test('only exact approved visible Insights URLs, no arbitrary private paths or hidden APIs',()=>{
 assert.equal(etsyInsightsUrl(ROOT,QUERY).kind,'landing');assert.equal(etsyInsightsUrl(page(scope()).url,QUERY).canonicalUrl,`${ROOT}/search?query=pottery+gift`);
 for(const url of [`${ROOT}?query=x`,`${ROOT}/search?query=wrong`,`${ROOT}/search?query=pottery+gift&query=pottery+gift`,`${ROOT}/search?query=pottery+gift&search_trigger=hidden`,'https://www.etsy.com/your/orders','https://www.etsy.com/api/insights',`${ROOT}#secret`,`https://evil.test${new URL(ROOT).pathname}`])assert.throws(()=>etsyInsightsUrl(url,QUERY));
});
test('one exact admitted capture, immutable storage acknowledgment, original project/envelope/window pins',async()=>{
 const f=fixture(),r=await run(f);assert.equal(r.persistence,'verified');assert.equal(r.receipt.status,'completed');assert.equal(r.receipt.actionsUsed,3);assert.equal(r.receipt.captures.length,1);
 assert.equal(r.receipt.releaseState,'verified');assert.equal(r.receipt.liabilityState,'receipt_required');assert.equal(r.receipt.sourceAttemptId,f.s.sourceAttemptId);
 assert.equal(f.events.filter(v=>v==='query').length,1);assert.equal(f.events.filter(v=>v==='capture').length,1);assert.ok(f.events.indexOf('admit:create')<f.events.indexOf('create'));
 assert.deepEqual(f.requests.map(v=>v.operation),['create','open_insights','observe','submit_query','observe','capture','observe','accept_capture','observe']);
 for(const q of f.requests){assert.equal(q.providerProjectId,f.s.providerProjectId);assert.equal(q.requestHash,hash(f.s));assert.equal(q.attemptOrdinal,1);assert.equal(q.accountVerificationHash,f.s.accountBinding.accountVerificationHash);}
 assert.equal(r.receipt.captures[0].facts.find(v=>v.kind==='searches').quote,'Searches: 2.4k');assert.equal(r.receipt.captures[0].competitorSales,'unknown');
 assert.deepEqual(validateEtsyInsightsReceipt(r.receipt,f.s),r.receipt);await Promise.all(f.cleanups);
});
test('fresh timestamp and new context IDs do not manufacture novel facts or clusters',()=>{
 const s=scope(),a=buildEtsyInsightsCapture(frame(s),page(s),s,NOW);
 const q=page(s,'results',{sessionId:id(94),contextId:id(95),pageId:id(96)}),b=buildEtsyInsightsCapture(frame(s,q,{sessionId:id(94),contextId:id(95),pageId:id(96),capturedAt:new Date(NOW+1).toISOString()}),q,s,NOW+1);
 assert.notEqual(a.captureHash,b.captureHash);assert.deepEqual(etsyInsightsWitnesses([a]).map(x=>[x.factIdentityHash,x.observationClusterHash]),etsyInsightsWitnesses([b]).map(x=>[x.factIdentityHash,x.observationClusterHash]));
});
test('literal span proofs use Unicode code points, reject invented quote or missing context',()=>{
 const s=scope(),f=frame(s);assert.equal(buildEtsyInsightsCapture(f,page(s),s,NOW).facts[0].start,2);
 for(const change of [x=>{x.facts[0].start++;},x=>{x.facts[0].quote='invented';},x=>{x.facts=x.facts.filter(v=>v.kind!=='reporting_window');},x=>{x.facts.push(x.facts[0]);}]){const bad=structuredClone(f);change(bad);assert.throws(()=>buildEtsyInsightsCapture(bad,page(s),s,NOW));}
});
for(const block of ['login','captcha','bot_challenge','quota','account_mismatch','private_data','unknown'])test(`honest ${block} pause persists without query or fallback`,async()=>{
 const f=fixture();f.session.observeAggregateView=async()=>page(f.s,'landing',{block});const r=await run(f);assert.equal(r.receipt.reason,`blocked_${block}`);assert.equal(r.persistence,'verified');assert.ok(!f.events.includes('query'));assert.equal(r.receipt.captures.length,0);
});
for(const [name,change] of [['wrong profile',s=>s.profileBindingId=id(99)],['writer profile',s=>s.persistProfile=true],['wrong project',s=>s.providerProjectId=id(99)]])test(`${name} cannot navigate after create`,async()=>{
 const f=fixture();change(f.session);const r=await run(f);assert.equal(r.receipt.status,'paused');assert.ok(!f.events.includes('open'));assert.ok(f.events.includes('close'));
});
test('wrong visible shop or query blocks capture',async()=>{
 for(const c of [{visibleShopName:'Other Shop'},{query:'other'},{unexpectedNavigation:true},{unapprovedRequest:true},{popupOpened:true}]){const f=fixture();f.session.observeAggregateView=async()=>page(f.s,'landing',c);const r=await run(f);assert.equal(r.receipt.status,'paused');assert.ok(!f.events.includes('capture'));}
});
test('Stop before any admission persists a no-dispatch pause',async()=>{
 const f=fixture();f.stop.abort();const r=await run(f);assert.equal(r.receipt.reason,'stopped');assert.equal(r.receipt.liabilityState,'not_dispatched');assert.ok(!f.events.includes('create'));assert.equal(r.persistence,'verified');
});
test('Stop during admission cannot dispatch a paid create',async()=>{
 const f=fixture(),admit=f.d.admit;f.d.admit=async q=>{const p=await admit(q);f.stop.abort();return p;};const r=await run(f);assert.equal(r.receipt.reason,'stopped');assert.ok(!f.events.includes('create'));
});
test('late create after Stop is closed without a second creation',async()=>{
 const f=fixture(),d=deferred();f.d.createSession=async()=>{f.events.push('create');return d.promise;};const work=run(f);for(let i=0;i<30&&!f.events.includes('create');i++)await tick();f.stop.abort();d.resolve(f.session);const r=await work;
 assert.equal(r.receipt.status,'paused');assert.equal(f.events.filter(v=>v==='create').length,1);assert.ok(f.events.includes('close'));await Promise.all(f.cleanups);
});
test('duplicate admission is not permission to reuse a paid create',async()=>{
 const f=fixture();await run(f);const r=await run(f);assert.equal(r.receipt.reason,'admission_denied');assert.equal(f.events.filter(v=>v==='create').length,1);
});
test('invalid or expired permits cannot dispatch',async()=>{
 for(const c of [{admissionHash:H(99)},{reservedBrowserMicrounits:'1'},{expiresAt:new Date(NOW).toISOString()}]){const f=fixture(),admit=f.d.admit;f.d.admit=async q=>({...await admit(q),...c});const r=await run(f);assert.equal(r.receipt.reason,'admission_proof_invalid');assert.ok(!f.events.includes('create'));}
});
test('reservation substitution after create pauses and retains original reservation',async()=>{
 const f=fixture(),admit=f.d.admit;f.d.admit=async q=>({...await admit(q),...(q.sequence?{reservationId:id(99)}:{})});const r=await run(f);assert.equal(r.receipt.reason,'admission_proof_invalid');assert.equal(r.receipt.reservationId,id(80));assert.ok(!f.events.includes('query'));
});
test('epoch drift before, during, or after capture refuses acceptance',async()=>{
 for(const n of [1,2,3]){const f=fixture();let seen=0;f.session.observeAggregateView=async()=>{seen++;const v=page(f.s,seen===1?'landing':'results');return seen>=n+1?{...v,documentEpoch:9}:v;};const r=await run(f);assert.equal(r.receipt.status,'paused');assert.equal(r.receipt.captures.length,0);}
});
test('PNG signature and dimensions, text bytes and combined capture bounds fail closed',async()=>{
 for(const make of [f=>frame(f.s,undefined,{screenshot:new Uint8Array(30)}),f=>frame(f.s,undefined,{viewport:{width:2,height:1}}),f=>frame(f.s,undefined,{text:'x'.repeat(32001)}),f=>frame(f.s,undefined,{mimeType:'image/jpeg'})]){const f=fixture();f.session.captureSameEpoch=async()=>make(f);assert.equal((await run(f)).receipt.status,'paused');}
 const f=fixture({limits:{maximumTotalCaptureBytes:100}});assert.equal((await run(f)).receipt.status,'paused');
});
test('storage acknowledgement is exact, private, immutable and required before acceptance',async()=>{
 const f=fixture(),store=f.d.storeScreenshot;f.d.storeScreenshot=async(c,b,s)=>({...await store(c,b,s),storageObjectId:id(99)});const r=await run(f);assert.equal(r.receipt.reason,'screenshot_storage_unconfirmed');assert.equal(r.receipt.captures.length,0);
});
test('reused provider capture buffers cannot mutate saved evidence',async()=>{
 const f=fixture(),raw=frame(f.s);f.session.captureSameEpoch=async()=>raw;const observe=f.session.observeAggregateView;f.session.observeAggregateView=async()=>{if(f.events.includes('capture-returned'))raw.screenshot.fill(0);return observe();};
 f.session.captureSameEpoch=async()=>{f.events.push('capture-returned');return raw;};const r=await run(f);assert.equal(r.receipt.status,'completed');assert.equal(f.uploads[0].bytes[0],137);
});
test('session identity mutation closes the original session only',async()=>{
 const f=fixture(),open=f.session.openApprovedInsights;f.session.openApprovedInsights=async()=>{await open();f.session.sessionId=id(99);};const r=await run(f);assert.equal(r.receipt.reason,'source_invalidated');assert.equal(r.receipt.sessionId,id(90));assert.ok(f.events.includes('close'));
});
for(const missing of ['released','terminalReadback','observersDisposed'])test(`missing ${missing} retains unknown liability and removes captures`,async()=>{
 const f=fixture(),close=f.session.close;f.session.close=async id=>({...await close(id),[missing]:false});const r=await run(f);assert.equal(r.receipt.releaseState,'unconfirmed');assert.equal(r.receipt.liabilityState,'unknown');assert.equal(r.receipt.captures.length,0);
});
test('release receipt failure also retains unknown liability',async()=>{
 const f=fixture();f.d.recordRelease=async()=>{throw Error('private ledger detail');};const r=await run(f);assert.equal(r.receipt.reason,'release_unconfirmed');assert.equal(r.receipt.liabilityState,'unknown');
});
test('missing receipt ACK cannot become durable source authority',async()=>{
 const f=fixture();f.d.recordReceipt=async()=>({receiptHash:H(99),persisted:true});const r=await run(f);assert.equal(r.persistence,'unconfirmed');assert.equal(r.receipt.status,'completed');
});
test('same-context source pins and immutable receipts cannot be forged by rehashing another scope',async()=>{
 const f=fixture(),r=(await run(f)).receipt;for(const c of [{scopeId:id(99)},{attemptOrdinal:2},{providerProjectId:id(99)},{accountVerificationHash:H(99)},{liabilityState:'not_dispatched',releaseState:'not_required',sessionId:null,actionsUsed:0}])assert.throws(()=>validateEtsyInsightsReceipt(rehash({...r,...c}),f.s));
 const c=r.captures[0];assert.ok(c.visibleAccountContextHash);assert.equal(c.observedShopName,f.s.accountBinding.observedShopName);
});
test('post-storage identity or epoch changes invalidate acceptance',async()=>{
 const f=fixture(),store=f.d.storeScreenshot;f.d.storeScreenshot=async(...args)=>{const r=await store(...args);f.session.observeAggregateView=async()=>page(f.s,'results',{visibleShopName:'Other Shop'});return r;};const r=await run(f);assert.equal(r.receipt.status,'paused');assert.equal(r.receipt.captures.length,0);
});
test('inflight expiry stops query dispatch and preserves spent-attempt teardown',async()=>{
 const f=fixture(),open=f.session.openApprovedInsights;f.session.openApprovedInsights=async()=>{await open();f.setTime(NOW+70000);};const r=await run(f);assert.equal(r.receipt.reason,'expired');assert.ok(!f.events.includes('query'));assert.ok(f.events.includes('close'));
});
test('already expired but structurally valid authority persists no-dispatch pause',async()=>{
 const f=fixture();f.setTime(NOW+70000);const r=await run(f);assert.equal(r.receipt.reason,'expired');assert.equal(r.receipt.liabilityState,'not_dispatched');assert.equal(r.persistence,'verified');assert.ok(!f.events.includes('create'));
});
test('direct capture construction cannot ignore blocked page flags or pre-verification timestamps',()=>{
 const s=scope();assert.throws(()=>buildEtsyInsightsCapture(frame(s),page(s,'results',{block:'login'}),s,NOW));
 assert.throws(()=>buildEtsyInsightsCapture(frame(s,undefined,{capturedAt:new Date(NOW-2000).toISOString()}),page(s),s,NOW));
});
