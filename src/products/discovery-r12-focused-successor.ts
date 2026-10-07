import { containsCredentialLikeValue } from '../core/quest-intake';
import { discoveryV2Hash } from './discovery-v2';
import type { DiscoveryFocusedPilot } from './discovery-r12-focused-pilot-scope';

export const R12_FOCUSED_SUCCESSOR_LIMITS = Object.freeze({ maximumSuccessors: 1, maximumPaidCalls: 2, maximumReceiptGets: 6,
  maximumReceiptGetsPerCall: 3, dispatchWindowSeconds: 1800, receiptGraceSeconds: 1800, maximumMicrousd: 277907,
  maximumStrategyMicrousd: 66671, maximumReviewMicrousd: 211236, stopOnAnyNegative: true, researchOnly: true,
  paidRetryAllowed: false, searchAllowed: false, imageAllowed: false, storeActionsAllowed: false } as const);
export type R12FocusedClosurePhase = { phase: 'strategy' | 'review'; attemptId: string; requestId: string; wireBindingHash: string;
  candidateHash: string; routeProofHash: string; settlementHash: string; actualMicrousd: string;
  acceptedResponseHash: string | null; artifactId: string | null; receivedObservationHash: string | null; rejectedDiagnosticHash: string | null };
export type R12FocusedPredecessorClosure = { version: 'r12.focused-pilot-closure.1'; businessId: string; scopeId: string; scopeHash: string;
  goalId: string; planId: string; planHash: string; policyId: string; policyHash: string; profileHash: string;
  budgetAuthorityRootId: string; priorRoundId: string; originalGoalId: string; originalClosedPlanId: string; originalClosedPlanHash: string;
  acceptedReviewScopeId: string; acceptedReviewHash: string; controllerKeyHash: string; admissionKeyHash: string;
  dispatches: 2; childrenCreated: 2; repairsUsed: 0; pivotsUsed: 0; authorityClosed: true; knownMicrousd: string;
  phases: [R12FocusedClosurePhase, R12FocusedClosurePhase] };
export type R12FocusedSuccessorAuthorization = { version: 'r12.focused-pilot-successor-authorization.1'; businessId: string; ownerId: string;
  scopeId: string; scopeHash: string; goalId: string; preparedGoalRevision: number; preparedGoalHash: string; profileHash: string;
  ownerApprovalEvidenceHash: string; predecessorClosure: R12FocusedPredecessorClosure; limits: typeof R12_FOCUSED_SUCCESSOR_LIMITS;
  createdAt: string; expiresAt: string };
export type R12FocusedSuccessor = { authorization: R12FocusedSuccessorAuthorization; authorizationHash: string };
type Pins = { businessId: string; scopeId: string; goalId: string; ownerId?: string; budgetAuthorityRootId?: string; priorRoundId?: string; scope?: DiscoveryFocusedPilot;
  focusedPilot?: { profileHash: string; closedScopeId: string; closedPlanId: string; acceptedReviewScopeId: string } };
const fail = (): never => { throw Error('r12_focused_successor_unverified'); };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: unknown, keys: string): Record<string, unknown> => {
  if (!object(v) || Object.keys(v).sort().join(',') !== keys.split(',').sort().join(',')) return fail(); return v;
};
const id = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const money = (v: unknown): v is string => typeof v === 'string' && /^(0|[1-9][0-9]{0,15})$/.test(v) && Number.isSafeInteger(Number(v));
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
/** This validates a proof returned by the scoped SQL join. Its shape alone does
 * not create authority: SQL independently reconstructs and compares every pin. */
