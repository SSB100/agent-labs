/** Explicit direct-mode successor. A hash validates integrity, never database
 * authority. Call/settlement/source pins must be authenticated by the controller.
 * Legacy policy/state/input validators and hashes are deliberately unchanged. */
import { validatePublicResearchBrowserAccounting, type PublicResearchBrowserAccounting } from "./discovery-r12-public-accounting";
import { PUBLIC_RESEARCH_PHASES, validatePublicResearchPolicy, validatePublicResearchHistory, validatePublicResearchCommand, validatePublicResearchSourceProof, type PublicResearchPolicy, type PublicResearchHistory, type PublicResearchPhase, type PublicResearchAcquisitionCommand, type PublicResearchSourceProof, type PublicResearchTerminal } from "./discovery-r12-public-contracts";
import { validatePublicResearchReviewedResult, assertPublicResearchFreshFollowup, type PublicResearchReviewedResult } from "./discovery-r12-public-review";
import { exactPublicKeys as exact, publicHash as hash, publicInteger as integer, publicMoney as money, publicResearchFail as fail, publicResearchHash, publicUuid as uuid, publicText as text, publicBoundedJson, verifyPublicSelfHash } from "./discovery-r12-public-utils";

export type PublicResearchRepairPolicy = Omit<PublicResearchPolicy, "version" | "maximumDispatchesPerAttempt"> & {
  version: "r12.direct-etsy-attempt-policy.2";
  maximumPhasesPerInitialCycle: 4;
  unitAccounting: { version: "r12.direct-etsy-attempt-units.1"; maximumUnitsInWindow: number; baseUnitsConsumed: number; baseLogicalCyclesStarted: number; previousWindowStateHash: string | null };
};
export type PublicResearchSettledModelFailure = {
  version: "r12.direct-settled-failure.1"; phaseAttemptId: string; requestId: string; candidateHash: string;
  routeProofHash: string; modelReceiptHash: string; diagnostic: string; actualMicrounits: string;
};
export type PublicResearchFailedSource = {
  version: "r12.direct-source-failure.1"; operationId: string; sourceAttemptId: string; requestHash: string; receiptHash: string;
  sourceReceiptVersion: "r12.etsy-public-source-receipt.1" | "r12.etsy-insights-source-receipt.1";
  status: "paused" | "blocked" | "failed" | "aborted" | "completed"; reason: string;
  releaseState: "not_required" | "verified" | "unconfirmed"; liabilityState: "not_dispatched" | "receipt_required" | "unknown";
  accounting: PublicResearchBrowserAccounting | null; failureHash: string;
};
export type PublicResearchAcceptedPin = { phaseAttemptId: string; receiptHash: string };
export type PublicResearchAcceptedDependencies = {
  version: "r12.direct-accepted-dependencies.1"; logicalCycleId: string;
  plan: PublicResearchAcceptedPin | null; source: PublicResearchAcceptedPin | null; strategy: PublicResearchAcceptedPin | null; selectionHash: string;
};
export type PublicResearchPhaseCall = {
  sequence: number; phase: PublicResearchPhase; phaseAttemptId: string; requestId: string;
  logicalCycleId: string; logicalCycleOrdinal: number; repairOrdinal: number; countedUnitOrdinal: number;
  replacesAttemptId: string | null; dependencySelectionHash: string; sourceReuseHash: string | null;
  requestHash: string; executionQuoteHash: string; executionQuoteProofHash: string; maximumMicrounits: string;
  status: "scheduled" | "dispatched" | "accepted" | "failed_settled" | "source_failed";
  receiptHash: string | null; actualMicrounits: string | null; failure: PublicResearchSettledModelFailure | PublicResearchFailedSource | null;
};
export type PublicResearchCountedUnit = {
  ordinal: number; windowUnitOrdinal: number; kind: "initial_cycle" | "phase_repair";
  logicalCycleId: string; phaseAttemptId: string; phase: PublicResearchPhase; repairOrdinal: number;
};
export type PublicResearchLogicalCycle = {
  ordinal: number; windowAttemptOrdinal: number; logicalCycleId: string; initialCountedUnitOrdinal: number;
  kind: "initial" | "targeted" | "pivot"; epochOrdinal: number; command: PublicResearchAcquisitionCommand;
  sourceProof: PublicResearchSourceProof | null; status: "running" | "completed"; review: PublicResearchReviewedResult | null;
};
export type PublicResearchRepairState = {
  version: "r12.direct-etsy-attempt-state.2"; policyHash: string; inherited: PublicResearchHistory; history: PublicResearchHistory;
  windowId: string; windowOrdinal: number; maximumUnitsInWindow: number;
  logicalCycles: PublicResearchLogicalCycle[]; actualPhaseCalls: PublicResearchPhaseCall[]; countedUnits: PublicResearchCountedUnit[];
  logicalCyclesStarted: number; totalLogicalCyclesStarted: number; unitsReserved: number; unitsConsumed: number; totalUnitsReserved: number; totalUnitsConsumed: number;
  modelDispatchSlotsReserved: number; sourceOperationSlotsReserved: number; modelDispatchesUsed: number; sourceOperationsStarted: number;
  cumulativeChildrenUsed: number; cumulativeDispatchSlotsReserved: number; cumulativeDispatchesUsed: number; repairs: number; pivots: number;
  epochOrdinal: number; epochCriteriaHash: string | null; nmeCountInEpoch: number; seenCriteriaHashes: string[];
  nextCycleKind: PublicResearchLogicalCycle["kind"] | null; pendingCommand: PublicResearchAcquisitionCommand | null;
  nextPhase: PublicResearchPhase | null; nextAction: "initial_cycle" | "next_cycle" | "dispatch_scheduled" | "receipt_only" | "next_phase" | "repair_model" | "source_paused" | "accept_review" | "window_limit" | "research_stage_complete";
  questComplete: false; researchWindowComplete: boolean; researchStageOutcome: "RESEARCH_PASSED_SUPPORTS_TEST" | "RESEARCH_PASSED_REJECTS_HYPOTHESIS" | "RESEARCH_FAILED_QUALITY" | "INSUFFICIENT_EVIDENCE" | "INVALID_RESEARCH" | null;
  requiresReviewedRenewal: boolean; terminal: PublicResearchTerminal | null; stateHash: string;
};
export type PublicResearchRepairPhaseBinding = {
  version: "r12.public-research-phase-binding.2"; policyHash: string; stateHash: string; logicalCycleId: string;
  logicalCycleOrdinal: number; windowAttemptOrdinal: number; phase: PublicResearchPhase; phaseAttemptId: string; requestId: string;
  repairOrdinal: number; countedUnitOrdinal: number; replacesAttemptId: string | null;
  dependencies: PublicResearchAcceptedDependencies; sourceReuseHash: string | null; semanticProgress: false; bindingHash: string;
};
const same = (a: unknown, b: unknown) => publicResearchHash(a) === publicResearchHash(b);
const merge = (a: string[], b: string[]) => [...new Set([...a, ...b])].sort();
const acquisition = (raw: unknown): PublicResearchAcquisitionCommand => { const c = validatePublicResearchCommand(raw); return c.kind === "finish" ? fail() : c; };
function self<T extends object, K extends string>(body: T, key: K): T & Record<K, string> { return { ...body, [key]: publicResearchHash(body) } as T & Record<K, string>; }
/** Private structural reuse only. This object is never an input, wire, receipt,
 * stored policy or authority. All externally visible pins remain policy.2. */
