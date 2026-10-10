import { createHash } from "node:crypto";
/** Pure proposal policy. SQL/runtime must supply authenticated, pinned snapshots.
 * Nothing here grants authority, schedules work, or changes historical decisions. */
export const ADAPTIVE_POLICY_VERSION = "r12.adaptive-policy.1" as const;
export const ADAPTIVE_RUN_MICROUSD = 10_000_000;
export const ADAPTIVE_EXTRA_ACTIONS = 10;
export type AdaptiveActionKind = "followup" | "repair" | "pivot" | "reasoning_review";
export type AdaptivePhase = "plan" | "search" | "select" | "strategy" | "review";
type Score = 0 | 1 | 2;
export type AdaptiveScoredReview = {
  version: typeof ADAPTIVE_POLICY_VERSION;
  scores: { evidence: Score; learningValue: Score; testDesign: Score; feasibility: Score };
  reasons: { evidence: string; learningValue: string; testDesign: string; feasibility: string };
  evidenceRefs: string[];
  proposalBlockers: string[];
  knownHardFailures: string[];
  /** Later permissions are recorded, never silently treated as current clearance. */
  executionPrerequisites: string[];
};
const fail = (): never => { throw new Error("r12_adaptive_policy_invalid"); };
const natural = (n: number) => Number.isSafeInteger(n) && n >= 0;
const texts = (v: string[]) => Array.isArray(v) && v.every(s => typeof s === "string" && s.trim().length > 0);
export function evaluateAdaptiveReview(review: AdaptiveScoredReview) {
  const keys = ["evidence", "learningValue", "testDesign", "feasibility"] as const;
  if (!review || review.version !== ADAPTIVE_POLICY_VERSION || !review.scores || !review.reasons ||
      keys.some(k => ![0, 1, 2].includes(review.scores[k]) || typeof review.reasons[k] !== "string" || !review.reasons[k].trim()) ||
      !texts(review.evidenceRefs) || !texts(review.proposalBlockers) || !texts(review.knownHardFailures) || !texts(review.executionPrerequisites)) fail();
  if (review.scores.evidence > 0 && review.evidenceRefs.length === 0) fail();
  const total = keys.reduce((sum, key) => sum + review.scores[key], 0);
  const outcome = review.knownHardFailures.length ? "REJECT" : review.proposalBlockers.length ||
    total < 6 || keys.some(k => review.scores[k] === 0) || review.scores.testDesign !== 2 ? "NEEDS_MORE_EVIDENCE" : "TEST";
  return { version: ADAPTIVE_POLICY_VERSION, outcome, total, maximum: 8, thresholdCalibrated: false,
    executionAuthorized: false } as const;
}

export type AdaptiveProgress = {
  kind: "resolved" | "narrowed" | "refuted" | "redundant" | "unusable" | "unchanged";
  questionId: string;
  beforeFindingHash: string;
  afterFindingHash: string;
  /** Exact immutable evidence or reasoning-review references, not retrieval timestamps. */
  supportingRefs: string[];
  explanation: string;
};
export function adaptiveProgressCounts(progress: AdaptiveProgress): boolean {
  if (!progress || !["resolved", "narrowed", "refuted", "redundant", "unusable", "unchanged"].includes(progress.kind) ||
      !progress.questionId?.trim() || !progress.explanation?.trim() || !texts(progress.supportingRefs) ||
      !/^[a-f0-9]{64}$/.test(progress.beforeFindingHash) || !/^[a-f0-9]{64}$/.test(progress.afterFindingHash)) fail();
  return ["resolved", "narrowed", "refuted"].includes(progress.kind) && progress.supportingRefs.length > 0 &&
    progress.beforeFindingHash !== progress.afterFindingHash;
}

