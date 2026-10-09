// Synthetic contract fixture only. It grants no source permission and makes
// no claim about a shop, demand, real evidence or provider execution.
import { discoveryV2Hash } from '../../.core-tests/products/discovery-v2.js';
import { prepareOwnerResearchPreview, ownerResearchExecutionIntent } from '../../.core-tests/products/discovery-r12-goal-preparation-contract.js';
import { r12QuoteFixture } from './r12-provider-fixture.mjs';
export const ownerGoalId = n => `12080000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export function ownerGoalFixture(now = Date.now()) {
  const profile = {
    version: 'r12.owner-research-profile.1', id: ownerGoalId(3), title: 'Synthetic adult apparel source profile',
    purpose: 'Evaluate original POD T-shirt opportunities using scoped public factual snippets. Fixture only.',
    marketSets: [{key:'gb',label:'United Kingdom',markets:[{countryCode:'GB',currency:'GBP'}]}, {key:'us-gb',label:'United States and United Kingdom',markets:[{countryCode:'US',currency:'USD'},{countryCode:'GB',currency:'GBP'}]}],
    topics: [{key:'gardening',label:'Adult gardening interests',audience:'Adult gardening enthusiasts',queryTopic:'original gardening-inspired T-shirt buying criteria'},
      {key:'astronomy',label:'Adult astronomy interests',audience:'Adult astronomy enthusiasts',queryTopic:'original astronomy-inspired T-shirt buying criteria'}],
    queryTemplate:'Evaluate dated aggregate evidence in {{markets}} relevant to {{topic}} for {{audience}}. Retain dates, population and denominator limits; separate adjacent interest from observed purchases.',
    allowedDomains:['research.example'], excludedDomains:['etsy.com','etsy.me','etsystatic.com'],
    sourceReviews:[{domain:'research.example',basis:'documented_api_factual_snippets',reviewHash:'a'.repeat(64)}],
    independentReviewHash:'b'.repeat(64),purposeReviewHash:'c'.repeat(64),maximumRunMicrousd:1000000,
    validFrom:new Date(now-60000).toISOString(),validUntil:new Date(now+86400000).toISOString(),
  };
  const input = {businessId:ownerGoalId(1),goalId:ownerGoalId(2),goalRevision:4,profileId:profile.id,profileHash:discoveryV2Hash(profile),grantId:ownerGoalId(4),
    marketSetKey:'gb',topicKey:'gardening',businessLifetimeLimitMicrounits:'6000000',researchLifetimeLimitMicrounits:'2000000',submissionId:ownerGoalId(5)};
  const current = {
    business:{id:input.businessId,revision:3,hash:'d'.repeat(64),capRevision:2,maximumMicrounits:'5000000',committedMicrounits:'4800000',hasUnknown:false,paused:false},
    goal:{id:input.goalId,businessId:input.businessId,revision:4,hash:'e'.repeat(64),preference:'ready',content:{title:'Choose the next original apparel opportunity',
      originalIntent:'Investigate the next original POD T-shirt opportunity for adult buyers.',objective:'Investigate the next original POD T-shirt opportunity for adult buyers.',parsed:{},ambiguities:[]},initialRunExists:false},
    profile,
    funding:{binding:{kind:'legacy_research_root',bindingId:ownerGoalId(6),authorityRootId:ownerGoalId(7),priorRoundId:ownerGoalId(8),originalSemanticGoalHash:'f'.repeat(64)},
      revision:0,hash:'1'.repeat(64),maximumMicrounits:'2000000',committedMicrounits:'190000',pendingMicrounits:'0',hasUnknown:false},
    quote:r12QuoteFixture(now),
  };
  const preview = prepareOwnerResearchPreview(input,current,now), scopeId=ownerGoalId(9),expiresAt=new Date(now+3600000).toISOString();
  const scope = {version:'r12.discovery-owner-initial.1',id:scopeId,businessId:input.businessId,goalId:input.goalId,goalRevision:current.goal.revision,goalHash:current.goal.hash,
    businessRevision:current.business.revision,businessHash:current.business.hash,setupId:ownerGoalId(10),setupHash:'2'.repeat(64),profile,profileHash:input.profileHash,
    selection:{marketSetKey:input.marketSetKey,topicKey:input.topicKey},funding:current.funding.binding,
    fundingApproval:{revision:0,hash:current.funding.hash,maximumMicrounits:input.researchLifetimeLimitMicrounits},
    intent:ownerResearchExecutionIntent(preview,scopeId,expiresAt),allowedDomains:preview.sourceDomains,excludedDomains:preview.excludedDomains,approvedQuery:preview.approvedQuery,
    approvalHash:'3'.repeat(64),independentReviewHash:profile.independentReviewHash,createdAt:new Date(now).toISOString(),expiresAt};
  return {now,profile,input,current,preview,scope};
}
