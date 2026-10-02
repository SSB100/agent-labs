"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CONSOLE_DECISION_UUID, consoleDecisionHref, consoleDecisionQuery, safeConsoleDecisionReturnPath, consoleDecisionActionReturnPath } from "@/lib/core-ui/console-decisions-query";
import { parseTerminalReviewRequest } from "@/creative/terminal-review";

function returnPath(form: FormData, scope?: { businessId?: string; interventionId: string }): string {
  const fallback = () => consoleDecisionHref(consoleDecisionQuery(scope ? { businessId: scope.businessId, selectedId: scope.interventionId } : {}));
  const supplied = safeConsoleDecisionReturnPath(form.get("returnTo"));
  if (!supplied) return fallback();
  return scope ? consoleDecisionActionReturnPath(supplied, scope) ?? fallback() : supplied;
}
function finish(path: string, kind: "message" | "error", code: string): never { redirect(`${path}&${kind}=${code}`); }

/** Closes one saved stopped-run notice; never resumes execution or grants approval. */
export async function acknowledgeTerminalCreativeReview(form: FormData) {
  const request = parseTerminalReviewRequest(form);
  if (!request) finish(returnPath(form), "error", "terminal-review-invalid");
  const supabase = await createClient();
  const claims = await supabase.auth.getClaims().catch(() => ({ error: true, data: null }));
  if (claims.error || !claims.data?.claims?.sub) redirect("/login?error=session-required");
  const result = await supabase.rpc("acknowledge_terminal_creative_review", {
    p_intervention_id: request.interventionId,
    p_expected_updated_at: request.expectedUpdatedAt,
  }).then(response => response, () => ({ data: null, error: { code: "", message: "" } }));
  const { data, error } = result;
  if (error) {
    const code = error.message === "terminal_review_conflict" ? "terminal-review-conflict" :
      error.message === "terminal_review_not_eligible" ? "terminal-review-ineligible" :
      error.code === "42501" ? "terminal-review-unavailable" : "terminal-review-failed";
    finish(returnPath(form, { interventionId: request.interventionId }), "error", code);
  }
  if (!data || !["acknowledged", "already_acknowledged"].includes(data.outcome) || data.interventionId !== request.interventionId ||
    typeof data.businessId !== "string" || !CONSOLE_DECISION_UUID.test(data.businessId) ||
    typeof data.workflowRunId !== "string" || !CONSOLE_DECISION_UUID.test(data.workflowRunId)) finish(returnPath(form, { interventionId: request.interventionId }), "error", "terminal-review-failed");
  const path = returnPath(form, { businessId: data.businessId, interventionId: request.interventionId });
  for (const route of ["/dashboard", "/dashboard/needs-you", "/dashboard/workflows", "/dashboard/history", `/dashboard/workflows/${data.workflowRunId}`]) revalidatePath(route);
  finish(path, "message", data.outcome === "already_acknowledged" ? "terminal-review-already-acknowledged" : "terminal-review-acknowledged");
}
