import type { JsonObject } from "../core/contracts";
import { discoveryV2Hash } from "./discovery-v2";
import type { FocusedPilotProfile } from "./discovery-r12-focused-pilot-contract";

/** Provider context retains every selected-candidate and global reviewer question, reason and
 * classification. Other-candidate rows remain in the full local record. Receipt identities/source hashes remain in the immutable
 * profile record and its hash; they are provenance, never pilot evidence. */
export function focusedPilotHistoricalContext(history: FocusedPilotProfile["history"], candidateId: string): JsonObject {
  const r = history.record;
  const fail = (): never => { throw Error("r12_focused_pilot_history_projection"); };
  const objects = (value: unknown): JsonObject[] => {
    if (!Array.isArray(value) || value.some(row => !row || typeof row !== "object" || Array.isArray(row))) return fail();
    return value as JsonObject[];
  };
  const questions: string[] = [];
  const question = (value: unknown) => {
    if (typeof value !== "string") return fail();
    let index = questions.indexOf(value);if (index < 0) { index = questions.length;questions.push(value); }return index;
  };
  if (!Array.isArray(r.missingQuestions)) return fail();
  const allCandidates = objects(r.priorCandidateUncertainties), selected = allCandidates.filter(candidate => candidate.candidateId === candidateId);
  if (selected.length !== 1) return fail();
  const otherCandidates = allCandidates.filter(candidate => candidate.candidateId !== candidateId);
  const candidates = selected.map(candidate => [candidate.candidateId, candidate.concept,
    objects(candidate.dimensions).map(dimension => [dimension.dimension, objects(dimension.uncertainties).map(u => [question(u.question), u.blockingForTest, u.reason])])]);
  const additionalUncertainties = objects(r.additionalUncertainties).map(u => [u.dimension, question(u.question), u.blockingForTest, u.reason]);
  const dimensions = objects(r.dimensions).map(d => [d.dimension, d.verdict, d.rationale, d.evidenceRefs]);
  return {
    acceptedReviewHash: history.acceptedReviewHash, recordHash: history.recordHash, supportingEvidence: false,
    scopeChangeExplanation: history.scopeChangeExplanation,
    record: { outcome: r.outcome, marketCountryCode: r.marketCountryCode, candidateId: r.candidateId, sufficiencyRationale: r.sufficiencyRationale,
      rowEncoding: { candidates: ["candidateId", "concept", "dimensions"], dimensions: ["dimension", "uncertainties"],
        uncertainties: ["questionIndex", "blockingForTest", "reason"], additionalUncertainties: ["dimension", "questionIndex", "blockingForTest", "reason"],
        reviewDimensions: ["dimension", "verdict", "rationale", "historicalEvidenceRefs"], checks: ["check", "outcome", "rationale"] },
      questions, candidates,
      retainedCandidateId: candidateId, omittedCandidateRows: { count: otherCandidates.length, sha256: discoveryV2Hash(otherCandidates) },
      completeMissingQuestions: { count: r.missingQuestions.length, sha256: discoveryV2Hash(r.missingQuestions) }, additionalUncertainties, reviewDimensions: dimensions,
      checks: objects(r.checks).map(c => [c.check, c.outcome, c.rationale]),
      executionPrerequisites: r.executionPrerequisites, publicationAllowed: r.publicationAllowed, commerceAllowed: r.commerceAllowed,
      interpretation: "Every questionIndex indexes questions verbatim. This history projection retains all original uncertainties for retainedCandidateId and every global reviewer additional uncertainty, with exact flags and reasons. Other candidates and the redundant full question list remain unresolved in recordHash; omission grants no waiver. Historical citations are not pilot evidence.",
    },
  } as JsonObject;
}
