/** Actual reviewed package -> owner enrollment -> envelope -> guarded account
 * verification -> research activation. Every external provider leaf is inert. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {enrollmentOriginFixture,enrollReviewedDirectGrant,confirmEnrolledTestEnvelope,ENROLLMENT_ROOT} from './r12-direct-enrollment-sql-fixture.mjs';
import {runCandidateApprovedSetup} from './r12-candidate-approved-setup-fixture.mjs';
import {landingSqlVerification} from './r12-landing-verification-sql-fixture.mjs';
import {one,ownerInitialRuntimeRpc} from './r12-owner-initial-sql-fixture.mjs';
import {deriveDirectServerKey} from '../../.core-tests/products/discovery-r12-public-server-key.js';
import {qualifyPublicResearchSonnetQuote} from '../../.core-tests/products/discovery-r12-public-preparation.js';
import {publicResearchQuestionHash,publicResearchCriteriaHash} from '../../.core-tests/products/discovery-r12-public-contracts.js';
import {ETSY_INSIGHTS_CAPTURE_POLICY_HASH} from '../../.core-tests/browser/etsy-insights-policy.js';
import {discoveryV2Hash as hash} from '../../.core-tests/products/discovery-v2-hash.js';
export async function directSonnetFixture(db,options={}){
 process.env.R05_ADMISSION_SERVER_KEY=ENROLLMENT_ROOT;process.env.VERCEL_ENV='production';
 return enrollmentOriginFixture(db,{onReady:async original=>{
  const x=await enrollReviewedDirectGrant(db,original),test=await confirmEnrolledTestEnvelope(db,x),f={...x.f,grantId:x.grantId,bootstrapKey:x.bootstrapKey};
  const authority={db,f,project:x.project,routeHash:x.routeHash,tariffHash:x.registry.browserRoute.tariff_hash,qualificationHash:x.registry.browserRoute.qualification_hash,prepared:test.prepared,quote:test.context.setupQuote,
   server:(operation,payload,key=x.bootstrapKey)=>f.rpc('r12_owner_direct_server',[f.businessId,operation,payload,key]),confirm:async()=>test.confirmed,
   key:purpose=>deriveDirectServerKey(x.bootstrapKey,{businessId:f.businessId,goalId:f.goalId,testEnvelopeId:test.prepared.testEnvelopeId,envelopeHash:test.prepared.testEnvelopeHash,routeHash:x.routeHash,purpose})};
  const context=await authority.server('research_quote_context',{testEnvelopeId:test.prepared.testEnvelopeId,testEnvelopeHash:test.prepared.testEnvelopeHash});
  const{contextHash,...contextBody}=context;assert.equal(contextHash,hash(contextBody));assert.equal(context.version,'r12.direct-owner-research-quote-context.2');assert.equal(context.reviewedPackageHash,x.published.reviewedPackageHash);assert.equal(context.inferenceQuoteVersion,'r12.direct-inference-quote.1');assert.equal(context.grantId,x.grantId);assert.equal(context.approvedQuote,null);
  assert.deepEqual(Object.keys(context).sort(),['browserQuote','browserRevalidation','maximumAttemptsInWindow','originalRunMaximumMicrounits','approvedQuote','version','businessId','goalId','grantId','testEnvelopeId','testEnvelopeHash','reviewedPackageHash','inferenceQuoteVersion','contextHash'].sort());
  const approved=await runCandidateApprovedSetup(db,authority,{runVerification:async ctx=>{
   const runtime=landingSqlVerification(ctx),verified=await runtime.run();assert.equal(verified.status,'verified',JSON.stringify(verified));
   return {f,envelope:authority.prepared.preview,accountBinding:verified.binding,bootstrapKey:x.bootstrapKey,setupOperation:ctx.a.scope.operationId,verificationOperation:ctx.a.scope.verificationOperationId,keys:ctx.x.keys,server:ctx.x.server,verifier:ctx.x.verifier,ledger:ctx.x.ledger,owner:ctx.x.owner,scope:ctx.a.scope,profileId:ctx.a.profileId};
  }});
  const quote=qualifyPublicResearchSonnetQuote(x.inference,context.browserQuote,'10000000');
  const initial={kind:'targeted',criteriaHash:publicResearchCriteriaHash('search_terms','astronomy gifts'),questionHash:publicResearchQuestionHash('Which astronomy gift wording is visible?'),query:'astronomy gifts',namedGap:'Which astronomy gift wording is visible?',expectedInformationGain:'Compare the literal search display for this exact wording.',opposingCheck:'Check whether displayed aggregate results still leave commercial demand unknown.',changedCriterion:null};
  const sourceAccess={allowedSource:'etsy_authenticated_insights',sourcePurpose:'etsy_insights_aggregate_research',accountBinding:approved.accountBinding,capturePolicyHash:ETSY_INSIGHTS_CAPTURE_POLICY_HASH};
  const payload={testEnvelopeId:authority.prepared.testEnvelopeId,testEnvelopeHash:authority.prepared.testEnvelopeHash,initialCommand:initial,quote,sourceAccess,submissionId:randomUUID()};
  if(options.beforePrepare)await options.beforePrepare({x,authority,approved,context,payload});
  const prepared=await authority.server(options.policyVersion===1?'prepare_research':'prepare_research_v2',payload);
  const confirmed=await authority.server('confirm_research',{setupId:prepared.setupId,setupHash:prepared.setupHash,submissionId:randomUUID()});
  const keys=Object.fromEntries(await Promise.all(['controller','admission','source'].map(async purpose=>[purpose,await authority.key(purpose)])));
  const rpc=(operation,payload={},purpose=operation==='dispatch'?'admission':operation.startsWith('source_')?'source':'controller')=>ownerInitialRuntimeRpc(db,'r12_direct_controller_server',[f.businessId,prepared.scopeId,operation,payload,keys[purpose]??purpose]);
  const read=()=>rpc('read');const schedule=async(phase,extra={})=>rpc('schedule',{phase,attemptId:randomUUID(),runtimeCapability:'inert-direct-sonnet-'+randomUUID(),expectedStateHash:(await read()).state.stateHash,...extra});
  assert.equal((await one(db,'select count(*)::int n from private.r12_direct_enrollment_grants where grant_id=$1',[x.grantId])).n,1);
  return {enrollment:x,authority,approved,inference:x.inference,context,quote,initial,prepared,confirmed,keys,rpc,read,schedule,policy:prepared.preview.policy,profile:prepared.preview.profile};
 }});
}
