import test from 'node:test';
import assert from 'node:assert/strict';
import v2 from '../.core-tests/products/discovery-v2.js';
import worker from '../.core-tests/products/discovery-v2-worker-contract.js';
import schema from '../.core-tests/workers/schema-validator.js';
import limits from '../.core-tests/workers/output-limits.js';
import creativeLimits from '../.core-tests/creative/output-limits.js';
import modelProvider from '../.core-tests/models/openrouter.js';
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
function preparedFixture() {
  const f = fixture();
  const prepared = worker.prepareDiscoveryWorkerContextV2(f.intent, f.dossier, f.context, f.refs, now);
  const compact = worker.compactStrategistAssessmentV2(prepared, f.assessment);
  return { ...f, prepared, compact };
}
function threeCandidateFixture() {
  const f = fixture(), third = { ...f.candidate, id: id(9), concept: 'Original forest-trail line illustration T-shirt' };
  f.dossier.shortlist.push(third); f.context.candidates.set(third.id, third);
  f.assessment.candidates.push({ ...structuredClone(f.assessment.candidates[0]), candidateId: third.id, identityHash: v2.discoveryV2Hash(third) });
  f.assessment.recommendation.alternatives.push({ candidateId: third.id, rationale: 'This concept remains a third plausible alternative, but its specific buyer interest is not established.', evidenceRefs: [f.refs[0]] });
  f.assessment.dossierHash = v2.discoveryV2Hash(f.dossier);
  return f;
}
function compactReview(f) {
  const key = ref => f.prepared.evidencePool.find(e => v2.discoveryV2Hash(e.reference) === v2.discoveryV2Hash(ref)).key;
  return { marketCountryCode: f.review.marketCountryCode, candidateKey: f.prepared.candidateKeys.find(c => c.candidateId === f.review.candidateId).key, outcome: f.review.outcome,
    sufficiencyRationale: f.review.sufficiencyRationale, dimensions: f.review.dimensions.map(d => ({ dimension: d.dimension, verdict: d.verdict, rationale: d.rationale, evidence: d.evidenceRefs.map(key) })), checks: f.review.checks, additionalUncertainties: [] };
}

