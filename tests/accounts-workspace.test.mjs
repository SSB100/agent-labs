import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const require = createRequire(import.meta.url), ts = require('typescript'), React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
function load(path, dependencies, globals = {}) {
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const m = { exports: {} };
  runInNewContext(`(function(require,module,exports){${code}\n})`, { URL, URLSearchParams, ...globals })(name => { assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name]; }, m, m.exports);
  return m.exports;
}
const C = load('src/accounts/contracts.ts', { 'node:crypto': require('node:crypto') });
const businessId = '10000000-1111-4111-8111-111111111111', runId = '20000000-1111-4111-8111-111111111111', connectionId = '30000000-1111-4111-8111-111111111111', revision = '40000000-1111-4111-8111-111111111111', foreignId = '50000000-1111-4111-8111-111111111111';
const profile = { email: 'owner@example.test', givenName: 'Ada', familyName: 'Lovelace', countryCode: 'NZ', locale: 'en-NZ', revision };
const plain = value => JSON.parse(JSON.stringify(value));
const noop = async () => {};
const actionNames = ['saveBusinessAccountProfile', 'requestAccountSetup', 'approveReviewedAccountSetup', 'cancelAccountSetup', 'resumeVerifiedAccountSetup', 'disconnectBusinessAccount', 'submitOwnerPrintfulCredential', 'storeOwnerWebsitePassword', 'removeOwnerWebsitePassword', 'startApprovedAccountRegistration', 'finishOwnerRegistrationSession'];
const actionStubs = Object.fromEntries(actionNames.map(name => [name, noop]));
const feedbackContract = load('src/accounts/connection-feedback.ts', {});
const printfulContract = load('src/accounts/printful.ts', { '../printful/account': {}, '../printful/contracts': {}, './vault': {} });
const feedbackUi = load('src/app/dashboard/accounts/connection-feedback.tsx', { 'react': React, 'react/jsx-runtime': require('react/jsx-runtime'), 'next/navigation': { unstable_rethrow() {} } });
const viewDependencies = {
  'react': React, 'react-dom': require('react-dom'), '@/accounts/connection-feedback': feedbackContract, './connection-feedback': feedbackUi, '../connection-feedback': feedbackUi,
  'react/jsx-runtime': require('react/jsx-runtime'),
  'next/link': ({ children, href, ...props }) => React.createElement('a', { href, ...props }, children),
  'node:crypto': require('node:crypto'), '@/accounts/contracts': C,
  '@/components/stage7/app-shell': { StatusPill: ({ status }) => React.createElement('span', { 'data-status': status }, status), AppShell: ({ children }) => React.createElement('main', null, children), PageHeader: ({ title, description, actions }) => React.createElement('header', null, title, description, actions) },
};
const { BusinessAccountWorkspace, CompactConnectionsWorkspace } = load('src/app/dashboard/accounts/account-workspace.tsx', { ...viewDependencies, './actions': actionStubs });
function setup(overrides = {}) {
  const disclosure = C.buildAccountDisclosure(profile, overrides.provider ?? 'printful', overrides.mode ?? 'connect');
  return { id: runId, connectionId, provider: 'printful', mode: 'connect', status: 'pending_approval', revision: 2, disclosure, disclosureHash: C.accountDigest(disclosure), approvalExpiresAt: '2026-10-01T12:30:00Z', createdAt: '2026-10-01T12:00:00Z', receipt: null, ...overrides };
}
const base = { businessId, configured: true, vaultConfigured: true, unavailable: false, observedAt: '2026-10-01T12:00:00Z', profile, accounts: [], runs: [], healthEvents: [] };
const render = data => renderToStaticMarkup(React.createElement(BusinessAccountWorkspace, { data }));

function actionHarness(overrides = {}) {
  const calls = [], logs = [], invalidated = [], context = { businesses: [{ id: businessId }] };
  const methods = ['accountRpc', 'saveAccountProfile', 'prepareAccountSetup', 'approveAccountSetup', 'resumeAccountSetup', 'handoffAccountConnection', 'connectPrintfulAccount', 'verifyEtsyAccount', 'revokeAccount', 'saveOwnerAccountPassword', 'deleteOwnerAccountPassword', 'prepareApprovedAccountRegistration', 'stopAccountSetup', 'releaseAccountRegistration'];
  const api = Object.fromEntries(methods.map(name => [name, async (...args) => { calls.push({ name, args }); if (overrides[name]) return overrides[name](...args); return setup({ status: 'owner_handoff' }); }]));
  const result = load('src/app/dashboard/accounts/actions.ts', {
    'node:crypto': require('node:crypto'),
    'next/navigation': { redirect: url => { const error = new Error(url); error.redirect = url; throw error; } },
    'next/cache': { revalidatePath: path => invalidated.push(path) },
    '@/lib/core-ui/data': { requireOwnerUiContext: async () => context },
    '@/accounts/server': api, '@/accounts/contracts': C, '@/accounts/connection-feedback': feedbackContract, '@/accounts/printful': printfulContract,
  }, { console: { log: (...args) => logs.push(args), error: (...args) => logs.push(args), warn: (...args) => logs.push(args) } });
  return { ...result, calls, logs, invalidated, context };
}
function form(extra = {}) { const form = new FormData(); for (const [key, value] of Object.entries({ businessId, runId, revision: '2', disclosureHash: 'a'.repeat(64), ...extra })) form.set(key, String(value)); return form; }
async function redirectFrom(promise) { try { await promise; assert.fail('Expected redirect'); } catch (error) { assert.ok(error.redirect, `Expected controlled redirect, received ${error.message}`); return error.redirect; } }
async function securePage(data = base, query = { business: businessId, run: runId }) {
  const calls = [];
  const { default: Page } = load('src/app/dashboard/accounts/secure/page.tsx', {
    ...viewDependencies,
    'next/navigation': { notFound: () => { throw new Error('not-found'); } },
    '@/lib/core-ui/data': { requireOwnerUiContext: async () => ({ businesses: [{ id: businessId }] }) },
    '@/accounts/server': { loadAccountWorkspace: async (_context, id) => { calls.push(id); return data; } },
    '@/accounts/printful': { PRINTFUL_ACCOUNT_LINKS: { tokenManagement: 'https://developers.printful.com/tokens' } },
    '../actions': actionStubs, '../accounts.css': {},
    '@/components/console/console-shell': { ConsoleShell: ({ children }) => React.createElement('main', null, children) }, '@/components/console/console-panes.css': {},
    '../account-workspace': { accountMessages: load('src/app/dashboard/accounts/account-workspace.tsx', { ...viewDependencies, './actions': actionStubs }).accountMessages },
    './secure-form': load('src/app/dashboard/accounts/secure/secure-form.tsx', { ...viewDependencies, '../actions': actionStubs }),
  });
  return { html: renderToStaticMarkup(await Page({ searchParams: Promise.resolve(query) })), calls };
}

