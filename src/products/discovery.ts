import { createHash } from "node:crypto";
import { canonicalResearchUrl, validateEvidencePack, validateResearchRequest } from "../research/sources";
import type { EvidencePack, ResearchRequest } from "../research/types";
import { DEFAULT_MEASUREMENT_PLAN, DIMENSIONS, SCORING_VERSION, type CandidateAssessment, type CandidateInput, type Dimension, type DimensionAssessment, type MeasurementPlan } from "./types";

export const DIMENSION_LABELS: Record<Dimension, string> = {
  demand: "Demand", competition: "Competition", differentiation: "Differentiation", estimated_margin: "Estimated margin",
  creative_opportunity: "Creative opportunity", seasonality: "Seasonality", production_complexity: "Production complexity",
  policy_ip_risk: "Policy / IP risk", marketing_potential: "Marketing potential",
};
export const MISSING_EVIDENCE: Record<Dimension, string> = {
  demand: "Candidate-specific buyer-interest observations with audience, sample, and observation period",
  competition: "Comparable original T-shirt listings with price, listing density, and review observations",
  differentiation: "Evidence of a specific unmet audience need and how the original concept differs",
  estimated_margin: "Current SKU production, shipping, marketplace/payment fees, proposed price, and deterministic margin calculation",
  creative_opportunity: "Source-linked visual opportunity and original-design feasibility without copying protected work",
  seasonality: "Dated audience-interest observations covering the intended selling period",
  production_complexity: "Verified intended SKU print specifications, fulfilment constraints, and production feasibility",
  policy_ip_risk: "Current applicable policy plus concept-specific originality, rights, and IP screening",
  marketing_potential: "Observed buyer language and channel-specific audience reach relevant to this candidate",
};
const WEIGHTS: Record<Dimension, number> = { demand: 3, competition: 1, differentiation: 1, estimated_margin: 2, creative_opportunity: 1, seasonality: 1, production_complexity: 1, policy_ip_risk: 2, marketing_potential: 1 };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function validateCandidateInput(value: unknown): asserts value is CandidateInput {
  if (!isRecord(value) || Object.keys(value).sort().join(",") !== "audience,concept,hypothesis,originalDesign,rightsStatus,sourceDomains") throw new Error("Invalid candidate fields.");
  for (const [key, min, max] of [["concept", 3, 160], ["audience", 3, 160], ["hypothesis", 10, 600]] as const) {
    if (typeof value[key] !== "string" || value[key].trim().length < min || value[key].length > max || !normalized(value[key])) throw new Error(`Candidate ${key} must contain ${min}–${max} characters.`);
  }
  if (typeof value.originalDesign !== "boolean" || !["confirmed", "unclear"].includes(String(value.rightsStatus))) throw new Error("Declare originality and rights status explicitly.");
  validateResearchRequest({ query: "Candidate source scope", allowedDomains: value.sourceDomains });

}
export function candidateFingerprint(candidate: CandidateInput): string {
  validateCandidateInput(candidate);
  return hash(["original_pod_tshirt", normalized(candidate.concept), normalized(candidate.audience)].join(":"));
}
export function candidateResearchRequest(candidate: CandidateInput): ResearchRequest {
  validateCandidateInput(candidate);
  return { query: `Research this original print-on-demand T-shirt opportunity: ${candidate.concept}. Audience: ${candidate.audience}. Find candidate-specific buyer-interest, comparable listings, dated trend signals, prices and production constraints. Separate observed facts from general policy guidance. Do not infer sales or demand from listing counts. Return inspectable sources only.`, allowedDomains: [...candidate.sourceDomains] };
}
export function validateMeasurementPlan(plan: MeasurementPlan): void {
  if (!isRecord(plan) || Object.keys(plan).sort().join(",") !== "channel,maximumBudgetUsd,metric,minimumDays,minimumSampleSize,stopRule,successThreshold" || plan.metric !== "qualified_interest_count" || plan.channel !== "research_only" || plan.maximumBudgetUsd !== 0 ||
    !Number.isInteger(plan.minimumSampleSize) || plan.minimumSampleSize < 10 || plan.minimumSampleSize > 10000 ||
    !Number.isInteger(plan.minimumDays) || plan.minimumDays < 7 || plan.minimumDays > 90 ||
    !Number.isInteger(plan.successThreshold) || plan.successThreshold < 1 || plan.successThreshold > plan.minimumSampleSize ||
    typeof plan.stopRule !== "string" || plan.stopRule.length < 20 || plan.stopRule.length > 1000) throw new Error("A bounded, zero-spend research-only measurement plan is required.");
}

