import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import path from "node:path";
import { wire as browserMetadataWire } from "./console-browser-fixtures.mjs";
import { rootCollectionFixture } from "./console-collection-root.mjs";
import { rootLibraryFixture } from "./console-library-root.mjs";
import { seed as librarySeed } from "./console-library-data-fixtures.mjs";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const root = fileURLToPath(new URL("../../", import.meta.url));
export const fixtureTime = "2026-10-02T03:00:00.000Z";
const noAction = () => { throw new Error("Read-only fixture actions must never execute"); };
const Link = ({ children, ...props }) => { delete props.prefetch; delete props.scroll; return React.createElement("a", props, children); };
class FixtureDate extends Date {
  constructor(...values) { super(...(values.length ? values : [fixtureTime])); }
  static now() { return Date.parse(fixtureTime); }
}

// Transpile the production TSX, rather than reconstructing look-alike HTML. Every
// import is explicit: accidentally reaching auth, providers or the network fails.
export function loadSource(file, dependencies = {}) {
  const code = ts.transpileModule(readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const fixtureModule = { exports: {} };
  let sequence = 0;
  const crypto = { ...require("node:crypto"), randomUUID: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}` };
  runInNewContext(`(function(require,module,exports){${code}\n})`, { Date: FixtureDate, crypto, Buffer, URL, URLSearchParams, structuredClone, process: { env: { AGENTLABS_GUIDED_UI: "guided", NODE_ENV: "test" } } })(name => {
    if (name === "@/lib/core-ui/workspace-navigation") return loadSource("src/lib/core-ui/workspace-navigation.ts");
    if (name === "../../core/quest-intake" && file === "src/lib/core-ui/quest-draft.ts") return loadSource("src/core/quest-intake.ts");
    if (name === "@/lib/core-ui/console-retained-feedback") return loadSource("src/lib/core-ui/console-retained-feedback.ts");
    if (["@/lib/core-ui/owner-business", "../lib/core-ui/owner-business", "./owner-business"].includes(name)) return loadSource("src/lib/core-ui/owner-business.ts");
    if (["../lib/core-ui/history-read", "@/lib/core-ui/history-read"].includes(name)) return loadSource("src/lib/core-ui/history-read.ts");
    if (["./history-query", "../lib/core-ui/history-query", "@/lib/core-ui/history-query"].includes(name)) return loadSource("src/lib/core-ui/history-query.ts");
    if (["@/components/console/history-pager", "./history-pager"].includes(name)) return { HistoryPager: ({page, label}) => page ? React.createElement("p", null, `${label}: ${page.total ?? 'unavailable'} total · page ${page.page}`) : null };
    if (name === "react/jsx-runtime") return require(name);
    if (name === "react") return React;
    if (name === "react-dom") return require(name);
    if (name === "node:crypto") return crypto;
    if (name === "next/link") return Link;
    if (name === "next/navigation" && file === "src/components/stage13/products-workspace.tsx") return { usePathname:()=>"/dashboard/products", useSearchParams:()=>new URLSearchParams(), useRouter:()=>({push:noAction}) };
    if (name === "@/components/console/console-retained-workspace") return dependencies[name] ?? retainedFixture();
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected guided UI dependency in ${file}: ${name}`);
    return dependencies[name];
  }, fixtureModule, fixtureModule.exports);
  return fixtureModule.exports;
}

// The actual retained client component is also exercised in supplemental SSR
// fixtures. Navigation and persistence qualification is the separate real Next gate.
export function retainedFixture(query = {}, pathname = "/dashboard/products") {
  return loadSource("src/components/console/console-retained-workspace.tsx", {
    "next/navigation": { usePathname: () => pathname, useSearchParams: () => new URLSearchParams(query) },
    "./console-retained-workspace.css": {},
  });
}

export const business = { id: "00000000-0000-4000-8000-000000000901", name: "North Star Design Studio", created_at: fixtureTime, updated_at: fixtureTime };
export const definition = {
  id: "00000000-0000-4000-8000-000000000900", workflow_key: "synthetic.core.runtime-proof", version: "1.0.0", name: "Original product research",
  description: "Research evidence, review the saved result, and decide the next step.", status: "qualified",
  stage_definition: { stages: [
    { key: "start", type: "system", sequence: 0 }, { key: "worker-task", type: "worker", sequence: 1 },
    { key: "wait", type: "wait", sequence: 2 }, { key: "review", type: "review", sequence: 3 }, { key: "complete", type: "terminal", sequence: 4 },
  ] },
};
export const run = {
  id: "00000000-0000-4000-8000-000000000902", business_id: business.id, workflow_definition_id: definition.id, status: "needs_owner", current_stage_key: "review",
  input: {}, state: {}, runtime_provider: "vercel_workflow", runtime_run_id: "fixture-runtime", started_at: "2026-10-02T02:45:00.000Z",
  completed_at: null, created_at: "2026-10-02T02:45:00.000Z", updated_at: "2026-10-02T02:58:00.000Z",
};
export const intervention = {
  id: "00000000-0000-4000-8000-000000000903", business_id: business.id, workflow_run_id: run.id, intervention_type: "review", status: "open",
  title: "Review the saved research result", description: "The bounded workflow has paused. Review the evidence before making your decision.",
  options: {}, resolution: {}, requested_at: "2026-10-02T02:58:00.000Z", resolved_at: null,
  created_at: "2026-10-02T02:58:00.000Z", updated_at: "2026-10-02T02:58:00.000Z",
};
export const stages = ["start", "worker-task", "wait", "review"].map((stage_key, sequence) => ({
  id: `00000000-0000-4000-8000-${String(920 + sequence).padStart(12, "0")}`, workflow_run_id: run.id, stage_key, sequence, attempt: stage_key === "worker-task" ? 2 : 1,
  status: stage_key === "review" ? "needs_owner" : "completed", input: {}, output: {}, failure: {},
  started_at: run.started_at, completed_at: stage_key === "review" ? null : run.updated_at, created_at: run.created_at, updated_at: run.updated_at,
}));
const event = {
  id: "00000000-0000-4000-8000-000000000904", business_id: business.id, workflow_run_id: run.id, event_type: "workflow.owner_intervention.requested",
  actor_type: "system", actor_id: null, payload: { stageKey: "review" }, occurred_at: run.updated_at, created_at: run.updated_at,
};

