// Production-shaped, entirely offline capacity and phase-composition contracts.
// Real current-source builders, provider serializer, receipt/domain qualification,
// hash-linked dependency reconstruction and result projection; fake provider output only.
// No network requests, database grants, live Etsy reader or paid model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { source } from './helpers/r12-pod-owner-ui-fixture.mjs';
const modules = new Map(), load = file => source(file, {}, {}, modules);
const { publicResearchHash: hash } = load('research/qualification');
const { acceptPodResearchPlan } = load('products/discovery-r12-pod-goal');
const { POD_DIMENSIONS, POD_REVIEW_CHECKS, validatePodAssessment } = load('products/discovery-r12-pod-analysis');
const { POD_THOROUGH_LIMITS: limits, podEmbeddedJsonBytes } = load('products/discovery-r12-pod-profile');
const { readDiscoveryR12PhaseInputs, buildDiscoveryR12PhaseRequest, projectDiscoveryR12Phase } = load('products/discovery-r12-runtime');
const { reconstructPodResearchResult, buildPodResearchRequest, podThoroughReviewContext, podCompleteRequestBytes } = load('products/discovery-r12-pod-runtime');
const { routeDiscoveryR12Request, inspectDiscoveryR12Wire } = load('products/discovery-r12-wire');
const { createDiscoveryR12Candidate, qualifyDiscoveryR12Candidate, discoveryR12ReceiptExpectation } = load('products/discovery-r12-receipt');
const { qualifyGenerationRouteProof } = load('research/generation-route');
const { extractThoroughPodSources, assembleThoroughPodEvidence, podArchive, podCurrentEvidence, podPromptBytes } = load('products/discovery-r12-pod-evidence');
const { validateJsonSchemaValue } = load('workers/schema-validator');
const { podResearchSchema } = load('products/discovery-r12-pod-analysis');
const id = n => `12140000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = Date.parse('2026-10-12T01:00:00.000Z'), stamp = n => new Date(n).toISOString();
const clone = structuredClone, phases = ['plan', 'search1', 'select1', 'strategy', 'review'];
const prose = (length, phrase = 'This synthetic observation leaves independent buyer demand and delivered economics unmeasured. ') => phrase.repeat(Math.ceil(length / phrase.length)).slice(0, length - 1) + '.';
const bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
function fixture(objective='Research viable print-on-demand products to sell on Etsy.') {
  const sourcePolicy={version:'r12.pod-source-policy.1',reviewId:id(9),method:'openrouter_exa_factual_snippets',purpose:'public_pod_market_research',excludedDomains:['etsy.com','etsy.me','etsystatic.com'],restrictionsRevision:'1'.repeat(64),termsReviewHash:'2'.repeat(64),independentReviewHash:'3'.repeat(64),recipients:{router:'openrouter.ai',search:'exa.ai',researcher:'azure/us',reviewer:'amazon-bedrock/us'},retention:{inference:'no_training_zdr',search:'query_retention_improvement_training_possible',application:'bounded_attributed_audit_evidence'},validFrom:stamp(now-60000),validUntil:stamp(now+3600000)};
  const scope={version:'r12.pod-research-goal.3',id:id(1),businessId:id(2),businessRevision:1,businessHash:'4'.repeat(64),goalId:id(3),goalRevision:1,goalHash:'5'.repeat(64),setupId:id(4),setupHash:'6'.repeat(64),authorityRootId:id(2),publicBrief:{objective,publicConstraints:[],fulfilmentContext:'printful_available'},sourcePolicy,sourcePolicyHash:hash(sourcePolicy),approvalHash:'7'.repeat(64),maximumMicrousd:10000000,createdAt:stamp(now-1000),expiresAt:stamp(now+1500000)};
  const plan={format:'r12.pod-research.2',discoveryScopeId:scope.id,discoveryScopeHash:hash(scope),businessId:scope.businessId,goalId:scope.goalId,goalRevision:1,goalHash:scope.goalHash,businessRevision:1,businessHash:scope.businessHash,policyId:id(5),policyHash:'8'.repeat(64),authorityRootId:scope.businessId,plannerWorkerDefinitionId:id(6),currency:'USD',maximumMicrounits:'10000000',deadline:scope.expiresAt,expiresAt:scope.expiresAt,maximumRepairs:0,maximumPivots:0,maximumChildren:5,maximumDispatches:25,requiredChecks:['review'],finishCondition:'all_required_outputs_verified',stopConditions:['no_permitted_work','deadline','repair_exhausted','owner_stopped'],steps:phases.map((key,i)=>({key,kind:key==='review'?'review':key==='search1'?'research':'work',objective:'Research the approved general POD goal.',reason:'Finite public-source research phase.',adapter:`r12.discovery.${scope.id}.${key}`,qualificationHash:'9'.repeat(64),installationId:id(7),packSnapshotHash:'a'.repeat(64),workflowDefinitionId:id(20+i),workerDefinitionId:key==='review'?id(8):id(6),role:key,operationKey:`research.r12.${scope.id}.${key}`,purpose:'Public POD product research',dependsOn:phases.slice(0,i),expectedArtifactType:`r12.discovery.${key}`,maximumMicrounits:'100000',expiresAt:scope.expiresAt,notBefore:scope.createdAt,measurement:null,maximumRepairs:0}))};
  const proposal={comparisonRationale:'Explore multiple POD product types through impersonal aggregate needs, production limitations and reasons ideas may fail.',query:'Compare aggregate consumer needs for made-to-order printed products and production limitations without assuming a product category.',sourceDomains:['census.gov','printful.com'],sourceChoiceRationale:'Compare primary aggregated public observations with official POD feasibility information.',hypotheses:[{productType:'Exploratory printed product',niche:'Unproven general niche',audience:'An aggregate buyer group',hypothesis:'A useful printed object may address an unmet practical need; no demand has yet been measured.',contraryExplanation:'The observed interest may not translate into purchases or a viable margin.'}]};
  return{scope,plan,proposal,priorEvidence:[],pass:{ordinal:0,actionHash:'d'.repeat(64),history:null,historyHash:hash(null)}};
}
function ctx(f,key,dependencies) {const n=100+f.pass.ordinal*100+phases.indexOf(key)*10;return{planId:id(10),planHash:hash(f.plan),plan:f.plan,step:f.plan.steps.find(s=>s.key===key),attempt:{id:id(n),stepKey:key,status:'scheduled',attempt:f.pass.ordinal+1,adaptiveActionHash:f.pass.actionHash,adaptiveActionOrdinal:f.pass.ordinal,requestId:id(n+1),inputHash:'b'.repeat(64),dependencyPins:dependencies.map(d=>({stepKey:d.stepKey,attemptId:d.attemptId,resultHash:d.responseHash})),wireHash:null,responseHash:null},knowledge:{privateBusinessNotes:'PRIVATE_POD_CONTEXT_MUST_STAY_LOCAL',refinement:{secret:'OWNER_INJECTED_HISTORY_MUST_STAY_LOCAL'}}};}
function raw(f,context,dependencies,mode='dispatch'){return{version:'r12.pod-research-inputs.2',priorEvidence:clone(f.priorEvidence),pass:clone(f.pass),businessId:f.scope.businessId,planId:context.planId,attemptId:context.attempt.id,knowledgeSnapshotHash:context.step.packSnapshotHash,hasUncertainCosts:false,amendment:f.scope,validationAt:stamp(now),inputMode:mode,committedMicrousd:dependencies.length*10,dependencies};}
const content='Synthetic technical fixture: these public observations do not measure Etsy sales, buyer willingness to pay, profitable fulfilment or commercial demand. They support only questions for further validation.';
function outputs(f){return{plan:f.proposal,search1:{annotations:[{type:'url_citation',url_citation:{url:'https://census.gov/contract-fixture',title:'Inert public-source fixture',content}}]},select1:{selections:[{sourceKey:'S1',quote:content.slice(0,150)}],limitations:['no_sales_metrics','no_current_prices']},strategy:{explorationSummary:'This inert report demonstrates evidence assessment without asserting real market observations or product demand.',candidates:[{productType:'Evidence-led printed object',niche:'A different unproven niche',audience:'An independently chosen aggregate audience',rationale:'The evidence changes the initial hypothesis but cannot establish actual willingness to buy a product.',support:[],counterevidence:['E1'],alternativeExplanation:'Generic interest and supplier availability are compatible with no profitable Etsy demand.',dimensions:POD_DIMENSIONS.map(dimension=>({dimension,verdict:'uncertain',rationale:'This synthetic source provides no candidate-specific measurement for the dimension.',evidence:[],missing:['Representative relevant observations remain unavailable.']}))}],recommendation:{outcome:'INSUFFICIENT_EVIDENCE',candidateIndex:null,rationale:'The actual retained source does not support a market recommendation beyond further evidence gathering.',nextTest:'Measure buyer intent and delivered costs before committing to any creative, listing or production work.'},limitations:['The source is a technical fixture, not evidence of real demand.'],etsyDemandVerified:false,commercialViabilityVerified:false},review:{outcome:'INSUFFICIENT_EVIDENCE',candidateIndex:null,rationale:'The independent review finds that the bounded source cannot establish candidate-specific buyer demand or margins.',checks:POD_REVIEW_CHECKS.map(check=>({check,verdict:'FAIL',rationale:'The available synthetic evidence does not satisfy a real commercial research requirement.',evidence:['E1']})),missingEvidence:['Actual buyer intent and fulfilment economics remain unmeasured.'],nextTest:'Obtain representative buyer evidence and current delivered costs before recommending a product test.',etsyDemandVerified:false,commercialViabilityVerified:false}};}
async function preparePhase(f,key,dependencies,output){
  const context=ctx(f,key,dependencies),state=readDiscoveryR12PhaseInputs(context,raw(f,context,dependencies));
  const request=buildDiscoveryR12PhaseRequest(context,state),route={modelId:request.model.providerModelId,endpoint:key==='review'?'amazon-bedrock/us':'azure/us',priceLimit:{prompt:1,completion:1,request:0}};
  const routed=routeDiscoveryR12Request(request,key,route,false,false,true,true);const wire=await inspectDiscoveryR12Wire(routed,key,false,false,false,true,true);
  const binding={scopeId:f.scope.id,attemptId:context.attempt.id,requestId:context.attempt.requestId,phase:key,request:routed,maximumMicrousd:100000,dispatchedAt:stamp(now),receiptExpiresAt:stamp(now+1800000)};
  const candidate=createDiscoveryR12Candidate(binding,{providerModelId:key==='review'?'anthropic/claude-4.5-haiku-20251001':'openai/gpt-5.6-luna-20260709',providerRequestId:`gen-inert-pass-${f.pass.ordinal}-${key}`,usage:{reportedCostUsd:0.00001},metadata:{finishReason:'stop',...(key==='search1'?{searchRequests:1}:{})},output},stamp(now+1));
  const proof=qualifyGenerationRouteProof({data:{id:candidate.providerRequestId,provider_name:key==='review'?'Amazon Bedrock':'Azure',model:candidate.providerModelId}},discoveryR12ReceiptExpectation(candidate)),qualified=qualifyDiscoveryR12Candidate(candidate,binding,proof);
  const receipt=readDiscoveryR12PhaseInputs(context,raw(f,context,dependencies,'receipt'));
  return {context,state,receipt,request:routed,wire,binding,candidate,proof,qualified};
}
function acceptPhase(f,key,prepared) {
  const {context,receipt,request:routed,binding,candidate,proof,qualified}=prepared;
  const projected=projectDiscoveryR12Phase(context,receipt,qualified,routed);
  const response={...projected,result:{...projected.result,candidateHash:hash(candidate),routeProofHash:proof.proofHash,outputHash:hash(candidate.output)},planHash:context.planHash,inputHash:context.attempt.inputHash};
  return{...prepared,current:{executingRelease:{version:'r12.executing-release.1',repository:'SSB100/agent-labs',environment:'production',commitSha:'c'.repeat(40),deploymentId:'dpl_inert_contract'},stepKey:key,attemptId:context.attempt.id,artifactId:id(2000+f.pass.ordinal*100+phases.indexOf(key)),responseHash:hash({response,sql:true}),responseCanonicalHash:hash(response),response,binding,candidate,proof}};
}


async function phase(f, key, dependencies, output) {
  return acceptPhase(f, key, await preparePhase(f, key, dependencies, output));
}
function evidenceFrom(f, dependencies, selection) {
  const plan = acceptPodResearchPlan(f.scope, dependencies[0].candidate.output, now), dep = dependencies[1];
  const request = {query:plan.query, allowedDomains:plan.sourceDomains};
  const collection = extractThoroughPodSources(request, {annotations:dep.candidate.output.annotations, metadata:{
    providerRequestId:dep.candidate.providerRequestId, candidateHash:hash(dep.candidate), routeProofHash:dep.proof.proofHash,
    sourcePolicyHash:f.scope.sourcePolicyHash, researchPlanHash:plan.planHash, queryProvenance:plan.queryProvenance,
  }}, dep.candidate.receivedAt);
  assert.equal(hash(collection), dep.response.result.collectionHash);
  return {collection, pack:assembleThoroughPodEvidence(collection, request, selection, now)};
}
async function collect(f, output) {
  const dependencies = [];
  for (const key of ['plan','search1']) dependencies.push((await phase(f,key,dependencies,output[key])).current);
  return dependencies;
}
function complete(last) {
  return reconstructPodResearchResult({...last.context, attempt:{...last.context.attempt, status:'completed', responseHash:last.current.responseHash}}, last.receipt, last.current);
}
function nextFixture(previous, output, evidence) {
  const f = fixture();
  const history = {version:'r12.pod-refinement-history.2', previousPass:0,
    previousReviewHash:hash(output.review), reviewEvidenceNamespace:'pass-0',
    priorQueries:[{pass:0,query:previous.proposal.query,sourceDomains:previous.proposal.sourceDomains}],
    review:clone(output.review), priorCandidates:output.strategy.candidates.map(({productType,niche,audience}) => ({productType,niche,audience}))};
  f.pass = {ordinal:1,actionHash:hash({inertPass:1,historyHash:hash(history)}),history,historyHash:hash(history)};
  f.priorEvidence = [podArchive(evidence.collection,evidence.pack,0)];
  f.proposal.query = 'Investigate independent aggregate purchase-intent observations and measured production failure rates that could disprove the preceding hypotheses.';
  return f;
}
function largeOutput(f, {glyph='x', sourceCount=25, quoteCount=24, quoteLength=1600, candidates=8}={}) {
  const output=outputs(f);
  f.proposal.sourceDomains=Array.from({length:16},(_,i)=>`source${String(i+1).padStart(2,'0')}.org`);
  f.proposal.hypotheses=Array.from({length:16},(_,i)=>({...clone(f.proposal.hypotheses[0]),productType:`Synthetic printed object ${i+1}`,hypothesis:prose(1200),contraryExplanation:prose(800)}));
  f.proposal.comparisonRationale=prose(3000); f.proposal.sourceChoiceRationale=prose(2000);
  const exact=(i,n) => `Source ${i+1} exact observation ${n+1}: ` + glyph.repeat(Math.ceil(quoteLength/glyph.length)).slice(0,quoteLength-60) + ' independently unmeasured.';
  const annotations=Array.from({length:sourceCount},(_,i)=>({type:'url_citation',url_citation:{
    url:`https://${f.proposal.sourceDomains[i%16]}/synthetic-study-${i+1}`,title:`Synthetic source ${i+1}; technical evidence only`,
    content:[0,1,2].map(n=>exact(i,n)).join(' ') + prose(Math.max(30,7900-3*quoteLength)),
  }}));
  output.search1={annotations};
  output.select1={selections:Array.from({length:quoteCount},(_,i)=>({sourceKey:`S${i%sourceCount+1}`,quote:exact(i%sourceCount,Math.floor(i/sourceCount))})), limitations:['no_sales_metrics','no_current_prices']};
  output.strategy.explorationSummary=prose(4000);
  output.strategy.candidates=Array.from({length:candidates},(_,i)=>({...clone(output.strategy.candidates[0]),productType:`Evidence-led printed object ${i+1}`,rationale:prose(900),alternativeExplanation:prose(600),dimensions:output.strategy.candidates[0].dimensions.map(d=>({...clone(d),rationale:prose(500)}))}));
  output.strategy.recommendation.rationale=prose(2500); output.strategy.recommendation.nextTest=prose(2000);
  output.review.rationale=prose(6000); output.review.nextTest=prose(9000);
  output.review.checks.forEach(c=>{c.rationale=prose(5000);c.evidence=['E1'];});
  output.review.missingEvidence=Array.from({length:8},()=>prose(1600));
  return output;
}

