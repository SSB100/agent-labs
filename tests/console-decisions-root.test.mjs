import assert from 'node:assert/strict';
import test from 'node:test';
import { businessId, businesses, decisionRoute, fixtureTables, formFor, id, origin, owner, rootDecisionFixture, secondOwner, time, typedDecisionTables } from './helpers/console-decisions-root.mjs';
const copy = value => JSON.parse(JSON.stringify(value));
const query = route => new URL(route, origin).searchParams;
const noWork = /Work is in progress|Waiting for your decision|Waiting for owner input|>Running<|>Active<|>Needs owner<|>Needs you<|>Paused<|>Paused for you</;

test('real DashboardPage reads an exact decision beyond the eighty-run window and a bounded 131-notice queue', async () => {
  const h = rootDecisionFixture(), selected = h.tables.owner_interventions[0];
  const page = await h.render(decisionRoute(selected, '&page=3&status=open'));
  assert.ok(page.decisions, 'DashboardPage must render the real ConsoleCompactDecisions');
  assert.equal(page.data.page.total, 131); assert.equal(page.data.page.items.length, 25); assert.equal(page.data.page.page, 3);
  assert.equal(page.data.selection.item.id, selected.id); assert.equal(page.data.detail.run.id, selected.workflow_run_id);
  assert.ok(!page.data.page.items.some(row => row.id === selected.id));
  assert.ok(!h.collectionFor().runs.some(run => run.id === selected.workflow_run_id));
  assert.equal(page.props.actions.acknowledgeStoppedCreative, h.action, 'Root wires the actual terminal-review server action');
  assert.deepEqual(Object.keys(page.props.actions).sort(), ['acknowledgeStoppedCreative', 'browserControl', 'simulationReview', 'syntheticReview']);
  for (const [name, action] of Object.entries(h.typedActions)) assert.equal(page.props.actions[name], action);
  assert.equal(page.data.detail.acknowledgement.eligible, true);
  assert.equal(h.rpcCalls.length, 0); assert.equal(h.mutations.length, 0);
  assert.match(page.html, /131 open notices/); assert.match(page.html, /US\$0\.22/); assert.match(page.html, /name="expectedUpdatedAt" value="2026-10-02T04:10:20\.123456\+00:00"/);
  assert.doesNotMatch(page.html, /PRIVATE_PROVIDER_PAYLOAD|PRIVATE_DATABASE_FAILURE|service_role|OPENROUTER_API_KEY/);
  assert.equal(h.pageReads.length, 1); assert.equal(h.pageReads[0].selectedId, selected.id);
});

test('real action resolves exactly one old notice, count drops, failed execution and unknown charge survive reload', async () => {
  const tables = fixtureTables({ count: 131 }), h = rootDecisionFixture({ tables }), notice = tables.owner_interventions[1];
  const state = copy(tables), failureHistory = copy(h.events), route = decisionRoute(notice, '&page=3&status=all');
  const before = await h.render(route);
  assert.match(before.html, /1 of 3 recorded calls have an unknown charge/); assert.equal(h.context().needsYouCount, 131);
  const redirect = await h.perform(formFor(notice, route));
  assert.equal(query(redirect).get('view'), 'decisions'); assert.equal(query(redirect).get('business'), businessId);
  assert.equal(query(redirect).get('decision'), notice.id); assert.equal(query(redirect).get('page'), '3'); assert.equal(query(redirect).get('status'), 'all');
  assert.equal(query(redirect).get('message'), 'terminal-review-acknowledged');
  assert.deepEqual(h.rpcCalls, [{ name: 'acknowledge_terminal_creative_review', args: { p_intervention_id: notice.id, p_expected_updated_at: time }, userId: owner }]);
  assert.equal(h.mutations.length, 1); assert.equal(h.mutations[0].id, notice.id); assert.equal(h.context().needsYouCount, 130);
  for (const [name, rows] of Object.entries(state)) if (name !== 'owner_interventions') assert.deepEqual(tables[name], rows, `${name} stays unchanged`);
  assert.deepEqual(h.events.filter(row => failureHistory.some(saved => saved.id === row.id)), failureHistory);
  assert.equal(h.events.length, failureHistory.length + 1); assert.equal(h.events.at(-1).event_type, 'owner_intervention.resolved'); assert.equal(h.events.at(-1).payload.interventionId, notice.id); assert.deepEqual(tables.owner_interventions.filter(row => row.id !== notice.id), state.owner_interventions.filter(row => row.id !== notice.id));
  assert.equal(tables.workflow_runs[1].status, 'needs_owner'); assert.equal(tables.workflow_runs[1].completed_at, time); assert.equal(tables.workflow_stage_runs[1].status, 'failed');
  for (const reloadRoute of [redirect, route, decisionRoute(notice), decisionRoute(notice, '&status=resolved')]) {
    const after = await h.render(reloadRoute);
    assert.equal(after.data.selection.item.id, notice.id); assert.equal(after.data.detail.acknowledgement.reviewed, true);
    assert.match(after.html, /Stopped · reviewed/); assert.match(after.html, /1 of 3 recorded calls have an unknown charge/);
    assert.match(after.html, /Review recorded\. The stopped execution and any unknown charges are unchanged/);
    assert.doesNotMatch(after.html, />Mark reviewed<\/button>|retry the work now|PRIVATE_/);
  }
  assert.equal((await h.render(decisionRoute(notice))).data.page.total, 130);
  assert.ok(h.revalidated.includes('/dashboard')); assert.ok(h.revalidated.includes(`/dashboard/workflows/${notice.workflow_run_id}`));
});

