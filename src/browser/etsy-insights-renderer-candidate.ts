import {ETSY_INSIGHTS_CANDIDATE_MANIFEST,ETSY_INSIGHTS_CANDIDATE_MANIFEST_HASH,type EtsyInsightsCandidateReference} from './etsy-insights-renderer-candidate-evidence';
import {classifyEtsyInsightsRendererRequest,ETSY_INSIGHTS_DEFAULT_RENDERER_POLICY} from './etsy-insights-renderer-policy';
import {insightsExact,insightsFail,insightsHash} from './etsy-insights-policy';
import type {EtsyRequestMetadata} from './etsy-request-admission';
export type EtsyInsightsVerificationCandidatePolicy={
 version:'etsy.insights-renderer-candidate-policy.3';purpose:'etsy_insights_verify_only';
 maximumRequests:number;navigation:'fixed_insights_get_only';sameOrigin:'renderer_get_only';post:'denied';
 extraction:'visible_landing_readiness_only';provenanceHash:string;
 allowedImages:Readonly<EtsyInsightsCandidateReference>[];blockedCandidates:Readonly<EtsyInsightsCandidateReference>[];
};
export type EtsyInsightsCandidateDisposition='allow'|'deny_candidate_ancillary';
export type EtsyInsightsCandidateMetadata={requestKind:'same_origin';url:string;method:string;resourceType:string;navigation:boolean}|
 {requestKind:'external';origin:string;pathnameHash:string;hasQuery:boolean;method:'GET';resourceType:'image'|'script';navigation:false};
/** This is only a proposed request boundary. It carries no account-readiness,
 * profile, admission, source-research, provider, or spending authority. */
export const ETSY_INSIGHTS_VERIFICATION_CANDIDATE_POLICY:EtsyInsightsVerificationCandidatePolicy=Object.freeze({
 version:'etsy.insights-renderer-candidate-policy.3',purpose:'etsy_insights_verify_only',maximumRequests:256,
 navigation:'fixed_insights_get_only',sameOrigin:'renderer_get_only',post:'denied',extraction:'visible_landing_readiness_only',
 provenanceHash:ETSY_INSIGHTS_CANDIDATE_MANIFEST_HASH,
 allowedImages:[...ETSY_INSIGHTS_CANDIDATE_MANIFEST.allowedImages],blockedCandidates:[...ETSY_INSIGHTS_CANDIDATE_MANIFEST.blockedCandidates],
});
export function isEtsyInsightsVerificationCandidate(raw:unknown):raw is EtsyInsightsVerificationCandidatePolicy{
 return !!raw&&typeof raw==='object'&&(raw as {version?:unknown}).version==='etsy.insights-renderer-candidate-policy.3';
}
export function validateEtsyInsightsVerificationCandidate(raw:unknown):EtsyInsightsVerificationCandidatePolicy{
 if(!insightsExact(raw,'version,purpose,maximumRequests,navigation,sameOrigin,post,extraction,provenanceHash,allowedImages,blockedCandidates')||!isEtsyInsightsVerificationCandidate(raw))return insightsFail('renderer_candidate_invalid');
 const p=raw;
 if(p.purpose!=='etsy_insights_verify_only'||p.navigation!=='fixed_insights_get_only'||p.sameOrigin!=='renderer_get_only'||p.post!=='denied'||p.extraction!=='visible_landing_readiness_only'||
  p.provenanceHash!==ETSY_INSIGHTS_CANDIDATE_MANIFEST_HASH||!Number.isSafeInteger(p.maximumRequests)||p.maximumRequests<1||p.maximumRequests>512)return insightsFail('renderer_candidate_invalid');
 const subset=(rows:unknown,observed:readonly Readonly<EtsyInsightsCandidateReference>[])=>Array.isArray(rows)&&rows.length<=64&&new Set(rows.map(insightsHash)).size===rows.length&&
  rows.every(r=>insightsExact(r,'origin,pathnameHash,hasQuery,method,resourceType')&&observed.some(o=>insightsHash(r)===insightsHash(o)));
 if(!subset(p.allowedImages,ETSY_INSIGHTS_CANDIDATE_MANIFEST.allowedImages)||!subset(p.blockedCandidates,ETSY_INSIGHTS_CANDIDATE_MANIFEST.blockedCandidates))return insightsFail('renderer_candidate_unobserved');
 return structuredClone(p);
}
export const etsyInsightsVerificationCandidateHash=(p:EtsyInsightsVerificationCandidatePolicy)=>insightsHash(validateEtsyInsightsVerificationCandidate(p));
/** No request/response body, header, credential, query value, owner CDN path, or
 * support account identifier leaves this external metadata boundary. */
export function classifyEtsyInsightsVerificationCandidateRequest(raw:EtsyInsightsVerificationCandidatePolicy,r:EtsyRequestMetadata):{metadata:EtsyInsightsCandidateMetadata;disposition:EtsyInsightsCandidateDisposition}{
 const p=validateEtsyInsightsVerificationCandidate(raw);let u:URL;try{u=new URL(r.url);}catch{return insightsFail('renderer_request_denied');}
 if(r.method!=='GET'||u.protocol!=='https:'||u.username||u.password||u.port||u.hash||r.url.length>4000)return insightsFail('renderer_request_denied');
 if(u.origin==='https://www.etsy.com'){
  // Reuse the unchanged strict fixed no-query navigation/private-path guard.
  classifyEtsyInsightsRendererRequest({...ETSY_INSIGHTS_DEFAULT_RENDERER_POLICY,maximumRequests:p.maximumRequests},r,null);
  return{metadata:{requestKind:'same_origin',url:r.url,method:r.method,resourceType:r.resourceType,navigation:r.navigation},disposition:'allow'};
 }
 if(r.navigation||!['image','script'].includes(r.resourceType))return insightsFail('renderer_candidate_material_request_denied');
 const identity:EtsyInsightsCandidateReference={origin:u.origin,pathnameHash:insightsHash(u.pathname),hasQuery:!!u.search,method:'GET',resourceType:r.resourceType as 'image'|'script'};
 const matches=(row:Readonly<EtsyInsightsCandidateReference>)=>insightsHash(row)===insightsHash(identity);
 const disposition=p.allowedImages.some(matches)?'allow':p.blockedCandidates.some(matches)?'deny_candidate_ancillary':null;
 if(!disposition)return insightsFail('renderer_asset_blocked');
 // Even a corrupted caller cannot turn a candidate script/query into permission.
 if(disposition==='allow'&&(identity.origin!=='https://i.etsystatic.com'||identity.resourceType!=='image'||identity.hasQuery))return insightsFail('renderer_candidate_invalid');
 return{metadata:{requestKind:'external',...identity,navigation:false},disposition};
}
