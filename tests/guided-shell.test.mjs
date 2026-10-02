import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync("src/components/guided/guided-shell.tsx", "utf8");
const css = readFileSync("src/components/guided/guided-shell.css", "utf8");
const context = {
  userId: "fixture-owner", email: "owner@example.invalid", displayName: "Test Owner", needsYouCount: 2,
  businesses: [{ id: "fixture-business", name: "North Star Studio" }],
};

// Render the production component with explicit read-only presentation doubles.
// Unexpected imports fail rather than reaching auth, providers or the network.
function fixture() {
  const liveCalls = [];
  const dependencies = {
    "react/jsx-runtime": require("react/jsx-runtime"),
    "next/link": ({ children, ...props }) => React.createElement("a", props, children),
    "@/components/stage7/icons": { CoreIcon: ({ name }) => React.createElement("svg", { "aria-hidden": true, "data-icon": name }) },
    "@/components/stage7/live-refresh": { LiveRefresh: props => {
      liveCalls.push(props);
      return React.createElement("span", { className: "liveConnection" }, "Connecting updates");
    } },
    "./guided-shell.css": {},
  };
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const sourceModule = { exports: {} };
  runInNewContext(`(function(require,module,exports){${code}\n})`)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected shell runtime import: ${name}`);
    return dependencies[name];
  }, sourceModule, sourceModule.exports);
  return {
    liveCalls,
    render: (overrides = {}) => renderToStaticMarkup(React.createElement(sourceModule.exports.GuidedShell, {
      active: "dashboard", context, ...overrides,
    }, React.createElement("h1", null, "Fixture page"))),
  };
}

const nav = (markup, className) => {
  const match = markup.match(new RegExp(`<nav class="${className}"[^>]*>(.*?)</nav>`, "s"));
  assert.ok(match, `Missing ${className}`);
  return match[1];
};
const links = markup => [...markup.matchAll(/<a\b([^>]*)>(.*?)<\/a>/gs)].map(([, attributes, content]) => ({
  href: attributes.match(/href="([^"]+)"/)?.[1], current: attributes.includes('aria-current="page"'),
  label: attributes.match(/aria-label="([^"]+)"/)?.[1] ?? content.match(/<span class="guidedNavText">([^<]+)<\/span>/)?.[1],
}));

test("desktop and mobile expose the same five clearly named primary destinations", () => {
  const markup = fixture().render();
  const expected = [
    ["Control centre", "/dashboard"], ["Work", "/dashboard/workflows"], ["Library", "/dashboard/artifacts"],
    ["Decisions", "/dashboard/needs-you"], ["Connections", "/dashboard/accounts"],
  ];
  for (const className of ["guidedPrimaryNavigation", "guidedBottomNavigation"]) {
    assert.deepEqual(links(nav(markup, className)).map(({ label, href }) => [label, href]), expected);
  }
  assert.match(nav(markup, "guidedBottomNavigation"), /aria-label="Connections"[^>]*>[\s\S]*?class="guidedNavText">Connect<\/span>/);
  assert.doesNotMatch(markup, />Home<|Quick Tasks/);
});

test("each primary route has exactly one current destination and Products stays under Work", () => {
  for (const [active, destination] of [
    ["dashboard", "/dashboard"], ["workflows", "/dashboard/workflows"], ["products", "/dashboard/workflows"],
    ["artifacts", "/dashboard/artifacts"], ["needs-you", "/dashboard/needs-you"], ["accounts", "/dashboard/accounts"],
  ]) {
    const markup = fixture().render({ active });
    for (const className of ["guidedPrimaryNavigation", "guidedBottomNavigation"]) {
      assert.deepEqual(links(nav(markup, className)).filter(item => item.current).map(item => item.href), [destination]);
    }
  }
  for (const active of ["history", "packs", "settings"]) {
    assert.deepEqual(links(nav(fixture().render({ active }), "guidedPrimaryNavigation")).filter(item => item.current), []);
  }
});

test("Activity and all advanced destinations remain available on desktop and inside mobile More", () => {
  const markup = fixture().render();
  const destinations = ["/dashboard/history", "/dashboard/packs", "/dashboard/worker-proof", "/dashboard/model-router", "/dashboard/worker-evaluations", "/dashboard/settings"];
  assert.match(markup, /<details class="guidedMore"><summary class="guidedMoreSummary">More/);
  const mobile = markup.slice(markup.indexOf('<details class="guidedMore">'), markup.indexOf('<div class="guidedWorkspaceContext"'));
  for (const href of destinations) {
    assert.equal(markup.split(`href="${href}"`).length - 1, 2, href);
    assert.ok(mobile.includes(`href="${href}"`), href);
  }
  assert.match(mobile, />Activity</);
  assert.match(mobile, />Settings &amp; profile</);
  assert.equal((markup.match(/<details class="guidedAdvanced">/g) ?? []).length, 2);
});

test("advanced pages open their disclosure and mark the real current page", () => {
  for (const active of ["packs", "settings"]) {
    const markup = fixture().render({ active });
    assert.equal((markup.match(/<details class="guidedAdvanced" open="">/g) ?? []).length, 2);
    assert.equal((markup.match(new RegExp(`href="/dashboard/${active}" aria-current="page"`, "g")) ?? []).length, 2);
  }
  const history = fixture().render({ active: "history" });
  assert.equal((history.match(/href="\/dashboard\/history" aria-current="page"/g) ?? []).length, 2);
});

test("the live component mounts once with the original workflow scope and no runtime shell cycle", () => {
  const view = fixture();
  const markup = view.render({ workflowRunId: "workflow-fixture" });
  assert.equal(view.liveCalls.length, 1);
  assert.equal(view.liveCalls[0].workflowRunId, "workflow-fixture");
  assert.equal((markup.match(/class="liveConnection"/g) ?? []).length, 1);
  assert.match(source, /import type \{ CoreSection \}/);
  assert.doesNotMatch(source, /useEffect|usePathname|window\.|document\.|"use client"/);
});

test("decision counts distinguish unavailable, empty and known with accessible full values", () => {
  const unavailable = fixture().render({ context: { ...context, needsYouCount: 12, needsYouUnavailable: true } });
  assert.equal((unavailable.match(/<span aria-hidden="true">\?<\/span>/g) ?? []).length, 2);
  assert.equal((unavailable.match(/class="guidedVisuallyHidden">Decision count unavailable</g) ?? []).length, 2);
  assert.doesNotMatch(unavailable, />12<|12 open decisions/);
  const empty = fixture().render({ context: { ...context, needsYouCount: 0 } });
  assert.doesNotMatch(empty, /guidedDecisionCount/);
  const one = fixture().render({ context: { ...context, needsYouCount: 1 } });
  assert.match(one, />1 open decision</);
  const many = fixture().render({ context: { ...context, needsYouCount: 126 } });
  assert.match(many, />99\+</);
  assert.match(many, />126 open decisions</);
});

test("workspace context accurately distinguishes single, multiple, empty and unavailable businesses", () => {
  const single = fixture().render();
  assert.match(single, /<small>Business<\/small><strong>North Star Studio<\/strong>/);
  const multiple = fixture().render({ context: { ...context, businesses: [...context.businesses, { id: "second-business", name: "Second Studio" }] } });
  assert.match(multiple, /<small>Owner workspace<\/small><strong>All 2 businesses<\/strong>/);
  assert.doesNotMatch(multiple, /North Star Studio|Second Studio/);
  const empty = fixture().render({ context: { ...context, businesses: [] } });
  assert.match(empty, /No business yet/);
  const unavailable = fixture().render({ context: { ...context, businessesUnavailable: true } });
  assert.match(unavailable, /class="guidedWorkspaceContext" role="status"/);
  assert.match(unavailable, /Business records unavailable/);
  assert.doesNotMatch(unavailable, /North Star Studio|No business yet|All 1/);
});

test("owner identity and POST sign-out remain present in both desktop footer and mobile More", () => {
  const markup = fixture().render();
  assert.equal((markup.match(/owner@example\.invalid/g) ?? []).length, 2);
  assert.equal((markup.match(/<strong>Test Owner<\/strong>/g) ?? []).length, 2);
  assert.equal((markup.match(/<form action="\/auth\/signout" method="post">/g) ?? []).length, 2);
  assert.equal((markup.match(/<button class="guidedSignOut" type="submit">Sign out<\/button>/g) ?? []).length, 2);
  const mobile = markup.slice(markup.indexOf('<details class="guidedMore">'), markup.indexOf('<div class="guidedWorkspaceContext"'));
  assert.match(mobile, /owner@example\.invalid/);
  assert.match(mobile, /method="post"/);
});

test("skip navigation reaches one focusable main and untrusted names remain escaped", () => {
  const markup = fixture().render({ context: { ...context, displayName: '<script>alert("owner")</script>' } });
  assert.match(markup, /class="guidedSkipLink" href="#main-content">Skip to content/);
  assert.equal((markup.match(/id="main-content"/g) ?? []).length, 1);
  assert.match(markup, /<main class="guidedMain" id="main-content" tabindex="-1"><h1>Fixture page<\/h1><\/main>/);
  assert.doesNotMatch(markup, /<script>/);
  assert.match(markup, /&lt;script&gt;/);
});

test("layout is scoped, uses five non-scrolling mobile columns and preserves focus and reduced motion", () => {
  assert.match(css, /--guided-sidebar-width: 232px/);
  assert.match(css, /grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(css, /overflow-x: auto|\.coreShell|\.coreSidebar|\.coreMain|radial-gradient|linear-gradient/);
  assert.match(css, /\.guidedSidebar \{ display: none; \}/);
  assert.match(css, /\.guidedMobileBrand, \.guidedMore, \.guidedBottomNavigation \{ display: none; \}/);
  assert.match(css, /\.guidedShell :focus-visible/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /\.guidedSignOut \{[^}]*min-height: 44px/);
  assert.match(css, /\.guidedAdvancedLink \{[^}]*min-height: 44px/);
  assert.match(css, /\.guidedMoreSummary \{[^}]*min-height: 44px/);
});