/** Validate the real research snapshot, not a generated summary or simulation artifact. */
export function validateProductEvidence(pack: EvidencePack, request: ResearchRequest, now = Date.now(), historical = false): void {
  validateResearchRequest(request);
  if (!pack || pack.evidencePackVersion !== "1.0" || pack.question !== request.query || !Array.isArray(pack.sources) || pack.sources.length < 1 || pack.sources.length > 4 ||
    !Array.isArray(pack.evidence) || pack.evidence.length < 1 || pack.evidence.length > 4 || !Array.isArray(pack.claims) || pack.claims.length !== pack.evidence.length ||
    new Set(pack.sources.map(source => source.id)).size !== pack.sources.length || new Set(pack.evidence.map(evidence => evidence.id)).size !== pack.evidence.length) throw new Error("Candidate evidence must be an intact scoped Research Evidence Pack.");
  validateEvidencePack(pack);
  for (const source of pack.sources) {
    if (canonicalResearchUrl(source.url, request.allowedDomains) !== source.url || source.provider !== "openrouter.exa" || source.excerpt.length < 30 || source.excerpt.length > 1800 ||
      source.contentHash !== hash(source.excerpt) || source.id !== `src-${hash(`${source.url}:${source.contentHash}`).slice(0, 24)}` ||
      !Number.isFinite(Date.parse(source.retrievedAt)) || !Number.isFinite(Date.parse(source.retrievalExpiresAt)) || Date.parse(source.retrievedAt) > now + 300000 ||
      Date.parse(source.retrievalExpiresAt) <= Date.parse(source.retrievedAt) || Date.parse(source.retrievalExpiresAt) > Date.parse(source.retrievedAt) + 86400000 ||
      (!historical && Date.parse(source.retrievalExpiresAt) < now)) throw new Error("Candidate source provenance is stale, corrupt, or outside the research scope.");
  }
  for (const evidence of pack.evidence) {
    if (!evidence.quote || evidence.quote.length > 320 || evidence.id !== `evi-${hash(`${evidence.sourceId}:${evidence.quote}`).slice(0, 24)}` ||
      !pack.sources.some(source => source.id === evidence.sourceId && source.excerpt.includes(evidence.quote)) ||
      !pack.claims.some(claim => claim.evidenceId === evidence.id && claim.sourceId === evidence.sourceId && claim.text === evidence.quote)) throw new Error("Broken candidate evidence linkage.");
  }
}
export function unknownAssessments(): DimensionAssessment[] {
  return DIMENSIONS.map(dimension => ({ dimension, score: null, evidenceIds: [], rationale: MISSING_EVIDENCE[dimension], evidenceKind: "unassessed" }));
}
export function validateDimensionAssessments(dimensions: DimensionAssessment[], pack: EvidencePack): void {
  if (!Array.isArray(dimensions) || dimensions.length !== DIMENSIONS.length || new Set(dimensions.map(d => d.dimension)).size !== DIMENSIONS.length) throw new Error("Provide exactly one assessment for each of the nine dimensions.");
  for (const assessment of dimensions) {
    if (!isRecord(assessment) || Object.keys(assessment).sort().join(",") !== "dimension,evidenceIds,evidenceKind,rationale,score" || !DIMENSIONS.includes(assessment.dimension) ||
      typeof assessment.rationale !== "string" || assessment.rationale.trim().length < 10 || assessment.rationale.length > 600 ||
      !Array.isArray(assessment.evidenceIds) || assessment.evidenceIds.length > 4 || new Set(assessment.evidenceIds).size !== assessment.evidenceIds.length ||
      assessment.evidenceIds.some(id => !pack.evidence.some(e => e.id === id))) throw new Error("Every assessment requires a rationale and valid evidence references.");
    if (assessment.score === null) {
      if (assessment.evidenceKind !== "unassessed") throw new Error("Unknown evidence remains unassessed, not a numeric score.");
      continue;
    }
    if (!Number.isInteger(assessment.score) || assessment.score < 0 || assessment.score > 5 || !assessment.evidenceIds.length) throw new Error("A scored assessment requires 0–5 and source-linked evidence.");
    const expectedKinds = ["demand", "competition", "seasonality", "marketing_potential"].includes(assessment.dimension) ? ["market_observation"] :
      ["estimated_margin", "production_complexity"].includes(assessment.dimension) ? ["operational_fact"] :
        assessment.dimension === "policy_ip_risk" ? ["policy"] : ["market_observation", "operational_fact"];
    if (!expectedKinds.includes(assessment.evidenceKind)) throw new Error(`Evidence kind does not support ${assessment.dimension}.`);
    if (assessment.evidenceKind === "market_observation" && assessment.evidenceIds.some(id => {
      const evidence = pack.evidence.find(e => e.id === id)!;
      const sourceUrl = new URL(pack.sources.find(s => s.id === evidence.sourceId)!.url);
      return /\/(seller-handbook|legal|help|blog)(\/|$)/i.test(sourceUrl.pathname) || /^(help|support)\./i.test(sourceUrl.hostname);
    })) throw new Error("General policy or guidance pages cannot be scored as candidate market observations.");
  }
}

