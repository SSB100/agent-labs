import { createHash } from "node:crypto";
import sharp from "sharp";
import { MAX_CREATIVE_PNG_BYTES } from "./types";

/** Narrow technical normalization only. Print-readiness still requires inspectCreativePng. */
export const IMAGE_NORMALIZATION_POLICY = {
  version: "creative-image-normalization-1.0",
  maximumOriginalBytes: 7_000_000,
  maximumPngBytes: MAX_CREATIVE_PNG_BYTES,
  maximumWidth: 4096,
  maximumHeight: 4096,
  maximumPixels: 16_777_216,
  maximumChunks: 4096,
  maximumProcessingSeconds: 10,
} as const;

export type ProviderImageMediaType = "image/png" | "image/webp";
export type ImageNormalizationErrorCategory =
  | "invalid_image_input" | "unsupported_image_format" | "media_type_mismatch"
  | "image_too_large" | "invalid_image_container" | "unsupported_image_features"
  | "image_decode_failed" | "pixel_preservation_failed" | "credential_preserving_export_required";

const safeMessages: Record<ImageNormalizationErrorCategory, string> = {
  invalid_image_input: "The provider image input or declared media type is invalid.",
  unsupported_image_format: "Only PNG and static lossless WebP provider images are supported.",
  media_type_mismatch: "The provider image media type does not match its binary signature.",
  image_too_large: "The provider image exceeds the permitted byte or pixel bounds.",
  invalid_image_container: "The provider image container is malformed or incomplete.",
  unsupported_image_features: "The provider image contains unsupported animation, encoding, or metadata.",
  image_decode_failed: "The provider image could not be fully decoded within the normalization bounds.",
  pixel_preservation_failed: "Lossless normalization could not verify unchanged decoded pixels and alpha.",
  credential_preserving_export_required: "The WebP contains opaque C2PA source provenance. A credential-preserving PNG export is required; no PNG was produced and credential authenticity is unverified.",
};

/** Never includes decoder diagnostics, provider payloads, or arbitrary metadata. */
export class ImageNormalizationError extends Error {
  readonly retryable = false;
  constructor(readonly category: ImageNormalizationErrorCategory) {
    super(safeMessages[category]);
    this.name = "ImageNormalizationError";
  }
}

export type ImageNormalizationProvenance = {
  version: typeof IMAGE_NORMALIZATION_POLICY.version;
  providerMediaType: ProviderImageMediaType | null;
  detectedMediaType: ProviderImageMediaType;
  originalSha256: string;
  normalizedSha256: string;
  originalBytes: number;
  normalizedBytes: number;
  width: number;
  height: number;
  conversion: "none" | "lossless_webp_to_png";
  verification: "byte_identity" | "decoded_pixels_equal";
  /** RGB/RGBA, unsigned 8-bit, unpremultiplied; populated only for WebP conversion. */
  decodedPixelSha256: string | null;
  normalizedDecodedPixelSha256: string | null;
  decodedChannels: number | null;
  decodedHasAlpha: boolean | null;
  decoder: string;
  encoder: string | null;
};

export type NormalizedProviderImage = {
  bytes: Uint8Array;
  mediaType: "image/png";
  originalBytes: Uint8Array;
  provenance: ImageNormalizationProvenance;
};

/** Read-only facts about a fully decoded source; no credential parsing or authenticity claim. */
export type ProviderSourceInspection = {
  providerMediaType: ProviderImageMediaType | null;
  mediaType: ProviderImageMediaType;
  format: "png" | "webp";
  originalSha256: string;
  originalBytes: number;
  width: number;
  height: number;
  frames: 1;
  isStatic: true;
  colorSpace: string;
  decodedPixelDepth: "uchar";
  decodedPixelSha256: string;
  decodedChannels: number;
  hasAlpha: boolean;
  hasC2pa: boolean;
  credentialAuthenticity: "unverified";
  credentialPreservingPngExportRequired: boolean;
  decoder: string;
};

