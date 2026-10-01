import { createHash } from "node:crypto";

export const ETSY_SCOPES = ["shops_r", "listings_r", "listings_w"] as const;
export const ETSY_VERSION = "etsy-drafts-1.0";
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export const SHA256 = /^[a-f0-9]{64}$/;
export function requireEtsy(ok: unknown, code: string): asserts ok {
  if (!ok) throw new EtsyError(code);
}
export class EtsyError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = "EtsyError"; this.code = code; }
}
export function record(value: unknown): Record<string, unknown> {
  requireEtsy(!!value && typeof value === "object" && !Array.isArray(value), "invalid_response");
  return value as Record<string, unknown>;
}
export function positiveId(value: unknown): number {
  requireEtsy(Number.isSafeInteger(value) && Number(value) > 0, "invalid_identity"); return Number(value);
}
export function hash(value: unknown): string {
  function canonical(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, x]) => [k, canonical(x)]));
    return v;
  }
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
export function bytesHash(value: Uint8Array) { return createHash("sha256").update(value).digest("hex"); }
export type EtsyScope = { businessId: string; connectionId: string; shopId: number };
export type EtsyConnection = EtsyScope & { status: "connected"; revision: string; userId: number; currency: string; expiresAt: string; accessToken: string };
export type EtsyImage = { assetId: string; sha256: string; storagePath: string; mediaType: "image/png"; altText: string };
export type EtsyProperty = { propertyId: number; valueIds: number[]; values: string[]; scaleId: number | null };
/** An immutable product handoff, never an owner-entered JSON form. It is accepted
 * only after server authenticity and authoritative upstream checks, not by a flag. */
