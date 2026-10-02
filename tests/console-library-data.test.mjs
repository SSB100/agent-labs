import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { query, api, id, business, other, foreign, stamp, hash, label, keys, seed, together, fixture } from './helpers/console-library-data-fixtures.mjs';
const oldFetch = globalThis.fetch;
test.before(() => { globalThis.fetch = () => { throw Error('External networking denied'); }; });
test.after(() => { globalThis.fetch = oldFetch; });

test('strict Library query, literal searches and links preserve aggregate scope and filters', () => {
  for (const input of [{ page: 0 }, { page: 1.2 }, { pageSize: 50 }, { page: Number.MAX_SAFE_INTEGER }, { selectedId: 'bad' }, { query: '*' }, { query: 'a\nb' }, { query: 'x'.repeat(121) }, { query: 2 }, { sort: 'updated' }, { mediaType: 'image/*' }, { artifactType: 'arbitrary' }]) assert.throws(() => query.consoleLibraryQuery('records', input));
  assert.throws(() => query.consoleLibraryQuery('designs', { mediaType: 'image/png' }));
  for (const params of [{ selected: [id(1), id(2)] }, { type: 'research' }, { decision: id(1) }, { connectionRun: id(1) }, { run: id(1) }, { status: 'active' }, { artifact: id(1) }, { type: 'records', selected: id(1), artifact: id(2) }]) assert.throws(() => query.consoleLibraryOptionsFromSearch(params));
  assert.equal(query.consoleLibraryOptionsFromSearch({ view: 'library', type: 'records', artifact: id(1) }).selectedId, id(1));
  assert.equal(query.consoleLibrarySearchPattern('50%_\\saved'), '%50\\%\\_\\\\saved%');
  const current = new URLSearchParams({ view: 'library', type: 'records', page: '3', q: 'saved', mediaType: 'application/json', artifact: id(7) });
  const selected = new URL(query.consoleLibraryHref(current, { selected: id(8) }), 'https://fixture').searchParams;
  assert.equal(selected.get('business'), null); assert.equal(selected.get('page'), '3'); assert.equal(selected.get('artifact'), null); assert.equal(selected.get('q'), 'saved');
  assert.equal(new URL(query.consoleLibraryHref(selected, { selected: null }), 'https://fixture').searchParams.get('page'), '3');
  assert.equal(new URL(query.consoleLibraryHref(selected, { q: 'new' }), 'https://fixture').searchParams.get('page'), null);
});

test('0/1/49/50/51/126 designs per Business have exact server pages, stable ties and bounded previews', async () => {
  for (const size of [0, 1, 49, 50, 51, 126]) {
    const h = fixture(together(seed(size), seed(size + 1, other, 10000)));
    for (const [scope, count] of [[business, size], [other, size + 1], [undefined, size * 2 + 1]]) {
      const seen = [];
      for (let page = 1; page <= Math.max(1, Math.ceil(count / 25)); page++) {
        const before = h.signs.length, result = await api.loadConsoleLibraryPage(h.context, { businessId: scope, page });
        assert.equal(result.page.total, count); assert.equal(result.page.complete, true); assert.equal(result.page.items.length, Math.min(25, Math.max(0, count - (page - 1) * 25)));
        assert.equal(result.page.hasNext, page * 25 < count); seen.push(...result.page.items.map(row => row.id));
        assert.ok(result.page.items.every(row => row.prompt === label && row.previewStatus === 'ready' && row.workIdentity.artifactId === row.artifact_id && row.artifact_id !== row.id));
        assert.ok(h.signs.slice(before).flat().length <= 25);
      }
      assert.equal(seen.length, count); assert.equal(new Set(seen).size, count);
    }
    assert.ok(h.calls.filter(call => call.range).every(call => call.range[1] - call.range[0] === 25 && call.orders[0][0] === 'generated_at' && call.orders[1][0] === 'id'));
    assert.ok(!h.calls.some(call => /phase_outputs|cost_|reviews/.test(call.table))); assert.deepEqual(h.forbidden, []);
  }
});

test('exact old off-page asset ignores search/page filter and signs at most 26 normalized paths', async () => {
  const db = together(seed(130), seed(130, other, 10000)), asset = db.creative_assets[0]; asset.prompt = 'outside filter';
  const h = fixture(db), result = await api.loadConsoleLibraryPage(h.context, { query: 'Duplicate', selectedId: asset.id, page: 2 });
  assert.equal(result.selection.status, 'found'); assert.equal(result.selection.item.id, asset.id); assert.ok(!result.page.items.some(row => row.id === asset.id)); assert.equal(result.page.total, 259);
  assert.equal(result.selection.item.artifact.item.id, asset.artifact_id); assert.notEqual(asset.id, asset.artifact_id);
  assert.equal(result.selection.item.workIdentity.artifactId, asset.artifact_id); assert.equal(result.selection.item.runDetail.approval.item.snapshot.saved, true);
  assert.equal(result.selection.item.provenance.normalizedSha256, hash); assert.equal(result.selection.item.complete, true);
  assert.equal(h.signs.length, 1); assert.equal(h.signs[0].length, 26); assert.equal(new Set(h.signs[0]).size, 26);
  const pageCall = h.calls.find(call => call.table === 'creative_assets' && call.range), sentinel = pageCall.result.data[25];
  assert.ok(!h.signs[0].includes(sentinel.storage_path)); assert.ok(h.signs[0].every(path => path.endsWith('.png') && !path.endsWith('.original.webp')));
  assert.ok(h.calls.filter(call => call.columns.split(',').includes('inspection')).every(call => call.limit === 2 && call.filters.some(f => f[1] === 'id' && f[2] === asset.id)));
});