test('long-prose five-phase production composition preserves every accepted record and independent review', async () => {
  const f=fixture(), output=largeOutput(f), original=clone(output), dependencies=[], requests=new Map();
  let last;
  for(const key of phases) {
    last=await phase(f,key,dependencies,output[key]);
    dependencies.push(last.current); requests.set(key,last);
    const body=JSON.parse(last.wire.wire.body);
    assert.equal(body.max_tokens,limits.phases[key].outputTokens);
    assert.ok(Math.max(bytes(last.request),last.wire.wireBytes)<=limits.phases[key].maximumRequestBytes);
    assert.equal(last.current.response.outcome,'accepted');
    assert.deepEqual(last.current.candidate.output,output[key]);
    if(key!=='search1') assert.deepEqual(body.messages,last.request.messages,'transport preserves complete messages');
  }
  const strategy=JSON.parse(requests.get('strategy').request.messages[1].content), review=JSON.parse(requests.get('review').request.messages[1].content);
  assert.equal(output.plan.hypotheses.length,16);
  assert.equal(strategy.evidence.items.length,24);
  assert.deepEqual(strategy.evidence,review.evidence,'strategist and reviewer see identical quote/source projection');
  assert.deepEqual(strategy.priorEvidence,review.priorEvidence);
  assert.deepEqual(review.assessment,output.strategy,'reviewer receives the full substantial assessment');
  assert.ok(podEmbeddedJsonBytes(output.strategy)<=strategy.maximumAssessmentEmbeddedBytes);
  assert.ok(strategy.maximumAssessmentEmbeddedBytes>=limits.preferredAssessmentEmbeddedBytes);
  assert.ok(strategy.maximumAssessmentEmbeddedBytes<=limits.maximumAssessmentEmbeddedBytes);
  assert.equal(requests.get('strategy').request.providerOnly[0],'azure/us');
  assert.equal(requests.get('review').request.providerOnly[0],'amazon-bedrock/us');
  const result=complete(last);
  assert.equal(result.review.outcome,'INSUFFICIENT_EVIDENCE'); assert.equal(result.phaseReceipts.length,5);
  assert.equal(result.executionAuthorized,false); assert.equal(result.review.etsyDemandVerified,false); assert.equal(result.review.commercialViabilityVerified,false);
  assert.deepEqual(result.assessment,output.strategy); assert.deepEqual(result.review,output.review);
  assert.deepEqual(output,original);
});