test('workspace renders editable profile with current revision, exact review and no credential field', () => {
  const html = render({ ...base, runs: [setup({ provider: 'etsy', mode: 'create' })] });
  for (const text of ['Business accounts', 'Reusable account profile', 'owner@example.test', 'https://www.etsy.com', 'shops_r, listings_r, listings_w', 'Approve exact request', 'None. Stop for any charge']) assert.ok(html.includes(text), text);
  assert.match(html, new RegExp(`name="profileRevision" value="${revision}"`));
  for (const consent of ['dataConsent', 'accessConsent', 'termsConsent', 'browserConsent']) assert.match(html, new RegExp(`<input(?=[^>]*name="${consent}")(?=[^>]*required="")`));
  assert.match(html, /Browserbase processing/); assert.match(html, /does not mean the provider has zero operational data retention/);
  assert.doesNotMatch(html, /name="(?:credential|password|token|accessToken)"|Open secure Printful connection/);
});

test('unavailable registry states uncertainty and suppresses forms and false empty claims', () => {
  const html = render({ ...base, unavailable: true });
  assert.match(html, /Account records could not be checked/); assert.match(html, /Existing profiles, requests or connections may still exist/);
  assert.doesNotMatch(html, /<form|No Business account has been verified|No setup requests yet/);
});

test('approval expiry hides executable review and owner continuation controls', () => {
  for (const status of ['pending_approval', 'approved', 'owner_handoff']) {
    const html = render({ ...base, runs: [setup({ status, approvalExpiresAt: base.observedAt })] });
    assert.match(html, /data-status="expired"/);
    assert.doesNotMatch(html, /Approve exact request|Open secure Printful connection|Verify Etsy connection/);
    assert.match(html, /Stop setup/);
  }
});

test('provider-specific followups keep independent access and qualification gates', () => {
  const printful = render({ ...base, runs: [setup({ status: 'owner_handoff' })] });
  assert.match(printful, /Open secure Printful connection/); assert.match(printful, /stores_list\/read/); assert.doesNotMatch(printful, /Verify Etsy connection/);
  const etsy = render({ ...base, runs: [setup({ provider: 'etsy', status: 'owner_handoff' })] });
  assert.match(etsy, /Verify Etsy connection/); assert.match(etsy, /Connection approval does not authorize a listing change/); assert.doesNotMatch(etsy, /Open secure Printful connection/);
  const verified = render({ ...base, runs: [setup({ status: 'verified', receipt: { outcome: 'connected' } })] });
  assert.match(verified, /Account access does not qualify product execution or publication/); assert.doesNotMatch(verified, /Open secure Printful connection|Approve exact request/);
});

test('Printful store identity warning precedes setup preparation and exact approval', () => {
  const html = render(base);
  const provider = html.slice(html.indexOf('<h3>Printful</h3>'));
  for (const text of ['one Printful store identity per Business', 'cannot switch it, even after a local disconnect',
    'Do not bind a temporary Manual/API test store', 'ecommerce-linked Printful store already linked to the intended Etsy shop',
    'Manual/API is for custom integrations or isolated qualification', 'does not link Etsy variants', 'later Stage 22 work']) {
    assert.ok(provider.includes(text), text);
    assert.ok(provider.indexOf(text) < provider.indexOf('Prepare exact review'), `${text} must be visible before setup preparation`);
  }
  const pending = render({ ...base, runs: [setup()] });
  const review = pending.slice(pending.indexOf('<h3>Connect Printful</h3>'));
  assert.ok(review.indexOf('one Printful store identity per Business') < review.indexOf('Approve exact request'));
  assert.match(review, /do not bind a temporary Manual\/API qualification store/);
});

test('registry disconnect requires explicit consent and exact current connection revision', () => {
  const html = render({ ...base, accounts: [{ id: connectionId, provider: 'printful', status: 'connected', revision, label: 'Owner store', externalAccountId: '987', scopes: ['catalog.read'], verifiedAt: base.observedAt, expiresAt: '2026-10-02T12:00:00Z' }] });
  assert.match(html, /Connected account registry/); assert.match(html, /Owner store/);
  assert.match(html, new RegExp(`name="connectionRevision" value="${revision}"`));
  assert.match(html, /<input(?=[^>]*name="disconnectConsent")(?=[^>]*required="")/);
  assert.match(html, /provider token\/grant may also need revocation/);
});

test('profile owner action forwards exact allowed fields and expected saved revision', async () => {
  const h = actionHarness(), { revision: profileRevision, ...ordinary } = profile;
  const url = await redirectFrom(h.saveBusinessAccountProfile(form({ ...ordinary, profileRevision, credential: 'do-not-forward' })));
  assert.match(url, /accountMessage=profile-saved/);
  assert.equal(h.calls[0].name, 'saveAccountProfile'); assert.equal(h.calls[0].args[0], h.context); assert.equal(h.calls[0].args[1], businessId);
  assert.deepEqual(plain(h.calls[0].args[2]), ordinary); assert.equal(h.calls[0].args[3], revision);
  assert.doesNotMatch(JSON.stringify(h.calls), /do-not-forward/);
});

test('missing data, access, secure-entry or disconnect consent never invokes server mutation', async () => {
  for (const [action, extra] of [ ['approveReviewedAccountSetup', { dataConsent: 'on' }], ['approveReviewedAccountSetup', { accessConsent: 'on' }], ['submitOwnerPrintfulCredential', { credential: 'secret', storeKind: 'manual_api' }], ['disconnectBusinessAccount', { provider: 'printful' }] ]) {
    const h = actionHarness(), url = await redirectFrom(h[action](form(extra)));
    assert.match(url, /accountMessage=consent-required/); assert.equal(h.calls.length, 0);
  }
});

