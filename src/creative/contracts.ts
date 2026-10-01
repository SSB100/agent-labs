import { createHash } from "node:crypto";
import { REVIEWER_DECISION_V2_SCHEMA } from "../products/discovery-v2-worker-contract";
import { REVIEW_CHECKS_V2, DISCOVERY_V2, DISCOVERY_V2_MODELS, type ReviewerDecisionV2 } from "../products/discovery-v2";
import { assertJsonSchemaValue } from "../workers/schema-validator";
import { DIMENSIONS } from "../products/types";
import { MAX_CREATIVE_PNG_BYTES, REVIEW_CRITERIA, SAFE_REPAIR_INSTRUCTIONS, SCREEN_CATEGORIES, type AssetInspection, type BriefScreen, type CreativeApprovalSnapshot, type CreativeGenerationLimit, type CreativeNextStep, type DesignBrief, type DesignReview, type PrintSpecification } from "./types";

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, min = 3, max = 1000): v is string => typeof v === "string" && v.trim().length >= min && v.length <= max;
const hashPattern = /^[a-f0-9]{64}$/;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function creativeHash(value: unknown): string {
  function canonical(v: unknown): string {
    if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
    if (record(v)) return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
    return JSON.stringify(v);
  }
  return createHash("sha256").update(canonical(value)).digest("hex");
}
function publicUrl(value: unknown, printfulOnly = false): boolean {
  if (typeof value !== "string" || value.length > 1500) return false;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.port && !url.hash &&
    (printfulOnly ? ["www.printful.com", "printful.com", "help.printful.com"].includes(url.hostname) : /^[a-z][a-z0-9.-]+\.[a-z]{2,}$/.test(url.hostname)); }
  catch { return false; }
}
export function validatePrintSpecification(spec: PrintSpecification, now = Date.now()): void {
  if (!record(spec) || spec.provider !== "printful" || !text(spec.product) || !text(spec.garment) || !text(spec.placement) ||
    !publicUrl(spec.sourceUrl, true) || !text(spec.sourceExcerpt, 30, 1500) || !Number.isFinite(Date.parse(spec.verifiedAt)) ||
    Date.parse(spec.verifiedAt) > now + 300000 || now - Date.parse(spec.verifiedAt) > 30 * 86400000 ||
    spec.colorSpace !== "srgb" || !["transparent", "opaque"].includes(spec.background) ||
    !Number.isInteger(spec.maximumBytes) || spec.maximumBytes < 1024 || spec.maximumBytes > MAX_CREATIVE_PNG_BYTES) throw new Error("A fresh, source-backed Printful specification is required.");
  for (const field of ["maximumWidthInches", "maximumHeightInches", "designWidthInches", "designHeightInches"] as const) {
    if (!Number.isFinite(spec[field]) || spec[field] <= 0 || spec[field] > 24) throw new Error("Invalid physical print size.");
  }
  if (spec.designWidthInches > spec.maximumWidthInches || spec.designHeightInches > spec.maximumHeightInches || !Number.isFinite(spec.minimumDpi) || spec.minimumDpi < 150 || spec.minimumDpi > 300) throw new Error("Design placement exceeds verified print constraints.");
}
/** Snapshot preflight only; the owner/runtime RPC revalidates persisted dossier and provider lineage. */
export function isReviewedDiscoveryTest(value:unknown,candidateId:string):value is ReviewerDecisionV2{
  try{assertJsonSchemaValue(REVIEWER_DECISION_V2_SCHEMA,value,"Reviewed discovery decision");}catch{return false;}
  const review=value as ReviewerDecisionV2;
  return review.version===DISCOVERY_V2&&review.outcome==="TEST"&&review.candidateId===candidateId&&review.marketCountryCode!==null&&
    review.execution.modelId===DISCOVERY_V2_MODELS.reviewer&&review.execution.primaryOnly===true&&!/(mock|fixture|simulation)/i.test(review.execution.providerRequestId)&&
    review.dimensions.length===DIMENSIONS.length&&DIMENSIONS.every(d=>review.dimensions.filter(item=>item.dimension===d).length===1)&&
    review.dimensions.every(d=>!["blocking","known_failure"].includes(d.verdict))&&review.additionalUncertainties.every(u=>!u.blockingForTest)&&
    REVIEW_CHECKS_V2.every(check=>review.checks.filter(item=>item.check===check&&item.outcome==="PASS").length===1);
}
export function validateCreativeApproval(approval: CreativeApprovalSnapshot, now = Date.now()): void {
  if (!record(approval) || ![approval.approvalId, approval.businessId, approval.candidateId].every(id => uuidPattern.test(id)) ||
    !["candidate_production", "technical_qualification", "simulation"].includes(approval.purpose) || !text(approval.concept, 3, 160) || !text(approval.audience, 3, 160) || !text(approval.designInstructions, 50, 1500) ||
    approval.originalDesign !== true || approval.rightsConfirmed !== true || !text(approval.rightsStatement, 30, 1500) || approval.approvedBy !== "owner" ||
    approval.publicationAllowed !== false || ![1, 2].includes(approval.maximumGenerations) || !Number.isInteger(approval.maximumMicrousd) || approval.maximumMicrousd < 0 || approval.maximumMicrousd > 2_000_000 ||
    !Number.isFinite(Date.parse(approval.approvedAt)) || !Number.isFinite(Date.parse(approval.expiresAt)) || Date.parse(approval.approvedAt) > now + 300000 ||
    Date.parse(approval.expiresAt) <= now || Date.parse(approval.expiresAt) > Date.parse(approval.approvedAt) + 7 * 86400000) throw new Error("Explicit, unexpired creative approval is required.");
  if (approval.purpose === "simulation" && approval.maximumMicrousd !== 0) throw new Error("Simulation cannot authorize provider spending.");
  if (approval.purpose === "candidate_production") {
    const d = approval.candidateAssessment;
    if (!approval.decisionId || !uuidPattern.test(approval.decisionId) || !d || d.outcome !== "TEST") throw new Error("Creative production requires a current evidence-backed TEST decision.");
    if("version" in d){
      if(!isReviewedDiscoveryTest(d,approval.candidateId))throw new Error("The v2 candidate needs its current independent, nonblocking reviewed TEST.");
    }else if(d.assessmentOrigin !== "owner_assessment" || d.missingEvidence.length !== 0 || d.totalScore === null || d.totalScore < 65 || d.dimensions.length !== DIMENSIONS.length ||
      DIMENSIONS.some(key => !d.dimensions.some(item => item.dimension === key && item.score !== null && item.evidenceIds.length > 0))) throw new Error("Creative production requires a separate evidence-backed TEST decision; unknown market evidence cannot be waived by this approval.");
  }
  if (!Array.isArray(approval.policyScreen) || approval.policyScreen.length !== SCREEN_CATEGORIES.length ||
    SCREEN_CATEGORIES.some(category => approval.policyScreen.filter(s => s.category === category).length !== 1) ||
    approval.policyScreen.some(s => s.status !== "clear" || !text(s.rationale, 15, 800) || !Array.isArray(s.sourceUrls) || s.sourceUrls.length < 1 || s.sourceUrls.length > 4 || s.sourceUrls.some(url => !publicUrl(url)))) throw new Error("All eight concept-specific IP/policy screens must be clear with source references; uncertainty needs owner review.");
  validatePrintSpecification(approval.printSpecification, now);
}
export function validateDesignBrief(brief: DesignBrief, approval: CreativeApprovalSnapshot): void {
  if (!record(brief) || Object.keys(brief).sort().join(",") !== "approvalId,audience,colors,concept,forbiddenElements,garmentCompatibility,hierarchy,imagePrompt,originalityRequirements,placement,style,typography,version" ||
    brief.version !== "1.0" || brief.approvalId !== approval.approvalId || brief.audience !== approval.audience || brief.concept !== approval.concept ||
    brief.placement !== approval.printSpecification.placement || brief.garmentCompatibility !== approval.printSpecification.garment ||
    ![brief.style, brief.hierarchy, brief.typography, brief.originalityRequirements].every(value => text(value, 10, 600)) ||
    !text(brief.imagePrompt, 50, 3500) || Buffer.byteLength(brief.imagePrompt, "utf8") > 6000 ||
    !Array.isArray(brief.colors) || brief.colors.length < 1 || brief.colors.length > 6 || brief.colors.some(c => !/^#[a-f0-9]{6}$/i.test(c)) ||
    !Array.isArray(brief.forbiddenElements) || brief.forbiddenElements.length < 3 || brief.forbiddenElements.length > 16 || brief.forbiddenElements.some(v => !text(v, 3, 120))) throw new Error("Creative Director output does not match its approved brief contract.");
}
export function validateDesignReview(review: DesignReview, assetHash: string, briefHash: string): void {
  if (!record(review) || Object.keys(review).sort().join(",") !== "assetHash,briefHash,checks,outcome,repairInstruction,version" || review.version !== "1.0" ||
    !hashPattern.test(assetHash) || !hashPattern.test(briefHash) || review.assetHash !== assetHash || review.briefHash !== briefHash ||
    !Array.isArray(review.checks) || review.checks.length !== REVIEW_CRITERIA.length || REVIEW_CRITERIA.some(c => review.checks.filter(check => check.criterion === c).length !== 1) ||
    review.checks.some(c => !["PASS", "FAIL"].includes(c.outcome) || !text(c.rationale, 15, 700))) throw new Error("Review must inspect and cite this exact asset and brief.");
  const passed = review.checks.every(c => c.outcome === "PASS");
  if (review.outcome !== (passed ? "PASS" : "FAIL") || (passed ? review.repairInstruction !== null : !SAFE_REPAIR_INSTRUCTIONS.includes(review.repairInstruction as typeof SAFE_REPAIR_INSTRUCTIONS[number]))) throw new Error("Failed review needs one precise bounded repair; PASS requires every criterion.");
}
export function validateBriefScreen(screen: BriefScreen, brief: DesignBrief, approval: CreativeApprovalSnapshot): void {
  if (!record(screen) || Object.keys(screen).sort().join(",") !== "approvalHash,briefHash,checks,outcome,version" || screen.version !== "1.0" ||
    screen.briefHash !== creativeHash(brief) || screen.approvalHash !== creativeHash(approval) || !Array.isArray(screen.checks) || screen.checks.length !== SCREEN_CATEGORIES.length ||
    SCREEN_CATEGORIES.some(category => screen.checks.filter(check => check.category === category).length !== 1) ||
    screen.checks.some(check => !["clear", "concern", "unknown"].includes(check.status) || !text(check.rationale, 15, 700)) ||
    screen.outcome !== (screen.checks.every(check => check.status === "clear") ? "PASS" : "NEEDS_OWNER")) throw new Error("Final brief must pass an independent, hash-bound IP/policy screen before generation.");
}
export function creativeNextStep(review: DesignReview, inspection: AssetInspection, generation: number, maximumGenerations: CreativeGenerationLimit = 2): CreativeNextStep {
  if (![1, 2].includes(maximumGenerations) || ![1, 2].includes(generation) || generation > maximumGenerations) throw new Error("Creative generation limit exceeded.");
  validateDesignReview(review, inspection.sha256, review.briefHash);
  if (review.outcome === "PASS" && inspection.failedCriteria.length === 0) return "complete";
  // Technical binary failures cannot be overridden by a model PASS.
  return generation < maximumGenerations && review.outcome === "FAIL" ? "repair" : "needs_owner";
}
export function productionReady(approval: CreativeApprovalSnapshot, review: DesignReview, inspection: AssetInspection): boolean {
  return approval.purpose === "candidate_production" && creativeNextStep(review, inspection, 1, approval.maximumGenerations) === "complete";
}