export function ownerContext(overrides = {}) {
  return {
    userId: "fixture-owner", email: "owner@example.invalid", displayName: "Fixture Owner", businesses: [business],
    needsYouCount: 1, needsYouUnavailable: false, businessesUnavailable: false, ...overrides,
  };
}
export function workflowCollection(overrides = {}) {
  return {
    runs: [run], definitions: [definition], stages, events: [event], interventions: [intervention],
    tasks: [], workerRuns: [], workerDefinitions: [], artifacts: [], errors: [], ...overrides,
  };
}
export function browserPresentation() {
  const browserView = loadSource("src/browser/console-view.ts");
  const browserUi = loadSource("src/components/console/console-browser-centre.tsx", { "@/browser/console-view": browserView, "./console-browser-centre.css": {} });
  return { browserView, browserUi };
}

export function components() {
  const workflows = loadSource("src/lib/core-ui/workflows.ts");
  const motion = loadSource("src/lib/core-ui/console-motion.ts", { "./workflows": workflows });
  const motionDom = loadSource("src/lib/core-ui/console-motion-dom.ts", { "./console-motion": motion });
  const motionUi = loadSource("src/components/console/console-motion.tsx", { "@/lib/core-ui/console-motion-dom": motionDom, "./console-motion.css": {} });
  const icons = loadSource("src/components/stage7/icons.tsx");
  const live = loadSource("src/components/stage7/live-refresh.tsx", {
    "next/navigation": { useRouter: () => ({ refresh: noAction }) }, "@/lib/supabase/client": { createClient: noAction },
  });
  const consoleShell = loadSource("src/components/console/console-shell.tsx", {
    "@/components/stage7/icons": icons, "@/components/stage7/live-refresh": live, "./console-shell.css": {},
  });
  const shell = loadSource("src/components/stage7/app-shell.tsx", { "./icons": icons, "./live-refresh": live, "@/lib/core-ui/workflows": workflows, "@/components/console/console-shell": consoleShell });
  const visuals = loadSource("src/components/stage7/workflow-visuals.tsx", {
    "@/app/dashboard/actions": { resumeSyntheticReview: noAction }, "@/app/dashboard/packs/actions": { acknowledgeEtsySimulation: noAction },
    "@/app/dashboard/browser-actions": { resumeBrowserControl: noAction }, "@/lib/core-ui/workflows": workflows,
    "./icons": icons, "./app-shell": shell,
  });
  return { workflows, icons, live, shell, visuals, consoleShell, motion, motionUi, ...browserPresentation() };
}

export function findFixtureElement(tree, name) {
  for (const element of React.Children.toArray(tree)) {
    if (!React.isValidElement(element)) continue;
    if (element.type?.name === name) return element;
    const nested = findFixtureElement(element.props.children, name);
    if (nested) return nested;
  }
  return null;
}

