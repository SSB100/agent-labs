import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ui from '../.core-tests/lib/core-ui/workflows.js';

const require = createRequire(import.meta.url), ts = require('typescript');
function load(path, dependencies) {
  const source = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const fixtureModule = { exports: {} };
  runInNewContext(`(function(require,module,exports){${source}\n})`, { console: { error() {} } })(name => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, fixtureModule, fixtureModule.exports);
  return fixtureModule.exports;
}
const businessId = '10000000-1111-4111-8111-111111111111';
const runId = '20000000-1111-4111-8111-111111111111';
const interventionId = '30000000-1111-4111-8111-111111111111';
const ownerId = '40000000-1111-4111-8111-111111111111';
const date = '2026-10-02T03:00:00.000Z';
const definition = { ...ui.SYNTHETIC_REVIEW_WORKFLOW, name: 'Runtime proof', description: 'Bounded proof', status: 'qualified',
  stage_definition: { stages: ['start', 'worker-task', 'wait', 'review', 'complete'].map((key, sequence) => ({ key, sequence })) } };
const run = { id: runId, business_id: businessId, workflow_definition_id: definition.id, status: 'needs_owner', current_stage_key: 'review',
  input: {}, state: {}, runtime_provider: 'vercel_workflow', runtime_run_id: 'runtime-proof', started_at: date, completed_at: null, created_at: date, updated_at: date };
const intervention = { id: interventionId, business_id: businessId, workflow_run_id: runId, intervention_type: 'synthetic_workflow_review', status: 'open',
  title: 'Review this run', description: 'Review the durable results', options: {}, resolution: {}, requested_at: date, resolved_at: null, created_at: date, updated_at: date };
const creativeDefinition = { ...definition, id: '50000000-1111-4111-8111-111111111111', workflow_key: 'etsy.creative-pipeline',
  stage_definition: { stages: ['brief', 'screen', 'review'].map((key, sequence) => ({ key, sequence })) } };
const creativeRun = { ...run, workflow_definition_id: creativeDefinition.id, status: 'completed', current_stage_key: null, completed_at: date };
function stage(stage_key, sequence, status = 'completed', overrides = {}) {
  return { id: `stage-${stage_key}`, workflow_run_id: runId, stage_key, sequence, attempt: 1, status, input: {}, output: {}, failure: {},
    started_at: status === 'pending' ? null : date, completed_at: status === 'completed' ? date : null, created_at: date, updated_at: date, ...overrides };
}
const creativeStages = ['brief:1', 'screen:1', 'generate:1', 'review:1'].map((key, index) => stage(key, index + 1));
const noop = () => {};
const visuals = load('src/components/stage7/workflow-visuals.tsx', {
  'react/jsx-runtime': require('react/jsx-runtime'),
  'next/link': ({ href, children, ...props }) => React.createElement('a', { href, ...props }, children),
  '@/app/dashboard/actions': { resumeSyntheticReview: noop },
  '@/app/dashboard/packs/actions': { acknowledgeEtsySimulation: noop },
  '@/app/dashboard/browser-actions': { resumeBrowserControl: noop },
  '@/lib/core-ui/workflows': ui, './icons': { CoreIcon: () => null }, './app-shell': { StatusPill: () => null },
});
const card = (entry, props = {}) => renderToStaticMarkup(React.createElement(visuals.NeedsYouCard, { intervention: entry, returnTo: '/dashboard/needs-you', ...props }));

test('unknown, validation and creative interventions are inspect-only even with synthetic options', () => {
  for (const intervention_type of ['creative_review', 'validation_failure', 'future_review', 'review', 'synthetic_workflow_review ']) {
    const entry = { ...intervention, intervention_type, options: { approve: true } };
    assert.equal(ui.interventionAction(entry, run, definition).kind, 'link');
    const html = card(entry, { run, definition });
    assert.match(html, /View details/);
    assert.ok(html.includes(`/dashboard/workflows/${runId}`));
    assert.doesNotMatch(html, /<form|Approve and complete|Fail workflow|name="decision"/);
  }
});

