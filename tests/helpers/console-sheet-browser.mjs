import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToString } from "react-dom/server";
import { loadSource } from "./guided-ui.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
export const consoleSheetFixtureOrigin = "https://agentlabs-console-sheet.test";
export const consoleSheetFixture = {
  ownerId: "console-sheet-fixture-owner",
  businessId: "00000000-0000-4000-8000-000000000901",
  runId: "00000000-0000-4000-8000-000000000902",
  returnTo: "/dashboard?view=work&business=00000000-0000-4000-8000-000000000901&run=00000000-0000-4000-8000-000000000902",
  businesses: [{ id: "00000000-0000-4000-8000-000000000901", name: "North Star Design Studio" }],
  available: true,
  quote: { one: 370395, two: 530914, verifiedAt: "2026-10-02T03:00:00.000Z" },
};
export const consoleSheetOpenPath = `${consoleSheetFixture.returnTo}&sheet=research`;
export const consoleSheetStorageKey = `agentlabs:research-draft:v1:${consoleSheetFixture.ownerId}`;

// The same element tree is used for SSR and hydration. Only its surrounding
// saved-work context is synthetic; the command, dialog and wizard are real TSX.
function renderFixture(React, components, route, fixture) {
  const { ConsoleCommandBar, ConsoleResearchSheet, QuestKickoff } = components;
  const open = new URL(route, "https://agentlabs-console-sheet.test").searchParams.get("sheet") === "research";
  return React.createElement("main", { className: "consoleSheetFixture" },
    React.createElement("section", { className: "consoleSheetFixtureWork", "aria-label": "Selected saved work" },
      React.createElement("h1", null, "Market research"),
      React.createElement("p", null, "North Star Design Studio · Saved evidence awaiting review"),
      React.createElement("button", { type: "button", id: "console-sheet-background" }, "Inspect saved result"),
    ),
    React.createElement("div", { className: "consoleSheetFixtureCommand" },
      React.createElement(ConsoleCommandBar, { ownerId: fixture.ownerId, businessId: fixture.businessId, returnTo: fixture.returnTo }),
    ),
    open ? React.createElement(ConsoleResearchSheet, { returnTo: fixture.returnTo },
      React.createElement(QuestKickoff, { ownerId: fixture.ownerId, businesses: fixture.businesses, available: fixture.available, quote: fixture.quote }),
    ) : null,
  );
}

function serverComponents() {
  const noAction = () => { throw new Error("SSR must never navigate or invoke paid research"); };
  const draft = loadSource("src/lib/core-ui/quest-draft.ts");
  return {
    ...loadSource("src/components/console/console-command.tsx", {
      "next/navigation": { useRouter: () => ({ push: noAction }) },
      "@/lib/core-ui/quest-draft": draft,
      "./console-command.css": {},
    }),
    ...loadSource("src/components/guided/quest-kickoff.tsx", {
      "@/app/dashboard/products/discovery-actions": { startGeographicDiscovery: noAction },
      "@/lib/core-ui/quest-draft": draft,
      "./quest-kickoff.css": {},
    }),
  };
}

