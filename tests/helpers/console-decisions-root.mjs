import assert from 'node:assert/strict';
import { renderToString } from 'react-dom/server';
import { components, findFixtureElement, loadSource } from './guided-ui.mjs';
import { api, businessId, businesses, component, costLoader, fixtureTables, id, origin, owner, query, terminal, time, wire, workflows } from './console-decisions.mjs';

export { businessId, businesses, fixtureTables, id, origin, owner, time };
export const secondOwner = id(901);
export const acknowledgedAt = '2026-10-02T09:10:20.654321+00:00';
export function decisionRoute(notice, extra = '') {
  return `/dashboard?view=decisions&business=${notice.business_id}&decision=${notice.id}${extra}`;
}
const deny = () => { throw Error('Unrelated action, provider, storage or network access denied'); };
const plain = value => JSON.parse(JSON.stringify(value));
export function queryFromRoute(route) {
  const values = new URL(route, origin).searchParams;
  return Object.fromEntries([...new Set(values.keys())].map(key => [key, values.getAll(key).length > 1 ? values.getAll(key) : values.get(key)]));
}
export function formFor(notice, returnTo = decisionRoute(notice)) {
  const form = new FormData();
  form.set('interventionId', notice.id); form.set('expectedUpdatedAt', notice.updated_at); form.set('returnTo', returnTo);
  form.set('businessId', notice.business_id); form.set('workflowRunId', notice.workflow_run_id); form.set('decision', 'acknowledge');
  return form;
}

/** Executes the actual DashboardPage, reader and server action against inert owner-session fixtures.
 * The one permitted RPC is an in-memory test double, never a DB/provider request. */
