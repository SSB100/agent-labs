import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { createResearchBrowserFixture, browserResearchTables, researchClientState, researchEvidenceState, researchDocument, researchRedirect, researchRedirectResponse, researchRedirectDocument, researchEvidencePayload, researchEvidenceRequest, observeResearchCloseDeparture,
  origin, id, businessId, secondBusinessId, selectedId, selectedBusinessBId, freshRecordId, legacyId, candidateId, orphanId, mismatchedWorkId, literalText,
  rootsRoute, recordsRoute, offFilterRoute, attemptsRoute } from './helpers/console-research-browser.mjs';

const metadata = fixture => fixture.calls.filter(call => /loadConsoleResearch(?:Page|RecordsPage)$/.test(call.name));
const evidence = fixture => fixture.calls.filter(call => call.name === 'loadConsoleResearchEvidence');
const directory = path.resolve('test-results/guided-ui');
// Hosted only, matching the existing browser suite. Never use a local executable
// or network fallback. GUIDED_UI_BROWSER without the hosted CI gate stays inert.
const enabled = process.env.CI === 'true' && process.env.GUIDED_UI_BROWSER === '1';
const viewports = [
  { width: 1440, height: 900, slug: '1440x900' }, { width: 1280, height: 720, slug: '1280x720' },
  { width: 1000, height: 800, slug: '1000x800-single' }, { width: 900, height: 768, slug: '900x768' },
  { width: 640, height: 450, slug: '640x450-zoom' }, { width: 390, height: 844, slug: '390x844' }, { width: 320, height: 740, slug: '320x740' },
];
const savedStateRoute = `/dashboard?view=research&type=records&business=${businessId}&q=Duplicate+saved+research+objective&searchField=objective&sort=oldest`;

