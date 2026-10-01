import type { ActionIntent, ActionReceipt, ExternalResource, JsonObject } from "../core/contracts";
import { validateCoreContract } from "../core/validation";
import { assertPrintfulConfigurationPlan, type PrintfulConfigurationPlan } from "./configuration";
import { assertPrintful, catalogProductId, catalogVariantId, printfulHash } from "./contracts";

/** v1 Sync identities are not v2 catalog identities. No transport is installed here.
 * See https://developers.printful.com/docs/#tag/Products-API and the Ecommerce
 * Platform Sync API. The authenticated server must supply trustworthy read evidence;
 * a worker's JSON or a POST response is not independent provider verification. */
export type PrintfulSyncProductId = { kind: "sync_product"; value: number };
export type PrintfulSyncVariantId = { kind: "sync_variant"; value: number };
export type PrintfulMappingScope = {
  businessId: string; connectionResourceId: string; storeId: number;
  storeKind: "manual_api" | "ecommerce_linked";
};
export const PRINTFUL_MAPPING_GATES = [
  "current_reviewed_test_candidate", "current_persisted_creative_production_approval",
  "current_asset_hash_and_print_file_binding", "verified_store_connection",
  "current_stock_and_complete_cost_quote", "owner_configuration_approval",
  "separate_owner_paid_order_approval",
] as const;
export type PrintfulMappingPlan = PrintfulMappingScope & {
  version: "1.0.0"; configurationPlanHash: string;
  catalogProductId: number; catalogVariantId: number;
  syncProductId: PrintfulSyncProductId; syncVariantId: PrintfulSyncVariantId;
  productExternalId: string; variantExternalId: string;
  assetVersionId: string; assetSha256: string; mappingHash: string;
  state: "proposal"; executionAuthorized: false; publicationAuthorized: false;
  orderSubmissionAuthorized: false;
};
/** Only an authenticated server read boundary may assert independent_provider_read.
 * This pure contract checks the evidence bindings, not the authenticity of its caller.
 * No credential, response body, customer address, or writable endpoint is retained. */
