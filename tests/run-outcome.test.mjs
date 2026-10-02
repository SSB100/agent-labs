import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript'), React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
function loadSource(path, dependencies) {
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const fixtureModule = { exports: {} };
  runInNewContext(`(function(require, module, exports) { ${code}\n})`)(name => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  }, fixtureModule, fixtureModule.exports);
  return fixtureModule.exports;
}
const workflows = loadSource('src/lib/core-ui/workflows.ts', {});
const outcome = loadSource('src/lib/core-ui/run-outcome.ts', { './workflows': workflows });
const { summarizeRunOutcome, researchOutcomeCosts, creativeOutcomeCosts, modelOutcomeCosts, summarizeOutcomeSpending } = outcome;
const { RunOutcome } = loadSource('src/components/guided/run-outcome.tsx', {
  'react/jsx-runtime': require('react/jsx-runtime'),
  'next/link': ({ href, children, ...props }) => React.createElement('a', { href, ...props }, children),
  '@/lib/core-ui/run-outcome': outcome, './run-outcome.css': {},
});
const ready = (...records) => ({ status: 'ready', records });
const time = '2026-10-02T04:00:00Z';
const business = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const workflowId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const intentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const creativeId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const run = { id: workflowId, business_id: business, workflow_definition_id: 'definition-one', status: 'failed', current_stage_key: 'review', input: { intentId }, state: {}, completed_at: time };
const definition = { id: run.workflow_definition_id, workflow_key: 'product.discovery-v2.two', version: '1.0.0' };
const intent = { id: intentId, businessId: business, version: 'pod-discovery-2.0', objective: 'Research original nature T-shirts for an evidence-based starting market', limits: { maximumMicrousd: 1_000_000 } };
const experiment = { id: intentId, business_id: business, workflow_run_id: workflowId, discovery_version: 'pod-discovery-2.0', variables: { intent }, status: 'failed' };
const artifact = (id, type, content = {}, metadata = {}) => ({ id, business_id: business, workflow_run_id: workflowId, artifact_type: type, content, metadata });
const fixture = (changes = {}) => ({ run, definition, artifacts: ready(), experiments: ready(experiment), interventions: ready(), ...changes });
const creativeRun = { id: creativeId, business_id: business, workflow_run_id: workflowId, approval_id: 'approved-one' };
const creativeApproval = { id: 'approved-one', business_id: business, purpose: 'technical_qualification', maximum_microusd: 1_000_000 };
const creativeFixture = (changes = {}) => fixture({ run: { ...run, current_stage_key: 'review:1', input: { creativeRunId: creativeId } }, definition: { ...definition, workflow_key: 'etsy.creative-pipeline' }, creativeRuns: ready(creativeRun), creativeApprovals: ready(creativeApproval), ...changes });
const reservation = (id = 'reservation-one', changes = {}) => ({ id, business_id: business, workflow_run_id: workflowId, experiment_id: intentId, attempt_key: 'review:1', reserved_microusd: 90_000, ...changes });
const settlement = (changes = {}) => ({ id: 'settled-one', business_id: business, reservation_id: 'reservation-one', reported_microusd: 12_345, provider_request_id: 'request-one', ...changes });

test('failed research preserves only observed evidence and routes to existing gated recovery', () => {
  const result = summarizeRunOutcome(fixture({ artifacts: ready(artifact('sources', 'research.sources'), artifact('pack', 'worker.output', { evidencePack: {} })) }));
  assert.equal(result.title, 'This research round stopped');
  assert.match(result.summary, /stopped during review/);
  assert.equal(result.goal, intent.objective);
  assert.ok(result.retained.some(value => /1 saved Evidence Pack/.test(value)));
  assert.ok(result.retained.some(value => /collection alone does not establish/.test(value)));
  assert.equal(result.next.href, `/dashboard/products?business=${business}&view=results#discovery-goal-results`);
  assert.match(result.next.detail, /only when its recorded prerequisites permit/);
  assert.ok(result.blocked.some(value => /not a market verdict/.test(value)));
  assert.equal(result.spending.value, 'Not checked');
  assert.match(result.spending.allowance, /US\$1.00.*not a guaranteed provider invoice cap/);
});

