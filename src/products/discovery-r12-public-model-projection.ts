import type { EtsyInsightsCapture, EtsyInsightsFact, EtsyInsightsReceipt } from "../browser/etsy-insights-contracts";
import type { PublicResearchState } from "./discovery-r12-public-cycle";
import type { PublicResearchModelEvidence, PublicResearchModelPhase } from "./discovery-r12-public-model";
import { PUBLIC_RESEARCH_DIMENSIONS } from "./discovery-r12-public-quality";
import { publicResearchFail as fail, publicResearchHash } from "./discovery-r12-public-utils";

const METRICS=new Set(["searches","results","conversion_statement","price","trend_statement"]);
const CONTEXT=new Set(["query","reporting_window","currency","aggregate_region","timezone","limitation"]);
const sorted=(xs:string[])=>[...new Set(xs)].sort();
export type PublicResearchSourceContext={captureHash:string;sourceReceiptHash:string;sourcePath:string;query:string;capturedAt:string;facts:Array<{kind:EtsyInsightsFact["kind"];quote:string}>;factsHash:string};
export type PublicResearchEvidenceSelection={version:"r12.public-evidence-selection.1";policy:"all_substantive_metrics_no_ranking";phase:PublicResearchModelPhase;sourceReceiptHashes:string[];selectedRefs:string[];contextRefs:string[];privateIdentityFactCount:number;allWitnessesHash:string;selectionHash:string};
/** Deterministic projection of ALREADY authenticated complete source packets.
 * No relevance ranking, truncation, temporal inference or authority is created.
 * The private full manifest and immutable captures reproduce every omission. */
export function projectPublicResearchModelSources(receipts:readonly EtsyInsightsReceipt[],phase:PublicResearchModelPhase):{evidence:PublicResearchModelEvidence[];sourceContexts:PublicResearchSourceContext[];selection:PublicResearchEvidenceSelection}{
 if(!["plan","strategy","review"].includes(phase))return fail();
 const evidence:PublicResearchModelEvidence[]=[],sourceContexts:PublicResearchSourceContext[]=[],contextRefs:string[]=[];let privateIdentityFactCount=0;
 const ordered=[...receipts].sort((a,b)=>a.attemptOrdinal-b.attemptOrdinal||(a.receiptHash<b.receiptHash?-1:a.receiptHash>b.receiptHash?1:0));
 for(const receipt of ordered)for(const capture of receipt.captures){
  const contexts:EtsyInsightsFact[]=[];
  for(const f of capture.facts){
   const ref=`${capture.captureHash}:${f.kind}:${f.start}:${f.end}`,w=receipt.witnesses.find(x=>x.ref===ref);if(!w)return fail("r12_public_projection_witness_required");
   if(f.kind==="shop_name"||f.kind==="shop_id"){privateIdentityFactCount++;continue;}
   if(CONTEXT.has(f.kind)){contexts.push(f);contextRefs.push(ref);continue;}
   if(!METRICS.has(f.kind))return fail("r12_public_projection_kind_unqualified");
   evidence.push({...w,quote:f.quote,kind:f.kind,captureHash:capture.captureHash,sourceReceiptHash:receipt.receiptHash,sourcePath:sourcePath(capture),query:capture.query,capturedAt:capture.capturedAt});
  }
  sourceContexts.push({captureHash:capture.captureHash,sourceReceiptHash:receipt.receiptHash,sourcePath:sourcePath(capture),query:capture.query,capturedAt:capture.capturedAt,facts:contexts.map(f=>({kind:f.kind,quote:f.quote})),factsHash:publicResearchHash(contexts)});
 }
 if(new Set(evidence.map(x=>x.ref)).size!==evidence.length||evidence.length>48)return fail("r12_public_substantive_evidence_bound");
 const body={version:"r12.public-evidence-selection.1"as const,policy:"all_substantive_metrics_no_ranking"as const,phase,sourceReceiptHashes:sorted(ordered.map(x=>x.receiptHash)),selectedRefs:sorted(evidence.map(x=>x.ref)),contextRefs:sorted(contextRefs),privateIdentityFactCount,allWitnessesHash:publicResearchHash(ordered.map(r=>({receiptHash:r.receiptHash,witnesses:r.witnesses})))};
 return{evidence,sourceContexts,selection:{...body,selectionHash:publicResearchHash(body)}};
}
function sourcePath(c:EtsyInsightsCapture):string{return new URL(c.canonicalUrl).pathname;}
export function publicResearchModelSelectionDisclosure(s:PublicResearchEvidenceSelection){return{version:s.version,policy:s.policy,sourceCount:s.sourceReceiptHashes.length,selectedMetricCount:s.selectedRefs.length,contextFactCount:s.contextRefs.length,privateIdentityFactCount:s.privateIdentityFactCount,allWitnessesHash:s.allWitnessesHash,selectionHash:s.selectionHash};}
/** Every prior local attempt remains visible, including failed work and all
 * exact conclusion/rationale/contrary/gap text. Deduplication is exact only. */
export function publicResearchModelLocalHistory(state:PublicResearchState){
 return state.attempts.slice(0,-1).map(a=>{const r=a.review;return{attemptOrdinal:a.ordinal,kind:a.kind,status:a.status,command:a.command,failureHash:a.failureHash,review:r===null?null:{reviewHash:r.reviewHash,outcome:r.outcome,hypothesisFinding:r.hypothesisFinding,conclusion:r.conclusion,qualityBasisPoints:r.quality.qualityBasisPoints,findingRationales:sorted(PUBLIC_RESEARCH_DIMENSIONS.map(d=>r.quality.quality[d].rationale)),supportingEvidenceRefs:sorted([...r.conclusionEvidenceRefs,...PUBLIC_RESEARCH_DIMENSIONS.flatMap(d=>r.quality.quality[d].evidenceRefs)]),contraryEvidenceRefs:sorted([...r.contraryEvidenceRefs,...PUBLIC_RESEARCH_DIMENSIONS.flatMap(d=>r.quality.quality[d].contraryRefs)]),missingFacts:sorted([...r.missingCriticalRequirements,...PUBLIC_RESEARCH_DIMENSIONS.flatMap(d=>r.quality.quality[d].missingFacts)])}};});
}
/** Zero-based citation positions are a lossless display encoding only. Models
 * still return the full `ref` values from sourceEvidence. Unmapped historical
 * refs stay explicit and cannot be silently discarded or newly cited. */
export function publicResearchModelLocalHistoryWire(state:PublicResearchState,evidence:readonly PublicResearchModelEvidence[]){
 const refs=evidence.map(x=>x.ref);const encode=(values:string[])=>({sourceEvidenceZeroBasedIndexes:values.filter(v=>refs.includes(v)).map(v=>refs.indexOf(v)).sort((a,b)=>a-b),archivedRefs:values.filter(v=>!refs.includes(v))});
 return publicResearchModelLocalHistory(state).map(a=>{const{criteriaHash,questionHash,...command}=a.command;void criteriaHash;void questionHash;return {...a,command,review:a.review===null?null:{...a.review,supportingEvidenceRefs:encode(a.review.supportingEvidenceRefs),contraryEvidenceRefs:encode(a.review.contraryEvidenceRefs)}};});
}
