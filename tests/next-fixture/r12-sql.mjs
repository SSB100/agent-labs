import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {runOperatorRecipe,STAGING_SQL,ACTIVATION_SQL} from '../../scripts/r12-research-bootstrap.mjs';
import {r12QuoteFixture} from '../helpers/r12-provider-fixture.mjs';
export const R12_INERT_ROOT='inert-r12-owner-root-configuration-0123456789';
const tables=['businesses','goals','workflow_runs','workflow_definitions','workflow_stage_runs','worker_definitions','worker_runs','task_contracts','artifacts','installed_packs','product_experiments'];
export async function loadR12NextFixture(state,scenario,directory,host){
 assert.ok(['current','pending','scheduled-review','completed','bootstrap'].includes(scenario));assert.ok(path.basename(directory).startsWith('r12-next-'));
 if(state.r12)await closeR12Fixture(state);
 const require=createRequire(path.join(host,'package.json')),{PGlite}=require('@electric-sql/pglite'),{pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
 const metadata=JSON.parse(await readFile(path.join(directory,scenario==='bootstrap'?'bootstrap-metadata.json':'metadata.json'),'utf8')),dump=await readFile(path.join(directory,`${scenario}.tgz`));
 const db=new PGlite({extensions:{pgcrypto},loadDataDir:new Blob([dump])});await db.waitReady;
 state.r12={...metadata,db,scenario,calls:[],receipts:[],quoteReads:0,generations:Object.fromEntries((await db.query("select candidate->>'phase' phase,candidate->>'providerRequestId' id from private.r12_discovery_candidates")).rows.map(r=>[r.phase,r.id]))};state.owner=metadata.ownerId;
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[state.owner]);await mirrorR12(state);
 state.businesses=state.db.businesses;state.db.profiles=[{id:state.owner,display_name:'Inert R12 workflow owner'}];
 state.quests.rows=(await db.query('select public.r04_quest_read($1,$2,20,0) result',[metadata.businessId,metadata.goalId])).rows[0].result.quests;
 // Fixture-only lease expiry models a fresh server request after process loss.
 await db.exec("update private.r07_heads set lease_expires_at=clock_timestamp()-interval '1 second'");
 return state.r12;
}
export async function mirrorR12(state){for(const table of tables)state.db[table]=(await state.r12.db.query(`select * from public.${table}`)).rows.map(row=>JSON.parse(JSON.stringify(row)));}
export async function controlR12(state,input){
 const r=state.r12;assert.ok(r);return exclusive(r,async()=>{await r.db.exec('reset role');
 if(input.r12Due){await r.db.exec("alter table private.r12_discovery_receipt_checks disable trigger r12_discovery_history_guard; update private.r12_discovery_receipt_checks set created_at=clock_timestamp()-interval '121 seconds'; alter table private.r12_discovery_receipt_checks enable trigger r12_discovery_history_guard; update private.r07_heads set lease_expires_at=clock_timestamp()-interval '1 second'");}
 if(input.r12BootstrapStage){assert.equal(r.scenario,'bootstrap');assert.ok(!r.staged);const receipt=input.r12BootstrapStage;assert.equal(receipt.businessId,r.businessId);assert.equal(receipt.priorId,r.priorRoundId);assert.equal(receipt.rootId,r.budgetAuthorityRootId);assert.equal(receipt.authorityCreated,false);const hash=label=>createHash('sha256').update('inert-'+label).digest('hex');r.setup={...receipt,approvalHash:hash('approved-packet'),ipsosReviewHash:hash('ipsos-review'),mdpiReviewHash:hash('mdpi-review'),independentReviewHash:hash('independent-review'),executionReviewHash:hash('execution-review'),eligibilityReviewHash:hash('eligibility-review'),quote:r12QuoteFixture()};r.staged=await operatorRecipe(r,'stage',r.setup);r.scopeId=receipt.scopeId;r.goalId=receipt.goalId;await mirrorR12(state);}
 if(input.r12BootstrapActivate){assert.equal(r.scenario,'bootstrap');assert.ok(r.staged&&!r.activated);const p=(await r.db.query('select id,content_hash hash from private.r05_policies where business_id=$1 and payload=$2::jsonb',[r.businessId,r.staged.policyPayload])).rows;assert.equal(p.length,1);r.activated=await operatorRecipe(r,'activate',{...r.setup,quote:r12QuoteFixture(),amendmentHash:r.staged.amendmentHash,policyId:p[0].id,policyHash:p[0].hash,policyInterpretationHash:createHash('sha256').update('inert-policy-review').digest('hex')});r.plan=r.activated.plan;await mirrorR12(state);}
 if(input.r12Pause){await r.db.query("select public.r05_policy_owner($1,'pause',$2,$3)",[r.businessId,{kind:'business',id:r.businessId},crypto.randomUUID()]);}
 });
}
async function operatorRecipe(r,kind,input){
 const original=kind==='stage'?STAGING_SQL:ACTIVATION_SQL;let rendered=original;
 for(const [from,to] of r.bootstrapPins){assert.ok(rendered.includes(from));rendered=rendered.replaceAll(from,to);}
 const client={query:(statement,args)=>{if(statement===original)return r.db.exec(rendered);return args?r.db.query(statement,args):(/^\s*(DO|set local|create temporary)/.test(statement)?r.db.exec(statement):r.db.query(statement));}};
 return runOperatorRecipe(client,kind,input);
}
export async function closeR12Fixture(state){const r=state.r12;if(!r)return;r.closing=true;await exclusive(r,()=>r.db.close());if(state.r12===r)delete state.r12;}
const ownedNames=['r04_quest_transition','r04_research_link_preview','r12_discovery_owner_read','r12_discovery_result_read','r04_quest_read','r07_quest_read','r05_admission_read','r05_policy_owner'];
export async function r12OwnerRpc(state,name,args,mode='normal'){
 const r=state.r12;if(!r||!ownedNames.includes(name))return null;
 if(mode==='unavailable')return{data:null,error:{message:'Inert owner metadata unavailable'}};
 const signatures={r04_quest_transition:['p_business_id','p_operation','p_payload','p_submission_id'],r04_research_link_preview:['p_business_id','p_experiment_id'],r12_discovery_owner_read:['p_business_id','p_scope_id','p_activation'],r12_discovery_result_read:['p_business_id','p_scope_id'],r04_quest_read:['p_business_id','p_goal_id','p_limit','p_offset'],r07_quest_read:['p_business_id','p_goal_id','p_plan_id','p_limit','p_offset'],r05_admission_read:['p_business_id','p_policy_id','p_limit','p_offset'],r05_policy_owner:['p_business_id','p_operation','p_payload','p_submission_id']};
 return sqlRpc(r,name,signatures[name].map(k=>args[k]??null),'authenticated',['r04_quest_transition','r05_policy_owner'].includes(name)?()=>mirrorR12(state):undefined);
}
async function exclusive(r,fn){
 const previous=r.queue??Promise.resolve();let release;r.queue=new Promise(resolve=>release=resolve);await previous;
 try{return await fn();}finally{release();}
}
async function sqlRpc(r,name,params,role,after){
 if(r.closing)return{data:null,error:{message:'Inert SQL fixture closing'}};
 return exclusive(r,async()=>{
  try{await r.db.exec(`set role ${role}`);return{data:(await r.db.query(`select public.${name}(${params.map((_,i)=>`$${i+1}`).join(',')}) result`,params)).rows[0].result,error:null};}
  catch(error){return{data:null,error:{code:'42501',message:String(error.message)}};}
  finally{await r.db.exec('reset role');if(after)await after();}
 });
}
export async function r12RuntimeRpc(state,name,args){
 const r=state.r12;assert.ok(r);
 const keys=name==='r07_controller'?['p_business_id','p_goal_id','p_operation','p_payload','p_submission_id','p_server_key','p_lease_token','p_epoch','p_admission_key']:['p_business_id','p_attempt_id','p_operation','p_payload','p_server_key'];
 assert.ok(['r07_controller','r12_discovery_server'].includes(name));
 return sqlRpc(r,name,keys.map(k=>args[k]??null),'anon',()=>mirrorR12(state));
}
export function r12Quote(state){state.r12.quoteReads++;return r12QuoteFixture(Date.now());}
export function r12Provider(state,input,control,effects){
 const r=state.r12;assert.ok(r);const phase=input.phase;assert.ok(['plan','search1','select1','strategy','review'].includes(phase));
 const model=phase==='review'?'anthropic/claude-4.5-haiku-20251001':'openai/gpt-5.6-luna-20260709',id=`gen-r12-next-${phase}`;
 if(input.method==='POST'){
  assert.equal(input.url,'https://openrouter.ai/api/v1/chat/completions');assert.ok(!r.calls.includes(phase),'Paid phase cannot regenerate');r.calls.push(phase);r.generations[phase]=id;effects.push({kind:'inert-r12-provider',phase});
  assert.deepEqual(input.body.provider.only,[phase==='review'?'amazon-bedrock/us':'azure/us']);
  const message=phase==='search1'?{content:'Synthetic bounded public source context.',annotations:r.outputs.search1.annotations}:{content:JSON.stringify(r.outputs[phase])};
  return{status:200,body:{id,model,choices:[{finish_reason:'stop',message}],usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150,cost:.00001,...(phase==='search1'?{server_tool_use_details:{web_search_requests:1}}:{})}}};
 }
 assert.equal(input.method,'GET');const generationId=r.generations[phase];assert.ok(generationId);assert.equal(input.url,`https://openrouter.ai/api/v1/generation?id=${generationId}`);r.receipts.push(phase);
 if(control.r12DelayReceipt&&phase==='plan')return{status:404,body:{error:{message:'Synthetic receipt not yet indexed'}}};
 return{status:200,body:{data:{id:generationId,provider_name:phase==='review'?'Amazon Bedrock':'Azure',model}}};
}
