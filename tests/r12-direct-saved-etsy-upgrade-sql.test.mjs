/** Already-saved legacy-funded Etsy .2 authority survives the direct upgrade. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {r04SqlBootstrap} from './helpers/r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './helpers/r10-sql-fixture.mjs';
import {validateOwnerInitialRaceEnvironment} from './helpers/r12-owner-initial-postgres-races.mjs';
import {prepareFourPlanEtsyFixture} from './helpers/r12-etsy-activation-fixture.mjs';
import {startAdaptivePlanner,bindAdaptivePlanner} from './helpers/r12-adaptive-postgres-races.mjs';
import {runEtsyAction} from './helpers/r12-etsy-runtime-fixture.mjs';
import {readClosedResearchHistory} from './helpers/r12-adaptive-history-fixture.mjs';
import {one,ownerInitialRuntimeRpc} from './helpers/r12-owner-initial-sql-fixture.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),host=process.env.R12_SQL_TEST_HOST;
const boundary='20261010120600_r12_direct_phase_controller.sql',cutoff='20261010120750';
test('a persisted Etsy .2 version5 plan, reserved wire and immutable history survive20600 through20750 and then settle',
 {skip:!host&&!process.env.R12_REQUIRE_POSTGRES&&!process.env.R12_POSTGRES_URL,timeout:180000},async t=>{
 assert.ok(host,'R12_SQL_TEST_HOST required');const req=createRequire(path.resolve(host,'package.json'));let db;
 if(process.env.R12_REQUIRE_POSTGRES||process.env.R12_POSTGRES_URL){
  const target=validateOwnerInitialRaceEnvironment(process.env),{Client}=req('pg');db=new Client({connectionString:target.url});
  await db.connect();db.exec=sql=>db.query(sql);db.close=()=>db.end();
  assert.deepEqual(await one(db,'select current_user actor,current_database() db,host(inet_server_addr()) address'),
   {actor:'r12_test',db:'r12_test',address:target.address});
  assert.equal((await one(db,"select count(*)::int n from pg_tables where schemaname in ('public','private')")).n,0);
 }else{const {PGlite}=req('@electric-sql/pglite'),{pgcrypto}=req('@electric-sql/pglite/contrib/pgcrypto');db=new PGlite({extensions:{pgcrypto}});}
 const originalFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('External transport forbidden');};
 try{
  await db.exec(r04SqlBootstrap+sessionBootstrap);
  const files=readdirSync(path.join(root,'supabase/migrations')).filter(x=>x.endsWith('.sql')&&x.slice(0,14)<=cutoff).sort();
  for(const file of files.filter(x=>x<boundary))await db.exec(readFileSync(path.join(root,'supabase/migrations',file),'utf8'));
  const x=await prepareFourPlanEtsyFixture(db,{legacy:{committedMicrounits:1900000,pending:false}});
  const started=await startAdaptivePlanner(db,x);
  assert.equal(started.context.plan.format,'r12.discovery-adaptive.2');
  assert.equal((await one(db,'select version from private.r07_plans where id=$1',[started.activated.planId])).version,5);
  const bound=await bindAdaptivePlanner(db,x,started,{reserve:true,marker:false});
  const input=()=>ownerInitialRuntimeRpc(db,'r12_discovery_server',[x.f.businessId,started.context.attempt.id,'inputs',{},started.controller]);
  const capture=()=>one(db,`select
   (select to_jsonb(p) from private.r07_plans p where p.id=$1) plan,
   (select to_jsonb(s) from private.r12_discovery_scopes s where s.id=$2) scope,
   (select to_jsonb(s) from private.r12_adaptive_setups s where s.scope_id=$2) setup,
   (select to_jsonb(i) from private.r12_adaptive_input_snapshots i where i.attempt_id=$3) snapshot,
   (select to_jsonb(w) from private.r12_discovery_wires w where w.request_id=$4) wire,
   (select to_jsonb(a)-'direct_cycle_ordinal' from private.r07_attempts a where a.id=$3) attempt,
   (select to_jsonb(r) from private.r05_requests r where r.id=$4) request,
   (select private.stage13v2_budget_authority($5,false)) budget`,
   [started.activated.planId,x.prepared.scopeId,started.context.attempt.id,bound.requestId,x.f.legacy.rootId]);
  const before=await capture(),inputBefore=await input(),history=await readClosedResearchHistory(db,x.f.goalId);
  // The prior published constraint rejects this genuine saved row. Roll back
  // only the failed DDL probe, preserving the activated authority and its holds.
  await db.exec('begin;alter table private.r07_plans drop constraint r07_plans_version_check');
  await assert.rejects(db.exec(`alter table private.r07_plans add constraint r07_plans_version_check check(version between 1 and 4 or
   (version between 5 and 9 and content->>'format' in ('r12.discovery-episode.1','r12.discovery-adaptive.1')) or
   (version between 2 and 10 and content->>'format'='r12.discovery-direct.1'))`),error=>error.code==='23514');
  await db.exec('rollback');
  for(const file of files.filter(x=>x>=boundary))await db.exec(readFileSync(path.join(root,'supabase/migrations',file),'utf8'));
  assert.deepEqual(await capture(),before);assert.deepEqual(await input(),inputBefore);
  const afterHistory=await readClosedResearchHistory(db,x.f.goalId);
  for(const plan of afterHistory)for(const attempt of plan.attempts){assert.equal(attempt.direct_cycle_ordinal,null);delete attempt.direct_cycle_ordinal;}
  assert.deepEqual(afterHistory,history,'All original history fields and hashes survive the additive nullable column');
  const complete=await runEtsyAction(db,x,started,{nextKind:'followup'});
  assert.deepEqual(complete.phases,['plan','strategy','review']);assert.equal(complete.posts,3);assert.equal(complete.gets,3);
  const settled=await capture();for(const key of ['plan','scope','setup','snapshot','wire','request'])assert.deepEqual(settled[key],before[key]);
  assert.equal(settled.attempt.status,'completed');assert.equal(settled.attempt.input_hash,before.attempt.input_hash);
  assert.equal((await one(db,'select count(*)::int n from private.r12_adaptive_call_admissions where scope_id=$1',[x.prepared.scopeId])).n,3);
  assert.equal(network,0);t.diagnostic('Existing version5 authority, original20 calls, saved planner input/wire and reserved liability retained; actual inert3-phase completion succeeded');
 }finally{globalThis.fetch=originalFetch;await db.close();}
});
