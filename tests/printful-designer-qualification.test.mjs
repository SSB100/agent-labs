import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const {
  checkDesignerProbe, DESIGNER_PROBE_VERSION, DESIGNER_PROBE_LIMITS,
} = require('../.core-tests/printful/designer-qualification.js');
const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const hash = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex');
const at = seconds => new Date(Date.parse('2026-10-02T12:00:00.000Z') + seconds * 1000).toISOString();
const authorityFlags = [
  'liveQualified', 'capturesAuthenticated', 'configurationVerified', 'physicalPrintVerified',
  'sourceIssuanceAllowed', 'listingReady', 'executionAuthorized',
];

// Every asset is produced locally from deterministic synthetic pixels. No provider,
// browser, credential, database, network request, or software installation is needed.
const artworkBytes = await sharp({
  create: { width: 120, height: 80, channels: 4, background: '#19445eff' },
}).png().toBuffer();
const changedArtworkBytes = await sharp({
  create: { width: 120, height: 80, channels: 4, background: '#9d442fff' },
}).png().toBuffer();
const mockupBytes = await sharp(Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="160">' +
  '<rect width="128" height="160" fill="#d5d5d5"/>' +
  '<path d="M42 18L20 26L5 58L25 68L32 55L32 143L96 143L96 55L103 68L123 58L108 26L86 18Q64 43 42 18Z" fill="white" stroke="#777"/>' +
  '<rect x="44" y="58" width="40" height="27" fill="#19445e"/>' +
  '</svg>',
)).png().toBuffer();

function fixture(mode = 'fixture', placement = 'front') {
  const expectation = {
    version: DESIGNER_PROBE_VERSION, probeId: id(1), businessId: id(2), connectionId: id(3),
    connectionRevision: id(4), storeId: 123, candidateId: id(5), decisionId: id(6),
    creativeApprovalId: id(7), creativeRunId: id(8), assetVersionId: id(9), purpose: 'candidate_production',
    artworkSha256: hash(artworkBytes), artworkWidthPx: 120, artworkHeightPx: 80,
    catalogProductId: 71, catalogVariantId: 4018, placement, technique: 'dtg',
    layout: { width: '1.2', height: '0.8', left: '3.4', top: '2.5', areaWidth: '12', areaHeight: '16', unit: 'in' },
    minimumDpi: 100, startedAt: at(0), expiresAt: at(900),
  };
  const identity = { storeId: 123, syncProductId: 222, syncVariantId: 333, catalogProductId: 71, catalogVariantId: 4018 };
  const capture = (n, seconds) => ({ captureId: id(n), capturedAt: at(seconds), responseHash: hash(Buffer.from(`synthetic response ${n}`)) });
  const candidate = {
    evidenceMode: mode, businessId: expectation.businessId, connectionId: expectation.connectionId,
    connectionRevision: expectation.connectionRevision, probeId: expectation.probeId,
    upload: { ...capture(10, 10), source: 'independent_file_get', fileId: 987, md5: hash(artworkBytes, 'md5'),
      widthPx: 120, heightPx: 80, mediaType: 'image/png', status: 'ok', temporary: false },
    product: { ...capture(11, 30), ...identity, source: 'independent_product_get', fileId: 987,
      fileMd5: hash(artworkBytes, 'md5'), fileType: placement === 'front' ? 'default' : 'back', variants: 1, savedAt: at(20) },
    design: { ...capture(12, 50), ...identity, source: 'reopened_saved_variant', fileId: 987, leftDesignerAt: at(40),
      technique: 'dtg', placement, layerCount: 1, numericSource: 'visible_numeric_controls',
      coordinateOrigin: 'print_area_top_left', boundsMeaning: 'artwork', rotationDegrees: '0', layout: { ...expectation.layout },
      roundingObserved: false, croppingObserved: false, resamplingObserved: false },
    mockup: { ...capture(13, 60), ...identity, source: 'saved_product_download', designCaptureId: id(12),
      sha256: hash(mockupBytes), mediaType: 'image/png', review: { captureId: id(14), reviewedAt: at(70),
        imageSha256: hash(mockupBytes), outcome: 'PASS', finishedProductShown: true, productMatches: true,
        observedProduct: 'Synthetic white short-sleeved shirt with the blue artwork visible on its selected print area.' } },
  };
  return { expectation, candidate, artworkBytes: Buffer.from(artworkBytes), mockupBytes: Buffer.from(mockupBytes) };
}

