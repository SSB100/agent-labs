import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareAccountRegistration, REGISTRATION_RUNTIME_SUPPORT } from '../.core-tests/accounts/registration.js';

const businessId = '10000000-0000-4000-8000-000000000001';
const preparationId = '10000000-0000-4000-8000-000000000002';
const profileRevision = '10000000-0000-4000-8000-000000000003';
const handoffId = '10000000-0000-4000-8000-000000000004';
const now = () => Date.parse('2026-10-01T12:00:00Z');
function approved(provider = 'etsy') {
  return {
    businessId, preparationId, profileRevision, disclosureHash: 'a'.repeat(64),
    approvalExpiresAt: '2026-10-01T12:10:00Z', termsApproved: true, browserConsent: true,
    disclosure: {
      provider, mode: 'create', profileRevision,
      profileFields: provider === 'etsy' ? ['email', 'givenName'] : ['email', 'givenName', 'familyName'],
      disclosedData: provider === 'etsy' ? { email: 'approved@example.com', givenName: 'Ada' } : { email: 'approved@example.com', givenName: 'Ada', familyName: 'Lovelace' },
      destination: `https://www.${provider}.com`,
      termsUrl: provider === 'etsy' ? 'https://www.etsy.com/legal/terms-of-use' : 'https://www.printful.com/policies/terms-of-service',
      privacyUrl: provider === 'etsy' ? 'https://www.etsy.com/legal/privacy' : 'https://www.printful.com/policies/privacy',
      purpose: 'Prepare registration', scopes: [], cost: { amountMinor: 0, currency: null, subscription: false },
      termsAcknowledgementRequired: true, secureOwnerSteps: ['password'],
      browserProcessing: { provider: 'browserbase', purpose: 'registration_preparation_and_owner_handoff', recordSession: false, logSession: false, maxSessionSeconds: 900, requiresSeparateActivation: true },
    },
  };
}
function fakeTransport(provider = 'etsy', overrides = {}) {
  const calls = [];
  const state = { opened: 0, closed: 0, revealed: provider === 'etsy', checked: false, locked: false, url: 'about:blank' };
  const fields = provider === 'etsy' ? {
    'input[name="email"]': { type: 'text', autocomplete: 'email', labels: 'Email address Required' },
    'input[name="first_name"]': { type: 'text', autocomplete: 'given-name', labels: 'First name Required' },
  } : {
    'input[name="fullName"]': { type: 'text', autocomplete: null, labels: 'Full name:' },
    'input[name="email"]': { type: 'email', autocomplete: 'email', labels: 'Email:' },
  };
  const locator = selector => ({
    async count() {
      if (selector.startsWith('a[href=')) return overrides.termsMissing ? 0 : 1;
      if (selector === 'input[name="hasAcceptedTerms"][type="checkbox"]') return provider === 'printful' ? 1 : 0;
      if (selector === overrides.boundarySelector) return 1;
      if (selector.startsWith('role:')) return selector === 'role:link:Sign up with your email' && provider === 'printful' && !state.revealed ? 1 : 0;
      return fields[selector] && state.revealed ? (overrides.duplicate === selector ? 2 : 1) : 0;
    },
    nth() { return this; },
    async isVisible() { return overrides.hidden !== selector; },
    async isEnabled() { return overrides.disabled !== selector; },
    async waitFor() {},
    async evaluate() {
      if (selector.includes('hasAcceptedTerms')) return !overrides.checkboxMismatch;
      return { ...fields[selector], formAction: null, readOnly: false, ...overrides.metadata?.[selector] };
    },
    async fill(value) {
      assert.equal(state.locked, true, 'destination restriction must precede any personal data');
      if (overrides.fillError === selector) throw new Error(`private user data ${value}, wss://private.example/secret`);
      calls.push(['fill', selector, value]);
      await overrides.afterFill?.(selector, state);
    },
    async click() { calls.push(['click', selector]); state.revealed = true; },
    async check() { calls.push(['check', selector]); state.checked = !overrides.checkboxFailed; },
    async isChecked() { return state.checked; },
  });
  const page = {
    url: () => state.url,
    async goto(url) { calls.push(['goto', url]); state.url = overrides.redirect ?? url; await overrides.afterOpen?.(); },
    locator,
    getByRole(role, { name }) { return locator(`role:${role}:${name}`); },
  };
  const transport = {
    safety: { recording: 'disabled_verified', secretObservation: 'disabled', persistentIdentityBound: { businessId, provider }, ownerSecureResume: true },
    async open() {
      state.opened++;
      return { page,
        async restrictToOrigin(origin) { calls.push(['restrict', origin]); state.locked = true; },
        async handoff() { calls.push(['handoff']); return { id: handoffId, expiresAt: '2026-10-01T12:15:00Z' }; },
        async close() { state.closed++; if (overrides.closeError) throw new Error('private close error'); },
      };
    },
  };
  return { transport, state, calls };
}
const run = (input, fake) => prepareAccountRegistration(input, { transport: fake.transport, now, assertCurrent: async () => {} });

