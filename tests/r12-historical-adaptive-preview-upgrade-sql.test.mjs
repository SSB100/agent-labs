import test from 'node:test';
import assert from 'node:assert/strict';
import {historicalDatabase,historicalMigrate,historicalMigration,historicalRollback} from './helpers/r12-historical-projection-fixture.mjs';
import {prepareFourPlanAdaptiveFixture} from './helpers/r12-adaptive-activation-fixture.mjs';
import {prepareFourPlanEtsyFixture} from './helpers/r12-etsy-activation-fixture.mjs';
import {one} from './helpers/r12-owner-initial-sql-fixture.mjs';
const enabled=process.env.R12_SQL_TEST_HOST||process.env.R12_REQUIRE_POSTGRES||process.env.R12_POSTGRES_URL;
test('20760 restores the exact saved adaptive .1 and .2 planner inputs and confirmation hashes after the column upgrade', {skip:!enabled,timeout:240000},async()=>{
 const db=await historicalDatabase();try{
  const examples=[];for(const prepare of [prepareFourPlanAdaptiveFixture,prepareFourPlanEtsyFixture])examples.push(await prepare(db));
  const read=x=>x.f.rpc('r12_owner_adaptive_preflight',[x.f.businessId,x.prepared.setupId,x.prepared.setupHash,x.quote]);
  const snapshot=async()=>one(db,`select
   (select jsonb_agg(to_jsonb(s) order by s.id) from private.r12_adaptive_setups s) setups,
   (select jsonb_agg(to_jsonb(s) order by s.id) from private.r12_discovery_scopes s) scopes,
   (select jsonb_agg(to_jsonb(p) order by p.id) from private.r07_plans p) plans`);
  for(const x of examples)assert.deepEqual(await read(x),x.packet);
  await historicalMigrate(db,'20261010120599','20261010120755_r12_direct_grant_total_compatibility.sql');
  for(const x of examples){await assert.rejects(read(x),/predecessor_changed/);await assert.rejects(x.confirm(),/review_stale/);}
  const before=await snapshot();await historicalMigrate(db,'20261010120755_r12_direct_grant_total_compatibility.sql',historicalMigration);
  assert.deepEqual(await snapshot(),before);
  for(const x of examples){
   assert.deepEqual(await read(x),x.packet,'Full saved planner packet, including inputHash, remains exact');
   await historicalRollback(db,async()=>{const activated=await x.confirm();assert.equal(activated.activated,true);});
   const binding=await one(db,"select attempt_shape,disposition from private.r12_historical_setup_projections where artifact_kind='adaptive_setup' and setup_id=$1 and setup_hash=$2",[x.prepared.setupId,x.prepared.setupHash]);
   assert.deepEqual(binding,{attempt_shape:'pre20600',disposition:'pinned'});
  }
  assert.deepEqual(await snapshot(),before);
 }finally{await db.close();}
});
