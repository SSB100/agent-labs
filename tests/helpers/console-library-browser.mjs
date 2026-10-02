import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { build } from 'esbuild';
import { rootLibraryFixture } from './console-library-root.mjs';
export { origin } from './console-library-root.mjs';
export const createLibraryBrowserFixture = options => rootLibraryFixture(options);
const root = process.cwd();
/** Props derive from actual DashboardPage, its actual Library root, and actual bounded readers. */
export async function libraryClientState(route, fixture) {
  const page = await fixture.render(route), { commandBar, context } = page.tree.props;
  const shell = { ...page.tree.props }; delete shell.children; delete shell.commandBar; delete shell.context;
  const pane = { ...page.props, searchParams: Object.fromEntries(page.props.searchParams) };
  return JSON.parse(JSON.stringify({ shell: { ...shell, context: { ...context, supabase: undefined } }, command: commandBar.props, pane,
    sheet: page.sheet ? { returnTo: page.sheet.props.returnTo, quest: page.sheet.props.children.props } : null }));
}
/** Production components and actual-root props; retained fixture transport is synthetic.
 * Explicit R03 limitation: this is not proof of real Next RSC/cache/server-action behavior. */
export function libraryTree(React, modules, state) {
  const { ConsoleShell, ConsoleCommandBar, ConsoleLibraryPane, ConsoleResearchSheet, QuestKickoff } = modules;
  return React.createElement(ConsoleShell, { ...state.shell, commandBar: React.createElement(ConsoleCommandBar, state.command) },
    React.createElement(ConsoleLibraryPane, state.pane),
    state.sheet ? React.createElement(ConsoleResearchSheet, { returnTo: state.sheet.returnTo }, React.createElement(QuestKickoff, state.sheet.quest)) : null);
}
const browserSource = `
import React,{Suspense,startTransition,useEffect,useState} from 'react';
import {hydrateRoot} from 'react-dom/client';
import {ConsoleShell} from './src/components/console/console-shell';
import {ConsoleCommandBar,ConsoleResearchSheet} from './src/components/console/console-command';
import {ConsoleLibraryPane} from './src/components/console/console-library-pane';
import {QuestKickoff} from './src/components/guided/quest-kickoff';
const modules={ConsoleShell,ConsoleCommandBar,ConsoleResearchSheet,ConsoleLibraryPane,QuestKickoff};
const libraryTree=${libraryTree.toString()};
window.__libraryErrors=[];window.__libraryRevision=0;window.__libraryReadRequests=[];window.__libraryCommits=0;window.__libraryDiscarded=0;window.__libraryPaidCalls=0;
function checked(target){const url=new URL(target,location.origin);if(url.origin!==location.origin||url.pathname!=='/dashboard'||url.searchParams.get('view')!=='library'||url.searchParams.get('type')==='research')throw Error('Unsafe Library fixture navigation');return url.pathname+url.search+url.hash;}
function Harness(){
 const [state,setState]=useState(window.__libraryState);
 useEffect(()=>{window.__libraryHydrated=true;window.__libraryCommittedRoute=location.pathname+location.search+location.hash;window.__libraryCommits++;},[state]);
 useEffect(()=>{
  window.__libraryNavigate=async(target,mode='push')=>{
   const route=checked(target);if(!window.__libraryRetained){location.assign(route);return;}const revision=++window.__libraryRevision;window.__libraryReadPending=true;window.__libraryReadRequests.push(route);
   try{const next=await window.__loadLibraryRootFixture(route);if(revision!==window.__libraryRevision){window.__libraryDiscarded++;return;}
    if(mode==='push')history.pushState({},'',route);else if(mode==='replace')history.replaceState({},'',route);
    startTransition(()=>setState(next));
   }finally{if(revision===window.__libraryRevision)window.__libraryReadPending=false;}
  };
  window.__libraryRouter={push:target=>window.__libraryNavigate(target),replace:target=>window.__libraryNavigate(target,'replace'),refresh:()=>window.__libraryNavigate(location.href,'none')};
  const back=()=>window.__libraryNavigate(location.pathname+location.search+location.hash,'none');
  const submit=event=>{if(!window.__libraryRetained||!(event.target instanceof HTMLFormElement)||(!event.target.classList.contains('consoleLibraryToolbar')&&event.target.getAttribute('aria-label')!=='Inspect exact creative run'))return;event.preventDefault();const params=new URLSearchParams(new FormData(event.target));for(const [key,value]of [...params])if(!value)params.delete(key);window.__libraryNavigate('/dashboard?'+params.toString());};
  addEventListener('popstate',back);document.addEventListener('submit',submit);return()=>{removeEventListener('popstate',back);document.removeEventListener('submit',submit)};
 },[]);
 return libraryTree(React,modules,state);
}
hydrateRoot(document.getElementById('library-root-island'),<Suspense fallback={<p role='status'>Loading synthetic saved Library…</p>}><Harness/></Suspense>,{onRecoverableError:error=>window.__libraryErrors.push(error.message)});
`;
let bundle;
async function browserBundle() {
  return bundle ??= build({ absWorkingDir: root, bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty' }, logLevel: 'silent', metafile: true,
    stdin: { sourcefile: 'console-library-root-hydration.tsx', resolveDir: root, loader: 'tsx', contents: browserSource }, plugins: [{ name: 'library-root-read-only-boundary', setup(builder) {
      builder.onResolve({filter:/^next\/(link|navigation)$|^@\/components\/stage7\/live-refresh$|^@\/app\/dashboard\/products\/discovery-actions$/},args=>({path:args.path,namespace:'fixture'}));
      builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'js',resolveDir:root,contents:args.path==='next/link'?`import React from 'react';export default function Link({children,...props}){delete props.prefetch;const click=event=>{const url=new URL(String(props.href),location.origin);if(window.__libraryRetained&&url.origin===location.origin&&url.pathname==='/dashboard'&&url.searchParams.get('view')==='library'&&url.searchParams.get('type')!=='research'&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&event.button===0){event.preventDefault();window.__libraryNavigate(url.pathname+url.search+url.hash);}};return React.createElement('a',{...props,onClick:click},children);}`:args.path==='next/navigation'?`export const useRouter=()=>({push:(...args)=>window.__libraryRouter.push(...args),replace:(...args)=>window.__libraryRouter.replace(...args),refresh:(...args)=>window.__libraryRouter.refresh(...args)});`:args.path.includes('live-refresh')?'export const LiveRefresh=()=>null;':`export async function startGeographicDiscovery(){window.__libraryPaidCalls++;throw Error('Paid execution and provider actions are forbidden in this synthetic read-only Library fixture');}`}));
      builder.onResolve({filter:/^@\//},args=>{
        const allowed={'@/lib/core-ui/workflows':'src/lib/core-ui/workflows.ts','@/lib/core-ui/run-outcome':'src/lib/core-ui/run-outcome.ts','@/lib/core-ui/console-collections-query':'src/lib/core-ui/console-collections-query.ts','@/lib/core-ui/console-library-query':'src/lib/core-ui/console-library-query.ts','@/lib/core-ui/quest-draft':'src/lib/core-ui/quest-draft.ts','@/components/stage7/icons':'src/components/stage7/icons.tsx','@/creative/cost-display':'src/creative/cost-display.ts','@/creative/types':'src/creative/types.ts'};
        assert.ok(allowed[args.path],`Forbidden Library browser import: ${args.path}`);return {path:path.join(root,allowed[args.path])};
      });
    }}],
  }).then(result=>{
    const allowed=new Set(['src/components/console/console-shell.tsx','src/components/console/console-shell.css','src/components/console/console-command.tsx','src/components/console/console-command.css','src/components/console/console-collection-panes.tsx','src/components/console/console-collection-panes.css','src/components/console/console-collection-viewport.tsx','src/components/console/console-collection-scroll.ts','src/components/console/console-library-pane.tsx','src/components/console/console-library-pane.css','src/components/console/console-library-preview.tsx','src/components/console/console-library-run-lookup.tsx','src/components/guided/quest-kickoff.tsx','src/components/guided/quest-kickoff.css','src/components/stage7/icons.tsx','src/lib/core-ui/workflows.ts','src/lib/core-ui/run-outcome.ts','src/lib/core-ui/console-collections-query.ts','src/lib/core-ui/console-library-query.ts','src/lib/core-ui/quest-draft.ts','src/creative/cost-display.ts','src/creative/types.ts']);
    for(const file of Object.keys(result.metafile.inputs).filter(file=>file.startsWith('src/')))assert.ok(allowed.has(file),`Server/provider/auth import denied: ${file}`);
    return result.outputFiles[0].text.replace(/<\/script/gi,'<\\/script');
  });
}
export async function libraryDocument(route, { fixture = rootLibraryFixture(), retained = true, deferHydration = false } = {}) {
  const state=await libraryClientState(route,fixture),modules={...fixture.load('src/components/console/console-shell.tsx'),...fixture.load('src/components/console/console-command.tsx'),...fixture.load('src/components/console/console-library-pane.tsx'),...fixture.load('src/components/guided/quest-kickoff.tsx')};
  const markup=renderToString(React.createElement(React.Suspense,{fallback:React.createElement('p',{role:'status'},'Loading synthetic saved Library…')},libraryTree(React,modules,state)));
  const styles=['src/app/globals.css','src/app/stage1.css','src/app/stage3.css','src/app/stage7.css','src/app/stage7-mobile.css','src/app/stage8.css','src/components/console/console-shell.css','src/components/console/console-command.css','src/components/console/console-panes.css','src/components/console/console-collection-panes.css','src/components/console/console-library-pane.css','src/components/guided/quest-kickoff.css'].map(file=>readFileSync(file,'utf8')).join('\n');
  const hydration=await browserBundle();
  // A test-only barrier proves image errors occurring before React listeners exist.
  // It never changes production code or permits any additional request destination.
  const script=deferHydration?`window.__libraryHydrationDeferred=true;window.__libraryStartHydration=()=>{if(!window.__libraryHydrationDeferred)throw Error('Synthetic hydration already started');window.__libraryHydrationDeferred=false;${hydration}};`:hydration;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="data:,"><title>SYNTHETIC actual-root read-only Library fixture</title><style>${styles}</style></head><body data-synthetic-fixture="read-only-library"><div id="library-root-island" style="display:contents">${markup}</div><script>window.__libraryRetained=${JSON.stringify(retained)};window.__libraryState=${JSON.stringify(state).replace(/</g,'\\u003c')}</script><script>${script}</script></body></html>`;
}
