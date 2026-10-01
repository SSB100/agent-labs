import { createHash } from "node:crypto";
import { assertPrintfulConfigurationPlan, type PrintfulConfigurationPlan } from "./configuration";
import { evaluatePrintPricing, type PrintPricingInput } from "./pricing";
import type { PrintfulFileTypeEvidence } from "./operations";
import { decimalMinor, supportedCurrency, type SupportedCurrency } from "./contracts";

export const PRODUCT_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export const PRODUCT_HASH = /^[a-f0-9]{64}$/;
export class PrintfulProductError extends Error {
  constructor(readonly code: string) { super(code); this.name = "PrintfulProductError"; }
}
export function productAssert(value: unknown, code: string): asserts value { if (!value) throw new PrintfulProductError(code); }
export function productRecord(value: unknown): Record<string, unknown> {
  productAssert(value !== null && typeof value === "object" && !Array.isArray(value), "product_response_invalid");
  return value as Record<string, unknown>;
}
/** Canonical JSON survives jsonb round trips. It is deliberately separate from
 * the foundation's ordered request hashes, and from Stage17 productFactsHash. */
export function productHash(value: unknown): string {
  function canonical(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, x]) => [k, canonical(x)]));
    return v;
  }
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
export type ProductScope = { businessId: string; connectionId: string; connectionRevision: string; storeId: number; storeKind: "manual_api" };
export type ProductFileBinding = {
  id: string; source: "authenticated_upload"; assetSha256: string; printfulFileId: number;
  providerMd5: string; widthPx: number; heightPx: number; observedAt: string; expiresAt: string;
};
/** Reserved consumer seam, not an implemented producer. No form, owner JSON or
 * product GET can mint this evidence. A later authenticated printfile/template
 * producer must establish the hash-bound physical layout before dispatch. */
export type ProductPlacementEvidence = {
  id: string; source: "authenticated_placement"; proofHash: string; assetSha256: string;
  catalogVariantId: number; placement: "front" | "back"; designWidthIn: number; designHeightIn: number;
  observedAt: string; expiresAt: string;
};
export type ProductConfigurationSource = ProductScope & {
  version: "1.0.0"; id: string; evidenceMode: "live" | "fixture";
  goalId: string; workflowRunId: string; candidateId: string; decisionId: string;
  creativeApprovalId: string; creativeRunId: string; assetVersionId: string; assetSha256: string; assetStoragePath: string;
  plan: PrintfulConfigurationPlan; name: string; retailPrice: string; currency: SupportedCurrency;
  printfulFileId: number; fileTypeEvidence: PrintfulFileTypeEvidence; fileBinding: ProductFileBinding; placementEvidence: ProductPlacementEvidence | null;
  stockEvidence: { variantId: number; available: true; responseHash: string; observedAt: string; expiresAt: string };
  costEvidence: { variantId: number; currency: SupportedCurrency; productionMinor: number; responseHash: string; observedAt: string; expiresAt: string; pricing: PrintPricingInput };
  /** Hash of the upstream catalog/stock/cost snapshot, not a listing fact basis. */
  providerFactsHash: string; observedAt: string; expiresAt: string;
};
export type ProductConfigurationApproval = {
  id: string; sourceHash: string; requestHash: string; operation: "create_native_product";
  configuration: true; approvedAt: string; expiresAt: string;
};
export function assertProductScope(scope: ProductScope) {
  productAssert(scope && [scope.businessId, scope.connectionId, scope.connectionRevision].every(value => typeof value === "string" && PRODUCT_UUID.test(value)) &&
    Number.isSafeInteger(scope.storeId) && scope.storeId > 0 && scope.storeKind === "manual_api", "product_scope_invalid");
}
export function sameProductScope(expected: ProductScope, actual: ProductScope) {
  assertProductScope(actual);
  productAssert(expected.businessId === actual.businessId && expected.connectionId === actual.connectionId &&
    expected.connectionRevision === actual.connectionRevision && expected.storeId === actual.storeId && expected.storeKind === actual.storeKind, "product_scope_mismatch");
}
function fresh(observedAt: string, expiresAt: string, now: number) {
  return Number.isFinite(Date.parse(observedAt)) && Date.parse(observedAt) <= now && Date.parse(expiresAt) > now &&
    Date.parse(expiresAt) - Date.parse(observedAt) <= 86_400_000;
}
export function productIdentity(source: Pick<ProductConfigurationSource, "id">) {
  productAssert(PRODUCT_UUID.test(source.id), "product_source_invalid");
  return `al-pf-${source.id.replaceAll("-", "")}`;
}
export function productRequestHash(source: ProductScope & { id: string }, sourceHash: string) {
  assertProductScope(source); productAssert(PRODUCT_UUID.test(source.id) && PRODUCT_HASH.test(sourceHash), "product_source_invalid");
  return createHash("sha256").update(`printful-product-configure:v1:${source.businessId}:${source.id}:${sourceHash}:${source.connectionId}:${source.connectionRevision}:${source.storeId}`).digest("hex");
}
/** Authentication and latest TEST/production approval are checked by SQL. This
 * validator adds full shape/identity/expiry guards before transport. */
