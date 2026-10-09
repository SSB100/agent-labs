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
  for (const route of [`/dashboard?view=work&business=${businessId}&run=${selected.workflow_run_id}`, `/dashboard?view=overview&business=${businessId}`]) assert.ok((await decisionDocument(route, { fixture })).includes('consoleMain'));
  assert.equal(fixture.rpcCalls.length, 0); assert.equal(fixture.hookCalls.length, 0);
});

test('retained root document has a real hydration island, unknown total and all fifty retained account requests', async () => {
  const fixture = createDecisionBrowserFixture({ accountRequests: fiftyAccountRequests() }), route = `/dashboard?view=decisions&decision=${oldNotice.id}`;
  const props = await decisionClientState(route, fixture), html = await decisionDocument(route, { fixture, retained: true });
  assert.equal(props.connectionRequests.records.length, 50); assert.equal(props.connectionRequests.count, null); assert.equal(props.connectionRequests.unavailable, true);
  assert.match(html, /<div id="decision-root-island" style="display:contents"><!--\$--><section class="compactDecisions"/);
  assert.match(html, /Connection requests could not be checked/); assert.match(html, /Saved connection requests · (?:<!-- -->)?Unknown/);
  assert.doesNotMatch(html, /Saved connection requests · (?:<!-- -->)?50/);
  assert.equal((html.match(/Review saved setup request<\/a>/g) ?? []).length, 50, "Retained links are not an authoritative total");
  assert.match(html, /window\.__decisionRetained=true/); assert.match(html, /__loadDecisionRootFixture/);
  assert.equal(fixture.rpcCalls.length, 0); assert.equal(fixture.hookCalls.length, 0);
});

const decisionViewports = [
  { width: 1280, height: 720, label: '1280x720 desktop', slug: '1280' },
  { width: 1440, height: 900, label: '1440x900 desktop', slug: '1440' },
  // Also exercises the CSS viewport available on a 1280x900 display at 200% zoom.
  { width: 640, height: 450, label: '640x450 narrow / zoom CSS viewport', slug: '640' },
  { width: 390, height: 844, label: '390x844 mobile', slug: '390' },
  { width: 320, height: 640, label: '320x640 narrow mobile', slug: '320' },
];

async function assertFilterGeometry(page) {
  const geometry = await page.evaluate(() => {
    const form = document.querySelector('.compactDecisionFilters');
    const rect = node => node ? node.getBoundingClientRect().toJSON() : null;
    const controls = [['Business', 'select[name=business]'], ['Status', 'select[name=status]'], ['Apply', 'button[type=submit]']].map(([name, selector]) => {
      const node = form?.querySelector(selector);
      return { name, rect: rect(node), label: rect(node?.closest('label')) };
    });
    return { viewport: innerWidth, form: rect(form), workspace: rect(document.querySelector('.compactDecisions')), controls };
  });
  const detail = JSON.stringify(geometry), epsilon = 1;
  assert.ok(geometry.form && geometry.workspace, `Missing filter containers: ${detail}`);
  const inside = (inner, outer) => inner.left >= outer.left - epsilon && inner.right <= outer.right + epsilon && inner.top >= outer.top - epsilon && inner.bottom <= outer.bottom + epsilon;
  assert.ok(geometry.form.left >= -epsilon && geometry.form.right <= geometry.viewport + epsilon, `Filter row exceeds viewport: ${detail}`);
  assert.ok(inside(geometry.form, geometry.workspace), `Filter row exceeds workspace: ${detail}`);
  for (const control of geometry.controls) {
    assert.ok(control.rect && control.rect.width > 0 && control.rect.height > 0, `Missing ${control.name} control: ${detail}`);
    assert.ok(inside(control.rect, geometry.form), `${control.name} exceeds filter row: ${detail}`);
    if (control.label) assert.ok(inside(control.rect, control.label), `${control.name} select exceeds its label: ${detail}`);
    assert.ok(control.rect.left >= -epsilon && control.rect.right <= geometry.viewport + epsilon, `${control.name} exceeds viewport: ${detail}`);
  }
  for (let left = 0; left < geometry.controls.length; left++) for (let right = left + 1; right < geometry.controls.length; right++) {
    const a = geometry.controls[left], b = geometry.controls[right];
    const overlapWidth = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
    const overlapHeight = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
    assert.ok(overlapWidth <= epsilon || overlapHeight <= epsilon, `${a.name} and ${b.name} overlap: ${detail}`);
  }
}