type Dimensions = { width: number; height: number };
type ContainerInspection = Dimensions & { hasC2pa: boolean };
function reject(category: ImageNormalizationErrorCategory): never { throw new ImageNormalizationError(category); }
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function checkDimensions(width: number, height: number): Dimensions {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) reject("invalid_image_container");
  if (width > IMAGE_NORMALIZATION_POLICY.maximumWidth || height > IMAGE_NORMALIZATION_POLICY.maximumHeight ||
      width * height > IMAGE_NORMALIZATION_POLICY.maximumPixels) reject("image_too_large");
  return { width, height };
}

// PNG CRCs are checked independently: permissive metadata readers are not a file-integrity gate.
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function inspectPngContainer(bytes: Buffer): ContainerInspection {
  let offset = 8, chunks = 0, dimensions: Dimensions | undefined;
  let seenData = false, dataEnded = false, seenPalette = false, hasC2pa = false;
  let colorType = -1, bitDepth = 0, paletteEntries = 0;
  const seenAncillary = new Set<string>();
  const srgbChromaticities = [31270, 32900, 64000, 33000, 30000, 60000, 15000, 6000];
  while (offset < bytes.length) {
    if (++chunks > IMAGE_NORMALIZATION_POLICY.maximumChunks) reject("unsupported_image_features");
    if (bytes.length - offset < 12) reject("invalid_image_container");
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length, payload = offset + 8;
    if (end > bytes.length) reject("invalid_image_container");
    const kind = bytes.toString("latin1", offset + 4, offset + 8);
    if (!/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(kind) ||
        crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) reject("invalid_image_container");
    if (chunks === 1 && (kind !== "IHDR" || length !== 13)) reject("invalid_image_container");
    if (kind === "acTL" || kind === "fcTL" || kind === "fdAT") reject("unsupported_image_features");
    if (kind === "IHDR") {
      if (chunks !== 1 || length !== 13) reject("invalid_image_container");
      dimensions = checkDimensions(bytes.readUInt32BE(offset + 8), bytes.readUInt32BE(offset + 12));
      bitDepth = bytes[payload + 8]; colorType = bytes[payload + 9];
      const allowedDepths = colorType === 0 ? [1, 2, 4, 8, 16] : colorType === 3 ? [1, 2, 4, 8] :
        [2, 4, 6].includes(colorType) ? [8, 16] : [];
      if (!allowedDepths.includes(bitDepth) || bytes[payload + 10] !== 0 || bytes[payload + 11] !== 0 || bytes[payload + 12] > 1) reject("invalid_image_container");
    } else if (kind === "PLTE") {
      if (seenPalette || seenData || seenAncillary.has("tRNS") || !length || length % 3 || length > 768 ||
          colorType === 0 || colorType === 4 || (colorType === 3 && length / 3 > 2 ** bitDepth)) reject("invalid_image_container");
      seenPalette = true;
      paletteEntries = length / 3;
    } else if (kind === "IDAT") {
      if (dataEnded || (colorType === 3 && !seenPalette)) reject("invalid_image_container");
      seenData = true;
    } else if (kind === "IEND") {
      if (length !== 0 || !seenData || end !== bytes.length || !dimensions) reject("invalid_image_container");
      return { ...dimensions, hasC2pa };
    } else if (kind === "caBX") {
      // Preserve this opaque C2PA-bearing chunk in the original PNG. Do not parse,
      // reserialize, authenticate, or dereference anything inside its payload.
      if (hasC2pa || !length) reject("invalid_image_container");
      hasC2pa = true;
    } else if (["tRNS", "sRGB", "pHYs", "gAMA", "cHRM"].includes(kind)) {
      // Sharp can ignore duplicate, malformed, or conflicting ancillary chunks without
      // a warning. Validate this deliberately small metadata subset independently.
      if (seenData || seenAncillary.has(kind)) reject("invalid_image_container");
      if (["sRGB", "gAMA", "cHRM"].includes(kind) && seenPalette) reject("invalid_image_container");
      seenAncillary.add(kind);
      if (kind === "sRGB") {
        if (length !== 1 || bytes[payload] > 3) reject("invalid_image_container");
      } else if (kind === "gAMA") {
        if (length !== 4) reject("invalid_image_container");
        // Gamma declarations must agree with sRGB, whether or not sRGB is explicit.
        if (bytes.readUInt32BE(payload) !== 45455) reject("unsupported_image_features");
      } else if (kind === "cHRM") {
        if (length !== 32) reject("invalid_image_container");
        if (srgbChromaticities.some((value, index) => bytes.readUInt32BE(payload + index * 4) !== value)) reject("unsupported_image_features");
      } else if (kind === "pHYs") {
        if (length !== 9 || bytes[payload + 8] > 1 || bytes.readUInt32BE(payload) === 0 || bytes.readUInt32BE(payload + 4) === 0) reject("invalid_image_container");
      } else if (colorType === 0 || colorType === 2) {
        if (length !== (colorType === 0 ? 2 : 6)) reject("invalid_image_container");
        for (let sample = 0; sample < length; sample += 2) {
          if (bytes.readUInt16BE(payload + sample) > 2 ** bitDepth - 1) reject("invalid_image_container");
        }
      } else if (colorType === 3) {
        if (!seenPalette || !length || length > paletteEntries) reject("invalid_image_container");
      } else {
        reject("invalid_image_container");
      }
    } else {
      // Reject profiles, orientation, compressed text, and unknown chunks before libvips
      // reads metadata. Other optional metadata (sBIT/bKGD/tIME) is outside the contract.
      reject("unsupported_image_features");
    }
    if (seenData && kind !== "IDAT") dataEnded = true;
    offset = end;
  }
  return reject("invalid_image_container");
}

