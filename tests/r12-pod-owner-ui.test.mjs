// Current-source owner UI/action/server contracts with inert I/O boundaries.
// These are not browser, SQL-race, live-provider or market-research evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { createHash, createHmac } from 'node:crypto';
import { fixture, source, id, OBJECTIVE, PHASES, workspace, elements, button, text, html, deferred, actionHarness, serverHarness, releaseRouteHarness } from './helpers/r12-pod-owner-ui-fixture.mjs';

const approve = h => {
  const checkbox = elements(h.render(), e => e.type === 'input' && e.props.type === 'checkbox')[0];
  assert.ok(checkbox); checkbox.props.onChange({ target: { checked: true } });
};
const actionInput = f => ({ businessId: f.receipt.businessId, setupId: f.receipt.setupId, setupHash: f.receipt.setupHash, submissionId: id(80) });

// This deliberately uses the normal owner navigation, not a copied form.
test('ordinary owner entry offers the new general-goal route without a manual UUID', () => {
  const entry = source('components/quests/owner-research-entry.tsx');
  const markup = html(React.createElement(entry.OwnerResearchEntry, { businesses: [{ id: id(1), name: 'Inert Business' }], selectedBusinessId: id(1) }));
  assert.match(markup, new RegExp(`href="/dashboard/quests/research/pod\\?business=${id(1)}"`));
  assert.match(markup, /Set a general print-on-demand research goal/);
  assert.doesNotMatch(markup, /<input[^>]*(?:uuid|setupId|scopeId|goalId)/i);
});

test('general goal and USD budget suffice; query, country, niche and IDs are not owner form inputs', async () => {
  const f = fixture(), h = workspace(f);
  const tree = h.render(), controls = elements(tree, e => ['input', 'textarea', 'select'].includes(e.type));
  assert.deepEqual(controls.map(e => e.props.name).sort(), ['budget', 'objective', 'printful']);
  assert.equal(controls.find(e => e.type === 'textarea').props.defaultValue, OBJECTIVE);
  assert.equal(controls.find(e => e.props.name === 'budget').props.defaultValue, '10.00');
  assert.match(text(tree), /Up to five research and refinement passes share this one total limit/);
  assert.equal(h.calls.length, 0, 'Rendering has no preparation or spending side effect');
  h.submit(); await h.settle();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].name, 'preparePodResearchAction');
  const input = h.calls[0].input;
  assert.deepEqual(input.publicBrief, { objective: OBJECTIVE, publicConstraints: [], fulfilmentContext: 'unspecified' });
  assert.equal(input.maximumMicrounits, '10000000'); assert.equal(input.businessId, f.catalog.businessId);
  assert.deepEqual(Object.keys(input).sort(), ['businessId', 'deadlineAt', 'maximumMicrounits', 'publicBrief', 'submissionId']);
  assert.ok(Date.parse(input.deadlineAt) > f.now + 35 * 60000);
  assert.deepEqual(h.navigation, [['push', `/dashboard/quests/research/pod?business=${id(1)}&setup=${id(4)}`], ['refresh']]);
});

test('invalid or over-limit budgets never reach preparation; explicit Printful context does', async () => {
  for (const budget of ['', '0', '-1', '+1', '1e0', '1.1234567', '10.000001', '50', 'Infinity']) {
    const h = workspace(); h.submit({ budget }); await h.settle();
    assert.equal(h.calls.length, 0, budget); assert.match(text(h.render()), /positive USD limit of at most \$10/);
  }
  const h = workspace(); h.submit({ budget: '0.500001', printful: 'on' }); await h.settle();
  assert.equal(h.calls[0].input.maximumMicrounits, '500001');
  assert.equal(h.calls[0].input.publicBrief.fulfilmentContext, 'printful_available');
});

test('permission review discloses the actual brief, recipients, retention, cumulative costs and time bounds', () => {
  const f = fixture();
  f.receipt.preview.publicBrief = { objective: OBJECTIVE, publicConstraints: ['Use aggregate adult-buyer observations only.'], fulfilmentContext: 'printful_available' };
  const h = workspace(f, { selected: f.receipt }), markup = html(h.render());
  for (const expected of [OBJECTIVE, 'Use aggregate adult-buyer observations only.', 'Printful', 'OpenRouter', 'Azure', 'Exa', 'Amazon Bedrock', 'retained public excerpts, selected evidence and assessment', 'zero-data-retention', 'Exa may retain queries', 'improve or train', 'Agent Labs retains', 'USD 0.500000', 'USD 10.000000', 'USD 0.300000', 'USD 10.100000', 'USD 0.100000', 'shared total ceiling for all five passes', 'Unused allowance carries between passes; restarting never resets the limit', 'Earlier costs stay counted', 'separately bounded pending cost stays fully reserved', '30 minutes after approval', 'another 30 minutes', 'already incurred charges remain payable', 'No refund', 'no subscription']) assert.ok(markup.includes(expected), expected);
  assert.equal(f.receipt.preview.maximumPasses, 5); assert.equal(f.receipt.preview.maximumCalls, 25); assert.equal(f.receipt.preview.maximumCollections, 5);
  assert.equal(elements(h.render(), e => e.type === 'input' && e.props.type === 'checkbox')[0].props.checked, false);
  assert.equal(button(h.render(), 'Approve and research').props.disabled, true);
  assert.equal(h.calls.length, 0, 'Reading the approval packet never confirms it');
});

