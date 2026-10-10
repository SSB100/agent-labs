/** Additive full-chain compatibility over genuine inert legacy-funded history. */
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
import {prepareDirectBrowserLedgerFixture} from './helpers/r12-direct-browser-ledger-fixture.mjs';
import {one} from './helpers/r12-owner-initial-sql-fixture.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const migration='20261010120750_r12_direct_legacy_compatibility.sql';
const host=process.env.R12_SQL_TEST_HOST;
const fingerprint=`select p.oid::text id,p.oid::regprocedure::text signature,p.proargnames names,
 pg_get_function_identity_arguments(p.oid) args,pg_get_function_arguments(p.oid) arguments,
 p.proacl::text acl,p.proowner::text owner,p.prosecdef security_definer,p.proconfig config,
 p.provolatile volatility,p.proparallel parallel,p.proisstrict strict,p.proleakproof leakproof,
 p.proretset returns_set,pg_get_function_result(p.oid) result
 from pg_proc p where p.oid='private.stage13v2_budget_authority(uuid,boolean)'::regprocedure`;
const constraint=`select pg_get_expr(conbin,conrelid) expression from pg_constraint
 where conrelid='private.r07_plans'::regclass and conname='r07_plans_version_check'`;
const matrix=async(db,expression)=>(await db.query(`select version,content->>'format' format,(${expression}) accepted
 from generate_series(0,11) version cross join (select jsonb_build_object('format',format) content
 from unnest(array['r12.discovery-episode.1','r12.discovery-adaptive.1','r12.discovery-adaptive.2',
 'r12.discovery-direct.1','r12.discovery-adaptive.3','unqualified']) format) examples order by version,format`)).rows;

