// Inert route receipts prove the real runtime reader/projector, never a provider call.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {discoveryKnowledgeFixture} from './discovery-v2-fixtures.mjs';
import {r12PhaseOutputFixture} from './helpers/r12-phase-output-fixture.mjs';
import {focusedProfileFixture,focusedStrategyOutput} from './helpers/r12-focused-profile-fixture.mjs';
import {buildDiscoveryIntentFromGoal,DISCOVERY_GOAL_DEFAULT} from '../.core-tests/products/discovery-v2-goal.js';
import {discoveryV2Hash as hash,REVIEW_CHECKS_V2,DISCOVERY_V2_EXECUTION_PREREQUISITES} from '../.core-tests/products/discovery-v2.js';
import {discoveryAddendumReferences} from '../.core-tests/products/discovery-r12-evidence-addendum.js';
import {createDiscoveryR12Candidate,qualifyDiscoveryR12Candidate,discoveryR12ReceiptExpectation} from '../.core-tests/products/discovery-r12-receipt.js';
import {qualifyGenerationRouteProof} from '../.core-tests/research/generation-route.js';
import {readDiscoveryR12PhaseInputs,buildDiscoveryR12PhaseRequest,projectDiscoveryR12Phase,reconstructDiscoveryR12Result} from '../.core-tests/products/discovery-r12-runtime.js';
import {focusedPilotHistoricalRecord} from '../.core-tests/products/discovery-r12-focused-pilot-runtime.js';
import {prepareDiscoveryWorkerContextV2,buildReviewerRequestV2,normalizeStrategistResponseV2,normalizeReviewerResponseV2,reviewerResponseSchemaV2} from '../.core-tests/products/discovery-v2-worker-contract.js';
import {validateDiscoveryFocusedPilot} from '../.core-tests/products/discovery-r12-focused-pilot-scope.js';
import {assertJsonSchemaValue} from '../.core-tests/workers/schema-validator.js';
import {discoveryR12StaticSchema} from '../.core-tests/products/discovery-r12-schemas.js';
import {focusedPilotStrategySchema} from '../.core-tests/products/discovery-r12-focused-pilot-contract.js';
import {routeDiscoveryR12Request,inspectDiscoveryR12Wire} from '../.core-tests/products/discovery-r12-wire.js';
import {DISCOVERY_R12_PILOT_REQUEST_BYTES} from '../.core-tests/products/discovery-r12-quote.js';
const id=n=>`bbbbbbbb-bbbb-4bbb-8bbb-${String(n).padStart(12,'0')}`;
const now=Date.parse('2026-10-07T00:00:00.000Z');
const stamp=n=>new Date(n).toISOString();
function withClock(at, fn){const previous=Date.now;Date.now=()=>at;try{return fn();}finally{Date.now=previous;}}
function context(plan,phase,dependencies,n){const step=plan.steps.find(s=>s.key===phase);return{planId:id(n),planHash:hash(plan),plan,step,knowledge:{},attempt:{id:id(n+1),stepKey:phase,attempt:1,status:'scheduled',reason:'Synthetic bounded runtime check',inputHash:hash({n}),dependencyPins:dependencies.map(d=>({stepKey:d.stepKey,attemptId:d.attemptId,resultHash:d.responseHash})),repairEvidenceHash:'0'.repeat(64),wireHash:null,requestId:id(n+2),responseHash:null}};}
function phase(ctx,raw,output,at){
 const state=readDiscoveryR12PhaseInputs(ctx,raw),request=buildDiscoveryR12PhaseRequest(ctx,state);
 const binding={scopeId:ctx.plan.discoveryScopeId,attemptId:ctx.attempt.id,requestId:ctx.attempt.requestId,phase:ctx.step.key,request,maximumMicrousd:10000,dispatchedAt:stamp(at),receiptExpiresAt:stamp(at+1800000)};
 const candidate=createDiscoveryR12Candidate(binding,{providerModelId:ctx.step.key==='review'?'anthropic/claude-4.5-haiku-20251001':'openai/gpt-5.6-luna-20260709',providerRequestId:`gen-r12-inert-${ctx.attempt.id}`,usage:{reportedCostUsd:.00001},metadata:{finishReason:'stop',...(ctx.step.key==='search1'?{searchRequests:1}:{})},output},stamp(at+1));
 const proof=qualifyGenerationRouteProof({data:{id:candidate.providerRequestId,provider_name:ctx.step.key==='review'?'Amazon Bedrock':'Azure',model:candidate.providerModelId}},discoveryR12ReceiptExpectation(candidate));
 const receipt={...raw,inputMode:'receipt'},qualified=qualifyDiscoveryR12Candidate(candidate,binding,proof);
 const projected=projectDiscoveryR12Phase(ctx,readDiscoveryR12PhaseInputs(ctx,receipt),qualified,request);
 const response={...projected,result:{...projected.result,candidateHash:hash(candidate),routeProofHash:proof.proofHash,outputHash:hash(candidate.output)},planHash:ctx.planHash,inputHash:ctx.attempt.inputHash};
 const current={stepKey:ctx.step.key,attemptId:ctx.attempt.id,artifactId:id(Number(ctx.attempt.id.slice(-12))+1000),responseHash:hash({response,sql:true}),responseCanonicalHash:hash(response),response,binding,candidate,proof};
 const saved={version:'r12.discovery-saved-result.1',context:{...ctx,attempt:{...ctx.attempt,status:'completed',responseHash:current.responseHash}},inputs:receipt,current};
 return{current,saved,request,state};
}
function historicalFixture(){return withClock(now-2*86400000,()=>{
 const at=Date.now(),p=focusedProfileFixture(),priorIntent=buildDiscoveryIntentFromGoal({id:p.priorRoundId,businessId:p.businessId,goal:DISCOVERY_GOAL_DEFAULT,maximumMicrousd:2000000,maximumCollections:1,now:at-86400000});
 const original={businessId:p.businessId,budgetAuthorityRootId:p.budgetAuthorityRootId,priorRoundId:p.priorRoundId,semanticGoalHash:'a'.repeat(64),priorIntent,maximumMicrousd:2000000,committedMicrousd:100,hasUncertainCosts:false};
 const approvedQuery='Compare adult nature-shirt purchase criteria using bounded dated public snippets and preserve all geographic and evidence limitations.';
 const amendment={version:'r12.discovery-source-scope.1',id:p.history.acceptedReviewScopeId,businessId:p.businessId,goalId:p.originalGoalId,budgetAuthorityRootId:p.budgetAuthorityRootId,priorRoundId:p.priorRoundId,originalIntentHash:hash(priorIntent),originalSemanticGoalHash:original.semanticGoalHash,allowedDomains:['adult-outdoors.example'],excludedDomains:['etsy.com','etsy.me','etsystatic.com'],sourceReviews:[{domain:'adult-outdoors.example',basis:'documented_api_factual_snippets',reviewHash:'b'.repeat(64)}],approvalHash:'c'.repeat(64),independentReviewHash:'d'.repeat(64),approvedQuery,purposeReviewHash:hash({query:approvedQuery,classification:'generic_nonpersonal_public_research'}),createdAt:stamp(at-60000),expiresAt:stamp(at+3600000)};
 const knowledge=discoveryKnowledgeFixture(at),plan={format:'r12.discovery.1',businessId:p.businessId,goalId:p.originalGoalId,discoveryScopeId:amendment.id,discoveryScopeHash:hash(amendment),maximumDispatches:5,maximumChildren:5,steps:['plan','search1','select1','strategy','review'].map(key=>({key,packSnapshotHash:'1'.repeat(64)}))};
 const outputs=r12PhaseOutputFixture(priorIntent.comparisonUniverse.audiences[0]),dependencies=[];let last;
 for(const [i,key] of ['plan','search1','select1','strategy','review'].entries()){
  const ctx=context(plan,key,dependencies,100+i*10);ctx.planId=id(90);
  const raw={version:'r12.discovery-inputs.1',businessId:p.businessId,planId:ctx.planId,attemptId:ctx.attempt.id,inputMode:'dispatch',validationAt:stamp(at),knowledgeSnapshot:knowledge.snapshot,knowledgeSnapshotHash:ctx.step.packSnapshotHash,knowledgeCanonicalHash:hash(knowledge.snapshot),original:{...original,committedMicrousd:100+10*i},amendment,dependencies:structuredClone(dependencies)};
  last=phase(ctx,raw,outputs[key],at);dependencies.push(last.current);
 }
 return{saved:last.saved,result:reconstructDiscoveryR12Result(last.saved,p.businessId,amendment.id),original};
});}
function fixture(){const old=historicalFixture(),p=focusedProfileFixture();p.originalIntentHash=hash(old.original.priorIntent);p.originalSemanticGoalHash=old.original.semanticGoalHash;
 p.candidate=structuredClone(old.result.dossier.shortlist[0]);p.intent.comparisonUniverse.audiences=[p.candidate.audience];p.history.acceptedReviewHash=hash(old.result.review);p.history.record=focusedPilotHistoricalRecord(old.result);p.history.recordHash=hash(p.history.record);p.observations.predecessorReviewHash=p.history.acceptedReviewHash;
 // Addendum hash is only in evidence refs' artifact and source span identities; dates stay exact.
 p.pinnedLearningPlan.evidenceRefs=discoveryAddendumReferences(p.observations);
 const envelope={version:'r12.discovery-focused-pilot.1',id:p.id,businessId:p.businessId,goalId:p.goalId,originalGoalId:p.originalGoalId,budgetAuthorityRootId:p.budgetAuthorityRootId,priorRoundId:p.priorRoundId,profile:p,profileHash:hash(p),closedPlanId:id(98),closedPlanHash:'8'.repeat(64),acceptedReviewScopeId:p.history.acceptedReviewScopeId,acceptedReviewHash:p.history.acceptedReviewHash,acceptedReviewRecordHash:p.history.recordHash,originalIntentHash:p.originalIntentHash,originalSemanticGoalHash:p.originalSemanticGoalHash,allowedDomains:p.intent.comparisonUniverse.sourceDomains,excludedDomains:['etsy.com','etsy.me','etsystatic.com'],approvedQuery:p.learningQuestion,approvalHash:'6'.repeat(64),independentReviewHash:'7'.repeat(64),createdAt:p.createdAt,expiresAt:p.expiresAt};
 const plan={format:'r12.discovery-pilot.1',businessId:p.businessId,goalId:p.goalId,discoveryScopeId:p.id,discoveryScopeHash:hash(envelope),maximumDispatches:2,maximumChildren:2,maximumRepairs:0,maximumPivots:0,requiredChecks:['review'],steps:[{key:'strategy',kind:'work',dependsOn:[],packSnapshotHash:'2'.repeat(64)},{key:'review',kind:'review',dependsOn:['strategy'],packSnapshotHash:'2'.repeat(64)}]};
 const knowledge=discoveryKnowledgeFixture(now),original={...old.original,committedMicrousd:168570};
 const raw=(ctx,dependencies=[])=>({version:'r12.discovery-pilot-inputs.1',businessId:p.businessId,planId:ctx.planId,attemptId:ctx.attempt.id,inputMode:'dispatch',validationAt:stamp(now),knowledgeSnapshot:knowledge.snapshot,knowledgeSnapshotHash:ctx.step.packSnapshotHash,knowledgeCanonicalHash:hash(knowledge.snapshot),original:{...original,committedMicrousd:original.committedMicrousd+10*dependencies.length},amendment:envelope,dependencies,focusedPilot:{profile:p,profileHash:hash(p),acceptedReview:old.saved,closedPlanId:envelope.closedPlanId,closedPlanHash:envelope.closedPlanHash}});
 const ctx=context(plan,'strategy',[],500),value=raw(ctx),v=validateDiscoveryFocusedPilot(envelope,original,now);
 const dossier={version:'pod-discovery-2.0',intentId:p.id,businessId:p.businessId,shortlist:[p.candidate],packRefs:[],comparisonRationale:p.history.scopeChangeExplanation,addendumRef:{artifactId:p.observations.id,sha256:hash(p.observations)}};
 const prepared=prepareDiscoveryWorkerContextV2(p.intent,dossier,{knowledge,packs:new Map(),candidates:new Map([[p.candidate.id,p.candidate]]),ownerRightsConfirmedCandidateIds:[],sellerBankCountry:null,committedMicrousd:original.committedMicrousd,evidenceAddendum:p.observations,focusedPilot:v},discoveryAddendumReferences(p.observations),now);
 return{ctx,raw,value,p,old,envelope,prepared};}
