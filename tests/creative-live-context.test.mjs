import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { executeCreativeWorker } = require('../.core-tests/creative/workers.js');
const { creativePackManifests } = require('../.core-tests/creative/packs.js');
const { etsyKnowledgePackManifests } = require('../.core-tests/packs/etsy-knowledge.js');
const { technicalCreativeApproval } = require('../.core-tests/creative/proposal.js');
const { creativeHash, validateDesignBrief } = require('../.core-tests/creative/contracts.js');
const { parseCreativeModelQuote, CREATIVE_BUDGET } = require('../.core-tests/creative/budget.js');
const { SCREEN_CATEGORIES, REVIEW_CRITERIA, SAFE_REPAIR_INSTRUCTIONS } = require('../.core-tests/creative/types.js');

const id = n => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
const catalog = { data: [
  { id: 'openai/gpt-5.6-luna', pricing: { prompt: '0.0000002', completion: '0.0000012' } },
  { id: 'anthropic/claude-haiku-4.5', pricing: { prompt: '0.000001', completion: '0.000005', input_cache_write_1h: '0.000002' } },
] };

// Synthetic values with the actual stage14_prepare/persist_phase envelope, including
// receipts, knowledge provenance, the current image artifact and the earlier FAIL.
// The three bytes are test-only pixels; no image, price, database or browser service is used.
export function liveContextFixture(callKey, { oversized = false } = {}) {
  const approval = technicalCreativeApproval(id(1), id(2), 1_000_000, {
    concept: 'Synthetic geometric tree fixture', audience: 'Adult synthetic test audience',
    designInstructions: 'Synthetic test-only original tree arrangement on an intentional opaque square; no protected elements or reference images.',
  }, id(3));
  approval.printSpecification.verifiedAt = new Date().toISOString();
  const brief = {
    version: '1.0', approvalId: approval.approvalId, audience: approval.audience, concept: approval.concept,
    style: 'Simple original flat graphic illustration', hierarchy: 'Three pine trees below one circular sun',
    typography: 'No text, letters or words in the artwork', placement: approval.printSpecification.placement,
    garmentCompatibility: approval.printSpecification.garment, colors: ['#245432', '#FFF5DB'],
    forbiddenElements: ['brands', 'logos', 'protected characters'],
    originalityRequirements: 'Original composition without third-party references or imitation',
    imagePrompt: 'Original simple three-pine-tree and sun illustration on an intentional opaque cream square, no text or named brands, no protected characters, no reference artwork.',
  };
  if (oversized) {
    for (const field of ['style', 'hierarchy', 'typography', 'originalityRequirements']) brief[field] = 'a'.repeat(600);
    brief.imagePrompt = 'a'.repeat(3500);
    brief.forbiddenElements = Array.from({ length: 16 }, (_, i) => `${i}-` + 'a'.repeat(117));
  }
  validateDesignBrief(brief, approval);
  const approvalHash = creativeHash(approval), briefHash = creativeHash(brief);
  const inspection = { sha256: 'a'.repeat(64), mediaType: 'image/png', bytes: 3, width: 1024, height: 1024,
    colorSpace: 'srgb', hasAlpha: false, transparentPixelFraction: 0, effectiveDpi: 1024 / 6.5, failedCriteria: [] };
  const review = { version: '1.0', assetHash: inspection.sha256, briefHash,
    checks: REVIEW_CRITERIA.map(criterion => ({ criterion, outcome: 'PASS', rationale: 'Synthetic test-only criterion result for contract testing.' })),
    outcome: 'PASS', repairInstruction: null };
  const priorReview = { ...review, checks: review.checks.map((check, i) => i ? check : { ...check, outcome: 'FAIL' }),
    outcome: 'FAIL', repairInstruction: SAFE_REPAIR_INSTRUCTIONS[0] };
  const worker = creativePackManifests().find(pack => pack.packKey ===
    (callKey === 'brief:1' ? 'worker.etsy-creative-director' : 'worker.etsy-creative-reviewer')).workers[0];
  const artifacts = [{ id: id(4), artifactType: 'creative.approval', name: 'Owner creative approval', mediaType: 'application/json',
    content: approval, metadata: { checksum: approvalHash, storagePath: null } }];
  const textReceipt = { model: 'openai/gpt-5.6-luna', provider: 'openrouter', providerRequestId: 'fixture-request-id',
    outputValidated: true, executionMode: 'creative.model', mockProvider: false, actualProviderModelId: 'openai/gpt-5.6-luna',
    upstreamProvider: 'OpenAI', inputTokens: 6000, outputTokens: 500, reportedCostUsd: 0.002, estimatedCostUsd: 0.002, latencyMs: 1000 };
  if (callKey !== 'brief:1') artifacts.push({ id: id(5), artifactType: 'creative.brief', name: 'Creative brief:1',
    mediaType: 'application/json', content: brief, metadata: { receipt: textReceipt, approvalId: approval.approvalId,
      approvalHash, briefHash: null, callKey: 'brief:1', checksum: briefHash, storagePath: null } });
  for (const [i, knowledge] of etsyKnowledgePackManifests().flatMap(pack => pack.knowledge)
    .filter(item => ['etsy.current-policy', 'pod.production'].includes(item.key)).entries()) {
    artifacts.push({ id: id(10 + i), artifactType: 'pack.knowledge', name: knowledge.name, mediaType: 'application/json', content: knowledge.content,
      metadata: { knowledgeKey: knowledge.key, knowledgeVersion: knowledge.version, source: knowledge.source, verifiedAt: knowledge.verifiedAt,
        packId: id(88 + i), checksum: creativeHash(knowledge.content), storagePath: null } });
  }
  if (callKey.startsWith('review:')) {
    const generation = callKey === 'review:2' ? 2 : 1;
    const storagePath = `${approval.businessId}/${id(99)}/version-${generation}.png`;
    const prompt = brief.imagePrompt + (generation === 2 ? `\n\nRepair instruction: ${priorReview.repairInstruction}` : '');
    const imageReceipt = { capability: 'image.generate', provider: 'openrouter', upstreamProvider: 'recraft', modelId: 'recraft/recraft-v4.1-pro',
      providerRequestId: 'fixture-image-request', reservationId: `${id(99)}:generate:${generation}`, quoteId: 'fixture-quote',
      promptHash: 'b'.repeat(64), requestHash: 'c'.repeat(64), elapsedMs: 1000, estimatedMicrousd: 210000,
      reportedCostUsd: 0.21, reportedMicrousd: 210000, inputTokens: null, outputTokens: null, totalTokens: null,
      model: 'recraft/recraft-v4.1-pro', outputValidated: true, executionMode: 'image.generate', mockProvider: false };
    artifacts.push({ id: id(50), artifactType: 'creative.image', name: `Creative generate:${generation}`, mediaType: 'image/png',
      content: { inspection, storagePath, prompt, model: 'recraft/recraft-v4.1-pro', provider: 'openrouter', generatedAt: new Date().toISOString() },
      metadata: { receipt: imageReceipt, approvalId: approval.approvalId, approvalHash, briefHash, callKey: `generate:${generation}`,
        checksum: inspection.sha256, storagePath } });
    if (generation === 2) artifacts.push({ id: id(51), artifactType: 'creative.review', name: 'Creative review:1', mediaType: 'application/json',
      content: priorReview, metadata: { receipt: { ...textReceipt, model: 'anthropic/claude-haiku-4.5',
        actualProviderModelId: 'anthropic/claude-haiku-4.5', upstreamProvider: 'Anthropic' }, approvalId: approval.approvalId,
        approvalHash, briefHash, callKey: 'review:1', checksum: creativeHash(priorReview), storagePath: null } });
  }
  const context = { taskContract: { id: id(20), objective: callKey === 'brief:1' ? 'Create one scoped original Design Brief'
    : callKey === 'screen:1' ? 'Independently screen this final Design Brief for all eight IP/policy categories'
      : 'Inspect the supplied PNG pixels against this exact brief and five review criteria',
    inputArtifactIds: artifacts.map(artifact => artifact.id), permittedCapabilities: [], requiredKnowledge: ['etsy.current-policy', 'pod.production'],
    requiredOutputSchema: worker.manifest.outputSchema, completionCriteria: { outputValidated: true, approvalHash, actualPixelsRequired: callKey.startsWith('review:') },
    failureCriteria: { noAutomaticRetry: true, unknownRights: 'needs_owner' }, nonGoals: ['No strategy changes', 'No publication', 'No arbitrary tools', 'No unapproved spending'],
    escalationRules: { maximumAttempts: 1, maximumGenerations: 2, repeatedFailure: 'needs_owner' } }, inputArtifacts: artifacts };
  const output = callKey === 'brief:1' ? brief : callKey === 'screen:1' ? { version: '1.0', briefHash, approvalHash,
    checks: SCREEN_CATEGORIES.map(category => ({ category, status: 'clear', rationale: 'Synthetic test-only screen of the requested generic original illustration.' })),
    outcome: 'PASS' } : review;
  const requests = [], reservations = [], settlements = [];
  return { approval, brief, inspection, context, priorReview, requests, reservations, settlements,
    input: { callKey, approval, brief: callKey === 'brief:1' ? null : brief, worker, context,
      ...(callKey.startsWith('review:') ? { inspection, imageBytes: new Uint8Array([1, 2, 3]) } : {}),
      prices: async model => parseCreativeModelQuote(catalog, model),
      ledger: { reserve: async reservation => { reservations.push(reservation); return { shouldExecute: true, committedMicrousd: reservation.reservedMicrousd }; },
        record: async (...args) => { settlements.push(args); } },
      adapter: { invokeStructured: async request => { requests.push(request); return { output, provider: 'openrouter', providerModelId: request.model.providerModelId,
        providerRequestId: 'synthetic-live-envelope', latencyMs: 1, metadata: {}, usage: { inputTokens: 100, outputTokens: 100, totalTokens: 200,
          cachedInputTokens: 0, reasoningTokens: 0, reportedCostUsd: 0, estimatedCostUsd: 0 } }; } },
    },
  };
}