test('saved approval independently discloses every pass/call/collection/receipt bound and refinement recipient', () => {
  const f = fixture(), h = workspace(f, { selected: f.receipt });
  const sections = elements(h.render(), e => e.type === 'section' && e.props['aria-label'] === 'Research permission review');
  assert.equal(sections.length, 1);
  const review = text(sections[0]), preview = f.receipt.preview;
  assert.deepEqual([preview.maximumPasses, preview.maximumCalls, preview.maximumCollections, preview.maximumReceiptChecks], [5, 25, 5, 75]);
  assert.ok(review.includes(`up to ${preview.maximumPasses} research/refinement passes inside that one total ceiling: at most ${preview.maximumCalls} model calls and ${preview.maximumCollections} searches, plus up to ${preview.maximumReceiptChecks} exact-receipt metadata checks`));
  assert.ok(review.includes('Receipt checks cannot start more generations.'));
  assert.ok(review.includes('For refinement, OpenRouter/Azure also receive the prior independent review, candidate labels, previous queries and their public-source domain history'));
  assert.ok(review.includes('Exa receives the bounded public query and domain filters.'));
  assert.ok(review.includes('Amazon Bedrock receives the brief, retained public excerpts and assessment for independent review.'));
  assert.equal(elements(h.render(), e => e.type === 'form').length, 0, 'These disclosures are present on the saved approval without the entry form');
  assert.equal(button(sections[0], 'Approve and research').props.disabled, true);
  assert.equal(h.calls.length, 0);
});

test('unchecked permission cannot invoke confirmation and approval binds exact saved identity', async () => {
  const f = fixture(), h = workspace(f, { selected: f.receipt });
  assert.equal(button(h.render(), 'Approve and research').props.disabled, true);
  // Exercise the handler too: stale/programmatic events cannot confer consent.
  button(h.render(), 'Approve and research').props.onClick(); await h.settle();
  assert.equal(h.calls.length, 0, 'An unchecked handler must not confirm or start work');
  approve(h); assert.equal(button(h.render(), 'Approve and research').props.disabled, false);
  button(h.render(), 'Approve and research').props.onClick(); await h.settle();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].name, 'confirmPodResearchAction');
  assert.deepEqual(Object.keys(h.calls[0].input).sort(), ['businessId', 'setupHash', 'setupId', 'submissionId']);
  assert.equal(h.calls[0].input.setupId, f.receipt.setupId); assert.equal(h.calls[0].input.setupHash, f.receipt.setupHash);
});

