import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readProjectFile = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the public Supabase environment contract is documented", async () => {
  const example = await readProjectFile(".env.example");

  assert.match(example, /^NEXT_PUBLIC_SUPABASE_URL=/m);
  assert.match(example, /^NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=/m);
  assert.doesNotMatch(example, /service_role/i);
});

test("the Vercel function region stays close to the Sydney database", async () => {
  const config = JSON.parse(await readProjectFile("vercel.json"));

  assert.deepEqual(config.regions, ["syd1"]);
  assert.equal(config.framework, "nextjs");
});