test('compact strategy uses deterministic short keys and restores immutable identities, spans and actual receipts', () => {
  const f = preparedFixture();
  const reversed = worker.prepareDiscoveryWorkerContextV2(f.intent, f.dossier, f.context, [...f.refs].reverse(), now);
  assert.deepEqual(f.prepared.evidencePool, reversed.evidencePool);
  schema.assertJsonSchemaValue(worker.strategistResponseSchemaV2(f.prepared), f.compact, 'strategy');
  assert.ok(!JSON.stringify(f.compact).includes(f.candidate.id));
  assert.ok(!JSON.stringify(f.compact).includes(f.refs[0].sourceContentHash));
  assert.ok(!('missingQuestions' in f.compact));
  const restored = worker.normalizeStrategistResponseV2(f.prepared, f.compact, f.execution, now);
  assert.deepEqual(restored, f.assessment);
  assert.ok(restored.missingQuestions.length > 0);
  assert.equal(restored.execution.providerRequestId, f.execution.providerRequestId);
  assert.equal(restored.commerceAllowed, false);
});
test('unknown bank country requires hypothetical fee scenarios in both model and domain contracts', () => {
  const f = preparedFixture(), contract = worker.strategistResponseSchemaV2(f.prepared);
  const market = contract.properties.marketComparisons.items.properties;
  assert.equal(market.sellerBankCountry.const, null);
  assert.equal(market.feeScenarios.minItems, 1);
  const projected = modelProvider.projectProviderJsonSchema(contract).properties.marketComparisons.items.properties;
  assert.deepEqual(projected.sellerBankCountry.enum, [null]);
  assert.match(projected.feeScenarios.description, /at least one explicitly hypothetical/);
  assert.match(projected.feeScenarios.description, /do not invent fee rates/);
  const request = worker.buildStrategistRequestV2(f.prepared, now);
  assert.match(request.messages[0].content, /every market needs at least one/);
  assert.match(JSON.parse(request.messages[1].content).outputLimits, /marketComparisons\[\]\.feeScenarios: 1–4 items/);
  const empty = structuredClone(f.compact); empty.marketComparisons[0].feeScenarios = [];
  assert.throws(() => worker.normalizeStrategistResponseV2(f.prepared, empty, f.execution, now), /JSON schema/);
  const inferred = structuredClone(f.compact); inferred.marketComparisons[0].sellerBankCountry = 'NZ';
  assert.throws(() => worker.normalizeStrategistResponseV2(f.prepared, inferred, f.execution, now), /JSON schema/);
  assert.deepEqual(worker.normalizeStrategistResponseV2(f.prepared, f.compact, f.execution, now), f.assessment);
});
test('known bank country is pinned while an empty hypothetical scenario list remains valid', () => {
  const f = fixture(); f.context.sellerBankCountry = 'GB';
  for (const market of f.assessment.marketComparisons) { market.sellerBankCountry = 'GB'; market.feeScenarios = []; }
  const prepared = worker.prepareDiscoveryWorkerContextV2(f.intent, f.dossier, f.context, f.refs, now);
  const compact = worker.compactStrategistAssessmentV2(prepared, f.assessment);
  const market = worker.strategistResponseSchemaV2(prepared).properties.marketComparisons.items.properties;
  assert.equal(market.sellerBankCountry.const, 'GB'); assert.equal(market.feeScenarios.minItems, 0);
  assert.deepEqual(worker.normalizeStrategistResponseV2(prepared, compact, f.execution, now), f.assessment);
  compact.marketComparisons[0].sellerBankCountry = null;
  assert.throws(() => worker.normalizeStrategistResponseV2(prepared, compact, f.execution, now), /JSON schema/);
});
test('dimension guidance survives projection and unsupported fact/strength combinations still fail', () => {
  const f = preparedFixture(), contract = worker.strategistResponseSchemaV2(f.prepared);
  const dimension = modelProvider.projectProviderJsonSchema(contract).properties.candidates.items.properties.dimensions.items.properties;
  assert.match(dimension.finding.description, /Without cited facts, finding must be uncertain/);
  assert.match(dimension.evidenceStrength.description, /none exactly when facts is empty/);
  assert.match(dimension.facts.description, /never add an unrelated citation/);
  assert.match(dimension.uncertainties.description, /At least one explicit uncertainty/);
  for (const mutate of [
    d => { d.evidenceStrength = 'none'; },
    d => { d.facts = []; },
    d => { d.facts = []; d.evidenceStrength = 'none'; d.finding = 'supported'; },
    d => { d.facts = []; d.evidenceStrength = 'none'; d.finding = 'unfavorable'; },
  ]) {
    const value = structuredClone(f.compact), d = value.candidates[0].dimensions.find(d => d.dimension === 'demand');
    mutate(d);
    assert.throws(() => worker.normalizeStrategistResponseV2(f.prepared, value, f.execution, now), /Unsupported finding cannot become evidence/);
  }
  const request = worker.buildStrategistRequestV2(f.prepared, now), input = JSON.parse(request.messages[1].content);
  assert.equal(input.dimensionConsistencyRules.length, 4);
  assert.match(input.dimensionConsistencyRules[0], /if and only if/);
  assert.deepEqual(input.evidence, f.prepared.evidencePool.map(({ key, quote, url, retrievedAt, expiresAt }) => ({ key, quote, url, retrievedAt, expiresAt })));
});
test('honest unsupported dimensions normalize to NME without invented facts or a design test', () => {
  const f = preparedFixture();
  for (const candidate of f.compact.candidates) for (const d of candidate.dimensions) {
    d.finding = 'uncertain'; d.evidenceStrength = 'none'; d.facts = []; d.hardFailure = false;
    d.uncertainties = [{ question: `What retained evidence supports this candidate's ${d.dimension}?`, blockingForTest: true,
      reason: 'No relevant fact is available for this dimension; resolve it before proposing this specific experiment.' }];
  }
  f.compact.recommendation.proposedOutcome = 'NEEDS_MORE_EVIDENCE'; f.compact.testPlan = null;
  const assessment = worker.normalizeStrategistResponseV2(f.prepared, f.compact, f.execution, now);
  assert.equal(assessment.recommendation.proposedOutcome, 'NEEDS_MORE_EVIDENCE'); assert.equal(assessment.testPlan, null);
  assert.ok(assessment.candidates.every(c => c.dimensions.every(d => d.finding === 'uncertain' && d.evidenceStrength === 'none' && d.facts.length === 0)));
  const missing = structuredClone(f.compact); missing.candidates[0].dimensions[0].uncertainties = [];
  assert.throws(() => worker.normalizeStrategistResponseV2(f.prepared, missing, f.execution, now), /retain explicit uncertainty/);
  assert.equal(assessment.commerceAllowed, false); assert.equal(assessment.publicationAllowed, false);
});
test('compact independent reviewer preserves all unanswered questions and binds actual distinct execution', () => {
  const f = preparedFixture(), response = compactReview(f);
  response.additionalUncertainties.push({dimension:'production_complexity',question:'Which observed shipping service meets this target market delivery promise?',blockingForTest:false,reason:'Actual commercial delivery promises are outside this private original-design learning test.'});
  const review = worker.normalizeReviewerResponseV2(f.prepared, f.assessment, response, { strategist: f.execution, reviewer: f.reviewExecution }, now);
  assert.ok(f.assessment.missingQuestions.every(q => review.missingQuestions.includes(q)));
  assert.ok(review.missingQuestions.includes(response.additionalUncertainties[0].question));
  assert.equal(review.assessmentHash, v2.discoveryV2Hash(f.assessment));
  assert.equal(review.execution.modelId, 'anthropic/claude-haiku-4.5');
  assert.throws(() => worker.normalizeReviewerResponseV2(f.prepared, f.assessment, response, { strategist: f.execution, reviewer: f.execution }, now), /execution receipt/);
});
test('complete live-shaped requests fit existing phase bounds without raising caps or copying whole evidence packs', () => {
  const f = preparedFixture();
  const strategy = worker.buildStrategistRequestV2(f.prepared, now), review = worker.buildReviewerRequestV2(f.prepared, f.assessment, f.execution, now);
  assert.equal(strategy.maxOutputTokens, 5000); assert.equal(review.maxOutputTokens, 4000);
  assert.equal(strategy.model.providerModelId, 'openai/gpt-5.6-luna'); assert.equal(review.model.providerModelId, 'anthropic/claude-haiku-4.5');
  assert.deepEqual(review.providerOnly, ['anthropic']); assert.equal(review.requireReturnedModel, true);
  assert.ok(Buffer.byteLength(JSON.stringify(strategy)) <= 32768);
  assert.ok(Buffer.byteLength(JSON.stringify(review)) <= 32768);
  assert.ok(!review.messages[1].content.includes('Synthetic 🏕️ catalog preamble'));
  assert.match(review.messages[1].content, /June 2026/);
  assert.ok(Buffer.byteLength(JSON.stringify(f.compact)) < Buffer.byteLength(JSON.stringify(f.assessment)));
});
test('fabricated short refs, foreign candidates, missing dimension, extra scores and partial geography fail before acceptance', () => {
  for (const mutate of [c => { c.candidates[0].dimensions[0].facts[0].evidence = 'E999'; }, c => { c.candidates[0].candidateKey = 'C999'; }, c => { c.candidates[0].dimensions.pop(); }, c => { c.candidates[0].dimensions[0].score = 5; }, c => { c.marketComparisons.pop(); }, c => { c.execution = { modelId: 'model-supplied-receipt' }; }]) {
    const f = preparedFixture(); mutate(f.compact); assert.throws(() => worker.normalizeStrategistResponseV2(f.prepared, f.compact, f.execution, now));
  }
});
test('duplicate dimensions are rejected even when schema array length remains nine', () => {
  const f = preparedFixture(); f.compact.candidates[0].dimensions[1] = structuredClone(f.compact.candidates[0].dimensions[0]);
  assert.throws(() => worker.normalizeStrategistResponseV2(f.prepared, f.compact, f.execution, now), /every dimension/);
});
test('model cannot insert authority or silently convert NME into an experiment', () => {
  const f = preparedFixture(); f.compact.recommendation.proposedOutcome = 'NEEDS_MORE_EVIDENCE'; f.compact.testPlan = null;
  const assessment = worker.normalizeStrategistResponseV2(f.prepared, f.compact, f.execution, now);
  assert.throws(() => worker.normalizeReviewerResponseV2(f.prepared, assessment, compactReview(f), { strategist: f.execution, reviewer: f.reviewExecution }, now), /auto-convert/);
  const g = preparedFixture(); g.compact.testPlan.publicationAllowed = true;
  assert.throws(() => worker.normalizeStrategistResponseV2(g.prepared, g.compact, g.execution, now), /JSON schema/);
});
test('prepared context is snapshot-isolated and tampered pools/expired sources stop before building requests', () => {
  const f = preparedFixture(); f.intent.objective = 'External caller altered its original object after context preparation.';
  worker.buildStrategistRequestV2(f.prepared, now);
  f.prepared.evidencePool[0].quote = 'Fabricated fact inserted after pool binding';
  assert.throws(() => worker.buildStrategistRequestV2(f.prepared, now), /changed/);
  const g = preparedFixture(); assert.throws(() => worker.buildStrategistRequestV2(g.prepared, now + 24 * 3600000), /expired|stale/);
});
test('oversized complete reviewer context is rejected without silent truncation', () => {
  const f = preparedFixture();
  // Keep the persisted assessment inside its storage cap, but exceed the unchanged request cap.
  for (const c of f.assessment.candidates) for (const d of c.dimensions) {
    d.rationale = 'A'.repeat(440);
    for (const u of d.uncertainties) u.reason = 'B'.repeat(295);
  }
  for (const m of f.assessment.marketComparisons) { m.assessment = 'C'.repeat(1150); m.assumptions = ['D'.repeat(590), 'E'.repeat(590)]; }
  const before = JSON.stringify(f.assessment);
  assert.throws(() => worker.buildReviewerRequestV2(f.prepared, f.assessment, f.execution, now), /snapshot|byte bound/);
  assert.equal(JSON.stringify(f.assessment), before);
});