export type AdaptiveCapacity = {
  extraActionsUsed: number;
  childrenUsed: number;
  dispatchesUsed: number;
  /** Verified capability slots created for this new adaptive run only. Old
   * predecessor slots are not reusable authority or counted here. */
  createdPhaseSlots: AdaptivePhase[];
  runCommittedMicrousd: number;
  /** Available amount after all known, pending and reserved exposure; ledgers overlap. */
  rootHeadroomMicrousd: number;
  businessHeadroomMicrousd: number;
  hasUnknownLiability: boolean;
  authorityActive: boolean;
  expired: boolean;
};
export type AdaptiveActionProposal = {
  kind: AdaptiveActionKind;
  calls: Array<{ phase: AdaptivePhase; maximumMicrousd: number }>;
  /** Additional paid calls needed to obtain an independently reviewed conclusion.
   * These are reserved capacity, not already dispatched or extra high-level actions. */
  downstreamCalls: Array<{ phase: AdaptivePhase; maximumMicrousd: number }>;
};
export function admitAdaptiveAction(capacity: AdaptiveCapacity, action: AdaptiveActionProposal) {
  if (!capacity || !action || !["followup", "repair", "pivot", "reasoning_review"].includes(action.kind) ||
      ![capacity.extraActionsUsed, capacity.childrenUsed, capacity.dispatchesUsed, capacity.runCommittedMicrousd,
        capacity.rootHeadroomMicrousd, capacity.businessHeadroomMicrousd].every(natural) ||
      ![capacity.hasUnknownLiability, capacity.authorityActive, capacity.expired].every(v => typeof v === "boolean") ||
      !Array.isArray(capacity.createdPhaseSlots) || new Set(capacity.createdPhaseSlots).size !== capacity.createdPhaseSlots.length ||
      capacity.createdPhaseSlots.some(phase => !["plan", "search", "select", "strategy", "review"].includes(phase)) ||
      capacity.createdPhaseSlots.length > capacity.childrenUsed ||
      !Array.isArray(action.calls) || !Array.isArray(action.downstreamCalls) || action.calls.length === 0) fail();
  const calls = [...action.calls, ...action.downstreamCalls];
  if (calls.length > 64 || calls.some(call => !call || !["plan", "search", "select", "strategy", "review"].includes(call.phase) ||
      !natural(call.maximumMicrousd) || call.maximumMicrousd === 0)) fail();
  const quoted = calls.reduce((sum, call) => sum + BigInt(call.maximumMicrousd), BigInt(0));
  const remainingChildren = Math.max(0, 32 - capacity.childrenUsed);
  const remainingDispatches = Math.max(0, 64 - capacity.dispatchesUsed);
  const newPhaseSlots = [...new Set(calls.map(call => call.phase))].filter(phase => !capacity.createdPhaseSlots.includes(phase));
  const reason = !capacity.authorityActive ? "authority_required" : capacity.expired ? "expired" :
    capacity.hasUnknownLiability ? "unknown_liability" : capacity.extraActionsUsed >= ADAPTIVE_EXTRA_ACTIONS ? "action_limit" :
    calls.at(-1)?.phase !== "review" ? "downstream_review_required" :
    newPhaseSlots.length > remainingChildren ? "child_capacity" : calls.length > remainingDispatches ? "dispatch_capacity" :
    BigInt(capacity.runCommittedMicrousd) + quoted > BigInt(ADAPTIVE_RUN_MICROUSD) ? "run_budget" :
    quoted > BigInt(capacity.rootHeadroomMicrousd) ? "root_budget" :
    quoted > BigInt(capacity.businessHeadroomMicrousd) ? "business_budget" : "fits";
  return { decision: reason === "fits" ? "eligible_for_atomic_admission" : "pause", reason,
    remainingExtraActions: Math.max(0, ADAPTIVE_EXTRA_ACTIONS - capacity.extraActionsUsed),
    remainingChildren, remainingDispatches, newPhaseSlots, requiredNewChildren: newPhaseSlots.length, paidCalls: action.calls.length,
    reservedDownstreamCalls: action.downstreamCalls.length, quotedMicrousd: quoted.toString(),
    authorityCreated: false } as const;
}