export type EtsyProductPackage = {
  version: "1.0"; id: string; businessId: string; goalId: string; workflowRunId: string;
  productIdentity: string; candidateId: string; decisionId: string; creativeApprovalId: string;
  creativeRunId: string; printfulResourceId: string; printfulReceiptId: string;
  productFactsHash: string; approvedAt: string; expiresAt: string;
  title: string; description: string; quantity: number; priceMinor: number; currency: "NZD" | "USD" | "AUD" | "GBP";
  taxonomyId: number; shippingProfileId: number; readinessStateId: number; productionPartnerIds: number[];
  tags: string[]; materials: string[]; properties: EtsyProperty[]; images: EtsyImage[];
};
export function validatePackage(value: unknown, businessId: string, now = Date.now()): asserts value is EtsyProductPackage {
  const p = record(value);
  requireEtsy(p.version === "1.0" && p.businessId === businessId && UUID.test(businessId), "package_business_mismatch");
  for (const key of ["id", "goalId", "workflowRunId", "candidateId", "decisionId", "creativeApprovalId", "creativeRunId", "printfulResourceId", "printfulReceiptId"]) requireEtsy(typeof p[key] === "string" && UUID.test(p[key]), "invalid_package_lineage");
  requireEtsy(typeof p.productIdentity === "string" && /^[a-zA-Z0-9:-]{1,120}$/.test(p.productIdentity) && typeof p.productFactsHash === "string" && SHA256.test(p.productFactsHash), "invalid_product_identity");
  const approved = Date.parse(String(p.approvedAt)), expires = Date.parse(String(p.expiresAt));
  requireEtsy(Number.isFinite(now) && approved <= now && expires > now && expires - approved <= 86_400_000, "stale_package");
  requireEtsy(typeof p.title === "string" && p.title.trim().length > 0 && p.title.length <= 140 && typeof p.description === "string" && p.description.trim().length > 0 && p.description.length <= 10_000, "invalid_listing_text");
  requireEtsy(Number.isSafeInteger(p.quantity) && Number(p.quantity) > 0 && Number(p.quantity) <= 999 && Number.isSafeInteger(p.priceMinor) && Number(p.priceMinor) > 0 && Number(p.priceMinor) <= 10_000_000 && ["NZD", "USD", "AUD", "GBP"].includes(String(p.currency)), "invalid_pricing");
  for (const key of ["taxonomyId", "shippingProfileId", "readinessStateId"]) positiveId(p[key]);
  requireEtsy(Array.isArray(p.productionPartnerIds) && p.productionPartnerIds.length > 0 && p.productionPartnerIds.length <= 5, "production_partner_required");
  p.productionPartnerIds.forEach(positiveId);
  for (const key of ["tags", "materials"]) requireEtsy(Array.isArray(p[key]) && p[key].length <= 13 && p[key].every((v: unknown) => typeof v === "string" && v.trim().length > 0 && v.length <= (key === "tags" ? 20 : 45)) && new Set(p[key]).size === p[key].length, "invalid_listing_attributes");
  requireEtsy(Array.isArray(p.properties) && p.properties.length <= 30, "invalid_properties");
  const propertyIds = new Set<number>();
  for (const item of p.properties) {
    const prop = record(item); const id = positiveId(prop.propertyId);
    requireEtsy(!propertyIds.has(id), "duplicate_property"); propertyIds.add(id);
    requireEtsy(Array.isArray(prop.valueIds) && prop.valueIds.length > 0 && prop.valueIds.length <= 10 && Array.isArray(prop.values) && prop.values.length === prop.valueIds.length && prop.values.every(v => typeof v === "string" && v.length > 0 && v.length <= 200), "invalid_properties");
    prop.valueIds.forEach(positiveId); if (prop.scaleId !== null) positiveId(prop.scaleId);
  }
  requireEtsy(Array.isArray(p.images) && p.images.length > 0 && p.images.length <= 10, "reviewed_images_required");
  const assets = new Set<string>();
  for (const item of p.images) {
    const image = record(item);
    requireEtsy(typeof image.assetId === "string" && UUID.test(image.assetId) && !assets.has(image.assetId) && typeof image.sha256 === "string" && SHA256.test(image.sha256), "invalid_asset_identity");
    assets.add(image.assetId);
    requireEtsy(image.mediaType === "image/png" && typeof image.storagePath === "string" && image.storagePath.startsWith(`${businessId}/${p.creativeRunId}/`) && /^version-[12]\.png$/.test(image.storagePath.split("/")[2] ?? "") && image.storagePath.split("/").length === 3 && typeof image.altText === "string" && image.altText.length > 0 && image.altText.length <= 400, "invalid_asset_provenance");
  }
}
export function sameScope(a: EtsyScope, b: EtsyScope) {
  requireEtsy(UUID.test(a.businessId) && UUID.test(a.connectionId) && a.businessId === b.businessId && a.connectionId === b.connectionId && a.shopId === b.shopId, "account_scope_mismatch"); positiveId(a.shopId);
}
export function draftIdentity(scope: EtsyScope, p: EtsyProductPackage) {
  // Product identity survives new package versions and double clicks.
  return `al-${hash({ businessId: scope.businessId, shopId: scope.shopId, product: p.productIdentity }).slice(0, 40)}`;
}
export function draftBody(p: EtsyProductPackage, identity: string) {
  requireEtsy(/^al-[a-f0-9]{40}$/.test(identity), "invalid_external_identity");
  // createDraftListing has no application idempotency key. A stable marker travels
  // in the initial POST, before any later image/property write, for reconciliation.
  return { quantity: p.quantity, title: p.title, description: `${p.description}\n\nReference: ${identity}`,
    price: `${Math.floor(p.priceMinor / 100)}.${String(p.priceMinor % 100).padStart(2, "0")}`,
    who_made: "someone_else", when_made: "made_to_order", is_supply: false, taxonomy_id: p.taxonomyId,
    shipping_profile_id: p.shippingProfileId, readiness_state_id: p.readinessStateId,
    production_partner_ids: p.productionPartnerIds, tags: p.tags, materials: p.materials,
    type: "physical", should_auto_renew: false };
}
export function verifyListing(raw: unknown, scope: EtsyScope, p: EtsyProductPackage, identity: string, listingId?: number) {
  const listing = record(raw), expected = draftBody(p, identity), money = record(listing.price);
  positiveId(listing.listing_id);
  requireEtsy(listing.shop_id === scope.shopId && (!listingId || listing.listing_id === listingId) && listing.state === "draft", "draft_identity_or_state_changed");
  requireEtsy(listing.title === expected.title && listing.description === expected.description && listing.quantity === p.quantity && listing.taxonomy_id === p.taxonomyId && listing.shipping_profile_id === p.shippingProfileId && listing.readiness_state_id === p.readinessStateId && listing.who_made === "someone_else" && listing.when_made === "made_to_order" && listing.is_supply === false && listing.listing_type === "physical" && listing.should_auto_renew === false, "listing_readback_mismatch");
  requireEtsy(Number.isSafeInteger(money.amount) && Number.isSafeInteger(money.divisor) && Number(money.divisor) > 0 && BigInt(Number(money.amount)) * BigInt(100) === BigInt(p.priceMinor) * BigInt(Number(money.divisor)) && money.currency_code === p.currency, "price_readback_mismatch");
  for (const key of ["tags", "materials"]) requireEtsy(Array.isArray(listing[key]) && hash([...listing[key]].sort()) === hash([...expected[key as "tags" | "materials"]].sort()), "attribute_readback_mismatch");
  requireEtsy(Array.isArray(listing.production_partners) && hash(listing.production_partners.map(v => positiveId(record(v).production_partner_id)).sort()) === hash([...p.productionPartnerIds].sort()), "partner_readback_mismatch");
  return Number(listing.listing_id);
}