test('three complete concept alternatives and four geographies fit the unchanged compact request bounds', () => {
  const f = threeCandidateFixture();
  const prepared = worker.prepareDiscoveryWorkerContextV2(f.intent, f.dossier, f.context, f.refs, now);
  const compact = worker.compactStrategistAssessmentV2(prepared, f.assessment);
  const restored = worker.normalizeStrategistResponseV2(prepared, compact, f.execution, now);
  assert.equal(restored.candidates.length, 3); assert.ok(restored.candidates.every(c => c.dimensions.length === 9));
  const request = worker.buildReviewerRequestV2(prepared, restored, f.execution, now);
  assert.ok(Buffer.byteLength(JSON.stringify(request), 'utf8') <= 32768);
  assert.equal(request.maxOutputTokens, 4000);
  const encoded = JSON.parse(request.messages[1].content).assessment;
  const restoredCompact = { ...encoded, candidates: encoded.candidates.map(c => ({ candidateKey: c.candidateKey, dimensions: c.dimensions.map(row => {
    const d = Object.fromEntries(encoded.rowEncoding.dimensions.map((name, i) => [name, row[i]]));
    d.facts = d.facts.map(row => Object.fromEntries(encoded.rowEncoding.facts.map((name, i) => [name, row[i]])));
    d.uncertainties = d.uncertainties.map(row => Object.fromEntries(encoded.rowEncoding.uncertainties.map((name, i) => [name, row[i]])));
    return d;
  }) })) };
  delete restoredCompact.rowEncoding;
  assert.deepEqual(restoredCompact, compact, 'every assessment fact, rationale, flag and uncertainty survives row encoding');
});

