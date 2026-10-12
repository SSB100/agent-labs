// Current-source, synthetic profile contracts. No provider, database, grant or real market evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { source } from './helpers/r12-pod-owner-ui-fixture.mjs';

const modules = new Map();
const load = file => source(file, {}, {}, modules);
const { POD_THOROUGH_PROFILE, POD_THOROUGH_GOAL_VERSION, POD_THOROUGH_LIMITS: limits,
  assertPodArtifactBytes, podEmbeddedJsonBytes, isPodThoroughScope, isPodThoroughRequest } = load('products/discovery-r12-pod-profile');
const { podResearchSchema, POD_DIMENSIONS, POD_REVIEW_CHECKS, validatePodAssessment, validatePodReview,
  podEvidenceView } = load('products/discovery-r12-pod-analysis');
const { POD_GOAL_BOUNDS, acceptPodResearchPlan, validatePodResearchCitationUrl } = load('products/discovery-r12-pod-goal');
const { publicResearchHash: hash } = load('research/qualification');
const { validateJsonSchemaValue } = load('workers/schema-validator');
const { workerOutputLimits } = load('workers/output-limits');
const clone = structuredClone;
const id = n => `12130000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = Date.parse('2026-10-12T20:00:00.000Z');
const stamp = offset => new Date(now + offset).toISOString();
const sha = text => createHash('sha256').update(text).digest('hex');
const prose = (length, phrase = 'Synthetic evidence describes an unresolved buyer need; independent demand and delivered economics remain unmeasured. ') => phrase.repeat(Math.ceil(length / phrase.length)).slice(0, length - 1) + '.';
const bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');

// Frozen before the new profile was implemented: exact historical local/provider/prompt/limit pins.
const LEGACY_PINS = {
  plan: { localHash: 'db511d623c6a20f26bf6373da878fe3eb51ce1ff0bec49df1df615334773fee0', wireHash: '7285b4d7f376da6477bc4a775ca7c62d0d776f591dbb1af7b9ca67ecbf049e23', systemHash: 'dca90b45d3e6447dc2362ffece8cf3c832440c7f3feef9a0a846b822e9155eae', outputLimitsHash: 'f9822307667d944c4632629070b391af3ddbdd31333cd30d2129c74e1471c1fc' },
  select1: { localHash: 'e1bedf858d2286df3a2007c6a17040eb4c2e42ef8f92c445979be74f02e3a39c', wireHash: '8ecda611f97e9ad9fb515c985be2eb93cdc1dd034d6e758760e888449d8a5cc9', systemHash: '32bd2898237eeebe2bf336d781d71ff5f4b49e0a6aea573da824458a66d6fc5e', outputLimitsHash: '4b5a8ff30291331a54bd9e904b47d8ecd79352763f41288ecf63bc9bd95deab8' },
  strategy: { localHash: '5637450bf3f525d396db3ea3e11127169581d1fdd213d6d86d52806e049c3fcf', wireHash: '6ad11c598ea4c0a6406eb806a4aa91fd9898b7da111d64a644c4bedc0021b10b', systemHash: '9b4f35933e4844b8af36be3f2aae308316c5ba11281cf4c88545923b9e421345', outputLimitsHash: '854c04dc83791f19e21898cfb58971748095bc8a7777b6729250d47c58f11ee4' },
  review: { localHash: '795c08c2b1b8e44deeb6324da82dc6e2c4af46b6d481caef0bbcb221764b1d53', wireHash: '6993a7b5ceb1e8f05557f363e3980333a18653573b48931f7f4a29c8bad29c65', systemHash: 'ee0aa296907f272bb27f941e6d099d1ae9109700cc3dc5ddd0b5c72a086f4103', outputLimitsHash: 'b8ac46e0861b3a657e4803a41ce62213aa4cb0f78d0a67adc2e7ddfb51bd501b' },
};

function fixture() {
  // Domain-validator input only. All 48 claims have exact, hash-linked synthetic spans.
  const quotes = Array.from({ length: 48 }, (_, i) => `Synthetic observation ${i + 1}: an unmeasured hypothesis is not proof of demand or profitable fulfilment.`);
  const excerpt = quotes.join(' '), contentHash = sha(excerpt), sourceId = `src-${sha('inert:' + contentHash).slice(0, 24)}`;
  const source = { id: sourceId, url: 'https://example.org/inert-study', title: 'Synthetic technical fixture only', retrievedAt: stamp(0), publishedAt: null,
    retrievalExpiresAt: stamp(86400000), contentHash, excerpt, provider: 'openrouter.exa' };
  const evidence = quotes.map(quote => ({ id: `evi-${sha(`${sourceId}:${quote}`).slice(0, 24)}`, sourceId, quote }));
  const pack = { evidencePackVersion: '1.0', question: 'Synthetic technical evidence, not a commercial recommendation.', sources: [source], evidence,
    claims: evidence.map(e => ({ text: e.quote, evidenceId: e.id, sourceId: e.sourceId })), limitations: ['no_sales_metrics'] };
  const assessment = { explorationSummary: prose(160), candidates: [{ productType: 'Unproven printed object', niche: 'Synthetic research niche', audience: 'Unmeasured synthetic audience',
    rationale: prose(160), support: ['E1'], counterevidence: ['E2'], alternativeExplanation: prose(120),
    dimensions: POD_DIMENSIONS.map(dimension => ({ dimension, verdict: 'uncertain', rationale: prose(100), evidence: ['E1'], missing: [prose(60)] })) }],
    recommendation: { outcome: 'INSUFFICIENT_EVIDENCE', candidateIndex: null, rationale: prose(160), nextTest: prose(120) }, limitations: [prose(100)], etsyDemandVerified: false, commercialViabilityVerified: false };
  const review = { outcome: 'INSUFFICIENT_EVIDENCE', candidateIndex: null, rationale: prose(160),
    checks: POD_REVIEW_CHECKS.map(check => ({ check, verdict: 'FAIL', rationale: prose(100), evidence: ['E1'] })),
    missingEvidence: [prose(100)], nextTest: prose(120), etsyDemandVerified: false, commercialViabilityVerified: false };
  return { pack, assessment, review };
}
function scope(version = POD_THOROUGH_GOAL_VERSION) {
  const policy = { version: 'r12.pod-source-policy.1', reviewId: id(9), method: 'openrouter_exa_factual_snippets', purpose: 'public_pod_market_research',
    excludedDomains: ['etsy.com', 'etsy.me', 'etsystatic.com'], restrictionsRevision: '1'.repeat(64), termsReviewHash: '2'.repeat(64), independentReviewHash: '3'.repeat(64),
    recipients: { router: 'openrouter.ai', search: 'exa.ai', researcher: 'azure/us', reviewer: 'amazon-bedrock/us' },
    retention: { inference: 'no_training_zdr', search: 'query_retention_improvement_training_possible', application: 'bounded_attributed_audit_evidence' }, validFrom: stamp(-60000), validUntil: stamp(86400000) };
  return { version, id: id(1), businessId: id(2), businessRevision: 1, businessHash: '4'.repeat(64), goalId: id(3), goalRevision: 2, goalHash: '5'.repeat(64),
    setupId: id(4), setupHash: '6'.repeat(64), authorityRootId: id(2), publicBrief: { objective: 'Research viable print-on-demand products to sell on Etsy.', publicConstraints: [], fulfilmentContext: 'unspecified' },
    sourcePolicy: policy, sourcePolicyHash: hash(policy), approvalHash: '7'.repeat(64), maximumMicrousd: 10000000, createdAt: stamp(-1000), expiresAt: stamp(1500000) };
}
function plan() {
  return { comparisonRationale: prose(8000), query: prose(4000), sourceDomains: Array.from({ length: 16 }, (_, i) => `source${i + 1}.org`), sourceChoiceRationale: prose(8000),
    hypotheses: Array.from({ length: 16 }, (_, i) => ({ productType: `Unproven printed object ${i + 1}`, niche: `Synthetic niche ${i + 1}`, audience: 'Unmeasured synthetic audience', hypothesis: prose(700), contraryExplanation: prose(700) })) };
}

test('thorough profile expands per-phase space but retains five passes, 25 calls and five searches', () => {
  assert.equal(POD_THOROUGH_PROFILE, 'r12.pod-thorough.1'); assert.equal(POD_THOROUGH_GOAL_VERSION, 'r12.pod-research-goal.3');
  assert.deepEqual(POD_GOAL_BOUNDS, { maximumPasses: 5, maximumCalls: 25, maximumCollections: 5, maximumWorkingHypotheses: 3, maximumDomains: 6, maximumResults: 4, maximumExcerptCharacters: 1800, maximumQueryCharacters: 800 });
  for (const [key, value] of Object.entries({ maximumPasses: 5, maximumCalls: 25, maximumCollections: 5, maximumWorkingHypotheses: 16, maximumDomains: 16, maximumResults: 100, maximumWebSearchResults: 25,
    maximumExcerptCharacters: 8000, maximumQueryCharacters: 4000, maximumQuotes: 48, maximumQuoteCharacters: 2400, maximumResponseBytes: 2097152 })) assert.equal(limits[key], value, key);
  assert.deepEqual(limits.phases, {
    plan: { maximumRequestBytes: 786432, outputTokens: 16000, maximumArtifactBytes: 262144 },
    search1: { maximumRequestBytes: 32768, outputTokens: 16000, maximumArtifactBytes: 1048576 },
    select1: { maximumRequestBytes: 786432, outputTokens: 16000, maximumArtifactBytes: 131072 },
    strategy: { maximumRequestBytes: 327680, outputTokens: 48000, maximumArtifactBytes: 262144 },
    review: { maximumRequestBytes: 155648, outputTokens: 32000, maximumArtifactBytes: 524288 },
  });
  assert.equal(isPodThoroughScope({ version: 'r12.pod-research-goal.2' }), false);
  assert.equal(isPodThoroughScope({ version: POD_THOROUGH_GOAL_VERSION }), true);
  assert.equal(isPodThoroughScope({ version: 'r12.pod-research-goal.4' }), false);
  assert.equal(isPodThoroughRequest({}), false);
  assert.equal(isPodThoroughRequest({ researchProfile: POD_THOROUGH_PROFILE }), true);
  assert.equal(isPodThoroughRequest({ requestMetadata: { r12PodProfile: POD_THOROUGH_PROFILE } }), true);
});

test('legacy schema bytes and all four legacy qualification pin sets remain unchanged', () => {
  const { podResearchSchemaPins } = load('products/discovery-r12-pod-runtime');
  assert.deepEqual(podResearchSchemaPins(), LEGACY_PINS);
  assert.deepEqual(podResearchSchemaPins(false, false), LEGACY_PINS);
  for (const phase of Object.keys(LEGACY_PINS)) {
    assert.equal(hash(podResearchSchema(phase)), LEGACY_PINS[phase].localHash);
    assert.notEqual(hash(podResearchSchema(phase, true)), LEGACY_PINS[phase].localHash);
    const owned = podResearchSchema(phase, true); owned.additionalProperties = true;
    assert.equal(podResearchSchema(phase, true).additionalProperties, false, 'schema callers cannot mutate later grants');
    assert.equal(hash(podResearchSchema(phase, false)), LEGACY_PINS[phase].localHash);
  }
});

test('the six size-faithful rejected-review fields are accepted only under the new explicit profile', () => {
  const { review, assessment, pack } = fixture();
  // Reproduce the observed sizes, without pretending synthetic prose is the paid-run transcript.
  for (const i of [1, 2, 3, 4, 5]) review.checks[i].rationale = prose(323);
  review.nextTest = prose(423);
  assert.equal(review.checks[1].rationale.length, 323); assert.equal(review.nextTest.length, 423);
  assert.deepEqual(validateJsonSchemaValue(podResearchSchema('review'), review).map(i => i.path), [1, 2, 3, 4, 5].map(i => `$.checks[${i}].rationale`).concat('$.nextTest'));
  const before = clone(review);
  assert.throws(() => validatePodReview(review, assessment, pack));
  assert.deepEqual(validatePodReview(review, assessment, pack, true), before);
  assert.deepEqual(review, before, 'larger allowance never truncates or rewrites the original response');
});

test('sixteen researched candidates and a substantial independent review fit the new aggregate budgets', () => {
  const { assessment, review, pack } = fixture();
  assessment.explorationSummary = prose(2500);
  assessment.candidates = Array.from({ length: 16 }, (_, i) => ({ ...clone(assessment.candidates[0]), productType: `Unproven printed object ${i + 1}`,
    rationale: prose(700), alternativeExplanation: prose(500), dimensions: assessment.candidates[0].dimensions.map(d => ({ ...clone(d), rationale: prose(300) })) }));
  assessment.recommendation.rationale = prose(1500); assessment.recommendation.nextTest = prose(1200);
  review.rationale = prose(4000); review.checks.forEach(c => { c.rationale = prose(1600); c.evidence = ['E1', 'E48']; });
  review.missingEvidence = [prose(1400), prose(1400)]; review.nextTest = prose(5000);
  assert.ok(bytes(assessment) < limits.phases.strategy.maximumArtifactBytes);
  assert.ok(bytes(review) < limits.phases.review.maximumArtifactBytes);
  assert.deepEqual(validatePodAssessment(assessment, pack, true), assessment);
  assert.deepEqual(validatePodReview(review, assessment, pack, true), review);
  assert.throws(() => validatePodAssessment(assessment, pack)); assert.throws(() => validatePodReview(review, assessment, pack));
  assert.equal(review.outcome, 'INSUFFICIENT_EVIDENCE'); assert.equal(review.candidateIndex, null);
});

test('new plan and exact-selection schemas expose their real bounded limits', () => {
  const proposal = plan(), before = clone(proposal), current = scope();
  assert.equal(validateJsonSchemaValue(podResearchSchema('plan', true), proposal).length, 0);
  const accepted = acceptPodResearchPlan(current, proposal, now);
  assert.equal(accepted.hypotheses.length, 16); assert.equal(accepted.sourceDomains.length, 16); assert.equal(accepted.query.length, 4000);
  assert.equal(accepted.scopeHash, hash(current)); assert.deepEqual(proposal, before);
  assert.throws(() => acceptPodResearchPlan(scope('r12.pod-research-goal.2'), proposal, now));
  for (const change of [p => p.query += 'x', p => p.sourceDomains.push('source17.org'), p => p.hypotheses.push(clone(p.hypotheses[0])),
    p => p.hypotheses[1] = clone(p.hypotheses[0]), p => p.sourceDomains[0] = 'etsy.com', p => p.sourceDomains[0] = '127.0.0.1',
    p => p.query = 'Contact private-owner@example.org to request confidential customer records.']) {
    const bad = clone(proposal); change(bad); assert.throws(() => acceptPodResearchPlan(current, bad, now));
  }
  const selection = { selections: Array.from({ length: 48 }, (_, i) => ({ sourceKey: `S${i % 100 + 1}`, quote: prose(2400) })), limitations: ['no_sales_metrics'] };
  assert.equal(validateJsonSchemaValue(podResearchSchema('select1', true), selection).length, 0);
  assert.ok(validateJsonSchemaValue(podResearchSchema('select1'), selection).length > 0);
  for (const change of [s => s.selections.push(clone(s.selections[0])), s => s.selections[0].quote += 'x', s => s.selections[0].sourceKey = 'S101', s => s.limitations.push('no_sales_metrics')]) {
    const bad = clone(selection); change(bad); assert.ok(validateJsonSchemaValue(podResearchSchema('select1', true), bad).length > 0);
  }
  assert.match(workerOutputLimits(podResearchSchema('review', true)), /checks\[\]\.rationale: 30–8000 characters/);
  assert.match(workerOutputLimits(podResearchSchema('review', true)), /nextTest: 40–12000 characters/);
});

test('larger text space preserves flags, verdicts, exact check coverage and available citations', () => {
  for (const change of [r => r.etsyDemandVerified = true, r => r.commercialViabilityVerified = true, r => r.executionAuthorized = true,
    r => r.outcome = 'VERIFIED_VIABLE', r => r.checks[0].verdict = 'MAYBE', r => r.checks[1].check = r.checks[0].check,
    r => r.checks[0].evidence = ['E49'], r => r.checks[0].evidence = ['E1', 'E1'], r => r.checks[0].evidence = ['P1E1'],
    r => r.candidateIndex = 0, r => r.missingEvidence = [], r => r.nextTest = prose(12001), r => r.checks[0].rationale = prose(8001)]) {
    const { review, assessment, pack } = fixture(); change(review); assert.throws(() => validatePodReview(review, assessment, pack, true));
  }
  for (const key of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    const { review, assessment, pack } = fixture();
    const hostile = JSON.parse(JSON.stringify(review).slice(0, -1) + `,"${key}":true}`);
    assert.throws(() => validatePodReview(hostile, assessment, pack, true));
  }
  for (const change of [a => a.etsyDemandVerified = true, a => a.commercialViabilityVerified = true,
    a => a.candidates[0].support = ['E49'], a => a.candidates[0].dimensions[1].dimension = a.candidates[0].dimensions[0].dimension,
    a => { a.candidates[0].dimensions[0].verdict = 'supported'; a.candidates[0].dimensions[0].evidence = []; }, a => a.candidates[0].dimensions[0].missing = []]) {
    const { assessment, pack } = fixture();
    change(assessment); assert.throws(() => validatePodAssessment(assessment, pack, true));
  }
  const { review, assessment, pack } = fixture(); review.outcome = 'HYPOTHESIS_TO_TEST'; review.candidateIndex = 0; review.checks.forEach(c => c.verdict = 'PASS');
  assert.throws(() => validatePodReview(review, assessment, pack, true), 'reviewer cannot upgrade an insufficient assessment');
  assessment.recommendation = { ...assessment.recommendation, outcome: 'HYPOTHESIS_TO_TEST', candidateIndex: 0 };
  assert.deepEqual(validatePodReview(review, assessment, pack, true), review);
  review.checks[0].verdict = 'FAIL'; assert.throws(() => validatePodReview(review, assessment, pack, true), 'one failed check prevents a positive result');
});

test('prior-pass reference syntax is separate from availability and current-pass evidence', () => {
  const { review, assessment, pack } = fixture(), prior = { ...podEvidenceView(pack)[0], key: 'P1E1' };
  review.checks[0].evidence = ['P1E1']; assessment.candidates[0].counterevidence = ['P1E1'];
  assert.throws(() => validatePodReview(review, assessment, pack, true));
  assert.deepEqual(validatePodReview(review, assessment, pack, true, [prior]), review);
  const allKeys = podResearchSchema('review', true).properties.checks.items.properties.evidence.items.enum;
  for (const key of ['E1', 'E48', 'P1E1', 'P5E48']) assert.ok(allKeys.includes(key));
  for (const key of ['E0', 'E49', 'P0E1', 'P6E1', 'P1E49']) assert.equal(allKeys.includes(key), false);
  const broken = clone(pack); broken.sources[0].excerpt += 'tampered';
  assert.throws(() => validatePodReview(review, assessment, broken, true, [prior]));
});

test('thorough profile retains HTTPS, approved-domain and sensitive-path citation guards', () => {
  const current = scope(), accepted = acceptPodResearchPlan(current, plan(), now);
  assert.equal(validatePodResearchCitationUrl('https://source1.org/research/study', accepted, current.sourcePolicy), 'https://source1.org/research/study');
  for (const url of ['http://source1.org/research', 'https://other.org/research', 'https://etsy.com/research', 'https://source1.org/account',
    'https://source1.org/research?api_key=hidden', 'https://owner:secret@source1.org/research', 'https://source1.org/%2561ccount'])
    assert.throws(() => validatePodResearchCitationUrl(url, accepted, current.sourcePolicy));
});

test('aggregate artifact limits count UTF-8 and JSON escaping, with exact boundary rejection', () => {
  for (const phase of ['plan', 'select1', 'review']) {
    const maximum = limits.phases[phase].maximumArtifactBytes;
    for (const glyph of ['x', '界', '🧵', '\n', '"', '\\']) {
      const cost = bytes(glyph) - 2, repeats = Math.floor((maximum - 2) / cost), remainder = maximum - 2 - repeats * cost;
      const atLimit = glyph.repeat(repeats) + 'x'.repeat(remainder);
      assert.equal(bytes(atLimit), maximum); assert.doesNotThrow(() => assertPodArtifactBytes(atLimit, phase));
      assert.throws(() => assertPodArtifactBytes(atLimit + 'x', phase), /r12_pod_artifact_capacity_exceeded/);
    }
  }
  const { review, assessment, pack } = fixture();
  review.checks.forEach(c => c.rationale = '\u0001'.repeat(8000));
  review.rationale = '\u0001'.repeat(16000); review.missingEvidence = Array.from({length:16}, () => '\u0001'.repeat(4000));
  assert.equal(validateJsonSchemaValue(podResearchSchema('review', true), review).length, 0, 'each field fits its declared character bound');
  assert.ok(bytes(review) > limits.phases.review.maximumArtifactBytes);
  assert.throws(() => validatePodReview(review, assessment, pack, true), /r12_pod_artifact_capacity_exceeded/);
});

function wireRequest(phase, content = '') {
  const { resolveModelRoute } = load('models/registry');
  const { routeDiscoveryR12Request } = load('products/discovery-r12-wire');
  const model = resolveModelRoute(phase === 'review' ? 'reviewer.independent' : 'standard.default').primary;
  const route = { modelId: model.providerModelId, endpoint: phase === 'review' ? 'amazon-bedrock/us' : 'azure/us', priceLimit: { prompt: 1, completion: 1, request: 0 } };
  const request = phase === 'search1'
    ? { model, query: prose(4000), allowedDomains: plan().sourceDomains, excludedDomains: scope().sourcePolicy.excludedDomains, researchProfile: POD_THOROUGH_PROFILE }
    : { model, messages: [{ role: 'system', content: 'Synthetic serialization trial; no external action.' }, { role: 'user', content }],
      schemaName: 'ignored_local_name', outputSchema: podResearchSchema(phase, true), maxOutputTokens: limits.phases[phase].outputTokens,
      requestMetadata: { r12PodProfile: POD_THOROUGH_PROFILE } };
  return { request: routeDiscoveryR12Request(request, phase, route, false, false, true, true), route };
}

test('real serializer honors each thorough UTF-8 request ceiling and exact output-token budget', async () => {
  const { inspectDiscoveryR12Wire } = load('products/discovery-r12-wire');
  for (const phase of ['plan', 'select1', 'strategy', 'review']) {
    const { request } = wireRequest(phase), maximum = limits.phases[phase].maximumRequestBytes;
    const base = await inspectDiscoveryR12Wire(request, phase, false, false, false, true, true);
    const overhead = Math.max(bytes(request), base.wireBytes);
    assert.equal(base.maximumOutputTokens, limits.phases[phase].outputTokens);
    const body = JSON.parse(base.wire.body);
    assert.equal(body.response_format.json_schema.name, `pod_research_${phase}_v2`);
    assert.equal(body.response_format.json_schema.strict, true);
    assert.equal(body.max_tokens, limits.phases[phase].outputTokens);
    assert.equal('tools' in body, false);
    assert.equal(body.provider.allow_fallbacks, false); assert.equal(body.provider.zdr, true);
    for (const glyph of ['x', '界', '🧵', '"', '\\', '\n']) {
      const unit = bytes(glyph) - 2, available = maximum - overhead;
      const atLimit = clone(request); atLimit.messages[1].content = glyph.repeat(Math.floor(available / unit)) + 'x'.repeat(available % unit);
      const inspected = await inspectDiscoveryR12Wire(atLimit, phase, false, false, false, true, true);
      assert.equal(Math.max(bytes(atLimit), inspected.wireBytes), maximum, `${phase}/${JSON.stringify(glyph)} exact limiting boundary`);
      assert.equal(inspected.wireBytes, Buffer.byteLength(inspected.wire.body, 'utf8'));
      assert.equal(JSON.parse(inspected.wire.body).messages[1].content, atLimit.messages[1].content, 'no silent clipping');
      const beyond = clone(atLimit); beyond.messages[1].content += 'x';
      await assert.rejects(inspectDiscoveryR12Wire(beyond, phase, false, false, false, true, true), /r12_discovery_wire_unavailable/);
    }
  }
});

test('thorough search serializes its 25-provider-result ceiling, 8000-character excerpts and sixteen domains with one tool call', async () => {
  const { inspectDiscoveryR12Wire } = load('products/discovery-r12-wire');
  const { request } = wireRequest('search1'), inspected = await inspectDiscoveryR12Wire(request, 'search1', false, false, false, true, true);
  const body = JSON.parse(inspected.wire.body), search = body.tools[0];
  assert.equal(search.type, 'openrouter:web_search');
  assert.equal(search.parameters.max_uses, 1); assert.equal(search.parameters.max_results, 25); assert.equal(search.parameters.max_total_results, 25);
  assert.equal(search.parameters.max_characters, 8000); assert.deepEqual(search.parameters.allowed_domains, request.allowedDomains);
  assert.equal(body.max_tool_calls, 1); assert.equal(body.max_tokens, 16000);
  assert.ok(inspected.wireBytes <= limits.phases.search1.maximumRequestBytes);
});

test('a profile marker cannot silently enlarge legacy or non-POD wire authority', async () => {
  const { routeDiscoveryR12Request, inspectDiscoveryR12Wire } = load('products/discovery-r12-wire');
  for (const phase of ['plan', 'search1', 'select1', 'strategy', 'review']) {
    const { request, route } = wireRequest(phase);
    assert.throws(() => routeDiscoveryR12Request(request, phase, route, false, false, true), /r12_discovery_wire_unavailable/);
    assert.throws(() => routeDiscoveryR12Request(request, phase, route, false, false, false, true), /r12_discovery_wire_unavailable/);
    await assert.rejects(inspectDiscoveryR12Wire(request, phase, false, false, false, true), /r12_discovery_wire_unavailable/);
    const unmarked = clone(request); delete unmarked.researchProfile; delete unmarked.requestMetadata?.r12PodProfile;
    assert.throws(() => routeDiscoveryR12Request(unmarked, phase, route, false, false, true, true), /r12_discovery_wire_unavailable/);
    const changed = clone(request); if (phase === 'search1') changed.researchProfile = 'r12.pod-thorough.unknown'; else changed.requestMetadata.r12PodProfile = 'r12.pod-thorough.unknown';
    await assert.rejects(inspectDiscoveryR12Wire(changed, phase, false, false, false, true, true), /r12_discovery_wire_unavailable/);
  }
});

function searchFixture(count = 25) {
  const request = { query: prose(4000), allowedDomains: plan().sourceDomains }, excludedDomains = scope().sourcePolicy.excludedDomains;
  const annotations = Array.from({ length: count }, (_, i) => ({ type: 'url_citation', url_citation: {
    url: `https://source${i % 16 + 1}.org/inert-study-${i + 1}`, title: `Synthetic study ${i + 1}; no actual market evidence`,
    content: ['a', 'b', 'c'].map((fill, n) => `Synthetic source ${i + 1}, distinct exact span ${n + 1}: `.padEnd(2400, fill)).join('') + 'd'.repeat(800),
  } }));
  const api = load('products/discovery-r12-pod-evidence');
  const normalized = api.normalizeThoroughPodSearch(annotations, { ...request, excludedDomains });
  const collection = api.extractThoroughPodSources(request, { annotations: normalized, metadata: {} }, stamp(0));
  return { api, request, excludedDomains, annotations, normalized, collection };
}

