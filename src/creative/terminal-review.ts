/** Presentation and input checks only. The owner-session RPC rechecks saved authority. */
export const TERMINAL_CREATIVE_REVIEW_VERSION = "terminal-creative-review-acknowledgement-v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
type Json = Record<string, unknown>;
const object = (value: unknown): value is Json => Boolean(value) && typeof value === "object" && !Array.isArray(value);
type Notice = { id: string; business_id: string; workflow_run_id: string | null; intervention_type: string; status: string; resolution: Json; resolved_at: string | null; updated_at: string; action_intent_id?: string | null };
type Run = { id: string; business_id: string; workflow_definition_id: string; status: string; completed_at: string | null; input: Json; state: Json };
export type TerminalCreativeRun = { id: string; business_id: string; workflow_run_id: string; approval_id: string };
export type TerminalReviewState = { business_id?: string; workflow_run_id: string; status: string; completed_at?: string | null };
export type TerminalReviewScope = { intervention: Notice; run: Run | null; creativeRunId: string | null; ownerUserId: string };
export function isTerminalReviewTimestamp(value: string): boolean {
  return TIMESTAMP.test(value) && Number.isFinite(Date.parse(value));
}
export function parseTerminalReviewRequest(form: FormData): { interventionId: string; expectedUpdatedAt: string } | null {
  const interventionId = form.get("interventionId"), expectedUpdatedAt = form.get("expectedUpdatedAt");
  if (typeof interventionId !== "string" || !UUID.test(interventionId) || typeof expectedUpdatedAt !== "string" || !isTerminalReviewTimestamp(expectedUpdatedAt)) return null;
  // Never round-trip the concurrency token through Date: PostgreSQL preserves microseconds.
  return { interventionId, expectedUpdatedAt };
}
function timestampIdentity(value: string): string {
  // Date supplies only the millisecond/timezone part; retain the remaining three digits.
  const fraction = /\.(\d{1,6})/.exec(value)?.[1] ?? "";
  return `${Date.parse(value)}:${fraction.padEnd(6, "0").slice(3)}`;
}
const RESOLUTION_KEYS = ["version", "decision", "actorUserId", "businessId", "workflowRunId", "creativeRunId", "interventionId", "expectedUpdatedAt", "acknowledgedAt", "executionResumed", "newSpendAuthorized", "costsReconciled"];
export function isTerminalCreativeReviewAcknowledgement({ intervention: i, run, creativeRunId, ownerUserId }: TerminalReviewScope): boolean {
  const r = i.resolution;
  if (!object(r) || !UUID.test(ownerUserId)) return false;
  return Boolean(run && creativeRunId && i.status === "resolved" && i.intervention_type === "creative_review" &&
    i.business_id === run.business_id && i.workflow_run_id === run.id && i.resolved_at && isTerminalReviewTimestamp(i.resolved_at) &&
    Object.keys(r).length === RESOLUTION_KEYS.length && RESOLUTION_KEYS.every(key => Object.hasOwn(r, key)) &&
    r.version === TERMINAL_CREATIVE_REVIEW_VERSION && r.decision === "acknowledge" &&
    r.actorUserId === ownerUserId && r.businessId === i.business_id && r.workflowRunId === run.id &&
    r.creativeRunId === creativeRunId && r.interventionId === i.id &&
    typeof r.acknowledgedAt === "string" && isTerminalReviewTimestamp(r.acknowledgedAt) && timestampIdentity(r.acknowledgedAt) === timestampIdentity(i.resolved_at) &&
    typeof r.expectedUpdatedAt === "string" && isTerminalReviewTimestamp(r.expectedUpdatedAt) &&
    r.executionResumed === false && r.newSpendAuthorized === false && r.costsReconciled === false);
}
export function canAcknowledgeTerminalCreativeReview(input: {
  intervention: Notice; run: Run | null; definition: { id: string; workflow_key: string; version: string } | null;
  creativeRun: TerminalCreativeRun | null; expectedNoticeId: string | null; complete: boolean;
  stages: readonly TerminalReviewState[]; workers: readonly TerminalReviewState[]; tasks: readonly TerminalReviewState[]; actionIntents: readonly TerminalReviewState[];
}): boolean {
  const { intervention: i, run, definition, creativeRun: c } = input;
  if (!input.complete || !run || !definition || !c || !object(i.resolution) || !object(run.input) || !object(run.state) || i.status !== "open" || i.intervention_type !== "creative_review" ||
    i.action_intent_id != null || i.resolved_at !== null || Object.keys(i.resolution).length !== 0 || !isTerminalReviewTimestamp(i.updated_at) ||
    i.id !== input.expectedNoticeId || i.business_id !== run.business_id || i.workflow_run_id !== run.id ||
    c.business_id !== run.business_id || c.workflow_run_id !== run.id || run.input.creativeRunId !== c.id || run.input.approvalId !== c.approval_id ||
    definition.id !== run.workflow_definition_id || definition.workflow_key !== "etsy.creative-pipeline" || definition.version !== "1.0.0" ||
    run.status !== "needs_owner" || !run.completed_at || run.state.productionReady !== false || run.state.publicationAllowed !== false || !input.stages.length) return false;
  const matches = (row: TerminalReviewState, statuses: string[], timed = false) => row.workflow_run_id === run.id &&
    (row.business_id === undefined || row.business_id === run.business_id) && statuses.includes(row.status) && (!timed || Boolean(row.completed_at));
  return input.stages.every(row => matches(row, ["completed", "failed", "skipped"], true)) &&
    input.workers.every(row => matches(row, ["completed", "failed", "cancelled"], true)) &&
    input.tasks.every(row => matches(row, ["completed", "failed", "cancelled"])) &&
    input.actionIntents.every(row => matches(row, ["completed", "rejected", "expired", "failed"]));
}