function assertNoAuthority(report) {
  for (const key of authorityFlags) assert.equal(report[key], false, key);
  assert.equal(report.requiredNextStep, 'independently_authenticate_and_review_an_explicitly_authorized_account_specific_probe');
}

async function assertBlocked(input, expectedCheck) {
  const report = await checkDesignerProbe(input);
  assertNoAuthority(report);
  assert.equal(report.status, 'blocked');
  assert.ok(report.checks.some(check => !check.passed));
  if (expectedCheck) assert.equal(report.checks.find(check => check.name === expectedCheck)?.passed, false, expectedCheck);
  return report;
}

for (const mode of ['fixture', 'candidate_capture']) {
  for (const placement of ['front', 'back']) {
    test(`${mode} ${placement} satisfies only the offline candidate contract`, async () => {
      const input = fixture(mode, placement);
      const report = await checkDesignerProbe(input);
      assert.equal(report.status, 'candidate_contract_satisfied');
      assert.equal(report.version, DESIGNER_PROBE_VERSION);
      assert.ok(report.checks.length >= 8);
      assert.ok(report.checks.every(check => check.passed && check.reason === null));
      assertNoAuthority(report);
      assert.equal(report.artworkSha256, hash(input.artworkBytes));
      assert.equal(report.mockupSha256, hash(input.mockupBytes));
      assert.notEqual(report.artworkSha256, report.mockupSha256);
      assert.match(report.candidateFingerprint, /^[0-9a-f]{64}$/);
      assert.deepEqual(await checkDesignerProbe(input), report);
    });
  }
}

test('fixture claims cannot promote any live or execution authority', async () => {
  const input = fixture();
  Object.assign(input.candidate, Object.fromEntries(authorityFlags.map(key => [key, true])));
  const report = await checkDesignerProbe(input);
  assertNoAuthority(report);
});

test('consistently changed expected and observed geometry changes the candidate fingerprint', async () => {
  const input = fixture(), original = await checkDesignerProbe(input);
  input.expectation.layout.left = '3.5'; input.candidate.design.layout.left = '3.5';
  const changed = await checkDesignerProbe(input);
  assert.equal(original.status, 'candidate_contract_satisfied');
  assert.equal(changed.status, 'candidate_contract_satisfied');
  assert.deepEqual(changed.checks, original.checks);
  assert.notEqual(changed.candidateFingerprint, original.candidateFingerprint);
  assertNoAuthority(changed);
});

test('cyclic and oversized candidate documents block safely before either image is accessed', async () => {
  for (const malformed of ['cyclic', 'oversized']) {
    const input = fixture();
    if (malformed === 'cyclic') input.candidate.self = input.candidate;
    else input.candidate.unexpectedPayload = 'x'.repeat(262145);
    for (const key of ['artworkBytes', 'mockupBytes']) {
      Object.defineProperty(input, key, { get() { throw new Error('invalid documents must not access image bytes'); } });
    }
    const report = await assertBlocked(input, 'candidate_document');
    assert.equal(report.checks.length, 1, malformed);
    assert.equal(report.checks[0].reason, 'bounded_json_candidate_required', malformed);
    assert.equal(report.candidateFingerprint, undefined, malformed);
  }
});

