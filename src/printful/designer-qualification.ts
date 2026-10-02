import { createHash } from "node:crypto";
import { inspectProviderSource } from "../creative/image-normalization";
import { MAX_CREATIVE_PNG_BYTES } from "../creative/types";
import { PRODUCT_HASH, PRODUCT_UUID, productHash } from "./production";

/** Offline candidate-evidence checker only. It has no provider, credential,
 * browser, database or issuance dependency. Passing cannot authenticate a capture
 * or qualify the live route; the account-specific probe still needs approval. */
export const DESIGNER_PROBE_VERSION = "printful-designer-probe-1";
export const DESIGNER_PROBE_LIMITS = Object.freeze({
  manualStores: 1, catalogVariants: 1, fileUploads: 1, productCreates: 1,
  designSaves: 1, mockupDownloads: 1, maximumSessionSeconds: 900,
  maximumArtworkBytes: MAX_CREATIVE_PNG_BYTES, maximumMockupBytes: MAX_CREATIVE_PNG_BYTES,
  orders: 0, marketplacePublications: 0, premiumAssets: 0,
  automaticRetries: 0, credentialEntryByAutomation: 0,
});

type Identity = { storeId: number; syncProductId: number; syncVariantId: number; catalogProductId: number; catalogVariantId: number };
type Layout = { width: string; height: string; left: string; top: string; areaWidth: string; areaHeight: string; unit: "in" | "cm" | "mm" };
export type DesignerProbeExpectation = {
  version: typeof DESIGNER_PROBE_VERSION; probeId: string; businessId: string;
  connectionId: string; connectionRevision: string; storeId: number;
  candidateId: string; decisionId: string; creativeApprovalId: string; creativeRunId: string; assetVersionId: string;
  purpose: "candidate_production"; artworkSha256: string; artworkWidthPx: number; artworkHeightPx: number;
  catalogProductId: number; catalogVariantId: number; placement: "front" | "back"; technique: "dtg";
  layout: Layout; minimumDpi: number; startedAt: string; expiresAt: string;
};
type Capture = { captureId: string; capturedAt: string; responseHash: string };
export type DesignerProbeCandidate = {
  evidenceMode: "fixture" | "candidate_capture";
  businessId: string; connectionId: string; connectionRevision: string; probeId: string;
  upload: Capture & { source: "independent_file_get"; fileId: number; md5: string; widthPx: number; heightPx: number; mediaType: "image/png"; status: "ok"; temporary: false };
  product: Capture & Identity & { source: "independent_product_get"; fileId: number; fileMd5: string; fileType: "default" | "back"; variants: 1; savedAt: string };
  design: Capture & Identity & {
    source: "reopened_saved_variant"; fileId: number; leftDesignerAt: string;
    technique: "dtg"; placement: "front" | "back"; layerCount: 1;
    numericSource: "visible_numeric_controls"; coordinateOrigin: "print_area_top_left";
    boundsMeaning: "artwork"; rotationDegrees: "0"; layout: Layout;
    roundingObserved: false; croppingObserved: false; resamplingObserved: false;
  };
  mockup: Capture & Identity & {
    source: "saved_product_download"; designCaptureId: string; sha256: string;
    mediaType: "image/png";
    review: { captureId: string; reviewedAt: string; imageSha256: string;
      outcome: "PASS"; finishedProductShown: true; productMatches: true;
      observedProduct: string };
  };
};
type Check = { name: string; passed: boolean; reason: string | null };
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const positive = (v: unknown) => Number.isSafeInteger(v) && Number(v) > 0;
const digest = (algorithm: "sha256" | "md5", bytes: Uint8Array) => createHash(algorithm).update(bytes).digest("hex");

/** Integer nanometres make 1 inch == 2.54 cm without floating-point tolerances.
 * Unknown units, percentages, estimated pixels and silent rounding are rejected. */
