import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const B = require('../.core-tests/listing/budget.js');
const { executeListingRun } = require('../.core-tests/listing/engine.js');
const { listingFixture, listingFixtureId: id } = require('../.core-tests/listing/fixtures.js');
const { listingWorker } = require('../.core-tests/listing/packs.js');
const { listingKnowledgeHash } = require('../.core-tests/listing/knowledge.js');
const { prepareListingTask, assertReviewedListing } = require('../.core-tests/listing/runtime.js');
const { hash } = require('../.core-tests/etsy/contracts.js');
const { OpenRouterAdapter } = require('../.core-tests/models/openrouter.js');
const { ModelProviderError } = require('../.core-tests/models/types.js');
const NOW = Date.parse('2026-10-01T10:30:00Z');
test.before(() => {
  mock.method(Date, 'now', () => NOW);
  mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected network access in offline listing tests'); });
});
test.after(() => mock.restoreAll());
const price = (modelId, overrides = {}) => ({ modelId, source: B.LISTING_PRICING_SOURCE, verifiedAt: new Date(NOW).toISOString(),
  inputPerMillion: .8, outputPerMillion: 4, cacheWritePerMillion: .1, ...overrides });
const prices = () => ({ specialist: price(B.LISTING_MODELS.specialist), reviewer: price(B.LISTING_MODELS.reviewer) });

/** These relabeled fixture objects exercise transport/state-machine boundaries
 * ONLY. The in-memory repository impersonates server guards. This suite makes
 * no live competence, authentic upstream-evidence or qualification claim. */
