import type { OwnerUiContext } from "./data";
import type { WorkflowDefinitionRecord, WorkflowRunRecord } from "./workflows";
import {
  RUN_OUTCOME_COST_SELECTS as selects,
  creativeOutcomeCosts, modelOutcomeCosts, researchOutcomeCosts,
  type CreativeOutcomeApproval, type CreativeOutcomeReservation, type CreativeOutcomeRun, type CreativeOutcomeSettlement,
  type ModelOutcomeInvocation, type OutcomeRecords, type ResearchOutcomeReservation, type ResearchOutcomeSettlement,
  type RunOutcomeCosts,
} from "./run-outcome";

function complete<T>(result: { data: unknown; error: unknown; count: number | null }, limit = 1000): OutcomeRecords<T> {
  return !result.error && Array.isArray(result.data) && result.count === result.data.length && result.count <= limit
    ? { status: "ready", records: result.data as T[] } : { status: "unavailable" };
}
export type RunCostData = {
  costs: RunOutcomeCosts;
  creativeRuns?: OutcomeRecords<CreativeOutcomeRun>;
  creativeApprovals?: OutcomeRecords<CreativeOutcomeApproval>;
};
/** Owner-scoped read only. Failure/truncation never becomes an empty ledger. */
export async function loadRunCostData(context: OwnerUiContext, run: WorkflowRunRecord, definition?: WorkflowDefinitionRecord | null): Promise<RunCostData> {
  const key = definition?.workflow_key ?? "";
  const source = key.startsWith("product.discovery-v2.") ? "research" : key === "etsy.creative-pipeline" ? "creative" : "model";
  const unavailable: RunOutcomeCosts = { businessId: run.business_id, workflowRunId: run.id, source, calls: { status: "unavailable" } };
  if (!context.ownerDirectoryPaged && !context.businesses.some(business => business.id === run.business_id)) return { costs: unavailable };
  const client = context.supabase;
  try {
    if (source === "research") {
      const spec = selects.researchReservations;
      const reservations = complete<ResearchOutcomeReservation>(await client.from(spec.table).select(spec.select, { count: "exact" }).eq("business_id", run.business_id).eq("workflow_run_id", run.id).limit(1001));
      if (reservations.status !== "ready") return { costs: unavailable };
      const ids = reservations.records.map(row => row.id);
      const settlementSpec = selects.researchSettlements;
      const settlements = ids.length ? complete<ResearchOutcomeSettlement>(await client.from(settlementSpec.table).select(settlementSpec.select, { count: "exact" }).eq("business_id", run.business_id).in("reservation_id", ids).limit(1001)) : { status: "ready" as const, records: [] };
      return { costs: researchOutcomeCosts(run, reservations, settlements) };
    }
    if (source === "creative") {
      const spec = selects.creativeRuns;
      const creativeRuns = complete<CreativeOutcomeRun>(await client.from(spec.table).select(spec.select, { count: "exact" }).eq("business_id", run.business_id).eq("workflow_run_id", run.id).limit(2), 1);
      const creativeRun = creativeRuns.status === "ready" && creativeRuns.records.length === 1 ? creativeRuns.records[0] : null;
      if (!creativeRun || creativeRun.business_id !== run.business_id || creativeRun.workflow_run_id !== run.id) return { costs: unavailable, creativeRuns };
      const [reserved, settled, approvals] = await Promise.all([
        client.from(selects.creativeReservations.table).select(selects.creativeReservations.select, { count: "exact" }).eq("business_id", run.business_id).eq("creative_run_id", creativeRun.id).limit(1001),
        client.from(selects.creativeSettlements.table).select(selects.creativeSettlements.select, { count: "exact" }).eq("business_id", run.business_id).eq("creative_run_id", creativeRun.id).limit(1001),
        client.from(selects.creativeApprovals.table).select(selects.creativeApprovals.select, { count: "exact" }).eq("business_id", run.business_id).eq("id", creativeRun.approval_id).limit(2),
      ]);
      return { creativeRuns, creativeApprovals: complete<CreativeOutcomeApproval>(approvals, 1), costs: creativeOutcomeCosts(run, creativeRun, complete<CreativeOutcomeReservation>(reserved), complete<CreativeOutcomeSettlement>(settled)) };
    }
    const spec = selects.modelInvocations;
    return { costs: modelOutcomeCosts(run, complete<ModelOutcomeInvocation>(await client.from(spec.table).select(spec.select, { count: "exact" }).eq("business_id", run.business_id).eq("workflow_run_id", run.id).limit(1001))) };
  } catch { return { costs: unavailable }; }
}
