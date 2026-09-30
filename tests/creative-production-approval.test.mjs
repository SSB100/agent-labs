import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { currentProductionCandidate, productionCreativeApproval } = require('../.core-tests/creative/production-approval.js');
const { assessProductCandidate, candidateResearchRequest } = require('../.core-tests/products/discovery.js');
const { DIMENSIONS, DEFAULT_MEASUREMENT_PLAN } = require('../.core-tests/products/types.js');
const { extractResearchSources, assembleEvidencePack } = require('../.core-tests/research/sources.js');
const { SCREEN_CATEGORIES } = require('../.core-tests/creative/types.js');
const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;

function fixture() {
  const input = { concept: 'Synthetic original garden illustration', audience: 'Adult fixture audience', hypothesis: 'Synthetic fixture only, not actual buyer observations or market validation.', originalDesign: true, rightsStatus: 'confirmed', sourceDomains: ['etsy.com', 'printful.com'] };
  const candidate = { id: id(1), business_id: id(2), fingerprint: 'fixture', concept: input.concept, audience: input.audience, hypothesis: input.hypothesis, product_type: 'original_pod_tshirt', original_design: true, rights_status: 'confirmed', source_domains: input.sourceDomains, created_at: new Date().toISOString() };
  const collection = extractResearchSources(candidateResearchRequest(input), { annotations: [
    { type: 'url_citation', url_citation: { url: 'https://www.etsy.com/listing/123456789/fixture', title: 'Synthetic observation', content: 'Synthetic fixture only: a hypothetical original garden shirt has buyer comments. This tests validation and is not a source-backed market finding.' } },
    { type: 'url_citation', url_citation: { url: 'https://www.printful.com/custom/mens/t-shirts', title: 'Synthetic operational input', content: 'Synthetic fixture only: production and shipping cost components require actual SKU and destination verification before a real assessment.' } },
    { type: 'url_citation', url_citation: { url: 'https://www.etsy.com/legal/creativity/', title: 'Synthetic policy input', content: 'Synthetic fixture only: seller originality and applicable policy review must be established independently for a real design.' } },
  ], metadata: { fixture: true } }, new Date(Date.now() - 1000).toISOString());
  const evidence = assembleEvidencePack(collection, { selectedEvidenceIds: collection.evidence.map(e => e.id), limitations: ['no_sales_metrics'] });
  const dimensions = DIMENSIONS.map(dimension => ({ dimension, score: 4,
    evidenceIds: [evidence.evidence[dimension === 'policy_ip_risk' ? 2 : ['estimated_margin', 'production_complexity'].includes(dimension) ? 1 : 0].id],
    rationale: 'Synthetic fixture assessment only; this is not an actual commercial judgment.',
    evidenceKind: dimension === 'policy_ip_risk' ? 'policy' : ['estimated_margin', 'production_complexity'].includes(dimension) ? 'operational_fact' : 'market_observation' }));
  const experiment = { id: id(3), candidate_id: candidate.id, business_id: candidate.business_id, status: 'completed', source_artifact_id: id(4), evidence_pack: evidence, measurement_plan: DEFAULT_MEASUREMENT_PLAN };
  const decision = { id: id(5), candidate_id: candidate.id, business_id: candidate.business_id, experiment_id: experiment.id, created_at: new Date().toISOString(), assessment: assessProductCandidate(input, evidence, dimensions, 'owner_assessment') };
  return { candidate, decision, experiment };
}

test('production approval preflight requires current owner TEST, scoped evidence and exact recomputed assessment', () => {
  const f = fixture();
  assert.ok(currentProductionCandidate(f.candidate, [f.decision], [f.experiment]));
  for (const mutate of [
    d => { d.assessment.outcome = 'NEEDS_MORE_EVIDENCE'; },
    d => { d.assessment.totalScore = 100; },
    d => { d.assessment.dimensions[0].score = null; },
    d => { d.assessment.assessmentOrigin = 'deterministic_provisional'; },
    d => { d.business_id = id(99); },
    d => { d.assessment.review.creativeProductionAllowed = true; },
  ]) { const d = structuredClone(f.decision); mutate(d); assert.equal(currentProductionCandidate(f.candidate, [d], [f.experiment]), null); }
  for (const mutate of [e => { e.status = 'researching'; }, e => { e.source_artifact_id = null; }, e => { e.business_id = id(99); }, e => { e.evidence_pack.sources[0].retrievalExpiresAt = new Date(Date.now() - 1).toISOString(); }, e => { e.evidence_pack.sources[0].provider = 'simulation.fixture'; }]) {
    const e = structuredClone(f.experiment); mutate(e); assert.equal(currentProductionCandidate(f.candidate, [f.decision], [e]), null);
  }
});

test('newer and tied decisions cannot leave an earlier TEST selectable', () => {
  const f = fixture(), newer = structuredClone(f.decision); newer.id = id(6); newer.created_at = new Date(Date.parse(f.decision.created_at) + 1).toISOString(); newer.assessment.outcome = 'REJECT';
  assert.equal(currentProductionCandidate(f.candidate, [f.decision, newer], [f.experiment]), null);
  newer.created_at = f.decision.created_at; newer.assessment = f.decision.assessment;
  assert.equal(currentProductionCandidate(f.candidate, [f.decision, newer], [f.experiment]), null);
});

test('production approval separately binds candidate identity, explicit rights and eight source-backed screens', () => {
  const f = fixture(), input = { approvalId: id(7), designInstructions: 'Create an original simplified garden illustration on an intentional opaque cream square, without text or protected elements.', rightsStatement: 'Synthetic owner rights statement for this regression fixture, not an actual rights clearance.',
    policyScreen: SCREEN_CATEGORIES.map(category => ({ category, status: 'clear', rationale: 'Synthetic concept-specific screen for regression testing only.', sourceUrls: ['https://www.etsy.com/legal/creativity/'] })), maximumMicrousd: 1_000_000 };
  const approval = productionCreativeApproval(f, input);
  assert.equal(approval.purpose, 'candidate_production'); assert.equal(approval.candidateId, f.candidate.id); assert.equal(approval.decisionId, f.decision.id);
  assert.equal(approval.businessId, f.candidate.business_id); assert.equal(approval.concept, f.candidate.concept); assert.equal(approval.audience, f.candidate.audience);
  assert.equal(approval.maximumGenerations, 2);
  assert.equal(productionCreativeApproval(f, { ...input, maximumGenerations: 1 }).maximumGenerations, 1);
  assert.throws(() => productionCreativeApproval(f, { ...input, maximumGenerations: 3 }), /generation limit/);
  assert.deepEqual(approval.candidateAssessment, f.decision.assessment); assert.equal(approval.publicationAllowed, false);
  assert.throws(() => productionCreativeApproval(f, { ...input, rightsStatement: '' }), /approval/);
  assert.throws(() => productionCreativeApproval(f, { ...input, policyScreen: [] }), /eight/);
  assert.throws(() => productionCreativeApproval(f, { ...input, policyScreen: input.policyScreen.map((s, i) => i ? s : { ...s, status: 'unknown' }) }), /eight/);
  assert.throws(() => productionCreativeApproval(f, { ...input, policyScreen: input.policyScreen.map((s, i) => i ? s : { ...s, sourceUrls: ['http://localhost/private'] }) }), /eight/);
});
