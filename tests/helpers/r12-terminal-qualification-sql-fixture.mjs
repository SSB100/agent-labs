/** Isolated synthetic ledger only. No live evidence, keys or provider requests. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {runOperatorRecipe as recoveryRecipe} from '../../scripts/r12-focused-pilot-unsent-recovery-bootstrap.mjs';
import {runOperatorRecipe as terminalRecipe} from '../../scripts/r12-terminal-technical-qualification-bootstrap.mjs';
import {reviewRecipeClient} from './r12-review-fixture.mjs';
import {exerciseFocusedPilotLifecycle} from './r12-focused-pilot-sql-fixture.mjs';
const digest=text=>createHash('sha256').update(text).digest('hex');
const one=async(db,sql,args=[])=>(await db.query(sql,args)).rows[0];
async function rejected(db,action){await db.exec('savepoint terminal_denial');try{await assert.rejects(action);}finally{await db.exec('rollback to savepoint terminal_denial');await db.exec('release savepoint terminal_denial');}}

export async function createReconciledMarkedRecovery(db,closedUnsent,{nested=false,guards=true,...options}={}){
 return exerciseFocusedPilotLifecycle(db,closedUnsent.closedBroad,{nested,successor:closedUnsent.closedFocused,recovery:closedUnsent,actualOwnerPreparation:true,qualificationGuards:false,...options,onReservedDispatch:async ctx=>{
  const {metadata,scopeId,planId,plan,ownerApi}=ctx,client=reviewRecipeClient(db,nested);
  const before=await ctx.command('read',{}),attempt=before.attempts[0];assert.equal(attempt.status,'reserved');
  assert.equal((await ctx.command('dispatch',ctx.payload,ctx.epoch)).shouldDispatch,true);
  // Stop at the precise database boundary: Core marks committed, but the final
  // transport admission is never invoked and no inert HTTP call can occur.
  assert.deepEqual(ctx.httpRuntime.counters(),{inertPosts:0,inertReceiptGets:0});
  await ownerApi.server.stopDiscoveryR12(ownerApi.context,metadata.businessId,scopeId);
  const closed=await recoveryRecipe(client,'close',{businessId:metadata.businessId,scopeId,scopeHash:metadata.staged.scopeHash,policyId:plan.policyId,policyHash:plan.policyHash,planHash:ctx.activated.planHash,recoveryAuthorizationHash:metadata.authorizationHash});
  assert.equal(closed.activeAuthority,false);assert.equal(closed.releasedRequests,0);assert.equal(closed.releasedMicrousd,'0');assert.equal(closed.rootPendingMicrousd,66671);
  const context=(await one(db,'select private.r12_pilot_marked_context($1) result',[scopeId])).result;
  const requestHash=(await one(db,"select private.stage14_hash(private.r12_pilot_marked_context($1)->'markedRequest') hash",[scopeId])).hash;
  const input={businessId:metadata.businessId,scopeId,scopeHash:metadata.staged.scopeHash,planHash:ctx.activated.planHash,requestId:attempt.requestId,recoveryAuthorizationHash:metadata.authorizationHash,markedRequestHash:requestHash,ownerApprovalEvidenceHash:digest('inert distinct reconciliation approval '+scopeId),independentReviewHash:digest('inert distinct reconciliation review '+scopeId)};
  const financial=()=>one(db,`select private.stage13v2_budget_authority($1,false) root,(select coalesce(sum(held),0)::text from private.r05_exposure($2) where currency='USD') exposure,(select count(*)::int from private.r05_releases where request_id=$3) releases,(select count(*)::int from private.r07_events where attempt_id=$4 and operation='r12.marked_pretransport_reconciled') proofs`,[metadata.focusedProfile.priorRoundId,metadata.businessId,attempt.requestId,attempt.id]);
  const baseline=await financial();
  if(guards){
   for(const change of [x=>x.markedRequestHash='0'.repeat(64),x=>x.scopeHash='0'.repeat(64),x=>x.planHash='0'.repeat(64),x=>x.requestId=scopeId,x=>x.ownerApprovalEvidenceHash=metadata.focusedEnvelope.approvalHash,x=>x.independentReviewHash=x.ownerApprovalEvidenceHash,x=>x.independentReviewHash=metadata.executionReviewHash]){
    const bad=structuredClone(input);change(bad);await rejected(db,()=>terminalRecipe(client,'reconcile',bad));assert.deepEqual(await financial(),baseline);
   }
   for(const [table,column,value]of [['r05_revocations','policy_id',plan.policyId],['r07_server_revocations','key_hash',digest(ctx.controller)],['r05_server_revocations','key_hash',digest(ctx.admission)]]){
    await db.exec('savepoint terminal_revocation');try{await db.exec(`alter table private.${table} disable trigger all`);await db.query(`delete from private.${table} where ${column}=$1`,[value]);await rejected(db,()=>terminalRecipe(client,'reconcile',input));}finally{await db.exec('rollback to savepoint terminal_revocation');await db.exec('release savepoint terminal_revocation');}
   }
   const effects=[
    ['transport claim','insert into private.r12_discovery_transport_claims(request_id) values($1)',[attempt.requestId]],
    ['candidate',"insert into private.r12_discovery_candidates(request_id,candidate,candidate_hash,receipt_expires_at) values($1,'{}',private.stage14_hash('{}'::jsonb),clock_timestamp()+interval '30 minutes')",[attempt.requestId]],
    ['received response',"insert into private.r12_discovery_response_observations(request_id,kind,payload,payload_hash) values($1,'received','{}',private.stage14_hash('{}'::jsonb))",[attempt.requestId]],
    ['settlement',"insert into private.r05_settlements(request_id,business_id,currency,actual_microunits,provider_request_id,receipt_hash) values($1,$2,'USD',1,'gen-inert-existing-effect',$3)",[attempt.requestId,metadata.businessId,digest('inert existing settlement')]],
    ['conflicting release','insert into private.r05_releases(request_id,business_id,evidence_hash) values($1,$2,$3)',[attempt.requestId,metadata.businessId,digest('inert conflicting release')]],
   ];
   for(const [name,sql,args]of effects){await db.exec('savepoint terminal_effect');try{await db.query(sql,args);await rejected(db,()=>terminalRecipe(client,'reconcile',input));}finally{await db.exec('rollback to savepoint terminal_effect');await db.exec('release savepoint terminal_effect');}assert.deepEqual(await financial(),baseline,name);}
  }
  const result=await terminalRecipe(client,'reconcile',input),markedClosure=result.closure;
  assert.equal(result.providerCalls,0);assert.equal(result.releasedMicrousd,'66671');assert.equal(markedClosure.dispatches,1);assert.equal(markedClosure.authorityClosed,true);
  assert.equal(markedClosure.attemptId,attempt.id);assert.equal(markedClosure.requestId,attempt.requestId);assert.equal(markedClosure.recoveryAuthorizationHash,metadata.authorizationHash);
  const after=await financial();assert.equal(after.root.knownActualMicrousd,baseline.root.knownActualMicrousd);assert.equal(after.root.pendingExposureMicrousd,0);assert.equal(after.root.hasUncertainCosts,false);assert.equal(Number(baseline.exposure)-Number(after.exposure),66671);assert.equal(after.releases,1);assert.equal(after.proofs,1);
  const replay=await terminalRecipe(client,'reconcile',input);assert.equal(replay.replayed,true);assert.deepEqual(replay.closure,markedClosure);assert.deepEqual(await financial(),after);
  if(guards){
   for(const [path,value]of [[['absence','transportClaims'],1],[['revocations','controller','key_hash'],'0'.repeat(64)],[['after','rootPendingMicrousd'],1],[['independentReviewHash'],metadata.focusedEnvelope.independentReviewHash],[['independentReviewHash'],metadata.executionReviewHash]]){
    await db.exec('savepoint terminal_rehashed_proof');try{
     await db.exec('alter table private.r07_events disable trigger all;alter table private.r05_releases disable trigger all');
     await db.query('update private.r07_events set payload=jsonb_set(payload,$2::text[],$3::jsonb,false) where id=$1',[markedClosure.reconciliationEventId,path,JSON.stringify(value)]);
     await db.query('update private.r05_releases set evidence_hash=(select private.stage14_hash(payload) from private.r07_events where id=$2) where request_id=$1',[attempt.requestId,markedClosure.reconciliationEventId]);
     await rejected(db,()=>db.query('select private.r12_pilot_marked_closure($1)',[scopeId]));
    }finally{await db.exec('rollback to savepoint terminal_rehashed_proof');await db.exec('release savepoint terminal_rehashed_proof');}
   }
   await rejected(db,()=>ctx.command('settle',{attemptId:attempt.id,settlement:{actualMicrounits:'0',providerRequestId:'gen-inert-forbidden-late-settlement',receiptHash:digest('inert forbidden late settlement')}},ctx.epoch));
   await rejected(db,()=>db.query("select public.r12_discovery_server($1,$2,'send',$3,$4)",[metadata.businessId,attempt.id,{wireHash:context.markedRequest.wireHash},ctx.controller]));
   assert.deepEqual(await financial(),after,'Old revoked authority cannot settle or send the reconciled attempt');
  }
  const view=(await one(db,'select public.r12_discovery_owner_read($1,$2,false) result',[metadata.businessId,scopeId])).result;
  assert.deepEqual(view.focusedPretransportClosure,markedClosure);assert.equal(view.phases[0].status,'dispatched');assert.equal(view.phases[0].knownMicrousd,null);assert.equal(view.phases[0].pretransportReconciled,true);assert.equal(view.phases[0].unknownCost,false);assert.equal(view.cost.heldMicrousd,'0');assert.equal(view.phases[1].status,'not_started');
  assert.equal((await one(db,'select count(*)::int n from private.r12_discovery_transport_claims where request_id=$1',[attempt.requestId])).n,0);
  assert.equal((await one(db,'select count(*)::int n from private.r07_markers where attempt_id=$1',[attempt.id])).n,1);
  assert.equal((await one(db,'select count(*)::int n from private.r05_markers where request_id=$1',[attempt.requestId])).n,1);
  return{metadata,closedBroad:ctx.closedBroad,closedFocused:closedUnsent.closedFocused,closedUnsent,scopeId,planId,markedClosure,reconciliationInput:input,markedRequest:context.markedRequest,inertPosts:0,inertReceiptGets:0,activeAuthority:false};
 }});
}

export async function exerciseTerminalQualificationLifecycle(db,closedMarked,{nested=false,...options}={}){
 const result=await exerciseFocusedPilotLifecycle(db,closedMarked.closedBroad,{nested,successor:closedMarked.closedFocused,terminal:closedMarked,actualOwnerPreparation:true,...options});
 if(result?.metadata){
  assert.equal(result.metadata.authorization.version,'r12.focused-pilot-terminal-qualification-authorization.1');
  assert.deepEqual((await one(db,'select private.r12_pilot_marked_closure($1) result',[closedMarked.scopeId])).result,closedMarked.markedClosure);
  const oldView=(await one(db,'select public.r12_discovery_owner_read($1,$2,false) result',[result.metadata.businessId,closedMarked.scopeId])).result;
  assert.equal(oldView.focusedPretransportClosure,undefined,'Consumed terminal entitlement cannot prepare another Goal');assert.equal(oldView.phases[0].pretransportReconciled,true,'Historical reconciliation remains visible after consuming the new slot');assert.equal(oldView.phases[0].knownMicrousd,null);
  await rejected(db,()=>db.query('select private.r12_pilot_marked_context($1)',[result.scopeId??result.metadata.scopeId]));
  const uniqueColumns=(await db.query("select array_agg(att.attname::text order by ord.n) columns from pg_constraint c cross join lateral unnest(c.conkey) with ordinality ord(num,n) join pg_attribute att on att.attrelid=c.conrelid and att.attnum=ord.num where c.conrelid='private.r12_pilot_technical_qualification_authorizations'::regclass and c.contype in('p','u') group by c.oid")).rows.map(row=>row.columns.join(','));
  for(const column of ['scope_id','budget_authority_root_id','failed_recovery_scope_id','reconciliation_event_id'])assert.ok(uniqueColumns.includes(column),'Permanent terminal uniqueness: '+column);
 }
 return result;
}
