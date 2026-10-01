import type { JsonObject } from "../core/contracts";
import type { PackWorker } from "../packs/types";
import type { ResearchCollection } from "../research/types";
import { validateWorkerInvocationContext } from "../workers/runtime";
import { assertJsonSchemaValue } from "../workers/schema-validator";
import type { WorkerExecutionSuccess, WorkerInvocationContext } from "../workers/types";
import { DISCOVERY_V2, discoveryV2Hash, validateDiscoveryIntentV2, type DiscoveryIntentV2, type DiscoveryDossierV2, type DiscoveryValidationContextV2, type PersistedResearchEvidenceV2, type CandidateIdentityV2, type EvidenceRefV2, type StrategistAssessmentV2, type WorkerExecutionV2 } from "./discovery-v2";
import type { DiscoveryKnowledgeContextV2 } from "./discovery-v2-knowledge";
import type { DiscoveryV2BudgetScope, DiscoveryV2Ledger, DiscoveryV2Provider, fetchDiscoveryV2ModelQuote } from "./discovery-v2-budget";
import { planDiscoveryV2 } from "./discovery-v2-plan";
import { collectDiscoverySourcesV2, selectDiscoveryEvidenceV2 } from "./discovery-v2-research";
import { prepareDiscoveryWorkerContextV2 } from "./discovery-v2-worker-contract";
import { executeDiscoveryReviewerV2, executeDiscoveryStrategistV2 } from "./discovery-v2-workers";