test('goal never comes from fabricated inline input; identities must match persisted records', () => {
  const inline = fixture({ run: { ...run, input: { intentId, intent } }, experiments: ready() });
  assert.equal(summarizeRunOutcome(inline).goal, null);
  for (const change of [{ business_id: 'foreign' }, { workflow_run_id: 'foreign' }, { id: 'foreign' }, { discovery_version: 'other' }, { variables: { intent: { ...intent, businessId: 'foreign' } } }]) {
    assert.equal(summarizeRunOutcome(fixture({ experiments: ready({ ...experiment, ...change }) })).goal, null);
  }
  const saved = artifact('intent', 'product.discovery-intent.v2', { intent }, { intentId });
  assert.equal(summarizeRunOutcome(fixture({ experiments: ready(), artifacts: ready(saved) })).goal, intent.objective);
  assert.equal(summarizeRunOutcome(fixture({ experiments: ready(), artifacts: ready({ ...saved, metadata: { intentId: 'foreign' } }) })).goal, null);
});

test('foreign review and evidence cannot confer an outcome on this Business/run', () => {
  const other = artifact('other-review', 'worker.output', { version: 'pod-discovery-2.0', intentId, outcome: 'TEST' }, { stageKey: 'review' });
  for (const scope of [{ business_id: 'foreign' }, { workflow_run_id: 'foreign' }]) {
    const result = summarizeRunOutcome(fixture({ run: { ...run, status: 'completed' }, artifacts: ready({ ...other, ...scope }) }));
    assert.equal(result.title, 'Research run completed');
    assert.ok(result.blocked.some(value => /No independent research decision/.test(value)));
  }
});

test('completed research describes the recorded decision without granting generation or sales', () => {
  for (const [recorded, title] of [['TEST', 'A bounded test is recommended'], ['REJECT', 'The reviewed proposal was rejected'], ['NEEDS_MORE_EVIDENCE', 'More evidence is needed']]) {
    const review = artifact('review', 'worker.output', { version: 'pod-discovery-2.0', intentId, outcome: recorded, sufficiencyRationale: 'The preserved comparison supports only the bounded recorded conclusion.', missingQuestions: ['Which dated price evidence is missing?'] }, { stageKey: 'review' });
    const result = summarizeRunOutcome(fixture({ run: { ...run, status: 'completed' }, artifacts: ready(review) }));
    assert.equal(result.title, title);
    assert.match(result.summary, /preserved comparison/);
    assert.ok(result.blocked.some(value => /needs its own eligible approval/.test(value)));
    assert.ok(result.blocked.includes('Which dated price evidence is missing?'));
  }
});

test('unavailable reads differ from successful missing records', () => {
  const unavailable = summarizeRunOutcome(fixture({ artifacts: { status: 'unavailable' }, experiments: { status: 'unavailable' } }));
  assert.match(unavailable.readWarning, /read problem/);
  assert.ok(unavailable.retained.some(value => /may still exist/.test(value)));
  assert.ok(unavailable.blocked.some(value => /could not be checked/.test(value)));
  const empty = summarizeRunOutcome(fixture({ experiments: ready() }));
  assert.equal(empty.readWarning, null);
  assert.ok(empty.retained.some(value => /No saved output artifacts/.test(value)));
});

test('a terminal creative needs_owner run is stopped rather than a current worker', () => {
  const result = summarizeRunOutcome(creativeFixture({ run: { ...run, input: { creativeRunId: creativeId }, status: 'needs_owner', current_stage_key: 'review:1' } }));
  assert.equal(result.title, 'Design work stopped for review');
  assert.match(result.summary, /image review/);
  assert.match(result.next.href, new RegExp(`business=${business}`));
  assert.match(result.next.href, new RegExp(`#creative-run-${creativeId}$`));
  assert.ok(result.blocked.some(value => /PASS alone does not authorize/.test(value)));
});

test('technical qualification stays distinct from saved production approval', () => {
  const completed = { ...run, status: 'completed', state: { productionReady: true } };
  const technical = summarizeRunOutcome(creativeFixture({ run: completed }));
  assert.equal(technical.title, 'Technical run completed');
  assert.match(technical.summary, /technical PASS does not make this design production-ready/);
  const production = summarizeRunOutcome(creativeFixture({ run: completed, creativeApprovals: ready({ ...creativeApproval, purpose: 'candidate_production' }) }));
  assert.equal(production.title, 'Design passed its saved production approval');
  assert.match(production.summary, /Current eligibility still needs to be checked/);
  const wrongApproval = summarizeRunOutcome(creativeFixture({ run: completed, creativeApprovals: ready({ ...creativeApproval, business_id: 'foreign', purpose: 'candidate_production' }) }));
  assert.equal(wrongApproval.title, 'Technical run completed');
});

