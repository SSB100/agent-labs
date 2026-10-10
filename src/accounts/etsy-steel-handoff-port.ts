import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from 'playwright-core';
import { SteelBrowserAdapter, type SteelConfig } from '../browser/providers/steel';
import { installEtsyRequestAdmission, releaseEtsyTransportAndDispose, type EtsyRequestAdmission } from '../browser/etsy-request-admission';
import { admitEtsyInsightsRendererRequest, validateEtsyInsightsRendererPolicy, etsyInsightsRendererPolicyHash, type EtsyInsightsRendererPolicy } from '../browser/etsy-insights-renderer-policy';
import type { TransportAdmission } from '../core/transport-admission';
import { awaitRequestDeadline, requestDeadline } from '../core/request-deadline';
import { etsySteelHash, handoffExact, handoffHash, handoffAssert, type EtsySteelHandoffDependencies, type EtsySteelDisconnectProof } from './etsy-steel-handoff-contracts';

export type EtsySteelHandoffRendererQualification={
  version:'etsy.owner-handoff-renderer-qualification.1';operationId:string;providerProjectId:string;
  policy:EtsyInsightsRendererPolicy;policyHash:string;expiresAt:string;qualificationHash:string;
};
/** This record must come from the trusted server's immutable reviewed catalog.
 * A structurally correct hash is not authentication or owner approval. */
function rendererQualification(raw:EtsySteelHandoffRendererQualification|undefined,operationId:string,projectId:string,now:number){
  handoffAssert(!!raw,'handoff_renderer_qualification_required');
  handoffExact(raw,'version,operationId,providerProjectId,policy,policyHash,expiresAt,qualificationHash','handoff_renderer_qualification_invalid');
  const {qualificationHash,...body}=raw;
  handoffAssert(raw.version==='etsy.owner-handoff-renderer-qualification.1'&&raw.operationId===operationId&&raw.providerProjectId===projectId&&
    handoffHash(qualificationHash)&&qualificationHash===etsySteelHash(body)&&Number.isFinite(Date.parse(raw.expiresAt))&&Date.parse(raw.expiresAt)>now,'handoff_renderer_qualification_invalid');
  const policy=validateEtsyInsightsRendererPolicy(raw.policy);
  handoffAssert(etsyInsightsRendererPolicyHash(policy)===raw.policyHash,'handoff_renderer_qualification_invalid');
  const result={...structuredClone(raw),policy};Object.freeze(result.policy.staticOrigins);Object.freeze(result.policy);return Object.freeze(result);
}

/** Owner-only login transport. Application observers are physically disconnected
 * before the private viewer is published. Provider recording remains disclosed.
 * The bootstrap is one fixed homepage GET. Redirects and unreviewed CDN assets
 * pause setup; no wildcard remote-host or hidden endpoint authority is implied. */
