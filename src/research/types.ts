import type { JsonObject } from "../core/contracts";
export type ResearchRequest = { query: string; allowedDomains: string[] };
export type ResearchProviderResult = { annotations: JsonObject[]; metadata: JsonObject };
export interface ResearchProvider { search(request: ResearchRequest): Promise<ResearchProviderResult> }
export type ResearchSource = JsonObject & {
  id: string; url: string; title: string; retrievedAt: string; publishedAt: string | null;
  retrievalExpiresAt: string; contentHash: string; excerpt: string; provider: string;
};
export type ResearchEvidence = JsonObject & { id: string; sourceId: string; quote: string };
export type ResearchCollection = JsonObject & {
  collectionVersion: "1.0"; query: string; sources: ResearchSource[];
  evidence: ResearchEvidence[]; providerMetadata: JsonObject;
};
export type EvidencePack = JsonObject & {
  evidencePackVersion: "1.0"; question: string; sources: ResearchSource[];
  evidence: ResearchEvidence[]; claims: (JsonObject & { text: string; evidenceId: string; sourceId: string })[];
  limitations: string[];
};
