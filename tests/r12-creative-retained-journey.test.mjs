import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
import {openR12CreativeDisclosure,r12CreativeControls,preparedReceipt} from './next-fixture/r12-creative-journey.mjs';

const require=createRequire(import.meta.url),ts=require('typescript'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const id=n=>`aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12,'0')}`;
function source(file,dependencies,globals={}){
 const code=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 const fixtureModule={exports:{}};runInNewContext(`(function(require,module,exports){${code}\n})`,globals)(name=>{
  if(Object.hasOwn(dependencies,name))return dependencies[name];
  if(['react','react/jsx-runtime'].includes(name))return require(name);
  throw Error('Unexpected source dependency: '+name);
 },fixtureModule,fixtureModule.exports);return fixtureModule.exports;
}

// Actual production persistence effects with explicitly released hydration. The
// socket-free DOM/locator boundary models native details toggles, not UI markup.
function retainedFixture(storage=new Map(),creativeRunId=id(3)){
 const node=new EventTarget(),window=new EventTarget(),events=[];node.dataset={retainedActive:'true'};node.scrollTop=0;
 const details={id:`creative-run-${creativeRunId}`,open:false,closest:()=>null,querySelector:()=>({textContent:'Original compositionqueued · 0 unknown charge(s)'})};
 node.querySelectorAll=selector=>selector==='details'?[details]:[];
 let layout,passive,layoutCleanup,passiveCleanup,ready;
 const initialized=new Promise(resolve=>{ready=resolve;});
 const api=source('src/components/console/console-retained-workspace.tsx',{
  react:{useRef:()=>({current:{querySelector:()=>node}}),useLayoutEffect:fn=>{layout=fn;},useEffect:fn=>{passive=fn;}},
  'next/link':{default:()=>null},'next/navigation':{usePathname:()=>'/dashboard/artifacts',useSearchParams:()=>new URLSearchParams({business:id(1),panel:'receipts'})},'./console-retained-workspace.css':{},
 },{URLSearchParams,window,sessionStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)}});
 api.ConsoleRetainedWorkspace({ownerId:'inert-owner',header:null,panels:[{id:'receipts',label:'Approvals & receipts',content:null}]});layoutCleanup=layout();
 const toggle=()=>{events.push('summary click');details.open=!details.open;node.dispatchEvent(new Event('toggle'));};
 const disclosure={waitFor:async()=>{events.push('disclosure visible');},getAttribute:async name=>{assert.equal(name,'open');events.push('read open');return details.open?'':null;},locator:selector=>{
  if(selector===':scope > summary')return{click:async()=>toggle()};
  assert.equal(selector,'section[aria-label="Focused production run controls"]');return controls;
 }};
 const controls={waitFor:async()=>{assert.equal(node.dataset.retainedReady,'true');assert.equal(details.open,true);},count:async()=>1,locator:selector=>{assert.equal(selector,'form input[name="approvalId"]');return{first:()=>({inputValue:async()=>id(2)})};}};
 const page={locator:selector=>{assert.equal(selector,'[data-retained-active="true"][data-retained-ready="true"][aria-label="Approvals & receipts details"]');return{
  waitFor:async()=>{events.push('wait for restoration');await initialized;},locator:selector=>{assert.equal(selector,`#${details.id}`);return disclosure;},
 };}};
 return{page,controls,details,events,storage,disclosure,toggle,hydrate:()=>{passiveCleanup=passive();ready();},leave:()=>{window.dispatchEvent(new Event('pagehide'));layoutCleanup?.();passiveCleanup?.();}};
}

test('exact creative controls wait for restoration and never close a retained-open run on financial-policy return',async()=>{
 const first=retainedFixture();const opening=r12CreativeControls(first.page,id(2),id(3));
 assert.deepEqual(first.events,['wait for restoration']);assert.equal(first.details.open,false);
 first.hydrate();assert.equal(await opening,first.controls);assert.equal(first.events.filter(x=>x==='summary click').length,1);first.leave();
 const returned=retainedFixture(first.storage),recovered=r12CreativeControls(returned.page,id(2),id(3));
 assert.deepEqual(returned.events,['wait for restoration']);assert.equal(returned.details.open,false);
 returned.hydrate();assert.equal(await recovered,returned.controls);assert.equal(returned.details.open,true);
 assert.equal(await returned.disclosure.getAttribute('open'),'','A present boolean HTML attribute is the empty string');
 assert.equal(returned.events.filter(x=>x==='summary click').length,0,'Returning must preserve the restored-open disclosure');
 // Reproduce the old journey: an unconditional summary click hides the controls.
 returned.toggle();assert.equal(returned.details.open,false);await assert.rejects(returned.controls.waitFor());
 await openR12CreativeDisclosure(returned.disclosure);assert.equal(returned.details.open,true);returned.leave();
});

test('closed and open receipt disclosures are opened once without blind toggle or retry',async()=>{
 const f=retainedFixture();f.hydrate();await openR12CreativeDisclosure(f.disclosure);await openR12CreativeDisclosure(f.disclosure);
 assert.equal(f.events.filter(x=>x==='summary click').length,1);f.leave();
});

