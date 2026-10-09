import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { api, businessId, secondBusinessId, id, model, owner, query, terminal, time, fixtureTables, rendered, wire, submit } from './helpers/console-decisions.mjs';
const selectedRoute = request => `/dashboard?view=decisions&business=${request.business_id}&decision=${request.id}`;
test('Decisions counts and pages the exact open queue, including old runs beyond eighty', async () => {
  const tables = fixtureTables({ count: 131 }), h = wire(tables), selected = tables.owner_interventions[0];
  const data = await api.loadConsoleDecisionPage(h.context, { page: 3, selectedId: selected.id, businessId });
  assert.equal(data.page.total, 131); assert.equal(data.page.items.length, 25); assert.equal(data.page.hasNext, true); assert.equal(data.page.complete, true);
  assert.equal(data.selection.status, 'found'); assert.equal(data.selection.item.id, selected.id); assert.equal(data.detail.run.id, selected.workflow_run_id);
  assert.equal(data.detail.acknowledgement.eligible, true);
  assert.deepEqual(Array.from(h.calls[0].range), [50, 75]);
  const primary = h.calls.find(call => call.table === 'owner_interventions');
  assert.ok(!primary.filters.some(([, key]) => key === 'workflow_run_id'));
  for (const call of h.calls) { assert.equal(call.options.count, 'exact'); assert.ok(call.limit || call.range, `Bounded ${call.table}`); }
});
test('stable identity paging preserves duplicate names and timestamps', async () => {
  const tables = fixtureTables({ count: 52 }); tables.owner_interventions.forEach(row => row.requested_at = time);
  const h = wire(tables), pages = await Promise.all([1,2,3].map(page => api.loadConsoleDecisionPage(h.context, { page })));
  assert.equal(new Set(pages.flatMap(page => page.page.items.map(item => item.id))).size, 52);
  pages.forEach(page => assert.equal(page.page.total, 52));
});
test('hostile, foreign and ambiguous identities fail closed before reads', async () => {
  for (const options of [{ selectedId: '../secret' }, { businessId: 'broken' }, { page: 0 }, { page: 1.5 }, { page: 1e100 }, { status: 'open),or(id.eq.any)' }]) {
    const h = wire(); await assert.rejects(api.loadConsoleDecisionPage(h.context, options)); assert.equal(h.calls.length, 0);
  }
  assert.throws(() => query.consoleDecisionOptionsFromSearch({ decision: [id(10), id(11)] }), /Ambiguous/);
  const h = wire(); await assert.rejects(api.loadConsoleDecisionPage(h.context, { businessId: id(999) }), /Business selection/); assert.equal(h.calls.length, 0);
  const selected = h.tables.owner_interventions[0], data = await api.loadConsoleDecisionPage(h.context, { businessId: secondBusinessId, selectedId: selected.id });
  assert.equal(data.selection.status, 'missing'); assert.equal(data.detail, null);
});
test('unavailable/countless/truncated reads never fabricate an empty queue or authoritative total', async () => {
  for (const options of [{ failTable: 'owner_interventions' }, { throwTable: 'owner_interventions' }, { counts: { owner_interventions: null } }, { cap: { owner_interventions: 10 } }]) {
    const h = wire(fixtureTables({ count: 91 }), options), data = await api.loadConsoleDecisionPage(h.context);
    assert.equal(data.page.complete, false); assert.equal(data.page.total, null); assert.ok(data.errors.length);
  }
  const h = wire(); const data = await api.loadConsoleDecisionPage({ ...h.context, businessesUnavailable: true }); assert.equal(data.page.total, null); assert.equal(h.calls.length, 0);
});
test('unexpected cross-Business rows and unavailable selected reads are rejected', async () => {
  const tables = fixtureTables(); tables.owner_interventions[0].business_id = id(999);
  const h = wire(tables, { ignoreFilters: ['owner_interventions'] }), data = await api.loadConsoleDecisionPage(h.context);
  assert.equal(data.page.items.length, 0); assert.equal(data.page.total, null);
});
for (const [amountCase, value, text] of [['encoding','US$0.22','3 recorded calls'],['png','US$0.01','1 of 3 recorded calls have an unknown charge'],['brief','&lt;US$0.01','1 recorded call']]) test(`saved ${amountCase} notice retains exact run, evidence and receipt uncertainty`, async () => {
  const tables = fixtureTables({ count: 1, amountCase }), result = await rendered(selectedRoute(tables.owner_interventions[0]), { tables });
  assert.match(result.html, /Stopped · Notice open/); assert.ok(result.html.includes(value)); assert.ok(result.html.includes(text));
  assert.match(result.html, /Saved concept 1/); assert.doesNotMatch(result.html, /PRIVATE_PROVIDER_PAYLOAD|PRIVATE_DATABASE_FAILURE|Work is in progress|Waiting for your decision/);
  assert.match(result.html, /Mark reviewed is unavailable/); assert.doesNotMatch(result.html, /<button[^>]*>Mark reviewed/);
  if (amountCase === 'encoding') { assert.match(result.html, /encoding or metadata is unsupported/); assert.match(result.html, /1(?:<!-- -->)? unvalidated provider source(?:<!-- -->)? retained/); }
  if (amountCase === 'png') assert.match(result.html, /did not contain exactly one accepted PNG/);
  if (amountCase === 'brief') assert.match(result.html, /No saved output artifacts were found/);
});
test('cost errors remain unavailable and suppress acknowledgement when terminal state is incomplete', async () => {
  const tables = fixtureTables({ count: 1 }), route = selectedRoute(tables.owner_interventions[0]);
  for (const failTable of ['creative_cost_reservations', 'creative_cost_settlements', 'creative_runs']) {
    const result = await rendered(route, { tables, failTable }); assert.match(result.html, /Unavailable/); assert.doesNotMatch(result.html, /US\$0\.00|No calls recorded/);
  }
  for (const failTable of ['workflow_stage_runs','worker_runs','task_contracts','action_intents']) {
    const result = await rendered(route, { tables, failTable }); assert.equal(result.data.detail.acknowledgement.eligible, false);
  }
});
test('action integration preserves exact microsecond source version and does not execute during rendering', async () => {
  const tables = fixtureTables({ count: 1 }), request = tables.owner_interventions[0]; let calls = 0;
  const result = await rendered(selectedRoute(request), { tables, props: { actions: { acknowledgeStoppedCreative: async () => { calls++; throw Error('Mutation denied'); } } } });
  assert.equal(calls, 0); assert.match(result.html, /name="expectedUpdatedAt" value="2026-10-02T04:10:20\.123456\+00:00"/); assert.match(result.html, />Mark reviewed<\/button>/); assert.match(result.html, /data-decision-pending="false"/);
  assert.match(result.html, /does not retry the work, complete the workflow, approve an output, or reconcile charges/);
});
test('generic resolved records do not become reviewed; exact typed acknowledgement preserves unknown charge', async () => {
  const tables = fixtureTables({ count: 1, amountCase: 'png' }), request = tables.owner_interventions[0], run = tables.workflow_runs[0], creativeRun = tables.creative_runs[0];
  request.status = 'resolved'; request.resolved_at = time; request.resolution = { decision: 'acknowledge' };
  const generic = await rendered(selectedRoute(request), { tables }); assert.match(generic.html, /Stopped · Notice closed/); assert.doesNotMatch(generic.html, /Stopped · reviewed/);
  request.resolution = { version: terminal.TERMINAL_CREATIVE_REVIEW_VERSION, decision: 'acknowledge', actorUserId: owner, businessId, workflowRunId: run.id, creativeRunId: creativeRun.id, interventionId: request.id, acknowledgedAt: time, expectedUpdatedAt: time, executionResumed: false, newSpendAuthorized: false, costsReconciled: false };
  const result = await rendered(selectedRoute(request), { tables }); assert.match(result.html, /Stopped · reviewed/); assert.match(result.html, /1 of 3 recorded calls have an unknown charge/); assert.equal(result.data.page.total, 0); assert.equal(result.data.selection.status, 'found');
});
test('unknown future notice types remain inspect-only even if an acknowledgement handler exists', async () => {
  const tables = fixtureTables({ count: 1 }); tables.owner_interventions[0].intervention_type = 'future.unknown';
  const result = await rendered(selectedRoute(tables.owner_interventions[0]), { tables, props: { actions: { acknowledgeStoppedCreative: async () => { throw Error('Denied'); } } } });
  assert.doesNotMatch(result.html, />Mark reviewed<\/button>/); assert.match(result.html, /Viewing this notice does not clear it/);
});
test('safe reason display never dumps raw provider diagnostics or token-like fields', () => {
  for (const value of ['Bearer abc', 'https://provider.invalid/?token=PRIVATE', 'API_KEY=secret', 'x'.repeat(100)]) assert.equal(model.safeDecisionText(value, 'Hidden'), 'Hidden');
  assert.equal(model.safeDecisionText('A saved ordinary concept', 'Hidden'), 'A saved ordinary concept');
});
test('paging and exact selection remain in root Decisions and typed submit has pending and outcome hooks', async () => {
  const q = query.consoleDecisionQuery({ businessId, selectedId: id(12), page: 2 });
  const url = new URL(query.consoleDecisionHref(q, { page: 3 }), 'https://fixture.invalid'); assert.equal(url.pathname, '/dashboard'); assert.equal(url.searchParams.get('view'), 'decisions'); assert.equal(url.searchParams.get('decision'), id(12)); assert.equal(url.searchParams.get('page'), '3');
  const source = readFileSync('src/components/console/console-decision-submit.tsx', 'utf8'); assert.match(source, /useFormStatus/); assert.match(source, /disabled=\{pending\}/);
  const tables = fixtureTables({ count: 1 }); const result = await rendered(selectedRoute(tables.owner_interventions[0]), { tables, props: { outcome: { interventionId: tables.owner_interventions[0].id, tone: 'error', text: 'The record changed. Review the saved state.' } } });
  assert.match(result.html, /role="alert" data-decision-outcome="error"/); assert.doesNotMatch(result.html, /href="\/dashboard\/(?:workflows|artifacts|needs-you)/);
});

test('unverified success copy cannot claim an acknowledgement and repeated browser selection remains read-only', async () => {
  const tables = fixtureTables({ count: 1 }), request = tables.owner_interventions[0];
  const result = await rendered(selectedRoute(request), { tables, props: { outcome: { interventionId: request.id, tone: 'status', text: 'Forged acknowledgement success' } } });
  assert.doesNotMatch(result.html, /Forged acknowledgement success|Stopped · reviewed/);
  assert.equal(tables.owner_interventions[0].status, 'open');
});

test('compact action returns accept only canonical Decisions state and bind exact notice scope', () => {
  const base = `/dashboard?view=decisions&business=${businessId}&decision=${id(12)}&page=3&status=all`;
  assert.equal(query.safeConsoleDecisionReturnPath(base), base);
  for (const input of [base + '&provider=etsy', base + '&page=4', base + '&view=decisions', base + '&status=all', base + '#x', base + '&secret=value', base.replace('page=3', 'page=3.0'), base.replace('page=3', 'page=0'), base.replace('view=decisions', 'view=work'), '//external.invalid/dashboard?view=decisions', 'https://external.invalid/dashboard?view=decisions']) assert.equal(query.safeConsoleDecisionReturnPath(input), null, input);
  assert.equal(query.consoleDecisionActionReturnPath(base, { interventionId: id(77), businessId: secondBusinessId }), null);
  const scoped = new URL(query.consoleDecisionActionReturnPath(base, { interventionId: id(77), businessId }), 'https://fixture.invalid');
  assert.equal(scoped.searchParams.get('decision'), id(77)); assert.equal(scoped.searchParams.get('business'), businessId); assert.equal(scoped.searchParams.get('page'), '3'); assert.equal(scoped.searchParams.get('status'), 'all');
  assert.equal(query.consoleDecisionActionReturnPath(base, { interventionId: 'invalid' }), null);
  assert.equal(query.consoleDecisionNotice('message', 'constructor'), null);
  assert.equal(query.consoleDecisionNotice('error', 'raw provider error'), null);
  const pending = query.consoleDecisionNotice('error', 'simulation-delivery-pending');
  assert.match(pending.text, /unconfirmed here/); assert.doesNotMatch(pending.text, /decision was saved|decision recorded/i);
});

test('retained evidence Inspect carries the exact root artifact identity and focus hash', async () => {
  const tables = fixtureTables({ count: 1 }), request = tables.owner_interventions[0], artifact = tables.artifacts[0];
  const result = await rendered(selectedRoute(request), { tables });
  assert.ok(result.html.includes(`&amp;artifact=${artifact.id}#artifact-${artifact.id}`));
});
test('general positive query responses never claim a saved action or runtime outcome', () => {
  for (const code of ['review-approved','review-failed','browser-control-returned','browser-control-taken','simulation-decision-recorded']) {
    const notice = query.consoleDecisionNotice('message', code);
    assert.match(notice.text, /unconfirmed here/);
    assert.doesNotMatch(notice.text, /workflow is resuming|workflow is closing|Control returned\.|was recorded|decision recorded/i);
  }
});

test('aggregate queue selection and action return preserve the explicit all-Business page', () => {
  const current = query.consoleDecisionQuery({ page: 4 });
  const selected = new URL(query.consoleDecisionHref(current, { selectedId: id(77) }), 'https://fixture.invalid');
  assert.equal(selected.searchParams.has('business'), false); assert.equal(selected.searchParams.get('page'), '4');
  const returned = new URL(query.consoleDecisionActionReturnPath(selected.pathname + selected.search, { interventionId: id(77), businessId: secondBusinessId }), 'https://fixture.invalid');
  assert.equal(returned.searchParams.has('business'), false); assert.equal(returned.searchParams.get('page'), '4');
});

test('duplicate notice rows expose saved stage and requested UTC time without inventing missing context', async () => {
  const tables = fixtureTables({ count: 3 });
  const result = await rendered('/dashboard?view=decisions', { tables });
  assert.match(result.html, /Requested .*01 Oct.*00:00:00.* UTC/);
  assert.match(result.html, /Requested .*01 Oct.*00:00:01.* UTC/);
  assert.match(result.html, /Requested .*01 Oct.*00:00:02.* UTC/);
  assert.match(result.html, /Generate image/); assert.match(result.html, /Brief/);
  tables.owner_interventions[0].requested_at = 'invalid';
  const unknown = await rendered('/dashboard?view=decisions', { tables, failTable: 'workflow_runs' });
  assert.match(unknown.html, /Requested time unavailable/); assert.match(unknown.html, /Stage unavailable/);
});

test('identical Business names receive visible stable identity prefixes in the filter', async () => {
  const result = await rendered('/dashboard?view=decisions');
  assert.match(result.html, /\[000001\] Same long studio name/);
  assert.match(result.html, /\[000002\] Same long studio name/);
});

test('failure and charge summaries precede an accessible full saved-context disclosure', async () => {
  const tables = fixtureTables({ count: 1, amountCase: 'png' });
  const concept = `Saved full concept ${'readable garden illustration '.repeat(55)}CONCEPT END`;
  const workflow = `Saved full workflow ${'readable pipeline name '.repeat(15)}WORKFLOW END`;
  const business = `Saved full Business ${'readable studio name '.repeat(15)}BUSINESS END`;
  tables.creative_approvals[0].snapshot.concept = concept;
  tables.workflow_definitions = [{ ...tables.workflow_definitions[0], name: workflow }];
  const businesses = [{ id: businessId, name: business, created_at: time, updated_at: time }];
  const result = await rendered(selectedRoute(tables.owner_interventions[0]), { tables, businesses, props: { businesses } });
  const html = result.html;
  assert.ok(html.indexOf('class="compactDecisionReason"') < html.indexOf('class="compactDecisionCosts"'));
  assert.ok(html.indexOf('class="compactDecisionCosts"') < html.indexOf('<details class="compactDecisionContext">'));
  assert.match(html, /<details class="compactDecisionContext"><summary>Concept, workflow and exact saved identities<\/summary>/);
  assert.ok(html.includes(concept)); assert.ok(html.includes(workflow)); assert.ok(html.includes(business));
  assert.match(html, /1 of 3 recorded calls have an unknown charge/);
  assert.match(html, /Ended at stage/);
  assert.equal(result.h.calls.filter(call => call.table === 'action_intents').length, 1);
});

test('filter grid and native selects constrain their intrinsic width without hiding the whole workspace', () => {
  const css = readFileSync('src/components/console/console-compact-decisions.css', 'utf8');
  assert.match(css, /\.compactDecisionFilters label\{[^}]*grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css, /\.compactDecisionFilters select\{[^}]*min-inline-size:0;[^}]*width:100%;[^}]*box-sizing:border-box/);
  assert.doesNotMatch(css, /\.compactDecisions\{[^}]*overflow(?:-x)?:hidden/);
});