test('failed preparation recovers the same in-memory review identity without introducing a query', async () => {
  const waiting = deferred(), f = fixture(), h = workspace(f, { actions: { preparePodResearchAction: () => waiting.promise } });
  h.submit(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(button(h.render(), 'Review cost and permissions').props.disabled, true);
  waiting.resolve({ ok: false, message: 'Synthetic interrupted preparation' }); await h.settle();
  button(h.render(), 'Recover the same review').props.onClick(); await h.settle();
  assert.equal(h.calls.length, 2); assert.deepEqual(h.calls[1].input, h.calls[0].input);
  assert.equal(h.navigation.length, 0);
});

test('confirmed background-start failure preserves the exact saved run and supports explicit recovery', async () => {
  const f = fixture(); let starts = 0;
  const a = actionHarness(f, { start: async () => { starts++; if (starts === 1) throw Error('Synthetic durable workflow start unavailable'); return { runId: 'inert-recovery' }; } });
  const h = workspace(f, { selected: f.receipt, actions: a.actions });
  approve(h); button(h.render(), 'Approve and research').props.onClick(); await h.settle();
  assert.match(text(h.render()), /Approval was saved.*background run could not be verified/);
  assert.deepEqual(h.navigation, [['push', `/dashboard/quests/research/pod?business=${f.receipt.businessId}&setup=${f.receipt.setupId}`], ['refresh']]);
  assert.equal(a.calls.filter(c => c.name === 'confirmPodResearch').length, 1);
  const saved = { ...f.receipt, confirmed: true, activated: true };
  const restored = workspace(f, { selected: saved, actions: a.actions });
  assert.equal(elements(restored.render(), e => e.type === 'button' && text(e) === 'Approve and research').length, 0);
  button(restored.render(), 'Continue saved run').props.onClick(); await restored.settle();
  assert.match(text(restored.render()), /Existing requests are reconciled, never blindly resent/);
  assert.equal(a.calls.filter(c => c.name === 'confirmPodResearch').length, 1, 'Recovery reads the existing activation instead of approving again');
  const startCalls = a.calls.filter(c => c.name === 'start'); assert.equal(startCalls.length, 2);
  for (const call of startCalls) assert.deepEqual(call.args[1], [{ businessId: f.receipt.businessId, scopeId: f.receipt.scopeId }]);
  h.unmount(); restored.unmount();
});

test('resume rejects an unconfirmed or mismatched saved setup without starting a workflow', async () => {
  for (const change of [{ activated: false }, { setupId: id(99) }, { setupHash: 'f'.repeat(64) }]) {
    const f = fixture(), a = actionHarness(f, { server: { readPodResearch: async () => ({ ...f.catalog, setups: [{ ...f.receipt, activated: true, ...change }] }) } });
    assert.equal((await a.actions.resumePodResearchAction(actionInput(f))).ok, false);
    assert.equal(a.calls.filter(c => c.name === 'start').length, 0);
  }
});

test('saved running controller state does not claim a live background worker', () => {
  const f = fixture(), h = workspace(f, { selected: { ...f.receipt, activated: true, confirmed: true },
    status: { state: 'running', reason: 'scheduled', activeWindow: true, receiptUntil: null,
      phases: [{ phase: 'plan', status: 'reserved', reason: null }],
      cost: { knownMicrousd: '0', heldMicrousd: '35411', hasUnknown: false } } });
  assert.equal(text(elements(h.render(), e => e.type === 'h3')[0]), 'Saved progress');
  assert.match(text(h.render()), /Last saved controller state: running/);
  assert.match(text(h.render()), /does not verify that the background worker is still running/);
  assert.match(text(h.render()), /Held: USD 0.035411/);
  assert.equal(h.calls.length, 0);
  h.unmount();
});

test('controller timeout diagnostics never disclose database details or authority arguments', async () => {
  for (const [code, expected] of [['57014', 'quest_controller_statement_cancelled'], ['P0001', 'quest_controller_transition_unverified']]) {
    const controller = source('lib/quest-controller-runtime', { './supabase/runtime': {
      createRuntimeClient: () => ({ rpc: async () => ({ data: null, error: { code, message: 'inert-sensitive-database-detail', details: 'inert-authority-argument' } }) }) } });
    const store = controller.createQuestControllerStore(id(1), id(2), { controllerKey: 'inert-controller-key', admissionKey: 'inert-admission-key' });
    await assert.rejects(store.command('claim', { seconds: 60 }), error => error.message === expected);
  }
});

test('durable step exposes only the allowlisted timeout reason and never retries a failed effect', async () => {
  class FatalError extends Error {}
  for (const [input, prefix] of [['quest_controller_statement_cancelled', 'Database statement was cancelled or timed out. '], ['inert-sensitive-database-detail', '']]) {
    let calls = 0;
    const runtime = source('workflows/pod-research-runtime-steps', { workflow: { FatalError },
      '../products/discovery-r12-server': { continuePodResearchRuntime: async () => { calls++; throw Error(input); } } });
    await assert.rejects(runtime.executePodResearchStep({ businessId: id(1), scopeId: id(2) }), error =>
      error instanceof FatalError && error.message === `${prefix}Research paused. Reconcile the existing attempt and cost before continuing; no replacement call was started.`);
    assert.equal(calls, 1); assert.equal(runtime.executePodResearchStep.maxRetries, 0);
  }
});

test('Stop invokes only exact saved setup and retains unknown held costs with receipt-only recovery', async () => {
  const f = fixture(), a = actionHarness(f), receipt = { ...f.receipt, confirmed: true, activated: true };
  const status = { state: 'waiting', reason: 'receipt_pending', activeWindow: true, receiptUntil: null, phases: PHASES.map(phase => ({ phase, status: 'pending', reason: null })), cost: { knownMicrousd: '100000', heldMicrousd: '200000', hasUnknown: true } };
  const h = workspace(f, { selected: receipt, status, actions: a.actions });
  button(h.render(), 'Stop research').props.onClick(); await h.settle();
  assert.equal(a.calls.filter(c => c.name === 'start').length, 0);
  const stop = a.calls.find(c => c.name === 'stopPodResearch'); assert.equal(stop.args[1].setupId, receipt.setupId); assert.equal(stop.args[1].setupHash, receipt.setupHash);
  assert.match(text(h.render()), /Stopped. Existing receipts and costs remain available/);
  const stopped = workspace(f, { selected: { ...receipt, stopped: true }, status: { ...status, state: 'stopped' } });
  assert.match(text(stopped.render()), /Known cost: USD 0.100000.*Held: USD 0.200000.*Exact receipt unresolved/);
  assert.equal(elements(stopped.render(), e => e.type === 'button' && text(e) === 'Stop research').length, 0);
  button(stopped.render(), 'Reconcile existing receipt').props.onClick(); await stopped.settle();
  assert.equal(stopped.calls[0].name, 'resumePodResearchAction');
  assert.equal(h.intervals.size, 1); h.unmount(); assert.equal(h.intervals.size, 0); stopped.unmount();
});

function sourcedResult(f, passNumber = 5) {
  return {
    planId: id(70), passNumber, maximumPasses: 5, priorReviewHash: passNumber === 1 ? null : 'e'.repeat(64), historyOnly: true,
    reviewedAt: new Date(f.now).toISOString(), sourceScopeExpiresAt: new Date(f.now + 1800000).toISOString(),
    review: { outcome: 'INSUFFICIENT_EVIDENCE', candidateIndex: null, checks: [{ check: 'claim_support', verdict: 'FAIL', rationale: 'The synthetic excerpt does not support a demand claim.', evidence: ['E1'] }], rationale: 'Synthetic evidence cannot establish buyer demand or margin.', nextTest: 'Measure buyer intent and current delivered costs.', missingEvidence: ['Representative buyer intent remains unmeasured.'] },
    assessment: { explorationSummary: 'A technical rendering fixture, not market evidence.', candidates: [{ productType: 'Exploratory printed object', niche: 'An unproven niche', audience: 'An aggregate adult audience', rationale: 'The retained excerpt supports a question, not a sales claim.', support: [], counterevidence: ['E1'], alternativeExplanation: 'General interest may never convert into purchases.', dimensions: [{ dimension: 'buyer_demand', verdict: 'uncertain', rationale: 'No measured sales.', evidence: ['E1'], missing: ['Current margins unknown.'] }] }] },
    evidence: [{ key: 'E1', url: 'https://census.gov/inert-fixture', title: 'Synthetic attributed source', quote: 'This inert excerpt does not establish demand for an Etsy product.', retrievedAt: new Date(f.now).toISOString() }],
    evidenceLimitations: ['This technical fixture contains no real customer or sales evidence.'], submittedQuery: 'An inert planner-selected public question about print-on-demand products.', sourceChoiceRationale: 'Primary aggregate observations and official production constraints.',
    phaseReceipts: PHASES.map((phase, i) => ({ phase, executingRelease: { commitSha: String(i + 1).repeat(40), deploymentId: `dpl_inert_${phase}` }, providerRequestId: `inert-receipt-${phase}` })),
  };
}

test('sourced insufficient result renders attributable evidence, caveats and five exact release receipts', () => {
  const f = fixture(), result = sourcedResult(f);
  const h = workspace(f, { selected: { ...f.receipt, confirmed: true, activated: true }, result }), markup = html(h.render());
  for (const expected of ['The evidence is not yet sufficient', 'Research pass 5 of 5', 'Earlier passes remain saved as audit evidence', result.review.rationale, result.review.nextTest, result.evidence[0].quote, 'publication date not verified', result.review.missingEvidence[0], result.evidenceLimitations[0], result.submittedQuery, result.sourceChoiceRationale, 'Alternative explanation', 'Supporting evidence: None', 'Contrary evidence: E1', 'claim support', 'The synthetic excerpt does not support a demand claim.']) assert.ok(markup.includes(expected), expected);
  assert.match(markup, /href="https:\/\/census.gov\/inert-fixture" target="_blank" rel="noreferrer"/);
  for (const receipt of result.phaseReceipts) { assert.ok(markup.includes(receipt.providerRequestId)); assert.ok(markup.includes(receipt.executingRelease.deploymentId)); }
  assert.equal(elements(h.render(), e => e.type === 'button' && /Continue|Approve/.test(text(e))).length, 0);
  assert.equal(h.calls.length, 0); assert.equal(h.intervals.size, 0); h.unmount();
});

test('an intermediate insufficient pass keeps polling and exact saved-run recovery until terminal review', async () => {
  const f = fixture(), result = sourcedResult(f, 1);
  const status = { state: 'waiting', reason: 'continue_saved_progress', activeWindow: true, receiptUntil: null, phases: PHASES.map(phase => ({ phase, status: 'completed', reason: null })), cost: { knownMicrousd: '100000', heldMicrousd: '0', hasUnknown: false } };
  const h = workspace(f, { selected: { ...f.receipt, confirmed: true, activated: true }, status, result });
  assert.match(text(h.render()), /Research pass 1 of 5/);
  assert.equal(h.intervals.size, 1);
  [...h.intervals.values()][0]();
  assert.deepEqual(h.navigation, [['refresh']]);
  button(h.render(), 'Continue saved run').props.onClick(); await h.settle();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].name, 'resumePodResearchAction');
  assert.equal(h.calls[0].input.setupId, f.receipt.setupId); assert.equal(h.calls[0].input.setupHash, f.receipt.setupHash);
  h.render({ result: sourcedResult(f), status: null });
  assert.equal(h.intervals.size, 0, 'The last allowed review stops polling even when separate progress is unavailable');
  assert.equal(elements(h.render(), e => e.type === 'button' && text(e) === 'Continue saved run').length, 0);
  h.unmount();
});

