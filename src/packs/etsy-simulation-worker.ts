import type { JsonObject } from "../core/contracts";
import { buildWorkerModelMessages } from "../models/prompt";
import { runModelRoute } from "../models/router";
import type { ModelProviderAdapter, StructuredModelRequest, ModelProviderResponse, ToolQualificationResult } from "../models/types";
import { ModelProviderError } from "../models/types";
import { executeWorkerPack, validateWorkerInvocationContext } from "../workers/runtime";
import type { WorkerInvocationContext } from "../workers/types";
import { validateEtsyDiscoveryStageOutput } from "./etsy-discovery";
import type { PackWorker } from "./types";

const stageByWorker: Record<string, string> = {
  "etsy.market-researcher": "research", "etsy.product-strategist": "strategy", "etsy.reviewer": "review",
};

function cited(context: WorkerInvocationContext, knowledgeKey: string, guidelineId: string): JsonObject {
  if (!context.taskContract.requiredKnowledge.includes(knowledgeKey)) throw new Error("Mock worker requested unscoped knowledge.");
  const knowledge = context.inputArtifacts.find(artifact => artifact.metadata.knowledgeKey === knowledgeKey);
  const guideline = (knowledge?.content.guidelines as JsonObject[] | undefined)?.find(entry => entry.id === guidelineId);
  if (!guideline) throw new Error(`Scoped guideline missing: ${knowledgeKey}:${guidelineId}.`);
  return { knowledgeKey, guidelineId, statement: guideline.statement, sourceUrl: guideline.sourceUrl, kind: guideline.kind };
}

/** Models are mocked, but outputs are computed from the actual bounded prompt, never a hidden global knowledge catalog. */
export class EtsyDiscoverySimulationAdapter implements ModelProviderAdapter {
  readonly providerType = "mock" as const;
  readonly requests: StructuredModelRequest[] = [];
  constructor(private readonly options: { failPrimary?: boolean } = {}) {}

  async qualifyToolUse(): Promise<ToolQualificationResult> { throw new Error("Simulation does not qualify tool use."); }