test('Work displays stopped evidence rather than active or waiting work after real acknowledgement', async () => {
  const tables = fixtureTables({ count: 1, amountCase: 'png' }), h = rootDecisionFixture({ tables }), notice = tables.owner_interventions[0];
  await h.perform(formFor(notice));
  // R08 Overview resolves a canonical Quest first; it must not inherit this unlinked legacy run.
  // The new workspace context and production-Next journey suites qualify that selection boundary.
  for (const route of [`/dashboard?view=work&business=${businessId}`, `/dashboard?view=work&business=${businessId}&run=${notice.workflow_run_id}`]) {
    const work = await h.render(route); assert.match(work.html, /Stopped/);
    // Available filter choices are not assertions about the displayed execution.
    const displayedWork = work.html.replace(/<nav[^>]*aria-label="Workspace views"[\s\S]*?<\/nav>/g, "").replace(/<form[^>]*class="consoleCollectionToolbar"[\s\S]*?<\/form>/g, "");
    assert.doesNotMatch(displayedWork, noWork);
    assert.equal(work.boundary.props.snapshot.entities.find(row => row.target === 'run').state, 'stopped');
    if (query(route).has('run')) { assert.match(work.html, /1 of 3 recorded calls have an unknown charge/); assert.match(work.html, /Failed/); }
  }
  assert.equal(tables.workflow_runs[0].status, 'needs_owner'); assert.equal(tables.workflow_runs[0].completed_at, time);
});

test('real root rejects malformed and ambiguous URL scope before the Decisions reader', async () => {
  for (const suffix of ['&business=malformed', `&business=${id(999)}`, '&decision=malformed', '&page=0', '&page=1.5', '&page=9007199254740991', '&status=unknown', `&decision=${id(50)}&decision=${id(51)}`, '&page=1&page=2', `&business=${businessId}&business=${businesses[1].id}`]) {
    const h = rootDecisionFixture(); await assert.rejects(h.render('/dashboard?view=decisions' + suffix), /Fixture record was not found|Invalid|Ambiguous|selection/);
    assert.equal(h.dbReads.length, 0, suffix); assert.equal(h.rpcCalls.length, 0, suffix);
  }
});

test('second owner and wrong Business cannot inspect or acknowledge a first-owner notice', async () => {
  const tables = fixtureTables({ count: 1 }), notice = tables.owner_interventions[0];
  const h = rootDecisionFixture({ tables, userId: secondOwner, ownedBusinesses: [businesses[1]] });
  await assert.rejects(h.render(decisionRoute(notice)), /not found|selection/);
  const page = await h.render(`/dashboard?view=decisions&business=${businesses[1].id}&decision=${notice.id}`);
  assert.equal(page.data.page.total, 0); assert.equal(page.data.selection.status, 'missing'); assert.equal(page.data.detail, null);
  assert.doesNotMatch(page.html, /Saved concept|US\$|>Mark reviewed<\/button>/);
  const result = await h.perform(formFor(notice)); assert.equal(query(result).get('error'), 'terminal-review-unavailable');
  assert.equal(notice.status, 'open'); assert.equal(h.mutations.length, 0); assert.equal(h.revalidated.length, 0);
  const sameOwner = rootDecisionFixture({ tables });
  const wrongBusiness = await sameOwner.render(`/dashboard?view=decisions&business=${businesses[1].id}&decision=${notice.id}`);
  assert.equal(wrongBusiness.data.selection.status, 'missing'); assert.equal(sameOwner.rpcCalls.length, 0);
});

