import {
  DIMENSIONS, SCORING_VERSION, type CandidateAssessment, type CandidateOutcome, type MeasurementPlan,
  type ProductDecision, type ProductDecisionRecord, type ProductExperiment, type ProductExperimentRecord,
} from "./types";

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string");
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Read only the explicitly recorded outcome; unknown formats never become a zero or a rejection. */
export function recordedProductOutcome(value: unknown): CandidateOutcome | null {
  if (!record(value)) return null;
  return value.outcome === "TEST" || value.outcome === "REJECT" || value.outcome === "NEEDS_MORE_EVIDENCE" ? value.outcome : null;
}

export function productAssessmentVersion(value: unknown): string {
  if (!record(value)) return "Unrecognized format";
  const version = typeof value.version === "string" ? value.version : value.scoringVersion;
  return typeof version === "string" && version.trim() ? version : "Unrecognized format";
}

/** Shape guard for the legacy renderer, not evidence validation or production authorization. */
export function isLegacyProductAssessment(value: unknown): value is CandidateAssessment {
  if (!record(value) || value.scoringVersion !== SCORING_VERSION || (value.version !== undefined && value.version !== SCORING_VERSION)
    || !recordedProductOutcome(value) || !Array.isArray(value.dimensions) || value.dimensions.length !== DIMENSIONS.length
    || !(value.totalScore === null || (finite(value.totalScore) && value.totalScore >= 0 && value.totalScore <= 100))
    || !strings(value.reasons) || !strings(value.missingEvidence) || !strings(value.evidenceIds)
    || !["deterministic_provisional", "owner_assessment"].includes(String(value.assessmentOrigin))
    || (value.ownerRightsConfirmed !== undefined && value.ownerRightsConfirmed !== true)
    || !record(value.review) || value.review.status !== "contract_checked" || value.review.liveQualified !== false
    || value.review.creativeProductionAllowed !== false || value.review.publicationAllowed !== false) return false;
  const dimensions = value.dimensions;
  return DIMENSIONS.every(dimension => dimensions.filter(entry => record(entry) && entry.dimension === dimension).length === 1)
    && dimensions.every(entry => record(entry) && (entry.score === null || (finite(entry.score) && Number.isInteger(entry.score) && entry.score >= 0 && entry.score <= 5))
      && typeof entry.rationale === "string" && strings(entry.evidenceIds)
      && ["unassessed", "market_observation", "operational_fact", "policy"].includes(String(entry.evidenceKind)));
}

export function isLegacyProductDecision(value: ProductDecisionRecord): value is ProductDecision {
  return isLegacyProductAssessment(value.assessment);
}

export function isLegacyMeasurementPlan(value: unknown): value is MeasurementPlan {
  return record(value) && value.metric === "qualified_interest_count" && value.channel === "research_only"
    && value.maximumBudgetUsd === 0 && typeof value.stopRule === "string"
    && [value.minimumSampleSize, value.minimumDays, value.successThreshold].every(item => finite(item) && item >= 0);
}

export function isLegacyProductExperiment(value: ProductExperimentRecord): value is ProductExperiment {
  return (value.discovery_version === undefined || value.discovery_version === SCORING_VERSION)
    && typeof value.candidate_id === "string" && !value.parent_discovery_id && isLegacyMeasurementPlan(value.measurement_plan);
}

/** Only the lookup keys are narrowed. Root experiments remain in the returned history. */
export function linkedProductCandidateIds(experiments: readonly ProductExperimentRecord[]): string[] {
  return [...new Set(experiments.flatMap(experiment => typeof experiment.candidate_id === "string" ? [experiment.candidate_id] : []))];
}

export function hasOnlyLegacyProductHistory(candidateId: string | null, experiments: readonly ProductExperimentRecord[], decisions: readonly ProductDecisionRecord[]): boolean {
  return candidateId !== null && experiments.filter(experiment => experiment.candidate_id === candidateId).every(isLegacyProductExperiment)
    && decisions.filter(decision => decision.candidate_id === candidateId).every(isLegacyProductDecision);
}

export function productExperimentLabel(experiment: ProductExperimentRecord): string {
  if (experiment.candidate_id === null) return "Discovery root · no candidate assigned";
  if (isLegacyProductExperiment(experiment)) return experiment.basis_artifact_id ? "Evidence-led reconsideration" : "Initial research";
  return `Versioned experiment · ${experiment.discovery_version ?? "Unrecognized format"}`;
}

export function productHistorySummary(decisions: readonly ProductDecisionRecord[]) {
  const latest = new Map<string, ProductDecisionRecord>();
  for (const decision of [...decisions].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    if (!latest.has(decision.candidate_id)) latest.set(decision.candidate_id, decision);
  }
  return {
    needsEvidence: [...latest.values()].filter(decision => recordedProductOutcome(decision.assessment) === "NEEDS_MORE_EVIDENCE").length,
    unsupportedAssessments: [...latest.values()].filter(decision => !isLegacyProductAssessment(decision.assessment)).length,
    unrecognizedOutcomes: [...latest.values()].filter(decision => recordedProductOutcome(decision.assessment) === null).length,
  };
}