function assertWholeContext(context,collection,pack,archives) {
  assert.deepEqual(context.evidence.items.map(e=>e.quote),pack.evidence.map(e=>e.quote));
  for(const item of context.evidence.items) {
    const selected=pack.evidence.find(e=>e.id===item.evidenceId), stored=collection.sources[Number(item.sourceKey.slice(1))-1];
    assert.equal(selected.sourceId,stored.id); assert.equal(item.quote,selected.quote); assert.ok(stored.excerpt.includes(item.quote));
  }
  for(const retained of context.evidence.retainedSources) {
    const {sourceKey,...stored}=retained; assert.deepEqual(stored,collection.sources[Number(sourceKey.slice(1))-1]);
  }
  const sourceIds=context.evidence.retainedSources.map(s=>s.id), omitted=context.evidence.coverage.omittedSourceIds;
  assert.deepEqual([...sourceIds,...omitted].sort(),collection.sources.map(s=>s.id).sort());
  assert.equal(new Set([...sourceIds,...omitted]).size,collection.sources.length);
  assert.equal(context.evidence.coverage.available,collection.sources.length);
  assert.equal(context.evidence.coverage.retained,sourceIds.length);
  assert.equal(context.evidence.coverage.fullPageRead,false); assert.equal(context.evidence.coverage.localTruncation,false);
  const allPrior=archives.flatMap(a=>a.items.map((e,i)=>({...e,key:`P${a.pass+1}E${i+1}`,pass:a.pass,collectionHash:a.collectionHash,evidencePackHash:a.evidencePackHash})));
  for(const item of context.priorEvidence.items) assert.deepEqual(item,allPrior.find(e=>e.key===item.key));
  assert.deepEqual([...context.priorEvidence.items.map(e=>e.key),...context.priorEvidence.coverage.omittedEvidenceKeys].sort(),allPrior.map(e=>e.key).sort());
  assert.equal(context.priorEvidence.coverage.quotesTruncated,false);
}

