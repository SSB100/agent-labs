import { createHash } from 'node:crypto';
import { containsCredentialLikeValue } from '../core/quest-intake';
import { discoveryV2Hash } from '../products/discovery-v2-hash';
import { validatePublicResearchWindow } from '../products/discovery-r12-public-window';
import { validatePublicResearchSourceAccess } from '../products/discovery-r12-public-source';
import { ETSY_INSIGHTS_SCOPE_VERSION, ETSY_INSIGHTS_RECEIPT_VERSION,
  type EtsyInsightsScope, type EtsyInsightsIdentity, type EtsyInsightsObservedPage, type EtsyInsightsCaptureFrame,
  type EtsyInsightsCapture, type EtsyInsightsFact, type EtsyInsightsWitness, type EtsyInsightsScreenshotStorage, type EtsyInsightsReceipt } from './etsy-insights-contracts';

export class EtsyInsightsFailure extends Error { constructor(readonly reason: string) { super(reason); } }
export const insightsFail = (reason:string):never => { throw new EtsyInsightsFailure(reason); };
export const insightsHash = discoveryV2Hash;
export const insightsBytesHash = (bytes:Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export const insightsUuid = (v:unknown):v is string => typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][0-9a-f]{3}-[a-f0-9]{12}$/i.test(v);
export const insightsIsHash = (v:unknown):v is string => typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export const insightsInteger = (v:unknown,low:number,high=Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v)&&Number(v)>=low&&Number(v)<=high;
export const insightsExact = (v:unknown,keys:string):v is Record<string,unknown> => !!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===keys.split(',').sort().join(',');
const text=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v);
const instant=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const normalize=(v:string)=>v.normalize('NFC').replace(/[\t\n\v\f\r ]+/g,' ').replace(/^ +| +$/g,'').replace(/[A-Z]/g,c=>c.toLowerCase());
const FACT_KINDS=Object.freeze(['query','shop_name','shop_id','reporting_window','searches','results','conversion_statement','price','currency','aggregate_region','timezone','trend_statement','limitation']);
export const ETSY_INSIGHTS_CAPTURE_POLICY=Object.freeze({
  version:'r12.etsy-insights-visible-capture-policy.1',extraction:'visible_aggregate_viewport',
  oneQueryOneViewPerAttempt:true,spanOffsets:'unicode_codepoints',factKinds:FACT_KINDS,
  valueHandling:'literal_display_only',roundedValues:'preserve_displayed_precision',
  reportingWindow:'literal_source_window',conversion:'statement_only_no_inferred_ordinal_scale',
  geography:'aggregate_literal_only_no_buyer_location_inference',timezone:'unknown_unless_literal',
  relatedRows:'one_observation_cluster',novelRecordIsNotNovelFact:true,
  maximumFacts:24,maximumTextBytes:32000,maximumScreenshotBytes:2000000,maximumTotalCaptureBytes:2032000,
});
export const ETSY_INSIGHTS_CAPTURE_POLICY_HASH=insightsHash(ETSY_INSIGHTS_CAPTURE_POLICY);
const LANDING='/your/shops/me/marketplace-insights';
export const ETSY_INSIGHTS_SOURCE_POLICY=Object.freeze({
  version:'r12.etsy-insights-visible-source-policy.1',provider:'steel',purpose:'etsy_insights_read_only',
  origin:'https://www.etsy.com',landingPath:LANDING,searchPath:`${LANDING}/search`,
  queryParameter:'query',optionalSearchTrigger:'landing_search_bar',capturePolicyHash:ETSY_INSIGHTS_CAPTURE_POLICY_HASH,
  persistProfile:false,credentialEntry:false,hiddenEndpointCollection:false,replayCollection:false,
  maximumSessionMs:120000,maximumActions:8,reviewedWindowConfigurationMaximum:32,
});
export const ETSY_INSIGHTS_SOURCE_POLICY_HASH=insightsHash(ETSY_INSIGHTS_SOURCE_POLICY);
export function validateEtsyInsightsScope(raw:unknown,now=Date.now(),allowExpiredForPause=false):EtsyInsightsScope {
  if(!insightsExact(raw,'version,operationId,sourceAttemptId,businessId,goalId,authorityRootId,scopeId,scopeHash,originDirectRunId,providerProjectId,window,attemptOrdinal,windowAttemptOrdinal,criteriaHash,questionHash,quoteHash,executionQuoteHash,executionQuoteProofHash,sourcePolicyHash,accountBinding,capturePolicyHash,query,expiresAt,maximumBrowserMicrounits,limits'))return insightsFail('scope_invalid');
  const s=raw as EtsyInsightsScope;
  if(s.version!==ETSY_INSIGHTS_SCOPE_VERSION||![s.operationId,s.sourceAttemptId,s.businessId,s.goalId,s.authorityRootId,s.scopeId,s.originDirectRunId,s.providerProjectId].every(insightsUuid)||
    ![s.scopeHash,s.criteriaHash,s.questionHash,s.quoteHash,s.executionQuoteHash,s.executionQuoteProofHash].every(insightsIsHash)||s.sourcePolicyHash!==ETSY_INSIGHTS_SOURCE_POLICY_HASH||s.capturePolicyHash!==ETSY_INSIGHTS_CAPTURE_POLICY_HASH||
    !text(s.query,160)||s.query.trim()!==s.query||s.query.length<2||containsCredentialLikeValue(s.query)||/https?:\/\/|@|\b(?:password|cookie|token)\b/i.test(s.query)||
    !instant(s.expiresAt)||!allowExpiredForPause&&Date.parse(s.expiresAt)<=now||!Number.isFinite(now)||
    typeof s.maximumBrowserMicrounits!=='string'||!/^[1-9][0-9]{0,14}$/.test(s.maximumBrowserMicrounits)||
    !insightsExact(s.limits,'maximumSessionMs,maximumActions,maximumTextBytes,maximumScreenshotBytes,maximumTotalCaptureBytes'))return insightsFail('scope_invalid');
  try {
    const w=validatePublicResearchWindow(s.window);
    if(!insightsInteger(s.windowAttemptOrdinal,1,w.maximumAttemptsInWindow)||!insightsInteger(s.attemptOrdinal,1)||s.attemptOrdinal!==w.baseAttemptsStarted+s.windowAttemptOrdinal)return insightsFail('attempt_window_invalid');
    validatePublicResearchSourceAccess({allowedSource:'etsy_authenticated_insights',sourcePurpose:'etsy_insights_aggregate_research',accountBinding:s.accountBinding,capturePolicyHash:s.capturePolicyHash},
      {businessId:s.businessId,goalId:s.goalId,authorityRootId:s.authorityRootId},allowExpiredForPause?undefined:now);
  }catch(e){if(e instanceof EtsyInsightsFailure)throw e;return insightsFail('account_or_window_invalid');}
  if(s.providerProjectId!==s.accountBinding.providerProjectId)return insightsFail('provider_project_mismatch');
  if(Date.parse(s.expiresAt)>Date.parse(s.accountBinding.expiresAt))return insightsFail('account_expired');
  const l=s.limits;
  if(!insightsInteger(l.maximumSessionMs,15000,120000)||!insightsInteger(l.maximumActions,3,8)||!insightsInteger(l.maximumTextBytes,1,32000)||
    !insightsInteger(l.maximumScreenshotBytes,24,2000000)||!insightsInteger(l.maximumTotalCaptureBytes,24,2032000))return insightsFail('scope_bounds_invalid');
  return structuredClone(s);
}
/** Ordinary navigation only. Renderer requests require separate reviewed server
 * qualification and never become hidden-endpoint evidence. */
