import { validateAdaptiveFundingProof, type AdaptiveFundingProof } from './discovery-r12-adaptive-funding-proof';
import { containsCredentialLikeValue } from "../core/quest-intake";
import { discoveryV2Hash, type DiscoveryIntentV2 } from "./discovery-v2";
import { selectAdaptiveOwnerResearchPublicScope, type AdaptiveOwnerResearchProfile, type OwnerResearchFunding, type OwnerResearchPublicSelection } from "./discovery-r12-goal-scope";
import type { OwnerEpisodeClosure } from "./discovery-r12-owner-episode";
import { validateAdaptiveResearchPreview, type AdaptiveResearchPreview } from "./discovery-r12-adaptive-scope";
import type { OwnerObservationSelection } from "./discovery-r12-owner-observation";

/** Immutable activated envelope. Action intents have their own identities; this
 * original scope is never rewritten when a follow-up selects another question. */
export type DiscoveryAdaptiveOwnerScope = {
  version: "r12.discovery-owner-adaptive.1" | "r12.discovery-owner-adaptive.2";
  id: string; businessId: string; goalId: string;
  goalRevision: number; goalHash: string; businessRevision: number; businessHash: string;
  setupId: string; setupHash: string;
  profile: AdaptiveOwnerResearchProfile; profileHash: string; selection: OwnerResearchPublicSelection;
  funding: OwnerResearchFunding;
  fundingApproval: { revision: number; hash: string; maximumMicrounits: string };
  intent: DiscoveryIntentV2;
  allowedDomains: string[]; excludedDomains: string[]; approvedQuery: string;
  approvalHash: string; independentReviewHash: string;
  predecessorClosure: OwnerEpisodeClosure; predecessorClosureHash: string;
  imports: AdaptiveResearchPreview["imports"];
  ownerObservationRef: OwnerObservationSelection | null;
  quoteHash: string; maximumActions: number; maximumPaidCalls: number; maximumRunMicrounits: string;
  createdAt: string; expiresAt: string;
};
const fail = (): never => { throw new Error("r12_adaptive_execution_scope_unverified"); };
const id = (v: unknown) => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const same = (a: unknown,b: unknown) => discoveryV2Hash(a) === discoveryV2Hash(b);
export function validateAdaptiveExecutionScope(scope: DiscoveryAdaptiveOwnerScope,preview: AdaptiveResearchPreview,now=Date.now(),fundingProof:AdaptiveFundingProof|null=null) {
  const p = validateAdaptiveResearchPreview(preview,now),c=p.predecessor;
  const ownerCapture = p.version === "r12.adaptive-research-preview.2";
  if (!scope || containsCredentialLikeValue(scope) || Object.keys(scope).sort().join(",") !==
      "allowedDomains,approvalHash,approvedQuery,businessHash,businessId,businessRevision,createdAt,excludedDomains,expiresAt,funding,fundingApproval,goalHash,goalId,goalRevision,id,imports,independentReviewHash,intent,maximumActions,maximumPaidCalls,maximumRunMicrounits,ownerObservationRef,predecessorClosure,predecessorClosureHash,profile,profileHash,quoteHash,selection,setupHash,setupId,version" ||
      scope.version !== (ownerCapture ? "r12.discovery-owner-adaptive.2" : "r12.discovery-owner-adaptive.1") ||
      scope.profile?.version !== (ownerCapture ? "r12.owner-research-profile.3" : "r12.owner-research-profile.2") || ![scope.id,scope.setupId].every(id) || ![scope.setupHash,scope.approvalHash].every(hash) ||
      scope.businessId !== p.businessId || scope.goalId !== p.goalId || scope.profile.id !== p.profileId || scope.profileHash !== p.profileHash || discoveryV2Hash(scope.profile) !== p.profileHash ||
      scope.goalRevision !== c.goalRevision || scope.goalHash !== c.goalHash || scope.businessRevision !== c.businessRevision || scope.businessHash !== c.businessHash ||
      !same(scope.predecessorClosure,c) || scope.predecessorClosureHash !== p.predecessorHash || !same(scope.imports,p.imports) ||
      !same(scope.ownerObservationRef,p.ownerObservationRef) ||
      scope.quoteHash !== p.quoteHash || scope.maximumActions !== p.maximumActions || scope.maximumPaidCalls !== p.maximumPaidCalls || scope.maximumRunMicrounits !== p.maximumRunMicrounits ||
      scope.expiresAt !== p.expiresAt || scope.independentReviewHash !== scope.profile.independentReviewHash || !Number.isFinite(Date.parse(scope.createdAt)) || Date.parse(scope.createdAt) > now) return fail();
  const selected=selectAdaptiveOwnerResearchPublicScope(scope.profile,scope.selection,now);
  validateAdaptiveFundingProof(scope,p,fundingProof);
  if (!same(scope.allowedDomains,selected.allowedDomains) || !same(scope.excludedDomains,selected.excludedDomains) || scope.approvedQuery !== selected.approvedQuery ||
      scope.funding.authorityRootId !== c.authorityRootId || scope.funding.priorRoundId !== c.priorRoundId || scope.funding.originalSemanticGoalHash !== c.originalSemanticGoalHash ||
      !id(scope.funding.bindingId) || scope.funding.kind !== (c.priorRoundId === null ? "r05_business" : "legacy_research_root") ||
      !scope.intent || scope.intent.businessId !== p.businessId || !id(scope.intent.id) || scope.intent.limits.maximumMicrousd !== Number(p.maximumRunMicrounits) ||
      ownerCapture && scope.intent.limits.maximumNewCollections !== 0 ||
      scope.intent.expiresAt !== p.expiresAt || !same(scope.intent.comparisonUniverse.markets,selected.markets) ||
      !same(scope.intent.comparisonUniverse.sourceDomains,selected.allowedDomains) || !same(scope.intent.comparisonUniverse.audiences,[selected.audience]) ||
      scope.intent.comparisonUniverse.selectionQuestion !== selected.approvedQuery) return fail();
  return structuredClone(scope);
}
