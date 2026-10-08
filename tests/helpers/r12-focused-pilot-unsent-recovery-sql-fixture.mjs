/** Inert end-to-end recovery of a transaction-proven unsent reserved successor. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {runOperatorRecipe as runRecoveryRecipe} from '../../scripts/r12-focused-pilot-unsent-recovery-bootstrap.mjs';
import {runOperatorRecipe as runSuccessorRecipe} from '../../scripts/r12-focused-pilot-successor-bootstrap.mjs';
import {reviewRecipeClient} from './r12-review-fixture.mjs';
import {exerciseFocusedPilotLifecycle} from './r12-focused-pilot-sql-fixture.mjs';
import {exerciseFocusedPilotSuccessorLifecycle} from './r12-focused-pilot-successor-sql-fixture.mjs';
const digest=text=>createHash('sha256').update(text).digest('hex');
export async function createClosedUnsentSuccessor(db,closedFocused,{nested=false,guards=true,...options}={}){
 return exerciseFocusedPilotSuccessorLifecycle(db,closedFocused,{nested,actualOwnerPreparation:true,...options,onReservedDispatch:async ctx=>{
  const {metadata,command,payload,epoch,plan,scopeId,planId,ownerApi}=ctx,one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
  const baseline=await command('read',{}),attempt=baseline.attempts[0];assert.equal(attempt.status,'reserved');assert.equal(baseline.head.dispatches,0);assert.equal(baseline.head.childrenCreated,1);
  const financial=async()=>one(`select (select count(*)::int from private.r05_markers where request_id=$1) admission_markers,(select count(*)::int from private.r07_markers where attempt_id=$2) controller_markers,(select count(*)::int from private.r12_discovery_transport_claims where request_id=$1) transport_claims,(select count(*)::int from private.r12_discovery_candidates where request_id=$1) candidates,(select count(*)::int from private.r05_settlements where request_id=$1) settlements,private.stage13v2_budget_authority($3,false) budget`,[attempt.requestId,attempt.id,metadata.focusedProfile.budgetAuthorityRootId]);
  const before=await financial();assert.deepEqual([before.admission_markers,before.controller_markers,before.transport_claims,before.candidates,before.settlements],[0,0,0,0,0]);
  // Actual SQL dispatch is not delivered to transport until its transaction has
  // committed. A deadline-like SQLSTATE after marking must roll the whole cut back.
  await db.exec('savepoint unsent_dispatch_deadline');
  try{assert.equal((await command('dispatch',payload,epoch)).shouldDispatch,true);await assert.rejects(db.exec("do $$ begin raise exception 'Synthetic dispatch deadline before commit' using errcode='57014'; end $$"),error=>error.code==='57014');}
  finally{await db.exec('rollback to savepoint unsent_dispatch_deadline');await db.exec('release savepoint unsent_dispatch_deadline');}
  assert.deepEqual(await command('read',{}),baseline,'Cancelled dispatch transaction leaves the original reservation unchanged');assert.deepEqual(await financial(),before);
  await ownerApi.server.stopDiscoveryR12(ownerApi.context,metadata.businessId,scopeId);
  await runSuccessorRecipe(reviewRecipeClient(db,nested),'close',{businessId:metadata.businessId,scopeId,scopeHash:metadata.staged.scopeHash,policyId:plan.policyId,policyHash:plan.policyHash,planHash:ctx.activated.planHash,successorAuthorizationHash:metadata.authorizationHash});
  // Match the already closed historical source exactly: append the reviewed
  // release and financial decision after both keys are revoked; preserve its
  // reserved/admitted attempt and head rather than rewriting history.
  await db.query('select private.r12_pilot_unsent_request($1,$2)',[scopeId,attempt.id]);
  await db.query('insert into private.r05_releases(request_id,business_id,evidence_hash) values($1,$2,$3)',[attempt.requestId,metadata.businessId,digest(`inert SQLSTATE 57014 before committed dispatch ${attempt.id}`)]);
  await db.query("select private.r05_result($1,$2,'allowed','released_unsent')",[metadata.businessId,attempt.requestId]);
  const unsentClosure=(await one('select private.r12_pilot_unsent_closure($1) result',[scopeId])).result;
  assert.equal(unsentClosure.authorityClosed,true);assert.equal(unsentClosure.dispatches,0);assert.equal(unsentClosure.childrenCreated,1);assert.equal(unsentClosure.knownMicrousd,'0');assert.equal(unsentClosure.heldMicrousd,'0');assert.equal(unsentClosure.planId,planId);assert.equal(unsentClosure.planHash,ctx.activated.planHash);assert.equal(unsentClosure.policyId,plan.policyId);assert.equal(unsentClosure.successorAuthorizationHash,metadata.authorizationHash);assert.equal(unsentClosure.requestId,attempt.requestId);
  const after=await financial();assert.deepEqual([after.admission_markers,after.controller_markers,after.transport_claims,after.candidates,after.settlements],[0,0,0,0,0]);assert.equal(after.budget.pendingExposureMicrousd,0);assert.equal(after.budget.hasUncertainCosts,false);assert.equal(after.budget.knownActualMicrousd,before.budget.knownActualMicrousd);assert.equal(after.budget.maximumMicrousd,2000000);
  const view=(await one('select public.r12_discovery_owner_read($1,$2,false) result',[metadata.businessId,scopeId])).result;assert.deepEqual(view.focusedUnsentClosure,unsentClosure);assert.equal(view.phases[0].status,'reserved');assert.equal(view.phases[1].status,'not_started');
  if(guards)await assertUnsentClosureGuards(db,{scopeId,unsentClosure});
  return{metadata,closedBroad:ctx.closedBroad,closedFocused,scopeId,planId,closedPlanId:planId,unsentClosure,inertPosts:0,inertReceiptGets:0,providerCalls:0,activeAuthority:false};
 }});
}
export async function exerciseFocusedPilotUnsentRecoveryLifecycle(db,closedUnsent,{nested=false,...options}={}){
 const result=await exerciseFocusedPilotLifecycle(db,closedUnsent.closedBroad,{nested,successor:closedUnsent.closedFocused,recovery:closedUnsent,actualOwnerPreparation:true,...options});
 if(!options.stageOnly&&!options.stopBeforeActivation&&result?.metadata){
  assert.equal(result.inertPosts,options.strategyOutcome&&options.strategyOutcome!=='TEST'?1:2);assert.ok(result.inertReceiptGets<=6);
  const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
  assert.deepEqual((await one('select private.r12_pilot_unsent_closure($1) result',[closedUnsent.scopeId])).result,closedUnsent.unsentClosure);
  assert.deepEqual((await one('select private.r12_pilot_successor_closure($1) result',[closedUnsent.closedFocused.scopeId])).result,closedUnsent.closedFocused.closure);
  const sid=result.metadata.scopeId,count=await one(`select (select count(*)::int from private.r07_attempts where plan_id=$1) attempts,(select count(*)::int from private.r05_markers where request_id in(select request_id from private.r12_discovery_wires where scope_id=$2)) markers,(select count(*)::int from public.creative_runs) creatives`,[result.planId,sid]);
  assert.equal(count.attempts,result.inertPosts);assert.equal(count.markers,result.inertPosts);assert.equal(count.creatives,0);
  await db.exec('savepoint recovery_recursive');
  try{await assert.rejects(db.query('select private.r12_pilot_unsent_closure($1)',[sid]),/r12_recovery_|no rows/);}
  finally{await db.exec('rollback to savepoint recovery_recursive');await db.exec('release savepoint recovery_recursive');}
  await db.exec('savepoint recovery_root_duplicate');
  try{await assert.rejects(db.query(`insert into private.r12_pilot_unsent_recovery_authorizations(scope_id,business_id,abandoned_scope_id,budget_authority_root_id,authorization_data,authorization_hash) select extensions.gen_random_uuid(),business_id,extensions.gen_random_uuid(),budget_authority_root_id,authorization_data,authorization_hash from private.r12_pilot_unsent_recovery_authorizations where scope_id=$1`,[sid]),error=>error.code==='23505'&&/budget_authority_root/.test(error.constraint??''));}
  finally{await db.exec('rollback to savepoint recovery_root_duplicate');await db.exec('release savepoint recovery_root_duplicate');}
 }
 return result;
}

export async function exerciseUnsentRecoveryCloseout(db,closedUnsent,{nested=false}={}){
 return exerciseFocusedPilotUnsentRecoveryLifecycle(db,closedUnsent,{nested,onReservedDispatch:async ctx=>{
  const {metadata,planId,scopeId}=ctx;await ctx.closeRun();
  const view=(await db.query('select public.r12_discovery_owner_read($1,$2,false) result',[metadata.businessId,scopeId])).rows[0].result;
  assert.equal(view.phases[0].status,'reserved');assert.equal(view.phases[0].knownMicrousd,null);assert.equal(view.cost.knownMicrousd,'0');assert.equal(view.cost.heldMicrousd,'0');assert.equal(view.cost.hasUnknown,false);assert.equal(view.activeWindow,false);
  const count=(await db.query('select (select count(*)::int from private.r05_releases where request_id in(select request_id from private.r12_discovery_wires where scope_id=$1)) releases,(select count(*)::int from private.r05_markers where request_id in(select request_id from private.r12_discovery_wires where scope_id=$1)) markers',[scopeId])).rows[0];assert.deepEqual(count,{releases:1,markers:0});
  // Exact repeated close is safe; no second release, decision or provider work.
  await ctx.closeRun();assert.equal((await db.query("select count(*)::int n from private.r05_decisions where request_id in(select request_id from private.r12_discovery_wires where scope_id=$1) and reason='released_unsent'",[scopeId])).rows[0].n,1);
  return{scopeId,planId,inertPosts:0,inertReceiptGets:0,providerCalls:0,activeAuthority:false,releasedUnsent:true};
 }});
}


export async function exerciseUnsentRecoveryBlockedCloseout(db,closedUnsent,{nested=false,cleanupTimeout=false}={}){
 return exerciseFocusedPilotUnsentRecoveryLifecycle(db,closedUnsent,{nested,onReservedDispatch:async ctx=>{
  const {metadata,plan,scopeId,ownerApi}=ctx,one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
  const attempt=(await ctx.command('read',{})).attempts[0];
  // Synthetic evidence represents an ambiguous send. Cleanup must retain the
  // liability and still commit every revocation, never erase or retry it.
  if(cleanupTimeout)await db.exec("create or replace function private.r12_pilot_unsent_recovery_release(p_business_id uuid,p_scope_id uuid) returns jsonb language plpgsql set search_path='' as $$ begin raise exception 'Synthetic cleanup statement deadline' using errcode='57014'; end $$");
  else await db.query('insert into private.r05_markers(request_id,business_id) values($1,$2)',[attempt.requestId,metadata.businessId]);
  await ownerApi.server.stopDiscoveryR12(ownerApi.context,metadata.businessId,scopeId);
  const closed=await runRecoveryRecipe(reviewRecipeClient(db,nested),'close',{businessId:metadata.businessId,scopeId,scopeHash:metadata.staged.scopeHash,policyId:plan.policyId,policyHash:plan.policyHash,planHash:ctx.activated.planHash,recoveryAuthorizationHash:metadata.authorizationHash});
  if(cleanupTimeout)assert.equal(closed.cleanupErrorCode,'57014');assert.equal(closed.cleanupVerified,false);assert.equal(closed.cleanupBlocked,true);assert.equal(closed.liabilityReadbackRequired,true);assert.equal(closed.activeAuthority,false);
  assert.deepEqual(await one('select exists(select 1 from private.r07_server_revocations where key_hash=$1) controller,exists(select 1 from private.r05_server_revocations where key_hash=$2) admission,exists(select 1 from private.r05_revocations where policy_id=$3) policy',[digest(ctx.controller),digest(ctx.admission),plan.policyId]),{controller:true,admission:true,policy:true});
  assert.equal((await one('select count(*)::int n from private.r05_releases where request_id=$1',[attempt.requestId])).n,0);
  assert.equal((await one('select sum(held)::text held from private.r05_exposure($1) where source_key=(select source_key from private.r05_requests where id=$2)',[metadata.businessId,attempt.requestId])).held,'66671');
  return{scopeId,inertPosts:0,inertReceiptGets:0,providerCalls:0,activeAuthority:false,cleanupBlocked:true};
 }});
}

async function assertUnsentClosureGuards(db,closed){
 const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
 const helpers=(await db.query("select p.oid,p.proname,p.provolatile,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and (p.proname like 'r12_pilot_unsent_%' or p.proname in('r12_pilot_research_authorization','r12_pilot_research_authorizations')) order by p.proname")).rows;assert.ok(helpers.length>=10);
 for(const fn of helpers){assert.equal(fn.prosecdef,false,fn.proname);assert.deepEqual(fn.proconfig,['search_path=""'],fn.proname);assert.equal(fn.provolatile,fn.proname==='r12_pilot_unsent_recovery_release'?'v':'s',fn.proname);for(const role of ['anon','authenticated','service_role'])assert.equal((await one("select has_function_privilege($1,$2::oid,'EXECUTE') allowed",[role,fn.oid])).allowed,false,role+' '+fn.proname);}
 assert.equal((await one("select relrowsecurity from pg_class where oid='private.r12_pilot_unsent_recovery_authorizations'::regclass")).relrowsecurity,true);
 for(const role of ['anon','authenticated','service_role'])assert.deepEqual(await one("select has_table_privilege($1,'private.r12_pilot_unsent_recovery_authorizations','SELECT') readable,has_table_privilege($1,'private.r12_pilot_unsent_recovery_authorizations','INSERT') writable,has_function_privilege($1,'private.r12_pilot_unsent_closure(uuid)','EXECUTE') executable",[role]),{readable:false,writable:false,executable:false});
 for(const [table,key,value]of [['r07_server_revocations','key_hash',closed.unsentClosure.controllerKeyHash],['r05_server_revocations','key_hash',closed.unsentClosure.admissionKeyHash],['r05_revocations','policy_id',closed.unsentClosure.policyId],['r05_releases','request_id',closed.unsentClosure.requestId]]){
  await db.exec('savepoint unsent_missing_proof');
  try{await db.exec(`alter table private.${table} disable trigger all`);await db.query(`delete from private.${table} where ${key}=$1`,[value]);await assert.rejects(db.query('select private.r12_pilot_unsent_closure($1)',[closed.scopeId]),/r12_recovery_|no rows/);}
  finally{await db.exec('rollback to savepoint unsent_missing_proof');await db.exec('release savepoint unsent_missing_proof');}
 }
 for(const statement of [
  'insert into private.r05_markers(request_id,business_id) values($1,$2)',
  'insert into private.r12_discovery_transport_claims(request_id) values($1)',
 ]){await db.exec('savepoint unsent_effect_evidence');try{const params=[closed.unsentClosure.requestId,...(statement.includes('$2')?[closed.unsentClosure.businessId]:[])];await db.exec(`alter table private.${statement.match(/insert into private\.([a-z0-9_]+)/)[1]} disable trigger all`);await db.query(statement,params);await assert.rejects(db.query('select private.r12_pilot_unsent_closure($1)',[closed.scopeId]),/r12_recovery_effect_evidence_present/);}finally{await db.exec('rollback to savepoint unsent_effect_evidence');await db.exec('release savepoint unsent_effect_evidence');}}
 assert.deepEqual((await one('select private.r12_pilot_unsent_closure($1) result',[closed.scopeId])).result,closed.unsentClosure);
}