test('probe limits remain bounded and prohibit downstream actions or automatic retries', () => {
  assert.equal(Object.isFrozen(DESIGNER_PROBE_LIMITS), true);
  for (const key of ['manualStores', 'catalogVariants', 'fileUploads', 'productCreates', 'designSaves', 'mockupDownloads']) {
    assert.equal(DESIGNER_PROBE_LIMITS[key], 1, key);
  }
  for (const key of ['orders', 'marketplacePublications', 'premiumAssets', 'automaticRetries', 'credentialEntryByAutomation']) {
    assert.equal(DESIGNER_PROBE_LIMITS[key], 0, key);
  }
  assert.equal(DESIGNER_PROBE_LIMITS.maximumSessionSeconds, 900);
});

for (const key of ['probeId', 'businessId', 'connectionId', 'connectionRevision', 'candidateId', 'decisionId', 'creativeApprovalId', 'creativeRunId', 'assetVersionId']) {
  test(`missing expectation ${key} blocks before evidence processing`, async () => {
    const input = fixture(); delete input.expectation[key]; await assertBlocked(input, 'expectation');
  });
}
for (const key of ['probeId', 'businessId', 'connectionId', 'connectionRevision']) {
  for (const value of [undefined, id(99)]) {
    test(`${value === undefined ? 'missing' : 'foreign'} capture ${key} is rejected`, async () => {
      const input = fixture(); input.candidate[key] = value; await assertBlocked(input, 'capture_contract');
    });
  }
}

