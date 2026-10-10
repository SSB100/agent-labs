import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture as legacyFixture } from './helpers/r12-adaptive-inputs-fixture.mjs';
import { id, now, fixture as previewFixture, planFixture } from './helpers/r12-adaptive-fixture.mjs';
import { r12CatalogFixture } from './helpers/r12-provider-fixture.mjs';
import { discoveryV2Hash as hash } from '../.core-tests/products/discovery-v2.js';
import { validateAdaptiveOwnerResearchProfile, validateOwnerResearchProfile } from '../.core-tests/products/discovery-r12-goal-scope.js';
import { qualifyAdaptiveResearchQuote, qualifyEtsyOwnerResearchQuote, validateAdaptiveResearchQuote, validateAdaptiveExecutionQuote, adaptiveResearchPhaseLimits, ADAPTIVE_ETSY_PHASES } from '../.core-tests/products/discovery-r12-adaptive-quote.js';
import { validateAdaptiveResearchPreview, validateAdaptiveResearchPlan, adaptiveResearchRemainingCapacity } from '../.core-tests/products/discovery-r12-adaptive-scope.js';
import { validateAdaptiveResearchAction } from '../.core-tests/products/discovery-r12-adaptive-action.js';
import { validateAdaptiveExecutionScope } from '../.core-tests/products/discovery-r12-adaptive-execution-scope.js';
import { prepareAdaptiveResearchPreview } from '../.core-tests/products/discovery-r12-adaptive-preparation.js';
import { bindValidatedAdaptiveResearchIntent } from '../.core-tests/products/discovery-r12-adaptive-intent.js';
import { routeAdaptiveResearchRequest, inspectAdaptiveResearchWire } from '../.core-tests/products/discovery-r12-adaptive-wire.js';
import { discoveryR12EtsyOwnerStaticSchema, discoveryR12OwnerInitialStaticSchema } from '../.core-tests/products/discovery-r12-schemas.js';
import { adaptiveStrategistSchema } from '../.core-tests/products/discovery-r12-adaptive-strategy.js';
import { adaptiveReviewerResponseSchema } from '../.core-tests/products/discovery-r12-adaptive-review-contract.js';
import { resolveModelRoute } from '../.core-tests/models/registry.js';
import { compileQuestPlan } from '../.core-tests/core/quest-plan.js';
import { driveQuestOnce } from '../.core-tests/core/quest-controller.js';