export type ProductRuntimeScope = null | { version: "pod-discovery-1.0"; experimentId: string } | {
  version: typeof DISCOVERY_V2; rootId: string; intent: DiscoveryIntentV2; quote: JsonObject;
  budgetScope: DiscoveryV2BudgetScope; committedMicrousd: number; hasUncertainCosts: boolean;
};
type V2Scope = Extract<ProductRuntimeScope, {version: typeof DISCOVERY_V2}>;
type V2ValidationInput = Omit<DiscoveryValidationContextV2, "packs" | "candidates"> & { packs: PersistedResearchEvidenceV2[]; candidates: CandidateIdentityV2[] };
type V2Phase = { kind: "plan"; intent: DiscoveryIntentV2; focus:string; knowledge: DiscoveryKnowledgeContextV2 }
  | { kind: "research"; ordinal: 1 | 2; queryId: string; question: string; sourceDomains: string[]; knowledge: DiscoveryKnowledgeContextV2 }
  | { kind: "strategy" | "review"; dossier: DiscoveryDossierV2; validation: V2ValidationInput; evidenceReferences: EvidenceRefV2[]; assessment?: StrategistAssessmentV2; actualStrategistExecution?: WorkerExecutionV2 };
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function fail(message: string): never { throw new Error(message); }
function exact(value: unknown, keys: string, label: string): asserts value is Record<string, unknown> {
  if (!object(value) || Object.keys(value).sort().join(",") !== keys.split(",").sort().join(",")) fail(`Invalid persisted ${label}.`);
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
/** Authority comes only from the capability-authenticated database response. Hints can reject, never grant. */
export function readProductRuntimeScope(loaded: Record<string, unknown>, businessId: string, experimentHint?: string): ProductRuntimeScope {
  if (!Object.prototype.hasOwnProperty.call(loaded,"productScope")) fail("Persisted product scope is missing; generic execution is not authorized.");
  const value = structuredClone(loaded.productScope);
  if (value === null) {
    if (experimentHint || object(loaded.discoveryPhase)) fail("Product hints cannot bypass a missing persisted product binding.");
    return null;
  }
  if (!object(value)) fail("Invalid persisted product scope.");
  if (value.version === "pod-discovery-1.0") {
    exact(value,"version,experimentId","v1 product scope");
    if (typeof value.experimentId !== "string" || !uuid.test(value.experimentId) || (experimentHint && experimentHint !== value.experimentId)) fail("Product experiment hint differs from its persisted binding.");
    return value as Exclude<ProductRuntimeScope, V2Scope | null>;
  }
  exact(value,"version,rootId,intent,quote,budgetScope,committedMicrousd,hasUncertainCosts","v2 product scope");
  if (value.version !== DISCOVERY_V2 || experimentHint) fail("Unknown or conflicting persisted product version.");
  const scope = value as V2Scope;
  validateDiscoveryIntentV2(scope.intent);
  exact(scope.budgetScope,"intentId,maximumCollections,maximumMicrousd,policyHash","v2 budget scope");
  if (scope.rootId !== scope.intent.id || scope.intent.businessId !== businessId || scope.budgetScope.intentId !== scope.rootId ||
      scope.budgetScope.policyHash !== discoveryV2Hash(scope.intent) || scope.budgetScope.maximumMicrousd !== scope.intent.limits.maximumMicrousd ||
      scope.budgetScope.maximumCollections !== scope.intent.limits.maximumNewCollections || !Number.isSafeInteger(scope.committedMicrousd) || scope.committedMicrousd < 0 ||
      typeof scope.hasUncertainCosts !== "boolean" || !object(scope.quote) || scope.quote.intentId !== scope.rootId || scope.quote.policyHash !== scope.budgetScope.policyHash) fail("Persisted discovery intent, Business, quote or budget binding differs.");
  return scope;
}
function phaseContext(scope: V2Scope, prepared: Record<string, unknown>, stageKey: string) {
  if (scope.hasUncertainCosts || scope.committedMicrousd >= scope.budgetScope.maximumMicrousd) fail("Unknown charges or exhausted discovery allowance block further execution.");
  const worker = prepared.worker as PackWorker, context = prepared.context as WorkerInvocationContext;
  validateWorkerInvocationContext(worker.manifest,context);
  const phase = structuredClone(prepared.discoveryPhase) as V2Phase;
  const stageInput = context.inputArtifacts.find(artifact => artifact.artifactType === "pack.stage-input");
  if (!object(phase) || !stageInput || discoveryV2Hash(stageInput.content) !== discoveryV2Hash(phase)) fail("Discovery phase differs from its immutable Task Contract input.");
  const expectedKind = /^research[12]$/.test(stageKey) ? "research" : stageKey;
  if (!["plan","research","strategy","review"].includes(expectedKind) || phase.kind !== expectedKind ||
      worker.manifest.worker.workerKey !== `product.discovery-v2.${expectedKind}` || worker.manifest.worker.version !== "1.0.0" ||
      worker.manifest.modelRequirements.primaryOnly !== true || (phase.kind === "research" ? worker.execution.kind !== "web.research" : worker.execution.kind !== "model_router")) fail("The persisted phase requires its exact v2 worker and executor.");
  if (phase.kind === "plan") {
    exact(phase,"kind,intent,focus,knowledge","plan phase");
    if (discoveryV2Hash(phase.intent) !== discoveryV2Hash(scope.intent)) fail("Planner intent differs from persisted authority.");
  } else if (phase.kind === "research") {
    exact(phase,"kind,ordinal,queryId,question,sourceDomains,knowledge","research phase");
    if (stageKey !== `research${phase.ordinal}` || phase.ordinal > scope.budgetScope.maximumCollections ||
        JSON.stringify(phase.sourceDomains) !== JSON.stringify(scope.intent.comparisonUniverse.sourceDomains) || !context.taskContract.permittedCapabilities.includes("web.research")) fail("Research query differs from persisted finite scope.");
  } else {
    exact(phase,phase.kind === "review" ? "kind,dossier,validation,evidenceReferences,assessment,actualStrategistExecution" : "kind,dossier,validation,evidenceReferences","analysis phase");
    if (!Array.isArray(phase.validation.packs) || !Array.isArray(phase.validation.candidates) ||
      new Set(phase.validation.packs.map(p => p.artifactId)).size !== phase.validation.packs.length || new Set(phase.validation.candidates.map(c => c.id)).size !== phase.validation.candidates.length) fail("Ambiguous persisted analysis records.");
  }
  return {worker,context,phase};
}
type Services = {ledger: DiscoveryV2Ledger; provider?: DiscoveryV2Provider; prices?: typeof fetchDiscoveryV2ModelQuote};
export async function collectPreparedDiscoveryV2(scope: V2Scope, prepared: Record<string, unknown>, stageKey: string, services: Services): Promise<ResearchCollection | null> {
  const {phase,context} = phaseContext(scope,prepared,stageKey);
  if (phase.kind !== "research" || context.inputArtifacts.some(artifact => artifact.artifactType === "research.sources")) return null;
  return collectDiscoverySourcesV2({...services,scope:scope.budgetScope,knowledge:phase.knowledge,ordinal:phase.ordinal,queryId:phase.queryId,request:{query:phase.question,allowedDomains:phase.sourceDomains}});
}
export async function executePreparedDiscoveryV2(scope: V2Scope, prepared: Record<string, unknown>, stageKey: string, services: Services): Promise<WorkerExecutionSuccess> {
  const {worker,context,phase} = phaseContext(scope,prepared,stageKey);
  let output: JsonObject, receipt: JsonObject;
  if (phase.kind === "plan") {
    const result = await planDiscoveryV2({...services,intent:scope.intent,focus:phase.focus,knowledge:phase.knowledge,scope:scope.budgetScope});
    output = result.plan as unknown as JsonObject; receipt = result.receipt;
  } else if (phase.kind === "research") {
    const collection = context.inputArtifacts.find(artifact => artifact.artifactType === "research.sources")?.content as ResearchCollection | undefined;
    if (!collection) fail("The immutable source collection must be persisted before selection.");
    const result = await selectDiscoveryEvidenceV2({...services,scope:scope.budgetScope,knowledge:phase.knowledge,ordinal:phase.ordinal,queryId:phase.queryId,request:{query:phase.question,allowedDomains:phase.sourceDomains},collection});
    output = {decision:"complete",evidencePack:result.evidencePack,stopReason:"evidence_collected"}; receipt = result.receipt;
  } else {
    const validation = {...phase.validation,packs:new Map(phase.validation.packs.map(pack => [pack.artifactId,pack])),candidates:new Map(phase.validation.candidates.map(candidate => [candidate.id,candidate]))};
    const bound = prepareDiscoveryWorkerContextV2(scope.intent,phase.dossier,validation,phase.evidenceReferences);
    const result = phase.kind === "strategy" ? await executeDiscoveryStrategistV2({...services,scope:scope.budgetScope,prepared:bound})
      : await executeDiscoveryReviewerV2({...services,scope:scope.budgetScope,prepared:bound,assessment:phase.assessment!,actualStrategistExecution:phase.actualStrategistExecution!});
    output = result.output as unknown as JsonObject; receipt = result.receipt;
  }
  assertJsonSchemaValue(worker.manifest.outputSchema,output,"V2 worker output");
  // Domain validators above own the typed completion criteria; no synthetic generic stopReason is inserted into the immutable decision.
  return {output,receipt:{...receipt,receiptVersion:"1.0",packKey:worker.manifest.packKey,packVersion:worker.manifest.version,
    workerKey:worker.manifest.worker.workerKey,workerVersion:worker.manifest.worker.version,taskContractId:context.taskContract.id,
    inputArtifactIds:[...context.taskContract.inputArtifactIds],outputValidated:true,executionMode:receipt.executionMode as string,stopReason:phase.kind === "research" ? "evidence_collected" : "bounded_discovery_phase_completed"}};
}
