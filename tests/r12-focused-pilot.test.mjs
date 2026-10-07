// Synthetic contract fixtures. No provider request or live authority.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import c from '../.core-tests/products/discovery-r12-focused-pilot-contract.js';
import v2 from '../.core-tests/products/discovery-v2.js';
import worker from '../.core-tests/products/discovery-v2-worker-contract.js';
import {discoveryAddendumReferences} from '../.core-tests/products/discovery-r12-evidence-addendum.js';
import {assertJsonSchemaValue} from '../.core-tests/workers/schema-validator.js';
import {discoveryR12StaticSchema} from '../.core-tests/products/discovery-r12-schemas.js';
import {discoveryKnowledgeFixture} from './discovery-v2-fixtures.mjs';
import {DIMENSIONS} from '../.core-tests/products/types.js';
const {discoveryV2Hash:hash,validateDiscoveryIntentV2,validateDiscoveryDossierV2}=v2;
const id = n => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const digest = text => createHash('sha256').update(text).digest('hex');
const now = Date.parse('2026-10-07T00:00:00.000Z');
function fixture() {
  const createdAt = '2026-10-06T23:59:00.000Z', expiresAt = '2026-10-07T20:00:00.000Z';
  const retailText = 'A public United Kingdom retailer offers an adult nature-themed T-shirt. This observation establishes an offer, not purchases or demand.';
  const productionText = 'Official Printful guidance describes the adult garment print area and minimum file resolution. This describes file constraints, not buyer demand.';
  const observation = (n, context, kind, url, dimensions, retrievedAt) => ({
    id: `evi-${String(n).repeat(24)}`, sourceId: `src-${String(n).repeat(24)}`, url, title: `Qualification fixture observation ${n}`,
    access: 'public_document_read', kind, retrievedAt, expiresAt, captureHash: digest(`capture ${n}`), contentHash: digest(context), context,
    start: 0, end: context.length, geographyRole: kind === 'retail_offer' ? 'buyer_market' : 'general_operating_context',
    countries: kind === 'retail_offer' ? ['GB'] : [], dimensions, limitations: ['Qualification fixture only; no live fact or permission is established.'], sourceReviewHash: digest(`review ${n}`),
  });
  const observations = { version: 'r12.discovery-evidence-addendum.1', id: id(8), businessId: id(2), goalId: id(3), predecessorScopeId: id(7), predecessorReviewHash: digest('accepted review'),
    observations: [observation(1, retailText, 'retail_offer', 'https://rapanuiclothing.com/products/nature-shirt', ['competition', 'differentiation'], '2026-10-06T21:21:00.000Z'),
      observation(2, productionText, 'official_operating_fact', 'https://help.printful.com/hc/en-us/articles/fixture', ['production_complexity'], '2026-10-06T23:58:00.000Z')],
    sellerBankCountry: null, approvalHash: digest('observation approval'), independentReviewHash: digest('independent observation review'), createdAt, expiresAt };
  const historicalRecord = { outcome: 'NEEDS_MORE_EVIDENCE', missingQuestions: ['What direct evidence supports the original broad commercial hypothesis?'],
    sourceHistory: [{ retrievedAt: '2026-10-06T07:06:31.677Z', expiresAt: '2026-10-07T07:06:31.677Z' }] };
  const p = { version: c.FOCUSED_PILOT_VERSION, id: id(1), businessId: id(2), goalId: id(3), originalGoalId: id(4), budgetAuthorityRootId: id(5), priorRoundId: id(6),
    originalIntentHash: digest('original intent'), originalSemanticGoalHash: digest('original semantic goal'),
    intent: { version: 'pod-discovery-2.0', id: id(1), businessId: id(2), objective: 'Evaluate one original nature-shirt design in a private GB readability experiment.',
      comparisonUniverse: { productType: 'original_pod_tshirt', markets: [{countryCode:'GB',currency:'GBP'}], audiences: ['Adult nature enthusiasts'], sourceDomains: ['rapanuiclothing.com', 'printful.com'], selectionQuestion: 'Can one original botanical composition remain distinct at the intended private preview sizes?' },
      limits: { maximumAlternatives: 3, maximumNewCollections: 0, maximumMicrousd: 2000000, maximumGenerations: 1 }, expiresAt },
    candidate: { id: id(9), businessId: id(2), concept: 'Original botanical arrangement, internal working title only', audience: 'Adult nature enthusiasts', productType: 'original_pod_tshirt', originalDesign: true, rightsStatus: 'unclear' },
    observations,
    history: {acceptedReviewScopeId:id(7), acceptedReviewHash:digest('accepted review'), record:historicalRecord, recordHash:hash(historicalRecord), scopeChangeExplanation:'The broad commercial questions remain unresolved; this separately proposed pilot examines only one original design and its readability.', supportingEvidence:false},
    learningQuestion:'Can one original botanical composition remain distinct at the intended private preview sizes?',
    pinnedLearningPlan: {scope:'private_original_design_test',name:'Original composition readability test',hypothesis:'One original botanical composition can preserve its intended visual hierarchy at the fixed preview sizes.',deliverable:'One original PNG and a private fixed-size preview inspection record.',successCriteria:['Every intended element is distinguishable in the fixed preview and no unintended text appears.'],failureCriteria:['Any missing element, clipping or unreadable intended detail fails the private test.'],stopRule:'Stop after one generation and its independent review. Do not infer demand or authorize publication from a visual pass.',maximumMicrousd:100000,maximumGenerations:1,evidenceRefs:discoveryAddendumReferences(observations),budgetStatus:'proposal_only',generationAuthorized:false,spendingAuthorized:false,publicationAllowed:false,commerceAllowed:false},
    originalDesignConstraints:{noThirdPartyReferences:true,workingTitleOnly:true,forbiddenElements:['No copied reference artwork, named brands, logos, recognizable protected characters or likenesses.']},
    researchAllocationMicrousd:100000,maximumPaidCalls:2,paidRetryAllowed:false,executionAuthorized:false,createdAt,expiresAt};
  Object.assign(historicalRecord,{marketCountryCode:null,candidateId:null,sufficiencyRationale:'The broad commercial case lacks direct demand and production evidence.',dimensions:[],checks:[{check:'source_support',outcome:'FAIL',rationale:'The broad sources do not establish buyer demand for this candidate.'}],additionalUncertainties:[],executionPrerequisites:{ownerCreativeApproval:'required'},publicationAllowed:false,commerceAllowed:false,priorCandidateUncertainties:[{candidateId:p.candidate.id,concept:p.candidate.concept,dimensions:[{dimension:'demand',uncertainties:[{question:historicalRecord.missingQuestions[0],blockingForTest:true,reason:'Direct commercial demand was never established by the broad research.'}]}]}]});
  p.history.recordHash=hash(historicalRecord);
  return p;
}
function pins(p) {return {profileHash:hash(p),businessId:p.businessId,goalId:p.goalId,originalGoalId:p.originalGoalId,budgetAuthorityRootId:p.budgetAuthorityRootId,priorRoundId:p.priorRoundId,originalIntentHash:p.originalIntentHash,originalSemanticGoalHash:p.originalSemanticGoalHash,acceptedReviewScopeId:p.history.acceptedReviewScopeId,acceptedReviewHash:p.history.acceptedReviewHash,historicalRecordHash:p.history.recordHash,originalMaximumMicrousd:2000000};}
function validated(p = fixture()) {return c.validateFocusedPilotProfile(p,pins(p),now);}
function prepared(v) {const p=v.profile;return {intent:p.intent,dossier:{version:'pod-discovery-2.0',intentId:p.id,businessId:p.businessId,packRefs:[],shortlist:[p.candidate],comparisonRationale:'One explicitly scoped GB design question with retail context and official production guidance.',addendumRef:{artifactId:p.observations.id,sha256:hash(p.observations)}},validation:{},evidencePool:discoveryAddendumReferences(p.observations).map((reference,index)=>({key:`E${index+1}`,reference}))};}
const tinySchema = {type:'object',additionalProperties:false,required:['marketComparisons','candidates','recommendation','usesPinnedLearningPlan'],properties:{marketComparisons:{type:'array'},candidates:{type:'array'},recommendation:{type:'object'},usesPinnedLearningPlan:{type:'boolean'}}};
const response = (outcome='TEST', uses=true) => ({marketComparisons:[],candidates:[],recommendation:{proposedOutcome:outcome,marketCountryCode:'GB',candidateKey:'C1',rationale:'Synthetic response; substantive review is outside this projection unit test.',alternatives:[]},usesPinnedLearningPlan:uses});

