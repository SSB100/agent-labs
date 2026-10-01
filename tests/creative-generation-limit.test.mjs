import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { technicalCreativeApproval, currentCreativeQuote } = require('../.core-tests/creative/proposal.js');
const { OpenRouterImageAdapter } = require('../.core-tests/creative/image-provider.js');
const budget = require('../.core-tests/creative/budget.js');
const { validateCreativeApproval } = require('../.core-tests/creative/contracts.js');
const id = n => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
const design = { concept: 'Original synthetic image limit fixture', audience: 'Adult fixture audience', designInstructions: 'Synthetic original pine composition on an opaque square background, without text, protected elements or reference artwork.' };

test('creative approval defaults to two images and explicitly binds one-image/no-repair authority', () => {
  const prior = technicalCreativeApproval(id(1), id(2), 1_000_000, design, id(3));
  assert.equal(prior.maximumGenerations, 2);
  const single = technicalCreativeApproval(id(1), id(2), 500_000, design, id(4), 1);
  assert.equal(single.maximumGenerations, 1);
  single.printSpecification.verifiedAt = new Date().toISOString();
  validateCreativeApproval(single);
  assert.equal(single.publicationAllowed, false);
  for (const invalid of [0, 3, -1, 1.5, '1', null]) {
    assert.throws(() => technicalCreativeApproval(id(1), id(2), 500_000, design, id(4), invalid), /generation limit/);
    assert.throws(() => validateCreativeApproval({ ...single, maximumGenerations: invalid }), /approval/);
  }
  const missing = { ...single }; delete missing.maximumGenerations;
  assert.throws(() => validateCreativeApproval(missing), /approval/);
});

test('one-image quote includes brief, independent screen, generation and pixel review only', async t => {
  let priceReads = 0;
  t.mock.method(require('../.core-tests/models/openrouter.js'), 'getOpenRouterConfig', () => ({ apiKey: 'synthetic-mock-only', baseUrl: 'https://openrouter.ai/api/v1', appUrl: 'https://example.invalid', appName: 'Offline limit test' }));
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Network is forbidden in this offline quote test'); });
  t.mock.method(OpenRouterImageAdapter.prototype, 'preflight', async () => {
    priceReads++;
    return { estimatedMicrousd: 210_000, modelId: 'recraft/recraft-v4.1-pro', source: 'https://openrouter.ai/api/v1/images/models/recraft/recraft-v4.1-pro/endpoints' };
  });
  t.mock.method(budget, 'fetchCreativeModelQuote', async modelId => {
    priceReads++;
    return { modelId, inputPerMillion: modelId === 'openai/gpt-5.6-luna' ? 0.8 : 3, outputPerMillion: modelId === 'openai/gpt-5.6-luna' ? 3.11104 : 5, cacheWritePerMillion: 0 };
  });
  const single = await currentCreativeQuote(1), prior = await currentCreativeQuote();
  assert.equal(priceReads, 6);
  assert.deepEqual(single.maximaMicrousd, { brief: 33_992, screen: 107_304, generation: 210_000, review: 131_880 });
  assert.equal(single.maximumCalls, 4);
  assert.equal(single.maximumEstimateMicrousd, 483_176);
  assert.ok(single.maximumEstimateMicrousd <= 628_492);
  assert.equal(prior.maximumCalls, 6);
  assert.equal(prior.maximumEstimateMicrousd, 825_056);
  assert.equal(single.estimateOnly, true);
  assert.equal(single.providerInvoiceGuarantee, false);
  for (const invalid of [0, 3, 1.5, '1', null]) await assert.rejects(() => currentCreativeQuote(invalid), /generation limit/);
  assert.equal(priceReads, 6, 'Invalid authority is rejected before any price lookup');
});

const migration = readFileSync('supabase/migrations/20260930194838_stage14_single_image_limit.sql', 'utf8');
const guarded = readFileSync('supabase/migrations/20260930130626_stage14_terminal_eligibility_guard.sql', 'utf8');
test('single-image draft keeps all terminal production guards verbatim and changes no grants', () => {
  const terminalGuard = source => source.slice(source.indexOf('    -- A provider PASS is not a durable approval:'), source.indexOf('    if settled.reported_microusd is null'));
  assert.ok(terminalGuard(guarded).length > 2000);
  assert.equal(terminalGuard(migration), terminalGuard(guarded));
  assert.equal((migration.match(/create or replace function /g) ?? []).length, 5);
  assert.doesNotMatch(migration, /\b(?:grant|revoke)\s+(?:all|execute|usage)|create\s+(?:table|policy)|alter\s+table|delete\s+from/i);
  assert.match(migration, /maximumCalls' is distinct from to_jsonb\(2\+2\*\(snapshot->>'maximumGenerations'\)::integer\)/);
  assert.match(migration, /elsif not good and version<\(a.snapshot->>'maximumGenerations'\)::integer then/);
  const transition = migration.slice(migration.indexOf('create or replace function public.creative_runtime_transition'));
  assert.ok(transition.indexOf('version>(a.snapshot') < transition.indexOf("if p_operation='reserve_call'"), 'Reject disallowed version before reservations');
  assert.match(migration, /first image failed review.*allows one image with no repair/);
});