for (const callKey of ['brief:1', 'screen:1', 'review:1', 'review:2']) {
  test(`SQL-shaped ${callKey} preserves creative evidence within the existing 24KB cap`, async () => {
    const fixture = liveContextFixture(callKey);
    const originalContext = structuredClone(fixture.context);
    await executeCreativeWorker(fixture.input);
    assert.equal(fixture.requests.length, 1);
    assert.equal(fixture.reservations.length, 1);
    assert.ok(fixture.reservations[0].estimate.textRequestBytes <= CREATIVE_BUDGET.maximumTextRequestBytes);
    assert.deepEqual(fixture.context, originalContext, 'Prompt projection must not mutate immutable source context');
    const request = fixture.requests[0], prompt = JSON.parse(request.messages[1].content);
    assert.equal(prompt.taskContract.inputArtifactIdsFrom, 'inputArtifacts[].id');
    assert.deepEqual(prompt.inputArtifacts.map(artifact => artifact.id).sort(), [...fixture.context.taskContract.inputArtifactIds].sort());
    for (const artifact of fixture.context.inputArtifacts.filter(item => item.artifactType !== 'creative.image')) {
      const supplied = prompt.inputArtifacts.find(item => item.id === artifact.id);
      assert.ok(supplied, `Missing original artifact ${artifact.artifactType}`);
      if (artifact.artifactType === 'creative.approval' && supplied.content.policyScreenEncoding) {
        const { policyScreenEncoding, policyScreen, ...approval } = supplied.content;
        assert.match(policyScreenEncoding, /each listed category has exactly/);
        const expanded = policyScreen.flatMap(({ categories, ...screen }) => categories.map(category => ({ category, ...screen })));
        assert.deepEqual(approval, Object.fromEntries(Object.entries(artifact.content).filter(([key]) => key !== 'policyScreen')));
        assert.deepEqual(expanded.sort((a, b) => a.category.localeCompare(b.category)), [...artifact.content.policyScreen].sort((a, b) => a.category.localeCompare(b.category)), 'Grouped approval is losslessly recoverable');
      } else assert.deepEqual(supplied.content, artifact.content, 'Brief, knowledge and prior review content stay complete');
    }
    if (callKey.startsWith('review:')) {
      assert.equal(request.messages[1].images[0].base64, 'AQID');
      const imageArtifact = prompt.inputArtifacts.find(item => item.artifactType === 'creative.image');
      const boundInspection = prompt.binding.inspection.artifactId
        ? prompt.inputArtifacts.find(item => item.id === prompt.binding.inspection.artifactId).content.inspection
        : prompt.binding.inspection;
      assert.deepEqual(boundInspection, fixture.inspection);
      assert.equal(prompt.binding.assetHash, fixture.inspection.sha256);
      if (imageArtifact.content.promptFromBrief) {
        const original = fixture.context.inputArtifacts.find(item => item.artifactType === 'creative.image');
        const expected = fixture.brief.imagePrompt + (callKey === 'review:2' ? `\n\nRepair instruction: ${fixture.priorReview.repairInstruction}` : '');
        assert.equal(original.content.prompt, expected, 'Only the exact duplicated generation prompt can be referenced');
        assert.equal(imageArtifact.content.repairFromPriorReview, callKey === 'review:2' ? true : undefined);
        assert.deepEqual(imageArtifact.content.inspection, fixture.inspection);
      }
    }
    if (callKey === 'review:2') {
      assert.deepEqual(prompt.inputArtifacts.find(item => item.artifactType === 'creative.review').content, fixture.priorReview);
      assert.equal(fixture.priorReview.outcome, 'FAIL');
    }
  });
}

