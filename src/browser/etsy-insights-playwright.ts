import {isEtsyInsightsResearchRendererPolicy,validateEtsyInsightsResearchRendererPolicy,etsyInsightsResearchRendererPolicyHash,validateEtsyInsightsResearchReadiness,classifyEtsyInsightsResearchRendererRequest,type EtsyInsightsResearchRendererPolicy,type EtsyInsightsResearchReadiness} from './etsy-insights-renderer-research';
import {isEtsyInsightsVerificationCandidate,validateEtsyInsightsVerificationCandidate,etsyInsightsVerificationCandidateHash,classifyEtsyInsightsVerificationCandidateRequest,type EtsyInsightsVerificationCandidatePolicy,type EtsyInsightsCandidateMetadata,type EtsyInsightsCandidateDisposition} from './etsy-insights-renderer-candidate';
import {readEtsyInsightsLandingControls,ETSY_INSIGHTS_LANDING_CONTROL_ID,ETSY_INSIGHTS_LANDING_CONTROLS_VERSION,ETSY_INSIGHTS_LANDING_CONTROLS_HASH} from './etsy-insights-landing-controls';
import { installEtsyRequestAdmission, releaseEtsyTransportAndDispose, type EtsyRequestAdmission } from './etsy-request-admission';
import { randomUUID } from 'node:crypto';
import { classifyEtsyInsightsRendererRequest, validateEtsyInsightsRendererPolicy, etsyInsightsRendererPolicyHash, type EtsyInsightsRendererPolicy } from './etsy-insights-renderer-policy';
import { chromium, type Browser, type BrowserContext, type CDPSession, type Locator, type Page } from 'playwright-core';
import { SteelBrowserAdapter, type SteelConfig } from './providers/steel';
import type { TransportAdmission } from '../core/transport-admission';
import { awaitRequestDeadline, requestDeadline } from '../core/request-deadline';
import type { EtsyInsightsDependencies, EtsyInsightsFact, EtsyInsightsScope, EtsyInsightsSession } from './etsy-insights-contracts';
import { EtsyInsightsFailure, etsyInsightsUrl, insightsFail, insightsHash, insightsIsHash, insightsUuid, validateEtsyInsightsScope } from './etsy-insights-policy';

/** Observed in the ordinary signed-in Insights result UI on 2026-10-10.
 * These are fail-closed renderer boundaries, not a claim of live Steel testing.
 * Dynamic query/shop text is always read from the page, never filled from scope.
 * No tooltip contents, hidden tables, profile menus or related listings are read. */
export const ETSY_INSIGHTS_VISIBLE_SELECTORS = Object.freeze({
  main: '#main-content', form: 'form[aria-label="search bar form"]',
  query: 'input[aria-label="Input to search for keywords"]',
  heading: 'h3.wt-text-display', header: 'div.wt-sem-mt-page-tight.wt-sem-mb-page-tight',
  window: 'clg-signal[variant="subtle"] > span',
  conversion: '#mi-walkthrough-cvr-anchor button[slot="trigger"]',
  summary: 'div.wt-sem-border-b-divider', summaryQuery: 'span.wt-text-title-small.wt-break-word',
  metricLabel: 'div.wt-text-title-small.wt-sem-text-primary', metricValue: 'div.wt-text-body',
  date: '#mi-walkthrough-time-range-anchor', trend: 'button[data-testid="wow-trend-indicator"]',
  shops: '#shop-manager--channels-list a[href^="/shop/"]', shopName: 'span[data-test-id="unsanitize"]',
});
const S = ETSY_INSIGHTS_VISIBLE_SELECTORS;
const LANDING = 'https://www.etsy.com/your/shops/me/marketplace-insights';
const CONTROL = 'observed-insights-query-form';
function synchronousMarker(fn:()=>unknown):void{const result=fn();if(result&&typeof(result as PromiseLike<unknown>).then==='function'){void Promise.resolve(result).catch(()=>undefined);return insightsFail('async_dispatch_guard_rejected');}}
function frozen<T>(value:T):T { if(value&&typeof value==='object'){Object.values(value).forEach(frozen);Object.freeze(value);}return value; }
type Rect = { x: number; y: number; width: number; height: number };
type View = { url: string; kind: 'landing'|'results'; shop: string; query: string|null;
  window: string|null; searches: string|null; results: string|null; conversion: string|null;
  trend: string|null; clip: Rect|null };
type EtsyInsightsRendererRequestBase = { operationId: string; sourceAttemptId: string;
  requestHash: string; qualificationHash: string; sequence: number; url: string; method: string;
  resourceType: string; navigation: boolean;
};
export type EtsyInsightsResearchRendererRequest={version:'r12.etsy-insights-renderer-request.3';operationId:string;sourceAttemptId:string;requestHash:string;qualificationHash:string;policyHash:string;provenanceHash:string;sequence:number;disposition:EtsyInsightsCandidateDisposition;decisionHash:string}&EtsyInsightsCandidateMetadata;
export type EtsyInsightsRendererRequest=(EtsyInsightsRendererRequestBase&({version:'r12.etsy-insights-renderer-request.1'}|{version:'r12.etsy-insights-renderer-request.2';disposition:'allow'|'deny_optional_telemetry';policyHash:string;provenanceHash:string}))|EtsyInsightsResearchRendererRequest;
export type EtsyInsightsRendererQualification<P=EtsyInsightsRendererPolicy|EtsyInsightsResearchRendererPolicy>={requestHash:string;qualificationHash:string;expiresAt:string;maximumRequests:number;policy:P;policyHash:string}&(
 {version:'r12.etsy-insights-renderer-qualification.1'}|
 {version:'r12.etsy-insights-renderer-qualification.2';landingControlsVersion:typeof ETSY_INSIGHTS_LANDING_CONTROLS_VERSION;landingControlsHash:string}|
 {version:'r12.etsy-insights-renderer-qualification.3';landingControlsVersion:typeof ETSY_INSIGHTS_LANDING_CONTROLS_VERSION;landingControlsHash:string;readiness:EtsyInsightsResearchReadiness});
