import type { ActionReceipt, ExternalResource } from "../core/contracts";
import { EtsyError, hash, positiveId, record, requireEtsy, sameScope, SHA256, UUID, validatePackage, type EtsyConnection, type EtsyProductPackage, type EtsyScope } from "../etsy/contracts";
import { PublicationActivationRejected } from "./adapter";
import { publicationProviderState, publicationRequestHash, validatePublicationFinancialAuthorization, validatePublicationPreflight, validateVerifiedDraft, verifyPublicationReadback,
  type PublicationFinancialAuthorization, type PublicationPreflight, type PublicationProviderState, type PublicationReadback, type VerifiedPublicationDraft } from "./contracts";

export type PublicationActivation = {
  key: "activate"; requestHash: string; status: "sent" | "accepted" | "rejected" | "verified";
  sentAt: string; responseHash: string | null; reason: string | null;
};
export type PublicationState = EtsyScope & {
  id: string; actionIntentId: string; resourceId: string; receiptId: string;
  connectionRevision: string; listingId: number; identity: string;
  packageHash: string; reviewHash: string; draftReceiptHash: string; approvalHash: string;
  disclosureHash: string; preflightHash: string; requestHash: string;
  status: "ready" | "running" | "needs_owner" | "verified" | "cancelled" | "failed";
  reason: string | null; stopRequested: boolean; providerState: PublicationProviderState;
  activation: PublicationActivation | null;
};
export type PublicationContext = {
  package: EtsyProductPackage; connection: EtsyConnection; draft: VerifiedPublicationDraft;
  reviewHash: string; draftReceiptHash: string; approvalHash: string; disclosureHash: string;
  preflightHash: string; requestHash: string; financial: PublicationFinancialAuthorization;
  preflight: PublicationPreflight; stopRequested: boolean;
};
export interface PublicationProvider {
  shop(): Promise<unknown>; listing(id: number): Promise<unknown>;
  images(id: number): Promise<Record<string, unknown>[]>;
  properties(id: number): Promise<Record<string, unknown>[]>;
  shippingProfile(id: number): Promise<Record<string, unknown>>;
  returnPolicy(id: number): Promise<Record<string, unknown>>;
  processingProfile(id: number): Promise<Record<string, unknown>>;
  activate(id: number): Promise<unknown>;
}
/** Production SQL is authoritative for owner authorization and provenance.
 * acquire/save/finish require exclusive durable leases + revision CAS. Every
 * save preserves immutable bindings, prior activation intent and late provider
 * observations; cancellation may never erase an already-observed activation.
 *
 * publish guard reauthenticates latest package/review/source/consent/disclosure,
 * validates trusted financial-source records, current account and cancellation.
 * reconcile guard returns the immutable originally approved snapshot even after
 * cancellation, source drift or expiry, and permits only the same listing GETs.
 * It still requires a currently authorized, correctly scoped connection.
 * finish checks the exact original bindings and independent readback, appending
 * one immutable receipt/resource atomically. It may settle after owner stop. */
