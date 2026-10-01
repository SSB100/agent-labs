import { randomUUID } from "node:crypto";
import { assessProductCandidate } from "../products/discovery";
import { isLegacyProductDecision, isLegacyProductExperiment } from "../products/history";
import type { ProductCandidate, ProductDecisionRecord, ProductExperimentRecord } from "../products/types";
import type { ReviewerDecisionV2 } from "../products/discovery-v2";
import type { CandidateAssessment } from "../products/types";
import { creativeHash, validateCreativeApproval, isReviewedDiscoveryTest } from "./contracts";
import type { ImageGenerationModelId } from "./image-provider";
import { technicalCreativeApproval } from "./proposal";
import type { CreativeApprovalSnapshot, CreativeGenerationLimit, PolicyScreen } from "./types";

export type ProductionCandidateChoice = { candidate: ProductCandidate; decision: ProductDecisionRecord & {assessment:CandidateAssessment|ReviewerDecisionV2}; experiment: ProductExperimentRecord; root?:ProductExperimentRecord; maximumGenerations?:CreativeGenerationLimit };
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==="object"&&!Array.isArray(value);


/** UI preflight only. The owner RPC independently checks authoritative lineage and freshness again. */
export function currentProductionCandidate(candidate: ProductCandidate, decisions: ProductDecisionRecord[], experiments: ProductExperimentRecord[]): ProductionCandidateChoice | null {
  const matching = decisions.filter(d => d.candidate_id === candidate.id && d.business_id === candidate.business_id)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const decision = matching[0];
  // Select latest before narrowing: an unsupported newer decision must never revive an older TEST.
  if (!decision || matching.some(d => d.id !== decision.id && Date.parse(d.created_at) >= Date.parse(decision.created_at))) return null;
  const experiment = experiments.find(e => e.id === decision.experiment_id && e.candidate_id === candidate.id && e.business_id === candidate.business_id);
  if(!experiment||experiment.status!=="completed")return null;
  if(experiment.discovery_version==="pod-discovery-2.0"){
    if(!isReviewedDiscoveryTest(decision.assessment,candidate.id)||!experiment.parent_discovery_id)return null;
    const root=experiments.find(e=>e.id===experiment.parent_discovery_id&&e.business_id===candidate.business_id&&e.candidate_id===null&&e.status==="completed");
    if(!root||!record(root.variables.intent)||typeof root.variables.intent.expiresAt!=="string"||Date.parse(root.variables.intent.expiresAt)<=Date.now()||
       decision.assessment.intentId!==root.id||!root.source_artifact_id||experiment.source_artifact_id!==root.source_artifact_id||creativeHash(experiment.evidence_pack)!==creativeHash(root.evidence_pack)||
       !record(experiment.measurement_plan)||!record(experiment.measurement_plan.testPlan)||![1,2].includes(Number(experiment.measurement_plan.testPlan.maximumGenerations)))return null;
    if(experiments.some(e=>e.id!==experiment.id&&e.candidate_id===candidate.id&&e.business_id===candidate.business_id&&e.discovery_version==="pod-discovery-2.0"&&e.status==="completed"&&Date.parse(e.created_at)>=Date.parse(experiment.created_at)))return null;
    return{candidate,decision:{...decision,assessment:decision.assessment},experiment,root,maximumGenerations:experiment.measurement_plan.testPlan.maximumGenerations as CreativeGenerationLimit};
  }
  if(!isLegacyProductDecision(decision))return null;
  if (!experiment || !isLegacyProductExperiment(experiment) || experiment.status !== "completed" || !experiment.source_artifact_id || !experiment.evidence_pack || decision.assessment.assessmentOrigin !== "owner_assessment") return null;
  // A newer completed v2 evaluation can add contrary evidence without selecting this candidate.
  // Its experiment supersedes this older evidence context; no invented per-candidate verdict is needed.
  if (experiments.some(e => e.business_id === candidate.business_id && e.candidate_id === candidate.id &&
    e.discovery_version === "pod-discovery-2.0" && e.status === "completed" &&
    Date.parse(e.created_at ?? e.completed_at ?? "") >= Date.parse(experiment.created_at ?? decision.created_at))) return null;
  try {
    const assessed = assessProductCandidate({ concept: candidate.concept, audience: candidate.audience, hypothesis: candidate.hypothesis,
      originalDesign: candidate.original_design, rightsStatus: candidate.rights_status, sourceDomains: candidate.source_domains },
    experiment.evidence_pack, decision.assessment.dimensions, "owner_assessment", experiment.measurement_plan, decision.assessment.ownerRightsConfirmed ?? false);
    if (assessed.outcome !== "TEST" || creativeHash(assessed) !== creativeHash(decision.assessment)) return null;
    return { candidate, decision, experiment };
  } catch { return null; }
}

export function productionCreativeApproval(choice: ProductionCandidateChoice, input: {
  approvalId?: string; designInstructions: string; rightsStatement: string; policyScreen: PolicyScreen[]; maximumMicrousd: number; maximumGenerations?: CreativeGenerationLimit; generatorModel?: ImageGenerationModelId;
}): CreativeApprovalSnapshot {
  // Never accept editable concept, audience, assessment or Business fields from the form.
  const { candidate, decision } = choice;
  const verified=currentProductionCandidate(candidate, [decision], [choice.experiment,...(choice.root?[choice.root]:[])]);
  if (!verified) throw new Error("Current source-linked reviewed TEST and fresh evidence are required.");
  if(verified.maximumGenerations&&(input.maximumGenerations??verified.maximumGenerations)>verified.maximumGenerations)throw new Error("Creative image count exceeds the reviewed learning experiment.");
  const base = technicalCreativeApproval(candidate.business_id, candidate.id, input.maximumMicrousd,
    { concept: candidate.concept, audience: candidate.audience, designInstructions: input.designInstructions }, input.approvalId ?? randomUUID(), input.maximumGenerations ?? verified.maximumGenerations ?? 2, input.generatorModel);
  const approval: CreativeApprovalSnapshot = { ...base, purpose: "candidate_production", decisionId: decision.id,
    candidateAssessment: structuredClone(decision.assessment), rightsStatement: input.rightsStatement, policyScreen: structuredClone(input.policyScreen) };
  validateCreativeApproval(approval);
  return approval;
}
