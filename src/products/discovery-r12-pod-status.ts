export type PodRunStatus = {
  state: string; reason: string | null; activeWindow: boolean; receiptUntil: string | null;
  phases: Array<{ phase: string; status: string; reason: string | null;
    responseDiagnostic?: { code: string; observationSaved: boolean; issues: Array<{ path: string; constraint: string; limit: number | null }> } | null }>;
  podRuntime?: { latestPassOrdinal: number | null; currentPassOpen: boolean;
    latestClosureOutcome: "FAILED_OUTPUT" | "INSUFFICIENT_EVIDENCE" | "HYPOTHESIS_TO_TEST" | null;
    failedEffectReceiptStatus: string | null };
  cost: { knownMicrousd: string; heldMicrousd: string; hasUnknown: boolean };
};

/** Owner-read diagnostics take precedence over a historical "dispatched" head.
 * This is presentation only: it grants neither repair eligibility nor a call.
 */
export function podResearchProgress(status: PodRunStatus | null, stopped: boolean, thorough = false) {
  const failed = status?.phases.find(p => !!p.responseDiagnostic);
  const reviewerSchemaFailure = failed?.phase === "review" && failed.responseDiagnostic?.code === "response_schema";
  const runtime = status?.podRuntime;
  const savedRuntime = thorough && runtime && Number.isInteger(runtime.latestPassOrdinal)
    && runtime.latestPassOrdinal! >= 0 && runtime.latestPassOrdinal! < 5
    && typeof runtime.currentPassOpen === "boolean"
    && [null, "FAILED_OUTPUT", "INSUFFICIENT_EVIDENCE", "HYPOTHESIS_TO_TEST"].includes(runtime.latestClosureOutcome);
  // Read-only display of the latest pass. The controller still decides whether
  // a receipt, next pass, budget, deadline and authority permit any operation.
  const receiptState = savedRuntime ? runtime.failedEffectReceiptStatus : null;
  const pendingFailure = !!savedRuntime && ["awaiting_receipt", "checking_receipt", "verified"].includes(receiptState ?? "");
  const nextPass = !!savedRuntime && runtime.currentPassOpen && receiptState === null;
  const failedClosed = !!savedRuntime && !runtime.currentPassOpen && runtime.latestClosureOutcome === "FAILED_OUTPUT"
    && receiptState === "verified";
  const safelyContinuing = !stopped && status?.activeWindow && !status.cost.hasUnknown
    && (pendingFailure || nextPass || failedClosed) && !["blocked", "stopped", "completed"].includes(status.state);
  if (failed && safelyContinuing) return {
    title: pendingFailure && !failedClosed ? "Reconciling incomplete response" : "Research refinement saved",
    blockedByResponse: false,
    explanation: "The earlier response remains rejected. Its cost and receipt are checked before another counted research pass can use the saved evidence. A fresh independent review is required; the existing budget and attempt limits still apply.",
    canContinue: true,
  };
  return {
    title: stopped ? "Stopped" : failed ? reviewerSchemaFailure ? "Reviewer response could not be validated" : "Research response could not be validated" : "Saved progress",
    blockedByResponse: !!failed,
    explanation: !failed ? null : reviewerSchemaFailure
      ? "The reviewer returned a response outside the required format. The original response, accepted earlier work and costs are saved. There is no accepted independent review yet."
      : "The saved response failed validation. Continuing cannot silently resend or replace it. Earlier evidence and incurred costs remain saved.",
    canContinue: !stopped && !failed,
  };
}
