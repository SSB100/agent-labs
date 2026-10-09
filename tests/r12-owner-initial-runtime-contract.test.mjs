import test from 'node:test';
import assert from 'node:assert/strict';
import { discoveryKnowledgeFixture } from './discovery-v2-fixtures.mjs';
import { bindValidatedOwnerResearchIntent, assertValidatedOwnerResearchIntent } from '../.core-tests/products/discovery-r12-goal-intent.js';
import { DISCOVERY_V2, discoveryV2Hash, validateDiscoveryIntentV2, validateDiscoveryDossierV2, REVIEW_CHECKS_V2 } from '../.core-tests/products/discovery-v2.js';
import { normalizeDiscoveryPlanV2, buildDiscoveryPlannerRequestV2, discoveryPlanModelSchemaV2 } from '../.core-tests/products/discovery-v2-plan.js';
import { prepareDiscoveryWorkerContextV2, buildStrategistRequestV2, buildReviewerRequestV2, normalizeStrategistResponseV2, normalizeReviewerResponseV2 } from '../.core-tests/products/discovery-v2-worker-contract.js';
import { discoveryR12StaticSchema, discoveryR12OwnerInitialStaticSchema } from '../.core-tests/products/discovery-r12-schemas.js';
import { routeDiscoveryR12Request, inspectDiscoveryR12Wire, DISCOVERY_R12_PHASES } from '../.core-tests/products/discovery-r12-wire.js';
import { focusedPilotStrategySchema } from '../.core-tests/products/discovery-r12-focused-pilot-contract.js';
import { resolveModelRoute } from '../.core-tests/models/registry.js';
import { extractResearchSources, assembleEvidencePack } from '../.core-tests/research/sources.js';
import { DIMENSIONS } from '../.core-tests/products/types.js';

