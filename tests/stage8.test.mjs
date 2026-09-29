import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("Stage 8 stores browser secrets privately and protects owner-visible records with RLS", () => {
  const schema = read(
    "supabase/migrations/20260929194317_stage8_browser_provider_foundation.sql",
  );

  for (const table of [
    "browser_provider_definitions",
    "browser_identities",
    "browser_sessions",
    "browser_session_events",
  ]) {
    assert.match(schema, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(schema, new RegExp(`alter table public\\.${table} enable row level security`));
  }

  assert.match(schema, /create table if not exists private\.browser_session_secrets/);
  assert.match(schema, /revoke all on table private\.browser_session_secrets/);
  assert.match(schema, /browser_sessions_owner_read/);
  assert.match(schema, /browser_session_events_owner_read/);
  assert.match(schema, /browser_identities_owner_read/);
  assert.match(schema, /supabase_realtime/);
  assert.match(schema, /'steel',[\s\S]*'selected'/);
  assert.match(schema, /'browserbase',[\s\S]*'candidate'/);
});

test("Stage 8 runtime covers launch, observation, takeover, return, replay and failure", () => {
  const runtimeMigration = read(
    "supabase/migrations/20260929194440_stage8_browser_workflow_runtime.sql",
  );
  const accessMigration = read(
    "supabase/migrations/20260929194718_stage8_browser_runtime_access_and_replay.sql",
  );
  const optionsFix = read(
    "supabase/migrations/20260929200324_stage8_browser_intervention_options_fix.sql",
  );
  const workflow = read("src/workflows/browser-provider-runtime.ts");
  const steps = read("src/workflows/browser-provider-runtime-steps.ts");

  for (const operation of [
    "runtime_started",
    "session_launched",
    "control_taken",
    "control_returned",
    "automation_verified",
    "session_released",
    "session_failed",
  ]) {
    assert.match(runtimeMigration, new RegExp(`p_operation = '${operation}'`));
  }

  assert.match(runtimeMigration, /browser_takeover/);
  assert.match(runtimeMigration, /browser_return_control/);
  assert.match(runtimeMigration, /browser\.session\.released/);
  assert.match(accessMigration, /stage8_browser_runtime_access/);
  assert.match(accessMigration, /stage8_browser_store_replay/);
  assert.match(accessMigration, /p_interactive and v_control_mode = 'human'/);
  assert.match(accessMigration, /get_browser_session_replay/);
  assert.match(optionsFix, /jsonb_build_array\(new\.options\)/);
  assert.match(optionsFix, /revoke execute on function public\.begin_browser_qualification_run/);

  assert.match(workflow, /createHook<BrowserControlDecision>/);
  assert.match(workflow, /browserTakeoverHookToken/);
  assert.match(workflow, /browserReturnControlHookToken/);
  assert.match(workflow, /sleep\("5s"\)/);
  assert.match(steps, /prepareBrowserQualification/);
  assert.match(steps, /verifyReturnedBrowserControl/);
  assert.match(steps, /stage8_browser_runtime_transition/);
  assert.match(steps, /stage8_browser_runtime_access/);
});

test("Stage 8 exposes the selected provider and Live Browser in the central Workspace", () => {
  const shell = read("src/components/stage7/app-shell.tsx");
  const page = read("src/app/dashboard/browser/page.tsx");
  const workspace = read("src/components/stage7/workflow-workspace.tsx");
  const actions = read("src/app/dashboard/browser/actions.ts");
  const health = read("src/app/api/health/route.ts");

  assert.match(shell, /\/dashboard\/browser/);
  assert.match(shell, /label: "Browser"/);
  assert.match(page, /Steel is selected by default/);
  assert.match(page, /Run browser qualification/);
  assert.match(page, /Browserbase remains replaceable/);
  assert.match(workspace, /Live Browser/);
  assert.match(workspace, /Take Control/);
  assert.match(workspace, /Return Control/);
  assert.match(workspace, /Browser session replay/);
  assert.match(actions, /begin_browser_qualification_run/);
  assert.match(actions, /resumeHook/);
  assert.match(health, /browserProvider/);
});

test("Stage 8 keeps provider credentials out of normal application state", () => {
  const env = read(".env.example");
  const schema = read(
    "supabase/migrations/20260929194317_stage8_browser_provider_foundation.sql",
  );
  const workflowSteps = read("src/workflows/browser-provider-runtime-steps.ts");

  assert.match(env, /STEEL_API_KEY/);
  assert.match(env, /BROWSERBASE_API_KEY/);
  assert.doesNotMatch(env, /NEXT_PUBLIC_STEEL|NEXT_PUBLIC_BROWSERBASE/);
  assert.doesNotMatch(schema, /api_key|apiKey/);
  assert.doesNotMatch(workflowSteps, /process\.env\.STEEL_API_KEY|process\.env\.BROWSERBASE_API_KEY/);
  assert.match(workflowSteps, /createBrowserProviderAdapter/);
});

test("Stage 8 migration history is present and Stage 9 has not started", () => {
  const migrations = readdirSync("supabase/migrations");
  for (const required of [
    "20260929194317_stage8_browser_provider_foundation.sql",
    "20260929194440_stage8_browser_workflow_runtime.sql",
    "20260929194718_stage8_browser_runtime_access_and_replay.sql",
    "20260929195831_stage8_browser_schema_consolidation.sql",
    "20260929200324_stage8_browser_intervention_options_fix.sql",
  ]) {
    assert.ok(migrations.includes(required), `${required} is missing`);
  }

  assert.equal(existsSync("src/browser/planner.ts"), false);
  assert.equal(existsSync("src/workflows/browser-planner-runtime.ts"), false);
  assert.equal(existsSync("docs/checkpoints/STAGE_9_BROWSER_PLANNER.md"), false);
});