export function createEtsySteelHandoffPort(input:{providerProjectId:string;admitDispatch:TransportAdmission;beforeCreate:()=>void;
  registerCleanup(work:Promise<void>):void;rendererQualification?:EtsySteelHandoffRendererQualification;
  config?:SteelConfig;fetcher?:typeof fetch;connect?:typeof chromium.connectOverCDP;now?:()=>number;
}):Pick<EtsySteelHandoffDependencies,'createSession'|'releaseSession'|'readProfile'> {
  const provider=new SteelBrowserAdapter({config:input.config,fetcher:input.fetcher,admitDispatch:input.admitDispatch});
  const connect=input.connect??chromium.connectOverCDP.bind(chromium),now=input.now??Date.now;
  const fail=():never=>{throw new Error('etsy_steel_owner_port_unverified');};
  return{
    releaseSession:id=>provider.releaseOwnerHandoffSession(id,input.providerProjectId),
    readProfile:(id,signal)=>provider.retrieveOwnerHandoffProfile(id,input.providerProjectId,signal),
    async createSession(request,signal){
      if(request.profileId!==null)return fail();
      const qualification=rendererQualification(input.rendererQualification,request.browserSessionId,input.providerProjectId,now());
      const bounded=AbortSignal.any([signal,requestDeadline(60_000)]);
      let browser:Browser|null=null,context:BrowserContext|null=null,page:Page|null=null,cdp:CDPSession|null=null,guard:EtsyRequestAdmission|null=null;
      let handedOff=false,disconnectStarted=false,marked=false,invalid=false,closing=false,requests=0;
      const active=()=>{bounded.throwIfAborted();if(invalid||closing||now()>=Date.parse(qualification.expiresAt))return fail();};
      let cleanupWork:Promise<void>|null=null;
      const cleanup=()=>cleanupWork??=(()=>{
        closing=true;guard?.seal();
        return releaseEtsyTransportAndDispose({sessionId:request.browserSessionId,marked,
          release:()=>provider.releaseOwnerHandoffSession(request.browserSessionId,input.providerProjectId),registerCleanup:input.registerCleanup,
          dispose:[()=>context?.unrouteAll({behavior:'wait'})??Promise.resolve(),
            ()=>Promise.all((context?.pages()??[]).map(p=>awaitRequestDeadline(p.removeAllListeners(undefined,{behavior:'wait'}),requestDeadline(1000)))),
            ()=>context?.removeAllListeners(undefined,{behavior:'wait'})??Promise.resolve(),
            ()=>guard?.drain()??Promise.resolve(true),()=>cdp?.detach()??Promise.resolve(),
            async()=>{if(browser?.isConnected())await browser.close();return !browser?.isConnected();}],
        }).then(()=>undefined);
      })();
      const abortCleanup=()=>{if(!handedOff)input.registerCleanup(cleanup());};
      bounded.addEventListener('abort',abortCleanup,{once:true});
      try{
        active();
        const session=await provider.createOwnerHandoffSession(request.browserSessionId,input.providerProjectId,request.timeoutMs,()=>{
          active();const result:unknown=input.beforeCreate();
          if(result&&typeof(result as PromiseLike<unknown>).then==='function'){void Promise.resolve(result).catch(()=>undefined);throw new Error('async_dispatch_guard_rejected');}
          marked=true;
        },bounded);
        const connection=connect(session.automationEndpoint,{timeout:20_000});
        input.registerCleanup(connection.then(async connected=>{
          if((bounded.aborted||closing)&&!handedOff){const release=cleanup();await awaitRequestDeadline(connected.close(),requestDeadline(1000)).catch(()=>undefined);await release;}
        },()=>undefined));
        browser=await awaitRequestDeadline(connection,bounded);active();
        const contexts=browser.contexts();if(contexts.length!==1)return fail();context=contexts[0];
        if(context.pages().length>1||context.pages().some(p=>p.url()!=='about:blank')||context.serviceWorkers().length)return fail();
        page=context.pages()[0]??await awaitRequestDeadline(context.newPage(),bounded);
        context.on('serviceworker',()=>{invalid=true;abortCleanup();});
        context.on('page',p=>{if(p!==page){invalid=true;abortCleanup();}});
        page.on('framenavigated',frame=>{if(frame===page!.mainFrame()&&frame.url()!=='https://www.etsy.com/')invalid=true;});
        await awaitRequestDeadline(context.routeWebSocket('**/*',socket=>{invalid=true;socket.close();}),bounded);
        await awaitRequestDeadline(context.route('**/*',async route=>{
          try{active();if(route.request().frame()!==page!.mainFrame())return fail();await route.continue();}
          catch{invalid=true;await route.abort('blockedbyclient').catch(()=>undefined);}
        }),bounded);
        cdp=await awaitRequestDeadline(context.newCDPSession(page),bounded);
        guard=await installEtsyRequestAdmission({cdp,signal:bounded,invalidate(){invalid=true;},async admit(r){
          active();if(++requests>qualification.policy.maximumRequests)return fail();
          if(r.navigation){if(r.url!=='https://www.etsy.com/'||r.method!=='GET')return fail();}
          else admitEtsyInsightsRendererRequest(qualification.policy,r,null);
          active();
        }});
        await awaitRequestDeadline(page.goto('https://www.etsy.com/',{waitUntil:'domcontentloaded',timeout:20_000}),bounded);active();
        if(page.url()!=='https://www.etsy.com/')return fail();
        const connected=browser;
        return{providerKey:'steel',providerProjectId:input.providerProjectId,providerSessionId:session.providerSessionId,profileId:session.profileId,
          debugUrl:session.debugUrl,freshProfile:true,entryUrl:'https://www.etsy.com',
          async disconnectForOwner(ownerSignal):Promise<EtsySteelDisconnectProof>{
            const stop=AbortSignal.any([ownerSignal,bounded]);
            try{
              active();if(disconnectStarted||handedOff||!connected.isConnected())return fail();disconnectStarted=true;
              guard!.seal();if(!await awaitRequestDeadline(guard!.drain(),stop))return fail();active();
              // Each disposal is bounded independently, even with an unexpired
              // owner approval. A timeout invokes independent provider release.
              const disposeSignal=AbortSignal.any([stop,requestDeadline(1000)]);
              await awaitRequestDeadline(context!.unrouteAll({behavior:'wait'}),disposeSignal);
              for(const p of context!.pages())await awaitRequestDeadline(p.removeAllListeners(undefined,{behavior:'wait'}),disposeSignal);
              await awaitRequestDeadline(context!.removeAllListeners(undefined,{behavior:'wait'}),disposeSignal);
              await awaitRequestDeadline(cdp!.detach(),disposeSignal);
              await awaitRequestDeadline(connected.close(),disposeSignal);
              if(connected.isConnected()||!await awaitRequestDeadline(guard!.drain(),stop))return fail();active();browser=null;
              const live=await provider.retrieveOwnerHandoffSession(session.providerSessionId,input.providerProjectId,stop);
              if(live.status!=='live'||live.profileId!==session.profileId||live.debugUrl!==session.debugUrl)return fail();
              stop.throwIfAborted();if(invalid)return fail();handedOff=true;bounded.removeEventListener('abort',abortCleanup);
              return{version:'etsy.steel-owner-disconnect.1',sessionId:session.providerSessionId,cdpDisconnected:true,observersDrained:true,
                inFlightCommandsSettled:true,appCaptureStopped:true,routeHandlersDrained:true,eventListenersRemoved:true};
            }catch{input.registerCleanup(cleanup());return fail();}
          },
        };
      }catch{input.registerCleanup(cleanup());return fail();}
    },
  };
}