// Synthetic immutable selections only. These do not impersonate captured Etsy
// observations or source execution; runtime tests validate actual bundle bytes.
function ownerRef() {
  const manifest = [{ bundleId: id(600), bundleHash: '8'.repeat(64), selectedObservationIds: [id(601), id(602), id(603)] }];
  return { manifestHash: hash(manifest), manifest };
}
function fixture() {
  const f = legacyFixture(), p = f.raw.preview, scope = f.raw.scope, ref = ownerRef();
  const quote = qualifyEtsyOwnerResearchQuote(r12CatalogFixture(now), now);
  const profile = { ...scope.profile, version: 'r12.owner-research-profile.3', allowedDomains: ['etsy.com'],
    sourceReviews: [{ domain: 'etsy.com', basis: 'owner_reported_capture', reviewHash: 'a'.repeat(64) }] };
  Object.assign(p, { version: 'r12.adaptive-research-preview.2', ownerObservationRef: ref, maximumNewChildren: 3, profileHash: hash(profile), quoteHash: quote.quoteHash });
  Object.assign(scope, { version: 'r12.discovery-owner-adaptive.2', profile, profileHash: p.profileHash, quoteHash: p.quoteHash, ownerObservationRef: ref, allowedDomains: ['etsy.com'] });
  scope.intent.comparisonUniverse.sourceDomains = ['etsy.com'];
  scope.intent.limits.maximumNewCollections = 0;
  const plan = f.ctx.plan;
  Object.assign(plan, { format: 'r12.discovery-adaptive.2', discoveryScopeHash: hash(scope), maximumChildren: p.predecessor.baseChildren + 3 });
  plan.steps = plan.steps.filter(s => ADAPTIVE_ETSY_PHASES.includes(s.key));
  plan.steps.forEach((s, i) => { s.dependsOn = ADAPTIVE_ETSY_PHASES.slice(0, i); });
  const action = { ...f.raw.action, version: 'r12.adaptive-action.2', scopeHash: hash(scope), phases: [...ADAPTIVE_ETSY_PHASES] };
  const pins = { ...f.raw.intentPins, scopeVersion: scope.version, scopeHash: hash(scope), actionHash: hash(action), ownerObservationRef: ref };
  const context = { preview: p, scopeId: scope.id, scopeHash: hash(scope), nextOrdinal: 0, previousActionHash: null,
    previousReviewHash: action.previousReviewHash, previousActionClosed: true, ownerStopped: false,
    capacity: { extraActionsUsed: 0, childrenUsed: p.predecessor.baseChildren, dispatchesUsed: p.predecessor.baseDispatches,
      createdPhaseSlots: [], runCommittedMicrousd: 0, rootHeadroomMicrousd: 10000000, businessHeadroomMicrousd: 10000000,
      hasUnknownLiability: false, authorityActive: true, expired: false }, phaseCeilings: quote.ceilings, repairableFailure: null };
  return { p, scope, profile, quote, plan, action, pins, context };
}
function preparation(f) {
  const input = { businessId: f.p.businessId, goalId: f.p.goalId, goalRevision: f.p.predecessor.goalRevision,
    profileId: f.profile.id, profileHash: f.p.profileHash, grantId: id(800), predecessorPlanId: f.p.predecessor.predecessorPlanId,
    predecessorPlanHash: f.p.predecessor.predecessorPlanHash, predecessorScopeId: f.p.predecessor.predecessorScopeId,
    predecessorScopeHash: f.p.predecessor.predecessorScopeHash, maximumActions: 10, maximumRunMicrounits: '10000000',
    marketSetKey: f.scope.selection.marketSetKey, topicKey: f.scope.selection.topicKey, ownerObservationRef: f.p.ownerObservationRef,
    businessLifetimeLimitMicrounits: f.p.business.proposedLimitMicrounits, researchLifetimeLimitMicrounits: f.p.funding.proposedLimitMicrounits, submissionId: id(801) };
  const state = { predecessor: f.p.predecessor, imports: f.p.imports, profile: f.profile, quote: f.quote,
    grant: { id: input.grantId, profileId: f.profile.id, businessId: f.p.businessId, goalId: f.p.goalId,
      goalRevision: f.p.predecessor.goalRevision, goalHash: f.p.predecessor.goalHash, approvalHash: 'f'.repeat(64), allowsPaidFollowups: true,
      maximumActions: 10, maximumRunMicrounits: '10000000', remainingScopes: 1, remainingAllocationMicrounits: '10000000', expiresAt: f.p.expiresAt },
    funding: f.p.funding, business: f.p.business, deadline: f.p.expiresAt, ownerObservationRef: f.p.ownerObservationRef };
  return { input, state };
}
function nextAction(f, kind = 'reasoning_review') {
  Object.assign(f.action, { ordinal: 1, kind, previousActionHash: 'b'.repeat(64), phases: ['strategy', 'review'] });
  Object.assign(f.context, { nextOrdinal: 1, previousActionHash: f.action.previousActionHash });
  Object.assign(f.context.capacity, { childrenUsed: f.p.predecessor.baseChildren + 3, dispatchesUsed: f.p.predecessor.baseDispatches + 3,
    createdPhaseSlots: [...ADAPTIVE_ETSY_PHASES], runCommittedMicrousd: 1000 });
  return f;
}
function rehashQuote(q) {
  if (q.version === 'r12.adaptive-quote.2') q.baseQuoteHash = hash({ version: 'r12.adaptive-inference-catalog.1', luna: q.luna, reviewer: q.reviewer });
  const { quoteHash, verifiedAt, validUntil, ...body } = q;
  void quoteHash; void verifiedAt; void validUntil; q.quoteHash = hash(body); return q;
}
function request(phase, quote) {
  return { model: resolveModelRoute(phase === 'review' ? 'reviewer.independent' : 'standard.default').primary,
    schemaName: `inert_etsy_${phase}`, outputSchema: phase === 'plan' ? discoveryR12EtsyOwnerStaticSchema('plan') : phase === 'strategy' ? adaptiveStrategistSchema() : adaptiveReviewerResponseSchema(),
    maxOutputTokens: quote.outputTokens[phase], messages: [{ role: 'system', content: 'Inert serializer contract test. No provider request is authorized.' },
      { role: 'user', content: 'Preserve the attributed owner evidence without inferring unsupported sales or geographic demand.' }], requestMetadata: {} };
}

