/** Genuine local SQL lifecycle, separate from native PostgreSQL race evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {r04SqlBootstrap} from './helpers/r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './helpers/r10-sql-fixture.mjs';
import {prepareFourPlanAdaptiveFixture} from './helpers/r12-adaptive-activation-fixture.mjs';
import {readClosedResearchHistory} from './helpers/r12-adaptive-history-fixture.mjs';
import {one} from './helpers/r12-owner-initial-sql-fixture.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),host=process.env.R12_SQL_TEST_HOST;
test('Stop consumes activated adaptive authority before its first call and releases only unused hold',{
 skip:!host,timeout:180000,
},async()=>{
 const req=createRequire(path.resolve(host,'package.json'));
 const {PGlite}=req('@electric-sql/pglite'),{pgcrypto}=req('@electric-sql/pglite/contrib/pgcrypto');
 const db=new PGlite({extensions:{pgcrypto}});
 try{
  await db.exec(r04SqlBootstrap+sessionBootstrap);
  for(const file of readdirSync(path.join(root,'supabase/migrations')).filter(x=>x.endsWith('.sql')).sort())
   await db.exec(readFileSync(path.join(root,'supabase/migrations',file),'utf8'));
  for(const legacy of [null,{committedMicrounits:1100,pending:false}]){
   let stage='prepare';
   try{
   const c=await prepareFourPlanAdaptiveFixture(db,{legacy}),history=await readClosedResearchHistory(db,c.f.goalId);
   stage='confirm';
   const activated=await c.confirm();assert.equal(activated.activated,true);
   assert.ok(BigInt((await one(db,'select private.r12_adaptive_outstanding_hold($1) hold',[c.f.businessId])).hold)>0n);
   const counts=async()=>one(db,`select
    (select count(*)::int from private.r12_adaptive_activations where goal_id=$1) activations,
    (select count(*)::int from private.r05_requests where business_id=$2) requests,
    (select count(*)::int from private.r05_markers where business_id=$2) markers,
    (select count(*)::int from private.r12_adaptive_call_admissions where scope_id=$3) calls`,[c.f.goalId,c.f.businessId,c.prepared.scopeId]);
   assert.deepEqual(await counts(),{activations:1,requests:20,markers:20,calls:0});
   stage='stop';
   const stopped=await c.f.rpc('r12_owner_adaptive_server',[c.f.businessId,'stop',{
    businessId:c.f.businessId,setupId:c.prepared.setupId,setupHash:c.prepared.setupHash,submissionId:randomUUID()},'']);
   assert.equal(stopped.stopped,true);assert.equal(stopped.activated,true);
   assert.equal(BigInt((await one(db,'select private.r12_adaptive_outstanding_hold($1) hold',[c.f.businessId])).hold),0n);
   assert.deepEqual(await counts(),{activations:1,requests:20,markers:20,calls:0});
   assert.deepEqual(await readClosedResearchHistory(db,c.f.goalId),history);
   stage='new_prepare_after_stop';
   await assert.rejects(c.prepare(),/exhausted|predecessor|lineage|closed|stopped|unverified/);
   }catch(error){console.error('Adaptive Stop SQL failure',{funding:legacy?'legacy':'native',stage,error:error.message});throw error;}
  }
 }finally{await db.close();}
});
