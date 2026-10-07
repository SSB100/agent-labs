// Synthetic public observations and compact output only. No provider or authority.
import {createHash} from 'node:crypto';
import c from '../../.core-tests/products/discovery-r12-focused-pilot-contract.js';
import {discoveryV2Hash as hash} from '../../.core-tests/products/discovery-v2.js';
import {discoveryAddendumReferences} from '../../.core-tests/products/discovery-r12-evidence-addendum.js';
import {DIMENSIONS} from '../../.core-tests/products/types.js';
const id = n => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const digest = text => createHash('sha256').update(text).digest('hex');
const now = Date.parse('2026-10-07T00:00:00.000Z');
export function focusedProfileFixture() {
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
  return p;
}
export function focusedStrategyOutput(p){
 const retail=p.evidencePool.find(e=>e.sourceContext.kind==='retail_offer').key,production=p.evidencePool.find(e=>e.sourceContext.kind==='official_operating_fact').key;
 const dimensions=DIMENSIONS.map(d=>({dimension:d,finding:d==='competition'?'supported':'uncertain',evidenceStrength:d==='competition'?'direct':d==='production_complexity'?'guidance':'none',
  facts:d==='competition'?[{evidence:retail,relevance:'The exact GB offer supplies limited competing-category context only.'}]:d==='production_complexity'?[{evidence:production,relevance:'The exact official source bounds the proposed production-file constraints.'}]:[],
  rationale:'This finding is limited to the private original-design question and establishes no commercial readiness.',
  uncertainties:d==='competition'?[]:[{question:`What further evidence resolves ${d} before actual commerce?`,blockingForTest:false,reason:'This private composition inspection does not measure sales or assert launch readiness; the question remains unresolved.'}],hardFailure:false}));
 return{usesPinnedLearningPlan:true,marketComparisons:[{countryCode:'GB',currency:'GBP',assessment:'This single market is the pilot scope; one offer supplies category context without establishing buyer demand.',evidence:[retail],assumptions:['No inference of observed sales or representative demand is made.'],limitations:['Actual buyers, profitability and physical print quality remain untested.'],sellerBankCountry:null,feeScenarios:[{sellerBankCountry:'GB',hypothetical:true,explanation:'This hypothetical seller scenario establishes no actual fee, bank location or unit margin.',evidence:[]}]}],
  candidates:[{candidateKey:'C1',dimensions}],recommendation:{proposedOutcome:'TEST',marketCountryCode:'GB',candidateKey:'C1',rationale:'The private original-composition experiment can answer its fixed question with explicit limits; commercial unknowns remain.',alternatives:[]}};
}
