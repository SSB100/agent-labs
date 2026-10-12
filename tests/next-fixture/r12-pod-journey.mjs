import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { captureOwnerJourneyFailure } from './r12-owner-initial-journey.mjs';
import { assertPodLeaseQuiet } from './r12-pod-boundary.mjs';
import { POD_OBJECTIVE, POD_PHASES, podInertOutputs } from '../helpers/r12-pod-sql-fixture.mjs';

const waitUntil = async (check, description, timeout = 90000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw Error(`Timed out: ${description}`);
};
export async function runPodNextJourney({ origin, boundary, output, fixture, httpOnly = false }) {
  const results = [], external = [], errors = [];
  let browser = null, page = null, receipt = null, leaseHandoff = null, browserStatus = httpOnly ? 'unrun: explicitly HTTP-only' : 'not started';
  const current = () => boundary.state().r12;
  const expectedPhases = [0, 1].flatMap(ordinal => POD_PHASES.map(phase => ({ ordinal, phase })));
  const sentPhases = () => current().calls.map(({ ordinal, phase }) => ({ ordinal, phase }));
  const secondOutput = podInertOutputs({ passOrdinal: 1, useful: true });
  const basePath = `/dashboard/quests/research/pod?business=${current().businessId}`;
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
  const getSaved = async () => { const catalog = await boundary.catalog(); assert.equal(catalog.error, null); assert.equal(catalog.data.setups.length, 1); return catalog.data.setups[0]; };
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
        await page.getByRole('button', { name: 'Recover the same review', exact: true }).waitFor(); receipt = await getSaved();
        await page.getByRole('button', { name: 'Recover the same review', exact: true }).click(); await page.waitForURL(origin + selectedPath());
      } else {
        const entry = { businessId: current().businessId, publicBrief: { objective: POD_OBJECTIVE, publicConstraints: [], fulfilmentContext: 'unspecified' }, maximumMicrounits: '10000000', deadlineAt: new Date(Date.now() + 3600000).toISOString(), submissionId: randomUUID() };
        assert.equal((await action('preparePodResearchAction', entry)).ok, false); const saved = await getSaved();
        const recovered = await action('preparePodResearchAction', entry); assert.equal(recovered.ok, true, recovered.message); receipt = recovered.receipt; assert.equal(receipt.setupId, saved.setupId);
      }
      assert.equal(receipt.activated, false); assert.equal(receipt.confirmed, false); assert.equal((await getSaved()).setupId, receipt.setupId); assert.deepEqual(current().calls, []);
      const html = await read(selectedPath());
      for (const phrase of [POD_OBJECTIVE, 'Exa may retain queries', 'USD 10.000000', 'shared total ceiling for all five passes', 'Unused allowance carries between passes', 'Proposed cumulative cap', '30 minutes after approval', 'another 30 minutes']) assert.ok(html.includes(phrase), phrase);
      if (page) { const approve = page.getByRole('button', { name: 'Approve and research', exact: true }); assert.equal(await approve.isDisabled(), true); await page.reload(); assert.equal(await approve.isDisabled(), true); await page.screenshot({ path: path.join(output, 'pod-approval-desktop.png'), fullPage: true }); }
    });
    await check('actual background Workflow refines a weak pass into a different-query useful second pass within one total cap', async () => {
      // This stage includes the real 60-second R07 lease handoff. Do not expire
      // the lease in SQL, replace the Workflow clock or widen unrelated waits.
      const deadline = Date.now() + 180000, remaining = () => Math.max(1, deadline - Date.now());
      boundary.holdProvider();
      if (page) { await page.getByRole('checkbox', { name: 'I approve this public brief, recipients, bounded source policy and maximum charge.', exact: true }).check(); await page.getByRole('button', { name: 'Approve and research', exact: true }).click(); await page.getByRole('button', { name: 'Continue saved run', exact: true }).waitFor(); }
      else { const confirmed = await action('confirmPodResearchAction', input(), selectedPath()); assert.equal(confirmed.ok, true, confirmed.message); assert.equal(confirmed.runtimeStarted, true, 'The actual workflow/api.start boundary must succeed'); }
      await waitUntil(() => current().calls.some(call => call.ordinal === 0 && call.phase === 'plan'), 'actual Workflow host dispatching the first inert phase', remaining());
      assert.ok(boundary.logs.some(item => item.kind === 'actual-workflow-runtime-read'), 'No direct test invocation of the runtime may replace the Workflow host');
      if (page) await page.goto(origin + basePath);
      boundary.releaseProvider();
      await waitUntil(() => {
        assert.deepEqual(boundary.logs.filter(item => item.kind === 'actual-workflow-rpc-error'), [], 'Actual runtime RPC failures must not be hidden by a longer wait');
        leaseHandoff = boundary.logs.find(item => item.kind === 'actual-workflow-controller-snapshot' && item.runtimeReadOrdinal >= 2 && Date.parse(item.leaseExpiresAt) > item.at) ?? null;
        return leaseHandoff !== null;
      }, 'a fresh actual Workflow step reading the saved controller and waiting on its prior live lease', remaining());
      assert.ok(leaseHandoff.providerCalls > 0 && leaseHandoff.providerCalls < expectedPhases.length, 'The lease handoff must occur during the saved partial research, before completion');
      const expiry = Date.parse(leaseHandoff.leaseExpiresAt);
      assert.ok(expiry - leaseHandoff.at >= 1000, 'The fixture must observe a real live-lease interval');
      await report();
      await waitUntil(() => {
        assertPodLeaseQuiet(boundary.logs, leaseHandoff);
        if (Date.now() >= expiry) return true;
        assert.equal(current().calls.length, leaseHandoff.providerCalls, 'No new provider send during the prior lease');
        assert.equal(current().receipts.length, leaseHandoff.receipts, 'No replacement receipt work during the prior lease');
        return false;
      }, 'the real prior lease expiry with no new sends, claims or premature Workflow retry', remaining());
      await waitUntil(async () => {
        assert.deepEqual(boundary.logs.filter(item => item.kind === 'actual-workflow-rpc-error'), [], 'Actual runtime RPC failures must remain visible');
        const saved = (await boundary.result(receipt.scopeId)).data, summary = await boundary.passSummary(receipt.scopeId);
        return saved?.version === 'r12.pod-saved-result.2' && saved.context.attempt.adaptiveActionOrdinal === 1 && saved.current.candidate.output.outcome === 'HYPOTHESIS_TO_TEST' && summary.head?.state === 'completed';
      }, 'actual Workflow completing its independently reviewed second pass after the real lease expiry and stopping early', remaining());
      assertPodLeaseQuiet(boundary.logs, leaseHandoff);
      const resumed = boundary.logs.find(item => item.kind === 'actual-workflow-runtime-read' && item.runtimeReadOrdinal > leaseHandoff.runtimeReadOrdinal);
      assert.ok(resumed && resumed.at >= expiry, 'The actual Workflow host must resume in a later step after the prior lease expires');
      const nextSend = boundary.logs.slice(boundary.logs.indexOf(leaseHandoff) + 1).find(item => item.kind === 'inert-pod-provider' && item.method === 'POST');
      assert.ok(nextSend && nextSend.at >= expiry, 'The saved second pass may continue sending only after lease expiry');
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
      receipt = await getSaved(); assert.equal(receipt.activated, true);
    });
    await check('saved sourced second-pass hypothesis retains caveats, reload and Stop without a third pass or repeat calls', async () => {
      if (page) { await page.goto(origin + selectedPath()); await page.getByRole('heading', { name: 'A hypothesis worth testing', exact: true }).waitFor(); }
      const html = await read(selectedPath());
      for (const phrase of ['A hypothesis worth testing', 'Earlier passes remain saved as audit evidence', 'Sources and quoted evidence', 'What remains unknown', 'Independent review', 'inert-sql-fixture', 'Research provenance']) assert.ok(html.includes(phrase), phrase);
      if (page) {
        assert.equal(await page.getByRole('link', { name: /E1: Inert public-source fixture/ }).getAttribute('href'), secondOutput.search1.annotations[0].url_citation.url);
        assert.match(await page.locator('main').innerText(), /Research pass 2 of 5/);
        await page.reload(); await page.getByRole('heading', { name: 'A hypothesis worth testing', exact: true }).waitFor();
        for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) { await page.setViewportSize(viewport); const geometry = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth })); assert.ok(geometry.content <= geometry.viewport + 1, 'POD result has no horizontal page overflow'); await page.screenshot({ path: path.join(output, `pod-result-${viewport.width}.png`), fullPage: true }); }
        await page.getByRole('button', { name: 'Stop research', exact: true }).click(); await waitUntil(async () => (await getSaved()).stopped, 'saved Stop');
        await page.getByRole('button', { name: 'Stop research', exact: true }).waitFor({ state: 'hidden' });
      } else { const stopped = await action('stopPodResearchAction', input(), selectedPath()); assert.equal(stopped.ok, true, stopped.message); assert.equal(stopped.receipt.stopped, true); }
      assert.match(await read(selectedPath()), /A hypothesis worth testing/); assert.deepEqual(sentPhases(), expectedPhases);
      const saved = await boundary.result(receipt.scopeId); assert.equal(saved.error, null); assert.equal(saved.data.version, 'r12.pod-saved-result.2'); assert.equal(saved.data.current.candidate.output.outcome, 'HYPOTHESIS_TO_TEST');
      assert.equal((await boundary.passSummary(receipt.scopeId)).passes.length, 2);
      assert.equal((await getSaved()).preview.finance.runLimitMicrounits, '10000000');
      assert.deepEqual(external, []); assert.deepEqual(errors, []); assert.deepEqual(boundary.denied, []); assert.deepEqual(boundary.base.denied, []);
    });
  } finally { boundary.releaseProvider(); await browser?.close(); await report(); }
}