export async function renderDashboard({ unavailable = false, empty = false, view = "overview", detail = false, sheet = false, knownZero = false, businessesUnavailable = false, mismatchedBusiness = false, businessFlow = false, omitBusinessQuery = false, records, contextOverrides = {}, queryOverrides = {}, browserRecords = {}, accountRecords, accountComponents, accountActions, observedAt = Date.parse(fixtureTime), inspect, reads = [] } = {}) {
  const { shell, visuals, icons, workflows, consoleShell, motion, motionUi, browserView, browserUi } = components();
  const otherBusiness = { ...business, id: "00000000-0000-4000-8000-000000000911", name: "Other authorized Business" };
  const context = ownerContext({ needsYouCount: unavailable || empty ? 0 : 1, needsYouUnavailable: unavailable && !knownZero, businessesUnavailable,
    businesses: businessesUnavailable ? [] : mismatchedBusiness || businessFlow ? [business, otherBusiness] : [business], ...contextOverrides });
  const collection = records ?? (unavailable || empty ? workflowCollection({ runs: [], definitions: [], stages: [], events: [], interventions: [], errors: unavailable ? ["Synthetic workflow read unavailable"] : [] }) : workflowCollection());
  const rootRun = businessFlow ? { ...run, business_id: otherBusiness.id } : collection.runs.find(item => item.id === run.id) ?? run;
  if (businessFlow) {
    collection.runs = collection.runs.map(item => ({ ...item, business_id: otherBusiness.id }));
    collection.interventions = collection.interventions.map(item => ({ ...item, business_id: otherBusiness.id }));
    collection.events = collection.events.map(item => ({ ...item, business_id: otherBusiness.id }));
  }
  const browserWire = browserMetadataWire({ sessions: [], runs: collection.runs, ...browserRecords });
  context.supabase = browserWire.client;
  const accounts = accountRecords ?? { businessId: rootRun.business_id, configured: false, unavailable, observedAt: fixtureTime, profile: null, accounts: [], runs: [], healthEvents: [], registrationAvailable: false };
  const products = { candidates: [], experiments: [], decisions: [], errors: [] };
  const costData = { costs: { businessId: rootRun.business_id, workflowRunId: run.id, source: "model", calls: unavailable ? { status: "unavailable" } : { status: "ready", records: [{ providerRequestId: "fixture-receipt", reportedUsd: .0182 }] } } };
  const questDraft = loadSource("src/lib/core-ui/quest-draft.ts");
  const quest = loadSource("src/components/guided/quest-kickoff.tsx", {
    "@/app/dashboard/products/discovery-actions": { startGeographicDiscovery: noAction }, "@/lib/core-ui/quest-draft": questDraft, "./quest-kickoff.css": {},
  });
  const command = loadSource("src/components/console/console-command.tsx", {
    "next/navigation": { useRouter: () => ({ push: noAction }) }, "@/lib/core-ui/quest-draft": questDraft, "./console-command.css": {},
  });
  const overview = loadSource("src/components/console/console-overview.tsx", { "@/components/stage7/icons": icons, "@/lib/core-ui/workflows": workflows, "./console-browser-centre": browserUi, "./console-overview.css": {} });
  const outcomes = loadSource("src/lib/core-ui/run-outcome.ts", { "./workflows": workflows });
  const decisionQuery = loadSource("src/lib/core-ui/console-decisions-query.ts");
  const decisionView = loadSource("src/lib/core-ui/console-decisions-view.ts", { "./workflows": workflows, "./run-outcome": outcomes });
  const decisionsUi = loadSource("src/components/console/console-compact-decisions.tsx", { "@/lib/core-ui/workflows": workflows, "@/lib/core-ui/console-decisions-query": decisionQuery, "@/lib/core-ui/console-decisions-view": decisionView, "./console-decision-submit": loadSource("src/components/console/console-decision-submit.tsx"), "./console-decision-filters": loadSource("src/components/console/console-decision-filters.tsx", { "@/lib/core-ui/console-decisions-query": decisionQuery }), "./console-compact-decisions.css": {} });
  const outcomeUi = loadSource("src/components/guided/run-outcome.tsx", { "@/lib/core-ui/run-outcome": outcomes, "./run-outcome.css": {} });
  const workContext = loadSource("src/components/guided/work-context.tsx", { "@/lib/core-ui/workflows": workflows, "./work-context.css": {} });
  const work = loadSource("src/components/console/console-work-pane.tsx", {
    "./console-artifact-position": loadSource("src/components/console/console-artifact-position.tsx"),
    "@/components/stage7/app-shell": shell, "@/components/stage7/workflow-visuals": visuals, "@/lib/core-ui/workflows": workflows,
    "@/components/guided/run-outcome": outcomeUi, "@/components/guided/work-context": workContext,
  });
  const costs = loadSource("src/creative/cost-display.ts");
  const library = loadSource("src/components/guided/creative-library.tsx", { "@/creative/cost-display": costs, "./creative-library.css": {} });
  const connectionFeedback = loadSource("src/accounts/connection-feedback.ts");
  const accountFeedback = accountComponents ?? loadSource("src/app/dashboard/accounts/connection-feedback.tsx", {
    "@/accounts/connection-feedback": connectionFeedback,
    "next/navigation": { unstable_rethrow: noAction },
  });
  const accountUi = loadSource("src/app/dashboard/accounts/account-workspace.tsx", {
    "@/accounts/contracts": loadSource("src/accounts/contracts.ts"), "@/components/stage7/app-shell": shell,
    "@/accounts/connection-feedback": connectionFeedback, "./connection-feedback": accountFeedback,
    "./actions": accountActions ?? Object.fromEntries(["saveBusinessAccountProfile", "requestAccountSetup", "approveReviewedAccountSetup", "cancelAccountSetup", "resumeVerifiedAccountSetup", "disconnectBusinessAccount", "startApprovedAccountRegistration", "finishOwnerRegistrationSession", "removeOwnerWebsitePassword"].map(name => [name, noAction])),
  });
  const consoleData = loadSource("src/lib/core-ui/console-data.ts", { "@/products/discovery-v2-goal": {}, "@/products/discovery-v2-budget": {} });
  const goalUi = loadSource("src/components/stage13/discovery-goal-workspace.tsx", {
    "./products-workspace": { ProductSubmitButton: noAction }, "@/app/dashboard/products/discovery-actions": {}, "@/products/discovery-v2-goal": {},
  });
  const details = { ...collection, run: rootRun, definition, business: context.businesses.find(item => item.id === rootRun.business_id) };
  const collectionFixture = rootCollectionFixture({
    tables: { businesses: context.businesses, workflow_runs: collection.runs, workflow_definitions: collection.definitions,
      workflow_stage_runs: collection.stages, task_contracts: collection.tasks, worker_runs: collection.workerRuns,
      worker_definitions: collection.workerDefinitions, owner_interventions: collection.interventions,
      events: collection.events, artifacts: collection.artifacts, product_experiments: [],
      model_invocations: [{ id: "00000000-0000-4000-8000-000000000905", business_id: rootRun.business_id,
        workflow_run_id: run.id, provider_request_id: "fixture-receipt", reported_cost_usd: .0182 }] },
    ownedBusinesses: context.businesses, businessesUnavailable,
    readOptions: unavailable ? { failTable: "workflow_runs" } : {},
  });
  if (view === "work" || view === "activity") context.supabase = collectionFixture.context.supabase;
  const populated = collectionFixture.load("src/components/console/console-populated-dashboard.tsx");
  const isBoundedLibrary = view === "library" && queryOverrides?.type !== "research";
  // Shared navigation captures have no image transport. Dedicated Library
  // journeys intercept exact synthetic signed PNGs and cover ready previews.
  const libraryFixture = isBoundedLibrary ? rootLibraryFixture({ tables: librarySeed(1, rootRun.business_id), ownedBusinesses: context.businesses, businessesUnavailable, readOptions: { signResult: () => ({ data: [], error: null }) } }) : null;
  if (libraryFixture) context.supabase = libraryFixture.context.supabase;
  const boundedLibrary = libraryFixture ? libraryFixture.load("src/components/console/console-library-dashboard.tsx") : { ConsoleLibraryDashboard: noAction };

  // R03 supplemental presentation fixtures supply a typed inert R04 selection boundary.
  // R08 source/SQL and actual Next suites exercise the genuine resolver and Quest-filtered transport.
  const workspaceBoundary = { resolveWorkspace: async (ctx, input) => {
    const selectedBusiness = ctx.businesses.find(b => b.id === input.business) ?? ctx.businesses[0];
    if (input.business && !ctx.businesses.some(b => b.id === input.business)) throw Error("Fixture record was not found");
    if (input.browserRun && !collection.runs.some(r => r.id === input.browserRun && r.business_id === selectedBusiness?.id)) throw Error("Fixture record was not found");
    const qid = "00000000-0000-4000-8000-000000008200";
    const selected = selectedBusiness && !empty ? {id:qid,businessId:selectedBusiness.id,title:"Synthetic selected Quest",revision:1,preference:"ready",content:{objective:"Inspect this exact Business workflow evidence",originalIntent:"Inert intent"}} : null;
    const original = ctx.supabase;
    const scoped = {...ctx,supabase:{...original,rpc:async name=>name==='r07_quest_read'?{data:{selected:null},error:null}:{data:{authorityRootId:selectedBusiness?.id,exposure:[]},error:null},from:table=>{
      if(table!=='owner_interventions')return original.from(table);
      const q={select:()=>q,eq:()=>q,then:(resolve,reject)=>Promise.resolve({data:null,count:ctx.needsYouCount,error:ctx.needsYouUnavailable?true:null}).then(resolve,reject)};return q;
    }}};
    return {context:scoped,businessId:selectedBusiness?.id??null,unavailable:businessesUnavailable,state:selectedBusiness?{businessId:selectedBusiness.id,business:{revision:1},selected,selection:selected?'current':'none',quests:selected?[selected]:[],total:selected?1:0,limit:20,offset:0}:null};
  }};
  const workspaceOverview = loadSource("src/components/console/console-workspace-overview.tsx", {
    "@/accounts/server":{loadAccountWorkspace:async()=>accounts},"./console-command":command,"@/components/guided/quest-kickoff":quest,"@/products/discovery-v2-data":{loadDiscoveryGoalData:async()=>({available:true})},
    "@/lib/core-ui/console-data":{...consoleData,loadConsoleObservationTime:async()=>observedAt,loadConsoleResearchQuote:async()=>({one:370395,two:530914,verifiedAt:fixtureTime})},
    "@/lib/core-ui/console-collections":{consoleObject:v=>!!v&&typeof v==='object'&&!Array.isArray(v)},"./console-shell":consoleShell,"./console-overview":overview,
    "./console-motion":motionUi,"@/lib/core-ui/console-motion":motion,"@/lib/core-ui/data":{EMPTY_COLLECTION:workflowCollection({runs:[],definitions:[],stages:[],events:[],interventions:[],tasks:[],workerRuns:[],workerDefinitions:[],artifacts:[],errors:[]}),loadWorkflowCollection:async()=>collection,loadCurrentQuestEpisode:async()=>({id:collection.runs[0]?.id??null,available:!unavailable})},
    "@/lib/core-ui/run-outcome-data":{loadRunCostData:async()=>costData},"@/browser/console-server":browserWire.server,"./console-workspace.css":{},
  });
  const { default: Page } = loadSource("src/app/dashboard/page.tsx", {
    "@/lib/core-ui/workspace-context":workspaceBoundary,"@/components/console/console-workspace-overview":workspaceOverview,
    "next/navigation": { notFound: () => { throw new Error("Fixture record was not found"); } },
    "@/components/console/console-shell": consoleShell, "@/components/console/console-overview": overview,
    "@/components/console/console-motion": motionUi, "@/lib/core-ui/console-motion": motion,
    "@/browser/console-view": browserView, "@/browser/console-server": browserWire.server,
    "@/components/console/console-command": command, "@/components/console/console-work-pane": work, "@/components/console/console-populated-dashboard": populated, "@/components/guided/quest-kickoff": quest,
    "@/components/console/console-library-dashboard": boundedLibrary,
    "@/components/guided/creative-library": library, "@/components/stage7/workflow-visuals": visuals,
    "@/lib/core-ui/data": { requireOwnerUiContext: async () => context, loadWorkflowCollection: async () => collection, loadWorkflowDetail: async (_context, id) => { assert.equal(id, run.id); return details; } },
    "@/lib/core-ui/run-outcome-data": { loadRunCostData: async () => costData },
    "@/lib/core-ui/console-data": { ...consoleData, loadConsoleObservationTime: async () => observedAt, loadConsoleResearchQuote: async () => ({ one: 370395, two: 530914, verifiedAt: fixtureTime }) },
    "@/accounts/server": { loadAccountWorkspace: async (_context, id) => { if (businessFlow) assert.equal(id, otherBusiness.id); return accounts; }, loadAccountSetupInterventions: async () => ({ records: [], unavailable: unavailable && !knownZero }) },
    "@/etsy-publication/server": { loadPublicationInterventions: async () => ({ records: [], unavailable }) },
    "@/printful/server": { loadPrintfulProductInterventions: async () => ({ records: [], unavailable }) },
    "@/creative/data": { loadCreativeWorkspace: async scoped => { reads.push("creative");
      if (businessFlow) assert.deepEqual(Array.from(scoped.businesses, item => item.id), [otherBusiness.id]);
      const data = creativeLibraryFixture();
      if (businessFlow) for (const key of ["approvals", "runs", "assets"]) data[key] = data[key].map(item => ({ ...item, business_id: otherBusiness.id }));
      return data;
    } },
    "@/products/data": { loadProductWorkspace: async () => { reads.push("products"); return products; } },
    "@/products/discovery-v2-data": { loadDiscoveryGoalData: async () => { reads.push("discovery"); return { available: true, records: [], errors: [] }; } },
    "@/components/stage13/discovery-goal-workspace": goalUi, "./accounts/account-workspace": accountUi,
    "./accounts/connection-feedback": accountFeedback, "@/accounts/connection-feedback": connectionFeedback,
    "@/components/console/console-compact-decisions": decisionsUi,
    "@/lib/core-ui/console-decisions-query": decisionQuery,
    "@/lib/core-ui/console-decisions-data": { loadConsoleDecisionPage: async (_context, options) => { const query = decisionQuery.consoleDecisionQuery(options); const items = collection.interventions.filter(item => decisionQuery.CONSOLE_DECISION_UUID.test(item.id) && decisionQuery.CONSOLE_DECISION_UUID.test(item.business_id) && (query.status === "all" || item.status === query.status)); return { query, page: { items, page: query.page, pageSize: 25, total: unavailable ? null : items.length, complete: !unavailable, hasPrevious: query.page > 1, hasNext: unavailable ? null : false }, selection: { status: "none", item: null }, runs: collection.runs, definitions: collection.definitions, detail: null, errors: unavailable ? ["Decision records could not be checked."] : [] }; } },
    "./terminal-review-actions": { acknowledgeTerminalCreativeReview: noAction },
    "./actions": { createBusiness: noAction, resumeSyntheticReview: noAction }, "./browser-actions": { resumeBrowserControl: noAction }, "./packs/actions": { acknowledgeEtsySimulation: noAction }, "./legacy-dashboard": noAction,
    "@/components/console/console-panes.css": {}, "./accounts/accounts.css": {}, "./products/products.css": {},
  });
  const query = { view, ...(detail ? { run: run.id } : {}),
    ...(!omitBusinessQuery && (detail || businessFlow) ? { business: mismatchedBusiness || businessFlow ? otherBusiness.id : business.id } : {}), ...(sheet ? { sheet: "research" } : {}), ...queryOverrides };
  let tree = await Page({ searchParams: Promise.resolve(query) });
  if (React.isValidElement(tree) && tree.type?.name === "ConsolePopulatedDashboard") tree = await tree.type(tree.props);
  if (React.isValidElement(tree) && tree.type?.name === "ConsoleLibraryDashboard") tree = await tree.type(tree.props);
  if (React.isValidElement(tree) && tree.type?.name === "ConsoleWorkspaceOverview") tree = await tree.type(tree.props);
  inspect?.(tree);
  reads.push(...browserWire.calls);
  return renderToStaticMarkup(tree);
}

