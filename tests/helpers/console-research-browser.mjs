import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { build } from 'esbuild';
import { businessId, secondBusinessId, selectedId, id, origin, queryFromRoute, researchTables, rootResearchFixture } from './console-research-root.mjs';
import { addAttempts, digest } from './console-research-data-fixtures.mjs';
import { historyFixture, prepare, buildDatabase, rebind, rebindEvidence } from './console-research-evidence-fixtures.mjs';

export { businessId, secondBusinessId, selectedId, id, origin };
export const selectedBusinessBId = '95000000-0000-4000-8000-000000000110';
export const freshRecordId = '95000000-0000-4000-8000-000000002010';
export const legacyId = id(1005), candidateId = id(1006), orphanId = id(1007), mismatchedWorkId = id(1008);
export const longName = 'Duplicate saved research objective ' + 'LongUnbrokenOriginalResearchDescription'.repeat(14);
export const literalText = '<img src=x onerror="window.__unsafeResearch=true"> **saved text** [literal](javascript:alert(1))';
export const rootsRoute = `/dashboard?view=research&type=roots&selected=${selectedId}`;
export const recordsRoute = `/dashboard?view=research&type=records&selected=${selectedId}`;
export const offFilterRoute = `/dashboard?view=research&type=records&selected=${selectedBusinessBId}&page=3&q=unmatched&searchField=hypothesis&sort=oldest`;
export const attemptsRoute = `/dashboard?view=research&type=records&selected=${selectedId}&root=${selectedId}&page=3&q=unmatched&searchField=hypothesis&attemptPage=2&attemptSort=oldest`;
const root = process.cwd(), plain = value => JSON.parse(JSON.stringify(value));
const require = createRequire(import.meta.url);

/** Persisted production shapes, including deliberately malformed historical states.
 * This adds data in this new harness only; it does not alter shared/root fixtures. */
export function browserResearchTables() {
  const tables = researchTables();
  for (const row of tables.product_experiments.filter(row => row.id !== selectedId)) {
    row.variables.intent.objective = longName;
    row.hypothesis = `Duplicate saved hypothesis ${'LongUnbrokenHypothesis'.repeat(10)}`;
    row.variables.policyHash = digest(row.variables.intent);
    if (Number(row.id.slice(-4)) % 5 === 0) { row.status = 'researching'; row.completed_at = null; }
    if (Number(row.id.slice(-4)) % 5 === 1) { row.status = 'reserved'; row.completed_at = null; }
  }
  const legacy = tables.product_experiments.find(row => row.id === legacyId);
  legacy.discovery_version = 'pod-discovery-1.0';
  const candidate = tables.product_experiments.find(row => row.id === candidateId);
  candidate.candidate_id = id(50001); candidate.parent_discovery_id = selectedId;
  const orphan = tables.product_experiments.find(row => row.id === orphanId);
  orphan.variables.budgetAuthorityRootId = id(999999);
  orphan.variables.ownerKickoff.followUpBasis = { rootId: id(999999), reason: 'Saved predecessor absent' };
  const mismatch = tables.product_experiments.find(row => row.id === mismatchedWorkId);
  tables.workflow_runs.find(row => row.id === mismatch.workflow_run_id).input.intentId = id(999998);
  // Contradictory ended state is retained rather than normalized to a live badge.
  tables.product_experiments.find(row => row.id === id(1009)).status = 'researching';
  const input = historyFixture(100);
  function businessB(value) {
    if (value === businessId) return secondBusinessId;
    return Array.isArray(value) ? value.map(businessB) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, businessB(item)])) : value;
  }
  const b = businessB(input); b.experiment.intent.objective = `${longName} ${literalText}`;
  b.evidenceRecords[0].artifact.content.evidencePack.sources[0].title = literalText;
  b.evidenceRecords[0].source.content.sources[0].title = literalText;
  for (const candidate of b.strategy.artifact.content.candidates) candidate.identityHash = digest(b.dossier.content.shortlist.find(row => row.id === candidate.candidateId));
  b.strategy.artifact.content.recommendation.proposedOutcome = 'TEST'; b.review.artifact.content.outcome = 'TEST';
  // A separate producer-shaped record saved within the actual root's fixed
  // observation window supplies a positive freshness case; expired records stay.
  const dates = value => typeof value === 'string' ? value.replace(/2024-01-01T/g, '2026-10-02T').replace(/2024-01-02T/g, '2026-10-03T') : Array.isArray(value) ? value.map(dates) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, dates(item)])) : value;
  const fresh = prepare(rebindEvidence(dates(historyFixture(2000))));
  const prepared = prepare(rebindEvidence(rebind(b))), saved = buildDatabase(prepared, fresh), prototype = tables.product_experiments[0], work = tables.workflow_runs[0];
  saved.product_experiments = saved.product_experiments.map(row => ({ ...prototype, ...row, created_at: '2023-01-02T00:00:00Z', started_at: '2023-01-02T00:00:00Z', variables: { ...row.variables, budgetAuthorityRootId: row.id, semanticGoalHash: 'a'.repeat(64) } }));
  saved.workflow_runs = saved.workflow_runs.map(row => ({ ...work, ...row }));
  for (const [table, rows] of Object.entries(saved)) for (const row of rows) if (!tables[table].some(existing => existing.id === row.id)) tables[table].push(row);
  addAttempts(tables, tables.product_experiments.find(row => row.id === selectedId), 130);
  return tables;
}