test('exact approval forwards each checkbox independently into the distinct connect or registration path', async () => {
  for (const mode of ['connect', 'create']) {
    const h = actionHarness({ approveAccountSetup: async () => setup({ mode, status: 'approved' }) });
    const url = await redirectFrom(h.approveReviewedAccountSetup(form({ dataConsent: 'on', accessConsent: 'on', termsConsent: 'on', browserConsent: 'on' })));
    assert.match(url, /accountMessage=approved/);
    assert.deepEqual(plain(h.calls[0].args[2]), { runId, revision: 2, disclosureHash: 'a'.repeat(64), acceptTerms: true, browserConsent: true });
    assert.deepEqual(h.calls.map(c => c.name), mode === 'connect' ? ['approveAccountSetup', 'handoffAccountConnection'] : ['approveAccountSetup', 'prepareApprovedAccountRegistration']);
  }
  const h = actionHarness(); await redirectFrom(h.approveReviewedAccountSetup(form({ dataConsent: 'on', accessConsent: 'on' })));
  assert.equal(h.calls[0].args[2].acceptTerms, false); assert.equal(h.calls[0].args[2].browserConsent, false);
});

test('secure owner action never includes token or provider failure body in redirects or logs', async () => {
  for (const fail of [false, true]) {
    const token = 'sensitive-owner-token-not-for-a-url';
    const h = actionHarness({ connectPrintfulAccount: async () => { if (fail) throw new Error(`raw-provider-body ${token}`); return { browserReleaseVerified: true }; } });
    const url = await redirectFrom(h.submitOwnerPrintfulCredential(form({ secureAccessConsent: 'on', credential: token, storeId: 987, storeKind: 'manual_api', expiresAt: '2026-10-02T12:00' })));
    assert.match(url, new RegExp(`accountMessage=${fail ? 'verification-unavailable' : 'verified'}`));
    assert.doesNotMatch(url, /sensitive-owner|raw-provider-body|credential|expiresAt|storeId/); assert.deepEqual(h.logs, []);
    assert.equal(h.calls[0].args[2].credential, token); assert.equal(h.calls[0].args[2].storeId, 987);
    assert.ok(h.invalidated.includes('/dashboard/accounts')); assert.ok(h.invalidated.includes('/dashboard/printful'));
  }
});

test('missing, blank and unknown store types cannot call Printful connection even with consent', async () => {
  for (const kind of [undefined, '', ' ', 'unknown', 'MANUAL_API', 'etsy']) {
    const h = actionHarness();
    const values = { secureAccessConsent: 'on', credential: 'synthetic-owner-token', storeId: 987, expiresAt: '2026-10-02T12:00' };
    if (kind !== undefined) values.storeKind = kind;
    const url = await redirectFrom(h.submitOwnerPrintfulCredential(form(values)));
    assert.match(url, /accountMessage=verification-input-invalid/);
    assert.deepEqual(h.calls, [], `No connection call for store type ${JSON.stringify(kind)}`);
    assert.deepEqual(h.logs, []);
  }
  for (const kind of ['manual_api', 'ecommerce_linked']) {
    const h = actionHarness();
    assert.match(await redirectFrom(h.submitOwnerPrintfulCredential(form({ secureAccessConsent: 'on', credential: 'synthetic-owner-token', storeId: 987, storeKind: kind, expiresAt: '2026-10-02T12:00' }))), /accountMessage=verified/);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].name, 'connectPrintfulAccount');
    assert.equal(h.calls[0].args[2].storeKind, kind);
  }
});

test('stale action errors are reduced to fixed safe messages rather than replayed or exposed', async () => {
  const h = actionHarness({ approveAccountSetup: async () => { throw new Error('stale-private-profile-and-credential'); } });
  const url = await redirectFrom(h.approveReviewedAccountSetup(form({ dataConsent: 'on', accessConsent: 'on' })));
  assert.match(url, /accountMessage=approval-unavailable/); assert.doesNotMatch(url, /stale-private/); assert.deepEqual(h.calls.map(c => c.name), ['approveAccountSetup']); assert.deepEqual(h.logs, []);
});

test('secure Printful form renders only for a fresh approved owner handoff with active vault', async () => {
  const valid = { ...base, runs: [setup({ status: 'owner_handoff' })] };
  const { html, calls } = await securePage(valid);
  assert.deepEqual(calls, [businessId]);
  assert.match(html, /<input(?=[^>]*name="credential")(?=[^>]*type="password")(?=[^>]*data-private="true")/);
  assert.match(html, /data-agent-labs-secure="true"/); assert.match(html, /autoComplete="off"/i);
  assert.match(html, /I entered this token myself/); assert.match(html, /api\.printful\.com/);
  assert.doesNotMatch(html, /name="credential"[^>]*(?:value|defaultValue)=/);
  for (const override of [ { unavailable: true }, { vaultConfigured: false }, { runs: [] }, { runs: [setup({ status: 'pending_approval' })] }, { runs: [setup({ status: 'approved' })] }, { runs: [setup({ status: 'verified' })] }, { runs: [setup({ status: 'owner_handoff', provider: 'etsy' })] }, { runs: [setup({ status: 'owner_handoff', approvalExpiresAt: base.observedAt })] }, { runs: [setup({ status: 'owner_handoff', approvalExpiresAt: 'malformed' })] } ]) {
    const { html: denied } = await securePage({ ...valid, ...override });
    assert.doesNotMatch(denied, /name="credential"|Verify and store securely/); assert.match(denied, /No credential can be submitted/);
  }
});

test('secure Printful store type starts blank and explains the durable store choice without expanding scopes', async () => {
  const { html } = await securePage({ ...base, runs: [setup({ status: 'owner_handoff' })] });
  assert.match(html, /<select(?=[^>]*name="storeKind")(?=[^>]*required="")(?=[^>]*aria-describedby="printful-store-kind-help")/);
  assert.match(html, /<option(?=[^>]*value="")(?=[^>]*disabled="")(?=[^>]*selected="")[^>]*>Choose the intended store type/);
  assert.doesNotMatch(html, /<option(?=[^>]*value="(?:manual_api|ecommerce_linked)")(?=[^>]*selected="")/);
  for (const text of ['one Printful store identity per Business', 'cannot switch it, even after a local disconnect',
    'Do not bind a temporary Manual/API test store', 'ecommerce-linked Printful store already linked to the intended Etsy shop',
    'Manual/API stores are for custom integrations or isolated qualification', 'Selecting a type here does not create an Etsy link',
    'no automatic order sync or fulfilment path yet', 'later Stage 22 work', 'Allow only stores_list/read', 'Broad, write-enabled or multi-store tokens will be rejected']) assert.ok(html.includes(text), text);
});

