import type { OwnerObservation,OwnerObservationMetric } from "./discovery-r12-owner-observation";
import { validateOwnerEpisodeClosure,type OwnerEpisodeClosure } from "./discovery-r12-owner-episode";
import { validatePublicResearchHistory,publicResearchQuestionHash,type PublicResearchHistory } from "./discovery-r12-public-contracts";
import { exactPublicKeys as exact,publicHash as hash,publicHashSet,publicInteger as integer,publicMoney as money,publicResearchFail as fail,publicResearchHash,publicText as text,publicUuid as uuid,publicBoundedJson,publicCanonicalText,verifyPublicSelfHash } from "./discovery-r12-public-utils";
/** Distinct from optional capture-revision closure. It closes only published .1/.2. */
export type PublicResearchAdaptiveOriginClosure={
  version:"r12.direct-adaptive-origin-closure.1";businessId:string;goalId:string;
  predecessorPlanId:string;predecessorPlanHash:string;predecessorPlanVersion:number;
  predecessorScopeId:string;predecessorScopeHash:string;predecessorScopeVersion:"r12.discovery-owner-adaptive.1"|"r12.discovery-owner-adaptive.2";
  predecessorSetupId:string;predecessorSetupHash:string;predecessorActivationHash:string;predecessorPolicyId:string;predecessorPolicyHash:string;
  authorityRootId:string;fundingBindingId:string;goalRevision:number;goalHash:string;businessRevision:number;businessHash:string;
  headRevision:number;headState:"stopped"|"completed";headReason:string;
  baseChildren:number;baseDispatches:number;baseRepairs:number;basePivots:number;baseKnownMicrounits:string;
  closureProofHash:string;revocationHash:string;settlementHash:string;
  /** Hash of the authenticated predecessor history, NOT this public archive. */
  historyHash:string;
};
export type PublicResearchLegacyImport={phase:"plan"|"search"|"select"|"strategy"|"review";attemptId:string;artifactId:string;responseHash:string;receiptProofHash:string};
export type PublicResearchPredecessor={kind:"legacy_episode";closure:OwnerEpisodeClosure;imports:PublicResearchLegacyImport[]}|{kind:"adaptive_direct_origin";closure:PublicResearchAdaptiveOriginClosure};
export type PublicResearchOriginReceipt={scopeId:string;scopeHash:string;planId:string;planHash:string;planVersion:number;actionOrdinal:number|null;phase:"strategy"|"review";attemptId:string;artifactId:string;responseHash:string;receiptProofHash:string};
export type PublicResearchOriginFinancialProof={scopeId:string;attemptId:string;requestId:string;requestHash:string;reservationId:string;maximumMicrounits:string;actualMicrounits:string;disposition:"qualified_receipt"|"qualified_terminal_failure";qualificationHash:string;settlementHash:string};
export type PublicResearchOriginProvenance={kind:"legacy_evidence"|"owner_observation";scopeId:string;containerId:string;containerHash:string;sourceId:string;sourceContentHash:string;evidenceId:string;evidenceIdentityHash:string;factIdentityHash:string|null;provenanceHash:string};
export type PublicResearchOriginMaterial={kind:"negative_finding"|"unresolved_question"|"prior_decision";recordHash:string;statement:string;sourceResponseHash:string;provenanceHashes:string[]};
export type PublicResearchOriginHistory={version:"r12.public-research-origin-history.1";businessId:string;goalId:string;predecessorScopeId:string;predecessorClosureHash:string;receipts:PublicResearchOriginReceipt[];financialProofs:PublicResearchOriginFinancialProof[];provenance:PublicResearchOriginProvenance[];materialHistory:PublicResearchOriginMaterial[];continuity:Omit<PublicResearchHistory,"originHistoryHash"|"archivedNegativeProvenanceHash">;historyHash:string};
export function validatePublicResearchAdaptiveOriginClosure(raw:unknown):PublicResearchAdaptiveOriginClosure{
  if(!exact(raw,"version,businessId,goalId,predecessorPlanId,predecessorPlanHash,predecessorPlanVersion,predecessorScopeId,predecessorScopeHash,predecessorScopeVersion,predecessorSetupId,predecessorSetupHash,predecessorActivationHash,predecessorPolicyId,predecessorPolicyHash,authorityRootId,fundingBindingId,goalRevision,goalHash,businessRevision,businessHash,headRevision,headState,headReason,baseChildren,baseDispatches,baseRepairs,basePivots,baseKnownMicrounits,closureProofHash,revocationHash,settlementHash,historyHash"))return fail();
  const c=raw as unknown as PublicResearchAdaptiveOriginClosure;
  if(c.version!=="r12.direct-adaptive-origin-closure.1"||!["r12.discovery-owner-adaptive.1","r12.discovery-owner-adaptive.2"].includes(c.predecessorScopeVersion)||![c.businessId,c.goalId,c.predecessorPlanId,c.predecessorScopeId,c.predecessorSetupId,c.predecessorPolicyId,c.authorityRootId,c.fundingBindingId].every(uuid)||![c.predecessorPlanHash,c.predecessorScopeHash,c.predecessorSetupHash,c.predecessorActivationHash,c.predecessorPolicyHash,c.goalHash,c.businessHash,c.closureProofHash,c.revocationHash,c.settlementHash,c.historyHash].every(hash)||!integer(c.predecessorPlanVersion,1,9)||![c.goalRevision,c.businessRevision].every(x=>integer(x,1))||!integer(c.headRevision)||!["stopped","completed"].includes(c.headState)||!text(c.headReason,240)||!integer(c.baseChildren,0,28)||![c.baseDispatches,c.baseRepairs,c.basePivots].every(x=>integer(x)))return fail();
  money(c.baseKnownMicrounits);return structuredClone(c);
}
export function validatePublicResearchPredecessor(raw:unknown):PublicResearchPredecessor{
  if(exact(raw,"kind,closure")&&raw.kind==="adaptive_direct_origin")return{kind:"adaptive_direct_origin",closure:validatePublicResearchAdaptiveOriginClosure(raw.closure)};
  if(!exact(raw,"kind,closure,imports")||raw.kind!=="legacy_episode")return fail();
  const original=raw.closure as OwnerEpisodeClosure;
  if(!original||!integer(original.baseChildren,0,28)||!integer(original.baseDispatches,0,60))return fail();
  // The old exact shape is unchanged. Only this new four-child caller has one
  // extra capacity slot; validate every other legacy field with the old parser.
  validateOwnerEpisodeClosure({...original,baseChildren:Math.min(original.baseChildren,27),baseDispatches:Math.min(original.baseDispatches,59)});
  const c=structuredClone(original),v=raw as unknown as Extract<PublicResearchPredecessor,{kind:"legacy_episode"}>;
  const phases=["plan","search","select","strategy","review"],ids=new Set<string>();
  if(!Array.isArray(v.imports)||v.imports.length!==5)return fail();
  for(const[i,r]of v.imports.entries()){if(!exact(r,"phase,attemptId,artifactId,responseHash,receiptProofHash")||r.phase!==phases[i]||![r.attemptId,r.artifactId].every(uuid)||![r.responseHash,r.receiptProofHash].every(hash)||ids.has(r.attemptId)||ids.has(r.artifactId))return fail();ids.add(r.attemptId);ids.add(r.artifactId);}
  return{kind:"legacy_episode",closure:c,imports:structuredClone(v.imports)};
}
/** Structural integrity only. Trusted SQL must reconstruct the complete archive,
 * receipt qualification and revocation under the original Business/root locks. */
