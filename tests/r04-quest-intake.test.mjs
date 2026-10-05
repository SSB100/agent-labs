import test from 'node:test';
import assert from 'node:assert/strict';
import { containsCredentialLikeValue, parseQuestIntake } from '../.core-tests/core/quest-intake.js';

const full = 'Sell original nature T-shirts; target NZD 12,500.75 realised profit; budget: NZD 300.50; deadline: 2027-12-31T23:59:00 in Pacific/Auckland; geography: New Zealand; scope: original nature T-shirts; stop if total loss exceeds NZD 300.50.';

test('extracts a conservative review draft and never creates authority', () => {
  const result = parseQuestIntake(full);
  assert.equal(result.status, 'draft');
  assert.equal(result.objective, full);
  assert.deepEqual(result.target, { amount: '12500.75', currency: 'NZD', metric: 'realised_profit' });
  assert.deepEqual(result.budget, { amount: '300.50', currency: 'NZD' });
  assert.deepEqual(result.deadline, { date: '2027-12-31', time: '23:59:00', timezone: 'Pacific/Auckland' });
  assert.deepEqual(result.geography, ['NZ']);
  assert.equal(result.scope, 'original nature T-shirts');
  assert.deepEqual(result.stopConstraints, ['stop if total loss exceeds NZD 300.50']);
  assert.deepEqual(result.issues, []);
  assert.equal(result.coverage, 'limited_extraction');
  assert.equal(result.requiresReview, true);
  assert.equal(result.executionAuthorized, false);
  assert.equal('authorizationExpiry' in result, false);
});

test('keeps revenue, realised profit and units distinct and never treats budget as target', () => {
  const revenue = parseQuestIntake('Reach USD 1,250.25 in revenue; budget: USD 25; deadline: 2027-01-31 UTC; geography: United States; scope: shirts; stop if costs exceed USD 25.');
  assert.deepEqual(revenue.target, { amount: '1250.25', currency: 'USD', metric: 'revenue' });
  assert.deepEqual(revenue.budget, { amount: '25', currency: 'USD' });
  const units = parseQuestIntake('Target 100 units; budget: USD 50; deadline: 2027-01-31 UTC; geography: Australia; scope: shirts; stop if stock runs out.');
  assert.deepEqual(units.target, { amount: '100', currency: null, metric: 'units' });
  assert.deepEqual(units.budget, { amount: '50', currency: 'USD' });
  const noTarget = parseQuestIntake('Budget: USD 100; deadline: 2027-01-31 UTC; geography: Canada; scope: shirts; stop if costs rise.');
  assert.equal(noTarget.target, null);
  assert.ok(noTarget.issues.some(issue => issue.field === 'target' && issue.reason === 'missing'));
});

test('a dollar sign gives no invented currency and bare profit or sales is ambiguous', () => {
  const result = parseQuestIntake('Target $1,000 profit; budget: $100; deadline: 2027-04-30 UTC; geography: New Zealand; scope: shirts; stop if costs exceed $100.');
  assert.deepEqual(result.target, { amount: '1000', currency: null, metric: null });
  assert.deepEqual(result.budget, { amount: '100', currency: null });
  assert.ok(result.issues.some(issue => issue.field === 'target' && issue.reason === 'ambiguous'));
  assert.equal(result.issues.filter(issue => issue.field === 'currency').length, 2);
  assert.equal(parseQuestIntake('Target USD 100 sales; budget: USD 10').target.metric, null);
});

