import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),ts=require('typescript'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const id=n=>`12000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const noop=()=>{},Link=({children,...props})=>React.createElement('a',props,children);
function source(file,deps){
  const compiled=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const fixture={exports:{}};
  new Function('require','module','exports',compiled)(name=>{
    if(name==='react/jsx-runtime')return require(name);
    assert.ok(Object.hasOwn(deps,name),`Unexpected offline dependency: ${name}`);
    return deps[name];
  },fixture,fixture.exports);
  return fixture.exports;
}

test('shared confirmation reports only the exact reviewed permission and preserves activation and no-call truth',async()=>{
  const context={userId:id(1)},receipt={businessId:id(2),scopeId:id(3),goalId:id(4),executionAuthorized:false};
  let confirms=0,ownerReads=0;
  const {confirmR12ReviewOwnerAction}=source('src/app/dashboard/products/r12-review-preparation-actions.ts',{
    '@/lib/core-ui/data':{requireOwnerUiContext:async()=>{ownerReads++;return context;}},
    '@/products/discovery-r12-review-preparation-server':{confirmR12ReviewPreparation:async(c,b,s,h)=>{
      confirms++;assert.equal(c,context);assert.equal(b,receipt.businessId);assert.equal(s,receipt.scopeId);assert.equal(h,'a'.repeat(64));return receipt;
    }},
  });
  const form=new FormData();form.set('businessId',receipt.businessId);form.set('scopeId',receipt.scopeId);form.set('proposalHash','a'.repeat(64));
  const initial={message:'',receipt:null};
  assert.equal((await confirmR12ReviewOwnerAction(initial,form)).receipt,null);
  assert.equal(ownerReads,0);assert.equal(confirms,0);
  form.set('reviewed','on');
  const state=await confirmR12ReviewOwnerAction(initial,form);
  assert.equal(state.receipt,receipt);assert.equal(ownerReads,1);assert.equal(confirms,1);
  assert.equal(state.message,'The exact reviewed permission is confirmed for this Business and Goal. Temporary activation is still required; no provider call was made.');
  assert.doesNotMatch(state.message,/remaining review|one-call|two-call/);
  form.append('scopeId',id(99));
  assert.equal((await confirmR12ReviewOwnerAction(state,form)).receipt,null);
  assert.equal(ownerReads,1);assert.equal(confirms,1);
});

test('receipt form renders truthful shared setup for pilot, additional evidence and remaining review',()=>{
  const state={message:'The exact reviewed permission is confirmed for this Business and Goal. Temporary activation is still required; no provider call was made.',receipt:{businessId:id(2),scopeId:id(3),goalId:id(4),executionAuthorized:false}};
  const {ConsoleR12ReviewPreparationForm}=source('src/components/console/console-r12-review-preparation-form.tsx',{
    react:{...React,useActionState:()=>[state,noop]},'next/link':Link,
    '@/app/dashboard/products/r12-review-preparation-actions':{confirmR12ReviewOwnerAction:noop},
    '@/app/dashboard/research-qualification/submit-button':{ResearchSubmitButton:({children,disabled})=>React.createElement('button',{disabled},children)},
  });
  for(const [flags,title,link,permission] of [
    [{pilot:true},'Focused pilot prepared','Open focused pilot after activation','two-call'],
    [{evidence:true},'Additional analysis prepared','Open additional analysis after activation','two-call'],
    [{},'Remaining review prepared','Open remaining review after activation','one-call'],
  ]){
    const workspace={businessId:id(2),scopeId:id(3),goalId:id(4),proposalHash:'a'.repeat(64),eligible:true,confirmed:false,...flags};
    const html=renderToStaticMarkup(React.createElement(ConsoleR12ReviewPreparationForm,{workspace}));
    assert.match(html,/aria-label="Verified research permission setup"/);
    assert.match(html,new RegExp(`<h2>${title}</h2>`));assert.match(html,new RegExp(`>${link}</a>`));
    assert.match(html,new RegExp(`${permission} financial permission`));
    assert.match(html,/separately activate its finite dispatch and receipt window/);
    assert.match(html,/Temporary activation is still required; no provider call was made/);
    if(flags.pilot||flags.evidence)assert.doesNotMatch(html,/remaining.review|one-call financial permission/i);
  }
});

async function creativePage(panel,reviewedLimit=1){
  const context={userId:id(1),businesses:[{id:id(2),name:'Fixture Business'}],supabase:{from:table=>{
    assert.equal(table,'installed_packs');const query={select:()=>query,eq:()=>query,limit:async()=>({data:[],error:null})};return query;
  }}};
  const candidate={id:id(5),business_id:id(2),concept:'Original fixture concept',audience:'Adult fixture audience'};
  const choice={candidate,decision:{id:id(6),assessment:{},created_at:'2026-10-07T00:00:00Z'},experiment:{discovery_version:'pod-discovery-2.0'},maximumGenerations:reviewedLimit,
    ...(reviewedLimit===1?{focusedAdoption:{expiresAt:'2026-10-08T00:00:00Z',maximumCreativeProposalMicrousd:550000}}:{})};
  const pass=({children})=>React.createElement('div',null,children);
  const {default:Page}=source('src/app/dashboard/artifacts/page.tsx',{
    'node:crypto':require('node:crypto'),'next/link':Link,'next/navigation':{notFound:()=>{throw Error('unexpected missing fixture');}},
    '@/components/console/console-focused-run-controls':{ConsoleFocusedRunControls:()=>null},
    '@/components/console/console-focused-physical-fields':{ConsoleFocusedPhysicalFields:()=>null},
    '@/components/console/history-pager':{HistoryPager:()=>null},
    '@/lib/core-ui/console-retained-feedback':{retainedFeedbackMessage:()=>''},
    '@/components/console/console-retained-workspace':{ConsoleRetainedWorkspace:({panels})=>panels.find(p=>p.id===panel).content,ConsoleRecentRows:()=>null},
    '@/components/stage7/app-shell':{AppShell:pass,PageHeader:()=>null},
    '@/components/stage13/products-workspace':{ProductSubmitButton:({children})=>React.createElement('button',null,children)},
    '@/creative/data':{loadCreativeWorkspace:async()=>({approvals:[],runs:[],assets:[],reviews:[],costs:[],errors:[]}),loadProductionCandidates:async()=>({candidates:[choice],errors:[]})},
    '@/creative/cost-display':{},
    '@/creative/proposal':{FLUX_KLEIN_PROVIDER_TERMS:['https://bfl.ai/legal/developer-terms-of-service','https://bfl.ai/legal/flux-api-service-terms'],TECHNICAL_PRINT_SPECIFICATION:{sourceUrl:'https://www.printful.com/creating-dtg-file',verifiedAt:'2026-10-07T00:00:00Z'}},
    '@/creative/image-provider':{FLUX_KLEIN_PNG_POLICY:{modelId:'black-forest-labs/flux.2-klein-4b'}},
    '@/creative/types':{SCREEN_CATEGORIES:[]},'@/lib/core-ui/data':{requireOwnerUiContext:async()=>context},'./actions':{},'./artifacts.css':{},
  });
  return renderToStaticMarkup(await Page({searchParams:Promise.resolve({})}));
}

for(const [panel,limit] of [['production',1],['production',2],['technical',2]]){
  test(`${panel} ${limit}-image approval keeps short options and wrapping accessible provider and call limits`,async()=>{
    const html=await creativePage(panel,limit);
    for(const name of ['generatorModel','maximumGenerations']){
      const select=html.match(new RegExp(`<select name="${name}"[^>]*>.*?</select>`))?.[0];assert.ok(select);
      const description=select.match(/aria-describedby="([^"]+)"/)?.[1];assert.ok(description);
      assert.ok(html.includes(`<p class="creativeMuted" id="${description}">`));
      for(const option of select.matchAll(/<option[^>]*>([^<]*)<\/option>/g))assert.ok(option[1].length<=23,`${name}: ${option[1]}`);
    }
    assert.match(html,/<option value="black-forest-labs\/flux.2-klein-4b">FLUX\.2 Klein 4B<\/option>/);
    assert.match(html,/<option value="1" selected="">One image, no repair<\/option>/);
    assert.match(html,/Black Forest Labs FLUX\.2 Klein 4B via OpenRouter\. Native PNG requested at 1024 × 1024; original provider bytes and any markings are retained/);
    assert.match(html,/One image, no repair: up to 4 provider calls/);
    if(panel==='production'&&limit===1){
      assert.match(html,/<option value="2" disabled="">Image \+ optional repair<\/option>/);
      assert.match(html,/This reviewed candidate does not allow a repair/);
      assert.match(html,/One image only; no repair is authorized/);
      assert.doesNotMatch(html,/up to 6 provider calls|two allow at most one repair/);
    }else{
      assert.match(html,/<option value="2">Image \+ optional repair<\/option>/);
      assert.match(html,/One image plus at most one repair: up to 6 provider calls/);
    }
    assert.match(html,/No automatic retries/);
  });
}
