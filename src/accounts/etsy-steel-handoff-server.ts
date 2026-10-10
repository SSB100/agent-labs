import 'server-only';
import {createRuntimeClient} from '../lib/supabase/runtime';
import {createHmac} from 'node:crypto';
import {after} from 'next/server';
import type {OwnerUiContext} from '../lib/core-ui/data';
import {boundedRpc,requestDeadline} from '../core/request-deadline';
import {validatePublicResearchOwnerTestReceipt} from '../products/discovery-r12-public-preparation';
import {deriveDirectServerKey} from '../products/discovery-r12-public-server-key';
import {discoveryV2Hash} from '../products/discovery-v2-hash';
import {handoffAssert,handoffHash,handoffUuid} from './etsy-steel-handoff-contracts';
import {readEtsySteelOwnerSetup} from './etsy-steel-handoff-owner-server';
import {createEtsySteelHandoffRpcDependencies} from './etsy-steel-handoff-rpc';
import {SteelBrowserAdapter} from '../browser/providers/steel';
import {verifyApprovedEtsySteelProfile} from './etsy-steel-verification-runtime';
import {recordEtsySteelBoundedPending} from '../browser/etsy-steel-accounting';
import {beginEtsySteelHandoff,openEtsySteelOwnerHandoff,finishEtsySteelHandoff,validateEtsySteelHandoffRecord} from './etsy-steel-handoff-runtime';

const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
/** Resolve route and grant ONLY from authenticated immutable owner catalog. The
 * request form never provides a server key, route, provider profile or URL. */