function qualifiedLandingV2(q:EtsyInsightsRendererQualification<unknown>):boolean{
 if(q.version==='r12.etsy-insights-renderer-qualification.1'){
  if('landingControlsVersion' in q||'landingControlsHash' in q)return insightsFail('renderer_landing_contract_invalid');
  return false;
 }
 if(!['r12.etsy-insights-renderer-qualification.2','r12.etsy-insights-renderer-qualification.3'].includes(q.version)||q.landingControlsVersion!==ETSY_INSIGHTS_LANDING_CONTROLS_VERSION||q.landingControlsHash!==ETSY_INSIGHTS_LANDING_CONTROLS_HASH)return insightsFail('renderer_landing_contract_invalid');
 const {qualificationHash,...body}=q;
 const keys='expiresAt,landingControlsHash,landingControlsVersion,maximumRequests,policy,policyHash,qualificationHash,requestHash,version'+(q.version==='r12.etsy-insights-renderer-qualification.3'?',readiness':'');
 if(Object.keys(q).sort().join(',')!==keys.split(',').sort().join(',')||qualificationHash!==insightsHash(body))return insightsFail('renderer_landing_contract_invalid');
 return true;
}
export type EtsyInsightsPlaywrightPortInput = {
  providerProjectId: string; admitDispatch: TransportAdmission;
  /** Trusted immutable ledger lookup, not browser/model/caller account JSON.
   * The provider session UUID belongs to this one-shot source attempt. */
  resolveAttempt(scope: Readonly<EtsyInsightsScope>): Promise<{ sourceAttemptId: string; requestHash: string;
    sessionId: string; profileId: string; providerProjectId: string; accountBindingHash: string;
    profileBindingId: string; profileBindingRevision: string }>;
  beforeCreate(scope: Readonly<EtsyInsightsScope>, sessionId: string): void;
  /** A reviewed server record must qualify the renderer route BEFORE paid create.
   * No built-in wildcard network approval is provided. Renderer traffic is never
   * evidence; no request/response bodies or headers are read or exposed. */
  qualifyRenderer(scope: Readonly<EtsyInsightsScope>): Promise<EtsyInsightsRendererQualification>;
  admitRenderer(request: Readonly<EtsyInsightsRendererRequest>, signal: AbortSignal): Promise<void>;
  registerCleanup(work: Promise<void>): void;
  config?: SteelConfig; fetcher?: typeof fetch; connect?: typeof chromium.connectOverCDP;
  now?: () => number;
};

async function visible(locator: Locator, page: Page, signal: AbortSignal): Promise<Rect> {
  signal.throwIfAborted();
  if (await awaitRequestDeadline(locator.count(), signal) !== 1 || !await awaitRequestDeadline(locator.isVisible(), signal)) return insightsFail('visible_boundary_missing');
  const rect = await awaitRequestDeadline(locator.boundingBox(), signal), viewport = page.viewportSize();
  if (!rect || !viewport || rect.width <= 0 || rect.height <= 0 || rect.x < 0 || rect.y < 0 ||
      rect.x + rect.width > viewport.width || rect.y + rect.height > viewport.height) return insightsFail('visible_boundary_outside_viewport');
  return rect;
}
async function literal(locator: Locator, page: Page, signal: AbortSignal, maximum = 500): Promise<string> {
  await visible(locator, page, signal);
  const value = await awaitRequestDeadline(locator.innerText({ timeout: 1000 }), signal);
  if (!value || value.length > maximum || value.trim() !== value || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) return insightsFail('visible_text_invalid');
  return value;
}
/** Read only the already-visible aggregate nodes. The input value is deliberately
 * absent: both the independent results heading and summary query must agree. */
async function readView(page: Page, scope: EtsyInsightsScope, signal: AbortSignal, landingV2=false): Promise<View> {
  // A popup/credential overlay is never part of aggregate evidence. These are
  // conservative exclusion checks, not claimed site-specific login selectors.
  if (await page.getByRole('dialog').filter({visible:true}).count() || await page.locator('input[type="password"]').filter({visible:true}).count()) return insightsFail('blocked_unknown');
  const url = page.url(), route = etsyInsightsUrl(url, scope.query), main = page.locator(S.main);
  const shopLink = page.locator(S.shops), shop = await literal(shopLink.locator(S.shopName), page, signal, 100);
  if (await shopLink.count() !== 1 || shop !== scope.accountBinding.observedShopName || scope.accountBinding.observedShopId !== null) return insightsFail('account_mismatch');
  const href = await shopLink.getAttribute('href');
  let shopUrl: URL; try { shopUrl = new URL(href ?? '', 'https://www.etsy.com'); } catch { return insightsFail('account_mismatch'); }
  if (shopUrl.origin !== 'https://www.etsy.com' || decodeURIComponent(shopUrl.pathname) !== `/shop/${shop}` ||
      [...shopUrl.searchParams.keys()].some(k => k !== 'ref') || shopUrl.searchParams.getAll('ref').length!==1 ||
      shopUrl.searchParams.get('ref')!=='seller-platform-mcnav') return insightsFail('account_mismatch');
  if(route.kind==='landing'&&landingV2){
    await readEtsyInsightsLandingControls(page,signal,{visible,literal});
    return {url,kind:'landing',shop,query:null,window:null,searches:null,results:null,conversion:null,trend:null,clip:null};
  }
  const form = main.locator(S.form), query = form.locator(S.query), submit = form.getByRole('button', { name: 'Search', exact: true });
  await visible(query, page, signal); await visible(submit, page, signal);
  if (await query.getAttribute('type') !== 'text' || !await query.isEnabled() || await submit.getAttribute('type') !== 'submit' || !await submit.isEnabled()) return insightsFail('insights_query_unavailable');
  if (route.kind === 'landing') return { url, kind: 'landing', shop, query: null, window: null, searches: null, results: null, conversion: null, trend: null, clip: null };
  const header = main.locator(S.header), summary = main.locator(S.summary), heading = header.locator(S.heading);
  const queryText = await literal(heading, page, signal, 160), summaryQuery = await literal(summary.locator(S.summaryQuery), page, signal, 160);
  if (queryText !== scope.query || summaryQuery !== queryText) return insightsFail('query_changed');
  const window = await literal(header.locator(S.window), page, signal);
  const date = main.locator(S.date);
  if (await date.count() !== 1 || !await date.isEnabled() || (await date.innerText()).trim() !== window ||
      await main.getByText('Loading', { exact: true }).filter({ visible: true }).count() !== 0 ||
      await main.getByText('Loading chart data', { exact: true }).filter({ visible: true }).count() !== 0) return insightsFail('source_not_ready');
  async function metric(label: string) {
    const labels = summary.locator(S.metricLabel).filter({ hasText: new RegExp(`^${label}$`) });
    if (await literal(labels, page, signal) !== label) return insightsFail('visible_boundary_missing');
    // This exact parent/value structure was observed for both displayed metrics.
    return literal(labels.locator('..').locator(S.metricValue), page, signal);
  }
  const searches = await metric('Searches'), results = await metric('Search results');
  const conversion = await literal(header.locator(S.conversion), page, signal);
  const trendNode = summary.locator(S.trend), trend = await trendNode.count() === 0 ? null : await literal(trendNode, page, signal);
  const h = await visible(header, page, signal), m = await visible(summary, page, signal);
  // Crop out all navigation, owner-name/profile UI, notifications and unrelated
  // cards. The same-epoch shop label is a separate visible-DOM identity witness.
  const x = Math.floor(Math.min(h.x, m.x)), y = Math.floor(Math.min(h.y, m.y));
  const clip = { x, y, width: Math.ceil(Math.max(h.x+h.width, m.x+m.width))-x, height: Math.ceil(Math.max(h.y+h.height, m.y+m.height))-y };
  return { url, kind: 'results', shop, query: queryText, window, searches, results, conversion, trend, clip };
}

