import test from 'node:test';
import assert from 'node:assert/strict';
import { historyRead, historyResponse } from './helpers/history-fixtures.mjs';
const id = n => `96060000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture({ search = '', records = [{ id: id(1) }], alter = value => value } = {}) {
  const calls = [];
  return { calls, context: { readSearch: search, supabase: { async rpc(name,args) {
    calls.push({name,args}); return alter(historyResponse(args,records));
  } } } };
}
const read = (f, options = {}) => historyRead.readHistory(f.context,id(900),'account_runs','account',options);
test('actual history reader sends bounded independent query state without mutation authority', async () => {
  const f=fixture({search:`accountPage=3&accountQuery=Etsy&accountStatus=cancelled&accountId=${id(55)}&quest=${id(80)}`,records:Array.from({length:77},(_,i)=>({id:id(i+1)}))});
  const result=await read(f);
  assert.equal(f.calls.length,1); assert.equal(f.calls[0].name,'r06_read');
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].args)),{p_business_id:id(900),p_dataset:'account_runs',p_query:{limit:25,offset:50,query:'Etsy',status:'cancelled',selectedId:id(55),goalId:id(80)}});
  assert.equal(result.items.length,25); assert.equal(result.page.total,77); assert.equal(result.page.hasNext,true);
  assert.equal(result.selected.id,id(55));
});
for(const [name,alter] of [
  ['missing count',value=>{delete value.data.total;}],
  ['negative count',value=>{value.data.total=-1;}],
  ['transport cap',value=>{value.data.total=2;}],
  ['duplicate rows',value=>{value.data.items=[{id:id(1)},{id:id(1)}];value.data.total=2;}],
  ['wrong offset',value=>{value.data.offset=25;}],
  ['missing row identity',value=>{value.data.items=[{}];}],
  ['error with private body',value=>{value.error={message:'credential-secret-do-not-expose'};}],
])test(`actual history reader rejects ${name} without inventing an empty successful page`,async()=>{
  const f=fixture({alter:value=>{alter(value);return value;}});
  await assert.rejects(read(f),error=>error.message==='Historical read unavailable'&&!error.message.includes('credential-secret'));
});
for(const [name,selection] of [
  ['different selected identity',{status:'found',item:{id:id(2)}}],
  ['malformed selected identity',{status:'found',item:{id:'not-a-uuid'}}],
  ['missing selected identity',{status:'found',item:{}}],
  ['none despite explicit selection',{status:'none',item:null}],
  ['missing with substituted item',{status:'missing',item:{id:id(1)}}],
])test(`actual history exact selection rejects ${name}`,async()=>{
  const f=fixture({alter:value=>{value.data.selection=selection;return value;}});
  await assert.rejects(read(f,{selectedId:id(1)}),/historical.*unavailable/i);
});
test('actual history reader permits independently scoped missing detail and authoritative intervention resolution',async()=>{
  const absent=fixture({alter:value=>{value.data.selection={status:'missing',item:null};return value;}});
  assert.equal((await read(absent,{selectedId:id(55)})).selected,null);
  const resolved=fixture({alter:value=>{value.data.selection={status:'found',item:{id:id(77)}};return value;}});
  assert.equal((await read(resolved,{interventionId:id(99)})).selected.id,id(77));
});
test('an unknown owner-wide queue count remains unknown despite a valid local page',async()=>{
  const f=fixture({alter:value=>{value.data.ownerTotal=null;return value;}});
  const result=await read(f);assert.equal(result.page.total,1);assert.equal(result.ownerTotal,undefined);
});
