/** Read-only Decisions navigation. Selection never grants execution authority. */
export const CONSOLE_DECISION_PAGE_SIZE = 25;
export const CONSOLE_DECISION_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export type ConsoleDecisionOptions = { workspace?: string; businessId?: string; selectedId?: string; page?: number; status?: string };
export type ConsoleDecisionQuery = { workspace?: string; businessId: string | null; selectedId: string | null; page: number; pageSize: 25; offset: number; status: "open" | "all" | "resolved" | "declined" | "cancelled" };
export function consoleDecisionQuery(options: ConsoleDecisionOptions = {}): ConsoleDecisionQuery {
  const page = options.page ?? 1, status = options.status ?? "open";
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(page * CONSOLE_DECISION_PAGE_SIZE)) throw new Error("Invalid decision page.");
  for (const value of [options.businessId, options.selectedId]) if (value !== undefined && !CONSOLE_DECISION_UUID.test(value)) throw new Error("Invalid decision identity.");
  if (!["open", "all", "resolved", "declined", "cancelled"].includes(status)) throw new Error("Invalid decision status.");
  return { ...(options.workspace ? { workspace: options.workspace } : {}), businessId: options.businessId ?? null, selectedId: options.selectedId ?? null, page, pageSize: CONSOLE_DECISION_PAGE_SIZE, offset: (page - 1) * CONSOLE_DECISION_PAGE_SIZE, status: status as ConsoleDecisionQuery["status"] };
}
export function consoleDecisionOptionsFromSearch(params: Record<string, string | string[] | undefined>): ConsoleDecisionOptions {
  const one = (key: string) => {
    const value = params[key];
    if (Array.isArray(value)) { if (value.length !== 1) throw new Error("Ambiguous decision selection."); return value[0]; }
    return value;
  };
  const workspace = new URLSearchParams(); for (const key of ["quest", "episode", "step", "agent", "sourceArtifact"]) { const value = one(key); if (value !== undefined) { if (!CONSOLE_DECISION_UUID.test(value)) throw new Error("Invalid workspace identity"); workspace.set(key, value); } }
  const page = one("page"), business = one("business"), selected = one("decision");
  return { ...(workspace.size ? { workspace: workspace.toString() } : {}), businessId: business === "" ? undefined : business, selectedId: selected === "" ? undefined : selected,
    page: page === undefined ? undefined : /^\d+$/.test(page) ? Number(page) : Number.NaN, status: one("status") };
}
export function consoleDecisionHref(query: ConsoleDecisionQuery, changes: Partial<Pick<ConsoleDecisionQuery, "businessId" | "selectedId" | "page" | "status">> = {}): string {
  const next = { ...query, ...changes };
  if (changes.businessId !== undefined && changes.businessId !== query.businessId && changes.page === undefined) next.page = 1;
  const validated = consoleDecisionQuery({ businessId: next.businessId ?? undefined, selectedId: next.selectedId ?? undefined, page: next.page, status: next.status });
  const params = new URLSearchParams({ view: "decisions" });
  if (validated.businessId) params.set("business", validated.businessId);
  if (validated.selectedId) params.set("decision", validated.selectedId);
  if (validated.page !== 1) params.set("page", String(validated.page));
  if (validated.status !== "open") params.set("status", validated.status);
  for (const [key, value] of new URLSearchParams(query.workspace)) params.set(key, value);
  return `/dashboard?${params.toString()}`;
}

