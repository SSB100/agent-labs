import { publicResearchHash } from "../research/qualification";
import type { PodResearchGoalScope } from "./discovery-r12-pod-goal";
import type { PodReview, PodAssessment, PodEvidenceView } from "./discovery-r12-pod-analysis";
export type PodFailedPassHistory = {
  version: "r12.pod-failed-pass-history.1"; kind: "failed_pass_context"; previousPass: number;
  reviewAccepted: false; failedObservationHash: string; failureDiagnosticHash: string; failureKind: "review_length_rejected";
  priorQueries: Array<{pass:number;query:string;sourceDomains:string[]}>;
  priorCandidates: Array<{productType:string;niche:string;audience:string}>;
  untrustedCritique: PodReview;
  acceptedAssessment: Pick<PodAssessment,"explorationSummary"|"recommendation"|"limitations">;
  evidence: PodEvidenceView[]; observedDomains: string[];
  acceptedOutputHashes: Array<{phase:string;responseHash:string}>;
};
export type PodRecoveryProof = {
  version: "r12.pod-recovery-proof.1"; businessId:string;goalId:string;predecessorSetupId:string;predecessorScopeId:string;
  predecessorPlanId:string;predecessorPlanHash:string;predecessorPlanVersion:1;failedAttemptId:string;
  observationHash:string;diagnosticHash:string;dependencyPins:Array<{phase:string;attemptId:string;responseHash:string;candidateHash:string}>;
  historyHash:string;headRevision:number;baseChildren:5;baseDispatches:number;baseRepairs:0;basePivots:0;
  usedPasses:number;usedCalls:number;usedSearches:number;spentMicrounits:string;originalMaximumMicrounits:string;
  remainingMaximumMicrounits:string;originalDeadline:string;sourcePolicyHash:string;publicBriefHash:string;
};
export type PodRecoveryContext = {version:"r12.pod-next-pass-recovery.1";proof:PodRecoveryProof;proofHash:string;historyHash:string;setupHash:string};
const fail=():never=>{throw Error("r12_pod_recovery_context_unverified");};
const hash=(v:unknown)=>typeof v==="string"&&/^[a-f0-9]{64}$/.test(v);
const money=(v:unknown):v is string=>typeof v==="string"&&/^(0|[1-9][0-9]{0,7})$/.test(v);
/** Local consistency checks only; the SQL recovery link is the authority. */
export function validatePodRecoveryContext(value:PodRecoveryContext,scope:PodResearchGoalScope) {
  const r=value,p=r?.proof;
  if(!p||r.version!=="r12.pod-next-pass-recovery.1"||p.version!=="r12.pod-recovery-proof.1"||r.proofHash!==publicResearchHash(p)||r.historyHash!==p.historyHash||r.setupHash!==scope.setupHash||
    p.businessId!==scope.businessId||p.goalId!==scope.goalId||p.predecessorScopeId===scope.id||p.predecessorSetupId===scope.setupId||p.predecessorPlanVersion!==1||
    p.baseChildren!==5||p.baseRepairs!==0||p.basePivots!==0||!Number.isInteger(p.usedPasses)||p.usedPasses<1||p.usedPasses>4||
    p.usedCalls!==p.usedPasses*5||p.usedSearches!==p.usedPasses||p.baseDispatches!==p.usedCalls||
    ![p.spentMicrounits,p.originalMaximumMicrounits,p.remainingMaximumMicrounits].every(money)||Number(p.originalMaximumMicrounits)>10000000||
    Number(p.remainingMaximumMicrounits)!==Number(p.originalMaximumMicrounits)-Number(p.spentMicrounits)||scope.maximumMicrousd>Number(p.remainingMaximumMicrounits)||
    p.sourcePolicyHash!==scope.sourcePolicyHash||p.publicBriefHash!==publicResearchHash(scope.publicBrief)||
    ![p.predecessorPlanHash,p.observationHash,p.diagnosticHash,p.historyHash].every(hash)||
    p.dependencyPins.length!==4||JSON.stringify(p.dependencyPins.map(x=>x.phase))!==JSON.stringify(["plan","search1","select1","strategy"])||
    p.dependencyPins.some(x=>!hash(x.responseHash)||!hash(x.candidateHash)))fail();
  return structuredClone(r);
}
export function validatePodFailedPassHistory(h:PodFailedPassHistory,r:PodRecoveryContext,ordinal:number) {
  if(h.version!=="r12.pod-failed-pass-history.1"||h.kind!=="failed_pass_context"||h.reviewAccepted!==false||h.failureKind!=="review_length_rejected"||
    ordinal!==r.proof.usedPasses||h.previousPass!==ordinal-1||publicResearchHash(h)!==r.historyHash||
    h.failedObservationHash!==r.proof.observationHash||h.failureDiagnosticHash!==r.proof.diagnosticHash||
    h.untrustedCritique.outcome!=="INSUFFICIENT_EVIDENCE"||h.untrustedCritique.candidateIndex!==null||
    h.untrustedCritique.etsyDemandVerified!==false||h.untrustedCritique.commercialViabilityVerified!==false||
    h.acceptedAssessment.recommendation.outcome!=="INSUFFICIENT_EVIDENCE"||h.acceptedAssessment.recommendation.candidateIndex!==null||
    publicResearchHash(h.acceptedOutputHashes)!==publicResearchHash(r.proof.dependencyPins.map(({phase,responseHash})=>({phase,responseHash}))))fail();
}