export function createResearchBrowserFixture({ latest = 'found', unavailableSelection = false, countNull = false, failList = false, ...options } = {}) {
  const tables = options.tables ?? browserResearchTables(), newestId = tables.product_experiments.filter(row => row.variables?.budgetAuthorityRootId === selectedId).at(-1).id;
  const supplied = options.readOptions ?? {};
  const readOptions = { ...supplied, transport(table, result, read) {
    const exactId = read.filters.find(([op, key]) => op === 'eq' && key === 'id')?.[2];
    if (unavailableSelection && table === 'product_experiments' && exactId === selectedId) result = { data: null, count: null, error: true };
    if (table === 'product_experiments' && read.range && !read.filters.some(([, key]) => key === 'variables->>budgetAuthorityRootId')) {
      if (countNull) result = { ...result, count: null };
      if (failList) result = { data: null, count: null, error: true };
    }
    if (table === 'product_experiments' && exactId === newestId && read.columns.includes('intent:')) {
      if (latest === 'missing') result = { data: [], count: 0, error: null };
      if (latest === 'unavailable') result = { data: null, count: null, error: true };
      if (latest === 'mismatched') result = { ...result, data: result.data.map(row => ({ ...row, business_id: secondBusinessId })) };
    }
    return supplied.transport ? supplied.transport(table, result, read) : result;
  } };
  const ownedBusinesses = [businessId, secondBusinessId].map(id => ({ id, name: 'Duplicate Business ' + 'LongUnbrokenBusinessName'.repeat(8), created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z' }));
  return { ...rootResearchFixture({ ...options, tables, readOptions, ownedBusinesses: options.ownedBusinesses ?? ownedBusinesses }), newestId, evidenceLeaves: new Map() };
}
function find(tree, name) {
  for (const element of Array.isArray(tree) ? tree : [tree]) if (React.isValidElement(element)) {
    if (element.type?.name === name) return element;
    const child = find(element.props.children, name); if (child) return child;
  }
  return null;
}
// Only actual React DOM fallback nodes are serialized. Text remains React text,
// with no raw HTML/Markdown injection and no invented fallback copy.
function domWire(node) {
  if (Array.isArray(node)) return node.map(domWire);
  if (!React.isValidElement(node)) return node;
  assert.equal(typeof node.type, 'string');
  const props = { ...node.props }; delete props.children;
  assert.ok(!Object.hasOwn(props, 'dangerouslySetInnerHTML'));
  return { type: node.type, props, children: domWire(node.props.children) };
}
/** Actual owner route redirects, before any metadata/evidence/legacy loader. */
export async function researchRedirect(route, fixture) {
  const url = new URL(route, origin);
  const alias = url.pathname === '/dashboard/products' || url.searchParams.get('view') === 'library';
  if (!alias) return null;
  const Page = fixture.load(url.pathname === '/dashboard/products' ? 'src/app/dashboard/products/page.tsx' : 'src/app/dashboard/page.tsx').default;
  try { await Page({ searchParams: Promise.resolve(queryFromRoute(route)) }); }
  catch (error) { if (error.code === 'FIXTURE_REDIRECT') return error.href; throw error; }
  throw Error('Expected actual read-only alias redirect');
}
/** Decode the actual installed Next redirect primitive for the exact target
 * produced by the owner route. This is a source/unit307+Location assertion,
 * not a hosted HTTP response or Next server-transport qualification. */
export async function researchRedirectResponse(route, fixture) {
  const location = await researchRedirect(route, fixture), target = new URL(location, origin);
  assert.ok(location.startsWith('/dashboard?') && !location.startsWith('//') && !/[\u0000-\u001f\u007f]/.test(location));
  assert.equal(target.origin, origin); assert.equal(target.pathname, '/dashboard'); assert.equal(target.searchParams.get('view'), 'research');
  const next = require('next/dist/client/components/redirect');
  try { next.redirect(location); } catch (error) {
    return { status: next.getRedirectStatusCodeFromError(error), headers: { location: next.getURLFromRedirectError(error) } };
  }
  throw Error('Actual Next redirect must terminate the source route');
}
/** Playwright route handlers do not intercept redirected follow-up requests.
 * Use a new native navigation to the actual, validated owner-route target so
 * this inert fixture cannot fall through to DNS/network. This is explicitly
 * synthetic navigation; HTTP307 delivery is checked only by the unit above.
 * Carry an existing fragment unchanged, as a native HTTP redirect would. */
export function researchRedirectDocument(response) {
  assert.equal(response.status, 307);
  assert.ok(typeof response.headers.location === 'string' && response.headers.location.startsWith('/dashboard?') && !response.headers.location.startsWith('//') && !/[\u0000-\u001f\u007f]/.test(response.headers.location));
  const target = new URL(response.headers.location, origin);
  assert.equal(target.origin, origin); assert.equal(target.pathname, '/dashboard'); assert.equal(target.searchParams.get('view'), 'research');
  const location = JSON.stringify(response.headers.location).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>SYNTHETIC owner-route redirect navigation</title></head><body><script>const target=new URL(${location},location.origin);if(!target.hash)target.hash=location.hash;location.replace(target.href)</script></body></html>`;
}
/** Props derive from actual DashboardPage, bounded metadata readers and adapter leaf. */
export async function researchClientState(route, fixture) {
  const page = await fixture.render(route), shell = { ...page.tree.props }, pane = { ...page.pane.props };
  delete shell.children; delete shell.commandBar; delete shell.context;
  delete pane.viewport; delete pane.evidenceContent;
  pane.searchParams = Object.fromEntries(pane.searchParams);
  const boundary = page.pane.props.evidenceContent, leaf = boundary?.props.children;
  if (leaf) fixture.evidenceLeaves.set(page.canonicalRoute, leaf);
  return plain({ route: page.canonicalRoute, shell: { ...shell, context: { ...page.tree.props.context, supabase: undefined } }, command: page.command, pane,
    progressive: leaf ? { key: boundary.key, route: page.canonicalRoute, record: leaf.props.record, ready: { ownerId: leaf.props.context.userId, scopeHref: leaf.props.scopeHref, recordId: leaf.props.record.id, businessId: leaf.props.record.business_id }, loading: domWire(boundary.props.fallback), payload: null } : null,
    sheet: page.sheet ? { returnTo: page.sheet.props.returnTo, quest: page.sheet.props.children.props } : null });
}
/** Runs the original server leaf and exact adapter, never browser-side metadata reads. */
export async function researchEvidenceState(route, fixture) {
  const leaf = fixture.evidenceLeaves.get(route); assert.ok(leaf, 'Evidence route must have an actual-root descriptor');
  const result = await leaf.type(leaf.props), content = find(result, 'ConsoleResearchEvidenceContent'), ready = find(result, 'ConsoleResearchEvidenceReady');
  assert.ok(content && ready); assert.equal(content.props.record.id, ready.props.recordId);
  return plain({ record: content.props.record, evidence: content.props.evidence, ready: ready.props });
}
/** Retained fixture payloads belong to a particular descriptor generation,
 * even when production's exact Suspense key remains unchanged. */
export function researchEvidencePayload(resolved, descriptor) { return resolved?.descriptor === descriptor ? resolved.payload : null; }
export function researchEvidenceRequest({ descriptor, load, onResolve, onDiscard }) {
  let current = true, pending = true;
  const promise = Promise.resolve().then(() => load(descriptor.route)).then(payload => {
    pending = false;
    if (current) onResolve({ descriptor, payload }); else onDiscard();
    return payload;
  }, error => { pending = false; throw error; });
  return { get current() { return current; }, get pending() { return current && pending; }, promise, dispose() { current = false; } };
}
/** Observe actual native departure before the production pane's capture-phase
 * save. This passive document listener neither focuses nor scrolls the link;
 * Playwright may auto-scroll again when it performs the native click. */
export function observeResearchCloseDeparture(link) {
  const document = link.ownerDocument, view = document.defaultView, pane = link.closest('.consoleResearchPane');
  if (!view || !pane || link.tagName !== 'A' || link.textContent.trim() !== 'Close detail') throw Error('Observe the exact Research Close link only');
  const body = pane.querySelector(':scope>.consoleResearchBody'), results = pane.querySelector('.consoleResearchResults'), detail = pane.querySelector('.consoleResearchDetail');
  if (!body || !results || !detail) throw Error('Research departure regions must remain mounted');
  const observations = []; view.__researchCloseDeparture = observations;
  const observe = event => {
    if (!event.composedPath().includes(link)) return;
    observations.push({ type: event.type, phase: event.eventPhase, trusted: event.isTrusted, exactClose: true, href: link.getAttribute('href'),
      route: view.location.pathname + view.location.search + view.location.hash,
      reading: { document: view.scrollY, body: body.scrollTop, results: results.scrollTop, detail: detail.scrollTop } });
    if (event.type === 'click') { document.removeEventListener('pointerdown', observe, true); document.removeEventListener('click', observe, true); }
  };
  document.addEventListener('pointerdown', observe, { capture: true, passive: true });
  document.addEventListener('click', observe, { capture: true, passive: true });
}
export function researchTree(React, modules, state, Progressive) {
  const { ConsoleShell, ConsoleCommandBar, ConsoleResearchPane, ConsoleCollectionViewport, ConsoleResearchSheet, OwnerResearchEntry } = modules;
  return React.createElement(ConsoleShell, { ...state.shell, commandBar: React.createElement(ConsoleCommandBar, state.command) },
    React.createElement(ConsoleResearchPane, { ...state.pane, viewport: React.createElement(ConsoleCollectionViewport, { ownerId: state.pane.ownerId, scopeHref: state.pane.scopeHref }), evidenceContent: state.progressive ? React.createElement(Progressive, { key: state.progressive.key, descriptor: state.progressive }) : undefined }),
    state.sheet ? React.createElement(ConsoleResearchSheet, { returnTo: state.sheet.returnTo }, React.createElement(OwnerResearchEntry, state.sheet.quest)) : null);
}
function renderDomWire(React, value) {
  return Array.isArray(value) ? value.map((item, index) => React.createElement(React.Fragment, { key: index }, renderDomWire(React, item))) : value && typeof value === 'object' ? React.createElement(value.type, value.props, renderDomWire(React, value.children)) : value;
}
const browserSource = `
import React,{Suspense,startTransition,useEffect,useState} from 'react';
import {hydrateRoot} from 'react-dom/client';
import {ConsoleShell} from './src/components/console/console-shell';
import {ConsoleCommandBar,ConsoleResearchSheet} from './src/components/console/console-command';
import {ConsoleResearchPane,ConsoleResearchEvidenceContent} from './src/components/console/console-research-pane';
import {ConsoleResearchEvidenceReady} from './src/components/console/console-research-evidence-ready';
import {ConsoleCollectionViewport} from './src/components/console/console-collection-viewport';
import {OwnerResearchEntry} from './src/components/quests/owner-research-entry';
const modules={ConsoleShell,ConsoleCommandBar,ConsoleResearchSheet,ConsoleResearchPane,ConsoleCollectionViewport,OwnerResearchEntry};
const researchTree=${researchTree.toString()},renderDomWire=${renderDomWire.toString()},researchEvidencePayload=${researchEvidencePayload.toString()},researchEvidenceRequest=${researchEvidenceRequest.toString()};
window.__researchErrors=[];window.__researchRevision=0;window.__researchReadRequests=[];window.__researchCommits=0;window.__researchDiscarded=0;window.__researchPaidCalls=0;window.__researchEvidenceRequests=[];window.__researchEvidenceDiscarded=0;window.__researchEvidenceGeneration=0;window.__researchEvidenceCurrent=0;window.__researchEvidencePending=false;
function checked(target){const url=new URL(target,location.origin);if(url.origin!==location.origin||url.pathname!=='/dashboard'||url.searchParams.get('view')!=='research')throw Error('Unsafe Research fixture navigation');return url.pathname+url.search+url.hash;}
function Progressive({descriptor}){
 const [resolved,setResolved]=useState({descriptor,payload:descriptor.payload}),payload=researchEvidencePayload(resolved,descriptor);
 useEffect(()=>{if(descriptor.payload)return;const generation=++window.__researchEvidenceGeneration;window.__researchEvidenceCurrent=generation;window.__researchEvidencePending=true;window.__researchEvidenceRequests.push(descriptor.route);
  const request=researchEvidenceRequest({descriptor,load:route=>window.__loadResearchEvidenceFixture(route),onResolve:value=>{setResolved(value);if(window.__researchEvidenceCurrent===generation)window.__researchEvidencePending=false;},onDiscard:()=>{window.__researchEvidenceDiscarded++;}});
  request.promise.catch(error=>{if(request.current)window.__researchErrors.push(error.message);if(window.__researchEvidenceCurrent===generation)window.__researchEvidencePending=false;});
  return()=>{request.dispose();if(window.__researchEvidenceCurrent===generation)window.__researchEvidencePending=false;};
 },[descriptor]);
 return payload?<><ConsoleResearchEvidenceContent record={payload.record} evidence={payload.evidence}/><ConsoleResearchEvidenceReady {...payload.ready}/></>:renderDomWire(React,descriptor.loading);
}
function Harness(){
 const [state,setState]=useState(window.__researchState);
 useEffect(()=>{window.__researchHydrated=true;window.__researchCommittedRoute=location.pathname+location.search+location.hash;window.__researchCommits++;},[state]);
 useEffect(()=>{
  window.__researchNavigate=async(target,mode='push')=>{
   const route=checked(target);if(!window.__researchRetained){location.assign(route);return;}const revision=++window.__researchRevision;window.__researchReadPending=true;window.__researchReadRequests.push(route);
   try{const next=await window.__loadResearchRootFixture(route);if(revision!==window.__researchRevision){window.__researchDiscarded++;return;}
    if(mode==='push')history.pushState({},'',route);else if(mode==='replace')history.replaceState({},'',route);
    startTransition(()=>setState(next));
   }finally{if(revision===window.__researchRevision)window.__researchReadPending=false;}
  };
  window.__researchRouter={push:target=>window.__researchNavigate(target),replace:target=>window.__researchNavigate(target,'replace'),refresh:()=>window.__researchNavigate(location.href,'none')};
  const back=()=>window.__researchNavigate(location.pathname+location.search+location.hash,'none');
  const submit=event=>{if(!window.__researchRetained||!(event.target instanceof HTMLFormElement)||!event.target.classList.contains('consoleResearchToolbar'))return;event.preventDefault();const params=new URLSearchParams(new FormData(event.target));for(const [key,value]of [...params])if(!value)params.delete(key);window.__researchNavigate('/dashboard?'+params.toString());};
  if(window.__researchRetained)addEventListener('popstate',back);document.addEventListener('submit',submit);return()=>{removeEventListener('popstate',back);document.removeEventListener('submit',submit)};
 },[]);
 return researchTree(React,modules,state,Progressive);
}
hydrateRoot(document.getElementById('research-root-island'),<Suspense fallback={<p role='status'>Loading synthetic saved Research…</p>}><Harness/></Suspense>,{onRecoverableError:error=>window.__researchErrors.push(error.message)});
`;
let bundle;
async function browserBundle() {
  return bundle ??= build({ absWorkingDir: root, bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty' }, logLevel: 'silent', metafile: true,
    stdin: { sourcefile: 'console-research-root-hydration.tsx', resolveDir: root, loader: 'tsx', contents: browserSource }, plugins: [{ name: 'research-root-read-only-boundary', setup(builder) {
      builder.onResolve({ filter: /^next\/(link|navigation)$|^@\/components\/stage7\/live-refresh$|^@\/app\/dashboard\/products\/discovery-actions$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', resolveDir: root, contents: args.path === 'next/link' ? `import React from 'react';export default function Link({children,...props}){delete props.prefetch;const click=event=>{const url=new URL(String(props.href),location.origin);if(window.__researchRetained&&url.origin===location.origin&&url.pathname==='/dashboard'&&url.searchParams.get('view')==='research'&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&event.button===0){event.preventDefault();window.__researchNavigate(url.pathname+url.search+url.hash);}};return React.createElement('a',{...props,onClick:click},children);}` : args.path === 'next/navigation' ? `export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);export const useRouter=()=>({push:(...args)=>window.__researchRouter.push(...args),replace:(...args)=>window.__researchRouter.replace(...args),refresh:(...args)=>window.__researchRouter.refresh(...args)});` : args.path.includes('live-refresh') ? 'export const LiveRefresh=()=>null;' : `export async function startGeographicDiscovery(){window.__researchPaidCalls++;throw Error('Provider/action execution is forbidden in this synthetic read-only Research fixture');}` }));
      builder.onResolve({ filter: /^@\// }, args => {
        const allowed = { '@/lib/core-ui/workspace-navigation':'src/lib/core-ui/workspace-navigation.ts', '@/lib/core-ui/workflows': 'src/lib/core-ui/workflows.ts', '@/lib/core-ui/run-outcome': 'src/lib/core-ui/run-outcome.ts', '@/lib/core-ui/console-collections-query': 'src/lib/core-ui/console-collections-query.ts', '@/lib/core-ui/console-research-query': 'src/lib/core-ui/console-research-query.ts', '@/lib/core-ui/quest-draft': 'src/lib/core-ui/quest-draft.ts', '@/components/stage7/icons': 'src/components/stage7/icons.tsx' };
        assert.ok(allowed[args.path], `Forbidden Research browser import: ${args.path}`); return { path: path.join(root, allowed[args.path]) };
      });
    } }],
  }).then(result => {
    const allowed = new Set(['src/components/console/history-pager.tsx','src/lib/core-ui/workspace-navigation.ts','src/components/console/console-shell.tsx', 'src/components/console/console-shell.css', 'src/components/console/console-command.tsx', 'src/components/console/console-command.css', 'src/components/console/console-collection-panes.tsx', 'src/components/console/console-collection-panes.css', 'src/components/console/console-collection-viewport.tsx', 'src/components/console/console-collection-scroll.ts', 'src/components/console/console-research-pane.tsx', 'src/components/console/console-research-pane.css', 'src/components/console/console-research-evidence-ready.tsx', 'src/components/quests/owner-research-entry.tsx', 'src/components/quests/owner-research.css', 'src/components/stage7/icons.tsx', 'src/lib/core-ui/workflows.ts', 'src/lib/core-ui/run-outcome.ts', 'src/lib/core-ui/console-collections-query.ts', 'src/lib/core-ui/console-research-query.ts', 'src/lib/core-ui/quest-draft.ts', 'src/core/quest-intake.ts']);
    for (const file of Object.keys(result.metafile.inputs).filter(file => file.startsWith('src/'))) assert.ok(allowed.has(file), `Server/provider/auth import denied: ${file}`);
    return result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  });
}
/** Actual-root state and client components. Native GET and retained state transport
 * are test-only. R03: this does not qualify real Next RSC/cache/action behavior. */
export async function researchDocument(route, { fixture = createResearchBrowserFixture(), retained = true, initialEvidence = false } = {}) {
  const state = await researchClientState(route, fixture);
  if (initialEvidence && state.progressive) state.progressive.payload = await researchEvidenceState(state.progressive.route, fixture);
  const modules = Object.assign({}, ...['console-shell', 'console-command', 'console-research-pane', 'console-collection-viewport', 'console-research-evidence-ready'].map(name => fixture.load(`src/components/console/${name}.tsx`)), fixture.load('src/components/quests/owner-research-entry.tsx'));
  function Progressive({ descriptor }) { return descriptor.payload ? React.createElement(React.Fragment, null, React.createElement(modules.ConsoleResearchEvidenceContent, { record: descriptor.payload.record, evidence: descriptor.payload.evidence }), React.createElement(modules.ConsoleResearchEvidenceReady, descriptor.payload.ready)) : renderDomWire(React, descriptor.loading); }
  const markup = renderToString(React.createElement(React.Suspense, { fallback: React.createElement('p', { role: 'status' }, 'Loading synthetic saved Research…') }, researchTree(React, modules, state, Progressive)));
  const styles = ['src/app/globals.css', 'src/app/stage1.css', 'src/app/stage3.css', 'src/app/stage7.css', 'src/app/stage7-mobile.css', 'src/app/stage8.css', 'src/components/console/console-shell.css', 'src/components/console/console-command.css', 'src/components/console/console-panes.css', 'src/components/console/console-collection-panes.css', 'src/components/console/console-research-pane.css', 'src/components/quests/owner-research.css'].map(file => readFileSync(file, 'utf8')).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="data:,"><title>SYNTHETIC actual-root read-only Research fixture</title><style>${styles}</style></head><body data-synthetic-fixture="read-only-research"><div id="research-root-island" style="display:contents">${markup}</div><script>window.__researchRetained=${JSON.stringify(retained)};window.__researchState=${JSON.stringify(state).replace(/</g, '\\u003c')}</script><script>${await browserBundle()}</script></body></html>`;
}
