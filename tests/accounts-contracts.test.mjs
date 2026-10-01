import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const require = createRequire(import.meta.url), ts = require('typescript');
const code = ts.transpileModule(readFileSync('src/accounts/contracts.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const m = { exports: {} };
runInNewContext(`(function(require,module,exports){${code}\n})`)(require, m, m.exports);
const { parseAccountProfile, buildAccountDisclosure, accountDigest, accountProvider, accountMode } = m.exports;
const ordinary = { email: 'owner@example.test', givenName: 'Ada', familyName: 'Lovelace', countryCode: 'NZ', locale: 'en-NZ' };
const profile = { ...ordinary, revision: '10000000-1111-4111-8111-111111111111' };
const plain = value => JSON.parse(JSON.stringify(value));

test('ordinary reusable profile is exact, normalized and contains no credential slots', () => {
  assert.deepEqual(plain(parseAccountProfile({ ...ordinary, givenName: ' Ada ', email: ' owner@example.test ' })), ordinary);
  for (const key of ['password', 'token', 'accessToken', 'ssn', 'billing', 'revision', 'destination']) {
    assert.throws(() => parseAccountProfile({ ...ordinary, [key]: 'should-never-be-accepted' }), /account_profile_field_not_allowed/);
  }
  for (const invalid of [null, [], '', { ...ordinary, givenName: '' }, { ...ordinary, email: 'bad' }, { ...ordinary, email: 'a\nb@example.test' }, { ...ordinary, familyName: 'x'.repeat(101) }, { ...ordinary, countryCode: 'nz' }, { ...ordinary, locale: 'en_<script>' }]) {
    assert.throws(() => parseAccountProfile(invalid));
  }
});

test('creation discloses only provider-required ordinary data and each exact destination and revision', () => {
  for (const provider of ['etsy', 'printful']) {
    const disclosure = plain(buildAccountDisclosure(profile, provider, 'create'));
    assert.equal(disclosure.profileRevision, profile.revision);
    assert.equal(disclosure.destination, `https://www.${provider}.com`);
    assert.deepEqual(disclosure.profileFields, provider === 'etsy' ? ['email', 'givenName'] : ['email', 'givenName', 'familyName']);
    assert.deepEqual(disclosure.disclosedData, provider === 'etsy' ? { email: ordinary.email, givenName: ordinary.givenName } : { email: ordinary.email, givenName: ordinary.givenName, familyName: ordinary.familyName });
    assert.deepEqual(disclosure.cost, { amountMinor: 0, currency: null, subscription: false });
    assert.equal(disclosure.termsAcknowledgementRequired, true);
    assert.deepEqual(disclosure.browserProcessing, { provider: 'browserbase', purpose: 'registration_preparation_and_owner_handoff', recordSession: false, logSession: false, maxSessionSeconds: 900, requiresSeparateActivation: true });
    for (const boundary of ['password', 'email_verification', 'mfa', 'billing', 'identity_verification', 'access_grant']) assert.ok(disclosure.secureOwnerSteps.includes(boundary));
  }
});

test('API connection has no profile transmission or registration authority and keeps provider access distinct', () => {
  const etsy = plain(buildAccountDisclosure(profile, 'etsy', 'connect')), printful = plain(buildAccountDisclosure(profile, 'printful', 'connect'));
  for (const d of [etsy, printful]) {
    assert.deepEqual(d.profileFields, []); assert.deepEqual(d.disclosedData, {});
    assert.equal(d.browserProcessing, null); assert.equal(d.termsAcknowledgementRequired, false);
  }
  assert.deepEqual(etsy.scopes, ['shops_r', 'listings_r', 'listings_w']);
  assert.deepEqual(printful.scopes, ['catalog.read']);
  assert.throws(() => buildAccountDisclosure({ ...profile, revision: 'stale-or-malformed' }, 'etsy', 'create'), /account_profile_revision_required/);
  for (const p of ['Etsy', 'https://etsy.com', 'other', null]) assert.throws(() => accountProvider(p), /account_provider_unsupported/);
  for (const mode of ['signup', 'publish', '', null]) assert.throws(() => accountMode(mode), /account_mode_unsupported/);
});

test('exact review hash is key-order stable but binds data, provider, scope and profile revision', () => {
  const original = plain(buildAccountDisclosure(profile, 'printful', 'create'));
  const digest = accountDigest(original);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.equal(accountDigest(Object.fromEntries(Object.entries(original).reverse())), digest);
  for (const change of [d => { d.disclosedData.email = 'different@example.test'; }, d => { d.profileRevision = '20000000-1111-4111-8111-111111111111'; }, d => { d.scopes.push('orders.write'); }, d => { d.destination = 'https://attacker.test'; }, d => { d.browserProcessing.recordSession = true; }, d => { d.cost.amountMinor = 1; }]) {
    const altered = structuredClone(original); change(altered); assert.notEqual(accountDigest(altered), digest);
  }
});
