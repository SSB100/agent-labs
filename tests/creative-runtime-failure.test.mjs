import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const errors = require('../.core-tests/creative/errors.js');
class FixtureFatalError extends Error {}

function loadSource(path, dependencies) {
  const compiled = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const fixtureModule = { exports: {} };
  runInNewContext(`(function(require, module, exports) { ${compiled}\n})`)(name => {
    if (!(name in dependencies)) throw new Error(`Unexpected fixture dependency: ${name}`);
    return dependencies[name];
  }, fixtureModule, fixtureModule.exports);
  return fixtureModule.exports;
}

test('failure messages survive workflow realm boundaries without serializing arbitrary objects', () => {
  const foreign = runInNewContext("new Error('Scoped validation failed at $.style')");
  assert.equal(foreign instanceof Error, false);
  assert.equal(errors.creativeFailureMessage(foreign), 'Scoped validation failed at $.style');
  assert.equal(errors.creativeFailureMessage({ message: 'Serialized provider failure' }), 'Serialized provider failure');
  assert.equal(errors.creativeFailureMessage({ secret: 'must-not-leak' }), 'Creative pipeline failed.');
  assert.equal(errors.creativeFailureMessage({ message: 'x'.repeat(1000) }).length, 500);
});

test('creative phase converts failures to FatalError and explicitly disables durable step retry', async () => {
  let workerCalls = 0;
  const operations = [];
  const { executeCreativePhase } = loadSource('src/workflows/creative-runtime-steps.ts', {
    '@supabase/supabase-js': {}, workflow: { FatalError: FixtureFatalError },
    '../lib/supabase/runtime': { createRuntimeClient: () => ({ rpc: async (_name, args) => {
      operations.push(args.p_operation);
      return { error: null, data: args.p_operation === 'load' ? { status: 'running', phaseKey: 'brief:1', approval: { purpose: 'technical_qualification' }, assets: [] } : { worker: {}, context: {} } };
    } }) }, '../lib/supabase/env': {}, '../creative/contracts': { validateCreativeApproval: () => {} },
    '../creative/image-provider': {}, '../creative/inspection': {}, '../creative/stored-image': {}, '../creative/errors': errors,
    '../creative/workers': { executeCreativeWorker: async () => { workerCalls++; throw { message: 'Creative phase output did not match its JSON schema. $.style: too long' }; } },
  });
  assert.equal(executeCreativePhase.maxRetries, 0);
  await assert.rejects(() => executeCreativePhase({ creativeRunId: 'fixture', businessId: 'fixture', runtimeCapability: 'mock-only' }, 'brief:1'),
    error => error instanceof FixtureFatalError && error.message.includes('$.style: too long'));
  assert.equal(workerCalls, 1);
  assert.deepEqual(operations, ['load', 'prepare']);
});

test('workflow retains the useful cross-realm phase failure in owner intervention', async () => {
  const saved = [];
  const { creativeRuntimeWorkflow } = loadSource('src/workflows/creative-runtime.ts', {
    workflow: { FatalError: FixtureFatalError, getWorkflowMetadata: () => ({ workflowRunId: 'mock-workflow' }) },
    '../creative/errors': errors,
    './creative-runtime-steps': { loadCreativeRun: async () => ({ status: 'running', phaseKey: 'brief:1', approval: { maximumGenerations: 2 } }),
      executeCreativePhase: async () => { throw runInNewContext("new Error('Creative phase output did not match its JSON schema. $.style: too long')"); },
      failCreativeRun: async (_input, message) => saved.push(message) },
  });
  await assert.rejects(() => creativeRuntimeWorkflow({}), /\$\.style: too long/);
  assert.equal(saved.length, 1);
  assert.match(saved[0], /\$\.style: too long/);
});

