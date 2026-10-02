import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToString } from "react-dom/server";
import { findFixtureElement, fixtureDocument, loadSource, renderDashboard, run } from "./guided-ui.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
export const businessFlow = {
  origin: "https://agentlabs-business.test", businessId: "00000000-0000-4000-8000-000000000911", name: "Other authorized Business",
  work: `/dashboard?view=work&run=${run.id}`,
  library: "/dashboard?view=library&business=00000000-0000-4000-8000-000000000911",
  connections: "/dashboard?view=connections&business=00000000-0000-4000-8000-000000000911",
  sheet: "/dashboard?view=connections&business=00000000-0000-4000-8000-000000000911&sheet=research",
};
let bundle;
async function hydrationBundle() {
  if (!bundle) bundle = build({
    absWorkingDir: root, bundle: true, write: false, format: "iife", platform: "browser", target: "es2022", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' }, loader: { ".css": "empty" }, logLevel: "silent",
    stdin: { sourcefile: "business-scope-hydration.tsx", resolveDir: root, loader: "tsx", contents: `
      import React from "react";
      import { hydrateRoot } from "react-dom/client";
      import { ConsoleCommandBar, ConsoleResearchSheet } from "./src/components/console/console-command";
      import { QuestKickoff } from "./src/components/guided/quest-kickoff";
      const state = window.__businessFixtureProps;
      window.__businessHydrationErrors = [];
      window.__businessRouter = { push(url) { location.assign(url); } };
      const options = { onRecoverableError: error => window.__businessHydrationErrors.push(error.message) };
      hydrateRoot(document.querySelector(".consoleCommandBar"), <ConsoleCommandBar {...state.command}/>, options);
      if (state.sheet) hydrateRoot(document.getElementById("business-research-island"),
        <ConsoleResearchSheet returnTo={state.sheet.returnTo}><QuestKickoff {...state.sheet.quest}/></ConsoleResearchSheet>, options);
      window.__businessHydrated = true;
    ` },
    plugins: [{ name: "business-scoped-boundaries", setup(builder) {
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "business-boundary" }));
      builder.onResolve({ filter: /^@\/app\/dashboard\/products\/discovery-actions$/ }, () => ({ path: "paid-action", namespace: "business-boundary" }));
      builder.onLoad({ filter: /.*/, namespace: "business-boundary" }, args => ({ loader: "js", contents: args.path === "navigation"
        ? 'export const useRouter = () => window.__businessRouter;'
        : 'export async function startGeographicDiscovery() { sessionStorage.setItem("fixture-paid-call", "forbidden"); throw new Error("No paid action is permitted"); }' }));
      builder.onResolve({ filter: /^@\// }, args => ({ path: path.join(root, "src", `${args.path.slice(2)}.ts`) }));
    } }],
  }).then(result => result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script"));
  return bundle;
}

export async function businessFixtureDocument(view, { detail = false, sheet = false, omitBusinessQuery = false } = {}) {
  let tree;
  let markup = await renderDashboard({ view, detail, sheet, omitBusinessQuery, businessFlow: true, inspect: value => { tree = value; } });
  const command = tree.props.commandBar.props;
  assert.equal(command.businessId, businessFlow.businessId, "Use the real root page's chosen command Business");
  const state = { command };
  if (sheet) {
    const child = findFixtureElement(tree, "ConsoleResearchSheet");
    assert.ok(child, "The real root must render the research sheet");
    state.sheet = { returnTo: child.props.returnTo, quest: child.props.children.props };
    assert.deepEqual(Array.from(state.sheet.quest.businesses, item => item.id), [businessFlow.businessId]);
    const noAction = () => { throw new Error("Server fixture actions cannot execute"); };
    const draft = loadSource("src/lib/core-ui/quest-draft.ts");
    const { ConsoleResearchSheet } = loadSource("src/components/console/console-command.tsx", {
      "next/navigation": { useRouter: () => ({ push: noAction }) }, "@/lib/core-ui/quest-draft": draft, "./console-command.css": {},
    });
    const { QuestKickoff } = loadSource("src/components/guided/quest-kickoff.tsx", {
      "@/app/dashboard/products/discovery-actions": { startGeographicDiscovery: noAction }, "@/lib/core-ui/quest-draft": draft, "./quest-kickoff.css": {},
    });
    // A hydration island uses the exact props selected by DashboardPage. Its
    // independent SSR id sequence matches its independent hydrateRoot call.
    const dialog = renderToString(React.createElement(ConsoleResearchSheet, { returnTo: state.sheet.returnTo }, React.createElement(QuestKickoff, state.sheet.quest)));
    markup = markup.replace(/<dialog class="consoleResearchSheet"[\s\S]*?<\/dialog>/, `<div id="business-research-island">${dialog}</div>`);
  }
  const html = fixtureDocument(markup, { products: true });
  const script = await hydrationBundle();
  return { html: html.replace("</body>", `<script>window.__businessFixtureProps=${JSON.stringify(state).replace(/</g, "\\u003c")};</script><script>${script}</script></body>`), command, markup };
}