test('a reviewed hypothesis result ends polling before the fifth pass', () => {
  const f = fixture(), result = sourcedResult(f, 2);
  result.review = { ...result.review, outcome: 'HYPOTHESIS_TO_TEST', candidateIndex: 0, checks: [{ check: 'claim_support', verdict: 'PASS', rationale: 'This synthetic result labels an unvalidated hypothesis for a next test.', evidence: ['E1'] }] };
  const h = workspace(f, { selected: { ...f.receipt, confirmed: true, activated: true }, result });
  assert.match(text(h.render()), /A hypothesis worth testing/);
  assert.equal(h.intervals.size, 0);
  assert.equal(elements(h.render(), e => e.type === 'button' && text(e) === 'Continue saved run').length, 0);
  h.unmount();
});

function prepareBoundary(f, { lostReply = false } = {}) {
  const submissions = new Map(), transitions = new Map(); let saved = null, failed = false, quoteCount = 0;
  const h = serverHarness(f, { quote: () => ({ ...f.quote, maximumMicrousd: ++quoteCount === 1 ? 500000 : 700000 }), rpc: async (name, args) => {
    if (name === 'r12_pod_research_read') { assert.equal(args.p_submission_id, f.entry.submissionId); return { error: null, data: { ...f.catalog, finance: { ...f.catalog.finance, ...(saved ? { committedMicrounits: '200000' } : {}) }, setups: saved ? [saved] : [] } }; }
    if (name === 'r04_quest_transition') {
      const key = args.p_submission_id, old = transitions.get(key);
      if (old) assert.deepEqual(old, args, 'Replayed R04 intent must preserve content and deadline'); else transitions.set(key, structuredClone(args));
      return { error: null, data: { id: f.receipt.goalId, revision: args.p_operation === 'quest.save' ? 1 : 2 } };
    }
    assert.equal(name, 'r12_pod_owner_server'); assert.equal(args.p_operation, 'prepare');
    const { input } = args.p_payload, old = submissions.get(input.submissionId);
    // Mirrors only the SQL submission input check; SQL/race proof lives in its own suite.
    if (old && JSON.stringify(old) !== JSON.stringify(input)) return { data: null, error: { message: 'r12_pod_idempotency_conflict' } };
    if (!old) { submissions.set(input.submissionId, structuredClone(input)); saved = structuredClone(f.receipt); }
    if (lostReply && !failed) { failed = true; return { data: null, error: { message: 'Synthetic response lost after save' } }; }
    return { error: null, data: structuredClone(saved) };
  } });
  return { ...h, transitions, submissions, get saved() { return saved; } };
}

