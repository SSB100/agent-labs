import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {r04SqlBootstrap} from './helpers/r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './helpers/r10-sql-fixture.mjs';
import {ownerInitialSqlFixture,ownerInitialRuntimeRpc,one} from './helpers/r12-owner-initial-sql-fixture.mjs';
import {enrollOwnerEpisodeGrant,episodeInput,runOwnerEpisodePhases} from './helpers/r12-owner-episode-sql-fixture.mjs';
import {appendOwnerGrantRootRevision,enrollOwnerExtensionGrant} from './helpers/r12-owner-grant-extension-sql-fixture.mjs';
import {r12QuoteFixture} from './helpers/r12-provider-fixture.mjs';
import {validateOwnerEpisodeClosure} from '../.core-tests/products/discovery-r12-owner-episode.js';
const host=process.env.R12_SQL_TEST_HOST??process.env.R11_SQL_TEST_HOST;

for(const legacy of [null,{committedMicrounits:1000}])test(`stopped unreserved ${legacy?'legacy':'native'} planner closes by proof without history edits or allowance refund`,{skip:!host,timeout:120000},async()=>{
 const req=createRequire(path.resolve(host,'package.json')),{PGlite}=req('@electric-sql/pglite'),{pgcrypto}=req('@electric-sql/pglite/contrib/pgcrypto'),db=new PGlite({extensions:{pgcrypto}});
 try{
  await db.exec(r04SqlBootstrap+sessionBootstrap);
  for(const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
  const amount=Number(r12QuoteFixture().maximumMicrousd),f=await ownerInitialSqlFixture(db,{legacy,maximumScopes:1,maximumAllocation:amount}),prepared=await f.prepare();
  await f.server('confirm',f.confirmPayload(prepared));
  const workspace=await f.rpc('r12_discovery_owner_read',[f.businessId,prepared.scopeId,true]);
  const controller='inert-controller-'+prepared.scopeId,admission='inert-admission-'+prepared.scopeId,lease='inert-stopped-unreserved-controller-lease-0123456789';
  const cmd=(op,payload,epoch=null)=>ownerInitialRuntimeRpc(db,'r07_controller',[f.businessId,f.goalId,op,payload,randomUUID(),controller,lease,epoch,admission]);
  await cmd('plan',{plan:workspace.activation.plan,expectedVersion:0,reason:'Inert stopped planner test',evidenceHash:'9'.repeat(64)});
  const claimed=await cmd('claim',{seconds:120}),attemptId=randomUUID();
  await cmd('schedule',{stepKey:'plan',attemptId,runtimeCapability:'inert-stopped-unreserved-runtime-capability-0123456789',reason:'Inert planner before reservation',evidenceHash:'8'.repeat(64)},claimed.epoch);
  const proof=()=>one(db,'select private.r12_owner_stopped_before_reservation($1,$2,$3) proof',[f.businessId,f.goalId,attemptId]);
  const close=()=>one(db,'select private.r12_owner_episode_predecessor($1,$2) proof',[f.businessId,f.goalId]);
  await assert.rejects(proof(),/revocations_required/);
  await f.server('stop',{setupId:prepared.setupId,setupHash:prepared.setupHash,submissionId:randomUUID()},'');
  const snapshot=()=>one(db,`select
   (select jsonb_agg(to_jsonb(a) order by id) from private.r07_attempts a where business_id=$1) attempts,
   (select jsonb_agg(to_jsonb(p) order by version) from private.r07_plans p where business_id=$1) plans,
   (select jsonb_agg(to_jsonb(c) order by id) from private.r07_children c where business_id=$1) children,
   (select to_jsonb(h) from private.r07_heads h where business_id=$1 and goal_id=$2) head,
   (select jsonb_agg(to_jsonb(x) order by setup_id) from private.r12_owner_activations x where business_id=$1) activations,
   (select jsonb_agg(to_jsonb(x) order by revision) from private.r05_cap_versions x where business_id=$1) caps,
   (select jsonb_agg(to_jsonb(x) order by id) from private.r12_owner_grant_roots x where business_id=$1) roots,
   (select jsonb_agg(to_jsonb(x) order by source_key) from private.r05_exposure($1) x) exposure`,[f.businessId,f.goalId]);
  const before=await snapshot(),first=(await close()).proof;
  assert.deepEqual(validateOwnerEpisodeClosure(first),first);
  assert.equal(first.stoppedBeforeReservation.length,1);assert.equal(first.stoppedBeforeReservation[0].attemptId,attemptId);
  assert.equal(first.baseChildren,1);assert.equal(first.baseDispatches,0);
  assert.deepEqual((await close()).proof,first);assert.deepEqual(await snapshot(),before);
  // Adversarial mutations are confined to rolled-back local fixture savepoints.
  async function rejects(label,sql,params=[],pattern=/stopped_unreserved/){
   await db.exec('begin;savepoint negative_case');
   try{if(label==='counterfeit dependency binding')await db.exec('alter table private.r07_attempts disable trigger user');if(label==='counterfeit child binding')await db.exec('alter table private.r07_children disable trigger user');if(label==='worker output')await db.exec('alter table public.worker_runs disable trigger user');await db.query(sql,params);await assert.rejects(proof(),pattern,label);}
   catch(error){throw new Error(label+': '+error.message,{cause:error});}
   finally{await db.exec('rollback');}
   assert.deepEqual((await close()).proof,first,label+' leaves no history change');
  }
  await rejects('reserved is never an unsent scheduled proof',"update private.r07_attempts set status='reserved' where id=$1",[attemptId]);
  await rejects('counterfeit dependency binding',"update private.r07_attempts set dependency_pins='[{}]' where id=$1",[attemptId]);
  await rejects('counterfeit child binding',"update private.r07_children set scope=jsonb_set(scope,'{parentPlanHash}',to_jsonb(repeat('0',64))) where id=(select child_id from private.r07_attempts where id=$1)",[attemptId]);
  for(const [table,column,value] of [['r05_revocations','policy_id',prepared.policyId],['r07_server_revocations','key_hash',f.confirmPayload(prepared).controllerKeyHash],['r05_server_revocations','key_hash',f.confirmPayload(prepared).admissionKeyHash]]){
   await db.exec('begin');try{await db.exec(`alter table private.${table} disable trigger user`);await db.query(`delete from private.${table} where ${column}=$1`,[value]);await assert.rejects(proof(),/revocations_required/);}finally{await db.exec('rollback');}
  }
  await rejects('dispatch marker',"insert into private.r07_markers(attempt_id,business_id,lease_epoch) values($1,$2,1)",[attemptId,f.businessId],/effect_evidence/);
  await rejects('unreserved request',`insert into private.r05_requests(id,business_id,workflow_run_id,policy_id,idempotency_key,request_hash,payload,source_key,currency,liability_microunits)
   values($1,$2,$3::uuid,$4,'inert-never-dispatched',repeat('1',64),'{}','r07:'||$3::text,'USD',1)`,[randomUUID(),f.businessId,attemptId,prepared.policyId],/effect_evidence/);
  await rejects('receipt claim',"insert into private.r05_receipt_claims(provider,provider_request_id,business_id,workflow_run_id,source_key) values('openrouter','inert-no-send',$1,$2::uuid,'r07:'||$2::text)",[f.businessId,attemptId],/effect_evidence/);
  await rejects('legacy effect attestation',"insert into private.r05_legacy_attestations(business_id,workflow_run_id,source_key,reported_microusd,receipt_hash) values($1,$2::uuid,'r07:'||$2::text,1,repeat('1',64))",[f.businessId,attemptId],/effect_evidence/);
  await rejects('worker output',`update public.worker_runs set output='{"unexpected":"effect"}' where workflow_run_id=$1`,[attemptId],/effect_evidence/);
  await assert.rejects(one(db,'select private.r12_owner_stopped_before_reservation($1,$2,$3)',[randomUUID(),f.goalId,attemptId]),/identity_required/);
  for(const role of ['anon','authenticated','service_role']){await db.exec(`set role ${role}`);try{await assert.rejects(proof(),/permission denied/);}finally{await db.exec('reset role');}}
  const old=await enrollOwnerEpisodeGrant(db,f,{maximumEpisodes:1,maximumAllocationMicrounits:String(amount)});
  await assert.rejects(old.server('prepare_episode',{input:await episodeInput(db,old),quote:r12QuoteFixture()}),/grant_exhausted/);
  // The proof remains in full lineage closure after a later normally completed
  // inert episode, while the consumed initial allowance remains counted.
  const revision=await appendOwnerGrantRootRevision(db,f.rootId,{maximumScopes:2,maximumAllocationMicrounits:String(2*amount),expiresAt:f.profile.validUntil});
  const extended=await enrollOwnerExtensionGrant(db,f,revision,{maximumEpisodes:1,maximumAllocationMicrounits:String(amount)});
  const next=await extended.server('prepare_episode',{input:await episodeInput(db,extended),quote:r12QuoteFixture()});
  await extended.server('confirm_episode',extended.confirmPayload(next));
  const run=await runOwnerEpisodePhases(db,extended,next);assert.equal(run.posts,5);
  await extended.server('stop',{setupId:next.setupId,setupHash:next.setupHash,submissionId:randomUUID()},'');
  const later=(await close()).proof;assert.deepEqual(later.stoppedBeforeReservation,first.stoppedBeforeReservation);
  assert.equal(later.baseChildren,6);assert.equal(later.baseDispatches,5);
  assert.deepEqual((await one(db,'select to_jsonb(a) row from private.r07_attempts a where id=$1',[attemptId])).row,before.attempts[0]);
  await assert.rejects(extended.server('prepare_episode',{input:await episodeInput(db,extended),quote:r12QuoteFixture()}),/grant_exhausted/);
 }finally{await db.close();}
});