test('selected-heading reveal is narrow-only and respects current sticky/fixed chrome', () => {
  function fixture({ width = 640, topPosition = 'static', viewportTop = 0, viewportHeight = 450, headerHeight = 65 } = {}) {
    let headerTop = 449; const calls = [];
    const topBar = { position: topPosition, getBoundingClientRect: () => ({ top: viewportTop, bottom: viewportTop + 64 }) };
    const footer = { position: 'sticky', getBoundingClientRect: () => ({ top: viewportTop + viewportHeight - 60, bottom: viewportTop + viewportHeight }) };
    const view = { innerHeight: viewportHeight, visualViewport: { offsetTop: viewportTop, height: viewportHeight }, matchMedia: () => ({ matches: width <= 900 }),
      getComputedStyle: node => ({ position: node.position }), scrollBy: options => { calls.push(['scrollBy', options]); headerTop -= options.top; } };
    const header = { scrollIntoView: options => { calls.push(['scrollIntoView', options]); headerTop = viewportTop; }, getBoundingClientRect: () => ({ top: headerTop, bottom: headerTop + headerHeight, height: headerHeight }) };
    const shell = { querySelector: selector => selector === '.consoleTopBar' ? topBar : footer };
    const heading = { ownerDocument: { defaultView: view }, closest: selector => selector === '.compactDecisionDetailHeader' ? header : shell,
      getBoundingClientRect: () => ({ top: headerTop + 20, bottom: headerTop + 42, height: 22 }) };
    return { heading, header, calls };
  }
  const desktop = fixture({ width: 1280 }); submit.revealNarrowDecisionHeading(desktop.heading); assert.deepEqual(desktop.calls, []);
  for (const topPosition of ['static', 'sticky', 'fixed']) {
    const f = fixture({ topPosition }); submit.revealNarrowDecisionHeading(f.heading);
    assert.equal(f.header.getBoundingClientRect().top, topPosition === 'static' ? 8 : 72);
    assert.ok(f.header.getBoundingClientRect().bottom < 390);
    assert.equal(f.calls.length, 2); assert.equal(f.calls[0][1].behavior, 'instant'); assert.equal(f.calls[1][1].behavior, 'instant');
  }
  const visual = fixture({ viewportTop: 20, viewportHeight: 320, topPosition: 'fixed' }); submit.revealNarrowDecisionHeading(visual.heading);
  assert.equal(visual.header.getBoundingClientRect().top, 92);
  const source = readFileSync('src/components/console/console-decision-submit.tsx', 'utf8');
  assert.match(source, /\[noticeId, revision\]/); assert.match(source, /focus\(\{ preventScroll: true \}\)/);
  assert.doesNotMatch(source, /setInterval|setTimeout|requestAnimationFrame|addEventListener/);
});