export function etsyInsightsUrl(raw:string,query:string,expected?:'landing'|'results') {
  let u:URL;try{u=new URL(raw);}catch{return insightsFail('navigation_denied');}
  if(!text(raw,2000)||u.origin!==ETSY_INSIGHTS_SOURCE_POLICY.origin||u.username||u.password||u.port||u.hash)return insightsFail('navigation_denied');
  const kind=u.pathname===LANDING?'landing':u.pathname===`${LANDING}/search`?'results':null;
  if(!kind||expected&&expected!==kind||kind==='landing'&&u.search||kind==='results'&&(u.searchParams.get('query')!==query||[...u.searchParams.keys()].some(k=>!['query','search_trigger'].includes(k))||
    u.searchParams.getAll('query').length!==1||u.searchParams.getAll('search_trigger').length>1||u.searchParams.has('search_trigger')&&u.searchParams.get('search_trigger')!=='landing_search_bar'))return insightsFail('navigation_denied');
  const canonical=new URL(u.origin+u.pathname);if(kind==='results')canonical.searchParams.set('query',query);
  return {kind,canonicalUrl:canonical.href};
}
export function validateEtsyInsightsPage(raw:unknown,s:EtsyInsightsScope,identity:EtsyInsightsIdentity):EtsyInsightsObservedPage {
  if(!insightsExact(raw,'sessionId,contextId,pageId,providerProjectId,profileBindingId,profileBindingRevision,accountBindingHash,documentEpoch,url,view,block,unexpectedNavigation,unapprovedRequest,popupOpened,visibleShopName,visibleShopId,query,queryControl'))return insightsFail('source_invalidated');
  const p=raw as EtsyInsightsObservedPage;
  if(Object.entries(identity).some(([k,v])=>p[k as keyof EtsyInsightsObservedPage]!==v)||!insightsInteger(p.documentEpoch,0)||p.unexpectedNavigation!==false||p.unapprovedRequest!==false||p.popupOpened!==false)return insightsFail('source_invalidated');
  if(p.block!=='none')return insightsFail(['login','captcha','bot_challenge','quota','account_mismatch','private_data','unknown'].includes(p.block)?`blocked_${p.block}`:'source_invalidated');
  if(p.visibleShopName!==s.accountBinding.observedShopName||p.visibleShopId!==s.accountBinding.observedShopId)return insightsFail('account_mismatch');
  const url=etsyInsightsUrl(p.url,s.query,p.view);
  if(p.view!==url.kind||p.query!==(p.view==='results'?s.query:null))return insightsFail('query_changed');
  if(p.queryControl!==null&&(!insightsExact(p.queryControl,'id,kind,sensitive')||!text(p.queryControl.id,100)||!p.queryControl.id.trim()||p.queryControl.kind!=='insights_query'||p.queryControl.sensitive!==false))return insightsFail('observed_control_invalid');
  return structuredClone(p);
}
function facts(raw:unknown,body:string,s:EtsyInsightsScope):EtsyInsightsFact[] {
  if(!Array.isArray(raw)||raw.length<3||raw.length>24)return insightsFail('capture_facts_invalid');
  const chars=Array.from(body),seen=new Set<string>();
  for(const f of raw){
    if(!insightsExact(f,'kind,start,end,quote')||!FACT_KINDS.includes(String(f.kind))||!insightsInteger(f.start,0,chars.length)||!insightsInteger(f.end,Number(f.start)+1,chars.length)||
      !text(f.quote,500)||!f.quote.trim()||chars.slice(Number(f.start),Number(f.end)).join('')!==f.quote)return insightsFail('capture_facts_invalid');
    const key=`${f.kind}:${f.start}:${f.end}`;if(seen.has(key))return insightsFail('capture_facts_invalid');seen.add(key);
  }
  const list=raw as EtsyInsightsFact[],queries=list.filter(f=>f.kind==='query'),shops=list.filter(f=>f.kind==='shop_name');
  if(queries.length!==1||queries[0].quote!==s.query||shops.length!==1||shops[0].quote!==s.accountBinding.observedShopName||list.filter(f=>f.kind==='reporting_window').length!==1||
    list.some(f=>f.kind==='shop_id'&&f.quote!==s.accountBinding.observedShopId)||!list.some(f=>['searches','results','conversion_statement','price','trend_statement','limitation'].includes(f.kind)))return insightsFail('capture_context_missing');
  return structuredClone(list);
}
function accountContext(c:Pick<EtsyInsightsCapture,'sessionId'|'contextId'|'pageId'|'providerProjectId'|'accountBindingHash'|'accountVerificationHash'|'observedShopName'|'observedShopId'>) {
  return insightsHash({version:'r12.etsy-insights-visible-account-context.1',sessionId:c.sessionId,contextId:c.contextId,pageId:c.pageId,providerProjectId:c.providerProjectId,
    accountBindingHash:c.accountBindingHash,accountVerificationHash:c.accountVerificationHash,observedShopName:c.observedShopName,observedShopId:c.observedShopId});
}
function captureBody(raw:unknown,s:EtsyInsightsScope):EtsyInsightsCapture {
  if(!insightsExact(raw,'version,captureHash,sessionId,contextId,pageId,providerProjectId,visibleAccountContextHash,canonicalUrl,query,documentEpoch,capturedAt,source,accountBindingHash,accountVerificationHash,observedShopName,observedShopId,text,textHash,screenshotHash,screenshotBytes,mimeType,viewport,extraction,facts,interpretation,buyerGeography,competitorSales,competitorConversion,commercialDemandProven'))return insightsFail('capture_invalid');
  const c=raw as EtsyInsightsCapture,{captureHash,...body}=c;
  if(c.version!=='r12.etsy-insights-visible-capture.1'||captureHash!==insightsHash(body)||![c.sessionId,c.contextId,c.pageId,c.providerProjectId].every(insightsUuid)||
    c.providerProjectId!==s.providerProjectId||c.visibleAccountContextHash!==accountContext(c)||c.query!==s.query||etsyInsightsUrl(c.canonicalUrl,s.query,'results').canonicalUrl!==c.canonicalUrl||
    !insightsInteger(c.documentEpoch,0)||!instant(c.capturedAt)||Date.parse(c.capturedAt)<Date.parse(s.accountBinding.verifiedAt)||Date.parse(c.capturedAt)>=Date.parse(s.expiresAt)||c.source!=='browser_visible_signed_in_aggregate'||
    c.accountBindingHash!==s.accountBinding.bindingHash||c.accountVerificationHash!==s.accountBinding.accountVerificationHash||c.observedShopName!==s.accountBinding.observedShopName||c.observedShopId!==s.accountBinding.observedShopId||
    !text(c.text,32000)||c.textHash!==insightsBytesHash(Buffer.from(c.text))||!insightsIsHash(c.screenshotHash)||!insightsInteger(c.screenshotBytes,24,s.limits.maximumScreenshotBytes)||
    Buffer.byteLength(c.text)>s.limits.maximumTextBytes||Buffer.byteLength(c.text)+c.screenshotBytes>s.limits.maximumTotalCaptureBytes||
    c.mimeType!=='image/png'||!insightsExact(c.viewport,'width,height')||!insightsInteger(c.viewport.width,1,16384)||!insightsInteger(c.viewport.height,1,16384)||
    c.extraction!=='visible_aggregate_viewport'||c.interpretation!=='literal_display_only'||c.buyerGeography!=='not_inferred'||c.competitorSales!=='unknown'||c.competitorConversion!=='unknown'||c.commercialDemandProven!==false)return insightsFail('capture_invalid');
  facts(c.facts,c.text,s);return structuredClone(c);
}
export function buildEtsyInsightsCapture(frame:EtsyInsightsCaptureFrame,page:EtsyInsightsObservedPage,s:EtsyInsightsScope,now=Date.now()):EtsyInsightsCapture {
  if(!insightsExact(frame,'sessionId,contextId,pageId,providerProjectId,profileBindingId,profileBindingRevision,accountBindingHash,beforeEpoch,afterEpoch,url,capturedAt,text,screenshot,mimeType,viewport,extraction,facts'))return insightsFail('capture_invalid');
  validateEtsyInsightsPage(page,s,{sessionId:frame.sessionId,contextId:frame.contextId,pageId:frame.pageId,providerProjectId:frame.providerProjectId,profileBindingId:frame.profileBindingId,profileBindingRevision:frame.profileBindingRevision,accountBindingHash:frame.accountBindingHash});
  const pins=['sessionId','contextId','pageId','providerProjectId','profileBindingId','profileBindingRevision','accountBindingHash'] as const;
  if(pins.some(k=>frame[k]!==page[k])||frame.beforeEpoch!==page.documentEpoch||frame.afterEpoch!==page.documentEpoch||frame.url!==page.url||page.view!=='results')return insightsFail('capture_epoch_mismatch');
  if(!text(frame.text,32000)||!(frame.screenshot instanceof Uint8Array)||frame.screenshot.byteLength<24||frame.screenshot.byteLength>s.limits.maximumScreenshotBytes||
    !instant(frame.capturedAt)||Math.abs(Date.parse(frame.capturedAt)-now)>30000||Date.parse(frame.capturedAt)>=Date.parse(s.expiresAt)||!insightsExact(frame.viewport,'width,height'))return insightsFail('capture_invalid');
  const bytes=Buffer.from(frame.screenshot);
  if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.toString('ascii',12,16)!=='IHDR'||bytes.readUInt32BE(16)!==frame.viewport.width||bytes.readUInt32BE(20)!==frame.viewport.height)return insightsFail('screenshot_invalid');
  const context={sessionId:page.sessionId,contextId:page.contextId,pageId:page.pageId,providerProjectId:page.providerProjectId,accountBindingHash:s.accountBinding.bindingHash,
    accountVerificationHash:s.accountBinding.accountVerificationHash,observedShopName:page.visibleShopName,observedShopId:page.visibleShopId};
  const body:Omit<EtsyInsightsCapture,'captureHash'>={version:'r12.etsy-insights-visible-capture.1',...context,visibleAccountContextHash:accountContext(context),canonicalUrl:etsyInsightsUrl(frame.url,s.query,'results').canonicalUrl,
    query:s.query,documentEpoch:page.documentEpoch,capturedAt:frame.capturedAt,source:'browser_visible_signed_in_aggregate',text:frame.text,textHash:insightsBytesHash(Buffer.from(frame.text)),screenshotHash:insightsBytesHash(bytes),screenshotBytes:bytes.byteLength,
    mimeType:frame.mimeType,viewport:{...frame.viewport},extraction:frame.extraction,facts:structuredClone(frame.facts),interpretation:'literal_display_only',buyerGeography:'not_inferred',competitorSales:'unknown',competitorConversion:'unknown',commercialDemandProven:false};
  return captureBody({...body,captureHash:insightsHash(body)},s);
}
export function etsyInsightsWitnesses(captures:readonly EtsyInsightsCapture[]):EtsyInsightsWitness[] {
  return captures.flatMap(c=>{
    const context={source:'etsy_insights',shopName:normalize(c.observedShopName),shopId:c.observedShopId,query:normalize(c.query),reportingWindow:normalize(c.facts.find(f=>f.kind==='reporting_window')!.quote)};
    const cluster=insightsHash(context);
    return c.facts.map(f=>({ref:`${c.captureHash}:${f.kind}:${f.start}:${f.end}`,evidenceIdentityHash:insightsHash({kind:'literal_etsy_insights_text',text:normalize(f.quote)}),factIdentityHash:insightsHash({...context,kind:f.kind,text:normalize(f.quote)}),observationClusterHash:cluster}));
  });
}
export function validateEtsyInsightsStorage(raw:unknown,c:EtsyInsightsCapture):EtsyInsightsScreenshotStorage {
  if(!insightsExact(raw,'version,captureHash,screenshotHash,byteLength,storageObjectId,storageReceiptHash'))return insightsFail('screenshot_storage_unconfirmed');
  const r=raw as EtsyInsightsScreenshotStorage,{storageReceiptHash,...body}=r;
  if(r.version!=='r12.etsy-insights-screenshot-storage.1'||r.captureHash!==c.captureHash||r.screenshotHash!==c.screenshotHash||r.byteLength!==c.screenshotBytes||!insightsUuid(r.storageObjectId)||storageReceiptHash!==insightsHash(body))return insightsFail('screenshot_storage_unconfirmed');
  return structuredClone(r);
}
/** Shape/hash checks do not authenticate account access, billing, stored PNGs,
 * admission or novelty. The server reconstructs proof from immutable records. */
