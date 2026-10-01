import { draftBody, draftIdentity, hash, positiveId, record, requireEtsy, SHA256, UUID,
  type EtsyProductPackage, type EtsyScope } from "../etsy/contracts";

export const ETSY_PUBLICATION_VERSION = "etsy-assisted-publication-1.0";
/** Only receipt-backed provider image IDs establish image identity. Alt text,
 * rank, a remote URL or a visually similar image never substitutes for this. */
export type PublicationImageMapping = { assetId: string; sha256: string; listingImageId: number };
export type VerifiedPublicationDraft = {
  runId: string; receiptId: string; resourceId: string; packageHash: string;
  responseHash: string; listingId: number; shopId: number; identity: string;
  imageMappings: PublicationImageMapping[]; verifiedAt: string;
};
export type PublicationReadback = {
  listing: unknown; images: Record<string, unknown>[]; properties: Record<string, unknown>[];
};
export type PublicationProviderState = "unknown" | "draft" | "active" | "inactive" | "sold_out" | "expired";

export function validateVerifiedDraft(draft: VerifiedPublicationDraft, scope: EtsyScope, p: EtsyProductPackage, listingId: number, identity: string) {
  requireEtsy(draft && [draft.runId, draft.receiptId, draft.resourceId].every(v => typeof v === "string" && UUID.test(v)), "verified_draft_required");
  requireEtsy(draft.packageHash === hash(p) && SHA256.test(draft.responseHash) && draft.listingId === positiveId(listingId) && draft.shopId === scope.shopId && draft.identity === identity && identity === draftIdentity(scope, p) && Number.isFinite(Date.parse(draft.verifiedAt)), "draft_binding_mismatch");
  requireEtsy(Array.isArray(draft.imageMappings) && draft.imageMappings.length === p.images.length, "draft_image_mapping_mismatch");
  const imageIds = new Set<number>();
  for (const image of p.images) {
    const matching = draft.imageMappings.filter(mapping => mapping.assetId === image.assetId && mapping.sha256 === image.sha256);
    requireEtsy(matching.length === 1, "draft_image_mapping_mismatch");
    const id = positiveId(matching[0].listingImageId);
    requireEtsy(!imageIds.has(id), "draft_image_mapping_mismatch"); imageIds.add(id);
  }
}

/** Validate the provider's actual state. Never overwrite an active response's
 * state to make the draft-only Stage16 validator accept it. */
export function verifyPublicationListing(raw: unknown, scope: EtsyScope, p: EtsyProductPackage, identity: string, listingId: number, expectedState: "draft" | "active") {
  const listing = record(raw), expected = draftBody(p, identity), money = record(listing.price);
  positiveId(listing.listing_id);
  requireEtsy(listing.listing_id === positiveId(listingId) && listing.shop_id === scope.shopId && listing.state === expectedState, "publication_identity_or_state_changed");
  requireEtsy(listing.title === expected.title && listing.description === expected.description && listing.quantity === p.quantity && listing.taxonomy_id === p.taxonomyId && listing.shipping_profile_id === p.shippingProfileId && listing.readiness_state_id === p.readinessStateId && listing.who_made === "someone_else" && listing.when_made === "made_to_order" && listing.is_supply === false && listing.listing_type === "physical" && listing.should_auto_renew === false, "publication_listing_readback_mismatch");
  requireEtsy(Number.isSafeInteger(money.amount) && Number.isSafeInteger(money.divisor) && Number(money.divisor) > 0 && BigInt(Number(money.amount)) * BigInt(100) === BigInt(p.priceMinor) * BigInt(Number(money.divisor)) && money.currency_code === p.currency, "publication_price_readback_mismatch");
  for (const key of ["tags", "materials"] as const) requireEtsy(Array.isArray(listing[key]) && hash([...listing[key]].sort()) === hash([...expected[key]].sort()), "publication_attribute_readback_mismatch");
  requireEtsy(Array.isArray(listing.production_partners) && hash(listing.production_partners.map(v => positiveId(record(v).production_partner_id)).sort()) === hash([...p.productionPartnerIds].sort()), "publication_partner_readback_mismatch");
  return listingId;
}

