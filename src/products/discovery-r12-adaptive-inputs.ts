import type { AdaptiveFundingProof } from './discovery-r12-adaptive-funding-proof';
import { discoveryDeterministicId, normalizeDiscoveryPlanV2 } from './discovery-v2-plan';
import { projectAdaptivePhaseOutput } from './discovery-r12-adaptive-runtime';
import { normalizeAdaptiveReviewerResponse, adaptiveEvidenceIdentity } from './discovery-r12-adaptive-review-contract';
import type { JsonObject } from '../core/contracts';
import type { QuestAdapterContext } from '../core/quest-controller';
import { discoveryV2Hash as hash, type DiscoveryIntentV2, type PersistedResearchEvidenceV2, type CandidateIdentityV2, type DiscoveryDossierV2, type EvidenceRefV2 } from './discovery-v2';

import { pinDiscoveryKnowledgeV2, type DiscoveryKnowledgeContextV2 } from './discovery-v2-knowledge';
import { readOwnerObservationEvidenceContext, type OwnerObservationContextJSON } from './discovery-r12-owner-observation';
import { prepareDiscoveryWorkerContextV2 } from './discovery-v2-worker-contract';
import { extractResearchSources, validateResearchCollection } from '../research/sources';
import { assembleDiscoveryEvidenceV2 } from './discovery-v2-research';
import { qualifyDiscoveryR12Candidate } from './discovery-r12-receipt';
import type { DiscoveryR12CompletedPhase } from './discovery-r12-runtime';
import { bindValidatedAdaptiveResearchIntent, type AdaptiveIntentPins } from './discovery-r12-adaptive-intent';
import { validateAdaptiveExecutionScope, type DiscoveryAdaptiveOwnerScope } from './discovery-r12-adaptive-execution-scope';
import { validateAdaptiveResearchPlan, type AdaptiveResearchPreview } from './discovery-r12-adaptive-scope';
import type { AdaptiveResearchAction } from './discovery-r12-adaptive-action';
import type { AdaptivePhaseContext } from './discovery-r12-adaptive-runtime';
import { normalizeAdaptiveStrategistResponse } from './discovery-r12-adaptive-strategy';
import type { AdaptiveReviewContext } from './discovery-r12-adaptive-review-contract';