export function createEtsyInsightsPlaywrightPort(input: EtsyInsightsPlaywrightPortInput): Pick<EtsyInsightsDependencies, 'createSession'> {
  if (!insightsUuid(input.providerProjectId) || ![input.resolveAttempt,input.beforeCreate,input.qualifyRenderer,input.admitRenderer,input.registerCleanup,input.admitDispatch].every(f=>typeof f==='function')) return insightsFail('renderer_qualification_required');
  const provider = new SteelBrowserAdapter({config: input.config,fetcher: input.fetcher,admitDispatch: input.admitDispatch});
  const connect = input.connect ?? chromium.connectOverCDP.bind(chromium), now = input.now ?? Date.now;
  return { async createSession(raw, signal): Promise<EtsyInsightsSession> {
    const scope = frozen(validateEtsyInsightsScope(raw, now())), requestHash = insightsHash(scope);
    if (scope.providerProjectId !== input.providerProjectId || scope.accountBinding.observedShopId !== null) return insightsFail('account_mismatch');
    const bounded = AbortSignal.any([signal,requestDeadline(scope.limits.maximumSessionMs)]);
    const resolved = frozen(structuredClone(await awaitRequestDeadline(input.resolveAttempt(scope),bounded)));
    if (resolved.sourceAttemptId !== scope.sourceAttemptId || resolved.requestHash !== requestHash || resolved.sessionId !== scope.operationId || !insightsUuid(resolved.sessionId) || !insightsUuid(resolved.profileId) ||
        resolved.providerProjectId !== scope.providerProjectId || resolved.accountBindingHash !== scope.accountBinding.bindingHash ||
        resolved.profileBindingId !== scope.accountBinding.profileBindingId || resolved.profileBindingRevision !== scope.accountBinding.profileBindingRevision) return insightsFail('profile_binding_unverified');
    const qualification = frozen(structuredClone(await awaitRequestDeadline(input.qualifyRenderer(scope),bounded)));
    const landingV2=qualifiedLandingV2(qualification),controlId=landingV2?ETSY_INSIGHTS_LANDING_CONTROL_ID:CONTROL;
    if (qualification.requestHash !== requestHash || !insightsIsHash(qualification.qualificationHash) ||
        !Number.isSafeInteger(qualification.maximumRequests) || qualification.maximumRequests < 1 || qualification.maximumRequests > 512 ||
        !Number.isFinite(Date.parse(qualification.expiresAt)) || Date.parse(qualification.expiresAt) <= now() || Date.parse(qualification.expiresAt) > Date.parse(scope.expiresAt)) return insightsFail('renderer_qualification_required');
    const research=qualification.version==='r12.etsy-insights-renderer-qualification.3';
    const rendererPolicy=research?validateEtsyInsightsResearchRendererPolicy(qualification.policy):validateEtsyInsightsRendererPolicy(qualification.policy);
    if(research&&!isEtsyInsightsResearchRendererPolicy(rendererPolicy))return insightsFail('renderer_research_policy_invalid');
    const readiness=research&&isEtsyInsightsResearchRendererPolicy(rendererPolicy)?validateEtsyInsightsResearchReadiness(qualification.readiness,scope,rendererPolicy,now()):null;
    const rendererHash=isEtsyInsightsResearchRendererPolicy(rendererPolicy)?etsyInsightsResearchRendererPolicyHash(rendererPolicy):etsyInsightsRendererPolicyHash(rendererPolicy);
    if(qualification.policyHash!==rendererHash||qualification.maximumRequests!==rendererPolicy.maximumRequests||readiness&&Date.parse(qualification.expiresAt)>Date.parse(readiness.expiresAt))return insightsFail('renderer_policy_invalid');
    let browser: Browser|null=null, context: BrowserContext|null=null, page: Page|null=null, cdp: CDPSession|null=null;
    let marked=false, closed=false, opened=false, submitted=false, captured=false, invalid=false, invalidReason='source_invalidated', epoch=0, lastHash:string|null=null, requests=0;
    let networkGuard:EtsyRequestAdmission|null=null;
    let cleanupWork:Promise<{sessionId:string;released:boolean;terminalReadback:boolean;observersDisposed:boolean}>|null=null;
    const active = () => { bounded.throwIfAborted(); if(invalid)return insightsFail(invalidReason);if(closed||now()>=Date.parse(scope.expiresAt)||now()>=Date.parse(scope.accountBinding.expiresAt)||now()>=Date.parse(qualification.expiresAt)) return insightsFail('source_invalidated'); };
    const cleanup = () => cleanupWork ??= (()=>{
      closed=true;networkGuard?.seal();
      return releaseEtsyTransportAndDispose({sessionId:resolved.sessionId,marked,
        release:()=>provider.releaseOwnerHandoffSession(resolved.sessionId,scope.providerProjectId),registerCleanup:input.registerCleanup,
        dispose:[()=>context?.unrouteAll({behavior:'wait'})??Promise.resolve(),
          ()=>Promise.all((context?.pages()??[]).map(p=>awaitRequestDeadline(p.removeAllListeners(undefined,{behavior:'wait'}),requestDeadline(1000)))),
          ()=>context?.removeAllListeners(undefined,{behavior:'wait'})??Promise.resolve(),
          ()=>networkGuard?.drain()??Promise.resolve(true),()=>cdp?.detach()??Promise.resolve(),
          async()=>{if(browser?.isConnected())await browser.close();return !browser?.isConnected();}],
      });
    })();
    const abort = () => input.registerCleanup(cleanup().then(()=>undefined));
    bounded.addEventListener('abort',abort,{once:true});
    try {
      active();
      const session = await provider.createInsightsSession(resolved.sessionId,scope.providerProjectId,resolved.profileId,scope.limits.maximumSessionMs,()=>{active();synchronousMarker(()=>input.beforeCreate(scope,resolved.sessionId));marked=true;},bounded);
      const connection=connect(session.automationEndpoint,{timeout:20000});
      input.registerCleanup(connection.then(async b=>{if(bounded.aborted||closed){const release=cleanup();await awaitRequestDeadline(b.close(),requestDeadline(1000)).catch(()=>undefined);await release;}},()=>undefined));
      browser=await awaitRequestDeadline(connection,bounded); active();
      const contexts=browser.contexts(); if(contexts.length!==1)return insightsFail('browser_context_unverified'); context=contexts[0];
      if(context.pages().some(p=>p.url()!=='about:blank')||context.pages().length>1||context.serviceWorkers().length)return insightsFail('browser_context_unverified');
      page=context.pages()[0]??await awaitRequestDeadline(context.newPage(),bounded);
      await awaitRequestDeadline(page.setViewportSize({width:1280,height:900}),bounded);
      cdp=await awaitRequestDeadline(context.newCDPSession(page),bounded);
      context.on('serviceworker',()=>{invalid=true;abort();});
      context.on('page',p=>{if(p!==page){invalid=true;void p.close().catch(()=>undefined);}});
      page.on('framenavigated',frame=>{if(frame===page!.mainFrame()){epoch++;lastHash=null;try{etsyInsightsUrl(frame.url(),scope.query);}catch{invalid=true;}}});
      await awaitRequestDeadline(context.routeWebSocket('**/*',socket=>{invalid=true;socket.close();}),bounded);
      // Original-request defense for unexpected pages. Redirect authority lives
      // in CDP Fetch below, because Playwright routing does not see later hops.
      await awaitRequestDeadline(context.route('**/*',async route=>{
        try{active();if(route.request().frame()!==page!.mainFrame())return insightsFail('navigation_denied');await route.continue();}
        catch{invalid=true;await route.abort('blockedbyclient').catch(()=>undefined);}
      }),bounded);
      networkGuard=await installEtsyRequestAdmission({cdp,signal:bounded,
        invalidate(reason){invalid=true;invalidReason=reason;},
        async admit(r){
          active();if(++requests>qualification.maximumRequests)return insightsFail('renderer_request_limit');
          if(isEtsyInsightsResearchRendererPolicy(rendererPolicy)){
            const {metadata,disposition}=classifyEtsyInsightsResearchRendererRequest(rendererPolicy,r,scope.query);
            const body={version:'r12.etsy-insights-renderer-request.3' as const,operationId:scope.operationId,sourceAttemptId:scope.sourceAttemptId,requestHash,qualificationHash:qualification.qualificationHash,policyHash:qualification.policyHash,provenanceHash:rendererPolicy.candidatePolicy.provenanceHash,sequence:requests,...metadata,disposition};
            await awaitRequestDeadline(input.admitRenderer(Object.freeze({...body,decisionHash:insightsHash(body)}),bounded),bounded);active();
            if(disposition==='deny_candidate_ancillary')return disposition;return;
          }
          const disposition=classifyEtsyInsightsRendererRequest(rendererPolicy,r,scope.query);
          const metadata=disposition==='deny_optional_telemetry'?{...r,url:new URL(r.url).origin+new URL(r.url).pathname}:r;
          const base={operationId:scope.operationId,sourceAttemptId:scope.sourceAttemptId,requestHash,qualificationHash:qualification.qualificationHash,sequence:requests,...metadata};
          const request:EtsyInsightsRendererRequest=rendererPolicy.version==='etsy.insights-renderer-policy.2'?{...base,version:'r12.etsy-insights-renderer-request.2',disposition,policyHash:qualification.policyHash,provenanceHash:rendererPolicy.provenanceHash}:{...base,version:'r12.etsy-insights-renderer-request.1'};
          await awaitRequestDeadline(input.admitRenderer(Object.freeze(request),bounded),bounded);active();
          if(disposition==='deny_optional_telemetry')return disposition;
        },
      });
      const identity=Object.freeze({sessionId:resolved.sessionId,contextId:randomUUID(),pageId:randomUUID(),providerProjectId:scope.providerProjectId,
        profileBindingId:scope.accountBinding.profileBindingId,profileBindingRevision:scope.accountBinding.profileBindingRevision,accountBindingHash:scope.accountBinding.bindingHash});
      async function read(s:AbortSignal){active();s.throwIfAborted();const v=await readView(page!,scope,AbortSignal.any([s,bounded]),landingV2);active();
        const hash=insightsHash(v);if(lastHash!==null&&hash!==lastHash)epoch++;lastHash=hash;return v;}
      return Object.freeze({...identity,persistProfile:false as const,
        async openApprovedInsights(s:AbortSignal){active();if(opened)return insightsFail('already_opened');opened=true;s.throwIfAborted();
          await awaitRequestDeadline(page!.goto(LANDING,{waitUntil:'domcontentloaded',timeout:20000}),AbortSignal.any([s,bounded]));active();etsyInsightsUrl(page!.url(),scope.query,'landing');},
        async observeAggregateView(s:AbortSignal){const v=await read(s);return {...identity,documentEpoch:epoch,url:v.url,view:v.kind,block:'none' as const,
          unexpectedNavigation:false,unapprovedRequest:false,popupOpened:false,visibleShopName:v.shop,visibleShopId:null,query:v.query,
          queryControl:{id:v.kind==='landing'?controlId:CONTROL,kind:'insights_query' as const,sensitive:false as const}};},
        async submitObservedQuery(control:string,expectedEpoch:number,query:string,s:AbortSignal){
          const prior=await read(s);if(submitted||!opened||control!==controlId||expectedEpoch!==epoch||query!==scope.query||prior.kind!=='landing')return insightsFail('observed_control_invalid');
          submitted=true;const stop=AbortSignal.any([s,bounded]),form=page!.locator(S.main).locator(S.form);
          const controls=landingV2?await readEtsyInsightsLandingControls(page!,stop,{visible,literal}):{input:form.locator(S.query),submit:form.getByRole('button',{name:'Search',exact:true})};
          await awaitRequestDeadline(controls.input.fill(query,{timeout:1000}),stop);active();
          // Recheck visible account after filling, before the one quota-consuming submit.
          await read(s);if(expectedEpoch!==epoch)return insightsFail('source_invalidated');
          await awaitRequestDeadline(controls.submit.click({timeout:1000}),stop);active();
          await awaitRequestDeadline(page!.locator(S.main).locator(S.header).locator(S.heading).filter({hasText:query}).waitFor({state:'visible',timeout:15000}),stop);
          await awaitRequestDeadline(page!.locator(S.date).waitFor({state:'visible',timeout:15000}),stop);active();
          // The live result initially exposed its heading while the chart was
          // still loading. Input/heading presence alone cannot certify readiness.
          await awaitRequestDeadline(page!.waitForFunction(({date,heading,summaryQuery,query})=>{
            const d=document.querySelector<HTMLButtonElement>(date),h=document.querySelector<HTMLElement>(heading),q=document.querySelector<HTMLElement>(summaryQuery);
            return !!d&&!d.disabled&&h?.innerText===query&&q?.innerText===query;
          },{date:S.date,heading:`${S.main} ${S.header} ${S.heading}`,summaryQuery:`${S.main} ${S.summary} ${S.summaryQuery}`,query},{timeout:15000}),stop);active();
        },
        async captureSameEpoch(expectedEpoch:number,s:AbortSignal){
          const before=await read(s);if(captured||!submitted||before.kind!=='results'||!before.clip||expectedEpoch!==epoch)return insightsFail('capture_epoch_mismatch');
          captured=true;
          const beforeHash=insightsHash(before),beforeEpoch=epoch;
          const png=await awaitRequestDeadline(page!.screenshot({type:'png',clip:before.clip,timeout:5000,animations:'disabled',scale:'css'}),AbortSignal.any([s,bounded]));
          const after=await read(s);if(epoch!==beforeEpoch||insightsHash(after)!==beforeHash)return insightsFail('capture_epoch_mismatch');
          const facts:EtsyInsightsFact[]=[];let text='';
          const add=(kind:EtsyInsightsFact['kind'],quote:string)=>{if(text)text+='\n';const start=Array.from(text).length;text+=quote;facts.push({kind,start,end:Array.from(text).length,quote});};
          add('shop_name',before.shop);add('query',before.query!);add('reporting_window',before.window!);
          add('searches',`Searches\n${before.searches}`);add('results',`Search results\n${before.results}`);add('conversion_statement',before.conversion!);
          if(before.trend)add('trend_statement',before.trend);
          return {...identity,beforeEpoch,afterEpoch:epoch,url:before.url,capturedAt:new Date(now()).toISOString(),text,screenshot:Uint8Array.from(png),mimeType:'image/png' as const,
            viewport:{width:before.clip.width,height:before.clip.height},extraction:'visible_aggregate_viewport' as const,facts};
        },
        async close(expected:string){if(expected!==resolved.sessionId)return insightsFail('session_identity_invalid');bounded.removeEventListener('abort',abort);return cleanup();},
      });
    } catch { input.registerCleanup(cleanup().then(()=>undefined));return insightsFail('insights_renderer_unverified'); }
  }};
}

