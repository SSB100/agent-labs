import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), ts = require('typescript');
function load(path, dependencies = {}) {
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Forbidden runtime dependency: ${name}`); return dependencies[name];
  }, loaded, loaded.exports);
  return loaded.exports;
}
const collectionQuery = load('src/lib/core-ui/console-collections-query.ts');
const collections = load('src/lib/core-ui/console-collections.ts', { 'server-only': {}, './console-collections-query': collectionQuery });
const query = load('src/lib/core-ui/console-library-query.ts', { './console-collections-query': collectionQuery });
const costs = load('src/creative/cost-display.ts');
const api = load('src/lib/core-ui/console-library-data.ts', { 'server-only': {}, './console-library-query': query, './console-collections': collections, '../../creative/cost-display': costs });
const id = n => `93000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const business = id(1), other = id(2), foreign = id(3), stamp = '2026-10-02T00:00:00.000Z', hash = 'a'.repeat(64), label = 'Duplicate long label '.repeat(35), keys = api.CONSOLE_LIBRARY_PHASE_KEYS;
function seed(count, businessId = business, offset = 0) {
  const db = Object.fromEntries(['creative_assets', 'creative_runs', 'creative_approvals', 'workflow_runs', 'workflow_definitions', 'artifacts', 'creative_phase_outputs', 'creative_reviews', 'creative_cost_reservations', 'creative_cost_settlements'].map(table => [table, []]));
  if (count) db.workflow_definitions.push({ id: id(offset + 20), workflow_key: 'etsy.creative-pipeline', version: '1.0.0', name: 'Etsy Creative Pipeline', description: 'Saved registered creative workflow', status: 'experimental' });
  for (let n = 0; n < count; n++) {
    const assetId = id(offset + 1000 + n), runId = id(offset + 2000 + n), approvalId = id(offset + 3000 + n), workflowId = id(offset + 4000 + n), candidateId = id(offset + 5000 + n), artifactId = id(offset + 6000 + n), path = `${businessId}/${runId}/version-1.png`;
    const inspection = { sha256: hash, failedCriteria: [], width: 512, height: 512, bytes: 128, hasAlpha: true };
    const provenance = { version: 'creative-image-normalization-1.0', providerMediaType: 'image/png', detectedMediaType: 'image/png', originalSha256: hash, normalizedSha256: hash, originalBytes: 128, normalizedBytes: 128, width: 512, height: 512, conversion: 'none', verification: 'byte_identity', decodedPixelSha256: null, normalizedDecodedPixelSha256: null, decodedChannels: null, decodedHasAlpha: null, decoder: 'fixture', encoder: null, originalStoragePath: path, normalizedStoragePath: path };
    const output = { storagePath: path, inspection, provenance };
    db.creative_assets.push({ id: assetId, business_id: businessId, creative_run_id: runId, candidate_id: candidateId, approval_id: approvalId, artifact_id: artifactId, version: 1, brief_hash: hash, asset_hash: hash, storage_path: path, prompt: label, provider: 'openrouter', model: 'saved.model', generated_at: stamp, inspection });
    db.creative_runs.push({ id: runId, business_id: businessId, candidate_id: candidateId, approval_id: approvalId, workflow_run_id: workflowId, capability_expires_at: stamp, created_at: stamp, catalog_snapshot: { saved: true } });
    db.creative_approvals.push({ id: approvalId, business_id: businessId, candidate_id: candidateId, purpose: 'candidate_production', scope_hash: hash, approval_hash: hash, maximum_microusd: 2000, approved_at: stamp, expires_at: stamp, snapshot: { saved: true }, quote: { generatorModel: 'saved.model' } });
    db.workflow_runs.push({ id: workflowId, business_id: businessId, workflow_definition_id: id(offset + 20), status: 'completed', current_stage_key: null, runtime_provider: null, runtime_run_id: null, created_at: stamp, updated_at: stamp, started_at: stamp, completed_at: stamp, input: { creativeRunId: runId, approvalId, approvalHash: hash }, state: { purpose: 'candidate_production', productionReady: false, publicationAllowed: false } });
    db.artifacts.push({ id: artifactId, business_id: businessId, workflow_run_id: workflowId, task_contract_id: null, artifact_type: 'creative.image', name: label, media_type: 'image/png', storage_path: path, content: output, metadata: { saved: true }, checksum: hash, created_at: stamp, updated_at: stamp });
    db.creative_phase_outputs.push({ business_id: businessId, creative_run_id: runId, workflow_run_id: workflowId, call_key: 'generate:1', artifact_id: artifactId, output_hash: hash, created_at: stamp, output });
    db.creative_cost_reservations.push({ business_id: businessId, creative_run_id: runId, call_key: 'generate:1', reserved_microusd: 1500, request_hash: hash, model: 'saved.model', provider: 'openrouter', estimate: { quoted: true }, created_at: stamp });
    db.creative_cost_settlements.push({ business_id: businessId, creative_run_id: runId, call_key: 'generate:1', reported_microusd: 1200, provider_request_id: `fixture-${runId}`, receipt: { outputValidated: true }, created_at: stamp });
    db.creative_reviews.push({ id: id(offset + 7000 + n), business_id: businessId, creative_run_id: runId, asset_id: assetId, artifact_id: id(offset + 8000 + n), brief_hash: hash, asset_hash: hash, review: { assetHash: hash, briefHash: hash, outcome: 'PASS' }, reviewer_model: 'saved.reviewer', created_at: stamp });
  }
  return db;
}
function together(...databases) { return Object.fromEntries(Object.keys(databases[0]).map(table => [table, databases.flatMap(db => db[table])])); }
function fixture(db = seed(1), options = {}) {
  const calls = [], signs = [], forbidden = [];
  const deny = action => () => { forbidden.push(action); throw Error(`Forbidden ${action}`); };
  const client = { rpc: deny('rpc'), auth: new Proxy({}, { get: (_, key) => deny(`auth.${String(key)}`) }), schema: deny('schema'), from(table) {
    assert.ok(Object.hasOwn(db, table), `Unapproved table: ${table}`);
    const call = { table, filters: [], orders: [] }; calls.push(call);
    const builder = {
      select(columns, settings) { assert.equal(settings?.count, 'exact'); assert.ok(!columns.includes('*')); call.columns = columns; return builder; },
      in(key, value) { call.filters.push(['in', key, value]); return builder; }, eq(key, value) { call.filters.push(['eq', key, value]); return builder; },
      ilike(key, value) { call.filters.push(['ilike', key, value]); return builder; },
      order(key, settings) { call.orders.push([key, settings.ascending]); return builder; },
      range(from, to) { call.range = [from, to]; return builder; }, limit(n) { call.limit = n; return builder; },
      insert: deny('insert'), update: deny('update'), delete: deny('delete'), upsert: deny('upsert'),
      then(resolve, reject) {
        assert.ok(call.range ? call.range[1] - call.range[0] === 25 : Number.isSafeInteger(call.limit) && call.limit <= 27, `Unbounded ${table}`);
        if (options.throwTable === table) return Promise.reject(Error('fixture failure')).then(resolve, reject);
        let rows = structuredClone(db[table]);
        if (!options.ignore?.includes(table)) for (const [op, key, value] of call.filters) rows = rows.filter(row => op === 'in' ? value.includes(row[key]) : op === 'eq' ? row[key] === value : String(row[key] ?? '').toLowerCase().includes(value.slice(1, -1).replace(/\\([\\%_])/g, '$1').toLowerCase()));
        rows.sort((a, b) => { for (const [key, asc] of call.orders) { const diff = String(a[key] ?? '').localeCompare(String(b[key] ?? '')); if (diff) return asc ? diff : -diff; } return 0; });
        let count = Object.hasOwn(options.counts ?? {}, table) ? options.counts[table] : rows.length;
        rows = call.range ? rows.slice(call.range[0], call.range[1] + 1) : rows.slice(0, call.limit);
        if (Object.hasOwn(options.cap ?? {}, table)) rows = rows.slice(0, options.cap[table]);
        rows = rows.map(row => Object.fromEntries(call.columns.split(',').filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]])));
        if (options.reverse?.includes(table)) rows.reverse();
        if (options.duplicate === table && rows.length) { rows.push(structuredClone(rows[0])); count++; }
        let result = { data: options.failTable === table ? null : rows, count, error: options.failTable === table ? true : null };
        if (options.transport) result = options.transport(table, result, call);
        call.returned = result.data?.length; call.result = structuredClone(result);
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return builder;
  }, storage: { from(bucket) { assert.equal(bucket, 'creative-assets'); return { upload: deny('upload'), download: deny('download'), remove: deny('storage.remove'), getPublicUrl: path => ({ data: { publicUrl: `https://storage.fixture/proxy/storage/v1/object/public/creative-assets/${path}` } }), createSignedUrls: async (paths, lifetime) => { assert.equal(lifetime, 1200); signs.push([...paths]); const data = paths.map(path => ({ path, signedUrl: `https://storage.fixture/proxy/storage/v1/object/sign/creative-assets/${path}?token=fixture`, error: null })); return options.signResult ? options.signResult(data) : { data, error: null }; } }; } } };
  const context = { businesses: [business, other].map(id => ({ id, name: label, created_at: stamp, updated_at: stamp })), userId: id(10), supabase: client };
  return { context, calls, signs, forbidden, db };
}

export { load, collectionQuery, collections, query, costs, api, id, business, other, foreign, stamp, hash, label, keys, seed, together, fixture };
