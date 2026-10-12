// Current-source owner recovery contracts with inert boundaries only.
// No browser, database, workflow, provider request, grant or live market evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, source, id, PHASES, workspace, elements, button, text, deferred, actionHarness, serverHarness, releaseRouteHarness } from './helpers/r12-pod-owner-ui-fixture.mjs';

const hash = source('products/discovery-v2-hash').discoveryV2Hash;
const { parsePodReceipt, parsePodCatalog } = source('products/discovery-r12-pod-owner-contract');
const inputFor = receipt => ({ businessId: receipt.businessId, setupId: receipt.setupId, setupHash: receipt.setupHash, submissionId: id(80), approveGoalDeadlineRevision: true });
const buttons = h => elements(h.render(), e => e.type === 'button').map(text);
const approve = h => {
  const checkbox = elements(h.render(), e => e.type === 'input' && e.props.type === 'checkbox')[0];
  assert.ok(checkbox); checkbox.props.onChange({ target: { checked: true } });
};
function recoveryFixture() {
  const f = fixture({ finance: { maximumMicrounits: '10000000', committedMicrounits: '28912', proposedBusinessLimitMicrounits: '10000000' } });
  const predecessor = { ...structuredClone(f.receipt), confirmed: true, activated: true, stopped: true };
  const proof = {
    version: 'r12.pod-recovery-proof.1', businessId: predecessor.businessId, goalId: predecessor.goalId,
    predecessorSetupId: predecessor.setupId, predecessorScopeId: predecessor.scopeId,
    predecessorPlanId: id(30), predecessorPlanHash: '3'.repeat(64), predecessorPlanVersion: 1,
    failedAttemptId: id(35), observationHash: '4'.repeat(64), diagnosticHash: '5'.repeat(64),
    dependencyPins: PHASES.slice(0, 4).map((phase, index) => ({ phase, attemptId: id(31 + index), responseHash: String(index + 1).repeat(64), candidateHash: String(index + 5).repeat(64) })),
    historyHash: '6'.repeat(64), headRevision: 12, baseChildren: 5, baseDispatches: 5, baseRepairs: 0, basePivots: 0,
    usedPasses: 1, usedCalls: 5, usedSearches: 1, spentMicrounits: '28912', originalMaximumMicrounits: '10000000', remainingMaximumMicrounits: '9971088',
    originalDeadline: new Date(f.now - 60000).toISOString(), sourcePolicyHash: predecessor.preview.sourcePolicyHash, publicBriefHash: hash(predecessor.preview.publicBrief),
  };
  const successor = structuredClone(f.receipt);
  Object.assign(successor, { setupId: id(14), scopeId: id(15), policyId: id(16), submissionId: id(80) });
  successor.preview.finance.runLimitMicrounits = '9971088';
  successor.preview.recovery = { version: 'r12.pod-next-pass-recovery.1', proof, proofHash: hash(proof), historyHash: proof.historyHash, classificationHash: '7'.repeat(64), originalReviewAccepted: false };
  successor.setupHash = hash(successor.preview);
  const status = {
    state: 'stopped', reason: 'owner_stopped', activeWindow: false, receiptUntil: proof.originalDeadline,
    phases: PHASES.map(phase => ({ phase, status: phase === 'review' ? 'dispatched' : 'completed', reason: null,
      ...(phase === 'review' ? { responseDiagnostic: { code: 'response_schema', observationSaved: true, issues: [{ path: '$.nextTest', constraint: 'max_length', limit: 400 }] } } : {}) })),
    cost: { knownMicrousd: '28912', heldMicrousd: '0', hasUnknown: false },
  };
  f.catalog.setups = [predecessor];
  return { f, predecessor, successor, status };
}

test('stopped rejected reviewer offers an explicit recovery review without blind Continue or automatic work', () => {
  const { f, predecessor, status } = recoveryFixture(), h = workspace(f, { selected: predecessor, status });
  const view = text(h.render());
  assert.match(view, /Stopped/);
  assert.match(view, /no accepted independent review yet/);
  assert.match(view, /Independent review: Response rejected; no accepted output/);
  assert.match(view, /Known cost: USD 0\.028912/);
  assert.match(view, /saves a new deadline-only version of this same Goal/);
  assert.match(view, /approve the new spending permission separately/);
  assert.deepEqual(buttons(h), ['Reconcile existing receipt', 'Review next-pass recovery']);
  assert.doesNotMatch(view, /Continue saved run|Last saved controller state|Research result/);
  assert.equal(h.calls.length, 0); assert.equal(h.intervals.size, 0);
  h.unmount();
});