test('secure owner route rejects malformed and foreign Business IDs and run IDs', async () => {
  for (const query of [{ business: 'invalid', run: runId }, { business: foreignId, run: runId }, { business: businessId, run: 'invalid' }]) await assert.rejects(securePage(base, query), /not-found/);
});

async function passwordPage(data, query = { business: businessId, account: connectionId }) {
  const { default: Page } = load('src/app/dashboard/accounts/password/page.tsx', {
    ...viewDependencies, 'next/navigation': { notFound: () => { throw new Error('not-found'); } },
    '@/lib/core-ui/data': { requireOwnerUiContext: async () => ({ businesses: [{ id: businessId }] }) },
    '@/accounts/server': { loadAccountWorkspace: async () => data }, '../actions': actionStubs, '../accounts.css': {},
    '@/components/console/console-shell': { ConsoleShell: ({ children }) => React.createElement('main', null, children) }, '@/components/console/console-panes.css': {},
    '../account-workspace': { accountMessages: load('src/app/dashboard/accounts/account-workspace.tsx', { ...viewDependencies, './actions': actionStubs }).accountMessages },
    './secure-form': load('src/app/dashboard/accounts/secure/secure-form.tsx', { ...viewDependencies, '../actions': actionStubs }),
  });
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(query) }));
}
const savedAccount = { id: connectionId, provider: 'printful', status: 'connected', revision, label: 'Owner store', externalAccountId: '987', scopes: ['catalog.read'], verifiedAt: base.observedAt, expiresAt: '2026-10-02T12:00:00Z', passwordStored: true, passwordRevision: foreignId };
test('owner password page presents double entry, explicit replacement consent and no plaintext retrieval', async () => {
  const html = await passwordPage({ ...base, accounts: [savedAccount] });
  for (const name of ['password', 'confirmPassword']) assert.match(html, new RegExp(`<input(?=[^>]*name="${name}")(?=[^>]*type="password")(?=[^>]*data-private="true")`));
  assert.match(html, /<input(?=[^>]*name="passwordStorageConsent")(?=[^>]*required="")/);
  assert.match(html, /replacing its current saved password/); assert.match(html, /does not authorize sharing it with any provider or model/);
  assert.match(html, /plaintext retrieval and automatic password entry are unavailable/);
  assert.match(html, new RegExp(`name="passwordRevision" value="${foreignId}"`));
  assert.doesNotMatch(html, /name="(?:password|confirmPassword)"[^>]*(?:value|defaultValue)=/);
  for (const change of [{ unavailable: true }, { vaultConfigured: false }, { accounts: [] }, { accounts: [{ ...savedAccount, status: 'revoked' }] }]) {
    const denied = await passwordPage({ ...base, accounts: [savedAccount], ...change });
    assert.doesNotMatch(denied, /name="password"|Save encrypted password/); assert.match(denied, /No password can be submitted/);
  }
  for (const query of [{ business: foreignId, account: connectionId }, { business: 'bad', account: connectionId }, { business: businessId, account: 'bad' }]) await assert.rejects(passwordPage(base, query), /not-found/);
});

test('password storage action requires consent, exact current revisions, and fixed safe redirects', async () => {
  const values = { provider: 'printful', connectionId, connectionRevision: revision, passwordRevision: foreignId, username: 'owner@example.test', password: 'sensitive-unique-password', confirmPassword: 'sensitive-unique-password' };
  const missing = actionHarness(); assert.match(await redirectFrom(missing.storeOwnerWebsitePassword(form(values))), /consent-required/); assert.equal(missing.calls.length, 0);
  for (const fails of [false, true]) {
    const h = actionHarness({ saveOwnerAccountPassword: async () => { if (fails) throw new Error(`private response ${values.password}`); } });
    const url = await redirectFrom(h.storeOwnerWebsitePassword(form({ ...values, passwordStorageConsent: 'on' })));
    assert.match(url, new RegExp(`accountMessage=${fails ? 'password-storage-unavailable' : 'password-stored'}`));
    assert.doesNotMatch(url, /sensitive-unique-password|owner%40|private.response/); assert.deepEqual(h.logs, []);
    assert.deepEqual(plain(h.calls[0].args[2]), { provider: 'printful', connectionId, expectedConnectionRevision: revision, expectedPasswordRevision: foreignId, username: values.username, password: values.password, confirmPassword: values.confirmPassword });
  }
});

test('registration UI distinguishes an inactive provider, approval, owner handoff and provider verification', () => {
  const approved = setup({ mode: 'create', status: 'approved' });
  const disabled = render({ ...base, registrationAvailable: false, runs: [approved] });
  assert.match(disabled, /waiting for approved secure Browserbase activation/); assert.match(disabled, /<button(?=[^>]*disabled="")[^>]*>Prepare approved signup/);
  const active = render({ ...base, registrationAvailable: true, runs: [approved] });
  assert.match(active, /prepares only the listed ordinary fields/); assert.match(active, /does not submit passwords or infer account creation/);
  const handoff = render({ ...base, registrationAvailable: true, runs: [setup({ mode: 'create', status: 'owner_handoff', preparationReceipt: { reasonCode: 'secure_owner_steps' } })] });
  assert.match(handoff, /Open secure owner signup/); assert.match(handoff, /Close owner browser/);
  assert.doesNotMatch(handoff, /browserbase\.com\/|name="(?:password|credential)"/);
  const unavailable = render({ ...base, runs: [setup({ mode: 'create', status: 'owner_handoff', preparationReceipt: { reasonCode: 'provider_unavailable' } })] });
  assert.doesNotMatch(unavailable, /Open secure owner signup/);
});

