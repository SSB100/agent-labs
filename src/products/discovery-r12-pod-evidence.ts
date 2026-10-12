import {createHash} from "node:crypto";
import type {JsonObject} from "../core/contracts";
import type {EvidencePack,ResearchCollection,ResearchProviderResult,ResearchRequest,ResearchSource} from "../research/types";
import {canonicalResearchUrl,validateEvidencePack,validateResearchRequest} from "../research/sources";
import {canonicalPublicResearchJson,publicResearchHash} from "../research/qualification";
import {assertJsonSchemaValue} from "../workers/schema-validator";
import {podEvidenceView,podResearchSchema,type PodEvidenceView} from "./discovery-r12-pod-analysis";
import {POD_THOROUGH_LIMITS} from "./discovery-r12-pod-profile";

const digest=(s:string)=>createHash("sha256").update(s).digest("hex");
const fail=():never=>{throw Error("r12_pod_evidence_capacity_or_provenance_invalid");};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const normalize=(s:string)=>{if(s.includes("\0")||Buffer.from(s,"utf8").toString("utf8")!==s)fail();return s.replace(/\s+/g," ").trim();};
/** Exact contribution after JSON is embedded in a model message. Key order does
 * not change its byte count. This includes escaping and multibyte characters. */
export const podPromptBytes=(v:unknown)=>Buffer.byteLength(JSON.stringify(canonicalPublicResearchJson(v)),"utf8");
export function normalizeThoroughPodSearch(raw:unknown,request:{allowedDomains:readonly string[];excludedDomains:readonly string[]}):JsonObject[]{
 if(!Array.isArray(raw)||raw.length>POD_THOROUGH_LIMITS.maximumWebSearchResults)fail();
 return (raw as unknown[]).map(a=>{if(!object(a)||a.type!=="url_citation"||!object(a.url_citation))return fail();const c=a.url_citation;
  if(typeof c.url!=="string"||typeof c.content!=="string")return fail();
  const url=canonicalResearchUrl(c.url,request.allowedDomains),host=new URL(url).hostname,content=normalize(c.content);
  const title=typeof c.title==="string"&&c.title.trim()?normalize(c.title):host;
  if(url.length>2048||request.excludedDomains.some(d=>host===d||host.endsWith(`.${d}`))||content.length<30||content.length>8000||title.length>250)fail();
  return {type:"url_citation",url_citation:{url,title,content}};
 });
}
/** Store all admitted highlights. Context selection below never overwrites or
 * shortens these sources; provider omission markers remain part of the text. */
export function extractThoroughPodSources(request:ResearchRequest,result:ResearchProviderResult,retrievedAt:string):ResearchCollection{
 validateResearchRequest(request,{maximumQueryCharacters:4000,maximumDomains:16});
 const sources:ResearchSource[]=[],seenUrls=new Set<string>(),seenContent=new Set<string>();
 for(const a of result.annotations){const c=a.url_citation as JsonObject,url=String(c.url),excerpt=String(c.content),contentHash=digest(excerpt);
  if(seenUrls.has(url)||seenContent.has(contentHash))continue;seenUrls.add(url);seenContent.add(contentHash);
  sources.push({id:`src-${digest(url+":"+contentHash).slice(0,24)}`,url,title:String(c.title),retrievedAt,publishedAt:null,retrievalExpiresAt:new Date(Date.parse(retrievedAt)+86400000).toISOString(),contentHash,excerpt,provider:"openrouter.exa"});
 }
 if(sources.length>POD_THOROUGH_LIMITS.maximumWebSearchResults)fail();
 const evidence=sources.map(s=>{const quote=Array.from(s.excerpt).slice(0,320).join("");return {id:`evi-${digest(s.id+":"+quote).slice(0,24)}`,sourceId:s.id,quote};});
 return {collectionVersion:"1.0",query:request.query,sources,evidence,providerMetadata:{...result.metadata,sourceMethod:{providerHighlight:true,fullPageRead:false,requestedResults:POD_THOROUGH_LIMITS.maximumWebSearchResults,requestedCharacters:8000,localTruncation:false}}};
}
export function validateThoroughPodCollection(c:ResearchCollection,r:ResearchRequest,now:number){
 validateResearchRequest(r,{maximumQueryCharacters:4000,maximumDomains:16});
 if(c.collectionVersion!=="1.0"||c.query!==r.query||c.sources.length>POD_THOROUGH_LIMITS.maximumResults||c.sources.some(s=>canonicalResearchUrl(s.url,r.allowedDomains)!==s.url||s.contentHash!==digest(s.excerpt)||s.id!==`src-${digest(s.url+":"+s.contentHash).slice(0,24)}`||s.excerpt.length<30||s.excerpt.length>8000||!Number.isFinite(Date.parse(s.retrievedAt))||!Number.isFinite(Date.parse(s.retrievalExpiresAt))||Date.parse(s.retrievedAt)>now+300000||Date.parse(s.retrievalExpiresAt)<now||Date.parse(s.retrievalExpiresAt)>Date.parse(s.retrievedAt)+86400000))fail();
}
export type PodSourceProjection={sources:Array<ResearchSource&{sourceKey:string}>;coverage:{available:number;retained:number;omittedSourceIds:string[];reason:"whole_source_context_budget";providerHighlight:true;fullPageRead:false;localTruncation:false}};
/** Domain round-robin prevents a prolific supplier from consuming the entire
 * projection. Whole records only, with explicit omissions and stable identity. */
