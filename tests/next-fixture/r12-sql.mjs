import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createOwnerInitialNextFixture} from './r12-owner-initial.mjs';
import {ownerInitialPhaseOutputs} from '../helpers/r12-owner-initial-runtime.mjs';
import {r12PhaseOutputFixture} from '../helpers/r12-phase-output-fixture.mjs';
import {r12NextSnapshotFiles} from '../helpers/r12-next-capture-plan.mjs';
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
import {runOperatorRecipe as runTerminalRecipe} from '../../scripts/r12-terminal-technical-qualification-bootstrap.mjs';
import {runOperatorRecipe as runPilotRecipe} from '../../scripts/r12-focused-pilot-bootstrap.mjs';
import {r12CatalogFixture,r12QuoteFixture} from '../helpers/r12-provider-fixture.mjs';
import {qualifyAdaptiveResearchQuote,qualifyEtsyOwnerResearchQuote} from '../../.core-tests/products/discovery-r12-adaptive-quote.js';
import {seedR12Creative,controlR12Creative,launchR12Creative} from './r12-creative.mjs';
export const R12_INERT_ROOT='inert-r12-owner-root-configuration-0123456789';
const tables=['businesses','goals','workflow_runs','workflow_definitions','workflow_stage_runs','worker_definitions','worker_runs','task_contracts','artifacts','installed_packs','product_experiments','product_candidates','product_decisions','creative_approvals','creative_runs','creative_assets','creative_reviews','creative_cost_reservations','creative_cost_settlements','creative_phase_outputs','events','owner_interventions'];
export async function r12FixtureState(db,metadata,scenario){
 return{...metadata,db,scenario,calls:[],receipts:[],quoteReads:0,generations:Object.fromEntries((await db.query("select candidate->>'phase' phase,candidate->>'providerRequestId' id from private.r12_discovery_candidates")).rows.map(r=>[r.phase,r.id]))};
}
export async function loadR12NextFixture(state,scenario,directory,host){
 const ownerInitial=['owner-initial-native','owner-initial-legacy'].includes(scenario);
 assert.ok(['owner-initial-native','owner-initial-legacy','current','pending','scheduled-review','completed','bootstrap','review-preparation','review-ready','review-successor-preparation','review-successor-ready','evidence-preparation','evidence-ready','pilot-preparation','focused-successor-preparation'].includes(scenario));if(!ownerInitial)assert.ok(path.basename(directory).startsWith('r12-next-'));
 if(state.r12)await closeR12Fixture(state);
 const require=createRequire(path.join(host,'package.json')),{PGlite}=require('@electric-sql/pglite'),{pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
 let db,metadata;
 if(ownerInitial){({db,metadata}=await createOwnerInitialNextFixture(host,scenario.endsWith('-legacy')?'legacy':'native'));}
 else{const files=r12NextSnapshotFiles(scenario);metadata=JSON.parse(await readFile(path.join(directory,files.metadata),'utf8'));const dump=await readFile(path.join(directory,files.snapshot));db=new PGlite({extensions:{pgcrypto},loadDataDir:new Blob([dump])});await db.waitReady;await db.exec("set timezone='UTC'");}
 state.r12=await r12FixtureState(db,metadata,scenario);state.owner=metadata.ownerId;
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
 if(input.r12FocusedSuccessorUnsent==='terminal-source'){
  assert.equal(r.scenario,'focused-successor-preparation');assert.ok(r.closedFocused&&!r.closedUnsent&&!r.closedMarked);assert.deepEqual(r.calls,[]);
  const {createClosedUnsentSuccessor}=await import('../helpers/r12-focused-pilot-unsent-recovery-sql-fixture.mjs');
  const {createReconciledMarkedRecovery}=await import('../helpers/r12-terminal-qualification-sql-fixture.mjs');
  await r.db.exec('begin');let closedUnsent,closedMarked;try{closedUnsent=await createClosedUnsentSuccessor(r.db,r.closedFocused,{nested:true,guards:false});closedMarked=await createReconciledMarkedRecovery(r.db,closedUnsent,{nested:true,guards:false,refreshEvidence:true});await r.db.exec('commit');}catch(error){await r.db.exec('rollback');throw error;}
  Object.assign(r,closedMarked.metadata,{closedUnsent,closedMarked,sourceScopeId:closedMarked.scopeId,preparationId:crypto.randomUUID(),setupUntil:closedMarked.metadata.focusedProfile.expiresAt,scenario:'focused-successor-preparation',refreshEvidence:false,quoteReads:0});delete r.activated;delete r.successorStaged;handled.push('r12FocusedSuccessorUnsent');await mirrorR12(state);
 }
 if(input.r12FocusedSuccessorUnsent==='arm'){assert.equal(r.scenario,'focused-successor-staged');assert.ok(r.activated&&!r.closedUnsent);assert.deepEqual(r.calls,[]);r.simulateDispatchTimeout=true;handled.push('r12FocusedSuccessorUnsent');}
 if(input.r12FocusedSuccessorUnsent==='close'){
  assert.equal(r.scenario,'focused-successor-staged');assert.ok(r.simulateDispatchTimeout&&!r.closedUnsent);assert.deepEqual(r.calls,[]);assert.deepEqual(r.receipts,[]);
  const view=(await r.db.query('select public.r12_discovery_owner_read($1,$2,false) result',[r.businessId,r.scopeId])).rows[0].result;assert.equal(view.policyRevoked,true);assert.equal(view.phases[0].status,'reserved');
  await runSuccessorRecipe(reviewRecipeClient(r.db),'close',{businessId:r.businessId,scopeId:r.scopeId,scopeHash:r.staged.scopeHash,policyId:r.plan.policyId,policyHash:r.plan.policyHash,planHash:r.activated.planHash,successorAuthorizationHash:r.authorizationHash});
  await r.db.exec('begin');try{const exact=(await r.db.query('select private.r12_pilot_unsent_request($1,$2) result',[r.scopeId,view.phases[0].attemptId])).rows[0].result;await r.db.query('insert into private.r05_releases(request_id,business_id,evidence_hash) values($1,$2,$3)',[exact.requestId,r.businessId,createHash('sha256').update('Inert Next timeout before committed dispatch '+exact.attemptId).digest('hex')]);await r.db.query("select private.r05_result($1,$2,'allowed','released_unsent')",[r.businessId,exact.requestId]);await r.db.exec('commit');}catch(error){await r.db.exec('rollback');throw error;}
  const unsentClosure=(await r.db.query('select private.r12_pilot_unsent_closure($1) result',[r.scopeId])).rows[0].result;
  r.closedUnsent={scopeId:r.scopeId,planId:view.planId,closedPlanId:view.planId,unsentClosure,closedFocused:r.closedFocused,closedBroad:r.closedFocused.closedBroad,metadata:{focusedProfile:r.focusedProfile}};r.sourceScopeId=r.scopeId;r.preparationId=crypto.randomUUID();r.refreshEvidence=input.r12EvidenceRefresh===true;r.setupUntil=r.refreshEvidence?new Date(Math.floor((Date.now()+10800000)/1000)*1000).toISOString():r.focusedProfile.expiresAt;r.scenario='focused-successor-preparation';r.unsentQuoteReads=r.quoteReads;r.quoteReads=0;r.simulateDispatchTimeout=false;delete r.successorStaged;delete r.activated;handled.push('r12FocusedSuccessorUnsent');await mirrorR12(state);
 }
 if(input.r12CreativeInstall||input.r12CreativeStage||input.r12CreativeActivate){await controlR12Creative(r,input);await mirrorR12(state);}
 if(input.r12Due){await r.db.exec('alter table private.r12_discovery_receipt_checks disable trigger r12_discovery_history_guard');await r.db.query("update private.r12_discovery_receipt_checks set created_at=clock_timestamp()-interval '121 seconds' where request_id in (select request_id from private.r12_discovery_wires where scope_id=$1)",[r.scopeId]);await r.db.exec('alter table private.r12_discovery_receipt_checks enable trigger r12_discovery_history_guard');await r.db.query("update private.r07_heads set lease_expires_at=clock_timestamp()-interval '1 second' where goal_id=$1",[r.goalId]);}
 if(input.r12BootstrapStage){assert.equal(r.scenario,'bootstrap');assert.ok(!r.staged);const receipt=input.r12BootstrapStage;assert.equal(receipt.businessId,r.businessId);assert.equal(receipt.priorId,r.priorRoundId);assert.equal(receipt.rootId,r.budgetAuthorityRootId);assert.equal(receipt.authorityCreated,false);const hash=label=>createHash('sha256').update('inert-'+label).digest('hex');r.setup={...receipt,approvalHash:hash('approved-packet'),ipsosReviewHash:hash('ipsos-review'),mdpiReviewHash:hash('mdpi-review'),independentReviewHash:hash('independent-review'),executionReviewHash:hash('execution-review'),eligibilityReviewHash:hash('eligibility-review'),quote:r12QuoteFixture()};r.staged=await operatorRecipe(r,'stage',r.setup);r.scopeId=receipt.scopeId;r.goalId=receipt.goalId;await mirrorR12(state);}
 if(input.r12BootstrapActivate){assert.equal(r.scenario,'bootstrap');assert.ok(r.staged&&!r.activated);const p=(await r.db.query('select id,content_hash hash from private.r05_policies where business_id=$1 and payload=$2::jsonb',[r.businessId,r.staged.policyPayload])).rows;assert.equal(p.length,1);r.activated=await operatorRecipe(r,'activate',{...r.setup,quote:r12QuoteFixture(),amendmentHash:r.staged.amendmentHash,policyId:p[0].id,policyHash:p[0].hash,policyInterpretationHash:createHash('sha256').update('inert-policy-review').digest('hex')});r.plan=r.activated.plan;await mirrorR12(state);}
 if(input.r12PilotStage){assert.equal(r.scenario,'pilot-preparation');assert.ok(!r.pilotStaged);await r.db.exec('begin');let prepared;try{prepared=await exerciseFocusedPilotLifecycle(r.db,r.closedEvidence,{nested:true,ownerPreparationReceipt:input.r12PilotStage,stageOnly:true});await r.db.exec('commit');}catch(error){await r.db.exec('rollback');throw error;}Object.assign(r,prepared.metadata,{pilotStaged:prepared.staged,scenario:'pilot-staged'});await mirrorR12(state);}
 if(input.r12PilotActivate){assert.equal(r.scenario,'pilot-staged');assert.ok(!r.activated);const receipt=input.r12PilotActivate;assert.equal(receipt.scopeId,r.scopeId);assert.equal(receipt.proposalHash,r.staged.proposalHash);r.activated=await runPilotRecipe(reviewRecipeClient(r.db),'activate',{businessId:r.businessId,scopeId:r.scopeId,scopeHash:r.staged.scopeHash,proposalHash:receipt.proposalHash,policyId:receipt.policyId,policyHash:receipt.policyHash,quote:r12QuoteFixture(Date.now(),false,true),executionReviewHash:r.executionReviewHash,eligibilityReviewHash:r.eligibilityReviewHash,controllerKeyHash:receipt.controllerKeyHash,admissionKeyHash:receipt.admissionKeyHash});r.plan=r.activated.plan;await mirrorR12(state);}
 if(input.r12FocusedSuccessorStage){
  assert.equal(r.scenario,'focused-successor-preparation');assert.ok(!r.successorStaged);const receipt=input.r12FocusedSuccessorStage;
  assert.equal(receipt.sourceScopeId,r.sourceScopeId);assert.equal(receipt.closedPlanId,r.closedMarked?.planId??r.closedUnsent?.closedPlanId??r.closedFocused.closedPlanId);assert.equal(receipt.authorityCreated,false);assert.equal(receipt.preparationId,r.preparationId);
  const exercise=r.closedMarked?(await import('../helpers/r12-terminal-qualification-sql-fixture.mjs')).exerciseTerminalQualificationLifecycle:r.closedUnsent?(await import('../helpers/r12-focused-pilot-unsent-recovery-sql-fixture.mjs')).exerciseFocusedPilotUnsentRecoveryLifecycle:(await import('../helpers/r12-focused-pilot-successor-sql-fixture.mjs')).exerciseFocusedPilotSuccessorLifecycle;
  await r.db.exec('begin');let prepared;try{prepared=await exercise(r.db,r.closedMarked??r.closedUnsent??r.closedFocused,{nested:true,ownerPreparationReceipt:receipt,stageOnly:true,refreshEvidence:!!r.refreshEvidence,qualificationGuards:!r.closedMarked});await r.db.exec('commit');}catch(error){await r.db.exec('rollback');throw error;}
  Object.assign(r,prepared.metadata,{staged:prepared.staged,successorStaged:prepared.staged,successorStageInput:prepared.stageInput,scenario:'focused-successor-staged'});delete r.activated;
  const view=(await r.db.query('select public.r12_review_owner_read($1,$2) result',[r.businessId,r.scopeId])).rows[0].result;
  assert.equal(view.successor.authorizationHash,r.authorizationHash);assert.equal(view.proposalHash,r.staged.proposalHash);assert.equal(view.scope.id,receipt.preparationId);
  handled.push('r12FocusedSuccessorStage');await mirrorR12(state);
 }
 if(input.r12FocusedSuccessorActivate){
  assert.equal(r.scenario,'focused-successor-staged');assert.ok(r.successorStaged&&!r.activated);const receipt=input.r12FocusedSuccessorActivate;
  assert.equal(receipt.businessId,r.businessId);assert.equal(receipt.goalId,r.goalId);assert.equal(receipt.scopeId,r.scopeId);assert.equal(receipt.proposalHash,r.staged.proposalHash);assert.equal(receipt.executionAuthorized,false);
  r.activated=await (r.closedMarked?runTerminalRecipe:r.closedUnsent?runRecoveryRecipe:runSuccessorRecipe)(reviewRecipeClient(r.db),'activate',{businessId:r.businessId,scopeId:r.scopeId,scopeHash:r.staged.scopeHash,proposalHash:receipt.proposalHash,policyId:receipt.policyId,policyHash:receipt.policyHash,quote:r12QuoteFixture(Date.now(),false,true),executionReviewHash:r.executionReviewHash,eligibilityReviewHash:r.eligibilityReviewHash,controllerKeyHash:receipt.controllerKeyHash,admissionKeyHash:receipt.admissionKeyHash,[r.closedMarked?'terminalAuthorizationHash':r.closedUnsent?'recoveryAuthorizationHash':'successorAuthorizationHash']:r.authorizationHash});r.plan=r.activated.plan;
  const view=(await r.db.query('select public.r12_discovery_owner_read($1,$2,false) result',[r.businessId,r.scopeId])).rows[0].result;
  assert.equal(view.focusedSuccessor.authorizationHash,r.authorizationHash);assert.equal(view.activeWindow,true);assert.equal(Date.parse(view.receiptUntil)-Date.parse(view.dispatchUntil),1800000);
  handled.push('r12FocusedSuccessorActivate');await mirrorR12(state);
 }
 if(input.r12FocusedSuccessorClose){
  assert.equal(r.scenario,'focused-successor-staged');assert.ok(r.activated);const receipt=input.r12FocusedSuccessorClose;
  assert.equal(receipt.scopeId,r.scopeId);assert.equal(receipt[r.closedMarked?'terminalAuthorizationHash':r.closedUnsent?'recoveryAuthorizationHash':'successorAuthorizationHash'],r.authorizationHash);
  r.successorClosed=await (r.closedMarked?runTerminalRecipe:r.closedUnsent?runRecoveryRecipe:runSuccessorRecipe)(reviewRecipeClient(r.db),'close',receipt);
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
const ownedNames=['r12_owner_observation_server','r12_owner_research_read','r12_owner_research_preflight','r12_owner_research_server','r12_owner_adaptive_read','r12_owner_adaptive_preflight','r12_owner_adaptive_server','r04_quest_transition','r04_research_link_preview','r12_discovery_owner_read','r12_discovery_result_read','r04_quest_read','r07_quest_read','r05_admission_read','r05_policy_owner','r12_review_owner_read','r12_review_owner_confirm','adopt_r12_focused_test','approve_creative_candidate','begin_creative_run','fail_creative_launch','r06_read'];
export async function r12OwnerRpc(state,name,args,mode='normal'){
 const r=state.r12;if(!r||!ownedNames.includes(name))return null;
 if(name==='r06_read'&&!['product_candidates','production_candidates','product_experiments','product_decisions'].includes(args.p_dataset))return null;
 if(mode==='unavailable')return{data:null,error:{message:'Inert owner metadata unavailable'}};
 const signatures={r12_owner_research_read:['p_business_id','p_goal_id','p_setup_id'],r12_owner_research_preflight:['p_business_id','p_setup_id','p_setup_hash','p_quote'],r12_owner_research_server:['p_business_id','p_operation','p_payload','p_server_key'],r12_review_owner_read:['p_business_id','p_scope_id'],r12_review_owner_confirm:['p_business_id','p_scope_id','p_proposal_hash'],r04_quest_transition:['p_business_id','p_operation','p_payload','p_submission_id'],r04_research_link_preview:['p_business_id','p_experiment_id'],r12_discovery_owner_read:['p_business_id','p_scope_id','p_activation'],r12_discovery_result_read:['p_business_id','p_scope_id'],r04_quest_read:['p_business_id','p_goal_id','p_limit','p_offset'],r07_quest_read:['p_business_id','p_goal_id','p_plan_id','p_limit','p_offset'],r05_admission_read:['p_business_id','p_policy_id','p_limit','p_offset'],r05_policy_owner:['p_business_id','p_operation','p_payload','p_submission_id']};
 Object.assign(signatures,{r12_owner_observation_server:['p_business_id','p_operation','p_payload','p_server_key'],r12_owner_adaptive_read:['p_business_id','p_goal_id','p_setup_id'],r12_owner_adaptive_preflight:['p_business_id','p_setup_id','p_setup_hash','p_quote'],r12_owner_adaptive_server:['p_business_id','p_operation','p_payload','p_server_key'],adopt_r12_focused_test:['p_scope_id','p_result','p_owner_intent'],approve_creative_candidate:['p_candidate_id','p_approval','p_quote'],begin_creative_run:['p_approval_id','p_launch_nonce','p_runtime_capability'],fail_creative_launch:['p_creative_run_id','p_launch_nonce'],r06_read:['p_business_id','p_dataset','p_query']});
 const result=await sqlRpc(r,name,signatures[name].map(k=>args[k]??null),'authenticated',['r12_owner_research_server','r12_owner_adaptive_server','r04_quest_transition','r05_policy_owner','r12_review_owner_confirm','adopt_r12_focused_test','approve_creative_candidate','begin_creative_run','fail_creative_launch'].includes(name)?()=>mirrorR12(state):undefined);
 if(name==='r12_owner_adaptive_server')console.log('ADAPTIVE_OWNER_RPC_RESULT:',JSON.stringify({operation:args.p_operation,error:result.error?.message??null,keys:result.data&&typeof result.data==='object'?Object.keys(result.data):[],version:result.data?.version??null}));
 if(name==='r12_owner_adaptive_preflight')console.log('ADAPTIVE_PREFLIGHT_RPC_RESULT:',JSON.stringify({error:result.error?.message??null,keys:result.data&&typeof result.data==='object'?Object.keys(result.data):[],version:result.data?.version??null}));
 if(name==='r12_discovery_owner_read'&&r.adaptiveScopeId===args.p_scope_id)console.log('ADAPTIVE_OWNER_WORKSPACE_READ:',JSON.stringify({error:result.error?.message??null,keys:result.data&&typeof result.data==='object'?Object.keys(result.data):[],activationKeys:result.data?.activation&&typeof result.data.activation==='object'?Object.keys(result.data.activation):[],state:result.data?.state??null}));
 if(name==='r12_owner_research_server'&&result.data){const receipt=result.data;r.scopeId=receipt.scopeId;r.goalId=receipt.goalId;r.ownerSetup=receipt;if(receipt.activated&&r.ownerOutputsScope!==receipt.scopeId){const scope=await exclusive(r,async()=>(await r.db.query('select amendment from private.r12_discovery_scopes where id=$1',[receipt.scopeId])).rows[0].amendment);r.callsByScope??={};if(r.ownerOutputsScope)r.callsByScope[r.ownerOutputsScope]=[...r.calls];r.calls=[];r.receipts=[];r.generations={};r.outputs=ownerInitialPhaseOutputs(scope);r.ownerOutputsScope=receipt.scopeId;}}
 if(name==='r12_owner_adaptive_server'&&result.data?.activated&&r.adaptiveScopeId!==result.data.scopeId){
  r.adaptiveScopeId=result.data.scopeId;
  r.adaptiveReceiptPlanHash=result.data.planHash;
  r.adaptiveScope=await exclusive(r,async()=>(await r.db.query('select amendment from private.r12_discovery_scopes where id=$1',[r.adaptiveScopeId])).rows[0].amendment);
  r.adaptiveCalls=[];r.adaptiveReceipts=[];r.adaptiveGenerations={};
 }
 return result;
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
 r12_recovery_server:Object.freeze(['p_business_id','p_scope_id','p_attempt_id','p_operation','p_payload','p_server_key']),
 r12_discovery_server:Object.freeze(['p_business_id','p_attempt_id','p_operation','p_payload','p_server_key']),
 r12_adaptive_controller_server:Object.freeze(['p_business_id','p_scope_id','p_operation','p_payload','p_server_key']),
 creative_runtime_transition:Object.freeze(['p_creative_run_id','p_business_id','p_runtime_capability','p_operation','p_payload']),
});
export async function r12RuntimeRpc(state,name,args){
 const r=state.r12;assert.ok(r);assert.ok(Object.hasOwn(R12_RUNTIME_RPC_ARGUMENTS,name),'Inert runtime RPC unavailable');
 const keys=R12_RUNTIME_RPC_ARGUMENTS[name];
 if(name==='r12_recovery_server'){assert.deepEqual(Object.keys(args).sort(),[...keys].sort(),'Recovery runtime accepts only its exact scoped signature');assert.ok(['inputs','bind','send'].includes(args.p_operation),'Recovery runtime operation unavailable');}
 if(name==='r12_recovery_dispatch')assert.deepEqual(Object.keys(args).sort(),[...keys].sort(),'Recovery RPC accepts only its exact dispatch signature');
 if(r.simulateDispatchTimeout&&(name==='r12_recovery_dispatch'||(name==='r07_controller'&&args.p_operation==='dispatch')))return exclusive(r,async()=>{
  await r.db.exec('begin');try{await r.db.exec('set role anon');const marked=(await r.db.query(`select public.${name}(${keys.map((_,i)=>`$${i+1}`).join(',')}) result`,keys.map(k=>args[k]??null))).rows[0].result;assert.equal(marked.shouldDispatch,true);await assert.rejects(r.db.exec("do $$ begin raise exception 'Inert Next dispatch deadline before commit' using errcode='57014'; end $$"),error=>error.code==='57014');return{data:null,error:{code:'57014',message:'Inert Next dispatch deadline before commit'}};}finally{await r.db.exec('rollback');await mirrorR12(state);}
 });
 const result=await sqlRpc(r,name,keys.map(k=>args[k]??null),'anon',()=>mirrorR12(state));
 if(r.adaptiveScopeId)console.log('ADAPTIVE_RUNTIME_RPC_STAGE:',JSON.stringify({rpc:name,operation:args.p_operation??null,ok:!result.error}));
 if(result.error&&r.adaptiveScopeId)console.log('ADAPTIVE_RUNTIME_RPC_REJECTED:',JSON.stringify({rpc:name,operation:args.p_operation??null,error:String(result.error.message).slice(0,240)}));
 if(name==='r07_controller'&&args.p_operation==='read'&&r.adaptiveScopeId)console.log('ADAPTIVE_CONTROLLER_READ_SHAPE:',JSON.stringify({error:result.error?.message??null,keys:result.data&&typeof result.data==='object'?Object.keys(result.data):[],knowledgeKeys:result.data?.knowledge&&typeof result.data.knowledge==='object'?Object.keys(result.data.knowledge):[],planHashMatches:result.data?.planHash===r.adaptiveReceiptPlanHash,attempts:Array.isArray(result.data?.attempts)?result.data.attempts.map(item=>({stepKey:item.stepKey,status:item.status,actionHashPresent:typeof item.adaptiveActionHash==='string',actionOrdinal:item.adaptiveActionOrdinal??null,requestIdPresent:!!item.requestId})):null}));
 if(name==='r12_adaptive_controller_server'&&args.p_operation==='action_context')r.adaptiveActionContext=result.data??null;
 return result;
}
export async function r12CreativeLaunch(state,input){return exclusive(state.r12,async()=>{const result=await launchR12Creative(state.r12,input);await mirrorR12(state);return result;});}
export function r12Quote(state){state.r12.quoteReads++;return r12QuoteFixture(Date.now(),state.r12.scenario.startsWith('evidence-'),(state.r12.scenario.startsWith('pilot-')||state.r12.scenario.startsWith('focused-successor-')));}
export function r12AdaptiveQuote(state,version='r12.adaptive-quote.1'){state.r12.quoteReads++;const now=Date.now();assert.ok(['r12.adaptive-quote.1','r12.adaptive-quote.2'].includes(version));return version==='r12.adaptive-quote.2'?qualifyEtsyOwnerResearchQuote(r12CatalogFixture(now),now):qualifyAdaptiveResearchQuote(r12CatalogFixture(now),now);}
function adaptiveProviderOutput(r,phase,body){
 const ordinal=r.adaptiveActionContext.ordinal;
 const etsy=r.adaptiveScope.version==='r12.discovery-owner-adaptive.2';
 const audience=r.adaptiveScope.intent.comparisonUniverse.audiences[0];
 const outputs=r12PhaseOutputFixture(audience);
 const excerpts=ordinal===0?[
  'An inert dated GB adult apparel survey describes comfort and durability as purchase considerations, without measuring demand for original astronomy T-shirts.',
  'An inert GB design-interest report describes interest in star and night-sky motifs, without sales, willingness-to-pay or conversion measurements.',
 ]:[
  'An inert follow-up GB adult survey separates astronomy motif recognition from stated apparel purchase intent; its sample is too narrow for a population demand estimate.',
  'An inert follow-up source reports mixed stated interest in original sky-themed shirts and no observed purchases, leaving willingness-to-pay unresolved.',
 ];
 const reviewedDomain=r.adaptiveScope.allowedDomains[0];
 assert.ok(typeof reviewedDomain==='string'&&reviewedDomain.length>0,'The inert source must use an enrolled public domain');
 outputs.search1.annotations=excerpts.map((content,index)=>({type:'url_citation',url_citation:{url:`https://${reviewedDomain}/gb-adult-apparel-${ordinal}-${index+1}`,title:'Explicitly synthetic public-source fixture',content}}));
 outputs.select1.selections=excerpts.map((content,index)=>({sourceKey:`S${index+1}`,quote:content.slice(0,120)}));
 outputs.strategy.marketComparisons=outputs.strategy.marketComparisons.filter(item=>r.adaptiveScope.intent.comparisonUniverse.markets.some(market=>market.countryCode===item.countryCode));
 outputs.plan.comparisonRationale='Compare only the reviewed GB adult audience and preserve uncertainty about actual original astronomy shirt demand.';
 outputs.plan.queryFocus=etsy?[]:['Dated GB adult apparel considerations and original astronomy motif interest'];
 if(etsy){
  outputs.plan.comparisonRationale='Compare the selected owner-reported Etsy captures and retain their negative signals, ordinal conversion wording and unknown buyer geography.';
  for(const market of outputs.strategy.marketComparisons){market.assessment='The owner-reported Etsy captures preserve Very low conversion wording but establish neither a numeric conversion rate nor GB buyer demand.';market.evidence=[];}
  outputs.strategy.recommendation.rationale='Comparable owner-reported captures remain insufficient to establish candidate sales, geographic demand or an informative exposure denominator.';
 }
 outputs.plan.proposals=['star-chart linework','lunar phase geometry','night-sky contours'].map(concept=>({concept:`Original ${concept}`,audience,hypothesis:'Test whether an original astronomy design communicates a clear adult apparel concept.',differentiationHypothesis:'Use original restrained linework without copied marketplace or branded artwork.'}));
 if(phase==='strategy')return{assessment:outputs.strategy,measurement:null};
 if(phase==='review'){
  const context=JSON.parse(body.messages[1].content).reviewContext;
  assert.match(context.proposalHash,/^[a-f0-9]{64}$/);
  const followup=etsy?{kind:'followup',publicQuestion:'What owner-captured Etsy observations establish comparable exposure for the two original astronomy candidates and negative reference in one reporting window?',hypothesis:'Very low ordinal conversion may reflect insufficient exposure rather than a supported difference between the original astronomy candidates.',expectedInformationGain:'A genuine owner capture with an eligible exposure denominator could distinguish weak response from no exposure without inventing sales.',counterevidenceQuestion:'Does the negative reference show equally weak or missing exposure under the same reporting window and product category?',gap:'evidence',reason:'The saved owner captures do not establish a comparable exposure denominator; pause for genuine new owner evidence and renewed review.'}:ordinal===0?{kind:'followup',publicQuestion:'What dated GB adult evidence distinguishes interest in original astronomy-inspired T-shirt motifs from stated purchase intent?',hypothesis:'Interest in an original astronomy motif may not translate into purchase intent among GB adults.',expectedInformationGain:'A bounded survey distinction could narrow the unresolved candidate-specific demand question without claiming actual sales.',counterevidenceQuestion:'What dated GB adult evidence shows weak or contradictory stated purchase intent despite motif interest?',gap:'evidence',reason:'The imported findings remain unable to distinguish astronomy motif interest from candidate-specific GB purchase intent.'}:null;
  return{version:'r12.adaptive-review.1',proposalHash:context.proposalHash,outcome:'NEEDS_MORE_EVIDENCE',
   ratings:Object.fromEntries(['evidence','learningValue','testDesign','feasibility'].map(key=>[key,{score:0,rationale:'The bounded synthetic public context does not establish a candidate-specific measurable apparel proposal.',evidenceRefs:[]}])),
   proposalConcerns:[],executionPrerequisites:['Any later physical sample or sales test needs separate owner approval and its own lawful creative rights.'],additionalQuestions:[],
   sufficiencyRationale:etsy?'The owner-reported Etsy captures retain the Very low wording and missing buyer geography; no numeric conversion, item sales, country demand or profit can be established. A genuine new owner capture is required before another evidence action.':ordinal===0?'The saved broad context lacks GB adult purchase-intent evidence for the original astronomy design, so a scoped opposing public question can test this exact gap.':'The follow-up public context still lacks representative purchase behaviour or willingness-to-pay; close this research window and preserve the negative uncertainty.',
   recommendedNextAction:followup,progress:null};
 }
 return outputs[phase];
}
function r12AdaptiveProvider(state,input,control,effects){
 const r=state.r12,action=r.adaptiveActionContext,phase=input.phase;
 assert.ok(action&&Number.isSafeInteger(action.ordinal)&&/^[a-f0-9]{64}$/.test(action.actionHash),'An admitted adaptive action is required for inert transport');
 assert.ok((r.adaptiveScope.version==='r12.discovery-owner-adaptive.2'?['plan','strategy','review']:['plan','search1','select1','strategy','review']).includes(phase));
 const key=`${action.actionHash}:${phase}`,model=phase==='review'?'anthropic/claude-haiku-4.5':'openai/gpt-5.6-luna',id=`gen-r12-adaptive-${action.ordinal}-${phase}`;
 if(input.method==='POST'){
  assert.equal(input.url,'https://openrouter.ai/api/v1/chat/completions');assert.ok(!r.adaptiveGenerations[key],'An adaptive paid phase cannot regenerate');
  assert.equal(input.body.model,model);assert.deepEqual(input.body.provider.only,[phase==='review'?'amazon-bedrock/us':'azure/us']);
  if(r.adaptiveScope.version==='r12.discovery-owner-adaptive.2'){assert.equal(input.body.tools,undefined);assert.equal(input.body.plugins,undefined);assert.equal(phase==='search1'||phase==='select1',false);}
  if(phase==='search1')assert.deepEqual(input.body.tools[0].parameters.allowed_domains,r.adaptiveScope.allowedDomains);
  r.adaptiveCalls.push({ordinal:action.ordinal,actionHash:action.actionHash,phase});r.adaptiveGenerations[key]=id;
  effects.push({kind:'inert-r12-adaptive-provider',ordinal:action.ordinal,phase});
  const output=adaptiveProviderOutput(r,phase,input.body),message=phase==='search1'?{content:'Synthetic bounded public source context.',annotations:output.annotations}:{content:JSON.stringify(output)};
  return{status:200,body:{id,model,choices:[{finish_reason:'stop',message}],usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150,cost:.00001,...(phase==='search1'?{server_tool_use_details:{web_search_requests:1}}:{})}}};
 }
 assert.equal(input.method,'GET');assert.equal(input.url,`https://openrouter.ai/api/v1/generation?id=${r.adaptiveGenerations[key]}`);
 const pending=control.r12DelayAdaptiveReceipt===true&&action.ordinal===(r.adaptiveScope.version==='r12.discovery-owner-adaptive.2'?0:1)&&phase==='review';
 r.adaptiveReceipts.push({ordinal:action.ordinal,phase,pending});
 if(pending)return{status:404,body:{error:{message:'Synthetic saved generation receipt not yet indexed'}}};
 return{status:200,body:{data:{id,provider_name:phase==='review'?'Amazon Bedrock':'Azure',model}}};
}
export function r12Provider(state,input,control,effects){
 const r=state.r12;assert.ok(r);const phase=input.phase;assert.ok(['plan','search1','select1','strategy','review'].includes(phase));
 if(r.adaptiveScopeId)return r12AdaptiveProvider(state,input,control,effects);
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
