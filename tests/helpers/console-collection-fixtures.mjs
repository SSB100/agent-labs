import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadSource, fixtureDocument, ownerContext } from "./guided-ui.mjs";

export const collectionOrigin = "https://agentlabs-collection.test";
export const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
export const collectionBusinesses = [1, 2].map(number => ({ id: id(number), name: "North Star Design Studio with deliberately duplicated long Business names", created_at: "2026-10-02T00:00:00Z", updated_at: "2026-10-02T00:00:00Z" }));
const timestamp = number => new Date(Date.parse("2026-01-01T00:00:00Z") + Math.floor(number / 2) * 86400000).toISOString();
export const longTitle = "Duplicate saved workflow name and a verylongunbrokentitle" + "withoutspaces".repeat(12);
export const definition = { id: id(50), workflow_key: "fixture.read-only", version: "2.1.0", name: longTitle, status: "qualified", description: "Read-only fixture", stage_definition: {} };
const statuses = ["running", "completed", "failed", "needs_owner", "cancelled", "queued", "waiting", "review", "future_unsupported_state"];
export const work = Array.from({ length: 127 }, (_, index) => ({ id: id(1000 + index), business_id: collectionBusinesses[index % 2].id, workflow_definition_id: definition.id, status: statuses[index % statuses.length], current_stage_key: "evidence_review", created_at: timestamp(index), updated_at: timestamp(index + 1), input: {}, state: {}, runtime_provider: null, runtime_run_id: null, started_at: null, completed_at: index === 0 ? timestamp(index + 1) : null }));
export const activity = work.map((run, index) => ({ id: id(10000 + index), business_id: run.business_id, workflow_run_id: run.id, event_type: `workflow.${run.status}.recorded_with_long_saved_event_type_${"event".repeat(12)}`, actor_type: "system", actor_id: null, payload: { exact: index, notSearchable: "payload-only-term" }, occurred_at: timestamp(index), created_at: timestamp(index) }));
const api = loadSource("src/lib/core-ui/console-collections-query.ts");
export const scroll = loadSource("src/components/console/console-collection-scroll.ts");
const viewport = loadSource("src/components/console/console-collection-viewport.tsx", { "./console-collection-scroll": scroll });
export const workflows = loadSource("src/lib/core-ui/workflows.ts");
export const panes = loadSource("src/components/console/console-collection-panes.tsx", {
  "@/lib/core-ui/console-collections-query": api, "@/lib/core-ui/workflows": workflows,
  "./console-collection-viewport": viewport, "./console-collection-panes.css": {},
});
const components = { work: panes.ConsoleWorkCollectionPane, activity: panes.ConsoleActivityCollectionPane };
/** Synthetic server pages exercise real presentation. The reader's separate query tests establish server bounds. */
export function collectionFixture(kind = "work", overrides = {}) {
  const params = overrides.searchParams instanceof URLSearchParams ? overrides.searchParams : new URLSearchParams({ view: kind, status: "all", ...overrides.searchParams });
  const source = { work, activity }[kind].slice(0, overrides.recordCount ?? 127);
  const pageNumber = Number(params.get("page") ?? 1), business = params.get("business"), query = params.get("q") ?? "", status = params.get("status") ?? "all";
  let filtered = source.filter(row => !business || row.business_id === business).filter(row => !query || (kind === "activity" ? row.event_type : definition.name).toLowerCase().includes(query.toLowerCase()));
  if (status !== "all") filtered = filtered.filter(row => {
    const active = ["running", "queued", "waiting", "review", "needs_owner"];
    return status === "stopped" ? active.includes(row.status) && !!row.completed_at : status === "active" ? active.includes(row.status) && !row.completed_at : row.status === status && (!active.includes(status) || !row.completed_at);
  });
  if (kind === "activity" && params.get("runFilter")) filtered = filtered.filter(row => row.workflow_run_id === params.get("runFilter"));
  const order = params.get("sort") === "oldest" ? 1 : -1, field = kind === "activity" ? "occurred_at" : params.get("sort") === "updated" ? "updated_at" : "created_at";
  filtered = [...filtered].sort((a, b) => (a[field].localeCompare(b[field]) || a.id.localeCompare(b.id)) * order);
  const selected = source.find(row => row.id === (params.get("selected") ?? params.get("run")) && (!business || row.business_id === business));
  const selection = params.has("selected") || params.has("run") ? selected ? { status: "found", item: selected } : { status: "missing", item: null } : { status: "none", item: null };
  const metadata = (row, excluded) => Object.fromEntries(Object.entries(row).filter(([key]) => !excluded.includes(key)));
  const items = filtered.slice((pageNumber - 1) * 25, pageNumber * 25).map(row => metadata(row, kind === "work" ? ["input", "state"] : ["payload"]));
  const page = { items, page: pageNumber, pageSize: 25, total: filtered.length, hasPrevious: pageNumber > 1, hasNext: pageNumber * 25 < filtered.length, complete: true, errors: [], ...overrides.page };
  const data = { page, selection: kind === "work" && selection.status === "found" ? { ...selection, item: metadata(selection.item, ["input", "state"]) } : selection, errors: [], ...(kind === "work" ? { definitions: [metadata(definition, ["stage_definition"])] } : { workflowFilter: null, runs: work.map(row => metadata(row, ["input", "state"])) }), ...overrides.data };
  const children = kind === "work" && selected ? React.createElement("article", { "data-fixture-detail": selected.id }, React.createElement("h3", null, "Exact saved evidence"), React.createElement("p", null, `Business ${selected.business_id} · Selected ${selected.id}`), ...Array.from({ length: 35 }, (_, index) => React.createElement("p", { key: index }, `Saved evidence paragraph ${index + 1}: ${longTitle}`))) : undefined;
  return { data, props: { ownerId: overrides.ownerId ?? "fixture-owner", businesses: collectionBusinesses, searchParams: params, children, ...overrides.props }, Component: components[kind] };
}
export function collectionMarkup(kind = "work", overrides = {}, shell = false) {
  const { data, props, Component } = collectionFixture(kind, overrides);
  const content = React.createElement(Component, { data, ...props });
  if (!shell) return renderToStaticMarkup(content);
  const icons = loadSource("src/components/stage7/icons.tsx");
  const { ConsoleShell } = loadSource("src/components/console/console-shell.tsx", { "@/components/stage7/icons": icons, "@/components/stage7/live-refresh": { LiveRefresh: () => null }, "./console-shell.css": {} });
  return renderToStaticMarkup(React.createElement(ConsoleShell, { active: kind, context: ownerContext({ businesses: collectionBusinesses }) }, content));
}
export function collectionDocument(kind = "work", overrides = {}) {
  return fixtureDocument(collectionMarkup(kind, overrides, true)).replace("</head>", `<style>${readFileSync("src/components/console/console-collection-panes.css", "utf8")}</style></head>`);
}