export type AdaptiveInputDependency = DiscoveryR12CompletedPhase & {
  origin: { planHash:string; scopeId:string; scopeHash:string; intentId:string; actionHash:string|null; actionOrdinal:number|null };
  intentPins: AdaptiveIntentPins|null;
};
export type AdaptiveEvidenceArchive = { persisted:PersistedResearchEvidenceV2; search:AdaptiveInputDependency; selector:AdaptiveInputDependency };
export type AdaptivePhaseInputEnvelope = {
  version:'r12.discovery-adaptive-inputs.1'|'r12.discovery-adaptive-inputs.2'; businessId:string; planId:string; planHash:string; attemptId:string;
  inputMode:'dispatch'|'receipt'; validationAt:string;
  fundingProof?:AdaptiveFundingProof|null;
  scope:DiscoveryAdaptiveOwnerScope; preview:AdaptiveResearchPreview; action:AdaptiveResearchAction; actionHash:string;
  intent:DiscoveryIntentV2; intentPins:AdaptiveIntentPins; knowledgeSnapshot:DiscoveryKnowledgeContextV2['snapshot'];
  dependencies:AdaptiveInputDependency[]; archive:AdaptiveEvidenceArchive[];
  priorFindings:NonNullable<AdaptiveReviewContext['priorFindings']>;
  ownerObservationContext: OwnerObservationContextJSON | null;
};
const fail=():never=>{throw new Error('r12_adaptive_phase_inputs_unverified');};
const same=(a:unknown,b:unknown)=>hash(a)===hash(b);
const execution=(d:AdaptiveInputDependency)=>({modelId:d.candidate.phase==="review"?"anthropic/claude-haiku-4.5":"openai/gpt-5.6-luna",providerRequestId:d.candidate.providerRequestId,primaryOnly:true as const,qualifiedRoute:{...d.proof,providerResponses:[...d.proof.providerResponses]}});
function receipt(d:AdaptiveInputDependency){
  if(!d||!d.origin||d.responseCanonicalHash!==hash(d.response)||d.response.outcome!=='accepted'||d.response.planHash!==d.origin.planHash||
    d.binding.scopeId!==d.origin.scopeId||d.binding.attemptId!==d.attemptId||d.binding.phase!==d.stepKey||
    d.response.result.candidateHash!==hash(d.candidate)||d.response.result.routeProofHash!==d.proof.proofHash||d.response.result.outputHash!==hash(d.candidate.output))fail();
  qualifyDiscoveryR12Candidate(d.candidate,d.binding,d.proof);
  if(d.response.result.adaptiveActionHash!==undefined&&(d.response.result.adaptiveActionHash!==d.origin.actionHash||d.response.result.adaptiveActionOrdinal!==d.origin.actionOrdinal))fail();
  if(d.origin.actionHash!==null){
    if(!d.intentPins||d.intentPins.actionHash!==d.origin.actionHash||d.intentPins.actionOrdinal!==d.origin.actionOrdinal||d.intentPins.scopeHash!==d.origin.scopeHash||d.intentPins.scopeId!==d.origin.scopeId)fail();
    if('messages'in d.binding.request&&(d.response.result.adaptiveBindingHash!==d.binding.request.requestMetadata?.adaptiveBindingHash||d.binding.request.requestMetadata?.adaptiveActionHash!==d.origin.actionHash||d.binding.request.requestMetadata?.adaptiveActionOrdinal!==d.origin.actionOrdinal))fail();
  }
}
function archived(a:AdaptiveEvidenceArchive){
  const {persisted:p,search:s,selector:t}=a;receipt(s);receipt(t);
  if(s.stepKey!=='search1'||t.stepKey!=='select1'||!same(s.origin,t.origin)||p.artifactId!==t.artifactId||p.workflowRunId!==t.attemptId||
    p.collectedForIntentId!==s.origin.intentId||!('query'in s.binding.request)||p.question!==s.binding.request.query||!same(p.sourceDomains,s.binding.request.allowedDomains)||
    p.lineage.sourceArtifactId!==s.artifactId||p.lineage.providerRequestId!==s.candidate.providerRequestId||p.lineage.workerRequestId!==t.candidate.providerRequestId)fail();
  const request={query:p.question,allowedDomains:p.sourceDomains},o=s.origin;
  const metadata:JsonObject=o.actionHash===null?{executionMode:'r12.discovery.search1',intentId:o.intentId,queryId:p.queryId,providerRequestId:s.candidate.providerRequestId,sourceScopeHash:o.scopeHash,candidateHash:hash(s.candidate),routeProofHash:s.proof.proofHash}:
    {intentId:o.intentId,adaptiveActionHash:o.actionHash,adaptiveScopeHash:o.scopeHash,providerRequestId:s.candidate.providerRequestId,routeProofHash:s.proof.proofHash};
  const collection=extractResearchSources(request,{annotations:s.candidate.output.annotations as JsonObject[],metadata},s.candidate.receivedAt);
  validateResearchCollection(collection,request,Date.parse(t.candidate.receivedAt));
  const pack=assembleDiscoveryEvidenceV2(collection,request,t.candidate.output,Date.parse(t.candidate.receivedAt));
  const qualified={version:o.actionHash===null?'r12.discovery-source.1':'r12.discovery-adaptive-source.1',scopeId:o.scopeId,scopeHash:o.scopeHash,
    ...(o.actionHash===null?{}:{actionIntentId:o.intentId,actionHash:o.actionHash}),searchCandidateHash:hash(s.candidate),selectorCandidateHash:hash(t.candidate),searchRoute:s.proof,selectorRoute:t.proof};
  if(!same(pack,p.evidencePack)||s.response.result.collectionHash!==hash(collection)||t.response.result.evidencePackHash!==hash(pack)||!same(p.lineage.qualifiedSource,qualified))fail();
  return {persisted:p,collection};
}
/** Only a same-owner SQL reconstruction may call this reader. Canonical hashes
 * detect corruption; they do not let browser packets create authority. */
