// Current-source, inert regression. No provider call, grant or live evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { source, fixture, workspace, elements, text } from './helpers/r12-pod-owner-ui-fixture.mjs';
const { extractResearchSources, assembleEvidencePack } = source('research/sources');
const { POD_DIMENSIONS, POD_REVIEW_CHECKS } = source('products/discovery-r12-pod-analysis');
const { classifyPodReviewLengthFailure } = source('products/discovery-r12-pod-review-failure');
const { validateJsonSchemaValue } = source('workers/schema-validator');
const clone = structuredClone;
function inputs() {
  const now = Date.now(), request = { query: 'Inert technical evidence for an unproven POD hypothesis.', allowedDomains: ['example.org'] };
  const collection = extractResearchSources(request, { annotations: [{ type: 'url_citation', url_citation: { url: 'https://example.org/research', title: 'Synthetic test only', content: 'This synthetic technical fixture contains no measured sales, willingness to pay, market size, product quality or profitable fulfilment evidence.' } }], metadata: {} }, new Date(now).toISOString());
  const pack = assembleEvidencePack(collection, { selectedEvidenceIds: collection.evidence.map(e => e.id), limitations: ['no_sales_metrics'] }, now);
  const assessment = { explorationSummary: 'Synthetic technical assessment only; there is not enough evidence to recommend a commercial product test.', candidates: [{ productType: 'An unproven printed object', niche: 'Unspecified synthetic niche', audience: 'Unspecified synthetic audience', rationale: 'No measured demand or product-specific economics support this synthetic candidate.', support: [], counterevidence: [], alternativeExplanation: 'General interest may never translate into actual purchases or a profitable margin.', dimensions: POD_DIMENSIONS.map(dimension => ({ dimension, verdict: 'uncertain', rationale: 'The retained synthetic source does not establish this commercial dimension.', evidence: [], missing: ['Representative relevant evidence remains missing.'] })) }], recommendation: { outcome: 'INSUFFICIENT_EVIDENCE', candidateIndex: null, rationale: 'The retained synthetic evidence does not support a viable product recommendation.', nextTest: 'Seek independent aggregate evidence of buyer needs and delivered costs under the approved source policy.' }, limitations: ['This is an inert fixture and does not establish real demand.'], etsyDemandVerified: false, commercialViabilityVerified: false };
  const review = { outcome: 'INSUFFICIENT_EVIDENCE', candidateIndex: null, rationale: 'Independent review finds that the synthetic evidence cannot establish relevant buyer demand or viable margins.', checks: POD_REVIEW_CHECKS.map(check => ({ check, verdict: 'FAIL', rationale: 'The synthetic evidence does not support a commercial research recommendation.', evidence: ['E1'] })), missingEvidence: ['Actual buyer demand and delivered economics remain unmeasured.'], nextTest: 'Collect independent aggregate public evidence before recommending a product test.', etsyDemandVerified: false, commercialViabilityVerified: false };
  for (const i of [1,2,3,4,5]) review.checks[i].rationale = 'The source does not establish relevant independent demand, competitive advantage, fulfilment reliability, delivered economics, or rights clearance. '.repeat(2);
  review.nextTest = 'Seek independent aggregate public evidence under the approved source policy before recommending a product test. '.repeat(4);
  return { review, assessment, pack };
}
test('reproduces the six actual length failures without accepting or changing the original review', () => {
  const {review,assessment,pack} = inputs(), before = clone(review), failure = classifyPodReviewLengthFailure(review,assessment,pack);
  assert.deepEqual(failure.fields.map(f => f.path), [1,2,3,4,5].map(i => `$.checks[${i}].rationale`).concat('$.nextTest'));
  assert.deepEqual(review,before); assert.equal('accepted' in failure,false); assert.equal('review' in failure,false);
  assert.equal(failure.originalHash.length,64); assert.ok(failure.fields.every(f => f.original.length > f.max));
});
test('additional schema and domain defects cannot masquerade as length-only failure', () => {
  for (const change of [r => r.candidateIndex=0, r => r.etsyDemandVerified=true, r => r.checks[1].check=r.checks[0].check,
    r => r.checks[1].evidence=['E4'], r => r.checks[1].verdict='MAYBE', r => r.nextTest=null,
    r => r.checks.push(clone(r.checks[0])), r => r.unapproved='inert', r => r.missingEvidence=[]]) {
    const {review,assessment,pack}=inputs(); change(review); assert.throws(() => classifyPodReviewLengthFailure(review,assessment,pack));
  }
  const {review,assessment,pack}=inputs(); review.checks.forEach(c=>c.rationale='No independent demand or economics support a commercial research recommendation.');review.nextTest='Seek independent aggregate evidence before recommending a product test.';
  assert.throws(()=>classifyPodReviewLengthFailure(review,assessment,pack),'Valid responses are not failure eligibility');
});
test('JSON-owned prototype names and inherited required fields fail strict schema validation', () => {
  const schema={type:'object',additionalProperties:false,required:['value'],properties:{value:{type:'string'}}};
  for(const key of ['constructor','__proto__','toString','hasOwnProperty']) {
    const raw=JSON.parse(`{"value":"safe","${key}":{"executionAuthorized":true}}`);
    assert.ok(validateJsonSchemaValue(schema,raw).some(i=>i.path===`$.${key}`));
    const {review,assessment,pack}=inputs(), hostile=JSON.parse(JSON.stringify(review).slice(0,-1)+`,"${key}":true}`);
    assert.throws(()=>classifyPodReviewLengthFailure(hostile,assessment,pack));
  }
  assert.ok(validateJsonSchemaValue(schema,Object.create({value:'inherited'})).length > 0);
});
test('saved rejection overrides stale dispatched state and never offers blind Continue', () => {
  const f=fixture();f.receipt.activated=true;
  const status={state:'running',reason:'dispatched',activeWindow:true,receiptUntil:new Date(f.now+60000).toISOString(),cost:{knownMicrousd:'28912',heldMicrousd:'0',hasUnknown:false},phases:[{phase:'review',status:'dispatched',reason:null,responseDiagnostic:{code:'response_schema',observationSaved:true,issues:[{path:'$.nextTest',constraint:'max_length',limit:400}]}}]};
  const h=workspace(f,{selected:f.receipt,status}), view=text(h.render());
  assert.match(view,/Reviewer response could not be validated/);assert.match(view,/no accepted independent review yet/);
  assert.doesNotMatch(view,/Continue saved run|Last saved controller state|dispatched/);assert.equal(h.calls.length,0);
  assert.equal(elements(h.render(),e=>e.type==='button'&&text(e)==='Stop research').length,1);
  f.receipt.stopped=true;const stopped=text(workspace(f,{selected:f.receipt,status}).render());
  assert.match(stopped,/Stopped/);assert.match(stopped,/original response/);assert.doesNotMatch(stopped,/Continue saved run/);
});
