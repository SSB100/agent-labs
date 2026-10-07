// Offline synthetic fixtures only. No persisted owner authority or provider calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {creativeHash,isReviewedDiscoveryTest,validateCreativeApproval}=require('../.core-tests/creative/contracts.js');
const {currentProductionCandidate,productionCreativeApproval}=require('../.core-tests/creative/production-approval.js');
const {FOCUSED_ADOPTION_VERSION,validateFocusedPilotAdoptionProof}=require('../.core-tests/creative/focused-pilot-adoption.js');
const {qualifyGenerationRouteProof}=require('../.core-tests/research/generation-route.js');
const {DIMENSIONS}=require('../.core-tests/products/types.js');
const {REVIEW_CHECKS_V2,DISCOVERY_V2_EXECUTION_PREREQUISITES}=require('../.core-tests/products/discovery-v2.js');
const {SCREEN_CATEGORIES}=require('../.core-tests/creative/types.js');
const id=n=>`aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12,'0')}`;
const h='a'.repeat(64);
function fixture(){
 const now=Date.now(),created=new Date(now-1000).toISOString(),expiresAt=new Date(now+3600000).toISOString();
 const identity={id:id(1),businessId:id(2),concept:'Original botanical composition',audience:'Adult nature enthusiasts',productType:'original_pod_tshirt',originalDesign:true,rightsStatus:'unclear'};
 const candidate={id:identity.id,business_id:identity.businessId,fingerprint:h,concept:identity.concept,audience:identity.audience,hypothesis:'Private original-design readability learning only.',product_type:identity.productType,original_design:true,rights_status:'unclear',source_domains:['printful.com'],created_at:created};
 const execution={modelId:'anthropic/claude-haiku-4.5',providerRequestId:'gen-reviewed-focused-adoption',primaryOnly:true};
 execution.qualifiedRoute=qualifyGenerationRouteProof({data:{id:execution.providerRequestId,provider_name:'Amazon Bedrock',model:'anthropic/claude-4.5-haiku-20251001',provider_responses:[]}},
 {generationId:execution.providerRequestId,providerName:'Amazon Bedrock',requestedEndpoint:'amazon-bedrock/us',acceptedResponseModelIds:['anthropic/claude-haiku-4.5','anthropic/claude-4.5-haiku-20251001']});
 const review={version:'pod-discovery-2.0',intentId:id(3),dossierHash:h,assessmentHash:h,execution,marketCountryCode:'GB',candidateId:candidate.id,outcome:'TEST',
 sufficiencyRationale:'Synthetic independent review for a private composition learning test; no commercial outcome or actual approval is established.',
 dimensions:DIMENSIONS.map(dimension=>({dimension,verdict:'nonblocking_unknown',rationale:'This synthetic fixture retains the commercial unknown without authorizing a launch.',evidenceRefs:[]})),
 checks:REVIEW_CHECKS_V2.map(check=>({check,outcome:'PASS',rationale:'Synthetic fixture to exercise the adoption proof boundary only.'})),executionPrerequisites:DISCOVERY_V2_EXECUTION_PREREQUISITES,
 additionalUncertainties:[],missingQuestions:[],publicationAllowed:false,commerceAllowed:false};
 const plan={scope:'private_original_design_test',name:'Private readability fixture',hypothesis:'One original composition remains legible at the fixed private preview sizes.',deliverable:'One privately stored PNG and independent visual review.',successCriteria:['Every intended element is legible in the private fixed-size inspection.'],failureCriteria:['Any intended element is clipped or fails the fixed-size visual inspection.'],stopRule:'Stop after one image generation and independent review; no paid repair or publication.',maximumMicrousd:100000,maximumGenerations:1,evidenceRefs:[],budgetStatus:'proposal_only',generationAuthorized:false,spendingAuthorized:false,publicationAllowed:false,commerceAllowed:false};
 const originalDesignConstraints={noThirdPartyReferences:true,workingTitleOnly:true,forbiddenElements:['No copied reference artwork, brands, protected characters or likenesses.']};
 const executionConstraints=[{dimension:'production_complexity',question:'Does the physical print preserve the intended small botanical details?',reason:'The private digital preview cannot settle physical print quality; a later physical sample remains required.',blockingForTest:false}];
 const proof={version:FOCUSED_ADOPTION_VERSION,adoptionId:id(4),businessId:candidate.business_id,candidateId:candidate.id,candidateIdentityHash:creativeHash(identity),scopeId:id(3),scopeHash:h,profileHash:h,resultHash:h,
 planId:id(5),planHash:h,goalId:id(6),goalRevision:1,goalHash:h,dossierHash:h,assessmentHash:h,reviewHash:creativeHash(review),learningPlanHash:creativeHash(plan),originalDesignConstraintsHash:creativeHash(originalDesignConstraints),maximumCreativeProposalMicrousd:plan.maximumMicrousd,executionConstraintsHash:creativeHash(executionConstraints),originalResearchFundingRootId:id(7),researchMaximumMicrousd:2000000,
 strategyArtifactId:id(8),strategyResponseHash:h,strategyCandidateHash:h,strategyRouteProofHash:h,reviewArtifactId:id(9),reviewResponseHash:h,reviewCandidateHash:h,reviewRouteProofHash:execution.qualifiedRoute.proofHash,
 marketCountryCode:'GB',maximumGenerations:1,adoptedAt:created,expiresAt,executionAuthorized:false,publicationAllowed:false,commerceAllowed:false};
 const experiment={id:id(10),business_id:candidate.business_id,candidate_id:candidate.id,workflow_run_id:id(11),discovery_version:FOCUSED_ADOPTION_VERSION,parent_discovery_id:null,status:'completed',created_at:created,
 source_artifact_id:proof.reviewArtifactId,evidence_pack:{version:FOCUSED_ADOPTION_VERSION,scopeId:proof.scopeId,resultHash:proof.resultHash,reviewArtifactId:proof.reviewArtifactId},variables:{focusedPilotAdoption:proof,focusedOriginalDesignConstraints:originalDesignConstraints,focusedExecutionConstraints:executionConstraints},measurement_plan:{version:'pod-discovery-2.0',testPlan:plan}};
 const decision={id:id(12),business_id:candidate.business_id,candidate_id:candidate.id,experiment_id:experiment.id,created_at:created,assessment:review};
 const printSpecification={provider:'printful',product:'Explicit physical test product',garment:'Explicit cotton test garment',placement:'large_front',sourceUrl:'https://help.printful.com/hc/en-us/articles/physical-constraints',sourceExcerpt:'Synthetic source-backed specification for contract testing only; never a real physical-print clearance.',verifiedAt:created,maximumWidthInches:12,maximumHeightInches:16,designWidthInches:4,designHeightInches:4,minimumDpi:150,colorSpace:'srgb',background:'opaque',maximumBytes:7000000};
 const input={approvalId:id(13),designInstructions:'Create exactly one original botanical composition for the owner-approved fixed-size private readability test.',rightsStatement:'Synthetic exact concept ownership statement; not a universal legal clearance.',rightsConfirmed:true,
 policyScreen:SCREEN_CATEGORIES.map(category=>({category,status:'clear',rationale:'Synthetic concept-specific source-backed screen for this test.',sourceUrls:['https://www.etsy.com/legal/creativity/']})),maximumMicrousd:100000,maximumGenerations:1,printSpecification,creativeInstallationId:id(14),creativeInstallationSnapshotHash:h};
 return {candidate,experiment,decision,proof,review,input};
}
const choice=f=>currentProductionCandidate(f.candidate,[f.decision],[f.experiment]);
test('focused adopted TEST preserves dated model and full qualified route; legacy path stays closed',()=>{
 const f=fixture(),before=structuredClone(f.review);assert.equal(isReviewedDiscoveryTest(f.review,f.candidate.id),false);
 assert.ok(isReviewedDiscoveryTest(f.review,f.candidate.id,f.proof));assert.ok(choice(f));assert.deepEqual(f.review,before);
 const a=productionCreativeApproval(choice(f),f.input);assert.deepEqual(a.candidateAssessment,before);assert.equal(a.maximumGenerations,1);assert.equal(a.printSpecification.designWidthInches,4);
 assert.deepEqual(a.printSpecification,f.input.printSpecification);assert.equal(a.focusedPilotBinding.physicalSpecificationHash,creativeHash(f.input.printSpecification));assert.ok(Date.parse(a.expiresAt)<=Date.parse(f.proof.expiresAt));
});
test('focused production cannot inherit a technical print default, rights default or unpinned installation',()=>{
 for(const key of ['printSpecification','rightsConfirmed','creativeInstallationId','creativeInstallationSnapshotHash']){const f=fixture();delete f.input[key];assert.throws(()=>productionCreativeApproval(choice(f),f.input),/explicit physical/);}
});
test('stripped route, model renaming, NME, REJECT and wrong country cannot be adopted',()=>{
 for(const mutate of [f=>delete f.review.execution.qualifiedRoute,f=>f.review.execution.modelId='anthropic/unqualified-model',f=>f.review.outcome='NEEDS_MORE_EVIDENCE',f=>f.review.outcome='REJECT',f=>f.review.marketCountryCode='US']){
  const f=fixture();mutate(f);f.proof.reviewHash=creativeHash(f.review);assert.equal(choice(f),null);
 }
});
test('changed source, identity, plan, proof or expiry rejects current production preflight',()=>{
 for(const mutate of [f=>f.experiment.source_artifact_id=id(99),f=>f.candidate.concept+=' changed',f=>f.experiment.measurement_plan.testPlan.maximumGenerations=2,f=>f.proof.reviewHash='f'.repeat(64),f=>f.proof.expiresAt=new Date(Date.now()-1).toISOString(),f=>f.proof.executionAuthorized=true,f=>f.proof.extra=true]){
  const f=fixture();mutate(f);assert.equal(choice(f),null);
 }
});
test('later decisions and later completed experiments supersede an adopted TEST',()=>{
 const f=fixture(),later=new Date(Date.parse(f.decision.created_at)+1).toISOString();
 assert.equal(currentProductionCandidate(f.candidate,[f.decision,{...f.decision,id:id(70),created_at:later,assessment:{outcome:'REJECT'}}],[f.experiment]),null);
 assert.equal(currentProductionCandidate(f.candidate,[f.decision],[f.experiment,{...f.experiment,id:id(71),created_at:later}]),null);
});
test('approval cannot alter print hash, Business, image count or expire after adoption',()=>{
 for(const mutate of [a=>a.printSpecification.designWidthInches=5,a=>a.businessId=id(99),a=>a.maximumGenerations=2,a=>a.maximumMicrousd=100001,a=>a.focusedPilotBinding.pinnedLearningPlan.hypothesis+=" changed",a=>a.focusedPilotBinding.originalDesignConstraints.workingTitleOnly=false,a=>a.focusedPilotBinding.executionConstraints=[],a=>a.expiresAt=new Date(Date.now()+2*3600000).toISOString(),a=>a.purpose='technical_qualification']){
  const f=fixture(),a=productionCreativeApproval(choice(f),f.input);mutate(a);assert.throws(()=>validateCreativeApproval(a));
 }
});
test('proof always records research root as provenance with no creative execution grant',()=>{const f=fixture();validateFocusedPilotAdoptionProof(f.proof);assert.equal(f.proof.researchMaximumMicrousd,2000000);assert.equal(f.proof.executionAuthorized,false);assert.equal(f.proof.publicationAllowed,false);});