/** Separate SQL-derived approval for a single no-query setup verification. An
 * unverified candidate cannot be passed through the research scope validator. */
export type EtsyInsightsVerificationScope = {
  version:'etsy.steel-account-verification-scope.1'; operationId:string; setupOperationId:string; handoffId:string;
  ownerId:string; businessId:string; goalId:string; authorityRootId:string; testEnvelopeId:string; testEnvelopeHash:string;
  providerProjectId:string; profileBindingId:string; profileBindingRevision:string; profileCandidateHash:string; profileId:string;
  approvalId:string; approvalRevision:string; disclosureHash:string; purpose:'etsy_insights_verify_only';
  expectedShopName:string; expectedShopId:null; quoteHash:string; maximumBrowserMicrounits:string;
  maximumSessionMs:number; expiresAt:string; profileAccessExpiresAt:string;
};
export type EtsyInsightsVerificationInputs={scope:EtsyInsightsVerificationScope;scopeHash:string;requestId:string;workflowRunId:string};
export type EtsyInsightsAccountVerification={
  version:'etsy.steel-account-verification.1'|'etsy.steel-account-verification.2';operationId:string;setupOperationId:string;handoffId:string;
  profileBindingId:string;profileBindingRevision:string;providerProjectId:string;testEnvelopeId:string;testEnvelopeHash:string;
  profileId:string;sessionId:string;contextId:string;pageId:string;observedShopName:string;observedShopId:null;
  verifiedAt:string;expiresAt:string;accountIdentityVerified:true;insightsAccessVerified:true;
  visibleShopHref:string;canonicalUrl:string;insightsHeading:string;queryControlWitnessHash:string;documentEpoch:number;
  verifiedContextHash:string;verificationHash:string;
}&({version:'etsy.steel-account-verification.1'}|{version:'etsy.steel-account-verification.2';landingControlsVersion:typeof ETSY_INSIGHTS_LANDING_CONTROLS_VERSION;landingControlsHash:string});
export const ETSY_INSIGHTS_QUERY_CONTROL_WITNESS=Object.freeze({formAriaLabel:'search bar form',inputAriaLabel:'Input to search for keywords',inputType:'text',
  buttonName:'Search',buttonType:'submit',formVisible:true,inputVisible:true,inputEnabled:true,buttonVisible:true,buttonEnabled:true});