test('ASCII, CJK, emoji and escaped prose compose complete exact reviewer requests with whole-source omissions', async () => {
  for(const glyph of ['x','界','🧵','"','\\','\n']) {
    const f=fixture(),output=largeOutput(f,{glyph:glyph==='\n'?'x':glyph,sourceCount:16,quoteCount:12,quoteLength:1200,candidates:1});
    const dependencies=await collect(f,output), evidence=evidenceFrom(f,dependencies,output.select1);
    dependencies.push((await phase(f,'select1',dependencies,output.select1)).current);
    const context=ctx(f,'strategy',dependencies), state=readDiscoveryR12PhaseInputs(context,raw(f,context,dependencies));
    const before=clone({evidence, state});
    const projection=podThoroughReviewContext(state,evidence.collection,evidence.pack);
    assertWholeContext(projection,evidence.collection,evidence.pack,[]);
    assert.ok(projection.maximumAssessmentEmbeddedBytes>=limits.preferredAssessmentEmbeddedBytes);
    output.strategy.explorationSummary=`Synthetic field containing ${JSON.stringify(glyph)}: `+glyph.repeat(2500)+' full analysis ends here.';
    const strategy=await phase(f,'strategy',dependencies,output.strategy); dependencies.push(strategy.current);
    const review=await phase(f,'review',dependencies,output.review);
    const strategyPayload=JSON.parse(strategy.request.messages[1].content), reviewBody=JSON.parse(review.wire.wire.body), reviewPayload=JSON.parse(reviewBody.messages[1].content);
    assert.deepEqual(strategyPayload.evidence,projection.evidence);
    assert.deepEqual(reviewPayload.evidence,projection.evidence);
    assert.deepEqual(reviewPayload.assessment,output.strategy,'Unicode and escaped characters are never clipped or rewritten');
    assert.ok(Math.max(bytes(review.request),review.wire.wireBytes)<=155648);
    assert.ok(podCompleteRequestBytes(review.request)>=Math.max(bytes(review.request),review.wire.wireBytes),'conservative request accounting covers the exact routed transport');
    assert.deepEqual({evidence,state},before);
  }
});