test('queue completeness failures and selected detail failures never invent an empty queue or enable acknowledgement', async () => {
  for (const readOptions of [{ failTable: 'owner_interventions' }, { throwTable: 'owner_interventions' }, { cap: { owner_interventions: 10 } }, { counts: { owner_interventions: null } }]) {
    const h = rootDecisionFixture({ readOptions }), page = await h.render(decisionRoute(h.tables.owner_interventions[0]));
    assert.equal(page.data.page.total, null); assert.equal(page.data.page.complete, false); assert.match(page.html, /Count unavailable|could not be checked/);
    assert.doesNotMatch(page.html, /No matching notices are recorded/); assert.equal(h.rpcCalls.length, 0);
  }
  for (const failTable of ['workflow_stage_runs', 'worker_runs', 'task_contracts', 'action_intents']) {
    const h = rootDecisionFixture({ readOptions: { failTable } }), page = await h.render(decisionRoute(h.tables.owner_interventions[0]));
    assert.equal(page.data.detail.acknowledgement.eligible, false); assert.doesNotMatch(page.html, />Mark reviewed<\/button>/);
  }
});

for (const [rpcMode, errorCode] of [['error', 'failed'], ['transport', 'failed'], ['uncertain', 'failed'], ['conflict', 'conflict']]) test(`real action ${rpcMode} outcome stays open, returns safely and retains exact evidence`, async () => {
  const h = rootDecisionFixture({ tables: fixtureTables({ count: 1, amountCase: 'png' }), rpcMode }), notice = h.tables.owner_interventions[0], before = copy(h.tables);
  const redirect = await h.perform(formFor(notice, decisionRoute(notice, '&page=2&status=all')));
  assert.equal(query(redirect).get('error'), `terminal-review-${errorCode}`); assert.equal(query(redirect).get('decision'), notice.id);
  const after = await h.render(redirect); assert.match(after.html, /data-decision-outcome="error"/); assert.match(after.html, /Stopped · Notice open/);
  assert.match(after.html, /1 of 3 recorded calls have an unknown charge/); assert.doesNotMatch(after.html, /Stopped · reviewed|PRIVATE_|Successfully/);
  assert.deepEqual(h.tables, before); assert.equal(h.mutations.length, 0); assert.equal(h.revalidated.length, 0);
});

test('stale microsecond token and stale deep link cannot close a changed notice', async () => {
  const h = rootDecisionFixture({ tables: fixtureTables({ count: 1 }) }), notice = h.tables.owner_interventions[0];
  const old = formFor(notice); notice.updated_at = '2026-10-02T04:10:20.123457+00:00';
  const result = await h.perform(old), page = await h.render(result);
  assert.equal(query(result).get('error'), 'terminal-review-conflict'); assert.equal(notice.status, 'open'); assert.equal(h.mutations.length, 0);
  assert.equal(page.data.selection.item.updated_at, notice.updated_at); assert.match(page.html, /123457\+00:00/); assert.doesNotMatch(page.html, /Stopped · reviewed/);
});

test('repeated submit and Back/reload are idempotent without changing failed run, ledger or history', async () => {
  const h = rootDecisionFixture({ tables: fixtureTables({ count: 1 }) }), notice = h.tables.owner_interventions[0], form = formFor(notice);
  const [first, second] = await Promise.all([h.perform(form), h.perform(form)]);
  assert.deepEqual([query(first).get('message'), query(second).get('message')].sort(), ['terminal-review-acknowledged', 'terminal-review-already-acknowledged']);
  assert.equal(h.rpcCalls.length, 2); assert.equal(h.mutations.length, 1);
  for (const route of [first, decisionRoute(notice), second]) {
    const page = await h.render(route); assert.equal(page.data.page.total, 0); assert.equal(page.data.detail.acknowledgement.reviewed, true); assert.doesNotMatch(page.html, />Mark reviewed<\/button>/);
  }
  assert.equal(h.rpcCalls.length, 2, 'Navigating and reloading execute no action'); assert.equal(h.mutations.length, 1);
  assert.equal(h.events.filter(row => row.event_type === 'owner_intervention.resolved').length, 1);
});

