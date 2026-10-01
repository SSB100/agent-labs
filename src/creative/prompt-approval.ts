import type { JsonObject } from "../core/contracts";
import type { CreativeApprovalSnapshot } from "./types";

/** Lossless prompt view only. The original approval/hash and full context remain immutable. */
export function creativePromptApproval(approval: CreativeApprovalSnapshot): JsonObject {
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