test('review next-pass recovery shows original and carried-forward limits before explicit ordinary Workflow confirmation', async () => {
  const { f, predecessor, successor, status } = recoveryFixture(), before = structuredClone(predecessor);
  let prepared = null, confirmed = null;
  const a = actionHarness(f, { server: {
    preparePodResearchRecovery: async (_context, input) => {
      assert.equal(input.setupId, predecessor.setupId); assert.equal(input.setupHash, predecessor.setupHash);
      assert.equal(input.approveGoalDeadlineRevision, true);
      prepared = { ...structuredClone(successor), submissionId: input.submissionId };
      return prepared;
    },
    confirmPodResearch: async (_context, input) => {
      assert.equal(input.setupId, prepared.setupId); assert.equal(input.setupHash, prepared.setupHash);
      confirmed = { ...structuredClone(prepared), confirmed: true, activated: true };
      return confirmed;
    },
  } });
  const h = workspace(f, { selected: predecessor, status, actions: a.actions });
  button(h.render(), 'Review next-pass recovery').props.onClick(); await h.settle();
  assert.deepEqual(a.calls.map(c => c.name), ['auth', 'preparePodResearchRecovery']);
  assert.equal(prepared.confirmed, false); assert.equal(prepared.activated, false);
  assert.deepEqual(h.navigation, [['push', `/dashboard/quests/research/pod?business=${successor.businessId}&setup=${successor.setupId}`], ['refresh']]);
  h.render({ selected: prepared, status: null });
  const review = text(h.render());
  for (const expected of [
    'Original total ceiling: USD 10.000000', 'Already spent: USD 0.028912', 'at most USD 9.971088 more',
    'Already used: 1 research passes, 5 provider calls and 1 searches', 'Remaining: at most 4 complete passes, 20 calls and 4 searches',
    'up to 4 research/refinement passes', 'at most 20 model calls and 4 searches', '60 exact-receipt metadata checks',
    'Reloading or stopping cannot reset these totals', 'reviewer response remains rejected', 'fresh independent review is required',
    'No paid formatting correction is included', 'earlier permission stays stopped', 'deadline stays recorded',
    'retained public evidence, accepted assessment and explicitly rejected, untrusted reviewer critique',
    'OpenRouter', 'Azure', 'Exa', 'Amazon Bedrock', 'no subscription',
  ]) assert.ok(review.includes(expected), expected);
  const originalLink = elements(h.render(), e => e.type === 'a' && text(e) === 'View the original stopped pass')[0];
  assert.equal(originalLink.props.href, `/dashboard/quests/research/pod?business=${predecessor.businessId}&setup=${predecessor.setupId}`);
  assert.equal(button(h.render(), 'Approve and research').props.disabled, true);
  button(h.render(), 'Approve and research').props.onClick(); await h.settle();
  assert.equal(a.calls.filter(c => c.name === 'start').length, 0, 'Preparing or programmatically clicking an unchecked review creates no runtime');
  approve(h); button(h.render(), 'Approve and research').props.onClick(); await h.settle();
  assert.deepEqual(a.calls.map(c => c.name), ['auth', 'preparePodResearchRecovery', 'auth', 'confirmPodResearch', 'start']);
  assert.deepEqual(a.calls.find(c => c.name === 'start').args[1], [{ businessId: successor.businessId, scopeId: successor.scopeId }]);
  assert.equal(confirmed.confirmed, true); assert.equal(confirmed.activated, true);
  assert.deepEqual(predecessor, before, 'The original receipt, failure accounting and stopped state are immutable in this journey');
  assert.equal(confirmed.goalId, predecessor.goalId); assert.notEqual(confirmed.scopeId, predecessor.scopeId);
  assert.equal(confirmed.preview.recovery.originalReviewAccepted, false);
  assert.deepEqual(parsePodReceipt(confirmed, confirmed.businessId, confirmed.setupId), confirmed);
  h.unmount();
});

test('double-click and lost preparation response retain one recovery submission identity', async () => {
  const { f, predecessor, successor, status } = recoveryFixture(), waiting = deferred();
  let completed = false;
  const h = workspace(f, { selected: predecessor, status, actions: { preparePodResearchRecoveryAction: input => completed
    ? { ok: true, receipt: { ...successor, submissionId: input.submissionId } }
    : waiting.promise } });
  const click = button(h.render(), 'Review next-pass recovery').props.onClick;
  click(); click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(button(h.render(), 'Review next-pass recovery').props.disabled, true);
  waiting.resolve({ ok: false, message: 'Synthetic lost preparation response; reload or retry this saved request.' });
  await h.settle();
  assert.equal(h.navigation.length, 0);
  completed = true;
  button(h.render(), 'Review next-pass recovery').props.onClick(); await h.settle();
  assert.ok(h.calls.length >= 2);
  for (const call of h.calls) {
    assert.equal(call.name, 'preparePodResearchRecoveryAction');
    assert.deepEqual(call.input, h.calls[0].input, 'A repeated click or lost-response retry must reuse the exact predecessor and submission identity');
  }
  assert.equal(new Set(h.calls.map(c => c.input.submissionId)).size, 1);
  assert.equal(h.navigation.filter(([kind]) => kind === 'push').length, 1);
  h.unmount();
});