for (const [name, mutate, check] of [
  ['technical purpose', f => { f.expectation.purpose = 'technical_probe'; }, 'expectation'],
  ['wrong version', f => { f.expectation.version = 'future-version'; }, 'expectation'],
  ['invalid candidate identifier', f => { f.expectation.candidateId = 'candidate-name'; }, 'expectation'],
  ['missing candidate', f => { f.candidate = null; }, 'capture_contract'],
  ['live evidence mode', f => { f.candidate.evidenceMode = 'live'; }, 'capture_contract'],
  ['array-coerced evidence mode', f => { f.candidate.evidenceMode = ['fixture']; }, 'capture_contract'],
  ['array-coerced expected placement', f => { f.expectation.placement = ['front']; }, 'expectation'],
  ['changed approved PNG bytes', f => { f.artworkBytes = changedArtworkBytes; }, 'approved_bytes'],
  ['MD5 in approved SHA256 field', f => { f.expectation.artworkSha256 = hash(f.artworkBytes, 'md5'); }, 'expectation'],
  ['SHA256 in upload MD5 field', f => { f.candidate.upload.md5 = hash(f.artworkBytes); }, 'uploaded_file'],
  ['SHA256 in product MD5 field', f => { f.candidate.product.fileMd5 = hash(f.artworkBytes); }, 'saved_product'],
  ['wrong upload MD5', f => { f.candidate.upload.md5 = '0'.repeat(32); }, 'uploaded_file'],
  ['wrong artwork dimensions', f => { f.candidate.upload.widthPx += 1; }, 'uploaded_file'],
  ['inadequate DPI', f => { f.expectation.minimumDpi = 101; }, 'approved_bytes'],
  ['wrong upload media type', f => { f.candidate.upload.mediaType = 'image/jpeg'; }, 'uploaded_file'],
  ['processing upload', f => { f.candidate.upload.status = 'processing'; }, 'uploaded_file'],
  ['temporary upload', f => { f.candidate.upload.temporary = true; }, 'uploaded_file'],
  ['upload write response substituted for readback', f => { f.candidate.upload.source = 'file_post_response'; }, 'uploaded_file'],
  ['product write response substituted for readback', f => { f.candidate.product.source = 'product_post_response'; }, 'saved_product'],
  ['additional product variant', f => { f.candidate.product.variants = 2; }, 'saved_product'],
  ['wrong saved file', f => { f.candidate.product.fileId += 1; }, 'saved_product'],
  ['wrong placement file type', f => { f.candidate.product.fileType = 'back'; }, 'saved_product'],
  ['template instead of saved variant', f => { f.candidate.design.source = 'product_template'; }, 'reopened_numeric_layout'],
  ['unsaved designer canvas', f => { f.candidate.design.source = 'current_designer_canvas'; }, 'reopened_numeric_layout'],
  ['wrong reopened file', f => { f.candidate.design.fileId += 1; }, 'reopened_numeric_layout'],
  ['screenshot-derived estimate', f => { f.candidate.design.numericSource = 'screenshot_estimate'; }, 'reopened_numeric_layout'],
  ['unknown coordinate origin', f => { f.candidate.design.coordinateOrigin = 'canvas_top_left'; }, 'reopened_numeric_layout'],
  ['canvas instead of artwork bounds', f => { f.candidate.design.boundsMeaning = 'canvas'; }, 'reopened_numeric_layout'],
  ['rounded width', f => { f.candidate.design.layout.width = '1.2001'; }, 'reopened_numeric_layout'],
  ['rounded height', f => { f.candidate.design.layout.height = '0.8001'; }, 'reopened_numeric_layout'],
  ['rounded left offset', f => { f.candidate.design.layout.left = '3.4001'; }, 'reopened_numeric_layout'],
  ['rounded top offset', f => { f.candidate.design.layout.top = '2.5001'; }, 'reopened_numeric_layout'],
  ['wrong print-area width', f => { f.candidate.design.layout.areaWidth = '12.1'; }, 'reopened_numeric_layout'],
  ['wrong print-area height', f => { f.candidate.design.layout.areaHeight = '16.1'; }, 'reopened_numeric_layout'],
  ['reported rounding', f => { f.candidate.design.roundingObserved = true; }, 'reopened_numeric_layout'],
  ['rotation', f => { f.candidate.design.rotationDegrees = '0.1'; }, 'reopened_numeric_layout'],
  ['untyped rotation value', f => { f.candidate.design.rotationDegrees = 0; }, 'reopened_numeric_layout'],
  ['additional layer', f => { f.candidate.design.layerCount = 2; }, 'reopened_numeric_layout'],
  ['missing layer', f => { f.candidate.design.layerCount = 0; }, 'reopened_numeric_layout'],
  ['cropped artwork', f => { f.candidate.design.croppingObserved = true; }, 'reopened_numeric_layout'],
  ['resampled artwork', f => { f.candidate.design.resamplingObserved = true; }, 'reopened_numeric_layout'],
  ['different technique', f => { f.candidate.design.technique = 'embroidery'; }, 'reopened_numeric_layout'],
  ['different placement', f => { f.candidate.design.placement = 'back'; }, 'reopened_numeric_layout'],
  ['template mockup', f => { f.candidate.mockup.source = 'template_preview'; }, 'saved_product_mockup'],
  ['different design capture reference', f => { f.candidate.mockup.designCaptureId = id(99); }, 'saved_product_mockup'],
  ['wrong mockup hash', f => { f.candidate.mockup.sha256 = '0'.repeat(64); }, 'saved_product_mockup'],
  ['MD5 in mockup SHA256 field', f => { f.candidate.mockup.sha256 = hash(f.mockupBytes, 'md5'); }, 'saved_product_mockup'],
  ['wrong mockup media type', f => { f.candidate.mockup.mediaType = 'image/jpeg'; }, 'saved_product_mockup'],
  ['missing independent review', f => { delete f.candidate.mockup.review; }, 'independent_mockup_review'],
  ['different reviewed image', f => { f.candidate.mockup.review.imageSha256 = '0'.repeat(64); }, 'independent_mockup_review'],
  ['failed independent review', f => { f.candidate.mockup.review.outcome = 'FAIL'; }, 'independent_mockup_review'],
  ['raw artwork acknowledged in review', f => { f.candidate.mockup.review.finishedProductShown = false; }, 'independent_mockup_review'],
  ['different product acknowledged in review', f => { f.candidate.mockup.review.productMatches = false; }, 'independent_mockup_review'],
  ['empty independent observation', f => { f.candidate.mockup.review.observedProduct = ' '; }, 'independent_mockup_review'],
]) {
  test(`rejects ${name}`, async () => { const input = fixture(); mutate(input); await assertBlocked(input, check); });
}

