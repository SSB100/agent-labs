import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { verifier, id, digest, deterministic, copy, prepare, buildDatabase, make, transport, historyFixture, analysisFixture, rebind } from './helpers/console-research-evidence-fixtures.mjs';
const oldFetch = globalThis.fetch;
test.before(() => { globalThis.fetch = () => { throw Error('All networking denied'); }; });
test.after(() => { globalThis.fetch = oldFetch; });
const options = f => ({ experimentId: f.experiment.id, observedAt: f.observedAt });
const exactId = call => call.filters.find(f => f[1] === 'id')?.[2];
const contents = call => call.table === 'artifacts' && call.columns.split(',').includes('content');
const run = async (kind = 'one', settings = {}) => { const prepared = make(kind), h = transport(prepared.db, settings); return { ...prepared, h, result: await h.api.loadConsoleResearchEvidence(h.context, options(prepared.f)) }; };

for (const kind of ['one', 'two', 'public', 'analysis', 'carried']) test(`producer-shaped ${kind} historical read verifies exact saved linkage`, async () => {
  const { f, h, result } = await run(kind);
  assert.equal(verifier.verifyDiscoveryV2History(f).integrity, 'verified');
  assert.equal(result.integrity, 'verified', JSON.stringify(result.issues)); assert.equal(result.history.integrity, 'verified', JSON.stringify(result.history.issues));
  assert.equal(result.history.reviewState, 'completed_historical_review'); assert.equal(result.history.recordedOutcome, 'NEEDS_MORE_EVIDENCE'); assert.equal(result.history.rendering, 'plain_text');
  assert.equal(result.selection.item.id, f.experiment.id); assert.equal(result.workIdentity.workflowRunId, f.workflow.id); assert.equal(result.history.evidence.length, f.evidenceRecords.length);
  assert.ok(result.artifacts.every(link => link.verification === 'metadata_only' && link.businessId === f.scope.businessId));
  assert.ok(h.calls.length < 30); assert.ok(h.calls.every(call => call.limit === 2)); assert.deepEqual(h.forbidden, []);
  assert.equal(result.history.verificationScope, 'saved_content_and_direct_linkage');
  assert.ok(!Object.hasOwn(result, 'availableBudget') && !Object.hasOwn(result, 'remainingMicrousd') && !Object.hasOwn(result, 'accepted'));
});

test('each referenced evidence content read follows a successful bounded preflight and metadata qualification', async () => {
  const { f, h } = await run('two'); const preflightAt = h.events.findIndex(event => event.type === 'preflight');
  assert.ok(preflightAt >= 0); assert.equal(h.events[preflightAt].result.integrity, 'verified');
  for (const record of f.evidenceRecords) {
    const at = h.events.findIndex(event => event.type === 'read' && contents(event.call) && exactId(event.call) === record.artifact.id);
    assert.ok(at > preflightAt);
    assert.ok(h.events.slice(0, at).some(event => event.type === 'read' && event.call.table === 'artifacts' && !contents(event.call) && exactId(event.call) === record.artifact.id));
  }
  for (const call of h.calls.filter(contents)) assert.ok(h.calls.some(meta => meta.table === 'artifacts' && !contents(meta) && exactId(meta) === exactId(call)));
});

test('stale historical intent and sources stay inspectable without renewal or current authority', async () => {
  const { f, db } = make(), h = transport(db), result = await h.api.loadConsoleResearchEvidence(h.context, { ...options(f), observedAt: '2026-10-02T00:00:00Z' });
  assert.equal(result.integrity, 'verified'); assert.equal(result.history.freshness, 'stale'); assert.equal(result.history.reviewState, 'completed_historical_review');
  assert.ok(result.history.issues.some(issue => issue.code === 'saved_intent_expired')); assert.ok(result.history.spans.every(span => span.freshness === 'stale'));
  assert.equal(result.history.intent.expiresAt, f.experiment.intent.expiresAt);
});

