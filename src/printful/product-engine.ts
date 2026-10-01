import { createHash } from "node:crypto";
import type { ActionReceipt, ExternalResource, JsonObject } from "../core/contracts";
import { MAX_CREATIVE_PNG_BYTES } from "../creative/types";
import { verifyPrintfulFileBinding, verifyPrintfulProductReadback } from "./product-adapter";
import { PrintfulProductError, PRODUCT_HASH, PRODUCT_UUID, productAssert, productHash, productIdentity, productRecord, productRequestHash,
  sameProductScope, validateProductApproval, validateProductSource, type ProductConfigurationApproval, type ProductConfigurationSource, type ProductScope } from "./production";

export type ProductConfigurationState = ProductScope & {
  id: string; sourceId: string; sourceHash: string; approvalHash: string; requestHash: string; identity: string;
  actionIntentId: string; resourceId: string; receiptId: string;
  status: "ready" | "running" | "needs_owner" | "cancelled";
  reason: string | null; stopRequested: boolean;
  dispatch: { requestHash: string; sentAt: string } | null;
  syncProductId: number | null; syncVariantId: number | null; receiptRecorded: boolean; observationHash: string | null;
};
export type ProductConfigurationContext = {
  source: ProductConfigurationSource; sourceHash: string; approval: ProductConfigurationApproval; approvalHash: string; stopRequested: boolean;
};
export interface ProductConfigurationProvider {
  bindExecutionGuard?(guard: (operation: "read" | "create") => Promise<void>): void;
  store(): Promise<unknown>; file(id: number): Promise<unknown>; findProduct(identity: string): Promise<unknown | null>;
  product(id: number): Promise<unknown>; create(source: ProductConfigurationSource, identity: string): Promise<unknown>;
}
/** Production repository: exclusive durable lease + CAS, owner and separate
 * server authority, immutable authenticated source and approval snapshots.
 * configure guards latest TEST/asset/approval/connection and stop. reconcile
 * guards only the original dispatched identity and currently permitted account.
 * finish atomically records partial evidence without completing configuration. */
export interface ProductConfigurationRepository {
  acquire(): Promise<ProductConfigurationState>; save(state: ProductConfigurationState): Promise<void>;
  guard(mode: "configure" | "reconcile"): Promise<ProductConfigurationContext>;
  assetBytes(source: ProductConfigurationSource): Promise<Uint8Array>;
  finish(state: ProductConfigurationState, receipt: ActionReceipt, resource: ExternalResource | null): Promise<void>;
  release(): Promise<void>;
}
const SAFE_REASONS = new Set([
  "product_response_invalid", "product_scope_invalid", "product_scope_mismatch", "product_source_invalid", "product_source_mismatch", "product_plan_changed",
  "product_asset_path_invalid", "product_name_invalid", "product_price_invalid", "product_source_stale", "product_file_binding_required", "product_placement_producer_required",
  "product_stock_evidence_required", "product_cost_evidence_required", "product_provider_facts_changed", "product_file_type_evidence_required",
  "product_placement_binding_mismatch", "product_approval_invalid", "product_state_invalid", "product_binding_changed", "product_cancelled", "product_asset_bytes_changed",
  "product_identity_already_exists", "product_creation_uncertain", "product_readback_mismatch", "product_file_readback_mismatch", "product_placement_not_observable",
  "product_write_authority_unavailable", "product_write_access_revoked", "product_write_scope_rejected", "product_provider_timeout", "product_provider_failure",
  "product_provider_rejected", "product_provider_response_invalid", "product_provider_rate_limited", "product_connection_changed", "product_lease_lost",
]);
export function safeProductReason(error: unknown) {
  return error instanceof PrintfulProductError && SAFE_REASONS.has(error.code) ? error.code : "product_execution_interrupted";
}
function validateState(state: ProductConfigurationState) {
  productAssert(state && [state.id, state.sourceId, state.actionIntentId, state.resourceId, state.receiptId].every(id => typeof id === "string" && PRODUCT_UUID.test(id)) &&
    [state.sourceHash, state.approvalHash, state.requestHash].every(value => typeof value === "string" && PRODUCT_HASH.test(value)) &&
    state.identity === productIdentity({ id: state.sourceId }) && state.requestHash === productRequestHash({ ...state, id: state.sourceId }, state.sourceHash) &&
    ["ready", "running", "needs_owner", "cancelled"].includes(state.status) && typeof state.stopRequested === "boolean" && typeof state.receiptRecorded === "boolean" &&
    (state.observationHash === null || PRODUCT_HASH.test(state.observationHash)) &&
    [state.syncProductId, state.syncVariantId].every(value => value === null || (Number.isSafeInteger(value) && Number(value) > 0)) &&
    (state.dispatch === null || (state.dispatch && state.dispatch.requestHash === state.requestHash && Number.isFinite(Date.parse(state.dispatch.sentAt)))), "product_state_invalid");
  productAssert(!state.receiptRecorded || (!!state.dispatch && !!state.observationHash && !!state.syncProductId && !!state.syncVariantId && state.status === "needs_owner"), "product_state_invalid");
  productAssert(state.dispatch !== null || (state.syncProductId === null && state.syncVariantId === null), "product_state_invalid");
}
function responseProductId(value: unknown) {
  const result = productRecord(productRecord(value).result);
  const product = result.sync_product === undefined ? result : productRecord(result.sync_product);
  productAssert(Number.isSafeInteger(product.id) && Number(product.id) > 0, "product_response_invalid");
  return Number(product.id);
}
/** A single request is recorded before dispatch. Any crash, error or lost
 * response after that point may only reconcile the original external identity.
 * Native v1 readback proves associations, not physical placement: this engine
 * records an uncertain qualification receipt and never a listing-ready result. */
