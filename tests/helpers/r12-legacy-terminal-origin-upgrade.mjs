/** Genuine old-schema runtime history; every provider transport is inert. */
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {exerciseHistoricalOwnerEpisodeSql,episodeInput,runOwnerEpisodePhases} from './r12-owner-episode-sql-fixture.mjs';
import {appendOwnerGrantRootRevision,enrollOwnerExtensionGrant} from './r12-owner-grant-extension-sql-fixture.mjs';
import {one,ownerInitialRuntimeRpc} from './r12-owner-initial-sql-fixture.mjs';
import {r12QuoteFixture} from './r12-provider-fixture.mjs';
import {discoveryV2Hash as hash} from '../../.core-tests/products/discovery-v2.js';
import {validatePublicResearchOriginHistory,validatePublicResearchPredecessor} from '../../.core-tests/products/discovery-r12-public-origin.js';
export const legacyOriginBase='20261009185440_r12_owner_grant_root_extensions.sql';
const stoppedMigration='20261010100100_r12_owner_stopped_before_reservation.sql';
async function nestedMigration(db,file){
 const original=readFileSync('supabase/migrations/'+file,'utf8');
 // The enclosing authentic replay owns its transaction and savepoints. Remove
 // only standalone outer transaction statements, never a function/DO body.
 const sql=original.replace(/^begin;[ \t]*\r?\n/im,'').replace(/^commit;[ \t]*\r?\n?$/im,'');
 assert.equal((original.match(/^begin;[ \t]*$/gim)||[]).length,1,file);
 assert.equal((original.match(/^commit;[ \t]*$/gim)||[]).length,1,file);
 try{await db.exec(sql);}catch(error){error.message=file+': '+error.message+' '+JSON.stringify({where:error.where,internalQuery:error.internalQuery});throw error;}
}
async function mutation(db,operation,check){
 await db.exec('savepoint legacy_origin_negative');
 try{await operation();await check();}finally{await db.exec('rollback to savepoint legacy_origin_negative');await db.exec('release savepoint legacy_origin_negative');}
}
export async function exerciseLegacyTerminalOriginUpgrade(db,evidence){
 return exerciseHistoricalOwnerEpisodeSql(db,evidence,{beforePlannerPreflight:true,onReady:async({f,amount,scope})=>{
  const {businessId:b,goalId:g}=f;const legacyRoot=scope.budget_authority_root_id,legacyPrior=scope.prior_round_id;
  const prepare=async actor=>actor.server('prepare_episode',{input:await episodeInput(db,actor),quote:r12QuoteFixture()});
  const stop=async(actor,p)=>actor.server('stop',{setupId:p.setupId,setupHash:p.setupHash,submissionId:randomUUID()},'');
  const p5=await prepare(f);await f.server('confirm_episode',f.confirmPayload(p5));
  const rejected=await runOwnerEpisodePhases(db,f,p5,{reviewFailureCase:'response_schema'});await stop(f,p5);
  const revision=await appendOwnerGrantRootRevision(db,f.rootId,{maximumScopes:3,maximumAllocationMicrounits:String(3*amount),expiresAt:f.profile.validUntil});
  const extended=await enrollOwnerExtensionGrant(db,f,revision,{maximumEpisodes:3});
  // The old confirmed setup uses its real old contract, not future preflight.
  extended.server=(op,payload,key=extended.bootstrapKey)=>f.rpc('r12_owner_research_server',[b,op,payload,key]);
  const p6=await prepare(extended);await extended.server('confirm_episode',extended.confirmPayload(p6));
  const controller='inert-controller-'+p6.scopeId,admission='inert-admission-'+p6.scopeId,lease='inert-legacy-origin-zero-call-lease';
  const cmd=(op,payload,epoch=null)=>ownerInitialRuntimeRpc(db,'r07_controller',[b,g,op,payload,randomUUID(),controller,lease,epoch,admission]);
  const claim=await cmd('claim',{seconds:120});const stoppedAttempt=randomUUID();
  await cmd('schedule',{stepKey:'plan',attemptId:stoppedAttempt,runtimeCapability:'inert-legacy-origin-runtime-capability',reason:'Inert planner stopped before reservation',evidenceHash:'8'.repeat(64)},claim.epoch);
  await stop(extended,p6);
  // This released additive owner helper has no adaptive-column dependency.
  // Production's saved old13 closures likewise include the unsent proof.
  await nestedMigration(db,stoppedMigration);
  const p7=await prepare(extended);await extended.server('confirm_episode',extended.confirmPayload(p7));
  await runOwnerEpisodePhases(db,extended,p7);await stop(extended,p7);
  // Finish genuine old-schema deferred checks before applying newer definitions.
  await db.exec('set constraints all immediate');
  assert.deepEqual(await one(db,'select dispatches,children_created,repairs_used from private.r07_heads where goal_id=$1',[g]),{dispatches:17,children_created:19,repairs_used:0});
  assert.equal((await one(db,"select count(*)::int n from information_schema.columns where table_schema='private' and table_name='r07_attempts'",[])).n,13);
  const oldAttempts=(await one(db,'select jsonb_agg(to_jsonb(a) order by id) value from private.r07_attempts a where goal_id=$1',[g])).value;
  const oldClosures=(await one(db,'select jsonb_agg(to_jsonb(c) order by predecessor_plan_id) value from private.r12_owner_episode_closures c where goal_id=$1',[g])).value;
  const migration=readdirSync('supabase/migrations').find(x=>x.endsWith('_r12_legacy_terminal_origin.sql'));
  assert.ok(migration,'CLI-generated legacy-origin migration required');
  for(const file of readdirSync('supabase/migrations').filter(x=>x.endsWith('.sql')&&x>legacyOriginBase&&x!==stoppedMigration&&x!==migration).sort())await nestedMigration(db,file);
  const projectionRows=async()=>(await one(db,"select jsonb_agg(to_jsonb(h) order by setup_id) value from private.r12_historical_setup_projections h where business_id=$1 and goal_id=$2",[b,g])).value;
  const projections=await projectionRows();assert.equal(projections.length,3);assert.ok(projections.every(x=>x.disposition==='non_reconstructible'&&x.attempt_shape===null));
  assert.deepEqual((await one(db,"select jsonb_agg(to_jsonb(a)-array['adaptive_action_ordinal','adaptive_action_hash','direct_cycle_ordinal'] order by id) value from private.r07_attempts a where goal_id=$1",[g])).value,oldAttempts);
  assert.deepEqual((await one(db,'select jsonb_agg(to_jsonb(c) order by predecessor_plan_id) value from private.r12_owner_episode_closures c where goal_id=$1',[g])).value,oldClosures);
  const build=async()=>(await one(db,'select private.r12_direct_origin_build($1,$2) packet',[b,g])).packet;
  await mutation(db,async()=>{},async()=>assert.rejects(build(),/qualified_financial_disposition_required/));
  const raw=async()=>(await one(db,'select private.r12_direct_origin_snapshot($1,$2,7) value',[b,g])).value;
  const original=await raw();
  const counts=async()=>one(db,`select (select count(*)::int from private.r05_requests where business_id=$1) requests,
   (select count(*)::int from private.r05_markers where business_id=$1) markers,
   (select count(*)::int from private.r12_discovery_authorities where business_id=$1) authorities,
   (select count(*)::int from private.r12_discovery_scopes where business_id=$1) scopes,
   (select count(*)::int from private.r05_settlements where business_id=$1) settlements`,[b]);
  const before=await counts();
  const runtimeDefinitions=async()=>one(db,"select pg_get_functiondef('private.r12_adaptive_input_dependency(uuid)'::regprocedure) dependency,pg_get_functiondef('private.r12_adaptive_evidence_archive(uuid)'::regprocedure) archive");
  const runtimeBefore=await runtimeDefinitions();
  const originalIntent=await one(db,'select variables from public.product_experiments where id=$1',[legacyPrior]);
  await nestedMigration(db,migration);
  assert.deepEqual(await runtimeDefinitions(),runtimeBefore,'Shared adaptive runtime definitions are byte-identical');
  const packet=await build();validatePublicResearchPredecessor(packet.predecessor);validatePublicResearchOriginHistory(packet.originHistory);
  assert.equal(packet.originHistory.financialProofs.length,17);assert.equal(packet.originHistory.financialProofs.filter(x=>x.disposition==='qualified_terminal_failure').length,2);
  assert.equal(packet.originHistory.receipts.length,5);assert.equal(packet.predecessor.closure.baseDispatches,17);assert.equal(packet.predecessor.closure.baseChildren,19);
  assert.equal(packet.predecessor.closure.baseKnownMicrounits,'170');
  assert.deepEqual(await build(),packet);assert.deepEqual(await raw(),original);assert.deepEqual(await counts(),before);assert.deepEqual(await projectionRows(),projections);
  const sourceScope=await one(db,"select s.id from private.r12_discovery_scopes s join private.r07_plans p on p.content->>'discoveryScopeId'=s.id::text where p.goal_id=$1 and p.version=1",[g]);
  const resolved=(await db.query(`select p.version,s.budget_authority_root_id,s.prior_round_id,a.id,
   private.r12_direct_origin_dependency(a.id)->'origin'->>'intentId' intent_id
   from private.r07_attempts a join private.r07_plans p on p.id=a.plan_id
   join private.r12_discovery_scopes s on p.content->>'discoveryScopeId'=s.id::text
   where a.goal_id=$1 and a.status='completed' order by p.version,a.step_key`,[g])).rows;
  assert.ok(resolved.length>0);for(const x of resolved){assert.equal(x.budget_authority_root_id,legacyRoot);assert.equal(x.prior_round_id,legacyPrior);if(x.version<=4)assert.equal(x.intent_id,sourceScope.id);}
  assert.deepEqual(await one(db,'select variables from public.product_experiments where id=$1',[legacyPrior]),originalIntent);
  const oldAccepted=resolved.find(x=>x.version===1);
  await mutation(db,async()=>{},async()=>assert.rejects(one(db,'select private.r12_adaptive_input_dependency($1) value',[oldAccepted.id]),/dependency_intent_required/));
  const archival=()=>one(db,'select private.r12_direct_origin_dependency($1) value',[oldAccepted.id]);
  for(const key of ['semanticGoalHash','budgetAuthorityRootId'])await mutation(db,async()=>{
   await db.exec('alter table public.product_experiments disable trigger user');
   await db.query('update public.product_experiments set variables=jsonb_set(variables,array[$2],to_jsonb($3::text)) where id=$1',[legacyPrior,key,key==='semanticGoalHash'?'0'.repeat(64):randomUUID()]);
  },async()=>assert.rejects(archival(),/legacy_intent_original/));
  await mutation(db,async()=>{
   await db.exec('alter table public.product_experiments disable trigger user');
   await db.query("update public.product_experiments set variables=jsonb_set(variables,'{intent,id}',to_jsonb($2::text)) where id=$1",[legacyPrior,randomUUID()]);
  },async()=>assert.rejects(archival(),/legacy_intent_original/));
  for(const key of ['originalIntentHash','originalSemanticGoalHash','priorRoundId','budgetAuthorityRootId','version'])await mutation(db,async()=>{
   await db.exec('alter table private.r12_discovery_scopes disable trigger user');
   await db.query('update private.r12_discovery_scopes set amendment=jsonb_set(amendment,array[$2],to_jsonb($3::text)),amendment_hash=private.stage14_hash(jsonb_set(amendment,array[$2],to_jsonb($3::text))) where id=$1',[sourceScope.id,key,key.endsWith('Hash')?'0'.repeat(64):key==='version'?'r12.discovery-source-scope.future':randomUUID()]);
  },async()=>assert.rejects(archival(),/legacy_intent_|r12_completed_/));
  for(const version of [5,6]){
   const anchored=(await one(db,'select private.r12_direct_origin_pre_adaptive_history(p) value from private.r07_plans p where goal_id=$1 and version=$2',[g,version])).value;
   assert.equal(anchored.version,'r12.direct-origin-pre-adaptive-history.1');assert.equal(anchored.attemptShape,'r07.attempt.pre-adaptive.1');
  }
  const targets=(await db.query(`select a.id attempt_id,r.id request_id,p.version from private.r07_attempts a join private.r07_plans p on p.id=a.plan_id join private.r05_requests r on r.workflow_run_id=a.id where a.goal_id=$1 and p.version in(2,5) and a.step_key='review' order by p.version`,[g])).rows;
  assert.equal(targets.length,2);const target=targets[1];assert.equal(target.request_id,rejected.failed.request_id);
  const qualify=async t=>one(db,'select private.r12_direct_origin_legacy_terminal($1,$2) value',[t.attempt_id,t.request_id]);
  for(const t of targets)assert.match((await qualify(t)).value,/^[a-f0-9]{64}$/);
  await mutation(db,async()=>{},async()=>assert.rejects(qualify({attempt_id:targets[0].attempt_id,request_id:target.request_id}),/legacy_terminal_unverified/));
  const bad=async(t,table,sql,args=[])=>mutation(db,async()=>{await db.exec('alter table private.'+table+' disable trigger user');await db.query(sql,args);},async()=>assert.rejects(qualify(t),/r12_direct_origin_|r12_review_|r12_historical_|r12_completed_|r04_invalid_fields/));
  await bad(target,'r07_attempts',"update private.r07_attempts set reason=reason||' changed' where id=$1",[target.attempt_id]);
  await bad(target,'r07_attempts',"update private.r07_attempts set status='completed' where id=$1",[target.attempt_id]);
  await bad(target,'r05_settlements',"update private.r05_settlements set actual_microunits=null where request_id=$1",[target.request_id]);
  await bad(target,'r05_settlements',"update private.r05_settlements set currency='EUR' where request_id=$1",[target.request_id]);
  await bad(target,'r05_settlements',"update private.r05_settlements set provider_request_id='gen-substituted' where request_id=$1",[target.request_id]);
  await bad(target,'r05_settlements',"update private.r05_settlements set actual_microunits=(select liability_microunits+1 from private.r05_requests where id=$1),receipt_hash=private.stage14_hash(jsonb_build_object('phase','review','providerRequestId',provider_request_id,'actualMicrounits',(select (liability_microunits+1)::text from private.r05_requests where id=$1))) where request_id=$1",[target.request_id]);
  await bad(target,'r12_discovery_wires',"update private.r12_discovery_wires set binding=jsonb_set(binding,'{requestHash}',to_jsonb(repeat('0',64))),binding_hash=private.stage14_hash(jsonb_set(binding,'{requestHash}',to_jsonb(repeat('0',64)))) where request_id=$1",[target.request_id]);
  await bad(target,'r05_receipt_claims','delete from private.r05_receipt_claims where workflow_run_id=$1',[target.attempt_id]);
  await bad(target,'r05_settlements',"update private.r05_settlements set provider_request_id=(select provider_request_id from private.r05_settlements where request_id=$1 limit 1) where id=(select id from private.r05_settlements where business_id=$2 and request_id<>$1 limit 1)",[target.request_id,b]);
  await bad(target,'r05_revocations','delete from private.r05_revocations where policy_id=(select policy_id from private.r05_requests where id=$1)',[target.request_id]);
  for(const [table,key] of [['r07_server_revocations','controller_key_hash'],['r05_server_revocations','admission_key_hash']])await bad(target,table,`delete from private.${table} where key_hash=(select q.${key} from private.r12_discovery_authorities q join private.r12_discovery_wires w on w.scope_id=q.scope_id where w.request_id=$1)`,[target.request_id]);
  await bad(target,'r12_discovery_transport_claims','delete from private.r12_discovery_transport_claims where request_id=$1',[target.request_id]);
  await bad(target,'r12_discovery_response_observations',"update private.r12_discovery_response_observations set payload=payload||'{\"observationSaved\":false}'::jsonb,payload_hash=private.stage14_hash(payload||'{\"observationSaved\":false}'::jsonb) where request_id=$1 and kind='rejected'",[target.request_id]);
  await bad(target,'r12_discovery_response_observations',"update private.r12_discovery_response_observations set payload=jsonb_set(payload,'{requestId}',to_jsonb($2::text)),payload_hash=private.stage14_hash(jsonb_set(payload,'{requestId}',to_jsonb($2::text))) where request_id=$1 and kind='rejected'",[target.request_id,randomUUID()]);
  await bad(target,'r12_discovery_response_observations',"update private.r12_discovery_response_observations set payload=payload-'recordedAt',payload_hash=private.stage14_hash(payload-'recordedAt') where request_id=$1 and kind='rejected'",[target.request_id]);
  await bad(target,'r12_discovery_response_observations',"delete from private.r12_discovery_response_observations where request_id=$1 and kind='received'",[target.request_id]);
  await bad(target,'r12_owner_episode_activations','delete from private.r12_owner_episode_activations where setup_id=$1',[p6.setupId]);
  await bad(target,'r05_settlements',"update private.r05_settlements set actual_microunits=actual_microunits+1 where id=(select min(id) from private.r05_settlements where business_id=$1)",[b]);
  await mutation(db,()=>db.exec('alter table private.r07_attempts add column future_unrecognized_field text'),async()=>assert.rejects(qualify(target),/r04_|r12_/));
  await mutation(db,async()=>{await db.exec('alter table private.r07_attempts disable trigger user;alter table private.r07_attempts drop constraint r07_attempts_attempt_check');await db.query("update private.r07_attempts set adaptive_action_ordinal=0,adaptive_action_hash=repeat('a',64) where id=$1",[oldAccepted.id]);},async()=>assert.rejects(qualify(target),/r12_direct_origin_|r12_historical_/));
  for(const column of ['adaptive_action_ordinal','adaptive_action_hash','direct_cycle_ordinal'])await mutation(db,async()=>{
   await db.exec('alter table private.r07_attempts disable trigger user;alter table private.r07_attempts drop constraint r07_attempts_attempt_check');
   await db.query(`update private.r07_attempts set ${column}=$2 where id=$1`,[oldAccepted.id,column==='adaptive_action_hash'?'a'.repeat(64):1]);
  },async()=>assert.rejects(qualify(target),/r12_direct_origin_legacy_history_shape_required|r12_historical_direct_attempt_not_legacy/));
  await bad(targets[0],'r12_discovery_scopes',"update private.r12_discovery_scopes set amendment=jsonb_set(amendment,'{reviewHistory,0,settlementHash}',to_jsonb(repeat('0',64))),amendment_hash=private.stage14_hash(jsonb_set(amendment,'{reviewHistory,0,settlementHash}',to_jsonb(repeat('0',64)))) where id=(select (p.content->>'discoveryScopeId')::uuid from private.r07_plans p where goal_id=$1 and version=3)",[g]);
  const accepted=await one(db,"select r.id request_id from private.r05_requests r join private.r07_attempts a on a.id=r.workflow_run_id where a.goal_id=$1 and a.status='completed' order by r.id limit 1",[g]);
  await mutation(db,async()=>{await db.exec('alter table private.r12_discovery_receipt_observations disable trigger user');await db.query('delete from private.r12_discovery_receipt_observations where check_id in(select id from private.r12_discovery_receipt_checks where request_id=$1)',[accepted.request_id]);},async()=>assert.rejects(build(),/qualified_financial_disposition_required/));
  for(const prepared of [p6,p7])await mutation(db,async()=>{},async()=>assert.rejects(one(db,"select private.r12_historical_setup_predecessor('owner_setup',$1,$2,(select preview->'predecessorClosure' from private.r12_owner_setups where id=$1)) value",[prepared.setupId,prepared.setupHash]),/non_reconstructible/));
  assert.deepEqual(await projectionRows(),projections);assert.deepEqual(await raw(),original);assert.deepEqual(await counts(),before);
  assert.deepEqual(await one(db,"select has_function_privilege('anon','private.r12_direct_origin_legacy_terminal(uuid,uuid)','EXECUTE') anon,has_function_privilege('authenticated','private.r12_direct_origin_pre_adaptive_history(private.r07_plans)','EXECUTE') owner,has_function_privilege('service_role','private.r12_direct_origin_legacy_terminal(uuid,uuid)','EXECUTE') service"),{anon:false,owner:false,service:false});
  for(const signature of ['private.r12_direct_origin_pre_adaptive_history(private.r07_plans)','private.r12_direct_origin_legacy_terminal(uuid,uuid)','private.r12_direct_origin_legacy_intent_v1(private.r07_attempts,private.r07_plans,private.r12_discovery_scopes,timestamptz)','private.r12_direct_origin_dependency(uuid)','private.r12_direct_origin_evidence_archive(uuid)']){
   const acl=await one(db,"select p.proconfig,has_function_privilege('anon',p.oid,'EXECUTE') anon,has_function_privilege('authenticated',p.oid,'EXECUTE') owner,has_function_privilege('service_role',p.oid,'EXECUTE') service from pg_proc p where p.oid=$1::regprocedure",[signature]);
   assert.deepEqual(acl,{proconfig:['search_path=""'],anon:false,owner:false,service:false});
  }
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[f.ownerId]);
  const frozen=(await one(db,'select private.r12_direct_origin_freeze($1,$2,$3) value',[b,g,hash(packet)])).value;
  assert.deepEqual(frozen,packet);assert.deepEqual((await one(db,'select private.r12_direct_origin_frozen_check($1,$2,$3) value',[b,g,hash(packet)])).value,packet);
  assert.deepEqual(await counts(),before);assert.deepEqual(await projectionRows(),projections);assert.deepEqual(await runtimeDefinitions(),runtimeBefore);
  return {inertDispatches:17,children:19,financialFailures:2,researchReceipts:5,historyPreserved:true};
 }});
}
