import type {EtsyInsightsScope} from './etsy-insights-contracts';
import type {EtsyRequestMetadata} from './etsy-request-admission';
import {classifyEtsyInsightsRendererRequest,ETSY_INSIGHTS_DEFAULT_RENDERER_POLICY} from './etsy-insights-renderer-policy';
import {validateEtsyInsightsVerificationCandidate,etsyInsightsVerificationCandidateHash,classifyEtsyInsightsVerificationCandidateRequest,type EtsyInsightsVerificationCandidatePolicy,type EtsyInsightsCandidateMetadata,type EtsyInsightsCandidateDisposition} from './etsy-insights-renderer-candidate';
import {insightsExact,insightsFail,insightsHash,insightsIsHash,insightsUuid} from './etsy-insights-policy';

/** Research has distinct authority; the nested candidate supplies only the
 * exact external transport constraints actually used by account verification. */
export type EtsyInsightsResearchRendererPolicy={version:'etsy.insights-renderer-research-policy.4';purpose:'etsy_insights_aggregate_research';
 maximumRequests:number;navigation:'fixed_insights_query_get_only';sameOrigin:'renderer_get_only';post:'denied';extraction:'visible_aggregate_dom_only';
 candidatePolicy:EtsyInsightsVerificationCandidatePolicy;candidatePolicyHash:string;
};
export type EtsyInsightsResearchReadiness={version:'etsy.insights-research-readiness.1';verificationOperationId:string;verificationHash:string;verifiedContextHash:string;
 candidatePolicyHash:string;providerProjectId:string;profileBindingId:string;profileBindingRevision:string;accountBindingHash:string;expiresAt:string};
export function isEtsyInsightsResearchRendererPolicy(raw:unknown):raw is EtsyInsightsResearchRendererPolicy{
 return !!raw&&typeof raw==='object'&&(raw as {version?:unknown}).version==='etsy.insights-renderer-research-policy.4';
}
export function validateEtsyInsightsResearchRendererPolicy(raw:unknown):EtsyInsightsResearchRendererPolicy{
 if(!insightsExact(raw,'version,purpose,maximumRequests,navigation,sameOrigin,post,extraction,candidatePolicy,candidatePolicyHash')||!isEtsyInsightsResearchRendererPolicy(raw))return insightsFail('renderer_research_policy_invalid');
 const p=raw,candidate=validateEtsyInsightsVerificationCandidate(p.candidatePolicy);
 if(p.purpose!=='etsy_insights_aggregate_research'||p.navigation!=='fixed_insights_query_get_only'||p.sameOrigin!=='renderer_get_only'||p.post!=='denied'||p.extraction!=='visible_aggregate_dom_only'||
  p.candidatePolicyHash!==etsyInsightsVerificationCandidateHash(candidate)||!Number.isSafeInteger(p.maximumRequests)||p.maximumRequests<1||p.maximumRequests>candidate.maximumRequests)return insightsFail('renderer_research_policy_invalid');
 return structuredClone(p);
}
export const etsyInsightsResearchRendererPolicyHash=(p:EtsyInsightsResearchRendererPolicy)=>insightsHash(validateEtsyInsightsResearchRendererPolicy(p));
/** Trusted SQL must derive this sidecar from the actual saved verification,
 * accepted release/accounting, immutable route review and current approval.
 * A model/browser/caller-provided object is never readiness authority. */
export function validateEtsyInsightsResearchReadiness(raw:unknown,scope:EtsyInsightsScope,policy:EtsyInsightsResearchRendererPolicy,now:number):EtsyInsightsResearchReadiness{
 if(!insightsExact(raw,'version,verificationOperationId,verificationHash,verifiedContextHash,candidatePolicyHash,providerProjectId,profileBindingId,profileBindingRevision,accountBindingHash,expiresAt'))return insightsFail('renderer_research_readiness_invalid');
 const r=raw as EtsyInsightsResearchReadiness,b=scope.accountBinding;
 if(r.version!=='etsy.insights-research-readiness.1'||![r.verificationOperationId,r.providerProjectId,r.profileBindingId,r.profileBindingRevision].every(insightsUuid)||
  ![r.verificationHash,r.verifiedContextHash,r.candidatePolicyHash,r.accountBindingHash].every(insightsIsHash)||r.verificationOperationId===scope.operationId||
  r.verificationHash!==b.accountVerificationHash||r.verifiedContextHash!==b.verifiedContextHash||r.candidatePolicyHash!==policy.candidatePolicyHash||r.providerProjectId!==scope.providerProjectId||
  r.profileBindingId!==b.profileBindingId||r.profileBindingRevision!==b.profileBindingRevision||r.accountBindingHash!==b.bindingHash||
  !Number.isFinite(Date.parse(r.expiresAt))||Date.parse(r.expiresAt)<=now||Date.parse(r.expiresAt)>Math.min(Date.parse(scope.expiresAt),Date.parse(b.expiresAt)))return insightsFail('renderer_research_readiness_invalid');
 return structuredClone(r);
}
export function classifyEtsyInsightsResearchRendererRequest(raw:EtsyInsightsResearchRendererPolicy,r:EtsyRequestMetadata,query:string):{metadata:EtsyInsightsCandidateMetadata;disposition:EtsyInsightsCandidateDisposition}{
 const p=validateEtsyInsightsResearchRendererPolicy(raw);let u:URL;try{u=new URL(r.url);}catch{return insightsFail('renderer_request_denied');}
 if(typeof query!=='string'||!query.trim()||query.length>160)return insightsFail('renderer_query_mismatch');
 if(u.origin==='https://www.etsy.com'){
  // The original fixed-navigation and query checks still gate every request.
  classifyEtsyInsightsRendererRequest({...ETSY_INSIGHTS_DEFAULT_RENDERER_POLICY,maximumRequests:p.maximumRequests},r,query);
  return{metadata:{requestKind:'same_origin',url:r.url,method:r.method,resourceType:r.resourceType,navigation:r.navigation},disposition:'allow'};
 }
 return classifyEtsyInsightsVerificationCandidateRequest(p.candidatePolicy,r);
}