test('Etsy profile is explicit owner-capture metadata, preserving network exclusions and historical profiles', () => {
  const f = fixture();
  assert.deepEqual(validateAdaptiveOwnerResearchProfile(f.profile, now), f.profile);
  assert.deepEqual(f.profile.excludedDomains, ['etsy.com', 'etsy.me', 'etsystatic.com']);
  assert.throws(() => validateOwnerResearchProfile(f.profile, now));
  for (const mutate of [p => p.version = 'r12.owner-research-profile.2', p => p.sourceReviews[0].basis = 'documented_api_factual_snippets',
    p => p.allowedDomains.push('research.example'), p => p.allowedDomains = ['www.etsy.com'], p => p.sourceReviews = [],
    p => p.excludedDomains = ['etsy.me', 'etsystatic.com'], p => p.maximumRunMicrousd = 10000001, p => p.validUntil = new Date(now).toISOString()]) {
    const p = structuredClone(f.profile); mutate(p); assert.throws(() => validateAdaptiveOwnerResearchProfile(p, now));
  }
  const old = legacyFixture(); old.raw.preview.ownerObservationRef = ownerRef();
  assert.equal(validateAdaptiveResearchPreview(old.raw.preview, now).version, 'r12.adaptive-research-preview.1');
  assert.deepEqual(validateAdaptiveOwnerResearchProfile(old.raw.scope.profile, now), old.raw.scope.profile);
});

test('Etsy quote exposes precisely three genuine inference roles and no Exa/search/select fee or allowance', () => {
  const q = qualifyAdaptiveResearchQuote(r12CatalogFixture(now), now, 'r12.adaptive-quote.2');
  assert.deepEqual(q, qualifyEtsyOwnerResearchQuote(r12CatalogFixture(now), now));
  assert.deepEqual(validateAdaptiveResearchQuote(q, now), q);
  for (const map of [q.ceilings, q.requestBytes, q.outputTokens]) assert.deepEqual(Object.keys(map), ['plan', 'strategy', 'review']);
  assert.equal(q.retention.sourceAcquisition, 'owner_reported_capture_no_search');
  assert.equal(q.retention.search, undefined); assert.doesNotMatch(JSON.stringify(q), /exa|searchRequests|searchMicrousd|selectorMicrousd/i);
  for (const phase of ['search', 'select']) assert.throws(() => adaptiveResearchPhaseLimits(q, phase), /phase_unavailable/);
  for (const map of ['ceilings', 'requestBytes', 'outputTokens']) for (const phase of ['search', 'select']) {
    const bad = structuredClone(q); bad[map][phase] = 0; rehashQuote(bad); assert.throws(() => validateAdaptiveResearchQuote(bad, now));
  }
  for (const mutate of [q => q.exaFeeMicrousd = 0, q => q.luna.searchRequests = 0, q => q.retention.search = 'none',
    q => q.ceilings.plan++, q => q.outputTokens.plan++, q => q.requestBytes.strategy++, q => q.luna.priceLimit.request = 1]) {
    const bad = structuredClone(q); mutate(bad); rehashQuote(bad); assert.throws(() => validateAdaptiveResearchQuote(bad, now));
  }
  assert.equal(qualifyAdaptiveResearchQuote(r12CatalogFixture(now), now).version, 'r12.adaptive-quote.1');
});