// Entirely synthetic contract tests. No network, spend, real demand, provider
// qualification or authority is established by any fixture below.
const id = value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const allMarkets = [{countryCode:'GB',currency:'GBP'},{countryCode:'US',currency:'USD'},{countryCode:'CA',currency:'CAD'},{countryCode:'AU',currency:'AUD'}];
function fixture(count=1) {
  const now=Date.now(),markets=structuredClone(allMarkets.slice(0,count));
  const query=`${count===1?'Evaluate':'Compare'} ${markets.map(m=>m.countryCode).join(', ')} for original music-themed print-on-demand T-shirts for adult amateur musicians. Use dated nonpersonal public apparel research and distinguish adjacent interest from direct demand; no marketplace listings or individual reviews.`;
  const intent={version:DISCOVERY_V2,id:id(1),businessId:id(2),objective:'Evaluate original instrument-inspired shirts for adult amateur musicians using bounded public evidence.',comparisonUniverse:{productType:'original_pod_tshirt',markets,audiences:['Adult amateur musicians'],sourceDomains:['public-apparel.example'],selectionQuestion:query},limits:{maximumAlternatives:3,maximumNewCollections:1,maximumMicrousd:500000,maximumGenerations:1},expiresAt:new Date(now+3600000).toISOString()};
  const pins={scopeId:intent.id,scopeHash:'a'.repeat(64),approvedQuery:query};
  const ownerInitial=bindValidatedOwnerResearchIntent(intent,pins,now);
  const knowledge=discoveryKnowledgeFixture(now);
  const output={comparisonRationale:'Evaluate the declared original apparel research scope without treating unproven music-design hypotheses as evidence.',queryFocus:['Dated adult apparel buying and design-interest criteria'],proposals:[{concept:'Original abstract instrument geometry',audience:intent.comparisonUniverse.audiences[0],hypothesis:'An original instrument motif may communicate adult music-making identity; this remains an unproven creative hypothesis.',differentiationHypothesis:'Use original abstract geometric composition and avoid logos or copied instrument artwork.'}]};
  return {now,intent,pins,ownerInitial,knowledge,output};
}
function workerFixture(count=1) {
  const f=fixture(count),request={query:f.pins.approvedQuery,allowedDomains:f.intent.comparisonUniverse.sourceDomains};
  const quote='Synthetic public apparel context: adult musicians may consider garment comfort. No candidate sales, representative demand, geography superiority or profitable margin is measured.';
  const collection=extractResearchSources(request,{annotations:[{type:'url_citation',url_citation:{url:'https://public-apparel.example/contract-only',title:'Synthetic public apparel contract fixture',content:quote}}],metadata:{}},new Date(f.now).toISOString());
  const pack=assembleEvidencePack(collection,{selectedEvidenceIds:collection.evidence.map(e=>e.id),limitations:['no_sales_metrics','no_current_prices']},f.now);
  const persisted={artifactId:id(3),businessId:f.intent.businessId,workflowRunId:id(4),queryId:id(5),collectedForIntentId:f.intent.id,question:request.query,sourceDomains:request.allowedDomains,evidencePack:pack,lineage:{status:'completed',executionMode:'web.research',provider:'openrouter.exa',sourceArtifactId:id(6),providerRequestId:'contract-search-receipt',workerRequestId:'contract-selector-receipt'}};
  const candidate={id:id(7),businessId:f.intent.businessId,concept:f.output.proposals[0].concept,audience:f.intent.comparisonUniverse.audiences[0],productType:'original_pod_tshirt',originalDesign:true,rightsStatus:'unclear'};
  const dossier={version:DISCOVERY_V2,intentId:f.intent.id,businessId:f.intent.businessId,packRefs:[{artifactId:persisted.artifactId,sha256:discoveryV2Hash(pack),origin:'new',query:{id:persisted.queryId,question:request.query,sourceDomains:request.allowedDomains}}],shortlist:[candidate],comparisonRationale:f.output.comparisonRationale};
  const context={knowledge:f.knowledge,packs:new Map([[persisted.artifactId,persisted]]),candidates:new Map([[candidate.id,candidate]]),committedMicrousd:0,ownerInitial:f.ownerInitial};
  const refs=pack.evidence.map(e=>{const source=pack.sources.find(s=>s.id===e.sourceId);return{artifactId:persisted.artifactId,evidenceId:e.id,sourceId:source.id,sourceContentHash:source.contentHash,start:0,end:Array.from(source.excerpt).length};});
  const prepared=prepareDiscoveryWorkerContextV2(f.intent,dossier,context,refs,f.now);
  const strategy={marketComparisons:f.intent.comparisonUniverse.markets.map(m=>({...m,assessment:'These synthetic contract inputs establish no demand, market advantage or commercial readiness.',evidence:[],assumptions:['The actual seller bank country remains unknown.'],limitations:['No candidate-specific demand or current fees have been established.'],sellerBankCountry:null,feeScenarios:[{sellerBankCountry:m.countryCode,hypothetical:true,explanation:'This local-seller scenario is hypothetical; no bank location or actual fee is asserted.',evidence:[]}]})),candidates:[{candidateKey:'C1',dimensions:DIMENSIONS.map(dimension=>({dimension,finding:'uncertain',evidenceStrength:'none',facts:[],rationale:'The synthetic contract source does not establish candidate-specific evidence for this dimension.',uncertainties:[{question:`What candidate-specific evidence resolves ${dimension}?`,blockingForTest:true,reason:'Additional relevant evidence is necessary before recommending this bounded original design test.'}],hardFailure:false}))}],recommendation:{proposedOutcome:'NEEDS_MORE_EVIDENCE',marketCountryCode:null,candidateKey:null,rationale:'These synthetic fixtures demonstrate contract behavior only and cannot support choosing a creative experiment.',alternatives:[{candidateKey:'C1',rationale:'This original music-design hypothesis remains unproven without candidate-specific supporting evidence.',evidence:[]}]},testPlan:null};
  const executions={strategist:{modelId:'openai/gpt-5.6-luna',providerRequestId:'contract-strategy-receipt',primaryOnly:true},reviewer:{modelId:'anthropic/claude-haiku-4.5',providerRequestId:'contract-review-receipt',primaryOnly:true}};
  return {...f,dossier,context,refs,prepared,strategy,executions};
}

