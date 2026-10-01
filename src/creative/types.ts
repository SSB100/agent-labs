import type { ReviewerDecisionV2 } from "../products/discovery-v2";
import type { CandidateAssessment } from "../products/types";

export const CREATIVE_VERSION = "creative-pipeline-1.0";
export const SAFE_REPAIR_INSTRUCTIONS = [
  "Restore the exact approved composition using only the approved subjects and background. Remove unrequested elements; add no new subjects, names, text or references.",
  "Improve contrast and spacing using only the approved palette and existing approved subjects. Preserve the exact concept and background; add no new content or references.",
  "Remove all unrequested text, logos, recognizable protected elements and extra subjects. Re-render only the exact approved original brief, without references or new content.",
  "Simplify fine details and strengthen edges of the existing approved subjects for the specified print size. Preserve the approved palette and composition; add no new content.",
  "Re-render the exact approved original brief and physical print requirements. Preserve its approved subjects, palette and background; introduce no new text, names or references.",
] as const;
export const MAX_CREATIVE_PNG_BYTES = 7_000_000;
export const SCREEN_CATEGORIES = ["brand_names", "trademarks", "copyrighted_characters", "sports_teams", "logos", "celebrity_likeness", "copied_artwork", "marketplace_policy"] as const;
export type ScreenCategory = typeof SCREEN_CATEGORIES[number];
export type PolicyScreen = { category: ScreenCategory; status: "clear" | "concern" | "unknown"; rationale: string; sourceUrls: string[] };
export type PrintSpecification = {
  provider: "printful"; product: string; garment: string; placement: string;
  sourceUrl: string; sourceExcerpt: string; verifiedAt: string;
  maximumWidthInches: number; maximumHeightInches: number;
  designWidthInches: number; designHeightInches: number; minimumDpi: number;
  colorSpace: "srgb"; background: "transparent" | "opaque"; maximumBytes: number;
};
/** Technical qualifications do not replace a Product Candidate decision. */
export type CreativeGenerationLimit = 1 | 2;
export type CreativePurpose = "candidate_production" | "technical_qualification" | "simulation";
export type CreativeApprovalSnapshot = {
  approvalId: string; businessId: string; candidateId: string; decisionId: string | null;
  purpose: CreativePurpose; concept: string; audience: string; designInstructions: string;
  candidateAssessment: CandidateAssessment | ReviewerDecisionV2 | null;
  originalDesign: boolean; rightsStatement: string; rightsConfirmed: boolean;
  policyScreen: PolicyScreen[]; printSpecification: PrintSpecification;
  approvedBy: "owner"; approvedAt: string; expiresAt: string;
  maximumMicrousd: number; maximumGenerations: CreativeGenerationLimit; publicationAllowed: false;
};
export type DesignBrief = {
  version: "1.0"; approvalId: string; audience: string; concept: string; style: string;
  hierarchy: string; typography: string; placement: string; garmentCompatibility: string;
  colors: string[]; forbiddenElements: string[]; originalityRequirements: string;
  imagePrompt: string;
};
export const REVIEW_CRITERIA = ["brief_alignment", "print_constraints", "originality_policy", "target_audience", "visual_clarity"] as const;
export type ReviewCriterion = typeof REVIEW_CRITERIA[number];
export type DesignReview = {
  version: "1.0"; assetHash: string; briefHash: string;
  checks: { criterion: ReviewCriterion; outcome: "PASS" | "FAIL"; rationale: string }[];
  outcome: "PASS" | "FAIL"; repairInstruction: string | null;
};
export type BriefScreen = {
  version: "1.0"; briefHash: string; approvalHash: string;
  checks: { category: ScreenCategory; status: "clear" | "concern" | "unknown"; rationale: string }[];
  outcome: "PASS" | "NEEDS_OWNER";
};
export type AssetInspection = {
  sha256: string; mediaType: "image/png"; bytes: number; width: number; height: number;
  colorSpace: string; hasAlpha: boolean; transparentPixelFraction: number;
  effectiveDpi: number; failedCriteria: string[];
};
export type CreativeNextStep = "complete" | "repair" | "needs_owner";
