import type { JsonObject } from "../core/contracts";
import { MAX_CREATIVE_PNG_BYTES, type AssetInspection } from "../creative/types";
import { bytesHash, EtsyError, hash, requireEtsy, UUID, validatePackage, type EtsyProductPackage } from "../etsy/contracts";
import { unseal } from "../etsy/vault";
import { LISTING_VERSION, validateListingInput, type ListingImageEvidence, type ListingInput, type ListingSource } from "./contracts";

export type ListingArtifactRow = { id: string; business_id: string; artifact_type: string; content: JsonObject };
export type ListingReceiptRow = { id: string; business_id: string; provider: string; outcome: string; response_summary: JsonObject };
export type ListingCreativeApprovalRow = { id: string; business_id: string; purpose: string; snapshot: JsonObject };
export type ListingAssetRow = { id: string; business_id: string; creative_run_id: string; asset_hash: string; storage_path: string; inspection: AssetInspection };

/** Implementations must use owner-scoped reads and the authoritative Stage16
 * validate_package RPC. This interface grants no model, commerce or write path.
 * Missing records fail closed; there are no retries or fixture fallbacks. */
export interface ListingEvidenceReader {
  readArtifact(id: string): Promise<ListingArtifactRow | null>;
  readReceipt(id: string): Promise<ListingReceiptRow | null>;
  readCreativeApproval(id: string): Promise<ListingCreativeApprovalRow | null>;
  readAsset(id: string): Promise<ListingAssetRow | null>;
  imageBytes(storagePath: string): Promise<Uint8Array>;
  assertPackage(product: EtsyProductPackage): Promise<void>;
}

type BusinessFacts = { version: "1.0.0"; businessId: string; artifactId: string; snapshot: JsonObject };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

// Reader failures may contain database details, provider bodies or storage URLs.
// Do not forward even a reader-supplied EtsyError code across this boundary.
async function read<T>(operation: () => Promise<T>, code = "listing_evidence_unavailable"): Promise<T> {
  try { return structuredClone(await operation()); }
  catch { throw new EtsyError(code); }
}
function scoped<T extends { id: string; business_id: string }>(row: T | null, id: string, businessId: string): asserts row is T {
  requireEtsy(row && row.id === id && row.business_id === businessId, "listing_evidence_scope_mismatch");
}
async function artifact(reader: ListingEvidenceReader, id: string, businessId: string, type: string) {
  const row = await read(() => reader.readArtifact(id));
  scoped(row, id, businessId);
  requireEtsy(row.artifact_type === type && object(row.content), "listing_evidence_artifact_mismatch");
  return row;
}

async function resolveSource(source: ListingSource, input: ListingInput, reader: ListingEvidenceReader, vaultKey: string) {
  const p = input.product;
  if (source.recordType === "printful_receipt") {
    const row = await read(() => reader.readReceipt(source.recordId));
    scoped(row, source.recordId, p.businessId);
    requireEtsy(row.id === p.printfulReceiptId && row.provider === "printful" && row.outcome === "succeeded", "listing_product_readback_required");
    const summary = row.response_summary;
    requireEtsy(object(summary) && summary.configurationVerified === true && summary.assetBindingVerified === true &&
      summary.productFactsHash === p.productFactsHash, "listing_product_readback_mismatch");
    // listingFacts is a bounded future verified-product-executor field. Its
    // absence is a prerequisite blocker, never permission to infer product facts.
    requireEtsy(object(summary.listingFacts) && hash(summary.listingFacts) === hash(source.snapshot), "listing_source_snapshot_mismatch");
    return;
  }
  if (source.recordType === "creative_approval") {
    const row = await read(() => reader.readCreativeApproval(source.recordId));
    scoped(row, source.recordId, p.businessId);
    requireEtsy(row.id === p.creativeApprovalId && row.purpose === "candidate_production" && object(row.snapshot), "listing_creative_approval_required");
    const { concept, designInstructions, rightsStatement, rightsConfirmed, originalDesign } = row.snapshot;
    requireEtsy(typeof concept === "string" && typeof designInstructions === "string" && typeof rightsStatement === "string" &&
      rightsConfirmed === true && originalDesign === true, "listing_creative_approval_required");
    requireEtsy(hash({ concept, designInstructions, rightsStatement, rightsConfirmed, originalDesign }) === hash(source.snapshot), "listing_source_snapshot_mismatch");
    return;
  }
  const row = await artifact(reader, source.recordId, p.businessId, "listing.business-facts.v1");
  requireEtsy(typeof row.content.listingSourceEnvelope === "string", "authenticated_listing_business_facts_required");
  const facts = unseal<BusinessFacts>(row.content.listingSourceEnvelope, `listing-business-facts:${p.businessId}:${row.id}`, vaultKey);
  requireEtsy(facts?.version === LISTING_VERSION && facts.businessId === p.businessId && facts.artifactId === row.id &&
    object(facts.snapshot) && object(row.content.listingSourceSnapshot) && hash(facts.snapshot) === hash(source.snapshot) &&
    hash(row.content.listingSourceSnapshot) === hash(source.snapshot), "listing_source_snapshot_mismatch");
}