export function validatePublicResearchOriginHistory(raw:unknown,expected?:{businessId:string;goalId:string;predecessorScopeId:string;predecessorClosureHash:string}):PublicResearchOriginHistory{
  if(!exact(raw,"version,businessId,goalId,predecessorScopeId,predecessorClosureHash,receipts,financialProofs,provenance,materialHistory,continuity,historyHash"))return fail();publicBoundedJson(raw);
  const h=raw as unknown as PublicResearchOriginHistory;
  if(h.version!=="r12.public-research-origin-history.1"||![h.businessId,h.goalId,h.predecessorScopeId].every(uuid)||!hash(h.predecessorClosureHash))return fail();
  if(expected)for(const k of ["businessId","goalId","predecessorScopeId","predecessorClosureHash"]as const)if(h[k]!==expected[k])return fail();
  for(const x of [h.receipts,h.financialProofs,h.provenance,h.materialHistory])if(!Array.isArray(x)||x.length>4096)return fail();
  const responses=new Set<string>(),attempts=new Set<string>(),artifacts=new Set<string>();
  for(const r of h.receipts){if(!exact(r,"scopeId,scopeHash,planId,planHash,planVersion,actionOrdinal,phase,attemptId,artifactId,responseHash,receiptProofHash")||![r.scopeId,r.planId,r.attemptId,r.artifactId].every(uuid)||![r.scopeHash,r.planHash,r.responseHash,r.receiptProofHash].every(hash)||!integer(r.planVersion,1,9)||(r.actionOrdinal!==null&&!integer(r.actionOrdinal,0,10))||!["strategy","review"].includes(r.phase)||responses.has(r.responseHash)||attempts.has(r.attemptId)||artifacts.has(r.artifactId))return fail();responses.add(r.responseHash);attempts.add(r.attemptId);artifacts.add(r.artifactId);}
  const requests=new Set<string>();for(const f of h.financialProofs){if(!exact(f,"scopeId,attemptId,requestId,requestHash,reservationId,maximumMicrounits,actualMicrounits,disposition,qualificationHash,settlementHash")||![f.scopeId,f.attemptId,f.requestId,f.reservationId].every(uuid)||![f.requestHash,f.qualificationHash,f.settlementHash].every(hash)||!["qualified_receipt","qualified_terminal_failure"].includes(f.disposition)||money(f.actualMicrounits)>money(f.maximumMicrounits)||requests.has(f.requestId))return fail();requests.add(f.requestId);}
  const provenance=new Set<string>();for(const p of h.provenance){if(!exact(p,"kind,scopeId,containerId,containerHash,sourceId,sourceContentHash,evidenceId,evidenceIdentityHash,factIdentityHash,provenanceHash")||!["legacy_evidence","owner_observation"].includes(p.kind)||![p.scopeId,p.containerId].every(uuid)||![p.containerHash,p.sourceContentHash,p.evidenceIdentityHash].every(hash)||!text(p.sourceId,200)||!text(p.evidenceId,200)||(p.factIdentityHash!==null&&!hash(p.factIdentityHash))||provenance.has(p.provenanceHash))return fail();verifyPublicSelfHash(p as unknown as Record<string,unknown>,"provenanceHash");provenance.add(p.provenanceHash);}
  const material=new Set<string>();for(const m of h.materialHistory){if(!exact(m,"kind,recordHash,statement,sourceResponseHash,provenanceHashes")||!["negative_finding","unresolved_question","prior_decision"].includes(m.kind)||!text(m.statement,2000)||!responses.has(m.sourceResponseHash)||!publicHashSet(m.provenanceHashes)||m.provenanceHashes.some(x=>!provenance.has(x))||material.has(m.recordHash))return fail();verifyPublicSelfHash(m as unknown as Record<string,unknown>,"recordHash");material.add(m.recordHash);}
  const inherited=publicResearchInheritedHistoryUnchecked(h);validatePublicResearchHistory(inherited);
  for(const m of h.materialHistory){if(m.kind==="unresolved_question"&&!h.continuity.seenQuestionHashes.includes(publicResearchQuestionHash(m.statement)))return fail();if(m.kind==="negative_finding"&&!h.continuity.negativeFindingHashes.includes(m.recordHash))return fail();}
  for(const p of h.provenance)if(!h.continuity.seenEvidenceIdentityHashes.includes(p.evidenceIdentityHash)||(p.factIdentityHash!==null&&!h.continuity.seenFactIdentityHashes.includes(p.factIdentityHash)))return fail();
  verifyPublicSelfHash(raw,"historyHash");return structuredClone(h);
}
function publicResearchInheritedHistoryUnchecked(h:PublicResearchOriginHistory):PublicResearchHistory{return{...h.continuity,originHistoryHash:h.historyHash,archivedNegativeProvenanceHash:publicResearchHash({provenance:h.provenance,materialHistory:h.materialHistory})};}
export function publicResearchInheritedHistory(raw:unknown):PublicResearchHistory{return publicResearchInheritedHistoryUnchecked(validatePublicResearchOriginHistory(raw));}

/** New direct-mode archive identity only; does not change legacy quote hashes.
 * Caller must authenticate and validate the original saved observation first. */
export function publicResearchOwnerFactIdentity(observation:OwnerObservation,metric:OwnerObservationMetric):string{
  if(metric.kind==="rate")return fail("r12_public_unsupported_rate_fact");
  const norm=publicCanonicalText,c=observation.context;
  const context={productFormat:norm(c.productFormat),category:norm(c.category),query:norm(c.query),windowStart:c.windowStart,windowEnd:c.windowEnd,locale:norm(c.locale),geography:{kind:c.geography.kind,countries:[...c.geography.countries].sort(),basis:norm(c.geography.basis)}};
  const fact=metric.kind==="statement"?{kind:metric.kind,statement:norm(metric.displayed)}:metric.kind==="count"?{kind:metric.kind,unit:norm(metric.unit),value:metric.value,precision:metric.precision}:metric.kind==="money_range"?{kind:metric.kind,currency:metric.currency,lower:metric.lower,upper:metric.upper,basis:norm(metric.basis)}:{kind:metric.kind,scale:metric.scale.map(norm),value:norm(metric.value),definition:norm(metric.definition)};
  return publicResearchHash({version:"r12.public-owner-fact.1",context,fact});
}