test('reload of a saved recovery preserves used allowance and still requires unchecked confirmation', () => {
  const { f, predecessor, successor } = recoveryFixture();
  const before = structuredClone(successor), h = workspace(f, { selected: successor });
  assert.equal(button(h.render(), 'Approve and research').props.disabled, true);
  assert.match(text(h.render()), /Original total ceiling: USD 10\.000000.*Already spent: USD 0\.028912.*at most USD 9\.971088 more/);
  assert.match(text(h.render()), /Remaining: at most 4 complete passes, 20 calls and 4 searches/);
  assert.equal(h.calls.length, 0); assert.deepEqual(successor, before); assert.equal(predecessor.stopped, true);
  assert.equal(buttons(h).includes('Review next-pass recovery'), false, 'A saved successor is not a new recovery entry point');
  h.unmount();
});

test('a full reload after lost response restores the persisted request instead of generating another submission', async () => {
  const { f, predecessor, successor, status } = recoveryFixture(), storage = new Map();
  const first = workspace(f, { selected: predecessor, status, storage, uuidStart: 100,
    actions: { preparePodResearchRecoveryAction: async () => ({ ok: false, message: 'Synthetic saved proposal with lost response.' }) } });
  button(first.render(), 'Review next-pass recovery').props.onClick(); await first.settle();
  const savedInput = first.calls[0].input;
  assert.equal(savedInput.submissionId, id(101)); assert.equal(storage.size, 1);
  first.unmount();
  const restored = workspace(f, { selected: predecessor, status, storage, uuidStart: 200,
    actions: { preparePodResearchRecoveryAction: async input => ({ ok: true, receipt: { ...successor, submissionId: input.submissionId } }) } });
  assert.equal(restored.calls.length, 0);
  button(restored.render(), 'Review next-pass recovery').props.onClick(); await restored.settle();
  assert.deepEqual(restored.calls[0].input, savedInput);
  assert.notEqual(restored.calls[0].input.submissionId, id(201), 'The newly mounted UUID source cannot recreate the old submission by coincidence');
  assert.equal(restored.navigation.filter(([kind]) => kind === 'push').length, 1);
  restored.unmount();
});

test('client-side navigation to another stopped setup cannot reuse the previous recovery request', async () => {
  const { f, predecessor, status } = recoveryFixture();
  const h = workspace(f, { selected: predecessor, status,
    actions: { preparePodResearchRecoveryAction: async () => ({ ok: false, message: 'Synthetic interrupted preparation.' }) } });
  button(h.render(), 'Review next-pass recovery').props.onClick(); await h.settle();
  const other = { ...structuredClone(predecessor), setupId: id(94), scopeId: id(95) };
  h.render({ selected: other });
  button(h.render(), 'Review next-pass recovery').props.onClick(); await h.settle();
  assert.equal(h.calls[1].input.setupId, other.setupId); assert.equal(h.calls[1].input.setupHash, other.setupHash);
  assert.notEqual(h.calls[1].input.submissionId, h.calls[0].input.submissionId);
  h.unmount();
});

test('checkbox approval cannot follow navigation from one saved proposal to another', async () => {
  const { f, successor } = recoveryFixture(), h = workspace(f, { selected: successor });
  approve(h); assert.equal(button(h.render(), 'Approve and research').props.disabled, false);
  const other = structuredClone(successor); other.setupId = id(94); other.scopeId = id(95);
  other.preview.finance.runLimitMicrounits = '9000000'; other.setupHash = hash(other.preview);
  h.render({ selected: other });
  assert.equal(button(h.render(), 'Approve and research').props.disabled, true);
  button(h.render(), 'Approve and research').props.onClick(); await h.settle();
  assert.equal(h.calls.length, 0, 'Approval is tied to the reviewed proposal hash, not a persistent checkbox value');
  approve(h); button(h.render(), 'Approve and research').props.onClick(); await h.settle();
  assert.equal(h.calls[0].input.setupId, other.setupId); assert.equal(h.calls[0].input.setupHash, other.setupHash);
  h.unmount();
});

