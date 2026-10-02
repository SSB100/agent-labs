import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToString } from "react-dom/server";
import { business, run, stages, workflowCollection, loadSource } from "./guided-ui.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
export const consoleMotionFixtureOrigin = "https://agentlabs-console-motion.test";
const base = Date.parse("2026-10-02T03:00:00Z");
const iso = offset => new Date(base + offset).toISOString();
const activeRun = { ...run, status: "running", current_stage_key: "work", started_at: iso(1000), updated_at: iso(1000) };
const stage = { ...stages[1], id: "motion-stage", stage_key: "work", status: "running", started_at: iso(1000), completed_at: null, updated_at: iso(1000) };
const task = { id: "motion-task", workflow_run_id: run.id, business_id: business.id, worker_definition_id: "motion-definition", workflow_stage_run_id: stage.id, status: "running", updated_at: iso(1000) };
const worker = { id: "motion-worker", workflow_run_id: run.id, business_id: business.id, task_contract_id: task.id, worker_definition_id: task.worker_definition_id, status: "running", started_at: iso(1000), completed_at: null, updated_at: iso(1000) };
const output = { id: "motion-output", business_id: business.id, workflow_run_id: run.id, created_at: iso(2000), updated_at: iso(2000) };
const decision = { id: "motion-decision", business_id: business.id, workflow_run_id: run.id, status: "open", requested_at: iso(2000), resolved_at: null, updated_at: iso(2000) };
const collection = overrides => workflowCollection({ runs: [activeRun], stages: [stage], tasks: [task], workerRuns: [worker], interventions: [], ...overrides });
const motion = loadSource("src/lib/core-ui/console-motion.ts", { "./workflows": loadSource("src/lib/core-ui/workflows.ts") });
const snapshot = (offset, overrides = {}) => motion.deriveConsoleMotionSnapshot(collection(overrides), { businessIds: [business.id], observedAt: base + offset });
export const consoleMotionFixtures = {
  empty: snapshot(0, { runs: [], stages: [], tasks: [], workerRuns: [] }),
  running: snapshot(1500),
  saved: snapshot(2500, { artifacts: [output], interventions: [decision] }),
  completed: snapshot(3500, { runs: [{ ...activeRun, status: "completed", completed_at: iso(3000), updated_at: iso(3000) }], stages: [{ ...stage, status: "completed", completed_at: iso(3000), updated_at: iso(3000) }], workerRuns: [{ ...worker, status: "completed", completed_at: iso(3000), updated_at: iso(3000) }], artifacts: [output] }),
  failed: snapshot(3500, { runs: [{ ...activeRun, status: "failed", completed_at: iso(3000), updated_at: iso(3000) }] }),
  stopped: snapshot(3500, { runs: [{ ...activeRun, status: "needs_owner", completed_at: iso(3000), updated_at: iso(3000) }], interventions: [decision] }),
  unavailable: snapshot(3500, { errors: ["Synthetic read unavailable"] }),
};

function renderFixture(React, ConsoleMotionBoundary, snapshot, generation, ownerId, scopeKey) {
  const h = React.createElement;
  return h("main", { className: "motionFixture", "data-fixture-generation": generation, "data-fixture-owner": ownerId },
    h("h1", null, "Persisted workflow motion"),
    h("p", null, "Read-only synthetic receipts. No execution or provider connection."),
    h(ConsoleMotionBoundary, { key: generation, ownerId, scopeKey, snapshot },
      h("section", { "data-console-motion-target": "core", className: "motionFixtureCard" }, h("span", { "data-console-motion-mark": true, "aria-hidden": true }, "◉"), h("strong", null, "Workspace core")),
      ...snapshot.entities.map(entity => h("article", { key: entity.target + entity.id, "data-console-motion-target": entity.target, "data-console-motion-id": entity.id, className: "motionFixtureCard" },
        h("span", { "data-console-motion-mark": true, "aria-hidden": true }, entity.state === "completed" ? "✓" : entity.state === "attention" ? "!" : "●"),
        h("strong", null, entity.target), h("span", { "data-fixture-label": true }, entity.state),
      )),
    ),
  );
}