function decode(request){const encoded=JSON.parse(request.messages[1].content);const f=v=>Array.isArray(v)?v.map(f):v&&typeof v==='object'?Object.keys(v).length===1&&'$text'in v?encoded.sharedText[v.$text]:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,f(x)])):v;return f(encoded);}
function completed(){const f=fixture(),first=phase(f.ctx,f.value,focusedStrategyOutput(f.prepared),now),ctx=context(f.ctx.plan,'review',[first.current],510);ctx.planId=f.ctx.planId;
 const output={marketCountryCode:'GB',candidateKey:'C1',outcome:'TEST',sufficiencyRationale:'The proposed original composition inspection can answer its bounded learning question, while preserving all commercial unknowns and separate execution approvals.',dimensions:f.prepared.dossier.shortlist.length?f.prepared.validation.focusedPilot.profile&&focusedStrategyOutput(f.prepared).candidates[0].dimensions.map(d=>({dimension:d.dimension,verdict:d.uncertainties.length?'nonblocking_unknown':'sufficient_for_test',rationale:'The finding is sufficient only for the bounded private composition test and preserves every commercial unknown.',evidence:d.facts.map(x=>x.evidence)})):[],checks:REVIEW_CHECKS_V2.map(check=>({check,outcome:'PASS',rationale:'The bounded private proposal preserves source limitations, originality constraints and all separate execution approvals.'})),additionalUncertainties:[]};
 const last=phase(ctx,f.raw(ctx,[first.current]),output,now);return{f,first,last,ctx};}

