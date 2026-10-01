import { FatalError } from "workflow";
import type { JsonObject } from "../core/contracts";
import { createRuntimeClient } from "../lib/supabase/runtime";
import { ModelProviderError } from "../models/types";
import { OpenRouterAdapter } from "../models/openrouter";
import { buildWorkerModelMessages } from "../models/prompt";
import { runModelRoute } from "../models/router";
import { resolvePackDependencies, validateResolvedDefinitions } from "../packs/dependencies";
import { executePackMapping } from "../packs/executor";
import { assertEtsySimulationSnapshot } from "../packs/etsy-simulation-runtime-contract";
import { validatePackManifest } from "../packs/registry";
import type { PackSnapshot, PackWorker } from "../packs/types";
import { collectResearch, OpenRouterResearchProvider } from "../research/openrouter";
import { executeMarketResearcher } from "../research/worker";
import { BudgetedResearchAdapter } from "../research/budget";
import { runtimeResearchBudget } from "../research/runtime-budget";
import type { ResearchCollection, ResearchRequest } from "../research/types";
import { executeWorkerPack, validateWorkerInvocationContext } from "../workers/runtime";
import { assertJsonSchemaValue } from "../workers/schema-validator";
import type { WorkerExecutionSuccess, WorkerInvocationContext } from "../workers/types";
import { readProductRuntimeScope, collectPreparedDiscoveryV2, executePreparedDiscoveryV2 } from "../products/discovery-v2-runtime";
import { DISCOVERY_V2_QUALIFICATION } from "../products/discovery-v2-packs";
import type { InstalledPackRuntimeInput } from "./installed-pack-runtime";

async function transition(input: InstalledPackRuntimeInput, operation: string, payload: JsonObject = {}) {
  const { data, error } = await createRuntimeClient().rpc("installed_pack_runtime_transition", {
    p_business_id: input.businessId, p_workflow_run_id: input.coreWorkflowRunId,
    p_runtime_capability: input.runtimeCapability, p_operation: operation, p_payload: payload,
  });
  if (error) throw new Error(`${operation}: ${error.message}`);
  return data as Record<string, unknown>;
}

async function stopDiscoveryFailure(input:InstalledPackRuntimeInput,error:unknown):Promise<never>{
  const message=error instanceof Error?error.message.slice(0,500):"Discovery phase failed its contract.";
  const details=error instanceof ModelProviderError?error.details:{};
  // Persist safe actual accounting evidence before the workflow engine serializes the thrown error.
  // No request bodies, image bytes, connection credentials or owner profile enter this payload.
  const receipt=details.providerReceipt;
  await transition(input,"fail",{category:"discovery_phase_failed",message,
    ...(receipt&&typeof receipt==='object'&&!Array.isArray(receipt)?{providerReceipt:receipt}:{}),
    ...(typeof details.requestedModel==='string'?{requestedModel:details.requestedModel}:{}),
    ...(typeof details.settlementRecorded==='boolean'?{settlementRecorded:details.settlementRecorded}:{})});
  throw new FatalError(message);
}

