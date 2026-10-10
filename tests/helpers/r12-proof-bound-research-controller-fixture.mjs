/** Real owner/R07/R05 chain; all provider/catalog callbacks are explicitly inert. */
import {randomUUID} from 'node:crypto';
import {landingSqlVerification} from './r12-landing-verification-sql-fixture.mjs';
import {landingPins} from './r12-landing-sql-fixture.mjs';
import {researchPolicy} from './etsy-insights-research-renderer-fixture.mjs';
import {prepareDirectTestAuthorityFixture} from './r12-direct-test-authority-fixture.mjs';
import {qualifyInertOwnerRenderer} from './r12-direct-setup-renewal-fixture.mjs';
import {runDirectApprovedSetup} from './r12-direct-approved-setup-fixture.mjs';
import {runCandidateApprovedSetup} from './r12-candidate-approved-setup-fixture.mjs';
import {insertCandidateReview} from './r12-candidate-verification-sql-fixture.mjs';
import {one,ownerInitialRuntimeRpc} from './r12-owner-initial-sql-fixture.mjs';
import {r12CatalogFixture} from './r12-provider-fixture.mjs';
import {qualifyEtsyOwnerResearchQuote} from '../../.core-tests/products/discovery-r12-adaptive-quote.js';
import {qualifyPublicResearchWindowQuote} from '../../.core-tests/products/discovery-r12-public-preparation.js';
import {publicResearchQuestionHash,publicResearchCriteriaHash} from '../../.core-tests/products/discovery-r12-public-contracts.js';
import {ETSY_INSIGHTS_SOURCE_POLICY_HASH,ETSY_INSIGHTS_CAPTURE_POLICY_HASH} from '../../.core-tests/browser/etsy-insights-policy.js';
import {discoveryV2Hash as hash} from '../../.core-tests/products/discovery-v2-hash.js';
export async function proofBoundResearchControllerFixture(db,options={}){
 let inference,candidateReviewHash,sourceReviewHash,registerSourceReview;
 const authority=await prepareDirectTestAuthorityFixture(db,{legacy:{committedMicrounits:1900000},...options,configureReview:async v=>{
  const {f,project,routeHash,validFrom,validUntil}=v;await qualifyInertOwnerRenderer(db,{...v,verificationPolicy:options.verificationPolicy});if(!options.legacyVerification)candidateReviewHash=await insertCandidateReview(db,{routeHash});inference=qualifyEtsyOwnerResearchQuote(r12CatalogFixture(),Date.now());
  const worker=await one(db,'select to_jsonb(w) row from public.worker_definitions w where id=$1',[f.pins.workers.search1.id]);
  const existing=await one(db,"select id from public.worker_definitions where pack_id=$1 and worker_key='product.discovery-v2.etsy-insights' and version='1.0.0'",[worker.row.pack_id]);const sourceId=existing?.id??randomUUID();
  // A distinct reviewed source worker; never alias/rename the old Exa worker.
  const sourceRow={...worker.row,id:sourceId,worker_key:'product.discovery-v2.etsy-insights',name:'Synthetic qualified Insights source',status:'qualified',role:'etsy_insights_read_only',charter:'Inert qualification fixture for the real bounded Etsy Insights adapter. Read only the owner-approved visible aggregate viewport. Never search APIs, buyer data, messages, transactions or model-generated evidence.',input_schema:{type:'object',properties:{version:{const:'r12.etsy-insights-source-scope.1'}}},output_schema:{type:'object',properties:{version:{const:'r12.etsy-insights-source-receipt.1'}}},capability_requirements:['browser.etsy.insights.read_only'],model_requirements:{}};
  if(!existing)await db.query('insert into public.worker_definitions select (jsonb_populate_record(null::public.worker_definitions,$1)).*',[sourceRow]);
  const source=await one(db,'select id,private.r04_hash(to_jsonb(w)) hash from public.worker_definitions w where id=$1',[sourceId]);
  const installation=await one(db,"select id from public.installed_packs where business_id=$1 and root_pack_id=$2 and status='active'",[f.businessId,f.pins.packId]);
  const sourceQualification={version:'r12.direct-source-qualification.1',mode:'execution',providerProjectId:project,workerHash:source.hash,workflowHash:f.pins.workflowHash,sourcePolicyHash:ETSY_INSIGHTS_SOURCE_POLICY_HASH,capturePolicyHash:ETSY_INSIGHTS_CAPTURE_POLICY_HASH,routeHash,purpose:'etsy_insights_read_only',guardedRendererQualified:true,privateDataExclusionQualified:true,
   rendererPolicy:options.sourceRendererPolicy??researchPolicy};
  const qualificationHash=hash(sourceQualification);
  await db.query(`insert into private.r12_direct_source_qualifications values($1,$2,$3,$4,$5,$6,$7,$8,$9,'etsy_insights_read_only',$10,$11,$12)`,[qualificationHash,sourceId,source.hash,f.pins.workflowDefinitionId,f.pins.workflowHash,project,routeHash,ETSY_INSIGHTS_SOURCE_POLICY_HASH,ETSY_INSIGHTS_CAPTURE_POLICY_HASH,sourceQualification,validFrom,validUntil]);
  registerSourceReview=async()=>{const review={version:'r12.insights-proof-bound-source-review.4',purpose:'etsy_insights_aggregate_research',qualificationHash,candidateReviewHash,candidatePolicyHash:researchPolicy.candidatePolicyHash,routeHash,providerProjectId:project,policy:researchPolicy,policyHash:hash(researchPolicy),...landingPins,validFrom,validUntil};sourceReviewHash=hash(review);
  if(options.sourceReview!==false)await db.query('insert into private.r12_proof_bound_source_reviews values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[sourceReviewHash,qualificationHash,candidateReviewHash,routeHash,project,hash(researchPolicy),review,validFrom,validUntil]);};
  if(candidateReviewHash)await registerSourceReview();
  return {researchPins:{version:'r12.direct-research-pins.1',installationId:installation.id,packId:f.pins.packId,snapshot:f.pins.snapshot,snapshotHash:f.pins.snapshotHash,workflowDefinitionId:f.pins.workflowDefinitionId,workflowHash:f.pins.workflowHash,workers:{plan:f.pins.workers.plan,source,strategy:f.pins.workers.strategy,review:f.pins.workers.review},sourcePolicyHash:ETSY_INSIGHTS_SOURCE_POLICY_HASH,capturePolicyHash:ETSY_INSIGHTS_CAPTURE_POLICY_HASH,inferenceCatalogHash:inference.baseQuoteHash,executionReviewHash:qualificationHash,eligibilityReviewHash:f.pins.eligibilityReviewHash,policyInterpretationHash:f.pins.policyInterpretationHash,knowledgeValidUntil:validUntil},profileTemplate:{id:randomUUID(),marketSetKey:'gb',topicKey:'astronomy',publicGoal:'Investigate original astronomy T-shirt opportunities for adult buyers.',productFormat:'original_pod_tshirt',category:'original apparel',markets:[{countryCode:'GB',currency:'GBP'}],audience:'Adult astronomy enthusiasts'}};
 }});
 let verificationRuntime,verificationResult,verificationContext;
 const approved=options.legacyVerification?await runDirectApprovedSetup(db,authority,{beforeVerification:async()=>{candidateReviewHash=await insertCandidateReview(db,authority);await registerSourceReview();}}):await runCandidateApprovedSetup(db,authority,options.landingVerification===false?{}:{runVerification:async ctx=>{
  verificationContext=ctx;verificationRuntime=landingSqlVerification(ctx,options.verificationOptions);verificationResult=await verificationRuntime.run();
  if(verificationResult.status!=='verified')throw Error('Actual .2 verification paused: '+JSON.stringify(verificationResult));
  return {f:authority.f,envelope:authority.prepared.preview,accountBinding:verificationResult.binding,bootstrapKey:authority.f.bootstrapKey,
   setupOperation:ctx.a.scope.operationId,verificationOperation:ctx.a.scope.verificationOperationId,keys:ctx.x.keys,server:ctx.x.server,verifier:ctx.x.verifier,ledger:ctx.x.ledger,owner:ctx.x.owner,scope:ctx.a.scope,profileId:ctx.a.profileId};
 }});
 if(options.initialQuoteTtlMs!==undefined)inference={...inference,validUntil:new Date(Date.now()+options.initialQuoteTtlMs).toISOString()};
 const quote=qualifyPublicResearchWindowQuote(inference,authority.quote,'10000000');
 const initial={kind:'targeted',criteriaHash:publicResearchCriteriaHash('search_terms','astronomy gifts'),questionHash:publicResearchQuestionHash('Which astronomy gift wording is visible?'),query:'astronomy gifts',namedGap:'Which astronomy gift wording is visible?',expectedInformationGain:'Compare the literal search display for this exact wording.',opposingCheck:'Check whether displayed aggregate results still leave commercial demand unknown.',changedCriterion:null};
 const sourceAccess={allowedSource:'etsy_authenticated_insights',sourcePurpose:'etsy_insights_aggregate_research',accountBinding:approved.accountBinding,capturePolicyHash:ETSY_INSIGHTS_CAPTURE_POLICY_HASH};
 if(options.beforeResearch)await options.beforeResearch({authority,approved,candidateReviewHash,sourceReviewHash});
 const prepared=await authority.server('prepare_research',{testEnvelopeId:authority.prepared.testEnvelopeId,testEnvelopeHash:authority.prepared.testEnvelopeHash,initialCommand:initial,quote,sourceAccess,submissionId:randomUUID()});
 const confirmed=await authority.server('confirm_research',{setupId:prepared.setupId,setupHash:prepared.setupHash,submissionId:randomUUID()});
 const keys=Object.fromEntries(await Promise.all(['controller','admission','source'].map(async purpose=>[purpose,await authority.key(purpose)])));
 const rpc=(operation,payload={},purpose=operation==='dispatch'?'admission':operation.startsWith('source_')?'source':'controller')=>ownerInitialRuntimeRpc(db,'r12_direct_controller_server',[authority.f.businessId,prepared.scopeId,operation,payload,keys[purpose]??purpose]);
 const read=()=>rpc('read');
 const schedule=async(phase,extra={})=>rpc('schedule',{phase,attemptId:randomUUID(),runtimeCapability:'inert-direct-runtime-'+randomUUID(),expectedStateHash:(await read()).state.stateHash,...extra});
 return {candidateReviewHash,sourceReviewHash,verificationRuntime,verificationResult,verificationContext,authority,approved,quote,initial,prepared,confirmed,keys,rpc,read,schedule,policy:prepared.preview.policy,profile:prepared.preview.profile};
}
