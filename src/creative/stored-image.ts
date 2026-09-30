import { createHash } from "node:crypto";
import { normalizeProviderImage, type ImageNormalizationProvenance, type ProviderImageMediaType } from "./image-normalization";
import { inspectCreativePng } from "./inspection";
import type { AssetInspection, PrintSpecification } from "./types";

export type StoredImageProvenance = ImageNormalizationProvenance & { originalStoragePath: string; normalizedStoragePath: string };
export type SourcePreservation = { storagePath: string; mediaType: ProviderImageMediaType; bytes: number; sha256: string; uploadConfirmed: boolean; downloadVerified: boolean };
export type CreativeImageStorage = {
  upload(path: string, bytes: Uint8Array, options: { contentType: string; upsert: false; cacheControl: string }): Promise<{ error: unknown }>;
  download(path: string): Promise<{ data: Blob | null; error: unknown }>;
};
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const uuidPart = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
const pathPattern = new RegExp(`^${uuidPart}/${uuidPart}/version-[12]\\.png$`);

/** Retain paid source bytes before decoding; each upload is immutable and verified by download. */
export async function storeCreativeImage(input: {
  bytes: Uint8Array; mediaType: ProviderImageMediaType; declaredMediaType: string | null;
  storagePath: string; specification: PrintSpecification; storage: CreativeImageStorage;
  onSourceProgress: (progress: SourcePreservation) => void;
}): Promise<{ inspection: AssetInspection; provenance: StoredImageProvenance }> {
  if (!pathPattern.test(input.storagePath)) throw new Error("Invalid bounded creative storage path.");
  const source = Buffer.from(input.bytes);
  if (source.length < 12 || source.length > 7_000_000) throw new Error("Creative source exceeds the storage byte bounds.");
  const originalStoragePath = input.mediaType === "image/webp" ? input.storagePath.replace(/\.png$/, ".original.webp") : input.storagePath;
  const progress: SourcePreservation = { storagePath: originalStoragePath, mediaType: input.mediaType, bytes: source.length,
    sha256: hash(source), uploadConfirmed: false, downloadVerified: false };
  const report = () => input.onSourceProgress({ ...progress });
  report();
  const upload = await input.storage.upload(originalStoragePath, source, { contentType: input.mediaType, upsert: false, cacheControl: "0" });
  if (upload.error) throw new Error("Original provider image upload could not be confirmed; no regeneration is allowed.");
  progress.uploadConfirmed = true; report();
  await verifyStoredBytes(input.storage, originalStoragePath, source);
  progress.downloadVerified = true; report();
  const normalized = await normalizeProviderImage(source, input.declaredMediaType);
  if (normalized.provenance.detectedMediaType !== input.mediaType || normalized.provenance.originalSha256 !== progress.sha256) throw new Error("Original provider source metadata changed during normalization.");
  if (input.mediaType === "image/webp") {
    const derived = await input.storage.upload(input.storagePath, normalized.bytes, { contentType: "image/png", upsert: false, cacheControl: "0" });
    if (derived.error) throw new Error("Derived PNG upload could not be confirmed; the original remains retained and no regeneration is allowed.");
    await verifyStoredBytes(input.storage, input.storagePath, normalized.bytes);
  }
  const inspection = await inspectCreativePng(normalized.bytes, input.specification);
  if (inspection.sha256 !== normalized.provenance.normalizedSha256) throw new Error("Normalized image hash does not match its inspection.");
  return { inspection, provenance: { ...normalized.provenance, originalStoragePath, normalizedStoragePath: input.storagePath } };
}

async function verifyStoredBytes(storage: CreativeImageStorage, path: string, expected: Uint8Array): Promise<void> {
  const stored = await storage.download(path);
  if (stored.error || !stored.data || stored.data.size !== expected.byteLength) throw new Error("Stored image read-back could not confirm the exact byte count; no regeneration is allowed.");
  const bytes = new Uint8Array(await stored.data.arrayBuffer());
  if (hash(bytes) !== hash(expected)) throw new Error("Stored image read-back does not match its original SHA-256; no regeneration is allowed.");
}