export async function loadInstalledPack(input: InstalledPackRuntimeInput, runtimeRunId: string): Promise<string[]> {
  "use step";
  const loaded = await transition(input,"load",{runtimeRunId});
  const productScope = readProductRuntimeScope(loaded,input.businessId,input.productExperimentId);
  if(productScope?.version==="pod-discovery-1.0"&&loaded.status!=="completed"){
    const scoped=await createRuntimeClient().rpc("product_discovery_runtime",{p_workflow_run_id:input.coreWorkflowRunId,p_business_id:input.businessId,p_runtime_capability:input.runtimeCapability,p_operation: "scope"});
    if(scoped.error||scoped.data?.experimentId!==productScope.experimentId)throw new FatalError("Product experiment differs from its persisted runtime binding.");
  }
  const snapshot = loaded.snapshot as PackSnapshot;
  const root = snapshot.releases.find(r=>r.id === snapshot.rootPackId);
  if (!root) throw new FatalError("Pinned root pack is unavailable.");
  for (const release of snapshot.releases) validatePackManifest(release.manifest);
  const qualification = input.qualification === "stage11" && (snapshot as PackSnapshot & {platformQualification?:string}).platformQualification === "stage11" && root.manifest.packKey === "workflow.web-research";
  const simulation = input.qualification === "stage12" && input.mode === "simulation";
  if (simulation) assertEtsySimulationSnapshot(snapshot);
  const discovery = productScope?.version === "pod-discovery-2.0" && (snapshot as PackSnapshot & {platformQualification?:string}).platformQualification === DISCOVERY_V2_QUALIFICATION && ["workflow.product-discovery-v2", "workflow.product-discovery-v2-analysis"].includes(root.manifest.packKey);
  if ((["workflow.product-discovery-v2", "workflow.product-discovery-v2-analysis"].includes(root.manifest.packKey)) !== discovery) throw new FatalError("V2 discovery requires its persisted qualification scope.");
  const resolved = resolvePackDependencies(snapshot.releases,{packKey:root.manifest.packKey,version:root.manifest.version},qualification || simulation || discovery);
  validateResolvedDefinitions(resolved);
  const declared = root.manifest.workflows.find(w=>w.key === snapshot.workflow.key);
  if (!declared || JSON.stringify(declared) !== JSON.stringify(snapshot.workflow)) throw new FatalError("Pinned workflow does not match its release.");
  assertJsonSchemaValue(snapshot.workflow.inputSchema,loaded.input,"Workflow input");
  return snapshot.workflow.stages.map(s=>s.key);
}

export async function executeInstalledPackStage(input: InstalledPackRuntimeInput, stageKey: string) {
  "use step";
  if (input.qualification === "stage12") throw new FatalError("Use the dedicated simulation worker.");
  const prepared = await transition(input,"prepare",{stageKey});
  const productScope = readProductRuntimeScope(prepared,input.businessId,input.productExperimentId);
  if (prepared.completed === true) return;
  if (productScope?.version === "pod-discovery-2.0") {
    try{return await executePreparedDiscoveryV2(productScope,prepared,stageKey,{ledger:runtimeResearchBudget(input)});}catch(error){return stopDiscoveryFailure(input,error);}
  }
  const worker = prepared.worker as PackWorker;
  const context = prepared.context as WorkerInvocationContext;
  let result: WorkerExecutionSuccess;
  try {
    validateWorkerInvocationContext(worker.manifest,context);
    const stageInput = context.inputArtifacts.find(a=>a.artifactType === "pack.stage-input");
    if (!stageInput) throw new Error("Scoped stage input is missing.");
    assertJsonSchemaValue(worker.manifest.inputSchema,stageInput.content,"Stage input");
    if (productScope?.version === "pod-discovery-1.0" && worker.execution.kind !== "web.research") throw new Error("V1 product scope permits only its metered research worker.");
    result = worker.execution.kind === "web.research"
      ? await executeMarketResearcher(worker,context,productScope ? new BudgetedResearchAdapter(runtimeResearchBudget(input)) : new OpenRouterAdapter(),productScope ? { maxOutputTokens: 1000 } : {})
      : worker.execution.kind === "structured.mapping"
      ? executePackMapping(worker,context)
      : await (async () => {
        if (worker.execution.kind !== "model_router") throw new Error("Model Router executor required.");
        const routed = await runModelRoute({adapter:new OpenRouterAdapter(),routeKey:worker.execution.routeKey,
          outputSchema:worker.manifest.outputSchema,schemaName:"installed_pack_worker",
          messages:buildWorkerModelMessages(worker.manifest,context),
          requestMetadata:{businessId:input.businessId,workflowRunId:input.coreWorkflowRunId,taskContractId:context.taskContract.id}});
        return executeWorkerPack(worker.manifest,()=>routed.output,context);
      })();
  } catch (error) {
    throw new FatalError(error instanceof Error ? error.message : "Pack worker failed.");
  }
  return result;
}