test('production availability truthfully fails closed without creating any provider session', async () => {
  assert.equal(REGISTRATION_RUNTIME_SUPPORT.available, false);
  const result = await prepareAccountRegistration(approved(), { now });
  assert.equal(result.reasonCode, 'account_secure_owner_browser_required');
  assert.equal(result.outcome, 'needs_owner');
  assert.deepEqual(result.performedFields, []);
  assert.equal(result.handoff, null);
  assert.equal(result.providerAccountCreated, false);
});

test('Etsy prepares only approved email/first name and preserves secure owner handoff without submitting', async () => {
  const fake = fakeTransport(); const result = await run(approved(), fake);
  assert.deepEqual(fake.calls.filter(call => call[0] === 'fill'), [
    ['fill', 'input[name="email"]', 'approved@example.com'], ['fill', 'input[name="first_name"]', 'Ada'],
  ]);
  assert.equal(fake.calls.some(call => call[0] === 'click' || call[0] === 'check'), false);
  assert.equal(result.termsState, 'not_accepted');
  assert.equal(result.outcome, 'prepared');
  assert.equal(result.reasonCode, 'account_password_owner_required');
  assert.deepEqual(result.handoff, { id: handoffId, expiresAt: '2026-10-01T12:15:00Z' });
  assert.equal(result.secureResumeAvailable, true);
  assert.equal(result.providerAccountCreated, false);
  assert.equal(fake.state.closed, 0, 'same safe session must stay available for owner');
});

test('Printful reveals real email path, fills approved full name and checks matching approved terms only', async () => {
  const fake = fakeTransport('printful'); const result = await run(approved('printful'), fake);
  assert.deepEqual(fake.calls.filter(call => call[0] === 'click'), [['click', 'role:link:Sign up with your email']]);
  assert.deepEqual(fake.calls.filter(call => call[0] === 'fill'), [
    ['fill', 'input[name="fullName"]', 'Ada Lovelace'], ['fill', 'input[name="email"]', 'approved@example.com'],
  ]);
  assert.equal(result.termsState, 'checkbox_checked');
  assert.equal(result.providerAccountCreated, false);
  assert.equal(fake.calls.at(-1)[0], 'handoff');
  assert.deepEqual(result.performedFields, ['givenName', 'familyName', 'email']);
});