for (const [kind, route] of [['roots', rootsRoute], ['records', recordsRoute]]) test(`synthetic actual-root Research ${kind} bundles production pane/ready/viewport without provider transport`, async () => {
  const fixture = createResearchBrowserFixture(), html = await researchDocument(route, { fixture });
  assert.equal(metadata(fixture).length, 1); assert.equal(metadata(fixture)[0].name, kind === 'roots' ? 'loadConsoleResearchPage' : 'loadConsoleResearchRecordsPage');
  assert.equal(evidence(fixture).length, 0); assert.equal(fixture.ancillaryCalls.length, 0); assert.deepEqual(fixture.denied, []);
  assert.match(html, /<div id="research-root-island" style="display:contents"><!--\$-->/);
  assert.match(html, /data-research-evidence-loading=/); assert.match(html, /__loadResearchEvidenceFixture/); assert.match(html, /console-research-evidence-ready/);
  assert.match(html, /consoleResearchToolbar/); assert.match(html, /SYNTHETIC actual-root read-only Research fixture/);
  assert.doesNotMatch(html, /service_role|OPENROUTER_API_KEY|NEXT_PUBLIC_SUPABASE|https:\/\/[^"\s]+supabase/);
  assert.ok(fixture.reads.every(read => read.range ? read.range[1] - read.range[0] === 25 : read.limit === 2));
});

test('new Research browser data retains127+ raw records,130 attempts, duplicates and real persisted malformed contexts', async () => {
  const tables = browserResearchTables(); assert.ok(tables.product_experiments.length >= 127);
  assert.equal(tables.product_experiments.filter(row => row.variables?.budgetAuthorityRootId === selectedId).length, 130);
  assert.equal(new Set(tables.product_experiments.map(row => row.business_id)).size, 2);
  assert.ok(tables.workflow_runs.every(row => !Object.hasOwn(row.input, 'intent')));
  const fixture = createResearchBrowserFixture(), state = await researchClientState(attemptsRoute, fixture);
  assert.equal(state.pane.data.page.items.length, 0); assert.equal(state.pane.data.page.page, 3); assert.equal(state.pane.data.query.businessId, null);
  assert.equal(state.pane.data.selection.item.id, selectedId); assert.equal(state.pane.data.attempts.page.total, 130); assert.equal(state.pane.data.attempts.page.page, 2);
  assert.equal(state.pane.data.attempts.newest.item.id, fixture.newestId); assert.equal(state.pane.data.attempts.newestContext.item.id, fixture.newestId);
  assert.equal(state.pane.data.attempts.page.items.some(row => row.id === fixture.newestId), false);
  for (const [selected, kind] of [[legacyId, 'legacy_record'], [candidateId, 'candidate_record'], [orphanId, 'follow_up_record']]) {
    const next = await researchClientState(`/dashboard?view=research&type=records&selected=${selected}`, fixture);
    assert.equal(next.pane.data.selection.item.recordKind, kind);
    if (selected === orphanId) { assert.equal(next.pane.data.selection.item.authority.status, 'missing'); assert.equal(next.pane.data.selection.item.prior_root_id, id(999999)); }
  }
  const mismatch = await researchClientState(`/dashboard?view=research&type=records&selected=${mismatchedWorkId}`, fixture);
  assert.equal(mismatch.pane.data.selection.item.workflow.status, 'unavailable'); assert.equal(mismatch.pane.data.selection.item.workIdentity, null);
  assert.deepEqual(fixture.denied, []);
});

test('existing exact saved-state rows are reader-proven instead of assumed on the aggregate oldest page', async () => {
  const fixture = createResearchBrowserFixture(), tables = browserResearchTables(), oldest = await researchClientState('/dashboard?view=research&type=records&sort=oldest', fixture);
  assert.equal(oldest.pane.data.query.sort, 'oldest'); assert.equal(oldest.pane.data.page.items[0].id, selectedId);
  assert.ok(oldest.pane.data.page.items.every(row => row.status === 'completed'));
  const page = await fixture.render(savedStateRoute);
  assert.equal(page.data.query.sort, 'oldest'); assert.equal(page.data.query.searchField, 'objective'); assert.equal(page.data.query.businessId, businessId); assert.equal(page.data.page.total, 127);
  for (const [number, status, ended] of [[1000, 'researching', false], [1001, 'reserved', false], [1009, 'researching', true]]) {
    const raw = tables.product_experiments.find(row => row.id === id(number)), record = page.data.page.items.find(row => row.id === raw.id);
    assert.ok(record); assert.equal(raw.status, status); assert.equal(!!raw.completed_at, ended); assert.equal(record.status, status); assert.equal(!!record.completed_at, ended);
    const row = page.markup.match(new RegExp(`<li[^>]*data-research-record="${record.id}"[\\s\\S]*?</li>`))?.[0]; assert.ok(row);
    assert.match(row, ended ? /End recorded; saved state: researching · inconsistent/ : /Execution not established here/);
    if (!ended) assert.match(row, new RegExp(`Saved ${status}`));
  }
  assert.equal(fixture.ancillaryCalls.length, 0); assert.deepEqual(fixture.denied, []);
});

test('departure observer reads exact native pointer/click before pane persistence without focus scroll or navigation changes', () => {
  const body = Object.freeze({ scrollTop: 20 }), results = Object.freeze({ scrollTop: 40 }), detail = Object.freeze({ scrollTop: 123 }), listeners = new Map();
  const view = { scrollY: 10, location: Object.freeze({ pathname: '/dashboard', search: '?view=research&type=records', hash: '' }) };
  const pane = Object.freeze({ querySelector: selector => ({ ':scope>.consoleResearchBody': body, '.consoleResearchResults': results, '.consoleResearchDetail': detail })[selector] });
  const document = { defaultView: view, addEventListener(type, listener, options) { assert.deepEqual(options, { capture: true, passive: true }); listeners.set(type, listener); },
    removeEventListener(type, listener, capture) { assert.equal(capture, true); assert.equal(listeners.get(type), listener); listeners.delete(type); } };
  const link = Object.freeze({ ownerDocument: document, tagName: 'A', textContent: 'Close detail', closest: selector => selector === '.consoleResearchPane' ? pane : null,
    getAttribute: name => name === 'href' ? '/dashboard?view=research&type=records' : null });
  observeResearchCloseDeparture(link);
  const event = (type, path) => ({ type, eventPhase: 1, isTrusted: true, composedPath: () => path });
  listeners.get('pointerdown')(event('pointerdown', [pane, document])); assert.equal(view.__researchCloseDeparture.length, 0);
  listeners.get('pointerdown')(event('pointerdown', [link, pane, document]));
  listeners.get('click')(event('click', [link, pane, document]));
  assert.deepEqual(view.__researchCloseDeparture, ['pointerdown', 'click'].map(type => ({ type, phase: 1, trusted: true, exactClose: true, href: '/dashboard?view=research&type=records', route: '/dashboard?view=research&type=records', reading: { document: 10, body: 20, results: 40, detail: 123 } })));
  assert.equal(listeners.size, 0); assert.equal(view.scrollY, 10); assert.equal(view.location.search, '?view=research&type=records');
  assert.match(readFileSync('src/components/console/console-collection-scroll.ts', 'utf8'), /root\.addEventListener\("click", save, true\)/);
});

test('actual rendered newest-attempt href requests pager1/newest while preserving unrelated aggregate main query', async () => {
  const fixture = createResearchBrowserFixture(), page = await fixture.render(attemptsRoute), match = page.markup.match(/<a [^>]*href="([^"]+)"[^>]*>Newest first<\/a>/);
  assert.ok(match); const target = new URL(match[1].replaceAll('&amp;', '&'), origin), next = await researchClientState(target.pathname + target.search + target.hash, fixture);
  assert.equal(next.pane.data.query.attemptPage, 1); assert.equal(next.pane.data.query.attemptSort, 'newest');
  assert.equal(next.pane.data.attempts.page.page, 1); assert.equal(next.pane.data.attempts.page.total, 130);
  for (const key of ['page', 'query', 'searchField', 'businessId', 'kind', 'selectedId', 'rootId']) assert.equal(next.pane.data.query[key], page.data.query[key]);
  assert.equal(next.pane.data.attempts.page.items[0].id, fixture.newestId); assert.equal(fixture.ancillaryCalls.length, 0); assert.deepEqual(fixture.denied, []);
});

test('exact evidence uses original adapter and producer IDs, scoped B command and escaped saved TEST text', async () => {
  const fixture = createResearchBrowserFixture(), state = await researchClientState(offFilterRoute, fixture);
  assert.equal(state.pane.data.page.total, 0); assert.equal(state.pane.data.selection.item.id, selectedBusinessBId); assert.equal(state.command.businessId, secondBusinessId);
  assert.equal(state.shell.navigationBusinessId, secondBusinessId); assert.equal(state.pane.data.query.businessId, null); assert.equal(state.sheet, null);
  const payload = await researchEvidenceState(state.progressive.route, fixture);
  assert.equal(payload.record.business_id, secondBusinessId); assert.equal(payload.evidence.integrity, 'verified'); assert.equal(payload.evidence.history.recordedOutcome, 'TEST'); assert.equal(payload.evidence.history.freshness, 'stale');
  assert.equal(payload.ready.scopeHref, state.command.returnTo); assert.equal(payload.ready.recordId, selectedBusinessBId); assert.equal(payload.ready.businessId, secondBusinessId);
  const html = await researchDocument(offFilterRoute, { fixture, initialEvidence: true });
  assert.match(html, /Recorded research recommendation: TEST/); assert.match(html, /Stale saved evidence/); assert.match(html, /does not qualify a product, authorize launch or establish available money/);
  assert.match(html, /&lt;img src=x onerror=/); assert.doesNotMatch(html, /<img src=x onerror=/); assert.doesNotMatch(html, /href="javascript:|<strong>saved text<\/strong>/);
  assert.ok(payload.evidence.artifacts.length >= 3); assert.ok(payload.evidence.artifacts.every(row => row.businessId === secondBusinessId));
  assert.equal(fixture.ancillaryCalls.length, 0); assert.deepEqual(fixture.denied, []);
});

test('actual observation time distinguishes a within-window saved record from expired evidence without renewing either', async () => {
  const fixture = createResearchBrowserFixture();
  for (const [record, freshness] of [[freshRecordId, 'within_saved_window'], [selectedId, 'stale']]) {
    const state = await researchClientState(`/dashboard?view=research&type=records&selected=${record}`, fixture), payload = await researchEvidenceState(state.progressive.route, fixture);
    assert.equal(payload.evidence.integrity, 'verified'); assert.equal(payload.evidence.history.freshness, freshness);
    assert.equal(evidence(fixture).at(-1).arguments[0].observedAt, '2026-10-02T03:00:00.000Z');
  }
  assert.equal(fixture.ancillaryCalls.length, 0); assert.deepEqual(fixture.denied, []);
});

for (const mode of ['missing', 'unavailable', 'mismatched']) test(`actual-root newest ${mode} context does not substitute an older attempt`, async () => {
  const fixture = createResearchBrowserFixture({ latest: mode }), state = await researchClientState(attemptsRoute, fixture);
  assert.equal(state.pane.data.attempts.newest.item.id, fixture.newestId);
  // The actual reader reports an unverified newest context as unavailable even
  // when its exact-detail read returned zero rows. Assert that fault explicitly.
  assert.equal(state.pane.data.attempts.newestContext.status, 'unavailable');
  if (mode === 'missing') assert.ok(fixture.reads.some(read => read.columns.includes('intent:') && read.filters.some(([, key, value]) => key === 'id' && value === fixture.newestId) && read.result.count === 0 && read.result.data.length === 0));
  assert.equal(state.pane.data.attempts.newestContext.item, null); assert.equal(state.pane.data.attempts.page.total, 130);
  assert.equal(evidence(fixture).length, 0); assert.deepEqual(fixture.denied, []);
});

test('canonical aliases run actual redirects before metadata and keep real aggregate fragments distinct from IDs', async () => {
  const fixture = createResearchBrowserFixture();
  for (const route of [`/dashboard?view=library&type=research&business=${businessId}&experiment=${selectedId}`, `/dashboard/products?view=results&business=${businessId}#discovery-goal-results`]) {
    const target = new URL(await researchRedirect(route, fixture), origin); assert.equal(target.searchParams.get('view'), 'research'); assert.equal(target.searchParams.get('business'), businessId);
    if (route.includes('experiment=')) assert.equal(target.searchParams.get('selected'), selectedId); else assert.equal(target.searchParams.has('selected'), false);
    assert.equal(target.hash, ''); assert.equal(fixture.reads.length, 0); assert.equal(fixture.ancillaryCalls.length, 0);
  }
  // An actual legacy loader is deliberately denied, proving these URLs did not
  // redirect or gain fabricated record/Work/artifact bridges.
  for (const suffix of ['view=results&candidate=' + id(400), 'view=results&artifact=' + id(401), 'view=results&message=Funding+recorded', 'view=results&error=Preserved+failure', 'view=unknown', 'view=create']) {
    const legacy = createResearchBrowserFixture(); await assert.rejects(researchRedirect('/dashboard/products?' + suffix, legacy), /Read-only Research fixture denies external effects/);
    assert.equal(legacy.reads.length, 0); assert.equal(legacy.ancillaryCalls.length, 0); assert.equal(legacy.denied.length, 1);
  }
});

test('actual owner-route targets decode to installed Next307 Location while browser delivery stays explicitly synthetic', async () => {
  for (const route of [`/dashboard?view=library&type=research&business=${businessId}&experiment=${selectedId}`, `/dashboard/products?view=results&business=${businessId}#discovery-goal-results`]) {
    const fixture = createResearchBrowserFixture(), response = await researchRedirectResponse(route, fixture);
    assert.equal(response.status, 307); const target = new URL(response.headers.location, origin);
    assert.equal(target.origin, origin); assert.equal(target.pathname, '/dashboard'); assert.equal(target.searchParams.get('view'), 'research'); assert.equal(target.searchParams.get('business'), businessId);
    assert.equal(target.searchParams.get('selected'), route.includes('experiment=') ? selectedId : null); assert.equal(target.hash, '');
    assert.equal(fixture.reads.length, 0); assert.equal(fixture.ancillaryCalls.length, 0); assert.deepEqual(fixture.denied, []);
    const document = researchRedirectDocument(response); assert.match(document, /SYNTHETIC owner-route redirect navigation/); assert.match(document, /location\.replace\(target\.href\)/);
    assert.match(document, /target\.hash=location\.hash/); assert.doesNotMatch(document, /hydrateRoot|discovery-actions|supabase/);
  }
  assert.throws(() => researchRedirectDocument({ status: 307, headers: { location: 'https://foreign.invalid/dashboard?view=research' } }));
  assert.throws(() => researchRedirectDocument({ status: 307, headers: { location: '/dashboard/products?view=results' } }));
  assert.throws(() => researchRedirectDocument({ status: 307, headers: { location: `https://agentlabs-research-root.test/dashboard?view=research` } }));
  assert.throws(() => researchRedirectDocument({ status: 307, headers: { location: `//agentlabs-research-root.test/dashboard?view=research` } }));
  assert.throws(() => researchRedirectDocument({ status: 307, headers: { location: 'javascript:alert(1)' } }));
  const literal = '/dashboard?view=research&type=roots&q=</script><script>window.__unsafeResearch=true</script>&searchField=objective', document = researchRedirectDocument({ status: 307, headers: { location: literal } });
  assert.match(document, /\\u003c\/script>/); assert.equal((document.match(/<script>/g) ?? []).length, 1); assert.equal((document.match(/<\/script>/g) ?? []).length, 1); assert.doesNotMatch(document, /q=<\/script>/);
});

test('same production key starts a genuinely pending descriptor-bound read and cannot show a stale payload', async () => {
  const fixture = createResearchBrowserFixture(), original = await researchClientState(offFilterRoute, fixture), oldPayload = await researchEvidenceState(original.progressive.route, fixture), sheet = await researchClientState(original.pane.researchHref, fixture);
  assert.equal(original.progressive.key, sheet.progressive.key); assert.notEqual(original.progressive.route, sheet.progressive.route);
  let resolved = { descriptor: original.progressive, payload: oldPayload }, discarded = 0, releaseFirst, releaseSecond;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; }), secondGate = new Promise(resolve => { releaseSecond = resolve; });
  const first = researchEvidenceRequest({ descriptor: original.progressive, load: async route => { await firstGate; return researchEvidenceState(route, fixture); }, onResolve: value => { resolved = value; }, onDiscard: () => { discarded++; } });
  assert.equal(first.pending, true); first.dispose(); assert.equal(first.pending, false);
  const second = researchEvidenceRequest({ descriptor: sheet.progressive, load: async route => { await secondGate; return researchEvidenceState(route, fixture); }, onResolve: value => { resolved = value; }, onDiscard: () => { discarded++; } });
  assert.equal(second.pending, true); assert.equal(researchEvidencePayload(resolved, sheet.progressive), null);
  releaseFirst(); await first.promise; assert.equal(discarded, 1); assert.equal(second.pending, true); assert.equal(researchEvidencePayload(resolved, sheet.progressive), null);
  releaseSecond(); await second.promise; assert.equal(second.pending, false); assert.equal(researchEvidencePayload(resolved, sheet.progressive).record.id, selectedBusinessBId);
  assert.equal(researchEvidencePayload(resolved, original.progressive), null); assert.deepEqual(fixture.denied, []);
});