  async invokeStructured(request: StructuredModelRequest): Promise<ModelProviderResponse> {
    this.requests.push(structuredClone(request));
    if (this.options.failPrimary && request.requestMetadata?.attempt === 1) {
      throw new ModelProviderError("provider_unavailable", "Simulated primary provider interruption.", true, { mode: "simulation" });
    }
    const stageKey = stageByWorker[String(request.requestMetadata?.workerKey)];
    if (!stageKey) throw new Error("Unknown simulated worker role.");
    const prompt = request.messages.find(message => message.role === "user");
    if (!prompt || typeof prompt.content !== "string") throw new Error("Scoped worker prompt is missing.");
    const context = JSON.parse(prompt.content) as WorkerInvocationContext;
    const stageInput = context.inputArtifacts.find(artifact => artifact.artifactType === "pack.stage-input")?.content;
    if (!stageInput) throw new Error("Scoped stage input is missing.");
    const citation = (key: string, id: string) => cited(context, key, id);
    let output: JsonObject;
    if (stageKey === "research") {
      output = { mode: "simulation", concept: structuredClone(stageInput.concept), demandStatus: "unvalidated", observations: [],
        knowledgeCitations: [citation("etsy.selling", "production-partner-disclosure"), citation("etsy.current-policy", "original-design-eligibility"), citation("product.research", "hypotheses-not-sales")],
        evidenceGaps: ["live_demand_missing", "competition_observations_missing", "product_costs_unverified", "print_files_unverified"], stopReason: "scoped_research_complete" };
    } else if (stageKey === "strategy") {
      const concept = stageInput.concept as JsonObject;
      output = { mode: "simulation", research: structuredClone(stageInput),
        hypothesis: { classification: "unvalidated_hypothesis", conceptName: concept.name, audience: concept.audience },
        requiredChecks: ["verify_original_design_and_rights", "verify_production_partner_disclosure", "disclose_ai_if_used", "verify_product_print_specs", "calculate_deterministic_costs", "collect_live_demand_evidence", "define_measurement_plan"],
        knowledgeCitations: [citation("etsy.current-policy", "ai-disclosure"), citation("pod.production", "per-product-print-files"), citation("product.research", "evidence-record"), citation("social.marketing", "engagement-not-sales")], stopReason: "hypothesis_prepared" };
    } else {
      const concept = (stageInput.research as JsonObject).concept as JsonObject;
      const blocked = concept.originalDesign !== true || concept.rightsStatus !== "confirmed" || concept.productionPartnerDisclosed !== true;
      const reasons = ["live_demand_missing"];
      if (concept.originalDesign !== true) reasons.push("original_design_unverified");
      if (concept.rightsStatus !== "confirmed") reasons.push("rights_unclear");
      if (concept.productionPartnerDisclosed !== true) reasons.push("partner_disclosure_missing");
      if (concept.printSpecStatus !== "verified") reasons.push("print_specs_unverified");
      if (concept.usesAi === true) reasons.push("ai_disclosure_required");
      output = { mode: "simulation", strategy: structuredClone(stageInput), outcome: blocked ? "blocked" : "needs_evidence",
        publicationAllowed: false, liveQualification: false, reasons,
        knowledgeCitations: [citation("etsy.current-policy", "original-design-eligibility"), citation("etsy.current-policy", "ip-rights-required"), citation("pod.production", "per-product-print-files"), citation("product.research", "hypotheses-not-sales")], stopReason: "review_complete" };
    }
    return { output, provider: "simulation.mock", providerModelId: request.model.providerModelId,
      providerRequestId: `simulation:${context.taskContract.id}:${request.model.modelKey}:${this.requests.length}`,
      latencyMs: 0, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0,
        reasoningTokens: 0, reportedCostUsd: 0, estimatedCostUsd: 0 },
      metadata: { mode: "simulation", providerType: "mock", liveProviderExecuted: false, qualificationEvaluated: false } };
  }
}

export async function executeEtsyDiscoverySimulationWorker(worker: PackWorker, context: WorkerInvocationContext,
  adapter = new EtsyDiscoverySimulationAdapter()) {
  if (worker.execution.kind !== "model_router" || !stageByWorker[worker.manifest.worker.workerKey] ||
    worker.manifest.modelRequirements.qualificationScope !== "simulation_only" ||
    worker.manifest.capabilityPolicy.allowed.length > 0 || context.taskContract.permittedCapabilities.length > 0) {
    throw new Error("A capability-free Etsy simulation worker is required.");
  }
  validateWorkerInvocationContext(worker.manifest, context);
  const route = await runModelRoute({ adapter, routeKey: worker.execution.routeKey,
    outputSchema: worker.manifest.outputSchema, schemaName: "etsy_discovery_simulation",
    messages: buildWorkerModelMessages(worker.manifest, context),
    requestMetadata: { workerKey: worker.manifest.worker.workerKey, taskContractId: context.taskContract.id, mode: "simulation" } });
  const result = executeWorkerPack(worker.manifest, () => route.output, context);
  validateEtsyDiscoveryStageOutput(stageByWorker[worker.manifest.worker.workerKey], result.output, context);
  return { ...result, receipt: { ...result.receipt, executionMode: "simulation.model_router",
    mode: "simulation", providerType: "mock", providerExecuted: false, qualificationEvaluated: false,
    executedCapabilities: [], modelRoutingExecuted: true, mockProvider: true,
    configuredExecutionMode: worker.execution.kind, modelRouteKey: route.routeKey,
    selectedModelKey: route.selectedModel.modelKey, providerRequestId: route.providerResponse.providerRequestId,
    modelAttempts: route.attempts.map(attempt => ({ modelKey: attempt.modelKey, outcome: attempt.outcome,
      failureCategory: attempt.failureCategory, provider: attempt.provider })),
    totalReportedCostUsd: 0, totalEstimatedCostUsd: 0 } };
}