const outcomes = loadSource("src/lib/core-ui/run-outcome.ts", { "./workflows": workflows });
export const workDetailUi = loadSource("src/components/console/console-work-detail.tsx", {
  "@/lib/core-ui/console-collections-query": api, "@/lib/core-ui/workflows": workflows,
  "@/lib/core-ui/run-outcome": outcomes, "./console-collection-panes": panes,
  "./console-artifact-position": loadSource("src/components/console/console-artifact-position.tsx"),
});
export function workDetailFixture(overrides = {}) {
  const run = { ...work[0], status: "needs_owner", ...overrides.run };
  const child = { business_id: run.business_id, workflow_run_id: run.id, created_at: timestamp(0), updated_at: timestamp(1) };
  const artifact = { ...child, id: id(42), artifact_type: "research.report", name: longTitle, media_type: "application/json", task_contract_id: null, storage_path: null, metadata: {}, content: { exactSelectedOnly: "Saved exact artifact" } };
  const empty = { total: 0, loaded: 0, limit: 100, complete: true, hasMore: false, errors: [] };
  const one = { ...empty, total: 1, loaded: 1 };
  return {
    selection: { status: "found", item: run }, run, business: collectionBusinesses[0], definition,
    stages: [{ id: id(2000), workflow_run_id: run.id, stage_key: "failed-stage", status: "failed", sequence: 1, attempt: 1, created_at: timestamp(0) }],
    tasks: [], workerRuns: [], workerDefinitions: [],
    interventions: [{ ...child, id: id(3000), title: "Review this stopped run", status: "open", intervention_type: "creative_review", description: "Saved decision", requested_at: timestamp(0), resolved_at: null }],
    artifacts: Array.from({ length: 100 }, (_, index) => ({ ...child, id: id(5000 + index), name: `Saved artifact metadata ${index + 1}`, artifact_type: "report", metadata: {}, media_type: "application/json", storage_path: null, task_contract_id: null })),
    artifactSelection: { status: "found", item: artifact },
    completeness: { stages: one, tasks: empty, workers: empty, workerDefinitions: empty, interventions: one, artifacts: { ...one, total: 127, loaded: 100, complete: false, hasMore: true } },
    costs: { businessId: run.business_id, workflowRunId: run.id, source: "model", calls: { status: "ready", records: [{ id: "settled", reportedUsd: .123456, providerRequestId: "fixture-receipt" }, { id: "pending", reportedUsd: null, reservedUsd: .25, providerRequestId: null }] } },
    research: { status: "not-loaded", experiment: null }, complete: false, errors: ["Bounded artifact history"], ...overrides,
  };
}
export function workDetailMarkup(overrides = {}, search = {}) {
  const detail = workDetailFixture(overrides);
  const searchParams = { view: "work", selected: detail.run?.id ?? id(1000), business: detail.run?.business_id ?? id(1), page: "3", q: "Duplicate", artifact: id(42), ...search };
  return renderToStaticMarkup(React.createElement(workDetailUi.ConsoleWorkDetail, { detail, searchParams }));
}
