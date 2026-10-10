import type {SteelCreateConfigurationGuard} from './etsy-steel-create-binding';
import {SteelBrowserAdapter,type SteelConfig} from './providers/steel';
import {createEtsyInsightsPlaywrightPort,type EtsyInsightsPlaywrightPortInput} from './etsy-insights-playwright';
import {runEtsyInsightsResearch} from './etsy-insights-runtime';
import type {EtsyInsightsScope,EtsyInsightsDependencies,EtsyInsightsRunResult,EtsyInsightsSession,EtsyInsightsReceipt} from './etsy-insights-contracts';
import {validateEtsyInsightsScope,insightsHash as hash,insightsExact as exact,insightsIsHash as isHash,insightsFail as fail} from './etsy-insights-policy';
import {recordEtsySteelBoundedPending} from './etsy-steel-accounting';
import {awaitRequestDeadline,requestDeadline} from '../core/request-deadline';
import type {TransportAdmission} from '../core/transport-admission';

type SourceOperation='source_admit'|'resolve_source'|'qualify_renderer'|'admit_renderer'|'source_transport'|'source_screenshot'|'source_receipt'|'source_finish'|'cleanup_complete';
type LedgerOperation='read'|'bind_session'|'receipt'|'evidence'|'reconcile';
type Release=Awaited<ReturnType<EtsyInsightsSession['close']>>;
type Usage=Awaited<ReturnType<SteelBrowserAdapter['retrieveScopedTerminalUsage']>>;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function check(value:unknown,reason:string):asserts value {if(!value)fail(reason);}
const freeze=<T>(raw:T):Readonly<T>=>{const value=structuredClone(raw);const visit=(v:unknown)=>{if(v&&typeof v==='object'){Object.values(v).forEach(visit);Object.freeze(v);}};visit(value);return value;};
export type EtsyInsightsRpcRuntimeInput={
 /** These closures must already be authenticated and pinned to the immutable
  * Business/scope/attempt and source/evidence purpose keys. No user/model JSON
  * can supply keys, qualify a route, enroll authority or select a profile. */
 scope:EtsyInsightsScope;routeHash:string;createConfigurationGuard?:SteelCreateConfigurationGuard;
 sourceRpc(operation:SourceOperation,payload:Record<string,unknown>):Promise<unknown>;
 ledgerRpc(operation:LedgerOperation,payload:Record<string,unknown>):Promise<unknown>;
 signal:AbortSignal;registerCleanup(work:Promise<void>):void;
 config?:SteelConfig;fetcher?:typeof fetch;connect?:EtsyInsightsPlaywrightPortInput['connect'];now?:()=>number;monotonic?:()=>number;
};
export type EtsyInsightsRpcRunResult={run:EtsyInsightsRunResult;accounting:'qualified_bounded_pending'|'unconfirmed'|'not_attempted';completion:Record<string,unknown>|null};

/** Actual default Steel + confined Playwright composition, with inert transport
 * injection for tests. No alternate create path, implicit retry or paid fallback.
 * A stopped attempt can still persist receipts/read usage through cleanup keys. */
