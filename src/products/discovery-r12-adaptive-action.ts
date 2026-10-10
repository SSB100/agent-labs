import { ADAPTIVE_ETSY_PHASES } from "./discovery-r12-adaptive-quote";
import { containsCredentialLikeValue } from "../core/quest-intake";
import { discoveryV2Hash } from "./discovery-v2";
import { admitAdaptiveAction, type AdaptiveActionKind, type AdaptiveCapacity, type AdaptivePhase } from "./discovery-r12-adaptive-policy";
import { validateAdaptiveResearchPreview, type AdaptiveResearchPreview } from "./discovery-r12-adaptive-scope";

/** Immutable intent for one action, not a dispatch permission. Every phase has
 * its own attempt, wire, reservation and receipt under the activated run. */
export type AdaptiveResearchAction = {
  version: "r12.adaptive-action.1" | "r12.adaptive-action.2";
  scopeId: string; scopeHash: string; ordinal: number;
  kind: "initial" | AdaptiveActionKind;
  previousActionHash: string | null; previousReviewHash: string;
  question: string; hypothesis: string; expectedInformationGain: string; counterevidenceQuestion: string;
  phases: AdaptivePhase[];
  repair: null | { failedAttemptId: string; failureHash: string; defect: "schema" | "format" | "identified_reasoning" };
};
export type AdaptiveActionContext = {
  /** Trusted SQL reconstruction; callers cannot assert receipt settlement. */
  preview: AdaptiveResearchPreview; scopeId: string; scopeHash: string;
  nextOrdinal: number; previousActionHash: string | null; previousReviewHash: string;
  previousActionClosed: boolean; ownerStopped: boolean;
  capacity: AdaptiveCapacity;
  phaseCeilings: Record<"plan" | "strategy" | "review", number> & Partial<Record<"search" | "select", number>>;
  repairableFailure: null | { attemptId: string; failureHash: string; phase: AdaptivePhase; defect: "schema" | "format" | "identified_reasoning" };
};
const legacyPhaseOrder: AdaptivePhase[] = ["plan", "search", "select", "strategy", "review"];
const fail = (): never => { throw new Error("r12_adaptive_action_unverified"); };
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const uuid = (v: unknown) => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const text = (v: unknown) => typeof v === "string" && v.trim().length > 0 && v.length <= 500;

/** Validate the reviewed topology and exact predecessor before asking SQL for
 * atomic admission. NME alone never establishes a repairable failure. */