test('an uncertain response after synthetic persistence relies on a reread and replay rather than optimism', async () => {
  const h = rootDecisionFixture({ tables: fixtureTables({ count: 1, amountCase: 'png' }), rpcMode: 'committed-uncertain' }), notice = h.tables.owner_interventions[0], form = formFor(notice);
  const redirect = await h.perform(form); assert.equal(query(redirect).get('error'), 'terminal-review-failed');
  const reloaded = await h.render(redirect); assert.equal(reloaded.data.detail.acknowledgement.reviewed, true); assert.match(reloaded.html, /Stopped · reviewed/);
  assert.match(reloaded.html, /1 of 3 recorded calls have an unknown charge/); assert.equal(h.mutations.length, 1);
  h.setMode('success'); const replay = await h.perform(form); assert.equal(query(replay).get('message'), 'terminal-review-already-acknowledged'); assert.equal(h.mutations.length, 1);
});

test('server return normalization cannot leave exact root Decisions scope and forged feedback never asserts success', async () => {
  for (const returnTo of ['https://evil.invalid', '//evil.invalid', '/dashboard/workflows/' + id(1000), '/dashboard?view=decisions#unsafe', '/dashboard?view=decisions&business=invalid', '/dashboard?view=decisions&page=2&page=3']) {
    const h = rootDecisionFixture({ tables: fixtureTables({ count: 1 }) }), notice = h.tables.owner_interventions[0];
    const redirect = await h.perform(formFor(notice, returnTo)), url = new URL(redirect, origin);
    assert.equal(url.origin, origin); assert.equal(url.pathname, '/dashboard'); assert.equal(url.searchParams.get('view'), 'decisions');
    assert.equal(url.searchParams.get('business'), businessId); assert.equal(url.searchParams.get('decision'), notice.id);
  }
  const h = rootDecisionFixture({ tables: fixtureTables({ count: 1 }) }), notice = h.tables.owner_interventions[0];
  for (const extra of ['&message=terminal-review-acknowledged', '&message=PRIVATE_CUSTOM_SUCCESS', '&error=PRIVATE_CUSTOM_ERROR']) {
    const page = await h.render(decisionRoute(notice, extra)); assert.doesNotMatch(page.html, /Stopped · reviewed|PRIVATE_CUSTOM|data-decision-outcome="status"/);
  }
  assert.equal(h.rpcCalls.length, 0);
});

test('missing session and malformed form never reach RPC; all unrecognized actions stay inspect-only', async () => {
  const h = rootDecisionFixture({ tables: fixtureTables({ count: 1 }), session: false }), notice = h.tables.owner_interventions[0];
  assert.equal(await h.perform(formFor(notice)), '/login?error=session-required'); assert.equal(h.rpcCalls.length, 0);
  const valid = rootDecisionFixture({ tables: fixtureTables({ count: 1 }) }), f = formFor(valid.tables.owner_interventions[0]); f.set('interventionId', 'invalid');
  assert.equal(query(await valid.perform(f)).get('error'), 'terminal-review-invalid'); assert.equal(valid.rpcCalls.length, 0);
  for (const type of ['future.unknown', 'review', 'browser_control', 'simulation_review']) {
    const tables = fixtureTables({ count: 1 }); tables.owner_interventions[0].intervention_type = type;
    const other = rootDecisionFixture({ tables }), page = await other.render(decisionRoute(tables.owner_interventions[0]));
    assert.doesNotMatch(page.html, />Mark reviewed<\/button>|>Approve and complete demo<|>Return control<|>Take control<|>Acknowledge simulated result</);
    assert.equal(other.rpcCalls.length, 0);
  }
});

