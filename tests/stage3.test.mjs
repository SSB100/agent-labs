import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readProjectFile = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Workflow SDK is configured for Next.js without intercepting internal routes", async () => {
  const packageJson = JSON.parse(await readProjectFile("package.json"));
  const nextConfig = await readProjectFile("next.config.ts");
  const proxy = await readProjectFile("proxy.ts");
  const tsconfig = JSON.parse(await readProjectFile("tsconfig.json"));

  assert.equal(packageJson.dependencies.workflow, "4.8.9");
  assert.match(nextConfig, /withWorkflow/);
  assert.match(nextConfig, /export default withWorkflow\(nextConfig\)/);
  assert.match(proxy, /\.well-known\/workflow\//);
  assert.ok(
    tsconfig.compilerOptions.plugins.some((plugin) => plugin.name === "workflow"),
  );
});

test("Stage 3 migration creates a versioned runtime workflow and atomic launch reservation", async () => {
  const migration = await readProjectFile(
    "supabase/migrations/20260929033000_stage3_vercel_workflow_runtime.sql",
  );

  assert.match(migration, /synthetic\.core\.runtime-proof/);
  for (const stage of ["start", "worker-task", "wait", "review", "complete"]) {
    assert.match(migration, new RegExp(`\\"key\\":\\"${stage}\\"`));
  }
  assert.match(migration, /runtime_run_id text/);
  assert.match(migration, /unique index workflow_runs_runtime_run_id_idx/);
  assert.match(migration, /begin_synthetic_workflow_run/);
  assert.match(migration, /on conflict \(business_id, idempotency_key\) do nothing/);
  assert.match(migration, /stage3_claim_synthetic_worker_attempt/);
  assert.match(migration, /grant execute[^;]+to service_role/s);
  assert.doesNotMatch(migration, /etsy|printful|shopify/i);
});

test("Synthetic runtime proves workflow, step, wait, retry and human resume boundaries", async () => {
  const workflow = await readProjectFile("src/workflows/synthetic-runtime.ts");
  const steps = await readProjectFile("src/workflows/synthetic-runtime-steps.ts");
  const actions = await readProjectFile("src/app/dashboard/actions.ts");
  const registry = await readProjectFile("src/workflows/registry.ts");

  assert.match(workflow, /"use workflow"/);
  assert.match(workflow, /sleep\("5s"\)/);
  assert.match(workflow, /createHook<SyntheticReviewDecision>/);
  assert.match(workflow, /FatalError/);
  assert.match(steps, /"use step"/);
  assert.match(steps, /RetryableError/);
  assert.match(steps, /retryAfter: "1s"/);
  assert.match(steps, /workflow\.stage\.completed/);
  assert.match(steps, /workflow\.owner_intervention\.requested/);
  assert.match(actions, /start\(registered\.workflow/);
  assert.match(actions, /resumeHook/);
  assert.match(actions, /begin_synthetic_workflow_run/);
  assert.match(actions, /region: "syd1"/);
  assert.match(registry, /WORKFLOW_REGISTRY/);
});

test("Stage 3 uses only a server-side Supabase runtime key", async () => {
  const env = await readProjectFile(".env.example");
  const admin = await readProjectFile("src/lib/supabase/admin.ts");
  const publicClient = await readProjectFile("src/lib/supabase/client.ts");

  assert.match(env, /^SUPABASE_SECRET_KEY=/m);
  assert.doesNotMatch(env, /^NEXT_PUBLIC_.*SECRET/m);
  assert.match(admin, /getSupabaseAdminConfig/);
  assert.doesNotMatch(publicClient, /SECRET|SERVICE_ROLE/);
});

test("Stage 3 remains a synthetic runtime proof without worker or model execution", async () => {
  const workflow = await readProjectFile("src/workflows/synthetic-runtime.ts");
  const steps = await readProjectFile("src/workflows/synthetic-runtime-steps.ts");
  const combined = `${workflow}\n${steps}`;

  assert.doesNotMatch(combined, /openai|anthropic|gemini|browserbase|steel/i);
  assert.doesNotMatch(combined, /generateText|streamText|playwright/i);
  assert.match(combined, /synthetic/i);
});