test('normalization failure settles the paid generation and preserves its source evidence once', async () => {
  const operations = [], settlements = []; let paid = 0;
  const source = { storagePath: 'fixture/version-1.original.webp', mediaType: 'image/webp', bytes: 64, sha256: 'a'.repeat(64), uploadConfirmed: true, downloadVerified: true };
  const { executeCreativePhase } = loadSource('src/workflows/creative-runtime-steps.ts', {
    '@supabase/supabase-js': { createClient: () => ({ storage: { from: () => ({}) } }) }, workflow: { FatalError: FixtureFatalError },
    '../lib/supabase/runtime': { createRuntimeClient: () => ({ rpc: async (_name, args) => {
      operations.push(args.p_operation);
      if (args.p_operation === 'record_call') settlements.push(args.p_payload);
      return { error: null, data: args.p_operation === 'load' ? { status: 'running', phaseKey: 'generate:1',
        approval: { purpose: 'technical_qualification', maximumGenerations: 1, printSpecification: {} }, quote: { generatorModel: 'recraft/recraft-v4.1-pro' }, brief: { imagePrompt: 'Synthetic approved prompt' }, screen: { outcome: 'PASS' }, reviews: [] }
        : args.p_operation === 'reserve_call' ? { shouldExecute: true } : {} };
    } }) }, '../lib/supabase/env': { getSupabasePublicConfig: () => ({ url: 'https://example.invalid', publishableKey: 'mock-public' }) },
    '../creative/contracts': { validateCreativeApproval() {}, validateDesignBrief() {}, validateBriefScreen() {} },
    '../creative/image-provider': { getImageGenerationPolicy: modelId => ({ modelId, nativePngRequired: false }), ImageProviderError: class extends Error {}, OpenRouterImageAdapter: class {
      async preflight() { return { estimatedMicrousd: 210000, requestHash: 'b'.repeat(64), modelId: 'recraft/recraft-v4.1-pro' }; }
      async generate() { paid++; return { bytes: new Uint8Array(64), mediaType: 'image/webp', declaredMediaType: 'image/webp',
        receipt: { reportedMicrousd: 210000, providerRequestId: 'gen-retained' } }; }
    } }, '../creative/inspection': {}, '../creative/errors': errors, '../creative/workers': {},
    '../creative/stored-image': { storeCreativeImage: async input => { input.onSourceProgress(source); throw new Error('Unsupported source metadata'); } },
  });
  await assert.rejects(executeCreativePhase({ creativeRunId: 'fixture', businessId: 'fixture', runtimeCapability: 'mock-only' }, 'generate:1'), FixtureFatalError);
  assert.equal(paid, 1); assert.deepEqual(operations, ['load', 'reserve_call', 'record_call']);
  assert.equal(settlements.length, 1); assert.equal(settlements[0].reportedMicrousd, 210000);
  assert.equal(settlements[0].receipt.outputValidated, false);
  assert.equal(JSON.stringify(settlements[0].receipt.sourcePreservation), JSON.stringify(source));
  assert.equal(executeCreativePhase.maxRetries, 0);
});

test('one-image runtime rejects second phases before any provider reservation', async () => {
  const operations = [];
  const { executeCreativePhase } = loadSource('src/workflows/creative-runtime-steps.ts', {
    '@supabase/supabase-js': {}, workflow: { FatalError: FixtureFatalError },
    '../lib/supabase/runtime': { createRuntimeClient: () => ({ rpc: async (_name, args) => {
      operations.push(args.p_operation); return { error: null, data: { status: 'running', phaseKey: 'generate:2', approval: { maximumGenerations: 1 } } };
    } }) }, '../lib/supabase/env': {}, '../creative/contracts': { validateCreativeApproval() {} },
    '../creative/image-provider': {}, '../creative/inspection': {}, '../creative/errors': errors, '../creative/workers': {}, '../creative/stored-image': {},
  });
  await assert.rejects(executeCreativePhase({}, 'generate:2'), /one image only/);
  assert.deepEqual(operations, ['load']);
});
