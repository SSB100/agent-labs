import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {historicalDatabase,historicalMigrate,historicalMigration,stoppedHistoricalFixture,historicalRollback} from './helpers/r12-historical-projection-fixture.mjs';
import {one,ownerPreflightPrepared} from './helpers/r12-owner-initial-sql-fixture.mjs';
const enabled=process.env.R12_SQL_TEST_HOST||process.env.R12_REQUIRE_POSTGRES||process.env.R12_POSTGRES_URL;
test('20760 keeps mixed authentic stopped previews pinned to their exact historical attempt and full-history shapes', {skip:!enabled,timeout:150000},async()=>{
 const db=await historicalDatabase();try{
  const x=await stoppedHistoricalFixture(db),old=await x.next(),oldClosure=old.preview.predecessorClosure;
  const revoked=await x.next();await db.query('insert into private.r12_owner_grant_revocations(grant_id,reason) values($1,$2)',[x.episode.grantId,'Synthetic historical revocation']);
  // A different reviewed continuation grant lets the same authentic stopped
  // attempt have a current-shape preview too; the old one stays immutable.
  const {enrollOwnerEpisodeGrant,episodeInput}=await import('./helpers/r12-owner-episode-sql-fixture.mjs');
  const {r12QuoteFixture}=await import('./helpers/r12-provider-fixture.mjs');
  const allowed=await enrollOwnerEpisodeGrant(db,x.f);
  const oldAllowed=await allowed.server('prepare_episode',{input:await episodeInput(db,allowed),quote:r12QuoteFixture()});
  await historicalMigrate(db,'20261010120599','20261010120755_r12_direct_grant_total_compatibility.sql');
  const modern=await allowed.server('prepare_episode',{input:await episodeInput(db,allowed),quote:r12QuoteFixture()});
  assert.notEqual(modern.preview.predecessorClosure.historyHash,oldClosure.historyHash);
  assert.notEqual(modern.preview.predecessorClosure.stoppedBeforeReservation[0].attemptHash,oldClosure.stoppedBeforeReservation[0].attemptHash);
  await assert.rejects(allowed.server('confirm_episode',allowed.confirmPayload(oldAllowed)),/stale_closure/);
  const snapshots=async()=>one(db,`select
   (select jsonb_agg(to_jsonb(s) order by s.id) from private.r12_owner_setups s) setups,
   (select jsonb_agg(to_jsonb(a) order by a.id) from private.r07_attempts a) attempts,
   (select jsonb_agg(to_jsonb(p) order by p.id) from private.r07_plans p) plans,
   (select jsonb_agg(to_jsonb(s) order by s.id) from private.r12_discovery_scopes s) scopes`);
  // Historical classification must not require today's Business owner.
  const transferred=await stoppedHistoricalFixture(db),transferredPreview=await transferred.next(),newOwner=randomUUID();
  await db.query('insert into auth.users(id,email) values($1,$2)',[newOwner,newOwner+'@example.invalid']);
  await db.query('update public.businesses set owner_user_id=$2 where id=$1',[transferred.f.businessId,newOwner]);
  const before=await snapshots();await historicalMigrate(db,'20261010120755_r12_direct_grant_total_compatibility.sql',historicalMigration);
  assert.deepEqual(await snapshots(),before,'No saved setup, scope, attempt or plan is rewritten');
  const resolve=async prepared=>(await one(db,'select private.r12_historical_setup_predecessor($1,$2,$3,private.r12_owner_episode_predecessor($4,$5)) value',['owner_setup',prepared.setupId,prepared.setupHash,x.f.businessId,x.f.goalId])).value;
  for(const prepared of [old,oldAllowed,modern])assert.deepEqual(await resolve(prepared),prepared.preview.predecessorClosure);
  const bindings=(await db.query('select attempt_shape,count(*)::int n from private.r12_historical_setup_projections group by attempt_shape order by attempt_shape')).rows;
  assert.deepEqual(bindings,[{attempt_shape:'post20600',n:2},{attempt_shape:'pre20600',n:3}]);
  assert.equal((await one(db,'select count(*)::int n from private.r12_historical_attempt_projections where attempt_id=$1',[x.attemptId])).n,4);
  assert.equal((await one(db,'select disposition from private.r12_historical_setup_projections where setup_id=$1',[transferredPreview.setupId])).disposition,'pinned');
  await assert.rejects(transferred.episode.server('confirm_episode',transferred.episode.confirmPayload(transferredPreview)),/owner_required/,'Historical binding does not renew ownership');
  await assert.rejects(x.episode.server('confirm_episode',x.episode.confirmPayload(revoked)),/grant_unavailable/,'Historical classification never revives a revoked grant');
  for(const prepared of [oldAllowed,modern])await historicalRollback(db,async()=>{
   const fresh=await ownerPreflightPrepared(allowed.rpc,allowed.businessId,structuredClone(prepared));
   assert.equal((await allowed.server('confirm_episode',allowed.confirmPayload(fresh))).activated,true);
  });
  for(const [name,sql,args] of [
   ['reason',"update private.r07_attempts set reason='Counterfeit historical reason' where id=$1",[x.attemptId]],
   ['direct marker','update private.r07_attempts set direct_cycle_ordinal=1 where id=$1',[x.attemptId]],
   ['unknown column','alter table private.r07_attempts add column future_unreviewed_column text',[]],
  ])await historicalRollback(db,async()=>{
   await db.exec('alter table private.r07_attempts disable trigger user');await db.query(sql,args);
   await assert.rejects(resolve(oldAllowed),/historical|invalid_fields/,name+' cannot be hidden by projection');
  });
  await assert.rejects(db.query('update private.r12_historical_setup_projections set attempt_shape=attempt_shape'),/immutable/);
  await assert.rejects(db.query('update private.r12_owner_setups set preview=preview where id=$1',[old.setupId]),/immutable/);
  assert.deepEqual(await resolve(oldAllowed),oldAllowed.preview.predecessorClosure);
  assert.deepEqual(await x.close(),modern.preview.predecessorClosure,'Fresh closure producer stays current canonical');
  const fresh=await allowed.server('prepare_episode',{input:await episodeInput(db,allowed),quote:r12QuoteFixture()});
  assert.equal((await one(db,'select count(*)::int n from private.r12_historical_setup_projections where setup_id=$1',[fresh.setupId])).n,0);
  assert.deepEqual(await resolve(fresh),fresh.preview.predecessorClosure);
  for(const role of ['anon','authenticated','service_role']){
   const acl=await one(db,`select has_table_privilege($1,'private.r12_historical_setup_projections','SELECT,INSERT,UPDATE,DELETE') tables,has_function_privilege($1,'private.r12_historical_setup_predecessor(text,uuid,text,jsonb)','EXECUTE') helper`,[role]);assert.deepEqual(acl,{tables:false,helper:false});
  }
 }finally{await db.close();}
});