test('ordinary browse and Plan research chooser remain quote/catalogue-free with selected Business preserved', async () => {
  const fixture = createResearchBrowserFixture(), browse = await researchClientState(offFilterRoute, fixture);
  assert.equal(fixture.ancillaryCalls.length, 0); const setup = await researchClientState(browse.pane.researchHref, fixture);
  assert.deepEqual(fixture.ancillaryCalls, []);
  assert.equal(setup.sheet.returnTo, browse.command.returnTo); assert.deepEqual(setup.sheet.quest.businesses.map(row => row.id), [secondBusinessId]);
  assert.deepEqual(fixture.denied, []);
});

test('new browser fixture preserves missing unavailable count-null error and unavailable-Business truth before hydration', async () => {
  for (const [options, expected] of [[{}, 'missing'], [{ unavailableSelection: true }, 'unavailable'], [{ countNull: true }, 'found'], [{ failList: true }, 'found'], [{ businessesUnavailable: true }, 'unavailable']]) {
    const fixture = createResearchBrowserFixture(options), record = expected === 'missing' ? id(999999) : selectedId, state = await researchClientState(`/dashboard?view=research&type=records&business=${businessId}&selected=${record}`, fixture);
    assert.equal(state.pane.data.selection.status, expected); assert.equal(state.pane.data.query.businessId, businessId);
    if (options.countNull || options.failList || options.businessesUnavailable) { assert.equal(state.pane.data.page.total, null); assert.equal(state.pane.data.page.complete, false); }
    if (options.businessesUnavailable) { assert.equal(fixture.reads.length, 0); assert.equal(state.command.unavailable, true); }
    if (expected !== 'found') assert.equal(state.progressive, null);
    assert.equal(fixture.ancillaryCalls.length, 0); assert.deepEqual(fixture.denied, []);
  }
});

async function frames(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function ready(page, { evidenceReady = true } = {}) {
  await page.waitForFunction(() => window.__researchHydrated === true && !window.__researchReadPending && window.__researchCommittedRoute === location.pathname + location.search + location.hash);
  if (evidenceReady) await page.waitForFunction(() => !window.__researchEvidencePending && !document.querySelector('[data-research-evidence-loading]'));
  assert.deepEqual(await page.evaluate(() => window.__researchErrors), []); await frames(page);
}
async function capture(page, name) {
  mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `${name}-viewport.png`), fullPage: false });
  await page.screenshot({ path: path.join(directory, `${name}.png`), fullPage: true });
}
async function measurements(page) {
  return page.evaluate(() => {
    const rect = node => node?.getBoundingClientRect().toJSON(), toolbar = document.querySelector('.consoleResearchToolbar');
    return { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, viewport: { width: innerWidth, height: innerHeight },
      heading: rect(document.querySelector('#console-research-heading')), outcome: rect(document.querySelector('.consoleResearchSummary h3')), detailHeading: rect(document.querySelector('.consoleResearchDetail>header h2')),
      next: rect(document.querySelector('.consoleResearchHeader nav a:last-child')), toolbar: rect(toolbar), body: rect(document.querySelector('.consoleResearchPane>.consoleResearchBody')),
      footer: rect(document.querySelector('.consoleResearchPane>.consoleResearchPagination')), command: rect(document.querySelector('.consoleCommandBar')),
      controls: [...toolbar.querySelectorAll('input:not([type=hidden]),select,button')].map(node => ({ name: node.name || node.textContent, rect: rect(node), font: parseFloat(getComputedStyle(node).fontSize), label: node.labels?.[0]?.textContent ?? node.textContent })),
      targets: [...document.querySelectorAll('.consoleResearchPane a,.consoleResearchPane button,.consoleResearchPane input:not([type=hidden]),.consoleResearchPane select,.consoleResearchPane summary')].filter(node => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0).map(node => ({ text: (node.getAttribute('aria-label') || node.textContent || node.name).slice(0, 80), rect: rect(node), font: parseFloat(getComputedStyle(node).fontSize) })),
      rows: [...document.querySelectorAll('.consoleResearchList [data-research-record]')].map(node => node.dataset.researchRecord), documentScroll: scrollY };
  });
}
async function bounds(page, viewport, t) {
  const result = await measurements(page), detail = JSON.stringify(result); t.diagnostic(detail);
  assert.ok(result.width <= viewport.width + 1, detail);
  if (viewport.width > 900) {
    assert.ok(result.height <= viewport.height + 1, detail); assert.equal(result.documentScroll, 0, detail);
    assert.ok(result.body.height >= 150, detail); assert.ok(result.footer.bottom <= result.command.top + 1, detail);
    assert.ok(result.heading.top >= 0 && result.heading.bottom <= result.command.top, detail);
    assert.ok(result.next.top >= 0 && result.next.bottom <= result.command.top, detail);
  }
  for (const control of result.controls) {
    assert.ok(control.rect.height >= 43 && control.rect.width >= 43, detail); assert.ok(control.font >= 12, detail); assert.ok(control.label?.trim(), detail);
    assert.ok(control.rect.left >= -1 && control.rect.right <= viewport.width + 1, detail);
  }
  for (const target of result.targets) assert.ok(target.rect.height >= 43 && target.rect.width >= 43 && target.font >= 12, detail);
  for (let i = 0; i < result.controls.length; i++) for (let j = i + 1; j < result.controls.length; j++) {
    const a = result.controls[i].rect, b = result.controls[j].rect;
    assert.ok(Math.min(a.right, b.right) - Math.max(a.left, b.left) <= 1 || Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) <= 1, detail);
  }
  return result;
}
async function visible(page, selector, { focus = false, scroll = false, startOnly = false, modal = false } = {}) {
  const locator = page.locator(selector).first();
  if (scroll) await locator.scrollIntoViewIfNeeded(); if (focus) { await locator.focus(); await frames(page); }
  const result = await locator.evaluate((node, args) => {
    const rect = node.getBoundingClientRect(), command = document.querySelector('.consoleCommandBar').getBoundingClientRect(), top = rect.top + Math.min(5, rect.height / 2), bottom = args.startOnly ? Math.min(rect.bottom - 3, rect.top + 35) : rect.bottom - 3;
    const x = rect.left + Math.min(15, rect.width / 2), hits = [document.elementFromPoint(x, top), document.elementFromPoint(x, bottom)];
    return { rect: { ...rect.toJSON(), bottom: args.startOnly ? Math.min(rect.bottom, rect.top + 38) : rect.bottom }, width: innerWidth, height: innerHeight, command: command.toJSON(), focus: document.activeElement === node, hit: hits.every(hit => hit === node || node.contains(hit)) };
  }, { startOnly });
  const detail = JSON.stringify(result); assert.ok(result.rect.top >= -1 && result.rect.bottom <= (modal ? result.height : result.command.top) + 1, detail);
  assert.ok(result.rect.left >= -1 && result.rect.right <= result.width + 1, detail); assert.ok(result.hit, detail); if (focus) assert.equal(result.focus, true, detail);
}
async function setup(browser, viewport, { retained = true, fixtureOptions = {}, initialEvidence = false, gateReady = false } = {}) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce', serviceWorkers: 'block' }), fixture = createResearchBrowserFixture(fixtureOptions), denied = [], errors = [], documents = [], redirects = [];
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === origin && request.method() === 'GET' && request.resourceType() === 'document' && ['/dashboard', '/dashboard/products'].includes(url.pathname)) {
      if (url.pathname === '/dashboard/products' || url.searchParams.get('view') === 'library') {
        const before = fixture.reads.length, response = await researchRedirectResponse(url.pathname + url.search + url.hash, fixture);
        assert.equal(fixture.reads.length, before); redirects.push({ from: url.pathname + url.search, status: response.status, location: response.headers.location });
        return route.fulfill({ contentType: 'text/html', body: researchRedirectDocument(response) });
      }
      if (url.searchParams.get('view') === 'research') {
        documents.push(url.pathname + url.search); return route.fulfill({ contentType: 'text/html', body: await researchDocument(url.pathname + url.search + url.hash, { fixture, retained, initialEvidence }) });
      }
    }
    denied.push(`${request.method()} ${request.url()}`); return route.abort();
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  if (gateReady) await page.addInitScript(() => {
    window.__researchHoldReady = true;
    document.addEventListener('console-research-evidence-ready', event => { if (window.__researchHoldReady) event.stopPropagation(); }, true);
  });
  let readHold = null, evidenceHold = null;
  function barrier(kind, match) {
    let entered, release; const enteredPromise = new Promise(resolve => { entered = resolve; }), released = new Promise(resolve => { release = resolve; });
    const hold = { match, entered, enteredPromise, released, release }; if (kind === 'read') readHold = hold; else evidenceHold = hold; return hold;
  }
  await page.exposeFunction('__loadResearchRootFixture', async route => {
    if (readHold && readHold.match(route)) { const hold = readHold; readHold = null; hold.entered(); await hold.released; }
    return researchClientState(route, fixture);
  });
  await page.exposeFunction('__loadResearchEvidenceFixture', async route => {
    if (evidenceHold && evidenceHold.match(route)) { const hold = evidenceHold; evidenceHold = null; hold.entered(); await hold.released; }
    return researchEvidenceState(route, fixture);
  });
  return { page, context, fixture, denied, errors, documents, redirects, holdRead: match => barrier('read', match), holdEvidence: match => barrier('evidence', match) };
}
async function clean(h) {
  assert.deepEqual(h.denied, []); assert.deepEqual(h.errors, []); assert.deepEqual(h.fixture.denied, []);
  assert.deepEqual(await h.page.evaluate(() => window.__researchErrors), []); assert.equal(await h.page.evaluate(() => window.__researchPaidCalls), 0);
  assert.equal(await h.page.evaluate(() => window.__unsafeResearch ?? false), false);
}
async function rows(page) { return page.locator('.consoleResearchList [data-research-record]').evaluateAll(nodes => nodes.map(node => node.dataset.researchRecord)); }
async function mainReading(page) { return page.evaluate(() => innerWidth <= 900 ? scrollY : (innerWidth >= 1200 && document.querySelector('.consoleResearchPane>.consoleResearchBody').dataset.hasSelection === 'true' ? document.querySelector('.consoleResearchResults') : document.querySelector('.consoleResearchPane>.consoleResearchBody')).scrollTop); }
const selected = page => page.locator('[data-selected-research]').getAttribute('data-selected-research');