test('three-candidate normalized evidence can exceed 32 KiB while the complete review request stays bounded and lossless', () => {
  const f = threeCandidateFixture();
  const extraRefs = f.refs.map(ref => ({ ...ref, end: ref.end - 1 }));
  for (const market of f.assessment.marketComparisons) market.evidenceRefs.push(f.refs[0]);
  for (const candidate of f.assessment.candidates) for (const dimension of candidate.dimensions) {
    dimension.rationale = 'The source supports only a narrow, uncertain comparison.';
    if (dimension.facts.length) {
      const index = f.refs.findIndex(ref => v2.discoveryV2Hash(ref) === v2.discoveryV2Hash(dimension.facts[0].reference));
      dimension.facts[0].relevance = 'This source offers limited context for the stated comparison.';
      dimension.facts.push({ reference: extraRefs[index], relevance: 'This span does not establish candidate sales or viability.' });
    }
    for (const uncertainty of dimension.uncertainties) uncertainty.reason = 'This private visual test cannot resolve commercial demand; retain the question for any later launch.';
  }
  const prepared = worker.prepareDiscoveryWorkerContextV2(f.intent, f.dossier, f.context, [...f.refs, ...extraRefs], now);
  const compact = worker.compactStrategistAssessmentV2(prepared, f.assessment);
  const before = JSON.stringify(compact);
  const restored = worker.normalizeStrategistResponseV2(prepared, compact, f.execution, now);
  const bytes = v2.discoveryV2SnapshotByteLength(restored);
  assert.ok(Buffer.byteLength(JSON.stringify(restored), 'utf8') > 32768, 'the old application snapshot gate also rejected this complete assessment');
  assert.ok(bytes > 32768, `Expanded snapshot must reproduce the old storage failure, got ${bytes}`);
  assert.ok(bytes <= 65536);
  assert.deepEqual(restored, f.assessment);
  assert.equal(JSON.stringify(compact), before);
  const request = worker.buildReviewerRequestV2(prepared, restored, f.execution, now);
  assert.ok(Buffer.byteLength(JSON.stringify(request), 'utf8') <= 32768);
  assert.equal(request.maxOutputTokens, 4000);
  const input = JSON.parse(request.messages[1].content);
  assert.deepEqual(input.assessment, worker.tabulateStrategistAssessmentV2(compact));
  assert.deepEqual(input.missingQuestions, restored.missingQuestions);
  assert.deepEqual(input.evidence, prepared.evidencePool.map(({ key, quote, url, retrievedAt, expiresAt }) => ({ key, quote, url, retrievedAt, expiresAt })));
});