test('record pages cover two Businesses and 0/1/49/50/51/126 rows without content preloads', async () => {
  for (const size of [0, 1, 49, 50, 51, 126]) {
    const h = fixture(together(seed(size), seed(size, other, 10000)));
    for (const scope of [business, other]) for (let page = 1; page <= Math.max(1, Math.ceil(size / 25)); page++) {
      const result = await api.loadConsoleLibraryRecordsPage(h.context, { businessId: scope, page });
      assert.equal(result.page.total, size); assert.equal(result.page.complete, true); assert.ok(result.page.items.every(row => row.business_id === scope && !Object.hasOwn(row, 'content') && !Object.hasOwn(row, 'metadata') && !Object.hasOwn(row, 'checksum')));
    }
    assert.equal(h.signs.length, 0); assert.ok(h.calls.every(call => call.table === 'artifacts' && call.range && call.orders[1][0] === 'id'));
  }
});

test('persisted MIME/type filters precede paging; off-filter exact artifact keeps content/checksum with unknown version', async () => {
  const db = seed(130), artifact = db.artifacts[0]; artifact.name = 'outside search'; artifact.storage_path = 'https://arbitrary.invalid/file.pdf'; artifact.media_type = 'application/pdf';
  for (const row of db.artifacts.slice(1)) { row.name = 'Saved 50%_\\record'; row.media_type = 'application/json'; row.artifact_type = 'creative.review'; }
  artifact.content = { version: 'schema-1.0', huge: 'x'.repeat(250000) }; artifact.metadata = { huge: 'y'.repeat(250000) };
  const h = fixture(db), result = await api.loadConsoleLibraryRecordsPage(h.context, { selectedId: artifact.id, query: '50%_\\', mediaType: 'application/json', artifactType: 'creative.review', page: 3 });
  assert.equal(result.page.total, 129); assert.equal(result.page.items.length, 25); assert.equal(result.selection.status, 'found'); assert.equal(result.selection.item.checksum, hash); assert.equal(result.selection.item.version, null);
  assert.equal(result.selection.item.content.huge.length, 250000); assert.equal(result.selection.item.metadata.huge.length, 250000); assert.ok(!Object.hasOwn(result.selection.item, 'downloadUrl')); assert.equal(h.signs.length, 0);
  const metadata = h.calls.find(call => call.range); assert.ok(metadata.filters.some(f => f[1] === 'media_type')); assert.ok(metadata.filters.some(f => f[1] === 'artifact_type')); assert.ok(metadata.result.data.every(row => !Object.hasOwn(row, 'content')));
});

test('all heavy creative JSON is omitted from list and relation metadata; exact selection alone reads snapshots', async () => {
  const db = seed(30), payload = { huge: 'x'.repeat(250000) };
  db.creative_assets[0].inspection = { ...payload, sha256: hash }; db.creative_runs[0].catalog_snapshot = payload; db.creative_approvals[0].snapshot = payload; db.creative_approvals[0].quote = payload; db.workflow_runs[0].input = { ...db.workflow_runs[0].input, ...payload }; db.workflow_runs[0].state = payload; db.artifacts[0].content = payload; db.artifacts[0].metadata = payload;
  let h = fixture(db); await api.loadConsoleLibraryPage(h.context, { sort: 'oldest' });
  const forbiddenFields = ['inspection', 'catalog_snapshot', 'snapshot', 'quote', 'input', 'state', 'content', 'metadata', 'output', 'receipt', 'review', 'estimate'];
  assert.ok(h.calls.every(call => forbiddenFields.every(field => !call.columns.split(',').includes(field))));
  h = fixture(db); const result = await api.loadConsoleLibraryPage(h.context, { selectedId: db.creative_assets[0].id });
  assert.equal(result.selection.item.inspection.huge.length, 250000); assert.equal(result.selection.item.runDetail.selection.item.catalog_snapshot.huge.length, 250000); assert.equal(result.selection.item.runDetail.workflow.item.input.huge.length, 250000);
  for (const call of h.calls.filter(call => forbiddenFields.some(field => call.columns.split(',').includes(field)))) assert.ok(call.filters.some(f => ['id', 'creative_run_id'].includes(f[1]) && f[0] === 'eq'), `JSON without exact identity: ${call.table}`);
});

test('missing/invalid counts, response caps, failures and ignored predicates never establish complete pages', async () => {
  for (const reader of [api.loadConsoleLibraryPage, api.loadConsoleLibraryRecordsPage]) {
    const table = reader === api.loadConsoleLibraryPage ? 'creative_assets' : 'artifacts';
    for (const count of [null, undefined, -1, NaN, Infinity, 1.25, '130', Number.MAX_SAFE_INTEGER + 1]) {
      const h = fixture(seed(130), { counts: { [table]: count } }), result = await reader(h.context);
      assert.equal(result.page.complete, false); assert.equal(result.page.total, null);
    }
    for (const opts of [{ cap: { [table]: 4 } }, { failTable: table }, { throwTable: table }, { duplicate: table }]) {
      const h = fixture(seed(130), opts), result = await reader(h.context);
      assert.equal(result.page.complete, false); assert.equal(result.page.total, null); assert.ok(result.errors.length);
    }
    const h = fixture(together(seed(1), seed(1, other, 10000)), { ignore: [table] }), result = await reader(h.context, { businessId: business });
    assert.equal(result.page.complete, false); assert.equal(result.page.items.length, 0);
    const filter = fixture(seed(1), { ignore: [table] }), filtered = await reader(filter.context, { query: 'not in any label' });
    assert.equal(filtered.page.complete, false); assert.equal(filtered.page.items.length, 0);
  }
});

test('exact selections reject incorrect IDs, duplicate rows, counts, foreign Business and malformed shape', async () => {
  for (const [reader, table] of [[api.loadConsoleLibraryPage, 'creative_assets'], [api.loadConsoleLibraryRecordsPage, 'artifacts']]) {
    const base = seed(1), selectedId = base[table][0].id;
    for (const mutation of [result => ({ ...result, count: null }), result => ({ ...result, data: [{ ...result.data[0], id: id(99999) }] }), result => ({ ...result, data: [{ ...result.data[0], business_id: other }] }), result => ({ ...result, data: [result.data[0], result.data[0]], count: 2 }), result => ({ ...result, data: [null] })]) {
      const h = fixture(base, { transport: (name, result, call) => name === table && call.filters.some(f => f[1] === 'id' && f[0] === 'eq') ? mutation(result) : result });
      const result = await reader(h.context, { businessId: business, selectedId }); assert.equal(result.selection.status, 'unavailable'); assert.equal(result.selection.item, null);
    }
    const h = fixture(base); assert.equal((await reader(h.context, { businessId: other, selectedId })).selection.status, 'missing');
    await assert.rejects(reader(h.context, { businessId: foreign }), /Business selection/);
    await assert.rejects(reader(h.context, { selectedId: 'wrong' }), /identity/);
  }
});

