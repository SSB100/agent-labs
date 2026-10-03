import { ownerBusiness, historyRead, accountHistoryResponse, historyResponse } from './helpers/history-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const require = createRequire(import.meta.url), ts = require('typescript');
function load(path, dependencies, globals = {}) {
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const m = { exports: {} };
  runInNewContext(`(function(require,module,exports){${code}\n})`, { URLSearchParams, ...globals })(name => {
    if (name.endsWith('/owner-business')) return ownerBusiness;
    if (name === '../lib/core-ui/history-read') return historyRead;
    assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name];
  }, m, m.exports); return m.exports;
}
const C = load('src/accounts/contracts.ts', { 'node:crypto': require('node:crypto') });
const businessId = '10000000-1111-4111-8111-111111111111', runId = '20000000-1111-4111-8111-111111111111', connectionId = '30000000-1111-4111-8111-111111111111', revision = '40000000-1111-4111-8111-111111111111', foreignId = '50000000-1111-4111-8111-111111111111';
const profile = { email: 'owner@example.test', givenName: 'Ada', familyName: 'Lovelace', countryCode: 'NZ', locale: 'en-NZ', revision };
const plain = value => JSON.parse(JSON.stringify(value));
function run(overrides = {}) {
  const disclosure = C.buildAccountDisclosure(profile, overrides.provider ?? 'printful', overrides.mode ?? 'connect');
  return { businessId, id: runId, connectionId, provider: 'printful', mode: 'connect', status: 'owner_handoff', revision: 3, disclosure, disclosureHash: C.accountDigest(disclosure), approvalExpiresAt: '2026-10-02T12:00:00Z', createdAt: '2026-10-01T12:00:00Z', receipt: null, ...overrides };
}
function harness(options = {}) {
  const calls = [], providerCalls = [], logs = [], ownershipReads = [];
  const current = options.run ?? run();
  const context = { userId: '96060000-0000-4000-8000-000000000090', businesses: options.businesses ?? [{ id: businessId }], supabase: { from(table) {
    assert.equal(table, 'businesses'); const filters = []; const q = { select(columns) { assert.equal(columns, 'id,name,created_at,updated_at'); return q; }, eq(key, value) { filters.push([key,value]); return q; }, async maybeSingle() { ownershipReads.push(filters); return options.ownerResult ?? { data: null }; } }; return q;
  }, rpc: async (name, args) => {
    calls.push({ name, args });
    if (options.rpc) { const response = await options.rpc(name, args); return name === 'r06_read' && response?.data && !('items' in response.data) ? accountHistoryResponse(args, response.data) : response; }
    return name === 'r06_read' ? accountHistoryResponse(args, { profile, accounts: options.accounts ?? [], runs: [current], healthEvents: [] }) : { data: { run: current } };
  } } };
  const deps = {
    'server-only': {}, 'node:crypto': require('node:crypto'), './contracts': C,
    '../etsy/server': {
      etsyRpc: async (_context, id, operation) => { providerCalls.push(['etsyRpc', id, operation]); return { revision }; },
      etsyConfig: () => ({ keystring: 'test-key', serverKey: 'etsy-test-server-authority' }),
      resolveEtsyConnection: async (_context, id) => { providerCalls.push(['resolveEtsyConnection', id]); return { accessToken: 'never-render-this-etsy-token', userId: 123, shopId: 456, currency: 'NZD', expiresAt: '2026-10-02T12:00:00Z', connectionId, revision }; },
    },
    '../etsy/oauth': { discoverShop: async (config, tokens) => { providerCalls.push(['discoverShop', config, tokens]); if (options.shopError) throw options.shopError; return options.shop ?? { shopId: 456, currency: 'NZD' }; } },
    '../printful/adapter': { PrintfulCatalogAdapter: class { constructor(value) { this.options = value; } } },
    './printful': {
      verifyPrintfulConnection: async input => { providerCalls.push(['verifyPrintfulConnection', input]); if (options.verificationError) throw options.verificationError; return { secret: { credential: input.credential }, binding: { verifiedAt: '2026-10-01T12:00:00Z', storeId: input.storeId, storeKind: input.storeKind, expiresAt: input.expiresAt, providerScopes: ['stores_list/read'] } }; },
      printfulAccountReadAuthorization: input => input,
    },
    './registration': { prepareAccountRegistration: async (input, dependencies) => { providerCalls.push(['prepareAccountRegistration', input]); if (options.registration) return options.registration(input, dependencies); return { outcome: 'needs_owner', performedFields: ['email', 'givenName'], reasonCode: 'account_owner_password_required', termsState: 'not_accepted', secureResumeAvailable: true }; } },
    './browserbase': { getAccountBrowserbaseStatus: () => ({ available: options.browserAvailable ?? false, reasonCode: 'synthetic_status' }), createAccountBrowserbaseTransport: input => { providerCalls.push(['createAccountBrowserbaseTransport', input]); return { saveHandoff: input.saveHandoff }; }, releaseAccountBrowserbaseSession: async id => { providerCalls.push(['releaseAccountBrowserbaseSession', id]); if (options.releaseError) throw options.releaseError; } },
    './vault': { unsealAccountSecret: (envelope, binding) => { providerCalls.push(['unseal', envelope, binding]); return options.handoff; }, sealAccountSecret: (secret, binding, key) => { providerCalls.push(['seal', secret, binding, key]); return 'account-v1.synthetic-encrypted-envelope'; } },
  };
  const env = options.env ?? { ACCOUNTS_SERVER_KEY: 's'.repeat(32), ACCOUNTS_VAULT_KEY: '1'.repeat(64) };
  return { context, calls, providerCalls, logs, ownershipReads, ...load('src/accounts/server.ts', deps, { URL, process: { env }, console: { log: (...args) => logs.push(args), error: (...args) => logs.push(args), warn: (...args) => logs.push(args) } }) };
}

