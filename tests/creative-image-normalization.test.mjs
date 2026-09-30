import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import sharp from "sharp";
import normalization from "../.core-tests/creative/image-normalization.js";

const { normalizeProviderImage, ImageNormalizationError, IMAGE_NORMALIZATION_POLICY: policy } = normalization;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const isError = category => error => error instanceof ImageNormalizationError && error.category === category && error.retryable === false;
const source = () => sharp({ create: { width: 9, height: 7, channels: 4, background: { r: 17, g: 94, b: 233, alpha: 0.5 } } });
const webp = () => source().webp({ lossless: true, exact: true }).toBuffer();
const png = () => source().png().toBuffer();

function riffChunk(kind, payload) {
  const result = Buffer.alloc(8 + payload.length + payload.length % 2);
  result.write(kind, 0, 4, "latin1"); result.writeUInt32LE(payload.length, 4); payload.copy(result, 8);
  return result;
}
function riff(...chunks) {
  const result = Buffer.concat([Buffer.from("RIFF0000WEBP"), ...chunks]);
  result.writeUInt32LE(result.length - 8, 4);
  return result;
}
function vp8x(width, height, flags = 0x10) {
  const payload = Buffer.alloc(10); payload[0] = flags;
  payload.writeUIntLE(width - 1, 4, 3); payload.writeUIntLE(height - 1, 7, 3);
  return riffChunk("VP8X", payload);
}
function vp8lHeader(width, height, alpha = true, version = 0) {
  const result = Buffer.alloc(5); result[0] = 0x2f;
  result.writeUInt32LE(((width - 1) | ((height - 1) << 14) | (Number(alpha) << 28) | (version << 29)) >>> 0, 1);
  return riffChunk("VP8L", result);
}
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return (value ^ 0xffffffff) >>> 0;
}
function pngChunk(kind, payload = Buffer.alloc(0)) {
  const result = Buffer.alloc(12 + payload.length); result.writeUInt32BE(payload.length, 0);
  result.write(kind, 4, 4, "latin1"); payload.copy(result, 8);
  result.writeUInt32BE(crc32(result.subarray(4, -4)), result.length - 4);
  return result;
}
function pngChunks(bytes) {
  const chunks = []; let offset = 8;
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    chunks.push({ kind: bytes.toString("latin1", offset + 4, offset + 8), payload: bytes.subarray(offset + 8, offset + 8 + length) });
    offset += 12 + length;
  }
  return chunks;
}
function rebuildPng(chunks) { return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), ...chunks.map(({ kind, payload }) => pngChunk(kind, payload))]); }

test("PNG is fully decoded but retained byte-for-byte with independently detected MIME and traceable provenance", async () => {
  const original = await png();
  for (const mime of ["image/png", undefined, null]) {
    const result = await normalizeProviderImage(original, mime);
    assert.equal(result.mediaType, "image/png");
    assert.deepEqual(result.bytes, original); assert.deepEqual(result.originalBytes, original);
    assert.notEqual(result.originalBytes, original);
    assert.deepEqual(result.provenance, {
      version: policy.version, providerMediaType: mime ?? null, detectedMediaType: "image/png",
      originalSha256: hash(original), normalizedSha256: hash(original), originalBytes: original.length, normalizedBytes: original.length,
      width: 9, height: 7, conversion: "none", verification: "byte_identity", decodedPixelSha256: null, normalizedDecodedPixelSha256: null,
      decodedChannels: null, decodedHasAlpha: null, encoder: null,
      decoder: `sharp@${sharp.versions.sharp};libvips@${sharp.versions.vips};webp@${sharp.versions.webp}`,
    });
  }
});