function distance(value: unknown, unit: unknown): bigint | null {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,2})(\.\d{1,4})?$/.test(value)) return null;
  const multiplier = unit === "in" ? BigInt(25_400_000) : unit === "cm" ? BigInt(10_000_000) : unit === "mm" ? BigInt(1_000_000) : null;
  if (multiplier === null) return null;
  const [whole, fraction = ""] = value.split(".");
  const numerator = BigInt(whole + fraction) * multiplier, divisor = BigInt(10) ** BigInt(fraction.length);
  return numerator % divisor === BigInt(0) ? numerator / divisor : null;
}
function geometry(layout: unknown) {
  if (!isRecord(layout)) return null;
  const keys = ["width", "height", "left", "top", "areaWidth", "areaHeight"] as const;
  const values = keys.map(key => distance(layout[key], layout.unit));
  if (values.some(v => v === null)) return null;
  const [width, height, left, top, areaWidth, areaHeight] = values as bigint[];
  if (width <= BigInt(0) || height <= BigInt(0) || areaWidth <= BigInt(0) || areaHeight <= BigInt(0) ||
    areaWidth > BigInt(2_540_000_000) || areaHeight > BigInt(2_540_000_000) || left + width > areaWidth || top + height > areaHeight) return null;
  return { width, height, left, top, areaWidth, areaHeight };
}
function expectationValid(value: unknown): value is DesignerProbeExpectation {
  if (!isRecord(value)) return false;
  const uuids = ["probeId", "businessId", "connectionId", "connectionRevision", "candidateId", "decisionId", "creativeApprovalId", "creativeRunId", "assetVersionId"];
  const g = geometry(value.layout), start = Date.parse(String(value.startedAt)), end = Date.parse(String(value.expiresAt));
  return value.version === DESIGNER_PROBE_VERSION && uuids.every(k => typeof value[k] === "string" && PRODUCT_UUID.test(value[k])) &&
    value.purpose === "candidate_production" && typeof value.artworkSha256 === "string" && PRODUCT_HASH.test(value.artworkSha256) &&
    [value.storeId, value.catalogProductId, value.catalogVariantId, value.artworkWidthPx, value.artworkHeightPx].every(positive) &&
    Number(value.artworkWidthPx) <= 4096 && Number(value.artworkHeightPx) <= 4096 &&
    typeof value.placement === "string" && ["front", "back"].includes(value.placement) && value.technique === "dtg" &&
    Number.isSafeInteger(value.minimumDpi) && Number(value.minimumDpi) >= 1 && Number(value.minimumDpi) <= 1200 &&
    typeof value.startedAt === "string" && typeof value.expiresAt === "string" && Number.isFinite(start) &&
    end > start && end - start <= DESIGNER_PROBE_LIMITS.maximumSessionSeconds * 1000 && !!g &&
    BigInt(Number(value.artworkWidthPx)) * g.height === BigInt(Number(value.artworkHeightPx)) * g.width;
}
async function inspect(bytes: Uint8Array, expectedMime: unknown, maximumBytes: number) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 33 || bytes.byteLength > maximumBytes || expectedMime !== "image/png") throw new Error("bounded_png_required");
  const original = Buffer.from(bytes);
  // Reuse the existing static-PNG parser: CRCs, chunk bounds/order, animation,
  // terminal IEND, full decode and timeout. libvips metadata alone misses APNG.
  const inspected = await inspectProviderSource(original, "image/png");
  if (inspected.mediaType !== "image/png" || inspected.colorSpace !== "srgb") throw new Error("bounded_srgb_png_required");
  return { sha256: inspected.originalSha256, md5: digest("md5", original), width: inspected.width, height: inspected.height, mime: "image/png" };
}

/** Checks shape/identity/geometry/bytes of candidate evidence. Capture hashes and
 * review statements are not authenticated by this function. Never persist this
 * report as a product receipt, ProductPlacementEvidence, or qualification. */
