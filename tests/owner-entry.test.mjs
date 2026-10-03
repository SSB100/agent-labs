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
