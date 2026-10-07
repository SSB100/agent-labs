import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import {runInNewContext} from 'node:vm';

const require=createRequire(import.meta.url),ts=require('typescript');
const compiled=ts.transpileModule(readFileSync(new URL('../src/components/console/console-retained-workspace.tsx',import.meta.url),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},
}).outputText;
const concept='Unsaved inert original concept';

// Execute the production effects against a small, socket-free DOM boundary.
// Layout commit and passive hydration are separately released, never timed.
function fixture(storage=new Map()){
  const node=new EventTarget(),window=new EventTarget();
  node.dataset={retainedActive:'true'};node.scrollTop=0;node.isConnected=true;
  const form={querySelectorAll:()=>[]};
  class Input extends EventTarget{
    constructor(name,type='text'){super();this.name=name;this.type=type;this.defaultValue='';this.current='';}
    get value(){return this.current;}
    set value(value){this.current=value;}
    closest(selector){return selector==='form'?form:null;}
    dispatchEvent(event){const result=super.dispatchEvent(event);if(event.bubbles)node.dispatchEvent(new Event(event.type));return result;}
  }
  class Select extends Input{}
  const input=new Input('concept'),consent=new Input('originalDesign','checkbox'),secret=new Input('token');
  node.querySelectorAll=selector=>selector==='form'?[form]:selector==='details'?[]:[input,consent,secret];
  const root={current:{querySelector:()=>node}};
  const sessionStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)};
  let query=new URLSearchParams({business:'business-one',panel:'new'}),layout,passive,layoutCleanup,passiveCleanup;
  const dependencies={
    react:{useRef:()=>root,useLayoutEffect:fn=>{layout=fn;},useEffect:fn=>{passive=fn;}},
    'react/jsx-runtime':require('react/jsx-runtime'),
    'next/link':{default:()=>null},
    'next/navigation':{usePathname:()=>'/dashboard/products',useSearchParams:()=>query},
    './console-retained-workspace.css':{},
  };
  const fixtureModule={exports:{}};
  runInNewContext(`(function(require,module,exports){${compiled}\n})`,{
    Event,HTMLInputElement:Input,HTMLSelectElement:Select,URLSearchParams,window,sessionStorage,queueMicrotask,
  })(name=>{assert.ok(Object.hasOwn(dependencies,name),`Unexpected production dependency: ${name}`);return dependencies[name];},fixtureModule,fixtureModule.exports);
  const panels=[{id:'new',label:'New candidate',content:null},{id:'candidates',label:'Candidates',content:null}];
  const render=({business='business-one',panel='new',secure=false}={})=>{
    query=new URLSearchParams({business,panel});
    return fixtureModule.exports.ConsoleRetainedWorkspace({ownerId:'inert-owner',header:null,panels,secure});
  };
  const commit=()=>{layoutCleanup?.();layoutCleanup=layout();};
  const hydrate=()=>{passiveCleanup?.();passiveCleanup=passive();};
  const dispose=()=>{layoutCleanup?.();passiveCleanup?.();};
  const edit=value=>{input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));};
  render();
  return{node,input,consent,secret,storage,render,commit,hydrate,dispose,edit};
}

test('retained readiness waits for restoration and input listeners, including delayed reload hydration',()=>{
  const f=fixture();
  assert.equal(f.node.dataset.retainedReady,undefined,'SSR visibility cannot claim client readiness');
  f.commit();assert.equal(f.node.dataset.retainedReady,'false');
  f.hydrate();assert.equal(f.node.dataset.retainedReady,'true');
  f.secret.value='inert-token-sentinel';f.consent.value='on';f.edit(concept);
  assert.equal(f.storage.size,1);
  const [key,raw]=[...f.storage][0];
  assert.ok(key.includes(':/dashboard/products:business-one::new:'));
  assert.deepEqual(JSON.parse(raw).drafts,{'form:0:concept':concept},'Only the exact allowed nonsecret draft is saved');
  f.dispose();assert.equal(f.node.dataset.retainedReady,undefined);

  const reload=fixture(f.storage);
  assert.equal(reload.input.value,'','The server-rendered field starts empty');
  reload.commit();assert.equal(reload.node.dataset.retainedReady,'false');
  assert.equal(reload.input.value,'','A completed layout still does not imply passive hydration');
  assert.equal(reload.storage.get(key),raw,'Waiting for hydration must not overwrite the saved draft');
  reload.hydrate();assert.equal(reload.node.dataset.retainedReady,'true');
  assert.equal(reload.input.value,concept);assert.equal(reload.secret.value,'');assert.equal(reload.consent.value,'');
  assert.deepEqual(JSON.parse(reload.storage.get(key)).drafts,{'form:0:concept':concept});
  reload.edit('Edited after restoration');
  assert.equal(JSON.parse(reload.storage.get(key)).drafts['form:0:concept'],'Edited after restoration','Ready includes installed persistence listeners');
  reload.dispose();
});

test('retained readiness clears at a new Business or panel commit before passive effects run',()=>{
  const f=fixture();f.commit();f.hydrate();f.edit(concept);
  const original=[...f.storage][0];
  f.render({business:'business-two'});f.input.value='';f.commit();
  assert.equal(f.node.dataset.retainedReady,'false','A reused DOM node cannot retain readiness for the old scope');
  f.hydrate();assert.equal(f.node.dataset.retainedReady,'true');assert.equal(f.input.value,'');
  f.edit('Separate Business draft');assert.equal(f.storage.size,2);
  assert.equal(f.storage.get(original[0]),original[1],'Saving a different Business must not mutate the first draft');
  f.render({business:'business-two',panel:'candidates'});f.commit();assert.equal(f.node.dataset.retainedReady,'false');
  f.hydrate();assert.equal(f.node.dataset.retainedReady,'true');
  f.render();f.input.value='';f.commit();assert.equal(f.node.dataset.retainedReady,'false');
  f.hydrate();assert.equal(f.input.value,concept);assert.equal(f.node.dataset.retainedReady,'true');
  f.dispose();assert.equal(f.node.dataset.retainedReady,undefined);
});

test('secure panels never report draft readiness or install storage listeners',()=>{
  const f=fixture();f.commit();f.hydrate();f.edit(concept);
  f.render({secure:true});f.commit();assert.equal(f.node.dataset.retainedReady,'false');
  f.hydrate();assert.notEqual(f.node.dataset.retainedReady,'true');
  const saved=[...f.storage];f.edit('Private edit');assert.deepEqual([...f.storage],saved);
  f.dispose();assert.equal(f.node.dataset.retainedReady,undefined);
});

test('unavailable optional storage still completes initialization without claiming a saved draft',()=>{
  const f=fixture({get(){throw Error('Storage unavailable');},set(){throw Error('Storage unavailable');}});
  f.commit();assert.equal(f.node.dataset.retainedReady,'false');
  f.hydrate();assert.equal(f.node.dataset.retainedReady,'true');assert.equal(f.input.value,'');
  assert.doesNotThrow(()=>f.edit(concept));assert.equal(f.input.value,concept);
  f.dispose();
});
