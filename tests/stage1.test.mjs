import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readProjectFile = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Stage 1 migration creates the three planned tables with RLS", async () => {
  const migration = await readProjectFile(
    "supabase/migrations/20260929003530_initial_identity_business.sql",
  );

  for (const table of ["profiles", "businesses", "business_members"]) {
    assert.match(migration, new RegExp(`create table public\\.${table}`));
    assert.match(
      migration,
      new RegExp(`alter table public\\.${table} enable row level security`),
    );
  }

  assert.match(migration, /create schema if not exists private/);
  assert.match(migration, /security definer\s+set search_path = ''/);
  assert.match(migration, /create policy businesses_insert_owned/);
  assert.match(migration, /owner_user_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /grant select on table public\.business_members to authenticated/);
  assert.doesNotMatch(
    migration,
    /grant\s+(?:insert|update|delete)[^;]*business_members[^;]*authenticated/i,
  );
});

test("server authorization validates claims rather than trusting a stored session", async () => {
  const dashboard = await readProjectFile("src/app/dashboard/page.tsx");
  const action = await readProjectFile("src/app/dashboard/actions.ts");
  const proxy = await readProjectFile("src/lib/supabase/proxy.ts");
  const combined = `${dashboard}\n${action}\n${proxy}`;

  assert.match(dashboard, /auth\.getClaims\(\)/);
  assert.match(action, /auth\.getClaims\(\)/);
  assert.match(proxy, /auth\.getClaims\(\)/);
  assert.doesNotMatch(combined, /auth\.getSession\(\)/);
  assert.match(dashboard, /\.eq\("owner_user_id", userId\)/);
  assert.match(action, /owner_user_id: userId/);
});

test("email confirmation supports token hashes and PKCE codes", async () => {
  const confirmRoute = await readProjectFile("src/app/auth/confirm/route.ts");

  assert.match(confirmRoute, /verifyOtp/);
  assert.match(confirmRoute, /exchangeCodeForSession/);
  assert.match(confirmRoute, /value\.startsWith\("\/"\)/);
  assert.match(confirmRoute, /value\.startsWith\("\/\/"\)/);
});

test("every Vercel build runs the Stage 1 quality gate", async () => {
  const packageJson = JSON.parse(await readProjectFile("package.json"));

  assert.equal(packageJson.scripts.build, "npm run quality && next build");
  assert.match(packageJson.scripts.quality, /lint/);
  assert.match(packageJson.scripts.quality, /typecheck/);
  assert.match(packageJson.scripts.quality, /npm test/);
});