test('stopping or finishing a registration distinguishes confirmed browser closure from unknown release', async () => {
  for (const [action, method, success] of [['cancelAccountSetup', 'stopAccountSetup', 'cancelled'], ['finishOwnerRegistrationSession', 'releaseAccountRegistration', 'owner-step-finished']]) {
    for (const remoteReleaseVerified of [false, true]) {
      const h = actionHarness({ [method]: async () => ({ remoteReleaseVerified }) });
      const url = await redirectFrom(h[action](form()));
      assert.match(url, new RegExp(`accountMessage=${remoteReleaseVerified ? success : 'browser-release-unconfirmed'}`));
      assert.equal(h.calls[0].args[1], businessId); assert.equal(h.calls[0].args[2], runId);
    }
  }
});

test('created accounts retain an owner-only provider connection verification continuation', () => {
  for (const provider of ['etsy', 'printful']) {
    const html = render({ ...base, registrationAvailable: true, runs: [setup({ provider, mode: 'create', status: 'owner_handoff', preparationReceipt: { reasonCode: 'secure_owner_steps' } })] });
    assert.match(html, provider === 'etsy' ? /Verify Etsy connection/ : /Open secure Printful connection/);
    assert.doesNotMatch(html, /Account created successfully|Setup complete/);
  }
});

test('successful profile, verify and disconnect actions preserve an unconfirmed remote-close warning', async () => {
  for (const [action, method, message, extra] of [
    ['saveBusinessAccountProfile', 'saveAccountProfile', 'profile-saved-browser-pending', {}],
    ['submitOwnerPrintfulCredential', 'connectPrintfulAccount', 'verified-browser-pending', { secureAccessConsent: 'on', storeKind: 'manual_api' }],
    ['disconnectBusinessAccount', 'revokeAccount', 'disconnected-browser-pending', { disconnectConsent: 'on' }],
  ]) {
    const h = actionHarness({ [method]: async () => ({ browserReleaseVerified: false }) });
    assert.match(await redirectFrom(h[action](form(extra))), new RegExp(`accountMessage=${message}`));
  }
  const etsy = actionHarness({ resumeAccountSetup: async () => setup({ provider: 'etsy' }), verifyEtsyAccount: async () => ({ browserReleaseVerified: false }) });
  assert.match(await redirectFrom(etsy.resumeVerifiedAccountSetup(form())), /accountMessage=verified-browser-pending/);
});

async function registrationPage({ denied = false, query = { business: businessId, run: runId } } = {}) {
  const calls = [], logs = [];
  const { default: Page } = load('src/app/dashboard/accounts/registration/page.tsx', {
    ...viewDependencies, 'next/navigation': { notFound: () => { throw new Error('not-found'); } },
    '@/lib/core-ui/data': { requireOwnerUiContext: async () => ({ businesses: [{ id: businessId }] }) },
    '@/accounts/server': { loadOwnerRegistrationHandoff: async (...args) => { calls.push(args); if (denied) throw new Error('private-db-error-do-not-render'); return { provider: 'etsy', viewerUrl: 'https://www.browserbase.com/synthetic-owner-session', expiresAt: '2026-10-01T12:15:00Z' }; } },
    '../actions': actionStubs, '../accounts.css': {},
    '@/components/console/console-shell': { ConsoleShell: ({ children }) => React.createElement('main', null, children) }, '@/components/console/console-panes.css': {},
    '../account-workspace': { accountMessages: load('src/app/dashboard/accounts/account-workspace.tsx', { ...viewDependencies, './actions': actionStubs }).accountMessages },
    './secure-form': load('src/app/dashboard/accounts/secure/secure-form.tsx', { ...viewDependencies, '../actions': actionStubs }),
  }, { console: { log: (...args) => logs.push(args), error: (...args) => logs.push(args) } });
  return { html: renderToStaticMarkup(await Page({ searchParams: Promise.resolve(query) })), calls, logs };
}

test('isolated owner registration page alone renders the scoped handoff and safely hides retrieval failures', async () => {
  const { html, calls, logs } = await registrationPage();
  assert.equal(calls[0][1], businessId); assert.equal(calls[0][2], runId);
  assert.match(html, /<iframe(?=[^>]*title="Etsy secure owner browser")(?=[^>]*referrerPolicy="no-referrer")(?=[^>]*sandbox="allow-scripts allow-same-origin allow-forms")/);
  assert.match(html, /data-agent-labs-secure="true"/); assert.match(html, /Automation is disconnected/); assert.match(html, /Completion here still requires independent provider connection verification/);
  assert.match(html, /operational metadata may still be retained/); assert.doesNotMatch(html, /name="password"|<script[^>]+src=/); assert.deepEqual(logs, []);
  const failure = await registrationPage({ denied: true }); assert.match(failure.html, /owner session is unavailable, stopped or expired/);
  assert.doesNotMatch(failure.html, /<iframe|synthetic-owner-session|private-db-error/); assert.deepEqual(failure.logs, []);
  for (const query of [{ business: foreignId, run: runId }, { business: 'malformed', run: runId }, { business: businessId, run: 'malformed' }]) await assert.rejects(registrationPage({ query }), /not-found/);
});