function creativeLibraryFixture() {
  const hash = "a".repeat(64), briefHash = "b".repeat(64);
  const approval = { id: "fixture-approval", business_id: business.id, candidate_id: "fixture-candidate", purpose: "technical_qualification", maximum_microusd: 550000,
    approved_at: fixtureTime, expires_at: "2026-10-03T03:00:00.000Z", snapshot: { concept: "Synthetic mountain geometry", maximumGenerations: 1,
      printSpecification: { garment: "Synthetic fixture garment", placement: "large_front", designWidthInches: 6.5, designHeightInches: 6.5, background: "opaque" } } };
  const creativeRun = { id: "fixture-creative-run", business_id: business.id, workflow_run_id: run.id, approval_id: approval.id, productionReady: false };
  const preview = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="#102837"/><circle cx="740" cy="245" r="92" fill="#e9c379"/><path d="M90 790 385 285 670 790Z" fill="#5bb9c2"/><path d="m360 790 285-385 290 385Z" fill="#3b738c"/><text x="512" y="915" text-anchor="middle" font-family="sans-serif" font-size="32" fill="#c3dce8">SYNTHETIC UI FIXTURE</text></svg>');
  const asset = { id: "fixture-asset", business_id: business.id, creative_run_id: creativeRun.id, candidate_id: approval.candidate_id, version: 1, model: "Synthetic fixture", provider: "Offline test", generated_at: fixtureTime,
    signedUrl: preview, asset_hash: hash, brief_hash: briefHash, prompt: "A synthetic geometric mountain for a read-only UI fixture.",
    inspection: { sha256: hash, width: 1024, height: 1024, bytes: 24000, effectiveDpi: 157.5, colorSpace: "srgb", mediaType: "image/png", failedCriteria: [] } };
  return { approvals: [approval], runs: [creativeRun], assets: [asset], reviews: [], costs: [], costsAvailable: true, errors: [], retainedSources: [] };
}

