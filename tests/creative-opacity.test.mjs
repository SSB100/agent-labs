import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import inspection from '../.core-tests/creative/inspection.js';
const { inspectCreativePng } = inspection;
const spec = { provider: 'printful', product: 'Synthetic opacity test', garment: 'Cotton T-shirt', placement: 'large_front',
  sourceUrl: 'https://www.printful.com/creating-dtg-file', sourceExcerpt: 'Synthetic print requirement fixture for deterministic alpha tests only.',
  verifiedAt: new Date().toISOString(), maximumWidthInches: 15, maximumHeightInches: 18, designWidthInches: 1, designHeightInches: 1,
  minimumDpi: 150, colorSpace: 'srgb', background: 'opaque', maximumBytes: 7_000_000 };
test('opaque approval rejects even nearly opaque partial alpha instead of treating it as print-ready', async () => {
  const pixels = Buffer.alloc(256 * 256 * 4, 255); pixels[3] = 254;
  const image = await sharp(pixels, { raw: { width: 256, height: 256, channels: 4 } }).png().toBuffer();
  const result = await inspectCreativePng(image, spec);
  assert.equal(result.transparentPixelFraction, 0);
  assert.ok(result.failedCriteria.includes('opaque_background_not_fully_opaque'));
});
test('fully opaque RGB and RGBA remain accepted without flattening or re-encoding', async () => {
  for (const channels of [3, 4]) {
    const image = await sharp({ create: { width: 256, height: 256, channels, background: { r: 245, g: 238, b: 218, alpha: 1 } } }).png().toBuffer();
    const result = await inspectCreativePng(image, spec);
    assert.equal(result.failedCriteria.length, 0);
    assert.equal(result.transparentPixelFraction, 0);
  }
});