const chrome = process.env.ACCOUNT_UI_CHROMIUM_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
test('hosted Chromium checks mobile account review and required secure owner form labels', { skip: !process.env.GITHUB_ACTIONS && !process.env.ACCOUNT_UI_CHROMIUM_PATH }, async () => {
  assert.ok(chrome, 'GitHub Actions must provide Chromium so account UI coverage cannot silently skip');
  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.abort());
    const css = `body{margin:16px;font-family:Arial,sans-serif}*{box-sizing:border-box} ${readFileSync('src/app/dashboard/accounts/accounts.css', 'utf8')}`;
    const html = render({ ...base, registrationAvailable: true, runs: [setup({ mode: 'create', provider: 'etsy' })] });
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 950 });
      await page.setContent(`<html><head><style>${css}</style></head><body>${html}</body></html>`);
      assert.equal(await page.getByRole('heading', { name: 'Business accounts', exact: true }).isVisible(), true);
      const review = page.locator('form').filter({ has: page.getByRole('button', { name: 'Approve exact request', exact: true }) });
      assert.equal(await review.evaluate(el => el.checkValidity()), false);
      for (const name of ['dataConsent', 'accessConsent', 'termsConsent', 'browserConsent']) await review.locator(`[name="${name}"]`).check();
      assert.equal(await review.evaluate(el => el.checkValidity()), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    const { html: secure } = await securePage({ ...base, runs: [setup({ status: 'owner_handoff' })] });
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 950 });
      await page.setContent(`<html><head><style>${css}</style></head><body>${secure}</body></html>`);
      assert.equal(await page.getByLabel('Printful private token', { exact: true }).getAttribute('type'), 'password');
      assert.equal(await page.getByLabel(/^Intended Printful store ID/).isVisible(), true);
      assert.equal(await page.getByLabel('Store type', { exact: true }).isVisible(), true, 'The store selector needs an unambiguous accessible name');
      const kind = page.getByLabel('Store type', { exact: true });
      assert.equal(await kind.inputValue(), '', 'Store type must not default to Manual/API or ecommerce-linked');
      assert.equal(await kind.locator('option:checked').textContent(), 'Choose the intended store type');
      assert.equal(await kind.evaluate(el => el.validity.valueMissing), true);
      assert.equal(await page.locator('form.accountSecureForm').evaluate(el => el.checkValidity()), false);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await page.locator('input[name=credential]').inputValue(), '');
      await page.getByLabel('Printful private token', { exact: true }).fill('synthetic-ui-token');
      await page.getByLabel(/^Intended Printful store ID/).fill('987');
      await page.locator('[name=expiresAt]').fill('2026-10-02T12:00');
      await page.locator('[name=secureAccessConsent]').check();
      assert.equal(await page.locator('form.accountSecureForm').evaluate(el => el.checkValidity()), false, 'All other fields cannot substitute for deliberate store selection');
      for (const value of ['ecommerce_linked', 'manual_api']) {
        await kind.selectOption(value);
        assert.equal(await kind.inputValue(), value);
        assert.equal(await page.locator('form.accountSecureForm').evaluate(el => el.checkValidity()), true);
      }
    }
  } finally { await browser.close(); }
});

test('compact Decisions preserves account-registry uncertainty and exact owner setup links', async () => {
  const { rendered, fixtureTables } = await import('./helpers/console-decisions.mjs');
  const show = summary => rendered('/dashboard?view=decisions', { tables: fixtureTables({ count: 0 }), props: { connectionRequests: { count: summary.unavailable ? null : summary.records.length, ...summary } } });
  const uncertain = (await show({ records: [], unavailable: true })).html;
  assert.match(uncertain, /Connection requests could not be checked/); assert.doesNotMatch(uncertain, /No intervention required|Nothing needs your attention/);
  const waiting = (await show({ records: [{ runId, businessId, provider: 'printful' }], unavailable: false })).html;
  assert.ok(waiting.includes(`/dashboard?view=connections&amp;business=${businessId}&amp;connectionRun=${runId}&amp;provider=printful`));
  assert.match(waiting, /Review saved setup request/); assert.doesNotMatch(waiting, /Setup complete|Account created successfully/);
});

test('Printful workspace reads only the selected owned Business and never derives Printful connection from Etsy', async () => {
  async function pageFor(accounts) {
    const calls = [];
    const { default: Page } = load('src/app/dashboard/printful/page.tsx', {
      ...viewDependencies,
      '@/lib/core-ui/data': { requireOwnerUiContext: async () => ({ businesses: [{ id: businessId }] }) },
      '@/accounts/server': { loadAccountWorkspace: async (_context, id) => { calls.push(id); return accounts; } },
      '@/printful/contracts': { PRINTFUL_DOCS: { catalog: 'https://developers.printful.com/docs/', products: 'https://developers.printful.com/docs/', ecommerceSync: 'https://developers.printful.com/docs/' } },
      '@/printful/server': { loadPrintfulProductWorkspace: async () => null },
      './product-workspace': { ProductActionFeedback: () => null, ProductConfigurationWorkspace: () => null },
      './preview': { buildSyntheticPrintfulPreview: () => ({}) },
      './workspace': { CatalogConfigurationPreview: () => null, PricingCalculator: () => null },
      './printful.css': {},
    });
    return { html: renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ business: businessId }) })), calls };
  }
  const etsy = await pageFor({ ...base, accounts: [{ ...savedAccount, provider: 'etsy' }] });
  assert.deepEqual(etsy.calls, [businessId]); assert.doesNotMatch(etsy.html, /Verified connection/); assert.match(etsy.html, /Not connected/);
  const printful = await pageFor({ ...base, accounts: [savedAccount] });
  assert.match(printful.html, /Verified connection/); assert.match(printful.html, /Catalog read access only/); assert.match(printful.html, /Real configuration and receipts unverified/);
  assert.match(printful.html, new RegExp(`/dashboard/accounts\\?business=${businessId}`));
  const unavailable = await pageFor({ ...base, unavailable: true }); assert.match(unavailable.html, /Unable to check/); assert.doesNotMatch(unavailable.html, /Verified connection|>Not connected</);
});

test('removing an owner-saved password requires its own irreversible-removal consent and exact saved revision', async () => {
  const values = { provider: 'printful', connectionId, passwordRevision: foreignId };
  for (const extra of [{}, { passwordStorageConsent: 'on' }, { disconnectConsent: 'on' }]) {
    const h = actionHarness(); assert.match(await redirectFrom(h.removeOwnerWebsitePassword(form({ ...values, ...extra }))), /accountMessage=consent-required/); assert.equal(h.calls.length, 0);
  }
  for (const failed of [false, true]) {
    const h = actionHarness({ deleteOwnerAccountPassword: async () => { if (failed) throw new Error('private-credential-removal-body'); return {}; } });
    const url = await redirectFrom(h.removeOwnerWebsitePassword(form({ ...values, passwordRemovalConsent: 'on' })));
    assert.match(url, new RegExp(`accountMessage=${failed ? 'password-storage-unavailable' : 'password-removed'}`)); assert.doesNotMatch(url, /private-credential|passwordRevision/);
    assert.deepEqual(plain(h.calls[0].args[2]), { provider: 'printful', connectionId, expectedPasswordRevision: foreignId }); assert.deepEqual(h.logs, []);
  }
});

test('saved-password removal stays explicit and revision-bound even after provider disconnection', () => {
  for (const status of ['connected', 'revoked', 'expired']) {
    const html = render({ ...base, accounts: [{ ...savedAccount, status }] });
    assert.match(html, /<input(?=[^>]*name="passwordRemovalConsent")(?=[^>]*required="")/);
    assert.match(html, new RegExp(`name="passwordRevision" value="${foreignId}"`));
    assert.match(html, new RegExp(`name="connectionId" value="${connectionId}"`));
    assert.match(html, /permanent|permanently|cannot be undone|irreversible/i);
    assert.match(html, /Remove saved website password/);
    assert.doesNotMatch(html, /name="password"|name="confirmPassword"/);
  }
  const absent = render({ ...base, accounts: [{ ...savedAccount, passwordStored: false, passwordRevision: null }] });
  assert.doesNotMatch(absent, /name="passwordRemovalConsent"|Remove saved website password/);
});

