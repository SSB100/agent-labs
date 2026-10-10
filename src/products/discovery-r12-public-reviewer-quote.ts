import {awaitRequestDeadline, requestDeadline} from '../core/request-deadline';
import {qualifyPublicResearchQuote as qualifyLuna, qualifiedTextPricing, quoteTextTokenCost, type TokenRates, type PublicResearchCatalogSnapshot} from '../research/qualification-quote';
import {type GenerationRouteProof} from '../research/generation-route';
import {assertJsonSchemaValue} from '../workers/schema-validator';
import type {DiscoveryR12Catalogs} from './discovery-r12-quote';
import type {DiscoveryR12Candidate, DiscoveryR12CandidateBinding} from './discovery-r12-receipt';
import {DISCOVERY_R12_OUTPUT_BYTES} from './discovery-r12-receipt';
import {DISCOVERY_V2_BUDGET} from './discovery-v2-budget';
import {ADAPTIVE_ETSY_OUTPUT_TOKENS} from './discovery-r12-adaptive-quote';
import {exactPublicKeys as exact, publicHash, publicResearchHash as hash, publicTime, publicUuid} from './discovery-r12-public-utils';

export const DIRECT_SONNET_REVIEWER = Object.freeze({modelId:'anthropic/claude-sonnet-4.6',canonicalModelId:'anthropic/claude-4.6-sonnet-20260217',endpoint:'amazon-bedrock/us',providerName:'Amazon Bedrock'});
export const DIRECT_INFERENCE_REQUEST_BYTES = Object.freeze({plan:32768,strategy:65536,review:65536});
const RETENTION = Object.freeze({inference:'no_training_zdr',sourceAcquisition:'separately_quoted_browser',schemas:'static_nonprivate_schema_only'});
const LUNA = {modelId:'openai/gpt-5.6-luna',canonicalModelId:'openai/gpt-5.6-luna-20260709',endpoint:'azure/us',providerName:'Azure'};
const BASE='https://openrouter.ai/api/v1', FRESH=300000;
const fail=():never=>{throw Error('r12_direct_inference_quote_unqualified');};
const object=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const same=(a:unknown,b:unknown)=>hash(a)===hash(b);
const positive=(x:unknown):x is number=>Number.isSafeInteger(x)&&Number(x)>0;
export type DirectInferenceRoute={modelId:string;canonicalModelId:string;endpoint:string;providerName:string;acceptedResponseModelIds:string[];tokenPricesUsd:TokenRates;priceLimit:{prompt:number;completion:number;request:0};sourceHashes:{identity:string;alias:string;canonical:string;zdr:string}};
export type DirectInferenceQuote={version:'r12.direct-inference-quote.1';baseQuoteHash:string;luna:DirectInferenceRoute;reviewer:DirectInferenceRoute;ceilings:{plan:number;strategy:number;review:number};requestBytes:typeof DIRECT_INFERENCE_REQUEST_BYTES;outputTokens:typeof ADAPTIVE_ETSY_OUTPUT_TOKENS;retention:typeof RETENTION;proposalOnly:true;dispatchAuthorized:false;quoteHash:string;verifiedAt:string;validUntil:string};
const urls={models:`${BASE}/models`,lunaAlias:`${BASE}/models/${LUNA.modelId}/endpoints`,lunaCanonical:`${BASE}/models/${LUNA.canonicalModelId}/endpoints`,reviewerAlias:`${BASE}/models/${DIRECT_SONNET_REVIEWER.modelId}/endpoints`,reviewerCanonical:`${BASE}/models/${DIRECT_SONNET_REVIEWER.canonicalModelId}/endpoints`,zdr:`${BASE}/endpoints/zdr`};
const identity=(r:{modelId:string;canonicalModelId:string})=>({modelId:r.modelId,canonicalModelId:r.canonicalModelId});
function priceLimit(r:TokenRates):DirectInferenceRoute['priceLimit']{
 const units=(s:string)=>{if(!/^(?:0|1)(?:\.\d{1,18})?$/.test(s))return fail();const[w,f='']=s.split('.');return BigInt(w)*BigInt('1000000000000000000')+BigInt(f.padEnd(18,'0'));};
 const million=(s:string)=>Number((units(s)+BigInt(999999))/BigInt(1000000))/1000000;
 return{prompt:million(r.prompt),completion:Math.max(million(r.completion),million(r.reasoning)),request:0};
}
function reviewerEndpoint(payload:unknown,kind:'model'|'zdr'){
 if(!object(payload))return fail();const rows=kind==='model'?object(payload.data)&&payload.data.id===DIRECT_SONNET_REVIEWER.modelId?payload.data.endpoints:null:payload.data;
 if(!Array.isArray(rows)||rows.length>20000)return fail();const found=rows.filter(r=>object(r)&&r.model_id===DIRECT_SONNET_REVIEWER.modelId&&r.tag===DIRECT_SONNET_REVIEWER.endpoint),r=found[0];
 const input=DIRECT_INFERENCE_REQUEST_BYTES.review+DISCOVERY_V2_BUDGET.formattingTokenAllowance,output=ADAPTIVE_ETSY_OUTPUT_TOKENS.review;
 if(found.length!==1||!object(r)||r.provider_name!==DIRECT_SONNET_REVIEWER.providerName||r.status!==0||typeof r.name!=='string'||!r.name.trim()||r.name.length>300||!positive(r.context_length)||r.context_length<input+output||!positive(r.max_completion_tokens)||r.max_completion_tokens<output||r.max_prompt_tokens!==null&&r.max_prompt_tokens!==undefined&&(!positive(r.max_prompt_tokens)||r.max_prompt_tokens<input)||!Array.isArray(r.supported_parameters)||r.supported_parameters.length>128||r.supported_parameters.some(x=>typeof x!=='string')||new Set(r.supported_parameters).size!==r.supported_parameters.length||!['response_format','structured_outputs','max_tokens'].every(x=>(r.supported_parameters as unknown[]).includes(x)))return fail();
 return{modelId:r.model_id,endpoint:r.tag,providerName:r.provider_name,name:r.name,status:r.status,contextLength:r.context_length,maximumCompletionTokens:r.max_completion_tokens,maximumPromptTokens:r.max_prompt_tokens??null,supportedParameters:[...r.supported_parameters].sort(),pricing:qualifiedTextPricing(r.pricing),rawPricingHash:hash(r.pricing)};
}
/** Exact direct-mode proposal. Source catalog hashes are integrity pins only;
 * the server must authenticate fresh public acquisition and reviewed authority. */
