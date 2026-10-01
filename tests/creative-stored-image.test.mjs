import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import stored from '../.core-tests/creative/stored-image.js';
const { storeCreativeImage } = stored;
const path = '00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002/version-1.png';
const sourcePath = path.replace('.png', '.original.webp');
const spec = { provider: 'printful', product: 'Synthetic test garment', garment: 'Cotton T-shirt', placement: 'large_front',
  sourceUrl: 'https://www.printful.com/creating-dtg-file', sourceExcerpt: 'Synthetic print fixture for byte-preservation tests; no actual production approval.',
  verifiedAt: new Date().toISOString(), maximumWidthInches: 15, maximumHeightInches: 18, designWidthInches: 1, designHeightInches: 1,
  minimumDpi: 150, colorSpace: 'srgb', background: 'opaque', maximumBytes: 7_000_000 };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(options = {}) {
  const objects = new Map(), calls = [], progress = [];
  return { objects, calls, progress, storage: {
    async upload(key, bytes, config) {
      calls.push(['upload', key, config]);
      assert.equal(config.upsert, false);
      if (options.failUpload === key || objects.has(key)) return { error: 'fixture-upload-failure' };
      objects.set(key, Buffer.from(bytes)); return { error: null };
    },
    async download(key) {
      calls.push(['download', key]);
      const bytes = objects.get(key);
      return { error: null, data: bytes ? new Blob([options.corruptDownload === key ? Buffer.alloc(bytes.length) : bytes]) : null };
    },
  } };
}
async function image(format) {
  const input = sharp({ create: { width: 256, height: 256, channels: 4, background: { r: 35, g: 74, b: 55, alpha: 1 } } });
  return format === 'png' ? input.png().toBuffer() : input.webp({ lossless: true }).toBuffer();
}
async function run(bytes, mediaType, f) {
  return storeCreativeImage({ bytes, mediaType, declaredMediaType: mediaType, storagePath: path, specification: spec,
    storage: f.storage, onSourceProgress: p => f.progress.push(p) });
}
test('native PNG is stored once and read-back verified without changing original bytes', async () => {
  const bytes = await image('png'), f = fixture(), result = await run(bytes, 'image/png', f);
  assert.deepEqual(f.calls.map(c => c.slice(0, 2)), [['upload', path], ['download', path]]);
  assert.deepEqual(f.objects.get(path), bytes);
  assert.equal(result.provenance.conversion, 'none');
  assert.equal(result.provenance.originalStoragePath, path);
  assert.equal(result.provenance.originalSha256, hash(bytes));
  assert.equal(result.provenance.normalizedSha256, result.inspection.sha256);
  assert.deepEqual(result.inspection.failedCriteria, []);
  assert.equal(f.progress.at(-1).downloadVerified, true);
});
test('lossless WebP original is preserved first and derived PNG is independently read-back verified', async () => {
  const bytes = await image('webp'), f = fixture(), result = await run(bytes, 'image/webp', f);
  assert.deepEqual(f.calls.map(c => c.slice(0, 2)), [['upload', sourcePath], ['download', sourcePath], ['upload', path], ['download', path]]);
  assert.deepEqual(f.objects.get(sourcePath), bytes);
  assert.equal(result.provenance.originalStoragePath, sourcePath);
  assert.equal(result.provenance.normalizedStoragePath, path);
  assert.equal(result.provenance.conversion, 'lossless_webp_to_png');
  assert.equal(result.provenance.originalSha256, hash(bytes));
  assert.equal(result.provenance.normalizedSha256, hash(f.objects.get(path)));
  assert.equal(result.provenance.verification, 'decoded_pixels_equal');
  assert.deepEqual(result.inspection.failedCriteria, []);
});
test('normalization failure retains unvalidated original without derived PNG or hidden regeneration', async () => {
  const invalid = Buffer.alloc(20); invalid.write('RIFF', 0); invalid.writeUInt32LE(12, 4); invalid.write('WEBP', 8);
  const f = fixture();
  await assert.rejects(run(invalid, 'image/webp', f), /malformed|unsupported/);
  assert.deepEqual(f.objects.get(sourcePath), invalid);
  assert.equal(f.objects.has(path), false);
  assert.equal(f.calls.filter(c => c[0] === 'upload').length, 1);
  assert.equal(f.progress.at(-1).downloadVerified, true);
});
test('derived upload failure leaves original preserved and reports no successful output', async () => {
  const f = fixture({ failUpload: path });
  await assert.rejects(run(await image('webp'), 'image/webp', f), /Derived PNG upload could not be confirmed/);
  assert.equal(f.objects.has(sourcePath), true); assert.equal(f.objects.has(path), false);
  assert.equal(f.calls.filter(c => c[0] === 'upload').length, 2);
});
test('source storage uncertainty or hash mismatch stops before normalization/output', async () => {
  for (const options of [{ failUpload: sourcePath }, { corruptDownload: sourcePath }]) {
    const f = fixture(options);
    await assert.rejects(run(await image('webp'), 'image/webp', f), /no regeneration is allowed/);
    assert.equal(f.objects.has(path), false);
    assert.equal(f.progress.at(-1).downloadVerified, false);
    assert.equal(f.calls.filter(c => c[0] === 'upload').length, 1);
  }
});
test('invalid path and oversized source are rejected before Storage', async () => {
  const f = fixture();
  await assert.rejects(storeCreativeImage({ bytes: await image('png'), mediaType: 'image/png', declaredMediaType: 'image/png',
    storagePath: path + '.extra', specification: spec, storage: f.storage, onSourceProgress() {} }), /storage path/);
  await assert.rejects(run(Buffer.alloc(7_000_001), 'image/png', f), /byte bounds/);
  assert.equal(f.calls.length, 0);
});


test('conflicting declared MIME preserves source but rejects before normalized output', async () => {
  const bytes = await image('webp'), f = fixture();
  await assert.rejects(storeCreativeImage({ bytes, mediaType: 'image/webp', declaredMediaType: 'image/png',
    storagePath: path, specification: spec, storage: f.storage, onSourceProgress: p => f.progress.push(p) }), /does not match/);
  assert.deepEqual(f.objects.get(sourcePath), bytes);
  assert.equal(f.objects.has(path), false);
  assert.equal(f.progress.at(-1).downloadVerified, true);
});


test('native-PNG approval preserves unexpected WebP but forbids conversion or approved output', async () => {
  const bytes = await image('webp'), f = fixture();
  await assert.rejects(storeCreativeImage({ bytes, mediaType: 'image/webp', declaredMediaType: 'image/webp', nativePngRequired: true,
    storagePath: path, specification: spec, storage: f.storage, onSourceProgress: p => f.progress.push(p) }), /requires native PNG output/);
  assert.deepEqual(f.objects.get(sourcePath), bytes);
  assert.equal(f.objects.has(path), false);
  assert.equal(f.progress.at(-1).downloadVerified, true);
});
