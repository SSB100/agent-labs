import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("Stage 7 exposes the complete private Core navigation on desktop and mobile", () => {
  const shell = read("src/components/stage7/app-shell.tsx");
  const mobileStyles = read("src/app/stage7-mobile.css");

  for (const route of [
    "/dashboard",
    "/dashboard/workflows",
    "/dashboard/needs-you",
    "/dashboard/history",
    "/dashboard/accounts",
    "/dashboard/settings",
  ]) {
    assert.match(shell, new RegExp(route.replaceAll("/", "\\/")));
  }

  assert.match(shell, /Dashboard/);
  assert.match(shell, /Workflows/);
  assert.match(shell, /Needs You/);
  assert.match(shell, /History/);
  assert.match(shell, /Accounts/);
  assert.match(shell, /Settings/);
  assert.match(shell, /coreMobileNav/);
  assert.match(shell, /Agent Labs mobile navigation/);
  assert.match(mobileStyles, /@media \(max-width: 920px\)/);
  assert.match(mobileStyles, /overflow-x: auto/);
});

test("Stage 7 workflow screen makes execution understandable", () => {
  const workflowPage = read(
    "src/app/dashboard/workflows/[workflowRunId]/page.tsx",
  );
  const visuals = read("src/components/stage7/workflow-visuals.tsx");
  const workspace = read("src/components/stage7/workflow-workspace.tsx");

  assert.match(workflowPage, /WorkflowTimeline/);
  assert.match(workflowPage, /ExecutionSnapshot/);
  assert.match(workflowPage, /WorkflowWorkspace/);
  assert.match(workflowPage, /ActivityFeed/);
  assert.match(visuals, /Current worker/);
  assert.match(visuals, /Current task/);
  assert.match(visuals, /Current action/);
  assert.match(visuals, /Next step/);
  assert.match(visuals, /Needs your decision/);

  for (const label of ["Live Browser", "Products", "Metrics", "Artifacts"]) {
    assert.match(workspace, new RegExp(label));
  }
});

test("Stage 7 uses Supabase Realtime with an explicit low-frequency fallback", () => {
  const liveRefresh = read("src/components/stage7/live-refresh.tsx");
  const template = read("src/app/dashboard/template.tsx");
  const migration = read(
    "supabase/migrations/20260929125855_stage7_core_ui_realtime_publication.sql",
  );

  assert.match(liveRefresh, /postgres_changes/);
  assert.match(liveRefresh, /router\.refresh/);
  assert.match(liveRefresh, /30_000/);
  assert.doesNotMatch(template, /2_000|setInterval|DashboardLinks/);

  for (const table of [
    "artifacts",
    "businesses",
    "events",
    "owner_interventions",
    "task_contracts",
    "worker_runs",
    "workflow_runs",
    "workflow_stage_runs",
  ]) {
    assert.match(liveRefresh, new RegExp(`\"${table}\"`));
    assert.match(migration, new RegExp(`'${table}'`));
  }

  assert.match(migration, /alter publication supabase_realtime add table/);
});

test("Stage 7 Core surfaces remain intact when later stages extend Accounts and Workspace", () => {
  for (const route of [
    "src/app/dashboard/workflows/page.tsx",
    "src/app/dashboard/workflows/[workflowRunId]/page.tsx",
    "src/app/dashboard/needs-you/page.tsx",
    "src/app/dashboard/history/page.tsx",
    "src/app/dashboard/accounts/page.tsx",
    "src/app/dashboard/settings/page.tsx",
  ]) {
    assert.equal(existsSync(route), true, `${route} is missing`);
  }

  assert.equal(existsSync("src/app/dashboard/browser/page.tsx"), false);

  const accounts = read("src/app/dashboard/accounts/page.tsx");
  assert.match(accounts, /Configured services/);
  assert.match(accounts, /Advanced platform diagnostics/);
  assert.match(accounts, /<BusinessAccountWorkspace data=\{accountWorkspace\}/);
  const businessAccounts = read("src/app/dashboard/accounts/account-workspace.tsx");
  assert.match(businessAccounts, /Business accounts/);
  assert.match(businessAccounts, /Reusable account profile/);
  assert.match(businessAccounts, /Connected account registry/);
  assert.match(accounts, /Etsy/);
  assert.match(accounts, /Print fulfilment/);
  assert.doesNotMatch(accounts, /Social accounts|No Business accounts connected yet/);
});

test("Stage 7 keeps owner decisions visually prominent and safely routed", () => {
  const actions = read("src/app/dashboard/actions.ts");
  const needsYou = read("src/app/dashboard/needs-you/page.tsx");
  const dashboard = read("src/app/dashboard/page.tsx");

  assert.match(actions, /safeReturnPath/);
  assert.match(actions, /\/dashboard\/needs-you/);
  assert.match(actions, /\/dashboard\/workflows\/\$\{intervention\.workflow_run_id\}/);
  assert.match(needsYou, /consoleDecisionHref/);
  assert.match(needsYou, /consoleDecisionNotice/);
  assert.match(needsYou, /redirect/);
  assert.match(dashboard, /<ConsoleCompactDecisions/);
  assert.match(dashboard, /<ConsoleOverview/);
  const consoleOverview = read("src/components/console/console-overview.tsx");
  assert.match(consoleOverview, /Decisions &amp; activity|Decisions & activity/);
  assert.match(consoleOverview, /Recommended next step/);
});
