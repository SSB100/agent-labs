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
    '../creative/image-provider': {}, '../creative/inspection': {}, '../creative/errors': errors,
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
    './creative-runtime-steps': { loadCreativeRun: async () => ({ status: 'running', phaseKey: 'brief:1' }),
      executeCreativePhase: async () => { throw runInNewContext("new Error('Creative phase output did not match its JSON schema. $.style: too long')"); },
      failCreativeRun: async (_input, message) => saved.push(message) },
  });
  await assert.rejects(() => creativeRuntimeWorkflow({}), /\$\.style: too long/);
  assert.equal(saved.length, 1);
  assert.match(saved[0], /\$\.style: too long/);
});