for (const [name, change] of [
  ['missing browser consent', input => { input.browserConsent = false; }],
  ['missing terms approval', input => { input.termsApproved = false; }],
  ['expired approval', input => { input.approvalExpiresAt = '2026-10-01T11:59:00Z'; }],
  ['profile revision changed', input => { input.profileRevision = preparationId; }],
  ['missing preparation reservation', input => { input.preparationId = 'not-a-reservation'; }],
  ['extra unapproved secret value', input => { input.disclosure.disclosedData.password = 'secret'; }],
  ['unauthorized destination', input => { input.disclosure.destination = 'https://www.etsy.com.evil.invalid'; }],
  ['unapproved charge', input => { input.disclosure.cost.amountMinor = 1; }],
  ['Printful missing familyName consent', input => { input.disclosure.profileFields = ['email','givenName']; }],
]) test(`${name} is rejected before opening a session`, async () => {
  const fake = fakeTransport(name.includes('Printful') ? 'printful' : 'etsy');
  const input = approved(name.includes('Printful') ? 'printful' : 'etsy'); change(input);
  await assert.rejects(() => run(input, fake));
  assert.equal(fake.state.opened, 0);
});

for (const [name, change] of [
  ['recording', fake => { fake.transport.safety.recording = 'enabled'; }],
  ['secret observation', fake => { fake.transport.safety.secretObservation = 'enabled'; }],
  ['missing secure resume', fake => { fake.transport.safety.ownerSecureResume = false; }],
  ['cross-Business', fake => { fake.transport.safety.persistentIdentityBound.businessId = preparationId; }],
  ['cross-provider', fake => { fake.transport.safety.persistentIdentityBound.provider = 'printful'; }],
]) test(`transport ${name} cannot transmit even approved fields`, async () => {
  const fake = fakeTransport(); change(fake); const result = await run(approved(), fake);
  assert.equal(result.reasonCode, 'account_secure_owner_browser_required'); assert.equal(fake.state.opened, 0);
});

test('Etsy lookalike-origin redirect fails closed without personal-data transmission', async () => {
  const fake = fakeTransport('etsy', { redirect: 'https://www.etsy.com.evil.invalid/join' });
  const result = await run(approved(), fake);
  assert.equal(result.reasonCode, 'account_registration_origin_rejected');
  assert.deepEqual(result.performedFields, []); assert.equal(fake.state.closed, 1);
});

test('all ordinary fields are preflighted before the first transmission', async () => {
  const fake = fakeTransport('etsy', { metadata: { 'input[name="first_name"]': { type: 'password' } } });
  const result = await run(approved(), fake);
  assert.equal(result.reasonCode, 'account_registration_form_changed');
  assert.equal(fake.calls.some(call => call[0] === 'fill'), false);
});

test('duplicate or differently labelled controls cannot receive approved data', async () => {
  for (const overrides of [ { duplicate: 'input[name="email"]' }, { metadata: { 'input[name="email"]': { labels: 'Recovery code' } } } ]) {
    const fake = fakeTransport('etsy', overrides); const result = await run(approved(), fake);
    assert.deepEqual(result.performedFields, []); assert.equal(result.reasonCode, 'account_registration_form_changed');
  }
});

test('displayed terms or undisclosed privacy link pause before transmitting', async () => {
  for (const missing of [true, false]) {
    const fake = fakeTransport('etsy', { termsMissing: missing }); const input = approved();
    if (!missing) input.disclosure.privacyUrl = 'https://another.invalid/privacy';
    const result = await run(input, fake);
    assert.equal(result.reasonCode, 'account_displayed_terms_changed'); assert.deepEqual(result.performedFields, []);
  }
});

for (const [selector, code] of [
  ['input[autocomplete="one-time-code"]', 'account_mfa_owner_required'],
  ['input[autocomplete^="cc-"],input[name="iban"],input[name="bank_account"]', 'account_billing_owner_required'],
  ['input[type="file"],input[name="ssn"],input[name="tax_id"],input[name="passport"]', 'account_identity_owner_required'],
  ['iframe[title*="challenge" i],iframe[title="reCAPTCHA"],input[name="captcha"]', 'account_captcha_approval_required'],
]) test(`${code} is detected without reading a secret value`, async () => {
  const fake = fakeTransport('etsy', { boundarySelector: selector }); const result = await run(approved(), fake);
  assert.equal(result.reasonCode, code); assert.deepEqual(result.performedFields, []); assert.equal(fake.state.closed, 1);
});

