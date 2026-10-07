/** Pure preflight only. SQL reloads the immutable adoption, accepted R12
 * responses, current Goal and installation before approval and every effect.
 * A caller-supplied proof is an integrity object, never owner authority. */
import type { JsonObject } from "../core/contracts";
import { discoveryV2Hash, type ReviewerDecisionV2, type BoundedLearningTestV2 } from "../products/discovery-v2";
import { REVIEWER_DECISION_V2_SCHEMA } from "../products/discovery-v2-worker-contract";
import { validateGenerationRouteProof } from "../research/generation-route";
import { assertJsonSchemaValue } from "../workers/schema-validator";
import type { FocusedPilotProfile } from "../products/discovery-r12-focused-pilot-contract";
import type { PrintSpecification } from "./types";

export const FOCUSED_ADOPTION_VERSION = "r12.focused-adoption.1" as const;
export type FocusedPilotAdoptionProof = {
  version: typeof FOCUSED_ADOPTION_VERSION;
  adoptionId: string; businessId: string; candidateId: string; candidateIdentityHash: string;
  scopeId: string; scopeHash: string; profileHash: string; resultHash: string;
  planId: string; planHash: string; goalId: string; goalRevision: number; goalHash: string;
  dossierHash: string; assessmentHash: string; reviewHash: string; learningPlanHash: string; originalDesignConstraintsHash: string; maximumCreativeProposalMicrousd: number; executionConstraintsHash: string;
  originalResearchFundingRootId: string; researchMaximumMicrousd: 2000000;
  strategyArtifactId: string; strategyResponseHash: string; strategyCandidateHash: string; strategyRouteProofHash: string;
  reviewArtifactId: string; reviewResponseHash: string; reviewCandidateHash: string; reviewRouteProofHash: string;
  marketCountryCode: "GB"; maximumGenerations: 1;
  adoptedAt: string; expiresAt: string;
  executionAuthorized: false; publicationAllowed: false; commerceAllowed: false;
};
export type FocusedPilotExecutionConstraint = {
  dimension: "policy_ip_risk" | "production_complexity"; question: string; reason: string; blockingForTest: false;
};
export type FocusedPilotCreativeBinding = {
  adoption: FocusedPilotAdoptionProof;
  pinnedLearningPlan: BoundedLearningTestV2;
  executionConstraints: FocusedPilotExecutionConstraint[];
  originalDesignConstraints: FocusedPilotProfile["originalDesignConstraints"];
  creativeInstallationId: string;
  creativeInstallationSnapshotHash: string;
  physicalSpecificationHash: string;
};
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown) => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const UUID_FIELDS = ["adoptionId", "businessId", "candidateId", "scopeId", "planId", "goalId", "originalResearchFundingRootId", "strategyArtifactId", "reviewArtifactId"] as const;
const HASH_FIELDS = ["candidateIdentityHash", "scopeHash", "profileHash", "resultHash", "planHash", "goalHash", "dossierHash", "assessmentHash", "reviewHash", "learningPlanHash", "originalDesignConstraintsHash", "executionConstraintsHash", "strategyResponseHash", "strategyCandidateHash", "strategyRouteProofHash", "reviewResponseHash", "reviewCandidateHash", "reviewRouteProofHash"] as const;
const PROOF_KEYS = ["version", ...UUID_FIELDS, ...HASH_FIELDS, "goalRevision", "maximumCreativeProposalMicrousd", "researchMaximumMicrousd", "marketCountryCode", "maximumGenerations", "adoptedAt", "expiresAt", "executionAuthorized", "publicationAllowed", "commerceAllowed"].sort().join(",");
export function validateFocusedPilotAdoptionProof(raw: unknown, now = Date.now()): asserts raw is FocusedPilotAdoptionProof {
  if (!record(raw) || Object.keys(raw).sort().join(",") !== PROOF_KEYS || !Number.isFinite(now) || raw.version !== FOCUSED_ADOPTION_VERSION ||
      UUID_FIELDS.some(k => !uuid(raw[k])) || HASH_FIELDS.some(k => !hash(raw[k])) || !Number.isSafeInteger(raw.goalRevision) || Number(raw.goalRevision) < 1 ||
      !Number.isSafeInteger(raw.maximumCreativeProposalMicrousd) || Number(raw.maximumCreativeProposalMicrousd) < 1 || Number(raw.maximumCreativeProposalMicrousd) > 1000000 ||
      raw.researchMaximumMicrousd !== 2000000 || raw.marketCountryCode !== "GB" || raw.maximumGenerations !== 1 ||
      raw.executionAuthorized !== false || raw.publicationAllowed !== false || raw.commerceAllowed !== false ||
      typeof raw.adoptedAt !== "string" || !Number.isFinite(Date.parse(raw.adoptedAt)) || Date.parse(raw.adoptedAt) > now ||
      typeof raw.expiresAt !== "string" || !Number.isFinite(Date.parse(raw.expiresAt)) || Date.parse(raw.expiresAt) <= now ||
      Date.parse(raw.expiresAt) > Date.parse(raw.adoptedAt) + 86400000 || raw.strategyArtifactId === raw.reviewArtifactId) {
    throw new Error("Current exact focused-pilot adoption proof required.");
  }
}
/** Do not strip qualifiedRoute or change modelId to fit a legacy manifest. The
 * dedicated local grammar admits it, then the route validator checks every key. */
