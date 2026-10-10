import type {SteelCreateConfigurationGuard} from '../browser/etsy-steel-create-binding';
import {awaitRequestDeadline,requestDeadline} from '../core/request-deadline';
import {createEtsyInsightsVerificationPort,type EtsyInsightsVerificationInputs} from '../browser/etsy-insights-playwright';
import {SteelBrowserAdapter,type SteelConfig} from '../browser/providers/steel';
import {recordEtsySteelBoundedPending} from '../browser/etsy-steel-accounting';
import {etsySteelHash as hash,handoffAssert as check,handoffHash,handoffUuid,handoffInstant,handoffExact,validateEtsySteelHandoffScope,type EtsySteelHandoffScope} from './etsy-steel-handoff-contracts';
import type {PublicResearchInsightsAccountBinding} from '../products/discovery-r12-public-source';
const object=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
/** One real no-query verification operation after owner sign-in. The caller
 * supplies separately keyed RPCs; private profile data never becomes a model
 * input or owner URL. No second create or receipt-based spend refund exists. */
async function verifyProfile(input:{setupScope:EtsySteelHandoffScope;handoffReceiptHash:string;
 signal:AbortSignal;registerCleanup(work:Promise<void>):void;
 rpc(operation:string,payload:Record<string,unknown>):Promise<unknown>;
 ledger(operationId:string,operation:'read'|'bind_session'|'receipt'|'evidence'|'reconcile',payload:Record<string,unknown>):Promise<unknown>;
 routeHash:string;createConfigurationGuard?:Omit<SteelCreateConfigurationGuard,'scopeHash'>;now?:()=>number;config?:SteelConfig;fetcher?:typeof fetch;
 connect?:Parameters<typeof createEtsyInsightsVerificationPort>[0]['connect'];
}){
 const originalRpc=input.rpc,originalLedger=input.ledger;
 input={...input,rpc:(op,payload)=>awaitRequestDeadline(Promise.resolve().then(()=>originalRpc(op,payload)),requestDeadline(10000)),ledger:(id,op,payload)=>awaitRequestDeadline(Promise.resolve().then(()=>originalLedger(id,op,payload)),requestDeadline(10000))};
 const setup=validateEtsySteelHandoffScope(input.setupScope);check(handoffHash(input.handoffReceiptHash)&&handoffHash(input.routeHash),'verification_setup_unconfirmed');
 const raw=await input.rpc('prepare',{setupOperationId:setup.operationId});check(object(raw)&&object(raw.scope),'verification_inputs_unconfirmed');
 const authority=raw as unknown as EtsyInsightsVerificationInputs,s=authority.scope;
 check(s.setupOperationId===setup.operationId&&s.operationId===setup.verificationOperationId&&s.businessId===setup.businessId&&s.ownerId===setup.ownerId&&s.goalId===setup.goalId&&s.testEnvelopeId===setup.testEnvelopeId&&s.testEnvelopeHash===setup.testEnvelopeHash&&s.providerProjectId===setup.providerProjectId&&s.quoteHash===setup.verificationQuoteHash&&s.maximumBrowserMicrounits===setup.verificationMaximumMicrounits,'verification_scope_changed');
 for(const k of ['authorityRootId','approvalId','approvalRevision','disclosureHash','expectedShopName','expectedShopId','profileAccessExpiresAt'] as const)check(s[k]===setup[k],'verification_scope_changed');
 const createConfigurationGuard=input.createConfigurationGuard?{...input.createConfigurationGuard,scopeHash:authority.scopeHash}:undefined;
 let reserved=false,ready=false,sent=false,permitExpires=0;
 const admitDispatch:Parameters<typeof createEtsyInsightsVerificationPort>[0]['admitDispatch']=async request=>{
  const result=await input.rpc('transport',{operationId:s.operationId,request});check(object(result)&&result.allowed===true&&result.operationId===s.operationId,'verification_transport_unconfirmed');
  if(request.operation==='browser.etsy.insights.create'){check(reserved&&!ready&&!sent,'verification_create_replayed');ready=true;}
 };
 const provider=new SteelBrowserAdapter({config:input.config,fetcher:input.fetcher,createConfigurationGuard,admitDispatch});
 const port=createEtsyInsightsVerificationPort({providerProjectId:s.providerProjectId,now:input.now,config:input.config,fetcher:input.fetcher,connect:input.connect,registerCleanup:input.registerCleanup,createConfigurationGuard,admitDispatch,
  admitStage:async stage=>{check(stage.operationId===s.operationId&&stage.scopeHash===authority.scopeHash&&stage.requestId===authority.requestId&&stage.workflowRunId===authority.workflowRunId,'verification_stage_mismatch');
   if(stage.operation==='create'){check(!reserved&&!sent,'verification_create_replayed');const r=await input.rpc('admit',{operationId:s.operationId});handoffExact(r,'version,operationId,scopeHash,reservationId,reservationHash,reservedBrowserMicrounits,expiresAt','verification_reservation_unconfirmed');check(r.version==='etsy.steel-account-verification-permit.1'&&r.operationId===s.operationId&&r.scopeHash===authority.scopeHash&&handoffUuid(r.reservationId)&&handoffHash(r.reservationHash)&&r.reservedBrowserMicrounits===s.maximumBrowserMicrounits&&handoffInstant(r.expiresAt)&&Date.parse(r.expiresAt as string)>(input.now??Date.now)()&&Date.parse(r.expiresAt as string)<=Math.min(Date.parse(s.expiresAt),(input.now??Date.now)()+30000),'verification_reservation_unconfirmed');permitExpires=Date.parse(r.expiresAt as string);reserved=true;}
   else{const current=await input.rpc('inputs',{operationId:s.operationId});check(hash(current)===hash(authority),'verification_inputs_changed');}},
  beforeCreate:current=>{input.signal.throwIfAborted();check(reserved&&ready&&!sent&&permitExpires>(input.now??Date.now)()&&hash(current)===hash(authority),'verification_create_unadmitted');sent=true;ready=false;},
  qualifyRenderer:async()=>{const r=await input.rpc('qualify_renderer',{operationId:s.operationId});handoffExact(r,object(r)&&r.version==='r12.etsy-insights-renderer-qualification.2'?'version,requestHash,qualificationHash,expiresAt,maximumRequests,policy,policyHash,landingControlsVersion,landingControlsHash':'version,requestHash,qualificationHash,expiresAt,maximumRequests,policy,policyHash','verification_renderer_unconfirmed');const{qualificationHash,...body}=r;check(qualificationHash===hash(body),'verification_renderer_unconfirmed');return r as Awaited<ReturnType<Parameters<typeof createEtsyInsightsVerificationPort>[0]['qualifyRenderer']>>;},
  admitRenderer:async request=>{const r=await input.rpc('admit_renderer',{operationId:s.operationId,request});if(request.version==='etsy.insights-verification-renderer-request.3'){handoffExact(r,'accepted,allowed,sequence,disposition,decisionHash,qualificationHash,policyHash,provenanceHash','verification_renderer_unconfirmed');check((request.disposition==='allow'||request.disposition==='deny_candidate_ancillary')&&r.accepted===true&&r.allowed===(request.disposition==='allow')&&r.sequence===request.sequence&&r.disposition===request.disposition&&r.decisionHash===request.decisionHash&&r.qualificationHash===request.qualificationHash&&r.policyHash===request.policyHash&&r.provenanceHash===request.provenanceHash,'verification_renderer_unconfirmed');return;}check(request.version==='etsy.insights-verification-renderer-request.1'||request.version==='etsy.insights-verification-renderer-request.2','verification_renderer_unconfirmed');const denied='disposition' in request&&request.disposition==='deny_optional_telemetry';check(object(r)&&r.accepted===true&&r.allowed===!denied&&r.sequence===request.sequence&&(!('disposition' in request)||r.disposition===request.disposition),'verification_renderer_unconfirmed');},
 });
 const result=await port.verify(authority,input.signal);
 const body={version:'etsy.steel-account-verification-receipt.1',operationId:s.operationId,scopeHash:authority.scopeHash,status:result.status,reason:result.reason,releaseState:result.release.released&&result.release.terminalReadback&&result.release.observersDisposed?'verified':'unconfirmed',liabilityState:result.release.released&&result.release.terminalReadback&&result.release.observersDisposed?'receipt_required':'unknown'};
 const receipt={...body,receiptHash:hash(body)};
 try{const saved=await input.ledger(s.operationId,'receipt',receipt);check(object(saved)&&saved.persisted===true&&saved.receiptHash===receipt.receiptHash,'verification_receipt_unconfirmed');}catch{return{status:'paused' as const,reason:'verification_receipt_unconfirmed',receipt,accountingConfirmed:false,binding:null};}
 if(body.releaseState!=='verified')return{status:'paused' as const,reason:result.reason,receipt,accountingConfirmed:false,binding:null};
 let accounting;
 try{accounting=await recordEtsySteelBoundedPending({operationId:s.operationId,providerProjectId:s.providerProjectId,routeHash:input.routeHash,requestedTimeoutMs:s.maximumSessionMs,maximumMicrounits:s.maximumBrowserMicrounits,terminalReceipt:receipt,
  release:{...result.release,disposalProofHash:hash({version:'etsy.verification-disposal.1',scopeHash:authority.scopeHash,release:result.release})},extraServicesDisabled:true,
  readUsage:(id,project)=>provider.retrieveScopedTerminalUsage(id,project),rpc:(operation,payload)=>input.ledger(s.operationId,operation,payload)});}catch{return{status:'paused' as const,reason:'verification_accounting_unconfirmed',receipt,accountingConfirmed:false,binding:null};}
 const cleanup=await input.rpc('cleanup_complete',{operationId:s.operationId,releaseEvidenceHash:accounting.releaseEvidenceHash});check(object(cleanup)&&cleanup.operationId===s.operationId&&cleanup.releaseVerified===true&&cleanup.billingStillRequiresLedger===true,'verification_cleanup_unconfirmed');
 if(!accounting.accepted||!result.verification)return{status:'paused' as const,reason:accounting.accepted?result.reason:'verification_accounting_unconfirmed',receipt,accountingConfirmed:accounting.accepted,binding:null};
 const v=result.verification,b={version:'r12.etsy-insights-account-binding.1' as const,businessId:setup.businessId,goalId:setup.goalId,authorityRootId:setup.authorityRootId,testEnvelopeId:setup.testEnvelopeId,testEnvelopeHash:setup.testEnvelopeHash,purpose:setup.purpose,providerProjectId:setup.providerProjectId,approvalId:setup.approvalId,approvalRevision:setup.approvalRevision,disclosureHash:setup.disclosureHash,
  profileBindingId:v.profileBindingId,profileBindingRevision:v.profileBindingRevision,verifiedContextHash:v.verifiedContextHash,observedShopName:v.observedShopName,observedShopId:v.observedShopId,verifiedAt:v.verifiedAt,expiresAt:v.expiresAt,handoffReceiptHash:input.handoffReceiptHash,profileCandidateHash:s.profileCandidateHash,accountVerificationHash:v.verificationHash};
 const binding:PublicResearchInsightsAccountBinding={...b,bindingHash:hash(b)};
 const saved=await input.rpc('verify',{binding,verification:v});check(object(saved)&&saved.verified===true&&hash(saved.binding)===hash(binding),'verification_binding_unconfirmed');
 return{status:'verified' as const,reason:'verified',receipt,accountingConfirmed:true,binding};
}

export function verifyApprovedEtsySteelProfile(input:Parameters<typeof verifyProfile>[0]){
 let finish!:()=>void;const lifetime=new Promise<void>(resolve=>{finish=resolve;});
 input.registerCleanup(lifetime);
 return verifyProfile(input).finally(finish);
}
