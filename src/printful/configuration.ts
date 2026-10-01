import type { ActionIntent, ActionReceipt, ExternalResource, JsonObject } from "../core/contracts";
import { assertFreshPrintful, assertPrintful, printfulHash, type PrintfulCatalogProduct, type PrintfulCatalogVariant } from "./contracts";

export type PrintAssetEvidence = {
  businessId: string; assetVersionId: string; sha256: string; mimeType: "image/png"; colorSpace: "srgb";
  widthPx: number; heightPx: number; designWidthIn: number; designHeightIn: number;
  printRequirement: {variantId: number; placement: string; technique: "dtg"; minimumDpi: number; sourceUrl: string; verifiedAt: string; expiresAt: string};
  /** References only. The later live server must revalidate every persisted approval. */
  creativeApprovalId: string | null; creativeRunId: string | null;
};
export type PrintfulConfigurationPlan = {
  version: "1.0.0"; businessId: string; productId: number; variantId: number; placement: "front" | "back"; technique: "dtg";
  storeKind: "manual_api" | "ecommerce_linked"; operation: "create_native_sync_product" | "map_existing_ecommerce_variant";
  assetVersionId: string; assetSha256: string; sourceWidthPx: number; sourceHeightPx: number; designWidthIn: number; designHeightIn: number; effectiveDpi: number; requestHash: string;
  productCatalogHash: string; variantCatalogHash: string; printRequirementHash: string;
  state: "proposal"; executionAuthorized: false; publicationAuthorized: false; orderSubmissionAuthorized: false;
  requires: string[];
};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function planPrintfulConfiguration(input: {businessId: string; product: PrintfulCatalogProduct; variant: PrintfulCatalogVariant; placement: "front" | "back"; storeKind: PrintfulConfigurationPlan["storeKind"]; asset: PrintAssetEvidence}, now = Date.now()): PrintfulConfigurationPlan {
  const {businessId, product, variant, asset, placement, storeKind} = structuredClone(input);
  assertPrintful(uuid.test(businessId) && asset.businessId === businessId && uuid.test(asset.assetVersionId), "Asset must belong to the exact Business.");
  assertFreshPrintful(product.provenance, now); assertFreshPrintful(variant.provenance, now);
  assertPrintful(!product.discontinued && variant.productId.value === product.id.value, "Current variant and product identity are required.");
  assertPrintful(placement === "front" || placement === "back", "The initial DTG contract accepts one front/back placement.");
  assertPrintful(product.placements.some(p => p.placement === placement && p.technique === "dtg" && p.fileLayer), "The product does not support this DTG file placement.");
  const bounds = variant.placementDimensions.find(p => p.placement === placement);
  assertPrintful(bounds, "Variant-specific print dimensions are missing.");
  assertPrintful(asset.mimeType === "image/png" && asset.colorSpace === "srgb" && /^[a-f0-9]{64}$/.test(asset.sha256), "A hash-bound sRGB PNG is required.");
  assertPrintful([asset.widthPx, asset.heightPx].every(v => Number.isSafeInteger(v) && v > 0 && v <= 100000), "Invalid source pixels.");
  assertPrintful([asset.designWidthIn, asset.designHeightIn].every(v => Number.isFinite(v) && v > 0) && asset.designWidthIn <= bounds.widthIn && asset.designHeightIn <= bounds.heightIn, "Design exceeds the variant print area; no resize, crop or rotation is implied.");
  assertPrintful(Math.abs(asset.widthPx * asset.designHeightIn - asset.heightPx * asset.designWidthIn) <= 0.000001, "Physical dimensions must preserve the source aspect ratio; no distortion is implied.");
  const rule = asset.printRequirement;
  assertPrintful(rule.variantId === variant.id.value && rule.placement === placement && rule.technique === "dtg" && Number.isFinite(rule.minimumDpi) && rule.minimumDpi > 0, "The print rule must match the variant and placement.");
  let source: URL;
  try { source = new URL(rule.sourceUrl); } catch { throw new Error("A valid Printful print-requirement source is required."); }
  assertPrintful(source.protocol === "https:" && !source.username && !source.password && (source.hostname === "printful.com" || source.hostname.endsWith(".printful.com")), "Print requirements need an attributed Printful source.");
  assertPrintful(Number.isFinite(Date.parse(rule.verifiedAt)) && Date.parse(rule.verifiedAt) <= now && Date.parse(rule.expiresAt) > now, "Print requirements are stale.");
  const effectiveDpi = Math.min(asset.widthPx / asset.designWidthIn, asset.heightPx / asset.designHeightIn);
  assertPrintful(effectiveDpi >= rule.minimumDpi, "Source pixels do not meet the specific print requirement; upscaling is not allowed.");
  assertPrintful(storeKind === "manual_api" || storeKind === "ecommerce_linked", "Store integration type must be explicit.");
  const operation: PrintfulConfigurationPlan["operation"] = storeKind === "manual_api" ? "create_native_sync_product" : "map_existing_ecommerce_variant";
  const selection = {businessId, productId: product.id.value, variantId: variant.id.value, placement, technique: "dtg" as const, storeKind, operation, assetVersionId: asset.assetVersionId, assetSha256: asset.sha256, sourceWidthPx: asset.widthPx, sourceHeightPx: asset.heightPx, designWidthIn: asset.designWidthIn, designHeightIn: asset.designHeightIn, effectiveDpi, productCatalogHash: product.provenance.responseHash, variantCatalogHash: variant.provenance.responseHash, printRequirementHash: printfulHash(rule)};
  return {...selection, version: "1.0.0", requestHash: printfulHash(selection), state: "proposal", executionAuthorized: false, publicationAuthorized: false, orderSubmissionAuthorized: false,
    requires: ["verified_store_connection", "current_persisted_creative_production_approval", "current_stock_and_cost_quote", "owner_configuration_approval", ...(storeKind === "ecommerce_linked" ? ["existing_imported_ecommerce_variant"] : [])]};
}

