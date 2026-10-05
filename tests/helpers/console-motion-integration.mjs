import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToString } from "react-dom/server";
import { build } from "esbuild";
import { business, definition, findFixtureElement, fixtureDocument, fixtureTime, intervention, renderDashboard, run, stages, workflowCollection } from "./guided-ui.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const base = Date.parse(fixtureTime), iso = offset => new Date(base + offset).toISOString();
export const integratedMotionOrigin = "https://agentlabs-integrated-motion.test";
export const integratedMotionIds = { run: run.id, stage: "00000000-0000-4000-8000-000000009011", task: "00000000-0000-4000-8000-000000009012", worker: "00000000-0000-4000-8000-000000009013", output: "00000000-0000-4000-8000-000000009001", decision: "00000000-0000-4000-8000-000000009002" };
const ids = integratedMotionIds;
const activeRun = { ...run, status: "running", current_stage_key: "worker-task", started_at: iso(1000), updated_at: iso(1000) };
const stage = { ...stages[1], id: ids.stage, status: "running", started_at: iso(1000), completed_at: null, updated_at: iso(1000) };
const task = { id: ids.task, business_id: business.id, workflow_run_id: ids.run, workflow_stage_run_id: ids.stage, worker_definition_id: "00000000-0000-4000-8000-000000009014", status: "running", objective: "Compare saved synthetic evidence", created_at: iso(1000), updated_at: iso(1000) };
const worker = { id: ids.worker, business_id: business.id, workflow_run_id: ids.run, task_contract_id: ids.task, worker_definition_id: task.worker_definition_id, status: "running", started_at: iso(1000), completed_at: null, created_at: iso(1000), updated_at: iso(1000) };
const output = { id: ids.output, business_id: business.id, workflow_run_id: ids.run, name: "Synthetic saved research evidence", artifact_type: "research.evidence", content: { synthetic: true }, metadata: {}, created_at: iso(2000), updated_at: iso(2000) };
const decision = { ...intervention, id: ids.decision, requested_at: iso(2000), created_at: iso(2000), updated_at: iso(2000) };
const records = overrides => workflowCollection({ runs: [activeRun], definitions: [{ ...definition, stage_definition: { stages: definition.stage_definition.stages.slice(0, 2) } }],
  stages: [stages[0], stage], tasks: [task], workerRuns: [worker], workerDefinitions: [{ id: task.worker_definition_id, name: "Evidence research specialist" }], artifacts: [], interventions: [], events: [], ...overrides });
export const integratedMotionRecords = {
  queued: records({ runs: [{ ...activeRun, status: "queued", started_at: null, updated_at: iso(0) }], stages: [{ ...stage, status: "pending", started_at: null, updated_at: iso(0) }], tasks: [{ ...task, status: "pending", updated_at: iso(0) }], workerRuns: [{ ...worker, status: "pending", started_at: null, updated_at: iso(0) }] }),
  running: records(),
  saved: records({ artifacts: [output], interventions: [decision] }),
  completed: records({ runs: [{ ...activeRun, status: "completed", completed_at: iso(3000), updated_at: iso(3000) }], stages: [stages[0], { ...stage, status: "completed", completed_at: iso(3000), updated_at: iso(3000) }], workerRuns: [{ ...worker, status: "completed", completed_at: iso(3000), updated_at: iso(3000) }], artifacts: [output] }),
  failed: records({ runs: [{ ...activeRun, status: "failed", completed_at: iso(3000), updated_at: iso(3000) }] }),
  stopped: records({ runs: [{ ...activeRun, status: "needs_owner", completed_at: iso(3000), updated_at: iso(3000) }], interventions: [decision] }),
  unavailable: records({ errors: ["Synthetic work read unavailable"] }),
  truncated: records({ truncated: true, runCount: 81 }),
  mismatched: records({ workerRuns: [{ ...worker, task_contract_id: "different-task" }] }),
};

export async function integratedMotionPage(name, { view = "overview", detail = false } = {}) {
  const records = structuredClone(integratedMotionRecords[name]);
  assert.ok(records, `Unknown scenario ${name}`);
  const ownedBusiness = { ...business, id: "00000000-0000-4000-8000-000000009003" };
  for (const rows of Object.values(records)) if (Array.isArray(rows)) for (const row of rows) if (row && typeof row === "object" && "business_id" in row) row.business_id = ownedBusiness.id;
  let tree;
  const markup = await renderDashboard({ records, view, detail, omitBusinessQuery: true, observedAt: base + ({ queued: 500, running: 1500, saved: 2500 }[name] ?? 3500),
    contextOverrides: { businesses: [ownedBusiness], needsYouCount: records.interventions.filter(row => row.status === "open").length }, inspect: value => { tree = value; } });
  const boundary = findFixtureElement(tree, "ConsoleMotionBoundary");
  assert.ok(boundary, "Use the actual root page motion boundary");
  return { tree, markup, boundary, overview: findFixtureElement(tree, "ConsoleOverview") };
}