// The following are browser pixels/assertions, not a Next server transport test.
// R03 remains open: no real RSC cache or server-action admission is exercised.
test('hosted synthetic Research populated actual roots/records fit every compact and mobile viewport', { skip: !enabled, timeout: 300000 }, async t => {
  const browser = await chromium.launch({ headless: true }); try {
    for (const viewport of viewports) await t.test(viewport.slug, async t => {
      const h = await setup(browser, viewport, { initialEvidence: true }), { page, fixture } = h;
      try {
        for (const [kind, route] of [['roots', rootsRoute], ['records', recordsRoute]]) {
          await page.goto(origin + route); await ready(page); await capture(page, `console-r02-research-${kind}-selected-${viewport.slug}`); await bounds(page, viewport, t);
          assert.equal(await page.locator('.consoleResearchPane').getAttribute('data-research-kind'), kind); assert.equal(await selected(page), selectedId);
          assert.equal((await rows(page)).length, 25); assert.ok(metadata(fixture).at(-1).result.page.total >= 127);
          await visible(page, '.consoleResearchDetail>header h2'); await visible(page, '.consoleResearchSummary h3');
          if (viewport.width <= 900) {
            await visible(page, '.consoleResearchToolbar [name=q]', { focus: true, scroll: true });
            await visible(page, '.consoleResearchToolbar [name=business]', { focus: true, scroll: true });
            await page.locator('.consoleResearchToolbar [name=business]').blur();
          }
        }
        await page.goto(origin + `/dashboard?view=research&type=records&selected=${selectedBusinessBId}&sort=oldest`); await ready(page); await bounds(page, viewport, t);
        assert.equal(await selected(page), selectedBusinessBId); assert.match(await page.locator('.consoleResearchSummary').innerText(), /Recorded research recommendation: TEST/);
        assert.match(await page.locator('.consoleResearchSummary').innerText(), /Stale saved evidence/);
        const identity = page.locator(`[data-console-disclosure="research:identity:${selectedBusinessBId}"]`); await identity.locator('summary').click();
        assert.ok((await identity.innerText()).includes(literalText)); assert.equal(await identity.locator('img').count(), 0);
        await visible(page, `[data-console-disclosure="research:identity:${selectedBusinessBId}"]>summary`, { focus: true, scroll: true });
        const packs = page.locator(`[data-console-disclosure="research:packs:${selectedBusinessBId}"]`); await packs.locator(':scope>summary').click();
        const source = packs.locator('[data-console-disclosure^="research:source:"]').first(); await source.locator(':scope>summary').click();
        assert.equal(await source.locator(':scope>summary').innerText(), literalText); assert.equal(await source.locator('img,svg,script').count(), 0);
        const url = source.getByRole('link', { name: 'Open saved source URL' }); assert.match(await url.getAttribute('href'), /^https:\/\/www\.etsy\.com\/listing\//); assert.equal(await url.getAttribute('rel'), 'noopener noreferrer');
        await capture(page, `console-r02-research-long-literal-test-${viewport.slug}`); await clean(h);
      } finally { await h.context.close(); }
    });
  } finally { await browser.close(); }
});

test('hosted Research native GET Apply Back Forward restores actual fields rows counts and exact off-filter selection', { skip: !enabled, timeout: 180000 }, async t => {
  const browser = await chromium.launch({ headless: true }); try {
    for (const viewport of [viewports[1], viewports[5]]) await t.test(viewport.slug, async () => {
      const h = await setup(browser, viewport, { retained: false, initialEvidence: true }), { page } = h;
      try {
        await page.goto(origin + recordsRoute); await ready(page); const originalRows = await rows(page), originalCount = await page.locator('.consoleResearchPane>.consoleResearchPagination .consoleCollectionCount').innerText();
        assert.equal(h.fixture.ancillaryCalls.length, 0);
        await page.locator('.consoleResearchToolbar [name=searchField]').selectOption('hypothesis');
        await page.locator('.consoleResearchToolbar [name=q]').fill('Duplicate saved hypothesis'); await page.locator('.consoleResearchToolbar [name=sort]').selectOption('oldest');
        await page.locator('.consoleResearchToolbar [name=business]').selectOption(secondBusinessId); await page.locator('.consoleResearchToolbar button[type=submit]').click(); await ready(page);
        const appliedUrl = new URL(page.url()), filteredRows = await rows(page), filteredCount = await page.locator('.consoleResearchPane>.consoleResearchPagination .consoleCollectionCount').innerText();
        for (const [key, value] of [['searchField', 'hypothesis'], ['q', 'Duplicate saved hypothesis'], ['sort', 'oldest'], ['business', secondBusinessId], ['selected', selectedId]]) assert.equal(appliedUrl.searchParams.get(key), value);
        assert.equal(await page.locator('.consoleResearchDetail').getAttribute('data-console-selection'), 'missing'); assert.equal(await page.locator('[data-selected-research]').count(), 0);
        assert.ok(filteredRows.length > 0); assert.ok(filteredRows.every(value => !originalRows.includes(value))); assert.notEqual(filteredCount, originalCount);
        await page.goBack(); await ready(page);
        for (const [key, value] of [['searchField', 'objective'], ['q', ''], ['sort', 'newest'], ['business', '']]) assert.equal(await page.locator(`.consoleResearchToolbar [name=${key}]`).inputValue(), value);
        assert.deepEqual(await rows(page), originalRows); assert.equal(await selected(page), selectedId); assert.equal(await page.locator('.consoleResearchPane>.consoleResearchPagination .consoleCollectionCount').innerText(), originalCount);
        await page.goForward(); await ready(page);
        for (const [key, value] of [['searchField', 'hypothesis'], ['q', 'Duplicate saved hypothesis'], ['sort', 'oldest'], ['business', secondBusinessId]]) assert.equal(await page.locator(`.consoleResearchToolbar [name=${key}]`).inputValue(), value);
        assert.deepEqual(await rows(page), filteredRows); assert.equal(await page.locator('.consoleResearchPane>.consoleResearchPagination .consoleCollectionCount').innerText(), filteredCount);
        await page.reload(); await ready(page); assert.deepEqual(await rows(page), filteredRows); assert.equal(h.fixture.ancillaryCalls.length, 0); assert.ok(h.documents.length >= 3);
        // The same literal text matches the saved hypothesis, not its objective.
        await page.locator('.consoleResearchToolbar [name=searchField]').selectOption('objective'); await page.locator('.consoleResearchToolbar button[type=submit]').click(); await ready(page);
        assert.deepEqual(await rows(page), []); assert.equal(metadata(h.fixture).at(-1).result.page.total, 0); assert.equal(new URL(page.url()).searchParams.get('searchField'), 'objective');
        await page.goBack(); await ready(page); assert.equal(await page.locator('.consoleResearchToolbar [name=searchField]').inputValue(), 'hypothesis'); assert.deepEqual(await rows(page), filteredRows);
        await capture(page, `console-r02-research-native-get-history-${viewport.slug}`); await clean(h);
      } finally { await h.context.close(); }
    });
  } finally { await browser.close(); }
});

test('hosted retained Research exact row Close/history/reload and independent130-attempt pager retain aggregate scope', { skip: !enabled, timeout: 180000 }, async t => {
  const browser = await chromium.launch({ headless: true }); try {
    for (const viewport of [viewports[0], viewports[2], viewports[5]]) await t.test(viewport.slug, async () => {
      const h = await setup(browser, viewport), { page } = h;
      try {
        await page.goto(origin + '/dashboard?view=research&type=records&page=2'); await ready(page);
        const firstRows = await rows(page), list = viewport.width >= 1200 ? '.consoleResearchResults' : '.consoleResearchPane>.consoleResearchBody';
        if (viewport.width > 900) await page.locator(list).evaluate(node => { node.scrollTop = 180; }); else await page.evaluate(() => scrollTo(0, 300)); await frames(page);
        await page.locator('.consoleResearchList .consoleResearchTitle').nth(1).focus(); await frames(page); const priorListReading = await mainReading(page); await page.keyboard.press('Enter'); await ready(page);
        const record = await selected(page); assert.equal(new URL(page.url()).searchParams.has('business'), false); assert.equal(new URL(page.url()).searchParams.get('page'), '2'); assert.deepEqual(await rows(page), firstRows);
        const disclosure = page.locator(`[data-console-disclosure="research:identity:${record}"]`); await disclosure.locator('summary').click();
        await page.getByRole('link', { name: 'Close detail', exact: true }).click(); await ready(page); assert.equal(await page.locator('.consoleResearchDetail').count(), 0); assert.deepEqual(await rows(page), firstRows);
        assert.ok(Math.abs(await mainReading(page) - priorListReading) <= 2, JSON.stringify({ actual: await mainReading(page), priorListReading }));
        await page.goBack(); await ready(page); assert.equal(await selected(page), record); assert.equal(await disclosure.evaluate(node => node.open), true);
        const priorExactReading = await position(page); await page.reload(); await ready(page); assert.equal(await selected(page), record); assert.equal(await disclosure.evaluate(node => node.open), true); assert.deepEqual(await position(page), priorExactReading);
        await page.goForward(); await ready(page); assert.equal(await page.locator('.consoleResearchDetail').count(), 0);
        await page.goto(origin + attemptsRoute); await ready(page); const mainRows = await rows(page), mainCount = await page.locator('.consoleResearchPane>.consoleResearchPagination .consoleCollectionCount').innerText();
        assert.equal(await page.locator('.consoleResearchAttemptList [data-associated-attempt]').count(), 25); assert.match(await page.locator('.consoleResearchAttemptPagination .consoleCollectionCount').innerText(), /130/);
        await page.getByRole('navigation', { name: 'Associated attempt pages' }).getByRole('link', { name: 'Next', exact: true }).click(); await ready(page);
        const url = new URL(page.url()); for (const [key, value] of [['page', '3'], ['q', 'unmatched'], ['searchField', 'hypothesis'], ['attemptPage', '3'], ['attemptSort', 'oldest'], ['root', selectedId]]) assert.equal(url.searchParams.get(key), value);
        assert.equal(url.searchParams.has('business'), false); assert.deepEqual(await rows(page), mainRows); assert.equal(await page.locator('.consoleResearchPane>.consoleResearchPagination .consoleCollectionCount').innerText(), mainCount);
        const newestLink = page.getByRole('link', { name: 'Newest first', exact: true }), intendedHref = new URL(await newestLink.getAttribute('href'), origin);
        await newestLink.click(); await ready(page);
        const newest = new URL(page.url()); assert.equal(newest.href, intendedHref.href);
        for (const [key, value] of [['page', '3'], ['q', 'unmatched'], ['searchField', 'hypothesis'], ['selected', selectedId], ['root', selectedId]]) assert.equal(newest.searchParams.get(key), value);
        assert.equal(newest.searchParams.has('business'), false); assert.deepEqual(await rows(page), mainRows); assert.equal(await page.locator('.consoleResearchPane>.consoleResearchPagination .consoleCollectionCount').innerText(), mainCount);
        assert.match(await page.locator('.consoleResearchAttemptPagination').innerText(), /Page 1 of 6/); assert.equal(metadata(h.fixture).at(-1).result.attempts.page.page, 1); assert.equal(metadata(h.fixture).at(-1).result.query.attemptSort, 'newest');
        await capture(page, `console-r02-research-associated-attempt-history-${viewport.slug}`); await clean(h);
      } finally { await h.context.close(); }
    });
  } finally { await browser.close(); }
});

test('hosted Research selected B onward links and exact Work/artifact/hash targets never bridge identities', { skip: !enabled, timeout: 120000 }, async () => {
  const browser = await chromium.launch({ headless: true }), h = await setup(browser, viewports[1]), { page } = h;
  try {
    await page.goto(origin + offFilterRoute); await ready(page); assert.equal(await selected(page), selectedBusinessBId); assert.equal(await page.locator('.consoleResearchToolbar [name=business]').inputValue(), '');
    for (const name of ['Library', 'Connections']) {
      const link = page.getByRole('navigation', { name: 'Workspace views' }).getByRole('link', { name, exact: true }), url = new URL(await link.getAttribute('href'), origin);
      assert.equal(url.searchParams.get('business'), secondBusinessId);
    }
    const result = evidence(h.fixture).at(-1).result, work = new URL(await page.getByRole('link', { name: 'Inspect exact Work run' }).getAttribute('href'), origin);
    assert.equal(work.searchParams.get('business'), secondBusinessId); assert.equal(work.searchParams.get('selected'), result.workIdentity.workflowRunId); assert.equal(work.hash, '#console-collection-detail');
    await page.locator(`[data-console-disclosure="research:artifacts:${selectedBusinessBId}"]>summary`).click();
    for (const row of result.artifacts) {
      const href = `/dashboard?view=work&business=${row.businessId}&selected=${row.workflowRunId}&artifact=${row.artifactId}#artifact-${row.artifactId}`;
      assert.equal(await page.locator('.consoleResearchArtifactLinks a').filter({ hasText: `Inspect saved ${row.role} artifact` }).getAttribute('href'), href);
    }
    assert.equal(h.fixture.ancillaryCalls.length, 0); await capture(page, 'console-r02-research-business-b-exact-artifact-links'); await clean(h);
  } finally { await h.context.close(); await browser.close(); }
});

test('hosted Research error/legacy/candidate/orphan/latest/count-null states are truthful and fresh narrow errors reveal', { skip: !enabled, timeout: 240000 }, async t => {
  const browser = await chromium.launch({ headless: true }); try {
    for (const viewport of [viewports[2], viewports[5]]) for (const mode of ['missing', 'unavailable']) await t.test(`${mode}-${viewport.slug}`, async () => {
      const h = await setup(browser, viewport, { fixtureOptions: { unavailableSelection: mode === 'unavailable' } }), { page } = h;
      try {
        const record = mode === 'missing' ? id(999999) : selectedId;
        await page.goto(origin + `/dashboard?view=research&type=records&business=${businessId}&selected=${record}`); await ready(page);
        assert.equal(await page.locator('.consoleResearchDetail').getAttribute('data-console-selection'), mode); assert.equal(await page.locator('[data-selected-research]').count(), 0);
        assert.equal(await page.locator('.consoleResearchToolbar [name=business]').inputValue(), businessId); await capture(page, `console-r02-research-direct-${mode}-${viewport.slug}`); await visible(page, '.consoleResearchDetail>header h2'); await visible(page, '.consoleResearchDetail>p');
        assert.equal(evidence(h.fixture).length, 0); await clean(h);
      } finally { await h.context.close(); }
    });
    const h = await setup(browser, viewports[1]); try {
      for (const [record, copy] of [[legacyId, /Legacy saved record/], [candidateId, /Required saved evidence|could not be read|not established/], [orphanId, /could not be checked|missing|not established/], [mismatchedWorkId, /Exact Work linkage unavailable/], [freshRecordId, /Within the saved timing window/]]) {
        await h.page.goto(origin + `/dashboard?view=research&type=records&selected=${record}`); await ready(h.page); assert.match(await h.page.locator('.consoleResearchDetail').innerText(), copy);
        if (record === mismatchedWorkId) {
          assert.equal(await selected(h.page), record); assert.match(await h.page.locator('.consoleResearchDetail').innerText(), /Last job context unavailable/);
          assert.equal(await h.page.getByRole('link', { name: 'Inspect exact Work run' }).count(), 0);
          assert.equal(metadata(h.fixture).at(-1).result.selection.item.workflow.status, 'unavailable'); assert.equal(metadata(h.fixture).at(-1).result.selection.item.workIdentity, null);
          assert.equal(evidence(h.fixture).at(-1).result.integrity, 'malformed');
          await h.page.locator(`[data-console-disclosure="research:evidence-limits:${record}"]>summary`).click();
          assert.match(await h.page.locator('.consoleResearchDetail').innerText(), /Metadata-only Work and Library links do not certify artifact content, provider truth or completed review/);
        }
        await capture(h.page, `console-r02-research-truth-${record.slice(-6)}`);
      }
      await h.page.goto(origin + savedStateRoute); await ready(h.page);
      assert.equal(await h.page.locator('.consoleResearchToolbar [name=sort]').inputValue(), 'oldest');
      for (const [number, status] of [[1000, 'researching'], [1001, 'reserved']]) {
        const row = h.page.locator(`.consoleResearchList [data-research-record="${id(number)}"]`); assert.equal(await row.count(), 1);
        assert.match(await row.innerText(), new RegExp(`Saved ${status}`)); assert.match(await row.innerText(), /Execution not established here/); assert.doesNotMatch(await row.innerText(), /End recorded/);
      }
      const ended = h.page.locator(`.consoleResearchList [data-research-record="${id(1009)}"]`); assert.equal(await ended.count(), 1);
      assert.match(await ended.innerText(), /End recorded; saved state: researching · inconsistent/); assert.doesNotMatch(await ended.innerText(), /Execution not established here/);
      await capture(h.page, 'console-r02-research-exact-saved-states'); await clean(h);
    } finally { await h.context.close(); }
    for (const latest of ['missing', 'unavailable', 'mismatched']) {
      const h = await setup(browser, viewports[1], { fixtureOptions: { latest } }); try {
        await h.page.goto(origin + attemptsRoute); await ready(h.page); assert.match(await h.page.locator('.consoleResearchNewest').innerText(), /No older record was substituted/);
        await capture(h.page, `console-r02-research-newest-${latest}`); await clean(h);
      } finally { await h.context.close(); }
    }
    for (const state of ['count-null', 'list-error', 'business-unavailable']) {
      const fixtureOptions = { countNull: state === 'count-null', failList: state === 'list-error', businessesUnavailable: state === 'business-unavailable' };
      const h = await setup(browser, viewports[1], { fixtureOptions }); try {
        await h.page.goto(origin + recordsRoute); await ready(h.page); assert.match(await h.page.locator('.consoleResearchPane').innerText(), /unavailable|unverified|could not be checked/i);
        const footer = await h.page.locator('.consoleResearchPane>.consoleResearchPagination').innerText(); assert.match(footer, /Total unavailable/); assert.match(footer, /Page completeness unverified/); assert.doesNotMatch(footer, /of 0 saved|0 matching/);
        if (state === 'business-unavailable') { assert.equal(h.fixture.reads.length, 0); assert.equal(await h.page.locator('#console-command-open').isDisabled(), true); }
        await capture(h.page, `console-r02-research-${state}`); await clean(h);
      } finally { await h.context.close(); }
    }
  } finally { await browser.close(); }
});

test('hosted synthetic native navigation address-matches actual Research alias targets without claiming HTTP redirects', { skip: !enabled, timeout: 120000 }, async () => {
  const browser = await chromium.launch({ headless: true }), h = await setup(browser, viewports[1]), { page } = h;
  try {
    await page.goto(origin + `/dashboard?view=library&type=research&business=${businessId}&experiment=${selectedId}`); await ready(page);
    assert.equal(new URL(page.url()).searchParams.get('view'), 'research'); assert.equal(new URL(page.url()).searchParams.get('selected'), selectedId); assert.equal(new URL(page.url()).searchParams.has('experiment'), false);
    await page.goto(origin + `/dashboard/products?view=results&business=${businessId}#discovery-goal-results`); await ready(page);
    const url = new URL(page.url()); assert.equal(url.pathname, '/dashboard'); assert.equal(url.searchParams.get('view'), 'research'); assert.equal(url.searchParams.has('selected'), false);
    // HTTP redirects may carry the original aggregate fragment. It must remain
    // aggregate, never become a selected-record/Work/artifact identity.
    assert.ok(['', '#discovery-goal-results'].includes(url.hash)); assert.equal(await page.locator('.consoleResearchDetail').count(), 0);
    assert.equal(h.redirects.length, 2); assert.equal(h.fixture.ancillaryCalls.length, 0); await capture(page, 'console-r02-research-legacy-aggregate-redirect'); await clean(h);
  } finally { await h.context.close(); await browser.close(); }
});

async function position(page) { return page.evaluate(() => ({ document: scrollY, body: document.querySelector('.consoleResearchPane>.consoleResearchBody').scrollTop, results: document.querySelector('.consoleResearchResults').scrollTop, detail: document.querySelector('.consoleResearchDetail')?.scrollTop ?? 0 })); }
async function seedSnapshot(h, route, viewport, target = 650) {
  const api = h.fixture.load('src/components/console/console-collection-scroll.ts'), state = await researchClientState(route, h.fixture), key = api.consoleCollectionScrollKey(state.pane.ownerId, state.pane.scopeHref), layout = viewport.width <= 900 ? 'document' : viewport.width >= 1200 ? 'split' : 'single';
  const disclosures = [`research:identity:${state.pane.data.selection.item.id}`, `research:goal:${state.pane.data.selection.item.id}`, `research:strategy:${state.pane.data.selection.item.id}`, `research:review:${state.pane.data.selection.item.id}`, `research:packs:${state.pane.data.selection.item.id}`];
  const value = { version: 1, layout, disclosures, body: layout === 'single' ? target : 0, detail: layout === 'split' ? target : 0, document: layout === 'document' ? target : 0, mobile: viewport.width <= 900, savedAt: Date.now() };
  await h.page.addInitScript(({ key, value }) => {
    const flag = `synthetic-research-browser-seeded:${key}`;
    if (sessionStorage.getItem(flag) === '1') return;
    sessionStorage.setItem(key, JSON.stringify(value)); sessionStorage.setItem(`${key}:${value.layout}`, JSON.stringify(value)); sessionStorage.setItem(flag, '1');
  }, { key, value });
  return { key, value, layout };
}
async function repeatReady(page, changes = {}) {
  await page.evaluate(changes => {
    const marker = document.querySelector('[data-console-research-evidence-ready]'), original = { ...marker.dataset };
    Object.assign(marker.dataset, changes); marker.dispatchEvent(new Event('console-research-evidence-ready', { bubbles: true }));
    Object.assign(marker.dataset, original);
  }, changes); await frames(page);
}

test('hosted first-ready record Business owner/full-filter scope and stale DOM epoch guards reject before valid restoration', { skip: !enabled, timeout: 120000 }, async () => {
  const viewport = viewports[0], browser = await chromium.launch({ headless: true }), h = await setup(browser, viewport, { gateReady: true }), { page } = h;
  const hold = h.holdEvidence(() => true);
  try {
    const seeded = await seedSnapshot(h, recordsRoute, viewport, 2000); await page.goto(origin + recordsRoute); await ready(page, { evidenceReady: false }); await hold.enteredPromise;
    hold.release(); await ready(page); const before = await position(page);
    await page.evaluate(() => { window.__researchHoldReady = false; });
    const api = h.fixture.load('src/components/console/console-collection-scroll.ts'), owner = h.fixture.context.userId;
    const wrongScope = api.consoleCollectionScrollKey(owner, `${recordsRoute}&q=other&searchField=hypothesis&attemptPage=2`);
    for (const changes of [
      { consoleResearchRecord: selectedBusinessBId }, { consoleResearchBusiness: secondBusinessId },
      { consoleResearchReadyScope: api.consoleCollectionScrollKey('wrong-owner', recordsRoute) }, { consoleResearchReadyScope: wrongScope },
    ]) { await repeatReady(page, changes); assert.deepEqual(await position(page), before); }
    // A same-record/same-scope event from an old leaf epoch must not be accepted
    // merely because its attributes match the current production marker.
    await page.evaluate(() => {
      const current = document.querySelector('[data-console-research-evidence-ready]'), old = current.cloneNode(true);
      current.parentElement.append(old); old.dispatchEvent(new Event('console-research-evidence-ready', { bubbles: true })); old.remove();
    }); await frames(page); assert.deepEqual(await position(page), before);
    // The valid event restores saved disclosures before assigning scrollTop.
    // Its clamp limit is the expanded layout, not the still-closed pre-event DOM.
    await repeatReady(page); const restored = await position(page), maximum = await page.locator('.consoleResearchDetail').evaluate(node => node.scrollHeight - node.clientHeight), expected = Math.min(seeded.value.detail, maximum);
    assert.ok(expected > before.detail + 100, JSON.stringify({ before, maximum, expected }));
    assert.ok(Math.abs(restored.detail - expected) <= 2, JSON.stringify({ restored, expected }));
    await repeatReady(page); assert.deepEqual(await position(page), restored); await capture(page, 'console-r02-research-first-ready-full-scope-epoch'); await clean(h);
  } finally { hold.release(); await h.context.close(); await browser.close(); }
});

test('hosted delayed exact evidence restores saved position once while retaining metadata/filter/attempt DOM', { skip: !enabled, timeout: 180000 }, async t => {
  const browser = await chromium.launch({ headless: true }); try {
    for (const viewport of [viewports[0], viewports[2], viewports[5]]) await t.test(viewport.slug, async () => {
      const h = await setup(browser, viewport), { page } = h, hold = h.holdEvidence(() => true);
      let reloadHold, backHold;
      try {
        const seeded = await seedSnapshot(h, recordsRoute, viewport); await page.goto(origin + recordsRoute); await ready(page, { evidenceReady: false }); await hold.enteredPromise;
        assert.equal(await page.locator('[data-research-evidence-loading]').count(), 1); assert.match(await page.locator('[data-research-evidence-loading]').innerText(), /Historical evidence is not ready/);
        await page.evaluate(() => { window.__researchMountedRegions = [...document.querySelectorAll('.consoleResearchToolbar,.consoleResearchResults,.consoleResearchSelectedContext,.consoleResearchAttemptList')]; });
        const before = await position(page); hold.release(); await ready(page);
        assert.equal(await page.evaluate(() => window.__researchMountedRegions.every(node => node.isConnected)), true);
        assert.equal(await page.locator('[data-console-research-evidence-ready]').getAttribute('data-console-research-record'), selectedId);
        const after = await position(page), region = seeded.layout === 'split' ? 'detail' : seeded.layout === 'single' ? 'body' : 'document';
        assert.ok(Math.abs(after[region] - seeded.value[region]) <= 2, JSON.stringify({ before, after, seeded }));
        assert.equal(await page.locator(`[data-console-disclosure="research:strategy:${selectedId}"]`).evaluate(node => node.open), true);
        await repeatReady(page); assert.deepEqual(await position(page), after);
        await capture(page, `console-r02-research-delayed-restoration-${viewport.slug}`);
        // Establish a new non-seeded reading position and observe production
        // persistence before reload. The init script must never reseed it.
        const maximum = await page.evaluate(region => {
          const node = region === 'detail' ? document.querySelector('.consoleResearchDetail') : region === 'body' ? document.querySelector('.consoleResearchPane>.consoleResearchBody') : document.scrollingElement;
          return node.scrollHeight - node.clientHeight;
        }, region), target = after[region] + 75 <= maximum ? after[region] + 75 : Math.max(0, after[region] - 75);
        assert.notEqual(target, seeded.value[region]);
        await page.evaluate(({ region, target }) => { if (region === 'document') scrollTo(0, target); else document.querySelector(region === 'detail' ? '.consoleResearchDetail' : '.consoleResearchPane>.consoleResearchBody').scrollTop = target; }, { region, target }); await frames(page);
        await page.waitForFunction(({ key, region, target }) => JSON.parse(sessionStorage.getItem(key) || 'null')?.[region] === target, { key: seeded.key, region, target });
        const reloadedReading = await position(page);
        reloadHold = h.holdEvidence(() => true); await page.reload(); await ready(page, { evidenceReady: false }); await reloadHold.enteredPromise;
        assert.equal(await page.locator('[data-research-evidence-loading]').count(), 1); reloadHold.release(); await ready(page); assert.deepEqual(await position(page), reloadedReading);
        const close = page.getByRole('link', { name: 'Close detail', exact: true }), beforeCloseFocus = await position(page);
        await close.focus(); await frames(page); await close.scrollIntoViewIfNeeded(); await frames(page); const afterCloseFocus = await position(page);
        const departureUrl = new URL(page.url()), departureRoute = departureUrl.pathname + departureUrl.search + departureUrl.hash, closeHref = await close.getAttribute('href');
        await close.evaluate(observeResearchCloseDeparture);
        await close.click(); await ready(page);
        const observations = await page.evaluate(() => window.__researchCloseDeparture), saved = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key) || 'null'), seeded.key);
        t.diagnostic(JSON.stringify({ viewport: viewport.slug, beforeCloseFocus, afterCloseFocus, observations, saved }));
        assert.deepEqual(observations.map(row => row.type), ['pointerdown', 'click']);
        for (const row of observations) { assert.equal(row.trusted, true); assert.equal(row.phase, 1); assert.equal(row.exactClose, true); assert.equal(row.href, closeHref); assert.equal(row.route, departureRoute); }
        const backReading = observations[1].reading; assert.ok(saved);
        assert.equal(saved.document, backReading.document); assert.equal(saved.detail, backReading.detail); assert.equal(saved.body, seeded.layout === 'split' ? backReading.results : backReading.body);
        backHold = h.holdEvidence(() => true); await page.goBack(); await ready(page, { evidenceReady: false }); await backHold.enteredPromise;
        backHold.release(); await ready(page); assert.deepEqual(await position(page), backReading);
        await capture(page, `console-r02-research-delayed-back-reload-${viewport.slug}`); await clean(h);
      } finally { hold.release(); reloadHold?.release(); backHold?.release(); await h.context.close(); }
    });
  } finally { await browser.close(); }
});

