import type { JsonObject } from "../core/contracts";
import type { PublicResearchPolicy } from "./qualification";
import type { PublicResearchQuote } from "./qualification-quote";
import type { EvidencePack } from "./types";

export type ResearchProofPhase = { phase: "search" | "select"; requestId: string; marked: boolean; settled: boolean;
  actualMicrounits: string | null; providerRequestId: string | null };
export type ResearchProofResult = { resultId: string; evidencePack: EvidencePack; evidencePackHash: string;
  collectionId: string; selectorRequestId: string; providerRequestId: string; createdAt: string };
export type ResearchProofPolicy = { policyId: string; workflowRunId: string; goalId: string; operatingPolicyId: string;
  policy: PublicResearchPolicy; policyHash: string; status: string; revoked: boolean; expired: boolean;
  phases: ResearchProofPhase[]; result: ResearchProofResult | null };
export type ResearchGrantPolicySummary = Pick<PublicResearchPolicy, "query" | "allowedDomains" | "excludedDomains" | "modelId" | "providerEndpoint" | "maximumMicrousd" | "validFrom" | "validUntil" | "quoteValidUntil">;
export type ResearchProofGrant = { grantId: string; grantHash: string; grant: JsonObject & { researchPolicy: JsonObject & ResearchGrantPolicySummary }; used: boolean; expired: boolean; revoked: boolean };
export type ResearchQualificationWorkspace = { businessId: string; ownerId: string; unavailable: boolean; configured: boolean;
  exposure: { currency: "USD"; heldMicrounits: string; hasUnknown: boolean };
  policies: ResearchProofPolicy[]; grants: ResearchProofGrant[]; policyTotal: number; grantTotal: number };
export type ResearchBootstrapPreparation = {
  version: "r11.owner-proof-preparation.1"; businessId: string; ownerId: string; policyId: string; workflowRunId: string;
  serverKeyHash: string; runtimeCapabilityHash: string; preparedAt: string; expiresAt: string;
  quote: PublicResearchQuote; sourceProfile: JsonObject; search: { requestHash: string; wireHash: string; wireBytes: number; maxTokens: number };
  authorityCreated: false; paidCalls: 0;
};