test('Printful verification uses fixed typed outcomes and retains only the exact scoped connection return', async () => {
  const priorRequestId = '60000000-1111-4111-8111-111111111111';
  const returnTo = `/dashboard?view=connections&business=${businessId}&connectionRun=${priorRequestId}&provider=printful&credential=never-retain`;
  const cases = [
    [new printfulContract.PrintfulConnectionError('credential_scope_rejected'), 'verification-scope-rejected'],
    [new printfulContract.PrintfulConnectionError('credential_store_scope_rejected'), 'verification-store-scope-rejected'],
    [new printfulContract.PrintfulConnectionError('store_identity_mismatch'), 'verification-store-mismatch'],
    [new printfulContract.PrintfulConnectionError('credential_access_denied'), 'verification-access-denied'],
    [new printfulContract.PrintfulConnectionError('provider_rate_limited'), 'verification-rate-limited'],
    [new printfulContract.PrintfulConnectionError('provider_timeout'), 'verification-unavailable'],
    [new printfulContract.PrintfulConnectionError('invalid_provider_response'), 'verification-unavailable'],
    [new C.AccountError('account_handoff_expired'), 'verification-expired'],
    [new C.AccountError('account_approval_required'), 'verification-review-required'],
    [Object.assign(new Error('private token body'), { code: 'credential_scope_rejected' }), 'verification-unavailable'],
    [new Error('network private provider body'), 'verification-unavailable'],
    [null, 'verified'],
  ];
  for (const [error, message] of cases) {
    const h = actionHarness({ connectPrintfulAccount: async () => { if (error) throw error; return { browserReleaseVerified: true }; } });
    const href = await redirectFrom(h.submitOwnerPrintfulCredential(form({ returnTo, provider: 'printful', secureAccessConsent: 'on', credential: 'synthetic-private-token', storeId: 987, storeKind: 'ecommerce_linked', expiresAt: '2026-10-02T12:00' })));
    const url = new URL(href, 'https://synthetic.invalid');
    assert.equal(url.pathname, '/dashboard'); assert.equal(url.hash, '#connection-notice');
    assert.match(url.searchParams.get('accountResult'), C.ACCOUNT_UUID);
    const scope = new URLSearchParams(url.searchParams); scope.delete('accountResult');
    assert.deepEqual(Object.fromEntries(scope), { view: 'connections', business: businessId, provider: 'printful', connectionRun: runId, accountMessage: message });
    assert.equal(h.calls.length, 1, 'No automatic provider retry');
    assert.deepEqual(h.logs, []); assert.doesNotMatch(href, /synthetic-private-token|never-retain|private|credential|storeId|expiresAt/);
    assert.ok(h.invalidated.includes('/dashboard'));
  }
});

test('every account mutation returns to the Business-scoped root notice without trusting foreign return URLs', async () => {
  for (const returnTo of ['https://evil.invalid/collect', `//evil.invalid/dashboard?business=${businessId}`, `/dashboard?business=${foreignId}&run=${runId}`]) {
    const h = actionHarness();
    const href = await redirectFrom(h.requestAccountSetup(form({ provider: 'printful', mode: 'connect', idempotencyKey: revision, returnTo })));
    const url = new URL(href, 'https://synthetic.invalid');
    assert.equal(url.origin, 'https://synthetic.invalid'); assert.equal(url.pathname, '/dashboard'); assert.equal(url.hash, '#connection-notice');
    assert.equal(url.searchParams.get('business'), businessId); assert.equal(url.searchParams.get('view'), 'connections');
    assert.equal(url.searchParams.has('run'), false); assert.equal(url.searchParams.get('connectionRun'), runId);
    assert.doesNotMatch(href, /evil|collect/);
  }
});


