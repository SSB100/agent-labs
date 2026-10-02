import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const compiledRoot = process.env.PRINTFUL_UI_TEST_ROOT ?? '../.core-tests';
const { buildSyntheticPrintfulPreview } = require(`${compiledRoot}/app/dashboard/printful/preview.js`);
const { calculatePricingForm, readPricingForm } = require(`${compiledRoot}/app/dashboard/printful/pricing-form.js`);
const { initialPricingValues } = require(`${compiledRoot}/app/dashboard/printful/types.js`);
const { assertPrintfulConfigurationPlan } = require(`${compiledRoot}/printful/configuration.js`);
const page = readFileSync('src/app/dashboard/printful/page.tsx', 'utf8');
const workspace = readFileSync('src/app/dashboard/printful/workspace.tsx', 'utf8');
const actions = readFileSync('src/app/dashboard/printful/actions.ts', 'utf8');
const accounts = readFileSync('src/app/dashboard/accounts/page.tsx', 'utf8');

function complete(overrides = {}) {
  return { ...initialPricingValues, production: '9.50', fulfilmentShipping: '5.00', sellerTaxCost: '0', discountPercent: '10',
    marketplaceFixed: '0.20', marketplacePercent: '6.5', paymentFixed: '0.25', paymentPercent: '3', refundReservePercent: '2', ...overrides };
}

