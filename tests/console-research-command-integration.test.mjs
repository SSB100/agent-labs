import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { rootResearchFixture, businessId, selectedId } from './helpers/console-research-root.mjs';
const require = createRequire(import.meta.url), ts = require('typescript');
function commandFixture({ goal = '', savedDraft = 'preserved existing tab draft' } = {}) {
  const f = rootResearchFixture(), drafts = f.load('src/lib/core-ui/quest-draft.ts'), pushes = [], store = new Map([['existing',savedDraft]]), effects = [], refs = [];
  let state = 0;
  const react = { useState: initial => [state++ === 0 ? goal : initial,()=>{}], useEffect: callback => effects.push(callback), useRef: value => { const ref={current:value};refs.push(ref);return ref; }, useTransition:()=>[false,callback=>callback()] };
  const fixtureModule = { exports: {} };
  const source = ts.transpileModule(readFileSync('src/components/console/console-command.tsx','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  runInNewContext(`(function(require,module,exports){${source}\n})`,{window:{sessionStorage:{setItem:(key,value)=>store.set(key,value)}},document:{},HTMLElement:class{}})(name=>{
    if(name==='react')return react;if(name==='react/jsx-runtime')return require(name);if(name==='next/navigation')return{useRouter:()=>({push:(href,options)=>pushes.push({href,options})})};if(name==='@/lib/core-ui/quest-draft')return drafts;if(name.endsWith('.css'))return{};throw Error('Forbidden command dependency '+name);
  },fixtureModule,fixtureModule.exports);
  return {...f,api:fixtureModule.exports,drafts,pushes,store,effects,refs};
}
test('actual command opens the actual Research root sheet with exact scope and Business-bound draft; Close/Escape leave saved tab draft untouched',async()=>{
  const route=`/dashboard?view=research&type=records&selected=${selectedId}&root=${selectedId}&page=3&q=saved&searchField=hypothesis&attemptPage=2&attemptSort=oldest`,f=commandFixture({goal:'Compare original woodland shirts within my saved scope'}),root=await f.render(route);
  const command=f.api.ConsoleCommandBar(root.command);let prevented=0;command.props.onSubmit({preventDefault(){prevented++;}});assert.equal(prevented,1);assert.equal(f.pushes.length,1);
  const opened=new URL(f.pushes[0].href,'https://fixture');assert.equal(opened.searchParams.get('sheet'),'research');assert.equal(opened.searchParams.get('selected'),selectedId);assert.equal(opened.searchParams.get('root'),selectedId);assert.equal(opened.searchParams.get('attemptPage'),'2');assert.equal(opened.searchParams.get('page'),'3');assert.equal(opened.searchParams.has('business'),false);assert.deepEqual({...f.pushes[0].options},{scroll:false});
  const saved=JSON.parse(f.store.get(f.drafts.questDraftStorageKey(f.context.userId)));assert.equal(saved.draft.businessId,businessId);assert.equal(saved.draft.goal,'Compare original woodland shirts within my saved scope');assert.equal(saved.reviewedEstimate,null);assert.ok(!Object.hasOwn(saved.draft,'confirmResearch'));
  const sheetRoot=await f.render(opened.pathname+opened.search),snapshot=[...f.store];const sheet=f.api.ConsoleResearchSheet(sheetRoot.sheet.props);
  sheet.props.onCancel({preventDefault(){prevented++;}});assert.equal(prevented,2);assert.equal(f.pushes[1].href,root.command.returnTo);assert.deepEqual([...f.store],snapshot);
  const header=sheet.props.children[0],button=header.props.children[1];button.props.onClick();assert.equal(f.pushes[2].href,root.command.returnTo);assert.deepEqual([...f.store],snapshot);assert.deepEqual(f.denied,[]);
});
test('empty Research command preserves a pre-existing tab draft, and unavailable Business never falls back to setup creation',async()=>{
  const f=commandFixture(),root=await f.render('/dashboard?view=research'),before=[...f.store];f.api.ConsoleCommandBar(root.command).props.onSubmit({preventDefault(){}});assert.equal(f.pushes.length,1);assert.match(f.pushes[0].href,/sheet=research/);assert.deepEqual([...f.store],before);
  const blocked=f.api.ConsoleCommandBar({...root.command,unavailable:true,businessId:undefined,businessSelectionAvailable:false});blocked.props.onSubmit({preventDefault(){}});assert.equal(f.pushes.length,1);assert.deepEqual([...f.store],before);
});
