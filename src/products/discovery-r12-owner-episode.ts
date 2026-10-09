import { containsCredentialLikeValue } from "../core/quest-intake";
import type { QuestPlan } from "../core/quest-plan";
import { discoveryV2Hash } from "./discovery-v2";
import { bindValidatedOwnerResearchIntent } from "./discovery-r12-goal-intent";
import { validateDiscoveryOwnerInitialScope, type DiscoveryOwnerInitialScope } from "./discovery-r12-goal-scope";

/** A projection of private, immutable closure evidence. Validation of this
 * projection is not authority: SQL reconstructs the actual history under locks. */
export type OwnerStoppedBeforeReservation = {
  version: "r12.owner-stopped-before-reservation.1";
  businessId: string; goalId: string; ownerId: string;
  scopeId: string; scopeHash: string; planId: string; planHash: string; planVersion: number;
  attemptId: string; attemptHash: string; childId: string; childHash: string;
  policyId: string; policyHash: string; revocationsHash: string; absenceHash: string;
};
export type OwnerEpisodeClosure = {
  version: "r12.owner-episode-closure.1";
  businessId: string; goalId: string;
  predecessorPlanId: string; predecessorPlanHash: string; predecessorPlanVersion: number;
  predecessorScopeId: string; predecessorScopeHash: string;
  goalRevision: number; goalHash: string; businessRevision: number; businessHash: string;
  authorityRootId: string; priorRoundId: string | null; originalSemanticGoalHash: string | null;
  headRevision: number; headState: string; headReason: string;
  baseChildren: number; baseDispatches: number; baseRepairs: number; basePivots: number;
  baseKnownMicrounits: string; historyHash: string;
  /** Optional only for canonical proofs of revoked, never-reserved scheduled
   * planners. Omitted (not an empty array) preserves historical V1 bytes. */
  stoppedBeforeReservation?: OwnerStoppedBeforeReservation[];
};
export type DiscoveryOwnerEpisodeScope = Omit<DiscoveryOwnerInitialScope, "version"> & {
  version: "r12.discovery-owner-episode.1";
  episodeNumber: number;
  predecessorClosure: OwnerEpisodeClosure;
  predecessorClosureHash: string;
};
const fail = (): never => { throw new Error("r12_owner_episode_unverified"); };
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const integer = (v: unknown, min: number, max: number) => Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
export const isDiscoveryOwnerEpisodeScope = (value: { version: string }): value is DiscoveryOwnerEpisodeScope => value.version === "r12.discovery-owner-episode.1";

export function validateOwnerEpisodeClosure(value: unknown): OwnerEpisodeClosure {
  if (!value || typeof value !== "object" || Array.isArray(value) || containsCredentialLikeValue(value)) return fail();
  const v = value as OwnerEpisodeClosure;
  const keys = "version,businessId,goalId,predecessorPlanId,predecessorPlanHash,predecessorPlanVersion,predecessorScopeId,predecessorScopeHash,goalRevision,goalHash,businessRevision,businessHash,authorityRootId,priorRoundId,originalSemanticGoalHash,headRevision,headState,headReason,baseChildren,baseDispatches,baseRepairs,basePivots,baseKnownMicrounits,historyHash" +
    (Object.hasOwn(v, "stoppedBeforeReservation") ? ",stoppedBeforeReservation" : "");
  if (Object.keys(v).sort().join(",") !== keys.split(",").sort().join(",") || v.version !== "r12.owner-episode-closure.1" ||
      ![v.businessId, v.goalId, v.predecessorPlanId, v.predecessorScopeId, v.authorityRootId].every(uuid) ||
      ![v.predecessorPlanHash, v.predecessorScopeHash, v.goalHash, v.businessHash, v.historyHash].every(hash) ||
      !integer(v.predecessorPlanVersion, 1, 32) || !integer(v.goalRevision, 1, 999999999) || !integer(v.businessRevision, 1, 999999999) ||
      !integer(v.headRevision, 0, Number.MAX_SAFE_INTEGER) || !integer(v.baseChildren, 0, 27) || !integer(v.baseDispatches, 0, 59) ||
      !integer(v.baseRepairs, 0, 8) || !integer(v.basePivots, 0, 3) ||
      !["ready", "running", "waiting", "paused", "blocked", "needs_owner", "stopped", "completed"].includes(v.headState) ||
      typeof v.headReason !== "string" || v.headReason.length > 240 ||
      typeof v.baseKnownMicrounits !== "string" || !/^(0|[1-9][0-9]{0,15})$/.test(v.baseKnownMicrounits) || BigInt(v.baseKnownMicrounits) > BigInt(Number.MAX_SAFE_INTEGER)) return fail();
  if (v.authorityRootId === v.businessId) {
    if (v.priorRoundId !== null || v.originalSemanticGoalHash !== null) return fail();
  } else if (!uuid(v.priorRoundId) || !hash(v.originalSemanticGoalHash)) return fail();
  if (Object.hasOwn(v, "stoppedBeforeReservation")) {
    const proofs = v.stoppedBeforeReservation;
    if (!Array.isArray(proofs) || proofs.length < 1 || proofs.length > 8 || proofs.length > v.baseChildren) return fail();
    const proofKeys = "version,businessId,goalId,ownerId,scopeId,scopeHash,planId,planHash,planVersion,attemptId,attemptHash,childId,childHash,policyId,policyHash,revocationsHash,absenceHash".split(",").sort().join(",");
    let priorVersion = 0;
    const identities = new Set<string>();
    for (const proof of proofs) {
      if (!proof || typeof proof !== "object" || Array.isArray(proof) || Object.keys(proof).sort().join(",") !== proofKeys ||
          proof.version !== "r12.owner-stopped-before-reservation.1" || proof.businessId !== v.businessId || proof.goalId !== v.goalId ||
          ![proof.ownerId, proof.scopeId, proof.planId, proof.attemptId, proof.childId, proof.policyId].every(uuid) ||
          ![proof.scopeHash, proof.planHash, proof.attemptHash, proof.childHash, proof.policyHash, proof.revocationsHash, proof.absenceHash].every(hash) ||
          !integer(proof.planVersion, priorVersion + 1, v.predecessorPlanVersion)) return fail();
      for (const key of [proof.scopeId, proof.planId, proof.attemptId, proof.childId, proof.policyId]) {
        if (identities.has(key)) return fail();
        identities.add(key);
      }
      if (proof.planVersion === v.predecessorPlanVersion && (proof.planId !== v.predecessorPlanId || proof.planHash !== v.predecessorPlanHash ||
          proof.scopeId !== v.predecessorScopeId || proof.scopeHash !== v.predecessorScopeHash)) return fail();
      priorVersion = proof.planVersion;
    }
  }
  return structuredClone(v);
}

