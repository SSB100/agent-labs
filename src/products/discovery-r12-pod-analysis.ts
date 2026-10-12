import { assertPodArtifactBytes, isPodThoroughScope, POD_THOROUGH_LIMITS } from "./discovery-r12-pod-profile";
import type { JsonObject } from "../core/contracts";
import type { EvidencePack, ResearchCollection } from "../research/types";
import { validateEvidencePack } from "../research/sources";
import { assertJsonSchemaValue } from "../workers/schema-validator";
import { publicResearchHash } from "../research/qualification";
import { discoveryR12StaticSchema } from "./discovery-r12-schemas";
import { type PodResearchGoalScope, type PodResearchPlan } from "./discovery-r12-pod-goal";

const text = (minLength: number, maxLength: number): JsonObject => ({ type: "string", minLength, maxLength });
const obj = (properties: Record<string, JsonObject>): JsonObject => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const arr = (items: JsonObject, minItems: number, maxItems: number): JsonObject => ({ type: "array", items, minItems, maxItems });
const en = (values: readonly string[]): JsonObject => ({ type: "string", enum: [...values] });
const nullable = (schema: JsonObject): JsonObject => ({ anyOf: [schema, { type: "null" }] });
const evidenceKey = en(["E1", "E2", "E3", "E4"]);
const evidence = { ...arr(evidenceKey, 0, 4), uniqueItems: true };
export const POD_REVIEW_CHECKS = ["goal_alignment", "source_quality_and_independence", "claim_support", "counterevidence", "pod_feasibility", "uncertainty_and_next_test"] as const;
export const POD_DIMENSIONS = ["buyer_need", "competition_and_differentiation", "pod_fulfilment", "unit_economics", "rights_and_restrictions"] as const;
const finding = obj({ dimension: en(POD_DIMENSIONS), verdict: en(["supported", "uncertain", "unfavorable"]), rationale: text(30, 300), evidence, missing: arr(text(15, 180), 0, 3) });
const schemas = {
  plan: obj({ comparisonRationale: text(40, 700), query: text(20, 800), sourceDomains: arr(text(4, 200), 1, 6), sourceChoiceRationale: text(30, 500),
    hypotheses: arr(obj({ productType: text(3, 120), niche: text(3, 160), audience: text(3, 160), hypothesis: text(20, 400), contraryExplanation: text(20, 400) }), 1, 3) }),
  select1: discoveryR12StaticSchema("select1"),
  strategy: obj({ explorationSummary: text(60, 650), candidates: arr(obj({ productType: text(3, 120), niche: text(3, 160), audience: text(3, 160),
    rationale: text(40, 350), support: evidence, counterevidence: evidence, alternativeExplanation: text(30, 300), dimensions: arr(finding, 5, 5) }), 1, 3),
    recommendation: obj({ outcome: en(["HYPOTHESIS_TO_TEST", "INSUFFICIENT_EVIDENCE"]), candidateIndex: nullable({ type: "integer", minimum: 0, maximum: 2 }), rationale: text(60, 500), nextTest: text(40, 400) }),
    limitations: arr(text(20, 220), 1, 8), etsyDemandVerified: { const: false }, commercialViabilityVerified: { const: false } }),
  review: obj({ outcome: en(["HYPOTHESIS_TO_TEST", "INSUFFICIENT_EVIDENCE"]), candidateIndex: nullable({ type: "integer", minimum: 0, maximum: 2 }), rationale: text(60, 600),
    checks: arr(obj({ check: en(POD_REVIEW_CHECKS), verdict: en(["PASS", "FAIL"]), rationale: text(30, 240), evidence }), 6, 6),
    missingEvidence: arr(text(20, 220), 1, 8), nextTest: text(40, 400), etsyDemandVerified: { const: false }, commercialViabilityVerified: { const: false } }),
};
const thoroughEvidenceKey = en([...Array.from({length:48},(_,i)=>`E${i+1}`), ...Array.from({length:5},(_,p)=>Array.from({length:48},(_,i)=>`P${p+1}E${i+1}`)).flat()]);
const thoroughEvidence = {...arr(thoroughEvidenceKey,0,48),uniqueItems:true};
const thoroughFinding = obj({dimension:en(POD_DIMENSIONS),verdict:en(["supported","uncertain","unfavorable"]),rationale:text(30,8000),evidence:thoroughEvidence,missing:arr(text(15,4000),0,24)});
const thoroughSchemas = {
 plan:obj({comparisonRationale:text(40,8000),query:text(20,4000),sourceDomains:arr(text(4,200),1,16),sourceChoiceRationale:text(30,8000),
 hypotheses:arr(obj({productType:text(3,120),niche:text(3,160),audience:text(3,160),hypothesis:text(20,4800),contraryExplanation:text(20,4800)}),1,16)}),
 select1:obj({selections:arr(obj({sourceKey:en(Array.from({length:POD_THOROUGH_LIMITS.maximumResults},(_,i)=>`S${i+1}`)),quote:text(20,POD_THOROUGH_LIMITS.maximumQuoteCharacters)}),0,POD_THOROUGH_LIMITS.maximumQuotes),limitations:{...arr(en(["limited_sources","publication_dates_unknown","no_sales_metrics","no_current_prices"]),0,4),uniqueItems:true}}),
 strategy:obj({explorationSummary:text(60,16000),candidates:arr(obj({productType:text(3,120),niche:text(3,160),audience:text(3,160),rationale:text(40,8000),support:thoroughEvidence,counterevidence:thoroughEvidence,alternativeExplanation:text(30,8000),dimensions:arr(thoroughFinding,5,5)}),0,16),
 recommendation:obj({outcome:en(["HYPOTHESIS_TO_TEST","INSUFFICIENT_EVIDENCE"]),candidateIndex:nullable({type:"integer",minimum:0,maximum:15}),rationale:text(60,16000),nextTest:text(40,12000)}),
 limitations:arr(text(20,4000),1,16),etsyDemandVerified:{const:false},commercialViabilityVerified:{const:false}}),
 review:obj({outcome:en(["HYPOTHESIS_TO_TEST","INSUFFICIENT_EVIDENCE"]),candidateIndex:nullable({type:"integer",minimum:0,maximum:15}),rationale:text(60,16000),
 checks:arr(obj({check:en(POD_REVIEW_CHECKS),verdict:en(["PASS","FAIL"]),rationale:text(30,8000),evidence:thoroughEvidence}),6,6),missingEvidence:arr(text(20,4000),1,16),nextTest:text(40,12000),etsyDemandVerified:{const:false},commercialViabilityVerified:{const:false}}),
};
export type PodPhase = "plan" | "search1" | "select1" | "strategy" | "review";
export function podResearchSchema(phase: Exclude<PodPhase, "search1">, thorough=false): JsonObject { return structuredClone((thorough?thoroughSchemas:schemas)[phase]); }
export type PodEvidenceView = { key: string; quote: string; url: string; title: string; retrievedAt: string; publishedAt: string | null; contentHash: string; evidenceId: string };
export function podEvidenceView(pack: EvidencePack): PodEvidenceView[] {
  validateEvidencePack(pack);
  return pack.evidence.map((item, index) => {
    const source = pack.sources.find(s => s.id === item.sourceId);
    if (!source || !source.excerpt.includes(item.quote)) throw new Error("r12_pod_evidence_unverified");
    return { key: `E${index + 1}`, quote: item.quote, url: source.url, title: source.title, retrievedAt: source.retrievedAt, publishedAt: source.publishedAt,
      contentHash: source.contentHash, evidenceId: item.id };
  });
}
const fail = (): never => { throw new Error("r12_pod_assessment_unverified"); };
type PodFinding = { dimension: typeof POD_DIMENSIONS[number]; verdict: "supported" | "uncertain" | "unfavorable"; rationale: string; evidence: string[]; missing: string[] };
export type PodAssessment = { explorationSummary: string; candidates: Array<{ productType: string; niche: string; audience: string; rationale: string; support: string[]; counterevidence: string[]; alternativeExplanation: string; dimensions: PodFinding[] }>;
  recommendation: { outcome: "HYPOTHESIS_TO_TEST" | "INSUFFICIENT_EVIDENCE"; candidateIndex: number | null; rationale: string; nextTest: string };
  limitations: string[]; etsyDemandVerified: false; commercialViabilityVerified: false };
