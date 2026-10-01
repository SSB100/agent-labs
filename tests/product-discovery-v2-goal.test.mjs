import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const goal=require('../.core-tests/products/discovery-v2-goal.js');
const base={id:'11111111-1111-4111-8111-111111111111',businessId:'22222222-2222-4222-8222-222222222222',goal:goal.DISCOVERY_GOAL_DEFAULT,maximumMicrousd:500000,maximumCollections:1};
test('plain-language original-shirt goal selects a bounded geographic workflow without asking for source domains or scores',()=>{const intent=goal.buildDiscoveryIntentFromGoal(base);assert.deepEqual(intent.comparisonUniverse.markets.map(m=>m.countryCode),['US','GB','AU','NZ']);assert.deepEqual(intent.comparisonUniverse.sourceDomains,['etsy.com','printful.com']);assert.equal(intent.limits.maximumNewCollections,1);assert.equal(intent.limits.maximumGenerations,1);assert.equal(intent.sellerBankCountry,undefined);assert.equal(intent.generationAuthorized,undefined);assert.equal(goal.buildDiscoveryIntentFromGoal({...base,goal:'Research the best market to sell in and recommend three concepts.'}).comparisonUniverse.productType,'original_pod_tshirt');assert.equal(goal.discoveryGoalBudgetScope(intent).intentId,intent.id);assert.throws(()=>goal.buildDiscoveryIntentFromGoal({...base,goal:'Book me a flight to London next week.'}),/other jobs/);});
test('goal allowance rejects implicit increases, invalid currencies and zero',()=>{assert.equal(goal.parseDiscoveryAllowance('0.500000'),500000);assert.equal(goal.parseDiscoveryAllowance('0.522702'),522702);for(const value of ['1.000001','2','-1','0','USD 1','Infinity','0.0000001'])assert.throws(()=>goal.parseDiscoveryAllowance(value));});
function loadView(){const output=ts.transpileModule(readFileSync('src/components/stage13/discovery-goal-workspace.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;const sourceModule={exports:{}};const overrides={'next/link':({children,...props})=>React.createElement('a',props,children),'./products-workspace':{ProductSubmitButton:({children,disabled})=>React.createElement('button',{disabled},children)},'@/app/dashboard/products/discovery-actions':{startGeographicDiscovery:()=>{}},'@/products/discovery-v2-goal':goal};new Function('require','module','exports',output)(name=>Object.hasOwn(overrides,name)?overrides[name]:require(name),sourceModule,sourceModule.exports);return sourceModule.exports;}
test('goal form shows quote, geography, finite calls and approval with unavailable lane disabled',()=>{const {DiscoveryGoalForm}=loadView();for(const available of [false,true]){const markup=renderToStaticMarkup(React.createElement(DiscoveryGoalForm,{businesses:[{id:base.businessId,name:'Fixture Business'}],available,quote:{one:370395,two:530914,verifiedAt:'2026-09-30T22:00:00Z'}}));assert.match(markup,/United States, United Kingdom, Australia and New Zealand/);assert.match(markup,/5 paid calls/);assert.match(markup,/7 paid calls/);assert.match(markup,/0.370395/);assert.match(markup,/confirmResearch/);assert.match(markup,/Experimental · live qualification incomplete/);assert.match(markup,/has not yet passed live end-to-end qualification/);assert.doesNotMatch(markup,/name="(?:sourceDomains|basisArtifactId|score\.)/);if(!available)assert.match(markup,/disabled/);}});
test('empty or incomplete result never implies a positive recommendation or lost research',()=>{const {DiscoveryGoalResults}=loadView();const empty=renderToStaticMarkup(React.createElement(DiscoveryGoalResults,{data:{available:false,records:[],errors:[]}}));assert.match(empty,/No geographic discovery result has been recorded/);const partial=renderToStaticMarkup(React.createElement(DiscoveryGoalResults,{data:{available:true,records:[{root:{id:base.id,workflow_run_id:base.id,status:'failed',created_at:'2026-09-30',failure:'The provider output did not validate.'},intent:null,dossier:null,strategy:null,review:null,sourcePacks:[]}],errors:[]}}));assert.match(partial,/failed history is preserved/);assert.match(partial,/only after the independent review completes/);assert.doesNotMatch(partial,/US\$0|TEST/);});
function loadData(){const output=ts.transpileModule(readFileSync('src/products/discovery-v2-data.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const sourceModule={exports:{}};new Function('require','module','exports',output)(()=>({}),sourceModule,sourceModule.exports);return sourceModule.exports;}
test('follow-up balance releases unused known estimates and retains uncertain exposure without resetting the initial cap',async()=>{
  const {loadDiscoveryChainBalance}=loadData(),calls=[];
  const root={business_id:base.businessId,variables:{budgetAuthorityRootId:base.id}};
  const rows={product_experiments:[{data:{id:base.id,variables:{intent:{limits:{maximumMicrousd:500000}}}},error:null},{data:[{id:base.id},{id:'child-round'}],count:2,error:null}],product_research_funding_approvals:[{data:[],count:0,error:null}],product_research_cost_reservations:[{data:[{id:'r1',reserved_microusd:200000},{id:'r2',reserved_microusd:50000}],count:2,error:null}],product_research_cost_settlements:[{data:[{reservation_id:'r1',reported_microusd:10000,provider_request_id:'known-paid-request'},{reservation_id:'r2',reported_microusd:null,provider_request_id:null}],count:2,error:null}]};
  const supabase={from(table){const result=rows[table].shift();const query={select(){return query;},eq(column,value){calls.push([table,column,value]);return query;},is(){return query;},in(){return query;},limit(){return query;},maybeSingle(){return query;},then(resolve){return Promise.resolve(result).then(resolve);}};return query;}};
  assert.deepEqual(await loadDiscoveryChainBalance({supabase},root),{maximumMicrousd:500000,knownMicrousd:10000,pendingExposureMicrousd:50000,remainingMicrousd:440000,hasUncertainCosts:true});
  assert.equal(calls.filter(c=>c[1]==='business_id'&&c[2]===base.businessId).length,5);
});
test('truncated chain rows cannot be shown as a complete available allowance',async()=>{
  const {loadDiscoveryChainBalance}=loadData();let count=0;
  const supabase={from(){const result=count++===0?{data:{variables:{intent:{limits:{maximumMicrousd:500000}}}},error:null}:count===2?{data:[],count:0,error:null}:{data:[{id:base.id}],count:2,error:null};const query={select(){return query;},eq(){return query;},is(){return query;},in(){return query;},limit(){return query;},maybeSingle(){return query;},then(resolve){return Promise.resolve(result).then(resolve);}};return query;}};
  await assert.rejects(()=>loadDiscoveryChainBalance({supabase},{business_id:base.businessId,variables:{budgetAuthorityRootId:base.id}}),/complete research allowance history/);
});

test('a saved worker TEST cannot be displayed as final when terminal registry validation failed',()=>{const {DiscoveryGoalResults}=loadView();const view=renderToStaticMarkup(React.createElement(DiscoveryGoalResults,{data:{available:true,errors:[],records:[{root:{id:base.id,workflow_run_id:base.id,status:'failed',created_at:'2026-09-30',failure:'Terminal validation rejected the snapshot.'},intent:null,dossier:null,strategy:null,review:{outcome:'TEST',candidateId:'candidate',marketCountryCode:'US'},sourcePacks:[]}]}}));assert.match(view,/final registry validation has not accepted/);assert.doesNotMatch(view,/United States ·|Proposed learning experiment|>TEST</);});

test('additional funding parser requires an explicit USD ceiling and leaves initial allowance parsing bounded',()=>{
  assert.equal(goal.parseDiscoveryAllowance('2.000000',2_000_000),2_000_000);
  assert.equal(goal.parseDiscoveryAllowance('1.600001',2_000_000),1_600_001);
  for(const value of ['2.000001','3','NZD 2','-1','0','2.0000001'])assert.throws(()=>goal.parseDiscoveryAllowance(value,2_000_000));
  assert.throws(()=>goal.parseDiscoveryAllowance('2'));
  assert.throws(()=>goal.parseDiscoveryAllowance('2',3_000_000));
});
test('approved funding increases the same chain ceiling while all prior actual charges remain deducted',async()=>{
  const {loadDiscoveryChainBalance}=loadData();
  const root={business_id:base.businessId,variables:{budgetAuthorityRootId:base.id}};
  const rows={product_experiments:[{data:{id:base.id,variables:{intent:{limits:{maximumMicrousd:400000}}}},error:null},{data:[{id:base.id},{id:'next-round'}],count:2,error:null}],
    product_research_funding_approvals:[{data:[{maximum_microusd:1000000},{maximum_microusd:2000000}],count:2,error:null}],
    product_research_cost_reservations:[{data:[{id:'old',reserved_microusd:150000},{id:'next',reserved_microusd:200000}],count:2,error:null}],
    product_research_cost_settlements:[{data:[{reservation_id:'old',reported_microusd:37598,provider_request_id:'old-receipt'},{reservation_id:'next',reported_microusd:12000,provider_request_id:'new-receipt'}],count:2,error:null}]};
  const supabase={from(table){const result=rows[table].shift();const query={select(){return query;},eq(){return query;},is(){return query;},in(){return query;},limit(){return query;},maybeSingle(){return query;},then(resolve){return Promise.resolve(result).then(resolve);}};return query;}};
  assert.deepEqual(await loadDiscoveryChainBalance({supabase},root),{maximumMicrousd:2000000,knownMicrousd:49598,pendingExposureMicrousd:0,remainingMicrousd:1950402,hasUncertainCosts:false});
});
test('missing, malformed or truncated funding history cannot manufacture an available balance',async()=>{
  const {loadDiscoveryChainBalance}=loadData();
  for(const funding of [{data:null,error:{message:'unavailable'}},{data:[{maximum_microusd:2000001}],count:1,error:null},{data:[{maximum_microusd:2000000}],count:2,error:null},{data:[{maximum_microusd:0}],count:1,error:null}]){
    let n=0;const supabase={from(){const result=n++===0?{data:{variables:{intent:{limits:{maximumMicrousd:400000}}}},error:null}:funding;const query={select(){return query;},eq(){return query;},limit(){return query;},maybeSingle(){return query;},then(resolve){return Promise.resolve(result).then(resolve);}};return query;}};
    await assert.rejects(()=>loadDiscoveryChainBalance({supabase},{business_id:base.businessId,variables:{budgetAuthorityRootId:base.id}}),/complete approved funding history/);
  }
});
test('funding is separate from the bounded research launch and does not advertise creative or commerce grants',()=>{
  const {DiscoveryGoalResults}=loadView();const intent=goal.buildDiscoveryIntentFromGoal(base);
  const markup=renderToStaticMarkup(React.createElement(DiscoveryGoalResults,{data:{available:true,errors:[],records:[{root:{id:base.id,workflow_run_id:base.id,status:'failed',created_at:'2026-10-01',failure:'Known failed call.'},intent,dossier:null,strategy:null,review:null,sourcePacks:[]}]}}));
  assert.match(markup,/Total research ceiling \(USD\)/);assert.match(markup,/confirmFunding/);assert.match(markup,/confirmResearch/);assert.match(markup,/does not start research or approve images, listings or purchases/);assert.match(markup,/at most one collection and five paid calls/);assert.match(markup,/approved remaining allowance/);
});