export function qualifyDirectSonnetInferenceQuote(catalogs:DiscoveryR12Catalogs,now=Date.now()):DirectInferenceQuote{
 if(!Number.isSafeInteger(now))return fail();const times=Object.entries(urls).map(([k,url])=>{const s=catalogs[k as keyof DiscoveryR12Catalogs],at=publicTime(s?.fetchedAt);if(s?.url!==url||at>now||now-at>=FRESH)return fail();return at;});
 const models=catalogs.models.payload;if(!object(models)||!Array.isArray(models.data)||models.data.length>20000)return fail();const matches=models.data.filter(x=>object(x)&&x.id===DIRECT_SONNET_REVIEWER.modelId),row=matches[0];
 if(matches.length!==1||!object(row)||row.canonical_slug!==DIRECT_SONNET_REVIEWER.canonicalModelId||!object(row.links)||row.links.details!==`/api/v1/models/${DIRECT_SONNET_REVIEWER.canonicalModelId}/endpoints`)return fail();
 const l=qualifyLuna({modelIdentityCatalog:catalogs.models,modelCatalog:catalogs.lunaAlias,canonicalModelCatalog:catalogs.lunaCanonical,zdrCatalog:catalogs.zdr,now});
 const a=reviewerEndpoint(catalogs.reviewerAlias.payload,'model'),c=reviewerEndpoint(catalogs.reviewerCanonical.payload,'model'),z=reviewerEndpoint(catalogs.zdr.payload,'zdr');if(!same(a,c)||!same(a,z))return fail();
 const luna:DirectInferenceRoute={...LUNA,acceptedResponseModelIds:[LUNA.modelId,LUNA.canonicalModelId],tokenPricesUsd:l.tokenPricesUsd,priceLimit:l.priceLimit,sourceHashes:{identity:hash(identity(LUNA)),alias:l.sourceHashes.modelCatalog,canonical:l.sourceHashes.canonicalModelCatalog,zdr:l.sourceHashes.zdrCatalog}};
 const reviewer:DirectInferenceRoute={...DIRECT_SONNET_REVIEWER,acceptedResponseModelIds:[DIRECT_SONNET_REVIEWER.modelId,DIRECT_SONNET_REVIEWER.canonicalModelId],tokenPricesUsd:a.pricing.tokenPricesUsd,priceLimit:priceLimit(a.pricing.tokenPricesUsd),sourceHashes:{identity:hash(identity(DIRECT_SONNET_REVIEWER)),alias:hash(a),canonical:hash(c),zdr:hash(z)}};
 const ceilings={plan:0,strategy:0,review:0};for(const phase of ['plan','strategy','review']as const)ceilings[phase]=quoteTextTokenCost(phase==='review'?reviewer.tokenPricesUsd:luna.tokenPricesUsd,DIRECT_INFERENCE_REQUEST_BYTES[phase]+DISCOVERY_V2_BUDGET.formattingTokenAllowance,ADAPTIVE_ETSY_OUTPUT_TOKENS[phase]);
 const body={version:'r12.direct-inference-quote.1'as const,baseQuoteHash:hash({version:'r12.direct-inference-catalog.1',luna,reviewer}),luna,reviewer,ceilings,requestBytes:DIRECT_INFERENCE_REQUEST_BYTES,outputTokens:ADAPTIVE_ETSY_OUTPUT_TOKENS,retention:RETENTION,proposalOnly:true as const,dispatchAuthorized:false as const},at=Math.min(...times);
 return validateDirectSonnetInferenceQuote({...body,quoteHash:hash(body),verifiedAt:new Date(at).toISOString(),validUntil:new Date(at+FRESH).toISOString()},now);
}
export function validateDirectSonnetInferenceQuote(raw:unknown,now=Date.now()):DirectInferenceQuote{
 if(!exact(raw,'version,baseQuoteHash,luna,reviewer,ceilings,requestBytes,outputTokens,retention,proposalOnly,dispatchAuthorized,quoteHash,verifiedAt,validUntil'))return fail();const q=raw as unknown as DirectInferenceQuote;
 if(q.version!=='r12.direct-inference-quote.1'||q.proposalOnly!==true||q.dispatchAuthorized!==false||!Number.isSafeInteger(now)||publicTime(q.verifiedAt)>now||publicTime(q.validUntil)<=now||publicTime(q.validUntil)-publicTime(q.verifiedAt)!==FRESH||!same(q.requestBytes,DIRECT_INFERENCE_REQUEST_BYTES)||!same(q.outputTokens,ADAPTIVE_ETSY_OUTPUT_TOKENS)||!same(q.retention,RETENTION)||!exact(q.ceilings,'plan,strategy,review'))return fail();
 for(const [r,expected]of [[q.luna,LUNA],[q.reviewer,DIRECT_SONNET_REVIEWER]]as const){
 if(!exact(r,'modelId,canonicalModelId,endpoint,providerName,acceptedResponseModelIds,tokenPricesUsd,priceLimit,sourceHashes')||!same(identity(r),identity(expected))||r.endpoint!==expected.endpoint||r.providerName!==expected.providerName||!same(r.acceptedResponseModelIds,[expected.modelId,expected.canonicalModelId])||!exact(r.sourceHashes,'identity,alias,canonical,zdr')||!Object.values(r.sourceHashes).every(publicHash)||r.sourceHashes.identity!==hash(identity(expected))||r.sourceHashes.alias!==r.sourceHashes.canonical||r.sourceHashes.alias!==r.sourceHashes.zdr||!exact(r.tokenPricesUsd,'prompt,completion,cacheRead,cacheWrite,reasoning')||!exact(r.priceLimit,'prompt,completion,request'))return fail();
 const rates=qualifiedTextPricing({prompt:r.tokenPricesUsd.prompt,completion:r.tokenPricesUsd.completion,input_cache_read:r.tokenPricesUsd.cacheRead,input_cache_write:r.tokenPricesUsd.cacheWrite,internal_reasoning:r.tokenPricesUsd.reasoning}).tokenPricesUsd;
 if(!same(rates,r.tokenPricesUsd)||!same(r.priceLimit,priceLimit(rates)))return fail();
 }
 // Preparation cannot admit a model phase that the existing candidate/receipt
 // boundary cannot settle. This is local to the new direct inference version.
 for(const phase of ['plan','strategy','review']as const)if(q.ceilings[phase]>2000000||q.ceilings[phase]!==quoteTextTokenCost(phase==='review'?q.reviewer.tokenPricesUsd:q.luna.tokenPricesUsd,q.requestBytes[phase]+DISCOVERY_V2_BUDGET.formattingTokenAllowance,q.outputTokens[phase]))return fail();
 const{quoteHash,verifiedAt,validUntil,...body}=q;void verifiedAt;void validUntil;
 if(quoteHash!==hash(body)||q.baseQuoteHash!==hash({version:'r12.direct-inference-catalog.1',luna:q.luna,reviewer:q.reviewer}))return fail();return structuredClone(q);
}
/** Six fixed unauthenticated public GETs. Bounded transport, no retry or paid
 * probe; catalog observation never creates a grant or changes old routes. */