export function focusedPilotReviewSchema(): JsonObject {
  const schema = structuredClone(REVIEWER_DECISION_V2_SCHEMA);
  (schema.properties as Record<string, JsonObject>).execution = {
    type: "object", additionalProperties: false, required: ["modelId", "providerRequestId", "primaryOnly", "qualifiedRoute"],
    properties: {
      modelId: { type: "string", enum: ["anthropic/claude-haiku-4.5", "anthropic/claude-4.5-haiku-20251001"] },
      providerRequestId: { type: "string", minLength: 3, maxLength: 240 }, primaryOnly: { const: true },
      qualifiedRoute: { type: "object" },
    },
  };
  return schema;
}
export function validateFocusedPilotReviewBinding(review: unknown, candidateId: string, proof: FocusedPilotAdoptionProof, now = Date.now()): asserts review is ReviewerDecisionV2 {
  validateFocusedPilotAdoptionProof(proof, now);
  assertJsonSchemaValue(focusedPilotReviewSchema(), review, "Focused reviewed decision");
  const value = review as ReviewerDecisionV2;
  const route = validateGenerationRouteProof(value.execution.qualifiedRoute, { generationId: value.execution.providerRequestId,
    providerName: "Amazon Bedrock", requestedEndpoint: "amazon-bedrock/us", acceptedResponseModelIds: ["anthropic/claude-haiku-4.5", "anthropic/claude-4.5-haiku-20251001"] });
  if (value.candidateId !== candidateId || proof.candidateId !== candidateId || value.intentId !== proof.scopeId ||
      value.outcome !== "TEST" || value.marketCountryCode !== "GB" || value.dossierHash !== proof.dossierHash || value.assessmentHash !== proof.assessmentHash ||
      discoveryV2Hash(value) !== proof.reviewHash || route.proofHash !== proof.reviewRouteProofHash) {
    throw new Error("Focused TEST does not match its accepted immutable review and route.");
  }
}
export function validateFocusedPilotCreativeBinding(raw: unknown, approval: {
  businessId: string; candidateId: string; purpose: string; maximumGenerations: number; maximumMicrousd: number; expiresAt: string;
  printSpecification: PrintSpecification;
}, now = Date.now()): asserts raw is FocusedPilotCreativeBinding {
  if (!record(raw) || Object.keys(raw).sort().join(",") !== "adoption,creativeInstallationId,creativeInstallationSnapshotHash,executionConstraints,originalDesignConstraints,physicalSpecificationHash,pinnedLearningPlan" ||
      !uuid(raw.creativeInstallationId) || !hash(raw.creativeInstallationSnapshotHash) || !hash(raw.physicalSpecificationHash)) throw new Error("Exact focused creative installation and print binding required.");
  validateFocusedPilotAdoptionProof(raw.adoption, now);
  if (approval.purpose !== "candidate_production" || approval.businessId !== raw.adoption.businessId || approval.candidateId !== raw.adoption.candidateId ||
      approval.maximumGenerations !== 1 || approval.maximumMicrousd > raw.adoption.maximumCreativeProposalMicrousd ||
      discoveryV2Hash(raw.executionConstraints) !== raw.adoption.executionConstraintsHash ||
      discoveryV2Hash(raw.pinnedLearningPlan) !== raw.adoption.learningPlanHash || discoveryV2Hash(raw.originalDesignConstraints) !== raw.adoption.originalDesignConstraintsHash || !Number.isFinite(Date.parse(approval.expiresAt)) || Date.parse(approval.expiresAt) > Date.parse(raw.adoption.expiresAt) ||
      discoveryV2Hash(approval.printSpecification) !== raw.physicalSpecificationHash) throw new Error("Focused creative approval changed the adopted scope, expiry or explicit physical specification.");
}