let statesPromise, bundlePromise;
export function integratedMotionStates() {
  return statesPromise ??= Promise.all(Object.keys(integratedMotionRecords).map(async name => {
    const fixture = await integratedMotionPage(name);
    const { ownerId, scopeKey, snapshot } = fixture.boundary.props;
    const boundary = { ownerId, scopeKey, snapshot };
    assert.equal(fixture.overview.props.collection.runs[0].id, ids.run);
    return [name, { boundary, overview: fixture.overview.props }];
  })).then(Object.fromEntries);
}

async function browserBundle() {
  const result = await build({ absWorkingDir: root, bundle: true, write: false, format: "iife", platform: "browser", target: "es2022", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' }, loader: { ".css": "empty" }, logLevel: "silent", metafile: true,
    stdin: { sourcefile: "console-motion-integration.tsx", resolveDir: root, loader: "tsx", contents: `
      import React, {useEffect, useState} from "react";
      import {hydrateRoot} from "react-dom/client";
      import {ConsoleMotionBoundary} from "./src/components/console/console-motion";
      import {ConsoleOverview} from "./src/components/console/console-overview";
      const states = window.__integratedMotionStates;
      window.__integratedMotionErrors = [];
      function Harness() {
        const [name, setName] = useState("queued"), [revision, setRevision] = useState(0), [generation, setGeneration] = useState(0);
        const state = states[name];
        useEffect(() => { window.__integratedMotion = { observe: setName, poll: () => setRevision(n => n + 1), remount: () => setGeneration(n => n + 1) }; }, []);
        useEffect(() => { window.__integratedMotionApplied = name + ":" + revision + ":" + generation; });
        return <ConsoleMotionBoundary key={generation} {...structuredClone(state.boundary)}><ConsoleOverview {...state.overview}/></ConsoleMotionBoundary>;
      }
      hydrateRoot(document.getElementById("integrated-motion-root"), <Harness/>, {onRecoverableError: error => window.__integratedMotionErrors.push(error.message)});
    ` }, plugins: [{ name: "integrated-motion-readonly-boundaries", setup(builder) {
      builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "motion-boundary" }));
      builder.onLoad({ filter: /.*/, namespace: "motion-boundary" }, () => ({ loader: "js", resolveDir: root, contents: 'import React from "react"; export default function Link({children,...props}) { return React.createElement("a",props,children); }' }));
      builder.onResolve({ filter: /^@\// }, args => {
        const files = { "@/lib/core-ui/workspace-navigation":"src/lib/core-ui/workspace-navigation.ts", "@/lib/core-ui/console-motion-dom": "src/lib/core-ui/console-motion-dom.ts", "@/lib/core-ui/workflows": "src/lib/core-ui/workflows.ts", "@/components/stage7/icons": "src/components/stage7/icons.tsx", "@/browser/console-watch-client": "src/browser/console-watch-client.ts", "@/browser/console-view": "src/browser/console-view.ts" };
        assert.ok(files[args.path], `Unexpected application import: ${args.path}`);
        return { path: path.join(root, files[args.path]) };
      });
    } }] });
  const allowed = new Set(['src/lib/core-ui/workspace-navigation.ts',"src/components/console/console-motion.tsx", "src/components/console/console-motion.css", "src/components/console/console-overview.tsx", "src/components/console/console-overview.css", "src/components/console/console-browser-centre.tsx", "src/components/console/console-browser-centre.css", "src/components/console/console-browser-watch.tsx", "src/components/console/console-browser-watch.css", "src/browser/console-watch-client.ts", "src/browser/console-view.ts", "src/components/stage7/icons.tsx", "src/lib/core-ui/console-motion-dom.ts", "src/lib/core-ui/console-motion.ts", "src/lib/core-ui/workflows.ts"]);
  for (const file of Object.keys(result.metafile.inputs).filter(file => file.startsWith("src/"))) assert.ok(allowed.has(file), `Unexpected provider/server module: ${file}`);
  return result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
}

export async function integratedMotionDocument() {
  const states = await integratedMotionStates(), fixture = await integratedMotionPage("queued");
  const island = renderToString(React.createElement(fixture.boundary.type, states.queued.boundary, React.createElement(fixture.overview.type, states.queued.overview)));
  const shell = React.cloneElement(fixture.tree, {}, React.createElement("div", { id: "integrated-motion-root", style: { display: "contents" } }));
  const markup = renderToString(shell).replace('<div id="integrated-motion-root" style="display:contents"></div>', `<div id="integrated-motion-root" style="display:contents">${island}</div>`);
  assert.ok(markup.includes("data-console-motion-boundary"));
  return fixtureDocument(markup).replace("</head>", '<link rel="icon" href="data:,"></head>').replace("</body>", `<script>window.__integratedMotionStates=${JSON.stringify(states).replace(/</g, "\\u003c")};</script><script>${await (bundlePromise ??= browserBundle())}</script></body>`);
}