test('recovery progress includes earlier spend and stopping cannot offer a reset or another recovery', () => {
  const { f, successor, status } = recoveryFixture();
  const saved = { ...successor, confirmed: true, activated: true, stopped: true };
  const h = workspace(f, { selected: saved, status: { ...status, cost: { knownMicrousd: '1200', heldMicrousd: '0', hasUnknown: false } } });
  assert.match(text(h.render()), /Total known cost across the original and recovery: USD 0\.030112/);
  assert.match(text(h.render()), /Already spent: USD 0\.028912/);
  assert.match(text(h.render()), /Remaining: at most 4 complete passes, 20 calls and 4 searches/);
  assert.deepEqual(buttons(h), ['Reconcile existing receipt']);
  assert.equal(h.calls.length, 0); assert.equal(h.intervals.size, 0); h.unmount();
});

test('recovery cannot append Goal intent without explicit deadline-only revision consent', async () => {
  const { f, predecessor } = recoveryFixture(), s = serverHarness(f);
  for (const consent of [undefined, false]) {
    await assert.rejects(s.server.preparePodResearchRecovery(s.context, { ...inputFor(predecessor), approveGoalDeadlineRevision: consent }), /goal_deadline_revision_consent_required/);
  }
  assert.equal(s.calls.length, 0);
});

test('lost-response server replay returns the same saved successor without quote, new permission or Workflow', async () => {
  const { f, predecessor, successor } = recoveryFixture();
  const savedCatalog = { ...f.catalog, business: { ...f.catalog.business, ready: false }, template: null,
    finance: { ...f.catalog.finance, hasBlockingUnknown: true }, setups: [successor, predecessor] };
  const s = serverHarness(f, { rpc: async (name, args) => {
    assert.equal(name, 'r12_pod_research_read');
    assert.equal(args.p_submission_id, successor.submissionId); assert.equal(args.p_setup_id, null);
    return { data: structuredClone(savedCatalog), error: null };
  } });
  const a = actionHarness(f, { server: { preparePodResearchRecovery: (_context, input) => s.server.preparePodResearchRecovery(s.context, input) } });
  const input = inputFor(predecessor), first = await a.actions.preparePodResearchRecoveryAction(input), second = await a.actions.preparePodResearchRecoveryAction(input);
  assert.equal(first.ok, true); assert.deepEqual(first.receipt, successor); assert.deepEqual(second, first);
  assert.deepEqual(s.calls.map(c => c.name), ['r12_pod_research_read', 'r12_pod_research_read']);
  assert.equal(a.calls.some(c => c.name === 'start' || c.name === 'confirmPodResearch'), false);
  assert.equal(predecessor.stopped, true);
});

test('saved recovery submission cannot replay against a different stopped predecessor', async () => {
  const { f, predecessor, successor } = recoveryFixture();
  const h = serverHarness(f, { rpc: async name => {
    assert.equal(name, 'r12_pod_research_read'); return { data: { ...f.catalog, setups: [successor] }, error: null };
  } });
  await assert.rejects(h.server.preparePodResearchRecovery(h.context, { ...inputFor(predecessor), setupId: id(99) }), /r12_pod_owner_result_unverified/);
  assert.deepEqual(h.calls.map(c => c.name), ['r12_pod_research_read']);
});

test('the old stopped permission cannot be confirmed again to start ordinary Workflow', async () => {
  const { f, predecessor } = recoveryFixture();
  const s = serverHarness(f, { rpc: async name => {
    assert.equal(name, 'r12_pod_research_read'); return { data: structuredClone(f.catalog), error: null };
  } });
  const a = actionHarness(f, { server: { confirmPodResearch: (_context, input) => s.server.confirmPodResearch(s.context, input) } });
  const result = await a.actions.confirmPodResearchAction(inputFor(predecessor));
  assert.equal(result.ok, false); assert.match(result.message, /No completion or new permission has been assumed/);
  assert.equal(a.calls.some(c => c.name === 'start'), false);
  assert.deepEqual(s.calls.map(c => c.name), ['r12_pod_research_read']);
});