test("static lossless RGB and RGBA WebP converts without edits, preserving partial alpha and hidden transparent RGB", async () => {
  for (const channels of [3, 4]) {
    const width = 13, height = 11, raw = Buffer.alloc(width * height * channels);
    for (let i = 0; i < width * height; i++) {
      raw[i * channels] = (i * 47 + 11) % 256;
      raw[i * channels + 1] = (i * 71 + 97) % 256;
      raw[i * channels + 2] = (i * 103 + 199) % 256;
      if (channels === 4) raw[i * channels + 3] = [0, 1, 64, 127, 254, 255][i % 6];
    }
    const original = await sharp(raw, { raw: { width, height, channels } }).webp({ lossless: true, exact: true }).toBuffer();
    for (const mime of ["image/webp", undefined]) {
      const result = await normalizeProviderImage(original, mime);
      const decoded = await sharp(result.bytes, { failOn: "warning" }).raw().toBuffer({ resolveWithObject: true });
      assert.deepEqual(decoded.data, raw);
      assert.equal(decoded.info.channels, channels);
      assert.equal(decoded.info.width, width); assert.equal(decoded.info.height, height);
      assert.deepEqual(result.originalBytes, original); assert.notDeepEqual(result.bytes, original);
      assert.equal(result.provenance.providerMediaType, mime ?? null);
      assert.equal(result.provenance.detectedMediaType, "image/webp");
      assert.equal(result.provenance.originalSha256, hash(original));
      assert.equal(result.provenance.normalizedSha256, hash(result.bytes));
      assert.equal(result.provenance.decodedPixelSha256, hash(raw));
      assert.equal(result.provenance.normalizedDecodedPixelSha256, hash(raw));
      assert.equal(result.provenance.decodedChannels, channels);
      assert.equal(result.provenance.decodedHasAlpha, channels === 4);
      assert.match(result.provenance.encoder, /png@/);
      assert.equal(result.provenance.conversion, "lossless_webp_to_png");
      assert.equal(result.provenance.verification, "decoded_pixels_equal");
      assert.equal(result.provenance.normalizedBytes, result.bytes.length);
    }
  }
});

test("the supported VP8X alpha-only envelope preserves the same lossless pixels", async () => {
  const original = await webp(), extended = riff(vp8x(9, 7), original.subarray(12));
  const result = await normalizeProviderImage(extended, "image/webp");
  assert.deepEqual(await sharp(result.bytes).raw().toBuffer(), await sharp(original).raw().toBuffer());
});

test("caller mutation across awaits cannot replace the owned original bytes or provenance", async () => {
  const original = await webp(), expected = Buffer.from(original);
  const pending = normalizeProviderImage(original, "image/webp"); original.fill(0);
  const result = await pending;
  assert.deepEqual(result.originalBytes, expected);
  assert.equal(result.provenance.originalSha256, hash(expected));
});

test("explicit MIME mismatches fail, while absent MIME is independently sniffed", async () => {
  await assert.rejects(normalizeProviderImage(await png(), "image/webp"), isError("media_type_mismatch"));
  await assert.rejects(normalizeProviderImage(await webp(), "image/png"), isError("media_type_mismatch"));
  for (const mime of ["", "image/jpeg", "IMAGE/PNG", "image/png; charset=binary", 4, {}]) {
    await assert.rejects(normalizeProviderImage(await png(), mime), isError("invalid_image_input"));
  }
  for (const bytes of [Buffer.from("GIF89a"), Buffer.from([255, 216, 255, 224]), Buffer.from("<svg>"), Buffer.from("not an image")]) {
    await assert.rejects(normalizeProviderImage(bytes), isError("unsupported_image_format"));
  }
  const forged = await webp(); forged[0] |= 128;
  await assert.rejects(normalizeProviderImage(forged), isError("unsupported_image_format"));
});

test("empty, invalid, and over-limit original inputs fail before image decoding", async () => {
  for (const invalid of [null, undefined, "not bytes", [], Buffer.alloc(0)]) {
    await assert.rejects(normalizeProviderImage(invalid), isError("invalid_image_input"));
  }
  await assert.rejects(normalizeProviderImage(Buffer.alloc(policy.maximumOriginalBytes + 1)), isError("image_too_large"));
});

