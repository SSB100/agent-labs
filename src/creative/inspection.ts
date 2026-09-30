import { createHash } from "node:crypto";
import sharp from "sharp";
import type { AssetInspection, PrintSpecification } from "./types";
import { validatePrintSpecification } from "./contracts";

/** Inspect original bytes without silently upscaling or editing a failed asset. */
export async function inspectCreativePng(bytes: Uint8Array, spec: PrintSpecification): Promise<AssetInspection> {
  validatePrintSpecification(spec);
  if (bytes.byteLength > spec.maximumBytes || bytes.byteLength < 33 || Buffer.from(bytes.subarray(0, 8)).toString("hex") !== "89504e470d0a1a0a") throw new Error("Asset is not a bounded PNG file.");
  const decoded = sharp(bytes, { failOn: "warning", limitInputPixels: 16_777_216, pages: 1 });
  const metadata = await decoded.metadata();
  if (metadata.format !== "png" || !metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1 || metadata.width > 4096 || metadata.height > 4096) throw new Error("Unsupported image dimensions, animation, or format.");
  const pixels = await decoded.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let transparent = 0, visible = 0;
  for (let i = 3; i < pixels.data.length; i += pixels.info.channels) {
    if (pixels.data[i] === 0) transparent++;
    if (pixels.data[i] >= 250) visible++;
  }
  const count = pixels.info.width * pixels.info.height;
  const effectiveDpi = Math.min(metadata.width / spec.designWidthInches, metadata.height / spec.designHeightInches);
  const failedCriteria: string[] = [];
  if (effectiveDpi < spec.minimumDpi) failedCriteria.push("effective_dpi_below_print_specification");
  if (metadata.space !== "srgb") failedCriteria.push("unsupported_color_space");
  if (visible / count < 0.01) failedCriteria.push("no_substantial_visible_artwork");
  if (spec.background === "transparent" && (!metadata.hasAlpha || transparent / count < 0.01)) failedCriteria.push("transparent_background_missing");
  if (Math.abs(metadata.width / metadata.height - spec.designWidthInches / spec.designHeightInches) > 0.01) failedCriteria.push("aspect_ratio_mismatch");
  return { sha256: createHash("sha256").update(bytes).digest("hex"), mediaType: "image/png", bytes: bytes.byteLength,
    width: metadata.width, height: metadata.height, colorSpace: metadata.space ?? "unknown", hasAlpha: metadata.hasAlpha ?? false,
    transparentPixelFraction: transparent / count, effectiveDpi, failedCriteria };
}
