import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {historicalDatabase,historicalMigrate,historicalMigration,historicalRollback} from './helpers/r12-historical-projection-fixture.mjs';
import {exerciseOwnerInitialRuntime} from './helpers/r12-owner-initial-runtime.mjs';
import {enrollOwnerEpisodeGrant,episodeInput} from './helpers/r12-owner-episode-sql-fixture.mjs';
import {one} from './helpers/r12-owner-initial-sql-fixture.mjs';
import {r12QuoteFixture} from './helpers/r12-provider-fixture.mjs';
const enabled=process.env.R12_SQL_TEST_HOST||process.env.R12_REQUIRE_POSTGRES||process.env.R12_POSTGRES_URL;
async function freezeInitial(db){return exerciseOwnerInitialRuntime(db,{onCompleted:async ctx=>{
 const {f}=ctx;await ctx.server.stopDiscoveryR12(ctx.context,f.businessId,ctx.scope.id,true);
 const episode=await enrollOwnerEpisodeGrant(db,f);
 const prepared=await episode.server('prepare_episode',{input:await episodeInput(db,episode),quote:r12QuoteFixture()});
 const packet=(await one(db,'select private.r12_direct_origin_build($1,$2) value',[f.businessId,f.goalId])).value;
 const hash=(await one(db,'select private.stage14_hash($1) value',[packet])).value;
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.ownerId]);
 assert.deepEqual((await one(db,'select private.r12_direct_origin_freeze($1,$2,$3) value',[f.businessId,f.goalId,hash])).value,packet);
 const record=(await one(db,'select to_jsonb(x) value from private.r12_direct_origin_freezes x where business_id=$1',[f.businessId])).value;
 const check=async()=>(await one(db,'select private.r12_direct_origin_frozen_check($1,$2,$3) value',[f.businessId,f.goalId,hash])).value;
 const projection=async()=>(await one(db,'select private.r12_historical_setup_predecessor($1,$2,$3,private.r12_owner_episode_predecessor($4,$5)) value',['owner_setup',prepared.setupId,prepared.setupHash,f.businessId,f.goalId])).value;
 return {f,episode,prepared,packet,hash,record,check,projection};
}});}
test('20760 preserves pre/post column origin archives and completed-prefix preview hashes without hiding changed historical fields', {skip:!enabled,timeout:180000},async()=>{
 const db=await historicalDatabase();try{
  const old=await freezeInitial(db);
  assert.equal(Object.hasOwn(old.record.history_snapshot.plans[0].attempts[0].attempt,'direct_cycle_ordinal'),false);
  await db.exec('prepare historical_snapshot(uuid,uuid,integer) as select private.r12_direct_origin_snapshot($1,$2,$3) value');
  const warm=async x=>(await one(db,`execute historical_snapshot('${x.f.businessId}','${x.f.goalId}',1)`)).value;
  assert.deepEqual(await warm(old),old.record.history_snapshot);
  const oid=(await one(db,"select 'private.r12_direct_origin_snapshot(uuid,uuid,integer)'::regprocedure::oid::text value")).value;
  await historicalMigrate(db,'20261010120599','20261010120755_r12_direct_grant_total_compatibility.sql');
  await assert.rejects(old.check(),/frozen_predecessor_changed/,'Reproduce genuine saved pre-20600 snapshot drift');
  assert.notDeepEqual(await warm(old),old.record.history_snapshot);
  const modern=await freezeInitial(db);assert.equal(modern.record.history_snapshot.plans[0].attempts[0].attempt.direct_cycle_ordinal,null);
  assert.deepEqual(await modern.check(),modern.packet);assert.deepEqual(await warm(modern),modern.record.history_snapshot);
  const records=async()=>(await db.query('select to_jsonb(x) value from private.r12_direct_origin_freezes x order by business_id')).rows;
  const before=await records();await historicalMigrate(db,'20261010120755_r12_direct_grant_total_compatibility.sql',historicalMigration);
  assert.equal((await one(db,"select 'private.r12_direct_origin_snapshot(uuid,uuid,integer)'::regprocedure::oid::text value")).value,oid);
  for(const x of [old,modern]){
   assert.deepEqual(await x.check(),x.packet);assert.deepEqual(await warm(x),x.record.history_snapshot);
   assert.deepEqual(await x.projection(),x.prepared.preview.predecessorClosure,'Saved completed-prefix history selects one authenticated shape');
  }
  assert.deepEqual(await records(),before,'Every freeze packet, snapshot and stored hash remains byte-identical');
  const bindings=(await db.query('select attempt_shape,count(*)::int n from private.r12_historical_setup_projections group by attempt_shape order by attempt_shape')).rows;
  assert.deepEqual(bindings,[{attempt_shape:'post20600',n:1},{attempt_shape:'pre20600',n:1}]);
  for(const x of [old,modern]){
   const a=x.record.history_snapshot.plans[0].attempts[0].attempt;
   for(const [label,sql,args] of [
    ['attempt reason',"update private.r07_attempts set reason='Counterfeit historical reason' where id=$1",[a.id]],
    ['direct marker','update private.r07_attempts set direct_cycle_ordinal=1 where id=$1',[a.id]],
   ])await historicalRollback(db,async()=>{
    await db.exec('alter table private.r07_attempts disable trigger user');await db.query(sql,args);
    await db.exec('savepoint first_check');
    await assert.rejects(x.check(),/historical|frozen_predecessor_changed/,label);
    await db.exec('rollback to savepoint first_check');
    await assert.rejects(x.projection(),/historical/,label+' changes complete prefix identity');
   });
   await historicalRollback(db,async()=>{
    await db.exec('alter table private.r05_settlements disable trigger user');
    await db.query("update private.r05_settlements set receipt_hash=$2 where id=(select min(id) from private.r05_settlements where request_id=$1)",[x.packet.originHistory.financialProofs[0].requestId,randomUUID().replaceAll('-','').repeat(2)]);
    await assert.rejects(x.check(),/historical_origin_snapshot_changed/,'Changed receipt remains visible');
   });
  }
  await historicalRollback(db,async()=>{
   await db.exec('alter table private.r12_direct_origin_freezes disable trigger user');
   await db.query(`update private.r12_direct_origin_freezes set
    history_snapshot=jsonb_set(history_snapshot,'{plans,0,attempts,0,attempt,direct_cycle_ordinal}','null'::jsonb),
    history_snapshot_hash=private.stage14_hash(jsonb_set(history_snapshot,'{plans,0,attempts,0,attempt,direct_cycle_ordinal}','null'::jsonb)) where business_id=$1`,[old.f.businessId]);
   await assert.rejects(old.check(),/mixed_attempt_shape/,'A hash-valid mixed fieldset was never a published raw-row format');
  });
  await historicalRollback(db,async()=>{
   await db.exec('alter table private.r07_attempts add column future_unreviewed_column text');
   await db.exec('savepoint first_check');await assert.rejects(old.check(),/invalid_fields/);
   await db.exec('rollback to savepoint first_check');await assert.rejects(modern.check(),/invalid_fields/);
  });
  assert.deepEqual(await records(),before);assert.deepEqual(await old.check(),old.packet);assert.deepEqual(await modern.check(),modern.packet);
 }finally{await db.close();}
});