test('workspace read requires owned UUID before any RPC and uses no mutation authority', async () => {
  const h = harness();
  for (const id of ['malformed', foreignId, '']) await assert.rejects(h.loadAccountWorkspace(h.context, id), /account_owner_required/);
  assert.equal(h.calls.length, 0);
  const result = await h.loadAccountWorkspace(h.context, businessId);
  assert.equal(result.unavailable, false); assert.equal(result.profile.revision, revision);
  assert.deepEqual(h.calls.map(c => c.args.p_dataset), ['account_state', 'account_runs', 'account_health']);
  assert.ok(h.calls.every(c => c.name === 'r06_read' && !('p_server_key' in c.args))); assert.equal(h.calls[0].args.p_business_id, businessId);
});

test('database outage or malformed/foreign durable data is unavailable, never an authoritative empty registry', async () => {
  for (const response of [ { error: { message: 'private sql body with token' } }, { data: {} }, { data: { profile, accounts: [], runs: [run({ businessId: foreignId })], healthEvents: [] } }, { data: { profile: { ...profile, revision: 'bad' }, accounts: [], runs: [], healthEvents: [] } } ]) {
    const h = harness({ rpc: async () => response }), view = await h.loadAccountWorkspace(h.context, businessId);
    assert.equal(view.unavailable, true); assert.equal(view.profile, null); assert.deepEqual(plain(view.accounts), []);
    assert.doesNotMatch(JSON.stringify(view), /private sql|token/); assert.deepEqual(h.logs, []);
  }
});

test('account setup, vault and unrelated provider flags are independent fail-closed gates', async () => {
  for (const [env, configured, vaultConfigured] of [ [{}, false, false], [{ ETSY_SERVER_KEY: 'e'.repeat(64), STEEL_API_KEY: 'steel', BROWSERBASE_API_KEY: 'browser' }, false, false], [{ ACCOUNTS_SERVER_KEY: 's'.repeat(32) }, true, false], [{ ACCOUNTS_VAULT_KEY: '1'.repeat(64) }, false, false], [{ ACCOUNTS_SERVER_KEY: 's'.repeat(32), ACCOUNTS_VAULT_KEY: '1'.repeat(64) }, true, true] ]) {
    const h = harness({ env }); assert.equal(h.accountsConfigured(), configured); assert.equal(h.accountVaultConfigured(), vaultConfigured);
    if (!configured) { await assert.rejects(h.accountRpc(h.context, businessId, 'prepare', {}), /account_setup_unavailable/); assert.equal(h.calls.length, 0); }
  }
});

