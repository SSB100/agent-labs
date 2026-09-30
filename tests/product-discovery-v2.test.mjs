import test from 'node:test';
import assert from 'node:assert/strict';
import v2 from '../.core-tests/products/discovery-v2.js';
import v1 from '../.core-tests/products/discovery.js';
import v1Types from '../.core-tests/products/types.js';
import research from '../.core-tests/research/sources.js';
import knowledge from '../.core-tests/products/discovery-v2-knowledge.js';
import etsyKnowledge from '../.core-tests/packs/etsy-knowledge.js';
import discoveryPacks from '../.core-tests/products/discovery-v2-packs.js';

// Synthetic contract fixtures only. No provider call or commercial qualification.
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = Date.parse('2026-09-30T23:10:00Z');
const prose = 'This comparison is limited to the cited observations and does not establish representative sales, conversion, or commercial viability.';
function fixture() {
  const knowledgeManifests = etsyKnowledge.etsyKnowledgePackManifests().filter(m => m.knowledge.some(k => knowledge.DISCOVERY_KNOWLEDGE_KEYS_V2.includes(k.key)));
  knowledgeManifests.push(discoveryPacks.discoveryEvidenceKnowledgePackV2());
  knowledgeManifests[0].dependencies = knowledgeManifests.slice(1).map(m => ({ packKey: m.packKey, version: m.version }));
  const knowledgeReleases = knowledgeManifests.map((manifest, index) => ({ id: id(90 + index), status: 'experimental', manifest }));
  const scopedKnowledge = knowledge.pinDiscoveryKnowledgeV2({ rootPackId: id(90), releases: knowledgeReleases }, now);
  const intent = { version: v2.DISCOVERY_V2, id: id(1), businessId: id(2), objective: 'Choose a supported initial geographic market and an original shirt concept for a bounded learning experiment.',
    comparisonUniverse: { productType: 'original_pod_tshirt', markets: [{ countryCode: 'US', currency: 'USD' }, { countryCode: 'GB', currency: 'GBP' }, { countryCode: 'AU', currency: 'AUD' }, { countryCode: 'NZ', currency: 'NZD' }], audiences: ['Adult camping enthusiasts'], sourceDomains: ['etsy.com', 'printful.com'], selectionQuestion: 'Compare geographic shipping feasibility and adjacent original camping-shirt buyer observations.' },
    limits: { maximumAlternatives: 3, maximumNewCollections: 2, maximumMicrousd: 500000, maximumGenerations: 1 }, expiresAt: '2026-10-01T12:00:00Z' };
  const request = { query: intent.comparisonUniverse.selectionQuestion, allowedDomains: intent.comparisonUniverse.sourceDomains };
  const marketText = `${'Synthetic 🏕️ catalog preamble, not evidence of demand. '.repeat(9)}June 2026: one US reviewer described an adult woodland shirt as a camping gift. This is adjacent-category buyer language, not this candidate\'s sales.`;
  const collection = research.extractResearchSources(request, { annotations: [
    { type: 'url_citation', url_citation: { url: 'https://www.etsy.com/listing/123456789/woodland-shirt', title: 'Synthetic market fixture', content: marketText } },
    { type: 'url_citation', url_citation: { url: 'https://www.printful.com/custom/mens/t-shirts/example', title: 'Synthetic operation fixture', content: 'Synthetic fixture: this garment accepts an original front DTG print within a specified print area. Its destination-specific shipping charge and seller fees remain unvalidated.' } },
    { type: 'url_citation', url_citation: { url: 'https://www.etsy.com/legal/creativity/', title: 'Synthetic policy fixture', content: 'Synthetic fixture: original seller-directed designs require appropriate rights and production disclosures. This source cannot establish market demand or legal clearance.' } },
  ], metadata: {} }, '2026-09-30T11:00:00Z');
  const pack = research.assembleEvidencePack(collection, { selectedEvidenceIds: collection.evidence.map(e => e.id), limitations: ['no_sales_metrics', 'no_current_prices'] }, now);
  const persisted = { artifactId: id(3), businessId: id(2), workflowRunId: id(4), queryId: id(5), collectedForIntentId: intent.id,
    question: request.query, sourceDomains: request.allowedDomains, evidencePack: pack,
    lineage: { status: 'completed', executionMode: 'web.research', provider: 'openrouter.exa', sourceArtifactId: id(6), providerRequestId: 'provider-search-receipt', workerRequestId: 'provider-selector-receipt' } };
  const candidate = { id: id(7), businessId: id(2), concept: 'Original camping illustration T-shirt', audience: 'Adult camping enthusiasts', productType: 'original_pod_tshirt', originalDesign: true, rightsStatus: 'unclear' };
  const alternative = { ...candidate, id: id(8), concept: 'Original starry-campsite illustration T-shirt' };
  const context = { knowledge: scopedKnowledge, packs: new Map([[persisted.artifactId, persisted]]), candidates: new Map([[candidate.id, candidate], [alternative.id, alternative]]), ownerRightsConfirmedCandidateIds: [candidate.id], sellerBankCountry: null, committedMicrousd: 10000 };
  const dossier = { version: v2.DISCOVERY_V2, intentId: intent.id, businessId: intent.businessId,
    packRefs: [{ artifactId: persisted.artifactId, sha256: v2.discoveryV2Hash(pack), origin: 'new', query: { id: persisted.queryId, question: request.query, sourceDomains: request.allowedDomains } }], shortlist: [candidate, alternative], comparisonRationale: prose };
  const refs = pack.evidence.map((e, index) => {
    const source = pack.sources.find(s => s.id === e.sourceId), start = index === 0 ? Array.from(source.excerpt.slice(0, source.excerpt.indexOf('June 2026:'))).length : 0;
    return { artifactId: persisted.artifactId, evidenceId: e.id, sourceId: source.id, sourceContentHash: source.contentHash, start, end: Math.min(Array.from(source.excerpt).length, start + 300) };
  });
  const fact = ref => ({ reference: ref, relevance: 'The exact observation supports only the limited finding described in this dimension.' });
  const uncertain = new Set(['demand', 'differentiation', 'estimated_margin', 'seasonality', 'marketing_potential']);
  const dimensions = v1Types.DIMENSIONS.map(dimension => ({ dimension, finding: uncertain.has(dimension) ? 'uncertain' : 'supported',
    evidenceStrength: dimension === 'estimated_margin' ? 'none' : uncertain.has(dimension) ? 'adjacent' : 'direct',
    facts: dimension === 'estimated_margin' ? [] : [fact(refs[dimension === 'production_complexity' ? 1 : dimension === 'policy_ip_risk' ? 2 : 0])],
    rationale: prose, uncertainties: uncertain.has(dimension) ? [{ question: `What additional candidate-specific evidence resolves ${dimension} before a commercial launch?`, blockingForTest: false, reason: 'This private visual learning test does not measure or assert profitable demand; the issue must be resolved before commerce.' }] : [], hardFailure: false }));
  const execution = { modelId: v2.DISCOVERY_V2_MODELS.strategist, providerRequestId: 'provider-strategist-receipt', primaryOnly: true };
  const reviewExecution = { modelId: v2.DISCOVERY_V2_MODELS.reviewer, providerRequestId: 'provider-reviewer-receipt', primaryOnly: true };
  const assessment = { version: v2.DISCOVERY_V2, intentId: intent.id, dossierHash: v2.discoveryV2Hash(dossier), execution,
    marketComparisons: intent.comparisonUniverse.markets.map(m => ({ ...m, assessment: prose, evidenceRefs: [refs[1]], assumptions: ['The seller bank country is unknown; local-seller fees are only a scenario.'], limitations: ['Geographic demand and actual landed costs have not been measured.'], sellerBankCountry: null,
      feeScenarios: [{ sellerBankCountry: m.countryCode, hypothetical: true, explanation: 'This is a hypothetical local-seller fee scenario, not a claim about the owner bank account.', evidenceRefs: [] }] })),
    candidates: dossier.shortlist.map(c => ({ candidateId: c.id, identityHash: v2.discoveryV2Hash(c), dimensions: structuredClone(dimensions) })),
    recommendation: { proposedOutcome: 'TEST', marketCountryCode: 'US', candidateId: candidate.id, rationale: prose,
      alternatives: [{ candidateId: alternative.id, rationale: 'The alternative remains plausible but has less directly relevant creative rationale in this bounded comparison.', evidenceRefs: [refs[0]] }] },
    testPlan: { scope: 'private_original_design_test', name: 'Original campsite composition learning test', hypothesis: 'A simple original campsite composition can communicate the intended outdoor theme clearly at the verified garment print size.', deliverable: 'One private, original design asset with exact-byte print and independent visual review.', successCriteria: ['Independent review confirms readable audience-appropriate composition and print constraints.'], failureCriteria: ['Any protected-content concern or print failure fails the test.'], stopRule: 'Stop after one generated asset and its independent review; preserve failures and do not publish, relaunch, or spend beyond the approved cap.', maximumMicrousd: 200000, maximumGenerations: 1, evidenceRefs: [refs[0], refs[1]], budgetStatus: "proposal_only", generationAuthorized: false, spendingAuthorized: false, publicationAllowed: false, commerceAllowed: false },
    missingQuestions: dimensions.flatMap(d => d.uncertainties.map(u => u.question)), publicationAllowed: false, commerceAllowed: false };
  const review = { version: v2.DISCOVERY_V2, intentId: intent.id, dossierHash: v2.discoveryV2Hash(dossier), assessmentHash: v2.discoveryV2Hash(assessment), execution: reviewExecution,
    marketCountryCode: 'US', candidateId: candidate.id, outcome: 'TEST', sufficiencyRationale: 'Adjacent-category evidence supports a limited visual learning experiment only. Every remaining uncertainty is explicitly nonblocking for this private test and remains unresolved for commerce.',
    dimensions: dimensions.map(d => ({ dimension: d.dimension, verdict: d.finding === 'uncertain' ? 'nonblocking_unknown' : 'sufficient_for_test', rationale: prose, evidenceRefs: d.facts.map(f => f.reference) })),
    checks: v2.REVIEW_CHECKS_V2.map(check => ({ check, outcome: 'PASS', rationale: prose })), executionPrerequisites: { ...v2.DISCOVERY_V2_EXECUTION_PREREQUISITES }, additionalUncertainties: [], missingQuestions: [...assessment.missingQuestions], publicationAllowed: false, commerceAllowed: false };
  return { intent, dossier, context, persisted, candidate, refs, assessment, review, execution, reviewExecution };
}
function check(f) { return v2.validateReviewerDecisionV2(f.intent, f.dossier, f.assessment, f.review, f.context, { strategist: f.execution, reviewer: f.reviewExecution }, now); }
function rebind(f) { f.assessment.dossierHash = v2.discoveryV2Hash(f.dossier); f.review.dossierHash = f.assessment.dossierHash; f.review.assessmentHash = v2.discoveryV2Hash(f.assessment); }

