import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {directControllerDatabase} from './helpers/r12-direct-controller-database.mjs';
import {directControllerFixture} from './helpers/r12-direct-controller-fixture.mjs';
import {directModelDispatch,directModelComplete} from './helpers/r12-direct-controller-model-fixture.mjs';
import {r12PhaseOutputFixture} from './helpers/r12-phase-output-fixture.mjs';
import {one,ownerInitialRpc} from './helpers/r12-owner-initial-sql-fixture.mjs';

test('owner sees canonical actual, pending and unknown test liabilities without new authority or root double counting',{
 skip:!process.env.R12_SQL_TEST_HOST&&!process.env.R12_REQUIRE_POSTGRES&&!process.env.R12_POSTGRES_URL,timeout:180000,
},async()=>{
 const db=await directControllerDatabase();
 try{
  for(const n of ['20261010120610_r12_direct_source_renderer_v2.sql','20261010120620_r12_direct_owner_server_context.sql','20261010120630_r12_direct_late_receipt_head_fence.sql','20261010120640_r12_direct_owner_access_navigation.sql','20261010120650_r12_direct_owner_test_exposure.sql'])await db.exec(readFileSync('supabase/migrations/'+n,'utf8'));
  let other;
  const f=await directControllerFixture(db,{onPrepared:async authority=>{
   assert.equal((await authority.read(authority.prepared.testEnvelopeId)).testExposure,null,'Unconfirmed draft has no active test ledger');
   other=await authority.prepare({submissionId:randomUUID()});assert.equal((await authority.read(other.testEnvelopeId)).testExposure,null);return authority;
  }});f.authority.db=db;
  const b=f.authority.f.businessId,g=f.authority.f.goalId,owner=f.authority.f.ownerId,id=f.authority.prepared.testEnvelopeId;
  const read=(envelope=id,actor=owner,business=b,goal=g)=>ownerInitialRpc(db,actor,'r12_owner_direct_read',[business,goal,envelope]);
  const canonical=async()=>(await one(db,'select private.r12_direct_test_exposure($1) x',[id])).x;
  const parity=async()=>{const catalog=await read();assert.deepEqual(catalog.testExposure,await canonical());return catalog.testExposure;};
  let exposure=await parity();assert.equal(exposure.knownActualMicrounits,'0');assert.equal(exposure.boundedPendingMicrounits,'2000');assert.equal(exposure.committedMicrounits,'2000');assert.equal(exposure.hasUnknownOrUnbounded,false);assert.equal(exposure.allBillingFinal,false);
  assert.equal((await read(other.testEnvelopeId)).testExposure,null);assert.equal((await read(null)).testExposure,null,'Default latest unconfirmed draft does not borrow earlier ledger');
  const counts=()=>one(db,`select (select count(*)::int from private.r05_requests) requests,(select count(*)::int from private.r05_reservations) reservations,
   (select count(*)::int from private.r12_direct_browser_accounting) accounting,(select count(*)::int from private.r12_direct_test_confirmations) confirmations,
   (select count(*)::int from private.r12_owner_grant_roots) grants`);
  const before=await counts();await parity();await parity();assert.deepEqual(await counts(),before);
  const planner=await f.schedule('plan');
  await db.exec('begin');try{
   await directModelDispatch(f,planner);exposure=await parity();assert.equal(exposure.hasUnknownOrUnbounded,true);assert.equal(exposure.allBillingFinal,false);assert.equal(exposure.knownActualMicrounits,'0');assert.ok(BigInt(exposure.boundedPendingMicrounits)>2000n);
  }finally{await db.exec('rollback');}
  const output=r12PhaseOutputFixture(f.profile.audience).plan;output.queryFocus=[];await directModelComplete(f,planner,output);
  exposure=await parity();assert.equal(exposure.knownActualMicrounits,'1');assert.equal(exposure.boundedPendingMicrounits,'2000');assert.equal(exposure.committedMicrounits,'2001');
  const bill=async(operationId,amount)=>{
   const session=await one(db,'select * from private.r12_direct_browser_sessions where operation_id=$1',[operationId]);
   const release=await one(db,"select evidence_hash from private.r12_direct_browser_evidence where operation_id=$1 and kind='release'",[operationId]);
   const usage=await one(db,"select evidence_hash from private.r12_direct_browser_evidence where operation_id=$1 and kind='usage_bound'",[operationId]);
   const billing=await f.approved.ledger(operationId,'evidence',{kind:'billing',providerRecordId:randomUUID(),content:{operationId,sessionId:session.provider_session_id,providerProjectId:f.authority.project,usageIdentityHash:session.usage_identity_hash,tariffHash:f.authority.tariffHash,qualificationHash:f.authority.qualificationHash,qualified:true,currency:'USD',actualMicrounits:String(amount)}});
   return f.approved.ledger(operationId,'reconcile',{releaseProofHash:release.evidenceHash??release.evidence_hash,usageProofHash:usage.evidence_hash,billingProofHash:billing.evidenceHash});
  };
  await bill(f.approved.setupOperation,100);exposure=await parity();assert.equal(exposure.knownActualMicrounits,'101');assert.equal(exposure.boundedPendingMicrounits,'1000');
  await bill(f.approved.verificationOperation,200);exposure=await parity();assert.equal(exposure.knownActualMicrounits,'301');assert.equal(exposure.boundedPendingMicrounits,'0');assert.equal(exposure.committedMicrounits,'301');assert.equal(exposure.allBillingFinal,true);assert.equal(exposure.hasUnknownOrUnbounded,false);
  // Historical1.9USD remains the original root liability, separate from this
  // exact incremental test ledger; never add overlapping root and Business totals.
  const root=await one(db,'select private.stage13v2_budget_authority($1,false) x',[f.policy.authorityRootId]);assert.ok(BigInt(root.x.knownActualMicrousd)>=1900301n);assert.equal(exposure.maximumMicrounits,'10000000');
  await db.exec('begin');try{const over=await bill(f.approved.setupOperation,1500);assert.equal(over.accepted,false);exposure=await parity();assert.equal(exposure.hasUnknownOrUnbounded,true);assert.equal(exposure.allBillingFinal,false);assert.ok(BigInt(exposure.committedMicrounits)>=1701n);}finally{await db.exec('rollback');}
  await assert.rejects(read(id,randomUUID()),/owner_required/);const otherBusiness=randomUUID();await db.query('insert into public.businesses(id,owner_user_id,name) values($1,$2,$3)',[otherBusiness,owner,'Inert exposure other Business']);
  await assert.rejects(read(id,owner,otherBusiness),/exact_test_required/);await assert.rejects(read(id,owner,b,randomUUID()),/exact_test_required/);
  await f.authority.server('stop_test',{testEnvelopeId:id,testEnvelopeHash:f.authority.prepared.testEnvelopeHash,submissionId:randomUUID()});
  exposure=await parity();assert.equal(exposure.knownActualMicrounits,'301');assert.equal(exposure.allBillingFinal,true);
  assert.deepEqual(await one(db,"select has_function_privilege('authenticated','public.r12_owner_direct_read(uuid,uuid,uuid)','EXECUTE') owner,has_function_privilege('anon','public.r12_owner_direct_read(uuid,uuid,uuid)','EXECUTE') anon,has_function_privilege('authenticated','public.r12_owner_direct_read_before_test_exposure(uuid,uuid,uuid)','EXECUTE') old"),{owner:true,anon:false,old:false});
 }finally{await db.close();}
});