test('all 25 full highlights are retained while prompt omissions are explicit, whole and domain-balanced', () => {
  const { api, request, collection, normalized } = searchFixture(), before = clone(collection);
  assert.doesNotThrow(() => api.validateThoroughPodCollection(collection, request, now));
  assert.equal(collection.sources.length, 25);
  for (let i = 0; i < 25; i++) assert.equal(collection.sources[i].excerpt, normalized[i].url_citation.content);
  assert.equal(collection.sources.every(s => s.excerpt.length === 8000), true);
  const projection = api.podSourceProjection(collection, 150000);
  assert.ok(projection.sources.length < 25, 'full highlights exceed the separately bounded prompt projection');
  assert.equal(new Set(projection.sources.map(s => new URL(s.url).hostname)).size, 16);
  assert.equal(projection.coverage.available, 25); assert.equal(projection.coverage.retained, projection.sources.length);
  assert.equal(projection.coverage.omittedSourceIds.length, 25 - projection.sources.length);
  assert.equal(projection.coverage.fullPageRead, false); assert.equal(projection.coverage.localTruncation, false);
  for (const selected of projection.sources) {
    const stored = collection.sources[Number(selected.sourceKey.slice(1)) - 1];
    assert.equal(selected.id, stored.id); assert.equal(selected.excerpt, stored.excerpt);
  }
  assert.ok(api.podPromptBytes(projection) <= 150000); assert.deepEqual(collection, before);
});

