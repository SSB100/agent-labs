/** Exercise the actual Next fixture controls/parser against the same isolated SQL lineage. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {controlR12,r12OwnerRpc,R12_RUNTIME_RPC_ARGUMENTS} from '../next-fixture/r12-sql.mjs';
import {pilotOwnerSqlApi} from './r12-pilot-owner-sql-fixture.mjs';
import {parseR12ReviewOwnerWorkspace} from '../../.core-tests/products/discovery-r12-review-preparation-contract.js';
export async function exerciseR12NextRefreshedPreparation(db,closedUnsent){
 const original=closedUnsent.metadata,ownerId=original.ownerId,businessId=original.businessId,transactions=[];let serial=0;
 const sql=async(statement,params)=>{
  const operation=statement.trim().toLowerCase();
  if(operation==='begin'){const name='r12_next_control_'+serial++;transactions.push(name);return db.exec('savepoint '+name);}
  if(operation==='commit'||operation==='rollback'){const name=transactions.pop();assert.ok(name,'Only nested fixture transactions may finish');if(operation==='rollback')await db.exec('rollback to savepoint '+name);
   // Match the existing nested recipe adapter: releasing a savepoint cannot
   // execute these synthetic operator tables' normal ON COMMIT DROP cleanup.
   else await db.exec('drop table if exists pg_temp.r12_bootstrap_input,pg_temp.r12_bootstrap_result');
   return db.exec('release savepoint '+name);}
  return params?db.query(statement,params):db.exec(statement);
 };
 const adapter={query:sql,exec:sql},state={db:{},owner:ownerId,r12:{...original,db:adapter,closedUnsent,closedFocused:closedUnsent.closedFocused,scenario:'focused-successor-preparation',sourceScopeId:closedUnsent.scopeId,preparationId:randomUUID(),setupUntil:new Date(Math.floor((Date.now()+10800000)/1000)*1000).toISOString(),refreshEvidence:true,calls:[],receipts:[],quoteReads:0}};
 const fingerprint=async()=>(await db.query(`select (select count(*)::int from private.r12_pilot_unsent_recovery_authorizations) recoveries,(select count(*)::int from private.r12_discovery_scopes) scopes,(select count(*)::int from private.r05_markers) admission_markers,(select count(*)::int from private.r07_markers) controller_markers,(select count(*)::int from private.r12_discovery_transport_claims) claims,(select amendment_hash from private.r12_discovery_scopes where id=$1) abandoned_hash`,[closedUnsent.scopeId])).rows[0];
 const before=await fingerprint();await db.exec('savepoint r12_next_refreshed');
 try{
  const owner=pilotOwnerSqlApi(adapter,businessId,ownerId),r=state.r12;
  const prepared=await owner.preparation.prepareR12PilotGoal(owner.context,{businessId,sourceScopeId:r.sourceScopeId,preparationId:r.preparationId,setupUntil:r.setupUntil});assert.equal(prepared.authorityCreated,false);
  const staged=await controlR12(state,{r12FocusedSuccessorStage:prepared});assert.ok(staged.handled.includes('r12FocusedSuccessorStage'));
  const raw=await r12OwnerRpc(state,'r12_review_owner_read',{p_business_id:businessId,p_scope_id:r.scopeId});assert.equal(raw.error,null);
  const parsed=parseR12ReviewOwnerWorkspace(raw.data,businessId,r.scopeId,ownerId);assert.equal(parsed.successor.authorization.evidenceRefresh.version,'r12.focused-pilot-evidence-refresh.1');
  assert.equal(parsed.successor.authorizationHash,r.authorizationHash);
  for(const [index,old]of closedUnsent.metadata.focusedProfile.observations.observations.entries()){const fresh=parsed.scope.profile.observations.observations[index];assert.notEqual(fresh.contentHash,old.contentHash);assert.equal(fresh.access,'public_document_read');assert.equal(Array.from(fresh.context).slice(fresh.start,fresh.end).join(''),Array.from(old.context).slice(old.start,old.end).join(''));}
  const confirmed=await owner.confirmation.confirmR12ReviewPreparation(owner.context,businessId,r.scopeId,r.staged.proposalHash);assert.equal(confirmed.executionAuthorized,false);
  const activated=await controlR12(state,{r12FocusedSuccessorActivate:confirmed});assert.ok(activated.handled.includes('r12FocusedSuccessorActivate'));assert.equal(activated.activated,true);
  const view=await r12OwnerRpc(state,'r12_discovery_owner_read',{p_business_id:businessId,p_scope_id:r.scopeId,p_activation:true});assert.equal(view.error,null);assert.equal(view.data.focusedSuccessor.authorizationHash,r.authorizationHash);assert.equal(view.data.activation.scope.id,r.scopeId);
  assert.deepEqual(R12_RUNTIME_RPC_ARGUMENTS.r12_recovery_dispatch,['p_business_id','p_goal_id','p_scope_id','p_payload','p_submission_id','p_server_key','p_lease_token','p_epoch','p_admission_key']);
  assert.deepEqual(await owner.server.stopDiscoveryR12(owner.context,businessId,r.scopeId),{stopped:true});
  const closed=await controlR12(state,{r12FocusedSuccessorClose:{businessId,scopeId:r.scopeId,scopeHash:r.staged.scopeHash,policyId:confirmed.policyId,policyHash:confirmed.policyHash,planHash:r.activated.planHash,recoveryAuthorizationHash:r.authorizationHash}});assert.ok(closed.handled.includes('r12FocusedSuccessorClose'));assert.equal(r.successorClosed.activeAuthority,false);assert.deepEqual(r.calls,[]);assert.deepEqual(r.receipts,[]);assert.deepEqual(transactions,[]);
  console.log('R12 actual Next fixture refreshed preparation, certificate projection/parser, confirmation, activation and Stop passed without provider calls.');
  return{providerCalls:0,passed:true};
 }finally{await db.exec('rollback to savepoint r12_next_refreshed');await db.exec('release savepoint r12_next_refreshed');assert.deepEqual(await fingerprint(),before);}
}
