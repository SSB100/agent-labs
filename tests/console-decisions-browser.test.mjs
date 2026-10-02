import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { createDecisionBrowserFixture, decisionClientState, decisionDocument, fiftyAccountRequests, oldNotice, origin, queueStart, selectedStart } from './helpers/console-decisions-browser.mjs';
import { businessId, decisionRoute } from './helpers/console-decisions-root.mjs';

test('Decisions browser document bundles actual DashboardPage output with an isolated real-action bridge', async () => {
  const fixture = createDecisionBrowserFixture(), html = await decisionDocument(selectedStart, { fixture });
  assert.equal(fixture.pageReads.length, 1, 'The real DashboardPage calls the real decision reader');
  assert.equal(fixture.pageReads[0].selectedId, oldNotice.id); assert.equal(fixture.rpcCalls.length, 0);
  assert.equal((html.match(/<div id="decision-root-island"/g) ?? []).length, 1); assert.match(html, /hydrateRoot/); assert.match(html, /data-decision-count/); assert.match(html, /131 open notices/);
  assert.match(html, /US\$0\.01/); assert.match(html, /1 of 3 recorded calls have an unknown charge/); assert.match(html, /__runTerminalReviewFixture/);
  assert.doesNotMatch(html, /PRIVATE_PROVIDER_PAYLOAD|PRIVATE_DATABASE_FAILURE|service_role|OPENROUTER_API_KEY/);
});

test('populated hosted fixture retains mixed types and two Businesses across actual root render paths', async () => {
  const fixture = createDecisionBrowserFixture(), queue = await fixture.render(queueStart);
  assert.equal(queue.data.page.total, 143); assert.equal(queue.data.page.items.length, 25);
  assert.equal(new Set(queue.data.page.items.map(row => row.business_id)).size, 2);
  for (const type of ['synthetic_workflow_review', 'browser_takeover', 'browser_return_control', 'etsy_simulation_review', 'future.unknown']) assert.ok(queue.data.page.items.some(row => row.intervention_type === type));
  const typed = fixture.tables.owner_interventions[126], html = await decisionDocument(decisionRoute(typed), { fixture });
  assert.match(html, />Approve and complete demo<\/button>/); assert.match(html, /deniedTypedAction/);
  const selected = fixture.tables.owner_interventions[1];
  for (const route of [`/dashboard?view=overview&business=${businessId}`, `/dashboard?view=work&business=${businessId}&run=${selected.workflow_run_id}`]) assert.ok((await decisionDocument(route, { fixture })).includes('consoleMain'));
  assert.equal(fixture.rpcCalls.length, 0); assert.equal(fixture.hookCalls.length, 0);
});

test('retained root document has a real hydration island, Suspense boundary and all fifty unavailable-completeness account requests', async () => {
  const fixture = createDecisionBrowserFixture({ accountRequests: fiftyAccountRequests() }), route = `/dashboard?view=decisions&decision=${oldNotice.id}`;
  const props = await decisionClientState(route, fixture), html = await decisionDocument(route, { fixture, retained: true });
  assert.equal(props.connectionRequests.records.length, 50); assert.equal(props.connectionRequests.count, null); assert.equal(props.connectionRequests.unavailable, true);
  assert.match(html, /<div id="decision-root-island" style="display:contents"><!--\$--><section class="compactDecisions"/);
  assert.match(html, /Connection requests could not be checked/); assert.match(html, /Saved connection requests · (?:<!-- -->)?50/);
  assert.match(html, /window\.__decisionRetained=true/); assert.match(html, /__loadDecisionRootFixture/);
  assert.equal(fixture.rpcCalls.length, 0); assert.equal(fixture.hookCalls.length, 0);
});