export async function persistInstalledPackStage(input: InstalledPackRuntimeInput, stageKey: string, result: WorkerExecutionSuccess) {
  "use step";
  await transition(input,"persist",{stageKey,output:result.output,receipt:result.receipt});
}

export async function collectInstalledPackResearch(input: InstalledPackRuntimeInput, stageKey: string): Promise<ResearchCollection | null> {
  "use step";
  const prepared=await transition(input,"prepare",{stageKey});
  const productScope=readProductRuntimeScope(prepared,input.businessId,input.productExperimentId);
  if (prepared.completed===true) return null;
  if (productScope?.version === "pod-discovery-2.0") {
    try{return await collectPreparedDiscoveryV2(productScope,prepared,stageKey,{ledger:runtimeResearchBudget(input)});}catch(error){return stopDiscoveryFailure(input,error);}
  }
  const worker=prepared.worker as PackWorker;
  if (worker.execution.kind!=="web.research") return null;
  const context=prepared.context as WorkerInvocationContext;
  validateWorkerInvocationContext(worker.manifest,context);
  if (!context.taskContract.permittedCapabilities.includes("web.research")) throw new FatalError("Web Research is outside this Task Contract.");
  if (context.inputArtifacts.some(a=>a.artifactType==="research.sources")) return null;
  const stageInput=context.inputArtifacts.find(a=>a.artifactType==="pack.stage-input")?.content;
  if (!stageInput) throw new FatalError("Research input is missing.");
  const request:ResearchRequest={query:stageInput.question as string,allowedDomains:stageInput.sourceDomains as string[]};
  try { return await collectResearch(new OpenRouterResearchProvider(productScope ? new BudgetedResearchAdapter(runtimeResearchBudget(input)) : new OpenRouterAdapter()),request); }
  catch(error) { throw new FatalError(error instanceof Error?error.message:"Web Research failed."); }
}

export async function persistInstalledPackResearch(input: InstalledPackRuntimeInput, stageKey: string, collection: ResearchCollection) {
  "use step";
  const {error}=await createRuntimeClient().rpc("append_pack_research_sources",{
    p_workflow_run_id:input.coreWorkflowRunId,p_business_id:input.businessId,p_runtime_capability:input.runtimeCapability,p_stage_key:stageKey,p_collection:collection});
  if (error) throw new Error(`Unable to persist research sources: ${error.message}`);
}

export async function completeInstalledPack(input: InstalledPackRuntimeInput) {
  "use step";
  // Validate the terminal artifact against the pinned Workflow output contract.
  const candidate = await transition(input,"output");
  const productScope = readProductRuntimeScope(candidate,input.businessId,input.productExperimentId);
  assertJsonSchemaValue(candidate.schema as JsonObject,candidate.output,"Workflow output");
  if (input.qualification === "stage11") {
    const {data,error}=await createRuntimeClient().rpc("record_web_research_qualification",{p_workflow_run_id:input.coreWorkflowRunId,p_business_id:input.businessId,p_runtime_capability:input.runtimeCapability});
    if (error) throw new Error(`Unable to record Web Research qualification: ${error.message}`);
    return data;
  }
  if (productScope?.version === "pod-discovery-1.0") {
    const { data, error } = await createRuntimeClient().rpc("product_discovery_runtime", {
      p_workflow_run_id: input.coreWorkflowRunId, p_business_id: input.businessId,
      p_runtime_capability: input.runtimeCapability, p_operation: "finalize",
    });
    if (error) throw new Error(`Unable to preserve product discovery: ${error.message}`);
    return data;
  }
  return transition(input,"complete");
}

export async function failInstalledPack(input: InstalledPackRuntimeInput, message: string) {
  "use step";
  await transition(input,"fail",{category:"pack_execution_failed",message});
  // The authenticated database transition projects linked v1/v2 failures atomically.
}