test('exact old/off-page selection remains bounded with 130+ records in two Businesses', async () => {
  const { f, db } = make();
  for (const business of [id(1), id(2)]) for (let n = 0; n < 130; n++) db.product_experiments.push({ ...copy(db.product_experiments[0]), id: id((business === id(1) ? 10000 : 20000) + n), business_id: business });
  const h = transport(db), result = await h.api.loadConsoleResearchEvidence(h.context, options(f)); assert.equal(result.integrity, 'verified'); assert.equal(result.selection.item.id, f.experiment.id); assert.equal(h.calls.length, 21);
  assert.ok(h.calls.every(call => call.filters.some(filter => filter[1] === 'id') || call.table === 'workflow_stage_runs' && ['business_id', 'workflow_run_id', 'stage_key', 'attempt'].every(key => call.filters.some(filter => filter[1] === key))));
});

test('legacy and candidate-child records keep safe selection/Work navigation without claiming corrupt V2 history', async () => {
  for (const change of [row => { row.discovery_version = 'pod-discovery-1.0'; }, row => { row.candidate_id = id(999); row.parent_discovery_id = id(998); }]) {
    const { f, db } = make(); change(db.product_experiments[0]); const h = transport(db), result = await h.api.loadConsoleResearchEvidence(h.context, options(f));
    assert.equal(result.selection.status, 'found'); assert.ok(result.workIdentity); assert.equal(result.history, null); assert.equal(result.integrity, 'unavailable'); assert.ok(result.issues.some(issue => issue.code === 'unsupported_history_contract')); assert.ok(!h.calls.some(call => call.table === 'artifacts'));
  }
});

test('malformed request, owner scope and explicit Business conflicts fail before cross-scope payload reads', async () => {
  const { f, db } = make(), h = transport(db);
  for (const change of [{ experimentId: 'bad' }, { observedAt: '2026-02-30T00:00:00Z' }, { observedAt: 1 }, { businessId: 'bad' }, { page: 3 }]) await assert.rejects(h.api.loadConsoleResearchEvidence(h.context, { ...options(f), ...change }), /Invalid/);
  assert.equal(h.calls.length, 0); await assert.rejects(h.api.loadConsoleResearchEvidence(h.context, { ...options(f), businessId: id(3) }), /Business selection/);
  const result = await h.api.loadConsoleResearchEvidence(h.context, { ...options(f), businessId: id(2) }); assert.equal(result.selection.status, 'missing'); assert.equal(result.history, null); assert.equal(result.workIdentity, null); assert.equal(h.calls.length, 1);
  const ignored = transport(db, { ignore: (_, key) => key === 'business_id' }), bad = await ignored.api.loadConsoleResearchEvidence(ignored.context, { ...options(f), businessId: id(2) });
  assert.notEqual(bad.selection.status, 'found'); assert.equal(bad.workIdentity, null); assert.equal(ignored.calls.length, 1);
});

test('missing exact selection does not substitute another saved record', async () => {
  const { f, db } = make(), h = transport(db), result = await h.api.loadConsoleResearchEvidence(h.context, { ...options(f), experimentId: id(999999) });
  assert.equal(result.selection.status, 'missing'); assert.equal(result.history, null); assert.equal(result.workIdentity, null); assert.deepEqual(result.artifacts, []); assert.equal(h.calls.length, 1);
});

test('null/invalid counts, response caps and duplicate exact selections fail closed', async () => {
  for (const mutate of [result => ({ ...result, count: null }), result => ({ ...result, count: undefined }), result => ({ ...result, count: -1 }), result => ({ ...result, count: 1.1 }), result => ({ ...result, count: '1' }), result => ({ ...result, data: [] }), result => ({ ...result, data: [result.data[0], result.data[0]], count: 2 }), result => ({ ...result, data: [null] })]) {
    const { f, db } = make(), h = transport(db, { change: (call, result) => call.table === 'product_experiments' ? mutate(result) : result });
    const result = await h.api.loadConsoleResearchEvidence(h.context, options(f)); assert.equal(result.selection.status, 'unavailable'); assert.equal(result.history, null); assert.equal(h.calls.length, 1);
  }
});

