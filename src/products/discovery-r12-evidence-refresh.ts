import { createHash } from 'node:crypto';
import { discoveryV2Hash } from './discovery-v2';
import type { DiscoveryFocusedPilot } from './discovery-r12-focused-pilot-scope';

export type R12EvidenceRefreshPair = {
  priorObservationId: string; refreshedObservationId: string;
  priorObservationHash: string; refreshedObservationHash: string;
  factSpanHash: string; pairReviewHash: string;
};
export type R12EvidenceRefresh = {
  version: 'r12.focused-pilot-evidence-refresh.1'; businessId: string; ownerId: string;
  scopeId: string; goalId: string; budgetAuthorityRootId: string;
  abandonedScopeId: string; abandonedScopeHash: string;
  priorObservationsHash: string; refreshedObservationsHash: string;
  priorAddendumHash: string; refreshedAddendumHash: string;
  priorEvidenceRefsHash: string; refreshedEvidenceRefsHash: string;
  ownerApprovalEvidenceHash: string; independentReviewHash: string;
  reviewedAt: string; pairs: R12EvidenceRefreshPair[];
};
type Pins = {
  businessId: string; ownerId: string; scopeId: string; goalId: string;
  budgetAuthorityRootId: string; abandonedScopeId: string; abandonedScopeHash: string;
  ownerApprovalEvidenceHash: string; createdAt: string; scope?: DiscoveryFocusedPilot;
};
const fail = (): never => { throw Error('r12_recovery_evidence_refresh_unverified'); };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: unknown, keys: string) => {
  if (!object(v) || Object.keys(v).sort().join(',') !== keys.split(',').sort().join(',')) return fail();
  return v;
};
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const observationId = (v: unknown): v is string => typeof v === 'string' && /^evi-[a-f0-9]{24}$/.test(v);

/** Checks the projected certificate and current profile. SQL independently
 * reconstructs the immutable predecessor and compares every old/new cited fact.
 * Hashes bind reviewed evidence; they cannot attest that a source was retrieved. */
export function validateR12EvidenceRefresh(raw: unknown, pins: Pins, now?: number): R12EvidenceRefresh {
  const c = exact(raw, 'version,businessId,ownerId,scopeId,goalId,budgetAuthorityRootId,abandonedScopeId,abandonedScopeHash,priorObservationsHash,refreshedObservationsHash,priorAddendumHash,refreshedAddendumHash,priorEvidenceRefsHash,refreshedEvidenceRefsHash,ownerApprovalEvidenceHash,independentReviewHash,reviewedAt,pairs');
  if (c.version !== 'r12.focused-pilot-evidence-refresh.1' || Buffer.byteLength(JSON.stringify(raw), 'utf8') > 8192 ||
      ['businessId','ownerId','scopeId','goalId','budgetAuthorityRootId','abandonedScopeId','abandonedScopeHash','ownerApprovalEvidenceHash'].some(key => c[key] !== pins[key as keyof Pins]) ||
      !['abandonedScopeHash','priorObservationsHash','refreshedObservationsHash','priorAddendumHash','refreshedAddendumHash','priorEvidenceRefsHash','refreshedEvidenceRefsHash','ownerApprovalEvidenceHash','independentReviewHash'].every(key => hash(c[key])) ||
      c.ownerApprovalEvidenceHash === c.independentReviewHash || typeof c.reviewedAt !== 'string' || !Number.isFinite(Date.parse(c.reviewedAt)) ||
      Date.parse(c.reviewedAt) > Date.parse(pins.createdAt) || now !== undefined && (!Number.isFinite(now) || Date.parse(c.reviewedAt) > now) ||
      !Array.isArray(c.pairs) || c.pairs.length < 1 || c.pairs.length > 8) return fail();
  const prior = new Set<string>(), fresh = new Set<string>();
  for (const value of c.pairs) {
    const pair = exact(value, 'priorObservationId,refreshedObservationId,priorObservationHash,refreshedObservationHash,factSpanHash,pairReviewHash');
    if (!observationId(pair.priorObservationId) || !observationId(pair.refreshedObservationId) || prior.has(pair.priorObservationId) || fresh.has(pair.refreshedObservationId) ||
        !['priorObservationHash','refreshedObservationHash','factSpanHash','pairReviewHash'].every(key => hash(pair[key]))) return fail();
    if (pair.pairReviewHash !== discoveryV2Hash({ version: 'r12.focused-pilot-evidence-pair-review.1', scopeId: c.scopeId,
      priorObservationHash: pair.priorObservationHash, refreshedObservationHash: pair.refreshedObservationHash, factSpanHash: pair.factSpanHash,
      independentReviewHash: c.independentReviewHash, reviewedAt: c.reviewedAt })) return fail();
    prior.add(pair.priorObservationId); fresh.add(pair.refreshedObservationId);
  }
  if ([...prior].some(value => fresh.has(value))) return fail();
  const e = pins.scope;
  if (e) {
    const addendum = e.profile.observations, observations = addendum.observations;
    if (c.independentReviewHash !== e.independentReviewHash || c.independentReviewHash !== addendum.independentReviewHash ||
        c.ownerApprovalEvidenceHash !== addendum.approvalHash || c.refreshedAddendumHash !== discoveryV2Hash(addendum) ||
        c.refreshedObservationsHash !== discoveryV2Hash(observations) || c.refreshedEvidenceRefsHash !== discoveryV2Hash(e.profile.pinnedLearningPlan.evidenceRefs) ||
        c.pairs.length !== observations.length) return fail();
    for (const [index, observation] of observations.entries()) {
      const pair = c.pairs[index] as R12EvidenceRefreshPair;
      const span = Array.from(observation.context).slice(observation.start, observation.end).join('');
      if (pair.refreshedObservationId !== observation.id || pair.refreshedObservationHash !== discoveryV2Hash(observation) ||
          pair.factSpanHash !== createHash('sha256').update(span).digest('hex') || !span ||
          Date.parse(observation.retrievedAt) > Date.parse(c.reviewedAt) || pair.pairReviewHash === observation.sourceReviewHash ||
          observation.sourceReviewHash === c.independentReviewHash || observation.sourceReviewHash === c.ownerApprovalEvidenceHash) return fail();
    }
  }
  return structuredClone(raw) as R12EvidenceRefresh;
}