test('caller mutation during an await cannot change the approved immutable snapshot', async () => {
  const input = approved(); const fake = fakeTransport('etsy', { afterOpen() { input.disclosure.disclosedData.email = 'changed@example.com'; } });
  await run(input, fake);
  assert.equal(fake.calls.find(call => call[0] === 'fill')[2], 'approved@example.com');
});

test('expiry between routine fields pauses without more transmissions', async () => {
  let time = now(); const fake = fakeTransport('etsy', { afterFill() { time += 700_000; } });
  const result = await prepareAccountRegistration(approved(), { transport: fake.transport, now: () => time, assertCurrent: async () => {} });
  assert.equal(result.reasonCode, 'account_approval_expired');
  assert.equal(fake.calls.filter(call => call[0] === 'fill').length, 1);
  assert.equal(result.secureResumeAvailable, false); assert.equal(fake.state.closed, 1);
});

test('unverified checkbox never claims terms accepted or account created', async () => {
  const fake = fakeTransport('printful', { checkboxFailed: true }); const result = await run(approved('printful'), fake);
  assert.equal(result.reasonCode, 'account_terms_checkbox_unconfirmed');
  assert.equal(result.termsState, 'not_accepted'); assert.equal(result.providerAccountCreated, false);
});

test('provider errors are sanitized and only confirmed routine fields reach the receipt', async () => {
  const fake = fakeTransport('etsy', { fillError: 'input[name="first_name"]' }); const result = await run(approved(), fake);
  assert.equal(result.reasonCode, 'account_registration_preparation_unconfirmed');
  assert.equal(result.outcome, 'needs_owner');
  assert.deepEqual(result.performedFields, ['email']); assert.equal(fake.state.closed, 1);
  assert.doesNotMatch(JSON.stringify(result), /approved@example|Ada|private|wss:/);
});

test('failed cleanup is explicit and does not manufacture a secure continuation', async () => {
  const fake = fakeTransport('etsy', { termsMissing: true, closeError: true }); const result = await run(approved(), fake);
  assert.equal(result.reasonCode, 'account_registration_release_unconfirmed'); assert.equal(result.handoff, null);
});


test('cancellation during navigation prevents all later profile transmissions and closes the session', async () => {
  let cancelled = false;
  const fake = fakeTransport('etsy', {afterOpen: async () => { cancelled = true; }});
  const result = await prepareAccountRegistration(approved(), {transport: fake.transport, now, assertCurrent: async () => { if (cancelled) throw new Error('owner_cancelled'); }});
  assert.equal(result.reasonCode, 'account_registration_authority_changed');
  assert.equal(fake.calls.some(c => c[0] === 'fill' || c[0] === 'check' || c[0] === 'handoff'), false);
  assert.equal(fake.state.closed, 1);
});
test('profile invalidation between fields prevents the next field and terms acceptance', async () => {
  let stopped = false;
  const fake = fakeTransport('printful', {afterFill: async () => { stopped = true; }});
  const result = await prepareAccountRegistration(approved('printful'), {transport: fake.transport, now, assertCurrent: async () => { if (stopped) throw new Error('profile_changed'); }});
  assert.equal(result.reasonCode, 'account_registration_authority_changed');
  assert.equal(fake.calls.filter(c => c[0] === 'fill').length, 1);
  assert.equal(fake.calls.some(c => c[0] === 'check' || c[0] === 'handoff'), false);
});
test('a transport without a trusted current-authority callback cannot transmit anything', async () => {
  const fake = fakeTransport();
  const result = await prepareAccountRegistration(approved(), {transport: fake.transport, now});
  assert.equal(result.reasonCode, 'account_registration_current_authority_required');
  assert.equal(fake.state.opened, 0);
});
