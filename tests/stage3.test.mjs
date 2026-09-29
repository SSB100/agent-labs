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
  const vercelConfig = JSON.parse(await readProjectFile("vercel.json"));

  assert.equal(packageJson.dependencies.workflow, "4.8.9");
  assert.match(nextConfig, /withWorkflow/);
  assert.match(nextConfig, /export default withWorkflow\(nextConfig\)/);
  assert.match(proxy, /\.well-known\/workflow\//);
  assert.ok(
    tsconfig.compilerOptions.plugins.some((plugin) => plugin.name === "workflow"),
  );
  assert.deepEqual(vercelConfig.regions, ["syd1"]);
});

test("Stage 3 migrations create a versioned workflow and scoped runtime capability", async () => {
  const baseMigration = await readProjectFile(
    "supabase/migrations/20260929033000_stage3_vercel_workflow_runtime.sql",
  );
  const capabilityMigration = await readProjectFile(
    "supabase/migrations/20260929034200_stage3_scoped_runtime_capability.sql",
  );

  assert.match(baseMigration, /synthetic\.core\.runtime-proof/);
  for (const stage of ["start", "worker-task", "wait", "review", "complete"]) {
    assert.match(baseMigration, new RegExp(`\\"key\\":\\"${stage}\\"`));
  }
  assert.match(baseMigration, /runtime_run_id text/);
  assert.match(baseMigration, /unique index workflow_runs_runtime_run_id_idx/);
  assert.match(capabilityMigration, /runtime_capability_hash text/);
  assert.match(capabilityMigration, /extensions\.digest/);
  assert.match(capabilityMigration, /stage3_runtime_transition/);
  assert.match(capabilityMigration, /grant execute[^;]+to anon, authenticated/s);
  assert.match(capabilityMigration, /drop function if exists public\.stage3_claim/);
  assert.doesNotMatch(`${baseMigration}\n${capabilityMigration}`, /etsy|printful|shopify/i);
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
  assert.match(steps, /stage3_runtime_transition/);
  assert.match(actions, /start\(registered\.workflow, \[workflowInput\]\)/);
  assert.match(actions, /resumeHook/);
  assert.match(actions, /begin_synthetic_workflow_run/);
  assert.match(actions, /runtimeCapability/);
  assert.match(registry, /WORKFLOW_REGISTRY/);
});

test("Stage 3 uses a one-run capability rather than a broad database secret", async () => {
  const env = await readProjectFile(".env.example");
  const runtime = await readProjectFile("src/lib/supabase/runtime.ts");
  const steps = await readProjectFile("src/workflows/synthetic-runtime-steps.ts");

  assert.doesNotMatch(env, /SECRET|SERVICE_ROLE/);
  assert.match(runtime, /getSupabasePublicConfig/);
  assert.match(steps, /p_runtime_capability: input\.runtimeCapability/);
  assert.doesNotMatch(steps, /service_role|secretKey|createAdminClient/i);
});

test("Stage 3 remains a synthetic runtime proof without worker or model execution", async () => {
  const workflow = await readProjectFile("src/workflows/synthetic-runtime.ts");
  const steps = await readProjectFile("src/workflows/synthetic-runtime-steps.ts");
  const combined = `${workflow}\n${steps}`;

  assert.doesNotMatch(combined, /openai|anthropic|gemini|browserbase|steel/i);
  assert.doesNotMatch(combined, /generateText|streamText|playwright/i);
  assert.match(combined, /synthetic/i);
});