test('actual runtime reads an independent zero-pack pilot and retains qualified old NME as history only',()=>withClock(now,()=>{const f=fixture(),state=readDiscoveryR12PhaseInputs(f.ctx,f.value),request=buildDiscoveryR12PhaseRequest(f.ctx,state),input=decode(request);assert.equal(state.kind,'focused_pilot');assert.equal(state.scope,undefined);assert.equal(state.dependencies.length,0);assert.equal(input.previousDecision,undefined);assert.equal(input.candidates.length,1);assert.deepEqual(input.comparisonUniverse.markets,[{countryCode:'GB',currency:'GBP'}]);assert.equal(input.evidence.length,2);assert.deepEqual(input.focusedPilot.historicalCase.record.questions,f.p.history.record.missingQuestions);assert.equal(input.focusedPilot.historicalCase.record.candidates.length,1);assert.equal(input.focusedPilot.historicalCase.record.omittedCandidateRows.count,2);assert.equal(input.focusedPilot.historicalCase.record.sufficiencyRationale,f.p.history.record.sufficiencyRationale);assert.equal(request.requestMetadata.r12FocusedPilotProfileHash,hash(f.p));assert.ok(f.old.result.evidence.evidencePack.sources.every(s=>Date.parse(s.retrievalExpiresAt)<now));}));
test('own strategy then independent review reconstruct exact pinned TEST and only two new phase receipts',()=>withClock(now,()=>{const{f,first,last}=completed(),result=reconstructDiscoveryR12Result(last.saved,f.p.businessId,f.p.id);assert.equal(result.version,'r12.discovery-focused-pilot-result.1');assert.equal(result.review.outcome,'TEST');assert.deepEqual(result.assessment.testPlan,f.p.pinnedLearningPlan);assert.deepEqual(result.phaseReceipts.map(x=>x.phase),['strategy','review']);assert.equal(result.executionAuthorized,false);assert.equal(result.evidence,undefined);assert.equal(result.planner,undefined);assert.deepEqual(result.dossier.packRefs,[]);assert.equal(result.assessment.execution.qualifiedRoute.proofHash,first.current.proof.proofHash);assert.equal(result.review.execution.qualifiedRoute.proofHash,last.current.proof.proofHash);withClock(now+3*86400000,()=>assert.deepEqual(reconstructDiscoveryR12Result(last.saved,f.p.businessId,f.p.id),result));}));
test('accepted prior result, normalized record, root funding and exact envelope pins reject substitutions',()=>withClock(now,()=>{const f=fixture();for(const mutate of [v=>v.focusedPilot.acceptedReview.current.proof.providerName='Other',v=>v.focusedPilot.acceptedReview.current.response.result.reviewHash='0'.repeat(64),v=>v.focusedPilot.closedPlanHash='0'.repeat(64),v=>v.focusedPilot.profile.history.record.missingQuestions=[],v=>v.original.maximumMicrousd=100000,v=>v.original.hasUncertainCosts=true,v=>v.original.budgetAuthorityRootId=id(987),v=>v.version='r12.discovery-inputs.1',v=>v.dependencies=[f.old.saved.current],v=>v.sourceDependencies=f.old.saved.inputs.dependencies]){const raw=structuredClone(f.value);mutate(raw);assert.throws(()=>readDiscoveryR12PhaseInputs(f.ctx,raw));}}));
test('review rejects an old strategist and modified own receipt pins, knowledge, plan or spending snapshot',()=>withClock(now,()=>{const {f,first,ctx}=completed();for(const mutate of [v=>v.dependencies[0]=f.old.saved.inputs.dependencies[3],v=>v.dependencies[0].proof.proofHash='0'.repeat(64),v=>v.dependencies[0].response.result.assessmentHash='0'.repeat(64),v=>v.dependencies[0].binding.request.requestMetadata.r12FocusedPilotProfileHash='0'.repeat(64),v=>v.dependencies[0].binding.request.requestMetadata.r12CommittedBeforeAttemptMicrousd=1999999,v=>v.knowledgeCanonicalHash='0'.repeat(64)]){const raw=structuredClone(f.raw(ctx,[first.current]));mutate(raw);assert.throws(()=>buildDiscoveryR12PhaseRequest(ctx,readDiscoveryR12PhaseInputs(ctx,raw)));}}));
test('late dispatch cannot reuse a snapshot to extend the profile or observations',()=>withClock(now,()=>{const f=fixture(),state=readDiscoveryR12PhaseInputs(f.ctx,f.value);withClock(Date.parse(f.p.expiresAt),()=>assert.throws(()=>buildDiscoveryR12PhaseRequest(f.ctx,state),/expiry|expired/));}));

