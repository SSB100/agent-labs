import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const M = require('../.core-tests/printful/mapping.js');
const C = require('../.core-tests/printful/contracts.js');
const F = require('../.core-tests/printful/configuration.js');
const { validateCoreContract } = require('../.core-tests/core/validation.js');
const ids = Array.from({ length: 9 }, (_, i) => `${i + 1}`.repeat(8) + '-' + `${i + 1}`.repeat(4) + '-4' + `${i + 1}`.repeat(3) + '-8' + `${i + 1}`.repeat(3) + '-' + `${i + 1}`.repeat(12));
const [businessId, connectionResourceId, assetVersionId, intentId, receiptId, externalResourceId, providerReadReceiptId, otherBusinessId] = ids;

// Every test uses synthetic responses and synthetic server-read evidence. Exercising
// the real-read conversion branch is not live provider or production qualification.
function fixture(mode = 'fixture', storeKind = 'manual_api') {
  const now = Date.now(), createdAt = new Date(now - 2000).toISOString(), observedAt = new Date(now - 1000).toISOString();
  const expiresAt = new Date(now + 60000).toISOString(), occurredAt = new Date(now).toISOString();
  const context = { mode: 'fixture', observedAt, expiresAt };
  const product = C.parseCatalogProduct({ data: { id: 71, name: 'Synthetic product', type: 'T-Shirt', is_discontinued: false,
    placements: [{ placement: 'front', technique: 'dtg', layers: [{ type: 'file' }], conflicting_placements: [] }] } }, C.catalogProductId(71), context);
  const variant = C.parseCatalogVariant({ data: { id: 4018, catalog_product_id: 71, name: 'Synthetic variant', size: 'L', color: 'White',
    placement_dimensions: [{ placement: 'front', width: 12, height: 16, orientation: 'any' }] } }, C.catalogVariantId(4018), product.id, context);
  const asset = { businessId, assetVersionId, sha256: 'a'.repeat(64), mimeType: 'image/png', colorSpace: 'srgb', widthPx: 2000, heightPx: 2000,
    designWidthIn: 10, designHeightIn: 10, creativeApprovalId: null, creativeRunId: null,
    printRequirement: { variantId: 4018, placement: 'front', technique: 'dtg', minimumDpi: 150,
      sourceUrl: 'https://www.printful.com/creating-dtg-file', verifiedAt: observedAt, expiresAt } };
  const configuration = F.planPrintfulConfiguration({ businessId, product, variant, placement: 'front', storeKind, asset }, now);
  const scope = { businessId, connectionResourceId, storeId: 123, storeKind };
  const planning = { configuration, scope, syncProductId: M.printfulSyncProductId(900), syncVariantId: M.printfulSyncVariantId(901),
    productExternalId: 'synthetic-product-1', variantExternalId: 'synthetic-variant-1' };
  const plan = M.planPrintfulProductMapping(planning);
  const response = { code: 200, result: {
    sync_product: { id: 900, external_id: planning.productExternalId, variants: 1, synced: 1, is_ignored: false },
    sync_variants: [{ id: 901, external_id: planning.variantExternalId, sync_product_id: 900, synced: true, is_ignored: false,
      variant_id: 4018, product: { product_id: 71, variant_id: 4018 }, availability_status: 'active',
      warehouse_product_id: null, warehouse_product_variant_id: null }],
  } };
  const intent = { id: intentId, businessId, createdAt, updatedAt: createdAt, workflowRunId: null, taskContractId: null,
    actionType: 'printful.product.mapping.verify', capability: 'fulfilment.print', status: mode === 'fixture' ? 'proposed' : 'executing',
    request: { executionMode: mode === 'fixture' ? 'simulation' : 'provider_read', mappingHash: plan.mappingHash, storeId: 123, connectionResourceId },
    risk: { readOnly: true }, financialImpact: { amountMinor: 0 }, idempotencyKey: 'synthetic-mapping-read-1', createdByType: 'system', createdById: null };
  const read = { ...scope, source: mode, providerReadReceiptId: mode === 'fixture' ? null : providerReadReceiptId,
    ...M.printfulMappingReadRequest(plan), httpStatus: 200, observedAt, expiresAt, responseHash: C.printfulHash(response) };
  return { now, planning, plan, intent, read, response, receiptId, externalResourceId, occurredAt };
}
function verify(f) { return M.verifyPrintfulProductMapping(f, f.now); }
function alteredResponse(f, alter) { const changed = structuredClone(f); alter(changed.response); changed.read.responseHash = C.printfulHash(changed.response); return changed; }
function preflight(f, verification = verify(f)) { return { plan: f.plan, verification, currentAssetVersionId: f.plan.assetVersionId, currentAssetSha256: f.plan.assetSha256, quantity: 1 }; }

