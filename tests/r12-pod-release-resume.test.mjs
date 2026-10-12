// Inert adapter contracts only. No database, credentials, network or real research.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url), ts = require('typescript');
const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url)), modules = new Map();
// Read the current source, not a potentially stale .core-tests build. Relative
// dependencies use the same loader, including the real serializer/validators.
function source(file) {
  const filename = resolve(sourceRoot, file.endsWith('.ts') ? file : `${file}.ts`);
  assert.ok(filename.startsWith(sourceRoot.endsWith(sep) ? sourceRoot : sourceRoot + sep));
  if (modules.has(filename)) return modules.get(filename).exports;
  const loaded = { exports: {} };
  modules.set(filename, loaded);
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  new Function('require', 'module', 'exports', code)(name => name.startsWith('.')
    ? source(resolve(dirname(filename), name)) : require(name), loaded, loaded.exports);
  return loaded.exports;
}

const { publicResearchHash: hash } = source('research/qualification');
const { buildPodResearchRequest, projectPodResearchPhase } = source('products/discovery-r12-pod-runtime');
const { createDiscoveryR12QuestAdapter, DiscoveryR12ReceiptPending } = source('products/discovery-r12-adapter');
const { qualifyDiscoveryR12Quote } = source('products/discovery-r12-quote');
const id = n => `12120000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = Date.parse('2026-10-12T01:00:00.000Z'), stamp = n => new Date(n).toISOString();
const phases = ['plan', 'search1', 'select1', 'strategy', 'review'];
const release = (letter, deploymentId) => ({ version: 'r12.executing-release.1', repository: 'SSB100/agent-labs',
  environment: 'production', commitSha: letter.repeat(40), deploymentId });
const oldRelease = release('a', 'dpl_inert_old'), newRelease = release('b', 'dpl_inert_new');

function quoteFixture() {
  const saved = JSON.parse(readFileSync(new URL('fixtures/r12-provider-catalogs.json', import.meta.url), 'utf8'));
  const [luna, reviewer] = structuredClone(saved.endpoints);
  delete luna.canonicalModelId; delete reviewer.canonicalModelId;
  const base = 'https://openrouter.ai/api/v1';
  const snapshot = (url, payload) => ({ url, fetchedAt: stamp(now - 1000), payload });
  return qualifyDiscoveryR12Quote({
    models: snapshot(`${base}/models`, { data: saved.endpoints.map(e => ({ id: e.model_id,
      canonical_slug: e.canonicalModelId, links: { details: `/api/v1/models/${e.canonicalModelId}/endpoints` } })) }),
    lunaAlias: snapshot(`${base}/models/${luna.model_id}/endpoints`, { data: { id: luna.model_id, endpoints: [luna] } }),
    lunaCanonical: snapshot(`${base}/models/${saved.endpoints[0].canonicalModelId}/endpoints`, { data: { id: luna.model_id, endpoints: [luna] } }),
    reviewerAlias: snapshot(`${base}/models/${reviewer.model_id}/endpoints`, { data: { id: reviewer.model_id, endpoints: [reviewer] } }),
    reviewerCanonical: snapshot(`${base}/models/${saved.endpoints[1].canonicalModelId}/endpoints`, { data: { id: reviewer.model_id, endpoints: [reviewer] } }),
    zdr: snapshot(`${base}/endpoints/zdr`, { data: [luna, reviewer] }),
  }, now);
}

function scopeFixture() {
  const sourcePolicy = { version: 'r12.pod-source-policy.1', reviewId: id(9), method: 'openrouter_exa_factual_snippets',
    purpose: 'public_pod_market_research', excludedDomains: ['etsy.com', 'etsy.me', 'etsystatic.com'],
    restrictionsRevision: '1'.repeat(64), termsReviewHash: '2'.repeat(64), independentReviewHash: '3'.repeat(64),
    recipients: { router: 'openrouter.ai', search: 'exa.ai', researcher: 'azure/us', reviewer: 'amazon-bedrock/us' },
    retention: { inference: 'no_training_zdr', search: 'query_retention_improvement_training_possible', application: 'bounded_attributed_audit_evidence' },
    validFrom: stamp(now - 60000), validUntil: stamp(now + 3600000) };
  const scope = { version: 'r12.pod-research-goal.1', id: id(1), businessId: id(2), businessRevision: 1, businessHash: '4'.repeat(64),
    goalId: id(3), goalRevision: 1, goalHash: '5'.repeat(64), setupId: id(4), setupHash: '6'.repeat(64), authorityRootId: id(2),
    publicBrief: { objective: 'Research viable print-on-demand products to sell on Etsy.', publicConstraints: [], fulfilmentContext: 'unspecified' },
    sourcePolicy, sourcePolicyHash: hash(sourcePolicy), approvalHash: '7'.repeat(64), maximumMicrousd: 2000000,
    createdAt: stamp(now - 1000), expiresAt: stamp(now + 1500000) };
  const plan = { format: 'r12.pod-research.1', discoveryScopeId: scope.id, discoveryScopeHash: hash(scope), businessId: scope.businessId,
    goalId: scope.goalId, goalRevision: 1, goalHash: scope.goalHash, businessRevision: 1, businessHash: scope.businessHash,
    policyId: id(5), policyHash: '8'.repeat(64), authorityRootId: scope.businessId, plannerWorkerDefinitionId: id(6), currency: 'USD',
    maximumMicrounits: '2000000', deadline: scope.expiresAt, expiresAt: scope.expiresAt, maximumRepairs: 0, maximumPivots: 0,
    maximumChildren: 5, maximumDispatches: 5, requiredChecks: ['review'], finishCondition: 'all_required_outputs_verified',
    stopConditions: ['no_permitted_work', 'deadline', 'repair_exhausted', 'owner_stopped'],
    steps: phases.map((key, i) => ({ key, kind: key === 'review' ? 'review' : key === 'search1' ? 'research' : 'work',
      objective: 'Research the approved general POD goal.', reason: 'Finite inert research phase.', adapter: `r12.discovery.${scope.id}.${key}`,
      qualificationHash: '9'.repeat(64), installationId: id(7), packSnapshotHash: 'a'.repeat(64), workflowDefinitionId: id(20 + i),
      workerDefinitionId: key === 'review' ? id(8) : id(6), role: key, operationKey: `research.r12.${scope.id}.${key}`,
      purpose: 'Public POD product research', dependsOn: phases.slice(0, i), expectedArtifactType: `r12.discovery.${key}`,
      maximumMicrounits: '400000', expiresAt: scope.expiresAt, notBefore: scope.createdAt, measurement: null, maximumRepairs: 0 })) };
  const output = { comparisonRationale: 'This synthetic planner proposes exploratory questions solely to verify the transport and receipt contract.',
    query: 'Compare aggregate consumer needs for printed products with production limitations and reasons such ideas may fail.',
    sourceDomains: ['census.gov', 'printful.com'], sourceChoiceRationale: 'Use primary aggregate evidence and official production information without claiming product demand.',
    hypotheses: [{ productType: 'Unproven printed object', niche: 'An exploratory general niche', audience: 'An aggregate adult buyer group',
      hypothesis: 'A useful printed object may address a need, but this fixture establishes no real demand.',
      contraryExplanation: 'Public interest may not lead to purchases or a profitable delivered product.' }] };
  return { scope, plan, output };
}

function harness({ delayedReceipt = false, delayedReceiptReads = 0 } = {}) {
  const f = scopeFixture(), quote = quoteFixture();
  const ctx = { planId: id(10), planHash: hash(f.plan), plan: f.plan, step: f.plan.steps[0], knowledge: {},
    attempt: { id: id(100), stepKey: 'plan', status: 'scheduled', attempt: 1, requestId: null,
      inputHash: 'b'.repeat(64), dependencyPins: [], wireHash: null, responseHash: null } };
  const inputs = { kind: 'pod_goal', scope: f.scope, validationAt: now, inputMode: 'dispatch',
    committedBeforeAttemptMicrousd: 0, dependencies: [] };
  const state = { binding: null, candidate: null, proof: null, receipt: null, transportClaim: null,
    observation: null, observationSaved: false, diagnostic: null };
  const sends = [], posts = [], gets = [], settlements = [], binds = [];
  let delayed = delayedReceipt, clockAt = now + 1000;
  // This double proves the adapter's admission contract. SQL atomicity/races
  // require separate database tests; no database is contacted here.
  const store = {
    operation: async (_attemptId, operation, payload) => {
      if (operation === 'load') return structuredClone(state);
      if (operation === 'bind') { assert.equal(state.binding, null); state.binding = structuredClone(payload.binding); binds.push(payload); return {}; }
      if (operation === 'send') {
        sends.push(structuredClone(payload));
        if (state.transportClaim) return { shouldDispatch: false };
        state.transportClaim = { wireHash: payload.wireHash, executingRelease: structuredClone(payload.executingRelease) };
        return { shouldDispatch: true };
      }
      if (operation === 'stage') { state.candidate = structuredClone(payload.candidate);
        state.receipt = { status: 'awaiting_receipt', attempts: 0, nextCheckAt: null, receiptExpiresAt: stamp(now + 3300000) }; return {}; }
      if (operation === 'observe') { state.observation = structuredClone(payload.observation); state.observationSaved = true; return {}; }
      if (operation === 'diagnose') { state.diagnostic = structuredClone(payload.diagnostic); return {}; }
      if (operation === 'claim') {
        if (state.receipt.attempts >= 3 || state.receipt.nextCheckAt && Date.parse(state.receipt.nextCheckAt) > clockAt) return { claimed: false };
        state.receipt.attempts++; state.receipt.status = 'checking_receipt';
        return { claimed: true, claimId: id(800 + state.receipt.attempts) };
      }
      if (operation === 'record') {
        if (payload.proof) { state.proof = structuredClone(payload.proof); state.receipt.status = 'verified'; state.receipt.nextCheckAt = null; }
        else { state.receipt.status = state.receipt.attempts < 3 ? 'awaiting_receipt' : 'exhausted';
          state.receipt.nextCheckAt = state.receipt.attempts < 3 ? stamp(clockAt + (state.receipt.attempts === 1 ? 2000 : 8000)) : null; }
        return {};
      }
      throw new Error(`Unexpected inert store operation: ${operation}`);
    },
    dispatchedAt: async () => stamp(now),
    settle: async (_attemptId, settlement) => { settlements.push(structuredClone(settlement)); },
  };
  const generation = 'gen-inert-pod-release-plan', model = 'openai/gpt-5.6-luna-20260709';
  const fetcher = async (url, init) => {
    if (init.method === 'GET') {
      const parsed = new URL(url);
      assert.equal(parsed.origin + parsed.pathname, 'https://openrouter.ai/api/v1/generation');
      assert.equal(parsed.searchParams.get('id'), generation);
      gets.push(url);
      if (delayed || gets.length <= delayedReceiptReads) return new Response(JSON.stringify({ error: { message: 'Inert receipt indexing delay' } }), { status: 404 });
      return new Response(JSON.stringify({ data: { id: generation, provider_name: 'Azure', model } }), { status: 200 });
    }
    assert.equal(init.method, 'POST'); assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.ok(state.transportClaim, 'Admission must precede the inert POST');
    posts.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: generation, model, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(f.output) } }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, cost: 0.00001 } }), { status: 200 });
  };
  const adapter = executingRelease => createDiscoveryR12QuestAdapter({ scope: f.scope, phase: 'plan', executingRelease,
    identity: { qualificationHash: ctx.step.qualificationHash, workflowDefinitionId: ctx.step.workflowDefinitionId,
      workerDefinitionId: ctx.step.workerDefinitionId, mode: 'qualification' }, dataClasses: ['approved_public_brief'], store,
    request: async context => buildPodResearchRequest(context, inputs), quote: async () => quote,
    project: async (qualified, context, request) => projectPodResearchPhase(context, { ...inputs, inputMode: 'receipt' }, qualified, request),
    config: { apiKey: 'inert-pod-release-test-only', baseUrl: 'https://openrouter.ai/api/v1', appUrl: 'https://agent-labs-two.vercel.app', appName: 'Agent Labs' },
    fetcher, now: () => clockAt });
  const bind = async () => {
    const first = adapter(oldRelease), prepared = await first.prepare(ctx);
    ctx.attempt.requestId = id(101); ctx.attempt.wireHash = prepared.descriptor.wireRequestHash; ctx.attempt.status = 'reserved';
    const call = await first.prepare(ctx);
    assert.deepEqual(state.binding.executingRelease, oldRelease);
    return call;
  };
  const advanceToReceiptCheck = () => { assert.ok(state.receipt.nextCheckAt); clockAt = Date.parse(state.receipt.nextCheckAt); };
  return { adapter, bind, ctx, state, sends, posts, gets, settlements, binds, advanceToReceiptCheck,
    releaseReceipt: () => { delayed = false; advanceToReceiptCheck(); } };
}

test('POD unsent bind from old deployment resumes with the current release at first-send admission', async () => {
  const h = harness(), prepared = await h.bind(), immutableBinding = structuredClone(h.state.binding);
  const resumed = h.adapter(newRelease), call = await resumed.prepare(h.ctx);
  assert.deepEqual(call, prepared); assert.equal(h.binds.length, 1);
  const result = await resumed.dispatch(call, h.ctx);
  assert.equal(result.outcome, 'accepted'); assert.equal(h.posts.length, 1); assert.equal(h.gets.length, 1);
  assert.equal(h.sends.length, 1); assert.deepEqual(h.sends[0].executingRelease, newRelease);
  assert.deepEqual(h.state.transportClaim.executingRelease, newRelease);
  assert.deepEqual(h.state.binding, immutableBinding, 'Prepared provenance and exact wire stay immutable');
  assert.equal(h.settlements[0].actualMicrounits, '10');
});

test('POD duplicate send after another deployment neither posts again nor overwrites the first transport release', async () => {
  const h = harness(), call = await h.bind();
  await h.adapter(newRelease).dispatch(call, h.ctx);
  const claimed = structuredClone(h.state.transportClaim), laterRelease = release('c', 'dpl_inert_later');
  const later = h.adapter(laterRelease), sameCall = await later.prepare(h.ctx);
  await assert.rejects(later.dispatch(sameCall, h.ctx));
  assert.equal(h.sends.length, 2); assert.deepEqual(h.sends[1].executingRelease, laterRelease);
  assert.equal(h.posts.length, 1); assert.equal(h.gets.length, 1);
  assert.deepEqual(h.state.transportClaim, claimed); assert.deepEqual(claimed.executingRelease, newRelease);
  assert.equal(h.binds.length, 1);
});

test('POD old-release paid receipt remains reconcilable under a newer deployment without another send', async () => {
  const h = harness({ delayedReceipt: true }), call = await h.bind();
  await assert.rejects(h.adapter(oldRelease).dispatch(call, h.ctx), DiscoveryR12ReceiptPending);
  assert.ok(h.state.candidate); assert.equal(h.state.proof, null);
  assert.deepEqual(h.state.transportClaim.executingRelease, oldRelease);
  h.releaseReceipt(); h.ctx.attempt.status = 'dispatched';
  const before = structuredClone(h.state.binding), resumed = await h.adapter(newRelease).reconcile(h.ctx);
  assert.equal(resumed.status, 'found'); assert.equal(resumed.response.outcome, 'accepted');
  assert.equal(resumed.response.settlement.actualMicrounits, '10');
  assert.equal(h.sends.length, 1); assert.equal(h.posts.length, 1); assert.equal(h.gets.length, 2);
  assert.deepEqual(h.state.binding, before); assert.deepEqual(h.state.transportClaim.executingRelease, oldRelease);
  assert.ok(h.state.proof);
});

test('POD resumed send cannot borrow prepared release provenance when the current release is missing', async () => {
  const h = harness(), call = await h.bind();
  await assert.rejects(h.adapter(undefined).dispatch(call, h.ctx));
  assert.equal(h.sends.length, 0); assert.equal(h.posts.length, 0); assert.equal(h.state.transportClaim, null);
});

test('POD two delayed metadata reads remain resumable until the third exact receipt succeeds without another POST', async () => {
  const h = harness({ delayedReceiptReads: 2 }), call = await h.bind(), resumed = h.adapter(newRelease);
  await assert.rejects(resumed.dispatch(call, h.ctx), DiscoveryR12ReceiptPending);
  assert.equal(h.state.receipt.attempts, 1); assert.equal(h.gets.length, 1);
  h.ctx.attempt.status = 'dispatched';
  // An early wake reports the saved deadline without consuming another lookup.
  await assert.rejects(resumed.reconcile(h.ctx), error => error instanceof DiscoveryR12ReceiptPending && error.receipt.nextCheckAt === h.state.receipt.nextCheckAt);
  assert.equal(h.gets.length, 1);
  h.advanceToReceiptCheck();
  await assert.rejects(resumed.reconcile(h.ctx), error => error instanceof DiscoveryR12ReceiptPending && error.receipt.attempts === 2);
  assert.equal(h.state.receipt.attempts, 2); assert.equal(h.gets.length, 2);
  h.advanceToReceiptCheck();
  const result = await resumed.reconcile(h.ctx);
  assert.equal(result.status, 'found'); assert.equal(result.response.outcome, 'accepted');
  assert.equal(result.response.settlement.actualMicrounits, '10');
  assert.equal(h.state.receipt.attempts, 3); assert.equal(h.gets.length, 3);
  assert.equal(h.posts.length, 1); assert.equal(h.sends.length, 1);
});