test('four complete prior archives share reviewer residual with current quotes and explicit immutable omissions', async () => {
  const first=fixture(),firstOutput=largeOutput(first,{sourceCount:16,quoteCount:32,quoteLength:1200,candidates:1});
  const firstDependencies=await collect(first,firstOutput), prior=evidenceFrom(first,firstDependencies,firstOutput.select1);
  const f=nextFixture(first,firstOutput,prior), output=largeOutput(f,{sourceCount:16,quoteCount:12,quoteLength:1200,candidates:1});
  f.pass.ordinal=4;
  f.pass.history.previousPass=3; f.pass.history.reviewEvidenceNamespace='pass-3';
  f.pass.history.priorQueries=Array.from({length:4},(_,pass)=>({pass,query:pass===0?first.proposal.query:`Earlier independent synthetic inquiry ${pass} into observed production failures and unmet buyer needs.`,sourceDomains:first.proposal.sourceDomains}));
  f.pass.historyHash=hash(f.pass.history); f.pass.actionHash=hash({pass:4,history:f.pass.historyHash});
  f.priorEvidence=Array.from({length:4},(_,pass)=>podArchive(prior.collection,prior.pack,pass));
  const dependencies=await collect(f,output), evidence=evidenceFrom(f,dependencies,output.select1);
  const plannerPayload=JSON.parse(dependencies[0].binding.request.messages[1].content);
  assert.equal(plannerPayload.priorEvidence.coverage.available,128);
  assert.equal(plannerPayload.priorEvidence.coverage.retained,128);
  assert.deepEqual(plannerPayload.priorEvidence.coverage.omittedEvidenceKeys,[]);
  dependencies.push((await phase(f,'select1',dependencies,output.select1)).current);
  const strategyContext=ctx(f,'strategy',dependencies),state=readDiscoveryR12PhaseInputs(strategyContext,raw(f,strategyContext,dependencies));
  const before=clone({evidence,archives:f.priorEvidence}), projection=podThoroughReviewContext(state,evidence.collection,evidence.pack);
  assertWholeContext(projection,evidence.collection,evidence.pack,f.priorEvidence);
  assert.equal(projection.priorEvidence.coverage.available,128);
  assert.ok(projection.priorEvidence.items.length>0); assert.ok(projection.priorEvidence.coverage.omittedEvidenceKeys.length>0);
  assert.ok(projection.evidence.coverage.omittedSourceIds.length>0);
  assert.deepEqual([...new Set(projection.priorEvidence.items.map(e=>e.pass))].sort(),[0,1,2,3]);
  const allowed=projection.priorEvidence.items[0].key, omitted=projection.priorEvidence.coverage.omittedEvidenceKeys[0];
  output.strategy.candidates[0].counterevidence=[allowed]; output.review.checks[0].evidence=[allowed];
  const rejected=clone(output.strategy); rejected.candidates[0].counterevidence=[omitted];
  await assert.rejects(phase(f,'strategy',dependencies,rejected),/r12_pod_assessment_unverified/,'prior syntax does not make omitted quotes available');
  const strategist=await phase(f,'strategy',dependencies,output.strategy); dependencies.push(strategist.current);
  const reviewed=await phase(f,'review',dependencies,output.review);
  const strategyPayload=JSON.parse(strategist.request.messages[1].content), reviewPayload=JSON.parse(reviewed.request.messages[1].content);
  assert.deepEqual(strategyPayload.priorEvidence,projection.priorEvidence);
  assert.deepEqual(reviewPayload.priorEvidence,projection.priorEvidence);
  assert.deepEqual(reviewPayload.evidence,projection.evidence);
  assert.deepEqual({evidence,archives:f.priorEvidence},before);
});