test('invalid carry-forward contracts fail closed even when the envelope and proof are freshly rehashed', () => {
  const { f, successor } = recoveryFixture();
  assert.deepEqual(parsePodReceipt(successor, successor.businessId, successor.setupId), successor);
  const changes = [
    ['recovery version', r => { r.preview.recovery.version = 'r12.pod-next-pass-recovery.0'; }],
    ['original review accepted', r => { r.preview.recovery.originalReviewAccepted = true; }],
    ['proof version', r => { r.preview.recovery.proof.version = 'r12.pod-recovery-proof.0'; }],
    ['different Business', r => { r.preview.recovery.proof.businessId = id(99); }],
    ['different Goal', r => { r.preview.recovery.proof.goalId = id(99); }],
    ['history mismatch', r => { r.preview.recovery.historyHash = '9'.repeat(64); }],
    ['missing classification hash', r => { delete r.preview.recovery.classificationHash; }],
    ['reset passes', r => { r.preview.recovery.proof.usedPasses = 0; }],
    ['fractional passes', r => { r.preview.recovery.proof.usedPasses = 1.5; }],
    ['exhausted passes', r => { r.preview.recovery.proof.usedPasses = 5; }],
    ['reset provider calls', r => { r.preview.recovery.proof.usedCalls = 0; }],
    ['reset searches', r => { r.preview.recovery.proof.usedSearches = 0; }],
    ['unaccounted spend', r => { r.preview.recovery.proof.spentMicrounits = '0'; }],
    ['rounded allowance', r => { r.preview.recovery.proof.remainingMaximumMicrounits = '9971000'; }],
    ['negative spend', r => { r.preview.recovery.proof.spentMicrounits = '-1'; }],
    ['noncanonical money', r => { r.preview.recovery.proof.originalMaximumMicrounits = '010000000'; }],
    ['oversized successor', r => { r.preview.finance.runLimitMicrounits = '10000000'; }],
  ];
  for (const [label, change] of changes) {
    const receipt = structuredClone(successor); change(receipt);
    receipt.preview.recovery.proofHash = hash(receipt.preview.recovery.proof);
    receipt.setupHash = hash(receipt.preview);
    assert.throws(() => parsePodReceipt(receipt, receipt.businessId, receipt.setupId), /r12_pod_owner_result_unverified/, label);
    assert.throws(() => parsePodCatalog({ ...f.catalog, setups: [receipt] }, receipt.businessId), /r12_pod_owner_result_unverified/, label);
  }
  const receipt = structuredClone(successor); receipt.preview.recovery.proofHash = '0'.repeat(64); receipt.setupHash = hash(receipt.preview);
  assert.throws(() => parsePodReceipt(receipt, receipt.businessId), /r12_pod_owner_result_unverified/);
});

test('malformed saved carry-forward blocks action recovery without granting permission or starting Workflow', async () => {
  const { f, predecessor, successor } = recoveryFixture();
  successor.preview.recovery.proof.usedCalls = 0;
  successor.preview.recovery.proofHash = hash(successor.preview.recovery.proof); successor.setupHash = hash(successor.preview);
  const s = serverHarness(f, { rpc: async name => {
    assert.equal(name, 'r12_pod_research_read'); return { data: { ...f.catalog, setups: [successor] }, error: null };
  } });
  const a = actionHarness(f, { server: { preparePodResearchRecovery: (_context, input) => s.server.preparePodResearchRecovery(s.context, input) } });
  const result = await a.actions.preparePodResearchRecoveryAction(inputFor(predecessor));
  assert.equal(result.ok, false); assert.match(result.message, /No completion or new permission has been assumed/);
  assert.deepEqual(a.calls.map(c => c.name), ['auth', 'preparePodResearchRecovery']);
  assert.deepEqual(s.calls.map(c => c.name), ['r12_pod_research_read']);
});

test('read-only owner release verifier exposes separately pinned recovery instructions', async () => {
  const h = releaseRouteHarness(), response = await h.get(), body = await response.json();
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(body.authorityCreated, false);
  assert.deepEqual(body.schemas, h.expectedSchemas()); assert.deepEqual(body.recoverySchemas, h.expectedRecoverySchemas());
  assert.deepEqual(Object.keys(body.recoverySchemas).sort(), ['plan', 'review', 'select1', 'strategy']);
  assert.notEqual(body.recoverySchemas.plan.systemHash, body.schemas.plan.systemHash, 'Failed-pass context is pinned separately from ordinary accepted-review refinement');
  for (const phase of ['plan', 'select1', 'strategy', 'review']) {
    for (const [kind, value] of Object.entries(body.recoverySchemas[phase])) {
      assert.match(value, /^[a-f0-9]{64}$/);
      if (phase !== 'plan' || kind !== 'systemHash') assert.equal(value, body.schemas[phase][kind]);
    }
  }
  assert.equal(h.calls.filter(c => c[0] === 'schemas').length, 2);
  assert.ok(h.calls.some(c => c[0] === 'schemas' && c[1] === true));
  assert.equal(JSON.stringify(body).includes(h.fixtureEnv.R05_ADMISSION_SERVER_KEY), false);
});