test('actual owner prepare saves broad R04 intent and a proposal without country, query or runtime authority', async () => {
  const f = fixture(), h = prepareBoundary(f);
  const receipt = await h.server.preparePodResearch(h.context, f.entry);
  assert.equal(receipt.setupId, f.receipt.setupId); assert.equal(receipt.activated, false);
  const save = h.calls.find(c => c.name === 'r04_quest_transition' && c.args.p_operation === 'quest.save').args.p_payload;
  assert.equal(save.goalId, null); assert.equal(save.content.objective, OBJECTIVE); assert.equal(save.content.originalIntent, OBJECTIVE);
  assert.equal(save.content.parsed.target, null); assert.deepEqual(save.content.parsed.geography, []);
  assert.equal(save.content.parsed.researchMode, 'r12.pod-research-intent.1');
  const prepare = h.calls.find(c => c.name === 'r12_pod_owner_server');
  assert.equal(prepare.args.p_payload.input.maximumMicrounits, '10000000');
  assert.equal(prepare.args.p_payload.input.businessLifetimeLimitMicrounits, '10100000');
  assert.deepEqual(prepare.args.p_payload.input.publicBrief, f.entry.publicBrief);
  assert.doesNotMatch(JSON.stringify(prepare.args.p_payload.input), /sourceDomains|audience|countryCode|approvedQuery|topicKey/);
  assert.equal(h.transitions.size, 2); assert.equal(h.submissions.size, 1);
});

test('actual owner prepare recovers a saved submission after lost reply despite a changed quote and ledger', async () => {
  const f = fixture(), h = prepareBoundary(f, { lostReply: true });
  await assert.rejects(h.server.preparePodResearch(h.context, f.entry), /Synthetic response lost after save/);
  assert.ok(h.saved); assert.equal(h.submissions.size, 1);
  const recovered = await h.server.preparePodResearch(h.context, structuredClone(f.entry));
  assert.deepEqual(recovered, h.saved); assert.equal(h.submissions.size, 1); assert.equal(h.transitions.size, 2);
  assert.equal(h.calls.filter(c => c.name === 'quote').length, 1, 'Recovery of a saved packet must not substitute a new quote');
});

test('actual owner prepare blocks an unresolved liability before intent save or quote', async () => {
  const f = fixture({ finance: { hasUnknown: true, hasBlockingUnknown: true, pendingMicrounits: '200000' } });
  const view = workspace(f);
  assert.equal(button(view.render(), 'Review cost and permissions').props.disabled, true);
  assert.match(text(view.render()), /An earlier charge is unresolved.*USD 0.200000 remains held.*proven bound or exact reconciliation/);
  const h = prepareBoundary(f);
  await assert.rejects(h.server.preparePodResearch(h.context, f.entry), /unresolved_liability/);
  assert.equal(h.transitions.size, 0); assert.equal(h.submissions.size, 0); assert.equal(h.calls.filter(c => c.name === 'quote').length, 0);
});