test('profile save binds exact expected revision and filters no malicious fields into persistence', async () => {
  const h = harness(), data = Object.fromEntries(Object.entries(profile).filter(([key]) => key !== 'revision'));
  await h.saveAccountProfile(h.context, businessId, data, revision);
  assert.deepEqual(h.calls.map(c => c.args.p_dataset ?? c.args.p_operation), ['account_state', 'account_runs', 'account_health', 'save_profile']); assert.deepEqual(plain(h.calls.find(c => c.args.p_payload).args.p_payload), { profile: data, expectedRevision: revision });
  for (const [p, r] of [[{ ...data, password: 'secret' }, revision], [data, 'stale-but-malformed']]) await assert.rejects(h.saveAccountProfile(h.context, businessId, p, r));
  assert.equal(h.calls.filter(c => c.args.p_operation === 'save_profile').length, 1);
});

test('prepare binds current authoritative profile revision, exact disclosure and finite expiry', async () => {
  const h = harness(); await h.prepareAccountSetup(h.context, businessId, 'etsy', 'create', runId);
  const payload = h.calls.find(c => c.args.p_payload).args.p_payload;
  assert.deepEqual(h.calls.map(c => c.args.p_dataset ?? c.args.p_operation), ['account_state', 'account_runs', 'account_health', 'prepare']);
  assert.equal(payload.idempotencyKey, runId); assert.equal(payload.profileRevision, revision); assert.equal(payload.approvalTtlSeconds, 1800);
  assert.equal(payload.disclosure.disclosedData.email, profile.email); assert.deepEqual(plain(payload.disclosure.profileFields), ['email', 'givenName']);
  const failed = harness({ rpc: async () => ({ error: { message: 'unavailable' } }) });
  await assert.rejects(failed.prepareAccountSetup(failed.context, businessId, 'etsy', 'create', runId), /account_profile_required/);
  assert.deepEqual(failed.calls.map(c => c.args.p_dataset ?? c.args.p_operation), ['account_state', 'account_runs', 'account_health']);
});

test('approval forwards exact review bindings; malformed and stale approvals never invent fresh authority', async () => {
  const input = { runId, revision: 3, disclosureHash: 'a'.repeat(64), acceptTerms: true, browserConsent: true };
  const h = harness(); await h.approveAccountSetup(h.context, businessId, input);
  assert.deepEqual(plain(h.calls[0].args.p_payload), input);
  for (const override of [{ revision: -1 }, { revision: 0.5 }, { revision: NaN }, { runId: 'bad' }, { disclosureHash: '' }]) await assert.rejects(h.approveAccountSetup(h.context, businessId, { ...input, ...override }), /account_review_required/);
  assert.equal(h.calls.length, 1);
  const stale = harness({ rpc: async () => ({ error: { message: 'stale profile/approval with private data' } }) });
  await assert.rejects(stale.approveAccountSetup(stale.context, businessId, input), error => error.code === 'account_state_unavailable' && !error.message.includes('private'));
  assert.deepEqual(stale.calls.map(c => c.args.p_dataset ?? c.args.p_operation), ['approve']);
});

test('Printful token goes to independent verification and encrypted vault only, never durable plaintext or logs', async () => {
  const h = harness(), credential = 'top-secret-printful-owner-token';
  await h.connectPrintfulAccount(h.context, businessId, { runId, credential, storeId: 987, storeKind: 'manual_api', expiresAt: '2026-10-02T12:00:00Z' });
  assert.equal(h.providerCalls[0][0], 'verifyPrintfulConnection'); assert.equal(h.providerCalls[0][1].credential, credential);
  assert.equal(h.providerCalls[1][0], 'seal'); assert.equal(h.providerCalls[1][2].businessId, businessId); assert.equal(h.providerCalls[1][2].connectionId, connectionId);
  const evidence = h.calls.find(c => c.args.p_operation === 'verify').args.p_payload.evidence;
  assert.equal(evidence.credentialEnvelope, 'account-v1.synthetic-encrypted-envelope'); assert.equal(evidence.verifiedBy, 'provider_api_readback');
  assert.deepEqual(plain(evidence.scopes), ['catalog.read']); assert.deepEqual(plain(evidence.providerScopes), ['stores_list/read']);
  assert.doesNotMatch(JSON.stringify(h.calls), /top-secret-printful-owner-token/); assert.deepEqual(h.logs, []);
});