export function readAdaptivePhaseInputs(ctx:QuestAdapterContext,raw:unknown):AdaptivePhaseContext & {validationAt:number; inputMode:"dispatch"|"receipt"}{
  if(!raw||typeof raw!=="object"||Array.isArray(raw))fail();
  const s=structuredClone(raw) as AdaptivePhaseInputEnvelope,at=Date.parse(s.validationAt);
  if(Object.keys(s).filter(k=>k!=="fundingProof").sort().join(",")!=="action,actionHash,archive,attemptId,businessId,dependencies,inputMode,intent,intentPins,knowledgeSnapshot,ownerObservationContext,planHash,planId,preview,priorFindings,scope,validationAt,version")fail();
  const etsy=s.scope?.version==='r12.discovery-owner-adaptive.2';
  if(s.version!==(etsy?'r12.discovery-adaptive-inputs.2':'r12.discovery-adaptive-inputs.1')||s.businessId!==ctx.plan.businessId||s.planId!==ctx.planId||s.planHash!==ctx.planHash||s.attemptId!==ctx.attempt.id||
    !Number.isFinite(at)||at>Date.now()||!['dispatch','receipt'].includes(s.inputMode)||s.inputMode==='dispatch'&&!['scheduled','reserved'].includes(ctx.attempt.status))fail();
  validateAdaptiveExecutionScope(s.scope,s.preview,at,s.fundingProof??null);validateAdaptiveResearchPlan(ctx.plan,s.preview,{id:s.scope.id,hash:hash(s.scope)},at);
  if(s.actionHash!==hash(s.action)||s.action.scopeId!==s.scope.id||s.action.scopeHash!==hash(s.scope)||s.intentPins.scopeId!==s.scope.id||s.intentPins.scopeHash!==hash(s.scope)||s.intentPins.actionHash!==s.actionHash||s.intentPins.actionOrdinal!==s.action.ordinal||
    ctx.attempt.adaptiveActionHash!==s.actionHash||ctx.attempt.adaptiveActionOrdinal!==s.action.ordinal||s.intentPins.approvedQuery!==(s.action.ordinal===0?s.scope.approvedQuery:`${s.scope.approvedQuery}\nInvestigate: ${s.action.question}`)||
    !same(s.intentPins.ownerObservationRef,s.scope.ownerObservationRef)||s.intent.businessId!==s.businessId||s.intent.expiresAt!==s.scope.expiresAt||!same(s.intent.comparisonUniverse.sourceDomains,s.scope.allowedDomains)||
    !same(s.intent.comparisonUniverse.markets,s.scope.intent.comparisonUniverse.markets)||!same(s.intent.comparisonUniverse.audiences,s.scope.intent.comparisonUniverse.audiences))fail();
  const phase=ctx.step.key==='search1'?'search':ctx.step.key==='select1'?'select':ctx.step.key;
  if(etsy && !['plan','strategy','review'].includes(phase))fail();
  if(!['plan','search','select','strategy','review'].includes(phase)||!s.action.phases.includes(phase as AdaptivePhaseContext['phase']))fail();
  if(!Array.isArray(s.priorFindings)||s.priorFindings.length>100||s.priorFindings.some(f=>!f||typeof f.questionId!=="string"||f.questionId.length>200||! /^[a-f0-9]{64}$/.test(f.findingHash)||typeof f.statement!=="string"||f.statement.length>600||!Array.isArray(f.evidenceIdentityHashes)||f.evidenceIdentityHashes.some(h=>! /^[a-f0-9]{64}$/.test(h))))fail();
  const binding=bindValidatedAdaptiveResearchIntent(s.intent,s.intentPins,at),knowledge=pinDiscoveryKnowledgeV2(s.knowledgeSnapshot,at);
  if(!Array.isArray(s.dependencies)||s.dependencies.length!==ctx.attempt.dependencyPins.length||s.dependencies.length!==ctx.step.dependsOn.length||new Set(s.dependencies.map(d=>d.stepKey)).size!==s.dependencies.length)fail();
  for(const d of s.dependencies){receipt(d);if(!ctx.step.dependsOn.includes(d.stepKey))fail();if(!ctx.attempt.dependencyPins.some(p=>p.stepKey===d.stepKey&&p.attemptId===d.attemptId&&p.resultHash===d.responseHash))fail();
    const dp=d.stepKey==='search1'?'search':d.stepKey==='select1'?'select':d.stepKey;
    if(s.action.phases.includes(dp as AdaptivePhaseContext['phase'])&&(d.origin.actionHash!==s.actionHash||d.origin.actionOrdinal!==s.action.ordinal||d.origin.planHash!==ctx.planHash))fail();}
  if(!Array.isArray(s.archive)||s.archive.length!==binding.evidenceManifest.length||new Set(s.archive.map(a=>a.persisted.artifactId)).size!==s.archive.length)fail();
  if(etsy && (s.archive.length!==0 || binding.activeEvidenceArtifactIds.length!==0 || binding.evidenceManifest.length!==0 || !binding.ownerObservationRef))fail();
  const archive=s.archive.map(archived);
  for(const a of archive){const p=a.persisted,m=binding.evidenceManifest.find(m=>m.artifactId===p.artifactId),q=p.lineage.qualifiedSource;
    if(!m||p.businessId!==s.businessId||m.packHash!==hash(p.evidencePack)||m.queryId!==p.queryId||m.collectedForIntentId!==p.collectedForIntentId||m.scopeId!==q?.scopeId||m.scopeHash!==q?.scopeHash||m.actionHash!==(q?.actionHash??null))fail();}
  const ownerObservations=readOwnerObservationEvidenceContext(s.ownerObservationContext,{selection:binding.ownerObservationRef,intentId:s.intent.id,businessId:s.businessId,
    scopeId:s.scope.id,scopeHash:hash(s.scope),approvalHash:s.scope.approvalHash,
    occupiedArtifactIds:archive.map(a=>a.persisted.artifactId),occupiedSourceIds:archive.flatMap(a=>a.persisted.evidencePack.sources.map(v=>v.id)),now:at});
  const result:AdaptivePhaseContext & {validationAt:number; inputMode:"dispatch"|"receipt"}={validationAt:at,inputMode:s.inputMode,binding,knowledge,ownerObservations,phase:phase as AdaptivePhaseContext['phase']};
  const dep=(key:string)=>s.dependencies.find(d=>d.stepKey===key)??fail();
  if(phase==='select'){
    const search=dep('search1');if(!('query'in search.binding.request)||search.binding.request.query!==binding.approvedQuery||!same(search.binding.request.allowedDomains,s.scope.allowedDomains))fail();
    result.collection=extractResearchSources({query:binding.approvedQuery,allowedDomains:s.scope.allowedDomains},{annotations:search.candidate.output.annotations as JsonObject[],metadata:{intentId:s.intent.id,adaptiveActionHash:s.actionHash,adaptiveScopeHash:binding.scopeHash,providerRequestId:search.candidate.providerRequestId,routeProofHash:search.proof.proofHash}},search.candidate.receivedAt);
    if(search.response.result.collectionHash!==hash(result.collection))fail();
  }
  if(phase==='strategy'||phase==='review'){
    const plan=dep('plan'),proposals=plan.candidate.output.proposals as Array<{concept:string;audience:string}>,candidates=plan.response.result.candidates as CandidateIdentityV2[];
    if(!Array.isArray(proposals)||!Array.isArray(candidates)||proposals.length!==candidates.length||candidates.some((c,i)=>c.id!==discoveryDeterministicId(plan.origin.actionHash===null?`r12:candidate:${plan.origin.scopeId}:candidate-${i+1}`:`r12:adaptive:candidate:${plan.origin.intentId}:candidate-${i+1}`)||c.concept!==proposals[i].concept||c.audience!==proposals[i].audience||c.businessId!==s.businessId||c.originalDesign!==true||c.rightsStatus!=='unclear'||c.productType!=='original_pod_tshirt'))fail();
    const active=archive.filter(a=>binding.activeEvidenceArtifactIds.includes(a.persisted.artifactId)).map(a=>a.persisted);
    const dossier:DiscoveryDossierV2={version:'pod-discovery-2.0',intentId:s.intent.id,businessId:s.businessId,shortlist:candidates,comparisonRationale:String(plan.candidate.output.comparisonRationale),packRefs:active.map(p=>({artifactId:p.artifactId,sha256:hash(p.evidencePack),origin:p.collectedForIntentId===s.intent.id?'new':'prior',query:{id:p.queryId,question:p.question,sourceDomains:p.sourceDomains}}))};
    const refs:EvidenceRefV2[]=active.flatMap(p=>p.evidencePack.evidence.map(e=>{const source=p.evidencePack.sources.find(v=>v.id===e.sourceId)??fail(),offset=source.excerpt.indexOf(e.quote);if(offset<0)fail();const start=Array.from(source.excerpt.slice(0,offset)).length;return{artifactId:p.artifactId,evidenceId:e.id,sourceId:e.sourceId,sourceContentHash:source.contentHash,start,end:start+Array.from(e.quote).length};}));
    if(ownerObservations){
      dossier.ownerObservationRef={scopeId:ownerObservations.scopeId,scopeHash:ownerObservations.scopeHash,approvalHash:ownerObservations.approvalHash,manifestHash:ownerObservations.manifestHash};
      for(const m of ownerObservations.manifest)for(const o of ownerObservations.bundles.get(m.bundleId)!.observations.filter(o=>m.selectedObservationIds.includes(o.id)))
        for(const metric of o.metrics)refs.push({artifactId:o.id,evidenceId:metric.id,sourceId:o.sourceId,sourceContentHash:o.contentHash,start:metric.start,end:metric.end});
    }
    const prepare=(b:typeof binding)=>prepareDiscoveryWorkerContextV2(s.intent,dossier,{knowledge,packs:new Map(active.map(p=>[p.artifactId,p])),candidates:new Map(candidates.map(c=>[c.id,c])),ownerAdaptive:b,
      ...(ownerObservations?{ownerObservations}:{}),committedMicrousd:b.finance.runCommittedMicrousd},refs,at);
    result.prepared=prepare(binding);
    if(phase==='review'){
      const strategy=dep('strategy');if(!strategy.intentPins)fail();const original=bindValidatedAdaptiveResearchIntent(s.intent,strategy.intentPins!,at);
      if(!same({...original,finance:binding.finance,bindingHash:binding.bindingHash},binding))fail();
      result.strategy=normalizeAdaptiveStrategistResponse(prepare(original),strategy.candidate.output,execution(strategy),at);
      if(strategy.response.result.proposalHash!==result.strategy.proposalHash)fail();
      const prepared=result.prepared,a=result.strategy.assessment;
      result.reviewContext={proposalHash:result.strategy.proposalHash,proposedTest:result.strategy.proposedTest,allowedEvidenceRefs:prepared.evidencePool.map(e=>e.key),
        evidenceIdentityHashes:Object.fromEntries(prepared.evidencePool.map(e=>[e.key,adaptiveEvidenceIdentity(e)])),currentInputRefs:['recommendation',...candidates.map(c=>c.id),...(result.strategy.proposedTest?['testPlan']:[])],
        missingProposalRequirements:result.strategy.proposedTest?[]:['measurable_plan'],inheritedQuestions:[...new Set([...a.missingQuestions,...binding.materialHistory.filter(h=>h.kind==='unresolved_question').map(h=>h.statement)])],
        producerModelId:a.execution.modelId,reviewerModelId:'anthropic/claude-haiku-4.5',priorFindings:s.priorFindings,allowReasoningProgress:s.action.kind==='reasoning_review'};
    }
  }
  return result;
}