test('fresh Etsy quotes retain routing and aggregate caps, reject .1/.2 swaps and rising costs', () => {
  const old = fixture().quote, later = now + 360000;
  const refreshed = qualifyEtsyOwnerResearchQuote(r12CatalogFixture(later), later);
  assert.deepEqual(validateAdaptiveExecutionQuote(refreshed, old, old.quoteHash, later), refreshed);
  const legacy = qualifyAdaptiveResearchQuote(r12CatalogFixture(now), now);
  assert.throws(() => validateAdaptiveExecutionQuote(old, legacy, legacy.quoteHash, now));
  assert.throws(() => validateAdaptiveExecutionQuote(legacy, old, old.quoteHash, now));
  const cheaperCatalogs = r12CatalogFixture(now);
  for (const key of ['lunaAlias', 'lunaCanonical', 'reviewerAlias', 'reviewerCanonical', 'zdr']) {
    const rows = key === 'zdr' ? cheaperCatalogs[key].payload.data : cheaperCatalogs[key].payload.data.endpoints;
    for (const row of rows) for (const tier of [row.pricing, ...(row.pricing.overrides ?? [])]) for (const rate of ['prompt', 'completion', 'input_cache_read', 'input_cache_write', 'input_cache_write_1h', 'internal_reasoning']) {
      if (tier[rate] !== undefined) tier[rate] = (Number(tier[rate]) / 2).toFixed(12);
    }
  }
  const low = qualifyEtsyOwnerResearchQuote(cheaperCatalogs, now);
  assert.doesNotThrow(() => validateAdaptiveExecutionQuote(low, old, old.quoteHash, now));
  assert.throws(() => validateAdaptiveExecutionQuote(old, low, low.quoteHash, now));
});

test('Etsy preview retains five real historical imports but exactly three new paid phase slots and original counters', () => {
  const f = fixture();
  assert.equal(validateAdaptiveResearchPreview(f.p, now).imports.length, 5);
  assert.deepEqual(validateAdaptiveResearchPlan(f.plan, f.p, { id: f.scope.id, hash: hash(f.scope) }, now), f.plan);
  assert.deepEqual(f.plan.steps.map(s => s.key), ['plan', 'strategy', 'review']);
  assert.equal(f.plan.maximumChildren, 22); assert.equal(f.plan.maximumDispatches, 64);
  assert.equal(f.plan.maximumMicrounits, '10129774');
  assert.equal(f.plan.steps[2].workerDefinitionId === f.plan.steps[1].workerDefinitionId, false);
  for (const mutate of [p => p.ownerObservationRef = null, p => p.maximumNewChildren = 5, p => p.maximumPaidCalls = 2,
    p => p.imports.splice(1, 2), p => p.funding.pendingMicrounits = '1', p => p.business.hasUnknown = true]) {
    const p = structuredClone(f.p); mutate(p); assert.throws(() => validateAdaptiveResearchPreview(p, now));
  }
  const c = { ...f.p.predecessor, baseChildren: 27 };
  assert.equal(adaptiveResearchRemainingCapacity(c, 'r12.adaptive-research-preview.2').maximumPaidCalls, 47);
  assert.equal(adaptiveResearchRemainingCapacity(c).maximumPaidCalls, 47);
  assert.throws(() => adaptiveResearchRemainingCapacity({ ...c, baseChildren: 29 }, 'r12.adaptive-research-preview.2'));
});

test('Etsy plan rejects cross-mode topology, reset limits, fabricated search/select and dependent review', () => {
  for (const mutate of [p => p.format = 'r12.discovery-adaptive.1', p => p.steps[1].key = 'search1', p => p.steps[2].dependsOn = [],
    p => p.steps[2].workerDefinitionId = p.plannerWorkerDefinitionId, p => p.maximumChildren = 3, p => p.maximumDispatches = 47,
    p => p.maximumMicrounits = '10000000', p => p.steps[0].maximumMicrounits = '10000001', p => p.maximumRepairs = 0]) {
    const f = fixture(); mutate(f.plan); assert.throws(() => validateAdaptiveResearchPlan(f.plan, f.p, { id: f.scope.id, hash: hash(f.scope) }, now));
  }
  const old = planFixture(previewFixture());
  assert.deepEqual(compileQuestPlan(old.plan), old.plan);
  old.plan.format = 'r12.discovery-adaptive.2'; assert.throws(() => compileQuestPlan(old.plan));
});