test('synthetic buttons require exact type, open run, linked Business and registered definition', () => {
  assert.equal(ui.canResumeSyntheticReview(intervention, run, definition), true);
  assert.match(card(intervention, { run, definition }), /Approve and complete/);
  const cases = [
    [intervention, undefined, definition], [intervention, run, undefined],
    [{ ...intervention, status: 'resolved' }, run, definition],
    [{ ...intervention, workflow_run_id: null }, run, definition],
    [{ ...intervention, business_id: 'another-business' }, run, definition],
    [intervention, { ...run, id: 'another-run' }, definition],
    [intervention, { ...run, status: 'running' }, definition],
    [intervention, { ...run, current_stage_key: 'worker-task' }, definition],
    [intervention, { ...run, completed_at: date }, definition],
    [intervention, creativeRun, creativeDefinition],
    [intervention, run, { ...definition, workflow_key: 'other-proof' }],
    [intervention, run, { ...definition, version: '2.0.0' }],
    [intervention, { ...run, workflow_definition_id: 'copy' }, { ...definition, id: 'copy' }],
  ];
  for (const [entry, candidateRun, candidateDefinition] of cases) {
    assert.equal(ui.canResumeSyntheticReview(entry, candidateRun, candidateDefinition), false);
    assert.doesNotMatch(card(entry, { run: candidateRun, definition: candidateDefinition }), /<form|Approve and complete|Fail workflow/);
  }
  assert.ok(readFileSync('src/workflows/synthetic-runtime.ts', 'utf8').includes(`"${ui.SYNTHETIC_REVIEW_WORKFLOW.id}"`));
});

test('browser and simulation requests preserve their specific controls', () => {
  for (const [type, kind, text] of [
    ['browser_takeover', 'browser_control', 'Take Control'],
    ['browser_return_control', 'browser_control', 'Return Control'],
    ['etsy_simulation_review', 'simulation_review', 'Acknowledge simulated result'],
  ]) {
    const entry = { ...intervention, intervention_type: type };
    assert.equal(ui.interventionAction(entry).kind, kind);
    assert.match(card(entry), /<form/); assert.ok(card(entry).includes(text));
    assert.doesNotMatch(card(entry), /Approve and complete|Fail workflow/);
    assert.equal(ui.interventionAction({ ...entry, status: 'resolved' }).kind, 'link');
    assert.equal(ui.interventionAction({ ...entry, workflow_run_id: null }).kind, 'link');
  }
});

test('reconciliation links retain exact encoded business and intervention identity', () => {
  for (const [type, path] of [
    ['etsy.publication.reconcile', '/dashboard/etsy?business=business%26other&publicationRequest=request%2Fid#publication-history'],
    ['printful.product.reconcile', '/dashboard/printful?business=business%26other&intervention=request%2Fid#product-configuration-history'],
  ]) {
    const entry = { ...intervention, intervention_type: type, business_id: 'business&other', id: 'request/id', workflow_run_id: null };
    const action = ui.interventionAction(entry);
    assert.equal(action.kind, 'link'); assert.equal(action.href, path);
    assert.doesNotMatch(card(entry), /<form|Approve and complete|Fail workflow/);
  }
});

test('completed creative timeline uses durable phases including image generation', () => {
  const result = ui.workflowTimelineStages(creativeDefinition, creativeRun, creativeStages);
  assert.deepEqual(result.map(item => item.key), ['brief:1', 'screen:1', 'generate:1', 'review:1']);
  assert.deepEqual(result.map(item => item.label), ['Brief', 'Brief screen', 'Generate image', 'Image review']);
  assert.ok(result.every(item => item.status === 'completed' && item.recorded && !item.isCurrent));
  const html = renderToStaticMarkup(React.createElement(visuals.WorkflowTimeline, { definition: creativeDefinition, run: creativeRun, stages: creativeStages }));
  assert.doesNotMatch(html, /Upcoming|aria-current|visualStage-current/);
  assert.equal((html.match(/Completed/g) ?? []).length, 4);
});

test('terminal missing phases are Not recorded and skipped/pending phases are Not run', () => {
  const partial = [creativeStages[0], stage('generate:1', 3, 'pending'), stage('review:1', 4, 'skipped')];
  const result = ui.workflowTimelineStages(creativeDefinition, creativeRun, partial);
  assert.deepEqual(result.map(item => item.status), ['completed', 'not_recorded', 'not_run', 'not_run']);
  assert.equal(result[1].detail, 'Not recorded'); assert.equal(result[2].detail, 'Not run');
  assert.ok(result.every(item => item.detail !== 'Upcoming'));
  const unrecorded = ui.workflowTimelineStages(creativeDefinition, creativeRun, []);
  assert.ok(unrecorded.every(item => item.status === 'not_recorded'));
  const unknown = ui.workflowTimelineStages(undefined, { ...creativeRun, current_stage_key: null }, []);
  assert.equal(unknown[0].detail, 'Not recorded');
});

