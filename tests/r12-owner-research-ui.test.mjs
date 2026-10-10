import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {webcrypto} from 'node:crypto';
import path from 'node:path';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import sharp from 'sharp';

// Technical UI fixtures only. There are no real provider calls, source permissions,
// shop claims, demand observations, purchases or production mutations here.
const require=createRequire(import.meta.url),id=n=>`12080000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const Link=({children,...props})=>React.createElement('a',props,children);
function load(file,dependencies={},globals={}) {
  const output=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  const fixtureModule={exports:{}};
  new Function('require','module','exports',...Object.keys(globals),output)(name=>{
    if(Object.hasOwn(dependencies,name))return dependencies[name];
    if(['react','react/jsx-runtime'].includes(name))return require(name);
    if(name==='next/link')return Link;
    if(name==='./owner-observation-intake')return {OwnerObservationIntakeForm:()=>null};
    if(name==='./owner-observation-disclosure')return {OwnerObservationDisclosure:()=>null};
    if(name.endsWith('.css'))return{};
    throw Error(`Unexpected dependency: ${name}`);
  },fixtureModule,fixtureModule.exports,...Object.values(globals));return fixtureModule.exports;
}
const money=load('src/lib/core-ui/owner-research-form.ts');
const packet=load('src/components/quests/owner-research-packet.tsx',{'@/lib/core-ui/owner-research-form':money});
const entry=load('src/components/quests/owner-research-entry.tsx');
function fixture({legacy=true,expired=false}={}) {
  const now=Date.now(),business={id:id(1),revision:3,hash:'a'.repeat(64),capRevision:2,maximumMicrounits:'5000000',committedMicrounits:'1900000',hasUnknown:false,paused:false};
  const goal={id:id(2),businessId:id(1),revision:4,hash:'b'.repeat(64),preference:'ready',initialRunExists:false,content:{title:'Synthetic technical Quest',objective:'Exercise the original saved objective without claiming market demand.',originalIntent:'Exercise the original saved objective without claiming market demand.',parsed:{},ambiguities:[]}};
  const profile={id:id(3),title:'Synthetic reviewed profile',purpose:'Synthetic configuration for rendering, with no production permission.',marketSets:[{key:'gb',label:'United Kingdom',markets:[{countryCode:'GB',currency:'GBP'}]}],topics:[{key:'astronomy',label:'Astronomy',audience:'Adult astronomy enthusiasts'}]};
  const funding={binding:{kind:legacy?'legacy_research_root':'r05_business',authorityRootId:legacy?id(8):id(1)},revision:2,hash:'f'.repeat(64),maximumMicrounits:legacy?'2000000':'5000000',committedMicrounits:'1900000',pendingMicrounits:'0',hasUnknown:false};
  const preview={businessId:id(1),goalId:id(2),goalRevision:4,title:goal.content.title,objective:goal.content.objective,profileId:id(3),profileHash:'c'.repeat(64),selection:{marketSetKey:'gb',topicKey:'astronomy'},approvedQuery:'Synthetic reviewed public query for adult interests in GB',sourceDomains:['research.example'],excludedDomains:['etsy.com'],markets:profile.marketSets[0].markets,audience:'Adult astronomy enthusiasts',funding,
    finance:{currentBusinessLimitMicrounits:'5000000',proposedBusinessLimitMicrounits:'6000000',businessCommittedMicrounits:'1900000',minimumBusinessLimitMicrounits:'2300000',expectedCapRevision:2,changesBusinessLimit:true,proposedResearchLimitMicrounits:legacy?'2500000':'6000000',minimumResearchLimitMicrounits:'2300000',changesResearchLimit:true},
    quote:{ceilings:{plan:100000,search1:100000,select1:100000,strategy:50000,review:50000},maximumMicrousd:400000,verifiedAt:new Date(now-60000).toISOString(),validUntil:new Date(now+(expired?-1:240000)).toISOString(),luna:{providerName:'Synthetic Azure',modelId:'synthetic-luna',endpoint:'azure/us'},reviewer:{providerName:'Synthetic Bedrock',modelId:'synthetic-reviewer',endpoint:'amazon-bedrock/us'}},maximumCalls:5,maximumCollections:1,maximumRepairs:0,dispatchMinutes:30,receiptMinutes:30,maximumReceiptChecks:15};
  const receipt={businessId:id(1),goalId:id(2),setupId:id(10),scopeId:id(11),grantId:id(4),submissionId:id(5),setupHash:'d'.repeat(64),policyId:id(12),policyHash:'e'.repeat(64),confirmed:false,activated:false,stopped:false,preview};
  return{now,receipt,catalog:{business,goal,funding,profiles:[{profile,profileHash:preview.profileHash,grantId:id(4)}],setups:[receipt]}};
}
const elements=(tree,predicate)=>!tree||typeof tree!=='object'?[]:[...(predicate(tree)?[tree]:[]),...React.Children.toArray(tree.props?.children).flatMap(child=>elements(child,predicate))];
const button=(tree,label)=>elements(tree,e=>e.type==='button'&&e.props.children===label)[0];
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate){for(let i=0;i<200&&!predicate();i++)await new Promise(resolve=>setTimeout(resolve,5));assert.ok(predicate(),'Local action should settle without external work');}
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};

function harness(f=fixture(),{selectedReceipt=f.receipt,actions={},storage=new Map()}={}) {
  let stateIndex=0,refIndex=0,effectIndex=0,sequence=100;const states=[],refs=[],effects=[],calls=[],navigation=[],listeners=new Map();
  const hooks={...React,useId:()=>':synthetic-owner-form:',useState(initial){const index=stateIndex++;if(!(index in states))states[index]=initial;return[states[index],value=>states[index]=typeof value==='function'?value(states[index]):value];},useRef(initial){const index=refIndex++;return refs[index]??={current:initial};},useEffect(fn){const index=effectIndex++;effects[index]??=fn;}};
  const actionModule={};for(const name of ['prepareOwnerResearchAction','prepareOwnerResearchEpisodeAction','confirmOwnerResearchAction','stopOwnerResearchAction'])actionModule[name]=async input=>{calls.push({name,input});return actions[name]?actions[name](input):{ok:true,receipt:{...f.receipt,confirmed:name==='confirmOwnerResearchAction',stopped:name==='stopOwnerResearchAction'}};};
  const sessionStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)};
  const view=load('src/components/quests/owner-research-workspace.tsx',{react:hooks,'next/navigation':{useRouter:()=>({replace:href=>navigation.push(['replace',href]),refresh:()=>navigation.push(['refresh'])})},'@/app/dashboard/quests/research/actions':actionModule,'@/lib/core-ui/owner-research-form':money,'./owner-research-packet':packet},{window:{sessionStorage,setInterval:()=>1,clearInterval:()=>{},addEventListener:(name,handler)=>listeners.set(name,handler),removeEventListener:name=>listeners.delete(name)},crypto:{subtle:webcrypto.subtle,randomUUID:()=>id(++sequence)},TextEncoder});
  const props={ownerId:id(90),catalog:f.catalog,selectedReceipt,observedAt:f.now};
  function render(){stateIndex=0;refIndex=0;effectIndex=0;return view.OwnerResearchWorkspace(props);}
  render();const cleanups=effects.map(effect=>effect());
  return{render,calls,navigation,storage,states,event:name=>listeners.get(name)?.(),unmount(){for(const cleanup of cleanups)cleanup?.();}};
}

test('ordinary launchers navigate to real saved Quests and never import legacy dispatch',()=>{
  const html=renderToStaticMarkup(React.createElement(entry.OwnerResearchEntry,{businesses:[{id:id(1),name:'Synthetic Business'}]}));
  assert.match(html,/action="\/dashboard\/quests\/research"/);assert.match(html,/<option value="" disabled="" selected="">Choose a Business/);
  assert.doesNotMatch(html,/confirmResearch|Start bounded research/);
  for(const file of ['src/app/dashboard/page.tsx','src/app/dashboard/products/page.tsx','src/components/console/console-research-dashboard.tsx','src/components/console/console-workspace-overview.tsx','src/components/console/console-library-dashboard.tsx','src/components/console/console-populated-dashboard.tsx']){
    const source=readFileSync(file,'utf8');assert.match(source,/OwnerResearchEntry/);assert.doesNotMatch(source,/QuestKickoff|startGeographicDiscovery/);
  }
  assert.match(readFileSync('src/components/quests/quest-workspace.tsx','utf8'),/Research this Quest/);
});

test('USD ceilings use exact integer arithmetic and reject rounded, signed, exponent or oversized values',()=>{
  for(const [input,expected]of [['0.000001','1'],['2.123456','2123456'],['9007199254.740991','9007199254740991']])assert.equal(money.ownerResearchUsdMicrounits(input),expected);
  for(const value of ['0','-1','+2','1e2','1.1234567','01.2','9007199254.740992','Infinity'])assert.equal(money.ownerResearchUsdMicrounits(value),null);
  assert.equal(money.ownerResearchUsd('2500001'),'USD 2.500001');
});

test('stored packet discloses all five phases, original funding extension, sources, recipients and bounded windows',()=>{
  const {receipt}=fixture();const html=renderToStaticMarkup(React.createElement(packet.OwnerResearchPacket,{receipt}));
  for(const text of ['Exercise the original saved objective','Planner','One public-source collection','Exact-span evidence selector','Strategist','Independent reviewer','USD 0.400000','USD 5.000000','USD 6.000000','USD 2.000000','USD 2.500000','Every prior cost remains','research.example','OpenRouter','zero-data-retention','30 minutes','15 receipt checks','setup hash'])assert.ok(html.toLowerCase().includes(text.toLowerCase()),text);
  const native=fixture({legacy:false}),nativeHtml=renderToStaticMarkup(React.createElement(packet.OwnerResearchPacket,{receipt:native.receipt}));
  assert.match(nativeHtml,/one cumulative cap/);assert.doesNotMatch(nativeHtml,/Original cumulative research funding/);
  assert.match(money.ownerResearchWorkspaceHref(receipt),new RegExp(`selected=${receipt.scopeId}`));assert.ok(!money.ownerResearchWorkspaceHref(receipt).includes(receipt.setupId));
});

test('native funding has only one cap input while legacy keeps its original cumulative total visible',()=>{
  for(const legacy of [false,true]){
    const f=fixture({legacy}),h=harness(f,{selectedReceipt:null}),tree=h.render();
    assert.equal(elements(tree,e=>e.type==='input'&&e.props.inputMode==='decimal').length,legacy?2:1);
    assert.equal(h.calls.length,0,'Rendering never prepares, confirms or dispatches');
    assert.ok(elements(tree,e=>e.type==='select').every(select=>select.props.value===''),'No first-profile, market or topic fallback');
  }
});

test('owner select labels have exact text independent of options and unique explicit associations',()=>{
  const f=fixture(),{OwnerResearchWorkspace}=load('src/components/quests/owner-research-workspace.tsx',{'next/navigation':{useRouter:()=>({})},'@/app/dashboard/quests/research/actions':{},'@/lib/core-ui/owner-research-form':money,'./owner-research-packet':packet});
  const expected=['Reviewed research profile','Public market set','Public topic and adult audience'];
  // Render real React IDs, including two instances of the same Quest. Exercise
  // both empty and populated options because nested OPTION text caused the bug.
  for(const selectedReceipt of [null,f.receipt]){
    const props={ownerId:id(90),catalog:f.catalog,selectedReceipt,observedAt:f.now};
    const html=renderToStaticMarkup(React.createElement(React.Fragment,null,React.createElement(OwnerResearchWorkspace,props),React.createElement(OwnerResearchWorkspace,props)));
    const selects=[...html.matchAll(/<select\b([^>]*)>/g)];assert.equal(selects.length,6);
    const ids=selects.map(([,attributes])=>{const match=attributes.match(/\bid="([^"]+)"/);assert.ok(match,'Every owner select has an ID');return match[1];});
    assert.equal(new Set(ids).size,6,'Repeated workspace instances cannot share control IDs');
    const labels=[...html.matchAll(/<label\b[^>]*for="([^"]+)"[^>]*>([\s\S]*?)<\/label>/g)];
    ids.forEach((controlId,index)=>{
      const associated=labels.filter(([,target])=>target===controlId);assert.equal(associated.length,1,'Each select has exactly one associated label');
      assert.equal(associated[0][2],expected[index%expected.length],'Label text must not include a select or option text');
    });
  }
  const h=harness(),before=elements(h.render(),node=>node.type==='select').map(node=>node.props.id);
  elements(h.render(),node=>node.type==='select')[1].props.onChange({target:{value:'gb'}});
  assert.deepEqual(elements(h.render(),node=>node.type==='select').map(node=>node.props.id),before,'Control IDs survive selection edits');
});

test('failed browser stages retain bounded DOM, exact label text, actual accessible names and screenshot outcomes',async()=>{
  const files=new Map(),screenshots=[];
  const {captureOwnerJourneyFailure}=load('tests/next-fixture/r12-owner-initial-journey.mjs',{'node:assert/strict':assert,'node:path':path,'node:fs/promises':{writeFile:async(file,text)=>files.set(file,JSON.parse(text))},'playwright-core':{},sharp,'./r12-sql.mjs':{},'./r12-owner-initial.mjs':{extendOwnerInitialNextAllowance:()=>{throw Error('Diagnostics must not mutate the SQL fixture');}},'./browser-zoom.mjs':{},'./r12-etsy-intake-journey.mjs':{saveEtsyCaptureThroughOwnerUi:()=>{throw Error('Diagnostics must not save captures');}},'./r12-etsy-branch.mjs':{snapshotConfirmedEtsyBranch:()=>{throw Error('Diagnostics must not mutate the SQL fixture');}}});
  const control={tagName:'SELECT',id:'owner-profile',getAttribute:()=>null,labels:[{textContent:'Reviewed research profile Choose a profile Synthetic profile'}],matches:()=>false};
  const overflowing={...control,clientWidth:290,scrollWidth:579,getBoundingClientRect:()=>({left:15,right:594,width:579,height:44})};
  const page={url:()=>`http://localhost/owner?${'x'.repeat(3000)}`,locator:()=>({evaluate:async evaluate=>evaluate({ownerDocument:{documentElement:{clientWidth:320,clientHeight:800,scrollWidth:579,scrollHeight:5722}},innerText:'x'.repeat(20000),querySelectorAll:selector=>Array(100).fill(selector==='*'?overflowing:control)}),ariaSnapshot:async()=>`- combobox "Reviewed research profile":\n${'x'.repeat(20000)}`}),screenshot:async options=>{screenshots.push(options);}};
  const result=await captureOwnerJourneyFailure({page,output:'/inert-fixture',stage:'Choose exact profile',index:2});
  const saved=files.get(path.join('/inert-fixture','failed-stage-02.json'));
  assert.equal(saved.stage,'Choose exact profile');assert.equal(saved.url.length,2048);assert.equal(saved.dom.text.length,12000);assert.equal(saved.dom.controls.length,60);
  assert.deepEqual(saved.dom.viewport,{width:320,height:800,documentWidth:579,documentHeight:5722});assert.equal(saved.dom.overflow.length,40);assert.equal(saved.dom.overflow[0].right,594,'Overflow evidence identifies the actual offending bounds without changing layout');
  assert.deepEqual(saved.dom.controls[0].labels,[control.labels[0].textContent],'Keep the actual label text that exact getByLabel used, including unexpected options');
  assert.match(saved.accessibleNames,/combobox "Reviewed research profile"/);assert.equal(saved.accessibleNames.length,16000);
  assert.deepEqual(result,{diagnostic:'failed-stage-02.json',screenshot:'failed-stage-02.png'});assert.equal(screenshots[0].fullPage,false);assert.equal(screenshots[0].timeout,3000);
  page.locator=()=>({evaluate:async()=>{throw Error('DOM unavailable');},ariaSnapshot:async()=>{throw Error('Names unavailable');}});page.screenshot=async()=>{throw Error('Screenshot unavailable');};
  const unavailable=await captureOwnerJourneyFailure({page,output:'/inert-fixture',stage:'Unavailable browser',index:3});
  assert.deepEqual(unavailable,{diagnostic:'failed-stage-03.json'});assert.equal(files.get(path.join('/inert-fixture','failed-stage-03.json')).errors.length,3,'Capture failures stay reviewable without replacing the journey failure');
});