export {fixture,completed,phase,context,withClock,decode,now};

test('history relevance projection preserves exact selected and global questions, reasons and flags without changing saved history',async()=>{
 const{focusedPilotHistoricalContext}=await import('../.core-tests/products/discovery-r12-focused-pilot-history.js');
 withClock(now,()=>{const f=fixture(),h=structuredClone(f.p.history);h.record.additionalUncertainties=[{dimension:'estimated_margin',question:'Which costs remain unknown before any later commercial decision?',blockingForTest:true,reason:'The original broad commercial test remains blocked until those exact costs are independently supported.'}];h.record.missingQuestions.push(h.record.additionalUncertainties[0].question);h.recordHash=hash(h.record);const before=structuredClone(h),r=focusedPilotHistoricalContext(h,f.p.candidate.id).record;
 const rows=r.candidates.map(([candidateId,concept,dimensions])=>({candidateId,concept,dimensions:dimensions.map(([dimension,uncertainties])=>({dimension,uncertainties:uncertainties.map(([q,blockingForTest,reason])=>({question:r.questions[q],blockingForTest,reason}))}))}));
 assert.deepEqual(rows,h.record.priorCandidateUncertainties.filter(c=>c.candidateId===f.p.candidate.id));assert.deepEqual(r.additionalUncertainties.map(([dimension,q,blockingForTest,reason])=>({dimension,question:r.questions[q],blockingForTest,reason})),h.record.additionalUncertainties);assert.deepEqual(r.checks.map(([check,outcome,rationale])=>({check,outcome,rationale})),h.record.checks);assert.deepEqual(h,before);assert.throws(()=>focusedPilotHistoricalContext(h,id(999)));});
});
test('even consistently rehashed profile cannot rename or replace the historical candidate',()=>withClock(now,()=>{const f=fixture(),raw=structuredClone(f.value);raw.amendment.profile.candidate.concept='A different new original concept';raw.amendment.profileHash=hash(raw.amendment.profile);raw.focusedPilot.profile=raw.amendment.profile;raw.focusedPilot.profileHash=raw.amendment.profileHash;const ctx=structuredClone(f.ctx);ctx.plan.discoveryScopeHash=hash(raw.amendment);ctx.planHash=hash(ctx.plan);assert.throws(()=>readDiscoveryR12PhaseInputs(ctx,raw),/inputs_unverified/);}));
test('NME stays a nonauthorizing NME through the actual focused strategy projector',()=>withClock(now,()=>{const f=fixture(),output=focusedStrategyOutput(f.prepared);output.usesPinnedLearningPlan=false;output.recommendation.proposedOutcome='NEEDS_MORE_EVIDENCE';const first=phase(f.ctx,f.value,output,now);assert.equal(first.current.response.result.outcome,'NEEDS_MORE_EVIDENCE');assert.equal(first.current.candidate.output.testPlan,undefined);assert.equal(first.current.candidate.output.usesPinnedLearningPlan,false);}));