test('workspace authenticates both page and arithmetic action, links from Accounts, and separates secure account setup from product execution', () => {
  assert.match(page, /await requireOwnerUiContext\(\)/);
  assert.match(actions, /await requireOwnerUiContext\(\)/);
  assert.ok(actions.indexOf('await requireOwnerUiContext()') < actions.indexOf('readPricingForm(form)'));
  assert.match(accounts, /href=\{`\/dashboard\/printful\$\{selectedBusiness/);
  assert.match(accounts, /Stage 15 foundation/);
  assert.match(accounts, /Secure account setup · Live product qualification open/);
  assert.match(accounts, /<BusinessAccountWorkspace data=\{accountWorkspace\}/);
  assert.match(page, /await loadAccountWorkspace\(context, business.id\)/);
  assert.match(page, /href=\{accountHref\}>Manage secure Printful connection/);
  assert.match(page, /A connection alone would not authorize product changes or spending/);
  assert.doesNotMatch(actions, /fetch\(|\.rpc\(|\.insert\(|\.update\(|\.delete\(|await start\(/);
  assert.doesNotMatch(`${page}${workspace}`, /type="password"|name="(?:token|password|credential|apiKey)"/);
});

test('UI keeps fixture provenance, required independent gates and open live qualification visible', () => {
  for (const text of ['Current reviewed TEST', 'Production-asset approval', 'Separate owner configuration authority', 'Live qualification remains open', 'No provider mutation', 'actual action receipts', 'uncertain write']) assert.ok(page.includes(text), text);
  for (const text of ['Names, IDs, dimensions, prices and artwork below are invented fixtures', 'liveQualified = false', 'No actual approvals', 'Production currency', 'Unknown']) assert.ok(workspace.includes(text), text);
  assert.doesNotMatch(`${actions}${workspace}`, /new PrintfulCatalogAdapter/);
});

test('synthetic fixtures use distinct product and variant identities with no real assets or approval authority', () => {
  const fixture = buildSyntheticPrintfulPreview();
  assert.equal(fixture.product.provenance.mode, 'fixture');
  assert.equal(fixture.product.provenance.liveQualified, false);
  assert.match(fixture.product.name, /Synthetic/);
  assert.equal(fixture.product.id.kind, 'catalog_product');
  assert.equal(fixture.variants.length, 2);
  assert.equal(fixture.variants[0].productionMinor, 950);
  assert.equal(fixture.variants[1].productionMinor, 1050);
  for (const entry of fixture.variants) {
    assert.equal(entry.variant.id.kind, 'catalog_variant');
    assert.equal(entry.variant.productId.value, fixture.product.id.value);
    assert.equal(entry.variant.provenance.mode, 'fixture');
    assert.match(entry.variant.name, /Synthetic/);
    assert.equal(entry.plans.length, 4);
    for (const plan of entry.plans) {
      assert.doesNotThrow(() => assertPrintfulConfigurationPlan(plan));
      assert.equal(plan.executionAuthorized, false);
      assert.equal(plan.publicationAuthorized, false);
      assert.equal(plan.orderSubmissionAuthorized, false);
      assert.equal(plan.state, 'proposal');
      assert.equal(plan.sourceWidthPx * plan.designHeightIn, plan.sourceHeightPx * plan.designWidthIn);
      assert.equal(plan.effectiveDpi, 150);
      assert.equal(plan.variantId, entry.variant.id.value);
      assert.throws(() => assertPrintfulConfigurationPlan({ ...plan, designWidthIn: 9 }), /modified/);
      if (plan.storeKind === 'ecommerce_linked') {
        assert.equal(plan.operation, 'map_existing_ecommerce_variant');
        assert.ok(plan.requires.includes('existing_imported_ecommerce_variant'));
      } else assert.equal(plan.operation, 'create_native_sync_product');
    }
  }
});

test('form parsing preserves unknown costs and requires no assumptions to be silently zeroed', () => {
  const result = calculatePricingForm({ ...initialPricingValues });
  assert.equal(result.status, 'needs_inputs');
  assert.equal(result.profitMinor, null);
  assert.equal(result.marginBps, null);
  assert.deepEqual(result.missing.sort(), ['productionMinor', 'fulfilmentShippingMinor', 'sellerTaxCostMinor', 'marketplaceFee', 'paymentFee', 'refundReserveBps'].sort());
  assert.equal(result.revenueMinor, 3500);
});

test('form reuses exact shared arithmetic and preserves explicitly zero costs', () => {
  const result = calculatePricingForm(complete());
  assert.equal(result.status, 'scenario_calculated');
  assert.equal(result.profitMinor, 1337);
  assert.equal(result.marginBps, 4178);
  assert.equal(result.sellerTaxCostMinor, 0);
  assert.equal(result.marketplaceFeeMinor, 228);
  assert.equal(result.paymentFeeMinor, 121);
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.publicationAuthorized, false);
});

test('USD, GBP, AUD and NZD are explicit independent assumptions with no conversion', () => {
  for (const currency of ['USD', 'GBP', 'AUD', 'NZD']) {
    const result = calculatePricingForm(complete({ currency }));
    assert.equal(result.currency, currency);
    assert.equal(result.profitMinor, 1337);
  }
  assert.throws(() => calculatePricingForm(complete({ currency: 'EUR' })), /bounded pricing/);
  assert.match(workspace, /name === "currency" && value !== previous.currency/);
  assert.match(workspace, /monetaryPricingFields\.forEach\(field => \{ next\[field\] = ""; \}\)/);
  assert.match(workspace, /There is no FX conversion/);
});

test('partial fee assumptions, invalid amounts, excessive percentages and unlabelled scenarios fail closed', () => {
  for (const value of ['-1', '1e3', '1.001', '01.00', 'Infinity', '']) assert.throws(() => calculatePricingForm(complete({ itemPrice: value })), /Item price/);
  assert.throws(() => calculatePricingForm(complete({ marketplacePercent: '' })), /both fixed amount and percentage/);
  assert.throws(() => calculatePricingForm(complete({ paymentFixed: '' })), /both fixed amount and percentage/);
  assert.throws(() => calculatePricingForm(complete({ marketplaceBasis: 'all' })), /fee basis/);
  assert.throws(() => calculatePricingForm(complete({ discountPercent: '100.01' })), /from 0 to 100/);
  assert.throws(() => calculatePricingForm(complete({ assumptionLabel: ' ' })), /3 to 160/);
});

test('zero revenue, negative profit and changed fee basis are surfaced rather than hidden', () => {
  const none = calculatePricingForm(complete({ itemPrice: '0', shippingCharged: '0' }));
  assert.equal(none.status, 'needs_inputs');
  assert.ok(none.missing.includes('positive_revenue'));
  const loss = calculatePricingForm(complete({ production: '100' }));
  assert.ok(loss.profitMinor < 0);
  assert.ok(loss.marginBps < 0);
  assert.equal(loss.meetsTarget, false);
  const itemOnly = calculatePricingForm(complete({ marketplaceBasis: 'item' }));
  assert.equal(itemOnly.marketplaceFeeMinor, 196);
});

test('FormData reader restricts input keys and changed inputs cannot display a stale result', () => {
  const form = new FormData();
  for (const [key, value] of Object.entries(complete())) form.set(key, value);
  form.set('ownerAuthority', 'true');
  form.set('production', new Blob(['ignored']), 'file.txt');
  const values = readPricingForm(form);
  assert.equal(values.production, '');
  assert.equal(values.ownerAuthority, undefined);
  assert.equal(calculatePricingForm(values).status, 'needs_inputs');
  assert.match(workspace, /pricingFieldNames\.every\(key => values\[key\] === state\.values!\[key\]\)/);
  assert.match(workspace, /const result = isCurrent \? state\.result : null/);
  assert.match(workspace, /Inputs changed\. Calculate again/);
  assert.match(workspace, /fieldset disabled=\{pending\}/);
});

test('successful actions cannot natively reset visible fee bases away from the submitted assumptions', () => {
  const { preservePricingAssumptions } = require('../.core-tests/app/dashboard/printful/types.js');
  const resetEvent = new Event('reset', {cancelable:true});
  preservePricingAssumptions(resetEvent);
  assert.equal(resetEvent.defaultPrevented,true);
  assert.match(workspace, /<form action=\{action\} onReset=\{preservePricingAssumptions\}/);
  assert.match(workspace, /type="button" onClick=\{\(\) => setValues\(\{ \.\.\.initialPricingValues \}\)\}/);
});
