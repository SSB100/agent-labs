import { creativeHash } from "./contracts";
import type { JsonObject } from "../core/contracts";
import type { CreativeApprovalSnapshot } from "./types";

/** Lossless prompt view only. The original approval/hash and full context remain immutable. */
export function creativePromptApproval(approval: CreativeApprovalSnapshot): JsonObject {
  if (approval.focusedPilotBinding) {
    const { pinnedLearningPlan: plan, originalDesignConstraints, executionConstraints } = approval.focusedPilotBinding;
    // Role/task context carries the complete stored approval; only this explicit
    // model view excludes unrelated research verdicts, receipts and financial pins.
    // Existing worker logic adds the exact brief and actual pixels for review.
    return {
      approvalId: approval.approvalId, approvalHash: creativeHash(approval), purpose: approval.purpose,
      concept: approval.concept, audience: approval.audience, designInstructions: approval.designInstructions,
      originalDesign: approval.originalDesign, rightsStatement: approval.rightsStatement, rightsConfirmed: approval.rightsConfirmed,
      policyScreen: structuredClone(approval.policyScreen), printSpecification: structuredClone(approval.printSpecification),
      maximumGenerations: approval.maximumGenerations, publicationAllowed: false,
      learningPlan: { scope: plan.scope, name: plan.name, hypothesis: plan.hypothesis, deliverable: plan.deliverable,
        successCriteria: [...plan.successCriteria], failureCriteria: [...plan.failureCriteria], stopRule: plan.stopRule, maximumGenerations: plan.maximumGenerations },
      originalDesignConstraints: structuredClone(originalDesignConstraints), executionConstraints: structuredClone(executionConstraints),
      interpretation: "Execute only the approved private original-design learning phase. Preserve every learning criterion, originality exclusion and unresolved execution constraint. A visual pass does not establish demand, profitability, legal clearance or permission to publish.",
    } as unknown as JsonObject;
  }
  // Validation permits extra screen metadata; never remove a possible owner restriction.
  if (approval.policyScreen.some(screen => Object.keys(screen).some(key => !["category", "status", "rationale", "sourceUrls"].includes(key)))) return approval as unknown as JsonObject;
  const groups: { categories: string[]; status: string; rationale: string; sourceUrls: string[] }[] = [];
  let previousKey: string | null = null;
  for (const screen of approval.policyScreen) {
    const key = JSON.stringify([screen.status, screen.rationale, screen.sourceUrls]);
    if (key === previousKey) groups[groups.length - 1].categories.push(screen.category);
    else groups.push({ categories: [screen.category], status: screen.status, rationale: screen.rationale, sourceUrls: [...screen.sourceUrls] });
    previousKey = key;
  }
  if (groups.length === approval.policyScreen.length) return approval as unknown as JsonObject;
  return { ...approval, policyScreen: groups,
    policyScreenEncoding: "Identical checks are grouped: each listed category has exactly the stated status, rationale and source URLs. The supplied approvalHash binds the original ungrouped approval; copy it exactly." } as unknown as JsonObject;
}
