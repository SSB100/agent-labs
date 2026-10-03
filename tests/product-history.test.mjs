import { historyRead, historyResponse } from './helpers/history-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { retainedFixture } from './helpers/guided-ui.mjs';

const require = createRequire(import.meta.url);
const history = require('../.core-tests/products/history.js');
const types = require('../.core-tests/products/types.js');
const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const date = '2026-09-30T10:00:00Z';
const assessment = () => ({ scoringVersion: types.SCORING_VERSION, outcome: 'NEEDS_MORE_EVIDENCE', totalScore: null,
  dimensions: types.DIMENSIONS.map(dimension => ({ dimension, score: null, evidenceIds: [], rationale: 'Unknown fixture evidence.', evidenceKind: 'unassessed' })),
  reasons: ['Legacy decision remains visible'], missingEvidence: ['Legacy exact evidence gap'], evidenceIds: [], assessmentOrigin: 'deterministic_provisional',
  review: { status: 'contract_checked', liveQualified: false, creativeProductionAllowed: false, publicationAllowed: false } });
const candidate = n => ({ id: id(n), business_id: id(10), concept: `Preserved concept ${n}`, audience: 'Adult fixture audience', hypothesis: 'Original hypothesis is preserved.', original_design: true, rights_status: 'unclear', source_domains: ['etsy.com'], created_at: date });
const experiment = (n, candidateId = id(1)) => ({ id: id(n), business_id: id(10), candidate_id: candidateId, workflow_run_id: id(90),
  fingerprint: `fixture-${n}`, hypothesis: 'Saved research hypothesis.', variables: { preservedVariable: 'Original value' }, audience: 'Adult fixture audience',
  creative: null, price: null, channel: 'research_only', status: 'completed', measurement_plan: types.DEFAULT_MEASUREMENT_PLAN,
  evidence_pack: { question: 'Fixture research', evidence: [], sources: [], claims: [], limitations: ['No sales measurement'] },
  source_artifact_id: id(80), basis_artifact_id: null, failure: null, started_at: date, completed_at: date, created_at: date });
const decision = (n, value = assessment(), candidateId = id(1), experimentId = id(11)) => ({ id: id(n), business_id: id(10), candidate_id: candidateId, experiment_id: experimentId, assessment: value, created_at: date });
const root = () => ({ ...experiment(20, null), discovery_version: 'pod-discovery-2.0', parent_discovery_id: null,
  evidence_pack: null, measurement_plan: { version: 'pod-discovery-2.0', testPlan: null } });