export type PrintfulMappingReadEvidence = PrintfulMappingScope & {
  source: "fixture" | "independent_provider_read";
  providerReadReceiptId: string | null;
  method: "GET"; endpoint: string; httpStatus: 200;
  observedAt: string; expiresAt: string; responseHash: string;
};
export type PrintfulMappingVerification = {
  receipt: ActionReceipt; externalResource: ExternalResource | null;
  executionAuthorized: false; publicationAuthorized: false; orderSubmissionAuthorized: false;
};
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
function positiveId(value: unknown) {
  assertPrintful(Number.isSafeInteger(value) && Number(value) > 0, "A positive Printful identity is required.");
  return Number(value);
}
function externalId(value: unknown) {
  // A bounded application subset: never normalize, coerce, or strip an @ prefix.
  assertPrintful(typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value), "An exact bounded Printful external ID is required.");
  return value;
}
function record(value: unknown): Record<string, unknown> {
  assertPrintful(value !== null && typeof value === "object" && !Array.isArray(value), "Incomplete Printful sync state.");
  return value as Record<string, unknown>;
}
export function printfulSyncProductId(value: unknown): PrintfulSyncProductId { return { kind: "sync_product", value: positiveId(value) }; }
export function printfulSyncVariantId(value: unknown): PrintfulSyncVariantId { return { kind: "sync_variant", value: positiveId(value) }; }
function assertScope(scope: PrintfulMappingScope) {
  assertPrintful(UUID.test(scope.businessId) && UUID.test(scope.connectionResourceId), "A same-Business scoped Printful connection identity is required.");
  positiveId(scope.storeId);
  assertPrintful(scope.storeKind === "manual_api" || scope.storeKind === "ecommerce_linked", "An explicit Printful store kind is required.");
}
function sameScope(expected: PrintfulMappingScope, actual: PrintfulMappingScope) {
  assertScope(actual);
  assertPrintful(expected.businessId === actual.businessId && expected.connectionResourceId === actual.connectionResourceId &&
    expected.storeId === actual.storeId && expected.storeKind === actual.storeKind, "Printful mapping must retain the exact Business, connection and store.");
}
function selection(plan: Omit<PrintfulMappingPlan, "mappingHash" | "state" | "executionAuthorized" | "publicationAuthorized" | "orderSubmissionAuthorized">) {
  return { version: plan.version, businessId: plan.businessId, connectionResourceId: plan.connectionResourceId,
    storeId: plan.storeId, storeKind: plan.storeKind, configurationPlanHash: plan.configurationPlanHash,
    catalogProductId: plan.catalogProductId, catalogVariantId: plan.catalogVariantId,
    syncProductId: { kind: plan.syncProductId.kind, value: plan.syncProductId.value },
    syncVariantId: { kind: plan.syncVariantId.kind, value: plan.syncVariantId.value },
    productExternalId: plan.productExternalId, variantExternalId: plan.variantExternalId,
    assetVersionId: plan.assetVersionId, assetSha256: plan.assetSha256 };
}
function assertPlan(plan: PrintfulMappingPlan) {
  assertScope(plan);
  assertPrintful(plan.version === "1.0.0" && plan.state === "proposal" && plan.executionAuthorized === false &&
    plan.publicationAuthorized === false && plan.orderSubmissionAuthorized === false, "A mapping proposal cannot authorize execution.");
  assertPrintful(plan.syncProductId.kind === "sync_product" && plan.syncVariantId.kind === "sync_variant", "Catalog and sync identity types cannot be substituted.");
  positiveId(plan.syncProductId.value); positiveId(plan.syncVariantId.value);
  catalogProductId(plan.catalogProductId); catalogVariantId(plan.catalogVariantId);
  externalId(plan.productExternalId); externalId(plan.variantExternalId);
  assertPrintful(UUID.test(plan.assetVersionId) && HASH.test(plan.assetSha256) && HASH.test(plan.configurationPlanHash), "Exact asset and configuration fingerprints are required.");
  assertPrintful(HASH.test(plan.mappingHash) && plan.mappingHash === printfulHash(selection(plan)), "The Printful mapping proposal changed.");
}

export function planPrintfulProductMapping(input: {
  configuration: PrintfulConfigurationPlan; scope: PrintfulMappingScope;
  syncProductId: PrintfulSyncProductId; syncVariantId: PrintfulSyncVariantId;
  productExternalId: string; variantExternalId: string;
}): PrintfulMappingPlan {
  const { configuration, scope, syncProductId, syncVariantId, productExternalId, variantExternalId } = structuredClone(input);
  assertScope(scope);
  assertPrintful(configuration.businessId === scope.businessId && configuration.storeKind === scope.storeKind &&
    configuration.version === "1.0.0" && configuration.state === "proposal" && configuration.executionAuthorized === false &&
    configuration.publicationAuthorized === false && configuration.orderSubmissionAuthorized === false, "A same-Business/store configuration proposal is required.");
  assertPrintful(configuration.operation === (scope.storeKind === "manual_api" ? "create_native_sync_product" : "map_existing_ecommerce_variant"), "Store kind and configuration operation differ.");
  assertPrintfulConfigurationPlan(configuration);
  const value = selection({ ...scope, version: "1.0.0", configurationPlanHash: configuration.requestHash,
    catalogProductId: configuration.productId, catalogVariantId: configuration.variantId, syncProductId, syncVariantId,
    productExternalId, variantExternalId, assetVersionId: configuration.assetVersionId, assetSha256: configuration.assetSha256 });
  const result: PrintfulMappingPlan = { ...value, mappingHash: printfulHash(value), state: "proposal",
    executionAuthorized: false, publicationAuthorized: false, orderSubmissionAuthorized: false };
  assertPlan(result);
  return result;
}

