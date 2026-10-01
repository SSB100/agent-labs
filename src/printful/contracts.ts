import { createHash } from "node:crypto";
import type { JsonObject } from "../core/contracts";

/** Provider facts are versioned data, never account, spending or product authority. */
export const PRINTFUL_FOUNDATION_VERSION = "1.0.0";
export const PRINTFUL_DOCS = {
  catalog: "https://developers.printful.com/docs/v2-beta/#tag/Catalog-v2",
  products: "https://developers.printful.com/docs/#tag/Products-API",
  ecommerceSync: "https://developers.printful.com/docs/#tag/Ecommerce-Platform-Sync-API",
} as const;
export type CatalogProductId = { kind: "catalog_product"; value: number };
export type CatalogVariantId = { kind: "catalog_variant"; value: number };
export type SupportedCurrency = "USD" | "GBP" | "AUD" | "NZD";
export type PrintfulProvenance = {
  apiVersion: "v2-beta"; mode: "fixture" | "provider_response";
  observedAt: string; expiresAt: string; responseHash: string;
  /** A parsed response alone is not independently verified external state. */
  liveQualified: false;
};
export type PrintfulPlacement = { placement: string; technique: string; fileLayer: boolean; conflictingPlacements: string[] };
export type PrintfulCatalogProduct = {
  id: CatalogProductId; name: string; type: string; discontinued: boolean;
  placements: PrintfulPlacement[]; provenance: PrintfulProvenance;
};
export type PrintfulCatalogVariant = {
  id: CatalogVariantId; productId: CatalogProductId; name: string; size: string; color: string;
  placementDimensions: { placement: string; widthIn: number; heightIn: number; orientation: string }[];
  provenance: PrintfulProvenance;
};
export type PrintfulVariantPrices = {
  variantId: CatalogVariantId; productId: CatalogProductId; currency: SupportedCurrency;
  techniques: { key: string; regularMinor: number; discountedMinor: number | null }[];
  placementPrices: { placement: string; technique: string; regularMinor: number }[];
  sellingRegion: string; productionCurrency: SupportedCurrency | null;
  shippingIncluded: false; taxesIncluded: false; marketplaceFeesIncluded: false;
  provenance: PrintfulProvenance;
};
export function printfulHash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function assertPrintful(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function record(value: unknown, label: string): Record<string, unknown> {
  assertPrintful(value !== null && typeof value === "object" && !Array.isArray(value), `Invalid Printful ${label}.`);
  return value as Record<string, unknown>;
}
function string(value: unknown, label: string) {
  assertPrintful(typeof value === "string" && value.trim().length > 0 && value.length <= 2000, `Invalid Printful ${label}.`);
  return value;
}
function list(value: unknown, label: string, maximum = 1000) {
  assertPrintful(Array.isArray(value) && value.length <= maximum, `Invalid Printful ${label}.`); return value;
}
function positive(value: unknown, label: string) {
  assertPrintful(typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 100000, `Invalid Printful ${label}.`); return value;
}
export function catalogProductId(value: unknown): CatalogProductId {
  assertPrintful(Number.isSafeInteger(value) && Number(value) > 0, "A positive catalog product ID is required.");
  return { kind: "catalog_product", value: Number(value) };
}
export function catalogVariantId(value: unknown): CatalogVariantId {
  assertPrintful(Number.isSafeInteger(value) && Number(value) > 0, "A positive catalog variant ID is required.");
  return { kind: "catalog_variant", value: Number(value) };
}
export function supportedCurrency(value: unknown): SupportedCurrency {
  assertPrintful(["USD", "GBP", "AUD", "NZD"].includes(String(value)), "This bounded pricing contract supports USD, GBP, AUD and NZD only; no currency conversion is implied.");
  return value as SupportedCurrency;
}
/** Printful v2 documents decimal strings, at most two fractional digits. No floating-point money. */
export function decimalMinor(value: unknown): number {
  assertPrintful(typeof value === "string" && /^(0|[1-9]\d{0,8})(\.\d{1,2})?$/.test(value), "A nonnegative two-decimal provider price is required.");
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
export function assertFreshPrintful(provenance: PrintfulProvenance, now = Date.now()) {
  assertPrintful(provenance.apiVersion === "v2-beta" && ["fixture", "provider_response"].includes(provenance.mode) && provenance.liveQualified === false && /^[a-f0-9]{64}$/.test(provenance.responseHash), "Invalid versioned Printful provenance.");
  const observed = Date.parse(provenance.observedAt), expires = Date.parse(provenance.expiresAt);
  assertPrintful(Number.isFinite(now) && Number.isFinite(observed) && Number.isFinite(expires) && observed <= now && expires > now && expires > observed, "Printful data is stale or has invalid provenance dates.");
}
export function printfulProvenance(response: unknown, context: {mode: PrintfulProvenance["mode"]; observedAt: string; expiresAt: string}): PrintfulProvenance {
  const provenance = { mode: context.mode, observedAt: context.observedAt, expiresAt: context.expiresAt, apiVersion: "v2-beta" as const, responseHash: printfulHash(response), liveQualified: false as const };
  assertFreshPrintful(provenance); return provenance;
}
export function parseCatalogProduct(response: unknown, expected: CatalogProductId, context: Parameters<typeof printfulProvenance>[1]): PrintfulCatalogProduct {
  assertPrintful(expected.kind === "catalog_product", "A variant ID cannot identify a catalog product.");
  const data = record(record(response, "envelope").data, "catalog product");
  const id = catalogProductId(data.id); assertPrintful(id.value === expected.value, "Returned product differs from the requested catalog product.");
  assertPrintful(typeof data.is_discontinued === "boolean", "Product discontinuation status is required.");
  const placements = list(data.placements, "placements", 100).map(value => {
    const row = record(value, "placement");
    return { placement: string(row.placement, "placement key"), technique: string(row.technique, "technique"),
      fileLayer: list(row.layers, "layers", 10).some(layer => record(layer, "layer").type === "file"),
      conflictingPlacements: list(row.conflicting_placements ?? [], "conflicting placements", 100).map(x => string(x, "conflicting placement")) };
  });
  assertPrintful(new Set(placements.map(p => `${p.placement}:${p.technique}`)).size === placements.length, "Ambiguous duplicate placement/technique.");
  return {id, name: string(data.name, "product name"), type: string(data.type, "product type"), discontinued: data.is_discontinued, placements, provenance: printfulProvenance(response, context)};
}
export function parseCatalogVariant(response: unknown, expected: CatalogVariantId, product: CatalogProductId, context: Parameters<typeof printfulProvenance>[1]): PrintfulCatalogVariant {
  assertPrintful(expected.kind === "catalog_variant" && product.kind === "catalog_product", "Explicit catalog variant and parent product identities are required.");
  const data = record(record(response, "envelope").data, "catalog variant");
  const id = catalogVariantId(data.id), productId = catalogProductId(data.catalog_product_id);
  assertPrintful(id.value === expected.value && productId.value === product.value, "Returned variant or parent product differs from the requested identity.");
  const dimensions = list(data.placement_dimensions, "placement dimensions", 100).map(value => {
    const row = record(value, "placement dimensions");
    return {placement: string(row.placement, "placement key"), widthIn: positive(row.width, "placement width"), heightIn: positive(row.height, "placement height"), orientation: string(row.orientation, "orientation")};
  });
  assertPrintful(new Set(dimensions.map(p => p.placement)).size === dimensions.length, "Ambiguous variant placement dimensions.");
  return {id, productId, name: string(data.name, "variant name"), size: string(data.size, "variant size"), color: string(data.color, "variant color"), placementDimensions: dimensions, provenance: printfulProvenance(response, context)};
}
export function parseVariantPrices(response: unknown, variant: PrintfulCatalogVariant, context: Parameters<typeof printfulProvenance>[1] & {currency: SupportedCurrency; sellingRegion: string; productionCurrency: SupportedCurrency | null}): PrintfulVariantPrices {
  const data = record(record(response, "envelope").data, "variant prices"), product = record(data.product, "priced product"), priced = record(data.variant, "priced variant");
  assertPrintful(catalogProductId(product.id).value === variant.productId.value && catalogVariantId(priced.id).value === variant.id.value, "Prices belong to a different product or variant.");
  const currency = supportedCurrency(data.currency); assertPrintful(currency === context.currency, "Price currency differs from the explicit request.");
  const techniques = list(priced.techniques, "price techniques", 20).map(value => { const row = record(value, "price technique"); return {key: string(row.technique_key, "technique"), regularMinor: decimalMinor(row.price), discountedMinor: row.discounted_price == null ? null : decimalMinor(row.discounted_price)}; });
  assertPrintful(techniques.length > 0 && new Set(techniques.map(t => t.key)).size === techniques.length, "Ambiguous or absent technique prices.");
  const placementPrices = list(product.placements, "placement prices", 100).map(value => { const row = record(value, "placement price"); return {placement: string(row.id, "priced placement"), technique: string(row.technique_key, "technique"), regularMinor: decimalMinor(row.price)}; });
  return {variantId: catalogVariantId(variant.id.value), productId: catalogProductId(variant.productId.value), currency, techniques, placementPrices,
    sellingRegion: string(context.sellingRegion, "selling region"), productionCurrency: context.productionCurrency === null ? null : supportedCurrency(context.productionCurrency),
    shippingIncluded: false, taxesIncluded: false, marketplaceFeesIncluded: false, provenance: printfulProvenance(response, context)};
}
/** Fixed safe endpoint descriptions only; no fetch, token or caller-supplied URL. */
export function printfulReadRequest(kind: "product" | "variant" | "prices", id: CatalogProductId | CatalogVariantId, context?: {currency: SupportedCurrency; sellingRegion: string}) {
  assertPrintful(kind === "product" ? id.kind === "catalog_product" : id.kind === "catalog_variant", "Product and variant endpoints use different identity types.");
  const value = kind === "product" ? catalogProductId(id.value).value : catalogVariantId(id.value).value;
  const url = new URL(`https://api.printful.com/v2/${kind === "product" ? "catalog-products" : "catalog-variants"}/${value}${kind === "prices" ? "/prices" : ""}`);
  if (kind === "prices") { assertPrintful(context, "Explicit price currency and selling region are required."); url.searchParams.set("currency", supportedCurrency(context.currency)); url.searchParams.set("selling_region_name", string(context.sellingRegion, "selling region")); }
  return {method: "GET" as const, url: url.toString(), apiVersion: "v2-beta" as const, connectionRequired: true, executionAuthorized: false as const};
}
export function asPrintfulArtifact(value: PrintfulCatalogProduct | PrintfulCatalogVariant | PrintfulVariantPrices): JsonObject { return JSON.parse(JSON.stringify(value)) as JsonObject; }
