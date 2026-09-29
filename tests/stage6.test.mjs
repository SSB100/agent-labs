import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("Stage 6 keeps only the permanent Worker evaluation runtime", () => {
  const packageJson = JSON.parse(read("package.json"));

  assert.equal(packageJson.scripts.build, "npm run quality && next build");
  assert.equal(packageJson.scripts.posttest, undefined);
  assert.equal(existsSync("scripts/stage6-live-qualification.mjs"), false);
  assert.equal(existsSync("src/app/api/stage6/qualification/route.ts"), false);
  assert.equal(existsSync("src/app/dashboard/worker-evaluations/page.tsx"), true);
  assert.equal(existsSync("src/app/dashboard/worker-evaluations/layout.tsx"), true);
  assert.equal(existsSync("docs/checkpoints/STAGE_7_CORE_UI.md"), false);
});

test("Stage 6 migration history is replayable and RLS-protected", () => {
  const migrationNames = readdirSync("supabase/migrations");
  const schema = read(
    "supabase/migrations/20260929120901_stage6_evaluation_schema_consolidation.sql",
  );
  const runtime = read(
    "supabase/migrations/20260929120943_stage6_evaluation_runtime_consolidation.sql",
  );
  const invalidation = read(
    "supabase/migrations/20260929121005_stage6_evaluation_invalidation_and_gate.sql",
  );
  const catalog = read(
    "supabase/migrations/20260929121027_stage6_generic_researcher_evaluation_catalog.sql",
  );

  for (const required of [
    "20260929115518_stage6_worker_evaluation_framework.sql",
    "20260929120153_stage6_qualification_helper_security.sql",
    "20260929120901_stage6_evaluation_schema_consolidation.sql",
    "20260929120943_stage6_evaluation_runtime_consolidation.sql",
    "20260929121005_stage6_evaluation_invalidation_and_gate.sql",
    "20260929121027_stage6_generic_researcher_evaluation_catalog.sql",
  ]) {
    assert.ok(migrationNames.includes(required), `${required} is missing`);
  }

  for (const table of [
    "worker_evaluation_suites",
    "worker_evaluation_cases",
    "worker_evaluations",
    "worker_evaluation_case_results",
    "worker_promotions",
  ]) {
    assert.match(schema, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(schema, new RegExp(`alter table public\\.${table} enable row level security`));
  }

  assert.match(runtime, /stage6_worker_fingerprint/);
  assert.match(runtime, /stage6_worker_is_currently_qualified/);
  assert.match(runtime, /begin_worker_evaluation/);
  assert.match(runtime, /stage6_record_worker_evaluation_case/);
  assert.match(runtime, /stage6_complete_worker_evaluation/);
  assert.match(runtime, /minimum_score/);
  assert.match(runtime, /required_failure_count = 0/);
  assert.match(runtime, /'qualified'/);

  assert.match(invalidation, /stage6_model_definition_changed/);
  assert.match(invalidation, /stage6_model_route_changed/);
  assert.match(invalidation, /stage6_model_qualification_changed/);
  assert.match(invalidation, /stage6_task_contract_requires_qualified_worker/);
  assert.match(invalidation, /requires reevaluation/);

  assert.match(catalog, /minimum_score[\s\S]*100/);
  assert.match(catalog, /'primary'/);
  assert.match(catalog, /'fallback'/);
  assert.equal((catalog.match(/\n      '[a-z]+\.[a-z0-9.-]+',/g) ?? []).length, 11);
});

test("Stage 6 suite covers schema, role, capability and both live model targets", () => {
  const suite = read("src/evaluations/generic-researcher-suite.ts");
  const runner = read("src/evaluations/runner.ts");
  const template = read("src/app/dashboard/template.tsx");

  for (const category of [
    "schema",
    "role_boundary",
    "capability",
    "positive_example",
    "negative_example",
  ]) {
    assert.match(suite, new RegExp(`category: \"${category}\"`));
  }

  assert.match(suite, /minimumScore: 100/);
  assert.match(suite, /requireAllRequired: true/);
  assert.match(suite, /modelTarget: "primary"/);
  assert.match(suite, /modelTarget: "fallback"/);
  assert.match(suite, /browser\.interact/);
  assert.match(suite, /money\.spend/);
  assert.match(suite, /STAGE6_STRATEGY_TRAP/);
  assert.match(suite, /STAGE6_HIDDEN_CONTEXT_TRAP/);

  assert.match(runner, /MockCapabilityHarness/);
  assert.match(runner, /validateWorkerEvaluationSuite/);
  assert.match(runner, /scoreWorkerEvaluationResults/);
  assert.match(runner, /uncoveredPositive/);
  assert.match(runner, /uncoveredNegative/);
  assert.match(template, /\/dashboard\/worker-evaluations/);
});

test("one failed required case blocks qualification in the executable regression suite", () => {
  const executableTests = read("tests/worker-evaluation.test.mjs");

  assert.match(executableTests, /one failed required adversarial case blocks qualification/);
  assert.match(executableTests, /requiredFailureCount, 1/);
  assert.match(executableTests, /summary\.status, "failed"/);
  assert.match(executableTests, /summary\.score < 100/);
});