function commonTerms(p: PublicResearchRepairPolicy): PublicResearchPolicy {
  const { version, maximumPhasesPerInitialCycle, unitAccounting, policyHash, ...rest } = p;
  void version; void maximumPhasesPerInitialCycle; void unitAccounting; void policyHash;
  return self({ ...rest, version: "r12.direct-etsy-attempt-policy.1" as const, maximumDispatchesPerAttempt: 4 as const }, "policyHash") as PublicResearchPolicy;
}
export function validatePublicResearchRepairPolicy(raw: unknown): PublicResearchRepairPolicy {
  if (!exact(raw, "scopeVersion,businessId,goalId,authorityRootId,scopeId,scopeHash,originDirectRunId,originalSemanticGoalHash,version,envelopeHash,browserAccountingPins,inheritedStateHash,initialCommandHash,quoteHash,sourcePolicyHash,approvalHash,rubricVersion,window,continuation,sourceAccess,maximumModelDispatches,maximumSourceOperations,maximumNmePerEpoch,maximumPhasesPerInitialCycle,unitAccounting,baseChildren,baseDispatches,baseRepairs,basePivots,cumulativeChildrenCeiling,cumulativeDispatchesCeiling,baseKnownMicrounits,originalRunMaximumMicrounits,maximumNewAllocationMicrounits,businessLifetimeLimitMicrounits,rootLifetimeLimitMicrounits,phaseMaximumMicrounits,policyHash")) return fail();
  const p = raw as unknown as PublicResearchRepairPolicy, u = p.unitAccounting;
  if (p.version !== "r12.direct-etsy-attempt-policy.2" || p.maximumPhasesPerInitialCycle !== 4 || !exact(u, "version,maximumUnitsInWindow,baseUnitsConsumed,baseLogicalCyclesStarted,previousWindowStateHash") || u.version !== "r12.direct-etsy-attempt-units.1" || u.maximumUnitsInWindow !== p.window.maximumAttemptsInWindow || !integer(u.maximumUnitsInWindow, 1, 32)) return fail();
  validatePublicResearchPolicy(commonTerms(p));
  // Renewal needs an independently qualified closure; this version does not
  // silently reactivate or upgrade an existing .1 or previously used window.
  if (p.window.windowOrdinal !== 1 || u.baseUnitsConsumed !== 0 || u.baseLogicalCyclesStarted !== 0 || u.previousWindowStateHash !== null || p.window.baseAttemptsStarted !== 0) return fail("r12_public_repair_renewal_unqualified");
  verifyPublicSelfHash(raw, "policyHash"); return structuredClone(p);
}
function dependencies(cycleId: string, phase: PublicResearchPhase, calls: PublicResearchPhaseCall[]): PublicResearchAcceptedDependencies {
  const result: { plan: PublicResearchAcceptedPin | null; source: PublicResearchAcceptedPin | null; strategy: PublicResearchAcceptedPin | null } = { plan: null, source: null, strategy: null };
  for (const key of ["plan", "source", "strategy"] as const) {
    if (PUBLIC_RESEARCH_PHASES.indexOf(key) >= PUBLIC_RESEARCH_PHASES.indexOf(phase)) continue;
    const c = [...calls].reverse().find(c => c.logicalCycleId === cycleId && c.phase === key);
    if (!c || c.status !== "accepted" || !c.receiptHash) return fail("r12_public_repair_dependency_unaccepted");
    result[key] = { phaseAttemptId: c.phaseAttemptId, receiptHash: c.receiptHash };
  }
  return self({ version: "r12.direct-accepted-dependencies.1" as const, logicalCycleId: cycleId, ...result }, "selectionHash") as PublicResearchAcceptedDependencies;
}
export function publicResearchSourceReuseHash(policy: PublicResearchRepairPolicy, cycle: PublicResearchLogicalCycle, replacement: Pick<PublicResearchPhaseCall, "phaseAttemptId" | "replacesAttemptId" | "phase">): string {
  const s = cycle.sourceProof; if (!s) return fail("r12_public_repair_source_missing");
  return publicResearchHash({ version: "r12.direct-source-reuse.1", policyHash: policy.policyHash, logicalCycleId: cycle.logicalCycleId, replacesPhaseAttemptId: replacement.replacesAttemptId, newPhaseAttemptId: replacement.phaseAttemptId, phase: replacement.phase, reason: "settled_model_phase_failure", sourceScopeId: s.scopeId, sourceScopeHash: s.scopeHash, sourceAttemptId: s.sourceAttemptId, operationId: s.operationId, receiptHash: s.receiptHash, sourceProofHash: publicResearchHash(s), accountingRecordHash: s.accounting.recordHash, quoteHash: s.quoteHash, executionQuoteHash: s.executionQuoteHash, executionQuoteProofHash: s.executionQuoteProofHash });
}
function failure(call: PublicResearchPhaseCall, scopeId: string): void {
  const f = call.failure;
  if (call.phase === "source" || f?.version !== "r12.direct-settled-failure.1" || !exact(f, "version,phaseAttemptId,requestId,candidateHash,routeProofHash,modelReceiptHash,diagnostic,actualMicrounits")  || f.phaseAttemptId !== call.phaseAttemptId || f.requestId !== call.requestId || ![f.candidateHash, f.routeProofHash, f.modelReceiptHash].every(hash) || typeof f.diagnostic !== "string" || !/^r12_direct_[a-z0-9_]{1,100}$/.test(f.diagnostic) || f.actualMicrounits !== call.actualMicrounits || f.modelReceiptHash !== call.receiptHash || f.modelReceiptHash !== publicResearchHash({ version: "r12.public-model-receipt-pin.1", phase: call.phase, scopeId, phaseAttemptId: call.phaseAttemptId, requestId: call.requestId, requestHash: call.requestHash, candidateHash: f.candidateHash, routeProofHash: f.routeProofHash })) return fail("r12_public_repair_failure_unqualified");
}
function sourceFailure(call: PublicResearchPhaseCall, p: PublicResearchRepairPolicy): void {
  const f = call.failure;
  if (call.phase !== "source" || f?.version !== "r12.direct-source-failure.1" || !exact(f, "version,operationId,sourceAttemptId,requestHash,receiptHash,sourceReceiptVersion,status,reason,releaseState,liabilityState,accounting,failureHash") || !uuid(f.operationId) || f.sourceAttemptId !== call.phaseAttemptId || f.requestHash !== call.requestHash || f.receiptHash !== call.receiptHash || f.sourceReceiptVersion !== (p.sourceAccess.allowedSource === "etsy_authenticated_insights" ? "r12.etsy-insights-source-receipt.1" : "r12.etsy-public-source-receipt.1") || !["paused","blocked","failed","aborted","completed"].includes(f.status) || !text(f.reason, 1000) || !["not_required","verified","unconfirmed"].includes(f.releaseState) || !["not_dispatched","receipt_required","unknown"].includes(f.liabilityState)) return fail("r12_public_source_failure_unqualified");
  if (f.status === "completed" && (f.reason !== "r12_direct_source_repetition" || f.accounting === null)) return fail("r12_public_source_disqualification_unverified");
  if (f.accounting) {
    if (f.releaseState !== "verified" || f.liabilityState !== "receipt_required") return fail();
    validatePublicResearchBrowserAccounting(f.accounting, { businessId: p.businessId, goalId: p.goalId, authorityRootId: p.authorityRootId, envelopeHash: p.envelopeHash, ...p.browserAccountingPins, operationKind: "research_source", operationId: f.operationId, operationReceiptHash: f.receiptHash, requestHash: f.requestHash, quoteHash: p.quoteHash, maximumMicrounits: call.maximumMicrounits });
    if (call.actualMicrounits !== f.accounting.actualMicrounits) return fail();
  } else if (call.actualMicrounits !== null) return fail();
  verifyPublicSelfHash(f as unknown as Record<string, unknown>, "failureHash");
}
function derive(p: PublicResearchRepairPolicy, inherited: PublicResearchHistory, cycles: PublicResearchLogicalCycle[], calls: PublicResearchPhaseCall[], units: PublicResearchCountedUnit[], initial: PublicResearchAcquisitionCommand): PublicResearchRepairState {
  if (publicResearchHash(inherited) !== p.inheritedStateHash || publicResearchHash(initial) !== p.initialCommandHash || !Array.isArray(cycles) || !Array.isArray(calls) || !Array.isArray(units) || units.length > p.unitAccounting.maximumUnitsInWindow || cycles.length > units.length || calls.length > 64) return fail();
  const history = structuredClone(inherited), c = p.continuation, w = p.window;
  let epochOrdinal = c.epochOrdinal, epochCriteriaHash = c.epochCriteriaHash, nmeCountInEpoch = c.nmeCountInEpoch, seenCriteriaHashes = [...c.seenCriteriaHashes];
  let nextCycleKind: PublicResearchRepairState["nextCycleKind"] = "initial", pendingCommand: PublicResearchAcquisitionCommand | null = initial;
  let terminal: PublicResearchTerminal | null = null, nextPhase: PublicResearchPhase | null = "plan", nextAction: PublicResearchRepairState["nextAction"] = "initial_cycle", lastOutcome: PublicResearchRepairState["researchStageOutcome"] = null;
  let unitIndex = 0, callIndex = 0, repairs = p.baseRepairs, pivots = p.basePivots;
  const ids = new Set<string>(), requests = new Set<string>(), requestHashes = new Set<string>(), receipts = new Set<string>(), operations = new Set<string>();
  for (const [index, cycle] of cycles.entries()) {
    if (terminal || !exact(cycle, "ordinal,windowAttemptOrdinal,logicalCycleId,initialCountedUnitOrdinal,kind,epochOrdinal,command,sourceProof,status,review") || cycle.ordinal !== w.baseAttemptsStarted + index + 1 || cycle.windowAttemptOrdinal !== index + 1 || !uuid(cycle.logicalCycleId) || ids.has(cycle.logicalCycleId) || cycle.kind !== nextCycleKind || !pendingCommand || !same(cycle.command, pendingCommand) || !["running", "completed"].includes(cycle.status)) return fail();
    ids.add(cycle.logicalCycleId); acquisition(cycle.command);
    if (cycle.kind === "initial") { if (index !== 0 || epochCriteriaHash !== null) return fail(); epochCriteriaHash = cycle.command.criteriaHash; seenCriteriaHashes = [epochCriteriaHash]; }
    else if (cycle.kind === "pivot") { if (nmeCountInEpoch !== 4 || cycle.command.kind !== "pivot" || seenCriteriaHashes.includes(cycle.command.criteriaHash)) return fail(); epochOrdinal++; nmeCountInEpoch = 0; epochCriteriaHash = cycle.command.criteriaHash; seenCriteriaHashes = merge(seenCriteriaHashes, [epochCriteriaHash]); pivots++; }
    else if (cycle.command.criteriaHash !== epochCriteriaHash || nmeCountInEpoch >= 4) return fail();
    if (cycle.epochOrdinal !== epochOrdinal) return fail();
    const local: PublicResearchPhaseCall[] = [];
    let expectedPhase: PublicResearchPhase = "plan";
    while (callIndex < calls.length && calls[callIndex].logicalCycleId === cycle.logicalCycleId) {
      const call = calls[callIndex], prev = local.at(-1), replacement = !!prev && prev.status === "failed_settled";
      if (!exact(call, "sequence,phase,phaseAttemptId,requestId,logicalCycleId,logicalCycleOrdinal,repairOrdinal,countedUnitOrdinal,replacesAttemptId,dependencySelectionHash,sourceReuseHash,requestHash,executionQuoteHash,executionQuoteProofHash,maximumMicrounits,status,receiptHash,actualMicrounits,failure") || call.sequence !== callIndex + 1 || call.logicalCycleOrdinal !== cycle.ordinal || call.phase !== expectedPhase || ![call.phaseAttemptId, call.requestId].every(uuid) || ids.has(call.phaseAttemptId) || requests.has(call.requestId) || requestHashes.has(call.requestHash) || ![call.requestHash, call.executionQuoteHash, call.executionQuoteProofHash, call.dependencySelectionHash].every(hash) || !["scheduled", "dispatched", "accepted", "failed_settled", "source_failed"].includes(call.status) || call.maximumMicrounits !== p.phaseMaximumMicrounits[call.phase]) return fail();
      if (prev && !["accepted", "failed_settled"].includes(prev.status)) return fail("r12_public_repair_reconcile_before_send");
      if (replacement ? call.phase === "source" || call.repairOrdinal !== prev.repairOrdinal + 1 || call.replacesAttemptId !== prev.phaseAttemptId : call.repairOrdinal !== 0 || call.replacesAttemptId !== null) return fail("r12_public_repair_replacement_invalid");
      if (call.dependencySelectionHash !== dependencies(cycle.logicalCycleId, call.phase, local).selectionHash || call.sourceReuseHash !== (replacement && ["strategy", "review"].includes(call.phase) ? publicResearchSourceReuseHash(p, cycle, call) : null)) return fail("r12_public_repair_provenance_mismatch");
      if (local.length === 0 || replacement) {
        const unit = units[unitIndex], expected = { ordinal: p.unitAccounting.baseUnitsConsumed + unitIndex + 1, windowUnitOrdinal: unitIndex + 1, kind: replacement ? "phase_repair" : "initial_cycle", logicalCycleId: cycle.logicalCycleId, phaseAttemptId: call.phaseAttemptId, phase: call.phase, repairOrdinal: call.repairOrdinal };
        if (!same(unit, expected) || call.countedUnitOrdinal !== expected.ordinal || !replacement && cycle.initialCountedUnitOrdinal !== expected.ordinal) return fail("r12_public_repair_unit_mismatch");
        unitIndex++; if (replacement && call.status !== "scheduled") repairs++;
      } else if (call.countedUnitOrdinal !== cycle.initialCountedUnitOrdinal) return fail("r12_public_downstream_unit_mismatch");
      ids.add(call.phaseAttemptId); requests.add(call.requestId); requestHashes.add(call.requestHash);
      if (["scheduled", "dispatched"].includes(call.status)) { if (call.receiptHash !== null || call.actualMicrounits !== null || call.failure !== null) return fail(); }
      else {
        if (!hash(call.receiptHash) || receipts.has(call.receiptHash)) return fail(); receipts.add(call.receiptHash);
        if (call.phase !== "source" && (call.actualMicrounits === null || money(call.actualMicrounits) > money(call.maximumMicrounits))) return fail();
        if (call.status === "failed_settled") { failure(call, p.scopeId); history.consecutiveNonprogress++; history.usedDiagnosticHashes = merge(history.usedDiagnosticHashes, [publicResearchHash(call.failure)]); lastOutcome = "INVALID_RESEARCH"; }
        else if (call.status === "source_failed") { sourceFailure(call, p); history.consecutiveNonprogress++; history.usedDiagnosticHashes = merge(history.usedDiagnosticHashes, [publicResearchHash(call.failure)]); lastOutcome = "INVALID_RESEARCH"; }
        else if (call.failure !== null) return fail();
      }
      local.push(call); callIndex++;
      if (call.status === "accepted") {
        if (call.phase === "source") {
          if (!cycle.sourceProof) return fail(); const s = validatePublicResearchSourceProof(cycle.sourceProof, commonTerms(p));
          if (s.sourceAttemptId !== call.phaseAttemptId || s.requestHash !== call.requestHash || s.receiptHash !== call.receiptHash || s.executionQuoteHash !== call.executionQuoteHash || s.executionQuoteProofHash !== call.executionQuoteProofHash || s.attemptOrdinal !== cycle.ordinal || s.criteriaHash !== cycle.command.criteriaHash || s.questionHash !== cycle.command.questionHash || operations.has(s.operationId) || call.actualMicrounits !== s.accounting.actualMicrounits) return fail();
          operations.add(s.operationId);
          if (!s.witnesses.some(x => !history.seenEvidenceIdentityHashes.includes(x.evidenceIdentityHash) && !history.seenFactIdentityHashes.includes(x.factIdentityHash))) return fail("r12_public_source_repetition");
          history.seenEvidenceIdentityHashes = merge(history.seenEvidenceIdentityHashes, s.witnesses.map(x => x.evidenceIdentityHash)); history.seenFactIdentityHashes = merge(history.seenFactIdentityHashes, s.witnesses.map(x => x.factIdentityHash));
        }
        const next: PublicResearchPhase | undefined = PUBLIC_RESEARCH_PHASES[PUBLIC_RESEARCH_PHASES.indexOf(call.phase) + 1];
        if (next) expectedPhase = next; else if (callIndex < calls.length && calls[callIndex].logicalCycleId === cycle.logicalCycleId) return fail();
      }
    }
    if (!local.length || cycle.sourceProof !== null && !local.some(x => x.phase === "source" && x.status === "accepted")) return fail();
    history.seenQuestionHashes = merge(history.seenQuestionHashes, [cycle.command.questionHash]);
    const last = local.at(-1)!; nextCycleKind = null; pendingCommand = null; nextPhase = last.status === "accepted" ? last.phase === "review" ? null : expectedPhase : last.phase;
    nextAction = last.status === "scheduled" ? "dispatch_scheduled" : last.status === "dispatched" ? "receipt_only" : last.status === "failed_settled" ? "repair_model" : last.status === "source_failed" ? "source_paused" : last.phase === "review" ? "accept_review" : "next_phase";
    if (cycle.status === "completed") {
      if (last.phase !== "review" || last.status !== "accepted" || !cycle.review || !cycle.sourceProof) return fail();
      const r = validatePublicResearchReviewedResult(cycle.review, commonTerms(p)), selected = dependencies(cycle.logicalCycleId, "review", local);
      if (r.attemptOrdinal !== cycle.ordinal || r.criteriaHash !== cycle.command.criteriaHash || r.questionHash !== cycle.command.questionHash || r.strategyReceiptHash !== selected.strategy?.receiptHash || r.reviewReceiptHash !== last.receiptHash) return fail();
      if (r.outcome !== "NME") { terminal = r.terminal; history.consecutiveNonprogress = 0; lastOutcome = r.outcome === "TEST" ? "RESEARCH_PASSED_SUPPORTS_TEST" : "RESEARCH_PASSED_REJECTS_HYPOTHESIS"; nextAction = "research_stage_complete"; nextPhase = null; }
      else {
        nmeCountInEpoch++; history.consecutiveNonprogress++; lastOutcome = r.quality.passed ? "INSUFFICIENT_EVIDENCE" : "RESEARCH_FAILED_QUALITY";
        const command = acquisition(r.proposedCommand); assertPublicResearchFreshFollowup(command, history.seenQuestionHashes, cycles.slice(0, index + 1).map(x => x.command.query));
        if (nmeCountInEpoch === 4) { if (command.kind !== "pivot" || seenCriteriaHashes.includes(command.criteriaHash)) return fail("r12_public_fourth_nme_requires_pivot"); nextCycleKind = "pivot"; }
        else { if (command.kind !== "targeted" || command.criteriaHash !== epochCriteriaHash) return fail("r12_public_targeted_followup_required"); nextCycleKind = "targeted"; }
        pendingCommand = command; nextPhase = "plan"; nextAction = "next_cycle";
      }
    } else if (index !== cycles.length - 1 || cycle.review !== null) return fail();
  }
  if (callIndex !== calls.length || unitIndex !== units.length) return fail();
  const models = calls.filter(x => x.phase !== "source"), sources = calls.filter(x => x.phase === "source"), dispatched = calls.filter(x => x.status !== "scheduled");
  if (models.length > p.maximumModelDispatches || sources.length > p.maximumSourceOperations || p.baseDispatches + calls.length > p.cumulativeDispatchesCeiling) return fail("r12_public_repair_dispatch_limit");
  const consumed = units.filter(u => calls.find(x => x.phaseAttemptId === u.phaseAttemptId)!.status !== "scheduled").length;
  const exhausted = units.length === p.unitAccounting.maximumUnitsInWindow && (nextAction === "next_cycle" || nextAction === "initial_cycle" || nextAction === "repair_model") && terminal === null;
  if (exhausted) { terminal = "RESEARCH_INSUFFICIENT_AT_WINDOW_LIMIT"; nextAction = "window_limit"; }
  const body = { version: "r12.direct-etsy-attempt-state.2" as const, policyHash: p.policyHash, inherited, history, windowId: w.windowId, windowOrdinal: w.windowOrdinal, maximumUnitsInWindow: p.unitAccounting.maximumUnitsInWindow, logicalCycles: cycles, actualPhaseCalls: calls, countedUnits: units, logicalCyclesStarted: cycles.length, totalLogicalCyclesStarted: p.unitAccounting.baseLogicalCyclesStarted + cycles.length, unitsReserved: units.length, unitsConsumed: consumed, totalUnitsReserved: p.unitAccounting.baseUnitsConsumed + units.length, totalUnitsConsumed: p.unitAccounting.baseUnitsConsumed + consumed, modelDispatchSlotsReserved: models.length, sourceOperationSlotsReserved: sources.length, modelDispatchesUsed: c.modelDispatchesUsed + models.filter(x => x.status !== "scheduled").length, sourceOperationsStarted: c.sourceOperationsStarted + sources.filter(x => x.status !== "scheduled").length, cumulativeChildrenUsed: p.cumulativeChildrenCeiling, cumulativeDispatchSlotsReserved: p.baseDispatches + calls.length, cumulativeDispatchesUsed: p.baseDispatches + dispatched.length, repairs, pivots, epochOrdinal, epochCriteriaHash, nmeCountInEpoch, seenCriteriaHashes, nextCycleKind, pendingCommand, nextPhase, nextAction, questComplete: false as const, researchWindowComplete: terminal !== null, researchStageOutcome: terminal === null ? null : lastOutcome, requiresReviewedRenewal: exhausted, terminal };
  return self(body, "stateHash") as PublicResearchRepairState;
}
export function createPublicResearchRepairState(policy: PublicResearchRepairPolicy, inherited: PublicResearchHistory, initial: PublicResearchAcquisitionCommand): PublicResearchRepairState { return derive(validatePublicResearchRepairPolicy(policy), validatePublicResearchHistory(inherited), [], [], [], acquisition(initial)); }
export function replayPublicResearchRepairState(policy: PublicResearchRepairPolicy, inherited: PublicResearchHistory, initial: PublicResearchAcquisitionCommand, logicalCycles: PublicResearchLogicalCycle[], actualPhaseCalls: PublicResearchPhaseCall[], countedUnits: PublicResearchCountedUnit[]): PublicResearchRepairState {
  publicBoundedJson({ logicalCycles, actualPhaseCalls, countedUnits });
  return derive(validatePublicResearchRepairPolicy(policy), validatePublicResearchHistory(inherited), structuredClone(logicalCycles), structuredClone(actualPhaseCalls), structuredClone(countedUnits), acquisition(initial));
}
export function validatePublicResearchRepairState(raw: unknown, policy: PublicResearchRepairPolicy): PublicResearchRepairState {
  if (!exact(raw, "version,policyHash,inherited,history,windowId,windowOrdinal,maximumUnitsInWindow,logicalCycles,actualPhaseCalls,countedUnits,logicalCyclesStarted,totalLogicalCyclesStarted,unitsReserved,unitsConsumed,totalUnitsReserved,totalUnitsConsumed,modelDispatchSlotsReserved,sourceOperationSlotsReserved,modelDispatchesUsed,sourceOperationsStarted,cumulativeChildrenUsed,cumulativeDispatchSlotsReserved,cumulativeDispatchesUsed,repairs,pivots,epochOrdinal,epochCriteriaHash,nmeCountInEpoch,seenCriteriaHashes,nextCycleKind,pendingCommand,nextPhase,nextAction,questComplete,researchWindowComplete,researchStageOutcome,requiresReviewedRenewal,terminal,stateHash")) return fail();
  const s = raw as unknown as PublicResearchRepairState;
  if (!Array.isArray(s.logicalCycles) || !s.logicalCycles.length && s.pendingCommand === null) return fail();
  const expected = replayPublicResearchRepairState(policy, s.inherited, s.logicalCycles[0]?.command ?? s.pendingCommand!, s.logicalCycles, s.actualPhaseCalls, s.countedUnits);
  if (!same(s, expected)) return fail("r12_public_repair_state_replay_mismatch"); return expected;
}
export function publicResearchRepairDependencies(state: PublicResearchRepairState, cycleId: string, phase: PublicResearchPhase, beforeSequence = Number.MAX_SAFE_INTEGER): PublicResearchAcceptedDependencies { return dependencies(cycleId, phase, state.actualPhaseCalls.filter(x => x.sequence < beforeSequence)); }
export function publicResearchRepairPhaseBinding(policy: PublicResearchRepairPolicy, raw: PublicResearchRepairState, phaseAttemptId: string): PublicResearchRepairPhaseBinding {
  const p = validatePublicResearchRepairPolicy(policy), s = validatePublicResearchRepairState(raw, p), call = s.actualPhaseCalls.at(-1), cycle = s.logicalCycles.at(-1);
  if (!call || !cycle || call.phaseAttemptId !== phaseAttemptId || !["scheduled", "dispatched"].includes(call.status)) return fail();
  return self({ version: "r12.public-research-phase-binding.2" as const, policyHash: p.policyHash, stateHash: s.stateHash, logicalCycleId: cycle.logicalCycleId, logicalCycleOrdinal: cycle.ordinal, windowAttemptOrdinal: cycle.windowAttemptOrdinal, phase: call.phase, phaseAttemptId, requestId: call.requestId, repairOrdinal: call.repairOrdinal, countedUnitOrdinal: call.countedUnitOrdinal, replacesAttemptId: call.replacesAttemptId, dependencies: dependencies(cycle.logicalCycleId, call.phase, s.actualPhaseCalls.slice(0, -1)), sourceReuseHash: call.sourceReuseHash, semanticProgress: false as const }, "bindingHash") as PublicResearchRepairPhaseBinding;
}
export function validatePublicResearchRepairPhaseBinding(raw: unknown, policy: PublicResearchRepairPolicy, state: PublicResearchRepairState, expected: { phaseAttemptId: string; policyHash: string; stateHash: string; bindingHash: string }): PublicResearchRepairPhaseBinding {
  const binding = publicResearchRepairPhaseBinding(policy, state, expected.phaseAttemptId);
  if (expected.policyHash !== policy.policyHash || expected.stateHash !== state.stateHash || expected.bindingHash !== binding.bindingHash || !same(raw, binding)) return fail("r12_public_repair_phase_binding_mismatch"); return binding;
}

