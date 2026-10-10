import assert from 'node:assert/strict';
import { ETSY_INSIGHTS_SCOPE_VERSION } from '../../.core-tests/browser/etsy-insights-contracts.js';
import { ETSY_INSIGHTS_CAPTURE_POLICY_HASH, ETSY_INSIGHTS_SOURCE_POLICY_HASH, insightsHash as hash } from '../../.core-tests/browser/etsy-insights-policy.js';
// Semantically reconstructed after workspace loss; fake providers only.
const NOW = Date.parse('2026-10-10T11:40:00.000Z');
const id = n => `30000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const H = n => n.toString(16).padStart(64,'0');
const ROOT = 'https://www.etsy.com/your/shops/me/marketplace-insights';
const QUERY = 'pottery gift';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9X8AAAAASUVORK5CYII=', 'base64');
function scope(changes={}) {
  const b={version:'r12.etsy-insights-account-binding.1',businessId:id(2),goalId:id(3),authorityRootId:id(4),purpose:'etsy_insights_read_only',
    providerProjectId:id(24),testEnvelopeId:id(25),testEnvelopeHash:H(25),profileBindingId:id(20),profileBindingRevision:id(21),approvalId:id(22),approvalRevision:id(23),disclosureHash:H(20),handoffReceiptHash:H(21),
    profileCandidateHash:H(22),accountVerificationHash:H(23),verifiedContextHash:H(24),observedShopName:'Synthetic Shop',observedShopId:null,
    verifiedAt:new Date(NOW-1000).toISOString(),expiresAt:new Date(NOW+120000).toISOString()};
  const s={version:ETSY_INSIGHTS_SCOPE_VERSION,operationId:id(1),sourceAttemptId:id(6),businessId:id(2),goalId:id(3),authorityRootId:id(4),scopeId:id(5),
    scopeHash:H(1),originDirectRunId:id(7),providerProjectId:id(24),window:{version:'r12.research-attempt-window.1',windowId:id(8),windowOrdinal:1,maximumAttemptsInWindow:16,baseAttemptsStarted:0,continuationHash:H(9)},
    attemptOrdinal:1,windowAttemptOrdinal:1,criteriaHash:H(2),questionHash:H(3),quoteHash:H(4),sourcePolicyHash:ETSY_INSIGHTS_SOURCE_POLICY_HASH,
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


export { scope, fixture, identity, page, frame, NOW, id, H };