function assessmentAtEmbeddedBytes(initial,target,glyph='x') {
  const assessment=clone(initial), slots=[
    [assessment,'explorationSummary',16000], [assessment.recommendation,'rationale',16000], [assessment.recommendation,'nextTest',12000],
    ...assessment.candidates.flatMap(c=>[[c,'rationale',8000],[c,'alternativeExplanation',8000],...c.dimensions.map(d=>[d,'rationale',8000])]),
    ...assessment.limitations.map((_,i)=>[assessment.limitations,i,4000]),
  ];
  const unit=podEmbeddedJsonBytes(glyph)-podEmbeddedJsonBytes('');
  for(const [object,key,maximum] of slots) {
    const repeats=Math.min(Math.floor((maximum-object[key].length)/glyph.length),Math.floor((target-podEmbeddedJsonBytes(assessment))/unit));
    if(repeats>0)object[key]+=glyph.repeat(repeats);
  }
  for(const [object,key,maximum] of slots) {
    const count=Math.min(maximum-object[key].length,target-podEmbeddedJsonBytes(assessment));
    if(count>0)object[key]+='x'.repeat(count);
  }
  assert.equal(podEmbeddedJsonBytes(assessment),target,'fixture must reach the exact embedded byte boundary');
  assert.equal(validateJsonSchemaValue(podResearchSchema('strategy',true),assessment).length,0);
  return assessment;
}

test('upstream assessment acceptance preflights the next reviewer with exact residual bytes, before an accepted receipt exists', async () => {
  const f=fixture(), output=largeOutput(f,{sourceCount:16,quoteCount:24,quoteLength:1200,candidates:1}), dependencies=await collect(f,output);
  const evidence=evidenceFrom(f,dependencies,output.select1);
  dependencies.push((await phase(f,'select1',dependencies,output.select1)).current);
  const context=ctx(f,'strategy',dependencies),state=readDiscoveryR12PhaseInputs(context,raw(f,context,dependencies));
  const allowance=podThoroughReviewContext(state,evidence.collection,evidence.pack).maximumAssessmentEmbeddedBytes;
  assert.ok(allowance>=16384 && allowance<98304,'the actual evidence envelope, not a standalone constant, constrains this assessment');
  for(const glyph of ['x','界','🧵','"','\\','\n']) {
    const over=assessmentAtEmbeddedBytes(output.strategy,allowance+1,glyph);
    assert.ok(bytes(over)<limits.phases.strategy.maximumArtifactBytes);
    assert.deepEqual(validatePodAssessment(over,evidence.pack,true),over,'valid fields and standalone aggregate do not imply consumer fit');
    const staged=await preparePhase(f,'strategy',dependencies,over), before=clone(staged.candidate);
    assert.equal(staged.candidate.reportedMicrousd,10,'fake provider receipt is cost-qualified before domain projection');
    assert.throws(()=>acceptPhase(f,'strategy',staged),/r12_pod_next_consumer_capacity_exceeded/);
    assert.deepEqual(staged.candidate,before,'reject oversized composition without altering the original provider record');
    const atLimit=assessmentAtEmbeddedBytes(output.strategy,allowance,glyph);
    const accepted=await phase(f,'strategy',dependencies,atLimit);
    const reviewed=await phase(f,'review',[...dependencies,accepted.current],output.review);
    assert.deepEqual(JSON.parse(reviewed.request.messages[1].content).assessment,atLimit);
    assert.ok(Math.max(bytes(reviewed.request),reviewed.wire.wireBytes)<=155648);
  }
});

test('a valid 48-span selector output cannot become accepted when its complete quotes leave no minimum independent-review room', async () => {
  const f=fixture(), output=largeOutput(f,{glyph:'界',sourceCount:16,quoteCount:48,quoteLength:875,candidates:1});
  f.scope.publicBrief.objective='Synthetic aggregate POD research '+ '界'.repeat(1100);
  f.scope.publicBrief.publicConstraints=Array.from({length:8},(_,i)=>`Constraint ${i}: `+'界'.repeat(220));
  f.plan.discoveryScopeHash=hash(f.scope);
  const dependencies=await collect(f,output), evidence=evidenceFrom(f,dependencies,output.select1);
  assert.equal(evidence.pack.evidence.length,48);
  assert.ok(podPromptBytes(podCurrentEvidence(evidence.collection,evidence.pack,0))<=limits.maximumCurrentEvidenceBytes);
  const staged=await preparePhase(f,'select1',dependencies,output.select1), before=clone(staged.candidate);
  assert.throws(()=>acceptPhase(f,'select1',staged),/r12_pod_next_consumer_capacity_exceeded/);
  assert.deepEqual(staged.candidate,before);
});

