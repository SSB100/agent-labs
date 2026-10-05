import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { build } from 'esbuild';
import { rootCollectionFixture } from './console-collection-root.mjs';
export { origin } from './console-collection-root.mjs';
export const createCollectionBrowserFixture = options => rootCollectionFixture(options);
const root = process.cwd();
/** Serialized props come only from actual DashboardPage output and actual bounded readers. */
export async function collectionClientState(route, fixture) {
  const page = await fixture.render(route), { commandBar, context } = page.tree.props;
  const shell = { ...page.tree.props }; delete shell.children; delete shell.commandBar; delete shell.context;
  const { headerAction, searchParams } = page.props;
  const pane = { ...page.props }; delete pane.children; delete pane.headerAction; delete pane.searchParams;
  return JSON.parse(JSON.stringify({ shell: { ...shell, context: { ...context, supabase: undefined } }, command: commandBar.props,
    kind: page.tree.props.active, pane: { ...pane, searchParams: Object.fromEntries(searchParams) }, headerAction: headerAction ? { href: headerAction.props.href, children: headerAction.props.children, className: headerAction.props.className } : null,
    detail: page.detailData, sheet: page.sheet ? { returnTo: page.sheet.props.returnTo, quest: page.sheet.props.children.props } : null }));
}
// This pure reconstruction uses the production components with the exact actual-root props.
// Retained transport below is intentionally synthetic; it is not Next RSC/cache qualification.
export function collectionTree(React, modules, state) {
  const { ConsoleShell, ConsoleCommandBar, ConsoleWorkCollectionPane, ConsoleActivityCollectionPane, ConsoleWorkDetail, ConsoleResearchSheet, QuestKickoff, Link } = modules;
  const Pane = state.kind === 'work' ? ConsoleWorkCollectionPane : ConsoleActivityCollectionPane;
  return React.createElement(ConsoleShell, { ...state.shell, commandBar: React.createElement(ConsoleCommandBar, state.command) },
    React.createElement(Pane, { ...state.pane, headerAction: state.headerAction ? React.createElement(Link, state.headerAction) : null },
      state.detail ? React.createElement(ConsoleWorkDetail, { detail: state.detail, searchParams: state.pane.searchParams }) : null),
    state.sheet ? React.createElement(ConsoleResearchSheet, { returnTo: state.sheet.returnTo }, React.createElement(QuestKickoff, state.sheet.quest)) : null);
}
const browserSource = `
import React,{Suspense,startTransition,useEffect,useState} from 'react';
import {hydrateRoot} from 'react-dom/client';
import Link from 'next/link';
import {ConsoleShell} from './src/components/console/console-shell';
import {ConsoleCommandBar,ConsoleResearchSheet} from './src/components/console/console-command';
import {ConsoleWorkCollectionPane,ConsoleActivityCollectionPane} from './src/components/console/console-collection-panes';
import {ConsoleWorkDetail} from './src/components/console/console-work-detail';
import {QuestKickoff} from './src/components/guided/quest-kickoff';
const modules={ConsoleShell,ConsoleCommandBar,ConsoleResearchSheet,ConsoleWorkCollectionPane,ConsoleActivityCollectionPane,ConsoleWorkDetail,QuestKickoff,Link};
const collectionTree=${collectionTree.toString()};
window.__collectionErrors=[];window.__collectionRevision=0;window.__collectionReadRequests=[];window.__collectionCommits=0;window.__collectionDiscarded=0;window.__collectionPaidCalls=0;
function checked(target){const url=new URL(target,location.origin);if(url.origin!==location.origin||url.pathname!=='/dashboard'||!['work','activity'].includes(url.searchParams.get('view')))throw Error('Unsafe collection navigation');return url.pathname+url.search+url.hash;}
function Harness(){
 const [state,setState]=useState(window.__collectionState);
 useEffect(()=>{window.__collectionHydrated=true;window.__collectionCommittedRoute=location.pathname+location.search+location.hash;window.__collectionCommits++;},[state]);
 useEffect(()=>{
  window.__collectionNavigate=async(target,mode='push')=>{
   const route=checked(target);if(!window.__collectionRetained){location.assign(route);return;}const revision=++window.__collectionRevision;window.__collectionReadPending=true;window.__collectionReadRequests.push(route);
   try{const next=await window.__loadCollectionRootFixture(route);if(revision!==window.__collectionRevision){window.__collectionDiscarded++;return;}
    if(mode==='push')history.pushState({},'',route);else if(mode==='replace')history.replaceState({},'',route);
    startTransition(()=>setState(next));
   }finally{if(revision===window.__collectionRevision)window.__collectionReadPending=false;}
  };
  window.__collectionRouter={push:target=>window.__collectionNavigate(target),replace:target=>window.__collectionNavigate(target,'replace'),refresh:()=>window.__collectionNavigate(location.href,'none')};
  const back=()=>window.__collectionNavigate(location.pathname+location.search+location.hash,'none');
  const submit=event=>{if(!window.__collectionRetained||!(event.target instanceof HTMLFormElement)||!event.target.classList.contains('consoleCollectionToolbar'))return;event.preventDefault();const params=new URLSearchParams(new FormData(event.target));for(const [key,value]of [...params])if(!value)params.delete(key);window.__collectionNavigate('/dashboard?'+params.toString());};
  addEventListener('popstate',back);document.addEventListener('submit',submit);return()=>{removeEventListener('popstate',back);document.removeEventListener('submit',submit)};
 },[]);
 return collectionTree(React,modules,state);
}
hydrateRoot(document.getElementById('collection-root-island'),<Suspense fallback={<p role='status'>Loading saved collection…</p>}><Harness/></Suspense>,{onRecoverableError:error=>window.__collectionErrors.push(error.message)});
`;
let bundle;
async function browserBundle() {
  return bundle ??= build({ absWorkingDir: root, bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty' }, logLevel: 'silent', metafile: true,
    stdin: { sourcefile: 'console-collection-root-hydration.tsx', resolveDir: root, loader: 'tsx', contents: browserSource }, plugins: [{ name: 'collection-root-read-only-boundary', setup(builder) {
      builder.onResolve({filter:/^next\/(link|navigation)$|^@\/components\/stage7\/live-refresh$|^@\/app\/dashboard\/products\/discovery-actions$/},args=>({path:args.path,namespace:'fixture'}));
      builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'js',resolveDir:root,contents:args.path==='next/link'?`import React from 'react';export default function Link({children,...props}){delete props.prefetch;const click=event=>{const url=new URL(String(props.href),location.origin);if(window.__collectionRetained&&url.origin===location.origin&&url.pathname==='/dashboard'&&['work','activity'].includes(url.searchParams.get('view'))&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&event.button===0){event.preventDefault();window.__collectionNavigate(url.pathname+url.search+url.hash);}};return React.createElement('a',{...props,onClick:click},children);}`:args.path==='next/navigation'?`export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);export const useRouter=()=>({push:(...args)=>window.__collectionRouter.push(...args),replace:(...args)=>window.__collectionRouter.replace(...args),refresh:(...args)=>window.__collectionRouter.refresh(...args)});`:args.path.includes('live-refresh')?'export const LiveRefresh=()=>null;':`export async function startGeographicDiscovery(){window.__collectionPaidCalls++;throw Error('Paid execution and provider actions are forbidden in this read-only fixture');}`}));
      builder.onResolve({filter:/^@\//},args=>{
        const allowed={'@/lib/core-ui/workspace-navigation':'src/lib/core-ui/workspace-navigation.ts','@/lib/core-ui/workflows':'src/lib/core-ui/workflows.ts','@/lib/core-ui/run-outcome':'src/lib/core-ui/run-outcome.ts','@/lib/core-ui/console-collections-query':'src/lib/core-ui/console-collections-query.ts','@/lib/core-ui/quest-draft':'src/lib/core-ui/quest-draft.ts','@/components/stage7/icons':'src/components/stage7/icons.tsx'};
        assert.ok(allowed[args.path],`Forbidden collection browser import: ${args.path}`);return {path:path.join(root,allowed[args.path])};
      });
    }}],
  }).then(result=>{
    const allowed=new Set(['src/components/console/history-pager.tsx','src/lib/core-ui/workspace-navigation.ts','src/components/console/console-shell.tsx','src/components/console/console-shell.css','src/components/console/console-command.tsx','src/components/console/console-command.css','src/components/console/console-collection-panes.tsx','src/components/console/console-collection-panes.css','src/components/console/console-collection-viewport.tsx','src/components/console/console-collection-scroll.ts','src/components/console/console-work-detail.tsx','src/components/console/console-artifact-position.tsx','src/components/guided/quest-kickoff.tsx','src/components/guided/quest-kickoff.css','src/components/stage7/icons.tsx','src/lib/core-ui/workflows.ts','src/lib/core-ui/run-outcome.ts','src/lib/core-ui/console-collections-query.ts','src/lib/core-ui/quest-draft.ts', 'src/core/quest-intake.ts']);
    for(const file of Object.keys(result.metafile.inputs).filter(file=>file.startsWith('src/')))assert.ok(allowed.has(file),`Server/provider/auth import denied: ${file}`);
    return result.outputFiles[0].text.replace(/<\/script/gi,'<\\/script');
  });
}
export async function collectionDocument(route, { fixture = rootCollectionFixture(), retained = true } = {}) {
  const state=await collectionClientState(route,fixture),modules={...fixture.load('src/components/console/console-shell.tsx'),...fixture.load('src/components/console/console-command.tsx'),...fixture.load('src/components/console/console-collection-panes.tsx'),...fixture.load('src/components/console/console-work-detail.tsx'),...fixture.load('src/components/guided/quest-kickoff.tsx'),Link:({children,...props})=>React.createElement('a',props,children)};
  const markup=renderToString(React.createElement(React.Suspense,{fallback:React.createElement('p',{role:'status'},'Loading saved collection…')},collectionTree(React,modules,state)));
  const styles=['src/app/globals.css','src/app/stage1.css','src/app/stage3.css','src/app/stage7.css','src/app/stage7-mobile.css','src/app/stage8.css','src/components/console/console-shell.css','src/components/console/console-command.css','src/components/console/console-panes.css','src/components/console/console-collection-panes.css','src/components/guided/quest-kickoff.css'].map(file=>readFileSync(file,'utf8')).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="data:,"><title>Synthetic actual-root read-only Work and Activity</title><style>${styles}</style></head><body><div id="collection-root-island" style="display:contents">${markup}</div><script>window.__collectionRetained=${JSON.stringify(retained)};window.__collectionState=${JSON.stringify(state).replace(/</g,'\\u003c')}</script><script>${await browserBundle()}</script></body></html>`;
}
