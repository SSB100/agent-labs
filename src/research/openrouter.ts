import { OpenRouterAdapter } from "../models/openrouter";
import { resolveModelRoute } from "../models/registry";
import { ModelProviderError } from "../models/types";
import { extractResearchSources, validateResearchRequest } from "./sources";
import type { ResearchCollection, ResearchProvider, ResearchProviderResult, ResearchRequest } from "./types";

export class OpenRouterResearchProvider implements ResearchProvider {
  constructor(private readonly adapter=new OpenRouterAdapter()) {}
  async search(request:ResearchRequest): Promise<ResearchProviderResult> {
    validateResearchRequest(request);
    const attempts=[];
    for (const model of resolveModelRoute("standard.default").candidates) {
      try {
        const response=await this.adapter.invokeWebSearch({model,...request});
        const result={annotations:response.output.annotations as ResearchProviderResult["annotations"],
          metadata:{...response.metadata,providerRequestId:response.providerRequestId,latencyMs:response.latencyMs,
            reportedCostUsd:response.usage.reportedCostUsd,estimatedModelCostUsd:response.usage.estimatedCostUsd,
            inputTokens:response.usage.inputTokens,outputTokens:response.usage.outputTokens,attempts}};
        extractResearchSources(request,result);
        return result;
      } catch(error) {
        attempts.push({modelKey:model.modelKey,message:error instanceof Error?error.message.slice(0,300):"Search failed."});
        if (error instanceof ModelProviderError&&!error.retryable) throw error;
      }
    }
    throw new Error("Web Research failed on the bounded standard route: "+attempts.map(a=>a.message).join("; "));
  }
}

export async function collectResearch(provider:ResearchProvider,request:ResearchRequest): Promise<ResearchCollection> {
  validateResearchRequest(request);
  return extractResearchSources(request,await provider.search(request));
}
