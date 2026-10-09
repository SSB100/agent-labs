import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHmac, randomUUID } from 'node:crypto';
import { ownerInitialSqlFixture, one, sha } from './r12-owner-initial-sql-fixture.mjs';
import { r12PhaseOutputFixture } from './r12-phase-output-fixture.mjs';
import { r12QuoteFixture } from './r12-provider-fixture.mjs';

const require = createRequire(import.meta.url), ts = require('typescript');
const core = name => require('../../.core-tests/' + name + '.js');
function source(file, deps) {
  const fixtureModule = { exports: {} };
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', code)(name => { assert.ok(name in deps, 'Unexpected dependency ' + name); return deps[name]; }, fixtureModule, fixtureModule.exports);
  return fixtureModule.exports;
}

/** Synthetic, negative-only outputs for the exact dynamically saved scope. */
export function ownerInitialPhaseOutputs(scope) {
  assert.ok(['r12.discovery-owner-initial.1','r12.discovery-owner-episode.1'].includes(scope.version));
  const outputs = JSON.parse(JSON.stringify(r12PhaseOutputFixture(scope.intent.comparisonUniverse.audiences[0])).replaceAll('nature', 'original apparel').replaceAll('outdoor', 'adult apparel'));
  const topic = scope.profile.topics.find(t => t.key === scope.selection.topicKey);
  assert.ok(topic);
  outputs.plan.comparisonRationale = 'Evaluate the selected adult apparel research scope without inferring candidate demand from synthetic contextual material.';
  outputs.plan.queryFocus = ['Dated adult apparel purchase considerations and evidence gaps'];
  outputs.plan.proposals.forEach((p, index) => {
    p.concept = `${topic.label}: ${['original geometric composition', 'original abstract linework', 'original minimal silhouette'][index]}`;
    p.hypothesis = 'An original composition might express the selected adult audience identity; this is an unproven hypothesis.';
  });
  outputs.search1.annotations.forEach((a, i) => { a.url_citation.url = `https://${scope.allowedDomains[0]}/inert-owner-apparel-${i + 1}`; });
  outputs.select1.selections = outputs.search1.annotations.map((a, i) => ({ sourceKey: `S${i + 1}`, quote: a.url_citation.content.slice(0, 120).trim() }));
  const template = outputs.strategy.marketComparisons[0];
  outputs.strategy.marketComparisons = scope.intent.comparisonUniverse.markets.map(m => ({ ...structuredClone(template), ...m, evidence: [], feeScenarios: [{ ...template.feeScenarios[0], sellerBankCountry: m.countryCode }] }));
  outputs.strategy.recommendation.rationale = 'These synthetic public-context fixtures establish no candidate-specific demand and cannot select a creative experiment.';
  return outputs;
}

/** Actual owner Continue → R07 → R05 → R12 wire/candidate/receipt/result APIs.
 * All transport is inert synthetic qualification; no real evidence or demand
 * is asserted and no network credential is loaded or provider call is made. */
