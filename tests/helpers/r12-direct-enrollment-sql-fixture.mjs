/** Genuine old closed run, then new pack release + owner enrollment API.
 * External CI/provider/security evidence is explicitly INERT TEST DATA. */
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHmac,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {exerciseOwnerInitialRuntime} from './r12-owner-initial-runtime.mjs';
import {directControllerDatabase} from './r12-direct-controller-database.mjs';
import {one,sha} from './r12-owner-initial-sql-fixture.mjs';
import {directSonnetCatalogFixture} from './r12-direct-sonnet-catalog-fixture.mjs';
import {discoveryV2Hash as hash} from '../../.core-tests/products/discovery-v2-hash.js';
import {ETSY_INSIGHTS_SOURCE_POLICY_HASH,ETSY_INSIGHTS_CAPTURE_POLICY_HASH} from '../../.core-tests/browser/etsy-insights-policy.js';
import {researchPolicy} from './etsy-insights-research-renderer-fixture.mjs';
import {landingPins} from './r12-landing-sql-fixture.mjs';
import {buildDirectEnrollmentReviewPackage} from './r12-direct-enrollment-review-package.mjs';
export const ENROLLMENT_ROOT='inert-owner-initial-root-configuration-0123456789';
export const ENROLLMENT_INFERENCE_CONTRACT={version:'r12.direct-inference-contract.1',publicQuoteVersion:'r12.public-research-quote.3',inferenceQuoteVersion:'r12.direct-inference-quote.1',catalogVersion:'r12.direct-inference-catalog.1',luna:{modelId:'openai/gpt-5.6-luna',canonicalModelId:'openai/gpt-5.6-luna-20260709',endpoint:'azure/us',providerName:'Azure'},reviewer:{modelId:'anthropic/claude-sonnet-4.6',canonicalModelId:'anthropic/claude-4.6-sonnet-20260217',endpoint:'amazon-bedrock/us',providerName:'Amazon Bedrock'}};
export const inertEnrollmentExternalEvidence=()=>({release:{commitSha:'1'.repeat(40),treeSha:'2'.repeat(40),qualificationRuns:['ci.yml','direct-etsy-qualification.yml','etsy-browser-boundary.yml'].map((workflow,n)=>({workflow,runId:String(900+n),headSha:'1'.repeat(40),conclusion:'success',artifactHash:hash({inert:true,workflow})})),deploymentReceiptHash:hash('inert-deployment-evidence')},provider:{projectReadbackHash:hash('inert-project-readback'),retentionReviewHash:hash('inert-retention')},security:{approvalHash:hash('inert-security-approval'),scope:'r12.direct-steel-insights.1',recordHash:hash('inert-security-record')},model:{inferenceContract:ENROLLMENT_INFERENCE_CONTRACT,routeReviewHash:hash('inert-model-route'),schemaReviewHash:hash('inert-model-schema'),dataUseReviewHash:hash('inert-model-data-use')}});
export async function publishReviewedDirectPackage(db,x){
 const f=x.f,built=await buildDirectEnrollmentReviewPackage(db,{businessId:f.businessId,goalId:f.goalId,rootId:f.rootId,ownerId:f.ownerId,originProfileId:f.profileId,grantId:x.grantId,profileId:x.profileId,serverKeyHash:x.serverKeyHash,grantReview:x.grantReview,registry:x.registry,reviewedAt:x.reviewedAt,validFrom:x.validFrom,expiresAt:x.expiresAt,externalEvidence:inertEnrollmentExternalEvidence()});
 const published=(await one(db,'select private.r12_direct_publish_enrollment_review($1,$2) x',[built.package,built.reviewEvidence])).x;
 return{built,published};
}
export async function enrollReviewedDirectGrant(db,x){
 const f=x.f,{built,published}=await publishReviewedDirectPackage(db,x);
 const ui=enrollmentOwnerRuntime(f);
 const prepared=await ui.server.prepareDirectEnrollment(ui.context,f.businessId,f.goalId,published.reviewedPackageHash);
 const confirmed=await ui.server.confirmDirectEnrollment(ui.context,f.businessId,f.goalId,prepared.proposalId,prepared.proposalHash);
 return{...x,built,published,ui,preparedEnrollment:prepared,confirmedEnrollment:confirmed};
}