test('active current-stage position cannot fabricate earlier completions', () => {
  const result = ui.workflowTimelineStages(definition, { ...run, status: 'running' }, [stage('review', 3, 'running')]);
  assert.deepEqual(result.map(item => item.status), ['not_recorded', 'not_recorded', 'not_recorded', 'running', 'pending']);
  assert.equal(result.filter(item => item.isCurrent).length, 1);
  const unknown = ui.workflowTimelineStages(definition, { ...run, current_stage_key: 'unknown' }, []);
  assert.ok(unknown.every(item => item.status === 'not_recorded'));
});

test('creative terminal needs_owner preserves failure and never promises upcoming repair', () => {
  const stopped = { ...creativeRun, status: 'needs_owner', current_stage_key: 'brief:1' };
  const result = ui.workflowTimelineStages(creativeDefinition, stopped, [stage('brief:1', 1, 'failed'), ...creativeStages.slice(1).map(item => ({ ...item, status: 'skipped' }))]);
  assert.deepEqual(result.map(item => item.status), ['failed', 'not_run', 'not_run', 'not_run']);
  assert.ok(result.every(item => !item.isCurrent));
  const stale = ui.workflowTimelineStages(creativeDefinition, stopped, [stage('brief:1', 1, 'running')]);
  assert.match(stale[0].detail, /Last recorded: Working.*run ended/);
});

test('repair phases are separate recorded steps, and future/foreign keys never alias to completion', () => {
  const result = ui.workflowTimelineStages(creativeDefinition, creativeRun, [
    ...creativeStages, stage('generate:2', 5, 'skipped'), stage('review:2', 6, 'skipped'),
    stage('future-phase', 7, 'failed'), stage('brief:1', 1, 'failed', { workflow_run_id: 'foreign-run', attempt: 99 }),
  ]);
  assert.equal(result.length, 7); assert.equal(result[0].status, 'completed');
  assert.deepEqual(result.slice(4).map(item => item.status), ['not_run', 'not_run', 'failed']);
  const retry = ui.workflowTimelineStages(creativeDefinition, creativeRun, [stage('brief:1', 1), stage('brief:1', 1, 'failed', { attempt: 2 })]);
  assert.equal(retry[0].status, 'failed'); assert.match(retry[0].detail, /attempt 2/);
  const unrelated = ui.workflowTimelineStages({ ...creativeDefinition, workflow_key: 'other-workflow' }, creativeRun, [stage('brief:1', 1)]);
  assert.equal(unrelated.find(item => item.key === 'brief').status, 'not_recorded');
});

const currentStage = stage('brief:1', 1, 'running');
const workerDefinition = { id: 'worker-definition', name: 'Creative director' };
const task = { id: 'task', business_id: businessId, workflow_run_id: runId, workflow_stage_run_id: currentStage.id, worker_definition_id: workerDefinition.id, status: 'running', objective: 'Create the brief' };
const workerRun = { id: 'worker-run', business_id: businessId, workflow_run_id: runId, task_contract_id: task.id, worker_definition_id: workerDefinition.id,
  status: 'running', started_at: date, completed_at: null };
const working = { ...creativeRun, status: 'running', current_stage_key: 'brief:1', completed_at: null };
test('current worker requires a running receipt linked to current task and durable stage', () => {
  const active = ui.currentWorkerSummary(working, task, workerRun, workerDefinition, [currentStage]);
  assert.equal(active.active, true); assert.equal(active.value, 'Creative director');
  for (const [candidateRun, candidateTask, receipt, stages] of [
    [creativeRun, task, workerRun, [currentStage]],
    [{ ...working, status: 'waiting' }, task, workerRun, [currentStage]],
    [{ ...working, status: 'needs_owner' }, task, workerRun, [currentStage]],
    [working, task, { ...workerRun, status: 'completed', completed_at: date }, [currentStage]],
    [working, task, { ...workerRun, task_contract_id: 'wrong-task' }, [currentStage]],
    [working, task, { ...workerRun, workflow_run_id: 'foreign' }, [currentStage]],
    [working, { ...task, workflow_stage_run_id: 'other-stage' }, workerRun, [currentStage]],
    [working, { ...task, status: 'completed' }, workerRun, [currentStage]],
    [working, task, workerRun, [currentStage, { ...currentStage, id: 'new-attempt', attempt: 2, status: 'failed' }]],
    [working, task, workerRun, []], [working, null, workerRun, [currentStage]],
    [working, task, null, [currentStage]],
  ]) {
    const summary = ui.currentWorkerSummary(candidateRun, candidateTask, receipt, workerDefinition, stages);
    assert.equal(summary.active, false); assert.equal(summary.value, 'No current worker');
  }
});

