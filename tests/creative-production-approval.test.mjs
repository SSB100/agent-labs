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

test('newer versioned or malformed decisions fail closed without reviving an earlier owner TEST', () => {
  const f = fixture();
  for (const assessment of [null, { version: 'pod-discovery-2.0', outcome: 'TEST' }, { scoringVersion: 'future', outcome: 'TEST' }]) {
    const newer = { ...f.decision, id: id(60), created_at: new Date(Date.parse(f.decision.created_at) + 1).toISOString(), assessment };
    assert.equal(currentProductionCandidate(f.candidate, [f.decision, newer], [f.experiment]), null);
  }
  assert.equal(currentProductionCandidate(f.candidate, [f.decision], [{ ...f.experiment, discovery_version: 'pod-discovery-2.0', parent_discovery_id: id(61) }]), null);
});

test('a later unselected v2 candidate evaluation blocks an older legacy TEST without inventing a verdict',()=>{
  const f=fixture();const later={...f.experiment,id:id(30),discovery_version:'pod-discovery-2.0',parent_discovery_id:id(31),completed_at:new Date(Date.parse(f.decision.created_at)+1000).toISOString(),measurement_plan:{version:'pod-discovery-2.0',testPlan:null}};
  assert.equal(currentProductionCandidate(f.candidate,[f.decision],[f.experiment,later]),null);
  assert.ok(currentProductionCandidate(f.candidate,[f.decision],[f.experiment,{...later,candidate_id:id(99)}]));
  assert.ok(currentProductionCandidate(f.candidate,[f.decision],[f.experiment,{...later,business_id:id(99)}]));
  assert.ok(currentProductionCandidate(f.candidate,[f.decision],[f.experiment,{...later,completed_at:new Date(Date.parse(f.decision.created_at)-1000).toISOString()}]));
});
function v2Fixture(){
  const f=fixture(),{REVIEW_CHECKS_V2,DISCOVERY_V2_EXECUTION_PREREQUISITES}=require('../.core-tests/products/discovery-v2.js');
  const rootId=id(80),created=new Date().toISOString(),descriptor={version:'pod-discovery-2.0',intentId:rootId,dossierArtifactId:id(81),strategyArtifactId:id(82),reviewArtifactId:id(83)};
  const review={version:'pod-discovery-2.0',intentId:rootId,dossierHash:'a'.repeat(64),assessmentHash:'b'.repeat(64),execution:{modelId:'anthropic/claude-haiku-4.5',providerRequestId:'example-observed-review-request',primaryOnly:true},marketCountryCode:'US',candidateId:f.candidate.id,outcome:'TEST',sufficiencyRationale:'Synthetic UI contract fixture only: a bounded learning proposal preserves its uncertainty and must still pass authoritative persisted-source validation.',dimensions:DIMENSIONS.map(dimension=>({dimension,verdict:'sufficient_for_test',rationale:'Synthetic UI contract rationale only; actual source lineage is independently enforced by the owner RPC.',evidenceRefs:[]})),checks:REVIEW_CHECKS_V2.map(check=>({check,outcome:'PASS',rationale:'Synthetic independent-review contract fixture for the read-only approval preflight.'})),executionPrerequisites:DISCOVERY_V2_EXECUTION_PREREQUISITES,additionalUncertainties:[],missingQuestions:[],publicationAllowed:false,commerceAllowed:false};
  const root={...f.experiment,id:rootId,candidate_id:null,discovery_version:'pod-discovery-2.0',parent_discovery_id:null,created_at:created,source_artifact_id:id(81),variables:{intent:{expiresAt:new Date(Date.now()+3600000).toISOString()}},evidence_pack:descriptor,measurement_plan:{version:'pod-discovery-2.0',testPlan:null}};
  const child={...f.experiment,id:id(84),discovery_version:'pod-discovery-2.0',parent_discovery_id:rootId,created_at:created,source_artifact_id:id(81),evidence_pack:descriptor,measurement_plan:{version:'pod-discovery-2.0',testPlan:{maximumGenerations:1,budgetStatus:'proposal_only'}}};
  const decision={...f.decision,id:id(85),experiment_id:child.id,assessment:review};
  return{candidate:f.candidate,root,child,decision};
}
test('versioned reviewed TEST preflight retains its qualitative record and separate owner approval boundary',()=>{
  const f=v2Fixture(),choice=currentProductionCandidate(f.candidate,[f.decision],[f.root,f.child]);assert.ok(choice);assert.equal(choice.maximumGenerations,1);
  const input={approvalId:id(86),designInstructions:'Create an original simplified garden illustration on an intentional opaque cream square, without text or protected elements.',rightsStatement:'Synthetic owner rights declaration for this original concept, not a legal clearance.',policyScreen:SCREEN_CATEGORIES.map(category=>({category,status:'clear',rationale:'Synthetic concept-specific screen for this unit test only.',sourceUrls:['https://www.etsy.com/legal/creativity/']})),maximumMicrousd:500000,maximumGenerations:1};
  const approval=productionCreativeApproval(choice,input);assert.deepEqual(approval.candidateAssessment,f.decision.assessment);assert.equal(approval.purpose,'candidate_production');assert.equal(approval.maximumGenerations,1);assert.equal(approval.publicationAllowed,false);assert.equal(approval.candidateAssessment.totalScore,undefined);
  assert.throws(()=>productionCreativeApproval(choice,{...input,maximumGenerations:2}),/image count/);
  assert.throws(()=>productionCreativeApproval({...choice,maximumGenerations:undefined},{...input,maximumGenerations:2}),/image count/);
  assert.throws(()=>productionCreativeApproval({...choice,maximumGenerations:2},{...input,maximumGenerations:2}),/image count/);
  for(const mutate of [f=>{f.root.status='researching';},f=>{f.root.variables.intent.expiresAt=new Date(Date.now()-1).toISOString();},f=>{f.decision.assessment.outcome='NEEDS_MORE_EVIDENCE';},f=>{f.decision.assessment.dimensions[0].verdict='blocking';},f=>{f.decision.assessment.checks[0].outcome='FAIL';},f=>{f.decision.assessment.execution.modelId='openai/gpt-5.6-luna';},f=>{f.child.evidence_pack={...f.child.evidence_pack,intentId:id(90)};}]){const x=v2Fixture();mutate(x);assert.equal(currentProductionCandidate(x.candidate,[x.decision],[x.root,x.child]),null);}
});
