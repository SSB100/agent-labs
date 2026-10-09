import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { rootResearchFixture, selectedId } from './helpers/console-research-root.mjs';
import { business, findFixtureElement, renderDashboard } from './helpers/guided-ui.mjs';
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
test('ordinary command opens the saved-Quest chooser with exact scope and never writes a hidden legacy draft; Close/Escape preserve storage',async()=>{
  const route=`/dashboard?view=research&type=records&selected=${selectedId}&root=${selectedId}&page=3&q=saved&searchField=hypothesis&attemptPage=2&attemptSort=oldest`,f=commandFixture({goal:'Compare original woodland shirts within my saved scope'}),root=await f.render(route);
  const command=f.api.ConsoleCommandBar(root.command);let prevented=0;command.props.onSubmit({preventDefault(){prevented++;}});assert.equal(prevented,1);assert.equal(f.pushes.length,1);
  const opened=new URL(f.pushes[0].href,'https://fixture');assert.equal(opened.searchParams.get('sheet'),'research');assert.equal(opened.searchParams.get('selected'),selectedId);assert.equal(opened.searchParams.get('root'),selectedId);assert.equal(opened.searchParams.get('attemptPage'),'2');assert.equal(opened.searchParams.get('page'),'3');assert.equal(opened.searchParams.has('business'),false);assert.deepEqual({...f.pushes[0].options},{scroll:false});
  assert.equal(f.store.get(f.drafts.questDraftStorageKey(f.context.userId)),undefined);assert.equal(f.store.get('existing'),'preserved existing tab draft');
  const sheetRoot=await f.render(opened.pathname+opened.search),snapshot=[...f.store];const sheet=f.api.ConsoleResearchSheet(sheetRoot.sheet.props);
  sheet.props.onCancel({preventDefault(){prevented++;}});assert.equal(prevented,2);assert.equal(f.pushes[1].href,root.command.returnTo);assert.deepEqual([...f.store],snapshot);
  const header=sheet.props.children[0],button=header.props.children[1];button.props.onClick();assert.equal(f.pushes[2].href,root.command.returnTo);assert.deepEqual([...f.store],snapshot);assert.deepEqual(f.denied,[]);
});
test('empty Research command preserves a pre-existing tab draft, and unavailable Business never falls back to setup creation',async()=>{
  const f=commandFixture(),root=await f.render('/dashboard?view=research'),before=[...f.store];f.api.ConsoleCommandBar(root.command).props.onSubmit({preventDefault(){}});assert.equal(f.pushes.length,1);assert.match(f.pushes[0].href,/sheet=research/);assert.deepEqual([...f.store],before);
  const blocked=f.api.ConsoleCommandBar({...root.command,unavailable:true,businessId:undefined,businessSelectionAvailable:false});blocked.props.onSubmit({preventDefault(){}});assert.equal(f.pushes.length,1);assert.deepEqual([...f.store],before);
});

const knownBusinesses = [business, { ...business, id: '00000000-0000-4000-8000-000000000911', name: 'Other authorized Business' }];
async function dashboardCommandFixture(options = {}) {
  let tree;
  const markup = await renderDashboard({ view: 'decisions', ...options, inspect: value => { tree = value; } });
  return { tree, markup, command: tree.props.commandBar.props, sheet: findFixtureElement(tree, 'ConsoleResearchSheet') };
}

