import type { PackWorker } from "../packs/types";
import { buildWorkerModelMessages } from "../models/prompt";
import { runModelRoute } from "../models/router";
import type { ModelProviderAdapter } from "../models/types";
import { executeWorkerPack, validateWorkerInvocationContext } from "../workers/runtime";
import type { WorkerInvocationContext } from "../workers/types";
import { assembleEvidencePack, researcherSelectionSchema, validateEvidencePack, validateResearchCollection } from "./sources";
import type { ResearchCollection } from "./types";

export async function executeMarketResearcher(worker:PackWorker,context:WorkerInvocationContext,adapter:ModelProviderAdapter,options:{maxOutputTokens?:number}={}) {
  if (worker.execution.kind!=="web.research"||!context.taskContract.permittedCapabilities.includes("web.research")) throw new Error("The Task Contract does not authorize Web Research.");
  validateWorkerInvocationContext(worker.manifest,context);
  const artifact=context.inputArtifacts.find(a=>a.artifactType==="research.sources");
  if (!artifact) throw new Error("Scoped research sources are missing.");
  const collection=artifact.content as ResearchCollection;
  const stageInput=context.inputArtifacts.find(a=>a.artifactType==="pack.stage-input")?.content;
  if (!stageInput) throw new Error("Research task input is missing.");
  validateResearchCollection(collection,{query:stageInput.question as string,allowedDomains:stageInput.sourceDomains as string[]});
  const routed=await runModelRoute({adapter,routeKey:"standard.default",...options,outputSchema:researcherSelectionSchema(collection),schemaName:"research_evidence_selection",
    messages:[...buildWorkerModelMessages(worker.manifest,context),{role:"system",content:"Return only selectedEvidenceIds and limitation tags under the response schema. Do not generate factual claims. Core assembles the final Evidence Pack from the exact provider source excerpts."}],
    requestMetadata:{taskContractId:context.taskContract.id,workerKey:worker.manifest.worker.workerKey}});
  const pack=assembleEvidencePack(collection,routed.output);validateEvidencePack(pack);
  const result=executeWorkerPack(worker.manifest,()=>({decision:"complete",evidencePack:pack,stopReason:"evidence_collected"}),context);
  return {...result,receipt:{...result.receipt,modelRouteKey:routed.routeKey,selectedModelKey:routed.selectedModel.modelKey,
    providerRequestId:routed.providerResponse.providerRequestId,
    ...(routed.providerResponse.metadata.budget ? {researchBudget:routed.providerResponse.metadata.budget} : {}),
    totalReportedCostUsd:routed.totalReportedCostUsd,totalEstimatedCostUsd:routed.totalEstimatedCostUsd}};
}