for (const section of ['product', 'design', 'mockup']) {
  for (const key of ['storeId', 'catalogProductId', 'catalogVariantId', 'syncProductId', 'syncVariantId']) {
    test(`rejects foreign ${section} ${key}`, async () => {
      const input = fixture(); input.candidate[section][key] += 1; await assertBlocked(input);
    });
  }
}

for (const section of ['upload', 'product', 'design', 'mockup']) {
  for (const [name, mutate] of [
    ['missing capture identity', capture => { delete capture.captureId; }],
    ['non-SHA256 response hash', capture => { capture.responseHash = 'a'.repeat(32); }],
    ['missing response hash', capture => { delete capture.responseHash; }],
    ['stale capture', capture => { capture.capturedAt = at(-1); }],
    ['expired capture', capture => { capture.capturedAt = at(901); }],
  ]) {
    test(`rejects ${section} ${name}`, async () => {
      const input = fixture(); mutate(input.candidate[section]); await assertBlocked(input);
    });
  }
}

const captures = ['upload', 'product', 'design', 'mockup', 'review'];
const captureAt = (candidate, name) => name === 'review' ? candidate.mockup.review : candidate[name];
for (let first = 0; first < captures.length; first++) {
  for (let second = first + 1; second < captures.length; second++) {
    test(`rejects duplicate ${captures[first]} and ${captures[second]} capture IDs`, async () => {
      const input = fixture();
      captureAt(input.candidate, captures[second]).captureId = captureAt(input.candidate, captures[first]).captureId;
      // Keep the design reference consistent so this tests distinct evidence, not a broken reference.
      input.candidate.mockup.designCaptureId = input.candidate.design.captureId;
      await assertBlocked(input);
    });
  }
}

test('capture independence compares UUID identities case-insensitively', async () => {
  const input = fixture(), captureId = 'abcdefab-abcd-4abc-8abc-abcdefabcdef';
  const spellings = [captureId, captureId.toUpperCase(), ...[0, 1, 2].map(index =>
    captureId.slice(0, index) + captureId[index].toUpperCase() + captureId.slice(index + 1))];
  for (const [index, name] of captures.entries()) captureAt(input.candidate, name).captureId = spellings[index];
  input.candidate.mockup.designCaptureId = input.candidate.design.captureId;
  assert.equal(new Set(spellings).size, 5);
  assert.equal(new Set(spellings.map(value => value.toLowerCase())).size, 1);
  await assertBlocked(input, 'capture_independence');
});

for (const [name, mutate] of [
  ['session longer than 15 minutes', f => { f.expectation.expiresAt = at(901); }],
  ['reversed session window', f => { f.expectation.expiresAt = at(-1); }],
  ['non-date session start', f => { f.expectation.startedAt = 'not-a-date'; }],
  ['array-coerced session start', f => { f.expectation.startedAt = [at(0)]; }],
  ['array-coerced session end', f => { f.expectation.expiresAt = [at(900)]; }],
  ['save before session', f => { f.candidate.product.savedAt = at(-1); }],
  ['file readback after save', f => { f.candidate.upload.capturedAt = at(21); }],
  ['product readback before save', f => { f.candidate.product.capturedAt = at(19); }],
  ['product readback after reopening', f => { f.candidate.product.capturedAt = at(51); }],
  ['leave designer before product readback', f => { f.candidate.design.leftDesignerAt = at(29); }],
  ['leave designer at save time', f => { f.candidate.design.leftDesignerAt = at(20); }],
  ['reopen at leave time', f => { f.candidate.design.capturedAt = at(40); }],
  ['mockup before reopening', f => { f.candidate.mockup.capturedAt = at(49); }],
  ['review before download', f => { f.candidate.mockup.review.reviewedAt = at(59); }],
  ['review after session', f => { f.candidate.mockup.review.reviewedAt = at(901); }],
]) {
  test(`rejects ${name}`, async () => { const input = fixture(); mutate(input); await assertBlocked(input); });
}