export function assertPrintfulConfigurationPlan(plan: PrintfulConfigurationPlan) {
  assertPrintful(plan.version === "1.0.0" && plan.state === "proposal" && plan.executionAuthorized === false && plan.publicationAuthorized === false && plan.orderSubmissionAuthorized === false, "A non-authorizing configuration proposal is required.");
  const selection: Record<string, unknown> = {...plan};
  for (const key of ["version", "requestHash", "state", "executionAuthorized", "publicationAuthorized", "orderSubmissionAuthorized", "requires"]) delete selection[key];
  assertPrintful(printfulHash(selection) === plan.requestHash, "Configuration proposal was modified.");
  const required = ["verified_store_connection", "current_persisted_creative_production_approval", "current_stock_and_cost_quote", "owner_configuration_approval", ...(plan.storeKind === "ecommerce_linked" ? ["existing_imported_ecommerce_variant"] : [])];
  assertPrintful(JSON.stringify(plan.requires) === JSON.stringify(required), "Configuration approval requirements were modified.");
}

/** Mock proof reuses Core receipt shape, but never creates a verified external resource. */
export function simulatePrintfulConfiguration(intent: ActionIntent, plan: PrintfulConfigurationPlan, identity: {receiptId: string; occurredAt: string; attempt: number}): {receipt: ActionReceipt; externalResource: ExternalResource | null} {
  assertPrintfulConfigurationPlan(plan);
  assertPrintful(intent.businessId === plan.businessId && intent.capability === "fulfilment.print" && intent.actionType === "printful.product.configure" && intent.status === "proposed", "A same-Business proposed Printful intent is required.");
  assertPrintful(intent.request.executionMode === "simulation" && intent.request.planHash === plan.requestHash && intent.request.assetSha256 === plan.assetSha256, "Simulation cannot accept a live action or a changed plan.");
  assertPrintful(uuid.test(identity.receiptId) && Number.isFinite(Date.parse(identity.occurredAt)) && identity.attempt === 1, "A single explicit simulation receipt identity is required.");
  const responseSummary: JsonObject = {executionMode: "simulation", externalActionExecuted: false, liveVerified: false, qualification: "fixture_only", planHash: plan.requestHash, requires: plan.requires};
  return {externalResource: null, receipt: {id: identity.receiptId, businessId: plan.businessId, actionIntentId: intent.id, externalResourceId: null, attempt: 1, outcome: "succeeded", provider: "mock.printful", requestFingerprint: printfulHash(intent.request), responseSummary, occurredAt: identity.occurredAt, createdAt: identity.occurredAt}};
}
/** A timeout is a reconciliation requirement, never permission to repeat a POST. */
export function printfulMutationRecovery(outcome: "succeeded" | "failed" | "uncertain", externalId: string | null) {
  if (outcome === "uncertain") return {next: "reconcile_by_saved_external_id" as const, externalId, retryAllowed: false, executionAuthorized: false};
  return {next: outcome === "succeeded" ? "verify_exact_external_state" as const : "review_failure" as const, externalId, retryAllowed: false, executionAuthorized: false};
}
