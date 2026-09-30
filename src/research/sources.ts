import { createHash } from "node:crypto";
import type { JsonObject } from "../core/contracts";
import type { EvidencePack, ResearchCollection, ResearchProviderResult, ResearchRequest, ResearchSource } from "./types";

const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
const normalize=(value:string)=>value.replace(/\s+/g," ").trim();
function record(v:unknown): v is Record<string,unknown> { return !!v&&typeof v==="object"&&!Array.isArray(v); }
export function validateResearchRequest(value: unknown): asserts value is ResearchRequest {
  if (!record(value)||Object.keys(value).sort().join(",")!=="allowedDomains,query"||typeof value.query!=="string"||value.query.trim().length<5||value.query.length>800||
    !Array.isArray(value.allowedDomains)||value.allowedDomains.length<1||value.allowedDomains.length>6||new Set(value.allowedDomains).size!==value.allowedDomains.length||
    value.allowedDomains.some(d=>typeof d!=="string"||d.length>200||! /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(d)||d.endsWith(".local")||d.endsWith(".internal"))) {
    throw new Error("Research needs a bounded question and 1 to 6 public source domains.");
  }
}
export function canonicalResearchUrl(raw:string, domains:readonly string[]) {
  const url=new URL(raw);
  if (url.protocol!=="https:"||url.username||url.password||url.port||!domains.some(d=>url.hostname===d||url.hostname.endsWith(`.${d}`))) throw new Error("Source URL exceeds the permitted research domains.");
  url.hash="";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    if (/^(token|access_token|api_key|auth|password)$/i.test(key)) throw new Error("Source URL contains a credential parameter.");
  }
  url.searchParams.sort();
  return url.toString();
}

export function extractResearchSources(request:ResearchRequest, result:ResearchProviderResult, retrievedAt=new Date().toISOString()): ResearchCollection {
  validateResearchRequest(request);
  if (!Number.isFinite(Date.parse(retrievedAt))) throw new Error("Invalid source retrieval time.");
  const sources:ResearchSource[]=[],seenUrls=new Set<string>(),seenContent=new Set<string>();
  for (const annotation of result.annotations.slice(0,20)) {
    if (annotation.type!=="url_citation"||!record(annotation.url_citation)) continue;
    const citation=annotation.url_citation;
    if (typeof citation.url!=="string"||typeof citation.content!=="string") continue;
    let url:string;
    try { url=canonicalResearchUrl(citation.url,request.allowedDomains); } catch { continue; }
    const excerpt=normalize(citation.content).slice(0,1800),contentHash=hash(excerpt);
    if (excerpt.length<30||seenUrls.has(url)||seenContent.has(contentHash)) continue;
    seenUrls.add(url);seenContent.add(contentHash);
    sources.push({id:`src-${hash(url+":"+contentHash).slice(0,24)}`,url,title:typeof citation.title==="string"?citation.title.slice(0,250):new URL(url).hostname,
      retrievedAt,publishedAt:null,retrievalExpiresAt:new Date(Date.parse(retrievedAt)+86400000).toISOString(),contentHash,excerpt,provider:"openrouter.exa"});
    if (sources.length===4) break;
  }
  if (!sources.length) throw new Error("Research returned no inspectable source excerpts inside the permitted domains.");
  const evidence=sources.map(s=>({id:`evi-${hash(s.id+":"+s.excerpt.slice(0,320)).slice(0,24)}`,sourceId:s.id,quote:s.excerpt.slice(0,320)}));
  return {collectionVersion:"1.0",query:request.query,sources,evidence,providerMetadata:result.metadata};
}

export function assembleEvidencePack(collection:ResearchCollection, selection:unknown, now=Date.now()): EvidencePack {
  if (!record(selection)||Object.keys(selection).sort().join(",")!=="limitations,selectedEvidenceIds"||!Array.isArray(selection.selectedEvidenceIds)||!selection.selectedEvidenceIds.length||
    selection.selectedEvidenceIds.length>4||new Set(selection.selectedEvidenceIds).size!==selection.selectedEvidenceIds.length||!Array.isArray(selection.limitations)||
    selection.limitations.some(l=>!["limited_sources","publication_dates_unknown","no_sales_metrics","no_current_prices"].includes(String(l)))) throw new Error("Researcher selection is invalid or contains unsupported claims.");
  const evidence=selection.selectedEvidenceIds.map(id=>{
    const found=collection.evidence.find(e=>e.id===id);
    if (!found) throw new Error("Researcher cited unavailable evidence.");
    const source=collection.sources.find(s=>s.id===found.sourceId);
    if (!source||!source.excerpt.includes(found.quote)||hash(source.excerpt)!==source.contentHash||!Number.isFinite(Date.parse(source.retrievedAt))||
      !Number.isFinite(Date.parse(source.retrievalExpiresAt))||Date.parse(source.retrievalExpiresAt)<now||Date.parse(source.retrievedAt)>now+300000) throw new Error("Evidence is stale or unsupported by its source.");
    return found;
  });
  const sources=collection.sources.filter(s=>evidence.some(e=>e.sourceId===s.id));
  const claims=evidence.map(e=>({text:e.quote,evidenceId:e.id,sourceId:e.sourceId}));
  return {evidencePackVersion:"1.0",question:collection.query,sources,evidence,claims,limitations:[...new Set(["publication_dates_unknown",...selection.limitations.map(String)])]};
}

export function validateResearchCollection(collection:ResearchCollection,request:ResearchRequest,now=Date.now()) {
  validateResearchRequest(request);
  if (collection.collectionVersion!=="1.0"||collection.query!==request.query||!collection.sources.length||collection.sources.length>4||!collection.evidence.length||collection.evidence.length>4) throw new Error("Source collection does not match this research scope.");
  for (const source of collection.sources) {
    if (canonicalResearchUrl(source.url,request.allowedDomains)!==source.url||!Number.isFinite(Date.parse(source.retrievedAt))||
      !Number.isFinite(Date.parse(source.retrievalExpiresAt))||Date.parse(source.retrievalExpiresAt)>Date.parse(source.retrievedAt)+86400000||
      source.id!==`src-${hash(source.url+":"+source.contentHash).slice(0,24)}`) throw new Error("Source provenance is invalid.");
  }
  assembleEvidencePack(collection,{selectedEvidenceIds:collection.evidence.map(e=>e.id),limitations:[]},now);
}

export function validateEvidencePack(pack:EvidencePack) {
  for (const claim of pack.claims) {
    const e=pack.evidence.find(e=>e.id===claim.evidenceId&&e.sourceId===claim.sourceId),source=pack.sources.find(s=>s.id===claim.sourceId);
    if (!e||!source||!e.quote||claim.text!==e.quote||!source.excerpt.includes(e.quote)||hash(source.excerpt)!==source.contentHash) throw new Error("Unsupported factual claim or broken citation linkage.");
  }
}

export function researcherSelectionSchema(collection:ResearchCollection): JsonObject {
  return {type:"object",additionalProperties:false,required:["selectedEvidenceIds","limitations"],properties:{
    selectedEvidenceIds:{type:"array",minItems:1,maxItems:4,uniqueItems:true,items:{type:"string",enum:collection.evidence.map(e=>e.id)}},
    limitations:{type:"array",items:{type:"string",enum:["limited_sources","publication_dates_unknown","no_sales_metrics","no_current_prices"]}},
  }};
}