test('owner zoom evidence rejects blank native captures and offscreen or obscured confirmation targets',async()=>{
  const files=new Map(),calls=[],rect={left:20,right:620,top:280,bottom:324,width:600,height:44};let hit=true;
  const element={getBoundingClientRect:()=>rect},blank=await sharp({create:{width:1280,height:720,channels:3,background:{r:17,g:24,b:32}}}).png().toBuffer();
  const panel=await sharp({create:{width:600,height:100,channels:3,background:'#ffffff'}}).png().toBuffer();
  let pixels=await sharp(blank).composite([{input:panel,left:40,top:560}]).png().toBuffer();
  const {captureOwnerZoomViewport}=load('tests/next-fixture/r12-owner-initial-journey.mjs',{'node:assert/strict':assert,'node:path':path,'node:fs/promises':{writeFile:async(file,data)=>files.set(file,data)},'playwright-core':{},sharp,'./r12-sql.mjs':{},'./r12-owner-initial.mjs':{extendOwnerInitialNextAllowance:()=>{throw Error('Diagnostics must not mutate the SQL fixture');}},'./browser-zoom.mjs':{},'./r12-etsy-intake-journey.mjs':{saveEtsyCaptureThroughOwnerUi:()=>{throw Error('Diagnostics must not save captures');}},'./r12-etsy-branch.mjs':{snapshotConfirmedEtsyBranch:()=>{throw Error('Diagnostics must not mutate the SQL fixture');}}},{innerWidth:640,innerHeight:360,document:{elementFromPoint:(x,y)=>{assert.equal(x,rect.left+rect.width/2);assert.equal(y,rect.top+rect.height/2);return hit?element:null;}},requestAnimationFrame:callback=>{calls.push('paint');callback();}});
  const cdp={send:async(method,options)=>{calls.push([method,options]);return{data:pixels.toString('base64')};},detach:async()=>calls.push('detach')};
  const page={bringToFront:async()=>calls.push('foreground'),evaluate:async evaluate=>evaluate(),viewportSize:()=>({width:1280,height:720}),context:()=>({newCDPSession:async()=>cdp})};
  const target={scrollIntoViewIfNeeded:async()=>calls.push('scroll'),evaluate:async evaluate=>evaluate(element)};
  const capture=()=>captureOwnerZoomViewport({page,target,output:'/inert-fixture',name:'owner-packet-controls-zoom200.png'});
  await capture();assert.deepEqual(calls,['foreground','scroll','paint','paint',['Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false}],'detach']);
  assert.deepEqual(files.get(path.join('/inert-fixture','owner-packet-controls-zoom200.png')),pixels);
  pixels=blank;calls.length=0;await assert.rejects(capture(),/actual zoom capture must contain rendered content/);assert.equal(calls.at(-1),'detach');assert.deepEqual(files.get(path.join('/inert-fixture','owner-packet-controls-zoom200.png')),blank,'Keep rejected pixels for diagnosis');
  for(const invalid of [{bottom:361},{right:641},{top:-1},{left:-1},{width:0},{height:0},{hit:false}]){
    const original={...rect};calls.length=0;Object.assign(rect,invalid);hit=invalid.hit!==false;
    await assert.rejects(capture(),/captured target must be visible and hit-testable/);assert.ok(!calls.some(call=>Array.isArray(call)),'Do not accept a screenshot of an unreachable target');Object.assign(rect,original);
  }
});

test('consent binds the exact setup hash, clears on edits/reload, and cannot authorize an expired quote',()=>{
  const f=fixture(),h=harness(f);let tree=h.render();assert.equal(button(tree,'Confirm this exact research policy').props.disabled,true);
  elements(tree,e=>e.type==='input'&&e.props.type==='checkbox')[0].props.onChange({target:{checked:true}});
  tree=h.render();assert.equal(button(tree,'Confirm this exact research policy').props.disabled,false);
  elements(tree,e=>e.type==='select')[1].props.onChange({target:{value:'gb'}});
  assert.equal(h.states[6],null);assert.equal(h.states[5],null,'Edited packet is discarded');
  const reloaded=harness(f);assert.equal(button(reloaded.render(),'Confirm this exact research policy').props.disabled,true);
  assert.equal(money.ownerResearchCanConfirm(f.receipt,'not-the-exact-hash',f.now),false);
  const expired=fixture({expired:true});assert.equal(money.ownerResearchCanConfirm(expired.receipt,expired.receipt.setupHash,expired.now),false);
});

test('native history and restored pages explicitly clear unsent consent',()=>{
  const h=harness();
  for(const event of ['popstate','pageshow']){
    elements(h.render(),e=>e.type==='input'&&e.props.type==='checkbox')[0].props.onChange({target:{checked:true}});
    assert.equal(button(h.render(),'Confirm this exact research policy').props.disabled,false);
    h.event(event);assert.equal(button(h.render(),'Confirm this exact research policy').props.disabled,true);
  }
});

test('confirmation blocks repeated clicks, transmits only exact receipt identity and supports interrupted retry',async()=>{
  const f=fixture(),waiting=deferred(),h=harness(f,{actions:{confirmOwnerResearchAction:()=>waiting.promise}});
  let tree=h.render();elements(tree,e=>e.type==='input'&&e.props.type==='checkbox')[0].props.onChange({target:{checked:true}});tree=h.render();
  button(tree,'Confirm this exact research policy').props.onClick();button(tree,'Confirm this exact research policy').props.onClick();await until(()=>h.calls.length===1);
  assert.deepEqual(Object.keys(h.calls[0].input).sort(),['businessId','setupHash','setupId','submissionId']);
  assert.equal(h.calls[0].input.setupHash,f.receipt.setupHash);assert.equal(button(h.render(),'Confirm this exact research policy').props.disabled,true);
  waiting.resolve({ok:false,message:'Synthetic interrupted confirmation'});await until(()=>h.states[8]===null);
  button(h.render(),'Confirm this exact research policy').props.onClick();await until(()=>h.calls.length===2);
  assert.equal(h.calls[0].input.submissionId,h.calls[1].input.submissionId);assert.equal(h.navigation.length,0);
  assert.ok([...h.storage.values()].every(value=>/^[a-f0-9-]{36}$/.test(value)));
});

test('preparation transmits IDs/choices/ceilings only and native research cap equals Business cap',async()=>{
  const f=fixture({legacy:false}),h=harness(f,{selectedReceipt:null,actions:{prepareOwnerResearchAction:async()=>({ok:false,message:'Synthetic saved-state check'})}});
  let tree=h.render();elements(tree,e=>e.type==='select')[0].props.onChange({target:{value:`${id(3)}:${id(4)}`}});tree=h.render();
  elements(tree,e=>e.type==='select')[1].props.onChange({target:{value:'gb'}});elements(h.render(),e=>e.type==='select')[2].props.onChange({target:{value:'astronomy'}});
  elements(h.render(),e=>e.type==='form')[0].props.onSubmit({preventDefault(){}});await until(()=>h.calls.length===1);
  const input=h.calls[0].input;assert.equal(input.businessLifetimeLimitMicrounits,'5000000');assert.equal(input.researchLifetimeLimitMicrounits,input.businessLifetimeLimitMicrounits);
  assert.deepEqual(Object.keys(input).sort(),['businessId','businessLifetimeLimitMicrounits','goalId','goalRevision','grantId','marketSetKey','profileHash','profileId','researchLifetimeLimitMicrounits','submissionId','topicKey']);
  assert.equal(h.navigation.length,0);
});

test('stale responses after navigation cannot overwrite the new selection',async()=>{
  const f=fixture(),waiting=deferred(),h=harness(f,{actions:{stopOwnerResearchAction:()=>waiting.promise}});
  button(h.render(),'Stop this research setup').props.onClick();await until(()=>h.calls.length===1);h.unmount();
  waiting.resolve({ok:true,receipt:{...f.receipt,stopped:true}});await tick();assert.equal(h.states[5].stopped,false);assert.equal(h.navigation.length,0);
});

test('opaque retry identities survive reload and only known expired preparations get new identities',()=>{
  const store=new Map(),storage={getItem:key=>store.get(key),setItem:(key,value)=>store.set(key,value)},ids=[id(20),id(21)],random=()=>ids.shift();
  const first=money.ownerResearchRequestId('owner:business:goal:prepare:fingerprint',new Map(),storage,random);
  assert.equal(money.ownerResearchRequestId('owner:business:goal:prepare:fingerprint',new Map(),storage,random),first);
  const next=money.ownerResearchRequestId('owner:business:goal:prepare:fingerprint',new Map(),storage,random,first);assert.notEqual(first,next);
  assert.equal(money.ownerResearchRequestId('owner:business:goal:prepare:fingerprint',new Map(),storage,random,first),next,'An interrupted fresh request keeps its new identity');
  assert.equal(money.ownerResearchRequestId('owner:business:goal:stop:fingerprint',new Map(),{getItem(){throw Error('disabled');},setItem(){throw Error('disabled');}},()=>id(30)),id(30));
});

test('action wrappers require the authenticated owner and never invoke a dispatch boundary',async()=>{
  const f=fixture(),calls=[],context={userId:id(90)},api=load('src/app/dashboard/quests/research/actions.ts',{'@/lib/core-ui/data':{requireOwnerUiContext:async()=>{calls.push('auth');return context;}},'@/products/discovery-r12-goal-preparation-contract':{OwnerResearchBudgetError:class extends Error{}},'@/lib/core-ui/owner-research-form':money,'@/products/discovery-r12-goal-preparation-server':Object.fromEntries(['prepareOwnerResearch','confirmOwnerResearch','stopOwnerResearch'].map(name=>[name,async(ctx,input)=>{assert.equal(ctx,context);calls.push([name,input]);return f.receipt;}])), '@/products/discovery-r12-adaptive-owner-server':Object.fromEntries(['prepareAdaptiveOwnerResearch','confirmAdaptiveOwnerResearch','stopAdaptiveOwnerResearch'].map(name=>[name,async(ctx,input)=>{assert.equal(ctx,context);calls.push([name,input]);return f.receipt;}])), '@/products/discovery-r12-adaptive-server':{continueAdaptiveOwnerResearch:async(ctx,business,scope)=>{assert.equal(ctx,context);calls.push(['continueAdaptiveOwnerResearch',business,scope]);return {status:'waiting',reason:'receipt_pending',wakeAt:new Date(Date.now()+1000).toISOString()};}}});
  for(const name of ['prepareOwnerResearchAction','confirmOwnerResearchAction','stopOwnerResearchAction'])assert.equal((await api[name]({businessId:id(1)})).ok,true);
  for(const name of ['prepareAdaptiveOwnerResearchAction','confirmAdaptiveOwnerResearchAction','stopAdaptiveOwnerResearchAction'])assert.equal((await api[name]({businessId:id(1)})).ok,true);
  assert.equal((await api.continueAdaptiveOwnerResearchAction(id(1),id(61))).result.reason,'receipt_pending');
  assert.equal(calls.filter(value=>value==='auth').length,7);
  assert.doesNotMatch(readFileSync('src/app/dashboard/quests/research/actions.ts','utf8'),/startGeographicDiscovery|continueDiscovery|activateOwnerResearch|\bdispatch[A-Z]\w*\s*\(/);
});

test('insufficient-cap errors disclose the current quote and exact minimum totals without reporting a saved proposal',async()=>{
  class BudgetError extends Error {quoteMaximumMicrousd=406736;minimumBusinessLimitMicrounits='5206736';minimumResearchLimitMicrounits='2306736';}
  const api=load('src/app/dashboard/quests/research/actions.ts',{'@/lib/core-ui/data':{requireOwnerUiContext:async()=>({})},'@/products/discovery-r12-goal-preparation-contract':{OwnerResearchBudgetError:BudgetError},'@/lib/core-ui/owner-research-form':money,'@/products/discovery-r12-goal-preparation-server':{prepareOwnerResearch:async()=>{throw new BudgetError();}},'@/products/discovery-r12-adaptive-owner-server':{},'@/products/discovery-r12-adaptive-server':{}});
  const result=await api.prepareOwnerResearchAction({});assert.equal(result.ok,false);
  for(const amount of ['USD 0.406736','USD 5.206736','USD 2.306736'])assert.ok(result.message.includes(amount));
  assert.match(result.message,/No proposal or authority was created/);
});

test('a confirmation racing Stop reports the returned stopped state instead of claiming permission was confirmed',async()=>{
  const f=fixture(),h=harness(f,{actions:{confirmOwnerResearchAction:async()=>({ok:true,receipt:{...f.receipt,stopped:true}})}});
  elements(h.render(),e=>e.type==='input'&&e.props.type==='checkbox')[0].props.onChange({target:{checked:true}});
  button(h.render(),'Confirm this exact research policy').props.onClick();await until(()=>h.states[5].stopped);
  assert.match(h.states[7],/This setup is stopped/);assert.doesNotMatch(h.states[7],/Permission confirmed/);
});

test('exact selection route ignores R04 current/last fallback and never guesses a Business or setup',async()=>{
  const f=fixture(),reads=[],context={userId:id(90),businesses:[{id:id(1),name:'Synthetic Business'}],supabase:{from(){const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{id:id(1),name:'Synthetic Business'},error:null})};return q;},rpc:async(name,args)=>{reads.push(args);return{data:{businessId:id(1),selected:{id:id(99),title:'Must not select automatically'},quests:[{id:id(2),title:'Explicit selectable Quest',revision:4,preference:'ready'}],total:21,offset:0,limit:20},error:null};}}};
  const Workspace=props=>React.createElement('div',{'data-exact-goal':props.catalog.goal.id});
  const Reference=props=>React.createElement('div',{'data-bootstrap-business':props.businessId});
  const route=load('src/app/dashboard/quests/research/page.tsx',{'next/navigation':{notFound(){throw Error('not found');}},'@/components/console/console-shell':{ConsoleShell:({children})=>React.createElement('main',null,children)},'@/components/quests/owner-research-entry':entry,'@/components/quests/owner-research-workspace':{OwnerResearchWorkspace:Workspace},'@/components/quests/owner-adaptive-research-workspace':{OwnerAdaptiveResearchWorkspace:({selectedReceipt,catalog})=>React.createElement('div',{'data-adaptive-setup':selectedReceipt?.setupId??'', 'data-adaptive-goal':catalog?.goalId??''})},'@/components/quests/owner-research-bootstrap-reference':{OwnerResearchBootstrapReference:Reference},'@/lib/core-ui/data':{requireOwnerUiContext:async()=>context},'@/lib/core-ui/console-data':{loadConsoleObservationTime:async()=>f.now},'@/lib/core-ui/owner-research-form':money,'@/core/quest-contract':{R04_RPC:{read:'r04_quest_read'}},'@/products/discovery-r12-goal-preparation-server':{readOwnerResearchCatalog:async(_context,business,goal,setup)=>{reads.push({business,goal,setup});return goal===id(998)?{available:false,catalog:null}:{available:true,catalog:f.catalog};}},'@/products/discovery-r12-adaptive-owner-server':{readAdaptiveOwnerResearch:async(_context,business,goal,setup)=>{reads.push({adaptive:true,business,goal,setup});return {available:true,catalog:{businessId:business,goalId:goal,setups:setup?[{businessId:business,goalId:goal,setupId:id(60)}]:[]}};}}}).default;
  let html=renderToStaticMarkup(await route({searchParams:Promise.resolve({business:id(1)})}));assert.match(html,/Explicit selectable Quest/);assert.match(html,new RegExp(`data-bootstrap-business="${id(1)}"`));assert.doesNotMatch(html,/Must not select automatically|data-exact-goal/);assert.match(html,/Next Quests/);
  html=renderToStaticMarkup(await route({searchParams:Promise.resolve({business:id(1),quest:id(2),setup:id(10)})}));assert.match(html,new RegExp(`data-exact-goal="${id(2)}"`));
  html=renderToStaticMarkup(await route({searchParams:Promise.resolve({business:id(1),quest:id(2),setup:id(999)})}));assert.match(html,/No substitute was selected/);assert.match(html,/data-bootstrap-business/);assert.doesNotMatch(html,/data-exact-goal/);
  html=renderToStaticMarkup(await route({searchParams:Promise.resolve({business:id(1),quest:id(998)})}));assert.match(html,/No substitute was selected/);assert.match(html,/data-bootstrap-business/);assert.doesNotMatch(html,/data-exact-goal/);
  html=renderToStaticMarkup(await route({searchParams:Promise.resolve({business:id(1),quest:id(2),adaptiveSetup:id(60)})}));assert.match(html,new RegExp(`data-adaptive-setup="${id(60)}"`));assert.ok(reads.some(read=>read.adaptive&&read.setup===id(60)));
  html=renderToStaticMarkup(await route({searchParams:Promise.resolve({business:id(1),quest:id(2),adaptiveSetup:id(61)})}));assert.match(html,/This exact adaptive setup could not be verified/);assert.doesNotMatch(html,/data-adaptive-setup/);
  await assert.rejects(route({searchParams:Promise.resolve({business:id(1),quest:id(2),setup:id(10),adaptiveSetup:id(60)})}),/not found/);
  await assert.rejects(route({searchParams:Promise.resolve({quest:id(2)})}),/not found/);await assert.rejects(route({searchParams:Promise.resolve({business:[id(1),id(2)]})}),/not found/);
});

test('eligible continuation submits exact predecessor and finite grant, without restarting the initial path',async()=>{
  const f=fixture(),closure={predecessorPlanId:id(40),predecessorPlanHash:'1'.repeat(64),predecessorScopeId:id(41),predecessorScopeHash:'2'.repeat(64),baseKnownMicrounits:'1900000',predecessorPlanVersion:1};
  f.catalog.goal.initialRunExists=true;
  f.catalog.goal.continuation={eligible:true,reason:null,predecessorClosure:closure,predecessorClosureHash:'3'.repeat(64)};
  f.catalog.profiles[0].continuationBounds={maximumEpisodes:3,maximumAllocationMicrounits:'1200000',expiresAt:new Date(f.now+3600000).toISOString()};
  const h=harness(f,{selectedReceipt:null});
  let tree=h.render();assert.match(renderToStaticMarkup(tree),/Continue research from a closed episode/);
  elements(tree,e=>e.type==='select')[0].props.onChange({target:{value:`${id(3)}:${id(4)}`}});
  tree=h.render();elements(tree,e=>e.type==='select')[1].props.onChange({target:{value:'gb'}});
  tree=h.render();elements(tree,e=>e.type==='select')[2].props.onChange({target:{value:'astronomy'}});
  tree=h.render();assert.ok(button(tree,'Prepare continuation packet'));
  elements(tree,e=>e.type==='form')[0].props.onSubmit({preventDefault(){}});await until(()=>h.calls.length===1);
  assert.equal(h.calls[0].name,'prepareOwnerResearchEpisodeAction');
  assert.deepEqual(Object.fromEntries(Object.entries(h.calls[0].input).filter(([key])=>key.startsWith('predecessor'))),{
    predecessorPlanId:closure.predecessorPlanId,predecessorPlanHash:closure.predecessorPlanHash,
    predecessorScopeId:closure.predecessorScopeId,predecessorScopeHash:closure.predecessorScopeHash});
  assert.equal(h.calls[0].input.goalId,f.catalog.goal.id);
});

test('closed predecessor without a finite continuation grant has no preparation control',()=>{
  const f=fixture();f.catalog.goal.initialRunExists=true;
  f.catalog.goal.continuation={eligible:false,reason:'Head is still open.',predecessorClosure:null,predecessorClosureHash:null};
  const h=harness(f,{selectedReceipt:null}),tree=h.render();
  assert.match(renderToStaticMarkup(tree),/Head is still open/);
  assert.equal(button(tree,'Prepare continuation packet'),undefined);
  assert.equal(button(tree,'Prepare exact research packet'),undefined);
});

test('episode packet discloses predecessor, prior costs, new whole run and Exa inference boundary',()=>{
  const f=fixture(),closure={predecessorPlanId:id(40),predecessorPlanHash:'1'.repeat(64),predecessorScopeId:id(41),predecessorScopeHash:'2'.repeat(64),baseKnownMicrounits:'1900000',predecessorPlanVersion:1};
  f.receipt.preview={...f.receipt.preview,version:'r12.owner-research-episode-preview.1',episodeNumber:1,predecessorClosure:closure,predecessorClosureHash:'3'.repeat(64)};
  const html=renderToStaticMarkup(React.createElement(packet.OwnerResearchPacket,{receipt:f.receipt}));
  for(const value of ['Episode 1','View previous research and result','USD 1.900000','New episode whole-run maximum','USD 0.400000','model chooses the downstream Exa query','raw public-source excerpts reach inference','does not cover Exa','Stop before the first Continue call'])assert.ok(html.includes(value),value);
  assert.ok(html.includes(money.ownerResearchScopeHref(f.receipt.businessId,f.receipt.goalId,closure.predecessorScopeId).replaceAll('&','&amp;')));
  assert.ok(!html.includes('Approved cumulative research allowance'),'Old packets do not acquire a new approval');
  f.receipt.preview.grantRootRevision={rootId:id(42),revision:1,hash:'4'.repeat(64),maximumScopes:2,maximumAllocationMicrounits:'813472',expiresAt:'2026-10-10T09:00:00Z'};
  const extended=renderToStaticMarkup(React.createElement(packet.OwnerResearchPacket,{receipt:f.receipt}));
  for(const value of ['Approval revision 1','2 research scopes','USD 0.813472','Earlier consumed allocations remain counted','does not add to your Business','changed approval requires a fresh packet',id(42),'4'.repeat(64)])assert.ok(extended.includes(value),value);
});

function adaptiveFixture(){
  const now=Date.now(),later=new Date(now+4*3600_000).toISOString();
  const predecessor={goalRevision:4,goalHash:'a'.repeat(64),predecessorPlanId:id(40),predecessorPlanHash:'b'.repeat(64),predecessorScopeId:id(41),predecessorScopeHash:'c'.repeat(64)};
  const profile={version:'r12.owner-research-profile.3',id:id(3),title:'Reviewed public scope',purpose:'Bounded factual research',maximumRunMicrousd:9_000_000,validUntil:later,marketSets:[{key:'gb',label:'GB adult context'}],topics:[{key:'nature',label:'Nature',audience:'GB adults'}]};
  const grant={id:id(4),profileId:id(3),businessId:id(1),goalId:id(2),goalRevision:4,goalHash:predecessor.goalHash,allowsPaidFollowups:true,maximumActions:10,maximumRunMicrounits:'10000000',remainingAllocationMicrounits:'3000000',remainingScopes:1,expiresAt:later};
  const catalog={businessId:id(1),goalId:id(2),eligible:true,reason:null,predecessorClosure:predecessor,predecessorClosureHash:'d'.repeat(64),imports:[{},{},{},{},{}],business:{currentLimitMicrounits:'5000000',committedMicrounits:'4000000',hasUnknown:false},funding:{authorityRootId:id(8),currentLimitMicrounits:'3500000',committedMicrounits:'2000000',pendingMicrounits:'0',hasUnknown:false},deadline:later,profiles:[{profile,profileHash:'e'.repeat(64)}],grants:[grant],setups:[],activation:null,actions:[]};
  return {now,catalog};
}
const adaptivePacket=load('src/components/quests/owner-adaptive-research-packet.tsx',{'@/lib/core-ui/owner-research-form':money});
test('adaptive owner panel requires verified catalog and discloses exact cumulative limits without admitting an action',()=>{
  const adaptive=load('src/components/quests/owner-adaptive-research-workspace.tsx',{
    'next/navigation':{useRouter:()=>({})},'@/app/dashboard/quests/research/actions':{},
    '@/lib/core-ui/owner-research-form':money,'./owner-adaptive-research-packet':adaptivePacket,
  });
  const {now,catalog}=adaptiveFixture(),props={ownerId:id(90),observedAt:now,selectedReceipt:null,catalog:null};
  let html=renderToStaticMarkup(React.createElement(adaptive.OwnerAdaptiveResearchWorkspace,props));
  assert.match(html,/exact adaptive catalog is unavailable/);assert.doesNotMatch(html,/Prepare adaptive research packet/);
  html=renderToStaticMarkup(React.createElement(adaptive.OwnerAdaptiveResearchWorkspace,{...props,catalog}));
  assert.match(html,/Choose an exact profile and grant/);assert.match(html,/Prepare adaptive research packet/);
  assert.match(html,/US\$10 total run ceiling/);
  assert.doesNotMatch(html,/Confirm this exact adaptive policy|Admit action|Dispatch/);
  assert.match(money.ownerAdaptiveSetupHref(id(1),id(2),id(60)),/adaptiveSetup=/);
});

test('adaptive preparation sends exact selectors and minimum cumulative caps; consent binds the returned setup hash',async()=>{
  const {now,catalog}=adaptiveFixture(),calls=[],navigation=[],states=[],refs=[],storage=new Map();let stateIndex=0,refIndex=0,sequence=70;
  const hooks={...React,useId:()=>':adaptive-test:',useState(initial){const index=stateIndex++;if(!(index in states))states[index]=initial;return[states[index],value=>states[index]=typeof value==='function'?value(states[index]):value];},useRef(initial){const index=refIndex++;return refs[index]??={current:initial};},useEffect(){}};
  const actions={prepareAdaptiveOwnerResearchAction:async input=>{calls.push(input);return {ok:true,receipt:{businessId:input.businessId,goalId:input.goalId,setupId:id(60),setupHash:'f'.repeat(64),scopeId:id(61),profileId:input.profileId,grantId:input.grantId,submissionId:input.submissionId,ownerObservationRef:input.ownerObservationRef,preview:{predecessorHash:catalog.predecessorClosureHash,maximumRunMicrounits:input.maximumRunMicrounits,maximumActions:input.maximumActions,expiresAt:new Date(now+3600_000).toISOString()},quote:{validUntil:new Date(now+3600_000).toISOString()},selection:{marketSetKey:input.marketSetKey,topicKey:input.topicKey},confirmed:false,activated:false,stopped:false,actions:[]}};}};
  const view=load('src/components/quests/owner-adaptive-research-workspace.tsx',{
    react:hooks,'next/navigation':{useRouter:()=>({replace:href=>navigation.push(href),refresh(){}})},'@/app/dashboard/quests/research/actions':actions,
    '@/lib/core-ui/owner-research-form':money,'./owner-adaptive-research-packet':{OwnerAdaptiveResearchPacket:()=>React.createElement('div',null,'Exact saved packet')},
  },{window:{sessionStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},setInterval:()=>1,clearInterval(){},addEventListener(){},removeEventListener(){}},crypto:{subtle:webcrypto.subtle,randomUUID:()=>id(++sequence)},TextEncoder});
  const props={ownerId:id(90),catalog,selectedReceipt:null,observedAt:now};
  function render(){stateIndex=0;refIndex=0;return view.OwnerAdaptiveResearchWorkspace(props);}
  let tree=render(),selects=elements(tree,e=>e.type==='select');assert.equal(selects.length,4);assert.equal(button(tree,'Prepare adaptive research packet').props.disabled,true);
  selects[0].props.onChange({target:{value:`${id(3)}:${id(4)}`}});
  tree=render();selects=elements(tree,e=>e.type==='select');selects[1].props.onChange({target:{value:'gb'}});
  tree=render();selects=elements(tree,e=>e.type==='select');selects[2].props.onChange({target:{value:'nature'}});
  tree=render();const captureSelection={manifestHash:'9'.repeat(64),manifest:[{bundleId:id(92),bundleHash:'8'.repeat(64),selectedObservationIds:[id(93)]}]};
  elements(tree,e=>typeof e.props?.onSelect==='function')[0].props.onSelect(captureSelection);
  tree=render();assert.equal(button(tree,'Prepare adaptive research packet').props.disabled,false);
  elements(tree,e=>e.type==='form')[0].props.onSubmit({preventDefault(){}});await until(()=>navigation.length===1);
  const input=calls[0];assert.equal(input.maximumRunMicrounits,'3000000');assert.equal(input.businessLifetimeLimitMicrounits,'7000000');assert.equal(input.researchLifetimeLimitMicrounits,'5000000');
  assert.deepEqual([input.predecessorPlanId,input.predecessorScopeId,input.profileHash,input.marketSetKey,input.topicKey],[id(40),id(41),'e'.repeat(64),'gb','nature']);
  assert.equal(Object.keys(input).length,18);assert.match(navigation[0],/adaptiveSetup=/);
  tree=render();assert.equal(button(tree,'Confirm this exact adaptive policy').props.disabled,true,'Receipt alone cannot imply consent');
  elements(tree,e=>typeof e.props?.onVerified==='function')[0].props.onVerified(captureSelection.manifestHash);
  tree=render();elements(tree,e=>e.type==='input'&&e.props.type==='checkbox')[0].props.onChange({target:{checked:true}});
  assert.equal(button(render(),'Confirm this exact adaptive policy').props.disabled,false);
  states[states.findIndex(value=>value===now)]=now+3600_001;
  assert.equal(button(render(),'Confirm this exact adaptive policy').props.disabled,true,'Expired quote cannot be confirmed even with prior consent');
});

