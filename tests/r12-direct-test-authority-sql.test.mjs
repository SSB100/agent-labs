import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {r04SqlBootstrap} from './helpers/r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './helpers/r10-sql-fixture.mjs';
import {validatePublicResearchOwnerTestReceipt} from '../.core-tests/products/discovery-r12-public-preparation.js';
import {runDirectApprovedSetup} from './helpers/r12-direct-approved-setup-fixture.mjs';
import {prepareDirectTestAuthorityFixture} from './helpers/r12-direct-test-authority-fixture.mjs';
import {one,ownerInitialRuntimeRpc} from './helpers/r12-owner-initial-sql-fixture.mjs';
import {validateOwnerInitialRaceEnvironment} from './helpers/r12-owner-initial-postgres-races.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),host=process.env.R12_SQL_TEST_HOST;
test('direct owner test freezes genuine origin and confirms exact combined cash with internally scoped keys',{skip:!host&&process.env.R12_REQUIRE_POSTGRES!=='1',timeout:180000},async()=>{
 assert.ok(host);const req=createRequire(path.resolve(host,'package.json'));let db;
 if(process.env.R12_REQUIRE_POSTGRES==='1')assert.ok(process.env.R12_POSTGRES_URL);
 if(process.env.R12_POSTGRES_URL){const target=validateOwnerInitialRaceEnvironment(process.env),{Client}=req('pg');db=new Client({connectionString:process.env.R12_POSTGRES_URL});await db.connect();db.exec=sql=>db.query(sql);db.close=()=>db.end();assert.deepEqual(await one(db,'select current_user actor,current_database() db,host(inet_server_addr()) address'),{actor:'r12_test',db:'r12_test',address:target.address});assert.equal(Number((await one(db,"select count(*) n from pg_tables where schemaname in ('public','private')")).n),0);}
 else{const {PGlite}=req('@electric-sql/pglite'),{pgcrypto}=req('@electric-sql/pglite/contrib/pgcrypto');db=new PGlite({extensions:{pgcrypto}});}
 const originalFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('External transport forbidden');};
 try{
  await db.exec(r04SqlBootstrap+sessionBootstrap);
  for(const file of readdirSync(path.join(root,'supabase/migrations')).filter(x=>x.endsWith('.sql')&&x.slice(0,14)<='20261010120406').sort())await db.exec(readFileSync(path.join(root,'supabase/migrations',file),'utf8'));
  await prepareDirectTestAuthorityFixture(db,{legacy:{committedMicrounits:1900000},onPrepared:async x=>{
   const b=x.f.businessId,id=x.prepared.testEnvelopeId;
   assert.deepEqual(validatePublicResearchOwnerTestReceipt(x.prepared,{businessId:b,goalId:x.f.goalId}),x.prepared);
   assert.equal(x.prepared.confirmed,false);assert.equal(x.prepared.preview.maximumMicrounits,'10000000');
   assert.equal(x.prepared.preview.existingGoalBudget.amount,'2');assert.equal(x.prepared.preview.origin.originHistory.financialProofs.length,5);
   const before=await one(db,'select private.r12_direct_grant_usage($1) x',[x.f.rootId]);
   assert.equal(before.x.scopes,1);
   const goal=await one(db,'select content_hash from private.r04_goal_versions where goal_id=$1 and revision=2',[x.f.goalId]);
   await assert.rejects(x.server('confirm_test',{...x.confirmPayload,controllerKeyHash:'a'.repeat(64)}),/unknown|keys|fields|unexpected/);
   await assert.rejects(x.server('confirm_test',x.confirmPayload,'bad-key'),/reviewed_grant_required/);
   const confirmed=await x.confirm();assert.equal(confirmed.confirmed,true);assert.equal(confirmed.testEnvelopeHash,x.prepared.testEnvelopeHash);
   assert.deepEqual(await x.confirm(),confirmed);
   assert.deepEqual(validatePublicResearchOwnerTestReceipt(confirmed,{businessId:b,goalId:x.f.goalId,testEnvelopeId:id}),confirmed);
   const used=(await one(db,'select private.r12_direct_grant_usage($1) x',[x.f.rootId])).x;
   assert.equal(used.scopes,2);assert.equal(BigInt(used.allocationMicrounits)-BigInt(before.x.allocationMicrounits),10000000n);
   assert.deepEqual(await one(db,'select content_hash from private.r04_goal_versions where goal_id=$1 and revision=2',[x.f.goalId]),goal);
   const stored=(await one(db,'select * from private.r12_direct_test_envelopes where id=$1',[id]));
   assert.equal(stored.authority_root_id,x.f.legacy.rootId);assert.equal(Number(stored.maximum_microunits),10000000);
   for(const purpose of ['handoff','verification','cleanup','evidence']){
    const key=await x.key(purpose),table=purpose==='evidence'?'r12_direct_browser_evidence_keys':'r12_etsy_steel_keys';
    const exists=await one(db,`select count(*)::int n from private.${table} where envelope_id=$1 and key_hash=$2`,[id,x.sha(key)]);assert.equal(exists.n,1);
   }
   const catalog=await x.read(id);assert.equal(catalog.current.testEnvelopeId,id);assert.equal(catalog.testEnvelopes.length,1);assert.equal(catalog.eligible,false);
   assert.deepEqual(catalog.originHistory,x.prepared.preview.origin.originHistory);
   assert.equal((await one(db,'select private.r12_direct_test_exposure($1) x',[id])).x.committedMicrounits,'0');
   await assert.rejects(x.prepare({submissionId:randomUUID()}),/r12_direct_origin_current_predecessor_required/);
   const exposure=await one(db,'select private.stage13v2_budget_authority($1,false) x',[x.f.legacy.rootId]);assert.equal(exposure.x.knownActualMicrousd,1900050);
   const setup=await runDirectApprovedSetup(db,x);
   assert.equal(setup.accountBinding.testEnvelopeHash,confirmed.testEnvelopeHash);
   assert.equal(setup.setupAccounting.status,'qualified_bounded_pending');assert.equal(setup.verificationAccounting.status,'qualified_bounded_pending');
   const paidSetup=(await one(db,'select private.r12_direct_test_exposure($1) x',[id])).x;
   assert.equal(paidSetup.knownActualMicrounits,'0');assert.equal(paidSetup.boundedPendingMicrounits,'2000');assert.equal(paidSetup.hasUnknownOrUnbounded,false);
   await db.query('select private.r12_direct_financial_check($1,1000)',[id]);
   assert.deepEqual((await one(db,'select private.r12_direct_origin_frozen_check($1,$2,$3) x',[b,x.f.goalId,x.prepared.preview.originHash])).x,x.origin);
   assert.deepEqual((await x.read(id)).originHistory,x.prepared.preview.origin.originHistory);
   const stop=await x.server('stop_test',{testEnvelopeId:id,testEnvelopeHash:confirmed.testEnvelopeHash,submissionId:randomUUID()},'');assert.equal(stop.stopped,true);
   assert.deepEqual(validatePublicResearchOwnerTestReceipt(stop,{businessId:b,goalId:x.f.goalId,testEnvelopeId:id}),stop);
   await assert.rejects(db.query('select private.r12_direct_financial_check($1,1)',[id]),/authority_unavailable/);
   assert.deepEqual((await one(db,'select private.r12_direct_grant_usage($1) x',[x.f.rootId])).x,used,'Stop does not refund allocation');
   await assert.rejects(ownerInitialRuntimeRpc(db,'r12_owner_direct_read',[b,x.f.goalId,id]),/permission denied/);
   return true;
  }});
  assert.equal(network,0);
 }finally{globalThis.fetch=originalFetch;await db.close();}
});
