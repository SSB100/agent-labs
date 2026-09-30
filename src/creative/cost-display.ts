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

export function summarizeCreativeCosts(costs: CreativeCostRecord[]) {
  return {
    recordedCalls: costs.length,
    reportedMicrousd: costs.reduce((sum, cost) => sum + (cost.reported_microusd ?? 0), 0),
    uncertainCalls: costs.filter(cost => cost.reported_microusd === null).length,
    uncertainReservedMicrousd: costs.reduce((sum, cost) => sum + (cost.reported_microusd === null ? cost.reserved_microusd ?? 0 : 0), 0),
    // Match the database's conservative budget accounting, never reservation + reported charge.
    committedMicrousd: costs.reduce((sum, cost) => sum + Math.max(cost.reserved_microusd ?? 0, cost.reported_microusd ?? 0), 0),
    hasMissingReservation: costs.some(cost => cost.reserved_microusd === null),
  };
}

export function creativeCostStatus(cost: CreativeCostRecord, capabilityExpired: boolean): string {
  if (cost.settled_at === null) return capabilityExpired
    ? "Receipt missing after run expiry; charge unknown; reservation retained"
    : "Receipt pending or missing; charge unknown; reservation retained";
  return cost.reported_microusd === null ? "Receipt has no reported cost; charge unknown; reservation retained" : "Reported provider charge";
}