test("lossy WebP and lossy alpha encodings are excluded rather than silently transcoded", async () => {
  for (const original of [await source().webp({ quality: 100 }).toBuffer(), riff(riffChunk("ALPH", Buffer.alloc(1)), vp8lHeader(9, 7))]) {
    await assert.rejects(normalizeProviderImage(original, "image/webp"), isError("unsupported_image_features"));
  }
});

test("animated WebP, all animation markers, and duplicate image frames fail closed", async () => {
  const raw = Buffer.alloc(9 * 14 * 3);
  for (let pixel = 0; pixel < 9 * 14; pixel++) raw[pixel * 3 + (pixel < 9 * 7 ? 0 : 2)] = 255;
  const animated = await sharp(raw, { raw: { width: 9, height: 14, pageHeight: 7, channels: 3 } })
    .webp({ lossless: true, loop: 0, delay: [10, 10] }).toBuffer();
  assert.equal((await sharp(animated).metadata()).pages, 2);
  await assert.rejects(normalizeProviderImage(animated), isError("unsupported_image_features"));
  const image = (await webp()).subarray(12);
  for (const chunk of [riffChunk("ANIM", Buffer.alloc(6)), riffChunk("ANMF", Buffer.alloc(16))]) {
    await assert.rejects(normalizeProviderImage(riff(image, chunk)), isError("unsupported_image_features"));
  }
  await assert.rejects(normalizeProviderImage(riff(image, image)), isError("invalid_image_container"));
});

test("WebP profiles, EXIF orientation, XMP, unknown chunks and feature flags are excluded before decode", async () => {
  const image = (await webp()).subarray(12);
  for (const kind of ["ICCP", "EXIF", "XMP ", "JUNK"]) {
    await assert.rejects(normalizeProviderImage(riff(image, riffChunk(kind, Buffer.from("private fixture metadata")))), isError("unsupported_image_features"));
  }
  for (const flag of [0x02, 0x04, 0x08, 0x20]) {
    await assert.rejects(normalizeProviderImage(riff(vp8x(9, 7, 0x10 | flag), image)), isError("unsupported_image_features"));
  }
  const profiled = await source().withIccProfile("srgb").webp({ lossless: true }).toBuffer();
  assert.ok((await sharp(profiled).metadata()).icc);
  await assert.rejects(normalizeProviderImage(profiled), isError("unsupported_image_features"));
});

test("RIFF lengths, truncated headers, padding, reserved bytes, canvas mismatch and trailing data are strict", async () => {
  const original = await webp(), image = original.subarray(12);
  const variants = [
    original.subarray(0, -1), Buffer.concat([original, Buffer.from([0, 0])]),
    riff(vp8x(8, 7), image), riff(vp8x(9, 7, 0), image), riff(vp8x(9, 7), vp8x(9, 7), image),
    riff(image, vp8x(9, 7)), riff(riffChunk("VP8X", Buffer.alloc(9)), image),
  ];
  const badSize = Buffer.from(original); badSize.writeUInt32LE(0xffffffff, 4); variants.push(badSize);
  const badChunk = Buffer.from(original); badChunk.writeUInt32LE(0xffffffff, 16); variants.push(badChunk);
  const badPad = riff(vp8lHeader(9, 7)); badPad[badPad.length - 1] = 1; variants.push(badPad);
  const reservedFlags = riff(vp8x(9, 7, 0x80), image); variants.push(reservedFlags);
  const reservedBytes = riff(vp8x(9, 7), image); reservedBytes[21] = 1; variants.push(reservedBytes);
  const missingFrame = riff(vp8x(9, 7)); variants.push(missingFrame);
  const truncatedHeader = riff(Buffer.alloc(6)); variants.push(truncatedHeader);
  for (const bytes of variants) await assert.rejects(normalizeProviderImage(bytes), isError("invalid_image_container"));
});