test('hosted delayed evidence respects Document/contained-scrollbar reading with no preceding pane input', { skip: !enabled, timeout: 180000 }, async t => {
  const browser = await chromium.launch({ headless: true }); try {
    for (const viewport of [viewports[0], viewports[5]]) await t.test(viewport.slug, async () => {
      const h = await setup(browser, viewport), { page } = h, hold = h.holdEvidence(() => true);
      try {
        await seedSnapshot(h, recordsRoute, viewport, 900); await page.goto(origin + recordsRoute); await ready(page, { evidenceReady: false }); await hold.enteredPromise;
        // Directly setting native scrollTop/scrollTo generates native scroll events
        // without dispatching pointer/key/wheel events inside the pane first.
        await page.evaluate(mobile => { window.__researchPaneInputs = 0; for (const name of ['pointerdown', 'keydown', 'wheel', 'touchmove']) document.querySelector('.consoleResearchPane').addEventListener(name, () => window.__researchPaneInputs++); if (mobile) scrollTo(0, 160); else document.querySelector('.consoleResearchDetail').scrollTop = 120; }, viewport.width <= 900);
        await frames(page); const chosen = await position(page); assert.equal(await page.evaluate(() => window.__researchPaneInputs), 0);
        assert.ok(viewport.width <= 900 ? chosen.document === 160 : chosen.detail >= 100, JSON.stringify(chosen));
        hold.release(); await ready(page); assert.deepEqual(await position(page), chosen); await repeatReady(page); assert.deepEqual(await position(page), chosen);
        await capture(page, `console-r02-research-newer-native-scroll-${viewport.slug}`); await clean(h);
      } finally { hold.release(); await h.context.close(); }
    });
  } finally { await browser.close(); }
});

