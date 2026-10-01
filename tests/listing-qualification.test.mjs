import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Q = require('../.core-tests/listing/qualification.js');
const B = require('../.core-tests/listing/budget.js');
const { listingFixture, listingFixtureId: id } = require('../.core-tests/listing/fixtures.js');
const { listingWorker } = require('../.core-tests/listing/packs.js');
const { listingKnowledgeHash } = require('../.core-tests/listing/knowledge.js');
const { validateListingInput } = require('../.core-tests/listing/contracts.js');
const { hash } = require('../.core-tests/etsy/contracts.js');
const { OpenRouterAdapter } = require('../.core-tests/models/openrouter.js');
const { ModelProviderError } = require('../.core-tests/models/types.js');
const { assertJsonSchemaValue } = require('../.core-tests/workers/schema-validator.js');
const { projectProviderJsonSchema } = require('../.core-tests/models/openrouter.js');
const NOW = Date.parse('2026-10-01T10:50:00Z');
test.before(() => {
  mock.method(Date, 'now', () => NOW);
  mock.method(globalThis, 'fetch', async () => { throw new Error('Network forbidden in offline qualification tests'); });
});
test.after(() => mock.restoreAll());
const price = (modelId, override = {}) => ({ modelId, source: B.LISTING_PRICING_SOURCE, verifiedAt: new Date(NOW).toISOString(), inputPerMillion: .8, outputPerMillion: 4, cacheWritePerMillion: .1, ...override });
const modelPrices = () => ({ specialist: price(B.LISTING_MODELS.specialist), reviewer: price(B.LISTING_MODELS.reviewer) });
function passingOutput(key) {
  const f = listingFixture(Q.LISTING_QUALIFICATION_TEST_TIME);
  if (key.startsWith('specialist')) return f.proposal;
  if (key === 'reviewer_reject_claim') {
    f.review.verdict = 'REJECT'; f.review.checks.factualClaims = { status: 'failed', rationale: 'The organic certification and guaranteed overnight delivery are unsupported by the garment evidence and must be removed.' };
    f.review.checks.description = { status: 'failed', rationale: 'The added description promises organic cotton certification and overnight delivery without any corresponding verified source.' };
  }
  if (key === 'reviewer_needs_image') {
    f.review.verdict = 'NEEDS_EVIDENCE'; f.review.checks.imageOrder = { status: 'needs_evidence', rationale: 'The cropped image observation cannot resolve the exact garment, white color and fern placement; complete product evidence is missing.' };
  }
  return f.review;
}
/** This injected harness does NOT write qualification records or attestations.
 * Fake model receipts test orchestration only, never live worker competence. */
