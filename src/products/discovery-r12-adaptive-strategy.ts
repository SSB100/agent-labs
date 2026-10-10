import { selectedOwnerObservationBaselines } from "./discovery-r12-owner-observation";
import type { JsonObject } from "../core/contracts";
import { workerOutputLimits } from "../workers/output-limits";
import { assertJsonSchemaValue } from "../workers/schema-validator";
import { buildStrategistRequestV2, strategistResponseSchemaV2, normalizeStrategistResponseV2, type DiscoveryWorkerContextV2 } from "./discovery-v2-worker-contract";
import { discoveryR12OwnerInitialStaticSchema } from "./discovery-r12-schemas";
import { discoveryV2Hash, type WorkerExecutionV2 } from "./discovery-v2";
import type { AdaptiveTestPlan } from "./discovery-r12-adaptive-review-contract";
import { ADAPTIVE_REQUEST_BYTES } from "./discovery-r12-adaptive-quote";

const extension: JsonObject = { anyOf: [{ type: "null" }, { type: "object", additionalProperties: false,
  required: ["observationWindow", "inconclusiveCriterion"], properties: {
    observationWindow: { type: "string", minLength: 10, maxLength: 200 },
    inconclusiveCriterion: { type: "string", minLength: 10, maxLength: 300 } } }] };
export function adaptiveStrategistSchema(assessmentSchema: JsonObject = discoveryR12OwnerInitialStaticSchema("strategy")): JsonObject {
  return { type: "object", additionalProperties: false, required: ["assessment", "measurement"], properties: { assessment: assessmentSchema, measurement: extension } };
}
export function buildAdaptiveStrategistRequest(prepared: DiscoveryWorkerContextV2, now = Date.now()) {
  if (!prepared.validation.ownerAdaptive) throw new Error("r12_adaptive_strategy_context_required");
  const request = buildStrategistRequestV2(prepared, now);
  request.schemaName = "r12_adaptive_strategy_v1";
  request.outputSchema = adaptiveStrategistSchema();
  request.messages[0].content += " Return {assessment,measurement}. assessment retains the full nine-dimension, geography and candidate comparison. When assessment.testPlan is present, measurement must contain your actual bounded observationWindow and inconclusiveCriterion; when no test is proposed, measurement is null. Never invent completed observations. Preserve archived negative findings and unresolved questions; describe this action's information gain. Later commercial clearance or nonexistent artwork alone does not block a private learning proposal. Use actual selling-channel evidence for demand when supplied; broad retail context is not candidate demand. Describe a comparable baseline and opposing/reference observation using the same product format and reporting window; mark missing comparisons as unknown. Keep qualitative conversion bands ordinal, rounded counts rounded and account locale distinct from buyer geography. Zero visits is no exposure and an inconclusive conversion assessment. State the eligible-exposure denominator and positive, negative and inconclusive rules before evaluating an experiment. Do not invent marketplace sales, conversion rates, margins or thresholds; reasoning quality and observed commercial performance are different measurements.";
  if(prepared.validation.ownerAdaptive.scopeVersion==="r12.discovery-owner-adaptive.2") request.messages[0].content += " This is Etsy-only owner-observation mode. No external search or paid evidence-selection operation exists. TEST requires a fully selected comparable owner baseline with two or three hypotheses and a negative/reference; otherwise return NEEDS_MORE_EVIDENCE or a supported REJECT. Name the exact missing owner source operation. Do not count repeated reasoning as new channel evidence.";
  request.messages[1].content = JSON.stringify({ ...JSON.parse(request.messages[1].content), outputLimits: workerOutputLimits(request.outputSchema) });
  if (Buffer.byteLength(JSON.stringify(request)) > ADAPTIVE_REQUEST_BYTES.strategy) throw new Error("r12_adaptive_strategy_context_exceeds_quote");
  return request;
}
export function normalizeAdaptiveStrategistResponse(prepared: DiscoveryWorkerContextV2, raw: unknown, execution: WorkerExecutionV2, now = Date.now()) {
  if (!prepared.validation.ownerAdaptive) throw new Error("r12_adaptive_strategy_context_required");
  assertJsonSchemaValue(adaptiveStrategistSchema(strategistResponseSchemaV2(prepared)), raw, "Adaptive strategy");
  const response = raw as { assessment: JsonObject; measurement: { observationWindow: string; inconclusiveCriterion: string } | null };
  const assessment = normalizeStrategistResponseV2(prepared, response.assessment, execution, now);
  if ((assessment.testPlan === null) !== (response.measurement === null)) throw new Error("r12_adaptive_measurement_missing");
  if(prepared.validation.ownerAdaptive.scopeVersion==="r12.discovery-owner-adaptive.2" && assessment.recommendation.proposedOutcome==="TEST" &&
    (!prepared.validation.ownerObservations || !selectedOwnerObservationBaselines(prepared.validation.ownerObservations).some(b=>b.baseline!==null)))
    throw new Error("r12_etsy_comparable_baseline_required");
  const compact = response.assessment.testPlan as { evidence: string[] } | null;
  const plan = assessment.testPlan;
  const proposedTest: AdaptiveTestPlan | null = plan && response.measurement && compact ? {
    hypothesis: plan.hypothesis, deliverable: plan.deliverable,
    positiveCriterion: plan.successCriteria.join("; "), negativeCriterion: plan.failureCriteria.join("; "),
    inconclusiveCriterion: response.measurement.inconclusiveCriterion, observationWindow: response.measurement.observationWindow,
    stopRule: plan.stopRule, evidenceRefs: [...compact.evidence],
  } : null;
  const body = { version: "r12.adaptive-strategy.1" as const, adaptiveBindingHash: prepared.validation.ownerAdaptive.bindingHash,
    actionHash: prepared.validation.ownerAdaptive.actionHash, scopeHash: prepared.validation.ownerAdaptive.scopeHash,
    assessment, proposedTest, measurement: structuredClone(response.measurement), rawResponse: structuredClone(raw) };
  return { ...body, proposalHash: discoveryV2Hash(body) };
}
export type AdaptiveStrategy = ReturnType<typeof normalizeAdaptiveStrategistResponse>;
