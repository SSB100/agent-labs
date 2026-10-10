import { exactPublicKeys as exact, publicInteger as integer, publicResearchFail as fail, publicText as text, publicResearchHash } from "./discovery-r12-public-utils";
export const PUBLIC_RESEARCH_RUBRIC_VERSION = "r12.research-quality-rubric.1" as const;
export const PUBLIC_RESEARCH_QUALITY_THRESHOLD = 8000;
export const PUBLIC_RESEARCH_DIMENSIONS = ["sourceFidelity","decisionRelevance","measurementComparability","counterevidence","uncertaintyDiscipline"] as const;
export type PublicResearchQualityDimension = typeof PUBLIC_RESEARCH_DIMENSIONS[number];
export const PUBLIC_RESEARCH_QUALITY_WEIGHTS: Record<PublicResearchQualityDimension, number> = { sourceFidelity:25, decisionRelevance:20, measurementComparability:20, counterevidence:20, uncertaintyDiscipline:15 };
/** Provisional auditable anchors, not calibrated probabilities of business success. */
export const PUBLIC_RESEARCH_QUALITY_ANCHORS: Record<PublicResearchQualityDimension, readonly string[]> = {
  sourceFidelity: ["No attributable source.","Only assertion or unverifiable transcription.","Attributable source with material capture/context gaps.","Authenticated direct capture and exact grounded citations with limitations disclosed.","All material claims reproducible from complete direct capture provenance; corroborating observations where needed."],
  decisionRelevance: ["No connection to the scoped question.","Broad topic similarity only.","Some decision requirements addressed; a critical requirement remains.","All critical requirements of the scoped hypothesis addressed with explicit claim-to-evidence mapping.","Decision alternatives and discriminating observations explicitly tested against all reviewed requirements."],
  measurementComparability: ["Units, population or window unknown and treated as comparable.","Material denominators or reporting context absent.","Context is disclosed and incompatible observations kept separate; conclusion remains descriptive.","Required windows, populations, units and exposure are witnessed and comparable, or a strictly descriptive conclusion needs no comparison.","Repeated comparable measurements or an appropriate independent reference address material confounders."],
  counterevidence: ["No opposing explanation considered.","Opposition named without a test.","A concrete opposing check is recorded but material opposition remains unresolved.","Material opposing explanations checked with contrary evidence cited and limits preserved.","Strongest plausible alternatives and disconfirming observations are explicitly compared; unresolved contradictions bound the conclusion."],
  uncertaintyDiscipline: ["Invents certainty or unsupported sales/conversion claims.","Generic caveats conflict with the conclusion.","Some missing facts acknowledged but important inference boundaries remain unclear.","All material unknowns and evidence limits stated; claims remain within witnessed information.","Conclusion is precisely bounded, falsifiable, and distinguishes support, refutation, insufficient evidence and unmeasured outcomes."]
};
export type PublicResearchQualityRating = { score: number; anchorId: string; rationale: string; evidenceRefs: string[]; contraryRefs: string[]; missingFacts: string[] };
export type PublicResearchQuality = Record<PublicResearchQualityDimension, PublicResearchQualityRating>;
export type PublicResearchQualityContext = { allowedEvidenceRefs: string[]; missingCriticalRequirements: string[]; comparativeConclusion: boolean; materialOpposingExplanation: boolean; sourceAcquisitionVerified: boolean; citationGroundingVerified: boolean; independentReviewerVerified: boolean; sourceTemporalPrecisionSufficient: boolean; claimBoundariesRespected: boolean };
function refs(v: unknown, allowed: Set<string>, max=48): v is string[] { return Array.isArray(v) && v.length <= max && new Set(v).size === v.length && v.every(x => typeof x === "string" && allowed.has(x)); }
export function evaluatePublicResearchQuality(raw: unknown, context: PublicResearchQualityContext) {
  if (!exact(raw,PUBLIC_RESEARCH_DIMENSIONS.join(",")) || !Array.isArray(context.allowedEvidenceRefs) || new Set(context.allowedEvidenceRefs).size !== context.allowedEvidenceRefs.length || context.allowedEvidenceRefs.length > 1536 || !context.allowedEvidenceRefs.every(x=>text(x,200))) return fail();
  if (!Array.isArray(context.missingCriticalRequirements) || context.missingCriticalRequirements.length>48 || !context.missingCriticalRequirements.every(x=>text(x,1000))) return fail();
  for (const k of ["comparativeConclusion","materialOpposingExplanation","sourceAcquisitionVerified","citationGroundingVerified","independentReviewerVerified","sourceTemporalPrecisionSufficient","claimBoundariesRespected"] as const) if (typeof context[k] !== "boolean") return fail();
  const allowed = new Set(context.allowedEvidenceRefs), failures:string[]=[]; let qualityBasisPoints=0;
  for (const d of PUBLIC_RESEARCH_DIMENSIONS) {
    const r=raw[d]; if (!exact(r,"score,anchorId,rationale,evidenceRefs,contraryRefs,missingFacts") || !integer(r.score,0,4) || r.anchorId!==`${d}.${r.score}` || !text(r.rationale,2000) || !refs(r.evidenceRefs,allowed) || !refs(r.contraryRefs,allowed) || !Array.isArray(r.missingFacts) || r.missingFacts.length>16 || !r.missingFacts.every(x=>text(x,1000))) return fail();
    qualityBasisPoints+=PUBLIC_RESEARCH_QUALITY_WEIGHTS[d]*r.score*25;
    const floor = ["sourceFidelity","decisionRelevance","uncertaintyDiscipline"].includes(d) || d==="measurementComparability"&&context.comparativeConclusion || d==="counterevidence"&&context.materialOpposingExplanation ? 3 : 2;
    if (r.score<floor) failures.push(`${d}_below_floor`);
    if (r.score>=3 && r.evidenceRefs.length===0) failures.push(`${d}_ungrounded_high_score`);
    if (d==="counterevidence" && r.score>=3 && r.contraryRefs.length===0) failures.push("counterevidence_missing_contrary_citation");
  }
  if (qualityBasisPoints<PUBLIC_RESEARCH_QUALITY_THRESHOLD) failures.push("below_quality_threshold");
  if (context.missingCriticalRequirements.length) failures.push("missing_critical_requirements");
  for (const k of ["sourceAcquisitionVerified","citationGroundingVerified","independentReviewerVerified","claimBoundariesRespected"] as const) if(!context[k]) failures.push(k);
  if(context.comparativeConclusion&&!context.sourceTemporalPrecisionSufficient) failures.push("insufficient_temporal_precision");
  const body={version:PUBLIC_RESEARCH_RUBRIC_VERSION,quality:structuredClone(raw) as PublicResearchQuality,qualityBasisPoints,minimumBasisPoints:PUBLIC_RESEARCH_QUALITY_THRESHOLD,passed:failures.length===0,failures,thresholdCalibrated:false as const,isCommercialSuccessProbability:false as const,executionAuthorized:false as const};
  return {...body,qualityHash:publicResearchHash(body)};
}
export type PublicResearchQualityResult = ReturnType<typeof evaluatePublicResearchQuality>;
export function publicResearchQualitySchema(): Record<string,unknown> {
  return {type:"object",additionalProperties:false,required:[...PUBLIC_RESEARCH_DIMENSIONS],properties:Object.fromEntries(PUBLIC_RESEARCH_DIMENSIONS.map(d=>[d,{type:"object",additionalProperties:false,required:["score","anchorId","rationale","evidenceRefs","contraryRefs","missingFacts"],properties:{score:{type:"integer",minimum:0,maximum:4},anchorId:{type:"string",enum:[0,1,2,3,4].map(n=>`${d}.${n}`)},rationale:{type:"string",minLength:1,maxLength:2000},evidenceRefs:{type:"array",maxItems:48,items:{type:"string",minLength:1,maxLength:200}},contraryRefs:{type:"array",maxItems:48,items:{type:"string",minLength:1,maxLength:200}},missingFacts:{type:"array",maxItems:16,items:{type:"string",minLength:1,maxLength:1000}}}}]))};
}