test('ISO date needs explicit valid timezone; ambiguous or invalid dates stay unresolved', () => {
  const missingZone = parseQuestIntake('Target 10 units; budget: USD 5; by 2027-03-01T12:00:00; geography: US; scope: shirts; stop if costs rise.');
  assert.equal(missingZone.deadline, null);
  assert.ok(missingZone.issues.some(issue => issue.field === 'timezone' && issue.reason === 'missing'));
  const missingTime = parseQuestIntake('Target 10 units; budget: USD 5; by 2027-03-01 UTC; geography: US; scope: shirts; stop if costs rise.');
  assert.equal(missingTime.deadline, null);
  assert.ok(missingTime.issues.some(issue => issue.field === 'deadline' && issue.reason === 'ambiguous'));
  const badDate = parseQuestIntake('Target 10 units; budget: USD 5; deadline: 2027-02-30 UTC; geography: US; scope: shirts; stop if costs rise.');
  assert.equal(badDate.deadline, null);
  assert.ok(badDate.issues.some(issue => issue.field === 'deadline' && issue.reason === 'ambiguous'));
  const ambiguous = parseQuestIntake('Target 10 units; budget: USD 5; by 2027-03-01 UTC or by 2027-04-01 UTC; geography: US; scope: shirts; stop if costs rise.');
  assert.equal(ambiguous.deadline, null);
  assert.ok(ambiguous.issues.some(issue => issue.field === 'deadline' && issue.reason === 'ambiguous'));
  const timestamp = parseQuestIntake('Target 10 units; budget: USD 5; by 2027-03-01T17:30:00Z; geography: US; scope: shirts; stop if costs rise.');
  assert.deepEqual(timestamp.deadline, { date: '2027-03-01', time: '17:30:00', timezone: 'UTC' });
  const offset = parseQuestIntake('Target 10 units; budget: USD 5; by 2027-03-01T17:30:00+12:00; geography: US; scope: shirts; stop if costs rise.');
  assert.equal(offset.deadline, null);
  assert.ok(offset.issues.some(issue => issue.field === 'deadline' && issue.reason === 'ambiguous'));
  const negated = parseQuestIntake('Target 10 units; budget: USD 5; not by 2027-03-01T17:30:00Z; geography: US; scope: shirts; stop if costs rise.');
  assert.equal(negated.deadline, null);
  assert.ok(negated.issues.some(issue => issue.field === 'deadline' && issue.reason === 'ambiguous'));
});

test('missing consequential facts and conflicting values require clarification', () => {
  const sparse = parseQuestIntake('I would like to grow a small shirt business.');
  assert.equal(sparse.status, 'draft');
  assert.deepEqual(sparse.issues.map(issue => issue.field), ['target', 'budget', 'deadline', 'geography', 'scope', 'stopConstraints']);
  const conflict = parseQuestIntake('Target 100 units and target 200 units; budget: USD 10; budget: USD 20; deadline: 2027-01-31 UTC; geography: UK; scope: shirts; stop if costs rise.');
  assert.equal(conflict.target, null);
  assert.equal(conflict.budget, null);
  assert.ok(conflict.issues.some(issue => issue.field === 'target' && issue.reason === 'ambiguous'));
  assert.ok(conflict.issues.some(issue => issue.field === 'budget' && issue.reason === 'ambiguous'));
});

test('credential-like inputs are rejected before any raw text enters the result', () => {
  const secrets = [
    'api_key=sk_test_123456789abcdef',
    'password: super-secret-123',
    'Bearer abc.def.ghi',
    'ghp_abcdefghijklmnopqrstuvwxyz1234567890',
    'sk-proj-abcdefghijklmnopqrstuvwxyz1234567890',
    'xoxb-1234567890-abcdefghijklmnop',
    'token=opaque-private-value',
    'secret=opaque-private-value',
    'Authorization: Basic dXNlcjpwYXNz',
    'password\ncorrect-horse-battery-staple',
    'AKIAABCDEFGHIJKLMNOP',
    '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
    'postgres://user:pass@db.example.test/a',
    'https://user:pass@example.test/',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature',
  ];
  for (const secret of secrets) {
    const result = parseQuestIntake(`Target 100 units; ${secret}`);
    assert.deepEqual(result, { status: 'rejected', reason: 'credential_like_content' });
    assert.equal(JSON.stringify(result).includes(secret), false);
  }
  assert.deepEqual(parseQuestIntake('   '), { status: 'rejected', reason: 'invalid_input' });
});

test('raw nested values are screened before JSON escaping, including cycles and excessive nesting', () => {
  assert.equal(containsCredentialLikeValue({ envelope: [{ owner: { note: 'password\ncorrect-horse' } }] }), true);
  assert.equal(containsCredentialLikeValue({ envelope: [{ owner: { note: 'plain objective' } }] }), false);
  const shared = { note: 'plain objective' };
  assert.equal(containsCredentialLikeValue({ first: shared, second: shared }), false);
  const cycle = {};
  cycle.self = cycle;
  assert.equal(containsCredentialLikeValue(cycle), true);
  let deep = {};
  for (let index = 0; index < 25; index++) deep = { nested: deep };
  assert.equal(containsCredentialLikeValue(deep), true);
});