function harness() {
  const fixture = listingFixture(NOW);
  fixture.input.evidenceMode = 'live';
  const inputHash = hash(fixture.input);
  const state = { id: id(40), businessId: fixture.input.product.businessId, workflowRunId: id(41), sourceArtifactId: fixture.input.product.id,
    outputArtifactId: id(42), input: fixture.input, inputHash, knowledgeHash: listingKnowledgeHash(),
    workerHashes: { specialist: hash(listingWorker('specialist').manifest), reviewer: hash(listingWorker('reviewer').manifest) },
    status: 'queued', phase: 'specialist', maximumMicrousd: 1_000_000,
    quote: B.quoteListing(inputHash, 1_000_000, prices(), NOW), taskIds: { specialist: id(43), reviewer: id(44) }, outputs: {} };
  const ledger = new Map(), calls = [], events = [], issued = [], hooks = {};
  let guardCount = 0, priceCount = 0, authentic = true, qualified = true;
  const total = () => [...ledger.values()].reduce((sum, row) => sum + (typeof row.actual === 'number' ? row.actual : row.reservedMicrousd), 0);
  const check = () => {
    if (!authentic || !qualified) throw new Error('Untrusted or unqualified');
    if (['queued', 'running'].includes(state.status)) {
      if (total() > state.maximumMicrousd) throw new Error('Exceeded cap');
      for (const role of ['specialist', 'reviewer']) if (state.outputs[role]) {
        const row = ledger.get(role);
        if (!row || typeof row.actual !== 'number' || !row.receipt?.outputValidated) throw new Error('Missing settled valid receipt');
      }
    }
  };
  const repo = {
    async load() { events.push('load'); return state; },
    async guard() { events.push('guard'); await hooks.guard?.(++guardCount); check(); return state; },
    async reserve(value) {
      events.push(`reserve:${value.role}`); await hooks.reserve?.(value);
      if (ledger.has(value.role)) return { shouldExecute: false, committedMicrousd: total() };
      check(); if (!['queued', 'running'].includes(state.status) || total() + value.reservedMicrousd > state.maximumMicrousd) throw new Error('Reservation denied');
      ledger.set(value.role, structuredClone(value)); state.status = 'running';
      await hooks.afterReserve?.(value);
      return { shouldExecute: true, committedMicrousd: total() };
    },
    async settle(value) {
      events.push(`settle:${value.role}`); const row = ledger.get(value.role); assert.ok(row);
      row.actual = value.reportedMicrousd; row.requestId = value.providerRequestId; row.receipt = structuredClone(value.receipt);
      await hooks.settle?.(value);
    },
    async persist(value) {
      events.push(`persist:${value.role}`); await hooks.beforePersist?.(value); check();
      if (!['queued', 'running'].includes(state.status)) throw new Error('Not active');
      const row = ledger.get(value.role);
      assert.equal(typeof row.actual, 'number'); assert.equal(row.receipt.outputValidated, true);
      assert.equal(row.receipt.outputHash, hash(value.output)); assert.equal(row.receipt.completedAt, value.execution.completedAt);
      assert.equal(row.requestHash, value.execution.requestHash); assert.equal(row.requestId, value.execution.providerRequestId);
      state.outputs[value.role] = structuredClone({ output: value.output, execution: value.execution });
      state.phase = value.role === 'specialist' ? 'reviewer' : 'issue';
      if (value.role === 'reviewer' && value.output.verdict !== 'APPROVE') state.status = value.output.verdict === 'REJECT' ? 'rejected' : 'needs_evidence';
      await hooks.afterPersist?.(value);
    },
    async finish(value) {
      events.push('finish'); await hooks.beforeFinish?.(value); check();
      if (!['queued', 'running'].includes(state.status)) throw new Error('Not active');
      assertReviewedListing(value.reviewedListing, value.product, NOW);
      state.status = 'completed'; await hooks.afterFinish?.(value);
    },
    async fail(reason) { events.push(`fail:${reason}`); if (['queued', 'running'].includes(state.status)) state.status = 'failed'; },
  };
  const options = {
    async prices(model) { events.push(`price:${model}`); const result = await hooks.price?.(model, ++priceCount); return result ?? price(model); },
    adapter: { async invokeStructured(request) {
      const role = request.requestMetadata.role; events.push(`invoke:${role}`); calls.push(request);
      await hooks.invoke?.(request);
      const response = { output: structuredClone(role === 'specialist' ? fixture.proposal : fixture.review), provider: role === 'specialist' ? 'OpenAI' : 'Anthropic',
        providerModelId: B.LISTING_MODELS[role], providerRequestId: `fake-${role}`, latencyMs: 3,
        usage: { inputTokens: 100, outputTokens: 100, totalTokens: 200, cachedInputTokens: 0, reasoningTokens: 0, reportedCostUsd: .001, estimatedCostUsd: .001 },
        metadata: { finishReason: 'stop' } };
      return await hooks.response?.(response, role) ?? response;
    } },
    async issue(product, record) { events.push('issue'); issued.push({ product, record }); await hooks.issue?.(product, record);
      return { etsyDraftEnvelope: 'fake-draft-envelope', listingReviewEnvelope: 'fake-review-envelope' }; },
  };
  return { fixture, state, ledger, calls, events, issued, hooks, repo, options,
    unauthenticate() { authentic = false; }, revokeQualification() { qualified = false; },
    run: () => executeListingRun(repo, options) };
}

