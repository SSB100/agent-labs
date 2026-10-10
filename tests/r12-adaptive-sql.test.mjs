import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {r04SqlBootstrap} from './helpers/r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './helpers/r10-sql-fixture.mjs';
import {ownerInitialSqlFixture} from './helpers/r12-owner-initial-sql-fixture.mjs';
import {discoveryV2Hash} from '../.core-tests/products/discovery-v2.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const host=process.env.R12_SQL_TEST_HOST??process.env.R11_SQL_TEST_HOST;

test('adaptive SQL migrates in order and remains private and fail closed before execution integration',
 {skip:!host,timeout:120000},async()=>{
  const req=createRequire(path.resolve(host,'package.json'));
  const {PGlite}=req('@electric-sql/pglite');
  const {pgcrypto}=req('@electric-sql/pglite/contrib/pgcrypto');
  const db=new PGlite({extensions:{pgcrypto}});
  try{
   await db.exec(r04SqlBootstrap+sessionBootstrap);
   const migrations=readdirSync(path.join(root,'supabase/migrations')).filter(x=>x.endsWith('.sql')).sort();
   const adaptive=migrations.indexOf('20261010034833_r12_adaptive_research.sql');
   assert.ok(adaptive>migrations.indexOf('20261009185440_r12_owner_grant_root_extensions.sql'));
   assert.ok(adaptive<migrations.indexOf('20261010100000_r12_owner_planner_preflight.sql'));
   for(const file of migrations)await db.exec(readFileSync(path.join(root,'supabase/migrations',file),'utf8'));
   const phase=async(kind,repair=null)=>(await db.query('select private.r12_adaptive_action_phases($1,$2) value',[kind,repair])).rows[0].value;
   assert.deepEqual(await phase('initial'),['plan','search','select','strategy','review']);
   assert.deepEqual(await phase('followup'),['search','select','strategy','review']);
   assert.deepEqual(await phase('pivot'),['plan','search','select','strategy','review']);
   assert.deepEqual(await phase('reasoning_review'),['strategy','review']);
   assert.deepEqual(await phase('repair','select'),['search','select','strategy','review']);
   assert.deepEqual(await phase('repair','review'),['strategy','review']);
   await assert.rejects(phase('repair','search1'),/r12_adaptive_repair_phase_invalid/);
   for(const [canonical,persisted] of [['plan','plan'],['search','search1'],['select','select1'],['strategy','strategy'],['review','review']]){
    const row=(await db.query('select private.r12_adaptive_step_key($1) value',[canonical])).rows[0];
    assert.equal(row.value,persisted);
   }
   await assert.rejects(db.query("select private.r12_adaptive_imports('12080000-0000-4000-8000-000000000001')"),/r12_adaptive_imported_phase_unverified/);
   const guard=(await db.query("select pg_get_functiondef('private.r12_owner_extension_grant_guard()'::regprocedure) definition")).rows[0].definition;
   assert.match(guard,/new\.adaptive_bounds is null/);
   assert.match(guard,/new\.adaptive_bounds->>'expiresAt'/);
   const receipt=(await db.query('select private.r12_adaptive_setup_receipt(null::private.r12_adaptive_setups) value')).rows[0].value;
   assert.equal(receipt?.version,'r12.owner-adaptive-receipt.1');
   const packet={version:'r12.owner-adaptive-setup.1',selection:{marketSetKey:'gb',topicKey:'astronomy'},
    grantId:'12080000-0000-4000-8000-000000000002',approvalHash:'a'.repeat(64),quote:{quoteHash:'b'.repeat(64)},
    preview:{version:'r12.adaptive-research-preview.1'},submissionId:'12080000-0000-4000-8000-000000000003',ownerObservationRef:null};
   const fromSql=(await db.query('select private.stage14_hash(private.r12_adaptive_setup_packet($1,$2,$3,$4,$5,$6,$7)) value',
    [packet.selection,packet.grantId,packet.approvalHash,packet.quote,packet.preview,packet.submissionId,packet.ownerObservationRef])).rows[0].value;
   assert.equal(fromSql,discoveryV2Hash(packet));
   const scopeId='12080000-0000-4000-8000-000000000004';
   const review={outcome:'NEEDS_MORE_EVIDENCE',rawResponse:{outcome:'NEEDS_MORE_EVIDENCE'},
    inheritedQuestions:['  WHICH public source changed?','Which  public  source changed?'],
    additionalQuestions:['What contrary evidence remains?']};
   const conditions=(await db.query(`select $1::jsonb->>'outcome' outcome,
    jsonb_typeof($1::jsonb->'rawResponse') raw_type,
    ($1::jsonb->'rawResponse') ? 'recommendedNextAction' has_next,
    jsonb_typeof($1::jsonb->'inheritedQuestions') inherited_type,
    jsonb_typeof($1::jsonb->'additionalQuestions') additional_type`,[review])).rows[0];
   assert.deepEqual(conditions,{outcome:'NEEDS_MORE_EVIDENCE',raw_type:'object',has_next:false,inherited_type:'array',additional_type:'array'});
   const gap=(await db.query('select private.r12_adaptive_missing_gap($1,$2) value',[scopeId,review])).rows[0].value;
   assert.deepEqual(gap.questions,['what contrary evidence remains?','which public source changed?']);
   assert.equal(gap.gapHash,createHash('sha256').update(`r12.missing-recommendation.1\n${scopeId}\n${gap.questions.join('\n')}`,'utf8').digest('hex'));
   assert.equal((await db.query('select private.r12_adaptive_missing_gap($1,$2) value',[scopeId,{...review,rawResponse:{recommendedNextAction:null}}])).rows[0].value,null);
   const controller=(await db.query("select pg_get_functiondef('public.r07_controller(uuid,uuid,text,jsonb,uuid,text,text,bigint,text)'::regprocedure) definition")).rows[0].definition;
   assert.match(controller,/private\.r12_adaptive_schedule_pins\(p,s,clean\)/);
   assert.match(controller,/adaptive_action_ordinal,adaptive_action_hash/);
   assert.match(controller,/private\.r12_adaptive_reserve_call\(a,request\)/);
   const financial=(await db.query("select pg_get_functiondef('private.r12_discovery_financial_guard()'::regprocedure) definition")).rows[0].definition;
   assert.match(financial,/private\.r12_adaptive_financial_guard\(r,a,p,scope,tg_table_name='r05_markers'\)/);
   const permissions=(await db.query(`select
    (select bool_and(relrowsecurity) from pg_class where oid in
      ('private.r12_adaptive_activations'::regclass,'private.r12_adaptive_actions'::regclass,
       'private.r12_adaptive_call_admissions'::regclass,'private.r12_adaptive_missing_recommendations'::regclass,
       'private.r12_adaptive_planner_receipts'::regclass)) rls,
    has_table_privilege('anon','private.r12_adaptive_actions','INSERT') anon_insert,
    has_table_privilege('authenticated','private.r12_adaptive_actions','INSERT') owner_insert,
    has_table_privilege('service_role','private.r12_adaptive_actions','INSERT') service_insert,
    has_function_privilege('anon','private.r12_adaptive_admit_action(uuid,jsonb)','EXECUTE') anon_admit,
    has_function_privilege('authenticated','private.r12_adaptive_admit_action(uuid,jsonb)','EXECUTE') owner_admit,
    has_function_privilege('service_role','private.r12_adaptive_admit_action(uuid,jsonb)','EXECUTE') service_admit`)).rows[0];
   assert.deepEqual(permissions,{rls:true,anon_insert:false,owner_insert:false,service_insert:false,
    anon_admit:false,owner_admit:false,service_admit:false});
   await assert.rejects(db.query("select private.r12_adaptive_scope_resolve('12080000-0000-4000-8000-000000000001')"),/r12_adaptive_current_scope_required/);
   await assert.rejects(db.query("select private.r12_adaptive_admit_action('12080000-0000-4000-8000-000000000001','{}'::jsonb)"),/r12_adaptive_activation_required/);
   const empty=(await db.query(`select
    (select count(*)::int from private.r12_adaptive_activations) activations,
    (select count(*)::int from private.r12_adaptive_actions) actions,
    (select count(*)::int from private.r12_adaptive_call_admissions) calls,
    (select count(*)::int from private.r05_requests) requests,
    (select count(*)::int from private.r07_attempts) attempts`)).rows[0];
   assert.deepEqual(empty,{activations:0,actions:0,calls:0,requests:0,attempts:0});
   const owner=await ownerInitialSqlFixture(db);
   const catalog=await owner.rpc('r12_owner_adaptive_read',[owner.businessId,owner.goalId,null]);
   assert.equal(catalog.version,'r12.owner-adaptive-catalog.1');
   assert.equal(catalog.eligible,false);
   assert.deepEqual(catalog.grants,[]);
   assert.deepEqual(catalog.setups,[]);
  }finally{await db.close();}
 });