// Hosted CI only. Do not add a local path override or execute local Chromium.
const enabled = process.env.CI === 'true' && process.env.GUIDED_UI_BROWSER === '1';
test('hosted real-root Decisions: compact viewports, exact selection, keyboard, pending, real-action errors and persisted review', { skip: !enabled, timeout: 240_000 }, async t => {
  const browser = await chromium.launch({ headless: true });
  const directory = path.resolve('test-results/guided-ui'); mkdirSync(directory, { recursive: true });
  try {
    for (const [width, height] of [[1280, 720], [1440, 900], [640, 450], [390, 844]]) await t.test(`${width}x${height} real root acknowledgement`, async () => {
      const fixture = createDecisionBrowserFixture(), notice = fixture.tables.owner_interventions[1];
      const savedRun = structuredClone(fixture.tables.workflow_runs[1]), savedStage = structuredClone(fixture.tables.workflow_stage_runs[1]);
      const receipts = structuredClone(fixture.tables.creative_cost_settlements), reservations = structuredClone(fixture.tables.creative_cost_reservations), history = structuredClone(fixture.events);
      const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', serviceWorkers: 'block' });
      const denied = [], errors = [];
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin === origin && url.pathname === '/dashboard' && request.method() === 'GET' && request.resourceType() === 'document' && ['decisions', 'overview', 'work'].includes(url.searchParams.get('view'))) {
          return route.fulfill({ contentType: 'text/html', body: await decisionDocument(url.pathname + url.search, { fixture }) });
        }
        denied.push(`${request.method()} ${request.url()}`); return route.abort();
      });
      const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      // The bridge only enters the production action with an inert owner-session/RPC test double.
      // It is not an HTTP endpoint, provider request, or direct mutation from browser code.
      await page.exposeFunction('__runTerminalReviewFixture', async entries => {
        const form = new FormData(); for (const [key, value] of entries) { assert.equal(typeof value, 'string'); form.append(key, value); }
        return fixture.perform(form);
      });
      const ready = async () => {
        await page.waitForFunction(() => window.__decisionHydrated === true);
        assert.deepEqual(await page.evaluate(() => window.__decisionErrors), []);
      };
      const bounds = async () => {
        const size = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, viewport: innerHeight,
          actionBottom: document.querySelector('.compactDecisionActionArea')?.getBoundingClientRect().bottom }));
        assert.ok(size.width <= width + 1, JSON.stringify(size));
        if (width > 900) { assert.ok(size.height <= height + 1, JSON.stringify(size)); if (size.actionBottom) assert.ok(size.actionBottom <= height, JSON.stringify(size)); }
      };
      const submitAndNavigate = async () => {
        await Promise.all([page.waitForURL(url => url.searchParams.has('error') || url.searchParams.has('message')), page.getByRole('button', { name: 'Mark reviewed', exact: true }).click()]);
        await ready(); await bounds();
      };
      try {
        await page.goto(origin + selectedStart); await ready(); await bounds();
        assert.equal(await page.locator(".compactDecisionDetailHeader h2").evaluate(node => node === document.activeElement), true, "Exact selected notice receives keyboard focus");
        assert.equal(await page.locator('.compactDecisionRow').count(), 25); assert.match(await page.locator('[data-decision-count]').innerText(), /131 open notices/);
        assert.equal(await page.locator('.compactDecisionDetail').getAttribute('data-decision-id'), notice.id);
        assert.equal(await page.locator('.compactDecisionRow[data-selected=true]').count(), 0, 'Exact selection is older than all eighty overview runs and off current page');
        assert.equal(await page.locator('[name=expectedUpdatedAt]').inputValue(), notice.updated_at);
        assert.match(await page.locator('.compactDecisionCosts').innerText(), /1 of 3 recorded calls have an unknown charge/);
        await page.screenshot({ path: path.join(directory, `console-decisions-root-populated-${width}.png`), fullPage: true });
        const evidence = page.getByRole('region', { name: 'Decision evidence and receipts' }); await evidence.focus(); await page.keyboard.press('End');
        if (width > 900) assert.ok(await evidence.evaluate(node => node.scrollTop) > 0, 'Keyboard can scroll the compact evidence pane');
        await page.getByRole('link', { name: 'Next', exact: true }).click(); await ready(); await bounds();
        assert.equal(new URL(page.url()).searchParams.get('page'), '2'); assert.equal(new URL(page.url()).searchParams.get('decision'), notice.id);
        await page.goBack(); await ready(); assert.equal(new URL(page.url()).searchParams.get('decision'), notice.id);
        const close = page.getByRole('link', { name: 'Close decision details' }); await close.focus(); await page.keyboard.press('Enter'); await ready();
        assert.equal(await page.locator('.compactDecisionDetail').count(), 0);
        const view = page.locator('.compactDecisionRow a').first(); await view.focus(); await page.keyboard.press('Enter'); await ready(); await bounds();
        assert.equal(await page.locator('.compactDecisionDetail').count(), 1);
        await page.reload(); await ready(); assert.equal(await page.locator('.compactDecisionDetail').count(), 1); assert.equal(fixture.rpcCalls.length, 0);
        // Real action failure, with the actual client submit component holding pending and blocking a repeated click.
        fixture.setMode('error'); await page.goto(origin + selectedStart); await ready();
        await page.evaluate(() => { window.__holdDecisionAction = true; });
        const button = page.getByRole('button', { name: 'Mark reviewed', exact: true }); await button.focus(); await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.querySelector('[data-decision-pending=true]'));
        const pending = page.getByRole('button', { name: 'Recording review…', exact: true }); assert.equal(await pending.isDisabled(), true);
        await pending.evaluate(node => node.click()); assert.equal(await page.evaluate(() => window.__decisionActionCalls), 1); assert.equal(fixture.rpcCalls.length, 0);
        await page.screenshot({ path: path.join(directory, `console-decisions-root-pending-${width}.png`), fullPage: true });
        await Promise.all([page.waitForURL(url => url.searchParams.get('error') === 'terminal-review-failed'), page.evaluate(() => window.__releaseDecisionAction())]);
        await ready(); await bounds();
        assert.equal(fixture.rpcCalls.length, 1); assert.equal(fixture.mutations.length, 0); assert.equal(notice.status, 'open');
        await page.locator('[data-decision-outcome=error]').waitFor(); assert.equal(await page.getByRole('button', { name: 'Mark reviewed', exact: true }).isDisabled(), false);
        assert.match(await page.locator('.compactDecisionState').innerText(), /Stopped · Notice open/);
        // The stale concurrency token is read from a real form, then the saved fixture changes before submission.
        await page.goto(origin + selectedStart); await ready(); fixture.setMode('success'); notice.updated_at = '2026-10-02T04:10:20.123457+00:00';
        await submitAndNavigate(); assert.equal(new URL(page.url()).searchParams.get('error'), 'terminal-review-conflict'); assert.equal(fixture.mutations.length, 0);
        assert.equal(await page.locator('[name=expectedUpdatedAt]').inputValue(), notice.updated_at);
        // A malformed/uncertain RPC result never displays an optimistic success.
        await page.goto(origin + selectedStart); await ready(); fixture.setMode('uncertain'); await submitAndNavigate();
        assert.equal(new URL(page.url()).searchParams.get('error'), 'terminal-review-failed'); assert.match(await page.locator('.compactDecisionState').innerText(), /Notice open/); assert.equal(fixture.mutations.length, 0);
        // Successful submission invokes the exact actual server action and reloads the actual root from saved state.
        fixture.setMode('success'); const preservedRoute = decisionRoute(notice, '&page=3&status=all'); await page.goto(origin + preservedRoute); await ready();
        await submitAndNavigate(); const returned = new URL(page.url()).searchParams;
        assert.equal(returned.get('message'), 'terminal-review-acknowledged'); assert.equal(returned.get('page'), '3'); assert.equal(returned.get('status'), 'all'); assert.equal(returned.get('decision'), notice.id);
        assert.equal(fixture.mutations.length, 1); assert.equal(fixture.mutations[0].id, notice.id); assert.equal(fixture.context().needsYouCount, 142);
        assert.match(await page.locator('.compactDecisionState').innerText(), /Stopped · reviewed/); assert.equal(await page.getByRole('button', { name: 'Mark reviewed', exact: true }).count(), 0);
        assert.match(await page.locator('.compactDecisionCosts').innerText(), /1 of 3 recorded calls have an unknown charge/);
        await page.screenshot({ path: path.join(directory, `console-decisions-root-reviewed-${width}.png`), fullPage: true });
        await page.reload(); await ready(); assert.match(await page.locator('.compactDecisionState').innerText(), /Stopped · reviewed/);
        const callsBeforeBack = fixture.rpcCalls.length; await page.goBack(); await ready(); await page.reload(); await ready();
        assert.match(await page.locator('.compactDecisionState').innerText(), /Stopped · reviewed/); assert.equal(fixture.rpcCalls.length, callsBeforeBack);
        await page.goto(origin + selectedStart); await ready(); assert.match(await page.locator('[data-decision-count]').innerText(), /130 open notices/);
        await page.getByRole('link', { name: 'View saved workflow in Work', exact: true }).click(); await ready();
        assert.equal(new URL(page.url()).searchParams.get('run'), notice.workflow_run_id); assert.match(await page.locator('.consoleMain').innerText(), /Stopped/);
        assert.doesNotMatch(await page.locator('.consoleMain').innerText(), /Work is in progress|Waiting for your decision|Waiting for owner input/);
        assert.match(await page.locator('.guidedOutcomeSpending').innerText(), /1 of 3 recorded calls have an unknown charge/);
        await page.goto(`${origin}/dashboard?view=overview&business=${businessId}`); await ready();
        assert.doesNotMatch(await page.locator('.consoleMain').innerText(), /Work is in progress|Waiting for your decision|Waiting for owner input/);
        assert.deepEqual(fixture.tables.workflow_runs[1], savedRun); assert.deepEqual(fixture.tables.workflow_stage_runs[1], savedStage);
        assert.deepEqual(fixture.tables.creative_cost_settlements, receipts); assert.deepEqual(fixture.tables.creative_cost_reservations, reservations); assert.deepEqual(fixture.events.filter(row => history.some(saved => saved.id === row.id)), history); assert.equal(fixture.events.length, history.length + 1);
        await page.goto(origin + queueStart); await ready(); await bounds();
        assert.match(await page.locator('[data-decision-count]').innerText(), /142 open notices/);
        assert.equal(await page.locator('select[name=business] option').count(), 3);
        assert.match(await page.locator('.compactDecisionRows').innerText(), /Saved synthetic workflow review request|Saved browser takeover request|Saved etsy simulation review request/);
        await page.screenshot({ path: path.join(directory, `console-decisions-root-queue-${width}.png`), fullPage: true });
        assert.deepEqual(errors, []); assert.deepEqual(denied, []);
      } finally { await context.close(); }
    });
  } finally { await browser.close(); }
});