test('Etsy preparation selects .2 from reviewed .3 profile and rejects missing captures or mixed quotes', () => {
  const f = fixture(), p = preparation(f), made = prepareAdaptiveResearchPreview(p.input, p.state, now);
  assert.equal(made.preview.version, 'r12.adaptive-research-preview.2'); assert.equal(made.preview.maximumNewChildren, 3);
  assert.deepEqual(made.preview.ownerObservationRef, f.p.ownerObservationRef);
  for (const mutate of [p => p.state.quote = qualifyAdaptiveResearchQuote(r12CatalogFixture(now), now),
    p => p.state.ownerObservationRef = null, p => { p.input.ownerObservationRef = null; p.state.ownerObservationRef = null; },
    p => p.state.profile.version = 'r12.owner-research-profile.2']) {
    const bad = preparation(fixture()); mutate(bad); assert.throws(() => prepareAdaptiveResearchPreview(bad.input, bad.state, now));
  }
});

test('activated Etsy scope and intent bind explicit mode, selected captures, zero collections and Etsy-only source attribution', () => {
  const f = fixture();
  assert.deepEqual(validateAdaptiveExecutionScope(f.scope, f.p, now), f.scope);
  assert.equal(bindValidatedAdaptiveResearchIntent(f.scope.intent, f.pins, now).scopeVersion, 'r12.discovery-owner-adaptive.2');
  for (const mutate of [s => s.version = 'r12.discovery-owner-adaptive.1', s => s.ownerObservationRef = null,
    s => s.intent.limits.maximumNewCollections = 1, s => s.allowedDomains = ['research.example'], s => s.profile.version = 'r12.owner-research-profile.2']) {
    const s = structuredClone(f.scope); mutate(s); assert.throws(() => validateAdaptiveExecutionScope(s, f.p, now));
  }
  for (const mutate of [f => f.pins.ownerObservationRef = null, f => f.scope.intent.limits.maximumNewCollections = 1,
    f => f.scope.intent.comparisonUniverse.sourceDomains = ['research.example'], f => f.pins.activeEvidenceArtifactIds = [id(999)],
    f => f.pins.evidenceManifest = [{ artifactId: id(999), packHash: 'a'.repeat(64), queryId: id(998), collectedForIntentId: id(997), scopeId: id(996), scopeHash: 'b'.repeat(64), actionHash: null }]]) {
    const bad = fixture(); mutate(bad); assert.throws(() => bindValidatedAdaptiveResearchIntent(bad.scope.intent, bad.pins, now));
  }
});

test('Etsy initial and pivot consume three genuine calls; reasoning review consumes strategy and independent review', () => {
  const f = fixture(), first = validateAdaptiveResearchAction(f.action, f.context, now);
  assert.equal(first.admission.paidCalls, 3); assert.equal(first.admission.requiredNewChildren, 3); assert.equal(first.extraActionIncrement, 0);
  assert.equal(first.admission.decision, 'eligible_for_atomic_admission');
  const reasoning = nextAction(fixture()), next = validateAdaptiveResearchAction(reasoning.action, reasoning.context, now);
  assert.equal(next.admission.paidCalls, 2); assert.equal(next.admission.requiredNewChildren, 0); assert.equal(next.extraActionIncrement, 1);
  reasoning.action.kind = 'pivot'; reasoning.action.phases = [...ADAPTIVE_ETSY_PHASES];
  assert.equal(validateAdaptiveResearchAction(reasoning.action, reasoning.context, now).admission.paidCalls, 3);
  for (const mutate of [f => f.action.version = 'r12.adaptive-action.1', f => f.action.phases = ['plan', 'search', 'select', 'strategy', 'review'],
    f => f.context.phaseCeilings.search = 1, f => f.context.capacity.createdPhaseSlots = ['search'], f => f.context.capacity.dispatchesUsed = 63,
    f => f.context.ownerStopped = true]) {
    const bad = fixture(); mutate(bad); assert.throws(() => validateAdaptiveResearchAction(bad.action, bad.context, now));
  }
});