/** Product GET returns the product and its variants; list, webhook and POST envelopes
 * cannot substitute. Store identity is authenticated request context, not body data. */
export function printfulMappingReadRequest(plan: PrintfulMappingPlan) {
  assertPlan(plan);
  return { method: "GET" as const,
    endpoint: `https://api.printful.com/${plan.storeKind === "manual_api" ? "store" : "sync"}/products/${plan.syncProductId.value}`,
    storeId: plan.storeId, executionAuthorized: false as const };
}
function exactProviderState(response: unknown, plan: PrintfulMappingPlan) {
  const envelope = record(response), result = record(envelope.result), product = record(result.sync_product);
  assertPrintful(envelope.code === 200 && product.id === plan.syncProductId.value && product.external_id === plan.productExternalId && product.is_ignored === false, "Mismatched sync product.");
  assertPrintful(Array.isArray(result.sync_variants) && result.sync_variants.length > 0 && result.sync_variants.length <= 100 &&
    product.variants === result.sync_variants.length, "Incomplete sync variants.");
  const variants = result.sync_variants.map(record), ids = new Set<number>(), externalIds = new Set<string>();
  for (const variant of variants) {
    const id = positiveId(variant.id), external = externalId(variant.external_id);
    assertPrintful(!ids.has(id) && !externalIds.has(external) && variant.sync_product_id === product.id && typeof variant.synced === "boolean", "Ambiguous sync variant identity.");
    ids.add(id); externalIds.add(external);
  }
  assertPrintful(product.synced === variants.filter(variant => variant.synced === true).length, "Incomplete sync count.");
  const variant = variants.find(value => value.id === plan.syncVariantId.value);
  assertPrintful(variant && variant.external_id === plan.variantExternalId && variant.variant_id === plan.catalogVariantId &&
    variant.synced === true && variant.is_ignored === false && variant.availability_status === "active" &&
    variant.warehouse_product_id == null && variant.warehouse_product_variant_id == null, "Mismatched or unavailable sync variant.");
  const catalog = record(variant.product);
  assertPrintful(catalog.product_id === plan.catalogProductId && catalog.variant_id === plan.catalogVariantId, "Mismatched catalog lineage.");
  // A synced identity does not prove current artwork bytes, rights, TEST approval,
  // production readiness, complete cost, or that this application performed a write.
}
function resourceKey(plan: PrintfulMappingPlan) { return `store:${plan.storeId}:sync_variant:${plan.syncVariantId.value}`; }
function assertExistingResource(resource: ExternalResource, plan: PrintfulMappingPlan, id: string) {
  validateCoreContract("externalResource", resource);
  assertPrintful(resource.id === id && resource.businessId === plan.businessId && resource.provider === "printful" &&
    resource.resourceType === "sync_variant" && resource.externalId === resourceKey(plan) &&
    resource.metadata.connectionResourceId === plan.connectionResourceId && resource.metadata.storeKind === plan.storeKind &&
    resource.metadata.storeId === plan.storeId && resource.metadata.mappingHash === plan.mappingHash &&
    resource.metadata.syncProductId === plan.syncProductId.value && resource.metadata.syncVariantId === plan.syncVariantId.value &&
    resource.metadata.productExternalId === plan.productExternalId && resource.metadata.variantExternalId === plan.variantExternalId &&
    resource.metadata.catalogProductId === plan.catalogProductId && resource.metadata.catalogVariantId === plan.catalogVariantId &&
    resource.metadata.plannedAssetVersionId === plan.assetVersionId && resource.metadata.plannedAssetSha256 === plan.assetSha256,
  "An existing mapping cannot be reassigned across Business, store, identity or asset.");
}

/** Converts a trusted independent GET into a Core identity-verification receipt.
 * It never completes printful.product.configure or proves any external mutation.
 * Mismatched/stale state remains uncertain; no blind POST retry is permitted. */