export async function renderWorkflows({ ended = false, mismatchedTask = false } = {}) {
  const { shell, visuals } = components();
  const workingRun = { ...run, status: ended ? "needs_owner" : "running", current_stage_key: "worker-task", completed_at: ended ? fixtureTime : null };
  const workerDefinition = { id: "fixture-worker-definition", worker_key: "fixture.research", version: "1.0.0", name: "Evidence research specialist", role: "research", status: "qualified" };
  const workingStage = { ...stages[1], status: "running", completed_at: null };
  const task = {
    id: "fixture-task", business_id: business.id, workflow_run_id: run.id, workflow_stage_run_id: workingStage.id,
    worker_definition_id: workerDefinition.id, status: "running", objective: "Compare independent source evidence",
    input_artifact_ids: [], permitted_capabilities: [], required_knowledge: [], completion_criteria: [], failure_criteria: [], non_goals: [], escalation_rules: [],
    created_at: run.created_at, updated_at: run.updated_at,
  };
  const workerRun = {
    id: "fixture-worker-run", business_id: business.id, workflow_run_id: run.id, task_contract_id: mismatchedTask ? "different-task" : task.id,
    worker_definition_id: workerDefinition.id, status: "running", output: {}, failure: {}, execution_metadata: {},
    started_at: run.started_at, completed_at: null, created_at: run.created_at, updated_at: run.updated_at,
  };
  const collection = workflowCollection({ runs: [workingRun], stages: [stages[0], workingStage], interventions: [], events: [],
    tasks: [task], workerRuns: [workerRun], workerDefinitions: [workerDefinition] });
  return renderToStaticMarkup(React.createElement(shell.AppShell, { active: 'workflows', context: ownerContext() }, React.createElement(visuals.WorkflowListCard, { run: workingRun, definition, business, stages: collection.stages, task, workerRun, workerDefinition, events: [], artifactCount: 0 })));

}