async function assertInitialEvidenceAboveFold(page) {
  const geometry = await page.evaluate(() => {
    const pane = document.querySelector('.compactDecisionDetailScroll');
    const selectors = ['.compactDecisionReason', '.compactDecisionCosts>h3', '[data-decision-cost]', '.compactDecisionCosts>p'];
    return { pane: pane?.getBoundingClientRect().toJSON(), scrollTop: pane?.scrollTop, items: selectors.map(selector => ({ selector, rect: document.querySelector(selector)?.getBoundingClientRect().toJSON() })) };
  });
  const detail = JSON.stringify(geometry); assert.ok(geometry.pane, `Selected scroll viewport missing: ${detail}`); assert.equal(geometry.scrollTop, 0);
  for (const item of geometry.items) {
    assert.ok(item.rect, `Primary evidence is missing: ${detail}`);
    assert.ok(item.rect.top >= geometry.pane.top - 1 && item.rect.bottom <= geometry.pane.bottom + 1, `Primary reason/charge requires initial scrolling: ${detail}`);
  }
}

async function assertSelectedHeadingVisible(page) {
  const geometry = await page.evaluate(() => {
    const heading = document.querySelector('.compactDecisionDetailHeader h2'), header = heading?.closest('.compactDecisionDetailHeader');
    const rect = node => node?.getBoundingClientRect().toJSON();
    const headingRect = rect(heading), viewportTop = visualViewport?.offsetTop ?? 0;
    const blockers = ['.consoleTopBar', '.consoleCommandBar'].map(selector => {
      const node = document.querySelector(selector);
      return { selector, rect: rect(node), position: node ? getComputedStyle(node).position : null };
    });
    const hitPoints = headingRect ? [headingRect.top + 2, (headingRect.top + headingRect.bottom) / 2, headingRect.bottom - 2].map(y => {
      const x = headingRect.left + headingRect.width / 2, hit = document.elementFromPoint(x, y);
      return { x, y, visible: hit === heading || Boolean(heading?.contains(hit)), hit: hit?.tagName ?? null, hitClass: typeof hit?.className === 'string' ? hit.className : null };
    }) : [];
    return { viewportTop, viewportBottom: viewportTop + (visualViewport?.height ?? innerHeight), viewportWidth: innerWidth,
      heading: headingRect, header: rect(header), focused: document.activeElement === heading,
      documentScroll: document.scrollingElement?.scrollTop ?? 0, blockers, hitPoints };
  });
  const detail = JSON.stringify(geometry); assert.ok(geometry.heading && geometry.header, `Selected heading missing: ${detail}`); assert.equal(geometry.focused, true, detail);
  assert.ok(geometry.header.top >= geometry.viewportTop - 1 && geometry.header.bottom <= geometry.viewportBottom + 1, `Selected header outside visible viewport: ${detail}`);
  for (const blocker of geometry.blockers) if (blocker.rect && ['fixed', 'sticky'].includes(blocker.position)) {
    const overlap = Math.min(blocker.rect.bottom, geometry.header.bottom) - Math.max(blocker.rect.top, geometry.header.top);
    assert.ok(overlap <= 1, `Selected header intersects sticky/fixed chrome: ${detail}`);
  }
  assert.ok(geometry.hitPoints.every(point => point.visible), `Focused heading is occluded: ${detail}`);
  if (geometry.viewportWidth > 900) assert.equal(geometry.documentScroll, 0, `Desktop document must not scroll during focus: ${detail}`);
}

async function captureDecisionState(page, directory, name, width) {
  if (width <= 900) await page.screenshot({ path: path.join(directory, `${name}-viewport.png`), fullPage: false });
  const scroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
  // Chromium's beyond-viewport capture can move document scroll. Keep artifact
  // collection from changing the owner journey; never refocus/reveal a heading.
  try {
    await page.screenshot({ path: path.join(directory, `${name}.png`), fullPage: true });
  } finally {
    const after = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
    if (after.x !== scroll.x || after.y !== scroll.y) {
      console.info('Full-page screenshot changed document scroll', { name, before: scroll, after });
      await page.evaluate(({ x, y }) => window.scrollTo({ left: x, top: y, behavior: 'instant' }), scroll);
    }
    assert.deepEqual(await page.evaluate(() => ({ x: scrollX, y: scrollY })), scroll, 'Artifact capture must preserve document scroll');
  }
}

