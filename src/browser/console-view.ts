import type { WatchSummary } from "./watch/contracts";
export const CONSOLE_BROWSER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type ConsoleCentreMode = "overview" | "browser";
export const CONSOLE_BROWSER_STATUSES = ["reserved", "launching", "live", "human_control", "returning", "released", "failed"] as const;
export type ConsoleBrowserStatus = typeof CONSOLE_BROWSER_STATUSES[number] | "unknown";
export type ConsoleBrowserSummary = {
  id: string;
  businessId: string;
  workflowRunId: string;
  label: string;
  savedStatus: ConsoleBrowserStatus;
  updatedAt: string | null;
};
export type ConsoleBrowserWorkspace = {
  viewer?: WatchSummary;
  viewerUnavailable?: boolean;
  workspaceSearch?: string;
  status: "ready" | "unavailable" | "invalid_selection";
  businesses: { id: string; name: string }[];
  selectedBusinessId: string | null;
  selectedRunId: string | null;
  sessions: ConsoleBrowserSummary[];
  selectedSession: ConsoleBrowserSummary | null;
  truncated: boolean;
};
export const CONSOLE_BROWSER_UNAVAILABLE = "Live viewing unavailable for this session";

export function consoleCentreMode(value: unknown): ConsoleCentreMode {
  return value === "browser" ? "browser" : "overview";
}

export function consoleBrowserHref(mode: ConsoleCentreMode, businessId?: string | null, workflowRunId?: string | null) {
  const query = new URLSearchParams({ view: "overview", centre: consoleCentreMode(mode) });
  if (businessId && CONSOLE_BROWSER_UUID.test(businessId)) {
    query.set("business", businessId);
    if (workflowRunId && CONSOLE_BROWSER_UUID.test(workflowRunId)) query.set("browserRun", workflowRunId);
  }
  return `/dashboard?${query.toString()}`;
}

/** The protected root Work pane shows saved records without the legacy live workspace. */
export function consoleBrowserWorkflowHref(session: ConsoleBrowserSummary): string | null {
  if (![session.businessId, session.workflowRunId].every(value => typeof value === "string" && CONSOLE_BROWSER_UUID.test(value))) return null;
  return `/dashboard?${new URLSearchParams({ view: "work", run: session.workflowRunId, business: session.businessId })}`;
}

export function consoleBrowserStatus(value: unknown): ConsoleBrowserStatus {
  return typeof value === "string" && (CONSOLE_BROWSER_STATUSES as readonly string[]).includes(value) ? value as ConsoleBrowserStatus : "unknown";
}

export function consoleBrowserUpdatedAt(value: unknown): string | null {
  // Reject free-form text and canonicalize the database timestamp before display.
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

function browserRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Metadata projection only. Saved lifecycle state is never a viewing grant.
 * No page content, URLs, profile/provider IDs, private metadata or endpoints. */
export function consoleBrowserSummary(rawSession: unknown, rawRun: unknown): ConsoleBrowserSummary | null {
  const session = browserRecord(rawSession), run = browserRecord(rawRun);
  if (!session || !run || ![session.id, session.business_id, session.workflow_run_id].every(value => typeof value === "string" && CONSOLE_BROWSER_UUID.test(value)) ||
      run.id !== session.workflow_run_id || run.business_id !== session.business_id) return null;
  const label = run.workflow_definition_id === "00000000-0000-4000-8000-000000000801" ? "Browser qualification"
    : run.workflow_definition_id === "00000000-0000-4000-8000-000000000902" ? "Browser planner qualification" : "Browser workflow";
  return {
    id: String(session.id), businessId: String(session.business_id), workflowRunId: String(session.workflow_run_id), label,
    savedStatus: consoleBrowserStatus(session.status), updatedAt: consoleBrowserUpdatedAt(session.updated_at),
  };
}
