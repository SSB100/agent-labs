import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as crypto from 'node:crypto';
const require = createRequire(import.meta.url), ts = require('typescript');
function load(path, dependencies = {}) {
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Forbidden runtime dependency: ${name}`); return dependencies[name];
  }, loaded, loaded.exports);
  return loaded.exports;
}
const collectionQuery = load('src/lib/core-ui/console-collections-query.ts');
const ownerBusiness = load('src/lib/core-ui/owner-business.ts');
const collections = load('src/lib/core-ui/console-collections.ts', { 'server-only': {}, './console-collections-query': collectionQuery, './owner-business': ownerBusiness });
const query = load('src/lib/core-ui/console-research-query.ts', { './console-collections-query': collectionQuery });
const api = load('src/lib/core-ui/console-research-data.ts', { 'server-only': {}, 'node:crypto': crypto, './console-research-query': query, './console-collections': collections });
const id = n => `94000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const business = id(1), other = id(2), foreign = id(3), stamp = '2024-01-01T00:00:00.000001Z', hash = 'a'.repeat(64);
function digest(value) {
  const canonical = v => Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v !== null && typeof v === 'object' ? `{${Object.keys(v).sort().map(key => `${JSON.stringify(key)}:${canonical(v[key])}`).join(',')}}` : JSON.stringify(v);
  return crypto.createHash('sha256').update(canonical(value)).digest('hex');
}
function seed(count, businessId = business, offset = 0) {
  const db = { product_experiments: [], workflow_runs: [], workflow_definitions: [] };
  if (count) db.workflow_definitions.push({ id: id(offset + 20), workflow_key: 'product.discovery-v2.one', version: '1.0.0', name: 'Saved research one', description: 'Registered discovery', status: 'experimental' });
  for (let n = 0; n < count; n++) {
    const rootId = id(offset + 1000 + n), workflowId = id(offset + 2000 + n);
    const intent = { version: 'pod-discovery-2.0', id: rootId, businessId, objective: 'Saved geographic research objective',
      comparisonUniverse: { productType: 'original_pod_tshirt', markets: [{ countryCode: 'GB', currency: 'GBP' }, { countryCode: 'US', currency: 'USD' }], audiences: ['Hikers'], sourceDomains: ['etsy.com'], selectionQuestion: 'Which market supports the saved original design?' },
      limits: { maximumAlternatives: 3, maximumNewCollections: 1, maximumMicrousd: 1000000, maximumGenerations: 1 }, expiresAt: '2025-01-01T00:00:00Z' };
    db.product_experiments.push({ id: rootId, business_id: businessId, workflow_run_id: workflowId, discovery_version: 'pod-discovery-2.0', candidate_id: null, parent_discovery_id: null,
      hypothesis: 'Saved legacy hypothesis', status: 'completed', source_artifact_id: id(offset + 3000 + n), basis_artifact_id: null, created_at: stamp, started_at: stamp, completed_at: stamp,
      variables: { intent, budgetAuthorityRootId: rootId, semanticGoalHash: hash, policyHash: digest(intent), ownerKickoff: { confirmed: true, followUpBasis: null }, budgetQuote: { huge: 'unrequested quote' } },
      measurement_plan: { huge: 'unrequested measurement' }, evidence_pack: { huge: 'unrequested evidence' } });
    db.workflow_runs.push({ id: workflowId, business_id: businessId, workflow_definition_id: id(offset + 20), status: 'completed', current_stage_key: null, runtime_provider: null, runtime_run_id: null,
      created_at: stamp, updated_at: stamp, started_at: stamp, completed_at: stamp, input: { intentId: rootId, huge: 'unrequested input' }, state: { huge: 'unrequested state' } });
  }
  return db;
}
function addAttempts(db, root, count, offset = 100000) {
  let previous = root.id;
  for (let n = 1; n < count; n++) {
    const part = seed(1, root.business_id, offset + n * 10000), row = part.product_experiments[0];
    row.created_at = `2024-01-01T00:00:00.${String(n + 1).padStart(6, '0')}Z`;
    row.variables.budgetAuthorityRootId = root.id;
    row.variables.ownerKickoff.followUpBasis = { rootId: previous, reason: 'Saved historical continuation' };
    row.workflow_run_id = part.workflow_runs[0].id;
    db.product_experiments.push(row); db.workflow_runs.push(...part.workflow_runs); db.workflow_definitions.push(...part.workflow_definitions);
    previous = row.id;
  }
  return db;
}
function together(...databases) { return Object.fromEntries(Object.keys(databases[0]).map(table => [table, databases.flatMap(db => db[table])])); }
function valueAt(row, path) {
  const parts = path.split(/(->>|->)/); let value = row[parts[0]];
  for (let n = 1; n < parts.length; n += 2) {
    value = value && typeof value === 'object' ? value[parts[n + 1]] ?? null : null;
    if (parts[n] === '->>' && value !== null) value = typeof value === 'string' ? value : JSON.stringify(value);
  }
  return parts.length > 1 ? value ?? null : value;
}
function fixture(db = seed(1), options = {}) {
  const calls = [], forbidden = [];
  const deny = name => () => { forbidden.push(name); throw Error(`Forbidden ${name}`); };
  const client = { rpc: deny('rpc'), schema: deny('schema'), auth: new Proxy({}, { get: (_, key) => deny(`auth.${String(key)}`) }), storage: new Proxy({}, { get: (_, key) => deny(`storage.${String(key)}`) }), from(table) {
    assert.ok(table === 'businesses' || Object.hasOwn(db, table), `Unapproved table: ${table}`);
    const call = { table, filters: [], orders: [] }; calls.push(call);
    const builder = {
      select(columns, settings) { if (table === 'businesses') { assert.equal(columns, 'id,name,created_at,updated_at'); assert.equal(settings, undefined); } else assert.equal(settings?.count, 'exact'); assert.ok(!columns.includes('*')); call.columns = columns; return builder; },
      maybeSingle() { assert.equal(table, 'businesses'); call.single = true; return builder; },
      in(key, value) { call.filters.push(['in', key, value]); return builder; }, eq(key, value) { call.filters.push(['eq', key, value]); return builder; },
      is(key, value) { call.filters.push(['is', key, value]); return builder; }, ilike(key, value) { call.filters.push(['ilike', key, value]); return builder; },
      order(key, settings) { call.orders.push([key, settings.ascending]); return builder; }, range(from, to) { call.range = [from, to]; return builder; }, limit(n) { call.limit = n; return builder; },
      insert: deny('insert'), update: deny('update'), delete: deny('delete'), upsert: deny('upsert'),
      then(resolve, reject) {
        if (table === 'businesses') {
          assert.equal(call.single, true); assert.equal(call.range, undefined); assert.equal(call.limit, undefined); assert.deepEqual(call.orders, []);
          assert.equal(call.filters.length, 2); assert.ok(call.filters.some(([op, key, value]) => op === 'eq' && key === 'id' && typeof value === 'string'));
          assert.ok(call.filters.some(([op, key, value]) => op === 'eq' && key === 'owner_user_id' && value === id(10)));
        } else assert.ok(call.range ? call.range[1] - call.range[0] === 25 : call.limit === 2, `Unbounded ${table}`);
        if (options.throwTable === table) return Promise.reject(Error('fixture transport failed')).then(resolve, reject);
        let rows = structuredClone(table === 'businesses' ? options.businessRows ?? [business, other].map(idValue => ({ id: idValue, owner_user_id: id(10), name: 'Independently verified Business', created_at: stamp, updated_at: stamp })) : db[table]);
        for (const [op, key, value] of call.filters) {
          if (options.ignore?.includes(table) || options.ignoreFilter?.(op, key, call)) continue;
          rows = rows.filter(row => op === 'in' ? value.includes(valueAt(row, key)) : op === 'eq' || op === 'is' ? valueAt(row, key) === value : String(valueAt(row, key) ?? '').toLowerCase().includes(value.slice(1, -1).replace(/\\([\\%_])/g, '$1').toLowerCase()));
        }
        rows.sort((a, b) => { for (const [key, asc] of call.orders) { const diff = String(valueAt(a, key) ?? '').localeCompare(String(valueAt(b, key) ?? '')); if (diff) return asc ? diff : -diff; } return 0; });
        let count = Object.hasOwn(options.counts ?? {}, table) ? options.counts[table] : rows.length;
        rows = call.single ? rows : call.range ? rows.slice(call.range[0], call.range[1] + 1) : rows.slice(0, call.limit);
        if (Object.hasOwn(options.cap ?? {}, table)) rows = rows.slice(0, options.cap[table]);
        rows = rows.map(row => Object.fromEntries(call.columns.split(',').flatMap(field => {
          const [alias, path] = field.includes(':') ? field.split(':') : [field, field];
          return path.includes('->') || Object.hasOwn(row, path) ? [[alias, valueAt(row, path)]] : [];
        })));
        if (options.reverse?.includes(table)) rows.reverse();
        if (options.duplicate === table && rows.length) { rows.push(structuredClone(rows[0])); count++; }
        let result = { data: options.failTable === table ? null : call.single ? rows.length === 1 ? rows[0] : null : rows, count: call.single ? null : count, error: options.failTable === table || call.single && rows.length > 1 ? true : null };
        if (options.transport) result = options.transport(table, result, call);
        call.result = structuredClone(result);
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return builder;
  } };
  return { context: { businesses: [business, other].map(id => ({ id, name: 'Fixture Business', created_at: stamp, updated_at: stamp })), userId: id(10), supabase: client }, calls, forbidden, db };
}
export { query, api, id, business, other, foreign, stamp, hash, seed, addAttempts, together, fixture, digest };