test('Etsy new-evidence followup requires a fresh source operation and repair never manufactures search or skips strategy', () => {
  const followup = nextAction(fixture(), 'followup');
  assert.throws(() => validateAdaptiveResearchAction(followup.action, followup.context, now), /owner_source_operation_required/);
  for (const [phase, phases] of [['plan', ['plan', 'strategy', 'review']], ['strategy', ['strategy', 'review']], ['review', ['strategy', 'review']]]) {
    const f = nextAction(fixture(), 'repair'); f.action.phases = phases;
    f.action.repair = { failedAttemptId: id(701), failureHash: 'e'.repeat(64), defect: 'schema' };
    f.context.repairableFailure = { attemptId: id(701), failureHash: 'e'.repeat(64), phase, defect: 'schema' };
    assert.equal(validateAdaptiveResearchAction(f.action, f.context, now).admission.paidCalls, phases.length);
    f.action.phases = ['review']; assert.throws(() => validateAdaptiveResearchAction(f.action, f.context, now));
  }
  const f = nextAction(fixture(), 'repair'); f.action.repair = { failedAttemptId: id(701), failureHash: 'e'.repeat(64), defect: 'schema' };
  f.context.repairableFailure = { attemptId: id(701), failureHash: 'e'.repeat(64), phase: 'search', defect: 'schema' };
  assert.throws(() => validateAdaptiveResearchAction(f.action, f.context, now));
});

test('Etsy actions retain shared unknown-liability, root, Business and approved-run caps', () => {
  for (const [field, value, reason] of [['hasUnknownLiability', true, 'unknown_liability'], ['rootHeadroomMicrousd', 0, 'root_budget'],
    ['businessHeadroomMicrousd', 0, 'business_budget'], ['authorityActive', false, 'authority_required'], ['expired', true, 'expired']]) {
    const f = fixture(); f.context.capacity[field] = value;
    const result = validateAdaptiveResearchAction(f.action, f.context, now);
    assert.equal(result.admission.decision, 'pause'); assert.equal(result.admission.reason, reason);
  }
  const f = fixture(); f.p.maximumRunMicrounits = '1';
  assert.equal(validateAdaptiveResearchAction(f.action, f.context, now).admission.reason, 'approved_run_budget');
});

test('Etsy wire inspection produces three distinct paid-role requests without any search tools or transport', async () => {
  const q = fixture().quote, original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('no transport authorized'); };
  try {
    const wires = [];
    for (const phase of ADAPTIVE_ETSY_PHASES) {
      const wire = await inspectAdaptiveResearchWire(request(phase, q), phase, q, now), body = JSON.parse(wire.wire.body); wires.push(wire);
      assert.equal(body.tools, undefined); assert.equal(body.plugins, undefined); assert.equal(body.provider.allow_fallbacks, false);
      assert.deepEqual(body.provider.only, [phase === 'review' ? 'amazon-bedrock/us' : 'azure/us']);
      assert.equal(body.max_tokens, q.outputTokens[phase]);
    }
    assert.equal(new Set(wires.map(w => w.wireHash)).size, 3); assert.equal(calls, 0);
    for (const phase of ['search', 'select']) await assert.rejects(inspectAdaptiveResearchWire(request('plan', q), phase, q, now));
    const legacySchema = request('plan', q); legacySchema.outputSchema = discoveryR12OwnerInitialStaticSchema('plan');
    assert.throws(() => routeAdaptiveResearchRequest(legacySchema, 'plan', q, now));
    const hybrid = request('plan', q); hybrid.query = 'Fetch Etsy information';
    assert.throws(() => routeAdaptiveResearchRequest(hybrid, 'plan', q, now));
  } finally { globalThis.fetch = original; }
});

test('static controller cannot dispatch Etsy mode without a reconstructed adaptive action', async () => {
  const f = fixture(); let commands = 0;
  const store = { read: async () => ({ plan: f.plan }), command: async () => { commands++; throw new Error('dispatch forbidden'); } };
  assert.deepEqual(await driveQuestOnce(store), { status: 'blocked', reason: 'adaptive_action_runtime_required' });
  assert.equal(commands, 0);
});
