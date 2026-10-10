import { containsCredentialLikeValue } from "../core/quest-intake";
import { compileQuestPlan, type QuestPlan } from "../core/quest-plan";
import { discoveryV2Hash } from "./discovery-v2";
import { validateOwnerEpisodeClosure, type OwnerEpisodeClosure } from "./discovery-r12-owner-episode";
import { DISCOVERY_R12_PHASES, type DiscoveryR12Phase } from "./discovery-r12-wire";
import { validateOwnerObservationSelection, type OwnerObservationSelection } from "./discovery-r12-owner-observation";

/** Read-only preparation contract. Neither this packet nor its validation
 * creates authority. SQL must reconstruct closure, receipts and current caps. */
export type AdaptiveResearchPreview = {
  version: "r12.adaptive-research-preview.1" | "r12.adaptive-research-preview.2";
  businessId: string; goalId: string;
  predecessor: OwnerEpisodeClosure; predecessorHash: string;
  imports: Array<{ phase: DiscoveryR12Phase; attemptId: string; artifactId: string;
    responseHash: string; receiptProofHash: string }>;
  profileId: string; profileHash: string;
  quoteHash: string; expiresAt: string;
  ownerObservationRef: OwnerObservationSelection | null;
  maximumActions: number; maximumPaidCalls: number; maximumNewChildren: 3 | 5;
  maximumRunMicrounits: string;
  funding: { authorityRootId: string; bindingHash: string; revision: number;
    committedMicrounits: string; pendingMicrounits: string; currentLimitMicrounits: string;
    proposedLimitMicrounits: string; hasUnknown: boolean };
  business: { capRevision: number; committedMicrounits: string;
    currentLimitMicrounits: string; proposedLimitMicrounits: string; hasUnknown: boolean };
  authorityCreated: false;
};

export const ADAPTIVE_RESEARCH_RUN_CEILING_MICROUNITS = "10000000";
export const ADAPTIVE_RESEARCH_ACTION_CEILING = 10;
const fail = (): never => { throw new Error("r12_adaptive_preview_unverified"); };
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const integer = (v: unknown, low: number, high: number) => Number.isSafeInteger(v) && Number(v) >= low && Number(v) <= high;
const money = (v: unknown): bigint => typeof v === "string" && /^(0|[1-9][0-9]{0,15})$/.test(v) && BigInt(v) <= BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(v) : fail();
const exact = (v: unknown, keys: string): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join(",") === keys.split(",").sort().join(",");

/** Ten high-level actions are an effort ceiling, not ten free compound calls.
 * New phase capability slots are children; every separately pinned paid attempt,
 * including failure and escalation, consumes dispatch capacity.
 * Existing Business/root exposure overlap; each cap is checked separately. */