/** VP8L, optional alpha-only VP8X, and a singleton final opaque C2PA chunk. */
function inspectLosslessWebpContainer(bytes: Buffer): ContainerInspection {
  if (bytes.length < 20 || bytes.length % 2 || bytes.readUInt32LE(4) !== bytes.length - 8) reject("invalid_image_container");
  let offset = 12, chunks = 0, canvas: Dimensions | undefined, image: Dimensions | undefined;
  let extendedAlpha: boolean | undefined, imageAlpha = false, hasC2pa = false;
  while (offset < bytes.length) {
    if (++chunks > IMAGE_NORMALIZATION_POLICY.maximumChunks) reject("unsupported_image_features");
    if (bytes.length - offset < 8) reject("invalid_image_container");
    const kind = bytes.toString("latin1", offset, offset + 4), length = bytes.readUInt32LE(offset + 4);
    const payload = offset + 8, end = payload + length, next = end + (length & 1);
    if (next > bytes.length || (length % 2 && bytes[end] !== 0)) reject("invalid_image_container");
    if (kind === "VP8X") {
      if (chunks !== 1 || canvas || length !== 10) reject("invalid_image_container");
      const flags = bytes[payload];
      if ((flags & 0xc1) || bytes[payload + 1] || bytes[payload + 2] || bytes[payload + 3]) reject("invalid_image_container");
      // Animation, ICC, EXIF and XMP are deliberately outside this normalization contract.
      if (flags & ~0x10) reject("unsupported_image_features");
      extendedAlpha = Boolean(flags & 0x10);
      canvas = checkDimensions(bytes.readUIntLE(payload + 4, 3) + 1, bytes.readUIntLE(payload + 7, 3) + 1);
    } else if (kind === "VP8L") {
      if (image || length < 5 || bytes[payload] !== 0x2f) reject("invalid_image_container");
      const header = bytes.readUInt32LE(payload + 1);
      if (header >>> 29) reject("unsupported_image_features");
      image = checkDimensions((header & 0x3fff) + 1, ((header >>> 14) & 0x3fff) + 1);
      imageAlpha = Boolean(header & 0x10000000);
    } else if (kind === "C2PA") {
      // Recognition only: C2PA must be the final RIFF chunk and is retained verbatim.
      // Its asset binding cannot safely be copied to a newly encoded PNG.
      if (hasC2pa || !image || !length || next !== bytes.length) reject("invalid_image_container");
      hasC2pa = true;
    } else {
      // Reject VP8/ALPH (lossy), ANIM/ANMF (animation), profiles, and unknown chunks.
      reject("unsupported_image_features");
    }
    offset = next;
  }
  if (!image || (canvas && (canvas.width !== image.width || canvas.height !== image.height || extendedAlpha !== imageAlpha))) {
    reject("invalid_image_container");
  }
  return { ...image, hasC2pa };
}