test('validated owner-initial intent supports 1–4 markets and an unrelated adult POD topic without changing legacy minimum',()=>{
  for(const count of [1,2,3,4]) {
    const f=fixture(count);
    assert.doesNotThrow(()=>validateDiscoveryIntentV2(f.intent,f.now,undefined,f.ownerInitial));
    const plan=normalizeDiscoveryPlanV2(f.intent,f.output,'owner_initial',f.now,f.ownerInitial);
    assert.equal(plan.queries.length,1);assert.equal(plan.proposals.length,1);
    assert.equal(plan.queries[0].question,f.pins.approvedQuery);
    assert.deepEqual(plan.queries[0].sourceDomains,f.intent.comparisonUniverse.sourceDomains);
    assert.doesNotMatch(plan.queries[0].question,/nature|outdoor|Compare.*GB for/i);
    const request=buildDiscoveryPlannerRequestV2(f.intent,f.knowledge,undefined,'owner_initial',f.ownerInitial).request;
    assert.match(request.messages[0].content,count===1?/evaluate the supplied country/:/compare every supplied country/);
    assert.doesNotMatch(request.messages[0].content,/nature|outdoor|focused pilot/i);
    assert.ok(Buffer.byteLength(JSON.stringify(request))<=12288);
  }
  const f=fixture();
  assert.throws(()=>validateDiscoveryIntentV2(f.intent,f.now),/geographic comparison markets/);
  assert.throws(()=>normalizeDiscoveryPlanV2(f.intent,f.output,'qualified_public',f.now),/geographic comparison markets/);
});

test('owner-initial context is an owned frozen exact intent, query and scope binding',()=>{
  const f=fixture();
  assert.ok(Object.isFrozen(f.ownerInitial));assert.ok(Object.isFrozen(f.ownerInitial.intent.comparisonUniverse.markets[0]));
  assert.throws(()=>{f.ownerInitial.intent.comparisonUniverse.markets[0].countryCode='US';});
  f.intent.objective+=' A changed objective.';
  assert.notEqual(f.intent.objective,f.ownerInitial.intent.objective);
  assert.throws(()=>assertValidatedOwnerResearchIntent(f.intent,f.ownerInitial));
  for(const mutate of [x=>x.scopeId=id(9),x=>x.scopeHash='b'.repeat(64),x=>x.intentHash='c'.repeat(64),x=>x.mode='legacy',x=>x.approvedQuery+=' Change purpose.',x=>x.intent.comparisonUniverse.markets[0].currency='USD']) {
    const original=fixture(),bad=structuredClone(original.ownerInitial);mutate(bad);
    assert.throws(()=>validateDiscoveryIntentV2(original.intent,original.now,undefined,bad));
  }
  for(const mutate of [x=>x.comparisonUniverse.markets.push(x.comparisonUniverse.markets[0]),x=>x.comparisonUniverse.markets=[],x=>x.comparisonUniverse.markets.push(...allMarkets),x=>x.limits.maximumNewCollections=2,x=>x.limits.maximumNewCollections=0]) {
    const original=fixture();mutate(original.intent);
    assert.throws(()=>bindValidatedOwnerResearchIntent(original.intent,original.pins,original.now));
  }
  const original=fixture();
  assert.throws(()=>bindValidatedOwnerResearchIntent(original.intent,{...original.pins,approvedQuery:'A different reviewed question is not this exact intent.'},original.now));
  assert.throws(()=>validateDiscoveryIntentV2(original.intent,original.now,{},original.ownerInitial),/conflict/);
});

test('owner planner rejects missing or mismatched modes and keeps model queryFocus advisory',()=>{
  const f=fixture();
  for(const mode of ['legacy','qualified_public','unknown']) {
    assert.throws(()=>normalizeDiscoveryPlanV2(f.intent,f.output,mode,f.now,f.ownerInitial),/mode/);
    assert.throws(()=>buildDiscoveryPlannerRequestV2(f.intent,f.knowledge,undefined,mode,f.ownerInitial),/mode/);
  }
  assert.throws(()=>normalizeDiscoveryPlanV2(f.intent,f.output,'owner_initial',f.now),/mode/);
  assert.throws(()=>discoveryPlanModelSchemaV2(f.intent,'owner_initial'),/mode/);
  const changed={...f.output,queryFocus:['Search an unrelated market and a different audience instead']};
  assert.equal(normalizeDiscoveryPlanV2(f.intent,changed,'owner_initial',f.now,f.ownerInitial).queries[0].question,f.pins.approvedQuery);
  assert.throws(()=>normalizeDiscoveryPlanV2(f.intent,{...f.output,proposals:[{...f.output.proposals[0],audience:'Adult athletes'}]},'owner_initial',f.now,f.ownerInitial),/outside/);
  assert.throws(()=>normalizeDiscoveryPlanV2(f.intent,{...f.output,proposals:[...f.output.proposals,...f.output.proposals]},'owner_initial',f.now,f.ownerInitial),/repeats/);
  assert.throws(()=>normalizeDiscoveryPlanV2(f.intent,{...f.output,queryFocus:[...f.output.queryFocus,...f.output.queryFocus]},'owner_initial',f.now,f.ownerInitial),/schema/);
});