export async function fetchDirectSonnetInferenceQuote(options:{fetch?:typeof fetch;now?:()=>number}={}):Promise<DirectInferenceQuote>{
 const fetcher=options.fetch??fetch,now=options.now??Date.now;
 async function read(url:string):Promise<PublicResearchCatalogSnapshot>{
 const started=now(),signal=requestDeadline(10000);let reader:ReadableStreamDefaultReader<Uint8Array>|undefined,response:Response|undefined;
 try{const r=response=await awaitRequestDeadline(fetcher(url,{method:'GET',headers:{Accept:'application/json','Cache-Control':'no-cache'},credentials:'omit',redirect:'error',cache:'no-store',signal}),signal);
 if(!r.ok||r.redirected||r.url&&r.url!==url||!r.body)return fail();const age=r.headers.get('age');if(age!==null&&!/^\d{1,6}$/.test(age)||Number(age??0)*1000>=FRESH)return fail();reader=r.body.getReader();const parts:Uint8Array[]=[];let size=0;
 for(;;){const next=await awaitRequestDeadline(reader.read(),signal);if(next.done)break;size+=next.value.byteLength;if(size>8000000)return fail();parts.push(next.value);}
 return{url,fetchedAt:new Date(started-Number(age??0)*1000).toISOString(),payload:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)))};
 }finally{try{void (reader?reader.cancel():response?.body?.cancel())?.catch(()=>undefined);}catch{/* Cleanup cannot extend the bounded request. */}}
 }
 try{const entries=await Promise.all(Object.entries(urls).map(async([k,u])=>[k,await read(u)]));return qualifyDirectSonnetInferenceQuote(Object.fromEntries(entries)as DiscoveryR12Catalogs,now());}catch{return fail();}
}
/** .4-only qualified reviewer response. The existing legacy candidate validator
 * remains exact. Callers must supply their authenticated current direct quote. */