test('notice refresh preserves active controls and drafts without overriding explicit selection or modal isolation', () => {
  function element({ dialog = false, tag = 'BODY', editable = false, href = false, tabIndex = -1, active = true } = {}) {
    return { ownerDocument: { querySelector: selector => selector === 'dialog[open]' && dialog ? {} : null,
      activeElement: active ? { matches: selectors => selectors.split(',').some(selector => selector.trim().toUpperCase() === tag || selector.trim() === 'a[href]' && tag === 'A' && href),
        isContentEditable: editable, tabIndex } : null } };
  }
  const controls = [
    ...['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'SUMMARY'].map(tag => ({ tag })),
    { tag: 'A', href: true }, { tag: 'DIV', editable: true }, { tag: 'DIV', tabIndex: 0 },
  ];
  for (const control of controls) {
    assert.equal(submit.canFocusDecisionHeading(element(control), false), false, `Background refresh preserves ${JSON.stringify(control)}`);
    assert.equal(submit.canFocusDecisionHeading(element(control), true), true, `Explicit selection replaces ${JSON.stringify(control)}`);
    for (const selectionChanged of [false, true]) assert.equal(submit.canFocusDecisionHeading(element({ ...control, dialog: true }), selectionChanged), false);
  }
  for (const inactive of [{ tag: 'BODY' }, { tag: 'H2' }, { tag: 'A' }, { active: false }]) {
    for (const selectionChanged of [false, true]) {
      assert.equal(submit.canFocusDecisionHeading(element(inactive), selectionChanged), true, `Unoccupied focus permits a selected or acknowledged heading: ${JSON.stringify(inactive)}`);
      assert.equal(submit.canFocusDecisionHeading(element({ ...inactive, dialog: true }), selectionChanged), false);
    }
  }
});
