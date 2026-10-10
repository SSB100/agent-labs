/** Genuine stopped legacy origin plus explicitly synthetic reviewed residual authority. */
import {randomUUID} from 'node:crypto';
import {exerciseOwnerInitialRuntime} from './r12-owner-initial-runtime.mjs';
import {one,sha} from './r12-owner-initial-sql-fixture.mjs';
import {deriveDirectServerKey} from '../../.core-tests/products/discovery-r12-public-server-key.js';
import {discoveryV2Hash as hash} from '../../.core-tests/products/discovery-v2.js';
export async function prepareDirectTestAuthorityFixture(db,{legacy=null,onPrepared=null,maximum='10000000',configureReview=null}={}){
 return exerciseOwnerInitialRuntime(db,{legacy,fixtureOptions:{maximumScopes:2,maximumAllocation:12000000},onCompleted:async ctx=>{
  await ctx.server.stopDiscoveryR12(ctx.context,ctx.f.businessId,ctx.scope.id,true);
  const f=ctx.f,project=randomUUID(),routeHash=hash({route:randomUUID()}),tariffHash=hash({tariff:'inert-qualified-bound'}),qualificationHash=hash({qualification:randomUUID()});
  const now=Date.now(),validFrom=new Date(now-1000).toISOString(),validUntil=new Date(now+3600000).toISOString(),priceEvidenceHash=hash({price:'inert'}),settlementContractHash=hash({contract:'qualified held maxima'}),retentionDisclosure='Synthetic qualification only; no provider transmission.';
  const route={usageBound:{version:'r12.steel-usage-bound.1',maximumProxyBytes:0,tariffCoversSessionAndProfileLifecycle:true,captchaDisabled:true,extraServicesDisabled:true},version:'inert-route.1',priceEvidenceHash,retentionDisclosure};
  await db.query(`insert into private.r12_direct_browser_routes(route_hash,tariff_hash,qualification_hash,credential_binding_hash,provider_project_id,provider_account_hash,maximum_session_ms,maximum_session_microunits,settlement_contract_hash,content,content_hash,valid_from,valid_until) values($1,$2,$3,$4,$5,$6,60000,1000,$7,$8,$9,$10,$11)`,[routeHash,tariffHash,qualificationHash,hash({credential:'inert'}),project,hash({account:'inert'}),settlementContractHash,route,hash(route),validFrom,validUntil]);
  const operation=operationKey=>({operationKey,workflowDefinitionId:f.pins.workflowDefinitionId,workflowHash:f.pins.workflowHash,qualificationHash,routeHash,maximumMicrounits:'1000'});
  const setupOperation=operation('browser.etsy.owner_handoff.create'),verificationOperation=operation('browser.etsy.account_verification.create');
  const goal=await one(db,'select * from private.r04_goal_versions where goal_id=$1 and revision=2',[f.goalId]);
  const reviewed=configureReview?await configureReview({db,ctx,f,project,routeHash,tariffHash,qualificationHash,validFrom,validUntil,setupOperation,verificationOperation,goal}):{researchPins:{qualification:'inert-bootstrap-only'},profileTemplate:{qualification:'inert-bootstrap-only'}};
  // Private reviewed fixture row, never a product enrollment endpoint.
  const row={version:'r12.direct-grant-review.1',grantId:f.grantId,goalId:f.goalId,goalRevision:2,goalHash:goal.content_hash,providerProjectId:project,routeHash,maximumTestMicrounits:'10000000',maximumAttemptsInWindow:10,cumulativeDispatchesCeiling:64,setupOperation,verificationOperation,researchPins:reviewed.researchPins,profileTemplate:reviewed.profileTemplate,approvalHash:hash({approval:randomUUID()}),expiresAt:validUntil};
  await db.query(`insert into private.r12_direct_grant_reviews(grant_id,goal_id,goal_revision,goal_hash,provider_project_id,route_hash,maximum_test_microunits,maximum_attempts,cumulative_dispatches_ceiling,setup_operation,verification_operation,research_pins,profile_template,approval_hash,content_hash,expires_at)
   select $1,$2,2,$3,$4,$5,10000000,10,64,$6,$7,$8,$9,$10,private.stage14_hash(jsonb_build_object('version','r12.direct-grant-review.1','grantId',$1::uuid,'goalId',$2::uuid,'goalRevision',2,'goalHash',$3::text,'providerProjectId',$4::uuid,'routeHash',$5::text,'maximumTestMicrounits','10000000','maximumAttemptsInWindow',10,'cumulativeDispatchesCeiling',64,'setupOperation',$6::jsonb,'verificationOperation',$7::jsonb,'researchPins',$8::jsonb,'profileTemplate',$9::jsonb,'approvalHash',$10::text,'expiresAt',$11::timestamptz)),$11`,
  [f.grantId,f.goalId,goal.content_hash,project,routeHash,setupOperation,verificationOperation,row.researchPins,row.profileTemplate,row.approvalHash,validUntil]);
  const quoteTime=Date.now();
  const quoteBody={version:'r12.public-browser-quote.1',provider:'steel',category:'browser',providerProjectId:project,zeroCostQualificationHash:null,routeHash,priceEvidenceHash,settlementContractHash,tariffHash,qualificationHash,maximumMicrounits:'1000',verifiedAt:new Date(quoteTime).toISOString(),validUntil:new Date(quoteTime+300000).toISOString(),qualified:true,retentionDisclosure};
  const quote={...quoteBody,browserQuoteHash:hash(quoteBody)};
  const origin=(await one(db,'select private.r12_direct_origin_build($1,$2) x',[f.businessId,f.goalId])).x;
  const funding=(await one(db,'select private.r12_direct_funding_snapshot($1) x',[f.businessId])).x;
  const limit=String(Math.max(Number(funding.business.conservativeExposureMicrounits),Number(funding.root.conservativeExposureMicrounits))+Number(maximum));
  const cap=k=>({currentRevision:funding[k].revision,currentLimitMicrounits:funding[k].currentLimitMicrounits,proposedLimitMicrounits:String(Math.max(Number(limit),Number(funding[k].currentLimitMicrounits)))});
  const input={version:'r12.owner-direct-test-input.1',businessId:f.businessId,goalId:f.goalId,grantId:f.grantId,predecessorScopeId:origin.predecessor.closure.predecessorScopeId,predecessorScopeHash:origin.predecessor.closure.predecessorScopeHash,maximumAttemptsInWindow:10,maximumRunMicrounits:maximum,capProposal:{version:'r12.public-cap-proposal.1',business:cap('business'),root:cap('root')},submissionId:randomUUID()};
  if(funding.bindingKind==='r05_business')input.capProposal.root.proposedLimitMicrounits=input.capProposal.business.proposedLimitMicrounits;
  const server=(op,payload,key=f.bootstrapKey)=>f.rpc('r12_owner_direct_server',[f.businessId,op,payload,key]);
  const read=(id=null)=>f.rpc('r12_owner_direct_read',[f.businessId,f.goalId,id]);
  const prepare=(changes={})=>server('prepare_test',{input:{...input,...changes},setupQuote:quote,verificationQuote:quote});
  const prepared=await prepare();
  const confirmPayload={testEnvelopeId:prepared.testEnvelopeId,testEnvelopeHash:prepared.testEnvelopeHash,submissionId:randomUUID()};
  const confirm=(payload=confirmPayload)=>server('confirm_test',payload);
  const key=async purpose=>{
   return deriveDirectServerKey(f.bootstrapKey,{businessId:f.businessId,goalId:f.goalId,testEnvelopeId:prepared.testEnvelopeId,envelopeHash:prepared.testEnvelopeHash,routeHash,purpose});
  };
  const result={...ctx,db,f,project,routeHash,qualificationHash,tariffHash,quote,origin,funding,input,prepared,confirmPayload,confirm,prepare,read,server,key,sha};
  return onPrepared?onPrepared(result):result;
 }});
}
