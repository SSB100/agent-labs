import type { CDPSession } from 'playwright-core';
import { awaitRequestDeadline, requestDeadline } from '../core/request-deadline';

export type EtsyRequestMetadata = Readonly<{url:string;method:string;resourceType:string;navigation:boolean}>;
export type EtsyRequestAdmission = { seal():void; drain():Promise<boolean> };

/** Request-stage CDP admission is deliberately separate from Playwright routing:
 * Playwright routes only the original request in an HTTP redirect chain. Fetch
 * pauses every hop BEFORE dispatch; redirect successors are always denied here.
 * The callback gets only URL/method/type, never headers, bodies or credentials.
 * Related workers/frames are paused at creation and closed without resuming.
 * Install on the sole blank page before navigation. Callers must also reject
 * unexpected pages with context routing before their original request dispatch.
 * Do not detach/disable this guard while provider release is still uncertain. */
export async function installEtsyRequestAdmission(input:{cdp:CDPSession;signal:AbortSignal;
  admit(request:EtsyRequestMetadata):Promise<void|'deny_optional_telemetry'|'deny_owner_subresource'|'deny_candidate_ancillary'>;invalidate(reason:string):void}):Promise<EtsyRequestAdmission>{
  const {cdp,signal}=input;
  let sealed=false, disposalFailed=false;
  let admissions:Promise<void>=Promise.resolve();
  const pending=new Set<Promise<void>>();
  const track=(work:Promise<void>)=>{pending.add(work);void work.finally(()=>pending.delete(work)).catch(()=>undefined);return work;};
  const deny=(reason:string)=>{sealed=true;try{input.invalidate(reason);}catch{disposalFailed=true;}};
  const send=(method:'Fetch.failRequest',requestId:string)=>cdp.send(method,{requestId,errorReason:'BlockedByClient'}).then(()=>undefined);
  const tree=await awaitRequestDeadline(cdp.send('Page.getFrameTree'),signal);
  const mainFrameId=tree.frameTree.frame.id;
  if(!mainFrameId)throw Error('renderer_main_frame_unverified');
  const paused=(e:{requestId:string;frameId:string;resourceType:string;redirectedRequestId?:string;request:{url:string;method:string}})=>{
    return track((async()=>{
      try{
        signal.throwIfAborted();
        if(sealed)throw Error('renderer_admission_closed');
        if(e.redirectedRequestId)throw Error('renderer_redirect_denied');
        const navigation=e.resourceType==='Document';
        if(e.frameId!==mainFrameId)throw Error('renderer_child_frame_denied');
        const request=Object.freeze({url:e.request.url,method:e.request.method,resourceType:e.resourceType.toLowerCase(),navigation});
        // Renderer requests arrive concurrently, but durable authority decisions
        // are one ordered stream. Strict next-sequence SQL can reject replay
        // without racing two legitimate assets against the same sequence head.
        const decision=admissions.then(async()=>{
          try{signal.throwIfAborted();if(sealed)throw Error('renderer_admission_closed');return await input.admit(request);}
          catch(error){sealed=true;throw error;}
        });
        admissions=decision.then(()=>undefined,()=>undefined);
        const disposition=await awaitRequestDeadline(decision,signal);
        signal.throwIfAborted();if(sealed)throw Error('renderer_admission_closed');
        if(disposition==='deny_optional_telemetry'||disposition==='deny_owner_subresource'||disposition==='deny_candidate_ancillary'){
          // A reviewed blocked dependency is never continued. Its
          // failure acknowledgement is required before the request is settled.
          await awaitRequestDeadline(send('Fetch.failRequest',e.requestId),signal);
        }else if(disposition===undefined)await awaitRequestDeadline(cdp.send('Fetch.continueRequest',{requestId:e.requestId}),signal);
        else throw Error('renderer_request_denied');
      }catch(error){
        // Never expose provider/authority error text, which may contain secrets.
        const safe=error instanceof Error&&/^(renderer_(?:admission_closed|redirect_denied|child_frame_denied|request_limit|request_denied|navigation_denied|asset_blocked|private_path_denied|query_mismatch))$/.test(error.message)?error.message:'renderer_request_denied';
        deny(safe);
        await awaitRequestDeadline(send('Fetch.failRequest',e.requestId),requestDeadline(1000)).catch(()=>{disposalFailed=true;});
      }
    })());
  };
  const auth=(e:{requestId:string})=>{
    deny('renderer_authentication_denied');
    track(awaitRequestDeadline(cdp.send('Fetch.continueWithAuth',{requestId:e.requestId,authChallengeResponse:{response:'CancelAuth'}}),requestDeadline(1000)).then(()=>undefined,()=>{disposalFailed=true;}));
  };
  const child=(e:{targetInfo:{targetId:string}})=>{
    deny('renderer_child_target_denied');
    track(awaitRequestDeadline(cdp.send('Target.closeTarget',{targetId:e.targetInfo.targetId}),requestDeadline(1000)).then(r=>{if(r.success!==true)disposalFailed=true;},()=>{disposalFailed=true;}));
  };
  cdp.on('Fetch.requestPaused',paused);cdp.on('Fetch.authRequired',auth);cdp.on('Target.attachedToTarget',child);
  await awaitRequestDeadline(cdp.send('Network.setBypassServiceWorker',{bypass:true}),signal);
  await awaitRequestDeadline(cdp.send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true}),signal);
  await awaitRequestDeadline(cdp.send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}],handleAuthRequests:true}),signal);
  return Object.freeze({seal(){sealed=true;},async drain(){
    sealed=true;
    const deadline=requestDeadline(1000);
    try{
      // New request/child-close work may arrive while an older snapshot drains.
      // Callers perform a second drain after physical disconnect as well, so a
      // late event cannot be mistaken for an observer-free owner handoff.
      while(pending.size){await awaitRequestDeadline(Promise.all([...pending]),deadline);await Promise.resolve();}
      return !disposalFailed;
    }catch{return false;}
  }});
}