export function renderDecisions() {
  const { shell, visuals } = components();
  const entries = [
    intervention,
    { ...intervention, id: "fixture-publication", workflow_run_id: null, intervention_type: "etsy.publication.reconcile", title: "Check an uncertain listing outcome", description: "Inspect the existing listing and saved provider receipts before any further action." },
    { ...intervention, id: "fixture-printful", workflow_run_id: null, intervention_type: "printful.product.reconcile", title: "Review partial product association", description: "A provider response is incomplete. Existing files and product records need verification." },
    { ...intervention, id: "fixture-simulation", intervention_type: "etsy_simulation_review", title: "Review the simulated result" },
  ];
  return renderToStaticMarkup(React.createElement(shell.AppShell, { active: "needs-you", context: ownerContext({ needsYouCount: entries.length }) },
    React.createElement(shell.PageHeader, { eyebrow: "Owner decisions", title: "Decisions", description: "Understand what is waiting and what each action changes." }),
    React.createElement("section", { className: "needsYouStack", "aria-label": "Open decisions" }, entries.map(entry => React.createElement(visuals.NeedsYouCard, { key: entry.id, intervention: entry, businessName: business.name, workflowName: definition.name, returnTo: "/dashboard/needs-you" }))),
  ));
}

export function renderTimelines() {
  const { shell, visuals } = components();
  const creativeDefinition = { ...definition, id: "fixture-creative-definition", workflow_key: "etsy.creative-pipeline", name: "Creative design" };
  const creativeRun = { ...run, workflow_definition_id: creativeDefinition.id, current_stage_key: "generate:1", completed_at: fixtureTime };
  const creativeStages = [
    { ...stages[0], stage_key: "brief:1" }, { ...stages[1], stage_key: "screen:1", attempt: 1 },
    { ...stages[2], stage_key: "generate:1", status: "failed" },
  ];
  const cases = [
    { title: "Waiting for a decision", run, stages },
    { title: "Missing stage records", run, stages: [] },
    { title: "Stopped after a failed worker", run: { ...run, status: "failed", current_stage_key: "worker-task" }, stages: [{ ...stages[0] }, { ...stages[1], status: "failed" }] },
    { title: "All stages recorded complete", run: { ...run, status: "completed", current_stage_key: "complete" }, stages: definition.stage_definition.stages.map((stage, sequence) => ({ ...stages[0], id: `complete-${sequence}`, stage_key: stage.key, sequence, status: "completed" })) },
  ];
  return renderToStaticMarkup(React.createElement(shell.AppShell, { active: "workflows", context: ownerContext() },
    React.createElement(shell.PageHeader, { eyebrow: "Workflow progress", title: "Timeline states", description: "Saved stage evidence determines progress." }),
    ...cases.map(entry => React.createElement("section", { className: "dashboardSection", key: entry.title, "aria-label": entry.title },
      React.createElement("h2", null, entry.title), React.createElement(visuals.WorkflowTimeline, { definition, run: entry.run, stages: entry.stages }),
    )),
    React.createElement("section", { className: "dashboardSection", "aria-label": "Stopped creative run" },
      React.createElement("h2", null, "Stopped creative run"),
      React.createElement(visuals.WorkflowTimeline, { definition: creativeDefinition, run: creativeRun, stages: creativeStages }),
      React.createElement(visuals.ExecutionSnapshot, { definition: creativeDefinition, run: creativeRun, stages: creativeStages, event: null,
        intervention: { ...intervention, intervention_type: "creative_review", title: "Review the generation evidence" }, task: null, workerRun: null, workerDefinition: null }),
    ),
  ));
}

