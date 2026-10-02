import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync("src/components/console/console-shell.tsx", "utf8");
const css = readFileSync("src/components/console/console-shell.css", "utf8");
const owner = {
  userId: "fixture-owner", displayName: "Fixture Owner", email: "owner@example.invalid", needsYouCount: 3,
  businesses: [{ id: "fixture-business", name: "North Star Studio" }],
};

// Exercise the actual server component without auth, data mutation, or network access.
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
    "./console-shell.css": {},
  };
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const sourceModule = { exports: {} };
  runInNewContext(`(function(require,module,exports){${code}\n})`)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected console runtime dependency: ${name}`);
    return dependencies[name];
  }, sourceModule, sourceModule.exports);
  return {
    liveCalls,
    exports: sourceModule.exports,
    render: (overrides = {}) => renderToStaticMarkup(React.createElement(sourceModule.exports.ConsoleShell, {
      active: "overview", context: owner, ...overrides,
    }, React.createElement("h1", null, "Fixture workspace"))),
  };
}

function primaryLinks(markup) {
  const nav = markup.match(/<nav class="consoleNavigation"[^>]*>(.*?)<\/nav>/s);
  assert.ok(nav);
  return [...nav[1].matchAll(/<a\b([^>]*)>(.*?)<\/a>/gs)].map(([, attributes, content]) => ({
    href: attributes.match(/href="([^"]+)"/)?.[1],
    current: attributes.includes('aria-current="page"'),
    label: attributes.match(/aria-label="([^"]+)"/)?.[1] ?? content.match(/class="consoleNavLabel">([^<]+)<\/span>/)?.[1],
  }));
}

test("seven views use real root URL links inside one responsive navigation", () => {
  const markup = fixture().render();
  assert.deepEqual(primaryLinks(markup).map(({ href, label }) => [href, label]), [
    ["/dashboard?view=overview", "Overview"], ["/dashboard?view=work", "Work"],
    ["/dashboard?view=library", "Library"], ["/dashboard?view=decisions", "Decisions"],
    ["/dashboard?view=connections", "Connections"], ["/dashboard?view=activity", "Activity"],
    ["/dashboard?view=advanced", "Advanced"],
  ]);
  assert.equal((markup.match(/class="consoleNavigation"/g) ?? []).length, 1);
  assert.doesNotMatch(source, /onClick|preventDefault|history\.replaceState|useState|usePathname/);
  assert.match(source, /import Link from "next\/link"/);
});

test("all root views and legacy sections select the correct single primary destination", () => {
  const views = ["overview", "work", "library", "decisions", "connections", "activity", "advanced"];
  const legacy = { dashboard: "overview", workflows: "work", products: "work", artifacts: "library", "needs-you": "decisions", accounts: "connections", history: "activity", packs: "advanced", settings: "advanced" };
  for (const [active, destination] of [...views.map(view => [view, view]), ...Object.entries(legacy)]) {
    const view = fixture();
    assert.equal(view.exports.resolveConsoleView(active), destination);
    assert.deepEqual(primaryLinks(view.render({ active })).filter(item => item.current).map(item => item.href), [`/dashboard?view=${destination}`]);
  }
});

test("one Advanced destination retains all technical routes without a duplicate menu", () => {
  const view = fixture();
  const markup = view.render({ active: "advanced" });
  assert.doesNotMatch(markup, /Advanced tools|consoleTechnicalSummary/);
  assert.equal(primaryLinks(markup).filter(item => item.current && item.href === "/dashboard?view=advanced").length, 1);
  for (const path of ["workflows", "products", "artifacts", "needs-you", "accounts", "history", "packs", "worker-proof", "model-router", "worker-evaluations", "settings"]) {
    assert.ok(view.exports.consoleAdvancedNavigation.some(item => item.href === `/dashboard/${path}`), path);
  }
  assert.match(readFileSync("src/app/dashboard/page.tsx", "utf8"), /consoleAdvancedNavigation\.map/);
});

test("one scoped LiveRefresh reports page-update connectivity rather than invented execution telemetry", () => {
  const view = fixture();
  const markup = view.render({ workflowRunId: "fixture-run" });
  assert.equal(view.liveCalls.length, 1);
  assert.equal(view.liveCalls[0].workflowRunId, "fixture-run");
  assert.equal((markup.match(/class="liveConnection"/g) ?? []).length, 1);
  assert.match(markup, /role="status" aria-label="Page update connection"/);
  assert.doesNotMatch(markup, /System optimal|\bCPU\b|\bRAM\b|Voice active|Listening|Agent online/i);
  assert.doesNotMatch(source, /"use client"|useEffect|window\.|document\./);
  assert.match(source, /import type \{ CoreSection \}/);
});

test("unknown decision reads never masquerade as zero or a stale known count", () => {
  const unavailable = fixture().render({ context: { ...owner, needsYouUnavailable: true, needsYouCount: 27 } });
  assert.match(unavailable, /consoleDecisionCount-unknown/);
  assert.match(unavailable, /Decision count unavailable/);
  assert.match(unavailable, /<span aria-hidden="true">\?<\/span>/);
  assert.doesNotMatch(unavailable, /27 open decisions|>27<|0 open decisions/);
  const zero = fixture().render({ context: { ...owner, needsYouCount: 0 } });
  assert.match(zero, /consoleDecisionCount-empty/);
  assert.match(zero, /0 open decisions/);
  assert.doesNotMatch(zero, /count unavailable/);
  const many = fixture().render({ context: { ...owner, needsYouCount: 122 } });
  assert.match(many, />99\+</);
  assert.match(many, /122 open decisions/);
  assert.match(fixture().render({ context: { ...owner, needsYouCount: 1 } }), /1 open decision</);
});

test("business unavailable, empty, single, and aggregate contexts remain distinct", () => {
  assert.match(fixture().render(), /North Star Studio/);
  assert.match(fixture().render({ context: { ...owner, businesses: [] } }), /No business yet/);
  const multiple = fixture().render({ context: { ...owner, businesses: [...owner.businesses, { id: "second", name: "Second Business" }] } });
  assert.match(multiple, /All 2 businesses/);
  assert.doesNotMatch(multiple, /North Star Studio|Second Business/);
  const unavailable = fixture().render({ context: { ...owner, businessesUnavailable: true } });
  assert.match(unavailable, /class="consoleWorkspaceContext" role="status"/);
  assert.match(unavailable, /Business records unavailable/);
  assert.doesNotMatch(unavailable, /North Star Studio|No business yet|All 1/);
});

test("owner account disclosure is labelled even when the visible name is hidden and signs out with POST", () => {
  const markup = fixture().render();
  assert.match(markup, /class="consoleOwnerSummary" aria-label="Account for Fixture Owner"/);
  assert.match(markup, /owner@example\.invalid/);
  assert.match(markup, /<form action="\/auth\/signout" method="post">/);
  assert.match(markup, /<button class="consoleSignOut" type="submit">Sign out<\/button>/);
  assert.equal((markup.match(/<form/g) ?? []).length, 1);
});

test("one focusable main holds real view content and the persistent footer accepts a real command slot", () => {
  const markup = fixture().render({ commandBar: React.createElement("button", { type: "button" }, "Start research") });
  assert.match(markup, /href="#main-content">Skip to content/);
  assert.equal((markup.match(/id="main-content"/g) ?? []).length, 1);
  assert.match(markup, /<main class="consoleMain" id="main-content" tabindex="-1"><h1>Fixture workspace<\/h1><\/main>/);
  assert.match(markup, /<footer class="consoleCommandBar consoleFrame" aria-label="Workspace commands"><button type="button">Start research<\/button><\/footer>/);
  assert.doesNotMatch(markup, /Choose work or review a decision|consoleDefaultCommands/);
  const escaped = fixture().render({ context: { ...owner, displayName: "<script>alert(1)</script>" } });
  assert.doesNotMatch(escaped, /<script>/);
  assert.match(escaped, /&lt;script&gt;/);
});

test("desktop tokens preserve the compact 180px rail, 48px bars, 8px gaps, and scrollable centre", () => {
  assert.match(css, /--console-rail-width: 180px/);
  assert.match(css, /--console-top-height: 48px/);
  assert.match(css, /--console-command-height: 48px/);
  assert.match(css, /--console-gap: 8px/);
  assert.match(css, /grid-template-rows: var\(--console-top-height\) minmax\(0, 1fr\) var\(--console-command-height\)/);
  assert.match(css, /height: 100dvh/);
  assert.match(css, /\.consoleMain \{[^}]*min-height: 0;[^}]*overflow: auto/s);
  assert.match(css, /\.consoleNavLink \{[^}]*min-height: 36px/);
  assert.match(css, /\.consoleCommandLink \{[^}]*min-height: 32px/);
  assert.match(css, /\.consoleFrame::before, \.consoleFrame::after \{[^}]*pointer-events: none/);
});

test("mobile navigation wraps visibly, content page-scrolls, and controls meet 44px targets", () => {
  const mobile = css.slice(css.indexOf("@media (max-width: 760px)"));
  assert.match(mobile, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(mobile, /\.consoleNavLink \{[^}]*min-height: 48px/);
  for (const selector of ["consoleTechnicalSummary", "consoleTechnicalLink", "consoleOwnerSummary", "consoleSignOut", "consoleCommandLink"]) {
    assert.match(mobile, new RegExp(`\\.${selector} \\{[^}]*min-height: 44px`));
  }
  assert.match(mobile, /\.consoleMain \{[^}]*overflow: visible/);
  assert.match(mobile, /position: sticky; bottom: 0/);
  assert.match(mobile, /scroll-margin-bottom: calc\(80px \+ env\(safe-area-inset-bottom\)\)/);
  assert.doesNotMatch(css, /overflow-x: auto|\.consoleTechnicalLinks \{[^}]*position: absolute/);
  assert.match(css, /\.consoleShell :focus-visible/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});
