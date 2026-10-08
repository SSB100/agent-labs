import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {maximumR12ResponseFixture,acceptedR12ResponseBoundaryFixture,fillR12ReviewByteBoundary,r12ShapeMetrics} from './helpers/r12-response-boundary-fixture.mjs';
import {focusedProfileFixture,focusedStrategyOutput,focusedReviewerOutput} from './helpers/r12-focused-profile-fixture.mjs';
import {discoveryKnowledgeFixture} from './discovery-v2-fixtures.mjs';
import {validateFocusedPilotProfile} from '../.core-tests/products/discovery-r12-focused-pilot-contract.js';
import {discoveryV2Hash as hash} from '../.core-tests/products/discovery-v2.js';
import {discoveryAddendumReferences} from '../.core-tests/products/discovery-r12-evidence-addendum.js';
import worker from '../.core-tests/products/discovery-v2-worker-contract.js';
import {createDiscoveryR12Candidate} from '../.core-tests/products/discovery-r12-receipt.js';
import {OpenRouterAdapter} from '../.core-tests/models/openrouter.js';

const now=Date.parse('2026-10-07T00:00:00.000Z');
function prepared(){
 const p=focusedProfileFixture();Object.assign(p.history.record,{marketCountryCode:null,candidateId:null,sufficiencyRationale:'The broad commercial case lacks direct demand and production evidence.',dimensions:[],checks:[{check:'source_support',outcome:'FAIL',rationale:'The broad sources do not establish buyer demand for this candidate.'}],additionalUncertainties:[],executionPrerequisites:{ownerCreativeApproval:'required'},publicationAllowed:false,commerceAllowed:false,priorCandidateUncertainties:[{candidateId:p.candidate.id,concept:p.candidate.concept,dimensions:[{dimension:'demand',uncertainties:[{question:p.history.record.missingQuestions[0],blockingForTest:true,reason:'Direct commercial demand was never established by the broad research.'}]}]}]});p.history.recordHash=hash(p.history.record);const pins={...p,profileHash:hash(p),acceptedReviewScopeId:p.history.acceptedReviewScopeId,acceptedReviewHash:p.history.acceptedReviewHash,historicalRecordHash:p.history.recordHash,originalMaximumMicrousd:2000000};
 const validated=validateFocusedPilotProfile(p,pins,now),dossier={version:'pod-discovery-2.0',intentId:p.id,businessId:p.businessId,shortlist:[p.candidate],packRefs:[],comparisonRationale:p.history.scopeChangeExplanation,addendumRef:{artifactId:p.observations.id,sha256:hash(p.observations)}};
 const context={knowledge:discoveryKnowledgeFixture(now),packs:new Map(),candidates:new Map([[p.candidate.id,p.candidate]]),ownerRightsConfirmedCandidateIds:[p.candidate.id],sellerBankCountry:null,committedMicrousd:168570,evidenceAddendum:p.observations,focusedPilot:validated};
 return worker.prepareDiscoveryWorkerContextV2(p.intent,dossier,context,discoveryAddendumReferences(p.observations),now);
}
test('declared maximum synthetic prose/counts pass actual focused semantic projection',()=>{
 const p=prepared(),request=worker.buildStrategistRequestV2(p,now),original=focusedStrategyOutput(p),output=maximumR12ResponseFixture({phase:'strategy',output:original,request});
 const execution={modelId:'openai/gpt-5.6-luna',providerRequestId:'gen-synthetic-strategy',primaryOnly:true};
 const assessment=worker.normalizeStrategistResponseV2(p,output,execution,now);
 const boundaryReport=[];assert.doesNotThrow(()=>acceptedR12ResponseBoundaryFixture({phase:'strategy',output:original,request,providerRequestId:'gen-synthetic-boundary',state:{focusedPilot:p.validation.focusedPilot,knowledge:p.validation.knowledge,committedBeforeAttemptMicrousd:p.validation.committedMicrousd,validationAt:now}},boundaryReport));assert.equal(boundaryReport.length,1);
 assert.equal(output.marketComparisons[0].assumptions.length,4);assert.equal(output.marketComparisons[0].feeScenarios.length,4);
 for(const d of output.candidates[0].dimensions){assert.equal(d.rationale.length,240);assert.equal(d.uncertainties.length,2);assert.equal(d.uncertainties[0].question.length,180);}
 const reviewRequest=worker.buildReviewerRequestV2(p,assessment,execution,now),review=maximumR12ResponseFixture({phase:'review',output:focusedReviewerOutput(p),request:reviewRequest});
 assert.equal(review.additionalUncertainties.length,18);assert.equal(review.sufficiencyRationale.length,700);
 const executions={strategist:execution,reviewer:{modelId:'anthropic/claude-haiku-4.5',providerRequestId:'gen-synthetic-review',primaryOnly:true}};
 assert.throws(()=>worker.normalizeReviewerResponseV2(p,assessment,review,executions,now),/bounded serialized snapshot/);
 let decision;for(let count=17;count>=0;count--){review.additionalUncertainties=review.additionalUncertainties.slice(0,count);try{decision=worker.normalizeReviewerResponseV2(p,assessment,review,executions,now);break;}catch(error){assert.match(error.message,/bounded serialized snapshot/);}}assert.ok(decision,'A semantically accepted bounded prefix is required');
 const exact=fillR12ReviewByteBoundary(review,value=>worker.normalizeReviewerResponseV2(p,assessment,value,executions,now));assert.equal(worker.normalizeReviewerResponseV2(p,assessment,exact,executions,now).outcome,'TEST');
 assert.equal(decision.outcome,'TEST');assert.deepEqual(original,focusedStrategyOutput(p));
 console.log('Synthetic schema-boundary metrics:',JSON.stringify({strategy:r12ShapeMetrics(output),review:r12ShapeMetrics(review),reviewRequest:r12ShapeMetrics(reviewRequest)}));
});
test('delayed denied final admission cannot call provider even after the model timeout duration',async()=>{
 const request=worker.buildStrategistRequestV2(prepared(),now);let calls=0,settled=false;
 const adapter=new OpenRouterAdapter({config:{apiKey:'inert-test-only',baseUrl:'https://openrouter.ai/api/v1',appUrl:'https://example.com',appName:'inert'},timeoutMs:5,admitDispatch:async()=>{await delay(20);throw Error('Synthetic final SQL deadline or stale lease');},fetcher:async()=>{calls++;assert.fail('Denied admission cannot reach transport');}});
 const pending=adapter.invokeStructured(request).finally(()=>{settled=true;});await delay(10);assert.equal(settled,false,'Provider timer does not bound the admission RPC');await assert.rejects(pending,/no provider request was sent/);assert.equal(calls,0);
});
test('candidate aggregate byte ceiling stays authoritative even when a schema allows longer Unicode',()=>{
 const p=prepared(),request=worker.buildStrategistRequestV2(p,now),scope=p.validation.focusedPilot.profile;
 // Exercise the byte fence directly without pretending this deliberately wider
 // schema is the actual focused schema. Actual-schema maxima are tested above.
 request.outputSchema={type:'object',additionalProperties:false,required:['text'],properties:{text:{type:'string',maxLength:65536}}};
 const binding={scopeId:scope.id,attemptId:scope.goalId,requestId:scope.originalGoalId,phase:'strategy',request,maximumMicrousd:66671,dispatchedAt:new Date(now-1000).toISOString(),receiptExpiresAt:new Date(now+60000).toISOString()};
 const response={providerModelId:'openai/gpt-5.6-luna-20260709',providerRequestId:'gen-synthetic-boundary',usage:{reportedCostUsd:.00001},metadata:{finishReason:'stop'},output:{text:''}};
 const base=createDiscoveryR12Candidate(binding,response,new Date(now).toISOString()),available=65536-Buffer.byteLength(JSON.stringify(base));
 response.output.text='界'.repeat(Math.floor(available/3))+'.'.repeat(available%3);
 assert.equal(Buffer.byteLength(JSON.stringify(createDiscoveryR12Candidate(binding,response,new Date(now).toISOString()))),65536);
 response.output.text+='.';assert.throws(()=>createDiscoveryR12Candidate(binding,response,new Date(now).toISOString()),error=>error.code==='response_size');
});
