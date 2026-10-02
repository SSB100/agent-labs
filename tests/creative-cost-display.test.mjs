import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { mergeCreativeCosts, summarizeCreativeCosts, creativeCostStatus, qualifyCreativeCost } = require('../.core-tests/creative/cost-display.js');

import { creativeCostTruthFixture } from './helpers/creative-cost-truth-fixtures.mjs';
import { loadSource } from './helpers/guided-ui.mjs';
const workflows = loadSource('src/lib/core-ui/workflows.ts');
const { creativeOutcomeCosts } = loadSource('src/lib/core-ui/run-outcome.ts', { './workflows': workflows });

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


test('three-call saved history qualifies only provider-linked charges and preserves original exposure', () => {
  const fixture = creativeCostTruthFixture(), before = structuredClone(fixture);
  const merged = mergeCreativeCosts(fixture.reservations, fixture.settlements);
  for (const rows of [merged, fixture.costs]) {
    assert.deepEqual(summarizeCreativeCosts(rows), { recordedCalls: 3, reportedMicrousd: 10280, uncertainCalls: 1,
      uncertainReservedMicrousd: 210000, committedMicrousd: 339552, hasMissingReservation: false });
    const generated = rows.find(row => row.call_key === 'generate:1');
    assert.equal(generated.reported_microusd, 210000);
    assert.equal(generated.provider_request_id, null);
    assert.equal(qualifyCreativeCost(generated).reportedMicrousd, null);
    assert.equal(qualifyCreativeCost(generated).unverifiedMicrousd, 210000);
    assert.match(creativeCostStatus(generated, true), /provider request identity; charge unknown; reservation retained/);
  }
  const work = creativeOutcomeCosts(fixture.workflowRun, fixture.creativeRun,
    { status: 'ready', records: fixture.reservations }, { status: 'ready', records: fixture.settlements });
  assert.equal(work.calls.status, 'ready');
  assert.equal(work.calls.records.reduce((sum, row) => sum + (row.reportedUsd ?? 0), 0), 10280 / 1e6);
  assert.equal(work.calls.records.filter(row => row.reportedUsd === null).length, 1);
  for (const row of merged) {
    assert.equal(qualifyCreativeCost(row).reportedMicrousd === null ? null : qualifyCreativeCost(row).reportedMicrousd / 1e6,
      work.calls.records.find(call => call.id.endsWith(`:${row.call_key}`)).reportedUsd);
  }
  assert.deepEqual(fixture, before, 'Display qualification must never rewrite saved rows, reservations or receipt fields');
});

test('missing, empty, whitespace and invalid provider identities never qualify saved amounts, including zero', () => {
  for (const provider_request_id of [null, undefined, '', '  \t\n', 123, {}]) for (const reported_microusd of [0, 210000]) {
    const row = { ...reservation(), ...settlement({ provider_request_id, reported_microusd }), settled_at: settledAt };
    const before = structuredClone(row), qualified = qualifyCreativeCost(row), totals = summarizeCreativeCosts([row]);
    assert.equal(qualified.reportedMicrousd, null);
    assert.equal(qualified.unverifiedMicrousd, reported_microusd);
    assert.equal(totals.uncertainCalls, 1);
    assert.equal(totals.reportedMicrousd, 0);
    assert.equal(totals.uncertainReservedMicrousd, 90000);
    assert.equal(totals.committedMicrousd, Math.max(90000, reported_microusd));
    assert.deepEqual(row, before);
  }
  const zero = { ...reservation(), ...settlement({ reported_microusd: 0, provider_request_id: '  provider-zero  ' }), settled_at: settledAt };
  assert.equal(qualifyCreativeCost(zero).reportedMicrousd, 0);
  assert.equal(qualifyCreativeCost(zero).unverifiedMicrousd, null);
  assert.equal(summarizeCreativeCosts([zero]).uncertainCalls, 0);
});

test('invalid or absent saved amounts match Work qualification and remain unknown for direct records', () => {
  for (const reported_microusd of [null, undefined, NaN, Infinity, -1, .5, Number.MAX_SAFE_INTEGER + 1, '210000']) {
    const row = { ...reservation(), ...settlement({ reported_microusd }), settled_at: settledAt };
    assert.equal(qualifyCreativeCost(row).reportedMicrousd, null);
    assert.equal(summarizeCreativeCosts([row]).uncertainCalls, 1);
    assert.ok(summarizeCreativeCosts([row]).committedMicrousd >= 90000);
    const fixture = creativeCostTruthFixture();
    const work = creativeOutcomeCosts(fixture.workflowRun, fixture.creativeRun,
      { status: 'ready', records: fixture.reservations.slice(0, 1) },
      { status: 'ready', records: [{ ...fixture.settlements[0], reported_microusd }] });
    assert.equal(work.calls.records[0].reportedUsd, null);
  }
});

test('unverified saved amounts higher than reservations still count conservatively once', () => {
  const costs = mergeCreativeCosts([reservation()], [settlement({ reported_microusd: 210000, provider_request_id: null })]);
  assert.equal(summarizeCreativeCosts(costs).committedMicrousd, 210000);
  assert.equal(summarizeCreativeCosts(costs).uncertainReservedMicrousd, 90000);
  const settlementOnly = mergeCreativeCosts([], [settlement({ reported_microusd: 210000, provider_request_id: null })]);
  const totals = summarizeCreativeCosts(settlementOnly);
  assert.equal(totals.hasMissingReservation, true);
  assert.equal(totals.uncertainReservedMicrousd, 0);
  assert.equal(totals.committedMicrousd, 210000);
  assert.equal(totals.uncertainCalls, 1);
});

test('qualified receipts remain known after failed output validation, expiry or missing display timestamp', () => {
  const row = { ...reservation(), ...settlement(), settled_at: null, receipt: { outputValidated: false } };
  assert.equal(creativeCostStatus(row, true), 'Reported provider charge');
  assert.equal(summarizeCreativeCosts([row]).reportedMicrousd, 20000);
  assert.equal(summarizeCreativeCosts([row]).uncertainCalls, 0);
});
