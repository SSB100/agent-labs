import { hash, requireEtsy } from "../etsy/contracts";

/** Dated public documentation, never an account-specific debit authorization. */
export const publicationPolicy = {
  version: "etsy-assisted-publication-1.0",
  verifiedAt: "2026-10-01T12:15:00.000Z",
  expiresAt: "2026-10-31T12:15:00.000Z",
  mode: "assisted_initial_qualification",
  sourceUrls: {
    api: "https://www.etsy.com/openapi/generated/oas/3.0.0.json",
    create: "https://help.etsy.com/hc/en-us/articles/115015628707-How-to-Create-a-Listing",
    fees: "https://help.etsy.com/hc/en-us/articles/115014483627-What-are-the-Fees-and-Taxes-for-Selling-on-Etsy",
    quantities: "https://help.etsy.com/hc/en-us/articles/360000344908-Fees-and-Listing-Multiple-Quantities",
    renewal: "https://help.etsy.com/hc/en-us/articles/360000344368-How-to-Renew-or-Hide-Your-Listings",
    legalFees: "https://www.etsy.com/legal/fees/",
  },
  informationalBaseFee: { currency: "USD", amountMinor: 20, allIn: false },
  immediateCharge: "Etsy posts a listing charge when the listing is published, even if it does not sell.",
  uncertainty: "Etsy may convert fixed USD fees into the payment-account currency when posted and apply tax. Listing-price currency is not proof of billing currency.",
  renewal: "Manual expiration renewal does not remove later multi-quantity or auto-renew-sold listing fees.",
  initialQualification: "This initial qualification path supports one existing single-unit physical draft with manual expiration renewal, a manual shipping profile and an explicit verified return policy. It never changes a draft to meet these conditions.",
  legalVersionStatus: "The retrieved Fees Policy displays a future October 5 update footer relative to the October 1 snapshot. Its current applicable version needs confirmation before consequential use.",
  nativeReviewStatus: "Public instructions document Publish controls but do not establish a harmless preview click or authoritative all-in fee screen. The actual authenticated flow must be observed before enabling a browser fallback.",
} as const;
export const publicationDisclosureHash = hash(publicationPolicy);
export function assertPublicationPolicyFresh(now = Date.now()) {
  requireEtsy(Number.isFinite(now) && Date.parse(publicationPolicy.verifiedAt) <= now && now < Date.parse(publicationPolicy.expiresAt), "publication_policy_refresh_required");
}
export type PublicationFeeReadiness = { available: false; reason: "publication_fee_evidence_required" | "publication_policy_refresh_required"; message: string };
/** No all-in provider quote or authenticated account-specific rule source is
 * available in the current integration. A checkbox, base fee, local cap or
 * generic owner-created artifact cannot substitute for that missing evidence. */
export function publicationFeeReadiness(now = Date.now()): PublicationFeeReadiness {
  try { assertPublicationPolicyFresh(now); }
  catch { return { available: false, reason: "publication_policy_refresh_required", message: "Publication policy evidence needs a current review before a fee approval can be offered." }; }
  return { available: false, reason: "publication_fee_evidence_required", message: "The applicable total listing fee, billing currency and tax exposure have not been verified. Publication approval is unavailable until current provider or account-specific evidence establishes a safe total." };
}
