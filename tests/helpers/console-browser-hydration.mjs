import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToString } from "react-dom/server";
import { contract, id, loadBrowserSource, workspace } from "./console-browser-fixtures.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
export const consoleBrowserOrigin = "https://agentlabs-console-browser.test";
export const consoleBrowserFixture = workspace({ businesses: [{ id: id(2), name: "Fixture studio" }, { id: id(5), name: "Other fixture studio" }] });
export const consoleBrowserStartPath = contract.consoleBrowserHref("overview", id(2), id(3));

function renderFixture(React, components, route, fixture) {
  const { ConsoleOverview } = components;
  const query = new URL(route, "https://agentlabs-console-browser.test").searchParams;
  const mode = query.get("centre") === "browser" ? "browser" : "overview";
  const businessId = query.get("business"), runId = query.get("browserRun");
  const sessions = businessId === fixture.businesses[0].id ? fixture.sessions : [];
  const selectedSession = sessions.find(item => item.workflowRunId === runId) ?? null;
  const data = { ...fixture, selectedBusinessId: businessId, selectedRunId: runId, sessions, selectedSession };
  const overview = ConsoleOverview({ centreMode: mode, browserData: data, context: { displayName: "Fixture Owner", businesses: fixture.businesses, needsYouCount: 0 },
    collection: { runs: [], definitions: [], stages: [], events: [], interventions: [], tasks: [], workerRuns: [], workerDefinitions: [], artifacts: [], errors: [] } });
  const core = overview.props.children[0].props.children.find(child => child.props?.["data-console-panel"] === "core");
  if (!core) throw new Error("Real console core could not be found");
  return React.createElement("main", { className: "consoleOverview consoleBrowserFixture" },
    React.cloneElement(core, { className: `${core.props.className} consoleBrowserFixturePanel`, "data-fixture-mode": mode }));
}

let bundlePromise;
async function browserBundle() {
  const productionInputs = new Set([
    "src/components/console/console-browser-centre.tsx", "src/components/console/console-browser-centre.css",
    "src/browser/console-view.ts",
    "src/components/console/console-overview.tsx", "src/components/console/console-overview.css",
    "src/components/stage7/icons.tsx", "src/lib/core-ui/workflows.ts",
  ]);
  const result = await build({
    absWorkingDir: root, bundle: true, write: false, format: "iife", platform: "browser", target: "es2022", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' }, loader: { ".css": "empty" }, logLevel: "silent", metafile: true,
    stdin: { sourcefile: "console-browser-hydration-fixture.tsx", resolveDir: root, loader: "tsx", contents: `
      import React, { useEffect, useState } from "react";
      import { hydrateRoot } from "react-dom/client";
      import { ConsoleOverview } from "./src/components/console/console-overview";
      const fixture = ${JSON.stringify(consoleBrowserFixture)};
      const renderFixture = ${renderFixture.toString()};
      const currentRoute = () => location.pathname + location.search;
      window.__browserHydrated = false;
      window.__browserHydrationErrors = [];
      window.__browserFetches = [];
      window.fetch = (...args) => { window.__browserFetches.push(args); throw new Error("Metadata-only Browser must not fetch"); };
      window.__browserNavigate = destination => {
        const target = new URL(destination, location.href);
        if (target.origin !== location.origin || target.pathname !== "/dashboard") throw new Error("Unexpected navigation");
        history.pushState({}, "", destination); dispatchEvent(new PopStateEvent("popstate"));
      };
      function Harness() {
        const [route, setRoute] = useState(currentRoute);
        const [data, setData] = useState(fixture);
        useEffect(() => {
          const update = () => setRoute(currentRoute());
          addEventListener("popstate", update);
          window.__browserHydrated = true;
          window.__browserReplaceData = setData;
          return () => removeEventListener("popstate", update);
        }, []);
        return renderFixture(React, { ConsoleOverview }, route, data);
      }
      hydrateRoot(document.getElementById("console-browser-fixture"), <Harness/>, { onRecoverableError: error => window.__browserHydrationErrors.push(error.message) });
    ` },
    plugins: [{ name: "console-browser-boundaries", setup(builder) {
      builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "console-browser-fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "console-browser-fixture" }, () => ({ loader: "jsx", resolveDir: root, contents: `
        import React from "react";
        export default function Link({ href, children, ...props }) {
          delete props.prefetch;
          return <a href={href} {...props} onClick={event => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            if (!href.startsWith("/dashboard?")) return;
            event.preventDefault(); window.__browserNavigate(href);
          }}>{children}</a>;
        }`,
      }));
      builder.onResolve({ filter: /^@\// }, args => {
        const aliases = { "@/browser/console-view": "src/browser/console-view.ts", "@/lib/core-ui/workflows": "src/lib/core-ui/workflows.ts", "@/components/stage7/icons": "src/components/stage7/icons.tsx" };
        assert.ok(Object.hasOwn(aliases, args.path), `Unexpected app import ${args.path}`);
        return { path: path.join(root, aliases[args.path]) };
      });
    } }],
  });
  for (const file of Object.keys(result.metafile.inputs).filter(file => file.startsWith("src/"))) assert.ok(productionInputs.has(file), `Unexpected browser module ${file}`);
  return result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
}

export async function consoleBrowserFixtureDocument(route = consoleBrowserStartPath) {
  const browser = loadBrowserSource("src/components/console/console-browser-centre.tsx", { "@/browser/console-view": contract, "./console-browser-centre.css": {} });
  const overview = loadBrowserSource("src/components/console/console-overview.tsx", {
    "@/components/stage7/icons": loadBrowserSource("src/components/stage7/icons.tsx"),
    "./console-browser-centre": browser,
    "@/lib/core-ui/workflows": loadBrowserSource("src/lib/core-ui/workflows.ts"), "./console-overview.css": {},
  });
  const markup = renderToString(renderFixture(React, { ...browser, ...overview }, route, consoleBrowserFixture));
  const script = await (bundlePromise ??= browserBundle());
  const css = ["src/components/console/console-overview.css", "src/components/console/console-browser-centre.css"].map(file => readFileSync(path.join(root, file), "utf8")).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic centre browser</title><style>
  *{box-sizing:border-box}body{margin:0;background:#07121c;color:#d8e8f2;font:14px system-ui}${css}
  .consoleBrowserFixture{display:block;height:auto;width:auto;margin:40px auto}.consoleBrowserFixturePanel{width:548px;height:318px;margin:auto}
  @media(min-width:901px) and (max-width:1250px){.consoleBrowserFixturePanel{width:432px;height:240px}}
  @media(max-width:900px){.consoleBrowserFixture{margin:12px}.consoleBrowserFixturePanel{width:100%;height:400px}}
  </style></head><body><div id="console-browser-fixture">${markup}</div><script>${script}</script></body></html>`;
}