test('zero-selection result still requires independent failing checks and resumes with a different counted query', async () => {
  const f=fixture(),output=outputs(f); output.search1.annotations=[];
  output.select1={selections:[],limitations:['limited_sources','no_sales_metrics']};
  output.strategy.candidates=[]; output.review.checks.forEach(c=>c.evidence=[]);
  const dependencies=await collect(f,output), evidence=evidenceFrom(f,dependencies,output.select1);
  assert.equal(evidence.collection.sources.length,0); assert.equal(evidence.pack.evidence.length,0);
  dependencies.push((await phase(f,'select1',dependencies,output.select1)).current);
  dependencies.push((await phase(f,'strategy',dependencies,output.strategy)).current);
  const falsePositive=clone(output.review); falsePositive.checks.forEach(c=>c.verdict='PASS');
  await assert.rejects(phase(f,'review',dependencies,falsePositive),/r12_pod_assessment_unverified/);
  for(const check of ['source_quality_and_independence','claim_support']) {
    const vacuous=clone(output.review); vacuous.checks.find(c=>c.check===check).verdict='PASS';
    await assert.rejects(phase(f,'review',dependencies,vacuous),/r12_pod_assessment_unverified/);
  }
  const reviewed=await phase(f,'review',dependencies,output.review), result=complete(reviewed);
  assert.equal(result.review.outcome,'INSUFFICIENT_EVIDENCE'); assert.equal(result.phaseReceipts.length,5);
  assert.equal(result.evidence.length,0); assert.equal(result.executionAuthorized,false);
  assert.equal(reviewed.request.providerOnly[0],'amazon-bedrock/us');
  const next=nextFixture(f,output,evidence), nextContext=ctx(next,'plan',[]);
  const nextState=readDiscoveryR12PhaseInputs(nextContext,raw(next,nextContext,[]));
  const nextRequest=buildPodResearchRequest(nextContext,nextState), nextPayload=JSON.parse(nextRequest.messages[1].content);
  assert.deepEqual(nextPayload.refinement.review,output.review); assert.equal(nextRequest.requestMetadata.r12PodPassOrdinal,1);
  assert.equal(nextPayload.priorEvidence.coverage.available,0);
  await assert.rejects(phase(next,'plan',[],{...next.proposal,query:f.proposal.query}),/r12_pod_unchanged_query/);
  const nextPlan=await phase(next,'plan',[],next.proposal);
  const nextSearch=await preparePhase(next,'search1',[nextPlan.current],{annotations:[]});
  assert.equal(nextSearch.request.query,next.proposal.query); assert.notEqual(nextSearch.request.query,f.proposal.query);
  assert.equal(nextSearch.wire.maximumOutputTokens,16000);
});

test('100 real Etsy listing projections fit the full selector serializer without duplicate source wrappers or omitted listings', async () => {
  const {projectEtsyMarketplaceResponse}=load('etsy/marketplace-research');
  for(const glyph of ['x','界','🧵','"','\\']) {
    const f=fixture(), output=outputs(f), dependencies=await collect(f,output);
    const selector=await preparePhase(f,'select1',dependencies,output.select1);
    const rawListings=Array.from({length:100},(_,i)=>({state:'active',listing_id:Number.MAX_SAFE_INTEGER-i,is_private:false,
      title:glyph.repeat(512),tags:Array.from({length:13},()=>glyph.repeat(80)),taxonomy_id:Number.MAX_SAFE_INTEGER,
      price:{amount:Number.MAX_SAFE_INTEGER,divisor:Number.MAX_SAFE_INTEGER,currency_code:'USD'},
      description:'PRIVATE_DESCRIPTION_SENTINEL',user_id:98765,shop_id:12345,url:'https://excluded-account.example.invalid/private',views:999999,
    }));
    const projection=projectEtsyMarketplaceResponse({count:100,results:rawListings},100), before=clone(projection);
    assert.equal(projection.listings.length,100); assert.equal(projection.returnedListingCount,100);
    const request=clone(selector.request), payload=JSON.parse(request.messages[1].content);
    delete payload.sources; delete payload.coverage;
    payload.marketplaceSample=projection;
    payload.marketplaceCaveat='An inert future integration sample; active supply alone establishes neither sales nor demand. Live marketplace access is not enabled.';
    request.messages[1].content=JSON.stringify(payload);
    const wire=await inspectDiscoveryR12Wire(request,'select1',false,false,false,true,true), body=JSON.parse(wire.wire.body);
    const decoded=JSON.parse(body.messages[1].content).marketplaceSample;
    assert.deepEqual(decoded,projection,'all 100 exact minimal listing records survive double JSON serialization');
    assert.equal(decoded.establishesSalesOrDemand,false);
    assert.ok(Math.max(bytes(request),wire.wireBytes)<=limits.phases.select1.maximumRequestBytes);
    assert.ok(podPromptBytes(projection)<=limits.maximumSelectorEvidenceBytes);
    assert.equal(body.tools,undefined); assert.equal(body.max_tokens,16000);
    assert.equal(wire.wire.body.includes('PRIVATE_DESCRIPTION_SENTINEL'),false);
    for(let i=0;i<100;i++) {
      assert.equal([...decoded.listings[i].title].length,512); assert.equal(decoded.listings[i].tags.length,13);
      assert.equal(decoded.listings[i].tags.every(tag=>[...tag].length===80),true);
      assert.deepEqual(Object.keys(decoded.listings[i]).sort(),['advertisedPrice','listingId','tags','taxonomyId','title']);
      assert.equal(decoded.listings[i].listingId,rawListings[i].listing_id);
      assert.equal(decoded.listings[i].advertisedPrice.amount,Number.MAX_SAFE_INTEGER);
      assert.equal(decoded.listings[i].advertisedPrice.divisor,Number.MAX_SAFE_INTEGER);
    }
    assert.deepEqual(projection,before);
  }
});