test('missing and malformed descriptors prevent all artifact/evidence-content reads', async () => {
  for (const value of [null, undefined, {}, { version: 'pod-discovery-2.0' }, 'not a descriptor']) {
    const { f, db } = make(); if (value === undefined) delete db.product_experiments[0].evidence_pack; else db.product_experiments[0].evidence_pack = value;
    const h = transport(db), result = await h.api.loadConsoleResearchEvidence(h.context, options(f)); assert.equal(result.selection.status, 'found'); assert.equal(result.history, null); assert.ok(result.workIdentity); assert.ok(!h.calls.some(call => call.table === 'artifacts')); assert.ok(['missing', 'malformed'].includes(result.integrity));
  }
});

test('consistently replaced descriptor UUIDs cannot replace any producer-derived dossier/phase identity', async () => {
  for (const fields of [['dossierArtifactId'], ['strategyArtifactId'], ['reviewArtifactId'], ['dossierArtifactId', 'strategyArtifactId', 'reviewArtifactId']]) {
    const { f, db } = make(), row = db.product_experiments.find(row => row.id === f.experiment.id);
    for (const [index, field] of fields.entries()) {
      const original = row.evidence_pack[field], replacement = id(987600 + index);
      row.evidence_pack[field] = replacement; db.artifacts.find(artifact => artifact.id === original).id = replacement;
      if (field === 'dossierArtifactId') row.source_artifact_id = replacement;
    }
    const h = transport(db), result = await h.api.loadConsoleResearchEvidence(h.context, options(f));
    assert.equal(result.selection.status, 'found'); assert.ok(result.workIdentity); assert.equal(result.history, null); assert.equal(result.integrity, 'mismatched');
    assert.ok(result.issues.some(issue => issue.code === 'saved_descriptor_persisted_identity')); assert.deepEqual(result.artifacts, []);
    assert.ok(!h.calls.some(call => call.table === 'artifacts')); assert.equal(h.calls.length, 3);
  }
});

test('analysis source dossier keeps its producer-derived ID even when every direct saved pin agrees', async () => {
  for (const kind of ['analysis', 'carried']) {
    const { f, db } = make(kind), replacement = id(987699), selected = db.product_experiments.find(row => row.id === f.experiment.id), source = db.product_experiments.find(row => row.id === f.analysisSource.experiment.id);
    selected.variables.analysisSource.dossierArtifactId = replacement; source.source_artifact_id = replacement; source.evidence_pack.dossierArtifactId = replacement;
    db.artifacts.find(artifact => artifact.id === f.analysisSource.dossier.id).id = replacement;
    const h = transport(db), result = await h.api.loadConsoleResearchEvidence(h.context, options(f));
    assert.equal(result.integrity, 'mismatched'); assert.equal(result.history, null); assert.ok(result.issues.some(issue => issue.code === 'analysis_source_dossier_binding'));
    assert.ok(!h.calls.some(call => exactId(call) === replacement)); assert.ok(!h.calls.some(call => contents(call) && f.evidenceRecords.some(record => exactId(call) === record.artifact.id)));
  }
});

test('dependent experiment JSON is Business-filtered before transfer even for another owned Business', async () => {
  for (const [kind, target] of [['analysis', 'experiment'], ['carried', 'planExperiment']]) {
    const { f, db } = make(kind), dependentId = f.analysisSource[target].id;
    db.product_experiments.find(row => row.id === dependentId).business_id = id(2);
    const h = transport(db), result = await h.api.loadConsoleResearchEvidence(h.context, options(f));
    assert.notEqual(result.integrity, 'verified'); assert.equal(result.history, null);
    const dependent = h.calls.find(call => call.table === 'product_experiments' && exactId(call) === dependentId);
    assert.ok(dependent.filters.some(filter => filter[0] === 'eq' && filter[1] === 'business_id' && filter[2] === f.scope.businessId)); assert.deepEqual(dependent.result.data, []);
    assert.ok(dependent.filters.some(filter => filter[0] === 'in' && filter[1] === 'business_id'));
    const initial = h.calls.find(call => call.table === 'product_experiments' && exactId(call) === f.experiment.id);
    assert.ok(!initial.filters.some(filter => filter[0] === 'eq' && filter[1] === 'business_id'));
  }
});

