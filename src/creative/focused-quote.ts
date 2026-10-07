import {CREATIVE_BUDGET} from './budget';
import {FLUX_KLEIN_PNG_POLICY,parseImageGenerationQuote} from './image-provider';
import {FLUX_KLEIN_PROVIDER_TERMS,validateCreativeProviderSelection} from './proposal';
import {fetchDiscoveryR12Catalogs,qualifyDiscoveryR12Quote,type DiscoveryR12Catalogs} from '../products/discovery-r12-quote';
import {quoteTextTokenCost,type PublicResearchCatalogSnapshot} from '../research/qualification-quote';
import {creativeHash} from './contracts';
import {focusedCreativeRoute,validateFocusedCreativeDispatchQuote,type FocusedCreativeDispatchQuote,type FocusedCreativePhase,type FocusedCreativeScope} from './focused-runtime-contract';
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const fail=():never=>{throw Error('r12_focused_creative_quote_unavailable');};
const freshness=300000;
export function qualifyFocusedCreativeQuote(catalogs:DiscoveryR12Catalogs,image:PublicResearchCatalogSnapshot,ownerAcknowledged:boolean,now=Date.now()){
 const text=qualifyDiscoveryR12Quote(catalogs,now),at=Date.parse(image.fetchedAt);
 if(image.url!==FLUX_KLEIN_PNG_POLICY.pricingSource||!Number.isFinite(at)||at>now||now-at>=freshness||!object(catalogs.models.payload)||!Array.isArray(catalogs.models.payload.data))return fail();
 const model=catalogs.models.payload.data.find(row=>object(row)&&row.id===text.reviewer.modelId);
 const architecture=object(model)?model.architecture:null;
 if(!object(architecture)||!Array.isArray(architecture.input_modalities)||!architecture.input_modalities.includes('image')||!Array.isArray(architecture.output_modalities)||!architecture.output_modalities.includes('text'))return fail();
 // The exact native endpoint parser rejects unknown pricing lines, changed
 // provider binding or unsupported PNG parameters. This is a public quote only.
 const imageQuote=parseImageGenerationQuote(image.payload,{prompt:'Public pricing proposal for one separately approved original PNG; no generation requested.'},image.fetchedAt,FLUX_KLEIN_PNG_POLICY.modelId);
 const maxText=CREATIVE_BUDGET.maximumTextRequestBytes+CREATIVE_BUDGET.formattingTokenAllowance;
 const maximaMicrousd={brief:quoteTextTokenCost(text.luna.tokenPricesUsd,maxText,CREATIVE_BUDGET.briefOutputTokens),
  screen:quoteTextTokenCost(text.reviewer.tokenPricesUsd,maxText,CREATIVE_BUDGET.reviewOutputTokens),generation:imageQuote.estimatedMicrousd,
  review:quoteTextTokenCost(text.reviewer.tokenPricesUsd,maxText+CREATIVE_BUDGET.imageTokenAllowance,CREATIVE_BUDGET.reviewOutputTokens)};
 const verifiedAt=new Date(Math.min(at,Date.parse(text.verifiedAt))).toISOString();
 const approvalQuote={version:CREATIVE_BUDGET.version,verifiedAt,sourceUrls:[CREATIVE_BUDGET.pricingSource,image.url,...FLUX_KLEIN_PROVIDER_TERMS],
  providerBinding:validateCreativeProviderSelection(FLUX_KLEIN_PNG_POLICY.modelId,ownerAcknowledged),generatorModel:FLUX_KLEIN_PNG_POLICY.modelId,
  directorModel:text.luna.modelId,reviewerModel:text.reviewer.modelId,maximaMicrousd,maximumEstimateMicrousd:Object.values(maximaMicrousd).reduce((a,b)=>a+b,0),maximumCalls:4,estimateOnly:true,providerInvoiceGuarantee:false};
 const body={version:'r12.focused-creative-quote.1' as const,approvalQuote,luna:text.luna,reviewer:text.reviewer,
  imagePricingFingerprint:imageQuote.pricingFingerprint,imageCatalogHash:creativeHash(image.payload),visionArchitectureHash:creativeHash(architecture),
  bounds:{textRequestBytes:24576,originalImageBytes:3700000,visionWireBytes:5000000,maximumImages:1},
  proposalOnly:true,dispatchAuthorized:false};
 return {...body,quoteHash:creativeHash(body),verifiedAt,validUntil:new Date(Date.parse(verifiedAt)+freshness).toISOString()};
}
export type FocusedCreativeQuote=ReturnType<typeof qualifyFocusedCreativeQuote>;
let publicQuoteCache:FocusedCreativeQuote|null=null;
/** Public catalog data only. A live process may reuse a still-fresh observation;
 * the dispatch validator and SQL independently reject expiry at the send edge. */
export async function currentFocusedCreativeQuote():Promise<FocusedCreativeQuote>{
 if(publicQuoteCache&&Date.parse(publicQuoteCache.validUntil)>Date.now()+1000)return structuredClone(publicQuoteCache);
 const fresh=await fetchFocusedCreativeQuote(true);publicQuoteCache=fresh;return structuredClone(fresh);
}
export function focusedCreativeDispatchQuote(quote:FocusedCreativeQuote,scope:FocusedCreativeScope,phase:Exclude<FocusedCreativePhase,'generate:1'>,now=Date.now()):FocusedCreativeDispatchQuote{
 const route=focusedCreativeRoute(phase),model=phase==='brief:1'?quote.luna:quote.reviewer;
 const body={version:'r12.focused-creative-dispatch-quote.1' as const,callKey:phase,modelId:model.modelId,endpoint:route.endpoint,
  verifiedAt:quote.verifiedAt,validUntil:quote.validUntil,sourceQuoteHash:quote.quoteHash,priceLimits:model.priceLimit,
  maximumMicrousd:quote.approvalQuote.maximaMicrousd[phase==='brief:1'?'brief':phase==='screen:1'?'screen':'review']};
 const result={...body,quoteHash:creativeHash(body)};validateFocusedCreativeDispatchQuote(result,scope,phase,now);return result;
}
/** Seven credential-free public GETs. No prompt, artifact or image leaves here. */
export async function fetchFocusedCreativeQuote(ownerAcknowledged:boolean,options:{fetch?:typeof fetch;now?:()=>number}={}):Promise<FocusedCreativeQuote>{
 const fetcher=options.fetch??fetch,now=options.now??Date.now;
 const [catalogs,image]=await Promise.all([fetchDiscoveryR12Catalogs(options),(async()=>{
  const at=now(),url=FLUX_KLEIN_PNG_POLICY.pricingSource,response=await fetcher(url,{method:'GET',headers:{Accept:'application/json','Cache-Control':'no-cache'},credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(!response.ok||!response.body||response.redirected||response.url&&response.url!==url)return fail();
  const age=response.headers.get('age');if(age!==null&&!/^\d{1,6}$/.test(age)||Number(age??0)*1000>=freshness)return fail();
  const reader=response.body.getReader(),parts:Uint8Array[]=[];let bytes=0;
  try{for(;;){const next=await reader.read();if(next.done)break;bytes+=next.value.length;if(bytes>1000000)return fail();parts.push(next.value);}}finally{await reader.cancel();}
  return{url,fetchedAt:new Date(at-Number(age??0)*1000).toISOString(),payload:JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown};
 })()]);
 return qualifyFocusedCreativeQuote(catalogs,image,ownerAcknowledged,now());
}
