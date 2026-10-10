import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {landingFixture,controls,hash} from './etsy-insights-landing-fixture.mjs';
import {id} from './etsy-insights-playwright-fixture.mjs';
const load=name=>import(pathToFileURL(resolve(process.env.R12_INSIGHTS_CORE_DIR||'.core-tests','browser',name+'.js')).href);
const {ETSY_INSIGHTS_VERIFICATION_CANDIDATE_POLICY:C,etsyInsightsVerificationCandidateHash}=await load('etsy-insights-renderer-candidate');
const {etsyInsightsResearchRendererPolicyHash}=await load('etsy-insights-renderer-research');
const {createEtsyInsightsPlaywrightPort}=await load('etsy-insights-playwright');
export const researchPolicy={version:'etsy.insights-renderer-research-policy.4',purpose:'etsy_insights_aggregate_research',maximumRequests:C.maximumRequests,navigation:'fixed_insights_query_get_only',sameOrigin:'renderer_get_only',post:'denied',extraction:'visible_aggregate_dom_only',candidatePolicy:C,candidatePolicyHash:etsyInsightsVerificationCandidateHash(C)};
export const researchReadiness=(s,changes={})=>({version:'etsy.insights-research-readiness.1',verificationOperationId:id(199),verificationHash:s.accountBinding.accountVerificationHash,verifiedContextHash:s.accountBinding.verifiedContextHash,candidatePolicyHash:researchPolicy.candidatePolicyHash,providerProjectId:s.providerProjectId,profileBindingId:s.accountBinding.profileBindingId,profileBindingRevision:s.accountBinding.profileBindingRevision,accountBindingHash:s.accountBinding.bindingHash,expiresAt:s.expiresAt,...changes});
export const researchQualification=(s,changes={})=>{const body={version:'r12.etsy-insights-renderer-qualification.3',requestHash:hash(s),expiresAt:s.expiresAt,maximumRequests:researchPolicy.maximumRequests,policy:researchPolicy,policyHash:etsyInsightsResearchRendererPolicyHash(researchPolicy),landingControlsVersion:controls.ETSY_INSIGHTS_LANDING_CONTROLS_VERSION,landingControlsHash:controls.ETSY_INSIGHTS_LANDING_CONTROLS_HASH,readiness:researchReadiness(s),...changes};return{...body,qualificationHash:hash(body)};};
/** Inert trusted-lookup fixture, not an actual verification or account grant. */
export function researchRendererFixture(options={}){
 let f;const requests=[];
 const o={...options,beforeNavigate:async url=>{await f.request(url);if(options.candidateBlock!==false)await f.request('https://bat.bing.com/bat.js',{resourceType:'Script'});await options.beforeNavigate?.(url);},beforeSubmit:async url=>{await f.request(url);if(options.resultRequest)await f.request(options.resultRequest.url,{resourceType:options.resultRequest.resourceType??'Script'});await options.beforeSubmit?.(url);}};
 f=landingFixture(o);f.input.qualifyRenderer=async()=>researchQualification(f.s,{readiness:researchReadiness(f.s,options.readiness),...options.qualification});
 f.input.admitRenderer=async r=>{if(r.version!=='r12.etsy-insights-renderer-request.3')throw Error('wrong request version');const{decisionHash,...body}=r;if(hash(body)!==decisionHash)throw Error('wrong decision hash');requests.push(structuredClone(r));if(options.rendererDenied)throw Error('inert renderer denial');};
 f.port=createEtsyInsightsPlaywrightPort(f.input);return{...f,rendererRequests:requests};
}
