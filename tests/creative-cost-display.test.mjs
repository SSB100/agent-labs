import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { mergeCreativeCosts, summarizeCreativeCosts, creativeCostStatus } = require('../.core-tests/creative/cost-display.js');

const reservedAt = '2026-09-01T10:00:00.000Z';
const settledAt = '2026-09-01T10:01:00.000Z';
const reservation = (overrides = {}) => ({ creative_run_id: 'fixture-run', call_key: 'brief:1', reserved_microusd: 90_000, created_at: reservedAt, ...overrides });
const settlement = (overrides = {}) => ({ creative_run_id: 'fixture-run', call_key: 'brief:1', reported_microusd: 20_000, provider_request_id: 'fixture-request', created_at: settledAt, ...overrides });

test('reservation with no settlement remains visible as an unknown charge', () => {
  const costs = mergeCreativeCosts([reservation()], []);
  assert.equal(costs.length, 1);
  assert.equal(costs[0].settled_at, null);
  assert.equal(costs[0].reported_microusd, null);
  assert.match(creativeCostStatus(costs[0], false), /Receipt pending or missing; charge unknown; reservation retained/);
  assert.deepEqual(summarizeCreativeCosts(costs), { recordedCalls: 1, reportedMicrousd: 0, uncertainCalls: 1,
    uncertainReservedMicrousd: 90_000, committedMicrousd: 90_000, hasMissingReservation: false });
});

test('known settlements replace uncertainty without double-counting their reservation', () => {
  const costs = mergeCreativeCosts([reservation()], [settlement()]);
  assert.equal(costs.length, 1);
  assert.equal(costs[0].created_at, reservedAt);
  assert.equal(costs[0].settled_at, settledAt);
  assert.equal(creativeCostStatus(costs[0], false), 'Reported provider charge');
  assert.deepEqual(summarizeCreativeCosts(costs), { recordedCalls: 1, reportedMicrousd: 20_000, uncertainCalls: 0,
    uncertainReservedMicrousd: 0, committedMicrousd: 90_000, hasMissingReservation: false });
  const higher = summarizeCreativeCosts(mergeCreativeCosts([reservation()], [settlement({ reported_microusd: 110_000 })]));
  assert.equal(higher.committedMicrousd, 110_000);
  assert.equal(higher.reportedMicrousd, 110_000);
});

test('a receipt without reported cost retains uncertainty and its reserved estimate', () => {
  const costs = mergeCreativeCosts([reservation()], [settlement({ reported_microusd: null })]);
  assert.equal(costs[0].settled_at, settledAt);
  assert.match(creativeCostStatus(costs[0], false), /Receipt has no reported cost; charge unknown; reservation retained/);
  assert.equal(summarizeCreativeCosts(costs).uncertainCalls, 1);
  assert.equal(summarizeCreativeCosts(costs).uncertainReservedMicrousd, 90_000);
});

test('expired runs preserve missing receipts and never clear their reservation', () => {
  const costs = mergeCreativeCosts([reservation()], []);
  const before = summarizeCreativeCosts(costs);
  assert.match(creativeCostStatus(costs[0], true), /Receipt missing after run expiry; charge unknown; reservation retained/);
  assert.deepEqual(summarizeCreativeCosts(costs), before);
  const unknown = mergeCreativeCosts([reservation()], [settlement({ reported_microusd: null })]);
  assert.match(creativeCostStatus(unknown[0], true), /charge unknown; reservation retained/);
  assert.equal(summarizeCreativeCosts(unknown).committedMicrousd, 90_000);
});

test('mixed known, unknown and pending calls use their exact run and call identity', () => {
  const costs = mergeCreativeCosts([
    reservation(), reservation({ call_key: 'screen:1', reserved_microusd: 50_000 }),
    reservation({ creative_run_id: 'other-fixture-run', reserved_microusd: 40_000 }),
  ], [settlement(), settlement({ call_key: 'screen:1', reported_microusd: null })]);
  assert.equal(costs.length, 3);
  assert.equal(costs.find(c => c.creative_run_id === 'other-fixture-run').settled_at, null);
  assert.deepEqual(summarizeCreativeCosts(costs), { recordedCalls: 3, reportedMicrousd: 20_000, uncertainCalls: 2,
    uncertainReservedMicrousd: 90_000, committedMicrousd: 180_000, hasMissingReservation: false });
});

test('reported zero is known while a receipt from a later query snapshot is preserved', () => {
  const zero = mergeCreativeCosts([reservation()], [settlement({ reported_microusd: 0 })]);
  assert.equal(summarizeCreativeCosts(zero).uncertainCalls, 0);
  assert.equal(creativeCostStatus(zero[0], false), 'Reported provider charge');
  const later = mergeCreativeCosts([], [settlement()]);
  assert.equal(later.length, 1);
  assert.equal(later[0].reserved_microusd, null);
  assert.equal(summarizeCreativeCosts(later).reportedMicrousd, 20_000);
  assert.equal(summarizeCreativeCosts(later).hasMissingReservation, true);
});

test('only a genuinely empty ledger reports no recorded calls', () => {
  assert.deepEqual(summarizeCreativeCosts(mergeCreativeCosts([], [])), { recordedCalls: 0, reportedMicrousd: 0,
    uncertainCalls: 0, uncertainReservedMicrousd: 0, committedMicrousd: 0, hasMissingReservation: false });
});