test('48 exact 2400-character spans assemble without accepting invented, duplicated or omitted-source quotes', () => {
  const { api, request, collection } = searchFixture(16);
  const selections = collection.sources.flatMap((s, i) => [0, 2400, 4800].map(offset => ({ sourceKey: `S${i + 1}`, quote: s.excerpt.slice(offset, offset + 2400) })));
  const selection = { selections, limitations: ['no_sales_metrics'] }, before = clone(collection);
  const pack = api.assembleThoroughPodEvidence(collection, request, selection, now);
  assert.equal(pack.evidence.length, 48); assert.equal(pack.evidence.every(e => e.quote.length === 2400), true);
  assert.deepEqual(collection, before);
  const context = api.podCurrentEvidence(collection, pack, 0);
  assert.equal(context.items.at(-1).key, 'E48'); assert.ok(api.podPromptBytes(context) <= limits.maximumCurrentEvidenceBytes);
  for (const change of [s => s.selections[0].quote = 'An invented assertion that never appeared in the retained source.',
    s => s.selections[1] = clone(s.selections[0]), s => s.selections[0].quote += 'x', s => s.selections[0].sourceKey = 'S100',
    s => s.selections.push(clone(s.selections[0]))]) {
    const bad = clone(selection); change(bad); assert.throws(() => api.assembleThoroughPodEvidence(collection, request, bad, now));
  }
  const larger = searchFixture();
  // Multibyte highlights force real whole-source omissions under the selector cap.
  larger.annotations.forEach(a => { a.url_citation.content = a.url_citation.content.slice(0, 100) + '界'.repeat(7900); });
  larger.collection = api.extractThoroughPodSources(larger.request, { annotations: api.normalizeThoroughPodSearch(larger.annotations, {...larger.request, excludedDomains:larger.excludedDomains}), metadata:{} }, stamp(0));
  const baseSources=clone(larger.collection.sources);
  larger.collection.sources=Array.from({length:100},(_,i)=>{
    const original=baseSources[i%baseSources.length], url=original.url+`-stored-${i}`;
    return {...original,url,id:`src-${sha(url+':'+original.contentHash).slice(0,24)}`};
  });
  const projection = api.podSourceProjection(larger.collection);
  assert.ok(projection.coverage.omittedSourceIds.length > 0);
  const omittedId = projection.coverage.omittedSourceIds[0], index = larger.collection.sources.findIndex(s => s.id === omittedId);
  const omitted = { selections: [{ sourceKey: `S${index + 1}`, quote: larger.collection.sources[index].excerpt.slice(0, 2400) }], limitations: [] };
  assert.throws(() => api.assembleThoroughPodEvidence(larger.collection, larger.request, omitted, now), /r12_pod_evidence_capacity_or_provenance_invalid/);
});