export function qualifyDirectSonnetReviewerCandidate(raw:unknown,b:DiscoveryR12CandidateBinding,proof:GenerationRouteProof,quote:DirectInferenceQuote){
 validateDirectSonnetInferenceQuote(quote,publicTime(b.dispatchedAt));
 if(b.phase!=='review'||![b.scopeId,b.attemptId,b.requestId].every(publicUuid)||!Number.isSafeInteger(b.maximumMicrousd)||b.maximumMicrousd<quote.ceilings.review||b.maximumMicrousd>2000000||publicTime(b.receiptExpiresAt)<=publicTime(b.dispatchedAt)||publicTime(b.receiptExpiresAt)-publicTime(b.dispatchedAt)>3600000||!('outputSchema'in b.request)||b.request.model.providerModelId!==quote.reviewer.modelId||!same(b.request.providerOnly,[quote.reviewer.endpoint])||b.request.providerDataCollection!=='deny'||b.request.providerZdr!==true||!same(b.request.providerPriceLimit,quote.reviewer.priceLimit))return fail();
 if(!exact(raw,'version,scopeId,attemptId,requestId,phase,requestHash,providerRequestId,providerModelId,receivedAt,reportedMicrousd,output'))return fail();const c=raw as unknown as DiscoveryR12Candidate;
 if(c.version!=='r12.discovery-response.1'||c.scopeId!==b.scopeId||c.attemptId!==b.attemptId||c.requestId!==b.requestId||c.phase!=='review'||c.requestHash!==hash(b.request)||!/^gen-[A-Za-z0-9_-]{1,296}$/.test(c.providerRequestId)||!quote.reviewer.acceptedResponseModelIds.includes(c.providerModelId)||!Number.isSafeInteger(c.reportedMicrousd)||c.reportedMicrousd===null||c.reportedMicrousd<0||c.reportedMicrousd>b.maximumMicrousd||publicTime(c.receivedAt)<publicTime(b.dispatchedAt)||publicTime(c.receivedAt)>=publicTime(b.receiptExpiresAt)||new Date(publicTime(c.receivedAt)).toISOString()!==c.receivedAt||Buffer.byteLength(JSON.stringify(c))>DISCOVERY_R12_OUTPUT_BYTES.review)return fail();
 assertJsonSchemaValue(b.request.outputSchema,c.output,'Direct Sonnet reviewer response');const route=validateDirectSonnetRouteProof(proof,c.providerRequestId);
 return{candidate:structuredClone(c),candidateHash:hash(c),route,financiallyKnown:true as const};
}