test('focused zero-pack profile passes without renewing historical or observation timestamps',()=>{const p=fixture(),copy=structuredClone(p);const v=validated(p);assert.deepEqual(v.profile,copy);assert.deepEqual(c.focusedPilotContextBinding(v),{focusedPilotProfileHash:hash(p)});c.assertFocusedPilotDossier(v,prepared(v).intent,prepared(v).dossier);assert.throws(()=>validateDiscoveryIntentV2(p.intent,now),/geographic/);});
test('historical pack expiry is not a live supporting-source expiry',()=>{const p=fixture();p.history.record.sourceHistory[0].expiresAt='2026-10-06T08:00:00.000Z';p.history.recordHash=hash(p.history.record);assert.doesNotThrow(()=>validated(p));});
test('trusted profile mismatch and post-load mutation are denied',()=>{const p=fixture(),pin=pins(p);p.learningQuestion+=' changed';assert.throws(()=>c.validateFocusedPilotProfile(p,pin,now),/identity/);const v=validated();v.profile.researchAllocationMicrousd++;assert.throws(()=>c.focusedPilotContextBinding(v),/mutated/);});
test('new Goal, cumulative root cap, one GB candidate and no paid retry stay exact',()=>{for(const change of [p=>p.goalId=p.originalGoalId,p=>p.intent.limits.maximumMicrousd=100000,p=>p.intent.comparisonUniverse.markets.push({countryCode:'US',currency:'USD'}),p=>p.maximumPaidCalls=3,p=>p.paidRetryAllowed=true,p=>p.intent.limits.maximumNewCollections=1,p=>p.intent.limits.maximumGenerations=2,p=>p.candidate.originalDesign=false]){const p=fixture();change(p);assert.throws(()=>validated(p));}});
test('history cannot be marked evidence or changed without its pin',()=>{const p=fixture();p.history.supportingEvidence=true;assert.throws(()=>validated(p),/history/);const q=fixture();q.history.record.missingQuestions=[];assert.throws(()=>validated(q),/history/);});
test('old previousDecision and provider-pack substitutions are denied for focused dossier',()=>{const v=validated(),p=prepared(v);assert.throws(()=>c.assertFocusedPilotDossier(v,p.intent,p.dossier,{}),/dossier_binding/);p.dossier.packRefs=[{artifactId:id(20)}];assert.throws(()=>c.assertFocusedPilotDossier(v,p.intent,p.dossier),/dossier_binding/);});
test('expired observation cannot be rescued by a newly created profile',()=>{const p=fixture();p.observations.observations[0].expiresAt='2026-10-06T23:59:59.000Z';assert.throws(()=>validated(p),/addendum/);});
test('offer cannot support demand and Printful cannot replace observed market context',()=>{const p=fixture();p.observations.observations[0].dimensions.push('demand');assert.throws(()=>validated(p),/addendum/);const q=fixture();q.pinnedLearningPlan.evidenceRefs=q.pinnedLearningPlan.evidenceRefs.slice(1);assert.throws(()=>validated(q),/observed_market_basis/);});
test('static provider delta is private-value-free and does not mutate ordinary schema',()=>{const base=discoveryR12StaticSchema('strategy'),before=hash(base),schema=c.focusedPilotStrategySchema(base);assert.equal(hash(base),before);assert.equal(base.properties.marketComparisons.minItems,2);assert.equal(schema.properties.marketComparisons.minItems,1);assert.equal(schema.properties.marketComparisons.maxItems,1);assert.equal(schema.properties.candidates.maxItems,1);assert.equal(schema.properties.testPlan,undefined);assert.ok(schema.required.includes('usesPinnedLearningPlan'));assert.ok(!JSON.stringify(schema).includes('rapanui'));});
test('TEST explicit acceptance attaches exact pinned strings without asking the model to reproduce them',()=>{const v=validated(),p=prepared(v),out=c.expandFocusedStrategyResponse(v,p,response(),tinySchema);const {evidenceRefs,budgetStatus,generationAuthorized,spendingAuthorized,publicationAllowed,commerceAllowed,...expected}=v.profile.pinnedLearningPlan;assert.deepEqual(out.testPlan,{...expected,evidence:['E1','E2']});assert.equal(out.usesPinnedLearningPlan,undefined);assert.equal(out.testPlan.hypothesis,v.profile.pinnedLearningPlan.hypothesis);});
test('NME and REJECT preserve their choice and attach no plan',()=>{for(const outcome of ['REJECT','NEEDS_MORE_EVIDENCE']){const v=validated(),out=c.expandFocusedStrategyResponse(v,prepared(v),response(outcome,false),tinySchema);assert.equal(out.recommendation.proposedOutcome,outcome);assert.equal(out.testPlan,null);}});
test('no auto-conversion or contradictory plan acceptance',()=>{for(const [outcome,accept] of [['TEST',false],['REJECT',true],['NEEDS_MORE_EVIDENCE',true]]){const v=validated();assert.throws(()=>c.expandFocusedStrategyResponse(v,prepared(v),response(outcome,accept),tinySchema),/explicit_plan_acceptance/);}});
test('model-supplied plan override, missing pinned evidence and changed selected scope fail',()=>{const v=validated(),p=prepared(v);assert.throws(()=>c.expandFocusedStrategyResponse(v,p,{...response(),testPlan:{}},tinySchema));p.evidencePool.pop();assert.throws(()=>c.expandFocusedStrategyResponse(v,p,response(),tinySchema),/pinned_evidence_missing/);const r=response();r.recommendation.marketCountryCode='US';assert.throws(()=>c.expandFocusedStrategyResponse(v,prepared(v),r,tinySchema),/selected_scope/);});
test('root, Business, pilot cap and unknown exposure all remain binding',()=>{const p=fixture(),s={rootCommittedMicrousd:168570,rootMaximumMicrousd:2000000,businessCommittedMicrousd:705941,businessMaximumMicrousd:1053587,pilotCommittedMicrousd:0,hasUnknown:false};assert.doesNotThrow(()=>c.assertFocusedPilotFunding(p,s,99999));assert.throws(()=>c.assertFocusedPilotFunding(p,s,100001),/funding/);assert.throws(()=>c.assertFocusedPilotFunding(p,{...s,businessCommittedMicrousd:1053580},8),/funding/);assert.throws(()=>c.assertFocusedPilotFunding(p,{...s,rootCommittedMicrousd:1999999},2),/funding/);assert.throws(()=>c.assertFocusedPilotFunding(p,{...s,hasUnknown:true},1),/funding/);assert.throws(()=>c.assertFocusedPilotFunding(p,{...s,rootCommittedMicrousd:1,pilotCommittedMicrousd:2},1),/funding/);});

