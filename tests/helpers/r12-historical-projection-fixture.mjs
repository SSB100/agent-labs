/** Local synthetic historical records; no provider or live enrollment. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {r04SqlBootstrap} from './r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './r10-sql-fixture.mjs';
import {validateOwnerInitialRaceEnvironment} from './r12-owner-initial-postgres-races.mjs';
import {ownerInitialSqlFixture,ownerInitialRuntimeRpc,one} from './r12-owner-initial-sql-fixture.mjs';
import {enrollOwnerEpisodeGrant,episodeInput} from './r12-owner-episode-sql-fixture.mjs';
import {r12QuoteFixture} from './r12-provider-fixture.mjs';
export const historicalMigration='20261010120760_r12_historical_attempt_projection.sql';
export const directMigration='20261010120600_r12_direct_phase_controller.sql';
export async function historicalMigrate(db,from='',through=historicalMigration){
 for(const file of readdirSync('supabase/migrations').filter(x=>x.endsWith('.sql')&&x>from&&x<=through).sort()){
  try{await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));}catch(error){error.message=file+': '+error.message+' '+JSON.stringify({where:error.where,position:error.position,internalQuery:error.internalQuery});throw error;}
 }
}
export async function historicalDatabase(){
 const host=process.env.R12_SQL_TEST_HOST;assert.ok(host,'R12_SQL_TEST_HOST required');const req=createRequire(path.resolve(host,'package.json'));let db;
 if(process.env.R12_REQUIRE_POSTGRES||process.env.R12_POSTGRES_URL){
  const target=validateOwnerInitialRaceEnvironment(process.env),{Client}=req('pg');db=new Client({connectionString:target.url});await db.connect();db.exec=sql=>db.query(sql);db.close=()=>db.end();
  assert.deepEqual(await one(db,'select current_user actor,current_database() db,host(inet_server_addr()) address'),{actor:'r12_test',db:'r12_test',address:target.address});
  assert.equal((await one(db,"select count(*)::int n from pg_tables where schemaname in ('public','private')")).n,0);
 }else{const {PGlite}=req('@electric-sql/pglite'),{pgcrypto}=req('@electric-sql/pglite/contrib/pgcrypto');db=new PGlite({extensions:{pgcrypto}});}
 await db.exec(r04SqlBootstrap+sessionBootstrap);await historicalMigrate(db,'','20261010120599');return db;
}
export async function stoppedHistoricalFixture(db){
 const f=await ownerInitialSqlFixture(db,{bootstrapRoot:'inert-historical-projection-bootstrap-root'}),prepared=await f.prepare();await f.server('confirm',f.confirmPayload(prepared));
 const workspace=await f.rpc('r12_discovery_owner_read',[f.businessId,prepared.scopeId,true]);
 const controller='inert-controller-'+prepared.scopeId,admission='inert-admission-'+prepared.scopeId,lease='inert-historical-projection-controller-lease-0123456789';
 const cmd=(op,payload,epoch=null)=>ownerInitialRuntimeRpc(db,'r07_controller',[f.businessId,f.goalId,op,payload,randomUUID(),controller,lease,epoch,admission]);
 await cmd('plan',{plan:workspace.activation.plan,expectedVersion:0,reason:'Inert historical proof',evidenceHash:'9'.repeat(64)});
 const claimed=await cmd('claim',{seconds:120}),attemptId=randomUUID();
 await cmd('schedule',{stepKey:'plan',attemptId,runtimeCapability:'inert-historical-projection-runtime-capability',reason:'Inert unsent historical planner',evidenceHash:'8'.repeat(64)},claimed.epoch);
 await f.server('stop',{setupId:prepared.setupId,setupHash:prepared.setupHash,submissionId:randomUUID()},'');
 const episode=await enrollOwnerEpisodeGrant(db,f);
 // Keep the producer asynchronous so every saved preview has genuine current pins.
 const next=()=>episodeInput(db,episode).then(input=>episode.server('prepare_episode',{input,quote:r12QuoteFixture()}));
 return {f,episode,attemptId,next,close:async()=>(await one(db,'select private.r12_owner_episode_predecessor($1,$2) value',[f.businessId,f.goalId])).value};
}
export async function historicalRollback(db,fn){await db.exec('begin');try{return await fn();}finally{await db.exec('rollback');}}
