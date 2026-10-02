import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright-core";
import { business, definition, fixtureDocument, fixtureTime, loadSource, ownerContext, run, stages, workflowCollection } from "./helpers/guided-ui.mjs";

// A stable presentation fixture: real shell, overview and command bar without
// importing DashboardPage, auth, provider loaders or any mutation implementation.
export function consolePreviewMarkup() {
  const icons = loadSource("src/components/stage7/icons.tsx");
  const workflows = loadSource("src/lib/core-ui/workflows.ts");
  const forbidden = () => { throw new Error("The console preview is read-only"); };
  const live = loadSource("src/components/stage7/live-refresh.tsx", {
    "next/navigation": { useRouter: () => ({ refresh: forbidden }) }, "@/lib/supabase/client": { createClient: forbidden },
  });
  const { ConsoleShell } = loadSource("src/components/console/console-shell.tsx", {
    "@/components/stage7/icons": icons, "@/components/stage7/live-refresh": live, "./console-shell.css": {},
  });
  const { ConsoleOverview } = loadSource("src/components/console/console-overview.tsx", {
    "@/components/stage7/icons": icons, "@/lib/core-ui/workflows": workflows, "./console-overview.css": {},
  });
  const { ConsoleCommandBar } = loadSource("src/components/console/console-command.tsx", {
    "next/navigation": { useRouter: () => ({ push: forbidden }) }, "@/lib/core-ui/quest-draft": loadSource("src/lib/core-ui/quest-draft.ts"), "./console-command.css": {},
  });
  const workingRun = { ...run, id: "00000000-0000-4000-8000-000000000903", status: "running", current_stage_key: "worker-task" };
  const stage = { ...stages[1], id: "fixture-active-stage", workflow_run_id: workingRun.id, status: "running", completed_at: null };
  const workerDefinition = { id: "fixture-active-worker", name: "Evidence researcher", worker_key: "fixture.research", version: "1.0.0", status: "qualified" };
  const task = { id: "fixture-active-task", business_id: business.id, workflow_run_id: workingRun.id, workflow_stage_run_id: stage.id,
    worker_definition_id: workerDefinition.id, status: "running", objective: "Compare the saved market observations", updated_at: fixtureTime };
  const worker = { id: "fixture-worker-receipt", business_id: business.id, workflow_run_id: workingRun.id, worker_definition_id: workerDefinition.id,
    task_contract_id: task.id, status: "running", completed_at: null, updated_at: fixtureTime };
  const artifacts = ["Market source pack", "Independent review notes"].map((name, index) => ({ id: `fixture-output-${index}`, business_id: business.id,
    workflow_run_id: run.id, name, artifact_type: "research.evidence", created_at: fixtureTime, updated_at: fixtureTime }));
  const collection = workflowCollection({ runs: [run, workingRun], definitions: [definition], stages: [...stages, stage], tasks: [task], workerRuns: [worker], workerDefinitions: [workerDefinition], artifacts });
  const context = ownerContext();
  const commandBar = React.createElement(ConsoleCommandBar, { ownerId: context.userId, businessId: business.id, returnTo: "/dashboard?view=overview" });
  return renderToStaticMarkup(React.createElement(ConsoleShell, { active: "overview", context, commandBar }, React.createElement(ConsoleOverview, {
    context, collection,
    costs: { status: "ready", recordedMicrousd: 18200, uncertainCount: 0, scopeLabel: "Synthetic selected-run receipts", workflowRunId: run.id },
    connections: { status: "ready", items: [{ id: "fixture-etsy", name: "Etsy", state: "configured", detail: "Saved configuration; execution needs its own approval" }, { id: "fixture-printful", name: "Printful", state: "needs_attention", detail: "Connection verification required" }] },
  })));
}

test("standalone console preview uses deterministic real components and matching worker receipts", () => {
  const markup = consolePreviewMarkup();
  assert.equal(markup, consolePreviewMarkup());
  assert.equal((markup.match(/data-console-panel=/g) ?? []).length, 9);
  assert.match(markup, /data-work-state="working"/);
  assert.match(markup, /1 open decision/);
  assert.doesNotMatch(markup, /CPU|RAM|System optimal|Listening/);
});

const enabled = process.env.GUIDED_UI_BROWSER === "1" || Boolean(process.env.GUIDED_UI_CHROMIUM_PATH);
test("capture the dense console reference layout before the full quality gate", { skip: !enabled, timeout: 90_000 }, async t => {
  const directory = path.resolve("test-results/guided-ui");
  mkdirSync(directory, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.GUIDED_UI_CHROMIUM_PATH ? { executablePath: process.env.GUIDED_UI_CHROMIUM_PATH } : {}) });
  try {
    const html = fixtureDocument(consolePreviewMarkup());
    for (const [width, height] of [[1440, 900], [1280, 900], [1200, 700], [390, 1000], [320, 1000]]) {
      await t.test(`${width}×${height}`, async () => {
        const context = await browser.newContext({ viewport: { width, height }, locale: "en-NZ", timezoneId: "UTC", colorScheme: "dark", reducedMotion: "reduce", serviceWorkers: "block" });
        await context.route("**/*", route => route.abort());
        const page = await context.newPage();
        try {
          await page.setContent(html);
          await page.screenshot({ path: path.join(directory, `console-overview-${width}x${height}.png`), fullPage: true, animations: "disabled" });
          const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight,
            mainHeight: document.querySelector(".consoleMain").clientHeight, mainScrollHeight: document.querySelector(".consoleMain").scrollHeight }));
          assert.ok(dimensions.width <= width + 1, JSON.stringify(dimensions));
          if (width > 760) {
            assert.ok(dimensions.height <= height + 1, JSON.stringify(dimensions));
            assert.ok(dimensions.mainScrollHeight <= dimensions.mainHeight + 2, JSON.stringify(dimensions));
          }
        } finally { await context.close(); }
      });
    }
  } finally { await browser.close(); }
});
