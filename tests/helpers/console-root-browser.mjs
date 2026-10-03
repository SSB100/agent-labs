import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToString } from "react-dom/server";
import { build } from "esbuild";
import { business, findFixtureElement, fixtureDocument, fixtureTime, renderDashboard, run, workflowCollection } from "./guided-ui.mjs";
import { contract, id } from "./console-browser-fixtures.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
export const rootBrowserOrigin = "https://agentlabs-root-browser.test";
export const rootBrowserBusinesses = [{ ...business, id: id(2), name: "Synthetic Browser Studio" }, { ...business, id: id(5), name: "Second Authorized Studio" }];
export const rootBrowserStart = contract.consoleBrowserHref("overview", id(2), run.id);
export const rootBrowserMode = contract.consoleBrowserHref("browser", id(2), run.id);
const scopedRun = { ...run, business_id: id(2) };
const session = { id: id(1), business_id: id(2), workflow_run_id: run.id, status: "live", updated_at: fixtureTime,
  provider_session_id: "PRIVATE_SYNTHETIC_SESSION_VALUE", current_url: "https://private-fixture.invalid/account", page_title: "PRIVATE_SYNTHETIC_PAGE_TITLE", metadata: { private: "PRIVATE_SYNTHETIC_METADATA" } };

export async function rootBrowserPage(route, { unavailable = false } = {}) {
  const query = Object.fromEntries(new URL(route, rootBrowserOrigin).searchParams), reads = [];
  let tree;
  const collection = workflowCollection({ runs: [scopedRun], interventions: [], events: [] });
  const markup = await renderDashboard({ records: collection, contextOverrides: { businesses: rootBrowserBusinesses, needsYouCount: 0 },
    view: query.view ?? "overview", detail: query.view === "work" && Boolean(query.run), sheet: query.sheet === "research", queryOverrides: query,
    browserRecords: { sessions: [session], runs: [scopedRun], ...(unavailable ? { failTable: "browser_sessions" } : {}) }, reads, inspect: value => { tree = value; } });
  const boundary = findFixtureElement(tree, "ConsoleMotionBoundary"), overview = findFixtureElement(tree, "ConsoleOverview"), sheet = findFixtureElement(tree, "ConsoleResearchSheet");
  const { ownerId, scopeKey, snapshot } = boundary.props;
  return { tree, markup, boundary, overview, sheet, reads, state: { boundary: { ownerId, scopeKey, snapshot }, overview: overview?.props ?? null,
    command: tree.props.commandBar.props, sheet: sheet ? { returnTo: sheet.props.returnTo, quest: sheet.props.children.props } : null } };
}

function renderContent(React, modules, state) {
  return React.createElement(modules.ConsoleMotionBoundary, state.boundary,
    React.createElement(modules.ConsoleOverview, state.overview),
    state.sheet ? React.createElement(modules.ConsoleResearchSheet, { returnTo: state.sheet.returnTo }, React.createElement(modules.QuestKickoff, state.sheet.quest)) : null);
}