test('an escaped planner artifact cannot be accepted through selection if the whole strategist request cannot compose', async () => {
  const f=fixture(), output=outputs(f);
  f.proposal.hypotheses=Array.from({length:16},(_,i)=>({...clone(f.proposal.hypotheses[0]),productType:`Distinct synthetic object ${i+1}`,hypothesis:'"'.repeat(3600),contraryExplanation:'"'.repeat(3600)}));
  assert.equal(validateJsonSchemaValue(podResearchSchema('plan',true),output.plan).length,0);
  assert.ok(bytes(output.plan)<limits.phases.plan.maximumArtifactBytes);
  const dependencies=[];
  for(const key of ['plan','search1','select1']) {
    const staged=await preparePhase(f,key,dependencies,output[key]);
    try { dependencies.push(acceptPhase(f,key,staged).current); }
    catch(error) {
      assert.match(String(error),/r12_pod_next_consumer_capacity_exceeded/);
      assert.deepEqual(staged.candidate.output,output[key]);
      return;
    }
  }
  const context=ctx(f,'strategy',dependencies),state=readDiscoveryR12PhaseInputs(context,raw(f,context,dependencies));
  const request=buildDiscoveryR12PhaseRequest(context,state);
  assert.fail(`Accepted upstream output stranded the strategist: complete request is ${podCompleteRequestBytes(request)} bytes against ${limits.phases.strategy.maximumRequestBytes}.`);
});

test('48 long current quotes reduce the assessment allowance while keeping the complete analysis reviewable', async () => {
  const f=fixture(),output=largeOutput(f,{sourceCount:16,quoteCount:48,quoteLength:2400,candidates:1});
  const dependencies=await collect(f,output), evidence=evidenceFrom(f,dependencies,output.select1);
  dependencies.push((await phase(f,'select1',dependencies,output.select1)).current);
  const context=ctx(f,'strategy',dependencies),state=readDiscoveryR12PhaseInputs(context,raw(f,context,dependencies));
  const projection=podThoroughReviewContext(state,evidence.collection,evidence.pack);
  assert.equal(projection.evidence.items.length,48);
  assert.deepEqual(projection.evidence.items.map(e=>e.quote),output.select1.selections.map(e=>e.quote));
  assert.ok(projection.maximumAssessmentEmbeddedBytes>=16384);
  assert.ok(projection.maximumAssessmentEmbeddedBytes<49152,'current quotes take priority over optional sources and preferred analysis room');
  assert.equal(projection.evidence.retainedSources.length,0);
  const assessment=assessmentAtEmbeddedBytes(outputs(f).strategy,projection.maximumAssessmentEmbeddedBytes);
  const accepted=await phase(f,'strategy',dependencies,assessment);
  const reviewed=await phase(f,'review',[...dependencies,accepted.current],output.review);
  assert.deepEqual(JSON.parse(reviewed.request.messages[1].content).assessment,assessment);
  assert.ok(Math.max(bytes(reviewed.request),reviewed.wire.wireBytes)<=155648);
});

test('sparse evidence leaves room for sixteen complete researched candidates and a long independent critique', async () => {
  const f=fixture(),output=largeOutput(f,{sourceCount:4,quoteCount:4,quoteLength:1200,candidates:16}), dependencies=[];
  let last;
  for(const key of phases) {last=await phase(f,key,dependencies,output[key]); dependencies.push(last.current);}
  const strategist=JSON.parse(dependencies[3].binding.request.messages[1].content), reviewer=JSON.parse(last.request.messages[1].content);
  assert.equal(strategist.maximumAssessmentEmbeddedBytes,98304);
  assert.equal(reviewer.assessment.candidates.length,16); assert.deepEqual(reviewer.assessment,output.strategy);
  assert.equal(last.current.candidate.output.nextTest.length,9000);
  assert.equal(last.current.candidate.output.checks.every(c=>c.rationale.length===5000),true);
  assert.deepEqual(complete(last).review,output.review);
});

test('irrelevant returned sources allow zero exact selections without fabricated citations or a vacuous review', async () => {
  const f=fixture(),output=outputs(f), dependencies=[];
  output.select1={selections:[],limitations:['limited_sources']};
  output.strategy.candidates=[]; output.review.checks.forEach(c=>c.evidence=[]);
  let last;
  for(const key of phases) {last=await phase(f,key,dependencies,output[key]); dependencies.push(last.current);}
  const reviewPayload=JSON.parse(last.request.messages[1].content);
  assert.equal(reviewPayload.evidence.retainedSources.length,1);
  assert.equal(reviewPayload.evidence.items.length,0);
  assert.equal(reviewPayload.evidence.retainedSources[0].excerpt,content);
  const result=complete(last);
  assert.equal(result.review.outcome,'INSUFFICIENT_EVIDENCE'); assert.equal(result.evidence.length,0);
  assert.equal(result.review.checks.filter(c=>c.verdict==='FAIL').length,6);
});

test('selection acceptance checks the full strategist envelope even when the plan alone and reviewer envelope both fit', async () => {
  const f=fixture(),output=largeOutput(f,{sourceCount:16,quoteCount:24,quoteLength:1200,candidates:1});
  f.proposal.hypotheses.forEach(h=>{h.hypothesis='"'.repeat(2000);h.contraryExplanation='"'.repeat(2000);});
  const dependencies=await collect(f,output);
  assert.equal(dependencies[0].response.outcome,'accepted'); assert.equal(dependencies[1].response.outcome,'accepted');
  const evidence=evidenceFrom(f,dependencies,output.select1), staged=await preparePhase(f,'select1',dependencies,output.select1);
  const context=podThoroughReviewContext(staged.receipt,evidence.collection,evidence.pack);
  assert.ok(context.maximumAssessmentEmbeddedBytes>=49152,'independent reviewer capacity is separately sufficient');
  assert.throws(()=>acceptPhase(f,'select1',staged),/r12_pod_next_consumer_capacity_exceeded/);
  assert.deepEqual(staged.candidate.output,output.select1);
});