test('a separately bounded historical unknown remains reserved and truthful without blocking a new total budget', async () => {
  const f = fixture({ finance: { hasUnknown: true, hasBlockingUnknown: false, pendingMicrounits: '200000', boundedPendingMicrounits: '200000', committedMicrounits: '300000', proposedBusinessLimitMicrounits: '10300000' } });
  const view = workspace(f);
  assert.equal(button(view.render(), 'Review cost and permissions').props.disabled, false);
  assert.equal(view.calls.length, 0, 'A bounded reserve alone never authorizes new spending');
  const h = prepareBoundary(f), receipt = await h.server.preparePodResearch(h.context, f.entry);
  const prepare = h.calls.find(c => c.name === 'r12_pod_owner_server');
  assert.equal(prepare.args.p_payload.input.maximumMicrounits, '10000000');
  assert.equal(prepare.args.p_payload.input.businessLifetimeLimitMicrounits, '10300000', 'The new USD 10 limit is added to all existing committed exposure');
  assert.equal(receipt.preview.finance.hasUnknown, true);
  assert.equal(receipt.preview.finance.hasBlockingUnknown, false);
  assert.equal(receipt.preview.finance.boundedPendingMicrounits, '200000');
  assert.equal(receipt.preview.finance.pendingMicrounits, '200000');
  assert.equal(receipt.confirmed, false); assert.equal(receipt.activated, false);
  const review = workspace(f, { selected: receipt });
  assert.match(text(review.render()), /already committed: USD 0.300000.*separately bounded pending cost stays fully reserved: USD 0.200000/);
  assert.equal(button(review.render(), 'Approve and research').props.disabled, true);
});

test('server rejects a total over USD 10 before quote, intent creation or saved preparation', async () => {
  for (const maximumMicrounits of ['0', '-1', '10000001', '50000000', '10.000000']) {
    const f = fixture(), h = prepareBoundary(f);
    await assert.rejects(h.server.preparePodResearch(h.context, { ...f.entry, maximumMicrounits }), /r12_pod_owner_result_unverified/);
    assert.equal(h.transitions.size, 0); assert.equal(h.submissions.size, 0); assert.equal(h.calls.filter(c => c.name === 'quote').length, 0);
  }
});

test('catalog must provide explicit valid blocking and bounded-pending fields before new spending review', async () => {
  for (const change of [
    finance => { delete finance.hasBlockingUnknown; },
    finance => { finance.hasBlockingUnknown = 'false'; },
    finance => { delete finance.boundedPendingMicrounits; },
    finance => { finance.boundedPendingMicrounits = '-1'; },
    finance => { finance.boundedPendingMicrounits = 0; },
  ]) {
    const f = fixture(); change(f.catalog.finance); const h = prepareBoundary(f);
    await assert.rejects(h.server.preparePodResearch(h.context, f.entry), /r12_pod_owner_result_unverified/);
    assert.equal(h.transitions.size, 0); assert.equal(h.submissions.size, 0); assert.equal(h.calls.filter(c => c.name === 'quote').length, 0);
  }
});

test('saved owner contracts reject old approval formats and substituted pass bounds even with a matching hash', () => {
  const { parsePodReceipt, parsePodCatalog } = source('products/discovery-r12-pod-owner-contract');
  const hash = source('products/discovery-v2-hash').discoveryV2Hash;
  const f = fixture();
  assert.deepEqual(parsePodReceipt(f.receipt, f.receipt.businessId, f.receipt.setupId), f.receipt);
  assert.deepEqual(parsePodCatalog(f.catalog, f.catalog.businessId), f.catalog);
  for (const change of [
    receipt => { receipt.version = 'r12.pod-setup-receipt.1'; },
    receipt => { receipt.preview.version = 'r12.pod-research-preview.1'; },
    receipt => { receipt.preview.maximumPasses = 6; },
    receipt => { delete receipt.preview.maximumPasses; },
    receipt => { receipt.preview.maximumCalls = 5; },
    receipt => { receipt.preview.maximumCalls = 26; },
    receipt => { receipt.preview.maximumCollections = 1; },
    receipt => { receipt.preview.maximumCollections = 6; },
    receipt => { receipt.preview.maximumRepairs = 1; },
    receipt => { receipt.preview.maximumReceiptChecks = 15; },
    receipt => { receipt.preview.maximumReceiptChecks = 76; },
  ]) {
    const receipt = structuredClone(f.receipt); change(receipt); receipt.setupHash = hash(receipt.preview);
    assert.throws(() => parsePodReceipt(receipt, receipt.businessId, receipt.setupId), /r12_pod_owner_result_unverified/);
  }
  assert.throws(() => parsePodCatalog({ ...f.catalog, version: 'r12.pod-catalog.1' }, f.catalog.businessId), /r12_pod_owner_result_unverified/);
});