export function rootDecisionFixture({ tables = fixtureTables({ count: 131 }), userId = owner, ownedBusinesses = businesses,
  session = true, rpcMode = 'success', readOptions = {}, collectionLimit = 80, accountRequests = { records: [], unavailable: false } } = {}) {
  const reads = [], rpcCalls = [], revalidated = [], pageReads = [], mutations = [], hookCalls = [];
  const events = tables.workflow_runs.map((run, index) => ({ id: id(9000 + index), business_id: run.business_id, workflow_run_id: run.id,
    event_type: 'creative.run.needs_owner', actor_type: 'system', actor_id: null, payload: { failure: 'Saved creative generation failed', stageKey: run.current_stage_key }, occurred_at: time, created_at: time }));
  const h = wire({ ...tables, businesses: ownedBusinesses.map(business => ({ ...business, owner_user_id: userId })) }, readOptions);
  const owned = () => new Set(ownedBusinesses.map(business => business.id));
  let mode = rpcMode;
  function context() {
    return { ...h.context, userId, businesses: ownedBusinesses, supabase,
      needsYouCount: tables.owner_interventions.filter(row => row.status === 'open' && owned().has(row.business_id)).length,
      needsYouUnavailable: false, businessesUnavailable: false };
  }
  const supabase = { ...h.context.supabase,
    from(table) {
      const builder = h.context.supabase.from(table);
      builder.maybeSingle = async () => {
        const result = await builder;
        const visible = (result.data ?? []).filter(row => !row.business_id || owned().has(row.business_id));
        return { ...result, data: visible.length === 1 ? visible[0] : null, error: result.error ?? (visible.length > 1 ? { message: 'Ambiguous fixture selection' } : null) };
      };
      return builder;
    },
    auth: { getClaims: async () => session ? { error: null, data: { claims: { sub: userId } } } : { error: { message: 'No fixture owner session' }, data: null } },
    async rpc(name, args) {
      if (name === 'record_etsy_simulation_decision') {
        rpcCalls.push({ name, args: plain(args), userId });
        const notice = tables.owner_interventions.find(row => row.id === args.p_intervention_id && owned().has(row.business_id));
        if (!notice || notice.status !== 'open' || notice.intervention_type !== 'etsy_simulation_review' || mode === 'typed-error') return { error: { message: 'PRIVATE_SIMULATION_DENIAL' }, data: null };
        return { error: null, data: { workflowRunId: notice.workflow_run_id, shouldResume: true,
          decision: { decision: args.p_decision, ownerUserId: userId, decidedAt: acknowledgedAt } } };
      }
      assert.equal(name, 'acknowledge_terminal_creative_review', 'All other RPCs are forbidden');
      assert.deepEqual(Object.keys(args).sort(), ['p_expected_updated_at', 'p_intervention_id']);
      rpcCalls.push({ name, args: plain(args), userId });
      if (mode === 'transport') throw Error('PRIVATE_TRANSPORT_FAILURE');
      if (mode === 'error') return { data: null, error: { message: 'PRIVATE_DATABASE_FAILURE' } };
      if (mode === 'uncertain') return { data: null, error: null };
      if (mode === 'conflict') return { data: null, error: { message: 'terminal_review_conflict' } };
      const notice = tables.owner_interventions.find(row => row.id === args.p_intervention_id);
      if (!notice || !owned().has(notice.business_id)) return { data: null, error: { code: '42501', message: 'PRIVATE_FOREIGN_NOTICE' } };
      const run = tables.workflow_runs.find(row => row.id === notice.workflow_run_id && row.business_id === notice.business_id);
      const creativeRun = tables.creative_runs.find(row => row.workflow_run_id === run?.id && row.business_id === notice.business_id);
      const result = outcome => ({ data: { outcome, interventionId: notice.id, businessId: notice.business_id, workflowRunId: run?.id }, error: null });
      if (run && creativeRun && terminal.isTerminalCreativeReviewAcknowledgement({ intervention: notice, run, creativeRunId: creativeRun.id, ownerUserId: userId })) {
        const event = events.find(row => row.event_type === 'owner_intervention.resolved' && row.payload.interventionId === notice.id);
        if (notice.resolution.expectedUpdatedAt !== args.p_expected_updated_at || !event || JSON.stringify(event.payload) !== JSON.stringify(notice.resolution)) return { data: null, error: { message: 'terminal_review_conflict' } };
        return result('already_acknowledged');
      }
      if (notice.updated_at !== args.p_expected_updated_at) return { data: null, error: { message: 'terminal_review_conflict' } };
      const definition = tables.workflow_definitions.find(row => row.id === run?.workflow_definition_id);
      if (!run || !creativeRun || !terminal.canAcknowledgeTerminalCreativeReview({ intervention: notice, run, definition, creativeRun,
        expectedNoticeId: notice.id, complete: true, stages: tables.workflow_stage_runs.filter(row => row.workflow_run_id === run.id),
        workers: tables.worker_runs.filter(row => row.workflow_run_id === run.id), tasks: tables.task_contracts.filter(row => row.workflow_run_id === run.id), actionIntents: tables.action_intents.filter(row => row.workflow_run_id === run.id) })) return { data: null, error: { message: 'terminal_review_not_eligible' } };
      const before = plain(notice);
      notice.status = 'resolved'; notice.resolved_at = acknowledgedAt; notice.updated_at = acknowledgedAt;
      notice.resolution = { version: terminal.TERMINAL_CREATIVE_REVIEW_VERSION, decision: 'acknowledge', actorUserId: userId,
        businessId: notice.business_id, workflowRunId: run.id, creativeRunId: creativeRun.id, interventionId: notice.id,
        acknowledgedAt, expectedUpdatedAt: args.p_expected_updated_at, executionResumed: false, newSpendAuthorized: false, costsReconciled: false };
      mutations.push({ table: 'owner_interventions', id: notice.id, before, after: plain(notice) });
      events.push({ id: id(19000 + mutations.length), business_id: notice.business_id, workflow_run_id: run.id,
        event_type: 'owner_intervention.resolved', actor_type: 'owner', actor_id: userId, payload: plain(notice.resolution), occurred_at: acknowledgedAt, created_at: acknowledgedAt });
      if (mode === 'committed-uncertain') return { data: null, error: null };
      return result('acknowledged');
    },
  };
  const action = loadSource('src/app/dashboard/terminal-review-actions.ts', {
    'next/cache': { revalidatePath: route => revalidated.push(route) },
    'next/navigation': { redirect: route => { const error = Error('Synthetic server redirect'); error.location = route; throw error; } },
    '@/lib/supabase/server': { createClient: async () => supabase }, '@/lib/core-ui/console-decisions-query': query, '@/creative/terminal-review': terminal,
  }).acknowledgeTerminalCreativeReview;
  async function perform(form, selectedAction = action) {
    try { await selectedAction(form); assert.fail('The real action must redirect'); }
    catch (error) { if (typeof error.location === 'string') return error.location; throw error; }
  }
  const redirect = route => { const error = Error('Synthetic server redirect'); error.location = route; throw error; };
  const runtime = { start: deny, resumeHook: async (token, payload) => {
    hookCalls.push({ token, payload: plain(payload) });
    if (mode === 'typed-error') throw Error('PRIVATE_HOOK_FAILURE');
  } };
  const commonActionDependencies = { 'next/cache': { revalidatePath: route => revalidated.push(route) }, 'next/navigation': { redirect },
    'workflow/api': runtime, '@/lib/supabase/server': { createClient: async () => supabase }, '@/lib/core-ui/console-decisions-query': query };
  const synthetic = loadSource('src/app/dashboard/actions.ts', { ...commonActionDependencies,
    '@/lib/core-ui/workflows': workflows, '@/lib/supabase/env': { isSupabaseAdminConfigured: deny },
    '@/workflows/synthetic-runtime': { syntheticReviewHookToken: runId => `fixture:synthetic:${runId}` }, '@/workflows/registry': { getRegisteredWorkflow: deny },
  }).resumeSyntheticReview;
  const browser = loadSource('src/app/dashboard/browser-actions.ts', { ...commonActionDependencies,
    '@/browser/registry': { isDefaultBrowserProviderConfigured: deny }, '@/workflows/registry': { getRegisteredWorkflow: deny },
    '@/workflows/browser-provider-runtime': { browserTakeControlHookToken: runId => `fixture:browser-take:${runId}`, browserReturnControlHookToken: runId => `fixture:browser-return:${runId}` },
  }).resumeBrowserControl;
  const simulation = loadSource('src/app/dashboard/packs/actions.ts', { ...commonActionDependencies,
    '@/lib/core-ui/data': { requireOwnerUiContext: async () => context() }, '@/packs/dependencies': {}, '@/packs/registry': {}, '@/workers/schema-validator': {},
    '@/workflows/installed-pack-runtime': {}, '@/workflows/etsy-discovery-simulation-runtime': { etsySimulationReviewHookToken: runId => `fixture:simulation:${runId}` },
  }).acknowledgeEtsySimulation;
  function collectionFor(runId) {
    const all = tables.workflow_runs.filter(row => owned().has(row.business_id)).toSorted((a, b) => b.created_at.localeCompare(a.created_at));
    const runs = runId ? all.filter(row => row.id === runId) : all.slice(0, collectionLimit), ids = new Set(runs.map(run => run.id));
    return { runs, definitions: tables.workflow_definitions, stages: tables.workflow_stage_runs.filter(row => ids.has(row.workflow_run_id)),
      interventions: tables.owner_interventions.filter(row => ids.has(row.workflow_run_id)), events: events.filter(row => ids.has(row.workflow_run_id)),
      tasks: tables.task_contracts.filter(row => ids.has(row.workflow_run_id)), workerRuns: tables.worker_runs.filter(row => ids.has(row.workflow_run_id)),
      artifacts: tables.artifacts.filter(row => ids.has(row.workflow_run_id)).map(row => ({ ...row, updated_at: row.updated_at ?? row.created_at })), workerDefinitions: [], errors: [], truncated: !runId && all.length > collectionLimit, runCount: all.length };
  }
  async function render(route = '/dashboard?view=decisions') {
    const current = context(), parts = components();
    const { shell, visuals, icons, workflows, consoleShell, motion, motionUi, browserView, browserUi } = parts;
    const questDraft = loadSource('src/lib/core-ui/quest-draft.ts');
    const command = loadSource('src/components/console/console-command.tsx', { 'next/navigation': { useRouter: () => ({ push: deny }) }, '@/lib/core-ui/quest-draft': questDraft, './console-command.css': {} });
    const overview = loadSource('src/components/console/console-overview.tsx', { '@/components/stage7/icons': icons, '@/lib/core-ui/workflows': workflows, './console-browser-centre': browserUi, './console-overview.css': {} });
    const outcome = loadSource('src/lib/core-ui/run-outcome.ts', { './workflows': workflows });
    const outcomeUi = loadSource('src/components/guided/run-outcome.tsx', { '@/lib/core-ui/run-outcome': outcome, './run-outcome.css': {} });
    const workContext = loadSource('src/components/guided/work-context.tsx', { '@/lib/core-ui/workflows': workflows, './work-context.css': {} });
    const work = loadSource('src/components/console/console-work-pane.tsx', {
      './console-artifact-position': loadSource('src/components/console/console-artifact-position.tsx'), '@/components/stage7/app-shell': shell,
      '@/components/stage7/workflow-visuals': visuals, '@/lib/core-ui/workflows': workflows, '@/components/guided/run-outcome': outcomeUi, '@/components/guided/work-context': workContext,
      '@/creative/terminal-review': terminal, '@/lib/core-ui/console-decisions-view': loadSource('src/lib/core-ui/console-decisions-view.ts', { './workflows': workflows, './run-outcome': outcome }),
    });
    const consoleData = loadSource('src/lib/core-ui/console-data.ts', { '@/products/discovery-v2-goal': {}, '@/products/discovery-v2-budget': {} });
    const noRequests = async () => ({ records: [], unavailable: false });
    const page = loadSource('src/app/dashboard/page.tsx', {
      'next/navigation': { notFound: () => { throw Error('Fixture record was not found'); } },
      '@/components/console/console-shell': consoleShell, '@/components/console/console-overview': overview,
      '@/components/console/console-command': command, '@/components/console/console-motion': motionUi, '@/lib/core-ui/console-motion': motion,
      '@/browser/console-view': browserView, '@/browser/console-server': { loadConsoleBrowserWorkspace: async () => ({ status: 'ready', sessions: [], selectedSession: null }) },
      '@/components/console/console-work-pane': work, '@/components/console/console-compact-decisions': component,
      '@/lib/core-ui/console-decisions-query': query, '@/lib/core-ui/console-decisions-data': { ...api, loadConsoleDecisionPage: async (ctx, options) => { pageReads.push(plain(options ?? {})); return api.loadConsoleDecisionPage(ctx, options); } },
      './terminal-review-actions': { acknowledgeTerminalCreativeReview: action },
      '@/components/stage7/workflow-visuals': visuals,
      '@/lib/core-ui/data': { requireOwnerUiContext: async () => current,
        loadWorkflowCollection: async (_context, options) => { reads.push({ reader: 'loadWorkflowCollection', options }); return collectionFor(); },
        loadWorkflowDetail: async (_context, runId) => { const collection = collectionFor(runId), run = collection.runs[0]; assert.ok(run, 'Run must be owned'); return { ...collection, run, definition: tables.workflow_definitions.find(row => row.id === run.workflow_definition_id), business: ownedBusinesses.find(row => row.id === run.business_id) }; } },
      '@/lib/core-ui/run-outcome-data': costLoader,
      '@/lib/core-ui/console-data': { ...consoleData, loadConsoleObservationTime: async () => Date.parse(acknowledgedAt), loadConsoleResearchQuote: deny },
      '@/accounts/server': { loadAccountWorkspace: async () => ({ configured: false, unavailable: false, accounts: [], runs: [], healthEvents: [], registrationAvailable: false }), loadAccountSetupInterventions: async () => accountRequests },
      '@/etsy-publication/server': { loadPublicationInterventions: noRequests }, '@/printful/server': { loadPrintfulProductInterventions: noRequests },
      '@/products/data': { loadProductWorkspace: async () => ({ candidates: [], experiments: [], decisions: [], errors: [] }) },
      '@/creative/data': { loadCreativeWorkspace: deny }, '@/products/discovery-v2-data': { loadDiscoveryGoalData: deny },
      '@/components/guided/quest-kickoff': { QuestKickoff: deny }, '@/components/guided/creative-library': { CreativeLibrary: deny },
      '@/components/stage13/discovery-goal-workspace': { DiscoveryGoalResults: deny }, './accounts/account-workspace': { CompactConnectionsWorkspace: deny },
      './actions': { createBusiness: deny, resumeSyntheticReview: synthetic }, './browser-actions': { resumeBrowserControl: browser }, './packs/actions': { acknowledgeEtsySimulation: simulation }, './legacy-dashboard': deny,
      '@/components/console/console-panes.css': {}, './accounts/accounts.css': {}, './products/products.css': {},
    }).default;
    const tree = await page({ searchParams: Promise.resolve(queryFromRoute(route)) });
    const selected = findFixtureElement(tree, 'ConsoleCompactDecisions');
    return { tree, html: renderToString(tree), decisions: selected, data: selected?.props.data, props: selected?.props,
      overview: findFixtureElement(tree, 'ConsoleOverview'), work: findFixtureElement(tree, 'ConsoleWorkPane'), boundary: findFixtureElement(tree, 'ConsoleMotionBoundary') };
  }
  return { tables, events, reads, hookCalls, typedActions: { syntheticReview: synthetic, browserControl: browser, simulationReview: simulation }, dbReads: h.calls, rpcCalls, mutations, revalidated, pageReads, action, perform, render, context, collectionFor,
    setMode: value => { mode = value; } };
}

export function typedDecisionTables(kind) {
  const tables = structuredClone(fixtureTables({ count: 1 })), notice = tables.owner_interventions[0], run = tables.workflow_runs[0], definition = tables.workflow_definitions[0];
  const types = { synthetic: 'synthetic_workflow_review', takeover: 'browser_takeover', return: 'browser_return_control', simulation: 'etsy_simulation_review' };
  assert.ok(types[kind], `Unknown typed fixture: ${kind}`);
  notice.intervention_type = types[kind]; notice.title = `Saved ${kind} request`; notice.description = 'Inspect the exact saved request before deciding.';
  run.completed_at = null; run.current_stage_key = 'review';
  tables.workflow_stage_runs[0].status = 'needs_owner'; tables.workflow_stage_runs[0].completed_at = null; tables.workflow_stage_runs[0].failure = {};
  Object.assign(definition, kind === 'synthetic' ? workflows.SYNTHETIC_REVIEW_WORKFLOW : { workflow_key: kind === 'simulation' ? 'etsy.product-discovery-simulation' : 'synthetic.browser-provider.qualification' });
  run.workflow_definition_id = definition.id;
  return tables;
}