export type PublicResearchRepairCapacity = {
  policyHash: string; authoritySnapshotHash: string; authorityActive: boolean; stopped: boolean; expired: boolean; hasUnknownLiability: boolean;
  approvedMaximumUnitsInWindow: number; cumulativeDispatchesCeiling: number;
  runCommittedMicrounits: string; rootHeadroomMicrounits: string; businessHeadroomMicrounits: string; allocationHeadroomMicrounits: string;
};
/** Called with fresh authenticated accounting before reservation. Replay itself
 * is an integrity check, not a substitute for shared SQL locks or live authority. */
export function assertPublicResearchRepairAdmission(policy: PublicResearchRepairPolicy, raw: PublicResearchRepairState, capacity: PublicResearchRepairCapacity): void {
  const p = validatePublicResearchRepairPolicy(policy), s = validatePublicResearchRepairState(raw, p), c = capacity;
  if (!exact(c, "policyHash,authoritySnapshotHash,authorityActive,stopped,expired,hasUnknownLiability,approvedMaximumUnitsInWindow,cumulativeDispatchesCeiling,runCommittedMicrounits,rootHeadroomMicrounits,businessHeadroomMicrounits,allocationHeadroomMicrounits") || c.policyHash !== p.policyHash || !hash(c.authoritySnapshotHash) || c.authorityActive !== true || c.stopped !== false || c.expired !== false || c.hasUnknownLiability !== false || !integer(c.approvedMaximumUnitsInWindow, 1, 32) || p.unitAccounting.maximumUnitsInWindow > c.approvedMaximumUnitsInWindow || !integer(c.cumulativeDispatchesCeiling, 0, 64) || s.terminal || !["initial_cycle", "next_cycle", "next_phase", "repair_model"].includes(s.nextAction) || s.nextPhase === null) return fail("r12_public_repair_admission_blocked");
  const newUnit = s.nextAction !== "next_phase";
  if (newUnit && s.unitsReserved >= p.unitAccounting.maximumUnitsInWindow) return fail("r12_public_repair_unit_limit");
  const suffix = PUBLIC_RESEARCH_PHASES.slice(PUBLIC_RESEARCH_PHASES.indexOf(s.nextPhase));
  if (s.cumulativeDispatchSlotsReserved + suffix.length > Math.min(c.cumulativeDispatchesCeiling, p.cumulativeDispatchesCeiling) || s.modelDispatchSlotsReserved + suffix.filter(x => x !== "source").length > p.maximumModelDispatches || s.sourceOperationSlotsReserved + suffix.filter(x => x === "source").length > p.maximumSourceOperations) return fail("r12_public_repair_dispatch_limit");
  const required = suffix.reduce((n, phase) => n + money(p.phaseMaximumMicrounits[phase]), BigInt(0));
  if (money(c.runCommittedMicrounits) + required > money(p.originalRunMaximumMicrounits) || [c.rootHeadroomMicrounits, c.businessHeadroomMicrounits, c.allocationHeadroomMicrounits].some(x => money(x) < required)) return fail("r12_public_repair_budget_blocked");
}
/** Input schema for the separately qualified .2 reader/runtime. Frozen .1
 * readers intentionally reject this version. No executable adapter is inferred. */