test("WebP bitstream signature and version are checked independently of the decoder", async () => {
  const signature = await webp(); signature[20] = 0;
  await assert.rejects(normalizeProviderImage(signature), isError("invalid_image_container"));
  await assert.rejects(normalizeProviderImage(riff(vp8lHeader(9, 7, true, 1))), isError("unsupported_image_features"));
});

test("syntactically valid but undecodable WebP fails full decoding with safe error diagnostics", async () => {
  await assert.rejects(normalizeProviderImage(riff(vp8lHeader(9, 7))), error => {
    assert.equal(isError("image_decode_failed")(error), true);
    assert.equal(error.cause, undefined);
    assert.equal(error.message, "The provider image could not be fully decoded within the normalization bounds.");
    return true;
  });
});

test("independent PNG and WebP header checks prevent dimension and decompression bombs", async () => {
  for (const [width, height] of [[4097, 1], [1, 4097], [16384, 16384]]) {
    await assert.rejects(normalizeProviderImage(riff(vp8lHeader(width, height))), isError("image_too_large"));
    await assert.rejects(normalizeProviderImage(riff(vp8x(width, height), vp8lHeader(9, 7))), isError("image_too_large"));
  }
  for (const [width, height] of [[4097, 1], [1, 4097], [0xffffffff, 0xffffffff]]) {
    const chunks = pngChunks(await png()); chunks[0].payload = Buffer.from(chunks[0].payload);
    chunks[0].payload.writeUInt32BE(width, 0); chunks[0].payload.writeUInt32BE(height, 4);
    await assert.rejects(normalizeProviderImage(rebuildPng(chunks)), isError("image_too_large"));
  }
  assert.equal(policy.maximumPixels, 4096 * 4096);
});

test("inclusive edge bounds accept 4096-pixel axes without resizing", async () => {
  for (const [width, height] of [[4096, 1], [1, 4096]]) {
    const original = await sharp({ create: { width, height, channels: 3, background: "red" } }).webp({ lossless: true }).toBuffer();
    const result = await normalizeProviderImage(original);
    assert.equal(result.provenance.width, width); assert.equal(result.provenance.height, height);
  }
});

test("PNG CRC, truncation, duplicate headers, missing image data, oversized chunks and trailing bytes are rejected", async () => {
  const original = await png(), chunks = pngChunks(original);
  const corrupted = Buffer.from(original); corrupted[29] ^= 1;
  const oversizedChunk = Buffer.from(original); oversizedChunk.writeUInt32BE(0xffffffff, 8);
  const variants = [corrupted, oversizedChunk, original.subarray(0, -1), Buffer.concat([original, Buffer.from([0])]),
    rebuildPng([chunks[0], ...chunks]), rebuildPng(chunks.filter(chunk => chunk.kind !== "IDAT")),
    rebuildPng(chunks.filter(chunk => chunk.kind !== "IEND"))];
  for (const bytes of variants) await assert.rejects(normalizeProviderImage(bytes), isError("invalid_image_container"));
});

test("APNG markers and potentially unbounded compressed PNG metadata fail before decoding", async () => {
  const chunks = pngChunks(await png());
  for (const kind of ["acTL", "fcTL", "fdAT", "iCCP", "zTXt", "iTXt", "eXIf", "cICP", "sBIT", "bKGD", "tIME", "zzZZ"]) {
    const altered = rebuildPng([chunks[0], { kind, payload: Buffer.from("private fixture metadata") }, ...chunks.slice(1)]);
    await assert.rejects(normalizeProviderImage(altered), isError("unsupported_image_features"));
  }
});

test("valid PNG framing and CRC cannot hide malformed compressed image data", async () => {
  const chunks = pngChunks(await png());
  for (const chunk of chunks) if (chunk.kind === "IDAT") chunk.payload = Buffer.from("private invalid compressed fixture");
  await assert.rejects(normalizeProviderImage(rebuildPng(chunks)), isError("image_decode_failed"));
});

