import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { captureOwnerJourneyFailure } from './r12-owner-initial-journey.mjs';
import { podNextRejectedReviewReady, podNextRecoveryResultReady, podNextThoroughOutputs, POD_INERT_RELEASE } from './r12-pod-boundary.mjs';
import { POD_OBJECTIVE, POD_PHASES } from '../helpers/r12-pod-sql-fixture.mjs';

const waitUntil = async (check, description, timeout = 90000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw Error(`Timed out: ${description}`);
};
// Catalog reads without a setup ID intentionally return historical setups.
// Receipt assertions must request and verify the exact selected identity.
export async function readPodSavedSetup(boundary, setupId) {
  assert.ok(typeof setupId === 'string' && setupId.length > 0, 'An exact POD setup ID is required');
  const catalog = await boundary.catalog(setupId);
  assert.equal(catalog.error, null); assert.equal(catalog.data.setups.length, 1, 'Exact POD setup read must return one receipt');
  assert.equal(catalog.data.setups[0].setupId, setupId, 'POD setup read cannot substitute a historical receipt');
  return catalog.data.setups[0];
}
export async function waitForPodSelectedSetup(page, boundary, baseUrl, { previousSetupId = null, expectedSetupId = null } = {}) {
  const base = new URL(baseUrl);
  await page.waitForURL(url => {
    const setupId = url.searchParams.get('setup');
    return url.origin === base.origin && url.pathname === base.pathname &&
      url.searchParams.getAll('business').length === 1 && url.searchParams.get('business') === base.searchParams.get('business') &&
      url.searchParams.getAll('setup').length === 1 && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(setupId ?? '') &&
      setupId !== previousSetupId && (!expectedSetupId || setupId === expectedSetupId);
  });
  const receipt = await readPodSavedSetup(boundary, new URL(page.url()).searchParams.get('setup'));
  assert.equal(receipt.businessId, base.searchParams.get('business'), 'Selected POD setup must belong to the routed Business');
  return receipt;
}
// Follow the owner's disclosure controls: a collapsed result must stay concise,
// while the complete saved findings, attribution and receipts remain reachable.
async function assertPodResultDetails(page, expected, scopeId) {
  const result = page.getByRole('region', { name: 'Sourced research result', exact: true });
  const disclosure = name => result.locator('details').filter({ has: page.locator('summary').filter({ hasText: new RegExp(`^${name}$`) }) });
  const findings = disclosure('Full findings and assessment'), sources = disclosure('Sources and quoted evidence');
  const review = disclosure('Full independent review'), provenance = disclosure('Research provenance');
  for (const details of [findings, sources, review, provenance]) assert.equal(await details.getAttribute('open'), null, 'Saved results start with concise summaries');
  assert.ok(expected.review.rationale.length > 600 && expected.review.nextTest.length > 600, 'Exercise actual long thorough output');
  const summaries = result.locator(':scope > p');
  assert.equal(await summaries.nth(0).innerText(), `${expected.review.rationale.slice(0, 600)}… (Full text below)`);
  assert.equal(await summaries.nth(2).innerText(), `${expected.review.nextTest.slice(0, 600)}… (Full text below)`);
  assert.equal(await result.getByRole('link', { name: /E1: Inert public-source fixture/ }).count(), 0, 'Collapsed evidence is not exposed as a visible link');

  await findings.locator('summary').click();
  assert.equal(await findings.locator(':scope > p').nth(0).innerText(), expected.review.rationale);
  assert.equal(await findings.locator(':scope > p').nth(1).innerText(), expected.review.nextTest);
  assert.equal(await findings.locator(':scope > p').nth(2).innerText(), expected.strategy.explorationSummary);
  await findings.getByRole('heading', { name: `Recommended hypothesis: ${expected.strategy.candidates[0].productType} · ${expected.strategy.candidates[0].niche}`, exact: true }).waitFor();

  await sources.locator('summary').click();
  const source = sources.getByRole('link', { name: 'E1: Inert public-source fixture', exact: true });
  await source.waitFor({ state: 'visible' });
  assert.equal(await source.getAttribute('href'), expected.search1.annotations[0].url_citation.url);
  const attribution = source.locator('..');
  assert.equal(await attribution.locator('p').innerText(), expected.select1.selections[0].quote);
  assert.match(await attribution.locator('small').innerText(), /Retrieved .+; publication date not verified/);

  await review.locator('summary').click();
  await review.getByRole('heading', { name: 'Independent review', exact: true }).waitFor();
  const checks = await review.getByRole('listitem').allInnerTexts();
  assert.equal(checks.length, expected.review.checks.length);
  for (const [index, check] of expected.review.checks.entries()) {
    assert.ok(checks[index].includes(`${check.check.replaceAll('_', ' ')}: ${check.verdict}`));
    assert.ok(checks[index].includes(check.rationale), 'The full independent review is preserved');
  }
  await provenance.locator('summary').click();
  assert.equal(await provenance.locator(':scope > p').nth(0).innerText(), `Submitted query: ${expected.plan.query}`);
  assert.equal(await provenance.locator(':scope > p').nth(1).innerText(), expected.plan.sourceChoiceRationale);
  const release = `${POD_INERT_RELEASE.VERCEL_GIT_COMMIT_SHA.slice(0, 12)} · ${POD_INERT_RELEASE.VERCEL_DEPLOYMENT_ID}`;
  assert.deepEqual((await provenance.getByRole('listitem').allInnerTexts()).sort(), POD_PHASES.map(phase => `${phase}: ${release} · gen-r12-pod-next-${scopeId}-1-${phase}`).sort());
}
export async function runPodNextJourney({ origin, boundary, output, fixture, httpOnly = false }) {
  const results = [], external = [], errors = [];
  let browser = null, page = null, receipt = null, failedReceipt = null, failedAudit = null, failedCallsStart = 0, originalGoals = null, leaseHandoff = null, browserStatus = httpOnly ? 'unrun: explicitly HTTP-only' : 'not started';
  const current = () => boundary.state().r12;
  const expectedPhases = [0, 1].flatMap(ordinal => POD_PHASES.map(phase => ({ ordinal, phase })));
  const sentPhases = () => current().calls.map(({ ordinal, phase }) => ({ ordinal, phase }));
  const secondOutput = podNextThoroughOutputs(1);
  let basePath = `/dashboard/quests/research/pod?business=${current().businessId}`;
  const selectedPath = () => `${basePath}&setup=${receipt.setupId}`;
  const report = () => writeFile(path.join(output, 'acceptance.json'), JSON.stringify({ results, browser: browserStatus, workflowHost: 'actual SDK local host; production workflow/plugin/generated routes unchanged', provider: 'inert loopback only; no paid calls or live permission', leaseHandoff, external, errors }, null, 2));
  const check = async (name, work) => {
    const result = { name, status: 'running' }; results.push(result); await report(); console.log('START:', name);
    try { await work(); result.status = 'passed'; console.log('PASS:', name); }
    catch (error) { result.status = 'failed'; result.error = String(error.stack ?? error); if (page) result.artifacts = await captureOwnerJourneyFailure({ page, output, stage: name, index: results.length }).catch(e => ({ error: String(e) })); throw error; }
    finally { await report(); }
  };
  const read = async href => { const response = await fetch(origin + href, { signal: AbortSignal.timeout(30000) }); assert.equal(response.status, 200); return response.text(); };
  const manifest = JSON.parse(await readFile(path.join(fixture, '.next/server/server-reference-manifest.json'), 'utf8'));
  async function action(name, input, href = basePath) {
    const entries = Object.entries(manifest.node).filter(([, entry]) => entry.exportedName === name); assert.equal(entries.length, 1, `Generated action ${name}`);
    const response = await fetch(origin + href, { method: 'POST', headers: { origin, 'next-action': entries[0][0], accept: 'text/x-component', 'content-type': 'text/plain;charset=UTF-8' }, body: JSON.stringify([input]), signal: AbortSignal.timeout(60000) });
    assert.equal(response.status, 200); const body = await response.text();
    const values = body.split('\n').flatMap(line => { try { return [JSON.parse(line.slice(line.indexOf(':') + 1))]; } catch { return []; } });
    const result = values.find(v => v && typeof v === 'object' && typeof v.ok === 'boolean'); assert.ok(result, `${name} must expose its exact action outcome`); return result;
  }
  const input = () => ({ businessId: current().businessId, setupId: receipt.setupId, setupHash: receipt.setupHash, submissionId: randomUUID() });
  const getSaved = setupId => readPodSavedSetup(boundary, setupId);
  try {
    await check('actual Next owner route, auth and release verifier render without authority or provider calls', async () => {
      assert.match(await read(basePath), /Research viable print-on-demand products to sell on Etsy/);
      const signedOut = await fetch(origin + basePath, { headers: { cookie: 'r03-session=off' }, redirect: 'manual', signal: AbortSignal.timeout(30000) });
      assert.ok([303, 307].includes(signedOut.status)); assert.match(signedOut.headers.get('location'), /login/); await signedOut.body?.cancel();
      const verifier = await fetch(`${origin}/api/research/pod/release?business=${current().businessId}`, { signal: AbortSignal.timeout(30000) });
      assert.equal(verifier.status, 200); assert.equal(verifier.headers.get('cache-control'), 'no-store'); assert.equal((await verifier.json()).authorityCreated, false);
      assert.equal((await boundary.catalog()).data.setups.length, 0); assert.deepEqual(current().calls, []);
    });
    if (!httpOnly) {
      await check('launch actual isolated Chromium', async () => { browser = await chromium.launch({ headless: true, ...(process.env.GUIDED_UI_CHROMIUM_PATH ? { executablePath: process.env.GUIDED_UI_CHROMIUM_PATH } : {}), args: ['--no-sandbox'] }); browserStatus = 'actual Chromium'; });
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
      context.setDefaultTimeout(30000); context.setDefaultNavigationTimeout(30000);
      await context.route('**/*', route => { const url = new URL(route.request().url()); if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) { external.push(url.origin); return route.abort('blockedbyclient'); } return route.continue(); });
      page = await context.newPage(); page.on('pageerror', error => errors.push(String(error)));
    }
    await check('general goal and budget prepare an exact review; lost reply recovers the same immutable setup', async () => {
      boundary.losePrepareReply();
      if (page) {
        await page.goto(origin + basePath); await page.getByRole('textbox', { name: 'Research goal', exact: true }).fill(POD_OBJECTIVE);
        const names = await page.locator('section[aria-label="Goal-driven POD research"] form input, section[aria-label="Goal-driven POD research"] form textarea, section[aria-label="Goal-driven POD research"] form select').evaluateAll(nodes => nodes.map(node => node.name).sort());
        assert.deepEqual(names, ['budget', 'objective', 'printful']);
        await page.getByRole('textbox', { name: 'Total limit for up to five research passes (USD)', exact: true }).fill('10.00');
        await page.getByRole('button', { name: 'Review cost and permissions', exact: true }).click();
        await page.getByRole('button', { name: 'Recover the same review', exact: true }).waitFor(); receipt = await getSaved(current().ownerSetup?.setupId);
        await page.getByRole('button', { name: 'Recover the same review', exact: true }).click();
        const recovered = await waitForPodSelectedSetup(page, boundary, origin + basePath, { expectedSetupId: receipt.setupId }); assert.equal(recovered.setupHash, receipt.setupHash); receipt = recovered;
      } else {
        const entry = { businessId: current().businessId, publicBrief: { objective: POD_OBJECTIVE, publicConstraints: [], fulfilmentContext: 'unspecified' }, maximumMicrounits: '10000000', deadlineAt: new Date(Date.now() + 3600000).toISOString(), submissionId: randomUUID() };
        assert.equal((await action('preparePodResearchAction', entry)).ok, false); const saved = await getSaved(current().ownerSetup?.setupId);
        const recovered = await action('preparePodResearchAction', entry); assert.equal(recovered.ok, true, recovered.message); receipt = recovered.receipt; assert.equal(receipt.setupId, saved.setupId);
      }
      assert.equal(receipt.preview.profile, 'r12.pod-thorough.1'); assert.equal(receipt.preview.automaticFormatFailureContinuation, true); assert.equal(receipt.activated, false); assert.equal(receipt.confirmed, false); assert.equal((await getSaved(receipt.setupId)).setupId, receipt.setupId); assert.deepEqual(current().calls, []);
      const html = await read(selectedPath());
      for (const phrase of [POD_OBJECTIVE, 'Exa may retain queries', 'USD 10.000000', 'shared total ceiling for all five passes', 'Unused allowance carries between passes', 'Proposed cumulative cap', '30 minutes after approval', 'another 30 minutes']) assert.ok(html.includes(phrase), phrase);
      if (page) { const approve = page.getByRole('button', { name: 'Approve and research', exact: true }); assert.equal(await approve.isDisabled(), true); await page.reload(); assert.equal(await approve.isDisabled(), true); await page.screenshot({ path: path.join(output, 'pod-approval-desktop.png'), fullPage: true }); }
    });
    await check('actual background Workflow refines a weak pass into a different-query useful second pass within one total cap', async () => {
      const deadline = Date.now() + 180000, remaining = () => Math.max(1, deadline - Date.now());
      boundary.holdProvider();
      if (page) { await page.getByRole('checkbox', { name: 'I approve this public brief, recipients, bounded source policy and maximum charge.', exact: true }).check(); await page.getByRole('button', { name: 'Approve and research', exact: true }).click(); }
      else { const confirmed = await action('confirmPodResearchAction', input(), selectedPath()); assert.equal(confirmed.ok, true, confirmed.message); assert.equal(confirmed.runtimeStarted, true); }
      await waitUntil(() => boundary.logs.some(event => event.kind === 'inert-pod-receipt-held'), 'the real Workflow waking to reconcile the exact saved first generation', remaining());
      const held = boundary.logs.find(event => event.kind === 'inert-pod-receipt-held'), firstPost = boundary.logs.find(event => event.kind === 'inert-pod-provider' && event.method === 'POST');
      const release = boundary.logs.find(event => event.kind === 'actual-workflow-lease-release');
      assert.ok(release && release.released === true && release.at < held.at, 'The paid phase persists then releases its own fenced lease before the next Workflow step');
      assert.ok(held.at - firstPost.at < 30000, 'The scoped successor must not incur an artificial 60-second lease wait');
      const beforeQuiet = { calls: current().calls.length, reads: boundary.logs.filter(event => event.kind === 'actual-workflow-runtime-read').length };
      await new Promise(resolve => setTimeout(resolve, 1200));
      assert.equal(current().calls.length, beforeQuiet.calls, 'A pending exact receipt cannot regenerate or start another paid phase');
      assert.equal(boundary.logs.filter(event => event.kind === 'actual-workflow-runtime-read').length, beforeQuiet.reads, 'A held exact receipt does not spin up duplicate Workflow steps');
      leaseHandoff = { mode: 'fenced-release', generationId: held.generationId, firstReceiptWakeMs: held.at - firstPost.at, quietIntervalMs: 1200 };
      if (page) await page.goto(origin + basePath);
      boundary.releaseProvider();
      await waitUntil(async () => {
        assert.deepEqual(boundary.logs.filter(item => item.kind === 'actual-workflow-rpc-error'), [], 'Actual runtime RPC failures must remain visible');
        const saved = (await boundary.result(receipt.scopeId)).data, summary = await boundary.passSummary(receipt.scopeId);
        return saved?.version === 'r12.pod-saved-result.2' && saved.context.attempt.adaptiveActionOrdinal === 1 && saved.current.candidate.output.outcome === 'HYPOTHESIS_TO_TEST' && summary.head?.state === 'completed';
      }, 'actual Workflow independently reviewing the empty first pass, searching differently and stopping on the useful second pass', remaining());
      assert.ok(boundary.logs.filter(event => event.kind === 'actual-workflow-lease-release' && event.released).length >= 10);
      assert.equal(boundary.logs.filter(event => event.kind === 'actual-workflow-controller-snapshot' && Date.parse(event.leaseExpiresAt) > event.at).length, 0, 'Released thorough leases create no artificial 60-second handoff');
      const firstReview = current().podReviewSnapshots.find(value => value.ordinal === 0);
      assert.equal(firstReview.evidence.items.length, 0); assert.equal(firstReview.assessment.candidates.length, 0);
      assert.equal(firstReview.output.outcome, 'INSUFFICIENT_EVIDENCE'); assert.match(firstReview.output.rationale, /漢字 🧪/); assert.ok(firstReview.output.rationale.length > 1000);
      assert.deepEqual(sentPhases(), expectedPhases); assert.deepEqual(current().receipts, expectedPhases);
      const searches = current().calls.filter(call => call.phase === 'search1'); assert.equal(searches.length, 2); assert.notEqual(searches[0].query, searches[1].query);
      assert.equal(searches[1].query, secondOutput.plan.query);
      const summary = await boundary.passSummary(receipt.scopeId);
      assert.deepEqual(summary.passes, [{ ordinal: 0 }, { ordinal: 1 }]);
      assert.deepEqual(summary.closures.map(({ ordinal, outcome }) => ({ ordinal, outcome })), [{ ordinal: 0, outcome: 'INSUFFICIENT_EVIDENCE' }, { ordinal: 1, outcome: 'HYPOTHESIS_TO_TEST' }]);
      assert.equal(summary.head.reason, 'reviewed_hypothesis_ready');
      assert.ok(summary.closures.reduce((sum, pass) => sum + Number(pass.committed_microunits), 0) <= 10000000);
      const saved = (await boundary.result(receipt.scopeId)).data;
      assert.equal(saved.inputs.pass.history.review.outcome, 'INSUFFICIENT_EVIDENCE'); assert.equal(saved.inputs.pass.history.previousPass, 0);
      assert.equal(saved.inputs.pass.history.priorQueries[0].query, searches[0].query);
      assert.equal(saved.context.plan.maximumDispatches, 25); assert.equal(saved.context.plan.maximumMicrounits, '10000000');
      for (const operation of ['admit', 'context', 'complete']) assert.ok(boundary.logs.some(item => item.kind === 'actual-workflow-pass' && item.operation === operation));
      receipt = await getSaved(receipt.setupId); assert.equal(receipt.activated, true);
    });
    await check('saved sourced second-pass hypothesis retains caveats, reload and Stop without a third pass or repeat calls', async () => {
      if (page) { await page.goto(origin + selectedPath()); await page.getByRole('heading', { name: 'A hypothesis worth testing', exact: true }).waitFor(); }
      const html = await read(selectedPath());
      for (const phrase of ['A hypothesis worth testing', 'Earlier passes remain saved as audit evidence', 'Sources and quoted evidence', 'What remains unknown', 'Independent review', 'inert-sql-fixture', 'Research provenance']) assert.ok(html.includes(phrase), phrase);
      if (page) {
        await assertPodResultDetails(page, secondOutput, receipt.scopeId);
        assert.match(await page.locator('main').innerText(), /Research pass 2 of 5/);
        await page.reload(); await page.getByRole('heading', { name: 'A hypothesis worth testing', exact: true }).waitFor();
        await assertPodResultDetails(page, secondOutput, receipt.scopeId);
        for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) { await page.setViewportSize(viewport); const geometry = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth })); assert.ok(geometry.content <= geometry.viewport + 1, 'POD result has no horizontal page overflow'); await page.screenshot({ path: path.join(output, `pod-result-${viewport.width}.png`), fullPage: true }); }
        await page.getByRole('button', { name: 'Stop research', exact: true }).click(); await waitUntil(async () => (await getSaved(receipt.setupId)).stopped, 'saved Stop');
        await page.getByRole('button', { name: 'Stop research', exact: true }).waitFor({ state: 'hidden' });
      } else { const stopped = await action('stopPodResearchAction', input(), selectedPath()); assert.equal(stopped.ok, true, stopped.message); assert.equal(stopped.receipt.stopped, true); }
      assert.match(await read(selectedPath()), /A hypothesis worth testing/); assert.deepEqual(sentPhases(), expectedPhases);
      const saved = await boundary.result(receipt.scopeId); assert.equal(saved.error, null); assert.equal(saved.data.version, 'r12.pod-saved-result.2'); assert.equal(saved.data.current.candidate.output.outcome, 'HYPOTHESIS_TO_TEST');
      assert.equal((await boundary.passSummary(receipt.scopeId)).passes.length, 2);
      assert.equal((await getSaved(receipt.setupId)).preview.finance.runLimitMicrounits, '10000000');
      assert.deepEqual(external, []); assert.deepEqual(errors, []); assert.deepEqual(boundary.denied, []); assert.deepEqual(boundary.base.denied, []);
    });
    await check('a malformed thorough review is counted, reconciled and followed by a new independent pass without owner reapproval', async () => {
      const previousSetupId = receipt.setupId, start = current().calls.length; boundary.malformedNextReview();
      if (page) {
        await page.goto(origin + basePath); await page.getByRole('textbox', { name: 'Research goal', exact: true }).fill(POD_OBJECTIVE);
        await page.getByRole('textbox', { name: 'Total limit for up to five research passes (USD)', exact: true }).fill('10.00');
        await page.getByRole('button', { name: 'Review cost and permissions', exact: true }).click();
        receipt = await waitForPodSelectedSetup(page, boundary, origin + basePath, { previousSetupId });
        assert.equal(receipt.preview.profile, 'r12.pod-thorough.1');
        await page.getByRole('checkbox', { name: 'I approve this public brief, recipients, bounded source policy and maximum charge.', exact: true }).check(); await page.getByRole('button', { name: 'Approve and research', exact: true }).click();
      } else {
        const prepared = await action('preparePodResearchAction', { businessId: current().businessId, publicBrief: { objective: POD_OBJECTIVE, publicConstraints: [], fulfilmentContext: 'unspecified' }, maximumMicrounits: '10000000', deadlineAt: new Date(Date.now() + 3600000).toISOString(), submissionId: randomUUID() }); assert.equal(prepared.ok, true, prepared.message); receipt = prepared.receipt;
        const confirmed = await action('confirmPodResearchAction', input(), selectedPath()); assert.equal(confirmed.ok, true, confirmed.message);
      }
      await waitUntil(async () => { const saved = await boundary.result(receipt.scopeId), summary = await boundary.passSummary(receipt.scopeId); return podNextRecoveryResultReady(saved, summary); }, 'same-grant malformed-output recovery reaching a new independent useful review', 180000);
      const summary = await boundary.passSummary(receipt.scopeId), saved = (await boundary.result(receipt.scopeId)).data;
      assert.deepEqual(summary.closures.map(({ ordinal, outcome }) => ({ ordinal, outcome })), [{ ordinal: 0, outcome: 'FAILED_OUTPUT' }, { ordinal: 1, outcome: 'HYPOTHESIS_TO_TEST' }]);
      assert.deepEqual(sentPhases().slice(start), expectedPhases); assert.equal(summary.failures.length, 1); assert.equal(summary.failures[0].phase, 'review'); assert.equal(summary.failures[0].failure_kind, 'json_parse');
      assert.equal(saved.inputs.pass.history.reviewAccepted, false); assert.equal(saved.inputs.pass.history.version, 'r12.pod-failed-pass-history.3');
      assert.equal(summary.closures.reduce((sum, pass) => sum + Number(pass.committed_microunits), 0), 100);
      if (page) {
        await page.goto(origin + selectedPath()); await page.getByRole('heading', { name: 'A hypothesis worth testing', exact: true }).waitFor();
        await assertPodResultDetails(page, secondOutput, receipt.scopeId);
        assert.equal(await page.getByRole('button', { name: 'Review next-pass recovery', exact: true }).count(), 0);
        await page.screenshot({ path: path.join(output, 'pod-counted-failure-result.png'), fullPage: true });
        await page.getByRole('button', { name: 'Stop research', exact: true }).click(); await waitUntil(async () => (await getSaved(receipt.setupId)).stopped, 'Stop after counted recovery');
        await page.getByRole('button', { name: 'Stop research', exact: true }).waitFor({ state: 'hidden' });
      } else { const stopped = await action('stopPodResearchAction', input(), selectedPath()); assert.equal(stopped.ok, true, stopped.message); }
      assert.deepEqual(sentPhases().slice(start), expectedPhases); assert.deepEqual(boundary.logs.filter(event => event.kind === 'actual-workflow-rpc-error'), []);
    });
    await check('legacy owner history still saves a rejected reviewer response and stops through the actual owner UI', async () => {
      const previousSetupId = receipt.setupId; failedCallsStart = current().calls.length;
      await boundary.useLegacyTemplate(); basePath = `/dashboard/quests/research/pod?business=${current().businessId}`; boundary.rejectNextReview();
      if (page) {
        await page.goto(origin + basePath);
        await page.getByRole('textbox', { name: 'Research goal', exact: true }).fill(POD_OBJECTIVE);
        await page.getByRole('textbox', { name: 'Total limit for up to five research passes (USD)', exact: true }).fill('10.00');
        await page.getByRole('button', { name: 'Review cost and permissions', exact: true }).click();
        receipt = await waitForPodSelectedSetup(page, boundary, origin + basePath, { previousSetupId });
        await page.getByRole('checkbox', { name: 'I approve this public brief, recipients, bounded source policy and maximum charge.', exact: true }).check();
        await page.getByRole('button', { name: 'Approve and research', exact: true }).click();
      } else {
        const entry = { businessId: current().businessId, publicBrief: { objective: POD_OBJECTIVE, publicConstraints: [], fulfilmentContext: 'unspecified' }, maximumMicrounits: '10000000', deadlineAt: new Date(Date.now() + 3600000).toISOString(), submissionId: randomUUID() };
        const prepared = await action('preparePodResearchAction', entry); assert.equal(prepared.ok, true, prepared.message); receipt = prepared.receipt;
        const confirmed = await action('confirmPodResearchAction', input(), selectedPath()); assert.equal(confirmed.ok, true, confirmed.message); assert.equal(confirmed.runtimeStarted, true);
      }
      await waitUntil(async () => {
        return podNextRejectedReviewReady(await boundary.progress(receipt.scopeId));
      }, 'the actual Workflow preserving the synthetic length-rejected independent review');
      assert.deepEqual(sentPhases().slice(failedCallsStart), POD_PHASES.map(phase => ({ ordinal: 0, phase })));
      assert.equal((await boundary.result(receipt.scopeId)).data, null);
      if (page) {
        await page.goto(origin + selectedPath()); await page.getByRole('heading', { name: 'Reviewer response could not be validated', exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Continue saved run', exact: true }).count(), 0);
        await page.getByRole('button', { name: 'Stop research', exact: true }).click();
        await waitUntil(async () => (await getSaved(receipt.setupId)).stopped, 'the failed pass stopped by its owner');
        await page.getByRole('button', { name: 'Review next-pass recovery', exact: true }).waitFor();
        await page.screenshot({ path: path.join(output, 'pod-rejected-stopped.png'), fullPage: true });
      } else {
        const stopped = await action('stopPodResearchAction', input(), selectedPath()); assert.equal(stopped.ok, true, stopped.message);
      }
      failedReceipt = await getSaved(receipt.setupId); assert.equal(failedReceipt.stopped, true);
      failedAudit = await boundary.audit(failedReceipt.scopeId);
      assert.equal(failedAudit.attempts.length, 5); assert.equal(failedAudit.attempts.filter(attempt => attempt.status === 'completed').length, 4);
      const review = failedAudit.attempts.find(attempt => attempt.step_key === 'review'); assert.notEqual(review.status, 'completed'); assert.equal(review.response_hash, null);
      const proof = await boundary.recovery(failedReceipt.setupId); assert.equal(proof.error, null);
      assert.deepEqual([proof.data.proof.usedPasses, proof.data.proof.usedCalls, proof.data.proof.usedSearches], [1, 5, 1]);
      assert.equal(proof.data.proof.spentMicrounits, '50'); assert.equal(proof.data.proof.remainingMaximumMicrounits, '9999950');
      assert.equal(proof.data.history.reviewAccepted, false); assert.equal(proof.data.inputs.dependencies.length, 4);
    });
    await check('recovery review survives a lost reply and reload while preserving the failed pass and remaining allowance', async () => {
      const callsBefore = current().calls.length; originalGoals = await boundary.goalVersions(failedReceipt.goalId); await boundary.prepareThoroughRecoveryTemplate(); boundary.losePrepareReply();
      if (page) {
        await page.getByRole('button', { name: 'Review next-pass recovery', exact: true }).click();
        await page.getByRole('status').filter({ hasText: 'The result could not be verified.' }).waitFor();
        const savedProposal = await getSaved(current().ownerSetup?.setupId); assert.notEqual(savedProposal.setupId, failedReceipt.setupId);
        await page.reload(); await page.getByRole('button', { name: 'Review next-pass recovery', exact: true }).click();
        receipt = await waitForPodSelectedSetup(page, boundary, origin + basePath, { expectedSetupId: savedProposal.setupId, previousSetupId: failedReceipt.setupId });
        assert.equal(receipt.setupHash, savedProposal.setupHash);
      } else {
        const recoveryInput = { ...input(), approveGoalDeadlineRevision: true }; assert.equal((await action('preparePodResearchRecoveryAction', recoveryInput, selectedPath())).ok, false);
        const savedProposalId = current().ownerSetup.setupId;
        const recovered = await action('preparePodResearchRecoveryAction', recoveryInput, selectedPath()); assert.equal(recovered.ok, true, recovered.message);
        receipt = recovered.receipt; assert.equal(receipt.setupId, savedProposalId);
      }
      assert.equal((await boundary.catalog()).data.setups.length, 2, 'The lost response and retry must create only one successor proposal');
      assert.equal(receipt.preview.profile, 'r12.pod-thorough.1');
      const revisedGoals = await boundary.goalVersions(failedReceipt.goalId); assert.deepEqual(revisedGoals.slice(0, originalGoals.length), originalGoals); assert.equal(revisedGoals.length, originalGoals.length + 2);
      const withoutDeadline = value => { const copy = structuredClone(value); delete copy.parsed.deadline; return copy; }; for (const goal of revisedGoals.slice(originalGoals.length)) assert.deepEqual(withoutDeadline(goal.content), withoutDeadline(originalGoals.at(-1).content));
      assert.equal(receipt.preview.goalRevision, originalGoals.at(-1).revision + 2); assert.equal(revisedGoals.at(-1).preference, 'ready');
      assert.equal(receipt.goalId, failedReceipt.goalId); assert.equal(receipt.confirmed, false); assert.equal(receipt.activated, false);
      assert.equal(receipt.preview.recovery.proof.predecessorSetupId, failedReceipt.setupId);
      assert.equal(receipt.preview.recovery.originalReviewAccepted, false);
      assert.equal(receipt.preview.finance.runLimitMicrounits, '9999950');
      const html = await read(selectedPath());
      for (const phrase of ['Original total ceiling:', 'USD 10.000000', 'Already spent:', 'USD 0.000050', 'USD 9.999950', 'fresh independent review is required', 'No paid formatting correction', 'earlier permission stays stopped', 'explicitly rejected, untrusted reviewer critique']) assert.ok(html.includes(phrase), phrase);
      if (page) {
        assert.match(await page.locator('main').innerText(), /Remaining: at most 4 complete passes, 20 calls and 4 searches/);
        assert.equal(await page.getByRole('button', { name: 'Approve and research', exact: true }).isDisabled(), true);
        await page.reload(); assert.equal(await page.getByRole('button', { name: 'Approve and research', exact: true }).isDisabled(), true);
        await page.screenshot({ path: path.join(output, 'pod-recovery-approval.png'), fullPage: true });
      }
      assert.equal(current().calls.length, callsBefore); assert.equal((await getSaved(failedReceipt.setupId)).stopped, true);
      assert.deepEqual(await boundary.audit(failedReceipt.scopeId), failedAudit);
    });
    await check('explicit recovery approval uses the actual Workflow for a fresh accepted pass while the old review stays rejected', async () => {
      const runtimeReadsBefore = boundary.logs.filter(event => event.kind === 'actual-workflow-runtime-read').length;
      if (page) {
        await page.getByRole('checkbox', { name: 'I approve this public brief, recipients, bounded source policy and maximum charge.', exact: true }).check();
        await page.getByRole('button', { name: 'Approve and research', exact: true }).click();
      } else {
        const confirmed = await action('confirmPodResearchAction', input(), selectedPath()); assert.equal(confirmed.ok, true, confirmed.message); assert.equal(confirmed.runtimeStarted, true);
      }
      await waitUntil(async () => {
        assert.deepEqual(boundary.logs.filter(event => event.kind === 'actual-workflow-rpc-error'), [], 'Recovery runtime errors cannot be hidden by a longer wait');
        const saved = await boundary.result(receipt.scopeId), summary = await boundary.passSummary(receipt.scopeId);
        return podNextRecoveryResultReady(saved, summary);
      }, 'the real background Workflow completing a fresh independently accepted recovery pass', 180000);
      assert.ok(boundary.logs.filter(event => event.kind === 'actual-workflow-runtime-read').length > runtimeReadsBefore);
      assert.deepEqual(sentPhases().slice(failedCallsStart), expectedPhases, 'Exactly one failed pass and one fresh pass are charged; the rejected reviewer is never resent');
      assert.equal(current().receipts.length, 29, 'The rejected response is settled but never turns into a route-qualified candidate');
      const saved = (await boundary.result(receipt.scopeId)).data;
      assert.equal(saved.context.attempt.adaptiveActionOrdinal, 1); assert.equal(saved.inputs.pass.history.kind, 'failed_pass_context');
      assert.equal(saved.inputs.pass.history.reviewAccepted, false); assert.equal(saved.inputs.pass.history.untrustedCritique.outcome, 'INSUFFICIENT_EVIDENCE');
      assert.equal(saved.current.candidate.output.outcome, 'HYPOTHESIS_TO_TEST');
      assert.deepEqual((await boundary.passSummary(receipt.scopeId)).passes, [{ ordinal: 1 }]);
      assert.deepEqual((await boundary.passSummary(failedReceipt.scopeId)).closures, []);
      assert.deepEqual(await boundary.audit(failedReceipt.scopeId), failedAudit);
      assert.equal((await getSaved(failedReceipt.setupId)).stopped, true); assert.equal((await boundary.result(failedReceipt.scopeId)).data, null);
      if (page) {
        await page.goto(origin + selectedPath()); await page.getByRole('heading', { name: 'A hypothesis worth testing', exact: true }).waitFor();
        assert.match(await page.locator('main').innerText(), /Research pass 2 of 5/);
        assert.match(await page.locator('main').innerText(), /Total known cost across the original and recovery: USD 0\.000100/);
        await page.reload(); await page.getByRole('heading', { name: 'A hypothesis worth testing', exact: true }).waitFor();
        await assertPodResultDetails(page, secondOutput, receipt.scopeId);
        await page.screenshot({ path: path.join(output, 'pod-recovery-result.png'), fullPage: true });
      }
      assert.equal(current().calls.length, 30); assert.deepEqual(external, []); assert.deepEqual(errors, []);
      assert.deepEqual(boundary.denied, []); assert.deepEqual(boundary.base.denied, []);
    });
  } finally { boundary.releaseProvider(); await browser?.close(); await report(); }
}