test('malformed required fields stay unavailable; unknown future workflow status remains inspectable', async () => {
  for (const [field, value] of [['generated_at', '2026-02-30T00:00:00Z'], ['generated_at', '2026-10-02'], ['generated_at', undefined], ['candidate_id', null], ['brief_hash', 'bad'], ['version', 3], ['model', ''], ['artifact_id', 'not-a-uuid']]) {
    const db = seed(1); db.creative_assets[0][field] = value; const h = fixture(db), result = await api.loadConsoleLibraryPage(h.context, { selectedId: db.creative_assets[0].id });
    assert.equal(result.page.items.length, 0); assert.equal(result.selection.status, 'unavailable'); assert.equal(h.signs.length, 0);
  }
  for (const field of ['created_at', 'updated_at', 'media_type', 'name', 'task_contract_id', 'workflow_run_id']) {
    const db = seed(1); delete db.artifacts[0][field]; const result = await api.loadConsoleLibraryRecordsPage(fixture(db).context, { selectedId: db.artifacts[0].id });
    assert.equal(result.page.complete, false); assert.equal(result.selection.status, 'unavailable');
  }
  const db = seed(1); db.workflow_runs[0].status = 'future_status_2030'; const h = fixture(db), result = await api.loadConsoleLibraryPage(h.context, { selectedId: db.creative_assets[0].id });
  assert.equal(result.selection.status, 'found'); assert.equal(result.selection.item.status, 'future_status_2030'); assert.equal(result.selection.item.contextStatus, 'verified');
  for (const value of ['', null, undefined]) { const db = seed(1); db.workflow_runs[0].status = value; const h = fixture(db); const result = await api.loadConsoleLibraryPage(h.context); assert.equal(result.page.items[0].contextStatus, 'unavailable'); assert.equal(h.signs.length, 0); }
});

test('exact run/approval/workflow joins fail closed on missing counts, caps, failures and foreign rows', async () => {
  for (const table of ['creative_runs', 'creative_approvals', 'workflow_runs']) {
    for (const opts of [{ counts: { [table]: null } }, { cap: { [table]: 0 } }, { failTable: table }, { throwTable: table }, { duplicate: table }, { transport: (name, result) => name === table ? { ...result, data: result.data.map(row => ({ ...row, business_id: other })) } : result }]) {
      const h = fixture(seed(2), opts), result = await api.loadConsoleLibraryPage(h.context);
      assert.equal(result.page.items.length, 2); assert.ok(result.page.items.every(row => row.contextStatus === 'unavailable' && row.workIdentity === null && row.signedUrl === null)); assert.equal(h.signs.length, 0); assert.ok(result.errors.length);
    }
  }
  const db = seed(1); db.creative_approvals[0].candidate_id = id(8888); const h = fixture(db), result = await api.loadConsoleLibraryPage(h.context);
  assert.equal(result.page.items[0].workIdentity, null); assert.equal(h.signs.length, 0);
});

test('missing legacy artifact pointer preserves owned asset preview and verified run link', async () => {
  for (const missing of [undefined, null]) {
    const db = seed(1); db.creative_assets[0].artifact_id = missing; const h = fixture(db), result = await api.loadConsoleLibraryPage(h.context, { selectedId: db.creative_assets[0].id });
    assert.equal(result.selection.status, 'found'); assert.equal(result.selection.item.previewStatus, 'ready'); assert.equal(result.selection.item.status, 'completed'); assert.equal(result.selection.item.artifactStatus, 'missing');
    assert.equal(result.selection.item.workIdentity.workflowRunId, db.workflow_runs[0].id); assert.equal(result.selection.item.workIdentity.artifactId, null); assert.equal(h.signs[0].length, 1);
    assert.ok(!h.calls.some(call => call.table === 'artifacts'));
  }
});

test('Work artifact link requires artifact identity and matching Business/workflow; preview is separate', async () => {
  for (const mutate of [row => { row.workflow_run_id = id(9999); }, row => { row.business_id = other; }, row => { row.id = id(9999); }]) {
    const db = seed(1); mutate(db.artifacts[0]); const h = fixture(db), result = await api.loadConsoleLibraryPage(h.context, { selectedId: db.creative_assets[0].id });
    assert.equal(result.selection.status, 'found'); assert.equal(result.selection.item.workIdentity.workflowRunId, db.workflow_runs[0].id); assert.equal(result.selection.item.workIdentity.artifactId, null); assert.equal(result.selection.item.artifactStatus, 'unavailable'); assert.equal(result.selection.item.previewStatus, 'ready');
  }
  const db = seed(1); db.artifacts[0].checksum = 'b'.repeat(64); const result = await api.loadConsoleLibraryPage(fixture(db).context, { selectedId: db.creative_assets[0].id });
  assert.equal(result.selection.item.artifact.status, 'unavailable'); assert.equal(result.selection.item.workIdentity.artifactId, null); assert.equal(result.selection.item.previewStatus, 'ready');
  assert.equal(Object.hasOwn(result.selection.item, 'productionReady'), false); assert.equal(Object.hasOwn(result.selection.item, 'downloadVerified'), false);
});