test('compact Etsy records suppress activation and signup while preserving safe cleanup', () => {
  for (const mode of ['create', 'connect']) for (const status of ['pending_approval', 'approved', 'preparation_started', 'owner_handoff']) {
    const request = setup({ provider: 'etsy', mode, status, preparationReceipt: { reasonCode: 'secure_owner_steps' } });
    const data = { ...base, registrationAvailable: true, runs: [request] };
    const html = renderToStaticMarkup(React.createElement(CompactConnectionsWorkspace, { data, provider: 'etsy', runId,
      returnTo: `/dashboard?view=connections&business=${businessId}&provider=etsy&connectionRun=${runId}` }));
    assert.match(html, /Etsy activation is on hold/, `${mode}/${status}`);
    assert.match(html, /Stop setup/, `${mode}/${status} retains safe cancellation`);
    if (mode === 'create' && status === 'owner_handoff') assert.match(html, /Close owner browser/, 'Existing secure sessions retain their safe close action');
    else assert.doesNotMatch(html, /Close owner browser/);
    assert.doesNotMatch(html, /Approve exact request|Prepare approved signup|Open secure owner signup|Verify Etsy connection|Open Etsy connection|Open Etsy signup securely/);
    assert.doesNotMatch(html, /href="(?:https:\/\/www\.etsy\.com\/join|\/dashboard\/etsy|\/dashboard\/accounts\/registration)/);
    assert.doesNotMatch(html, /name="(?:dataConsent|accessConsent|termsConsent|browserConsent)"/);
  }
});

test('preparing an exact review redirects to the newly returned request instead of stale selected history', async () => {
  const newRunId = '60000000-1111-4111-8111-111111111111';
  for (const includeOldRunField of [false, true]) {
    const h = actionHarness({ prepareAccountSetup: async () => setup({ id: newRunId, status: 'pending_approval' }) });
    const input = form({ provider: 'printful', mode: 'connect', idempotencyKey: revision,
      returnTo: `/dashboard?view=connections&business=${businessId}&provider=printful&connectionRun=${runId}` });
    if (!includeOldRunField) input.delete('runId');
    const href = await redirectFrom(h.requestAccountSetup(input)), target = new URL(href, 'https://synthetic.invalid');
    assert.equal(target.pathname, '/dashboard'); assert.equal(target.searchParams.get('view'), 'connections');
    assert.equal(target.searchParams.get('business'), businessId); assert.equal(target.searchParams.get('provider'), 'printful');
    assert.equal(target.searchParams.get('connectionRun'), newRunId); assert.equal(target.searchParams.get('accountMessage'), 'review-ready');
    assert.match(target.searchParams.get('accountResult'), C.ACCOUNT_UUID); assert.equal(target.hash, '#connection-notice');
    assert.deepEqual(h.calls.map(call => call.name), ['prepareAccountSetup']); assert.deepEqual(h.logs, []);
  }
});


test('compact request actions appear once in the left action area and retain safe browser cleanup', () => {
  for (const provider of ['etsy', 'printful']) for (const mode of ['connect', 'create']) {
    const request = setup({ provider, mode, status: 'owner_handoff', preparationReceipt: { reasonCode: 'secure_owner_steps' } });
    const html = renderToStaticMarkup(React.createElement(CompactConnectionsWorkspace, { data: { ...base, registrationAvailable: true, runs: [request] }, provider, runId,
      returnTo: `/dashboard?view=connections&business=${businessId}&provider=${provider}&connectionRun=${runId}` }));
    const actionStart = html.indexOf('class="connectionNextAction"'), rightStart = html.indexOf('class="connectionDetailPane"');
    assert.ok(actionStart >= 0 && rightStart > actionStart);
    const left = html.slice(actionStart, rightStart), right = html.slice(rightStart);
    assert.equal((html.match(/>Stop setup<\/button>/g) ?? []).length, 1, `${provider}/${mode} has one cancellation control`);
    assert.match(left, />Stop setup<\/button>/); assert.doesNotMatch(right, />Stop setup<\/button>|>Close owner browser<\/button>/);
    assert.equal((html.match(/>Close owner browser<\/button>/g) ?? []).length, mode === 'create' ? 1 : 0);
    if (mode === 'create') assert.match(left, />Close owner browser<\/button>/);
  }
});

test('pending approval keeps every exact disclosure and required consent outside collapsed details', () => {
  const request = setup({ provider: 'printful', mode: 'create', status: 'pending_approval' });
  const html = renderToStaticMarkup(React.createElement(CompactConnectionsWorkspace, { data: { ...base, registrationAvailable: true, runs: [request] }, provider: 'printful', runId,
    returnTo: `/dashboard?view=connections&business=${businessId}&provider=printful&connectionRun=${runId}` }));
  const details = [], consent = new Set();
  for (const match of html.matchAll(/<(\/?)([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
    const [, close, tag, attributes] = match;
    if (tag === 'details') { if (close) details.pop(); else details.push(/(?:^|\s)open(?:=|\s|$)/.test(attributes)); }
    const name = tag === 'input' && !close ? attributes.match(/name="(dataConsent|accessConsent|termsConsent|browserConsent)"/)?.[1] : null;
    if (name) { consent.add(name); assert.equal(details.includes(false), false, `${name} must remain visible before approval`); assert.match(attributes, /required=""/); }
  }
  assert.deepEqual([...consent].sort(), ['accessConsent', 'browserConsent', 'dataConsent', 'termsConsent']);
  for (const text of ['Destination', 'Profile data shared', 'Requested access', 'Spending authority', 'Approval expires', 'Approve exact request']) assert.ok(html.includes(text), text);
});

test('compact request summary uses human labels while technical disclosure retains exact identifiers and scopes', () => {
  const request = setup({ provider: 'printful', mode: 'connect', status: 'owner_handoff' });
  const html = renderToStaticMarkup(React.createElement(CompactConnectionsWorkspace, { data: { ...base, runs: [request] }, provider: 'printful', runId,
    returnTo: `/dashboard?view=connections&business=${businessId}&provider=printful&connectionRun=${runId}` }));
  const article = html.slice(html.indexOf('<article class="accountRequest"'));
  const opening = article.slice(0, article.indexOf('<details'));
  assert.match(opening, /Ready for secure verification/); assert.match(opening, /Next: use Verify Printful/);
  assert.match(opening, /View catalog/); assert.match(opening, /Approval expires/);
  assert.doesNotMatch(opening, /owner_handoff|catalog\.read/);
  const saved = article.match(/<details\b([^>]*)><summary>Saved request access and terms<\/summary>([\s\S]*?)<\/details>/);
  assert.ok(saved, 'Previously approved disclosure has a labelled expansion'); assert.doesNotMatch(saved[1], /\bopen(?:=|\s|$)/);
  assert.match(saved[2], /Destination|Spending authority/);
  const technical = article.match(/<details\b[^>]*><summary>Technical request details<\/summary>([\s\S]*?)<\/details>/)?.[1];
  assert.ok(technical); assert.match(technical, new RegExp(`<dd>${runId}</dd>`));
  assert.match(technical, /Machine scopes<\/dt><dd>catalog\.read<\/dd>/); assert.match(technical, /Saved request status<\/dt><dd>owner_handoff<\/dd>/);
  assert.match(html, new RegExp(`title="${runId}"`)); assert.match(html, new RegExp(`aria-label="Selected request ${runId}"`));
});

test('ready-for-verification wording appears only when the saved Printful handoff is eligible for secure entry', () => {
  const request = setup({ provider: 'printful', status: 'owner_handoff' });
  for (const change of [{ configured: false }, { vaultConfigured: false }, { unavailable: true }, { runs: [{ ...request, status: 'approved' }] },
    { runs: [{ ...request, approvalExpiresAt: null }] }, { runs: [{ ...request, approvalExpiresAt: 'malformed' }] }, { runs: [{ ...request, approvalExpiresAt: base.observedAt }] }]) {
    const html = renderToStaticMarkup(React.createElement(CompactConnectionsWorkspace, { data: { ...base, runs: [request], ...change }, provider: 'printful', runId,
      returnTo: `/dashboard?view=connections&business=${businessId}&provider=printful&connectionRun=${runId}` }));
    assert.doesNotMatch(html, /Ready for secure verification|Next: use Verify Printful/, JSON.stringify(change));
    assert.doesNotMatch(html, /href="\/dashboard\/accounts\/secure/, JSON.stringify(change));
  }
});