test('adaptive Stop remains usable during a Run request and cancels any subsequent automatic wake',async()=>{
  const {now,catalog}=adaptiveFixture(),pendingRun=deferred(),calls=[],states=[],refs=[];let stateIndex=0,refIndex=0;
  const receipt={businessId:id(1),goalId:id(2),setupId:id(60),setupHash:'f'.repeat(64),scopeId:id(61),profileId:id(3),grantId:id(4),selection:{marketSetKey:'gb',topicKey:'nature'},preview:{maximumActions:10,expiresAt:new Date(now+3600_000).toISOString()},quote:{validUntil:new Date(now+3600_000).toISOString()},confirmed:true,activated:true,stopped:false,actions:[]};
  const hooks={...React,useId:()=>':adaptive-stop:',useState(initial){const index=stateIndex++;if(!(index in states))states[index]=initial;return[states[index],value=>states[index]=typeof value==='function'?value(states[index]):value];},useRef(initial){const index=refIndex++;return refs[index]??={current:initial};},useEffect(){}};
  const actions={continueAdaptiveOwnerResearchAction:async(businessId,scopeId)=>{calls.push(['run',businessId,scopeId]);return pendingRun.promise;},stopAdaptiveOwnerResearchAction:async input=>{calls.push(['stop',input]);return {ok:true,receipt:{...receipt,stopped:true}};}};
  const view=load('src/components/quests/owner-adaptive-research-workspace.tsx',{
    react:hooks,'next/navigation':{useRouter:()=>({refresh(){},replace(){}})},'@/app/dashboard/quests/research/actions':actions,
    '@/lib/core-ui/owner-research-form':money,'./owner-adaptive-research-packet':{OwnerAdaptiveResearchPacket:()=>React.createElement('div',null,'Saved packet')},
  },{window:{setInterval:()=>1,clearInterval(){},setTimeout:()=>1,clearTimeout(){},addEventListener(){},removeEventListener(){}},crypto:{subtle:webcrypto.subtle,randomUUID:()=>id(80)},TextEncoder});
  function render(){stateIndex=0;refIndex=0;return view.OwnerAdaptiveResearchWorkspace({ownerId:id(90),catalog,selectedReceipt:receipt,observedAt:now});}
  button(render(),'Run or resume approved adaptive research').props.onClick();await until(()=>calls.length===1);
  assert.equal(button(render(),'Stop this adaptive setup').props.disabled,false,'Stop must remain available during the in-flight Run request');
  button(render(),'Stop this adaptive setup').props.onClick();await until(()=>calls.length===2&&states.some(value=>value?.setupId===receipt.setupId&&value?.stopped===true));
  pendingRun.resolve({ok:true,result:{status:'waiting',reason:'continue_saved_progress'}});await tick();
  assert.equal(calls.filter(call=>call[0]==='run').length,1,'Late Run result cannot start another call after Stop');
  assert.equal(button(render(),'Run or resume approved adaptive research'),undefined);
});

