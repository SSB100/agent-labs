export type PodRunStatus = {
  state: string; reason: string | null; activeWindow: boolean; receiptUntil: string | null;
  phases: Array<{ phase: string; status: string; reason: string | null;
    responseDiagnostic?: { code: string; observationSaved: boolean; issues: Array<{ path: string; constraint: string; limit: number | null }> } | null }>;
  cost: { knownMicrousd: string; heldMicrousd: string; hasUnknown: boolean };
};

/** Owner-read diagnostics take precedence over a historical "dispatched" head.
 * This is presentation only: it grants neither repair eligibility nor a call.
 */
export function podResearchProgress(status: PodRunStatus | null, stopped: boolean) {
  const failed = status?.phases.find(p => !!p.responseDiagnostic);
  const reviewerSchemaFailure = failed?.phase === "review" && failed.responseDiagnostic?.code === "response_schema";
  return {
    title: stopped ? "Stopped" : failed ? reviewerSchemaFailure ? "Reviewer response could not be validated" : "Research response could not be validated" : "Saved progress",
    blockedByResponse: !!failed,
    explanation: !failed ? null : reviewerSchemaFailure
      ? "The reviewer returned a response outside the required format. The original response, accepted earlier work and costs are saved. There is no accepted independent review yet."
      : "The saved response failed validation. Continuing cannot silently resend or replace it. Earlier evidence and incurred costs remain saved.",
    canContinue: !stopped && !failed,
  };
}
