import type { JsonObject } from "../core/contracts";
import { assertJsonSchemaValue } from "../workers/schema-validator";
import { ADAPTIVE_POLICY_VERSION, evaluateAdaptiveReview, type AdaptiveScoredReview } from "./discovery-r12-adaptive-policy";
import { createHash } from "node:crypto";
import { discoveryEvidenceIdentity } from "./discovery-v2-hash";

export const ADAPTIVE_REVIEW_VERSION = "r12.adaptive-review.1" as const;
/** Textual novelty only. Source/span provenance remains independently verified;
 * mirrors, storage IDs and moved spans cannot manufacture a new observation. */
export function adaptiveEvidenceIdentity(evidence: { quote: string }): string {
  return discoveryEvidenceIdentity(evidence);
}
const text = (minLength = 10, maxLength = 300): JsonObject => ({ type: "string", minLength, maxLength });
const object = (properties: Record<string, JsonObject>): JsonObject => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const array = (items: JsonObject, maxItems: number, minItems = 0): JsonObject => ({ type: "array", items, minItems, maxItems, uniqueItems: true });
const refs = array(text(1, 120), 8);
const criteria = ["evidence", "learningValue", "testDesign", "feasibility"] as const;
const missingRequirements = ["evidence_support", "measurable_plan", "scope_feasibility", "source_permission"] as const;
const nullable = (schema: JsonObject): JsonObject => ({ anyOf: [schema, { type: "null" }] });
const planSchema = object({ hypothesis: text(20, 1200), deliverable: text(10, 1200),
  positiveCriterion: text(10, 1200), negativeCriterion: text(10, 1200), inconclusiveCriterion: text(10, 300),
  observationWindow: text(10, 200), stopRule: text(10, 1200), evidenceRefs: array(text(1, 120), 8, 1) });
const concernSchema = object({ severity: { enum: ["uncertainty", "known_failure"] },
  affectedInputRef: nullable(text(1, 120)), missingRequirement: nullable({ enum: [...missingRequirements] }),
  rationale: text(30, 400), evidenceRefs: refs });
/** Static provider grammar: actual private IDs/approved evidence remain in the
 * request body and local validation, never interpolated into cached schemas. */
export function adaptiveReviewerResponseSchema(): JsonObject {
  const schema = object({ version: { const: ADAPTIVE_REVIEW_VERSION }, proposalHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
    outcome: { enum: ["TEST", "REJECT", "NEEDS_MORE_EVIDENCE"] },
    ratings: object(Object.fromEntries(criteria.map(key => [key, object({ score: { type: "integer", minimum: 0, maximum: 2 },
      rationale: text(30, 300), evidenceRefs: refs })]))),
    proposalConcerns: array(concernSchema, 12), executionPrerequisites: array(text(10, 200), 12),
    additionalQuestions: { type: "array", items: text(15, 240), minItems: 0, maxItems: 12 }, sufficiencyRationale: text(40, 600),
    recommendedNextAction: nullable(object({ kind: { enum: ["followup", "pivot", "reasoning_review", "close"] },
      publicQuestion: text(20, 500), hypothesis: text(20, 500), expectedInformationGain: text(20, 500),
      counterevidenceQuestion: text(20, 500), gap: { enum: ["evidence", "reasoning", "hypothesis"] }, reason: text(30, 400) })),
    progress: nullable(object({ questionId: text(1, 120), priorFindingHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
      kind: { enum: ["resolved", "narrowed", "refuted", "unchanged"] }, finding: text(20, 600),
      evidenceRefs: refs, opposingInterpretation: text(30, 500) })) });
  // Omitted recommendations/progress cannot create authority or manufacture
  // progress. Preserve a valid terminal review and pause for an actionable plan.
  schema.required = (schema.required as string[]).filter(k => !["recommendedNextAction", "progress"].includes(k));
  return schema;
}
export type AdaptiveTestPlan = {
  hypothesis: string; deliverable: string; positiveCriterion: string; negativeCriterion: string;
  inconclusiveCriterion: string; observationWindow: string; stopRule: string; evidenceRefs: string[];
};
type Concern = { severity: "uncertainty" | "known_failure"; affectedInputRef: string | null;
  missingRequirement: typeof missingRequirements[number] | null; rationale: string; evidenceRefs: string[] };
