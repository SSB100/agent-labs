import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToString } from "react-dom/server";
import { fixtureDocument } from "./guided-ui.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
export const sheetOrigin = "https://agentlabs-sheet-lifecycle.test";
export const sheetReturn = "/dashboard?view=work&business=00000000-0000-4000-8000-000000000002";
let documentPromise;
export function sheetLifecycleDocument() {
  return documentPromise ??= build({ absWorkingDir: root, bundle: true, write: false, format: "iife", platform: "browser", target: "es2022", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' }, loader: { ".css": "empty" }, logLevel: "silent", metafile: true,
    stdin: { sourcefile: "sheet-lifecycle.tsx", resolveDir: root, loader: "tsx", contents: `
      import React, {Suspense, startTransition, useEffect, useState} from "react";
      import {hydrateRoot} from "react-dom/client";
      import {ConsoleResearchSheet} from "./src/components/console/console-command";
      const returnTo = ${JSON.stringify(sheetReturn)};
      const sheetUrl = returnTo + "&sheet=research";
      let sequence = 0, waiting, changeRoute;
      window.__sheetErrors = [];
      window.__sheetRequests = [];
      window.__sheetChildActions = 0;
      window.__sheetRouter = { push(url) {
        window.__sheetRequests.push(url);
        let resolve;
        const next = {sheet: url.includes("sheet=research"), url, id: ++sequence, ready: false, promise: new Promise(done => { resolve = done; })};
        waiting = {next, resolve};
        changeRoute(next);
      }};
      function RouteView({route, open}) {
        if (!route.ready) throw route.promise;
        useEffect(() => { history.replaceState({}, "", route.url); window.__sheetCommitted = route.id; }, [route]);
        return <main><h1>Scoped saved work</h1><button id="open-research" onClick={open}>Plan research</button>
          {route.sheet ? <ConsoleResearchSheet returnTo={returnTo}><p>Existing bounded research setup. No action is connected in this fixture.</p><label>Draft goal<input aria-label="Draft goal" defaultValue="Saved draft survives an interrupted close"/></label><button id="fixture-review-goal" onClick={() => { window.__sheetChildActions += 1; }}>Review draft</button></ConsoleResearchSheet> : null}
        </main>;
      }
      function Harness() {
        const [route, setRoute] = useState({sheet:false, url:returnTo, id:0, ready:true});
        changeRoute = setRoute;
        function open() { startTransition(() => setRoute({sheet:true, url:sheetUrl, id:++sequence, ready:true})); }
        useEffect(() => {
          window.__sheetFixture = {
            commit() { if (waiting) { waiting.next.ready = true; waiting.resolve(); waiting = null; } },
            interruptWithReopen() { waiting = null; open(); },
            navigateAway() { startTransition(() => setRoute({sheet:false, url:returnTo, id:++sequence, ready:true})); },
          };
        });
        return <Suspense fallback={<p>Loading route</p>}><RouteView route={route} open={open}/></Suspense>;
      }
      hydrateRoot(document.getElementById("sheet-lifecycle-root"), <Harness/>, {onRecoverableError:error => window.__sheetErrors.push(error.message)});
    ` }, plugins: [{ name: "sheet-navigation-only", setup(builder) {
      builder.onResolve({filter:/^next\/navigation$/}, () => ({path:"router",namespace:"sheet-fixture"}));
      builder.onLoad({filter:/.*/,namespace:"sheet-fixture"}, () => ({loader:"js",contents:"export const useRouter = () => window.__sheetRouter;"}));
      builder.onResolve({filter:/^@\//}, args => {
        assert.equal(args.path,"@/lib/core-ui/quest-draft");
        return {path:path.join(root,"src/lib/core-ui/quest-draft.ts")};
      });
    }}],
  }).then(result => {
    const modules = Object.keys(result.metafile.inputs).filter(file => file.startsWith("src/"));
    assert.deepEqual(modules.sort(), ["src/components/console/console-command.css","src/components/console/console-command.tsx","src/lib/core-ui/quest-draft.ts"].sort());
    // Hydration begins with the real Suspense boundary, including React's SSR
    // markers. Plain main markup would force recovery before any modal test.
    const initial = renderToString(React.createElement(React.Suspense, { fallback: React.createElement("p", null, "Loading route") },
      React.createElement("main", null, React.createElement("h1", null, "Scoped saved work"), React.createElement("button", { id: "open-research" }, "Plan research"))));
    const html = fixtureDocument(`<div id="sheet-lifecycle-root">${initial}</div>`);
    return html.replace("</head>",'<link rel="icon" href="data:,"></head>').replace("</body>",`<script>${result.outputFiles[0].text.replace(/<\/script/gi,"<\\/script")}</script></body>`);
  });
}