test('unapproved or other-provider Printful requests cannot read provider or store credentials', async () => {
  for (const record of [run({ status: 'pending_approval' }), run({ provider: 'etsy' }), run({ mode: 'create', status: 'approved' })]) {
    const h = harness({ run: record });
    await assert.rejects(h.connectPrintfulAccount(h.context, businessId, { runId, credential: 'secret-value', storeId: 1, storeKind: 'manual_api', expiresAt: '2026-10-02T12:00:00Z' }), /account_approval_required/);
    assert.deepEqual(h.providerCalls, []); assert.equal(h.calls.some(c => c.args.p_operation === 'verify'), false);
  }
});

test('Etsy verification makes actual independent provider readback and persists no OAuth token', async () => {
  const h = harness({ run: run({ provider: 'etsy' }) }); await h.verifyEtsyAccount(h.context, businessId, runId);
  assert.deepEqual(h.providerCalls.map(c => c[0]), ['resolveEtsyConnection', 'discoverShop']);
  assert.equal(h.providerCalls[1][2].accessToken, 'never-render-this-etsy-token');
  const verify = h.calls.find(c => c.args.p_operation === 'verify');
  assert.equal(verify.args.p_payload.evidence.etsyConnectionId, connectionId); assert.equal(verify.args.p_payload.evidence.connectionRevision, revision);
  assert.equal(verify.args.p_payload.evidence.verifiedBy, 'provider_api_readback');
  assert.doesNotMatch(JSON.stringify(h.calls), /never-render-this-etsy-token/); assert.deepEqual(h.logs, []);
});

test('Etsy changed identity or failed readback never persists a false verified receipt', async () => {
  for (const options of [{ shop: { shopId: 789, currency: 'NZD' } }, { shop: { shopId: 456, currency: 'USD' } }, { shopError: new Error('synthetic provider unavailable') }]) {
    const h = harness({ run: run({ provider: 'etsy' }), ...options }); await assert.rejects(h.verifyEtsyAccount(h.context, businessId, runId));
    assert.equal(h.calls.some(c => c.args.p_operation === 'verify'), false); assert.equal(h.providerCalls.filter(c => c[0] === 'discoverShop').length, 1);
  }
});

test('Etsy revocation uses a single atomic owner transition with exact current revision and separate server authority', async () => {
  const h = harness(); await h.revokeAccount(h.context, businessId, 'etsy', revision);
  assert.deepEqual(h.calls.map(c => c.args.p_dataset ?? c.args.p_operation), ['account_state', 'account_runs', 'account_health', 'revoke']);
  assert.deepEqual(plain(h.calls.find(c => c.args.p_payload).args.p_payload), { provider: 'etsy', expectedConnectionRevision: revision, etsyServerKey: 'etsy-test-server-authority' });
  assert.deepEqual(h.providerCalls, []);
  await assert.rejects(h.revokeAccount(h.context, foreignId, 'etsy', revision), /account_owner_required/); assert.equal(h.calls.length, 4);
  const stale = harness({ rpc: async (name) => name === 'r06_read' ? { data: { profile, accounts: [], runs: [], healthEvents: [] } } : { error: { message: 'stale-etsy-revision-private-body' } } });
  await assert.rejects(stale.revokeAccount(stale.context, businessId, 'etsy', foreignId), /account_state_unavailable/);
  assert.deepEqual(stale.calls.map(c => c.args.p_dataset ?? c.args.p_operation), ['account_state', 'account_runs', 'account_health', 'revoke']); assert.deepEqual(stale.providerCalls, []);
  const printful = harness(); await printful.revokeAccount(printful.context, businessId, 'printful', revision);
  assert.equal('etsyServerKey' in printful.calls.find(c => c.args.p_payload).args.p_payload, false);
});

