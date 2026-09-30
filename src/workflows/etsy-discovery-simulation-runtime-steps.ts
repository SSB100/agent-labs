import { FatalError } from "workflow";
import type { JsonObject } from "../core/contracts";
import { createRuntimeClient } from "../lib/supabase/runtime";
import { executeEtsyDiscoverySimulationWorker } from "../packs/etsy-simulation-worker";
import type { PackWorker } from "../packs/types";
import { assertJsonSchemaValue } from "../workers/schema-validator";
import type { WorkerInvocationContext } from "../workers/types";
import type { EtsySimulationReviewDecision, EtsySimulationRuntimeInput } from "./etsy-discovery-simulation-runtime";

async function transition(input: EtsySimulationRuntimeInput, operation: string, payload: JsonObject = {}) {
  if (input.mode !== "simulation" || input.qualification !== "stage12") throw new FatalError("Explicit Stage 12 simulation required.");
  const { data, error } = await createRuntimeClient().rpc("installed_pack_runtime_transition", {
    p_business_id: input.businessId, p_workflow_run_id: input.coreWorkflowRunId,
    p_runtime_capability: input.runtimeCapability, p_operation: operation, p_payload: payload,
  });
  if (error) throw new Error(`${operation}: ${error.message}`);
  return data as Record<string, unknown>;
}

export async function executeEtsySimulationStage(input: EtsySimulationRuntimeInput, stageKey: string) {
  "use step";
  const prepared = await transition(input, "prepare", { stageKey });
  if (prepared.completed === true) return;
  try {
    return await executeEtsyDiscoverySimulationWorker(prepared.worker as PackWorker, prepared.context as WorkerInvocationContext);
  } catch (error) {
    throw new FatalError(error instanceof Error ? error.message : "Simulated worker failed.");
  }
}

export async function enterEtsySimulationReview(input: EtsySimulationRuntimeInput) {
  "use step";
  const candidate = await transition(input, "output");
  assertJsonSchemaValue(candidate.schema as JsonObject, candidate.output, "Simulated workflow output");
  await transition(input, "simulation_review_requested");
}

export async function finishEtsySimulationReview(input: EtsySimulationRuntimeInput, decision: EtsySimulationReviewDecision) {
  "use step";
  // The database matches this delivery against the previously persisted owner decision.
  return transition(input, "simulation_review_resolved", decision);
}
