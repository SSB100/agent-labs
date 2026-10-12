import type { JsonObject } from "../core/contracts";

/** Release-qualified quality limits, never an access grant. Old scopes retain
 * their original contract. Provider-specific result ceilings remain separate. */
export const POD_THOROUGH_PROFILE = "r12.pod-thorough.1" as const;
export const POD_THOROUGH_GOAL_VERSION = "r12.pod-research-goal.3" as const;
export const POD_THOROUGH_LIMITS = Object.freeze({
  maximumPasses: 5, maximumCalls: 25, maximumCollections: 5,
  maximumWorkingHypotheses: 16, maximumDomains: 16,
  maximumResults: 100, maximumWebSearchResults: 25,
  maximumExcerptCharacters: 8000, maximumQueryCharacters: 4000,
  maximumQuotes: 48, maximumQuoteCharacters: 2400,
  formattingTokenAllowance: 8192,
  searchInputTokenAllowance: 1000000, searchOutputTokenAllowance: 32000,
  exaFastSearchFeeMicrousd: 17000,
  phases: {
    plan: { maximumRequestBytes: 786432, outputTokens: 16000, maximumArtifactBytes: 262144 },
    search1: { maximumRequestBytes: 32768, outputTokens: 16000, maximumArtifactBytes: 1048576 },
    select1: { maximumRequestBytes: 786432, outputTokens: 16000, maximumArtifactBytes: 131072 },
    strategy: { maximumRequestBytes: 327680, outputTokens: 48000, maximumArtifactBytes: 262144 },
    review: { maximumRequestBytes: 155648, outputTokens: 32000, maximumArtifactBytes: 524288 },
  },
  maximumSelectorEvidenceBytes: 720896,
  maximumCurrentEvidenceBytes: 131072,
  maximumPriorEvidenceBytes: 65536,
  maximumPlannerEvidenceBytes: 524288,
  // Exact request composition determines the usable assessment allowance.
  // This additional ceiling counts JSON escaped inside the reviewer message.
  maximumAssessmentEmbeddedBytes: 98304,
  minimumAssessmentEmbeddedBytes: 16384,
  preferredAssessmentEmbeddedBytes: 49152,
  maximumRejectedContentBytes: 1048576,
  maximumResponseBytes: 2097152,
  maximumBindingBytes: 3407872,
  responseTimeoutMs: 120000,
});
export type PodThoroughPhase = keyof typeof POD_THOROUGH_LIMITS.phases;
export const isPodThoroughScope = (scope: {version:string}) => scope.version === POD_THOROUGH_GOAL_VERSION;
export function isPodThoroughRequest(request: {requestMetadata?: JsonObject; researchProfile?: string}): boolean {
  return request.researchProfile === POD_THOROUGH_PROFILE || request.requestMetadata?.r12PodProfile === POD_THOROUGH_PROFILE;
}
export function podEmbeddedJsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(JSON.stringify(value) ?? ""), "utf8");
}
export function assertPodArtifactBytes(value: unknown, phase: PodThoroughPhase): void {
  if (Buffer.byteLength(JSON.stringify(value) ?? "", "utf8") > POD_THOROUGH_LIMITS.phases[phase].maximumArtifactBytes ||
      phase === "strategy" && podEmbeddedJsonBytes(value) > POD_THOROUGH_LIMITS.maximumAssessmentEmbeddedBytes)
    throw new Error("r12_pod_artifact_capacity_exceeded");
}