test("PNG chunk count is bounded even when every chunk is tiny and has a valid CRC", async () => {
  const chunks = pngChunks(await png());
  const extra = Array.from({ length: policy.maximumChunks }, () => ({ kind: "IDAT", payload: Buffer.alloc(0) }));
  await assert.rejects(normalizeProviderImage(rebuildPng([...chunks.slice(0, -1), ...extra, chunks.at(-1)])), isError("unsupported_image_features"));
});

function uint32s(...values) {
  const result = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => result.writeUInt32BE(value, index * 4));
  return result;
}
const canonicalColorChunks = [
  { kind: "gAMA", payload: uint32s(45455) },
  { kind: "cHRM", payload: uint32s(31270, 32900, 64000, 33000, 30000, 60000, 15000, 6000) },
];

test("well-formed sRGB PNG metadata remains byte-identical, including all valid rendering intents", async () => {
  const chunks = pngChunks(await png());
  for (const intent of [0, 1, 2, 3]) {
    const original = rebuildPng([chunks[0], { kind: "sRGB", payload: Buffer.from([intent]) }, ...canonicalColorChunks, ...chunks.slice(1)]);
    const result = await normalizeProviderImage(original, "image/png");
    assert.deepEqual(result.bytes, original);
    assert.equal(result.provenance.originalSha256, hash(original));
    assert.equal(result.provenance.normalizedSha256, hash(original));
  }
});

test("PNG ancillary metadata cardinality, exact lengths, rendering intents and physical units are independently validated", async () => {
  const chunks = pngChunks(await png()), physical = chunks.find(chunk => chunk.kind === "pHYs");
  const noPhysical = chunks.filter(chunk => chunk.kind !== "pHYs");
  for (const chunk of [{ kind: "sRGB", payload: Buffer.from([0]) }, ...canonicalColorChunks, physical]) {
    await assert.rejects(normalizeProviderImage(rebuildPng([noPhysical[0], chunk, chunk, ...noPhysical.slice(1)])), isError("invalid_image_container"));
  }
  for (const chunk of [
    { kind: "sRGB", payload: Buffer.alloc(0) }, { kind: "sRGB", payload: Buffer.from([255]) },
    { kind: "sRGB", payload: Buffer.from([0, 0]) }, { kind: "gAMA", payload: Buffer.alloc(1) },
    { kind: "cHRM", payload: Buffer.alloc(31) }, { kind: "pHYs", payload: Buffer.from([1]) },
    { kind: "pHYs", payload: Buffer.concat([uint32s(1000, 1000), Buffer.from([2])]) },
    { kind: "pHYs", payload: Buffer.concat([uint32s(0, 1000), Buffer.from([1])]) },
  ]) {
    await assert.rejects(normalizeProviderImage(rebuildPng([noPhysical[0], chunk, ...noPhysical.slice(1)])), isError("invalid_image_container"));
  }
});

test("conflicting or non-sRGB gamma and chromaticities are rejected even when the PNG decoder tolerates them", async () => {
  const chunks = pngChunks(await png());
  for (const chunk of [
    { kind: "gAMA", payload: uint32s(100000) },
    { kind: "cHRM", payload: uint32s(31270, 32900, 64001, 33000, 30000, 60000, 15000, 6000) },
  ]) {
    for (const explicitSrgb of [[], [{ kind: "sRGB", payload: Buffer.from([0]) }]]) {
      const original = rebuildPng([chunks[0], ...explicitSrgb, chunk, ...chunks.slice(1)]);
      await assert.rejects(normalizeProviderImage(original), isError("unsupported_image_features"));
    }
  }
});