test('terminal snapshots distinguish last worker and task, with a safe evidence next step', () => {
  const html = renderToStaticMarkup(React.createElement(visuals.ExecutionSnapshot, {
    definition: creativeDefinition, run: creativeRun, task: { ...task, status: 'completed' },
    workerRun: { ...workerRun, status: 'completed', completed_at: date }, workerDefinition, stages: creativeStages, event: null, intervention: null,
  }));
  assert.match(html, /No current worker/); assert.match(html, /Last worker: Creative director/);
  assert.match(html, /Last recorded task/); assert.match(html, /Review the saved results/);
  assert.match(html, /href="\/dashboard\/artifacts#creative-approvals"/);
  assert.doesNotMatch(html, /No further step|Synthetic worker fixture/);
  assert.equal(ui.deriveCurrentAction({ ...run, status: 'cancelled' }, null, null), 'Run stopped');
  assert.equal(ui.statusLabel('queued'), 'Queued'); assert.equal(ui.statusLabel('running'), 'Working');
  assert.equal(ui.statusLabel('needs_owner'), 'Needs you'); assert.equal(ui.statusLabel('pending'), 'Upcoming');
  for (const status of ['pending', 'unknown']) assert.equal(ui.deriveCurrentAction({ ...working, status }, null, null), 'Current action not recorded');
});

function actionHarness(options = {}) {
  const calls = [], resumed = [], revalidated = [];
  const rows = {
    owner_interventions: options.intervention ?? intervention,
    workflow_runs: options.run ?? run,
    businesses: { id: businessId },
    workflow_definitions: options.definition ?? definition,
    ...options.rows,
  };
  const supabase = {
    auth: { getClaims: async () => options.signedOut ? { data: null, error: null } : { data: { claims: { sub: ownerId } }, error: null } },
    from(table) {
      const request = { table, select: '', filters: [] }; calls.push(request);
      const query = {
        select(value) { request.select = value; return query; },
        eq(name, value) { request.filters.push([name, value]); return query; },
        async maybeSingle() { return { data: rows[table], error: options.errorTable === table ? new Error('fixture read failed') : null }; },
      };
      return query;
    },
  };
  const actions = load('src/app/dashboard/actions.ts', {
    'node:crypto': require('node:crypto'), 'next/cache': { revalidatePath: value => revalidated.push(value) },
    'next/navigation': { redirect: url => { throw new Error(`redirect:${url}`); } },
    'workflow/api': { resumeHook: async (...args) => { if (options.resumeError) throw new Error('fixture hook failed'); resumed.push(args); }, start: noop },
    '@/lib/core-ui/workflows': ui, '@/lib/supabase/env': { isSupabaseAdminConfigured: () => false },
    '@/lib/supabase/server': { createClient: async () => supabase },
    '@/workflows/synthetic-runtime': { syntheticReviewHookToken: id => `agent-labs:synthetic-review:${id}` },
    '@/workflows/registry': { getRegisteredWorkflow: noop },
  });
  const submit = async (overrides = {}) => {
    const form = new FormData();
    for (const [key, value] of Object.entries({ interventionId, decision: 'approve', returnTo: '/dashboard/needs-you', ...overrides })) form.set(key, value);
    return actions.resumeSyntheticReview(form);
  };
  return { calls, resumed, revalidated, submit };
}

test('server synthetic handler resumes only the exact owned open proof review', async () => {
  for (const decision of ['approve', 'fail']) {
    const h = actionHarness();
    await assert.rejects(h.submit({ decision }), new RegExp(`redirect:/dashboard/needs-you\\?message=review-${decision === 'approve' ? 'approved' : 'failed'}`));
    assert.equal(h.resumed.length, 1); assert.equal(h.resumed[0][0], `agent-labs:synthetic-review:${runId}`);
    assert.equal(h.resumed[0][1].decision, decision); assert.equal(h.resumed[0][1].ownerUserId, ownerId);
    assert.ok(h.calls.find(call => call.table === 'owner_interventions').select.includes('intervention_type'));
    assert.ok(h.calls.find(call => call.table === 'businesses').filters.some(([key, value]) => key === 'owner_user_id' && value === ownerId));
    assert.ok(h.calls.find(call => call.table === 'workflow_runs').filters.some(([key, value]) => key === 'business_id' && value === businessId));
    assert.ok(h.revalidated.includes(`/dashboard/workflows/${runId}`));
  }
});

