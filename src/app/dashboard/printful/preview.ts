import { planPrintfulConfiguration } from "../../../printful/configuration";
import {
  catalogProductId, catalogVariantId, parseCatalogProduct, parseCatalogVariant,
  parseVariantPrices, PRINTFUL_DOCS, printfulHash,
} from "../../../printful/contracts";
import { singlePlacementProductionCost } from "../../../printful/pricing";
import type { PrintfulFixturePreview } from "./types";

/** Entirely invented examples. This module never reads a provider, Business, asset or approval. */
export function buildSyntheticPrintfulPreview(): PrintfulFixturePreview {
  const now = Date.now();
  const provenance = {
    mode: "fixture" as const,
    observedAt: new Date(now - 1000).toISOString(),
    expiresAt: new Date(now + 60 * 60 * 1000).toISOString(),
  };
  const product = parseCatalogProduct({ data: {
    id: 900001, name: "Synthetic everyday T-shirt", type: "Synthetic T-shirt", is_discontinued: false,
    placements: ["front", "back"].map(placement => ({ placement, technique: "dtg", layers: [{ type: "file" }], conflicting_placements: [] })),
  } }, catalogProductId(900001), provenance);
  const businessId = "11111111-1111-4111-8111-111111111111";
  const sourcePixels = { width: 1200, height: 1500, designWidthIn: 8, designHeightIn: 10 };
  const variants = [
    { id: 90000101, name: "Synthetic white / M", color: "White", size: "M", width: 11, height: 14, price: "9.50" },
    { id: 90000102, name: "Synthetic navy / L", color: "Navy", size: "L", width: 12, height: 16, price: "10.50" },
  ].map(example => {
    const variant = parseCatalogVariant({ data: {
      id: example.id, catalog_product_id: product.id.value, name: example.name, color: example.color, size: example.size,
      placement_dimensions: ["front", "back"].map(placement => ({ placement, width: example.width, height: example.height, orientation: "portrait" })),
    } }, catalogVariantId(example.id), product.id, provenance);
    const prices = parseVariantPrices({ data: {
      currency: "USD",
      product: { id: product.id.value, placements: ["front", "back"].map(id => ({ id, technique_key: "dtg", price: "5.75" })) },
      variant: { id: variant.id.value, techniques: [{ technique_key: "dtg", price: example.price, discounted_price: null }] },
    } }, variant, { ...provenance, currency: "USD", sellingRegion: "synthetic_region", productionCurrency: null });
    const plans = (["front", "back"] as const).flatMap(placement =>
      (["manual_api", "ecommerce_linked"] as const).map(storeKind => planPrintfulConfiguration({
        businessId, product, variant, placement, storeKind,
        asset: {
          businessId, assetVersionId: "22222222-2222-4222-8222-222222222222",
          sha256: printfulHash("synthetic pixels: no real production asset"), mimeType: "image/png", colorSpace: "srgb",
          widthPx: sourcePixels.width, heightPx: sourcePixels.height,
          designWidthIn: sourcePixels.designWidthIn, designHeightIn: sourcePixels.designHeightIn,
          printRequirement: { variantId: variant.id.value, placement, technique: "dtg", minimumDpi: 150,
            sourceUrl: PRINTFUL_DOCS.catalog, verifiedAt: provenance.observedAt, expiresAt: provenance.expiresAt },
          creativeApprovalId: null, creativeRunId: null,
        },
      }, now)),
    );
    return { variant, productionMinor: singlePlacementProductionCost(prices, "front", now).productionMinor, plans };
  });
  return { product, variants, sourcePixels };
}