async function exerciseContextDisclosure(page, desktop) {
  const disclosure = page.locator('.compactDecisionContext');
  assert.equal(await disclosure.count(), 1, 'Saved concept, workflow and Business remain accessible in one disclosure');
  await disclosure.locator('summary').focus(); await page.keyboard.press('Enter');
  assert.equal(await disclosure.getAttribute('open'), '');
  assert.match(await disclosure.locator('.compactDecisionFacts').innerText(), /Concept[\s\S]*Workflow[\s\S]*Business/);
  assert.match(await disclosure.locator('.compactDecisionFacts').innerText(), /Saved concept 2/);
  if (desktop) {
    const evidence = page.getByRole('region', { name: 'Decision evidence and receipts' });
    assert.ok(await evidence.evaluate(node => node.scrollHeight > node.clientHeight), 'Expanded context creates meaningful keyboard scrolling');
    await evidence.focus(); await page.keyboard.press('End');
    await page.waitForFunction(() => { const node = document.querySelector('.compactDecisionDetailScroll'); return node && node.scrollTop > 0 && node.scrollTop >= node.scrollHeight - node.clientHeight - 2; });
  }
  await disclosure.locator('summary').focus(); await page.keyboard.press('Enter');
}

async function captureFailure(page, filename, testContext) {
  try {
    if (page.viewportSize()?.width <= 900) await page.screenshot({ path: filename.replace(/\.png$/, '-viewport.png'), fullPage: false, timeout: 5000 });
    await page.screenshot({ path: filename, fullPage: true, timeout: 5000 });
  }
  catch (captureError) { testContext.diagnostic(`Failure screenshot unavailable: ${captureError.message}`); }
}