export async function confirmEnrolledTestEnvelope(db,x){
 const f=x.f,server=(operation,payload)=>f.rpc('r12_owner_direct_server',[f.businessId,operation,payload,x.bootstrapKey]);
 const context=await server('initial_quote_context',{grantId:x.grantId});
 const {contextHash,...contextBody}=context;assert.equal(contextHash,hash(contextBody));
 assert.equal(context.grantId,x.grantId);assert.equal(context.routeAuthority.routeHash,x.routeHash);
 assert.equal(context.routeAuthority.maximumSessionMs,x.registry.browserRoute.maximum_session_ms);
 const origin=(await one(db,'select private.r12_direct_origin_build($1,$2) x',[f.businessId,f.goalId])).x;
 const funding=(await one(db,'select private.r12_direct_funding_snapshot($1) x',[f.businessId])).x;
 const amount=10000000n;
 const cap=k=>({currentRevision:funding[k].revision,currentLimitMicrounits:funding[k].currentLimitMicrounits,
  proposedLimitMicrounits:String(BigInt(funding[k].currentLimitMicrounits)>BigInt(funding[k].conservativeExposureMicrounits)+amount?BigInt(funding[k].currentLimitMicrounits):BigInt(funding[k].conservativeExposureMicrounits)+amount)});
 const input={version:'r12.owner-direct-test-input.1',businessId:f.businessId,goalId:f.goalId,grantId:x.grantId,
  predecessorScopeId:origin.predecessor.closure.predecessorScopeId,predecessorScopeHash:origin.predecessor.closure.predecessorScopeHash,
  maximumAttemptsInWindow:10,maximumRunMicrounits:String(amount),capProposal:{version:'r12.public-cap-proposal.1',business:cap('business'),root:cap('root')},submissionId:randomUUID()};
 if(funding.bindingKind==='r05_business')input.capProposal.root.proposedLimitMicrounits=input.capProposal.business.proposedLimitMicrounits;
 const prepared=await server('prepare_test',{input,setupQuote:context.setupQuote,verificationQuote:context.verificationQuote});
 const confirmation={testEnvelopeId:prepared.testEnvelopeId,testEnvelopeHash:prepared.testEnvelopeHash,submissionId:randomUUID()};
 const confirmed=await server('confirm_test',confirmation);assert.equal(confirmed.confirmed,true);
 assert.deepEqual(await server('confirm_test',confirmation),confirmed);
 return{context,input,prepared,confirmed,server};
}
export async function enrollmentDatabase(){
 const db=await directControllerDatabase();try{
  for(const f of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')&&f.slice(0,14)>'20261010120600'&&f.slice(0,14)<='20261010121000').sort())await db.exec(readFileSync('supabase/migrations/'+f,'utf8'));
  if(readdirSync('supabase/migrations').includes('20261010121000_r12_direct_reviewed_enrollment.sql.wip'))await db.exec(readFileSync('supabase/migrations/20261010121000_r12_direct_reviewed_enrollment.sql.wip','utf8'));
  return db;
 }catch(e){e.message+=' '+JSON.stringify({where:e.where,position:e.position,internalPosition:e.internalPosition,internalQuery:e.internalQuery});await db.close();throw e;}
}
async function qualify(db,manifest){
 const id=(await one(db,'select private.stage10_register_pack($1) id',[manifest])).id;
 if((await one(db,'select status from public.packs where id=$1',[id])).status==='qualified')return id;
 await db.query('select private.stage10_qualify_pack($1,$2)',[id,{source:'fixture://inert-direct-enrollment-engineering-only',checks:Object.fromEntries(manifest.evals.map(k=>[k,'passed']))}]);return id;
}
export async function registerEnrollmentFixturePack(db,f){
 const manifests=JSON.parse(readFileSync('packs/etsy-insights-direct-catalog.json','utf8'));
 const {validatePackManifest}=source('src/packs/registry.ts',{'../workers/runtime':require('../../.core-tests/workers/runtime.js')});
 for(const manifest of manifests){validatePackManifest(manifest);await db.query('select private.stage10_register_pack($1)',[manifest]);}
 for(const manifest of manifests)await qualify(db,manifest);
 const root=manifests.find(m=>m.packKey==='workflow.etsy-insights-direct');assert.ok(root);
 const packId=(await one(db,'select id from public.packs where pack_key=$1 and version=$2',[root.packKey,root.version])).id;
 const installationId=await f.rpc('activate_business_pack',[f.businessId,packId]);
 const snapshot=(await one(db,'select snapshot from public.installed_packs where id=$1',[installationId])).snapshot;
 const fd=await one(db,'select id,private.r04_hash(to_jsonb(w)) hash from public.workflow_definitions w where pack_id=$1',[packId]);
 const workers={};for(const phase of ['plan','source','strategy','review']){
  workers[phase]=await one(db,'select id,private.r04_hash(to_jsonb(w)) hash from public.worker_definitions w where worker_key=$1 and version=$2',[phase==='source'?'product.discovery-v2.etsy-insights':'product.discovery-direct.'+phase,'1.0.0']);assert.ok(workers[phase]);
 }
 return {packId,installationId,snapshot,snapshotHash:(await one(db,'select private.r04_hash($1) h',[snapshot])).h,workflowDefinitionId:fd.id,workflowHash:fd.hash,workers};
}
export async function enrollmentOriginFixture(db,{onReady=null,maximumScopes=1,maximumAllocation=406736}={}){
 // The entire original experimental closure remains untouched. New direct
 // capability, knowledge, worker and workflow releases are registered later.
 return exerciseOwnerInitialRuntime(db,{fixtureOptions:{maximumScopes,maximumAllocation},onCompleted:async ctx=>{
  await ctx.server.stopDiscoveryR12(ctx.context,ctx.f.businessId,ctx.scope.id,true);
  const f=ctx.f;
  const historicIds=f.pins.snapshot.releases.map(r=>r.id);
  const historic=async()=>one(db,`select (select jsonb_agg(to_jsonb(p) order by id) from public.packs p where id=any($1::uuid[])) packs,(select jsonb_agg(to_jsonb(w) order by id) from public.worker_definitions w where pack_id=any($1::uuid[])) workers,(select jsonb_agg(to_jsonb(w) order by id) from public.workflow_definitions w where pack_id=any($1::uuid[])) workflows,private.stage10_resolve($2,true) resolved,private.stage14_hash(private.stage10_resolve($2,true)) resolver_hash`,[historicIds,f.pins.packId]);
  const historicalDefinitions=await historic(),pins=await registerEnrollmentFixturePack(db,f);
  assert.deepEqual(await historic(),historicalDefinitions,'Registering and qualifying the new direct closure cannot mutate an old raw-hashed definition');
  const now=Date.now(),validFrom=new Date(now-1000).toISOString(),expiresAt=new Date(now+3600000).toISOString();
  const grantId=randomUUID(),profileId=randomUUID(),project=randomUUID();
  const routeHash=hash({inertRoute:randomUUID()}),tariffHash=hash({inertTariff:'conservative maximum, not actual USD billing'}),qualificationHash=hash({inertRouteQualification:routeHash});
  const routeContent={version:'r12.steel-browser-route.1',usageBound:{version:'r12.steel-usage-bound.1',maximumProxyBytes:0,tariffCoversSessionAndProfileLifecycle:true,captchaDisabled:true,extraServicesDisabled:true},priceEvidenceHash:hash({inertPrice:'not a live tariff'}),retentionDisclosure:'Inert engineering qualification only. No account, browser, model or provider transmission occurs.'};
  const browserRoute={route_hash:routeHash,tariff_hash:tariffHash,qualification_hash:qualificationHash,credential_binding_hash:hash({inertCredentialBinding:project}),provider_project_id:project,provider_account_hash:hash({account:'inert'}),maximum_session_ms:60000,maximum_session_microunits:1000,settlement_contract_hash:hash({inertSettlement:'full held maximum pending authoritative USD'}),content:routeContent,content_hash:hash(routeContent),valid_from:validFrom,valid_until:expiresAt};
  const ownerPolicy={version:'etsy.owner-bootstrap-policy.1',documentUrl:'https://www.etsy.com/',documentMethod:'GET',maximumRequests:256,subresources:'deny_without_evidence',redirects:'fatal',auth:'fatal',childTargets:'fatal'};
  const ownerBody={route_hash:routeHash,provider_project_id:project,policy:ownerPolicy,policy_hash:hash(ownerPolicy),valid_from:validFrom,valid_until:expiresAt};
  const ownerRenderer={...ownerBody,review_hash:hash(ownerBody)};
  const candidate=researchPolicy.candidatePolicy;
  const candidateBody={version:'r12.insights-verification-candidate-review.3',purpose:'etsy_insights_verify_only',routeHash,providerProjectId:project,policy:candidate,policyHash:hash(candidate),...landingPins,validFrom,validUntil:expiresAt};
  const verificationCandidate={review_hash:hash(candidateBody),route_hash:routeHash,provider_project_id:project,policy_hash:hash(candidate),content:candidateBody,valid_from:validFrom,valid_until:expiresAt};
  const sourceBody={version:'r12.direct-source-qualification.1',mode:'execution',providerProjectId:project,workerHash:pins.workers.source.hash,workflowHash:pins.workflowHash,sourcePolicyHash:ETSY_INSIGHTS_SOURCE_POLICY_HASH,capturePolicyHash:ETSY_INSIGHTS_CAPTURE_POLICY_HASH,routeHash,purpose:'etsy_insights_read_only',guardedRendererQualified:true,privateDataExclusionQualified:true,rendererPolicy:researchPolicy};
  const sourceQualification={qualification_hash:hash(sourceBody),worker_definition_id:pins.workers.source.id,worker_hash:pins.workers.source.hash,workflow_definition_id:pins.workflowDefinitionId,workflow_hash:pins.workflowHash,provider_project_id:project,route_hash:routeHash,source_policy_hash:ETSY_INSIGHTS_SOURCE_POLICY_HASH,capture_policy_hash:ETSY_INSIGHTS_CAPTURE_POLICY_HASH,purpose:'etsy_insights_read_only',content:sourceBody,valid_from:validFrom,valid_until:expiresAt};
  const researchBody={version:'r12.insights-proof-bound-source-review.4',purpose:'etsy_insights_aggregate_research',qualificationHash:sourceQualification.qualification_hash,candidateReviewHash:verificationCandidate.review_hash,candidatePolicyHash:hash(candidate),routeHash,providerProjectId:project,policy:researchPolicy,policyHash:hash(researchPolicy),...landingPins,validFrom,validUntil:expiresAt};
  const researchRenderer={review_hash:hash(researchBody),qualification_hash:sourceQualification.qualification_hash,candidate_review_hash:verificationCandidate.review_hash,route_hash:routeHash,provider_project_id:project,policy_hash:hash(researchPolicy),content:researchBody,valid_from:validFrom,valid_until:expiresAt};
  const {qualifyDirectSonnetInferenceQuote}=require(resolve(process.env.R12_ENROLLMENT_CORE_DIR??'.core-tests','products/discovery-r12-public-reviewer-quote.js'));
  const inference=qualifyDirectSonnetInferenceQuote(directSonnetCatalogFixture(Date.now()),Date.now());
  const researchPins={version:'r12.direct-research-pins.1',...pins,sourcePolicyHash:ETSY_INSIGHTS_SOURCE_POLICY_HASH,capturePolicyHash:ETSY_INSIGHTS_CAPTURE_POLICY_HASH,inferenceCatalogHash:inference.baseQuoteHash,executionReviewHash:sourceQualification.qualification_hash,eligibilityReviewHash:f.pins.eligibilityReviewHash,policyInterpretationHash:f.pins.policyInterpretationHash,knowledgeValidUntil:expiresAt};
  const op=operationKey=>({operationKey,workflowDefinitionId:pins.workflowDefinitionId,workflowHash:pins.workflowHash,qualificationHash,routeHash,maximumMicrounits:'1000'});
  const goal=await one(db,'select * from private.r04_goal_versions where goal_id=$1 and revision=2',[f.goalId]);
  const grantReview={version:'r12.direct-grant-review.1',grantId,goalId:f.goalId,goalRevision:2,goalHash:goal.content_hash,providerProjectId:project,routeHash,maximumTestMicrounits:'10000000',maximumAttemptsInWindow:10,cumulativeDispatchesCeiling:64,setupOperation:op('browser.etsy.owner_handoff.create'),verificationOperation:op('browser.etsy.account_verification.create'),researchPins,profileTemplate:{id:profileId,marketSetKey:'gb',topicKey:'astronomy',publicGoal:f.content.objective,productFormat:'original_pod_tshirt',category:'original apparel',markets:[{countryCode:'GB',currency:'GBP'}],audience:'Adult astronomy enthusiasts'},approvalHash:hash({inertReview:grantId}),expiresAt};
  const bootstrapKey=createHmac('sha256',ENROLLMENT_ROOT).update(JSON.stringify({version:'r12.owner-bootstrap.1',businessId:f.businessId,ownerId:f.ownerId,grantId})).digest('base64url');
  const registry={browserRoute,ownerRenderer,sourceQualification,verificationCandidate,researchRenderer};
  const x={ctx,f,grantId,profileId,project,routeHash,bootstrapKey,serverKeyHash:sha(bootstrapKey),grantReview,registry,validFrom,expiresAt,reviewedAt:new Date(Date.now()).toISOString(),inference};
  return onReady?onReady(x):x;
 }});
}
const require=createRequire(import.meta.url),ts=require('typescript');
function source(file,deps){const m={exports:{}};new Function('require','module','exports',ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>{assert.ok(name in deps,'Unexpected module '+name);return deps[name];},m,m.exports);return m.exports;}
export function enrollmentOwnerRuntime(f){
 const core=n=>require('../../.core-tests/'+n+'.js');
 const utils=core('products/discovery-r12-public-utils');
 const contracts=source('src/products/discovery-r12-direct-enrollment-contracts.ts',{'./discovery-r12-public-utils':utils});
 const server=source('src/products/discovery-r12-direct-enrollment-server.ts',{'server-only':{},'node:crypto':require('node:crypto'),'../lib/core-ui/owner-business':source('src/lib/core-ui/owner-business.ts',{}),'../core/request-deadline':core('core/request-deadline'),'./discovery-r12-public-utils':utils,'./discovery-r12-direct-enrollment-contracts':contracts});
 const calls=[];
 const context={userId:f.ownerId,businesses:[{id:f.businessId,name:'Inert owner enrollment'}],supabase:{auth:{getClaims:async()=>({data:{claims:{sub:f.ownerId}},error:null})},rpc:async(name,a)=>{
  calls.push({name,args:structuredClone(a)});try{return{data:await f.rpc(name,name==='r12_owner_direct_enrollment_read'?[a.p_business_id,a.p_goal_id,a.p_proposal_id]:[a.p_business_id,a.p_operation,a.p_payload,a.p_server_key]),error:null};}catch(error){console.error('Inert enrollment RPC rejection:',name,a.p_operation??'read',error.message);return{data:null,error};}
 }}};return{server,contracts,context,calls};
}