test('search normalization rejects over-limit, malformed-Unicode and disallowed source material instead of clipping', () => {
  const { api, annotations, request, excludedDomains } = searchFixture(1), before = clone(annotations);
  assert.equal(api.normalizeThoroughPodSearch(annotations, { ...request, excludedDomains })[0].url_citation.content.length, 8000);
  for (const change of [a => a[0].url_citation.content += 'x', a => a[0].url_citation.content = 'x'.repeat(40) + '\u0000',
    a => a[0].url_citation.content = 'x'.repeat(40) + '\ud800', a => a[0].url_citation.url = 'https://etsy.com/study',
    a => a[0].url_citation.url = 'https://outside.org/study', a => a[0].url_citation.title = 'x'.repeat(251),
    a => a.push(...Array.from({ length: 25 }, () => clone(a[0])))]) {
    const bad = clone(annotations); change(bad); assert.throws(() => api.normalizeThoroughPodSearch(bad, { ...request, excludedDomains }));
  }
  const unicode = clone(annotations); unicode[0].url_citation.content = '🧵'.repeat(4000);
  assert.equal(api.normalizeThoroughPodSearch(unicode, { ...request, excludedDomains })[0].url_citation.content, unicode[0].url_citation.content);
  assert.deepEqual(annotations, before);
});

