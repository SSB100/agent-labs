import { fixtureTables as collectionSeed } from '../helpers/console-collection-root.mjs';
import { seed as librarySeed } from '../helpers/console-library-data-fixtures.mjs';
import { seed as researchSeed } from '../helpers/console-research-data-fixtures.mjs';
import { fixtureTables as decisionTables, businesses, owner, id, time } from '../helpers/console-decisions.mjs';
import { readFileSync } from 'node:fs';
import { questFixture } from './quests.mjs';
export { owner, id, time };
export function fixtureData() {
  const db = decisionTables({ count: 3 });
  const add = seed => { for (const [table, rows] of Object.entries(seed)) { db[table] ??= []; db[table].push(...rows); } };
  for (let b = 0; b < 2; b++) { add(librarySeed(127, businesses[b].id, 400000 + b * 10000)); add(researchSeed(127, businesses[b].id, 500000 + b * 10000)); }
  add(collectionSeed({perBusiness:127}));
  for (const [table, rows] of Object.entries(db)) db[table] = rows.filter((r,i) => !r.id || rows.findIndex(other => other.id === r.id) === i);
  db.businesses = businesses.map(b => ({ ...b, owner_user_id: owner })); db.profiles = [{ id: owner, display_name: 'Inert owner with a deliberately long display name' }];
  db.product_candidates = Array.from({length: 51}, (_,n) => ({ id: id(600000+n), business_id: businesses[n%2].id, concept: `Saved candidate ${n} with a very long original concept `.repeat(3), audience: 'Synthetic weekend hikers', hypothesis: 'Synthetic hypothesis only, no actual provider work.', original_design: true, rights_status: 'unclear', source_domains: ['example.invalid'], created_at: time, updated_at: time }));
  for (const approval of db.creative_approvals) { approval.approved_at ??= time; approval.expires_at ??= time; approval.maximum_microusd ??= 500000; approval.snapshot = { ...approval.snapshot, concept: 'Synthetic original long design concept '.repeat(3), audience: 'Synthetic audience', maximumGenerations: 1 }; }
  for(const run of db.creative_runs){run.created_at ??= time;run.capability_expires_at ??= time;}
  for (const asset of db.creative_assets) asset.inspection = { ...asset.inspection, effectiveDpi: 150, colorSpace: 'sRGB' };
  for (const review of db.creative_reviews ?? []) review.review.checks = [];
  const definitionId = file => readFileSync(`src/workflows/${file}.ts`,'utf8').match(/WORKFLOW_DEFINITION_ID\s*=\s*\n?\s*"([^"]+)"/)[1];
  for(const [file,offset] of [['model-router-runtime',700000],['worker-pack-runtime',710000]]) {
    const def = definitionId(file); db.workflow_definitions.push({ id:def, workflow_key:file, version:'1.0.0', name:'Synthetic '+file, stage_definition:{stages:[]}, description:'Inert saved proof',status:'qualified' });
    for(let n=0;n<102;n++) db.workflow_runs.push({id:id(offset+n),business_id:businesses[n%2].id,workflow_definition_id:def,status:n%2?'completed':'failed',current_stage_key:null,input:{proofMode:'live'},state:{},runtime_provider:'fixture',runtime_run_id:null,created_at:time,updated_at:time,started_at:time,completed_at:time});
  }
  db.model_definitions=[{id:id(720000),model_key:'fixture.model',display_name:'Inert saved model',provider_family:'fixture',provider_model_id:'fixture/inert',tier:'standard',status:'unqualified',context_window_tokens:1000,input_price_per_million_usd:1,output_price_per_million_usd:1}];db.model_routes=Array.from({length:51},(_,n)=>({id:id(721000+n),route_key:`fixture.route.${n}`,name:`Saved routing policy ${n}`,status:'experimental',primary_model_definition_id:id(720000),fallback_model_definition_id:null,maximum_attempts:1}));
  db.model_invocations.push({id:id(730000),business_id:businesses[0].id,workflow_run_id:id(700000),model_definition_id:id(720000),attempt:1,status:'failed',provider_model_id:'fixture/inert',provider_request_id:null,failure_category:'unknown',input_tokens:1,output_tokens:0,reported_cost_usd:null,estimated_cost_usd:.1,latency_ms:null});
  for(const table of ['browser_sessions','browser_session_events','browser_provider_definitions','browser_planner_definitions','browser_planner_evaluation_cases','packs','installed_packs','evaluation_suites','evaluation_cases','evaluation_runs','evaluation_results','worker_promotions','product_research_cost_reservations','product_research_cost_settlements','product_research_funding_approvals']) db[table] ??= [];
  const manifests=JSON.parse(readFileSync('packs/catalog.json','utf8'));
  db.packs=manifests.map((manifest,n)=>({id:id(780000+n),pack_key:manifest.packKey,version:manifest.version,status:'experimental',manifest}));
  const installed=db.packs.find(p=>p.manifest.workflows.length>0);
  db.installed_packs=[{id:id(790000),business_id:businesses[0].id,root_pack_id:installed.id,status:'active',snapshot:{rootPackId:installed.id,releases:[installed]}}];
  const suite=id(800000);
  db.worker_evaluation_suites=[{id:suite,suite_key:'worker.generic-researcher.qualification',version:'1.0.0',name:'Saved researcher qualification '.repeat(5),status:'experimental',minimum_score:90,require_all_required:true}];
  db.worker_definitions ??= [];
  db.worker_definitions.push({id:id(502),worker_key:'generic.researcher',version:'1.0.0',name:'Inert model researcher',role:'research',status:'experimental',pack_id:id(501)});
  db.worker_evaluation_cases=[{id:id(800001),suite_id:suite,case_key:'fixture.uncertain',name:'Saved unknown provider response',category:'uncertainty',execution_mode:'live',model_target:'fixture.model',required:true,weight:1}];
  db.worker_evaluations=Array.from({length:21},(_,n)=>({id:id(801000+n),suite_id:suite,status:n%2?'failed':'passed',score:n%2?0:100,passed_case_count:n%2?0:1,failed_case_count:n%2?1:0,required_case_count:1,required_failure_count:n%2?1:0,source:'fixture',subject_fingerprint:'a'.repeat(64),started_at:time,completed_at:time,created_at:time}));
  db.worker_evaluation_case_results=db.worker_evaluations.map((run,n)=>({id:id(802000+n),evaluation_id:run.id,case_id:id(800001),status:run.status,score_awarded:run.score,model_definition_id:id(720000),provider:'fixture',provider_model_id:'fixture/inert',input_tokens:1,output_tokens:0,reported_cost_usd:n%2?null:.01,estimated_cost_usd:.1,latency_ms:null,failure:{reason:'Synthetic unknown receipt'}}));
  return { db, businesses, owner, quests:questFixture(businesses,id,time) };
}
