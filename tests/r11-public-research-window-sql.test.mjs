import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {r04SqlBootstrap} from './helpers/r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './helpers/r10-sql-fixture.mjs';
import {setupResearchFixture,seedResearch,enrollResearch,hash,value,counts,guard,settle,collectionPayload} from './helpers/r11-public-research-fixture.mjs';
import {completionPayload} from './helpers/r11-public-research-owner-proof.mjs';
import {researchV2,repairGuard,repairAdmission,repairSettle,repairWorkspace,repairPolicy,workflowStatus,r05FunctionSnapshot,setupContinuationFixture,importContinuationGrant,activateContinuation,continuationStateSnapshot} from './helpers/r11-public-research-repair-fixture.mjs';
import {THIRTY_MINUTES,sourceWindow,freshPhaseQuote,seedWindowResearch,windowGuard,seedWindowContinuation,seedUnusedThirdPredecessor} from './helpers/r11-public-research-window-fixture.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),host=process.env.R11_SQL_TEST_HOST;
const migration='20261005120755_r11_research_thirty_minute_authority.sql';
const reject=/r11_|r05_|r04_|invalid input syntax|violates check constraint|permission denied/;
const migrations=()=>readdirSync(path.join(root,'supabase/migrations')).filter(name=>name.endsWith('.sql')).sort();
const source=name=>readFileSync(path.join(root,'supabase/migrations',name),'utf8');
async function memoryDatabase(){const require=createRequire(path.resolve(host,'package.json')),{PGlite}=require('@electric-sql/pglite'),{pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');return new PGlite({extensions:{pgcrypto}});}
async function bootstrap(db){await db.exec(r04SqlBootstrap+sessionBootstrap);for(const name of migrations())await db.exec(source(name));}
async function r05Rows(db){const result={};for(const {tablename} of(await db.query("select tablename from pg_tables where schemaname='private' and tablename like 'r05_%' order by 1")).rows)result[tablename]=(await db.query(`select to_jsonb(t) row from private.${tablename} t order by to_jsonb(t)::text`)).rows;return result;}
async function noAdmissionEffects(db,s,fn,error=reject){const before=await counts(db,s);await assert.rejects(fn(),error);assert.deepEqual(await counts(db,s),before);}

test('R11 fixed thirty-minute authority requires immutable fresh quotes per phase',{skip:!host,timeout:120000},async t=>{
 const db=await memoryDatabase();let legacy,legacyMarker,oldFunctions,oldR05,seen=false;
 try{
  await db.exec(r04SqlBootstrap+sessionBootstrap);
  for(const name of migrations()){
   if(name!==migration){await db.exec(source(name));continue;}
   seen=true;await setupResearchFixture(db);legacy=await seedResearch(db);legacyMarker=await guard(db,legacy);await settle(db,legacy,legacyMarker.requestId,'inert-before-window-migration');
   oldFunctions=(await db.query(r05FunctionSnapshot)).rows;oldR05=await r05Rows(db);
   const oldTables=(await db.query("select schemaname,tablename from pg_tables where schemaname in ('public','private') order by 1,2")).rows;
   const migrationSource=source(name);assert.match(migrationSource,/commit;\s*$/i);
   await assert.rejects(db.exec(migrationSource.replace(/commit;\s*$/i,()=>"do $$ begin raise exception 'r11_window_rollback_probe';end $$;commit;")),/r11_window_rollback_probe/);await db.exec('rollback');
   assert.equal(await value(db,"select count(*)::int result from information_schema.columns where table_schema='private' and table_name='r11_research_bindings' and column_name='quote_valid_until'"),0);
   assert.deepEqual((await db.query(r05FunctionSnapshot)).rows,oldFunctions);assert.deepEqual(await r05Rows(db),oldR05);
   await db.exec(migrationSource);
   assert.deepEqual((await db.query(r05FunctionSnapshot)).rows,oldFunctions,'The window migration preserves R05 definitions and ACLs');
   assert.deepEqual((await db.query("select schemaname,tablename from pg_tables where schemaname in ('public','private') order by 1,2")).rows,oldTables,'No parallel registry or authority table is created');
  }
  assert.equal(seen,true);assert.deepEqual((await db.query(r05FunctionSnapshot)).rows.map(({id,acl})=>({id,acl})),oldFunctions.map(({id,acl})=>({id,acl})));assert.deepEqual(await r05Rows(db),oldR05,'Migration cannot alter or renew existing financial rows');
  await t.test('existing source1 authority and binding remain usable without a fresh-quote field',async()=>{
   assert.equal(await value(db,'select quote_valid_until result from private.r11_research_bindings where request_id=$1',[legacyMarker.requestId]),null);
   const replay=await guard(db,legacy);assert.equal(replay.shouldDispatch,false);assert.equal(replay.requestId,legacyMarker.requestId);
   assert.deepEqual(await value(db,'select policy result from private.r11_research_policies where id=$1',[legacy.policy.id]),legacy.policy);
   assert.equal((await guard(db,await seedResearch(db))).shouldDispatch,true);
  });
  await t.test('exactly thirty-minute source2 authority completes search and selector using separately fresh phase quotes',async()=>{
   const s=await seedWindowResearch(db),searchQuote=freshPhaseQuote(),marked=await windowGuard(db,s,'search',searchQuote);
   assert.equal(Date.parse(s.policy.validUntil)-Date.parse(s.policy.validFrom),THIRTY_MINUTES);assert.equal(s.policy.quoteValidUntil,s.policy.validUntil);assert.equal(marked.shouldDispatch,true);
   const receipt=`inert-window-search-${randomUUID()}`;await repairSettle(db,s,marked.requestId,receipt);const payload=collectionPayload(s,marked.requestId,receipt),collected=await researchV2(db,s,'collect',payload);s.collectionId=collected.collectionId;s.lineage=payload.lineage;
   assert.equal(payload.lineage.version,'r11.public-research.2');
   await noAdmissionEffects(db,s,()=>repairGuard(db,s,'select'),/r04_invalid_fields|r11_research_fresh_quote_required/);
   const selectorQuote=freshPhaseQuote(Date.now(),90000),selected=await windowGuard(db,s,'select',selectorQuote),selectorReceipt=`inert-window-select-${randomUUID()}`;await repairSettle(db,s,selected.requestId,selectorReceipt);
   const result=await researchV2(db,s,'complete',completionPayload(s,payload.collection,selected.requestId,selectorReceipt));assert.ok(result.resultId);assert.equal(await workflowStatus(db,s),'completed');
   const bindings=(await db.query('select phase,quote_valid_until from private.r11_research_bindings where policy_id=$1 order by phase',[s.policy.id])).rows;
   assert.deepEqual(bindings.map(row=>[row.phase,new Date(row.quote_valid_until).toISOString()]),[['search',searchQuote],['select',selectorQuote]]);
   assert.equal(await value(db,"select count(*)::int result from private.r05_requests where business_id=$1 and payload ? 'quoteValidUntil'",[s.businessId]),0,'Fresh-quote authority stays outside the unchanged R05 descriptor');
   assert.deepEqual(await counts(db,s),{requests:2,reservations:2,markers:2,bindings:2,collections:1});
  });
  await t.test('source2 rejects authority beyond thirty minutes and a mismatched policy-level deadline',async()=>{
   for(const mutate of [p=>{p.validUntil=new Date(Date.parse(p.validFrom)+THIRTY_MINUTES+1).toISOString();p.quoteValidUntil=p.validUntil;},p=>p.quoteValidUntil=new Date(Date.parse(p.validUntil)+1).toISOString(),p=>p.quoteValidUntil=new Date(Date.parse(p.validUntil)-1).toISOString()]){
    const s=await seedWindowResearch(db,{enroll:false});mutate(s.policy);s.policyHash=hash(s.policy);await assert.rejects(enrollResearch(db,s),/r11_research_(v2_authority_window|budget_or_expiry)/);assert.equal(await value(db,'select count(*)::int result from private.r11_research_policies where id=$1',[s.policy.id]),0);
   }
  });
  await t.test('missing, stale, nonfinite, malformed and more-than-five-minute phase quotes fail without accounting effects',async()=>{
   const s=await seedWindowResearch(db);
   await noAdmissionEffects(db,s,()=>repairGuard(db,s),/r04_invalid_fields|r11_research_fresh_quote_required/);
   for(const quote of [null,1,'infinity','-infinity','not-a-date',new Date(Date.now()-1).toISOString(),new Date(Date.now()+360000).toISOString()])await noAdmissionEffects(db,s,()=>windowGuard(db,s,'search',quote),/r11_research_fresh_quote_required/);
   await noAdmissionEffects(db,s,()=>windowGuard(db,s,'search',freshPhaseQuote(),{admission:{...repairAdmission(s),quoteValidUntil:freshPhaseQuote()}}));
   assert.equal((await windowGuard(db,s,'search',freshPhaseQuote(Date.now(),299000))).shouldDispatch,true,'A fresh quote just under five minutes is accepted');
  });
  await t.test('same binding replays its exact quote deadline but rejects renewal and direct mutation',async()=>{
   const s=await seedWindowResearch(db),deadline=freshPhaseQuote(),marked=await windowGuard(db,s,'search',deadline),before=await counts(db,s);
   const replay=await windowGuard(db,s,'search',deadline);assert.equal(replay.requestId,marked.requestId);assert.equal(replay.shouldDispatch,false);
   for(const changed of [new Date(Date.parse(deadline)+1000).toISOString(),new Date(Date.parse(deadline)-1000).toISOString()])await noAdmissionEffects(db,s,()=>windowGuard(db,s,'search',changed),/r11_research_phase_already_bound/);
   await assert.rejects(db.query("update private.r11_research_bindings set quote_valid_until=quote_valid_until+interval '1 second' where request_id=$1",[marked.requestId]),/immutable/);
   assert.equal(new Date(await value(db,'select quote_valid_until result from private.r11_research_bindings where request_id=$1',[marked.requestId])).toISOString(),deadline);assert.deepEqual(await counts(db,s),before);
  });
 }finally{await db.close();}
});

test('R11 thirty-minute continuation preserves the unused cancelled Business3 Goal6 cap3 predecessor',{skip:!host,timeout:120000},async t=>{
 const db=await memoryDatabase();
 try{
  await bootstrap(db);const options=await setupContinuationFixture(db),{original,predecessor}=await seedUnusedThirdPredecessor(db,options);
  assert.equal(await workflowStatus(db,predecessor),'cancelled');assert.equal(await value(db,'select count(*)::int result from private.r05_requests where workflow_run_id=$1',[predecessor.workflowRunId]),0);
  assert.deepEqual((await repairPolicy(db,predecessor)).outcomes.map(({kind,reason,phase})=>({kind,reason,phase})),[{kind:'owner_stopped',reason:'owner_stopped',phase:'none'}]);
  await t.test('legacy source1 continuation remains limited to five minutes and source2 cannot exceed thirty',async()=>{
   for(const [version,duration] of [['r11.public-research.1',THIRTY_MINUTES],['r11.public-research.2',THIRTY_MINUTES+1]]){
    const s=await seedWindowContinuation(db,predecessor,{version,maximumMicrousd:230554,...sourceWindow(Date.now(),duration),enroll:false}),before=await continuationStateSnapshot(db,s);
    await assert.rejects(importContinuationGrant(db,s),/r11_research_continuation_window/);assert.deepEqual(await continuationStateSnapshot(db,s),before);
   }
  });
  await t.test('fresh source2 continuation advances existing revisions while preserving cap, settled exposure, and history',async()=>{
   const oldR05=await r05Rows(db),priorWorkflows=(await db.query('select to_jsonb(w) row from public.workflow_runs w where business_id=$1 order by id',[predecessor.businessId])).rows;
   const s=await seedWindowContinuation(db,predecessor,{maximumMicrousd:230554});assert.equal(s.grant.continuation.businessRevision,3);assert.equal(s.grant.continuation.goalRevision,6);assert.equal(s.grant.continuation.capRevision,3);
   const {result}=await activateContinuation(db,s);assert.equal(result.replayed,false);assert.equal(s.policy.version,'r11.public-research.2');assert.equal(s.policy.goalId,original.goalId);assert.equal(s.businessId,original.businessId);
   assert.equal(await value(db,'select revision result from private.r04_business_state where business_id=$1',[s.businessId]),4);assert.equal(await value(db,'select revision result from private.r04_goal_state where goal_id=$1',[s.goalId]),8);
   assert.deepEqual((await db.query('select revision,maximum_microunits::text maximum from private.r05_cap_versions where business_id=$1 order by revision',[s.businessId])).rows,[1,2,3,4].map(revision=>({revision,maximum:'848063'})));
   assert.deepEqual((await repairWorkspace(db,s)).exposure,{currency:'USD',heldMicrounits:'617509',hasUnknown:false});assert.equal(s.policy.maximumMicrousd,230554);
   assert.equal(await value(db,'select count(*)::int result from private.r05_requests where workflow_run_id=$1',[s.workflowRunId]),0,'Activation grants authority but creates no paid request');
   const afterR05=await r05Rows(db);for(const [table,rows] of Object.entries(oldR05))for(const row of rows)assert.ok(afterR05[table].some(current=>JSON.stringify(current)===JSON.stringify(row)),`Earlier ${table} rows remain unchanged`);
   const currentWorkflows=(await db.query('select to_jsonb(w) row from public.workflow_runs w where business_id=$1 order by id',[s.businessId])).rows;for(const row of priorWorkflows)assert.ok(currentWorkflows.some(current=>JSON.stringify(current)===JSON.stringify(row)),'Previous workflows remain byte-for-byte unchanged');
   const marked=await windowGuard(db,s);assert.equal(marked.shouldDispatch,true);assert.equal(await workflowStatus(db,predecessor),'cancelled');assert.equal(await value(db,'select count(*)::int result from public.goals where business_id=$1',[s.businessId]),2,'Continuation cannot create a fresh budget root');
  });
 }finally{await db.close();}
});