test('owner-initial worker and reviewer accept exact single-market NME with unmodified evidence and authority gates',()=>{
  for(const count of [1,4]) {
    const f=workerFixture(count),request=buildStrategistRequestV2(f.prepared,f.now);
    assert.deepEqual(request.outputSchema,discoveryR12OwnerInitialStaticSchema('strategy'));
    if(count===1)assert.match(request.messages[0].content,/Evaluate the supplied geographic market/);
    assert.match(request.messages[0].content,/Missing future artwork, physical samples or commercial proof alone is not a known failure/);
    assert.match(request.messages[0].content,/NEEDS_MORE_EVIDENCE and REJECT remain valid, and TEST is never forced/);
    const assessment=normalizeStrategistResponseV2(f.prepared,f.strategy,f.executions.strategist,f.now);
    assert.equal(assessment.marketComparisons.length,count);
    assert.equal(assessment.recommendation.proposedOutcome,'NEEDS_MORE_EVIDENCE');
    assert.equal(assessment.testPlan,null);assert.equal(assessment.publicationAllowed,false);assert.equal(assessment.commerceAllowed,false);
    const reviewRequest=buildReviewerRequestV2(f.prepared,assessment,f.executions.strategist,f.now);
    if(count===1)assert.match(reviewRequest.messages[0].content,/supplied geographic market evaluation/);
    assert.match(reviewRequest.messages[0].content,/additionalUncertainties is only for NEW reviewer-only questions \(maximum 18\)/);
    assert.match(reviewRequest.messages[0].content,/A TEST recommendation grants no creative, spending, publication or commerce authority/);
    assert.doesNotMatch(reviewRequest.messages[0].content,/usesPinnedLearningPlan/);
    const response={marketCountryCode:null,candidateKey:null,outcome:'NEEDS_MORE_EVIDENCE',sufficiencyRationale:'The synthetic contract context cannot select a creative experiment or establish real demand. All unresolved evidence gaps remain explicit.',dimensions:[],checks:REVIEW_CHECKS_V2.map(check=>({check,outcome:'PASS',rationale:'This contract response preserves the bounded scope and does not assert real demand or permission.'})),additionalUncertainties:[]};
    const review=normalizeReviewerResponseV2(f.prepared,assessment,response,f.executions,f.now);
    assert.equal(review.outcome,'NEEDS_MORE_EVIDENCE');assert.deepEqual(review.missingQuestions,assessment.missingQuestions);
    assert.equal(review.publicationAllowed,false);assert.equal(review.executionPrerequisites.freshBudgetApproval,'required');
  }
});

test('owner-initial local checks reject duplicate, missing, substituted or recurrencyed selected markets',()=>{
  for(const count of [1,4]) {
    const f=workerFixture(count);
    for(const mutate of [s=>s.marketComparisons.push(s.marketComparisons[0]),s=>s.marketComparisons.pop(),s=>s.marketComparisons[0].countryCode='NZ',s=>s.marketComparisons[0].currency='EUR',s=>{if(count>1)s.marketComparisons[1]=s.marketComparisons[0];else s.marketComparisons[0].countryCode='US';}]) {
      const changed=structuredClone(f.strategy);mutate(changed);
      assert.throws(()=>normalizeStrategistResponseV2(f.prepared,changed,f.executions.strategist,f.now));
    }
  }
});