test('only exact retained creative source provenance is described as retained after failure', () => {
  const source = { creativeRunId: creativeId, callKey: 'generate:1', storagePath: `${business}/${creativeId}/version-1.original.webp`, bytes: 2500, sha256: 'a'.repeat(64), downloadVerified: true, mediaType: 'image/webp' };
  const result = summarizeRunOutcome(creativeFixture({ retainedCreativeSources: ready(source) }));
  assert.ok(result.retained.some(value => /1 unvalidated provider source/.test(value)));
  assert.ok(result.retained.some(value => /not a usable design or review PASS/.test(value)));
  for (const change of [{ creativeRunId: 'foreign' }, { storagePath: 'foreign/path' }, { sha256: '' }, { callKey: 'generate:3' }]) {
    assert.ok(!summarizeRunOutcome(creativeFixture({ retainedCreativeSources: ready({ ...source, ...change }) })).retained.some(value => /unvalidated provider/.test(value)));
  }
});

test('external uncertainty takes priority over every success and never exposes retry', () => {
  for (const [type, path] of [['etsy.publication.reconcile', '/dashboard/etsy'], ['printful.product.reconcile', '/dashboard/printful']]) {
    const intervention = { id: 'intervention-one', business_id: business, workflow_run_id: workflowId, intervention_type: type, status: 'open', title: 'Check exact external identity' };
    const result = summarizeRunOutcome(fixture({ run: { ...run, status: 'completed' }, interventions: ready(intervention) }));
    assert.equal(result.title, 'Check the existing external result');
    assert.ok(result.next.href.startsWith(path));
    assert.match(result.next.href, /intervention-one/);
    assert.match(result.next.detail, /does not authorize a blind retry/);
    assert.ok(result.blocked.some(value => /Do not repeat the external write/.test(value)));
    assert.notEqual(summarizeRunOutcome(fixture({ interventions: ready({ ...intervention, business_id: 'foreign' }) })).title, result.title);
  }
});

test('research totals count the same appended receipt once and exclude other Business/run costs', () => {
  const cost = researchOutcomeCosts(run, ready(reservation(), reservation('foreign', { workflow_run_id: 'other' })), ready(settlement(), settlement({ id: 'settled-again' }), settlement({ id: 'foreign', business_id: 'other', reported_microusd: 1_000_000 })));
  const result = summarizeOutcomeSpending(run, cost);
  assert.equal(result.value, 'US$0.01');
  assert.ok(result.exactAmounts.some(value => value.value === 'US$0.012345'));
  assert.match(result.reservation, /US\$0.09 reserved/);
  assert.match(result.reservation, /not added/);
  assert.equal(result.uncertain, false);
});

test('mixed receipts show known charges, keep unknown distinct, and do not fabricate a total', () => {
  const cost = researchOutcomeCosts(run, ready(reservation(), reservation('pending')), ready(settlement()));
  const result = summarizeOutcomeSpending(run, cost);
  assert.equal(result.label, 'Known reported charges');
  assert.equal(result.value, 'US$0.01');
  assert.match(result.detail, /1 of 2.*unknown charge/);
  assert.match(result.detail, /not a complete spending total/);
  assert.equal(result.uncertain, true);
});

test('all unknown calls never display an invented zero provider charge', () => {
  for (const missing of [ready(), ready(settlement({ reported_microusd: null })), ready(settlement({ provider_request_id: null }))]) {
    const result = summarizeOutcomeSpending(run, researchOutcomeCosts(run, ready(reservation()), missing));
    assert.equal(result.value, 'Charge unknown');
    assert.equal(result.uncertain, true);
    assert.doesNotMatch(result.value, /0.00/);
  }
  const explicitZero = summarizeOutcomeSpending(run, researchOutcomeCosts(run, ready(reservation()), ready(settlement({ reported_microusd: 0 }))));
  assert.equal(explicitZero.value, 'US$0.00');
});

test('empty and unavailable ledgers are not represented as free work', () => {
  assert.equal(summarizeOutcomeSpending(run, researchOutcomeCosts(run, ready(), ready())).value, 'No calls recorded');
  for (const status of ['unavailable', 'not_loaded']) {
    const value = summarizeOutcomeSpending(run, researchOutcomeCosts(run, ready(reservation()), { status }));
    assert.equal(value.value, status === 'unavailable' ? 'Unavailable' : 'Not checked');
    assert.match(value.detail, /zero.spend/);
  }
});