const passwordInput = { provider: 'printful', connectionId, expectedConnectionRevision: revision, expectedPasswordRevision: null, username: ' owner@example.test ', password: 'unique-owner-password', confirmPassword: 'unique-owner-password' };
const connected = { id: connectionId, provider: 'printful', status: 'connected', revision, passwordStored: false, passwordRevision: null };
test('optional owner password storage encrypts distinct provider namespace and never contacts provider or persists plaintext', async () => {
  const h = harness({ accounts: [connected] }); await h.saveOwnerAccountPassword(h.context, businessId, passwordInput);
  assert.deepEqual(h.calls.map(c => c.args.p_dataset ?? c.args.p_operation), ['account_state', 'account_runs', 'account_health', 'save_password']);
  assert.deepEqual(h.providerCalls.map(c => c[0]), ['seal']);
  const sealed = h.providerCalls[0];
  assert.equal(sealed[1].password, passwordInput.password); assert.equal(sealed[1].username, passwordInput.username.trim());
  assert.equal(sealed[1].providerVerified, false); assert.equal(sealed[2].provider, 'printful_password'); assert.equal(sealed[2].connectionId, connectionId);
  const payload = h.calls.find(c => c.args.p_payload).args.p_payload;
  assert.equal(payload.expectedConnectionRevision, revision); assert.equal(payload.expectedPasswordRevision, null); assert.equal(payload.passwordRevision, sealed[2].revision);
  assert.match(payload.envelope, /^account-v1\./); assert.doesNotMatch(JSON.stringify(h.calls), /unique-owner-password|owner@example/); assert.deepEqual(h.logs, []);
});

test('owner password storage requires double entry, length, current verified connection and both CAS revisions', async () => {
  for (const override of [{ password: 'short', confirmPassword: 'short' }, { confirmPassword: 'different-password' }, { password: 'x'.repeat(1025), confirmPassword: 'x'.repeat(1025) }, { username: '' }, { username: 'owner\n@example.test' }, { expectedPasswordRevision: 'invalid' }, { connectionId: foreignId }, { expectedConnectionRevision: foreignId }, { expectedPasswordRevision: foreignId }]) {
    const h = harness({ accounts: [connected] }); await assert.rejects(h.saveOwnerAccountPassword(h.context, businessId, { ...passwordInput, ...override }));
    assert.equal(h.calls.some(c => c.args.p_operation === 'save_password'), false); assert.deepEqual(h.providerCalls, []);
  }
  for (const account of [{ ...connected, status: 'revoked' }, { ...connected, provider: 'etsy' }, { ...connected, passwordRevision: foreignId }]) {
    const h = harness({ accounts: [account] }); await assert.rejects(h.saveOwnerAccountPassword(h.context, businessId, passwordInput), /account_revision_changed/); assert.deepEqual(h.providerCalls, []);
  }
  const foreign = harness({ accounts: [connected] }); await assert.rejects(foreign.saveOwnerAccountPassword(foreign.context, foreignId, passwordInput), /account_owner_required/); assert.equal(foreign.calls.length, 0);
});

test('registration admission requires approved creation and separate browser activation before session or field transmission', async () => {
  for (const record of [run({ status: 'pending_approval', mode: 'create' }), run({ status: 'approved', mode: 'connect' })]) {
    const h = harness({ run: record, browserAvailable: true }); await assert.rejects(h.prepareApprovedAccountRegistration(h.context, businessId, runId), /account_approval_required/); assert.deepEqual(h.providerCalls, []);
  }
  const h = harness({ run: run({ status: 'approved', mode: 'create' }), browserAvailable: false });
  const current = await h.prepareApprovedAccountRegistration(h.context, businessId, runId); assert.equal(current.status, 'approved');
  assert.deepEqual(h.calls.map(c => c.args.p_dataset ?? c.args.p_operation), ['resume']); assert.deepEqual(h.providerCalls, []);
});