test('thorough collection validation rejects corrupted provenance and non-finite retrieval timestamps', () => {
  const { api, request, collection } = searchFixture(1);
  for (const [label, change] of [['content hash', c => c.sources[0].contentHash = '0'.repeat(64)], ['source id', c => c.sources[0].id = 'src-forged'],
    ['invalid retrievedAt', c => c.sources[0].retrievedAt = 'not-a-timestamp'], ['invalid retrievalExpiresAt', c => c.sources[0].retrievalExpiresAt = 'not-a-timestamp'],
    ['future retrieval', c => c.sources[0].retrievedAt = stamp(300001)], ['expired retrieval', c => c.sources[0].retrievalExpiresAt = stamp(-1)]]) {
    const bad = clone(collection); change(bad);
    assert.throws(() => api.validateThoroughPodCollection(bad, request, now), /r12_pod_evidence_capacity_or_provenance_invalid/, label);
  }
});

test('bounded prior evidence remains whole, hash-linked and separated by pass with explicit omissions', () => {
  const { api, request, collection } = searchFixture(16);
  const selection = { selections: collection.sources.flatMap((s, i) => [0, 2400, 4800].map(offset => ({ sourceKey: `S${i + 1}`, quote: s.excerpt.slice(offset, offset + 2400) }))), limitations: [] };
  const pack = api.assembleThoroughPodEvidence(collection, request, selection, now);
  const archives = Array.from({ length: 4 }, (_, pass) => api.podArchive(collection, pack, pass)), before = clone(archives);
  const projection = api.podPriorEvidenceProjection(archives);
  assert.equal(projection.coverage.available, 192); assert.equal(projection.coverage.retained, projection.items.length);
  assert.equal(projection.coverage.omittedEvidenceKeys.length, 192 - projection.items.length);
  assert.equal(projection.coverage.quotesTruncated, false); assert.ok(api.podPromptBytes(projection) <= limits.maximumPriorEvidenceBytes);
  assert.deepEqual([...new Set(projection.items.map(e => e.pass))].sort(), [0, 1, 2, 3]);
  for (const item of projection.items) {
    const index = Number(item.key.split('E')[1]) - 1, original = archives[item.pass].items[index];
    assert.equal(item.key, `P${item.pass + 1}E${index + 1}`);
    for (const key of ['quote', 'evidenceId', 'contentHash', 'url', 'title', 'retrievedAt', 'publishedAt']) assert.deepEqual(item[key], original[key]);
    assert.equal(item.collectionHash, hash(collection)); assert.equal(item.evidencePackHash, hash(pack));
  }
  assert.deepEqual(archives, before);
  assert.throws(() => api.podPriorEvidenceProjection([...archives, clone(archives[0])]));
  assert.throws(() => api.podPriorEvidenceProjection([archives[0], clone(archives[0])]));
});