export type AdaptiveReviewerResponse = {
  version: typeof ADAPTIVE_REVIEW_VERSION; proposalHash: string; outcome: "TEST" | "REJECT" | "NEEDS_MORE_EVIDENCE";
  ratings: Record<typeof criteria[number], { score: 0 | 1 | 2; rationale: string; evidenceRefs: string[] }>;
  proposalConcerns: Concern[]; executionPrerequisites: string[]; additionalQuestions: string[]; sufficiencyRationale: string;
  recommendedNextAction?: { kind: "followup" | "pivot" | "reasoning_review" | "close"; publicQuestion: string;
    hypothesis: string; expectedInformationGain: string; counterevidenceQuestion: string; gap: "evidence" | "reasoning" | "hypothesis"; reason: string } | null;
  progress?: { questionId: string; priorFindingHash: string; kind: "resolved" | "narrowed" | "refuted" | "unchanged";
    finding: string; evidenceRefs: string[]; opposingInterpretation: string } | null;
};
export type AdaptiveReviewContext = {
  /** Supplied by trusted runtime from the immutable strategist proposal. */
  proposalHash: string; proposedTest: AdaptiveTestPlan | null;
  allowedEvidenceRefs: string[]; currentInputRefs: string[];
  /** Present omissions established by trusted preparation, not reviewer assertion. */
  missingProposalRequirements: Array<typeof missingRequirements[number]>;
  inheritedQuestions: string[];
  producerModelId: string; reviewerModelId: string;
  /** Stable source/span identity hashes, never action-local E1 labels. */
  priorFindings?: Array<{ questionId: string; findingHash: string; statement: string; evidenceIdentityHashes: string[] }>;
  evidenceIdentityHashes?: Record<string, string>;
  allowReasoningProgress?: boolean;
  /** Source-validated known failures from the bound selected assessment. */
  inheritedKnownFailures?: string[];
};
const fail = (): never => { throw new Error("r12_adaptive_review_invalid"); };
export function normalizeAdaptiveReviewerResponse(raw: unknown, context: AdaptiveReviewContext) {
  assertJsonSchemaValue(adaptiveReviewerResponseSchema(), raw, "Adaptive reviewer response");
  const response = raw as AdaptiveReviewerResponse;
  if (!context || !/^[a-f0-9]{64}$/.test(context.proposalHash) || response.proposalHash !== context.proposalHash ||
      !context.producerModelId?.trim() || !context.reviewerModelId?.trim() || context.producerModelId === context.reviewerModelId ||
      !Array.isArray(context.missingProposalRequirements) || context.missingProposalRequirements.some(v => !missingRequirements.includes(v))) fail();
  for (const list of [context.allowedEvidenceRefs, context.currentInputRefs, context.inheritedQuestions]) {
    if (!Array.isArray(list) || list.some(s => typeof s !== "string" || !s.trim()) || new Set(list).size !== list.length) fail();
  }
  const allowed = new Set(context.allowedEvidenceRefs);
  const checkRefs = (values: string[]) => { if (values.some(value => !allowed.has(value))) fail(); };
  if (context.proposedTest !== null) {
    assertJsonSchemaValue(planSchema, context.proposedTest, "Adaptive proposed test");
    checkRefs(context.proposedTest.evidenceRefs);
    const p = context.proposedTest;
    if (new Set([p.positiveCriterion.trim(), p.negativeCriterion.trim(), p.inconclusiveCriterion.trim()]).size !== 3) fail();
  }
  const scores = {} as AdaptiveScoredReview["scores"], reasons = {} as AdaptiveScoredReview["reasons"];
  for (const key of criteria) {
    const rating = response.ratings[key];
    checkRefs(rating.evidenceRefs);
    if (key === "evidence" && rating.score > 0 && rating.evidenceRefs.length === 0) fail();
    scores[key] = rating.score; reasons[key] = rating.rationale;
  }
  for (const concern of response.proposalConcerns) {
    checkRefs(concern.evidenceRefs);
    if ((concern.affectedInputRef === null) === (concern.missingRequirement === null)) fail();
    if (concern.affectedInputRef !== null && !context.currentInputRefs.includes(concern.affectedInputRef)) fail();
    if (concern.missingRequirement !== null && !context.missingProposalRequirements.includes(concern.missingRequirement)) fail();
    if (concern.severity === "known_failure" && (concern.affectedInputRef === null || concern.evidenceRefs.length === 0)) fail();
  }
  const canonicalQuestion = (question: string) => question.trim().replace(/\s+/g, " ").toLowerCase();
  const inherited = new Set(context.inheritedQuestions.map(canonicalQuestion));
  const seenQuestions = new Set(inherited);
  const additionalQuestions = response.additionalQuestions.filter(question => {
    const key = canonicalQuestion(question);
    if (seenQuestions.has(key)) return false;
    seenQuestions.add(key); return true;
  });
  const result = evaluateAdaptiveReview({ version: ADAPTIVE_POLICY_VERSION, scores, reasons,
    evidenceRefs: response.ratings.evidence.evidenceRefs,
    proposalBlockers: [...response.proposalConcerns.filter(c => c.severity === "uncertainty").map(c => c.rationale),
      ...context.missingProposalRequirements, ...(context.proposedTest === null ? ["No bounded experiment was proposed"] : [])],
    knownHardFailures: [...response.proposalConcerns.filter(c => c.severity === "known_failure").map(c => c.rationale), ...context.inheritedKnownFailures ?? []],
    executionPrerequisites: response.executionPrerequisites });
  // Preserve semantic disagreement as evidence, not a paid format failure or
  // invitation to poll until the reviewer agrees. Never manufacture TEST.
  const outcome = response.outcome === "NEEDS_MORE_EVIDENCE" ? "NEEDS_MORE_EVIDENCE" :
    response.outcome === "REJECT" ? result.outcome === "REJECT" ? "REJECT" : "NEEDS_MORE_EVIDENCE" : result.outcome;
  const disagreements = response.outcome === result.outcome ? [] :
    [response.outcome === "TEST" ? "model_test_not_supported" : response.outcome === "REJECT" ? "model_reject_not_supported" : "reviewer_declined_test_or_rejection"];
  let progress = null;
  if (response.progress) {
    const p = response.progress, previous = context.priorFindings?.find(f => f.questionId === p.questionId && f.findingHash === p.priorFindingHash);
    if (!previous) fail();
    checkRefs(p.evidenceRefs);
    const identities = p.evidenceRefs.map(ref => context.evidenceIdentityHashes?.[ref]);
    if (identities.some(identity => !identity || !/^[a-f0-9]{64}$/.test(identity))) fail();
    const changed = canonicalQuestion(previous!.statement) !== canonicalQuestion(p.finding);
    const newEvidence = identities.some(identity => !previous!.evidenceIdentityHashes.includes(identity!));
    const meaningful = p.kind !== "unchanged" && changed && p.evidenceRefs.length > 0 && (newEvidence || context.allowReasoningProgress === true);
    progress = { kind: meaningful ? p.kind : "unchanged" as const, questionId: p.questionId,
      beforeFindingHash: p.priorFindingHash,
      afterFindingHash: meaningful ? createHash("sha256").update(JSON.stringify({ finding: p.finding, evidenceIdentityHashes: [...identities].sort() })).digest("hex") : p.priorFindingHash,
      supportingRefs: [...p.evidenceRefs], explanation: p.opposingInterpretation, newEvidence,
      reasoningOnly: meaningful && !newEvidence };
  }
  return { ...structuredClone(response), outcome, modelOutcome: response.outcome, rubricOutcome: result.outcome,
    rawResponse: structuredClone(response), disagreements, additionalQuestions,
    recommendedNextAction: structuredClone(response.recommendedNextAction ?? null), progress,
    nextActionStatus: response.recommendedNextAction ? "requires_scope_and_atomic_admission" : "pause_no_reviewed_action",
    redundantQuestionCount: response.additionalQuestions.length - additionalQuestions.length,
    total: result.total, thresholdCalibrated: false,
    testPlan: outcome === "TEST" ? structuredClone(context.proposedTest) : null,
    inheritedQuestions: [...context.inheritedQuestions], executionAuthorized: false };
}

