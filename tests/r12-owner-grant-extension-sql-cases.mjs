import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {r04SqlBootstrap} from './helpers/r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './helpers/r10-sql-fixture.mjs';
import {exerciseOwnerInitialRuntime} from './helpers/r12-owner-initial-runtime.mjs';
import {enrollOwnerEpisodeGrant,episodeInput} from './helpers/r12-owner-episode-sql-fixture.mjs';
import {appendOwnerGrantRootRevision,enrollOwnerExtensionGrant} from './helpers/r12-owner-grant-extension-sql-fixture.mjs';
import {one,sha} from './helpers/r12-owner-initial-sql-fixture.mjs';
import {r12QuoteFixture} from './helpers/r12-provider-fixture.mjs';
const host=process.env.R12_SQL_TEST_HOST??process.env.R11_SQL_TEST_HOST;
async function database(){
 const req=createRequire(path.resolve(host,'package.json')),{PGlite}=req('@electric-sql/pglite'),{pgcrypto}=req('@electric-sql/pglite/contrib/pgcrypto'),db=new PGlite({extensions:{pgcrypto}});
 await db.exec(r04SqlBootstrap+sessionBootstrap);
 for(const file of readdirSync('supabase/migrations').filter(x=>x.endsWith('.sql')).sort())await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
 return db;
}
const amount=Number(r12QuoteFixture().maximumMicrousd);
for(const legacy of [null,{committedMicrounits:1000}])test(`Owner grant extension ${legacy?'legacy':'native'} consumes original one-scope root then exactly binds a new episode`,{skip:!host,timeout:120000},async()=>{
 const db=await database();try{
  await exerciseOwnerInitialRuntime(db,{legacy,fixtureOptions:{maximumScopes:1,maximumAllocation:amount},onCompleted:async({f,prepared,context,server})=>{
   await server.stopDiscoveryR12(context,f.businessId,prepared.scopeId,true);
   assert.equal((await one(db,'select count(*)::int n from private.r12_owner_activations where grant_root_id=$1',[f.rootId])).n,1);
   const old=await enrollOwnerEpisodeGrant(db,f,{maximumEpisodes:1,maximumAllocationMicrounits:String(amount)});
   await assert.rejects(old.server('prepare_episode',{input:await episodeInput(db,old),quote:r12QuoteFixture()}),/grant_exhausted/);
   assert.equal((await f.read()).profiles.length,0,'No profile offers exhausted original authority');
   const revision=await appendOwnerGrantRootRevision(db,f.rootId,{maximumScopes:2,maximumAllocationMicrounits:String(2*amount),expiresAt:f.profile.validUntil});
   assert.deepEqual(Object.keys(revision).sort(),['rootId','revision','hash','maximumScopes','maximumAllocationMicrounits','expiresAt'].sort());
   assert.equal(revision.revision,1);assert.equal(revision.maximumScopes,2);assert.equal(revision.maximumAllocationMicrounits,String(2*amount));
   await assert.rejects(old.server('prepare_episode',{input:await episodeInput(db,old),quote:r12QuoteFixture()}),/grant_exhausted/,'Old grant never inherits root revision');
   const extended=await enrollOwnerExtensionGrant(db,f,revision,{maximumEpisodes:1,maximumAllocationMicrounits:String(amount)});
   assert.equal((await f.read()).profiles[0].grantId,extended.grantId);
   await assert.rejects(extended.server('prepare',{input:{...extended.input,submissionId:randomUUID()},quote:r12QuoteFixture()}),/extension_episode_only/);
   const setup=await extended.server('prepare_episode',{input:await episodeInput(db,extended),quote:r12QuoteFixture()});
   assert.deepEqual(setup.preview.grantRootRevision,revision);assert.equal(setup.activated,false);
   const confirmation=extended.confirmPayload(setup),active=await extended.server('confirm_episode',confirmation);
   assert.equal(active.activated,true);assert.deepEqual(await extended.server('confirm_episode',confirmation),{...active,replayed:true});
   assert.equal((await one(db,'select count(*)::int n from private.r12_owner_episode_activations where grant_root_id=$1',[f.rootId])).n,1);
   assert.equal(Number((await one(db,`select coalesce((select sum(allocation_microunits) from private.r12_owner_activations where grant_root_id=$1),0)+coalesce((select sum(allocation_microunits) from private.r12_owner_episode_activations where grant_root_id=$1),0) n`,[f.rootId])).n),2*amount);
   await extended.server('stop',{setupId:setup.setupId,setupHash:setup.setupHash,submissionId:randomUUID()},'');
   assert.equal((await one(db,'select count(*)::int n from private.r05_markers where business_id=$1',[f.businessId])).n,5,'Stop before episode dispatch consumes the allocation without provider send');
   await assert.rejects(extended.server('prepare_episode',{input:await episodeInput(db,extended),quote:r12QuoteFixture()}),/episode_grant_exhausted|grant_exhausted/);
   const rev2=await appendOwnerGrantRootRevision(db,f.rootId,{maximumScopes:3,maximumAllocationMicrounits:String(3*amount),expiresAt:f.profile.validUntil});
   assert.equal(rev2.revision,2);assert.equal((await extended.server('confirm_episode',confirmation)).replayed,true,'Activated exact replay survives later extension');
   await assert.rejects(extended.server('prepare_episode',{input:await episodeInput(db,extended),quote:r12QuoteFixture()}),/extension_grant_stale/);
   await assert.rejects(db.query('update private.r12_owner_grant_root_revisions set maximum_scopes=32 where root_id=$1',[f.rootId]),/immutable/);
   await assert.rejects(db.query('update private.r12_owner_grant_roots set maximum_scopes=32 where id=$1',[f.rootId]),/immutable/);
   await assert.rejects(db.query('update private.r12_owner_bootstrap_grants set root_revision=2 where id=$1',[extended.grantId]),/immutable/);
   for(const role of ['anon','authenticated','service_role']){
    await db.exec(`set role ${role}`);
    try{await assert.rejects(db.query('insert into private.r12_owner_grant_root_revisions default values'),/permission denied/);
     await assert.rejects(db.query('insert into private.r12_owner_bootstrap_grants default values'),/permission denied/);
    }finally{await db.exec('reset role');}
   }
   return true;
  }});
 }finally{await db.close();}
});