test('failed preflight performs no further reads; missing leaf aliases remain missing', async () => {
  for (const change of [db => { db.product_experiments[0].variables.policyHash = 'a'.repeat(64); }, db => { db.product_experiments[0].variables.priorArtifactIds = [id(999)]; }, db => { db.artifacts.find(row => row.artifact_type === 'product.discovery-dossier.v2').metadata.contentHash = 'b'.repeat(64); }]) {
    const { f, db } = make(); change(db); const h = transport(db), result = await h.api.loadConsoleResearchEvidence(h.context, options(f));
    const at = h.events.findIndex(event => event.type === 'preflight'); assert.ok(at >= 0); assert.notEqual(h.events[at].result.integrity, 'verified'); assert.equal(h.events.slice(at + 1).filter(event => event.type === 'read').length, 0); assert.notEqual(result.integrity, 'verified');
    assert.ok(!h.calls.some(call => contents(call) && f.evidenceRecords.some(record => record.artifact.id === exactId(call))));
  }
  for (const field of ['intent', 'policy_hash', 'prior_artifact_ids', 'prior_evidence_hashes', 'analysis_source']) {
    const { f, db } = make(), h = transport(db, { change: (call, result) => { if (call.table === 'product_experiments') for (const row of result.data) delete row[field]; return result; } });
    const result = await h.api.loadConsoleResearchEvidence(h.context, options(f)); assert.equal(result.selection.status, 'found'); assert.equal(result.history.integrity, 'missing', field); assert.equal(result.history.evidence.length, 0);
  }
});

test('wrong artifact Business/run/type/MIME/stage is rejected before content, retaining safe selection', async () => {
  for (const field of ['business_id', 'workflow_run_id', 'artifact_type', 'media_type', 'metadata']) {
    const { f, db } = make(), dossier = db.artifacts.find(row => row.id === f.dossier.id);
    dossier[field] = field === 'metadata' ? { ...dossier.metadata, stageKey: 'spoof' } : field === 'artifact_type' ? 'worker.output' : field === 'media_type' ? 'text/plain' : id(2);
    const h = transport(db), result = await h.api.loadConsoleResearchEvidence(h.context, options(f)); assert.equal(result.selection.status, 'found'); assert.ok(result.workIdentity); assert.equal(result.history, null);
    assert.ok(!h.calls.some(contents)); assert.equal(result.artifacts.length, 0);
  }
});

test('every artifact content read validates its metadata snapshot without accepting a second conflicting copy', async () => {
  for (const patch of [{ business_id: id(2) }, { workflow_run_id: id(777) }, { artifact_type: 'research.sources' }, { media_type: 'text/plain' }]) {
    const { f, db } = make(), h = transport(db, { change: (call, result) => contents(call) && exactId(call) === f.dossier.id ? { ...result, data: result.data.map(row => ({ ...row, ...patch })) } : result });
    const result = await h.api.loadConsoleResearchEvidence(h.context, options(f)); assert.equal(result.history, null); assert.equal(result.artifacts[0].verification, 'metadata_only'); assert.equal(result.artifacts[0].artifactId, f.dossier.id);
  }
});

test('exact workflow definitions/intent pointers are required; no generic latest output fallback exists', async () => {
  for (const change of [db => { db.workflow_definitions[0].version = '2.0.0'; }, db => { db.workflow_definitions[0].workflow_key = 'product.discovery-v2.forged'; }, db => { db.workflow_runs[0].input.intentId = id(991); }, db => { db.workflow_definitions = []; }]) {
    const { f, db } = make(); change(db); const h = transport(db), result = await h.api.loadConsoleResearchEvidence(h.context, options(f)); assert.notEqual(result.integrity, 'verified'); assert.ok(!h.calls.some(call => contents(call) && exactId(call) === f.evidenceRecords[0].artifact.id));
  }
});