test('approved registration uses one durable reservation and encrypts the secure handoff before recording only safe receipt', async () => {
  const preparationId = foreignId, handoffId = revision, sessionId = connectionId;
  const approved = run({ mode: 'create', provider: 'etsy', status: 'approved' });
  const prepared = { ...approved, status: 'preparation_started', preparationId, revision: 4 };
  const handoff = { handoffId, sessionId, viewerUrl: 'https://www.browserbase.com/devtools-internal-secret-view', expiresAt: '2026-10-01T12:15:00Z' };
  const h = harness({ browserAvailable: true,
    rpc: async (_name, { p_operation }) => ({ data: p_operation === 'resume' ? { run: approved } : p_operation === 'registration_prepare' ? { run: prepared, preparationId, dispatchAllowed: true } : p_operation === 'owner_handoff' ? { run: { ...prepared, status: 'owner_handoff' } } : {} }),
    registration: async (_input, dependencies) => { await dependencies.transport.saveHandoff(handoff); return { outcome: 'needs_owner', performedFields: ['email', 'givenName'], reasonCode: 'owner-password', termsState: 'not_accepted', secureResumeAvailable: true }; },
  });
  const result = await h.prepareApprovedAccountRegistration(h.context, businessId, runId);
  assert.equal(result.status, 'owner_handoff');
  assert.deepEqual(h.calls.map(c => c.args.p_dataset ?? c.args.p_operation), ['resume', 'registration_prepare', 'browser_handoff_save', 'owner_handoff']);
  const input = h.providerCalls.find(c => c[0] === 'prepareAccountRegistration')[1];
  assert.equal(input.disclosureHash, approved.disclosureHash); assert.equal(input.profileRevision, revision); assert.equal(input.browserConsent, true); assert.equal(input.termsApproved, true);
  const seal = h.providerCalls.find(c => c[0] === 'seal'); assert.equal(seal[2].provider, 'browserbase_handoff'); assert.equal(seal[2].revision, preparationId);
  assert.doesNotMatch(JSON.stringify(h.calls), /devtools-internal-secret-view|viewerUrl|sessionId/);
  assert.deepEqual(plain(h.calls.at(-1).args.p_payload.receipt), { outcome: 'needs_owner', performedFields: ['email', 'givenName'], reasonCode: 'secure_owner_steps', termsState: 'not_accepted' });
});

test('duplicate reserved registration does not open another browser or resubmit fields', async () => {
  const approved = run({ mode: 'create', status: 'approved' }), prepared = { ...approved, status: 'preparation_started' };
  const h = harness({ browserAvailable: true, rpc: async (_name, { p_operation }) => ({ data: p_operation === 'resume' ? { run: approved } : { run: prepared, dispatchAllowed: false } }) });
  assert.equal((await h.prepareApprovedAccountRegistration(h.context, businessId, runId)).status, 'preparation_started'); assert.deepEqual(h.providerCalls, []);
});

test('raw browser viewer is exposed only to an owned fresh create handoff and authenticated exact envelope bindings', async () => {
  const expiresAt = new Date(Date.now() + 60_000).toISOString(), approvalExpiresAt = new Date(Date.now() + 120_000).toISOString();
  const handoff = { businessId, runId, preparationId: foreignId, handoffId: revision, sessionId: connectionId, viewerUrl: 'https://www.browserbase.com/owner-only-view', expiresAt };
  const eligible = run({ mode: 'create', status: 'owner_handoff', preparationId: foreignId, approvalExpiresAt });
  const rpc = async (_name, { p_operation }) => ({ data: p_operation === 'resume' ? { run: eligible } : { envelope: 'encrypted-viewer', handoffId: revision } });
  const h = harness({ handoff, rpc });
  assert.deepEqual(plain(await h.loadOwnerRegistrationHandoff(h.context, businessId, runId)), { provider: 'printful', viewerUrl: handoff.viewerUrl, expiresAt });
  assert.deepEqual(h.calls.map(c => c.args.p_dataset ?? c.args.p_operation), ['resume', 'browser_handoff_get']);
  assert.equal(h.providerCalls[0][2].provider, 'browserbase_handoff'); assert.doesNotMatch(JSON.stringify(h.calls), /owner-only-view/);
  for (const change of [{ businessId: foreignId }, { runId: foreignId }, { preparationId: revision }, { handoffId: foreignId }, { sessionId: 'invalid' }, { viewerUrl: 'https://www.browserbase.com.evil.test/view' }, { viewerUrl: 'http://www.browserbase.com/view' }, { viewerUrl: 'https://user:secret@www.browserbase.com/view' }, { expiresAt: new Date(Date.now() - 1).toISOString() }, { expiresAt: new Date(Date.now() + 180_000).toISOString() }]) {
    const invalid = harness({ handoff: { ...handoff, ...change }, rpc }); await assert.rejects(invalid.loadOwnerRegistrationHandoff(invalid.context, businessId, runId), /account_handoff_(?:invalid|expired)/);
  }
  const foreign = harness({ handoff, rpc }); await assert.rejects(foreign.loadOwnerRegistrationHandoff(foreign.context, foreignId, runId), /account_owner_required/); assert.equal(foreign.calls.length, 0);
});

