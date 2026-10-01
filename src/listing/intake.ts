import { requireEtsy, type EtsyProductPackage } from "../etsy/contracts";
import { unseal } from "../etsy/vault";
import { assertReviewedListing, type ReviewedListing } from "./runtime";

/** Authentication is separate from validation: owner-editable artifact content
 * can carry this opaque envelope, but cannot manufacture or modify its contents.
 * No API/action in Stage17 mints an envelope or accepts owner-supplied review JSON. */
export function authenticateListingReview(envelope: unknown, product: EtsyProductPackage, vaultKey: string, now = Date.now()) {
  requireEtsy(typeof envelope === "string", "authenticated_listing_review_required");
  const review = unseal<ReviewedListing>(envelope, `listing-review:${product.businessId}:${product.id}`, vaultKey);
  assertReviewedListing(review,product,now);
  return review;
}