const centimetres = { width: '3.048', height: '2.032', left: '8.636', top: '6.35', areaWidth: '30.48', areaHeight: '40.64', unit: 'cm' };
const millimetres = { width: '30.48', height: '20.32', left: '86.36', top: '63.5', areaWidth: '304.8', areaHeight: '406.4', unit: 'mm' };
for (const layout of [centimetres, millimetres]) {
  test(`accepts exactly equivalent inch/${layout.unit} geometry without floating-point tolerance`, async () => {
    const input = fixture(); input.candidate.design.layout = { ...layout };
    const report = await checkDesignerProbe(input);
    assert.equal(report.status, 'candidate_contract_satisfied'); assertNoAuthority(report);
  });
}
test('centimetre expectation accepts exact reopened inch values', async () => {
  const input = fixture(); input.expectation.layout = { ...centimetres };
  assert.equal((await checkDesignerProbe(input)).status, 'candidate_contract_satisfied');
});
for (const [name, mutate] of [
  ['unknown units', layout => { layout.unit = 'pixels'; }],
  ['percentage units', layout => { layout.unit = '%'; }],
  ['percentage value', layout => { layout.width = '10%'; }],
  ['numeric instead of explicit decimal string', layout => { layout.width = 1.2; }],
  ['exponent notation', layout => { layout.width = '1.2e0'; }],
  ['comma decimal', layout => { layout.width = '1,2'; }],
  ['negative offset', layout => { layout.left = '-0.1'; }],
  ['more than four fractional digits', layout => { layout.width = '1.20001'; }],
  ['out-of-bounds artwork', layout => { layout.left = '11'; }],
  ['zero artwork width', layout => { layout.width = '0'; }],
  ['rounding during unit conversion', layout => { Object.assign(layout, centimetres, { width: '3.05' }); }],
]) {
  test(`rejects ${name}`, async () => {
    const input = fixture(); mutate(input.candidate.design.layout); await assertBlocked(input, 'reopened_numeric_layout');
  });
}

function rebindArtwork(input, bytes) {
  input.artworkBytes = bytes; input.expectation.artworkSha256 = hash(bytes);
  input.candidate.upload.md5 = hash(bytes, 'md5'); input.candidate.product.fileMd5 = hash(bytes, 'md5');
}
function rebindMockup(input, bytes) {
  input.mockupBytes = bytes; input.candidate.mockup.sha256 = hash(bytes);
  input.candidate.mockup.review.imageSha256 = hash(bytes);
}

test('raw approved artwork cannot masquerade as a saved-product mockup even with matching hashes and review claims', async () => {
  const input = fixture(); rebindMockup(input, input.artworkBytes); await assertBlocked(input, 'saved_product_mockup');
});