/** Direct-only metadata projection. Requested US routing is provenance from
 * admission; metadata attests provider/model, never the actual served region. */
export function qualifyDirectSonnetRouteProof(raw:unknown,generationId:string):GenerationRouteProof{
 if(!/^gen-[A-Za-z0-9_-]{1,296}$/.test(generationId)||!object(raw)||Object.hasOwn(raw,'error')||!object(raw.data))return fail();const d=raw.data,models:readonly string[]=[DIRECT_SONNET_REVIEWER.modelId,DIRECT_SONNET_REVIEWER.canonicalModelId];
 if(d.id!==generationId||d.provider_name!=='Amazon Bedrock'||typeof d.model!=='string'||!models.includes(d.model))return fail();
 const responses=d.provider_responses===undefined||d.provider_responses===null?[]:d.provider_responses;if(!Array.isArray(responses)||responses.length>64)return fail();
 const providerResponses=responses.map(x=>{if(!object(x)||x.status!==200||x.provider_name!=='Amazon Bedrock'||typeof x.model_permaslug!=='string'||!models.includes(x.model_permaslug))return fail();return{providerName:'Amazon Bedrock'as const,modelId:x.model_permaslug as 'anthropic/claude-sonnet-4.6'|'anthropic/claude-4.6-sonnet-20260217',status:200 as const};});
 const body={generationId,providerName:'Amazon Bedrock'as const,modelId:d.model as 'anthropic/claude-sonnet-4.6'|'anthropic/claude-4.6-sonnet-20260217',requestedEndpoint:'amazon-bedrock/us'as const,providerResponses};return{...body,proofHash:hash(body)};
}
export function validateDirectSonnetRouteProof(raw:unknown,generationId:string):GenerationRouteProof{
 if(!exact(raw,'generationId,providerName,modelId,requestedEndpoint,providerResponses,proofHash')||raw.requestedEndpoint!=='amazon-bedrock/us'||!Array.isArray(raw.providerResponses)||raw.providerResponses.length>64)return fail();
 const responses=raw.providerResponses.map(x=>{if(!exact(x,'providerName,modelId,status'))return fail();return{provider_name:x.providerName,model_permaslug:x.modelId,status:x.status};});
 const expected=qualifyDirectSonnetRouteProof({data:{id:raw.generationId,provider_name:raw.providerName,model:raw.modelId,provider_responses:responses}},generationId);if(raw.proofHash!==expected.proofHash)return fail();return expected;
}
/** One fixed-origin non-generating metadata GET; no replay of model inference. */
export async function fetchDirectSonnetRouteProofOnce(options:{generationId:string;apiKey:string;fetcher?:typeof fetch;signal?:AbortSignal}):Promise<GenerationRouteProof>{
 if(!/^gen-[A-Za-z0-9_-]{1,296}$/.test(options.generationId)||typeof options.apiKey!=='string'||!options.apiKey.trim()||options.apiKey.length>4096||/[\r\n]/.test(options.apiKey))return fail();
 const deadline=requestDeadline(10000),signal=options.signal?AbortSignal.any([deadline,options.signal]):deadline,url=`${BASE}/generation?id=${encodeURIComponent(options.generationId)}`;let reader:ReadableStreamDefaultReader<Uint8Array>|undefined,response:Response|undefined;
 try{const r=response=await awaitRequestDeadline((options.fetcher??fetch)(url,{method:'GET',headers:{Authorization:`Bearer ${options.apiKey}`,Accept:'application/json'},redirect:'error',credentials:'omit',cache:'no-store',signal}),signal);
 if(!r.ok||r.redirected||r.url&&r.url!==url||!r.body)return fail();const length=r.headers.get('content-length');if(length!==null&&(!/^(?:0|[1-9][0-9]*)$/.test(length)||Number(length)>65536))return fail();
 reader=r.body.getReader();const chunks:Uint8Array[]=[];let size=0;for(;;){const next=await awaitRequestDeadline(reader.read(),signal);if(next.done)break;size+=next.value.byteLength;if(size>65536)return fail();chunks.push(next.value);}
 const raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));signal.throwIfAborted();return qualifyDirectSonnetRouteProof(raw,options.generationId);
 }catch{return fail();}finally{try{void (reader?reader.cancel():response?.body?.cancel())?.catch(()=>undefined);}catch{/* Cleanup cannot extend the bounded request. */}}
}
