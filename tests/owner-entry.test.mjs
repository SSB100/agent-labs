import assert from 'node:assert/strict';
import test from 'node:test';
import { ownerReturnPath, ownerLoginPath } from '../.core-tests/core/owner-entry.js';
import { loadSource } from './helpers/guided-ui.mjs';

test('private entry retains exact Business, record, section and reading context', () => {
  const target = '/dashboard/workflows/saved-run?business=owned&panel=outputs&artifact=old&page=3#receipt';
  assert.equal(ownerReturnPath(target), target);
  const login = new URL(ownerLoginPath('session-required', target), 'https://owner-entry.invalid');
  assert.equal(login.pathname, '/login');
  assert.equal(login.searchParams.get('error'), 'session-required');
  assert.equal(login.searchParams.get('returnTo'), target);
});

test('private entry rejects external, malformed and encoded path escapes', () => {
  for (const target of [undefined, {}, '', '/login', '/dashboard-other', '//external.invalid/dashboard',
    'https://external.invalid/dashboard', '/dashboard/../../login', '/dashboard/../login',
    '/dashboard\\external', '/dashboard/%5cexternal', '/dashboard/%2fexternal', '/dashboard/%252fexternal',
    '/dashboard/%00', '/dashboard/%', '/dashboard/\nlogin', '/dashboard/' + 'x'.repeat(4096)]) {
    assert.equal(ownerReturnPath(target), '/dashboard', String(target));
    assert.equal(ownerLoginPath('auth-failed', target), '/login?error=auth-failed');
  }
});

test('invalid login fields retain the exact return without touching authentication or cache', async () => {
  const stop = () => { throw Error('Invalid empty entry must not touch auth or cache'); };
  const { login } = loadSource('src/app/login/actions.ts', {
    'next/cache': { revalidatePath: stop },
    'next/navigation': { redirect: destination => { throw new Error(destination); } },
    '@/core/owner-entry': { ownerReturnPath, ownerLoginPath },
    '@/lib/supabase/server': { createClient: stop },
  });
  const form = new FormData(), destination = '/dashboard?view=work&business=owned&run=exact';
  form.set('returnTo', destination);
  await assert.rejects(login(form), error => {
    const url = new URL(error.message, 'https://owner-entry.invalid');
    assert.equal(url.searchParams.get('error'), 'invalid-fields');
    assert.equal(url.searchParams.get('returnTo'), destination);
    return true;
  });
});

test('session cookie refresh preserves the trusted return header and cache controls', async () => {
  const requestHeaders = new Headers({ cookie: 'inert-original=on', 'x-agent-labs-return-path': '/dashboard?view=work' });
  const writes = [], request = { headers: new Headers(requestHeaders), cookies: {
    getAll: () => [{ name: 'inert-original', value: 'on' }],
    set(name, value) { request.headers.set('cookie', `inert-original=on; ${name}=${value}`); },
  } };
  const { updateSupabaseSession } = loadSource('src/lib/supabase/proxy.ts', {
    '@supabase/ssr': { createServerClient(_url, _key, { cookies }) { return { auth: {
      async getClaims() {
        assert.equal(cookies.getAll().length, 1);
        cookies.setAll([{ name: 'inert-refresh', value: 'on', options: { httpOnly: true } }], { 'cache-control': 'private, no-store' });
      },
    } }; } },
    'next/server': { NextResponse: { next: options => ({ requestHeaders: new Headers(options.request.headers), headers: new Headers(), cookies: { set: (...args) => writes.push(args) } }) } },
    './env': { isSupabaseConfigured: () => true, getSupabasePublicConfig: () => ({ url: 'http://127.0.0.1:9', publishableKey: 'inert' }) },
  });
  const response = await updateSupabaseSession(request, requestHeaders);
  assert.equal(response.requestHeaders.get('x-agent-labs-return-path'), '/dashboard?view=work');
  assert.match(response.requestHeaders.get('cookie'), /inert-refresh=on/);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(writes[0])), ['inert-refresh', 'on', { httpOnly: true }]);
});