test('exact creative disclosure rejects a different approval or run instead of finding a global fallback',async()=>{
 const f=retainedFixture();f.hydrate();await assert.rejects(r12CreativeControls(f.page,id(99),id(3)));await assert.rejects(r12CreativeControls(f.page,id(2),id(99)));f.leave();
});

test('actual focused action and controls retain the same receipt through Prepare, denied Start, launch and duplicate Start',async()=>{
 const receipt={businessId:id(1),approvalId:id(2),creativeRunId:id(3),workflowRunId:id(4),goalId:id(5),approvalHash:'a'.repeat(64),admissionKeyHash:'b'.repeat(64),runtimeCapabilityHash:'c'.repeat(64),dispatchAuthorized:false};
 let authorized=false,launches=0,prepared=0,state={message:'',receipt:null,workflowRunId:null};
 const {focusedCreativeRunAction}=source('src/app/dashboard/artifacts/focused-actions.ts',{
  '@/lib/core-ui/data':{requireOwnerUiContext:async()=>({userId:id(6)})},
  '@/creative/focused-owner-server':{prepareFocusedCreativeRun:async(_context,approvalId)=>{assert.equal(approvalId,receipt.approvalId);prepared++;return receipt;},startFocusedCreativeRun:async(_context,approvalId)=>{assert.equal(approvalId,receipt.approvalId);if(!authorized)throw Error('No scoped authority');const started=launches===0;if(started)launches++;return{started,workflowRunId:receipt.workflowRunId};}},
 });
 const {ConsoleFocusedRunControls}=source('src/components/console/console-focused-run-controls.tsx',{
  react:{...React,useActionState:()=>[state,()=>{}]},'next/link':({children,...props})=>React.createElement('a',props,children),
  '@/app/dashboard/artifacts/focused-actions':{focusedCreativeRunAction},'@/components/stage13/products-workspace':{ProductSubmitButton:({children})=>React.createElement('button',{type:'submit'},children)},
 });
 const render=()=>renderToStaticMarkup(React.createElement(ConsoleFocusedRunControls,{approvalId:receipt.approvalId,businessId:receipt.businessId,goalId:receipt.goalId}));
 const act=async operation=>{const form=new FormData();form.set('approvalId',receipt.approvalId);form.set('operation',operation);state=await focusedCreativeRunAction(state,form);return render();};
 let html=render();assert.match(html,/>Prepare focused creative run<\/button>/);assert.doesNotMatch(html,/Start scoped production design|Creative setup receipt/);
 html=await act('prepare');assert.equal(prepared,1);assert.equal(launches,0);assert.equal(state.receipt,receipt);
 assert.match(html,/>Recover prepared creative run<\/button>/);assert.match(html,/>Start scoped production design<\/button>/);assert.match(html,/Nonsecret creative setup receipt/);
 assert.equal((html.match(new RegExp(`name="approvalId" value="${receipt.approvalId}"`,'g'))??[]).length,2);
 html=await act('start');assert.match(html,/exact scoped permission could not be verified/);assert.equal(state.receipt,receipt);assert.equal(launches,0);
 // A document navigation remounts action state; the recovered receipt stays exact.
 state={message:'',receipt:null,workflowRunId:null};authorized=true;html=await act('prepare');assert.equal(prepared,2);assert.equal(state.receipt,receipt);assert.equal(launches,0);
 html=await act('start');assert.match(html,/approved four-phase workflow has started/);assert.equal(state.receipt,receipt);assert.equal(launches,1);
 html=await act('start');assert.match(html,/already claimed/);assert.equal(state.receipt,receipt);assert.equal(launches,1);
 assert.match(html,new RegExp(`href="/dashboard/workflows/${receipt.workflowRunId}\\?business=${receipt.businessId}"`));assert.match(html,/>Start scoped production design<\/button>/);
});


test('receipt recovery uses the one exact descendant disclosure and rejects duplicate or mismatched summaries',async()=>{
 const receipt={approvalId:id(2),creativeRunId:id(3),workflowRunId:id(4)};
 function fixture({count=1,summary='Nonsecret creative setup receipt',open=false}={}){
  let clicks=0;
  const disclosure={count:async()=>count,waitFor:async()=>{},getAttribute:async name=>{assert.equal(name,'open');return open?'':null;},locator:selector=>{
   assert.equal(selector,':scope > summary');return{textContent:async()=>summary,click:async()=>{clicks++;open=!open;}};
  }};
  const controls={locator:selector=>{assert.equal(selector,'details');return disclosure;},getByRole:(role,options)=>{
   assert.equal(options.exact,true);
   if(role==='button'){assert.equal(options.name,'Recover prepared creative run');return{waitFor:async()=>{}};}
   assert.equal(role,'textbox');assert.equal(options.name,'Creative setup receipt');return{inputValue:async()=>{assert.equal(open,true);return JSON.stringify(receipt);}};
  }};
  return{controls,clicks:()=>clicks};
 }
 for(const open of [false,true]){const f=fixture({open});assert.deepEqual(await preparedReceipt(f.controls),receipt);assert.deepEqual(await preparedReceipt(f.controls),receipt);assert.equal(f.clicks(),open?0:1);}
 for(const options of [{count:0},{count:2},{summary:'Different receipt'}]){const f=fixture(options);await assert.rejects(preparedReceipt(f.controls));assert.equal(f.clicks(),0);}
});