test('all five analysis pins are validated before source/plan reads, with no ancestry loop', async () => {
  for (const field of ['sourceRootId', 'planArtifactId', 'planHash', 'dossierArtifactId', 'dossierHash']) {
    const { f, db } = make('carried'); db.product_experiments.find(row => row.id === f.experiment.id).variables.analysisSource[field] = 'invalid';
    const h = transport(db), result = await h.api.loadConsoleResearchEvidence(h.context, options(f)); assert.equal(result.history, null); assert.notEqual(result.integrity, 'verified');
    assert.equal(h.calls.filter(call => call.table === 'product_experiments').length, 1); assert.ok(!h.calls.some(call => exactId(call) === f.analysisSource.plan.id));
  }
  const { f, h, result } = await run('carried'); assert.equal(result.integrity, 'verified');
  assert.deepEqual(new Set(h.calls.filter(call => call.table === 'product_experiments').map(exactId)), new Set([f.experiment.id, f.analysisSource.experiment.id, f.analysisSource.planExperiment.id]));
});

test('analysis carried-plan pins, exact plan origin and source dossier hashes cannot be substituted', async () => {
  for (const change of [({ f, db }) => { db.product_experiments.find(row => row.id === f.analysisSource.experiment.id).variables.analysisSource.planHash = 'a'.repeat(64); }, ({ f, db }) => { db.artifacts.find(row => row.id === f.analysisSource.plan.id).workflow_run_id = f.workflow.id; }, ({ f, db }) => { db.product_experiments.find(row => row.id === f.experiment.id).variables.analysisSource.dossierHash = 'b'.repeat(64); }]) {
    const state = make('carried'); change(state); const h = transport(state.db), result = await h.api.loadConsoleResearchEvidence(h.context, options(state.f)); assert.notEqual(result.integrity, 'verified'); assert.ok(!h.calls.some(call => contents(call) && exactId(call) === state.f.evidenceRecords[0].artifact.id));
  }
});

test('v2 persisted query must match both plan and narrow prepared-input leaves before evidence content', async () => {
  for (const field of ['kind', 'ordinal', 'queryId', 'question', 'sourceDomains']) {
    const { f, db } = make(), input = db.artifacts.find(row => row.artifact_type === 'pack.stage-input'); input.content[field] = field === 'sourceDomains' ? ['other.com'] : field === 'ordinal' ? 2 : 'wrong';
    const h = transport(db), result = await h.api.loadConsoleResearchEvidence(h.context, options(f)); assert.notEqual(result.integrity, 'verified'); assert.equal(result.history.evidence.length, 0);
    assert.ok(result.issues.some(issue => issue.code === 'plan_input_query_binding')); assert.ok(!h.calls.some(call => contents(call) && exactId(call) === f.evidenceRecords[0].artifact.id));
  }
});

test('public prior query is derived from exact workflow input, never evidence or worker claims', async () => {
  const { f, db } = make('public'); db.workflow_runs.find(row => row.id === f.evidenceRecords[0].workflow.id).input.question = 'A different persisted public research question';
  const h = transport(db), result = await h.api.loadConsoleResearchEvidence(h.context, options(f)); assert.notEqual(result.integrity, 'verified'); assert.equal(result.history.evidence.length, 0); assert.ok(result.history.issues.some(issue => issue.code === 'query_question'));
  assert.ok(!h.calls.some(call => call.columns.includes('query_kind:'))); assert.ok(h.calls.some(call => call.columns.includes('question:input->>question')));
});

