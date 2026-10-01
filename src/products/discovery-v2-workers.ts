import type { JsonObject } from "../core/contracts";
import type { ModelProviderResponse } from "../models/types";
import { callDiscoveryV2, discoveryResponseFailure, type DiscoveryV2BudgetScope, type DiscoveryV2Ledger, type DiscoveryV2Provider, type fetchDiscoveryV2ModelQuote } from "./discovery-v2-budget";
import { discoveryV2Hash, type StrategistAssessmentV2, type WorkerExecutionV2 } from "./discovery-v2";
import { buildReviewerRequestV2, buildStrategistRequestV2, normalizeReviewerResponseV2, normalizeStrategistResponseV2, type DiscoveryWorkerContextV2 } from "./discovery-v2-worker-contract";

type WorkerOptions={prepared:DiscoveryWorkerContextV2;scope:DiscoveryV2BudgetScope;ledger:DiscoveryV2Ledger;provider?:DiscoveryV2Provider;prices?:typeof fetchDiscoveryV2ModelQuote};
function scopeMatches(options:WorkerOptions){
  if(options.scope.intentId!==options.prepared.intent.id || options.scope.policyHash!==discoveryV2Hash(options.prepared.intent) ||
     options.scope.maximumCollections!==options.prepared.intent.limits.maximumNewCollections ||
     options.scope.maximumMicrousd!==options.prepared.intent.limits.maximumMicrousd)throw new Error("Discovery worker cannot change its immutable intent/budget scope.");
}
function execution(response:ModelProviderResponse):WorkerExecutionV2{
  if(!response.providerRequestId)throw new Error("Discovery output lacks a real provider request identity; its charge remains recorded.");
  return{modelId:response.providerModelId,providerRequestId:response.providerRequestId,primaryOnly:true};
}
function receipt(response:ModelProviderResponse,options:WorkerOptions,role:"strategy"|"review",output:unknown):JsonObject{
  return{executionMode:`discovery.${role}`,provider:"openrouter",actualProviderModelId:response.providerModelId,
    providerRequestId:response.providerRequestId,primaryOnly:true,mockProvider:false,outputValidated:true,
    intentId:options.scope.intentId,callKey:`${role}:1`,dossierHash:discoveryV2Hash(options.prepared.dossier),
    contextBindingHash:options.prepared.bindingHash,outputHash:discoveryV2Hash(output),
    inputTokens:response.usage.inputTokens,outputTokens:response.usage.outputTokens,
    reportedCostUsd:response.usage.reportedCostUsd,estimatedCostUsd:response.usage.estimatedCostUsd,latencyMs:response.latencyMs,
    budget:response.metadata.discoveryBudget??null};
}
export async function executeDiscoveryStrategistV2(options:WorkerOptions){
  options={...options,prepared:structuredClone(options.prepared),scope:structuredClone(options.scope)};
  scopeMatches(options);
  const request=buildStrategistRequestV2(options.prepared);
  const response=await callDiscoveryV2({...options,key:"strategy:1",request});
  let output;try{output=normalizeStrategistResponseV2(options.prepared,response.output,execution(response));}catch(error){throw discoveryResponseFailure(error,response);}
  return{output,receipt:receipt(response,options,"strategy",output)};
}
export async function executeDiscoveryReviewerV2(options:WorkerOptions&{assessment:StrategistAssessmentV2;actualStrategistExecution:WorkerExecutionV2}){
  options={...options,prepared:structuredClone(options.prepared),scope:structuredClone(options.scope),assessment:structuredClone(options.assessment),actualStrategistExecution:structuredClone(options.actualStrategistExecution)};
  scopeMatches(options);
  const request=buildReviewerRequestV2(options.prepared,options.assessment,options.actualStrategistExecution);
  const response=await callDiscoveryV2({...options,key:"review:1",request});
  let output;try{output=normalizeReviewerResponseV2(options.prepared,options.assessment,response.output,{strategist:options.actualStrategistExecution,reviewer:execution(response)});}catch(error){throw discoveryResponseFailure(error,response);}
  return{output,receipt:receipt(response,options,"review",output)};
}