export function validateR12FocusedSuccessor(raw: unknown, pins: Pins, now?: number): R12FocusedSuccessor {
  const pair = exact(raw, 'authorization,authorizationHash');
  if (Buffer.byteLength(JSON.stringify(raw), 'utf8') > 16384 || containsCredentialLikeValue(raw)) return fail();
  const a = exact(pair.authorization, 'version,businessId,ownerId,scopeId,scopeHash,goalId,preparedGoalRevision,preparedGoalHash,profileHash,ownerApprovalEvidenceHash,predecessorClosure,limits,createdAt,expiresAt');
  const c = exact(a.predecessorClosure, 'version,businessId,scopeId,scopeHash,goalId,planId,planHash,policyId,policyHash,profileHash,budgetAuthorityRootId,priorRoundId,originalGoalId,originalClosedPlanId,originalClosedPlanHash,acceptedReviewScopeId,acceptedReviewHash,controllerKeyHash,admissionKeyHash,dispatches,childrenCreated,repairsUsed,pivotsUsed,authorityClosed,knownMicrousd,phases');
  if (!hash(pair.authorizationHash) || discoveryV2Hash(a) !== pair.authorizationHash || a.version !== 'r12.focused-pilot-successor-authorization.1' ||
      ![a.businessId,a.ownerId,a.scopeId,a.goalId].every(id) || ![a.scopeHash,a.preparedGoalHash,a.profileHash,a.ownerApprovalEvidenceHash].every(hash) ||
      a.preparedGoalRevision !== 2 || a.businessId !== pins.businessId || a.scopeId !== pins.scopeId || a.goalId !== pins.goalId || pins.ownerId !== undefined && a.ownerId !== pins.ownerId ||
      discoveryV2Hash(a.limits) !== discoveryV2Hash(R12_FOCUSED_SUCCESSOR_LIMITS) || !date(a.createdAt) || !date(a.expiresAt) || Date.parse(a.createdAt) >= Date.parse(a.expiresAt) ||
      now !== undefined && (!Number.isFinite(now) || Date.parse(a.createdAt) > now || Date.parse(a.expiresAt) <= now) ||
      c.version !== 'r12.focused-pilot-closure.1' || c.businessId !== a.businessId ||
      pins.budgetAuthorityRootId !== undefined && c.budgetAuthorityRootId !== pins.budgetAuthorityRootId || pins.priorRoundId !== undefined && c.priorRoundId !== pins.priorRoundId ||
      ![c.businessId,c.scopeId,c.goalId,c.planId,c.policyId,c.budgetAuthorityRootId,c.priorRoundId,c.originalGoalId,c.originalClosedPlanId,c.acceptedReviewScopeId].every(id) ||
      ![c.scopeHash,c.planHash,c.policyHash,c.profileHash,c.originalClosedPlanHash,c.acceptedReviewHash,c.controllerKeyHash,c.admissionKeyHash].every(hash) ||
      new Set([a.scopeId,c.scopeId,c.acceptedReviewScopeId]).size !== 3 || new Set([a.goalId,c.goalId,c.originalGoalId]).size !== 3 || c.planId === c.originalClosedPlanId ||
      c.dispatches !== 2 || c.childrenCreated !== 2 || c.repairsUsed !== 0 || c.pivotsUsed !== 0 || c.authorityClosed !== true || !money(c.knownMicrousd) ||
      !Array.isArray(c.phases) || c.phases.length !== 2) return fail();
  let known = 0;
  for (const [index, value] of c.phases.entries()) {
    const p = exact(value, 'phase,attemptId,requestId,wireBindingHash,candidateHash,routeProofHash,settlementHash,actualMicrousd,acceptedResponseHash,artifactId,receivedObservationHash,rejectedDiagnosticHash');
    if (p.phase !== ['strategy','review'][index] || ![p.attemptId,p.requestId].every(id) || ![p.wireBindingHash,p.candidateHash,p.routeProofHash,p.settlementHash].every(hash) || !money(p.actualMicrousd) ||
        (index === 0 ? !hash(p.acceptedResponseHash) || !id(p.artifactId) || p.receivedObservationHash !== null || p.rejectedDiagnosticHash !== null :
          p.acceptedResponseHash !== null || p.artifactId !== null || !hash(p.receivedObservationHash) || !hash(p.rejectedDiagnosticHash))) return fail();
    known += Number(p.actualMicrousd);
  }
  if (!Number.isSafeInteger(known) || known !== Number(c.knownMicrousd) ||
      c.phases[0].attemptId === c.phases[1].attemptId || c.phases[0].requestId === c.phases[1].requestId) return fail();
  const e = pins.scope, f = pins.focusedPilot;
  if (e && (a.scopeHash !== discoveryV2Hash(e) || a.profileHash !== e.profileHash || a.ownerApprovalEvidenceHash !== e.approvalHash ||
      a.createdAt !== e.createdAt || a.expiresAt !== e.expiresAt || c.planId !== e.closedPlanId || c.planHash !== e.closedPlanHash ||
      c.originalGoalId !== e.originalGoalId || c.acceptedReviewScopeId !== e.acceptedReviewScopeId || c.acceptedReviewHash !== e.acceptedReviewHash ||
      c.budgetAuthorityRootId !== e.budgetAuthorityRootId || c.priorRoundId !== e.priorRoundId || e.profile.researchAllocationMicrousd !== R12_FOCUSED_SUCCESSOR_LIMITS.maximumMicrousd)) return fail();
  if (f && (a.profileHash !== f.profileHash || c.scopeId !== f.closedScopeId || c.planId !== f.closedPlanId || c.acceptedReviewScopeId !== f.acceptedReviewScopeId)) return fail();
  return structuredClone(raw) as R12FocusedSuccessor;
}