function harness() {
  const state = { id: id(100), businessId: id(2), status: 'queued', suiteHash: Q.listingQualificationSuiteHash(), knowledgeHash: listingKnowledgeHash(),
    workerHashes: { specialist: hash(listingWorker('specialist').manifest), reviewer: hash(listingWorker('reviewer').manifest) }, maximumMicrousd: 1_000_000,
    quote: Q.quoteListingQualification(1_000_000, modelPrices(), NOW), taskIds: Object.fromEntries(Q.LISTING_QUALIFICATION_CASE_KEYS.map((key, n) => [key, id(110 + n)])), cases: {} };
  const ledger = new Map(), calls = [], events = [], hooks = {}; let finishes = 0, reads = 0;
  const total = () => [...ledger.values()].reduce((sum, row) => sum + (typeof row.actual === 'number' ? row.actual : row.reservedMicrousd), 0);
  const check = () => { if (total() > state.maximumMicrousd) throw new Error('Over cap');
    for (const key of Object.keys(state.cases)) if (typeof ledger.get(key)?.actual !== 'number' || ledger.get(key)?.receipt.casePassed !== true) throw new Error('Unknown or ungraded receipt'); };
  const repo = {
    async load() { events.push('load'); return state; },
    async guard() { events.push('guard'); await hooks.guard?.(++reads); check(); return state; },
    async reserve(value) {
      events.push(`reserve:${value.caseKey}`); await hooks.reserve?.(value); check();
      if (ledger.has(value.caseKey)) return { shouldExecute: false, committedMicrousd: total() };
      if (!['queued', 'running'].includes(state.status) || total() + value.reservedMicrousd > state.maximumMicrousd) throw new Error('Reservation denied');
      ledger.set(value.caseKey, structuredClone(value)); state.status = 'running'; await hooks.afterReserve?.(value);
      return { shouldExecute: true, committedMicrousd: total() };
    },
    async settle(value) { events.push(`settle:${value.caseKey}`); const row = ledger.get(value.caseKey); assert.ok(row);
      row.actual = value.reportedMicrousd; row.requestId = value.providerRequestId; row.receipt = structuredClone(value.receipt); await hooks.settle?.(value); },
    async persist(value) {
      events.push(`persist:${value.caseKey}`); await hooks.beforePersist?.(value); check();
      if (!['queued', 'running'].includes(state.status)) throw new Error('Inactive');
      const row = ledger.get(value.caseKey); assert.equal(typeof row.actual, 'number'); assert.equal(row.receipt.casePassed, true); assert.equal(row.receipt.outputHash, hash(value.output));
      state.cases[value.caseKey] = structuredClone({ output: value.output, receipt: row.receipt, passed: true }); await hooks.afterPersist?.(value);
    },
    async finish() {
      events.push('finish'); await hooks.beforeFinish?.(); check();
      if (!['queued', 'running'].includes(state.status)) throw new Error('Inactive');
      assert.equal(Object.keys(state.cases).length, 5); finishes++; state.status = 'passed'; await hooks.afterFinish?.();
    },
    async fail(reason) { events.push(`fail:${reason}`); if (['queued', 'running'].includes(state.status)) state.status = 'failed'; },
  };
  const options = { async prices(model) { events.push(`price:${model}`); return await hooks.price?.(model) ?? price(model); },
    adapter: { async invokeStructured(request) {
      calls.push(request); const key = request.requestMetadata.caseKey; events.push(`invoke:${key}`); await hooks.invoke?.(request);
      const response = { output: passingOutput(key), provider: request.requestMetadata.role === 'specialist' ? 'OpenAI' : 'Anthropic', providerModelId: request.model.providerModelId,
        providerRequestId: `offline-${key}`, latencyMs: 5, usage: { inputTokens: 100, outputTokens: 100, totalTokens: 200, cachedInputTokens: 0, reasoningTokens: 0, reportedCostUsd: .001, estimatedCostUsd: .001 }, metadata: { finishReason: 'stop' } };
      return await hooks.response?.(response, key) ?? response;
    } } };
  return { state, ledger, calls, events, hooks, repo, options, finishes: () => finishes, run: () => Q.executeListingQualification(repo, options) };
}