export type EtsyInsightsVerificationCandidateRequest={version:'etsy.insights-verification-renderer-request.3';operationId:string;requestId:string;scopeHash:string;qualificationHash:string;policyHash:string;provenanceHash:string;sequence:number;disposition:EtsyInsightsCandidateDisposition;decisionHash:string}&EtsyInsightsCandidateMetadata;
export type EtsyInsightsVerificationPortInput={
  providerProjectId:string;admitDispatch:TransportAdmission;
  /** Must authenticate these exact SQL inputs and recheck current stored owner
   * approval, candidate, purpose and envelope. Create is one-shot, never replay. */
  admitStage(input:Readonly<{operation:'create'|'open'|'observe'|'accept';operationId:string;scopeHash:string;requestId:string;workflowRunId:string}>):Promise<void>;
  beforeCreate(input:Readonly<EtsyInsightsVerificationInputs>):void;
  qualifyRenderer(scope:Readonly<EtsyInsightsVerificationScope>):Promise<EtsyInsightsRendererQualification<EtsyInsightsRendererPolicy|EtsyInsightsVerificationCandidatePolicy>>;
  admitRenderer(input:Readonly<{operationId:string;requestId:string;scopeHash:string;qualificationHash:string;sequence:number;url:string;method:string;resourceType:string;navigation:boolean}&({version:'etsy.insights-verification-renderer-request.1'}|{version:'etsy.insights-verification-renderer-request.2';disposition:'allow'|'deny_optional_telemetry';policyHash:string;provenanceHash:string})|EtsyInsightsVerificationCandidateRequest>,signal:AbortSignal):Promise<void>;
  registerCleanup(work:Promise<void>):void;config?:SteelConfig;fetcher?:typeof fetch;connect?:typeof chromium.connectOverCDP;now?:()=>number;
};
function verifyScope(raw:EtsyInsightsVerificationInputs,now:number):EtsyInsightsVerificationInputs{
  const keys='version,operationId,setupOperationId,handoffId,ownerId,businessId,goalId,authorityRootId,testEnvelopeId,testEnvelopeHash,providerProjectId,profileBindingId,profileBindingRevision,profileCandidateHash,profileId,approvalId,approvalRevision,disclosureHash,purpose,expectedShopName,expectedShopId,quoteHash,maximumBrowserMicrounits,maximumSessionMs,expiresAt,profileAccessExpiresAt';
  if(!raw||Object.keys(raw).sort().join(',')!=='requestId,scope,scopeHash,workflowRunId'||!raw.scope||Object.keys(raw.scope).sort().join(',')!==keys.split(',').sort().join(','))return insightsFail('verification_scope_invalid');
  const s=raw.scope;
  if(s.version!=='etsy.steel-account-verification-scope.1'||s.purpose!=='etsy_insights_verify_only'||s.expectedShopId!==null||s.operationId===s.setupOperationId||
    ![raw.requestId,raw.workflowRunId,s.operationId,s.setupOperationId,s.handoffId,s.ownerId,s.businessId,s.goalId,s.authorityRootId,s.testEnvelopeId,s.providerProjectId,s.profileBindingId,s.profileBindingRevision,s.profileId,s.approvalId,s.approvalRevision].every(insightsUuid)||
    ![s.testEnvelopeHash,s.profileCandidateHash,s.disclosureHash,s.quoteHash].every(insightsIsHash)||raw.scopeHash!==insightsHash(s)||
    typeof s.expectedShopName!=='string'||!s.expectedShopName.trim()||s.expectedShopName!==s.expectedShopName.trim()||s.expectedShopName.length>120||
    typeof s.maximumBrowserMicrounits!=='string'||!/^[1-9][0-9]{0,14}$/.test(s.maximumBrowserMicrounits)||!Number.isSafeInteger(s.maximumSessionMs)||s.maximumSessionMs<15000||s.maximumSessionMs>120000||
    !Number.isFinite(Date.parse(s.expiresAt))||Date.parse(s.expiresAt)<=now||!Number.isFinite(Date.parse(s.profileAccessExpiresAt))||Date.parse(s.profileAccessExpiresAt)<Date.parse(s.expiresAt))return insightsFail('verification_scope_invalid');
  return frozen(structuredClone(raw));
}
/** Actual renderer port only, never a login/credential API. Its caller must save
 * the returned exact release/accounting evidence and immutable proof through the
 * verification-purpose SQL key before issuing an authenticated account binding. */