test('review schema and projected provider schema pin the exact recommendation for every outcome', () => {
  const f = preparedFixture(), contract = worker.reviewerResponseSchemaV2(f.prepared, f.assessment);
  const projected = modelProvider.projectProviderJsonSchema(contract);
  assert.equal(contract.properties.candidateKey.const, 'C1');
  assert.equal(contract.properties.marketCountryCode.const, 'US');
  assert.deepEqual(projected.properties.candidateKey.enum, ['C1']);
  assert.deepEqual(projected.properties.marketCountryCode.enum, ['US']);
  assert.equal(contract.properties.dimensions.minItems, 9); assert.equal(contract.properties.dimensions.maxItems, 9);
  const request = worker.buildReviewerRequestV2(f.prepared, f.assessment, f.execution, now);
  assert.deepEqual(request.outputSchema, contract);
  assert.deepEqual(JSON.parse(request.messages[1].content).reviewScope, { candidateKey: 'C1', marketCountryCode: 'US' });
  assert.match(request.messages[0].content, /disagree by changing the outcome/);
  for (const outcome of ['TEST', 'REJECT', 'NEEDS_MORE_EVIDENCE']) {
    const response = { ...compactReview(f), outcome };
    assert.equal(worker.normalizeReviewerResponseV2(f.prepared, f.assessment, response, { strategist: f.execution, reviewer: f.reviewExecution }, now).outcome, outcome);
    for (const changed of [{ candidateKey: 'C2' }, { candidateKey: null }, { marketCountryCode: 'GB' }, { marketCountryCode: null }, { dimensions: [] }]) {
      assert.throws(() => worker.normalizeReviewerResponseV2(f.prepared, f.assessment, { ...response, ...changed }, { strategist: f.execution, reviewer: f.reviewExecution }, now), /JSON schema/);
    }
  }
});

