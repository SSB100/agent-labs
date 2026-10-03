// Fast pure fixture/loopback checks. These do not replace the real-Next browser gate.
import assert from 'node:assert/strict';
import { fixtureData, id } from './data.mjs';
import { historyId, candidateId, interventionId, readHistoryFixture } from './history.mjs';
import { startFixtureBoundary } from './server.mjs';
import { makeClient } from './transport.mjs';
import { filterFixtureOr } from './query-predicates.mjs';
import { historyRead } from '../helpers/history-fixtures.mjs';
const state=fixtureData({history:true});
const read=(dataset,q={},business=id(1),mode='normal')=>readHistoryFixture(state,{p_business_id:business,p_dataset:dataset,p_query:{limit:25,offset:0,query:'',status:'all',...q}},mode);
const before=JSON.stringify(state);
assert.equal(state.businesses.length,127);
for(const dataset of Object.keys(state.history.rows))for(let b=0;b<2;b++) {
  const business=id(b+1), all=[];
  for(let offset=0;offset<127;offset+=25){const r=read(dataset,{offset},business).data;assert.equal(r.total,127);assert.equal(r.items.length,Math.min(25,127-offset));all.push(...r.items.map(i=>i.id));}
  assert.equal(new Set(all).size,127);assert.equal(all[0],historyId(dataset,b,126));assert.equal(all.at(-1),historyId(dataset,b,0));
  const selected=read(dataset,{selectedId:historyId(dataset,b)},business).data;
  assert.equal(selected.selection.status,'found');assert.ok(!selected.items.some(i=>i.id===selected.selection.item.id));
  assert.equal(read(dataset,{selectedId:historyId(dataset,1-b)},business).data.selection.status,'missing');
  assert.equal(read(dataset,{},business,'empty').data.total,0);assert.ok(read(dataset,{},business,'unavailable').error);
}
assert.equal(read('account_unresolved').data.total,61);assert.equal(read('account_unresolved').data.ownerTotal,122);assert.equal(read('account_unresolved',{},null).data.total,122);
assert.equal(read('account_unresolved',{offset:50}).data.items.at(-1).id,historyId('account_runs'));
const current=readHistoryFixture(state,{p_business_id:id(1),p_dataset:'account_state',p_query:{}}).data.currentRuns;
assert.equal(current.find(r=>r.provider==='printful').id,historyId('account_runs',0,126));
assert.equal(read('product_candidates',{selectedId:candidateId()}).data.selection.item.decisions[0].assessment.outcome,'REJECT');
assert.equal(read('production_candidates').data.total,126);assert.equal(read('product_decisions',{candidateId:candidateId()}).data.total,128);
assert.equal(read('product_candidates',{},null).data.total,254);assert.equal(read('etsy_runs',{status:'failed',query:'draft 1'}).data.total,19);
assert.equal(read('etsy_runs',{goalId:id(820000)}).data.total,64);assert.equal(read('etsy_runs',{goalId:id(820001),selectedId:historyId('etsy_runs')}).data.selection.status,'missing');
assert.ok(read('etsy_runs',{goalId:id(821000)}).error);
for(const dataset of ['publication_runs','printful_runs']){assert.equal(read(dataset,{interventionId:interventionId(dataset)}).data.selection.item.id,historyId(dataset));assert.ok(read(dataset,{interventionId:interventionId(dataset,1)}).error);assert.ok(read(dataset,{interventionId:interventionId(dataset),selectedId:historyId(dataset,0,1)}).error);}
assert.throws(()=>read('etsy_runs',{limit:26}),/bounds/);assert.throws(()=>read('etsy_runs',{offset:-1}),/bounds/);assert.throws(()=>read('etsy_runs',{unreviewed:true}),/Unreviewed/);assert.throws(()=>read('etsy_runs',{status:'unreviewed'}),/status/);assert.throws(()=>read('unreviewed'),/dataset/);
for(const [dataset,key]of [['etsy_packages','etsyPackage'],['listing_sources','listingSource']]){
  const exact=historyId(dataset),context={readSearch:`?${key}Id=${exact}&${key}Page=2`,supabase:{rpc:async(name,args)=>{assert.equal(name,'r06_read');return readHistoryFixture(state,args);}}};
  const result=await historyRead.readHistory(context,id(1),dataset,key),sourceRows=historyRead.historyRows(result);
  assert.equal(result.items.length,25);assert.equal(result.page.total,127);assert.equal(sourceRows.length,26);assert.equal(sourceRows[0].id,exact,'Source adapter union preserves exact off-page selection');
  assert.ok(!result.items.some(item=>item.id===exact));
  const foreign=await historyRead.readHistory(context,id(2),dataset,key);assert.equal(foreign.selected,null);assert.equal(historyRead.historyRows(foreign).length,25);
}
assert.equal(JSON.stringify(state),before,'Pure history reads must not mutate fixture state');
// Exercise only the two reviewed OR forms; identifiers and wire bounds fail closed.
const approvalIds=Array.from({length:26},(_,n)=>id(2000000+n)),assetRunIds=Array.from({length:26},(_,n)=>id(2100000+n));
const union=`approval_id.in.(${approvalIds.join(',')}),id.in.(${assetRunIds.join(',')})`;
const unionRows=[...approvalIds.map((approval_id,n)=>({id:id(2200000+n),approval_id,business_id:id(1)})),...assetRunIds.map((runId,n)=>({id:runId,approval_id:id(2300000+n),business_id:id(1)}))];
assert.equal(filterFixtureOr(unionRows,'creative_runs',union,[['limit',53]]).length,52);
assert.equal(filterFixtureOr(unionRows,'creative_runs',`approval_id.in.(${approvalIds[0]})`,[['limit',53]]).length,1);
assert.equal(filterFixtureOr(unionRows,'creative_runs',`id.in.(${assetRunIds[0]})`,[['limit',53]]).length,1);
const invalidPredicates=[`business_id.in.(${id(1)})`,`id.eq.${assetRunIds[0]}`,`id.in.(${assetRunIds[0]}),status.eq.failed`,`id.in.(not-a-uuid)`,`approval_id.in.()`,`approval_id.in.(${[...approvalIds,id(2999999)].join(',')})`,`id.in.(${assetRunIds[0]}),approval_id.in.(${approvalIds[0]})`];
for(const predicate of invalidPredicates)assert.throws(()=>filterFixtureOr(unionRows,'creative_runs',predicate,[['limit',53]]),/Unreviewed OR predicate/);
for(const [table,operations]of [['artifacts',[['limit',53]]],['creative_runs',[]],['creative_runs',[['limit',54]]],['creative_runs',[['limit',53],['limit',1000]]],['creative_runs',[['limit',53],['range',0,1000]]]])assert.throws(()=>filterFixtureOr(unionRows,table,union,operations),/Unreviewed OR predicate/);
assert.equal(filterFixtureOr([{status:'completed'},{status:'running',completed_at:'saved'},{status:'running'}],'workflow_runs','status.in.(completed,failed,cancelled),completed_at.not.is.null',[]).length,2);
const boundary=await startFixtureBoundary();
try{
  await fetch(boundary.origin+'/control',{method:'POST',body:JSON.stringify({history:true})});
  const client=makeClient(boundary.origin);
  const directory=await client.from('businesses').select('id,name',{count:'exact'}).eq('owner_user_id',state.owner).order('created_at',{ascending:false}).order('id',{ascending:false}).range(0,24);
  assert.equal(directory.count,127);assert.equal(directory.data.length,25);assert.ok(!directory.data.some(b=>b.id===id(1)));
  const exact=await client.from('businesses').select('id').eq('owner_user_id',state.owner).eq('id',id(1)).maybeSingle();assert.equal(exact.data.id,id(1));
  const result=await client.rpc('r06_read',{p_business_id:id(1),p_dataset:'etsy_runs',p_query:{limit:25,offset:25}});assert.equal(result.data.total,127);assert.equal(result.data.items.length,25);
  const fixture=boundary.state();fixture.db.creative_runs.push(...unionRows.map(row=>({...row,created_at:'2026-10-02T04:10:20Z'})));
  fixture.db.creative_runs.push({id:id(2400000),approval_id:approvalIds[0],business_id:id(2)},{id:id(2400001),approval_id:approvalIds[0],business_id:id(999999)});
  const unionRead=()=>client.from('creative_runs').select('id,approval_id,business_id',{count:'exact'}).eq('business_id',id(1)).or(union).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(53);
  const bounded=await unionRead();assert.equal(bounded.error,null);assert.equal(bounded.count,52);assert.equal(bounded.data.length,52);assert.equal(new Set(bounded.data.map(r=>r.id)).size,52);assert.ok(bounded.data.every(r=>r.business_id===id(1)));
  fixture.db.creative_runs.push(...[0,1].map(n=>({id:id(2500000+n),approval_id:approvalIds[0],business_id:id(1),created_at:'2026-10-02T04:10:20Z'})));
  const incomplete=await unionRead();assert.equal(incomplete.count,54);assert.equal(incomplete.data.length,53,'53rd overflow sentinel must remain visible to actual loader validation');
  const rejected=await client.from('creative_runs').select('id').or(`id.in.(${assetRunIds[0]}),status.eq.failed`).limit(53);assert.ok(rejected.error);assert.equal(boundary.denied.length,1);
  const denied=await client.rpc('etsy_owner_transition',{p_business_id:id(1),p_operation:'resume'});assert.ok(denied.error);assert.equal(boundary.denied.length,2);assert.deepEqual(boundary.effects,[]);
}finally{await boundary.close();}
console.log('R06 pure fixture and loopback contracts passed; production Next browser journeys are separate');