function actualPrepared(){
 const v=validated(),p=v.profile,base=prepared(v);
 const context={knowledge:discoveryKnowledgeFixture(now),packs:new Map(),candidates:new Map([[p.candidate.id,p.candidate]]),
  ownerRightsConfirmedCandidateIds:[p.candidate.id],sellerBankCountry:null,committedMicrousd:168570,evidenceAddendum:p.observations,focusedPilot:v};
 return worker.prepareDiscoveryWorkerContextV2(p.intent,base.dossier,context,discoveryAddendumReferences(p.observations),now);
}
function actualOutput(p){
 const retail=p.evidencePool.find(e=>e.sourceContext.kind==='retail_offer').key,production=p.evidencePool.find(e=>e.sourceContext.kind==='official_operating_fact').key;
 const dimensions=DIMENSIONS.map(d=>({dimension:d,finding:d==='competition'?'supported':'uncertain',evidenceStrength:d==='competition'?'direct':d==='production_complexity'?'guidance':'none',
  facts:d==='competition'?[{evidence:retail,relevance:'The exact GB offer supplies limited competing-category context only.'}]:d==='production_complexity'?[{evidence:production,relevance:'The exact official source bounds the proposed production-file constraints.'}]:[],
  rationale:'This finding is limited to the private original-design question and establishes no commercial readiness.',
  uncertainties:d==='competition'?[]:[{question:`What further evidence resolves ${d} before actual commerce?`,blockingForTest:false,reason:'This private composition inspection does not measure sales or assert launch readiness; the question remains unresolved.'}],hardFailure:false}));
 return{usesPinnedLearningPlan:true,marketComparisons:[{countryCode:'GB',currency:'GBP',assessment:'This single market is the pilot scope; one offer supplies category context without establishing buyer demand.',evidence:[retail],assumptions:['No inference of observed sales or representative demand is made.'],limitations:['Actual buyers, profitability and physical print quality remain untested.'],sellerBankCountry:null,feeScenarios:[{sellerBankCountry:'GB',hypothetical:true,explanation:'This hypothetical seller scenario establishes no actual fee, bank location or unit margin.',evidence:[]}]}],
  candidates:[{candidateKey:'C1',dimensions}],recommendation:{proposedOutcome:'TEST',marketCountryCode:'GB',candidateKey:'C1',rationale:'The private original-composition experiment can answer its fixed question with explicit limits; commercial unknowns remain.',alternatives:[]}};
}
test('real focused worker context and semantic normalizer retain exact plan, scope and historical pins',()=>{
 const p=actualPrepared(),request=worker.buildStrategistRequestV2(p,now),output=actualOutput(p);
 assert.equal(p.validation.focusedPilot.profileHash,p.validation.focusedPilot.profile&&hash(p.validation.focusedPilot.profile));
 assert.equal(request.requestMetadata.r12FocusedPilotProfileHash,p.validation.focusedPilot.profileHash);
 assert.equal(request.outputSchema.properties.testPlan,undefined);assert.ok(request.outputSchema.properties.usesPinnedLearningPlan);
 assertJsonSchemaValue(request.outputSchema,output,'Focused fixture response');
 const execution={modelId:'openai/gpt-5.6-luna',providerRequestId:'provider-focused-strategy',primaryOnly:true};
 const assessment=worker.normalizeStrategistResponseV2(p,output,execution,now);
 assert.equal(assessment.recommendation.proposedOutcome,'TEST');assert.deepEqual(assessment.testPlan,p.validation.focusedPilot.profile.pinnedLearningPlan);
 assert.equal(p.validation.previousDecision,undefined);assert.equal(p.validation.focusedPilot.profile.history.record.outcome,'NEEDS_MORE_EVIDENCE');
 assert.doesNotThrow(()=>worker.buildReviewerRequestV2(p,assessment,execution,now));
 const wrong=structuredClone(output);wrong.candidates[0].dimensions.find(d=>d.dimension==='estimated_margin').facts=[{evidence:p.evidencePool.find(e=>e.sourceContext.kind==='official_operating_fact').key,relevance:'An operating fact cannot substantiate an estimated margin or sales claim.'}];wrong.candidates[0].dimensions.find(d=>d.dimension==='estimated_margin').evidenceStrength='guidance';
 assert.throws(()=>worker.normalizeStrategistResponseV2(p,wrong,execution,now),/unapproved evidence role/);
});
test('focused profile cannot silently alter immutable measurements or enter ordinary discovery admission',()=>{
 const p=actualPrepared(),changed=structuredClone(p);changed.validation.focusedPilot.profile.pinnedLearningPlan.hypothesis+=' Changed.';
 assert.throws(()=>worker.buildStrategistRequestV2(changed,now),/profile|intent|Focused|binding/i);
 const ordinary={...p.validation};delete ordinary.focusedPilot;
 assert.throws(()=>validateDiscoveryDossierV2(p.intent,p.dossier,ordinary,now),/geographic/);
});