// libvips can decode a PNG's first frame while ignoring APNG chunks, so a valid
// two-frame PNG is necessary to exercise animation rejection independently of MIME.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(name, data) {
  const type = Buffer.from(name), size = Buffer.alloc(4), crc = Buffer.alloc(4);
  size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([size, type, data, crc]);
}
function animatedPng() {
  const width = 120, height = 80, ihdr = Buffer.alloc(13), animation = Buffer.alloc(8);
  ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  animation.writeUInt32BE(2);
  const control = sequence => {
    const bytes = Buffer.alloc(26); bytes.writeUInt32BE(sequence); bytes.writeUInt32BE(width, 4); bytes.writeUInt32BE(height, 8);
    bytes.writeUInt16BE(1, 20); bytes.writeUInt16BE(10, 22); return bytes;
  };
  const pixels = red => {
    const bytes = Buffer.alloc((width * 4 + 1) * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const offset = y * (width * 4 + 1) + 1 + x * 4;
      bytes[offset] = red; bytes[offset + 1] = 20; bytes[offset + 2] = 60; bytes[offset + 3] = 255;
    }
    return deflateSync(bytes);
  };
  const sequence = Buffer.alloc(4); sequence.writeUInt32BE(2);
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('sRGB', Buffer.from([0])),
    chunk('acTL', animation), chunk('fcTL', control(0)), chunk('IDAT', pixels(200)),
    chunk('fcTL', control(1)), chunk('fdAT', Buffer.concat([sequence, pixels(60)])), chunk('IEND', Buffer.alloc(0)),
  ]);
}
const animatedBytes = animatedPng();

for (const target of ['artwork', 'mockup']) {
  for (const [name, corrupt] of [
    ['corrupt image signature', bytes => { const corrupt = Buffer.from(bytes); corrupt[0] = 0; return corrupt; }],
    ['corrupt chunk CRC', bytes => { const corrupt = Buffer.from(bytes); corrupt[corrupt.length - 1] ^= 1; return corrupt; }],
    ['truncated compressed pixels', bytes => bytes.subarray(0, Math.floor(bytes.length / 2))],
    ['partially truncated IEND', bytes => bytes.subarray(0, bytes.length - 1)],
    ['missing IEND', bytes => bytes.subarray(0, bytes.length - 12)],
    ['trailing data after IEND', bytes => Buffer.concat([bytes, Buffer.from('unexpected')])],
    ['animated PNG', () => animatedBytes],
    ['oversized encoded bytes', bytes => Buffer.concat([bytes, Buffer.alloc(DESIGNER_PROBE_LIMITS.maximumArtworkBytes + 1 - bytes.length)])],
  ]) {
    test(`rejects ${target} ${name} even when supplied hashes match the invalid bytes`, async () => {
      const input = fixture();
      const bytes = corrupt(input[`${target}Bytes`]);
      if (target === 'artwork') rebindArtwork(input, bytes); else rebindMockup(input, bytes);
      await assertBlocked(input, target === 'artwork' ? 'approved_bytes' : 'saved_product_mockup');
    });
  }
}

test('rejects oversized decoded mockup dimensions despite a tiny encoded PNG', async () => {
  const input = fixture();
  rebindMockup(input, await sharp({ create: { width: 4097, height: 2, channels: 4, background: '#fff' } }).png().toBuffer());
  await assertBlocked(input, 'saved_product_mockup');
});

test('rejects oversized declared artwork dimensions before image processing', async () => {
  const input = fixture(); input.expectation.artworkWidthPx = 4097; await assertBlocked(input, 'expectation');
});

test('rejects JPEG mockup bytes even with the correct declared MIME, SHA256 and review', async () => {
  const input = fixture(); rebindMockup(input, await sharp(input.mockupBytes).jpeg().toBuffer());
  input.candidate.mockup.mediaType = 'image/jpeg';
  await assertBlocked(input, 'saved_product_mockup');
});