test('conflicting or reused provider receipt identity cannot inflate known charges', () => {
  const conflict = researchOutcomeCosts(run, ready(reservation()), ready(settlement(), settlement({ id: 'another-provider', provider_request_id: 'request-two' })));
  assert.equal(summarizeOutcomeSpending(run, conflict).value, 'Charge unknown');
  const repeated = researchOutcomeCosts(run, ready(reservation(), reservation('second')), ready(settlement(), settlement({ id: 'second', reservation_id: 'second' })));
  assert.equal(summarizeOutcomeSpending(run, repeated).value, 'Charge unknown');
});

test('creative ledger joins persisted same-Business run and retains settlement-only snapshots', () => {
  const reserved = ready({ business_id: business, creative_run_id: creativeId, call_key: 'brief:1', reserved_microusd: 100_000 });
  const settled = ready({ business_id: business, creative_run_id: creativeId, call_key: 'screen:1', reported_microusd: 15_000, provider_request_id: 'receipt-screen' });
  const result = summarizeOutcomeSpending(run, creativeOutcomeCosts(run, creativeRun, reserved, settled));
  assert.equal(result.value, 'US$0.02');
  assert.ok(result.exactAmounts.some(value => value.value === 'US$0.015'));
  assert.match(result.reservation, /At least US\$0.10/);
  assert.match(result.detail, /1 of 2.*unknown/);
  assert.equal(creativeOutcomeCosts(run, { ...creativeRun, workflow_run_id: 'other' }, reserved, settled).calls.status, 'unavailable');
});

test('model reported charges never use estimates or unrelated telemetry', () => {
  const row = { id: 'invocation', business_id: business, workflow_run_id: workflowId, reported_cost_usd: null, estimated_cost_usd: 1234, provider_request_id: 'request' };
  assert.equal(summarizeOutcomeSpending(run, modelOutcomeCosts(run, ready(row))).value, 'Charge unknown');
  const tiny = summarizeOutcomeSpending(run, modelOutcomeCosts(run, ready({ ...row, reported_cost_usd: '0.00000001' }, { ...row, id: 'foreign', business_id: 'foreign', reported_cost_usd: '1' })));
  assert.equal(tiny.value, '<US$0.01');
  assert.ok(tiny.exactAmounts.some(value => value.value === 'US$0.00000001'));
  const modelCost = modelOutcomeCosts(run, ready({ ...row, reported_cost_usd: 5 }));
  assert.equal(summarizeRunOutcome(fixture({ costs: modelCost })).spending.value, 'Not checked');
});

test('spending rejects costs from a different Business or run', () => {
  const cost = researchOutcomeCosts(run, ready(reservation()), ready(settlement()));
  for (const change of [{ businessId: 'foreign' }, { workflowRunId: 'foreign' }]) {
    assert.equal(summarizeOutcomeSpending(run, { ...cost, ...change }).value, 'Unavailable');
  }
});

test('queued, running, owner-wait and demo outcomes describe only actual saved status', () => {
  for (const [status, title] of [['queued', 'Queued to start'], ['running', 'Work is in progress'], ['waiting', 'Waiting for the next step'], ['needs_owner', 'Waiting for your decision']]) {
    const result = summarizeRunOutcome(fixture({ run: { ...run, status, completed_at: null } }));
    assert.equal(result.title, title);
    assert.match(result.summary, /No final outcome is recorded/);
    assert.doesNotMatch(result.summary, /four agents|recruit/i);
  }
  const demo = summarizeRunOutcome(fixture({ run: { ...run, status: 'completed' }, definition: { ...definition, workflow_key: 'synthetic.core.runtime-proof' } }));
  assert.equal(demo.title, 'Demo completed');
  assert.match(demo.summary, /not evidence of a researched/);
});

test('outcome UI is readable without JSON, exposes one real next link and no new actions', () => {
  const html = renderToStaticMarkup(React.createElement(RunOutcome, fixture()));
  for (const label of ['Saved outcome', 'What is retained', 'What still needs attention', 'Spending for this run', 'Next step', intent.objective]) assert.ok(html.includes(label), label);
  assert.equal((html.match(/<a /g) ?? []).length, 1);
  assert.doesNotMatch(html, /<form|<pre|<code|type="submit"|Retry now|Start again|Start design/);
  const css = readFileSync('src/components/guided/run-outcome.css', 'utf8');
  assert.match(css, /font-size:16px/);
  assert.match(css, /font-size:14px/);
  assert.match(css, /min-height:44px/);
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /focus-visible/);
});