export function verifyPublicationReadback(readback: PublicationReadback, scope: EtsyScope, p: EtsyProductPackage, draft: VerifiedPublicationDraft, expectedState: "draft" | "active") {
  validateVerifiedDraft(draft, scope, p, draft.listingId, draft.identity);
  verifyPublicationListing(readback.listing, scope, p, draft.identity, draft.listingId, expectedState);
  const images = readback.images, properties = readback.properties;
  requireEtsy(Array.isArray(images) && images.length === p.images.length, "publication_image_readback_mismatch");
  requireEtsy(p.images.every((image, index) => images.filter(row => row.listing_id === draft.listingId && row.rank === index + 1 && row.alt_text === image.altText && row.listing_image_id === draft.imageMappings.find(mapping => mapping.assetId === image.assetId)?.listingImageId).length === 1), "publication_image_readback_mismatch");
  requireEtsy(Array.isArray(properties) && properties.length === p.properties.length, "publication_property_readback_mismatch");
  for (const prop of p.properties) {
    const matching = properties.filter(row => row.property_id === prop.propertyId);
    requireEtsy(matching.length === 1, "publication_property_readback_mismatch");
    const row = matching[0];
    requireEtsy((row.scale_id ?? null) === prop.scaleId && Array.isArray(row.value_ids) && hash([...row.value_ids].sort()) === hash([...prop.valueIds].sort()) && Array.isArray(row.values) && hash([...row.values].sort()) === hash([...prop.values].sort()), "publication_property_readback_mismatch");
  }
  return hash(readback);
}

export function publicationProviderState(raw: unknown, scope: EtsyScope, listingId: number): PublicationProviderState {
  const listing = record(raw);
  requireEtsy(listing.listing_id === positiveId(listingId) && listing.shop_id === scope.shopId, "publication_identity_or_state_changed");
  return ["draft", "active", "inactive", "sold_out", "expired"].includes(String(listing.state)) ? listing.state as PublicationProviderState : "unknown";
}

/** This is a trusted source contract, not a quote producer or an owner form.
 * Current Etsy activation endpoints do not supply this all-in quote. Production
 * must fail closed until an authenticated provider source can establish it. */
export type PublicationFeeQuote = {
  version: "1.0"; provider: "etsy"; scope: "one_listing_activation";
  sourceKind: "verified_provider_checkout" | "verified_account_specific_fee_bound"; sourceReceiptId: string; sourceHash: string;
  shopId: number; listingId: number; billingCurrency: string;
  listingFeeMinor: number; taxMinor: number; fxMinor: number; otherMandatoryFeesMinor: number;
  maximumTotalMinor: number; verifiedAt: string; expiresAt: string; disclosureHash: string;
};
export type PublicationApproval = {
  id: string; requestHash: string; quoteHash: string; disclosureHash: string;
  billingCurrency: string; maximumTotalMinor: number; approvedQuantity: number;
  paymentMethod: "etsy_payment_account"; commitment: "publish_existing_quantity_manual_renewal";
  dataSharing: "make_exact_reviewed_listing_public"; approvedAt: string; expiresAt: string;
};
export type PublicationFinancialAuthorization = { quote: PublicationFeeQuote; approval: PublicationApproval };
export function validatePublicationFinancialAuthorization(value: PublicationFinancialAuthorization, binding: {
  shopId: number; listingId: number; requestHash: string; approvalHash: string; disclosureHash: string;
}, p: EtsyProductPackage, now: number, requireCurrent = true) {
  const quote = value?.quote, approval = value?.approval;
  requireEtsy(quote && approval && quote.version === "1.0" && quote.provider === "etsy" && quote.scope === "one_listing_activation" && ["verified_provider_checkout", "verified_account_specific_fee_bound"].includes(quote.sourceKind) && UUID.test(quote.sourceReceiptId) && SHA256.test(quote.sourceHash), "publication_fee_evidence_required");
  requireEtsy(quote.shopId === binding.shopId && quote.listingId === binding.listingId && /^[A-Z]{3}$/.test(quote.billingCurrency), "publication_fee_binding_mismatch");
  const amounts = [quote.listingFeeMinor, quote.taxMinor, quote.fxMinor, quote.otherMandatoryFeesMinor];
  requireEtsy(amounts.every(v => Number.isSafeInteger(v) && v >= 0) && Number.isSafeInteger(quote.maximumTotalMinor) && quote.maximumTotalMinor > 0 && amounts.reduce((sum, v) => sum + v, 0) === quote.maximumTotalMinor, "publication_fee_bound_invalid");
  requireEtsy(UUID.test(approval.id) && approval.requestHash === binding.requestHash && approval.quoteHash === hash(quote) && hash(approval) === binding.approvalHash && quote.disclosureHash === binding.disclosureHash && approval.disclosureHash === binding.disclosureHash && SHA256.test(binding.disclosureHash), "publication_approval_binding_mismatch");
  requireEtsy(approval.billingCurrency === quote.billingCurrency && Number.isSafeInteger(approval.maximumTotalMinor) && approval.maximumTotalMinor >= quote.maximumTotalMinor && approval.approvedQuantity === p.quantity && approval.paymentMethod === "etsy_payment_account" && approval.commitment === "publish_existing_quantity_manual_renewal" && approval.dataSharing === "make_exact_reviewed_listing_public", "publication_consent_required");
  const quoted = Date.parse(quote.verifiedAt), quoteExpiry = Date.parse(quote.expiresAt), approved = Date.parse(approval.approvedAt), expiry = Date.parse(approval.expiresAt);
  requireEtsy(Number.isFinite(now) && Number.isFinite(quoted) && Number.isFinite(quoteExpiry) && Number.isFinite(approved) && Number.isFinite(expiry) && quoted <= approved && approved <= now && quoteExpiry > approved && expiry > approved && expiry <= quoteExpiry, "publication_approval_time_invalid");
  if (requireCurrent) requireEtsy(quoteExpiry > now && expiry > now, "publication_approval_expired");
}

