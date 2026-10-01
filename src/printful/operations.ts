import { assertPrintfulConfigurationPlan, type PrintfulConfigurationPlan } from "./configuration";
import { assertPrintful, decimalMinor, printfulHash, supportedCurrency, type SupportedCurrency } from "./contracts";

/** Provider v1 file types are independently verified; v2 front is not v1 default. */
export type PrintfulFileTypeEvidence = {
  catalogProductId: number; catalogVariantId: number; placement: "front" | "back";
  fileType: "default" | "back"; observedAt: string; expiresAt: string; responseHash: string;
};
export type PrintfulOperationProposal = {
  method: "POST" | "PUT"; url: string; body: Record<string, unknown>; requestHash: string;
  storeId: number; businessId: string; externalIdentity: string;
  state: "proposal"; executionAuthorized: false; publicationAuthorized: false; orderSubmissionAuthorized: false;
  requires: string[];
};
/** Pure request construction, never fetch. Asset upload/URL sharing is a separate
 * owner-authorized boundary, so only an already approved Printful file ID is used.
 * The private asset URL/credential must never enter a client-visible proposal. */
export function proposePrintfulProductOperation(input: {
  plan: PrintfulConfigurationPlan; storeId: number; name: string; externalIdentity: string;
  existingSyncVariantId: number | null; printfulFileId: number; fileAssetSha256: string;
  fileTypeEvidence: PrintfulFileTypeEvidence; retailPrice: string; currency: SupportedCurrency;
}, now = Date.now()): PrintfulOperationProposal {
  const value = structuredClone(input), {plan, fileTypeEvidence: file} = value;
  assertPrintfulConfigurationPlan(plan);
  assertPrintful(Number.isSafeInteger(value.storeId) && value.storeId > 0 && Number.isSafeInteger(value.printfulFileId) && value.printfulFileId > 0,
    "Exact store and existing provider file identities are required.");
  assertPrintful(value.fileAssetSha256 === plan.assetSha256 && /^[a-f0-9]{64}$/.test(value.fileAssetSha256), "Provider file must be bound to the approved asset hash.");
  assertPrintful(typeof value.name === "string" && value.name.trim().length > 0 && value.name.length <= 200 &&
    typeof value.externalIdentity === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(value.externalIdentity), "A bounded name and stable external identity are required.");
  assertPrintful(Number.isFinite(now) && file.catalogProductId === plan.productId && file.catalogVariantId === plan.variantId && file.placement === plan.placement &&
    file.fileType === (plan.placement === "front" ? "default" : "back") && /^[a-f0-9]{64}$/.test(file.responseHash) &&
    Date.parse(file.observedAt) <= now && Date.parse(file.expiresAt) > now, "Current exact v1 file-type evidence is required.");
  supportedCurrency(value.currency); assertPrintful(decimalMinor(value.retailPrice) > 0, "A positive retail price is required.");
  const files = [{id: value.printfulFileId, type: file.fileType}];
  let method: "POST" | "PUT", url: string, body: Record<string, unknown>;
  if (plan.storeKind === "manual_api" && plan.operation === "create_native_sync_product") {
    assertPrintful(value.existingSyncVariantId === null, "Native creation cannot overwrite an existing ecommerce variant.");
    method = "POST"; url = "https://api.printful.com/store/products";
    body = {sync_product: {name: value.name, external_id: value.externalIdentity}, sync_variants: [{variant_id: plan.variantId, external_id: `${value.externalIdentity}-v`, retail_price: value.retailPrice, files}]};
  } else {
    assertPrintful(plan.storeKind === "ecommerce_linked" && plan.operation === "map_existing_ecommerce_variant" &&
      Number.isSafeInteger(value.existingSyncVariantId) && value.existingSyncVariantId! > 0, "Mapping requires the existing imported ecommerce sync variant.");
    method = "PUT"; url = `https://api.printful.com/sync/variant/${value.existingSyncVariantId}`;
    // No product creation, listing publish, retail price change or broad sync replacement.
    body = {variant_id: plan.variantId, files};
  }
  const request = {method, url, body, storeId: value.storeId, businessId: plan.businessId, externalIdentity: value.externalIdentity};
  return {...request, requestHash: printfulHash({...request, planHash: plan.requestHash, fileTypeHash: file.responseHash, currency: value.currency}),
    state: "proposal", executionAuthorized: false, publicationAuthorized: false, orderSubmissionAuthorized: false,
    requires: [...plan.requires, "verified_existing_provider_file_bound_to_asset", "durable_idempotency_claim", "v1_file_position_verified", "read_after_write_verification"]};
}