export interface PublicationRepository {
  acquire(): Promise<PublicationState>; save(state: PublicationState): Promise<void>;
  guard(mode: "publish" | "reconcile"): Promise<PublicationContext>;
  finish(state: PublicationState, receipt: ActionReceipt, resource: ExternalResource): Promise<void>;
  release(): Promise<void>;
}
const SAFE_REASONS = new Set([
  "account_access_denied", "account_access_revoked", "account_scope_mismatch", "shop_identity_changed", "cancelled", "invalid_identity", "invalid_response", "response_too_large", "provider_response_failed", "provider_timeout", "rate_limited", "processing_readback_unavailable", "stale_package", "upstream_qualification_required", "stale_package_or_approval", "execution_interrupted", "publication_state_invalid", "publication_binding_mismatch", "publication_fee_evidence_required", "publication_fee_binding_mismatch", "publication_fee_bound_invalid", "publication_approval_binding_mismatch", "publication_consent_required", "publication_approval_time_invalid", "publication_approval_expired", "publication_initial_qualification_limit", "publication_shipping_identity_mismatch", "publication_shipping_incomplete", "publication_calculated_shipping_not_supported", "publication_return_policy_required", "publication_return_policy_invalid", "publication_processing_incomplete", "publication_preflight_changed", "publication_rejected", "publication_already_dispatched", "publication_identity_or_state_changed", "publication_listing_readback_mismatch", "publication_price_readback_mismatch", "publication_attribute_readback_mismatch", "publication_partner_readback_mismatch", "publication_image_readback_mismatch", "publication_property_readback_mismatch", "verified_draft_required", "draft_binding_mismatch", "draft_image_mapping_mismatch", "uncertain_activation_not_observed", "publication_already_active_before_dispatch", "publication_policy_refresh_required", "publication_state_unavailable", "publication_source_mismatch",
]);
export function safePublicationReason(error: unknown) {
  return error instanceof EtsyError && SAFE_REASONS.has(error.code) ? error.code : "execution_interrupted";
}
function validateState(state: PublicationState) {
  requireEtsy([state.id, state.businessId, state.connectionId, state.actionIntentId, state.resourceId, state.receiptId].every(value => typeof value === "string" && UUID.test(value)) && [state.packageHash, state.reviewHash, state.draftReceiptHash, state.approvalHash, state.disclosureHash, state.preflightHash, state.requestHash].every(value => typeof value === "string" && SHA256.test(value)) && /^[a-zA-Z0-9-]{1,100}$/.test(state.connectionRevision) && /^al-[a-f0-9]{40}$/.test(state.identity), "publication_state_invalid");
  positiveId(state.shopId); positiveId(state.listingId);
  requireEtsy(["ready", "running", "needs_owner", "verified", "cancelled", "failed"].includes(state.status) && ["unknown", "draft", "active", "inactive", "sold_out", "expired"].includes(state.providerState) && (state.activation === null || (!!state.activation && typeof state.activation === "object" && !Array.isArray(state.activation))), "publication_state_invalid");
  if (state.status === "verified") requireEtsy(state.activation?.status === "verified" && state.providerState === "active", "publication_state_invalid");
  requireEtsy(publicationRequestHash(state) === state.requestHash && typeof state.stopRequested === "boolean", "publication_binding_mismatch");
  if (state.activation) requireEtsy(state.activation.key === "activate" && state.activation.requestHash === state.requestHash && ["sent", "accepted", "rejected", "verified"].includes(state.activation.status) && Number.isFinite(Date.parse(state.activation.sentAt)) && (state.activation.responseHash === null || SHA256.test(state.activation.responseHash)), "publication_state_invalid");
}
export async function executeEtsyPublication(repository: PublicationRepository, provider: PublicationProvider, now = () => Date.now()) {
  const state = await repository.acquire();
  try {
    validateState(state);
    if (state.status === "verified" || state.status === "failed" || (state.status === "cancelled" && !state.activation)) return state;
    const guard = async (mode: "publish" | "reconcile") => {
      const context = await repository.guard(mode); sameScope(state, context.connection);
      requireEtsy(context.connection.status === "connected" && context.connection.revision === state.connectionRevision && Date.parse(context.connection.expiresAt) > now() && context.connection.currency === context.package.currency, "account_access_revoked");
      // Reconciliation validates the historical package as it was approved; an
      // expired source never permits a new mutation but cannot erase reality.
      validatePackage(context.package, state.businessId, mode === "publish" ? now() : Date.parse(context.package.approvedAt));
      requireEtsy(hash(context.package) === state.packageHash && context.reviewHash === state.reviewHash && context.draftReceiptHash === state.draftReceiptHash && context.approvalHash === state.approvalHash && context.disclosureHash === state.disclosureHash && context.preflightHash === state.preflightHash && context.requestHash === state.requestHash && hash(context.preflight) === state.preflightHash, "publication_binding_mismatch");
      validateVerifiedDraft(context.draft, state, context.package, state.listingId, state.identity);
      requireEtsy(Date.parse(context.draft.verifiedAt) <= now() && Date.parse(context.draft.verifiedAt) >= Date.parse(context.package.approvedAt), "draft_binding_mismatch");
      validatePublicationFinancialAuthorization(context.financial, state, context.package, now(), mode === "publish");
      state.stopRequested = state.stopRequested || context.stopRequested;
      if (mode === "publish") requireEtsy(!state.stopRequested, "cancelled");
      return context;
    };
    const read = async (context: PublicationContext): Promise<{ readback: PublicationReadback; preflight: PublicationPreflight }> => {
      const listing = await provider.listing(state.listingId);
      const observedState = publicationProviderState(listing, state, state.listingId);
      if (state.providerState !== "active" || observedState === "active") state.providerState = observedState;
      // Save an observed active listing before validating mutable factual fields.
      // This protects the history if an owner stops or fields drift mid-request.
      await repository.save(state);
      const images = await provider.images(state.listingId), properties = await provider.properties(state.listingId);
      const returnPolicyId = positiveId(record(listing).return_policy_id);
      requireEtsy(returnPolicyId === context.preflight.returnPolicyId, "publication_preflight_changed");
      const preflight: PublicationPreflight = { quantity: 1, shouldAutoRenew: false,
        shippingProfileId: context.package.shippingProfileId, returnPolicyId,
        shippingProfile: await provider.shippingProfile(context.package.shippingProfileId),
        returnPolicy: await provider.returnPolicy(returnPolicyId),
        processingProfile: await provider.processingProfile(context.package.readinessStateId) };
      validatePublicationPreflight(preflight, listing, context.connection, context.package);
      requireEtsy(hash(preflight) === state.preflightHash, "publication_preflight_changed");
      return { readback: { listing, images, properties }, preflight };
    };
    let context = await guard(state.activation ? "reconcile" : "publish");
    await provider.shop();
    if (!state.activation) {
      state.status = "running"; state.reason = null; await repository.save(state);
      const before = await read(context);
      requireEtsy(state.providerState !== "active", "publication_already_active_before_dispatch");
      verifyPublicationReadback(before.readback, state, context.package, context.draft, "draft");
      context = await guard("publish");
      state.activation = { key: "activate", requestHash: state.requestHash, status: "sent", sentAt: new Date(now()).toISOString(), responseHash: null, reason: null };
      // Any loss from here leaves durable uncertainty and never another PATCH.
      await repository.save(state); await guard("publish");
      try {
        const response = record(await provider.activate(state.listingId));
        requireEtsy(response.listing_id === state.listingId && response.shop_id === state.shopId && response.state === "active", "publication_identity_or_state_changed");
        state.activation.status = "accepted"; state.activation.responseHash = hash(response); state.providerState = "active";
      } catch (error) {
        state.activation.reason = safePublicationReason(error);
        if (error instanceof PublicationActivationRejected) state.activation.status = "rejected";
      }
      await repository.save(state);
    }
    context = await guard("reconcile");
    const after = await read(context);
    if (state.providerState !== "active") {
      state.status = state.activation.status === "rejected" ? "failed" : "needs_owner";
      state.reason = state.activation.status === "rejected" ? state.activation.reason : "uncertain_activation_not_observed";
      await repository.save(state); return state;
    }
    const responseHash = verifyPublicationReadback(after.readback, state, context.package, context.draft, "active");
    await guard("reconcile");
    const occurredAt = new Date(now()).toISOString();
    const resource: ExternalResource = { id: state.resourceId, businessId: state.businessId, provider: "etsy", resourceType: "published_listing", externalId: `shop:${state.shopId}:listing:${state.listingId}`, status: "active", canonicalUrl: `https://www.etsy.com/listing/${state.listingId}`, createdAt: occurredAt, updatedAt: occurredAt,
      metadata: { connectionId: state.connectionId, shopId: state.shopId, listingId: state.listingId, packageHash: state.packageHash, identity: state.identity, state: "active", draftReceiptId: context.draft.receiptId, publicationRunId: state.id } };
    const receipt: ActionReceipt = { id: state.receiptId, businessId: state.businessId, actionIntentId: state.actionIntentId, externalResourceId: state.resourceId, attempt: 1, outcome: "succeeded", provider: "etsy", requestFingerprint: state.requestHash, occurredAt, createdAt: occurredAt,
      responseSummary: { listingId: state.listingId, shopId: state.shopId, state: "active", verifiedBy: "independent_get", responseHash, packageHash: state.packageHash, reviewHash: state.reviewHash, draftReceiptHash: state.draftReceiptHash, approvalHash: state.approvalHash, disclosureHash: state.disclosureHash, preflightHash: state.preflightHash, requestHash: state.requestHash,
        feeStatus: "unreconciled", feeAmountMinor: null, feeCurrency: null, approvedMaximumTotalMinor: context.financial.approval.maximumTotalMinor, approvedBillingCurrency: context.financial.approval.billingCurrency, stopRequested: state.stopRequested,
        imageMappings: context.draft.imageMappings.map(mapping => ({ ...mapping })) } };
    state.activation.status = "verified"; state.status = "verified"; state.reason = null;
    await repository.finish(state, receipt, resource); return state;
  } catch (error) {
    state.reason = safePublicationReason(error);
    if (state.reason === "cancelled") state.stopRequested = true;
    state.status = state.stopRequested && !state.activation ? "cancelled" : "needs_owner";
    await repository.save(state); return state;
  } finally { await repository.release(); }
}