// Frozen synthetic outputs reproduce only the rejected response's structure.
// No private provider prose, identities, source captures or request payloads.
function frozenReviewFixture() {
 const saved=JSON.parse(readFileSync(new URL('./fixtures/r12-focused-review-rejected.json',import.meta.url),'utf8'));
 const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
 const {prepared}=fixture(),executions={strategist:{modelId:'openai/gpt-5.6-luna',providerRequestId:'gen-sanitized-strategy',primaryOnly:true},reviewer:{modelId:'anthropic/claude-haiku-4.5',providerRequestId:'gen-sanitized-review',primaryOnly:true}};
 freeze(saved);
 const assessment=normalizeStrategistResponseV2(prepared,saved.strategy,executions.strategist,now);
 return {saved,prepared,assessment,executions};
}

test('frozen contradictory TEST passes both JSON schemas but fails the unchanged uncertainty gate without mutation',()=>{
 const f=frozenReviewFixture(),before=hash(f.saved),{review}=f.saved;
 assertJsonSchemaValue(discoveryR12StaticSchema('review'),review,'Frozen static response');
 assertJsonSchemaValue(reviewerResponseSchemaV2(f.prepared,f.assessment),review,'Frozen dynamic response');
 const input=decode(buildReviewerRequestV2(f.prepared,f.assessment,f.executions.strategist,now));
 assert.deepEqual(input.assessment.rowEncoding.uncertainties,['question','blockingForTest','reason']);
 assert.equal(input.assessment.candidates[0].dimensions.find(row=>row[0]==='production_complexity')[5][0][1],true);
 assert.deepEqual([
  review.additionalUncertainties.some(u=>u.blockingForTest),
  review.checks.some(c=>c.outcome!=='PASS'),
  review.dimensions.some(d=>['blocking','known_failure'].includes(d.verdict)),
  f.assessment.candidates[0].dimensions.some(d=>d.uncertainties.some(u=>u.blockingForTest)),
 ],[true,true,true,true]);
 assert.throws(()=>normalizeReviewerResponseV2(f.prepared,f.assessment,review,f.executions,now),{message:'Reviewer cannot silently waive blocking uncertainty.'});
 const outcomeOnly={...review,outcome:'NEEDS_MORE_EVIDENCE'};
 assert.throws(()=>normalizeReviewerResponseV2(f.prepared,f.assessment,outcomeOnly,f.executions,now),{message:'Reviewer cannot silently waive blocking uncertainty.'});
 const verdictOnly=structuredClone(review);verdictOnly.dimensions.find(d=>d.dimension==='production_complexity').verdict='blocking';
 assert.throws(()=>normalizeReviewerResponseV2(f.prepared,f.assessment,verdictOnly,f.executions,now),{message:'TEST has an unresolved blocking review or uncertainty.'});
 assert.equal(hash(f.saved),before);
});

