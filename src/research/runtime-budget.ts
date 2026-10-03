import { createRuntimeClient } from "../lib/supabase/runtime";
import type { ResearchBudgetLedger } from "./budget";
import { modelDispatchAdmission } from "../lib/admission-runtime";

type ResearchRuntimeScope = { businessId: string; coreWorkflowRunId: string; runtimeCapability: string };
export function runtimeResearchBudget(input: ResearchRuntimeScope): ResearchBudgetLedger {
  input = structuredClone(input);
  const scope = { p_workflow_run_id: input.coreWorkflowRunId, p_business_id: input.businessId, p_runtime_capability: input.runtimeCapability };
  return {
    admissionFor(reservation) {
      const quote = reservation.estimate.quote;
      const modelId = quote && typeof quote === "object" && !Array.isArray(quote) ? quote.modelId : null;
      return modelDispatchAdmission(input, {
        operationKey: reservation.attemptKey.startsWith("search:") ? "research.search" : "research.model",
        requestHash: reservation.requestHash, callKey: reservation.attemptKey, reservedMicrousd: reservation.reservedMicrousd,
        providerModelId: typeof modelId === "string" ? modelId : "", accounting: { kind: "research", callKey: reservation.attemptKey },
        dataClasses: ["business_context", "public_evidence"],
      });
    },
    async reserve(reservation) {
      const result = await createRuntimeClient().rpc("reserve_product_research_cost", { ...scope, p_attempt_key: reservation.attemptKey,
        p_reserved_microusd: reservation.reservedMicrousd, p_request_hash: reservation.requestHash, p_estimate: reservation.estimate });
      if (result.error) throw new Error(`Research budget reservation: ${result.error.message}`);
      return result.data as { shouldCall: boolean; totalReservedMicrousd: number };
    },
    async settle(attemptKey, reportedMicrousd, providerRequestId) {
      const result = await createRuntimeClient().rpc("record_product_research_cost", { ...scope, p_attempt_key: attemptKey,
        p_reported_microusd: reportedMicrousd, p_provider_request_id: providerRequestId });
      if (result.error) throw new Error(`Research cost settlement: ${result.error.message}`);
    },
  };
}
