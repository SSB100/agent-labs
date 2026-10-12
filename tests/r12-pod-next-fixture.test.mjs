// Socket-free preflight only. Hosted/browser acceptance is a separate CI runner.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, createHmac } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { seedPodNextDatabase, podNextProvider, podNextFailedReview, podNextAudit, podNextRejectedReviewReady, podNextRecoveryResultReady, assertPodLeaseQuiet, podSafeRpcError } from './next-fixture/r12-pod-boundary.mjs';
import { R12_INERT_ROOT } from './next-fixture/r12-sql.mjs';
import { podRpc, podQuoteFixture, podInertOutputs, podSource, podHash, POD_PHASES } from './helpers/r12-pod-sql-fixture.mjs';
const host = process.env.R12_SQL_TEST_HOST;
test('POD Next runner preserves production actions and Workflow host while blocking external transport', () => {
  const runner = readFileSync(new URL('./next-fixture/r12-pod-runner.mjs', import.meta.url), 'utf8');
  assert.match(runner, /WORKFLOW_TARGET_WORLD:'local'/); assert.match(runner, /WORKFLOW_LOCAL_BASE_URL:origin/);
  assert.match(runner, /block-network\.mjs/); assert.match(runner, /runPodNextJourney/);
  const edited = [...runner.matchAll(/writeFile\(path\.join\(fixture,'([^']+)'\)/g)].map(match => match[1]).sort();
  assert.deepEqual(edited, ['next.config.ts', 'src/lib/supabase/client.ts', 'src/lib/supabase/inert-transport.d.mts', 'src/lib/supabase/proxy.ts', 'src/lib/supabase/server.ts']);
  const journey = readFileSync(new URL('./next-fixture/r12-pod-journey.mjs', import.meta.url), 'utf8');
  assert.match(journey, /actual-workflow-runtime-read/); assert.match(journey, /boundary\.result\(receipt\.scopeId\)/);
  assert.doesNotMatch(journey, /continuePodResearchRuntime\(/);
  assert.match(journey, /const deadline = Date\.now\(\) \+ 180000/);
  assert.match(journey, /actual-workflow-lease-release/); assert.match(journey, /release\.at < held\.at/);
  assert.match(journey, /current\(\)\.calls\.length, beforeQuiet\.calls/); assert.match(journey, /held\.at - firstPost\.at < 30000/);
  const boundary = readFileSync(new URL('./next-fixture/r12-pod-boundary.mjs', import.meta.url), 'utf8');
  assert.match(boundary, /leaseExpiresAt: data\?\.head\?\.leaseExpiresAt/);
  assert.doesNotMatch(boundary, /(?:update|set)\s+[^;\n]*lease_expires_at/i);
});
test('the existing Next journey adds failed-pass recovery after its ordinary two-pass path without replacing runtime authority', () => {
  const journey = readFileSync(new URL('./next-fixture/r12-pod-journey.mjs', import.meta.url), 'utf8');
  const ordinary = journey.indexOf('actual background Workflow refines a weak pass'), recovery = journey.indexOf('legacy owner history still saves a rejected reviewer response');
  assert.ok(ordinary >= 0 && recovery > ordinary, 'Keep the original owner/Workflow refinement journey before the additional recovery run');
  for (const required of ["boundary.rejectNextReview()", "name: 'Stop research'", "name: 'Review next-pass recovery'", "action('preparePodResearchRecoveryAction'", 'boundary.audit(failedReceipt.scopeId)', "saved.inputs.pass.history.kind, 'failed_pass_context'", "saved.inputs.pass.history.reviewAccepted, false", "current().calls.length, 30"]) assert.ok(journey.includes(required), required);
  assert.doesNotMatch(journey, /continuePodResearchRuntime\(|driveQuestOnce\(|podRuntimeFixture\(/);
  const boundary = readFileSync(new URL('./next-fixture/r12-pod-boundary.mjs', import.meta.url), 'utf8');
  for (const rpc of ['r12_pod_recovery_read', 'r12_pod_recovery_owner_server']) assert.ok(boundary.includes(rpc));
  assert.match(boundary, /podThoroughSqlTemplate\(db,.*recovery: true/s);
  assert.doesNotMatch(boundary, /update\s+private\.r12_(?:discovery_response_observations|discovery_candidates|pod_templates)/i);
});
test('POD browser expands complete saved findings and provenance in ordinary and recovery result journeys', () => {
  const journey = readFileSync(new URL('./next-fixture/r12-pod-journey.mjs', import.meta.url), 'utf8');
  const disclosures = journey.slice(journey.indexOf('async function assertPodResultDetails('), journey.indexOf('export async function runPodNextJourney('));
  for (const label of ['Full findings and assessment', 'Sources and quoted evidence', 'Full independent review', 'Research provenance']) assert.ok(disclosures.includes(label), label);
  for (const details of ['findings', 'sources', 'review', 'provenance']) assert.ok(disclosures.includes(`await ${details}.locator('summary').click()`), details);
  assert.ok(disclosures.indexOf("await sources.locator('summary').click()") < disclosures.indexOf("source.getAttribute('href')"), 'Open the native evidence disclosure before reading its visible source link');
  for (const proof of ['expected.review.rationale.slice(0, 600)', 'expected.review.nextTest.slice(0, 600)', 'expected.strategy.explorationSummary', 'expected.select1.selections[0].quote', 'expected.plan.query', 'POD_PHASES.map']) assert.ok(disclosures.includes(proof), proof);
  assert.doesNotMatch(disclosures, /includeHidden|evaluate|setAttribute/);
  assert.match(journey, /const secondOutput = podNextThoroughOutputs\(1\)/);
  assert.equal(journey.match(/await assertPodResultDetails\(page, secondOutput, receipt.scopeId\)/g)?.length, 4, 'Check original result, reload, counted malformed recovery, and explicit recovery');
  for (const stage of ['saved sourced second-pass hypothesis', 'a malformed thorough review', 'explicit recovery approval']) {
    const start = journey.indexOf(`await check('${stage}`), end = journey.indexOf('await check(', start + 1);
    assert.ok(start >= 0, stage); assert.match(journey.slice(start, end < 0 ? undefined : end), /await assertPodResultDetails\(page, secondOutput, receipt.scopeId\)/);
  }
});
test('async owner confirmation polls successful null progress until the real rejected review exists', () => {
  const rejected = { phase: 'review', status: 'dispatched', responseDiagnostic: { code: 'response_schema', observationSaved: true, issues: [{ path: '$.nextTest', constraint: 'max_length', limit: 400 }] } };
  const sequence = [null, null, { phases: [] }, { phases: [{ phase: 'plan', status: 'reserved' }] }, { phases: [rejected] }];
  assert.deepEqual(sequence.map(data => podNextRejectedReviewReady({ error: null, data })), [false, false, false, false, true]);
  assert.equal(podNextRejectedReviewReady({ error: null, data: { phases: [{ ...rejected, responseDiagnostic: null }] } }), false);
  for (const response of [null, {}, { error: { message: 'Synthetic RPC failure' }, data: null }, { error: null },
    ...[false, [], {}, { phases: null }, { phases: [null] }, { phases: [{ phase: 'review' }] }, { phases: [{ ...rejected, responseDiagnostic: {} }] }].map(data => ({ error: null, data }))]) {
    assert.throws(() => podNextRejectedReviewReady(response), /POD/, 'Only successful explicit null is pending; malformed present status and real errors must fail');
  }
});
test('recovery result polling waits for async scope/result creation but exposes RPC and present-shape failures', () => {
  const completed = { head: { state: 'completed' } }, running = { head: { state: 'running' } }, absent = { head: null };
  const result = { version: 'r12.pod-saved-result.2', context: { attempt: { adaptiveActionOrdinal: 1 } }, current: { candidate: { output: { outcome: 'HYPOTHESIS_TO_TEST' } } } };
  assert.deepEqual([null, null, result, result].map((data, index) => podNextRecoveryResultReady({ error: null, data }, [absent, running, running, completed][index])), [false, false, false, true]);
  assert.equal(podNextRecoveryResultReady({ error: null, data: { ...result, current: { candidate: { output: { outcome: 'INSUFFICIENT_EVIDENCE' } } } } }, completed), false);
  assert.equal(podNextRecoveryResultReady({ error: null, data: { ...result, context: { attempt: { adaptiveActionOrdinal: 0 } } } }, completed), false);
  for (const response of [{ error: { message: 'Synthetic result failure' }, data: null }, { error: null },
    ...[{}, { ...result, version: 'old' }, { ...result, context: {} }, { ...result, current: {} }].map(data => ({ error: null, data }))]) assert.throws(() => podNextRecoveryResultReady(response, completed), /POD/);
  for (const summary of [null, {}, { head: [] }, { head: {} }]) assert.throws(() => podNextRecoveryResultReady({ error: null, data: null }, summary), /summary/);
  const journey = readFileSync(new URL('./next-fixture/r12-pod-journey.mjs', import.meta.url), 'utf8');
  assert.match(journey, /podNextRejectedReviewReady\(await boundary\.progress\(receipt\.scopeId\)\)/);
  assert.match(journey, /podNextRecoveryResultReady\(saved, summary\)/);
});
test('every Next runner uses the same unmodified R12 dependency fixture, including POD quote forwarding', () => {
  for (const file of ['../scripts/verify-r03-next.mjs', '../scripts/verify-r12-owner-next.mjs', './next-fixture/r12-pod-runner.mjs']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /cp\(path\.join\(root,'tests\/next-fixture\/r12-dependencies\.ts'\),path\.join\(fixture,'src\/products\/discovery-r12-server-dependencies\.ts'\)\)/);
    assert.doesNotMatch(source, /optionAnchor|bodyAnchor|podDependencies|originalDependencies/);
  }
  const loader = readFileSync(new URL('./helpers/r12-terminal-boundary-preflight.mjs', import.meta.url), 'utf8');
  assert.match(loader, /return source\('tests\/next-fixture\/r12-dependencies\.ts'\)/);
  const dependencies = readFileSync(new URL('./next-fixture/r12-dependencies.ts', import.meta.url), 'utf8');
  assert.match(dependencies, /podResearch\?:boolean/); assert.match(dependencies, /podResearch:options\.podResearch/);
});
test('shared legacy Next dependency substitution semantically typechecks the actual POD owner and runtime callers without a host', { timeout: 60000 }, () => {
  const root = fileURLToPath(new URL('../', import.meta.url)), target = path.join(root, 'src/products/discovery-r12-server-dependencies.ts');
  const injected = readFileSync(new URL('./next-fixture/r12-dependencies.ts', import.meta.url), 'utf8');
  const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile); assert.equal(config.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const options = { ...parsed.options, noEmit: true, incremental: false }, compiler = ts.createCompilerHost(options), getSourceFile = compiler.getSourceFile.bind(compiler);
  // Exactly the legacy runner's one-file replacement, applied only to compiler
  // input. Production source, real imports and strict compiler options remain.
  compiler.getSourceFile = (file, languageVersion, onError, fresh) => path.resolve(file) === target ? ts.createSourceFile(file, injected, languageVersion, true) : getSourceFile(file, languageVersion, onError, fresh);
  const program = ts.createProgram({ rootNames: ['next-env.d.ts', 'src/products/discovery-r12-pod-owner-server.ts', 'src/products/discovery-r12-server.ts'].map(file => path.join(root, file)), options, host: compiler });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: file => file, getCurrentDirectory: () => root, getNewLine: () => '\n' }));
  assert.equal(program.getSourceFile(target)?.text, injected, 'The check must compile the copied test dependency, not the production implementation');
});
test('POD lease handoff observer rejects work or premature host retries until the real saved expiry', () => {
  const at = 100000, expiry = at + 60000;
  const handoff = { kind: 'actual-workflow-controller-snapshot', at, leaseExpiresAt: new Date(expiry).toISOString(), runtimeReadOrdinal: 2, providerCalls: 6, receipts: 6 };
  const before = { kind: 'inert-pod-provider', at: at - 1, method: 'POST', phase: 'plan' };
  const resumed = { kind: 'actual-workflow-runtime-read', at: expiry, runtimeReadOrdinal: 3 };
  assert.doesNotThrow(() => assertPodLeaseQuiet([before, handoff, resumed, { kind: 'inert-pod-provider', at: expiry + 1, method: 'POST', phase: 'search1' }], handoff));
  for (const event of [
    { kind: 'inert-pod-provider', method: 'POST' },
    { kind: 'actual-workflow-controller-call', operation: 'claim' },
    { kind: 'actual-workflow-controller-call', operation: 'cancel' },
    { kind: 'actual-workflow-runtime-read', runtimeReadOrdinal: 3 },
    { kind: 'actual-workflow-pass', operation: 'admit' },
  ]) assert.throws(() => assertPodLeaseQuiet([before, handoff, { ...event, at: expiry - 1 }], handoff), /neither claim nor send/);
  assert.throws(() => assertPodLeaseQuiet([], handoff), /real controller snapshot/);
  const expired = { ...handoff, at: expiry }; assert.throws(() => assertPodLeaseQuiet([expired], expired), /real controller snapshot/);
});
test('POD runtime diagnostics retain exact symbolic SQL failure without raw keys, arguments or database detail', () => {
  assert.deepEqual(podSafeRpcError({ code: '42501', message: 'r07_lease_held', detail: 'must never be persisted' }), { code: '42501', reason: 'r07_lease_held' });
  for (const message of [R12_INERT_ROOT, 'r07_lease_held: p_server_key=private', 'f'.repeat(64), 'select private_key from secret']) {
    const diagnostic = podSafeRpcError({ code: 'not-a-code', message, detail: R12_INERT_ROOT, parameters: { p_server_key: R12_INERT_ROOT } });
    assert.deepEqual(diagnostic, { code: null, reason: 'redacted_database_error' });
    assert.ok(!JSON.stringify(diagnostic).includes(R12_INERT_ROOT));
  }
});
test('POD Next seed uses actual migrations and a synthetic template without execution authority', { skip: !host, timeout: 90000 }, async () => {
  const { db, seeded } = await seedPodNextDatabase(host);
  try {
    const capability = createHmac('sha256', R12_INERT_ROOT).update('r12.pod-owner-application.1').digest('base64url');
    const catalog = await podRpc(db, 'authenticated', seeded.ownerId, 'r12_pod_research_read', [seeded.businessId, null, null, null]);
    assert.equal(catalog.setups.length, 0); assert.equal(catalog.business.ready, true);
    const stored = (await db.query('select server_key_hash from private.r12_pod_templates where id=$1', [seeded.templateId])).rows[0];
    assert.equal(stored.server_key_hash, createHash('sha256').update(capability).digest('hex'));
    const recovery = (await db.query("select source_policy_hash,pins,pins_hash,server_key_hash from private.r12_pod_templates where version='r12.pod-template.3'")).rows;
    assert.equal(recovery.length, 1); assert.equal(recovery[0].source_policy_hash, podHash(seeded.sourcePolicy));
    assert.equal(recovery[0].server_key_hash, stored.server_key_hash); assert.equal(recovery[0].pins_hash, podHash(recovery[0].pins));
    assert.deepEqual(recovery[0].pins.schemas, podSource('products/discovery-r12-pod-runtime').podResearchSchemaPins(true));
    assert.equal(catalog.template.id, seeded.templateId, 'A recovery-only template cannot become the ordinary new-run template');
    assert.deepEqual(await podNextAudit(db, seeded.templateId), { attempts: [], observations: [] }, 'Read-only browser audit queries must use the actual migrated response tables');
    const prepared = await podRpc(db, 'authenticated', seeded.ownerId, 'r12_pod_owner_server', [seeded.businessId, 'prepare', { input: seeded.input, quote: podQuoteFixture() }, capability]);
    assert.equal(prepared.activated, false); assert.equal(prepared.confirmed, false);
    assert.equal(prepared.preview.version, 'r12.pod-research-preview.2'); assert.equal(prepared.preview.quote.version, 'r12.pod-quote.2');
    assert.equal(prepared.preview.maximumPasses, 5); assert.equal(prepared.preview.maximumCalls, 25); assert.equal(prepared.preview.maximumCollections, 5);
    assert.deepEqual((await db.query('select (select count(*)::int from private.r12_discovery_scopes) scopes,(select count(*)::int from private.r05_requests) requests')).rows[0], { scopes: 0, requests: 0 });
  } finally { await db.close(); }
});

test('POD browser provider double binds every phase to its admitted pass and refines one weak query', () => {
  const state = { r12: { scopeId: 'inert-scope', calls: [], receipts: [], podPass: null } }, phase0 = podInertOutputs({ passOrdinal: 0 });
  const request = (ordinal, phase) => {
    const output = podInertOutputs({ passOrdinal: ordinal, useful: ordinal === 1 });
    const refinement = ordinal === 0 ? null : { previousPass: 0, review: phase0.review, priorQueries: [{ query: phase0.plan.query }] };
    return { phase, method: 'POST', url: 'https://openrouter.ai/api/v1/chat/completions', body: { provider: { only: [phase === 'review' ? 'amazon-bedrock/us' : 'azure/us'], zdr: true }, messages: [{ role: 'system', content: 'Inert fixture request' }, { role: 'user', content: phase === 'search1' ? output.plan.query : JSON.stringify({ refinement }) }], ...(phase === 'search1' ? { tools: [{ parameters: { allowed_domains: output.plan.sourceDomains } }] } : {}) } };
  };
  assert.throws(() => podNextProvider(state, request(0, 'plan')), /real admitted/);
  const outputs = [];
  for (const ordinal of [0, 1]) {
    state.r12.podPass = { ordinal, actionHash: String(ordinal).repeat(64) };
    for (const phase of POD_PHASES) {
      const input = request(ordinal, phase), response = podNextProvider(state, input); assert.equal(response.status, 200);
      assert.throws(() => podNextProvider(state, input), /never regenerate/);
      assert.equal(podNextProvider(state, { method: 'GET', phase, url: `https://openrouter.ai/api/v1/generation?id=${response.body.id}` }).body.data.id, response.body.id);
      if (phase === 'review') outputs.push(JSON.parse(response.body.choices[0].message.content).outcome);
    }
  }
  assert.deepEqual(outputs, ['INSUFFICIENT_EVIDENCE', 'HYPOTHESIS_TO_TEST']);
  assert.equal(state.r12.calls.length, 10); assert.equal(state.r12.receipts.length, 10);
  const searches = state.r12.calls.filter(call => call.phase === 'search1'); assert.notEqual(searches[0].query, searches[1].query);
  state.r12.podPass = { ordinal: 2, actionHash: '2'.repeat(64) }; assert.throws(() => podNextProvider(state, request(1, 'plan')), /real admitted/);
});

test('the recovery provider double creates only length failures and requires labelled unaccepted history for its fresh pass', () => {
  const failed = podNextFailedReview(), schema = podSource('products/discovery-r12-pod-analysis').podResearchSchema('review');
  const issues = podSource('workers/schema-validator').validateJsonSchemaValue(schema, failed);
  assert.deepEqual(issues.map(issue => issue.path), [1, 2, 3, 4, 5].map(index => `$.checks[${index}].rationale`).concat('$.nextTest'));
  assert.ok(issues.every(issue => /^must contain no more than (240|400) characters$/.test(issue.message)));
  assert.equal(failed.outcome, 'INSUFFICIENT_EVIDENCE'); assert.equal(failed.candidateIndex, null);
  const state = { r12: { scopeId: 'inert-failed-scope', calls: [], receipts: [], podPass: { ordinal: 0 }, rejectNextReview: true } };
  const history = { kind: 'failed_pass_context', previousPass: 0, reviewAccepted: false, failureKind: 'review_length_rejected',
    untrustedCritique: failed, acceptedAssessment: { recommendation: { outcome: 'INSUFFICIENT_EVIDENCE' } },
    acceptedOutputHashes: POD_PHASES.slice(0, 4).map(phase => ({ phase, responseHash: 'a'.repeat(64) })), priorQueries: [{ query: podInertOutputs({ passOrdinal: 0 }).plan.query }] };
  const request = (ordinal, phase) => {
    const output = podInertOutputs({ passOrdinal: ordinal, useful: ordinal === 1 });
    return { phase, method: 'POST', url: 'https://openrouter.ai/api/v1/chat/completions', body: { provider: { only: [phase === 'review' ? 'amazon-bedrock/us' : 'azure/us'], zdr: true },
      messages: [{ role: 'system', content: podSource('products/discovery-r12-pod-runtime').podResearchSystemInstruction('plan', true) }, { role: 'user', content: phase === 'search1' ? output.plan.query : JSON.stringify({ refinement: ordinal === 0 ? null : history }) }],
      ...(phase === 'search1' ? { tools: [{ parameters: { allowed_domains: output.plan.sourceDomains } }] } : {}) } };
  };
  for (const phase of POD_PHASES) {
    const response = podNextProvider(state, request(0, phase));
    if (phase === 'review') assert.deepEqual(JSON.parse(response.body.choices[0].message.content), failed);
  }
  assert.equal(state.r12.rejectNextReview, false); assert.equal(state.r12.calls.length, 5);
  state.r12.scopeId = 'inert-recovery-scope'; state.r12.podPass = { ordinal: 1 };
  const malformed = request(1, 'plan'); history.reviewAccepted = true;
  malformed.body.messages[1].content = JSON.stringify({ refinement: history });
  assert.throws(() => podNextProvider(state, malformed)); assert.equal(state.r12.calls.length, 5);
  history.reviewAccepted = false;
  for (const phase of POD_PHASES) {
    const response = podNextProvider(state, request(1, phase));
    assert.throws(() => podNextProvider(state, request(1, phase)), /never regenerate/);
    if (phase === 'review') assert.equal(JSON.parse(response.body.choices[0].message.content).outcome, 'HYPOTHESIS_TO_TEST');
  }
  assert.equal(state.r12.calls.length, 10); assert.deepEqual(failed, podNextFailedReview(), 'The original failed provider output was not shortened or rewritten');
  state.r12.scopeId = 'inert-unrelated-scope'; state.r12.podPass = { ordinal: 0 };
  assert.equal(podNextProvider(state, request(0, 'plan')).status, 200, 'Generation uniqueness is scoped to the actual run as well as pass/phase');
});