let bundle;
async function browserBundle() {
  if (!bundle) bundle = build({ absWorkingDir: root, bundle: true, write: false, format: "iife", platform: "browser", target: "es2022", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' }, loader: { ".css": "empty" }, logLevel: "silent", metafile: true,
    stdin: { sourcefile: "root-browser-integration.tsx", resolveDir: root, loader: "tsx", contents: `
      import React, {useEffect} from "react";
      import {hydrateRoot} from "react-dom/client";
      import {ConsoleMotionBoundary} from "./src/components/console/console-motion";
      import {ConsoleOverview} from "./src/components/console/console-overview";
      import {ConsoleCommandBar, ConsoleResearchSheet} from "./src/components/console/console-command";
      import {QuestKickoff} from "./src/components/guided/quest-kickoff";
      const state = window.__rootBrowserState, renderContent = ${renderContent.toString()};
      window.__rootBrowserErrors = [];
      window.__rootBrowserRouter = {push: url => location.assign(url)};
      const options = {onRecoverableError: error => window.__rootBrowserErrors.push(error.message)};
      function Ready({children}) { useEffect(() => { window.__rootBrowserHydrated = true; }, []); return children; }
      if (state.overview) hydrateRoot(document.getElementById("root-browser-content"),
        <Ready>{renderContent(React, {ConsoleMotionBoundary, ConsoleOverview, ConsoleResearchSheet, QuestKickoff}, state)}</Ready>, options);
      hydrateRoot(document.querySelector(".consoleCommandBar"), <ConsoleCommandBar {...state.command}/>, options);
      if (!state.overview) window.__rootBrowserHydrated = true;
    ` }, plugins: [{ name: "root-browser-safe-boundaries", setup(builder) {
      builder.onResolve({ filter: /^next\/(link|navigation)$/ }, args => ({ path: args.path, namespace: "root-browser-boundary" }));
      builder.onResolve({ filter: /^@\/app\/dashboard\/products\/discovery-actions$/ }, () => ({ path: "paid-action", namespace: "root-browser-boundary" }));
      builder.onLoad({ filter: /.*/, namespace: "root-browser-boundary" }, args => ({ loader: "js", resolveDir: root, contents:
        args.path === "next/link" ? 'import React from "react"; export default function Link({children,...props}) { delete props.prefetch; return React.createElement("a",props,children); }'
          : args.path === "next/navigation" ? 'export const useRouter = () => window.__rootBrowserRouter;'
            : 'export async function startGeographicDiscovery() { sessionStorage.setItem("root-browser-paid-call", "forbidden"); throw new Error("Paid actions are forbidden in this fixture"); }' }));
      builder.onResolve({ filter: /^@\// }, args => {
        const files = { "@/lib/core-ui/console-motion-dom": "src/lib/core-ui/console-motion-dom.ts", "@/lib/core-ui/workflows": "src/lib/core-ui/workflows.ts", "@/components/stage7/icons": "src/components/stage7/icons.tsx", "@/browser/console-view": "src/browser/console-view.ts", "@/lib/core-ui/quest-draft": "src/lib/core-ui/quest-draft.ts" };
        assert.ok(files[args.path], `Unexpected root Browser import: ${args.path}`); return { path: path.join(root, files[args.path]) };
      });
    } }] }).then(result => {
    const allowed = new Set(['src/lib/core-ui/workspace-navigation.ts',"src/components/console/console-motion.tsx", "src/components/console/console-motion.css", "src/components/console/console-overview.tsx", "src/components/console/console-overview.css", "src/components/console/console-browser-centre.tsx", "src/components/console/console-browser-centre.css", "src/components/console/console-command.tsx", "src/components/console/console-command.css", "src/components/guided/quest-kickoff.tsx", "src/components/guided/quest-kickoff.css", "src/browser/console-view.ts", "src/components/stage7/icons.tsx", "src/lib/core-ui/console-motion-dom.ts", "src/lib/core-ui/console-motion.ts", "src/lib/core-ui/workflows.ts", "src/lib/core-ui/quest-draft.ts", "src/core/quest-intake.ts"]);
    for (const file of Object.keys(result.metafile.inputs).filter(file => file.startsWith("src/"))) assert.ok(allowed.has(file), `Unexpected server/provider input: ${file}`);
    return result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
  });
  return bundle;
}

const documents = new Map();
export async function rootBrowserDocument(route) {
  if (!documents.has(route)) documents.set(route, (async () => {
    const fixture = await rootBrowserPage(route);
    let markup = fixture.markup;
    if (fixture.overview) {
      const island = renderToString(renderContent(React, { ConsoleMotionBoundary: fixture.boundary.type, ConsoleOverview: fixture.overview.type,
        ConsoleResearchSheet: fixture.sheet?.type, QuestKickoff: fixture.sheet?.props.children.type }, fixture.state));
      const shell = React.cloneElement(fixture.tree, {}, React.createElement("div", { id: "root-browser-content", style: { display: "contents" } }));
      markup = renderToString(shell).replace('<div id="root-browser-content" style="display:contents"></div>', `<div id="root-browser-content" style="display:contents">${island}</div>`);
    }
    return fixtureDocument(markup, { products: true }).replace("</head>", '<link rel="icon" href="data:,"></head>').replace("</body>", `<script>window.__rootBrowserState=${JSON.stringify(fixture.state).replace(/</g, "\\u003c")};</script><script>${await browserBundle()}</script></body>`);
  })());
  return documents.get(route);
}