test('separate internally consistent NME retains every frozen blocker, failed check, question and execution prerequisite',()=>{
 const f=frozenReviewFixture(),before=hash(f.saved),hypothetical=structuredClone(f.saved.review);
 hypothetical.outcome='NEEDS_MORE_EVIDENCE';
 hypothetical.sufficiencyRationale='The retained proposal blockers and failed checks require more evidence; this synthetic alternative does not accept or modify the rejected saved response.';
 const production=hypothetical.dimensions.find(d=>d.dimension==='production_complexity');
 production.verdict='blocking';production.rationale='The retained production uncertainty blocks the exact proposal until the stated reproduction question is resolved.';
 const accepted=normalizeReviewerResponseV2(f.prepared,f.assessment,hypothetical,f.executions,now);
 assert.equal(accepted.outcome,'NEEDS_MORE_EVIDENCE');
 assert.deepEqual(accepted.checks,f.saved.review.checks);
 assert.deepEqual(accepted.additionalUncertainties,f.saved.review.additionalUncertainties);
 assert.deepEqual(accepted.missingQuestions,[...new Set([...f.assessment.missingQuestions,...hypothetical.additionalUncertainties.map(u=>u.question)])]);
 assert.deepEqual(accepted.executionPrerequisites,DISCOVERY_V2_EXECUTION_PREREQUISITES);
 assert.equal(accepted.publicationAllowed,false);assert.equal(accepted.commerceAllowed,false);
 assert.equal(f.assessment.testPlan.generationAuthorized,false);assert.equal(f.assessment.testPlan.spendingAuthorized,false);
 assert.equal(hash(f.saved),before);
});