// Hosted CI only. Do not add a local path override or execute local Chromium.
const enabled = process.env.CI === 'true' && process.env.GUIDED_UI_BROWSER === '1';
test('hosted native GET Decisions filters restore URL, queue and exact selection on Back/Forward', { skip: !enabled, timeout: 120_000 }, async t => {
  const browser = await chromium.launch({ headless: true });
  const directory = path.resolve('test-results/guided-ui'); mkdirSync(directory, { recursive: true });
  try {
    for (const { width, height, label, slug } of decisionViewports.filter(viewport => [1280, 390].includes(viewport.width))) await t.test(`${label} native filter history`, async () => {
      const fixture = createDecisionBrowserFixture(), notice = fixture.tables.owner_interventions[1];
      // Mixed saved statuses make a stale Status select observably disagree with the queue.
      for (const index of [130, 142]) fixture.tables.owner_interventions[index].status = 'resolved';
      const savedTables = structuredClone(fixture.tables), savedEvents = structuredClone(fixture.events);
      const secondBusiness = fixture.context().businesses[1].id, selectedRoute = decisionRoute(notice, '&page=3');
      const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', serviceWorkers: 'block' });
      const documents = [], denied = [], errors = [];
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin === origin && url.pathname === '/dashboard' && request.method() === 'GET' && request.resourceType() === 'document' && url.searchParams.get('view') === 'decisions') {
          documents.push(url.pathname + url.search);
          return route.fulfill({ contentType: 'text/html', body: await decisionDocument(url.pathname + url.search, { fixture }) });
        }
        denied.push(`${request.method()} ${request.url()}`); return route.abort();
      });
      const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      // Observe actual browser lifecycle events; never synthesize restoration or intercept submit.
      await page.addInitScript(() => {
        window.__nativeDecisionPageShows = [];
        addEventListener('pageshow', event => window.__nativeDecisionPageShows.push({ persisted: event.persisted, trusted: event.isTrusted }));
      });
      const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const matchesSavedRoute = async (route, historyNavigation = false) => {
        await page.waitForURL(origin + route); await page.waitForFunction(() => window.__decisionHydrated === true);
        await settle();
        const expected = await fixture.render(route), params = new URL(page.url()).searchParams;
        assert.deepEqual([...params], [...new URL(route, origin).searchParams], 'The complete native query survives history traversal');
        assert.equal(await page.locator('select[name=business]').inputValue(), expected.data.query.businessId ?? '');
        assert.equal(await page.locator('select[name=status]').inputValue(), expected.data.query.status);
        assert.deepEqual(await page.locator('.compactDecisionRow').evaluateAll(rows => rows.map(row => row.getAttribute('data-console-motion-id'))), expected.data.page.items.map(row => row.id));
        assert.equal(await page.locator('[data-decision-count]').innerText(), `${expected.data.page.total} ${expected.data.query.status === 'open' ? 'open ' : ''}notices`);
        assert.equal(await page.locator('.compactDecisionDetail').count(), expected.data.selection.status === 'found' ? 1 : 0);
        if (expected.data.selection.status === 'found') assert.equal(await page.locator('.compactDecisionDetail').getAttribute('data-decision-id'), expected.data.selection.item.id);
        assert.equal(params.get('decision'), expected.data.query.selectedId); assert.equal(params.get('page') ?? '1', String(expected.data.query.page));
        assert.deepEqual(await page.evaluate(() => window.__decisionErrors), []);
        assert.equal(await page.evaluate(() => window.__decisionRetained), false, 'This path must use native document navigation');
        if (historyNavigation) assert.equal(await page.evaluate(() => window.__nativeDecisionPageShows.some(event => event.trusted) &&
          (window.__nativeDecisionPageShows.some(event => event.persisted) || performance.getEntriesByType('navigation')[0]?.type === 'back_forward')), true,
        'Back/Forward must be a real browser history restoration');
      };
      try {
        const cases = [
          { name: 'status', business: notice.business_id, status: 'all' },
          { name: 'business', business: secondBusiness, status: 'open' },
          { name: 'all-businesses', business: '', status: 'open' },
        ];
        for (const filter of cases) {
          await page.goto(origin + selectedRoute); await matchesSavedRoute(selectedRoute);
          const form = page.locator('.compactDecisionFilters'); assert.equal(await form.getAttribute('method'), 'get');
          await form.locator('select[name=business]').selectOption(filter.business);
          await form.locator('select[name=status]').selectOption(filter.status); await settle();
          assert.equal(await form.locator('select[name=business]').inputValue(), filter.business, 'Hydrated Business edits stay editable before Apply');
          assert.equal(await form.locator('select[name=status]').inputValue(), filter.status, 'Hydrated Status edits stay editable before Apply');
          assert.equal(new URL(page.url()).searchParams.get('decision'), notice.id, 'Editing a filter does not navigate or alter exact selection');
          const destination = `/dashboard?${new URLSearchParams({ view: 'decisions', business: filter.business, status: filter.status })}`;
          const documentsBeforeSubmit = documents.length;
          await Promise.all([page.waitForURL(origin + destination), form.getByRole('button', { name: 'Apply', exact: true }).click()]);
          assert.equal(documents.length, documentsBeforeSubmit + 1, 'Apply sends a native GET document request');
          await matchesSavedRoute(destination);
          assert.equal(new URL(page.url()).searchParams.has('decision'), false); assert.equal(new URL(page.url()).searchParams.has('page'), false);
          await page.goBack(); await matchesSavedRoute(selectedRoute, true);
          await captureDecisionState(page, directory, `console-decisions-native-${filter.name}-back-${slug}`, width);
          await page.goForward(); await matchesSavedRoute(destination, true);
        }
        assert.equal(fixture.rpcCalls.length, 0); assert.equal(fixture.hookCalls.length, 0); assert.equal(fixture.mutations.length, 0);
        assert.deepEqual(fixture.tables, savedTables); assert.deepEqual(fixture.events, savedEvents);
        assert.deepEqual(errors, []); assert.deepEqual(denied, []);
      } catch (error) {
        await captureFailure(page, path.join(directory, `console-decisions-native-filter-failure-${slug}.png`), t);
        throw error;
      } finally { await context.close(); }
    });
  } finally { await browser.close(); }
});

