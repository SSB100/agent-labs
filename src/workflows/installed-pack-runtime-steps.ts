import { FatalError } from "workflow";
import type { JsonObject } from "../core/contracts";
import { createRuntimeClient } from "../lib/supabase/runtime";
import { OpenRouterAdapter } from "../models/openrouter";
import { buildWorkerModelMessages } from "../models/prompt";
import { runModelRoute } from "../models/router";
import { resolvePackDependencies, validateResolvedDefinitions } from "../packs/dependencies";
import { executePackMapping } from "../packs/executor";
import { validatePackManifest } from "../packs/registry";
import type { PackSnapshot, PackWorker } from "../packs/types";
import { collectResearch, OpenRouterResearchProvider } from "../research/openrouter";
import { executeMarketResearcher } from "../research/worker";
import type { ResearchCollection, ResearchRequest } from "../research/types";
import { executeWorkerPack, validateWorkerInvocationContext } from "../workers/runtime";
import { assertJsonSchemaValue } from "../workers/schema-validator";
import type { WorkerExecutionSuccess, WorkerInvocationContext } from "../workers/types";
import type { InstalledPackRuntimeInput } from "./installed-pack-runtime";

async function transition(input: InstalledPackRuntimeInput, operation: string, payload: JsonObject = {}) {
  const { data, error } = await createRuntimeClient().rpc("installed_pack_runtime_transition", {
    p_business_id: input.businessId, p_workflow_run_id: input.coreWorkflowRunId,
    p_runtime_capability: input.runtimeCapability, p_operation: operation, p_payload: payload,
  });
  if (error) throw new Error(`${operation}: ${error.message}`);
  return data as Record<string, unknown>;
}

export async function loadInstalledPack(input: InstalledPackRuntimeInput, runtimeRunId: string): Promise<string[]> {
  "use step";
  const loaded = await transition(input,"load",{runtimeRunId});
  const snapshot = loaded.snapshot as PackSnapshot;
  const root = snapshot.releases.find(r=>r.id === snapshot.rootPackId);
  if (!root) throw new FatalError("Pinned root pack is unavailable.");
  for (const release of snapshot.releases) validatePackManifest(release.manifest);
  const qualification = input.qualification === "stage11" && (snapshot as PackSnapshot & {platformQualification?:string}).platformQualification === "stage11" && root.manifest.packKey === "workflow.web-research";
  const resolved = resolvePackDependencies(snapshot.releases,{packKey:root.manifest.packKey,version:root.manifest.version},qualification);
  validateResolvedDefinitions(resolved);
  const declared = root.manifest.workflows.find(w=>w.key === snapshot.workflow.key);
  if (!declared || JSON.stringify(declared) !== JSON.stringify(snapshot.workflow)) throw new FatalError("Pinned workflow does not match its release.");
  assertJsonSchemaValue(snapshot.workflow.inputSchema,loaded.input,"Workflow input");
  return snapshot.workflow.stages.map(s=>s.key);
}

export async function executeInstalledPackStage(input: InstalledPackRuntimeInput, stageKey: string) {
  "use step";
  const prepared = await transition(input,"prepare",{stageKey});
  if (prepared.completed === true) return;
  const worker = prepared.worker as PackWorker;
  const context = prepared.context as WorkerInvocationContext;
  let result: WorkerExecutionSuccess;
  try {
    validateWorkerInvocationContext(worker.manifest,context);
    const stageInput = context.inputArtifacts.find(a=>a.artifactType === "pack.stage-input");
    if (!stageInput) throw new Error("Scoped stage input is missing.");
    assertJsonSchemaValue(worker.manifest.inputSchema,stageInput.content,"Stage input");
    result = worker.execution.kind === "web.research"
      ? await executeMarketResearcher(worker,context,new OpenRouterAdapter())
      : worker.execution.kind === "structured.mapping"
      ? executePackMapping(worker,context)
      : await (async () => {
        const routed = await runModelRoute({adapter:new OpenRouterAdapter(),routeKey:"standard.default",
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
  if (prepared.completed===true) return null;
  const worker=prepared.worker as PackWorker;
  if (worker.execution.kind!=="web.research") return null;
  const context=prepared.context as WorkerInvocationContext;
  validateWorkerInvocationContext(worker.manifest,context);
  if (!context.taskContract.permittedCapabilities.includes("web.research")) throw new FatalError("Web Research is outside this Task Contract.");
  if (context.inputArtifacts.some(a=>a.artifactType==="research.sources")) return null;
  const stageInput=context.inputArtifacts.find(a=>a.artifactType==="pack.stage-input")?.content;
  if (!stageInput) throw new FatalError("Research input is missing.");
  const request:ResearchRequest={query:stageInput.question as string,allowedDomains:stageInput.sourceDomains as string[]};
  try { return await collectResearch(new OpenRouterResearchProvider(),request); }
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
  assertJsonSchemaValue(candidate.schema as JsonObject,candidate.output,"Workflow output");
  if (input.qualification === "stage11") {
    const {data,error}=await createRuntimeClient().rpc("record_web_research_qualification",{p_workflow_run_id:input.coreWorkflowRunId,p_business_id:input.businessId,p_runtime_capability:input.runtimeCapability});
    if (error) throw new Error(`Unable to record Web Research qualification: ${error.message}`);
    return data;
  }
  return transition(input,"complete");
}

export async function failInstalledPack(input: InstalledPackRuntimeInput, message: string) {
  "use step";
  await transition(input,"fail",{category:"pack_execution_failed",message});
}
