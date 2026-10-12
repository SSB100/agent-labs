/** Thin extension of the existing isolated Next boundary for NEW POD authority.
 * The production SQL, owner actions, controller, adapter and Workflow host remain
 * real. Only auth/Supabase transport and public provider responses are inert. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { createHash, createHmac } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixtureBoundary } from './server.mjs';
import { r12FixtureState, mirrorR12, R12_INERT_ROOT } from './r12-sql.mjs';
import { r04SqlBootstrap } from '../helpers/r04-sql-bootstrap.mjs';
import { sessionBootstrap } from '../helpers/r10-sql-fixture.mjs';
import { podSqlFixture, podInertOutputs } from '../helpers/r12-pod-sql-fixture.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
export const POD_INERT_RELEASE = { VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40), VERCEL_DEPLOYMENT_ID: 'dpl_inert_pod_next' };
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
  return { db, seeded };
}
export async function startPodNextBoundary(host) {
  const { db, seeded } = await seedPodNextDatabase(host), base = await startFixtureBoundary(), state = base.state();
  state.r12 = await r12FixtureState(db, { ownerId: seeded.ownerId, businessId: seeded.businessId, goalId: seeded.goalId, scopeId: null, outputs: podInertOutputs() }, 'pod-goal');
  state.owner = seeded.ownerId; await mirrorR12(state); state.businesses = state.db.businesses;
  state.db.profiles = [{ id: seeded.ownerId, display_name: 'Inert POD owner' }];
  state.quests.rows = (await db.query('select public.r04_quest_read($1,$2,20,0) result', [seeded.businessId, seeded.goalId])).rows[0].result.quests;
  const logs = [], denied = [], waiting = []; let held = false, losePrepare = false;
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
      if (req.url === '/rpc' && ['r12_pod_research_read', 'r12_pod_owner_server'].includes(input.name)) {
        if (input.session === 'off') return send({ data: null, error: { code: '42501', message: 'Inert owner absent' } });
        const keys = input.name === 'r12_pod_research_read' ? ['p_business_id', 'p_goal_id', 'p_setup_id', 'p_submission_id'] : ['p_business_id', 'p_operation', 'p_payload', 'p_server_key'];
        logs.push({ kind: 'pod-owner-rpc', name: input.name, operation: input.args.p_operation ?? 'read' });
        const result = await sql(input.name, input.args, keys, 'authenticated');
        if (input.name === 'r12_pod_owner_server' && result.data) {
          Object.assign(state.r12, { ownerSetup: result.data, goalId: result.data.goalId, scopeId: result.data.scopeId });
          if (losePrepare && input.args.p_operation === 'prepare') { losePrepare = false; return send({ data: null, error: { message: 'Synthetic saved preparation response lost' } }); }
        }
        return send(result);
      }
      if (req.url === '/rest/v1/rpc/r12_pod_runtime_read') {
        logs.push({ kind: 'actual-workflow-runtime-read', businessId: input.p_business_id, scopeId: input.p_scope_id });
        const result = await sql('r12_pod_runtime_read', input, ['p_business_id', 'p_scope_id', 'p_server_key'], 'anon');
        return result.error ? send(result.error, 400) : send(result.data);
      }
      if (req.url === '/r12/provider' && input.method === 'GET' && input.phase === 'plan' && held) await new Promise(resolve => waiting.push(resolve));
      const allowed = ['/claims', '/user', '/read', '/rpc', '/r12/quote', '/r12/provider'];
      if (!allowed.includes(req.url) && !req.url.startsWith('/rest/v1/rpc/')) { denied.push(req.url); return send({ error: 'Unknown POD fixture endpoint' }, 404); }
      const response = await fetch(base.origin + req.url, { method: req.method, headers: { 'content-type': 'application/json' }, ...(body ? { body } : {}), signal: AbortSignal.timeout(30000) });
      res.statusCode = response.status; res.setHeader('content-type', response.headers.get('content-type') ?? 'application/json'); res.end(await response.text());
    } catch (error) { logs.push({ kind: 'boundary-error', message: String(error) }); res.statusCode = 500; res.end(JSON.stringify({ error: 'Inert POD boundary failure' })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { origin: `http://127.0.0.1:${server.address().port}`, logs, denied, base, state: () => state,
    holdProvider() { held = true; }, releaseProvider() { held = false; for (const release of waiting.splice(0)) release(); },
    losePrepareReply() { losePrepare = true; },
    catalog: setupId => sql('r12_pod_research_read', { p_business_id: seeded.businessId, p_setup_id: setupId ?? null }, ['p_business_id', 'p_goal_id', 'p_setup_id', 'p_submission_id'], 'authenticated'),
    result: scopeId => sql('r12_discovery_result_read', { p_business_id: seeded.businessId, p_scope_id: scopeId }, ['p_business_id', 'p_scope_id'], 'authenticated'),
    async close() { held = false; for (const release of waiting.splice(0)) release(); await new Promise(resolve => server.close(resolve)); await base.close(); },
  };
}