export function validateAdaptiveResearchAction(raw: unknown, context: AdaptiveActionContext, now = Date.now()) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || containsCredentialLikeValue(raw) ||
      Object.keys(raw).sort().join(",") !== "counterevidenceQuestion,expectedInformationGain,hypothesis,kind,ordinal,phases,previousActionHash,previousReviewHash,question,repair,scopeHash,scopeId,version") return fail();
  const action = raw as AdaptiveResearchAction;
  const preview = validateAdaptiveResearchPreview(context.preview, now);
  const ownerCapture = preview.version === "r12.adaptive-research-preview.2";
  const phaseOrder: readonly AdaptivePhase[] = ownerCapture ? ADAPTIVE_ETSY_PHASES : legacyPhaseOrder;
  if (action.version !== (ownerCapture ? "r12.adaptive-action.2" : "r12.adaptive-action.1") || !uuid(action.scopeId) || !hash(action.scopeHash) ||
      action.scopeId !== context.scopeId || action.scopeHash !== context.scopeHash || !hash(context.scopeHash) ||
      !Number.isSafeInteger(action.ordinal) || action.ordinal < 0 || action.ordinal > preview.maximumActions ||
      action.ordinal !== context.nextOrdinal || action.previousActionHash !== context.previousActionHash ||
      action.previousReviewHash !== context.previousReviewHash || !hash(action.previousReviewHash) ||
      ![action.question, action.hypothesis, action.expectedInformationGain, action.counterevidenceQuestion].every(text) ||
      ![context.previousActionClosed, context.ownerStopped].every(v => typeof v === "boolean") ||
      !context.previousActionClosed || context.ownerStopped) return fail();
  if (action.ordinal === 0 ? action.kind !== "initial" || action.previousActionHash !== null ||
      action.previousReviewHash !== preview.imports.at(-1)?.responseHash : action.kind === "initial" || !hash(action.previousActionHash)) return fail();
  if (ownerCapture && (Object.keys(context.phaseCeilings).sort().join(",") !== "plan,review,strategy" ||
      context.capacity.createdPhaseSlots.some(phase => !ADAPTIVE_ETSY_PHASES.some(allowed => phase === allowed)) ||
      context.capacity.createdPhaseSlots.length > preview.maximumNewChildren)) return fail();
  if (ownerCapture && action.kind === "followup") throw new Error("r12_adaptive_owner_source_operation_required");
  if (!Array.isArray(action.phases) || !action.phases.length || action.phases.some(p => !phaseOrder.includes(p))) return fail();
  let expected: AdaptivePhase[];
  if (action.kind === "initial" || action.kind === "pivot") expected = [...phaseOrder];
  else if (action.kind === "followup") expected = phaseOrder.slice(1);
  else if (action.kind === "reasoning_review") expected = ["strategy", "review"];
  else if (action.kind === "repair") {
    const defect = context.repairableFailure;
    if (!defect || !action.repair || Object.keys(action.repair).sort().join(",") !== "defect,failedAttemptId,failureHash" ||
        !uuid(action.repair.failedAttemptId) || !hash(action.repair.failureHash) ||
        action.repair.failedAttemptId !== defect.attemptId || action.repair.failureHash !== defect.failureHash || action.repair.defect !== defect.defect ||
        !["schema", "format", "identified_reasoning"].includes(defect.defect) || !phaseOrder.includes(defect.phase)) return fail();
    // A fresh review needs its own strategy context; a fresh selection needs its
    // own query-bound collection. Count these calls explicitly, never relabel
    // older action outputs as if the new action produced them.
    const restart = defect.phase === "review" ? "strategy" : defect.phase === "select" ? "search" : defect.phase;
    expected = phaseOrder.slice(phaseOrder.indexOf(restart));
  } else return fail();
  if (action.kind !== "repair" && action.repair !== null || JSON.stringify(action.phases) !== JSON.stringify(expected)) return fail();
  if (context.capacity.extraActionsUsed !== action.ordinal - (action.ordinal > 0 ? 1 : 0) ||
      context.capacity.childrenUsed !== preview.predecessor.baseChildren + context.capacity.createdPhaseSlots.length || context.capacity.dispatchesUsed < preview.predecessor.baseDispatches ||
      context.capacity.dispatchesUsed + action.phases.length > preview.predecessor.baseDispatches + preview.maximumPaidCalls) return fail();
  const admission = admitAdaptiveAction(context.capacity, {
    kind: action.kind === "initial" ? "followup" : action.kind,
    calls: action.phases.map(phase => {
      const maximumMicrousd = context.phaseCeilings[phase];
      if (!Number.isSafeInteger(maximumMicrousd) || maximumMicrousd === undefined || maximumMicrousd < 1) return fail();
      return { phase, maximumMicrousd };
    }), downstreamCalls: [],
  });
  if (BigInt(context.capacity.runCommittedMicrousd) + BigInt(admission.quotedMicrousd) > BigInt(preview.maximumRunMicrounits)) {
    return { action: structuredClone(action), actionHash: discoveryV2Hash(action),
      admission: { ...admission, decision: "pause" as const, reason: "approved_run_budget" },
      extraActionIncrement: action.kind === "initial" ? 0 : 1, authorityCreated: false as const };
  }
  return { action: structuredClone(action), actionHash: discoveryV2Hash(action), admission,
    extraActionIncrement: action.kind === "initial" ? 0 : 1, authorityCreated: false as const };
}