test('Extension ledger rejects forged chain, wrong grant hash and stale unactivated setup',{skip:!host,timeout:120000},async()=>{
 const db=await database();try{
  await exerciseOwnerInitialRuntime(db,{fixtureOptions:{maximumScopes:1,maximumAllocation:amount},onCompleted:async({f,prepared,context,server})=>{
   await server.stopDiscoveryR12(context,f.businessId,prepared.scopeId,true);
   const rev1=await appendOwnerGrantRootRevision(db,f.rootId,{maximumScopes:2,maximumAllocationMicrounits:String(2*amount),expiresAt:f.profile.validUntil});
   const extended=await enrollOwnerExtensionGrant(db,f,rev1,{maximumEpisodes:1,maximumAllocationMicrounits:String(amount)});
   await assert.rejects(db.query(`insert into private.r12_owner_bootstrap_grants(id,root_id,business_id,owner_id,business_revision,business_hash,profile_id,server_key_hash,approval_hash,valid_from,valid_until,continuation_bounds,root_revision,root_revision_hash)
    select $1,root_id,business_id,owner_id,business_revision,business_hash,profile_id,$2,approval_hash,valid_from,valid_until,continuation_bounds,root_revision,$3 from private.r12_owner_bootstrap_grants where id=$4`,[randomUUID(),sha(randomUUID()),'f'.repeat(64),extended.grantId]),/foreign key|binding/);
   await assert.rejects(db.query(`insert into private.r12_owner_bootstrap_grants(id,root_id,business_id,owner_id,business_revision,business_hash,profile_id,server_key_hash,approval_hash,valid_from,valid_until,continuation_bounds,root_revision,root_revision_hash)
    select $1,$2,business_id,owner_id,business_revision,business_hash,profile_id,$3,approval_hash,valid_from,valid_until,continuation_bounds,root_revision,root_revision_hash from private.r12_owner_bootstrap_grants where id=$4`,[randomUUID(),randomUUID(),sha(randomUUID()),extended.grantId]),/foreign key|binding/);
   await assert.rejects(db.query(`insert into private.r12_owner_grant_root_revisions(root_id,revision,previous_hash,previous_maximum_scopes,previous_maximum_allocation_microunits,maximum_scopes,maximum_allocation_microunits,approval_hash,expires_at,content_hash)
    select root_id,2,$1,maximum_scopes,maximum_allocation_microunits,3,3*$2::bigint,approval_hash,expires_at,content_hash from private.r12_owner_grant_root_revisions where root_id=$3 and revision=1`,['f'.repeat(64),amount,f.rootId]),/chain_invalid/);
   const setup=await extended.server('prepare_episode',{input:await episodeInput(db,extended),quote:r12QuoteFixture()});
   await appendOwnerGrantRootRevision(db,f.rootId,{maximumScopes:3,maximumAllocationMicrounits:String(3*amount),expiresAt:f.profile.validUntil});
   await assert.rejects(extended.server('confirm_episode',extended.confirmPayload(setup)),/extension_grant_stale/);
   assert.equal((await one(db,'select count(*)::int n from private.r12_owner_episode_activations where grant_root_id=$1',[f.rootId])).n,0);
   return true;
  }});
 }finally{await db.close();}
});
