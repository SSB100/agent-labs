/** Isolated fixture only: no live database, provider or enrollment access. */
import assert from 'node:assert/strict';
import {exerciseFocusedPilotLifecycle} from './r12-focused-pilot-sql-fixture.mjs';
export async function createClosedFocusedPredecessor(db,closedBroad,{nested=false,...options}={}){
 const result=await exerciseFocusedPilotLifecycle(db,closedBroad,{nested,reviewFailure:true,...options});
 await assertClosedFocusedSuccessorGuards(db,result);
 assert.equal(result.inertPosts,2);assert.equal(result.activeAuthority,false);assert.equal(result.closure.authorityClosed,true);
 return {...result,closedPlanId:result.planId};
}
export async function exerciseFocusedPilotSuccessorLifecycle(db,closedFocused,{nested=false,ownerPreparationReceipt=null,stageOnly=false,strategyOutcome='TEST',...options}={}){
 return exerciseFocusedPilotLifecycle(db,closedFocused.closedBroad,{nested,ownerPreparationReceipt,stageOnly,successor:closedFocused,strategyOutcome,...options});
}

async function assertClosedFocusedSuccessorGuards(db,closed){
 const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
 for(const role of ['anon','authenticated','service_role']){
  const acl=await one("select has_table_privilege($1,'private.r12_pilot_successor_authorizations','SELECT') readable,has_table_privilege($1,'private.r12_pilot_successor_authorizations','INSERT') writable,has_function_privilege($1,'private.r12_pilot_successor_closure(uuid)','EXECUTE') executable",[role]);
  assert.deepEqual(acl,{readable:false,writable:false,executable:false});
 }
 const cases=[
  ['r07_server_revocations','key_hash',closed.closure.controllerKeyHash,/predecessor_not_closed/],
  ['r05_server_revocations','key_hash',closed.closure.admissionKeyHash,/predecessor_not_closed/],
  ['r05_revocations','policy_id',closed.closure.policyId,/predecessor_not_closed/],
  ['r05_settlements','request_id',closed.closure.phases[1].requestId,/settlement_required/],
  ['r12_discovery_receipt_observations','check_id',(await one('select id from private.r12_discovery_receipt_checks where request_id=$1 order by attempt desc limit 1',[closed.closure.phases[1].requestId])).id,/receipt_required/],
  ['r12_discovery_response_observations','request_id',closed.closure.phases[1].requestId,/prior_rejected_review_required/],
 ];
 for(const [table,key,value,pattern] of cases){
  await db.exec('savepoint successor_missing_proof');
  try{
   // Disposable synthetic-only fixture; no production recipe permits history mutation.
   await db.exec(`alter table private.${table} disable trigger all`);
   await db.query(`delete from private.${table} where ${key}=$1`,[value]);
   await assert.rejects(db.query('select private.r12_pilot_successor_closure($1)',[closed.scopeId]),pattern);
  }finally{await db.exec('rollback to savepoint successor_missing_proof');await db.exec('release savepoint successor_missing_proof');}
 }
 assert.deepEqual((await one('select private.r12_pilot_successor_closure($1) closure',[closed.scopeId])).closure,closed.closure);
}
