import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
const require = createRequire(import.meta.url);

test('patched nanoid retains the fixed-length customRandom API used by Workflow', async () => {
  const workflowRequire = createRequire(require.resolve('@workflow/core'));
  const nanoid = await import(pathToFileURL(workflowRequire.resolve('nanoid')).href);
  const generate = nanoid.customRandom(nanoid.urlAlphabet, 21, size => new Uint8Array(randomBytes(size)));
  const values = Array.from({ length: 20 }, () => generate());
  assert.ok(values.every(value => value.length === 21 && /^[A-Za-z0-9_-]+$/.test(value)));
  assert.equal(new Set(values).size, values.length);
});

test('patched Undici preserves Workflow Agent and RetryAgent construction without making a request', async () => {
  const workflowRequire = createRequire(require.resolve('@workflow/world-vercel'));
  const { Agent, RetryAgent, DecoratorHandler } = await import(pathToFileURL(workflowRequire.resolve('undici')).href);
  assert.equal(typeof DecoratorHandler, 'function');
  const dispatcher = new RetryAgent(new Agent({ connections: 1, pipelining: 1, allowH2: false }), { maxRetries: 0 });
  assert.equal(typeof dispatcher.dispatch, 'function');
  await dispatcher.close();
});