test('divergent generated-image context is preserved instead of being treated as a duplicate', async () => {
  const fixture = liveContextFixture('review:1');
  const imageArtifact = fixture.context.inputArtifacts.find(item => item.artifactType === 'creative.image');
  imageArtifact.content = { ...imageArtifact.content, prompt: 'Divergent synthetic image prompt data',
    inspection: { ...fixture.inspection, sha256: 'd'.repeat(64) } };
  await executeCreativeWorker(fixture.input);
  const prompt = JSON.parse(fixture.requests[0].messages[1].content);
  assert.deepEqual(prompt.inputArtifacts.find(item => item.id === imageArtifact.id).content, imageArtifact.content);
  assert.deepEqual(prompt.binding.inspection, fixture.inspection);
});

test('a divergent image prompt is retained instead of being disguised as the approved brief', async () => {
  const fixture = liveContextFixture('review:1');
  const image = fixture.context.inputArtifacts.find(artifact => artifact.artifactType === 'creative.image');
  image.content.prompt = 'Divergent fixture generation prompt that must remain visible to the independent reviewer.';
  await executeCreativeWorker(fixture.input);
  const prompt = JSON.parse(fixture.requests[0].messages[1].content);
  assert.deepEqual(prompt.inputArtifacts.find(artifact => artifact.id === image.id).content, image.content);
  assert.deepEqual(prompt.binding.inspection, fixture.inspection);
});

test('an oversized otherwise-valid creative context stops before reservation and provider invocation', async () => {
  const fixture = liveContextFixture('review:2', { oversized: true });
  await assert.rejects(() => executeCreativeWorker(fixture.input), /Creative context exceeds its declared input allowance/);
  assert.equal(fixture.reservations.length, 0);
  assert.equal(fixture.requests.length, 0);
  assert.equal(fixture.settlements.length, 0);
});
