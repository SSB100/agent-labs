import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as crypto from 'node:crypto';
import * as util from 'node:util';
import { api as verifier, fixture as historyFixture, analysisFixture, publicPriorFixture, rebind, rebindEvidence, digest, id, stamp } from './discovery-v2-history-fixtures.mjs';
const require = createRequire(import.meta.url), ts = require('typescript');
function load(path, dependencies = {}) {
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Forbidden runtime dependency: ${name}`); return dependencies[name];
  }, loaded, loaded.exports); return loaded.exports;
}
const collectionQuery = load('src/lib/core-ui/console-collections-query.ts');
const collections = load('src/lib/core-ui/console-collections.ts', { 'server-only': {}, './console-collections-query': collectionQuery });
function adapter(instrument = {}) {
  return load('src/lib/core-ui/console-research-evidence.ts', { 'server-only': {}, 'node:crypto': crypto, 'node:util': util, './console-collections': collections,
    '../../products/discovery-v2-history': { ...verifier, discoveryV2HistoryEvidencePreflight(input) { const value = verifier.discoveryV2HistoryEvidencePreflight(input); instrument.preflight?.(value); return value; } } });
}
function deterministic(value) { const h = crypto.createHash('md5').update(value).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20)}`; }
const copy = value => JSON.parse(JSON.stringify(value));
function twoFixture() {
  const f = historyFixture(), e = copy(f.evidenceRecords[0]), ref = copy(f.dossier.content.packRefs[0]);
  f.experiment.intent.limits.maximumNewCollections = 2; f.workflow.workflow_key = 'product.discovery-v2.two'; f.evidenceRecords[0].workflow.workflow_key = f.workflow.workflow_key;
  e.workflow.workflow_key = f.workflow.workflow_key; e.artifact.id = id(50); e.source.id = id(51); e.query.id = id(52); e.stage.id = id(53);
  e.stage.stage_key = 'research2'; e.artifact.metadata.stageKey = 'research2'; e.source.metadata.stageKey = 'research2'; e.source.content.providerMetadata.queryId = e.query.id;
  e.query.question = 'What preserved second observation changes this geographic comparison?'; e.source.content.query = e.query.question; e.artifact.content.evidencePack.question = e.query.question; e.stage.output = copy(e.artifact.content);
  ref.artifactId = e.artifact.id; ref.query.id = e.query.id; ref.query.question = e.query.question; ref.sha256 = digest(e.artifact.content.evidencePack);
  f.evidenceRecords.push(e); f.dossier.content.packRefs.push(ref); return rebind(f);
}
/** Convert pure verifier fixtures into production-shaped persisted IDs, plans and inputs. */
function prepare(input) {
  const f = copy(input), maps = new Map(), a = f.analysisSource;
  const experiments = [f.experiment, a?.experiment, a?.planExperiment].filter(Boolean);
  const artifacts = [f.dossier, f.strategy?.artifact, f.review?.artifact, a?.dossier, a?.plan, ...f.evidenceRecords.flatMap(e => [e.artifact, e.source])].filter(Boolean);
  for (const root of experiments) if (root.source_artifact_id) maps.set(root.source_artifact_id, deterministic(`discovery:v2:dossier:${root.workflow_run_id}`));
  for (const item of artifacts) {
    if (item.artifact_type === 'product.discovery-dossier.v2') maps.set(item.id, deterministic(`discovery:v2:dossier:${item.workflow_run_id}`));
    else if (item.artifact_type === 'research.sources') maps.set(item.id, deterministic(`research:sources:${item.workflow_run_id}:${item.metadata.stageKey}`));
    else maps.set(item.id, deterministic(`pack:output:${item.workflow_run_id}:${item.metadata.stageKey}`));
  }
  for (const e of f.evidenceRecords) maps.set(e.query.id, e.query.collected_for_intent_id === null ? deterministic(`discovery:v2:prior-query:${maps.get(e.artifact.id)}`) : deterministic(`discovery:v2:query:${e.query.collected_for_intent_id}:${e.stage.stage_key.slice(-1)}`));
  const transform = value => typeof value === 'string' ? maps.get(value) ?? value : Array.isArray(value) ? value.map(transform) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, v]) => [key, transform(v)])) : value;
  const out = transform(f); rebind(out);
  if (out.analysisSource) {
    out.analysisSource.dossier.metadata.contentHash = digest(out.analysisSource.dossier.content);
    out.experiment.analysis_source.dossierHash = digest(out.analysisSource.dossier.content);
  }
  const source = out.analysisSource;
  const allRoots = new Map([out.experiment, source?.experiment, source?.planExperiment].filter(Boolean).map(root => [root.id, root]));
  const allRuns = new Map([out.workflow, source?.workflow, source?.planWorkflow, ...out.evidenceRecords.map(e => e.workflow)].filter(Boolean).map(run => [run.id, run]));
  const plans = [];
  for (const root of allRoots.values()) {
    const run = allRuns.get(root.workflow_run_id); if (!run || run.workflow_key === 'product.discovery-v2.analysis') continue;
    const evidence = out.evidenceRecords.filter(e => e.workflow.id === run.id).sort((a, b) => a.stage.stage_key.localeCompare(b.stage.stage_key));
    const rationale = source?.planExperiment?.id === root.id ? source.plan.content.comparisonRationale : out.dossier.content.comparisonRationale;
    const content = { version: 'pod-discovery-2.0', intentId: root.id, comparisonRationale: rationale,
      queries: evidence.map(e => ({ queryId: e.query.id, ordinal: Number(e.stage.stage_key.slice(-1)), question: e.query.question, sourceDomains: e.query.source_domains })),
      proposals: [{ proposalKey: 'candidate-1', concept: 'Original outdoor illustration', audience: root.intent.comparisonUniverse.audiences[0], hypothesis: 'The saved bounded hypothesis needs further research.', differentiationHypothesis: 'A distinctive original illustration is only a proposal.' }] };
    const artifact = { id: deterministic(`pack:output:${run.id}:plan`), business_id: root.business_id, workflow_run_id: run.id, artifact_type: 'worker.output', media_type: 'application/json', content, metadata: { stageKey: 'plan' } };
    const stage = { id: deterministic(`fixture-stage:${run.id}:plan`), business_id: root.business_id, workflow_run_id: run.id, stage_key: 'plan', attempt: 1, status: 'completed', completed_at: stamp, output: copy(content) };
    plans.push({ artifact, stage });
    if (source?.planExperiment?.id === root.id) {
      source.plan = copy(artifact); source.planStage = copy(stage); out.experiment.analysis_source.planHash = digest(content);
      if (source.experiment.analysis_source) source.experiment.analysis_source.planHash = digest(content);
    }
  }
  return { f: out, plans };
}
function buildDatabase(...prepared) {
  const db = { product_experiments: [], workflow_runs: [], workflow_definitions: [], artifacts: [], workflow_stage_runs: [] };
  function add(table, row) { const existing = db[table].find(item => item.id === row.id); if (existing) assert.deepEqual(row, existing, `Fixture entity disagreement ${table}:${row.id}`); else db[table].push(copy(row)); }
  for (const { f, plans } of prepared) {
    const source = f.analysisSource;
    for (const row of [f.experiment, source?.experiment, source?.planExperiment].filter(Boolean)) {
      const { intent, policy_hash, prior_artifact_ids, prior_evidence_hashes, analysis_source, follow_up_basis, ...rest } = row;
      add('product_experiments', { ...rest, variables: { intent, policyHash: policy_hash, priorArtifactIds: prior_artifact_ids, priorEvidenceHashes: prior_evidence_hashes, analysisSource: analysis_source, ownerKickoff: { followUpBasis: follow_up_basis ?? null } } });
    }
    for (const run of [f.workflow, source?.workflow, source?.planWorkflow, ...f.evidenceRecords.map(e => e.workflow)].filter(Boolean)) {
      const definitionId = deterministic(`definition:${run.workflow_key}:${run.workflow_version}`);
      add('workflow_definitions', { id: definitionId, workflow_key: run.workflow_key, version: run.workflow_version });
      add('workflow_runs', { id: run.id, business_id: run.business_id, workflow_definition_id: definitionId, status: run.status, completed_at: run.completed_at,
        input: run.workflow_key === 'research.public-evidence' ? { question: run.question, sourceDomains: run.source_domains } : { intentId: run.intent_id } });
    }
    for (const item of [f.dossier, f.strategy?.artifact, f.review?.artifact, source?.dossier, source?.plan, ...plans.map(p => p.artifact), ...f.evidenceRecords.flatMap(e => [e.artifact, e.source])].filter(Boolean)) add('artifacts', item);
    for (const stage of [f.strategy?.stage, f.review?.stage, source?.planStage, ...plans.map(p => p.stage), ...f.evidenceRecords.map(e => e.stage)].filter(Boolean)) add('workflow_stage_runs', stage);
    for (const e of f.evidenceRecords.filter(e => e.query.collected_for_intent_id !== null)) add('artifacts', { id: deterministic(`pack:input:${e.workflow.id}:${e.stage.stage_key}`), business_id: e.query.business_id, workflow_run_id: e.workflow.id, artifact_type: 'pack.stage-input', media_type: 'application/json',
      content: { kind: 'research', ordinal: Number(e.stage.stage_key.slice(-1)), queryId: e.query.id, question: e.query.question, sourceDomains: e.query.source_domains, knowledge: { unrequested: 'not projected' } }, metadata: { stageKey: e.stage.stage_key } });
  }
  return db;
}
function make(kind = 'one') {
  const input = kind === 'two' ? twoFixture() : kind === 'public' ? publicPriorFixture() : kind === 'analysis' ? analysisFixture() : kind === 'carried' ? analysisFixture(analysisFixture(historyFixture(100), 300), 500) : historyFixture();
  const prepared = prepare(input); return { ...prepared, db: buildDatabase(prepared) };
}
function valueAt(row, path) {
  const parts = path.split(/(->>|->)/); let value = row[parts[0]];
  for (let n = 1; n < parts.length; n += 2) { value = value && typeof value === 'object' ? value[parts[n + 1]] ?? null : null; if (parts[n] === '->>' && value !== null) value = typeof value === 'string' ? value : JSON.stringify(value); }
  return parts.length > 1 ? value ?? null : value;
}
function transport(db, options = {}) {
  const calls = [], forbidden = [], events = [], deny = name => () => { forbidden.push(name); throw Error(`Forbidden ${name}`); };
  let waves = 0, peak = 0, scheduled = false; const pending = [];
  const response = (call, result) => !options.waves ? Promise.resolve(result) : new Promise(resolve => {
    pending.push({ call, result, resolve });
    if (!scheduled) { scheduled = true; setImmediate(() => { scheduled = false; waves++; const batch = pending.splice(0); peak = Math.max(peak, batch.length); for (const item of batch) { item.call.wave = waves; item.resolve(item.result); } }); }
  });
  const api = adapter({ preflight: result => events.push({ type: 'preflight', result }) });
  const client = { rpc: deny('rpc'), schema: deny('schema'), auth: new Proxy({}, { get: (_, key) => deny(`auth.${String(key)}`) }), storage: new Proxy({}, { get: (_, key) => deny(`storage.${String(key)}`) }), from(table) {
    assert.ok(Object.hasOwn(db, table), `Unapproved table ${table}`); const call = { table, filters: [] }; calls.push(call);
    const q = {
      select(columns, settings) { assert.equal(settings?.count, 'exact'); assert.ok(!columns.includes('*')); call.columns = columns; return q; },
      in(key, value) { call.filters.push(['in', key, value]); return q; }, eq(key, value) { call.filters.push(['eq', key, value]); return q; }, limit(n) { assert.equal(n, 2); call.limit = n; return q; },
      order: deny('order'), range: deny('range'), insert: deny('insert'), update: deny('update'), delete: deny('delete'), upsert: deny('upsert'),
      then(resolve, reject) {
        assert.equal(call.limit, 2); events.push({ type: 'read', call });
        if (options.throwWhen?.(call)) return Promise.reject(Error('offline')).then(resolve, reject);
        let rows = copy(db[table]);
        for (const [op, key, value] of call.filters) if (!options.ignore?.(call, key)) rows = rows.filter(row => op === 'in' ? value.includes(valueAt(row, key)) : valueAt(row, key) === value);
        const count = rows.length; rows = rows.slice(0, 2).map(row => Object.fromEntries(call.columns.split(',').flatMap(field => {
          const [alias, path] = field.includes(':') ? field.split(':') : [field, field]; return path.includes('->') || Object.hasOwn(row, path) ? [[alias, valueAt(row, path)]] : [];
        })));
        let result = { data: rows, count, error: null }; if (options.change) result = options.change(call, result);
        call.result = copy(result); return response(call, result).then(resolve, reject);
      },
    }; return q;
  } };
  const context = { businesses: [id(1), id(2)].map(id => ({ id, name: 'Fixture Business' })), supabase: client, userId: id(9) };
  return { api, context, calls, events, forbidden, db, get waves() { return waves; }, get peak() { return peak; } };
}
export { verifier, id, stamp, digest, deterministic, copy, prepare, buildDatabase, make, transport, historyFixture, analysisFixture, twoFixture, rebind, rebindEvidence };
