import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToString } from "react-dom/server";
import { loadSource } from "./guided-ui.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
export const questFixtureProps = {
  ownerId: "quest-fixture-owner",
  businesses: [{ id: "quest-fixture-business", name: "North Star Design Studio" }],
  available: true,
  quote: { one: 370395, two: 530914, verifiedAt: "2026-10-02T03:00:00.000Z" },
};
export const questFixtureOrigin = "https://agentlabs-quest.test/";
const failServerAction = () => { throw new Error("Server rendering must never invoke a research action"); };

/** The production TSX and React runtime are bundled; only the paid action is mocked. */
export async function questFixtureDocument() {
  const helper = loadSource("src/lib/core-ui/quest-draft.ts");
  const { QuestKickoff } = loadSource("src/components/guided/quest-kickoff.tsx", {
    "@/app/dashboard/products/discovery-actions": { startGeographicDiscovery: failServerAction },
    "@/lib/core-ui/quest-draft": helper,
    "./quest-kickoff.css": {},
  });
  const markup = renderToString(React.createElement(QuestKickoff, questFixtureProps));
  const result = await build({
    absWorkingDir: root, bundle: true, write: false, format: "iife", platform: "browser", target: "es2022", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' }, loader: { ".css": "empty" }, logLevel: "silent",
    stdin: {
      sourcefile: "quest-hydration-fixture.tsx", resolveDir: root, loader: "tsx",
      contents: `
        import React, { useState } from "react";
        import { hydrateRoot } from "react-dom/client";
        import { QuestKickoff } from "./src/components/guided/quest-kickoff";
        window.__questActions = [];
        window.__questHydrationErrors = [];
        function Harness() {
          const [props, setProps] = useState(${JSON.stringify(questFixtureProps)});
          window.__questUpdate = changes => setProps(prior => ({ ...prior, ...changes }));
          return <QuestKickoff {...props}/>;
        }
        hydrateRoot(document.getElementById("quest-fixture-root"), <Harness/>, {
          onRecoverableError: error => window.__questHydrationErrors.push(error.message)
        });
      `,
    },
    plugins: [{ name: "bounded-research-fixture", setup(builder) {
      builder.onResolve({ filter: /^@\/app\/dashboard\/products\/discovery-actions$/ }, () => ({ path: "mock-research-action", namespace: "quest-fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "quest-fixture" }, () => ({ loader: "js", contents: `
        export async function startGeographicDiscovery(form) {
          window.__questActions.push(Object.fromEntries(form.entries()));
          await new Promise(resolve => { window.__questResolve = resolve; });
        }
      ` }));
      builder.onResolve({ filter: /^@\// }, args => ({ path: path.join(root, "src", `${args.path.slice(2)}.ts`) }));
    } }],
  });
  const script = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
  const css = ["src/app/globals.css", "src/components/guided/quest-kickoff.css"].map(file => readFileSync(path.join(root, file), "utf8")).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Agent Labs synthetic research kickoff</title><style>${css}\nbody{padding:32px 20px}main{max-width:1100px;margin:auto}@media(max-width:700px){body{padding:16px 10px}}</style></head><body><main id="quest-fixture-root">${markup}</main><script>${script}</script></body></html>`;
}
