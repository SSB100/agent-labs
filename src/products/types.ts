import type { EvidencePack } from "../research/types";

export const SCORING_VERSION = "pod-discovery-1.0";
export const DIMENSIONS = ["demand", "competition", "differentiation", "estimated_margin", "creative_opportunity", "seasonality", "production_complexity", "policy_ip_risk", "marketing_potential"] as const;
export type Dimension = (typeof DIMENSIONS)[number];
export type CandidateOutcome = "TEST" | "REJECT" | "NEEDS_MORE_EVIDENCE";
export type CandidateInput = {
  concept: string; audience: string; hypothesis: string; originalDesign: boolean;
  rightsStatus: "confirmed" | "unclear"; sourceDomains: string[];
};
export type MeasurementPlan = {
  metric: "qualified_interest_count"; minimumSampleSize: number; minimumDays: number;
  successThreshold: number; maximumBudgetUsd: 0; channel: "research_only";
  stopRule: string;
};
export type DimensionAssessment = {
  dimension: Dimension; score: number | null; evidenceIds: string[];
  rationale: string; evidenceKind: "unassessed" | "market_observation" | "operational_fact" | "policy";
};
export type CandidateAssessment = {
  ownerRightsConfirmed?: true;
  scoringVersion: typeof SCORING_VERSION; dimensions: DimensionAssessment[]; totalScore: number | null;
  outcome: CandidateOutcome; missingEvidence: string[]; reasons: string[];
  evidenceIds: string[]; assessmentOrigin: "deterministic_provisional" | "owner_assessment";
  review: { status: "contract_checked"; liveQualified: false; creativeProductionAllowed: false; publicationAllowed: false };
};
export type ProductCandidate = { current_decision_id?:string|null; current_decision_ambiguous?:boolean;
  id: string; business_id: string; fingerprint: string; concept: string; audience: string; hypothesis: string;
  product_type: "original_pod_tshirt"; original_design: boolean; rights_status: "confirmed" | "unclear";
  source_domains: string[]; created_at: string;
};
export type ProductExperiment = { has_successor?:boolean; has_competing_completed_v2?:boolean;
  id: string; business_id: string; candidate_id: string; workflow_run_id: string | null;
  fingerprint: string; hypothesis: string; variables: Record<string, unknown>; audience: string;
  creative: null; price: null; channel: "research_only"; status: "reserved" | "researching" | "completed" | "failed";
  measurement_plan: MeasurementPlan; evidence_pack: EvidencePack | null; source_artifact_id: string | null;
  basis_artifact_id: string | null; failure: string | null; started_at: string | null; completed_at: string | null; created_at: string;
};
export type ProductDecision = {
  id: string; business_id: string; candidate_id: string; experiment_id: string;
  assessment: CandidateAssessment; created_at: string;
};
/** Database history is versioned independently of this reader. Keep v1 write contracts above narrow. */
export type ProductExperimentRecord = Omit<ProductExperiment, "candidate_id" | "measurement_plan"> & {
  candidate_id: string | null; measurement_plan: unknown;
  discovery_version?: string; parent_discovery_id?: string | null;
};
export type ProductDecisionRecord = Omit<ProductDecision, "assessment"> & { assessment: unknown };
export type ProductWorkspaceData = { candidatePage?: import("../lib/core-ui/history-query").HistoryPage; experimentPage?: import("../lib/core-ui/history-query").HistoryPage; decisionPage?: import("../lib/core-ui/history-query").HistoryPage;
  candidates: ProductCandidate[]; experiments: ProductExperimentRecord[]; decisions: ProductDecisionRecord[]; errors: string[];
};
export const DEFAULT_MEASUREMENT_PLAN: MeasurementPlan = {
  metric: "qualified_interest_count", minimumSampleSize: 30, minimumDays: 7, successThreshold: 5,
  maximumBudgetUsd: 0, channel: "research_only",
  stopRule: "Stop after the planned observation window; do not infer demand below both the minimum sample and duration. No publication, advertising, or spending is authorized.",
};