export async function executePrintfulProduct(repository: ProductConfigurationRepository, provider: ProductConfigurationProvider, now = () => Date.now()) {
  const state = await repository.acquire();
  try {
    validateState(state);
    if (state.receiptRecorded || (state.status === "cancelled" && !state.dispatch)) return state;
    const guard = async (mode: "configure" | "reconcile") => {
      const context = structuredClone(await repository.guard(mode)), source = context.source;
      sameProductScope(state, source);
      productAssert(source.id === state.sourceId && productHash(source) === state.sourceHash && context.sourceHash === state.sourceHash &&
        productHash(context.approval) === state.approvalHash && context.approvalHash === state.approvalHash && productIdentity(source) === state.identity, "product_binding_changed");
      const referenceTime = mode === "configure" ? now() : Date.parse(context.approval.approvedAt);
      validateProductSource(source, referenceTime);
      validateProductApproval(context.approval, source, state.sourceHash, now(), mode === "reconcile");
      if (context.stopRequested) state.stopRequested = true;
      productAssert(mode === "reconcile" ? !!state.dispatch : !state.stopRequested, "product_cancelled");
      return source;
    };
    provider.bindExecutionGuard?.(async operation => { await guard(operation === "create" ? "configure" : state.dispatch ? "reconcile" : "configure"); });
    let source = await guard(state.dispatch ? "reconcile" : "configure");
    await provider.store();
    if (!state.dispatch) {
      state.status = "running"; state.reason = null; await repository.save(state);
      const existing = await provider.findProduct(state.identity);
      productAssert(existing === null, "product_identity_already_exists");
      source = await guard("configure");
      verifyPrintfulFileBinding(source, await provider.file(source.printfulFileId), now());
      const bytes = await repository.assetBytes(source);
      productAssert(bytes instanceof Uint8Array && bytes.byteLength >= 33 && bytes.byteLength <= MAX_CREATIVE_PNG_BYTES &&
        createHash("sha256").update(bytes).digest("hex") === source.assetSha256, "product_asset_bytes_changed");
      await guard("configure");
      state.dispatch = { requestHash: state.requestHash, sentAt: new Date(now()).toISOString() };
      await repository.save(state); // Durable pre-dispatch marker, never removed.
      await guard("configure");
      try {
        const result = await provider.create(source, state.identity);
        state.syncProductId = responseProductId(result);
      } catch (error) { state.reason = safeProductReason(error); }
      // No create response constitutes proof, including a parseable provider ID.
      await repository.save(state);
    }
    source = await guard("reconcile");
    const found = await provider.findProduct(state.identity);
    productAssert(found, "product_creation_uncertain");
    const discoveredId = responseProductId(found);
    productAssert(state.syncProductId === null || state.syncProductId === discoveredId, "product_readback_mismatch");
    state.syncProductId = discoveredId; await repository.save(state);
    await guard("reconcile");
    const response = await provider.product(discoveredId);
    await guard("reconcile");
    const fileResponse = await provider.file(source.printfulFileId);
    await guard("reconcile");
    const storeResponse = await provider.store();
    const verified = verifyPrintfulProductReadback({ source, identity: state.identity, response, fileResponse, storeResponse }, now());
    productAssert(verified.syncProductId === discoveredId, "product_readback_mismatch");
    state.syncVariantId = verified.syncVariantId;
    await guard("reconcile");
    const occurredAt = new Date(now()).toISOString();
    const summary: JsonObject = {
      executionMode: source.evidenceMode === "fixture" ? "fixture" : "provider_response", configurationRunId: state.id,
      sourceId: state.sourceId, sourceHash: state.sourceHash, approvalHash: state.approvalHash, requestHash: state.requestHash,
      connectionId: state.connectionId, connectionRevision: state.connectionRevision, storeId: state.storeId,
      syncProductId: verified.syncProductId, syncVariantId: verified.syncVariantId, identity: state.identity,
      assetVersionId: source.assetVersionId, assetSha256: source.assetSha256, printfulFileId: source.printfulFileId,
      providerFactsHash: verified.providerFactsHash, productReadHash: verified.productReadHash, fileReadHash: verified.fileReadHash,
      associationVerified: true, assetBindingVerified: true, physicalPlacementVerified: false, techniqueVerified: false,
      configurationVerified: false, liveQualified: false, listingReady: false, publicationAuthorized: false, orderSubmissionAuthorized: false,
      verifiedBy: "independent_get", stopRequested: state.stopRequested,
      blockers: ["physical_placement_not_observable", "technique_not_observable"],
    };
    const providerName = source.evidenceMode === "fixture" ? "mock.printful" : "printful";
    const resource: ExternalResource | null = source.evidenceMode === "fixture" ? null : {
      id: state.resourceId, businessId: state.businessId, provider: providerName, resourceType: "product_configuration_observation",
      externalId: `store:${state.storeId}:sync_product:${verified.syncProductId}`, status: "pending",
      canonicalUrl: `https://api.printful.com/store/products/${verified.syncProductId}`, metadata: summary, createdAt: occurredAt, updatedAt: occurredAt,
    };
    const receipt: ActionReceipt = { id: state.receiptId, businessId: state.businessId, actionIntentId: state.actionIntentId, externalResourceId: resource?.id ?? null,
      attempt: 1, outcome: "uncertain", provider: providerName, requestFingerprint: state.requestHash, responseSummary: summary, occurredAt, createdAt: occurredAt };
    const finished: ProductConfigurationState = { ...state, status: "needs_owner", reason: "product_placement_not_observable", receiptRecorded: true, observationHash: productHash(summary) };
    await repository.finish(finished, receipt, resource); Object.assign(state, finished); return state;
  } catch (error) {
    state.reason = safeProductReason(error);
    if (state.reason === "product_cancelled") state.stopRequested = true;
    state.status = state.stopRequested && !state.dispatch ? "cancelled" : "needs_owner";
    await repository.save(state); return state;
  } finally { await repository.release(); }
}
