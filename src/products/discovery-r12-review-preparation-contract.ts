import type { OperatingPolicy } from "../core/admission-contract";
import type { R04BusinessContent, R04QuestContent } from "../core/quest-contract";
import { containsCredentialLikeValue } from "../core/quest-intake";
import { discoveryV2Hash } from "./discovery-v2";
import type { DiscoveryReviewContinuation } from "./discovery-r12-review-continuation";

export type R12ReviewOwnerProposal = {
  version: "r12.review-owner-proposal.1"; scopeId: string; scopeHash: string; businessId: string; ownerId: string; goalId: string;
  expectedBusinessRevision: number; expectedBusinessHash: string; expectedGoalRevision: number; expectedGoalHash: string;
  businessContent: R04BusinessContent; goalContent: R04QuestContent; operatingPolicy: OperatingPolicy; interpretationHash: string;
};
export type R12ReviewConfirmation = { policyId: string; policyHash: string; businessRevision: number; goalRevision: number };
export type R12ReviewOwnerWorkspace = {
  version: "r12.review-owner-workspace.1"; businessId: string; scopeId: string; scope: DiscoveryReviewContinuation;
  proposalHash: string; proposal: R12ReviewOwnerProposal; confirmation: R12ReviewConfirmation | null; eligible: boolean; reason: string | null;
};
export type R12ReviewSetupReceipt = R12ReviewConfirmation & { businessId: string; scopeId: string; goalId: string; proposalHash: string; controllerKeyHash: string; admissionKeyHash: string; executionAuthorized: false };
export type R12ReviewPreparationState = { message: string; receipt: R12ReviewSetupReceipt | null };
export const r12ReviewUuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const revision = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;
const money = (v: unknown): v is string => typeof v === "string" && /^(0|[1-9][0-9]{0,15})$/.test(v) && Number.isSafeInteger(Number(v));
const fail = (): never => { throw Error("r12_review_preparation_unavailable"); };
export function parseR12ReviewOwnerWorkspace(raw: unknown, businessId: string, requestedScopeId: string, ownerId: string): R12ReviewOwnerWorkspace {
  if (!object(raw) || raw.version !== "r12.review-owner-workspace.1" || raw.businessId !== businessId || !r12ReviewUuid(raw.scopeId) || !hash(raw.proposalHash) || !object(raw.scope) || !object(raw.proposal) || typeof raw.eligible !== "boolean" ||
      !(raw.reason === null || typeof raw.reason === "string" && /^[a-z][a-z0-9_]{0,100}$/.test(raw.reason)) || containsCredentialLikeValue(raw)) return fail();
  const s = raw.scope, p = raw.proposal;
  const successor = s.version === "r12.discovery-review-continuation.2", history = successor && Array.isArray(s.reviewHistory) ? s.reviewHistory : [];
  if (successor && (history.length < 1 || history.length > 2 || !r12ReviewUuid(s.predecessorPlanId) || history.some(item => !object(item) || !r12ReviewUuid(item.scopeId) || !r12ReviewUuid(item.planId) || !money(item.actualMicrounits)) || s.predecessorPlanId !== (history.at(-1) as Record<string, unknown>).planId)) return fail();
  if (raw.proposalHash !== discoveryV2Hash(p)) return fail();
  if (!["r12.discovery-review-continuation.1", "r12.discovery-review-continuation.2"].includes(String(s.version)) || s.id !== raw.scopeId || s.businessId !== businessId || !r12ReviewUuid(s.goalId) || !r12ReviewUuid(s.sourceScopeId) || ![raw.scopeId, s.sourceScopeId].includes(requestedScopeId) ||
      s.baseDispatches !== 4 + history.length || s.baseChildren !== 5 + history.length || !money(s.baseKnownMicrounits) || !Array.isArray(s.sourcePhases) || s.sourcePhases.length !== 4 || s.sourcePhases.some((phase, index) => !object(phase) || phase.stepKey !== ["plan", "search1", "select1", "strategy"][index]) ||
      typeof s.approvedQuery !== "string" || s.approvedQuery.length > 800 || typeof s.expiresAt !== "string" || !Number.isFinite(Date.parse(s.expiresAt)) ||
      p.version !== "r12.review-owner-proposal.1" || p.scopeId !== raw.scopeId || p.scopeHash !== discoveryV2Hash(s) || p.businessId !== businessId || p.ownerId !== ownerId || p.goalId !== s.goalId ||
      !revision(p.expectedBusinessRevision) || !revision(p.expectedGoalRevision) || ![p.expectedBusinessHash, p.expectedGoalHash, p.interpretationHash].every(hash) || !object(p.businessContent) || !object(p.goalContent) || !object(p.operatingPolicy)) return fail();
  const businessContent = p.businessContent, goalContent = p.goalContent;
  if (["brandContext", "operatingRules", "allowedActivity", "restrictions"].some(key => typeof businessContent[key] !== "string" || String(businessContent[key]).length > 12000) ||
      ["title", "originalIntent", "objective"].some(key => typeof goalContent[key] !== "string") || !object(p.goalContent.parsed) || !Array.isArray(p.goalContent.ambiguities)) return fail();
  const policy = p.operatingPolicy;
  if (policy.version !== "r05.1" || policy.goalId !== s.goalId || policy.businessRevision !== p.expectedBusinessRevision + 1 || policy.goalRevision !== p.expectedGoalRevision + 2 || policy.currency !== "USD" || policy.maximumDispatches !== 1 ||
      !money(policy.policyLimitMicrounits) || Number(policy.policyLimitMicrounits) <= 0 || !money(policy.businessLifetimeLimitMicrounits) || !Array.isArray(policy.operations) || policy.operations.length !== 1 ||
      !object(policy.operations[0]) || policy.operations[0].operationKey !== `research.r12.${s.id}.review` || policy.operations[0].maximumPerOperationMicrounits !== policy.policyLimitMicrounits ||
      typeof policy.expiresAt !== "string" || !Number.isFinite(Date.parse(policy.expiresAt))) return fail();
  if (raw.confirmation !== null && (!object(raw.confirmation) || !r12ReviewUuid(raw.confirmation.policyId) || !hash(raw.confirmation.policyHash) || raw.confirmation.businessRevision !== policy.businessRevision || raw.confirmation.goalRevision !== policy.goalRevision)) return fail();
  return structuredClone(raw) as R12ReviewOwnerWorkspace;
}
export function r12ReviewPreparationHref(businessId: string, scopeId: string) {
  if (!r12ReviewUuid(businessId) || !r12ReviewUuid(scopeId)) return fail();
  return "/dashboard?" + new URLSearchParams({ view: "research", type: "r12-review-prepare", business: businessId, selected: scopeId });
}