// Exercise the real TS/TSX reader without Next routing, server actions, or a provider call.
function loadSource(path, overrides) {
  const output = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loadedModule = { exports: {} };
  new Function('require', 'module', 'exports', output)(name => name === '../lib/core-ui/history-read' ? historyRead : Object.hasOwn(overrides, name) ? overrides[name] : require(name), loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
function renderWorkspace(data, view = 'Candidates') {
  const { ProductsWorkspace } = loadSource('src/components/stage13/products-workspace.tsx', {
    '@/components/console/console-retained-workspace': retainedFixture(),
    react: React,
    'next/navigation': { usePathname:()=>'/dashboard/products', useSearchParams:()=>new URLSearchParams({candidateView:view}), useRouter:()=>({push(){throw Error('SSR fixture cannot navigate')}}) },
    'react-dom': { useFormStatus: () => ({ pending: false }) },
    'next/link': ({ children, ...props }) => React.createElement('a', props, children),
    '@/app/dashboard/products/actions': { reconcileProductDiscovery() {}, recordProductAssessment() {}, reconsiderProductCandidate() {}, startProductResearch() {} },
    '@/components/stage7/icons': { CoreIcon: () => React.createElement('span') },
    '@/products/types': types, '@/products/history': history, '@/app/dashboard/products/products.css': {},
  });
  return renderToStaticMarkup(React.createElement(ProductsWorkspace, { data, compact: true }));
}

test('legacy read guards retain v1 unknown scores and refuse newer or malformed scorecards', () => {
  const legacy = assessment();
  assert.equal(history.isLegacyProductAssessment(legacy), true);
  assert.equal(legacy.totalScore, null);
  for (const value of [null, {}, [], { version: 'pod-discovery-2.0', outcome: 'TEST' },
    { ...legacy, scoringVersion: 'pod-discovery-9.0' }, { ...legacy, dimensions: [] }, { ...legacy, reasons: null },
    { ...legacy, dimensions: [...legacy.dimensions.slice(1), legacy.dimensions[1]] }]) {
    assert.equal(history.isLegacyProductAssessment(value), false);
  }
  assert.equal(history.productAssessmentVersion({ version: 'pod-discovery-2.0' }), 'pod-discovery-2.0');
  assert.equal(history.recordedProductOutcome({ version: 'future', outcome: 'DEFER' }), null);
  assert.equal(history.recordedProductOutcome({ version: 'future', outcome: 'TEST' }), 'TEST');
});

test('root lookup omits only null lookup keys and keeps every experiment untouched', () => {
  const rows = [root(), experiment(11), experiment(12)], original = structuredClone(rows);
  assert.deepEqual(history.linkedProductCandidateIds(rows), [id(1)]);
  assert.deepEqual(rows, original);
  assert.equal(history.isLegacyProductExperiment(rows[0]), false);
  assert.equal(history.isLegacyProductExperiment(rows[1]), true);
  assert.match(history.productExperimentLabel(rows[0]), /Discovery root/);
  assert.equal(history.isLegacyMeasurementPlan({ version: 'pod-discovery-2.0', testPlan: null }), false);
});

test('newer unknown decisions are counted explicitly instead of reviving older outcomes', () => {
  const old = decision(30), newest = { ...decision(31, { version: 'future', outcome: 'DEFER' }), created_at: '2026-09-30T11:00:00Z' };
  assert.deepEqual(history.productHistorySummary([old, newest]), { needsEvidence: 0, unsupportedAssessments: 1, unrecognizedOutcomes: 1 });
  assert.equal(history.hasOnlyLegacyProductHistory(id(1), [experiment(11)], [old, newest]), false);
  assert.equal(history.hasOnlyLegacyProductHistory(id(2), [experiment(12, id(2))], [old, newest]), true);
});

test('mixed legacy, v2, and unknown history renders all records without invented scorecards or legacy actions', () => {
  const v2 = { version: 'pod-discovery-2.0', outcome: 'TEST', sufficiencyRationale: 'Bounded learning rationale remains visible', missingQuestions: ['Candidate demand remains unknown'], dimensionReviews: [] };
  const future = { version: 'pod-discovery-9.0', outcome: 'DEFER', futureRationale: 'Future assessment remains visible' };
  const rows = [experiment(11), { ...experiment(12), discovery_version: 'pod-discovery-2.0', parent_discovery_id: id(20), measurement_plan: { version: 'pod-discovery-2.0', testPlan: { budgetStatus: 'proposal_only', maximumMicrousd: 350000 } } }, root()];
  const data = { candidates: [candidate(1)], experiments: rows, decisions: [decision(30), decision(31, v2, id(1), id(12)), decision(32, future)], errors: [] };
  const original = structuredClone(data);
  const decisions = renderWorkspace(data, 'Decisions');
  for (const text of ['Legacy decision remains visible', 'Legacy exact evidence gap', 'Bounded learning rationale remains visible', 'Candidate demand remains unknown', 'Future assessment remains visible', 'pod-discovery-9.0', 'Unknown is not zero']) assert.ok(decisions.includes(text), text);
  assert.equal((decisions.match(/Nine-dimension scorecard/g) ?? []).length, 1);
  const registry = renderWorkspace(data, 'Registry');
  for (const row of rows) assert.ok(registry.includes(row.id));
  assert.match(registry, /350000/); assert.match(registry, /Versioned plan/); assert.match(registry, /Discovery root/);
  assert.doesNotMatch(registry, /Record an owner assessment|Reconcile completed research/);
  assert.doesNotMatch(renderWorkspace(data), /Record an owner assessment|Reconsider with new evidence/);
  assert.deepEqual(data, original);
});

test('root-only workflow shows discovery history and linked evidence rather than a missing-experiment empty state', () => {
  const data = { candidates: [], experiments: [root()], decisions: [], errors: [] };
  const candidates = renderWorkspace(data);
  assert.match(candidates, /Candidate selection is not recorded/);
  assert.doesNotMatch(candidates, /Start with a question worth researching|No product candidate is linked/);
  const registry = renderWorkspace(data, 'Registry');
  assert.match(registry, /pod-discovery-2.0/); assert.match(registry, /\/dashboard\/workflows\//);
  assert.doesNotMatch(registry, /No registered experiments|undefined|Minimum sample/);
  assert.match(renderWorkspace(data, 'Evidence'), /Versioned evidence remains linked/);
});

test('workflow loader preserves root-only results and never sends null candidate IDs to the read API', async () => {
  const calls = [];
  const { loadProductWorkspace } = loadSource('src/products/data.ts', { '../lib/core-ui/history-read': historyRead });
  const supabase = { async rpc(name, args) {
    calls.push({ name, args });
    assert.equal(name, 'r06_read');
    return historyResponse(args, args.p_dataset === 'product_experiments' ? [root()] : []);
  }, from() { throw new Error('Root-only history must not fall back to broad PostgREST candidate queries'); } };
  const data = await loadProductWorkspace({ supabase, businesses: [{ id: id(10) }] }, id(90));
  assert.deepEqual(JSON.parse(JSON.stringify(data.experiments)), [root()]); assert.deepEqual(data.errors, []);
  assert.deepEqual(calls.map(call => call.args.p_dataset), ['product_candidates','product_experiments']);
  assert.ok(calls.every(call => call.args.p_query.workflowRunId === id(90)));
  assert.ok(calls.every(call => !Object.hasOwn(call.args.p_query, 'candidateId')));
  assert.equal(data.candidates.length, 0); assert.equal(data.decisions.length, 0);
});