export async function exerciseOwnerInitialRuntime(db, { legacy = null, onCompleted = null } = {}) {
  // Multiple runtime scenarios share the native race database. Derive each
  // fixture grant from its Business/owner/grant IDs instead of the default key.
  const f = await ownerInitialSqlFixture(db, { legacy, bootstrapRoot: 'inert-owner-initial-runtime-bootstrap-root-0123456789' });
  const prepared = await f.prepare();
  const root = 'inert-owner-initial-root-configuration-0123456789';
  const derive = role => createHmac('sha256', root).update(JSON.stringify({ version: 'r12.scoped-authority.1', role, businessId: f.businessId, ownerId: f.ownerId, scopeId: prepared.scopeId })).digest('base64url');
  const controller = derive('controller'), admission = derive('admission');
  const activated = await f.server('confirm', { ...f.confirmPayload(prepared), controllerKeyHash: sha(controller), admissionKeyHash: sha(admission) });
  assert.equal(activated.activated, true);
  const scope = (await one(db, 'select amendment from private.r12_discovery_scopes where id=$1', [prepared.scopeId])).amendment;
  const outputs = ownerInitialPhaseOutputs(scope);

  const rpc = async (name, args, role = 'anon') => {
    await db.exec('set role ' + role);
    try { return { data: (await one(db, `select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).result, error: null }; }
    catch (error) { return { data: null, error }; }
    finally { await db.exec('reset role'); }
  };
  const command = async (operation, payload, epoch = null) => {
    const response = await rpc('r07_controller', [f.businessId, f.goalId, operation, payload, randomUUID(), controller, 'inert-owner-initial-runtime-lease-0123456789', epoch, admission]);
    if (response.error) throw response.error;
    return response.data;
  };
  const store = { read: () => command('read', {}), command: (operation, payload, epoch) => command(operation, ['schedule', 'reserve'].includes(operation) ? { ...payload, runtimeCapability: 'inert-owner-initial-runtime-capability-0123456789' } : payload, epoch) };
  const phases = ['plan', 'search1', 'select1', 'strategy', 'review'];
  const generationId = phase => `gen-owner-initial-${phase}-${scope.id.replaceAll('-', '')}`;
  const runtime = core('products/discovery-r12-runtime');
  const adapter = core('products/discovery-r12-adapter');
  let posts = 0, gets = 0, delayed = true;
  const fetchedPhases = [];
  const fetcher = phase => async (url, init) => {
    const model = phase === 'review' ? 'anthropic/claude-4.5-haiku-20251001' : 'openai/gpt-5.6-luna-20260709';
    if (init.method === 'POST') {
      posts++; fetchedPhases.push(phase);
      const body = JSON.parse(init.body);
      assert.deepEqual(body.provider.only, [phase === 'review' ? 'amazon-bedrock/us' : 'azure/us']);
      assert.equal(body.provider.zdr, true);
      assert.equal((await one(db, 'select count(*)::int n from private.r12_discovery_transport_claims tc join private.r12_discovery_wires w using(request_id) where w.scope_id=$1', [scope.id])).n, posts);
      if (phase === 'search1') {
        assert.equal(body.messages[1].content, scope.approvedQuery);
        assert.ok(!body.messages[1].content.includes(f.content.objective));
        assert.deepEqual(body.tools[0].parameters.allowed_domains, scope.allowedDomains);
      }
      const message = phase === 'search1' ? { content: 'Explicitly synthetic public apparel context.', annotations: outputs.search1.annotations } : { content: JSON.stringify(outputs[phase]) };
      return new Response(JSON.stringify({ id: generationId(phase), model, choices: [{ finish_reason: 'stop', message }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, cost: 0.00001, ...(phase === 'search1' ? { server_tool_use_details: { web_search_requests: 1 } } : {}) } }), { status: 200 });
    }
    assert.equal(init.method, 'GET'); gets++;
    assert.ok((await db.query("select 1 from private.r12_discovery_candidates where candidate->>'providerRequestId'=$1", [generationId(phase)])).rows.length, 'candidate must be durable before receipt transport');
    if (delayed && phase === 'plan') return new Response(JSON.stringify({ error: { message: 'Synthetic receipt indexing delay' } }), { status: 404 });
    return new Response(JSON.stringify({ data: { id: generationId(phase), provider_name: phase === 'review' ? 'Amazon Bedrock' : 'Azure', model } }), { status: 200 });
  };
  const ownerBusiness = source('src/lib/core-ui/owner-business.ts', {});
  const deps = {
    'server-only': {}, 'node:crypto': require('node:crypto'), '../lib/core-ui/owner-business': ownerBusiness,
    '../core/request-deadline': core('core/request-deadline'), '../core/quest-plan': core('core/quest-plan'), '../core/quest-controller': core('core/quest-controller'),
    './discovery-v2': core('products/discovery-v2'), './discovery-r12-runtime': runtime, './discovery-r12-adapter': adapter,
    './discovery-r12-wire': core('products/discovery-r12-wire'), './discovery-r12-focused-successor': core('products/discovery-r12-focused-successor'),'./discovery-r12-owner-episode': core('products/discovery-r12-owner-episode'),
    './discovery-r12-review-preparation-contract': core('products/discovery-r12-review-preparation-contract'),
    './discovery-r12-server-dependencies': { discoveryR12ServerDependencies: () => ({
      createController: (businessId, goalId, keys) => { assert.equal(businessId, f.businessId); assert.equal(goalId, f.goalId); assert.deepEqual(keys, { controllerKey: controller, admissionKey: admission }); return store; },
      createClient: () => ({ rpc: (name, a) => rpc(name, [a.p_business_id, a.p_attempt_id, a.p_operation, a.p_payload, a.p_server_key]) }),
      quote: async () => r12QuoteFixture(),
      createAdapter: options => adapter.createDiscoveryR12QuestAdapter({ ...options, config: { apiKey: 'inert-owner-runtime-only', baseUrl: 'https://openrouter.ai/api/v1', appUrl: 'https://agent-labs-two.vercel.app', appName: 'Agent Labs' }, fetcher: fetcher(options.phase) }),
    }) },
  };
  const server = source('src/products/discovery-r12-server.ts', deps);
  const owner = source('src/products/discovery-r12-owner.ts', { ...deps, './discovery-r12-observation': core('products/discovery-r12-observation') });
  const context = { userId: f.ownerId, businesses: [{ id: f.businessId, name: 'Synthetic owner research' }], supabase: {
    auth: { getClaims: async () => ({ data: { claims: { sub: f.ownerId } }, error: null }) },
    rpc: (name, a) => rpc(name, name === 'r12_owner_research_server' ? [a.p_business_id, a.p_operation, a.p_payload, a.p_server_key] : name === 'r05_policy_owner' ? [a.p_business_id, a.p_operation, a.p_payload, a.p_submission_id] : name === 'r12_discovery_result_read' ? [a.p_business_id, a.p_scope_id] : [a.p_business_id, a.p_scope_id, a.p_activation], 'authenticated'),
  } };
  const oldEnv = Object.fromEntries(['VERCEL_ENV', 'R05_ADMISSION_SERVER_KEY', 'OPENROUTER_API_KEY'].map(k => [k, process.env[k]]));
  Object.assign(process.env, { VERCEL_ENV: 'production', R05_ADMISSION_SERVER_KEY: root, OPENROUTER_API_KEY: 'inert-owner-runtime-only' });
  try {
    assert.equal(await store.read(), null);
    const first = await server.continueDiscoveryR12(context, f.businessId, scope.id);
    assert.equal(first.reason, 'receipt_pending'); assert.equal(posts, 1); assert.equal(gets, 1);
    const waiting = await owner.readDiscoveryR12Workspace(context, f.businessId, scope.id);
    assert.equal(waiting.available, true); assert.equal(waiting.record.phases[0].candidateSaved, true); assert.equal(waiting.record.cost.knownMicrousd, '10');
    assert.equal(owner.discoveryR12CanContinue(waiting.record), false);
    await server.continueDiscoveryR12(context, f.businessId, scope.id);
    assert.equal(posts, 1); assert.equal(gets, 1, 'immediate reload/Continue must not regenerate or bypass receipt cooldown');
    // Isolated test time only. No production clock or immutable receipt is edited.
    await db.exec('alter table private.r12_discovery_receipt_checks disable trigger r12_discovery_history_guard');
    await db.query("update private.r12_discovery_receipt_checks set created_at=clock_timestamp()-interval '121 seconds' where request_id in(select request_id from private.r12_discovery_wires where scope_id=$1)", [scope.id]);
    await db.exec('alter table private.r12_discovery_receipt_checks enable trigger r12_discovery_history_guard');
    delayed = false;
    const finished = await server.continueDiscoveryR12(context, f.businessId, scope.id);
    assert.equal(finished.status, 'completed');
    assert.deepEqual(fetchedPhases, phases); assert.equal(posts, 5); assert.equal(gets, 6);
    assert.equal((await server.continueDiscoveryR12(context, f.businessId, scope.id)).status, 'completed');
    assert.equal(posts, 5); assert.equal(gets, 6);
    const final = await store.read();
    assert.equal(final.version, 1); assert.equal(final.attempts.length, 5); assert.ok(final.attempts.every(a => a.status === 'completed'));
    assert.equal(final.head.dispatches, 5); assert.equal(final.head.childrenCreated, 5); assert.equal(final.head.repairsUsed, 0); assert.equal(final.head.pivotsUsed, 0);
    const rawResult = await rpc('r12_discovery_result_read', [f.businessId, scope.id], 'authenticated');
    if (rawResult.error) throw rawResult.error;
    runtime.reconstructDiscoveryR12Result(rawResult.data, f.businessId, scope.id);
    const saved = await owner.readDiscoveryR12Result(context, f.businessId, scope.id);
    assert.equal(saved.available, true); assert.ok(saved.record); assert.equal(saved.record.review.outcome, 'NEEDS_MORE_EVIDENCE'); assert.equal(saved.record.phaseReceipts.length, 5);
    assert.equal(saved.record.executionAuthorized, false); assert.equal(saved.record.ownerInitial.fundingKind, legacy ? 'legacy_research_root' : 'r05_business'); assert.equal(saved.record.objective, f.content.objective);
    const wallClock = Date.now;
    try { Date.now = () => wallClock() + 2 * 86400000; assert.deepEqual(runtime.reconstructDiscoveryR12Result(rawResult.data, f.businessId, scope.id), saved.record, 'historical receipt replay must not renew or require a currently live profile'); }
    finally { Date.now = wallClock; }
    const complete = await owner.readDiscoveryR12Workspace(context, f.businessId, scope.id);
    assert.equal(complete.available, true); assert.equal(complete.record.cost.knownMicrousd, '50'); assert.equal(complete.record.rootFunding.committedMicrousd, 50 + (legacy?.committedMicrounits ?? 0)); assert.equal(complete.record.rootFunding.pendingExposureMicrousd, 0);
    const reviewAttempt = final.attempts.find(a => a.stepKey === 'review');
    const raw = await rpc('r12_discovery_server', [f.businessId, reviewAttempt.id, 'inputs', {}, controller]);
    if (raw.error) throw raw.error;
    assert.equal(raw.data.version, 'r12.discovery-owner-initial-inputs.1'); assert.equal(raw.data.inputMode, 'receipt'); assert.equal(raw.data.committedMicrousd, 40);
    assert.equal(raw.data.committedMicrousd, raw.data.dependencies.reduce((n, d) => n + Number(d.candidate.reportedMicrousd), 0));
    assert.equal((await one(db, 'select count(*)::int n from public.product_experiments where business_id=$1', [f.businessId])).n, legacy ? 1 : 0, 'owner-initial execution creates no legacy experiment');
    if (onCompleted) return await onCompleted({ f, prepared, activated, scope, saved: saved.record, rawResult: rawResult.data, context, server, owner, store, controller, admission });
    // Synthetic later activity is seeded only to test historical isolation.
    // A current funding mismatch or newer unfinished round must block fresh
    // dispatch, without erasing a completed result or permitting budget reset.
    const laterId = randomUUID(), laterWorkflow = randomUUID(), laterReservation = randomUUID();
    const laterIntent = legacy ? { ...structuredClone(f.legacy.intent), id: laterId } : core('products/discovery-v2-goal').buildDiscoveryIntentFromGoal({ id: laterId, businessId: f.businessId, goal: 'Research a separate retained geographic original apparel opportunity.', maximumMicrousd: 2000000, maximumCollections: 1 });
    const variables = { intent: laterIntent, policyHash: core('products/discovery-v2').discoveryV2Hash(laterIntent), semanticGoalHash: legacy ? f.legacy.semanticHash : sha('synthetic-later-research'), budgetAuthorityRootId: legacy ? f.legacy.rootId : laterId, ownerKickoff: { followUpBasis: legacy ? { rootId: f.legacy.rootId } : null } };
    await db.query("insert into public.workflow_runs(id,business_id,workflow_definition_id,idempotency_key,status,input) values($1,$2,$3,$4,'running',$5)", [laterWorkflow, f.businessId, f.pins.workflowDefinitionId, 'inert-later-history-' + laterWorkflow, { intentId: laterId }]);
    await db.query(`insert into public.product_experiments(id,business_id,workflow_run_id,fingerprint,hypothesis,variables,audience,status,measurement_plan,discovery_version,started_at) values($1,$2,$3,$4,'Synthetic later unfinished research',$5,'Adult buyers','researching','{"version":"pod-discovery-2.0","testPlan":null}','pod-discovery-2.0',clock_timestamp())`, [laterId, f.businessId, laterWorkflow, sha(laterId), variables]);
    await db.query('insert into public.product_research_cost_reservations(id,business_id,experiment_id,workflow_run_id,attempt_key,reserved_microusd,request_hash,estimate) values($1,$2,$3,$4,$5,1000,$6,$7)', [laterReservation, f.businessId, laterId, laterWorkflow, 'plan:1', '3'.repeat(64), { version: 'discovery-estimate-2.0' }]);
    const currentRead = await rpc('r12_discovery_scope_read', [f.businessId, scope.id], 'authenticated');
    assert.ok(currentRead.error); assert.match(currentRead.error.message, legacy ? /original_funding_mismatch/ : /original_root_binding_required/);
    const laterHistory = await owner.readDiscoveryR12Result(context, f.businessId, scope.id);
    assert.equal(laterHistory.available, true); assert.deepEqual(laterHistory.record, saved.record);
    const laterWorkspace = await owner.readDiscoveryR12Workspace(context, f.businessId, scope.id);
    assert.equal(laterWorkspace.available, true); assert.equal(laterWorkspace.record.rootFunding.pendingExposureMicrousd, 1000); assert.equal(laterWorkspace.record.rootFunding.committedMicrousd, 1050 + (legacy?.committedMicrounits ?? 0));
    // Catalog revocation blocks new use but leaves historical verification and
    // the exact key-free owner Stop available.
    await db.query('insert into private.r12_owner_profile_revocations(profile_id,reason) values($1,$2)', [f.profileId, 'Synthetic post-completion revocation']);
    delete process.env.R05_ADMISSION_SERVER_KEY; delete process.env.OPENROUTER_API_KEY;
    assert.deepEqual(await server.stopDiscoveryR12(context, f.businessId, scope.id, true), { stopped: true });
    const after = await owner.readDiscoveryR12Result(context, f.businessId, scope.id);
    assert.equal(after.available, true); assert.deepEqual(after.record, saved.record);
    assert.equal((await owner.readDiscoveryR12Workspace(context, f.businessId, scope.id)).record.policyRevoked, true);
    assert.equal(posts, 5); assert.equal(gets, 6);
    return { providerCalls: 0, inertPosts: posts, inertReceiptGets: gets, outcome: saved.record.review.outcome, phaseReceipts: saved.record.phaseReceipts.length };
  } finally {
    for (const [key, value] of Object.entries(oldEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}