const typedCases = [
  { kind: 'synthetic', action: 'syntheticReview', decision: 'approve', label: 'Approve and complete demo', message: 'review-approved' },
  { kind: 'synthetic', action: 'syntheticReview', decision: 'fail', label: 'Fail demo workflow', message: 'review-failed' },
  { kind: 'takeover', action: 'browserControl', decision: 'take_control', label: 'Take control', message: 'browser-control-taken' },
  { kind: 'return', action: 'browserControl', decision: 'return_control', label: 'Return control', message: 'browser-control-returned' },
  { kind: 'simulation', action: 'simulationReview', decision: 'acknowledge', label: 'Acknowledge simulated result', message: 'simulation-decision-recorded' },
  { kind: 'simulation', action: 'simulationReview', decision: 'stop', label: 'Stop simulation', message: 'simulation-decision-recorded' },
];
for (const { kind, action, decision, label, message } of typedCases) test(`real root preserves existing typed ${kind}/${decision} handler and exact canonical return`, async () => {
  const tables = typedDecisionTables(kind), h = rootDecisionFixture({ tables }), notice = tables.owner_interventions[0];
  const route = decisionRoute(notice, '&page=3&status=all'), page = await h.render(route);
  assert.ok(page.html.includes(`>${label}</button>`)); assert.doesNotMatch(page.html, />Mark reviewed<\/button>/);
  assert.equal(page.props.actions[action], h.typedActions[action]); assert.equal(h.hookCalls.length, 0); assert.equal(h.rpcCalls.length, 0);
  const form = formFor(notice, `/dashboard?view=decisions&business=${businessId}&decision=${id(888)}&page=3&status=all`); form.set('decision', decision);
  const redirect = await h.perform(form, page.props.actions[action]), params = query(redirect);
  assert.equal(params.get('business'), businessId); assert.equal(params.get('decision'), notice.id); assert.equal(params.get('page'), '3'); assert.equal(params.get('status'), 'all'); assert.equal(params.get('message'), message);
  assert.equal(h.hookCalls.length, 1); assert.equal(h.hookCalls[0].payload.ownerUserId, owner); assert.match(h.hookCalls[0].token, new RegExp(notice.workflow_run_id + '$'));
  assert.equal(h.rpcCalls.length, kind === 'simulation' ? 1 : 0); assert.equal(h.mutations.length, 0, 'No stopped-creative acknowledgement occurred');
  const returnedPage = await h.render(redirect); assert.doesNotMatch(returnedPage.html, /PRIVATE_|Stopped · reviewed|href="\/dashboard\/needs-you/);
  assert.ok(h.revalidated.includes('/dashboard'));
});

test('real existing typed handlers reject unknown, closed, foreign and invalid decisions without delivering a hook', async () => {
  for (const entry of typedCases.filter(row => ['approve', 'take_control', 'acknowledge'].includes(row.decision))) {
    for (const variant of ['unknown', 'closed', 'foreign', 'invalid']) {
      const tables = typedDecisionTables(entry.kind), notice = tables.owner_interventions[0];
      if (variant === 'unknown') notice.intervention_type = 'future.unknown';
      if (variant === 'closed') { notice.status = 'resolved'; notice.resolved_at = time; }
      const h = rootDecisionFixture({ tables, ...(variant === 'foreign' ? { userId: secondOwner, ownedBusinesses: [businesses[1]] } : {}) });
      const form = formFor(notice, decisionRoute(notice, '&page=2&status=all')); form.set('decision', variant === 'invalid' ? 'unexpected' : entry.decision);
      const redirect = await h.perform(form, h.typedActions[entry.action]);
      assert.ok(query(redirect).has('error'), `${entry.kind}/${variant}`); assert.equal(query(redirect).get('view'), 'decisions'); assert.equal(query(redirect).get('decision'), notice.id);
      assert.equal(h.hookCalls.length, 0, `${entry.kind}/${variant} must not resume`); assert.equal(h.revalidated.length, 0); assert.equal(h.mutations.length, 0);
      if (variant !== 'foreign') {
        const result = await h.render(redirect); assert.doesNotMatch(result.html, /PRIVATE_|Stopped · reviewed/);
        if (variant === 'unknown' || variant === 'closed') assert.ok(!result.html.includes(`>${entry.label}</button>`));
      }
    }
  }
});

test('synthetic stale run or wrong registered definition is inspect-only and cannot reach its hook', async () => {
  for (const change of [tables => { tables.workflow_runs[0].completed_at = time; }, tables => { tables.workflow_runs[0].current_stage_key = 'complete'; }, tables => { tables.workflow_definitions[0].version = '2.0.0'; }]) {
    const tables = typedDecisionTables('synthetic'); change(tables);
    const h = rootDecisionFixture({ tables }), notice = tables.owner_interventions[0], page = await h.render(decisionRoute(notice));
    assert.doesNotMatch(page.html, />Approve and complete demo<\/button>|>Fail demo workflow<\/button>/);
    const form = formFor(notice); form.set('decision', 'approve');
    assert.equal(query(await h.perform(form, h.typedActions.syntheticReview)).get('error'), 'invalid-review-decision'); assert.equal(h.hookCalls.length, 0);
  }
});

test('existing typed handler errors return fixed root feedback without backend details', async () => {
  for (const [kind, action, decision, expected] of [['synthetic', 'syntheticReview', 'approve', 'review-resume-failed'], ['takeover', 'browserControl', 'take_control', 'browser-control-resume-failed'], ['simulation', 'simulationReview', 'acknowledge', 'simulation-decision-failed']]) {
    const tables = typedDecisionTables(kind), h = rootDecisionFixture({ tables, rpcMode: 'typed-error' }), notice = tables.owner_interventions[0], form = formFor(notice); form.set('decision', decision);
    const redirect = await h.perform(form, h.typedActions[action]); assert.equal(query(redirect).get('error'), expected);
    const page = await h.render(redirect); assert.match(page.html, /role="alert"/); assert.doesNotMatch(page.html, /PRIVATE_|Stopped · reviewed/); assert.equal(h.revalidated.length, 0);
  }
});

function secondBusinessTables() {
  const tables = fixtureTables({ count: 143 }), selected = tables.owner_interventions[50], targetRun = selected.workflow_run_id;
  const runIds = new Set([...tables.workflow_runs.slice(131).map(run => run.id), targetRun]);
  const creativeIds = new Set(tables.creative_runs.filter(run => runIds.has(run.workflow_run_id)).map(run => run.id));
  const approvalIds = new Set(tables.creative_runs.filter(run => runIds.has(run.workflow_run_id)).map(run => run.approval_id));
  for (const rows of Object.values(tables)) for (const row of rows) if (runIds.has(row.workflow_run_id) || runIds.has(row.id) || creativeIds.has(row.creative_run_id) || approvalIds.has(row.id)) row.business_id = businesses[1].id;
  return tables;
}
const decodeHref = html => html.replaceAll('&amp;', '&');
test('aggregate page four selection, Close and actual acknowledgement preserve all-Business scope', async () => {
  const tables = secondBusinessTables(), h = rootDecisionFixture({ tables }), notice = tables.owner_interventions[50];
  const start = '/dashboard?view=decisions&page=4', queue = await h.render(start);
  assert.ok(queue.data.page.items.some(row => row.id === notice.id)); assert.equal(queue.data.page.total, 143);
  const href = decodeHref([...queue.html.matchAll(/href="([^"]+)"/g)].map(match => match[1]).find(value => value.includes(`decision=${notice.id}`)));
  assert.equal(query(href).get('page'), '4'); assert.equal(query(href).has('business'), false);
  const selected = await h.render(href); assert.equal(selected.data.selection.item.business_id, businesses[1].id);
  assert.equal(selected.tree.props.navigationBusinessId, undefined); assert.equal(selected.tree.props.commandBar.props.businessId, businesses[1].id);
  assert.match(selected.html, /All 2 businesses/);
  const close = decodeHref(/href="([^"]+)" aria-label="Close decision details"/.exec(selected.html)[1]);
  assert.equal(close, start); assert.equal((await h.render(close)).data.page.page, 4);
  const returnTo = decodeHref(/name="returnTo" value="([^"]+)"/.exec(selected.html)[1]);
  assert.equal(query(returnTo).has('business'), false); assert.equal(query(returnTo).get('page'), '4');
  const afterRoute = await h.perform(formFor(notice, returnTo)); assert.equal(query(afterRoute).has('business'), false); assert.equal(query(afterRoute).get('page'), '4'); assert.equal(query(afterRoute).get('decision'), notice.id);
  const after = await h.render(afterRoute); assert.equal(after.data.page.total, 142); assert.equal(after.data.detail.acknowledgement.reviewed, true); assert.equal(after.data.query.businessId, null);
  assert.match(after.html, /Stopped · reviewed/); assert.equal(h.mutations.length, 1);
});