/** Cleanup must attempt provider release even if every local observer hangs.
 * All local disposals start independently and have their own bounded wait. A
 * timeout is never proof of disposal. Keep the deny guard attached on an unknown
 * release; a late terminal release may finish cleanup but cannot upgrade the
 * already-returned result into an accepted evidence receipt. */
export async function releaseEtsyTransportAndDispose(input:{sessionId:string;marked:boolean;
  release():Promise<{sessionId:string;released:boolean;terminalReadback:boolean}>;
  dispose:Array<()=>Promise<unknown>>;registerCleanup(work:Promise<void>):void
}):Promise<{sessionId:string;released:boolean;terminalReadback:boolean;observersDisposed:boolean}>{
  const unknown={sessionId:input.sessionId,released:false,terminalReadback:false};
  const release=Promise.resolve().then(()=>input.marked?input.release():unknown).catch(()=>unknown);
  let disposal:Promise<boolean>|null=null;
  const dispose=()=>disposal??=Promise.all(input.dispose.map(async fn=>{
    try{const result=await awaitRequestDeadline(Promise.resolve().then(fn),requestDeadline(1000));return result!==false;}catch{return false;}
  })).then(results=>results.every(Boolean));
  // This observer is also necessary after the bounded caller returns unknown.
  input.registerCleanup(release.then(async r=>{if(r.sessionId===input.sessionId&&r.released&&r.terminalReadback)await dispose();}));
  let result=unknown;
  try{result=await awaitRequestDeadline(release,requestDeadline(2500));}catch{/* full liability remains held */}
  if(result.sessionId!==input.sessionId||!result.released||!result.terminalReadback)return {...unknown,observersDisposed:false};
  return {...result,observersDisposed:await dispose()};
}
