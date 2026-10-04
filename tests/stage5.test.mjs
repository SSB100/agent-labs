import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("Stage 5 keeps the canonical application build and removes qualification harnesses", () => {
  const packageJson = JSON.parse(read("package.json"));
  const vercel = JSON.parse(read("vercel.json"));
  const eslint = read("eslint.config.mjs");

  assert.equal(packageJson.scripts.build, "npm run quality && next build");
  assert.equal(packageJson.scripts["qualify:stage5"], undefined);
  assert.equal(vercel.buildCommand, "node -e \"if (process.env.VERCEL_ENV !== 'preview' || process.env.VERCEL_TARGET_ENV !== 'preview') { console.error('R10 diagnostic builds require Preview'); process.exit(1); }\" && npm run deploy:build");
  assert.equal(packageJson.scripts["deploy:build"], "next build");
  assert.doesNotMatch(eslint, /scripts\/\*\*/);

  assert.equal(existsSync("src/app/api/stage5/qualification/route.ts"), false);
  assert.equal(existsSync("scripts/stage5-live-qualification.mjs"), false);
  assert.equal(existsSync("scripts/stage5-preview-env-check.mjs"), false);
  assert.equal(existsSync("scripts/stage5-build-marker.mjs"), false);
});

test("Stage 5 registers the intended logical routes with current OpenRouter IDs", () => {
  const registry = read("src/models/registry.ts");

  assert.match(registry, /openai\/gpt-5\.6-luna/);
  assert.match(registry, /google\/gemini-3\.6-flash/);
  assert.match(registry, /anthropic\/claude-haiku-4\.5/);
  assert.match(registry, /openai\/gpt-5\.6-sol/);
  assert.match(registry, /anthropic\/claude-sonnet-4\.6/);
  assert.match(registry, /"standard\.default"/);
  assert.match(registry, /"reviewer\.independent"/);
  assert.match(registry, /"escalation\.high-power"/);
  assert.match(registry, /"large-context"/);
  assert.doesNotMatch(registry, /gpt-6/);
});

test("Stage 5 retains strict local validation and a provider-safe schema projection", () => {
  const adapter = read("src/models/openrouter.ts");
  const worker = read("src/workers/generic-researcher.ts");

  assert.match(adapter, /projectProviderJsonSchema/);
  assert.match(adapter, /providerSchemaProjected: true/);
  assert.match(adapter, /tool_choice: "required"/);
  assert.match(adapter, /require_parameters: true/);
  assert.match(worker, /format: "uuid"/);
  assert.match(worker, /uniqueItems: true/);
  assert.match(worker, /minimum: 3/);
});

test("Stage 5 migrations preserve the permanent router and remove temporary qualification state", () => {
  const migrationNames = readdirSync("supabase/migrations");
  const terminalFix = read(
    "supabase/migrations/20260929104732_stage5_terminal_transition_fix.sql",
  );
  const cleanup = read(
    "supabase/migrations/20260929105127_stage5_qualification_cleanup.sql",
  );

  for (const required of [
    "20260929074449_stage5_model_router_foundation.sql",
    "20260929074737_stage5_model_router_runtime.sql",
    "20260929081542_stage5_model_schema_consolidation.sql",
    "20260929081624_stage5_model_catalog.sql",
    "20260929081703_stage5_worker_route_contract.sql",
    "20260929081753_stage5_runtime_start_task.sql",
    "20260929081833_stage5_runtime_route_worker.sql",
    "20260929081929_stage5_runtime_invocations.sql",
    "20260929101714_stage5_openrouter_catalog_correction.sql",
    "20260929104732_stage5_terminal_transition_fix.sql",
    "20260929105127_stage5_qualification_cleanup.sql",
  ]) {
    assert.ok(migrationNames.includes(required), `${required} is missing`);
  }

  assert.match(terminalFix, /'workflow\.completed',[\s\S]*?'system',[\s\S]*?null,/);
  assert.match(terminalFix, /stage5_model_runtime_transition_legacy/);
  assert.match(cleanup, /delete from public\.businesses/);
  assert.match(cleanup, /drop function if exists public\.record_stage5_live_model_qualification/);
  assert.match(cleanup, /drop function if exists public\.record_stage5_build_diagnostic/);
  assert.match(cleanup, /drop table if exists private\.stage5_build_diagnostics/);
});