test('hosted real-root Decisions: compact viewports, exact selection, keyboard, pending, real-action errors and persisted review', { skip: !enabled, timeout: 240_000 }, async t => {
  const browser = await chromium.launch({ headless: true });
  const directory = path.resolve('test-results/guided-ui'); mkdirSync(directory, { recursive: true });
  try {
    for (const { width, height, label, slug } of decisionViewports) await t.test(`${label} real root acknowledgement`, async () => {
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
        await assertFilterGeometry(page);
        const size = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, viewport: innerHeight,
          actionBottom: document.querySelector('.compactDecisionActionArea')?.getBoundingClientRect().bottom }));
        assert.ok(size.width <= width + 1, JSON.stringify(size));
        if (width > 900) { assert.ok(size.height <= height + 1, JSON.stringify(size)); if (size.actionBottom) assert.ok(size.actionBottom <= height, JSON.stringify(size)); }
      };
      const submitAndNavigate = async () => {
        await Promise.all([page.waitForURL(url => url.searchParams.has('error') || url.searchParams.has('message')), page.getByRole('button', { name: 'Mark reviewed', exact: true }).click()]);
        await ready(); await bounds(); await assertSelectedHeadingVisible(page);
      };
      try {
        await page.goto(origin + selectedStart); await page.waitForFunction(() => window.__decisionHydrated === true);
        await assertSelectedHeadingVisible(page);
        await captureDecisionState(page, directory, `console-decisions-root-populated-${slug}`, width);
        await ready(); await bounds();
        await assertSelectedHeadingVisible(page);
        assert.equal(await page.locator('.compactDecisionRow').count(), 25); assert.match(await page.locator('[data-decision-count]').innerText(), /131 open notices/);
        assert.equal(await page.locator('.compactDecisionDetail').getAttribute('data-decision-id'), notice.id);
        assert.equal(await page.locator('.compactDecisionRow[data-selected=true]').count(), 0, 'Exact selection is older than all eighty overview runs and off current page');
        assert.equal(await page.locator('[name=expectedUpdatedAt]').inputValue(), notice.updated_at);
        assert.match(await page.locator('.compactDecisionCosts').innerText(), /1 of 3 recorded calls have an unknown charge/);
        if (width > 900) await assertInitialEvidenceAboveFold(page);
        await exerciseContextDisclosure(page, width > 900);
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
        await captureDecisionState(page, directory, `console-decisions-root-pending-${slug}`, width);
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
        await assertSelectedHeadingVisible(page);
        await captureDecisionState(page, directory, `console-decisions-root-reviewed-${slug}`, width);
        await page.reload(); await ready(); assert.match(await page.locator('.compactDecisionState').innerText(), /Stopped · reviewed/);
        const callsBeforeBack = fixture.rpcCalls.length; await page.goBack(); await ready(); await page.reload(); await ready();
        assert.match(await page.locator('.compactDecisionState').innerText(), /Stopped · reviewed/); assert.equal(fixture.rpcCalls.length, callsBeforeBack);
        await page.goto(origin + selectedStart); await ready(); assert.match(await page.locator('[data-decision-count]').innerText(), /130 open notices/);
        await page.getByRole('link', { name: 'View saved workflow in Work', exact: true }).click(); await ready();
        assert.equal(new URL(page.url()).searchParams.get('run'), notice.workflow_run_id); assert.match(await page.locator('.consoleMain').innerText(), /Stopped/);
        assert.doesNotMatch(await page.locator('.consoleMain').innerText(), /Work is in progress|Waiting for your decision|Waiting for owner input/);
        const savedWork = page.locator('[data-work-detail]');
        assert.equal(await savedWork.getAttribute('data-work-detail'), notice.workflow_run_id);
        assert.match(await savedWork.getByRole('region', { name: 'Recorded provider charges', exact: true }).innerText(), /1 of 3 recorded calls have an unknown charge/);
        await page.goto(`${origin}/dashboard?view=overview&business=${businessId}`); await ready();
        assert.doesNotMatch(await page.locator('.consoleMain').innerText(), /Work is in progress|Waiting for your decision|Waiting for owner input/);
        assert.deepEqual(fixture.tables.workflow_runs[1], savedRun); assert.deepEqual(fixture.tables.workflow_stage_runs[1], savedStage);
        assert.deepEqual(fixture.tables.creative_cost_settlements, receipts); assert.deepEqual(fixture.tables.creative_cost_reservations, reservations); assert.deepEqual(fixture.events.filter(row => history.some(saved => saved.id === row.id)), history); assert.equal(fixture.events.length, history.length + 1);
        await page.goto(origin + queueStart); await ready(); await bounds();
        assert.match(await page.locator('[data-decision-count]').innerText(), /142 open notices/);
        assert.equal(await page.locator('select[name=business] option').count(), 3);
        assert.match(await page.locator('.compactDecisionRows').innerText(), /Saved synthetic workflow review request|Saved browser takeover request|Saved etsy simulation review request/);
        await captureDecisionState(page, directory, `console-decisions-root-queue-${slug}`, width);
        assert.deepEqual(errors, []); assert.deepEqual(denied, []);
      } catch (error) {
        await captureFailure(page, path.join(directory, `console-decisions-root-failure-${slug}.png`), t);
        throw error;
      } finally { await context.close(); }
    });
  } finally { await browser.close(); }
});

