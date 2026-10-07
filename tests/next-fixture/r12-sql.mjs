import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {runOperatorRecipe,STAGING_SQL,ACTIVATION_SQL} from '../../scripts/r12-research-bootstrap.mjs';
import {runOperatorRecipe as runEvidenceRecipe} from '../../scripts/r12-evidence-continuation-bootstrap.mjs';
import {runOperatorRecipe as runReviewRecipe} from '../../scripts/r12-review-continuation-bootstrap.mjs';
import {reviewRecipeClient} from '../helpers/r12-review-fixture.mjs';
import {createClosedRejectedPlan4} from '../helpers/r12-closed-plan4-fixture.mjs';
import {exerciseFocusedPilotLifecycle} from '../helpers/r12-focused-pilot-sql-fixture.mjs';
import {focusedStrategyOutput,focusedReviewerOutput} from '../helpers/r12-focused-profile-fixture.mjs';
import {runOperatorRecipe as runRecoveryRecipe} from '../../scripts/r12-focused-pilot-unsent-recovery-bootstrap.mjs';
import {runOperatorRecipe as runSuccessorRecipe} from '../../scripts/r12-focused-pilot-successor-bootstrap.mjs';
import {runOperatorRecipe as runPilotRecipe} from '../../scripts/r12-focused-pilot-bootstrap.mjs';
import {r12QuoteFixture} from '../helpers/r12-provider-fixture.mjs';
import {seedR12Creative,controlR12Creative,launchR12Creative} from './r12-creative.mjs';
export const R12_INERT_ROOT='inert-r12-owner-root-configuration-0123456789';
const tables=['businesses','goals','workflow_runs','workflow_definitions','workflow_stage_runs','worker_definitions','worker_runs','task_contracts','artifacts','installed_packs','product_experiments','product_candidates','product_decisions','creative_approvals','creative_runs','creative_assets','creative_reviews','creative_cost_reservations','creative_cost_settlements','creative_phase_outputs','events','owner_interventions'];
export async function loadR12NextFixture(state,scenario,directory,host){
 assert.ok(['current','pending','scheduled-review','completed','bootstrap','review-preparation','review-ready','review-successor-preparation','review-successor-ready','evidence-preparation','evidence-ready','pilot-preparation','focused-successor-preparation'].includes(scenario));assert.ok(path.basename(directory).startsWith('r12-next-'));
 if(state.r12)await closeR12Fixture(state);
 const require=createRequire(path.join(host,'package.json')),{PGlite}=require('@electric-sql/pglite'),{pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
 const metadata=JSON.parse(await readFile(path.join(directory,scenario==='bootstrap'?'bootstrap-metadata.json':(scenario.startsWith('evidence-')||scenario.startsWith('pilot-')||scenario.startsWith('focused-successor-'))?'evidence-metadata.json':scenario.startsWith('review-successor-')?'successor-metadata.json':scenario.startsWith('review-')?'continuation-metadata.json':'metadata.json'),'utf8')),dump=await readFile(path.join(directory,`${['pilot-preparation','focused-successor-preparation'].includes(scenario)?'evidence-ready':scenario}.tgz`));
 const db=new PGlite({extensions:{pgcrypto},loadDataDir:new Blob([dump])});await db.waitReady;await db.exec("set timezone='UTC'");
 state.r12={...metadata,db,scenario,calls:[],receipts:[],quoteReads:0,generations:Object.fromEntries((await db.query("select candidate->>'phase' phase,candidate->>'providerRequestId' id from private.r12_discovery_candidates")).rows.map(r=>[r.phase,r.id]))};state.owner=metadata.ownerId;
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[state.owner]);
 if(scenario==='pilot-preparation'){const closed=await createClosedRejectedPlan4(db,state.r12);state.r12.closedEvidence={metadata:structuredClone(metadata),activated:{planId:closed.closedPlanId}};state.r12.sourceScopeId=metadata.scopeId;state.r12.preparationId=crypto.randomUUID();state.r12.setupUntil=new Date(Math.floor((Date.now()+2*3600000)/1000)*1000).toISOString();await seedR12Creative(state.r12);}
 if(scenario==='focused-successor-preparation'){
  const {createClosedFocusedPredecessor}=await import('../helpers/r12-focused-pilot-successor-sql-fixture.mjs');
  const closed=await createClosedRejectedPlan4(db,state.r12),closedBroad={metadata:structuredClone(metadata),activated:{planId:closed.closedPlanId}};
  await db.exec('begin');let closedFocused;try{closedFocused=await createClosedFocusedPredecessor(db,closedBroad,{nested:true});await db.exec('commit');}catch(error){await db.exec('rollback');throw error;}assert.ok(closedFocused.metadata?.scopeId);assert.ok(closedFocused.closedPlanId);
  Object.assign(state.r12,closedFocused.metadata,{scenario,closedFocused,sourceScopeId:closedFocused.metadata.scopeId,preparationId:crypto.randomUUID(),setupUntil:closedFocused.metadata.focusedProfile.expiresAt});
  delete state.r12.activated;await seedR12Creative(state.r12);
 }
 if(metadata.authSessionId)await db.query("select set_config('request.jwt.claim.session_id',$1,false)",[metadata.authSessionId]);await mirrorR12(state);
 state.businesses=state.db.businesses;state.db.profiles=[{id:state.owner,display_name:'Inert R12 workflow owner'}];
 state.quests.rows=(await db.query('select public.r04_quest_read($1,$2,20,0) result',[metadata.businessId,metadata.goalId])).rows[0].result.quests;
 // Fixture-only lease expiry models a fresh server request after process loss.
 await db.exec("update private.r07_heads set lease_expires_at=clock_timestamp()-interval '1 second'");
 return state.r12;
}
export async function mirrorR12(state){for(const table of tables)state.db[table]=(await state.r12.db.query(`select * from public.${table}`)).rows.map(row=>JSON.parse(JSON.stringify(row)));}
export async function controlR12(state,input){
 const r=state.r12;assert.ok(r);return exclusive(r,async()=>{await r.db.exec('reset role');const handled=[];
 if(input.r12FocusedSuccessorUnsent==='arm'){assert.equal(r.scenario,'focused-successor-staged');assert.ok(r.activated&&!r.closedUnsent);assert.deepEqual(r.calls,[]);r.simulateDispatchTimeout=true;handled.push('r12FocusedSuccessorUnsent');}
 if(input.r12FocusedSuccessorUnsent==='close'){
  assert.equal(r.scenario,'focused-successor-staged');assert.ok(r.simulateDispatchTimeout&&!r.closedUnsent);assert.deepEqual(r.calls,[]);assert.deepEqual(r.receipts,[]);
  const view=(await r.db.query('select public.r12_discovery_owner_read($1,$2,false) result',[r.businessId,r.scopeId])).rows[0].result;assert.equal(view.policyRevoked,true);assert.equal(view.phases[0].status,'reserved');
  await runSuccessorRecipe(reviewRecipeClient(r.db),'close',{businessId:r.businessId,scopeId:r.scopeId,scopeHash:r.staged.scopeHash,policyId:r.plan.policyId,policyHash:r.plan.policyHash,planHash:r.activated.planHash,successorAuthorizationHash:r.authorizationHash});
  await r.db.exec('begin');try{const exact=(await r.db.query('select private.r12_pilot_unsent_request($1,$2) result',[r.scopeId,view.phases[0].attemptId])).rows[0].result;await r.db.query('insert into private.r05_releases(request_id,business_id,evidence_hash) values($1,$2,$3)',[exact.requestId,r.businessId,createHash('sha256').update('Inert Next timeout before committed dispatch '+exact.attemptId).digest('hex')]);await r.db.query("select private.r05_result($1,$2,'allowed','released_unsent')",[r.businessId,exact.requestId]);await r.db.exec('commit');}catch(error){await r.db.exec('rollback');throw error;}
  const unsentClosure=(await r.db.query('select private.r12_pilot_unsent_closure($1) result',[r.scopeId])).rows[0].result;
  r.closedUnsent={scopeId:r.scopeId,planId:view.planId,closedPlanId:view.planId,unsentClosure,closedFocused:r.closedFocused,closedBroad:r.closedFocused.closedBroad,metadata:{focusedProfile:r.focusedProfile}};r.sourceScopeId=r.scopeId;r.preparationId=crypto.randomUUID();r.setupUntil=r.focusedProfile.expiresAt;r.scenario='focused-successor-preparation';r.unsentQuoteReads=r.quoteReads;r.quoteReads=0;r.simulateDispatchTimeout=false;delete r.successorStaged;delete r.activated;handled.push('r12FocusedSuccessorUnsent');await mirrorR12(state);
 }
 if(input.r12CreativeInstall||input.r12CreativeStage||input.r12CreativeActivate){await controlR12Creative(r,input);await mirrorR12(state);}
 if(input.r12Due){await r.db.exec('alter table private.r12_discovery_receipt_checks disable trigger r12_discovery_history_guard');await r.db.query("update private.r12_discovery_receipt_checks set created_at=clock_timestamp()-interval '121 seconds' where request_id in (select request_id from private.r12_discovery_wires where scope_id=$1)",[r.scopeId]);await r.db.exec('alter table private.r12_discovery_receipt_checks enable trigger r12_discovery_history_guard');await r.db.query("update private.r07_heads set lease_expires_at=clock_timestamp()-interval '1 second' where goal_id=$1",[r.goalId]);}
 if(input.r12BootstrapStage){assert.equal(r.scenario,'bootstrap');assert.ok(!r.staged);const receipt=input.r12BootstrapStage;assert.equal(receipt.businessId,r.businessId);assert.equal(receipt.priorId,r.priorRoundId);assert.equal(receipt.rootId,r.budgetAuthorityRootId);assert.equal(receipt.authorityCreated,false);const hash=label=>createHash('sha256').update('inert-'+label).digest('hex');r.setup={...receipt,approvalHash:hash('approved-packet'),ipsosReviewHash:hash('ipsos-review'),mdpiReviewHash:hash('mdpi-review'),independentReviewHash:hash('independent-review'),executionReviewHash:hash('execution-review'),eligibilityReviewHash:hash('eligibility-review'),quote:r12QuoteFixture()};r.staged=await operatorRecipe(r,'stage',r.setup);r.scopeId=receipt.scopeId;r.goalId=receipt.goalId;await mirrorR12(state);}
 if(input.r12BootstrapActivate){assert.equal(r.scenario,'bootstrap');assert.ok(r.staged&&!r.activated);const p=(await r.db.query('select id,content_hash hash from private.r05_policies where business_id=$1 and payload=$2::jsonb',[r.businessId,r.staged.policyPayload])).rows;assert.equal(p.length,1);r.activated=await operatorRecipe(r,'activate',{...r.setup,quote:r12QuoteFixture(),amendmentHash:r.staged.amendmentHash,policyId:p[0].id,policyHash:p[0].hash,policyInterpretationHash:createHash('sha256').update('inert-policy-review').digest('hex')});r.plan=r.activated.plan;await mirrorR12(state);}
 if(input.r12PilotStage){assert.equal(r.scenario,'pilot-preparation');assert.ok(!r.pilotStaged);await r.db.exec('begin');let prepared;try{prepared=await exerciseFocusedPilotLifecycle(r.db,r.closedEvidence,{nested:true,ownerPreparationReceipt:input.r12PilotStage,stageOnly:true});await r.db.exec('commit');}catch(error){await r.db.exec('rollback');throw error;}Object.assign(r,prepared.metadata,{pilotStaged:prepared.staged,scenario:'pilot-staged'});await mirrorR12(state);}
 if(input.r12PilotActivate){assert.equal(r.scenario,'pilot-staged');assert.ok(!r.activated);const receipt=input.r12PilotActivate;assert.equal(receipt.scopeId,r.scopeId);assert.equal(receipt.proposalHash,r.staged.proposalHash);r.activated=await runPilotRecipe(reviewRecipeClient(r.db),'activate',{businessId:r.businessId,scopeId:r.scopeId,scopeHash:r.staged.scopeHash,proposalHash:receipt.proposalHash,policyId:receipt.policyId,policyHash:receipt.policyHash,quote:r12QuoteFixture(Date.now(),false,true),executionReviewHash:r.executionReviewHash,eligibilityReviewHash:r.eligibilityReviewHash,controllerKeyHash:receipt.controllerKeyHash,admissionKeyHash:receipt.admissionKeyHash});r.plan=r.activated.plan;await mirrorR12(state);}
 if(input.r12FocusedSuccessorStage){
  assert.equal(r.scenario,'focused-successor-preparation');assert.ok(!r.successorStaged);const receipt=input.r12FocusedSuccessorStage;
  assert.equal(receipt.sourceScopeId,r.sourceScopeId);assert.equal(receipt.closedPlanId,r.closedUnsent?.closedPlanId??r.closedFocused.closedPlanId);assert.equal(receipt.authorityCreated,false);assert.equal(receipt.preparationId,r.preparationId);
  const exercise=r.closedUnsent?(await import('../helpers/r12-focused-pilot-unsent-recovery-sql-fixture.mjs')).exerciseFocusedPilotUnsentRecoveryLifecycle:(await import('../helpers/r12-focused-pilot-successor-sql-fixture.mjs')).exerciseFocusedPilotSuccessorLifecycle;
  await r.db.exec('begin');let prepared;try{prepared=await exercise(r.db,r.closedUnsent??r.closedFocused,{nested:true,ownerPreparationReceipt:receipt,stageOnly:true});await r.db.exec('commit');}catch(error){await r.db.exec('rollback');throw error;}
  Object.assign(r,prepared.metadata,{staged:prepared.staged,successorStaged:prepared.staged,successorStageInput:prepared.stageInput,scenario:'focused-successor-staged'});delete r.activated;
  const view=(await r.db.query('select public.r12_review_owner_read($1,$2) result',[r.businessId,r.scopeId])).rows[0].result;
  assert.equal(view.successor.authorizationHash,r.authorizationHash);assert.equal(view.proposalHash,r.staged.proposalHash);assert.equal(view.scope.id,receipt.preparationId);
  handled.push('r12FocusedSuccessorStage');await mirrorR12(state);
 }
 if(input.r12FocusedSuccessorActivate){
  assert.equal(r.scenario,'focused-successor-staged');assert.ok(r.successorStaged&&!r.activated);const receipt=input.r12FocusedSuccessorActivate;
  assert.equal(receipt.businessId,r.businessId);assert.equal(receipt.goalId,r.goalId);assert.equal(receipt.scopeId,r.scopeId);assert.equal(receipt.proposalHash,r.staged.proposalHash);assert.equal(receipt.executionAuthorized,false);
  r.activated=await (r.closedUnsent?runRecoveryRecipe:runSuccessorRecipe)(reviewRecipeClient(r.db),'activate',{businessId:r.businessId,scopeId:r.scopeId,scopeHash:r.staged.scopeHash,proposalHash:receipt.proposalHash,policyId:receipt.policyId,policyHash:receipt.policyHash,quote:r12QuoteFixture(Date.now(),false,true),executionReviewHash:r.executionReviewHash,eligibilityReviewHash:r.eligibilityReviewHash,controllerKeyHash:receipt.controllerKeyHash,admissionKeyHash:receipt.admissionKeyHash,[r.closedUnsent?'recoveryAuthorizationHash':'successorAuthorizationHash']:r.authorizationHash});r.plan=r.activated.plan;
  const view=(await r.db.query('select public.r12_discovery_owner_read($1,$2,false) result',[r.businessId,r.scopeId])).rows[0].result;
  assert.equal(view.focusedSuccessor.authorizationHash,r.authorizationHash);assert.equal(view.activeWindow,true);assert.equal(Date.parse(view.receiptUntil)-Date.parse(view.dispatchUntil),1800000);
  handled.push('r12FocusedSuccessorActivate');await mirrorR12(state);
 }
 if(input.r12FocusedSuccessorClose){
  assert.equal(r.scenario,'focused-successor-staged');assert.ok(r.activated);const receipt=input.r12FocusedSuccessorClose;
  assert.equal(receipt.scopeId,r.scopeId);assert.equal(receipt[r.closedUnsent?'recoveryAuthorizationHash':'successorAuthorizationHash'],r.authorizationHash);
  r.successorClosed=await (r.closedUnsent?runRecoveryRecipe:runSuccessorRecipe)(reviewRecipeClient(r.db),'close',receipt);
  const view=(await r.db.query('select public.r12_discovery_owner_read($1,$2,false) result',[r.businessId,r.scopeId])).rows[0].result;
  assert.equal(view.policyRevoked,true);assert.equal(view.activeWindow,false);assert.equal(view.cost.hasUnknown,false);assert.equal(view.cost.heldMicrousd,'0');
  handled.push('r12FocusedSuccessorClose');await mirrorR12(state);
 }
 if(input.r12ReviewActivate){
  assert.ok(['review-preparation','review-successor-preparation','evidence-preparation'].includes(r.scenario));assert.ok(!r.activated);const receipt=input.r12ReviewActivate;assert.equal(receipt.businessId,r.businessId);assert.equal(receipt.scopeId,r.scopeId);assert.equal(receipt.goalId,r.goalId);assert.equal(receipt.executionAuthorized,false);
  const staged=(await r.db.query('select s.amendment_hash,q.proposal_hash from private.r12_discovery_scopes s join private.r12_review_owner_proposals q on q.scope_id=s.id where s.id=$1',[r.scopeId])).rows[0];assert.equal(receipt.proposalHash,staged.proposal_hash);
  r.activated=await (r.scenario==='evidence-preparation'?runEvidenceRecipe:runReviewRecipe)(reviewRecipeClient(r.db),'activate',{businessId:r.businessId,scopeId:r.scopeId,scopeHash:staged.amendment_hash,proposalHash:receipt.proposalHash,policyId:receipt.policyId,policyHash:receipt.policyHash,quote:r12QuoteFixture(Date.now(),r.scenario==='evidence-preparation'),executionReviewHash:r.executionReviewHash,eligibilityReviewHash:r.eligibilityReviewHash,controllerKeyHash:receipt.controllerKeyHash,admissionKeyHash:receipt.admissionKeyHash});r.plan=r.activated.plan;await mirrorR12(state);
 }
 if(input.r12Pause){await r.db.query("select public.r05_policy_owner($1,'pause',$2,$3)",[r.businessId,{kind:'business',id:r.businessId},crypto.randomUUID()]);}
 return {handled,scopeId:r.scopeId,goalId:r.goalId,scenario:r.scenario,authorizationHash:r.authorizationHash??null,activated:!!r.activated};
 });
}
async function operatorRecipe(r,kind,input){
 const original=kind==='stage'?STAGING_SQL:ACTIVATION_SQL;let rendered=original;
 for(const [from,to] of r.bootstrapPins){assert.ok(rendered.includes(from));rendered=rendered.replaceAll(from,to);}
 const client={query:(statement,args)=>{if(statement===original)return r.db.exec(rendered);return args?r.db.query(statement,args):(/^\s*(DO|set local|create temporary)/.test(statement)?r.db.exec(statement):r.db.query(statement));}};
 return runOperatorRecipe(client,kind,input);
}
export async function closeR12Fixture(state){const r=state.r12;if(!r)return;r.closing=true;await exclusive(r,()=>r.db.close());if(state.r12===r)delete state.r12;}
const ownedNames=['r04_quest_transition','r04_research_link_preview','r12_discovery_owner_read','r12_discovery_result_read','r04_quest_read','r07_quest_read','r05_admission_read','r05_policy_owner','r12_review_owner_read','r12_review_owner_confirm','adopt_r12_focused_test','approve_creative_candidate','begin_creative_run','fail_creative_launch','r06_read'];
export async function r12OwnerRpc(state,name,args,mode='normal'){
 const r=state.r12;if(!r||!ownedNames.includes(name))return null;
 if(name==='r06_read'&&!['product_candidates','production_candidates','product_experiments','product_decisions'].includes(args.p_dataset))return null;
 if(mode==='unavailable')return{data:null,error:{message:'Inert owner metadata unavailable'}};
 const signatures={r12_review_owner_read:['p_business_id','p_scope_id'],r12_review_owner_confirm:['p_business_id','p_scope_id','p_proposal_hash'],r04_quest_transition:['p_business_id','p_operation','p_payload','p_submission_id'],r04_research_link_preview:['p_business_id','p_experiment_id'],r12_discovery_owner_read:['p_business_id','p_scope_id','p_activation'],r12_discovery_result_read:['p_business_id','p_scope_id'],r04_quest_read:['p_business_id','p_goal_id','p_limit','p_offset'],r07_quest_read:['p_business_id','p_goal_id','p_plan_id','p_limit','p_offset'],r05_admission_read:['p_business_id','p_policy_id','p_limit','p_offset'],r05_policy_owner:['p_business_id','p_operation','p_payload','p_submission_id']};
 Object.assign(signatures,{adopt_r12_focused_test:['p_scope_id','p_result','p_owner_intent'],approve_creative_candidate:['p_candidate_id','p_approval','p_quote'],begin_creative_run:['p_approval_id','p_launch_nonce','p_runtime_capability'],fail_creative_launch:['p_creative_run_id','p_launch_nonce'],r06_read:['p_business_id','p_dataset','p_query']});
 return sqlRpc(r,name,signatures[name].map(k=>args[k]??null),'authenticated',['r04_quest_transition','r05_policy_owner','r12_review_owner_confirm','adopt_r12_focused_test','approve_creative_candidate','begin_creative_run','fail_creative_launch'].includes(name)?()=>mirrorR12(state):undefined);
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
// Shared by the HTTP boundary and SQL adapter: a newly added runtime RPC must
// have one explicit SQL signature instead of silently falling through either list.
export const R12_RUNTIME_RPC_ARGUMENTS=Object.freeze({
 r07_controller:Object.freeze(['p_business_id','p_goal_id','p_operation','p_payload','p_submission_id','p_server_key','p_lease_token','p_epoch','p_admission_key']),
 r12_recovery_dispatch:Object.freeze(['p_business_id','p_goal_id','p_scope_id','p_payload','p_submission_id','p_server_key','p_lease_token','p_epoch','p_admission_key']),
 r12_discovery_server:Object.freeze(['p_business_id','p_attempt_id','p_operation','p_payload','p_server_key']),
 creative_runtime_transition:Object.freeze(['p_creative_run_id','p_business_id','p_runtime_capability','p_operation','p_payload']),
});
export async function r12RuntimeRpc(state,name,args){
 const r=state.r12;assert.ok(r);assert.ok(Object.hasOwn(R12_RUNTIME_RPC_ARGUMENTS,name),'Inert runtime RPC unavailable');
 const keys=R12_RUNTIME_RPC_ARGUMENTS[name];
 if(name==='r12_recovery_dispatch')assert.deepEqual(Object.keys(args).sort(),[...keys].sort(),'Recovery RPC accepts only its exact dispatch signature');
 if(r.simulateDispatchTimeout&&(name==='r12_recovery_dispatch'||(name==='r07_controller'&&args.p_operation==='dispatch')))return exclusive(r,async()=>{
  await r.db.exec('begin');try{await r.db.exec('set role anon');const marked=(await r.db.query(`select public.${name}(${keys.map((_,i)=>`$${i+1}`).join(',')}) result`,keys.map(k=>args[k]??null))).rows[0].result;assert.equal(marked.shouldDispatch,true);await assert.rejects(r.db.exec("do $$ begin raise exception 'Inert Next dispatch deadline before commit' using errcode='57014'; end $$"),error=>error.code==='57014');return{data:null,error:{code:'57014',message:'Inert Next dispatch deadline before commit'}};}finally{await r.db.exec('rollback');await mirrorR12(state);}
 });
 return sqlRpc(r,name,keys.map(k=>args[k]??null),'anon',()=>mirrorR12(state));
}
export async function r12CreativeLaunch(state,input){return exclusive(state.r12,async()=>{const result=await launchR12Creative(state.r12,input);await mirrorR12(state);return result;});}
export function r12Quote(state){state.r12.quoteReads++;return r12QuoteFixture(Date.now(),state.r12.scenario.startsWith('evidence-'),(state.r12.scenario.startsWith('pilot-')||state.r12.scenario.startsWith('focused-successor-')));}
export function r12Provider(state,input,control,effects){
 const r=state.r12;assert.ok(r);const phase=input.phase;assert.ok(['plan','search1','select1','strategy','review'].includes(phase));
 const model=phase==='review'?'anthropic/claude-4.5-haiku-20251001':'openai/gpt-5.6-luna-20260709',id=`gen-r12-next-${r.scopeId}-${phase}`;
 if(input.method==='POST'){
  assert.equal(input.url,'https://openrouter.ai/api/v1/chat/completions');assert.ok(!r.calls.includes(phase),'Paid phase cannot regenerate');r.calls.push(phase);r.generations[phase]=id;effects.push({kind:'inert-r12-provider',phase});
  assert.deepEqual(input.body.provider.only,[phase==='review'?'amazon-bedrock/us':'azure/us']);
  if((r.scenario.startsWith('pilot-')||r.scenario.startsWith('focused-successor-'))){const encoded=JSON.parse(input.body.messages[1].content);const decode=v=>Array.isArray(v)?v.map(decode):v&&typeof v==='object'?Object.keys(v).length===1&&'$text'in v?encoded.sharedText[v.$text]:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,decode(x)])):v;const prompt=decode(encoded),prepared={evidencePool:prompt.evidence};r.outputs={strategy:focusedStrategyOutput(prepared),review:focusedReviewerOutput(prepared)};}
  if(phase==='strategy'&&r.scenario.startsWith('focused-successor-')&&control.r12SuccessorStrategyOutcome){
   assert.ok(['TEST','NEEDS_MORE_EVIDENCE','REJECT','INVALID','INCONSISTENT'].includes(control.r12SuccessorStrategyOutcome));
   if(['NEEDS_MORE_EVIDENCE','REJECT'].includes(control.r12SuccessorStrategyOutcome)){r.outputs.strategy.recommendation.proposedOutcome=control.r12SuccessorStrategyOutcome;r.outputs.strategy.usesPinnedLearningPlan=false;}
   if(control.r12SuccessorStrategyOutcome==='INVALID')r.outputs.strategy.usesPinnedLearningPlan=false;
   if(control.r12SuccessorStrategyOutcome==='INCONSISTENT')r.outputs.strategy.candidates[0].dimensions[0].uncertainties.push({question:'Does this exact proposal have an unresolved blocking constraint?',blockingForTest:true,reason:'This synthetic unresolved constraint prevents recommending the exact pinned learning proposal.'});
  }
  const message=phase==='search1'?{content:'Synthetic bounded public source context.',annotations:r.outputs.search1.annotations}:{content:JSON.stringify(r.outputs[phase])};
  if(phase==='review'&&control.r12ReviewFailure==='schema')message.content=JSON.stringify({...r.outputs.review,checks:r.outputs.review.checks.map((check,index)=>index===0?{...check,rationale:'x'.repeat(241)}:check)});
  if(phase==='review'&&control.r12ReviewFailure==='json')message.content='UNQUALIFIED_NEXT_JSON_SENTINEL';
  return{status:200,body:{id,model,choices:[{finish_reason:'stop',message}],usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150,cost:.00001,...(phase==='search1'?{server_tool_use_details:{web_search_requests:1}}:{})}}};
 }
 assert.equal(input.method,'GET');const generationId=r.generations[phase];assert.ok(generationId);assert.equal(input.url,`https://openrouter.ai/api/v1/generation?id=${generationId}`);r.receipts.push(phase);
 if(control.r12DelayReceipt&&phase===((r.scenario.startsWith('evidence-')||(r.scenario.startsWith('pilot-')||r.scenario.startsWith('focused-successor-')))?'strategy':r.scenario.startsWith('review-')?'review':'plan'))return{status:404,body:{error:{message:'Synthetic receipt not yet indexed'}}};
 return{status:200,body:{data:{id:generationId,provider_name:phase==='review'?'Amazon Bedrock':'Azure',model}}};
}
