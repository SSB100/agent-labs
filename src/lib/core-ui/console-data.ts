import { randomUUID } from "node:crypto";
import type { OwnerUiContext } from "./data";
import type { RunCostData } from "./run-outcome-data";
import type { ConsoleCosts, ConsoleConnections } from "@/components/console/console-overview";
import type { QualificationWorkspace } from "@/connections/contracts";
import { buildDiscoveryIntentFromGoal, buildDiscoveryAnalysisIntent, discoveryGoalBudgetScope, DISCOVERY_GOAL_DEFAULT } from "@/products/discovery-v2-goal";
import { fetchDiscoveryV2ModelQuote, quoteDiscoveryV2, discoveryV2Model } from "@/products/discovery-v2-budget";
import type { QuestQuotePreview } from "./quest-draft";

/** One server-request observation, kept outside UI render calculations. */
export async function loadConsoleObservationTime() { return Date.now(); }

export async function loadConsoleResearchQuote(context: OwnerUiContext, available: boolean): Promise<QuestQuotePreview> {
  if (!available || !context.businesses.length || context.businessesUnavailable) return null;
  try {
    const [director, reviewer] = await Promise.all([fetchDiscoveryV2ModelQuote(discoveryV2Model("plan:1")), fetchDiscoveryV2ModelQuote(discoveryV2Model("review:1"))]);
    const intent = (count: 1 | 2) => buildDiscoveryIntentFromGoal({ id: randomUUID(), businessId: context.businesses[0].id, goal: DISCOVERY_GOAL_DEFAULT, maximumMicrousd: 1_000_000, maximumCollections: count });
    const one = quoteDiscoveryV2(discoveryGoalBudgetScope(intent(1)), { director, reviewer });
    const two = quoteDiscoveryV2(discoveryGoalBudgetScope(intent(2)), { director, reviewer });
    const analysis = quoteDiscoveryV2(discoveryGoalBudgetScope(buildDiscoveryAnalysisIntent({ prior: intent(1), id: randomUUID(), maximumMicrousd: 1_000_000 })), { director, reviewer });
    return { one: one.maximumEstimateMicrousd, two: two.maximumEstimateMicrousd, analysis: analysis.maximumEstimateMicrousd, verifiedAt: one.verifiedAt };
  } catch { return null; }
}
export function consoleCostSummary(data: RunCostData | null, scopeLabel: string, workflowRunId?: string): ConsoleCosts {
  if (!data) return { status: "not_loaded", reason: "No selected run ledger" };
  const ledger = data.costs.calls;
  if (ledger.status !== "ready") return { status: "unavailable", reason: "Complete cost records could not be verified" };
  const ids = new Map<string, number>();
  ledger.records.forEach(call => { if (call.providerRequestId) ids.set(call.providerRequestId, (ids.get(call.providerRequestId) ?? 0) + 1); });
  const known = ledger.records.filter(call => call.providerRequestId && ids.get(call.providerRequestId) === 1 && typeof call.reportedUsd === "number" && Number.isFinite(call.reportedUsd) && call.reportedUsd >= 0);
  const total = known.reduce((sum, call) => sum + call.reportedUsd!, 0);
  return { status: "ready", recordedMicrousd: known.length ? Math.round(total * 1e6) : null, uncertainCount: ledger.records.length - known.length, scopeLabel: `${scopeLabel} · ${data.costs.source} ledger only`, workflowRunId };
}
/** Projects only the bounded R11 registry. Legacy setup requests are not connection health. */
export function consoleConnectionSummary(data: QualificationWorkspace | null, businessName: string, now: number): ConsoleConnections {
  if (!data || data.unavailable || !Number.isFinite(now)) return { status: "unavailable", reason: "Qualified connection records could not be checked" };
  if (new Set(data.connections.map(item => item.provider)).size !== data.connections.length) return { status: "unavailable", reason: "Qualified connection records are inconsistent" };
  const href = `/dashboard/connections?business=${encodeURIComponent(data.businessId)}`;
  return { status: "ready", items: (["etsy", "printful"] as const).map(provider => {
    const account = data.connections.find(item => item.provider === provider);
    const base = { id: provider, name: provider === "etsy" ? "Etsy" : "Printful", href, verifiedAt: account?.verifiedAt ?? null };
    if (!account) return { ...base, state: "not_connected", detail: `${businessName} · No qualified store binding recorded` };
    const unexpired = Number.isFinite(Date.parse(account.expiresAt)) && Date.parse(account.expiresAt) > now;
    const verified = Number.isFinite(Date.parse(account.verifiedAt)) && Date.parse(account.verifiedAt) <= now;
    const tokenExpired = account.status === "token_expired" || (account.tokenExpiresAt !== undefined && Date.parse(account.tokenExpiresAt) <= now);
    const lazy = provider === "etsy" && data.configured && unexpired && verified && ["connected", "token_expired"].includes(account.status) && data.readWindows?.some(window =>
      window.connectionId === account.id && window.bindingRevision === account.revision && window.mode === "lazy" && window.state === "available" && window.configured &&
      Number.isFinite(Date.parse(window.expiresAt)) && Date.parse(window.expiresAt) > now && window.readsDispatched < window.maxReads && window.refreshesDispatched < window.maxRefreshes);
    if (tokenExpired && lazy) return { ...base, state: "needs_attention", label: "Token expired · refresh approved", detail: `${account.label} · Lazy refresh is available on the next authorized own-shop read` };
    if (account.status === "connected" && unexpired && verified && data.configured && !tokenExpired) return { ...base, state: "verified", detail: `${account.label} · ${account.permittedOperations.join(", ")}; no selling authority` };
    const reason = !unexpired ? "Local access cutoff expired" : account.status === "revoked" ? "Access revoked" : account.status === "credential_changed" ? "Configured credential changed" : !data.configured ? "Connection runtime unavailable" : tokenExpired ? "Token expired; no eligible lazy-refresh window in this loaded snapshot" : ["refresh_uncertain", "refresh_unverified"].includes(account.status) ? "Refresh outcome needs verification" : "Connection needs verification";
    return { ...base, state: "needs_attention", detail: `${account.label} · ${reason}` };
  }) };
}
