/** Native PostgreSQL only. A positively observed waiter proves revocation
 * serializes with the actual replacement create marker/permit-consume path. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setupRecoveryDatabase,setupRecoveryFixture,publishInertRepairRelease,publishInertRepairAttestation,setupRecoveryRace} from './helpers/r12-steel-setup-recovery-fixture.mjs';
import {steelConfigRequest,admitSteelConfig} from './helpers/r12-steel-config-sql-fixture.mjs';
import {one,ownerInitialRuntimeRpc} from './helpers/r12-owner-initial-sql-fixture.mjs';
const enabled=process.env.R12_REQUIRE_POSTGRES==='1';
test('native reviewed release revocation wins before exact replacement paid create', {skip:enabled?false:'Native PostgreSQL is required; PGlite cannot qualify lock races',timeout:240000},async()=>{
 const db=await setupRecoveryDatabase(),fetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('External calls forbidden');};
 try{
  const x=await setupRecoveryFixture(db);await x.stop();const recovered=await x.recovery('record',{...x.pins,usage:x.usage});await publishInertRepairRelease(db,x);await publishInertRepairAttestation(db,x);
  const prepared=await x.replacement('prepare',{operationId:x.setup.scope.operationId,recoveryHash:recovered.recoveryHash,submissionId:randomUUID()}),p=prepared.proposal;await x.replacement('confirm',{proposalId:p.proposalId,proposalHash:p.proposalHash,submissionId:randomUUID()});
  const replacement=await x.bridge.prepare({operationId:p.replacementOperationId,accountId:p.accountId,profileAccessExpiresAt:x.setup.scope.profileAccessExpiresAt});await x.approve(replacement);await replacement.admit('create');await admitSteelConfig(db,x.f.businessId,steelConfigRequest(replacement.scope,{setup:true,configuration:x.repair.configuration}),x.bridge.keys.handoff);
  const counts=()=>one(db,'select (select count(*)::int from private.r05_reservations) reservations,(select count(*)::int from private.r05_markers) markers,(select count(*)::int from private.r12_etsy_steel_dispatches) dispatches,(select count(*)::int from private.r12_steel_create_config_uses) uses'),before=await counts();
  const race=await setupRecoveryRace(db,'release_revoke',x,{first:{revoke:true},second:{operationId:replacement.scope.operationId,request:{provider:'steel',operation:'browser.etsy.owner_handoff.create',method:'POST',endpoint:'https://api.steel.dev/v1/sessions'}}});
  assert.equal(race.observedLockWait,true);assert.match(race.second.error.message,/repair_release_inactive/);assert.deepEqual(await counts(),before);assert.equal((await one(db,'select count(*)::int n from private.r12_steel_setup_repair_debits')).n,1);
  const cleanup=await ownerInitialRuntimeRpc(db,'r12_etsy_steel_server',[x.f.businessId,'transport',{operationId:x.setup.scope.operationId,request:{provider:'steel',operation:'browser.etsy.session.release_readback',method:'GET',endpoint:'https://api.steel.dev/v1/sessions/'+x.setup.scope.operationId}},x.bridge.keys.cleanup]);assert.equal(cleanup.allowed,true);
  console.log('Native release recovery race',JSON.stringify({qualified:true,observedLockWait:true,replacementCreateDenied:true,heldReservationPreserved:true,oldCleanupAvailable:true}));
 }finally{globalThis.fetch=fetch;await db.close();}
});
