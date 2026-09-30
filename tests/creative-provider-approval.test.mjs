import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { technicalCreativeApproval, currentCreativeQuote, validateCreativeProviderSelection, FLUX_KLEIN_APPROVAL_BINDING, FLUX_KLEIN_PROVIDER_TERMS, CREATIVE_PROVIDER_TERMS } = require('../.core-tests/creative/proposal.js');
const { OpenRouterImageAdapter, IMAGE_GENERATION_POLICY, FLUX_KLEIN_PNG_POLICY } = require('../.core-tests/creative/image-provider.js');
const { validateCreativeApproval } = require('../.core-tests/creative/contracts.js');
const budget = require('../.core-tests/creative/budget.js');
const id = n => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
const design = { concept: 'Synthetic original provider-bound design', audience: 'Adult fixture audience', designInstructions: 'Original synthetic geometric trees with an opaque square background; no words, protected elements, people or reference artwork.' };

test('new BFL approvals explicitly preserve their provider terms without reinterpreting legacy helpers', () => {
  const legacy = technicalCreativeApproval(id(1), id(2), 550_000, design, id(3), 1);
  const bfl = technicalCreativeApproval(id(1), id(2), 550_000, design, id(4), 1, FLUX_KLEIN_PNG_POLICY.modelId);
  assert.ok(legacy.policyScreen.every(screen => screen.sourceUrls.includes(CREATIVE_PROVIDER_TERMS)));
  assert.ok(bfl.policyScreen.every(screen => FLUX_KLEIN_PROVIDER_TERMS.every(url => screen.sourceUrls.includes(url))));
  assert.ok(bfl.policyScreen.every(screen => !screen.sourceUrls.includes(CREATIVE_PROVIDER_TERMS)));
  bfl.printSpecification.verifiedAt = new Date().toISOString();
  validateCreativeApproval(bfl);
  assert.equal(bfl.maximumGenerations, 1);
  assert.equal(bfl.maximumMicrousd, 550_000);
  assert.equal(bfl.publicationAllowed, false);
  assert.throws(() => technicalCreativeApproval(id(1), id(2), 550_000, design, id(4), 1, 'unapproved/image-model'), /approved pinned policy/);
});

test('BFL data-use acknowledgement is explicit and closed, with no implicit default provider switch', () => {
  assert.equal(validateCreativeProviderSelection(IMAGE_GENERATION_POLICY.modelId), undefined);
  for (const unconfirmed of [false, undefined, null, 'true', 1]) assert.throws(() => validateCreativeProviderSelection(FLUX_KLEIN_PNG_POLICY.modelId, unconfirmed), /acknowledgement/);
  assert.throws(() => validateCreativeProviderSelection('unapproved/image-model', true), /approved pinned policy/);
  assert.deepEqual(validateCreativeProviderSelection(FLUX_KLEIN_PNG_POLICY.modelId, true), FLUX_KLEIN_APPROVAL_BINDING);
  assert.equal(FLUX_KLEIN_APPROVAL_BINDING.ownerAcknowledged, true);
  assert.equal(FLUX_KLEIN_APPROVAL_BINDING.nativePngRequired, true);
  assert.equal(FLUX_KLEIN_APPROVAL_BINDING.outputFormat, 'png');
  assert.equal(FLUX_KLEIN_APPROVAL_BINDING.requestedSize, '1024x1024');
});