export const ADAPTIVE_REVIEW_INSTRUCTIONS = "Judge this exact bounded learning proposal, not commercial readiness. Score each criterion 0–2 with attributable evidence and concrete reasons; 6/8 is provisional, not probability. TEST needs every score at least 1, test design 2, the supplied measurable plan and no material proposal blocker. Cite only supplied evidence IDs. A proposal concern must identify an actual supplied input or a supplied current proposal omission; future artwork, blanket commercial clearance, profit proof and pending execution approval alone are not such concerns. Retain later execution prerequisites. Known input failures need cited evidence. Do not invent a replacement experiment or poll for a preferred verdict. Additional questions must be genuinely new; Core preserves inherited questions. When the outcome is NEEDS_MORE_EVIDENCE, choose a useful next scoped public question and opposing check from the actual unresolved questions. Return recommendedNextAction for a followup, pivot or targeted reasoning review when it can address that named gap; retain the original product, markets, permitted sources and privacy boundary. If no feasible permitted action can help, return recommendedNextAction:null and explain why in sufficiencyRationale. Do not omit a useful next investigation merely because the current evidence is insufficient; close means close this research window, never complete the owner Goal. Never recommend a repair just because the outcome is negative. Provide progress only against an exact supplied prior finding hash/question, cite changed evidence and discuss the opposing interpretation; redundant retrieval or paraphrase is unchanged. Missing next action or progress remains schema-valid. Core may request one bounded diagnostic reconsideration of an omitted next action; this is for choosing an investigation, never for obtaining TEST. Do not fabricate progress or recommend repeating unchanged retrieval. No result grants spending, creative, publication or commerce authority.";