test('v2 compares up to four geographies and three concepts; qualitative TEST preserves unknown demand, margin and bank country', () => {
  const f = fixture(); check(f);
  assert.equal(f.assessment.marketComparisons.length, 4); assert.equal(f.assessment.candidates.length, 2);
  assert.equal(f.assessment.candidates[0].dimensions.find(d => d.dimension === 'estimated_margin').evidenceStrength, 'none');
  assert.equal(f.assessment.marketComparisons[0].sellerBankCountry, null);
  assert.equal(f.review.commerceAllowed, false); assert.equal(f.review.publicationAllowed, false);
  assert.ok(!('totalScore' in f.assessment));
});
test('exact spans select useful text beyond the old first-320 prefix and remain source/hash bound', () => {
  const f = fixture(); assert.ok(f.refs[0].start > 320); check(f);
  assert.match(v2.resolveDiscoveryEvidenceV2(f.refs[0], f.dossier, f.context).quote, /^June 2026:/);
  const source = f.persisted.evidencePack.sources[0];
  assert.notEqual(f.refs[0].start, source.excerpt.indexOf('June 2026:')); // non-BMP prefix uses code-point offsets
  for (const mutate of [r => { r.sourceContentHash = 'a'.repeat(64); }, r => { r.sourceId = 'src-other'; }, r => { r.end = r.start + 321; }, r => { r.start = -1; }, r => { r.end = r.start; }]) {
    const bad = fixture(); mutate(bad.assessment.candidates[0].dimensions[0].facts[0].reference); rebind(bad); assert.throws(() => check(bad));
  }
});
test('fabricated evidence IDs, paraphrased facts and unrelated artifact citations are rejected', () => {
  for (const mutate of [fact => { fact.reference.evidenceId = 'evi-made-up'; }, fact => { fact.quote = 'Invented demand observation'; }, fact => { fact.reference.artifactId = id(99); }]) {
    const f = fixture(); mutate(f.assessment.candidates[0].dimensions[0].facts[0]); rebind(f); assert.throws(() => check(f));
  }
});
test('stale evidence, bad persisted receipts, changed questions and corrupt immutable hashes fail', () => {
  for (const mutate of [f => { f.persisted.evidencePack.sources[0].retrievalExpiresAt = '2026-09-30T11:01:00Z'; }, f => { f.persisted.lineage.status = 'running'; }, f => { f.persisted.lineage.providerRequestId = 'mock-call'; }, f => { f.persisted.businessId = id(99); }, f => { f.persisted.question = 'A different scope question'; }, f => { f.dossier.packRefs[0].sha256 = 'a'.repeat(64); }]) {
    const f = fixture(); mutate(f); if (f.persisted.evidencePack.sources[0].retrievalExpiresAt.endsWith('11:01:00Z')) f.dossier.packRefs[0].sha256 = v2.discoveryV2Hash(f.persisted.evidencePack); rebind(f); assert.throws(() => check(f));
  }
});
test('new-collection labels cannot evade the cap, and an intent cannot expand beyond four countries', () => {
  const f = fixture(); f.dossier.packRefs[0].origin = 'prior'; rebind(f); assert.throws(() => check(f), /origin/);
  const g = fixture(); g.intent.comparisonUniverse.markets.push({ countryCode: 'CA', currency: 'CAD' }); assert.throws(() => check(g), /count/);
});
test('omitting a dimension or silently changing immutable candidate identity fails', () => {
  const f = fixture(); f.assessment.candidates[0].dimensions.pop(); rebind(f); assert.throws(() => check(f), /nine dimensions/);
  const g = fixture(); g.assessment.candidates[0].identityHash = 'a'.repeat(64); rebind(g); assert.throws(() => check(g), /identity/);
  const h = fixture(); h.dossier.shortlist[0] = { ...h.candidate, concept: 'A substituted concept' }; rebind(h); assert.throws(() => check(h), /identity/);
});
test('blocking uncertainty cannot be waived by an independent PASS; NME preserves exact questions', () => {
  const f = fixture(); f.assessment.candidates[0].dimensions[0].uncertainties[0].blockingForTest = true; rebind(f);
  assert.throws(() => check(f), /blocking uncertainty/);
  f.review.dimensions[0].verdict = 'blocking'; assert.throws(() => check(f), /unresolved blocking/);
  f.review.outcome = 'NEEDS_MORE_EVIDENCE'; check(f);
  f.review.missingQuestions = []; assert.throws(() => check(f), /missing questions/);
});
test('weak guidance cannot be called sufficient or become the only TEST market basis', () => {
  const f = fixture(); const d = f.assessment.candidates[0].dimensions.find(d => d.dimension === 'competition'); d.evidenceStrength = 'guidance'; rebind(f); assert.throws(() => check(f), /Weak guidance/);
  const g = fixture(); for (const d of g.assessment.candidates[0].dimensions) {
    if (['demand', 'competition', 'marketing_potential', 'differentiation'].includes(d.dimension)) {
      d.finding = 'uncertain'; d.evidenceStrength = 'guidance'; d.uncertainties = [{ question: `Which real market observations substantiate ${d.dimension}?`, blockingForTest: false, reason: 'The guidance alone does not establish candidate or adjacent market observations.' }];
      const reviewed = g.review.dimensions.find(r => r.dimension === d.dimension); reviewed.verdict = 'nonblocking_unknown';
    }
  }
  g.assessment.missingQuestions = [...new Set(g.assessment.candidates.flatMap(c => c.dimensions.flatMap(d => d.uncertainties.map(u => u.question))))]; g.review.missingQuestions = [...g.assessment.missingQuestions]; rebind(g);
  assert.throws(() => check(g), /observed market evidence/);
});
test('same-model review, fallback use and self-reported execution mismatch fail', () => {
  for (const mutate of [f => { f.review.execution.modelId = f.execution.modelId; }, f => { f.review.execution.primaryOnly = false; }, f => { f.review.execution.providerRequestId = 'fabricated-review-receipt'; }]) {
    const f = fixture(); f.reviewExecution = structuredClone(f.reviewExecution); mutate(f); assert.throws(() => check(f), /execution receipt/);
  }
});
test('reviewer cannot silently convert NEEDS_MORE_EVIDENCE into a new TEST plan', () => {
  const f = fixture(); f.assessment.recommendation.proposedOutcome = 'NEEDS_MORE_EVIDENCE'; f.assessment.testPlan = null; rebind(f); assert.throws(() => check(f), /auto-convert/);
});
test('known policy/IP or production failure and nonoriginal candidate are hard rejection gates', () => {
  for (const dimension of ['policy_ip_risk', 'production_complexity']) {
    const f = fixture(); const d = f.assessment.candidates[0].dimensions.find(d => d.dimension === dimension); d.finding = 'unfavorable'; d.hardFailure = true;
    f.review.dimensions.find(d => d.dimension === dimension).verdict = 'known_failure'; rebind(f); assert.throws(() => check(f), /requires REJECT/);
    f.review.outcome = 'REJECT'; check(f);
    d.hardFailure = false; rebind(f); assert.throws(() => check(f), /cannot be waived/);
  }
  const f = fixture(); f.candidate.originalDesign = false; f.assessment.candidates[0].identityHash = v2.discoveryV2Hash(f.candidate); rebind(f); assert.throws(() => check(f), /requires REJECT/);
});
test('TEST recommendation may await owner rights acknowledgement but cannot satisfy execution prerequisites', () => {
  const f = fixture(); f.context.ownerRightsConfirmedCandidateIds = []; check(f);
  assert.equal(f.candidate.rightsStatus, 'unclear');
  assert.equal(f.review.executionPrerequisites.ownerCreativeApproval, 'required');
  f.review.executionPrerequisites.ownerCreativeApproval = 'satisfied';
  assert.throws(() => check(f), /execution prerequisites/);
});
test('bank country cannot be inferred, geography cannot silently change, and comparison is required', () => {
  const f = fixture(); f.assessment.marketComparisons[0].sellerBankCountry = 'US'; rebind(f); assert.throws(() => check(f), /bank country/);
  const g = fixture(); g.assessment.recommendation.marketCountryCode = 'GB'; g.review.marketCountryCode = 'GB'; rebind(g); check(g); assert.ok(!('marketCountryCode' in g.candidate));
  g.assessment.recommendation.marketCountryCode = 'CA'; g.review.marketCountryCode = 'CA'; rebind(g); assert.throws(() => check(g), /geography/);
  const h = fixture(); h.assessment.marketComparisons.pop(); rebind(h); assert.throws(() => check(h), /geographic comparisons/);
});
test('future test proposal is independent of research consumption and grants no execution authority', () => {
  const f = fixture(); f.context.committedMicrousd = 400000; check(f);
  assert.equal(f.assessment.testPlan.budgetStatus, 'proposal_only');
  assert.equal(f.assessment.testPlan.spendingAuthorized, false);
  assert.equal(f.assessment.testPlan.generationAuthorized, false);
  const g = fixture(); g.assessment.testPlan.publicationAllowed = true; rebind(g); assert.throws(() => check(g), /never grants/);
  const h = fixture(); h.assessment.testPlan.maximumGenerations = 2; rebind(h); assert.throws(() => check(h), /generation bound/);
});
test('v1 remains numeric and unknown by default, with no implicit version conversion', () => {
  assert.equal(v1Types.SCORING_VERSION, 'pod-discovery-1.0');
  const f = fixture(); const input = { concept: f.candidate.concept, audience: f.candidate.audience, hypothesis: 'Original campsite illustration could interest adult camping enthusiasts.', originalDesign: true, rightsStatus: 'unclear', sourceDomains: ['etsy.com', 'printful.com'] };
  const pack = structuredClone(f.persisted.evidencePack); pack.question = v1.candidateResearchRequest(input).query;
  const current = Date.now(); for (const source of pack.sources) { source.retrievedAt = new Date(current - 1000).toISOString(); source.retrievalExpiresAt = new Date(current + 86400000 - 1000).toISOString(); }
  const result = v1.assessProductCandidate(input, pack);
  assert.equal(result.scoringVersion, 'pod-discovery-1.0'); assert.equal(result.outcome, 'NEEDS_MORE_EVIDENCE'); assert.equal(result.totalScore, null); assert.ok(result.dimensions.every(d => d.score === null));
  assert.equal(result.review.creativeProductionAllowed, false); assert.equal(result.review.publicationAllowed, false);
});