/** Project only an already qualified current receipt. The adapter supplies the
 * exact saved request; no phase is declared complete from model self-report. */
export function projectAdaptivePhaseResponse(ctx:QuestAdapterContext,inputs:AdaptivePhaseContext,
  qualified:ReturnType<typeof qualifyDiscoveryR12Candidate>,request:import('../models/types').StructuredModelRequest|import('../models/types').WebSearchModelRequest):Omit<import('../core/quest-controller').QuestEffectResponse,'settlement'>{
  const c=qualified.candidate,b=inputs.binding;
  if(c.attemptId!==ctx.attempt.id||c.scopeId!==b.scopeId||c.phase!==ctx.step.key||c.requestHash!==hash(request)||ctx.attempt.adaptiveActionHash!==b.actionHash||ctx.attempt.adaptiveActionOrdinal!==b.actionOrdinal)fail();
  if('messages'in request&&(request.requestMetadata?.adaptiveBindingHash!==b.bindingHash||request.requestMetadata?.adaptiveActionHash!==b.actionHash))fail();
  const execution={modelId:c.providerModelId,providerRequestId:c.providerRequestId,primaryOnly:true as const,qualifiedRoute:{...qualified.route,providerResponses:[...qualified.route.providerResponses]}};
  const output=projectAdaptivePhaseOutput(inputs,c.output,execution,inputs.validationAt??Date.parse(c.receivedAt),Date.parse(c.receivedAt));
  let result:Record<string,unknown>;
  if(inputs.phase==='plan'){
    const plan=output as ReturnType<typeof normalizeDiscoveryPlanV2>;
    result={planHash:hash(plan),candidates:plan.proposals.map(p=>({id:discoveryDeterministicId(`r12:adaptive:candidate:${b.intent.id}:${p.proposalKey}`),businessId:b.intent.businessId,concept:p.concept,audience:p.audience,productType:'original_pod_tshirt',originalDesign:true,rightsStatus:'unclear'}))};
  }else if(inputs.phase==='search')result={collectionHash:hash(output)};
  else if(inputs.phase==='select')result={evidencePackHash:hash(output)};
  else if(inputs.phase==='strategy'){const strategy=output as ReturnType<typeof normalizeAdaptiveStrategistResponse>;result={proposalHash:strategy.proposalHash,assessmentHash:hash(strategy.assessment),outcome:strategy.assessment.recommendation.proposedOutcome};}
  else {const review=output as ReturnType<typeof normalizeAdaptiveReviewerResponse>;result={verdict:'pass',reviewHash:hash(output),outcome:review.outcome,candidateId:inputs.strategy!.assessment.recommendation.candidateId,marketCountryCode:inputs.strategy!.assessment.recommendation.marketCountryCode,review:output};}
  return{outcome:'accepted',result:{...result,adaptiveActionHash:b.actionHash,adaptiveActionOrdinal:b.actionOrdinal,adaptiveBindingHash:b.bindingHash},checkedArtifacts:inputs.phase==='review'?structuredClone(ctx.attempt.dependencyPins):[]};
}