/** Narrow root Decisions return. Navigation never grants action or record authority. */
export function safeConsoleDecisionReturnPath(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/dashboard?") || value.length > 2048 || /[\\#\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value, "https://console.invalid");
    if (url.origin !== "https://console.invalid" || url.pathname !== "/dashboard" || url.hash || url.searchParams.get("view") !== "decisions") return null;
    const allowed = new Set(["view", "business", "decision", "page", "status", "quest", "episode", "step", "agent", "sourceArtifact"]);
    if ([...url.searchParams.keys()].some(key => !allowed.has(key) || url.searchParams.getAll(key).length !== 1)) return null;
    return consoleDecisionHref(consoleDecisionQuery(consoleDecisionOptionsFromSearch(Object.fromEntries(url.searchParams))));
  } catch { return null; }
}
export type ConsoleDecisionNotice = { tone: "status" | "error"; text: string; terminal: boolean };
/** Fixed response codes only. A terminal success still needs its exact persisted receipt in the UI. */
export function consoleDecisionNotice(kind: "message" | "error", code: string | undefined): ConsoleDecisionNotice | null {
  const messages: Record<string, string> = {
    "terminal-review-acknowledged": "Review recorded. The execution remains stopped and its charges are unchanged.",
    "terminal-review-already-acknowledged": "This stopped-run notice was already reviewed. No additional action was taken.",
    "browser-control-returned": "A return-control response was received. Resumption is unconfirmed here; inspect the current saved browser state.",
    "browser-control-taken": "A take-control response was received. The handoff is unconfirmed here; inspect the current saved browser state.",
    "review-approved": "An approval response was received. Workflow resumption is unconfirmed here; inspect the selected saved state.",
    "review-failed": "A failure-decision response was received. Workflow closure is unconfirmed here; inspect the selected saved state.",
    "simulation-decision-recorded": "A simulation decision response was received. Its outcome is unconfirmed here; inspect the selected saved workflow.",
  };
  const errors: Record<string, string> = {
    "terminal-review-invalid": "This review request is invalid. Reopen the exact saved notice.",
    "terminal-review-conflict": "This notice changed. Review its refreshed state before deciding again.",
    "terminal-review-ineligible": "This saved notice is not eligible for stopped-run acknowledgement.",
    "terminal-review-unavailable": "The stopped-run acknowledgement is unavailable. The saved state must be checked.",
    "terminal-review-failed": "The review result could not be confirmed. Check the saved notice before trying again.",
    "browser-control-not-open": "That browser-control request is no longer open.",
    "browser-control-resume-failed": "The browser workflow could not resume.",
    "invalid-browser-control": "The browser-control request was invalid.",
    "invalid-review-decision": "The review decision was invalid.",
    "review-not-open": "That decision is no longer open.",
    "review-resume-failed": "The workflow could not be resumed.",
    "invalid-simulation-decision": "The simulation decision was invalid.",
    "simulation-decision-failed": "The simulation decision could not be recorded. Recheck the exact workflow before retrying.",
    "simulation-delivery-pending": "Delivery was reported as pending. The decision and delivery state are unconfirmed here; inspect the saved workflow before retrying the same choice.",
  };
  const source = kind === "message" ? messages : errors;
  return code && Object.hasOwn(source, code) ? { tone: kind === "error" ? "error" : "status", text: source[code], terminal: code.startsWith("terminal-review-") } : null;
}

/** Bind return navigation to the submitted notice, then to authoritative Business data when available. */
export function consoleDecisionActionReturnPath(value: unknown, scope: { interventionId: string; businessId?: string }): string | null {
  const safe = safeConsoleDecisionReturnPath(value);
  if (!safe || !CONSOLE_DECISION_UUID.test(scope.interventionId) || scope.businessId !== undefined && !CONSOLE_DECISION_UUID.test(scope.businessId)) return null;
  const params = new URL(safe, "https://console.invalid").searchParams;
  const requestedBusiness = params.get("business") ?? undefined;
  if (requestedBusiness && scope.businessId && requestedBusiness !== scope.businessId) return null;
  // Absence of Business is an explicit aggregate browsing scope, not an invitation to narrow it.
  return consoleDecisionHref(consoleDecisionQuery({ businessId: requestedBusiness, workspace: consoleDecisionOptionsFromSearch(Object.fromEntries(params)).workspace,
    selectedId: scope.interventionId, page: Number(params.get("page") ?? 1), status: params.get("status") ?? undefined }));
}