export async function renderCreative({ businessFlow = false } = {}) {
  const { shell, icons } = components();
  const otherBusiness = { ...business, id: "00000000-0000-4000-8000-000000000911", name: "Other authorized Business" };
  const creativeContext = ownerContext({ businesses: businessFlow ? [business, otherBusiness] : [business] });
  const productTypes = loadSource("src/products/types.ts");
  const productHistory = loadSource("src/products/history.ts", { "./types": productTypes });
  const { ProductSubmitButton } = loadSource("src/components/stage13/products-workspace.tsx", {
    "@/app/dashboard/products/actions": { reconcileProductDiscovery: noAction, recordProductAssessment: noAction, reconsiderProductCandidate: noAction, startProductResearch: noAction },
    "@/components/stage7/icons": icons, "@/products/types": productTypes, "@/products/history": productHistory, "@/app/dashboard/products/products.css": {},
  });
  const { default: Page } = loadSource("src/app/dashboard/artifacts/page.tsx", {
    "@/components/console/console-retained-workspace": retainedFixture({panel:"technical"},"/dashboard/artifacts"),
    "@/components/stage7/app-shell": shell, "@/components/stage13/products-workspace": { ProductSubmitButton },
    "@/components/guided/creative-library": loadSource("src/components/guided/creative-library.tsx", { "@/creative/cost-display": loadSource("src/creative/cost-display.ts"), "./creative-library.css": {} }),
    "next/navigation": { notFound: () => { throw new Error("Fixture Business was not found"); } },
    "@/creative/data": { loadCreativeWorkspace: async () => ({ approvals: [], runs: [], assets: [], reviews: [], costs: [], costsAvailable: true, errors: [] }), loadProductionCandidates: async () => ({ candidates: [], errors: [] }) },
    "@/creative/cost-display": loadSource("src/creative/cost-display.ts"),
    "@/creative/proposal": { FLUX_KLEIN_PROVIDER_TERMS: ["https://example.invalid/developer-terms", "https://example.invalid/api-terms"], TECHNICAL_PRINT_SPECIFICATION: { sourceUrl: "https://example.invalid/specification", verifiedAt: fixtureTime } },
    "@/creative/image-provider": { FLUX_KLEIN_PNG_POLICY: { modelId: "black-forest-labs/flux.2-klein-4b" } },
    "@/creative/types": loadSource("src/creative/types.ts"), "@/lib/core-ui/data": { requireOwnerUiContext: async () => creativeContext },
    "./actions": { approveCreativeCandidate: noAction, approveProductionCreativeCandidate: noAction, closeExpiredCreativeRun: noAction, startCreativeRun: noAction }, "./artifacts.css": {},
  });
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(businessFlow ? { business: otherBusiness.id } : {}) }));
}

export const researchGoal = "Compare supported starting markets for original nature T-shirts and preserve the evidence for review.";
export function renderWorkContext({ mismatched = false } = {}) {
  const { shell, workflows, visuals } = components();
  const { WorkContext, researchGoalFromRecords } = loadSource("src/components/guided/work-context.tsx", { "@/lib/core-ui/workflows": workflows, "./work-context.css": {} });
  const researchDefinition = { ...definition, workflow_key: "product.discovery-v2.geographic", name: "Geographic research" };
  const researchRun = { ...run, input: { intentId: "fixture-research-intent" } };
  const experiment = { id: researchRun.input.intentId, business_id: business.id, workflow_run_id: mismatched ? "different-workflow" : researchRun.id,
    discovery_version: "pod-discovery-2.0", variables: { intent: { version: "pod-discovery-2.0", objective: researchGoal } } };
  const goal = researchGoalFromRecords(researchRun, [experiment], []);
  return renderToStaticMarkup(React.createElement(shell.AppShell, { active: "workflows", context: ownerContext(), workflowRunId: run.id },
    React.createElement(shell.PageHeader, { eyebrow: "Work", title: "Market research", description: "Review the saved goal and each separately approved next step." }),
    React.createElement(WorkContext, { run: researchRun, definition: researchDefinition, goal }),
    React.createElement(visuals.WorkflowTimeline, { definition: researchDefinition, run: researchRun, stages }),
  ));
}

export function renderUnknownNavigation() {
  const { shell } = components();
  return renderToStaticMarkup(React.createElement(shell.AppShell, { active: "needs-you", context: ownerContext({ needsYouCount: 0, needsYouUnavailable: true, businessesUnavailable: true, businesses: [] }) },
    React.createElement(shell.PageHeader, { eyebrow: "Owner workspace", title: "Check your workspace", description: "Missing records do not mean there are no decisions or businesses." }),
    React.createElement("p", { className: "coreNotice", role: "alert" }, "Decision and Business records are unavailable. Refresh before starting more work."),
  ));
}

