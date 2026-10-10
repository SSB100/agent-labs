/** Inert in-memory qualification; never a provider call, stored credential or live grant. */
import {randomUUID} from 'node:crypto';
import {one,sha,ownerInitialRpc,ownerInitialRuntimeRpc} from './r12-owner-initial-sql-fixture.mjs';
import {prepareDirectBrowserLedgerFixture} from './r12-direct-browser-ledger-fixture.mjs';
import {discoveryV2Hash as hash} from '../../.core-tests/products/discovery-v2-hash.js';
export async function prepareSteelHandoffFixture(db){
 const x=await prepareDirectBrowserLedgerFixture(db,{maximum:10000000}),id=randomUUID();
 const setupOperation={operationKey:'browser.etsy.owner_handoff.create',workflowDefinitionId:x.f.pins.workflowDefinitionId,
 workflowHash:x.f.pins.workflowHash,qualificationHash:x.qualificationHash,routeHash:x.routeHash,quoteHash:hash({quote:id}),maximumMicrounits:'1000'};
 const verificationOperation={...setupOperation,operationKey:'browser.etsy.account_verification.create',quoteHash:hash({verification:id})};
 const envelope={...x.envelope,testEnvelopeId:id,setupOperation,verificationOperation};
 await db.query(`insert into private.r12_direct_test_envelopes(id,business_id,goal_id,owner_id,binding_id,authority_root_id,policy_id,origin_direct_run_id,maximum_microunits,business_limit_microunits,root_limit_microunits,content,content_hash,expires_at)
 select $1,business_id,goal_id,owner_id,binding_id,authority_root_id,policy_id,$2,maximum_microunits,business_limit_microunits,root_limit_microunits,$3,$4,expires_at from private.r12_direct_test_envelopes where id=$5`,[id,randomUUID(),envelope,hash(envelope),x.id]);
 const keys={handoff:'inert-handoff-'+id,verification:'inert-verification-'+id,cleanup:'inert-cleanup-'+id};
 for(const [purpose,key] of Object.entries(keys))await db.query(`insert into private.r12_etsy_steel_keys(key_hash,envelope_id,route_hash,purpose,valid_until) values($1,$2,$3,$4,clock_timestamp()+interval '2 hours')`,[sha(key),id,x.routeHash,purpose]);
 const billKey='inert-billing-'+id;await db.query(`insert into private.r12_direct_browser_evidence_keys(key_hash,envelope_id,route_hash,valid_until) values($1,$2,$3,clock_timestamp()+interval '2 hours')`,[sha(billKey),id,x.routeHash]);
 const server=(operation,payload={},purpose='handoff')=>ownerInitialRuntimeRpc(db,'r12_etsy_steel_server',[x.f.businessId,operation,payload,keys[purpose]??purpose]);
 const owner=(operation,payload,actor=x.f.ownerId)=>ownerInitialRpc(db,actor,'r12_etsy_steel_owner',[x.f.businessId,operation,payload]);
 const verifier=(operation,payload={},purpose='verification')=>ownerInitialRuntimeRpc(db,'r12_etsy_steel_verification_server',[x.f.businessId,operation,payload,keys[purpose]??purpose]);
 const ledger=(operationId,operation,payload)=>ownerInitialRuntimeRpc(db,'r12_direct_browser_ledger',[x.f.businessId,operationId,operation,payload,billKey]);
 async function prepare(overrides={}){
  const now=Date.now(),scope={version:'etsy.steel-owner-handoff-scope.1',operationId:randomUUID(),ownerId:x.f.ownerId,businessId:x.f.businessId,
   goalId:x.f.goalId,authorityRootId:x.root,testEnvelopeId:id,testEnvelopeHash:hash(envelope),providerProjectId:x.project,
   verificationOperationId:randomUUID(),verificationMaximumMicrounits:'1000',verificationQuoteHash:verificationOperation.quoteHash,
   accountId:randomUUID(),accountRevision:randomUUID(),expectedShopName:'InertVisibleShop',expectedShopId:null,purpose:'etsy_insights_read_only',
   approvalId:randomUUID(),approvalRevision:randomUUID(),approvedAt:new Date(now-1000).toISOString(),approvalExpiresAt:new Date(now+900000).toISOString(),
   profileAccessExpiresAt:new Date(now+3600000).toISOString(),maximumSessionMs:60000,maximumBrowserMicrounits:'1000',currency:'USD',quoteHash:setupOperation.quoteHash,...overrides};
  const disclosure=(await one(db,'select private.r12_etsy_steel_disclosure($1) value',[scope])).value;scope.disclosureHash=hash(disclosure);
  const prepared=await server('prepare',{scope,disclosure});
  const approve=()=>owner('approve',{operationId:scope.operationId,scopeHash:hash(scope),disclosureHash:scope.disclosureHash,expectedApprovalRevision:scope.approvalRevision,persistentAccessApproved:true,budgetApproved:true});
  let reservation=null;const handoffId=randomUUID(),profileId=randomUUID();
  function request(operation){return {version:'etsy.steel-owner-handoff-admission.1',operation,requestId:randomUUID(),scopeHash:hash(scope),
   ...Object.fromEntries(['operationId','ownerId','businessId','authorityRootId','testEnvelopeId','testEnvelopeHash','providerProjectId','accountId','accountRevision','approvalId','approvalRevision','disclosureHash','quoteHash','maximumBrowserMicrounits'].map(k=>[k,scope[k]])),
   handoffId:operation==='create'?null:handoffId,sessionId:operation==='create'?null:scope.operationId,profileId:operation==='create'?null:profileId,
   reservationId:operation==='create'?null:reservation?.reservationId??null,reservationHash:operation==='create'?null:reservation?.reservationHash??null};}
  async function admit(operation){const p=await server('admit',{request:request(operation)});if(operation==='create')reservation=p;return p;}
  const transport=(operation,method,endpoint,purpose='handoff')=>server('transport',{operationId:scope.operationId,request:{provider:'steel',operation,method,endpoint}},purpose);
  async function publish(changes={}){
   const permit=await admit('publish_handoff'),now=Date.now(),body={version:'etsy.steel-owner-handoff-record.1',id:handoffId,scope,scopeHash:hash(scope),
    reservationId:reservation.reservationId,reservationHash:reservation.reservationHash,envelope:'account-v1.inert_abcdefghij.inert_abcdefghijklmn.inert_abcdefghijklmnopqrst',disconnectProof:{version:'etsy.steel-owner-disconnect.1',sessionId:scope.operationId,cdpDisconnected:true,observersDrained:true,inFlightCommandsSettled:true,appCaptureStopped:true,routeHandlersDrained:true,eventListenersRemoved:true},createdAt:new Date(now-100).toISOString(),expiresAt:new Date(Math.min(now+59000,Date.parse(scope.approvalExpiresAt))).toISOString(),...changes};
   const record={...body,recordHash:hash(body)};await server('store',{record,permit});return record;
  }
  return {scope,prepared,approve,request,admit,transport,publish,handoffId,profileId,owner:{ownerId:scope.ownerId,businessId:scope.businessId}};
 }
 return {x,id,envelope,keys,server,owner,ledger,verifier,prepare};
}