test('BFL four-call quote reserves US$0.343176 and requires acknowledgement before any pricing read', async t => {
  let priceReads = 0;
  t.mock.method(require('../.core-tests/models/openrouter.js'), 'getOpenRouterConfig', () => ({ apiKey: 'synthetic-mock-only', baseUrl: 'https://openrouter.ai/api/v1', appUrl: 'https://example.invalid', appName: 'Offline provider test' }));
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Network forbidden in offline provider test'); });
  t.mock.method(OpenRouterImageAdapter.prototype, 'preflight', async function () {
    priceReads++;
    return { modelId: this.policy.modelId, estimatedMicrousd: this.policy.estimatedMicrousd, source: this.policy.pricingSource };
  });
  t.mock.method(budget, 'fetchCreativeModelQuote', async modelId => {
    priceReads++;
    return { modelId, inputPerMillion: modelId === 'openai/gpt-5.6-luna' ? 0.8 : 3, outputPerMillion: modelId === 'openai/gpt-5.6-luna' ? 3.11104 : 5, cacheWritePerMillion: 0 };
  });
  await assert.rejects(() => currentCreativeQuote(1, FLUX_KLEIN_PNG_POLICY.modelId), /acknowledgement/);
  await assert.rejects(() => currentCreativeQuote(1, 'unapproved/image-model', true), /approved pinned policy/);
  assert.equal(priceReads, 0);
  const quote = await currentCreativeQuote(1, FLUX_KLEIN_PNG_POLICY.modelId, true);
  assert.deepEqual(quote.maximaMicrousd, { brief: 33_992, screen: 107_304, generation: 70_000, review: 131_880 });
  assert.equal(quote.maximumCalls, 4);
  assert.equal(quote.maximumEstimateMicrousd, 343_176);
  assert.ok(quote.maximumEstimateMicrousd <= 550_000);
  assert.deepEqual(quote.providerBinding, FLUX_KLEIN_APPROVAL_BINDING);
  assert.equal(quote.generatorModel, FLUX_KLEIN_PNG_POLICY.modelId);
  assert.ok(FLUX_KLEIN_PROVIDER_TERMS.every(url => quote.sourceUrls.includes(url)));
  assert.ok(quote.sourceUrls.includes(FLUX_KLEIN_PNG_POLICY.pricingSource));
  const legacy = await currentCreativeQuote(1);
  assert.equal(legacy.generatorModel, IMAGE_GENERATION_POLICY.modelId);
  assert.equal(legacy.maximumEstimateMicrousd, 483_176);
  assert.ok(!('providerBinding' in legacy));
  assert.equal(priceReads, 6);
  assert.equal(quote.estimateOnly, true);
  assert.equal(quote.providerInvoiceGuarantee, false);
});

const migration = readFileSync('supabase/migrations/20260930210155_stage14_native_png_provider_binding.sql', 'utf8');
const prior = readFileSync('supabase/migrations/20260930194904_stage14_source_image_provenance.sql', 'utf8');
test('BFL draft only replaces the two existing functions and keeps terminal, provenance and one-image guards', () => {
  assert.equal((migration.match(/create or replace function /g) ?? []).length, 2);
  assert.doesNotMatch(migration, /\b(?:grant|revoke)\s+(?:all|execute|usage)|create\s+(?:table|policy)|alter\s+(?:table|policy)|update\s+storage\.buckets|delete\s+from/i);
  const terminal = source => source.slice(source.indexOf('    -- A provider PASS is not a durable approval:'), source.indexOf('    if settled.reported_microusd is null'));
  assert.ok(terminal(prior).length > 2000);
  assert.equal(terminal(migration), terminal(prior));
  const provenance = source => source.slice(source.indexOf("      if provenance->>'detectedMediaType'='image/png' then"), source.indexOf('      binary_good:=inspection'));
  assert.equal(provenance(migration), provenance(prior));
  assert.match(migration, /version>\(a.snapshot->>'maximumGenerations'\)::integer/);
  assert.match(migration, /no repair is authorized/);
  assert.match(migration, /ownerAcknowledged":true/);
  assert.match(migration, /BFL approval requires native PNG source bytes/);
  assert.match(migration, /amount<>70000/);
  assert.match(migration, /estimate->>'quoteId' is distinct from private.stage14_hash\(estimate-'quoteId'\)/);
  assert.match(migration, /when 'recraft\/recraft-v4.1-pro' then 'recraft-image-1.0'/);
  assert.match(migration, /when 'black-forest-labs\/flux.2-klein-4b' then 'flux-klein-png-1.0'/);
});