test('adaptive Run waits for saved receipt eligibility and pauses after three unchanged durable states',async()=>{
  const {now,catalog}=adaptiveFixture(),timers=[],calls=[],states=[],refs=[];let stateIndex=0,refIndex=0;
  const receipt={businessId:id(1),goalId:id(2),setupId:id(60),setupHash:'f'.repeat(64),scopeId:id(61),profileId:id(3),grantId:id(4),selection:{marketSetKey:'gb',topicKey:'nature'},preview:{maximumActions:10,expiresAt:new Date(now+3600_000).toISOString()},quote:{validUntil:new Date(now+3600_000).toISOString()},confirmed:true,activated:true,stopped:false,actions:[]};
  const wakeAt=new Date(Date.now()+60_000).toISOString();
  const responses=[{status:'waiting',reason:'receipt_pending',wakeAt,progressToken:'saved-1'},
    ...Array.from({length:4},()=>({status:'waiting',reason:'continue_saved_progress',progressToken:'saved-1'}))];
  const hooks={...React,useId:()=>':adaptive-wake:',useState(initial){const index=stateIndex++;if(!(index in states))states[index]=initial;return[states[index],value=>states[index]=typeof value==='function'?value(states[index]):value];},useRef(initial){const index=refIndex++;return refs[index]??={current:initial};},useEffect(){}};
  const actions={continueAdaptiveOwnerResearchAction:async()=>{calls.push('wake');return {ok:true,result:responses.shift()};}};
  const view=load('src/components/quests/owner-adaptive-research-workspace.tsx',{
    react:hooks,'next/navigation':{useRouter:()=>({refresh(){},replace(){}})},'@/app/dashboard/quests/research/actions':actions,
    '@/lib/core-ui/owner-research-form':money,'./owner-adaptive-research-packet':{OwnerAdaptiveResearchPacket:()=>React.createElement('div',null,'Saved packet')},
  },{window:{setInterval:()=>1,clearInterval(){},setTimeout:(fn,delay)=>{timers.push({fn,delay});return timers.length;},clearTimeout(){},addEventListener(){},removeEventListener(){}},crypto:{subtle:webcrypto.subtle,randomUUID:()=>id(80)},TextEncoder});
  function render(){stateIndex=0;refIndex=0;return view.OwnerAdaptiveResearchWorkspace({ownerId:id(90),catalog,selectedReceipt:receipt,observedAt:now});}
  button(render(),'Run or resume approved adaptive research').props.onClick();await until(()=>calls.length===1&&timers.length===1);
  assert.ok(timers[0].delay>50_000,'A pending receipt is never polled before its saved wake time');
  assert.equal(calls.length,1,'No follow-up request occurs while a receipt is pending');
  for(let n=2;n<=4;n++){timers.shift().fn();await until(()=>calls.length===n&&timers.length===1);assert.equal(timers[0].delay,750);}
  timers.shift().fn();await until(()=>calls.length===5);
  assert.equal(timers.length,0,'Three repeated durable progress tokens stop browser auto-wakes');
  assert.match(renderToStaticMarkup(render()),/has not advanced across three checks/);
});