test('five immutable server-owned cases remain explicitly synthetic and hash-bound', () => {
  const cases = Q.qualificationCases(); assert.equal(cases.length, 5); assert.deepEqual(cases.map(c => c.key), Q.LISTING_QUALIFICATION_CASE_KEYS);
  assert.equal(cases.filter(c => c.role === 'specialist').length, 2); assert.equal(cases.filter(c => c.role === 'reviewer').length, 3);
  for (const c of cases) { assert.equal(c.input.evidenceMode, 'synthetic'); validateListingInput(c.input, Q.LISTING_QUALIFICATION_TEST_TIME); assert.ok(Object.isFrozen(c.input.sources[0].snapshot)); }
  assert.throws(() => { cases[0].input.facts[0].statement = 'mutated'; }, TypeError);
  assert.equal(Q.listingQualificationSuiteHash(), Q.listingQualificationSuiteHash());
  assert.deepEqual(cases[0].input.facts, cases[1].input.facts); assert.match(cases[1].input.sources[0].snapshot.untrustedInstruction, /organic.*guaranteed.*omit/i);
  assert.match(cases[3].proposal.description.at(-1).text, /organic.*guaranteed/i);
  assert.equal(cases[4].input.imagery[0].reviewResult.outcome, 'PASS'); assert.match(cases[4].input.imagery[0].reviewResult.observedProduct, /cropped.*does not resolve/i);
});
test('finite specialist grading requires exact verified copy-bank units, supporting facts and coverage', () => {
  for (const key of ['specialist_grounded', 'specialist_injection']) assert.equal(Q.gradeListingQualificationCase(key, passingOutput(key)).passed, true);
  for (const mutate of [p => { p.description[0].text += ' Organic and certified.'; }, p => { p.description[0].text += ' 有机'; }, p => { p.description[0].text += '\u200b'; }, p => { p.title.text = 'Green cotton shirt with a white fern print'; },
    p => { p.description[0].text = 'The cotton shirt is green. The fern print is white.'; }, p => { p.description[0].text = 'The fern illustration is printed in white on this cotton shirt.'; },
    p => { p.description[0].factIds = ['production']; }, p => { p.tags[0].factIds.push('ai-design'); },
    p => { p.title.text = 'Fern shirt'; p.description[0].text = 'A fern print shirt.'; }, p => { p.disclosureKeys = ['production_partner']; }]) {
    const output = passingOutput('specialist_grounded'); mutate(output); assert.throws(() => Q.gradeListingQualificationCase('specialist_grounded', output));
  }
});
test('the same finite bank is exposed in model context, projected schema and local grading', () => {
  const bank = Q.qualificationCopyBank(), c = Q.qualificationCases()[0], schema = Q.listingQualificationProposalSchema(c.input);
  assert.ok(Object.isFrozen(bank.titles[0])); assert.throws(() => { bank.tags[0].text = 'organic'; }, TypeError);
  const canonical = value => JSON.parse(JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item));
  for (const title of bank.titles) for (const paragraph of bank.paragraphs) {
    const proposal = passingOutput('specialist_grounded'); proposal.title = structuredClone(title); proposal.description = [structuredClone(paragraph)]; proposal.tags = structuredClone(bank.tags);
    assert.equal(Q.gradeListingQualificationCase('specialist_grounded', proposal).passed, true);
    assertJsonSchemaValue(schema, canonical(proposal), 'Local finite bank'); assertJsonSchemaValue(projectProviderJsonSchema(schema), canonical(proposal), 'Projected finite bank');
  }
  const request = Q.prepareListingQualificationCase('specialist_grounded', id(211));
  assert.deepEqual(request.context.inputArtifacts[0].content.copyBank, bank);
  assert.match(request.request.messages.map(m => m.content).join('\n'), /bounded grounded-copy\/template selection/);
  assert.ok(schema.properties.title.anyOf.length === bank.titles.length);
  const paraphrase = passingOutput('specialist_grounded'); paraphrase.description[0].text = 'The shirt is cotton and white, with a fern design.';
  assert.throws(() => Q.gradeListingQualificationCase('specialist_grounded', paraphrase), /copy_not_in_bank/);
  assert.throws(() => assertJsonSchemaValue(projectProviderJsonSchema(schema), canonical(paraphrase), 'Unknown paraphrase'));
  const duplicate = passingOutput('specialist_grounded'); duplicate.description.push(structuredClone(duplicate.description[0]));
  assert.throws(() => Q.gradeListingQualificationCase('specialist_grounded', duplicate));
});
test('reviewer grading demands exact verdict, target check, valid seven reasons and concrete adverse rationale', () => {
  for (const key of Q.LISTING_QUALIFICATION_CASE_KEYS.filter(k => k.startsWith('reviewer'))) assert.equal(Q.gradeListingQualificationCase(key, passingOutput(key)).passed, true);
  assert.throws(() => Q.gradeListingQualificationCase('reviewer_reject_claim', passingOutput('reviewer_approve')));
  assert.throws(() => Q.gradeListingQualificationCase('reviewer_needs_image', passingOutput('reviewer_approve')));
  const generic = passingOutput('reviewer_reject_claim'); generic.checks.factualClaims.rationale = 'The output has a concern that needs to be addressed before acceptance.';
  assert.throws(() => Q.gradeListingQualificationCase('reviewer_reject_claim', generic), /unsubstantiated_reason/);
  const wrong = passingOutput('reviewer_needs_image'); wrong.checks.imageOrder.status = 'passed'; wrong.checks.title.status = 'needs_evidence';
  assert.throws(() => Q.gradeListingQualificationCase('reviewer_needs_image', wrong), /wrong_review/);
  const missing = passingOutput('reviewer_approve'); delete missing.checks.tags; assert.throws(() => Q.gradeListingQualificationCase('reviewer_approve', missing));
});
test('case requests use full fixed context, no fake specialist execution and no expected answer leakage in messages', () => {
  for (const [n, c] of Q.qualificationCases().entries()) {
    const p = Q.prepareListingQualificationCase(c.key, id(210 + n)), joined = p.request.messages.map(m => m.content).join('\n');
    assert.equal(p.requestHash, hash(p.request)); assert.equal(p.request.model.providerModelId, B.LISTING_MODELS[c.role]); assert.equal(p.request.maxOutputTokens, 6000);
    assert.ok(Buffer.byteLength(JSON.stringify(p.request)) < 64_000); assert.ok(joined.includes(c.input.facts[0].statement));
    assert.ok(joined.includes(c.input.imagery[0].reviewResult.observedProduct)); assert.equal(p.context.inputArtifacts[0].content.input.evidenceMode, 'synthetic');
    assert.equal(p.context.inputArtifacts[0].content.evaluationTime, '2026-10-01T10:00:00.000Z'); assert.match(joined, /fixed reference time 2026-10-01T10:00:00.000Z/);
    assert.equal(p.context.inputArtifacts[0].content.specialistExecution, undefined); assert.deepEqual(p.context.taskContract.permittedCapabilities, []);
    assert.ok(!joined.includes('expectedVerdict')); assert.ok(!joined.includes(c.key)); assert.equal(p.request.requireReturnedModel, true);
    if (c.role === 'reviewer') assert.equal(p.context.inputArtifacts[0].content.proposalOrigin, 'server_owned_test_case');
  }
});
test('five-call complete quote bounds two specialist and three reviewer calls under a separate cap', async () => {
  const q = Q.quoteListingQualification(1_000_000, modelPrices(), NOW), p = B.quoteListing(Q.listingQualificationSuiteHash(), 1_000_000, modelPrices(), NOW);
  assert.equal(q.maximumCalls, 5); assert.equal(q.maximumEstimateMicrousd, 2 * p.ceilings.specialist + 3 * p.ceilings.reviewer);
  assert.equal(q.estimateOnly, true); assert.equal(q.providerInvoiceGuarantee, false);
  assert.throws(() => Q.quoteListingQualification(q.maximumEstimateMicrousd - 1, modelPrices(), NOW), /exceeds_cap/);
  assert.throws(() => Q.quoteListingQualification(1_000_001, modelPrices(), NOW));
  const fetched = []; assert.equal((await Q.qualificationQuote(1_000_000, async model => { fetched.push(model); return price(model); })).maximumCalls, 5);
  assert.deepEqual(fetched, Object.values(B.LISTING_MODELS));
});
test('full five-call fake OpenRouter wire test reaches only the injected finish sink, never real qualification', async () => {
  const h = harness(), wires = []; let call = 0;
  h.options.adapter = new OpenRouterAdapter({ config: { apiKey: 'offline-not-a-real-key', baseUrl: 'https://openrouter.ai/api/v1', appUrl: 'https://example.test', appName: 'Offline qualification test' },
    fetcher: async (_url, init) => {
      const key = Q.LISTING_QUALIFICATION_CASE_KEYS[call++], wire = JSON.parse(init.body); wires.push(wire);
      return new Response(JSON.stringify({ id: `wire-${key}`, model: wire.model, provider: key.startsWith('specialist') ? 'OpenAI' : 'Anthropic',
        usage: { prompt_tokens: 100, completion_tokens: 100, cost: .001 }, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(passingOutput(key)) } }] }), { status: 200 });
    } });
  assert.deepEqual(await h.run(), { status: 'passed' }); assert.equal(wires.length, 5); assert.equal(h.finishes(), 1);
  assert.deepEqual(wires.map(w => w.model), [B.LISTING_MODELS.specialist, B.LISTING_MODELS.specialist, ...Array(3).fill(B.LISTING_MODELS.reviewer)]);
  for (const [n, wire] of wires.entries()) {
    assert.equal(wire.max_tokens, 6000); assert.equal(wire.provider.allow_fallbacks, false); assert.deepEqual(wire.provider.only, [n < 2 ? 'openai' : 'anthropic']);
    assert.ok(wire.messages.every(m => typeof m.content === 'string')); assert.equal(wire.tools, undefined);
    const receipt = h.ledger.get(Q.LISTING_QUALIFICATION_CASE_KEYS[n]).receipt;
    assert.equal(receipt.provider, 'openrouter'); assert.equal(receipt.upstreamProvider, n < 2 ? 'OpenAI' : 'Anthropic'); assert.equal(receipt.casePassed, true);
  }
  assert.equal(new Set([...h.ledger.values()].map(r => r.requestId)).size, 5);
});
test('semantic request and exact pinned transport fingerprints settle before each persisted case', async () => {
  const h = harness(); assert.equal((await h.run()).status, 'passed');
  for (const key of Q.LISTING_QUALIFICATION_CASE_KEYS) {
    const row = h.ledger.get(key), request = h.calls.find(r => r.requestMetadata.caseKey === key), prepared = Q.prepareListingQualificationCase(key, h.state.taskIds[key]);
    assert.equal(row.requestHash, prepared.requestHash); assert.equal(row.estimate.transportRequestHash, hash(request)); assert.notEqual(row.requestHash, hash(request));
    assert.equal(row.actual, 1000); assert.equal(row.receipt.reportedMicrousd, 1000); assert.equal(row.receipt.outputHash, hash(h.state.cases[key].output));
    assert.equal(row.receipt.executionMode, 'listing.qualification'); assert.equal(row.receipt.suiteHash, h.state.suiteHash);
    assert.ok(h.events.indexOf(`settle:${key}`) < h.events.indexOf(`persist:${key}`));
  }
});
test('failure on any of five fixed cases stops without qualification or unrequested repair', async () => {
  for (const failed of Q.LISTING_QUALIFICATION_CASE_KEYS) {
    const h = harness(); h.hooks.response = (r, key) => { if (key === failed) r.output = key.startsWith('specialist') ? { ...r.output, surprise: 'raw private output' } : passingOutput(key === 'reviewer_approve' ? 'reviewer_reject_claim' : 'reviewer_approve'); return r; };
    assert.equal((await h.run()).reason, 'listing_qualification_case_failed'); assert.equal(h.calls.length, Q.LISTING_QUALIFICATION_CASE_KEYS.indexOf(failed) + 1);
    assert.equal(h.finishes(), 0); assert.equal(h.ledger.get(failed).actual, 1000); assert.equal(h.ledger.get(failed).receipt.casePassed, false);
    assert.equal(h.ledger.get(failed).receipt.outputHash, null); assert.equal(h.state.cases[failed], undefined);
    assert.ok(!JSON.stringify(h.ledger.get(failed).receipt).includes('raw private output'));
  }
});
test('actual returned model/upstream and unique request identity are checked independently of route labels', async () => {
  for (const mutate of [r => { r.providerModelId = B.LISTING_MODELS.specialist; }, r => { r.provider = 'OpenAI'; },
    r => { r.metadata.actualUpstreamProvider = 'openai'; }, r => { r.providerRequestId = null; }, r => { r.providerRequestId = 'offline-specialist_grounded'; }]) {
    const h = harness(); h.hooks.response = (r, key) => { if (key === 'reviewer_approve') mutate(r); return r; };
    assert.equal((await h.run()).status, 'failed'); assert.equal(h.calls.length, 3); assert.equal(h.finishes(), 0); assert.equal(h.ledger.get('reviewer_approve').actual, 1000);
  }
});
test('missing, malformed and unknown costs preserve uncertainty and stop all later cases', async () => {
  for (const cost of [null, undefined, NaN, Infinity, -1, Number.MAX_SAFE_INTEGER]) {
    const h = harness(); h.hooks.response = r => { r.usage.reportedCostUsd = cost; return r; };
    assert.equal((await h.run()).reason, 'listing_qualification_unknown_charge'); assert.equal(h.calls.length, 1); assert.equal(h.finishes(), 0);
    const row = h.ledger.get('specialist_grounded'); assert.equal(row.actual, null); assert.equal(row.receipt.unknownCharge, true); assert.equal(row.receipt.casePassed, true);
  }
});
test('malformed wire provider error preserves a known charge and fixed safe failure metadata', async () => {
  const h = harness(); h.hooks.invoke = () => { throw new ModelProviderError('malformed_model_output', 'PRIVATE MODEL BODY', true,
    { providerReceipt: { provider: 'OpenAI', providerModelId: B.LISTING_MODELS.specialist, providerRequestId: 'failed-request', usage: { reportedCostUsd: .0042 }, rawOutput: 'PRIVATE' } }); };
  assert.equal((await h.run()).reason, 'listing_qualification_provider_failed'); const row = h.ledger.get('specialist_grounded');
  assert.equal(row.actual, 4200); assert.equal(row.requestId, 'failed-request'); assert.equal(row.receipt.casePassed, false); assert.ok(!JSON.stringify(row.receipt).includes('PRIVATE')); assert.equal(h.finishes(), 0);
});
test('known overspend and settlement failure both stop before another paid call', async () => {
  const h = harness(); h.hooks.response = r => { r.usage.reportedCostUsd = 1.1; return r; };
  assert.equal((await h.run()).reason, 'listing_qualification_actual_cost_exceeds_cap'); assert.equal(h.calls.length, 1); assert.equal(h.ledger.get('specialist_grounded').actual, 1_100_000); assert.equal(h.finishes(), 0);
  const broken = harness(); broken.hooks.settle = () => { throw new Error('database unavailable'); };
  assert.equal((await broken.run()).reason, 'listing_qualification_settlement_failed'); assert.equal(broken.calls.length, 1); assert.equal(broken.finishes(), 0);
});
test('timeout/reservation uncertainty never retries even when the run is manually resumed in the fake repository', async () => {
  const h = harness(); h.hooks.invoke = () => { throw new ModelProviderError('provider_timeout', 'timeout', true); };
  assert.equal((await h.run()).status, 'failed'); h.state.status = 'running'; delete h.hooks.invoke;
  assert.equal((await h.run()).reason, 'listing_qualification_attempt_already_reserved'); assert.equal(h.calls.length, 1); assert.equal(h.finishes(), 0);
});
test('persisted graded cases are replayed without reissuing model calls; lost acknowledgements read back exactly', async () => {
  const h = harness(); let n = 0; h.hooks.price = () => { if (++n === 3) throw new Error('pause'); };
  assert.equal((await h.run()).status, 'failed'); assert.equal(h.calls.length, 2); assert.equal(Object.keys(h.state.cases).length, 2);
  h.state.status = 'running'; delete h.hooks.price; h.hooks.afterPersist = () => { throw new Error('committed acknowledgement lost'); }; h.hooks.afterFinish = () => { throw new Error('finish acknowledgement lost'); };
  assert.equal((await h.run()).status, 'passed'); assert.equal(h.calls.length, 5); assert.equal(h.finishes(), 1);
  assert.equal((await h.run()).status, 'passed'); assert.equal(h.calls.length, 5); assert.equal(h.finishes(), 1);
});
test('price changes and stale quotes block before dispatch, with no sixth or fallback call', async () => {
  const h = harness(); h.hooks.price = model => price(model, { inputPerMillion: 1 });
  assert.equal((await h.run()).reason, 'listing_qualification_price_exceeds_ceiling'); assert.equal(h.calls.length, 0);
  const expired = harness(), originalNow = Date.now;
  try { expired.hooks.afterReserve = () => { Date.now = () => NOW + 300_001; }; assert.equal((await expired.run()).status, 'failed'); assert.equal(expired.calls.length, 0); assert.equal(expired.ledger.size, 1); }
  finally { Date.now = originalNow; }
});
test('run scope, worker, knowledge, task IDs and suite drift during awaits cannot dispatch', async () => {
  for (const mutate of [s => { s.suiteHash = 'b'.repeat(64); }, s => { s.maximumMicrousd--; }, s => { s.knowledgeHash = 'c'.repeat(64); },
    s => { s.workerHashes.specialist = 'd'.repeat(64); }, s => { s.taskIds.specialist_grounded = id(999); }]) {
    const h = harness(); h.hooks.price = () => { mutate(h.state); };
    assert.equal((await h.run()).status, 'failed'); assert.equal(h.calls.length, 0); assert.equal(h.finishes(), 0);
  }
});
test('cancellation before dispatch consumes reservation; cancellation in flight still settles actual cost', async () => {
  const before = harness(); before.hooks.afterReserve = () => { before.state.status = 'cancelled'; };
  assert.equal((await before.run()).status, 'cancelled'); assert.equal(before.calls.length, 0); assert.equal(before.ledger.get('specialist_grounded').actual, undefined);
  const during = harness(); during.hooks.invoke = () => { during.state.status = 'cancelled'; };
  assert.equal((await during.run()).status, 'cancelled'); assert.equal(during.calls.length, 1); assert.equal(during.ledger.get('specialist_grounded').actual, 1000); assert.equal(during.finishes(), 0);
});
test('cancelled persist and a forged saved case cannot reach the attestation finish boundary', async () => {
  const h = harness(); h.hooks.beforePersist = () => { h.state.status = 'cancelled'; };
  assert.equal((await h.run()).status, 'cancelled'); assert.equal(h.finishes(), 0);
  const corrupt = harness(); let n = 0; corrupt.hooks.price = () => { if (++n === 2) throw new Error('pause'); };
  await corrupt.run(); corrupt.state.status = 'running'; delete corrupt.hooks.price; corrupt.state.cases.specialist_grounded.receipt.outputHash = 'a'.repeat(64);
  assert.equal((await corrupt.run()).status, 'failed'); assert.equal(corrupt.calls.length, 1); assert.equal(corrupt.finishes(), 0);
});
test('caller-controlled request, context and output mutation cannot alter a captured paid case', async () => {
  const h = harness(); h.hooks.reserve = value => { assert.ok(Object.isFrozen(value.context)); assert.throws(() => { value.context.inputArtifacts[0].content.input.aiAssisted = false; }, TypeError); };
  h.hooks.invoke = request => { assert.ok(Object.isFrozen(request.messages[0])); assert.throws(() => { request.providerOnly[0] = 'other'; }, TypeError); h.options.prices = async () => { throw new Error('must not replace captured method'); }; };
  h.hooks.beforePersist = value => { assert.ok(Object.isFrozen(value.output)); };
  assert.equal((await h.run()).status, 'passed'); assert.equal(h.calls.length, 5);
});
test('current policy freshness is checked independently of fixed synthetic fixture clock', async () => {
  const h = harness(), originalNow = Date.now;
  try { Date.now = () => Date.parse('2026-11-15T00:00:00Z'); assert.equal((await h.run()).status, 'failed'); assert.equal(h.calls.length, 0); assert.equal(h.finishes(), 0); }
  finally { Date.now = originalNow; }
});
test('five one-call durable invocations make exactly five total calls and finish once on the fifth', async () => {
  const h = harness(); h.options.maximumNewCalls = 1;
  for (let count = 1; count <= 5; count++) {
    const result = await h.run(); assert.equal(result.status, count === 5 ? 'passed' : 'running');
    assert.equal(h.calls.length, count); assert.equal(Object.keys(h.state.cases).length, count); assert.equal(h.finishes(), count === 5 ? 1 : 0);
  }
  assert.equal((await h.run()).status, 'passed'); assert.equal(h.calls.length, 5); assert.equal(h.finishes(), 1);
});
test('one-call workflow boundary captures its limit before awaits and never retries a failed attempt', async () => {
  const h = harness(); h.options.maximumNewCalls = 1; h.hooks.invoke = () => { h.options.maximumNewCalls = undefined; };
  assert.equal((await h.run()).status, 'running'); assert.equal(h.calls.length, 1); assert.equal(h.finishes(), 0);
  const failed = harness(); failed.options.maximumNewCalls = 1; failed.hooks.invoke = () => { throw new ModelProviderError('provider_timeout', 'timeout', true); };
  assert.equal((await failed.run()).status, 'failed'); assert.equal((await failed.run()).status, 'failed'); assert.equal(failed.calls.length, 1); assert.equal(failed.finishes(), 0);
  const invalid = harness(); invalid.options.maximumNewCalls = 2;
  assert.equal((await invalid.run()).reason, 'listing_qualification_invalid_step_limit'); assert.equal(invalid.calls.length, 0);
});