test('global Decisions with known Businesses opens an unselected Business chooser and preserves its exact return route', async () => {
  const options = { contextOverrides: { businesses: knownBusinesses }, queryOverrides: { page: '2', status: 'all' } };
  const f = commandFixture(), root = await dashboardCommandFixture(options), before = [...f.store];
  assert.equal(root.command.businessId, undefined);
  assert.equal(root.tree.props.navigationBusinessId, undefined);
  assert.equal(root.command.businessSelectionAvailable, true);
  const command = f.api.ConsoleCommandBar(root.command), button = command.props.children.find(child => child.props?.id === 'console-command-open');
  assert.equal(button.props.children[0], 'Choose Business'); assert.equal(button.props.disabled, false);
  command.props.onSubmit({ preventDefault() {} });
  assert.equal(f.pushes.length, 1);
  const opened = new URL(f.pushes[0].href, 'https://fixture');
  assert.equal(opened.searchParams.get('sheet'), 'research'); assert.equal(opened.searchParams.get('page'), '2'); assert.equal(opened.searchParams.get('status'), 'all');
  assert.equal(opened.searchParams.has('business'), false); assert.deepEqual({ ...f.pushes[0].options }, { scroll: false });
  const chooser = await dashboardCommandFixture({ ...options, queryOverrides: Object.fromEntries(opened.searchParams) });
  assert.equal(chooser.sheet.props.returnTo, root.command.returnTo);
  const entry = chooser.sheet.props.children;
  assert.equal(entry.type.name, 'OwnerResearchEntry'); assert.deepEqual(entry.props.businesses, knownBusinesses); assert.equal(entry.props.selectedBusinessId, undefined);
  assert.match(chooser.markup, /<option value="" disabled="" selected="">Choose a Business<\/option>/);
  f.api.ConsoleResearchSheet(chooser.sheet.props).props.onCancel({ preventDefault() {} });
  assert.equal(f.pushes[1].href, root.command.returnTo); assert.deepEqual({ ...f.pushes[1].options }, { scroll: false }); assert.deepEqual([...f.store], before);
});

test('a genuinely empty Business directory opens the real workspace setup instead of a Business chooser', async () => {
  const options = { empty: true, contextOverrides: { businesses: [] } };
  const f = commandFixture(), root = await dashboardCommandFixture(options), before = [...f.store];
  assert.equal(root.command.businessId, undefined); assert.equal(root.command.businessSelectionAvailable, false);
  const command = f.api.ConsoleCommandBar(root.command), button = command.props.children.find(child => child.props?.id === 'console-command-open');
  assert.equal(button.props.children[0], 'Create workspace'); assert.equal(button.props.disabled, false);
  command.props.onSubmit({ preventDefault() {} });
  assert.equal(f.pushes.length, 1); assert.equal(f.pushes[0].href, '/dashboard?view=advanced#workspace-setup');
  const setup = await dashboardCommandFixture({ ...options, view: 'advanced' });
  assert.match(setup.markup, /<details[^>]*id="workspace-setup"[^>]*open=""/);
  assert.match(setup.markup, /<input(?=[^>]*name="name")(?=[^>]*required="")[^>]*>/);
  assert.match(setup.markup, /<button class="coreButton coreButton-primary" type="submit">Create workspace<\/button>/);
  assert.equal(setup.sheet, null); assert.deepEqual([...f.store], before);
});

for (const businesses of [[], knownBusinesses]) test(`unavailable global Business directory with ${businesses.length} cached entries stays disabled and cannot open setup or a chooser`, async () => {
  const f = commandFixture(), root = await dashboardCommandFixture({ empty: true, businessesUnavailable: true, contextOverrides: { businesses } }), before = [...f.store];
  assert.equal(root.command.businessId, undefined); assert.equal(root.command.unavailable, true);
  const command = f.api.ConsoleCommandBar(root.command), button = command.props.children.find(child => child.props?.id === 'console-command-open');
  assert.equal(button.props.children[0], 'Unavailable'); assert.equal(button.props.disabled, true);
  command.props.onSubmit({ preventDefault() {} });
  assert.equal(f.pushes.length, 0); assert.deepEqual([...f.store], before);
  const sheet = await dashboardCommandFixture({ empty: true, businessesUnavailable: true, contextOverrides: { businesses }, sheet: true });
  assert.match(sheet.markup, /Business records are unavailable\. Reload before choosing a Business\./);
  assert.doesNotMatch(sheet.markup, /<select name="business" required=""/);
});