test('hosted retained React/Suspense Decisions lifecycle, account disclosure, focus, scroll and pending transitions', { skip: !enabled, timeout: 240_000 }, async t => {
  const browser = await chromium.launch({ headless: true });
  const directory = path.resolve('test-results/guided-ui'); mkdirSync(directory, { recursive: true });
  try {
    for (const [width, height] of [[1280, 720], [1440, 900], [640, 450], [390, 844]]) await t.test(`${width}x${height} retained root Decisions`, async () => {
      const fixture = createDecisionBrowserFixture({ accountRequests: fiftyAccountRequests() }), notice = fixture.tables.owner_interventions[1], other = fixture.tables.owner_interventions[4];
      const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', serviceWorkers: 'block' });
      const denied = [], errors = []; let documents = 0;
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin === origin && url.pathname === '/dashboard' && request.method() === 'GET' && request.resourceType() === 'document' && url.searchParams.get('view') === 'decisions') {
          documents++; return route.fulfill({ contentType: 'text/html', body: await decisionDocument(url.pathname + url.search, { fixture, retained: true }) });
        }
        denied.push(`${request.method()} ${request.url()}`); return route.abort();
      });
      const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      await page.exposeFunction('__loadDecisionRootFixture', route => decisionClientState(route, fixture));
      await page.exposeFunction('__runTerminalReviewFixture', entries => {
        const form = new FormData(); for (const [key, value] of entries) { assert.equal(typeof value, 'string'); form.append(key, value); }
        return fixture.perform(form);
      });
      const commitAfter = async action => {
        const before = await page.evaluate(() => window.__decisionRetainedRenderCount);
        await action(); await page.waitForFunction(previous => window.__decisionRetainedRenderCount > previous, before);
        assert.deepEqual(await page.evaluate(() => window.__decisionErrors), []);
      };
      const navigate = route => commitAfter(() => page.evaluate(target => { void window.__navigateDecisionRetained(target); }, route));
      const headingFocused = async () => {
        await page.waitForFunction(() => document.activeElement === document.querySelector('.compactDecisionDetailHeader h2'));
        assert.equal(await page.locator('.compactDecisionDetailScroll').evaluate(node => node.scrollTop), 0);
      };
      const bounded = async () => {
        const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight,
          action: document.querySelector('.compactDecisionActionArea')?.getBoundingClientRect().toJSON(), account: document.querySelector('.compactConnectionRequests')?.getBoundingClientRect().toJSON() }));
        assert.ok(dimensions.width <= width + 1, JSON.stringify(dimensions));
        if (width > 900) {
          assert.ok(dimensions.height <= height + 1, JSON.stringify(dimensions));
          if (dimensions.action) { assert.ok(dimensions.action.top >= 0, JSON.stringify(dimensions)); assert.ok(dimensions.action.bottom <= height + 1, JSON.stringify(dimensions)); }
          if (dimensions.account) assert.ok(dimensions.account.height <= 121, JSON.stringify(dimensions));
        }
      };
      try {
        await page.goto(origin + queueStart); await page.waitForFunction(() => window.__decisionHydrated && typeof window.__navigateDecisionRetained === 'function');
        await page.screenshot({ path: path.join(directory, `console-decisions-retained-initial-${width}.png`), fullPage: true });
        assert.equal(await page.locator('select[name=business]').inputValue(), ''); assert.equal(await page.locator('select[name=status]').inputValue(), 'open');
        await bounded();
        // Paging replaces only the queue scroll region. Selection and Close retain it.
        await page.locator('.compactDecisionRows').evaluate(node => { node.scrollTop = node.scrollHeight; window.__previousQueue = node; });
        await commitAfter(() => page.getByRole('link', { name: 'Next', exact: true }).click());
        assert.equal(new URL(page.url()).searchParams.get('page'), '2');
        assert.equal(await page.locator('.compactDecisionRows').evaluate(node => node === window.__previousQueue), false);
        assert.equal(await page.locator('.compactDecisionRows').evaluate(node => node.scrollTop), 0);
        await commitAfter(() => page.getByRole('link', { name: 'Previous', exact: true }).click());
        await page.locator('.compactDecisionRows').evaluate(node => { node.scrollTop = node.scrollHeight; window.__previousQueue = node; window.__previousQueueScroll = node.scrollTop; });
        const view = page.locator('.compactDecisionRow a').last(); const selectedHref = await view.getAttribute('href');
        await commitAfter(async () => { await view.focus(); await page.keyboard.press('Enter'); }); await headingFocused();
        assert.equal(await page.locator('.compactDecisionRows').evaluate(node => node === window.__previousQueue), true);
        if (width > 900) assert.ok(await page.locator('.compactDecisionRows').evaluate(node => Math.abs(node.scrollTop - window.__previousQueueScroll) <= 2));
        await commitAfter(async () => { await page.getByRole('link', { name: 'Close decision details' }).focus(); await page.keyboard.press('Enter'); });
        assert.equal(await page.locator('.compactDecisionDetail').count(), 0); assert.equal(await page.locator('.compactDecisionRows').evaluate(node => node === window.__previousQueue), true);
        if (width > 900) assert.ok(await page.locator('.compactDecisionRows').evaluate(node => Math.abs(node.scrollTop - window.__previousQueueScroll) <= 2));
        await commitAfter(() => page.evaluate(() => history.back())); await headingFocused();
        assert.equal(new URL(page.url()).searchParams.get('decision'), new URL(selectedHref, origin).searchParams.get('decision'));
        // Default-valued controls must track new server props on retained transitions and Back.
        const secondBusiness = fixture.context().businesses[1].id;
        await navigate(`/dashboard?view=decisions&business=${secondBusiness}&status=resolved`);
        assert.equal(await page.locator('select[name=business]').inputValue(), secondBusiness); assert.equal(await page.locator('select[name=status]').inputValue(), 'resolved');
        await navigate(queueStart); assert.equal(await page.locator('select[name=business]').inputValue(), ''); assert.equal(await page.locator('select[name=status]').inputValue(), 'open');
        await commitAfter(() => page.evaluate(() => history.back())); assert.equal(await page.locator('select[name=business]').inputValue(), secondBusiness); assert.equal(await page.locator('select[name=status]').inputValue(), 'resolved');
        await navigate(`/dashboard?view=decisions&decision=${notice.id}`); await headingFocused();
        assert.equal(await page.locator('.compactConnectionRequests a').count(), 50); await page.getByText('Connection requests could not be checked.', { exact: false }).waitFor();
        await page.locator('.compactConnectionRequests summary').click(); assert.equal(await page.locator('.compactConnectionRequests').getAttribute('open'), ''); await bounded();
        assert.equal(await page.getByRole('button', { name: 'Mark reviewed', exact: true }).isVisible(), true);
        await page.screenshot({ path: path.join(directory, `console-decisions-retained-account-disclosure-${width}.png`), fullPage: true });
        // An unresolved submit must not make a different selected notice's new controls pending.
        fixture.setMode('error'); await page.evaluate(() => { window.__holdDecisionAction = true; });
        await page.getByRole('button', { name: 'Mark reviewed', exact: true }).click(); await page.locator('[data-decision-pending=true]').waitFor();
        await navigate(`/dashboard?view=decisions&decision=${other.id}`); await headingFocused();
        assert.equal(await page.locator('[data-decision-pending=true]').count(), 0); assert.equal(await page.getByRole('button', { name: 'Mark reviewed', exact: true }).isDisabled(), false);
        await commitAfter(() => page.evaluate(() => { window.__holdDecisionAction = false; window.__releaseDecisionAction(); }));
        assert.equal(new URL(page.url()).searchParams.get('decision'), notice.id); await headingFocused();
        assert.equal(await page.locator('[data-decision-pending=true]').count(), 0); assert.equal(fixture.mutations.length, 0);
        // Same-notice result replaces its versioned form and refocuses the retained heading.
        fixture.setMode('success'); await page.locator('.compactDecisionDetailHeader h2').evaluate(node => { window.__sameNoticeHeading = node; });
        await page.locator('.compactDecisionDetailScroll').evaluate(node => { node.scrollTop = node.scrollHeight; });
        await commitAfter(() => page.getByRole('button', { name: 'Mark reviewed', exact: true }).click()); await headingFocused();
        assert.equal(await page.locator('.compactDecisionDetailHeader h2').evaluate(node => node === window.__sameNoticeHeading), true);
        assert.match(await page.locator('.compactDecisionState').innerText(), /Stopped · reviewed/); assert.equal(await page.locator('[data-decision-pending=true]').count(), 0);
        assert.equal(await page.getByRole('button', { name: 'Mark reviewed', exact: true }).count(), 0); assert.equal(fixture.mutations.length, 1);
        assert.match(await page.locator('[data-decision-count]').innerText(), /142 open notices/); assert.match(await page.locator('.compactDecisionCosts').innerText(), /1 of 3 recorded calls have an unknown charge/);
        await bounded(); await page.screenshot({ path: path.join(directory, `console-decisions-retained-reviewed-${width}.png`), fullPage: true });
        assert.equal(documents, 1, 'All post-load transitions retained the client root rather than reloading a document');
        assert.deepEqual(errors, []); assert.deepEqual(denied, []);
      } finally { await context.close(); }
    });
  } finally { await browser.close(); }
});