let bundlePromise;
async function browserBundle() {
  const productionInputs = new Set([
    "src/components/console/console-command.tsx", "src/components/console/console-command.css",
    "src/components/guided/quest-kickoff.tsx", "src/components/guided/quest-kickoff.css",
    "src/lib/core-ui/quest-draft.ts",
    "src/core/quest-intake.ts",
  ]);
  const result = await build({
    absWorkingDir: root, bundle: true, write: false, format: "iife", platform: "browser", target: "es2022", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' }, loader: { ".css": "empty" }, logLevel: "silent", metafile: true,
    stdin: {
      sourcefile: "console-sheet-hydration-fixture.tsx", resolveDir: root, loader: "tsx",
      contents: `
        import React, { useEffect, useState } from "react";
        import { hydrateRoot } from "react-dom/client";
        import { ConsoleCommandBar, ConsoleResearchSheet } from "./src/components/console/console-command";
        import { QuestKickoff } from "./src/components/guided/quest-kickoff";
        const fixture = ${JSON.stringify(consoleSheetFixture)};
        const renderFixture = ${renderFixture.toString()};
        const currentRoute = () => location.pathname + location.search + location.hash;
        window.__consoleActions = [];
        window.__consoleNavigations = [];
        window.__consoleHydrationErrors = [];
        window.__consoleHydrated = false;
        window.__consoleRouter = { push(destination, options) {
          const target = new URL(destination, location.href);
          if (target.origin !== location.origin || target.pathname !== "/dashboard") throw new Error("Unexpected fixture navigation: " + destination);
          window.__consoleNavigations.push({ destination, options });
          history.pushState({}, "", destination);
          dispatchEvent(new PopStateEvent("popstate"));
        } };
        function Harness() {
          const [route, setRoute] = useState(currentRoute);
          useEffect(() => {
            const updateRoute = () => setRoute(currentRoute());
            addEventListener("popstate", updateRoute);
            window.__consoleHydrated = true;
            return () => removeEventListener("popstate", updateRoute);
          }, []);
          return renderFixture(React, { ConsoleCommandBar, ConsoleResearchSheet, QuestKickoff }, route, fixture);
        }
        hydrateRoot(document.getElementById("console-sheet-fixture-root"), <Harness/>, {
          onRecoverableError: error => window.__consoleHydrationErrors.push(error.message)
        });
      `,
    },
    plugins: [{ name: "console-sheet-boundaries", setup(builder) {
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "console-sheet-fixture" }));
      builder.onResolve({ filter: /^@\/app\/dashboard\/products\/discovery-actions$/ }, () => ({ path: "paid-action", namespace: "console-sheet-fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "console-sheet-fixture" }, args => ({ loader: "js", contents: args.path === "navigation"
        ? "export function useRouter() { return window.__consoleRouter; }"
        : `export async function startGeographicDiscovery(form) {
            window.__consoleActions.push(Object.fromEntries(form.entries()));
            throw new Error("The console sheet must not start paid research during lifecycle tests");
          }`,
      }));
      builder.onResolve({ filter: /^@\// }, args => {
        assert.equal(args.path, "@/lib/core-ui/quest-draft", `Unexpected application import: ${args.path}`);
        return { path: path.join(root, "src/lib/core-ui/quest-draft.ts") };
      });
      builder.onResolve({ filter: /.*/ }, args => {
        if (!args.importer.startsWith(path.join(root, "src") + path.sep)) return;
        assert.ok(["react", "react-dom", "react/jsx-runtime", "./console-command.css", "./quest-kickoff.css", "../../core/quest-intake"].includes(args.path), `Unexpected application dependency: ${args.path}`);
      });
    } }],
  });
  const bundledSource = Object.keys(result.metafile.inputs).filter(file => file.startsWith("src/"));
  for (const file of bundledSource) assert.ok(productionInputs.has(file), `Unexpected bundled application module: ${file}`);
  for (const file of [...productionInputs].filter(file => !file.endsWith(".css"))) assert.ok(bundledSource.includes(file), `Production component missing from fixture: ${file}`);
  return result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
}

export async function consoleSheetFixtureDocument({ open = false } = {}) {
  const components = serverComponents();
  function Harness() { return renderFixture(React, components, open ? consoleSheetOpenPath : consoleSheetFixture.returnTo, consoleSheetFixture); }
  const markup = renderToString(React.createElement(Harness));
  const script = await (bundlePromise ??= browserBundle());
  const css = [
    "src/app/globals.css", "src/app/stage1.css", "src/app/stage3.css", "src/app/stage7.css", "src/app/stage7-mobile.css", "src/app/stage8.css",
    "src/components/guided/work-context.css", "src/components/guided/quest-kickoff.css", "src/components/console/console-command.css",
  ].map(file => readFileSync(path.join(root, file), "utf8")).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Agent Labs synthetic console sheet</title><style>${css}
    .consoleSheetFixture{min-height:100dvh;padding:24px;display:flex;flex-direction:column;gap:24px}
    .consoleSheetFixtureWork{flex:1;min-width:0}.consoleSheetFixtureWork h1{font-size:24px;line-height:1.3;letter-spacing:0}.consoleSheetFixtureWork p{color:#abc4d2;font-size:14px}
    .consoleSheetFixtureWork>button{border:1px solid #326378;border-radius:4px;background:#0a1f2e;color:#d8edf6;min-height:44px;padding:8px 12px}
    .consoleSheetFixtureCommand{padding:12px;border:1px solid #244454;border-radius:6px;background:#0a1f2e;min-width:0}
    @media(max-width:800px){.consoleSheetFixture{padding:8px}.consoleSheetFixtureCommand{padding:8px}}
    </style></head><body><div id="console-sheet-fixture-root">${markup}</div><script>${script}</script></body></html>`;
}