test('negated or conflicting targets and budgets remain unresolved', () => {
  const suffix = '; deadline: 2026-11-01 UTC; geography: New Zealand; scope: shirts; stop rule: stop at cap';
  const noTarget = parseQuestIntake(`Do not target USD 500 revenue; budget USD 50${suffix}`);
  assert.equal(noTarget.target, null);
  assert.ok(noTarget.issues.some(issue => issue.field === 'target' && issue.reason === 'ambiguous'));
  const noBudget = parseQuestIntake(`target USD 500 revenue; this is not a budget USD 50${suffix}`);
  assert.equal(noBudget.budget, null);
  assert.ok(noBudget.issues.some(issue => issue.field === 'budget' && issue.reason === 'ambiguous'));
  const conflict = parseQuestIntake(`target USD 500 revenue; do not target USD 600 revenue; budget USD 50${suffix}`);
  assert.equal(conflict.target, null);
  assert.ok(conflict.issues.some(issue => issue.field === 'target' && issue.reason === 'ambiguous'));
});

test('excluded countries never become selected geography', () => {
  const prefix = 'target 100 units; budget USD 50; deadline 2026-11-01 UTC; ';
  const mixed = parseQuestIntake(`${prefix}geography: New Zealand, not Australia; scope: shirts; stop if costs exceed USD 50.`);
  assert.deepEqual(mixed.geography, ['NZ']);
  assert.ok(mixed.issues.some(issue => issue.field === 'geography' && issue.reason === 'ambiguous'));
  const unknown = parseQuestIntake(`${prefix}geography: Mars; scope: shirts; do not sell in Australia; stop if costs rise.`);
  assert.deepEqual(unknown.geography, []);
  assert.ok(unknown.issues.some(issue => issue.field === 'geography'));
  const natural = parseQuestIntake(`${prefix}sell shirts in New Zealand; scope: shirts; stop if costs rise.`);
  assert.deepEqual(natural.geography, ['NZ']);
  const unknownAlongside = parseQuestIntake(`${prefix}geography: New Zealand and Mars; scope: shirts; stop if costs rise.`);
  assert.deepEqual(unknownAlongside.geography, ['NZ']);
  assert.ok(unknownAlongside.issues.some(issue => issue.field === 'geography' && issue.reason === 'ambiguous'));
});

test('shorthand, malformed and excessive amounts are never partially accepted', () => {
  const suffix = '; deadline: 2026-11-01 UTC; geography: New Zealand; scope: shirts; stop if costs rise';
  for (const amount of ['1e6', '1k', '1,00', '1.2.3', '0001', '1234567890123', '12345678901234567890', '1.1234567']) {
    const budget = parseQuestIntake(`target 10 units; budget USD ${amount}${suffix}`);
    assert.equal(budget.budget, null, `budget ${amount}`);
    assert.ok(budget.issues.some(issue => issue.field === 'budget' && issue.reason === 'ambiguous'), `budget ${amount}`);
    const target = parseQuestIntake(`target USD ${amount} revenue; budget USD 10${suffix}`);
    assert.equal(target.target, null, `target ${amount}`);
    assert.ok(target.issues.some(issue => issue.field === 'target' && issue.reason === 'ambiguous'), `target ${amount}`);
  }
  const noSpend = parseQuestIntake(`target 10 units; budget USD 0${suffix}`);
  assert.deepEqual(noSpend.budget, { amount: '0', currency: 'USD' });
  const zeroTarget = parseQuestIntake(`target 0 units; budget USD 10${suffix}`);
  assert.equal(zeroTarget.target, null);
  assert.ok(zeroTarget.issues.some(issue => issue.field === 'target' && issue.reason === 'ambiguous'));
  const metricFirst = parseQuestIntake(`revenue USD 1,00; budget USD 10${suffix}`);
  assert.equal(metricFirst.target, null);
  assert.ok(metricFirst.issues.some(issue => issue.field === 'target' && issue.reason === 'ambiguous'));
});
