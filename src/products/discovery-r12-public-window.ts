import { exactPublicKeys as exact, publicHash as hash, publicHashSet, publicInteger as integer, publicResearchFail as fail, publicResearchHash, publicUuid as uuid, verifyPublicSelfHash } from "./discovery-r12-public-utils";
export const PUBLIC_RESEARCH_MAX_WINDOW_ATTEMPTS = 32;
export const PUBLIC_RESEARCH_TEST_WINDOW_ATTEMPTS = 10;
export type PublicResearchAcquisitionCommand = {
  kind: "targeted" | "pivot"; criteriaHash: string; questionHash: string; query: string;
  namedGap: string; expectedInformationGain: string; opposingCheck: string;
  changedCriterion: null | { dimension: "search_terms" | "intent_angle" | "comparison_reference"; before: string; after: string };
};
export type PublicResearchWindow = { version: "r12.research-attempt-window.1"; windowId: string; windowOrdinal: number; maximumAttemptsInWindow: number; baseAttemptsStarted: number; continuationHash: string };
export type PublicResearchContinuation = {
  version: "r12.research-window-continuation.1"; originDirectRunId: string; previousWindowStateHash: string | null;
  historyHash: string; totalAttemptsStarted: number; modelDispatchesUsed: number; sourceOperationsStarted: number;
  epochOrdinal: number; epochCriteriaHash: string | null; nmeCountInEpoch: number; seenCriteriaHashes: string[];
  nextAttemptKind: "initial" | "targeted" | "pivot" | "technical_retry";
  nextCommand: PublicResearchAcquisitionCommand | null; continuationHash: string;
};
export function validatePublicResearchWindow(raw: unknown): PublicResearchWindow {
  if (!exact(raw, "version,windowId,windowOrdinal,maximumAttemptsInWindow,baseAttemptsStarted,continuationHash")) return fail();
  const v = raw as unknown as PublicResearchWindow;
  if (v.version !== "r12.research-attempt-window.1" || !uuid(v.windowId) || !integer(v.windowOrdinal, 1) || !integer(v.maximumAttemptsInWindow, 1, PUBLIC_RESEARCH_MAX_WINDOW_ATTEMPTS) || !integer(v.baseAttemptsStarted) || !hash(v.continuationHash) || (v.windowOrdinal === 1 ? v.baseAttemptsStarted !== 0 : v.baseAttemptsStarted < v.windowOrdinal - 1)) return fail();
  return structuredClone(v);
}
export function createInitialPublicResearchContinuation(originDirectRunId: string, historyHash: string): PublicResearchContinuation {
  const body = { version: "r12.research-window-continuation.1" as const, originDirectRunId, previousWindowStateHash: null, historyHash, totalAttemptsStarted: 0, modelDispatchesUsed: 0, sourceOperationsStarted: 0, epochOrdinal: 0, epochCriteriaHash: null, nmeCountInEpoch: 0, seenCriteriaHashes: [], nextAttemptKind: "initial" as const, nextCommand: null };
  return validatePublicResearchContinuation({ ...body, continuationHash: publicResearchHash(body) });
}
export function validatePublicResearchContinuation(raw: unknown): PublicResearchContinuation {
  if (!exact(raw, "version,originDirectRunId,previousWindowStateHash,historyHash,totalAttemptsStarted,modelDispatchesUsed,sourceOperationsStarted,epochOrdinal,epochCriteriaHash,nmeCountInEpoch,seenCriteriaHashes,nextAttemptKind,nextCommand,continuationHash")) return fail();
  const v = raw as unknown as PublicResearchContinuation;
  if (v.version !== "r12.research-window-continuation.1" || !uuid(v.originDirectRunId) || !hash(v.historyHash) || ![v.totalAttemptsStarted,v.modelDispatchesUsed,v.sourceOperationsStarted,v.epochOrdinal].every(n => integer(n)) || !integer(v.nmeCountInEpoch, 0, 4) || !publicHashSet(v.seenCriteriaHashes)) return fail();
  if (v.totalAttemptsStarted === 0) {
    if (v.previousWindowStateHash !== null || v.modelDispatchesUsed !== 0 || v.sourceOperationsStarted !== 0 || v.epochOrdinal !== 0 || v.epochCriteriaHash !== null || v.nmeCountInEpoch !== 0 || v.seenCriteriaHashes.length !== 0 || v.nextAttemptKind !== "initial" || v.nextCommand !== null) return fail();
  } else {
    if (!hash(v.previousWindowStateHash) || !hash(v.epochCriteriaHash) || !v.seenCriteriaHashes.includes(v.epochCriteriaHash) || v.seenCriteriaHashes.length !== v.epochOrdinal + 1 || v.modelDispatchesUsed < v.totalAttemptsStarted || v.modelDispatchesUsed > 3 * v.totalAttemptsStarted || v.sourceOperationsStarted > v.totalAttemptsStarted || !v.nextCommand || !["targeted","pivot","technical_retry"].includes(v.nextAttemptKind)) return fail();
    const c = v.nextCommand;
    if (!hash(c.criteriaHash) || !hash(c.questionHash) || (v.nextAttemptKind === "pivot" ? v.nmeCountInEpoch !== 4 || c.kind !== "pivot" || v.seenCriteriaHashes.includes(c.criteriaHash) : c.criteriaHash !== v.epochCriteriaHash) || (v.nextAttemptKind === "targeted" && v.nmeCountInEpoch >= 4)) return fail();
  }
  verifyPublicSelfHash(raw, "continuationHash"); return structuredClone(v);
}
