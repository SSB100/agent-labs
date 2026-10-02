import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { api, fixture, analysisFixture, publicPriorFixture, workflowStatuses, rebind, rebindEvidence, digest, textHash, id } from './helpers/discovery-v2-history-fixtures.mjs';
const oldFetch = globalThis.fetch;
test.before(() => { globalThis.fetch = () => { throw Error('All external networking denied'); }; });
test.after(() => { globalThis.fetch = oldFetch; });
const inspect = api.verifyDiscoveryV2History, preflight = api.discoveryV2HistoryEvidencePreflight;
const has = (result, code) => result.issues.some(issue => issue.code === code);

test('synthetic saved chain verifies with plain-text exact evidence and no authority fields', () => {
  const f = fixture(), before = structuredClone(f), result = inspect(f);
  assert.equal(result.integrity, 'verified', JSON.stringify(result.issues)); assert.equal(result.freshness, 'within_saved_window'); assert.equal(result.reviewState, 'completed_historical_review');
  assert.equal(result.recordedOutcome, 'NEEDS_MORE_EVIDENCE'); assert.equal(result.rendering, 'plain_text'); assert.equal(result.evidence.length, 1); assert.equal(result.spans.length, 1);
  assert.equal(result.spans[0].quote, f.evidenceRecords[0].artifact.content.evidencePack.evidence[0].quote); assert.deepEqual(f, before);
  assert.ok(!Object.hasOwn(result, 'productTest') && !Object.hasOwn(result, 'availableBudget') && !Object.hasOwn(result, 'qualified'));
  result.evidence[0].pack.sources[0].excerpt = 'Mutated return'; assert.deepEqual(f, before);
});
test('expired intent and source remain inspectable and stale without fresh-now validation', () => {
  const f = fixture(); f.observedAt = '2026-10-02T00:00:00.000Z'; const result = inspect(f);
  assert.equal(result.integrity, 'verified'); assert.equal(result.freshness, 'stale'); assert.equal(result.reviewState, 'completed_historical_review'); assert.equal(result.spans[0].freshness, 'stale');
  assert.ok(has(result, 'saved_intent_expired') && has(result, 'saved_source_expired')); assert.equal(result.intent.expiresAt, f.experiment.intent.expiresAt);
});
test('missing, malformed, mismatched and partial records remain distinct', () => {
  const missing = fixture(); missing.dossier = null; assert.equal(inspect(missing).integrity, 'missing'); assert.deepEqual(preflight(missing).artifactIds, []);
  const malformed = fixture(); malformed.dossier.content.packRefs = 'not an array'; assert.equal(inspect(malformed).integrity, 'malformed');
  const mismatch = fixture(); mismatch.experiment.policy_hash = 'a'.repeat(64); assert.equal(inspect(mismatch).integrity, 'mismatched');
  const partial = fixture(); partial.experiment.status = 'failed'; partial.workflow.status = 'failed'; partial.evidenceRecords[0].workflow.status = 'failed'; const result = inspect(partial);
  assert.equal(result.integrity, 'partial'); assert.equal(result.reviewState, 'saved_output'); assert.equal(result.recordedOutcome, 'NEEDS_MORE_EVIDENCE'); assert.ok(result.review);
});
test('wrong Business, run, intent, version, artifact and persisted stage fail exact linkage', () => {
  for (const change of [f => f.experiment.business_id = id(900), f => f.workflow.id = id(901), f => f.workflow.intent_id = id(902), f => f.experiment.intent.id = id(903), f => f.dossier.artifact_type = 'worker.output', f => f.dossier.content.version = 'other', f => f.dossier.workflow_run_id = id(904), f => f.experiment.evidence_pack.dossierArtifactId = id(905)]) {
    const f = fixture(); change(f); assert.equal(preflight(f).integrity, 'mismatched'); assert.deepEqual(preflight(f).artifactIds, []);
  }
  for (const change of [f => f.strategy.stage.business_id = id(910), f => f.strategy.stage.stage_key = 'review', f => f.strategy.artifact.metadata.stageKey = 'review', f => f.strategy.artifact.id = id(912), f => f.review.stage.workflow_run_id = id(913)]) {
    const f = fixture(); change(f); assert.equal(inspect(f).integrity, 'mismatched'); assert.notEqual(inspect(f).reviewState, 'completed_historical_review');
  }
});
test('all required selected leaves are required, never reconstructed from other JSON', () => {
  for (const field of ['intent', 'policy_hash', 'prior_artifact_ids', 'prior_evidence_hashes', 'analysis_source', 'evidence_pack']) {
    const f = fixture(); delete f.experiment[field]; f.experiment.variables = { [field]: 'must not rescue missing projection' };
    assert.equal(preflight(f).integrity, 'missing', field); assert.deepEqual(preflight(f).artifactIds, []);
  }
});
test('duplicate and malformed dossier/kickoff pins never create fetch IDs', () => {
  for (const change of [f => f.dossier.content.packRefs.push(structuredClone(f.dossier.content.packRefs[0])), f => f.dossier.content.packRefs[0].artifactId = 'bad', f => f.dossier.content.packRefs[0].sha256 = 'ABC', f => f.experiment.prior_artifact_ids = [id(1), id(1)], f => f.experiment.prior_evidence_hashes = [{ artifactId: id(99), sha256: 'a'.repeat(64) }]]) {
    const f = fixture(); change(f); rebind(f); assert.notEqual(preflight(f).integrity, 'verified'); assert.deepEqual(preflight(f).artifactIds, []);
  }
});
test('ten-ID union is inconsistent rather than a widened six-pack cap', () => {
  const f = fixture(); f.experiment.intent.limits.maximumNewCollections = 2; f.workflow.workflow_key = 'product.discovery-v2.two';
  f.dossier.content.packRefs = Array.from({ length: 6 }, (_, n) => ({ ...structuredClone(f.dossier.content.packRefs[0]), artifactId: id(100 + n), origin: n < 2 ? 'new' : 'prior', query: { ...f.dossier.content.packRefs[0].query, id: id(200 + n) } }));
  f.experiment.prior_artifact_ids = [id(300), id(301), id(302), id(303)]; f.experiment.prior_evidence_hashes = f.experiment.prior_artifact_ids.map(artifactId => ({ artifactId, sha256: 'a'.repeat(64) }));
  rebind(f); const result = preflight(f); assert.equal(result.integrity, 'mismatched'); assert.ok(has(result, 'dossier_prior_exact_set')); assert.deepEqual(result.artifactIds, []);
});
test('normal six packs permit exactly two new and four exactly pinned prior IDs', () => {
  const f = fixture(); f.experiment.intent.limits.maximumNewCollections = 2; f.workflow.workflow_key = 'product.discovery-v2.two';
  f.dossier.content.packRefs = Array.from({ length: 6 }, (_, n) => ({ ...structuredClone(f.dossier.content.packRefs[0]), artifactId: id(100 + n), origin: n < 2 ? 'new' : 'prior', query: { ...f.dossier.content.packRefs[0].query, id: id(200 + n) } }));
  f.experiment.prior_artifact_ids = f.dossier.content.packRefs.filter(r => r.origin === 'prior').map(r => r.artifactId); f.experiment.prior_evidence_hashes = f.dossier.content.packRefs.filter(r => r.origin === 'prior').map(({ artifactId, sha256 }) => ({ artifactId, sha256 }));
  rebind(f); assert.equal(preflight(f).integrity, 'verified'); assert.equal(preflight(f).artifactIds.length, 6);
  f.dossier.content.packRefs[2].origin = 'new'; rebind(f); assert.deepEqual(preflight(f).artifactIds, []);
});
test('absent evidence remains missing, not empty research or a negative decision', () => {
  const f = fixture(); f.evidenceRecords = []; const result = inspect(f); assert.equal(result.integrity, 'missing'); assert.ok(has(result, 'required_record_missing')); assert.equal(result.evidence.length, 0); assert.equal(result.reviewState, 'saved_output');
  const noPhase = fixture(); noPhase.review = null; assert.equal(inspect(noPhase).integrity, 'missing'); assert.equal(inspect(noPhase).reviewState, 'unavailable');
});
test('dossier, strategy, review, source pack and excerpt canonical hashes are binding', () => {
  for (const change of [f => f.dossier.metadata.contentHash = 'a'.repeat(64), f => f.strategy.artifact.content.dossierHash = 'a'.repeat(64), f => f.review.artifact.content.assessmentHash = 'a'.repeat(64), f => f.dossier.content.packRefs[0].sha256 = 'a'.repeat(64), f => f.evidenceRecords[0].artifact.content.evidencePack.sources[0].excerpt += 'Changed']) {
    const f = fixture(); change(f); const result = inspect(f); assert.equal(result.integrity, 'mismatched'); assert.notEqual(result.reviewState, 'completed_historical_review');
  }
  const f = fixture(); f.evidenceRecords[0].artifact.content.evidencePack.sources[0].excerpt += 'Changed'; rebindEvidence(f); assert.ok(has(inspect(f), 'source_excerpt_hash'));
});
test('evidence scope, source collection and completed stage are independently verified', () => {
  for (const change of [f => f.evidenceRecords[0].artifact.business_id = id(990), f => f.evidenceRecords[0].query.question += 'Different', f => f.evidenceRecords[0].query.source_domains = ['printful.com'], f => f.evidenceRecords[0].query.id = id(991), f => f.evidenceRecords[0].source.content.providerMetadata.queryId = id(992), f => f.evidenceRecords[0].source.content.sources[0].title = 'Unbound source', f => f.evidenceRecords[0].stage.stage_key = 'research2']) {
    const f = fixture(); change(f); assert.equal(inspect(f).integrity, 'mismatched'); assert.equal(inspect(f).evidence.length, 0);
  }
  const f = fixture(); f.evidenceRecords[0].stage.status = 'running'; assert.ok(has(inspect(f), 'stage_not_completed'));
});
test('saved source and evidence IDs are unique and canonically derived', () => {
  for (const change of [pack => pack.sources.push(structuredClone(pack.sources[0])), pack => { pack.evidence.push(structuredClone(pack.evidence[0])); pack.claims.push(structuredClone(pack.claims[0])); }, pack => pack.sources[0].id = `src-${'a'.repeat(24)}`, pack => pack.evidence[0].id = `evi-${'a'.repeat(24)}`, pack => pack.claims[0].text = 'Fabricated retained quotation']) {
    const f = fixture(); change(f.evidenceRecords[0].artifact.content.evidencePack); rebindEvidence(f); assert.notEqual(inspect(f).integrity, 'verified'); assert.equal(inspect(f).evidence.length, 0);
  }
});
test('Unicode code-point spans render retained text and reject unsafe bounds/hash/source', () => {
  const f = fixture(), ref = f.strategy.artifact.content.candidates[0].dimensions[0].facts[0].reference;
  assert.notEqual(ref.start, f.evidenceRecords[0].artifact.content.evidencePack.sources[0].excerpt.indexOf('A saved'));
  assert.match(inspect(f).spans[0].quote, /^A saved adjacent/);
  for (const mutate of [r => r.start = -1, r => r.end = r.start, r => r.end = r.start + 321, r => r.end = 1801, r => r.start = 0.5, r => r.sourceContentHash = 'a'.repeat(64), r => r.sourceId = `src-${'a'.repeat(24)}`, r => r.artifactId = id(999)]) {
    const bad = fixture(); mutate(bad.strategy.artifact.content.candidates[0].dimensions[0].facts[0].reference); rebind(bad); assert.notEqual(inspect(bad).integrity, 'verified');
  }
});
test('unsafe, credential-bearing and out-of-scope source links never escape verification', () => {
  for (const url of ['javascript:alert(1)', 'http://www.etsy.com/item', 'https://user:secret@www.etsy.com/item', 'https://www.etsy.com/item?token=secret', 'https://evil.example/item', 'https://www.etsy.com/item#script', 'https://www.etsy.com/item%0aevil']) {
    const f = fixture(); const source = f.evidenceRecords[0].artifact.content.evidencePack.sources[0]; source.url = url; source.id = `src-${textHash(`${url}:${source.contentHash}`).slice(0, 24)}`; rebindEvidence(f);
    const result = inspect(f); assert.equal(result.evidence.length, 0, url); assert.equal(result.spans.length, 0, url); assert.notEqual(result.reviewState, 'completed_historical_review');
  }
  const markup = fixture(); markup.strategy.artifact.content.recommendation.rationale = '<script>alert("untrusted")</script>'.repeat(3); rebind(markup);
  const result = inspect(markup); assert.equal(result.integrity, 'verified'); assert.equal(result.rendering, 'plain_text'); assert.equal(result.strategy.recommendation.rationale, markup.strategy.artifact.content.recommendation.rationale);
  const literal = fixture(); literal.evidenceRecords[0].artifact.content.evidencePack.sources[0].title = '<b>Preserved</b> literal title'; literal.evidenceRecords[0].source.content.sources[0].title = '<b>Preserved</b> literal title'; rebindEvidence(literal);
  assert.equal(inspect(literal).integrity, 'verified'); assert.equal(inspect(literal).evidence[0].pack.sources[0].title, '<b>Preserved</b> literal title');
});
test('analysis-only preserves exact source, plan and dossier pins without recursive ancestry', () => {
  const f = analysisFixture(), result = inspect(f); assert.equal(result.integrity, 'verified', JSON.stringify(result.issues)); assert.equal(preflight(f).artifactIds.length, 1);
  for (const change of [g => g.experiment.analysis_source.sourceRootId = id(998), g => g.experiment.analysis_source.planHash = 'a'.repeat(64), g => g.experiment.analysis_source.dossierHash = 'a'.repeat(64), g => g.analysisSource.dossier.id = id(997), g => g.dossier.content.packRefs[0].origin = 'new', g => g.dossier.content.shortlist[0].concept = 'Changed preserved shortlist']) {
    const bad = analysisFixture(); change(bad); rebind(bad); assert.notEqual(preflight(bad).integrity, 'verified'); assert.deepEqual(preflight(bad).artifactIds, []);
  }
  const missing = analysisFixture(); delete missing.analysisSource; assert.equal(preflight(missing).integrity, 'missing'); assert.deepEqual(preflight(missing).artifactIds, []);
});
test('analysis carried plan can originate before the source round when exact pins agree', () => {
  const f = analysisFixture(analysisFixture(), 300);
  assert.equal(f.analysisSource.workflow.workflow_key, 'product.discovery-v2.analysis'); assert.notEqual(f.analysisSource.planWorkflow.id, f.analysisSource.workflow.id);
  assert.equal(inspect(f).integrity, 'verified', JSON.stringify(inspect(f).issues));
  const bad = analysisFixture(), older = fixture(500);
  bad.analysisSource.planExperiment = older.experiment; bad.analysisSource.planWorkflow = older.workflow; bad.analysisSource.plan.workflow_run_id = older.workflow.id; bad.analysisSource.plan.content.intentId = older.experiment.id;
  bad.experiment.analysis_source.planHash = digest(bad.analysisSource.plan.content); assert.ok(has(preflight(bad), 'analysis_source_own_plan_root')); assert.deepEqual(preflight(bad).artifactIds, []);
  f.analysisSource.experiment.analysis_source.planHash = 'a'.repeat(64); assert.ok(has(preflight(f), 'analysis_carried_plan_hash'));
  const missing = analysisFixture(); delete missing.analysisSource.planStage; assert.equal(preflight(missing).integrity, 'missing'); assert.deepEqual(preflight(missing).artifactIds, []);
  const incomplete = analysisFixture(); incomplete.analysisSource.planStage.status = 'running'; assert.ok(has(preflight(incomplete), 'stage_not_completed'));
  const changed = analysisFixture(); changed.analysisSource.planStage.output.intentId = id(999); assert.ok(has(preflight(changed), 'stage_output'));
});
test('analysis rejects proper subsets, changed prior pins and more than four preserved packs', () => {
  const expand = count => {
    const f = analysisFixture(), base = f.analysisSource.dossier.content.packRefs[0];
    f.analysisSource.dossier.content.packRefs = Array.from({ length: count }, (_, n) => ({ ...structuredClone(base), artifactId: id(700 + n), origin: n === 0 ? 'new' : 'prior', query: { ...base.query, id: id(800 + n) } }));
    f.analysisSource.dossier.metadata.contentHash = digest(f.analysisSource.dossier.content);
    f.experiment.analysis_source.dossierHash = digest(f.analysisSource.dossier.content);
    f.dossier.content.packRefs = f.analysisSource.dossier.content.packRefs.map(ref => ({ ...structuredClone(ref), origin: 'prior' }));
    f.experiment.prior_artifact_ids = f.dossier.content.packRefs.map(ref => ref.artifactId);
    f.experiment.prior_evidence_hashes = f.dossier.content.packRefs.map(({ artifactId, sha256 }) => ({ artifactId, sha256 }));
    return rebind(f);
  };
  assert.equal(preflight(expand(4)).integrity, 'verified');
  const subset = expand(2); subset.dossier.content.packRefs.pop(); subset.experiment.prior_artifact_ids.pop(); subset.experiment.prior_evidence_hashes.pop(); rebind(subset);
  assert.ok(has(preflight(subset), 'analysis_exact_pack_set')); assert.deepEqual(preflight(subset).artifactIds, []);
  const changed = expand(2); changed.experiment.prior_evidence_hashes[0].sha256 = 'a'.repeat(64); assert.ok(has(preflight(changed), 'dossier_prior_hash'));
  assert.notEqual(preflight(expand(5)).integrity, 'verified'); assert.deepEqual(preflight(expand(5)).artifactIds, []);
});
test('historical source dates retain unknown windows and reject impossible temporal order', () => {
  const f = fixture(); f.observedAt = '2023-12-31T23:00:00.000Z'; assert.equal(inspect(f).freshness, 'unknown');
  for (const change of [source => source.retrievalExpiresAt = source.retrievedAt, source => source.retrievalExpiresAt = '2024-01-03T00:00:00.000Z', source => source.retrievedAt = 'not-a-date']) {
    const bad = fixture(); change(bad.evidenceRecords[0].artifact.content.evidencePack.sources[0]); rebindEvidence(bad); assert.equal(inspect(bad).integrity, 'malformed'); assert.equal(inspect(bad).spans.length, 0);
  }
});
test('post-input size checks and non-JSON/recursive content fail without claiming wire bounds', () => {
  const f = fixture(); f.dossier.content.comparisonRationale = 'x'.repeat(16000); assert.ok(has(preflight(f), 'post_input_snapshot_limit'));
  const cyclic = fixture(); cyclic.dossier.content.cycle = cyclic.dossier.content; assert.ok(has(preflight(cyclic), 'cyclic_snapshot'));
  const missingDate = fixture(); missingDate.observedAt = 'tomorrow'; assert.equal(inspect(missingDate).freshness, 'unknown'); assert.equal(inspect(missingDate).integrity, 'malformed');
});
test('module imports only deterministic helpers/types and has no network or mutation surface', () => {
  const source = readFileSync('src/products/discovery-v2-history.ts', 'utf8');
  assert.doesNotMatch(source, /\b(?:fetch|createClient|rpc|signUrl|validateDiscoveryIntentV2|validateDiscoveryDossierV2|validateStrategistAssessmentV2|validateReviewerDecisionV2)\s*\(/);
  assert.doesNotMatch(source, /from ["'][^"']*(?:server|provider|credentials|budget|runtime|data)[^"']*["']/);
  assert.match(source, /NOT a database or pre-transfer byte bound/);
});

test('research lane stage pairs follow the actual registered SQL catalogs for new and carried evidence', () => {
  const workflows = ['20260930043140_stage11_web_research_catalog.sql', '20261001003118_stage13_v2_experimental_catalog.sql', '20261001093430_stage13_v2_evidence_analysis_continuation.sql'].flatMap(filename => {
    const sql = readFileSync(`supabase/migrations/${filename}`, 'utf8');
    return [...sql.matchAll(/private\.stage10_register_pack\('((?:''|[^'])*)'::jsonb\)/g)].flatMap(match => JSON.parse(match[1].replaceAll("''", "'")).workflows);
  });
  const mapping = Object.fromEntries(workflows.map(workflow => [workflow.key, workflow.stages.filter(stage => stage.permittedCapabilities.includes('web.research')).map(stage => stage.key)]));
  assert.deepEqual(mapping['research.public-evidence'], ['research']); assert.deepEqual(mapping['product.discovery-v2.one'], ['research1']); assert.deepEqual(mapping['product.discovery-v2.two'], ['research1', 'research2']); assert.deepEqual(mapping['product.discovery-v2.analysis'], []);
  const setStage = (f, key) => { const record = f.evidenceRecords[0]; record.stage.stage_key = key; record.artifact.metadata.stageKey = key; record.source.metadata.stageKey = key; };
  for (const make of [fixture, analysisFixture, publicPriorFixture]) {
    const valid = make(), workflow = valid.evidenceRecords[0].workflow.workflow_key;
    assert.equal(inspect(valid).integrity, 'verified', workflow);
    for (const key of ['research', 'research1', 'research2', 'strategy', 'arbitrary-not-research']) {
      const f = make(); setStage(f, key); const result = inspect(f);
      if (mapping[workflow].includes(key)) assert.equal(result.integrity, 'verified', `${workflow}/${key}`);
      else { assert.ok(has(result, 'evidence_workflow_stage'), `${workflow}/${key}: ${JSON.stringify(result.issues)}`); assert.equal(result.evidence.length, 0); }
    }
  }
  for (const stageKey of mapping['product.discovery-v2.two']) {
    const f = fixture(); f.experiment.intent.limits.maximumNewCollections = 2; f.workflow.workflow_key = 'product.discovery-v2.two'; f.evidenceRecords[0].workflow.workflow_key = 'product.discovery-v2.two'; setStage(f, stageKey); rebind(f); assert.equal(inspect(f).integrity, 'verified');
  }
  const analysisOrigin = analysisFixture(); analysisOrigin.evidenceRecords[0].workflow.workflow_key = 'product.discovery-v2.analysis'; assert.notEqual(inspect(analysisOrigin).integrity, 'verified');
});
test('public prior evidence follows completed-run and source-selection membership SQL rules', () => {
  const sql = readFileSync('supabase/migrations/20260930095221_stage13_product_discovery.sql', 'utf8');
  assert.match(sql, /p_require_completed and r\.status<>'completed'/); assert.match(sql, /stage_key='research' and attempt=1 and status='completed'/); assert.match(sql, /jsonb_array_elements\(src\.content->'evidence'\) x where x=v_evidence/);
  for (const status of ['running', 'failed']) { const f = publicPriorFixture(); f.evidenceRecords[0].workflow.status = status; f.evidenceRecords[0].workflow.completed_at = null; assert.ok(has(inspect(f), 'public_evidence_run_not_completed')); assert.equal(inspect(f).evidence.length, 0); }
  const absent = publicPriorFixture(); absent.evidenceRecords[0].source.content.evidence = []; assert.equal(inspect(absent).integrity, 'malformed');
  const changed = publicPriorFixture(); changed.evidenceRecords[0].source.content.evidence[0].quote = 'A different saved selection'; assert.ok(has(inspect(changed), 'public_collection_evidence_binding'));
  const attempt = publicPriorFixture(); attempt.evidenceRecords[0].stage.attempt = 2; assert.ok(has(inspect(attempt), 'stage_attempt'));
  const v2 = fixture(); v2.evidenceRecords[0].source.content.evidence = [{ id: 'original-prefix-selection', sourceId: v2.evidenceRecords[0].artifact.content.evidencePack.sources[0].id, quote: 'Original source prefix' }]; assert.equal(inspect(v2).integrity, 'verified');
});
test('calendar dates and timezone fields are validated before Date.parse normalization', () => {
  for (const expiresAt of ['2024-02-30T00:00:00Z', '2023-02-29T00:00:00Z', '1900-02-29T00:00:00Z', '2024-04-31T00:00:00Z', '2024-01-01T24:00:00Z', '2024-01-01T12:60:00Z', '2024-01-01T12:00:60Z', '2024-01-01T12:00:00+24:00', '2024-01-01T12:00:00+01:60', '2024-01-01T12:00:00']) {
    const f = fixture(); f.experiment.intent.expiresAt = expiresAt; rebind(f); assert.ok(has(preflight(f), 'invalid_timestamp'), expiresAt); assert.deepEqual(preflight(f).artifactIds, []);
  }
  for (const expiresAt of ['2024-02-29T00:00:00Z', '2000-02-29T00:00:00.000001+05:30', '2024-01-01T00:00:00-0530']) { const f = fixture(); f.experiment.intent.expiresAt = expiresAt; rebind(f); assert.equal(preflight(f).integrity, 'verified', expiresAt); }
});
test('workflow statuses match actual SQL while queued historical metadata remains inspectable', () => {
  const sql = readFileSync('supabase/migrations/20260929011830_universal_core_contracts.sql', 'utf8');
  const statusSql = sql.match(/create table public\.workflow_runs \([\s\S]*?check \(status in \(([^)]*)\)\)/)[1];
  const persisted = [...statusSql.matchAll(/'([^']+)'/g)].map(match => match[1]); assert.deepEqual(workflowStatuses, persisted);
  for (const status of persisted) { const f = fixture(); f.workflow.status = status; assert.equal(preflight(f).integrity, 'verified', status); }
  const queued = fixture(); queued.experiment.status = 'reserved'; queued.workflow.status = 'queued'; queued.workflow.completed_at = null; queued.experiment.completed_at = null; queued.dossier = null; queued.strategy = null; queued.review = null; queued.evidenceRecords = [];
  const result = inspect(queued); assert.equal(result.integrity, 'missing'); assert.ok(result.intent); assert.ok(!has(result, 'unknown_record_status')); assert.equal(result.reviewState, 'unavailable');
  const fictional = fixture(); fictional.workflow.status = 'pending'; assert.ok(has(preflight(fictional), 'unknown_record_status'));
});
test('artifact primary keys cannot collide across dossier, phase, evidence and source roles', () => {
  for (const reserved of ['dossierArtifactId', 'strategyArtifactId', 'reviewArtifactId']) {
    const f = fixture(); f.dossier.content.packRefs[0].artifactId = f.experiment.evidence_pack[reserved]; rebind(f); assert.ok(has(preflight(f), 'evidence_phase_identity_collision')); assert.deepEqual(preflight(f).artifactIds, []);
  }
  for (const target of [f => f.dossier.id, f => f.strategy.artifact.id, f => f.review.artifact.id]) {
    const f = fixture(); f.evidenceRecords[0].source.id = target(f); const result = inspect(f); assert.ok(has(result, 'conflicting_artifact_identity')); assert.equal(result.evidence.length, 0); assert.notEqual(result.reviewState, 'completed_historical_review');
  }
});
test('stage primary keys cannot represent conflicting roles, runs or outputs', () => {
  for (const change of [f => f.strategy.stage.id = f.evidenceRecords[0].stage.id, f => f.review.stage.id = f.strategy.stage.id]) {
    const f = fixture(); change(f); const result = inspect(f); assert.ok(has(result, 'conflicting_stage_identity')); assert.notEqual(result.reviewState, 'completed_historical_review');
  }
  const analysis = analysisFixture(); analysis.analysisSource.planStage.id = analysis.strategy.stage.id;
  assert.ok(has(inspect(analysis), 'conflicting_stage_identity')); assert.equal(inspect(analysis).evidence.length, 0);
});
test('experiment and workflow identity coherence is checked before and independently of evidence', () => {
  const run = analysisFixture(); run.analysisSource.planWorkflow.status = 'running'; run.analysisSource.planWorkflow.completed_at = null; run.evidenceRecords = [];
  assert.ok(has(preflight(run), 'conflicting_workflow_identity')); assert.deepEqual(preflight(run).artifactIds, []);
  const root = analysisFixture(); root.analysisSource.planExperiment.status = 'researching'; root.evidenceRecords = [];
  assert.ok(has(preflight(root), 'conflicting_experiment_identity')); assert.deepEqual(preflight(root).artifactIds, []);
  const consistent = analysisFixture(); assert.equal(consistent.analysisSource.experiment.id, consistent.analysisSource.planExperiment.id); assert.equal(preflight(consistent).integrity, 'verified');
  const own = fixture(); own.evidenceRecords[0].workflow.workflow_key = 'product.discovery-v2.two'; assert.ok(has(inspect(own), 'conflicting_workflow_identity'));
});
test('analysis preserves the original direct-source dossier origin as well as normalized prior refs', () => {
  const f = analysisFixture(), evidence = f.evidenceRecords[0], pack = evidence.artifact.content.evidencePack, publicRun = id(991);
  evidence.workflow = { id: publicRun, business_id: f.scope.businessId, workflow_key: 'research.public-evidence', workflow_version: '1.0.0', status: 'completed', completed_at: f.workflow.completed_at, question: evidence.query.question, source_domains: evidence.query.source_domains };
  evidence.query.workflow_run_id = publicRun; evidence.query.collected_for_intent_id = null;
  for (const row of [evidence.artifact, evidence.source, evidence.stage]) row.workflow_run_id = publicRun;
  evidence.artifact.metadata.stageKey = 'research'; evidence.source.metadata.stageKey = 'research'; evidence.stage.stage_key = 'research'; evidence.source.content.evidence = structuredClone(pack.evidence); evidence.source.content.providerMetadata = {};
  assert.equal(preflight(f).integrity, 'verified'); const result = inspect(f); assert.ok(has(result, 'new_evidence_run')); assert.equal(result.evidence.length, 0); assert.notEqual(result.reviewState, 'completed_historical_review');
  const relabelled = analysisFixture(); relabelled.analysisSource.dossier.content.packRefs[0].origin = 'prior'; relabelled.analysisSource.dossier.metadata.contentHash = digest(relabelled.analysisSource.dossier.content); relabelled.experiment.analysis_source.dossierHash = digest(relabelled.analysisSource.dossier.content);
  assert.ok(has(inspect(relabelled), 'prior_origin_relabelled'));
});
