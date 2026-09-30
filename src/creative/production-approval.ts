import { randomUUID } from "node:crypto";
import { assessProductCandidate } from "../products/discovery";
import type { ProductCandidate, ProductDecision, ProductExperiment } from "../products/types";
import { creativeHash, validateCreativeApproval } from "./contracts";
import type { ImageGenerationModelId } from "./image-provider";
import { technicalCreativeApproval } from "./proposal";
import type { CreativeApprovalSnapshot, CreativeGenerationLimit, PolicyScreen } from "./types";

export type ProductionCandidateChoice = { candidate: ProductCandidate; decision: ProductDecision; experiment: ProductExperiment };

/** UI preflight only. The owner RPC independently checks authoritative lineage and freshness again. */
export function currentProductionCandidate(candidate: ProductCandidate, decisions: ProductDecision[], experiments: ProductExperiment[]): ProductionCandidateChoice | null {
  const matching = decisions.filter(d => d.candidate_id === candidate.id && d.business_id === candidate.business_id)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const decision = matching[0];
  if (!decision || matching.some(d => d.id !== decision.id && Date.parse(d.created_at) >= Date.parse(decision.created_at))) return null;
  const experiment = experiments.find(e => e.id === decision.experiment_id && e.candidate_id === candidate.id && e.business_id === candidate.business_id);
  if (!experiment || experiment.status !== "completed" || !experiment.source_artifact_id || !experiment.evidence_pack || decision.assessment.assessmentOrigin !== "owner_assessment") return null;
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
  if (!currentProductionCandidate(candidate, [decision], [choice.experiment])) throw new Error("Current source-linked owner TEST and fresh evidence are required.");
  const base = technicalCreativeApproval(candidate.business_id, candidate.id, input.maximumMicrousd,
    { concept: candidate.concept, audience: candidate.audience, designInstructions: input.designInstructions }, input.approvalId ?? randomUUID(), input.maximumGenerations ?? 2, input.generatorModel);
  const approval: CreativeApprovalSnapshot = { ...base, purpose: "candidate_production", decisionId: decision.id,
    candidateAssessment: structuredClone(decision.assessment), rightsStatement: input.rightsStatement, policyScreen: structuredClone(input.policyScreen) };
  validateCreativeApproval(approval);
  return approval;
}