test('review binding follows a nonfirst selected candidate and handles an explicitly unselected recommendation', () => {
  const f = preparedFixture(), candidateId = f.dossier.shortlist[1].id;
  f.assessment.recommendation.candidateId = candidateId;
  f.assessment.recommendation.marketCountryCode = 'GB';
  f.assessment.recommendation.alternatives[0].candidateId = f.candidate.id;
  f.review.candidateId = candidateId; f.review.marketCountryCode = 'GB';
  const selected = worker.reviewerResponseSchemaV2(f.prepared, f.assessment);
  assert.equal(selected.properties.candidateKey.const, 'C2'); assert.equal(selected.properties.marketCountryCode.const, 'GB');
  worker.normalizeReviewerResponseV2(f.prepared, f.assessment, compactReview(f), { strategist: f.execution, reviewer: f.reviewExecution }, now);
  f.assessment.recommendation.proposedOutcome = 'NEEDS_MORE_EVIDENCE';
  f.assessment.recommendation.candidateId = null; f.assessment.recommendation.marketCountryCode = null; f.assessment.testPlan = null;
  f.assessment.recommendation.alternatives.push({ candidateId, rationale: prose, evidenceRefs: [f.refs[0]] });
  const contract = worker.reviewerResponseSchemaV2(f.prepared, f.assessment), projected = modelProvider.projectProviderJsonSchema(contract);
  assert.equal(contract.properties.candidateKey.const, null); assert.equal(contract.properties.marketCountryCode.const, null);
  assert.deepEqual(projected.properties.candidateKey.enum, [null]); assert.deepEqual(projected.properties.marketCountryCode.enum, [null]);
  assert.equal(contract.properties.dimensions.minItems, 0); assert.equal(contract.properties.dimensions.maxItems, 0);
  const response = { ...compactReview(f), candidateKey: null, marketCountryCode: null, dimensions: [], outcome: 'NEEDS_MORE_EVIDENCE' };
  const review = worker.normalizeReviewerResponseV2(f.prepared, f.assessment, response, { strategist: f.execution, reviewer: f.reviewExecution }, now);
  assert.equal(review.candidateId, null); assert.deepEqual(review.missingQuestions, f.assessment.missingQuestions);
  assert.throws(() => worker.normalizeReviewerResponseV2(f.prepared, f.assessment, { ...response, outcome: 'TEST' }, { strategist: f.execution, reviewer: f.reviewExecution }, now), /No candidate was selected/);
  assert.throws(() => schema.assertJsonSchemaValue(contract, { ...response, dimensions: compactReview(f).dimensions }), /JSON schema/);
});
test('new reviewer uncertainty cannot be appended to TEST without an explicit nonblocking reason', () => {
  const f = preparedFixture(), response = compactReview(f);
  response.additionalUncertainties.push({ dimension: 'production_complexity', question: 'Does this garment actually support the proposed image dimensions?', blockingForTest: true, reason: 'The print constraint must be resolved before this particular design test can be reviewed.' });
  assert.throws(() => worker.normalizeReviewerResponseV2(f.prepared, f.assessment, response, { strategist: f.execution, reviewer: f.reviewExecution }, now), /blocking/);
  response.outcome = 'NEEDS_MORE_EVIDENCE'; response.dimensions.find(d => d.dimension === 'production_complexity').verdict = 'blocking';
  const review = worker.normalizeReviewerResponseV2(f.prepared, f.assessment, response, { strategist: f.execution, reviewer: f.reviewExecution }, now);
  assert.ok(review.missingQuestions.includes(response.additionalUncertainties[0].question));
});

test('persisted pack schemas validate expanded artifacts while compact schemas reject model-supplied execution metadata', () => {
  const f = preparedFixture();
  schema.assertJsonSchemaValue(worker.STRATEGIST_ASSESSMENT_V2_SCHEMA, f.assessment, 'persisted strategist');
  schema.assertJsonSchemaValue(worker.REVIEWER_DECISION_V2_SCHEMA, f.review, 'persisted reviewer');
  for (const [contract, value] of [[worker.STRATEGIST_ASSESSMENT_V2_SCHEMA, f.assessment], [worker.REVIEWER_DECISION_V2_SCHEMA, f.review]]) {
    const extra = structuredClone(value); extra.unknownAuthority = true;
    assert.throws(() => schema.assertJsonSchemaValue(contract, extra, 'extra field'));
    const wrongModel = structuredClone(value); wrongModel.execution.modelId = 'unapproved/model';
    assert.throws(() => schema.assertJsonSchemaValue(contract, wrongModel, 'wrong model'));
  }
  const nested = structuredClone(f.assessment); nested.candidates[0].dimensions[0].facts[0].reference.quote = 'Model-invented text';
  assert.throws(() => schema.assertJsonSchemaValue(worker.STRATEGIST_ASSESSMENT_V2_SCHEMA, nested, 'nested extra'));
  const compact = structuredClone(f.compact); compact.execution = f.execution;
  assert.throws(() => schema.assertJsonSchemaValue(worker.strategistResponseSchemaV2(f.prepared), compact, 'model metadata'));
});