test('attempt1 stage cardinality/completion and exact outputs cannot be replaced by retries', async () => {
  for (const change of [row => { row.attempt = 2; }, row => { row.status = 'running'; row.completed_at = null; }, row => { row.output = { unrelated: true }; }]) {
    const { f, db } = make(); change(db.workflow_stage_runs.find(row => row.stage_key === 'research1'));
    const h = transport(db), result = await h.api.loadConsoleResearchEvidence(h.context, options(f)); assert.notEqual(result.integrity, 'verified'); assert.equal(result.history.evidence.length, 0);
    assert.ok(h.calls.filter(call => call.table === 'workflow_stage_runs').every(call => call.filters.some(filter => filter[1] === 'attempt' && filter[2] === 1)));
  }
  const { f, db } = make(); db.workflow_stage_runs.push(copy(db.workflow_stage_runs.find(row => row.stage_key === 'research1')));
  const h = transport(db), result = await h.api.loadConsoleResearchEvidence(h.context, options(f)); assert.equal(result.integrity, 'unavailable'); assert.equal(result.history.evidence.length, 0);
});

test('foreign stage IDs, ignored predicates, duplicate rows and unknown counts cannot certify evidence', async () => {
  for (const change of [result => ({ ...result, count: null }), result => ({ ...result, data: [] }), result => ({ ...result, data: [result.data[0], result.data[0]], count: 2 }), result => ({ ...result, data: result.data.map(row => ({ ...row, business_id: id(2) })) }), result => ({ ...result, data: result.data.map(row => ({ ...row, stage_key: 'review' })) }), result => ({ ...result, data: result.data.map(row => ({ ...row, attempt: 2 })) })]) {
    const { f, db } = make(), h = transport(db, { change: (call, result) => call.table === 'workflow_stage_runs' && call.filters.some(filter => filter[1] === 'stage_key' && filter[2] === 'research1') ? change(result) : result });
    const result = await h.api.loadConsoleResearchEvidence(h.context, options(f)); assert.notEqual(result.integrity, 'verified'); assert.equal(result.history.evidence.length, 0);
  }
});

test('same-ID caches read each projection once and prevent contradictory stage entity copies', async () => {
  const { f, db } = make('two'), h = transport(db), result = await h.api.loadConsoleResearchEvidence(h.context, options(f)); assert.equal(result.integrity, 'verified');
  const keys = h.calls.map(call => `${call.table}:${call.columns}:${JSON.stringify(call.filters)}`); assert.equal(new Set(keys).size, keys.length);
  assert.equal(h.calls.filter(call => call.table === 'workflow_runs' && exactId(call) === f.workflow.id).length, 1);
  assert.equal(h.calls.filter(call => call.table === 'product_experiments' && exactId(call) === f.experiment.id).length, 1);
  db.workflow_stage_runs.find(row => row.stage_key === 'research2').id = db.workflow_stage_runs.find(row => row.stage_key === 'research1').id;
  const bad = transport(db), invalid = await bad.api.loadConsoleResearchEvidence(bad.context, options(f)); assert.notEqual(invalid.integrity, 'verified'); assert.ok(invalid.issues.some(issue => issue.code === 'conflicting_entity_copy'));
});

test('failed reads are cached without automatic retries', async () => {
  const { f, db } = make('two'), plan = deterministic(`pack:output:${f.workflow.id}:plan`);
  const h = transport(db, { throwWhen: call => call.table === 'artifacts' && exactId(call) === plan });
  const result = await h.api.loadConsoleResearchEvidence(h.context, options(f)); assert.equal(result.integrity, 'unavailable');
  assert.equal(h.calls.filter(call => call.table === 'artifacts' && exactId(call) === plan).length, 1); assert.equal(result.history.evidence.length, 0);
});

