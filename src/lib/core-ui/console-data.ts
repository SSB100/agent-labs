import { randomUUID } from "node:crypto";
import type { OwnerUiContext } from "./data";
import type { RunCostData } from "./run-outcome-data";
import type { ConsoleCosts, ConsoleConnections } from "@/components/console/console-overview";
import type { AccountWorkspace } from "@/accounts/contracts";
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
  return { status: "ready", recordedMicrousd: known.length ? Math.round(total * 1e6) : null, uncertainCount: ledger.records.length - known.length, scopeLabel, workflowRunId };
}
export function consoleConnectionSummary(data: AccountWorkspace | null, businessName: string, now: number): ConsoleConnections {
  if (!data || data.unavailable) return { status: "unavailable", reason: "Connection records could not be checked" };
  return { status: "ready", items: (["etsy", "printful"] as const).map(provider => {
    const account = data.accounts.find(item => item.provider === provider);
    const expired = account?.expiresAt ? Date.parse(account.expiresAt) <= now : false;
    return { id: provider, name: provider === "etsy" ? "Etsy" : "Printful", state: account?.status === "connected" && !expired ? "verified" : account ? "needs_attention" : "not_connected", detail: `${businessName} · ${account?.status === "connected" && !expired ? "Saved connection; execution has separate approval" : "No current verified connection"}`, verifiedAt: account?.verifiedAt ?? null };
  }) };
}