let bundlePromise;
async function browserBundle() {
  const sourceFiles = new Set(["src/components/console/console-motion.tsx", "src/components/console/console-motion.css", "src/lib/core-ui/console-motion.ts", "src/lib/core-ui/console-motion-dom.ts", "src/lib/core-ui/workflows.ts"]);
  const result = await build({
    absWorkingDir: root, bundle: true, write: false, format: "iife", platform: "browser", target: "es2022", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' }, loader: { ".css": "empty" }, logLevel: "silent", metafile: true,
    stdin: { sourcefile: "console-motion-hydration-fixture.tsx", resolveDir: root, loader: "tsx", contents: `
      import React, { useEffect, useState } from "react";
      import { hydrateRoot } from "react-dom/client";
      import { ConsoleMotionBoundary } from "./src/components/console/console-motion";
      const fixtures = ${JSON.stringify(consoleMotionFixtures)};
      const renderFixture = ${renderFixture.toString()};
      window.__consoleMotionErrors = [];
      function Harness() {
        const [snapshot, setSnapshot] = useState(fixtures.empty);
        const [generation, setGeneration] = useState(0);
        const [ownerId, setOwner] = useState("motion-owner");
        const [scopeKey, setScope] = useState("fixture-all-work");
        useEffect(() => {
          window.__consoleMotionFixture = {
            observe: name => setSnapshot(structuredClone(fixtures[name])),
            poll: () => setSnapshot(current => structuredClone(current)),
            remount: () => setGeneration(current => current + 1),
            changeOwner: () => setOwner("other-owner"),
            changeScope: () => setScope("other-scope"),
          };
          window.__consoleMotionReady = true;
        }, []);
        return renderFixture(React, ConsoleMotionBoundary, snapshot, generation, ownerId, scopeKey);
      }
      hydrateRoot(document.getElementById("console-motion-fixture-root"), <Harness/>, { onRecoverableError: error => window.__consoleMotionErrors.push(error.message) });
    ` },
    plugins: [{ name: "console-motion-boundaries", setup(builder) {
      builder.onResolve({ filter: /^@\// }, args => {
        assert.ok(["@/lib/core-ui/console-motion", "@/lib/core-ui/console-motion-dom"].includes(args.path), `Unexpected application import: ${args.path}`);
        return { path: path.join(root, args.path.replace("@/", "src/") + ".ts") };
      });
      builder.onResolve({ filter: /.*/ }, args => {
        if (!args.importer.startsWith(path.join(root, "src") + path.sep)) return;
        assert.ok(["react", "react/jsx-runtime", "./console-motion.css", "./console-motion", "./workflows"].includes(args.path), `Unexpected application dependency: ${args.path}`);
      });
    } }],
  });
  for (const file of Object.keys(result.metafile.inputs).filter(file => file.startsWith("src/"))) assert.ok(sourceFiles.has(file), `Unexpected production module: ${file}`);
  return result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
}

export async function consoleMotionFixtureDocument() {
  const dom = loadSource("src/lib/core-ui/console-motion-dom.ts", { "./console-motion": motion });
  const { ConsoleMotionBoundary } = loadSource("src/components/console/console-motion.tsx", { "@/lib/core-ui/console-motion-dom": dom, "./console-motion.css": {} });
  const markup = renderToString(renderFixture(React, ConsoleMotionBoundary, consoleMotionFixtures.empty, 0, "motion-owner", "fixture-all-work"));
  const script = await (bundlePromise ??= browserBundle());
  const css = readFileSync(path.join(root, "src/components/console/console-motion.css"), "utf8");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Agent Labs read-only motion fixture</title><link rel="icon" href="data:,"><style>${css}
    *{box-sizing:border-box}body{margin:0;background:#081622;color:#cce5eb;font:14px/1.5 system-ui}.motionFixture{padding:24px;max-width:600px;margin:auto}.motionFixture h1{font-size:22px}.motionFixture>p{color:#9bb6c2}.motionFixtureCard{display:flex;gap:14px;align-items:center;min-height:62px;margin:8px 0;padding:12px;border:1px solid #294252;border-radius:8px;background:#0d2331}.motionFixtureCard>[data-console-motion-mark]{display:grid;place-items:center;flex:0 0 26px;width:26px;height:26px;color:#66d1e2}.motionFixtureCard>[data-fixture-label]{margin-left:auto;color:#a1c1cb}
    </style></head><body><div id="console-motion-fixture-root">${markup}</div><script>${script}</script></body></html>`;
}
