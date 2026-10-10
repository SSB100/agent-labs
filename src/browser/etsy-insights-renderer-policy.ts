import {ETSY_RENDERER_DOM_REFERENCE_MANIFEST, ETSY_RENDERER_DOM_REFERENCE_HASH, type EtsyObservedRendererReference} from './etsy-insights-renderer-evidence';
import { insightsExact, insightsFail, insightsHash } from './etsy-insights-policy';
type BasePolicy={staticOrigins:string[];maximumRequests:number;
 navigation:'fixed_insights_get_only';sameOrigin:'renderer_get_only';post:'denied';extraction:'visible_aggregate_dom_only';
};
export type EtsyInsightsRendererPolicy=BasePolicy&({version:'etsy.insights-renderer-policy.1'}|{version:'etsy.insights-renderer-policy.2';staticAssets:EtsyObservedRendererReference[];optionalTelemetry:EtsyObservedRendererReference[];provenanceHash:string});
export type EtsyRendererDisposition='allow'|'deny_optional_telemetry';
/** No CDN origin is guessed or automatically trusted from page content. A server
 * qualification may pin a reviewed first-party static-origin allowlist. The
 * empty default honestly pauses when required assets fall outside the policy. */
export const ETSY_INSIGHTS_DEFAULT_RENDERER_POLICY:EtsyInsightsRendererPolicy=Object.freeze({
 version:'etsy.insights-renderer-policy.1',staticOrigins:Object.freeze([]) as unknown as string[],maximumRequests:256,
 navigation:'fixed_insights_get_only',sameOrigin:'renderer_get_only',post:'denied',extraction:'visible_aggregate_dom_only',
});
export function validateEtsyInsightsRendererPolicy(raw:unknown):EtsyInsightsRendererPolicy{
 const v2=!!raw&&typeof raw==='object'&&(raw as {version?:unknown}).version==='etsy.insights-renderer-policy.2';
 if(!insightsExact(raw,'version,staticOrigins,maximumRequests,navigation,sameOrigin,post,extraction'+(v2?',staticAssets,optionalTelemetry,provenanceHash':'')))return insightsFail('renderer_policy_invalid');
 const p=raw as EtsyInsightsRendererPolicy;
 if(!['etsy.insights-renderer-policy.1','etsy.insights-renderer-policy.2'].includes(p.version)||p.navigation!=='fixed_insights_get_only'||p.sameOrigin!=='renderer_get_only'||p.post!=='denied'||p.extraction!=='visible_aggregate_dom_only'||
   !Number.isSafeInteger(p.maximumRequests)||p.maximumRequests<1||p.maximumRequests>512||!Array.isArray(p.staticOrigins)||p.staticOrigins.length>8||new Set(p.staticOrigins).size!==p.staticOrigins.length)return insightsFail('renderer_policy_invalid');
 for(const rawOrigin of p.staticOrigins){let u:URL;try{u=new URL(rawOrigin);}catch{return insightsFail('renderer_policy_invalid');}
  if(u.origin!==rawOrigin||u.protocol!=='https:'||u.port||u.username||u.password||!u.hostname.endsWith('.etsystatic.com'))return insightsFail('renderer_static_origin_unreviewed');}
 if(p.version==='etsy.insights-renderer-policy.2'){
  if(p.staticOrigins.length||p.provenanceHash!==ETSY_RENDERER_DOM_REFERENCE_HASH)return insightsFail('renderer_provenance_unverified');
  const subset=(rows:unknown,observed:readonly EtsyObservedRendererReference[])=>Array.isArray(rows)&&rows.length<=32&&new Set(rows.map(insightsHash)).size===rows.length&&rows.every(r=>insightsExact(r,'origin,path,method,resourceType')&&observed.some(o=>insightsHash(o)===insightsHash(r)));
  if(!subset(p.staticAssets,ETSY_RENDERER_DOM_REFERENCE_MANIFEST.images)||!subset(p.optionalTelemetry,ETSY_RENDERER_DOM_REFERENCE_MANIFEST.optionalTelemetry))return insightsFail('renderer_reference_unobserved');
 }
 return structuredClone(p);
}
export const etsyInsightsRendererPolicyHash=(policy:EtsyInsightsRendererPolicy)=>insightsHash(validateEtsyInsightsRendererPolicy(policy));
export function classifyEtsyInsightsRendererRequest(policy:EtsyInsightsRendererPolicy,r:{url:string;method:string;resourceType:string;navigation:boolean},query:string|null):EtsyRendererDisposition{
 const p=validateEtsyInsightsRendererPolicy(policy);let u:URL;try{u=new URL(r.url);}catch{return insightsFail('renderer_request_denied');}
 if(r.method!=='GET'||u.protocol!=='https:'||u.username||u.password||u.port||u.hash||r.url.length>4000)return insightsFail('renderer_request_denied');
 const landing='/your/shops/me/marketplace-insights';
 if(r.navigation){
  if(u.origin!=='https://www.etsy.com'||!['document'].includes(r.resourceType)||
    u.pathname!==landing&&(query===null||u.pathname!==`${landing}/search`)||u.pathname===landing&&u.search)return insightsFail('renderer_navigation_denied');
  if(u.pathname.endsWith('/search')&&(u.searchParams.getAll('query').length!==1||u.searchParams.get('query')!==query||[...u.searchParams.keys()].some(k=>!['query','search_trigger'].includes(k))||
    u.searchParams.getAll('search_trigger').length>1||u.searchParams.has('search_trigger')&&u.searchParams.get('search_trigger')!=='landing_search_bar'))return insightsFail('renderer_navigation_denied');
  return 'allow';
 }
 if(!['script','stylesheet','image','font','fetch','xhr','other'].includes(r.resourceType))return insightsFail('renderer_request_denied');
 if(u.origin!=='https://www.etsy.com'){
  if(p.version==='etsy.insights-renderer-policy.2'){
   const matches=(row:EtsyObservedRendererReference)=>row.origin===u.origin&&row.path===u.pathname&&row.method===r.method&&row.resourceType===r.resourceType;
   if(p.optionalTelemetry.some(matches))return 'deny_optional_telemetry';
   if(!u.search&&p.staticAssets.some(matches))return 'allow';
   return insightsFail('renderer_asset_blocked');
  }
  if(!p.staticOrigins.includes(u.origin)||!['script','stylesheet','image','font'].includes(r.resourceType))return insightsFail('renderer_asset_blocked');
  return 'allow';
 }
 let path=u.pathname;try{for(let i=0;i<3;i++){const decoded=decodeURIComponent(path);if(decoded===path)break;path=decoded;}}catch{return insightsFail('renderer_request_denied');}
 if(/(?:^|\/)(?:sign-?in|sign-?out|log-?in|log-?out|register|registration|cart|checkout|orders?|messages?|customers?|payments?|billing|finances?|settings|security|password|oauth)(?:\/|$)/i.test(path)||
  [...u.searchParams.keys()].some(k=>/token|auth|secret|password|session|code|email/i.test(k)))return insightsFail('renderer_private_path_denied');
 for(const key of ['query','q','search_query','search_term'])if(u.searchParams.has(key)&&(query===null||u.searchParams.getAll(key).length!==1||u.searchParams.get(key)!==query))return insightsFail('renderer_query_mismatch');
 return 'allow';
}
/** Compatibility predicate: a denied telemetry request is NEVER permission to continue it. */
export function admitEtsyInsightsRendererRequest(policy:EtsyInsightsRendererPolicy,r:{url:string;method:string;resourceType:string;navigation:boolean},query:string|null):void{
 if(classifyEtsyInsightsRendererRequest(policy,r,query)!=='allow')return insightsFail('renderer_optional_telemetry_denied');
}

