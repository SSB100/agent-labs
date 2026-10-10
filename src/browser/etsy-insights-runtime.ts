import { ETSY_INSIGHTS_RECEIPT_VERSION, type EtsyInsightsScope, type EtsyInsightsDependencies, type EtsyInsightsRunResult,
  type EtsyInsightsSession, type EtsyInsightsIdentity, type EtsyInsightsAdmission, type EtsyInsightsOperation, type EtsyInsightsAdmissionRequest,
  type EtsyInsightsObservedPage, type EtsyInsightsReceipt, type EtsyInsightsCapture, type EtsyInsightsScreenshotStorage } from './etsy-insights-contracts';
import { EtsyInsightsFailure, insightsFail as fail, insightsHash as hash, insightsExact as exact, insightsUuid as uuid, insightsIsHash as isHash,
  validateEtsyInsightsScope, validateEtsyInsightsPage, buildEtsyInsightsCapture, validateEtsyInsightsStorage, etsyInsightsWitnesses, validateEtsyInsightsReceipt } from './etsy-insights-policy';
const CLEANUP_MS=5000;
function immutable<T>(raw:T):Readonly<T>{const v=structuredClone(raw);function freeze(x:unknown){if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}}freeze(v);return v;}
/** Injected trusted orchestration. Admission/storage/receipt functions must be
 * authenticated server ports. Shape hashes alone never confer authority. */