test('one collection is permitted, snapshot byte bounds are explicit, and unknown is not a favorable score', () => {
  const f = fixture(); f.intent.limits.maximumNewCollections = 1; check(f);
  assert.ok(Buffer.byteLength(JSON.stringify(f.assessment), 'utf8') < v2.DISCOVERY_V2_SNAPSHOT_BYTES.strategist);
  assert.ok(Buffer.byteLength(JSON.stringify(f.review), 'utf8') < v2.DISCOVERY_V2_SNAPSHOT_BYTES.reviewer);
  const size = Buffer.byteLength(JSON.stringify(f.assessment), 'utf8');
  assert.ok(size < 22000, `Two-candidate expanded contract is ${size} bytes; the model should use compact references.`);
  f.assessment.candidates[0].dimensions[0].score = 5; rebind(f); assert.throws(() => check(f), /fields/);
});

test('geographic comparison cannot claim best-market selection from a single declared market', () => {
  const f = fixture(); f.intent.comparisonUniverse.markets = f.intent.comparisonUniverse.markets.slice(0, 1);
  assert.throws(() => check(f), /geographic comparison markets/);
});

test('proposal remains valid after research consumes its whole allowance; no authority is transferred', () => {
  const f = fixture(); f.context.committedMicrousd = f.intent.limits.maximumMicrousd;
  f.assessment.testPlan.maximumMicrousd = v2.DISCOVERY_V2_PROPOSAL_CEILING_MICROUSD;
  rebind(f); check(f);
  assert.equal(f.review.outcome, 'TEST');
  assert.equal(f.assessment.testPlan.spendingAuthorized, false);
  assert.deepEqual(f.review.executionPrerequisites, v2.DISCOVERY_V2_EXECUTION_PREREQUISITES);
  f.assessment.testPlan.maximumMicrousd += 1; rebind(f);
  assert.throws(() => check(f), /future test proposal/);
});
test('future budget status and every actual-execution prerequisite remain closed', () => {
  for (const mutate of [f => { f.assessment.testPlan.spendingAuthorized = true; }, f => { f.assessment.testPlan.generationAuthorized = true; }, f => { f.assessment.testPlan.budgetStatus = 'approved'; }]) {
    const f = fixture(); mutate(f); rebind(f); assert.throws(() => check(f), /proposal|authority/);
  }
  for (const key of Object.keys(v2.DISCOVERY_V2_EXECUTION_PREREQUISITES)) {
    const f = fixture(); f.review.executionPrerequisites[key] = 'satisfied';
    assert.throws(() => check(f), /execution prerequisites/);
  }
});