export function validateProductSource(source: ProductConfigurationSource, now = Date.now(), requirePlacement = true) {
  assertProductScope(source);
  productAssert(source.version === "1.0.0" && ["live", "fixture"].includes(source.evidenceMode) &&
    [source.id, source.goalId, source.workflowRunId, source.candidateId, source.decisionId, source.creativeApprovalId, source.creativeRunId, source.assetVersionId].every(value => typeof value === "string" && PRODUCT_UUID.test(value)) &&
    PRODUCT_HASH.test(source.assetSha256) && PRODUCT_HASH.test(source.providerFactsHash), "product_source_invalid");
  try { assertPrintfulConfigurationPlan(source.plan); } catch { throw new PrintfulProductError("product_plan_changed"); }
  const p = source.plan;
  productAssert(p.businessId === source.businessId && p.storeKind === "manual_api" && p.operation === "create_native_sync_product" &&
    p.assetVersionId === source.assetVersionId && p.assetSha256 === source.assetSha256 && p.technique === "dtg", "product_source_mismatch");
  productAssert(source.assetStoragePath === `${source.businessId}/${source.creativeRunId}/version-1.png` || source.assetStoragePath === `${source.businessId}/${source.creativeRunId}/version-2.png`, "product_asset_path_invalid");
  productAssert(typeof source.name === "string" && source.name.trim().length > 0 && source.name.length <= 200 && !/[\u0000-\u001f]/.test(source.name), "product_name_invalid");
  try { supportedCurrency(source.currency); productAssert(decimalMinor(source.retailPrice) > 0, "product_price_invalid"); } catch { throw new PrintfulProductError("product_price_invalid"); }
  productAssert(fresh(source.observedAt, source.expiresAt, now), "product_source_stale");
  const ft = source.fileTypeEvidence;
  productAssert(ft && ft.catalogProductId === p.productId && ft.catalogVariantId === p.variantId && ft.placement === p.placement &&
    ft.fileType === (p.placement === "front" ? "default" : "back") && PRODUCT_HASH.test(ft.responseHash) && fresh(ft.observedAt, ft.expiresAt, now), "product_file_type_evidence_required");
  const stock = source.stockEvidence, cost = source.costEvidence;
  productAssert(stock && stock.variantId === p.variantId && stock.available === true && PRODUCT_HASH.test(stock.responseHash) && fresh(stock.observedAt, stock.expiresAt, now), "product_stock_evidence_required");
  productAssert(cost && cost.variantId === p.variantId && cost.currency === source.currency && Number.isSafeInteger(cost.productionMinor) && cost.productionMinor >= 0 && PRODUCT_HASH.test(cost.responseHash) && fresh(cost.observedAt, cost.expiresAt, now), "product_cost_evidence_required");
  try {
    productAssert(cost.pricing.currency === source.currency && cost.pricing.itemPriceMinor === decimalMinor(source.retailPrice) && cost.pricing.productionMinor === cost.productionMinor && evaluatePrintPricing(cost.pricing).status === "scenario_calculated", "product_cost_evidence_required");
  } catch { throw new PrintfulProductError("product_cost_evidence_required"); }
  productAssert(source.providerFactsHash === productHash({ productCatalogHash: p.productCatalogHash, variantCatalogHash: p.variantCatalogHash, stockEvidence: stock, costEvidence: cost }), "product_provider_facts_changed");
  const f = source.fileBinding;
  productAssert(f && PRODUCT_UUID.test(f.id) && f.source === "authenticated_upload" && f.assetSha256 === source.assetSha256 &&
    Number.isSafeInteger(source.printfulFileId) && source.printfulFileId > 0 && f.printfulFileId === source.printfulFileId && /^[a-f0-9]{32}$/.test(f.providerMd5) &&
    f.widthPx === p.sourceWidthPx && f.heightPx === p.sourceHeightPx && fresh(f.observedAt, f.expiresAt, now), "product_file_binding_required");
  const placement = source.placementEvidence;
  if (requirePlacement) productAssert(placement, "product_placement_producer_required");
  if (placement) productAssert(PRODUCT_UUID.test(placement.id) && placement.source === "authenticated_placement" && PRODUCT_HASH.test(placement.proofHash) &&
    placement.assetSha256 === source.assetSha256 && placement.catalogVariantId === p.variantId && placement.placement === p.placement &&
    placement.designWidthIn === p.designWidthIn && placement.designHeightIn === p.designHeightIn && fresh(placement.observedAt, placement.expiresAt, now), "product_placement_binding_mismatch");
}
export function validateProductApproval(approval: ProductConfigurationApproval, source: ProductConfigurationSource, sourceHash: string, now: number, historical = false) {
  productAssert(approval && PRODUCT_UUID.test(approval.id) && approval.sourceHash === sourceHash && approval.requestHash === productRequestHash(source, sourceHash) &&
    approval.operation === "create_native_product" && approval.configuration === true &&
    Number.isFinite(Date.parse(approval.approvedAt)) && Date.parse(approval.approvedAt) <= now && Date.parse(approval.expiresAt) > Date.parse(approval.approvedAt) &&
    Date.parse(approval.expiresAt) <= Math.min(Date.parse(source.expiresAt), Date.parse(approval.approvedAt) + 300_000) &&
    (historical || Date.parse(approval.expiresAt) > now), "product_approval_invalid");
}
export const PRODUCT_PRODUCER_READINESS = {
  available: false as const,
  reasons: ["product_write_authority_unavailable", "product_uploaded_asset_producer_required", "product_placement_producer_required"] as const,
  message: "Product creation is paused until a separately approved write connection and authenticated uploaded-file and physical-placement evidence are available. Catalog read access cannot enable product creation.",
};