test('hosted stale/wrong record Business scope epoch ready and navigation-away evidence are inert', { skip: !enabled, timeout: 180000 }, async () => {
  const browser = await chromium.launch({ headless: true }), h = await setup(browser, viewports[0]), { page } = h;
  try {
    const hold = h.holdEvidence(route => route === recordsRoute); await page.goto(origin + recordsRoute); await ready(page, { evidenceReady: false }); await hold.enteredPromise;
    await page.evaluate(() => window.__researchNavigate('/dashboard?view=research&type=records&selected=95000000-0000-4000-8000-000000000110')); await ready(page);
    const current = await selected(page); hold.release(); await page.waitForFunction(() => window.__researchEvidenceDiscarded >= 1); assert.equal(await selected(page), current);
    await page.locator('.consoleResearchDetail').evaluate(node => { node.scrollTop = 150; }); await frames(page); const chosen = await position(page);
    for (const changes of [
      { consoleResearchRecord: selectedId }, { consoleResearchBusiness: businessId },
      { consoleResearchReadyScope: 'wrong-owner-or-scope' }, { consoleResearchReadyScope: `${await page.locator('[data-console-research-evidence-ready]').getAttribute('data-console-research-ready-scope')}:stale-epoch` },
    ]) { await repeatReady(page, changes); assert.deepEqual(await position(page), chosen); assert.equal(await selected(page), selectedBusinessBId); }
    const next = h.holdEvidence(() => true); await page.evaluate(() => window.__researchNavigate('/dashboard?view=research&type=roots&selected=95000000-0000-4000-8000-000000000010')); await ready(page, { evidenceReady: false }); await next.enteredPromise;
    await page.getByRole('link', { name: 'Close detail', exact: true }).click(); await ready(page); next.release(); await page.waitForFunction(() => window.__researchEvidenceDiscarded >= 2);
    assert.equal(await page.locator('.consoleResearchDetail').count(), 0); await capture(page, 'console-r02-research-stale-evidence-navigation-away'); await clean(h);
  } finally { await h.context.close(); await browser.close(); }
});

