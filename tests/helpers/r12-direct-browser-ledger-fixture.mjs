/** Synthetic reviewed accounting authority over genuine owner/R05 rows. No provider calls. */
import {randomUUID} from 'node:crypto';
import {ownerInitialSqlFixture,one,sha,ownerInitialRuntimeRpc} from './r12-owner-initial-sql-fixture.mjs';
import {discoveryV2Hash as hash} from '../../.core-tests/products/discovery-v2.js';
export async function prepareDirectBrowserLedgerFixture(db,{maximum=2500,legacy=null}={}){
 const f=await ownerInitialSqlFixture(db,{legacy,bootstrapRoot:"inert-direct-ledger-bootstrap"});const prepared=await f.prepare();await f.server('confirm',f.confirmPayload(prepared));
 const setup=await one(db,'select * from private.r12_owner_setups where id=$1',[prepared.setupId]);
 const id=randomUUID(),project=randomUUID(),root=legacy?f.legacy.rootId:f.businessId;
 const routeHash=hash({route:randomUUID()}),tariffHash=hash({tariff:'synthetic bounded test tariff'}),qualificationHash=hash({qualification:randomUUID()});
 const now=new Date(),expiresAt=new Date(now.getTime()+3600000).toISOString(),validFrom=new Date(now.getTime()-60000).toISOString();
 const route={usageBound:{version:'r12.steel-usage-bound.1',maximumProxyBytes:0,tariffCoversSessionAndProfileLifecycle:true,captchaDisabled:true,extraServicesDisabled:true},version:'synthetic-route.1',providerProjectId:project,qualificationHash,tariffHash};
 await db.query(`insert into private.r12_direct_browser_routes(route_hash,tariff_hash,qualification_hash,credential_binding_hash,provider_project_id,provider_account_hash,maximum_session_ms,maximum_session_microunits,settlement_contract_hash,content,content_hash,valid_from,valid_until) values($1,$2,$3,$4,$5,$6,60000,1000,$7,$8,$9,$10,$11)`,
 [routeHash,tariffHash,qualificationHash,hash({key:'inert'}),project,hash({account:'inert'}),hash({contract:'bounded pending'}),route,hash(route),validFrom,expiresAt]);
 const envelope={version:'r12.direct-test-envelope.1',id,businessId:f.businessId,goalId:f.goalId,authorityRootId:root,maximumMicrounits:String(maximum)};
 const envelopeHash=hash(envelope);
 await db.query(`insert into private.r12_direct_test_envelopes(id,business_id,goal_id,owner_id,binding_id,authority_root_id,policy_id,origin_direct_run_id,maximum_microunits,business_limit_microunits,root_limit_microunits,content,content_hash,expires_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,6000000,6000000,$10,$11,$12)`,
 [id,f.businessId,f.goalId,f.ownerId,f.bindingId,root,setup.policy_id,randomUUID(),maximum,envelope,envelopeHash,expiresAt]);
 const key='inert-browser-ledger-'+randomUUID();await db.query('insert into private.r12_direct_browser_evidence_keys values($1,$2,$3,$4)',[sha(key),id,routeHash,expiresAt]);
 const ledger=(op,operation,payload={},serverKey=key)=>ownerInitialRuntimeRpc(db,'r12_direct_browser_ledger',[f.businessId,op,operation,payload,serverKey]);
 const exposure=async()=>(await one(db,'select private.r12_direct_test_exposure($1) x',[id])).x;
 const check=additional=>db.query('select private.r12_direct_financial_check($1,$2)',[id,additional]);
 async function createOperation({amount=1000,admit=true}={}){
  const operationId=randomUUID(),requestId=randomUUID(),workflowId=randomUUID(),quoteHash=hash({quote:randomUUID()});
  const scope={version:'etsy.steel-owner-handoff-scope.1',businessId:f.businessId,goalId:f.goalId,authorityRootId:root,testEnvelopeId:id,testEnvelopeHash:envelopeHash,providerProjectId:project,quoteHash,maximumBrowserMicrounits:String(amount)};
  const requestHash=hash({scope,operationId});
  await db.query("insert into public.workflow_runs(id,business_id,workflow_definition_id,idempotency_key,status,input) values($1,$2,$3,$4,'running',$5)",[workflowId,f.businessId,f.pins.workflowDefinitionId,'direct-inert-'+workflowId,{scope}]);
  const payload={operationKey:'browser.direct.'+operationId,accounting:{kind:'r05'},idempotencyKey:'direct:'+operationId};
  await db.query('insert into private.r05_requests(id,business_id,workflow_run_id,policy_id,idempotency_key,request_hash,payload,source_key,currency,liability_microunits) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
  [requestId,f.businessId,workflowId,setup.policy_id,'direct:'+operationId,requestHash,payload,'direct:'+operationId,'USD',amount]);
  const register=async()=>(await one(db,'select private.r12_direct_browser_register($1,$2,$3,$4,$5,$6,$7) x',[id,operationId,requestId,'owner_setup',scope,quoteHash,routeHash])).x;
  if(!admit)return {operationId,requestId,scope,register};
  const reservation=await register(),sessionId=operationId;
  const session=await ledger(operationId,'bind_session',{sessionId,providerProjectId:project,providerAccountHash:hash({account:'inert'})});
  // A released failed operation has an actual wrapper receipt schema; this
  // accounting-only fixture claims no owner profile or research evidence.
  const receiptBody={version:'etsy.steel-owner-handoff-receipt.1',operationId,scopeHash:hash(scope),handoffId:null,
   status:'failed',reason:'inert_accounting_fixture',releaseState:'verified',liabilityState:'receipt_required',
   reservationId:reservation.reservationId,reservationHash:reservation.reservationHash,profileBindingId:null,
   profileBindingRevision:null,accountIdentityVerified:false,insightsAccessVerified:false};
  const receipt={...receiptBody,receiptHash:hash(receiptBody)};await ledger(operationId,'receipt',receipt);
  async function evidence(kind,extra={},recordId=kind+':'+randomUUID()){
   const body={operationId,sessionId,providerProjectId:project,...extra};
   return(await ledger(operationId,'evidence',{kind,providerRecordId:recordId,content:body})).evidenceHash;
  }
  const providerReadbackHash=hash({operationId,providerStatus:'released',durationMs:1000});
  const releaseHash=await evidence('release',{terminal:true,observersDisposed:true,providerStatus:'released',providerReadbackHash,disposalProofHash:hash({operationId,disposed:true})});
  const usageHash=await evidence('usage_bound',{usageIdentityHash:session.usageIdentityHash,tariffHash,qualificationHash,withinQualifiedLimits:true,maximumMicrounits:'1000',requestedTimeoutMs:60000,providerTimeoutMs:60000,durationMs:1000,proxyBytesUsed:0,proxySource:null,solveCaptcha:false,extraServicesDisabled:true,providerReadbackHash});
  const bill=(actual,extra={},recordId)=>evidence('billing',{qualified:true,currency:'USD',actualMicrounits:String(actual),usageIdentityHash:session.usageIdentityHash,tariffHash,qualificationHash,...extra},recordId);
  const reconcile=billingHash=>ledger(operationId,'reconcile',{releaseProofHash:releaseHash,usageProofHash:usageHash,billingProofHash:billingHash??null});
  return {operationId,requestId,scope,requestHash,register,reservation,sessionId,session,receipt,providerReadbackHash,releaseHash,usageHash,evidence,bill,reconcile};
 }
 return {f,prepared,setup,id,root,project,routeHash,tariffHash,qualificationHash,envelope,envelopeHash,key,ledger,exposure,check,createOperation};
}
