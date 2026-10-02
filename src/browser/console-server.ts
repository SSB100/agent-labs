import "server-only";
import type { OwnerUiContext } from "@/lib/core-ui/data";
import { CONSOLE_BROWSER_UUID, consoleBrowserSummary, type ConsoleBrowserWorkspace } from "./console-view";

const SESSION_SELECT = "id,business_id,workflow_run_id,status,updated_at";
const RUN_SELECT = "id,business_id,workflow_definition_id";
const SESSION_LIMIT = 40;

/** Read-only, owner-context input. Exact selected runs are queried independently
 * of the bounded selector list, so older records cannot silently select another. */
export async function loadConsoleBrowserWorkspace(context: OwnerUiContext, selection: { businessId?: string; workflowRunId?: string } = {}): Promise<ConsoleBrowserWorkspace> {
  const businesses = context.businesses.map(({ id, name }) => ({ id, name }));
  const data: ConsoleBrowserWorkspace = { status: "ready", businesses, selectedBusinessId: selection.businessId ?? null,
    selectedRunId: selection.workflowRunId ?? null, sessions: [], selectedSession: null, truncated: false };
  if (context.businessesUnavailable) return { ...data, status: "unavailable" };
  if ((selection.businessId && (!CONSOLE_BROWSER_UUID.test(selection.businessId) || !businesses.some(item => item.id === selection.businessId))) ||
      (selection.workflowRunId && (!selection.businessId || !CONSOLE_BROWSER_UUID.test(selection.workflowRunId)))) return { ...data, status: "invalid_selection" };
  if (!selection.businessId) return data;
  try {
    const result = await context.supabase.from("browser_sessions").select(SESSION_SELECT).eq("business_id", selection.businessId).order("updated_at", { ascending: false }).limit(SESSION_LIMIT + 1);
    if (result.error || !Array.isArray(result.data)) return { ...data, status: "unavailable" };
    const sessions = result.data.slice(0, SESSION_LIMIT);
    data.truncated = result.data.length > SESSION_LIMIT;
    if (selection.workflowRunId && !sessions.some(item => item.workflow_run_id === selection.workflowRunId)) {
      const selected = await context.supabase.from("browser_sessions").select(SESSION_SELECT).eq("business_id", selection.businessId).eq("workflow_run_id", selection.workflowRunId).maybeSingle();
      if (selected.error) return { ...data, status: "unavailable" };
      if (selected.data) sessions.push(selected.data);
    }
    const runIds = [...new Set([...sessions.map(item => item.workflow_run_id), ...(selection.workflowRunId ? [selection.workflowRunId] : [])])];
    if (!runIds.length) return data;
    const runs = await context.supabase.from("workflow_runs").select(RUN_SELECT).eq("business_id", selection.businessId).in("id", runIds);
    if (runs.error || !Array.isArray(runs.data)) return { ...data, status: "unavailable" };
    if (selection.workflowRunId && !runs.data.some(item => item.id === selection.workflowRunId && item.business_id === selection.businessId)) return { ...data, status: "invalid_selection" };
    for (const session of sessions) {
      if (session.business_id !== selection.businessId) return { ...data, status: "unavailable", sessions: [] };
      const summary = consoleBrowserSummary(session, runs.data.find(item => item.id === session.workflow_run_id));
      if (!summary) return { ...data, status: "unavailable", sessions: [] };
      data.sessions.push(summary);
    }
    data.selectedSession = data.sessions.find(item => item.workflowRunId === selection.workflowRunId) ?? null;
    return data;
  } catch { return { ...data, status: "unavailable", sessions: [], selectedSession: null }; }
}