test('hosted progressive ready filter edits and saved-Quest chooser retain exact scope/focus without legacy approval', { skip: !enabled, timeout: 180000 }, async () => {
  const browser = await chromium.launch({ headless: true }), h = await setup(browser, viewports[1]), { page } = h;
  try {
    const hold = h.holdEvidence(() => true); await seedSnapshot(h, offFilterRoute, viewports[1], 2000); await page.goto(origin + offFilterRoute); await ready(page, { evidenceReady: false }); await hold.enteredPromise;
    await page.locator('.consoleResearchToolbar [name=q]').fill('new unsent filter edit');
    const focused = '.consoleResearchToolbar [name=q]'; await page.locator(focused).focus(); const chosen = await position(page); hold.release(); await ready(page);
    assert.equal(await page.locator('.consoleResearchToolbar [name=q]').inputValue(), 'new unsent filter edit'); assert.equal(await page.locator(focused).inputValue(), 'new unsent filter edit');
    assert.equal(await page.locator(focused).evaluate(node => document.activeElement === node), true); assert.deepEqual(await position(page), chosen);
    // Use only the actual server-supplied Plan research link to enter setup.
    assert.equal(h.fixture.ancillaryCalls.length, 0); await page.getByRole('link', { name: 'Plan research', exact: true }).click(); await ready(page);
    assert.equal(await page.locator('dialog.consoleResearchSheet').evaluate(node => node.open), true);
    assert.deepEqual(h.fixture.ancillaryCalls, []);
    const choice = page.locator('dialog select[name=business]'); assert.equal(await choice.inputValue(), secondBusinessId);
    assert.equal(await page.locator('dialog [name=confirmResearch]').count(), 0); assert.equal(await page.locator('dialog textarea[name=goal]').count(), 0);
    assert.equal(await page.locator('dialog form').getAttribute('action'), '/dashboard/quests/research');
    await choice.focus(); const modalPosition = await position(page); await repeatReady(page);
    assert.equal(await choice.evaluate(node => node === document.activeElement), true); assert.equal(await choice.inputValue(), secondBusinessId); assert.deepEqual(await position(page), modalPosition);
    await page.keyboard.press('Escape'); await ready(page); assert.equal(await page.locator('dialog').count(), 0); assert.equal(await selected(page), selectedBusinessBId);
    for (const [key, value] of [['page', '3'], ['q', 'unmatched'], ['searchField', 'hypothesis'], ['sort', 'oldest']]) assert.equal(new URL(page.url()).searchParams.get(key), value);
    assert.equal(new URL(page.url()).searchParams.has('business'), false);
    await page.getByRole('link', { name: 'Plan research', exact: true }).click(); await ready(page);
    assert.equal(await page.locator('dialog select[name=business]').inputValue(), secondBusinessId); assert.equal(await page.locator('dialog [name=confirmResearch]').count(), 0);
    await capture(page, 'console-r12-research-saved-quest-chooser'); await page.getByRole('button', { name: 'Close research setup' }).click(); await ready(page);
    assert.equal(await selected(page), selectedBusinessBId); await clean(h);
  } finally { await h.context.close(); await browser.close(); }
});

