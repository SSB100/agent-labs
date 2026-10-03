import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import React from "react";

const require = createRequire(import.meta.url);
function FixtureLink({ children, ...props }) { delete props.prefetch; return React.createElement("a", props, children); }
export const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
export function loadBrowserSource(file, dependencies = {}) {
  const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const compiledModule = { exports: {} };
  runInNewContext(`(function(require,module,exports){${code}\n})`, { URL, URLSearchParams, Response, Request, Date, structuredClone, AbortController })(name => {
    if (name === "@/lib/core-ui/workspace-navigation") return loadBrowserSource("src/lib/core-ui/workspace-navigation.ts");
    if (name === "react") return React;
    if (name === "react/jsx-runtime") return require(name);
    if (name === "next/link") return FixtureLink;
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected browser-console import: ${name}`);
    return dependencies[name];
  }, compiledModule, compiledModule.exports);
  return compiledModule.exports;
}
export const contract = loadBrowserSource("src/browser/console-view.ts");
export function fixture() {
  return {
    session: { id: id(1), business_id: id(2), workflow_run_id: id(3), provider_definition_id: id(4), provider_session_id: "fixture-provider-session",
      status: "live", control_mode: "automation", live_view_status: "ready", current_url: null,
      page_title: null, metadata: { qualification: "browser_planner", plannerKey: "browser.planner", plannerVersion: "1.0.0" },
      failure: {}, released_at: null, updated_at: "2026-10-02T03:00:00.000Z" },
    run: { id: id(3), business_id: id(2), workflow_definition_id: id(902), status: "running", current_stage_key: "synthetic", completed_at: null, state: {} },
  };
}
export function wire({ sessions, runs, failTable, throwTable } = {}) {
  const f = fixture();
  const calls = [];
  const tables = {
    browser_sessions: sessions ?? [f.session], workflow_runs: runs ?? [f.run],
  };
  const client = {
    from(table) {
      assert.ok(Object.hasOwn(tables, table), `Unexpected table: ${table}`);
      const query = { table, filters: [], limit: Infinity, single: false };
      const builder = {
        select(value) { query.select = value; return builder; },
        eq(key, value) { query.filters.push([key, value]); return builder; },
        in(key, values) { query.filters.push([key, values]); return builder; },
        order() { return builder; }, limit(count) { query.limit = count; return builder; }, maybeSingle() { query.single = true; return builder; },
        then(resolve, reject) {
          calls.push(query);
          if (table === throwTable) return Promise.reject(new Error("fixture read failed")).then(resolve, reject);
          const matched = tables[table].filter(row => query.filters.every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : value === row[key])).slice(0, query.limit);
          return Promise.resolve({ data: structuredClone(query.single ? matched[0] ?? null : matched), error: table === failTable ? { message: "fixture failure" } : null }).then(resolve, reject);
        },
      };
      return builder;
    },
    async rpc(name, args) { calls.push({ rpc: name, args }); throw new Error("A metadata view must never call an RPC"); },
  };
  const server = loadBrowserSource("src/browser/console-server.ts", { "server-only": {}, "./console-view": contract });
  const context = { supabase: client, userId: "owner", businesses: [{ id: id(2), name: "Fixture studio" }] };
  return { calls, tables, client, server, context };
}
export function workspace(overrides = {}) {
  const f = fixture(), summary = contract.consoleBrowserSummary(f.session, f.run);
  return { status: "ready", businesses: [{ id: id(2), name: "Fixture studio" }], selectedBusinessId: id(2), selectedRunId: id(3), sessions: [summary], selectedSession: summary, truncated: false, ...overrides };
}