function sixPackDatabase() {
  const selected = make('two'), prior = Array.from({ length: 4 }, (_, index) => prepare(historyFixture(1000 * (index + 1))));
  for (const source of prior) {
    selected.f.evidenceRecords.push(copy(source.f.evidenceRecords[0])); selected.f.dossier.content.packRefs.push({ ...copy(source.f.dossier.content.packRefs[0]), origin: 'prior' });
  }
  selected.f.experiment.prior_artifact_ids = prior.map(source => source.f.evidenceRecords[0].artifact.id);
  selected.f.experiment.prior_evidence_hashes = selected.f.dossier.content.packRefs.filter(ref => ref.origin === 'prior').map(({ artifactId, sha256 }) => ({ artifactId, sha256 })); rebind(selected.f);
  return { f: selected.f, db: buildDatabase(selected, ...prior) };
}
test('maximum six exact outputs retain strict dependency/read bounds with no batch or ancestor fanout', async () => {
  const { f, db } = sixPackDatabase(), h = transport(db), result = await h.api.loadConsoleResearchEvidence(h.context, options(f));
  assert.equal(result.integrity, 'verified', JSON.stringify(result.issues)); assert.equal(result.history.evidence.length, 6); assert.ok(h.calls.length <= 89, h.calls.length); assert.ok(h.calls.length < h.api.CONSOLE_RESEARCH_EVIDENCE_QUERY_LIMIT);
  assert.equal(h.calls.filter(call => contents(call) && f.evidenceRecords.some(record => record.artifact.id === exactId(call))).length, 6);
  assert.ok(h.calls.every(call => call.limit === 2 && !call.filters.some(filter => filter[0] === 'in' && filter[1] !== 'business_id')));
  const dossier = db.artifacts.find(row => row.id === f.dossier.id); dossier.content.packRefs.push({ ...copy(dossier.content.packRefs[0]), artifactId: id(888), query: { ...dossier.content.packRefs[0].query, id: id(889) } }); dossier.metadata.contentHash = digest(dossier.content);
  const tooMany = transport(db), bad = await tooMany.api.loadConsoleResearchEvidence(tooMany.context, options(f)); assert.notEqual(bad.integrity, 'verified'); assert.equal(bad.history.evidence.length, 0); assert.equal(tooMany.calls.length, 5);
});

test('analysis allows exactly four carried outputs and never widens the preflight bound', async () => {
  const source = prepare(historyFixture(100)), prior = Array.from({ length: 3 }, (_, n) => prepare(historyFixture(1000 * (n + 1))));
  for (const item of prior) { source.f.evidenceRecords.push(copy(item.f.evidenceRecords[0])); source.f.dossier.content.packRefs.push({ ...copy(item.f.dossier.content.packRefs[0]), origin: 'prior' }); }
  source.f.experiment.prior_artifact_ids = prior.map(item => item.f.evidenceRecords[0].artifact.id); source.f.experiment.prior_evidence_hashes = source.f.dossier.content.packRefs.filter(ref => ref.origin === 'prior').map(({ artifactId, sha256 }) => ({ artifactId, sha256 })); rebind(source.f);
  const selected = prepare(analysisFixture(source.f, 9000)), db = buildDatabase(selected, ...prior), h = transport(db);
  const result = await h.api.loadConsoleResearchEvidence(h.context, options(selected.f)); assert.equal(result.integrity, 'verified', JSON.stringify(result.issues)); assert.equal(result.history.evidence.length, 4); assert.ok(h.calls.length <= 74);
  const saved = db.product_experiments.find(row => row.id === selected.f.experiment.id); saved.variables.priorArtifactIds.push(id(9999)); saved.variables.priorEvidenceHashes.push({ artifactId: id(9999), sha256: 'a'.repeat(64) });
  const malformed = transport(db), bad = await malformed.api.loadConsoleResearchEvidence(malformed.context, options(selected.f)); assert.notEqual(bad.integrity, 'verified');
  const event = malformed.events.findIndex(event => event.type === 'preflight'); assert.ok(event >= 0); assert.equal(malformed.events.slice(event + 1).filter(event => event.type === 'read').length, 0);
});