export function podSourceProjection(c:ResearchCollection,maximumBytes:number=POD_THOROUGH_LIMITS.maximumSelectorEvidenceBytes):PodSourceProjection{
 if(!Number.isSafeInteger(maximumBytes)||maximumBytes<0||c.sources.length>POD_THOROUGH_LIMITS.maximumResults)fail();
 const indexed=c.sources.map((s,i)=>({...s,sourceKey:`S${i+1}`})),groups=new Map<string,typeof indexed>();
 indexed.forEach(s=>{const host=new URL(s.url).hostname;groups.set(host,[...(groups.get(host)??[]),s]);});
 const ranked:typeof indexed=[];for(let n=0;n<POD_THOROUGH_LIMITS.maximumResults;n++)for(const group of groups.values())if(group[n])ranked.push(group[n]);
 const sources:typeof indexed=[];
 const result=():PodSourceProjection=>({sources,coverage:{available:indexed.length,retained:sources.length,omittedSourceIds:indexed.filter(s=>!sources.some(r=>r.id===s.id)).map(s=>s.id),reason:"whole_source_context_budget",providerHighlight:true,fullPageRead:false,localTruncation:false}});
 for(const source of ranked){sources.push(source);if(podPromptBytes(result())>maximumBytes)sources.pop();}
 return result();
}
export function assembleThoroughPodEvidence(c:ResearchCollection,r:ResearchRequest,selection:JsonObject,now:number):EvidencePack{
 validateThoroughPodCollection(c,r,now);assertJsonSchemaValue(podResearchSchema("select1",true),selection,"Thorough exact spans");
 const supplied=new Set(podSourceProjection(c).sources.map(s=>s.sourceKey));
 const evidence=(selection.selections as Array<{sourceKey:string;quote:string}>).map(item=>{const s=c.sources[Number(item.sourceKey.slice(1))-1];
  if(!s||!supplied.has(item.sourceKey)||item.quote.trim()!==item.quote||!s.excerpt.includes(item.quote)||item.quote.includes("[...]"))return fail();
  return {id:`evi-${digest(s.id+":"+item.quote).slice(0,24)}`,sourceId:s.id,quote:item.quote};});
 if(new Set(evidence.map(e=>e.id)).size!==evidence.length)fail();
 const pack:EvidencePack={evidencePackVersion:"1.0",question:c.query,sources:c.sources.filter(s=>evidence.some(e=>e.sourceId===s.id)),evidence,claims:evidence.map(e=>({text:e.quote,evidenceId:e.id,sourceId:e.sourceId})),limitations:[...new Set(["publication_dates_unknown",...(selection.limitations as string[])])]};
 if(!evidence.length&&!pack.limitations.includes("limited_sources"))fail();
 validateEvidencePack(pack);podCurrentEvidence(c,pack,0);return pack;
}
export function podCurrentEvidence(c:ResearchCollection,pack:EvidencePack,maximumSourceBytes:number=POD_THOROUGH_LIMITS.maximumCurrentEvidenceBytes){
 const items=pack.evidence.map((e,i)=>({key:`E${i+1}`,sourceKey:`S${c.sources.findIndex(s=>s.id===e.sourceId)+1}`,quote:e.quote,evidenceId:e.id}));
 // Every selected quote keeps its minimal provenance even when its additional
 // whole highlight cannot fit. No source text is replaced by an invented digest.
 const sourceIndex=pack.sources.map(({id,url,title,contentHash,retrievedAt,publishedAt})=>({id,url,title,contentHash,retrievedAt,publishedAt,sourceKey:`S${c.sources.findIndex(s=>s.id===id)+1}`}));
 const projected=podSourceProjection(c,maximumSourceBytes);
 const result={items,sourceIndex,retainedSources:projected.sources,coverage:projected.coverage};
 if(podPromptBytes({...result,retainedSources:[]})>POD_THOROUGH_LIMITS.maximumCurrentEvidenceBytes)throw Error("r12_pod_next_consumer_capacity_exceeded");return result;
}
export type PodEvidenceArchive={pass:number;collectionHash:string;evidencePackHash:string;items:PodEvidenceView[]};
export function podPriorEvidenceProjection(archives:PodEvidenceArchive[],maximumBytes:number=POD_THOROUGH_LIMITS.maximumPriorEvidenceBytes){
 if(!Number.isSafeInteger(maximumBytes)||maximumBytes<0||archives.length>4||new Set(archives.map(a=>a.pass)).size!==archives.length)fail();
 const queues=archives.map(a=>{if(!Number.isInteger(a.pass)||a.pass<0||a.pass>3||!/^[a-f0-9]{64}$/.test(a.collectionHash)||!/^[a-f0-9]{64}$/.test(a.evidencePackHash)||a.items.length>POD_THOROUGH_LIMITS.maximumQuotes)fail();return a.items.map((e,i)=>({...e,key:`P${a.pass+1}E${i+1}`,pass:a.pass,collectionHash:a.collectionHash,evidencePackHash:a.evidencePackHash}));});
 const all=queues.flat(),items:Array<PodEvidenceView&{pass:number;collectionHash:string;evidencePackHash:string}>=[];
 const result=()=>({items,coverage:{available:all.length,retained:items.length,omittedEvidenceKeys:all.filter(e=>!items.some(r=>r.key===e.key)).map(e=>e.key),reason:"whole_quote_context_budget",quotesTruncated:false}});
 for(let n=0;n<POD_THOROUGH_LIMITS.maximumQuotes;n++)for(const q of queues)if(q[n]){items.push(q[n]);if(podPromptBytes(result())>maximumBytes)items.pop();}
 return result();
}
export function podArchive(collection:ResearchCollection,pack:EvidencePack,pass:number):PodEvidenceArchive{
 return {pass,collectionHash:publicResearchHash(collection),evidencePackHash:publicResearchHash(pack),items:podEvidenceView(pack)};
}
