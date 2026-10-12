/** Thin extension of the existing isolated Next boundary for NEW POD authority.
 * The production SQL, owner actions, controller, adapter and Workflow host remain
 * real. Only auth/Supabase transport and public provider responses are inert. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixtureBoundary } from './server.mjs';
import { r12FixtureState, mirrorR12, R12_INERT_ROOT } from './r12-sql.mjs';
import { r04SqlBootstrap } from '../helpers/r04-sql-bootstrap.mjs';
import { sessionBootstrap } from '../helpers/r10-sql-fixture.mjs';
import { podSqlFixture, podInertOutputs, podQuoteFixture, podSource, podHash, POD_PHASES } from '../helpers/r12-pod-sql-fixture.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
export const POD_INERT_RELEASE = { VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40), VERCEL_DEPLOYMENT_ID: 'dpl_inert_pod_next' };
// Only symbolic database errors are safe for persisted diagnostics. Never log
// RPC arguments, authority material, SQL detail/context or arbitrary messages.
export function podSafeRpcError(error) {
  return { code: /^[0-9A-Z]{5}$/.test(error?.code ?? '') ? error.code : null, reason: /^r\d{2}_[a-z][a-z0-9_]{1,95}$/.test(error?.message ?? '') ? error.message : 'redacted_database_error' };
}
export function assertPodLeaseQuiet(logs, handoff) {
  const index = logs.indexOf(handoff), expiry = Date.parse(handoff.leaseExpiresAt);
  assert.ok(index >= 0 && Number.isFinite(expiry) && expiry > handoff.at, 'The real controller snapshot must expose a live prior lease');
  const premature = logs.slice(index + 1).filter(event => event.at < expiry && (
    event.kind === 'actual-workflow-runtime-read' || event.kind === 'actual-workflow-pass' ||
    event.kind === 'actual-workflow-controller-call' && event.operation !== 'read' ||
    event.kind === 'inert-pod-provider' && event.method === 'POST'
  ));
  assert.deepEqual(premature, [], 'A waiting Workflow must neither claim nor send nor spin up another runtime step before the actual lease expires');
}
export async function seedPodNextDatabase(host) {
  assert.ok(host, 'An existing isolated PGlite host is required');
  const require = createRequire(path.resolve(host, 'package.json'));
  const { PGlite } = require('@electric-sql/pglite'), { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(r04SqlBootstrap + sessionBootstrap); await db.exec("set timezone='UTC'");
  for (const file of (await readdir(path.join(root, 'supabase/migrations'))).filter(f => f.endsWith('.sql')).sort()) await db.exec(await readFile(path.join(root, 'supabase/migrations', file), 'utf8'));
  const capability = createHmac('sha256', R12_INERT_ROOT).update('r12.pod-owner-application.1').digest('base64url');
  // Set the inert capability hash at first insertion, preserving immutable history.
  const seedDb = { exec: (...args) => db.exec(...args), query: (statement, args) => {
    if (statement.startsWith('insert into private.r12_pod_templates(')) { args = [...args]; args[6] = createHash('sha256').update(capability).digest('hex'); }
    return db.query(statement, args);
  } };
  const seeded = await podSqlFixture(seedDb);
  const recoveryTemplateId = randomUUID(), recoveryPins = { ...seeded.pins, schemas: podSource('products/discovery-r12-pod-runtime').podResearchSchemaPins(true) };
  const recoveryTemplateHash = podHash({ version: 'inert-pod-recovery-template-review.1', templateId: recoveryTemplateId, sourcePolicy: seeded.sourcePolicy, pins: recoveryPins });
  // A second inert reviewed template is inserted once. The original template
  // and accepted history remain unchanged; neither seed activates permission.
  await db.query(`insert into private.r12_pod_templates(id,version,source_policy,source_policy_hash,pins,pins_hash,server_key_hash,reviewed_bundle_hash,valid_from,valid_until)
    values($1,'r12.pod-template.3',$2,$3,$4,$5,$6,$7,$8,$9)`, [recoveryTemplateId, seeded.sourcePolicy, podHash(seeded.sourcePolicy), recoveryPins, podHash(recoveryPins), createHash('sha256').update(capability).digest('hex'), recoveryTemplateHash, seeded.sourcePolicy.validFrom, seeded.sourcePolicy.validUntil]);
  return { db, seeded };
}
export function podNextFailedReview() {
  const review = podInertOutputs({ passOrdinal: 0 }).review;
  for (const index of [1, 2, 3, 4, 5]) review.checks[index].rationale = 'The source does not establish relevant independent demand, competitive advantage, fulfilment reliability, delivered economics, or rights clearance. '.repeat(2);
  review.nextTest = 'Seek independent aggregate public evidence under the approved source policy before recommending a product test. '.repeat(4);
  return review;
}
export async function podNextAudit(db, scopeId) {
  return {
    attempts: (await db.query("select a.id,a.step_key,a.status,r.content_hash response_hash from private.r07_attempts a join private.r07_plans p on p.id=a.plan_id left join private.r07_responses r on r.attempt_id=a.id where p.content->>'discoveryScopeId'=$1 order by a.step_key", [scopeId])).rows,
    observations: (await db.query('select o.request_id,o.kind,o.payload_hash from private.r12_discovery_response_observations o join private.r12_pod_pass_calls c on c.request_id=o.request_id where c.scope_id=$1 order by o.request_id,o.kind', [scopeId])).rows,
  };
}
/** Deterministic provider-only double: one weak pass, then a different-query
 * hypothesis for testing. These synthetic responses establish no real demand. */