function sixReceipts() {
  const db = seed(1), phase = db.creative_phase_outputs[0], reservation = db.creative_cost_reservations[0], settlement = db.creative_cost_settlements[0];
  db.creative_phase_outputs = keys.map((call_key, n) => ({ ...phase, call_key, artifact_id: id(30000 + n), output: { phase: call_key } }));
  db.creative_cost_reservations = keys.map(call_key => ({ ...reservation, call_key }));
  db.creative_cost_settlements = keys.map((call_key, n) => ({ ...settlement, call_key, provider_request_id: `receipt-${call_key}`, reported_microusd: n * 100 }));
  return db;
}
test('composite phase/cost receipts are bound by Business/run/call key, independent of response ordering', async () => {
  const db = sixReceipts(), runId = db.creative_runs[0].id;
  const first = await api.loadConsoleLibraryRunDetail(fixture(db).context, runId);
  const h = fixture(db, { reverse: ['creative_phase_outputs', 'creative_cost_reservations', 'creative_cost_settlements'] }), second = await api.loadConsoleLibraryRunDetail(h.context, runId);
  assert.equal(second.outputs.status, 'ready'); assert.equal(second.outputs.records.length, 6); assert.equal(second.costs.status, 'ready'); assert.deepEqual(second.costs.records, first.costs.records);
  for (const [n, key] of keys.entries()) { assert.equal(second.outputs.records.find(row => row.call_key === key).output.phase, key); assert.equal(second.costs.records.find(row => row.call_key === key).reported_microusd, n * 100); }
  assert.equal(h.signs.length, 0);
  for (const table of ['creative_phase_outputs', 'creative_cost_reservations', 'creative_cost_settlements']) {
    const h = fixture(db, { duplicate: table }), result = await api.loadConsoleLibraryRunDetail(h.context, runId);
    assert.equal(table === 'creative_phase_outputs' ? result.outputs.status : result.costs.status, 'unavailable'); assert.equal(result.complete, false);
    assert.equal(h.calls.find(call => call.table === table).limit, 7);
  }
});

test('bounded phase/cost/review windows reject bad counts, truncation, foreign keys, duplicate requests and unknown charges', async () => {
  for (const table of ['creative_phase_outputs', 'creative_cost_reservations', 'creative_cost_settlements', 'creative_reviews', 'creative_assets']) {
    for (const opts of [{ counts: { [table]: null } }, { cap: { [table]: 0 } }, { failTable: table }, { throwTable: table }, { duplicate: table }, { transport: (name, result) => name === table ? { ...result, data: result.data.map(row => ({ ...row, creative_run_id: id(99999) })) } : result }]) {
      const db = seed(1), h = fixture(db, opts), result = await api.loadConsoleLibraryRunDetail(h.context, db.creative_runs[0].id);
      const status = table === 'creative_phase_outputs' ? result.outputs.status : table === 'creative_reviews' ? result.reviews.status : table === 'creative_assets' ? result.assets.status : result.costs.status;
      assert.equal(status, 'unavailable'); assert.equal(result.complete, false);
    }
  }
  const duplicate = sixReceipts(); duplicate.creative_cost_settlements[1].provider_request_id = duplicate.creative_cost_settlements[0].provider_request_id;
  assert.equal((await api.loadConsoleLibraryRunDetail(fixture(duplicate).context, duplicate.creative_runs[0].id)).costs.status, 'unavailable');
  for (const [table, field, value] of [['creative_cost_settlements', 'reported_microusd', -1], ['creative_cost_settlements', 'reported_microusd', undefined], ['creative_cost_reservations', 'reserved_microusd', '100'], ['creative_phase_outputs', 'call_key', 'generate:3'], ['creative_phase_outputs', 'workflow_run_id', id(999)]]) {
    const db = seed(1); db[table][0][field] = value; const result = await api.loadConsoleLibraryRunDetail(fixture(db).context, db.creative_runs[0].id); assert.equal(result.complete, false); assert.equal(table === 'creative_phase_outputs' ? result.outputs.status : result.costs.status, 'unavailable');
  }
});

test('paid failure with no asset retains its receipt, uncertain reservation and exact failed execution', async () => {
  const db = seed(1); db.creative_assets = []; db.creative_reviews = []; db.creative_phase_outputs = []; db.workflow_runs[0].status = 'failed';
  db.creative_cost_settlements[0].reported_microusd = null; db.creative_cost_settlements[0].receipt = { outputValidated: false, sourcePreservation: { storagePath: `${business}/${db.creative_runs[0].id}/version-1.original.webp`, mediaType: 'image/webp', bytes: 128, sha256: hash, uploadConfirmed: true, downloadVerified: false } };
  const h = fixture(db), result = await api.loadConsoleLibraryRunDetail(h.context, db.creative_runs[0].id);
  assert.equal(result.selection.status, 'found'); assert.equal(result.workflow.item.status, 'failed'); assert.equal(result.assets.total, 0); assert.equal(result.costs.status, 'ready'); assert.equal(result.costs.records.length, 1); assert.equal(result.costs.records[0].reported_microusd, null); assert.equal(result.costs.records[0].reserved_microusd, 1500); assert.equal(result.costs.settlements[0].receipt.outputValidated, false); assert.equal(h.signs.length, 0);
  db.creative_cost_settlements = []; const pending = await api.loadConsoleLibraryRunDetail(fixture(db).context, db.creative_runs[0].id); assert.equal(pending.costs.records[0].settled_at, null); assert.equal(pending.costs.records[0].reported_microusd, null);
  const late = seed(1); late.creative_cost_reservations = []; const receiptOnly = await api.loadConsoleLibraryRunDetail(fixture(late).context, late.creative_runs[0].id); assert.equal(receiptOnly.costs.records[0].reserved_microusd, null); assert.equal(receiptOnly.costs.records[0].reported_microusd, 1200);
});

