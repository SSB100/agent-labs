// Fast pure fixture/loopback checks. These do not replace the real-Next browser gate.
import assert from 'node:assert/strict';
import { fixtureData, id } from './data.mjs';
import { historyId, candidateId, interventionId, readHistoryFixture } from './history.mjs';
import { startFixtureBoundary } from './server.mjs';
import { makeClient } from './transport.mjs';
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
assert.equal(JSON.stringify(state),before,'Pure history reads must not mutate fixture state');
const boundary=await startFixtureBoundary();
try{
  await fetch(boundary.origin+'/control',{method:'POST',body:JSON.stringify({history:true})});
  const client=makeClient(boundary.origin);
  const directory=await client.from('businesses').select('id,name',{count:'exact'}).eq('owner_user_id',state.owner).order('created_at',{ascending:false}).order('id',{ascending:false}).range(0,24);
  assert.equal(directory.count,127);assert.equal(directory.data.length,25);assert.ok(!directory.data.some(b=>b.id===id(1)));
  const exact=await client.from('businesses').select('id').eq('owner_user_id',state.owner).eq('id',id(1)).maybeSingle();assert.equal(exact.data.id,id(1));
  const result=await client.rpc('r06_read',{p_business_id:id(1),p_dataset:'etsy_runs',p_query:{limit:25,offset:25}});assert.equal(result.data.total,127);assert.equal(result.data.items.length,25);
  const denied=await client.rpc('etsy_owner_transition',{p_business_id:id(1),p_operation:'resume'});assert.ok(denied.error);assert.equal(boundary.denied.length,1);assert.deepEqual(boundary.effects,[]);
}finally{await boundary.close();}
console.log('R06 pure fixture and loopback contracts passed; production Next browser journeys are separate');