test('reviewer-discovered uncertainty is classified by dimension without erasing a producer blocker', () => {
  const f = fixture(), question = 'Which destination delivery estimate applies before a future commercial launch?';
  f.review.additionalUncertainties.push({ dimension: 'production_complexity', question, blockingForTest: false, reason: 'Delivery promises are outside the private visual learning experiment and remain unresolved before commerce.' });
  f.review.dimensions.find(d => d.dimension === 'production_complexity').verdict = 'nonblocking_unknown';
  f.review.missingQuestions.push(question); check(f);
  f.assessment.candidates[0].dimensions.find(d => d.dimension === 'production_complexity').uncertainties.push({ question, blockingForTest: true, reason: 'The producer considers this issue a prerequisite for this exact experiment and the reviewer cannot silently erase it.' });
  f.assessment.missingQuestions.push(question); rebind(f);
  assert.throws(() => check(f), /blocking uncertainty/);
});
test('pinned actual knowledge is required and rejects missing, forged and stale records', () => {
  const f = fixture(); knowledge.validateDiscoveryKnowledgeV2(f.context.knowledge, now);
  f.context.knowledge.records.pop(); assert.throws(() => check(f), /five pinned/);
  const g = fixture(); g.context.knowledge.records[0].contentHash = 'a'.repeat(64); assert.throws(() => check(g), /knowledge hash/);
  const h = fixture(); assert.throws(() => knowledge.validateDiscoveryKnowledgeV2(h.context.knowledge, now + 100 * 86400000), /stale/);
});