export function validateAdaptiveResearchPreview(value: unknown, now = Date.now()): AdaptiveResearchPreview {
  if (!exact(value, "version,businessId,goalId,predecessor,predecessorHash,imports,profileId,profileHash,quoteHash,expiresAt,maximumActions,maximumPaidCalls,maximumNewChildren,maximumRunMicrounits,funding,business,authorityCreated,ownerObservationRef") || containsCredentialLikeValue(value)) return fail();
  const v = value as unknown as AdaptiveResearchPreview;
  validateOwnerObservationSelection(v.ownerObservationRef);
  const ownerCapture = v.version === "r12.adaptive-research-preview.2";
  if (!(["r12.adaptive-research-preview.1", "r12.adaptive-research-preview.2"] as string[]).includes(v.version) || ownerCapture && v.ownerObservationRef === null || v.authorityCreated !== false || ![v.businessId, v.goalId, v.profileId].every(uuid) ||
      ![v.predecessorHash, v.profileHash, v.quoteHash].every(hash) || !Number.isFinite(now) || typeof v.expiresAt !== "string" ||
      !Number.isFinite(Date.parse(v.expiresAt)) || Date.parse(v.expiresAt) <= now ||
      !integer(v.maximumActions, 1, ADAPTIVE_RESEARCH_ACTION_CEILING) || !integer(v.maximumPaidCalls, ownerCapture ? 3 : 5, 64) || v.maximumNewChildren !== (ownerCapture ? 3 : 5)) return fail();
  const c = validateOwnerEpisodeClosure(v.predecessor);
  if (discoveryV2Hash(c) !== v.predecessorHash || c.businessId !== v.businessId || c.goalId !== v.goalId ||
      c.baseChildren + v.maximumNewChildren > 32 || c.baseDispatches + v.maximumPaidCalls > 64) return fail();
  const budget = money(v.maximumRunMicrounits);
  if (budget <= BigInt(0) || budget > BigInt(ADAPTIVE_RESEARCH_RUN_CEILING_MICROUNITS)) return fail();
  if (!Array.isArray(v.imports) || v.imports.length !== DISCOVERY_R12_PHASES.length) return fail();
  const attempts = new Set<string>(), artifacts = new Set<string>();
  for (const [index, p] of v.imports.entries()) {
    if (!exact(p, "phase,attemptId,artifactId,responseHash,receiptProofHash") || p.phase !== DISCOVERY_R12_PHASES[index] ||
        ![p.attemptId, p.artifactId].every(uuid) || ![p.responseHash, p.receiptProofHash].every(hash) || attempts.has(p.attemptId) || artifacts.has(p.artifactId)) return fail();
    attempts.add(p.attemptId); artifacts.add(p.artifactId);
  }
  if (!exact(v.funding, "authorityRootId,bindingHash,revision,committedMicrounits,pendingMicrounits,currentLimitMicrounits,proposedLimitMicrounits,hasUnknown") ||
      !exact(v.business, "capRevision,committedMicrounits,currentLimitMicrounits,proposedLimitMicrounits,hasUnknown") ||
      v.funding.authorityRootId !== c.authorityRootId || !hash(v.funding.bindingHash) || !integer(v.funding.revision, 0, Number.MAX_SAFE_INTEGER) ||
      !integer(v.business.capRevision, 1, Number.MAX_SAFE_INTEGER) || v.funding.hasUnknown !== false || v.business.hasUnknown !== false || money(v.funding.pendingMicrounits) !== BigInt(0)) return fail();
  for (const ledger of [v.funding, v.business]) {
    const committed = money(ledger.committedMicrounits), current = money(ledger.currentLimitMicrounits), proposed = money(ledger.proposedLimitMicrounits);
    if (current < committed || proposed < current || proposed < committed + budget) return fail();
  }
  if (money(v.funding.committedMicrounits) < money(c.baseKnownMicrounits)) return fail();
  // Native funding is the Business cap itself, not a second allowance.
  if (c.authorityRootId === v.businessId &&
      (v.funding.revision !== v.business.capRevision ||
       v.funding.committedMicrounits !== v.business.committedMicrounits ||
       v.funding.currentLimitMicrounits !== v.business.currentLimitMicrounits ||
       v.funding.proposedLimitMicrounits !== v.business.proposedLimitMicrounits)) return fail();
  return structuredClone(v);
}

/** Compilation is structural only; exact activation and original root accounting
 * are independently reconstructed by SQL before accepting the new plan. */
export function validateAdaptiveResearchPlan(raw: unknown, preview: AdaptiveResearchPreview,
  scope: { id: string; hash: string }, now = Date.now()): QuestPlan {
  const p = validateAdaptiveResearchPreview(preview, now), c = p.predecessor, plan = compileQuestPlan(raw);
  if (!uuid(scope.id) || !hash(scope.hash) || plan.format !== (p.version === "r12.adaptive-research-preview.2" ? "r12.discovery-adaptive.2" : "r12.discovery-adaptive.1") ||
      plan.businessId !== p.businessId || plan.goalId !== p.goalId || plan.goalRevision !== c.goalRevision || plan.goalHash !== c.goalHash ||
      plan.businessRevision !== c.businessRevision || plan.businessHash !== c.businessHash ||
      plan.discoveryScopeId !== scope.id || plan.discoveryScopeHash !== scope.hash ||
      plan.maximumChildren !== c.baseChildren + p.maximumNewChildren || plan.maximumDispatches !== c.baseDispatches + p.maximumPaidCalls ||
      plan.maximumRepairs !== c.baseRepairs + p.maximumActions || plan.maximumPivots !== c.basePivots + p.maximumActions ||
      money(plan.maximumMicrounits) !== money(c.baseKnownMicrounits) + money(p.maximumRunMicrounits) ||
      plan.expiresAt !== p.expiresAt || plan.steps.some(s => s.maximumMicrounits !== p.maximumRunMicrounits)) return fail();
  return plan;
}

/** Owner-facing limits remain explicit even when the caller requested ten
 * compound investigations. This does not change any historical lifetime bound. */
export function adaptiveResearchRemainingCapacity(closure: OwnerEpisodeClosure, version: AdaptiveResearchPreview["version"] = "r12.adaptive-research-preview.1") {
  const c = validateOwnerEpisodeClosure(closure);
  if (!["r12.adaptive-research-preview.1", "r12.adaptive-research-preview.2"].includes(version)) return fail();
  const requiredChildren = version === "r12.adaptive-research-preview.2" ? 3 : 5;
  return { children: 32 - c.baseChildren, dispatches: 64 - c.baseDispatches,
    maximumPaidCalls: c.baseChildren + requiredChildren <= 32 ? 64 - c.baseDispatches : 0 };
}
