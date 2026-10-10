import { validatePublicResearchBrowserAccounting, type PublicResearchBrowserAccounting } from "./discovery-r12-public-accounting";
import { validatePublicResearchSourceAccess, type PublicResearchSourceAccess } from "./discovery-r12-public-source";
import { validatePublicResearchWindow,validatePublicResearchContinuation,type PublicResearchWindow,type PublicResearchContinuation,type PublicResearchAcquisitionCommand } from "./discovery-r12-public-window";
import { exactPublicKeys as exact, publicHash as hash, publicHashSet, publicInteger as integer, publicMoney as money, publicResearchFail as fail, publicResearchHash, publicUuid as uuid, publicText as text, publicCanonicalText,verifyPublicSelfHash } from "./discovery-r12-public-utils";
export { publicResearchHash } from "./discovery-r12-public-utils";
export type { PublicResearchAcquisitionCommand } from "./discovery-r12-public-window";
export const PUBLIC_RESEARCH_PHASES=["plan","source","strategy","review"] as const;
export type PublicResearchPhase=typeof PUBLIC_RESEARCH_PHASES[number];
export type PublicResearchScopePins={scopeVersion:"r12.discovery-owner-adaptive.4";businessId:string;goalId:string;authorityRootId:string;scopeId:string;scopeHash:string;originDirectRunId:string;originalSemanticGoalHash:string|null};
export type PublicResearchPolicy=PublicResearchScopePins & {
  version:"r12.direct-etsy-attempt-policy.1";envelopeHash:string;browserAccountingPins:{providerProjectId:string;routeHash:string;tariffHash:string;qualificationHash:string};
  inheritedStateHash:string;initialCommandHash:string;quoteHash:string;sourcePolicyHash:string;approvalHash:string;rubricVersion:"r12.research-quality-rubric.1";
  window:PublicResearchWindow;continuation:PublicResearchContinuation;sourceAccess:PublicResearchSourceAccess;
  maximumModelDispatches:number;maximumSourceOperations:number;maximumNmePerEpoch:4;maximumDispatchesPerAttempt:4;
  baseChildren:number;baseDispatches:number;baseRepairs:number;basePivots:number;cumulativeChildrenCeiling:number;cumulativeDispatchesCeiling:number;
  baseKnownMicrounits:string;originalRunMaximumMicrounits:string;maximumNewAllocationMicrounits:string;businessLifetimeLimitMicrounits:string;rootLifetimeLimitMicrounits:string;
  phaseMaximumMicrounits:Record<PublicResearchPhase,string>;policyHash:string;
};
export type PublicResearchHistory={originHistoryHash:string;archivedNegativeProvenanceHash:string;seenQuestionHashes:string[];seenEvidenceIdentityHashes:string[];seenFactIdentityHashes:string[];usedDiagnosticHashes:string[];negativeFindingHashes:string[];consecutiveNonprogress:number};
export type PublicResearchCommand=PublicResearchAcquisitionCommand | {kind:"finish";rationale:string};
export type PublicResearchTerminal="RESEARCH_PASSED_SUPPORTS_TEST"|"RESEARCH_PASSED_REJECTS_HYPOTHESIS"|"RESEARCH_FAILED_QUALITY"|"RESEARCH_INSUFFICIENT_AT_WINDOW_LIMIT"|"RESEARCH_PAUSED_ACCESS"|"RESEARCH_PAUSED_SCOPE"|"RESEARCH_PAUSED_BUDGET"|"RESEARCH_PAUSED_AUTHORITY"|"RESEARCH_INVALID";
export type PublicResearchWitness={ref:string;evidenceIdentityHash:string;factIdentityHash:string;observationClusterHash:string};
type SourceProofBase={version:"r12.public-research-source-proof.1";operationId:string;sourceAttemptId:string;requestHash:string;receiptHash:string;captureHash:string;
  businessId:string;goalId:string;authorityRootId:string;scopeId:string;scopeHash:string;originDirectRunId:string;windowId:string;windowOrdinal:number;windowAttemptOrdinal:number;attemptOrdinal:number;
  criteriaHash:string;questionHash:string;quoteHash:string;status:"completed";releaseState:"verified";liabilityState:"receipt_required";accounting:PublicResearchBrowserAccounting;witnesses:PublicResearchWitness[]};