test('forged, stale, wrong-workflow and unavailable review forms cannot reach a synthetic hook', async () => {
  const invalid = [
    { intervention: { ...intervention, intervention_type: 'creative_review' } },
    { intervention: { ...intervention, intervention_type: 'unknown_review' } },
    { intervention: { ...intervention, status: 'resolved' } },
    { intervention: { ...intervention, workflow_run_id: null } },
    { intervention: { ...intervention, business_id: 'foreign' } },
    { run: { ...run, status: 'completed' } }, { run: { ...run, current_stage_key: 'worker-task' } },
    { run: { ...run, completed_at: date } }, { run: { ...run, id: 'foreign' } },
    { run: creativeRun, definition: creativeDefinition },
    { definition: { ...definition, workflow_key: 'other-workflow' } },
    { definition: { ...definition, version: '2.0.0' } },
    { run: { ...run, workflow_definition_id: 'copy' }, definition: { ...definition, id: 'copy' } },
    ...['owner_interventions', 'workflow_runs', 'businesses', 'workflow_definitions'].flatMap(table => [{ rows: { [table]: null } }, { errorTable: table }]),
    { signedOut: true },
  ];
  for (const options of invalid) {
    const h = actionHarness(options);
    await assert.rejects(h.submit(), /redirect:.*(?:error=invalid-review-decision|error=review-not-open|error=session-required)/);
    assert.equal(h.resumed.length, 0, JSON.stringify(options)); assert.equal(h.revalidated.length, 0);
  }
});

test('synthetic action validates inputs, rejects unsafe return URLs and reports hook failures', async () => {
  for (const fields of [{ interventionId: 'bad' }, { decision: 'activate' }]) {
    const h = actionHarness(); await assert.rejects(h.submit(fields), /error=invalid-review-decision/);
    assert.equal(h.calls.length, 0); assert.equal(h.resumed.length, 0);
  }
  const unsafe = actionHarness(); await assert.rejects(unsafe.submit({ returnTo: 'https://attacker.invalid/' }), /redirect:\/dashboard\?message=review-approved/);
  const failed = actionHarness({ resumeError: true }); await assert.rejects(failed.submit(), /error=review-resume-failed/);
  assert.equal(failed.revalidated.length, 0);
});


test('unavailable related records do not become invented empty workers, artifacts or stages', () => {
  const timeline = renderToStaticMarkup(React.createElement(visuals.WorkflowTimeline, { definition: creativeDefinition, run: creativeRun, stages: [], unavailable: true }));
  assert.match(timeline, /Stage records unavailable/); assert.doesNotMatch(timeline, /Not recorded|Not run|Upcoming|Completed/);
  const snapshot = renderToStaticMarkup(React.createElement(visuals.ExecutionSnapshot, {
    run: creativeRun, task: null, workerRun: null, workerDefinition: null, event: null, intervention: null, unavailable: true,
  }));
  assert.match(snapshot, /Execution details unavailable/); assert.doesNotMatch(snapshot, /No current worker|No task recorded|Review the saved results/);
  const card = renderToStaticMarkup(React.createElement(visuals.WorkflowListCard, {
    run: creativeRun, task: null, workerRun: null, stages: [], events: [], intervention: null, artifactCount: 0, unavailable: true,
  }));
  assert.match(card, /Related records unavailable/); assert.doesNotMatch(card, /No current worker|0 artifacts|Not recorded|Upcoming/);
  const event = { id: 'event', event_type: 'worker.completed', payload: {}, actor_type: 'worker', occurred_at: date };
  for (const events of [[], [event]]) {
    const activity = renderToStaticMarkup(React.createElement(visuals.ActivityFeed, { events, unavailable: true }));
    assert.match(activity, /Activity records unavailable/); assert.doesNotMatch(activity, /Durable events will appear/);
    if (events.length) assert.match(activity, /Worker completed/);
  }
});