export async function runEtsyInsightsResearch(raw:EtsyInsightsScope,d:EtsyInsightsDependencies):Promise<EtsyInsightsRunResult>{
  const now=d?.now??Date.now,mono=d?.monotonic??(()=>performance.now()),scope=validateEtsyInsightsScope(raw,now(),true),requestHash=hash(scope);
  if(!d||![d.admit,d.createSession,d.storeScreenshot,d.recordRelease,d.recordReceipt,d.registerCleanup].every(f=>typeof f==='function')||!(d.signal instanceof AbortSignal))return fail('insights_admission_required');
  let complete!:()=>void;const completion=new Promise<void>(resolve=>{complete=resolve;});
  try{d.registerCleanup(completion);}catch{complete();return fail('hosting_unavailable');}
  const controller=new AbortController(),deadline=mono()+Math.min(scope.limits.maximumSessionMs,Date.parse(scope.expiresAt)-now());
  const stop=()=>controller.abort();d.signal.addEventListener('abort',stop,{once:true});if(d.signal.aborted)stop();
  const timer=setTimeout(stop,Math.max(0,deadline-mono()));
  let session:EtsyInsightsSession|null=null,creation:Promise<EtsyInsightsSession>|null=null,identity:EtsyInsightsIdentity|null=null;
  let reservation:EtsyInsightsAdmission|null=null,dispatched=false,sequence=0,actionsUsed=0;
  let status:EtsyInsightsReceipt['status']='completed',reason='completed';
  let releaseState:EtsyInsightsReceipt['releaseState']='not_required',liabilityState:EtsyInsightsReceipt['liabilityState']='not_dispatched';
  const captures:EtsyInsightsCapture[]=[];let screenshotStorage:EtsyInsightsScreenshotStorage|null=null;
  function active(){
    if(identity&&session&&(Object.entries(identity).some(([k,v])=>session![k as keyof EtsyInsightsSession]!==v)||session.persistProfile!==false))return fail('source_invalidated');
    if(d.signal.aborted)return fail('stopped');
    if(controller.signal.aborted||mono()>=deadline||now()>=Date.parse(scope.expiresAt)||now()>=Date.parse(scope.accountBinding.expiresAt)||now()<Date.parse(scope.accountBinding.verifiedAt))return fail('expired');
  }
  async function work<T>(fn:()=>Promise<T>):Promise<T>{
    active();let abort!:()=>void;
    const cancelled=new Promise<never>((_,reject)=>{abort=()=>reject(new EtsyInsightsFailure(d.signal.aborted?'stopped':'expired'));controller.signal.addEventListener('abort',abort,{once:true});});
    try{const result=await Promise.race([Promise.resolve().then(()=>{active();return fn();}),cancelled]);active();return result;}
    finally{controller.signal.removeEventListener('abort',abort);}
  }
  async function permit(operation:EtsyInsightsOperation,page:EtsyInsightsObservedPage|null=null,targetId:string|null=null,captureHash:string|null=null){
    active();const request:EtsyInsightsAdmissionRequest={version:'r12.etsy-insights-source-admission.1',operation,sequence:sequence++,operationId:scope.operationId,sourceAttemptId:scope.sourceAttemptId,requestHash,
      businessId:scope.businessId,goalId:scope.goalId,authorityRootId:scope.authorityRootId,scopeId:scope.scopeId,scopeHash:scope.scopeHash,providerProjectId:scope.providerProjectId,
      originDirectRunId:scope.originDirectRunId,windowId:scope.window.windowId,windowOrdinal:scope.window.windowOrdinal,windowAttemptOrdinal:scope.windowAttemptOrdinal,attemptOrdinal:scope.attemptOrdinal,
      criteriaHash:scope.criteriaHash,questionHash:scope.questionHash,quoteHash:scope.quoteHash,executionQuoteHash:scope.executionQuoteHash,executionQuoteProofHash:scope.executionQuoteProofHash,sourcePolicyHash:scope.sourcePolicyHash,capturePolicyHash:scope.capturePolicyHash,
      accountBindingHash:scope.accountBinding.bindingHash,accountVerificationHash:scope.accountBinding.accountVerificationHash,maximumBrowserMicrounits:scope.maximumBrowserMicrounits,
      sessionId:identity?.sessionId??null,contextId:identity?.contextId??null,pageId:identity?.pageId??null,documentEpoch:page?.documentEpoch??null,targetId,captureHash};
    let p:EtsyInsightsAdmission;
    try{p=structuredClone(await work(()=>d.admit(immutable(request))));}catch(e){if(e instanceof EtsyInsightsFailure)throw e;return fail('admission_denied');}
    if(!exact(p,'version,admissionHash,reservationId,reservationHash,reservedBrowserMicrounits,expiresAt')||p.version!=='r12.etsy-insights-source-permit.1'||p.admissionHash!==hash(request)||
      !uuid(p.reservationId)||!isHash(p.reservationHash)||p.reservedBrowserMicrounits!==scope.maximumBrowserMicrounits||typeof p.expiresAt!=='string'||!Number.isFinite(Date.parse(p.expiresAt))||
      Date.parse(p.expiresAt)<=now()||Date.parse(p.expiresAt)>Math.min(now()+30000,Date.parse(scope.expiresAt))||reservation&&(p.reservationId!==reservation.reservationId||p.reservationHash!==reservation.reservationHash))return fail('admission_proof_invalid');
    reservation=p;return p;
  }
  function current(p:EtsyInsightsAdmission){active();if(now()>=Date.parse(p.expiresAt))return fail('admission_expired');}
  async function action<T>(op:EtsyInsightsOperation,fn:()=>Promise<T>,page:EtsyInsightsObservedPage|null=null,target:string|null=null){
    if(actionsUsed>=scope.limits.maximumActions)return fail('action_limit');const p=await permit(op,page,target);current(p);actionsUsed++;return work(()=>{current(p);return fn();});
  }
  async function observe(){const p=await permit('observe');return validateEtsyInsightsPage(await work(()=>{current(p);return session!.observeAggregateView(controller.signal);}),scope,identity!);}
  let cleanupSessionId:string|null=null;
  try{
    const create=await permit('create');current(create);dispatched=true;releaseState='unconfirmed';liabilityState='unknown';
    creation=Promise.resolve().then(()=>{current(create);return d.createSession(immutable(scope),controller.signal);});
    session=await work(()=>creation!);
    if(!session||![session.sessionId,session.contextId,session.pageId].every(uuid)||session.profileBindingId!==scope.accountBinding.profileBindingId||
      session.profileBindingRevision!==scope.accountBinding.profileBindingRevision||session.providerProjectId!==scope.providerProjectId||session.accountBindingHash!==scope.accountBinding.bindingHash||session.persistProfile!==false||
      ![session.openApprovedInsights,session.observeAggregateView,session.submitObservedQuery,session.captureSameEpoch,session.close].every(f=>typeof f==='function'))return fail('session_identity_invalid');
    identity=Object.freeze({sessionId:session.sessionId,contextId:session.contextId,pageId:session.pageId,providerProjectId:session.providerProjectId,profileBindingId:session.profileBindingId,
      profileBindingRevision:session.profileBindingRevision,accountBindingHash:session.accountBindingHash});
    await action('open_insights',()=>session!.openApprovedInsights(controller.signal));
    let page=await observe();if(page.view!=='landing'||!page.queryControl)return fail('insights_query_unavailable');
    await action('submit_query',()=>session!.submitObservedQuery(page.queryControl!.id,page.documentEpoch,scope.query,controller.signal),page,page.queryControl.id);
    page=await observe();if(page.view!=='results')return fail('query_changed');
    const frame=structuredClone(await action('capture',()=>session!.captureSameEpoch(page.documentEpoch,controller.signal),page));
    const after=await observe();if(after.documentEpoch!==page.documentEpoch||after.url!==page.url)return fail('capture_epoch_mismatch');
    const capture=buildEtsyInsightsCapture(frame,page,scope,now()),accept=await permit('accept_capture',page,null,capture.captureHash);current(accept);
    const storage=validateEtsyInsightsStorage(await work(()=>{current(accept);return d.storeScreenshot(immutable(capture),Uint8Array.from(frame.screenshot),controller.signal);}),capture);
    const final=await observe();if(final.documentEpoch!==page.documentEpoch||final.url!==page.url)return fail('capture_epoch_mismatch');
    captures.push(capture);screenshotStorage=storage;
  }catch(e){status='paused';reason=e instanceof EtsyInsightsFailure?e.reason:'source_operation_failed';captures.length=0;screenshotStorage=null;}
  finally{
    clearTimeout(timer);controller.abort();d.signal.removeEventListener('abort',stop);
    const end=performance.now()+CLEANUP_MS;
    const bounded=async<T>(fn:()=>Promise<T>):Promise<T|null>=>{const left=end-performance.now();if(left<=0)return null;let t:ReturnType<typeof setTimeout>|undefined;
      try{return await Promise.race([Promise.resolve().then(fn),new Promise<null>(resolve=>{t=setTimeout(()=>resolve(null),left);})]);}catch{return null;}finally{clearTimeout(t);}};
    if(!session&&creation)session=await bounded(()=>creation!);
    cleanupSessionId=identity?.sessionId??(uuid(session?.sessionId)?session.sessionId:null);
    if(cleanupSessionId&&session&&typeof session.close==='function'){
      const closed=await bounded(()=>session!.close(cleanupSessionId!));
      if(closed?.sessionId===cleanupSessionId&&closed.released===true&&closed.terminalReadback===true&&closed.observersDisposed===true){releaseState='verified';liabilityState='receipt_required';}
    }else if(creation){
      // A late create is never another attempt. Teardown may still be attempted,
      // but the already unknown ledger liability needs authenticated recovery.
      d.registerCleanup(creation.then(async late=>{if(uuid(late?.sessionId)&&typeof late.close==='function')await late.close(late.sessionId).catch(()=>undefined);},()=>undefined));
    }
    if(dispatched){const saved=await bounded(async()=>{await d.recordRelease({operationId:scope.operationId,sourceAttemptId:scope.sourceAttemptId,reservationId:reservation?.reservationId??null,sessionId:cleanupSessionId,verified:releaseState==='verified'});return true;});
      if(!saved){releaseState='unconfirmed';liabilityState='unknown';}}
    if(releaseState==='unconfirmed'){status='paused';reason='release_unconfirmed';captures.length=0;screenshotStorage=null;}
  }
  const savedReservation=reservation as EtsyInsightsAdmission|null;
  const body:Omit<EtsyInsightsReceipt,'receiptHash'>={version:ETSY_INSIGHTS_RECEIPT_VERSION,operationId:scope.operationId,sourceAttemptId:scope.sourceAttemptId,requestHash,
    businessId:scope.businessId,goalId:scope.goalId,authorityRootId:scope.authorityRootId,scopeId:scope.scopeId,scopeHash:scope.scopeHash,providerProjectId:scope.providerProjectId,
    originDirectRunId:scope.originDirectRunId,windowId:scope.window.windowId,windowOrdinal:scope.window.windowOrdinal,windowAttemptOrdinal:scope.windowAttemptOrdinal,
    maximumAttemptsInWindow:scope.window.maximumAttemptsInWindow,baseAttemptsStarted:scope.window.baseAttemptsStarted,attemptOrdinal:scope.attemptOrdinal,
    criteriaHash:scope.criteriaHash,questionHash:scope.questionHash,quoteHash:scope.quoteHash,executionQuoteHash:scope.executionQuoteHash,executionQuoteProofHash:scope.executionQuoteProofHash,sourcePolicyHash:scope.sourcePolicyHash,capturePolicyHash:scope.capturePolicyHash,
    accountBindingHash:scope.accountBinding.bindingHash,accountVerificationHash:scope.accountBinding.accountVerificationHash,maximumBrowserMicrounits:scope.maximumBrowserMicrounits,
    status,reason,capturedAt:new Date(now()).toISOString(),captureHash:hash(captures),captures,witnesses:etsyInsightsWitnesses(captures),screenshotStorage,
    releaseState,liabilityState,reservationId:savedReservation?.reservationId??null,reservationHash:savedReservation?.reservationHash??null,sessionId:cleanupSessionId,actionsUsed};
  let receipt:EtsyInsightsReceipt;
  try{receipt=validateEtsyInsightsReceipt({...body,receiptHash:hash(body)},scope);}catch(error){complete();throw error;}
  let persisted=false,t:ReturnType<typeof setTimeout>|undefined;
  try{const ack=await Promise.race([Promise.resolve().then(()=>d.recordReceipt(immutable(receipt))),new Promise<null>(resolve=>{t=setTimeout(()=>resolve(null),CLEANUP_MS);})]);
    persisted=!!ack&&exact(ack,'receiptHash,persisted')&&ack.persisted===true&&ack.receiptHash===receipt.receiptHash;
  }catch{/* Missing immutable receipt readback blocks a new attempt. */}finally{clearTimeout(t);complete();}
  return {receipt,persistence:persisted?'verified':'unconfirmed'};
}