export function verifyPrintfulProductMapping(input: {
  plan: PrintfulMappingPlan; intent: ActionIntent; read: PrintfulMappingReadEvidence; response: unknown;
  receiptId: string; externalResourceId: string; occurredAt: string; existingResource?: ExternalResource;
}, now = Date.now()): PrintfulMappingVerification {
  const { plan, intent, read, response, receiptId, externalResourceId, occurredAt, existingResource } = structuredClone(input);
  assertPlan(plan); validateCoreContract("actionIntent", intent); sameScope(plan, read);
  const fixture = read.source === "fixture";
  assertPrintful(fixture || read.source === "independent_provider_read", "A fixture or independent provider GET is required.");
  assertPrintful(fixture ? read.providerReadReceiptId === null : UUID.test(read.providerReadReceiptId ?? ""), "An independent persisted provider read receipt is required.");
  assertPrintful(read.method === "GET" && read.endpoint === printfulMappingReadRequest(plan).endpoint && read.httpStatus === 200 &&
    read.responseHash === printfulHash(response), "The exact GET endpoint and response fingerprint are required.");
  assertPrintful(intent.businessId === plan.businessId && intent.capability === "fulfilment.print" && intent.actionType === "printful.product.mapping.verify" &&
    intent.status === (fixture ? "proposed" : "executing") && intent.request.executionMode === (fixture ? "simulation" : "provider_read") &&
    intent.request.mappingHash === plan.mappingHash && intent.request.storeId === plan.storeId && intent.request.connectionResourceId === plan.connectionResourceId,
  "A same-Business exact mapping verification intent is required; configuration completion is not inferred.");
  const occurred = Date.parse(occurredAt), observed = Date.parse(read.observedAt), expires = Date.parse(read.expiresAt);
  assertPrintful(UUID.test(receiptId) && UUID.test(externalResourceId) && Number.isFinite(now) && Number.isFinite(occurred) && occurred <= now &&
    Number.isFinite(observed) && observed >= Date.parse(intent.createdAt) && observed <= occurred &&
    Number.isFinite(expires) && expires > observed && expires - observed <= 86_400_000, "Bounded ordered read and receipt dates are required.");
  if (existingResource) {
    assertExistingResource(existingResource, plan, externalResourceId);
    assertPrintful(Date.parse(existingResource.createdAt) <= occurred && Date.parse(existingResource.updatedAt) <= occurred,
      "A mapping observation cannot replace a newer resource version.");
  }
  let matches = false;
  if (expires > now) { try { exactProviderState(response, plan); matches = true; } catch { /* No provider body or error text is retained. */ } }
  const liveVerified = !fixture && matches;
  const summary: JsonObject = { executionMode: fixture ? "simulation" : "provider_read", qualification: fixture ? "fixture_only" : "independent_provider_read",
    mappingHash: plan.mappingHash, storeId: plan.storeId, connectionResourceId: plan.connectionResourceId,
    providerReadReceiptId: read.providerReadReceiptId, responseHash: read.responseHash, observedAt: read.observedAt, expiresAt: read.expiresAt,
    mappingVerified: matches, liveVerified, liveQualified: false, externalActionExecuted: false, externalMutation: false,
    configurationVerified: false, assetBindingVerified: false, retryAllowed: false,
    next: matches ? (fixture ? "fixture_only" : "review_configuration_and_order_gates") : "reconcile_exact_store_and_external_identity",
    reason: matches ? "exact_identity_match" : expires <= now ? "stale_provider_state" : "incomplete_or_mismatched_provider_state",
    requires: [...PRINTFUL_MAPPING_GATES] };
  const resource: ExternalResource | null = liveVerified ? {
    id: externalResourceId, businessId: plan.businessId, provider: "printful", resourceType: "sync_variant",
    externalId: resourceKey(plan), status: "active", canonicalUrl: read.endpoint,
    createdAt: existingResource?.createdAt ?? occurredAt, updatedAt: occurredAt,
    metadata: { ...summary, storeKind: plan.storeKind, syncProductId: plan.syncProductId.value, syncVariantId: plan.syncVariantId.value,
      productExternalId: plan.productExternalId, variantExternalId: plan.variantExternalId,
      catalogProductId: plan.catalogProductId, catalogVariantId: plan.catalogVariantId,
      plannedAssetVersionId: plan.assetVersionId, plannedAssetSha256: plan.assetSha256,
      executionAuthorized: false, publicationAuthorized: false, orderSubmissionAuthorized: false },
  } : null;
  const receipt: ActionReceipt = { id: receiptId, businessId: plan.businessId, actionIntentId: intent.id,
    externalResourceId: resource?.id ?? null, attempt: 1, outcome: matches ? "succeeded" : "uncertain",
    provider: fixture ? "mock.printful" : "printful", requestFingerprint: printfulHash(intent.request),
    responseSummary: summary, occurredAt, createdAt: occurredAt };
  validateCoreContract("actionReceipt", receipt);
  if (resource) validateCoreContract("externalResource", resource);
  return { receipt, externalResource: resource, executionAuthorized: false, publicationAuthorized: false, orderSubmissionAuthorized: false };
}

