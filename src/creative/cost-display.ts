export type CreativeCostReservationRecord = { creative_run_id: string; call_key: string; reserved_microusd: number; created_at: string };
export type CreativeCostSettlementRecord = { creative_run_id: string; call_key: string; reported_microusd: number | null; provider_request_id: string | null; created_at: string };
export type CreativeCostRecord = CreativeCostSettlementRecord & { reserved_microusd: number | null; settled_at: string | null };

const key = (row: { creative_run_id: string; call_key: string }) => `${row.creative_run_id}:${row.call_key}`;

/** A reserved attempt remains visible even if a crash or capability expiry prevented its receipt. */
export function mergeCreativeCosts(reservations: CreativeCostReservationRecord[], settlements: CreativeCostSettlementRecord[]): CreativeCostRecord[] {
  const receipts = new Map(settlements.map(row => [key(row), row]));
  const costs: CreativeCostRecord[] = reservations.map(reservation => {
    const receipt = receipts.get(key(reservation));
    receipts.delete(key(reservation));
    return { ...reservation, reported_microusd: receipt?.reported_microusd ?? null,
      provider_request_id: receipt?.provider_request_id ?? null, settled_at: receipt?.created_at ?? null };
  });
  // Separate read snapshots can observe a new receipt after the reservation query. Preserve it,
  // without inventing a zero reservation; the next refresh can fill in its original estimate.
  for (const receipt of receipts.values()) costs.push({ ...receipt, reserved_microusd: null, settled_at: receipt.created_at });
  return costs.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}

/** A saved amount is a reported charge only when it has a valid provider request identity.
 * Keep the original receipt untouched: an unlinked numeric amount may only be an estimate.
 * Match Work's creativeOutcomeCosts qualification, including confirmed zero-cost receipts.
 */
export function qualifyCreativeCost(cost: Pick<CreativeCostRecord, "reported_microusd" | "provider_request_id">) {
  const saved = typeof cost.reported_microusd === "number" && Number.isFinite(cost.reported_microusd) ? cost.reported_microusd : null;
  const providerRequestId = typeof cost.provider_request_id === "string" && cost.provider_request_id.trim() ? cost.provider_request_id.trim() : null;
  const reportedMicrousd = providerRequestId && saved !== null && Number.isSafeInteger(saved) && saved >= 0 ? saved : null;
  return { reportedMicrousd, unverifiedMicrousd: reportedMicrousd === null ? saved : null, providerRequestId };
}

export const CREATIVE_COST_COMMITMENT_EXPLANATION = "This uses the larger of each reservation or saved amount, not both; unverified saved amounts are retained conservatively. It is not an additional charge.";

const exposure = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
const hasReservation = (cost: CreativeCostRecord) => typeof cost.reserved_microusd === "number" && Number.isFinite(cost.reserved_microusd) && cost.reserved_microusd >= 0;

export function summarizeCreativeCosts(costs: CreativeCostRecord[]) {
  return {
    recordedCalls: costs.length,
    reportedMicrousd: costs.reduce((sum, cost) => sum + (qualifyCreativeCost(cost).reportedMicrousd ?? 0), 0),
    uncertainCalls: costs.filter(cost => qualifyCreativeCost(cost).reportedMicrousd === null).length,
    uncertainReservedMicrousd: costs.reduce((sum, cost) => sum + (qualifyCreativeCost(cost).reportedMicrousd === null ? exposure(cost.reserved_microusd) : 0), 0),
    // Preserve the original saved amount in conservative exposure, even when unverified.
    // Never count both the reservation and the saved amount for a single attempt.
    committedMicrousd: costs.reduce((sum, cost) => sum + Math.max(exposure(cost.reserved_microusd), exposure(cost.reported_microusd)), 0),
    hasMissingReservation: costs.some(cost => !hasReservation(cost)),
  };
}

export function creativeCostStatus(cost: CreativeCostRecord, capabilityExpired: boolean): string {
  const qualified = qualifyCreativeCost(cost);
  if (qualified.reportedMicrousd !== null) return "Reported provider charge";
  if (!cost.settled_at) return capabilityExpired
    ? "Receipt missing after run expiry; charge unknown; reservation retained"
    : "Receipt pending or missing; charge unknown; reservation retained";
  return !qualified.providerRequestId ? "Receipt has no valid provider request identity; charge unknown; reservation retained"
    : cost.reported_microusd == null ? "Receipt has no reported cost; charge unknown; reservation retained"
    : "Receipt has no valid reported cost; charge unknown; reservation retained";
}
