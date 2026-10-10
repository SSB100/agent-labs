import { insightsExact, insightsFail, insightsHash } from './etsy-insights-policy';
export type EtsyInsightsRendererPolicy={
 version:'etsy.insights-renderer-policy.1';staticOrigins:string[];maximumRequests:number;
 navigation:'fixed_insights_get_only';sameOrigin:'renderer_get_only';post:'denied';extraction:'visible_aggregate_dom_only';
};
/** No CDN origin is guessed or automatically trusted from page content. A server
 * qualification may pin a reviewed first-party static-origin allowlist. The
 * empty default honestly pauses when required assets fall outside the policy. */
export const ETSY_INSIGHTS_DEFAULT_RENDERER_POLICY:EtsyInsightsRendererPolicy=Object.freeze({
 version:'etsy.insights-renderer-policy.1',staticOrigins:Object.freeze([]) as unknown as string[],maximumRequests:256,
 navigation:'fixed_insights_get_only',sameOrigin:'renderer_get_only',post:'denied',extraction:'visible_aggregate_dom_only',
});
export function validateEtsyInsightsRendererPolicy(raw:unknown):EtsyInsightsRendererPolicy{
 if(!insightsExact(raw,'version,staticOrigins,maximumRequests,navigation,sameOrigin,post,extraction'))return insightsFail('renderer_policy_invalid');
 const p=raw as EtsyInsightsRendererPolicy;
 if(p.version!=='etsy.insights-renderer-policy.1'||p.navigation!=='fixed_insights_get_only'||p.sameOrigin!=='renderer_get_only'||p.post!=='denied'||p.extraction!=='visible_aggregate_dom_only'||
   !Number.isSafeInteger(p.maximumRequests)||p.maximumRequests<1||p.maximumRequests>512||!Array.isArray(p.staticOrigins)||p.staticOrigins.length>8||new Set(p.staticOrigins).size!==p.staticOrigins.length)return insightsFail('renderer_policy_invalid');
 for(const rawOrigin of p.staticOrigins){let u:URL;try{u=new URL(rawOrigin);}catch{return insightsFail('renderer_policy_invalid');}
  if(u.origin!==rawOrigin||u.protocol!=='https:'||u.port||u.username||u.password||!u.hostname.endsWith('.etsystatic.com'))return insightsFail('renderer_static_origin_unreviewed');}
 return structuredClone(p);
}
export const etsyInsightsRendererPolicyHash=(policy:EtsyInsightsRendererPolicy)=>insightsHash(validateEtsyInsightsRendererPolicy(policy));
export function admitEtsyInsightsRendererRequest(policy:EtsyInsightsRendererPolicy,r:{url:string;method:string;resourceType:string;navigation:boolean},query:string|null):void{
 const p=validateEtsyInsightsRendererPolicy(policy);let u:URL;try{u=new URL(r.url);}catch{return insightsFail('renderer_request_denied');}
 if(r.method!=='GET'||u.protocol!=='https:'||u.username||u.password||u.port||u.hash||r.url.length>4000)return insightsFail('renderer_request_denied');
 const landing='/your/shops/me/marketplace-insights';
 if(r.navigation){
  if(u.origin!=='https://www.etsy.com'||!['document'].includes(r.resourceType)||
    u.pathname!==landing&&(query===null||u.pathname!==`${landing}/search`)||u.pathname===landing&&u.search)return insightsFail('renderer_navigation_denied');
  if(u.pathname.endsWith('/search')&&(u.searchParams.getAll('query').length!==1||u.searchParams.get('query')!==query||[...u.searchParams.keys()].some(k=>!['query','search_trigger'].includes(k))||
    u.searchParams.getAll('search_trigger').length>1||u.searchParams.has('search_trigger')&&u.searchParams.get('search_trigger')!=='landing_search_bar'))return insightsFail('renderer_navigation_denied');
  return;
 }
 if(!['script','stylesheet','image','font','fetch','xhr','other'].includes(r.resourceType))return insightsFail('renderer_request_denied');
 if(u.origin!=='https://www.etsy.com'){
  if(!p.staticOrigins.includes(u.origin)||!['script','stylesheet','image','font'].includes(r.resourceType))return insightsFail('renderer_asset_blocked');
  return;
 }
 let path=u.pathname;try{for(let i=0;i<3;i++){const decoded=decodeURIComponent(path);if(decoded===path)break;path=decoded;}}catch{return insightsFail('renderer_request_denied');}
 if(/(?:^|\/)(?:sign-?in|sign-?out|log-?in|log-?out|register|registration|cart|checkout|orders?|messages?|customers?|payments?|billing|finances?|settings|security|password|oauth)(?:\/|$)/i.test(path)||
  [...u.searchParams.keys()].some(k=>/token|auth|secret|password|session|code|email/i.test(k)))return insightsFail('renderer_private_path_denied');
 for(const key of ['query','q','search_query','search_term'])if(u.searchParams.has(key)&&(query===null||u.searchParams.getAll(key).length!==1||u.searchParams.get(key)!==query))return insightsFail('renderer_query_mismatch');
}