test('new runtime qualification pins match the actual schema, provider projection, instructions and limits', async () => {
  const { podResearchSchemaPins, podResearchSystemInstruction, buildPodPlannerRequest } = load('products/discovery-r12-pod-runtime');
  const { projectProviderJsonSchema } = load('models/openrouter');
  const { routeDiscoveryR12Request, inspectDiscoveryR12Wire } = load('products/discovery-r12-wire');
  for (const recovery of [false, true]) {
    const pins = podResearchSchemaPins(recovery, true);
    for (const phase of Object.keys(LEGACY_PINS)) {
      const schema = podResearchSchema(phase, true);
      assert.deepEqual(pins[phase], { localHash: hash(schema), wireHash: hash(projectProviderJsonSchema(schema)),
        systemHash: hash(podResearchSystemInstruction(phase, recovery, true)), outputLimitsHash: hash(workerOutputLimits(schema)) });
      assert.notEqual(pins[phase].localHash, LEGACY_PINS[phase].localHash);
      assert.notEqual(pins[phase].systemHash, LEGACY_PINS[phase].systemHash);
      assert.notEqual(pins[phase].outputLimitsHash, LEGACY_PINS[phase].outputLimitsHash);
    }
  }
  const current = scope(), request = buildPodPlannerRequest(hash(current), current.sourcePolicyHash, current.publicBrief, current.sourcePolicy.excludedDomains, null, true);
  assert.equal(request.maxOutputTokens, 16000); assert.equal(request.schemaName, 'pod_research_plan_v2');
  assert.equal(request.requestMetadata.r12PodProfile, POD_THOROUGH_PROFILE);
  const payload = JSON.parse(request.messages[1].content);
  assert.deepEqual(payload.publicBrief, current.publicBrief); assert.equal(payload.refinement, null);
  assert.match(payload.sourceMethod, /twenty-five 8000-character highlights/); assert.match(payload.sourceMethod, /No full-page read/);
  assert.equal(payload.outputLimits, workerOutputLimits(podResearchSchema('plan', true)));
  const { route } = wireRequest('plan'), routed = routeDiscoveryR12Request(request, 'plan', route, false, false, true, true);
  const wire = await inspectDiscoveryR12Wire(routed, 'plan', false, false, false, true, true);
  assert.equal(hash(JSON.parse(wire.wire.body).response_format.json_schema.schema), podResearchSchemaPins(false, true).plan.wireHash);
  const legacy = buildPodPlannerRequest(hash(current), current.sourcePolicyHash, current.publicBrief, current.sourcePolicy.excludedDomains);
  assert.equal(legacy.requestMetadata.r12PodProfile, undefined); assert.equal(legacy.schemaName, 'pod_research_plan_v1');
  assert.equal(hash(legacy.outputSchema), LEGACY_PINS.plan.localHash);
  assert.equal(hash(legacy.messages[0].content), LEGACY_PINS.plan.systemHash);
});