test('complete quote uses both full 64KB bounds, fixed independent models and conservative rates', () => {
  const quotes = prices(), quote = B.quoteListing('a'.repeat(64), 1_000_000, quotes, NOW);
  const ceiling = Math.ceil((64_000 + 8192) * (.8 + .1) + 6000 * 4);
  assert.deepEqual(quote.ceilings, { specialist: ceiling, reviewer: ceiling });
  assert.equal(quote.maximumEstimateMicrousd, 2 * ceiling); assert.equal(quote.maximumCalls, 2);
  assert.equal(quote.providerInvoiceGuarantee, false); assert.equal(quote.estimateOnly, true);
  assert.throws(() => B.quoteListing('a'.repeat(64), 2 * ceiling - 1, quotes, NOW), /complete_quote/);
  for (const bad of [NaN, -1, Infinity, 1_000_001]) assert.throws(() => B.quoteListing('a'.repeat(64), bad, quotes, NOW));
  for (const bad of [NaN, -1, Infinity]) assert.throws(() => B.quoteListing('a'.repeat(64), 1_000_000, { ...quotes, specialist: price(B.LISTING_MODELS.specialist, { inputPerMillion: bad }) }, NOW));
  assert.throws(() => B.quoteListing('a'.repeat(64), 1_000_000, { ...quotes, reviewer: price(B.LISTING_MODELS.specialist) }, NOW));
  assert.throws(() => B.quoteListing('a'.repeat(64), 1_000_000, prices(), NOW + 300_001), /fresh_listing_price/);
});
test('current quote uses injected pricing only and owns each returned price before another await', async () => {
  const q = prices(), seen = [];
  const result = await B.currentListingQuote('a'.repeat(64), 1_000_000, async model => {
    seen.push(model); if (model === B.LISTING_MODELS.specialist) return q.specialist;
    q.specialist.inputPerMillion = 99999; return q.reviewer;
  });
  assert.deepEqual(seen, Object.values(B.LISTING_MODELS)); assert.equal(result.maximumCalls, 2);
});
test('full fake OpenRouter wire flow pins providers, no fallbacks, 6000 output tokens and new durable artifact ID', async () => {
  const h = harness(), wires = [];
  h.options.adapter = new OpenRouterAdapter({ config: { apiKey: 'fake-offline-fixture', baseUrl: 'https://openrouter.ai/api/v1', appUrl: 'https://example.test', appName: 'Offline test' },
    fetcher: async (_url, init) => {
      const wire = JSON.parse(init.body); wires.push(wire); const specialist = wire.model === B.LISTING_MODELS.specialist;
      return new Response(JSON.stringify({ id: `wire-${specialist ? 'specialist' : 'reviewer'}`, model: wire.model, provider: specialist ? 'OpenAI' : 'Anthropic',
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(specialist ? h.fixture.proposal : h.fixture.review) } }],
        usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200, cost: .001 } }), { status: 200 });
    } });
  assert.deepEqual(await h.run(), { status: 'completed' }); assert.equal(wires.length, 2);
  assert.deepEqual(wires.map(w => w.provider.only), [['openai'], ['anthropic']]);
  assert.ok(wires.every(w => w.provider.allow_fallbacks === false && w.max_tokens === 6000 && w.stream === false));
  assert.ok(wires.every(w => w.messages.every(m => typeof m.content === 'string') && w.tools === undefined));
  const { product, record } = h.issued[0]; assert.equal(product.id, h.state.outputArtifactId); assert.notEqual(product.id, h.state.sourceArtifactId);
  assert.equal(record.outputArtifactId, product.id); assert.equal(record.publicationAllowed, false);
  assert.equal(record.specialist.providerRequestId, 'wire-specialist'); assert.equal(record.reviewer.providerRequestId, 'wire-reviewer');
  assert.equal(h.ledger.get('specialist').receipt.provider, 'openrouter'); assert.equal(h.ledger.get('specialist').receipt.upstreamProvider, 'OpenAI');
  assert.equal(h.ledger.get('reviewer').receipt.provider, 'openrouter'); assert.equal(h.ledger.get('reviewer').receipt.upstreamProvider, 'Anthropic');
  assert.equal(h.fixture.input.product.id, h.state.sourceArtifactId); assert.equal(h.fixture.input.product.title, 'Synthetic product input');
});
test('reservations bind exact semantic and actual transport requests with precise byte-based estimates', async () => {
  const h = harness(); assert.equal((await h.run()).status, 'completed');
  for (const role of ['specialist', 'reviewer']) {
    const row = h.ledger.get(role), request = h.calls.find(r => r.requestMetadata.role === role), execution = h.state.outputs[role].execution;
    const prepared = prepareListingTask(h.state.input, role, h.state.taskIds[role], role === 'reviewer' ? h.fixture.proposal : undefined, NOW,
      role === 'reviewer' ? h.state.outputs.specialist.execution : undefined);
    assert.equal(row.requestHash, prepared.requestHash); assert.equal(execution.requestHash, prepared.requestHash);
    assert.equal(row.estimate.transportRequestHash, hash(request)); assert.notEqual(row.requestHash, hash(request));
    assert.equal(row.estimate.requestBytes, Buffer.byteLength(JSON.stringify(request)));
    assert.equal(row.reservedMicrousd, Math.ceil((row.estimate.requestBytes + 8192) * .9 + 6000 * 4));
    assert.equal(row.receipt.outputValidated, true); assert.equal(row.receipt.outputHash, hash(h.state.outputs[role].output));
    assert.equal(row.actual, 1000); assert.equal(row.receipt.completedAt, execution.completedAt);
  }
});
test('synthetic, missing authoritative live input and revoked qualification never call a model', async () => {
  for (const change of [h => { h.state.input.evidenceMode = 'synthetic'; }, h => h.unauthenticate(), h => h.revokeQualification()]) {
    const h = harness(); change(h); assert.equal((await h.run()).status, 'failed'); assert.equal(h.calls.length, 0); assert.equal(h.issued.length, 0);
  }
});
test('fresh price increases stop before reservation, even if the shorter request would fit the old ceiling', async () => {
  const h = harness(); h.hooks.price = model => price(model, { inputPerMillion: .81 });
  assert.equal((await h.run()).reason, 'listing_price_exceeds_approved_ceiling'); assert.equal(h.calls.length, 0); assert.equal(h.ledger.size, 0);
});
test('reviewer price change stops after exactly one paid specialist call', async () => {
  const h = harness(); h.hooks.price = model => price(model, model === B.LISTING_MODELS.reviewer ? { outputPerMillion: 5 } : {});
  assert.equal((await h.run()).reason, 'listing_price_exceeds_approved_ceiling'); assert.equal(h.calls.length, 1); assert.equal(h.issued.length, 0);
  assert.ok(h.state.outputs.specialist); assert.equal(h.ledger.get('specialist').actual, 1000);
});
test('provider actual model and upstream identity, rather than request labels, must match', async () => {
  for (const [phase, change] of [
    ['specialist', r => { r.providerModelId = B.LISTING_MODELS.reviewer; }],
    ['reviewer', r => { r.providerModelId = B.LISTING_MODELS.specialist; }],
    ['reviewer', r => { r.provider = 'OpenAI'; }],
    ['reviewer', r => { r.metadata.actualUpstreamProvider = 'openai'; }],
  ]) {
    const h = harness(); h.hooks.response = (r, role) => { if (role === phase) change(r); return r; };
    assert.equal((await h.run()).reason, 'listing_returned_model_mismatch'); assert.equal(h.issued.length, 0);
    assert.equal(h.calls.length, phase === 'specialist' ? 1 : 2); assert.equal(h.ledger.get(phase).actual, 1000); assert.equal(h.ledger.get(phase).receipt.outputValidated, false);
  }
});
test('missing provider identity, same request identity, and truncated responses cannot issue', async () => {
  for (const change of [r => { r.providerRequestId = null; }, r => { r.providerRequestId = 'fake-specialist'; }, r => { r.metadata.finishReason = 'length'; }]) {
    const h = harness(); h.hooks.response = (r, role) => { if (role === 'reviewer') change(r); return r; };
    assert.equal((await h.run()).status, 'failed'); assert.equal(h.ledger.get('reviewer').actual, 1000); assert.equal(h.issued.length, 0);
  }
});
test('malformed output settles its known charge, stays unvalidated and never leaks rejected body or error text', async () => {
  const secret = 'DO-NOT-STORE-RAW-MODEL-CONTENT';
  const h = harness(); h.hooks.response = r => { r.output = { ...r.output, [secret]: secret }; r.metadata.raw = secret; return r; };
  assert.equal((await h.run()).reason, 'listing_invalid_output'); assert.equal(h.calls.length, 1); assert.equal(h.issued.length, 0);
  const row = h.ledger.get('specialist'); assert.equal(row.actual, 1000); assert.equal(row.receipt.outputValidated, false);
  assert.equal(row.receipt.outputHash, null); assert.equal(row.receipt.completedAt, null);
  assert.ok(!JSON.stringify(row.receipt).includes(secret)); assert.ok(!JSON.stringify(h.events).includes(secret));
});
test('malformed wire JSON preserves adapter error accounting and never performs automatic repair', async () => {
  const h = harness(); let count = 0;
  h.options.adapter = new OpenRouterAdapter({ config: { apiKey: 'fake-offline-fixture', baseUrl: 'https://openrouter.ai/api/v1', appUrl: 'https://example.test', appName: 'Offline test' },
    fetcher: async () => { count++; return new Response(JSON.stringify({ id: 'malformed-wire-request', model: B.LISTING_MODELS.specialist, provider: 'OpenAI',
      choices: [{ finish_reason: 'stop', message: { content: '{"raw-private-text":' } }], usage: { cost: .0042 } }), { status: 200 }); } });
  assert.equal((await h.run()).reason, 'listing_provider_failed'); assert.equal(count, 1); assert.equal(h.issued.length, 0);
  const row = h.ledger.get('specialist'); assert.equal(row.actual, 4200); assert.equal(row.requestId, 'malformed-wire-request'); assert.equal(row.receipt.outputValidated, false);
  assert.ok(!JSON.stringify(row.receipt).includes('raw-private-text'));
});
test('unknown, nonfinite, negative or unsafe costs stop before persistence and the next phase', async () => {
  for (const cost of [null, undefined, NaN, Infinity, -1, Number.MAX_SAFE_INTEGER]) {
    const h = harness(); h.hooks.response = r => { r.usage.reportedCostUsd = cost; return r; };
    assert.equal((await h.run()).reason, 'listing_unknown_provider_charge'); assert.equal(h.calls.length, 1); assert.equal(h.issued.length, 0);
    const row = h.ledger.get('specialist'); assert.equal(row.actual, null); assert.equal(row.receipt.unknownCharge, true); assert.equal(row.receipt.outputValidated, true);
    assert.equal(h.state.outputs.specialist, undefined);
  }
});
test('known actual overspend is retained and stops reviewer regardless of initial estimate', async () => {
  const h = harness(); h.hooks.response = r => { r.usage.reportedCostUsd = 1.25; return r; };
  assert.equal((await h.run()).reason, 'listing_actual_cost_exceeds_cap'); assert.equal(h.calls.length, 1); assert.equal(h.issued.length, 0);
  assert.equal(h.ledger.get('specialist').actual, 1_250_000); assert.equal(h.ledger.get('specialist').receipt.outputValidated, true);
});
test('settlement storage failure cannot cause another call or output persistence', async () => {
  const h = harness(); h.hooks.settle = () => { throw new Error('storage unavailable'); };
  assert.equal((await h.run()).reason, 'listing_settlement_failed'); assert.equal(h.calls.length, 1); assert.equal(h.issued.length, 0); assert.equal(h.state.outputs.specialist, undefined);
});
test('timeout and reserved-without-output resume never resend a paid attempt', async () => {
  const h = harness(); h.hooks.invoke = () => { throw new ModelProviderError('provider_timeout', 'RAW-ERROR-MUST-NOT-LEAK', true,
    { providerReceipt: { provider: 'OpenAI', providerModelId: B.LISTING_MODELS.specialist, providerRequestId: 'timed-out-request', usage: { reportedCostUsd: null }, raw: 'PRIVATE' } }); };
  assert.equal((await h.run()).reason, 'listing_provider_failed'); assert.equal(h.calls.length, 1);
  h.state.status = 'running'; delete h.hooks.invoke;
  assert.equal((await h.run()).reason, 'listing_attempt_already_reserved'); assert.equal(h.calls.length, 1); assert.equal(h.issued.length, 0);
  assert.equal(h.ledger.get('specialist').requestId, 'timed-out-request'); assert.ok(!JSON.stringify(h.ledger.get('specialist').receipt).includes('PRIVATE'));
});
test('durably persisted output replay skips the completed model call', async () => {
  const h = harness(); h.hooks.price = (_model, count) => { if (count === 2) throw new Error('temporary price lookup interruption'); };
  assert.equal((await h.run()).status, 'failed'); assert.equal(h.calls.length, 1); assert.ok(h.state.outputs.specialist);
  h.state.status = 'running'; delete h.hooks.price;
  assert.equal((await h.run()).status, 'completed'); assert.equal(h.calls.length, 2);
  assert.deepEqual(h.calls.map(r => r.requestMetadata.role), ['specialist', 'reviewer']); assert.equal(h.issued.length, 1);
  assert.equal((await h.run()).status, 'completed'); assert.equal(h.calls.length, 2); assert.equal(h.issued.length, 1);
});
test('lost output-persistence and finalization acknowledgements recover only by exact readback', async () => {
  const h = harness(); h.hooks.afterPersist = () => { throw new Error('write committed but acknowledgement lost'); };
  h.hooks.afterFinish = () => { throw new Error('finish acknowledgement lost'); };
  assert.equal((await h.run()).status, 'completed'); assert.equal(h.calls.length, 2); assert.equal(h.issued.length, 1);
  assert.equal(h.events.filter(e => e.startsWith('persist:')).length, 2); assert.equal(h.events.filter(e => e === 'finish').length, 1);
});
test('REJECT and NEEDS_EVIDENCE persist terminal independent reviews without calling issuer', async () => {
  for (const [verdict, status] of [['REJECT', 'failed'], ['NEEDS_EVIDENCE', 'needs_evidence']]) {
    const h = harness(); h.fixture.review.verdict = verdict; h.fixture.review.checks.title.status = status;
    assert.equal((await h.run()).status, verdict === 'REJECT' ? 'rejected' : 'needs_evidence');
    assert.equal(h.calls.length, 2); assert.ok(h.state.outputs.reviewer); assert.equal(h.issued.length, 0);
    assert.equal((await h.run()).status, h.state.status); assert.equal(h.calls.length, 2);
  }
});
test('caller mutation during pricing cannot change a paid request or broaden scope', async () => {
  for (const mutate of [h => { h.state.input.facts[0].statement = 'Altered source'; }, h => { h.state.maximumMicrousd--; },
    h => { h.state.workerHashes.specialist = 'c'.repeat(64); }, h => { h.state.knowledgeHash = 'c'.repeat(64); },
    h => { h.state.taskIds.specialist = id(99); }, h => { h.state.quote.ceilings.specialist++; }]) {
    const h = harness(); h.hooks.price = () => { mutate(h); };
    assert.equal((await h.run()).status, 'failed'); assert.equal(h.calls.length, 0); assert.equal(h.issued.length, 0);
  }
});
test('pre-dispatch cancellation or source/qualification revocation leaves reservation consumed without calling', async () => {
  for (const mutate of [h => { h.state.status = 'cancelled'; }, h => h.unauthenticate(), h => h.revokeQualification()]) {
    const h = harness(); h.hooks.afterReserve = () => mutate(h);
    assert.ok(['cancelled', 'failed'].includes((await h.run()).status)); assert.equal(h.calls.length, 0); assert.equal(h.ledger.size, 1); assert.equal(h.issued.length, 0);
    assert.equal(h.ledger.get('specialist').actual, undefined);
  }
});
test('cancellation during a model call still settles the actual charge, with no persistence or issue', async () => {
  const h = harness(); h.hooks.invoke = () => { h.state.status = 'cancelled'; };
  assert.equal((await h.run()).status, 'cancelled'); assert.equal(h.calls.length, 1); assert.equal(h.issued.length, 0);
  assert.equal(h.ledger.get('specialist').actual, 1000); assert.equal(h.state.outputs.specialist, undefined);
});
test('source change during paid call or cancellation during persistence blocks next phase and issuer', async () => {
  for (const setup of [h => { h.hooks.invoke = () => { h.state.input.product.title = 'Changed input'; }; },
    h => { h.hooks.beforePersist = () => { h.state.status = 'cancelled'; }; }]) {
    const h = harness(); setup(h); assert.ok(['failed', 'cancelled'].includes((await h.run()).status));
    assert.equal(h.calls.length, 1); assert.equal(h.ledger.get('specialist').actual, 1000); assert.equal(h.issued.length, 0);
  }
});
test('scope is rechecked after issuer await and finish cannot commit a cancelled run', async () => {
  const h = harness(); h.hooks.issue = () => { h.state.status = 'cancelled'; };
  assert.equal((await h.run()).status, 'cancelled'); assert.equal(h.calls.length, 2); assert.equal(h.issued.length, 1);
  assert.ok(!h.events.includes('finish'));
});
test('requests, reservation context, persisted outputs and issuer inputs are deeply frozen snapshots', async () => {
  const h = harness(); h.hooks.reserve = value => {
    assert.ok(Object.isFrozen(value)); assert.ok(Object.isFrozen(value.context.inputArtifacts[0].content.input.facts));
    assert.throws(() => { value.context.inputArtifacts[0].content.input.facts[0].statement = 'mutated'; }, TypeError);
  };
  h.hooks.invoke = request => {
    assert.ok(Object.isFrozen(request)); assert.ok(Object.isFrozen(request.messages[0])); assert.ok(Object.isFrozen(request.providerOnly));
    assert.throws(() => { request.model.providerModelId = 'other/model'; }, TypeError);
    // Options mutation cannot replace methods captured before the first await.
    h.options.prices = async () => { throw new Error('mutated option must never run'); };
  };
  h.hooks.beforePersist = value => { assert.ok(Object.isFrozen(value.output)); assert.ok(Object.isFrozen(value.execution)); };
  h.hooks.issue = (product, record) => { assert.ok(Object.isFrozen(product.images)); assert.ok(Object.isFrozen(record.input.facts)); };
  assert.equal((await h.run()).status, 'completed'); assert.equal(h.calls.length, 2);
});
test('a corrupt persisted output cannot be replayed or issued', async () => {
  const h = harness(); h.hooks.price = (_model, count) => { if (count === 2) throw new Error('pause'); };
  await h.run(); h.state.status = 'running'; delete h.hooks.price;
  h.state.outputs.specialist.output.title.text = 'Forged output';
  assert.equal((await h.run()).status, 'failed'); assert.equal(h.calls.length, 1); assert.equal(h.issued.length, 0);
});
test('mutable SQL display totals and internal envelope fields are not immutable execution scope', async () => {
  const h = harness(); h.state.costs = { committedMicrousd: 0 }; h.state.reason = null; h.state.sourceEnvelope = 'internal-envelope';
  h.hooks.guard = count => { h.state.costs.committedMicrousd = count; h.state.reason = 'display-only'; };
  assert.equal((await h.run()).status, 'completed'); assert.equal(h.calls.length, 2);
});
test('zero-priced calls remain finite and reserve exactly zero', async () => {
  const h = harness(), free = model => price(model, { inputPerMillion: 0, outputPerMillion: 0, cacheWritePerMillion: 0 });
  h.state.quote = B.quoteListing(h.state.inputHash, h.state.maximumMicrousd, { specialist: free(B.LISTING_MODELS.specialist), reviewer: free(B.LISTING_MODELS.reviewer) }, NOW);
  h.hooks.price = free; h.hooks.response = r => { r.usage.reportedCostUsd = 0; return r; };
  assert.equal((await h.run()).status, 'completed'); assert.equal(h.calls.length, 2);
  for (const row of h.ledger.values()) { assert.equal(row.reservedMicrousd, 0); assert.equal(row.actual, 0); }
});
test('quote expiry during reservation consumes the attempt but never dispatches it', async () => {
  const h = harness(); const originalNow = Date.now;
  try {
    h.hooks.afterReserve = () => { Date.now = () => NOW + 300_001; };
    assert.equal((await h.run()).status, 'failed'); assert.equal(h.calls.length, 0); assert.equal(h.ledger.size, 1);
  } finally { Date.now = originalNow; }
});
test('a response-provided fake execution receipt is rejected rather than trusted', async () => {
  const h = harness(); h.hooks.response = r => { r.output.execution = { mode: 'live_model', outputValidated: true, providerRequestId: 'invented' }; return r; };
  assert.equal((await h.run()).reason, 'listing_invalid_output'); assert.equal(h.calls.length, 1);
  assert.equal(h.ledger.get('specialist').receipt.outputHash, null); assert.equal(h.issued.length, 0);
});
test('decimal price arithmetic agrees with SQL numeric without floating-point extra microdollars', () => {
  const h = harness(), q = price(B.LISTING_MODELS.specialist, { inputPerMillion: .1, cacheWritePerMillion: .2, outputPerMillion: 0 });
  const approved = B.quoteListing(h.state.inputHash, 1_000_000, { specialist: q, reviewer: price(B.LISTING_MODELS.reviewer) }, NOW);
  const prepared = prepareListingTask(h.state.input, 'specialist', h.state.taskIds.specialist, undefined, NOW);
  const request = { ...prepared.request, providerOnly: ['openai'], providerPriceLimit: { prompt: .1, completion: 0, request: 0 } };
  while ((Buffer.byteLength(JSON.stringify(request)) + 8192) % 10) request.messages[0].content += ' ';
  const reservation = B.listingCallReservation('specialist', request, q, approved, 1_000_000, NOW);
  assert.equal(reservation.reservedMicrousd, (Buffer.byteLength(JSON.stringify(request)) + 8192) * 3 / 10);
});