export function validateEtsyInsightsReceipt(raw:unknown,s:EtsyInsightsScope):EtsyInsightsReceipt {
  if(!insightsExact(raw,'version,operationId,sourceAttemptId,requestHash,businessId,goalId,authorityRootId,scopeId,scopeHash,providerProjectId,originDirectRunId,windowId,windowOrdinal,windowAttemptOrdinal,maximumAttemptsInWindow,baseAttemptsStarted,attemptOrdinal,criteriaHash,questionHash,quoteHash,executionQuoteHash,executionQuoteProofHash,sourcePolicyHash,capturePolicyHash,accountBindingHash,accountVerificationHash,maximumBrowserMicrounits,status,reason,capturedAt,captureHash,captures,witnesses,screenshotStorage,releaseState,liabilityState,reservationId,reservationHash,sessionId,actionsUsed,receiptHash'))return insightsFail('receipt_invalid');
  const r=raw as EtsyInsightsReceipt,{receiptHash,...body}=r;
  const pins=['operationId','sourceAttemptId','businessId','goalId','authorityRootId','scopeId','scopeHash','originDirectRunId','attemptOrdinal','windowAttemptOrdinal','criteriaHash','questionHash','quoteHash','executionQuoteHash','executionQuoteProofHash','sourcePolicyHash','capturePolicyHash','maximumBrowserMicrounits'] as const;
  if(r.version!==ETSY_INSIGHTS_RECEIPT_VERSION||receiptHash!==insightsHash(body)||r.requestHash!==insightsHash(s)||pins.some(k=>r[k]!==s[k])||
    r.windowId!==s.window.windowId||r.windowOrdinal!==s.window.windowOrdinal||r.maximumAttemptsInWindow!==s.window.maximumAttemptsInWindow||r.baseAttemptsStarted!==s.window.baseAttemptsStarted||
    r.providerProjectId!==s.providerProjectId||r.accountBindingHash!==s.accountBinding.bindingHash||r.accountVerificationHash!==s.accountBinding.accountVerificationHash||
    !['completed','paused'].includes(r.status)||!text(r.reason,100)||!r.reason||!instant(r.capturedAt)||!insightsInteger(r.actionsUsed,0,s.limits.maximumActions)||
    !Array.isArray(r.captures)||r.captures.length!==(r.status==='completed'?1:0)||r.captureHash!==insightsHash(r.captures))return insightsFail('receipt_invalid');
  for(const c of r.captures){captureBody(c,s);if(c.sessionId!==r.sessionId||Date.parse(c.capturedAt)>Date.parse(r.capturedAt)+1000)return insightsFail('receipt_invalid');}
  if(insightsHash(r.witnesses)!==insightsHash(etsyInsightsWitnesses(r.captures)))return insightsFail('receipt_invalid');
  if(r.captures.length)validateEtsyInsightsStorage(r.screenshotStorage,r.captures[0]);else if(r.screenshotStorage!==null)return insightsFail('receipt_invalid');
  if(!['not_required','verified','unconfirmed'].includes(r.releaseState)||!['not_dispatched','receipt_required','unknown'].includes(r.liabilityState)||
    r.status==='completed'&&(r.reason!=='completed'||r.releaseState!=='verified'||r.liabilityState!=='receipt_required'||r.actionsUsed!==3)||
    r.releaseState==='verified'&&(r.liabilityState!=='receipt_required'||!insightsUuid(r.sessionId))||r.releaseState==='unconfirmed'&&r.liabilityState!=='unknown'||
    r.releaseState==='not_required'&&(r.liabilityState!=='not_dispatched'||r.sessionId!==null||r.actionsUsed!==0)||r.liabilityState==='not_dispatched'&&r.releaseState!=='not_required'||
    (r.reservationId===null)!==(r.reservationHash===null)||r.reservationId!==null&&(!insightsUuid(r.reservationId)||!insightsIsHash(r.reservationHash))||
    r.liabilityState!=='not_dispatched'&&r.reservationId===null||r.sessionId!==null&&!insightsUuid(r.sessionId))return insightsFail('receipt_invalid');
  return structuredClone(r);
}
