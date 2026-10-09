import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url), ts = require('typescript');
const denied = () => { throw Error('Networking, database, runtime admission, auth, mutation, signing and provider calls are denied'); };
function load(path, dependencies = {}) {
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Forbidden runtime dependency: ${name}`); return dependencies[name];
  }, loaded, loaded.exports);
  return loaded.exports;
}
const crypto = { createHash }, types = load('src/products/types.ts');
const core = load('src/core/contracts.ts');
export const workflowStatuses = core.WORKFLOW_RUN_STATUSES;
const sources = load('src/research/sources.ts', { 'node:crypto': crypto });
const v2 = load('src/products/discovery-v2.ts', { './discovery-r12-goal-intent': { assertValidatedOwnerResearchIntent: denied }, 'node:crypto': crypto, '../research/generation-route': { validateGenerationRouteProof: denied }, './types': types, './discovery': { validateProductEvidence: denied }, '../research/sources': sources, './discovery-v2-knowledge': { validateDiscoveryKnowledgeV2: denied }, './discovery-r12-evidence-addendum': { discoveryAddendumObservation: denied, validateDiscoveryEvidenceAddendum: denied } });
const allowedV2 = Object.fromEntries(['DISCOVERY_V2', 'DISCOVERY_V2_EXECUTION_PREREQUISITES', 'DISCOVERY_V2_SNAPSHOT_BYTES', 'REVIEW_CHECKS_V2', 'discoveryV2Hash', 'discoveryV2SnapshotByteLength'].map(key => [key, v2[key]]));
export const api = load('src/products/discovery-v2-history.ts', { 'node:crypto': crypto, './discovery-v2': new Proxy(allowedV2, { get(target, name) { assert.ok(Object.hasOwn(target, name), `Forbidden fresh runtime helper: ${String(name)}`); return target[name]; } }), './types': types, '../core/contracts': core, '../research/sources': { canonicalResearchUrl: sources.canonicalResearchUrl, validateResearchRequest: sources.validateResearchRequest } });
export const id = n => `95000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const digest = v2.discoveryV2Hash, textHash = value => createHash('sha256').update(value).digest('hex');
export const stamp = '2024-01-01T01:00:00.000Z', observedAt = '2024-01-01T02:00:00.000Z';
const prose = 'This saved synthetic observation is limited to the source excerpt and establishes no current qualification or execution permission.';
function row(idValue, business, run, type, content, metadata = {}) { return { id: idValue, business_id: business, workflow_run_id: run, artifact_type: type, media_type: 'application/json', content, metadata }; }
export function fixture(offset = 0) {
  const business = id(1), root = id(offset + 10), run = id(offset + 11), artifact = id(offset + 12), dossierId = id(offset + 13), strategyId = id(offset + 14), reviewId = id(offset + 15), queryId = id(offset + 16);
  const intent = { version: v2.DISCOVERY_V2, id: root, businessId: business, objective: 'Compare preserved observations about an original outdoor shirt concept.', comparisonUniverse: { productType: 'original_pod_tshirt', markets: [{ countryCode: 'US', currency: 'USD' }, { countryCode: 'GB', currency: 'GBP' }], audiences: ['Adult outdoor enthusiasts'], sourceDomains: ['etsy.com'], selectionQuestion: 'Which saved market observation supports the next bounded comparison?' }, limits: { maximumAlternatives: 3, maximumNewCollections: 1, maximumMicrousd: 1000000, maximumGenerations: 1 }, expiresAt: '2024-01-02T00:00:00.000Z' };
  const prefix = 'Synthetic 🏕️ catalog preamble retained for Unicode span checks. ', quote = 'A saved adjacent buyer observation supports only this limited historical comparison.', excerpt = prefix + quote;
  const url = 'https://www.etsy.com/listing/123456789/synthetic-history', contentHash = textHash(excerpt), sourceId = `src-${textHash(`${url}:${contentHash}`).slice(0, 24)}`;
  const source = { id: sourceId, url, title: 'Synthetic preserved source', retrievedAt: '2024-01-01T00:00:00.000Z', publishedAt: null, retrievalExpiresAt: '2024-01-02T00:00:00.000Z', contentHash, excerpt, provider: 'openrouter.exa' };
  const e = { id: `evi-${textHash(`${sourceId}:${quote}`).slice(0, 24)}`, sourceId, quote };
  const pack = { evidencePackVersion: '1.0', question: intent.comparisonUniverse.selectionQuestion, sources: [source], evidence: [e], claims: [{ text: quote, evidenceId: e.id, sourceId }], limitations: ['publication_dates_unknown', 'no_sales_metrics'] };
  const ref = { artifactId: artifact, evidenceId: e.id, sourceId, sourceContentHash: contentHash, start: Array.from(prefix).length, end: Array.from(prefix + quote).length };
  const candidate = { id: id(offset + 17), businessId: business, concept: 'Original outdoor illustration shirt', audience: 'Adult outdoor enthusiasts', productType: 'original_pod_tshirt', originalDesign: true, rightsStatus: 'unclear' };
  const dossier = { version: v2.DISCOVERY_V2, intentId: root, businessId: business, packRefs: [{ artifactId: artifact, sha256: digest(pack), origin: 'new', query: { id: queryId, question: pack.question, sourceDomains: ['etsy.com'] } }], shortlist: [candidate], comparisonRationale: prose };
  const strategy = { version: v2.DISCOVERY_V2, intentId: root, dossierHash: digest(dossier), execution: { modelId: 'openai/gpt-5.6-luna', providerRequestId: 'saved-strategy-request', primaryOnly: true }, marketComparisons: intent.comparisonUniverse.markets.map(market => ({ ...market, assessment: prose, evidenceRefs: [ref], assumptions: [], limitations: [prose], sellerBankCountry: null, feeScenarios: [] })), candidates: [{ candidateId: candidate.id, identityHash: digest(candidate), dimensions: types.DIMENSIONS.map(dimension => ({ dimension, finding: 'uncertain', evidenceStrength: 'adjacent', facts: [{ reference: ref, relevance: prose }], rationale: prose, uncertainties: [{ question: 'What additional saved observation resolves this uncertainty?', blockingForTest: true, reason: prose }], hardFailure: false })) }], recommendation: { proposedOutcome: 'NEEDS_MORE_EVIDENCE', marketCountryCode: 'US', candidateId: candidate.id, rationale: prose, alternatives: [] }, testPlan: null, missingQuestions: ['What additional saved observation resolves this uncertainty?'], publicationAllowed: false, commerceAllowed: false };
  const review = { version: v2.DISCOVERY_V2, intentId: root, dossierHash: digest(dossier), assessmentHash: digest(strategy), execution: { modelId: 'anthropic/claude-haiku-4.5', providerRequestId: 'saved-review-request', primaryOnly: true }, marketCountryCode: 'US', candidateId: candidate.id, outcome: 'NEEDS_MORE_EVIDENCE', sufficiencyRationale: prose, dimensions: types.DIMENSIONS.map(dimension => ({ dimension, verdict: 'blocking', rationale: prose, evidenceRefs: [ref] })), checks: v2.REVIEW_CHECKS_V2.map(check => ({ check, outcome: 'FAIL', rationale: prose })), executionPrerequisites: { ...v2.DISCOVERY_V2_EXECUTION_PREREQUISITES }, additionalUncertainties: [], missingQuestions: [...strategy.missingQuestions], publicationAllowed: false, commerceAllowed: false };
  const workflow = { id: run, business_id: business, status: 'completed', completed_at: stamp, intent_id: root, workflow_key: 'product.discovery-v2.one', workflow_version: '1.0.0' };
  const phase = (artifactId, content, key, stageId) => ({ artifact: row(artifactId, business, run, 'worker.output', content, { stageKey: key, receipt: { intentId: root, dossierHash: digest(dossier), outputHash: digest(content), actualProviderModelId: content.execution.modelId, providerRequestId: content.execution.providerRequestId } }), stage: { id: id(stageId), business_id: business, workflow_run_id: run, stage_key: key, attempt: 1, status: 'completed', completed_at: stamp, output: structuredClone(content) } });
  const output = { decision: 'complete', stopReason: 'evidence_collected', evidencePack: pack };
  return { scope: { businessId: business, experimentId: root, workflowRunId: run }, experiment: { id: root, business_id: business, workflow_run_id: run, discovery_version: v2.DISCOVERY_V2, candidate_id: null, parent_discovery_id: null, status: 'completed', completed_at: stamp, source_artifact_id: dossierId, intent, policy_hash: digest(intent), prior_artifact_ids: [], prior_evidence_hashes: [], analysis_source: null, evidence_pack: { version: v2.DISCOVERY_V2, intentId: root, dossierArtifactId: dossierId, strategyArtifactId: strategyId, reviewArtifactId: reviewId } }, workflow, dossier: row(dossierId, business, run, 'product.discovery-dossier.v2', dossier, { intentId: root, version: v2.DISCOVERY_V2, contentHash: digest(dossier) }), observedAt, evidenceRecords: [{ artifact: row(artifact, business, run, 'worker.output', output, { stageKey: 'research1' }), workflow: structuredClone(workflow), query: { id: queryId, business_id: business, workflow_run_id: run, collected_for_intent_id: root, question: pack.question, source_domains: ['etsy.com'] }, source: row(id(offset + 20), business, run, 'research.sources', { collectionVersion: '1.0', query: pack.question, sources: [structuredClone(source)], providerMetadata: { intentId: root, queryId } }, { stageKey: 'research1' }), stage: { id: id(offset + 21), business_id: business, workflow_run_id: run, stage_key: 'research1', attempt: 1, status: 'completed', completed_at: stamp, output: structuredClone(output) } }], strategy: phase(strategyId, strategy, 'strategy', offset + 22), review: phase(reviewId, review, 'review', offset + 23) };
}
export function rebind(f) {
  f.experiment.policy_hash = digest(f.experiment.intent);
  f.dossier.metadata.contentHash = digest(f.dossier.content);
  for (const value of [f.strategy, f.review]) {
    if (!value) continue;
    value.artifact.content.dossierHash = digest(f.dossier.content);
    if (value === f.review && f.strategy) value.artifact.content.assessmentHash = digest(f.strategy.artifact.content);
    value.artifact.metadata.receipt.dossierHash = digest(f.dossier.content);
    value.artifact.metadata.receipt.outputHash = digest(value.artifact.content);
    value.stage.output = structuredClone(value.artifact.content);
  }
  return f;
}
export function rebindEvidence(f, index = 0) {
  const evidence = f.evidenceRecords[index], pack = evidence.artifact.content.evidencePack;
  f.dossier.content.packRefs.find(ref => ref.artifactId === evidence.artifact.id).sha256 = digest(pack);
  const pin = f.experiment.prior_evidence_hashes.find(pin => pin.artifactId === evidence.artifact.id); if (pin) pin.sha256 = digest(pack);
  evidence.stage.output = structuredClone(evidence.artifact.content);
  return rebind(f);
}
export function analysisFixture(source = fixture(100), offset = 200) {
  const previous = structuredClone(source), f = fixture(offset), sourceRoot = previous.experiment.id;
  previous.experiment.status = 'failed'; previous.workflow.status = 'failed';
  for (const record of previous.evidenceRecords) if (record.workflow.id === previous.workflow.id) record.workflow.status = 'failed';
  f.experiment.intent.limits.maximumNewCollections = 0; f.workflow.workflow_key = 'product.discovery-v2.analysis';
  f.dossier.content.packRefs = previous.dossier.content.packRefs.map(ref => ({ ...structuredClone(ref), origin: 'prior' }));
  f.dossier.content.shortlist = structuredClone(previous.dossier.content.shortlist);
  f.experiment.prior_artifact_ids = f.dossier.content.packRefs.map(ref => ref.artifactId);
  f.experiment.prior_evidence_hashes = f.dossier.content.packRefs.map(({ artifactId, sha256 }) => ({ artifactId, sha256 }));
  const plan = previous.workflow.workflow_key === 'product.discovery-v2.analysis' ? structuredClone(previous.analysisSource.plan) : row(id(130), f.scope.businessId, previous.workflow.id, 'worker.output', { version: v2.DISCOVERY_V2, intentId: sourceRoot, comparisonRationale: previous.dossier.content.comparisonRationale }, { stageKey: 'plan' });
  f.experiment.analysis_source = { sourceRootId: sourceRoot, planArtifactId: plan.id, planHash: digest(plan.content), dossierArtifactId: previous.dossier.id, dossierHash: digest(previous.dossier.content) };
  f.experiment.follow_up_basis = { rootId: sourceRoot, reason: 'reuse_evidence_for_strategy_review' };
  f.analysisSource = { experiment: previous.experiment, workflow: previous.workflow, dossier: previous.dossier, plan,
    planStage: previous.workflow.workflow_key === 'product.discovery-v2.analysis' ? structuredClone(previous.analysisSource.planStage) : { id: id(131), business_id: f.scope.businessId, workflow_run_id: previous.workflow.id, stage_key: 'plan', attempt: 1, status: 'completed', completed_at: stamp, output: structuredClone(plan.content) },
    planExperiment: structuredClone(previous.workflow.workflow_key === 'product.discovery-v2.analysis' ? previous.analysisSource.planExperiment : previous.experiment),
    planWorkflow: structuredClone(previous.workflow.workflow_key === 'product.discovery-v2.analysis' ? previous.analysisSource.planWorkflow : previous.workflow) };
  f.evidenceRecords = previous.evidenceRecords;
  f.strategy.artifact.content = structuredClone(previous.strategy.artifact.content); f.strategy.artifact.content.intentId = f.experiment.id;
  f.review.artifact.content = structuredClone(previous.review.artifact.content); f.review.artifact.content.intentId = f.experiment.id;
  return rebind(f);
}
export function publicPriorFixture() {
  const f = fixture(), evidence = f.evidenceRecords[0], ref = f.dossier.content.packRefs[0], runId = id(990), pack = evidence.artifact.content.evidencePack;
  ref.origin = 'prior'; f.experiment.prior_artifact_ids = [ref.artifactId]; f.experiment.prior_evidence_hashes = [{ artifactId: ref.artifactId, sha256: ref.sha256 }];
  evidence.workflow = { id: runId, business_id: f.scope.businessId, workflow_key: 'research.public-evidence', workflow_version: '1.0.0', status: 'completed', completed_at: stamp, question: ref.query.question, source_domains: ref.query.sourceDomains };
  evidence.query.workflow_run_id = runId; evidence.query.collected_for_intent_id = null;
  for (const item of [evidence.artifact, evidence.source, evidence.stage]) item.workflow_run_id = runId;
  evidence.stage.stage_key = 'research'; evidence.artifact.metadata.stageKey = 'research'; evidence.source.metadata.stageKey = 'research';
  evidence.source.content.evidence = structuredClone(pack.evidence); evidence.source.content.providerMetadata = {};
  return rebind(f);
}