/** No token, mutable provider result or approval enters the request identity.
 * Consent separately binds this complete immutable intended operation. */
export function publicationRequestHash(binding: EtsyScope & {
  connectionRevision: string; listingId: number; identity: string;
  packageHash: string; reviewHash: string; draftReceiptHash: string; disclosureHash: string; preflightHash: string;
}) {
  return hash({ version: ETSY_PUBLICATION_VERSION, businessId: binding.businessId, connectionId: binding.connectionId,
    connectionRevision: binding.connectionRevision, shopId: binding.shopId, listingId: binding.listingId,
    identity: binding.identity, packageHash: binding.packageHash, reviewHash: binding.reviewHash,
    draftReceiptHash: binding.draftReceiptHash, disclosureHash: binding.disclosureHash, preflightHash: binding.preflightHash,
    method: "PATCH", path: `/shops/${binding.shopId}/listings/${binding.listingId}`, body: { state: "active" } });
}

export type PublicationPreflight = {
  quantity: 1; shouldAutoRenew: false; shippingProfileId: number; returnPolicyId: number;
  shippingProfile: Record<string, unknown>; returnPolicy: Record<string, unknown>; processingProfile: Record<string, unknown>;
};
export function validatePublicationPreflight(value: PublicationPreflight, listing: unknown, scope: EtsyScope & { userId: number }, p: EtsyProductPackage) {
  const row = record(listing), shipping = record(value.shippingProfile), returns = record(value.returnPolicy), processing = record(value.processingProfile);
  // Temporary Stage18 qualification restriction, never a claim about Etsy's
  // general limits. Existing quantity is not rewritten to fit this lane.
  requireEtsy(p.quantity === 1 && value.quantity === 1 && row.quantity === 1 && value.shouldAutoRenew === false && row.should_auto_renew === false, "publication_initial_qualification_limit");
  requireEtsy(["manual", "calculated"].includes(String(shipping.profile_type)), "publication_shipping_incomplete");
  requireEtsy(shipping.profile_type === "manual", "publication_calculated_shipping_not_supported");
  requireEtsy(value.shippingProfileId === p.shippingProfileId && row.shipping_profile_id === value.shippingProfileId && shipping.shipping_profile_id === value.shippingProfileId && shipping.user_id === scope.userId && shipping.is_deleted === false, "publication_shipping_identity_mismatch");
  requireEtsy(typeof shipping.origin_country_iso === "string" && /^[A-Z]{2}$/.test(shipping.origin_country_iso) && typeof shipping.origin_postal_code === "string" && shipping.origin_postal_code.trim().length > 0 && ["manual", "calculated"].includes(String(shipping.profile_type)) && Array.isArray(shipping.shipping_profile_destinations) && shipping.shipping_profile_destinations.length > 0 && shipping.shipping_profile_destinations.length <= 100 && Array.isArray(shipping.shipping_profile_upgrades) && shipping.shipping_profile_upgrades.length <= 100, "publication_shipping_incomplete");
  for (const fee of [shipping.domestic_handling_fee, shipping.international_handling_fee]) {
    if (fee != null) requireEtsy(typeof fee === "number" && Number.isFinite(fee) && fee >= 0, "publication_shipping_incomplete");
  }
  const money = (value: unknown) => {
    const amount = record(value);
    requireEtsy(Number.isSafeInteger(amount.amount) && Number(amount.amount) >= 0 && Number.isSafeInteger(amount.divisor) && Number(amount.divisor) > 0 && amount.currency_code === p.currency, "publication_shipping_incomplete");
  };
  const delivery = (row: Record<string, unknown>) => {
    const carrier = Number.isSafeInteger(row.shipping_carrier_id) && Number(row.shipping_carrier_id) > 0 && typeof row.mail_class === "string" && row.mail_class.trim().length > 0;
    const days = Number.isSafeInteger(row.min_delivery_days) && Number(row.min_delivery_days) >= 1 && Number.isSafeInteger(row.max_delivery_days) && Number(row.max_delivery_days) >= Number(row.min_delivery_days) && Number(row.max_delivery_days) <= 45;
    requireEtsy(carrier || days, "publication_shipping_incomplete");
  };
  const destinations = new Set<number>();
  for (const value of shipping.shipping_profile_destinations) {
    const destination = record(value), id = positiveId(destination.shipping_profile_destination_id);
    requireEtsy(!destinations.has(id) && destination.shipping_profile_id === p.shippingProfileId && destination.origin_country_iso === shipping.origin_country_iso, "publication_shipping_incomplete"); destinations.add(id);
    const country = destination.destination_country_iso, region = destination.destination_region;
    requireEtsy(["none", "eu", "non_eu"].includes(String(region)) && (country === null || country === "" || (typeof country === "string" && /^[A-Z]{2}$/.test(country))) && (!(typeof country === "string" && country.length > 0) || region === "none"), "publication_shipping_incomplete");
    money(destination.primary_cost); money(destination.secondary_cost); delivery(destination);
  }
  const upgrades = new Set<number>();
  for (const value of shipping.shipping_profile_upgrades) {
    const upgrade = record(value), id = positiveId(upgrade.upgrade_id);
    requireEtsy(!upgrades.has(id) && upgrade.shipping_profile_id === p.shippingProfileId && [0, 1].includes(Number(upgrade.type)) && typeof upgrade.type === "number" && typeof upgrade.upgrade_name === "string" && upgrade.upgrade_name.trim().length > 0 && Number.isSafeInteger(upgrade.rank) && Number(upgrade.rank) >= 0, "publication_shipping_incomplete"); upgrades.add(id);
    money(upgrade.price); money(upgrade.secondary_price); delivery(upgrade);
  }
  requireEtsy(positiveId(value.returnPolicyId) === row.return_policy_id && returns.return_policy_id === value.returnPolicyId && returns.shop_id === scope.shopId && typeof returns.accepts_returns === "boolean" && typeof returns.accepts_exchanges === "boolean", "publication_return_policy_required");
  requireEtsy(returns.accepts_returns || returns.accepts_exchanges ? [7, 14, 21, 30, 45, 60, 90].includes(Number(returns.return_deadline)) && typeof returns.return_deadline === "number" : returns.return_deadline === null || (typeof returns.return_deadline === "number" && [7, 14, 21, 30, 45, 60, 90].includes(returns.return_deadline)), "publication_return_policy_invalid");
  requireEtsy(processing.shop_id === scope.shopId && processing.readiness_state_id === p.readinessStateId && processing.readiness_state === "made_to_order" && Number.isSafeInteger(processing.min_processing_days) && Number(processing.min_processing_days) >= 0 && Number.isSafeInteger(processing.max_processing_days) && Number(processing.max_processing_days) >= Number(processing.min_processing_days), "publication_processing_incomplete");
  return hash(value);
}