export type PublicResearchSourceProof=SourceProofBase & ({sourceReceiptVersion:"r12.etsy-public-source-receipt.1"}|{sourceReceiptVersion:"r12.etsy-insights-source-receipt.1";accountBindingHash:string;accountVerificationHash:string;capturePolicyHash:string});
export const publicResearchQuestionHash=(question:string)=>publicResearchHash({version:"r12.public-question.1",question:publicCanonicalText(question)});
export const publicResearchCriteriaHash=(dimension:string,value:string)=>publicResearchHash({version:"r12.public-criteria.1",dimension,value:publicCanonicalText(value)});
export function validatePublicResearchCommand(raw:unknown):PublicResearchCommand {
  if(exact(raw,"kind,rationale")&&raw.kind==="finish"&&text(raw.rationale))return structuredClone(raw) as PublicResearchCommand;
  if(!exact(raw,"kind,criteriaHash,questionHash,query,namedGap,expectedInformationGain,opposingCheck,changedCriterion"))return fail();
  const v=raw as unknown as PublicResearchAcquisitionCommand;
  if(!["targeted","pivot"].includes(v.kind)||![v.criteriaHash,v.questionHash].every(hash)||![v.query,v.namedGap,v.expectedInformationGain,v.opposingCheck].every(x=>text(x,1000))||/https?:|www\.|@|\b(?:password|api[ _-]?key|access[ _-]?token)\b/i.test(v.query)||v.questionHash!==publicResearchQuestionHash(v.namedGap))return fail();
  if(v.kind==="targeted"){if(v.changedCriterion!==null)return fail();}
  else{const c=v.changedCriterion;if(!exact(c,"dimension,before,after")||!["search_terms","intent_angle","comparison_reference"].includes(c.dimension as string)||!text(c.before,1000)||!text(c.after,1000)||publicCanonicalText(c.before)===publicCanonicalText(c.after)||v.criteriaHash!==publicResearchCriteriaHash(c.dimension as string,c.after as string))return fail();}
  return structuredClone(v);
}
export function validatePublicResearchHistory(raw:unknown):PublicResearchHistory {
  if(!exact(raw,"originHistoryHash,archivedNegativeProvenanceHash,seenQuestionHashes,seenEvidenceIdentityHashes,seenFactIdentityHashes,usedDiagnosticHashes,negativeFindingHashes,consecutiveNonprogress"))return fail();
  const v=raw as unknown as PublicResearchHistory;
  if(![v.originHistoryHash,v.archivedNegativeProvenanceHash].every(hash)||![v.seenQuestionHashes,v.seenEvidenceIdentityHashes,v.seenFactIdentityHashes,v.usedDiagnosticHashes,v.negativeFindingHashes].every(x=>publicHashSet(x))||!integer(v.consecutiveNonprogress))return fail();return structuredClone(v);
}
export function validatePublicResearchPolicy(raw:unknown):PublicResearchPolicy {
  if(!exact(raw,"scopeVersion,businessId,goalId,authorityRootId,scopeId,scopeHash,originDirectRunId,originalSemanticGoalHash,version,envelopeHash,browserAccountingPins,inheritedStateHash,initialCommandHash,quoteHash,sourcePolicyHash,approvalHash,rubricVersion,window,continuation,sourceAccess,maximumModelDispatches,maximumSourceOperations,maximumNmePerEpoch,maximumDispatchesPerAttempt,baseChildren,baseDispatches,baseRepairs,basePivots,cumulativeChildrenCeiling,cumulativeDispatchesCeiling,baseKnownMicrounits,originalRunMaximumMicrounits,maximumNewAllocationMicrounits,businessLifetimeLimitMicrounits,rootLifetimeLimitMicrounits,phaseMaximumMicrounits,policyHash"))return fail();
  const p=raw as unknown as PublicResearchPolicy;
  if(p.version!=="r12.direct-etsy-attempt-policy.1"||p.scopeVersion!=="r12.discovery-owner-adaptive.4"||p.rubricVersion!=="r12.research-quality-rubric.1"||![p.businessId,p.goalId,p.authorityRootId,p.scopeId,p.originDirectRunId].every(uuid)||![p.scopeHash,p.envelopeHash,p.inheritedStateHash,p.initialCommandHash,p.quoteHash,p.sourcePolicyHash,p.approvalHash].every(hash)||p.originalSemanticGoalHash!==null&&!hash(p.originalSemanticGoalHash))return fail();
  const w=validatePublicResearchWindow(p.window),c=validatePublicResearchContinuation(p.continuation);
  if(c.continuationHash!==w.continuationHash||c.totalAttemptsStarted!==w.baseAttemptsStarted||c.historyHash!==p.inheritedStateHash||c.originDirectRunId!==p.originDirectRunId)return fail();
  validatePublicResearchSourceAccess(p.sourceAccess,{businessId:p.businessId,goalId:p.goalId,authorityRootId:p.authorityRootId,testEnvelopeHash:p.envelopeHash});
  if(!exact(p.browserAccountingPins,"providerProjectId,routeHash,tariffHash,qualificationHash")||!uuid(p.browserAccountingPins.providerProjectId)||![p.browserAccountingPins.routeHash,p.browserAccountingPins.tariffHash,p.browserAccountingPins.qualificationHash].every(hash)||p.sourceAccess.allowedSource==="etsy_authenticated_insights"&&p.sourceAccess.accountBinding.providerProjectId!==p.browserAccountingPins.providerProjectId)return fail();
  if(p.maximumModelDispatches!==3*w.maximumAttemptsInWindow||p.maximumSourceOperations!==w.maximumAttemptsInWindow||p.maximumNmePerEpoch!==4||p.maximumDispatchesPerAttempt!==4||![p.baseChildren,p.baseDispatches,p.baseRepairs,p.basePivots].every(x=>integer(x))||p.cumulativeChildrenCeiling!==p.baseChildren+(w.windowOrdinal===1?4:0)||!integer(p.cumulativeChildrenCeiling,4,32)||!integer(p.cumulativeDispatchesCeiling,p.baseDispatches,Math.min(64,p.baseDispatches+4*w.maximumAttemptsInWindow)))return fail();
  const run=money(p.originalRunMaximumMicrounits),allocation=money(p.maximumNewAllocationMicrounits);money(p.baseKnownMicrounits);money(p.businessLifetimeLimitMicrounits);money(p.rootLifetimeLimitMicrounits);
  if(run<=BigInt(0)||run>BigInt(10000000)||allocation<=BigInt(0)||allocation>run||!exact(p.phaseMaximumMicrounits,"plan,source,strategy,review"))return fail();
  for(const phase of PUBLIC_RESEARCH_PHASES)if(money(p.phaseMaximumMicrounits[phase])<(phase==="source"?BigInt(0):BigInt(1)))return fail();
  verifyPublicSelfHash(raw,"policyHash");return structuredClone(p);
}
export function validatePublicResearchSourceProof(raw:unknown,policy:PublicResearchPolicy):PublicResearchSourceProof {
  const p=validatePublicResearchPolicy(policy),insights=p.sourceAccess.allowedSource==="etsy_authenticated_insights";
  if(!exact(raw,"version,sourceReceiptVersion,operationId,sourceAttemptId,requestHash,receiptHash,captureHash,businessId,goalId,authorityRootId,scopeId,scopeHash,originDirectRunId,windowId,windowOrdinal,windowAttemptOrdinal,attemptOrdinal,criteriaHash,questionHash,quoteHash,status,releaseState,liabilityState,accounting,witnesses"+(insights?",accountBindingHash,accountVerificationHash,capturePolicyHash":"")))return fail();
  const v=raw as unknown as PublicResearchSourceProof;
  if(v.version!=="r12.public-research-source-proof.1"||v.sourceReceiptVersion!==(insights?"r12.etsy-insights-source-receipt.1":"r12.etsy-public-source-receipt.1")||![v.operationId,v.sourceAttemptId].every(uuid)||![v.requestHash,v.receiptHash,v.captureHash,v.criteriaHash,v.questionHash].every(hash)||v.status!=="completed"||v.releaseState!=="verified"||v.liabilityState!=="receipt_required")return fail();
  for(const k of ["businessId","goalId","authorityRootId","scopeId","scopeHash","originDirectRunId","quoteHash"] as const)if(v[k]!==p[k])return fail();
  if(v.windowId!==p.window.windowId||v.windowOrdinal!==p.window.windowOrdinal||!integer(v.windowAttemptOrdinal,1,p.window.maximumAttemptsInWindow)||v.attemptOrdinal!==p.window.baseAttemptsStarted+v.windowAttemptOrdinal)return fail();
  if(p.sourceAccess.allowedSource==="etsy_authenticated_insights"){
    if(v.sourceReceiptVersion!=="r12.etsy-insights-source-receipt.1"||v.accountBindingHash!==p.sourceAccess.accountBinding.bindingHash||v.accountVerificationHash!==p.sourceAccess.accountBinding.accountVerificationHash||v.capturePolicyHash!==p.sourceAccess.capturePolicyHash)return fail();
  }
  validatePublicResearchBrowserAccounting(v.accounting,{businessId:p.businessId,goalId:p.goalId,authorityRootId:p.authorityRootId,envelopeHash:p.envelopeHash,...p.browserAccountingPins,operationKind:"research_source",operationId:v.operationId,operationReceiptHash:v.receiptHash,requestHash:v.requestHash,quoteHash:p.quoteHash,maximumMicrounits:p.phaseMaximumMicrounits.source});
  if(!Array.isArray(v.witnesses)||v.witnesses.length<1||v.witnesses.length>48)return fail();const seen=new Set<string>();
  for(const w of v.witnesses){if(!exact(w,"ref,evidenceIdentityHash,factIdentityHash,observationClusterHash")||!text(w.ref,200)||![w.evidenceIdentityHash,w.factIdentityHash,w.observationClusterHash].every(hash)||seen.has(w.ref))return fail();seen.add(w.ref);}
  return structuredClone(v);
}
