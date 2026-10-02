import { seed as librarySeed } from '../helpers/console-library-data-fixtures.mjs';
import { seed as researchSeed } from '../helpers/console-research-data-fixtures.mjs';
import { fixtureTables as decisionTables, businesses, owner, id, time } from '../helpers/console-decisions.mjs';
import { readFileSync } from 'node:fs';
export { owner, id, time };
export function fixtureData() {
  const db = decisionTables({ count: 3 });
  const add = seed => { for (const [table, rows] of Object.entries(seed)) { db[table] ??= []; db[table].push(...rows); } };
  for (let b = 0; b < 2; b++) { add(librarySeed(127, businesses[b].id, 400000 + b * 10000)); add(researchSeed(127, businesses[b].id, 500000 + b * 10000)); }
  for (const [table, rows] of Object.entries(db)) db[table] = rows.filter((r,i) => !r.id || rows.findIndex(other => other.id === r.id) === i);
  db.businesses = businesses.map(b => ({ ...b, owner_user_id: owner })); db.profiles = [{ id: owner, display_name: 'Inert owner with a deliberately long display name' }];
  db.product_candidates = Array.from({length: 51}, (_,n) => ({ id: id(600000+n), business_id: businesses[n%2].id, concept: `Saved candidate ${n} with a very long original concept `.repeat(3), audience: 'Synthetic weekend hikers', hypothesis: 'Synthetic hypothesis only, no actual provider work.', original_design: true, rights_status: 'unclear', source_domains: ['example.invalid'], created_at: time, updated_at: time }));
  for (const approval of db.creative_approvals) approval.snapshot = { ...approval.snapshot, concept: 'Synthetic original long design concept '.repeat(3), audience: 'Synthetic audience', maximumGenerations: 1 };
  for (const asset of db.creative_assets) asset.inspection = { ...asset.inspection, effectiveDpi: 150, colorSpace: 'sRGB' };
  for (const review of db.creative_reviews ?? []) review.review.checks = [];
  const definitionId = file => readFileSync(`src/workflows/${file}.ts`,'utf8').match(/WORKFLOW_DEFINITION_ID\s*=\s*\n?\s*"([^"]+)"/)[1];
  for(const [file,offset] of [['model-router-runtime',700000],['worker-pack-runtime',710000]]) {
    const def = definitionId(file); db.workflow_definitions.push({ id:def, workflow_key:file, version:'1.0.0', name:'Synthetic '+file, stage_definition:{stages:[]}, description:'Inert saved proof',status:'qualified' });
    for(let n=0;n<51;n++) db.workflow_runs.push({id:id(offset+n),business_id:businesses[n%2].id,workflow_definition_id:def,status:n%2?'completed':'failed',current_stage_key:null,input:{proofMode:'live'},state:{},runtime_provider:'fixture',runtime_run_id:null,created_at:time,updated_at:time,started_at:time,completed_at:time});
  }
  db.model_definitions=[{id:id(720000),model_key:'fixture.model',display_name:'Inert saved model',provider_family:'fixture',provider_model_id:'fixture/inert',tier:'standard',status:'unqualified',context_window_tokens:1000,input_price_per_million_usd:1,output_price_per_million_usd:1}];db.model_routes=[];
  db.model_invocations.push({id:id(730000),business_id:businesses[0].id,workflow_run_id:id(700000),model_definition_id:id(720000),attempt:1,status:'failed',provider_model_id:'fixture/inert',provider_request_id:null,failure_category:'unknown',input_tokens:1,output_tokens:0,reported_cost_usd:null,estimated_cost_usd:.1,latency_ms:null});
  for(const table of ['browser_sessions','browser_session_events','browser_provider_definitions','browser_planner_definitions','browser_planner_evaluation_cases','packs','installed_packs','evaluation_suites','evaluation_cases','evaluation_runs','evaluation_results','worker_promotions','product_research_cost_reservations','product_research_cost_settlements','product_research_funding_approvals']) db[table] ??= [];
  return { db, businesses, owner };
}