test('existing creative worker receives exact learning and execution constraints within the unchanged byte bound',async()=>{
 const {creativePackManifests}=require('../.core-tests/creative/packs.js');
 const {etsyKnowledgePackManifests}=require('../.core-tests/packs/etsy-knowledge.js');
 const {executeCreativeWorker}=require('../.core-tests/creative/workers.js');
 const {parseCreativeModelQuote}=require('../.core-tests/creative/budget.js');
 const f=fixture(),a=productionCreativeApproval(choice(f),f.input);
 const brief={version:'1.0',approvalId:a.approvalId,audience:a.audience,concept:a.concept,style:'Original botanical flat graphic style',hierarchy:'One original plant composition with clear silhouette',typography:'No lettering, words or any other text',placement:a.printSpecification.placement,garmentCompatibility:a.printSpecification.garment,colors:['#235431','#FFF9DE'],forbiddenElements:['No brands','No protected characters','No third-party reference artwork'],originalityRequirements:'A new original botanical arrangement with no references or named brands.',imagePrompt:'Create one original botanical composition on a plain opaque cream square, with no text, brands, copied artwork, protected characters or reference images.'};
 const prices=async model=>parseCreativeModelQuote({data:[{id:'openai/gpt-5.6-luna',pricing:{prompt:'0.0000002',completion:'0.0000012'}},{id:'anthropic/claude-haiku-4.5',pricing:{prompt:'0.000001',completion:'0.000005',input_cache_write_1h:'0.000002'}}]},model);
 for(const callKey of ['brief:1','screen:1','review:1']){
  const worker=creativePackManifests().find(p=>p.packKey===(callKey==='brief:1'?'worker.etsy-creative-director':'worker.etsy-creative-reviewer')).workers[0];
  const artifacts=[{id:id(80),artifactType:'creative.approval',name:'Synthetic adopted approval',mediaType:'application/json',content:a,metadata:{}}];
  if(callKey!=='brief:1')artifacts.push({id:id(81),artifactType:'creative.brief',name:'Synthetic brief',mediaType:'application/json',content:brief,metadata:{}});
  for(const [index,k]of etsyKnowledgePackManifests().flatMap(p=>p.knowledge).filter(k=>['etsy.current-policy','pod.production'].includes(k.key)).entries())artifacts.push({id:id(90+index),artifactType:'pack.knowledge',name:k.name,mediaType:'application/json',content:k.content,metadata:{knowledgeKey:k.key,verifiedAt:k.verifiedAt}});
  const context={taskContract:{id:id(99),objective:'Perform only the exact private learning phase',inputArtifactIds:artifacts.map(x=>x.id),permittedCapabilities:[],requiredKnowledge:['etsy.current-policy','pod.production'],requiredOutputSchema:worker.manifest.outputSchema,completionCriteria:{exactScope:true},failureCriteria:{stopOnMissingData:true},nonGoals:['No publication or commerce'],escalationRules:{maximumAttempts:1}},inputArtifacts:artifacts};
  const inspection={sha256:h,bytes:3,failedCriteria:[]};
  const output=callKey==='brief:1'?brief:callKey==='screen:1'?{version:'1.0',briefHash:creativeHash(brief),approvalHash:creativeHash(a),checks:SCREEN_CATEGORIES.map(category=>({category,status:'clear',rationale:'Synthetic phase screen for this original private learning test.'})),outcome:'PASS'}:{version:'1.0',assetHash:h,briefHash:creativeHash(brief),checks:['brief_alignment','print_constraints','originality_policy','target_audience','visual_clarity'].map(criterion=>({criterion,outcome:'PASS',rationale:'Synthetic pixel-review response for this offline contract fixture.'})),outcome:'PASS',repairInstruction:null};
  const reservations=[],requests=[];
  await executeCreativeWorker({callKey,approval:a,brief:callKey==='brief:1'?null:brief,inspection:callKey==='review:1'?inspection:undefined,imageBytes:callKey==='review:1'?new Uint8Array([1,2,3]):undefined,worker,context,prices,
    ledger:{reserve:async x=>{reservations.push(x);return{shouldExecute:true,committedMicrousd:x.reservedMicrousd};},record:async()=>{}},
    adapter:{invokeStructured:async request=>{requests.push(request);return{output,provider:'openrouter',providerModelId:request.model.providerModelId,providerRequestId:'synthetic-offline-creative',latencyMs:1,metadata:{},usage:{inputTokens:1,outputTokens:1,totalTokens:2,cachedInputTokens:0,reasoningTokens:0,reportedCostUsd:0,estimatedCostUsd:0}};}}});
  assert.ok(reservations[0].estimate.textRequestBytes<=24576);
  const encoded=JSON.parse(requests[0].messages[1].content),decode=value=>Array.isArray(value)?value.map(decode):value&&typeof value==='object'?Object.keys(value).length===1&&'$text'in value?encoded.sharedText[value.$text]:Object.fromEntries(Object.entries(value).map(([k,v])=>[k,decode(v)])):value;
  const view=decode(encoded).inputArtifacts.find(x=>x.artifactType==='creative.approval').content;
  assert.deepEqual(view.learningPlan.successCriteria,f.experiment.measurement_plan.testPlan.successCriteria);
  assert.deepEqual(view.learningPlan.failureCriteria,f.experiment.measurement_plan.testPlan.failureCriteria);
  assert.equal(view.learningPlan.stopRule,f.experiment.measurement_plan.testPlan.stopRule);
  assert.deepEqual(view.executionConstraints,f.experiment.variables.focusedExecutionConstraints);
  assert.deepEqual(view.originalDesignConstraints,f.experiment.variables.focusedOriginalDesignConstraints);
  assert.equal(view.approvalHash,creativeHash(a));
  assert.equal(view.candidateAssessment,undefined);assert.equal(view.focusedPilotBinding,undefined);
  assert.ok(!JSON.stringify(view).includes(f.proof.resultHash));

 }
});