test('the strategist aggregate ceiling counts twice-escaped JSON at its exact boundary', () => {
  const maximum=limits.maximumAssessmentEmbeddedBytes;
  for(const glyph of ['x','界','🧵','"','\\','\n']) {
    const overhead=podEmbeddedJsonBytes(''), unit=podEmbeddedJsonBytes(glyph)-overhead;
    const repeats=Math.floor((maximum-overhead)/unit), remainder=maximum-overhead-repeats*unit;
    const atLimit=glyph.repeat(repeats)+'x'.repeat(remainder);
    assert.equal(podEmbeddedJsonBytes(atLimit),maximum);
    assert.ok(bytes(atLimit)<limits.phases.strategy.maximumArtifactBytes);
    assert.doesNotThrow(()=>assertPodArtifactBytes(atLimit,'strategy'));
    assert.throws(()=>assertPodArtifactBytes(atLimit+'x','strategy'),/r12_pod_artifact_capacity_exceeded/);
  }
});

test('the 100-source stored contract does not authorize 100 results from the 25-result web provider', () => {
  const {api,request,excludedDomains,annotations,collection}=searchFixture(25);
  assert.equal(api.normalizeThoroughPodSearch(annotations,{...request,excludedDomains}).length,25);
  assert.throws(()=>api.normalizeThoroughPodSearch([...annotations,clone(annotations[0])],{...request,excludedDomains}));
  const stored=clone(collection);
  stored.sources=Array.from({length:100},(_,i)=>{
    const original=collection.sources[i%25],url=original.url+`-stored-contract-${i+1}`;
    const excerpt=`Synthetic stored-contract record ${i+1}; no live provider admission or market claim.`,contentHash=sha(excerpt);
    return {...original,url,excerpt,contentHash,id:`src-${sha(url+':'+contentHash).slice(0,24)}`};
  });
  assert.doesNotThrow(()=>api.validateThoroughPodCollection(stored,request,now));
  const projection=api.podSourceProjection(stored);
  assert.equal(projection.sources.length,100); assert.equal(projection.sources.at(-1).sourceKey,'S100');
  assert.deepEqual(projection.coverage.omittedSourceIds,[]);
  const exact={selections:[{sourceKey:'S100',quote:stored.sources[99].excerpt}],limitations:['no_sales_metrics']};
  assert.equal(api.assembleThoroughPodEvidence(stored,request,exact,now).evidence[0].quote,stored.sources[99].excerpt);
  const over=clone(stored); over.sources.push(clone(stored.sources[0]));
  assert.throws(()=>api.validateThoroughPodCollection(over,request,now));
  assert.throws(()=>api.podSourceProjection(over));
  const futureAnnotations=stored.sources.map(s=>({type:'url_citation',url_citation:{url:s.url,title:s.title,content:s.excerpt}}));
  assert.throws(()=>api.extractThoroughPodSources(request,{annotations:futureAnnotations,metadata:{}},stamp(0)));
});