const cliPath = fileURLToPath(new URL('../scripts/check-printful-designer-probe.mjs', import.meta.url));
function runCli(args, timeout = 10_000) {
  const result = spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf8', timeout, maxBuffer: 1_048_576 });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, '');
  return result;
}
async function cliFixture(t, mode = 'fixture') {
  const directory = await mkdtemp(join(tmpdir(), 'printful-designer-probe-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = fixture(mode), document = join(directory, 'candidate.json');
  const artwork = join(directory, 'artwork.png'), mockup = join(directory, 'mockup.png');
  const save = () => writeFile(document, JSON.stringify({ expectation: input.expectation, candidate: input.candidate }));
  await Promise.all([save(), writeFile(artwork, input.artworkBytes), writeFile(mockup, input.mockupBytes)]);
  return { input, document, directory, save, args: [document, artwork, mockup] };
}

test('CLI help documents offline-only success without opening local inputs', () => {
  const result = runCli(['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /never live qualification or execution permission/);
});
for (const mode of ['fixture', 'candidate_capture']) {
  test(`CLI reports ${mode} contract success while retaining all no-authority flags`, async t => {
    const f = await cliFixture(t, mode), result = runCli(f.args), report = JSON.parse(result.stdout);
    assert.equal(result.status, 0); assert.equal(report.status, 'candidate_contract_satisfied');
    assertNoAuthority(report);
    assert.match(report.notice, /OFFLINE CANDIDATE CHECK ONLY/);
    assert.equal(result.stdout.includes(f.directory), false);
  });
}
test('CLI returns blocked exit 1 for missing independent evidence', async t => {
  const f = await cliFixture(t); delete f.input.candidate.mockup.review; await f.save();
  const result = runCli(f.args), report = JSON.parse(result.stdout);
  assert.equal(result.status, 1); assert.equal(report.status, 'blocked'); assertNoAuthority(report);
  assert.equal(report.checks.find(check => check.name === 'independent_mockup_review').passed, false);
});
for (const [name, mutate] of [
  ['invalid JSON', async f => { await writeFile(f.document, '{PRIVATE-CONTENT-DO-NOT-ECHO'); }],
  ['extra document keys', async f => { await writeFile(f.document, JSON.stringify({ expectation: f.input.expectation, candidate: f.input.candidate, unexpected: true })); }],
  ['missing candidate document key', async f => { await writeFile(f.document, JSON.stringify({ expectation: f.input.expectation })); }],
  ['oversized candidate JSON', async f => { await writeFile(f.document, ' '.repeat(262145)); }],
  ['missing local image', async f => { f.args[1] = join(f.directory, 'PRIVATE-FILENAME-DO-NOT-ECHO.png'); }],
  ['directory instead of local image', async f => { f.args[1] = f.directory; }],
  ['wrong argument count', async f => { f.args.pop(); }],
]) {
  test(`CLI safely reports ${name} with exit 2 and no input echo`, async t => {
    const f = await cliFixture(t); await mutate(f);
    const result = runCli(f.args), report = JSON.parse(result.stdout);
    assert.equal(result.status, 2); assert.equal(report.status, 'blocked');
    assert.equal(report.reason, 'bounded_local_candidate_files_and_compiled_checker_required');
    assert.equal(report.liveQualified, false); assert.equal(report.executionAuthorized, false);
    assert.equal(result.stdout.includes(f.directory), false);
    assert.doesNotMatch(result.stdout, /PRIVATE-(?:FILENAME|CONTENT)-DO-NOT-ECHO|ENOENT|SyntaxError|Error:/);
    for (const key of authorityFlags) assert.notEqual(report[key], true, key);
  });
}

for (const [index, name] of ['candidate document', 'artwork', 'mockup'].entries()) {
  test(`CLI rejects a ${name} FIFO promptly without waiting for a writer`, { skip: process.platform === 'win32' }, async t => {
    const f = await cliFixture(t), fifo = join(f.directory, `PRIVATE-FIFO-${index}-DO-NOT-ECHO`);
    const created = spawnSync('mkfifo', [fifo], { encoding: 'utf8', timeout: 2_000 });
    assert.equal(created.error, undefined); assert.equal(created.status, 0); assert.equal(created.stderr, '');
    f.args[index] = fifo;
    const result = runCli(f.args, 2_000), report = JSON.parse(result.stdout);
    assert.equal(result.status, 2); assert.equal(report.status, 'blocked');
    assert.equal(report.liveQualified, false); assert.equal(report.executionAuthorized, false);
    assert.equal(result.stdout.includes(f.directory), false); assert.doesNotMatch(result.stdout, /PRIVATE-FIFO/);
  });
}