function decoder(bytes: Buffer) {
  return sharp(bytes, {
    failOn: "warning", limitInputPixels: IMAGE_NORMALIZATION_POLICY.maximumPixels,
    limitInputChannels: 4, pages: 1, autoOrient: false, sequentialRead: true, unlimited: false,
  }).timeout({ seconds: IMAGE_NORMALIZATION_POLICY.maximumProcessingSeconds });
}

async function encodeBoundedPng(pixels: Buffer, width: number, height: number, channels: 3 | 4): Promise<Buffer> {
  const encoder = sharp(pixels, { raw: { width, height, channels }, limitInputPixels: IMAGE_NORMALIZATION_POLICY.maximumPixels })
    .png({ palette: false, compressionLevel: 9, adaptiveFiltering: false })
    .timeout({ seconds: IMAGE_NORMALIZATION_POLICY.maximumProcessingSeconds });
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of encoder) {
      const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += part.length;
      if (size > IMAGE_NORMALIZATION_POLICY.maximumPngBytes) reject("image_too_large");
      chunks.push(part);
    }
    return Buffer.concat(chunks, size);
  } finally {
    encoder.destroy();
  }
}

/** Common bounded source validation, with an owned byte snapshot taken before awaiting. */
async function inspectSourceBytes(bytes: Uint8Array, declaredMediaType?: string | null) {
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength) reject("invalid_image_input");
  if (bytes.byteLength > IMAGE_NORMALIZATION_POLICY.maximumOriginalBytes) reject("image_too_large");
  if (declaredMediaType !== undefined && declaredMediaType !== null &&
      declaredMediaType !== "image/png" && declaredMediaType !== "image/webp") reject("invalid_image_input");
  const providerMediaType: ProviderImageMediaType | null = declaredMediaType ?? null;
  const originalBytes = Buffer.from(bytes);
  const detectedMediaType: ProviderImageMediaType = originalBytes.subarray(0, 8).equals(pngSignature) ? "image/png" :
    originalBytes.length >= 12 && originalBytes.toString("latin1", 0, 4) === "RIFF" && originalBytes.toString("latin1", 8, 12) === "WEBP" ? "image/webp" :
      reject("unsupported_image_format");
  if (declaredMediaType && declaredMediaType !== detectedMediaType) reject("media_type_mismatch");
  const container = detectedMediaType === "image/png" ? inspectPngContainer(originalBytes) : inspectLosslessWebpContainer(originalBytes);
  try {
    const decoded = decoder(originalBytes);
    const metadata = await decoded.metadata();
    if (metadata.format !== detectedMediaType.slice(6) || metadata.width !== container.width || metadata.height !== container.height ||
        (metadata.pages ?? 1) !== 1 || (metadata.pageHeight !== undefined && metadata.pageHeight !== container.height)) reject("invalid_image_container");
    if (detectedMediaType === "image/webp" && (metadata.space !== "srgb" || metadata.depth !== "uchar" ||
        (metadata.channels !== 3 && metadata.channels !== 4) || metadata.icc || metadata.exif || metadata.xmp || metadata.orientation !== undefined)) {
      reject("unsupported_image_features");
    }
    // Full decode is mandatory even for the unchanged PNG path; metadata alone is not validation.
    const pixels = await decoded.raw({ depth: "uchar" }).toBuffer({ resolveWithObject: true });
    if (pixels.info.width !== container.width || pixels.info.height !== container.height || pixels.info.channels < 1 || pixels.info.channels > 4 ||
        pixels.data.length !== container.width * container.height * pixels.info.channels) reject("image_decode_failed");
    if (detectedMediaType === "image/webp" && ((pixels.info.channels !== 3 && pixels.info.channels !== 4) ||
        pixels.info.premultiplied || pixels.info.channels !== metadata.channels)) reject("pixel_preservation_failed");
    return { originalBytes, detectedMediaType, providerMediaType, container, metadata, pixels };
  } catch (error) {
    if (error instanceof ImageNormalizationError) throw error;
    throw new ImageNormalizationError("image_decode_failed");
  }
}

/**
 * Read-only, offline inspection. Opaque C2PA bytes are recognized but never interpreted,
 * verified, modified, or used to make network requests. No derived image is produced.
 * The decoded-pixel hash explicitly describes Sharp's uint8 output, not credential validity.
 */