test('stopped adaptive setup offers only SQL-proven existing receipt readback',async()=>{
  const {now,catalog}=adaptiveFixture(),calls=[],states=[],refs=[];let stateIndex=0,refIndex=0;
  const receipt={businessId:id(1),goalId:id(2),setupId:id(60),setupHash:'f'.repeat(64),scopeId:id(61),profileId:id(3),grantId:id(4),selection:{marketSetKey:'gb',topicKey:'nature'},preview:{maximumActions:10,expiresAt:new Date(now+3600_000).toISOString()},quote:{validUntil:new Date(now+3600_000).toISOString()},confirmed:true,activated:true,stopped:true,actions:[]};
  const hooks={...React,useId:()=>':adaptive-readback:',useState(initial){const index=stateIndex++;if(!(index in states))states[index]=initial;return[states[index],value=>states[index]=typeof value==='function'?value(states[index]):value];},useRef(initial){const index=refIndex++;return refs[index]??={current:initial};},useEffect(){}};
  const actions={checkAdaptiveOwnerReceiptsAction:async(businessId,scopeId)=>{calls.push([businessId,scopeId]);return {ok:true,result:{status:'stopped',reason:'saved_receipt_readback_recorded'}};}};
  const view=load('src/components/quests/owner-adaptive-research-workspace.tsx',{
    react:hooks,'next/navigation':{useRouter:()=>({refresh(){},replace(){}})},'@/app/dashboard/quests/research/actions':actions,
    '@/lib/core-ui/owner-research-form':money,'./owner-adaptive-research-packet':{OwnerAdaptiveResearchPacket:()=>React.createElement('div',null,'Saved packet')},
  },{window:{setInterval:()=>1,clearInterval(){},setTimeout:()=>1,clearTimeout(){},addEventListener(){},removeEventListener(){}},crypto:{subtle:webcrypto.subtle,randomUUID:()=>id(80)},TextEncoder});
  function render(){stateIndex=0;refIndex=0;return view.OwnerAdaptiveResearchWorkspace({ownerId:id(90),catalog,selectedReceipt:receipt,observedAt:now});}
  assert.equal(button(render(),'Check saved receipts'),undefined,'No UI readback without trusted pending marker');
  catalog.activation={setupId:receipt.setupId,scopeId:receipt.scopeId,stopped:true,pendingReceiptReadback:true,pendingReceiptCount:1};
  const tree=render();assert.equal(button(tree,'Run or resume approved adaptive research'),undefined);
  button(tree,'Check saved receipts').props.onClick();await until(()=>calls.length===1);
  assert.deepEqual(calls[0],[id(1),id(61)]);assert.match(renderToStaticMarkup(render()),/no new research call was sent/i);
});