export function podNextProvider(state, input) {
  const r = state.r12, phase = input.phase;
  assert.ok(POD_PHASES.includes(phase));
  if (input.method === 'POST') {
    assert.equal(input.url, 'https://openrouter.ai/api/v1/chat/completions');
    const pass = r.podPass; assert.ok(pass && Number.isInteger(pass.ordinal) && pass.ordinal >= 0 && pass.ordinal < 2, 'Only the real admitted first or second pass can call this inert provider');
    const ordinal = pass.ordinal, key = `${r.scopeId}:${ordinal}:${phase}`, output = podInertOutputs({ passOrdinal: ordinal, useful: ordinal === 1 });
    r.podGenerations ??= new Map(); assert.equal(r.podGenerations.has(key), false, 'A pass/phase must never regenerate');
    assert.deepEqual(input.body.provider.only, [phase === 'review' ? 'amazon-bedrock/us' : 'azure/us']); assert.equal(input.body.provider.zdr, true);
    if (phase === 'plan') {
      const payload = JSON.parse(input.body.messages[1].content);
      if (ordinal === 0) assert.equal(payload.refinement, null);
      else {
        assert.equal(payload.refinement.previousPass, 0);
        if (payload.refinement.kind === 'failed_pass_context') {
          assert.equal(payload.refinement.reviewAccepted, false); assert.equal(payload.refinement.failureKind, 'review_length_rejected');
          assert.deepEqual(payload.refinement.untrustedCritique, podNextFailedReview());
          assert.equal(payload.refinement.acceptedAssessment.recommendation.outcome, 'INSUFFICIENT_EVIDENCE');
          assert.equal(payload.refinement.acceptedOutputHashes.length, 4); assert.equal(payload.refinement.review, undefined);
          assert.match(input.body.messages[0].content, /INCOMPLETE pass, not an accepted independent review/);
        } else assert.equal(payload.refinement.review.outcome, 'INSUFFICIENT_EVIDENCE');
        assert.equal(payload.refinement.priorQueries.length, 1); assert.equal(payload.refinement.priorQueries[0].query, podInertOutputs({ passOrdinal: 0 }).plan.query); assert.notEqual(output.plan.query, payload.refinement.priorQueries[0].query);
      }
    }
    if (phase === 'search1') { assert.equal(input.body.messages[1].content, output.plan.query); assert.deepEqual(input.body.tools[0].parameters.allowed_domains, output.plan.sourceDomains); }
    const model = phase === 'review' ? 'anthropic/claude-4.5-haiku-20251001' : 'openai/gpt-5.6-luna-20260709', id = `gen-r12-pod-next-${r.scopeId}-${ordinal}-${phase}`;
    if (phase === 'review' && r.rejectNextReview) { assert.equal(ordinal, 0); output.review = podNextFailedReview(); r.rejectNextReview = false; }
    r.podGenerations.set(key, { id, model, ordinal, phase }); r.calls.push({ ordinal, phase, ...(phase === 'search1' ? { query: output.plan.query } : {}) });
    const message = phase === 'search1' ? { content: 'Explicitly synthetic bounded public source material.', annotations: output.search1.annotations } : { content: JSON.stringify(output[phase]) };
    return { status: 200, body: { id, model, choices: [{ finish_reason: 'stop', message }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, cost: 0.00001, ...(phase === 'search1' ? { server_tool_use_details: { web_search_requests: 1 } } : {}) } } };
  }
  assert.equal(input.method, 'GET');
  const parsed = new URL(input.url); assert.equal(parsed.origin + parsed.pathname, 'https://openrouter.ai/api/v1/generation');
  const saved = [...(r.podGenerations?.values() ?? [])].find(value => value.id === parsed.searchParams.get('id')); assert.ok(saved); assert.equal(saved.phase, phase);
  r.receipts.push({ ordinal: saved.ordinal, phase });
  return { status: 200, body: { data: { id: saved.id, provider_name: phase === 'review' ? 'Amazon Bedrock' : 'Azure', model: saved.model } } };
}
export async function startPodNextBoundary(host) {
  const { db, seeded } = await seedPodNextDatabase(host), base = await startFixtureBoundary(), state = base.state();
  state.r12 = await r12FixtureState(db, { ownerId: seeded.ownerId, businessId: seeded.businessId, goalId: seeded.goalId, scopeId: null, outputs: podInertOutputs({ passOrdinal: 0 }) }, 'pod-goal');
  state.owner = seeded.ownerId; await mirrorR12(state); state.businesses = state.db.businesses;
  state.db.profiles = [{ id: seeded.ownerId, display_name: 'Inert POD owner' }];
  state.quests.rows = (await db.query('select public.r04_quest_read($1,$2,20,0) result', [seeded.businessId, seeded.goalId])).rows[0].result.quests;
  const logs = [], denied = [], waiting = []; let held = false, losePrepare = false, runtimeReadOrdinal = 0, initialControllerRead = false;
  const runtimeError = (rpc, operation, status, error) => logs.push({ kind: 'actual-workflow-rpc-error', at: Date.now(), rpc, operation: operation ?? null, status, ...podSafeRpcError(error) });
  async function exclusive(fn) { const r = state.r12, previous = r.queue ?? Promise.resolve(); let release; r.queue = new Promise(resolve => { release = resolve; }); await previous; try { return await fn(); } finally { release(); } }
  async function sql(name, args, keys, role) {
    return exclusive(async () => {
      try { await db.exec(`set role ${role}`); return { data: (await db.query(`select public.${name}(${keys.map((_, i) => '$' + (i + 1)).join(',')}) result`, keys.map(k => args[k] ?? null))).rows[0].result, error: null }; }
      catch (error) { return { data: null, error: { code: '42501', message: String(error.message) } }; }
      finally { await db.exec('reset role'); await mirrorR12(state); }
    });
  }
  const server = createServer(async (req, res) => {
    try {
      let body = ''; for await (const chunk of req) body += chunk;
      const input = body ? JSON.parse(body) : {};
      const send = (data, status = 200) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(data)); };
      if (req.url === '/rpc' && ['r12_pod_research_read', 'r12_pod_owner_server', 'r12_pod_recovery_read', 'r12_pod_recovery_owner_server'].includes(input.name)) {
        if (input.session === 'off') return send({ data: null, error: { code: '42501', message: 'Inert owner absent' } });
        const keys = input.name === 'r12_pod_research_read' ? ['p_business_id', 'p_goal_id', 'p_setup_id', 'p_submission_id'] : input.name === 'r12_pod_recovery_read' ? ['p_business_id', 'p_setup_id'] : ['p_business_id', 'p_operation', 'p_payload', 'p_server_key'];
        logs.push({ kind: 'pod-owner-rpc', name: input.name, operation: input.args.p_operation ?? 'read' });
        const result = await sql(input.name, input.args, keys, 'authenticated');
        if (['r12_pod_owner_server', 'r12_pod_recovery_owner_server'].includes(input.name) && result.data) {
          Object.assign(state.r12, { ownerSetup: result.data, goalId: result.data.goalId, scopeId: result.data.scopeId });
          if (losePrepare && input.args.p_operation === 'prepare') { losePrepare = false; return send({ data: null, error: { message: 'Synthetic saved preparation response lost' } }); }
        }
        return send(result);
      }
      if (req.url === '/rest/v1/rpc/r12_pod_runtime_read') {
        runtimeReadOrdinal++; initialControllerRead = true;
        logs.push({ kind: 'actual-workflow-runtime-read', at: Date.now(), runtimeReadOrdinal, providerCalls: state.r12.calls.length });
        const result = await sql('r12_pod_runtime_read', input, ['p_business_id', 'p_scope_id', 'p_server_key'], 'anon');
        if (result.error) runtimeError('r12_pod_runtime_read', null, 400, result.error);
        return result.error ? send(result.error, 400) : send(result.data);
      }
      if (req.url === '/rest/v1/rpc/r12_pod_pass_server') {
        const keys = ['p_business_id', 'p_scope_id', 'p_operation', 'p_payload', 'p_server_key']; assert.deepEqual(Object.keys(input).sort(), [...keys].sort());
        assert.ok(['admit', 'context', 'complete'].includes(input.p_operation));
        const result = await sql('r12_pod_pass_server', input, keys, 'anon');
        logs.push({ kind: 'actual-workflow-pass', at: Date.now(), operation: input.p_operation, ordinal: result.data?.ordinal ?? input.p_payload.actionOrdinal ?? null, outcome: result.data?.outcome ?? null, completed: result.data?.completed ?? false, error: result.error ? podSafeRpcError(result.error).reason : null });
        if (result.error) runtimeError('r12_pod_pass_server', input.p_operation, 400, result.error);
        if (!result.error && (input.p_operation === 'context' || input.p_operation === 'admit' && result.data?.ordinal !== undefined)) state.r12.podPass = result.data;
        if (!result.error && input.p_operation === 'complete') state.r12.podPass = null;
        return result.error ? send(result.error, 400) : send(result.data);
      }
      if (req.url === '/r12/quote') { assert.equal(input.podResearch, true, 'POD uses the actual refinement quote qualifier'); state.r12.quoteReads++; return send(podQuoteFixture()); }
      if (req.url === '/r12/provider') {
        if (input.method === 'GET' && input.phase === 'plan' && held) await new Promise(resolve => waiting.push(resolve));
        logs.push({ kind: 'inert-pod-provider', at: Date.now(), method: input.method, phase: input.phase }); const result = podNextProvider(state, input); return send(result);
      }
      const allowed = ['/claims', '/user', '/read', '/rpc'];
      if (!allowed.includes(req.url) && !req.url.startsWith('/rest/v1/rpc/')) { denied.push(req.url); return send({ error: 'Unknown POD fixture endpoint' }, 404); }
      const controller = req.url === '/rest/v1/rpc/r07_controller', initialSnapshot = controller && input.p_operation === 'read' && initialControllerRead, readOrdinal = runtimeReadOrdinal;
      if (initialSnapshot) initialControllerRead = false;
      if (controller) logs.push({ kind: 'actual-workflow-controller-call', at: Date.now(), runtimeReadOrdinal: readOrdinal, operation: input.p_operation });
      const response = await fetch(base.origin + req.url, { method: req.method, headers: { 'content-type': 'application/json' }, ...(body ? { body } : {}), signal: AbortSignal.timeout(30000) });
      const responseBody = await response.text();
      if (req.url.startsWith('/rest/v1/rpc/')) {
        const data = JSON.parse(responseBody);
        if (!response.ok) runtimeError(req.url.slice('/rest/v1/rpc/'.length), input.p_operation, response.status, data);
        if (response.ok && initialSnapshot) logs.push({ kind: 'actual-workflow-controller-snapshot', at: Date.now(), runtimeReadOrdinal: readOrdinal, leaseExpiresAt: data?.head?.leaseExpiresAt ?? null, providerCalls: state.r12.calls.length, receipts: state.r12.receipts.length });
      }
      res.statusCode = response.status; res.setHeader('content-type', response.headers.get('content-type') ?? 'application/json'); res.end(responseBody);
    } catch (error) { logs.push({ kind: 'boundary-error', message: String(error) }); res.statusCode = 500; res.end(JSON.stringify({ error: 'Inert POD boundary failure' })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { origin: `http://127.0.0.1:${server.address().port}`, logs, denied, base, state: () => state,
    holdProvider() { held = true; }, releaseProvider() { held = false; for (const release of waiting.splice(0)) release(); },
    losePrepareReply() { losePrepare = true; },
    rejectNextReview() { assert.equal(state.r12.rejectNextReview, undefined); state.r12.rejectNextReview = true; },
    catalog: setupId => sql('r12_pod_research_read', { p_business_id: seeded.businessId, p_setup_id: setupId ?? null }, ['p_business_id', 'p_goal_id', 'p_setup_id', 'p_submission_id'], 'authenticated'),
    passSummary: scopeId => exclusive(async () => ({
      passes: (await db.query('select ordinal from private.r12_pod_passes where scope_id=$1 order by ordinal', [scopeId])).rows,
      closures: (await db.query('select ordinal,outcome,committed_microunits from private.r12_pod_pass_closures where scope_id=$1 order by ordinal', [scopeId])).rows,
      head: (await db.query("select h.state,h.reason from private.r07_heads h join private.r07_plans p on p.id=h.plan_id where p.content->>'discoveryScopeId'=$1", [scopeId])).rows[0] ?? null,
    })),
    result: scopeId => sql('r12_discovery_result_read', { p_business_id: seeded.businessId, p_scope_id: scopeId }, ['p_business_id', 'p_scope_id'], 'authenticated'),
    progress: scopeId => sql('r12_discovery_owner_read', { p_business_id: seeded.businessId, p_scope_id: scopeId, p_activation: false }, ['p_business_id', 'p_scope_id', 'p_activation'], 'authenticated'),
    recovery: setupId => sql('r12_pod_recovery_read', { p_business_id: seeded.businessId, p_setup_id: setupId }, ['p_business_id', 'p_setup_id'], 'authenticated'),
    audit: scopeId => exclusive(() => podNextAudit(db, scopeId)),
    async close() { held = false; for (const release of waiting.splice(0)) release(); await new Promise(resolve => server.close(resolve)); await base.close(); },
  };
}