test('owner-initial dossier cannot mix continuations, alter approved collection or substitute bound worker context',()=>{
  const f=workerFixture();
  for(const field of ['focusedPilot','evidenceAddendum','previousDecision'])assert.throws(()=>validateDiscoveryDossierV2(f.intent,f.dossier,{...f.context,[field]:{}},f.now),/continuation|focused/);
  const changed=structuredClone(f.dossier);changed.packRefs[0].query.question+=' Changed query.';
  assert.throws(()=>validateDiscoveryDossierV2(f.intent,changed,f.context,f.now),/reviewed query/);
  const reused=structuredClone(f.dossier);reused.packRefs[0].origin='prior';
  assert.throws(()=>validateDiscoveryDossierV2(f.intent,reused,f.context,f.now),/reviewed query/);
  const prepared=structuredClone(f.prepared);prepared.validation.ownerInitial.scopeHash='d'.repeat(64);
  assert.throws(()=>buildStrategistRequestV2(prepared,f.now),/unverified|binding/);
  const rebound=structuredClone(f.prepared);rebound.validation.ownerInitial=bindValidatedOwnerResearchIntent(f.intent,{...f.pins,scopeHash:'e'.repeat(64)},f.now);
  assert.throws(()=>buildStrategistRequestV2(rebound,f.now),/binding/);
});

function wireRequest(phase,ownerInitial=true) {
  const model=resolveModelRoute(phase==='review'?'reviewer.independent':'standard.default').primary;
  const request={model,messages:[{role:'user',content:'Synthetic private input context: PRIVATE_ADULT_TOPIC'}],schemaName:'PRIVATE_SCHEMA',outputSchema:{type:'object',properties:{secret:{const:'PRIVATE_COUNTRY'}}},maxOutputTokens:{plan:1500,select1:1000,strategy:5000,review:4000}[phase]};
  const route={modelId:model.providerModelId,endpoint:phase==='review'?'amazon-bedrock/us':'azure/us',priceLimit:{prompt:1,completion:1,request:0}};
  return {route,request:routeDiscoveryR12Request(request,phase,route,false,ownerInitial)};
}
test('owner-initial static provider grammar is private-value-free, isolated and leaves legacy/pilot hashes unchanged',async()=>{
  assert.deepEqual(DISCOVERY_R12_PHASES,['plan','search1','select1','strategy','review']);
  for(const phase of ['plan','select1','strategy','review']) {
    const {request}=wireRequest(phase),wire=await inspectDiscoveryR12Wire(request,phase,false,false,true);
    assert.deepEqual(request.outputSchema,discoveryR12OwnerInitialStaticSchema(phase));
    const grammar=JSON.parse(wire.wire.body).response_format;
    assert.doesNotMatch(JSON.stringify(grammar),/PRIVATE|musicians|00000000|public-apparel/);
  }
  const legacy=discoveryR12StaticSchema('strategy'),owner=discoveryR12OwnerInitialStaticSchema('strategy');
  assert.equal(legacy.properties.marketComparisons.minItems,2);assert.equal(owner.properties.marketComparisons.minItems,1);assert.equal(owner.properties.marketComparisons.maxItems,4);
  const expected=structuredClone(legacy);expected.properties.marketComparisons.minItems=1;assert.deepEqual(owner,expected);
  owner.properties.marketComparisons.minItems=99;assert.equal(discoveryR12OwnerInitialStaticSchema('strategy').properties.marketComparisons.minItems,1);
  assert.equal(discoveryV2Hash(focusedPilotStrategySchema()),'0eeaa5590d1945e34be684d637f069f7787bfd992c4d89182d0d44831aac8ba0');
  const f=fixture();assert.equal(JSON.stringify(discoveryPlanModelSchemaV2(f.intent,'owner_initial',f.ownerInitial)).includes('musicians'),false);
});

test('owner wire inspection rejects wrong variant, continuation/pilot conflicts and enlarged requests',async()=>{
  const {request,route}=wireRequest('strategy');
  assert.throws(()=>routeDiscoveryR12Request(request,'strategy',route,true,true));
  await assert.rejects(inspectDiscoveryR12Wire(request,'strategy'));
  await assert.rejects(inspectDiscoveryR12Wire(request,'strategy',true,false,true));
  await assert.rejects(inspectDiscoveryR12Wire(request,'strategy',false,true,true));
  const legacy=wireRequest('strategy',false).request;
  await assert.rejects(inspectDiscoveryR12Wire(legacy,'strategy',false,false,true));
  const changed=structuredClone(request);changed.outputSchema.properties.marketComparisons.minItems=2;
  await assert.rejects(inspectDiscoveryR12Wire(changed,'strategy',false,false,true));
  const oversized=structuredClone(request);oversized.messages[0].content='x'.repeat(32768);
  await assert.rejects(inspectDiscoveryR12Wire(oversized,'strategy',false,false,true));
});