test('account Needs You summary uses owned workspaces, preserves uncertainty, and excludes completed setup', async () => {
  for (const status of ['pending_approval', 'approved', 'preparation_started', 'owner_handoff']) {
    const h = harness({ run: run({ status }) }), summary = await h.loadAccountSetupInterventions(h.context);
    assert.equal(summary.unavailable, false); assert.equal(summary.records.length, 1); assert.equal(summary.records[0].businessId, businessId);
    assert.ok(h.calls.every(c => c.name === 'r06_read' && c.args.p_business_id === null && c.args.p_dataset === 'account_unresolved'));
    assert.doesNotMatch(JSON.stringify(summary), /credential|accessToken|viewerUrl|owner@example/);
  }
  for (const status of ['verified', 'cancelled', 'expired', 'invalidated']) {
    const h = harness({ run: run({ status }) }); assert.equal((await h.loadAccountSetupInterventions(h.context)).records.length, 0);
  }
  const failed = harness({ rpc: async () => ({ error: { message: 'private detail' } }) }); assert.equal((await failed.loadAccountSetupInterventions(failed.context)).unavailable, true);
});

test('registration callback rechecks exact durable state before each next provider operation and rejects an owner cancellation', async () => {
  const approved = run({ mode: 'create', provider: 'etsy', status: 'approved' });
  let current = approved, ordinaryActions = 0;
  const h = harness({ browserAvailable: true,
    rpc: async (_name, { p_operation }) => {
      if (p_operation === 'resume') return { data: { run: current } };
      if (p_operation === 'registration_prepare') { current = { ...approved, status: 'preparation_started', preparationId: foreignId, revision: 4 }; return { data: { run: current, preparationId: foreignId, dispatchAllowed: true } }; }
      if (p_operation === 'owner_handoff') return { error: { message: 'cancelled owner run' } };
      return { data: {} };
    },
    registration: async (_input, dependencies) => {
      assert.equal(typeof dependencies.assertCurrent, 'function');
      await dependencies.assertCurrent(); ordinaryActions++;
      current = { ...current, status: 'cancelled', revision: 5 };
      await assert.rejects(dependencies.assertCurrent());
      return { outcome: 'needs_owner', performedFields: ['email'], reasonCode: 'account_approval_revoked', termsState: 'not_accepted', secureResumeAvailable: false };
    },
  });
  await assert.rejects(h.prepareApprovedAccountRegistration(h.context, businessId, runId), /account_handoff_unavailable/);
  assert.equal(ordinaryActions, 1);
  assert.equal(h.calls.some(c => c.args.p_operation === 'browser_handoff_save'), false);
  assert.ok(h.calls.filter(c => c.args.p_operation === 'resume').length >= 3);
});

test('registration callback rejects changed revision, reservation or exact disclosure before further work', async () => {
  for (const change of [{ revision: 9 }, { preparationId: revision }, { disclosureHash: 'f'.repeat(64) }, { disclosure: C.buildAccountDisclosure({ ...profile, revision: foreignId }, 'printful', 'create') }]) {
    const approved = run({ mode: 'create', status: 'approved' }); let current = approved;
    const h = harness({ browserAvailable: true,
      rpc: async (_name, { p_operation }) => {
        if (p_operation === 'resume') return { data: { run: current } };
        if (p_operation === 'registration_prepare') { current = { ...approved, status: 'preparation_started', preparationId: foreignId, revision: 4 }; return { data: { run: current, preparationId: foreignId, dispatchAllowed: true } }; }
        return { data: { run: current } };
      },
      registration: async (_input, dependencies) => {
        current = { ...current, ...change };
        await assert.rejects(dependencies.assertCurrent());
        return { outcome: 'needs_owner', performedFields: [], reasonCode: 'account_approval_revoked', termsState: 'not_accepted', secureResumeAvailable: false };
      },
    });
    await h.prepareApprovedAccountRegistration(h.context, businessId, runId);
    assert.equal(h.calls.some(c => c.args.p_operation === 'browser_handoff_save'), false);
  }
});

test('password removal binds owner, exact account and saved-password revision without decryption or provider calls', async () => {
  const input = { provider: 'printful', connectionId, expectedPasswordRevision: revision };
  const h = harness({ env: { ACCOUNTS_SERVER_KEY: 's'.repeat(32) } });
  await h.deleteOwnerAccountPassword(h.context, businessId, input);
  assert.deepEqual(h.calls.map(c => c.args.p_dataset ?? c.args.p_operation), ['delete_password']); assert.deepEqual(plain(h.calls[0].args.p_payload), input);
  assert.deepEqual(h.providerCalls, []);
  await assert.rejects(h.deleteOwnerAccountPassword(h.context, foreignId, input), /account_owner_required/);
  for (const change of [{ connectionId: 'bad' }, { expectedPasswordRevision: 'bad' }, { expectedPasswordRevision: null }, { provider: 'other' }]) await assert.rejects(h.deleteOwnerAccountPassword(h.context, businessId, { ...input, ...change }));
  assert.equal(h.calls.length, 1);
});