/** This is a deterministic identity preflight, not an order payload or approval.
 * Even an exact, current mapping cannot authorize a paid order or a product write. */
export function preflightPrintfulFulfilment(input: {
  plan: PrintfulMappingPlan; verification: PrintfulMappingVerification;
  currentAssetVersionId: string; currentAssetSha256: string; quantity: number;
}, now = Date.now()) {
  const { plan, verification, currentAssetVersionId, currentAssetSha256, quantity } = structuredClone(input);
  assertPlan(plan);
  assertPrintful(Number.isFinite(now) && Number.isSafeInteger(quantity) && quantity > 0 && quantity <= 100, "A bounded whole-number fulfilment quantity is required.");
  assertPrintful(currentAssetVersionId === plan.assetVersionId && currentAssetSha256 === plan.assetSha256, "The current asset differs from the mapped proposal.");
  const { receipt, externalResource } = verification;
  validateCoreContract("actionReceipt", receipt);
  assertPrintful(receipt.businessId === plan.businessId && receipt.responseSummary.mappingHash === plan.mappingHash &&
    receipt.responseSummary.storeId === plan.storeId && receipt.responseSummary.connectionResourceId === plan.connectionResourceId,
  "Fulfilment preflight requires the exact same-Business/store mapping receipt.");
  if (externalResource) assertExistingResource(externalResource, plan, receipt.externalResourceId ?? "");
  if (externalResource) {
    assertPrintful(["providerReadReceiptId", "responseHash", "observedAt", "expiresAt"].every(key =>
      externalResource.metadata[key] === receipt.responseSummary[key]), "The mapping resource and receipt must describe the same independent read.");
  }
  const blockers: string[] = [];
  if (!externalResource || externalResource.status !== "active" || receipt.outcome !== "succeeded" || receipt.provider !== "printful" ||
    receipt.responseSummary.liveVerified !== true || receipt.responseSummary.qualification !== "independent_provider_read" ||
    !UUID.test(String(receipt.responseSummary.providerReadReceiptId ?? ""))) blockers.push("independent_verified_mapping_required");
  const observed = Date.parse(String(receipt.responseSummary.observedAt)), expires = Date.parse(String(receipt.responseSummary.expiresAt));
  if (!Number.isFinite(observed) || observed > now || !Number.isFinite(expires) || expires <= now) blockers.push("fresh_mapping_read_required");
  return { status: blockers.length ? "blocked" as const : "identity_mapping_ready" as const,
    businessId: plan.businessId, storeId: plan.storeId, syncVariantId: structuredClone(plan.syncVariantId), quantity,
    mappingHash: plan.mappingHash, blockers, requires: [...PRINTFUL_MAPPING_GATES],
    productionReady: false as const, executionAuthorized: false as const,
    publicationAuthorized: false as const, orderSubmissionAuthorized: false as const, retryAllowed: false as const };
}