test('normalizers attach nonauthorizing proposal/prerequisite fields and forbid model-authored spend or generation grants', () => {
  const f = preparedFixture();
  const assessment = worker.normalizeStrategistResponseV2(f.prepared, f.compact, f.execution, now);
  assert.equal(assessment.testPlan.budgetStatus, 'proposal_only');
  assert.equal(assessment.testPlan.spendingAuthorized, false); assert.equal(assessment.testPlan.generationAuthorized, false);
  assert.ok(!('budgetStatus' in f.compact.testPlan));
  for (const field of ['spendingAuthorized', 'generationAuthorized', 'budgetStatus']) {
    const response = structuredClone(f.compact); response.testPlan[field] = field === 'budgetStatus' ? 'approved' : true;
    assert.throws(() => worker.normalizeStrategistResponseV2(f.prepared, response, f.execution, now), /JSON schema/);
  }
  const response = compactReview(f); response.executionPrerequisites = { ...v2.DISCOVERY_V2_EXECUTION_PREREQUISITES, ownerCreativeApproval: 'satisfied' };
  assert.throws(() => worker.normalizeReviewerResponseV2(f.prepared, assessment, response, { strategist: f.execution, reviewer: f.reviewExecution }, now), /JSON schema/);
  const review = worker.normalizeReviewerResponseV2(f.prepared, assessment, compactReview(f), { strategist: f.execution, reviewer: f.reviewExecution }, now);
  assert.deepEqual(review.executionPrerequisites, v2.DISCOVERY_V2_EXECUTION_PREREQUISITES);
});
test('worker context distinguishes research money from a separately approved future-test proposal', () => {
  const f = fixture(); f.context.ownerRightsConfirmedCandidateIds = []; f.context.committedMicrousd = f.intent.limits.maximumMicrousd;
  const prepared = worker.prepareDiscoveryWorkerContextV2(f.intent, f.dossier, f.context, f.refs, now);
  const request = worker.buildStrategistRequestV2(prepared, now), context = JSON.parse(request.messages[1].content);
  assert.equal(context.remainingResearchMicrousd, 0); assert.ok(!('remainingMicrousd' in context));
  assert.equal(context.futureTestProposal.budgetStatus, 'proposal_only');
  const compact = worker.compactStrategistAssessmentV2(prepared, f.assessment);
  const assessment = worker.normalizeStrategistResponseV2(prepared, compact, f.execution, now);
  const response = compactReview({ ...f, prepared });
  const review = worker.normalizeReviewerResponseV2(prepared, assessment, response, { strategist: f.execution, reviewer: f.reviewExecution }, now);
  assert.equal(review.outcome, 'TEST');
  assert.equal(review.executionPrerequisites.ownerCreativeApproval, 'required');
});