test('hosted initial delayed ready preserves blurred filter edits and newly opened modal editor before any valid ready event', { skip: !enabled, timeout: 180000 }, async () => {
  const browser = await chromium.launch({ headless: true }); try {
    const edited = await setup(browser, viewports[0]), first = edited.holdEvidence(() => true);
    try {
      await seedSnapshot(edited, recordsRoute, viewports[0], 2000); await edited.page.goto(origin + recordsRoute); await ready(edited.page, { evidenceReady: false }); await first.enteredPromise;
      await edited.page.locator('.consoleResearchToolbar [name=q]').fill('unsent filter draft'); await edited.page.locator('.consoleResearchToolbar [name=q]').blur();
      const chosen = await position(edited.page); first.release(); await ready(edited.page);
      assert.equal(await edited.page.locator('.consoleResearchToolbar [name=q]').inputValue(), 'unsent filter draft'); assert.deepEqual(await position(edited.page), chosen);
      await capture(edited.page, 'console-r02-research-delayed-blurred-filter-edit'); await clean(edited);
    } finally { first.release(); await edited.context.close(); }
    const modal = await setup(browser, viewports[1]), firstRead = modal.holdEvidence(() => true);
    let sheetRead;
    try {
      const competing = await seedSnapshot(modal, offFilterRoute, viewports[1], 2000);
      await modal.page.goto(origin + offFilterRoute); await ready(modal.page, { evidenceReady: false }); await firstRead.enteredPromise;
      sheetRead = modal.holdEvidence(() => true); await modal.page.getByRole('link', { name: 'Plan research', exact: true }).click(); await ready(modal.page, { evidenceReady: false }); await sheetRead.enteredPromise;
      assert.equal(await modal.page.locator('dialog').evaluate(node => node.open), true);
      const field = modal.page.locator('dialog select[name=business]'); await field.selectOption(secondBusinessId); await field.focus();
      const chosen = await position(modal.page), draft = await field.inputValue(); assert.notEqual(chosen.detail, competing.value.detail); sheetRead.release(); await ready(modal.page);
      assert.equal(await field.inputValue(), draft); assert.equal(await field.evaluate(node => node === document.activeElement), true); assert.deepEqual(await position(modal.page), chosen);
      firstRead.release(); await modal.page.waitForFunction(() => window.__researchEvidenceDiscarded >= 1);
      await capture(modal.page, 'console-r12-research-first-ready-active-modal-chooser'); await modal.page.keyboard.press('Escape'); await ready(modal.page);
      assert.equal(await selected(modal.page), selectedBusinessBId); assert.equal(await modal.page.locator('dialog').count(), 0); await clean(modal);
    } finally { firstRead.release(); sheetRead?.release(); await modal.context.close(); }
  } finally { await browser.close(); }
});

test('hosted read-only Research harness explicitly cannot qualify R03 Next transport', () => {
  const helper = readFileSync('tests/helpers/console-research-browser.mjs', 'utf8'), suite = readFileSync('tests/console-research-browser.test.mjs', 'utf8');
  assert.match(helper, /R03: this does not qualify real Next RSC\/cache\/action behavior/);
  assert.match(helper, /if\(window\.__researchRetained\)addEventListener\('popstate',back\)/);
  assert.match(suite, /if \(sessionStorage\.getItem\(flag\) === '1'\) return/);
  assert.match(suite, /process\.env\.CI === 'true' && process\.env\.GUIDED_UI_BROWSER === '1'/);
  assert.doesNotMatch(suite, /executablePath\s*:|route\.continue\(/); assert.match(helper, /Provider\/action execution is forbidden/);
});