test('terminal failure always returns to submitted notice rather than the return URL selection', async () => {
  for (const rpcMode of ['error', 'transport', 'uncertain', 'conflict']) {
    const h = rootDecisionFixture({ rpcMode }), [submitted, other] = h.tables.owner_interventions;
    const result = await h.perform(formFor(submitted, `/dashboard?view=decisions&decision=${other.id}&page=4&status=all`));
    assert.equal(query(result).get('decision'), submitted.id); assert.equal(query(result).get('page'), '4'); assert.equal(query(result).has('business'), false);
    const root = await h.render(result); assert.equal(root.data.selection.item.id, submitted.id); assert.match(root.html, /data-decision-outcome="error"/); assert.equal(h.mutations.length, 0);
  }
});

test('explicitly mismatched Business return scopes are rejected rather than retained by real actions', async () => {
  const h = rootDecisionFixture({ tables: fixtureTables({ count: 1 }) }), notice = h.tables.owner_interventions[0];
  const mismatch = `/dashboard?view=decisions&business=${businesses[1].id}&decision=${notice.id}&page=4`;
  const result = await h.perform(formFor(notice, mismatch)); assert.equal(query(result).get('business'), businessId); assert.equal(query(result).has('page'), false);
  for (const entry of typedCases.filter(row => ['approve', 'take_control', 'acknowledge'].includes(row.decision))) {
    const tables = typedDecisionTables(entry.kind), fixture = rootDecisionFixture({ tables }), selected = tables.owner_interventions[0], form = formFor(selected, mismatch); form.set('decision', entry.decision);
    const target = await fixture.perform(form, fixture.typedActions[entry.action]); assert.notEqual(query(target).get('business'), businesses[1].id); assert.equal(query(target).get('decision'), selected.id); assert.equal(query(target).has('page'), false);
  }
});