/** Product Strategist contract: deterministic, provisional and explicitly not live-model qualified. */
export function assessProductCandidate(candidate: CandidateInput, pack: EvidencePack, dimensions = unknownAssessments(), origin: CandidateAssessment["assessmentOrigin"] = "deterministic_provisional", plan = DEFAULT_MEASUREMENT_PLAN, ownerRightsConfirmed = false): CandidateAssessment {
  validateCandidateInput(candidate);
  validateMeasurementPlan(plan);
  validateProductEvidence(pack, candidateResearchRequest(candidate));
  validateDimensionAssessments(dimensions, pack);
  if (origin === "deterministic_provisional" && dimensions.some(dimension => dimension.score !== null)) throw new Error("Automated research does not manufacture candidate scores.");
  if (ownerRightsConfirmed && origin !== "owner_assessment") throw new Error("Only an explicit owner assessment may update its rights declaration.");
  const rightsStatus = ownerRightsConfirmed ? "confirmed" : candidate.rightsStatus;
  const ordered = DIMENSIONS.map(d => structuredClone(dimensions.find(a => a.dimension === d)!));
  const missingEvidence = ordered.filter(d => d.score === null).map(d => MISSING_EVIDENCE[d.dimension]);
  if (rightsStatus !== "confirmed") missingEvidence.push("Concept-specific originality and rights clearance");
  const allKnown = ordered.every(d => d.score !== null);
  const totalScore = allKnown ? Math.round(100 * ordered.reduce((sum, d) => sum + (d.score ?? 0) * WEIGHTS[d.dimension], 0) / 65) : null;
  const score = (dimension: Dimension) => ordered.find(d => d.dimension === dimension)!.score;
  const reasons: string[] = [];
  let outcome: CandidateAssessment["outcome"] = "NEEDS_MORE_EVIDENCE";
  if (!candidate.originalDesign || score("policy_ip_risk") === 0 || score("production_complexity") === 0) {
    outcome = "REJECT";
    if (!candidate.originalDesign) reasons.push("Original seller design is required for this POD candidate scope");
    if (score("policy_ip_risk") === 0) reasons.push("Source-linked policy/IP assessment fails the minimum gate");
    if (score("production_complexity") === 0) reasons.push("Source-linked production feasibility assessment fails the minimum gate");
  } else if (allKnown && rightsStatus === "confirmed" && (totalScore ?? 0) >= 65 && (score("demand") ?? 0) >= 3 && (score("estimated_margin") ?? 0) >= 3 && (score("policy_ip_risk") ?? 0) >= 4) {
    outcome = "TEST";
    reasons.push("Evidence-linked owner assessments meet the provisional research-test thresholds");
  } else {
    if (missingEvidence.length) reasons.push("Required candidate-specific evidence is missing or unassessed");
    if (allKnown && ((totalScore ?? 0) < 65 || (score("demand") ?? 0) < 3 || (score("estimated_margin") ?? 0) < 3 || (score("policy_ip_risk") ?? 0) < 4)) reasons.push("Test thresholds are not met: total 65/100, demand 3/5, margin 3/5, policy/IP 4/5");
  }
  return { ...(ownerRightsConfirmed ? { ownerRightsConfirmed: true as const } : {}), scoringVersion: SCORING_VERSION, dimensions: ordered, totalScore, outcome, missingEvidence, reasons,
    evidenceIds: [...new Set(pack.evidence.map(e => e.id))], assessmentOrigin: origin,
    review: { status: "contract_checked", liveQualified: false, creativeProductionAllowed: false, publicationAllowed: false } };
}

/** Reviewer contract: independently recompute gates; this checks contracts, not market competence. */
export function reviewProductAssessment(candidate: CandidateInput, pack: EvidencePack, proposed: CandidateAssessment, plan = DEFAULT_MEASUREMENT_PLAN): CandidateAssessment {
  const expected = assessProductCandidate(candidate, pack, proposed.dimensions, proposed.assessmentOrigin, plan, proposed.ownerRightsConfirmed ?? false);
  if (JSON.stringify(expected) !== JSON.stringify(proposed)) throw new Error("Candidate assessment does not match the evidence-linked decision contract.");
  return structuredClone(expected);
}
export function hasNewEvidence(previous: EvidencePack[], next: EvidencePack): boolean {
  const seen = new Set(previous.flatMap(pack => pack.sources.map(source => source.contentHash)));
  return next.sources.some(source => !seen.has(source.contentHash));
}