export function validateDiscoveryOwnerEpisodeScope(scope: DiscoveryOwnerEpisodeScope, now = Date.now()): DiscoveryOwnerEpisodeScope {
  if (!scope || scope.version !== "r12.discovery-owner-episode.1" || !integer(scope.episodeNumber, 1, 5) || !hash(scope.predecessorClosureHash)) return fail();
  const closure = validateOwnerEpisodeClosure(scope.predecessorClosure);
  if (discoveryV2Hash(closure) !== scope.predecessorClosureHash || closure.businessId !== scope.businessId || closure.goalId !== scope.goalId ||
      closure.goalRevision !== scope.goalRevision || closure.goalHash !== scope.goalHash || closure.businessRevision !== scope.businessRevision || closure.businessHash !== scope.businessHash ||
      closure.authorityRootId !== scope.funding?.authorityRootId || closure.priorRoundId !== scope.funding?.priorRoundId || closure.originalSemanticGoalHash !== scope.funding?.originalSemanticGoalHash ||
      closure.predecessorScopeId === scope.id) return fail();
  const { episodeNumber: _episode, predecessorClosure: _closure, predecessorClosureHash: _hash, ...common } = scope;
  void _episode; void _closure; void _hash;
  // Reuse the profile, funding and five-phase intent checks only. Never expose
  // the temporary structural view as an initial scope or execution authority.
  validateDiscoveryOwnerInitialScope({ ...common, version: "r12.discovery-owner-initial.1" }, now);
  bindValidatedOwnerResearchIntent(scope.intent, { scopeId: scope.id, scopeHash: discoveryV2Hash(scope), approvedQuery: scope.approvedQuery }, now);
  return structuredClone(scope);
}

/** Plan compilation alone cannot prove the baseline. Bind the exact cumulative
 * limits to the closure before the existing five-phase runtime consumes it. */
export function validateOwnerEpisodePlan(plan: QuestPlan, scope: DiscoveryOwnerEpisodeScope): void {
  const c = scope.predecessorClosure;
  const allocation = BigInt(scope.intent.limits.maximumMicrousd);
  if (plan.format !== "r12.discovery-episode.1" || plan.businessId !== scope.businessId || plan.goalId !== scope.goalId ||
      plan.discoveryScopeId !== scope.id || plan.discoveryScopeHash !== discoveryV2Hash(scope) ||
      plan.maximumChildren !== c.baseChildren + 5 || plan.maximumDispatches !== c.baseDispatches + 5 ||
      BigInt(plan.maximumMicrounits) !== BigInt(c.baseKnownMicrounits) + allocation ||
      plan.steps.reduce((sum, step) => sum + BigInt(step.maximumMicrounits), BigInt(0)) !== allocation) return fail();
}