test('20750 restores original budget catalog identity and established Etsy version bounds without changing liabilities',
 {skip:!host&&!process.env.R12_REQUIRE_POSTGRES&&!process.env.R12_POSTGRES_URL,timeout:180000},async t=>{
 assert.ok(host,'R12_SQL_TEST_HOST required');const req=createRequire(path.resolve(host,'package.json'));let db;
 if(process.env.R12_REQUIRE_POSTGRES||process.env.R12_POSTGRES_URL){
  const target=validateOwnerInitialRaceEnvironment(process.env),{Client}=req('pg');
  db=new Client({connectionString:target.url});await db.connect();db.exec=sql=>db.query(sql);db.close=()=>db.end();
  assert.deepEqual(await one(db,'select current_user actor,current_database() db,host(inet_server_addr()) address'),
   {actor:'r12_test',db:'r12_test',address:target.address});
  assert.equal((await one(db,"select count(*)::int n from pg_tables where schemaname in ('public','private')")).n,0);
 }else{const {PGlite}=req('@electric-sql/pglite'),{pgcrypto}=req('@electric-sql/pglite/contrib/pgcrypto');db=new PGlite({extensions:{pgcrypto}});}
 const originalFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('External transport forbidden');};
 try{
  await db.exec(r04SqlBootstrap+sessionBootstrap);let original,priorFormats;
  for(const file of readdirSync(path.join(root,'supabase/migrations')).filter(x=>x.endsWith('.sql')&&x<migration).sort()){
   if(file==='20261010115441_r12_direct_browser_accounting.sql')original=await one(db,fingerprint);
   if(file==='20261010120600_r12_direct_phase_controller.sql')priorFormats=await matrix(db,(await one(db,constraint)).expression);
   let source=readFileSync(path.join(root,'supabase/migrations',file),'utf8');
   if(file==='20261010120600_r12_direct_phase_controller.sql'){
    // Rehearse an installation that already applied the published 20600. The
    // source correction protects not-yet-upgraded databases in the sibling test.
    const corrected="(version between 5 and 9 and content->>'format' in ('r12.discovery-episode.1','r12.discovery-adaptive.1','r12.discovery-adaptive.2'))";
    assert.equal(source.split(corrected).length,2);
    source=source.replace(corrected,"(version between 5 and 9 and content->>'format' in ('r12.discovery-episode.1','r12.discovery-adaptive.1'))");
   }
   await db.exec(source);
  }
  assert.ok(original&&priorFormats);
  assert.notDeepEqual(await one(db,fingerprint),original,'Reproduce published catalog regression');
  assert.equal((await matrix(db,(await one(db,constraint)).expression)).find(x=>x.version===5&&x.format==='r12.discovery-adaptive.2').accepted,false);
  const x=await prepareFourPlanEtsyFixture(db,{legacy:{committedMicrounits:1100,pending:false}});
  await assert.rejects(x.confirm(),error=>error.constraint==='r07_plans_version_check');
  assert.equal((await one(db,'select count(*)::int n from private.r12_adaptive_activations where goal_id=$1',[x.f.goalId])).n,0);
  const budgetBefore=(await one(db,'select private.stage13v2_budget_authority($1,false) value',[x.f.legacy.rootId])).value;
  const y=await prepareDirectBrowserLedgerFixture(db,{legacy:{committedMicrounits:1900000,pending:false}});
  const a=await y.createOperation();await a.reconcile();await y.check(100);
  const budget=async()=>(await one(db,'select private.stage13v2_budget_authority($1) value',[y.root])).value;
  const directBefore=await budget();
  await db.exec('prepare r12_compat_budget(uuid) as select private.stage13v2_budget_authority($1,false) value; prepare r12_compat_financial(uuid,bigint) as select private.r12_direct_financial_check($1,$2)');
  const preparedBudget=()=>one(db,`execute r12_compat_budget('${y.root}')`);
  const preparedFinancial=()=>db.exec(`execute r12_compat_financial('${y.id}',100)`);
  assert.deepEqual((await preparedBudget()).value,directBefore);await preparedFinancial();
  const legacyBefore=(await one(db,'select private.stage13v2_budget_authority_before_direct($1,true) value',[y.root])).value;
  const callerDefinitions=(await db.query(`select p.oid::text id,pg_get_functiondef(p.oid) definition from pg_proc p
   join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('private','public') and p.prokind='f'
   and position('stage13v2_budget_authority_before_direct' in p.prosrc)>0
   and p.proname<>'stage13v2_budget_authority' order by p.oid`)).rows;
  const wrapperBefore=(await one(db,"select prosrc from pg_proc where oid='private.stage13v2_budget_authority(uuid,boolean)'::regprocedure")).prosrc;
  await db.exec(readFileSync(path.join(root,'supabase/migrations',migration),'utf8'));
  assert.deepEqual(await one(db,fingerprint),original,'Original OID, argument names/default, ACL and execution metadata are restored');
  assert.equal((await one(db,"select prosrc from pg_proc where oid='private.r12_direct_budget_authority_with_exposure(uuid,boolean)'::regprocedure")).prosrc,wrapperBefore);
  assert.deepEqual(await budget(),directBefore,'Warm current exposure caller retains exact totals');
  assert.deepEqual((await one(db,'select private.stage13v2_budget_authority_before_direct($1,true) value',[y.root])).value,legacyBefore,'Warm legacy delegate excludes direct totals exactly once');
  await y.check(100);await preparedFinancial();
  assert.deepEqual((await preparedBudget()).value,directBefore,'Already-prepared current API statement keeps exact direct exposure');
  for(const prior of callerDefinitions)assert.equal((await one(db,'select pg_get_functiondef($1::oid) definition',[prior.id])).definition,prior.definition,'Replanning preserves caller definition');
  const currentFormats=await matrix(db,(await one(db,constraint)).expression);
  for(const prior of priorFormats)if(prior.format!=='r12.discovery-direct.1')assert.deepEqual(currentFormats.find(x=>x.version===prior.version&&x.format===prior.format),prior);
  for(const row of currentFormats.filter(x=>x.format==='r12.discovery-direct.1'))assert.equal(row.accepted,row.version>=1&&row.version<=10);
  for(const args of ['$1','p_root_id => $1','p_root_id => $1, p_lock_authority => false','p_lock_authority => true, p_root_id => $1']){
   assert.deepEqual((await one(db,`select private.stage13v2_budget_authority(${args}) value`,[x.f.legacy.rootId])).value,budgetBefore);
  }
  const confirmed=await x.confirm();assert.equal(confirmed.activated,true);
  const plan=await one(db,'select version,content from private.r07_plans where id=$1',[confirmed.planId]);
  assert.equal(plan.version,5);assert.equal(plan.content.format,'r12.discovery-adaptive.2');
  assert.equal((await one(db,'select count(*)::int n from private.r07_children where plan_id=$1',[confirmed.planId])).n,3);
  // Independently prove current direct browser holds and final billing remain
  // included through the restored legacy API, including named argument calls.
  assert.deepEqual((await one(db,'select private.stage13v2_budget_authority(p_root_id => $1) value',[y.root])).value,directBefore);
  const held=await budget();assert.equal(held.pendingExposureMicrousd,1000);
  assert.equal(held.knownActualMicrousd,1900000);assert.equal(held.committedMicrousd,1901000);
  await a.reconcile(await a.bill(100));
  const final=await budget();assert.equal(final.pendingExposureMicrousd,0);assert.equal(final.knownActualMicrousd,1900100);
  assert.equal(final.committedMicrousd,1900100);
  assert.deepEqual(await one(db,`select has_function_privilege('anon','private.r12_direct_budget_authority_with_exposure(uuid,boolean)','execute') anon,
   has_function_privilege('authenticated','private.r12_direct_budget_authority_with_exposure(uuid,boolean)','execute') authenticated,
   has_function_privilege('service_role','private.r12_direct_budget_authority_with_exposure(uuid,boolean)','execute') service`),{anon:false,authenticated:false,service:false});
  assert.equal(network,0);t.diagnostic('Original catalog OID and metadata, historical format matrix, real legacy-funded Etsy activation, and pending/final direct accounting preserved');
 }finally{globalThis.fetch=originalFetch;await db.close();}
});