test('foreign/traversal storage paths and tampered provenance are never signed', async () => {
  for (const path of [`${other}/${id(2000)}/version-1.png`, `${business}/${id(9999)}/version-1.png`, `${business}/${id(2000)}/../version-1.png`, `${business}/${id(2000)}/%2e%2e/version-1.png`, `https://evil.invalid/source.png`, `${business}/${id(2000)}/version-2.png`, `${business}/${id(2000)}/version-1.original.webp`]) {
    const db = seed(1); db.creative_assets[0].storage_path = path; const h = fixture(db), result = await api.loadConsoleLibraryPage(h.context);
    assert.equal(result.page.items[0].previewStatus, 'unavailable'); assert.match(result.page.items[0].previewReason, /path/); assert.equal(h.signs.length, 0);
  }
  for (const change of [{ normalizedStoragePath: 'foreign/path' }, { originalStoragePath: '../original.webp' }, { normalizedSha256: 'b'.repeat(64) }, { originalBytes: 7000001 }, { width: undefined }]) {
    const db = seed(1); Object.assign(db.creative_phase_outputs[0].output.provenance, change); const h = fixture(db), result = await api.loadConsoleLibraryPage(h.context, { selectedId: db.creative_assets[0].id });
    assert.equal(result.selection.item.provenance, null); assert.equal(result.selection.item.previewStatus, 'unavailable'); assert.equal(h.signs.length, 0);
  }
});

test('valid WebP provenance prefers the one normalized PNG and never signs the original too', async () => {
  const db = seed(30), asset = db.creative_assets[0], provenance = db.creative_phase_outputs[0].output.provenance;
  Object.assign(provenance, { providerMediaType: 'image/webp', detectedMediaType: 'image/webp', originalSha256: 'b'.repeat(64), conversion: 'lossless_webp_to_png', verification: 'decoded_pixels_equal', decodedPixelSha256: hash, normalizedDecodedPixelSha256: hash, decodedChannels: 4, decodedHasAlpha: true, encoder: 'fixture.png', originalStoragePath: asset.storage_path.replace('.png', '.original.webp') });
  const h = fixture(db), result = await api.loadConsoleLibraryPage(h.context, { selectedId: asset.id });
  assert.equal(result.selection.item.provenance.detectedMediaType, 'image/webp'); assert.equal(result.selection.item.previewStatus, 'ready'); assert.equal(h.signs[0].length, 26); assert.ok(h.signs[0].every(path => !path.includes('.original.webp')));
});

test('malformed, foreign, duplicate or failed signing responses cannot become trusted previews', async () => {
  for (const signResult of [() => ({ data: null, error: true }), data => ({ data: [...data, data[0]], error: null }), data => ({ data: [{ ...data[0], path: 'foreign/path' }], error: null }), data => ({ data: data.map(row => ({ ...row, signedUrl: 'javascript:alert(1)' })), error: null }), data => ({ data: data.map(row => ({ ...row, error: 'unavailable' })), error: null }), () => { throw Error('offline'); }]) {
    const h = fixture(seed(1), { signResult }), result = await api.loadConsoleLibraryPage(h.context);
    assert.equal(result.page.items[0].signedUrl, null); assert.equal(result.page.items[0].previewStatus, 'unavailable'); assert.ok(result.errors.length);
  }
});