export function createEtsyInsightsVerificationPort(input:EtsyInsightsVerificationPortInput){
  if(!insightsUuid(input.providerProjectId)||![input.admitDispatch,input.admitStage,input.beforeCreate,input.qualifyRenderer,input.admitRenderer,input.registerCleanup].every(f=>typeof f==='function'))return insightsFail('verification_admission_required');
  const provider=new SteelBrowserAdapter({config:input.config,fetcher:input.fetcher,admitDispatch:input.admitDispatch}),connect=input.connect??chromium.connectOverCDP.bind(chromium),now=input.now??Date.now;
  return {async verify(raw:EtsyInsightsVerificationInputs,signal:AbortSignal):Promise<{status:'verified'|'paused';reason:string;verification:EtsyInsightsAccountVerification|null;release:{sessionId:string;released:boolean;terminalReadback:boolean;observersDisposed:boolean}}>{
    const authority=verifyScope(raw,now()),scope=authority.scope;if(scope.providerProjectId!==input.providerProjectId)return insightsFail('provider_project_mismatch');
    const bounded=AbortSignal.any([signal,requestDeadline(scope.maximumSessionMs)]);
    let browser:Browser|null=null,context:BrowserContext|null=null,page:Page|null=null,cdp:CDPSession|null=null;
    let marked=false,invalid=false,invalidReason='verification_unconfirmed',epoch=0,requests=0,qualification:EtsyInsightsRendererQualification<EtsyInsightsRendererPolicy|EtsyInsightsVerificationCandidatePolicy>|null=null;
    let proof:EtsyInsightsAccountVerification|null=null,reason='verification_failed';
    let networkGuard:EtsyRequestAdmission|null=null;
    let cleanupWork:Promise<{sessionId:string;released:boolean;terminalReadback:boolean;observersDisposed:boolean}>|null=null;
    const active=()=>{bounded.throwIfAborted();if(invalid)return insightsFail(invalidReason);if(now()>=Date.parse(scope.expiresAt)||qualification&&now()>=Date.parse(qualification.expiresAt))return insightsFail('verification_expired_or_invalidated');};
    const admit=async(operation:'create'|'open'|'observe'|'accept')=>{active();await awaitRequestDeadline(input.admitStage(Object.freeze({operation,operationId:scope.operationId,scopeHash:authority.scopeHash,requestId:authority.requestId,workflowRunId:authority.workflowRunId})),bounded);active();};
    let closing=false;
    const cleanup=()=>cleanupWork??=(()=>{
      closing=true;networkGuard?.seal();
      return releaseEtsyTransportAndDispose({sessionId:scope.operationId,marked,
        release:()=>provider.releaseOwnerHandoffSession(scope.operationId,scope.providerProjectId),registerCleanup:input.registerCleanup,
        dispose:[()=>context?.unrouteAll({behavior:'wait'})??Promise.resolve(),
          ()=>Promise.all((context?.pages()??[]).map(p=>awaitRequestDeadline(p.removeAllListeners(undefined,{behavior:'wait'}),requestDeadline(1000)))),
          ()=>context?.removeAllListeners(undefined,{behavior:'wait'})??Promise.resolve(),
          ()=>networkGuard?.drain()??Promise.resolve(true),()=>cdp?.detach()??Promise.resolve(),
          async()=>{if(browser?.isConnected())await browser.close();return !browser?.isConnected();}],
      });
    })();
    const abort=()=>input.registerCleanup(cleanup().then(()=>undefined));bounded.addEventListener('abort',abort,{once:true});
    try{
      await admit('create');const q=await awaitRequestDeadline(input.qualifyRenderer(scope),bounded);
      if(q.version==='r12.etsy-insights-renderer-qualification.3')return insightsFail('renderer_verification_purpose_required');
      const landingV2=qualifiedLandingV2(q);
      if(q.requestHash!==authority.scopeHash||!insightsIsHash(q.qualificationHash)||!Number.isSafeInteger(q.maximumRequests)||q.maximumRequests<1||q.maximumRequests>512||Date.parse(q.expiresAt)>Date.parse(scope.expiresAt)||!Number.isFinite(Date.parse(q.expiresAt))||Date.parse(q.expiresAt)<=now())return insightsFail('renderer_policy_admission_required');
      const candidate=isEtsyInsightsVerificationCandidate(q.policy);if(candidate&&!landingV2)return insightsFail('renderer_candidate_landing_contract_required');
      const rendererPolicy=candidate?validateEtsyInsightsVerificationCandidate(q.policy):validateEtsyInsightsRendererPolicy(q.policy);
      const rendererHash=isEtsyInsightsVerificationCandidate(rendererPolicy)?etsyInsightsVerificationCandidateHash(rendererPolicy):etsyInsightsRendererPolicyHash(rendererPolicy);
      if(q.policyHash!==rendererHash||q.maximumRequests!==rendererPolicy.maximumRequests)return insightsFail('renderer_policy_invalid');
      qualification=frozen({...structuredClone(q),policy:rendererPolicy});active();
      const session=await provider.createInsightsSession(scope.operationId,scope.providerProjectId,scope.profileId,scope.maximumSessionMs,()=>{active();synchronousMarker(()=>input.beforeCreate(authority));marked=true;},bounded);
      const connection=connect(session.automationEndpoint,{timeout:20000});input.registerCleanup(connection.then(async b=>{if(bounded.aborted||closing){const release=cleanup();await awaitRequestDeadline(b.close(),requestDeadline(1000)).catch(()=>undefined);await release;}},()=>undefined));
      browser=await awaitRequestDeadline(connection,bounded);active();
      const contexts=browser.contexts();if(contexts.length!==1)return insightsFail('browser_context_unverified');context=contexts[0];
      if(context.pages().length>1||context.pages().some(p=>p.url()!=='about:blank')||context.serviceWorkers().length)return insightsFail('browser_context_unverified');
      page=context.pages()[0]??await awaitRequestDeadline(context.newPage(),bounded);await awaitRequestDeadline(page.setViewportSize({width:1280,height:900}),bounded);
      cdp=await awaitRequestDeadline(context.newCDPSession(page),bounded);
      context.on('serviceworker',()=>{invalid=true;abort();});context.on('page',p=>{if(p!==page){invalid=true;void p.close().catch(()=>undefined);}});
      page.on('framenavigated',f=>{if(f===page!.mainFrame()){epoch++;if(f.url()!==LANDING)invalid=true;}});
      await awaitRequestDeadline(context.routeWebSocket('**/*',s=>{invalid=true;s.close();}),bounded);
      await awaitRequestDeadline(context.route('**/*',async route=>{
        try{active();if(route.request().frame()!==page!.mainFrame())return insightsFail('navigation_denied');await route.continue();}
        catch{invalid=true;await route.abort('blockedbyclient').catch(()=>undefined);}
      }),bounded);
      networkGuard=await installEtsyRequestAdmission({cdp,signal:bounded,
        invalidate(reason){invalid=true;invalidReason=reason;},
        async admit(r){active();if(++requests>qualification!.maximumRequests)return insightsFail('renderer_request_limit');
          const policy=qualification!.policy;
          if(isEtsyInsightsVerificationCandidate(policy)){
            const {metadata,disposition}=classifyEtsyInsightsVerificationCandidateRequest(policy,r);
            const body={version:'etsy.insights-verification-renderer-request.3' as const,operationId:scope.operationId,requestId:authority.requestId,scopeHash:authority.scopeHash,qualificationHash:qualification!.qualificationHash,policyHash:etsyInsightsVerificationCandidateHash(policy),provenanceHash:policy.provenanceHash,sequence:requests,...metadata,disposition};
            await awaitRequestDeadline(input.admitRenderer(Object.freeze({...body,decisionHash:insightsHash(body)}),bounded),bounded);active();
            if(disposition==='deny_candidate_ancillary')return disposition;return;
          }
          const disposition=classifyEtsyInsightsRendererRequest(policy,r,null);
          const metadata=disposition==='deny_optional_telemetry'?{...r,url:new URL(r.url).origin+new URL(r.url).pathname}:r;
          const base={operationId:scope.operationId,requestId:authority.requestId,scopeHash:authority.scopeHash,qualificationHash:qualification!.qualificationHash,sequence:requests,...metadata};
          const request=policy.version==='etsy.insights-renderer-policy.2'?{...base,version:'etsy.insights-verification-renderer-request.2' as const,disposition,policyHash:etsyInsightsRendererPolicyHash(policy),provenanceHash:policy.provenanceHash}:{...base,version:'etsy.insights-verification-renderer-request.1' as const};
          await awaitRequestDeadline(input.admitRenderer(Object.freeze(request),bounded),bounded);active();
          if(disposition==='deny_optional_telemetry')return disposition;
        },
      });
      await admit('open');await awaitRequestDeadline(page.goto(LANDING,{waitUntil:'domcontentloaded',timeout:20000}),bounded);active();
      await admit('observe');
      const read=async()=>{
        if(page!.url()!==LANDING||await page!.getByRole('dialog').filter({visible:true}).count()||await page!.locator('input[type="password"]').filter({visible:true}).count())return insightsFail('verification_view_unavailable');
        const main=page!.locator(S.main),shop=page!.locator(S.shops),shopName=await literal(shop.locator(S.shopName),page!,bounded,120);
        if(await shop.count()!==1||shopName!==scope.expectedShopName)return insightsFail('account_mismatch');
        const href=await shop.getAttribute('href');let u:URL;try{u=new URL(href??'','https://www.etsy.com');}catch{return insightsFail('account_mismatch');}
        if(u.origin!=='https://www.etsy.com'||decodeURIComponent(u.pathname)!==`/shop/${shopName}`||u.search!=='?ref=seller-platform-mcnav')return insightsFail('account_mismatch');
        const heading=await literal(main.getByRole('heading',{name:'Marketplace Insights',exact:true}),page!,bounded,100);
        if(heading!=='Marketplace Insights')return insightsFail('insights_access_unverified');
        if(landingV2){const controls=await readEtsyInsightsLandingControls(page!,bounded,{visible,literal});
          return {observedShopName:shopName,observedShopId:null,visibleShopHref:u.href,canonicalUrl:page!.url(),insightsHeading:heading,queryControlWitnessHash:controls.witnessHash,documentEpoch:epoch};}
        const form=main.locator(S.form),field=form.locator(S.query),button=form.getByRole('button',{name:'Search',exact:true});
        await visible(form,page!,bounded);await visible(field,page!,bounded);await visible(button,page!,bounded);
        const witness={formAriaLabel:await form.getAttribute('aria-label'),inputAriaLabel:await field.getAttribute('aria-label'),inputType:await field.getAttribute('type'),
          buttonName:'Search',buttonType:await button.getAttribute('type'),formVisible:true,inputVisible:true,inputEnabled:await field.isEnabled(),buttonVisible:true,buttonEnabled:await button.isEnabled()};
        // Search's accessible name may be supplied by aria-labelledby rather
        // than visible text. The exact role/name locator above is the witness;
        // no hidden tooltip contents or input value is read to infer it.
        if(insightsHash(witness)!==insightsHash(ETSY_INSIGHTS_QUERY_CONTROL_WITNESS))return insightsFail('insights_control_unverified');
        return {observedShopName:shopName,observedShopId:null,visibleShopHref:u.href,canonicalUrl:page!.url(),insightsHeading:heading,queryControlWitnessHash:insightsHash(witness),documentEpoch:epoch};
      };
      const a=await read(),b=await read();active();if(insightsHash(a)!==insightsHash(b))return insightsFail('verification_epoch_changed');
      const pins={operationId:scope.operationId,setupOperationId:scope.setupOperationId,handoffId:scope.handoffId,profileBindingId:scope.profileBindingId,profileBindingRevision:scope.profileBindingRevision,
        providerProjectId:scope.providerProjectId,testEnvelopeId:scope.testEnvelopeId,testEnvelopeHash:scope.testEnvelopeHash,profileId:scope.profileId,sessionId:scope.operationId,contextId:randomUUID(),pageId:randomUUID()};
      const landingPins=landingV2?{landingControlsVersion:ETSY_INSIGHTS_LANDING_CONTROLS_VERSION,landingControlsHash:ETSY_INSIGHTS_LANDING_CONTROLS_HASH}:{};
      const contextProof={version:landingV2?'etsy.steel-visible-account-context.2':'etsy.steel-visible-account-context.1',...pins,...a,...landingPins,verifiedAt:new Date(now()).toISOString()};
      const body={...(landingV2?{version:'etsy.steel-account-verification.2' as const,landingControlsVersion:ETSY_INSIGHTS_LANDING_CONTROLS_VERSION,landingControlsHash:ETSY_INSIGHTS_LANDING_CONTROLS_HASH}:{version:'etsy.steel-account-verification.1' as const}),...pins,...a,observedShopId:null,verifiedAt:contextProof.verifiedAt,expiresAt:scope.profileAccessExpiresAt,
        accountIdentityVerified:true as const,insightsAccessVerified:true as const,verifiedContextHash:insightsHash(contextProof)};
      proof={...body,verificationHash:insightsHash(body)};
    }catch(error){reason=signal.aborted?'stopped':invalid?invalidReason:error instanceof EtsyInsightsFailure?error.reason:'verification_unconfirmed';proof=null;}
    const pendingCleanup=cleanup();input.registerCleanup(pendingCleanup.then(()=>undefined));
    let cleanupTimer:ReturnType<typeof setTimeout>|undefined;
    const release=await Promise.race([pendingCleanup,new Promise<{sessionId:string;released:boolean;terminalReadback:boolean;observersDisposed:boolean}>(resolve=>{cleanupTimer=setTimeout(()=>resolve({sessionId:scope.operationId,released:false,terminalReadback:false,observersDisposed:false}),5000);})]);
    clearTimeout(cleanupTimer);bounded.removeEventListener('abort',abort);
    if(!release.released||!release.terminalReadback||!release.observersDisposed){proof=null;reason='release_unconfirmed';}
    if(proof){try{await admit('accept');reason='verified';}catch{proof=null;reason='verification_authority_expired_or_revoked';}}
    return{status:proof?'verified':'paused',reason,verification:proof,release};
  }};
}