test('bounded parallel reads have explicit dependency waves and never return with orphaned sibling reads', async () => {
  for (const kind of ['one', 'two', 'public', 'analysis', 'carried']) {
    const { f, db } = make(kind), h = transport(db, { waves: true }), result = await h.api.loadConsoleResearchEvidence(h.context, options(f));
    assert.equal(result.integrity, 'verified'); assert.ok(h.waves <= (['analysis', 'carried'].includes(kind) ? 21 : 13), `${kind}: ${h.waves} waves`); assert.ok(h.peak > 1);
    const count = h.calls.length, links = copy(result.artifacts); await new Promise(resolve => setImmediate(resolve)); assert.equal(h.calls.length, count); assert.deepEqual(result.artifacts, links);
  }
  const { f, db } = make('carried'), h = transport(db, { waves: true, change: (call, result) => contents(call) && exactId(call) === f.analysisSource.dossier.id ? { ...result, error: true } : result });
  const result = await h.api.loadConsoleResearchEvidence(h.context, options(f)), count = h.calls.length, links = copy(result.artifacts);
  assert.equal(result.integrity, 'unavailable'); await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); assert.equal(h.calls.length, count); assert.deepEqual(result.artifacts, links);
});

test('workflow, definition and artifact count/cap failures retain selection but never complete history', async () => {
  for (const table of ['workflow_runs', 'workflow_definitions', 'artifacts']) for (const mutate of [result => ({ ...result, count: null }), result => ({ ...result, data: [] }), result => ({ ...result, data: [result.data[0], result.data[0]], count: 2 })]) {
    const { f, db } = make(), h = transport(db, { change: (call, result) => call.table === table ? mutate(result) : result }), result = await h.api.loadConsoleResearchEvidence(h.context, options(f));
    assert.equal(result.selection.status, 'found'); assert.equal(result.integrity, 'unavailable'); assert.equal(result.history, null);
    if (table === 'artifacts') assert.ok(!h.calls.some(contents));
  }
});

test('post-download rendering limits fail safely without claiming wire-byte caps', async () => {
  const { f, db } = make(); db.artifacts.find(row => row.id === f.dossier.id).content.comparisonRationale = 'x'.repeat(70000);
  const h = transport(db), result = await h.api.loadConsoleResearchEvidence(h.context, options(f)); assert.equal(result.integrity, 'malformed'); assert.equal(result.history, null); assert.ok(result.selection.item); assert.ok(result.artifacts.some(link => link.artifactId === f.dossier.id));
  assert.ok(result.limits.some(limit => limit.includes('not pre-transfer')));
});

test('no whole variables, workflow payload, prepared knowledge, quotes, costs, providers, RPC or signing are read', async () => {
  const { f, db } = make(); db.product_experiments[0].variables.budgetQuote = { secretPayload: 'x'.repeat(300000) }; db.workflow_runs[0].state = { huge: true }; db.workflow_runs[0].input.unrequested = 'x'.repeat(300000);
  db.artifacts.find(row => row.artifact_type === 'pack.stage-input').content.knowledge = { unrequested: 'x'.repeat(300000) };
  const h = transport(db), result = await h.api.loadConsoleResearchEvidence(h.context, options(f)); assert.equal(result.integrity, 'verified'); assert.deepEqual(h.forbidden, []);
  for (const call of h.calls) {
    assert.ok(!call.columns.split(',').some(column => ['variables', 'input', 'state', 'pack_snapshot', 'budget_quote', 'budgetQuote'].includes(column)));
    assert.ok(!/cost|reservation|settlement|packs|models|accounts/.test(call.table));
    if (call.columns.includes('query_kind:')) assert.ok(!call.columns.split(',').includes('content'));
  }
  const source = readFileSync('src/lib/core-ui/console-research-evidence.ts', 'utf8');
  assert.ok(!/\.rpc\(|\.auth\.|service_role|process\.env|fetch\(|\.insert\(|\.upload\(|\.delete\(|\.schema\(|\.storage\.|discovery-v2-plan|discovery-v2-budget|loadDiscoveryChainBalance/.test(source));
  assert.equal((source.match(/\.update\(/g) ?? []).length, 2); assert.ok(source.includes('createHash("md5").update(') && source.includes('createHash("sha256").update('));
});