test('typed browser and simulation controls require readable matched nonterminal runs and registered definitions', async () => {
  for (const kind of ['takeover', 'return', 'simulation']) {
    for (const variant of ['run-unavailable', 'definition-unavailable', 'ended', 'wrong-key', 'wrong-version', 'not-needs-owner']) {
      const tables = typedDecisionTables(kind);
      const readOptions = variant === 'run-unavailable' ? { failTable: 'workflow_runs' } : variant === 'definition-unavailable' ? { failTable: 'workflow_definitions' } : {};
      if (variant === 'ended') tables.workflow_runs[0].completed_at = time;
      if (variant === 'wrong-key') tables.workflow_definitions[0].workflow_key = 'future.unknown';
      if (variant === 'wrong-version') tables.workflow_definitions[0].version = '2.0.0';
      if (variant === 'not-needs-owner') tables.workflow_runs[0].status = 'running';
      const h = rootDecisionFixture({ tables, readOptions }), page = await h.render(decisionRoute(tables.owner_interventions[0]));
      assert.doesNotMatch(page.html, />Take control<\/button>|>Return control<\/button>|>Acknowledge simulated result<\/button>|>Stop simulation<\/button>/, `${kind}/${variant}`);
      assert.equal(h.hookCalls.length, 0); assert.equal(h.rpcCalls.length, 0);
    }
  }
});

test('general success and simulation pending query codes stay explicitly unconfirmed', async () => {
  const h = rootDecisionFixture({ tables: fixtureTables({ count: 1 }) }), notice = h.tables.owner_interventions[0];
  for (const [kind, code] of [['message', 'review-approved'], ['message', 'review-failed'], ['message', 'browser-control-returned'], ['message', 'browser-control-taken'], ['message', 'simulation-decision-recorded'], ['error', 'simulation-delivery-pending']]) {
    const page = await h.render(decisionRoute(notice, `&${kind}=${code}`)); assert.match(page.html, /unconfirmed here/); assert.doesNotMatch(page.html, /Stopped · reviewed|data-decision-outcome="status"/); assert.equal(h.rpcCalls.length, 0);
  }
});

test('Business B header and scoped queue remain distinct from the explicit global badge and aggregate destination', async () => {
  const tables = secondBusinessTables(), ownedBusinesses = businesses.map((business, index) => ({ ...business, name: index ? 'Fixture Business B' : 'Fixture Business A' }));
  const h = rootDecisionFixture({ tables, ownedBusinesses }), page = await h.render(`/dashboard?view=decisions&business=${businesses[1].id}`);
  assert.equal(page.data.page.total, 13); assert.equal(page.tree.props.navigationBusinessId, businesses[1].id); assert.equal(page.tree.props.globalDecisionCount, true);
  assert.match(page.html, /class="consoleWorkspaceName">Fixture Business B<\/span>/); assert.match(page.html, /143 open decisions across all authorized Businesses/);
  assert.match(page.html, /class="consoleNavLink" href="\/dashboard\?view=decisions"[^>]*aria-current="page"/);
});
