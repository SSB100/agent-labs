import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { build } from 'esbuild';
import { businesses, decisionRoute, fixtureTables, id, origin, rootDecisionFixture } from './console-decisions-root.mjs';
export { origin };
export function createDecisionBrowserFixture(options = {}) {
  const tables = options.tables ?? fixtureTables({ count: 143 });
  if (!options.tables) {
    const secondRuns = new Set(tables.workflow_runs.slice(131).map(run => run.id));
    const secondCreative = new Set(tables.creative_runs.filter(run => secondRuns.has(run.workflow_run_id)).map(run => run.id));
    const secondApprovals = new Set(tables.creative_runs.filter(run => secondRuns.has(run.workflow_run_id)).map(run => run.approval_id));
    for (const rows of Object.values(tables)) for (const row of rows) if (secondRuns.has(row.workflow_run_id) || secondRuns.has(row.id) || secondCreative.has(row.creative_run_id) || secondApprovals.has(row.id)) row.business_id = businesses[1].id;
    const syntheticDefinition = { ...tables.workflow_definitions[0], id: id(301), workflow_key: 'synthetic.core.runtime-proof', name: 'Synthetic review proof', version: '1.0.0' };
    const browserDefinition = { ...syntheticDefinition, id: id(302), workflow_key: 'synthetic.browser-provider.qualification', name: 'Browser control qualification' };
    const simulationDefinition = { ...syntheticDefinition, id: id(303), workflow_key: 'etsy.product-discovery-simulation', name: 'Etsy discovery simulation' };
    tables.workflow_definitions.push(syntheticDefinition, browserDefinition, simulationDefinition);
    for (const [offset, type] of ['synthetic_workflow_review', 'browser_takeover', 'browser_return_control', 'etsy_simulation_review', 'future.unknown'].entries()) {
      const index = 126 + offset, notice = tables.owner_interventions[index], run = tables.workflow_runs[index], stage = tables.workflow_stage_runs[index];
      notice.intervention_type = type; notice.title = `Saved ${type.replaceAll('_', ' ')} request`;
      run.completed_at = null; run.current_stage_key = 'review'; stage.completed_at = null; stage.status = 'needs_owner'; stage.failure = {};
      if (offset === 0) run.workflow_definition_id = syntheticDefinition.id;
      if (offset === 1 || offset === 2) run.workflow_definition_id = browserDefinition.id;
      if (offset === 3) run.workflow_definition_id = simulationDefinition.id;
    }
  }
  return rootDecisionFixture({ ...options, tables });
}
const defaultFixture = createDecisionBrowserFixture();
export const tables = defaultFixture.tables;
export const oldNotice = tables.owner_interventions[1];
export const selectedStart = decisionRoute(oldNotice);
export const queueStart = '/dashboard?view=decisions';
export function fiftyAccountRequests() {
  return { unavailable: true, records: Array.from({ length: 50 }, (_, index) => ({ businessId: businesses[index % 2].id, runId: id(21000 + index), provider: index % 2 ? 'printful' : 'etsy', status: 'needs_owner' })) };
}
export async function decisionClientState(route, fixture) {
  const page = await fixture.render(route);
  assert.ok(page.props, 'Retained fixture navigation must stay in Decisions');
  return JSON.parse(JSON.stringify({ ...page.props, actions: undefined }));
}
let bundle;
async function browserBundle() {
  if (!bundle) bundle = build({ absWorkingDir: process.cwd(), bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty' }, logLevel: 'silent', metafile: true,
    stdin: { sourcefile: 'console-decisions-root-hydration.tsx', resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React, {Suspense,use,useEffect,useState} from 'react';
      import {hydrateRoot} from 'react-dom/client';
      import {ConsoleCompactDecisions} from './src/components/console/console-compact-decisions';
      window.__decisionErrors=[]; window.__decisionActionCalls=0; window.__decisionActionCompletions=0; window.__decisionDiscardedActions=0; window.__decisionNavigationRevision=0; window.__decisionRetainedRenderCount=0;
      function checkedTarget(target) {
        const url=new URL(target,location.origin);
        if(url.origin!==location.origin || url.pathname!=='/dashboard' || url.searchParams.get('view')!=='decisions') throw Error('Unsafe fixture action return');
        return url.pathname+url.search;
      }
      function Fixture({value}) {
        const props=value && typeof value.then==='function' ? use(value) : value;
        useEffect(()=>{window.__decisionHydrated=true;window.__decisionRetainedRenderCount++;window.__decisionCommittedRoute=location.pathname+location.search},[props]);
        const acknowledgeStoppedCreative=async form=>{
          window.__decisionActionCalls++;
          const revision=window.__decisionNavigationRevision;
          try {
            if(window.__holdDecisionAction) await new Promise(resolve=>{window.__releaseDecisionAction=resolve});
            // This isolated binding runs the real server action in the Node fixture.
            // No fetch, provider, credentials or external action endpoint is allowed.
            const target=checkedTarget(await window.__runTerminalReviewFixture(Array.from(form.entries())));
            if(window.__decisionRetained && revision!==window.__decisionNavigationRevision) {
              window.__decisionDiscardedActions++;
              return;
            }
            if(window.__decisionRetained) await window.__navigateDecisionRetained(target,'replace',revision);
            else location.assign(target);
          } finally { window.__decisionActionCompletions++; }
        };
        const deniedTypedAction=async()=>{throw Error('Typed runtime delivery is denied in browser fixtures; covered by isolated server-action tests')};
        return <ConsoleCompactDecisions {...props} actions={{acknowledgeStoppedCreative,syntheticReview:deniedTypedAction,browserControl:deniedTypedAction,simulationReview:deniedTypedAction}}/>;
      }
      function RetainedFixture() {
        const [value,setValue]=useState(window.__decisionProps);
        useEffect(()=>{
          // Model retained component behavior and inspected Next 16.3.8 router
          // discard semantics, not Next's actual transport/action queue. User
          // navigation is urgent: an unrelated unresolved form Action cannot
          // entangle it, and a discarded Action cannot replace newer selection.
          window.__navigateDecisionRetained=async(target,mode='push',expectedRevision)=>{
            const route=checkedTarget(target);
            if(mode==='replace' && expectedRevision!==undefined && expectedRevision!==window.__decisionNavigationRevision) return;
            const revision=mode==='replace' ? window.__decisionNavigationRevision : ++window.__decisionNavigationRevision;
            // Keep the current DOM during the fixture read. Urgently suspending
            // the whole island would show a short fallback, clamp document scroll,
            // and invent a page-collapse behavior outside this component's scope.
            window.__decisionReadPending=true;
            let props;
            try { props=await window.__loadDecisionRootFixture(route); }
            finally { window.__decisionReadPending=false; }
            if(revision!==window.__decisionNavigationRevision) return;
            if(mode==='push') history.pushState({},'',route);
            if(mode==='replace') history.replaceState({},'',route);
            setValue(props);
          };
          const back=()=>window.__navigateDecisionRetained(location.pathname+location.search,'none');
          const filter=event=>{
            if(!(event.target instanceof HTMLFormElement) || !event.target.classList.contains('compactDecisionFilters')) return;
            event.preventDefault();
            const params=new URLSearchParams(new FormData(event.target));
            if(!params.get('business')) params.delete('business');
            window.__navigateDecisionRetained('/dashboard?'+params.toString());
          };
          addEventListener('popstate',back);document.addEventListener('submit',filter);
          return()=>{removeEventListener('popstate',back);document.removeEventListener('submit',filter)};
        },[]);
        return <Suspense fallback={<p role='status'>Loading saved fixture…</p>}><Fixture value={value}/></Suspense>;
      }
      if(document.getElementById('decision-root-island')) hydrateRoot(document.getElementById('decision-root-island'),window.__decisionRetained?<RetainedFixture/>:<Fixture value={window.__decisionProps}/>,{onRecoverableError:error=>window.__decisionErrors.push(error.message)});
      else window.__decisionHydrated=true;
    ` }, plugins: [{ name: 'decision-root-offline-boundaries', setup(builder) {
      builder.onResolve({ filter: /^next\/link$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', contents: 'import React from "react"; export default function Link({children,...props}) { delete props.prefetch; const click=event=>{ const url=new URL(String(props.href),location.origin); if(window.__decisionRetained && url.origin===location.origin && url.pathname==="/dashboard" && url.searchParams.get("view")==="decisions" && !event.metaKey && !event.ctrlKey && !event.shiftKey && event.button===0) { event.preventDefault(); window.__navigateDecisionRetained(url.pathname+url.search); } }; return React.createElement("a",{...props,onClick:click},children); }', resolveDir: process.cwd() }));
      builder.onResolve({ filter: /^@\// }, args => {
        const allowed = { '@/lib/core-ui/workflows': 'src/lib/core-ui/workflows.ts', '@/lib/core-ui/console-decisions-query': 'src/lib/core-ui/console-decisions-query.ts', '@/lib/core-ui/console-decisions-view': 'src/lib/core-ui/console-decisions-view.ts' };
        assert.ok(allowed[args.path], `Forbidden browser import: ${args.path}`); return { path: path.resolve(allowed[args.path]) };
      });
    } }] }).then(result => {
      const allowed = new Set(['src/components/console/console-compact-decisions.tsx','src/components/console/console-compact-decisions.css','src/components/console/console-decision-submit.tsx','src/components/console/console-decision-filters.tsx','src/lib/core-ui/console-decisions-query.ts','src/lib/core-ui/console-decisions-view.ts','src/lib/core-ui/workflows.ts','src/lib/core-ui/run-outcome.ts']);
      for (const input of Object.keys(result.metafile.inputs).filter(input => input.startsWith('src/'))) assert.ok(allowed.has(input), `Provider/auth/action import denied: ${input}`);
      return result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
    });
  return bundle;
}
function insertIsland(tree, target, retained) {
  if (!React.isValidElement(tree)) return tree;
  if (tree.type === target.type) return React.createElement('div', { id: 'decision-root-island', style: { display: 'contents' } }, retained ? React.createElement(React.Suspense, { fallback: React.createElement('p', { role: 'status' }, 'Loading saved fixture…') }, tree) : tree);
  if (!tree.props.children) return tree;
  return React.cloneElement(tree, {}, React.Children.map(tree.props.children, child => insertIsland(child, target, retained)));
}
/** The shell and Decisions element both come from actual DashboardPage output. */
export async function decisionDocument(route, { fixture = defaultFixture, retained = false } = {}) {
  const page = await fixture.render(route);
  const props = page.props ? { ...page.props, actions: undefined } : null;
  const markup = renderToString(page.decisions ? insertIsland(page.tree, page.decisions, retained) : page.tree);
  const styles = ['src/app/globals.css','src/app/stage1.css','src/app/stage3.css','src/app/stage7.css','src/app/stage7-mobile.css','src/app/stage8.css',
    'src/components/console/console-shell.css','src/components/console/console-command.css','src/components/console/console-motion.css','src/components/console/console-panes.css',
    'src/components/console/console-overview.css','src/components/console/console-browser-centre.css','src/components/guided/run-outcome.css','src/components/guided/work-context.css','src/components/console/console-compact-decisions.css'].map(file => readFileSync(file, 'utf8')).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="data:,"><title>Synthetic root Decisions owner fixture</title><style>${styles}</style></head><body>${markup}<script>window.__decisionRetained=${JSON.stringify(retained)};window.__decisionProps=${JSON.stringify(props).replace(/</g,'\\u003c')}</script><script>${await browserBundle()}</script></body></html>`;
}