export async function renderProducts() {
  const { shell, icons } = components();
  const productTypes = loadSource("src/products/types.ts");
  const productHistory = loadSource("src/products/history.ts", { "./types": productTypes });
  const products = loadSource("src/components/stage13/products-workspace.tsx", {
    "@/app/dashboard/products/actions": { reconcileProductDiscovery: noAction, recordProductAssessment: noAction, reconsiderProductCandidate: noAction, startProductResearch: noAction },
    "@/components/stage7/icons": icons, "@/products/types": productTypes, "@/products/history": productHistory, "@/app/dashboard/products/products.css": {},
  });
  const sources = loadSource("src/research/sources.ts");
  const discovery = loadSource("src/products/discovery-v2.ts", {
    "./types": productTypes, "../research/sources": sources,
    "./discovery": { validateProductEvidence: noAction }, "./discovery-v2-knowledge": { validateDiscoveryKnowledgeV2: noAction },
  });
  const goal = loadSource("src/products/discovery-v2-goal.ts", { "./discovery-v2": discovery });
  const quoteModels = [];
  const budget = loadSource("src/products/discovery-v2-budget.ts", {
    "../creative/budget": { fetchCreativeModelQuote: async modelId => {
      quoteModels.push(modelId);
      return { modelId, verifiedAt: fixtureTime, source: "https://openrouter.ai/api/v1/models", inputPerMillion: modelId.includes("haiku") ? 1 : .4,
        cacheWritePerMillion: modelId.includes("haiku") ? 2 : .5, outputPerMillion: modelId.includes("haiku") ? 5 : 1.8 };
    } },
    "../models/openrouter": { OpenRouterAdapter: class { constructor() { noAction(); } } },
    "../models/types": loadSource("src/models/types.ts"), "../research/sources": sources, "../workers/schema-validator": loadSource("src/workers/schema-validator.ts"),
  });
  const actions = { startGeographicDiscovery: noAction, refreshGeographicDiscovery: noAction, approveGeographicResearchFunding: noAction, continueGeographicDiscoveryAnalysis: noAction };
  const goalWorkspace = loadSource("src/components/stage13/discovery-goal-workspace.tsx", {
    "./products-workspace": products, "@/app/dashboard/products/discovery-actions": actions, "@/products/discovery-v2-goal": goal,
  });
  const quest = loadSource("src/components/guided/quest-kickoff.tsx", {
    "@/app/dashboard/products/discovery-actions": actions, "@/lib/core-ui/quest-draft": loadSource("src/lib/core-ui/quest-draft.ts"), "./quest-kickoff.css": {},
  });
  // These are auth-scoped synthetic database results. Essential intent validation,
  // finite quote arithmetic, production wizard and scope copy are all real code.
  const data = { candidates: [], experiments: [], decisions: [], errors: [] };
  const context = ownerContext({ businesses: [{ ...business, id: "00000000-0000-4000-8000-000000000901" }] });
  const { default: Page } = loadSource("src/app/dashboard/products/page.tsx", {
    "@/components/guided/quest-kickoff": quest, "@/components/guided/work-context.css": {},
    "@/components/stage7/app-shell": shell, "@/components/stage7/icons": icons, "@/components/stage13/products-workspace": products,
    "next/navigation": { notFound: () => { throw new Error("Fixture Business was not found"); } },
    "@/lib/core-ui/data": { requireOwnerUiContext: async () => context }, "@/products/data": { loadProductWorkspace: async () => data },
    "@/products/history": productHistory, "@/components/stage13/discovery-goal-workspace": goalWorkspace,
    "@/products/discovery-v2-data": { loadDiscoveryGoalData: async () => ({ available: true, analysisAvailable: true, records: [], errors: [] }) },
    "@/products/discovery-v2-goal": goal, "@/products/discovery-v2-budget": budget, "./actions": { createProductCandidate: noAction }, "./products.css": {},
  });
  const markup = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
  assert.deepEqual(quoteModels.sort(), ["anthropic/claude-haiku-4.5", "openai/gpt-5.6-luna"]);
  assert.doesNotMatch(markup, /Current provider prices are unavailable/);
  return markup;
}

export const fixtureRenderers = {
  dashboard: () => renderDashboard(), "dashboard-unavailable": () => renderDashboard({ unavailable: true }), "dashboard-empty": () => renderDashboard({ empty: true }),
  "console-work": () => renderDashboard({ view: "work" }), "console-run": () => renderDashboard({ view: "work", detail: true }),
  "console-library": () => renderDashboard({ view: "library" }), "console-decisions": () => renderDashboard({ view: "decisions" }),
  "console-connections": () => renderDashboard({ view: "connections" }), "console-activity": () => renderDashboard({ view: "activity" }),
  "console-advanced": () => renderDashboard({ view: "advanced" }),
  timelines: renderTimelines, creative: renderCreative, "navigation-unavailable": renderUnknownNavigation, "work-context": renderWorkContext, products: renderProducts,
};

export function fixtureDocument(markup, { creative = false, products = false } = {}) {
  // Match RootLayout's cascade exactly; creative imports Products' button styles.
  const styles = ["src/app/globals.css", "src/app/stage1.css", "src/app/stage3.css", "src/app/stage7.css", "src/app/stage7-mobile.css", "src/app/stage8.css", "src/components/guided/work-context.css", "src/components/guided/creative-library.css", "src/components/guided/run-outcome.css",
    "src/components/console/console-shell.css", "src/components/console/console-overview.css", "src/components/console/console-browser-centre.css", "src/components/console/console-command.css", "src/components/console/console-motion.css", "src/components/console/console-panes.css", "src/components/console/console-compact-decisions.css", "src/components/console/console-collection-panes.css", "src/components/console/console-library-pane.css",
    "src/app/dashboard/accounts/accounts.css", "src/app/dashboard/products/products.css",
    ...(creative || products ? ["src/app/dashboard/products/products.css"] : []),
    ...(creative ? ["src/app/dashboard/artifacts/artifacts.css"] : []), ...(products ? ["src/components/guided/quest-kickoff.css"] : []),
  ].map(file => readFileSync(path.join(root, file), "utf8")).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Agent Labs synthetic owner UI fixture</title><style>${styles}</style></head><body>${markup}</body></html>`;
}
