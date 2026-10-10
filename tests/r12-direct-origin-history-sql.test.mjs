import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {r04SqlBootstrap} from './helpers/r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './helpers/r10-sql-fixture.mjs';
import {prepareDirectOriginLegacyFixture} from './helpers/r12-direct-origin-fixture.mjs';
import {prepareFourPlanAdaptiveFixture} from './helpers/r12-adaptive-activation-fixture.mjs';
import {startAdaptivePlanner} from './helpers/r12-adaptive-postgres-races.mjs';
import {runEtsyAction,etsyActionController} from './helpers/r12-etsy-runtime-fixture.mjs';
import {prepareFourPlanEtsyFixture} from './helpers/r12-etsy-activation-fixture.mjs';
import {one} from './helpers/r12-owner-initial-sql-fixture.mjs';
import {discoveryV2Hash as hash} from '../.core-tests/products/discovery-v2.js';
const host=process.env.R12_SQL_TEST_HOST;
const contracts=()=>import(process.env.R12_ORIGIN_CONTRACT_MODULE??'../.core-tests/products/discovery-r12-public-origin.js');
async function database(){
 const req=createRequire(path.resolve(host,'package.json')),{PGlite}=req('@electric-sql/pglite'),{pgcrypto}=req('@electric-sql/pglite/contrib/pgcrypto');
 const db=new PGlite({extensions:{pgcrypto}});await db.exec(r04SqlBootstrap+sessionBootstrap);
 // Focused closure is independent of the in-flight direct authority migration.
 for(const file of readdirSync('supabase/migrations').filter(x=>x.endsWith('.sql')&&(x.slice(0,14)<='20261010112300'||x.startsWith('20261010120300'))).sort())await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
 return db;
}
async function rollbackCase(db,fn){await db.exec('begin');try{return await fn();}finally{await db.exec('rollback');}}
test('direct origin exports genuine legacy history and freezes under original authority',{skip:!host,timeout:180000},async()=>{
 const db=await database();try{
  const c=await prepareDirectOriginLegacyFixture(db,{legacy:{committedMicrounits:1100}}),{packet,f}=c;
  const h=packet.originHistory,closure=packet.predecessor.closure;
  const pure=await contracts();assert.deepEqual(pure.validatePublicResearchPredecessor(packet.predecessor),packet.predecessor);assert.deepEqual(pure.validatePublicResearchOriginHistory(h),h);
  assert.equal(packet.predecessor.kind,'legacy_episode');assert.equal(closure.predecessorPlanVersion,4);
  assert.equal(closure.authorityRootId,(await one(db,'select authority_root_id from private.r12_owner_funding_bindings where business_id=$1',[f.businessId])).authority_root_id);
  assert.equal(closure.baseChildren,20);assert.equal(closure.baseDispatches,20);assert.equal(closure.baseKnownMicrounits,'200');
  assert.deepEqual(packet.predecessor.imports.map(x=>x.phase),['plan','search','select','strategy','review']);
  assert.equal(h.receipts.length,8);assert.equal(h.financialProofs.length,20);assert.ok(h.provenance.length>=4);assert.ok(h.materialHistory.length>0);
  assert.ok(h.continuity.seenQuestionHashes.length>0);assert.ok(h.continuity.seenEvidenceIdentityHashes.length>0);
  assert.equal(h.historyHash,hash(Object.fromEntries(Object.entries(h).filter(([k])=>k!=='historyHash'))));
  assert.deepEqual(await c.build(),packet,'Read-only reconstruction is deterministic');
  await assert.rejects(c.freeze('0'.repeat(64)),/preview_changed/);
  const request=h.financialProofs[0].requestId;
  await rollbackCase(db,async()=>{
   const orphan=randomUUID();
   await db.query(`insert into private.r05_requests(id,business_id,workflow_run_id,policy_id,idempotency_key,request_hash,payload,source_key,currency,liability_microunits)
    select $2::uuid,r.business_id,(select a.id from private.r07_attempts a where a.goal_id=$3 and a.plan_id<>(select plan_id from private.r07_attempts where id=r.workflow_run_id) limit 1),r.policy_id,($2::uuid)::text,r.request_hash,r.payload,'orphan:'||($2::uuid)::text,r.currency,r.liability_microunits from private.r05_requests r where r.id=$1`,[request,orphan,f.goalId]);
   await assert.rejects(c.build(),/request_lineage_required/);
  });
  await rollbackCase(db,async()=>{
   await db.exec('alter table private.r12_discovery_receipt_observations disable trigger r12_discovery_history_guard');
   await db.query('delete from private.r12_discovery_receipt_observations where check_id in(select id from private.r12_discovery_receipt_checks where request_id=$1)',[request]);
   assert.ok((await one(db,'select actual_microunits from private.r05_settlements where request_id=$1 limit 1',[request])).actual_microunits!==null);
   await assert.rejects(c.build(),/qualified_financial_disposition_required/,'Known usage alone cannot close');
  });
  assert.deepEqual(await c.freeze(),packet);assert.deepEqual(await c.freeze(),packet);assert.deepEqual(await c.check(),packet);
  const snapshot=(await one(db,'select history_snapshot from private.r12_direct_origin_freezes where business_id=$1',[f.businessId])).history_snapshot;
  assert.equal(snapshot.plans.length,4);assert.ok(snapshot.plans[0].attempts[0].requests[0].candidate.candidate.output);
  await assert.rejects(db.query('update private.r07_heads set revision=revision+1 where goal_id=$1',[f.goalId]),/irreversibly_closed/);
  await assert.rejects(db.query('update private.r12_direct_origin_freezes set origin_hash=origin_hash where business_id=$1',[f.businessId]),/immutable/);
  await assert.rejects(db.query('select public.r12_discovery_server($1,$2,$3,$4,$5)',[f.businessId,h.financialProofs[0].attemptId,'inputs',{},'another-valid-bootstrap-key-1234567890']),/irreversibly_closed/);
  await assert.rejects(db.query('select public.r05_admission_server($1,$2,$3,$4)',[f.businessId,'settle',{requestId:request},'another-valid-bootstrap-key-1234567890']),/irreversibly_closed/);
  assert.deepEqual(await one(db,"select has_function_privilege('anon','private.r12_direct_origin_build(uuid,uuid)','EXECUTE') build,has_function_privilege('authenticated','private.r12_direct_origin_freeze(uuid,uuid,text)','EXECUTE') freeze,has_table_privilege('service_role','private.r12_direct_origin_freezes','INSERT') insert"),{build:false,freeze:false,insert:false});
 }finally{await db.close();}
});
for(const [name,prepare] of [['adaptive .1',prepareFourPlanAdaptiveFixture],['adaptive .2',prepareFourPlanEtsyFixture]])test(`direct origin closes ${name} after ordinary policy Stop without rewriting head`,{skip:!host,timeout:180000},async()=>{
 const db=await database();try{
  const c=await prepare(db);await c.confirm();const{f}=c;
  await assert.rejects(db.query('select private.r12_direct_origin_build($1,$2)',[f.businessId,f.goalId]),/lineage_unverified/);
  if(name==='adaptive .2'){const started=await startAdaptivePlanner(db,c);await runEtsyAction(db,c,started,{nextKind:'reasoning_review'});const admitted=await etsyActionController(db,c,started).adaptive('admit_next');assert.equal(admitted.admitted,true);await runEtsyAction(db,c,started,{nextKind:'followup'});}
  await f.rpc('r12_owner_adaptive_server',[f.businessId,'stop',{businessId:f.businessId,setupId:c.prepared.setupId,setupHash:c.prepared.setupHash,submissionId:randomUUID()},'']);
  const before=(await one(db,'select to_jsonb(h) h from private.r07_heads h where goal_id=$1',[f.goalId])).h;
  const packet=(await one(db,'select private.r12_direct_origin_build($1,$2) packet',[f.businessId,f.goalId])).packet;
  assert.equal(packet.predecessor.closure.baseRepairs,0,'Separately admitted adaptive calls do not become generic repairs');assert.equal(packet.predecessor.kind,'adaptive_direct_origin');assert.equal(packet.predecessor.closure.headState,'stopped');
  assert.equal(packet.originHistory.receipts.length,name==='adaptive .2'?12:8,'No missing adaptive review is invented');assert.equal(packet.originHistory.financialProofs.length,name==='adaptive .2'?25:20);
  const pure=await contracts();assert.deepEqual(pure.validatePublicResearchPredecessor(packet.predecessor),packet.predecessor);assert.deepEqual(pure.validatePublicResearchOriginHistory(packet.originHistory),packet.originHistory);
  if(name==='adaptive .2'){assert.ok(packet.originHistory.continuity.seenFactIdentityHashes.length>=3);for(const observation of c.bundle.observations)for(const metric of observation.metrics){const expected=pure.publicResearchOwnerFactIdentity(observation,metric);assert.equal((await one(db,'select private.r12_direct_origin_fact($1,$2) h',[observation,metric])).h,expected);assert.ok(packet.originHistory.continuity.seenFactIdentityHashes.includes(expected));}}
  if(name==='adaptive .2'){
   const dep=(await one(db,"select private.r12_adaptive_input_dependency(id) d from private.r07_attempts where plan_id=(select plan_id from private.r12_adaptive_activations where scope_id=$1) and step_key='review' and status='completed' order by adaptive_action_ordinal desc limit 1",[c.prepared.scopeId])).d;
   const actual=(await one(db,'select private.r12_direct_origin_reviewer_pool($1) p',[dep])).p;
   assert.deepEqual(actual.input.evidence.map(x=>x.key),actual.input.evidence.map((_,i)=>'E'+(i+1)));
   for(const change of [x=>x.evidence.reverse(),x=>x.evidence[0].reference={artifactId:randomUUID()},x=>x.evidence[0].sourceContext.context.query='Invented different query']){
    const bad=structuredClone(dep),input=JSON.parse(bad.binding.request.messages[1].content);change(input);bad.binding.request.messages[1].content=JSON.stringify(input);
    await assert.rejects(db.query('select private.r12_direct_origin_reviewer_pool($1)',[bad]),/exact_reviewer_pool_required/);
   }
  }
  const keys=await one(db,'select controller_key_hash,admission_key_hash from private.r12_discovery_authorities where scope_id=$1',[c.prepared.scopeId]);
  assert.equal((await one(db,'select count(*)::int n from private.r07_server_revocations where key_hash=$1',[keys.controller_key_hash])).n,0,'Ordinary Stop retains late recovery');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.ownerId]);
  const frozen=(await one(db,'select private.r12_direct_origin_freeze($1,$2,$3) packet',[f.businessId,f.goalId,hash(packet)])).packet;
  assert.deepEqual(frozen,packet);assert.deepEqual((await one(db,'select to_jsonb(h) h from private.r07_heads h where goal_id=$1',[f.goalId])).h,before);
  assert.equal((await one(db,'select count(*)::int n from private.r07_server_revocations where key_hash=$1',[keys.controller_key_hash])).n,1);
  assert.equal((await one(db,'select count(*)::int n from private.r05_server_revocations where key_hash=$1',[keys.admission_key_hash])).n,1);
 }finally{await db.close();}
});
