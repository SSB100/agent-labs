import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {historicalDatabase,historicalMigrate,historicalMigration,historicalRollback} from './helpers/r12-historical-projection-fixture.mjs';
import {exerciseOwnerInitialRuntime} from './helpers/r12-owner-initial-runtime.mjs';
import {enrollOwnerEpisodeGrant,episodeInput} from './helpers/r12-owner-episode-sql-fixture.mjs';
import {one,ownerPreflightPrepared} from './helpers/r12-owner-initial-sql-fixture.mjs';
import {r12QuoteFixture} from './helpers/r12-provider-fixture.mjs';
const enabled=process.env.R12_SQL_TEST_HOST||process.env.R12_REQUIRE_POSTGRES||process.env.R12_POSTGRES_URL;
test('20760 keeps an authentic but non-reconstructible preview rejected and respects a genuinely newer head', {skip:!enabled,timeout:150000},async()=>{
 const db=await historicalDatabase();try{
  const x=await exerciseOwnerInitialRuntime(db,{onCompleted:async ctx=>{
   const {f}=ctx;await ctx.server.stopDiscoveryR12(ctx.context,f.businessId,ctx.scope.id,true);
   const episode=await enrollOwnerEpisodeGrant(db,f),next=async()=>episode.server('prepare_episode',{input:await episodeInput(db,episode),quote:r12QuoteFixture()});
   const stale=await next();
   // Explicit synthetic storage correction, not a live receipt or an API
   // settlement. The saved preview is genuine; closure already revoked its
   // send/receipt capabilities, so this does not claim a public late-write path.
   const correction=(await one(db,`insert into private.r05_settlements(request_id,business_id,currency,actual_microunits,provider_request_id,receipt_hash)
    select request_id,business_id,currency,actual_microunits,provider_request_id,$2 from private.r05_settlements where business_id=$1 order by id limit 1 returning id`,[f.businessId,randomUUID().replaceAll('-','').repeat(2)])).id;
   const current=await next();assert.notEqual(stale.preview.predecessorClosure.historyHash,current.preview.predecessorClosure.historyHash);
   return {f,episode,next,stale,current,correction};
  }});
  const row=async prepared=>(await one(db,'select to_jsonb(s) value from private.r12_owner_setups s where id=$1',[prepared.setupId])).value;
  const original=await row(x.stale);
  await historicalMigrate(db,'20261010120599',historicalMigration);
  const disposition=await one(db,"select disposition,attempt_shape from private.r12_historical_setup_projections where artifact_kind='owner_setup' and setup_id=$1",[x.stale.setupId]);
  assert.deepEqual(disposition,{disposition:'non_reconstructible',attempt_shape:null});
  assert.equal((await one(db,'select count(*)::int n from private.r12_historical_attempt_projections where setup_id=$1',[x.stale.setupId])).n,0);
  assert.deepEqual(await row(x.stale),original);
  const resolve=prepared=>one(db,'select private.r12_historical_setup_predecessor($1,$2,$3,private.r12_owner_episode_predecessor($4,$5)) value',['owner_setup',prepared.setupId,prepared.setupHash,x.f.businessId,x.f.goalId]);
  await assert.rejects(resolve(x.stale),/non_reconstructible/);
  await assert.rejects(x.episode.server('confirm_episode',x.episode.confirmPayload(x.stale)),/non_reconstructible/);
  await historicalRollback(db,async()=>{
   await db.exec('alter table private.r05_settlements disable trigger user');await db.query('delete from private.r05_settlements where id=$1',[x.correction]);
   await assert.rejects(resolve(x.stale),/non_reconstructible/,'No automatic reclassification even if storage returns to old bytes');
  });
  const current=await ownerPreflightPrepared(x.f.rpc,x.f.businessId,structuredClone(x.current));
  assert.deepEqual((await resolve(current)).value,current.preview.predecessorClosure);
  const fresh=await x.next();await x.episode.server('confirm_episode',x.episode.confirmPayload(fresh));
  await assert.rejects(x.episode.server('confirm_episode',x.episode.confirmPayload(current)),/closed_predecessor|historical_setup_changed|predecessor_required|r12_episode_genuine_closed_lineage_required/,'A valid historical shape does not authorize an obsolete head');
  assert.deepEqual(await row(x.stale),original);
  assert.equal((await one(db,'select count(*)::int n from private.r12_owner_episode_activations where goal_id=$1',[x.f.goalId])).n,1);
 }finally{await db.close();}
});