test('mapping proposals separate sync, catalog and exact external identities and bind the asset/store', () => {
  const f = fixture();
  assert.equal(f.plan.syncProductId.kind, 'sync_product');
  assert.equal(f.plan.syncVariantId.kind, 'sync_variant');
  assert.equal(f.plan.assetVersionId, assetVersionId);
  assert.equal(f.plan.executionAuthorized, false);
  f.planning.syncVariantId.value = 999;
  assert.equal(f.plan.syncVariantId.value, 901);
  for (const value of [0, -1, 1.5, '900', Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => M.printfulSyncProductId(value), /positive/);
  assert.throws(() => M.planPrintfulProductMapping({ ...f.planning, syncVariantId: C.catalogVariantId(4018) }), /identity types/);
  for (const value of [null, 901, '', ' synthetic', '@external', 'a/b', 'a?b', 'a\nb']) {
    assert.throws(() => M.planPrintfulProductMapping({ ...f.planning, variantExternalId: value }), /external ID/);
  }
});

test('planning rejects cross-Business, conflicting operation and already-authorized proposals', () => {
  const f = fixture();
  assert.throws(() => M.planPrintfulProductMapping({ ...f.planning, scope: { ...f.planning.scope, businessId: otherBusinessId } }), /same-Business/);
  assert.throws(() => M.planPrintfulProductMapping({ ...f.planning, scope: { ...f.planning.scope, storeKind: 'ecommerce_linked' } }), /same-Business/);
  assert.throws(() => M.planPrintfulProductMapping({ ...f.planning, configuration: { ...f.planning.configuration, operation: 'map_existing_ecommerce_variant' } }), /operation/);
  assert.throws(() => M.planPrintfulProductMapping({ ...f.planning, configuration: { ...f.planning.configuration, executionAuthorized: true } }), /proposal/);
  assert.throws(() => M.planPrintfulProductMapping({ ...f.planning, configuration: { ...f.planning.configuration, assetSha256: 'b'.repeat(64) } }), /Configuration proposal was modified/);
  assert.throws(() => M.planPrintfulProductMapping({ ...f.planning, configuration: { ...f.planning.configuration, requires: [] } }), /approval requirements/);
});

test('fixture verification produces a mock Core receipt but no external resource or production claim', () => {
  const f = fixture(), result = verify(f);
  validateCoreContract('actionReceipt', result.receipt);
  assert.equal(result.receipt.outcome, 'succeeded');
  assert.equal(result.receipt.provider, 'mock.printful');
  assert.equal(result.externalResource, null);
  assert.equal(result.receipt.responseSummary.qualification, 'fixture_only');
  for (const key of ['liveVerified', 'liveQualified', 'externalActionExecuted', 'configurationVerified', 'assetBindingVerified', 'retryAllowed']) {
    assert.equal(result.receipt.responseSummary[key], false);
  }
  assert.equal(result.orderSubmissionAuthorized, false);
});

test('synthetic independent-read evidence converts only identity verification into Core contracts', () => {
  const f = fixture('independent_provider_read'), result = verify(f), resource = result.externalResource;
  validateCoreContract('actionReceipt', result.receipt); validateCoreContract('externalResource', resource);
  assert.equal(result.receipt.provider, 'printful');
  assert.equal(result.receipt.responseSummary.liveVerified, true);
  assert.equal(result.receipt.responseSummary.configurationVerified, false);
  assert.equal(result.receipt.responseSummary.externalActionExecuted, false);
  assert.equal(resource.externalId, 'store:123:sync_variant:901');
  assert.equal(resource.metadata.storeId, 123);
  assert.equal(resource.metadata.plannedAssetSha256, 'a'.repeat(64));
  assert.equal(resource.metadata.assetBindingVerified, false);
  assert.equal(result.receipt.externalResourceId, resource.id);
  assert.ok(result.receipt.responseSummary.requires.includes('current_reviewed_test_candidate'));
  assert.ok(result.receipt.responseSummary.requires.includes('owner_configuration_approval'));
});

test('native and ecommerce mappings use only their exact documented read endpoints', () => {
  const native = fixture(), ecommerce = fixture('fixture', 'ecommerce_linked');
  assert.equal(M.printfulMappingReadRequest(native.plan).endpoint, 'https://api.printful.com/store/products/900');
  assert.equal(M.printfulMappingReadRequest(ecommerce.plan).endpoint, 'https://api.printful.com/sync/products/900');
  assert.equal(verify(ecommerce).receipt.outcome, 'succeeded');
  for (const endpoint of ['https://api.printful.com/store/products', 'https://api.printful.com/store/products/999', 'https://example.com/store/products/900', 'https://api.printful.com/store/products/900?token=x', M.printfulMappingReadRequest(ecommerce.plan).endpoint]) {
    assert.throws(() => verify({ ...native, read: { ...native.read, endpoint } }), /exact GET/);
  }
  assert.throws(() => verify({ ...native, read: { ...native.read, method: 'POST' } }), /exact GET/);
});

test('same-Business/store checks reject cross-boundary read provenance before conversion', () => {
  const f = fixture('independent_provider_read');
  for (const change of [{ businessId: otherBusinessId }, { connectionResourceId: ids[8] }, { storeId: 999 }, { storeKind: 'ecommerce_linked' }]) {
    assert.throws(() => verify({ ...f, read: { ...f.read, ...change } }), /exact Business/);
  }
  assert.throws(() => verify({ ...f, intent: { ...f.intent, businessId: otherBusinessId } }), /same-Business/);
});

test('provider-response labels, fixture labels and missing read receipts cannot manufacture independent verification', () => {
  const f = fixture();
  assert.throws(() => verify({ ...f, read: { ...f.read, source: 'provider_response' } }), /independent provider/);
  assert.throws(() => verify({ ...f, read: { ...f.read, providerReadReceiptId } }), /persisted provider/);
  assert.throws(() => verify({ ...f, read: { ...f.read, source: 'independent_provider_read', providerReadReceiptId } }), /verification intent/);
  const real = fixture('independent_provider_read');
  assert.throws(() => verify({ ...real, read: { ...real.read, providerReadReceiptId: null } }), /persisted provider/);
  assert.throws(() => verify({ ...real, intent: { ...real.intent, status: 'proposed' } }), /verification intent/);
});

test('mapping verification never completes a configuration action or accepts a changed request', () => {
  const f = fixture('independent_provider_read');
  assert.throws(() => verify({ ...f, intent: { ...f.intent, actionType: 'printful.product.configure' } }), /configuration completion/);
  for (const change of [{ mappingHash: '0'.repeat(64) }, { executionMode: 'simulation' }, { storeId: 999 }, { connectionResourceId: ids[8] }]) {
    assert.throws(() => verify({ ...f, intent: { ...f.intent, request: { ...f.intent.request, ...change } } }), /verification intent/);
  }
  assert.throws(() => verify({ ...f, plan: { ...f.plan, assetSha256: 'b'.repeat(64) } }), /proposal changed/);
  assert.throws(() => verify({ ...f, read: { ...f.read, responseHash: 'b'.repeat(64) } }), /fingerprint/);
});

test('wrong provider identity, catalog lineage and unavailable states remain uncertain without retry', () => {
  const f = fixture('independent_provider_read');
  const changes = [
    response => { response.result.sync_product.id = 71; },
    response => { response.result.sync_product.external_id = 'another-product'; },
    response => { response.result.sync_product.is_ignored = true; },
    ...[{ id: 902 }, { external_id: 'another-variant' }, { external_id: 901 }, { sync_product_id: 71 }, { variant_id: 999 },
      { synced: false }, { is_ignored: true }, { availability_status: 'out_of_stock' }, { warehouse_product_variant_id: 5 },
      { product: { product_id: 999, variant_id: 4018 } }, { product: { product_id: 71, variant_id: 999 } }]
      .map(change => response => Object.assign(response.result.sync_variants[0], change)),
  ];
  for (const change of changes) {
    const result = verify(alteredResponse(f, change));
    assert.equal(result.receipt.outcome, 'uncertain'); assert.equal(result.externalResource, null);
    assert.equal(result.receipt.responseSummary.liveVerified, false); assert.equal(result.receipt.responseSummary.retryAllowed, false);
    assert.equal(result.receipt.responseSummary.next, 'reconcile_exact_store_and_external_identity');
  }
});

test('duplicate or incomplete variants and mutation/list envelopes cannot establish mapping completion', () => {
  const f = fixture('independent_provider_read');
  const duplicate = (response, change) => {
    response.result.sync_variants.push({ ...response.result.sync_variants[0], ...change });
    response.result.sync_product.variants = 2; response.result.sync_product.synced = 2;
  };
  for (const change of [
    response => duplicate(response, { external_id: 'other-variant' }),
    response => duplicate(response, { id: 902 }),
    response => duplicate(response, { id: 902, external_id: 'other-variant', sync_product_id: 999 }),
    response => { response.result.sync_product.variants = 2; },
    response => { response.result.sync_product.synced = 0; },
    response => { response.result.sync_variants = []; },
    response => { delete response.result.sync_variants[0].is_ignored; },
    response => { delete response.result.sync_variants[0].availability_status; },
    response => { response.result = response.result.sync_product; },
    response => { response.result = [response.result.sync_product]; },
    response => { response.code = 201; },
  ]) {
    const result = verify(alteredResponse(f, change));
    assert.equal(result.receipt.outcome, 'uncertain'); assert.equal(result.externalResource, null);
  }
});

test('stale state requires reconciliation, while future, misordered and unbounded timestamps fail closed', () => {
  const f = fixture('independent_provider_read');
  const stale = verify({ ...f, read: { ...f.read, expiresAt: f.occurredAt } });
  assert.equal(stale.receipt.outcome, 'uncertain'); assert.equal(stale.externalResource, null);
  assert.equal(stale.receipt.responseSummary.reason, 'stale_provider_state');
  for (const change of [{ observedAt: new Date(f.now + 1).toISOString() }, { observedAt: new Date(f.now - 3000).toISOString() },
    { expiresAt: f.read.observedAt }, { expiresAt: new Date(f.now + 86400000).toISOString() }, { observedAt: 'bad' }]) {
    assert.throws(() => verify({ ...f, read: { ...f.read, ...change } }), /ordered/);
  }
  assert.throws(() => verify({ ...f, occurredAt: new Date(f.now + 1).toISOString() }), /ordered/);
});

test('existing mappings retain creation time and cannot be repurposed across a scope or asset', () => {
  const f = fixture('independent_provider_read'), existingResource = verify(f).externalResource;
  existingResource.createdAt = f.intent.createdAt;
  assert.equal(verify({ ...f, existingResource }).externalResource.createdAt, f.intent.createdAt);
  for (const change of [{ businessId: otherBusinessId }, { externalId: 'store:999:sync_variant:901' }, { id: ids[8] },
    { provider: 'mock.printful' }, { metadata: { ...existingResource.metadata, storeId: 999 } },
    { metadata: { ...existingResource.metadata, connectionResourceId: ids[8] } },
    { metadata: { ...existingResource.metadata, syncVariantId: 999 } },
    { metadata: { ...existingResource.metadata, plannedAssetSha256: 'b'.repeat(64) } },
    { metadata: { ...existingResource.metadata, mappingHash: 'b'.repeat(64) } }]) {
    assert.throws(() => verify({ ...f, existingResource: { ...existingResource, ...change } }), /cannot be reassigned/);
  }
  assert.throws(() => verify({ ...f, existingResource: { ...existingResource, updatedAt: new Date(f.now + 1).toISOString() } }), /newer resource version/);
});

test('normalized resources and receipts never retain raw provider strings, URLs or files', () => {
  const f = fixture('independent_provider_read'), secret = 'synthetic-sensitive-provider-field';
  const changed = alteredResponse(f, response => {
    response.result.sync_product.name = secret;
    response.result.sync_product.thumbnail_url = `https://example.com/?secret=${secret}`;
    response.result.sync_variants[0].files = [{ url: secret, hash: 'provider-file-hash-is-not-an-asset-sha256' }];
  });
  const result = verify(changed);
  assert.equal(result.receipt.outcome, 'succeeded');
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.equal(result.externalResource.metadata.assetBindingVerified, false);
  changed.read.storeId = 999;
  assert.equal(result.externalResource.metadata.storeId, 123);
});

test('fulfilment identity preflight always preserves TEST, current artwork, quote and owner approval gates', () => {
  const f = fixture('independent_provider_read'), result = M.preflightPrintfulFulfilment(preflight(f), f.now);
  assert.equal(result.status, 'identity_mapping_ready');
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.requires, [...M.PRINTFUL_MAPPING_GATES]);
  for (const key of ['productionReady', 'executionAuthorized', 'publicationAuthorized', 'orderSubmissionAuthorized', 'retryAllowed']) assert.equal(result[key], false);
  assert.ok(result.requires.includes('current_reviewed_test_candidate'));
  assert.ok(result.requires.includes('current_asset_hash_and_print_file_binding'));
  assert.ok(result.requires.includes('separate_owner_paid_order_approval'));
  const mismatched = preflight(f);
  mismatched.verification.externalResource.metadata.responseHash = 'b'.repeat(64);
  assert.throws(() => M.preflightPrintfulFulfilment(mismatched, f.now), /same independent read/);
});

test('fulfilment preflight blocks fixture, uncertain and stale mappings and rejects changed assets or scope', () => {
  const f = fixture(), real = fixture('independent_provider_read'), input = preflight(real);
  assert.equal(M.preflightPrintfulFulfilment(preflight(f), f.now).status, 'blocked');
  assert.equal(M.preflightPrintfulFulfilment(input, real.now + 60001).status, 'blocked');
  const uncertain = alteredResponse(real, response => { response.result.sync_variants[0].synced = false; });
  assert.equal(M.preflightPrintfulFulfilment(preflight(uncertain), real.now).status, 'blocked');
  assert.throws(() => M.preflightPrintfulFulfilment({ ...input, currentAssetVersionId: ids[8] }, real.now), /current asset/);
  assert.throws(() => M.preflightPrintfulFulfilment({ ...input, currentAssetSha256: 'b'.repeat(64) }, real.now), /current asset/);
  for (const quantity of [0, -1, 1.5, 101, '1']) assert.throws(() => M.preflightPrintfulFulfilment({ ...input, quantity }, real.now), /quantity/);
  input.verification.receipt.businessId = otherBusinessId;
  assert.throws(() => M.preflightPrintfulFulfilment(input, real.now), /same-Business/);
});
