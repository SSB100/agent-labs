import { chromium, type Browser } from 'playwright-core';
import { SteelBrowserAdapter, type SteelConfig } from '../browser/providers/steel';
import type { TransportAdmission } from '../core/transport-admission';
import { awaitRequestDeadline, requestDeadline } from '../core/request-deadline';
import type { EtsySteelHandoffDependencies, EtsySteelDisconnectProof } from './etsy-steel-handoff-contracts';

/** Owner-only login transport. Application observers are physically disconnected
 * before the private viewer is published. Provider recording remains disclosed. */
export function createEtsySteelHandoffPort(input:{providerProjectId:string;admitDispatch:TransportAdmission;beforeCreate:()=>void;
  registerCleanup(work:Promise<void>):void;config?:SteelConfig;fetcher?:typeof fetch;connect?:typeof chromium.connectOverCDP;
}):Pick<EtsySteelHandoffDependencies,'createSession'|'releaseSession'|'readProfile'> {
  const provider=new SteelBrowserAdapter({config:input.config,fetcher:input.fetcher,admitDispatch:input.admitDispatch});
  const connect=input.connect??chromium.connectOverCDP.bind(chromium);
  const fail=():never=>{throw new Error('etsy_steel_owner_port_unverified');};
  return{
    releaseSession:id=>provider.releaseOwnerHandoffSession(id,input.providerProjectId),
    readProfile:(id,signal)=>provider.retrieveOwnerHandoffProfile(id,input.providerProjectId,signal),
    async createSession(request,signal){
      if(request.profileId!==null)return fail();
      const bounded=AbortSignal.any([signal,requestDeadline(60_000)]);
      let browser:Browser|null=null,handedOff=false,disconnectStarted=false,marked=false;
      const creation=provider.createOwnerHandoffSession(request.browserSessionId,input.providerProjectId,request.timeoutMs,()=>{
        const result:unknown=input.beforeCreate();
        if(result&&typeof(result as PromiseLike<unknown>).then==='function'){void Promise.resolve(result).catch(()=>undefined);throw new Error('async_dispatch_guard_rejected');}
        marked=true;
      },bounded);
      let session;
      try{session=await creation;}catch{
        if(marked)input.registerCleanup(provider.releaseOwnerHandoffSession(request.browserSessionId,input.providerProjectId).then(()=>undefined,()=>undefined));
        return fail();
      }
      let cleanupWork:Promise<void>|null=null;
      const cleanup=()=>cleanupWork??=(async()=>{
        const connected=browser;browser=null;
        // A stuck CDP socket must not prevent provider release.
        await Promise.all([
          connected?.isConnected()?awaitRequestDeadline(connected.close(),requestDeadline(5_000)).catch(()=>undefined):Promise.resolve(),
          provider.releaseOwnerHandoffSession(session.providerSessionId,input.providerProjectId).catch(()=>undefined),
        ]);
      })();
      const abortCleanup=()=>{if(!handedOff)input.registerCleanup(cleanup());};
      bounded.addEventListener('abort',abortCleanup,{once:true});
      try{
        const connection=connect(session.automationEndpoint,{timeout:20_000});
        input.registerCleanup(connection.then(async connected=>{
          if(bounded.aborted&&!handedOff)await Promise.all([awaitRequestDeadline(connected.close(),requestDeadline(5_000)).catch(()=>undefined),cleanup()]);
        },()=>undefined));
        browser=await awaitRequestDeadline(connection,bounded);
        const context=browser.contexts()[0];
        if(!context||browser.contexts().length!==1||context.pages().some(page=>page.url()!=='about:blank'))return fail();
        const page=context.pages()[0]??await awaitRequestDeadline(context.newPage(),bounded);
        await awaitRequestDeadline(context.route('**/*',async route=>{
          let url:URL;try{url=new URL(route.request().url());}catch{await route.abort('blockedbyclient');return;}
          if(url.protocol!=='https:'||route.request().isNavigationRequest()&&url.origin!=='https://www.etsy.com')await route.abort('blockedbyclient');else await route.continue();
        }),bounded);
        await awaitRequestDeadline(page.goto('https://www.etsy.com',{waitUntil:'domcontentloaded',timeout:20_000}),bounded);
        if(new URL(page.url()).origin!=='https://www.etsy.com')return fail();
        const connected=browser;
        return{providerKey:'steel',providerProjectId:input.providerProjectId,providerSessionId:session.providerSessionId,profileId:session.profileId,
          debugUrl:session.debugUrl,freshProfile:true,entryUrl:'https://www.etsy.com',
          async disconnectForOwner(ownerSignal):Promise<EtsySteelDisconnectProof>{
            const stop=AbortSignal.any([ownerSignal,bounded]);
            try{
              if(disconnectStarted||handedOff||!connected.isConnected())return fail();disconnectStarted=true;
              await awaitRequestDeadline(context.unrouteAll({behavior:'wait'}),stop);
              for(const p of context.pages())await awaitRequestDeadline(p.removeAllListeners(undefined,{behavior:'wait'}),stop);
              await awaitRequestDeadline(context.removeAllListeners(undefined,{behavior:'wait'}),stop);
              await awaitRequestDeadline(connected.close(),stop);
              if(connected.isConnected())return fail();browser=null;
              const live=await provider.retrieveOwnerHandoffSession(session.providerSessionId,input.providerProjectId,stop);
              if(live.status!=='live'||live.profileId!==session.profileId||live.debugUrl!==session.debugUrl)return fail();
              stop.throwIfAborted();handedOff=true;bounded.removeEventListener('abort',abortCleanup);
              return{version:'etsy.steel-owner-disconnect.1',sessionId:session.providerSessionId,cdpDisconnected:true,observersDrained:true,
                inFlightCommandsSettled:true,appCaptureStopped:true,routeHandlersDrained:true,eventListenersRemoved:true};
            }catch{input.registerCleanup(cleanup());return fail();}
          },
        };
      }catch{input.registerCleanup(cleanup());return fail();}
      finally{if(!browser&&!handedOff)input.registerCleanup(cleanup());}
    },
  };
}
