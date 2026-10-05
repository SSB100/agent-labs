import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const routePath = new URL('../src/app/auth/signout/route.ts', import.meta.url);
const request = { url: 'https://owner-entry.invalid/auth/signout?returnTo=https://external.invalid' };

function signoutFixture({
  claimsResult = { data: { claims: { sub: 'fixture-owner' } } },
  claimsFailure,
  signoutFailure,
  signoutResult = { error: null },
  signoutGate,
} = {}) {
  const calls = [];
  const sessions = new Set(['current', 'other-browser', 'other-device']);
  const dependencies = {
    '@/lib/supabase/server': { async createClient() {
      calls.push(['createClient']);
      return { auth: {
        async getClaims() {
          calls.push(['getClaims']);
          if (claimsFailure) throw claimsFailure;
          return claimsResult;
        },
        async signOut(options) {
          calls.push(['signOut', options && { ...options }]);
          if (signoutGate) await signoutGate;
          if (signoutFailure) throw signoutFailure;
          // Model the documented SDK scope semantics without touching real auth.
          // Omitting scope must reproduce the global-logout regression.
          if (!signoutResult.error) {
            const scope = options?.scope ?? 'global';
            if (scope === 'global') sessions.clear();
            else if (scope === 'local') sessions.delete('current');
            else if (scope === 'others') {
              sessions.delete('other-browser');
              sessions.delete('other-device');
            } else assert.fail(`Unexpected signout scope: ${scope}`);
          }
          calls.push(['signOut:complete']);
          return signoutResult;
        },
      } };
    } },
    'next/cache': { revalidatePath: (...args) => calls.push(['revalidatePath', ...args]) },
    'next/server': { NextResponse: { redirect(destination, options) {
      const response = { url: String(destination), status: options.status };
      calls.push(['redirect', response.url, response.status]);
      return response;
    } } },
  };
  // Execute the actual production route, following the existing source-fixture
  // convention. Every dependency is explicit; auth/network imports fail closed.
  const code = ts.transpileModule(readFileSync(routePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const fixtureModule = { exports: {} };
  runInNewContext(`(function(require,module,exports){${code}\n})`, { URL })(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected signout dependency: ${name}`);
    return dependencies[name];
  }, fixtureModule, fixtureModule.exports);
  assert.deepEqual(Object.keys(fixtureModule.exports), ['POST']);
  return { POST: fixtureModule.exports.POST, calls, sessions };
}

const finishCalls = [
  ['revalidatePath', '/', 'layout'],
  ['redirect', 'https://owner-entry.invalid/login?message=signed-out', 303],
];

test('production signout explicitly ends only the current owner session and keeps other sessions', async () => {
  const fixture = signoutFixture();
  const response = await fixture.POST(request);
  assert.deepEqual(fixture.calls, [
    ['createClient'], ['getClaims'], ['signOut', { scope: 'local' }],
    ['signOut:complete'], ...finishCalls,
  ]);
  assert.deepEqual([...fixture.sessions], ['other-browser', 'other-device']);
  assert.deepEqual(response, { url: finishCalls[1][1], status: 303 });
});

test('production signout skips auth mutation without a claimed subject and preserves cache/redirect behavior', async () => {
  for (const claimsResult of [
    { data: null }, {}, { data: {} }, { data: { claims: null } },
    { data: { claims: {} } }, { data: { claims: { sub: '' } } },
    { data: null, error: { message: 'Session expired' } },
  ]) {
    const fixture = signoutFixture({ claimsResult });
    const response = await fixture.POST(request);
    assert.deepEqual(fixture.calls, [['createClient'], ['getClaims'], ...finishCalls]);
    assert.deepEqual([...fixture.sessions], ['current', 'other-browser', 'other-device']);
    assert.deepEqual(response, { url: finishCalls[1][1], status: 303 });
  }
});

test('production signout awaits the local signout before revalidation or redirect', async () => {
  let release;
  const signoutGate = new Promise(resolve => { release = resolve; });
  const fixture = signoutFixture({ signoutGate });
  const pending = fixture.POST(request);
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(fixture.calls, [
      ['createClient'], ['getClaims'], ['signOut', { scope: 'local' }],
    ]);
    assert.deepEqual([...fixture.sessions], ['current', 'other-browser', 'other-device']);
  } finally {
    release();
    await pending;
  }
  assert.deepEqual(fixture.calls.slice(-3), [['signOut:complete'], ...finishCalls]);
  assert.deepEqual([...fixture.sessions], ['other-browser', 'other-device']);
});

test('production signout preserves the existing resolved-error redirect behavior without broadening scope', async () => {
  const fixture = signoutFixture({ signoutResult: { error: { message: 'Auth unavailable' } } });
  await fixture.POST(request);
  assert.deepEqual(fixture.calls, [
    ['createClient'], ['getClaims'], ['signOut', { scope: 'local' }],
    ['signOut:complete'], ...finishCalls,
  ]);
  assert.deepEqual([...fixture.sessions], ['current', 'other-browser', 'other-device']);
});

test('production signout preserves thrown-auth failures without revalidating or redirecting', async () => {
  const failure = new Error('Auth unavailable');
  for (const field of ['claimsFailure', 'signoutFailure']) {
    const fixture = signoutFixture({ [field]: failure });
    await assert.rejects(fixture.POST(request), error => error === failure);
    assert.deepEqual(fixture.calls, [
      ['createClient'], ['getClaims'],
      ...(field === 'signoutFailure' ? [['signOut', { scope: 'local' }]] : []),
    ]);
    assert.deepEqual([...fixture.sessions], ['current', 'other-browser', 'other-device']);
  }
});