export async function checkDesignerProbe(input: {
  expectation: unknown; candidate: unknown; artworkBytes: Uint8Array; mockupBytes: Uint8Array;
}) {
  const checks: Check[] = [];
  const check = (name: string, passed: boolean, reason: string) => checks.push({ name, passed, reason: passed ? null : reason });
  const report = () => ({ version: DESIGNER_PROBE_VERSION, status: checks.every(c => c.passed) ? "candidate_contract_satisfied" : "blocked",
    checks, liveQualified: false, capturesAuthenticated: false, configurationVerified: false, physicalPrintVerified: false,
    sourceIssuanceAllowed: false, listingReady: false, executionAuthorized: false,
    requiredNextStep: "independently_authenticate_and_review_an_explicitly_authorized_account_specific_probe" });
  try {
    if (Buffer.byteLength(JSON.stringify({ expectation: input.expectation, candidate: input.candidate }) ?? "") > 262_144) throw new Error();
  } catch { check("candidate_document", false, "bounded_json_candidate_required"); return report(); }
  if (!expectationValid(input.expectation)) { check("expectation", false, "exact_production_probe_expectation_required"); return report(); }
  const expected = structuredClone(input.expectation), g = geometry(expected.layout)!;
  check("expectation", true, "");
  const candidate = structuredClone(input.candidate);
  if (!isRecord(candidate)) { check("capture_contract", false, "candidate_evidence_required"); return report(); }
  check("capture_contract", typeof candidate.evidenceMode === "string" && ["fixture", "candidate_capture"].includes(candidate.evidenceMode) &&
    ["probeId", "businessId", "connectionId", "connectionRevision"].every(k => candidate[k] === expected[k as keyof DesignerProbeExpectation]), "candidate_scope_or_mode_mismatch");
  const start = Date.parse(expected.startedAt), end = Date.parse(expected.expiresAt);
  const inWindow = (at: unknown) => typeof at === "string" && Date.parse(at) >= start && Date.parse(at) <= end;
  const captured = (value: unknown): value is Record<string, unknown> => isRecord(value) &&
    typeof value.captureId === "string" && PRODUCT_UUID.test(value.captureId) && inWindow(value.capturedAt) &&
    typeof value.responseHash === "string" && PRODUCT_HASH.test(value.responseHash);
  const upload = candidate.upload, product = candidate.product, design = candidate.design, mockup = candidate.mockup;
  const captures = [upload, product, design, mockup];
  const reviewCapture = isRecord(mockup) && isRecord(mockup.review) ? mockup.review.captureId : null;
  check("capture_independence", captures.every(captured) && typeof reviewCapture === "string" && PRODUCT_UUID.test(reviewCapture) &&
    new Set([...captures.map(c => (c as Record<string, unknown>).captureId), reviewCapture].map(id => String(id).toLowerCase())).size === 5,
  "five_distinct_upload_product_design_mockup_and_review_captures_required");
  let artwork: Awaited<ReturnType<typeof inspect>> | null = null, image: Awaited<ReturnType<typeof inspect>> | null = null;
  try { artwork = await inspect(input.artworkBytes, "image/png", DESIGNER_PROBE_LIMITS.maximumArtworkBytes); } catch { /* Closed diagnostic below. */ }
  check("approved_bytes", !!artwork && artwork.sha256 === expected.artworkSha256 && artwork.width === expected.artworkWidthPx && artwork.height === expected.artworkHeightPx &&
    g.width * BigInt(expected.minimumDpi) <= BigInt(artwork.width) * BigInt(25_400_000) && g.height * BigInt(expected.minimumDpi) <= BigInt(artwork.height) * BigInt(25_400_000),
  "exact_approved_png_bytes_pixels_and_dpi_required");
  check("uploaded_file", captured(upload) && upload.source === "independent_file_get" && positive(upload.fileId) &&
    !!artwork && upload.md5 === artwork.md5 && upload.widthPx === artwork.width && upload.heightPx === artwork.height &&
    upload.mediaType === "image/png" && upload.status === "ok" && upload.temporary === false, "independent_exact_file_readback_required");
  const identityMatches = (v: Record<string, unknown>) => v.storeId === expected.storeId && v.catalogProductId === expected.catalogProductId &&
    v.catalogVariantId === expected.catalogVariantId && positive(v.syncProductId) && positive(v.syncVariantId);
  check("saved_product", captured(product) && identityMatches(product) && product.source === "independent_product_get" && product.variants === 1 &&
    captured(upload) && product.fileId === upload.fileId && product.fileMd5 === artwork?.md5 &&
    product.fileType === (expected.placement === "front" ? "default" : "back") && inWindow(product.savedAt) &&
    Date.parse(String(product.savedAt)) >= Date.parse(String(upload.capturedAt)) &&
    Date.parse(String(product.capturedAt)) >= Date.parse(String(product.savedAt)) && product.captureId !== upload.captureId,
  "exact_native_saved_product_variant_and_file_required");
  const sameSavedIdentity = (v: Record<string, unknown>) => captured(product) && identityMatches(v) &&
    v.syncProductId === product.syncProductId && v.syncVariantId === product.syncVariantId;
  const observed = isRecord(design) ? geometry(design.layout) : null;
  check("reopened_numeric_layout", captured(design) && sameSavedIdentity(design) && design.source === "reopened_saved_variant" &&
    captured(product) && captured(upload) && design.captureId !== product.captureId && design.captureId !== upload.captureId && design.fileId === upload.fileId &&
    inWindow(design.leftDesignerAt) && Date.parse(String(design.leftDesignerAt)) > Date.parse(String(product.capturedAt)) &&
    Date.parse(String(design.capturedAt)) > Date.parse(String(design.leftDesignerAt)) && design.numericSource === "visible_numeric_controls" &&
    design.coordinateOrigin === "print_area_top_left" && design.boundsMeaning === "artwork" && design.layerCount === 1 &&
    design.rotationDegrees === "0" && design.technique === "dtg" && design.placement === expected.placement &&
    design.roundingObserved === false && design.croppingObserved === false && design.resamplingObserved === false &&
    !!observed && Object.keys(g).every(key => g[key as keyof typeof g] === observed[key as keyof typeof g]),
  "saved_variant_numeric_units_origin_bounds_technique_and_reopen_required");
  if (isRecord(mockup)) { try { image = await inspect(input.mockupBytes, mockup.mediaType, DESIGNER_PROBE_LIMITS.maximumMockupBytes); } catch { /* Closed diagnostic below. */ } }
  check("saved_product_mockup", captured(mockup) && sameSavedIdentity(mockup) && mockup.source === "saved_product_download" && captured(design) &&
    mockup.designCaptureId === design.captureId && mockup.captureId !== design.captureId &&
    Date.parse(String(mockup.capturedAt)) >= Date.parse(String(design.capturedAt)) && !!image && mockup.sha256 === image.sha256 && image.sha256 !== expected.artworkSha256,
  "downloaded_saved_product_mockup_bytes_and_provenance_required");
  const review = isRecord(mockup) ? mockup.review : null;
  check("independent_mockup_review", isRecord(review) && typeof review.captureId === "string" && PRODUCT_UUID.test(review.captureId) &&
    captured(mockup) && review.captureId !== mockup.captureId && captured(design) && review.captureId !== design.captureId &&
    inWindow(review.reviewedAt) && Date.parse(String(review.reviewedAt)) >= Date.parse(String(mockup.capturedAt)) &&
    !!image && review.imageSha256 === image.sha256 && review.outcome === "PASS" && review.finishedProductShown === true && review.productMatches === true &&
    typeof review.observedProduct === "string" && review.observedProduct.trim().length >= 40 && review.observedProduct.length <= 2000,
  "independent_finished_product_pixel_review_required");
  return { ...report(), candidateFingerprint: productHash({ expectation: expected, candidate }),
  artworkSha256: artwork?.sha256 ?? null, mockupSha256: image?.sha256 ?? null };
}
