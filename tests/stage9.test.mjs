import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("Stage 9 keeps the Browser Planner bounded above Playwright", () => {
  const planner = read("src/browser/planner/planner.ts");
  const executor = read("src/browser/planner/executor.ts");
  const observation = read("src/browser/planner/observation.ts");

  assert.match(planner, /one bounded next decision/i);
  assert.match(planner, /Never invent an elementId/);
  assert.match(planner, /standard\.default/);
  assert.doesNotMatch(planner, /playwright-core/);
  assert.doesNotMatch(planner, /locator\(/);
  assert.doesNotMatch(planner, /querySelector/);

  assert.match(executor, /data-agent-labs-element-id/);
  assert.match(executor, /matchCount/);
  assert.match(observation, /visibleText/);
  assert.match(observation, /forms/);
  assert.match(observation, /controls/);
  assert.match(observation, /links/);
  assert.match(observation, /stableIdAttribute/);
  assert.match(observation, /input\.type === "password"/);
});

test("Stage 9 qualification covers every implementation-plan level", () => {
  const runtime = read("src/workflows/browser-planner-runtime.ts");
  const steps = read("src/workflows/browser-planner-runtime-steps.ts");
  const foundation = read(
    "supabase/migrations/20260929230650_stage9_browser_planner_foundation.sql",
  );
  const workflow = read(
    "supabase/migrations/20260929230953_stage9_browser_planner_runtime.sql",
  );

  for (const level of [
    "synthetic",
    "mock-commerce",
    "real-read-only",
    "controlled-draft",
  ]) {
    assert.match(runtime + steps + workflow, new RegExp(level));
  }

  assert.match(steps, /staleFirstTarget: true/);
  assert.match(steps, /MAX_RECOVERIES = 2/);
  assert.match(steps, /MAX_ACTION_STEPS = 5/);
  assert.match(steps, /https:\/\/example\.com\//);
  assert.match(steps, /Do not publish/);
  assert.match(foundation, /selectorsForbidden/);
  assert.match(foundation, /playwrightExcluded/);
  assert.match(workflow, /oneActionPerPlanningStep/);
});

test("Stage 9 planner actions are durable and visible in the Workflow UI", () => {
  const workspace = read("src/components/stage7/workflow-workspace.tsx");
  const eventLabels = read("src/lib/core-ui/workflows.ts");
  const foundation = read(
    "supabase/migrations/20260929230650_stage9_browser_planner_foundation.sql",
  );

  assert.match(workspace, /BrowserPlannerActivity/);
  assert.match(workspace, /browser\.planner\./);
  assert.match(workspace, /One bounded action per planning step/);
  assert.match(eventLabels, /browser\.planner\.action\.planned/);
  assert.match(eventLabels, /Browser Planner chose the next action/);
  assert.match(foundation, /stage9_record_browser_planner_event/);
  assert.match(foundation, /runtime_capability_hash/);
});

test("Stage 9 owner launch stays separate from Stage 8 provider qualification", () => {
  const actions = read("src/app/dashboard/browser-actions.ts");
  const accounts = read("src/app/dashboard/accounts/page.tsx");

  assert.match(actions, /startBrowserQualification/);
  assert.match(actions, /startBrowserPlannerQualification/);
  assert.match(actions, /begin_browser_planner_qualification_run/);
  assert.match(actions, /synthetic\.browser-planner\.qualification/);
  assert.match(accounts, /Stage 9 qualification/);
  assert.match(accounts, /Browser Planner/);
  assert.match(accounts, /Qualify for/);
});

test("Stage 9 does not start the Stage 10 pack framework", () => {
  assert.equal(existsSync("docs/checkpoints/STAGE_10_PACK_FRAMEWORK.md"), false);
  assert.equal(existsSync("src/packs/registry.ts"), false);
  assert.equal(existsSync("src/packs/dependencies.ts"), false);
});