export async function inspectProviderSource(bytes: Uint8Array, declaredMediaType?: string | null): Promise<ProviderSourceInspection> {
  const { originalBytes, detectedMediaType, providerMediaType, container, metadata, pixels } = await inspectSourceBytes(bytes, declaredMediaType);
  return {
    providerMediaType, mediaType: detectedMediaType, format: detectedMediaType === "image/png" ? "png" : "webp",
    originalSha256: sha256(originalBytes), originalBytes: originalBytes.length,
    width: container.width, height: container.height, frames: 1, isStatic: true,
    colorSpace: metadata.space ?? "unknown", decodedPixelDepth: "uchar", decodedPixelSha256: sha256(pixels.data),
    decodedChannels: pixels.info.channels, hasAlpha: metadata.hasAlpha ?? false, hasC2pa: container.hasC2pa,
    credentialAuthenticity: "unverified", credentialPreservingPngExportRequired: detectedMediaType === "image/webp" && container.hasC2pa,
    decoder: `sharp@${sharp.versions.sharp};libvips@${sharp.versions.vips};webp@${sharp.versions.webp}`,
  };
}

/**
 * Receives already canonically base64-decoded bytes. Takes an owned snapshot before awaiting.
 * Never resizes, rotates, upscales, quantizes, flattens alpha, or edits image content.
 * Accepted PNG remains byte-identical, including opaque C2PA caBX bytes. WebP carrying
 * C2PA is blocked: encoding or copying its asset-bound credential into PNG is not preservation.
 */
export async function normalizeProviderImage(bytes: Uint8Array, declaredMediaType?: string | null): Promise<NormalizedProviderImage> {
  const { originalBytes, detectedMediaType, providerMediaType, container, metadata, pixels } = await inspectSourceBytes(bytes, declaredMediaType);
  if (detectedMediaType === "image/webp" && container.hasC2pa) reject("credential_preserving_export_required");
  const dimensions = { width: container.width, height: container.height };
  try {
    let normalizedBytes: Buffer = originalBytes;
    let normalizedDecodedPixelSha256: string | null = null;
    if (detectedMediaType === "image/webp") {
      if ((pixels.info.channels !== 3 && pixels.info.channels !== 4) || pixels.info.premultiplied || pixels.info.channels !== metadata.channels) reject("pixel_preservation_failed");
      normalizedBytes = await encodeBoundedPng(pixels.data, dimensions.width, dimensions.height, pixels.info.channels);
      const result = await decoder(normalizedBytes).raw().toBuffer({ resolveWithObject: true });
      if (result.info.width !== pixels.info.width || result.info.height !== pixels.info.height || result.info.channels !== pixels.info.channels ||
          result.info.premultiplied || !result.data.equals(pixels.data)) reject("pixel_preservation_failed");
      normalizedDecodedPixelSha256 = sha256(result.data);
    }
    return {
      bytes: normalizedBytes, mediaType: "image/png", originalBytes,
      provenance: {
        version: IMAGE_NORMALIZATION_POLICY.version, providerMediaType, detectedMediaType,
        originalSha256: sha256(originalBytes), normalizedSha256: sha256(normalizedBytes),
        originalBytes: originalBytes.length, normalizedBytes: normalizedBytes.length, ...dimensions,
        conversion: detectedMediaType === "image/png" ? "none" : "lossless_webp_to_png",
        verification: detectedMediaType === "image/png" ? "byte_identity" : "decoded_pixels_equal",
        decodedPixelSha256: detectedMediaType === "image/webp" ? sha256(pixels.data) : null,
        normalizedDecodedPixelSha256,
        decodedChannels: detectedMediaType === "image/webp" ? pixels.info.channels : null,
        decodedHasAlpha: detectedMediaType === "image/webp" ? metadata.hasAlpha ?? false : null,
        decoder: `sharp@${sharp.versions.sharp};libvips@${sharp.versions.vips};webp@${sharp.versions.webp}`,
        encoder: detectedMediaType === "image/webp" ? `sharp@${sharp.versions.sharp};libvips@${sharp.versions.vips};png@${sharp.versions.png}` : null,
      },
    };
  } catch (error) {
    if (error instanceof ImageNormalizationError) throw error;
    // libvips errors can contain metadata. Deliberately discard their message/cause.
    throw new ImageNormalizationError("image_decode_failed");
  }
}