test('actual reader dependency graph has no providers, credentials, mutations, RPC launches or network', async () => {
  const h = fixture(seed(1)); await api.loadConsoleLibraryPage(h.context, { selectedId: h.db.creative_assets[0].id }); await api.loadConsoleLibraryRecordsPage(h.context, { selectedId: h.db.artifacts[0].id }); await api.loadConsoleLibraryRunDetail(h.context, h.db.creative_runs[0].id);
  assert.deepEqual(h.forbidden, []);
  const source = readFileSync('src/lib/core-ui/console-library-data.ts', 'utf8');
  assert.ok(!/\.rpc\(|\.auth\.|service_role|process\.env|fetch\(|\.insert\(|\.update\(|\.upload\(|\.delete\(|\.schema\(/.test(source));
});

test('microsecond timestamp ordering does not collapse distinct saved instants into ID ties', async () => {
  const db = seed(2);
  db.creative_assets[0].generated_at = '2026-10-02T00:00:00.000002Z'; db.creative_assets[1].generated_at = '2026-10-02T00:00:00.000001Z';
  db.artifacts[0].created_at = '2026-10-02T00:00:00.000002Z'; db.artifacts[1].created_at = '2026-10-02T00:00:00.000001Z';
  for (const reader of [api.loadConsoleLibraryPage, api.loadConsoleLibraryRecordsPage]) for (const sort of ['newest', 'oldest']) {
    const result = await reader(fixture(db).context, { sort }); assert.equal(result.page.complete, true); assert.equal(result.page.items.length, 2);
  }
});

test('conflicting immutable selection metadata cannot be spliced into detail or used for signing', async () => {
  const db = seed(1), selectedId = db.creative_assets[0].id;
  const h = fixture(db, { transport: (table, result, call) => table === 'creative_assets' && call.range ? { ...result, data: result.data.map(row => ({ ...row, prompt: 'conflicting persisted prompt' })) } : result });
  const result = await api.loadConsoleLibraryPage(h.context, { selectedId });
  assert.equal(result.selection.status, 'unavailable'); assert.equal(result.page.complete, false); assert.equal(h.signs.length, 0); assert.ok(result.errors.some(message => /conflict/.test(message)));
  const different = fixture(db, { transport: (table, result, call) => table === 'creative_runs' && call.columns.includes('catalog_snapshot') ? { ...result, data: result.data.map(row => ({ ...row, workflow_run_id: id(9999) })) } : result });
  const conflict = await api.loadConsoleLibraryPage(different.context, { selectedId });
  assert.equal(conflict.selection.status, 'found'); assert.equal(conflict.selection.item.contextStatus, 'unavailable'); assert.equal(conflict.selection.item.workIdentity, null); assert.equal(conflict.selection.item.previewStatus, 'unavailable'); assert.equal(different.signs.length, 0);
});

test('explicit creativeRun URL identity is designs-only, exclusive, and never aliases Work/asset identity', () => {
  const runId = id(2000);
  assert.equal(query.consoleLibraryOptionsFromSearch({ view: 'library', creativeRun: runId }).creativeRunId, runId);
  assert.equal(query.consoleLibraryQuery('designs', { creativeRunId: runId }).selectedId, null);
  assert.equal(query.consoleLibraryQuery('designs', { creativeRunId: runId }).creativeRunId, runId);
  for (const input of [{ creativeRun: 'bad' }, { creativeRun: [runId, runId] }, { creativeRun: runId, selected: id(1000) }, { creativeRun: runId, artifact: id(6000) }, { creativeRun: runId, run: id(4000) }, { creativeRun: runId, decision: id(9) }, { type: 'records', creativeRun: runId }]) assert.throws(() => query.consoleLibraryOptionsFromSearch(input));
  assert.throws(() => query.consoleLibraryQuery('records', { creativeRunId: runId }));
  assert.throws(() => query.consoleLibraryQuery('designs', { creativeRunId: runId, selectedId: id(1000) }));
  const current = new URLSearchParams({ view: 'library', page: '4', q: 'kept filter', sort: 'oldest', selected: id(1000) });
  const opened = new URL(query.consoleLibraryHref(current, { creativeRun: runId }), 'https://fixture').searchParams;
  assert.equal(opened.get('creativeRun'), runId); assert.equal(opened.get('selected'), null); assert.equal(opened.get('business'), null); assert.equal(opened.get('page'), '4'); assert.equal(opened.get('q'), 'kept filter');
  const closed = new URL(query.consoleLibraryHref(opened, { creativeRun: null }), 'https://fixture').searchParams;
  assert.equal(closed.get('creativeRun'), null); assert.equal(closed.get('page'), '4'); assert.equal(closed.get('business'), null); assert.equal(closed.get('q'), 'kept filter');
  const asset = new URL(query.consoleLibraryHref(opened, { selected: id(1000) }), 'https://fixture').searchParams;
  assert.equal(asset.get('creativeRun'), null); assert.equal(asset.get('page'), '4');
});

test('exact no-asset paid history remains visible independently of the current design page and search', async () => {
  const db = seed(131), run = db.creative_runs[0]; db.creative_assets.shift(); db.creative_reviews.shift(); db.creative_phase_outputs.shift(); db.workflow_runs[0].status = 'failed'; db.creative_cost_settlements[0].reported_microusd = null;
  const h = fixture(db), result = await api.loadConsoleLibraryPage(h.context, { creativeRunId: run.id, query: 'does not match any prompt', page: 4 });
  assert.equal(result.page.total, 0); assert.equal(result.page.complete, true); assert.equal(result.page.page, 4); assert.equal(result.selection.status, 'none');
  assert.equal(result.runDetail.selection.status, 'found'); assert.equal(result.runDetail.selection.item.id, run.id); assert.equal(result.runDetail.workflow.item.status, 'failed'); assert.equal(result.runDetail.costs.records[0].reported_microusd, null); assert.equal(result.runDetail.assets.total, 0); assert.equal(h.signs.length, 0);
  const withPage = await api.loadConsoleLibraryPage(h.context, { creativeRunId: run.id, query: 'Duplicate', page: 3 });
  assert.equal(withPage.page.total, 130); assert.equal(withPage.page.items.length, 25); assert.equal(withPage.selection.status, 'none'); assert.equal(withPage.runDetail.selection.item.id, run.id); assert.equal(h.signs.at(-1).length, 25);
});

test('missing, foreign, unavailable and incorrect exact creativeRun selections never substitute history', async () => {
  const db = seed(1), runId = db.creative_runs[0].id;
  for (const [options, expected] of [[{ businessId: other, creativeRunId: runId }, 'missing'], [{ creativeRunId: id(9999) }, 'missing']]) {
    const result = await api.loadConsoleLibraryPage(fixture(db).context, options); assert.equal(result.selection.status, 'none'); assert.equal(result.runDetail.selection.status, expected); assert.equal(result.runDetail.selection.item, null);
  }
  const h = fixture(db, { transport: (table, result, call) => table === 'creative_runs' && call.columns.includes('catalog_snapshot') ? { ...result, count: null } : result });
  const result = await api.loadConsoleLibraryPage(h.context, { creativeRunId: runId }); assert.equal(result.runDetail.selection.status, 'unavailable'); assert.equal(result.runDetail.selection.item, null); assert.equal(result.selection.status, 'none'); assert.equal(result.page.items.length, 1);
  const empty = fixture(db); empty.context.businesses = []; const none = await api.loadConsoleLibraryPage(empty.context, { creativeRunId: runId }); assert.equal(none.runDetail.selection.status, 'missing'); assert.equal(empty.calls.length, 0);
});

test('failed or foreign exact run/approval/workflow snapshots suppress selected preview and preserve verified run navigation', async () => {
  for (const [table, field] of [['creative_runs', 'catalog_snapshot'], ['creative_approvals', 'snapshot'], ['workflow_runs', 'input']]) for (const fail of [true, false]) {
    const db = seed(1), h = fixture(db, { transport: (name, result, call) => name === table && call.columns.split(',').includes(field) ? fail ? { data: null, count: null, error: true } : { ...result, data: result.data.map(row => ({ ...row, business_id: other })) } : result });
    const result = await api.loadConsoleLibraryPage(h.context, { selectedId: db.creative_assets[0].id });
    assert.equal(result.selection.status, 'found'); assert.equal(result.selection.item.contextStatus, 'unavailable'); assert.equal(result.selection.item.previewStatus, 'unavailable'); assert.equal(result.selection.item.signedUrl, null); assert.equal(h.signs.length, 0);
    assert.equal(result.selection.item.workIdentity.workflowRunId, db.workflow_runs[0].id); assert.equal(result.selection.item.complete, false);
  }
});

test('signed URLs must bind exact configured origin, base path, private bucket and normalized object', async () => {
  for (const rewrite of [url => url.replace('storage.fixture', 'unrelated.invalid'), url => url.replace('/creative-assets/', '/another-bucket/'), url => url.replace('/proxy/', '/different/'), url => url.replace('version-1.png', 'version-2.png'), url => url.replace('version-1.png', 'version-1.original.webp'), url => url.replace('/object/sign/', '/object/public/'), url => url.replace('?token=fixture', ''), url => `${url}&token=duplicate`, url => `${url}#fragment`, url => url.replace('https://', 'https://user:password@')]) {
    const h = fixture(seed(1), { signResult: data => ({ data: data.map(row => ({ ...row, signedUrl: rewrite(row.signedUrl) })), error: null }) });
    const result = await api.loadConsoleLibraryPage(h.context); assert.equal(result.page.items[0].signedUrl, null); assert.equal(result.page.items[0].previewStatus, 'unavailable'); assert.ok(result.errors.length);
  }
  const valid = await api.loadConsoleLibraryPage(fixture(seed(1)).context); assert.equal(valid.page.items[0].previewStatus, 'ready'); assert.match(valid.page.items[0].signedUrl, /^https:\/\/storage\.fixture\/proxy\/storage\/v1\/object\/sign\/creative-assets\//);
});

test('selected provenance must match inspection, declared media, encoder and WebP channel/alpha invariants', async () => {
  for (const patch of [{ providerMediaType: 'image/webp' }, { width: 1 }, { height: 1 }, { normalizedBytes: 129 }, { encoder: 'invented-encoder' }, { decoder: 'bad decoder!' }]) {
    const db = seed(1); Object.assign(db.creative_phase_outputs[0].output.provenance, patch); const h = fixture(db), result = await api.loadConsoleLibraryPage(h.context, { selectedId: db.creative_assets[0].id });
    assert.equal(result.selection.item.provenance, null); assert.equal(result.selection.item.complete, false); assert.equal(result.selection.item.previewStatus, 'unavailable'); assert.equal(h.signs.length, 0);
  }
  for (const patch of [{ decodedChannels: 3 }, { decodedHasAlpha: false }, { encoder: null }]) {
    const db = seed(1), source = db.creative_phase_outputs[0].output.provenance;
    Object.assign(source, { providerMediaType: 'image/webp', detectedMediaType: 'image/webp', originalSha256: 'b'.repeat(64), conversion: 'lossless_webp_to_png', verification: 'decoded_pixels_equal', decodedPixelSha256: hash, normalizedDecodedPixelSha256: hash, decodedChannels: 4, decodedHasAlpha: true, encoder: 'fixture.png', originalStoragePath: db.creative_assets[0].storage_path.replace('.png', '.original.webp') }, patch);
    const result = await api.loadConsoleLibraryPage(fixture(db).context, { selectedId: db.creative_assets[0].id }); assert.equal(result.selection.item.provenance, null); assert.equal(result.selection.item.previewStatus, 'unavailable');
  }
});

test('the visible selected row cannot sign around its unavailable or missing independent asset read', async () => {
  for (const missing of [true, false]) {
    const db = seed(1), h = fixture(db, { transport: (table, result, call) => table === 'creative_assets' && call.columns.split(',').includes('inspection') ? missing ? { data: [], count: 0, error: null } : { data: null, count: null, error: true } : result });
    const result = await api.loadConsoleLibraryPage(h.context, { selectedId: db.creative_assets[0].id });
    assert.equal(result.selection.status, missing ? 'missing' : 'unavailable'); assert.equal(result.page.items.length, 1); assert.equal(result.page.items[0].previewStatus, 'unavailable'); assert.equal(result.page.items[0].contextStatus, 'unavailable'); assert.equal(h.signs.length, 0); assert.equal(result.page.items[0].workIdentity.workflowRunId, db.workflow_runs[0].id);
  }
});

test('unavailable or foreign phase window blocks exact selected previews, unlike count-checked legacy absence', async () => {
  for (const fail of [true, false]) {
    const db = seed(1), h = fixture(db, { transport: (table, result) => table === 'creative_phase_outputs' ? fail ? { data: null, count: null, error: true } : { ...result, data: result.data.map(row => ({ ...row, creative_run_id: id(99999) })) } : result });
    const result = await api.loadConsoleLibraryPage(h.context, { selectedId: db.creative_assets[0].id });
    assert.equal(result.selection.status, 'found'); assert.equal(result.selection.item.runDetail.outputs.status, 'unavailable'); assert.equal(result.selection.item.previewStatus, 'unavailable'); assert.equal(result.selection.item.contextStatus, 'unavailable'); assert.equal(h.signs.length, 0); assert.equal(result.selection.item.workIdentity.workflowRunId, db.workflow_runs[0].id);
  }
  const db = seed(1); db.creative_phase_outputs = []; const legacy = await api.loadConsoleLibraryPage(fixture(db).context, { selectedId: db.creative_assets[0].id });
  assert.equal(legacy.selection.item.provenance, null); assert.equal(legacy.selection.item.complete, false); assert.equal(legacy.selection.item.runDetail.outputs.status, 'ready'); assert.equal(legacy.selection.item.previewStatus, 'ready'); assert.ok(legacy.selection.item.errors.some(message => /generation output is unavailable/.test(message)));
});

test('validated completedAt distinguishes ended needs_owner from open running without losing saved status', async () => {
  const db = seed(2); db.workflow_runs[0].status = 'needs_owner'; db.workflow_runs[0].completed_at = stamp; db.workflow_runs[1].status = 'running'; db.workflow_runs[1].completed_at = null;
  const result = await api.loadConsoleLibraryPage(fixture(db).context);
  const ended = result.page.items.find(row => row.creative_run_id === db.creative_runs[0].id), running = result.page.items.find(row => row.creative_run_id === db.creative_runs[1].id);
  assert.equal(ended.status, 'needs_owner'); assert.equal(ended.completedAt, stamp); assert.equal(running.status, 'running'); assert.equal(running.completedAt, null);
  const unavailable = await api.loadConsoleLibraryPage(fixture(db, { failTable: 'workflow_runs' }).context); assert.ok(unavailable.page.items.every(row => row.completedAt === undefined));
  const partial = await api.loadConsoleLibraryPage(fixture(db, { transport: (table, result, call) => table === 'workflow_runs' && call.columns.includes('input') ? { data: null, count: null, error: true } : result }).context, { selectedId: db.creative_assets[0].id });
  assert.equal(partial.selection.item.completedAt, undefined); assert.equal(partial.selection.item.status, 'needs_owner');
});

test('exact creative history round-trips workflow backlinks, approval hash and registered definition', async () => {
  for (const patch of [{ creativeRunId: id(99999) }, { creativeRunId: undefined }, { approvalId: id(99999) }, { approvalHash: 'b'.repeat(64) }, { approvalHash: undefined }]) {
    const db = seed(1); Object.assign(db.workflow_runs[0].input, patch); const result = await api.loadConsoleLibraryRunDetail(fixture(db).context, db.creative_runs[0].id);
    assert.equal(result.selection.status, 'found'); assert.equal(result.workflow.status, 'unavailable'); assert.equal(result.complete, false); assert.equal(result.costs.records.length, 1);
  }
  for (const patch of [{ workflow_key: 'unrelated.workflow' }, { version: '2.0.0' }, { id: id(99999) }, { status: undefined }]) {
    const db = seed(1); Object.assign(db.workflow_definitions[0], patch); const result = await api.loadConsoleLibraryRunDetail(fixture(db).context, db.creative_runs[0].id);
    assert.equal(result.workflow.status, 'unavailable'); assert.equal(result.complete, false); assert.equal(result.costs.status, 'ready');
  }
  for (const options of [{ counts: { workflow_definitions: null } }, { cap: { workflow_definitions: 0 } }, { duplicate: 'workflow_definitions' }, { failTable: 'workflow_definitions' }, { throwTable: 'workflow_definitions' }]) {
    const db = seed(1), h = fixture(db, options), result = await api.loadConsoleLibraryPage(h.context, { selectedId: db.creative_assets[0].id });
    assert.equal(result.selection.item.runDetail.workflow.status, 'unavailable'); assert.equal(result.selection.item.contextStatus, 'unavailable'); assert.equal(result.selection.item.previewStatus, 'unavailable'); assert.equal(h.signs.length, 0);
    assert.equal(h.calls.find(call => call.table === 'workflow_definitions').limit, 2);
  }
  const db = seed(1); db.workflow_definitions[0].status = 'retired'; const h = fixture(db), historical = await api.loadConsoleLibraryRunDetail(h.context, db.creative_runs[0].id);
  assert.equal(historical.workflow.status, 'found', 'historical inspection does not require new execution qualification'); assert.equal(historical.complete, true);
  const definitionReads = h.calls.filter(call => call.table === 'workflow_definitions'); assert.equal(definitionReads.length, 1); assert.equal(definitionReads[0].limit, 2); assert.ok(definitionReads[0].filters.some(filter => filter[0] === 'eq' && filter[1] === 'id' && filter[2] === db.workflow_runs[0].workflow_definition_id));
});

test('Library query canonicalizes mixed-case UUIDs and compares artifact aliases by UUID identity', () => {
  const lower = 'abcdefab-cdef-4abc-8def-abcdefabcdef', mixed = 'AbCdEfAb-CdEf-4AbC-8dEf-AbCdEfAbCdEf', different = 'abcdefab-cdef-4abc-8def-abcdefabcdee';
  const selected = query.consoleLibraryQuery('designs', { businessId: mixed, selectedId: mixed }); assert.equal(selected.businessId, lower); assert.equal(selected.selectedId, lower);
  const run = query.consoleLibraryQuery('designs', { businessId: mixed, creativeRunId: mixed }); assert.equal(run.creativeRunId, lower); assert.equal(run.businessId, lower);
  const alias = query.consoleLibraryOptionsFromSearch({ type: 'records', business: mixed, selected: mixed, artifact: lower.toUpperCase() }); assert.equal(alias.businessId, lower); assert.equal(alias.selectedId, lower);
  assert.equal(query.consoleLibraryOptionsFromSearch({ creativeRun: mixed }).creativeRunId, lower);
  assert.throws(() => query.consoleLibraryOptionsFromSearch({ type: 'records', selected: mixed, artifact: different.toUpperCase() }), /Conflicting Library identity/);
  assert.throws(() => query.consoleLibraryOptionsFromSearch({ selected: mixed, creativeRun: lower }), /Conflicting Library identity/);
});

test('direct asset, record and creative-run readers use canonical UUIDs throughout exact transport', async () => {
  const db = JSON.parse(JSON.stringify(seed(1)).replaceAll('93000000', 'abcdefab'));
  const make = () => { const h = fixture(db); h.context.businesses = h.context.businesses.map(row => ({ ...row, id: row.id.replace('93000000', 'abcdefab') })); return h; };
  const businessId = db.creative_runs[0].business_id, runId = db.creative_runs[0].id, assetId = db.creative_assets[0].id, artifactId = db.artifacts[0].id;
  const assets = await api.loadConsoleLibraryPage(make().context, { businessId: businessId.toUpperCase(), selectedId: assetId.toUpperCase() }); assert.equal(assets.selection.status, 'found'); assert.equal(assets.selection.item.id, assetId); assert.equal(assets.selection.item.contextStatus, 'verified');
  const records = await api.loadConsoleLibraryRecordsPage(make().context, query.consoleLibraryOptionsFromSearch({ type: 'records', business: businessId.toUpperCase(), selected: artifactId.toUpperCase(), artifact: artifactId })); assert.equal(records.selection.status, 'found'); assert.equal(records.selection.item.id, artifactId);
  const h = make(), detail = await api.loadConsoleLibraryRunDetail(h.context, runId.toUpperCase(), { businessId: businessId.toUpperCase() }); assert.equal(detail.selection.status, 'found'); assert.equal(detail.workflow.status, 'found'); assert.equal(detail.selection.item.id, runId); assert.ok(h.calls[0].filters.some(filter => filter[0] === 'eq' && filter[1] === 'id' && filter[2] === runId));
  const history = await api.loadConsoleLibraryPage(make().context, { businessId: businessId.toUpperCase(), creativeRunId: runId.toUpperCase() }); assert.equal(history.selection.status, 'none'); assert.equal(history.runDetail.selection.status, 'found'); assert.equal(history.query.creativeRunId, runId);
});