test('saved prepare recovery does not depend on new-run eligibility or a still-current request window', async () => {
  const f = fixture(), h = prepareBoundary(f);
  await h.server.preparePodResearch(h.context, f.entry);
  f.catalog.business.ready = false; f.catalog.template = null; f.catalog.finance.hasUnknown = true; f.catalog.finance.hasBlockingUnknown = true;
  const recovered = await h.server.preparePodResearch(h.context, { ...f.entry, deadlineAt: new Date(f.now - 60000).toISOString() });
  assert.deepEqual(recovered, h.saved); assert.equal(h.calls.filter(c => c.name === 'quote').length, 1);
  assert.equal(h.transitions.size, 2); assert.equal(h.submissions.size, 1);
});

test('saved submission cannot be reused with a substituted public brief, fulfilment context, constraints or budget', async () => {
  for (const change of [
    entry => { entry.publicBrief.objective = 'Research different viable print-on-demand products for a different purpose.'; },
    entry => { entry.publicBrief.fulfilmentContext = 'printful_available'; },
    entry => { entry.publicBrief.publicConstraints = ['Use aggregate adult-buyer observations only.']; },
    entry => { entry.maximumMicrounits = '2000000'; },
  ]) {
    const f = fixture(), h = prepareBoundary(f); await h.server.preparePodResearch(h.context, f.entry);
    const changed = structuredClone(f.entry); change(changed);
    await assert.rejects(h.server.preparePodResearch(h.context, changed), /r12_pod_owner_result_unverified/);
    assert.equal(h.calls.filter(c => c.name === 'quote').length, 1); assert.equal(h.submissions.size, 1);
  }
});

function routeHarness(f = fixture(), { catalog = f.catalog, progress, result = null, failResult = false } = {}) {
  const calls = [], context = { userId: id(90), businesses: [{ id: f.catalog.businessId, name: 'Inert Business' }], supabase: { rpc: async (name, args) => { calls.push({ name, args }); return progress ?? { error: null, data: { businessId: f.catalog.businessId, scopeId: f.receipt.scopeId, state: 'waiting', reason: 'receipt_pending', activeWindow: true, receiptUntil: null, phases: [], cost: { knownMicrousd: '0', heldMicrousd: '100000', hasUnknown: true } } }; } } };
  const page = source('app/dashboard/quests/research/pod/page.tsx', {
    'next/navigation': { notFound() { throw Error('not found'); }, useRouter: () => ({}) },
    '@/components/console/console-shell': { ConsoleShell: ({ children }) => React.createElement('main', null, children) },
    '@/lib/core-ui/data': { requireOwnerUiContext: async () => context },
    '@/app/dashboard/quests/research/pod/actions': {},
    '@/products/discovery-r12-pod-owner-server': {
      readPodResearch: async (...args) => { calls.push({ name: 'readPodResearch', args }); if (!catalog) throw Error('Synthetic catalog unavailable'); return catalog; },
      readPodResearchResult: async (...args) => { calls.push({ name: 'readPodResearchResult', args }); if (failResult) throw Error('Synthetic exact result unavailable'); return result; },
    },
  }).default;
  return { calls, async render(query = {}) { return html(await page({ searchParams: Promise.resolve(query) })); } };
}

test('new owner page selects a real Business before the general goal and never reads a guessed setup', async () => {
  const f = fixture(), h = routeHarness(f);
  const first = await h.render();
  assert.match(first, /<select name="business" required=""><option value="" disabled="" selected="">Choose a Business/);
  assert.match(first, /Inert Business/); assert.doesNotMatch(first, /<textarea|<input[^>]*(uuid|setup|scope)/i);
  assert.equal(h.calls.length, 0);
  const selected = await h.render({ business: f.catalog.businessId });
  assert.match(selected, /Research goal<textarea name="objective"/);
  assert.ok(selected.includes(OBJECTIVE)); assert.match(selected, /Total limit for up to five research passes/);
  assert.deepEqual(h.calls.map(call => [call.name, call.args.slice(1)]), [['readPodResearch', [f.catalog.businessId, null]]]);
  for (const query of [{ setup: f.receipt.setupId }, { business: 'invalid' }, { business: [f.catalog.businessId] }, { business: f.catalog.businessId, setup: ['invalid'] }]) await assert.rejects(h.render(query), /not found/);
});

test('exact setup route refuses missing receipts instead of falling back to another saved run', async () => {
  const f = fixture(); f.catalog.setups = [f.receipt];
  const h = routeHarness(f), missing = await h.render({ business: f.catalog.businessId, setup: id(999) });
  assert.match(missing, /This research record could not be verified/);
  assert.doesNotMatch(missing, /Approve and research|Review cost and permissions|Stop research/);
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].args[2], id(999));
  const exact = await h.render({ business: f.catalog.businessId, setup: f.receipt.setupId });
  assert.match(exact, /Research permission review/); assert.match(exact, /Approve and research/);
});