export function createEtsyInsightsRpcRuntime(input:EtsyInsightsRpcRuntimeInput){
 const scope=freeze(validateEtsyInsightsScope(input.scope,(input.now??Date.now)(),true)),requestHash=hash(scope);
 check(isHash(input.routeHash)&&typeof input.sourceRpc==='function'&&typeof input.ledgerRpc==='function'&&typeof input.registerCleanup==='function'&&input.signal instanceof AbortSignal,'insights_rpc_configuration_required');
 check(!input.createConfigurationGuard||input.createConfigurationGuard.scopeHash===requestHash,'insights_create_configuration_scope_changed');
 let ran=false,reserved=false,dispatchReady=false,dispatchConsumed=false;
 let closed:Release|null=null,usage:Usage|null=null,releaseEvidenceHash:string|null=null,disposalProofHash:string|null=null;
 let accounting:EtsyInsightsRpcRunResult['accounting']='not_attempted',persistedReceiptHash:string|null=null;
 const rpc=async(operation:SourceOperation,payload:Record<string,unknown>,cleanup=false)=>{
  const signal=cleanup?requestDeadline(10000):AbortSignal.any([input.signal,requestDeadline(10000)]);
  return awaitRequestDeadline(Promise.resolve().then(()=>input.sourceRpc(operation,payload)),signal);
 };
 const ledger=async(operation:LedgerOperation,payload:Record<string,unknown>)=>awaitRequestDeadline(Promise.resolve().then(()=>input.ledgerRpc(operation,payload)),requestDeadline(10000));
 const transport:TransportAdmission=async request=>{
  const cleanup=['browser.etsy.session.release','browser.etsy.session.release_readback'].includes(request.operation);
  const result=await rpc('source_transport',{attemptId:scope.sourceAttemptId,request},cleanup);
  check(exact(result,'allowed,operationId')&&result.allowed===true&&result.operationId===scope.operationId,'insights_transport_unconfirmed');
  if(request.operation==='browser.etsy.insights.create'){
   check(reserved&&!dispatchReady&&!dispatchConsumed,'insights_create_replayed');dispatchReady=true;
  }
 };
 const provider=new SteelBrowserAdapter({config:input.config,fetcher:input.fetcher,createConfigurationGuard:input.createConfigurationGuard,admitDispatch:transport});
 async function bindSession(){
  const read=await ledger('read',{});
  check(object(read)&&read.operationId===scope.operationId&&read.requestHash===requestHash&&read.operationMaximumMicrounits===scope.maximumBrowserMicrounits&&object(read.qualification),'insights_browser_ledger_mismatch');
  const q=read.qualification;
  check(q.providerProjectId===scope.providerProjectId&&q.routeHash===input.routeHash&&isHash(q.providerAccountHash),'insights_browser_route_mismatch');
  const result=await ledger('bind_session',{sessionId:scope.operationId,providerProjectId:scope.providerProjectId,providerAccountHash:q.providerAccountHash});
  check(object(result)&&result.operationId===scope.operationId&&isHash(result.usageIdentityHash),'insights_session_binding_unconfirmed');
 }
 const port=createEtsyInsightsPlaywrightPort({providerProjectId:scope.providerProjectId,config:input.config,fetcher:input.fetcher,connect:input.connect,now:input.now,registerCleanup:input.registerCleanup,createConfigurationGuard:input.createConfigurationGuard,admitDispatch:transport,
  async resolveAttempt(actual){
   check(hash(actual)===requestHash,'insights_scope_changed');const result=await rpc('resolve_source',{attemptId:scope.sourceAttemptId});
   check(exact(result,'sourceAttemptId,requestHash,sessionId,profileId,providerProjectId,accountBindingHash,profileBindingId,profileBindingRevision'),'insights_profile_resolution_unconfirmed');
   return result as Awaited<ReturnType<EtsyInsightsPlaywrightPortInput['resolveAttempt']>>;
  },
  beforeCreate(actual,sessionId){input.signal.throwIfAborted();check(hash(actual)===requestHash&&sessionId===scope.operationId&&reserved&&dispatchReady&&!dispatchConsumed,'insights_create_unadmitted');dispatchConsumed=true;dispatchReady=false;},
  async qualifyRenderer(actual){
   check(hash(actual)===requestHash,'insights_scope_changed');const result=await rpc('qualify_renderer',{attemptId:scope.sourceAttemptId});
   check(exact(result,object(result)&&result.version==='r12.etsy-insights-renderer-qualification.3'?'version,requestHash,qualificationHash,expiresAt,maximumRequests,policy,policyHash,landingControlsVersion,landingControlsHash,readiness':object(result)&&result.version==='r12.etsy-insights-renderer-qualification.2'?'version,requestHash,qualificationHash,expiresAt,maximumRequests,policy,policyHash,landingControlsVersion,landingControlsHash':'version,requestHash,qualificationHash,expiresAt,maximumRequests,policy,policyHash'),'insights_renderer_qualification_unconfirmed');
   const {qualificationHash,...body}=result;check(qualificationHash===hash(body),'insights_renderer_qualification_unconfirmed');
   return result as Awaited<ReturnType<EtsyInsightsPlaywrightPortInput['qualifyRenderer']>>;
  },
  async admitRenderer(request){
   const result=await rpc('admit_renderer',{attemptId:scope.sourceAttemptId,request});
   if(request.version==='r12.etsy-insights-renderer-request.3'){
    check(exact(result,'accepted,allowed,sequence,disposition,decisionHash,qualificationHash,policyHash,provenanceHash')&&result.accepted===true&&result.allowed===(request.disposition==='allow')&&result.sequence===request.sequence&&result.disposition===request.disposition&&result.decisionHash===request.decisionHash&&result.qualificationHash===request.qualificationHash&&result.policyHash===request.policyHash&&result.provenanceHash===request.provenanceHash,'insights_renderer_admission_unconfirmed');
   }else if(request.version==='r12.etsy-insights-renderer-request.2'){
    // Acknowledgment records a decision; it never turns a blocked telemetry
    // request into network permission. The port must still await failRequest.
    check(exact(result,'accepted,allowed,sequence,disposition')&&result.accepted===true&&result.allowed===(request.disposition==='allow')&&result.sequence===request.sequence&&result.disposition===request.disposition,'insights_renderer_admission_unconfirmed');
   }else check(exact(result,'allowed,sequence')&&result.allowed===true&&result.sequence===request.sequence,'insights_renderer_admission_unconfirmed');
  },
 });
 async function actualReleaseEvidence(){
  check(closed&&closed.sessionId===scope.operationId&&closed.released&&closed.terminalReadback&&closed.observersDisposed,'insights_disposal_unconfirmed');
  await bindSession();
  // One whitelisted provider readback is reused verbatim for both evidence and
  // reconciliation, so a later duration update cannot create conflicting joins.
  usage??=freeze(await provider.retrieveScopedTerminalUsage(scope.operationId,scope.providerProjectId,requestDeadline(10000)));
  disposalProofHash??=hash({version:'r12.etsy-insights-disposal-proof.1',operationId:scope.operationId,sourceAttemptId:scope.sourceAttemptId,requestHash,providerProjectId:scope.providerProjectId,...closed});
  const providerReadbackHash=hash(usage),content={operationId:scope.operationId,sessionId:scope.operationId,providerProjectId:scope.providerProjectId,
   terminal:true,observersDisposed:true,providerStatus:usage.providerStatus,providerReadbackHash,disposalProofHash};
  const stored=await ledger('evidence',{kind:'release',providerRecordId:`steel-release:${scope.operationId}:${providerReadbackHash}`,content});
  check(object(stored)&&stored.evidenceHash===hash(content),'insights_release_evidence_unconfirmed');releaseEvidenceHash=stored.evidenceHash as string;
  const ack=await rpc('cleanup_complete',{attemptId:scope.sourceAttemptId,releaseEvidenceHash},true);
  check(exact(ack,'releaseVerified,billingStillRequiresLedger')&&ack.releaseVerified===true&&ack.billingStillRequiresLedger===true,'insights_cleanup_record_unconfirmed');
 }
 async function persistReceipt(receipt:Readonly<EtsyInsightsReceipt>){
  check(receipt.operationId===scope.operationId&&receipt.sourceAttemptId===scope.sourceAttemptId&&receipt.requestHash===requestHash,'insights_receipt_binding_changed');
  const write=rpc('source_receipt',{attemptId:scope.sourceAttemptId,receipt},true);
  input.registerCleanup(write.then(()=>undefined,()=>undefined));
  const ack=await write;
  check(exact(ack,'receiptHash,persisted')&&ack.receiptHash===receipt.receiptHash&&ack.persisted===true,'insights_receipt_persistence_unconfirmed');
  persistedReceiptHash=receipt.receiptHash;return{receiptHash:receipt.receiptHash,persisted:true as const};
 }
 const d:EtsyInsightsDependencies={signal:input.signal,registerCleanup:input.registerCleanup,now:input.now,monotonic:input.monotonic,
  async admit(request){
   if(request.operation==='create')check(!reserved&&!dispatchConsumed,'insights_create_replayed');
   const permit=await rpc('source_admit',{request});if(request.operation==='create')reserved=true;
   return permit as Awaited<ReturnType<EtsyInsightsDependencies['admit']>>;
  },
  async createSession(actual,signal){
   const session=await port.createSession(actual,signal);
   const tracked=Object.freeze({...session,async close(sessionId:string){const result=await session.close(sessionId);check(exact(result,'sessionId,released,terminalReadback,observersDisposed')&&result.sessionId===scope.operationId,'insights_close_identity_changed');closed=freeze(result);return result;}});
   try{await bindSession();signal.throwIfAborted();return tracked;}
   catch(error){input.registerCleanup(tracked.close(scope.operationId).then(()=>undefined,()=>undefined));throw error;}
  },
  async storeScreenshot(capture,bytes,signal){
   signal.throwIfAborted();check(bytes.byteLength<=scope.limits.maximumScreenshotBytes,'insights_png_bound');
   return await rpc('source_screenshot',{attemptId:scope.sourceAttemptId,capture,bytesBase64:Buffer.from(bytes).toString('base64')}) as Awaited<ReturnType<EtsyInsightsDependencies['storeScreenshot']>>;
  },
  async recordRelease(event){
   check(event.operationId===scope.operationId&&event.sourceAttemptId===scope.sourceAttemptId,'insights_release_binding_changed');
   if(event.verified){check(event.sessionId===scope.operationId,'insights_release_binding_changed');const work=actualReleaseEvidence();input.registerCleanup(work.then(()=>undefined,()=>undefined));await work;}
  },
  recordReceipt:persistReceipt,
 };
 async function finishRecorded(){
  const result=await rpc('source_finish',{attemptId:scope.sourceAttemptId},true);
  check(object(result)&&result.recorded===true&&isHash(result.receiptHash)&&(!persistedReceiptHash||result.receiptHash===persistedReceiptHash)&&object(result.state),'insights_finish_unconfirmed');
  return result;
 }
 return{
  /** Read/reconcile the already-recorded attempt only. SQL remains authoritative
   * about qualified accounting; this cannot reserve or dispatch a fresh session. */
  finishRecorded,
  async run():Promise<EtsyInsightsRpcRunResult>{
   check(!ran,'insights_run_replayed');ran=true;
   let settled!:()=>void;const completionWork=new Promise<void>(resolve=>{settled=resolve;});
   try{input.registerCleanup(completionWork);}catch{settled();return fail('hosting_unavailable');}
   try{
    const run=await runEtsyInsightsResearch(scope,d);let completion:Record<string,unknown>|null=null;
    if(run.persistence==='verified'&&run.receipt.releaseState==='verified'&&closed&&usage&&disposalProofHash&&releaseEvidenceHash){
     accounting='unconfirmed';
     try{
      const result=await recordEtsySteelBoundedPending({operationId:scope.operationId,providerProjectId:scope.providerProjectId,routeHash:input.routeHash,
       requestedTimeoutMs:scope.limits.maximumSessionMs,maximumMicrounits:scope.maximumBrowserMicrounits,terminalReceipt:run.receipt,
       release:{...closed,disposalProofHash},extraServicesDisabled:dispatchConsumed,
       readUsage:async(sessionId,projectId)=>{check(sessionId===scope.operationId&&projectId===scope.providerProjectId&&usage,'insights_readback_binding_changed');return usage;},rpc:ledger});
      if(result.accepted){accounting='qualified_bounded_pending';completion=await finishRecorded();}
     }catch{/* Persisted receipt/evidence remains recoverable; no retry or new create. */}
    }
    return{run,accounting,completion};
   }finally{settled();}
  },
 };
}