export type PublicResearchRepairModelInputs = Omit<import("./discovery-r12-public-model").PublicResearchLegacyModelInputs, "version" | "policy" | "state"> & {
  version: "r12.public-research-phase-inputs.2";
  policy: PublicResearchRepairPolicy; state: PublicResearchRepairState; repair: PublicResearchRepairPhaseBinding;
};
/** Readable deterministic repair history for model wires. Complete raw output,
 * billing and provenance stay immutable in storage; this is not authority. */
export function publicResearchRepairModelWire(policy: PublicResearchRepairPolicy, raw: PublicResearchRepairState, phaseAttemptId: string) {
  const s = validatePublicResearchRepairState(raw, policy), binding = publicResearchRepairPhaseBinding(policy, s, phaseAttemptId);
  return {
    version: "r12.direct-repair-context.1" as const,
    logicalCycleId: binding.logicalCycleId, logicalCycleOrdinal: binding.logicalCycleOrdinal, windowAttemptOrdinal: binding.windowAttemptOrdinal,
    repairOrdinal: binding.repairOrdinal, countedUnitOrdinal: binding.countedUnitOrdinal, replacesAttemptId: binding.replacesAttemptId,
    dependencySelectionHash: binding.dependencies.selectionHash, sourceReuseHash: binding.sourceReuseHash,
    reusedSourceIsNewEvidence: false as const, semanticProgress: false as const,
    units: { maximum: s.maximumUnitsInWindow, reserved: s.unitsReserved, consumedBeforeCurrentDispatch: s.unitsConsumed - (s.countedUnits.some(u => u.phaseAttemptId === phaseAttemptId) && s.actualPhaseCalls.at(-1)!.status === "dispatched" ? 1 : 0), logicalCyclesStarted: s.logicalCyclesStarted },
    failures: s.actualPhaseCalls.filter(c => c.failure !== null).map(c => ({
      logicalCycleId: c.logicalCycleId, logicalCycleOrdinal: c.logicalCycleOrdinal, phaseAttemptId: c.phaseAttemptId, phase: c.phase,
      repairOrdinal: c.repairOrdinal, countedUnitOrdinal: c.countedUnitOrdinal, receiptHash: c.receiptHash,
      diagnostic: c.failure!.version === "r12.direct-settled-failure.1" ? c.failure!.diagnostic : c.failure!.reason,
      actualMicrounits: c.actualMicrounits, maximumMicrounits: c.maximumMicrounits,
    })),
  };
}
export function validatePublicResearchRepairSourceProof(raw: unknown, policy: PublicResearchRepairPolicy): PublicResearchSourceProof {
  return validatePublicResearchSourceProof(raw, commonTerms(validatePublicResearchRepairPolicy(policy)));
}
