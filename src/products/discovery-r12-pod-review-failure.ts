import type { EvidencePack } from "../research/types";
import { publicResearchHash } from "../research/qualification";
import { validateJsonSchemaValue } from "../workers/schema-validator";
import { assertPodReviewMeaning, podResearchSchema, type PodAssessment, type PodReview } from "./discovery-r12-pod-analysis";

const fail = (): never => { throw new Error("r12_pod_review_length_failure_unverified"); };
const prose = [
  { path: "$.rationale", min: 60, max: 600 },
  ...Array.from({ length: 6 }, (_, i) => ({ path: `$.checks[${i}].rationale`, min: 30, max: 240 })),
  ...Array.from({ length: 8 }, (_, i) => ({ path: `$.missingEvidence[${i}]`, min: 20, max: 220 })),
  { path: "$.nextTest", min: 40, max: 400 },
] as const;
type ProseField = { path: string; min: number; max: number; original: string };
export type PodReviewLengthFailure = {
  version: "r12.pod-review-length-failure.1";
  originalHash: string;
  assessmentHash: string;
  evidenceHash: string;
  fields: ProseField[];
};
function valueAt(review: PodReview, path: string): string | undefined {
  if (path === "$.rationale") return review.rationale;
  if (path === "$.nextTest") return review.nextTest;
  const check = /^\$\.checks\[([0-5])\]\.rationale$/.exec(path);
  if (check) return review.checks[Number(check[1])]?.rationale;
  const missing = /^\$\.missingEvidence\[([0-7])\]$/.exec(path);
  return missing ? review.missingEvidence[Number(missing[1])] : undefined;
}
/** Pure eligibility evidence, never admission or acceptance of the failed call.
 * The saved diagnostic alone is insufficient: recheck the complete original
 * object and all domain checks, omitting only mechanically identified maxima.
 */
export function classifyPodReviewLengthFailure(raw: unknown, assessment: PodAssessment, pack: EvidencePack): PodReviewLengthFailure {
  if (Buffer.byteLength(JSON.stringify(raw) ?? "", "utf8") > 16_384) fail();
  const issues = validateJsonSchemaValue(podResearchSchema("review"), raw);
  if (issues.length === 0 || issues.length > prose.length) fail();
  const fields = issues.map(issue => {
    const field = prose.find(p => p.path === issue.path);
    if (!field || issue.message !== `must contain no more than ${field.max} characters`) return fail();
    const original = valueAt(raw as PodReview, field.path);
    if (typeof original !== "string" || original.length <= field.max) return fail();
    return { ...field, original };
  });
  // No placeholder strings, truncation, or relaxed object/type/domain rules.
  // The full validator established that every issue is an exact string maximum.
  const original = assertPodReviewMeaning(raw as PodReview, assessment, pack);
  if (original.outcome === "HYPOTHESIS_TO_TEST" && original.checks.some(c =>
    ["source_quality_and_independence", "claim_support", "counterevidence", "pod_feasibility"].includes(c.check) && c.evidence.length === 0)) fail();
  return { version: "r12.pod-review-length-failure.1", originalHash: publicResearchHash(original),
    assessmentHash: publicResearchHash(assessment), evidenceHash: publicResearchHash(pack), fields };
}