test("PNG metadata ordering and palette alpha constraints are enforced without flattening valid palette PNG", async () => {
  const original = await source().png({ palette: true }).toBuffer(), chunks = pngChunks(original);
  assert.ok(chunks.some(chunk => chunk.kind === "PLTE")); assert.ok(chunks.some(chunk => chunk.kind === "tRNS"));
  assert.deepEqual((await normalizeProviderImage(original)).bytes, original);
  const paletteIndex = chunks.findIndex(chunk => chunk.kind === "PLTE");
  const alpha = chunks.find(chunk => chunk.kind === "tRNS");
  const noAlpha = chunks.filter(chunk => chunk.kind !== "tRNS");
  const malformed = [
    rebuildPng([chunks[0], alpha, ...noAlpha.slice(1)]),
    rebuildPng([...chunks.slice(0, paletteIndex + 1), { kind: "sRGB", payload: Buffer.from([0]) }, ...chunks.slice(paletteIndex + 1)]),
    rebuildPng([...chunks.slice(0, -1), { kind: "pHYs", payload: Buffer.concat([uint32s(1000, 1000), Buffer.from([1])]) }, chunks.at(-1)]),
    rebuildPng(chunks.flatMap(chunk => chunk.kind === "tRNS" ? [chunk, chunk] : [chunk])),
    rebuildPng(chunks.map(chunk => chunk.kind === "tRNS" ? { ...chunk, payload: Buffer.alloc(257) } : chunk)),
    rebuildPng(chunks.filter(chunk => chunk.kind !== "PLTE")),
  ];
  for (const bytes of malformed) await assert.rejects(normalizeProviderImage(bytes), isError("invalid_image_container"));
});

test("PNG transparency lengths, sample ranges and alpha-bearing color types are strict", async () => {
  const rgb = await sharp({ create: { width: 9, height: 7, channels: 3, background: "blue" } }).png().toBuffer();
  const chunks = pngChunks(rgb), transparent = { kind: "tRNS", payload: Buffer.from([0, 0, 0, 0, 0, 255]) };
  const valid = rebuildPng([chunks[0], transparent, ...chunks.slice(1)]);
  assert.deepEqual((await normalizeProviderImage(valid)).bytes, valid);
  for (const payload of [Buffer.alloc(5), Buffer.from([1, 0, 0, 0, 0, 0])]) {
    await assert.rejects(normalizeProviderImage(rebuildPng([chunks[0], { kind: "tRNS", payload }, ...chunks.slice(1)])), isError("invalid_image_container"));
  }
  const rgba = pngChunks(await png());
  await assert.rejects(normalizeProviderImage(rebuildPng([rgba[0], transparent, ...rgba.slice(1)])), isError("invalid_image_container"));
});

test("PNG IHDR color, bit depth, compression, filter and interlace declarations are checked before decode", async () => {
  for (const [offset, value] of [[8, 3], [9, 1], [10, 1], [11, 1], [12, 2]]) {
    const chunks = pngChunks(await png()); chunks[0].payload = Buffer.from(chunks[0].payload); chunks[0].payload[offset] = value;
    await assert.rejects(normalizeProviderImage(rebuildPng(chunks)), isError("invalid_image_container"));
  }
});

test("a bounded lossless WebP whose lossless PNG exceeds 7 MB is rejected, without quantizing or resizing", async () => {
  const width = 3072, height = 3072, raw = Buffer.alloc(width * height * 3); let state = 0x31415926;
  for (let i = 0; i < raw.length; i += 3) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    const color = state & 31;
    raw[i] = (color * 101 + 29) & 255; raw[i + 1] = (color * 53 + 61) & 255; raw[i + 2] = (color * 211 + 173) & 255;
  }
  const original = await sharp(raw, { raw: { width, height, channels: 3 } }).webp({ lossless: true, effort: 0 }).toBuffer();
  assert.ok(original.length < policy.maximumOriginalBytes);
  await assert.rejects(normalizeProviderImage(original), isError("image_too_large"));
});
