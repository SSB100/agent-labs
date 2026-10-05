import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSource } from './helpers/guided-ui.mjs';
import * as guard from '../.core-tests/core/quest-intake.js';

const business = '00000000-0000-4000-8000-000000000001';
const submission = '00000000-0000-4000-8000-000000000002';
const contract = loadSource('src/core/quest-contract.ts');
function action({ signedIn = true, error = null } = {}) {
  const calls = [];
  let clients = 0;
  const api = loadSource('src/app/dashboard/quests/actions.ts', {
    '@/core/quest-contract': contract,
    '@/core/quest-intake': guard,
    '@/lib/supabase/server': { createClient: async () => {
      clients++;
      return { auth: { getClaims: async () => ({ data: { claims: signedIn ? { sub: 'owner' } : null }, error: null }) },
        rpc: async (name, args) => { calls.push({ name, args }); return { data: { id: submission, executionAvailable: false }, error }; } };
    } },
  });
  return { ...api, calls, clients: () => clients };
}

test('R04 action rejects raw multiline and nested secrets before opening a client', async () => {
  for (const secret of ['password\ncorrect-horse', 'secret=private-value', 'Authorization: Basic c2VjcmV0OnNlY3JldA==']) {
    const api = action();
    const result = await api.saveQuestIntent(business, 'envelope.propose', { envelope: { purposes: [secret] } }, submission);
    assert.equal(result.ok, false);
    assert.match(result.message, /Credential-like/);
    assert.equal(api.clients(), 0);
    assert.equal(api.calls.length, 0);
    assert.ok(!JSON.stringify(result).includes(secret));
  }
});

test('R04 action requires owner session and validates request identity before RPC', async () => {
  const signedOut = action({ signedIn: false });
  assert.equal((await signedOut.saveQuestIntent(business, 'quest.select', {}, submission)).ok, false);
  assert.equal(signedOut.calls.length, 0);
  const malformed = action();
  assert.equal((await malformed.saveQuestIntent('other', 'quest.select', {}, submission)).ok, false);
  assert.equal(malformed.clients(), 0);
  assert.equal((await malformed.saveQuestIntent(business, 'dispatch', {}, submission)).ok, false);
  assert.equal(malformed.clients(), 0);
});

test('R04 action forwards exact Business, revision and stable submission; no dispatch dependency is reachable', async () => {
  const api = action();
  const payload = { goalId: submission, expectedRevision: 4 };
  for (let n = 0; n < 2; n++) assert.equal((await api.saveQuestIntent(business, 'quest.select', payload, submission)).ok, true);
  assert.equal(api.calls.length, 2);
  for (const call of api.calls) {
    assert.equal(call.name, 'r04_quest_transition');
    assert.equal(call.args.p_business_id, business);
    assert.equal(call.args.p_submission_id, submission);
    assert.equal(call.args.p_payload.expectedRevision, 4);
    assert.equal(call.args.p_payload.goalId, submission);
  }
});

test('R04 database errors never echo submitted content or internal diagnostics', async () => {
  const api = action({ error: { message: 'sensitive-database-diagnostic' } });
  const result = await api.saveQuestIntent(business, 'quest.select', {}, submission);
  assert.equal(result.ok, false);
  assert.ok(!result.message.includes('sensitive-database-diagnostic'));
  assert.match(result.message, /could not be verified/);
});
