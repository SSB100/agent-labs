import { containsCredentialLikeValue } from '../core/quest-intake';
import type { R12FocusedSuccessorAuthorization } from './discovery-r12-focused-successor';

export type R12MarkedPretransportClosure = {
  version: 'r12.focused-pilot-marked-pretransport-closure.1'; businessId: string; scopeId: string; scopeHash: string;
  goalId: string; planId: string; planHash: string; policyId: string; policyHash: string; profileHash: string;
  budgetAuthorityRootId: string; priorRoundId: string; recoveryAuthorizationHash: string; controllerKeyHash: string;
  admissionKeyHash: string; attemptId: string; requestId: string; requestHash: string; wireBindingHash: string;
  wireHash: string; reservationHash: string; financialMarkerHash: string; controllerMarkerHash: string; revocationsHash: string;
  reconciliationEventId: string; reconciliationProofHash: string; releaseHash: string; releaseEvidenceHash: string;
  decisionHash: string; absenceHash: string; dispatches: 1; childrenCreated: 1; repairsUsed: 0; pivotsUsed: 0;
  authorityClosed: true; knownMicrousd: '0'; heldMicrousd: '0';
};
/** Compact references to the stored recovery and reconciliation. No nested recovery authorization. */
export type R12TerminalQualificationAuthorization = Omit<R12FocusedSuccessorAuthorization, 'version' | 'limits'> & {
  version: 'r12.focused-pilot-terminal-qualification-authorization.1';
  limits: R12FocusedSuccessorAuthorization['limits'] & { readonly maximumTechnicalQualifications: 1 };
  markedClosure: R12MarkedPretransportClosure;
};
const keys = 'version,businessId,scopeId,scopeHash,goalId,planId,planHash,policyId,policyHash,profileHash,budgetAuthorityRootId,priorRoundId,recoveryAuthorizationHash,controllerKeyHash,admissionKeyHash,attemptId,requestId,requestHash,wireBindingHash,wireHash,reservationHash,financialMarkerHash,controllerMarkerHash,revocationsHash,reconciliationEventId,reconciliationProofHash,releaseHash,releaseEvidenceHash,decisionHash,absenceHash,dispatches,childrenCreated,repairsUsed,pivotsUsed,authorityClosed,knownMicrousd,heldMicrousd';
export function validateR12MarkedPretransportClosure(raw: unknown, pins: {
  businessId: string; scopeId: string; goalId: string; planId?: string; planHash?: string;
  budgetAuthorityRootId?: string; priorRoundId?: string; recoveryAuthorizationHash?: string;
}): R12MarkedPretransportClosure {
  const fail = (): never => { throw Error('r12_marked_pretransport_closure_unverified'); };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail();
  const c = raw as Record<string, unknown>;
  if (Object.keys(c).sort().join(',') !== keys.split(',').sort().join(',') || Buffer.byteLength(JSON.stringify(raw), 'utf8') > 8192 || containsCredentialLikeValue(raw) ||
      c.version !== 'r12.focused-pilot-marked-pretransport-closure.1' ||
      !['businessId','scopeId','goalId','planId','policyId','budgetAuthorityRootId','priorRoundId','attemptId','requestId'].every(k => typeof c[k] === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(c[k] as string)) ||
      !['scopeHash','planHash','policyHash','profileHash','recoveryAuthorizationHash','controllerKeyHash','admissionKeyHash','requestHash','wireBindingHash','wireHash','reservationHash','financialMarkerHash','controllerMarkerHash','revocationsHash','reconciliationProofHash','releaseHash','releaseEvidenceHash','decisionHash','absenceHash'].every(k => typeof c[k] === 'string' && /^[a-f0-9]{64}$/.test(c[k] as string)) ||
      typeof c.reconciliationEventId !== 'string' || !/^[1-9][0-9]{0,18}$/.test(c.reconciliationEventId) || BigInt(c.reconciliationEventId) > BigInt('9223372036854775807') ||
      c.reconciliationProofHash !== c.releaseEvidenceHash || c.dispatches !== 1 || c.childrenCreated !== 1 || c.repairsUsed !== 0 || c.pivotsUsed !== 0 ||
      c.authorityClosed !== true || c.knownMicrousd !== '0' || c.heldMicrousd !== '0' ||
      Object.entries(pins).some(([k, value]) => value !== undefined && c[k] !== value)) return fail();
  return structuredClone(raw) as R12MarkedPretransportClosure;
}
