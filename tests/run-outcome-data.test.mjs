import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url),ts=require('typescript');
const load=(path,deps={})=>{const out={exports:{}};const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;new Function('require','module','exports',code)(name=>{assert.ok(Object.hasOwn(deps,name),name);return deps[name];},out,out.exports);return out.exports;};
const flows=load('src/lib/core-ui/workflows.ts');
const adapters=load('src/lib/core-ui/run-outcome.ts',{'./workflows':flows});
const {loadRunCostData}=load('src/lib/core-ui/run-outcome-data.ts',{'./run-outcome':adapters});
const run={id:'run-one',business_id:'business-one'};
function harness(rows = {}, failures = {}, counts = {}) {
  const calls = [];
  const client = {
    from(table) {
      const call = { table, filters: [] }; calls.push(call);
      return {
        select(columns, options) { call.columns = columns; call.options = options; return this; },
        eq(key, value) { call.filters.push([key, value]); return this; },
        in(key, value) { call.filters.push([key, value]); return this; },
        limit(value) { call.limit = value; return this; },
        then(resolve, reject) { return Promise.resolve({ data: failures[table] ? null : rows[table] ?? [], error: failures[table] ? 'unavailable' : null, count: counts[table] ?? rows[table]?.length ?? 0 }).then(resolve, reject); },
      };
    },
  };
  return { calls, context: { businesses: [{ id: run.business_id }], supabase: client } };
}

test('research ledger uses exact run/business and only joined reservations; no overlapping model ledger',async()=>{const h=harness({product_research_cost_reservations:[{id:'reserve-one',business_id:run.business_id,workflow_run_id:run.id,experiment_id:'goal-one',attempt_key:'plan',reserved_microusd:10000}],product_research_cost_settlements:[{id:'settle-one',business_id:run.business_id,reservation_id:'reserve-one',reported_microusd:4000,provider_request_id:'provider-one'}]});const result=await loadRunCostData(h.context,run,{workflow_key:'product.discovery-v2.one'});assert.equal(result.costs.calls.status,'ready');assert.equal(result.costs.calls.records[0].reportedUsd,.004);assert.deepEqual(h.calls.map(call=>call.table),['product_research_cost_reservations','product_research_cost_settlements']);assert.deepEqual(h.calls[0].filters,[['business_id',run.business_id],['workflow_run_id',run.id]]);assert.deepEqual(h.calls[1].filters,[['business_id',run.business_id],['reservation_id',['reserve-one']]]);for(const call of h.calls){assert.equal(call.options.count,'exact');assert.equal(call.limit,1001);}});
test('failed or truncated ledgers remain unavailable rather than reporting zero',async()=>{for(const options of [{fail:{product_research_cost_reservations:true}},{counts:{product_research_cost_reservations:1500}}]){const h=harness({},options.fail,options.counts);const result=await loadRunCostData(h.context,run,{workflow_key:'product.discovery-v2.one'});assert.equal(result.costs.calls.status,'unavailable');assert.equal(h.calls.length,1);}});
test('foreign run ownership prevents every ledger query',async()=>{const h=harness();assert.equal((await loadRunCostData(h.context,{...run,business_id:'foreign'},{workflow_key:'etsy.creative-pipeline'})).costs.calls.status,'unavailable');assert.deepEqual(h.calls,[]);});
test('creative ledger joins persisted run/approval identity and does not trust run input',async()=>{const h=harness({creative_runs:[{id:'creative-one',approval_id:'approval-one',business_id:run.business_id,workflow_run_id:run.id}],creative_approvals:[{id:'approval-one',business_id:run.business_id,purpose:'technical_qualification',maximum_microusd:500000}],creative_cost_reservations:[{business_id:run.business_id,creative_run_id:'creative-one',call_key:'generate:1',reserved_microusd:50000}],creative_cost_settlements:[]});const result=await loadRunCostData(h.context,{...run,input:{creativeRunId:'forged'}},{workflow_key:'etsy.creative-pipeline'});assert.equal(result.costs.calls.records[0].reportedUsd,null);assert.equal(result.costs.calls.records[0].reservedUsd,.05);assert.deepEqual(h.calls[1].filters,[['business_id',run.business_id],['creative_run_id','creative-one']]);assert.deepEqual(h.calls[3].filters,[['business_id',run.business_id],['id','approval-one']]);});
test('ambiguous creative identity cannot load or total provider costs',async()=>{const h=harness({creative_runs:[{id:'a'},{id:'b'}]});const result=await loadRunCostData(h.context,run,{workflow_key:'etsy.creative-pipeline'});assert.equal(result.costs.calls.status,'unavailable');assert.equal(h.calls.length,1);});