export type PodReview = { outcome: "HYPOTHESIS_TO_TEST" | "INSUFFICIENT_EVIDENCE"; candidateIndex: number | null; rationale: string;
  checks: Array<{ check: typeof POD_REVIEW_CHECKS[number]; verdict: "PASS" | "FAIL"; rationale: string; evidence: string[] }>;
  missingEvidence: string[]; nextTest: string; etsyDemandVerified: false; commercialViabilityVerified: false };
function refs(keys: string[], evidence: PodEvidenceView[]) {
  if (new Set(keys).size !== keys.length || keys.some(key => !evidence.some(e => e.key === key))) fail();
}
export function validatePodAssessment(raw: unknown, pack: EvidencePack, thorough=false, priorEvidence:PodEvidenceView[]=[]): PodAssessment {
  if(thorough)assertPodArtifactBytes(raw,"strategy");
  assertJsonSchemaValue(podResearchSchema("strategy",thorough), raw, "POD research assessment");
  const a = structuredClone(raw) as PodAssessment, evidence = [...podEvidenceView(pack),...priorEvidence];
  const identities = new Set(a.candidates.map(c => [c.productType, c.niche, c.audience].join("|").toLowerCase()));
  if (identities.size !== a.candidates.length) fail();
  for (const candidate of a.candidates) {
    refs(candidate.support, evidence); refs(candidate.counterevidence, evidence);
    if (candidate.dimensions.length !== POD_DIMENSIONS.length || new Set(candidate.dimensions.map(d => d.dimension)).size !== POD_DIMENSIONS.length) fail();
    for (const finding of candidate.dimensions) {
      refs(finding.evidence, evidence);
      if (finding.verdict !== "uncertain" && finding.evidence.length === 0 || finding.verdict === "uncertain" && finding.missing.length === 0) fail();
    }
  }
  if (a.recommendation.outcome === "INSUFFICIENT_EVIDENCE") { if (a.recommendation.candidateIndex !== null) fail(); }
  else {
    const c = a.recommendation.candidateIndex === null ? null : a.candidates[a.recommendation.candidateIndex];
    if (!c || c.support.length === 0 || c.dimensions.some(d => d.verdict === "unfavorable" && ["rights_and_restrictions", "pod_fulfilment"].includes(d.dimension))) fail();
  }
  return a;
}
export function validatePodReview(raw: unknown, assessment: PodAssessment, pack: EvidencePack, thorough=false, priorEvidence:PodEvidenceView[]=[]): PodReview {
  if(thorough)assertPodArtifactBytes(raw,"review");
  assertJsonSchemaValue(podResearchSchema("review",thorough), raw, "Independent POD research review");
  return assertPodReviewMeaning(raw as PodReview, assessment, pack,thorough,priorEvidence);
}
/** Domain checks only. Callers must separately validate the complete schema. */
export function assertPodReviewMeaning(raw: PodReview, assessment: PodAssessment, pack: EvidencePack,thorough=false,priorEvidence:PodEvidenceView[]=[]): PodReview {
  validatePodAssessment(assessment, pack,thorough,priorEvidence);
  const review = structuredClone(raw) as PodReview, evidence = [...podEvidenceView(pack),...priorEvidence];
  if (thorough && evidence.length === 0 && (review.outcome !== "INSUFFICIENT_EVIDENCE" || review.checks.some(c => ["source_quality_and_independence", "claim_support"].includes(c.check) && c.verdict !== "FAIL"))) fail();
  if (new Set(review.checks.map(c => c.check)).size !== POD_REVIEW_CHECKS.length) fail();
  review.checks.forEach(check => refs(check.evidence, evidence));
  if (review.outcome === "HYPOTHESIS_TO_TEST") {
    if (assessment.recommendation.outcome !== "HYPOTHESIS_TO_TEST" || review.candidateIndex !== assessment.recommendation.candidateIndex || review.checks.some(c => c.verdict !== "PASS")) fail();
  } else if (review.candidateIndex !== null) fail();
  return review;
}
export function podResearchResult(scope: PodResearchGoalScope, plan: PodResearchPlan, collection: ResearchCollection, pack: EvidencePack, assessment: PodAssessment, review: PodReview, priorEvidence:PodEvidenceView[]=[]) {
  validatePodReview(review, assessment, pack,isPodThoroughScope(scope),priorEvidence);
  return { version: "r12.pod-research-result.2" as const, businessId: scope.businessId, goalId: scope.goalId, scopeId: scope.id,
    objective: scope.publicBrief.objective, submittedQuery: plan.query, queryProvenance: plan.queryProvenance,
    selectedDomains: plan.sourceDomains, sourceChoiceRationale: plan.sourceChoiceRationale, sourcePolicyHash: scope.sourcePolicyHash,
    collectionHash: publicResearchHash(collection), evidence: [...podEvidenceView(pack),...priorEvidence], assessment, review, executionAuthorized: false as const,
    evidenceLimitations: ["One bounded public-source collection; not exhaustive market research.", "No verified Etsy demand, sales, margins or legal clearance.", "Publication dates are unknown unless independently established; retrieval time is not publication time."] };
}