test('stale or foreign-account password deletion is never retried or treated as success', async () => {
  for (const input of [{ provider: 'printful', connectionId: foreignId, expectedPasswordRevision: revision }, { provider: 'printful', connectionId, expectedPasswordRevision: foreignId }]) {
    const h = harness({ rpc: async () => ({ error: { message: 'stale or foreign private-password-record' } }) });
    await assert.rejects(h.deleteOwnerAccountPassword(h.context, businessId, input), error => error.code === 'account_state_unavailable' && !error.message.includes('private-password'));
    assert.equal(h.calls.length, 1); assert.deepEqual(plain(h.calls[0].args.p_payload), input); assert.deepEqual(h.providerCalls, []); assert.deepEqual(h.logs, []);
  }
});

test('registration viewer never decrypts or exposes a session outside the approved create owner-handoff state', async () => {
  for (const override of [{ status: 'pending_approval' }, { status: 'approved' }, { status: 'preparation_started' }, { status: 'verified' }, { status: 'cancelled' }, { status: 'expired' }, { mode: 'connect' }, { preparationId: null }]) {
    const h = harness({ run: run({ mode: 'create', status: 'owner_handoff', preparationId: foreignId, ...override }) });
    await assert.rejects(h.loadOwnerRegistrationHandoff(h.context, businessId, runId), /account_handoff_unavailable/);
    assert.deepEqual(h.calls.map(c => c.args.p_dataset ?? c.args.p_operation), ['resume']); assert.deepEqual(h.providerCalls, []);
  }
});


test('unresolved account pages use independent totals rather than a capped historical window', async () => {
  for (const count of [49, 50]) {
    const rows = Array.from({ length: count }, (_, index) => run({ id: `20000000-1111-4111-8111-${String(index).padStart(12, '0')}`, status: 'pending_approval' }));
    const h = harness({ rpc: async (_name, args) => historyResponse(args, rows) });
    const summary = await h.loadAccountSetupInterventions(h.context);
    assert.equal(summary.records.length, 25); assert.equal(summary.globalCount, count);
    assert.equal(summary.page.hasNext, true); assert.equal(summary.unavailable, false); assert.deepEqual(h.providerCalls, []);
  }
  const h = harness({ rpc: async (_name, args) => historyResponse(args, [], { overrides: { ownerTotal: null } }) });
  assert.equal((await h.loadAccountSetupInterventions(h.context)).unavailable, true);
});


test('off-directory owned account read and exact approval use independent ownership; foreign and outage stop before provider or RPC', async () => {
  const h = harness({ businesses: [], ownerResult: { data: { id: businessId, name: 'Owned beyond directory page' } } });
  assert.equal((await h.loadAccountWorkspace(h.context, businessId)).unavailable, false);
  const input = { runId, revision: 3, disclosureHash: 'a'.repeat(64), acceptTerms: true, browserConsent: true };
  await h.approveAccountSetup(h.context, businessId, input);
  assert.deepEqual(h.ownershipReads, [[['id',businessId],['owner_user_id',h.context.userId]]]);
  assert.deepEqual(h.calls.map(c => c.args.p_dataset ?? c.args.p_operation), ['account_state','account_runs','account_health','approve']);
  assert.deepEqual(plain(h.calls.at(-1).args.p_payload), input); assert.deepEqual(h.providerCalls, []);
  for (const ownerResult of [{ data: null }, { data: null, error: { message: 'private transport outage' } }]) {
    const denied = harness({ businesses: [], ownerResult });
    await assert.rejects(denied.loadAccountWorkspace(denied.context,businessId), /account_owner_required/);
    await assert.rejects(denied.approveAccountSetup(denied.context,businessId,input), /account_owner_required/);
    assert.deepEqual(denied.calls, []); assert.deepEqual(denied.providerCalls, []); assert.equal(denied.context.businesses.length, 0);
  }
});