test('both complete worker requests carry actual pinned knowledge, exact guidelines and remaining source caveats', () => {
  const f = preparedFixture();
  for (const request of [worker.buildStrategistRequestV2(f.prepared, now), worker.buildReviewerRequestV2(f.prepared, f.assessment, f.execution, now)]) {
    const input = JSON.parse(request.messages[1].content);
    assert.deepEqual(input.scopedKnowledge.knowledge.map(k => k.key), knowledge.DISCOVERY_KNOWLEDGE_KEYS_V2);
    assert.ok(input.scopedKnowledge.knowledge.every(k => k.guidelines.length && k.limitations.length));
    assert.ok(input.scopedKnowledge.knowledge.some(k => k.sourceDateAnomaly?.excludedSourceUrls.length));
    assert.ok(input.scopedKnowledge.knowledge.flatMap(k => k.guidelines).some(g => g.ref.endsWith(':engagement-not-sales')));
    assert.ok(!request.messages[1].content.includes('"manifestHash"'));
    assert.ok(Buffer.byteLength(JSON.stringify(request), 'utf8') <= 32768);
  }
  const before = f.prepared.bindingHash;
  f.prepared.validation.knowledge.records[0].contentHash = 'a'.repeat(64);
  assert.throws(() => worker.buildStrategistRequestV2(f.prepared, now), /knowledge hash|context changed/);
  assert.equal(f.prepared.bindingHash, before);
});
test('shared output guide traverses nullable anyOf and oneOf with numeric, string, item and pattern bounds', () => {
  const contract = { type: 'object', properties: { optional: { anyOf: [{ type: 'null' }, { type: 'object', properties: { label: { type: 'string', minLength: 3, maxLength: 20, pattern: '^[A-Z]+$' }, cost: { type: 'integer', minimum: 1, maximum: 10 } } }] }, choice: { oneOf: [{ type: 'null' }, { type: 'array', minItems: 1, maxItems: 2, uniqueItems: true, items: { type: 'string', maxLength: 5 } }] } } };
  const guide = limits.workerOutputLimits(contract);
  assert.match(guide, /optional: null allowed/); assert.match(guide, /optional.label: 3–20 characters/);
  assert.match(guide, /optional.label: pattern/); assert.match(guide, /optional.cost: value >= 1/); assert.match(guide, /optional.cost: value <= 10/);
  assert.match(guide, /choice: 1–2 items/); assert.match(guide, /choice\[\]: at most 5 characters/);
  assert.equal(creativeLimits.creativeOutputLimits(contract), guide);
});
test('actual provider-projected request still transports complete output limits and knowledge in prompt', async () => {
  const f = preparedFixture(), request = worker.buildStrategistRequestV2(f.prepared, now), sent = [];
  const adapter = new modelProvider.OpenRouterAdapter({ config: { apiKey: 'test-only', baseUrl: 'https://openrouter.ai/api/v1', appUrl: 'https://example.com', appName: 'contract test' }, fetcher: async (_url, options) => {
    sent.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ id: 'provider-contract-response', model: request.model.providerModelId, provider: 'OpenAI', choices: [{ message: { content: '{}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0 } }), { status: 200 });
  } });
  // The transport fixture may not provide every real routing metadata field; inspect its actual outbound payload either way.
  await adapter.invokeStructured(request).catch(() => undefined);
  assert.equal(sent.length, 1);
  const projected = JSON.stringify(sent[0].response_format.json_schema.schema);
  assert.ok(!projected.includes('minLength')); assert.ok(!projected.includes('maxItems')); assert.ok(!projected.includes('\"maximum\":'));
  const input = JSON.parse(sent[0].messages[1].content);
  assert.equal(input.outputLimits, limits.workerOutputLimits(request.outputSchema));
  assert.match(input.outputLimits, /testPlan: null allowed/);
  assert.match(input.outputLimits, /testPlan.name: 10–120 characters/);
  assert.match(input.outputLimits, /testPlan.maximumMicrousd: value <= 1000000/);
  assert.equal(input.scopedKnowledge.knowledge.length, 4);
  assert.ok(Buffer.byteLength(JSON.stringify(request), 'utf8') <= 32768);
});

test('research phase receives the full guidance-only evidence guide from the same validated closure', () => {
  const f = preparedFixture(), projected = knowledge.buildDiscoveryKnowledgeContextV2(f.prepared.validation.knowledge, 'research', now);
  assert.equal(projected.knowledge.length, 1); assert.equal(projected.knowledge[0].key, 'research.evidence-guide');
  const original = f.prepared.validation.knowledge.snapshot.releases.flatMap(r => r.manifest.knowledge).find(k => k.key === 'research.evidence-guide');
  assert.equal(projected.knowledge[0].guidance, original.content.guidance);
  assert.equal(projected.knowledge[0].source, original.source);
  assert.equal(projected.knowledge[0].version, original.version);
  assert.equal(projected.knowledge[0].verifiedAt, original.verifiedAt);
});

test('review rationale character guidance survives provider projection and overlength output remains rejected',()=>{
 const f=preparedFixture(),contract=worker.reviewerResponseSchemaV2(f.prepared,f.assessment),projected=modelProvider.projectProviderJsonSchema(contract);
 for(const field of ['dimensions','checks']){
  assert.equal(contract.properties[field].items.properties.rationale.maxLength,240);
  assert.match(projected.properties[field].items.properties.rationale.description,/30–240 characters including spaces/);
  const response=compactReview(f);response[field][0].rationale='x'.repeat(241);
  assert.throws(()=>schema.assertJsonSchemaValue(contract,response,'Compact reviewer response'),error=>error.issues.some(issue=>issue.path===`$.${field}[0].rationale`&&/no more than 240/.test(issue.message)));
 }
});