test('unverifiable saved progress or result is visible without hiding Stop or asserting completion', async () => {
  const f = fixture(); f.catalog.setups = [{ ...f.receipt, confirmed: true, activated: true }];
  for (const failure of [{ progress: { error: null, data: { businessId: id(999), scopeId: f.receipt.scopeId, phases: [], cost: {} } } }, { failResult: true }]) {
    const h = routeHarness(f, failure), markup = await h.render({ business: f.catalog.businessId, setup: f.receipt.setupId });
    assert.match(markup, /Saved progress or the completed result could not be verified. No completion is assumed/);
    assert.match(markup, /Stop research/); assert.match(markup, /Continue saved run/);
    assert.doesNotMatch(markup, /Sourced research result|A hypothesis worth testing|The evidence is not yet sufficient/);
    const read = h.calls.find(c => c.name === 'r12_discovery_owner_read');
    assert.deepEqual(read.args, { p_business_id: f.receipt.businessId, p_scope_id: f.receipt.scopeId, p_activation: false });
  }
});

test('owner-verified release GET exposes only nonsecret hashes and exact release pins without creating authority', async () => {
  const h = releaseRouteHarness(), response = await h.get(), body = await response.json();
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Object.keys(body).sort(), ['applicationCapabilityHash', 'authorityCreated', 'businessId', 'executingRelease', 'packs', 'schemas', 'version']);
  assert.equal(body.version, 'r12.pod-application-verifier.1'); assert.equal(body.businessId, id(1)); assert.equal(body.authorityCreated, false);
  const rawCapability = createHmac('sha256', h.fixtureEnv.R05_ADMISSION_SERVER_KEY).update('r12.pod-owner-application.1').digest('base64url');
  assert.equal(body.applicationCapabilityHash, createHash('sha256').update(rawCapability).digest('hex'));
  assert.deepEqual(body.executingRelease, { version: 'r12.executing-release.1', repository: 'SSB100/agent-labs', environment: 'production', commitSha: h.fixtureEnv.VERCEL_GIT_COMMIT_SHA, deploymentId: h.fixtureEnv.VERCEL_DEPLOYMENT_ID });
  assert.deepEqual(body.schemas, h.expectedSchemas()); assert.deepEqual(body.packs, h.expectedPacks());
  assert.ok(body.packs.length > 0); for (const pack of body.packs) { assert.deepEqual(Object.keys(pack).sort(), ['manifestHash', 'packKey', 'version']); assert.match(pack.manifestHash, /^[a-f0-9]{64}$/); }
  const serialized = JSON.stringify(body); assert.equal(serialized.includes(h.fixtureEnv.R05_ADMISSION_SERVER_KEY), false); assert.equal(serialized.includes(rawCapability), false);
  assert.deepEqual(h.calls, [['createClient'], ['getClaims'], ['from', 'businesses'], ['select', 'id'], ['eq', 'id', id(1)], ['eq', 'owner_user_id', id(90)], ['maybeSingle'], ['capability'], ['release'], ['schemas'], ['packs']]);
});

test('release GET denies malformed Business, absent authentication and unverified ownership before exposing metadata', async () => {
  for (const { options, businessId } of [
    { options: {}, businessId: null }, { options: {}, businessId: 'invalid-business' },
    { options: { owner: null } }, { options: { owner: 'not-an-owner-id' } },
    { options: { claimsError: { message: 'Synthetic claims unavailable' } } },
    { options: { owner: id(91), business: null } }, { options: { business: { id: id(999) } } },
    { options: { businessError: { message: 'Synthetic owner lookup unavailable' } } },
  ]) {
    const h = releaseRouteHarness(options), response = await h.get(businessId), body = await response.json();
    assert.equal(response.status, 403); assert.equal(response.headers.get('cache-control'), 'no-store'); assert.deepEqual(body, { available: false });
    assert.equal(h.calls.some(([name]) => ['capability', 'release', 'schemas', 'packs'].includes(name)), false, 'No verifier or source metadata is exposed before ownership is verified');
    if (options.owner === id(91)) assert.ok(h.calls.some(call => call[0] === 'eq' && call[1] === 'owner_user_id' && call[2] === id(91)), 'Ownership uses the authenticated principal, never the requested Business alone');
  }
});

test('release GET fails closed with no-store when existing production key or deployment identity is unavailable', async () => {
  for (const env of [
    { R05_ADMISSION_SERVER_KEY: undefined }, { R05_ADMISSION_SERVER_KEY: 'too-short' },
    { VERCEL_ENV: 'preview' }, { VERCEL_GIT_COMMIT_SHA: undefined }, { VERCEL_GIT_COMMIT_SHA: 'invalid' },
    { VERCEL_DEPLOYMENT_ID: undefined },
  ]) {
    const h = releaseRouteHarness({ env }), response = await h.get();
    assert.equal(response.status, 503); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { available: false }, 'Missing config never serializes a key, exception, partial verifier or authority claim');
    assert.equal(h.calls.some(([name]) => name === 'schemas' || name === 'packs'), false);
  }
});