export function decideAdaptiveContinuation(input: {
  consecutiveNonprogress: number; progress: AdaptiveProgress;
  gap: "evidence" | "reasoning" | "hypothesis" | "unknown";
  reasoningEscalationUsed: boolean; feasibleAuthorizedAction: boolean; evidenceWait: boolean;
}) {
  if (!natural(input.consecutiveNonprogress) || !["evidence", "reasoning", "hypothesis", "unknown"].includes(input.gap) ||
      ![input.reasoningEscalationUsed, input.feasibleAuthorizedAction, input.evidenceWait].every(v => typeof v === "boolean")) fail();
  const streak = adaptiveProgressCounts(input.progress) ? 0 : input.consecutiveNonprogress + 1;
  if (!natural(streak)) fail();
  const next = !input.feasibleAuthorizedAction ? "pause_no_authorized_action" : input.evidenceWait ? "wait_for_evidence" :
    streak < 2 ? "continue_targeted" : input.gap === "evidence" ? "target_evidence_gap" :
    input.gap === "reasoning" && !input.reasoningEscalationUsed ? "bounded_reasoning_review" :
    input.gap === "hypothesis" ? "consider_pivot" : "diagnose_without_paid_retry";
  return { next, consecutiveNonprogress: streak, goalCompleted: false, authorityCreated: false } as const;
}

export type AdaptiveMissingRecommendationInput = {
  scopeId:string; originReviewHash:string;
  /** The independently normalized review and its immutable raw response. */
  review:{outcome:string; rawResponse:Record<string,unknown>; inheritedQuestions:string[]; additionalQuestions:string[]};
  usedGapHashes:string[];
  capacity:AdaptiveCapacity;
  phaseCeilings:Pick<Record<AdaptivePhase,number>,'strategy'|'review'>;
};
/** One diagnostic selection of the next investigation, never a fabricated model
 * recommendation or positive verdict. SQL must claim (scopeId,gapHash) once and
 * reserve both calls atomically using the original shared counters and budget. */
export function proposeMissingRecommendationDiagnostic(input:AdaptiveMissingRecommendationInput){
  if(!input||! /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.scopeId)||
    ! /^[a-f0-9]{64}$/.test(input.originReviewHash)||!Array.isArray(input.usedGapHashes)||input.usedGapHashes.length>10||input.usedGapHashes.some(h=>! /^[a-f0-9]{64}$/.test(h))||
    !input.review||!input.review.rawResponse||typeof input.review.rawResponse!=='object'||Array.isArray(input.review.rawResponse)||
    !Array.isArray(input.review.inheritedQuestions)||!Array.isArray(input.review.additionalQuestions))fail();
  const rawQuestions=[...input.review.inheritedQuestions,...input.review.additionalQuestions];
  if(rawQuestions.length>150||rawQuestions.some(q=>typeof q!=='string'||q.length>600))fail();
  const questions=[...new Set(rawQuestions.map(q=>q.replace(/[ \t\r\n]+/g,' ').replace(/^ +| +$/g,'').replace(/[A-Z]/g,c=>c.toLowerCase())).filter(q=>q.length>=10))].sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)));
  const gapHash=createHash('sha256').update(`r12.missing-recommendation.1\n${input.scopeId}\n${questions.join('\n')}`,'utf8').digest('hex');
  const reason=input.review.outcome!=='NEEDS_MORE_EVIDENCE'?'not_nme':Object.hasOwn(input.review.rawResponse,'recommendedNextAction')?'explicit_next_action_or_pause':!questions.length?'no_saved_actionable_questions':input.usedGapHashes.includes(gapHash)?'diagnostic_already_used':null;
  if(reason)return{decision:'no_diagnostic' as const,reason,gapHash,originReviewHash:input.originReviewHash,authorityCreated:false as const};
  const admission=admitAdaptiveAction(input.capacity,{kind:'reasoning_review',calls:[{phase:'strategy',maximumMicrousd:input.phaseCeilings.strategy}],downstreamCalls:[{phase:'review',maximumMicrousd:input.phaseCeilings.review}]});
  return{decision:admission.decision==='eligible_for_atomic_admission'?'requires_atomic_admission' as const:'pause' as const,reason:admission.reason,
    gapHash,originReviewHash:input.originReviewHash,kind:'reasoning_review' as const,phases:['strategy','review'] as const,
    questions,extraActionIncrement:1,progressCounts:false as const,admission,authorityCreated:false as const};
}