async function dependencies(context:OwnerUiContext,businessId:string,operationId:string,forCreate=false){
 const runtimeClient=createRuntimeClient();
 const view=await readEtsySteelOwnerSetup(context,businessId,operationId),scope=view.scope;
 const {data,error}=await boundedRpc(context.supabase.rpc('r12_owner_direct_read',{p_business_id:businessId,p_goal_id:scope.goalId,p_test_envelope_id:scope.testEnvelopeId}),requestDeadline(15000),10000);
 handoffAssert(!error&&object(data)&&data.version==='r12.owner-direct-catalog.1'&&data.businessId===businessId&&data.goalId===scope.goalId&&object(data.current),'handoff_test_envelope_unavailable');
 const r=validatePublicResearchOwnerTestReceipt(data.current,{businessId,goalId:scope.goalId,testEnvelopeId:scope.testEnvelopeId,testEnvelopeHash:scope.testEnvelopeHash}),p=r.preview;
 handoffAssert(r.version==='r12.owner-direct-test-receipt.1'&&r.businessId===businessId&&r.goalId===scope.goalId&&r.testEnvelopeId===scope.testEnvelopeId&&r.testEnvelopeHash===scope.testEnvelopeHash&&r.confirmed===true&&object(p)&&p.ownerId===context.userId&&p.businessId===businessId&&p.goalId===scope.goalId&&p.authorityRootId===scope.authorityRootId&&p.testEnvelopeId===scope.testEnvelopeId&&discoveryV2Hash(p)===scope.testEnvelopeHash&&handoffUuid(p.grantId)&&object(p.setupOperation)&&object(p.verificationOperation)&&object(p.setupQuote)&&handoffHash(p.setupOperation.routeHash)&&p.setupOperation.routeHash===p.verificationOperation.routeHash&&p.setupOperation.quoteHash===scope.quoteHash&&p.setupOperation.maximumMicrounits===scope.maximumBrowserMicrounits&&p.verificationOperation.quoteHash===scope.verificationQuoteHash&&p.verificationOperation.maximumMicrounits===scope.verificationMaximumMicrounits&&p.setupQuote.providerProjectId===scope.providerProjectId,'handoff_test_envelope_mismatch');
 const secret=process.env.R05_ADMISSION_SERVER_KEY?.trim(),vaultKey=process.env.ACCOUNTS_VAULT_KEY;
 handoffAssert(process.env.VERCEL_ENV==='production'&&typeof secret==='string'&&secret.length>=32&&secret.length<=200&&typeof vaultKey==='string'&&/^[a-f0-9]{64}$/.test(vaultKey),'handoff_server_configuration_required');
 const bootstrap=createHmac('sha256',secret).update(JSON.stringify({version:'r12.owner-bootstrap.1',businessId,ownerId:context.userId,grantId:p.grantId})).digest('base64url');
 const pins={businessId,goalId:scope.goalId,testEnvelopeId:scope.testEnvelopeId,envelopeHash:scope.testEnvelopeHash,routeHash:p.setupOperation.routeHash};
 const key=deriveDirectServerKey(bootstrap,{...pins,purpose:'handoff'}),cleanupKey=deriveDirectServerKey(bootstrap,{...pins,purpose:'cleanup'});
 const signal=requestDeadline(60_000);
 const rpc=async(operation:string,payload:Record<string,unknown>)=>{
   const request=payload.request;
   const cleanup=['cleanup_due','cleanup_complete'].includes(operation)||operation==='transport'&&object(request)&&['browser.etsy.session.release','browser.etsy.session.release_readback'].includes(String(request.operation));
   const response=await boundedRpc(runtimeClient.rpc('r12_etsy_steel_server',{p_business_id:businessId,p_operation:operation,p_payload:payload,p_server_key:cleanup?cleanupKey:key}),requestDeadline(15000),10000);
   handoffAssert(!response.error,'handoff_server_state_unconfirmed');return response.data;
 };
 const evidenceKey=deriveDirectServerKey(bootstrap,{...pins,purpose:'evidence'});
 const ledgerFor=async(targetOperationId:string,operation:'read'|'bind_session'|'receipt'|'evidence'|'reconcile',payload:Record<string,unknown>)=>{
   handoffAssert([scope.operationId,scope.verificationOperationId].includes(targetOperationId),'handoff_accounting_scope_changed');
   const response=await boundedRpc(runtimeClient.rpc('r12_direct_browser_ledger',{p_business_id:businessId,p_operation_id:targetOperationId,p_operation:operation,p_payload:payload,p_server_key:evidenceKey}),requestDeadline(15000),10000);
   handoffAssert(!response.error,'handoff_accounting_unconfirmed');return response.data;
 };
 const ledger=(operation:Parameters<typeof ledgerFor>[1],payload:Record<string,unknown>)=>ledgerFor(operationId,operation,payload);
 const verificationKey=deriveDirectServerKey(bootstrap,{...pins,purpose:'verification'});
 const verificationRpc=async(operation:string,payload:Record<string,unknown>)=>{
   const cleanup=['cleanup_due','cleanup_complete'].includes(operation)||operation==='transport'&&object(payload.request)&&['browser.etsy.session.release','browser.etsy.session.release_readback'].includes(String(payload.request.operation));
   const result=await boundedRpc(runtimeClient.rpc('r12_etsy_steel_verification_server',{p_business_id:businessId,p_operation:operation,p_payload:payload,p_server_key:cleanup?cleanupKey:verificationKey}),requestDeadline(15000),10000);handoffAssert(!result.error,'verification_state_unconfirmed');return result.data;
 };
 const refreshVerification=async()=>{const result=await boundedRpc(runtimeClient.rpc('r12_direct_setup_quote_revalidate',{p_business_id:businessId,p_setup_operation_id:operationId,p_kind:'verification',p_server_key:verificationKey}),requestDeadline(15000),10000);handoffAssert(!result.error,'verification_quote_revalidation_required');};
 const provider=new SteelBrowserAdapter({admitDispatch:async request=>{
   const result=await rpc('transport',{operationId,request});handoffAssert(object(result)&&result.allowed===true&&result.operationId===operationId,'handoff_transport_unconfirmed');
 }});
 let rendererQualification:Parameters<typeof createEtsySteelHandoffRpcDependencies>[0]['rendererQualification'];
 if(forCreate){
   const refreshed=await boundedRpc(runtimeClient.rpc('r12_direct_setup_quote_revalidate',{p_business_id:businessId,p_setup_operation_id:operationId,p_kind:'setup',p_server_key:key}),requestDeadline(15000),10000);
   handoffAssert(!refreshed.error,'handoff_quote_revalidation_required');
   const qualified=await boundedRpc(runtimeClient.rpc('r12_direct_owner_renderer_qualification',{p_business_id:businessId,p_operation_id:operationId,p_server_key:key}),requestDeadline(15000),10000);
   handoffAssert(!qualified.error,'handoff_renderer_qualification_required');rendererQualification=qualified.data;
 }
 const d=createEtsySteelHandoffRpcDependencies({scope,vaultKey,signal,registerCleanup:work=>after(work),rpc,rendererQualification,
   recordRendererDecision:async decision=>{const result=await rpc('renderer_decision',{operationId,decision});handoffAssert(object(result)&&result.accepted===true,'handoff_renderer_decision_unconfirmed');}});
 return{view,d,rpc,ledger,ledgerFor,verificationRpc,refreshVerification,provider,routeHash:p.setupOperation.routeHash};
}
export async function startApprovedEtsySteelSetup(context:OwnerUiContext,businessId:string,operationId:string){const{view,d}=await dependencies(context,businessId,operationId,true);handoffAssert(view.status==='approved','handoff_owner_approval_required');return beginEtsySteelHandoff(view.scope,d);}
export async function readPrivateEtsySteelOwnerHandoff(context:OwnerUiContext,businessId:string,operationId:string,handoffId:string){const{view,d}=await dependencies(context,businessId,operationId);handoffAssert(view.status==='approved'&&handoffUuid(handoffId),'handoff_owner_approval_required');return openEtsySteelOwnerHandoff({ownerId:context.userId,businessId},handoffId,d);}
export async function finishApprovedEtsySteelSetup(context:OwnerUiContext,businessId:string,operationId:string,handoffId:string,action:'return'|'stop'){
 const{view,d,rpc,ledger,provider,routeHash}=await dependencies(context,businessId,operationId),owner={ownerId:context.userId,businessId};
 handoffAssert(handoffUuid(handoffId),'handoff_record_unavailable');
 const record=validateEtsySteelHandoffRecord(await d.loadHandoff(owner,handoffId),owner,handoffId);
 const receipt=await finishEtsySteelHandoff(owner,handoffId,action,d);
 if(receipt.releaseState!=='verified')return{receipt,accountingConfirmed:false};
 try{
   const result=await recordEtsySteelBoundedPending({operationId,providerProjectId:view.scope.providerProjectId,routeHash,
     requestedTimeoutMs:Date.parse(record.expiresAt)-Date.parse(record.createdAt),maximumMicrounits:view.scope.maximumBrowserMicrounits,
     terminalReceipt:receipt,release:{sessionId:operationId,released:true,terminalReadback:true,observersDisposed:true,disposalProofHash:discoveryV2Hash(record.disconnectProof)},
     extraServicesDisabled:true,readUsage:(sessionId,projectId)=>provider.retrieveScopedTerminalUsage(sessionId,projectId),rpc:ledger});
   const cleaned=await rpc('cleanup_complete',{operationId,releaseEvidenceHash:result.releaseEvidenceHash});
   handoffAssert(object(cleaned)&&cleaned.releaseVerified===true,'handoff_cleanup_unconfirmed');
   return{receipt,accountingConfirmed:result.accepted};
 }catch{return{receipt,accountingConfirmed:false};}
}


export async function verifyApprovedEtsySteelSetup(context:OwnerUiContext,businessId:string,operationId:string){
 const{view,ledgerFor,verificationRpc,refreshVerification,routeHash}=await dependencies(context,businessId,operationId);
 handoffAssert(view.status==='approved','verification_owner_approval_required');
 const receipt=view.receipts.find(r=>r.status==='profile_pending_verification'&&r.releaseState==='verified');
 handoffAssert(receipt,'verification_profile_candidate_required');
 await refreshVerification();
 return verifyApprovedEtsySteelProfile({setupScope:view.scope,handoffReceiptHash:receipt.receiptHash,routeHash,
   signal:requestDeadline(180000),registerCleanup:work=>after(work),rpc:verificationRpc,ledger:ledgerFor});
}