test('known focused production failure still requires REJECT rather than NME',()=>{
 const f=frozenReviewFixture(),strategy=structuredClone(f.saved.strategy),review=structuredClone(f.saved.review);
 const production=strategy.candidates[0].dimensions.find(d=>d.dimension==='production_complexity');
 production.finding='unfavorable';production.hardFailure=true;
 strategy.recommendation.proposedOutcome='REJECT';strategy.usesPinnedLearningPlan=false;
 const assessment=normalizeStrategistResponseV2(f.prepared,strategy,f.executions.strategist,now);
 review.dimensions.find(d=>d.dimension==='production_complexity').verdict='known_failure';review.outcome='NEEDS_MORE_EVIDENCE';
 assert.throws(()=>normalizeReviewerResponseV2(f.prepared,assessment,review,f.executions,now),{message:'Known originality/IP/production failure requires REJECT.'});
 review.outcome='REJECT';
 assert.equal(normalizeReviewerResponseV2(f.prepared,assessment,review,f.executions,now).outcome,'REJECT');
 assert.equal(assessment.testPlan,null);
});

test('focused prompt clarity retains static SQL schema pins and existing request and wire ceilings',async()=>{
 const {first,last}=withClock(now,completed),migration=readFileSync('supabase/migrations/20261007005630_r12_focused_pilot.sql','utf8');
 for(const [phase,current] of [['strategy',first],['review',last]]){
  const prompt=current.request.messages[0].content;
  assert.match(prompt,/blockingForTest means an unresolved obstacle to recommending this exact pinned learning proposal/);
  assert.match(prompt,/their pending state alone does not make the proposal blocked/);
  assert.match(prompt,/An IP or production unknown can still block the proposal/);
  if(phase==='strategy')assert.match(prompt,/recommend NEEDS_MORE_EVIDENCE with usesPinnedLearningPlan false/);
  else for(const rule of [/requires verdict blocking or known_failure/,/guidance or none cannot become sufficient/,/all five checks PASS/,/no blocking flags/,/no blocking or known_failure verdicts/,/strategist TEST with the exact pinned learning plan/,/Preserve failed checks and all missing questions/])assert.match(prompt,rule);
  assert.deepEqual(current.request.outputSchema,phase==='strategy'?focusedPilotStrategySchema():discoveryR12StaticSchema('review'));
  const routed=routeDiscoveryR12Request(current.request,phase,{modelId:current.request.model.providerModelId,endpoint:phase==='strategy'?'azure/us':'amazon-bedrock/us',priceLimit:{prompt:1,completion:1,request:0}},true);
  const wire=await inspectDiscoveryR12Wire(routed,phase,false,true),body=JSON.parse(wire.wire.body);
  assert.ok(migration.includes(hash(current.request.outputSchema)));assert.ok(migration.includes(hash(body.response_format.json_schema.schema)));
  assert.ok(Buffer.byteLength(JSON.stringify(routed))<=DISCOVERY_R12_PILOT_REQUEST_BYTES);
  assert.ok(Buffer.byteLength(wire.wire.body)<=DISCOVERY_R12_PILOT_REQUEST_BYTES);
  assert.equal(current.request.maxOutputTokens,phase==='strategy'?5000:4000);
 }
});