async function resolveImage(proof: ListingImageEvidence, input: ListingInput, reader: ListingEvidenceReader, vaultKey: string) {
  const p = input.product, image = p.images.find(item => item.assetId === proof.assetId)!;
  const review = await artifact(reader, proof.reviewArtifactId, p.businessId, "listing.image-review.v1");
  requireEtsy(typeof review.content.imageReviewEnvelope === "string", "authenticated_listing_image_review_required");
  const verifiedProof = unseal<ListingImageEvidence>(review.content.imageReviewEnvelope, `listing-image-review:${p.businessId}:${review.id}`, vaultKey);
  requireEtsy(object(verifiedProof) && object(review.content.proof) && hash(verifiedProof) === hash(proof) &&
    hash(review.content.proof) === hash(proof) && review.content.reviewResultHash === proof.reviewResultHash, "listing_image_review_mismatch");

  const asset = await read(() => reader.readAsset(image.assetId));
  scoped(asset, image.assetId, p.businessId);
  requireEtsy(asset.creative_run_id === p.creativeRunId && asset.asset_hash === image.sha256 && asset.storage_path === image.storagePath,
    "listing_asset_binding_mismatch");
  const inspection = asset.inspection;
  requireEtsy(object(inspection) && inspection.sha256 === image.sha256 && inspection.mediaType === "image/png" &&
    Number.isSafeInteger(inspection.bytes) && inspection.bytes >= 33 && inspection.bytes <= MAX_CREATIVE_PNG_BYTES &&
    Number.isSafeInteger(inspection.width) && inspection.width > 0 && inspection.width <= 4096 &&
    Number.isSafeInteger(inspection.height) && inspection.height > 0 && inspection.height <= 4096 &&
    inspection.colorSpace === "srgb" && typeof inspection.hasAlpha === "boolean" &&
    Number.isFinite(inspection.transparentPixelFraction) && inspection.transparentPixelFraction >= 0 && inspection.transparentPixelFraction <= 1 &&
    Number.isFinite(inspection.effectiveDpi) && inspection.effectiveDpi > 0 &&
    Array.isArray(inspection.failedCriteria) && inspection.failedCriteria.length === 0, "listing_asset_inspection_mismatch");
  const bytes = await read(() => reader.imageBytes(image.storagePath), "listing_asset_download_failed");
  requireEtsy(bytes instanceof Uint8Array && bytes.byteLength >= 33 && bytes.byteLength <= MAX_CREATIVE_PNG_BYTES &&
    bytes.byteLength === inspection.bytes && bytesHash(bytes) === image.sha256, "listing_asset_bytes_mismatch");
  const png = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  requireEtsy(png.subarray(0, 8).toString("hex") === "89504e470d0a1a0a" && png.readUInt32BE(8) === 13 &&
    png.subarray(12, 16).toString("ascii") === "IHDR" && png.readUInt32BE(16) === inspection.width &&
    png.readUInt32BE(20) === inspection.height, "listing_asset_png_required");
}

/** Authenticate the source package independently of the final Listing Review
 * gate. Never call loadEtsyPackage here: it requires the result of this stage.
 * Source text is data only. No envelopes are minted by this consumer, and an
 * owner-authored JSON record cannot replace a trusted producer's sealed input.
 * The supplied clock is for deterministic local wire tests, not qualification. */
export async function loadVerifiedListingInput(args: {
  businessId: string; sourceArtifactId: string; reader: ListingEvidenceReader; vaultKey: string; now?: number;
}): Promise<{ input: ListingInput; sourceEnvelope: string; sourceContentHash: string; inputHash: string }> {
  try {
    const { businessId, sourceArtifactId, reader, vaultKey, now = Date.now() } = args;
    requireEtsy(UUID.test(businessId) && UUID.test(sourceArtifactId), "approved_listing_source_required");
    const source = await artifact(reader, sourceArtifactId, businessId, "product.package.v1");
    requireEtsy(typeof source.content.etsyDraftEnvelope === "string", "approved_package_required");
    requireEtsy(typeof source.content.listingInputEnvelope === "string", "authenticated_listing_input_required");
    const p = unseal<EtsyProductPackage>(source.content.etsyDraftEnvelope, `product-package:${businessId}:${sourceArtifactId}`, vaultKey);
    const input = unseal<ListingInput>(source.content.listingInputEnvelope, `listing-input:${businessId}:${sourceArtifactId}`, vaultKey);
    validatePackage(p, businessId, now);
    requireEtsy(p.id === sourceArtifactId, "package_identity_mismatch");
    requireEtsy(input?.evidenceMode === "live", "live_listing_input_required");
    requireEtsy(object(input.product) && hash(input.product) === hash(p), "listing_source_package_mismatch");
    requireEtsy(object(source.content.listingInput) && hash(source.content.listingInput) === hash(input), "listing_source_input_mismatch");
    validateListingInput(input, now);
    // Every currently eligible Stage16 package comes from the generated Stage14
    // asset path. A false flag cannot suppress the required AI-item disclosure.
    requireEtsy(input.aiAssisted === true, "listing_ai_disclosure_required");
    await read(() => reader.assertPackage(structuredClone(p)), "upstream_qualification_required");
    for (const item of input.sources) await resolveSource(item, input, reader, vaultKey);
    for (const proof of input.imagery) await resolveImage(proof, input, reader, vaultKey);
    return { input: structuredClone(input), sourceEnvelope: source.content.listingInputEnvelope,
      sourceContentHash: hash(source.content), inputHash: hash(input) };
  } catch (error) {
    if (error instanceof EtsyError) throw error;
    throw new EtsyError("invalid_listing_source_evidence");
  }
}