test('hosted retained React/Suspense Decisions lifecycle, account disclosure, focus, scroll and pending transitions', { skip: !enabled, timeout: 240_000 }, async t => {
  const browser = await chromium.launch({ headless: true });
  const directory = path.resolve('test-results/guided-ui'); mkdirSync(directory, { recursive: true });
  try {
    for (const { width, height, label, slug } of decisionViewports) await t.test(`${label} retained root Decisions`, async () => {
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
      let releaseRead = null, onReadHeld = null;
      await page.exposeFunction('__loadDecisionRootFixture', async route => {
        if (releaseRead === 'hold') await new Promise(resolve => { releaseRead = resolve; onReadHeld?.(); onReadHeld = null; });
        return decisionClientState(route, fixture);
      });
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
        await assertSelectedHeadingVisible(page);
      };
      const bounded = async () => {
        await assertFilterGeometry(page);
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
        await captureDecisionState(page, directory, `console-decisions-retained-initial-${slug}`, width);
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
        // Fresh props for the unchanged route cannot discard unsubmitted hydrated edits.
        const unchangedRoute = new URL(page.url()).pathname + new URL(page.url()).search;
        const secondBusiness = fixture.context().businesses[1].id;
        await page.locator('select[name=business]').selectOption(secondBusiness); await page.locator('select[name=status]').selectOption('all');
        await navigate(unchangedRoute);
        assert.equal(await page.locator('select[name=business]').inputValue(), secondBusiness);
        assert.equal(await page.locator('select[name=status]').inputValue(), 'all');
        // A fresh edit after a restoration event wins over its queued animation frame.
        await page.evaluate(() => {
          dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
          const status = document.querySelector('select[name=status]'); status.value = 'declined'; status.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await page.locator('select[name=business]').inputValue(), secondBusiness);
        assert.equal(await page.locator('select[name=status]').inputValue(), 'declined');
        // Default-valued controls must track new server props on retained transitions and Back.
        await navigate(`/dashboard?view=decisions&business=${secondBusiness}&status=resolved`);
        assert.equal(await page.locator('select[name=business]').inputValue(), secondBusiness); assert.equal(await page.locator('select[name=status]').inputValue(), 'resolved');
        await navigate(queueStart); assert.equal(await page.locator('select[name=business]').inputValue(), ''); assert.equal(await page.locator('select[name=status]').inputValue(), 'open');
        await commitAfter(() => page.evaluate(() => history.back())); assert.equal(await page.locator('select[name=business]').inputValue(), secondBusiness); assert.equal(await page.locator('select[name=status]').inputValue(), 'resolved');
        await navigate(`/dashboard?view=decisions&decision=${notice.id}`); await headingFocused();
        // A history event can precede new server props. The old route must not overwrite live edits.
        const nextNotice = fixture.tables.owner_interventions[140];
        const nextRoute = decisionRoute(nextNotice, '&status=resolved');
        await page.locator('select[name=business]').selectOption(secondBusiness); await page.locator('select[name=status]').selectOption('all');
        const filterReadHeld = new Promise(resolve => { onReadHeld = resolve; }); releaseRead = 'hold';
        const beforeFilterNavigation = await page.evaluate(() => window.__decisionRetainedRenderCount);
        await page.evaluate(target => { history.pushState({}, '', target); dispatchEvent(new PopStateEvent('popstate')); }, nextRoute);
        await filterReadHeld; await page.waitForFunction(() => window.__decisionReadPending === true);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await page.locator('.compactDecisionDetail').getAttribute('data-decision-id'), notice.id, 'Old props remain visible during the fixture read');
        assert.equal(await page.locator('select[name=business]').inputValue(), secondBusiness, 'A mismatched old Business cannot overwrite the edit');
        assert.equal(await page.locator('select[name=status]').inputValue(), 'all', 'A mismatched old Status cannot overwrite the edit');
        assert.equal(typeof releaseRead, 'function'); releaseRead(); releaseRead = null;
        await page.waitForFunction(previous => window.__decisionRetainedRenderCount > previous, beforeFilterNavigation);
        await page.waitForFunction(() => document.querySelector('select[name=status]')?.value === 'resolved');
        assert.equal(await page.locator('select[name=business]').inputValue(), secondBusiness);
        assert.equal(await page.locator('.compactDecisionDetail').getAttribute('data-decision-id'), nextNotice.id);
        assert.equal(page.url(), origin + nextRoute);
        await navigate(`/dashboard?view=decisions&decision=${notice.id}`); await headingFocused();
        // Background version refresh preserves the saved-Quest opener focus and a native modal barrier.
        const goal = page.locator('#console-command-open');
        await goal.focus();
        const draftScroll = await page.evaluate(() => scrollY);
        notice.updated_at = '2026-10-02T04:10:20.123458+00:00';
        const readHeld = new Promise(resolve => { onReadHeld = resolve; }); releaseRead = 'hold';
        const beforeRefresh = await page.evaluate(() => window.__decisionRetainedRenderCount);
        await page.evaluate(target => { void window.__navigateDecisionRetained(target); }, `/dashboard?view=decisions&decision=${notice.id}`);
        await readHeld; await page.waitForFunction(() => window.__decisionReadPending === true);
        assert.equal(await page.locator('.compactDecisionDetail').isVisible(), true, 'A pending fixture read keeps the selected component mounted and visible');
        assert.equal(await goal.evaluate(node => node === document.activeElement), true);
        assert.equal(await page.evaluate(() => scrollY), draftScroll, 'Pending read cannot collapse the document beneath an active control');
        assert.equal(typeof releaseRead, 'function'); releaseRead(); releaseRead = null;
        await page.waitForFunction(previous => window.__decisionRetainedRenderCount > previous, beforeRefresh);
        assert.equal(await goal.evaluate(node => node === document.activeElement), true);
        assert.match(await goal.innerText(), /Choose Business/);
        assert.equal(await page.evaluate(() => scrollY), draftScroll, 'A background notice revision cannot move the active research opener');
        // This native dialog probes focus isolation; actual Research sheet lifecycle has its separate suite.
        await page.evaluate(() => {
          const dialog = document.createElement('dialog'); dialog.id = 'decision-modal-focus-probe'; dialog.className = 'consoleResearchSheet';
          const draft = document.createElement('textarea'); draft.setAttribute('aria-label', 'Native modal draft probe'); draft.value = 'Preserve modal research draft';
          dialog.append(draft); document.body.append(dialog); dialog.showModal(); draft.focus();
        });
        const modalScroll = await page.evaluate(() => scrollY);
        await navigate(`/dashboard?view=decisions&decision=${other.id}`);
        assert.equal(await page.locator('#decision-modal-focus-probe textarea').evaluate(node => node === document.activeElement), true);
        assert.equal(await page.locator('#decision-modal-focus-probe textarea').inputValue(), 'Preserve modal research draft');
        assert.equal(await page.evaluate(() => scrollY), modalScroll, 'A selected background notice cannot move an open native dialog');
        // Reconcile browser-restored selects under the modal without touching its focus or draft.
        await page.evaluate(business => {
          document.querySelector('select[name=business]').value = business;
          document.querySelector('select[name=status]').value = 'all';
          dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
        }, secondBusiness);
        await page.waitForFunction(() => document.querySelector('select[name=business]')?.value === '' && document.querySelector('select[name=status]')?.value === 'open');
        assert.equal(await page.locator('#decision-modal-focus-probe textarea').evaluate(node => node === document.activeElement), true);
        assert.equal(await page.locator('#decision-modal-focus-probe textarea').inputValue(), 'Preserve modal research draft');
        assert.equal(await page.evaluate(() => scrollY), modalScroll, 'Filter restoration cannot move an open native dialog');
        await page.evaluate(() => { const dialog = document.querySelector('#decision-modal-focus-probe'); dialog.close(); dialog.remove(); });
        await navigate(`/dashboard?view=decisions&decision=${notice.id}`); await headingFocused();
        assert.equal(await page.locator('.compactConnectionRequests a').count(), 50); await page.getByText('Connection requests could not be checked.', { exact: false }).waitFor();
        await page.locator('.compactConnectionRequests summary').click(); assert.equal(await page.locator('.compactConnectionRequests').getAttribute('open'), ''); await bounded();
        assert.equal(await page.getByRole('button', { name: 'Mark reviewed', exact: true }).isVisible(), true);
        await captureDecisionState(page, directory, `console-decisions-retained-account-disclosure-${slug}`, width);
        // An unresolved submit must not make a different selected notice's new controls pending.
        fixture.setMode('error'); await page.evaluate(() => { window.__holdDecisionAction = true; });
        await page.getByRole('button', { name: 'Mark reviewed', exact: true }).click(); await page.locator('[data-decision-pending=true]').waitFor();
        await navigate(`/dashboard?view=decisions&decision=${other.id}`); await headingFocused();
        assert.equal(await page.locator('[data-decision-pending=true]').count(), 0); assert.equal(await page.getByRole('button', { name: 'Mark reviewed', exact: true }).isDisabled(), false);
        const completions = await page.evaluate(() => window.__decisionActionCompletions);
        await page.evaluate(() => { window.__holdDecisionAction = false; window.__releaseDecisionAction(); });
        await page.waitForFunction(previous => window.__decisionActionCompletions > previous, completions);
        assert.equal(await page.evaluate(() => window.__decisionDiscardedActions), 1, 'A late result cannot replace a newer user selection');
        assert.equal(new URL(page.url()).searchParams.get('decision'), other.id); await headingFocused();
        assert.equal(await page.locator('[data-decision-pending=true]').count(), 0); assert.equal(fixture.mutations.length, 0);
        assert.equal(await page.getByRole('button', { name: 'Mark reviewed', exact: true }).isDisabled(), false);
        // Explicitly revisiting A reads its authoritative still-open state after the failed action.
        await navigate(`/dashboard?view=decisions&decision=${notice.id}`); await headingFocused();
        assert.match(await page.locator('.compactDecisionState').innerText(), /Stopped · Notice open/);
        // Same-notice result replaces its versioned form and refocuses the retained heading.
        fixture.setMode('success'); await page.locator('.compactDecisionDetailHeader h2').evaluate(node => { window.__sameNoticeHeading = node; });
        await page.locator('.compactDecisionDetailScroll').evaluate(node => { node.scrollTop = node.scrollHeight; });
        await commitAfter(() => page.getByRole('button', { name: 'Mark reviewed', exact: true }).click()); await headingFocused();
        assert.equal(await page.locator('.compactDecisionDetailHeader h2').evaluate(node => node === window.__sameNoticeHeading), true);
        assert.match(await page.locator('.compactDecisionState').innerText(), /Stopped · reviewed/); assert.equal(await page.locator('[data-decision-pending=true]').count(), 0);
        assert.equal(await page.getByRole('button', { name: 'Mark reviewed', exact: true }).count(), 0); assert.equal(fixture.mutations.length, 1);
        assert.match(await page.locator('[data-decision-count]').innerText(), /142 open notices/); assert.match(await page.locator('.compactDecisionCosts').innerText(), /1 of 3 recorded calls have an unknown charge/);
        await bounded(); await captureDecisionState(page, directory, `console-decisions-retained-reviewed-${slug}`, width);
        assert.equal(documents, 1, 'All post-load transitions retained the client root rather than reloading a document');
        assert.deepEqual(errors, []); assert.deepEqual(denied, []);
      } catch (error) {
        await captureFailure(page, path.join(directory, `console-decisions-retained-failure-${slug}.png`), t);
        throw error;
      } finally { await context.close(); }
    });
  } finally { await browser.close(); }
});
