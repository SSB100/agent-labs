import type { SteelCreateConfigurationGuard } from '../browser/etsy-steel-create-binding';
import type { SteelConfig } from '../browser/providers/steel';
import { awaitRequestDeadline, requestDeadline } from '../core/request-deadline';
import { createEtsySteelHandoffPort } from './etsy-steel-handoff-port';
import { etsySteelHash, handoffAssert, handoffExact, validateEtsySteelHandoffScope,
  type EtsySteelHandoffDependencies, type EtsySteelHandoffPermit, type EtsySteelHandoffScope } from './etsy-steel-handoff-contracts';

/** Internal trusted-server composition. The supplied RPC is already bound to
 * one owner/Business, envelope and purpose key. Never expose it to a model. */
export function createEtsySteelHandoffRpcDependencies(input:{scope:EtsySteelHandoffScope;vaultKey:string;signal:AbortSignal;
  rpc(operation:string,payload:Record<string,unknown>):Promise<unknown>;registerCleanup(work:Promise<void>):void;
  rendererQualification?:Parameters<typeof createEtsySteelHandoffPort>[0]['rendererQualification'];
  recordRendererDecision?:Parameters<typeof createEtsySteelHandoffPort>[0]['recordRendererDecision'];
  createConfigurationGuard?:SteelCreateConfigurationGuard;config?:SteelConfig;fetcher?:typeof fetch;connect?:Parameters<typeof createEtsySteelHandoffPort>[0]['connect'];
}):EtsySteelHandoffDependencies {
  const scope=validateEtsySteelHandoffScope(input.scope),scopeHash=etsySteelHash(scope);
  let createReserved=false,createReady=false,createConsumed=false;
  const rpc=async<T>(operation:string,payload:Record<string,unknown>,cleanup=false):Promise<T>=>{
    const signal=cleanup?requestDeadline(10_000):AbortSignal.any([input.signal,requestDeadline(10_000)]);
    try{return await awaitRequestDeadline(input.rpc(operation,payload),signal) as T;}
    catch{throw new Error('etsy_steel_rpc_unconfirmed');}
  };
  const port=createEtsySteelHandoffPort({providerProjectId:scope.providerProjectId,createConfigurationGuard:input.createConfigurationGuard,config:input.config,fetcher:input.fetcher,connect:input.connect,
    registerCleanup:input.registerCleanup,rendererQualification:input.rendererQualification,recordRendererDecision:input.recordRendererDecision,
    admitDispatch:async request=>{
      const cleanup=['browser.etsy.session.release','browser.etsy.session.release_readback'].includes(request.operation);
      const result=await rpc<{allowed:true;operationId:string}>('transport',{operationId:scope.operationId,request},cleanup);
      handoffExact(result,'allowed,operationId','handoff_transport_unconfirmed');
      handoffAssert(result.allowed===true&&result.operationId===scope.operationId,'handoff_transport_unconfirmed');
      if(request.operation==='browser.etsy.owner_handoff.create'){
        handoffAssert(createReserved&&!createReady&&!createConsumed,'handoff_create_replayed');createReady=true;
      }
    },
    beforeCreate:()=>{input.signal.throwIfAborted();handoffAssert(createReserved&&createReady&&!createConsumed,'handoff_create_unadmitted');createConsumed=true;createReady=false;},
  });
  return{...port,vaultKey:input.vaultKey,signal:input.signal,registerCleanup:input.registerCleanup,
    admit:async request=>{
      handoffAssert(request.operationId===scope.operationId&&request.scopeHash===scopeHash&&request.ownerId===scope.ownerId&&
        request.businessId===scope.businessId&&request.testEnvelopeId===scope.testEnvelopeId&&request.testEnvelopeHash===scope.testEnvelopeHash&&
        request.providerProjectId===scope.providerProjectId,'handoff_scope_changed');
      if(request.operation==='create')handoffAssert(!createReserved&&!createConsumed,'handoff_create_replayed');
      const permit=await rpc<EtsySteelHandoffPermit>('admit',{request});
      if(request.operation==='create')createReserved=true;return permit;
    },
    storeHandoff:(record,permit)=>rpc('store',{record,permit}),
    loadHandoff:(owner,handoffId)=>{
      handoffAssert(owner.ownerId===scope.ownerId&&owner.businessId===scope.businessId,'handoff_owner_required');
      // Stop must still load the existing encrypted record after cancellation.
      return rpc('load',{owner,handoffId},true);
    },
    consumeHandoff:(record,owner,action,permit)=>rpc('consume',{record,owner,action,permit},action==='stop'),
    saveProfileCandidate:(candidate,permit)=>rpc('candidate',{candidate,permit}),
    recordOutcome:receipt=>rpc<void>('receipt',{receipt},true),
  };
}
