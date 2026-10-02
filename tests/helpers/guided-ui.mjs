import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import path from "node:path";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const root = fileURLToPath(new URL("../../", import.meta.url));
export const fixtureTime = "2026-10-02T03:00:00.000Z";
const noAction = () => { throw new Error("Read-only fixture actions must never execute"); };
const Link = ({ children, ...props }) => React.createElement("a", props, children);
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
  runInNewContext(`(function(require,module,exports){${code}\n})`, { Date: FixtureDate, crypto, Buffer, URL, structuredClone, process: { env: { AGENTLABS_GUIDED_UI: "guided", NODE_ENV: "test" } } })(name => {
    if (name === "react/jsx-runtime") return require(name);
    if (name === "react") return React;
    if (name === "react-dom") return require(name);
    if (name === "node:crypto") return crypto;
    if (name === "next/link") return Link;
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected guided UI dependency in ${file}: ${name}`);
    return dependencies[name];
  }, fixtureModule, fixtureModule.exports);
  return fixtureModule.exports;
}

export const business = { id: "fixture-business", name: "North Star Design Studio", created_at: fixtureTime, updated_at: fixtureTime };
export const definition = {
  id: "fixture-definition", workflow_key: "synthetic.core.runtime-proof", version: "1.0.0", name: "Original product research",
  description: "Research evidence, review the saved result, and decide the next step.", status: "qualified",
  stage_definition: { stages: [
    { key: "start", type: "system", sequence: 0 }, { key: "worker-task", type: "worker", sequence: 1 },
    { key: "wait", type: "wait", sequence: 2 }, { key: "review", type: "review", sequence: 3 }, { key: "complete", type: "terminal", sequence: 4 },
  ] },
};
export const run = {
  id: "fixture-workflow", business_id: business.id, workflow_definition_id: definition.id, status: "needs_owner", current_stage_key: "review",
  input: {}, state: {}, runtime_provider: "vercel_workflow", runtime_run_id: "fixture-runtime", started_at: "2026-10-02T02:45:00.000Z",
  completed_at: null, created_at: "2026-10-02T02:45:00.000Z", updated_at: "2026-10-02T02:58:00.000Z",
};
export const intervention = {
  id: "fixture-intervention", business_id: business.id, workflow_run_id: run.id, intervention_type: "review", status: "open",
  title: "Review the saved research result", description: "The bounded workflow has paused. Review the evidence before making your decision.",
  options: {}, resolution: {}, requested_at: "2026-10-02T02:58:00.000Z", resolved_at: null,
  created_at: "2026-10-02T02:58:00.000Z", updated_at: "2026-10-02T02:58:00.000Z",
};
export const stages = ["start", "worker-task", "wait", "review"].map((stage_key, sequence) => ({
  id: `fixture-stage-${sequence}`, workflow_run_id: run.id, stage_key, sequence, attempt: stage_key === "worker-task" ? 2 : 1,
  status: stage_key === "review" ? "needs_owner" : "completed", input: {}, output: {}, failure: {},
  started_at: run.started_at, completed_at: stage_key === "review" ? null : run.updated_at, created_at: run.created_at, updated_at: run.updated_at,
}));
const event = {
  id: "fixture-event", business_id: business.id, workflow_run_id: run.id, event_type: "workflow.owner_intervention.requested",
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
export function components() {
  const workflows = loadSource("src/lib/core-ui/workflows.ts");
  const icons = loadSource("src/components/stage7/icons.tsx");
  const live = loadSource("src/components/stage7/live-refresh.tsx", {
    "next/navigation": { useRouter: () => ({ refresh: noAction }) }, "@/lib/supabase/client": { createClient: noAction },
  });
  const guided = loadSource("src/components/guided/guided-shell.tsx", {
    "@/components/stage7/icons": icons, "@/components/stage7/live-refresh": live, "./guided-shell.css": {},
  });
  const shell = loadSource("src/components/stage7/app-shell.tsx", { "./icons": icons, "./live-refresh": live, "@/lib/core-ui/workflows": workflows, "@/components/guided/guided-shell": guided });
  const visuals = loadSource("src/components/stage7/workflow-visuals.tsx", {
    "@/app/dashboard/actions": { resumeSyntheticReview: noAction }, "@/app/dashboard/packs/actions": { acknowledgeEtsySimulation: noAction },
    "@/app/dashboard/browser-actions": { resumeBrowserControl: noAction }, "@/lib/core-ui/workflows": workflows,
    "./icons": icons, "./app-shell": shell,
  });
  return { workflows, icons, live, shell, visuals };
}

export async function renderDashboard({ unavailable = false, empty = false } = {}) {
  const { shell, visuals, icons, workflows } = components();
  const context = ownerContext({ needsYouCount: unavailable || empty ? 0 : 1, needsYouUnavailable: unavailable });
  const collection = unavailable || empty ? workflowCollection({ runs: [], definitions: [], stages: [], events: [], interventions: [], errors: unavailable ? ["Synthetic workflow read unavailable"] : [] }) : workflowCollection();
  const { default: Page } = loadSource("src/app/dashboard/page.tsx", {
    "@/components/stage7/app-shell": shell, "@/components/stage7/workflow-visuals": visuals, "@/components/stage7/icons": icons,
    "@/lib/core-ui/data": { requireOwnerUiContext: async () => context, loadWorkflowCollection: async () => collection },
    "@/lib/core-ui/workflows": workflows, "@/lib/supabase/env": { isSupabaseAdminConfigured: () => true },
    "./actions": { createBusiness: noAction, startSyntheticWorkflow: noAction },
  });
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
}

export async function renderWorkflows({ ended = false, mismatchedTask = false } = {}) {
  const { shell, visuals, workflows } = components();
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
  const { default: Page } = loadSource("src/app/dashboard/workflows/page.tsx", {
    "@/components/stage7/app-shell": shell, "@/components/stage7/workflow-visuals": visuals, "@/lib/core-ui/workflows": workflows,
    "@/lib/core-ui/data": { requireOwnerUiContext: async () => ownerContext({ needsYouCount: 0 }), loadWorkflowCollection: async () => collection },
  });
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
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

export async function renderCreative() {
  const { shell, icons } = components();
  const productTypes = loadSource("src/products/types.ts");
  const productHistory = loadSource("src/products/history.ts", { "./types": productTypes });
  const { ProductSubmitButton } = loadSource("src/components/stage13/products-workspace.tsx", {
    "@/app/dashboard/products/actions": { reconcileProductDiscovery: noAction, recordProductAssessment: noAction, reconsiderProductCandidate: noAction, startProductResearch: noAction },
    "@/components/stage7/icons": icons, "@/products/types": productTypes, "@/products/history": productHistory, "@/app/dashboard/products/products.css": {},
  });
  const { default: Page } = loadSource("src/app/dashboard/artifacts/page.tsx", {
    "@/components/stage7/app-shell": shell, "@/components/stage13/products-workspace": { ProductSubmitButton },
    "next/navigation": { notFound: () => { throw new Error("Fixture Business was not found"); } },
    "@/creative/data": { loadCreativeWorkspace: async () => ({ approvals: [], runs: [], assets: [], reviews: [], costs: [], costsAvailable: true, errors: [] }), loadProductionCandidates: async () => ({ candidates: [], errors: [] }) },
    "@/creative/cost-display": loadSource("src/creative/cost-display.ts"),
    "@/creative/proposal": { FLUX_KLEIN_PROVIDER_TERMS: ["https://example.invalid/developer-terms", "https://example.invalid/api-terms"], TECHNICAL_PRINT_SPECIFICATION: { sourceUrl: "https://example.invalid/specification", verifiedAt: fixtureTime } },
    "@/creative/image-provider": { FLUX_KLEIN_PNG_POLICY: { modelId: "black-forest-labs/flux.2-klein-4b" } },
    "@/creative/types": loadSource("src/creative/types.ts"), "@/lib/core-ui/data": { requireOwnerUiContext: async () => ownerContext() },
    "./actions": { approveCreativeCandidate: noAction, approveProductionCreativeCandidate: noAction, closeExpiredCreativeRun: noAction, startCreativeRun: noAction }, "./artifacts.css": {},
  });
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
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
  dashboard: () => renderDashboard(), "dashboard-unavailable": () => renderDashboard({ unavailable: true }),
  "dashboard-empty": () => renderDashboard({ empty: true }), workflows: () => renderWorkflows(), decisions: renderDecisions, timelines: renderTimelines, creative: renderCreative, "navigation-unavailable": renderUnknownNavigation, "work-context": renderWorkContext, products: renderProducts,
};

export function fixtureDocument(markup, { creative = false, products = false } = {}) {
  // Match RootLayout's cascade exactly; creative imports Products' button styles.
  const styles = ["src/app/globals.css", "src/app/stage1.css", "src/app/stage3.css", "src/app/stage7.css", "src/app/stage7-mobile.css", "src/app/stage8.css", "src/components/guided/work-context.css", "src/components/guided/guided-shell.css",
    ...(creative || products ? ["src/app/dashboard/products/products.css"] : []),
    ...(creative ? ["src/app/dashboard/artifacts/artifacts.css"] : []), ...(products ? ["src/components/guided/quest-kickoff.css"] : []),
  ].map(file => readFileSync(path.join(root, file), "utf8")).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Agent Labs synthetic owner UI fixture</title><style>${styles}</style></head><body>${markup}</body></html>`;
}
