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
  const dataLoader = await readProjectFile("src/lib/core-ui/data.ts");
  const action = await readProjectFile("src/app/dashboard/actions.ts");
  const proxy = await readProjectFile("src/lib/supabase/proxy.ts");
  const combined = `${dataLoader}\n${action}\n${proxy}`;

  assert.match(dataLoader, /auth\.getClaims\(\)/);
  assert.match(action, /auth\.getClaims\(\)/);
  assert.match(proxy, /auth\.getClaims\(\)/);
  assert.doesNotMatch(combined, /auth\.getSession\(\)/);
  assert.match(dataLoader, /\.eq\("owner_user_id", userId\)/);
  assert.match(action, /owner_user_id: userId/);
});

test("the application opens as a private login-first control centre", async () => {
  const rootPage = await readProjectFile("src/app/page.tsx");
  const loginPage = await readProjectFile("src/app/login/page.tsx");
  const loginActions = await readProjectFile("src/app/login/actions.ts");
  const dashboard = await readProjectFile("src/app/dashboard/page.tsx");
  const layout = await readProjectFile("src/app/layout.tsx");
  const robots = await readProjectFile("src/app/robots.ts");

  assert.match(rootPage, /redirect\("\/login"\)/);
  assert.match(rootPage, /redirect\("\/dashboard"\)/);
  assert.match(loginPage, /Owner access only\./);
  assert.match(dashboard, /title="Control centre"/);
  assert.doesNotMatch(loginPage, /create account|new owner|sign up/i);
  assert.doesNotMatch(loginActions, /signUp|signup/);
  assert.match(layout, /index:\s*false/);
  assert.match(layout, /follow:\s*false/);
  assert.match(robots, /disallow:\s*"\/"/);
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
